import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import type { CodecastDraft, CodecastManifest } from "@coderunners/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  CodexUnavailableError,
  createLocalHostApp,
  ProjectLibrary,
  stageCodecastBundle,
  type CodecastArtifactGenerator,
  type LessonAuthor,
} from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};
const now = () => "2026-08-29T10:00:00.000Z";

describe("linked Codecast generation lifecycle", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("promotes successful finalized artifacts once and preserves replay after restart", async () => {
    const fixture = await createFixture("ready");
    const app = fixture.createApp();
    cleanups.push(async () => {
      await app.close();
      await rm(fixture.container, { recursive: true, force: true });
    });

    const created = await createCodecast(app);
    expect(created.codecast).toMatchObject({
      id: "codecast-1",
      generationJobId: "job-1",
      status: "generating",
    });
    await expect(waitForCodecast(app, "ready")).resolves.toMatchObject({
      status: "ready",
      durationMs: 120_000,
    });

    const firstReplay = await getReplay(app);
    expect(firstReplay.statusCode).toBe(200);
    expect(firstReplay.json()).toMatchObject({
      replay: {
        action: "play",
        audioUrl: "/api/codecasts/codecast-1/audio",
        codecastId: "codecast-1",
        manifest: { id: "codecast-1", audio: { durationMs: 120_000 } },
        manifestUrl: "/api/codecasts/codecast-1/manifest",
        resumeAtMs: 0,
      },
    });
    const audio = await app.inject({
      method: "GET",
      url: "/api/codecasts/codecast-1/audio",
      headers: authHeaders,
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers["content-type"]).toContain("audio/wav");
    expect(audio.rawPayload.subarray(0, 4).toString("ascii")).toBe("RIFF");

    const beforeRestart = await readFile(
      join(fixture.dataDirectory, "library.json"),
      "utf8",
    );
    await app.close();
    const duplicateLibrary = new ProjectLibrary({
      approvedProjectRoots: [fixture.projectRoot],
      dataDirectory: fixture.dataDirectory,
      now: () => "2026-08-29T11:00:00.000Z",
    });
    const duplicateStaging = await stageCodecastBundle({
      dataDirectory: fixture.dataDirectory,
      projectId: "project-1",
      codecastId: "codecast-1",
      jobId: "job-1",
      draft: fixture.draft,
      generator: fixture.artifactGenerator,
    });
    await duplicateLibrary.promoteCodecastBundle(
      "codecast-1",
      "job-1",
      duplicateStaging,
    );
    expect(await readFile(join(fixture.dataDirectory, "library.json"), "utf8"))
      .toBe(beforeRestart);
    await rm(join(fixture.dataDirectory, "jobs.json"));
    const restored = fixture.createApp({ idFactory: undefined });
    cleanups.push(() => restored.close());
    const restoredReplay = await getReplay(restored);
    expect(restoredReplay.statusCode).toBe(200);
    expect(restoredReplay.json()).toMatchObject({
      replay: { manifest: { id: "codecast-1" } },
    });
    await getReplay(restored);
    expect(await readFile(join(fixture.dataDirectory, "library.json"), "utf8"))
      .toBe(beforeRestart);
  });

  it("uses the Codecast's selected author, reasoning, TTS, and STT models", async () => {
    const authorRequests: unknown[] = [];
    const artifactRequests: unknown[] = [];
    const base = await createFixture("selected-models");
    const fixture = await createFixture("selected-models-runtime", {
      lessonAuthor: {
        async author(request) {
          authorRequests.push(request);
          return { threadId: "thread-1", draft: base.draft };
        },
      },
      artifactGenerator: {
        async generate(request) {
          artifactRequests.push(request);
          return base.artifactGenerator.generate(request);
        },
      },
    });
    const app = fixture.createApp();
    cleanups.push(async () => {
      await app.close();
      await rm(base.container, { recursive: true, force: true });
      await rm(fixture.container, { recursive: true, force: true });
    });

    await createCodecast(app);
    await waitForCodecast(app, "ready");

    expect(authorRequests).toEqual([
      expect.objectContaining({
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    ]);
    expect(artifactRequests).toEqual([
      expect.objectContaining({
        models: expect.objectContaining({
          stt: "local:whisper-medium-mlx",
          tts: "local:kokoro-82m-8bit",
        }),
      }),
    ]);
  });

  it("maps generation failures and restart-interrupted jobs to their Codecasts", async () => {
    const failedFixture = await createFixture("failed", {
      lessonAuthor: {
        async author() {
          throw new CodexUnavailableError();
        },
      },
    });
    const failedApp = failedFixture.createApp();
    cleanups.push(async () => {
      await failedApp.close();
      await rm(failedFixture.container, { recursive: true, force: true });
    });
    await createCodecast(failedApp);
    await expect(waitForCodecast(failedApp, "failed")).resolves.toMatchObject({
      error: { code: "CODEX_UNAVAILABLE" },
      status: "failed",
    });

    const interruptedFixture = await createFixture("interrupted", {
      lessonAuthor: { author: () => new Promise(() => undefined) },
    });
    const runningApp = interruptedFixture.createApp();
    cleanups.push(async () => {
      await runningApp.close();
      await rm(interruptedFixture.container, { recursive: true, force: true });
    });
    const created = await createCodecast(runningApp);
    await waitForJob(runningApp, created.codecast.generationJobId, "running");
    await runningApp.close();

    const restartedApp = interruptedFixture.createApp({
      idFactory: undefined,
      lessonAuthor: undefined,
    });
    cleanups.push(() => restartedApp.close());
    await expect(waitForCodecast(restartedApp, "interrupted")).resolves.toMatchObject({
      error: { code: "JOB_INTERRUPTED" },
      status: "interrupted",
    });
  });

  it("rejects missing, malformed, and cross-project replay artifacts", async () => {
    for (const tamper of ["missing-audio", "malformed-manifest", "cross-project"] as const) {
      const fixture = await createFixture(tamper);
      const app = fixture.createApp();
      cleanups.push(async () => {
        await app.close();
        await rm(fixture.container, { recursive: true, force: true });
      });
      await createCodecast(app);
      await waitForCodecast(app, "ready");
      const bundle = join(fixture.dataDirectory, "codecasts", "codecast-1");
      if (tamper === "missing-audio") {
        await rm(join(bundle, "audio", "codecast.wav"));
      } else if (tamper === "malformed-manifest") {
        await writeFile(join(bundle, "manifest.json"), "{not-json\n");
      } else {
        const metadata = JSON.parse(
          await readFile(join(bundle, "bundle.json"), "utf8"),
        ) as { projectId: string };
        metadata.projectId = "another-project";
        await writeFile(join(bundle, "bundle.json"), JSON.stringify(metadata));
      }

      const replay = await getReplay(app);
      expect(replay.statusCode).toBe(409);
      expect(replay.json()).toMatchObject({
        error: { code: "REPLAY_ARTIFACT_INVALID" },
      });
    }
  });

  it("persists in-progress/completed checkpoints and replays completion from zero", async () => {
    const fixture = await createFixture("checkpoint");
    const app = fixture.createApp();
    cleanups.push(async () => {
      await app.close();
      await rm(fixture.container, { recursive: true, force: true });
    });
    await createCodecast(app);
    await waitForCodecast(app, "ready");

    const progress = await app.inject({
      method: "PUT",
      url: "/api/codecasts/codecast-1/checkpoint",
      headers: authHeaders,
      payload: {
        positionMs: 30_000,
        completedChallengeIds: [],
        completed: false,
      },
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toMatchObject({ codecast: { status: "in-progress" } });
    expect((await getReplay(app)).json()).toMatchObject({
      replay: { action: "resume", resumeAtMs: 30_000 },
    });

    const skippedGate = await app.inject({
      method: "PUT",
      url: "/api/codecasts/codecast-1/checkpoint",
      headers: authHeaders,
      payload: {
        positionMs: 100_000,
        completedChallengeIds: [],
        completed: false,
      },
    });
    expect(skippedGate.statusCode).toBe(400);
    expect(skippedGate.json()).toMatchObject({
      error: { code: "INVALID_CHECKPOINT" },
    });

    const completed = await app.inject({
      method: "PUT",
      url: "/api/codecasts/codecast-1/checkpoint",
      headers: authHeaders,
      payload: {
        positionMs: 120_000,
        completedChallengeIds: ["format-habit-label"],
        completed: true,
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ codecast: { status: "completed" } });
    expect((await getReplay(app)).json()).toMatchObject({
      replay: {
        action: "replay",
        completedChallengeIds: ["format-habit-label"],
        resumeAtMs: 0,
        savedPositionMs: 120_000,
      },
    });

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/codecasts/codecast-1/checkpoint",
      headers: authHeaders,
      payload: {
        positionMs: 120_001,
        completedChallengeIds: [],
        completed: false,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "INVALID_CHECKPOINT" } });
  });

  it("cannot revive a deleted Codecast after late artifact completion", async () => {
    let release!: () => void;
    let started!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const generationRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = await createFixture("late", {
      artifactGenerator: createFixtureGenerator({
        beforeWrite: async () => {
          started();
          await generationRelease;
        },
      }),
    });
    const app = fixture.createApp();
    cleanups.push(async () => {
      await app.close();
      await rm(fixture.container, { recursive: true, force: true });
    });
    await writeFile(join(fixture.projectRoot, "learner.ts"), "const safe = true;\n");
    await createCodecast(app);
    await generationStarted;

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/codecasts/codecast-1",
      headers: authHeaders,
      payload: { confirmCodecastId: "codecast-1" },
    });
    expect(deleted.statusCode).toBe(204);
    release();
    await expect(waitForMissingJob(app, "job-1")).resolves.toBeUndefined();
    await waitForNoStaging(fixture.dataDirectory);

    expect((await listCodecasts(app)).codecasts).toEqual([]);
    await expect(stat(join(fixture.dataDirectory, "codecasts", "codecast-1")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(fixture.projectRoot, "learner.ts"), "utf8"))
      .toBe("const safe = true;\n");
  });
});

type FixtureOverrides = {
  artifactGenerator?: CodecastArtifactGenerator;
  lessonAuthor?: LessonAuthor;
};

async function createFixture(name: string, overrides: FixtureOverrides = {}) {
  const container = await mkdtemp(join(tmpdir(), `coderunners-lifecycle-${name}-`));
  const projectRoot = join(container, "project");
  const dataDirectory = join(container, "data");
  await mkdir(projectRoot);
  const draft = JSON.parse(
    await readFile(new URL("draft.json", fixtureRoot), "utf8"),
  ) as CodecastDraft;
  const lessonAuthor = overrides.lessonAuthor ?? {
    async author() {
      return { threadId: "thread-1", draft };
    },
  };
  const artifactGenerator =
    overrides.artifactGenerator ?? createFixtureGenerator();
  const baseOptions = {
    allowedOrigin,
    artifactGenerator,
    dataDirectory,
    idFactory: (() => {
      const ids = ["project-1", "codecast-1"];
      return () => ids.shift()!;
    })(),
    jobIdFactory: () => "job-1",
    lessonAuthor,
    now,
    projectRoot,
    sessionToken,
  };
  return {
    container,
    dataDirectory,
    draft,
    artifactGenerator,
    projectRoot,
    createApp(overrides_: Partial<typeof baseOptions> = {}) {
      return createLocalHostApp({ ...baseOptions, ...overrides_ });
    },
  };
}

function createFixtureGenerator(options: {
  beforeWrite?: () => Promise<void>;
} = {}): CodecastArtifactGenerator {
  return {
    async generate({ codecastId, outputDirectory }) {
      await options.beforeWrite?.();
      const manifest = JSON.parse(
        await readFile(new URL("manifest.json", fixtureRoot), "utf8"),
      ) as CodecastManifest;
      manifest.id = codecastId;
      manifest.audio.durationMs = 120_000;
      manifest.audio.src = "audio/codecast.wav";
      manifest.cues = manifest.cues.map((cue, index) => ({
        ...cue,
        startMs: index === 0 ? 0 : Math.min(cue.startMs, 119_000),
        endMs: Math.min(cue.endMs, 120_000),
      }));
      manifest.events = manifest.events.map((event) => ({
        ...event,
        atMs: Math.min(event.atMs, 119_000),
        ...(event.type === "demo.patch"
          ? { endMs: Math.min(event.endMs, 120_000) }
          : {}),
      }));
      await mkdir(join(outputDirectory, "audio"), { recursive: true });
      await writeFile(
        join(outputDirectory, "audio", "codecast.wav"),
        await readFile(new URL("audio/codecast.wav", fixtureRoot)),
      );
      return manifest;
    },
  };
}

async function createCodecast(app: ReturnType<typeof createLocalHostApp>) {
  await app.inject({ method: "GET", url: "/api/projects", headers: authHeaders });
  const response = await app.inject({
    method: "POST",
    url: "/api/projects/project-1/codecasts",
    headers: authHeaders,
    payload: {
      title: "Understanding React state",
      outcome: "Explain immutable state transitions.",
      workspace: { mode: "local-checkout", branch: null },
      models: {
        authoring: "openai:gpt-5.6-sol",
        authoringReasoning: "high",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    codecast: { id: string; generationJobId: string; status: string };
  };
}

async function listCodecasts(app: ReturnType<typeof createLocalHostApp>) {
  const response = await app.inject({
    method: "GET",
    url: "/api/projects/project-1/codecasts",
    headers: authHeaders,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { codecasts: Array<Record<string, unknown>> };
}

async function waitForCodecast(
  app: ReturnType<typeof createLocalHostApp>,
  status: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { codecasts } = await listCodecasts(app);
    if (codecasts[0]?.status === status) {
      return codecasts[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Codecast did not reach ${status}.`);
}

async function waitForJob(
  app: ReturnType<typeof createLocalHostApp>,
  jobId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/jobs/${jobId}`,
      headers: authHeaders,
    });
    if ((response.json() as { job: { status: string } }).job.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job did not reach ${status}.`);
}

async function waitForMissingJob(
  app: ReturnType<typeof createLocalHostApp>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/jobs/${jobId}`,
      headers: authHeaders,
    });
    if (response.statusCode === 404) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Deleted Codecast job state was retained.");
}

async function waitForNoStaging(dataDirectory: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const entries = await readdir(join(dataDirectory, "staging")).catch(
      () => [] as string[],
    );
    if (entries.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Deleted Codecast staging state was retained.");
}

function getReplay(app: ReturnType<typeof createLocalHostApp>) {
  return app.inject({
    method: "GET",
    url: "/api/codecasts/codecast-1/replay",
    headers: authHeaders,
  });
}
