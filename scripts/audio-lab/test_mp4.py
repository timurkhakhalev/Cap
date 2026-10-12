import unittest

import numpy as np
from mp4 import compare_audio


class Mp4ComparisonTests(unittest.TestCase):
    def setUp(self):
        time = np.arange(48_000) / 48_000
        self.audio = (
            np.column_stack(
                (np.sin(time * 440 * 2 * np.pi), np.sin(time * 661 * 2 * np.pi))
            )
            * 0.2
        )

    def test_accepts_small_codec_error_and_bounded_padding(self):
        noise = np.random.default_rng(17).normal(0, 0.0001, self.audio.shape)
        decoded = np.pad(self.audio + noise, ((0, 512), (0, 0)))
        self.assertTrue(compare_audio(self.audio, decoded)["passed"])

    def test_rejects_silence_and_truncation(self):
        self.assertFalse(compare_audio(self.audio, np.zeros_like(self.audio))["passed"])
        self.assertFalse(compare_audio(self.audio, self.audio[:-1])["passed"])

    def test_rejects_timing_shift_channel_swap_and_gain_change(self):
        for decoded in [
            np.roll(self.audio, 100, axis=0),
            self.audio[:, ::-1],
            self.audio * 1.1,
        ]:
            self.assertFalse(compare_audio(self.audio, decoded)["passed"])

    def test_rejects_nonfinite_audio(self):
        decoded = self.audio.copy()
        decoded[10, 0] = np.nan
        self.assertFalse(compare_audio(self.audio, decoded)["passed"])
