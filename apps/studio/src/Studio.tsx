import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { CodecastManifest } from "@coderunners/contracts";
import {
  createInitialPlayerState,
  playerReducer,
  restorePlayerState,
  serializePlayerState,
  type PlayerAction,
  type PlayerState,
} from "@coderunners/lesson-player";

import fixtureManifest from "../../../packages/fixtures/codecast-react/manifest.json" with { type: "json" };
import fixtureAudioUrl from "../../../packages/fixtures/codecast-react/audio/codecast.wav?url";

import {
  StudioApiClient,
  StudioApiError,
  takeLaunchSession,
  type CommandApproval,
  type PtySession,
} from "./studio-api.js";
import { TerminalPanel } from "./TerminalPanel.js";
import { MonacoEditor } from "./MonacoEditor.js";
import {
  AddIcon,
  ChevronDownIcon,
  LockIcon,
  MonitorIcon,
  ReplayIcon,
  RunIcon,
  SaveIcon,
  TerminalIcon,
  VolumeIcon,
  XIcon,
} from "./icons.js";
import { FileIcon } from "./file-icon-theme.js";
import { ProjectExplorer } from "./ProjectExplorer.js";
import {
  projectDemoSource,
  type DemoProjection,
} from "./demo-projection.js";

type SelectedLesson = {
  audioUrl: string;
  manifest: CodecastManifest;
};

declare global {
  interface Window {
    __CODERUNNERS_LESSON__?: SelectedLesson;
  }
}

