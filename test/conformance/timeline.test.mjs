import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { clone, loadTarget, resultError } from "./support/target.mjs";

const manifest = JSON.parse(
  await readFile(new URL("./fixtures/valid-lesson-manifest.json", import.meta.url), "utf8"),
);
const wordTimings = JSON.parse(
  await readFile(new URL("./fixtures/word-timings.json", import.meta.url), "utf8"),
);

test("resolves deterministic cue anchors and keeps the golden timing tolerance", async () => {
  const resolveAnchoredTimeline = await loadTarget("timelineResolver");

  const firstResult = resolveAnchoredTimeline({ manifest, timing: wordTimings });
  const secondResult = resolveAnchoredTimeline({ manifest, timing: wordTimings });
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  const first = firstResult.value;
  const second = secondResult.value;

  assert.deepEqual(first, second, "the same manifest and timings must replay identically");
  assert.equal(first.durationMs, 4000);
  assert.deepEqual(
    first.events.map((event) => event.atMs),
    [100, 500, 900, 2700],
  );

  const focus = first.events.find((event) => event.eventId === "focus-state");
  const challenge = first.events.find((event) => event.eventId === "challenge-toggle");
  assert.ok(focus);
  assert.ok(challenge);
  assert.ok(Math.abs(focus.atMs - 900) <= 250, "focus anchor must land within ±250 ms");
  assert.ok(Math.abs(challenge.atMs - 2700) <= 250, "challenge anchor must land within ±250 ms");
});

test("rejects missing word anchors instead of inventing event times", async () => {
  const resolveAnchoredTimeline = await loadTarget("timelineResolver");
  const incompleteTimings = wordTimings.words.filter(
    (timing) => !(timing.cueId === "cue-challenge" && timing.wordIndex === 2),
  );

  resultError(
    resolveAnchoredTimeline({
      manifest,
      timing: { ...wordTimings, words: incompleteTimings },
    }),
    "TIMING_ANCHOR_MISSING",
  );
});

test("rejects timing ranges outside the audio clock", async () => {
  const resolveAnchoredTimeline = await loadTarget("timelineResolver");
  const invalidTimings = clone(wordTimings);
  invalidTimings.words[0].endMs = 4001;

  resultError(
    resolveAnchoredTimeline({ manifest, timing: invalidTimings }),
    "TIMING_OUT_OF_BOUNDS",
  );
});

test("rejects inverted word ranges", async () => {
  const resolveAnchoredTimeline = await loadTarget("timelineResolver");
  const invalidTimings = clone(wordTimings);
  invalidTimings.words[0].startMs = 300;
  invalidTimings.words[0].endMs = 200;

  resultError(
    resolveAnchoredTimeline({ manifest, timing: invalidTimings }),
    "TIMING_RANGE_INVALID",
  );
});
