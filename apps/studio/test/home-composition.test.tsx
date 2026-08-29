import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/Studio.js", () => ({ Studio: () => <main aria-label="Codecast player" /> }));

import type { CodeRunnersApi } from "../src/App.js";
import { CodeRunnersApp } from "../src/App.js";

const api: CodeRunnersApi = {
  health: vi.fn(),
  listProjects: vi.fn().mockResolvedValue({
    projects: [{
      id: "project-1",
      displayName: "Project one",
      root: "/approved/project-one",
      repository: { kind: "git", currentBranch: "main" },
      createdAt: "2026-08-29T08:00:00.000Z",
      lastOpenedAt: "2026-08-29T08:00:00.000Z",
    }],
  }),
  listBranches: vi.fn().mockResolvedValue({ branches: [{ name: "main", current: true, checkedOut: true }] }),
  listCodecasts: vi.fn(),
  createCodecast: vi.fn(),
  getReplay: vi.fn(),
  readReplayAudio: vi.fn(),
  updateCheckpoint: vi.fn(),
  deleteCodecast: vi.fn(),
  getModels: vi.fn().mockResolvedValue({
    configuration: {
      models: [
        { id: "openai:sol", providerId: "openai", modelId: "sol", displayName: "GPT-5.6 Sol", role: "authoring", enabled: true, availability: "ready", reasoningOptions: ["high"] },
        { id: "local:kokoro", providerId: "local", modelId: "kokoro", displayName: "Kokoro 82M", role: "tts", enabled: true, availability: "ready", reasoningOptions: [] },
        { id: "local:whisper", providerId: "local", modelId: "whisper", displayName: "Whisper Medium", role: "stt", enabled: true, availability: "ready", reasoningOptions: [] },
      ],
      defaults: { authoring: "openai:sol", tts: "local:kokoro", stt: "local:whisper" },
    },
  }),
  updateModels: vi.fn(),
};

describe("Home composer composition", () => {
  afterEach(cleanup);

  it("keeps the prompt and its three model selectors in one surface with workspace context attached", async () => {
    render(<CodeRunnersApp api={api} />);

    const prompt = await screen.findByLabelText("Learning goal");
    const surface = prompt.closest<HTMLElement>(".prompt-surface");
    expect(surface).toBeTruthy();
    expect(screen.queryByText("Learning goal")).toBeNull();
    expect(screen.queryByLabelText("Authoring reasoning")).toBeNull();

    const controls = within(surface!).getByLabelText("Codecast model controls");
    expect(within(controls).getByRole("button", { name: /Choose authoring model: GPT-5.6 Sol/ })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: /Choose tts model: Kokoro 82M/ })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: /Choose stt model: Whisper Medium/ })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: "Generate Codecast" })).toBeTruthy();

    const workspaceBar = surface!.parentElement?.querySelector<HTMLElement>(".workspace-bar");
    expect(workspaceBar).toBeTruthy();
    expect(within(workspaceBar!).getByLabelText("Workspace")).toBeTruthy();
    expect(within(workspaceBar!).getByLabelText("Branch")).toBeTruthy();
  });

  it("keeps model roles concise and grows the prompt without exposing a resize control", async () => {
    render(<CodeRunnersApp api={api} />);

    const prompt = await screen.findByLabelText<HTMLTextAreaElement>("Learning goal");
    Object.defineProperty(prompt, "scrollHeight", { configurable: true, value: 156 });
    fireEvent.change(prompt, { target: { value: "A longer learning goal" } });

    expect(prompt.rows).toBe(1);
    expect(prompt.style.height).toBe("156px");
    expect(screen.queryByText("Author")).toBeNull();
    expect(screen.queryByText("TTS")).toBeNull();
    expect(screen.queryByText("STT")).toBeNull();
    expect(document.querySelector(".openai-logo")).toBeTruthy();
    expect(document.querySelectorAll(".model-glyph")).toHaveLength(2);
  });
});
