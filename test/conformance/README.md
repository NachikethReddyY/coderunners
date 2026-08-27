# CodeRunners conformance lane

This suite is the independent contract for the Luna lane from the research
plan. It is intentionally runnable with Node's built-in test runner so the
tests can be written before the runtime packages exist:

```sh
sh test/conformance/run.sh
```

On the pre-integration commit, missing runtime packages and workspace manifests
are expected failures. After the runtime worktrees are merged, the same
command must pass without changing the fixtures.

## Public seams under test

The runtime packages expose these small, stable functions:

- `@coderunners/contracts.validateLessonManifest(manifest)` returns exactly
  `{ valid: true, issues: [] }` for valid input, or `{ valid: false, issues }`
  for invalid input. Each issue has a machine-readable `code` and JSON-pointer
  `path`. The validator is pure.
- `@coderunners/contracts.validateLessonDraft(input)` and
  `@coderunners/contracts.validateLessonManifest(input)` return validation
  results with precise `{ code, path }` issues and never mutate input. Drafts
  use cue-relative anchors only; the model cannot author `atMs` values or put a
  solution in a learner-owned seam.
- `@coderunners/local-host.createLocalHostApp(options)` exposes the typed
  `/api/files/content` boundary. Valid reads return the requested relative
  path, content, and revision; traversal, absolute, encoded, backslash, NUL,
  and symlink escapes return the stable `INVALID_PATH` error without exposing
  an absolute path or mutating an outside file.
- `@coderunners/contracts.resolveAnchoredTimeline({ manifest, timing })` maps
  one-based cue-relative `anchorWord` values to the start of the matching word.
  It returns `{ ok: true, value: { durationMs, events } }`, with event records
  carrying `eventId`, `type`, and `atMs`, and is deterministic for identical
  inputs. Invalid timing returns a typed error rather than guessing.

The timeline resolver reports `TIMING_ANCHOR_MISSING`, `TIMING_OUT_OF_BOUNDS`, or
`TIMING_RANGE_INVALID` when timing data is incomplete or unsafe.

## Scope and ownership

The suite owns only `test/conformance/**`. Runtime packages, their schemas,
and the first tracer fixture remain owned by the corresponding worktrees. The
merge-smoke tests encode the accepted pnpm/Turborepo graph and the dependency
direction from the research plan; they do not choose a first tracer.
