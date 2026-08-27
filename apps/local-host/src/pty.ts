import { randomUUID } from "node:crypto";
import { constants, accessSync } from "node:fs";
import { realpath } from "node:fs/promises";
import {
  delimiter,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { CommandDefinition } from "@coderunners/contracts";
import * as nodePty from "node-pty";

const MAX_BUFFER_CHARACTERS = 1_000_000;
const ALLOWED_EXECUTABLES = new Set([
  "node",
  "npm",
  "pnpm",
  "python3",
  "uv",
]);

export type Disposable = { dispose(): void };

export type PtyProcess = {
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number }) => void): Disposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtySpawnOptions = {
  cwd: string;
  cols: number;
  rows: number;
};

export type PtyFactory = {
  spawn(
    executable: string,
    args: string[],
    options: PtySpawnOptions,
  ): PtyProcess;
};

export class NodePtyFactory implements PtyFactory {
  spawn(
    executable: string,
    args: string[],
    options: PtySpawnOptions,
  ): PtyProcess {
    return nodePty.spawn(resolveExecutable(executable), args, {
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      name: "xterm-256color",
      env: definedEnvironment(),
    });
  }
}

function resolveExecutable(executable: string): string {
  if (!ALLOWED_EXECUTABLES.has(executable)) {
    throw new CommandNotFoundError();
  }
  if (executable === "node") {
    return process.execPath;
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    const candidate = join(directory, executable);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed process PATH; no shell lookup is used.
    }
  }

  throw new CommandNotFoundError();
}

export type CommandApproval = {
  id: string;
  status: "pending" | "approved" | "used" | "cancelled";
  commandId: string;
  command: CommandDefinition & { cwd: string };
  createdAt: string;
};

type ApprovalRecord = {
  approval: CommandApproval;
  expiresAt: number;
};

export class ApprovalRequiredError extends Error {
  override readonly name = "ApprovalRequiredError";
}

export class ApprovalUsedError extends Error {
  override readonly name = "ApprovalUsedError";
}

export class ApprovalNotFoundError extends Error {
  override readonly name = "ApprovalNotFoundError";
}

export class CommandNotFoundError extends Error {
  override readonly name = "CommandNotFoundError";
}

export class PtySessionNotFoundError extends Error {
  override readonly name = "PtySessionNotFoundError";
}

export class CommandApprovals {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private commands: Record<string, CommandDefinition>;

  constructor(
    commands: Record<string, CommandDefinition>,
    private readonly idFactory: () => string = randomUUID,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.commands = structuredClone(commands);
  }

  get hasCommands(): boolean {
    return Object.keys(this.commands).length > 0;
  }

  replaceCommands(commands: Record<string, CommandDefinition>): void {
    this.commands = structuredClone(commands);
    this.approvals.clear();
  }

  request(commandId: string): CommandApproval {
    const command = this.commands[commandId];
    if (command === undefined) {
      throw new CommandNotFoundError();
    }

    const createdAt = this.now();
    const approval: CommandApproval = {
      id: this.idFactory(),
      status: "pending",
      commandId,
      command: { ...structuredClone(command), cwd: command.cwd ?? "." },
      createdAt,
    };
    this.approvals.set(approval.id, {
      approval,
      expiresAt: Date.parse(createdAt) + 5 * 60_000,
    });
    return structuredClone(approval);
  }

  confirm(id: string, approved: boolean): CommandApproval {
    const record = this.getRecord(id);
    this.ensurePending(record);
    record.approval.status = approved ? "approved" : "cancelled";
    return structuredClone(record.approval);
  }

  consume(id: string): CommandApproval {
    const record = this.getRecord(id);
    if (record.approval.status === "used") {
      throw new ApprovalUsedError();
    }
    if (record.approval.status !== "approved") {
      throw new ApprovalRequiredError();
    }
    if (record.expiresAt <= Date.parse(this.now())) {
      throw new ApprovalRequiredError();
    }
    record.approval.status = "used";
    return structuredClone(record.approval);
  }

