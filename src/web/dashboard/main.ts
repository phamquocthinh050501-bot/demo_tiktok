// Màn hình streamer: chỉ hiển thị và gửi yêu cầu. Mọi kiểm tra, kết quả và số liệu đều do server quyết định (control.ts).
// Nội dung từ người xem (nickname, comment) luôn được đặt bằng textContent, không bao giờ qua innerHTML.
type Any = any;

const SVG_NS = "http://www.w3.org/2000/svg";
function h(tag: string, props: Record<string, Any> = {}, ...kids: Any[]): Any {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn as EventListener);
    else if (k in el && k !== "list") (el as Any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...kids.flat().filter((x) => x !== undefined && x !== null && x !== false));
  return el;
}
function svg(inner: Array<[string, Record<string, string>]>, size = 24): Any {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", `0 0 ${size} ${size}`);
  el.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of inner) {
    const c = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    el.append(c);
  }
  return el;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour12: false });
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const nf = (n: number) => n.toLocaleString("vi-VN");

// ---------- Kết nối tới game (kênh điều khiển, chỉ từ máy này) ----------
const state: { dash: Any; cfg: Any; online: boolean; feed: Array<{ at: number; text: string }> } = { dash: null, cfg: null, online: false, feed: [] };
let ws: WebSocket;
let nextId = 1;
let retry = 500;
const pending = new Map<number, (r: Any) => void>();
const NOT_CONNECTED = { ok: false, errors: ["Chưa kết nối tới game"] };

function send(msg: Record<string, Any>): Promise<Any> {
  if (!state.online) return Promise.resolve(NOT_CONNECTED);
  const id = nextId++;
  return new Promise((ok) => {
    pending.set(id, ok);
    ws.send(JSON.stringify({ ...msg, id }));
    setTimeout(() => { if (pending.delete(id)) ok({ ok: false, errors: ["Game không trả lời"] }); }, 5000);
  });
}
function connect() {
  ws = new WebSocket(`ws://${location.host}/control`);
  ws.onopen = () => { state.online = true; retry = 500; refresh(); };
  ws.onclose = () => { state.online = false; refresh(); setTimeout(connect, retry); retry = Math.min(retry * 2, 8000); };
  ws.onmessage = (e) => {
    let m: Any;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "dash") { state.dash = m; refresh(); }
    else if (m.type === "config") { state.cfg = m; fillConfig(); renderMockOptions(); renderCommands(); }
    else if (m.type === "ack") { pending.get(m.id)?.(m); pending.delete(m.id); }
    else if (m.type === "event") onGameEvent(m.event);
  };
}
function onGameEvent(e: Any) {
  const line = e.kind === "feed" ? e.text
    : e.kind === "rank_up" ? `${e.displayName} đã lên cấp ${e.rank}!`
    : e.kind === "badge" ? `${e.displayName} nhận huy hiệu ${e.badgeName}`
    : e.kind === "announce" ? `Sự kiện: ${e.name}` : null;
  if (!line) return;
  state.feed.push({ at: Date.now(), text: line });
  if (state.feed.length > 60) state.feed.shift();
  renderFeed();
}

// ---------- Khung chung ----------
const ROUTES = [
  { path: "#/tong-quan", name: "Tổng quan", icon: [["rect", { x: "3", y: "3", width: "7", height: "7" }], ["rect", { x: "14", y: "3", width: "7", height: "7" }], ["rect", { x: "3", y: "14", width: "7", height: "7" }], ["rect", { x: "14", y: "14", width: "7", height: "7" }]] },
  { path: "#/lenh", name: "Lệnh và overlay", icon: [["path", { d: "M4 5h16v11H9l-5 4z" }]] },
  { path: "#/cau-hinh", name: "Cấu hình", icon: [["path", { d: "M4 7h10M18 7h2M4 17h2M10 17h10" }], ["circle", { cx: "16", cy: "7", r: "2" }], ["circle", { cx: "8", cy: "17", r: "2" }]] },
] as Array<{ path: string; name: string; icon: Array<[string, Record<string, string>]> }>;

