import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileCodecastManifest,
  validateCodecastManifest,
  type CodecastDraft,
  type CodecastManifest,
  type CodecastModelSelection,
  type MediaGenerationResult,
} from "@coderunners/contracts";

const AUDIO_SOURCE = "audio/codecast.wav";

export type CodecastArtifactGenerator = {
  generate(input: {
    projectId: string;
    codecastId: string;
    draft: CodecastDraft;
    models?: CodecastModelSelection;
    outputDirectory: string;
  }): Promise<CodecastManifest>;
};

export type CodecastBundleMetadata = {
  version: 1;
  projectId: string;
  codecastId: string;
  jobId: string;
  manifestPath: "manifest.json";
};

export type ValidatedCodecastBundle = {
  directory: string;
  manifest: CodecastManifest;
  audioPath: string;
};

export class ReplayArtifactError extends Error {
  override readonly name = "ReplayArtifactError";

  constructor(
    message = "The Codecast replay bundle is missing or invalid.",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LocalMediaArtifactGenerator implements CodecastArtifactGenerator {
  async generate(input: {
    projectId: string;
    codecastId: string;
    draft: CodecastDraft;
    models?: CodecastModelSelection;
    outputDirectory: string;
  }): Promise<CodecastManifest> {
    if (
      input.models !== undefined &&
      (input.models.tts !== "local:kokoro-82m-8bit" ||
        input.models.stt !== "local:whisper-medium-mlx")
    ) {
      throw new ReplayArtifactError(
        "The selected local speech models are not available to the media worker.",
      );
    }
    const audioDirectory = join(input.outputDirectory, "audio");
    await mkdir(audioDirectory, { recursive: true, mode: 0o700 });
    const draft = {
      ...input.draft,
      id: input.codecastId,
    };
    const media = await runMediaWorker(draft, audioDirectory);
    const compiled = compileCodecastManifest(draft, media, AUDIO_SOURCE);
    if (!compiled.success) {
      throw new ReplayArtifactError("Generated media does not match the lesson draft.");
    }
    return compiled.data;
  }
}

export async function stageCodecastBundle(input: {
  dataDirectory: string;
  projectId: string;
  codecastId: string;
  jobId: string;
  draft: CodecastDraft;
  models?: CodecastModelSelection;
  generator: CodecastArtifactGenerator;
}): Promise<string> {
  await mkdir(input.dataDirectory, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(input.dataDirectory);
  const stagingRoot = join(dataRoot, "staging");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const directory = join(stagingRoot, `${input.jobId}-${randomUUID()}`);
  assertDescendant(dataRoot, directory);
  await mkdir(directory, { mode: 0o700 });

  try {
    const manifest = await input.generator.generate({
      projectId: input.projectId,
      codecastId: input.codecastId,
      draft: input.draft,
      ...(input.models === undefined ? {} : { models: input.models }),
      outputDirectory: directory,
    });
    const validation = validateCodecastManifest(manifest);
    if (!validation.success || validation.data.id !== input.codecastId) {
      throw new ReplayArtifactError("Generated replay manifest is invalid.");
    }
    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(validation.data, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    const metadata: CodecastBundleMetadata = {
      version: 1,
      projectId: input.projectId,
      codecastId: input.codecastId,
      jobId: input.jobId,
      manifestPath: "manifest.json",
    };
    await writeFile(
      join(directory, "bundle.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await validateCodecastBundle(directory, {
      projectId: input.projectId,
      codecastId: input.codecastId,
      jobId: input.jobId,
    });
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function validateCodecastBundle(
  directory: string,
  expected: { projectId: string; codecastId: string; jobId: string },
): Promise<ValidatedCodecastBundle> {
  try {
    const resolvedDirectory = await realpath(directory);
    if (resolvedDirectory !== directory) {
      throw new ReplayArtifactError();
    }
    const metadata = JSON.parse(
      await readFile(join(directory, "bundle.json"), "utf8"),
    ) as Partial<CodecastBundleMetadata>;
    if (
      metadata.version !== 1 ||
      metadata.projectId !== expected.projectId ||
      metadata.codecastId !== expected.codecastId ||
      metadata.jobId !== expected.jobId ||
      metadata.manifestPath !== "manifest.json"
    ) {
      throw new ReplayArtifactError();
    }

    const parsedManifest = JSON.parse(
      await readFile(join(directory, metadata.manifestPath), "utf8"),
    ) as unknown;
    const manifest = validateCodecastManifest(parsedManifest);
    if (
      !manifest.success ||
      manifest.data.id !== expected.codecastId ||
      manifest.data.audio.src !== AUDIO_SOURCE
    ) {
      throw new ReplayArtifactError();
    }

    const audioPath = join(directory, AUDIO_SOURCE);
    assertDescendant(directory, audioPath);
    const resolvedAudio = await realpath(audioPath);
    assertDescendant(directory, resolvedAudio);
    if (!(await lstat(resolvedAudio)).isFile()) {
      throw new ReplayArtifactError();
    }
    const header = (await readFile(resolvedAudio)).subarray(0, 12);
    if (
      header.length < 12 ||
      header.subarray(0, 4).toString("ascii") !== "RIFF" ||
      header.subarray(8, 12).toString("ascii") !== "WAVE"
    ) {
      throw new ReplayArtifactError();
    }
    return { directory, manifest: manifest.data, audioPath: resolvedAudio };
  } catch (error) {
    if (error instanceof ReplayArtifactError) {
      throw error;
    }
    throw new ReplayArtifactError(undefined, { cause: error });
  }
}

function runMediaWorker(
  draft: CodecastDraft,
  outputDirectory: string,
): Promise<MediaGenerationResult> {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const mediaProject = join(repositoryRoot, "services", "media");
  return new Promise((resolve, reject) => {
    const worker = spawn(
      "uv",
      ["run", "--project", mediaProject, "--frozen", "coderunners-media"],
      { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    worker.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    worker.once("error", reject);
    worker.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Media worker exited with ${String(code)}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        const records = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        const response = [...records]
          .reverse()
          .find((record) => record.id === "generate");
        if (response?.ok !== true || response.result === undefined) {
          reject(new Error("Media worker did not return finalized artifacts."));
          return;
        }
        resolve(response.result as MediaGenerationResult);
      } catch (error) {
        reject(new Error("Media worker returned malformed output.", { cause: error }));
      }
    });
    worker.stdin.end(`${JSON.stringify({
      id: "generate",
      method: "media.generate",
      params: { draft, outputDirectory },
    })}\n`);
  });
}

function assertDescendant(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new ReplayArtifactError("Replay artifact path escaped app-owned storage.");
  }
}
