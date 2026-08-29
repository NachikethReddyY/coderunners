import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BranchSummary,
  CodecastRecord,
  ModelConfiguration,
  ProjectRecord,
} from "@coderunners/contracts";

vi.mock("../src/Studio.js", () => ({
  Studio: ({ onReturn }: { onReturn: () => void }) => (
    <main aria-label="Codecast player">
      <button type="button" onClick={onReturn}>Back to project</button>
    </main>
  ),
}));

import { CodeRunnersApp, type CodeRunnersApi } from "../src/App.js";

const project: ProjectRecord = {
  id: "habit-tracker",
  displayName: "Habit tracker",
  root: "/approved/habit-tracker",
  repository: { kind: "git", currentBranch: "main" },
  createdAt: "2026-08-29T08:00:00.000Z",
  lastOpenedAt: "2026-08-29T08:00:00.000Z",
};

const configuration: ModelConfiguration = {
  models: [
    {
      id: "openai:gpt-5.6-sol", providerId: "openai", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", role: "authoring", enabled: true, availability: "ready", reasoningOptions: ["medium", "high", "xhigh"],
    },
    {
      id: "openai:gpt-5.6-terra", providerId: "openai", modelId: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", role: "authoring", enabled: true, availability: "ready", reasoningOptions: ["medium", "high", "xhigh"],
    },
    {
      id: "local:whisper-medium-mlx", providerId: "local", modelId: "whisper-medium-mlx", displayName: "Whisper Medium MLX", role: "stt", enabled: true, availability: "ready", reasoningOptions: [],
    },
    {
      id: "local:kokoro-82m-8bit", providerId: "local", modelId: "kokoro-82m-8bit", displayName: "Kokoro 82M 8-bit", role: "tts", enabled: true, availability: "ready", reasoningOptions: [],
    },
  ],
  defaults: {
    authoring: "openai:gpt-5.6-sol",
    stt: "local:whisper-medium-mlx",
    tts: "local:kokoro-82m-8bit",
  },
};

const codecast: CodecastRecord = {
  id: "react-state", projectId: project.id, title: "Understanding React state", outcome: "Explain immutable updates.", status: "in-progress", workspace: { mode: "local-checkout", branch: "main" }, models: { authoring: "openai:gpt-5.6-sol", authoringReasoning: "high", stt: "local:whisper-medium-mlx", tts: "local:kokoro-82m-8bit" }, durationMs: 1_080_000,
  progress: { positionMs: 402_000, completedChallengeIds: [], updatedAt: "2026-08-29T08:00:00.000Z" },
  createdAt: "2026-08-29T08:00:00.000Z", updatedAt: "2026-08-29T08:00:00.000Z",
};

function createApi(overrides: Partial<CodeRunnersApi> = {}): CodeRunnersApi {
  return {
    health: vi.fn().mockResolvedValue({ status: "ok", capabilities: { codecastGeneration: true, files: true, pty: true } }),
    listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
    listBranches: vi.fn().mockResolvedValue({ branches: [{ name: "main", current: true, checkedOut: true }] satisfies BranchSummary[] }),
    listCodecasts: vi.fn().mockResolvedValue({ codecasts: [codecast] }),
    getModels: vi.fn().mockResolvedValue({ configuration }),
    createCodecast: vi.fn(),
    getReplay: vi.fn().mockResolvedValue({ replay: { codecastId: codecast.id, projectId: project.id, action: "resume", resumeAtMs: 402_000, savedPositionMs: 402_000, completedChallengeIds: [], manifestUrl: "/api/codecasts/react-state/manifest", audioUrl: "/api/codecasts/react-state/audio", manifest: {} } }),
    readReplayAudio: vi.fn().mockResolvedValue(new Blob(["audio"], { type: "audio/wav" })),
    updateCheckpoint: vi.fn(),
    deleteCodecast: vi.fn().mockResolvedValue(undefined),
    updateModels: vi.fn().mockResolvedValue({ configuration }),
    ...overrides,
  };
}

