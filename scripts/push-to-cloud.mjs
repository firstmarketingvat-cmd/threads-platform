// push-to-cloud.mjs — đẩy bài vừa sinh ở máy local LÊN dashboard cloud (rồi cloud tự render ảnh).
// Dùng cho luồng: 8:30 máy local tự viết bài -> chạy script này -> cả team thấy trên cloud để kiểm/sửa.
//
// Cấu hình bằng biến môi trường:
//   CLOUD_URL       = https://....up.railway.app   (link dashboard cloud)
//   CLOUD_PASSWORD  = mật khẩu DASH_PASSWORD của cloud
//
// Cách dùng:
//   node scripts/push-to-cloud.mjs --recent 20        // đẩy mọi bài .json sửa trong 20 phút qua (mặc định 30)
//   node scripts/push-to-cloud.mjs --all              // đẩy tất cả bài của tất cả brand
//   node scripts/push-to-cloud.mjs <brandId> <pid>... // đẩy đúng vài bài chỉ định
//   thêm --no-render để chỉ đẩy nội dung, không bảo cloud render ảnh

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BRANDS = join(ROOT, "brands");

const URL_BASE = (process.env.CLOUD_URL || "").replace(/\/$/, "");
const PASS = process.env.CLOUD_PASSWORD || "";
if (!URL_BASE) { console.error("❌ Thiếu CLOUD_URL (link dashboard cloud)"); process.exit(1); }
const AUTH = PASS ? "Basic " + Buffer.from("user:" + PASS).toString("base64") : "";

const rj = p => { let s = readFileSync(p, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return JSON.parse(s); };
const listBrands = () => readdirSync(BRANDS).filter(d => existsSync(join(BRANDS, d, "config.json")));
const hdr = (json) => ({ ...(AUTH ? { Authorization: AUTH } : {}), ...(json ? { "Content-Type": "application/json" } : {}) });

const args = process.argv.slice(2);
const noRender = args.includes("--no-render");
const flags = args.filter(a => a.startsWith("--"));
const rest = args.filter(a => !a.startsWith("--"));

// Xác định danh sách bài cần đẩy: [{id, pid, file}]
function collect() {
  const out = [];
  const pushFile = (id, pid) => { const f = join(BRANDS, id, "posts", `${pid}.json`); if (existsSync(f)) out.push({ id, pid, file: f }); };
  if (rest.length >= 2) {                                   // <brandId> <pid>...
    const [id, ...pids] = rest; pids.forEach(pid => pushFile(id, pid));
  } else if (flags.includes("--all")) {
    for (const id of listBrands()) for (const f of readdirSync(join(BRANDS, id, "posts")).filter(x => x.endsWith(".json") && !x.startsWith("_"))) pushFile(id, f.replace(/\.json$/, ""));
  } else {                                                  // mặc định --recent N (phút)
    const i = flags.indexOf("--recent");
    const mins = i >= 0 && rest[0] ? Number(rest[0]) : 30;
    const cutoff = Date.now() - mins * 60000;
    for (const id of listBrands()) {
      const dir = join(BRANDS, id, "posts"); if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter(x => x.endsWith(".json") && !x.startsWith("_"))) {
        if (statSync(join(dir, f)).mtimeMs >= cutoff) pushFile(id, f.replace(/\.json$/, ""));
      }
    }
    console.log(`(chế độ --recent ${mins} phút)`);
  }
  return out;
}

async function pushOne({ id, pid, file }) {
  const post = rj(file);
  const body = { ...post, id: pid };                        // gửi id để cloud dùng đúng tên file
  const r = await fetch(`${URL_BASE}/api/brand/${encodeURIComponent(id)}/post`, { method: "POST", headers: hdr(true), body: JSON.stringify(body) });
  if (r.status === 401) throw new Error("401 — sai/thiếu CLOUD_PASSWORD");
  if (!r.ok) throw new Error(`post ${r.status}`);
  const j = await r.json(); const cloudPid = j.id || pid;
  let rendered = false;
  if (!noRender && post.card) {
    const rr = await fetch(`${URL_BASE}/api/brand/${encodeURIComponent(id)}/render/${encodeURIComponent(cloudPid)}`, { method: "POST", headers: hdr(true), body: "{}" });
    rendered = rr.ok;
  }
  return { id, pid: cloudPid, rendered };
}

const items = collect();
if (!items.length) { console.log("Không có bài nào để đẩy."); process.exit(0); }
console.log(`Đẩy ${items.length} bài lên ${URL_BASE} ...`);
let ok = 0, fail = 0;
for (const it of items) {
  try { const r = await pushOne(it); ok++; console.log(`  ✓ ${r.id}/${r.pid}${r.rendered ? " (đã render)" : ""}`); }
  catch (e) { fail++; console.log(`  ✗ ${it.id}/${it.pid}: ${String(e.message || e).slice(0, 80)}`); }
}
console.log(`\nXong: ${ok} ok, ${fail} lỗi.`);
