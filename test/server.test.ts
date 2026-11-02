import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { WebSocket } from "ws";
import { startServer } from "../src/server/server.ts";

const controlSeen: unknown[] = [];
const server = await startServer({
  port: 0, root: new URL("../", import.meta.url),
  onClient: (send) => send({ type: "hello" }),
  onControl: (c) => { c.send({ type: "hello-control" }); c.onMessage((d) => { controlSeen.push(d); c.send({ type: "ack", got: d }); }); },
});
after(() => server.close());
const base = `http://127.0.0.1:${server.port}`;

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port: server.port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode!, type: String(res.headers["content-type"]), body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", fail);
    req.end();
  });
}
function connect(origin?: string, path = "/ws"): Promise<{ ws: WebSocket; first?: unknown; rejected?: number }> {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, { headers: origin ? { Origin: origin } : {} });
    ws.once("message", (d) => ok({ ws, first: JSON.parse(String(d)) }));
    ws.once("unexpected-response", (_req, res) => ok({ ws, rejected: res.statusCode }));
    ws.once("error", () => ok({ ws, rejected: 0 }));
  });
}

test("/game trả trang HTML nạp Phaser và mã web", async () => {
  const r = await get("/game");
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.ok(r.body.includes("/vendor/phaser.min.js") && r.body.includes("/web/game/main.ts"));
});

test("/ chuyển về /game", async () => {
  const r = await new Promise<number>((ok) => request({ host: "127.0.0.1", port: server.port, path: "/" }, (res) => { res.resume(); ok(res.statusCode!); }).end());
  assert.equal(r, 302);
});

test("mã TypeScript phía web được gỡ kiểu và gửi như JavaScript", async () => {
  const r = await get("/web/game/main.ts");
  assert.equal(r.status, 200);
  assert.match(r.type, /javascript/);
  assert.ok(!r.body.includes("declare const Phaser"));
  assert.ok(r.body.includes("class OfficeScene extends Phaser.Scene"));
});

test("phục vụ asset và Phaser", async () => {
  assert.equal((await get("/assets/sprites/char_employee_01.png")).type, "image/png");
  assert.match((await get("/assets/map/office_main_floor.json")).type, /json/);
  assert.equal((await get("/vendor/phaser.min.js")).status, 200);
  assert.equal((await get("/assets/khong-co.png")).status, 404);
});

test("không đọc được file ngoài thư mục cho phép", async () => {
  for (const p of ["/assets/../package.json", "/assets/%2e%2e/package.json", "/assets/..%2fpackage.json", "/web/..%2f..%2fpackage.json", "/package.json", "/src/server/main.ts"]) {
    const r = await get(p);
    assert.notEqual(r.status, 200, p);
    assert.ok(!r.body.includes('"name": "office-life"'), p);
  }
});

test("từ chối Host lạ và phương thức khác GET", async () => {
  assert.equal((await get("/game", { Host: "evil.example" })).status, 403);
  const post = await new Promise<number>((ok) => request({ host: "127.0.0.1", port: server.port, path: "/game", method: "POST" }, (res) => { res.resume(); ok(res.statusCode!); }).end());
  assert.equal(post, 405);
});

test("/dashboard và mã web của nó được phục vụ như HTML/JS", async () => {
  const page = await get("/dashboard");
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.ok(page.body.includes("/web/dashboard/main.ts"));
  const js = await get("/web/dashboard/main.ts");
  assert.match(js.type, /javascript/);
  assert.ok(js.body.includes("function buildShell") && !js.body.includes("type Any"));
  assert.match((await get("/web/dashboard/dashboard.css")).type, /css/);
});

test("kênh /control: nhận và trả tin; Origin lạ bị từ chối; /ws không điều khiển được", async () => {
  const c = await connect(base, "/control");
  assert.deepEqual(c.first, { type: "hello-control" });
  const reply = new Promise((ok) => c.ws.once("message", (d) => ok(JSON.parse(String(d)))));
  c.ws.send(JSON.stringify({ type: "session", action: "start", id: 1 }));
  assert.deepEqual(await reply, { type: "ack", got: { type: "session", action: "start", id: 1 } });
  c.ws.send("không phải JSON");
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(controlSeen.at(-1), undefined);                       // JSON hỏng được đưa vào dưới dạng undefined, không làm sập server
  await new Promise((ok) => { c.ws.once("close", ok); c.ws.close(); });

  assert.equal((await connect("http://evil.example", "/control")).rejected, 403);

  const before = controlSeen.length;
  const viewer = await connect(base, "/ws");
  viewer.ws.send(JSON.stringify({ type: "mock.gift", count: 999 }));
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(controlSeen.length, before);                          // trang game chỉ để xem, không gửi lệnh được
  assert.equal(viewer.ws.readyState, 1);
  await new Promise((ok) => { viewer.ws.once("close", ok); viewer.ws.close(); });
});

test("WebSocket: nhận gói chào, nhận broadcast; Origin lạ bị từ chối", async () => {
  const good = await connect(base);
  assert.deepEqual(good.first, { type: "hello" });
  const next = new Promise((ok) => good.ws.once("message", (d) => ok(JSON.parse(String(d)))));
  server.broadcast({ type: "state", n: 1 });
  assert.deepEqual(await next, { type: "state", n: 1 });
  assert.equal(server.clients(), 1);
  good.ws.close();
  const bad = await connect("http://evil.example");
  assert.equal(bad.rejected, 403);
});
