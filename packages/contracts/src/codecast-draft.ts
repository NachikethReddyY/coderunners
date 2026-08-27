import { Type, type Static } from "@sinclair/typebox";

import {
  ChallengeSchema,
  CommandDefinitionsSchema,
  Identifier,
  Point,
  RelativePath,
} from "./codecast-manifest.js";

const Anchor = Type.Object(
  {
    cueId: Identifier,
    phrase: Type.String({ minLength: 1, maxLength: 240 }),
    occurrence: Type.Integer({ minimum: 1, maximum: 20 }),
  },
  { additionalProperties: false },
);

const AuthoredEventBase = {
  id: Identifier,
  anchor: Anchor,
};

export const AuthoredLessonEventSchema = Type.Union(
  [
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("chapter"),
        title: Type.String({ minLength: 1, maxLength: 120 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("editor.open"),
        path: RelativePath,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
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
        ...AuthoredEventBase,
        type: Type.Literal("demo.patch"),
        path: RelativePath,
        patch: Type.String({ minLength: 1, maxLength: 100_000 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("terminal.replay"),
        lines: Type.Array(Type.String({ maxLength: 2_000 }), {
          maxItems: 2_000,
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("preview.show"),
        url: Type.String({ minLength: 1, maxLength: 2_048 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("challenge.start"),
        challengeId: Identifier,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("challenge.hint"),
        challengeId: Identifier,
        rung: Type.Integer({ minimum: 1, maximum: 4 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        ...AuthoredEventBase,
        type: Type.Literal("challenge.complete"),
        challengeId: Identifier,
      },
      { additionalProperties: false },
    ),
  ],
  { $id: "AuthoredLessonEvent" },
);

export const CodecastDraftSchema = Type.Object(
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
    cues: Type.Array(
      Type.Object(
        {
          id: Identifier,
          text: Type.String({ minLength: 1, maxLength: 4_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    events: Type.Array(AuthoredLessonEventSchema),
    challenges: Type.Array(ChallengeSchema, { minItems: 1 }),
  },
  {
    $id: "https://coderunners.local/schemas/codecast-draft.json",
    additionalProperties: false,
  },
);

export type AuthoredLessonEvent = Static<typeof AuthoredLessonEventSchema>;
export type CodecastDraft = Static<typeof CodecastDraftSchema>;
