import {
  validateCodecastDraft,
  type ContractError,
} from "@coderunners/contracts";

import { JsonJobStore } from "./jobs.js";

export type LessonAuthorRequest = {
  projectRoot: string;
  goal: string;
  diagnosticAnswers: string[];
};

export type LessonAuthorResult = {
  threadId: string;
  draft: unknown;
};

export type LessonAuthor = {
  author(request: LessonAuthorRequest): Promise<LessonAuthorResult>;
  repair?(
    result: LessonAuthorResult,
    errors: ContractError[],
  ): Promise<LessonAuthorResult>;
};

export class CodexUnavailableError extends Error {
  override readonly name = "CodexUnavailableError";

  constructor(cause?: unknown) {
    super("Codex is unavailable.", { cause });
  }
}

export class InvalidDraftResponseError extends Error {
  override readonly name = "InvalidDraftResponseError";

  constructor() {
    super("Codex returned an unreadable lesson draft.");
  }
}

export async function runGenerationJob(options: {
  jobId: string;
  jobs: JsonJobStore;
  lessonAuthor: LessonAuthor;
  request: LessonAuthorRequest;
}): Promise<void> {
  const { jobId, jobs, lessonAuthor, request } = options;

  try {
    const started = await jobs.update(jobId, {
      status: "running",
      phase: "authoring",
    });
    if (started.status === "cancelled") {
      return;
    }
    let result = await lessonAuthor.author(request);
    if ((await jobs.get(jobId))?.status === "cancelled") {
      return;
    }
    let validation = validateCodecastDraft(result.draft);

    if (!validation.success && lessonAuthor.repair !== undefined) {
      await jobs.update(jobId, { phase: "repairing" });
      result = await lessonAuthor.repair(result, validation.errors);
      if ((await jobs.get(jobId))?.status === "cancelled") {
        return;
      }
      validation = validateCodecastDraft(result.draft);
    }

    if (!validation.success) {
      await jobs.update(jobId, {
        status: "failed",
        phase: "validation-failed",
        error: {
          code: "INVALID_DRAFT",
          message: "Codex returned an invalid lesson draft. Retry generation.",
        },
      });
      return;
    }

    await jobs.update(jobId, {
      status: "succeeded",
      phase: "validated",
      result: { threadId: result.threadId, draft: validation.data },
    });
  } catch (error) {
    if ((await jobs.get(jobId))?.status === "cancelled") {
      return;
    }
    const failure = generationFailure(error);
    await jobs.update(jobId, {
      status: "failed",
      phase: "failed",
      error: failure,
    });
  }
}

function generationFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof CodexUnavailableError) {
    return {
      code: "CODEX_UNAVAILABLE",
      message:
        "Codex is unavailable. Check the local login, then retry generation.",
    };
  }
  if (error instanceof InvalidDraftResponseError) {
    return {
      code: "INVALID_DRAFT",
      message: "Codex returned an unreadable lesson draft. Retry generation.",
    };
  }
  return {
    code: "JOB_FAILED",
    message: "Codecast generation stopped while authoring. Retry generation.",
  };
}
