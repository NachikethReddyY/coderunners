import type { CSSProperties } from "react";

type FileIconDefinition = {
  color: string;
  icon?: "beaker" | "code" | "file" | "json" | "markdown" | "package" | "settings-gear" | "symbol-color";
  label?: string;
};

const coderunnersFileIconTheme = {
  fileNames: {
    "package.json": { color: "#8bd450", icon: "package" },
    "tsconfig.json": { color: "#5caeff", icon: "settings-gear" },
    "vite.config.ts": { color: "#bd76ff", icon: "settings-gear" },
  },
  fileExtensions: {
    ts: { color: "#3da9f5", label: "TS" },
    tsx: { color: "#3da9f5", label: "TS" },
    js: { color: "#e8dc5b", label: "JS" },
    jsx: { color: "#e8dc5b", label: "JS" },
    json: { color: "#d8c85b", icon: "json" },
    css: { color: "#55aaff", icon: "symbol-color" },
    html: { color: "#ff794d", icon: "code" },
    md: { color: "#75bfff", icon: "markdown" },
    test: { color: "#de8cff", icon: "beaker" },
  },
  fallback: { color: "#a8a8a8", icon: "file" },
} as const satisfies {
  fileNames: Record<string, FileIconDefinition>;
  fileExtensions: Record<string, FileIconDefinition>;
  fallback: FileIconDefinition;
};

export function FileIcon({ name }: { name: string }) {
  const definition = resolveFileIcon(name);
  const style = { "--file-icon-color": definition.color } as CSSProperties;
  if (definition.label !== undefined) {
    return <span aria-hidden="true" className="file-type is-label" style={style}>{definition.label}</span>;
  }
  return <span aria-hidden="true" className={`file-type codicon codicon-${definition.icon ?? "file"}`} style={style} />;
}

function resolveFileIcon(name: string): FileIconDefinition {
  const normalizedName = name.toLowerCase();
  const named = coderunnersFileIconTheme.fileNames[
    normalizedName as keyof typeof coderunnersFileIconTheme.fileNames
  ];
  if (named !== undefined) {
    return named;
  }

  if (/\.(?:test|spec)\.[^.]+$/u.test(normalizedName)) {
    return coderunnersFileIconTheme.fileExtensions.test;
  }
  const extension = normalizedName.split(".").pop() ?? "";
  return coderunnersFileIconTheme.fileExtensions[
    extension as keyof typeof coderunnersFileIconTheme.fileExtensions
  ] ?? coderunnersFileIconTheme.fallback;
}
