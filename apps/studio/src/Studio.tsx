import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { CodecastManifest } from "@coderunners/contracts";

import fixtureManifest from "../../../packages/fixtures/codecast-react/manifest.json" with { type: "json" };
import fixtureAudioUrl from "../../../packages/fixtures/codecast-react/audio/codecast.wav?url";

import {
  createInitialPlayerState,
  playerReducer,
  restorePlayerState,
  serializePlayerState,
  type PlayerAction,
  type PlayerState,
} from "./player-reducer.js";
import {
  StudioApiClient,
  StudioApiError,
  takeLaunchSession,
  type CommandApproval,
  type PtySession,
} from "./studio-api.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { MonacoEditor } from "./MonacoEditor.js";

const manifest = fixtureManifest as CodecastManifest;
const storageKey = `coderunners:player:${manifest.id}`;
const defaultSource = `type HabitRowProps = {
  completed: boolean;
  label: string;
  onToggle(nextCompleted: boolean): void;
};

export function HabitRow({ completed, label, onToggle }: HabitRowProps) {
  return (
    <button
      aria-pressed={completed}
      onClick={() => {
        // TODO: Learner-owned toggle state transition.
        void onToggle;
      }}
      type="button"
    >
      <span>{label}</span>
      <strong>{completed ? "Completed" : "Incomplete"}</strong>
    </button>
  );
}
`;

type HostStatus = {
  kind: "connected" | "demo" | "error" | "connecting";
  message: string;
};

type ActivePty = Pick<PtySession, "cursor" | "id">;

