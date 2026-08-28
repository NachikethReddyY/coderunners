import type { CodecastDraft } from "./codecast-draft.js";
import type { CodecastManifest, LessonEvent } from "./codecast-manifest.js";
import {
  validateCodecastDraft,
  validateCodecastManifest,
  type ContractError,
  type ValidationResult,
} from "./validation.js";

export type MediaWordTiming = {
  cueId: string;
  wordIndex: number;
  startMs: number;
  endMs: number;
  confidence: number;
};

export type MediaGenerationResult = {
  audio: {
    path: string;
    format: "pcm-wav";
    durationMs: number;
  };
  cues: Array<{
    id: string;
    startMs: number;
    endMs: number;
  }>;
  timing: {
    schemaVersion: 1;
    durationMs: number;
    alignmentConfidence: number;
    words: MediaWordTiming[];
  };
};

export function compileCodecastManifest(
  draft: CodecastDraft,
  media: MediaGenerationResult,
  audioSrc: string,
): ValidationResult<CodecastManifest> {
  const draftValidation = validateCodecastDraft(draft);
  if (!draftValidation.success) {
    return draftValidation;
  }

  const mediaErrors = validateMediaResult(draft, media);
  if (mediaErrors.length > 0) {
    return { success: false, errors: mediaErrors };
  }

  const timingByWord = new Map(
    media.timing.words.map((word) => [
      `${word.cueId}:${String(word.wordIndex)}`,
      { startMs: word.startMs, endMs: word.endMs },
    ]),
  );
  const cueTextById = new Map(draft.cues.map((cue) => [cue.id, cue.text]));
  const events: LessonEvent[] = [];

  for (let index = 0; index < draft.events.length; index += 1) {
    const event = draft.events[index]!;
    const cueText = cueTextById.get(event.anchor.cueId)!;
    const anchorOffset = nthOccurrenceOffset(
      cueText,
      event.anchor.phrase,
      event.anchor.occurrence,
    );
    const phraseWordCount = tokenize(event.anchor.phrase).length;
    const phraseStartWord = tokenize(cueText.slice(0, anchorOffset)).length;
    const phraseEndWord = phraseStartWord + phraseWordCount - 1;
    const phraseStartTiming = timingByWord.get(
      `${event.anchor.cueId}:${String(phraseStartWord)}`,
    );
    const phraseEndTiming = timingByWord.get(
      `${event.anchor.cueId}:${String(phraseEndWord)}`,
    );
    if (phraseStartTiming === undefined || phraseEndTiming === undefined || phraseWordCount === 0) {
      return {
        success: false,
        errors: [
          {
            path: `/events/${index}/anchor`,
            message: "STT timing is missing for the anchor phrase.",
          },
        ],
      };
    }
    const atMs = event.anchor.edge === "end"
      ? phraseEndTiming.endMs
      : phraseStartTiming.startMs;
    const { anchor: _anchor, ...authoredEvent } = event;
    events.push(
      event.type === "demo.patch"
        ? ({
            ...authoredEvent,
            atMs: phraseStartTiming.startMs,
            endMs: phraseEndTiming.endMs,
          } as LessonEvent)
        : ({ ...authoredEvent, atMs } as LessonEvent),
    );
  }

  const cueRanges = new Map(media.cues.map((cue) => [cue.id, cue]));
  const manifest: CodecastManifest = {
    schemaVersion: 1,
    id: draft.id,
    title: draft.title,
    project: draft.project,
    audio: {
      src: audioSrc,
      format: "pcm-wav",
      durationMs: media.audio.durationMs,
    },
    cues: draft.cues.map((cue) => ({ ...cue, ...cueRanges.get(cue.id)! })),
    events,
    challenges: draft.challenges,
  };

  return validateCodecastManifest(manifest);
}

function validateMediaResult(
  draft: CodecastDraft,
  media: MediaGenerationResult,
): ContractError[] {
  if (
    media.audio.format !== "pcm-wav" ||
    !Number.isInteger(media.audio.durationMs) ||
    media.audio.durationMs < 1 ||
    media.timing.schemaVersion !== 1 ||
    media.timing.durationMs !== media.audio.durationMs
  ) {
    return [{ path: "/audio", message: "Media timing must match the generated PCM audio." }];
  }

  const ranges = new Map(media.cues.map((cue) => [cue.id, cue]));
  for (let index = 0; index < draft.cues.length; index += 1) {
    const cue = ranges.get(draft.cues[index]!.id);
    if (
      cue === undefined ||
      !Number.isInteger(cue.startMs) ||
      !Number.isInteger(cue.endMs) ||
      cue.startMs < 0 ||
      cue.startMs >= cue.endMs ||
      cue.endMs > media.audio.durationMs
    ) {
      return [{ path: `/cues/${index}`, message: "Generated cue timing is missing or invalid." }];
    }
  }

  return [];
}

function nthOccurrenceOffset(text: string, phrase: string, occurrence: number): number {
  let offset = 0;
  for (let count = 0; count < occurrence; count += 1) {
    offset = text.indexOf(phrase, offset);
    if (count < occurrence - 1) {
      offset += phrase.length;
    }
  }
  return offset;
}

function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}
