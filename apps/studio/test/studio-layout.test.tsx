import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/MonacoEditor.js", () => ({
  MonacoEditor: ({ readOnly, value }: { readOnly: boolean; value: string }) => (
    <div aria-label="Learner code editor" data-readonly={String(readOnly)}>{value}</div>
  ),
}));

vi.mock("../src/TerminalPanel.js", () => ({
  TerminalPanel: () => <div aria-label="Terminal output" />,
}));

import { Studio } from "../src/Studio.js";

describe("Studio layout", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the editor primary and gives lesson, file, and utility controls clear homes", () => {
    const { container } = render(<Studio />);

    expect(screen.getByRole("navigation", { name: "Lesson navigation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build a typed function" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New session" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open preview" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Project files" })).toBeTruthy();
    expect(screen.getByRole("tree", { name: "Project filesystem" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "src" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "formatHabitLabel.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save current file" })).toBeTruthy();
    const run = screen.getByRole("button", { name: "Run project check" }) as HTMLButtonElement;
    const save = screen.getByRole("button", { name: "Save current file" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(screen.getByText("Demo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh files" })).toBeNull();
    expect(screen.getByRole("button", { name: "Play Codecast" })).toBeTruthy();

    const speed = screen.getByRole("combobox", { name: "Playback speed" }) as HTMLSelectElement;
    expect(speed.value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Adjust volume" }));
    const volume = screen.getByRole("slider", { name: "Playback volume" }) as HTMLInputElement;
    expect(volume.value).toBe("1");
    fireEvent.change(volume, { target: { value: "0.4" } });
    expect(volume.value).toBe("0.4");
    expect((document.querySelector("audio") as HTMLAudioElement).volume).toBe(0.4);

    expect(screen.getByRole("button", { name: "Hide captions" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".caption")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide captions" }));
    expect(screen.getByRole("button", { name: "Show captions" }).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".caption")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show captions" }));

    const timeline = screen.getByRole("slider", { name: "Codecast timeline" }) as HTMLInputElement;
    expect(timeline.disabled).toBe(false);
    fireEvent.change(timeline, { target: { value: "8000" } });
    expect(timeline.value).toBe("8000");
    expect(container.querySelectorAll(".timeline-marker")).toHaveLength(1);

    fireEvent.change(timeline, { target: { value: timeline.max } });
    expect(screen.getByRole("button", { name: "Play Codecast" }).hasAttribute("disabled")).toBe(true);
    expect(speed.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Adjust volume" }).disabled).toBe(true);
    expect(run.disabled).toBe(false);
    expect(save.disabled).toBe(false);
    expect(screen.queryByText("Demo")).toBeNull();
    expect(screen.getByRole("button", { name: "Run check" })).toBeTruthy();
    expect(document.querySelector(".caption")?.textContent).toBe("Save your work, then run the focused check.");

    fireEvent.change(timeline, { target: { value: "8000" } });
    expect(screen.queryByRole("button", { name: "Run check" })).toBeNull();
    expect(speed.disabled).toBe(false);
    expect(run.disabled).toBe(true);
    expect(screen.getByText("Demo")).toBeTruthy();

    const terminal = container.querySelector(".terminal-pane");
    expect(terminal).not.toBeNull();
    expect(terminal?.hasAttribute("hidden")).toBe(true);
    expect(screen.queryByText("real local output")).toBeNull();
  });

  it("replays the timed blank demo instead of leaking a completed learner file", () => {
    window.sessionStorage.setItem(
      "coderunners:player:typescript-habit-label",
      JSON.stringify({
        version: 1,
        state: {
          activeChallengeId: undefined,
          completedChallengeIds: ["format-habit-label"],
          forwardSeekLocked: false,
          learnerHasEdited: true,
          manifestId: "typescript-habit-label",
          playback: "paused",
          terminalOutput: "Check passed.",
          timeMs: 6_000,
        },
      }),
    );

    render(<Studio />);

    const editor = screen.getByLabelText("Learner code editor");
    expect(editor.textContent).toBe("");
    expect(editor.getAttribute("data-readonly")).toBe("true");
    expect(screen.getByText("Demo")).toBeTruthy();
  });

  it("reveals demo typing one character at a time between audio time updates", async () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        nextFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    render(<Studio />);

    const timeline = screen.getByRole("slider", { name: "Codecast timeline" });
    fireEvent.change(timeline, { target: { value: "11700" } });
    const editor = screen.getByLabelText("Learner code editor");
    expect(editor.textContent).toBe("");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play Codecast" }));
      await Promise.resolve();
    });

    const audio = document.querySelector("audio") as HTMLAudioElement;
    const renderFrameAt = (timeSeconds: number) => {
      audio.currentTime = timeSeconds;
      const frame = nextFrame;
      expect(frame).toBeDefined();
      nextFrame = undefined;
      act(() => frame?.(performance.now()));
    };

    renderFrameAt(11.80);
    expect(editor.textContent).toBe("e");
    renderFrameAt(11.88);
    expect(editor.textContent).toBe("ex");
    renderFrameAt(11.96);
    expect(editor.textContent).toBe("exp");
  });

  it("starts a fresh playback session without touching project files", () => {
    vi.useFakeTimers();
    render(<Studio />);

    const timeline = screen.getByRole("slider", { name: "Codecast timeline" }) as HTMLInputElement;
    fireEvent.change(timeline, { target: { value: "3000" } });
    expect(timeline.value).toBe("3000");

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(timeline.value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Adjust volume" }));
    expect((screen.getByRole("slider", { name: "Playback volume" }) as HTMLInputElement).value).toBe("1");
    expect((document.querySelector("audio") as HTMLAudioElement).volume).toBe(1);
    expect(screen.getByRole("treeitem", { name: "formatHabitLabel.ts" }).getAttribute("aria-current")).toBe("page");
    const status = screen.getByText("New lesson session started. Project files were left unchanged.");
    expect(status.classList.contains("is-idle")).toBe(false);
    act(() => vi.advanceTimersByTime(2_500));
    expect(status.classList.contains("is-idle")).toBe(true);
    vi.useRealTimers();
  });
});
