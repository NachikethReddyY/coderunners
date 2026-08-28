# CodeRunners research and implementation plan

Date: 2026-08-27  
Stage: Research; browser, interface, naming, and challenge behavior accepted; first tracer open

## Recommendation in one paragraph

Build a browser-first React 19/Astryx Studio served by a loopback-only TypeScript local host, backed by `@openai/codex-sdk` and a Python MLX media worker. Treat each lesson as a deterministic **Codecast**: canonical narration, captions, word timing, and typed UI events drive an isolated demo projection; authored challenges pause playback and lock continuation until the learner’s real local workspace passes an observable check. Use a pnpm/Turborepo monorepo because the Studio, local host, media worker, and shared contracts change together but retain separate runtime boundaries.

## Research scorecard

| Dimension | Status | Sample and counting method | Evidence | Confidence | Limit |
| --- | --- | --- | --- | --- | --- |
| Codex integration choice | Strong | 2 official OpenAI integration surfaces compared by documented intended use | SDK supports starting/continuing local Codex threads inside applications; app-server targets rich Codex clients | High | No authenticated spike has run in this empty repo |
| ACP portability | Defer safely | Official ACP architecture + SDK + Codex ACP adapter inspected | ACP is a viable future client protocol; its v2 API is draft and Codex already has a direct SDK | Medium-high | Claude/Gemini adapters were not prototyped |
| Local timing pipeline | Feasible | Apple MLX Whisper implementation and model card inspected | `mlx-whisper` exposes word timestamps; Medium MLX weights are available | High for capability | Real-time factor and ±250 ms target need a benchmark on Nachiketh’s Mac |
| Local TTS | Feasible default | MLX-Audio and Kokoro MLX model card inspected | Kokoro is small, multilingual, available in quantized MLX form, and suitable for cue-by-cue generation | Medium | Voice quality and pronunciation need listening tests |
| Browser studio + local PTY | Feasible with a hard security boundary | File System Access, Local Network Access, xterm.js, and node-pty docs inspected | The browser can own the interface while a loopback Node host owns files, Codex, servers, and the real PTY | High | Requires a launcher, exact-origin checks, and a narrow local API |
| Learning design | Evidence-aligned | 5 primary/research sources across worked-example fading, ICAP, retrieval, segmentation, and programming-video questions | Active challenge gates and faded examples are better aligned with learning than passive autoplay | Medium-high | Effects do not validate this exact product; learner testing remains necessary |
| Astryx component fit | Strong, beta risk | 150+ library catalog inspected; 12 relevant component families mapped | App Shell, Resizable, Tree List, Tabs, Progress, Command Palette, dialogs, and accessibility utilities cover the shell | High for coverage | React 19+ and beta churn require pinned versions and visual regression tests |

Scores are evidence statuses, not benchmark results. “Sample” counts the directly inspected primary sources or component families; no performance, usability, or learner outcome has been measured locally yet.

## Product contract

**Outcome:** teach one coding concept through a working local project. **Allowed:** explain, demonstrate in an isolated projection, hint, run focused checks, and preserve progress. **Protected:** the learner writes the concept-bearing code; seeking or generation never overwrites their work. **Proof:** runnable behavior plus a teach-back and transfer task. **Stop:** the project works and the learner can explain the state transition without the generated lesson.

### Working vocabulary

- **Codecast:** the user-facing feature; a learner-paced narrated build with hard challenges, not a passive video.
- **Lesson Timeline:** the deterministic engine that maps audio time to typed visual events.
- **Demo projection:** an isolated, replayable filesystem/editor state used for demonstrations.
- **Learning seam:** the concept-bearing edit or decision the learner must own.
- **Challenge gate:** an authored stop with a prediction, edit, run, or explanation; forward progress unlocks only after an observable pass condition succeeds.
- **Lesson bundle:** the versioned local package containing script, audio, timing, events, fixtures, and checks.

## Smallest complete learner flow

