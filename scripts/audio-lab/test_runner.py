import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile

import main


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="cap-audio-lab-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        fixture = self.root / "silence.wav"
        wavfile.write(fixture, 48000, np.zeros(48000, dtype=np.float32))
        self.manifest = {
            "cases": [
                {
                    "id": "silence",
                    "path": str(fixture),
                    "sha256": main.sha256(fixture),
                    "quick": True,
                    "kind": "silence",
                    "description": "Silence",
                }
            ]
        }
        main.write_json(self.root / "corpus.json", self.manifest)
        self.args = SimpleNamespace(
            root=self.root, suite="quick", case=None, native_deps=None
        )

    def test_build_failure_returns_nonzero_and_preserves_report(self):
        with (
            patch.object(
                main, "snapshot", return_value={"sha256": "fixed", "head": "test"}
            ),
            patch.object(main, "execute", return_value=(1, b"", b"compile failed")),
        ):
            self.assertEqual(main.check(self.args), 1)
        report_path = next(self.root.glob("run-*/report.json"))
        report = json.loads(report_path.read_text())
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["summary"], {"passed": 0, "failed": 0, "incomplete": 2})
        self.assertIn("RUN FAILED", report_path.with_suffix(".html").read_text())

    def test_modified_fixture_fails_before_compilation(self):
        pathlib.Path(self.manifest["cases"][0]["path"]).write_bytes(b"changed")
        with (
            patch.object(main, "execute") as command,
            self.assertRaisesRegex(ValueError, "hash mismatch"),
        ):
            main.check(self.args)
        command.assert_not_called()

    def test_unknown_case_does_not_expand_to_full_suite(self):
        self.args.case = ["typo"]
        with self.assertRaisesRegex(ValueError, "Unknown case"):
            main.check(self.args)

    def test_timeout_terminates_owned_child(self):
        pidfile = self.root / "child.pid"
        script = "import pathlib,subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); pathlib.Path(sys.argv[1]).write_text(str(p.pid)); time.sleep(60)"
        with self.assertRaises(subprocess.TimeoutExpired):
            main.execute([sys.executable, "-c", script, pidfile], timeout=0.5)
        pid = int(pidfile.read_text())
        result = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertTrue(
            not result.stdout.strip() or result.stdout.strip().startswith("Z")
        )

    def test_original_recording_cannot_be_used_as_output_root(self):
        args = SimpleNamespace(recording=self.root, root=self.root / "new-output")
        with self.assertRaisesRegex(ValueError, "outside the source"):
            main.prepare(args)
        self.assertFalse(args.root.exists())


if __name__ == "__main__":
    unittest.main()
