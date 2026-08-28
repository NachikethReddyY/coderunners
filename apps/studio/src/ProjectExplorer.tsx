import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import type {
  ProjectDirectoryEntry,
  StudioApiClient,
} from "./studio-api.js";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
} from "./icons.js";
import { FileIcon } from "./file-icon-theme.js";

type ProjectExplorerProps = {
  activePath: string;
  api: StudioApiClient | null;
  onError: (message: string) => void;
  onOpenFile: (path: string) => void;
  projectName: string;
};

type DirectoryMap = Record<string, ProjectDirectoryEntry[]>;

const fallbackDirectories: DirectoryMap = {
  "": [{ kind: "directory", name: "src", path: "src" }],
  src: [
    { kind: "file", name: "formatHabitLabel.test.ts", path: "src/formatHabitLabel.test.ts" },
    { kind: "file", name: "formatHabitLabel.ts", path: "src/formatHabitLabel.ts" },
  ],
};

export function ProjectExplorer({
  activePath,
  api,
  onError,
  onOpenFile,
  projectName,
}: ProjectExplorerProps) {
  const initialExpanded = useMemo(() => new Set(ancestorDirectories(activePath)), [activePath]);
  const [directories, setDirectories] = useState<DirectoryMap>(fallbackDirectories);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [rootOpen, setRootOpen] = useState(true);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (api === null) {
        return;
      }
      try {
        const listing = await api.listDirectory(path);
        setDirectories((current) => ({ ...current, [path]: listing.entries }));
      } catch (error) {
        onError(error instanceof Error ? error.message : "The project folder could not be read.");
      }
    },
    [api, onError],
  );

  const refresh = useCallback(async () => {
    const paths = ancestorDirectories(activePath);
    await Promise.all(paths.map((path) => loadDirectory(path)));
    setExpanded(new Set(paths));
  }, [activePath, loadDirectory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleDirectory = useCallback(
    (path: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (directories[path] === undefined) {
            void loadDirectory(path);
          }
        }
        return next;
      });
    },
    [directories, loadDirectory],
  );

  return (
    <nav aria-label="Project files" className="explorer-pane">
      <div className="explorer-toolbar">
        <button
          aria-expanded={rootOpen}
          aria-label={rootOpen ? "Collapse project" : "Expand project"}
          className="explorer-title"
          onClick={() => setRootOpen((open) => !open)}
          type="button"
        >
          {rootOpen ? <ChevronDownIcon className="chevron-icon" /> : <ChevronRightIcon className="chevron-icon" />}
          <strong>{projectName.toUpperCase()}</strong>
        </button>
      </div>

      {rootOpen ? (
        <div aria-label="Project filesystem" className="file-tree" role="tree">
          <TreeEntries
            activePath={activePath}
            depth={0}
            directories={directories}
            directoryPath=""
            expanded={expanded}
            onOpenFile={onOpenFile}
            onToggleDirectory={toggleDirectory}
          />
        </div>
      ) : null}
    </nav>
  );
}

type TreeEntriesProps = {
  activePath: string;
  depth: number;
  directories: DirectoryMap;
  directoryPath: string;
  expanded: Set<string>;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
};

function TreeEntries({
  activePath,
  depth,
  directories,
  directoryPath,
  expanded,
  onOpenFile,
  onToggleDirectory,
}: TreeEntriesProps) {
  return directories[directoryPath]?.map((entry) => {
    const inset = { "--tree-depth": depth } as CSSProperties;
    if (entry.kind === "directory") {
      const isExpanded = expanded.has(entry.path);
      return (
        <div key={entry.path} role="none">
          <button
            aria-expanded={isExpanded}
            className="tree-row is-directory"
            onClick={() => onToggleDirectory(entry.path)}
            role="treeitem"
            style={inset}
            type="button"
          >
            {isExpanded ? <ChevronDownIcon className="chevron-icon" /> : <ChevronRightIcon className="chevron-icon" />}
            {isExpanded ? <FolderOpenIcon className="file-icon folder" /> : <FolderIcon className="file-icon folder" />}
            <span>{entry.name}</span>
          </button>
          {isExpanded ? (
            <div role="group">
              <TreeEntries
                activePath={activePath}
                depth={depth + 1}
                directories={directories}
                directoryPath={entry.path}
                expanded={expanded}
                onOpenFile={onOpenFile}
                onToggleDirectory={onToggleDirectory}
              />
            </div>
          ) : null}
        </div>
      );
    }

    if (entry.kind === "symlink") {
      return (
        <div className="tree-row is-symlink" key={entry.path} role="treeitem" style={inset} title="Linked path is outside the selected project boundary">
          <span className="tree-spacer" />
          <FolderIcon className="file-icon symlink" />
          <span>{entry.name}</span>
          <span aria-hidden="true" className="symlink-mark">↪</span>
        </div>
      );
    }

    return (
      <button
        aria-current={entry.path === activePath ? "page" : undefined}
        className="tree-row is-file"
        key={entry.path}
        onClick={() => onOpenFile(entry.path)}
        role="treeitem"
        style={inset}
        type="button"
      >
        <span className="tree-spacer" />
        <FileIcon name={entry.name} />
        <span>{entry.name}</span>
      </button>
    );
  });
}

function ancestorDirectories(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  const directories = [""];
  for (let index = 0; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index + 1).join("/"));
  }
  return directories;
}
