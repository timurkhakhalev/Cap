import json
import os
import pathlib
import shutil
import subprocess
import tempfile

import numpy as np
from main import TEST, execute, filter_variant, sha256, snapshot, write_json
from scipy.io import wavfile


def compare_audio(reference, decoded):
    count = min(len(reference), len(decoded))
    expected, actual = reference[:count].astype(float), decoded[:count].astype(float)
    energy = float(np.sum(expected * expected))
    error = float(np.sum((actual - expected) ** 2))
    actual_energy = float(np.sum(actual * actual))
    if (
        not count
        or not energy
        or not actual_energy
        or not np.isfinite(reference).all()
        or not np.isfinite(decoded).all()
    ):
        return {"passed": False, "error": "Empty, silent or non-finite audio"}
    snr = float(10 * np.log10(energy / max(error, 1e-30)))
    level_delta = float(10 * np.log10(actual_energy / energy))
    correlation = float(np.corrcoef(expected.ravel(), actual.ravel())[0, 1])
    padding = len(decoded) - len(reference)
    return {
        "passed": bool(
            0 <= padding <= 1024
            and snr > 25
            and correlation > 0.99
            and abs(level_delta) < 0.25
        ),
        "previewFrames": len(reference),
        "decodedFrames": len(decoded),
        "aacPaddingFrames": padding,
        "snrDb": snr,
        "correlation": correlation,
        "rmsDifferenceDb": level_delta,
        "alignment": "none",
    }


def check(args):
    root = args.root.resolve()
    manifest = json.loads((root / "corpus.json").read_text())
    case = next(item for item in manifest["cases"] if item["id"] == "voice-0")
    source = pathlib.Path(case["path"])
    if sha256(source) != case["sha256"]:
        raise ValueError("Fixture hash mismatch")
    run = pathlib.Path(tempfile.mkdtemp(prefix="mp4-", dir=root))
    before = snapshot()
    env = dict(os.environ, CARGO_BUILD_JOBS="1", RAYON_NUM_THREADS="1")
    cargo = ["cargo"]
    if args.native_deps:
        native = args.native_deps.resolve(strict=True)
        cargo += ["--config", f'env.FFMPEG_DIR.value="{native}"']
        env.update(
            DYLD_LIBRARY_PATH=str(native / "lib"), DYLD_FRAMEWORK_PATH=str(native)
        )
    report = {"sourceSnapshot": before, "results": [], "status": "failed"}
    print(f"Building current CLI and audio harness with one worker: {run}", flush=True)
    try:
        binaries = {}
        for package, target, command in [
            ("cap", "cap", ["build"]),
            ("cap-editor", "cap_editor", ["test", "--lib", "--no-run"]),
        ]:
            _, stdout, stderr = execute(
                cargo
                + command
                + ["--locked", "-j", "1", "-p", package, "--message-format=json"],
                timeout=1800,
                env=env,
            )
            (run / f"{package}-build.log").write_bytes(stderr + stdout)
            artifacts = [
                json.loads(line)
                for line in stdout.decode().splitlines()
                if line.startswith("{")
            ]
            paths = [
                item["executable"]
                for item in artifacts
                if item.get("reason") == "compiler-artifact"
                and item.get("executable")
                and item.get("target", {}).get("name") == target
            ]
            if len(paths) != 1:
                raise ValueError(f"Expected one {package} executable")
            binaries[package] = run / package
            shutil.copy2(paths[0], binaries[package])
        report["binarySha256"] = {name: sha256(path) for name, path in binaries.items()}
        project = run / "fixture.cap"
        project.mkdir()
        shutil.copy2(source, project / "audio.wav")
        rate, samples = wavfile.read(source)
        duration = len(samples) / rate
        execute(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x303046:s=320x180:r=10",
                "-t",
                str(duration),
                "-an",
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-pix_fmt",
                "yuv420p",
                project / "display.mp4",
            ]
        )
        write_json(
            project / "recording-meta.json",
            {
                "platform": "MacOS",
                "pretty_name": "Private audio export fixture",
                "segments": [
                    {
                        "display": {"path": "display.mp4", "fps": 10, "start_time": 0},
                        "mic": {"path": "audio.wav", "start_time": 0},
                    }
                ],
                "cursors": {},
                "status": {"status": "Complete"},
            },
        )
        for name, speed, speed_mode, start, end in [
            ("normal", 1, "maintainPitch", 0, duration),
            ("trim-fast", 2, "maintainPitch", 2, 6),
            ("trim-slow", 0.5, "matchSpeed", 2, 6),
        ]:
            output = run / name
            output.mkdir()
            audio = {
                "improve": True,
                "isolation": "balanced",
                **filter_variant("limiter-boost"),
            }
            timeline = {
                "segments": [
                    {
                        "recordingSegment": 0,
                        "start": start,
                        "end": end,
                        "timescale": speed,
                        "speedAudioMode": speed_mode,
                        "volume": 0.75,
                    }
                ],
                "zoomSegments": [],
            }
            config = {
                "background": {
                    "source": {"type": "color", "value": [30, 30, 46]},
                    "padding": 0,
                },
                "camera": {"hide": True},
                "cursor": {"hide": True},
                "audio": audio,
                "timeline": timeline,
            }
            write_json(project / "project-config.json", config)
            write_json(
                run / "jobs.json",
                [
                    {
                        "id": name,
                        "input": str(source),
                        "output": str(output),
                        "audio": audio,
                        "timeline": timeline,
                    }
                ],
            )
            env["CAP_AUDIO_LAB_JOBS"] = str(run / "jobs.json")
            _, stdout, stderr = execute(
                [
                    binaries["cap-editor"],
                    "--exact",
                    TEST,
                    "--ignored",
                    "--nocapture",
                    "--test-threads=1",
                ],
                env=env,
            )
            (output / "engine.log").write_bytes(stdout + stderr)
            if b"1 passed; 0 failed" not in stdout:
                raise ValueError("Audio harness did not execute")
            _, stdout, stderr = execute(
                [
                    binaries["cap"],
                    "export",
                    project,
                    "--output",
                    output / "export.mp4",
                    "--fps",
                    "10",
                    "--resolution",
                    "320x180",
                    "--force-ffmpeg-decoder",
                    "--json",
                ],
                env=env,
            )
            (output / "export.log").write_bytes(stdout + stderr)
            execute(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    output / "export.mp4",
                    "-map",
                    "0:a:0",
                    "-f",
                    "f32le",
                    "-acodec",
                    "pcm_f32le",
                    "-threads",
                    "1",
                    output / "decoded.f32",
                ]
            )
            reference = np.fromfile(output / "preview.f32", dtype="<f4").reshape(-1, 2)
            decoded = np.fromfile(output / "decoded.f32", dtype="<f4").reshape(-1, 2)
            result = {"case": name, **compare_audio(reference, decoded)}
            report["results"].append(result)
            print(f"{name}: {result}", flush=True)
        report["sourceStable"] = snapshot()["sha256"] == before["sha256"]
        report["fixtureStable"] = sha256(source) == case["sha256"]
        if (
            report["sourceStable"]
            and report["fixtureStable"]
            and all(row["passed"] for row in report["results"])
        ):
            report["status"] = "passed"
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report["error"] = str(error)
    write_json(run / "report.json", report)
    print(f"{report['status'].upper()}: {run / 'report.json'}", flush=True)
    return 0 if report["status"] == "passed" else 1
