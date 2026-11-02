// Sinh asset GIỮ CHỖ (placeholder) đúng khuôn: sprite sheet 32×48 theo ANIMATION_SPEC + tileset 32×32.
// Thay bằng art thật chỉ cần ghi đè file cùng tên. Chạy: npm run assets
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng } from "./png.ts";

type RGBA = [number, number, number, number];
const hex = (s: string): RGBA => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
const shade = (c: RGBA, k: number): RGBA => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), c[3]];

class Img {
  w: number; h: number; px: Uint8Array;
  clip: { x: number; y: number; w: number; h: number };
  constructor(w: number, h: number) {
    this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4); this.clip = { x: 0, y: 0, w, h };
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    const k = this.clip;
    const x0 = Math.max(k.x, Math.round(x)), x1 = Math.min(k.x + k.w, Math.round(x) + w);
    const y0 = Math.max(k.y, Math.round(y)), y1 = Math.min(k.y + k.h, Math.round(y) + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px.set(c, (yy * this.w + xx) * 4);
  }
}

// ---------- Nhân vật ----------
interface Look {
  skin: string; hair: string; shirt: string; pants: string; shoes: string;
  style: "short" | "long" | "bun" | "cap" | "hood";
  glasses?: boolean; tie?: string; badge?: string; trim?: string;
}
interface Pose { bob: number; crouch: number; dx: number; swing: number; armL: number; armR: number; up: boolean; closed: boolean; cup: boolean }

function pose(anim: string, f: number, n: number): Pose {
  const p: Pose = { bob: 0, crouch: 0, dx: 0, swing: 0, armL: 0, armR: 0, up: false, closed: false, cup: false };
  const s = Math.sin((f / n) * Math.PI * 2);
  switch (anim.replace(/_(down|up|left|right)$/, "")) {
    case "idle": p.bob = f % 2; break;
    case "walk": p.swing = Math.round(s * 3); p.armL = -p.swing; p.armR = p.swing; p.bob = f % 2 ? -1 : 0; break;
    case "work": p.armL = f % 2 ? -3 : -6; p.armR = f % 2 ? -6 : -3; break;
    case "coffee": p.cup = true; p.bob = f >= 2 ? -1 : 0; break;
    case "sleep": p.closed = true; p.crouch = 2; p.dx = f % 2 ? 1 : 0; break;
    case "sneak": p.crouch = 4; p.swing = Math.round(s * 2); p.armL = -p.swing; p.armR = p.swing; break;
    case "run": p.swing = Math.round(s * 4); p.armL = -p.swing; p.armR = p.swing; p.dx = 1; p.bob = f % 2 ? -1 : 0; break;
    case "caught": p.up = true; p.dx = f % 2 ? 1 : -1; break;
    case "celebrate": p.up = true; p.bob = f % 2 ? -4 : 0; break;
    case "dance": p.dx = Math.round(s * 2); p.armL = f % 2 ? -8 : 0; p.armR = f % 2 ? 0 : -8; p.bob = f % 2 ? -1 : 0; break;
  }
  return p;
}

