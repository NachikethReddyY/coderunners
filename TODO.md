# TODO

## 2026-08-29 — Home visual correction

- [x] Encode the accepted Home composition in a focused UI contract test.
- [x] Recompose the Home prompt, project selection, controls, and attached workspace bar without changing its bindings.
- [x] Reconcile the current shared backend/frontend diff against the required routes, state actions, player checkpoint behavior, and protected filesystem/security invariants.
- [x] Add focused regression coverage for project-picker keyboard/focus behavior, progress/interrupted collection actions, replay completion persistence, and narrow Home composition.
- [x] Implement the smallest corrections needed for the complete Home → collection → player → delete → Settings → history journey.
- [x] Run contracts, Local Host, Studio, player, media, conformance, typecheck, build, and `git diff --check` proof.
- [x] Verify desktop and 390px Home behavior against the Postplan reference and store visual evidence.
- [x] Capture desktop Home, open picker, 390px Home, collection, player, and Settings screenshots plus a concise `.evidence/` verification report.

## 2026-08-29 — Project library backend foundation

- [x] Confirm the repository, branch, shared worktree state, local instructions, and existing host/contracts entry points.
- [x] Read the Postplan workflow and extract the persistent records, API surface, states, and protected invariants.
- [x] Define shared Project, Codecast, model configuration, branch, workspace, replay, and API response contracts.
- [x] Write focused failing contract, registry, filesystem-boundary, branch/worktree, and HTTP API tests.
- [x] Implement the persistent project/Codecast/model registry with atomic app-owned storage.
- [x] Implement canonical project approval, branch discovery/validation, and app-owned worktree selection.
- [x] Add authenticated create/list/replay/delete and model-settings endpoints without changing Studio visuals.
- [x] Run focused tests and package type checks, then document frontend endpoints, state transitions, and limitations.
- [x] Define the linked generation, replay payload, artifact envelope, and narrow checkpoint contracts.
- [x] Add failing lifecycle tests for success, failure, interruption, idempotency, restart, artifact tampering, checkpointing, deletion races, and player loading.
- [x] Persist project/Codecast/job identity linkage and reconcile it safely after restart.
- [x] Finalize generated drafts through the existing media/compiler contracts into validated app-owned bundles.
- [x] Serve routed replay manifests/audio and persist Resume, Replay, and completion checkpoints without weakening hard gates.
- [x] Verify focused and regression suites, builds/type checks, and one directly observed HTTP lifecycle.
- [x] Update the frontend handoff with only the replay/checkpoint binding delta and remaining limitations.

## 2026-08-29 — CodeRunners frontend route journey

- [x] Reconcile the prior verification evidence with the current project-library changes before editing.
- [x] Repair canonical worktree containment before wiring the browser journey.
- [x] Preserve the completed backend contract layer and its untracked frontend route test; do not redesign or replace either.
- [x] Complete focused interaction coverage for navigation, model choice, project selection, replay availability, deletion, keyboard and state coverage.
- [x] Implement the typed frontend API boundary and Home, collection, player, and Settings routes using the persistent local-host contract layer.
- [x] Add frontend bindings only, without duplicating generation, jobs, files, or player APIs.
- [x] Implement loading, empty, unavailable, error, keyboard, and responsive states in the existing Studio visual system.
- [x] Directly observe a finalized Codecast replay from the served fixture bundle; retain the explicit unavailable state when no replay manifest exists.
- [x] Complete the desktop browser journey: Home project/model/workspace/branch selection, Codecast creation, collection, player replay, confirmed single-Codecast deletion, Settings persistence, and browser Back.
- [x] Complete the 390px Home layout check with no horizontal overflow; valid client routes serve the SPA shell and unknown API routes remain JSON 404s.
- [x] Rerun Studio (24 tests), Local Host (29 tests), project-library unit (4 tests), project-library API (3 tests), and Studio/Local Host typechecks after the focused empty-response deletion fix.
- [x] Run focused tests and directly verify the implemented Home, collection, deletion, Settings, history, keyboard, and responsive journey in the shared browser; save visual evidence if it adds useful proof.

## 2026-08-28 — Dynamic Q6 batches and clean clone openings

- [x] Replace the fixed four-chunk Q6 cap with conservative available-memory admission that retains 4 GiB headroom.
- [x] Detect and remove a cloned cue's unintended reference-style lead-in from the combined narration before final timing.
- [x] Add focused coverage for dynamic admission and safe lead-in removal.
- [x] Verify a real short Q6 render has no extra opening sentence before the requested narration.

## 2026-08-28 — Six-minute Q6 pipeline run

