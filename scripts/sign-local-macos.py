import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1]).resolve()
identity = sys.argv[2]
with (app / "Contents/Info.plist").open("rb") as source:
    assert plistlib.load(source)["CFBundleIdentifier"] == "so.cap.local"

def sign(path):
    subprocess.run([
        "codesign", "--force", "--sign", identity, "--timestamp=none",
        "--preserve-metadata=entitlements,flags", str(path),
    ], check=True)

magic = {b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}
for path in sorted(app.rglob("*")):
    if path.is_file() and not path.is_symlink():
        with path.open("rb") as source:
            if source.read(4) in magic:
                sign(path)
for framework in sorted(app.rglob("*.framework"), key=lambda path: len(path.parts), reverse=True):
    if not framework.is_symlink():
        sign(framework)
sign(app)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
