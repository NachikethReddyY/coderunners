import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { fixtureRoot } from "../src/index.js";

describe("React habit-toggle golden fixture", () => {
  it("ships canonical PCM audio, a runnable workspace, and observable tracer states", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("manifest.json", fixtureRoot), "utf8"),
    ) as {
      audio: { src: string; durationMs: number };
      cues: Array<{ id: string; text: string; startMs: number; endMs: number }>;
      events: Array<{ id: string; atMs: number }>;
      project: { commands: { check: { args: string[] } } };
    };
    const timing = JSON.parse(
      await readFile(new URL("audio/timing.json", fixtureRoot), "utf8"),
    ) as {
      alignmentConfidence: number;
      cues: Array<{ id: string; startMs: number; endMs: number }>;
      words: Array<{ cueId: string; wordIndex: number; startMs: number; endMs: number }>;
    };
    const audio = await readFile(new URL(manifest.audio.src, fixtureRoot));
    expect(audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(audio.subarray(8, 12).toString("ascii")).toBe("WAVE");
    const byteRate = audio.readUInt32LE(28);
    const dataBytes = audio.readUInt32LE(40);
    expect(Math.round((dataBytes / byteRate) * 1_000)).toBe(
      manifest.audio.durationMs,
    );
    expect(manifest.audio.durationMs).toBeGreaterThanOrEqual(100_000);
    expect(manifest.audio.durationMs).toBeLessThanOrEqual(135_000);
    let peakAmplitude = 0;
    for (let offset = 44; offset < audio.length; offset += 2) {
      peakAmplitude = Math.max(peakAmplitude, Math.abs(audio.readInt16LE(offset)));
    }
    expect(peakAmplitude).toBeGreaterThan(256);
    expect(timing.alignmentConfidence).toBeGreaterThan(0.6);
    expect(manifest.cues.map(({ text: _text, ...cue }) => cue)).toEqual(timing.cues);
    const recreateWords = timing.words.filter((word) => word.cueId === "recreate");
    expect(manifest.events.find((event) => event.id === "start-try-it")?.atMs).toBe(
      recreateWords.at(-1)?.endMs,
    );

    const workspacePackage = JSON.parse(
      await readFile(new URL("workspace/package.json", fixtureRoot), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(workspacePackage.scripts).toMatchObject({
      dev: "vite",
      test: "vitest run",
    });
    expect(manifest.project.commands.check.args).toEqual(["test"]);
    expect(manifest.events.map((event) => event.id)).toEqual([
      "open-demo",
      "type-function-keyword",
      "type-function-name",
      "type-open-parenthesis",
      "type-parameter-name",
      "type-parameter-type",
      "focus-parameter-type",
      "type-close-parenthesis",
      "type-return-type",
      "type-function-body",
      "type-return-keyword",
      "type-label-prefix",
      "type-name-interpolation",
      "type-finish-statement",
      "type-close-function",
      "start-try-it",
    ]);
    expect(manifest.cues.map((cue) => cue.id)).toEqual([
      "intro",
      "declaration",
      "parameter",
      "return-type",
      "function-body",
      "review",
      "recreate",
      "next-lesson",
    ]);
    expect(manifest.cues.at(-1)?.text).toContain("Next");
    const workspaceConfiguration = await readFile(
      new URL("../../../pnpm-workspace.yaml", fixtureRoot),
      "utf8",
    );
    expect(workspaceConfiguration).toContain("packages/fixtures/*/workspace");
    const rootPackage = JSON.parse(
      await readFile(new URL("../../../package.json", fixtureRoot), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(rootPackage.scripts.test).toContain(
      "--filter=!coderunners-react-habit-toggle",
    );

    const component = await readFile(
      new URL("workspace/src/formatHabitLabel.ts", fixtureRoot),
      "utf8",
    );
    const focusedTest = await readFile(
      new URL("workspace/src/formatHabitLabel.test.ts", fixtureRoot),
      "utf8",
    );
    expect(component).toContain("export function formatHabitLabel");
    expect(focusedTest).toContain("formats a supplied habit name");

    const expectedStates = JSON.parse(
      await readFile(new URL("expected-states.json", fixtureRoot), "utf8"),
    ) as { states: Array<{ id: string }> };
    expect(expectedStates.states.map(({ id }) => id)).toEqual([
      "intro",
      "projected-typing",
      "challenge-reset",
      "check-passed",
      "next-lesson",
    ]);
  });
});
