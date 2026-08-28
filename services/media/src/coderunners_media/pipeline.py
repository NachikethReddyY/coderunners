from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import unicodedata
import wave
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Protocol
from uuid import uuid4


@dataclass(frozen=True)
class RecognizedWord:
    text: str
    start_ms: int
    end_ms: int
    confidence: float


class Synthesizer(Protocol):
    def synthesize(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        speed: float,
        voice_reference_path: Path | None = None,
        voice_reference_text: str | None = None,
    ) -> None: ...


class Transcriber(Protocol):
    def transcribe(self, audio_path: Path) -> list[RecognizedWord]: ...


class MediaError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class Cue:
    id: str
    text: str


@dataclass(frozen=True)
class CueRange:
    id: str
    start_ms: int
    end_ms: int


ProgressCallback = Callable[[dict[str, object]], None]
LEAD_IN_MINIMUM_MS = 500
LEAD_IN_KEEP_BEFORE_TARGET_MS = 120
LEAD_IN_MINIMUM_MATCHING_WORDS = 3


class MediaPipeline:
    def __init__(self, synthesizer: Synthesizer, transcriber: Transcriber) -> None:
        self.synthesizer = synthesizer
        self.transcriber = transcriber

    def generate(
        self,
        *,
        draft: object,
        output_directory: Path,
        cache_directory: Path,
        voice: str = "af_heart",
        speed: float = 1.0,
        voice_reference_path: Path | None = None,
        voice_reference_text: str | None = None,
        progress: ProgressCallback | None = None,
    ) -> dict[str, object]:
        cues = parse_cues(draft)
        if not output_directory.is_absolute() or not cache_directory.is_absolute():
            raise MediaError(
                "INVALID_REQUEST",
                "Media output and cache directories must be absolute paths.",
                retryable=False,
            )

        output_directory.mkdir(parents=True, exist_ok=True)
        cue_cache = cache_directory / "cues"
        cue_cache.mkdir(parents=True, exist_ok=True)
        reference_fingerprint = reference_prompt_fingerprint(
            voice_reference_path, voice_reference_text
        )
        emit = progress or (lambda _: None)
        clip_paths: list[Path] = []

        pending: list[tuple[Cue, Path, Path]] = []
        for index, cue in enumerate(cues):
            cache_key = cue_cache_key(cue, voice, speed, reference_fingerprint)
            cache_path = cue_cache / f"{cache_key}.wav"
            cached = is_pcm_wav(cache_path)
            emit(
                {
                    "phase": "synthesis",
                    "cueId": cue.id,
                    "completed": index,
                    "total": len(cues),
                    "cached": cached,
                }
            )
            if not cached:
                temporary_path = cache_path.with_name(f".{cache_path.stem}-{uuid4().hex}.tmp.wav")
                pending.append((cue, temporary_path, cache_path))
            clip_paths.append(cache_path)

        self._synthesize_pending(
            pending,
            voice=voice,
            speed=speed,
            voice_reference_path=voice_reference_path,
            voice_reference_text=voice_reference_text,
        )

        emit({"phase": "assembly", "completed": len(cues), "total": len(cues)})
        audio_path = output_directory / "codecast.wav"
        cue_ranges, duration_ms = concatenate_pcm_wavs(clip_paths, cues, audio_path)
        if voice_reference_path is not None:
            # The source chunks are no longer needed once FFmpeg has made one valid WAV.
            # Keep the correction pass on that WAV so temporary chunks cannot accumulate.
            delete_temporary_reference_chunks(clip_paths)
            preliminary_words = self._transcribe(audio_path)
            trimmed, cue_ranges, duration_ms = trim_clone_lead_ins(
                cues, cue_ranges, preliminary_words, audio_path
            )
            if trimmed:
                preliminary_words = self._transcribe(audio_path)

        emit({"phase": "transcription", "completed": 0, "total": 1})
        if voice_reference_path is not None:
            recognized_words = preliminary_words
        else:
            recognized_words = self._transcribe(audio_path)

        timing = align_canonical_words(cues, cue_ranges, recognized_words, duration_ms)
        emit({"phase": "complete", "completed": 1, "total": 1})
        return {
            "audio": {
                "path": str(audio_path),
                "format": "pcm-wav",
                "durationMs": duration_ms,
            },
            "cues": [
                {"id": cue.id, "startMs": cue.start_ms, "endMs": cue.end_ms}
                for cue in cue_ranges
            ],
            "timing": timing,
        }

    def _transcribe(self, audio_path: Path) -> list[RecognizedWord]:
        try:
            return self.transcriber.transcribe(audio_path)
        except Exception as error:
            raise MediaError(
                "TRANSCRIPTION_FAILED",
                "The combined narration could not be transcribed.",
                retryable=True,
            ) from error

    def _synthesize_pending(
        self,
        pending: list[tuple[Cue, Path, Path]],
        *,
        voice: str,
        speed: float,
        voice_reference_path: Path | None,
        voice_reference_text: str | None,
    ) -> None:
        if not pending:
            return
        try:
            synthesize_batch = getattr(self.synthesizer, "synthesize_batch", None)
            if voice_reference_path is not None and callable(synthesize_batch):
                synthesize_batch(
                    [(cue.text, temporary_path) for cue, temporary_path, _cache_path in pending],
                    voice=voice,
                    speed=speed,
                    voice_reference_path=voice_reference_path,
                    voice_reference_text=voice_reference_text,
                )
            else:
                for cue, temporary_path, _cache_path in pending:
                    self.synthesizer.synthesize(
                        cue.text,
                        temporary_path,
                        voice=voice,
                        speed=speed,
                        voice_reference_path=voice_reference_path,
                        voice_reference_text=voice_reference_text,
                    )
            for cue, temporary_path, cache_path in pending:
                if not is_pcm_wav(temporary_path):
                    raise MediaError(
                        "SYNTHESIS_FAILED",
                        f"Cue {cue.id} did not produce valid PCM WAV audio.",
                        retryable=True,
                    )
                os.replace(temporary_path, cache_path)
        except MediaError:
            raise
        except Exception as error:
            raise MediaError(
                "SYNTHESIS_FAILED",
                "One or more narration chunks could not be synthesized.",
                retryable=True,
            ) from error
        finally:
            for _cue, temporary_path, _cache_path in pending:
                temporary_path.unlink(missing_ok=True)


