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
        background: "#030303",
        black: "#030303",
        blue: "#69A7FF",
        brightBlack: "#777777",
        brightBlue: "#8BBEFF",
        brightCyan: "#7CE6EC",
        brightGreen: "#54E49A",
        brightMagenta: "#D8A7F0",
        brightRed: "#FF7A85",
        brightWhite: "#FFFFFF",
        brightYellow: "#E6F66A",
        cursor: "#0A96FF",
        cursorAccent: "#030303",
        cyan: "#56D4DD",
        foreground: "#E6E6E6",
        green: "#36D982",
        magenta: "#C792EA",
        red: "#FF5F6D",
        selectionBackground: "#12344A",
        white: "#D8DEE9",
        yellow: "#D7EF21",
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
