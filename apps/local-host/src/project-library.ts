import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_MODEL_CONFIGURATION,
  validatePlaybackCheckpointUpdate,
  validateCreateCodecastRequest,
  validateCodecastRecord,
  validateModelConfiguration,
  validateModelSettingsUpdate,
  validateProjectRecord,
  validateWorkspaceSelection,
  type BranchSummary,
  type CodecastModelSelection,
  type CodecastRecord,
  type CodecastManifest,
  type CodecastReplayMetadata,
  type CreateCodecastRequest,
  type ModelConfiguration,
  type ModelSettingsUpdate,
  type PlaybackCheckpointUpdate,
  type PreparedWorkspace,
  type ProjectRecord,
  type ReplayAction,
  type WorkspaceSelection,
} from "@coderunners/contracts";

import {
  ReplayArtifactError,
  validateCodecastBundle,
  type ValidatedCodecastBundle,
} from "./codecast-artifacts.js";
import type { GenerationJob } from "./jobs.js";

const execFile = promisify(execFileCallback);
const SAFE_ID = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;

type StoredCodecast = CodecastRecord & { workspaceRoot: string };
type LibraryDocument = {
  version: 1;
  projects: ProjectRecord[];
  codecasts: StoredCodecast[];
  modelConfiguration: ModelConfiguration;
};

export type ProjectLibraryOptions = {
  approvedProjectRoots: string[];
  dataDirectory: string;
  idFactory?: () => string;
  now?: () => string;
  replayManifestUrl?: string | null;
};

export class ProjectApprovalError extends Error {
  override readonly name = "ProjectApprovalError";
}

export class ProjectNotFoundError extends Error {
  override readonly name = "ProjectNotFoundError";
}

export class CodecastNotFoundError extends Error {
  override readonly name = "CodecastNotFoundError";
}

export class DeleteConfirmationError extends Error {
  override readonly name = "DeleteConfirmationError";
}

export class InvalidLibraryRequestError extends Error {
  override readonly name = "InvalidLibraryRequestError";
}

export class ModelSelectionError extends Error {
  override readonly name = "ModelSelectionError";
}

export class InvalidCheckpointError extends Error {
  override readonly name = "InvalidCheckpointError";
}

export class WorkspaceError extends Error {
  override readonly name = "WorkspaceError";
}

export class ProjectLibrary {
  private document: LibraryDocument | undefined;
  private dataRoot: string | undefined;
  private initialization: Promise<void> | undefined;
  private mutationQueue = Promise.resolve();

  constructor(private readonly options: ProjectLibraryOptions) {}

  async addProject(input: {
    root: string;
    displayName?: string;
  }): Promise<ProjectRecord> {
    return this.mutate(async () => {
      const root = await this.resolveApprovedRoot(input.root);
      const existing = this.requireDocument().projects.find(
        (project) => project.root === root,
      );
      if (existing !== undefined) {
        existing.lastOpenedAt = this.now();
        existing.repository = await inspectRepository(root);
        await this.persist();
        return structuredClone(existing);
      }

      const id = this.createId();
      const timestamp = this.now();
      const displayName = input.displayName?.trim() || basename(root);
      if (displayName.length === 0 || displayName.length > 120) {
        throw new InvalidLibraryRequestError("Invalid project display name.");
      }
      const project: ProjectRecord = {
        id,
        displayName,
        root,
        repository: await inspectRepository(root),
        createdAt: timestamp,
        lastOpenedAt: timestamp,
      };
      this.requireDocument().projects.push(project);
      await this.persist();
      return structuredClone(project);
    });
  }

  async listProjects(): Promise<ProjectRecord[]> {
    await this.ready();
    return this.requireDocument().projects
      .map((project) => structuredClone(project))
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
  }

  async getProject(id: string): Promise<ProjectRecord> {
    await this.ready();
    const project = this.findProject(id);
    return structuredClone(project);
  }

