import { readFile } from "node:fs/promises";

import { CodecastDraftSchema } from "@coderunners/contracts";
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
    });

    expect(result).toEqual({ threadId: "thread-1", draft });
    expect(calls.threadOptions).toEqual({
      workingDirectory: "/tmp/habit-tracker",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      threadSource: "coderunners",
    });
    expect(calls.turnOptions).toEqual({ outputSchema: CodecastDraftSchema });
    expect(calls.input).toContain(
      "Teach the state transition in a habit toggle.",
    );
    expect(calls.input).toContain("I am new to callbacks.");
  });
});
