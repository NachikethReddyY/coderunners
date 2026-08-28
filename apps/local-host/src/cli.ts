import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { startLocalHost } from "./launcher.js";

const { codecastDirectory, port, projectRoot, studioDirectory } = parseArguments(
  process.argv.slice(2),
);
const host = await startLocalHost({
  port,
  projectRoot,
  ...(codecastDirectory === undefined ? {} : { codecastDirectory }),
  ...(studioDirectory === undefined ? {} : { studioDirectory }),
});
const launchUrl = `${host.origin}/#session=${encodeURIComponent(host.sessionToken)}`;

process.stdout.write(
  `${JSON.stringify({ status: "ready", origin: host.origin, projectRoot })}\n`,
);

if (process.platform === "darwin" && studioDirectory !== undefined) {
  spawn("open", [launchUrl], { detached: true, stdio: "ignore" }).unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void host.close().finally(() => process.exit(0));
  });
}

function parseArguments(args: string[]): {
  codecastDirectory?: string;
  port: number;
  projectRoot: string;
  studioDirectory?: string;
} {
  let port = 43110;
  let codecastDirectory: string | undefined;
  let projectRoot = process.cwd();
  let studioDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--port") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 0 || value > 65_535) {
        throw new Error("--port must be between 0 and 65535.");
      }
      port = value;
      index += 1;
    } else if (argument === "--project-root") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--project-root requires a path.");
      }
      projectRoot = resolve(value);
      index += 1;
    } else if (argument === "--codecast-directory") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--codecast-directory requires a path.");
      }
      codecastDirectory = resolve(value);
      index += 1;
    } else if (argument === "--studio-directory") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--studio-directory requires a path.");
      }
      studioDirectory = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return {
    ...(codecastDirectory === undefined ? {} : { codecastDirectory }),
    port,
    projectRoot,
    ...(studioDirectory === undefined ? {} : { studioDirectory }),
  };
}
