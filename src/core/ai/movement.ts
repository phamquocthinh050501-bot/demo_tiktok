export type Dir = "down" | "up" | "left" | "right";

export const dirOf = (dx: number, dy: number): Dir =>
  Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");

// Đi dọc path với tốc độ tile/giây; trả về vector bước cuối (để đặt hướng) hoặc null nếu không nhúc nhích.
export function stepAlong(
  w: { x: number; y: number; path: { x: number; y: number }[]; pathIdx: number },
  speed: number, dtMs: number,
): { dx: number; dy: number } | null {
  let budget = (speed * dtMs) / 1000;
  let last: { dx: number; dy: number } | null = null;
  while (budget > 0 && w.pathIdx < w.path.length) {
    const t = w.path[w.pathIdx];
    const dx = t.x - w.x, dy = t.y - w.y, dist = Math.hypot(dx, dy);
    if (dist > 0) last = { dx, dy };
    if (dist <= budget) { w.x = t.x; w.y = t.y; budget -= dist; w.pathIdx++; }
    else { w.x += (dx / dist) * budget; w.y += (dy / dist) * budget; budget = 0; }
  }
  return last;
}