function drawChar(img: Img, ox: number, oy: number, L: Look, dir: string, p: Pose) {
  img.clip = { x: ox, y: oy, w: 32, h: 48 };
  const X = ox + p.dx, Y = oy + 2 + p.bob + p.crouch;
  const skin = hex(L.skin), hair = hex(L.hair), shirt = hex(L.shirt), pants = hex(L.pants), shoes = hex(L.shoes);
  const dark = shade(shirt, 0.8), eye = hex("#1f1f2e"), side = dir === "left" || dir === "right";
  const faceX = side ? 11 : 10, faceW = side ? 10 : 12;

  img.rect(ox + 8, oy + 45, 16, 3, [0, 0, 0, 70]); // bóng đổ
  const legTop = Y + 33, legH = 11 - p.crouch;
  const leg = (x: number, lift: number) => {
    img.rect(X + x, legTop, 4, legH - lift, pants);
    img.rect(X + x, legTop + legH - lift - 2, 4, 2, shoes);
  };
  leg(side ? 13 : 11, Math.max(0, -p.swing));
  leg(side ? 15 : 17, Math.max(0, p.swing));

  img.rect(X + faceX, Y + 20, faceW, 13, shirt);
  if (L.trim) img.rect(X + faceX, Y + 20, faceW, 2, hex(L.trim));
  if (L.tie && dir === "down") img.rect(X + 15, Y + 22, 2, 9, hex(L.tie));
  if (L.badge && dir !== "up") img.rect(X + (side ? 17 : 18), Y + 24, 3, 3, hex(L.badge));

  const arm = (x: number, off: number) => {
    img.rect(X + x, Y + 21 + off, 3, 10, dark);
    img.rect(X + x, Y + 30 + off, 3, 2, skin);
  };
  if (p.up) {
    for (const x of [6, 23]) { img.rect(X + x, Y + 8, 3, 13, dark); img.rect(X + x, Y + 6, 3, 3, skin); }
  } else if (side) arm(14, p.armL);
  else { arm(7, p.armL); arm(22, p.armR); }
  if (p.cup) {
    img.rect(X + 22, Y + 17, 3, 10, dark);
    img.rect(X + 24, Y + 13, 5, 6, hex("#f4f4f4"));
    img.rect(X + 25, Y + 14, 3, 2, hex("#7a4a2a"));
  }

  // đầu
  if (L.style === "hood") img.rect(X + faceX - 2, Y + 6, faceW + 4, 15, shirt);
  img.rect(X + faceX, Y + 8, faceW, 12, skin);
  const back = dir === "left" ? 16 : 10;
  const topHair = () => img.rect(X + 9, Y + 6, 14, 5, hair);
  if (L.style !== "cap") {
    if (dir === "up") img.rect(X + 9, Y + 6, 14, L.style === "long" ? 20 : 14, hair);
    else if (side) { topHair(); img.rect(X + back, Y + 6, 6, L.style === "long" ? 17 : 13, hair); }
    else {
      topHair();
      img.rect(X + 9, Y + 6, 2, L.style === "long" ? 17 : 8, hair);
      img.rect(X + 21, Y + 6, 2, L.style === "long" ? 17 : 8, hair);
    }
    if (L.style === "bun") img.rect(X + 13, Y + 3, 6, 4, hair);
    if (L.style === "hood") img.rect(X + 10, Y + 8, 12, 3, hair);
  } else {
    const cap = hex(L.trim ?? "#223a6b");
    img.rect(X + 9, Y + 5, 14, 5, cap);
    if (dir === "down") img.rect(X + 8, Y + 9, 16, 2, shade(cap, 0.75));
    if (dir === "left") img.rect(X + 6, Y + 9, 8, 2, shade(cap, 0.75));
    if (dir === "right") img.rect(X + 18, Y + 9, 8, 2, shade(cap, 0.75));
    if (dir === "up") img.rect(X + 9, Y + 5, 14, 14, cap);
  }
  // mặt
  if (dir !== "up") {
    const eyes = dir === "down" ? [13, 18] : [dir === "left" ? 12 : 19];
    if (L.glasses && dir === "down") {
      for (const gx of [11, 17]) { img.rect(X + gx, Y + 12, 5, 4, hex("#2a2a3a")); img.rect(X + gx + 1, Y + 13, 3, 2, skin); }
    }
    for (const ex of eyes) {
      if (p.closed) img.rect(X + ex, Y + 14, 3, 1, eye);
      else img.rect(X + ex, Y + 13, 2, 2, eye);
    }
    if (dir === "down") img.rect(X + 15, Y + 17, 2, 1, hex("#9a5a50"));
  }
}

const LOOKS: Record<string, Look> = {
  char_employee_01: { skin: "#e0ac82", hair: "#3b2a20", shirt: "#5b8fd6", pants: "#2e3f66", shoes: "#2a2a2a", style: "short" },
  char_employee_02: { skin: "#f1c9a5", hair: "#16161d", shirt: "#e8a0b4", pants: "#6b6b78", shoes: "#4a2f2f", style: "long" },
  char_developer_01: { skin: "#d9a273", hair: "#5a3b22", shirt: "#4f7a5a", pants: "#3a3a44", shoes: "#d0d0d0", style: "hood", glasses: true },
  char_designer_01: { skin: "#f0c8a0", hair: "#8d4fb5", shirt: "#f2a63a", pants: "#4a4a6a", shoes: "#8a3a3a", style: "bun" },
  char_manager_01: { skin: "#d8a47a", hair: "#2a2a2a", shirt: "#4a4f5c", pants: "#2c2f38", shoes: "#111111", style: "short", tie: "#c0392b", trim: "#e8e8e8" },
  npc_security_01: { skin: "#d9a273", hair: "#2a2a2a", shirt: "#26407a", pants: "#1b2a50", shoes: "#111111", style: "cap", trim: "#1e3366", badge: "#f1c40f" },
  npc_reception_01: { skin: "#f1c9a5", hair: "#6a3b2a", shirt: "#f4f4f4", pants: "#2e6f73", shoes: "#2a2a2a", style: "bun", trim: "#2e9aa0" },
};

// [tên, số frame, fps, loop] theo ANIMATION_SPEC.md; mỗi animation một hàng trong sheet.
const ANIMS: [string, number, number, boolean][] = [
  ...(["down", "up", "left", "right"] as const).map((d): [string, number, number, boolean] => [`idle_${d}`, 2, 4, true]),
  ...(["down", "up", "left", "right"] as const).map((d): [string, number, number, boolean] => [`walk_${d}`, 4, 8, true]),
  ["work", 4, 6, true], ["coffee", 4, 5, true], ["sleep", 4, 4, true], ["sneak", 4, 7, true],
  ["run", 6, 10, true], ["caught", 4, 5, false], ["celebrate", 6, 8, true], ["dance", 6, 8, true],
];
const COLS = 6;

