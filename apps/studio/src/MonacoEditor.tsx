import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/parameterHints/browser/parameterHints";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker?worker";
import "monaco-editor/languages/features/css/register";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker?worker";
import "monaco-editor/languages/features/html/register";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import "monaco-editor/languages/features/json/register";
import TypeScriptWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import * as monacoTypeScript from "monaco-editor/languages/features/typescript/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/typescript/register";

import { planEditorValueUpdate } from "./editor-value-update.js";
import {
  editorLanguageForPath,
  keywordHoverAt,
  keywordReferences,
} from "./editor-intellisense.js";

type MonacoEditorProps = {
  focusRange: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | undefined;
  onChange: (value: string) => void;
  path: string;
  readOnly?: boolean;
  showTypingCaret?: boolean;
  value: string;
};

const monacoEnvironment = self as typeof self & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker;
  };
};

monacoEnvironment.MonacoEnvironment = {
  getWorker: (_workerId, label) => {
    if (label === "typescript" || label === "javascript") {
      return new TypeScriptWorker();
    }
    if (label === "css" || label === "less" || label === "scss") {
      return new CssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new HtmlWorker();
    }
    if (label === "json") {
      return new JsonWorker();
    }
    return new EditorWorker();
  },
};

monaco.editor.defineTheme("coderunners-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "687386", fontStyle: "italic" },
    { token: "identifier", foreground: "82AAFF" },
    { token: "keyword", foreground: "FF7AB2", fontStyle: "bold" },
    { token: "keyword.control", foreground: "FF7AB2", fontStyle: "bold" },
    { token: "number", foreground: "F78C6C" },
    { token: "string", foreground: "A8F0CF" },
    { token: "string.escape", foreground: "F8E16C" },
    { token: "type", foreground: "2FD8F2" },
    { token: "type.identifier", foreground: "2FD8F2" },
    { token: "variable", foreground: "D8DEE9" },
  ],
  colors: {
    "editor.background": "#0A0A0A",
    "editor.foreground": "#D8DEE9",
    "editor.lineHighlightBackground": "#080808",
    "editorLineNumber.foreground": "#454952",
    "editorLineNumber.activeForeground": "#8B909A",
    "editor.selectionBackground": "#12344A",
    "editorCursor.foreground": "#0A96FF",
    "editorIndentGuide.background1": "#17191D",
    "editorIndentGuide.activeBackground1": "#2B2E34",
    "editorHoverWidget.background": "#06090D",
    "editorHoverWidget.border": "#2D4B70",
    "editorHoverWidget.foreground": "#E6EDF7",
    "editorHoverWidget.highlightForeground": "#2FD8F2",
    "editorHoverWidget.statusBarBackground": "#090D12",
    "editorSuggestWidget.background": "#06090D",
    "editorSuggestWidget.border": "#2D4B70",
    "editorSuggestWidget.focusHighlightForeground": "#2FD8F2",
    "editorSuggestWidget.foreground": "#E6EDF7",
    "editorSuggestWidget.highlightForeground": "#FF7AB2",
    "editorSuggestWidget.selectedBackground": "#132338",
    "editorWidget.background": "#06090D",
    "editorWidget.border": "#2D4B70",
    "textCodeBlock.background": "#030508",
    "textLink.foreground": "#82AAFF",
  },
});

