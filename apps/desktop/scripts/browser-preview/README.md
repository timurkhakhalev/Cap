# Editor browser preview

Use the existing desktop dev server at `http://localhost:3002/editor` to inspect
the real editor UI with a browser. These scripts are standalone development
tools; the application never imports them.

From the repository root, prepare a short local recording:

```sh
node apps/desktop/scripts/browser-preview/build-mock.mjs "/path/to/recording.cap"
```

Metadata, configuration and microphone/system waveforms are read into
`.generated-mock.js` next to the script. This file is ignored by Git and contains
private recording data. Do not commit it, screenshots of private recordings, or
expose the dev server publicly. The source recording is never modified.

If no preview frame server is already running, run this in a separate terminal:

```sh
node apps/desktop/scripts/browser-preview/frame-server.mjs "/path/to/recording.cap"
```

It listens only on `127.0.0.1:47123` and sends one static frame from the first
display segment. Reuse it for subsequent browser sessions.

Open an isolated agent-browser session with the generated IPC mock installed
before navigation:

```sh
agent-browser --session cap-audio-review --init-script "$PWD/apps/desktop/scripts/browser-preview/.generated-mock.js" open http://localhost:3002/editor
agent-browser --session cap-audio-review snapshot -i
```

The mock simulates playhead events and stores presets in memory. Reloading resets
that store. It does not play audio, process filters, export files, or verify native
Tauri persistence. The native audio lab covers processing and export separately.
Browser UI assertions must not be reported as native audio verification.

Check the Audio tab, expand each filter, save/apply/delete a preset through `•••`,
compare Original/Processed, and create a loop on the ruler. Drag either edge or
the top bar; Option bypasses snapping. Shift-drag draws a new range. `L` toggles
looping; `I` and `O` place edges at the playhead; `B` compares voice processing.
Focused loop handles accept Left/Right (one frame) or Shift+Left/Right (one second).
Verify Pause stops repetition and that leaving the Audio tab does not hide the
loop indicator. Also inspect a compact viewport and keyboard-only operation.
