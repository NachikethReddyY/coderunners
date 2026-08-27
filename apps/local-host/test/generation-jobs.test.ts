import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CodexUnavailableError,
  createLocalHostApp,
  JsonJobStore,
  type LessonAuthor,
} from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};
const now = () => "2026-08-27T07:30:00.000Z";

describe("Codecast generation jobs", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("persists a validated Codex draft without changing the learner project", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-jobs-"));
    const projectRoot = join(container, "project");
    const dataDirectory = join(container, "data");
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, "learner.ts"), "const answer = 1;\n");
    const draft = JSON.parse(
      await readFile(new URL("draft.json", fixtureRoot), "utf8"),
    ) as unknown;
    const authorRequests: unknown[] = [];
    const lessonAuthor: LessonAuthor = {
      async author(request) {
        authorRequests.push(request);
        return { threadId: "thread-1", draft };
      },
    };

    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory,
      jobIdFactory: () => "job-1",
      lessonAuthor,
      now,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const started = await app.inject({
      method: "POST",
      url: "/api/codecasts/generate",
      headers: authHeaders,
      payload: {
        goal: "Teach the state transition in a habit toggle.",
        diagnosticAnswers: ["I know React props.", "I am new to callbacks."],
      },
    });

    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({
      job: {
        id: "job-1",
        type: "codecast.generate",
        status: "queued",
        phase: "queued",
        createdAt: now(),
        updatedAt: now(),
      },
    });

    const completed = await waitForJob(app, "job-1");
    expect(completed).toEqual({
      job: {
        id: "job-1",
        type: "codecast.generate",
        status: "succeeded",
        phase: "validated",
        createdAt: now(),
        updatedAt: now(),
        result: { threadId: "thread-1", draft },
      },
    });
    expect(authorRequests).toEqual([
      {
        projectRoot,
        goal: "Teach the state transition in a habit toggle.",
        diagnosticAnswers: ["I know React props.", "I am new to callbacks."],
      },
    ]);
    expect(await readFile(join(projectRoot, "learner.ts"), "utf8")).toBe(
      "const answer = 1;\n",
    );

    await app.close();
    const restoredApp = createLocalHostApp({
      allowedOrigin,
      dataDirectory,
      lessonAuthor,
      now,
      projectRoot,
      sessionToken,
    });
    cleanups.push(() => restoredApp.close());

    const restored = await restoredApp.inject({
      method: "GET",
      url: "/api/jobs/job-1",
      headers: authHeaders,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual(completed);
  });

  it("durably marks in-flight jobs interrupted when the host restarts", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-restart-"));
    const dataDirectory = join(container, "data");
    const createdAt = "2026-08-27T07:29:00.000Z";
    await mkdir(dataDirectory);
    await writeFile(
      join(dataDirectory, "jobs.json"),
      `${JSON.stringify({
        version: 1,
        jobs: [
          {
            id: "job-interrupted",
            type: "codecast.generate",
            status: "running",
            phase: "authoring",
            createdAt,
            updatedAt: createdAt,
          },
        ],
      })}\n`,
    );
    const store = new JsonJobStore(dataDirectory, now);

    expect(await store.get("job-interrupted")).toMatchObject({
      status: "interrupted",
      phase: "interrupted",
      error: { code: "JOB_INTERRUPTED" },
    });
    const persisted = JSON.parse(
      await readFile(join(dataDirectory, "jobs.json"), "utf8"),
    ) as { jobs: Array<{ status: string }> };
    expect(persisted.jobs[0]!.status).toBe("interrupted");
    await rm(container, { recursive: true, force: true });
  });

  it("cancels a running job without accepting its eventual draft", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-cancel-"));
    const projectRoot = join(container, "project");
    const dataDirectory = join(container, "data");
    await mkdir(projectRoot);
    let finishAuthoring!: (result: { threadId: string; draft: unknown }) => void;
    const authoring = new Promise<{ threadId: string; draft: unknown }>(
      (resolve) => {
        finishAuthoring = resolve;
      },
    );
    const lessonAuthor: LessonAuthor = {
      author: () => authoring,
    };
    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory,
      jobIdFactory: () => "job-cancel",
      lessonAuthor,
      now,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    await app.inject({
      method: "POST",
      url: "/api/codecasts/generate",
      headers: authHeaders,
      payload: { goal: "Teach a toggle", diagnosticAnswers: [] },
    });
    await waitForStatus(app, "job-cancel", "running");
    const cancelled = await app.inject({
      method: "POST",
      url: "/api/jobs/job-cancel/cancel",
      headers: authHeaders,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      job: { status: "cancelled", phase: "cancelled" },
    });

    finishAuthoring({ threadId: "thread-late", draft: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const final = await app.inject({
      method: "GET",
      url: "/api/jobs/job-cancel",
      headers: authHeaders,
    });
    const finalBody = final.json() as {
      job: { status: string; result?: unknown };
    };
    expect(finalBody.job.status).toBe("cancelled");
    expect("result" in finalBody.job).toBe(false);
  });

  it("preserves a concrete Codex availability error and rejects a null request", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-unavailable-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    const lessonAuthor: LessonAuthor = {
      async author() {
        throw new CodexUnavailableError();
      },
    };
    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory: join(container, "data"),
      jobIdFactory: () => "job-unavailable",
      lessonAuthor,
      now,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/codecasts/generate",
      headers: authHeaders,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: "INVALID_GENERATION_REQUEST" },
    });

    await app.inject({
      method: "POST",
      url: "/api/codecasts/generate",
      headers: authHeaders,
      payload: { goal: "Teach a toggle", diagnosticAnswers: [] },
    });
    const failed = await waitForJob(app, "job-unavailable");
    expect(failed).toMatchObject({
      job: {
        status: "failed",
        error: {
          code: "CODEX_UNAVAILABLE",
          message: "Codex is unavailable. Check the local login, then retry generation.",
        },
      },
    });
  });

  it("returns a stable error when queued job state cannot be stored", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-storage-"));
    const projectRoot = join(container, "project");
    const dataDirectory = join(container, "not-a-directory");
    await mkdir(projectRoot);
    await writeFile(dataDirectory, "occupied by a file");
    const app = createLocalHostApp({
      allowedOrigin,
      dataDirectory,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/codecasts/generate",
      headers: authHeaders,
      payload: { goal: "Teach a toggle", diagnosticAnswers: [] },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "JOB_STORAGE_FAILED",
        message: "Generation state could not be stored. Check local storage access, then retry.",
      },
    });
  });
});

async function waitForJob(
  app: ReturnType<typeof createLocalHostApp>,
  jobId: string,
): Promise<unknown> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/jobs/${jobId}`,
      headers: authHeaders,
    });
    const body = response.json() as { job: { status: string } };
    if (body.job.status === "succeeded" || body.job.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Generation job did not reach a terminal state.");
}

async function waitForStatus(
  app: ReturnType<typeof createLocalHostApp>,
  jobId: string,
  expectedStatus: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/jobs/${jobId}`,
      headers: authHeaders,
    });
    const body = response.json() as { job: { status: string } };
    if (body.job.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Generation job did not reach ${expectedStatus}.`);
}
