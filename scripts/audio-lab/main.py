import argparse
import hashlib
import importlib.metadata
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime

os.environ.update(OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1", MKL_NUM_THREADS="1")

import numpy as np
from metrics import RATE, levels, rms, signal_checks, similarity
from report import render, render_catalog, waveform
from scipy.io import wavfile

REPO = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_ROOT = REPO / ".git" / "audio-lab"
TEST = "export_audio::audio_lab::render_fixtures"
REFRESH_TEST = "audio_output::"


def write_json(path, value):
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    )


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def execute(args, timeout=120, env=None, check=True):
    process = subprocess.Popen(
        [str(arg) for arg in args],
        cwd=REPO,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        raise
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if check and process.returncode:
        raise RuntimeError(
            f"{args[0]} exited {process.returncode}: {stderr.decode(errors='replace')[-2000:]}"
        )
    return process.returncode, stdout, stderr


def decode(path, start=0, seconds=12):
    _, output, _ = execute(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-threads",
            "1",
            "-ss",
            start,
            "-i",
            path,
            "-t",
            seconds,
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            RATE,
            "-threads",
            "1",
            "-f",
            "f32le",
            "-",
        ]
    )
    samples = np.frombuffer(output, dtype="<f4").copy().reshape(-1, 1)
    if len(samples) < RATE or not np.isfinite(samples).all():
        raise ValueError(f"Invalid or too short reference: {path}")
    return samples


def read_wav(path):
    rate, samples = wavfile.read(path)
    if rate != RATE or samples.dtype != np.float32:
        raise ValueError(f"Expected float32 WAV at {RATE} Hz: {path}")
    return samples.reshape(len(samples), -1)