const ui: Record<string, Any> = {};
const views: Record<string, Any> = {};

function buildShell() {
  const mark = svg([["rect", { x: "4", y: "4", width: "20", height: "20", rx: "3" }], ["path", { d: "M9 10h3M16 10h3M9 15h3M16 15h3M12 24v-4h4v4" }]], 28);
  mark.setAttribute("class", "mark");
  mark.setAttribute("style", "fill:none;stroke:#fff;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round");
  const nav = h("nav", { "aria-label": "Màn hình" }, ROUTES.map((r) => h("a", { href: r.path, title: r.name, "aria-label": r.name, "data-path": r.path }, svg(r.icon))));
  const main = h("main", { class: "main" });
  document.getElementById("app")!.append(h("div", { class: "shell" }, h("aside", { class: "rail" }, mark, nav), main));
  ui.nav = nav;
  ui.main = main;
}

function route() {
  const path = ROUTES.some((r) => r.path === location.hash) ? location.hash : ROUTES[0].path;
  for (const [p, el] of Object.entries(views)) el.hidden = p !== path;
  ui.nav.querySelectorAll("a").forEach((a: Any) => (a.dataset.path === path ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.title = `${ROUTES.find((r) => r.path === path)!.name} — OFFICE LIFE`;
}

function seg(label: string, onPick: (on: boolean) => void) {
  const off = h("button", { type: "button", "aria-pressed": "true", on: { click: () => onPick(false) } }, "Tắt");
  const on = h("button", { type: "button", "aria-pressed": "false", on: { click: () => onPick(true) } }, "Bật");
  const el = h("div", { class: "seg", role: "group", "aria-label": label }, off, on);
  return { el, set(v: boolean) { off.setAttribute("aria-pressed", String(!v)); on.setAttribute("aria-pressed", String(v)); } };
}
function status(el: Any, r: Any, okText = "Đã áp dụng") {
  el.className = r.ok ? "status" : "status err";
  el.replaceChildren(...(r.ok ? [okText] : [h("ul", {}, (r.errors ?? ["Không thực hiện được"]).map((e: string) => h("li", {}, e)))]));
}

// ---------- Tổng quan ----------
function buildOverview() {
  ui.mode = h("span", { class: "pill warn" }, "CHẾ ĐỘ MÔ PHỎNG");
  ui.sess = h("span", { class: "pill neutral" }, "Chưa bắt đầu");
  ui.conn = h("span", { class: "pill neutral", hidden: true, style: "color:var(--negative)" }, "Mất kết nối với game");
  ui.finding = h("p", { class: "sub" }, "Đang kết nối…");
  ui.actions = h("div", { class: "actions" });
  const title = h("div", {}, h("h1", {}, "Tổng quan", ui.mode, ui.sess, ui.conn), ui.finding);

  const kpi = (label: string) => { const value = h("div", { class: "value" }, h("span", { class: "skel" })); const cap = h("div", { class: "cap" }, " "); return { el: h("div", { class: "kpi" }, h("div", { class: "label" }, label), value, cap), value, cap }; };
  ui.k1 = kpi("Trong công ty"); ui.k2 = kpi("Lượt thích"); ui.k3 = kpi("Năng lượng cộng đồng"); ui.k4 = kpi("Người xem");
  ui.energyBar = h("i", { style: "width:0" }); ui.k3.el.append(h("div", { class: "bar" }, ui.energyBar));

  ui.liveSeg = seg("LIVE giả lập", (on) => run(send({ type: "mock.live", started: on })));
  ui.demoSeg = seg("Kịch bản demo", (on) => run(send({ type: "mock.demo", on })));
  const toggle = (label: string, s: Any) => h("div", { class: "row", style: "gap:10px" }, h("span", { class: "lbl" }, label), s.el);
  const stage = h("section", { class: "card stage", "aria-label": "Màn hình game" },
    h("header", { style: "flex-wrap:wrap;align-items:center" }, h("h2", {}, "Màn hình game"),
      h("div", { class: "row", style: "gap:24px;flex-wrap:wrap" }, toggle("LIVE giả lập", ui.liveSeg), toggle("Kịch bản demo", ui.demoSeg),
        h("a", { class: "meta", href: "/game", target: "_blank", rel: "noopener" }, "Mở toàn màn hình"))),
    h("div", { class: "frame", style: "margin-top:14px" }, h("iframe", { src: "/game", title: "Màn hình game đang chạy", loading: "eager" })));

  ui.rooms = h("div", { class: "rooms" });
  ui.board = h("div", { style: "min-height:364px" });   // đủ 8 hàng: thẻ không co giãn theo số người chơi
  // Màn hình game dọc (9:16) bên trái; phòng và bảng xếp hạng xếp dọc bên phải.
  const side = h("div", { class: "col" },
    h("section", { class: "card" }, h("header", {}, h("h2", {}, "Phòng"), h("span", { class: "meta" }, "người đang ở / sức chứa")), ui.rooms),
    h("section", { class: "card" }, h("header", {}, h("h2", {}, "Bảng xếp hạng"), h("span", { class: "meta" }, "theo EXP")), ui.board));
  const two = h("div", { class: "stagegrid" }, stage, side);

  views["#/tong-quan"] = h("div", {}, h("div", { class: "titlerow" }, title, ui.actions), h("div", { class: "kpis" }, ui.k1.el, ui.k2.el, ui.k3.el, ui.k4.el),
    h("div", { class: "grid", style: "margin-top:var(--gap)" }, h("div", { class: "col" }, two), h("div", { class: "col" }, buildMock(), buildActivity())));
}

function buildMock() {
  ui.mName = h("input", { type: "text", id: "m-name", value: "Lan Anh", maxLength: 24, autocomplete: "off" });
  ui.mId = h("input", { type: "checkbox", id: "m-id", checked: true, style: "accent-color:#fff" });
  ui.mText = h("input", { type: "text", id: "m-text", placeholder: "ví dụ: đi làm", maxLength: 100, autocomplete: "off", on: { keydown: (e: KeyboardEvent) => { if (e.key === "Enter") sendComment(ui.mText.value); } } });
  ui.chips = h("div", { class: "chips" });
  ui.mGift = h("select", { id: "m-gift", "aria-label": "Loại quà" });
  ui.mCount = h("input", { type: "number", id: "m-count", value: 1, min: 1, max: 1000, "aria-label": "Số lượng quà", style: "width:72px" });
  ui.mStatus = h("div", { class: "status", role: "status" });
  const who = () => ({ name: ui.mName.value.trim() || "Khách", userId: ui.mId.checked ? `mock-${(ui.mName.value.trim() || "khach").toLowerCase()}` : undefined });
  ui.who = who;
  const likeBtn = (n: number) => h("button", { type: "button", class: "btn small", on: { click: () => run(send({ type: "mock.like", ...who(), count: n })) } }, `+${nf(n)} tim`);

  return h("section", { class: "card", "aria-label": "Giả lập" },
    h("header", {}, h("h2", {}, "Giả lập"), h("span", { class: "meta" }, "thay cho người xem TikTok")),
    h("div", { class: "stack" },
      h("div", { class: "field" }, h("label", { for: "m-name" }, "Biệt danh người xem"),
        ui.mName, h("label", { class: "row hint", for: "m-id", style: "color:var(--muted);font-size:12px" }, ui.mId, "Gửi kèm ID người dùng (bỏ chọn để thử trường hợp provider không có ID)")),
      h("div", { class: "field" }, h("label", { for: "m-text" }, "Bình luận"),
        h("div", { class: "row" }, ui.mText, h("button", { type: "button", class: "btn", on: { click: () => sendComment(ui.mText.value) } }, "Gửi"))),
      ui.chips,
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Thả tim"), h("div", { class: "chips" }, likeBtn(1), likeBtn(10), likeBtn(100), likeBtn(1000))),
      h("div", { class: "field" }, h("label", { for: "m-gift" }, "Tặng quà"),
        h("div", { class: "row" }, ui.mGift, ui.mCount, h("button", { type: "button", class: "btn", on: { click: sendGift } }, "Tặng"))),
      ui.mStatus));
}
function run(p: Promise<Any>, el: Any = ui.mStatus) { p.then((r) => status(el, r, "Đã gửi")); }
function sendComment(text: string) {
  if (!text.trim()) return status(ui.mStatus, { ok: false, errors: ["Hãy nhập nội dung bình luận"] });
  run(send({ type: "mock.comment", ...ui.who(), text })); ui.mText.value = "";
}
function sendGift() {
  const g = JSON.parse(ui.mGift.value || "{}");
  run(send({ type: "mock.gift", ...ui.who(), ...g, count: Number(ui.mCount.value) }));
}
function renderMockOptions() {
  const cfg = state.cfg;
  ui.chips.replaceChildren(...cfg.commands.map((c: Any) => h("button", { type: "button", class: "btn small", title: c.description, on: { click: () => sendComment(c.aliases[0]) } }, c.aliases[0])));
  const opts: Array<[string, string]> = [];
  for (const r of cfg.gifts.rules) opts.push([r.giftName ?? r.giftId, JSON.stringify({ giftId: r.giftId, giftName: r.giftName })]);
  for (const t of cfg.gifts.tiers) opts.push([`Quà có giá trị từ ${nf(t.minValue)}`, JSON.stringify({ giftName: `Quà ${t.minValue}`, value: t.minValue })]);
  opts.push(["Quà chưa khai báo (mặc định)", JSON.stringify({ giftName: "Quà lạ" })]);
  ui.mGift.replaceChildren(...opts.map(([label, value]) => h("option", { value }, label)));
}

function buildActivity() {
  ui.feedList = h("ul", { class: "feed" });
  ui.logList = h("ul", { class: "feed" });
  ui.tabFeed = h("button", { class: "tab", role: "tab", "aria-selected": "true", on: { click: () => pickTab(true) } }, "Hoạt động");
  ui.tabLog = h("button", { class: "tab", role: "tab", "aria-selected": "false", on: { click: () => pickTab(false) } }, "Nhật ký nhận");
  ui.logList.hidden = true;
  return h("section", { class: "card", "aria-label": "Hoạt động" }, h("div", { class: "tabs", role: "tablist" }, ui.tabFeed, ui.tabLog), ui.feedList, ui.logList);
}
function pickTab(feed: boolean) {
  ui.tabFeed.setAttribute("aria-selected", String(feed)); ui.tabLog.setAttribute("aria-selected", String(!feed));
  ui.feedList.hidden = !feed; ui.logList.hidden = feed;
}
function listOrEmpty(items: Any[], text: string) { return items.length ? items : [h("li", { style: "display:block" }, h("div", { class: "empty" }, text))]; }
function renderFeed() {
  ui.feedList.replaceChildren(...listOrEmpty(state.feed.slice(-30).reverse().map((f) => h("li", {}, h("time", {}, clock(f.at)), h("span", {}, f.text))), "Chưa có hoạt động nào. Gửi “vào công ty” ở bảng Giả lập."));
}

// ---------- Lệnh và overlay ----------
function buildCommands() {
  ui.cmdBody = h("tbody");
  ui.ovFull = seg("Hướng dẫn đầy đủ", (on) => send({ type: "overlay", which: "full", on }));
  ui.ovCompact = seg("Hướng dẫn gọn", (on) => send({ type: "overlay", which: "compact", on }));
  views["#/lenh"] = h("div", {},
    h("div", { class: "titlerow" }, h("div", {}, h("h1", {}, "Lệnh và overlay"), h("p", { class: "sub" }, "Người xem gõ các lệnh này vào bình luận. Gõ có dấu hay không dấu, hoa hay thường đều được.")), h("div", { class: "actions" })),
    h("div", { class: "grid" },
      h("section", { class: "card" }, h("header", {}, h("h2", {}, "Lệnh cho người xem")),
        h("table", { class: "cmds" }, h("thead", {}, h("tr", {}, h("th", {}, "Lệnh"), h("th", {}, "Làm gì"), h("th", {}, "Nhóm"), h("th", { class: "num" }, "Cooldown"))), ui.cmdBody)),
      h("section", { class: "card" }, h("header", {}, h("h2", {}, "Overlay trong OBS")),
        h("div", { class: "stack" },
          h("div", { class: "switchrow" }, h("div", {}, h("span", { class: "lbl" }, "Hướng dẫn comment — đầy đủ"), h("p", {}, "Bảng đủ các lệnh")), ui.ovFull.el),
          h("div", { class: "switchrow" }, h("div", {}, h("span", { class: "lbl" }, "Hướng dẫn comment — gọn"), h("p", {}, "Dải lệnh chính, đặt ở góc màn hình")), ui.ovCompact.el),
          h("p", { class: "meta", style: "color:var(--muted);font-size:12px" }, "Trang overlay cho OBS sẽ được thêm ở giai đoạn sau; công tắc này đã lưu sẵn trạng thái bật/tắt.")))));
}
function renderCommands() {
  const cfg = state.cfg;
  ui.cmdBody.replaceChildren(...cfg.commands.map((c: Any) => h("tr", {},
    h("td", { class: "al" }, h("b", {}, c.aliases[0]), c.aliases.length > 1 ? h("span", {}, `hoặc: ${c.aliases.slice(1).join(", ")}`) : null),
    h("td", {}, c.description),
    h("td", {}, cfg.groups[c.group] ?? c.group),
    h("td", { class: "num" }, `${(cfg.limits.cooldownMs[c.group] ?? 0) / 1000} `, h("span", { class: "unit" }, "giây")))));
}

// ---------- Cấu hình ----------
const dirty: Record<string, boolean> = {};
function panel(key: string, children: Any[], apply: () => Promise<Any>) {
  const st = h("div", { class: "status", role: "status" });
  const btn = h("button", { type: "button", class: "btn", on: { click: () => apply().then((r) => { status(st, r); if (r.ok) dirty[key] = false; }) } }, "Áp dụng");
  return { el: h("div", { class: "panel", on: { input: () => { dirty[key] = true; st.textContent = ""; } } }, ...children, h("div", { class: "foot" }, st, btn)), st };
}
const GROUP_ORDER = ["join", "move", "emote", "escape", "info"];
function buildSettings() {
  ui.cd = Object.fromEntries(GROUP_ORDER.map((g) => [g, h("input", { type: "number", min: 0, max: 3600, step: 0.5, id: `cd-${g}` })]));
  ui.cdLabels = {};
  const groupField = (g: string) => { ui.cdLabels[g] = h("label", { for: `cd-${g}` }, g); return h("div", { class: "field" }, ui.cdLabels[g], ui.cd[g]); };
  ui.cap = h("input", { type: "number", min: 1, max: 1000, id: "rate-cap" });
  ui.refill = h("input", { type: "number", min: 0, max: 1000, id: "rate-refill" });
  ui.maxAv = h("input", { type: "number", min: 1, max: 1000, id: "max-av" });
  const spam = panel("limits", [
    h("div", { class: "fields" }, GROUP_ORDER.map(groupField)),
    h("div", { class: "fields" },
      h("div", { class: "field" }, h("label", { for: "rate-cap" }, "Số lệnh tối đa nhận liên tiếp"), ui.cap, h("span", { class: "hint" }, "Giới hạn toàn hệ thống")),
      h("div", { class: "field" }, h("label", { for: "rate-refill" }, "Nạp lại mỗi giây"), ui.refill, h("span", { class: "hint" }, "lệnh/giây")),
      h("div", { class: "field" }, h("label", { for: "max-av" }, "Số avatar tối đa"), ui.maxAv, h("span", { class: "hint" }, "Mục tiêu kiểm thử: 100–200"))),
  ], () => send({
    type: "config.limits",
    cooldownMs: Object.fromEntries(GROUP_ORDER.map((g) => [g, Math.round(Number(ui.cd[g].value) * 1000)])),
    globalRate: { capacity: Number(ui.cap.value), refillPerSec: Number(ui.refill.value) },
    maxAvatars: Number(ui.maxAv.value),
  }));

  ui.diffBody = h("tbody");
  const diff = panel("difficulty", [
    h("div", { class: "dtable" }, h("table", {}, h("thead", {}, h("tr", {},
      h("th", {}, "Cấp bậc"), h("th", { class: "num" }, "Bảo vệ"), h("th", { class: "num" }, "Trạm gác"), h("th", { class: "num" }, "Camera"),
      h("th", { class: "num" }, "Tầm nhìn"), h("th", { class: "num" }, "Góc nhìn (°)"), h("th", { class: "num" }, "Phản ứng (ms)"))), ui.diffBody)),
    h("p", { class: "hint", style: "color:var(--muted);font-size:12px" }, "Cấp càng cao càng khó: mọi cột chỉ được tăng (riêng thời gian phản ứng chỉ được giảm) theo cấp. Giá trị phải nằm trong giới hạn của game."),
  ], () => send({ type: "config.difficulty", profiles: [...ui.diffBody.querySelectorAll("tr")].map((tr: Any) => {
    const v = (k: string) => Number(tr.querySelector(`[data-k="${k}"]`).value);
    return { guards: v("guards"), checkpoints: v("checkpoints"), cameras: v("cameras"), visionRange: v("visionRange"), visionHalfAngleDeg: v("visionHalfAngleDeg"), reactionMs: v("reactionMs") };
  }) }));

  ui.gifts = h("textarea", { id: "gifts-json", spellcheck: false, "aria-label": "Cấu hình quà tặng (JSON)" });
  const gifts = panel("gifts", [
    h("div", { class: "field" }, h("label", { for: "gifts-json" }, "Quy tắc quà tặng (JSON)"), ui.gifts,
      h("span", { class: "hint" }, "Khớp theo ID quà, rồi tên, rồi mức giá trị, cuối cùng là mặc định. Các quà mẫu chỉ để thử.")),
  ], () => { try { return send({ type: "config.gifts", gifts: JSON.parse(ui.gifts.value) }); } catch { return Promise.resolve({ ok: false, errors: ["JSON không hợp lệ: kiểm tra dấu ngoặc và dấu phẩy"] }); } });

  ui.sumLimits = h("p", { class: "summary" }); ui.sumDiff = h("p", { class: "summary" }); ui.sumGifts = h("p", { class: "summary" });
  const sec = (title: string, desc: string, sum: Any, p: Any) => h("section", { class: "section" }, h("div", {}, h("h2", {}, title), h("p", { class: "desc" }, desc), sum), p.el);
  views["#/cau-hinh"] = h("div", { class: "settings" },
    h("div", { class: "titlerow" }, h("div", {}, h("h1", {}, "Cấu hình"), h("p", { class: "sub" }, "Thay đổi áp dụng ngay cho phiên đang chạy. Chưa được lưu lại: tắt game là về giá trị gốc.")), h("div", { class: "actions" })),
    sec("Chống spam", "Thời gian chờ giữa hai lệnh cùng nhóm của một người, giới hạn chung toàn hệ thống và số avatar.", ui.sumLimits, spam),
    sec("Độ khó thử thách trốn việc", "Mỗi cấp bậc có một mức độ khó riêng: số bảo vệ, trạm gác, camera, tầm nhìn và thời gian phản ứng.", ui.sumDiff, diff),
    sec("Quà tặng", "Mỗi quà làm gì: hiệu ứng, năng lượng cộng đồng, EXP, vé trốn việc hoặc sự kiện. Quà không bảo đảm thắng thử thách.", ui.sumGifts, gifts));
}
function fillConfig() {
  const c = state.cfg;
  if (!dirty.limits) {
    GROUP_ORDER.forEach((g) => { ui.cd[g].value = (c.limits.cooldownMs[g] ?? 0) / 1000; ui.cdLabels[g].textContent = `Cooldown: ${c.groups[g] ?? g} (giây)`; });
    ui.cap.value = c.limits.globalRate.capacity; ui.refill.value = c.limits.globalRate.refillPerSec; ui.maxAv.value = c.limits.maxAvatars;
  }
  if (!dirty.difficulty) {
    const num = (k: string, v: number, step = 1) => h("input", { type: "number", "data-k": k, value: v, step, "aria-label": k });
    ui.diffBody.replaceChildren(...c.escape.profiles.map((p: Any, i: number) => h("tr", {},
      h("td", { class: "nowrap" }, c.ranks[i]),
      h("td", { class: "num" }, num("guards", p.guards)), h("td", { class: "num" }, num("checkpoints", p.checkpoints)), h("td", { class: "num" }, num("cameras", p.cameras)),
      h("td", { class: "num" }, num("visionRange", p.visionRange, 0.5)), h("td", { class: "num" }, num("visionHalfAngleDeg", p.visionHalfAngleDeg, 5)), h("td", { class: "num" }, num("reactionMs", p.reactionMs, 50)))));
  }
  if (!dirty.gifts) ui.gifts.value = JSON.stringify(c.gifts, null, 2);
  const cd = c.limits.cooldownMs;
  ui.sumLimits.textContent = `Hiện tại: di chuyển ${cd.move / 1000} giây, trốn việc ${cd.escape / 1000} giây, tối đa ${nf(c.limits.maxAvatars)} avatar.`;
  const first = c.escape.profiles[0], last = c.escape.profiles[c.escape.profiles.length - 1];
  ui.sumDiff.textContent = `Từ ${c.ranks[0]} (${first.guards} bảo vệ, phản ứng ${first.reactionMs} ms) đến ${c.ranks[c.ranks.length - 1]} (${last.guards} bảo vệ, ${last.checkpoints} trạm gác, phản ứng ${last.reactionMs} ms).`;
  ui.sumGifts.textContent = `${c.gifts.rules.length} quà khai báo riêng, ${c.gifts.tiers.length} mức giá trị, giới hạn ${c.gifts.perUser.maxUnits} đơn vị mỗi người trong ${c.gifts.perUser.windowMs / 60000} phút.`;
}

// ---------- Cập nhật theo số liệu từ game ----------
const SESSION_LABEL: Record<string, string> = { idle: "Chưa bắt đầu", running: "Đang chạy", paused: "Tạm dừng", ended: "Đã kết thúc" };

function finding(d: Any): string {
  const ev = d.event ? ` Sự kiện ${d.event.name}, còn ${mmss(d.event.endsAt - d.now)}.` : "";
  const s = d.session.state;
  if (s === "paused") return "Phiên đang tạm dừng: game đứng yên, bình luận vẫn xếp hàng chờ.";
  if (s === "ended") return `Phiên đã kết thúc.${d.people ? ` Còn ${d.people} người trong công ty.` : ""} Bắt đầu phiên mới để mở lại lịch sự kiện.`;
  if (s === "idle") return `Chưa bắt đầu phiên nên lịch sự kiện chưa chạy.${d.people ? ` Đã có ${d.people} người vào công ty.` : ""}`;
  return `${d.people} người trong công ty, ${d.escaping ? `${d.escaping} đang trốn việc` : "chưa ai trốn việc"}.${ev}`;
}

function renderActions(d: Any) {
  const s = d.session.state;
  const b = (text: string, cls: string, fn: () => void) => h("button", { type: "button", class: `btn ${cls}`.trim(), disabled: !state.online, on: { click: fn } }, text);
  const act = (action: string) => send({ type: "session", action }).then((r) => { if (!r.ok) alert(r.errors.join("\n")); });
  const end = b("Kết thúc phiên", "danger", () => { if (confirm("Kết thúc phiên LIVE? Mọi người sẽ được đưa về sảnh.")) act("end"); });
  const key = `${s}|${state.online}`;
  if (ui.actions.dataset.key === key) return;
  ui.actions.dataset.key = key;
  ui.actions.replaceChildren(...(s === "running" ? [b("Tạm dừng", "", () => act("pause")), end]
    : s === "paused" ? [b("Tiếp tục", "primary", () => act("resume")), end]
    : [b("Bắt đầu phiên", "primary", () => act("start"))]));
}

function refresh() {
  ui.conn.hidden = state.online;
  const d = state.dash;
  document.body.classList.toggle("loading", !d);
  if (!d) { renderActions({ session: { state: "idle" } }); return; }
  ui.mode.textContent = d.provider.label;
  ui.sess.textContent = SESSION_LABEL[d.session.state];
  ui.sess.className = `pill ${d.session.state === "running" ? "ok" : "neutral"}`;
  ui.finding.textContent = finding(d);
  renderActions(d);

  const set = (k: Any, value: Any, cap: string) => { k.value.replaceChildren(...[].concat(value)); k.cap.textContent = cap; };
  set(ui.k1, [nf(d.people), h("small", {}, ` / ${nf(d.maxAvatars)}`)], d.escaping ? `${d.escaping} đang trốn việc` : "Chưa ai trốn việc");
  set(ui.k2, nf(d.community.likes), "tích lũy từ lúc mở game");
  const pct = Math.min(100, Math.floor(d.community.energy));
  set(ui.k3, [`${pct}`, h("small", {}, "%")], "đầy thì mở Thi đua năng suất");
  ui.energyBar.style.width = `${pct}%`;
  if (d.viewers === null) { ui.k4.value.className = "value dash"; set(ui.k4, "Không khả dụng", "Nguồn mô phỏng không cung cấp số này"); }
  else { ui.k4.value.className = "value"; set(ui.k4, nf(d.viewers), "do provider cung cấp"); }

  ui.rooms.replaceChildren(...d.rooms.map((r: Any) => h("div", { class: `room${r.count ? " has" : ""}` },
    h("span", {}, r.name), h("span", { class: "n" }, `${r.count}/${r.capacity}`),
    h("div", { class: "bar" }, h("i", { style: `width:${Math.min(100, (r.count / r.capacity) * 100)}%` })))));

  const top = d.leaderboard.slice(0, 8);   // 8 hàng ≈ chiều cao khung game bên cạnh
  ui.board.replaceChildren(top.length
    ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Người chơi"), h("th", { class: "num" }, "EXP"))),
      h("tbody", {}, top.map((r: Any, i: number) => h("tr", {}, h("td", { class: "name" }, `${i + 1}. ${r.name}`, h("span", { class: "sub" }, r.rank)), h("td", { class: "num" }, nf(r.exp))))))
    : h("div", { class: "empty" }, "Chưa có ai trong công ty. Gửi “vào công ty” ở bảng Giả lập để thử."));

  ui.liveSeg.set(d.session.state === "running" || d.session.state === "paused");
  ui.demoSeg.set(d.demo);
  ui.ovFull.set(d.overlay.full); ui.ovCompact.set(d.overlay.compact);
  ui.logList.replaceChildren(...listOrEmpty([...d.mockLog].reverse().map((l: Any) => h("li", {}, h("time", {}, clock(l.at)),
    h("span", {}, h("span", { class: "t" }, `${{ comment: "bình luận", like: "thả tim", gift: "quà", live_status: "LIVE" }[l.type as string] ?? l.type} · `), l.name ? `${l.name}: ` : "",
      l.type === "like" ? `${nf(l.count)} lượt` : l.type === "gift" ? `${l.text} ×${l.count}` : l.text))), "Chưa nhận được sự kiện nào."));
}

buildShell();
buildOverview();
buildCommands();
buildSettings();
for (const v of Object.values(views)) ui.main.append(v);
renderFeed();
route();
window.addEventListener("hashchange", route);
refresh();
connect();
