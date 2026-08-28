from __future__ import annotations

import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np
from coderunners_voice_clone.worker import (
    GIB,
    QwenVoiceClone,
    VoiceCloneError,
    admitted_batch_size,
    max_sentences_per_group,
    narration_groups,
)


class FakeResult:
    def __init__(self, sequence_idx: int) -> None:
        self.sequence_idx = sequence_idx
        self.audio = np.zeros(2_400, dtype=np.float32)


class FakeModel:
    sample_rate = 24_000

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def batch_generate(self, texts: list[str], **_options: object):
        self.calls.append(texts)
        for index in reversed(range(len(texts))):
            yield FakeResult(index)


class QwenVoiceCloneTest(unittest.TestCase):
    def test_admission_reserves_headroom_and_scales_with_reference_duration(self) -> None:
        self.assertEqual(max_sentences_per_group(13 * GIB, 15), 1)
        self.assertEqual(max_sentences_per_group(20 * GIB, 15), 1)
        self.assertEqual(admitted_batch_size(20 * GIB, 15, 1), 2)
        self.assertEqual(admitted_batch_size(34 * GIB, 15, 1), 6)
        with self.assertRaises(VoiceCloneError):
            max_sentences_per_group(12 * GIB, 15)

    def test_groups_long_narration_one_sentence_at_a_time(self) -> None:
        self.assertEqual(
            narration_groups("One. Two! Three? Four. Five."),
            ["One.", "Two!", "Three?", "Four.", "Five."],
        )

    def test_batch_render_preserves_job_order_after_model_returns_out_of_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            reference = root / "reference.wav"
            reference.write_bytes(b"authorized")
            model = FakeModel()
            cache_clears: list[None] = []
            clone = QwenVoiceClone(
                model_loader=lambda: model,
                memory_reader=lambda: 36 * GIB,
                reference_duration_reader=lambda _path: 15,
                cache_clearer=lambda: cache_clears.append(None),
            )
            first = root / "first.wav"
            second = root / "second.wav"
            third = root / "third.wav"

            clone.synthesize_batch(
                [("one", first), ("two", second), ("three", third)],
                reference,
                "authorized reference transcript",
            )

            self.assertEqual(model.calls, [["one", "two", "three"]])
            self.assertEqual(cache_clears, [None])
            for output_path in (first, second, third):
                with wave.open(str(output_path), "rb") as audio:
                    self.assertEqual(audio.getframerate(), 24_000)
                    self.assertEqual(audio.getnframes(), 2_400)


if __name__ == "__main__":
    unittest.main()
