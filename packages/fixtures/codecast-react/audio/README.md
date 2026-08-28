# Golden audio baseline

`codecast.wav` is stitched, audible Kokoro narration for the two canonical
lesson cues. Regenerate it through the real local media worker with
`pnpm fixture:audio` from the fixture package; the worker reuses its
content-addressed cue cache and verifies the combined audio with Whisper.

To synthesize an authorized Qwen reference voice without storing the source
clip in the repository, pass its absolute local WAV path and plain-text
transcript:

```sh
pnpm fixture:audio -- --reference-audio /absolute/authorized-reference.wav --reference-transcript /absolute/reference.txt
```
The compiler resolves every authored phrase anchor against those STT word starts
and writes both `manifest.json` and inspectable `audio/timing.json`; timeline
milliseconds are never hand-authored.
