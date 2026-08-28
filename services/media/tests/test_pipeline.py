from __future__ import annotations

import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from coderunners_media.pipeline import (
    Cue,
    CueRange,
    MediaError,
    MediaPipeline,
    RecognizedWord,
    leading_clone_spill_trim_ms,
    trim_pcm_wav_cue_lead_ins,
)


def write_silence(path: Path, duration_ms: int, sample_rate: int = 16_000) -> None:
    frame_count = duration_ms * sample_rate // 1_000
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\0\0" * frame_count)


class FakeSynthesizer:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Path | None]] = []

    def synthesize(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        speed: float,
        voice_reference_path: Path | None = None,
        voice_reference_text: str | None = None,
    ) -> None:
        self.calls.append((text, voice_reference_path))
        write_silence(output_path, 1_000)


class FakeBatchSynthesizer(FakeSynthesizer):
    def __init__(self) -> None:
        super().__init__()
        self.batch_calls: list[tuple[list[str], Path | None, str | None]] = []

    def synthesize_batch(
        self,
        jobs: list[tuple[str, Path]],
        *,
        voice: str,
        speed: float,
        voice_reference_path: Path | None,
        voice_reference_text: str | None,
    ) -> None:
        self.batch_calls.append(
            ([text for text, _output_path in jobs], voice_reference_path, voice_reference_text)
        )
        for _text, output_path in jobs:
            write_silence(output_path, 1_000)


class FakeTranscriber:
    def transcribe(self, audio_path: Path) -> list[RecognizedWord]:
        return [
            RecognizedWord("Open", 100, 250, 0.99),
            RecognizedWord("HabitRow", 300, 500, 0.98),
            RecognizedWord("Implement", 1_100, 1_350, 0.97),
            RecognizedWord("toggle", 1_400, 1_650, 0.96),
        ]


class CacheCheckingTranscriber(FakeTranscriber):
    def __init__(self, cue_cache: Path) -> None:
        self.cue_cache = cue_cache

    def transcribe(self, audio_path: Path) -> list[RecognizedWord]:
        if list(self.cue_cache.glob("*.wav")):
            raise AssertionError("Reference chunks must be removed before STT starts.")
        return super().transcribe(audio_path)


