# Cap Local

Build a local macOS fork of Cap for screen and camera recording, editing, and export.

## Requirements

- Keep all local Studio recording and editing features available without an account or paid license.
- Remove paid-license prompts and cloud-only choices from the local workflow.
- Preserve screen brightness and colors through recording and export without retagging finished files.
- Make RGB/YUV conversion agree with the encoded color matrix and range on GPU and CPU paths.
- Build an independently identified Cap Local application with its own data directory and no upstream binary updates.
- Keep the existing installed Cap and its recordings intact.

## Verification

- Compare known sRGB grayscale and color patches at capture, source-recording, and exported-video stages on macOS.
- Test conversion against independent BT.709 reference values, including neutral grays and saturated colors.
- Build and check the affected Rust crates and frontend files.
- Verify the separate app launches, local features work without login, and a recording exports with matching colors.

## Limits

- Cap Cloud, uploads, paid server integrations, and hosted AI are outside this fork's requested scope.
- Package the existing Tauri/Solid desktop interface, which provides the local recording and editor features. The unfinished replacement GPUI interface is not included.
- Verify macOS behavior directly; other operating systems require separate runtime evidence.
- Any macOS permission request must be handled through the normal system permission flow.
