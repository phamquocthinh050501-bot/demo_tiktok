// Sinh assets/map/office_main_floor.json. Chạy: npm run map
// Bản đồ DỌC cho livestream điện thoại (khung 1080×1920): một tòa nhà 20×32 ô, nhân vật phóng to ~1,5 lần.
// Từ trên xuống: Sân thượng · Phòng họp | hành lang | Phòng giám đốc · Giải trí | hành lang | Nhân sự ·
// Phòng nghỉ | hành lang | góc máy in · Khu làm việc · Sảnh lễ tân. Hai phòng liền nhau dùng chung một dòng tường.
import { mkdirSync, writeFileSync } from "node:fs";
import type { MapData, MapObject, Pt, Rect, Room } from "../src/core/world/grid.ts";

const W = 20, H = 32;
const cells = Array.from({ length: H }, (_, y) =>
  Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? "#" : ".")));
const fill = (r: Rect, c: string) => {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells[y][x] = c;
};
const P = (x: number, y: number): Pt => ({ x, y });
const tiles = (...xy: [number, number][]) => xy.map(([x, y]) => P(x, y));

interface Def { id: string; name: string; b: Rect; capacity: number }
const defs: Def[] = [
  { id: "rooftop", name: "Sân thượng", b: { x: 0, y: 0, w: 20, h: 5 }, capacity: 24 },
  { id: "meeting", name: "Phòng họp", b: { x: 0, y: 4, w: 8, h: 6 }, capacity: 16 },
  { id: "director", name: "Phòng giám đốc", b: { x: 12, y: 4, w: 8, h: 6 }, capacity: 8 },
  { id: "gaming", name: "Phòng giải trí", b: { x: 0, y: 9, w: 8, h: 6 }, capacity: 12 },
  { id: "hr", name: "Phòng nhân sự", b: { x: 12, y: 9, w: 8, h: 6 }, capacity: 12 },
  { id: "break", name: "Phòng nghỉ", b: { x: 0, y: 14, w: 8, h: 6 }, capacity: 12 },
  { id: "workspace", name: "Khu làm việc", b: { x: 0, y: 19, w: 20, h: 8 }, capacity: 40 },
  { id: "lobby", name: "Sảnh lễ tân", b: { x: 0, y: 26, w: 20, h: 6 }, capacity: 60 },
];
// Hai lượt: dựng tường mọi phòng trước, rồi mới đục cửa (nếu không tường phòng sau sẽ lấp lại cửa của phòng trước).
for (const d of defs) {
  fill(d.b, "#");
  fill({ x: d.b.x + 1, y: d.b.y + 1, w: d.b.w - 2, h: d.b.h - 2 }, ".");
}

// Cửa rộng 2 ô. "hall" là hành lang giữa và góc máy in (không phải phòng).
const links: { a: string; b: string; at: Pt[] }[] = [
  { a: "rooftop", b: "meeting", at: tiles([2, 4], [3, 4]) },
  { a: "rooftop", b: "hall", at: tiles([9, 4], [10, 4]) },
  { a: "rooftop", b: "director", at: tiles([17, 4], [18, 4]) },
  { a: "meeting", b: "hall", at: tiles([7, 6], [7, 7]) },
  { a: "director", b: "hall", at: tiles([12, 6], [12, 7]) },
  { a: "meeting", b: "gaming", at: tiles([5, 9], [6, 9]) },
  { a: "director", b: "hr", at: tiles([13, 9], [14, 9]) },
  { a: "gaming", b: "hall", at: tiles([7, 11], [7, 12]) },
  { a: "hr", b: "hall", at: tiles([12, 11], [12, 12]) },
  { a: "gaming", b: "break", at: tiles([2, 14], [3, 14]) },
  { a: "hr", b: "hall", at: tiles([17, 14], [18, 14]) },
  { a: "break", b: "hall", at: tiles([7, 16], [7, 17]) },
  { a: "break", b: "workspace", at: tiles([5, 19], [6, 19]) },
  { a: "workspace", b: "hall", at: tiles([9, 19], [10, 19]) },
  { a: "workspace", b: "hall", at: tiles([13, 19], [14, 19]) },
  { a: "workspace", b: "lobby", at: tiles([9, 26], [10, 26]) },
];
const rooms: Room[] = defs.map((d) => ({
  id: d.id, name: d.name, bounds: d.b, capacity: d.capacity, spawnPoints: [], doorways: [], interactiveObjects: [],
}));
const room = (id: string) => rooms.find((r) => r.id === id);
for (const l of links) {
  for (const p of l.at) cells[p.y][p.x] = ".";
  for (const [id, other] of [[l.a, l.b], [l.b, l.a]]) {
    const r = room(id);
    if (r) for (const p of l.at) r.doorways.push({ ...p, connectsTo: other });
  }
}
// Spawn nội bộ: ô ngay trong cửa đầu tiên.
const inward = (b: Rect, p: Pt): Pt =>
  p.y === b.y ? P(p.x, p.y + 1) : p.y === b.y + b.h - 1 ? P(p.x, p.y - 1) : p.x === b.x ? P(p.x + 1, p.y) : P(p.x - 1, p.y);
for (const r of rooms) r.spawnPoints = [inward(r.bounds, r.doorways[0])];
room("lobby")!.spawnPoints = tiles([3, 29], [5, 30], [8, 29], [11, 30], [13, 29], [16, 30]);

