# OFFICE LIFE — Thiết kế đã chốt (2026-11-02)

Nguồn yêu cầu: `C:\Thinh\Tiktok\OFFICE_LIFE_Design_Pack` (Specification v2.0 là chính). Tài liệu này chỉ ghi các quyết định kiến trúc; chi tiết luật nằm trong bộ tài liệu gốc.

## Mô hình sản phẩm (không đổi)
Game chạy trên PC streamer, OBS capture. Người xem chỉ comment/like/gift trong TikTok LIVE; không client, không bàn phím. NPC và hoạt động tự động. Mọi lệnh và chữ hiển thị cho người xem bằng tiếng Việt. Mock Mode xong trước provider thật; không giả định API TikTok, không scraping.

## Quyết định
- **A.** Thư mục mới `office-life/`, độc lập với `van-phong-online`.
- **B.** Một package TypeScript. `ws` thay Socket.IO, Vite cho phần web (từ GĐ 6). Chạy TS trực tiếp bằng Node 24 (`node --test`, không bước build) cho `core` và `server`.
- **C.** Art placeholder sinh bằng script (32×48, đúng metadata); thay bằng art thật cùng tên file.
- **D.** (Thay thế bởi E cho bố cục bản đồ.) Hành lang giữa các phòng ≥3 tile (MAP_DESIGN).
- **E (2026-11-02, sau GĐ7).** Khung hình chính là **DỌC 9:16 (1080×1920)** cho livestream điện thoại; bản ngang 16:9 làm nhân vật cao ~8px trên màn điện thoại nên bỏ. Bản đồ xếp lại thành tòa nhà **20×32 ô**: Sân thượng · (Phòng họp | hành lang | Phòng giám đốc) · (Giải trí | hành lang | Nhân sự) · (Phòng nghỉ | hành lang | góc máy in) · Khu làm việc · Sảnh lễ tân; hai phòng liền nhau dùng chung một dòng tường, hành lang giữa rộng 4 ô. Sức chứa phòng giảm (khu làm việc 40, phòng nhỏ 8–16): người thừa ở lại Sảnh. Ba tuyến trốn: thẳng qua hành lang, qua cột phòng bên phải, vòng cột phòng bên trái. Camera phóng ~1,5× để nhân vật ~25px cao trên màn 375px. Thông tin hệ thống ở đầu và cuối màn hình, chữ lớn.
- Huy hiệu theo GAME_RULES (7), bổ sung vào manifest.
- `COMMENT_GUIDE_VI.md` và `OVERLAY_DESIGN.md` không có trong gói → tự soạn từ Spec §5 và ASSET_MANIFEST, chờ duyệt.

## Kiến trúc
`Provider → Normalizer → Dedupe → Queue(bounded) → RateLimit → (Like batch | Command Parser | Gift Rules) → Rules Engine (Node, tick ~10 Hz) → State → ws → Phaser | Dashboard | Overlay`.
- `src/core/**` thuần logic, không I/O, thời gian và random được tiêm vào (test được).
- "Server" = process Node local; kết quả/pathfinding/collision do nó quyết định, Phaser chỉ vẽ.
- Parser: bỏ dấu + `đ→d` + chữ thường + gộp khoảng trắng + bỏ ký tự lạ, rồi khớp **chính xác** với bảng alias trong `config/commands.json`. Không fuzzy.
- Danh tính: `userId` của provider; nếu thiếu dùng khóa tạm theo nickname và đánh dấu `identityStable=false`.
- Mọi ngưỡng (cooldown, rate, queue, EXP, độ khó) nằm trong `config/*.json`.

## Thứ tự
GĐ0 khung → GĐ1 pipeline + Mock + parser → GĐ2 map/A* → GĐ3 rules → GĐ4 bảo vệ + trốn việc → GĐ5 like/gift/sự kiện → GĐ6 Phaser → GĐ7 dashboard → GĐ8 overlay OBS → GĐ9 lưu/benchmark → GĐ10 provider thật (chặn tới khi xác minh).
