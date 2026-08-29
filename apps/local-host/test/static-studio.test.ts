import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
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
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:",
    );

    const unauthenticatedApi = await fetch(`${host.origin}/api/health`, {
      headers: { origin: host.origin },
    });
    expect(unauthenticatedApi.status).toBe(401);
  });

  it("serves an explicitly selected local Codecast to Studio", async () => {
    const host = await startLocalHost({
      codecastDirectory: fileURLToPath(fixtureRoot),
      dataDirectory: join(tmpdir(), "coderunners-codecast-data"),
      port: 0,
      projectRoot: fileURLToPath(fixtureRoot),
      sessionToken: "test-launch-session",
    });
    cleanups.push(() => host.close());

    const config = await fetch(`${host.origin}/lesson-config.js`);
    expect(config.status).toBe(200);
    expect(await config.text()).toContain('"title":"Build a typed function"');

    const audio = await fetch(`${host.origin}/codecast/audio/codecast.wav`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toContain("audio/wav");
    await audio.arrayBuffer();
  });
});
