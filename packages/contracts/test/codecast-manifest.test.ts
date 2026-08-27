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
});

