import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectApprovalError,
  ProjectLibrary,
  WorkspaceError,
} from "../src/index.js";

const execFile = promisify(execFileCallback);
const now = () => "2026-08-29T08:00:00.000Z";

describe("persistent project library", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("persists approved canonical projects and rejects every unapproved path", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-library-"));
    const approved = join(container, "approved");
    const unapproved = join(container, "unapproved");
    const dataDirectory = join(container, "data");
    await mkdir(approved);
    await mkdir(unapproved);
    cleanups.push(() => rm(container, { recursive: true, force: true }));

    const library = new ProjectLibrary({
      approvedProjectRoots: [approved],
      dataDirectory,
      idFactory: () => "project-1",
      now,
    });
    const project = await library.addProject({ root: approved });
    expect(project).toMatchObject({
      id: "project-1",
      displayName: "approved",
      root: await realpath(approved),
    });

    await expect(library.addProject({ root: unapproved })).rejects.toBeInstanceOf(
      ProjectApprovalError,
    );
    await expect(library.addProject({ root: "relative/project" })).rejects.toBeInstanceOf(
      ProjectApprovalError,
    );

    const restored = new ProjectLibrary({
      approvedProjectRoots: [approved],
      dataDirectory,
      now,
    });
    await expect(restored.listProjects()).resolves.toEqual([project]);
  });

  it("discovers branches and creates worktrees only below app-owned storage", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-worktree-"));
    const projectRoot = join(container, "project");
    const dataDirectory = join(container, "data");
    await mkdir(projectRoot);
    await execFile("git", ["init", "-b", "main"], { cwd: projectRoot });
    await execFile("git", ["config", "user.email", "tests@coderunners.local"], { cwd: projectRoot });
    await execFile("git", ["config", "user.name", "CodeRunners Tests"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "# fixture\n");
    await execFile("git", ["add", "README.md"], { cwd: projectRoot });
    await execFile("git", ["commit", "-m", "fixture"], { cwd: projectRoot });
    await execFile("git", ["branch", "feature/existing"], { cwd: projectRoot });
    cleanups.push(() => rm(container, { recursive: true, force: true }));

    const ids = ["project-git", "codecast-1"];
    const library = new ProjectLibrary({
      approvedProjectRoots: [projectRoot],
      dataDirectory,
      idFactory: () => ids.shift()!,
      now,
    });
    const project = await library.addProject({ root: projectRoot });
    await expect(library.listBranches(project.id)).resolves.toEqual([
      { name: "feature/existing", current: false, checkedOut: false },
      { name: "main", current: true, checkedOut: true },
    ]);

    await execFile("git", ["checkout", "--detach"], { cwd: projectRoot });
    await expect(library.addProject({ root: projectRoot })).resolves.toMatchObject({
      repository: { kind: "git", currentBranch: null },
    });

    const codecast = await library.createCodecast(project.id, {
      title: "Worktree safety",
      outcome: "Keep the selected worktree after replay deletion.",
      workspace: {
        mode: "new-worktree",
        branch: "feature/codecast-1",
        createBranch: true,
        startPoint: "main",
      },
      models: {
        authoring: "openai:gpt-5.6-sol",
        authoringReasoning: "high",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    });
    const canonicalDataDirectory = await realpath(dataDirectory);
    const workspaceRoot = join(
      canonicalDataDirectory,
      "worktrees",
      project.id,
      codecast.id,
    );
    expect(codecast.workspace).toEqual({
      mode: "new-worktree",
      branch: "feature/codecast-1",
    });
    await expect(stat(join(workspaceRoot, ".git"))).resolves.toBeDefined();

    await library.deleteCodecast(codecast.id, codecast.id);
    await expect(stat(join(workspaceRoot, ".git"))).resolves.toBeDefined();

    await expect(
      library.prepareWorkspace(project.id, "codecast-2", {
        mode: "new-worktree",
        branch: "../escape",
        createBranch: true,
        startPoint: "main",
      }),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });

  it("deletes only an exact Codecast record and its app-owned bundle", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-delete-"));
    const projectRoot = join(container, "project");
    const dataDirectory = join(container, "data");
    await mkdir(projectRoot);
    cleanups.push(() => rm(container, { recursive: true, force: true }));
    const ids = ["project-1", "codecast-1"];
    const library = new ProjectLibrary({
      approvedProjectRoots: [projectRoot],
      dataDirectory,
      idFactory: () => ids.shift()!,
      now,
    });
    const project = await library.addProject({ root: projectRoot });
    const codecast = await library.createCodecast(project.id, {
      title: "State transitions",
      outcome: "Explain immutable updates.",
      workspace: { mode: "local-checkout", branch: null },
      models: {
        authoring: "openai:gpt-5.6-sol",
        authoringReasoning: "high",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    });
    const bundle = join(dataDirectory, "codecasts", codecast.id);
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, "manifest.json"), "{}\n");

    await expect(
      library.deleteCodecast(codecast.id, "wrong-id"),
    ).rejects.toThrow("exact Codecast identifier");
    await library.deleteCodecast(codecast.id, codecast.id);

    await expect(library.getProject(project.id)).resolves.toEqual(project);
    await expect(library.listCodecasts(project.id)).resolves.toEqual([]);
    await expect(stat(projectRoot)).resolves.toBeDefined();
    const trashEntries = JSON.parse(
      await readFile(join(dataDirectory, "library.json"), "utf8"),
    ) as { projects: unknown[]; codecasts: unknown[] };
    expect(trashEntries.projects).toHaveLength(1);
    expect(trashEntries.codecasts).toHaveLength(0);
  });

  it("rejects tampered persisted workspace roots before exposing records", async () => {
    const container = await mkdtemp(join(tmpdir(), "coderunners-tampered-"));
    const dataDirectory = join(container, "data");
    const projectRoot = join(container, "project");
    await mkdir(projectRoot);
    cleanups.push(() => rm(container, { recursive: true, force: true }));
    const ids = ["project-1", "codecast-1"];
    const source = new ProjectLibrary({
      approvedProjectRoots: [projectRoot],
      dataDirectory,
      idFactory: () => ids.shift()!,
      now,
    });
    const project = await source.addProject({ root: projectRoot });
    await source.createCodecast(project.id, {
      title: "Tampered",
      outcome: "Must not escape app storage.",
      workspace: { mode: "local-checkout", branch: null },
      models: {
        authoring: "openai:gpt-5.6-sol",
        authoringReasoning: "high",
        stt: "local:whisper-medium-mlx",
        tts: "local:kokoro-82m-8bit",
      },
    });
    const document = JSON.parse(
      await readFile(join(dataDirectory, "library.json"), "utf8"),
    ) as { codecasts: Array<{ workspaceRoot: string }> };
    document.codecasts[0]!.workspaceRoot = "/tmp/user-controlled";
    await writeFile(
      join(dataDirectory, "library.json"),
      `${JSON.stringify(document)}\n`,
    );

    const library = new ProjectLibrary({
      approvedProjectRoots: [],
      dataDirectory,
      now,
    });
    await expect(library.listProjects()).rejects.toThrow(
      "Invalid project library document",
    );
  });
});
