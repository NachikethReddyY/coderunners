from __future__ import annotations

import contextlib
import json
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

from .pipeline import MediaError, RecognizedWord


class MlxKokoroSynthesizer:
    def __init__(
        self,
        model_id: str = "mlx-community/Kokoro-82M-8bit",
        language: str = "a",
    ) -> None:
        self.model_id = model_id
        self.language = language
        self._model: Any | None = None
        self._voice_clone: LocalVoiceCloneSynthesizer | None = None

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
        if voice_reference_path is not None:
            self._voice_clone_for(voice_reference_path, voice_reference_text).synthesize(
                text, output_path
            )
            return
        try:
            import numpy as np
            from mlx_audio.tts.utils import load_model

            with contextlib.redirect_stdout(sys.stderr):
                if self._model is None:
                    self._model = load_model(self.model_id)
                results = list(
                    self._model.generate(
                        text=text,
                        voice=voice,
                        speed=speed,
                        lang_code=self.language,
                    )
                )
            chunks = [np.asarray(result.audio, dtype=np.float32).reshape(-1) for result in results]
            if not chunks:
                raise ValueError("Kokoro returned no audio.")
            waveform = np.concatenate(chunks)
            pcm = (np.clip(waveform, -1.0, 1.0) * 32_767).astype("<i2")
            sample_rate = int(getattr(self._model, "sample_rate", 24_000))
            with wave.open(str(output_path), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(sample_rate)
                audio.writeframes(pcm.tobytes())
        except Exception as error:
            raise MediaError(
                "MODEL_UNAVAILABLE",
                "Kokoro could not generate local narration.",
                retryable=True,
            ) from error

    def synthesize_batch(
        self,
        jobs: list[tuple[str, Path]],
        *,
        voice: str,
        speed: float,
        voice_reference_path: Path | None,
        voice_reference_text: str | None,
    ) -> None:
        if voice_reference_path is None:
            raise MediaError(
                "INVALID_REQUEST",
                "Reference narration batching requires reference audio.",
                retryable=False,
            )
        self._voice_clone_for(voice_reference_path, voice_reference_text).synthesize_batch(
            jobs,
            voice=voice,
            speed=speed,
            voice_reference_path=voice_reference_path,
            voice_reference_text=voice_reference_text,
        )

    def _voice_clone_for(
        self, reference_audio_path: Path, reference_text: str | None
    ) -> LocalVoiceCloneSynthesizer:
        if (
            self._voice_clone is None
            or self._voice_clone.reference_audio_path != reference_audio_path
            or self._voice_clone.reference_text != reference_text
        ):
            if self._voice_clone is not None:
                self._voice_clone.close()
            self._voice_clone = LocalVoiceCloneSynthesizer(reference_audio_path, reference_text)
        return self._voice_clone


class LocalVoiceCloneSynthesizer:
    def __init__(self, reference_audio_path: Path, reference_text: str | None) -> None:
        self.reference_audio_path = reference_audio_path
        self.reference_text = reference_text
        self._process: subprocess.Popen[str] | None = None

    def synthesize(self, text: str, output_path: Path) -> None:
        process = self._start_process()
        if process.stdin is None or process.stdout is None:
            raise MediaError(
                "MODEL_UNAVAILABLE",
                "The local voice-clone worker could not start.",
                retryable=True,
            )
        request = {
            "id": output_path.stem,
            "method": "voice-clone.synthesize",
            "params": {
                "text": text,
                "outputPath": str(output_path),
                "referenceAudioPath": str(self.reference_audio_path),
                "referenceText": self.reference_text,
            },
        }
        try:
            process.stdin.write(f"{json.dumps(request, separators=(',', ':'))}\n")
            process.stdin.flush()
            response = json.loads(process.stdout.readline())
        except (BrokenPipeError, json.JSONDecodeError) as error:
            self.close()
            raise MediaError(
                "MODEL_UNAVAILABLE",
                "The local voice-clone worker stopped unexpectedly.",
                retryable=True,
            ) from error
        if response.get("ok") is not True:
            message = response.get("error", {}).get("message", "Voice cloning failed.")
            raise MediaError("SYNTHESIS_FAILED", str(message), retryable=True)

    def synthesize_batch(
        self,
        jobs: list[tuple[str, Path]],
        *,
        voice: str,
        speed: float,
        voice_reference_path: Path | None,
        voice_reference_text: str | None,
    ) -> None:
        if voice_reference_path != self.reference_audio_path:
            raise MediaError(
                "SYNTHESIS_FAILED", "Voice reference changed during a batch.", retryable=True
            )
        if voice_reference_text != self.reference_text:
            raise MediaError(
                "SYNTHESIS_FAILED", "Voice transcript changed during a batch.", retryable=True
            )
        process = self._start_process()
        if process.stdin is None or process.stdout is None:
            raise MediaError(
                "MODEL_UNAVAILABLE",
                "The local voice-clone worker could not start.",
                retryable=True,
            )
        request = {
            "id": f"batch-{jobs[0][1].stem}",
            "method": "voice-clone.synthesize-batch",
            "params": {
                "jobs": [{"text": text, "outputPath": str(path)} for text, path in jobs],
                "referenceAudioPath": str(self.reference_audio_path),
                "referenceText": self.reference_text,
            },
        }
        try:
            process.stdin.write(f"{json.dumps(request, separators=(',', ':'))}\n")
            process.stdin.flush()
            response = json.loads(process.stdout.readline())
        except (BrokenPipeError, json.JSONDecodeError) as error:
            self.close()
            raise MediaError(
                "MODEL_UNAVAILABLE",
                "The local voice-clone worker stopped unexpectedly.",
                retryable=True,
            ) from error
        if response.get("ok") is not True:
            message = response.get("error", {}).get("message", "Voice cloning failed.")
            raise MediaError("SYNTHESIS_FAILED", str(message), retryable=True)

    def close(self) -> None:
        if self._process is not None:
            self._process.terminate()
            self._process.wait(timeout=10)
            self._process = None

    def _start_process(self) -> subprocess.Popen[str]:
        if self._process is None or self._process.poll() is not None:
            voice_clone_project = Path(__file__).parents[3] / "voice-clone"
            self._process = subprocess.Popen(
                [
                    "uv",
                    "run",
                    "--project",
                    str(voice_clone_project),
                    "--frozen",
                    "coderunners-voice-clone",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
        return self._process


class MlxWhisperTranscriber:
    def __init__(self, model_id: str = "mlx-community/whisper-medium-mlx") -> None:
        self.model_id = model_id

    def transcribe(self, audio_path: Path) -> list[RecognizedWord]:
        try:
            import mlx_whisper

            with contextlib.redirect_stdout(sys.stderr):
                result = mlx_whisper.transcribe(
                    str(audio_path),
                    path_or_hf_repo=self.model_id,
                    word_timestamps=True,
                    language="en",
                    condition_on_previous_text=False,
                    verbose=False,
                )
            words: list[RecognizedWord] = []
            for segment in result.get("segments", []):
                for word in segment.get("words", []):
                    words.append(
                        RecognizedWord(
                            text=str(word.get("word", "")).strip(),
                            start_ms=round(float(word["start"]) * 1_000),
                            end_ms=round(float(word["end"]) * 1_000),
                            confidence=float(word.get("probability", 0.0)),
                        )
                    )
            return words
        except Exception as error:
            raise MediaError(
                "MODEL_UNAVAILABLE",
                "Whisper could not align local narration.",
                retryable=True,
            ) from error
