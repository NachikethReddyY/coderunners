import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import type {
  BranchSummary,
  CodecastModelSelection,
  CodecastRecord,
  CreateCodecastRequest,
  ModelConfiguration,
  ModelOption,
  ModelRole,
  ProjectRecord,
  ReasoningLevel,
  WorkspaceSelection,
} from "@coderunners/contracts";

import { Studio, type PlaybackCheckpoint, type SelectedLesson } from "./Studio.js";
import {
  StudioApiClient,
  StudioApiError,
  takeLaunchSession,
} from "./studio-api.js";

type Route =
  | { kind: "home" }
  | { kind: "project"; projectId: string }
  | { kind: "player"; projectId: string; codecastId: string }
  | { kind: "settings" }
  | { kind: "not-found" };

export type CodeRunnersApi = Pick<
  StudioApiClient,
  | "listProjects"
  | "listBranches"
  | "listCodecasts"
  | "createCodecast"
  | "getReplay"
  | "readReplayAudio"
  | "updateCheckpoint"
  | "deleteCodecast"
  | "getModels"
  | "updateModels"
  | "health"
>;

type CodeRunnersAppProps = {
  api?: CodeRunnersApi;
  initialPath?: string;
};

const roleLabels: Record<ModelRole, string> = {
  authoring: "Author",
  tts: "TTS",
  stt: "STT",
};

const defaultReasoning: ReasoningLevel = "high";

export function CodeRunnersApp({ api, initialPath }: CodeRunnersAppProps) {
  const [route, setRoute] = useState<Route>(() => {
    const path = initialPath ?? window.location.pathname;
    if (initialPath !== undefined && window.location.pathname !== initialPath) {
      window.history.replaceState(null, "", initialPath);
    }
    return parseRoute(path);
  });
  const runtimeApi = useMemo(() => api ?? createRuntimeApi(), [api]);
  const [modelConfigurationOverride, setModelConfigurationOverride] = useState<ModelConfiguration | null>(null);

  const navigate = useCallback((path: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
    setRoute(parseRoute(path));
  }, []);

  useEffect(() => {
    const handleHistory = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", handleHistory);
    return () => window.removeEventListener("popstate", handleHistory);
  }, []);

  if (route.kind === "not-found") {
    return (
      <AppShell onNavigate={navigate}>
        <section className="library-state" aria-labelledby="not-found-title">
          <p className="eyebrow">404</p>
          <h1 id="not-found-title">That CodeRunners page is unavailable.</h1>
          <p>Return home to choose a project or resume a Codecast.</p>
          <button className="primary-button" onClick={() => navigate("/")} type="button">
            Go to Home
          </button>
        </section>
      </AppShell>
    );
  }

  if (route.kind === "player") {
    return (
      <CodecastPlayerRoute
        api={runtimeApi}
        codecastId={route.codecastId}
        onReturn={() => navigate(`/projects/${encodeURIComponent(route.projectId)}`)}
        projectId={route.projectId}
      />
    );
  }

  return (
    <AppShell onNavigate={navigate}>
      {route.kind === "home" ? (
        <HomePage api={runtimeApi} modelConfigurationOverride={modelConfigurationOverride} onNavigate={navigate} />
      ) : route.kind === "project" ? (
        <ProjectCollection
          api={runtimeApi}
          onNavigate={navigate}
          projectId={route.projectId}
        />
      ) : (
        <SettingsPage api={runtimeApi} onModelConfigurationSaved={setModelConfigurationOverride} onNavigate={navigate} />
      )}
    </AppShell>
  );
}

