import { randomBytes } from "node:crypto";

import type { AddressInfo } from "node:net";

import {
  createLocalHostApp,
  type LocalHostOptions,
} from "./server.js";

export const LOOPBACK_HOST = "127.0.0.1";

export type StartLocalHostOptions = Omit<
  LocalHostOptions,
  "allowedOrigin" | "sessionToken"
> & {
  port?: number;
  sessionToken?: string;
};

export type RunningLocalHost = {
  address: { host: typeof LOOPBACK_HOST; port: number };
  origin: string;
  sessionToken: string;
  close(): Promise<void>;
};

export async function startLocalHost(
  options: StartLocalHostOptions = {},
): Promise<RunningLocalHost> {
  const sessionToken =
    options.sessionToken ?? randomBytes(32).toString("base64url");
  const localHostOptions: LocalHostOptions = {
    allowedOrigin: "http://127.0.0.1:0",
    sessionToken,
    ...(options.dataDirectory === undefined
      ? {}
      : { dataDirectory: options.dataDirectory }),
    ...(options.jobIdFactory === undefined
      ? {}
      : { jobIdFactory: options.jobIdFactory }),
    ...(options.lessonAuthor === undefined
      ? {}
      : { lessonAuthor: options.lessonAuthor }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.projectRoot === undefined
      ? {}
      : { projectRoot: options.projectRoot }),
    ...(options.approvalIdFactory === undefined
      ? {}
      : { approvalIdFactory: options.approvalIdFactory }),
    ...(options.commands === undefined ? {} : { commands: options.commands }),
    ...(options.codecastDirectory === undefined
      ? {}
      : { codecastDirectory: options.codecastDirectory }),
    ...(options.ptyFactory === undefined
      ? {}
      : { ptyFactory: options.ptyFactory }),
    ...(options.ptyIdFactory === undefined
      ? {}
      : { ptyIdFactory: options.ptyIdFactory }),
    ...(options.studioDirectory === undefined
      ? {}
      : { studioDirectory: options.studioDirectory }),
  };
  const app = createLocalHostApp(localHostOptions);

  try {
    await app.listen({ host: LOOPBACK_HOST, port: options.port ?? 43110 });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Local Host did not expose a TCP address.");
    }
    const port = (address as AddressInfo).port;
    const origin = `http://${LOOPBACK_HOST}:${port}`;
    localHostOptions.allowedOrigin = origin;

    return {
      address: { host: LOOPBACK_HOST, port },
      origin,
      sessionToken,
      close: () => app.close(),
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