def concatenate_pcm_wavs(
    clip_paths: list[Path],
    cues: list[Cue],
    output_path: Path,
) -> tuple[list[CueRange], int]:
    if len(clip_paths) != len(cues) or not clip_paths:
        raise MediaError("INVALID_REQUEST", "At least one cue is required.", retryable=False)

    temporary_path = output_path.with_name(f".{output_path.stem}-{uuid4().hex}.tmp.wav")
    manifest_path = output_path.with_name(f".{output_path.stem}-{uuid4().hex}.concat.txt")
    cue_ranges: list[CueRange] = []
    total_frames = 0
    expected_format: tuple[int, int, int, str] | None = None
    try:
        for path, cue in zip(clip_paths, cues, strict=True):
            with wave.open(str(path), "rb") as clip:
                current_format = (
                    clip.getnchannels(),
                    clip.getsampwidth(),
                    clip.getframerate(),
                    clip.getcomptype(),
                )
                if expected_format is None:
                    expected_format = current_format
                elif current_format != expected_format:
                    raise MediaError(
                        "AUDIO_FORMAT_MISMATCH",
                        "Every synthesized cue must use the same PCM WAV format.",
                        retryable=True,
                    )
                start_ms = frames_to_ms(total_frames, current_format[2])
                total_frames += clip.getnframes()
                cue_ranges.append(
                    CueRange(cue.id, start_ms, frames_to_ms(total_frames, current_format[2]))
                )

        manifest_path.write_text(
            "".join(ffmpeg_concat_line(path) for path in clip_paths),
            encoding="utf-8",
        )
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                "-i", str(manifest_path), "-c:a", "pcm_s16le", str(temporary_path),
            ],
            check=True,
        )
        if not is_pcm_wav(temporary_path):
            raise MediaError(
                "SYNTHESIS_FAILED",
                "FFmpeg did not produce combined PCM WAV audio.",
                retryable=True,
            )
        os.replace(temporary_path, output_path)
    except FileNotFoundError as error:
        raise MediaError(
            "FFMPEG_UNAVAILABLE",
            "FFmpeg is required to assemble narration.",
            retryable=False,
        ) from error
    except subprocess.CalledProcessError as error:
        raise MediaError(
            "ASSEMBLY_FAILED",
            "FFmpeg could not assemble narration chunks.",
            retryable=True,
        ) from error
    finally:
        temporary_path.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)

    if expected_format is None:
        raise MediaError("SYNTHESIS_FAILED", "No cue audio was produced.", retryable=True)
    return cue_ranges, frames_to_ms(total_frames, expected_format[2])


