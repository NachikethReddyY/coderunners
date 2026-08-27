import { Value } from "@sinclair/typebox/value";

import {
  CodecastDraftSchema,
  type CodecastDraft,
} from "./codecast-draft.js";
import {
  CommandDefinitionsSchema,
  CodecastManifestSchema,
  type CommandDefinitions,
  type CodecastManifest,
} from "./codecast-manifest.js";

export type ContractError = {
  path: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ContractError[] };

export function validateCodecastManifest(
  input: unknown,
): ValidationResult<CodecastManifest> {
  if (!Value.Check(CodecastManifestSchema, input)) {
    return {
      success: false,
      errors: [...Value.Errors(CodecastManifestSchema, input)].map((error) => ({
        path: error.path || "/",
        message: error.message,
      })),
    };
  }

  const semanticErrors = [
    ...validateTiming(input),
    ...validateManifestReferences(input),
  ];
  if (semanticErrors.length > 0) {
    return { success: false, errors: semanticErrors };
  }

  return { success: true, data: input };
}

export function validateCommandDefinitions(
  input: unknown,
): ValidationResult<CommandDefinitions> {
  if (!Value.Check(CommandDefinitionsSchema, input)) {
    return {
      success: false,
      errors: [...Value.Errors(CommandDefinitionsSchema, input)].map(
        (error) => ({
          path: error.path || "/",
          message: error.message,
        }),
      ),
    };
  }
  const errors = validateCommandSafety(input);
  return errors.length === 0
    ? { success: true, data: input }
    : { success: false, errors };
}

export function validateCodecastDraft(
  input: unknown,
): ValidationResult<CodecastDraft> {
  if (!Value.Check(CodecastDraftSchema, input)) {
    return {
      success: false,
      errors: [...Value.Errors(CodecastDraftSchema, input)].map((error) => ({
        path: error.path || "/",
        message: error.message,
      })),
    };
  }

  const cues = new Map(input.cues.map((cue) => [cue.id, cue.text]));
  const errors = input.events.flatMap((event, index): ContractError[] => {
    const cueText = cues.get(event.anchor.cueId);
    if (cueText === undefined) {
      return [
        {
          path: `/events/${index}/anchor/cueId`,
          message: "Event anchor must reference an existing cue.",
        },
      ];
    }

    const occurrenceCount = countOccurrences(cueText, event.anchor.phrase);
    if (occurrenceCount < event.anchor.occurrence) {
      return [
        {
          path: `/events/${index}/anchor/${occurrenceCount === 0 ? "phrase" : "occurrence"}`,
          message:
            "Event anchor phrase and occurrence must resolve inside its cue.",
        },
      ];
    }
    return [];
  });
  errors.push(...validateDraftReferences(input));

  return errors.length === 0
    ? { success: true, data: input }
    : { success: false, errors };
}

function validateManifestReferences(
  manifest: CodecastManifest,
): ContractError[] {
  const commandIds = new Set(Object.keys(manifest.project.commands));
  const challengeIds = new Set(
    manifest.challenges.map((challenge) => challenge.id),
  );
  const seamPaths = new Set(
    manifest.challenges.map((challenge) => challenge.seam.path),
  );
  const errors: ContractError[] = [];

  manifest.challenges.forEach((challenge, index) => {
    if (!commandIds.has(challenge.checkCommandId)) {
      errors.push({
        path: `/challenges/${index}/checkCommandId`,
        message: "Challenge check must reference a declared command.",
      });
    }
    errors.push(...validateChallengeGuidance(challenge, index));
  });
  errors.push(
    ...withPathPrefix(
      validateCommandSafety(manifest.project.commands),
      "/project/commands",
    ),
  );
  manifest.events.forEach((event, index) => {
    if ("challengeId" in event && !challengeIds.has(event.challengeId)) {
      errors.push({
        path: `/events/${index}/challengeId`,
        message: "Event must reference a declared challenge.",
      });
    }
    if (event.type === "demo.patch" && seamPaths.has(event.path)) {
      errors.push({
        path: `/events/${index}/path`,
        message: "Demo patches must not target a protected learner seam.",
      });
    }
  });
  return errors;
}

