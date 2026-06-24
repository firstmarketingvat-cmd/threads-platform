# Đưa Dashboard lên Railway (1 bản online dùng chung)

App đã sẵn sàng cho cloud: có **Dockerfile** (Node + Chromium + font Hàn/emoji), **mật khẩu chung**, đọc bí mật từ **biến môi trường**, và **volume** giữ data.

## Bước 1 — Đưa code + data lên 1 GitHub repo
Railway build từ GitHub. Repo cần có toàn bộ: `server.mjs`, `lib/`, `public/`, `scripts/`, `brands/`, `Dockerfile`, `entrypoint.sh`.
(Có thể dùng lại repo `firstmarketingvat-cmd/threads-platform` hoặc tạo repo mới. Claude sẽ giúp đẩy ở bước này.)

> ⚠️ KHÔNG đẩy `.pexels-key`, `deploy.json` (đã chặn trong `.dockerignore`/`.gitignore`). Bí mật để ở Bước 3.

## Bước 2 — Tạo Railway + project
1. Vào https://railway.com → đăng ký (login bằng GitHub cho nhanh).
2. **New Project → Deploy from GitHub repo** → chọn repo ở Bước 1.
3. Railway tự nhận `Dockerfile` và build.

## Bước 3 — Đặt biến môi trường (Variables)
Trong project → tab **Variables**, thêm:

| Tên | Giá trị |
|---|---|
| `DASH_PASSWORD` | mật khẩu bạn tự đặt (chia cho team) |
| `PEXELS_KEY` | API key Pexels của bạn |
| `GH_DEPLOY_TOKEN` | GitHub token (Contents: write) tới repo đăng bài |
| `GH_DEPLOY_REPO` | `firstmarketingvat-cmd/threads-platform` |

`PORT` Railway tự set — không cần thêm.

## Bước 4 — Thêm Volume (giữ data không mất)
Project → service → **Settings → Volumes → Add Volume** → Mount path: **`/app/brands`**.
Lần chạy đầu, app tự copy dữ liệu gốc vào volume; sau đó mọi chỉnh sửa được giữ lại qua các lần restart.

## Bước 5 — Mở domain
Settings → **Networking → Generate Domain** → ra link dạng `https://....up.railway.app`.
Mở link → trình duyệt hỏi mật khẩu → nhập `DASH_PASSWORD` → vào dashboard.
**Chia link + mật khẩu cho team là cùng dùng chung 1 kho data.**

## Bước 6 — Nối phần "tự viết 8:30" trên máy bạn vào cloud
Sau khi có link cloud + mật khẩu, trên **máy bạn** (nơi chạy hẹn giờ 8:30):
1. Đặt 2 biến môi trường: `CLOUD_URL=https://....up.railway.app` và `CLOUD_PASSWORD=<mật khẩu>`.
2. Hẹn giờ 8:30 làm 2 việc: (a) Claude sinh bài cho từng brand như cũ, (b) chạy:
   ```
   node scripts/push-to-cloud.mjs --recent 20
   ```
   → đẩy mọi bài vừa tạo trong 20 phút lên cloud, cloud tự render ảnh. Cả team mở dashboard là thấy bài mới để kiểm/sửa.

## Lưu ý vận hành
- **Cùng sửa:** mỗi bài là 1 file riêng → 2 người sửa 2 bài khác nhau thì an toàn. Tránh 2 người sửa **cùng 1 bài** một lúc (bản lưu sau đè bản trước).
- **Đăng bài thật** vẫn qua GitHub Actions + cron-job.org như cũ → nhớ bấm **Deploy** trên dashboard để đẩy nội dung sang repo đăng bài.
- **Chi phí:** Railway có credit dùng thử, sau đó ~5 USD/tháng (Hobby).
- **Bảo mật:** đổi `DASH_PASSWORD` định kỳ; chỉ chia cho người trong team.