const objects: MapObject[] = [];
const add = (o: MapObject) => {
  objects.push(o);
  room(o.room)!.interactiveObjects.push(o.id);
  if (o.block) fill(o.block, "#");
};
const pad = (n: number) => String(n).padStart(2, "0");

add({ id: "reception_desk", room: "lobby", type: "desk", action: "checkin", block: { x: 14, y: 28, w: 4, h: 1 }, stands: tiles([15, 29], [16, 29]) });
[21, 24].forEach((y, r) => [1, 4, 7, 10, 13, 16].forEach((x, c) =>
  add({ id: `work_desk_${pad(r * 6 + c + 1)}`, room: "workspace", type: "desk", action: "work", block: { x, y, w: 2, h: 1 }, stands: [P(x, y + 1)] })));
add({ id: "meeting_table", room: "meeting", type: "table", action: "meeting", block: { x: 2, y: 6, w: 3, h: 2 },
  stands: tiles([2, 5], [3, 5], [4, 5], [2, 8], [3, 8], [4, 8], [1, 6], [1, 7], [5, 6], [5, 7]) });
[1, 2, 3].forEach((x, i) =>
  add({ id: `arcade_machine_${pad(i + 1)}`, room: "gaming", type: "machine", action: "game", block: { x, y: 10, w: 1, h: 1 }, stands: [P(x, 11)] }));
add({ id: "coffee_machine", room: "break", type: "machine", action: "coffee", block: { x: 4, y: 15, w: 2, h: 1 }, stands: tiles([4, 16], [5, 16]) });
add({ id: "hr_terminal", room: "hr", type: "terminal", action: "view_rank", block: { x: 16, y: 10, w: 2, h: 1 }, stands: tiles([16, 11], [17, 11]) });
add({ id: "director_desk", room: "director", type: "desk", action: "ceremony", block: { x: 14, y: 6, w: 4, h: 1 }, stands: tiles([15, 7], [16, 7]) });
// Điểm thoát trên sân thượng: 01 giữa (đường hành lang), 02 phải (qua phòng giám đốc), 03 trái (vòng bên trái).
[[10, 2], [16, 2], [3, 2]].forEach(([x, y], i) =>
  add({ id: `roof_exit_${pad(i + 1)}`, room: "rooftop", type: "exit", action: "escape", stands: [P(x, y)] }));

const map: MapData = {
  mapId: "office_main_floor", tileSize: 32, width: W, height: H,
  collision: cells.map((r) => r.join("")),
  rooms, objects,
  zones: {
    safe: [{ id: "safe_lobby", x: 1, y: 27, w: 18, h: 4 }],
    vision: [
      { id: "cam_hall", x: 8, y: 5, w: 4, h: 14 },
      { id: "cam_right", x: 13, y: 5, w: 6, h: 14 },
      { id: "cam_left", x: 1, y: 5, w: 6, h: 14 },
    ],
    noise: [{ id: "noise_gaming", x: 1, y: 10, w: 6, h: 4 }],
    hide: [{ id: "hide_director", ...P(18, 8) }, { id: "hide_hr", ...P(18, 12) }, { id: "hide_break", ...P(1, 18) }],
    checkpoint: [{ id: "cp_left", ...P(1, 12) }, { id: "cp_hall", ...P(10, 12) }, { id: "cp_right", ...P(18, 12) }],
  },
  escapeRoutes: [
    { id: "route_short", name: "Thẳng qua hành lang", risk: "high", start: P(10, 22), exit: "roof_exit_01",
      waypoints: tiles([10, 20], [10, 12], [10, 5], [10, 3]) },
    { id: "route_hide", name: "Qua phòng giám đốc", risk: "medium", start: P(10, 22), exit: "roof_exit_02",
      waypoints: tiles([14, 20], [14, 18], [17, 15], [17, 13], [13, 10], [13, 8], [17, 5], [17, 3]) },
    { id: "route_long", name: "Vòng bên trái", risk: "low", start: P(10, 22), exit: "roof_exit_03",
      waypoints: tiles([5, 20], [5, 18], [1, 17], [3, 15], [3, 13], [6, 12], [5, 10], [5, 8], [1, 7], [2, 5], [2, 3]) },
  ],
  patrolRoutes: [
    { id: "guard_hall", waypoints: tiles([9, 6], [11, 6], [11, 17], [9, 17]) },
    { id: "guard_roof", waypoints: tiles([2, 2], [17, 2]) },
    { id: "guard_workspace", waypoints: tiles([2, 20], [8, 20]) },
  ],
};

// Mảng/đối tượng ngắn nằm trên một dòng để file dễ đọc và diff.
function ser(v: unknown, ind = ""): string {
  const flat = JSON.stringify(v);
  if (typeof v !== "object" || v === null || flat.length <= 100) return flat;
  const p = ind + "  ";
  if (Array.isArray(v)) return "[\n" + v.map((x) => p + ser(x, p)).join(",\n") + "\n" + ind + "]";
  return "{\n" + Object.entries(v).map(([k, x]) => `${p}${JSON.stringify(k)}: ${ser(x, p)}`).join(",\n") + "\n" + ind + "}";
}

const out = new URL("../assets/map/office_main_floor.json", import.meta.url);
mkdirSync(new URL("./", out), { recursive: true });
writeFileSync(out, ser(map) + "\n");
console.log("đã ghi", out.pathname);