1. Choose a folder and answer “What do you want to build or understand?”
2. Complete a two-question diagnostic; see a short generation brief.
3. Watch/listen to one user-paced segment while the demo projection opens files, focuses lines, applies demo patches, and replays safe terminal output. Inspection, selection, scrolling, and the web preview stay interactive; the first code mutation pauses narration.
4. At a challenge gate, playback pauses and forward seeking locks. Enter the real workspace, make the important edit, and run it in the real PTY.
5. Receive outcome-based feedback and progressively stronger hints. Continue only after a focused test, DOM assertion, console result, or program output passes.
6. Resume the Codecast, finish the project, teach the concept back, and attempt one small transfer variation.

The accepted first tracer is a 5–8 minute React habit toggle because one state change exercises generation, audio timing, editor mutation, PTY checks, a visible web preview, challenge unlock, and restore without requiring a broad curriculum.

## Why SDK, not ACP or app-server

| Surface | Best use | v1 decision |
| --- | --- | --- |
| Codex SDK | Programmatic local Codex threads inside an application or workflow | **Use now** for curriculum, script, manifest generation, and repair passes |
| Codex app-server | A rich Codex client exposing auth, history, approvals, and raw streamed agent UI | Defer; adopt only if CodeRunners later embeds a full Codex agent panel |
| ACP | Provider-neutral editor/client communication with agent subprocesses | Defer behind an internal provider contract; add after the Codex learning loop works |

The orchestrator owns a narrow `LessonAuthor` interface now. `CodexLessonAuthor` uses the SDK. A later `AcpLessonAuthor` can translate ACP sessions without leaking provider events into the lesson schema.

## Monorepo decision

### Observed units and coupling

There are three real runtimes: a browser Studio, a loopback Node local host, and a Python/MLX media worker. All consume the same lesson/job contracts, and a schema change must update producers, consumers, fixtures, and end-to-end proof atomically. That justifies one monorepo. Independent repositories would make the most common change—the lesson manifest—distributed and fragile.

### Proposed repository

```text
apps/
  studio/                 Browser React + Astryx interface
  local-host/             Loopback server, Codex SDK, files, PTY, job state
services/
  media/                  Python uv worker: TTS, WAV assembly, MLX Whisper, alignment
packages/
  contracts/              TypeScript types + canonical JSON Schemas
  lesson-player/          Pure timeline reducer and demo projection
fixtures/
  codecast-react/         Golden script, audio, events, workspace, expected states
```

- Tooling: pnpm workspaces + Turborepo for the shared graph; `uv` owns Python dependency locking inside `services/media`.
- Dependency direction: `studio → lesson-player/contracts`; `local-host → contracts/media`; `media → JSON Schema artifacts`. The browser never imports Node or Python runtime code.
- Release boundary: one local launcher starts Node and Python, binds the host to `127.0.0.1`, and opens the system browser; services remain independently testable, not independently deployed.
- Main tradeoff: the browser keeps v1 lighter and easier to inspect, but the loopback host becomes a privileged boundary that needs per-launch authentication, exact Origin checks, a strict CSP, path validation, and allowlisted commands.

## Service responsibilities

### 1. Studio

- The browser uses React 19, Astryx, Monaco, xterm.js, the Codecast player, captions, file explorer, and the expandable web preview.
- It communicates only through a typed loopback API and websocket; it has no direct filesystem, model, subprocess, or Python access.
- Opening files, selecting text, scrolling, and interacting with a preview do not pause playback; the first learner workspace mutation does.
- Playback reads demo projections; learner edits go only to the explicitly selected workspace.

### 2. Local host

- Serves the Studio, issues a random per-launch session token, enforces exact Origin checks, and binds only to loopback.
- Starts/resumes Codex SDK threads and records model/config provenance.
- Requests a structured draft, validates it, and performs at most one constrained repair pass.
- Compiles cue-relative events into a provider-neutral lesson manifest.
- Owns workspace file APIs, the node-pty session, detected web-server ports, preview routing, and local SQLite job state.
- Never accepts model-authored absolute timestamps or unbounded shell commands.

### 3. Media worker

