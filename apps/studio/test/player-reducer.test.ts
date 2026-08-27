import { describe, expect, it } from "vitest";

import type { CodecastManifest } from "@coderunners/contracts";

import {
  createInitialPlayerState,
  playerReducer,
  restorePlayerState,
  serializePlayerState,
} from "../src/player-reducer.js";

const manifest = {
  id: "react-habit-toggle",
  audio: { durationMs: 70_000 },
  challenges: [{ id: "toggle-habit" }],
  events: [
    { id: "challenge", type: "challenge.start", atMs: 15_000, challengeId: "toggle-habit" },
    { id: "complete", type: "challenge.complete", atMs: 69_000, challengeId: "toggle-habit" },
  ],
} as CodecastManifest;

describe("Codecast player state", () => {
  it("pauses at a hard challenge and rejects forward seeking until proof succeeds", () => {
    const initial = createInitialPlayerState(manifest);
    const challenged = playerReducer(initial, { type: "clock.updated", timeMs: 15_000 }, manifest);

    expect(challenged.playback).toBe("paused");
    expect(challenged.activeChallengeId).toBe("toggle-habit");
    expect(challenged.forwardSeekLocked).toBe(true);

    const blockedSeek = playerReducer(challenged, { type: "seek.requested", timeMs: 60_000 }, manifest);
    expect(blockedSeek.timeMs).toBe(15_000);

    const unlocked = playerReducer(challenged, { type: "proof.succeeded", challengeId: "toggle-habit" }, manifest);
    const resumedSeek = playerReducer(unlocked, { type: "seek.requested", timeMs: 60_000 }, manifest);

    expect(unlocked.forwardSeekLocked).toBe(false);
    expect(resumedSeek.timeMs).toBe(60_000);
  });

  it("pauses on the first learner mutation and restores an incomplete challenge", () => {
    const challenged = playerReducer(
      createInitialPlayerState(manifest),
      { type: "clock.updated", timeMs: 15_000 },
      manifest,
    );
    const edited = playerReducer(challenged, { type: "learner.mutated" }, manifest);
    const restored = restorePlayerState(serializePlayerState(edited), manifest);

    expect(edited.playback).toBe("paused");
    expect(restored).toEqual(edited);
  });
});