export function MonacoEditor({ focusRange, onChange, path, readOnly = false, showTypingCaret = false, value }: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const caretNodeRef = useRef<HTMLSpanElement | undefined>(undefined);
  const caretWidgetRef = useRef<monaco.editor.IContentWidget | undefined>(undefined);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const syncingValueRef = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const language = editorLanguageForPath(path);
    const model = monaco.editor.createModel(
      value,
      language,
      monaco.Uri.from({ path: `/${path.replace(/^\/+/, "")}`, scheme: "file" }),
    );
    const editor = monaco.editor.create(container, {
      ariaLabel: `Code editor for ${path}`,
      automaticLayout: true,
      fixedOverflowWidgets: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      hover: { delay: 250, enabled: "on", sticky: true },
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      model,
      padding: { top: 12 },
      parameterHints: { cycle: true, enabled: true },
      quickSuggestions: { comments: false, other: true, strings: true },
      readOnly,
      scrollBeyondLastLine: false,
      suggestOnTriggerCharacters: true,
      tabCompletion: "on",
      theme: "coderunners-dark",
    });
    editorRef.current = editor;
    const caretNode = document.createElement("span");
    caretNode.className = "demo-typing-caret";
    caretNode.hidden = true;
    caretNode.setAttribute("aria-hidden", "true");
    const caretWidget: monaco.editor.IContentWidget = {
      getDomNode: () => caretNode,
      getId: () => "coderunners.demo-typing-caret",
      getPosition: () => ({
        position: model.getPositionAt(model.getValueLength()),
        preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
      }),
    };
    editor.addContentWidget(caretWidget);
    caretNodeRef.current = caretNode;
    caretWidgetRef.current = caretWidget;
    const changeSubscription = model.onDidChangeContent(() => {
      if (!syncingValueRef.current) {
        onChangeRef.current(model.getValue());
      }
    });

    return () => {
      changeSubscription.dispose();
      editor.removeContentWidget(caretWidget);
      editor.dispose();
      model.dispose();
      caretNodeRef.current = undefined;
      caretWidgetRef.current = undefined;
      editorRef.current = undefined;
    };
  }, [path]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model === null || model === undefined) {
      return;
    }
    const update = planEditorValueUpdate(model.getValue(), value);
    if (update.type === "none") {
      return;
    }

    syncingValueRef.current = true;
    try {
      if (update.type === "append") {
        const position = model.getPositionAt(model.getValueLength());
        model.applyEdits([{
          forceMoveMarkers: true,
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
          text: update.text,
        }]);
      } else {
        model.setValue(update.value);
      }
    } finally {
      syncingValueRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    const caretNode = caretNodeRef.current;
    const caretWidget = caretWidgetRef.current;
    if (editor === undefined || caretNode === undefined || caretWidget === undefined) {
      return;
    }
    caretNode.hidden = !showTypingCaret;
    editor.layoutContentWidget(caretWidget);
    if (showTypingCaret) {
      const model = editor.getModel();
      if (model !== null) {
        editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(model.getValueLength()));
      }
    }
  }, [showTypingCaret, value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === undefined || focusRange === undefined) {
      return;
    }
    const range = new monaco.Range(
      focusRange.start.line,
      focusRange.start.column,
      focusRange.end.line,
      focusRange.end.column,
    );
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
  }, [focusRange]);

  return <div aria-label="Learner code editor" className="monaco-host" ref={containerRef} />;
}

let intellisenseConfigured = false;

function configureIntellisense() {
  if (intellisenseConfigured) {
    return;
  }
  intellisenseConfigured = true;

  const compilerOptions: monacoTypeScript.CompilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    checkJs: true,
    esModuleInterop: true,
    jsx: monacoTypeScript.JsxEmit.ReactJSX,
    module: monacoTypeScript.ModuleKind.ESNext,
    moduleResolution: monacoTypeScript.ModuleResolutionKind.NodeJs,
    strict: true,
    target: monacoTypeScript.ScriptTarget.ESNext,
  };
  const diagnosticsOptions: monacoTypeScript.DiagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
  };

  for (const defaults of [
    monacoTypeScript.typescriptDefaults,
    monacoTypeScript.javascriptDefaults,
  ]) {
    defaults.setCompilerOptions(compilerOptions);
    defaults.setDiagnosticsOptions(diagnosticsOptions);
    defaults.setEagerModelSync(true);
  }

  for (const language of ["typescript", "javascript"]) {
    monaco.languages.registerHoverProvider(language, {
      provideHover(model, position) {
        const match = keywordHoverAt(model.getLineContent(position.lineNumber), position.column);
        if (match === undefined) {
          return undefined;
        }
        const reference = keywordReferences[match.keyword];
        const metadata = ["since" in reference ? reference.since : undefined, reference.category]
          .filter(Boolean)
          .join(" · ");
        return {
          contents: [
            {
              value: `### ✨ ${reference.label}\n\n**${metadata}**\n\n${reference.detail}\n\n---\n**Syntax**\n\n\`\`\`typescript\n${reference.syntax}\n\`\`\``,
            },
          ],
          range: new monaco.Range(
            position.lineNumber,
            match.range.startColumn,
            position.lineNumber,
            match.range.endColumn,
          ),
        };
      },
    });
  }
}

configureIntellisense();
