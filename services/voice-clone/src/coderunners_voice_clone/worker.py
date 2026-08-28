from __future__ import annotations

import contextlib
import json
import math
import platform
import re
import subprocess
import sys
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

GIB = 1024**3
QWEN_MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-6bit"
HEADROOM_BYTES = 2 * GIB
# Qwen keeps reference codes alongside model weights during ICL generation.
MODEL_WORKING_SET_BYTES = 5 * GIB
REFERENCE_SECOND_WORKING_SET_BYTES = GIB // 8
GROUP_BASE_WORKING_SET_BYTES = 3 * GIB
SENTENCE_WORKING_SET_BYTES = GIB
# One sentence per request makes the spoken walkthrough breathe and lets the
# code projection advance with the teaching beat instead of arriving in blocks.
MAX_SENTENCES_PER_GROUP = 1
SENTENCE_PAUSE_MS = 260


class VoiceCloneError(Exception):
    pass


def available_memory_bytes() -> int:
    """Return conservatively free unified memory, without treating file cache as free."""
    if platform.system() == "Darwin":
        output = subprocess.check_output(["vm_stat"], text=True)
        page_size_match = re.search(r"page size of (\d+) bytes", output)
        free_match = re.search(r"Pages free:\s+(\d+)", output)
        if page_size_match is None or free_match is None:
            raise VoiceCloneError("Could not determine available unified memory.")
        return int(page_size_match.group(1)) * int(free_match.group(1))
    raise VoiceCloneError("Qwen batch admission currently requires macOS unified-memory metrics.")


def narration_memory_budget(available_bytes: int, reference_duration_seconds: float) -> int:
    reference_working_set = math.ceil(reference_duration_seconds) * REFERENCE_SECOND_WORKING_SET_BYTES
    return available_bytes - HEADROOM_BYTES - MODEL_WORKING_SET_BYTES - reference_working_set