- [ ] Confirm the existing six-minute lesson input and launch path without changing authored lesson content.
- [x] Extract the authorized 0:00–0:15 reference segment and matching plain-text transcript for review.
- [x] Make Qwen admission account for reference duration and split long narration into groups of at most four sentences.
- [x] Correct the batch admission estimate to retain the user-approved 2 GiB during Qwen's peak short-reference generation.
- [x] Render the lesson once with the authorized Q6 reference voice and safe dynamic memory admission.
- [x] Compile final timing and launch the completed lesson locally.
- [x] Decide whether to shorten the authorized reference clip or relax the 4 GiB reserve; the user selected both a 15-second reference and 2 GiB headroom.
- [x] Apply the user-approved 2 GiB Qwen headroom for the short-reference full render.

## 2026-08-28 — Generated lesson launch correction

- [x] Launch the lesson against the React learner workspace rather than the repository root.
- [x] Make the timed demo text visible without an invalid-file toast.
- [x] Add an explicit captions on/off player control and focused coverage.
- [x] Remove the Qwen-generated short audio prefix before the first requested sentence.
- [x] Replace pasted demo snapshots with paced, incremental code walkthrough steps.
- [x] Move the challenge lock to the end of the complete instruction.
- [ ] Verify the corrected running lesson in the browser (requires a refreshed user browser session).

## 2026-08-27 — CodeRunners research and planning

- [x] Confirm repository, branch, and current worktree state.
- [x] Frame the product and identify decision-changing unknowns.
- [x] Research Codex integration, ACP, local media, desktop terminal security, and learning design.
- [x] Record the greenfield research state and the lesson workflow.
- [x] Generate and inspect three icon directions.
- [x] Create the evidence-backed architecture and implementation plan.
- [x] Build the self-contained HTML research/design comparison.
- [x] Verify the HTML at desktop and narrow viewports and exercise its controls.

## 2026-08-27 — Browser Codecast direction correction

- [x] Record browser-first, Codecast, and hard challenge-gate decisions.
- [x] Recompose the Workbench mock around files, editor, caption/player overlay, terminal, and expandable web preview.
- [x] Explain the first-tracer decision and keep it unresolved.
- [x] Verify desktop/mobile layout and the preview, edit-to-pause, and challenge interactions.

## 2026-08-27 — Luna conformance lane

- [x] Define the public conformance adapters and bounded fixture matrix without touching runtime-owned files.
- [x] Write failing manifest, path-boundary, timeline, and merge-smoke tests first.
- [x] Add the smallest repeatable conformance test command and fixture documentation.
- [x] Run the pre-integration failure proof and static checks.
- [x] Rename the local branch to `test/conformance`.
- [ ] Move the primary filesystem path to `wt/conformance`; Git refuses to move a primary working tree, so the shared path remains unchanged.

## 2026-08-27 — Integrate all worktrees into main

- [x] Inventory every CodeRunners worktree, branch, commit, and uncommitted change.
- [x] Map the worktrees to the accepted research plan and identify missing lanes.
- [x] Ignore generated local state and commit the conformance lane's meaningful files.
- [x] Preserve and commit the contracts lane's meaningful planning state without `.scratch` artifacts.
- [x] Run focused Studio checks and commit the Studio lane.
- [x] Re-run focused Local Host and workspace checks before integration.
- [x] Create local `main` from `origin/main` and merge conformance, contracts planning, Local Host, and Studio in dependency order.
- [x] Resolve integration conflicts without dropping branch-owned behavior or planning records.
- [x] Run conformance, workspace, and direct browser verification on integrated `main`; record the failures below.
- [x] Prove every integrated branch is an ancestor of `main` and record the absent media-worker lane.

## 2026-08-27 — CodeRunners tracer contracts lane

- [x] Confirm the React habit-toggle tracer.
- [x] Rename this worktree to `wt/contracts`.
- [x] Define the lesson-manifest contract and hand-authored golden fixture.
- [x] Write failing conformance tests for the hard challenge gate and playback isolation.
- [x] Cache and verify the local TTS and timing models for the Media lane.
- [x] Implement the contract package and focused player tracer behavior.
- [x] Validate the locked-seek, proof-unlock, restart-restore, and learner-file isolation flow.

## Local Host implementation — 2026-08-27

