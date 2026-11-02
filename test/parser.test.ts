import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createParser } from "../src/core/commands/parser.ts";
import { normalizeText } from "../src/core/commands/normalizeText.ts";

const cfg = JSON.parse(readFileSync(new URL("../config/commands.json", import.meta.url), "utf8"));
const parser = createParser(cfg.commands);

test("normalizeText bỏ dấu, đ→d, hạ chữ, gộp khoảng trắng", () => {
  assert.equal(normalizeText("  ĐI   Làm!! "), "di lam");
  assert.equal(normalizeText("Đi uống Cà Phê 😀"), "di uong ca phe");
});

test("mọi lệnh mặc định khớp, có dấu, không dấu, hoa thường, khoảng trắng thừa", () => {
  for (const c of cfg.commands) {
    for (const a of c.aliases) {
      assert.equal(parser.parse(a)?.id, c.id, a);
      assert.equal(parser.parse(`  ${a.toUpperCase()}  `)?.id, c.id, a);
      assert.equal(parser.parse(normalizeText(a))?.id, c.id, a);
    }
  }
  assert.equal(parser.parse("di lam")?.id, "work");
});

test("trả về group của lệnh", () => {
  assert.equal(parser.parse("trốn việc")?.group, "escape");
});

test("không fuzzy: câu dài hoặc gần giống không khớp", () => {
  assert.equal(parser.parse("đi làm đi"), null);
  assert.equal(parser.parse("hôm nay tôi đi làm"), null);
  assert.equal(parser.parse("di lm"), null);
  assert.equal(parser.parse("!work"), null);
  assert.equal(parser.parse(""), null);
});

test("alias trùng giữa hai lệnh bị từ chối khi dựng parser", () => {
  assert.throws(() => createParser([
    { id: "a", group: "g", aliases: ["đi làm"] },
    { id: "b", group: "g", aliases: ["Di Lam"] },
  ]));
});
