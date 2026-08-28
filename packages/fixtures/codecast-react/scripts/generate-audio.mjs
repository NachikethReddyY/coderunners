import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const mediaProject = fileURLToPath(new URL("../../../../services/media/", import.meta.url));
const lessonDirectoryFlag = process.argv.indexOf("--lesson-directory");
const lessonDirectory = lessonDirectoryFlag === -1
  ? fileURLToPath(new URL("../", import.meta.url))
  : process.argv[lessonDirectoryFlag + 1];
if (lessonDirectory === undefined || lessonDirectory.startsWith("--")) {
  throw new Error("Use --lesson-directory with an existing lesson directory.");
}
const lessonRoot = resolve(lessonDirectory);
const outputDirectory = resolve(lessonRoot, "audio");
const draftPath = resolve(lessonRoot, "draft.json");
const manifestPath = resolve(lessonRoot, "manifest.json");
const timingPath = resolve(outputDirectory, "timing.json");
const resultPathFlag = process.argv.indexOf("--result-path");
const resultPath = resultPathFlag === -1 ? undefined : process.argv[resultPathFlag + 1];
if (resultPathFlag !== -1 && (resultPath === undefined || resultPath.startsWith("--"))) {
  throw new Error("Use --result-path with an absolute or relative JSON path.");
}
const draft = JSON.parse(await readFile(draftPath, "utf8"));
const reuseAudio = process.argv.includes("--reuse-audio");
const referenceAudioFlag = process.argv.indexOf("--reference-audio");
const referenceAudioPath = referenceAudioFlag === -1
  ? undefined
  : process.argv[referenceAudioFlag + 1];
const referenceTranscriptFlag = process.argv.indexOf("--reference-transcript");
const referenceTranscriptPath = referenceTranscriptFlag === -1
  ? undefined
  : process.argv[referenceTranscriptFlag + 1];

if (referenceAudioFlag !== -1 && (referenceAudioPath === undefined || referenceAudioPath.startsWith("--"))) {
  throw new Error("Use --reference-audio with an absolute WAV path.");
}
if (referenceAudioPath !== undefined && (referenceTranscriptPath === undefined || referenceTranscriptPath.startsWith("--"))) {
  throw new Error("Reference narration requires --reference-transcript with an absolute plain-text transcript.");
}
const referenceText = referenceTranscriptPath === undefined
  ? undefined
  : (await readFile(referenceTranscriptPath, "utf8")).trim();
if (referenceText !== undefined && !referenceText) {
  throw new Error("The reference transcript must not be empty.");
}

const request = {
  id: "fixture-audio",
  method: "media.generate",
  params: {
    draft,
    outputDirectory,
    cacheDirectory: `${homedir()}/.cache/coderunners/media`,
    voice: referenceAudioPath === undefined ? "af_heart" : "reference-audio",
    speed: 1,
    ...(referenceAudioPath === undefined
      ? {}
      : { referenceAudioPath, referenceText }),
  },
};

const result = reuseAudio ? await readExistingResult() : await generateMedia();

const { compileCodecastManifest } = await import("../../../contracts/dist/index.js");
const compiled = compileCodecastManifest(draft, result, "audio/codecast.wav");
if (!compiled.success) {
  throw new Error(`Generated timing did not compile: ${JSON.stringify(compiled.errors)}`);
}

await writeFile(manifestPath, `${JSON.stringify(compiled.data, null, 2)}\n`);
if (!reuseAudio) {
  await writeFile(timingPath, `${JSON.stringify({
    schemaVersion: result.timing.schemaVersion,
    durationMs: result.timing.durationMs,
    alignmentConfidence: result.timing.alignmentConfidence,
    cues: result.cues,
    words: result.timing.words,
  }, null, 2)}\n`);
  if (resultPath !== undefined) {
    await writeFile(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`);
  }
}

async function generateMedia() {
  const worker = spawn(
    "uv",
    ["run", "--project", mediaProject, "--frozen", "coderunners-media"],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "inherit"] },
  );
  let output = "";
  worker.stdout.setEncoding("utf8");
  worker.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  worker.stdin.end(`${JSON.stringify(request)}\n`);
  const exitCode = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`Media worker exited with code ${String(exitCode)}.`);
  }
  const records = output.trim().split("\n").map((line) => JSON.parse(line));
  const response = records.findLast((record) => record.id === request.id && "ok" in record);
  if (response?.ok !== true) {
    throw new Error(response?.error?.message ?? "Media worker did not return fixture audio.");
  }
  return response.result;
}

async function readExistingResult() {
  const timing = JSON.parse(await readFile(timingPath, "utf8"));
  return {
    audio: {
      path: resolve(outputDirectory, "codecast.wav"),
      format: "pcm-wav",
      durationMs: timing.durationMs,
    },
    cues: timing.cues,
    timing: {
      schemaVersion: timing.schemaVersion,
      durationMs: timing.durationMs,
      alignmentConfidence: timing.alignmentConfidence,
      words: timing.words,
    },
  };
}
