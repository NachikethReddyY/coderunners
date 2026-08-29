import { describe, expect, it } from "vitest";

import {
  validateCreateCodecastRequest,
  validateModelConfiguration,
  validateModelSettingsUpdate,
  validatePlaybackCheckpointUpdate,
  validateWorkspaceSelection,
} from "../src/index.js";

const configuredModels = {
  models: [
    {
      id: "openai:gpt-5.6-sol",
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      displayName: "GPT-5.6 Sol",
      role: "authoring",
      enabled: true,
      availability: "ready",
      reasoningOptions: ["medium", "high", "xhigh"],
    },
    {
      id: "local:whisper-medium-mlx",
      providerId: "local",
      modelId: "whisper-medium-mlx",
      displayName: "Whisper Medium MLX",
      role: "stt",
      enabled: true,
      availability: "ready",
      reasoningOptions: [],
    },
    {
      id: "local:kokoro-82m-8bit",
      providerId: "local",
      modelId: "kokoro-82m-8bit",
      displayName: "Kokoro 82M 8-bit",
      role: "tts",
      enabled: true,
      availability: "ready",
      reasoningOptions: [],
    },
  ],
  defaults: {
    authoring: "openai:gpt-5.6-sol",
    stt: "local:whisper-medium-mlx",
    tts: "local:kokoro-82m-8bit",
  },
} as const;

describe("project-library contracts", () => {
  it("accepts one enabled, role-matched default for every model role", () => {
    expect(validateModelConfiguration(configuredModels)).toEqual({
      success: true,
      data: configuredModels,
    });

    const wrongRole = structuredClone(configuredModels) as {
      defaults: { authoring: string; stt: string; tts: string };
      models: Array<{ id: string; enabled: boolean; role: string }>;
    };
    wrongRole.defaults.tts = "openai:gpt-5.6-sol";
    expect(validateModelConfiguration(wrongRole)).toMatchObject({
      success: false,
      errors: expect.arrayContaining([
        {
          path: "/defaults/tts",
          message: "Default must reference an enabled tts model.",
        },
      ]),
    });
  });

  it("lets Settings update selections without accepting provider metadata", () => {
    const update = {
      enabledModelIds: [
        "openai:gpt-5.6-terra",
        "local:whisper-medium-mlx",
        "local:kokoro-82m-8bit",
      ],
      defaults: {
        authoring: "openai:gpt-5.6-terra",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    } as const;
    expect(validateModelSettingsUpdate(update)).toEqual({
      success: true,
      data: update,
    });
    expect(
      validateModelSettingsUpdate({
        ...update,
        models: [{ id: "spoofed", availability: "ready" }],
      }),
    ).toMatchObject({ success: false });
  });

  it("rejects unsafe branch names and path-bearing workspace input", () => {
    expect(
      validateWorkspaceSelection({
        mode: "new-worktree",
        branch: "feature/codecast-library",
        createBranch: true,
        startPoint: "main",
      }),
    ).toMatchObject({ success: true });

    for (const workspace of [
      { mode: "local-checkout", branch: "../outside" },
      {
        mode: "new-worktree",
        branch: "feature/safe",
        createBranch: true,
        startPoint: "main",
        path: "/tmp/user-controlled",
      },
    ]) {
      expect(validateWorkspaceSelection(workspace)).toMatchObject({
        success: false,
      });
    }
  });

  it("defines a bounded create request with explicit model and workspace selections", () => {
    const request = {
      title: "Understanding React state",
      outcome: "Explain immutable state transitions.",
      workspace: { mode: "local-checkout", branch: "main" },
      models: {
        authoring: "openai:gpt-5.6-sol",
        authoringReasoning: "high",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    } as const;

    expect(validateCreateCodecastRequest(request)).toEqual({
      success: true,
      data: request,
    });
    expect(
      validateCreateCodecastRequest({ ...request, projectRoot: "/tmp/nope" }),
    ).toMatchObject({ success: false });
  });

  it("accepts only the narrow playback checkpoint mutation", () => {
    const checkpoint = {
      positionMs: 2_000,
      completedChallengeIds: ["format-habit-label"],
      completed: false,
    } as const;
    expect(validatePlaybackCheckpointUpdate(checkpoint)).toEqual({
      success: true,
      data: checkpoint,
    });
    expect(
      validatePlaybackCheckpointUpdate({
        ...checkpoint,
        status: "completed",
      }),
    ).toMatchObject({ success: false });
  });
});
