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