- Runs as a local JSONL stdio sidecar; no localhost HTTP port is needed.
- Generates one PCM WAV file per cue through an adapter; v1 default is Kokoro through MLX-Audio.
- Concatenates cues while preserving exact clip offsets.
- Uses `mlx-community/whisper-medium-mlx` with word timestamps, then aligns recognized words to the canonical script.
- Emits progress, retryable error codes, timing confidence, and cached artifacts.

## Lesson contract

The LLM authors stable anchors, never milliseconds:

```json
{
  "schemaVersion": 1,
  "lessonId": "react-state-001",
  "outcomes": ["Explain immutable state updates"],
  "cues": [
    {
      "id": "cue-toggle-intro",
      "spokenText": "Now find the habit by id...",
      "events": [
        {"type": "editor.focusRange", "anchorWord": 2, "file": "src/App.tsx"},
        {"type": "challenge.start", "challengeId": "toggle-habit"}
      ]
    }
  ]
}
```

Core event families: `chapter`, `editor.open`, `editor.focusRange`, `demo.patch`, `terminal.replay`, `preview.show`, `challenge.start`, `challenge.hint`, and `challenge.complete`. The timeline reducer must be pure: the same base snapshot plus the same timestamp always yields the same demo state.

## Synchronization pipeline

1. Codex produces canonical cue blocks and event anchors.
2. Local TTS renders each cue to WAV. Known clip boundaries provide coarse timing and cheap partial retries.
3. MLX Whisper Medium returns word timestamps for the combined audio.
4. A normalized token aligner maps recognized words to the canonical script; captions always display canonical text.
5. Event anchors resolve to milliseconds; validation checks order, bounds, missing anchors, and confidence.
6. Playback uses the Web Audio/media clock as the authority and derives UI state from time. It does not schedule long chains of timers.

Use WAV as the canonical artifact because MP3 encoder delay can make exact seeking less predictable. Export M4A/MP3 later only as an optional portable copy.

## Learning rules that prevent answer dumping

- Every Codecast follows **demonstrate → predict → stop at a challenge → build independently → prove → resume → explain**.
- Demo code lives in the isolated projection. The real workspace changes only through learner input or an explicit reviewed apply action for non-conceptual boilerplate.
- A hint ladder has four rungs: concept, location/context, pseudocode, minimal diff. Hints can deepen, but the Codecast cannot bypass the challenge or silently write the answer.
- Checks use behavior, tests, console output, or DOM state. The model may explain evidence but cannot declare a challenge passed.
- At a challenge the learner may inspect, rewind, save, request hints, or exit without losing work; only the next segment remains locked.
- The final transfer task changes surface details so copying the previous code is insufficient.

## Astryx design-system plan

Start with `@astryxdesign/theme-gothic`, copy it into an owned `coderunners-theme.css`, and reduce it to three surfaces: near-black canvas, elevated editor/terminal, and selected state. Keep white primary text, neutral gray structure, and a scarce cyan accent for playhead, focus, and active selection. Astryx remains the component and accessibility foundation; Monaco and xterm.js remain specialized canvases.

| Product need | Astryx building blocks |
| --- | --- |
| Browser workspace | App Shell, Layout Panel, Resizable, Resize Handle |
| Files and commands | Tree List, Side Nav, Outline, Command Palette |
| Separate caption and player overlays | Toolbar, Icon Button, Slider, Tooltip, Visually Hidden |
| Web preview overlay | Dialog, Focus Trap, Toolbar, Icon Button |
| Generation and challenge states | Progress Bar, Banner, Stepper, Dialog, Toast |
| Prompt and settings | Text Area, Selector, Segmented Control, Field |
| Command access | Command Palette, Power Search |
| Accessibility/adaptation | Visually Hidden, Focus Trap, hotkey/media-query utilities |

Do not wrap every pane in a card. Pane ownership comes from resizable boundaries; state comes from local feedback. Respect reduced motion by replacing code “typing” with an immediate or short reveal.

## Accepted interface direction

