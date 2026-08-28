import type { CodecastManifest, LessonEvent } from "@coderunners/contracts";

export type PlayerPlayback = "paused" | "playing";

export type PlayerState = {
  activeChallengeId: string | undefined;
  completedChallengeIds: string[];
  forwardSeekLocked: boolean;
  learnerHasEdited: boolean;
  manifestId: string;
  playback: PlayerPlayback;
  terminalOutput: string;
  timeMs: number;
};

export type PlayerAction =
  | { type: "clock.updated"; timeMs: number }
  | { type: "learner.mutated" }
  | { type: "play.requested" }
  | { type: "playback.paused" }
  | { type: "proof.succeeded"; challengeId: string }
  | { type: "seek.requested"; timeMs: number }
  | { type: "session.reset" }
  | { type: "terminal.append"; output: string }
  | { type: "terminal.updated"; output: string };

const INITIAL_TERMINAL_OUTPUT =
  "Challenge check waiting for your implementation…";

export function createInitialPlayerState(
  manifest: CodecastManifest,
): PlayerState {
  return {
    activeChallengeId: undefined,
    completedChallengeIds: [],
    forwardSeekLocked: false,
    learnerHasEdited: false,
    manifestId: manifest.id,
    playback: "paused",
    terminalOutput: INITIAL_TERMINAL_OUTPUT,
    timeMs: 0,
  };
}

export function playerReducer(
  state: PlayerState,
  action: PlayerAction,
  manifest: CodecastManifest,
): PlayerState {
  switch (action.type) {
    case "clock.updated": {
      if (state.forwardSeekLocked) {
        return state;
      }
      return moveToTime(state, action.timeMs, manifest);
    }
    case "learner.mutated":
      return {
        ...state,
        learnerHasEdited: true,
        playback: "paused",
      };
    case "play.requested":
      return state.forwardSeekLocked ? state : { ...state, playback: "playing" };
    case "playback.paused":
      return { ...state, playback: "paused" };
    case "proof.succeeded": {
      if (state.activeChallengeId !== action.challengeId) {
        return state;
      }
      return {
        ...state,
        activeChallengeId: undefined,
        completedChallengeIds: [...state.completedChallengeIds, action.challengeId],
        forwardSeekLocked: false,
      };
    }
    case "seek.requested": {
      const nextTimeMs = clampTime(action.timeMs, manifest.audio.durationMs);
      if (nextTimeMs > state.timeMs && state.forwardSeekLocked) {
        return state;
      }
      if (nextTimeMs < state.timeMs && state.forwardSeekLocked) {
        return {
          ...state,
          activeChallengeId: undefined,
          forwardSeekLocked: false,
          playback: "paused",
          timeMs: nextTimeMs,
        };
      }
      return moveToTime({ ...state, timeMs: nextTimeMs }, nextTimeMs, manifest);
    }
    case "session.reset":
      return createInitialPlayerState(manifest);
    case "terminal.updated":
      return { ...state, terminalOutput: action.output.slice(-20_000) };
    case "terminal.append":
      return {
        ...state,
        terminalOutput: `${state.terminalOutput}\r\n${action.output}`.slice(-20_000),
      };
  }
}

export function serializePlayerState(state: PlayerState): string {
  return JSON.stringify({ version: 1, state });
}

export function restorePlayerState(
  serialized: string | null,
  manifest: CodecastManifest,
): PlayerState {
  if (serialized === null) {
    return createInitialPlayerState(manifest);
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!isStoredPlayerState(parsed, manifest)) {
      return createInitialPlayerState(manifest);
    }
    return parsed.state;
  } catch {
    return createInitialPlayerState(manifest);
  }
}

function moveToTime(
  state: PlayerState,
  requestedTimeMs: number,
  manifest: CodecastManifest,
): PlayerState {
  const timeMs = clampTime(requestedTimeMs, manifest.audio.durationMs);
  const challenge = nextUnresolvedChallengeAt(timeMs, state, manifest.events);

  if (challenge === undefined) {
    return { ...state, timeMs };
  }

  return {
    ...state,
    activeChallengeId: challenge.challengeId,
    forwardSeekLocked: true,
    playback: "paused",
    timeMs: challenge.atMs,
  };
}

function nextUnresolvedChallengeAt(
  timeMs: number,
  state: PlayerState,
  events: LessonEvent[],
): Extract<LessonEvent, { type: "challenge.start" }> | undefined {
  return events.find(
    (event): event is Extract<LessonEvent, { type: "challenge.start" }> =>
      event.type === "challenge.start" &&
      event.atMs <= timeMs &&
      !state.completedChallengeIds.includes(event.challengeId),
  );
}

function clampTime(timeMs: number, durationMs: number): number {
  return Math.min(Math.max(Math.round(timeMs), 0), durationMs);
}

function isStoredPlayerState(
  value: unknown,
  manifest: CodecastManifest,
): value is { version: 1; state: PlayerState } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.state !== "object" || record.state === null) {
    return false;
  }
  const state = record.state as Record<string, unknown>;
  const validChallengeIds = new Set(manifest.challenges.map((challenge) => challenge.id));
  return (
    state.manifestId === manifest.id &&
    (state.playback === "paused" || state.playback === "playing") &&
    typeof state.timeMs === "number" &&
    state.timeMs >= 0 &&
    state.timeMs <= manifest.audio.durationMs &&
    typeof state.forwardSeekLocked === "boolean" &&
    typeof state.learnerHasEdited === "boolean" &&
    typeof state.terminalOutput === "string" &&
    Array.isArray(state.completedChallengeIds) &&
    state.completedChallengeIds.every(
      (id) => typeof id === "string" && validChallengeIds.has(id),
    ) &&
    (state.activeChallengeId === undefined ||
      (typeof state.activeChallengeId === "string" &&
        validChallengeIds.has(state.activeChallengeId)))
  );
}
