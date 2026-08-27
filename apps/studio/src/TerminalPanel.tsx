import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

type TerminalPanelProps = {
  onInput: ((data: string) => void) | undefined;
  output: string;
};

export function TerminalPanel({ onInput, output }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onInputRef = useRef(onInput);
  const terminalRef = useRef<Terminal | undefined>(undefined);

  useEffect(() => {
    onInputRef.current = onInput;
    if (terminalRef.current !== undefined) {
      terminalRef.current.options.disableStdin = onInput === undefined;
    }
  }, [onInput]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#030508",
        foreground: "#D7E1EB",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);
    terminalRef.current = terminal;
    const inputSubscription = terminal.onData((data) => {
      onInputRef.current?.(data);
    });

    return () => {
      resizeObserver.disconnect();
      inputSubscription.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === undefined) {
      return;
    }
    terminal.reset();
    terminal.write(output);
  }, [output]);

  return <div aria-label="Terminal output" className="terminal-surface" ref={containerRef} />;
}