function dirFor(name: string): string {
  const m = name.match(/_(down|up|left|right)$/);
  if (m) return m[1];
  return name === "sneak" || name === "run" ? "right" : "down"; // sneak/run không có hướng: vẽ nghiêng phải, client lật khi đi trái
}

const out = new URL("../assets/", import.meta.url);
mkdirSync(new URL("sprites/", out), { recursive: true });
mkdirSync(new URL("tiles/", out), { recursive: true });

for (const [file, look] of Object.entries(LOOKS)) {
  const img = new Img(COLS * 32, ANIMS.length * 48);
  ANIMS.forEach(([name, frames], row) => {
    for (let f = 0; f < frames; f++) drawChar(img, f * 32, row * 48, look, dirFor(name), pose(name, f, frames));
  });
  writeFileSync(new URL(`sprites/${file}.png`, out), encodePng(img.w, img.h, img.px));
  writeFileSync(new URL(`sprites/${file}.json`, out), JSON.stringify({
    characterId: file.replace(/^(char|npc)_/, ""), file: `${file}.png`, frameWidth: 32, frameHeight: 48, columns: COLS,
    anims: ANIMS.map(([name, frames, fps, loop], row) => ({ name, row, frames, fps, loop })),
  }, null, 1) + "\n");
}

// ---------- Tileset: 0 hành lang, 1 tường, 2-9 sàn từng phòng, 10-14 đồ vật ----------
const tiles = new Img(15 * 32, 32);
const floor = (i: number, a: string, b: string) => {
  tiles.clip = { x: i * 32, y: 0, w: 32, h: 32 };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tiles.rect(i * 32 + x * 4, y * 4, 4, 4, hex((x + y) % 2 ? a : b));
};
const T = (i: number) => { tiles.clip = { x: i * 32, y: 0, w: 32, h: 32 }; return i * 32; };
floor(0, "#cfd3da", "#c6cad2");
floor(2, "#e8d8b8", "#e0cfab"); floor(3, "#cfe0ea", "#c4d7e3"); floor(4, "#d4e8d2", "#c9dfc7"); floor(5, "#dcd0ee", "#d2c5e8");
floor(6, "#f3d9c4", "#ecceb5"); floor(7, "#f1ecc4", "#e9e3b6"); floor(8, "#b98c64", "#af825a"); floor(9, "#aab6c4", "#a1adbb");
{ // tường
  const o = T(1);
  tiles.rect(o, 0, 32, 32, hex("#3a3f55"));
  tiles.rect(o, 0, 32, 8, hex("#5a617d"));
  tiles.rect(o, 30, 32, 2, hex("#2a2e40"));
  for (let y = 8; y < 32; y += 8) tiles.rect(o, y, 32, 1, hex("#2f3448"));
}
{ // bàn làm việc: mặt bàn + màn hình + bàn phím
  const o = T(10);
  tiles.rect(o, 0, 32, 32, hex("#8a5a35")); tiles.rect(o, 0, 32, 3, hex("#a8754a"));
  tiles.rect(o + 9, 4, 14, 10, hex("#22252e")); tiles.rect(o + 10, 5, 12, 8, hex("#5fb4ff")); tiles.rect(o + 14, 14, 4, 3, hex("#22252e"));
  tiles.rect(o + 9, 20, 14, 5, hex("#d9d9d9"));
}
{ // bàn họp
  const o = T(11);
  tiles.rect(o, 0, 32, 32, hex("#a06a3c")); tiles.rect(o + 2, 2, 28, 28, hex("#b57b4a"));
  tiles.rect(o + 6, 12, 8, 6, hex("#e9e2d0"));
}
{ // máy (arcade / cà phê)
  const o = T(12);
  tiles.rect(o, 0, 32, 32, hex("#4a4f5c")); tiles.rect(o + 5, 4, 22, 13, hex("#2b2f3a"));
  tiles.rect(o + 22, 7, 4, 3, hex("#e3503e")); tiles.rect(o + 7, 20, 18, 8, hex("#1e2128"));
}
{ // máy tính nhân sự
  const o = T(13);
  tiles.rect(o, 0, 32, 32, hex("#2c3e63")); tiles.rect(o + 5, 5, 22, 15, hex("#69c3ff")); tiles.rect(o + 5, 23, 22, 5, hex("#8fa4c8"));
}
{ // điểm thoát sân thượng: viền sọc vàng đen
  const o = T(14);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) tiles.rect(o + x, y, 1, 1, ((x + y) >> 2) & 1 ? hex("#f1c40f") : hex("#222222"));
  tiles.rect(o + 6, 6, 20, 20, hex("#aab6c4"));
}
writeFileSync(new URL("tiles/tiles.png", out), encodePng(tiles.w, tiles.h, tiles.px));
console.log("đã ghi sprite + tileset vào", out.pathname);
