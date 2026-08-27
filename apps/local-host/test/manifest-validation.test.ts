import { readFile } from "node:fs/promises";

import { fixtureRoot } from "@coderunners/fixture-codecast-react";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalHostApp } from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};

describe("manifest validation API", () => {
  const apps: Array<ReturnType<typeof createLocalHostApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("accepts the golden manifest and rejects a project path escape", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("manifest.json", fixtureRoot), "utf8"),
    ) as Record<string, unknown>;
    const app = createLocalHostApp({ allowedOrigin, sessionToken });
    apps.push(app);

    const valid = await app.inject({
      method: "POST",
      url: "/api/codecasts/validate",
      headers: authHeaders,
      payload: manifest,
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ valid: true, manifest });

    const escaped = structuredClone(manifest) as {
      project: { entryFile: string };
    };
    escaped.project.entryFile = "../outside.ts";
    const invalid = await app.inject({
      method: "POST",
      url: "/api/codecasts/validate",
      headers: authHeaders,
      payload: escaped,
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: {
        code: "INVALID_MANIFEST",
        message: "Repair the Codecast manifest before opening it.",
        details: expect.arrayContaining([
          expect.objectContaining({ path: "/project/entryFile" }),
        ]),
      },
    });
  });
});
