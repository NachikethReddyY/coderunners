import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalHostApp,
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
