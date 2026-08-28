# CodeRunners Studio design system

## Document status

- Product: CodeRunners Studio
- Status: accepted for the typed-function tracer
- Last updated: 2026-08-28
- Applies to: `apps/studio`
- Implementation sources: `src/main.tsx`, `src/studio.css`, `src/Studio.tsx`, `src/ProjectExplorer.tsx`, and `src/file-icon-theme.tsx`

## 1. Product direction

- **Primary user:** a student developer learning in a real local project.
- **Core job:** observe a Codecast, own the concept-bearing edit, prove it with a focused check, then continue without losing context.
- **Context:** browser-first on a Mac through a loopback Local Host; wide keyboard/pointer sessions are primary, narrow touch and keyboard access remain supported.
- **Personality:** focused, technical, calm, and trustworthy—an engineering instrument rather than a course dashboard.
- **Voice:** direct, action-result labels such as “Play Codecast”, “Run”, “Run check”, and “Reopen from launcher”.
- **Avoid:** stock Astryx docs styling, decorative neon, opaque AI behavior, crowded cards, and playback controls that imply learner work is automatic.

### Design principles

1. **The lesson never competes with the learner.** Editor, caption, and next learning action are always visible; demo playback is visibly distinct from live work.
2. **Proof controls progress.** A challenge lock explains what is needed and offers hints, review, and recovery without pretending that an attempt succeeded.
3. **Local capability is consequential.** Host/session and command-review states use clear text, exact command information, and explicit recovery.

### Supported contexts

| Context | Viewport and viewing distance | Inputs | Adaptation |
| --- | --- | --- | --- |
| Resizable desktop web | 900–1600px, close reading | keyboard and pointer | 44px lesson/session bar; real Explorer and dominant editor; terminal and preview open as drawers. |
| Constrained web | 360–899px, close reading | touch, keyboard, pointer | Explorer stacks above the editor; top-bar labels compact to icons; editor, captions, gate, and primary controls remain in reading order. |
| Interruptions and restart | any | all supported inputs | Player checkpoint preserves time, challenge state, and readable terminal context; browser work stays visible if the host is unavailable. |

### Trust and agency

- Playback, seeking, and demo projection have no live-file or PTY mutation route.
- The first learner editor mutation pauses playback locally and never overwrites entered content.
- A command always presents its command ID, executable, arguments, and working directory before **Run**.
- Session expiry and unavailable host keep the current Studio state and direct the learner to reopen or restart; they do not clear work.

## 2. Foundations

### Color

Working color space is sRGB and the Studio supports one custom CodeRunners dark theme. Astryx supplies reset primitives; the owned tokens below control the product chrome and Monaco theme.

| Token | Value | Role and allowed use | Pairing/state |
| --- | --- | --- | --- |
| `--canvas` | `#030303` | application chrome and every persistent non-editor surface | `--text-primary` |
| `--editor` | `#0A0A0A` | Monaco editing surface only | Monaco foreground and focus range |
| `--surface` | `#030303` | lesson bar, Explorer, file tab, terminal, player, preview | `--text-primary`, `--border-subtle` |
| `--surface-raised` | `#030303` | preview drawer | `--text-primary`, `--border-subtle` |
| `--challenge-surface` | `#161616` | locked checkpoint and command-review notifications | white text and `--border-subtle` |
| `--border-subtle` | `#1A1A1A` | every persistent pane and control boundary at 1px | not a focus indicator |
| `--text-primary` | `#FFFFFF` | headings, body, active labels | all dark surfaces |
| `--text-muted` | `#9A9A9A` | concise supporting context | never the only state cue |
| `--accent` | `#0A96FF` | current time, editor focus, primary action, keyboard focus | scarce |
| `--success` | `#36D982` | successful proof and connected host | paired with text |
| `--warning` | `#D7EF21` | challenge marker and connecting host | paired with label |
| `--danger` | `#FF5F6D` | session/host/check failure | paired with recovery text |

| Accent | Owns | Exclusions |
| --- | --- | --- |
| Cyan | one primary next action, timeline position, current editor range, keyboard focus | not generic decoration or success/failure |
| Green | verified proof only | not “currently running” or buttons |
| Yellow | held/awaiting-review state | not successful completion |
| Red | error and unavailable state | not routine destructive-looking chrome |

All ordinary text and interactive controls must meet WCAG 2.2 AA contrast in rendered context; color state is paired with a label, icon, position, or both.

Monaco owns a related code palette: keywords `#FF7AB2`, identifiers `#82AAFF`, type identifiers `#2FD8F2`, strings `#A8F0CF`, numbers `#F78C6C`, comments `#687386`, and ordinary code `#D8DEE9`. The hover and suggestion layer uses `#06090D` with a `#2D4B70` boundary; those colors belong only to temporary editor language surfaces.

