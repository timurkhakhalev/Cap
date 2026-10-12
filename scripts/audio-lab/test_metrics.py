import unittest

import numpy as np

from metrics import RATE, levels, signal_checks, similarity
from report import render


class SignalChecksTests(unittest.TestCase):
    def setUp(self):
        t = np.arange(RATE * 2) / RATE
        self.source = (np.sin(t * 2 * np.pi * 220) * 0.1).astype(np.float32)[:, None]
        self.bypass = np.repeat(self.source * np.float32(0.707), 2, axis=1)

    def failed(self, output, enhanced=False, kind="voice"):
        return [
            c["name"]
            for c in signal_checks(self.source, output, self.bypass, kind, enhanced)
            if not c["passed"]
        ]

    def test_real_mono_pan_law_is_accepted(self):
        self.assertEqual(self.failed(self.bypass), [])

    def test_disabled_processing_cannot_claim_enhancement(self):
        self.assertIn("processing-active", self.failed(self.bypass, enhanced=True))

    def test_silencing_speech_cannot_pass(self):
        self.assertIn(
            "not-silenced", self.failed(np.zeros_like(self.bypass), enhanced=True)
        )

    def test_changed_gain_cannot_pass_bypass(self):
        self.assertIn("bypass-identity", self.failed(self.bypass * 1.1))

    def test_missing_tail_cannot_pass(self):
        self.assertIn("output-duration", self.failed(self.bypass[:-479]))

    def test_nonfinite_audio_cannot_pass(self):
        broken = self.bypass.copy()
        broken[0, 0] = np.nan
        self.assertIn("finite-output", self.failed(broken))
        self.assertFalse(levels(broken)["finite"])

    def test_clipping_cannot_pass(self):
        self.assertIn("sample-peak", self.failed(np.ones_like(self.bypass)))

    def test_stereo_channels_cannot_be_swapped(self):
        source = np.column_stack((self.source[:, 0], self.source[:, 0] * 0.3))
        checks = signal_checks(source, source[:, ::-1], source, "voice", False)
        self.assertFalse(
            next(c["passed"] for c in checks if c["name"] == "bypass-identity")
        )

    def test_short_files_do_not_get_misleading_quality_scores(self):
        result = similarity(self.source[:479], self.bypass[:479])
        self.assertEqual(result["status"], "unavailable")

    def test_silent_reference_has_no_intelligibility_score(self):
        result = similarity(np.zeros_like(self.source), np.zeros_like(self.bypass))
        self.assertEqual(result["status"], "unavailable")

    def test_scaled_original_has_high_similarity(self):
        rng = np.random.default_rng(12)
        speech_like = rng.normal(size=(RATE * 2, 1)).astype(np.float32)
        result = similarity(speech_like, speech_like * 0.5)
        self.assertGreater(result["stoi"], 0.99)
        self.assertGreater(result["siSdrDb"], 90)

    def test_report_escapes_fixture_names_and_errors(self):
        page = render(
            {
                "runId": "test",
                "suite": "quick",
                "status": "failed",
                "runChecks": [],
                "summary": {"passed": 0, "failed": 1, "incomplete": 0},
                "results": [
                    {
                        "case": '<script>alert("x")</script>',
                        "mode": "off",
                        "status": "failed",
                        "error": "<broken>",
                    }
                ],
            }
        )
        self.assertNotIn('<script>alert("x")</script>', page)
        self.assertIn("&lt;broken&gt;", page)


if __name__ == "__main__":
    unittest.main()