class MediaPipelineTest(unittest.TestCase):
    def test_detects_clone_leadin_only_when_requested_opening_matches(self) -> None:
        cue = Cue("intro", "Open the component and make the toggle update its state.")
        cue_range = CueRange("intro", 0, 5_000)
        words = [
            RecognizedWord("So", 100, 200, 0.99),
            RecognizedWord("many", 240, 400, 0.99),
            RecognizedWord("things", 450, 600, 0.99),
            RecognizedWord("Open", 1_800, 1_980, 0.99),
            RecognizedWord("the", 2_000, 2_120, 0.99),
            RecognizedWord("component", 2_130, 2_480, 0.99),
            RecognizedWord("and", 2_500, 2_620, 0.99),
            RecognizedWord("make", 2_640, 2_780, 0.99),
            RecognizedWord("the", 2_800, 2_910, 0.99),
            RecognizedWord("toggle", 2_930, 3_140, 0.99),
            RecognizedWord("update", 3_160, 3_360, 0.99),
            RecognizedWord("its", 3_380, 3_480, 0.99),
            RecognizedWord("state", 3_500, 3_700, 0.99),
        ]

        self.assertEqual(leading_clone_spill_trim_ms(cue, cue_range, words), 1_680)

    def test_does_not_trim_a_normal_short_pause_before_the_requested_opening(self) -> None:
        cue = Cue("intro", "Open the component and make the toggle update its state.")
        cue_range = CueRange("intro", 0, 5_000)
        words = [
            RecognizedWord("Open", 120, 280, 0.99),
            RecognizedWord("the", 300, 410, 0.99),
            RecognizedWord("component", 430, 750, 0.99),
        ]

        self.assertEqual(leading_clone_spill_trim_ms(cue, cue_range, words), 0)

    def test_removes_a_short_clone_prefix_without_leaving_it_audible(self) -> None:
        cue = Cue("intro", "A habit tracker feels broken when the preview is stale.")
        cue_range = CueRange("intro", 0, 5_000)
        words = [
            RecognizedWord("To", 0, 120, 0.99),
            RecognizedWord("a", 130, 260, 0.99),
            RecognizedWord("habit", 320, 480, 0.99),
            RecognizedWord("tracker", 500, 700, 0.99),
            RecognizedWord("feels", 720, 900, 0.99),
        ]

        self.assertEqual(leading_clone_spill_trim_ms(cue, cue_range, words), 130)

    def test_trimming_combined_audio_changes_cue_ranges_without_retaining_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            audio_path = Path(temporary_directory) / "combined.wav"
            write_silence(audio_path, 5_000)

            cue_ranges, duration_ms = trim_pcm_wav_cue_lead_ins(
                audio_path,
                [Cue("intro", "Open the component and make the toggle update its state.")],
                [CueRange("intro", 0, 5_000)],
                [1_680],
            )

            self.assertEqual(duration_ms, 3_320)
            self.assertEqual(cue_ranges, [CueRange("intro", 0, 3_320)])
            with wave.open(str(audio_path), "rb") as audio:
                self.assertEqual(audio.getnframes(), 53_120)

    def test_generates_pcm_audio_timings_and_reuses_successful_cues(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            synthesizer = FakeSynthesizer()
            pipeline = MediaPipeline(synthesizer, FakeTranscriber())
            draft = {
                "cues": [
                    {"id": "intro", "text": "Open HabitRow"},
                    {"id": "challenge", "text": "Implement toggle"},
                ]
            }

            first = pipeline.generate(
                draft=draft,
                output_directory=root / "output",
                cache_directory=root / "cache",
            )
            second = pipeline.generate(
                draft=draft,
                output_directory=root / "retry-output",
                cache_directory=root / "cache",
            )

            self.assertEqual(
                synthesizer.calls,
                [("Open HabitRow", None), ("Implement toggle", None)],
            )
            self.assertEqual(first["audio"]["format"], "pcm-wav")
            self.assertEqual(first["audio"]["durationMs"], 2_000)
            self.assertEqual(
                first["cues"],
                [
                    {"id": "intro", "startMs": 0, "endMs": 1_000},
                    {"id": "challenge", "startMs": 1_000, "endMs": 2_000},
                ],
            )
            self.assertEqual(
                [
                    (word["cueId"], word["wordIndex"], word["startMs"])
                    for word in first["timing"]["words"]
                ],
                [
                    ("intro", 0, 100),
                    ("intro", 1, 300),
                    ("challenge", 0, 1_100),
                    ("challenge", 1, 1_400),
                ],
            )
            self.assertEqual(second["audio"]["durationMs"], 2_000)
            with wave.open(first["audio"]["path"], "rb") as combined:
                self.assertEqual(combined.getnframes(), 32_000)

    def test_reference_audio_partitions_the_cue_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            first_reference = root / "first-reference.wav"
            second_reference = root / "second-reference.wav"
            first_reference.write_bytes(b"first authorized speaker")
            second_reference.write_bytes(b"second authorized speaker")
            synthesizer = FakeSynthesizer()
            pipeline = MediaPipeline(synthesizer, FakeTranscriber())
            draft = {"cues": [{"id": "intro", "text": "Open HabitRow"}]}

            pipeline.generate(
                draft=draft,
                output_directory=root / "first-output",
                cache_directory=root / "cache",
                voice_reference_path=first_reference,
            )
            pipeline.generate(
                draft=draft,
                output_directory=root / "second-output",
                cache_directory=root / "cache",
                voice_reference_path=second_reference,
            )

            self.assertEqual(
                synthesizer.calls,
                [
                    ("Open HabitRow", first_reference),
                    ("Open HabitRow", second_reference),
                ],
            )

    def test_reference_narration_batches_missing_cues_then_assembles_with_ffmpeg(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            reference = root / "authorized-reference.wav"
            reference.write_bytes(b"authorized speaker")
            synthesizer = FakeBatchSynthesizer()
            pipeline = MediaPipeline(
                synthesizer, CacheCheckingTranscriber(root / "cache" / "cues")
            )

            result = pipeline.generate(
                draft={
                    "cues": [
                        {"id": "intro", "text": "Open HabitRow"},
                        {"id": "challenge", "text": "Implement toggle"},
                    ]
                },
                output_directory=root / "output",
                cache_directory=root / "cache",
                voice_reference_path=reference,
                voice_reference_text="Authorized speaker transcript.",
            )

            self.assertEqual(
                synthesizer.batch_calls,
                [
                    (
                        ["Open HabitRow", "Implement toggle"],
                        reference,
                        "Authorized speaker transcript.",
                    )
                ],
            )
            self.assertEqual(result["audio"]["durationMs"], 2_000)
            self.assertTrue(Path(result["audio"]["path"]).is_file())
            self.assertEqual(list((root / "cache" / "cues").glob("*.wav")), [])

    def test_reference_chunks_survive_an_ffmpeg_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            reference = root / "authorized-reference.wav"
            reference.write_bytes(b"authorized speaker")
            pipeline = MediaPipeline(FakeBatchSynthesizer(), FakeTranscriber())

            with patch(
                "coderunners_media.pipeline.subprocess.run",
                side_effect=subprocess.CalledProcessError(1, ["ffmpeg"]),
            ), self.assertRaisesRegex(MediaError, "FFmpeg could not assemble"):
                pipeline.generate(
                    draft={"cues": [{"id": "intro", "text": "Open HabitRow"}]},
                    output_directory=root / "output",
                    cache_directory=root / "cache",
                    voice_reference_path=reference,
                    voice_reference_text="Authorized speaker transcript.",
                )

            self.assertEqual(len(list((root / "cache" / "cues").glob("*.wav"))), 1)


if __name__ == "__main__":
    unittest.main()
