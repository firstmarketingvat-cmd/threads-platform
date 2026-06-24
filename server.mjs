// server.mjs — Threads Multi-Brand Manager 로컬 대시보드 (의존성 없음, Node 내장 http)
// 실행: node server.mjs  → 브라우저에서 http://localhost:4000
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { deploy as ghDeploy } from "./lib/github-deploy.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, extname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const BRANDS = join(ROOT, "brands");
const PORT = process.env.PORT || 4000;
// Mật khẩu chung: chỉ bật khi có env DASH_PASSWORD (cloud). Local không set => không cần đăng nhập.
const DASH_PASSWORD = process.env.DASH_PASSWORD || "";
function checkAuth(req, res) {
  if (!DASH_PASSWORD) return true;                       // local: bỏ qua
  const h = req.headers["authorization"] || "";
  if (h.startsWith("Basic ")) {
    try { const dec = Buffer.from(h.slice(6), "base64").toString("utf8"); const pass = dec.slice(dec.indexOf(":") + 1); if (pass === DASH_PASSWORD) return true; } catch {}
  }
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Threads Manager", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
  res.end("🔒 Cần mật khẩu để truy cập");
  return false;
}

const readJson = p => { let s = readFileSync(p, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return JSON.parse(s); };
const listBrands = () => readdirSync(BRANDS).filter(d => existsSync(join(BRANDS, d, "config.json")));
// 브랜드마다 서로 다른 카드 디자인 자동 배정 (이미 쓰는 스타일은 건너뜀)
const STYLE_ROTATION = ["photo", "note", "cert", "editorial", "bold", "dark"];
const COLOR_ROTATION = ["#e8252f", "#25f82b", "#f8c807", "#2f6df8", "#f8632f", "#a02ff8", "#1fb6a6", "#e23b8b"];
function usedStyles() {
  return new Set(listBrands().map(id => { try { return readJson(join(BRANDS, id, "config.json")).card_style; } catch { return null; } }).filter(Boolean));
}
function usedColors() {
  return new Set(listBrands().map(id => { try { return (readJson(join(BRANDS, id, "config.json")).colors || {}).red; } catch { return null; } }).filter(Boolean));
}
function nextStyle() {
  const used = usedStyles();
  return STYLE_ROTATION.find(s => !used.has(s)) || STYLE_ROTATION[used.size % STYLE_ROTATION.length];
}
function nextColor() {
  const used = usedColors();
  return COLOR_ROTATION.find(c => !used.has(c)) || COLOR_ROTATION[used.size % COLOR_ROTATION.length];
}
function postedMap(id) {
  const jf = join(BRANDS, id, "posted.json");
  if (existsSync(jf)) { try { return readJson(jf); } catch { return {}; } }
  const lf = join(BRANDS, id, "posted.log"); // back-compat: log → map(빈 permalink)
  if (existsSync(lf)) { const m = {}; readFileSync(lf, "utf8").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach(d => m[d] = {}); return m; }
  return {};
}
function savePosted(id, map) { writeFileSync(join(BRANDS, id, "posted.json"), JSON.stringify(map, null, 2), "utf8"); }
function brandPosts(id) {
  const dir = join(BRANDS, id, "posts");
  if (!existsSync(dir)) return [];
  const posted = postedMap(id);
  return readdirSync(dir).filter(f=>f.endsWith(".json")).map(f => {
    const pid = f.replace(/\.json$/, "");        // postId = 파일명(날짜와 분리)
    const o = readJson(join(dir, f));
    const hasImg = existsSync(join(BRANDS, id, "images", `${pid}.png`));
    const pinfo = posted[pid] || posted[o.date]; // back-compat: 옛 posted는 날짜 키
    const status = pinfo ? "posted" : (hasImg ? "scheduled" : "draft");
    return { ...o, id: pid, status, hasImg, permalink: pinfo && pinfo.permalink || "" };
  }).sort((a,b)=> ((a.date||"")+(a.time_kst||"")).localeCompare((b.date||"")+(b.time_kst||"")));
}

function send(res, code, body, type="application/json") {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req){ return new Promise(r=>{let d="";req.on("data",c=>d+=c);req.on("end",()=>r(d?JSON.parse(d):{}));}); }

function genPrompt(cfg, posts = []){
  const existing = (posts || [])
    .slice().sort((a,b)=>(a.date||"").localeCompare(b.date||""))
    .map(p => `- ${p.date} [${p.topic || "-"}] ${String(p.text || "").replace(/\s+/g, " ").slice(0, 45)}…`)
    .join("\n");
  return `당신은 Threads 콘텐츠 전략 전문가입니다. 아래 브랜드의 14일치(또는 요청 일수) 콘텐츠를 기획·작성하세요.

브랜드: ${cfg.name} (${cfg.name_local}) — ${cfg.threads_url}
언어: ${cfg.language}
보이스 요약: ${cfg.voice_summary}

규칙:
- 소스: 고정 순서 ❌. 그 글에 '가장 좋은·흥미로운·믿을 만한' 소스가 뭔지 판단해서 우선한다. Threads(자국민 인사이더 + 현지 유저), 뉴스(NaverSearch 등), 공식/전문, 현지 언어(베트남어·중국어 등) 유저·기관을 폭넓게 두고 그 글의 앵글에 맞는 걸 고를 것. 단 사실(날짜·법·수치)은 어느 나라든 공식 소스로 못박기. 현지/외국어 소스는 '남들이 안 다룬 생생한 각도·현지 쪽 사실'이 있을 때 적극 활용(번안+재구성, 베끼기 금지).
- 최신순·30일 이내·기준시점 명시. 정책/수치는 사실검증(⚠️). 기존 채널 글과 중복 금지.
- 보이스는 채널 그대로(번역체 금지). 이모지 절제. CTA는 3글 중 1개만 가볍게, 나머지는 인사이트/질문/여운으로 마무리(끝맺음 다양). 번안+재구성. 글마다 주제태그 1개(해시태그 더미 금지).
- 호기심 갭(떡밥)은 일부 글만(≤1/3): 핵심 답/마지막 항목을 살짝 늦게 공개하거나 '댓글에' 식으로 가려 더보기·댓글 유도. 카드는 {cover, hint}로 마지막 항목 블러 가능. 단 과장·낚시 금지(진짜 정보를 한 박자 늦게).
- ⚠️ 중복 금지: 아래 '이미 저장된 글'의 주제·앵글과 절대 겹치지 말 것. 새 글은 이 목록에 없는 소재·관점으로만.
[이미 저장된 글 — 중복 금지]
${existing || "(아직 없음)"}

- 출력: 각 글에 {날짜,시간,주제태그,본문,sources,카드}.
  · sources(소재) = 그 글을 쓰기 위해 크롤링·수집한 출처를 모아 적기. 각 줄: "URL — 한 줄 요약(누가/무슨 내용/왜 참고)". 2~5개. 대시보드 글 옆 '📎 소재' 패널에 그대로 붙여넣을 수 있게.
  · 카드 = 가능하면 {kicker,headline,body,tag}.
- 결과를 이 대시보드 "글 추가" 칸 형식(JSON 배열: date,time_kst,topic,text,sources,card)으로 주면 바로 붙여넣기 쉬움.`;
}

const DEPLOY_CFG = join(ROOT, "deploy.json");
const readDeployCfg = () => {
  // Ưu tiên env (cloud): GH_DEPLOY_TOKEN + GH_DEPLOY_REPO. Fallback file deploy.json (local).
  if (process.env.GH_DEPLOY_TOKEN && process.env.GH_DEPLOY_REPO)
    return { token: process.env.GH_DEPLOY_TOKEN, repo: process.env.GH_DEPLOY_REPO, branch: process.env.GH_DEPLOY_BRANCH || "main" };
  return existsSync(DEPLOY_CFG) ? readJson(DEPLOY_CFG) : null;
};
function collectDeployFiles() {
  const files = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      if (name.startsWith("_")) continue; // bỏ file tạm (_card.html, _*.json)
      const a = join(abs, name), r = rel ? `${rel}/${name}` : name;
      if (statSync(a).isDirectory()) walk(a, r);
      else files.push({ path: r, contentBuffer: readFileSync(a) });
    }
  };
  if (existsSync(join(ROOT, "brands"))) walk(join(ROOT, "brands"), "brands");
  files.push({ path: "scripts/post-all.mjs", contentBuffer: readFileSync(join(ROOT, "scripts", "post-all.mjs")) });
  files.push({ path: ".github/workflows/post.yml", contentBuffer: readFileSync(join(ROOT, ".github", "workflows", "post.yml")) });
  return files;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  if (!checkAuth(req, res)) return;                       // chặn nếu cloud + sai/thiếu mật khẩu
  try {
    if (p === "/" || p === "/index.html") return send(res, 200, readFileSync(join(ROOT,"public","index.html")), "text/html; charset=utf-8");
    if (p === "/api/brands") return send(res, 200, listBrands().map(id => {
      const cfg = readJson(join(BRANDS,id,"config.json"));
      const posts = brandPosts(id);
      const c = { total: posts.length, posted: posts.filter(x=>x.status==="posted").length, scheduled: posts.filter(x=>x.status==="scheduled").length, draft: posts.filter(x=>x.status==="draft").length };
      return { id, name: cfg.name, name_local: cfg.name_local, language: cfg.language, colors: cfg.colors, threads_url: cfg.threads_url, card_style: cfg.card_style, counts: c };
    }));
    let m;
    if ((m = p.match(/^\/api\/brand\/([^/]+)$/))) {
      const cfg = readJson(join(BRANDS,m[1],"config.json"));
      return send(res, 200, { config: cfg, posts: brandPosts(m[1]) });
    }
    if ((m = p.match(/^\/api\/brand\/([^/]+)\/prompt$/))) {
      return send(res, 200, { prompt: genPrompt(readJson(join(BRANDS,m[1],"config.json")), brandPosts(m[1])) });
    }
    if ((m = p.match(/^\/img\/([^/]+)\/([^/]+)\.png$/))) {
      const f = join(BRANDS,m[1],"images",`${m[2]}.png`);
      if (!existsSync(f)) return send(res,404,"no img","text/plain");
      return send(res,200, readFileSync(f), "image/png");
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/brand\/([^/]+)\/post$/))) {
      const id = m[1]; const b = await readBody(req);
      if (!b.date || !b.time_kst) return send(res,400,{error:"date/time 필요"});
      const dir = join(BRANDS,id,"posts"); if(!existsSync(dir)) mkdirSync(dir,{recursive:true});
      const out = { date:b.date, time_kst:b.time_kst, topic:b.topic||"", text:b.text||"", sources:b.sources||"" };
      if (b.card) out.card = b.card;
      if (b.style) out.style = b.style;
      // postId: 수정이면 기존 id 유지(파일 이름 = id, 날짜는 필드일 뿐). 신규면 날짜 기반 고유 id 생성(같은 날 여러 글 OK)
      let pid = b.id;
      if (!pid) { pid = b.date; let n = 2; while (existsSync(join(dir, `${pid}.json`))) pid = `${b.date}-${n++}`; }
      writeFileSync(join(dir,`${pid}.json`), JSON.stringify(out,null,2), "utf8");
      return send(res,200,{ok:true, id:pid});
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/brand\/([^/]+)\/render\/([^/]+)$/))) {
      const id=m[1], pid=m[2];
      const pf = join(BRANDS,id,"posts",`${pid}.json`);
      const post = readJson(pf);
      if (!post.card) return send(res,400,{error:"card 필드 없음 (kicker/headline/body/tag 채워야 함)"});
      const b = await readBody(req);
      if (b && b.shuffle) { post.card.photoIndex = (post.card.photoIndex || 0) + 1; writeFileSync(pf, JSON.stringify(post,null,2),"utf8"); }
      const cfg = readJson(join(BRANDS,id,"config.json"));
      const style = post.style || cfg.card_style || "";
      const tmp = join(BRANDS,id,"images",`_${pid}.card.json`);
      writeFileSync(tmp, JSON.stringify(post.card), "utf8");
      const args = [join(ROOT,"lib","render-card.mjs"), id, tmp, join(BRANDS,id,"images",`${pid}.png`)];
      if (style) args.push(style);
      try { execFileSync(process.execPath, args, {stdio:"ignore", timeout:90000}); }
      catch(e){ return send(res,500,{error:"render 실패: "+String(e.message||e).slice(0,300)}); }
      return send(res,200,{ok:true});
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/brand\/([^/]+)\/config$/))) {
      const fp = join(BRANDS, m[1], "config.json");
      const cfg = readJson(fp); const b = await readBody(req);
      if (b.colors) cfg.colors = { ...cfg.colors, ...b.colors };
      for (const k of ["name", "name_local", "voice_summary", "threads_url", "language", "card_style"]) if (b[k] != null) cfg[k] = b[k];
      writeFileSync(fp, JSON.stringify(cfg, null, 2), "utf8");
      return send(res, 200, { ok: true, config: cfg });
    }
    if (req.method === "POST" && p === "/api/brand") {
      const b = await readBody(req);
      if (!b.id) return send(res,400,{error:"id 필요"});
      const dir = join(BRANDS,b.id); ["", "posts","images"].forEach(s=>{const d=join(dir,s);if(!existsSync(d))mkdirSync(d,{recursive:true});});
      const accent = (b.colors && b.colors.red) || nextColor();       // 새 브랜드 = 다른 강조색
      const style = b.card_style || nextStyle();                       // 새 브랜드 = 다른 디자인 자동 배정
      const secretId = b.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");   // env 시크릿명은 영숫자만
      const cfg = { id:b.id, name:b.name||b.id, name_local:b.name_local||"", language:b.language||"ko", threads_url:b.threads_url||"",
        colors:b.colors||{ink:"#222222",red:accent,bg:"#ffffff",muted:"#6b6b6b"}, voice_summary:b.voice_summary||"",
        threads:{ user_id_secret:`THREADS_USERID_${secretId}`, token_secret:`THREADS_TOKEN_${secretId}` },
        schedule:{ weekday:["08:30","21:00"], weekend:["10:30","20:30"], timezone:"Asia/Seoul" },
        card_style: style };
      writeFileSync(join(dir,"config.json"), JSON.stringify(cfg,null,2),"utf8");
      return send(res,200,{ok:true,config:cfg});
    }
    if (req.method === "DELETE" && (m = p.match(/^\/api\/brand\/([^/]+)\/post\/([^/]+)$/))) {
      const fp = join(BRANDS, m[1], "posts", `${m[2]}.json`);
      if (existsSync(fp)) rmSync(fp);
      const img = join(BRANDS, m[1], "images", `${m[2]}.png`);
      if (existsSync(img)) rmSync(img);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/calendar") {
      const rows = [];
      for (const id of listBrands()) {
        const cfg = readJson(join(BRANDS, id, "config.json"));
        for (const po of brandPosts(id)) rows.push({ brand: id, brandName: cfg.name, color: cfg.colors.red, id: po.id, date: po.date, time_kst: po.time_kst, topic: po.topic, status: po.status, hasImg: po.hasImg, permalink: po.permalink });
      }
      rows.sort((a, b) => (a.date + a.time_kst).localeCompare(b.date + b.time_kst));
      return send(res, 200, rows);
    }
    if ((m = p.match(/^\/api\/brand\/([^/]+)\/posted\/([^/]+)$/))) {
      const id = m[1], date = m[2];
      const map = postedMap(id);
      if (req.method === "POST") {
        const b = await readBody(req);
        map[date] = { permalink: b.permalink || "", at: new Date().toISOString(), manual: true };
        savePosted(id, map); return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE") { delete map[date]; savePosted(id, map); return send(res, 200, { ok: true }); }
    }
    if (req.method === "POST" && p === "/api/sync") {
      const dc = readDeployCfg();
      let merged = 0;
      for (const id of listBrands()) {
        const cfg = readJson(join(BRANDS, id, "config.json"));
        const repo = cfg.live_repo || (dc && dc.repo);   // ưu tiên repo brand đang đăng thật
        if (!repo) continue;
        const branch = (dc && dc.branch) || "main";
        const local = postedMap(id); let changed = false;
        const t = Date.now();
        const mergeMap = (obj) => { for (const [date, info] of Object.entries(obj)) { if (!local[date] || (info && info.permalink && !local[date].permalink)) { local[date] = info || {}; changed = true; merged++; } } };
        const logToMap = (txt) => { const o = {}; txt.split(/\r?\n/).map(s=>s.replace(/^﻿/,"").trim()).filter(Boolean).forEach(d => o[d] = local[d] || {}); return o; };
        // thử nhiều đường dẫn: multi-brand (brands/<id>/...) + single-brand cũ (gốc)
        for (const path of [`brands/${id}/posted.json`, `posted.json`]) {
          try { const r = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${path}?t=${t}`); if (r.ok) { mergeMap(await r.json()); break; } } catch {}
        }
        for (const path of [`brands/${id}/posted.log`, `posted.log`]) {
          try { const r = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${path}?t=${t}`); if (r.ok) { mergeMap(logToMap(await r.text())); break; } } catch {}
        }
        if (changed) savePosted(id, local);
      }
      return send(res, 200, { ok: true, out: `Đồng bộ ${merged} bài đã đăng (từ repo đang chạy của mỗi brand)` });
    }
    if (p === "/api/pexels-key") {
      const kf = join(ROOT, ".pexels-key");
      if (req.method === "GET") return send(res, 200, { configured: existsSync(kf) });
      if (req.method === "POST") { const b = await readBody(req); writeFileSync(kf, String(b.key || "").trim(), "utf8"); return send(res, 200, { ok: !!String(b.key||"").trim() }); }
    }
    const pexKey = () => { let k = process.env.PEXELS_KEY || ""; const kf = join(ROOT, ".pexels-key"); if (!k && existsSync(kf)) { let s = readFileSync(kf, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); k = s.trim(); } return k; };
    if (p === "/api/pexels-search") {
      const q = u.searchParams.get("q") || ""; const key = pexKey();
      if (!key) return send(res, 200, { photos: [], error: "no-key" });
      if (!q.trim()) return send(res, 200, { photos: [] });
      try {
        const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=portrait&size=medium&per_page=18`, { headers: { Authorization: key } });
        const j = await r.json();
        return send(res, 200, { photos: (j.photos || []).map(ph => ({ id: ph.id, thumb: ph.src.tiny || ph.src.small, url: ph.src.portrait || ph.src.large2x || ph.src.large })) });
      } catch (e) { return send(res, 200, { photos: [], error: String(e.message || e) }); }
    }
    if (req.method === "POST" && (m = p.match(/^\/api\/brand\/([^/]+)\/upload$/))) {
      const id = m[1]; const b = await readBody(req);
      if (!b.dataUrl) return send(res, 400, { error: "no image" });
      const ext = ((b.dataUrl.match(/^data:image\/([a-zA-Z0-9]+);/) || [])[1] || "jpg").replace("jpeg", "jpg");
      const fn = `_up_${String(b.postId || "x").replace(/[^a-zA-Z0-9_-]/g, "")}_${String(Date.now()).slice(-6)}.${ext}`;
      writeFileSync(join(BRANDS, id, "images", fn), Buffer.from(b.dataUrl.replace(/^data:[^,]+,/, ""), "base64"));
      return send(res, 200, { ok: true, file: fn });
    }
    if ((m = p.match(/^\/upimg\/([^/]+)\/([^/]+)$/))) {
      const f = join(BRANDS, m[1], "images", m[2]);
      if (!existsSync(f)) return send(res, 404, "no", "text/plain");
      return send(res, 200, readFileSync(f), "image/jpeg");
    }
    if (p === "/api/deploy-config") {
      if (req.method === "GET") { const c = readDeployCfg(); return send(res, 200, { configured: !!(c && c.token && c.repo), repo: (c && c.repo) || "" }); }
      if (req.method === "POST") { const b = await readBody(req); writeFileSync(DEPLOY_CFG, JSON.stringify({ repo: b.repo, token: b.token, branch: b.branch || "main" }, null, 2), "utf8"); return send(res, 200, { ok: true }); }
    }
    if (req.method === "POST" && p === "/api/deploy") {
      const c = readDeployCfg();
      if (!c || !c.token || !c.repo) return send(res, 200, { ok: false, needsConfig: true, out: "Chưa cấu hình repo/token deploy." });
      try {
        const files = collectDeployFiles();
        const r = await ghDeploy({ repo: c.repo, token: c.token, branch: c.branch || "main", files, message: "deploy from dashboard" });
        return send(res, 200, { ok: true, out: `✅ Đã đẩy ${r.files} file lên ${c.repo} (commit ${r.commit.slice(0,7)})` });
      } catch (e) { return send(res, 200, { ok: false, out: String(e.message || e).slice(0, 1500) }); }
    }
    send(res,404,"not found","text/plain");
  } catch (e) { send(res,500,{error:String(e.message||e)}); }
});
server.listen(PORT, ()=> console.log(`\n  Threads Multi-Brand Manager → http://localhost:${PORT}\n`));
