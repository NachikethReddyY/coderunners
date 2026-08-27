import { Type, type Static } from "@sinclair/typebox";

export const Identifier = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$",
});

export const RelativePath = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$",
});

export const Point = Type.Object(
  {
    line: Type.Integer({ minimum: 1 }),
    column: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const TimedEventBase = {
  id: Identifier,
  atMs: Type.Integer({ minimum: 0 }),
};

export const LessonEventSchema = Type.Union(
  [
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("chapter"),
        title: Type.String({ minLength: 1, maxLength: 120 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("editor.open"),
        path: RelativePath,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("editor.focusRange"),
        path: RelativePath,
        range: Type.Object(
          { start: Point, end: Point },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("demo.patch"),
        path: RelativePath,
        patch: Type.String({ minLength: 1, maxLength: 100_000 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("terminal.replay"),
        lines: Type.Array(Type.String({ maxLength: 2_000 }), {
          maxItems: 2_000,
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("preview.show"),
        url: Type.String({ minLength: 1, maxLength: 2_048 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("challenge.start"),
        challengeId: Identifier,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("challenge.hint"),
        challengeId: Identifier,
        rung: Type.Integer({ minimum: 1, maximum: 4 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...TimedEventBase,
        type: Type.Literal("challenge.complete"),
        challengeId: Identifier,
      },
      { additionalProperties: false },
    ),
  ],
  { $id: "LessonEvent" },
);

export const CommandSchema = Type.Object(
  {
    executable: Type.Union([
      Type.Literal("node"),
      Type.Literal("npm"),
      Type.Literal("pnpm"),
      Type.Literal("python3"),
      Type.Literal("uv"),
    ]),
    args: Type.Array(Type.String({ maxLength: 240 }), { maxItems: 24 }),
    cwd: Type.Optional(RelativePath),
  },
  { additionalProperties: false },
);

export const CommandDefinitionsSchema = Type.Record(Identifier, CommandSchema, {
  minProperties: 1,
  maxProperties: 12,
});

export const ChallengeSchema = Type.Object(
  {
    id: Identifier,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    instruction: Type.String({ minLength: 1, maxLength: 2_000 }),
    seam: Type.Object(
      {
        path: RelativePath,
        startLine: Type.Integer({ minimum: 1 }),
        endLine: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    hints: Type.Array(Type.String({ minLength: 1, maxLength: 600 }), {
      minItems: 1,
      maxItems: 4,
    }),
    checkCommandId: Identifier,
  },
  { additionalProperties: false },
);

export const CodecastManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Identifier,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    project: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        entryFile: RelativePath,
        commands: CommandDefinitionsSchema,
      },
      { additionalProperties: false },
    ),
    audio: Type.Object(
      {
        src: RelativePath,
        format: Type.Literal("pcm-wav"),
        durationMs: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    cues: Type.Array(
      Type.Object(
        {
          id: Identifier,
          text: Type.String({ minLength: 1, maxLength: 4_000 }),
          startMs: Type.Integer({ minimum: 0 }),
          endMs: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    events: Type.Array(LessonEventSchema),
    challenges: Type.Array(ChallengeSchema, { minItems: 1 }),
  },
  {
    $id: "https://coderunners.local/schemas/codecast-manifest.json",
    additionalProperties: false,
  },
);

export type CodecastManifest = Static<typeof CodecastManifestSchema>;
export type CommandDefinition = Static<typeof CommandSchema>;
export type CommandDefinitions = Static<typeof CommandDefinitionsSchema>;
export type LessonEvent = Static<typeof LessonEventSchema>;
