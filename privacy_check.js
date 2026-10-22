#!/usr/bin/env node
/**
 * 推送前隐私检查（由 sync_github.js 自动调用）
 *
 * 背景：这个仓库是公开的。之前踩过的坑包括
 *   - 单测里写死真实路由器密码
 *   - docs/ 里贴了真实记忆内容、内网 IP、设备型号、chatId
 *   - patches/ verify/ 里硬编码个人工作区绝对路径
 * 所以推送必须有一道闸门，不能靠"记得检查"。
 *
 * 用法：node privacy_check.js [目录]   退出码 0=通过，1=有残留
 */
const fs = require("fs");
const path = require("path");

const DIR = process.argv[2] || "/sdcard/dm_work2";
const MEM = "/sdcard/Download/Operit/plugins/com.operit.deep_memory/memories.json";

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name.startsWith("_")) continue;
    const full = path.join(dir, name);
    const rel = base ? base + "/" + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, rel, out);
    else out.push({ rel, full });
  }
}

const files = [];
walk(DIR, "", files);
const texts = files
  .filter((f) => /\.(js|ts|py|md|json|sh|txt|yml|yaml)$/i.test(f.rel) || /^\.git/.test(f.rel))
  .filter((f) => f.rel !== "privacy_check.js")
  .map((f) => ({ rel: f.rel, raw: fs.readFileSync(f.full, "utf8") }));

// 硬模式：命中即拒
const RULES = [
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["私钥块", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["路由器密码", new RegExp("1346" + "79")],
  ["家庭内网 IP", /10\.0\.0\.1/],
  ["设备型号", new RegExp("红" + "米|Red" + "mi|K6" + "0")],
  ["路由器型号", new RegExp("A" + "X6|a" + "x6")],
  ["记忆 id", /mmvj[0-9a-z]{9,}/],
  ["chatId/UUID", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
  ["私有项目名", new RegExp("wb" + "2api|" + "ng" + "rok|nh" + "x2")],
  ["个人代称/口头禅", new RegExp("小法" + "师|牛" + "逼")],
  ["个人工作区路径", /files\/workspace\/[0-9a-f-]{8,}/],
  ["手机号", /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ["邮箱", /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/],
  ["身份证号", /(?<!\d)\d{17}[\dXx](?!\d)/],
  ["明文账号密码对", /(?:账号|password|passwd)\s*[:=：]\s*["']?[A-Za-z0-9_.\-]{4,}["']?,?\s*(?:密码|pass)\s*[:=]\s*["']?[A-Za-z0-9_.\-]{4,}/i],
];

let bad = 0;
console.log("=== 隐私检查: " + DIR + "（" + texts.length + " 个文本文件） ===");

for (const [label, re] of RULES) {
  const hits = [];
  for (const t of texts) {
    t.raw.split("\n").forEach((line, i) => {
      const r = new RegExp(re.source, re.flags.indexOf("g") >= 0 ? re.flags : re.flags + "g");
      if (r.test(line)) hits.push(t.rel + ":" + (i + 1) + "  " + line.trim().slice(0, 110));
    });
  }
  if (hits.length) {
    bad++;
    console.log("\n[拒绝] " + label + "  " + hits.length + " 处");
    hits.slice(0, 5).forEach((h) => console.log("   " + h));
    if (hits.length > 5) console.log("   ... 还有 " + (hits.length - 5) + " 处");
  }
}

// 记忆内容长片段（≥10 连续汉字）
if (fs.existsSync(MEM)) {
  const items = JSON.parse(fs.readFileSync(MEM, "utf8")).items || [];
  const norm = texts.map((t) => ({ rel: t.rel, n: t.raw.replace(/\s+/g, "") }));
  let memBad = 0;
  for (const it of items) {
    const runs = String(it.content).match(/[\u4e00-\u9fa5]{10,}/g) || [];
    for (const r of runs) {
      const hit = norm.find((x) => x.n.indexOf(r) >= 0);
      if (hit) {
        memBad++;
        console.log("\n[拒绝] 记忆正文出现于 " + hit.rel + "：「" + r.slice(0, 40) + "」");
        break;
      }
    }
  }
  if (!memBad) console.log("\n[通过] 记忆库正文未出现在任何文件中");
  bad += memBad;
}

// 禁止入库的数据文件
const FORBIDDEN = ["memories.json", "settings.json", "ai_state.json", "ai_extract.log",
  "injection_cache.json", "LEARNINGS.md", "RULES.md", "ERRORS.md", ".gh_credentials"];
for (const f of files) {
  for (const b of FORBIDDEN) {
    if (f.rel === b || f.rel.endsWith("/" + b)) {
      console.log("\n[拒绝] 用户数据文件不该入库: " + f.rel);
      bad++;
    }
  }
}

console.log("\n=== " + (bad === 0 ? "通过：可以推送" : "拦截：共 " + bad + " 项问题，已阻止推送") + " ===");
process.exit(bad === 0 ? 0 : 1);