# Project library API handoff

All routes use the existing Local Host boundary: `X-CodeRunners-Session` is
required, mutating requests require the exact launcher origin, and responses
are not cached. Shared request and response types are exported from
`@coderunners/contracts`.

## Endpoints

| Method | Route | Request | Success response |
| --- | --- | --- | --- |
| `GET` | `/api/projects` | — | `ProjectListResponse` |
| `POST` | `/api/projects` | `CreateProjectRequest` | `ProjectResponse` (`201`) |
| `GET` | `/api/projects/:projectId/branches` | — | `BranchListResponse` |
| `GET` | `/api/projects/:projectId/codecasts` | — | `CodecastListResponse` |
| `POST` | `/api/projects/:projectId/codecasts` | `CreateCodecastRequest` | `CodecastResponse` (`201`) |
| `GET` | `/api/codecasts/:codecastId/replay` | — | `CodecastReplayResponse` |
| `GET` | `/api/codecasts/:codecastId/manifest` | — | existing `CodecastManifest` |
| `GET` | `/api/codecasts/:codecastId/audio` | — | validated PCM WAV bytes |
| `PUT` | `/api/codecasts/:codecastId/checkpoint` | `PlaybackCheckpointUpdate` | `CodecastResponse` |
| `DELETE` | `/api/codecasts/:codecastId` | `DeleteCodecastRequest` | empty (`204`) |
| `GET` | `/api/models` | — | `ModelConfigurationResponse` |
| `PUT` | `/api/settings/models` | `ModelSettingsUpdate` | `ModelConfigurationResponse` |

`POST /api/projects` accepts only a canonical directory that the launcher put
in `approvedProjectRoots` (the startup `projectRoot` is approved
automatically). The browser cannot authorize an arbitrary path by posting it.

For `local-checkout`, `workspace.branch` must equal the repository's current
branch, or be `null` for a non-Git folder. For `new-worktree`, Git validates the
branch and optional start point; CodeRunners derives the target below
`<app-data>/worktrees/<projectId>/<codecastId>` and accepts no target path from
the client.

Deletion requires `confirmCodecastId` to exactly equal the URL identifier. It
removes the registry record and moves only the app-owned Codecast bundle to
`<app-data>/Trash`, then removes the exactly linked app-owned job state; it
never removes the registered project or a worktree.

## State and replay mapping

Creation enters `generating`. The stable collection states and primary replay
actions are:

| `CodecastStatus` | `CodecastReplayMetadata.action` |
| --- | --- |
| `generating` | `view-progress` |
| `ready` | `play` |
| `in-progress` | `resume` |
| `completed` | `replay` |
| `failed` | `retry` |
| `interrupted` | `restart-job` |

Every newly created Codecast has a persisted `generationJobId`; the job stores
the same `projectId` and `codecastId`. Active jobs map to `generating`, failed
jobs to `failed`, and jobs interrupted by host restart to `interrupted`. A
Codecast becomes `ready` only after its manifest, fixed relative audio path,
WAV header, and project/Codecast/job bundle provenance validate inside
`<app-data>/codecasts/<codecastId>`.

Replay metadata carries the existing `CodecastManifest` inline, authenticated
manifest/audio URLs, the project ID, `savedPositionMs`, `resumeAtMs`, and
completed challenge IDs. `in-progress` resumes from the saved position;
`completed` returns `action: "replay"` and `resumeAtMs: 0` while retaining the
saved completion checkpoint. The Studio fetches audio with the session header
and gives the existing player an object URL; no absolute artifact path reaches
the browser.

Checkpoint writes accept only `{ positionMs, completedChallengeIds, completed
}`. Positions must be within the manifest duration, completion must be at the
exact end, challenge IDs must belong to that manifest, and a Replay write does
not erase an already saved `completed` state.

Missing, malformed, cross-project, or modified bundles return
`REPLAY_ARTIFACT_INVALID` (`409`). Deletion and late completion are serialized:
a finalizer cannot promote a bundle after its exact Codecast record has been
removed.

## Known limitations

- Folder approval is supplied by the launcher; an operating-system folder
  picker has not been added.
- The existing single-project file, PTY, generation, and `/codecast/` asset
  routes remain backward compatible and still use the launcher-selected
  project. The new library does not silently retarget those privileged routes.
- Deleting a Codecast intentionally leaves any created Git worktree in place;
  worktree cleanup needs its own explicit reviewed action.
- Authoring/TTS/STT selections are persisted and availability-validated. The
  selected author model and reasoning effort are forwarded to Codex, while the
  selected TTS/STT models are bound to the existing local media adapter;
  adding more provider adapters remains separate work.
