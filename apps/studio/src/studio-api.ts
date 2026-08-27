export type HostCapabilities = {
  codecastGeneration: boolean;
  files: boolean;
  pty: boolean;
};

export type HostHealth = {
  capabilities: HostCapabilities;
  status: "ok";
};

export type ProjectFile = {
  content: string;
  path: string;
  revision: string;
};

export type CommandApproval = {
  command: { args: string[]; cwd: string; executable: string };
  commandId: string;
  id: string;
  status: "pending" | "approved" | "used" | "cancelled";
};

export type PtySession = {
  commandId: string;
  cursor: number;
  id: string;
  status: "running" | "exited";
};

export type PtyOutput = {
  cursor: number;
  exitCode?: number;
  output: string;
  status: "running" | "exited";
};

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ReplaceLocation = (
  data: unknown,
  unused: string,
  url?: string | URL | null,
) => void;

export class StudioApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StudioApiError";
  }
}

export function takeLaunchSession(
  href: string,
  replaceLocation: ReplaceLocation,
): string | undefined {
  const url = new URL(href);
  const params = new URLSearchParams(url.hash.slice(1));
  const session = params.get("session");
  if (session === null || session.length === 0) {
    return undefined;
  }

  replaceLocation(null, "", `${url.pathname}${url.search}`);
  return session;
}

export class StudioApiClient {
  constructor(
    private readonly origin: string,
    private readonly sessionToken: string | undefined,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  health(): Promise<HostHealth> {
    return this.request("/api/health");
  }

  validateManifest(manifest: unknown): Promise<{ valid: true; manifest: unknown }> {
    return this.request("/api/codecasts/validate", {
      body: JSON.stringify(manifest),
      method: "POST",
    });
  }

  readFile(path: string): Promise<ProjectFile> {
    return this.request(`/api/files/content?path=${encodeURIComponent(path)}`);
  }

  writeFile(
    path: string,
    content: string,
    expectedRevision: string,
  ): Promise<Pick<ProjectFile, "path" | "revision">> {
    return this.request("/api/files/content", {
      body: JSON.stringify({ path, content, expectedRevision }),
      method: "PUT",
    });
  }

  requestCommandApproval(commandId: string): Promise<{ approval: CommandApproval }> {
    return this.request("/api/command-approvals", {
      body: JSON.stringify({ commandId }),
      method: "POST",
    });
  }

  confirmCommandApproval(
    approvalId: string,
    approved: boolean,
  ): Promise<{ approval: CommandApproval }> {
    return this.request(`/api/command-approvals/${encodeURIComponent(approvalId)}/confirm`, {
      body: JSON.stringify({ approved }),
      method: "POST",
    });
  }

  startPty(approvalId: string): Promise<{ session: PtySession }> {
    return this.request("/api/pty/sessions", {
      body: JSON.stringify({ approvalId, cols: 100, rows: 18 }),
      method: "POST",
    });
  }

  readPtyOutput(sessionId: string, cursor: number): Promise<PtyOutput> {
    return this.request(
      `/api/pty/sessions/${encodeURIComponent(sessionId)}/output?cursor=${cursor}`,
    );
  }

  writePtyInput(sessionId: string, data: string): Promise<void> {
    return this.request(`/api/pty/sessions/${encodeURIComponent(sessionId)}/input`, {
      body: JSON.stringify({ data }),
      method: "POST",
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (this.sessionToken !== undefined) {
      headers.set("X-CodeRunners-Session", this.sessionToken);
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.origin}${path}`, {
        ...init,
        headers,
      });
    } catch {
      throw new StudioApiError(
        "HOST_UNAVAILABLE",
        "The local host is unavailable. Restart it; your browser work remains here.",
        0,
      );
    }

    if (!response.ok) {
      const error = (await response.json().catch(() => undefined)) as
        | { error?: { code?: unknown; message?: unknown } }
        | undefined;
      throw new StudioApiError(
        typeof error?.error?.code === "string" ? error.error.code : "HOST_ERROR",
        typeof error?.error?.message === "string"
          ? error.error.message
          : "The local host could not complete this action.",
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}
