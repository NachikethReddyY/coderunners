export type LessonIssue = {
  code: string;
  path: string;
};

export type LessonValidationResult = {
  valid: boolean;
  issues: LessonIssue[];
};

type LessonRecord = Record<string, unknown>;

const KNOWN_EVENT_TYPES = new Set([
  "chapter",
  "editor.open",
  "editor.focusRange",
  "demo.patch",
  "terminal.replay",
  "preview.show",
  "challenge.start",
  "challenge.hint",
  "challenge.complete",
]);
const SAFE_COMMANDS = new Set(["node", "npm", "pnpm", "python3", "uv"]);

export function validateLessonDraft(input: unknown): LessonValidationResult {
  return validateLesson(input, true);
}

export function validateLessonManifest(input: unknown): LessonValidationResult {
  return validateLesson(input, false);
}

export function resolveAnchoredTimeline(input: unknown):
  | { ok: true; value: { durationMs: number; events: LessonRecord[] } }
  | { ok: false; error: { code: string; path?: string } } {
  if (!isRecord(input) || !isRecord(input.manifest) || !isRecord(input.timing)) {
    return { ok: false, error: { code: "TIMING_RANGE_INVALID" } };
  }

  const manifest = input.manifest;
  const timing = input.timing;
  const durationMs = numberValue(timing.durationMs);
  const words = Array.isArray(timing.words) ? timing.words : [];
  if (durationMs === undefined || durationMs <= 0) {
    return { ok: false, error: { code: "TIMING_RANGE_INVALID", path: "/durationMs" } };
  }

  const timingByAnchor = new Map<string, number>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!isRecord(word)) {
      return { ok: false, error: { code: "TIMING_RANGE_INVALID", path: `/words/${index}` } };
    }
    const startMs = numberValue(word.startMs);
    const endMs = numberValue(word.endMs);
    if (startMs === undefined || endMs === undefined || startMs > endMs) {
      return { ok: false, error: { code: "TIMING_RANGE_INVALID", path: `/words/${index}` } };
    }
    if (startMs < 0 || endMs > durationMs) {
      return { ok: false, error: { code: "TIMING_OUT_OF_BOUNDS", path: `/words/${index}` } };
    }
    if (typeof word.cueId === "string" && Number.isInteger(word.wordIndex)) {
      timingByAnchor.set(`${word.cueId}:${String(word.wordIndex)}`, startMs);
    }
  }

  const events: LessonRecord[] = [];
  const cues = Array.isArray(manifest.cues) ? manifest.cues : [];
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    const cue = cues[cueIndex];
    if (!isRecord(cue) || typeof cue.id !== "string") {
      continue;
    }
    const cueEvents = Array.isArray(cue.events) ? cue.events : [];
    for (let eventIndex = 0; eventIndex < cueEvents.length; eventIndex += 1) {
      const event = cueEvents[eventIndex];
      if (!isRecord(event) || typeof event.id !== "string" || typeof event.type !== "string") {
        continue;
      }
      const anchorWord = numberValue(event.anchorWord);
      const atMs =
        anchorWord === undefined
          ? undefined
          : timingByAnchor.get(`${cue.id}:${String(anchorWord - 1)}`);
      if (atMs === undefined) {
        return {
          ok: false,
          error: {
            code: "TIMING_ANCHOR_MISSING",
            path: `/cues/${cueIndex}/events/${eventIndex}/anchorWord`,
          },
        };
      }
      const { id: _id, anchorWord: _anchorWord, ...details } = event;
      events.push({ eventId: event.id, type: event.type, atMs, ...details });
    }
  }

  return { ok: true, value: { durationMs, events } };
}

function validateLesson(input: unknown, authored: boolean): LessonValidationResult {
  if (!isRecord(input)) {
    return { valid: false, issues: [{ code: "INVALID_LESSON", path: "/" }] };
  }

  const issues: LessonIssue[] = [];
  if (input.schemaVersion !== 1) {
    issues.push({ code: "SCHEMA_VERSION", path: "/schemaVersion" });
  }

  const cues = Array.isArray(input.cues) ? input.cues : [];
  const cueIds = new Set<string>();
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    const cue = cues[cueIndex];
    if (!isRecord(cue)) {
      continue;
    }
    if (typeof cue.id === "string") {
      if (cueIds.has(cue.id)) {
        issues.push({ code: "DUPLICATE_ID", path: `/cues/${cueIndex}/id` });
      }
      cueIds.add(cue.id);
    }

    const wordCount =
      typeof cue.spokenText === "string" ? cue.spokenText.trim().split(/\s+/u).filter(Boolean).length : 0;
    const events = Array.isArray(cue.events) ? cue.events : [];
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      if (!isRecord(event)) {
        continue;
      }
      const basePath = `/cues/${cueIndex}/events/${eventIndex}`;
      if (typeof event.type !== "string" || !KNOWN_EVENT_TYPES.has(event.type)) {
        issues.push({ code: "UNKNOWN_EVENT", path: `${basePath}/type` });
      }
      const anchorWord = numberValue(event.anchorWord);
      if (anchorWord === undefined || !Number.isInteger(anchorWord) || anchorWord < 1 || anchorWord > wordCount) {
        issues.push({ code: "ANCHOR_OUT_OF_RANGE", path: `${basePath}/anchorWord` });
      }
      if (typeof event.file === "string" && !isSafeRelativePath(event.file)) {
        issues.push({ code: "UNSAFE_PATH", path: `${basePath}/file` });
      }
      if ("solution" in event) {
        issues.push({ code: "LEARNER_SOLUTION", path: `${basePath}/solution` });
      }
      if (authored && "atMs" in event) {
        issues.push({ code: "AUTHORED_TIME", path: `${basePath}/atMs` });
      }
    }
  }

  const checks = Array.isArray(input.checks) ? input.checks : [];
  for (let checkIndex = 0; checkIndex < checks.length; checkIndex += 1) {
    const check = checks[checkIndex];
    if (!isRecord(check) || !isSafeCommand(check.command)) {
      issues.push({ code: "UNSAFE_COMMAND", path: `/checks/${checkIndex}/command` });
    }
  }

  return { valid: issues.length === 0, issues };
}

function isSafeCommand(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 1 &&
    value.every((argument) => typeof argument === "string" && !/[\0\r\n]/u.test(argument)) &&
    SAFE_COMMANDS.has(value[0] as string) &&
    !value.includes("-c")
  );
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

function isRecord(value: unknown): value is LessonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
