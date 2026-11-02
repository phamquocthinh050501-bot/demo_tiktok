import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".css": "text/css; charset=utf-8",
};
const MAX_BUFFERED = 1_000_000;

function fanOut(clients: Set<WebSocket>, msg: unknown) {
  if (!clients.size) return;
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1 && c.bufferedAmount < MAX_BUFFERED) c.send(data);
}

export interface Server {
  port: number;
  broadcast(msg: unknown): void;          // tới trang game / overlay (/ws), chỉ nhận
  broadcastControl(msg: unknown): void;   // tới màn hình streamer (/control)
  clients(): number;
  controlClients(): number;
  close(): Promise<void>;
}
export interface ControlConn { send(msg: unknown): void; onMessage(handler: (data: unknown) => void): void }

// Chỉ nghe 127.0.0.1, chỉ phục vụ vài thư mục cố định, từ chối Host/Origin lạ (chống DNS rebinding / trang web lạ nói chuyện với game).
// /ws chỉ để xem (client không gửi được gì); mọi điều khiển đi qua /control.
export function startServer(opts: {
  port: number; root: URL; onClient: (send: (msg: unknown) => void) => void; onControl?: (conn: ControlConn) => void;
}): Promise<Server> {
  const root = fileURLToPath(opts.root);
  const dirs: Record<string, string> = {
    "/web/": resolve(root, "src/web"),
    "/assets/": resolve(root, "assets"),
  };
  const files: Record<string, string> = {
    "/game": resolve(root, "src/web/game/index.html"),
    "/dashboard": resolve(root, "src/web/dashboard/index.html"),
    "/vendor/phaser.min.js": resolve(root, "node_modules/phaser/dist/phaser.min.js"),
  };
  let port = 0;
  const hostOk = (h?: string) => h === `localhost:${port}` || h === `127.0.0.1:${port}`;
  const originOk = (o?: string) => o === undefined || o === `http://localhost:${port}` || o === `http://127.0.0.1:${port}`;

  function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  }
  function sendFile(res: ServerResponse, path: string) {
    if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, "Không tìm thấy");
    const ext = extname(path);
    const type = TYPES[ext];
    if (!type) return send(res, 404, "Không tìm thấy");
    // Mã web viết bằng TypeScript: gỡ kiểu rồi gửi như JS, không cần bước build.
    if (ext === ".ts") {
      try { return send(res, 200, stripTypeScriptTypes(readFileSync(path, "utf8")), type); }
      catch (err) {
        console.error(`Lỗi cú pháp trong ${path}:`, (err as Error).message);
        return send(res, 500, `Lỗi cú pháp trong tệp web: ${(err as Error).message}`);
      }
    }
    send(res, 200, readFileSync(path), type);
  }

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!hostOk(req.headers.host)) return send(res, 403, "Host không hợp lệ");
    if (req.method !== "GET") return send(res, 405, "Chỉ hỗ trợ GET");
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname); } catch { return send(res, 400, "Đường dẫn lỗi"); }
    if (path === "/") { res.writeHead(302, { Location: "/game" }); return res.end(); }
    if (files[path]) return sendFile(res, files[path]);
    for (const [prefix, dir] of Object.entries(dirs)) {
      if (!path.startsWith(prefix)) continue;
      const full = resolve(dir, "." + path.slice(prefix.length - 1));
      if (path.includes("\0") || !full.startsWith(dir + sep)) return send(res, 403, "Không được phép");
      return sendFile(res, full);
    }
    send(res, 404, "Không tìm thấy");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const cwss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on("upgrade", (req, socket, head) => {
    const isControl = req.url === "/control" && !!opts.onControl;
    const ok = (req.url === "/ws" || isControl) && hostOk(req.headers.host) && originOk(req.headers.origin);
    if (!ok) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    (isControl ? cwss : wss).handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => ws.terminate());
      if (!isControl) return opts.onClient((m) => ws.send(JSON.stringify(m)));
      opts.onControl!({
        send: (m) => ws.send(JSON.stringify(m)),
        onMessage: (handler) => ws.on("message", (raw) => {
          let data: unknown;
          try { data = JSON.parse(String(raw)); } catch { data = undefined; }
          handler(data);
        }),
      });
    });
  });

  return new Promise((ok, fail) => {
    http.once("error", fail);
    http.listen(opts.port, "127.0.0.1", () => {
      port = (http.address() as { port: number }).port;
      ok({
        port,
        clients: () => wss.clients.size,
        controlClients: () => cwss.clients.size,
        broadcast: (msg) => fanOut(wss.clients as Set<WebSocket>, msg),
        broadcastControl: (msg) => fanOut(cwss.clients as Set<WebSocket>, msg),
        close: () => new Promise<void>((done) => {
          for (const c of [...wss.clients, ...cwss.clients]) c.terminate();
          wss.close(() => cwss.close(() => http.close(() => done())));
        }),
      });
    });
  });
}
