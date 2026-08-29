import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalHostApp } from "../src/index.js";

const execFile = promisify(execFileCallback);
const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};
const now = () => "2026-08-29T08:00:00.000Z";

describe("project-library HTTP contract", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("creates and lists project-scoped Codecasts with replay metadata", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-api-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    await execFile("git", ["init", "-b", "main"], { cwd: projectRoot });
    await execFile("git", ["config", "user.email", "tests@coderunners.local"], { cwd: projectRoot });
    await execFile("git", ["config", "user.name", "CodeRunners Tests"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "# fixture\n");
    await execFile("git", ["add", "README.md"], { cwd: projectRoot });
    await execFile("git", ["commit", "-m", "fixture"], { cwd: projectRoot });
    const ids = ["project-1", "codecast-1"];
    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory: join(container, "data"),
      idFactory: () => ids.shift()!,
      now,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const projects = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: authHeaders,
    });
    expect(projects.statusCode).toBe(200);
    expect(projects.json()).toMatchObject({
      projects: [{ id: "project-1", displayName: "project" }],
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/projects/project-1/codecasts",
      headers: authHeaders,
      payload: {
        title: "Understanding React state",
        outcome: "Explain immutable updates.",
        workspace: { mode: "local-checkout", branch: "main" },
        models: {
          authoring: "openai:gpt-5.6-sol",
          authoringReasoning: "high",
          stt: "local:whisper-medium-mlx",
          tts: "local:kokoro-82m-8bit",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      codecast: {
        id: "codecast-1",
        projectId: "project-1",
        status: "generating",
        workspace: { mode: "local-checkout", branch: "main" },
      },
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/projects/project-1/codecasts",
      headers: authHeaders,
    });
    expect(listed.json()).toEqual({
      codecasts: [created.json().codecast],
    });

    const replay = await app.inject({
      method: "GET",
      url: "/api/codecasts/codecast-1/replay",
      headers: authHeaders,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      replay: {
        codecastId: "codecast-1",
        projectId: "project-1",
        action: "view-progress",
        resumeAtMs: 0,
        manifestUrl: null,
      },
    });
  });

  it("requires an approved root and exact deletion confirmation", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-api-delete-"));
    const projectRoot = join(container, "approved");
    const outsideRoot = join(container, "outside");
    await mkdir(projectRoot);
    await mkdir(outsideRoot);
    const ids = ["project-1", "codecast-1"];
    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory: join(container, "data"),
      idFactory: () => ids.shift()!,
      now,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });
    await app.inject({ method: "GET", url: "/api/projects", headers: authHeaders });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: authHeaders,
      payload: { root: outsideRoot },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ error: { code: "PROJECT_NOT_APPROVED" } });

    await app.inject({
      method: "POST",
      url: "/api/projects/project-1/codecasts",
      headers: authHeaders,
      payload: {
        title: "Safe deletion",
        outcome: "Delete only generated metadata.",
        workspace: { mode: "local-checkout", branch: null },
        models: {
          authoring: "openai:gpt-5.6-sol",
          authoringReasoning: "high",
          stt: "local:whisper-medium-mlx",
          tts: "local:kokoro-82m-8bit",
        },
      },
    });

    const mismatch = await app.inject({
      method: "DELETE",
      url: "/api/codecasts/codecast-1",
      headers: authHeaders,
      payload: { confirmCodecastId: "project-1" },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: { code: "DELETE_CONFIRMATION_MISMATCH" } });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/codecasts/codecast-1",
      headers: authHeaders,
      payload: { confirmCodecastId: "codecast-1" },
    });
    expect(deleted.statusCode).toBe(204);

    const projects = await app.inject({ method: "GET", url: "/api/projects", headers: authHeaders });
    expect(projects.json()).toMatchObject({ projects: [{ id: "project-1" }] });
  });

  it("round-trips validated model configuration", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-models-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory: join(container, "data"),
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const initial = await app.inject({ method: "GET", url: "/api/models", headers: authHeaders });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      configuration: {
        defaults: {
          authoring: "openai:gpt-5.6-sol",
          stt: "local:whisper-medium-mlx",
          tts: "local:kokoro-82m-8bit",
        },
      },
    });

    const update = {
      enabledModelIds: [
        "openai:gpt-5.6-terra",
        "local:whisper-medium-mlx",
        "local:kokoro-82m-8bit",
      ],
      defaults: {
        authoring: "openai:gpt-5.6-terra",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    };
    const updated = await app.inject({
      method: "PUT",
      url: "/api/settings/models",
      headers: authHeaders,
      payload: update,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      configuration: {
        defaults: update.defaults,
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "openai:gpt-5.6-terra",
            enabled: true,
            availability: "ready",
          }),
          expect.objectContaining({
            id: "openai:gpt-5.6-sol",
            enabled: false,
            availability: "ready",
          }),
        ]),
      },
    });
  });
});
