import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { clone, issue, loadTarget } from "./support/target.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/valid-lesson-manifest.json", import.meta.url), "utf8"),
);

test("accepts the bounded golden lesson manifest without mutating it", async () => {
  const validateLessonManifest = await loadTarget("manifestValidator");
  const candidate = clone(fixture);
  const before = JSON.stringify(candidate);

  const result = validateLessonManifest(candidate);

  assert.deepEqual(result, { valid: true, issues: [] });
  assert.equal(JSON.stringify(candidate), before);
});

const invalidCases = [
  {
    name: "unsupported schema version",
    code: "SCHEMA_VERSION",
    path: "/schemaVersion",
    mutate(candidate) {
      candidate.schemaVersion = 2;
    },
  },
  {
    name: "duplicate cue ids",
    code: "DUPLICATE_ID",
    path: "/cues/1/id",
    mutate(candidate) {
      candidate.cues[1].id = candidate.cues[0].id;
    },
  },
  {
    name: "unknown event types",
    code: "UNKNOWN_EVENT",
    path: "/cues/0/events/0/type",
    mutate(candidate) {
      candidate.cues[0].events[0].type = "filesystem.write";
    },
  },
  {
    name: "out-of-range event anchors",
    code: "ANCHOR_OUT_OF_RANGE",
    path: "/cues/0/events/2/anchorWord",
    mutate(candidate) {
      candidate.cues[0].events[2].anchorWord = 99;
    },
  },
  {
    name: "workspace paths that escape the project",
    code: "UNSAFE_PATH",
    path: "/cues/0/events/1/file",
    mutate(candidate) {
      candidate.cues[0].events[1].file = "../outside.ts";
    },
  },
  {
    name: "unbounded shell commands",
    code: "UNSAFE_COMMAND",
    path: "/checks/0/command",
    mutate(candidate) {
      candidate.checks[0].command = ["sh", "-c", "pnpm test state-update"];
    },
  },
  {
    name: "direct learner-owned solutions",
    code: "LEARNER_SOLUTION",
    path: "/cues/1/events/0/solution",
    mutate(candidate) {
      candidate.cues[1].events[0].solution = "setHabits(previous => update(previous))";
    },
  },
];

for (const invalidCase of invalidCases) {
  test(`rejects ${invalidCase.name} with a precise issue`, async () => {
    const validateLessonManifest = await loadTarget("manifestValidator");
    const candidate = clone(fixture);
    invalidCase.mutate(candidate);

    issue(validateLessonManifest(candidate), invalidCase.code, invalidCase.path);
  });
}
