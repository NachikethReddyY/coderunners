# Generate and complete a Codecast

Status: Draft for product-direction review

## Outcome

Turn one learning goal and a learner-owned local folder into a resumable, narrated, project-based Codecast in which demonstrations are replayable but hard challenges require the learner to write, run, and prove the important code before continuing.

## Trigger

The learner selects **New Codecast**, chooses or creates a local workspace folder, and submits a goal such as “Teach me React by building a habit tracker.”

## Inputs

- Required: learning goal and local workspace folder.
- Defaulted: 30-minute lesson, beginner-adjusted difficulty inferred from a two-question diagnostic, English narration, Kokoro local TTS, `mlx-community/whisper-medium-mlx` alignment, and the learner’s configured Codex model.
- Optional: time budget, prior knowledge, preferred project constraints, voice, and model/reasoning setting.

## Ordered workflow

1. Inspect only the selected folder and record its language, package manager, existing files, and runnable commands. Preserve all existing work.
2. Run a two-question diagnostic: one prediction and one tiny code-reading task. Use the answers to choose the starting point; never use them to block entry.
3. Ask Codex through `@openai/codex-sdk` for a structured lesson draft containing outcomes, chapters, spoken cue blocks, demo-only events, learner-owned challenge seams, hint ladders, checks, and recovery steps.
4. Validate the draft against the versioned lesson schema. Reject direct answers inside learner seams, unbounded commands, writes outside the workspace, missing recovery, and events without stable cue anchors.
5. Present one review brief: project outcome, estimated time, files affected, challenges, local model downloads, and any destructive or network-requiring steps. The learner can start, refine, or cancel.
6. Generate each spoken cue as a separate PCM WAV clip with local TTS, then concatenate clips while retaining exact cue boundaries.
7. Run MLX Whisper Medium with word timestamps on the generated audio. Align the recognized words back to the canonical script; the script remains the caption text and Whisper supplies timing only.
8. Resolve cue-relative visual events into the lesson timeline, validate ordering and bounds, and package the audio, transcript, events, demo snapshot, checks, and metadata as a local lesson bundle.
9. Play the Codecast as learner-controlled segments. Demo events update an isolated projection and replay recorded terminal output; seeking never rewrites the learner’s project. File inspection, editor focus, selection, scrolling, and web-preview interaction keep playback running; the first code mutation pauses it.
10. At each challenge seam, pause narration, lock forward seeking, switch to the real workspace, and ask the learner to predict, edit, run, or explain. Give progressively stronger hints without silently writing the seam.
11. Run the focused check, compare observable behavior, and resume only when the challenge passes. Preserve attempts and terminal state across interruption; the learner may rewind, save, or exit without losing work.
12. End with the working project, a short teach-back, evidence for each outcome, and one transfer task that changes the surface details without changing the concept.

## Allowed capabilities

- Read and write the chosen workspace only through a typed, loopback local-host API with per-launch authentication and exact Origin checks.
- Spawn allowlisted local commands in a PTY rooted at the workspace.
- Run Codex SDK threads for lesson authoring and structured repair.
- Run local Python/MLX media jobs and download selected model weights after disclosure.
- Store lesson bundles and progress locally.

## Human gates

- One generation brief before expensive TTS/model downloads or any workspace mutation.
- One learner-owned challenge per concept; the next segment remains locked until observable proof passes.
- Explicit confirmation before commands that install dependencies, delete files, overwrite existing work, or access outside the workspace.

## Proof

- The lesson manifest validates against its schema.
- Every timeline event resolves to a cue and stays within the audio duration.
- A known anchor activates within ±250 ms in the golden audio fixture.
- Seeking repeatedly produces the same demo projection and leaves the learner workspace byte-for-byte unchanged.
- Each challenge passes only from observable output or a focused test, not model judgment alone.
- Closing and reopening restores the Codecast position, learner files, and incomplete challenge.

## Failure policy

- Codex/schema failure: retain the draft, run one constrained repair pass, then show the validation error and allow retry.
- TTS failure: keep completed cue clips and retry only failed cues.
- Alignment failure: mark the cue, use known clip boundaries for coarse playback, and block publication of word-level events until repaired.
- Command/test failure: preserve learner work and terminal output; offer diagnosis and the next hint rung.
- Interruption or app crash: resume from the last durable event and never replay mutations automatically.

## Stop condition

Stop when the learner completes or explicitly exits the Codecast, the project state is preserved, every claimed outcome has evidence, and the next transfer task is available.
