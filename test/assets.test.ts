import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { decodePng } from "../tools/png.ts";

const dir = new URL("../assets/", import.meta.url);
const file = (p: string) => new URL(p, dir);
const SHEETS = [
  "char_employee_01", "char_employee_02", "char_developer_01", "char_designer_01", "char_manager_01",
  "npc_security_01", "npc_reception_01",
];
const SPEC_ANIMS = [
  "idle_down", "idle_up", "idle_left", "idle_right", "walk_down", "walk_up", "walk_left", "walk_right",
  "work", "coffee", "sleep", "sneak", "run", "caught", "celebrate", "dance",
];
const SPEC_FRAMES: Record<string, [number, number, boolean]> = {   // [frames, fps, loop] theo ANIMATION_SPEC.md
  idle: [2, 4, true], walk: [4, 8, true], work: [4, 6, true], coffee: [4, 5, true], sleep: [4, 4, true],
  sneak: [4, 7, true], run: [6, 10, true], caught: [4, 5, false], celebrate: [6, 8, true], dance: [6, 8, true],
};

test("đủ 7 sprite sheet + metadata, tên snake_case không dấu", () => {
  for (const s of SHEETS) {
    assert.match(s, /^[a-z0-9_]+$/);
    assert.ok(existsSync(file(`sprites/${s}.png`)), s);
    assert.ok(existsSync(file(`sprites/${s}.json`)), s);
  }
});

test("metadata khớp ANIMATION_SPEC: đủ 16 animation, số frame/fps/loop đúng", () => {
  for (const s of SHEETS) {
    const meta = JSON.parse(readFileSync(file(`sprites/${s}.json`), "utf8"));
    assert.equal(meta.file, `${s}.png`);
    assert.deepEqual([meta.frameWidth, meta.frameHeight], [32, 48]);
    assert.deepEqual(meta.anims.map((a: { name: string }) => a.name), SPEC_ANIMS);
    for (const a of meta.anims) {
      const [frames, fps, loop] = SPEC_FRAMES[a.name.replace(/_(down|up|left|right)$/, "")];
      assert.deepEqual([a.frames, a.fps, a.loop], [frames, fps, loop], `${s}/${a.name}`);
    }
  }
});

test("PNG đúng kích thước lưới frame và mỗi frame có hình, các frame của một animation khác nhau", () => {
  for (const s of SHEETS) {
    const meta = JSON.parse(readFileSync(file(`sprites/${s}.json`), "utf8"));
    const { w, h, rgba } = decodePng(readFileSync(file(`sprites/${s}.png`)));
    assert.deepEqual([w, h], [meta.columns * 32, meta.anims.length * 48]);
    const frame = (row: number, col: number) => {
      const out: number[] = [];
      for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
        const i = ((row * 48 + y) * w + col * 32 + x) * 4;
        out.push(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
      }
      return out;
    };
    meta.anims.forEach((a: { name: string; row: number; frames: number }) => {
      const set = new Set<string>();
      for (let f = 0; f < a.frames; f++) {
        const px = frame(a.row, f);
        assert.ok(px.some((v, i) => i % 4 === 3 && v === 255), `${s}/${a.name}#${f} trống`);
        set.add(px.join(","));
      }
      assert.ok(set.size > 1, `${s}/${a.name}: các frame giống hệt nhau`);
    });
  }
});

test("tileset 15 ô 32×32", () => {
  const { w, h } = decodePng(readFileSync(file("tiles/tiles.png")));
  assert.deepEqual([w, h], [15 * 32, 32]);
});
