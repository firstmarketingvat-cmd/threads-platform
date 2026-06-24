// post-all.mjs — 모든 brand를 돌며 '지금 시각(KST) 기준 게시 예정 & 미게시' 글을 Threads에 게시.
// GitHub Actions에서 실행. 각 brand 토큰은 config의 *_secret 이름으로 env에서 읽음.
// 이미지 raw URL: https://raw.githubusercontent.com/<repo>/<ref>/brands/<id>/images/<date>.png
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REPO = process.env.GITHUB_REPOSITORY || "";
const REF = process.env.GITHUB_REF_NAME || "main";
const API = "https://graph.threads.net/v1.0";
const DRY = process.env.DRY_RUN === "1";

const rj = p => { let s = readFileSync(p, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return JSON.parse(s); };
const nowKstMs = Date.now() + 7 * 3600 * 1000; // VN/ICT (시간값을 -2h 변환했으므로 실제 게시 순간은 동일)
const schedKstMs = (date, hm) => Date.parse(`${date}T${hm}:00Z`);
const GRACE_MS = 6 * 3600 * 1000;

async function call(userId, token, path, params) {
  const res = await fetch(`${API}/${path}`, { method: "POST", body: new URLSearchParams({ ...params, access_token: token }) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const brandsDir = join(ROOT, "brands");
const brands = readdirSync(brandsDir).filter(d => existsSync(join(brandsDir, d, "config.json")));
let total = 0;

for (const id of brands) {
  const cfg = rj(join(brandsDir, id, "config.json"));
  const token = process.env[cfg.threads?.token_secret] || "";
  const userId = process.env[cfg.threads?.user_id_secret] || "";
  const postedFile = join(brandsDir, id, "posted.log");
  const posted = new Set(existsSync(postedFile) ? readFileSync(postedFile, "utf8").split(/\r?\n/).map(s=>s.trim()).filter(Boolean) : []);
  const postsDir = join(brandsDir, id, "posts");
  if (!existsSync(postsDir)) continue;
  const due = [];
  for (const f of readdirSync(postsDir).filter(f => f.endsWith(".json"))) {
    const pid = f.replace(/\.json$/, "");                 // postId = 파일명 (같은 날 여러 글 지원)
    const o = rj(join(postsDir, f));
    if (!o.date || !o.time_kst || posted.has(pid) || posted.has(o.date)) continue;
    const t = schedKstMs(o.date, o.time_kst);
    if (t <= nowKstMs && t >= nowKstMs - GRACE_MS) due.push({ o, pid });
  }
  if (!due.length) { console.log(`[${id}] 게시할 글 없음`); continue; }
  if (!token || !userId) { console.log(`[${id}] ⚠️ 토큰/유저ID 없음(secret 미설정) — 건너뜀`); continue; }

  for (const { o, pid } of due) {
    const imageUrl = `https://raw.githubusercontent.com/${REPO}/${REF}/brands/${id}/images/${pid}.png`;
    try {
      console.log(`[${id}] ▶ ${pid} ${o.time_kst} 게시`);
      if (DRY) { console.log(`   [DRY] ${imageUrl}`); continue; }
      const params = { media_type: "IMAGE", image_url: imageUrl, text: o.text };
      if (o.topic) params.topic_tag = o.topic;
      const created = await call(userId, token, `${userId}/threads`, params);
      await new Promise(r => setTimeout(r, 5000));
      const pub = await call(userId, token, `${userId}/threads_publish`, { creation_id: created.id });
      console.log(`   ✅ ${pub.id}`);
      let permalink = "";
      try { const pm = await (await fetch(`${API}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).json(); permalink = pm.permalink || ""; } catch {}
      appendFileSync(postedFile, pid + "\n");
      const pjFile = join(brandsDir, id, "posted.json");
      const map = existsSync(pjFile) ? rj(pjFile) : {};
      map[pid] = { id: pub.id, permalink, at: new Date().toISOString() };
      writeFileSync(pjFile, JSON.stringify(map, null, 2));
      console.log(`   🔗 ${permalink || "(no permalink)"}`);
      total++;
    } catch (e) { console.error(`   ❌ ${pid} 실패: ${e.message}`); }
  }
}
console.log(`완료: 총 ${total}건 게시 (brand ${brands.length}개 점검).`);
