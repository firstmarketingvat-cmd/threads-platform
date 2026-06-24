// fetch-photo.mjs — Pexels에서 키워드로 사진 1장 받아 저장 (무료, 상업적 사용 OK, 출처표기 불요)
// 사용: node lib/fetch-photo.mjs "<query>" <out.jpg> [index]
// 키: 환경변수 PEXELS_KEY  또는  루트의 .pexels-key 파일(한 줄, 키만)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function getKey() {
  if (process.env.PEXELS_KEY) return process.env.PEXELS_KEY.trim();
  const f = join(ROOT, ".pexels-key");
  if (existsSync(f)) { let s = readFileSync(f, "utf8"); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return s.trim(); }
  return "";
}

const [, , query, outArg, idxArg] = process.argv;
if (!query || !outArg) { console.error('사용: node lib/fetch-photo.mjs "<query>" <out.jpg> [index]'); process.exit(1); }
const KEY = getKey();
if (!KEY) { console.error("PEXELS_KEY 없음 — 루트에 .pexels-key 파일(키 한 줄) 만들거나 환경변수 PEXELS_KEY 설정"); process.exit(2); }

const idx = Math.max(0, parseInt(idxArg || "0", 10) || 0);
const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=15`;

const res = await fetch(url, { headers: { Authorization: KEY } });
if (!res.ok) { console.error(`Pexels 검색 실패: ${res.status} ${await res.text()}`); process.exit(3); }
const data = await res.json();
const photos = data.photos || [];
if (!photos.length) { console.error(`'${query}' 검색 결과 없음`); process.exit(4); }
const pick = photos[Math.min(idx, photos.length - 1)];
const src = pick.src.portrait || pick.src.large2x || pick.src.large || pick.src.original;

const img = await fetch(src);
if (!img.ok) { console.error(`이미지 다운로드 실패: ${img.status}`); process.exit(5); }
const buf = Buffer.from(await img.arrayBuffer());
writeFileSync(resolve(outArg), buf);
console.log(`사진 저장: ${outArg}  (Pexels #${pick.id}, by ${pick.photographer})`);
