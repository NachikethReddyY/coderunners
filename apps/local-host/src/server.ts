import { randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
} from "fastify";
import fastifyStatic from "@fastify/static";
import {
  LocalMediaArtifactGenerator,
  ReplayArtifactError,
  stageCodecastBundle,
  type CodecastArtifactGenerator,
} from "./codecast-artifacts.js";
import {
  validateCommandDefinitions,
  validateCodecastManifest,
  type CommandDefinition,
  type CodecastManifest,
} from "@coderunners/contracts";

import {
  InvalidProjectPathError,
  ProjectFiles,
  StaleProjectFileError,
} from "./project-files.js";
import {
  runGenerationJob,
  type LessonAuthor,
} from "./generation.js";
import {
  JobNotCancellableError,
  JobNotFoundError,
  JsonJobStore,
  type GenerationJob,
} from "./jobs.js";
import { CodexLessonAuthor } from "./codex-lesson-author.js";
import {
  ApprovalNotFoundError,
  ApprovalRequiredError,
  ApprovalUsedError,
  CommandApprovals,
  CommandNotFoundError,
  NodePtyFactory,
  PtySessionNotFoundError,
  PtySessions,
  type PtyFactory,
} from "./pty.js";
import {
  CodecastNotFoundError,
  DeleteConfirmationError,
  InvalidLibraryRequestError,
  InvalidCheckpointError,
  ModelSelectionError,
  ProjectApprovalError,
  ProjectLibrary,
  ProjectNotFoundError,
  WorkspaceError,
} from "./project-library.js";

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:";

export type LocalHostOptions = {
  allowedOrigin: string;
  approvalIdFactory?: () => string;
  commands?: Record<string, CommandDefinition>;
  codecastDirectory?: string;
  artifactGenerator?: CodecastArtifactGenerator;
  dataDirectory?: string;
  idFactory?: () => string;
  jobIdFactory?: () => string;
  lessonAuthor?: LessonAuthor;
  now?: () => string;
  approvedProjectRoots?: string[];
  projectRoot?: string;
  ptyFactory?: PtyFactory;
  ptyIdFactory?: () => string;
  sessionToken: string;
  studioDirectory?: string;
};

