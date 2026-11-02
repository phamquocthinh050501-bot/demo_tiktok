// Renderer: chỉ VẼ trạng thái do server gửi (không tự quyết định kết quả, EXP hay bắt người).
declare const Phaser: any;

// Khung DỌC 9:16 cho livestream điện thoại: thanh thông tin ở đầu, bản đồ ở giữa, bảng tin và hướng dẫn ở cuối.
const TILE = 32, MAP_W = 20, MAP_H = 32;
const VIEW_W = 1080, VIEW_H = 1920;
const TOP_H = 150, BOTTOM_H = 220;
const MAP_VIEW_H = VIEW_H - TOP_H - BOTTOM_H;
const ZOOM = Math.min(VIEW_W / (MAP_W * TILE), MAP_VIEW_H / (MAP_H * TILE)); // phóng lớn để nhân vật đọc được trên điện thoại
const FONT = "'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
const CHAR_IDS = ["employee_01", "employee_02", "developer_01", "designer_01", "manager_01", "security_01", "reception_01"];
const SHEET = (id: string) => (id.endsWith("_01") && (id.startsWith("security") || id.startsWith("reception")) ? `npc_${id}` : `char_${id}`);
const ROOM_TILE: Record<string, number> = { lobby: 2, workspace: 3, meeting: 4, gaming: 5, break: 6, hr: 7, director: 8, rooftop: 9 };
const OBJ_TILE: Record<string, number> = { desk: 10, table: 11, machine: 12, terminal: 13 };
const RANK_COLOR: Record<string, string> = {
  "Thử việc": "#5f6368", "Nhân viên": "#2e7d32", "Nhân viên ưu tú": "#1565c0", "Trưởng nhóm": "#7b1fa2",
  "Trưởng phòng": "#e65100", "Phó giám đốc": "#ad1457", "Giám đốc": "#b8860b",
};
const BUSY = ["WALKING", "SNEAKING", "ESCAPING", "CAUGHT", "ESCAPED", "JOINING"];
const CROWDED_AT = 30;                                 // đông hơn thì chỉ hiện tên người đang hoạt động

const bus = new Phaser.Events.EventEmitter();
const px = (t: number) => (t + 0.5) * TILE;
const py = (t: number) => (t + 0.5) * TILE + 8;        // chân nhân vật hơi thấp hơn tâm ô
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- Kết nối tới game (tự nối lại, báo trạng thái) ----------
let retry = 500;
let online = false; // HUD đọc trạng thái này khi khởi tạo, vì sự kiện "conn" có thể bắn trước khi HUD kịp lắng nghe
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { retry = 500; online = true; bus.emit("conn", true); };
  ws.onmessage = (e) => {
    try { const m = JSON.parse(e.data); bus.emit(m.type, m.type === "event" ? m.event : m); } catch { /* bỏ qua gói lỗi */ }
  };
  ws.onclose = () => { online = false; bus.emit("conn", false); setTimeout(connect, retry); retry = Math.min(retry * 2, 8000); };
}

// ---------- Cảnh văn phòng ----------
class OfficeScene extends Phaser.Scene {
  views: Map<string, any> = new Map();
  fxAlive = 0;
  latest: any = null;

  constructor() { super("office"); }

  preload() {
    this.load.json("map", "/assets/map/office_main_floor.json");
    this.load.spritesheet("tiles", "/assets/tiles/tiles.png", { frameWidth: TILE, frameHeight: TILE });
    for (const id of CHAR_IDS) {
      this.load.spritesheet(id, `/assets/sprites/${SHEET(id)}.png`, { frameWidth: 32, frameHeight: 48 });
      this.load.json(`meta:${id}`, `/assets/sprites/${SHEET(id)}.json`);
    }
  }

  create() {
    const map = this.cache.json.get("map");
    this.buildFloor(map);
    for (const r of map.rooms) {
      this.add.text(r.bounds.x * TILE + 8, r.bounds.y * TILE + 6, r.name, { fontFamily: FONT, fontSize: "16px", color: "#ffffff", resolution: 2 }).setDepth(5);
    }
    for (const id of CHAR_IDS) {
      const meta = this.cache.json.get(`meta:${id}`);
      for (const a of meta.anims) {
        this.anims.create({
          key: `${id}:${a.name}`, frameRate: a.fps, repeat: a.loop ? -1 : 0,
          frames: this.anims.generateFrameNumbers(id, { start: a.row * meta.columns, end: a.row * meta.columns + a.frames - 1 }),
        });
      }
    }
    const cam = this.cameras.main;
    cam.setViewport((VIEW_W - MAP_W * TILE * ZOOM) / 2, TOP_H, MAP_W * TILE * ZOOM, MAP_VIEW_H);
    cam.setZoom(ZOOM);
    cam.centerOn((MAP_W * TILE) / 2, (MAP_H * TILE) / 2);   // vừa khít bản đồ, hai bên chừa lề

    // NPC lễ tân đứng sau quầy ở Sảnh.
    const rec = this.add.sprite(px(15.5), py(27), "reception_01").setOrigin(0.5, 0.92).setDepth(py(27));
    rec.play("reception_01:idle_down");
    this.tag(px(15.5), py(27), "Lễ tân", "#2e9aa0");

    bus.on("state", (m: any) => { this.latest = m; this.sync(m.snapshot); });
    bus.on("event", (e: any) => { if (e.kind === "fx") this.spawnFx(e.name, e.intensity); });
    this.scene.launch("hud");
  }

