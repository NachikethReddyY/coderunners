import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { ContractError, ValidationResult } from "./validation.js";

const DateTime = Type.String({ minLength: 20, maxLength: 40 });
const StableId = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$",
});
const ModelKey = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: "^[a-z0-9][a-z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*$",
});

// NOTE: Git performs the authoritative check-ref-format validation at runtime.
// This contract rejects path/control syntax before a request reaches git.
export const BranchNameSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern:
    "^(?!-)(?!/)(?!.*(?:\\.\\.|//|@\\{|[~^:?*\\[\\]\\\\\\s]))(?!.*[/.]$).+$",
});

export const ModelRoleSchema = Type.Union([
  Type.Literal("authoring"),
  Type.Literal("stt"),
  Type.Literal("tts"),
]);
export type ModelRole = Static<typeof ModelRoleSchema>;

export const ReasoningLevelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
  Type.Literal("ultra"),
]);
export type ReasoningLevel = Static<typeof ReasoningLevelSchema>;

export const ModelOptionSchema = Type.Object(
  {
    id: ModelKey,
    providerId: Type.String({ minLength: 1, maxLength: 80 }),
    modelId: Type.String({ minLength: 1, maxLength: 120 }),
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    role: ModelRoleSchema,
    enabled: Type.Boolean(),
    availability: Type.Union([
      Type.Literal("ready"),
      Type.Literal("unavailable"),
      Type.Literal("needs-auth"),
      Type.Literal("downloading"),
      Type.Literal("failed"),
    ]),
    reasoningOptions: Type.Array(ReasoningLevelSchema, { maxItems: 6 }),
  },
  { additionalProperties: false },
);
export type ModelOption = Static<typeof ModelOptionSchema>;

