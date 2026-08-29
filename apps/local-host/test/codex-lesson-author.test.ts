import { readFile } from "node:fs/promises";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import { describe, expect, it } from "vitest";

import {
  CodexLessonAuthor,
  type CodexClientPort,
} from "../src/index.js";

describe("Codex lesson author adapter", () => {
  it("runs a read-only structured-output thread in the selected project", async () => {
    const draft = JSON.parse(
      await readFile(new URL("draft.json", fixtureRoot), "utf8"),
    ) as unknown;
    const calls: {
      threadOptions?: unknown;
      input?: string;
      turnOptions?: unknown;
    } = {};
    const codex: CodexClientPort = {
      startThread(threadOptions) {
        calls.threadOptions = threadOptions;
        return {
          id: "thread-1",
          async run(input, turnOptions) {
            calls.input = input;
            calls.turnOptions = turnOptions;
            return { finalResponse: JSON.stringify(draft) };
          },
        };
      },
      resumeThread() {
        throw new Error("not used");
      },
    };

    const result = await new CodexLessonAuthor(codex).author({
      projectRoot: "/tmp/habit-tracker",
      goal: "Teach the state transition in a habit toggle.",
      diagnosticAnswers: ["I know React props.", "I am new to callbacks."],
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
    });

    expect(result).toEqual({ threadId: "thread-1", draft });
    expect(calls.threadOptions).toEqual({
      workingDirectory: "/tmp/habit-tracker",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      model: "gpt-5.6-sol",
      modelReasoningEffort: "xhigh",
      networkAccessEnabled: false,
      threadSource: "coderunners",
    });
    expect(calls.turnOptions).toBeUndefined();
    expect(calls.input).toContain(
      "Teach the state transition in a habit toggle.",
    );
    expect(calls.input).toContain("I am new to callbacks.");
    expect(calls.input).toContain("Direct-demo coach");
    expect(calls.input).toContain("one clear outcome");
    expect(calls.input).toContain("not make the script a narration of every token");
  });

  it("keeps the underlying Codex failure available for local diagnosis", async () => {
    const rootCause = new Error("Codex CLI could not start");
    const codex: CodexClientPort = {
      startThread() {
        return {
          id: null,
          async run() {
            throw rootCause;
          },
        };
      },
      resumeThread() {
        throw new Error("not used");
      },
    };

    await expect(
      new CodexLessonAuthor(codex).author({
        projectRoot: "/tmp/habit-tracker",
        goal: "Teach React props.",
        diagnosticAnswers: [],
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    ).rejects.toHaveProperty("cause", rootCause);
  });
});