function CodecastPlayerRoute({
  api,
  codecastId,
  onReturn,
  projectId,
}: {
  api: CodeRunnersApi;
  codecastId: string;
  onReturn: () => void;
  projectId: string;
}) {
  const [lesson, setLesson] = useState<SelectedLesson | null>(null);
  const [checkpoint, setCheckpoint] = useState<PlaybackCheckpoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    void Promise.all([api.getReplay(codecastId), api.readReplayAudio(codecastId)])
      .then(([{ replay }, audio]) => {
        if (
          cancelled ||
          replay.projectId !== projectId ||
          replay.manifest === null ||
          replay.audioUrl === null
        ) {
          if (!cancelled) {
            setError("Replay is not available for this project.");
          }
          return;
        }
        objectUrl = typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(audio)
          : replay.audioUrl;
        setLesson({ audioUrl: objectUrl, manifest: replay.manifest });
        setCheckpoint({
          positionMs: replay.resumeAtMs,
          completedChallengeIds: replay.completedChallengeIds,
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorMessage(reason, "This Codecast could not be opened."));
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl !== undefined && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [api, codecastId, projectId]);

  if (error !== null) {
    return <StateMessage action="Back to project" message={error} onAction={onReturn} title="Codecast unavailable" />;
  }
  if (lesson === null || checkpoint === null) {
    return <section className="library-state" aria-live="polite"><p className="eyebrow">Codecast player</p><h1>Loading replay…</h1><p>Validating the saved lesson and audio.</p></section>;
  }
  return (
    <Studio
      initialCheckpoint={checkpoint}
      key={codecastId}
      lesson={lesson}
      onCheckpoint={(nextCheckpoint) => {
        void api.updateCheckpoint(codecastId, nextCheckpoint).catch(() => undefined);
      }}
      onReturn={onReturn}
    />
  );
}

function AppShell({ children, onNavigate }: { children: ReactNode; onNavigate: (path: string) => void }) {
  return (
    <main className="library-app">
      <header className="library-header">
        <button className="brand-button" onClick={() => onNavigate("/")} type="button">
          CodeRunners
        </button>
        <nav aria-label="Application navigation">
          <a href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}>Home</a>
          <a href="/settings" onClick={(event) => { event.preventDefault(); onNavigate("/settings"); }}>Settings</a>
        </nav>
      </header>
      <div className="library-content">{children}</div>
    </main>
  );
}

function HomePage({ api, modelConfigurationOverride, onNavigate }: { api: CodeRunnersApi; modelConfigurationOverride: ModelConfiguration | null; onNavigate: (path: string) => void }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [models, setModels] = useState<ModelConfiguration | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceSelection["mode"]>("local-checkout");
  const [branch, setBranch] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("feature/codecast");
  const [startPoint, setStartPoint] = useState("main");
  const [selection, setSelection] = useState<CodecastModelSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([api.listProjects(), api.getModels()])
      .then(([projectResponse, modelResponse]) => {
        if (cancelled) return;
        setProjects(projectResponse.projects);
        setSelectedProjectId((current) => current ?? projectResponse.projects[0]?.id ?? null);
        const configuration = modelConfigurationOverride ?? modelResponse.configuration;
        setModels(configuration);
        const authoring = configuration.models.find((model) => model.id === configuration.defaults.authoring);
        setSelection({
          authoring: configuration.defaults.authoring,
          authoringReasoning: preferredReasoning(authoring),
          stt: configuration.defaults.stt,
          tts: configuration.defaults.tts,
        });
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, "Projects and models could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, modelConfigurationOverride]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  useEffect(() => {
    if (selectedProject === undefined) {
      setBranches([]);
      setBranch(null);
      return;
    }
    let cancelled = false;
    void api.listBranches(selectedProject.id)
      .then((response) => {
        if (cancelled) return;
        setBranches(response.branches);
        const current = response.branches.find((item) => item.current);
        setBranch(current?.name ?? null);
        setStartPoint(current?.name ?? response.branches[0]?.name ?? "main");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setSubmitError(errorMessage(reason, "Branches could not be loaded."));
      });
    return () => { cancelled = true; };
  }, [api, selectedProject]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedProject === undefined || selection === null || goal.trim().length === 0) {
      setSubmitError("Choose a project and describe what you want to learn.");
      return;
    }
    const workspace: WorkspaceSelection = workspaceMode === "local-checkout"
      ? { mode: "local-checkout", branch }
      : { mode: "new-worktree", branch: newBranch.trim(), createBranch: true, startPoint };
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.createCodecast(selectedProject.id, {
        title: goal.trim().slice(0, 160),
        outcome: goal.trim(),
        workspace,
        models: selection,
      });
      onNavigate(`/projects/${encodeURIComponent(selectedProject.id)}`);
    } catch (reason: unknown) {
      setSubmitError(errorMessage(reason, "The Codecast could not be started."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="home-page" aria-labelledby="home-title">
      <div className="page-intro">
        <h1 id="home-title">
          What should we build in <span className="project-question"><ProjectPicker projects={projects} selectedProject={selectedProject} onSelect={setSelectedProjectId} />?</span>
        </h1>
      </div>
      {loading ? <p className="inline-status" role="status">Loading projects and models…</p> : null}
      {error ? <StateMessage title="Home is unavailable" message={error} action="Retry" onAction={() => window.location.reload()} /> : null}
      {!loading && error === null ? (
        <form className="composer-form" onSubmit={submit}>
          <div className="prompt-surface">
            <textarea
              aria-label="Learning goal"
              className="prompt-input"
              id="learning-goal"
              onChange={(event) => {
                event.currentTarget.style.height = "0px";
                event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
                setGoal(event.target.value);
              }}
              placeholder="Ask for changes, send follow-ups, or attach images"
              rows={1}
              value={goal}
            />
            <div className="composer-controls" aria-label="Codecast model controls">
              <ModelMenu
                models={models?.models.filter((model) => model.role === "authoring") ?? []}
                role="authoring"
                value={selection?.authoring ?? ""}
                onChange={(value) => {
                  const model = models?.models.find((candidate) => candidate.id === value);
                  setSelection((current) => current === null ? current : ({
                    ...current,
                    authoring: value,
                    authoringReasoning: preferredReasoning(model, current.authoringReasoning),
                  }));
                }}
              />
              <ModelMenu
                models={models?.models.filter((model) => model.role === "tts") ?? []}
                role="tts"
                value={selection?.tts ?? ""}
                onChange={(value) => setSelection((current) => current === null ? current : ({ ...current, tts: value }))}
              />
              <ModelMenu
                models={models?.models.filter((model) => model.role === "stt") ?? []}
                role="stt"
                value={selection?.stt ?? ""}
                onChange={(value) => setSelection((current) => current === null ? current : ({ ...current, stt: value }))}
              />
              <button className="primary-button generate-button" disabled={submitting || selectedProject === undefined} type="submit">
                <span className="visually-hidden">{submitting ? "Starting Codecast" : "Generate Codecast"}</span>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 12 6-6 6 6M12 6v13" /></svg>
              </button>
            </div>
          </div>
          <WorkspaceBar
            branch={branch}
            branches={branches}
            mode={workspaceMode}
            newBranch={newBranch}
            onBranchChange={setBranch}
            onModeChange={setWorkspaceMode}
            onNewBranchChange={setNewBranch}
            onStartPointChange={setStartPoint}
            startPoint={startPoint}
          />
          {projects.length === 0 ? <p className="empty-note">No approved projects are registered yet.</p> : null}
          {submitError ? <p className="error-note" role="alert">{submitError}</p> : null}
        </form>
      ) : null}
    </section>
  );
}

function ProjectPicker({ projects, selectedProject, onSelect }: { projects: ProjectRecord[]; selectedProject: ProjectRecord | undefined; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filtered = projects.filter((project) => project.displayName.toLowerCase().includes(query.toLowerCase()));

  const close = (restoreFocus = true) => {
    if (restoreFocus) triggerRef.current?.focus();
    setOpen(false);
    setQuery("");
  };

  const select = (projectId: string) => {
    onSelect(projectId);
    close();
  };

  const moveOptionFocus = (index: number, key: string) => {
    if (filtered.length === 0) return;
    const nextIndex = key === "Home"
      ? 0
      : key === "End"
        ? filtered.length - 1
        : key === "ArrowDown"
          ? (index + 1) % filtered.length
          : (index - 1 + filtered.length) % filtered.length;
    optionRefs.current[nextIndex]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <span className="project-picker">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={selectedProject === undefined ? "Choose project" : `Choose project: ${selectedProject.displayName}`}
        className="project-trigger"
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedProject?.displayName ?? "a project"}</span>
      </button>
      {open ? (
        <div className="project-menu">
          <label className="visually-hidden" htmlFor="project-search">Search projects</label>
          <input
            aria-label="Search projects"
            autoFocus
            className="search-input"
            id="project-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); firstOptionRef.current?.focus(); }
              if (event.key === "Escape") { event.preventDefault(); close(); }
              if (event.key === "Enter" && filtered[0] !== undefined) { event.preventDefault(); select(filtered[0].id); }
            }}
            placeholder="Search approved projects"
            type="search"
            value={query}
          />
          <div aria-label="Project results" className="project-options" role="listbox">
            {filtered.length === 0 ? <p className="menu-empty">No matching projects.</p> : filtered.map((project, index) => (
              <button
                aria-selected={project.id === selectedProject?.id}
                className="project-option option-button"
                data-project-option="true"
                key={project.id}
                onClick={() => select(project.id)}
                onKeyDown={(event) => {
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    moveOptionFocus(index, event.key);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(project.id);
                  }
                }}
                ref={(node) => {
                  optionRefs.current[index] = node;
                  if (index === 0) firstOptionRef.current = node;
                }}
                role="option"
                type="button"
              >
                <strong>{project.displayName}</strong><small>{project.repository.kind === "git" ? project.repository.currentBranch : "Local folder"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function ModelMenu({ models, role, value, onChange }: { models: ModelOption[]; role: ModelRole; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => model.id === value);
  const label = roleLabels[role];
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);
  return (
    <div className="model-menu">
      <button aria-expanded={open} aria-haspopup="listbox" aria-label={`Choose ${role} model: ${selected?.displayName ?? "Unavailable"}`} className="model-trigger" onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => firstOptionRef.current?.focus()); } }} ref={triggerRef} type="button">
        {role === "authoring" ? <OpenAILogo /> : <ModelIcon role={role} />}
        <span className="model-value">{selected?.displayName ?? "Unavailable"}</span><span aria-hidden="true">⌄</span>
      </button>
      {open ? <div aria-label={`${label} models`} className="model-options" role="listbox">
        {models.map((model, index) => {
          const unavailable = model.availability !== "ready" || !model.enabled;
          return <button aria-selected={model.id === value} className="model-option" disabled={unavailable} key={model.id} onClick={() => { onChange(model.id); setOpen(false); triggerRef.current?.focus(); }} ref={index === 0 ? firstOptionRef : undefined} role="option" type="button">
            <span><strong>{model.displayName}</strong><small>{model.availability === "ready" ? `${model.providerId} · Ready` : availabilityLabel(model.availability)}</small></span>
            {model.id === value ? <span aria-hidden="true">✓</span> : null}
          </button>;
        })}
      </div> : null}
    </div>
  );
}

function OpenAILogo() {
  return <svg aria-hidden="true" className="openai-logo" viewBox="0 0 24 24"><path d="M17.1 8.2a5.2 5.2 0 0 0-9.8 1.2A5.2 5.2 0 0 0 6 19.1a5.2 5.2 0 0 0 8.9 1.2 5.2 5.2 0 0 0 6.3-5.4 5.2 5.2 0 0 0-4.1-6.7Z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m8.2 9.4 5.3-3.1M6.4 15.7l.1-6.2m5.1 9.2-5.2-3m7.7-.4 5.3-3m-5.4 9.1v-6.1m5.2-3-5.3-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></svg>;
}

function ModelIcon({ role }: { role: Exclude<ModelRole, "authoring"> }) {
  return role === "tts"
    ? <svg aria-hidden="true" className="model-glyph" viewBox="0 0 24 24"><path d="M5 9v6h4l5 4V5L9 9H5Z" /><path d="M18 9c1.2 1.7 1.2 4.3 0 6" /></svg>
    : <svg aria-hidden="true" className="model-glyph" viewBox="0 0 24 24"><path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4" /></svg>;
}

function WorkspaceBar({ branch, branches, mode, newBranch, startPoint, onBranchChange, onModeChange, onNewBranchChange, onStartPointChange }: { branch: string | null; branches: BranchSummary[]; mode: WorkspaceSelection["mode"]; newBranch: string; startPoint: string; onBranchChange: (value: string | null) => void; onModeChange: (value: WorkspaceSelection["mode"]) => void; onNewBranchChange: (value: string) => void; onStartPointChange: (value: string) => void }) {
  return (
    <div className="workspace-bar">
      <label className="workspace-control"><WorkspaceIcon /><span className="visually-hidden">Workspace</span><select aria-label="Workspace" onChange={(event) => onModeChange(event.target.value as WorkspaceSelection["mode"])} value={mode}><option value="local-checkout">Current checkout</option><option value="new-worktree">New worktree</option></select></label>
      <div className="branch-control">
        <label className="branch-selection"><BranchIcon /><span className="visually-hidden">Branch</span>{mode === "local-checkout" ? <span className="compact-select"><select aria-label="Branch" onChange={(event) => onBranchChange(event.target.value || null)} value={branch ?? ""}><option value="">No branch</option>{branches.map((item) => <option key={item.name} value={item.name}>{item.name}{item.current ? " · current" : ""}</option>)}</select><SelectChevron /></span> : <input aria-label="New worktree branch" onChange={(event) => onNewBranchChange(event.target.value)} value={newBranch} />}</label>
        {mode === "new-worktree" ? <label><span>From</span><select aria-label="Worktree start branch" onChange={(event) => onStartPointChange(event.target.value)} value={startPoint}>{branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label> : null}
      </div>
    </div>
  );
}

function WorkspaceIcon() {
  return <svg aria-hidden="true" className="workspace-icon" viewBox="0 0 24 24"><path d="M3 6.5h6l2 2h10v10H3v-12Z" /></svg>;
}

function BranchIcon() {
  return <svg aria-hidden="true" className="workspace-icon" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 12h4a6 6 0 0 0 6-3" /></svg>;
}

function SelectChevron() {
  return <svg aria-hidden="true" className="select-chevron" viewBox="0 0 12 12"><path d="m3.5 4.75 2.5 2.5 2.5-2.5" /></svg>;
}

function ProjectCollection({ api, projectId, onNavigate }: { api: CodeRunnersApi; projectId: string; onNavigate: (path: string) => void }) {
  const [project, setProject] = useState<ProjectRecord | undefined>();
  const [codecasts, setCodecasts] = useState<CodecastRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CodecastRecord | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const collectionTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (pendingDelete !== null) {
      confirmationRef.current?.focus();
    }
  }, [pendingDelete]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [projectsResponse, codecastResponse] = await Promise.all([
        api.listProjects(),
        api.listCodecasts(projectId),
      ]);
      const found = projectsResponse.projects.find((candidate) => candidate.id === projectId);
      setProject(found);
      setCodecasts(codecastResponse.codecasts);
      setError(found === undefined ? "This project is no longer registered." : null);
      setActionError(null);
    } catch (reason: unknown) {
      setError(errorMessage(reason, "The Codecast collection could not be loaded."));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!codecasts.some((codecast) => codecast.status === "generating")) return;
    const timer = window.setInterval(() => { void load(false); }, 1_000);
    return () => window.clearInterval(timer);
  }, [codecasts, load]);

  const openCodecast = async (codecast: CodecastRecord) => {
    setBusyId(codecast.id);
    setActionError(null);
    try {
      const { replay } = await api.getReplay(codecast.id);
      if (replay.manifestUrl === null) {
        setActionError("Replay is not available yet. This Codecast has no finalized player bundle.");
        return;
      }
      onNavigate(`/projects/${encodeURIComponent(projectId)}/codecasts/${encodeURIComponent(codecast.id)}`);
    } catch (reason: unknown) {
      setActionError(errorMessage(reason, "This Codecast could not be opened."));
    } finally {
      setBusyId(null);
    }
  };

  const handlePrimaryAction = (codecast: CodecastRecord) => {
    const action = replayAction(codecast.status);
    if (action === "retry") {
      void retryCodecast(codecast);
      return;
    }
    if (action === "restart job") {
      void retryCodecast(codecast);
      return;
    }
    if (action === "view progress") {
      void load(false);
      return;
    }
    void openCodecast(codecast);
  };

  const retryCodecast = async (codecast: CodecastRecord) => {
    setBusyId(codecast.id);
    setActionError(null);
    try {
      const result = await api.createCodecast(projectId, {
        title: codecast.title,
        outcome: codecast.outcome,
        models: codecast.models,
        workspace: codecast.workspace.mode === "local-checkout"
          ? { mode: "local-checkout", branch: codecast.workspace.branch }
          : { mode: "new-worktree", branch: codecast.workspace.branch ?? "feature/retry", createBranch: false },
      });
      setCodecasts((current) => [result.codecast, ...current]);
    } catch (reason: unknown) {
      setActionError(errorMessage(reason, "Retry could not be started."));
    } finally {
      setBusyId(null);
    }
  };

  const deleteCodecast = async () => {
    if (pendingDelete === null || confirmation !== pendingDelete.id) return;
    setBusyId(pendingDelete.id);
    setActionError(null);
    try {
      await api.deleteCodecast(pendingDelete.id, confirmation);
      setCodecasts((current) => current.filter((codecast) => codecast.id !== pendingDelete.id));
      setPendingDelete(null);
      setConfirmation("");
      queueMicrotask(() => collectionTitleRef.current?.focus());
    } catch (reason: unknown) {
      setActionError(errorMessage(reason, "The Codecast could not be deleted."));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <section className="library-state" aria-live="polite"><p className="eyebrow">Project collection</p><h1>Loading Codecasts…</h1><p>Reading the selected project’s local history.</p></section>;
  if (error !== null || project === undefined) return <StateMessage title="Project unavailable" message={error ?? "Choose another registered project."} action="Back to Home" onAction={() => onNavigate("/")} />;

  return (
    <section className="collection-page" aria-labelledby="collection-title">
      <a className="back-link" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}>← Home</a>
      <div className="page-intro collection-intro"><p className="eyebrow">Project collection</p><h1 id="collection-title" ref={collectionTitleRef} tabIndex={-1}>{project.displayName}</h1><p>{project.repository.kind === "git" ? project.repository.currentBranch : "Local folder"} · {codecasts.length} Codecast{codecasts.length === 1 ? "" : "s"}</p></div>
      {actionError ? <p className="error-note" role="alert">{actionError}</p> : null}
      {codecasts.length === 0 ? <div className="empty-collection"><h2>No Codecasts yet</h2><p>Describe a goal on Home to create the first lesson for this project.</p><button className="primary-button" onClick={() => onNavigate("/")} type="button">Create a Codecast</button></div> : <div className="codecast-list" aria-label="Codecast collection">{codecasts.map((codecast) => {
        const action = replayAction(codecast.status);
        return (
          <article className="codecast-row" key={codecast.id}>
            <div className="codecast-copy">
              <h2>{codecast.title}</h2>
              <p>{codecast.error?.message ?? codecast.outcome}</p>
              <span className={`status status-${codecast.status}`}>{statusLabel(codecast.status)}</span>
            </div>
            <div className="codecast-actions">
              <button aria-label={`${actionLabel(action)} ${codecast.title}`} className="quiet-button primary-row-action" disabled={busyId === codecast.id} onClick={() => handlePrimaryAction(codecast)} type="button">
                {actionLabel(action)}
              </button>
              <button aria-label={`Delete ${codecast.title}`} className="delete-button" onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setPendingDelete(codecast); setConfirmation(""); }} type="button">
                Delete
              </button>
            </div>
          </article>
        );
      })}</div>}
      {pendingDelete !== null ? <div className="dialog-backdrop"><section aria-labelledby="delete-title" aria-modal="true" className="delete-dialog" onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, () => { deleteTriggerRef.current?.focus(); setPendingDelete(null); setConfirmation(""); })} ref={dialogRef} role="dialog"><p className="eyebrow">Delete Codecast</p><h2 id="delete-title">Delete “{pendingDelete.title}”?</h2><p>This removes the generated media and playback state. The project folder and its files remain untouched.</p><label htmlFor="delete-confirmation">Type {pendingDelete.id} to confirm</label><input id="delete-confirmation" onChange={(event) => setConfirmation(event.target.value)} ref={confirmationRef} value={confirmation} /><div className="dialog-actions"><button className="quiet-button" onClick={() => { deleteTriggerRef.current?.focus(); setPendingDelete(null); setConfirmation(""); }} type="button">Cancel</button><button className="danger-button" disabled={confirmation !== pendingDelete.id || busyId === pendingDelete.id} onClick={() => void deleteCodecast()} type="button">Delete Codecast</button></div></section></div> : null}
    </section>
  );
}

