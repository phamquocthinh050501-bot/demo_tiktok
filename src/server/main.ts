import { createController } from "./control.ts";
import { createGame, loadGameConfig, validateGameConfig } from "./game.ts";
import { startServer } from "./server.ts";

const args = process.argv.slice(2);
const argOf = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(argOf("--port") ?? process.env.PORT ?? 3010);
const withDemo = args.includes("--demo");

const config = loadGameConfig();
const problems = validateGameConfig(config);
if (problems.length) {
  console.error("Cấu hình không hợp lệ, game không khởi động:\n- " + problems.join("\n- "));
  process.exit(1);
}

const game = createGame(config);
await game.provider.connect();
const ctl = createController({ game, config });
if (withDemo) ctl.handle({ type: "mock.demo", on: true });

// Chưa có provider LIVE thật: luôn hiển thị rõ đang ở chế độ mô phỏng, không giả vờ kết nối TikTok.
const stateMsg = () => {
  const d = ctl.dash();
  return { type: "state", now: Date.now(), provider: d.provider, session: ctl.state().session, overlay: ctl.state().overlay, snapshot: game.world.snapshot() };
};

const server = await startServer({
  port, root: new URL("../../", import.meta.url),
  onClient: (send) => send(stateMsg()),
  onControl: (conn) => {
    conn.send(ctl.configMsg());
    conn.send(ctl.dash());
    conn.onMessage((data) => {
      const id = (data as { id?: unknown } | null)?.id;
      const r = ctl.handle(data);
      conn.send({ type: "ack", id, ...r });
      if (r.ok && String((data as { type?: unknown } | null)?.type).startsWith("config.")) server.broadcastControl(ctl.configMsg());
      if (r.ok) server.broadcastControl(ctl.dash());
    });
  },
});
game.onGameEvent((event) => {
  server.broadcast({ type: "event", event });
  server.broadcastControl({ type: "event", event });
});

let last = Date.now(), n = 0;
const loop = setInterval(() => {
  try {
    const now = Date.now();
    const dt = Math.min(now - last, 500);
    last = now;
    ctl.tick(dt);
    server.broadcast(stateMsg());
    if (++n % 5 === 0) server.broadcastControl(ctl.dash());   // màn hình streamer cập nhật 2 lần/giây
  } catch (err) {
    console.error("Lỗi trong vòng lặp game (bỏ qua tick này):", err);
  }
}, 100);

console.log(`OFFICE LIFE đang chạy — CHẾ ĐỘ MÔ PHỎNG${withDemo ? " + kịch bản demo" : ""}`);
console.log(`Màn hình streamer: http://localhost:${server.port}/dashboard`);
console.log(`Mở trong OBS (Browser Source 1920×1080): http://localhost:${server.port}/game`);

const stop = async () => { clearInterval(loop); await server.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