def max_sentences_per_group(available_bytes: int, reference_duration_seconds: float = 60) -> int:
    budget = narration_memory_budget(available_bytes, reference_duration_seconds)
    if budget < GROUP_BASE_WORKING_SET_BYTES + SENTENCE_WORKING_SET_BYTES:
        raise VoiceCloneError(
            "Not enough free unified memory to reserve 2 GiB headroom for Qwen narration."
        )
    return min(
        MAX_SENTENCES_PER_GROUP,
        max(1, (budget - GROUP_BASE_WORKING_SET_BYTES) // SENTENCE_WORKING_SET_BYTES),
    )


def admitted_batch_size(
    available_bytes: int,
    reference_duration_seconds: float = 60,
    sentences_per_group: int = MAX_SENTENCES_PER_GROUP,
) -> int:
    """Choose a memory-admitted batch while retaining 2 GiB for the system."""
    if not 1 <= sentences_per_group <= MAX_SENTENCES_PER_GROUP:
        raise VoiceCloneError("Narration groups must contain one to four sentences.")
    budget = narration_memory_budget(available_bytes, reference_duration_seconds)
    group_working_set = GROUP_BASE_WORKING_SET_BYTES + (
        sentences_per_group * SENTENCE_WORKING_SET_BYTES
    )
    if budget < group_working_set:
        raise VoiceCloneError(
            "Not enough free unified memory to reserve 2 GiB headroom for Qwen narration."
        )
    return max(1, budget // group_working_set)


def reference_duration_seconds(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as reference:
            if reference.getframerate() <= 0:
                raise ValueError("Reference WAV has no sample rate.")
            return reference.getnframes() / reference.getframerate()
    except (OSError, wave.Error, ValueError) as error:
        raise VoiceCloneError("Could not determine the reference WAV duration.") from error


def narration_groups(text: str, max_sentences: int = MAX_SENTENCES_PER_GROUP) -> list[str]:
    """Keep each Qwen request short without changing the authored cue order."""
    sentences = [
        sentence.strip()
        for sentence in re.findall(r".+?(?:[.!?]+(?=\s|$)|$)", text.strip())
        if sentence.strip()
    ]
    if not sentences:
        raise VoiceCloneError("Narration text must contain at least one sentence.")
    return [" ".join(sentences[index : index + max_sentences]) for index in range(0, len(sentences), max_sentences)]


def clear_generation_cache() -> None:
    """Release MLX's transient generation tensors between sequential narration groups."""
    try:
        import mlx.core as mx

        mx.clear_cache()
    except ImportError:
        return


@dataclass(frozen=True)
class NarrationPart:
    text: str
    output_path: Path
    original_output_path: Path


class QwenVoiceClone:
    def __init__(
        self,
        *,
        model_loader: Callable[[], Any] | None = None,
        memory_reader: Callable[[], int] = available_memory_bytes,
        reference_duration_reader: Callable[[Path], float] = reference_duration_seconds,
        cache_clearer: Callable[[], None] = clear_generation_cache,
    ) -> None:
        self._model: Any | None = None
        self._model_loader = model_loader or self._load_model
        self._memory_reader = memory_reader
        self._reference_duration_reader = reference_duration_reader
        self._cache_clearer = cache_clearer

    def synthesize(
        self,
        text: str,
        output_path: Path,
        reference_audio_path: Path,
        reference_text: str,
    ) -> None:
        self.synthesize_batch([(text, output_path)], reference_audio_path, reference_text)

    def synthesize_batch(
        self,
        jobs: list[tuple[str, Path]],
        reference_audio_path: Path,
        reference_text: str,
    ) -> None:
        if not reference_text.strip():
            raise VoiceCloneError("Qwen voice cloning requires the reference transcript.")
        if not jobs:
            raise VoiceCloneError("At least one narration chunk is required.")
        available_bytes = self._memory_reader()
        reference_duration = self._reference_duration_reader(reference_audio_path)
        sentences_per_group = max_sentences_per_group(available_bytes, reference_duration)
        parts = expand_narration_parts(jobs, sentences_per_group)
        batch_size = min(
            len(parts),
            admitted_batch_size(available_bytes, reference_duration, sentences_per_group),
        )
        model = self._get_model()
        try:
            for offset in range(0, len(parts), batch_size):
                batch = parts[offset : offset + batch_size]
                outputs: dict[int, Any] = {}
                with contextlib.redirect_stdout(sys.stderr):
                    for result in model.batch_generate(
                        [part.text for part in batch],
                        ref_audio=str(reference_audio_path),
                        ref_text=reference_text,
                        lang_code="en",
                        stream=False,
                    ):
                        outputs[int(result.sequence_idx)] = result.audio
                if len(outputs) != len(batch):
                    raise VoiceCloneError("Qwen did not produce every requested narration chunk.")
                for index, part in enumerate(batch):
                    self._write_pcm_wav(part.output_path, outputs[index], int(model.sample_rate))
                outputs.clear()
                self._cache_clearer()
            combine_narration_parts(parts)
        except VoiceCloneError:
            raise
        except Exception as error:
            raise VoiceCloneError("Qwen could not synthesize the narration batch.") from error
        finally:
            for part in parts:
                if part.output_path != part.original_output_path:
                    part.output_path.unlink(missing_ok=True)

    def _get_model(self) -> Any:
        if self._model is None:
            self._model = self._model_loader()
        return self._model

    @staticmethod
    def _load_model() -> Any:
        try:
            from huggingface_hub import snapshot_download
            from mlx_audio.tts.utils import load_model

            model_path = snapshot_download(QWEN_MODEL_ID, local_files_only=True)
            with contextlib.redirect_stdout(sys.stderr):
                return load_model(Path(model_path))
        except Exception as error:
            raise VoiceCloneError(
                "The local Qwen 0.6B Base Q6 model is unavailable. Download it before rendering."
            ) from error

    @staticmethod
    def _write_pcm_wav(output_path: Path, audio: Any, sample_rate: int) -> None:
        try:
            import numpy as np

            samples = np.asarray(audio, dtype=np.float32).reshape(-1)
            if samples.size == 0:
                raise ValueError("Qwen returned empty audio.")
            pcm = (np.clip(samples, -1.0, 1.0) * 32_767).astype("<i2")
            with wave.open(str(output_path), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(sample_rate)
                output.writeframes(pcm.tobytes())
        except Exception as error:
            raise VoiceCloneError("Qwen could not write a narration chunk.") from error


def expand_narration_parts(
    jobs: list[tuple[str, Path]], max_sentences: int
) -> list[NarrationPart]:
    parts: list[NarrationPart] = []
    for text, output_path in jobs:
        groups = narration_groups(text, max_sentences)
        for index, group in enumerate(groups):
            part_path = output_path
            if len(groups) > 1:
                part_path = output_path.with_name(
                    f".{output_path.stem}-{index}-{uuid4().hex}.part.wav"
                )
            parts.append(NarrationPart(group, part_path, output_path))
    return parts


def combine_narration_parts(parts: list[NarrationPart]) -> None:
    grouped: dict[Path, list[Path]] = {}
    for part in parts:
        grouped.setdefault(part.original_output_path, []).append(part.output_path)
    for output_path, part_paths in grouped.items():
        if len(part_paths) == 1:
            continue
        temporary_path = output_path.with_name(f".{output_path.stem}-{uuid4().hex}.join.wav")
        try:
            expected_format: tuple[int, int, int, str] | None = None
            with wave.open(str(temporary_path), "wb") as output:
                for part_path in part_paths:
                    with wave.open(str(part_path), "rb") as part:
                        current_format = (
                            part.getnchannels(),
                            part.getsampwidth(),
                            part.getframerate(),
                            part.getcomptype(),
                        )
                        if expected_format is None:
                            expected_format = current_format
                            output.setparams(part.getparams())
                        elif current_format != expected_format:
                            raise VoiceCloneError("Qwen narration groups used different WAV formats.")
                        output.writeframes(part.readframes(part.getnframes()))
                    if part_path != part_paths[-1]:
                        pause_frames = int(current_format[2] * SENTENCE_PAUSE_MS / 1_000)
                        output.writeframes(b"\0" * pause_frames * current_format[0] * current_format[1])
            temporary_path.replace(output_path)
        finally:
            temporary_path.unlink(missing_ok=True)


def handle_request(request: object, model: QwenVoiceClone) -> dict[str, object]:
    request_id = request.get("id") if isinstance(request, dict) else None
    if not isinstance(request, dict) or request.get("method") not in {
        "voice-clone.synthesize",
        "voice-clone.synthesize-batch",
    }:
        return error_response(request_id, "METHOD_NOT_FOUND", "Use a voice-clone synthesis method.")
    params = request.get("params")
    if not isinstance(request_id, str) or not isinstance(params, dict):
        return error_response(request_id, "INVALID_REQUEST", "A request id and parameters are required.")
    reference_audio_path = params.get("referenceAudioPath")
    reference_text = params.get("referenceText")
    if (
        not isinstance(reference_audio_path, str)
        or not Path(reference_audio_path).is_absolute()
        or not Path(reference_audio_path).is_file()
        or not isinstance(reference_text, str)
        or not reference_text.strip()
    ):
        return error_response(
            request_id,
            "INVALID_REQUEST",
            "Use an existing absolute reference audio path and its transcript.",
        )
    try:
        jobs = parse_jobs(request["method"], params)
        model.synthesize_batch(jobs, Path(reference_audio_path), reference_text)
        return {"id": request_id, "ok": True}
    except VoiceCloneError as error:
        return error_response(request_id, "SYNTHESIS_FAILED", str(error))


def parse_jobs(method: str, params: dict[str, object]) -> list[tuple[str, Path]]:
    raw_jobs: list[object]
    if method == "voice-clone.synthesize":
        raw_jobs = [{"text": params.get("text"), "outputPath": params.get("outputPath")}]
    else:
        jobs = params.get("jobs")
        if not isinstance(jobs, list):
            raise VoiceCloneError("Batch synthesis requires a jobs array.")
        raw_jobs = jobs
    parsed: list[tuple[str, Path]] = []
    for raw_job in raw_jobs:
        if not isinstance(raw_job, dict):
            raise VoiceCloneError("Every narration job must be an object.")
        text = raw_job.get("text")
        output_path = raw_job.get("outputPath")
        if (
            not isinstance(text, str)
            or not text.strip()
            or not isinstance(output_path, str)
            or not Path(output_path).is_absolute()
        ):
            raise VoiceCloneError("Every narration job needs text and an absolute output path.")
        parsed.append((text.strip(), Path(output_path)))
    if not parsed:
        raise VoiceCloneError("At least one narration job is required.")
    return parsed


def error_response(request_id: object, code: str, message: str) -> dict[str, object]:
    return {"id": request_id, "ok": False, "error": {"code": code, "message": message}}


def main() -> None:
    model = QwenVoiceClone()
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = error_response(None, "INVALID_JSON", "Send one JSON request per line.")
        else:
            response = handle_request(request, model)
        sys.stdout.write(f"{json.dumps(response, separators=(',', ':'))}\n")
        sys.stdout.flush()
