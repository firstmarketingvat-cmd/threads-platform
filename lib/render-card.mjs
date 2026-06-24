// render-card.mjs — brand별 색상으로 카드 이미지 생성 (HTML→PNG, 의존성 없음)
// 사용: node lib/render-card.mjs <brandId> <cardJsonPath> [out.png] [style]
//   cardJson: { kicker, headline, body, tag, cover?, hint? }  (headline/body/cover에서 \n 줄바꿈, *강조* 지원)
//   style: editorial | bold | dark   (없으면 config.card_style → 기본 editorial)
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const [, , brandId, cardPath, outArg, styleArg] = process.argv;
if (!brandId || !cardPath) { console.error("사용: node lib/render-card.mjs <brandId> <cardJson> [out.png] [style]"); process.exit(1); }
const rj = p => { let s = readFileSync(p, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return JSON.parse(s); };
const cfg = rj(join(ROOT, "brands", brandId, "config.json"));
const C = cfg.colors;
const data = rj(resolve(cardPath));
const outPath = resolve(outArg || join(ROOT, "brands", brandId, "images", "card.png"));
const wordmark = (cfg.name || brandId).toLowerCase().replace(/\s+/g, "");
const STYLE = (styleArg || cfg.card_style || "editorial").toLowerCase();

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;  // cloud/Linux
  const base = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) if (d.startsWith("chromium_headless_shell")) {
    const p = join(base, d, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    if (existsSync(p)) return p;
  }
  return null;
}
const CHROME = findChrome();
if (!CHROME) { console.error("chrome-headless-shell 없음 (ms-playwright)"); process.exit(1); }

const W = 1080, H = 1350;
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// *강조* → 브랜드색 하이라이트, \n → 줄바꿈
const ml = (s = "") => esc(s).replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>').replace(/\n/g, "<br>");

const FONT = `'Pretendard','Pretendard Variable','Malgun Gothic','맑은 고딕','Segoe UI',sans-serif`;
const PRETENDARD = `@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');`;