describe("CodeRunners application routes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("selects an enabled authoring model without leaving Home", async () => {
    render(<CodeRunnersApp api={createApi()} />);
    await screen.findByRole("button", { name: /GPT-5.6 Sol/ });

    fireEvent.click(screen.getByRole("button", { name: /Choose authoring model/ }));
    fireEvent.click(screen.getByRole("option", { name: /GPT-5.6 Terra/ }));

    expect(screen.getByRole("button", { name: /GPT-5.6 Terra/ })).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("keeps the accepted Home composer composition while retaining its controls", async () => {
    render(<CodeRunnersApp api={createApi()} />);

    await screen.findByRole("button", { name: /Choose project/ });
    expect(screen.queryByText("Local learning studio")).toBeNull();
    expect(screen.queryByText("Learning goal")).toBeNull();
    expect(screen.queryByLabelText("Authoring reasoning")).toBeNull();
    expect(screen.getByPlaceholderText("Ask for changes, send follow-ups, or attach images")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate Codecast" }).className).toContain("generate-button");
    expect(screen.getByLabelText("Workspace").closest(".workspace-bar")).toBeTruthy();
    expect(screen.getByLabelText("Branch").closest(".workspace-bar")).toBeTruthy();
    expect(document.querySelector(".project-question")?.textContent).toBe("Habit tracker?");

    fireEvent.click(screen.getByRole("button", { name: /Choose project/ }));
    fireEvent.click(screen.getByRole("option", { name: /Habit tracker/ }));
    expect(screen.getByRole("heading", { name: /What should we build in Habit tracker/ })).toBeTruthy();
  });

  it("uses the configured author model with the preferred internal reasoning default", async () => {
    const createCodecast = vi.fn().mockResolvedValue({ codecast });
    const api = createApi({ createCodecast });
    render(<CodeRunnersApp api={api} />);

    fireEvent.click(await screen.findByRole("button", { name: "Choose project: Habit tracker" }));
    fireEvent.click(screen.getByRole("option", { name: /Habit tracker/ }));
    fireEvent.change(screen.getByLabelText("Learning goal"), {
      target: { value: "Understand immutable state transitions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Codecast" }));

    await waitFor(() => expect(createCodecast).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        models: expect.objectContaining({
          authoring: "openai:gpt-5.6-sol",
          authoringReasoning: "high",
        }),
      }),
    ));
  });

  it("searches and selects a project from its compact Home picker", async () => {
    render(<CodeRunnersApp api={createApi()} />);
    await screen.findByRole("button", { name: /Choose project/ });

    fireEvent.click(screen.getByRole("button", { name: /Choose project/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "habit" } });
    fireEvent.click(screen.getByRole("option", { name: /Habit tracker/ }));

    expect(screen.getByRole("button", { name: "Choose project: Habit tracker" })).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("opens replay from the project collection and returns to the same collection", async () => {
    const api = createApi();
    render(<CodeRunnersApp api={api} initialPath="/projects/habit-tracker" />);
    const resume = await screen.findByRole("button", { name: "Resume Understanding React state" });
    expect(resume.textContent).toBe("Resume");

    fireEvent.click(resume);
    await screen.findByRole("main", { name: "Codecast player" });
    expect(api.getReplay).toHaveBeenCalledWith(codecast.id);
    expect(window.location.pathname).toBe("/projects/habit-tracker/codecasts/react-state");

    fireEvent.click(screen.getByRole("button", { name: "Back to project" }));
    await screen.findByRole("heading", { name: "Habit tracker" });
  });

  it("requires the exact Codecast ID before deleting only that Codecast", async () => {
    const api = createApi();
    render(<CodeRunnersApp api={api} initialPath="/projects/habit-tracker" />);
    await screen.findByRole("button", { name: "Delete Understanding React state" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Understanding React state" }));
    const confirm = screen.getByRole("button", { name: "Delete Codecast" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type react-state to confirm"), { target: { value: "react-state" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(api.deleteCodecast).toHaveBeenCalledWith("react-state", "react-state"));
    expect(screen.queryByText("Understanding React state")).toBeNull();
    expect(screen.getByRole("heading", { name: "Habit tracker" })).toBeTruthy();
  });

  it("updates enabled model defaults from Settings and returns to Home", async () => {
    const api = createApi();
    vi.mocked(api.updateModels).mockResolvedValue({
      configuration: {
        ...configuration,
        defaults: { ...configuration.defaults, authoring: "openai:gpt-5.6-terra" },
      },
    });
    render(<CodeRunnersApp api={api} />);
    await screen.findByRole("link", { name: "Settings" });

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Model settings" });
    fireEvent.click(screen.getByRole("button", { name: "Make GPT-5.6 Terra the authoring default" }));

    await waitFor(() => expect(api.updateModels).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("link", { name: "Back to Home" }));
    await screen.findByRole("button", { name: /GPT-5.6 Terra/ });
  });
});
