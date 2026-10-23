#!/usr/bin/env node
/**
 * 发布到 GitHub Release
 *   用法：GH_TOKEN=xxx node release.js [包路径] [发布说明文件]
 *   不传包路径时自动取 manifest.json 的 version，到 path.resolve(__dirname, "..", "dm_out") 找对应 .toolpkg
 *
 * 行为：tag 已存在则复用它（已上传的同名资产先删再传，避免 422）；
 *       tag 不存在则新建 release。最后打印下载地址与资产字节数。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const OWNER = "abaoxg";
const REPO = "operit-deep-memory";
const OUT = path.resolve(__dirname, "..", "dm_out");
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("[FATAL] 缺 GH_TOKEN");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync("path.resolve(__dirname, "manifest.json")", "utf8"));
const ver = manifest.version;

let pkg = process.argv[2];
if (!pkg) {
  const cand = fs.readdirSync(OUT).filter((f) => f.endsWith(".toolpkg") && f.includes(ver));
  if (cand.length !== 1) {
    console.error("[FATAL] " + OUT + " 里找到 " + cand.length + " 个匹配 v" + ver + " 的包，请显式传路径");
    process.exit(1);
  }
  pkg = path.join(OUT, cand[0]);
}
if (fs.existsSync(pkg) === false) {
  console.error("[FATAL] 包不存在: " + pkg);
  process.exit(1);
}
const pkgSize = fs.statSync(pkg).size;
const assetName = "com.operit.deep_memory-v" + ver + ".toolpkg";

function api(method, url, bodyPath) {
  const parts = ["curl", "-s", "-m", "120", "-X", method];
  parts.push("-H", "Authorization: token " + TOKEN);
  parts.push("-H", "Accept: application/vnd.github+json");
  if (bodyPath) {
    parts.push("-H", "Content-Type: application/json");
    parts.push("--data-binary", "@" + bodyPath);
  }
  parts.push("https://api.github.com" + url);
  parts.push("-w", "\n__HTTP__%{http_code}");
  const cmd = parts
    .map((p) => "'" + String(p).replace(/'/g, "'\\''") + "'")
    .join(" ");
  const out = execSync(cmd, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const i = out.lastIndexOf("\n__HTTP__");
  let json = null;
  try {
    json = JSON.parse(out.slice(0, i));
  } catch (e) {
    json = { _raw: out.slice(0, 300) };
  }
  return { code: parseInt(out.slice(i + 9).trim(), 10), json };
}

// 1. 查现有 release
let rel = null;
const got = api("GET", "/repos/" + OWNER + "/" + REPO + "/releases/tags/v" + ver);
if (got.code === 200) {
  rel = got.json;
  console.log("[release] 已存在 tag v" + ver + " id=" + rel.id + "，复用");
} else {
  // manifest.description 可能是 {zh, en} 对象，Release body 只接受字符串
  let bodyText = "";
  if (process.argv[3] && fs.existsSync(process.argv[3])) {
    bodyText = fs.readFileSync(process.argv[3], "utf8");
  } else {
    const d = manifest.description;
    bodyText = typeof d === "string" ? d : d && d.zh ? d.zh : "Operit 深度记忆插件 v" + ver;
  }
  const bodyPath = "/tmp/_rel_body.json";
  fs.writeFileSync(
    bodyPath,
    JSON.stringify({
      tag_name: "v" + ver,
      target_commitish: "main",
      name: "v" + ver,
      body: bodyText,
      draft: false,
      prerelease: false,
    }),
    "utf8"
  );
  const made = api("POST", "/repos/" + OWNER + "/" + REPO + "/releases", bodyPath);
  if (made.code !== 201) {
    console.error("[FATAL] 建 release 失败 http=" + made.code);
    console.error(JSON.stringify(made.json).slice(0, 300));
    process.exit(1);
  }
  rel = made.json;
  console.log("[release] 新建 tag v" + ver + " id=" + rel.id);
}

// 2. 同名资产先删
(rel.assets || []).forEach((a) => {
  if (a.name === assetName) {
    const d = api("DELETE", "/repos/" + OWNER + "/" + REPO + "/releases/assets/" + a.id);
    console.log("[asset] 删除旧同名资产 " + a.name + " http=" + d.code);
  }
});

// 3. 上传
const upUrl = "https://uploads.github.com/repos/" + OWNER + "/" + REPO + "/releases/" +
  rel.id + "/assets?name=" + encodeURIComponent(assetName);
const up = execSync(
  "curl -s -m 300 -X POST " +
    "-H 'Authorization: token " + TOKEN + "' " +
    "-H 'Content-Type: application/octet-stream' " +
    "-H 'Accept: application/vnd.github+json' " +
    "--data-binary '@" + pkg + "' '" + upUrl + "' -w '\\n__HTTP__%{http_code}'",
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
);
const ui = up.lastIndexOf("\n__HTTP__");
const ucode = parseInt(up.slice(ui + 9).trim(), 10);
let uj = null;
try {
  uj = JSON.parse(up.slice(0, ui));
} catch (e) {
  uj = null;
}
console.log("[asset] 上传 http=" + ucode);
if (ucode !== 201 || (uj && uj.size !== pkgSize)) {
  console.error("[FATAL] 上传失败或大小不符。本地 " + pkgSize + " B，远端 " + (uj && uj.size) + " B");
  if (uj) console.error(JSON.stringify(uj).slice(0, 300));
  process.exit(1);
}
console.log("[ok] " + uj.name + "  " + uj.size + " B  state=" + uj.state);
console.log(uj.browser_download_url);