export const ModelConfigurationSchema = Type.Object(
  {
    models: Type.Array(ModelOptionSchema, { minItems: 3, maxItems: 100 }),
    defaults: Type.Object(
      {
        authoring: ModelKey,
        stt: ModelKey,
        tts: ModelKey,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ModelConfiguration = Static<typeof ModelConfigurationSchema>;

export const ModelSettingsUpdateSchema = Type.Object(
  {
    enabledModelIds: Type.Array(ModelKey, { minItems: 3, maxItems: 100 }),
    defaults: Type.Object(
      {
        authoring: ModelKey,
        stt: ModelKey,
        tts: ModelKey,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ModelSettingsUpdate = Static<typeof ModelSettingsUpdateSchema>;

export const DEFAULT_MODEL_CONFIGURATION: ModelConfiguration = {
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
      id: "openai:gpt-5.6-terra",
      providerId: "openai",
      modelId: "gpt-5.6-terra",
      displayName: "GPT-5.6 Terra",
      role: "authoring",
      enabled: false,
      availability: "ready",
      reasoningOptions: ["medium", "high", "xhigh"],
    },
    {
      id: "openai:gpt-5.6-luna",
      providerId: "openai",
      modelId: "gpt-5.6-luna",
      displayName: "GPT-5.6 Luna",
      role: "authoring",
      enabled: false,
      availability: "ready",
      reasoningOptions: ["medium", "high", "xhigh", "max"],
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
    {
      id: "local:qwen-voice-clone",
      providerId: "local",
      modelId: "qwen-voice-clone",
      displayName: "Qwen Voice Clone",
      role: "tts",
      enabled: false,
      availability: "unavailable",
      reasoningOptions: [],
    },
  ],
  defaults: {
    authoring: "openai:gpt-5.6-sol",
    stt: "local:whisper-medium-mlx",
    tts: "local:kokoro-82m-8bit",
  },
};

export const ProjectRecordSchema = Type.Object(
  {
    id: StableId,
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    root: Type.String({ minLength: 1, maxLength: 4_096 }),
    repository: Type.Union([
      Type.Object(
        {
          kind: Type.Literal("git"),
          currentBranch: Type.Union([BranchNameSchema, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("folder"), currentBranch: Type.Null() },
        { additionalProperties: false },
      ),
    ]),
    createdAt: DateTime,
    lastOpenedAt: DateTime,
  },
  { additionalProperties: false },
);
export type ProjectRecord = Static<typeof ProjectRecordSchema>;

export const CreateProjectRequestSchema = Type.Object(
  {
    root: Type.String({ minLength: 1, maxLength: 4_096 }),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);
export type CreateProjectRequest = Static<typeof CreateProjectRequestSchema>;

export const BranchSummarySchema = Type.Object(
  {
    name: BranchNameSchema,
    current: Type.Boolean(),
    checkedOut: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type BranchSummary = Static<typeof BranchSummarySchema>;

export const WorkspaceSelectionSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("local-checkout"),
      branch: Type.Union([BranchNameSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("new-worktree"),
      branch: BranchNameSchema,
      createBranch: Type.Boolean(),
      startPoint: Type.Optional(BranchNameSchema),
    },
    { additionalProperties: false },
  ),
]);
export type WorkspaceSelection = Static<typeof WorkspaceSelectionSchema>;

export type PreparedWorkspace = {
  mode: WorkspaceSelection["mode"];
  branch: string | null;
  root: string;
};

export const CodecastModelSelectionSchema = Type.Object(
  {
    authoring: ModelKey,
    authoringReasoning: ReasoningLevelSchema,
    stt: ModelKey,
    tts: ModelKey,
  },
  { additionalProperties: false },
);
export type CodecastModelSelection = Static<
  typeof CodecastModelSelectionSchema
>;

export const CreateCodecastRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 160 }),
    outcome: Type.String({ minLength: 1, maxLength: 2_000 }),
    workspace: WorkspaceSelectionSchema,
    models: CodecastModelSelectionSchema,
  },
  { additionalProperties: false },
);
export type CreateCodecastRequest = Static<typeof CreateCodecastRequestSchema>;

export const CodecastStatusSchema = Type.Union([
  Type.Literal("generating"),
  Type.Literal("ready"),
  Type.Literal("in-progress"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
]);
export type CodecastStatus = Static<typeof CodecastStatusSchema>;

export const CodecastRecordSchema = Type.Object(
  {
    id: StableId,
    projectId: StableId,
    // Optional only for reading records written before persistent jobs existed.
    generationJobId: Type.Optional(Type.Union([StableId, Type.Null()])),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    outcome: Type.String({ minLength: 1, maxLength: 2_000 }),
    status: CodecastStatusSchema,
    workspace: Type.Object(
      {
        mode: Type.Union([
          Type.Literal("local-checkout"),
          Type.Literal("new-worktree"),
        ]),
        branch: Type.Union([BranchNameSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    models: CodecastModelSelectionSchema,
    durationMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    progress: Type.Object(
      {
        positionMs: Type.Integer({ minimum: 0 }),
        completedChallengeIds: Type.Array(StableId),
        updatedAt: DateTime,
      },
      { additionalProperties: false },
    ),
    error: Type.Optional(
      Type.Object(
        {
          code: Type.String({ minLength: 1, maxLength: 80 }),
          message: Type.String({ minLength: 1, maxLength: 1_000 }),
        },
        { additionalProperties: false },
      ),
    ),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { additionalProperties: false },
);
export type CodecastRecord = Static<typeof CodecastRecordSchema>;

export type ReplayAction =
  | "view-progress"
  | "play"
  | "resume"
  | "replay"
  | "retry"
  | "restart-job";

export type CodecastReplayMetadata = {
  codecastId: string;
  projectId: string;
  action: ReplayAction;
  resumeAtMs: number;
  savedPositionMs: number;
  completedChallengeIds: string[];
  manifestUrl: string | null;
  audioUrl: string | null;
  manifest: import("./codecast-manifest.js").CodecastManifest | null;
};

export const PlaybackCheckpointUpdateSchema = Type.Object(
  {
    positionMs: Type.Integer({ minimum: 0 }),
    completedChallengeIds: Type.Array(StableId, { maxItems: 1_000 }),
    completed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type PlaybackCheckpointUpdate = Static<
  typeof PlaybackCheckpointUpdateSchema
>;

export const DeleteCodecastRequestSchema = Type.Object(
  { confirmCodecastId: StableId },
  { additionalProperties: false },
);
export type DeleteCodecastRequest = Static<typeof DeleteCodecastRequestSchema>;

export type ProjectListResponse = { projects: ProjectRecord[] };
export type ProjectResponse = { project: ProjectRecord };
export type BranchListResponse = { branches: BranchSummary[] };
export type CodecastListResponse = { codecasts: CodecastRecord[] };
export type CodecastResponse = { codecast: CodecastRecord };
export type CodecastReplayResponse = { replay: CodecastReplayMetadata };
export type ModelConfigurationResponse = {
  configuration: ModelConfiguration;
};

export function validateWorkspaceSelection(
  input: unknown,
): ValidationResult<WorkspaceSelection> {
  return validateSchema(WorkspaceSelectionSchema, input);
}

export function validateProjectRecord(
  input: unknown,
): ValidationResult<ProjectRecord> {
  return validateSchema(ProjectRecordSchema, input);
}

export function validateCodecastRecord(
  input: unknown,
): ValidationResult<CodecastRecord> {
  return validateSchema(CodecastRecordSchema, input);
}

export function validateCreateCodecastRequest(
  input: unknown,
): ValidationResult<CreateCodecastRequest> {
  return validateSchema(CreateCodecastRequestSchema, input);
}

export function validatePlaybackCheckpointUpdate(
  input: unknown,
): ValidationResult<PlaybackCheckpointUpdate> {
  return validateSchema(PlaybackCheckpointUpdateSchema, input);
}

export function validateModelConfiguration(
  input: unknown,
): ValidationResult<ModelConfiguration> {
  const shape = validateSchema(ModelConfigurationSchema, input);
  if (!shape.success) {
    return shape;
  }

  const errors: ContractError[] = [];
  const ids = new Set<string>();
  for (const [index, model] of shape.data.models.entries()) {
    if (ids.has(model.id)) {
      errors.push({
        path: `/models/${index}/id`,
        message: "Model identifiers must be unique.",
      });
    }
    ids.add(model.id);
  }
  for (const role of ["authoring", "stt", "tts"] as const) {
    const selected = shape.data.models.find(
      (model) => model.id === shape.data.defaults[role],
    );
    if (selected?.role !== role || !selected.enabled) {
      errors.push({
        path: `/defaults/${role}`,
        message: `Default must reference an enabled ${role} model.`,
      });
    }
  }

  return errors.length === 0
    ? { success: true, data: shape.data }
    : { success: false, errors };
}

export function validateModelSettingsUpdate(
  input: unknown,
): ValidationResult<ModelSettingsUpdate> {
  const shape = validateSchema(ModelSettingsUpdateSchema, input);
  if (!shape.success) {
    return shape;
  }
  if (
    new Set(shape.data.enabledModelIds).size !==
    shape.data.enabledModelIds.length
  ) {
    return {
      success: false,
      errors: [
        {
          path: "/enabledModelIds",
          message: "Enabled model identifiers must be unique.",
        },
      ],
    };
  }
  return shape;
}

function validateSchema<T extends TSchema>(
  schema: T,
  input: unknown,
): ValidationResult<Static<T>> {
  if (Value.Check(schema, input)) {
    return { success: true, data: input };
  }
  return {
    success: false,
    errors: [...Value.Errors(schema, input)].map((error) => ({
      path: error.path || "/",
      message: error.message,
    })),
  };
}
