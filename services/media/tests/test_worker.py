from __future__ import annotations

import unittest
from pathlib import Path

from coderunners_media.worker import handle_request


class FakePipeline:
    def __init__(self) -> None:
        self.options: dict[str, object] = {}

    def generate(self, **options: object) -> dict[str, object]:
        self.options = options
        return {"audio": {"path": "/tmp/codecast.wav"}}


class MediaWorkerTest(unittest.TestCase):
    def test_accepts_the_jsonl_generate_contract(self) -> None:
        response = handle_request(
            {
                "id": "media-1",
                "method": "media.generate",
                "params": {
                    "draft": {"cues": [{"id": "intro", "text": "Hello"}]},
                    "outputDirectory": "/tmp/coderunners-output",
                    "cacheDirectory": "/tmp/coderunners-cache",
                },
            },
            FakePipeline(),
        )

        self.assertEqual(response["id"], "media-1")
        self.assertTrue(response["ok"])

    def test_rejects_unknown_methods_without_invoking_models(self) -> None:
        response = handle_request(
            {"id": "media-2", "method": "filesystem.write", "params": {}},
            FakePipeline(),
        )

        self.assertEqual(
            response,
            {
                "id": "media-2",
                "ok": False,
                "error": {
                    "code": "METHOD_NOT_FOUND",
                    "message": "Use the media.generate method.",
                    "retryable": False,
                },
            },
        )

    def test_passes_an_absolute_reference_audio_path_to_the_pipeline(self) -> None:
        pipeline = FakePipeline()
        response = handle_request(
            {
                "id": "media-3",
                "method": "media.generate",
                "params": {
                    "draft": {"cues": [{"id": "intro", "text": "Hello"}]},
                    "outputDirectory": "/tmp/coderunners-output",
                    "referenceAudioPath": "/tmp/authorized-speaker.wav",
                    "referenceText": "Authorized speaker transcript.",
                },
            },
            pipeline,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(
            pipeline.options["voice_reference_path"], Path("/tmp/authorized-speaker.wav")
        )
        self.assertEqual(pipeline.options["voice_reference_text"], "Authorized speaker transcript.")


if __name__ == "__main__":
    unittest.main()
