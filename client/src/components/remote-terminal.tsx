import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Loader2, Plug, Power, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type TerminalStatus = "closed" | "connecting" | "connected" | "error";

const QUICK = [
  { label: "Status", command: "uptime && free -h && df -h /" },
  { label: "Prozesse", command: "ps aux --sort=-%cpu | head -8" },
  { label: "Dienste", command: "systemctl --failed --no-pager" },
  { label: "Dateien", command: "ls -la ~" },
  { label: "Docker", command: "docker ps --format 'table {{.Names}}\\t{{.Status}}' 2>&1" },
];

export function RemoteTerminal({ username, host }: { username: string; host: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<TerminalStatus>("closed");
  const mountedRef = useRef(false);
  const connectAttemptRef = useRef(0);
  const [status, setStatus] = useState<TerminalStatus>("closed");

  const setTerminalStatus = useCallback((next: TerminalStatus) => {
    statusRef.current = next;
    setStatus(next);
    if (terminalRef.current) terminalRef.current.options.disableStdin = next !== "connected";
  }, []);

  const sendSize = useCallback(() => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    try {
      fit.fit();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && statusRef.current === "connected") {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    } catch {
      // Fit can briefly fail while a mobile view is transitioning or hidden.
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    mountedRef.current = true;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      disableStdin: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5_000,
      theme: {
        background: "#0b1014",
        foreground: "#d6ded9",
        cursor: "#a3b18a",
        cursorAccent: "#0b1014",
        selectionBackground: "#a3b18a55",
        black: "#111820",
        red: "#e28b83",
        green: "#a3b18a",
        yellow: "#e6c38b",
        blue: "#8ba7c9",
        magenta: "#b69acb",
        cyan: "#8dbcb5",
        white: "#d6ded9",
        brightBlack: "#74807a",
        brightRed: "#ef9e96",
        brightGreen: "#b8c99c",
        brightYellow: "#efd2a0",
        brightBlue: "#9cb9dd",
        brightMagenta: "#c7addb",
        brightCyan: "#a0d0c8",
        brightWhite: "#f5f3ee",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.writeln("Nexar · interaktives SSH-Terminal");
    terminal.writeln("Zum Starten „Verbinden“ wählen. Ctrl+C, Tab und Pfeiltasten funktionieren wie in einer Shell.\r\n");

    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(sendSize));
    resizeObserver.observe(containerRef.current);
    const inputListener = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && statusRef.current === "connected") {
        socket.send(new TextEncoder().encode(data));
      }
    });
    const initialFit = window.setTimeout(sendSize, 0);

    return () => {
      mountedRef.current = false;
      connectAttemptRef.current += 1;
      window.clearTimeout(initialFit);
      resizeObserver.disconnect();
      inputListener.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [sendSize]);

  const connect = async () => {
    if (statusRef.current === "connecting" || statusRef.current === "connected") return;
    const attempt = ++connectAttemptRef.current;
    setTerminalStatus("connecting");
    terminalRef.current?.writeln("\r\nVerbinde sicher mit dem PC …");

    try {
      const response = await apiRequest("POST", "/api/ssh/terminal-token", {});
      if (!mountedRef.current || attempt !== connectAttemptRef.current) return;
      const { token } = await response.json() as { token?: unknown };
      if (!mountedRef.current || attempt !== connectAttemptRef.current) return;
      if (typeof token !== "string" || token.length < 40) throw new Error("Kein gültiges Terminalticket erhalten. Bitte erneut verbinden.");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/api/ssh/terminal`, ["nexar-terminal", `nexar-token.${token}`]);
      if (!mountedRef.current || attempt !== connectAttemptRef.current) {
        socket.close();
        return;
      }
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onmessage = (event) => {
        if (!mountedRef.current || attempt !== connectAttemptRef.current) return;
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data);
            if (message.type === "status" && message.state === "connected") {
              setTerminalStatus("connected");
              sendSize();
              terminalRef.current?.focus();
              return;
            }
            if (message.type === "status" && message.state === "closed") {
              setTerminalStatus("closed");
              if (message.message) terminalRef.current?.writeln(`\r\n${message.message}`);
              return;
            }
            if (message.type === "error") {
              setTerminalStatus("error");
              terminalRef.current?.writeln(`\r\n\x1b[31m${message.message || "SSH-Verbindung fehlgeschlagen."}\x1b[0m`);
              return;
            }
          } catch {
            terminalRef.current?.write(event.data);
          }
          return;
        }
        if (event.data instanceof ArrayBuffer) terminalRef.current?.write(new Uint8Array(event.data));
        else if (event.data instanceof Blob) event.data.arrayBuffer().then((buffer) => terminalRef.current?.write(new Uint8Array(buffer)));
      };
      socket.onerror = () => {
        if (!mountedRef.current || attempt !== connectAttemptRef.current) return;
        if (statusRef.current !== "error") {
          setTerminalStatus("error");
          terminalRef.current?.writeln("\r\n\x1b[31mWebSocket-Verbindung fehlgeschlagen. Prüfe Anmeldung und Netzwerkverbindung.\x1b[0m");
        }
      };
      socket.onclose = () => {
        if (!mountedRef.current || attempt !== connectAttemptRef.current) return;
        if (socketRef.current === socket) socketRef.current = null;
        if (statusRef.current !== "error") setTerminalStatus("closed");
      };
    } catch (error) {
      if (!mountedRef.current || attempt !== connectAttemptRef.current) return;
      setTerminalStatus("error");
      terminalRef.current?.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Terminalverbindung fehlgeschlagen."}\x1b[0m`);
    }
  };

  const disconnect = () => {
    connectAttemptRef.current += 1;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Benutzer hat getrennt");
    setTerminalStatus("closed");
    terminalRef.current?.writeln("\r\nVerbindung getrennt.");
  };

  const statusText = status === "connected" ? "Verbunden" : status === "connecting" ? "Verbindung wird hergestellt" : status === "error" ? "Verbindungsfehler" : "Getrennt";

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-card-border bg-[#0b1014] text-[#d6ded9]" data-testid="remote-terminal">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
          <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{username}@{host}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${status === "connected" ? "bg-primary" : status === "connecting" ? "animate-pulse bg-amber-400" : status === "error" ? "bg-destructive" : "bg-white/30"}`} />
          <span className="hidden text-[11px] text-white/50 sm:inline">{statusText}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-white/70 hover:text-white" onClick={() => terminalRef.current?.clear()} data-testid="button-clear-terminal">Leeren</Button>
          {status === "connected" ? (
            <Button size="sm" variant="outline" className="h-8 border-white/20 bg-transparent px-2.5 text-xs text-white hover:bg-white/10" onClick={disconnect} data-testid="button-disconnect-terminal"><Power className="mr-1.5 h-3.5 w-3.5" />Trennen</Button>
          ) : (
            <Button size="sm" variant="outline" className="h-8 border-white/20 bg-transparent px-2.5 text-xs text-white hover:bg-white/10" onClick={connect} disabled={status === "connecting"} data-testid="button-connect-terminal">
              {status === "connecting" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
              {status === "connecting" ? "Verbinde …" : "Verbinden"}
            </Button>
          )}
        </div>
      </div>
      <div className="border-b border-amber-300/15 bg-amber-300/5 px-3 py-2 text-[11px] leading-relaxed text-amber-100/75 sm:px-4">
        Interaktive SSH-Shell: Befehle laufen direkt auf deinem PC; der Sicherheitsmodus filtert sie hier nicht.
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-white/10 px-3 py-2 sm:flex-wrap sm:overflow-visible sm:px-4">
        {QUICK.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => terminalRef.current?.paste(`${item.command}\r`)}
            disabled={status !== "connected"}
            className="shrink-0 rounded border border-white/15 px-2 py-1 font-mono text-[11px] text-white/70 hover:border-primary/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            data-testid={`button-terminal-${item.label.toLowerCase()}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="h-[min(48dvh,32rem)] min-h-[16rem] overflow-hidden px-2 py-2 font-mono text-xs" data-testid="terminal-output" />
    </section>
  );
}
