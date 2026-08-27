import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startLocalHost } from "../src/index.js";

describe("Studio static host", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("serves the supplied Studio build without exposing the protected API", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-studio-"));
    const projectRoot = join(container, "project");
    const studioDirectory = join(container, "studio");
    await mkdir(projectRoot);
    await mkdir(studioDirectory);
    await writeFile(
      join(studioDirectory, "index.html"),
      "<!doctype html><title>CodeRunners Studio</title><main>Ready</main>",
    );
    const host = await startLocalHost({
      dataDirectory: join(container, "data"),
      port: 0,
      projectRoot,
      sessionToken: "test-launch-session",
      studioDirectory,
    });
    cleanups.push(async () => {
      await host.close();
      await rm(container, { recursive: true, force: true });
    });

    const studio = await fetch(host.origin);
    expect(studio.status).toBe(200);
    expect(await studio.text()).toContain("CodeRunners Studio");
    expect(studio.headers.get("content-security-policy")).toBe(
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    );

    const unauthenticatedApi = await fetch(`${host.origin}/api/health`, {
      headers: { origin: host.origin },
    });
    expect(unauthenticatedApi.status).toBe(401);
  });
});
