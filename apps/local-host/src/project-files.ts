import { createHash, randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 1_000_000;

export class InvalidProjectPathError extends Error {
  override readonly name = "InvalidProjectPathError";
}

export class StaleProjectFileError extends Error {
  override readonly name = "StaleProjectFileError";
}

export type ProjectFile = {
  path: string;
  content: string;
  revision: string;
};

export type ProjectDirectoryEntry = {
  kind: "directory" | "file" | "symlink";
  name: string;
  path: string;
};

export type ProjectDirectory = {
  entries: ProjectDirectoryEntry[];
  path: string;
};

export class ProjectFiles {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly projectRoot: string) {}

  async list(path: string): Promise<ProjectDirectory> {
    const absolutePath = await this.resolveExisting(path, true);
    const directoryStat = await stat(absolutePath);
    if (!directoryStat.isDirectory()) {
      throw new InvalidProjectPathError();
    }

    const entries = (await readdir(absolutePath, { withFileTypes: true }))
      .map((entry): ProjectDirectoryEntry => ({
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : "file",
        name: entry.name,
        path: path.length === 0 ? entry.name : posix.join(path, entry.name),
      }))
      .sort((left, right) => {
        const kindOrder = { directory: 0, symlink: 1, file: 2 } as const;
        return kindOrder[left.kind] - kindOrder[right.kind]
          || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      });

    return { entries, path };
  }

  async read(path: string): Promise<ProjectFile> {
    const absolutePath = await this.resolveExisting(path);
    const fileStat = await stat(absolutePath);

    if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) {
      throw new InvalidProjectPathError();
    }

    const content = await readFile(absolutePath, "utf8");

    return {
      path,
      content,
      revision: revisionFor(content),
    };
  }

  async write(
    path: string,
    content: string,
    expectedRevision: string,
  ): Promise<Pick<ProjectFile, "path" | "revision">> {
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      throw new InvalidProjectPathError();
    }

    const previousWrite = this.writeQueues.get(path) ?? Promise.resolve();
    let releaseWrite!: () => void;
    const currentWrite = new Promise<void>((resolveWrite) => {
      releaseWrite = resolveWrite;
    });
    this.writeQueues.set(path, currentWrite);

    await previousWrite;
    try {
      const absolutePath = await this.resolveExisting(path);
      const currentContent = await readFile(absolutePath, "utf8");
      if (revisionFor(currentContent) !== expectedRevision) {
        throw new StaleProjectFileError();
      }

      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        throw new InvalidProjectPathError();
      }

      const temporaryPath = resolve(
        dirname(absolutePath),
        `.coderunners-${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporaryPath, content, {
          encoding: "utf8",
          flag: "wx",
          mode: fileStat.mode,
        });
        await rename(temporaryPath, absolutePath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }

      return { path, revision: revisionFor(content) };
    } finally {
      releaseWrite();
      if (this.writeQueues.get(path) === currentWrite) {
        this.writeQueues.delete(path);
      }
    }
  }

  private async resolveExisting(path: string, allowRoot = false): Promise<string> {
    if (
      (!allowRoot && path.length === 0) ||
      path.includes("\0") ||
      path.includes("\\") ||
      isAbsolute(path)
    ) {
      throw new InvalidProjectPathError();
    }

    const root = await realpath(this.projectRoot);
    const candidate = resolve(root, path);
    const relativeCandidate = relative(root, candidate);
    if (
      relativeCandidate === ".." ||
      relativeCandidate.startsWith(`..${sep}`) ||
      isAbsolute(relativeCandidate)
    ) {
      throw new InvalidProjectPathError();
    }

    const resolvedPath = await realpath(candidate);
    const relativeResolvedPath = relative(root, resolvedPath);
    if (
      relativeResolvedPath === ".." ||
      relativeResolvedPath.startsWith(`..${sep}`) ||
      isAbsolute(relativeResolvedPath)
    ) {
      throw new InvalidProjectPathError();
    }

    return resolvedPath;
  }
}

function revisionFor(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