def ffmpeg_concat_line(path: Path) -> str:
    escaped_path = path.as_posix().replace("'", "'\\''")
    return f"file '{escaped_path}'\n"


def delete_temporary_reference_chunks(clip_paths: list[Path]) -> None:
    for path in clip_paths:
        path.unlink(missing_ok=True)


def trim_clone_lead_ins(
    cues: list[Cue],
    cue_ranges: list[CueRange],
    recognized_words: list[RecognizedWord],
    audio_path: Path,
) -> tuple[bool, list[CueRange], int]:
    """Remove Qwen's occasional reference-style opening before requested narration."""
    trim_by_cue = [
        leading_clone_spill_trim_ms(cue, cue_range, recognized_words)
        for cue, cue_range in zip(cues, cue_ranges, strict=True)
    ]
    if not any(trim_by_cue):
        return False, cue_ranges, cue_ranges[-1].end_ms
    trimmed_ranges, duration_ms = trim_pcm_wav_cue_lead_ins(
        audio_path, cues, cue_ranges, trim_by_cue
    )
    return True, trimmed_ranges, duration_ms


def leading_clone_spill_trim_ms(
    cue: Cue,
    cue_range: CueRange,
    recognized_words: list[RecognizedWord],
) -> int:
    """Return the safe amount to remove before a confidently matched cue opening."""
    canonical = [normalize_word(word) for word in tokenize(cue.text)]
    required_match = min(LEAD_IN_MINIMUM_MATCHING_WORDS, len(canonical))
    if required_match < LEAD_IN_MINIMUM_MATCHING_WORDS:
        return 0
    recognized = [
        word
        for word in recognized_words
        if cue_range.start_ms <= word.start_ms < cue_range.end_ms
    ]
    matcher = SequenceMatcher(
        None,
        canonical,
        [normalize_word(word.text) for word in recognized],
        autojunk=False,
    )
    for block in matcher.get_matching_blocks():
        if block.a != 0 or block.size < required_match:
            continue
        target_start_ms = recognized[block.b].start_ms
        lead_in_ms = target_start_ms - cue_range.start_ms
        # A recognized word before the matched script opening is always spill,
        # even when it is only a very short Qwen prefix such as "To".
        if block.b > 0:
            return (
                lead_in_ms
                if lead_in_ms < LEAD_IN_MINIMUM_MS
                else lead_in_ms - LEAD_IN_KEEP_BEFORE_TARGET_MS
            )
        if lead_in_ms < LEAD_IN_MINIMUM_MS:
            return 0
        # A tiny prefix such as Qwen's "To a" is not a natural pause: remove it
        # entirely. Longer reference-style spill keeps a brief lead-in so words
        # do not begin abruptly after the splice.
        keep_before_target_ms = (
            0 if lead_in_ms < LEAD_IN_MINIMUM_MS else LEAD_IN_KEEP_BEFORE_TARGET_MS
        )
        return max(0, lead_in_ms - keep_before_target_ms)
    return 0


