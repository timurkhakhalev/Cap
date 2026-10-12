# Cap audio lab

Local regression and listening bench for post-recording microphone processing.
It calls the real `cap-editor` preview and streaming export PCM paths. It never
launches Cap or writes into the source recording.

## Editor tuning

The audio panel keeps detailed filter controls under **Advanced tuning**.
Named audio presets are saved in the local application store and can be applied
to other recordings. They include processing, noise strength, filter parameters
and microphone gain; muting and other audio tracks stay unchanged.

**Loop preview** repeats an output-timeline range. Set its boundaries in seconds
or use the playhead, then press Play. The player shows the active range and can
turn repetition off. Loops are temporary editor state and never affect exports.
Playback restarts at each boundary, so this is not a gapless audio loop.

## Prepare once

Requires `uv`, FFmpeg/ffprobe, Bun, and the repository's Rust toolchain. Python
packages are pinned in `requirements.txt`; uv resolves them into its own environment.
On macOS, engine checks require full Xcode, including its first-launch setup;
Command Line Tools alone cannot build the repository's `cidre` dependency.
To select Xcode just for a run, prefix the command with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

```sh
bun run audio:lab prepare "/absolute/path/to/recording.cap"
```

The command samples three short windows from each microphone segment, keeps an
audible window using an energy heuristic, and generates quieter speech, volume
changes, seeded additive noise, stereo, silence, an impulse and a sub-frame clip.
These are acoustic candidates, not manually labelled clean speech. No transcript
or audio is uploaded. Source files are hashed before and after extraction.

Private excerpts, the source location, manifests and all results stay under
`.git/audio-lab/`. `corpus.json` points to the latest prepared corpus. Each prepare
and check creates a new directory; previous evidence remains available.

Use `bun run audio:lab catalog` to generate a listening page for the prepared
fixtures without compiling Rust. This page does not represent an engine test.

## Agent feedback loop

Run these commands when the computer is not recording. The runner uses one build
worker, sequential cases, one numerical-library thread and reduced POSIX priority.
A cold Rust build still uses CPU, disk and memory.

```sh
bun run audio:lab check
bun run audio:lab check --case fan
bun run audio:lab check --suite full
bun run audio:lab check --suite filters
bun run audio:lab check-mp4 --native-deps "$PWD/.git/audio-lab/native-deps"
bun run audio:lab:test
```

Quick runs use six fixtures with processing off and balanced. Full runs include
all fixtures and all four Studio Sound modes. `--case` selects exact fixture IDs
from `corpus.json`, including fixtures outside the quick set. Unknown IDs fail.

The filters suite runs each processing stage independently, all stages disabled,
and a boosted microphone with peak protection. It uses the same preview/export
agreement and signal checks. Auto volume without peak protection can clip real
speech; those failures remain visible in the report and are not waived. The UI
warns about this combination. A passing default preset does not mean every custom
combination is safe.

The settings component has a separate DOM test suite. Run it from `apps/desktop`:

```sh
bun x vitest run --config vitest.audio-filters.config.ts
```

It checks independent switches, retained settings, bounded numeric inputs,
explicit default saving, reset, keyboard undo/redo, temporary comparison, and the
peak-protection warning. It does not
replace a visual check of the native editor.

The MP4 command builds the current CLI and harness, creates a private project with
a short microphone excerpt and synthetic video, and exports ordinary, trimmed
fast, and trimmed slow variants through Cap. It compares decoded AAC with preview
PCM without time alignment. Gates require SNR above 25 dB, correlation above 0.99,
level difference below 0.25 dB, and at most one AAC frame of trailing padding.
These check export fidelity, not whether a voice sounds pleasant. Reports include
source and binary hashes; a source change during the run invalidates the result.

## Settings behavior

Voice processing is saved per project. Noise reduction, auto volume, compression,
and peak protection have independent switches. Disabling a filter retains its
parameters. Timing controls are collapsed by default. Reset restores Studio Sound;
saving defaults for new recordings requires its own button.

Listen without filters changes only preview state. Editing a filter returns to
processed preview. Autosave writes the project without overwriting this temporary
preview state; exports load the saved filter settings. Peak protection limits the
microphone after microphone gain. Later clip gain, transitions, music and system
audio can still raise the final mix above that ceiling.

The normal repository native-dependency configuration is used unless an explicit
`--native-deps /absolute/path` is provided. On this machine the lab's private
macOS v0.25 dependencies are in `.git/audio-lab/native-deps`, downloaded from the
same release used by `scripts/setup.js`:

```sh
bun run audio:lab check --native-deps "$PWD/.git/audio-lab/native-deps"
```

Extracted macOS dylibs require ad-hoc signing, as performed by
`signMacOSFrameworkLibs` in `scripts/setup.js`. The private copies on this machine
have been signed. A negative `exitCode` in a run check identifies termination by
a signal; inspect macOS crash reports if the engine log is empty.

No app bundle or shared `.cargo/config.toml` is modified. The runner currently
supports macOS and Linux. Reproduce native-device behavior on the target OS
separately.

## Results

Each run prints its directory. `report.json` is the machine-readable result;
`report.html` provides per-case checks, waveforms and before/after WAV playback,
with optional RMS matching. A failing check returns a nonzero exit status.
The original unprocessed reference is never replaced with a candidate output.

Hard checks cover finite/non-clipped samples, decoded frame count, bypass identity,
non-silent speech, effective processing, preview/export agreement, different block
sizes, seek reinitialization, and the existing headless live-refresh/stop regression.
The headless suite includes smooth parameter changes, latest-value queue handling,
and stop/replacement ordering. When the corpus includes `voice-0`, it also checks a
burst of real-voice auto-volume changes against a one-second response budget.
The run records a source-content snapshot and binary hash. Changes to relevant
sources during a run invalidate the result, including edits in a shared checkout.
Missing fixtures, missing results, build failures and zero selected tests cannot
produce a green report.

STOI and SI-SDR are diagnostics against the original excerpt. The original may
already contain noise. Scores are not subjective quality ratings, and differences
from intentional EQ/compression are not automatically defects. Signals are not
time-aligned to conceal latency. Quality thresholds require listening calibration;
this bench does not invent a universal acceptance score or update golden files.

The `check` command checks export **PCM**; `check-mp4` separately checks final
AAC/MP4 output. Neither launches the native settings UI or hardware audio output.
Seek checks compare reused and fresh renderer state at the same
position; they do not promise that finite denoiser preroll equals processing the
entire recording from the beginning. Add feature-specific fixtures and assertions
when implementing the new filter controls.

## Verify the bench

```sh
bun run audio:lab:test
cargo fmt --all -- --check
```

The Python tests inject silence, clipping, dropped samples, bypass drift and
swapped channels to verify that the corresponding gates reject bad outputs.
After the initial build, Rust checks can be run with the same native-dependency
configuration as `check`. Never treat a prepared corpus as a completed engine run.