### Typography

| Role | Family | Size / line height / weight | Use |
| --- | --- | --- | --- |
| `--font-ui` | `Inter, ui-sans-serif, system-ui, sans-serif` | inherited | controls, panels, captions |
| `--font-code` | `"SFMono-Regular", Consolas, "Liberation Mono", monospace` | inherited | editor and terminal content |
| `--text-meta` | UI | `12px / 16px / 600` | labels and status |
| `--text-body` | UI | `14px / 20px / 400` | captions and instructions |
| `--text-panel` | UI | `16px / 22px / 600` | panel heading |
| `--text-title` | UI | `20px / 26px / 700` | Codecast title |

Paragraphs cap at `68ch`; code uses tabular numeral-capable system monospace. The title only reduces to `18px` below 480px; controls and body text do not shrink.

### Spacing and layout

| Token | Value | Use |
| --- | ---: | --- |
| `--space-1` | `4px` | icon/text and compact code spacing |
| `--space-2` | `8px` | internal control grouping |
| `--space-3` | `12px` | panel controls and file rows |
| `--space-4` | `16px` | panel padding and primary groups |
| `--space-6` | `24px` | separated content groups |

The desktop Studio uses a 44px lesson/session bar above a two-column shell. The real project Explorer is `clamp(220px, 20vw, 280px)` and the editor owns the remaining width. Inside the workspace, a 34px file/action bar sits above the fluid editor and a 62px draggable player. Terminal and preview are transient drawers. Below 700px the Explorer stacks above the workspace; below 460px top-bar action labels hide while accessible names remain.

### Shape, depth, and motion

- Borders are `1px solid #1A1A1A`. Ordinary workbench panels stay square; the supplied notification pattern gives the `#161616` challenge gate a 14px radius.
- `--shadow-overlay: 0 20px 56px rgb(0 0 0 / 0.42)` belongs only to the preview drawer and command-review dialog.
- Focus is a 2px cyan outline with 2px offset; selection has a soft cyan fill plus text/outline.
- The only continuous animation is the step-blinking Monaco caret during the projected typing sequence. Under `prefers-reduced-motion: reduce`, it becomes static and any browser-provided scroll or transition behavior is removed.

## 3. Components

| Component | Semantic contract | States | Usage rule |
| --- | --- | --- | --- |
| Lesson bar | labelled `nav` | ready, learning, try it out, complete | title opens the session route; Preview is labelled; New session resets playback without editing files |
| Studio shell | `main` with labelled `nav`, `section`, and `aside` regions | normal, constrained | owned two-column grid with editor-first geometry |
| Player controls | native buttons, timeline/volume range inputs, and speed select | paused, playing, locked, complete | one visible main action; full volume and `1×` by default; Play, volume, and speed freeze at a checkpoint; rewind remains available for review |
| Caption panel | `aria-live="polite"` text | current, paused, locked | spoken text only; transport owns the single visible timestamp; `z-index: 10000` keeps it above workspace overlays |
| Challenge gate | labelled `section` | locked, awaiting review, failed, passed | its dot and hard stop share the STT end of the spoken try-it instruction; rewind clears it and reaching the dot reopens it |
| Command review | native `dialog` semantics and notification composition | pending, running, rejected | show the exact allowlisted command and working directory before it begins |
| Explorer | `nav`, ARIA tree, and native buttons | loading, expanded, active file, symlink | lazily reads the confined Local Host filesystem; does not follow out-of-root symlinks |
| Product and file icons | Microsoft Codicons plus `coderunnersFileIconTheme` | folder open/closed, filename/extension mapping | 16px product icons; 18px Explorer icons; every icon-only action has an accessible name and hover label |
| Monaco editor | labelled editor region | projected typing, focused range, learner-edited, suggestions, hover | path-aware TypeScript/JavaScript, CSS, HTML, and JSON workers power language features; symbols expose inferred signatures and common TypeScript/JavaScript keywords add a concise definition and syntax example; pointer hover and Monaco's keyboard hover action share one tooltip; a read-only non-seam file types across exact STT phrase intervals and carries one blinking caret until the sequence ends |
| Terminal | labelled output region | waiting, running, success, failure | real xterm integration when a PTY exists; its ANSI palette distinguishes commands, success, warnings, and failures without a redundant subtitle |
| Preview | labelled `aside`/drawer | closed, open, interactive | activity in preview never pauses playback |

## 4. Content and behavior

