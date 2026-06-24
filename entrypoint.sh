#!/bin/sh
# Nếu volume /app/brands còn trống (lần deploy đầu) → seed từ bản gốc trong image
if [ -z "$(ls -A /app/brands 2>/dev/null)" ]; then
  echo "[entrypoint] brands trống — seeding dữ liệu gốc vào volume..."
  cp -r /app/_seed_brands/* /app/brands/ 2>/dev/null || true
fi
echo "[entrypoint] khởi động dashboard trên PORT=${PORT:-4000}"
exec node server.mjs
