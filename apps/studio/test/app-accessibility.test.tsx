import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodeRunnersApi } from "../src/App.js";
import { CodeRunnersApp } from "../src/App.js";

vi.mock("../src/Studio.js", () => ({ Studio: () => <main aria-label="Codecast player" /> }));

const api: CodeRunnersApi = {
  health: vi.fn().mockResolvedValue({ status: "ok", capabilities: { codecastGeneration: true, files: true, pty: true } }),
  listProjects: vi.fn().mockResolvedValue({ projects: [
    { id: "project-1", displayName: "Project one", root: "/approved/project-one", repository: { kind: "git", currentBranch: "main" }, createdAt: "2026-08-29T08:00:00.000Z", lastOpenedAt: "2026-08-29T08:00:00.000Z" },
    { id: "project-2", displayName: "Project two", root: "/approved/project-two", repository: { kind: "git", currentBranch: "main" }, createdAt: "2026-08-29T08:00:00.000Z", lastOpenedAt: "2026-08-29T07:00:00.000Z" },
  ] }),
  listBranches: vi.fn().mockResolvedValue({ branches: [{ name: "main", current: true, checkedOut: true }] }),
  listCodecasts: vi.fn().mockResolvedValue({ codecasts: [{ id: "cast-1", projectId: "project-1", title: "State", outcome: "State", status: "ready", workspace: { mode: "local-checkout", branch: "main" }, models: { authoring: "openai:gpt-5.6-sol", authoringReasoning: "high", stt: "local:whisper", tts: "local:kokoro" }, durationMs: 60_000, progress: { positionMs: 0, completedChallengeIds: [], updatedAt: "2026-08-29T08:00:00.000Z" }, createdAt: "2026-08-29T08:00:00.000Z", updatedAt: "2026-08-29T08:00:00.000Z" }] }),
  createCodecast: vi.fn(),
  getReplay: vi.fn().mockResolvedValue({ replay: { codecastId: "cast-1", projectId: "project-1", action: "play", resumeAtMs: 0, completedChallengeIds: [], manifestUrl: "/codecast/cast-1/manifest.json" } }),
  readReplayAudio: vi.fn(),
  updateCheckpoint: vi.fn(),
  deleteCodecast: vi.fn().mockResolvedValue(undefined),
  getModels: vi.fn().mockResolvedValue({ configuration: { models: [{ id: "openai:gpt-5.6-sol", providerId: "openai", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", role: "authoring", enabled: true, availability: "ready", reasoningOptions: ["high"] }, { id: "local:whisper", providerId: "local", modelId: "whisper", displayName: "Whisper", role: "stt", enabled: true, availability: "ready", reasoningOptions: [] }, { id: "local:kokoro", providerId: "local", modelId: "kokoro", displayName: "Kokoro", role: "tts", enabled: true, availability: "ready", reasoningOptions: [] }], defaults: { authoring: "openai:gpt-5.6-sol", stt: "local:whisper", tts: "local:kokoro" } } }),
  updateModels: vi.fn(),
};

describe("CodeRunners keyboard and dialog behavior", () => {
  afterEach(() => cleanup());

  it("closes an open model selector with Escape and restores focus to its trigger", async () => {
    render(<CodeRunnersApp api={api} />);
    const trigger = await screen.findByRole("button", { name: /Choose authoring model/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "Author models" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Author models" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves through project results with the keyboard and restores focus after selection", async () => {
    render(<CodeRunnersApp api={api} />);
    const trigger = await screen.findByRole("button", { name: "Choose project: Project one" });
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "Search projects" });
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: "Enter" });

    expect(screen.getByRole("button", { name: "Choose project: Project two" })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab in the delete dialog and restores focus to its destructive trigger", async () => {
    render(<CodeRunnersApp api={api} initialPath="/projects/project-1" />);
    const trigger = await screen.findByRole("button", { name: "Delete State" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus to the collection after confirmed deletion removes its trigger", async () => {
    render(<CodeRunnersApp api={api} initialPath="/projects/project-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete State" }));
    fireEvent.change(screen.getByLabelText("Type cast-1 to confirm"), { target: { value: "cast-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Codecast" }));

    const heading = await screen.findByRole("heading", { name: "Project one" });
    expect(document.activeElement).toBe(heading);
  });
});
