import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalHostApp } from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};

describe("Local Host file boundary", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("reads project files but rejects traversal and symlink escapes", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-files-"));
    const projectRoot = join(container, "project");
    const outsideRoot = join(container, "outside");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(outsideRoot);
    await writeFile(
      join(projectRoot, "src/index.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(join(outsideRoot, "secret.txt"), "not learner data", "utf8");
    await symlink(
      join(outsideRoot, "secret.txt"),
      join(projectRoot, "linked-secret.txt"),
    );

    const app = createLocalHostApp({
      allowedOrigin,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const file = await app.inject({
      method: "GET",
      url: "/api/files/content?path=src%2Findex.ts",
      headers: authHeaders,
    });

    expect(file.statusCode).toBe(200);
    expect(file.json()).toEqual({
      path: "src/index.ts",
      content: "export const value = 1;\n",
      revision: "5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29",
    });

    for (const unsafePath of ["../outside/secret.txt", "linked-secret.txt"]) {
      const escaped = await app.inject({
        method: "GET",
        url: `/api/files/content?path=${encodeURIComponent(unsafePath)}`,
        headers: authHeaders,
      });

      expect(escaped.statusCode).toBe(400);
      expect(escaped.json()).toEqual({
        error: {
          code: "INVALID_PATH",
          message: "Choose a file inside the selected project.",
        },
      });
    }
  });

  it("writes learner edits only at the expected file revision", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-write-"));
    const projectRoot = join(container, "project");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(
      join(projectRoot, "src/index.ts"),
      "export const value = 1;\n",
      "utf8",
    );

    const app = createLocalHostApp({
      allowedOrigin,
      projectRoot,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: authHeaders,
      payload: {
        path: "src/index.ts",
        content: "export const value = 2;\n",
        expectedRevision:
          "5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29",
      },
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      path: "src/index.ts",
      revision: "f4918c8ac9858f83b2c0307536179d6bd283bc7c20ba34b53074721f43611f4a",
    });

    const staleSave = await app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: authHeaders,
      payload: {
        path: "src/index.ts",
        content: "export const value = 3;\n",
        expectedRevision:
          "5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29",
      },
    });

    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json()).toEqual({
      error: {
        code: "STALE_FILE",
        message: "This file changed after you opened it. Reload it before saving.",
      },
    });

    const preserved = await app.inject({
      method: "GET",
      url: "/api/files/content?path=src%2Findex.ts",
      headers: authHeaders,
    });
    expect(preserved.json()).toMatchObject({
      content: "export const value = 2;\n",
    });
  });
});
