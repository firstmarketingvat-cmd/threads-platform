// shift-time.mjs — 모든 posts의 time_kst를 -2시간 (KST→VN/ICT) 으로 변환. 실제 게시 순간은 engine +7h와 함께 동일 유지.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
const rj = s => { let t = readFileSync(s, "utf8"); if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1); return JSON.parse(t); };
const dirs = process.argv.slice(2);
let n = 0;
for (const dir of dirs) {
  if (!existsSync(dir)) { console.log("skip(none):", dir); continue; }
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const fp = join(dir, f);
    const o = rj(fp);
    if (!o.time_kst) continue;
    let [h, m] = o.time_kst.split(":").map(Number);
    h = (h - 2 + 24) % 24;
    o.time_kst = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    writeFileSync(fp, JSON.stringify(o, null, 2), "utf8");
    n++;
  }
}
console.log(`변환 완료: ${n}개 파일 (-2h)`);
