import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadTarget } from "./support/target.mjs";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "conformance-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};

async function createProject() {
  const container = await mkdtemp(join(tmpdir(), "coderunners-paths-"));
  const projectRoot = join(container, "project");
  const outsideRoot = join(container, "outside");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await mkdir(outsideRoot);
  await writeFile(
    join(projectRoot, "src", "state.ts"),
    "export const done = false;\n",
  );
  await writeFile(join(outsideRoot, "secret.txt"), "must remain unreachable\n");
  await symlink(
    join(outsideRoot, "secret.txt"),
    join(projectRoot, "linked-secret.txt"),
  );

  return { container, projectRoot, outsideRoot };
}

test("reads an in-root file through the public local-host boundary", async () => {
  const createLocalHostApp = await loadTarget("localHostApp");
  const { container, projectRoot } = await createProject();
  const app = createLocalHostApp({
    allowedOrigin,
    projectRoot,
    sessionToken,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/files/content?path=src%2Fstate.ts",
      headers: authHeaders,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.path, "src/state.ts");
    assert.equal(body.content, "export const done = false;\n");
    assert.ok(
      !body.path.includes(projectRoot),
      "responses must not expose absolute paths",
    );
  } finally {
    await app.close();
    await rm(container, { recursive: true, force: true });
  }
});

test("rejects traversal, absolute, encoded, and symlink escapes", async () => {
  const createLocalHostApp = await loadTarget("localHostApp");
  const { container, projectRoot } = await createProject();
  const app = createLocalHostApp({
    allowedOrigin,
    projectRoot,
    sessionToken,
  });

  try {
    const paths = [
      ["../outside/secret.txt", encodeURIComponent("../outside/secret.txt")],
      [
        "src/../../outside/secret.txt",
        encodeURIComponent("src/../../outside/secret.txt"),
      ],
      ["/etc/passwd", encodeURIComponent("/etc/passwd")],
      ["..\\outside\\secret.txt", encodeURIComponent("..\\outside\\secret.txt")],
      ["linked-secret.txt", encodeURIComponent("linked-secret.txt")],
      ["encoded traversal", "..%2Foutside%2Fsecret.txt"],
      ["nul byte", "src%2F%00secret.ts"],
    ];

    for (const [label, queryPath] of paths) {
      const response = await app.inject({
        method: "GET",
        url: `/api/files/content?path=${queryPath}`,
        headers: authHeaders,
      });

      assert.equal(response.statusCode, 400, `expected ${label} to be rejected`);
      assert.deepEqual(response.json(), {
        error: {
          code: "INVALID_PATH",
          message: "Choose a file inside the selected project.",
        },
      });
    }
  } finally {
    await app.close();
    await rm(container, { recursive: true, force: true });
  }
});

test("does not mutate an outside file after an escaped write attempt", async () => {
  const createLocalHostApp = await loadTarget("localHostApp");
  const { container, projectRoot, outsideRoot } = await createProject();
  const app = createLocalHostApp({
    allowedOrigin,
    projectRoot,
    sessionToken,
  });
  const outsidePath = join(outsideRoot, "secret.txt");
  const original = await readFile(outsidePath, "utf8");

  try {
    const response = await app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: authHeaders,
      payload: {
        path: "../outside/secret.txt",
        content: "overwritten\n",
        expectedRevision: "not-used",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(await readFile(outsidePath, "utf8"), original);
  } finally {
    await app.close();
    await rm(container, { recursive: true, force: true });
  }
});
