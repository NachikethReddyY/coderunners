import type {
  BranchListResponse,
  CodecastListResponse,
  CodecastReplayResponse,
  CodecastResponse,
  CreateCodecastRequest,
  DeleteCodecastRequest,
  ModelConfigurationResponse,
  ModelSettingsUpdate,
  PlaybackCheckpointUpdate,
  ProjectListResponse,
} from "@coderunners/contracts";

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

export type ProjectDirectoryEntry = {
  kind: "directory" | "file" | "symlink";
  name: string;
  path: string;
};

export type ProjectDirectory = {
  entries: ProjectDirectoryEntry[];
  path: string;
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

  listProjects(): Promise<ProjectListResponse> {
    return this.request("/api/projects");
  }

  listBranches(projectId: string): Promise<BranchListResponse> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/branches`);
  }

  listCodecasts(projectId: string): Promise<CodecastListResponse> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/codecasts`);
  }

  createCodecast(
    projectId: string,
    request: CreateCodecastRequest,
  ): Promise<CodecastResponse> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/codecasts`, {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  getReplay(codecastId: string): Promise<CodecastReplayResponse> {
    return this.request(`/api/codecasts/${encodeURIComponent(codecastId)}/replay`);
  }

  readReplayAudio(codecastId: string): Promise<Blob> {
    return this.requestBlob(`/api/codecasts/${encodeURIComponent(codecastId)}/audio`);
  }

  updateCheckpoint(
    codecastId: string,
    checkpoint: PlaybackCheckpointUpdate,
  ): Promise<CodecastResponse> {
    return this.request(`/api/codecasts/${encodeURIComponent(codecastId)}/checkpoint`, {
      body: JSON.stringify(checkpoint),
      method: "PUT",
    });
  }

  deleteCodecast(
    codecastId: string,
    confirmCodecastId: DeleteCodecastRequest["confirmCodecastId"],
  ): Promise<void> {
    return this.request(`/api/codecasts/${encodeURIComponent(codecastId)}`, {
      body: JSON.stringify({ confirmCodecastId }),
      method: "DELETE",
    });
  }

  getModels(): Promise<ModelConfigurationResponse> {
    return this.request("/api/models");
  }

  updateModels(update: ModelSettingsUpdate): Promise<ModelConfigurationResponse> {
    return this.request("/api/settings/models", {
      body: JSON.stringify(update),
      method: "PUT",
    });
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

  listDirectory(path: string): Promise<ProjectDirectory> {
    return this.request(`/api/files/directory?path=${encodeURIComponent(path)}`);
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
    const response = await this.fetchResponse(path, init);

    if (response.status === 204) {
      return undefined as T;
    }

    const responseText = await response.text();
    return responseText.trim().length === 0
      ? (undefined as T)
      : (JSON.parse(responseText) as T);
  }

  private async requestBlob(path: string): Promise<Blob> {
    return (await this.fetchResponse(path)).blob();
  }

  private async fetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
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
      const fetchRequest = this.fetchImplementation;
      response = await fetchRequest(`${this.origin}${path}`, {
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

    return response;
  }
}
