import { Value } from "@sinclair/typebox/value";

import {
  CodecastDraftSchema,
  type CodecastDraft,
} from "./codecast-draft.js";
import {
  CodecastManifestSchema,
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

  const semanticErrors = validateTiming(input);
  if (semanticErrors.length > 0) {
    return { success: false, errors: semanticErrors };
  }

  return { success: true, data: input };
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

  const cueIds = new Set(input.cues.map((cue) => cue.id));
  const errors = input.events.flatMap((event, index): ContractError[] =>
    cueIds.has(event.anchor.cueId)
      ? []
      : [
          {
            path: `/events/${index}/anchor/cueId`,
            message: "Event anchor must reference an existing cue.",
          },
        ],
  );

  return errors.length === 0
    ? { success: true, data: input }
    : { success: false, errors };
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