const selectedLesson = window.__CODERUNNERS_LESSON__;
const manifest = selectedLesson?.manifest ?? fixtureManifest as CodecastManifest;
const audioUrl = selectedLesson?.audioUrl ?? fixtureAudioUrl;
const storageKey = `coderunners:player:${manifest.id}`;
const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const;
const continuingStatus = "Check passed. Continuing the lesson…";
const newSessionStatus = "New lesson session started. Project files were left unchanged.";
const demoStopAtMs = manifest.events.find(
  (event) => event.type === "challenge.start",
)?.atMs;
const defaultSource = `export function formatHabitLabel(name: string): string {
  // TODO: Return a label containing the supplied habit name.
  void name;
  return "";
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
  const [activePath, setActivePath] = useState(manifest.project.entryFile);
  const [revision, setRevision] = useState<string | null>(null);
  const [fileStatus, setFileStatus] = useState("Demo projection is ready.");
  const [approval, setApproval] = useState<CommandApproval | null>(null);
  const [activePty, setActivePty] = useState<ActivePty | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewName, setPreviewName] = useState("Read");
  const [lessonMenuOpen, setLessonMenuOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [volume, setVolume] = useState<number>(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const demoProjectionEnabled =
    activePath === manifest.project.entryFile && demoStopAtMs !== undefined;
  const [demoProjection, setDemoProjection] = useState<DemoProjection | undefined>(
    () => getDemoProjection(activePath, player.timeMs),
  );
  const demoProjectionRef = useRef(demoProjection);
  const updateDemoProjection = useCallback((timeMs: number) => {
    const nextProjection = getDemoProjection(activePath, timeMs);
    if (sameDemoProjection(demoProjectionRef.current, nextProjection)) {
      return;
    }
    demoProjectionRef.current = nextProjection;
    setDemoProjection(nextProjection);
  }, [activePath]);

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
      .readFile(activePath)
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
  }, [activePath, api]);

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
    if (
      audio !== null &&
      player.forwardSeekLocked &&
      Math.abs(audio.currentTime * 1_000 - player.timeMs) > 20
    ) {
      audio.currentTime = player.timeMs / 1_000;
    }
  }, [player.forwardSeekLocked, player.playback, player.timeMs]);

  useEffect(() => {
    if (audioRef.current !== null) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current !== null) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (player.playback === "playing" && demoProjectionEnabled) {
      return;
    }
    updateDemoProjection(player.timeMs);
  }, [demoProjectionEnabled, player.playback, player.timeMs, updateDemoProjection]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null || !demoProjectionEnabled || player.playback !== "playing") {
      return;
    }

    let animationFrame = 0;
    const renderTypingFrame = () => {
      updateDemoProjection(audio.currentTime * 1_000);
      animationFrame = window.requestAnimationFrame(renderTypingFrame);
    };
    animationFrame = window.requestAnimationFrame(renderTypingFrame);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [demoProjectionEnabled, player.playback, updateDemoProjection]);

  useEffect(() => {
    if (fileStatus !== continuingStatus && fileStatus !== newSessionStatus) {
      return;
    }
    const timeout = window.setTimeout(
      () => setFileStatus(
        api === null
          ? "Demo projection is ready."
          : "Live learner file loaded. Save keeps revision protection.",
      ),
      2_500,
    );
    return () => window.clearTimeout(timeout);
  }, [api, fileStatus]);

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
            setTerminalOpen(false);
            setFileStatus(continuingStatus);
            void audioRef.current?.play().then(() => dispatch({ type: "play.requested" }));
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
      const saved = await api.writeFile(activePath, source, revision);
      setRevision(saved.revision);
      setFileStatus("Learner file saved.");
    } catch (error) {
      setFileStatus(errorMessage(error));
    }
  }, [activePath, api, revision, source]);

  const openFile = useCallback((path: string) => {
    setActivePath(path);
    setRevision(null);
    setFileStatus(`Opening ${fileName(path)}…`);
  }, []);

  const startNewSession = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      audio.currentTime = 0;
      audio.playbackRate = 1;
      audio.volume = 1;
    }
    setPlaybackRate(1);
    setVolume(1);
    dispatch({ type: "session.reset" });
    setActivePath(manifest.project.entryFile);
    setRevision(null);
    setTerminalOpen(false);
    setPreviewOpen(false);
    setLessonMenuOpen(false);
    setFileStatus(newSessionStatus);
  }, []);

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
        setTerminalOpen(true);
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

  const timedCue = manifest.cues.find(
    (cue) => player.timeMs >= cue.startMs && player.timeMs <= cue.endMs,
  ) ?? manifest.cues[0];
  const challenge = manifest.challenges.find(
    (item) => item.id === player.activeChallengeId,
  );
  const playerProgress = Math.min(
    100,
    Math.max(0, (player.timeMs / manifest.audio.durationMs) * 100),
  );
  const fileStatusIsIdle =
    fileStatus === "Demo projection is ready." ||
    fileStatus === "Live learner file loaded. Save keeps revision protection.";
  const timelineMarkers = manifest.events.filter(
    (event) => event.type === "challenge.start",
  );
  const focusEvent = [...manifest.events].reverse().find(
    (event) => event.type === "editor.focusRange" && event.path === activePath && event.atMs <= player.timeMs,
  );
  const focusRange = focusEvent?.type === "editor.focusRange" ? focusEvent.range : undefined;
  const lessonState = challenge !== undefined
    ? "Try it out"
    : player.completedChallengeIds.length === manifest.challenges.length
      ? player.timeMs >= manifest.audio.durationMs - 250 ? "Complete" : "Continuing"
      : player.timeMs > 0
        ? "Learning"
        : "Ready";
  const currentCue = timedCue;
  const currentCaption = currentCue === undefined
    ? undefined
    : captionForTime(currentCue.text, currentCue.startMs, currentCue.endMs, player.timeMs);

  return (
    <main className={previewOpen ? "studio preview-open" : "studio"}>
      <audio
        onEnded={() => dispatch({ type: "playback.paused" })}
        onTimeUpdate={(event) =>
          dispatch({ type: "clock.updated", timeMs: event.currentTarget.currentTime * 1_000 })
        }
        preload="metadata"
        ref={audioRef}
        src={audioUrl}
      />
      <nav aria-label="Lesson navigation" className="lesson-bar">
        <div className="lesson-switcher-wrap">
          <button
            aria-expanded={lessonMenuOpen}
            aria-label={manifest.title}
            className="lesson-switcher"
            onClick={() => setLessonMenuOpen((open) => !open)}
            type="button"
          >
            <span className="lesson-kicker">Lesson</span>
            <strong>{manifest.title}</strong>
            <ChevronDownIcon />
          </button>
          {lessonMenuOpen ? (
            <div aria-label="Lesson sessions" className="lesson-menu" role="menu">
              <button aria-current="page" onClick={() => setLessonMenuOpen(false)} role="menuitem" type="button">
                <span>Current session</span>
                <small>{manifest.project.name}</small>
              </button>
            </div>
          ) : null}
        </div>
        <div aria-label={hostStatus.message} className="lesson-status" role="status" title={hostStatus.message}>
          <span className={`host-dot is-${hostStatus.kind}`} />
          <span>{lessonState}</span>
        </div>
        <div className="lesson-actions">
          <button
            aria-label={previewOpen ? "Close preview" : "Open preview"}
            className="topbar-button"
            onClick={() => setPreviewOpen((open) => !open)}
            type="button"
          >
            <MonitorIcon />
            <span>Preview</span>
          </button>
          <button aria-label="New session" className="topbar-button" onClick={startNewSession} type="button">
            <AddIcon />
            <span>New session</span>
          </button>
        </div>
      </nav>
      <div className="studio-grid">
        <ProjectExplorer
          activePath={activePath}
          api={api}
          onError={setFileStatus}
          onOpenFile={openFile}
          projectName={manifest.project.name}
        />

        <section aria-label="Codecast workspace" className="workspace-pane">
          <header className="file-tab">
            <div className="file-identity">
              <FileIcon name={fileName(demoProjection?.path ?? activePath)} />
              <span>{fileName(demoProjection?.path ?? activePath)}</span>
              {demoProjection === undefined ? null : <span className="projection-badge">Demo</span>}
            </div>
            <div className="file-actions">
              <button aria-label="Run project check" className="file-run-button" disabled={demoProjection !== undefined} onClick={() => void requestCheck()} type="button"><RunIcon /><span>Run</span></button>
              <button aria-label="Save current file" className="file-action" data-tooltip="Save" disabled={demoProjection !== undefined} onClick={() => void saveFile()} type="button"><SaveIcon /></button>
              <button aria-label={terminalOpen ? "Close terminal" : "Open terminal"} className="file-action" data-tooltip="Terminal" onClick={() => setTerminalOpen((open) => !open)} type="button"><TerminalIcon /></button>
            </div>
          </header>
          <div className="editor-region"><MonacoEditor focusRange={focusRange} onChange={handleSourceChange} path={demoProjection?.path ?? activePath} readOnly={demoProjection !== undefined} showTypingCaret={demoProjection?.typing === true} value={demoProjection?.source ?? source} /></div>
          <p aria-live="polite" className={`file-status${fileStatusIsIdle ? " is-idle" : ""}`}>{fileStatus}</p>

          <section aria-label="Terminal" className="terminal-pane" hidden={!terminalOpen}>
            <div className="pane-heading">
              <span>Terminal</span>
              <button aria-label="Close terminal" className="panel-close" onClick={() => setTerminalOpen(false)} title="Close terminal" type="button"><XIcon /></button>
            </div>
            <TerminalPanel onInput={activePty === null ? undefined : sendTerminalInput} output={player.terminalOutput} />
          </section>

          <section aria-label="Codecast player" className="player-pane">
            <button
              aria-label={player.playback === "playing" ? "Pause Codecast" : "Play Codecast"}
              className="play-button"
              disabled={player.forwardSeekLocked}
              onClick={() => void togglePlayback()}
              title={player.playback === "playing" ? "Pause Codecast" : "Play Codecast"}
              type="button"
            >
              <span aria-hidden="true" className={player.playback === "playing" ? "pause-glyph" : "play-glyph"} />
            </button>
            <button
              aria-label="Replay 5 seconds"
              className="player-icon-button"
              onClick={() => seek(Math.max(0, player.timeMs - 5_000))}
              title="Replay 5 seconds"
              type="button"
            >
              <ReplayIcon />
            </button>
            <div className="timeline-control">
              <label className="visually-hidden" htmlFor="codecast-timeline">Codecast timeline</label>
              <input
                aria-describedby="timeline-help timeline-state"
                id="codecast-timeline"
                max={manifest.audio.durationMs}
                min="0"
                onChange={(event) => seek(Number(event.target.value))}
                step="1"
                style={{ "--player-progress": `${playerProgress}%` } as CSSProperties}
                type="range"
                value={player.timeMs}
              />
              <div aria-hidden="true" className="timeline-markers">
                {timelineMarkers.map((event) => (
                  <span
                    className="timeline-marker is-challenge"
                    key={event.id}
                    style={{ left: `${(event.atMs / manifest.audio.durationMs) * 100}%` }}
                  />
                ))}
              </div>
            </div>
            <div className={`volume-control${volumeOpen ? " is-open" : ""}`}>
              <button
                aria-expanded={volumeOpen}
                aria-label="Adjust volume"
                className="volume-trigger"
                disabled={player.forwardSeekLocked}
                onClick={() => setVolumeOpen((open) => !open)}
                title={`${Math.round(volume * 100)}% volume`}
                type="button"
              >
                <VolumeIcon />
              </button>
              {volumeOpen ? <div className="volume-popover">
                <label className="visually-hidden" htmlFor="playback-volume">Playback volume</label>
                <input
                  aria-label="Playback volume"
                  id="playback-volume"
                  max="1"
                  min="0"
                  onChange={(event) => setVolume(Number(event.target.value))}
                  step="0.05"
                  style={{ "--volume-progress": `${volume * 100}%` } as CSSProperties}
                  type="range"
                  value={volume}
                />
              </div> : null}
            </div>
            <button
              aria-label={captionsVisible ? "Hide captions" : "Show captions"}
              aria-pressed={captionsVisible}
              className="captions-button"
              onClick={() => setCaptionsVisible((visible) => !visible)}
              title={captionsVisible ? "Hide captions" : "Show captions"}
              type="button"
            >
              CC
            </button>
            <label className="visually-hidden" htmlFor="playback-speed">Playback speed</label>
            <select
              aria-label="Playback speed"
              className="speed-select"
              disabled={player.forwardSeekLocked}
              id="playback-speed"
              onChange={(event) => setPlaybackRate(Number(event.target.value))}
              value={playbackRate}
            >
              {playbackRates.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
            </select>
            <span className="timecode">{formatTime(player.timeMs)} / {formatTime(manifest.audio.durationMs)}</span>
            <span className="visually-hidden" id="timeline-state">
              {player.forwardSeekLocked ? "Forward seek locked until proof" : "Seek available"}
            </span>
            {captionsVisible ? <p id="timeline-help" className="caption" aria-live="polite">{currentCaption}</p> : null}
          </section>

          {challenge !== undefined ? <section aria-labelledby="challenge-title" className="challenge-gate"><div className="challenge-copy"><span className="challenge-icon"><LockIcon /></span><div><p className="eyebrow">Checkpoint</p><h2 id="challenge-title">{challenge.title}</h2><p>{challenge.instruction}</p></div></div><div className="challenge-actions"><button className="quiet-button" onClick={() => setFileStatus(challenge.hints.find(Boolean) ?? "Inspect the typed return value.")} type="button">Show hint</button><button className="primary-button" onClick={() => void requestCheck()} type="button">Run check</button></div></section> : null}
        </section>

        {previewOpen ? <aside aria-labelledby="preview-title" className="preview-pane"><div className="pane-heading"><span id="preview-title">Web preview</span><button aria-label="Close preview" className="panel-close" onClick={() => setPreviewOpen(false)} title="Close preview" type="button"><XIcon /></button></div><div className="preview-page"><p className="eyebrow">TypeScript basics</p><h2>Habit label</h2><p>Try a name while you work on the formatter.</p><label htmlFor="preview-habit-name">Habit name</label><input id="preview-habit-name" onChange={(event) => setPreviewName(event.target.value)} value={previewName} /><output>Habit: {previewName}</output></div></aside> : null}
      </div>

      <dialog aria-labelledby="review-title" className="command-dialog" ref={reviewDialogRef}>
        <div className="command-dialog-heading"><span className="command-dialog-icon"><TerminalIcon /></span><div><p className="eyebrow">Command review</p><h2 id="review-title">Run the focused check?</h2></div></div>
        {approval === null ? <p>Preparing the approved command…</p> : <><p>Review the project command before it runs in the local workspace.</p><div className="command-summary"><code><span aria-hidden="true">$</span> {approval.command.executable} {approval.command.args.join(" ")}</code><div><span>Working directory</span><code>{approval.command.cwd}</code></div></div></>}
        <div className="dialog-actions"><button className="quiet-button" onClick={() => void reviewCheck(false)} type="button">Cancel</button><button className="primary-button" onClick={() => void reviewCheck(true)} type="button">Run check</button></div>
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

function captionForTime(text: string, startMs: number, endMs: number, timeMs: number): string {
  const sentences = text.match(/.+?(?:[.!?]+(?=\s|$)|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [text];
  if (sentences.length === 1) {
    return sentences[0]!;
  }
  const weights = sentences.map((sentence) => sentence.split(/\s+/).length);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const progress = Math.max(0, Math.min(1, (timeMs - startMs) / (endMs - startMs)));
  let threshold = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    threshold += weights[index]! / totalWeight;
    if (progress <= threshold) {
      return sentences[index]!;
    }
  }
  return sentences.at(-1)!;
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function getDemoProjection(
  activePath: string,
  timeMs: number,
): DemoProjection | undefined {
  if (activePath !== manifest.project.entryFile || demoStopAtMs === undefined) {
    return undefined;
  }
  return projectDemoSource(manifest.events, timeMs, demoStopAtMs);
}

function sameDemoProjection(
  left: DemoProjection | undefined,
  right: DemoProjection | undefined,
): boolean {
  return left === right || (
    left !== undefined &&
    right !== undefined &&
    left.path === right.path &&
    left.source === right.source &&
    left.typing === right.typing
  );
}
