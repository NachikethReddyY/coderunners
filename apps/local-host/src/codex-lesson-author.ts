import { Codex, type ThreadOptions, type TurnOptions } from "@openai/codex-sdk";
import { type ContractError } from "@coderunners/contracts";

import type {
  LessonAuthor,
  LessonAuthorRequest,
  LessonAuthorResult,
} from "./generation.js";
import {
  CodexUnavailableError,
  InvalidDraftResponseError,
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
    try {
      const thread = this.codex.startThread({
        workingDirectory: request.projectRoot,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        threadSource: "coderunners",
        ...(request.model === undefined ? {} : { model: request.model }),
        ...(request.reasoningEffort === undefined
          ? {}
          : { modelReasoningEffort: request.reasoningEffort }),
      });
      const turn = await thread.run(authorPrompt(request));

      if (thread.id === null) {
        throw new CodexUnavailableError();
      }

      return {
        threadId: thread.id,
        draft: parseDraft(turn.finalResponse),
      };
    } catch (error) {
      throw normalizeCodexError(error);
    }
  }

  async repair(
    result: LessonAuthorResult,
    errors: ContractError[],
  ): Promise<LessonAuthorResult> {
    try {
      const thread = this.codex.resumeThread(result.threadId);
      const turn = await thread.run(repairPrompt(errors));

      return {
        threadId: thread.id ?? result.threadId,
        draft: parseDraft(turn.finalResponse),
      };
    } catch (error) {
      throw normalizeCodexError(error);
    }
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
    "Inspect the project read-only. Return only a JSON-encoded Codecast draft that satisfies the requested contract.",
    "Voice: Direct-demo coach. Be a curious, practical developer who makes one useful idea feel obvious through a small working example.",
    "Give the lesson one clear outcome. Teach only the concepts and code needed to reach it; cut history, edge cases, setup detail, and alternatives unless they change the learner's next action.",
    "Open with a concrete payoff, surprising behavior, or familiar problem. Show the baseline or failure early, then make one small change and show its result.",
    "Explain each important change in this order: what changed, why it matters here, and what the learner can observe. Prefer a short before-and-after over abstract definitions.",
    "Write natural, compact spoken language. Use short sentences, direct verbs, and a helpful opinion grounded in the code. Be energetic without hype and honest about meaningful caveats.",
    "Do not make the script a narration of every token, punctuation mark, editor action, or definition. Name syntax only when it helps the learner understand the behavior they just saw.",
    "Use a simple arc: hook, visible baseline, one focused change, explanation, learner seam and check, then a short recap or next use. Keep each cue centered on one idea.",
    "Use original language. Do not imitate, attribute, or reuse catchphrases from any external creator or channel.",
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
    "Repair the previous Codecast draft and return the complete corrected draft as JSON only.",
    "Change only what is required by these validation errors:",
    details,
    "Keep semantic anchors instead of timestamps and preserve the protected learner seam.",
  ].join("\n\n");
}

function parseDraft(response: string): unknown {
  try {
    return JSON.parse(response) as unknown;
  } catch {
    throw new InvalidDraftResponseError();
  }
}

function normalizeCodexError(error: unknown): Error {
  return error instanceof InvalidDraftResponseError ||
    error instanceof CodexUnavailableError
    ? error
    : new CodexUnavailableError(error);
}
