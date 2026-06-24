// github-deploy.mjs — đẩy file lên GitHub repo qua Contents API (chỉ cần quyền Contents: write).
// deploy({repo, token, branch, files}) — files: [{path, contentBuffer}]
const API = "https://api.github.com";

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "threads-platform-deploy",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json, message: json.message || text };
}
const enc = p => p.split("/").map(encodeURIComponent).join("/");
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function deploy({ repo, token, branch = "main", files, message }) {
  let count = 0, updated = 0;
  for (const f of files) {
    const content = f.contentBuffer.toString("base64");
    const path = `/repos/${repo}/contents/${enc(f.path)}`;
    // thử PUT (file mới — không cần sha)
    let r = await gh(token, "PUT", path, { message: message || "deploy", branch, content });
    if (!r.ok && r.status === 422) {
      // file đã tồn tại → lấy sha rồi PUT lại
      const cur = await gh(token, "GET", `${path}?ref=${branch}`);
      const sha = cur.ok ? cur.json.sha : undefined;
      r = await gh(token, "PUT", path, { message: message || "deploy", branch, content, ...(sha ? { sha } : {}) });
      if (r.ok) updated++;
    }
    if (!r.ok) throw new Error(`PUT ${f.path} → ${r.status}: ${r.message}`);
    count++;
    await sleep(350); // tránh secondary rate limit
  }
  return { commit: "contents-api", files: count, updated };
}
