import { Codex, type ThreadOptions, type TurnOptions } from "@openai/codex-sdk";
import { CodecastDraftSchema, type ContractError } from "@coderunners/contracts";

import type {
  LessonAuthor,
  LessonAuthorRequest,
  LessonAuthorResult,
} from "./generation.js";

export type CodexThreadPort = {
  readonly id: string | null;
  run(
    input: string,
    options?: TurnOptions,
  ): Promise<{ finalResponse: string }>;
};

export type CodexClientPort = {
  startThread(options?: ThreadOptions): CodexThreadPort;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadPort;
};

export class CodexLessonAuthor implements LessonAuthor {
  constructor(private readonly codex: CodexClientPort = new Codex()) {}

  async author(request: LessonAuthorRequest): Promise<LessonAuthorResult> {
    const thread = this.codex.startThread({
      workingDirectory: request.projectRoot,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      threadSource: "coderunners",
    });
    const turn = await thread.run(authorPrompt(request), {
      outputSchema: CodecastDraftSchema,
    });

    if (thread.id === null) {
      throw new Error("Codex thread did not expose an ID.");
    }

    return {
      threadId: thread.id,
      draft: parseDraft(turn.finalResponse),
    };
  }

  async repair(
    result: LessonAuthorResult,
    errors: ContractError[],
  ): Promise<LessonAuthorResult> {
    const thread = this.codex.resumeThread(result.threadId);
    const turn = await thread.run(repairPrompt(errors), {
      outputSchema: CodecastDraftSchema,
    });

    return {
      threadId: thread.id ?? result.threadId,
      draft: parseDraft(turn.finalResponse),
    };
  }
}

function authorPrompt(request: LessonAuthorRequest): string {
  return [
    "Author one short CodeRunners Codecast draft for the selected project.",
    `Learning goal: ${request.goal}`,
    "Diagnostic answers:",
    ...request.diagnosticAnswers.map((answer, index) =>
      `${index + 1}. ${answer}`,
    ),
    "Inspect the project read-only. Return only the structured draft requested by the output schema.",
    "Author canonical spoken cues and semantic word anchors; never invent milliseconds.",
    "Protect one concept-bearing learner seam. Give progressive hints and a behavioral check, but never write or reveal the completed seam solution.",
    "Demo patches describe only an isolated projection and must never target the learner workspace at runtime.",
  ].join("\n\n");
}

function repairPrompt(errors: ContractError[]): string {
  const details = errors
    .map((error) => `${error.path}: ${error.message}`)
    .join("\n");

  return [
    "Repair the previous Codecast draft and return the complete corrected draft.",
    "Change only what is required by these validation errors:",
    details,
    "Keep semantic anchors instead of timestamps and preserve the protected learner seam.",
  ].join("\n\n");
}

function parseDraft(response: string): unknown {
  return JSON.parse(response) as unknown;
}

