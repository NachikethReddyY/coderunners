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

  it("accepts the empty 204 response from confirmed Codecast deletion", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new StudioApiClient(
      "http://127.0.0.1:43110",
      "launch-secret",
      fetchImplementation,
    );

    await expect(client.deleteCodecast("codecast-1", "codecast-1")).resolves.toBeUndefined();
  });

  it("accepts an empty successful response from a confirmed Codecast deletion", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const client = new StudioApiClient(
      "http://127.0.0.1:43110",
      "launch-secret",
      fetchImplementation,
    );

    await expect(client.deleteCodecast("codecast-1", "codecast-1")).resolves.toBeUndefined();
  });

  it("fetches authenticated replay audio and writes only the typed checkpoint", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([82, 73, 70, 70]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ codecast: { id: "codecast-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new StudioApiClient(
      "http://127.0.0.1:43110",
      "launch-secret",
      fetchImplementation,
    );

    const audio = await client.readReplayAudio("codecast-1");
    await client.updateCheckpoint("codecast-1", {
      positionMs: 2_000,
      completedChallengeIds: [],
      completed: false,
    });

    expect(audio.type).toBe("audio/wav");
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43110/api/codecasts/codecast-1/checkpoint",
      expect.objectContaining({
        body: JSON.stringify({
          positionMs: 2_000,
          completedChallengeIds: [],
          completed: false,
        }),
        method: "PUT",
      }),
    );
  });
});