- [x] Confirm the Sol-owned lane, repository boundary, branch, and TDD seams.
- [x] Define the golden Codecast contract with a failing public validation test.
- [x] Implement canonical schemas, TypeScript types, and semantic validation.
- [x] Specify the executable Local Host workflows and browser-visible states.
- [x] Define failing Local Host boundary tests for session/origin, files, PTY approvals, jobs, and Codex generation.
- [x] Implement the Local Host tracer slices until the focused tests pass.
- [x] Complete the golden fixture with audio, runnable React source, and expected states.
- [x] Reject unresolved anchors/references and protected-seam demo patches.
- [x] Make runtime capabilities, errors, command binding, cancellation, and restart recovery truthful and durable.
- [x] Enforce expiring single-use approvals and stable PTY spawn failures.
- [x] Run focused tests, workspace checks/build, and a real loopback HTTP flow.
- [x] Complete a separate standards/spec review and resolve findings.
- [x] Record evidence, finish Greenfield state, and commit the branch.

## Studio Player implementation — 2026-08-27

- [x] Confirm the Terra-owned Studio lane, repository boundary, branch, and fixture contract.
- [x] Record the accepted React habit-toggle tracer and Codecast challenge-loop workflow.
- [x] Define failing Studio player, browser-boundary, and restore tests.
- [x] Implement the test-proven timeline reducer and session-aware loopback API client.
- [x] Build the accessible Astryx-Gothic Studio shell with Monaco, xterm, preview, captions, and hard challenge flow.
- [x] Verify wide/narrow keyboard flows, hard-gate restore, and the Local Host static-build handoff.
- [x] Run focused Studio and affected workspace checks; record direct UI evidence.
- [x] Complete the connected Local Host browser flow once its origin boundary accepts same-origin GET requests without an `Origin` header (owned by the Local Host lane).

## 2026-08-27 — Integration blockers found

- [x] Accept authenticated same-origin browser GET requests that omit `Origin`, while retaining the strict origin check where browsers send the header.
- [x] Serve a CSP compatible with Monaco's required inline layout styles without weakening the script boundary.
- [x] Move the pure player into the planned `@coderunners/lesson-player` package and make Studio consume it.
- [x] Implement the missing `services/media` lane and add `services/*` to the pnpm workspace.
- [x] Wire the root conformance command and make its public package imports resolvable from the standalone runner.
- [x] Re-run all 22 conformance checks and the connected browser challenge flow after these blockers are resolved.

## 2026-08-27 — End-to-end integration completion

- [x] Confirm local `main`, repository state, blocker list, and intended package graph.
- [x] Add focused failing coverage for same-origin browser GETs without `Origin` and Monaco-compatible CSP.
- [x] Fix the Local Host browser boundary without weakening session or cross-origin enforcement.
- [x] Extract the pure player behind the `@coderunners/lesson-player` public entrypoint and migrate Studio.
- [x] Implement the `services/media` CLI boundary and add it to the workspace/task graph.
- [x] Make standalone conformance imports resolve through declared public package entrypoints.
- [x] Record the accepted React habit-toggle tracer in the research plan.
- [x] Run focused checks, all conformance tests, workspace checks/builds, and the connected browser challenge flow.

## 2026-08-27 — Figma-aligned Studio and audible Codecast

- [x] Compare the current Studio against the supplied Figma reference and record the protected challenge flow.
- [x] Back the Explorer with a lazy, project-root-confined filesystem API and real file selection.
- [x] Make the editor the dominant surface with a compact rail, file tab, tool drawers, and bottom player.
- [x] Keep the timeline draggable up to the hard gate and use dots only for challenge checkpoints.
- [x] Replace the silent placeholder WAV with stitched model-generated narration.
- [x] Derive cue and event timestamps from the stitched-audio STT alignment instead of hand-authored offsets.
- [x] Regenerate the fixture as a short typed-function lesson with explain, try, check, and continue beats.
- [x] Restyle the locked challenge as the supplied `#161616` bordered notification pattern.
- [x] Add a lesson/session bar above the workspace with current lesson state and future navigation affordances.
- [x] Reduce and relocate utility actions, then replace the improvised glyphs with a coherent custom icon theme.
- [x] Keep playback at `1x` by default and expose a compact speed selector.
- [x] Enable Monaco TypeScript IntelliSense and add a reviewed Run action to the filename bar.
- [x] Reset the challenge overlay when the learner seeks back before its timeline dot.
- [x] Anchor the checkpoint dot to the STT end of the spoken try-it instruction and freeze playback controls at the snapshot.
- [x] Replace the short tracer with an approximately two-minute explain → projected typing → recreate → check → next-lesson script.
- [x] Render timed demo typing as a read-only projection, then restore the real unsolved learner file at the checkpoint.
- [x] Regenerate stitched TTS/STT media and prove duration, checkpoint alignment, reset, proof continuation, and next-lesson ending.
- [x] Sync every demo typing animation across its exact STT phrase interval, show an active typing caret, and auto-dismiss transient status announcements.
- [x] Add an ANSI-aware terminal palette, remove the redundant terminal subtitle, and keep captions above workspace overlays.
- [x] Synchronize the accepted Studio design artifacts.
- [x] Verify focused tests/build and the connected wide/narrow browser layout with audible playback.
- [x] Keep the empty demo projection visible from lesson start so learner files never leak ahead of timed typing.
- [x] Add a compact volume control to the player, defaulting to full volume.