- A persistent file explorer owns the left edge.
- Monaco owns the main center surface and remains scrollable and inspectable while narration plays.
- One-line captions float in their own compact box above a minimal bottom media overlay. The player shows only play/pause, progress, current/total time, sound, and expand controls; connection state, playback prose, and challenge markers appear only when they require action. There is no permanent transcript panel.
- xterm.js owns a polished lower dock with terminal tabs, server state, and the real learner workspace.
- When a web server is detected, a compact Preview control attaches to the right editor edge. Activating it dims the workspace and opens a large, keyboard-contained, interactive browser surface; closing it restores editor state and focus.
- Clicking, selecting, scrolling, and preview interaction do not interrupt audio. The first code mutation pauses immediately and preserves the exact timestamp.
- At authored challenge points, playback and forward seeking remain locked until an allowlisted focused check proves the solution. Rewind, hints, save, and exit remain available.

## Icon directions

1. **Guided playback:** clearest audio/player signal, but risks implying passive autoplay and resembles an “I” at small size.
2. **Learning path (recommended):** angle brackets plus a waypoint communicate code and progress without promising that the app writes everything. Needs a clean vector redraw; generated motion streaks should be removed.
3. **Your turn:** communicates handoff explicitly, but the literal hand is too detailed and weak at navigation size. Reject as the primary icon.

The generated PNGs are concept evidence only, not production assets.

## Model and worktree plan

Models do not own permanent branches; feature branches own contracts. Assign models by task strength and keep one integrator responsible for merges.

| Worktree / branch | Primary model | Owned area | Stop condition |
| --- | --- | --- | --- |
| `wt/local-host` / `feat/local-host` | GPT-5.6 Sol, xhigh | Schema, golden fixture, Codex SDK adapter, loopback API, files/PTY, compiler, job state | Golden draft validates and local APIs pass Origin, path, and command checks |
| `wt/studio-player` / `feat/studio-player` | GPT-5.6 Terra, xhigh | Browser security boundary, Astryx layout, Monaco/xterm, preview overlay, pure player | Codecast passes edit-to-pause, hard challenge, preview, and restore checks |
| `wt/media-worker` / `feat/media-worker` | GPT-5.6 Terra, xhigh | Python uv worker, Kokoro adapter, WAV assembly, Whisper alignment | Golden audio emits validated word/event timing |
| `wt/conformance` / `test/conformance` | GPT-5.6 Luna, xhigh | Bounded schema fixtures, path traversal cases, timing assertions, merge smoke checks | Independent checks fail before implementation and pass after integration |

Sol remains the integration owner for contract changes and cross-service debugging. Luna receives small, quickly checkable test/fixture jobs only. Spark is outside the critical path; use it later only for tiny copy or component-polish iterations after the functional design is accepted.

Merge order: land the contracts and failing golden fixture first; branch Studio and Media from that fixed commit; merge each only after its focused checks; then run the single tracer-bullet integration in an integration worktree.

## Implementation waves and proof

### Wave 0 — Contract and fixture

- Write schema and failing conformance tests before runtime code.
- Hand-author one short Codecast bundle and tiny workspace fixture after the first tracer is selected.
- Proof: schema failures are precise; pure reducer reconstructs expected states at 0%, challenge, and end.

### Wave 1 — Player tracer bullet

- Localhost/Astryx browser shell, file explorer, Monaco, caption/player overlay, xterm real PTY, expandable web preview, audio transport, seek/replay, edit-to-pause, and one hard challenge.
- Proof: direct browser observation; inspection leaves playback running; mutation pauses; repeated seek never changes fixture workspace; a failing challenge blocks continuation; restart restores state.

### Wave 2 — Media generation

- Kokoro cue TTS, WAV concatenation, Whisper Medium timings, aligner, progress/retry.
- Proof: golden anchors within ±250 ms; failed cue retries do not regenerate successful cues.

### Wave 3 — Codex generation

- SDK thread, prompt contract, validation/repair, generation brief, local lesson bundle.
- Proof: three fixed prompts produce valid bundles; attempts to include direct seam answers or unsafe paths are rejected.

### Wave 4 — Learning loop

- Diagnostic, faded challenge sequence, hint ladder, behavioral checks, teach-back, transfer task.
- Proof: a learner can complete the React tracer project without a full solution being injected into the live workspace.

### Wave 5 — Provider portability

