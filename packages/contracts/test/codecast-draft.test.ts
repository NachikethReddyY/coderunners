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

  it("resolves anchor phrases and rejects protected-seam demo patches", async () => {
    const rawDraft = await readFile(new URL("draft.json", fixtureRoot), "utf8");
    const draft = JSON.parse(rawDraft) as {
      challenges: Array<{ seam: { path: string } }>;
      events: Array<Record<string, unknown> & {
        anchor: { cueId: string; phrase: string; occurrence: number };
      }>;
    };

    const missingPhrase = structuredClone(draft);
    missingPhrase.events[0]!.anchor.phrase = "words absent from the cue";
    expect(validateCodecastDraft(missingPhrase)).toMatchObject({
      success: false,
      errors: [
        {
          path: "/events/0/anchor/phrase",
          message: "Event anchor phrase and occurrence must resolve inside its cue.",
        },
      ],
    });

    const missingOccurrence = structuredClone(draft);
    missingOccurrence.events[0]!.anchor.occurrence = 2;
    expect(validateCodecastDraft(missingOccurrence)).toMatchObject({
      success: false,
      errors: [
        {
          path: "/events/0/anchor/occurrence",
          message: "Event anchor phrase and occurrence must resolve inside its cue.",
        },
      ],
    });

    const leakedSolution = structuredClone(draft);
    leakedSolution.events.push({
      id: "solve-the-seam",
      type: "demo.patch",
      anchor: {
        cueId: "challenge",
        phrase: "Implement the toggle",
        occurrence: 1,
      },
      path: leakedSolution.challenges[0]!.seam.path,
      patch: "+ onToggle(!completed)",
    });
    expect(validateCodecastDraft(leakedSolution)).toMatchObject({
      success: false,
      errors: expect.arrayContaining([
        {
          path: `/events/${leakedSolution.events.length - 1}/path`,
          message: "Demo patches must not target a protected learner seam.",
        },
      ]),
    });

    const directAnswer = structuredClone(draft);
    directAnswer.challenges[0] = {
      ...directAnswer.challenges[0]!,
      hints: ["Call onToggle(!completed)."],
    } as never;
    expect(validateCodecastDraft(directAnswer)).toMatchObject({
      success: false,
      errors: expect.arrayContaining([
        {
          path: "/challenges/0/hints/0",
          message:
            "Challenge guidance must be prose and must not contain solution code.",
        },
      ]),
    });
  });
});
