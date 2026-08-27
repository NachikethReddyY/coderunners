# TODO

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
- [ ] Preserve and commit the contracts lane's meaningful planning state without `.scratch` artifacts.
- [ ] Run focused Studio checks and commit the Studio lane.
- [ ] Re-run focused Local Host and workspace checks before integration.
- [ ] Create local `main` from `origin/main` and merge conformance, contracts planning, Local Host, and Studio in dependency order.
- [ ] Resolve integration conflicts without dropping branch-owned behavior or planning records.
- [ ] Run conformance, workspace, and direct browser verification on integrated `main`.
- [ ] Prove every integrated branch is an ancestor of `main` and record the absent media-worker lane.

## 2026-08-27 — CodeRunners tracer contracts lane

- [x] Confirm the React habit-toggle tracer.
- [x] Rename this worktree to `wt/contracts`.
- [ ] Define the lesson-manifest contract and hand-authored golden fixture.
- [ ] Write failing conformance tests for the hard challenge gate and playback isolation.
- [x] Cache and verify the local TTS and timing models for the Media lane.
- [ ] Implement the contract package and focused player tracer behavior.
- [ ] Validate the locked-seek, proof-unlock, restart-restore, and learner-file isolation flow.

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