  buildFloor(map: any) {
    const inBlock = (x: number, y: number) =>
      map.objects.find((o: any) => o.block && x >= o.block.x && x < o.block.x + o.block.w && y >= o.block.y && y < o.block.y + o.block.h);
    const roomAt = (x: number, y: number) =>
      map.rooms.find((r: any) => x >= r.bounds.x && x < r.bounds.x + r.bounds.w && y >= r.bounds.y && y < r.bounds.y + r.bounds.h);
    const data: number[][] = [];
    for (let y = 0; y < MAP_H; y++) {
      const row: number[] = [];
      for (let x = 0; x < MAP_W; x++) {
        if (map.collision[y][x] === "#") row.push(OBJ_TILE[inBlock(x, y)?.type] ?? 1);
        else row.push(ROOM_TILE[roomAt(x, y)?.id] ?? 0);
      }
      data.push(row);
    }
    for (const o of map.objects) if (o.type === "exit") for (const s of o.stands) data[s.y][s.x] = 14;
    // Vẽ sàn một lần vào một ảnh duy nhất: co/giãn theo tỉ lệ lẻ không còn để hở khe giữa các ô.
    const floor = this.add.renderTexture(0, 0, MAP_W * TILE, MAP_H * TILE).setOrigin(0, 0);
    floor.beginDraw();
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) floor.batchDrawFrame("tiles", data[y][x], x * TILE, y * TILE);
    floor.endDraw();
  }

  tag(x: number, y: number, text: string, bg: string) {
    return this.add.text(x, y - 48, text, {
      fontFamily: FONT, fontSize: "19px", color: "#ffffff", backgroundColor: bg, padding: { x: 5, y: 1 }, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(100000);
  }

  animFor(kind: "avatar" | "guard", a: any, moving: boolean): [string, boolean] {
    const d = ["down", "up", "left", "right"].includes(a.dir) ? a.dir : "down";
    if (kind === "guard") {
      if (a.state === "CHASE") return ["run", d === "left"];
      if (a.state === "CAPTURE") return ["idle_down", false];
      return [moving ? `walk_${d}` : `idle_${d}`, false];
    }
    switch (a.state) {
      case "IDLE":
        if (a.activity === "dance") return ["dance", false];
        if (a.activity === "sleep") return ["sleep", false];
        return [`idle_${d}`, false];
      case "WALKING": return [`walk_${d}`, false];
      case "WORKING": return ["work", false];
      case "BREAKING": return ["coffee", false];
      case "SNEAKING": return ["sneak", d === "left"];
      case "ESCAPING": return ["run", d === "left"];
      case "CAUGHT": return ["caught", false];
      case "ESCAPED": return ["celebrate", false];
      case "AFK": return ["sleep", false];
      default: return ["idle_down", false];
    }
  }

  iconFor(kind: "avatar" | "guard", a: any): string {
    if (kind === "guard") return a.state === "CHASE" || a.state === "CAPTURE" ? "!" : a.state === "INVESTIGATE" ? "?" : "";
    if (a.state === "ESCAPING") return "!";
    if (a.state === "CAUGHT") return "✖";
    if (a.state === "ESCAPED") return "★";
    if (a.state === "AFK" || a.activity === "sleep") return "z";
    if (a.activity === "dance") return "♪";
    return "";
  }

  // Đồng bộ view với snapshot mới nhất; vị trí được nội suy trong update().
  sync(snap: any) {
    const crowded = snap.avatars.length > CROWDED_AT;
    const seen = new Set<string>();
    const upsert = (key: string, kind: "avatar" | "guard", a: any, texture: string, name: string, bg: string, showTag: boolean) => {
      seen.add(key);
      let v = this.views.get(key);
      if (!v) {
        const sprite = this.add.sprite(px(a.x), py(a.y), texture).setOrigin(0.5, 0.92);
        v = { sprite, tag: this.tag(px(a.x), py(a.y), name, bg), icon: this.add.text(0, 0, "", { fontFamily: FONT, fontSize: "26px", fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 4, resolution: 2 }).setOrigin(0.5, 1).setDepth(100001), anim: "", bg, name, px: a.x, py: a.y };
        this.views.set(key, v);
      }
      const moving = Math.abs(a.x - v.px) + Math.abs(a.y - v.py) > 0.01;
      v.px = a.x; v.py = a.y;
      v.tx = px(a.x); v.ty = py(a.y);
      const [anim, flip] = this.animFor(kind, a, moving);
      if (v.anim !== anim) { v.anim = anim; v.sprite.play(`${texture}:${anim}`); }
      v.sprite.setFlipX(flip);
      if (v.bg !== bg) { v.bg = bg; v.tag.setBackgroundColor(bg); }
      if (v.name !== name) { v.name = name; v.tag.setText(name); }
      v.tag.setVisible(showTag);
      v.icon.setText(this.iconFor(kind, a));
    };
    for (const a of snap.avatars) {
      upsert(a.id, "avatar", a, a.character, clip(a.name, 14), RANK_COLOR[a.rank] ?? "#5f6368", !crowded || BUSY.includes(a.state));
    }
    for (const g of snap.guards) upsert(`g:${g.id}`, "guard", g, "security_01", "Bảo vệ", "#26407a", true);
    for (const [key, v] of this.views) {
      if (seen.has(key)) continue;
      v.sprite.destroy(); v.tag.destroy(); v.icon.destroy();
      this.views.delete(key);
    }
  }

  update(_t: number, dt: number) {
    const k = 1 - Math.exp(-dt / 90);
    for (const v of this.views.values()) {
      if (v.tx === undefined) continue;
      const dx = v.tx - v.sprite.x, dy = v.ty - v.sprite.y;
      if (Math.hypot(dx, dy) > 96) { v.sprite.x = v.tx; v.sprite.y = v.ty; }
      else { v.sprite.x += dx * k; v.sprite.y += dy * k; }
      v.sprite.setDepth(v.sprite.y);
      v.tag.setPosition(v.sprite.x, v.sprite.y - 46);
      v.icon.setPosition(v.sprite.x, v.sprite.y - 70);
    }
  }

  // Hiệu ứng ngắn, có giới hạn tổng số để không rối mắt khi đông người.
  spawnFx(name: string, intensity: number) {
    const MAX_FX = 120;
    const avatars = [...this.views.values()];
    const spot = () => {
      const v = avatars[Math.floor(Math.random() * avatars.length)];
      return v ? { x: v.sprite.x, y: v.sprite.y - 50 } : { x: Math.random() * MAP_W * TILE, y: Math.random() * MAP_H * TILE };
    };
    const done = (o: any) => () => { o.destroy(); this.fxAlive--; };
    const n = Math.min(Math.round(intensity), 12) * (name === "confetti" ? 3 : 1);
    for (let i = 0; i < n && this.fxAlive < MAX_FX; i++) {
      this.fxAlive++;
      if (name === "confetti") {
        const colors = [0xff5c8a, 0xffd54a, 0x4fc3f7, 0x81c784, 0xba68c8];
        const o = this.add.rectangle(Math.random() * MAP_W * TILE, -10, 6, 10, colors[i % colors.length]).setDepth(200000);
        this.tweens.add({ targets: o, y: 300 + Math.random() * 900, angle: 360, alpha: 0, duration: 1800, onComplete: done(o) });
      } else if (name === "milestone") {
        const o = this.add.text(MAP_W * TILE / 2, MAP_H * TILE / 2, "★", { fontFamily: FONT, fontSize: "96px", color: "#ffd54a", resolution: 2 }).setOrigin(0.5).setDepth(200000);
        this.tweens.add({ targets: o, scale: 3, alpha: 0, duration: 1500, onComplete: done(o) });
        break;
      } else {
        const p = spot();
        const glyph = name === "hearts" ? "♥" : "✦";
        const o = this.add.text(p.x + (Math.random() - 0.5) * 30, p.y, glyph, { fontFamily: FONT, fontSize: "22px", color: name === "hearts" ? "#ff4d6d" : "#ffd54a", resolution: 2 }).setOrigin(0.5).setDepth(200000);
        this.tweens.add({ targets: o, y: o.y - 50 - Math.random() * 40, alpha: 0, duration: 1200, onComplete: done(o) });
      }
    }
  }
}

// ---------- Thông tin ở đầu và cuối màn hình (chữ lớn để đọc được trên điện thoại) ----------
class HudScene extends Phaser.Scene {
  t: any = {};
  feed: string[] = [];
  connected = false;
  last: any = null;

  constructor() { super("hud"); }

  create() {
    const text = (x: number, y: number, size: number, color = "#ffffff", bold = false, extra: any = {}) =>
      this.add.text(x, y, "", { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: bold ? "bold" : "normal", resolution: 1, ...extra });
    this.add.rectangle(0, 0, VIEW_W, TOP_H, 0x151a26).setOrigin(0, 0);
    this.add.rectangle(0, VIEW_H - BOTTOM_H, VIEW_W, BOTTOM_H, 0x151a26).setOrigin(0, 0);

    this.t.mode = text(24, 20, 28, "#ffffff", true, { padding: { x: 14, y: 8 } });
    text(VIEW_W - 24, 14, 52, "#ffffff", true).setOrigin(1, 0).setText("OFFICE LIFE");
    this.t.stats = text(24, 84, 32);
    this.t.event = text(VIEW_W - 24, 84, 32, "#ffd54a", true).setOrigin(1, 0);
    this.t.bar = this.add.graphics();

    this.t.feed = text(24, VIEW_H - BOTTOM_H + 14, 32, "#e8ebf2", false, { wordWrap: { width: VIEW_W - 48 }, maxLines: 4, lineSpacing: 6 });
    this.add.rectangle(0, VIEW_H - 64, VIEW_W, 64, 0xf1c40f).setOrigin(0, 0);
    text(VIEW_W / 2, VIEW_H - 32, 28, "#1a1a1a", true).setOrigin(0.5).setText("Bình luận: vào công ty · điểm danh · đi làm · đi họp · trốn việc");

    this.t.banner = this.add.text(VIEW_W / 2, TOP_H + 110, "", {
      fontFamily: FONT, fontSize: "40px", fontStyle: "bold", color: "#ffffff", align: "center", backgroundColor: "rgba(20,24,38,0.9)",
      padding: { x: 28, y: 16 }, wordWrap: { width: 900 }, resolution: 1,
    }).setOrigin(0.5).setAlpha(0);

    bus.on("conn", (ok: boolean) => { this.connected = ok; this.mode(this.last?.provider); });
    bus.on("state", (m: any) => { this.last = m; this.render(m); });
    bus.on("event", (e: any) => this.onEvent(e));
    this.connected = online;
    this.mode(null);
  }

  mode(p: any) {
    const paused = this.last?.session === "paused";
    const chip = !this.connected ? ["MẤT KẾT NỐI VỚI GAME", "#c0392b"] : paused ? ["TẠM DỪNG", "#6b7280"]
      : p?.mock ? ["CHẾ ĐỘ MÔ PHỎNG", "#e67e22"] : ["ĐANG KẾT NỐI LIVE", "#27ae60"];
    this.t.mode.setText(chip[0]).setBackgroundColor(chip[1]);
  }

  render(m: any) {
    this.connected = true; // đang nhận trạng thái nghĩa là đang kết nối
    this.mode(m.provider);
    const s = m.snapshot;
    this.t.stats.setText(`Trong công ty ${s.avatars.length}  ·  Thích ${s.community.likes.toLocaleString("vi-VN")}`);
    if (s.event) {
      const left = Math.max(0, Math.round((s.event.endsAt - m.now) / 1000));
      this.t.event.setText(`${s.event.name} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
    } else this.t.event.setText("");
    const w = VIEW_W - 48;
    this.t.bar.clear().fillStyle(0x2a3248).fillRect(24, 134, w, 10).fillStyle(0xff6b9d).fillRect(24, 134, (w * Math.min(100, s.community.energy)) / 100, 10);
  }

  say(line: string) {
    this.feed.push(line);
    if (this.feed.length > 12) this.feed.shift();
    this.t.feed.setText(this.feed.slice(-4).reverse().join("\n"));   // mới nhất ở trên cùng
  }

  onEvent(e: any) {
    if (e.kind === "feed") this.say(e.text);
    else if (e.kind === "rank_up") this.say(`${e.displayName} đã lên cấp ${e.rank}!`);
    else if (e.kind === "badge") this.say(`${e.displayName} nhận huy hiệu ${e.badgeName}`);
    else if (e.kind === "announce") {
      this.t.banner.setText(`${e.name}
${e.text}`).setAlpha(1);
      this.tweens.killTweensOf(this.t.banner);
      this.tweens.add({ targets: this.t.banner, alpha: 0, delay: 5000, duration: 1000 });
    }
  }
}

// Canvas không tự chờ web font: phải tải xong trước khi vẽ chữ, nếu không sẽ rơi về font hệ thống. Quá 3 giây thì chạy luôn với font dự phòng.
await Promise.race([
  Promise.all(["400", "600", "700", "800"].map((w) => document.fonts.load(`${w} 20px "Plus Jakarta Sans"`))),
  new Promise((ok) => setTimeout(ok, 3000)),
]).catch(() => {});

new Phaser.Game({
  type: Phaser.AUTO, width: VIEW_W, height: VIEW_H, parent: "game", backgroundColor: "#11151f",
  pixelArt: true, roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [OfficeScene, HudScene],
});
connect();
