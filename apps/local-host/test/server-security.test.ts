import { afterEach, describe, expect, it } from "vitest";

import { createLocalHostApp } from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";

describe("Local Host browser boundary", () => {
  const apps: Array<ReturnType<typeof createLocalHostApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves health only to the exact origin with the launch session", async () => {
    const app = createLocalHostApp({ allowedOrigin, sessionToken });
    apps.push(app);

    const connected = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: allowedOrigin,
        "x-coderunners-session": sessionToken,
      },
    });

    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toEqual({
      status: "ok",
      capabilities: {
        codecastGeneration: false,
        files: false,
        pty: false,
      },
    });
    expect(connected.headers["content-security-policy"]).toBe(
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(connected.headers["cache-control"]).toBe("no-store");

    const foreignOrigin = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: "http://localhost:43110",
        "x-coderunners-session": sessionToken,
      },
    });

    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json()).toEqual({
      error: {
        code: "ORIGIN_REJECTED",
        message: "Reopen CodeRunners from the local launcher.",
      },
    });

    const invalidSession = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: allowedOrigin,
        "x-coderunners-session": "wrong-token",
      },
    });

    expect(invalidSession.statusCode).toBe(401);
    expect(invalidSession.json()).toEqual({
      error: {
        code: "INVALID_SESSION",
        message: "Reopen CodeRunners from the local launcher.",
      },
    });
  });

  it("reports only capabilities backed by the selected project and commands", async () => {
    const app = createLocalHostApp({
      allowedOrigin,
      commands: {
        check: { executable: "node", args: ["--version"] },
      },
      projectRoot: process.cwd(),
      sessionToken,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: allowedOrigin,
        "x-coderunners-session": sessionToken,
      },
    });

    expect(response.json()).toEqual({
      status: "ok",
      capabilities: {
        codecastGeneration: true,
        files: true,
        pty: true,
      },
    });
  });
});