def trim_pcm_wav_cue_lead_ins(
    path: Path,
    cues: list[Cue],
    cue_ranges: list[CueRange],
    trim_by_cue: list[int],
) -> tuple[list[CueRange], int]:
    """Atomically remove detected lead-ins from each cue in a combined PCM WAV."""
    if len(cues) != len(cue_ranges) or len(cues) != len(trim_by_cue):
        raise MediaError("INVALID_REQUEST", "Cue trimming inputs must match.", retryable=False)
    temporary_path = path.with_name(f".{path.stem}-{uuid4().hex}.trim.wav")
    trimmed_ranges: list[CueRange] = []
    total_frames = 0
    try:
        with wave.open(str(path), "rb") as source:
            if source.getcomptype() != "NONE":
                raise MediaError(
                    "AUDIO_FORMAT_MISMATCH",
                    "Only PCM WAV narration chunks can be trimmed.",
                    retryable=True,
                )
            with wave.open(str(temporary_path), "wb") as output:
                output.setparams(source.getparams())
                for cue, cue_range, trim_ms in zip(
                    cues, cue_ranges, trim_by_cue, strict=True
                ):
                    cue_start_frame = cue_range.start_ms * source.getframerate() // 1_000
                    cue_end_frame = cue_range.end_ms * source.getframerate() // 1_000
                    frames_to_skip = trim_ms * source.getframerate() // 1_000
                    source_start_frame = cue_start_frame + frames_to_skip
                    if source_start_frame >= cue_end_frame:
                        raise MediaError(
                            "SYNTHESIS_FAILED",
                            "Removing the clone lead-in would empty a narration chunk.",
                            retryable=True,
                        )
                    source.setpos(source_start_frame)
                    retained_frames = cue_end_frame - source_start_frame
                    output.writeframes(source.readframes(retained_frames))
                    start_ms = frames_to_ms(total_frames, source.getframerate())
                    total_frames += retained_frames
                    trimmed_ranges.append(
                        CueRange(
                            cue.id,
                            start_ms,
                            frames_to_ms(total_frames, source.getframerate()),
                        )
                    )
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return trimmed_ranges, frames_to_ms(total_frames, source.getframerate())


def align_canonical_words(
    cues: list[Cue],
    cue_ranges: list[CueRange],
    recognized_words: list[RecognizedWord],
    duration_ms: int,
) -> dict[str, object]:
    aligned: list[dict[str, object]] = []
    matched_count = 0
    confidence_total = 0.0

    for cue, cue_range in zip(cues, cue_ranges, strict=True):
        canonical = tokenize(cue.text)
        recognized = [
            word
            for word in recognized_words
            if cue_range.start_ms <= word.start_ms < cue_range.end_ms
        ]
        matcher = SequenceMatcher(
            None,
            [normalize_word(word) for word in canonical],
            [normalize_word(word.text) for word in recognized],
            autojunk=False,
        )
        matches: dict[int, RecognizedWord] = {}
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                matches[block.a + offset] = recognized[block.b + offset]

        for word_index, _word in enumerate(canonical):
            match = matches.get(word_index)
            if match is None:
                start_ms, end_ms = estimated_word_range(word_index, len(canonical), cue_range)
                confidence = 0.0
            else:
                start_ms = match.start_ms
                end_ms = match.end_ms
                confidence = match.confidence
                matched_count += 1
                confidence_total += match.confidence
            aligned.append(
                {
                    "cueId": cue.id,
                    "wordIndex": word_index,
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "confidence": round(confidence, 4),
                }
            )

    if not aligned or matched_count / len(aligned) < 0.6:
        raise MediaError(
            "ALIGNMENT_LOW_CONFIDENCE",
            "Narration words could not be aligned safely to the canonical script.",
            retryable=True,
        )
    alignment_confidence = (matched_count / len(aligned)) * (confidence_total / matched_count)
    return {
        "schemaVersion": 1,
        "durationMs": duration_ms,
        "alignmentConfidence": round(alignment_confidence, 4),
        "words": aligned,
    }


