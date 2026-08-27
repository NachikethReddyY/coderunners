import { chmod, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const entrypoint = fileURLToPath(import.meta.resolve("node-pty"));
  const packageRoot = resolve(dirname(entrypoint), "..");
  const helperCandidates = [
    resolve(
      packageRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    ),
    resolve(packageRoot, "build", "Release", "spawn-helper"),
  ];

  for (const helperPath of helperCandidates) {
    try {
      const helperStat = await stat(helperPath);
      if ((helperStat.mode & 0o111) === 0) {
        await chmod(helperPath, helperStat.mode | 0o755);
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
