import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { clone, loadTarget, issue } from "./support/target.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/valid-lesson-draft.json", import.meta.url), "utf8"),
);

test("accepts a minimal cue-anchored lesson draft", async () => {
  const validateLessonDraft = await loadTarget("draftValidator");
  const result = validateLessonDraft(clone(fixture));

  assert.deepEqual(result, { valid: true, issues: [] });
});

test("rejects model-authored timestamps in a lesson draft", async () => {
  const validateLessonDraft = await loadTarget("draftValidator");
  const candidate = clone(fixture);
  candidate.cues[0].events[0].atMs = 1200;

  issue(
    validateLessonDraft(candidate),
    "AUTHORED_TIME",
    "/cues/0/events/0/atMs",
  );
});

test("rejects a direct answer inside a learner-owned seam", async () => {
  const validateLessonDraft = await loadTarget("draftValidator");
  const candidate = clone(fixture);
  candidate.cues[0].events[1].solution = "return update(previousState)";

  issue(
    validateLessonDraft(candidate),
    "LEARNER_SOLUTION",
    "/cues/0/events/1/solution",
  );
});
