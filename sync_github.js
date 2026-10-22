#!/usr/bin/env node
/**
 * 把本地工作区同步到 abaoxg/operit-deep-memory
 *
 * 走 Git Data API：
 *  1. POST /git/blobs        逐个上传有差异的文件内容
 *  2. POST /git/trees        用 base_tree=HEAD 建新树（只覆盖改动，远端其余文件保留）
 *  3. POST /git/commits      生成一个提交
 *  4. PATCH /git/refs/heads/main  移动分支指针
 * 中途任何一步失败都不影响远端，分支指针不动 = 原子提交。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const OWNER = "abaoxg";
const REPO = "operit-deep-memory";
const BRANCH = "main";
const ROOT = "/sdcard/dm_work2";
const TOKEN = process.env.GH_TOKEN;
const API = "https://api.github.com";

if (!TOKEN) {
  console.error("[FATAL] 缺 GH_TOKEN 环境变量");
  process.exit(1);
}

function api(method, url, body) {
  const args = ["-s", "-m", "60", "-X", method];
  args.push("-H", "Authorization: token " + TOKEN);
  args.push("-H", "Accept: application/vnd.github+json");
  const tmp = "/tmp/_api_body_" + process.pid + ".json";
  if (body !== undefined) {
    fs.writeFileSync(tmp, JSON.stringify(body), "utf8");
    args.push("-H", "Content-Type: application/json");
    args.push("--data-binary", "@" + tmp);
  }
  args.push(API + url);
  args.push("-w", "\n__HTTP__%{http_code}");
  const out = execSync("curl " + args.map((a) => "'" + String(a).replace(/'/g, "'\\''") + "'").join(" "), {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const i = out.lastIndexOf("\n__HTTP__");
  const code = parseInt(out.slice(i + 9).trim(), 10);
  const text = out.slice(0, i);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = { _raw: text };
  }
  if (body !== undefined && fs.existsSync(tmp)) fs.unlinkSync(tmp);
  return { code, json };
}

function blobSha(buf) {
  return crypto.createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex");
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "_t" || name === "node_modules" || name === ".git") continue;
    const full = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, rel, out);
    else out[rel] = full;
  }
}

// 1. 取远端当前树
const refRes = api("GET", "/repos/" + OWNER + "/" + REPO + "/git/ref/heads/" + BRANCH);
if (refRes.code !== 200) {
  console.error("[FATAL] 取分支失败", refRes.code, JSON.stringify(refRes.json).slice(0, 200));
  process.exit(1);
}
const headSha = refRes.json.object.sha;

const cmtRes = api("GET", "/repos/" + OWNER + "/" + REPO + "/git/commits/" + headSha);
const baseTree = cmtRes.json.tree.sha;

const treeRes = api("GET", "/repos/" + OWNER + "/" + REPO + "/git/trees/" + baseTree + "?recursive=1");
const remoteSha = {};
treeRes.json.tree.filter((x) => x.type === "blob").forEach((x) => (remoteSha[x.path] = x.sha));

// 2. 本地文件
const local = {};
walk(ROOT, "", local);

// 3. 找差异
const changed = [];
for (const rel of Object.keys(local).sort()) {
  const buf = fs.readFileSync(local[rel]);
  const sha = blobSha(buf);
  if (remoteSha[rel] !== sha) changed.push({ rel, buf, sha });
}

// 3b. 本地已删、远端还留着的"本项目根级文件"一并删掉
//     只处理根目录下的 .js/.py（脚本类），历史目录 patches/ verify/ docs/ 一律不动
const DELETABLE = /^[^/]+\.(js|py)$/;
const deleted = Object.keys(remoteSha)
  .filter((p) => local[p] === undefined && DELETABLE.test(p))
  .sort();

console.log("远端 HEAD: " + headSha.slice(0, 7) + "  文件 " + Object.keys(remoteSha).length + " 个");
console.log("本地文件: " + Object.keys(local).length + " 个");
console.log("需要上传: " + changed.length + " 个\n");
changed.forEach((c) => console.log("  " + String(c.buf.length).padStart(8) + "  " + c.rel));
if (deleted.length) {
  console.log("\n需要删除（本地已不存在）: " + deleted.length + " 个");
  deleted.forEach((p) => console.log("  " + p));
}

if (changed.length === 0 && deleted.length === 0) {
  console.log("\n无需同步，仓库已是最新。");
  process.exit(0);
}

// 4. 逐个上传 blob
const entries = [];
for (const c of changed) {
  const r = api("POST", "/repos/" + OWNER + "/" + REPO + "/git/blobs", {
    content: c.buf.toString("base64"),
    encoding: "base64",
  });
  if (r.code !== 201) {
    console.error("[FATAL] 上传 blob 失败: " + c.rel + " http=" + r.code);
    console.error(JSON.stringify(r.json).slice(0, 300));
    process.exit(1);
  }
  entries.push({ path: c.rel, mode: "100644", type: "blob", sha: r.json.sha });
  console.log("  [blob] " + c.rel + " -> " + r.json.sha.slice(0, 8));
}

// 4b. 删除项：tree 里传 sha=null 表示移除
for (const p of deleted) {
  entries.push({ path: p, mode: "100644", type: "blob", sha: null });
  console.log("  [del ] " + p);
}

// 5. 建树（base_tree 保留远端未改动的文件）
const newTree = api("POST", "/repos/" + OWNER + "/" + REPO + "/git/trees", {
  base_tree: baseTree,
  tree: entries,
});
if (newTree.code !== 201) {
  console.error("[FATAL] 建树失败 http=" + newTree.code);
  console.error(JSON.stringify(newTree.json).slice(0, 300));
  process.exit(1);
}
console.log("\n[tree] " + newTree.json.sha.slice(0, 8));

// 6. 提交
const msg = process.argv[2] || "sync: 同步本地工作区 " + new Date().toISOString();
const newCmt = api("POST", "/repos/" + OWNER + "/" + REPO + "/git/commits", {
  message: msg,
  tree: newTree.json.sha,
  parents: [headSha],
});
if (newCmt.code !== 201) {
  console.error("[FATAL] 提交失败 http=" + newCmt.code);
  console.error(JSON.stringify(newCmt.json).slice(0, 300));
  process.exit(1);
}
console.log("[commit] " + newCmt.json.sha.slice(0, 8) + "  " + msg);

// 7. 移动分支
const upd = api("PATCH", "/repos/" + OWNER + "/" + REPO + "/git/refs/heads/" + BRANCH, {
  sha: newCmt.json.sha,
  force: false,
});
if (upd.code !== 200) {
  console.error("[FATAL] 更新分支失败 http=" + upd.code);
  console.error(JSON.stringify(upd.json).slice(0, 300));
  process.exit(1);
}
console.log("[ref] " + BRANCH + " -> " + newCmt.json.sha.slice(0, 8) + "\n同步完成。");
console.log("https://github.com/" + OWNER + "/" + REPO + "/commit/" + newCmt.json.sha);