- Add the internal provider conformance suite and only then an ACP adapter for another agent.
- Proof: the same prompt yields a provider-neutral manifest and the player needs no provider-specific changes.

## Non-goals for v1

- No rendered MP4, avatar, talking head, collaborative multiplayer, cloud workspace, mobile app, extension marketplace, voice cloning, arbitrary language/framework guarantee, or inline autocomplete assistant.
- No automatic writing of learner-owned solutions.
- No ACP/Claude/Gemini adapter until the Codex tracer bullet and lesson schema are stable.
- No model benchmarking claim until run on the target Mac.

## Risks and mitigations

- **Generated lesson quality:** schema validation is necessary but insufficient. Use golden prompts, reviewer rubrics, and a user-visible generation brief.
- **Audio drift:** cue-level WAVs, known offsets, word alignment, and clock-derived state avoid cumulative timer drift.
- **Seek corruption:** replay only into an isolated pure projection; real workspace commands never originate from timeline replay.
- **Localhost privilege boundary:** bind to `127.0.0.1`, issue a per-launch token, enforce exact Origin and CSP, root the PTY at the chosen folder, validate paths, disclose commands, and confirm consequential operations.
- **Astryx beta churn:** pin exact versions, keep the owned theme small, and add focused screenshot/interaction regression checks.
- **Browser preview isolation:** allow only detected/approved local server origins, proxy or frame through a narrow route, and keep preview navigation separate from privileged local-host APIs.
- **Local model setup:** show download size and disk location, support pause/retry, and cache models globally.

## Decisions requested at the research gate

1. **Accepted:** browser-first Studio plus a loopback local host; no Electron wrapper for v1.
2. **Accepted:** editor-first layout with files left, a full-black editor center, separate caption and minimal player overlays, terminal dock, and expandable web preview.
3. **Accepted:** **Codecast** as the feature name and Learning Path as the primary icon.
4. **Accepted:** hard challenge gates require observable proof before continuation; a learner may rewind, use hints, save, or exit but cannot skip forward.
5. **Open:** choose the first tracer. React habit toggle is recommended; HTML/CSS interactive card is simpler but proves less, while a Flask counter route adds server coverage but more setup.

## Sources

1. OpenAI, “Codex SDK”: https://developers.openai.com/codex/sdk
2. OpenAI, “Codex App Server”: https://developers.openai.com/codex/app-server
3. Agent Client Protocol, “Architecture”: https://agentclientprotocol.com/get-started/architecture
4. Zed Industries, `codex-acp`: https://github.com/zed-industries/codex-acp
5. Apple MLX Examples, Whisper: https://github.com/ml-explore/mlx-examples/tree/main/whisper
6. MLX Community, Whisper Medium: https://huggingface.co/mlx-community/whisper-medium-mlx
7. MLX-Audio, Kokoro TTS: https://github.com/Blaizzy/mlx-audio
8. WICG, “File System Access”: https://wicg.github.io/file-system-access/
9. WICG, “Local Network Access”: https://wicg.github.io/local-network-access/
10. Microsoft, `node-pty`: https://github.com/microsoft/node-pty
11. xterm.js, “Encoding and node-pty integration”: https://xtermjs.org/docs/guides/encoding/
12. Astryx, component catalog: https://astryx.atmeta.com/components
13. Astryx, getting started: https://astryx.atmeta.com/docs/getting-started
14. Astryx repository and MIT license: https://github.com/facebook/astryx
15. Salden, Aleven & Renkl (2009), adaptive fading of worked examples: https://doi.org/10.1111/j.1756-8765.2008.01011.x
16. Chi & Wylie (2014), ICAP framework: https://doi.org/10.1080/00461520.2014.965823
17. Mayer (2019), learner-controlled segmentation: https://doi.org/10.1002/acp.3560
18. Cummins, Beresford & Rice (2015), in-video questions in a programming course: https://www.repository.cam.ac.uk/items/8998dbcf-b061-4487-b4ab-ae644b0c33d9
19. Wissman et al. (2019), retrieval strategies and retention: https://doi.org/10.1016/j.learninstruc.2017.12.008