def parse_cues(draft: object) -> list[Cue]:
    if not isinstance(draft, dict) or not isinstance(draft.get("cues"), list):
        raise MediaError(
            "INVALID_REQUEST",
            "A validated lesson draft is required.",
            retryable=False,
        )
    cues: list[Cue] = []
    seen_ids: set[str] = set()
    for raw_cue in draft["cues"]:
        if not isinstance(raw_cue, dict):
            raise MediaError("INVALID_REQUEST", "Every cue must be an object.", retryable=False)
        cue_id = raw_cue.get("id")
        text = raw_cue.get("text")
        if (
            not isinstance(cue_id, str)
            or re.fullmatch(r"[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?", cue_id) is None
            or cue_id in seen_ids
            or not isinstance(text, str)
            or not text.strip()
        ):
            raise MediaError("INVALID_REQUEST", "Cue ids and text must be valid.", retryable=False)
        seen_ids.add(cue_id)
        cues.append(Cue(cue_id, text.strip()))
    if not cues:
        raise MediaError("INVALID_REQUEST", "At least one cue is required.", retryable=False)
    return cues


def cue_cache_key(
    cue: Cue,
    voice: str,
    speed: float,
    reference_fingerprint: str | None = None,
) -> str:
    payload = json.dumps(
        {
            "model": "mlx-community/Kokoro-82M-8bit",
            "voice": voice,
            "speed": speed,
            "referenceFingerprint": reference_fingerprint,
            "text": cue.text,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def reference_prompt_fingerprint(
    voice_reference_path: Path | None,
    voice_reference_text: str | None,
) -> str | None:
    if voice_reference_path is None:
        return None
    if not voice_reference_path.is_file():
        raise MediaError(
            "REFERENCE_AUDIO_UNAVAILABLE",
            "Reference audio was not found.",
            retryable=False,
        )
    digest = hashlib.sha256()
    with voice_reference_path.open("rb") as reference_audio:
        for chunk in iter(lambda: reference_audio.read(1_048_576), b""):
            digest.update(chunk)
    if voice_reference_text is not None:
        digest.update(voice_reference_text.encode())
    return digest.hexdigest()


def reference_audio_fingerprint(voice_reference_path: Path | None) -> str | None:
    """Backward-compatible audio-only reference cache identity."""
    return reference_prompt_fingerprint(voice_reference_path, None)


def is_pcm_wav(path: Path) -> bool:
    try:
        with wave.open(str(path), "rb") as audio:
            return (
                audio.getcomptype() == "NONE"
                and audio.getnchannels() > 0
                and audio.getsampwidth() > 0
                and audio.getframerate() > 0
                and audio.getnframes() > 0
            )
    except (FileNotFoundError, EOFError, wave.Error):
        return False


def tokenize(text: str) -> list[str]:
    return re.findall(r"[^\W_]+(?:['’][^\W_]+)*", text, flags=re.UNICODE)


def normalize_word(word: str) -> str:
    normalized = unicodedata.normalize("NFKD", word).casefold()
    return "".join(character for character in normalized if character.isalnum())


def estimated_word_range(index: int, count: int, cue: CueRange) -> tuple[int, int]:
    duration = cue.end_ms - cue.start_ms
    return (
        cue.start_ms + round(duration * index / count),
        cue.start_ms + round(duration * (index + 1) / count),
    )


def frames_to_ms(frame_count: int, sample_rate: int) -> int:
    return round(frame_count * 1_000 / sample_rate)
