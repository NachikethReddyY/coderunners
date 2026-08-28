import type { LessonEvent } from "@coderunners/contracts";

type DemoPatch = Extract<LessonEvent, { type: "demo.patch" }>;

export type DemoProjection = {
  path: string;
  source: string;
  typing: boolean;
};

export function projectDemoSource(
  events: LessonEvent[],
  timeMs: number,
  stopAtMs = Number.POSITIVE_INFINITY,
): DemoProjection | undefined {
  if (timeMs >= stopAtMs) {
    return undefined;
  }

  const patches = events
    .filter((event): event is DemoPatch => event.type === "demo.patch")
    .sort((left, right) => left.atMs - right.atMs);
  if (patches.length > 0 && timeMs < patches[0]!.atMs) {
    return { path: patches[0]!.path, source: "", typing: false };
  }
  let currentIndex = patches.length - 1;
  while (currentIndex >= 0 && patches[currentIndex]!.atMs > timeMs) {
    currentIndex -= 1;
  }
  if (currentIndex < 0) {
    return undefined;
  }

  const current = patches[currentIndex]!;
  const previous = patches[currentIndex - 1];
  const previousSource = previous?.path === current.path ? previous.patch : "";
  if (!current.patch.startsWith(previousSource)) {
    return { path: current.path, source: current.patch, typing: false };
  }

  const appended = current.patch.slice(previousSource.length);
  const progress = Math.min(
    1,
    Math.max(0, (timeMs - current.atMs) / (current.endMs - current.atMs)),
  );
  const visibleCharacters = Math.min(
    appended.length,
    Math.max(1, Math.ceil(appended.length * progress)),
  );

  return {
    path: current.path,
    source: previousSource + appended.slice(0, visibleCharacters),
    typing: timeMs < patches[patches.length - 1]!.endMs,
  };
}
