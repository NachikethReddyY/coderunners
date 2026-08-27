import assert from "node:assert/strict";

/**
 * These are the public seams the runtime worktrees must expose. Keeping the
 * imports in one place makes a package rename an explicit contract change.
 */
const TARGETS = {
  manifestValidator: {
    specifier: "@coderunners/contracts",
    exportName: "validateLessonManifest",
  },
  draftValidator: {
    specifier: "@coderunners/contracts",
    exportName: "validateLessonDraft",
  },
  localHostApp: {
    specifier: "@coderunners/local-host",
    exportName: "createLocalHostApp",
  },
  timelineResolver: {
    specifier: "@coderunners/contracts",
    exportName: "resolveAnchoredTimeline",
  },
};

export async function loadTarget(name) {
  const target = TARGETS[name];
  assert.ok(target, `Unknown conformance target: ${name}`);

  let module;
  try {
    module = await import(target.specifier);
  } catch (cause) {
    throw new Error(
      `[conformance] Missing ${target.specifier}; expected public export ` +
        `${target.exportName}. Merge the runtime package before running the ` +
        "post-integration conformance suite.",
      { cause },
    );
  }

  const exported = module[target.exportName];
  assert.equal(
    typeof exported,
    "function",
    `[conformance] ${target.specifier} must export ${target.exportName}()`,
  );
  return exported;
}

export function issue(result, code, path) {
  assert.equal(result?.valid, false, "invalid input must produce valid: false");
  assert.ok(Array.isArray(result.issues), "invalid input must include issues[]");
  assert.ok(
    result.issues.some((candidate) => candidate.code === code && candidate.path === path),
    `expected issue ${code} at ${path}; received ${JSON.stringify(result.issues)}`,
  );
}

export function resultError(result, code, path) {
  assert.equal(result?.ok, false, "invalid input must produce ok: false");
  assert.equal(result.error?.code, code, `expected error ${code}`);
  if (path !== undefined) {
    assert.equal(result.error?.path, path, `expected error path ${path}`);
  }
}

export function clone(value) {
  return structuredClone(value);
}
