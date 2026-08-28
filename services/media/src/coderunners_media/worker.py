from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from .pipeline import MediaError
from .providers import MlxKokoroSynthesizer, MlxWhisperTranscriber


class Pipeline(Protocol):
    def generate(self, **options: object) -> dict[str, object]: ...


Emitter = Callable[[dict[str, object]], None]


def handle_request(
    request: object,
    pipeline: Pipeline,
    emit: Emitter | None = None,
) -> dict[str, object]:
    request_id = request.get("id") if isinstance(request, dict) else None
    if not isinstance(request, dict) or request.get("method") != "media.generate":
        return error_response(
            request_id,
            "METHOD_NOT_FOUND",
            "Use the media.generate method.",
            retryable=False,
        )

    params = request.get("params")
    if not isinstance(request_id, str) or not isinstance(params, dict):
        return error_response(
            request_id,
            "INVALID_REQUEST",
            "A request id and media parameters are required.",
            retryable=False,
        )
    output_directory = params.get("outputDirectory")
    cache_directory = params.get("cacheDirectory")
    voice = params.get("voice", "af_heart")
    voice_reference_path = params.get("referenceAudioPath")
    voice_reference_text = params.get("referenceText")
    speed = params.get("speed", 1.0)
    if (
        not isinstance(output_directory, str)
        or not Path(output_directory).is_absolute()
        or (cache_directory is not None and not isinstance(cache_directory, str))
        or (isinstance(cache_directory, str) and not Path(cache_directory).is_absolute())
        or not isinstance(voice, str)
        or (
            voice_reference_path is not None
            and (
                not isinstance(voice_reference_path, str)
                or not Path(voice_reference_path).is_absolute()
            )
        )
        or (voice_reference_text is not None and not isinstance(voice_reference_text, str))
        or not isinstance(speed, (int, float))
        or isinstance(speed, bool)
        or not 0.5 <= float(speed) <= 2.0
    ):
        return error_response(
            request_id,
            "INVALID_REQUEST",
            "Use absolute media paths, an optional absolute reference audio path, a voice name, "
            "and a speed from 0.5 to 2.0.",
            retryable=False,
        )

    progress_emitter = emit or (lambda _: None)

    def progress(event: dict[str, object]) -> None:
        progress_emitter({"id": request_id, "event": "progress", **event})

    try:
        result = pipeline.generate(
            draft=params.get("draft"),
            output_directory=Path(output_directory),
            cache_directory=(
                Path(cache_directory)
                if isinstance(cache_directory, str)
                else Path.home() / ".cache" / "coderunners" / "media"
            ),
            voice=voice,
            speed=float(speed),
            voice_reference_path=(
                Path(voice_reference_path) if isinstance(voice_reference_path, str) else None
            ),
            voice_reference_text=(
                voice_reference_text if isinstance(voice_reference_text, str) else None
            ),
            progress=progress,
        )
        return {"id": request_id, "ok": True, "result": result}
    except MediaError as error:
        return error_response(
            request_id,
            error.code,
            error.message,
            retryable=error.retryable,
        )
    except Exception:
        return error_response(
            request_id,
            "MEDIA_FAILED",
            "The local media worker stopped unexpectedly.",
            retryable=True,
        )


def main() -> None:
    if sys.argv[1:] == ["--check"]:
        return

    from .pipeline import MediaPipeline

    pipeline = MediaPipeline(MlxKokoroSynthesizer(), MlxWhisperTranscriber())

    def emit(record: dict[str, object]) -> None:
        sys.stdout.write(f"{json.dumps(record, separators=(',', ':'))}\n")
        sys.stdout.flush()

    for line in sys.stdin:
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            emit(
                error_response(
                    None,
                    "INVALID_JSON",
                    "Send one JSON request per line.",
                    retryable=False,
                )
            )
            continue
        emit(handle_request(request, pipeline, emit))


def error_response(
    request_id: object,
    code: str,
    message: str,
    *,
    retryable: bool,
) -> dict[str, object]:
    return {
        "id": request_id,
        "ok": False,
        "error": {"code": code, "message": message, "retryable": retryable},
    }
