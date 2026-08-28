import { describe, expect, it } from "vitest";

import {
  compileCodecastManifest,
  type CodecastDraft,
  type MediaGenerationResult,
} from "../src/index.js";

const draft = {
  schemaVersion: 1,
  id: "timed-lesson",
  title: "Timed lesson",
  project: {
    name: "timed-project",
    entryFile: "src/main.ts",
    commands: { check: { executable: "pnpm", args: ["test"] } },
  },
  cues: [
    { id: "intro", text: "Open the file, then inspect the state." },
    { id: "challenge", text: "Implement the toggle and prove it." },
  ],
  events: [
    {
      id: "inspect-state",
      type: "editor.focusRange",
      anchor: { cueId: "intro", phrase: "inspect the state", occurrence: 1 },
      path: "src/main.ts",
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
    },
    {
      id: "type-demo",
      type: "demo.patch",
      anchor: { cueId: "intro", phrase: "Open the file", occurrence: 1 },
      path: "src/demo.ts",
      patch: "export function demo",
    },
    {
      id: "start-challenge",
      type: "challenge.start",
      anchor: {
        cueId: "challenge",
        phrase: "Implement the toggle",
        occurrence: 1,
        edge: "end",
      },
      challengeId: "toggle",
    },
  ],
  challenges: [
    {
      id: "toggle",
      title: "Toggle it",
      instruction: "Update the state transition.",
      seam: { path: "src/main.ts", startLine: 1, endLine: 1 },
      hints: ["Inspect the current value."],
      checkCommandId: "check",
    },
  ],
} satisfies CodecastDraft;

const timing = {
  audio: { path: "/tmp/codecast.wav", format: "pcm-wav", durationMs: 2_000 },
  cues: [
    { id: "intro", startMs: 0, endMs: 1_000 },
    { id: "challenge", startMs: 1_000, endMs: 2_000 },
  ],
  timing: {
    schemaVersion: 1,
    durationMs: 2_000,
    alignmentConfidence: 0.95,
    words: [
      ...[100, 200, 300, 400, 500, 640, 780].map((startMs, wordIndex) => ({
        cueId: "intro",
        wordIndex,
        startMs,
        endMs: startMs + 80,
        confidence: 0.95,
      })),
      ...[1_080, 1_220, 1_360, 1_500, 1_640, 1_780].map((startMs, wordIndex) => ({
        cueId: "challenge",
        wordIndex,
        startMs,
        endMs: startMs + 80,
        confidence: 0.95,
      })),
    ],
  },
} satisfies MediaGenerationResult;

describe("Codecast compilation", () => {
  it("uses STT word starts for authored phrase anchors", () => {
    const result = compileCodecastManifest(draft, timing, "audio/codecast.wav");

    expect(result).toMatchObject({
      success: true,
      data: {
        audio: { durationMs: 2_000 },
        cues: [
          { id: "intro", startMs: 0, endMs: 1_000 },
          { id: "challenge", startMs: 1_000, endMs: 2_000 },
        ],
        events: [
          { id: "inspect-state", atMs: 500 },
          { id: "type-demo", atMs: 100, endMs: 380 },
          { id: "start-challenge", atMs: 1_440 },
        ],
      },
    });
  });

  it("fails closed when STT timing cannot resolve an anchor word", () => {
    const incompleteTiming = structuredClone(timing);
    incompleteTiming.timing.words = incompleteTiming.timing.words.filter(
      (word) => !(word.cueId === "challenge" && word.wordIndex === 2),
    );

    expect(compileCodecastManifest(draft, incompleteTiming, "audio/codecast.wav")).toEqual({
      success: false,
      errors: [{ path: "/events/2/anchor", message: "STT timing is missing for the anchor phrase." }],
    });
  });
});
