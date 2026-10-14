import type { Express } from "express";
import type { Server, IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { openSshShell, publicSshConfig } from "./ssh";

const TERMINAL_PATH = "/api/ssh/terminal";
const TOKEN_LIFETIME_MS = 30_000;
const MAX_ACTIVE_TERMINALS = 3;
const grants = new Map<string, number>();

function sameOrigin(req: IncomingMessage) {
  const origin = String(req.headers.origin || "");
  const host = String(req.headers.host || "");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (Boolean((req.socket as any).encrypted) ? "https" : "http");
  return !!origin && !!host && origin === `${protocol}://${host}`;
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: number) {
  if (socket.destroyed) return;
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 429 ? "Too Many Requests" : "Bad Request";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function registerTerminalRoutes(httpServer: Server, app: Express) {
  app.post("/api/ssh/terminal-token", (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Nicht angemeldet" });
    if (!sameOrigin(req)) return res.status(403).json({ message: "Ungültiger Ursprung" });
    if (!publicSshConfig().configured) return res.status(400).json({ message: "Richte zuerst die SSH-Verbindung unter „Mein PC“ ein." });

    const now = Date.now();
    for (const [token, expiresAt] of grants) if (expiresAt <= now) grants.delete(token);
    if (grants.size >= 500) return res.status(429).json({ message: "Zu viele offene Terminal-Verbindungen. Bitte kurz warten." });

    const token = randomBytes(32).toString("base64url");
    grants.set(token, now + TOKEN_LIFETIME_MS);
    res.setHeader("Cache-Control", "no-store");
    res.json({ token, expiresAt: now + TOKEN_LIFETIME_MS });
  });

  const active = new Set<WebSocket>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    handleProtocols: (protocols) => protocols.has("nexar-terminal") ? "nexar-terminal" : false,
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== TERMINAL_PATH) return;
    if (!sameOrigin(req)) return rejectUpgrade(socket, 403);

    const offeredProtocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map((value) => value.trim());
    const tokenProtocol = offeredProtocols.find((value) => value.startsWith("nexar-token."));
    const token = tokenProtocol?.slice("nexar-token.".length) || "";
    const expiresAt = grants.get(token);
    if (!offeredProtocols.includes("nexar-terminal") || !token || !expiresAt || expiresAt <= Date.now()) {
      if (token) grants.delete(token);
      return rejectUpgrade(socket, 401);
    }
    grants.delete(token);
    if (active.size >= MAX_ACTIVE_TERMINALS) return rejectUpgrade(socket, 429);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    active.add(ws);
    let shell: Awaited<ReturnType<typeof openSshShell>> | undefined;
    let closed = false;
    let dimensions = { cols: 100, rows: 28 };

    const sendControl = (message: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      active.delete(ws);
      shell?.close();
    };
    const sendError = (message: string) => {
      sendControl({ type: "error", message });
      if (ws.readyState === WebSocket.OPEN) {
        const timer = setTimeout(() => ws.close(1011, "SSH session failed"), 80);
        timer.unref?.();
      }
    };

    ws.once("close", cleanup);
    ws.once("error", cleanup);
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!shell) return;
        const input = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        shell.stream.write(input);
        return;
      }

      try {
        const message = JSON.parse(data.toString());
        if (message?.type !== "resize") return;
        dimensions = {
          cols: Math.max(20, Math.min(250, Math.round(Number(message.cols) || 100))),
          rows: Math.max(5, Math.min(100, Math.round(Number(message.rows) || 28))),
        };
        shell?.stream.setWindow(dimensions.rows, dimensions.cols, 0, 0);
      } catch {
        // Ignore malformed terminal control messages.
      }
    });

    openSshShell(dimensions.cols, dimensions.rows).then((session) => {
      if (closed || ws.readyState !== WebSocket.OPEN) {
        session.close();
        return;
      }
      shell = session;
      session.stream.on("data", (chunk: Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 1_000_000) session.stream.pause();
        ws.send(chunk, { binary: true }, () => {
          if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) session.stream.resume();
        });
      });
      session.stream.stderr.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
      });
      session.stream.on("close", () => {
        sendControl({ type: "status", state: "closed", message: "SSH-Shell beendet." });
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "SSH shell closed");
      });
      session.connection.on("close", () => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "SSH connection closed");
      });
      session.connection.on("error", (error: Error) => sendError(`SSH-Verbindung unterbrochen: ${error.message}`));
      session.stream.setWindow(dimensions.rows, dimensions.cols, 0, 0);
      sendControl({ type: "status", state: "connected" });
    }).catch((error: Error) => sendError(error.message || "SSH-Verbindung fehlgeschlagen."));
  });
}
