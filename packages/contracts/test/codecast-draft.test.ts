import { readFile } from "node:fs/promises";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import { describe, expect, it } from "vitest";

import { validateCodecastDraft } from "../src/index.js";

describe("authored Codecast draft contract", () => {
  it("accepts semantic anchors and rejects an event anchored to an unknown cue", async () => {
    const rawDraft = await readFile(new URL("draft.json", fixtureRoot), "utf8");
    const draft = JSON.parse(rawDraft) as unknown;

    expect(validateCodecastDraft(draft)).toEqual({
      success: true,
      data: draft,
    });

    const unknownCue = structuredClone(draft) as {
      events: Array<{ anchor: { cueId: string } }>;
    };
    unknownCue.events[0]!.anchor.cueId = "missing-cue";

    expect(validateCodecastDraft(unknownCue)).toEqual({
      success: false,
      errors: [
        {
          path: "/events/0/anchor/cueId",
          message: "Event anchor must reference an existing cue.",
        },
      ],
    });
  });
});

