import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodeRunnersApi } from "../src/App.js";
import { CodeRunnersApp } from "../src/App.js";

vi.mock("../src/Studio.js", () => ({ Studio: () => <main aria-label="Codecast player" /> }));

const api: CodeRunnersApi = {
  health: vi.fn(),
  listProjects: vi.fn().mockResolvedValue({ projects: [{ id: "project-1", displayName: "Project one", root: "/approved/project-one", repository: { kind: "git", currentBranch: "main" }, createdAt: "2026-08-29T08:00:00.000Z", lastOpenedAt: "2026-08-29T08:00:00.000Z" }] }),
  listBranches: vi.fn(),
  listCodecasts: vi.fn().mockResolvedValue({ codecasts: [{ id: "cast-1", projectId: "project-1", title: "State", outcome: "State", status: "ready", workspace: { mode: "local-checkout", branch: "main" }, models: { authoring: "openai:gpt-5.6-sol", authoringReasoning: "high", stt: "local:whisper", tts: "local:kokoro" }, durationMs: 60_000, progress: { positionMs: 0, completedChallengeIds: [], updatedAt: "2026-08-29T08:00:00.000Z" }, createdAt: "2026-08-29T08:00:00.000Z", updatedAt: "2026-08-29T08:00:00.000Z" }] }),
  createCodecast: vi.fn(),
  getReplay: vi.fn().mockResolvedValue({ replay: { codecastId: "cast-1", projectId: "project-1", action: "play", resumeAtMs: 0, completedChallengeIds: [], manifestUrl: null } }),
  readReplayAudio: vi.fn(),
  updateCheckpoint: vi.fn(),
  deleteCodecast: vi.fn(),
  getModels: vi.fn(),
  updateModels: vi.fn(),
};

describe("Codecast library unavailable replay", () => {
  afterEach(() => cleanup());

  it("does not enter the player when the registry has no replay manifest", async () => {
    render(<CodeRunnersApp api={api} initialPath="/projects/project-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Play State" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Replay is not available yet");
    expect(screen.queryByRole("main", { name: "Codecast player" })).toBeNull();
  });

  it("refreshes a generating Codecast instead of treating progress as a replay failure", async () => {
    const generating = { ...(await api.listCodecasts("project-1")).codecasts[0]!, status: "generating" as const };
    const ready = { ...generating, status: "ready" as const };
    const listCodecasts = vi.fn()
      .mockResolvedValueOnce({ codecasts: [generating] })
      .mockResolvedValueOnce({ codecasts: [ready] });
    const getReplay = vi.fn();

    render(<CodeRunnersApp api={{ ...api, listCodecasts, getReplay }} initialPath="/projects/project-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "View progress State" }));

    expect(await screen.findByRole("button", { name: "Play State" })).toBeTruthy();
    expect(getReplay).not.toHaveBeenCalled();
  });

  it("restarts an interrupted job and explains the recorded interruption", async () => {
    const interrupted = {
      ...(await api.listCodecasts("project-1")).codecasts[0]!,
      status: "interrupted" as const,
      error: { code: "JOB_INTERRUPTED", message: "The local host restarted. Retry this job." },
    };
    const restarted = { ...interrupted, id: "cast-2", status: "generating" as const, error: undefined };
    const createCodecast = vi.fn().mockResolvedValue({ codecast: restarted });

    render(<CodeRunnersApp api={{ ...api, createCodecast, listCodecasts: vi.fn().mockResolvedValue({ codecasts: [interrupted] }) }} initialPath="/projects/project-1" />);
    expect(await screen.findByText("The local host restarted. Retry this job.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart job State" }));

    expect(createCodecast).toHaveBeenCalledWith("project-1", expect.objectContaining({ outcome: "State" }));
    expect(await screen.findByRole("button", { name: "View progress State" })).toBeTruthy();
  });
});
