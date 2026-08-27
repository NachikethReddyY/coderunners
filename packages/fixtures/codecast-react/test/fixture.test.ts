import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { fixtureRoot } from "../src/index.js";

describe("React habit-toggle golden fixture", () => {
  it("ships canonical PCM audio, a runnable workspace, and observable tracer states", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("manifest.json", fixtureRoot), "utf8"),
    ) as { audio: { src: string; durationMs: number } };
    const audio = await readFile(new URL(manifest.audio.src, fixtureRoot));
    expect(audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(audio.subarray(8, 12).toString("ascii")).toBe("WAVE");
    const byteRate = audio.readUInt32LE(28);
    const dataBytes = audio.readUInt32LE(40);
    expect(Math.round((dataBytes / byteRate) * 1_000)).toBe(
      manifest.audio.durationMs,
    );

    const workspacePackage = JSON.parse(
      await readFile(new URL("workspace/package.json", fixtureRoot), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(workspacePackage.scripts).toMatchObject({
      dev: "vite",
      test: "vitest run",
    });

    const component = await readFile(
      new URL("workspace/src/components/HabitRow.tsx", fixtureRoot),
      "utf8",
    );
    const focusedTest = await readFile(
      new URL("workspace/src/components/HabitRow.test.tsx", fixtureRoot),
      "utf8",
    );
    expect(component).toContain("export function HabitRow");
    expect(focusedTest).toContain("toggles the completed state");

    const expectedStates = JSON.parse(
      await readFile(new URL("expected-states.json", fixtureRoot), "utf8"),
    ) as { states: Array<{ id: string }> };
    expect(expectedStates.states.map(({ id }) => id)).toEqual([
      "initial",
      "learner-edit",
      "check-passed",
      "preview-changed",
      "challenge-unlocked",
    ]);
  });
});
