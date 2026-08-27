# CodeRunners notes

- Nachiketh is the first learner and product owner.
- The recurring loop is: choose what to learn, generate a lesson, experience synchronized narration and code visuals, complete protected coding seams, run the project, receive hints and feedback, and continue from saved local state.
- The first platform is Apple Silicon macOS.
- The first agent runtime is Codex. Claude Code, Gemini CLI, and other ACP-compatible agents are deferred.
- The product is local-first. The selected AI model may be remote; code, workspace files, terminal processes, lesson artifacts, speech generation, and transcription remain local in v1.
- The “video” is not a rendered video file. It is audio plus transcript plus a deterministic event timeline rendered into an interactive editor/player.
- The agent should not type the learner-owned solution. Demonstrations may use separate example code; project checkpoints require the learner to predict, edit, run, or explain.
- **Codecast:** the learner-facing lesson format. Audio, captions, editor focus, demo projection, terminal replay, and preview remain synchronized to the media clock.
- **Challenge loop:** observe a segment, pause at a protected learner-owned seam, solve in the live project, prove with observable output, then resume.
- **Hard gate:** forward progress stays locked until a focused test, DOM assertion, console result, or program output succeeds. An attempt alone never unlocks it.
- **Projection boundary:** lesson seeking, replaying, and generation only affect an isolated demo projection. The learner's project changes through learner input or an explicit reviewed action.
- **Studio:** the browser-first local interface. It calls only the typed loopback Local Host and holds the launch session token in memory.
- **Tracer:** the first short Codecast teaches an immutable React habit-toggle state transition and proves it with the supplied check command.
- The original research phase covered planning and design; later lane prompts authorized the current tracer implementation. Publication and deployment remain separately authorized actions.
