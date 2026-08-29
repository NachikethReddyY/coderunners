import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/MonacoEditor.js", () => ({
  MonacoEditor: ({ value }: { value: string }) => <div>{value}</div>,
}));

vi.mock("../src/TerminalPanel.js", () => ({
  TerminalPanel: () => <div aria-label="Terminal output" />,
}));

import type { CodecastManifest } from "@coderunners/contracts";

import fixtureManifest from "../../../packages/fixtures/codecast-react/manifest.json" with { type: "json" };
import { Studio } from "../src/Studio.js";

describe("routed Codecast replay", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the existing player with the routed manifest and checkpoint", async () => {
    const manifest = structuredClone(fixtureManifest) as CodecastManifest;
    manifest.id = "routed-codecast";
    manifest.title = "Routed replay lesson";

    render(
      <Studio
        initialCheckpoint={{
          completedChallengeIds: [],
          positionMs: 2_000,
        }}
        lesson={{
          audioUrl: "data:audio/wav;base64,UklGRg==",
          manifest,
        }}
      />,
    );

    expect(await screen.findByText("Routed replay lesson")).toBeTruthy();
    const audio = document.querySelector("audio")!;
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText(/0:02 \/ 1:43/)).toBeTruthy();
    expect(audio.currentTime).toBe(2);
  });

  it("emits a completed checkpoint when replay reaches the validated end", async () => {
    vi.useFakeTimers();
    const manifest = structuredClone(fixtureManifest) as CodecastManifest;
    const onCheckpoint = vi.fn();
    render(
      <Studio
        initialCheckpoint={{
          completedChallengeIds: manifest.challenges.map((challenge) => challenge.id),
          positionMs: manifest.audio.durationMs - 1_000,
        }}
        lesson={{ audioUrl: "data:audio/wav;base64,UklGRg==", manifest }}
        onCheckpoint={onCheckpoint}
      />,
    );

    fireEvent.ended(document.querySelector("audio")!);
    await vi.advanceTimersByTimeAsync(500);

    expect(onCheckpoint).toHaveBeenLastCalledWith({
      completed: true,
      completedChallengeIds: manifest.challenges.map((challenge) => challenge.id),
      positionMs: manifest.audio.durationMs,
    });
    vi.useRealTimers();
  });
});
