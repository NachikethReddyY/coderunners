import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startLocalHost } from "../src/index.js";

describe("Local Host launcher", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("binds an authenticated API to IPv4 loopback only", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-launcher-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    const host = await startLocalHost({
      dataDirectory: join(container, "data"),
      port: 0,
      projectRoot,
      sessionToken: "test-launch-session",
    });
    cleanups.push(async () => {
      await host.close();
      await rm(container, { recursive: true, force: true });
    });

    expect(host.address.host).toBe("127.0.0.1");
    expect(host.address.port).toBeGreaterThan(0);
    expect(host.origin).toBe(
      `http://127.0.0.1:${host.address.port}`,
    );

    const response = await fetch(`${host.origin}/api/health`, {
      headers: {
        origin: host.origin,
        "x-coderunners-session": host.sessionToken,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });
});