export function Studio() {
  const [player, dispatch] = useReducer(reducePlayer, undefined, restoreInitialState);
  const [api, setApi] = useState<StudioApiClient | null>(null);
  const [hostStatus, setHostStatus] = useState<HostStatus>({
    kind: "connecting",
    message: "Checking the local host…",
  });
  const [source, setSource] = useState(defaultSource);
  const [revision, setRevision] = useState<string | null>(null);
  const [fileStatus, setFileStatus] = useState("Demo projection is ready.");
  const [approval, setApproval] = useState<CommandApproval | null>(null);
  const [activePty, setActivePty] = useState<ActivePty | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    const sessionToken = takeLaunchSession(window.location.href, (...args) => {
      window.history.replaceState(...args);
    });

    if (sessionToken === undefined) {
      setHostStatus({
        kind: "demo",
        message: "Preview mode. Open CodeRunners from the local launcher to edit and run checks.",
      });
      return;
    }

    const client = new StudioApiClient(window.location.origin, sessionToken);
    setApi(client);
    void (async () => {
      await client.validateManifest(manifest);
      return client.health();
    })()
      .then((health) => {
        if (cancelled) {
          return;
        }
        setHostStatus({
          kind: "connected",
          message: health.capabilities.files
            ? "Local host connected. Learner files and reviewed checks are available."
            : "Local host connected. Select the project again to edit files and run checks.",
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHostStatus(errorStatus(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (api === null) {
      return;
    }
    let cancelled = false;
    void api
      .readFile(manifest.project.entryFile)
      .then((file) => {
        if (cancelled) {
          return;
        }
        setSource(file.content);
        setRevision(file.revision);
        setFileStatus("Live learner file loaded. Save keeps revision protection.");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFileStatus(errorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, serializePlayerState(player));
    } catch {
      // NOTE: Playback remains usable if browser storage is unavailable.
    }
  }, [player]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio !== null && player.playback === "paused") {
      audio.pause();
    }
  }, [player.playback]);

  useEffect(() => {
    if (api === null || activePty === null) {
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const output = await api.readPtyOutput(activePty.id, activePty.cursor);
        if (cancelled) {
          return;
        }
        if (output.output.length > 0) {
          dispatch({ type: "terminal.append", output: output.output });
        }
        setActivePty((current) =>
          current?.id === activePty.id
            ? { ...current, cursor: output.cursor }
            : current,
        );
        if (output.status === "exited") {
          setActivePty(null);
          if (output.exitCode === 0 && player.activeChallengeId !== undefined) {
            dispatch({ type: "proof.succeeded", challengeId: player.activeChallengeId });
            setFileStatus("Check passed. The next Codecast segment is unlocked.");
          } else {
            setFileStatus("The check did not pass yet. Your work is preserved; revise and run it again.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setActivePty(null);
          setHostStatus(errorStatus(error));
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activePty, api, player.activeChallengeId]);

  const seek = useCallback(
    (timeMs: number) => {
      const action: PlayerAction = { type: "seek.requested", timeMs };
      const nextState = playerReducer(player, action, manifest);
      dispatch(action);
      const audio = audioRef.current;
      if (audio !== null) {
        audio.currentTime = nextState.timeMs / 1_000;
      }
    },
    [player],
  );

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (player.playback === "playing") {
      audio.pause();
      dispatch({ type: "playback.paused" });
      return;
    }
    if (player.forwardSeekLocked) {
      setFileStatus("This Codecast is paused at your challenge. Prove the check to continue.");
      return;
    }
    try {
      await audio.play();
      dispatch({ type: "play.requested" });
    } catch {
      setFileStatus("Audio could not start. Use captions and seek controls while you recover playback.");
    }
  }, [player.forwardSeekLocked, player.playback]);

  const handleSourceChange = useCallback((nextSource: string | undefined) => {
    if (nextSource === undefined) {
      return;
    }
    setSource(nextSource);
    dispatch({ type: "learner.mutated" });
    setFileStatus("Playback paused for your edit. Save when the change is ready.");
  }, []);

  const saveFile = useCallback(async () => {
    if (api === null || revision === null) {
      setFileStatus("Open CodeRunners from the local launcher before saving the live project.");
      return;
    }
    try {
      const saved = await api.writeFile(manifest.project.entryFile, source, revision);
      setRevision(saved.revision);
      setFileStatus("Learner file saved.");
    } catch (error) {
      setFileStatus(errorMessage(error));
    }
  }, [api, revision, source]);

  const requestCheck = useCallback(async () => {
    if (api === null) {
      setHostStatus({
        kind: "error",
        message: "Open CodeRunners from the local launcher before running a reviewed check.",
      });
      return;
    }
    try {
      const response = await api.requestCommandApproval(
        manifest.challenges[0]?.checkCommandId ?? "check",
      );
      setApproval(response.approval);
      reviewDialogRef.current?.showModal();
    } catch (error) {
      setHostStatus(errorStatus(error));
    }
  }, [api]);

  const reviewCheck = useCallback(
    async (approved: boolean) => {
      if (api === null || approval === null) {
        return;
      }
      try {
        const response = await api.confirmCommandApproval(approval.id, approved);
        reviewDialogRef.current?.close();
        setApproval(null);
        if (!approved || response.approval.status !== "approved") {
          setFileStatus("Check cancelled. The challenge remains locked until observable proof succeeds.");
          return;
        }
        const started = await api.startPty(response.approval.id);
        setActivePty({ id: started.session.id, cursor: started.session.cursor });
        dispatch({ type: "terminal.append", output: "$ Starting approved check…" });
      } catch (error) {
        reviewDialogRef.current?.close();
        setApproval(null);
        setHostStatus(errorStatus(error));
      }
    },
    [api, approval],
  );

  const sendTerminalInput = useCallback(
    (data: string) => {
      if (api === null || activePty === null) {
        return;
      }
      void api.writePtyInput(activePty.id, data).catch((error: unknown) => {
        setHostStatus(errorStatus(error));
      });
    },
    [activePty, api],
  );

  const currentCue = manifest.cues.find(
    (cue) => player.timeMs >= cue.startMs && player.timeMs <= cue.endMs,
  ) ?? manifest.cues[0];
  const challenge = manifest.challenges.find(
    (item) => item.id === player.activeChallengeId,
  );

  return (
    <main className={previewOpen ? "studio preview-open" : "studio"}>
      <audio
        onEnded={() => dispatch({ type: "playback.paused" })}
        onTimeUpdate={(event) =>
          dispatch({ type: "clock.updated", timeMs: event.currentTarget.currentTime * 1_000 })
        }
        preload="metadata"
        ref={audioRef}
        src={fixtureAudioUrl}
      />
      <header className="studio-topbar">
        <div className="brand-lockup"><span aria-hidden="true" className="brand-mark">&lt;/&gt;</span><strong>CodeRunners</strong><span className="product-label">Studio</span></div>
        <div aria-live="polite" className={`host-status is-${hostStatus.kind}`} role="status">{hostStatus.message}</div>
        <button className="quiet-button" onClick={() => setPreviewOpen((open) => !open)} type="button">{previewOpen ? "Close preview" : "Open preview"}</button>
      </header>

      <div className="studio-grid">
        <nav aria-label="Project files" className="explorer-pane">
          <div className="pane-heading"><span>Explorer</span><span className="count">1</span></div>
          <button aria-current="page" className="file-row" type="button"><span>src</span><span>components</span><strong>HabitRow.tsx</strong></button>
          <p className="pane-note">The lesson projection can focus this file. Your editor changes are never replayed by the timeline.</p>
        </nav>

        <section aria-label="Codecast workspace" className="workspace-pane">
          <div className="workspace-toolbar"><div><p className="eyebrow">Codecast</p><h1>{manifest.title}</h1></div><button className="quiet-button" onClick={saveFile} type="button">Save</button></div>
          <div className="file-tab"><span>HabitRow.tsx</span><span className="learner-badge">Learner-owned seam</span></div>
          <div className="editor-region"><MonacoEditor onChange={handleSourceChange} value={source} /></div>
          <p aria-live="polite" className="file-status">{fileStatus}</p>

          <section aria-label="Terminal" className="terminal-pane"><div className="pane-heading"><span>Terminal</span><span className="terminal-label">real local output</span></div><TerminalPanel onInput={activePty === null ? undefined : sendTerminalInput} output={player.terminalOutput} /></section>

          <section aria-label="Codecast player" className="player-pane">
            <div className="player-controls"><button className="play-button" onClick={() => void togglePlayback()} type="button">{player.playback === "playing" ? "Pause Codecast" : "Play Codecast"}</button><span className="timecode">{formatTime(player.timeMs)} / {formatTime(manifest.audio.durationMs)}</span><button className="quiet-button" onClick={() => seek(Math.max(0, player.timeMs - 5_000))} type="button">Replay 5s</button></div>
            <label className="timeline-label" htmlFor="codecast-timeline">Timeline <span>{player.forwardSeekLocked ? "Forward seek locked until proof" : "Seek available"}</span></label>
            <input aria-describedby="timeline-help" id="codecast-timeline" max={manifest.audio.durationMs} min="0" onChange={(event) => seek(Number(event.target.value))} step="250" type="range" value={player.timeMs} />
            <p id="timeline-help" className="caption" aria-live="polite"><span>{formatTime(player.timeMs)}</span> {currentCue?.text}</p>
          </section>

          {challenge !== undefined ? <section aria-labelledby="challenge-title" className="challenge-gate"><div><p className="eyebrow">Challenge locked</p><h2 id="challenge-title">{challenge.title}</h2><p>{challenge.instruction}</p></div><div className="challenge-actions"><button className="quiet-button" onClick={() => setFileStatus(challenge.hints.find(Boolean) ?? "Inspect the state transition.")} type="button">Show next hint</button><button className="primary-button" onClick={() => void requestCheck()} type="button">Review and run check</button></div></section> : null}
        </section>

        {previewOpen ? <aside aria-labelledby="preview-title" className="preview-pane"><div className="pane-heading"><span id="preview-title">Web preview</span><button className="icon-text-button" onClick={() => setPreviewOpen(false)} type="button">Close</button></div><div className="preview-page"><p className="eyebrow">Today</p><h2>Habit tracker</h2><p>Try the live preview; it is interactive and does not pause narration.</p><button aria-pressed={previewCompleted} className={previewCompleted ? "habit is-complete" : "habit"} onClick={() => setPreviewCompleted((completed) => !completed)} type="button"><span>Morning walk</span><strong>{previewCompleted ? "Completed" : "Incomplete"}</strong></button></div></aside> : null}
      </div>

      <dialog aria-labelledby="review-title" className="command-dialog" ref={reviewDialogRef}>
        <p className="eyebrow">Command review</p><h2 id="review-title">Run the focused check?</h2>
        {approval === null ? <p>Preparing the approved command…</p> : <><p>This is the exact manifest-defined command that can prove the current challenge.</p><pre><code>{approval.command.executable} {approval.command.args.join(" ")}</code><br /><code>working directory: {approval.command.cwd}</code></pre></>}
        <div className="dialog-actions"><button onClick={() => void reviewCheck(false)} type="button">Cancel</button><button className="primary-button" onClick={() => void reviewCheck(true)} type="button">Run check</button></div>
      </dialog>
    </main>
  );
}

function reducePlayer(state: PlayerState, action: PlayerAction): PlayerState {
  return playerReducer(state, action, manifest);
}

function restoreInitialState(): PlayerState {
  try {
    return restorePlayerState(window.sessionStorage.getItem(storageKey), manifest);
  } catch {
    return createInitialPlayerState(manifest);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The local host could not complete this action.";
}

function errorStatus(error: unknown): HostStatus {
  return { kind: "error", message: errorMessage(error) };
}

function formatTime(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1_000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