## 2026-08-28 — Natural demo typing follow-up

- [x] Make projected typing follow the live audio clock one character at a time.
- [x] Reproduce and measure the syntax-color flicker during projected typing.
- [x] Preserve stable Monaco token colors while characters are appended.
- [x] Run focused checks and verify the corrected animation in the browser.

## 2026-08-28 — Editor hover IntelliSense

- [x] Confirm the repository, branch, dirty worktree, accepted design, and supplied hover reference.
- [x] Add focused failing coverage for file-aware language selection and keyword hover content.
- [x] Implement path-aware Monaco models, TypeScript hover IntelliSense, and the CodeRunners syntax/hover theme.
- [x] Synchronize the accepted editor behavior in the design artifacts.
- [x] Run focused tests/typecheck and directly verify symbol and keyword hover in the browser.

## 2026-08-28 — Clear Codecast authoring voice

- [x] Define a concise, demo-first authoring persona from the supplied teaching references.
- [x] Add focused coverage that requires the author prompt to preserve that voice.
- [x] Apply the persona to future generated lesson drafts and run the focused test.

## 2026-08-28 — React teaching-voice generation check

- [x] Generate a fresh React-basics Codecast exclusively through `CodexLessonAuthor`.
- [x] Validate the generated draft without editing its content.
- [x] Preserve the adapter's underlying availability cause for local diagnosis without exposing it to job users.
- [x] Replace the incompatible structured-output schema with a JSON-only author response and existing local validation.

## 2026-08-28 — React state-to-prop Codecast

- [x] Materialize the validated author-generated React draft as local-only Codecast input.
- [x] Generate local narration and word timing without touching the learner workspace.
- [x] Compile and validate the timed manifest; Studio playback remains a separate fixture-loading integration.

## 2026-08-28 — Local generated Codecast playback

- [x] Add an explicit local Codecast selection path without replacing the built-in fixture.
- [x] Prove the selected manifest and audio reach Studio, then rebuild the local launcher assets.

## 2026-08-28 — Authorized channel voice-clone Codecast

- [x] Download the authorized first-minute reference clip and automatic English transcript as local-only evidence.
- [x] Add a reference-audio synthesis adapter while preserving the default Kokoro voice path.
- [x] Add focused request/cache coverage for a reference voice.
- [x] Regenerate the React Codecast with the authorized voice and verify its media/timeline artifacts.

## 2026-08-28 — Authorized local voice-clone model comparison

- [x] Confirm the repository, branch, dirty worktree, and authorized reference scope.
- [x] Benchmark Qwen 0.6B Base Q6 with the authorized reference audio and transcript.
- [x] Validate OmniVoice-MLX-4bit prerequisites, then produce the same short clone sample or record a concrete blocker.
- [x] Benchmark Chatterbox Turbo 8-bit with the same sample as the viable alternate clone model.
- [x] Compare valid outputs and measured generation times, then recommend one model for the six-minute regeneration.

## 2026-08-28 — Qwen voice-clone quantization follow-up

- [x] Remove the rejected OmniVoice and Chatterbox Turbo model caches without touching Q6.
- [x] Download and benchmark Qwen 0.6B Base Q4 with the same authorized reference and target sentence.
- [x] Publish the Q4/Q6 audio comparison and record the space/time trade-off.

## 2026-08-28 — Q6 memory-admitted batch narration workflow

- [x] Confirm the repository, branch, dirty worktree, existing voice-clone seam, and protected default synthesizer path.
- [x] Add a memory-admission policy that reserves 4 GiB and selects a bounded Q6 batch size.
- [x] Add Q6 chunk rendering with shared reference conditioning and deterministic output ordering.
- [x] Stitch completed chunks with FFmpeg, retain temporary clips on stitch failure, and delete them only after success.
- [x] Align the final stitched clip through the existing STT path and cover the workflow with focused tests.
- [x] Run a short end-to-end Q6 batch proof without regenerating the six-minute lesson.