  async listBranches(projectId: string): Promise<BranchSummary[]> {
    await this.ready();
    const project = this.findProject(projectId);
    if (project.repository.kind !== "git") {
      return [];
    }

    try {
      const { stdout } = await git(project.root, [
        "for-each-ref",
        "--format=%(refname:short)%00%(worktreepath)",
        "refs/heads",
      ]);
      const current = await currentBranch(project.root);
      return stdout
        .trimEnd()
        .split("\n")
        .filter(Boolean)
        .map((line): BranchSummary => {
          const [name, worktreePath = ""] = line.split("\0");
          if (name === undefined || !SAFE_ID_OR_BRANCH.test(name)) {
            throw new WorkspaceError("Git returned an invalid branch name.");
          }
          return {
            name,
            current: name === current,
            checkedOut: worktreePath.length > 0,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError("Branches could not be read.", { cause: error });
    }
  }

  async prepareWorkspace(
    projectId: string,
    codecastId: string,
    selection: WorkspaceSelection,
  ): Promise<PreparedWorkspace> {
    await this.ready();
    const validation = validateWorkspaceSelection(selection);
    if (!validation.success || !SAFE_ID.test(codecastId)) {
      throw new WorkspaceError("Choose a valid branch and workspace mode.");
    }
    const project = this.findProject(projectId);

    if (selection.mode === "local-checkout") {
      const current =
        project.repository.kind === "git"
          ? await currentBranch(project.root)
          : null;
      if (selection.branch !== current) {
        throw new WorkspaceError(
          "Local checkout must use the branch currently checked out.",
        );
      }
      return { mode: selection.mode, branch: current, root: project.root };
    }

    if (project.repository.kind !== "git") {
      throw new WorkspaceError("New worktrees require a Git repository.");
    }
    await validateGitBranch(project.root, selection.branch);

    const branches = await this.listBranches(projectId);
    const existingBranch = branches.find(
      (branch) => branch.name === selection.branch,
    );
    let arguments_: string[];
    if (selection.createBranch) {
      if (selection.startPoint === undefined || existingBranch !== undefined) {
        throw new WorkspaceError(
          "A new branch requires an existing start point and a unique name.",
        );
      }
      await validateGitBranch(project.root, selection.startPoint);
      if (!branches.some((branch) => branch.name === selection.startPoint)) {
        throw new WorkspaceError("The selected start branch does not exist.");
      }
      arguments_ = ["worktree", "add", "-b", selection.branch];
    } else {
      if (selection.startPoint !== undefined || existingBranch === undefined) {
        throw new WorkspaceError("Choose an existing local branch.");
      }
      if (existingBranch.checkedOut) {
        throw new WorkspaceError("That branch is already checked out.");
      }
      arguments_ = ["worktree", "add"];
    }

    const parent = join(
      this.requireDataRoot(),
      "worktrees",
      project.id,
    );
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const target = join(parent, codecastId);
    await ensureMissing(target);
    assertInside(this.requireDataRoot(), target);

    arguments_.push(target);
    arguments_.push(
      selection.createBranch ? selection.startPoint! : selection.branch,
    );
    try {
      await git(project.root, arguments_);
      const root = await realpath(target);
      assertInside(this.requireDataRoot(), root);
      return {
        mode: selection.mode,
        branch: selection.branch,
        root,
      };
    } catch (error) {
      throw new WorkspaceError("The Git worktree could not be created.", {
        cause: error,
      });
    }
  }

  async createCodecast(
    projectId: string,
    request: unknown,
    generationJobId?: string,
  ): Promise<CodecastRecord> {
    return this.mutate(async () => {
      const validation = validateCreateCodecastRequest(request);
      if (!validation.success) {
        throw new InvalidLibraryRequestError("Invalid Codecast request.");
      }
      const project = this.findProject(projectId);
      const codecastRequest = validation.data;
      if (generationJobId !== undefined && !SAFE_ID.test(generationJobId)) {
        throw new InvalidLibraryRequestError("Generation job identifier is invalid.");
      }
      this.validateModelSelection(codecastRequest);
      const id = this.createId();
      const workspace = await this.prepareWorkspace(
        project.id,
        id,
        codecastRequest.workspace,
      );
      const timestamp = this.now();
      const codecast: StoredCodecast = {
        id,
        projectId: project.id,
        ...(generationJobId === undefined ? {} : { generationJobId }),
        title: codecastRequest.title,
        outcome: codecastRequest.outcome,
        status: "generating",
        workspace: { mode: workspace.mode, branch: workspace.branch },
        workspaceRoot: workspace.root,
        models: structuredClone(codecastRequest.models),
        durationMs: null,
        progress: {
          positionMs: 0,
          completedChallengeIds: [],
          updatedAt: timestamp,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.requireDocument().codecasts.push(codecast);
      await this.persist();
      return publicCodecast(codecast);
    });
  }

  async listCodecasts(projectId: string): Promise<CodecastRecord[]> {
    await this.ready();
    this.findProject(projectId);
    return this.requireDocument().codecasts
      .filter((codecast) => codecast.projectId === projectId)
      .map(publicCodecast)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getReplayMetadata(id: string): Promise<CodecastReplayMetadata> {
    await this.ready();
    const codecast = this.findCodecast(id);
    if (
      codecast.generationJobId == null ||
      codecast.status === "generating" ||
      (codecast.status === "failed" &&
        codecast.error?.code !== "REPLAY_ARTIFACT_INVALID") ||
      codecast.status === "interrupted"
    ) {
      return {
        codecastId: codecast.id,
        projectId: codecast.projectId,
        action: replayAction(codecast.status),
        resumeAtMs: codecast.status === "completed" ? 0 : codecast.progress.positionMs,
        savedPositionMs: codecast.progress.positionMs,
        completedChallengeIds: [...codecast.progress.completedChallengeIds],
        manifestUrl: this.options.replayManifestUrl ?? null,
        audioUrl: null,
        manifest: null,
      };
    }
    const bundle = await this.readReplayBundle(codecast);
    return {
      codecastId: codecast.id,
      projectId: codecast.projectId,
      action: replayAction(codecast.status),
      resumeAtMs: codecast.status === "completed" ? 0 : codecast.progress.positionMs,
      savedPositionMs: codecast.progress.positionMs,
      completedChallengeIds: [...codecast.progress.completedChallengeIds],
      manifestUrl: `/api/codecasts/${codecast.id}/manifest`,
      audioUrl: `/api/codecasts/${codecast.id}/audio`,
      manifest: structuredClone(bundle.manifest),
    };
  }

  async getReplayManifest(id: string): Promise<CodecastManifest> {
    await this.ready();
    return structuredClone((await this.readReplayBundle(this.findCodecast(id))).manifest);
  }

  async getReplayAudioPath(id: string): Promise<string> {
    await this.ready();
    return (await this.readReplayBundle(this.findCodecast(id))).audioPath;
  }

  async getGenerationContext(id: string, jobId: string): Promise<{
    codecastId: string;
    projectId: string;
    jobId: string;
    projectRoot: string;
    models: CodecastModelSelection;
    authorModelId: string;
  }> {
    await this.ready();
    const codecast = this.findCodecast(id);
    if (codecast.generationJobId !== jobId) {
      throw new CodecastNotFoundError();
    }
    const authorModel = this.requireDocument().modelConfiguration.models.find(
      (model) => model.id === codecast.models.authoring,
    );
    if (authorModel === undefined) {
      throw new ModelSelectionError();
    }
    return {
      codecastId: codecast.id,
      projectId: codecast.projectId,
      jobId,
      projectRoot: codecast.workspaceRoot,
      models: structuredClone(codecast.models),
      authorModelId: authorModel.modelId,
    };
  }

  async promoteCodecastBundle(
    id: string,
    jobId: string,
    stagingDirectory: string,
  ): Promise<CodecastRecord> {
    try {
      return await this.mutate(async () => {
        const codecast = this.findCodecast(id);
        if (codecast.generationJobId !== jobId) {
          throw new ReplayArtifactError("Generation linkage does not match this Codecast.");
        }
        const staged = await validateCodecastBundle(stagingDirectory, {
          projectId: codecast.projectId,
          codecastId: codecast.id,
          jobId,
        });
        const codecastsRoot = join(this.requireDataRoot(), "codecasts");
        await mkdir(codecastsRoot, { recursive: true, mode: 0o700 });
        const destination = join(codecastsRoot, codecast.id);
        assertInside(this.requireDataRoot(), destination);
        if (await pathExists(destination)) {
          const installed = await validateCodecastBundle(destination, {
            projectId: codecast.projectId,
            codecastId: codecast.id,
            jobId,
          });
          await rm(stagingDirectory, { recursive: true, force: true });
          if (
            codecast.durationMs === installed.manifest.audio.durationMs &&
            ["ready", "in-progress", "completed"].includes(codecast.status) &&
            codecast.error === undefined
          ) {
            return publicCodecast(codecast);
          }
        } else {
          await rename(staged.directory, destination);
        }
        codecast.durationMs = staged.manifest.audio.durationMs;
        codecast.updatedAt = this.now();
        await this.persist();
        return publicCodecast(codecast);
      });
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async reconcileGenerationJobs(jobs: GenerationJob[]): Promise<void> {
    await this.mutate(async () => {
      const jobsById = new Map(jobs.map((job) => [job.id, job]));
      let changed = false;
      for (const codecast of this.requireDocument().codecasts) {
        if (codecast.generationJobId == null) {
          continue;
        }
        const job = jobsById.get(codecast.generationJobId);
        const bundle = await this.tryReadReplayBundle(codecast);
        if (
          bundle !== undefined &&
          (job === undefined ||
            (job.projectId === codecast.projectId && job.codecastId === codecast.id))
        ) {
          if (codecast.durationMs !== bundle.manifest.audio.durationMs) {
            codecast.durationMs = bundle.manifest.audio.durationMs;
            changed = true;
          }
          if (["generating", "failed", "interrupted"].includes(codecast.status)) {
            codecast.status = "ready";
            delete codecast.error;
            codecast.updatedAt = this.now();
            changed = true;
          }
          continue;
        }
        if (
          job === undefined || job.projectId !== codecast.projectId ||
          job.codecastId !== codecast.id
        ) {
          changed = setTerminalCodecastState(codecast, "interrupted", {
            code: "JOB_LINKAGE_INVALID",
            message: "Generation linkage could not be restored. Restart this job.",
          }, this.now()) || changed;
          continue;
        }

        if (job.status === "queued" || job.status === "running") {
          if (codecast.status !== "generating") {
            codecast.status = "generating";
            delete codecast.error;
            codecast.updatedAt = this.now();
            changed = true;
          }
        } else if (job.status === "failed") {
          changed = setTerminalCodecastState(codecast, "failed", job.error ?? {
            code: "JOB_FAILED",
            message: "Codecast generation failed. Retry generation.",
          }, this.now()) || changed;
        } else if (job.status === "interrupted" || job.status === "cancelled") {
          changed = setTerminalCodecastState(codecast, "interrupted", job.error ?? {
            code: "JOB_INTERRUPTED",
            message: "Generation was interrupted. Restart this job.",
          }, this.now()) || changed;
        } else if (job.status === "succeeded") {
          changed = setTerminalCodecastState(codecast, "failed", {
            code: "REPLAY_ARTIFACT_INVALID",
            message: "Generation finished without a valid replay bundle. Retry generation.",
          }, this.now()) || changed;
        }
      }
      if (changed) {
        await this.persist();
      }
    });
  }

  async updateCheckpoint(id: string, update: unknown): Promise<CodecastRecord> {
    return this.mutate(async () => {
      const validation = validatePlaybackCheckpointUpdate(update);
      if (!validation.success) {
        throw new InvalidCheckpointError("Invalid playback checkpoint.");
      }
      const codecast = this.findCodecast(id);
      const bundle = await this.readReplayBundle(codecast);
      validateCheckpoint(validation.data, bundle.manifest);
      if (codecast.status === "completed" && !validation.data.completed) {
        return publicCodecast(codecast);
      }
      codecast.progress = {
        positionMs: validation.data.positionMs,
        completedChallengeIds: [...validation.data.completedChallengeIds],
        updatedAt: this.now(),
      };
      codecast.status = validation.data.completed
        ? "completed"
        : validation.data.positionMs > 0 || validation.data.completedChallengeIds.length > 0
          ? "in-progress"
          : "ready";
      codecast.updatedAt = this.now();
      await this.persist();
      return publicCodecast(codecast);
    });
  }

  async deleteCodecast(id: string, confirmationId: string): Promise<{
    generationJobId?: string | null;
    projectId: string;
  }> {
    return this.mutate(async () => {
      if (!SAFE_ID.test(id) || id !== confirmationId) {
        throw new DeleteConfirmationError(
          "Deletion requires the exact Codecast identifier.",
        );
      }
      const codecast = this.findCodecast(id);
      const bundle = join(this.requireDataRoot(), "codecasts", codecast.id);
      assertInside(this.requireDataRoot(), bundle);
      let trashPath: string | undefined;
      if (await pathExists(bundle)) {
        const trashDirectory = join(this.requireDataRoot(), "Trash");
        await mkdir(trashDirectory, { recursive: true, mode: 0o700 });
        trashPath = join(trashDirectory, `${codecast.id}-${randomUUID()}`);
        assertInside(this.requireDataRoot(), trashPath);
        await rename(bundle, trashPath);
      }

      const document = this.requireDocument();
      document.codecasts = document.codecasts.filter(
        (stored) => stored.id !== codecast.id,
      );
      try {
        await this.persist();
      } catch (error) {
        document.codecasts.push(codecast);
        if (trashPath !== undefined) {
          await rename(trashPath, bundle).catch(() => undefined);
        }
        throw error;
      }
      return {
        projectId: codecast.projectId,
        ...(codecast.generationJobId === undefined
          ? {}
          : { generationJobId: codecast.generationJobId }),
      };
    });
  }

  async getModelConfiguration(): Promise<ModelConfiguration> {
    await this.ready();
    return structuredClone(this.requireDocument().modelConfiguration);
  }

  async updateModelConfiguration(
    update: unknown,
  ): Promise<ModelConfiguration> {
    return this.mutate(async () => {
      const validation = validateModelSettingsUpdate(update);
      if (!validation.success) {
        throw new InvalidLibraryRequestError("Invalid model configuration.");
      }
      const configuration = applyModelSettings(
        this.requireDocument().modelConfiguration,
        validation.data,
      );
      const configured = validateModelConfiguration(configuration);
      if (!configured.success) {
        throw new InvalidLibraryRequestError("Invalid model configuration.");
      }
      this.requireDocument().modelConfiguration = structuredClone(configured.data);
      await this.persist();
      return structuredClone(configured.data);
    });
  }

  private validateModelSelection(request: CreateCodecastRequest): void {
    const configuration = this.requireDocument().modelConfiguration;
    for (const role of ["authoring", "stt", "tts"] as const) {
      const selectedId = request.models[role];
      const model = configuration.models.find(
        (candidate) => candidate.id === selectedId,
      );
      if (model?.role !== role || !model.enabled || model.availability !== "ready") {
        throw new ModelSelectionError(
          `Choose an enabled and ready ${role} model.`,
        );
      }
      if (
        role === "authoring" &&
        !model.reasoningOptions.includes(request.models.authoringReasoning)
      ) {
        throw new ModelSelectionError(
          "Choose a reasoning level supported by the authoring model.",
        );
      }
    }
  }

  private readReplayBundle(codecast: StoredCodecast): Promise<ValidatedCodecastBundle> {
    if (codecast.generationJobId == null) {
      throw new ReplayArtifactError();
    }
    const bundle = join(this.requireDataRoot(), "codecasts", codecast.id);
    assertInside(this.requireDataRoot(), bundle);
    return validateCodecastBundle(bundle, {
      projectId: codecast.projectId,
      codecastId: codecast.id,
      jobId: codecast.generationJobId,
    });
  }

  private async tryReadReplayBundle(
    codecast: StoredCodecast,
  ): Promise<ValidatedCodecastBundle | undefined> {
    try {
      return await this.readReplayBundle(codecast);
    } catch (error) {
      if (error instanceof ReplayArtifactError) {
        return undefined;
      }
      throw error;
    }
  }

  private async resolveApprovedRoot(input: string): Promise<string> {
    if (!isAbsolute(input) || input.includes("\0")) {
      throw new ProjectApprovalError("Project path was not approved.");
    }
    let root: string;
    try {
      root = await realpath(input);
      if (!(await stat(root)).isDirectory()) {
        throw new ProjectApprovalError("Project must be a directory.");
      }
    } catch (error) {
      if (error instanceof ProjectApprovalError) {
        throw error;
      }
      throw new ProjectApprovalError("Project path was not approved.", {
        cause: error,
      });
    }

    const approved = await Promise.all(
      this.options.approvedProjectRoots.map(async (candidate) => {
        try {
          return await realpath(candidate);
        } catch {
          return undefined;
        }
      }),
    );
    if (!approved.includes(root)) {
      throw new ProjectApprovalError("Project path was not approved.");
    }
    return root;
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.ready();
      return await operation();
    } finally {
      release();
    }
  }

  private async ready(): Promise<void> {
    this.initialization ??= this.initialize();
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    await mkdir(this.options.dataDirectory, { recursive: true, mode: 0o700 });
    this.dataRoot = await realpath(this.options.dataDirectory);
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      if (!isLibraryDocument(parsed, this.requireDataRoot())) {
        throw new Error("Invalid project library document.");
      }
      this.document = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      this.document = {
        version: 1,
        projects: [],
        codecasts: [],
        modelConfiguration: structuredClone(DEFAULT_MODEL_CONFIGURATION),
      };
    }
  }

  private async persist(): Promise<void> {
    const temporary = join(
      this.requireDataRoot(),
      `.library-${randomUUID()}.tmp`,
    );
    await writeFile(
      temporary,
      `${JSON.stringify(this.requireDocument(), null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporary, this.filePath);
  }

  private findProject(id: string): ProjectRecord {
    if (!SAFE_ID.test(id)) {
      throw new ProjectNotFoundError();
    }
    const project = this.requireDocument().projects.find(
      (candidate) => candidate.id === id,
    );
    if (project === undefined) {
      throw new ProjectNotFoundError();
    }
    return project;
  }

  private findCodecast(id: string): StoredCodecast {
    if (!SAFE_ID.test(id)) {
      throw new CodecastNotFoundError();
    }
    const codecast = this.requireDocument().codecasts.find(
      (candidate) => candidate.id === id,
    );
    if (codecast === undefined) {
      throw new CodecastNotFoundError();
    }
    return codecast;
  }

  private createId(): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = this.options.idFactory?.() ?? randomUUID();
      if (!SAFE_ID.test(id)) {
        throw new InvalidLibraryRequestError(
          "Identifier factory returned an unsafe value.",
        );
      }
      if (
        !this.requireDocument().projects.some((project) => project.id === id) &&
        !this.requireDocument().codecasts.some((codecast) => codecast.id === id)
      ) {
        return id;
      }
    }
    throw new InvalidLibraryRequestError("Could not create a unique identifier.");
  }

  private requireDocument(): LibraryDocument {
    if (this.document === undefined) {
      throw new Error("Project library is not initialized.");
    }
    return this.document;
  }

  private requireDataRoot(): string {
    if (this.dataRoot === undefined) {
      throw new Error("Project library is not initialized.");
    }
    return this.dataRoot;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private get filePath(): string {
    return join(this.requireDataRoot(), "library.json");
  }
}

const SAFE_ID_OR_BRANCH = /^(?!-)(?!\/)(?!.*(?:\.\.|\/\/|@\{|[~^:?*\[\]\\\s]))(?!.*[\/.]$).+$/;

function isLibraryDocument(
  input: unknown,
  dataRoot: string,
): input is LibraryDocument {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const candidate = input as Partial<LibraryDocument>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.projects) ||
    !Array.isArray(candidate.codecasts) ||
    !validateModelConfiguration(candidate.modelConfiguration).success
  ) {
    return false;
  }

  const projectIds = new Set<string>();
  const projectRoots = new Set<string>();
  for (const project of candidate.projects) {
    if (
      !validateProjectRecord(project).success ||
      !isAbsolute(project.root) ||
      projectIds.has(project.id) ||
      projectRoots.has(project.root)
    ) {
      return false;
    }
    projectIds.add(project.id);
    projectRoots.add(project.root);
  }

  const codecastIds = new Set<string>();
  for (const stored of candidate.codecasts) {
    if (typeof stored !== "object" || stored === null) {
      return false;
    }
    const { workspaceRoot, ...codecast } = stored as StoredCodecast;
    const project = candidate.projects.find(
      (registered) => registered.id === codecast.projectId,
    );
    if (
      typeof workspaceRoot !== "string" ||
      !validateCodecastRecord(codecast).success ||
      project === undefined ||
      codecastIds.has(codecast.id)
    ) {
      return false;
    }
    const expectedRoot =
      codecast.workspace.mode === "local-checkout"
        ? project.root
        : join(dataRoot, "worktrees", project.id, codecast.id);
    if (workspaceRoot !== expectedRoot) {
      return false;
    }
    codecastIds.add(codecast.id);
  }
  return true;
}

async function inspectRepository(
  root: string,
): Promise<ProjectRecord["repository"]> {
  try {
    const { stdout } = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    if (stdout.trim() === "true") {
      return { kind: "git", currentBranch: await currentBranch(root) };
    }
  } catch {
    // A normal folder is a valid project; only Git-specific actions are absent.
  }
  return { kind: "folder", currentBranch: null };
}

async function currentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await git(root, ["symbolic-ref", "--short", "HEAD"]);
    const branch = stdout.trim();
    return SAFE_ID_OR_BRANCH.test(branch) ? branch : null;
  } catch {
    return null;
  }
}

async function validateGitBranch(root: string, branch: string): Promise<void> {
  if (!SAFE_ID_OR_BRANCH.test(branch)) {
    throw new WorkspaceError("Choose a valid Git branch.");
  }
  try {
    await git(root, ["check-ref-format", "--branch", branch]);
  } catch (error) {
    throw new WorkspaceError("Choose a valid Git branch.", { cause: error });
  }
}

function git(cwd: string, args: string[]) {
  return execFile("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1_000_000,
    timeout: 10_000,
  });
}

function publicCodecast(stored: StoredCodecast): CodecastRecord {
  const { workspaceRoot: _workspaceRoot, ...codecast } = stored;
  return structuredClone(codecast);
}

function replayAction(status: CodecastRecord["status"]): ReplayAction {
  switch (status) {
    case "generating":
      return "view-progress";
    case "ready":
      return "play";
    case "in-progress":
      return "resume";
    case "completed":
      return "replay";
    case "failed":
      return "retry";
    case "interrupted":
      return "restart-job";
  }
}

function setTerminalCodecastState(
  codecast: StoredCodecast,
  status: "failed" | "interrupted",
  error: { code: string; message: string },
  updatedAt: string,
): boolean {
  if (
    codecast.status === status &&
    codecast.error?.code === error.code &&
    codecast.error.message === error.message
  ) {
    return false;
  }
  codecast.status = status;
  codecast.error = { ...error };
  codecast.updatedAt = updatedAt;
  return true;
}

function validateCheckpoint(
  checkpoint: PlaybackCheckpointUpdate,
  manifest: CodecastManifest,
): void {
  if (
    checkpoint.positionMs > manifest.audio.durationMs ||
    (checkpoint.completed && checkpoint.positionMs !== manifest.audio.durationMs) ||
    new Set(checkpoint.completedChallengeIds).size !==
      checkpoint.completedChallengeIds.length
  ) {
    throw new InvalidCheckpointError("Playback checkpoint is outside this Codecast.");
  }
  const challengeIds = new Set(manifest.challenges.map((challenge) => challenge.id));
  if (checkpoint.completedChallengeIds.some((id) => !challengeIds.has(id))) {
    throw new InvalidCheckpointError("Playback checkpoint references another Codecast.");
  }
  const completedIds = new Set(checkpoint.completedChallengeIds);
  if (
    manifest.events.some(
      (event) =>
        event.type === "challenge.start" &&
        event.atMs < checkpoint.positionMs &&
        !completedIds.has(event.challengeId),
    ) ||
    (checkpoint.completed &&
      manifest.challenges.some((challenge) => !completedIds.has(challenge.id)))
  ) {
    throw new InvalidCheckpointError("Playback checkpoint crossed an unresolved challenge.");
  }
}

function applyModelSettings(
  current: ModelConfiguration,
  update: ModelSettingsUpdate,
): ModelConfiguration {
  const knownIds = new Set(current.models.map((model) => model.id));
  if (update.enabledModelIds.some((id) => !knownIds.has(id))) {
    throw new InvalidLibraryRequestError("Unknown model identifier.");
  }
  const enabled = new Set(update.enabledModelIds);
  return {
    models: current.models.map((model) => ({
      ...model,
      enabled: enabled.has(model.id),
    })),
    defaults: structuredClone(update.defaults),
  };
}

function assertInside(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new WorkspaceError("Workspace path escaped app-owned storage.");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureMissing(path: string): Promise<void> {
  if (await pathExists(path)) {
    throw new WorkspaceError("The app-owned worktree already exists.");
  }
}
