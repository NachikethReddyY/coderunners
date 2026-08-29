import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type GenerationJob = {
  id: string;
  type: "codecast.generate";
  projectId?: string;
  codecastId?: string;
  status: JobStatus;
  phase: string;
  createdAt: string;
  updatedAt: string;
  result?: {
    threadId: string;
    draft: unknown;
  };
  error?: {
    code: string;
    message: string;
  };
};

type JobDocument = {
  version: 1;
  jobs: GenerationJob[];
};

export class JobNotFoundError extends Error {
  override readonly name = "JobNotFoundError";
}

export class JobNotCancellableError extends Error {
  override readonly name = "JobNotCancellableError";
}

export class JsonJobStore {
  private readonly jobs = new Map<string, GenerationJob>();
  private initialized = false;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly now: () => string,
  ) {}

  async create(job: GenerationJob): Promise<GenerationJob> {
    await this.initialize();
    if (this.jobs.has(job.id)) {
      throw new Error(`Job ${job.id} already exists.`);
    }
    this.jobs.set(job.id, structuredClone(job));
    await this.persist();
    return structuredClone(job);
  }

  async get(id: string): Promise<GenerationJob | undefined> {
    await this.initialize();
    const job = this.jobs.get(id);
    return job === undefined ? undefined : structuredClone(job);
  }

  async list(): Promise<GenerationJob[]> {
    await this.initialize();
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }

  async removeLinked(
    id: string | null | undefined,
    projectId: string,
    codecastId: string,
  ): Promise<void> {
    await this.initialize();
    if (id == null) {
      return;
    }
    const job = this.jobs.get(id);
    if (
      job === undefined ||
      job.projectId !== projectId ||
      job.codecastId !== codecastId
    ) {
      return;
    }
    this.jobs.delete(id);
    await this.persist();
  }

  async update(
    id: string,
    update: Partial<
      Pick<GenerationJob, "status" | "phase" | "result" | "error">
    >,
  ): Promise<GenerationJob> {
    await this.initialize();
    const current = this.jobs.get(id);
    if (current === undefined) {
      throw new JobNotFoundError();
    }
    if (current.status === "cancelled") {
      return structuredClone(current);
    }

    const next: GenerationJob = {
      ...current,
      ...update,
      updatedAt: this.now(),
    };
    this.jobs.set(id, next);
    await this.persist();
    return structuredClone(next);
  }

  async cancel(id: string): Promise<GenerationJob> {
    await this.initialize();
    const current = this.jobs.get(id);
    if (current === undefined) {
      throw new JobNotFoundError();
    }
    if (current.status !== "queued" && current.status !== "running") {
      throw new JobNotCancellableError();
    }
    const cancelled: GenerationJob = {
      ...current,
      status: "cancelled",
      phase: "cancelled",
      updatedAt: this.now(),
      error: {
        code: "JOB_CANCELLED",
        message: "Generation was cancelled. Start a new job when ready.",
      },
    };
    this.jobs.set(id, cancelled);
    await this.persist();
    return structuredClone(cancelled);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await mkdir(this.directory, { recursive: true });
    let interrupted = false;
    try {
      const document = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as JobDocument;
      for (const storedJob of document.jobs) {
        const job =
          storedJob.status === "queued" || storedJob.status === "running"
            ? {
                ...storedJob,
                status: "interrupted" as const,
                phase: "interrupted",
                updatedAt: this.now(),
                error: {
                  code: "JOB_INTERRUPTED",
                  message: "The local host restarted. Retry this job.",
                },
              }
            : storedJob;
        interrupted ||= job.status === "interrupted";
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    this.initialized = true;
    if (interrupted) {
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const persistAfter = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await persistAfter;
    try {
      const temporaryPath = join(
        this.directory,
        `.jobs-${randomUUID()}.tmp`,
      );
      const document: JobDocument = {
        version: 1,
        jobs: [...this.jobs.values()],
      };
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } finally {
      release();
    }
  }

  private get filePath(): string {
    return join(this.directory, "jobs.json");
  }
}