def prepare(args):
    recording = args.recording.resolve(strict=True)
    root = args.root.resolve()
    if root.is_relative_to(recording):
        raise ValueError("The lab directory must be outside the source recording")
    metadata_path = recording / "recording-meta.json"
    metadata = json.loads(metadata_path.read_text())
    segments = metadata.get("segments", [])
    if not segments:
        raise ValueError("Expected a Studio recording with microphone segments")
    root.mkdir(parents=True, exist_ok=True)
    corpus = pathlib.Path(tempfile.mkdtemp(prefix="corpus-", dir=root))
    sources, references, cases = [], [], []

    def add(name, samples, kind, description, reference=None, quick=True):
        path = corpus / f"{name}.wav"
        wavfile.write(path, RATE, np.asarray(samples, dtype=np.float32))
        case = {
            "id": name,
            "path": str(path),
            "sha256": sha256(path),
            "kind": kind,
            "description": description,
            "quick": quick,
            "frames": len(samples),
        }
        if reference:
            case["reference"] = str(reference)
            case["referenceSha256"] = sha256(reference)
        cases.append(case)
        return path

    for index, segment in enumerate(segments):
        if not segment.get("mic"):
            continue
        source = (recording / segment["mic"]["path"]).resolve(strict=True)
        if not source.is_relative_to(recording):
            raise ValueError("Microphone path escapes the recording")
        before = sha256(source)
        _, stdout, _ = execute(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                source,
            ]
        )
        duration = float(json.loads(stdout)["format"]["duration"])
        candidates = []
        for fraction in (0.18, 0.45, 0.75):
            start = max(0, min(duration - 12, duration * fraction))
            samples = decode(source, start)
            blocks = samples[: len(samples) // 12000 * 12000].reshape(-1, 12000)
            energy = np.sqrt(np.mean(blocks.astype(np.float64) ** 2, axis=1))
            activity = float(np.mean(energy > 0.003))
            score = activity * min(rms(samples), 0.1)
            candidates.append((score, start, samples))
        _, start, samples = max(candidates, key=lambda item: item[0])
        if rms(samples) < 1e-5:
            raise ValueError(f"No audible reference found in segment {index}")
        path = add(
            f"voice-{index}",
            samples,
            "voice",
            f"Исходная запись: сегмент {index}, {start:.2f}–{start + len(samples) / RATE:.2f} с. Выбрано по энергии; речь вручную не размечена.",
            quick=index == 0,
        )
        cases[-1].update(reference=str(path), referenceSha256=sha256(path))
        references.append((path, samples))
        if sha256(source) != before:
            raise ValueError("Source changed during extraction")
        sources.append(
            {
                "path": str(source),
                "sha256": before,
                "durationSeconds": duration,
                "excerptStartSeconds": start,
                "excerptFrames": len(samples),
            }
        )
        print(
            f"prepared voice-{index}: segment time {start:.2f}s, {len(samples) / RATE:.2f}s",
            flush=True,
        )
    if not references:
        raise ValueError("No microphone tracks found")

    reference_path, speech = references[0]
    add("quiet", speech * 0.1, "voice", "Исходный голос тише на 20 dB.", reference_path)
    dynamics = speech.copy()
    dynamics[: len(speech) // 2] *= 0.1
    add(
        "dynamics",
        dynamics,
        "voice",
        "Первая половина тише на 20 dB; затем исходная громкость.",
        reference_path,
    )
    padded = np.pad(speech, ((RATE, RATE), (0, 0)))
    padded_path = corpus / "reference-padded.wav"
    wavfile.write(padded_path, RATE, padded)
    rng = np.random.default_rng(20261012)
    from scipy.signal import lfilter

    white = rng.normal(size=len(padded))
    fan = lfilter([0.05], [1, -0.95], white)
    t = np.arange(len(padded)) / RATE
    hum = np.sin(2 * np.pi * 50 * t) + 0.3 * np.sin(2 * np.pi * 100 * t)
    for name, noise in (("fan", fan), ("hum", hum), ("white-noise", white)):
        noise *= rms(speech) / (rms(noise) * 10 ** (10 / 20))
        add(
            name,
            padded + noise[:, None],
            "noise",
            "Контролируемый шум, SNR 10 dB; по секунде без исходного голоса в начале и конце.",
            padded_path,
            quick=name == "fan",
        )
    add(
        "stereo",
        np.column_stack((speech[:, 0], speech[:, 0] * 0.5))
        * (0.8 / max(0.8, float(np.max(np.abs(speech))))),
        "voice",
        "Стерео: правый канал тише левого на 6 dB; пик ограничен масштабированием до 0.8 для запаса по уровню.",
        quick=False,
    )
    add("short", speech[:479], "short", "479 сэмплов: короче одного блока RNNoise.")
    add(
        "silence",
        np.zeros((RATE * 2, 1), dtype=np.float32),
        "silence",
        "Две секунды точной тишины.",
    )
    impulse = np.zeros((RATE * 2, 1), dtype=np.float32)
    impulse[RATE, 0] = 0.5
    add(
        "impulse",
        impulse,
        "impulse",
        "Импульс на 1.000 с для проверки тайминга bypass.",
        quick=False,
    )
    config_path = recording / "project-config.json"
    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(UTC).isoformat(),
        "recording": str(recording),
        "metadataSha256": sha256(metadata_path),
        "originalAudioSettings": json.loads(config_path.read_text()).get("audio")
        if config_path.exists()
        else None,
        "sources": sources,
        "cases": cases,
        "seed": 20261012,
    }
    write_json(corpus / "corpus.json", manifest)
    write_json(root / "corpus.json", manifest)
    catalog(root)
    print(f"Prepared {len(cases)} fixtures: {root / 'corpus.json'}", flush=True)


def catalog(root):
    manifest = json.loads((root / "corpus.json").read_text())
    rows = []
    for case in manifest["cases"]:
        path = pathlib.Path(case["path"])
        if sha256(path) != case["sha256"]:
            raise ValueError(f"Fixture hash mismatch: {case['id']}")
        samples = read_wav(path)
        listen = path.with_name(f"listen-{path.name}")
        wavfile.write(listen, RATE, np.int16(np.clip(samples, -1, 1) * 32767))
        rows.append(
            {
                **case,
                "waveform": waveform(samples),
                "audio": os.path.relpath(listen, root),
                "duration": len(samples) / RATE,
                "rmsDbfs": levels(samples)["rmsDbfs"],
            }
        )
    page = root / "corpus.html"
    page.write_text(render_catalog(rows))
    print(f"Fixture catalog: {page}", flush=True)


def snapshot():
    _, stdout, _ = execute(
        [
            "git",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "crates",
            "Cargo.toml",
            "Cargo.lock",
            "scripts/audio-lab",
        ]
    )
    names = sorted(set(stdout.decode().split("\0")) - {""})
    names += [".cargo/config.toml"]
    files = {
        name: sha256(REPO / name)
        for name in names
        if (REPO / name).is_file()
        and pathlib.Path(name).suffix
        in (".rs", ".c", ".h", ".toml", ".lock", ".py", ".txt")
    }
    digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    _, head, _ = execute(["git", "rev-parse", "HEAD"])
    return {"sha256": digest, "head": head.decode().strip(), "files": files}


def filter_variant(mode):
    if mode in ("off", "light", "balanced", "strong"):
        return {}
    filters = {
        "noiseReduction": mode == "noise-only",
        "autoLevel": mode == "auto-only",
        "compressor": mode == "compressor-only",
        "limiter": mode in ("limiter-only", "limiter-boost"),
    }
    if mode == "compressor-only":
        filters.update(thresholdDb=-30, ratio=8)
    if mode == "limiter-boost":
        filters.update(ceilingDb=-6)
    return {"filters": filters, "micVolumeDb": 10 if mode == "limiter-boost" else 0}


def check(args):
    root = args.root.resolve()
    manifest = json.loads((root / "corpus.json").read_text())
    cases = [
        case for case in manifest["cases"] if args.suite == "full" or case["quick"]
    ]
    if args.case:
        requested = set(args.case)
        cases = [case for case in manifest["cases"] if case["id"] in requested]
        if {case["id"] for case in cases} != requested:
            raise ValueError("Unknown case; inspect corpus.json")
    if not cases:
        raise ValueError("No fixtures selected")
    for case in cases:
        for key, hash_key in (("path", "sha256"), ("reference", "referenceSha256")):
            if key in case and sha256(pathlib.Path(case[key])) != case[hash_key]:
                raise ValueError(f"Fixture hash mismatch: {case['id']} / {key}")
    modes = (
        ("off", "balanced")
        if args.suite == "quick"
        else ("off", "light", "balanced", "strong")
    )
    if args.suite == "filters":
        modes = (
            "off",
            "all-off",
            "noise-only",
            "auto-only",
            "compressor-only",
            "limiter-only",
            "limiter-boost",
        )
    run_dir = pathlib.Path(
        tempfile.mkdtemp(
            prefix=datetime.now(UTC).strftime("run-%Y%m%dT%H%M%SZ-"), dir=root
        )
    )
    before = snapshot()
    write_json(run_dir / "source-snapshot.json", before)
    jobs = [
        {
            "id": f"{case['id']}-{mode}",
            "input": case["path"],
            "output": str(run_dir / f"{case['id']}-{mode}"),
            "audio": {
                "improve": mode != "off",
                "isolation": mode
                if mode in ("light", "balanced", "strong")
                else "balanced",
                "mute": False,
                "micVolumeDb": 0,
                "systemVolumeDb": 0,
                "micStereoMode": "stereo",
                **filter_variant(mode),
            },
        }
        for case in cases
        for mode in modes
    ]
    write_json(run_dir / "jobs.json", jobs)
    env = dict(
        os.environ,
        CAP_AUDIO_LAB_JOBS=str(run_dir / "jobs.json"),
        CARGO_BUILD_JOBS="1",
        RAYON_NUM_THREADS="1",
    )
    cargo = ["cargo"]
    if args.native_deps:
        native = args.native_deps.resolve(strict=True)
        cargo += ["--config", f'env.FFMPEG_DIR.value="{native}"']
        env["DYLD_LIBRARY_PATH"] = str(native / "lib")
        env["DYLD_FRAMEWORK_PATH"] = str(native)
    report = {
        "runId": run_dir.name,
        "suite": args.suite,
        "sourceSnapshot": before["sha256"],
        "sourceHead": before["head"],
        "fixtureManifest": manifest,
        "dependencies": {
            name: importlib.metadata.version(name)
            for name in ("numpy", "scipy", "pystoi")
        },
        "results": [],
        "runChecks": [],
    }
    print(
        f"Building current cap-editor tests with one worker. Report: {run_dir}",
        flush=True,
    )
    started = time.monotonic()
    try:
        command = cargo + [
            "test",
            "--locked",
            "-j",
            "1",
            "-p",
            "cap-editor",
            "--lib",
            "--no-run",
            "--message-format=json",
        ]
        code, stdout, stderr = execute(command, timeout=1800, env=env, check=False)
        (run_dir / "build.log").write_bytes(stderr + stdout)
        if code:
            raise RuntimeError(f"Rust build exited {code}; see build.log")
        artifacts = [
            json.loads(line)
            for line in stdout.decode().splitlines()
            if line.startswith("{")
        ]
        executables = [
            item["executable"]
            for item in artifacts
            if item.get("reason") == "compiler-artifact"
            and item.get("executable")
            and item.get("target", {}).get("name") == "cap_editor"
        ]
        if len(executables) != 1:
            raise RuntimeError("Expected exactly one cap-editor test executable")
        binary = run_dir / "cap-editor-tests"
        shutil.copy2(executables[0], binary)
        report["binarySha256"] = sha256(binary)
        print(f"Running {len(jobs)} audio cases, sequentially", flush=True)
        code, stdout, stderr = execute(
            [binary, "--exact", TEST, "--ignored", "--nocapture", "--test-threads=1"],
            timeout=600,
            env=env,
            check=False,
        )
        (run_dir / "engine.log").write_bytes(stdout + stderr)
        report["runChecks"].append(
            {
                "name": "engine-test-executed",
                "passed": code == 0 and b"1 passed; 0 failed" in stdout,
                "exitCode": code,
            }
        )
        code, stdout, stderr = execute(
            [binary, REFRESH_TEST, "--nocapture", "--test-threads=1"],
            timeout=90,
            env=env,
            check=False,
        )
        (run_dir / "refresh.log").write_bytes(stdout + stderr)
        report["runChecks"].append(
            {
                "name": "headless-live-refresh",
                "passed": code == 0
                and bool(re.search(rb"[1-9][0-9]* passed; 0 failed", stdout)),
                "exitCode": code,
            }
        )
        voice = next(
            (case for case in manifest["cases"] if case["id"] == "voice-0"), None
        )
        if voice:
            env["CAP_STUDIO_SOUND_TEST_AUDIO"] = voice["path"]
            code, stdout, stderr = execute(
                [
                    binary,
                    "--exact",
                    "audio_output::native_tests::real_voice_auto_level_slider_reaches_latest_profile_promptly",
                    "--ignored",
                    "--nocapture",
                    "--test-threads=1",
                ],
                timeout=90,
                env=env,
                check=False,
            )
            (run_dir / "real-slider.log").write_bytes(stdout + stderr)
            report["runChecks"].append(
                {
                    "name": "real-voice-slider",
                    "passed": code == 0 and b"1 passed; 0 failed" in stdout,
                    "exitCode": code,
                }
            )
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report["error"] = str(error)
        print(str(error), file=sys.stderr)

    for case in cases:
        source = read_wav(pathlib.Path(case["path"]))
        reference = (
            read_wav(pathlib.Path(case["reference"])) if case.get("reference") else None
        )
        baseline_similarity = (
            similarity(reference, source) if reference is not None else {}
        )
        off_pcm = run_dir / f"{case['id']}-off" / "export.f32"
        bypass = (
            np.fromfile(off_pcm, dtype="<f4").reshape(-1, 2)
            if off_pcm.exists()
            else np.empty((0, 2), dtype=np.float32)
        )
        for mode in modes:
            directory = run_dir / f"{case['id']}-{mode}"
            row = {
                "case": case["id"],
                "mode": mode,
                "description": case["description"],
                "status": "incomplete",
                "checks": [],
            }
            engine_path = directory / "engine.json"
            if not engine_path.exists():
                row["error"] = report.get("error", "Engine did not produce a result")
            else:
                engine = json.loads(engine_path.read_text())
                row.update(
                    status=engine["status"],
                    checks=engine.get("checks", []),
                    engine=engine,
                    enginePath=str(engine_path.relative_to(run_dir)),
                )
                if engine.get("error"):
                    row["error"] = engine["error"]
                output_path = directory / "export.f32"
                if output_path.exists():
                    output = np.fromfile(output_path, dtype="<f4").reshape(-1, 2)
                    row["checks"] += signal_checks(
                        source,
                        output,
                        bypass,
                        case["kind"],
                        mode not in ("off", "all-off"),
                        require_change=mode != "limiter-only",
                    )
                    row.update(
                        levels=levels(output),
                        rms=rms(output) if np.isfinite(output).all() else None,
                        beforeRms=rms(bypass) if np.isfinite(bypass).all() else None,
                    )
                    if reference is not None:
                        row["similarity"] = similarity(reference, output)
                        row["inputSimilarity"] = baseline_similarity
                        if (
                            "stoi" in row["similarity"]
                            and "stoi" in baseline_similarity
                        ):
                            row["stoiDelta"] = (
                                row["similarity"]["stoi"] - baseline_similarity["stoi"]
                            )
                    if np.isfinite(output).all():
                        wavfile.write(
                            directory / "export.wav",
                            RATE,
                            np.int16(np.clip(output, -1, 1) * 32767),
                        )
                        row.update(
                            audio=str((directory / "export.wav").relative_to(run_dir)),
                            before=f"{case['id']}-off/export.wav",
                            waveform=waveform(output),
                        )
                    if row["status"] == "passed" and any(
                        not c["passed"] for c in row["checks"]
                    ):
                        row["status"] = "failed"
                else:
                    row.update(
                        status="incomplete", error="Engine output PCM is missing"
                    )
            report["results"].append(row)
            failed = [c["name"] for c in row["checks"] if not c["passed"]]
            print(
                f"{row['status'].upper()} {case['id']}/{mode}"
                + (f": {', '.join(failed)}" if failed else ""),
                flush=True,
            )

    report["runChecks"].append(
        {
            "name": "source-snapshot-stable",
            "passed": snapshot()["sha256"] == before["sha256"],
        }
    )
    report["runChecks"].append(
        {
            "name": "fixtures-unchanged",
            "passed": all(
                sha256(pathlib.Path(case["path"])) == case["sha256"] for case in cases
            ),
        }
    )
    report["elapsedSeconds"] = time.monotonic() - started
    report["summary"] = {
        status: sum(row["status"] == status for row in report["results"])
        for status in ("passed", "failed", "incomplete")
    }
    report["status"] = (
        "passed"
        if not report.get("error")
        and not report["summary"]["failed"]
        and not report["summary"]["incomplete"]
        and all(c["passed"] for c in report["runChecks"])
        else "failed"
    )
    write_json(
        run_dir / "report.json",
        {
            **report,
            "results": [
                {key: value for key, value in row.items() if key != "waveform"}
                for row in report["results"]
            ],
        },
    )
    (run_dir / "report.html").write_text(render(report))
    print(f"{report['status'].upper()}: {run_dir / 'report.html'}", flush=True)
    return 0 if report["status"] == "passed" else 1


def main():
    parser = argparse.ArgumentParser(
        description="Local Cap audio lab. Never opens Cap or changes a recording."
    )
    parser.add_argument("--root", type=pathlib.Path, default=DEFAULT_ROOT)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prep = subparsers.add_parser(
        "prepare",
        help="Extract short microphone fixtures and generate controlled variants",
    )
    prep.add_argument("recording", type=pathlib.Path)
    subparsers.add_parser(
        "catalog", help="Create a listening page for the prepared inputs; no Rust build"
    )
    run = subparsers.add_parser(
        "check",
        help="Build and exercise the real editor audio engine; run when recording is finished",
    )
    run.add_argument("--suite", choices=("quick", "full", "filters"), default="quick")
    run.add_argument("--case", action="append")
    run.add_argument("--native-deps", type=pathlib.Path)
    mp4 = subparsers.add_parser(
        "check-mp4", help="Compare real Cap MP4 exports with preview audio"
    )
    mp4.add_argument("--native-deps", type=pathlib.Path)
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("This runner currently supports macOS and Linux")
    os.nice(15)
    if args.command == "prepare":
        prepare(args)
        return 0
    if args.command == "catalog":
        catalog(args.root.resolve())
        return 0
    if args.command == "check-mp4":
        from mp4 import check as check_mp4

        return check_mp4(args)
    return check(args)


if __name__ == "__main__":
    raise SystemExit(main())
