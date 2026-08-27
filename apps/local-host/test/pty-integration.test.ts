import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startLocalHost } from "../src/index.js";

describe("real PTY integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("runs an approved allowlisted executable through node-pty", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-real-pty-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    const host = await startLocalHost({
      commands: {
        version: { executable: "node", args: ["--version"] },
      },
      dataDirectory: join(container, "data"),
      port: 0,
      projectRoot,
      sessionToken: "test-real-pty",
    });
    cleanups.push(async () => {
      await host.close();
      await rm(container, { recursive: true, force: true });
    });

    const headers = {
      origin: host.origin,
      "x-coderunners-session": host.sessionToken,
      "content-type": "application/json",
    };
    const requested = await post(host.origin, "/api/command-approvals", headers, {
      commandId: "version",
    });
    const approvalId = (
      requested.body as { approval: { id: string } }
    ).approval.id;
    await post(
      host.origin,
      `/api/command-approvals/${approvalId}/confirm`,
      headers,
      { approved: true },
    );
    const started = await post(host.origin, "/api/pty/sessions", headers, {
      approvalId,
    });

    expect(started.status).toBe(201);
    const sessionId = (started.body as { session: { id: string } }).session.id;
    const output = await waitForOutput(host.origin, sessionId, headers);
    expect(output.status).toBe("exited");
    expect(output.exitCode).toBe(0);
    expect(output.output).toMatch(/^v\d+\.\d+\.\d+\r?\n$/);
  });
});

async function post(
  origin: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(origin + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitForOutput(
  origin: string,
  sessionId: string,
  headers: Record<string, string>,
): Promise<{
  output: string;
  status: string;
  exitCode?: number;
}> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `${origin}/api/pty/sessions/${sessionId}/output?cursor=0`,
      { headers },
    );
    const body = (await response.json()) as {
      output: string;
      status: string;
      exitCode?: number;
    };
    if (body.status === "exited") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("PTY process did not exit.");
}