  private getRecord(id: string): ApprovalRecord {
    const record = this.approvals.get(id);
    if (record === undefined) {
      throw new ApprovalNotFoundError();
    }
    return record;
  }

  private ensurePending(record: ApprovalRecord): void {
    if (
      record.approval.status !== "pending" ||
      record.expiresAt <= Date.parse(this.now())
    ) {
      throw new ApprovalRequiredError();
    }
  }
}

export type PtySessionSummary = {
  id: string;
  commandId: string;
  status: "running" | "exited";
  cursor: number;
};

type PtySession = PtySessionSummary & {
  process: PtyProcess;
  output: string;
  baseCursor: number;
  exitCode?: number;
};

export class PtySessions {
  private readonly sessions = new Map<string, PtySession>();

  constructor(
    private readonly projectRoot: string,
    private readonly factory: PtyFactory = new NodePtyFactory(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  async start(
    approval: CommandApproval,
    size: { cols?: number; rows?: number },
  ): Promise<PtySessionSummary> {
    const cwd = await resolveProjectDirectory(
      this.projectRoot,
      approval.command.cwd,
    );
    const cols = boundedDimension(size.cols, 80, 20, 300);
    const rows = boundedDimension(size.rows, 24, 5, 120);
    const process = this.factory.spawn(
      approval.command.executable,
      [...approval.command.args],
      { cwd, cols, rows },
    );
    const session: PtySession = {
      id: this.idFactory(),
      commandId: approval.commandId,
      status: "running",
      cursor: 0,
      process,
      output: "",
      baseCursor: 0,
    };
    this.sessions.set(session.id, session);

    process.onData((data) => {
      session.output += data;
      session.cursor += data.length;
      if (session.output.length > MAX_BUFFER_CHARACTERS) {
        const removed = session.output.length - MAX_BUFFER_CHARACTERS;
        session.output = session.output.slice(removed);
        session.baseCursor += removed;
      }
    });
    process.onExit(({ exitCode }) => {
      session.status = "exited";
      session.exitCode = exitCode;
    });

    return summarize(session);
  }

  output(id: string, cursor: number): {
    output: string;
    cursor: number;
    status: "running" | "exited";
    exitCode?: number;
  } {
    const session = this.get(id);
    const offset = Math.max(cursor - session.baseCursor, 0);
    const result = {
      output: session.output.slice(offset),
      cursor: session.cursor,
      status: session.status,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    };
    return result;
  }

  write(id: string, data: string): void {
    const session = this.get(id);
    if (session.status !== "running" || data.length > 65_536) {
      throw new PtySessionNotFoundError();
    }
    session.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.get(id);
    if (
      session.status !== "running" ||
      !Number.isInteger(cols) ||
      cols < 20 ||
      cols > 300 ||
      !Number.isInteger(rows) ||
      rows < 5 ||
      rows > 120
    ) {
      throw new PtySessionNotFoundError();
    }
    session.process.resize(cols, rows);
  }

  stop(id: string): void {
    const session = this.get(id);
    if (session.status === "running") {
      session.process.kill();
      session.status = "exited";
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      if (session.status === "running") {
        session.process.kill();
      }
    }
  }

  private get(id: string): PtySession {
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new PtySessionNotFoundError();
    }
    return session;
  }
}

function summarize(session: PtySession): PtySessionSummary {
  return {
    id: session.id,
    commandId: session.commandId,
    status: session.status,
    cursor: session.cursor,
  };
}

async function resolveProjectDirectory(
  projectRoot: string,
  relativeDirectory: string,
): Promise<string> {
  if (
    relativeDirectory.includes("\\") ||
    isAbsolute(relativeDirectory)
  ) {
    throw new ApprovalRequiredError();
  }
  const root = await realpath(projectRoot);
  const directory = await realpath(resolve(root, relativeDirectory));
  const relativeDirectoryPath = relative(root, directory);
  if (
    relativeDirectoryPath === ".." ||
    relativeDirectoryPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectoryPath)
  ) {
    throw new ApprovalRequiredError();
  }
  return directory;
}

function boundedDimension(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isInteger(value) && value! >= minimum && value! <= maximum
    ? value!
    : fallback;
}

function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