function validateDraftReferences(draft: CodecastDraft): ContractError[] {
  const commandIds = new Set(Object.keys(draft.project.commands));
  const challengeIds = new Set(
    draft.challenges.map((challenge) => challenge.id),
  );
  const seamPaths = new Set(
    draft.challenges.map((challenge) => challenge.seam.path),
  );
  const errors: ContractError[] = [];

  draft.challenges.forEach((challenge, index) => {
    if (!commandIds.has(challenge.checkCommandId)) {
      errors.push({
        path: `/challenges/${index}/checkCommandId`,
        message: "Challenge check must reference a declared command.",
      });
    }
    errors.push(...validateChallengeGuidance(challenge, index));
  });
  errors.push(
    ...withPathPrefix(
      validateCommandSafety(draft.project.commands),
      "/project/commands",
    ),
  );
  draft.events.forEach((event, index) => {
    if ("challengeId" in event && !challengeIds.has(event.challengeId)) {
      errors.push({
        path: `/events/${index}/challengeId`,
        message: "Event must reference a declared challenge.",
      });
    }
    if (event.type === "demo.patch" && seamPaths.has(event.path)) {
      errors.push({
        path: `/events/${index}/path`,
        message: "Demo patches must not target a protected learner seam.",
      });
    }
  });
  return errors;
}

function countOccurrences(text: string, phrase: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - phrase.length) {
    const index = text.indexOf(phrase, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + phrase.length;
  }
  return count;
}

function validateChallengeGuidance(
  challenge: CodecastManifest["challenges"][number],
  challengeIndex: number,
): ContractError[] {
  const fields = [
    {
      path: `/challenges/${challengeIndex}/instruction`,
      value: challenge.instruction,
    },
    ...challenge.hints.map((value, hintIndex) => ({
      path: `/challenges/${challengeIndex}/hints/${hintIndex}`,
      value,
    })),
  ];
  return fields.flatMap(({ path, value }) =>
    containsSolutionCode(value)
      ? [
          {
            path,
            message:
              "Challenge guidance must be prose and must not contain solution code.",
          },
        ]
      : [],
  );
}

function containsSolutionCode(value: string): boolean {
  return /`|=>|(?:^|\W)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^)]*\)|(?:^|\W)!\s*[A-Za-z_$]|===?|!==|&&|\|\||[{};]/.test(
    value,
  );
}

function validateCommandSafety(
  commands: CommandDefinitions,
): ContractError[] {
  return Object.entries(commands).flatMap(([commandId, command]) =>
    isProjectScopedCommand(command)
      ? []
      : [
          {
            path: `/${commandId}/args`,
            message:
              "Command arguments must use an approved project-scoped form.",
          },
        ],
  );
}

function isProjectScopedCommand(
  command: CommandDefinitions[string],
): boolean {
  if (command.args.some((argument) => /[\0\r\n]/.test(argument))) {
    return false;
  }

  const [verb, ...rest] = command.args;
  switch (command.executable) {
    case "npm":
    case "pnpm":
      return (
        verb !== undefined &&
        ["build", "check", "dev", "lint", "test", "typecheck"].includes(
          verb,
        )
      );
    case "node":
      return (
        (verb === "--version" && rest.length === 0) ||
        (verb === "--test" &&
          rest.length > 0 &&
          rest.every((path) => isProjectScript(path))) ||
        (verb !== undefined && isProjectScript(verb))
      );
    case "python3":
      return (
        (verb === "--version" && rest.length === 0) ||
        (verb !== undefined && isProjectScript(verb, ".py"))
      );
    case "uv":
      return (
        (verb === "--version" && rest.length === 0) ||
        (verb === "run" &&
          rest.length > 0 &&
          isProjectScript(rest[0]!, ".py"))
      );
  }
}

function isProjectScript(path: string, extension?: string): boolean {
  return (
    isProjectPath(path) &&
    (extension === undefined
      ? /\.(?:cjs|js|mjs|ts)$/.test(path)
      : path.endsWith(extension))
  );
}

function isProjectPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function withPathPrefix(
  errors: ContractError[],
  prefix: string,
): ContractError[] {
  return errors.map((error) => ({
    ...error,
    path: `${prefix}${error.path}`,
  }));
}

function validateTiming(manifest: CodecastManifest): ContractError[] {
  const errors: ContractError[] = [];

  manifest.events.forEach((event, index) => {
    if (event.atMs > manifest.audio.durationMs) {
      errors.push({
        path: `/events/${index}/atMs`,
        message: `Event time must be within the ${manifest.audio.durationMs}ms audio duration.`,
      });
    }
  });

  manifest.cues.forEach((cue, index) => {
    if (cue.startMs >= cue.endMs) {
      errors.push({
        path: `/cues/${index}`,
        message: "Cue start time must be before its end time.",
      });
    } else if (cue.endMs > manifest.audio.durationMs) {
      errors.push({
        path: `/cues/${index}/endMs`,
        message: `Cue must end within the ${manifest.audio.durationMs}ms audio duration.`,
      });
    }
  });

  return errors;
}
