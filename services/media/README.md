# CodeRunners media worker

The media service is a local JSONL stdio sidecar. It owns cue-level Kokoro
synthesis, exact PCM WAV concatenation, MLX Whisper word timestamps, canonical
word alignment, and a content-addressed cue cache.

Start it with `uv run --frozen coderunners-media`. Send one request per line:

```json
{"id":"media-1","method":"media.generate","params":{"draft":{"cues":[{"id":"intro","text":"Open the project."}]},"outputDirectory":"/absolute/lesson/audio"}}
```

For an authorized local Qwen reference voice, include an absolute WAV path and
its plain-text transcript. The local worker chooses as many shared-model chunks
as current free unified memory safely permits after reserving 2 GiB for macOS
and a conservative Qwen working set. It uses FFmpeg to assemble the completed
chunks, deletes them after a successful assembly, removes any detected Qwen
reference-style lead-in from the combined WAV, then transcribes and aligns the
final narration.

```json
{"id":"media-2","method":"media.generate","params":{"draft":{"cues":[{"id":"intro","text":"Open the project."}]},"outputDirectory":"/absolute/lesson/audio","referenceAudioPath":"/absolute/authorized-reference.wav","referenceText":"The words spoken in the authorized reference clip."}}
```

Progress records and the final response use the same request id. Model output
and diagnostics go to stderr so stdout remains machine-readable JSONL. The
default local models are `mlx-community/Kokoro-82M-8bit` and
`mlx-community/whisper-medium-mlx`.
