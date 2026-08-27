# CodeRunners Studio design system

## Document status

- Product: CodeRunners Studio
- Status: accepted for the React habit-toggle tracer
- Last updated: 2026-08-27
- Applies to: `apps/studio`
- Implementation sources: `src/main.tsx`, `src/studio.css`, and `src/Studio.tsx`

## 1. Product direction

- **Primary user:** a student developer learning in a real local project.
- **Core job:** observe a Codecast, own the concept-bearing edit, prove it with a focused check, then continue without losing context.
- **Context:** browser-first on a Mac through a loopback Local Host; wide keyboard/pointer sessions are primary, narrow touch and keyboard access remain supported.
- **Personality:** focused, technical, calm, and trustworthy—an engineering instrument rather than a course dashboard.
- **Voice:** direct, action-result labels such as “Play Codecast”, “Run check”, and “Reopen from launcher”.
- **Avoid:** stock Astryx docs styling, decorative neon, opaque AI behavior, crowded cards, and playback controls that imply learner work is automatic.

### Design principles

1. **The lesson never competes with the learner.** Editor, caption, and next learning action are always visible; demo playback is visibly distinct from live work.
2. **Proof controls progress.** A challenge lock explains what is needed and offers hints, review, and recovery without pretending that an attempt succeeded.
3. **Local capability is consequential.** Host/session and command-review states use clear text, exact command information, and explicit recovery.

### Supported contexts

| Context | Viewport and viewing distance | Inputs | Adaptation |
| --- | --- | --- | --- |
| Resizable desktop web | 900–1600px, close reading | keyboard and pointer | Three panes; terminal dock; preview can open as a right drawer. |
| Constrained web | 360–899px, close reading | touch, keyboard, pointer | Explorer and preview become disclosure surfaces; editor, captions, gate, and primary controls remain in reading order. |
| Interruptions and restart | any | all supported inputs | Player checkpoint preserves time, challenge state, and readable terminal context; browser work stays visible if the host is unavailable. |

### Trust and agency

- Playback, seeking, and demo projection have no live-file or PTY mutation route.
- The first learner editor mutation pauses playback locally and never overwrites entered content.
- A command always presents its command ID, executable, arguments, and working directory before **Run**.
- Session expiry and unavailable host keep the current Studio state and direct the learner to reopen or restart; they do not clear work.

## 2. Foundations

### Color

Working color space is sRGB and the Studio supports a dark appearance for this tracer. Astryx Gothic reset and theme CSS supply the foundational tokens; these owned roles make the Studio visually distinct from the stock theme without relying on runtime style injection.

| Token | Value | Role and allowed use | Pairing/state |
| --- | --- | --- | --- |
| `--canvas` | `#05070B` | application canvas | `--text-primary`; no elevated controls |
| `--surface` | `#0A0F16` | editor, terminal, side panels | `--text-primary`, `--border-subtle` |
| `--surface-raised` | `#111A25` | command review and preview drawer | `--text-primary`, `--border-strong` |
| `--border-subtle` | `#233244` | persistent pane and control boundaries | not a focus indicator |
| `--text-primary` | `#F4F7FB` | headings, body, active labels | canvas/surfaces |
| `--text-muted` | `#98A6B8` | concise supporting context | never the only state cue |
| `--accent` | `#27D7FF` | current time, editor focus, primary action, keyboard focus | `--canvas`/`--surface`; scarce |
| `--accent-soft` | `#0A3140` | selected timeline or focus-range surface | paired with text and outline |
| `--success` | `#25D08A` | successful proof | paired with “Check passed” text |
| `--warning` | `#F3C85E` | awaiting command review and challenge lock | paired with direct label |
| `--danger` | `#F56B79` | session/host/check failure | paired with recovery text |

| Accent | Owns | Exclusions |
| --- | --- | --- |
| Cyan | one primary next action, timeline position, current editor range, keyboard focus | not generic decoration or success/failure |
| Green | verified proof only | not “currently running” or buttons |
| Yellow | held/awaiting-review state | not successful completion |
| Red | error and unavailable state | not routine destructive-looking chrome |

All ordinary text and interactive controls must meet WCAG 2.2 AA contrast in rendered context; color state is paired with a label, icon, position, or both.

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

The desktop Studio is a compact three-region app shell: 224px file explorer, fluid editor/player, and an optional 336px preview. The terminal is a 208px dock below the editor and before player controls. At 1100px the preview moves to an adjacent drawer; below 760px the explorer and preview collapse behind labeled controls. The live editor remains before the terminal and never loses the caption or hard-gate context.

### Shape, depth, and motion

- Borders are `1px solid var(--border-subtle)` with an `8px` radius for owned transient surfaces; ordinary panels use square edges to retain the studio-grid feel.
- `--shadow-overlay: 0 20px 56px rgb(0 0 0 / 0.42)` belongs only to the preview drawer and command-review dialog.
- Focus is a 2px cyan outline with 2px offset; selection has a soft cyan fill plus text/outline.
- The tracer uses no essential or continuous UI animation. Under `prefers-reduced-motion: reduce`, any browser-provided scroll or transition behavior is removed.

## 3. Components

| Component | Semantic contract | States | Usage rule |
| --- | --- | --- | --- |
| Studio shell | `main` with labelled `nav`, `section`, and `aside` regions | normal, constrained | use Astryx Gothic CSS foundations and owned grid composition |
| Player controls | native buttons and range input | paused, playing, locked, complete | one visible main action; seek reports lock reason |
| Caption panel | `aria-live="polite"` text | current, paused, locked | caption remains readable without audio |
| Challenge gate | labelled `section` | locked, awaiting review, failed, passed | visible challenge title, proof requirement, hint and check route |
| Command review | native `dialog` semantics | pending, running, rejected | show exact allowlisted command before it begins |
| Explorer | `nav` and native buttons | active file | only reflects known workspace paths in the tracer |
| Monaco editor | labelled editor region | focused range, learner-edited | user typing pauses playback; editor content is live work |
| Terminal | labelled output region | waiting, running, success, failure | real xterm integration when a PTY exists; timeline replay remains visibly labelled demo output |
| Preview | labelled `aside`/drawer | closed, open, interactive | activity in preview never pauses playback |

## 4. Content and behavior

| Action | Immediate feedback | Result and recovery |
| --- | --- | --- |
| Play/pause | icon and label change; caption time updates | playback remains user-controlled |
| Learner edit | playback pauses immediately | label explains that work is learner-owned |
| Locked forward seek | thumb returns to current position and lock status updates | rewind stays available; proof is the next action |
| Request check | exact command review surface opens | Run begins typed local-host flow; Cancel preserves the gate |
| Check success | “Check passed” plus success status | unlocks continuation |
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
| 2026-08-27 | React habit toggle is the first Codecast tracer | research recommendation and implementation request | fixture, editor, challenge |
| 2026-08-27 | Hard proof, not an edit attempt, unlocks continuation | accepted product invariant | player, gate, terminal |

## 7. Deferred decisions

| Question | Current fallback |
| --- | --- |
| Full visual mode selection | dark Studio only for this tracer; system/theme switching waits for a tested product need. |
| Multi-file project navigation and terminal restoration across Local Host restart | show the current fixture file and durable player checkpoint; await host-side terminal persistence contract. |
