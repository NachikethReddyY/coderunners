import { describe, expect, it, vi } from "vitest";

import { StudioApiClient, takeLaunchSession } from "../src/studio-api.js";

describe("Studio loopback client", () => {
  it("takes the launch token from the URL fragment, clears it, and keeps it out of the request URL", async () => {
    const replaceState = vi.fn();
    const token = takeLaunchSession(
      "http://127.0.0.1:43110/#session=launch-secret",
      replaceState,
    );
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", capabilities: { files: true, pty: true, codecastGeneration: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new StudioApiClient("http://127.0.0.1:43110", token, fetchImplementation);

    await client.health();

    expect(token).toBe("launch-secret");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://127.0.0.1:43110/api/health",
      expect.any(Object),
    );
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("X-CodeRunners-Session")).toBe("launch-secret");
    expect(fetchImplementation.mock.calls[0]?.[0]).not.toContain("launch-secret");
  });

  it("validates the lesson manifest before requesting its allowlisted commands", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true, manifest: { id: "react-habit-toggle" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new StudioApiClient("http://127.0.0.1:43110", "launch-secret", fetchImplementation);

    await client.validateManifest({ id: "react-habit-toggle" });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://127.0.0.1:43110/api/codecasts/validate",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(request?.body).toBe(JSON.stringify({ id: "react-habit-toggle" }));
  });

  it("invokes the browser fetch function without rebinding its receiver", async () => {
    let receiver: unknown = "not called";
    async function fetchImplementation(this: unknown): Promise<Response> {
      receiver = this;
      return new Response(
        JSON.stringify({
          status: "ok",
          capabilities: { files: true, pty: true, codecastGeneration: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const client = new StudioApiClient(
      "http://127.0.0.1:43110",
      "launch-secret",
      fetchImplementation,
    );

    await client.health();

    expect(receiver).toBeUndefined();
  });

  it("requests lazy project directory listings through the confined file API", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          path: "src",
          entries: [{ kind: "file", name: "index.ts", path: "src/index.ts" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new StudioApiClient(
      "http://127.0.0.1:43110",
      "launch-secret",
      fetchImplementation,
    );

    await client.listDirectory("src");

    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://127.0.0.1:43110/api/files/directory?path=src",
      expect.any(Object),
    );
  });
});
