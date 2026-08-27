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

export async function runGenerationJob(options: {
  jobId: string;
  jobs: JsonJobStore;
  lessonAuthor: LessonAuthor;
  request: LessonAuthorRequest;
}): Promise<void> {
  const { jobId, jobs, lessonAuthor, request } = options;

  try {
    await jobs.update(jobId, { status: "running", phase: "authoring" });
    let result = await lessonAuthor.author(request);
    let validation = validateCodecastDraft(result.draft);

    if (!validation.success && lessonAuthor.repair !== undefined) {
      await jobs.update(jobId, { phase: "repairing" });
      result = await lessonAuthor.repair(result, validation.errors);
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
  } catch {
    await jobs.update(jobId, {
      status: "failed",
      phase: "failed",
      error: {
        code: "JOB_FAILED",
        message: "Codecast generation failed. Retry this job.",
      },
    });
  }
}