| Action | Immediate feedback | Result and recovery |
| --- | --- | --- |
| Play/pause | icon and label change; caption time updates | playback remains user-controlled |
| Change speed | selected multiplier remains visible | narration defaults and resets to `1×`; learner may choose `0.75×`–`2×` |
| Change volume | compact speaker slider updates the media element immediately | narration defaults and resets to full volume |
| Inspect code | a 250ms pointer hover or Monaco keyboard hover opens a labelled tooltip next to the token | symbol hovers show worker-derived types; supported language keywords add reference context and syntax; moving away or Escape dismisses the temporary layer |
| Learner edit | playback pauses immediately | label explains that work is learner-owned |
| Locked forward seek | audio, thumb, Play, and speed freeze at the same compiled marker | rewind clears the gate canvas; reaching the dot activates it again |
| Request check | filename-bar Run or gate Run check opens exact command review | Run begins typed local-host flow; only an active challenge can unlock |
| Check success | brief live “Check passed” announcement | closes the terminal, unlocks, resumes the post-check cue, then auto-dismisses the local announcement after 2.5 seconds and yields lasting status to the top bar |
| Check failure/host failure | nearby direct error and retry action | challenge remains locked and work persists |

Voice uses short, factual language: “Playback paused for your edit.”, “Review the exact check before it runs.”, and “Reopen CodeRunners from the launcher.”

## 5. Accessibility and responsiveness

| Area | Requirement | Evidence target |
| --- | --- | --- |
| Semantics | landmarks and visible/semantic reading order agree | Studio DOM test and browser inspection |
| Keyboard | every button, range, explorer item, dialog route, and preview disclosure is reachable with visible focus | keyboard browser pass |
| Non-color state | labels accompany lock, success, warning, and failure | Studio DOM and visual pass |
| Scaling/reflow | 200% zoom and 360px width keep controls and caption readable without horizontal page scrolling | constrained browser pass |
| Motion/audio | captions mirror audio; no essential state needs sound; reduced motion removes transitions | browser preference pass |
| Screen reader updates | current caption and local status use polite live regions; errors name the recovery | DOM inspection |

## 6. Decision log

| Date | Decision | Evidence | Affects |
| --- | --- | --- | --- |
| 2026-08-27 | Browser-first Studio uses an owned dark system over Astryx Gothic | research implementation plan | shell, theme, typography |
| 2026-08-27 | The first tracer is a 2:05, eight-cue `formatHabitLabel` lesson: introduce, declare, type parameter and return, build, review, recreate, and preview the next lesson | user correction and generated media | fixture, narration, editor, challenge |
| 2026-08-27 | Hard proof, not an edit attempt, unlocks continuation | accepted product invariant | player, gate, terminal |
| 2026-08-27 | TTS cues are stitched, transcribed, and compiled from STT word starts | user correction and generated timing artifact | media, manifest, player |
| 2026-08-27 | Lesson/session state owns the global top bar; file save and terminal own the file bar | supplied reference and browser correction | shell, navigation, actions |
| 2026-08-27 | CodeRunners uses Codicons behind a local filename/extension icon theme | Microsoft Codicons and VS Code file-icon-theme model | icon system, Explorer |
| 2026-08-27 | Playback defaults/resets to `1×`; marker rewind resets the gate; filename bar owns Run | browser correction | player, gate, file actions |
| 2026-08-27 | Replaying a completed lesson restores the timed blank demo canvas; player includes a full-volume default slider | browser correction | demo projection, player controls |
| 2026-08-27 | Monaco uses the TypeScript language worker for IntelliSense | user correction | editor |
| 2026-08-27 | A challenge snapshot uses the STT end of its full spoken instruction, not the next cue | browser correction | compiler, manifest, dot, player |
| 2026-08-27 | Demo patches animate across exact STT phrase intervals; one Monaco-positioned caret remains visible across narration gaps until the typing sequence ends | browser correction | compiler, projection, editor |
| 2026-08-27 | Command output uses an ANSI-aware dark palette, while captions remain above every workspace overlay and transient file announcements collapse after 2.5 seconds | browser correction | terminal, caption, status |
| 2026-08-28 | Editor models use real project paths and language-specific workers; Monaco hover, suggestions, and parameter-hint controllers are explicitly loaded, with a reference-matched keyword layer and syntax palette | supplied VS Code hover reference and direct browser inspection | editor, language services, theme |

## 7. Deferred decisions

| Question | Current fallback |
| --- | --- |
| Full visual mode selection | dark Studio only for this tracer; system/theme switching waits for a tested product need. |
| Multi-lesson history and named server-side sessions | the lesson selector exposes the current session and New session performs a safe local playback reset; persistence awaits a session service. |
