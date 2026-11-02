export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Doorway extends Pt { connectsTo: string }
export interface Room {
  id: string; name: string; bounds: Rect; capacity: number;
  spawnPoints: Pt[]; doorways: Doorway[]; interactiveObjects: string[];
}
export interface MapObject {
  id: string; room: string; type: string; action: string;
  block?: Rect;    // ô bị chiếm (collision); thiếu nghĩa là đi xuyên được
  stands: Pt[];    // ô đứng để tương tác
}
export interface EscapeRoute {
  id: string; name: string; risk: "high" | "medium" | "low";
  start: Pt; waypoints: Pt[]; exit: string;
}
export interface MapData {
  mapId: string; tileSize: number; width: number; height: number;
  collision: string[]; // '#' = chặn, '.' = đi được
  rooms: Room[]; objects: MapObject[];
  zones: {
    safe: (Rect & { id: string })[]; vision: (Rect & { id: string })[]; noise: (Rect & { id: string })[];
    hide: (Pt & { id: string })[]; checkpoint: (Pt & { id: string })[];
  };
  escapeRoutes: EscapeRoute[];
  patrolRoutes: { id: string; waypoints: Pt[] }[];
}

export interface Grid { width: number; height: number; walkable(x: number, y: number): boolean }

export function loadGrid(map: { collision: string[] }): Grid {
  const height = map.collision.length;
  const width = map.collision[0]?.length ?? 0;
  const open = new Uint8Array(width * height);
  map.collision.forEach((row, y) => {
    if (row.length !== width) throw new Error(`hàng collision ${y} sai độ dài`);
    for (let x = 0; x < width; x++) open[y * width + x] = row[x] === "#" ? 0 : 1;
  });
  return { width, height, walkable: (x, y) => x >= 0 && y >= 0 && x < width && y < height && open[y * width + x] === 1 };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A* 8 hướng, không cắt góc qua ô chặn. Trả về cả điểm đầu và cuối, hoặc null nếu không tới được.
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] | null {
  if (!g.walkable(from.x, from.y) || !g.walkable(to.x, to.y)) return null;
  const W = g.width, N = W * g.height;
  const cost = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const start = from.y * W + from.x, goal = to.y * W + to.x;
  const h = (i: number) => {
    const dx = Math.abs((i % W) - to.x), dy = Math.abs(Math.floor(i / W) - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  // Heap nhị phân lưu (khóa, ô); ô có thể vào nhiều lần, bỏ bản cũ khi lấy ra.
  const hk: number[] = [], hi: number[] = [];
  const push = (k: number, i: number) => {
    let c = hk.length; hk.push(k); hi.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hk[p] <= hk[c]) break;
      [hk[p], hk[c]] = [hk[c], hk[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p;
    }
  };
  const pop = () => {
    const top = hi[0], lk = hk.pop()!, li = hi.pop()!;
    if (hk.length) {
      hk[0] = lk; hi[0] = li;
      for (let p = 0; ;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (r < hk.length && hk[r] < hk[m]) m = r;
        if (m === p) break;
        [hk[p], hk[m]] = [hk[m], hk[p]]; [hi[p], hi[m]] = [hi[m], hi[p]]; p = m;
      }
    }
    return top;
  };

  cost[start] = 0; push(h(start), start);
  while (hk.length) {
    const cur = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % W, cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!g.walkable(nx, ny)) continue;
      if (dx && dy && (!g.walkable(cx + dx, cy) || !g.walkable(cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (done[ni]) continue;
      const nc = cost[cur] + (dx && dy ? Math.SQRT2 : 1);
      if (nc < cost[ni]) { cost[ni] = nc; parent[ni] = cur; push(nc + h(ni), ni); }
    }
  }
  if (!done[goal]) return null;
  const path: Pt[] = [];
  for (let i = goal; i !== -1; i = parent[i]) path.push({ x: i % W, y: Math.floor(i / W) });
  return path.reverse();
}

// Nối các chặng liên tiếp; null nếu một chặng không đi được.
export function findRoute(g: Grid, points: Pt[]): Pt[] | null {
  const out: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const leg = findPath(g, points[i - 1], points[i]);
    if (!leg) return null;
    out.push(...(i === 1 ? leg : leg.slice(1)));
  }
  return out;
}

export function pathCost(path: Pt[]): number {
  let c = 0;
  for (let i = 1; i < path.length; i++) c += path[i].x !== path[i - 1].x && path[i].y !== path[i - 1].y ? Math.SQRT2 : 1;
  return c;
}
