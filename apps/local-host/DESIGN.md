# Local Host interaction design

## Frame

- **Primary user:** a student developer running CodeRunners on a Mac in a local browser.
- **Immediate job:** select a project, generate a Codecast, edit learner-owned files, and run an explicitly reviewed command without losing work or confusing demo state with live state.
- **Useful outcome:** the browser can always explain whether the host is ready, working, waiting for the learner, complete, recoverable, or unavailable.
- **Inputs and access:** keyboard and pointer first, with browser semantics and assistive technology supplied by the Studio. Status meaning must be available as text and must not rely on color, sound, or motion.
- **Product character:** calm, precise, local, and trustworthy. Security constraints use direct recovery copy rather than blame.
- **Protected invariant:** Codecast playback, seeking, replay, and generation have no API capable of mutating the learner workspace or starting a real PTY.

The Studio owns visual composition. This file owns the host-mediated states, actions, and language its UI must be able to represent.

## Smallest useful flows

### Connect

1. The launcher binds only to `127.0.0.1`, creates a random session token, and opens the browser with the token in the URL fragment.
2. The Studio exchanges the fragment token through an exact-origin API request and keeps it in memory.
3. A successful health response exposes host capability states; it never returns credentials.

Observable completion: the Studio can show **Local host connected** from a typed response. An invalid token or origin receives a stable error code and no protected data.

### Generate a Codecast

1. The learner submits a goal and diagnostic answers for the selected project.
2. The host creates a durable queued job immediately and performs generation outside the request lifecycle.
3. Status moves through queued, running, and one terminal state. Progress describes the current phase without invented percentages.
4. Success links to a validated draft. Failure and interruption preserve the job plus a concrete retry reason.

Observable completion: a restarted host can return the terminal job or mark an in-flight job interrupted. The selected project remains byte-for-byte unchanged.

### Read and edit a learner file

1. Every path is relative to the selected project root and resolved against symlink and traversal escapes.
2. Reads return content plus a revision digest.
3. A learner edit supplies the expected digest. A stale digest rejects the write without replacing newer content.

Observable completion: a successful learner edit is immediately readable; invalid, escaped, stale, or permission-limited paths preserve the current file and name the recovery action.

### Run a real command

1. The Studio requests a command by manifest-defined ID; arbitrary executables and arguments are not accepted.
2. The host returns a pending approval containing the exact executable, arguments, and working directory.
3. The learner explicitly confirms it. The resulting approval is single-use and starts one PTY session.
4. The timeline may replay recorded output in the Studio but has no route that can request or confirm an approval.

Observable completion: an unapproved, expired, reused, unknown, or out-of-root request never starts a process. A confirmed command exposes running and terminal states with an exit result.

## States the Studio must represent

| State | Meaning | Primary recovery or next action |
| --- | --- | --- |
| Connecting | The browser is checking the local session. | Wait; keep unrelated reading usable. |
| Connected | The host and selected capabilities are ready. | Start the intended task. |
| Permission required | The project root is absent or no longer readable. | Select the project again. |
| Queued | A durable job exists but work has not started. | Cancel if safe. |
| Running | The named phase is active. | Continue other safe work or cancel. |
| Awaiting review | A command is defined but cannot start without a learner decision. | Review exact command, then Run or Cancel. |
| Succeeded | The result is already visible or linked. | Continue to the next Codecast step. |
| Failed | The operation stopped and preserved prior work. | Correct the named cause, then Retry. |
| Interrupted | The host restarted while work was active. | Retry from the durable job brief. |
| Session expired | The token is no longer accepted. | Reopen CodeRunners from the launcher. |
| Host unavailable | The loopback server cannot be reached. | Restart the local host; do not discard browser work. |

## Error contract

Errors use a stable machine code, a concise learner-facing message, and an optional recovery action. They distinguish invalid input (`INVALID_MANIFEST`, `INVALID_PATH`, `STALE_FILE`), authority (`INVALID_SESSION`, `ORIGIN_REJECTED`, `APPROVAL_REQUIRED`), availability (`HOST_UNAVAILABLE`, `CODEX_UNAVAILABLE`), and execution (`JOB_FAILED`, `PTY_FAILED`). Messages state what happened and what the learner can do next.

## Deferred interface work

Visual hierarchy, exact Astryx components, responsive layout, terminal controls, notifications, and focus management remain owned by the Studio lane. The Local Host will not add a parallel web shell or visual design system.