const wmHtml = `<span class="wm">${esc(wordmark)}<span class="dot">.</span></span>`;
const tagHtml = `<span class="tag">${esc(data.tag || cfg.name_local || "")}</span>`;
const coverHtml = `<div class="cover"><div class="cv">${ml(data.cover)}</div><span class="hint">👀 ${esc(data.hint || "답은 댓글에서")}</span></div>`;
let illusHtml = "";
if (data.illustration) {
  try {
    const cand = [resolve(dirname(resolve(cardPath)), data.illustration), resolve(data.illustration)];
    const f = cand.find(existsSync);
    if (f) illusHtml = `<div class="illus">${readFileSync(f, "utf8")}</div>`;
  } catch {}
}
const midHtml = data.cover ? coverHtml : (illusHtml || `<div class="spacer"></div>`);
let bgUrl = "";
if (data.photoFile) { try { const cand = [resolve(dirname(resolve(cardPath)), data.photoFile), resolve(data.photoFile)]; const f = cand.find(existsSync); if (f) bgUrl = pathToFileURL(f).href; } catch {} }
if (!bgUrl && data.photoUrl) bgUrl = data.photoUrl;
// photoQuery 있으면 Pexels에서 자동으로 사진 받아 배경으로 (style=photo)
if (!bgUrl && data.photoQuery) {
  try {
    const keyFile = join(ROOT, ".pexels-key");
    let key = process.env.PEXELS_KEY || "";
    if (!key && existsSync(keyFile)) { let s = readFileSync(keyFile, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); key = s.trim(); }
    if (key) {
      const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(data.photoQuery)}&orientation=portrait&size=large&per_page=10`, { headers: { Authorization: key } });
      if (r.ok) {
        const ph = ((await r.json()).photos || [])[0];
        if (ph) {
          const ir = await fetch(ph.src.portrait || ph.src.large2x || ph.src.large || ph.src.original);
          if (ir.ok) {
            const stem = basename(outPath).replace(/\.png$/i, "") || "bg";
            const bgf = join(ROOT, "brands", brandId, "images", `_${stem}.bg.jpg`);
            writeFileSync(bgf, Buffer.from(await ir.arrayBuffer()));
            bgUrl = pathToFileURL(bgf).href;
          }
        }
      }
    }
  } catch {}
}

// 모든 스타일에서 실제 사진을 흐릿한 배경으로 깔 수 있음 (bgUrl 있을 때만)
const WASH = bgUrl ? `<div class="bgwash" style="background-image:url('${bgUrl}')"></div>` : "";
// 밝은/어두운 베이스용 흐림 배경 CSS (opacity로 가독성 유지)
const bgOp = (data.bgOpacity != null && data.bgOpacity !== "") ? Math.max(0, Math.min(0.9, Number(data.bgOpacity) / 100)) : null;
const washCss = (dark) => `.bgwash{position:absolute;inset:0;z-index:-1;background:#000 center/cover no-repeat;filter:blur(10px);transform:scale(1.08);opacity:${bgOp != null ? bgOp : (dark ? ".26" : ".15")}}`;

function build(style) {
  if (style === "photo") {
    return `<style>${PRETENDARD}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{font-family:${FONT};background:#1a1a1a;color:#fff;-webkit-font-smoothing:antialiased}
.card{position:relative;width:${W}px;height:${H}px;overflow:hidden}
.bg{position:absolute;inset:0;background:#222 center/cover no-repeat;${bgUrl ? `background-image:url('${bgUrl}')` : ""}}
.scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45) 0%,rgba(0,0,0,.05) 28%,rgba(0,0,0,.45) 58%,rgba(0,0,0,.9) 100%)}
.kicker{position:absolute;top:84px;left:90px;background:${C.red};color:#fff;font-weight:800;font-size:30px;letter-spacing:1px;padding:12px 26px;border-radius:8px}
.content{position:absolute;left:90px;right:90px;bottom:84px}
.headline{font-size:84px;font-weight:800;line-height:1.16;letter-spacing:-1px;color:#fff;word-break:keep-all;text-shadow:0 3px 24px rgba(0,0,0,.5)}
.headline .hl{color:#fff;background:${C.red};padding:0 14px;border-radius:8px}
.body{margin-top:26px;font-size:38px;line-height:1.5;color:#f2f2f2;word-break:keep-all;text-shadow:0 2px 16px rgba(0,0,0,.6)}
.footer{display:flex;align-items:center;justify-content:space-between;margin-top:38px;padding-top:30px;border-top:1.5px solid rgba(255,255,255,.3)}
.wm{font-size:38px;font-weight:800;letter-spacing:-.5px;color:#fff}.wm .dot{color:${C.red}}
.tag{color:#e6e6e6;font-size:30px;font-weight:700}
</style>
<div class="card"><div class="bg"></div><div class="scrim"></div>
  ${data.kicker ? `<div class="kicker">${esc(data.kicker)}</div>` : ""}
  <div class="content">
    <div class="headline">${ml(data.headline)}</div>
    ${data.body ? `<div class="body">${ml(data.body)}</div>` : ""}
    <div class="footer">${wmHtml}${tagHtml}</div>
  </div>
</div>`;
  }
  if (style === "bold") {
    return `<style>${PRETENDARD}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{font-family:${FONT};background:#ffffff;color:${C.ink};-webkit-font-smoothing:antialiased}
.card{width:${W}px;height:${H}px;display:flex;flex-direction:column;position:relative;isolation:isolate}
${washCss(false)}
.band{background:${C.red};color:#fff;padding:120px 96px 84px}
.kk{font-weight:700;font-size:30px;letter-spacing:3px;opacity:.92;text-transform:uppercase}
.headline{margin-top:30px;font-size:88px;font-weight:800;line-height:1.12;letter-spacing:-1.5px;word-break:keep-all}
.headline .hl{background:#ffffff;color:${C.red};padding:0 12px;border-radius:6px}
.lower{flex:1;padding:64px 96px 84px;display:flex;flex-direction:column}
.body{font-size:42px;line-height:1.5;color:${C.ink};opacity:.9;word-break:keep-all}
.body .hl{color:${C.red};font-weight:800}
.spacer{flex:1}
.illus{flex:1;display:flex;align-items:center;justify-content:center;margin-top:20px}.illus svg{width:100%;height:auto;max-height:620px}
.cover{position:relative;flex:1;margin-top:24px}
.cover .cv{filter:blur(12px);font-size:44px;font-weight:800;line-height:1.5;color:${C.ink};opacity:.85;word-break:keep-all;user-select:none}
.cover .hint{position:absolute;left:0;top:6px;background:${C.red};color:#fff;font-weight:800;font-size:30px;padding:10px 22px;border-radius:10px}
.footer{display:flex;align-items:center;justify-content:space-between;border-top:2px solid ${C.ink}1a;padding-top:34px;margin-top:34px}
.wm{font-size:40px;font-weight:800;letter-spacing:-.5px}.wm .dot{color:${C.red}}
.tag{color:${C.muted};font-size:30px;font-weight:700}
</style>
<div class="card">${WASH}
  <div class="band">${data.kicker ? `<div class="kk">${esc(data.kicker)}</div>` : ""}<div class="headline">${ml(data.headline)}</div></div>
  <div class="lower"><div class="body">${ml(data.body || "")}</div>${midHtml}
  <div class="footer">${wmHtml}${tagHtml}</div></div>
</div>`;
  }
  if (style === "dark") {
    const BG = "#15130f", FG = "#f4f1ea", SUB = "#b9b4a8";
    return `<style>${PRETENDARD}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{font-family:${FONT};background:${BG};color:${FG};-webkit-font-smoothing:antialiased}
.card{width:${W}px;height:${H}px;display:flex;flex-direction:column;padding:120px 104px 100px;position:relative;isolation:isolate}
${washCss(true)}
.card:before{content:"";position:absolute;top:0;left:0;width:14px;height:${H}px;background:${C.red};z-index:1}
.eyebrow{display:flex;align-items:center;gap:18px}
.kk{color:${C.red};font-weight:700;font-size:30px;letter-spacing:3px;text-transform:uppercase}
.headline{margin-top:50px;font-size:86px;font-weight:800;line-height:1.14;letter-spacing:-1.5px;color:${FG};word-break:keep-all}
.headline .hl{color:${C.red}}
.divider{margin-top:44px;width:96px;height:8px;background:${C.red};border-radius:4px}
.body{margin-top:42px;font-size:40px;line-height:1.55;color:${SUB};word-break:keep-all}
.body .hl{color:${FG};font-weight:800}
.spacer{flex:1}
.illus{flex:1;display:flex;align-items:center;justify-content:center;margin-top:20px}.illus svg{width:100%;height:auto;max-height:620px}
.cover{position:relative;flex:1;margin-top:26px}
.cover .cv{filter:blur(12px);font-size:42px;font-weight:800;line-height:1.5;color:${SUB};word-break:keep-all;user-select:none}
.cover .hint{position:absolute;left:0;top:8px;background:${C.red};color:#fff;font-weight:800;font-size:30px;padding:10px 22px;border-radius:10px}
.footer{display:flex;align-items:center;justify-content:space-between;border-top:2px solid #ffffff1f;padding-top:34px}
.wm{font-size:40px;font-weight:800;letter-spacing:-.5px;color:${FG}}.wm .dot{color:${C.red}}
.tag{color:${SUB};font-size:30px;font-weight:700}
</style>
<div class="card">${WASH}
  <div class="eyebrow">${data.kicker ? `<div class="kk">${esc(data.kicker)}</div>` : ""}</div>
  <div class="headline">${ml(data.headline)}</div><div class="divider"></div>
  <div class="body">${ml(data.body || "")}</div>${midHtml}
  <div class="footer">${wmHtml}${tagHtml}</div>
</div>`;
  }
  if (style === "note") {
    // redtrans — 메모지/형광펜 느낌: 종이 배경, 둥근 탭, 하이라이터 헤드라인, 점선 구분
    const PAPER = "#fffdf5";
    return `<style>${PRETENDARD}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{font-family:${FONT};background:${PAPER};color:${C.ink};-webkit-font-smoothing:antialiased}
.card{width:${W}px;height:${H}px;display:flex;flex-direction:column;padding:108px 98px 96px;position:relative;background:${PAPER};isolation:isolate}
${washCss(false)}
.card:before{content:"";position:absolute;top:0;left:0;right:0;height:18px;background:${C.red};z-index:1}
.tab{align-self:flex-start;display:inline-flex;align-items:center;gap:14px;background:#fff;color:${C.red};border:3px solid ${C.red};font-weight:800;font-size:30px;letter-spacing:1px;padding:13px 30px;border-radius:999px;box-shadow:0 6px 0 ${C.red}26}
.headline{margin-top:54px;font-size:82px;font-weight:800;line-height:1.26;letter-spacing:-1px;color:${C.ink};word-break:keep-all}
.headline .hl{background:linear-gradient(180deg,transparent 0 50%,${C.red}5c 50% 94%,transparent 94%);padding:0 8px;border-radius:3px}
.body{margin-top:46px;font-size:39px;line-height:1.62;color:${C.ink};opacity:.88;word-break:keep-all;padding-left:34px;border-left:8px solid ${C.red}59}
.body .hl{color:${C.red};font-weight:800;opacity:1}
.spacer{flex:1}.illus{flex:1}
.footer{display:flex;align-items:center;justify-content:space-between;border-top:4px dashed ${C.red}66;padding-top:36px;margin-top:auto}
.wm{font-size:40px;font-weight:800;letter-spacing:-.5px;color:${C.ink}}.wm .dot{color:${C.red}}
.tag{color:${C.muted};font-size:30px;font-weight:700}
</style>
<div class="card">${WASH}
  <div class="tab">${data.kicker ? `📝 ${esc(data.kicker)}` : "📝 메모"}</div>
  <div class="headline">${ml(data.headline)}</div>
  ${data.body ? `<div class="body">${ml(data.body)}</div>` : ""}
  <div class="spacer"></div>
  <div class="footer">${wmHtml}${tagHtml}</div>
</div>`;
  }
  if (style === "cert") {
    // redtrans.official — 인증서 느낌: 가운데 정렬, 이중 테두리, 원형 인장, 다이아 구분선
    const BG = "#13110c", FG = "#f6f1e6", SUB = "#cbc3ad", GOLD = C.red;
    return `<style>${PRETENDARD}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{font-family:${FONT};background:${BG};color:${FG};-webkit-font-smoothing:antialiased}
.card{width:${W}px;height:${H}px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;padding:118px 110px 104px;isolation:isolate}
${washCss(true)}
.frame{position:absolute;inset:40px;border:3px solid ${GOLD}80;pointer-events:none;z-index:1}
.frame:after{content:"";position:absolute;inset:13px;border:1.5px solid ${GOLD}40}
.top{display:flex;flex-direction:column;align-items:center;gap:30px;z-index:1}
.seal{width:118px;height:118px;border-radius:50%;border:3px solid ${GOLD};display:flex;align-items:center;justify-content:center;font-size:54px}
.kk{color:${GOLD};font-weight:700;font-size:30px;letter-spacing:6px;text-transform:uppercase}
.mid{z-index:1}
.headline{font-size:80px;font-weight:800;line-height:1.22;letter-spacing:-1px;color:${FG};word-break:keep-all}
.headline .hl{color:${GOLD}}
.orn{display:flex;align-items:center;justify-content:center;gap:18px;margin:42px 0}
.orn .ln{width:120px;height:2px;background:${GOLD}80}.orn .dm{color:${GOLD};font-size:26px}
.body{font-size:38px;line-height:1.6;color:${SUB};word-break:keep-all;max-width:780px;margin:0 auto}
.body .hl{color:${FG};font-weight:800}
.footer{z-index:1;display:flex;flex-direction:column;align-items:center;gap:14px}
.footer .rule{width:200px;height:1.5px;background:${GOLD}66}
.wm{font-size:38px;font-weight:800;letter-spacing:1px;color:${FG}}.wm .dot{color:${GOLD}}
.tag{color:${SUB};font-size:28px;font-weight:700;letter-spacing:1px}
</style>
<div class="card">${WASH}<div class="frame"></div>
  <div class="top"><div class="seal">🏛️</div>${data.kicker ? `<div class="kk">${esc(data.kicker)}</div>` : ""}</div>
  <div class="mid">
    <div class="headline">${ml(data.headline)}</div>
    <div class="orn"><span class="ln"></span><span class="dm">◆</span><span class="ln"></span></div>
    ${data.body ? `<div class="body">${ml(data.body)}</div>` : ""}
  </div>
  <div class="footer"><span class="rule"></span>${wmHtml}${tagHtml}</div>
</div>`;
  }
  // editorial (default) — 밝고 미니멀한 프리미엄
  return `<style>${PRETENDARD}
*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px}
body{font-family:${FONT};background:#ffffff;color:${C.ink};-webkit-font-smoothing:antialiased}
.card{width:${W}px;height:${H}px;display:flex;flex-direction:column;padding:124px 108px 104px;position:relative;isolation:isolate}
${washCss(false)}
.eyebrow{display:flex;align-items:center;gap:20px;color:${C.red};font-weight:700;font-size:30px;letter-spacing:2.5px;text-transform:uppercase}
.eyebrow .bar{width:56px;height:7px;background:${C.red};border-radius:4px}
.headline{margin-top:52px;font-size:84px;font-weight:800;line-height:1.15;letter-spacing:-1.5px;color:${C.ink};word-break:keep-all}
.headline .hl{color:${C.red}}
.divider{margin-top:46px;width:100%;height:2px;background:${C.ink}14}
.body{margin-top:36px;font-size:38px;line-height:1.5;color:${C.ink};opacity:.82;word-break:keep-all}
.body .hl{color:${C.red};font-weight:800;opacity:1}
.spacer{flex:1}
.illus{flex:1;display:flex;align-items:center;justify-content:center;margin-top:20px}.illus svg{width:100%;height:auto;max-height:620px}
.cover{position:relative;flex:1;margin-top:26px}
.cover .cv{filter:blur(12px);font-size:42px;font-weight:800;line-height:1.5;color:${C.ink};opacity:.8;word-break:keep-all;user-select:none}
.cover .hint{position:absolute;left:0;top:8px;background:${C.red};color:#fff;font-weight:800;font-size:30px;padding:10px 22px;border-radius:10px}
.footer{display:flex;align-items:center;justify-content:space-between;border-top:2px solid ${C.ink}14;padding-top:34px}
.wm{font-size:40px;font-weight:800;letter-spacing:-.5px;color:${C.ink}}.wm .dot{color:${C.red}}
.tag{color:${C.muted};font-size:30px;font-weight:700}
</style>
<div class="card">${WASH}
  <div class="eyebrow"><span class="bar"></span>${data.kicker ? `<span>${esc(data.kicker)}</span>` : ""}</div>
  <div class="headline">${ml(data.headline)}</div><div class="divider"></div>
  <div class="body">${ml(data.body || "")}</div>${midHtml}
  <div class="footer">${wmHtml}${tagHtml}</div>
</div>`;
}

const html = `<!doctype html><html lang="${cfg.language || "ko"}"><head><meta charset="utf-8"></head><body>${build(STYLE)}</body></html>`;
const htmlPath = join(ROOT, "brands", brandId, "images", "_card.html");
writeFileSync(htmlPath, html, "utf8");

const baseFlags = ["--headless","--no-sandbox","--disable-gpu","--disable-software-rasterizer","--disable-dev-shm-usage","--in-process-gpu","--no-first-run","--hide-scrollbars","--virtual-time-budget=3500",`--window-size=${W},${H}`];
function shoot(scale) {
  execFileSync(CHROME, [...baseFlags, `--force-device-scale-factor=${scale}`, `--screenshot=${outPath}`, pathToFileURL(htmlPath).href], { stdio: "ignore" });
}
try { shoot(2); }          // 2x = 선명
catch { shoot(1); }        // 저사양/실패 시 1x 폴백
console.log(`이미지 생성(${STYLE}, 2x):`, outPath);
