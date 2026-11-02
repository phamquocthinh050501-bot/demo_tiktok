import { findPath, findRoute, loadGrid } from "./grid.ts";
import type { MapData, Pt } from "./grid.ts";

const ROOM_IDS = ["lobby", "workspace", "meeting", "gaming", "break", "hr", "director", "rooftop"];
const NEED_TWO_DOORS = ["workspace", "hr", "director", "rooftop"]; // phòng nằm trên tuyến trốn
const MIN_CORRIDOR = 3;

// Trả về danh sách lỗi (rỗng nghĩa là hợp lệ). Dùng cho test và khi nạp map.
export function validateMap(m: MapData): string[] {
  const errs: string[] = [];
  const g = loadGrid(m);
  if (g.height !== m.height || g.width !== m.width) errs.push("kích thước collision không khớp width/height");

  const byId = new Map(m.rooms.map((r) => [r.id, r]));
  for (const id of ROOM_IDS) if (!byId.has(id)) errs.push(`thiếu phòng ${id}`);
  const lobby = byId.get("lobby");
  const origin = lobby?.spawnPoints[0];
  if (!origin || !g.walkable(origin.x, origin.y)) return [...errs, "điểm spawn Lobby không hợp lệ"];

  for (const r of m.rooms) {
    const b = r.bounds;
    if (b.x < 0 || b.y < 0 || b.x + b.w > m.width || b.y + b.h > m.height) errs.push(`${r.id} vượt ra ngoài map`);
  }
  // Hai phòng liền nhau chỉ được chung đúng một dòng tường (hoặc sát nhau); còn lại phải cách nhau một hành lang ≥ MIN_CORRIDOR.
  for (let i = 0; i < m.rooms.length; i++) {
    for (let j = i + 1; j < m.rooms.length; j++) {
      const a = m.rooms[i].bounds, b = m.rooms[j].bounds;
      const xGap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w); // < 0: trùng khoảng x
      const yGap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
      const pair = `${m.rooms[i].id}/${m.rooms[j].id}`;
      const narrow = (gap: number) => gap !== 0 && gap < MIN_CORRIDOR;
      if (xGap < 0 && yGap < 0) { if (xGap < -1 && yGap < -1) errs.push(`phòng chồng nhau: ${pair}`); }
      else if (xGap < 0 && narrow(yGap)) errs.push(`hành lang giữa ${pair} hẹp hơn ${MIN_CORRIDOR} tile`);
      else if (yGap < 0 && narrow(xGap)) errs.push(`hành lang giữa ${pair} hẹp hơn ${MIN_CORRIDOR} tile`);
    }
  }

  const reach = (p: Pt, label: string) => {
    if (!g.walkable(p.x, p.y)) errs.push(`${label} nằm trong collision hoặc ngoài map (${p.x},${p.y})`);
    else if (!findPath(g, origin, p)) errs.push(`${label} không tới được từ Lobby (${p.x},${p.y})`);
  };

  const objIds = new Set(m.objects.map((o) => o.id));
  for (const r of m.rooms) {
    if (!r.spawnPoints.length) errs.push(`${r.id} không có spawn`);
    r.spawnPoints.forEach((p, i) => reach(p, `spawn ${r.id}#${i}`));
    if (!r.doorways.length) errs.push(`${r.id} không có cửa`);
    if (NEED_TWO_DOORS.includes(r.id) && r.doorways.length < 2) errs.push(`${r.id} cần ít nhất 2 cửa`);
    r.doorways.forEach((d, i) => reach(d, `cửa ${r.id}#${i}`));
    for (const id of r.interactiveObjects) if (!objIds.has(id)) errs.push(`${r.id} tham chiếu object không có: ${id}`);
  }
  for (const o of m.objects) {
    if (!byId.has(o.room)) errs.push(`object ${o.id} thuộc phòng không có: ${o.room}`);
    if (!o.stands.length) errs.push(`object ${o.id} không có ô đứng`);
    o.stands.forEach((p, i) => reach(p, `ô đứng ${o.id}#${i}`));
  }
  for (const p of [...m.zones.hide, ...m.zones.checkpoint]) reach(p, `điểm ${p.id}`);

  if (m.escapeRoutes.length < 3) errs.push("cần ít nhất 3 tuyến trốn");
  for (const r of m.escapeRoutes) {
    const exit = m.objects.find((o) => o.id === r.exit);
    if (!exit) { errs.push(`tuyến ${r.id}: không có điểm thoát ${r.exit}`); continue; }
    if (!findRoute(g, [r.start, ...r.waypoints, exit.stands[0]])) errs.push(`tuyến ${r.id} không đi hết được từ đầu đến điểm thoát`);
  }
  for (const r of m.patrolRoutes) {
    if (!findRoute(g, [...r.waypoints, r.waypoints[0]])) errs.push(`tuyến tuần tra ${r.id} bị đứt`);
  }
  return errs;
}
