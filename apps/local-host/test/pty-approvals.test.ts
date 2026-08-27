import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalHostApp,
  type PtyFactory,
  type PtyProcess,
} from "../src/index.js";

const allowedOrigin = "http://127.0.0.1:43110";
const sessionToken = "test-session-token";
const authHeaders = {
  origin: allowedOrigin,
  "x-coderunners-session": sessionToken,
};
const now = () => "2026-08-27T07:30:00.000Z";

describe("reviewed PTY commands", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("starts only the exact manifest command after a single-use approval", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-pty-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    const canonicalProjectRoot = await realpath(projectRoot);
    const spawned: Array<{
      executable: string;
      args: string[];
      options: { cwd: string; cols: number; rows: number };
    }> = [];
    let process: FakePty | undefined;
    const ptyFactory: PtyFactory = {
      spawn(executable, args, options) {
        spawned.push({ executable, args, options });
        process = new FakePty();
        return process;
      },
    };
    const app = createLocalHostApp({
      allowedOrigin,
      approvalIdFactory: () => "approval-1",
      commands: {
        check: {
          executable: "pnpm",
          args: ["test", "toggle-habit"],
        },
      },
      now,
      projectRoot,
      ptyFactory,
      ptyIdFactory: () => "pty-1",
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    const requested = await app.inject({
      method: "POST",
      url: "/api/command-approvals",
      headers: authHeaders,
      payload: { commandId: "check" },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toEqual({
      approval: {
        id: "approval-1",
        status: "pending",
        commandId: "check",
        command: {
          executable: "pnpm",
          args: ["test", "toggle-habit"],
          cwd: ".",
        },
        createdAt: now(),
      },
    });

    const beforeApproval = await app.inject({
      method: "POST",
      url: "/api/pty/sessions",
      headers: authHeaders,
      payload: { approvalId: "approval-1" },
    });
    expect(beforeApproval.statusCode).toBe(409);
    expect(beforeApproval.json()).toEqual({
      error: {
        code: "APPROVAL_REQUIRED",
        message: "Review the exact command before running it.",
      },
    });

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/command-approvals/approval-1/confirm",
      headers: authHeaders,
      payload: { approved: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      approval: { id: "approval-1", status: "approved" },
    });

    const started = await app.inject({
      method: "POST",
      url: "/api/pty/sessions",
      headers: authHeaders,
      payload: { approvalId: "approval-1", cols: 100, rows: 30 },
    });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toEqual({
      session: {
        id: "pty-1",
        commandId: "check",
        status: "running",
        cursor: 0,
      },
    });
    expect(spawned).toEqual([
      {
        executable: "pnpm",
        args: ["test", "toggle-habit"],
        options: { cwd: canonicalProjectRoot, cols: 100, rows: 30 },
      },
    ]);

    process!.emitData("focused check passed\r\n");
    const output = await app.inject({
      method: "GET",
      url: "/api/pty/sessions/pty-1/output?cursor=0",
      headers: authHeaders,
    });
    expect(output.json()).toEqual({
      output: "focused check passed\r\n",
      cursor: 22,
      status: "running",
    });

    const input = await app.inject({
      method: "POST",
      url: "/api/pty/sessions/pty-1/input",
      headers: authHeaders,
      payload: { data: "y" },
    });
    expect(input.statusCode).toBe(204);
    expect(process!.writes).toEqual(["y"]);

    const resized = await app.inject({
      method: "POST",
      url: "/api/pty/sessions/pty-1/resize",
      headers: authHeaders,
      payload: { cols: 120, rows: 40 },
    });
    expect(resized.statusCode).toBe(204);
    expect(process!.sizes).toEqual([{ cols: 120, rows: 40 }]);

    const stopped = await app.inject({
      method: "DELETE",
      url: "/api/pty/sessions/pty-1",
      headers: authHeaders,
    });
    expect(stopped.statusCode).toBe(204);
    expect(process!.kills).toBe(1);

    const reused = await app.inject({
      method: "POST",
      url: "/api/pty/sessions",
      headers: authHeaders,
      payload: { approvalId: "approval-1" },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({
      error: {
        code: "APPROVAL_USED",
        message: "Review the command again before rerunning it.",
      },
    });
  });

  it("never starts an expired approval or an invalid runtime command", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-expired-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    let clock = "2026-08-27T07:30:00.000Z";
    let spawnCount = 0;
    const ptyFactory: PtyFactory = {
      spawn() {
        spawnCount += 1;
        return new FakePty();
      },
    };
    const app = createLocalHostApp({
      allowedOrigin,
      approvalIdFactory: () => "approval-expired",
      commands: {
        check: { executable: "node", args: ["--version"] },
      },
      now: () => clock,
      projectRoot,
      ptyFactory,
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    await app.inject({
      method: "POST",
      url: "/api/command-approvals",
      headers: authHeaders,
      payload: { commandId: "check" },
    });
    await app.inject({
      method: "POST",
      url: "/api/command-approvals/approval-expired/confirm",
      headers: authHeaders,
      payload: { approved: true },
    });
    clock = "2026-08-27T07:36:00.000Z";

    const expired = await app.inject({
      method: "POST",
      url: "/api/pty/sessions",
      headers: authHeaders,
      payload: { approvalId: "approval-expired" },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({
      error: { code: "APPROVAL_REQUIRED" },
    });
    expect(spawnCount).toBe(0);

    expect(() =>
      createLocalHostApp({
        allowedOrigin,
        commands: {
          unsafe: {
            executable: "sh",
            args: ["-c", "echo unsafe"],
          },
        } as never,
        sessionToken,
      }),
    ).toThrow("Invalid command definitions");
  });

  it("returns a stable execution error when the PTY cannot start", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-pty-fail-"));
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    const app = createLocalHostApp({
      allowedOrigin,
      approvalIdFactory: () => "approval-fail",
      commands: {
        check: { executable: "node", args: ["--version"] },
      },
      projectRoot,
      ptyFactory: {
        spawn() {
          throw new Error("native helper unavailable");
        },
      },
      sessionToken,
    });
    cleanups.push(async () => {
      await app.close();
      await rm(container, { recursive: true, force: true });
    });

    await app.inject({
      method: "POST",
      url: "/api/command-approvals",
      headers: authHeaders,
      payload: { commandId: "check" },
    });
    await app.inject({
      method: "POST",
      url: "/api/command-approvals/approval-fail/confirm",
      headers: authHeaders,
      payload: { approved: true },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/pty/sessions",
      headers: authHeaders,
      payload: { approvalId: "approval-fail" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "PTY_FAILED",
        message: "The command could not start. Review it and try again.",
      },
    });
  });
});

class FakePty implements PtyProcess {
  readonly writes: string[] = [];
  readonly sizes: Array<{ cols: number; rows: number }> = [];
  kills = 0;
  private dataListener: (data: string) => void = () => undefined;
  private exitListener: (event: { exitCode: number }) => void = () => undefined;

  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: () => undefined };
  }

  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListener = listener;
    return { dispose: () => undefined };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(cols: number, rows: number) {
    this.sizes.push({ cols, rows });
  }

  kill() {
    this.kills += 1;
  }

  emitData(data: string) {
    this.dataListener(data);
  }

  emitExit(exitCode: number) {
    this.exitListener({ exitCode });
  }
}
