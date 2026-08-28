# CodeRunners Local Host

The Local Host is the privileged boundary between the browser Studio and the learner's Mac. It binds only to IPv4 loopback, requires an exact browser origin plus a random launch session for every `/api/*` request, and serves an optional prebuilt Studio directory without exposing API data.

## Start

```sh
pnpm --filter @coderunners/local-host build
pnpm --filter @coderunners/local-host start \
  --project-root /absolute/path/to/project \
  --codecast-directory /absolute/path/to/codecast \
  --studio-directory /absolute/path/to/apps/studio/dist
```

`--codecast-directory` is optional. When supplied, Studio uses that directory's `manifest.json` and audio instead of the built-in fixture. The CLI opens the supplied Studio build on macOS. Without a Studio directory it starts the API only and prints the loopback origin.

## Browser boundary

The launcher passes the session token in the URL fragment so it does not enter HTTP logs. The Studio keeps it in memory and sends these headers on API requests:

```text
Origin: http://127.0.0.1:<port>
X-CodeRunners-Session: <launch token>
```

Main routes:

- `GET /api/health`
- `POST /api/codecasts/validate`
- `POST /api/codecasts/generate`, `GET /api/jobs/:jobId`, and `POST /api/jobs/:jobId/cancel`
- `GET /api/files/directory` and `GET|PUT /api/files/content`
- `POST /api/command-approvals` and `POST /api/command-approvals/:id/confirm`
- `POST /api/pty/sessions`, plus typed output, input, resize, and stop routes

Generation and demo playback have no route that can modify learner files or start a PTY. File writes require an expected revision; PTY creation requires a separate, expiring, single-use approval for one command from the most recently validated manifest. Health capabilities remain false until their project and command prerequisites are available.
