# Threads Multi-Brand Manager — cloud image (Node + Chromium + Korean/emoji fonts)
FROM node:20-bookworm-slim

# Chromium để render thẻ ảnh + font tiếng Hàn + emoji
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app
COPY . .

# Giữ 1 bản brands gốc để "seed" vào volume khi volume còn trống (lần chạy đầu)
RUN cp -r brands /app/_seed_brands || true

EXPOSE 4000
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
