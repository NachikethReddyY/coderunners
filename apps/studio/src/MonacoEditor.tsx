import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/languages/definitions/typescript/register";

type MonacoEditorProps = {
  onChange: (value: string) => void;
  value: string;
};

const monacoEnvironment = self as typeof self & {
  MonacoEnvironment?: {
    getWorker: () => Worker;
  };
};

monacoEnvironment.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export function MonacoEditor({ onChange, value }: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
    const model = monaco.editor.createModel(value, "typescript");
    const editor = monaco.editor.create(container, {
      automaticLayout: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      model,
      padding: { top: 16 },
      scrollBeyondLastLine: false,
      theme: "vs-dark",
    });
    editorRef.current = editor;
    const changeSubscription = model.onDidChangeContent(() => {
      if (!syncingValueRef.current) {
        onChangeRef.current(model.getValue());
      }
    });

    return () => {
      changeSubscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model !== null && model !== undefined && model.getValue() !== value) {
      syncingValueRef.current = true;
      model.setValue(value);
      syncingValueRef.current = false;
    }
  }, [value]);

  return <div aria-label="Learner code editor" className="monaco-host" ref={containerRef} />;
}
