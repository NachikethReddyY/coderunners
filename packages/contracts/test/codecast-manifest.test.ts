import { readFile } from "node:fs/promises";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import { describe, expect, it } from "vitest";

import { validateCodecastManifest } from "../src/index.js";

describe("Codecast manifest contract", () => {
  it("accepts the golden lesson and rejects events outside its audio duration", async () => {
    const rawManifest = await readFile(
      new URL("manifest.json", fixtureRoot),
      "utf8",
    );
    const manifest = JSON.parse(rawManifest) as unknown;

    expect(validateCodecastManifest(manifest)).toEqual({
      success: true,
      data: manifest,
    });

    const eventOutsideAudio = structuredClone(manifest) as {
      events: Array<{ atMs: number }>;
    };
    eventOutsideAudio.events[0]!.atMs = 70_001;

    expect(validateCodecastManifest(eventOutsideAudio)).toEqual({
      success: false,
      errors: [
        {
          path: "/events/0/atMs",
          message: "Event time must be within the 70000ms audio duration.",
        },
      ],
    });
  });

  it("rejects unresolved challenge references and demo patches over the learner seam", async () => {
    const rawManifest = await readFile(
      new URL("manifest.json", fixtureRoot),
      "utf8",
    );
    const manifest = JSON.parse(rawManifest) as {
      challenges: Array<{
        checkCommandId: string;
        seam: { path: string };
      }>;
      events: Array<Record<string, unknown>>;
      project: { commands: Record<string, unknown> };
    };

    const unknownCommand = structuredClone(manifest);
    unknownCommand.challenges[0]!.checkCommandId = "missing-command";
    expect(validateCodecastManifest(unknownCommand)).toMatchObject({
      success: false,
      errors: [
        {
          path: "/challenges/0/checkCommandId",
          message: "Challenge check must reference a declared command.",
        },
      ],
    });

    const unknownChallenge = structuredClone(manifest);
    unknownChallenge.events.push({
      id: "missing-challenge-event",
      type: "challenge.start",
      atMs: 20_000,
      challengeId: "missing-challenge",
    });
    expect(validateCodecastManifest(unknownChallenge)).toMatchObject({
      success: false,
      errors: expect.arrayContaining([
        {
          path: `/events/${unknownChallenge.events.length - 1}/challengeId`,
          message: "Event must reference a declared challenge.",
        },
      ]),
    });

    const leakedSolution = structuredClone(manifest);
    leakedSolution.events.push({
      id: "solve-the-seam",
      type: "demo.patch",
      atMs: 20_000,
      path: leakedSolution.challenges[0]!.seam.path,
      patch: "+ onToggle(!completed)",
    });
    expect(validateCodecastManifest(leakedSolution)).toMatchObject({
      success: false,
      errors: expect.arrayContaining([
        {
          path: `/events/${leakedSolution.events.length - 1}/path`,
          message: "Demo patches must not target a protected learner seam.",
        },
      ]),
    });

    for (const unsafeCommand of [
      { executable: "node", args: ["-e", "process.exit()"] },
      { executable: "python3", args: ["-c", "raise SystemExit"] },
      { executable: "pnpm", args: ["exec", "arbitrary-tool"] },
    ]) {
      const unsafeManifest = structuredClone(manifest);
      unsafeManifest.project.commands = { unsafe: unsafeCommand };
      expect(validateCodecastManifest(unsafeManifest)).toMatchObject({
        success: false,
        errors: expect.arrayContaining([
          {
            path: "/project/commands/unsafe/args",
            message:
              "Command arguments must use an approved project-scoped form.",
          },
        ]),
      });
    }
  });
});