export function createLocalHostApp(options: LocalHostOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const now = options.now ?? (() => new Date().toISOString());
  const lessonAuthor = options.lessonAuthor ?? new CodexLessonAuthor();
  const artifactGenerator =
    options.artifactGenerator ?? new LocalMediaArtifactGenerator();
  const dataDirectory = options.dataDirectory ?? defaultDataDirectory();
  const jobs = new JsonJobStore(dataDirectory, now);
  const projectLibrary = new ProjectLibrary({
    approvedProjectRoots: [
      ...(options.approvedProjectRoots ?? []),
      ...(options.projectRoot === undefined ? [] : [options.projectRoot]),
    ],
    dataDirectory,
    ...(options.codecastDirectory === undefined
      ? {}
      : { replayManifestUrl: "/codecast/manifest.json" }),
    ...(options.idFactory === undefined ? {} : { idFactory: options.idFactory }),
    now,
  });
  let initialProjectRegistration: Promise<void> | undefined;
  const ensureInitialProject = (): Promise<void> => {
    initialProjectRegistration ??=
      options.projectRoot === undefined
        ? Promise.resolve()
        : projectLibrary.addProject({ root: options.projectRoot }).then(() => undefined);
    return initialProjectRegistration;
  };
  const reconcileCodecasts = async (): Promise<void> => {
    await ensureInitialProject();
    await projectLibrary.reconcileGenerationJobs(await jobs.list());
  };
  const projectFiles =
    options.projectRoot === undefined
      ? undefined
      : new ProjectFiles(options.projectRoot);
  const initialCommands = options.commands ?? {};
  if (options.commands !== undefined) {
    const commandValidation = validateCommandDefinitions(options.commands);
    if (!commandValidation.success) {
      throw new Error("Invalid command definitions supplied to Local Host.");
    }
  }
  const approvals = new CommandApprovals(
    initialCommands,
    options.approvalIdFactory,
    now,
  );
  const ptySessions =
    options.projectRoot === undefined
      ? undefined
      : new PtySessions(
          options.projectRoot,
          options.ptyFactory ?? new NodePtyFactory(),
          options.ptyIdFactory,
        );

  if (options.studioDirectory !== undefined) {
    void app.register(fastifyStatic, {
      root: options.studioDirectory,
      index: ["index.html"],
    });

    const serveStudioShell = async (_request: unknown, reply: FastifyReply) =>
      reply.sendFile("index.html");
    app.get("/settings", serveStudioShell);
    app.get("/projects/:projectId", serveStudioShell);
    app.get(
      "/projects/:projectId/codecasts/:codecastId",
      serveStudioShell,
    );
  }

  if (options.codecastDirectory !== undefined) {
    void app.register(fastifyStatic, {
      decorateReply: false,
      prefix: "/codecast/",
      root: options.codecastDirectory,
    });
  }

  app.get("/lesson-config.js", async (_request, reply) => {
    const selectedLesson = await readSelectedLesson(options.codecastDirectory);
    reply.type("application/javascript; charset=utf-8");
    return `window.__CODERUNNERS_LESSON__=${JSON.stringify(selectedLesson)};`;
  });

  app.addHook("onClose", async () => {
    ptySessions?.closeAll();
  });

  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");

    if (!(request.url === "/api" || request.url.startsWith("/api/"))) {
      return;
    }

    const origin = request.headers.origin;
    const isOriginlessSafeRead = origin === undefined && request.method === "GET";
    if (origin !== options.allowedOrigin && !isOriginlessSafeRead) {
      return reply.code(403).send({
        error: {
          code: "ORIGIN_REJECTED",
          message: "Reopen CodeRunners from the local launcher.",
        },
      });
    }

    const suppliedToken = request.headers["x-coderunners-session"];
    if (
      typeof suppliedToken !== "string" ||
      !tokensMatch(suppliedToken, options.sessionToken)
    ) {
      return reply.code(401).send({
        error: {
          code: "INVALID_SESSION",
          message: "Reopen CodeRunners from the local launcher.",
        },
      });
    }
  });

  app.get("/api/health", async () => {
    const projectReady = await projectIsReadable(options.projectRoot);
    return {
      status: "ok",
      capabilities: {
        codecastGeneration: projectReady,
        files: projectReady,
        pty: projectReady && approvals.hasCommands,
      },
    };
  });

  app.get("/api/projects", async (_request, reply) => {
    try {
      await ensureInitialProject();
      return { projects: await projectLibrary.listProjects() };
    } catch {
      return libraryStorageFailed(reply);
    }
  });

  app.post("/api/projects", async (request, reply) => {
    const body = (request.body ?? {}) as {
      root?: unknown;
      displayName?: unknown;
    };
    if (
      typeof body.root !== "string" ||
      (body.displayName !== undefined && typeof body.displayName !== "string")
    ) {
      return invalidLibraryRequest(reply);
    }
    try {
      await ensureInitialProject();
      const project = await projectLibrary.addProject({
        root: body.root,
        ...(typeof body.displayName === "string"
          ? { displayName: body.displayName }
          : {}),
      });
      return reply.code(201).send({ project });
    } catch (error) {
      if (error instanceof ProjectApprovalError) {
        return reply.code(403).send({
          error: {
            code: "PROJECT_NOT_APPROVED",
            message: "Choose a folder approved by the local launcher.",
          },
        });
      }
      if (error instanceof InvalidLibraryRequestError) {
        return invalidLibraryRequest(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.get("/api/projects/:projectId/branches", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      await ensureInitialProject();
      return { branches: await projectLibrary.listBranches(projectId) };
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        return projectNotFound(reply);
      }
      if (error instanceof WorkspaceError) {
        return reply.code(409).send({
          error: {
            code: "BRANCH_DISCOVERY_FAILED",
            message: "Refresh the project or restore its Git repository.",
          },
        });
      }
      return libraryStorageFailed(reply);
    }
  });

  app.post(
    "/api/projects/:projectId/codecasts",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      try {
        await ensureInitialProject();
        const timestamp = now();
        const jobId = options.jobIdFactory?.() ?? randomUUID();
        const codecast = await projectLibrary.createCodecast(
          projectId,
          request.body,
          jobId,
        );
        const context = await projectLibrary.getGenerationContext(codecast.id, jobId);
        const job: GenerationJob = {
          id: jobId,
          type: "codecast.generate",
          projectId: context.projectId,
          codecastId: context.codecastId,
          status: "queued",
          phase: "queued",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await jobs.create(job);
        setImmediate(() => {
          void runGenerationJob({
            jobId,
            jobs,
            lessonAuthor,
            request: {
              projectRoot: context.projectRoot,
              goal: codecast.outcome,
              diagnosticAnswers: [],
              model: context.authorModelId,
              reasoningEffort: context.models.authoringReasoning,
            },
            finalize: async (draft) => {
              const stagingDirectory = await stageCodecastBundle({
                dataDirectory,
                projectId: context.projectId,
                codecastId: context.codecastId,
                jobId,
                draft,
                models: context.models,
                generator: artifactGenerator,
              });
              await projectLibrary.promoteCodecastBundle(
                context.codecastId,
                jobId,
                stagingDirectory,
              );
            },
          })
            .then(reconcileCodecasts)
            .catch(() => {
              // NOTE: Storage outages are surfaced by the next collection read.
            });
        });
        return reply.code(201).send({ codecast });
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          return projectNotFound(reply);
        }
        if (error instanceof InvalidLibraryRequestError) {
          return invalidLibraryRequest(reply);
        }
        if (error instanceof ModelSelectionError) {
          return reply.code(409).send({
            error: { code: "MODEL_UNAVAILABLE", message: error.message },
          });
        }
        if (error instanceof WorkspaceError) {
          return reply.code(409).send({
            error: { code: "WORKSPACE_UNAVAILABLE", message: error.message },
          });
        }
        return libraryStorageFailed(reply);
      }
    },
  );

  app.get(
    "/api/projects/:projectId/codecasts",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      try {
        await reconcileCodecasts();
        return { codecasts: await projectLibrary.listCodecasts(projectId) };
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          return projectNotFound(reply);
        }
        return libraryStorageFailed(reply);
      }
    },
  );

  app.get("/api/codecasts/:codecastId/replay", async (request, reply) => {
    const { codecastId } = request.params as { codecastId: string };
    try {
      await reconcileCodecasts();
      return { replay: await projectLibrary.getReplayMetadata(codecastId) };
    } catch (error) {
      if (error instanceof CodecastNotFoundError) {
        return codecastNotFound(reply);
      }
      if (error instanceof ReplayArtifactError) {
        return replayArtifactInvalid(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.get("/api/codecasts/:codecastId/manifest", async (request, reply) => {
    const { codecastId } = request.params as { codecastId: string };
    try {
      await reconcileCodecasts();
      return await projectLibrary.getReplayManifest(codecastId);
    } catch (error) {
      if (error instanceof CodecastNotFoundError) {
        return codecastNotFound(reply);
      }
      if (error instanceof ReplayArtifactError) {
        return replayArtifactInvalid(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.get("/api/codecasts/:codecastId/audio", async (request, reply) => {
    const { codecastId } = request.params as { codecastId: string };
    try {
      await reconcileCodecasts();
      const audioPath = await projectLibrary.getReplayAudioPath(codecastId);
      reply.type("audio/wav");
      return await readFile(audioPath);
    } catch (error) {
      if (error instanceof CodecastNotFoundError) {
        return codecastNotFound(reply);
      }
      if (error instanceof ReplayArtifactError) {
        return replayArtifactInvalid(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.put("/api/codecasts/:codecastId/checkpoint", async (request, reply) => {
    const { codecastId } = request.params as { codecastId: string };
    try {
      await reconcileCodecasts();
      return {
        codecast: await projectLibrary.updateCheckpoint(codecastId, request.body),
      };
    } catch (error) {
      if (error instanceof CodecastNotFoundError) {
        return codecastNotFound(reply);
      }
      if (error instanceof InvalidCheckpointError) {
        return reply.code(400).send({
          error: {
            code: "INVALID_CHECKPOINT",
            message: "Save a checkpoint inside this Codecast timeline.",
          },
        });
      }
      if (error instanceof ReplayArtifactError) {
        return replayArtifactInvalid(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.delete("/api/codecasts/:codecastId", async (request, reply) => {
    const { codecastId } = request.params as { codecastId: string };
    const body = (request.body ?? {}) as { confirmCodecastId?: unknown };
    try {
      await ensureInitialProject();
      const deleted = await projectLibrary.deleteCodecast(
        codecastId,
        typeof body.confirmCodecastId === "string"
          ? body.confirmCodecastId
          : "",
      );
      await jobs.removeLinked(
        deleted.generationJobId,
        deleted.projectId,
        codecastId,
      );
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof DeleteConfirmationError) {
        return reply.code(400).send({
          error: {
            code: "DELETE_CONFIRMATION_MISMATCH",
            message: "Confirm the exact Codecast identifier before deleting.",
          },
        });
      }
      if (error instanceof CodecastNotFoundError) {
        return codecastNotFound(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.get("/api/models", async (_request, reply) => {
    try {
      return { configuration: await projectLibrary.getModelConfiguration() };
    } catch {
      return libraryStorageFailed(reply);
    }
  });

  app.put("/api/settings/models", async (request, reply) => {
    try {
      return {
        configuration: await projectLibrary.updateModelConfiguration(request.body),
      };
    } catch (error) {
      if (error instanceof InvalidLibraryRequestError) {
        return invalidLibraryRequest(reply);
      }
      return libraryStorageFailed(reply);
    }
  });

  app.get("/api/files/content", async (request, reply) => {
    if (projectFiles === undefined) {
      return reply.code(409).send({
        error: {
          code: "PROJECT_REQUIRED",
          message: "Select the project again.",
        },
      });
    }

    const { path } = request.query as { path?: unknown };
    if (typeof path !== "string") {
      return invalidPath(reply);
    }

    try {
      return await projectFiles.read(path);
    } catch (error) {
      if (error instanceof InvalidProjectPathError) {
        return invalidPath(reply);
      }

      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return fileNotFound(reply);
      }
      if (code === "EACCES" || code === "EPERM") {
        return filePermissionRequired(reply);
      }

      throw error;
    }
  });

  app.get("/api/files/directory", async (request, reply) => {
    if (projectFiles === undefined) {
      return reply.code(409).send({
        error: {
          code: "PROJECT_REQUIRED",
          message: "Select the project again.",
        },
      });
    }

    const { path } = request.query as { path?: unknown };
    if (typeof path !== "string") {
      return invalidPath(reply);
    }

    try {
      return await projectFiles.list(path);
    } catch (error) {
      if (error instanceof InvalidProjectPathError) {
        return invalidPath(reply);
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return fileNotFound(reply);
      }
      if (code === "EACCES" || code === "EPERM") {
        return filePermissionRequired(reply);
      }
      throw error;
    }
  });

  app.put("/api/files/content", async (request, reply) => {
    if (projectFiles === undefined) {
      return reply.code(409).send({
        error: {
          code: "PROJECT_REQUIRED",
          message: "Select the project again.",
        },
      });
    }

    const body = (request.body ?? {}) as {
      path?: unknown;
      content?: unknown;
      expectedRevision?: unknown;
    };
    if (
      typeof body.path !== "string" ||
      typeof body.content !== "string" ||
      typeof body.expectedRevision !== "string"
    ) {
      return invalidPath(reply);
    }

    try {
      return await projectFiles.write(
        body.path,
        body.content,
        body.expectedRevision,
      );
    } catch (error) {
      if (error instanceof StaleProjectFileError) {
        return reply.code(409).send({
          error: {
            code: "STALE_FILE",
            message:
              "This file changed after you opened it. Reload it before saving.",
          },
        });
      }
      if (error instanceof InvalidProjectPathError) {
        return invalidPath(reply);
      }

      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return fileNotFound(reply);
      }
      if (code === "EACCES" || code === "EPERM") {
        return filePermissionRequired(reply);
      }

      throw error;
    }
  });

  app.post("/api/codecasts/validate", async (request, reply) => {
    const validation = validateCodecastManifest(request.body);
    if (!validation.success) {
      return reply.code(422).send({
        error: {
          code: "INVALID_MANIFEST",
          message: "Repair the Codecast manifest before opening it.",
          details: validation.errors,
        },
      });
    }
    approvals.replaceCommands(validation.data.project.commands);
    return { valid: true, manifest: validation.data };
  });

  app.post("/api/codecasts/generate", async (request, reply) => {
    if (options.projectRoot === undefined) {
      return reply.code(409).send({
        error: {
          code: "PROJECT_REQUIRED",
          message: "Select the project again.",
        },
      });
    }
    const body = (request.body ?? {}) as {
      goal?: unknown;
      diagnosticAnswers?: unknown;
    };
    if (
      typeof body.goal !== "string" ||
      body.goal.length === 0 ||
      body.goal.length > 2_000 ||
      !Array.isArray(body.diagnosticAnswers) ||
      body.diagnosticAnswers.length > 8 ||
      !body.diagnosticAnswers.every(
        (answer) => typeof answer === "string" && answer.length <= 1_000,
      )
    ) {
      return reply.code(400).send({
        error: {
          code: "INVALID_GENERATION_REQUEST",
          message: "Check the project goal and diagnostic answers.",
        },
      });
    }

    const timestamp = now();
    const job: GenerationJob = {
      id: options.jobIdFactory?.() ?? randomUUID(),
      type: "codecast.generate",
      status: "queued",
      phase: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      await jobs.create(job);
    } catch {
      return reply.code(503).send({
        error: {
          code: "JOB_STORAGE_FAILED",
          message:
            "Generation state could not be stored. Check local storage access, then retry.",
        },
      });
    }

    const generationRequest = {
      projectRoot: options.projectRoot,
      goal: body.goal,
      diagnosticAnswers: body.diagnosticAnswers as string[],
    };
    setImmediate(() => {
      void runGenerationJob({
        jobId: job.id,
        jobs,
        lessonAuthor,
        request: generationRequest,
      }).catch(() => {
        // NOTE: A storage outage may prevent terminal failure persistence.
        // Keep the loopback host alive so the Studio can expose recovery.
      });
    });

    return reply.code(202).send({ job });
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await jobs.get(jobId);
    if (job === undefined) {
      return reply.code(404).send({
        error: {
          code: "JOB_NOT_FOUND",
          message: "Start the job again.",
        },
      });
    }
    return { job };
  });

  app.post("/api/jobs/:jobId/cancel", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    try {
      return { job: await jobs.cancel(jobId) };
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return reply.code(404).send({
          error: {
            code: "JOB_NOT_FOUND",
            message: "Start the job again.",
          },
        });
      }
      if (error instanceof JobNotCancellableError) {
        return reply.code(409).send({
          error: {
            code: "JOB_NOT_CANCELLABLE",
            message: "This job has already finished.",
          },
        });
      }
      throw error;
    }
  });

  app.post("/api/command-approvals", async (request, reply) => {
    const body = (request.body ?? {}) as { commandId?: unknown };
    if (typeof body.commandId !== "string") {
      return reply.code(400).send({
        error: {
          code: "INVALID_COMMAND",
          message: "Choose a command defined by this Codecast.",
        },
      });
    }
    try {
      return reply.code(201).send({
        approval: approvals.request(body.commandId),
      });
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return reply.code(404).send({
          error: {
            code: "COMMAND_NOT_FOUND",
            message: "Choose a command defined by this Codecast.",
          },
        });
      }
      throw error;
    }
  });

  app.post(
    "/api/command-approvals/:approvalId/confirm",
    async (request, reply) => {
      const { approvalId } = request.params as { approvalId: string };
      const body = (request.body ?? {}) as { approved?: unknown };
      if (typeof body.approved !== "boolean") {
        return approvalRequired(reply);
      }
      try {
        return { approval: approvals.confirm(approvalId, body.approved) };
      } catch (error) {
        if (
          error instanceof ApprovalRequiredError ||
          error instanceof ApprovalNotFoundError
        ) {
          return approvalRequired(reply);
        }
        throw error;
      }
    },
  );

  app.post("/api/pty/sessions", async (request, reply) => {
    if (ptySessions === undefined) {
      return reply.code(409).send({
        error: {
          code: "PROJECT_REQUIRED",
          message: "Select the project again.",
        },
      });
    }
    const body = (request.body ?? {}) as {
      approvalId?: unknown;
      cols?: unknown;
      rows?: unknown;
    };
    if (typeof body.approvalId !== "string") {
      return approvalRequired(reply);
    }
    try {
      const approval = approvals.consume(body.approvalId);
      const session = await ptySessions.start(approval, {
        ...(typeof body.cols === "number" ? { cols: body.cols } : {}),
        ...(typeof body.rows === "number" ? { rows: body.rows } : {}),
      });
      return reply.code(201).send({ session });
    } catch (error) {
      if (error instanceof ApprovalUsedError) {
        return reply.code(409).send({
          error: {
            code: "APPROVAL_USED",
            message: "Review the command again before rerunning it.",
          },
        });
      }
      if (
        error instanceof ApprovalRequiredError ||
        error instanceof ApprovalNotFoundError
      ) {
        return approvalRequired(reply);
      }
      return reply.code(503).send({
        error: {
          code: "PTY_FAILED",
          message: "The command could not start. Review it and try again.",
        },
      });
    }
  });

  app.get("/api/pty/sessions/:sessionId/output", async (request, reply) => {
    if (ptySessions === undefined) {
      return reply.code(404).send();
    }
    const { sessionId } = request.params as { sessionId: string };
    const { cursor } = request.query as { cursor?: unknown };
    const parsedCursor =
      typeof cursor === "string" && /^\d+$/.test(cursor)
        ? Number.parseInt(cursor, 10)
        : 0;
    try {
      return ptySessions.output(sessionId, parsedCursor);
    } catch {
      return reply.code(404).send({
        error: {
          code: "PTY_NOT_FOUND",
          message: "Run the command again.",
        },
      });
    }
  });

  app.post("/api/pty/sessions/:sessionId/input", async (request, reply) => {
    if (ptySessions === undefined) {
      return ptyNotFound(reply);
    }
    const { sessionId } = request.params as { sessionId: string };
    const body = (request.body ?? {}) as { data?: unknown };
    if (typeof body.data !== "string") {
      return ptyNotFound(reply);
    }
    try {
      ptySessions.write(sessionId, body.data);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PtySessionNotFoundError) {
        return ptyNotFound(reply);
      }
      throw error;
    }
  });

  app.post("/api/pty/sessions/:sessionId/resize", async (request, reply) => {
    if (ptySessions === undefined) {
      return ptyNotFound(reply);
    }
    const { sessionId } = request.params as { sessionId: string };
    const body = (request.body ?? {}) as { cols?: unknown; rows?: unknown };
    if (typeof body.cols !== "number" || typeof body.rows !== "number") {
      return ptyNotFound(reply);
    }
    try {
      ptySessions.resize(sessionId, body.cols, body.rows);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PtySessionNotFoundError) {
        return ptyNotFound(reply);
      }
      throw error;
    }
  });

  app.delete("/api/pty/sessions/:sessionId", async (request, reply) => {
    if (ptySessions === undefined) {
      return ptyNotFound(reply);
    }
    const { sessionId } = request.params as { sessionId: string };
    try {
      ptySessions.stop(sessionId);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PtySessionNotFoundError) {
        return ptyNotFound(reply);
      }
      throw error;
    }
  });

  return app;
}

async function readSelectedLesson(
  codecastDirectory: string | undefined,
): Promise<{ audioUrl: string; manifest: CodecastManifest } | undefined> {
  if (codecastDirectory === undefined) {
    return undefined;
  }

  const rawManifest = await readFile(join(codecastDirectory, "manifest.json"), "utf8");
  const parsedManifest = JSON.parse(rawManifest) as unknown;
  const validation = validateCodecastManifest(parsedManifest);
  if (!validation.success) {
    throw new Error("The selected Codecast manifest is invalid.");
  }

  return {
    audioUrl: `/codecast/${validation.data.audio.src}`,
    manifest: validation.data,
  };
}

function approvalRequired(reply: FastifyReply) {
  return reply.code(409).send({
    error: {
      code: "APPROVAL_REQUIRED",
      message: "Review the exact command before running it.",
    },
  });
}

function ptyNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: "PTY_NOT_FOUND",
      message: "Run the command again.",
    },
  });
}

function projectNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: "PROJECT_NOT_FOUND",
      message: "Choose a registered project.",
    },
  });
}

function codecastNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: "CODECAST_NOT_FOUND",
      message: "Choose an existing Codecast.",
    },
  });
}

function replayArtifactInvalid(reply: FastifyReply) {
  return reply.code(409).send({
    error: {
      code: "REPLAY_ARTIFACT_INVALID",
      message: "Regenerate this Codecast because its replay files are unavailable.",
    },
  });
}

function invalidLibraryRequest(reply: FastifyReply) {
  return reply.code(400).send({
    error: {
      code: "INVALID_LIBRARY_REQUEST",
      message: "Check the submitted project, Codecast, or model settings.",
    },
  });
}

function libraryStorageFailed(reply: FastifyReply) {
  return reply.code(503).send({
    error: {
      code: "LIBRARY_STORAGE_FAILED",
      message: "Project library state could not be read or saved.",
    },
  });
}

function defaultDataDirectory(): string {
  return join(homedir(), "Library", "Application Support", "CodeRunners");
}

function invalidPath(reply: FastifyReply) {
  return reply.code(400).send({
    error: {
      code: "INVALID_PATH",
      message: "Choose a file inside the selected project.",
    },
  });
}

function fileNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: "FILE_NOT_FOUND",
      message: "Choose an existing file inside the selected project.",
    },
  });
}

function filePermissionRequired(reply: FastifyReply) {
  return reply.code(403).send({
    error: {
      code: "FILE_PERMISSION_REQUIRED",
      message: "Restore project access, then try again.",
    },
  });
}

async function projectIsReadable(
  projectRoot: string | undefined,
): Promise<boolean> {
  if (projectRoot === undefined) {
    return false;
  }
  try {
    await access(projectRoot, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function tokensMatch(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}