function SettingsPage({ api, onModelConfigurationSaved, onNavigate }: { api: CodeRunnersApi; onModelConfigurationSaved: (configuration: ModelConfiguration) => void; onNavigate: (path: string) => void }) {
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    void api.getModels().then((response) => { setConfiguration(response.configuration); setError(null); }).catch((reason: unknown) => setError(errorMessage(reason, "Model settings could not be loaded."))).finally(() => setLoading(false));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const persist = async (next: ModelConfiguration) => {
    setConfiguration(next);
    setSaving(true);
    setError(null);
    try {
      const enabledModelIds = next.models.filter((model) => model.enabled).map((model) => model.id);
      const response = await api.updateModels({ enabledModelIds, defaults: next.defaults });
      setConfiguration(response.configuration);
      onModelConfigurationSaved(response.configuration);
    } catch (reason: unknown) {
      setError(errorMessage(reason, "Model settings could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <section className="library-state" aria-live="polite"><p className="eyebrow">Settings</p><h1>Loading model settings…</h1></section>;
  if (error !== null && configuration === null) return <StateMessage title="Settings unavailable" message={error} action="Retry" onAction={load} />;
  if (configuration === null) return null;

  return <section className="settings-page" aria-labelledby="settings-title"><a aria-label="Back to Home" className="back-link" href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}><span aria-hidden="true">← </span>Back to Home</a><div className="page-intro"><p className="eyebrow">Persistent configuration</p><h1 id="settings-title">Model settings</h1><p>Enable models and choose defaults for future Codecasts. Home selections override these defaults for one Codecast.</p></div>{error ? <p className="error-note" role="alert">{error}</p> : null}{(["authoring", "tts", "stt"] as const).map((role) => <section className="settings-group" key={role} aria-labelledby={`${role}-settings-title`}><div className="settings-group-heading"><h2 id={`${role}-settings-title`}>{roleLabels[role]}</h2><label>Default <select aria-label={`Default ${role} model`} onChange={(event) => void persist({ ...configuration, defaults: { ...configuration.defaults, [role]: event.target.value } })} value={configuration.defaults[role]}>{configuration.models.filter((model) => model.role === role).map((model) => <option disabled={!model.enabled || model.availability !== "ready"} key={model.id} value={model.id}>{model.displayName}</option>)}</select></label></div>{configuration.models.filter((model) => model.role === role).map((model) => <div className="setting-row" key={model.id}><div><strong>{model.displayName}</strong><span>{model.availability === "ready" ? model.providerId : availabilityLabel(model.availability)}</span></div><div className="setting-row-actions"><span className={`availability availability-${model.availability}`}>{availabilityLabel(model.availability)}</span><label className="toggle-label"><span className="visually-hidden">Enable {model.displayName}</span><input aria-label={`Enable ${model.displayName}`} checked={model.enabled} disabled={configuration.defaults[role] === model.id} onChange={(event) => void persist({ ...configuration, models: configuration.models.map((candidate) => candidate.id === model.id ? { ...candidate, enabled: event.target.checked } : candidate) })} type="checkbox" /> Enabled</label>{model.enabled && configuration.defaults[role] !== model.id ? <button className="quiet-button" onClick={() => void persist({ ...configuration, defaults: { ...configuration.defaults, [role]: model.id } })} type="button">Make {model.displayName} the {role === "authoring" ? "authoring" : role} default</button> : null}</div></div>)}</section>)}<p className="save-status" aria-live="polite">{saving ? "Saving model settings…" : "Settings are stored in the local CodeRunners registry."}</p></section>;
}

function StateMessage({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) {
  return <section className="library-state" role="alert"><p className="eyebrow">CodeRunners</p><h1>{title}</h1><p>{message}</p><button className="primary-button" onClick={onAction} type="button">{action}</button></section>;
}

function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  if (pathname === "/settings") return { kind: "settings" };
  const playerMatch = pathname.match(/^\/projects\/([^/]+)\/codecasts\/([^/]+)$/);
  if (playerMatch?.[1] !== undefined && playerMatch[2] !== undefined) return { kind: "player", projectId: decodeURIComponent(playerMatch[1]), codecastId: decodeURIComponent(playerMatch[2]) };
  const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
  if (projectMatch?.[1] !== undefined) return { kind: "project", projectId: decodeURIComponent(projectMatch[1]) };
  return { kind: "not-found" };
}

function createRuntimeApi(): CodeRunnersApi {
  const token = takeLaunchSession(window.location.href, (...args) => window.history.replaceState(...args)) ?? readStoredSessionToken();
  return new StudioApiClient(window.location.origin, token);
}

function readStoredSessionToken(): string | undefined {
  try {
    const token = window.sessionStorage.getItem("coderunners-session");
    return token === null || token.length === 0 ? undefined : token;
  } catch {
    return undefined;
  }
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof StudioApiError || reason instanceof Error ? reason.message : fallback;
}

function availabilityLabel(availability: ModelOption["availability"]): string {
  return { ready: "Ready", unavailable: "Unavailable", "needs-auth": "Needs authentication", downloading: "Downloading", failed: "Failed" }[availability];
}

function preferredReasoning(
  model: ModelOption | undefined,
  current?: ReasoningLevel,
): ReasoningLevel {
  if (current !== undefined && model?.reasoningOptions.includes(current)) {
    return current;
  }
  if (model?.reasoningOptions.includes(defaultReasoning)) {
    return defaultReasoning;
  }
  return model?.reasoningOptions[0] ?? defaultReasoning;
}

function statusLabel(status: CodecastRecord["status"]): string {
  return { generating: "GENERATING", ready: "READY", "in-progress": "IN PROGRESS", completed: "COMPLETED", failed: "FAILED", interrupted: "INTERRUPTED" }[status];
}

function replayAction(status: CodecastRecord["status"]): "view progress" | "play" | "resume" | "replay" | "retry" | "restart job" {
  const actions: Record<CodecastRecord["status"], "view progress" | "play" | "resume" | "replay" | "retry" | "restart job"> = { generating: "view progress", ready: "play", "in-progress": "resume", completed: "replay", failed: "retry", interrupted: "restart job" };
  return actions[status];
}

function actionLabel(action: ReturnType<typeof replayAction>): string {
  return { "view progress": "View progress", play: "Play", resume: "Resume", replay: "Replay", retry: "Retry", "restart job": "Restart job" }[action];
}

function handleDialogKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  dialog: HTMLElement | null,
  onEscape: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
