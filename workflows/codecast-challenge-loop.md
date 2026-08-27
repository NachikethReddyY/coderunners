# Codecast challenge loop

## Purpose

Help a student developer understand and prove one concept-bearing change in a real local project without letting lesson playback alter their work.

## Trigger and inputs

The loop starts when the learner presses **Play Codecast** for a validated lesson bundle. It needs the lesson manifest, isolated demo projection, selected project, available local-host capabilities, and the prior player checkpoint when one exists.

## Steps

1. Restore the most recent player checkpoint when it names the same lesson and is still incomplete; otherwise open the manifest entry file at time zero.
2. Play the next authored segment using the audio clock. Update captions, editor focus, demo projection, recorded terminal output, and preview state from the timed events only.
3. When a `challenge.start` event occurs, pause playback and make forward seeking unavailable. Keep inspection, rewind, save, exit, and progressive hints available.
4. Let the learner edit the live project. The first mutation pauses playback immediately and is never overwritten by a timeline event.
5. On request, show the exact manifest-defined check command and obtain an explicit approval through the Local Host. Start no process from the timeline itself.
6. Read the resulting terminal status or other focused proof. Unlock the challenge only after successful observable proof for that challenge.
7. Persist the current time, challenge status, and readable terminal context after each material transition. Resume the next segment after unlocking.

## Human checkpoint

The only required checkpoint is command review, immediately before a local command begins. The brief names the command, working directory, why it proves the current challenge, and the Run/Cancel choice. The learner is not asked to approve playback, seeking, or demo projection because those cannot affect the live project.

## Failure policy

Keep the learner's editor content and last good checkpoint. On a host/session failure, show the concrete recovery action and leave playback paused. On an unsuccessful check, retain the hard gate and expose the next unused hint or a retry; never treat an attempted command as proof.

## Proof and stop condition

One run is complete when the focused proof succeeds, the current challenge unlocks, and the next authored segment can resume. Stop early on cancellation, unavailable host, or unrecoverable playback error after saving the checkpoint and presenting its recovery brief.
