# OFFICE LIFE

Game văn phòng tương tác cho TikTok LIVE. Game chạy trên PC của streamer và được OBS capture; người xem chỉ comment, thả tim, tặng quà trong LIVE (không cần cài gì). Hiện chỉ có **chế độ mô phỏng** (chưa có provider TikTok thật).

## Chạy thử

Cần Node.js 24 trở lên.

```bash
npm install
npm run demo
```

- Màn hình streamer: http://localhost:3010/dashboard
- Trang game cho OBS: http://localhost:3010/game

`npm run demo` bật sẵn kịch bản demo (người xem ảo tự vào, gõ lệnh, thả tim, tặng quà). `npm start` chạy không có kịch bản; khi đó dùng bảng **Giả lập** trên màn hình streamer để gõ comment, thả tim, tặng quà. Bấm **Bắt đầu phiên** để mở lịch sự kiện.

## Đưa vào OBS (khung dọc 9:16)

1. Canvas OBS: **1080 × 1920** (Settings → Video).
2. Thêm nguồn *Browser* với địa chỉ `http://localhost:3010/game`, rộng 1080, cao 1920.
3. Phát bằng TikTok LIVE Studio hoặc OBS ở chế độ dọc.

## Lệnh cho người xem

Gõ có dấu hay không dấu, hoa hay thường đều được: `vào công ty`, `điểm danh`, `đi làm`, `đi uống cà phê`, `đi nghỉ`, `đi họp`, `đi chơi game`, `lên sân thượng`, `nhảy đi`, `ngủ một chút`, `trốn việc`, `xem cấp bậc`, `xem thành tích`. Danh sách đầy đủ và cooldown nằm ở tab *Lệnh và overlay* của màn hình streamer.

## Lệnh phát triển

```bash
npm test          # toàn bộ test
npm run map       # sinh lại bản đồ (tools/genMap.ts)
npm run assets    # sinh lại sprite/tileset giữ chỗ (tools/genAssets.ts)
```

Cấu hình số liệu (cấp bậc, EXP, độ khó, quà, sự kiện) nằm trong `config/`. Chỉnh trên màn hình streamer chỉ có hiệu lực trong phiên chạy đó, chưa được lưu.

## Chưa có

Provider TikTok thật, overlay hướng dẫn comment cho OBS (mới có công tắc), lưu dữ liệu giữa các buổi, art thật (đang dùng hình giữ chỗ sinh bằng mã).
