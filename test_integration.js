#!/usr/bin/env node
"use strict";
/**
 * 集成测试：deep_memory.ipcAutoExtract → ai-extract（延迟 require，验证无循环依赖）
 *  1. aiExtract 开 → 走 AI（data.by === "ai"），且 AI 真的被调用
 *  2. AI 判无需记 → 不写库
 *  3. aiExtract 关 → 走正则（data.by === "regex"），AI 一次都不调
 *  4. AI 抛错 → 自动降级正则，不炸
 *  5. deep_memory 与 ai-extract 互相 require 不栈溢出
 */
const path = require("path");
const fs = require("fs");
const WORK = path.resolve(__dirname);
const DATA = "/tmp/dm_itest";
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

/* ---- 把 memory-core 的 DATA_DIR 改到 /tmp，避免污染真实记忆库 ---- */
const corePath = path.join(WORK, "dist/memory-core.js");
const SRC_TARGET = "exports.DATA_DIR = `/sdcard/Download/Operit/plugins/${exports.PLUGIN_ID}`";
const coreSrc = fs.readFileSync(corePath, "utf8");
if (coreSrc.indexOf(SRC_TARGET) < 0) {
  console.error("!! 未找到 DATA_DIR 定义，可能污染真实数据，终止");
  process.exit(2);
}
const patchedCore = path.join(DATA, "memory-core.patched.js");
fs.writeFileSync(patchedCore, coreSrc.replace(SRC_TARGET, 'exports.DATA_DIR = "/tmp/dm_itest/data"'), "utf8");
fs.mkdirSync(path.join(DATA, "data"), { recursive: true });

/* ---- mock Tools ---- */
const files = new Map();
const dirs = new Set();
let chatCalls = 0;
let chatBehavior = null;
globalThis.Tools = {
  Files: {
    read: async (p) => { if (!files.has(p)) throw new Error("ENOENT " + p); return { content: files.get(p) }; },
    write: async (p, c) => { files.set(p, c); return { success: true }; },
    exists: async (p) => ({ exists: files.has(p) || dirs.has(p) }),
    mkdir: async (p) => { dirs.add(p); return { success: true }; },
    list: async (d) => ({
      entries: Array.from(files.keys())
        .filter((k) => k.startsWith(d + "/") && k.slice(d.length + 1).indexOf("/") < 0)
        .map((k) => ({ name: k.slice(d.length + 1), isDirectory: false, path: k }))
    }),
    deleteFile: async (p) => { files.delete(p); return { success: true }; },
    copy: async () => ({ success: true }),
    unzip: async () => ({ success: true })
  },
  Chat: {
    call: async (opts) => {
      chatCalls++;
      if (chatBehavior) return chatBehavior(opts);
      return { text: '{"remember":false,"items":[]}', finishReason: "stop" };
    }
  },
  System: { toast: async () => ({}) },
  SoftwareSettings: {}
};

const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "./memory-core" || request === "../memory-core" ||
      request.endsWith("/memory-core") || request.endsWith("memory-core.js")) {
    return patchedCore;
  }
  return origResolve.call(this, request, parent, ...rest);
};

const core = require(patchedCore);
const dm = require(path.join(WORK, "dist/packages/deep_memory.js"));
const ai = require(path.join(WORK, "dist/ai-extract.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
async function setSettings(patch) {
  const s = await core.loadSettings();
  await core.saveSettings(Object.assign({}, s, patch));
}

(async () => {
  console.log("=== 1. 互相 require 不栈溢出 / 模块正常加载 ===");
  ok("deep_memory 导出 ipcAutoExtract", typeof dm.ipcAutoExtract === "function");
  ok("ai-extract 导出 aiExtractText", typeof ai.aiExtractText === "function");
  ok("两个模块的 memory-core 是同一个（无重复加载）",
    require.cache[patchedCore] && require.cache[patchedCore].exports === core);

  console.log("\n=== 2. aiExtract 开：走 AI 判定 ===");
  await setSettings({ aiExtract: true, autoExtract: true });
  chatCalls = 0;
  chatBehavior = () => ({
    text: '{"remember":true,"items":[{"content":"用户是做网络运维的","type":"fact","importance":4,"sensitive":false,"space":"工作"}]}',
    finishReason: "stop"
  });
  const r1 = await dm.ipcAutoExtract("我是做网络运维的，平时要管一堆路由器");
  ok("返回 success", r1.success === true, r1);
  ok("by === ai", r1.data && r1.data.by === "ai", r1.data);
  ok("AI 被调用 1 次", chatCalls === 1, chatCalls);

  console.log("\n=== 3. AI 判无需记忆 → 不写库 ===");
  const before = (await core.loadStore()).items.length;
  chatCalls = 0;
  chatBehavior = () => ({ text: '{"remember":false,"items":[]}', finishReason: "stop" });
  const r2 = await dm.ipcAutoExtract("好的收到谢谢");
  const after = (await core.loadStore()).items.length;
  ok("matched:false", r2.data && r2.data.matched === false, r2.data);
  ok("库条数不变", before === after, { before, after });

  console.log("\n=== 4. aiExtract 关 → 走正则，AI 一次不调 ===");
  await setSettings({ aiExtract: false });
  chatCalls = 0;
const r3 = await dm.ipcAutoExtract("记住我的车牌号是粤B12345");
  ok("走旧正则分支：返回记忆条目", !!r3.data && typeof r3.data.id === "string", r3.data && Object.keys(r3.data).slice(0,3));
  ok("AI 调用 0 次", chatCalls === 0, chatCalls);
  console.log("\n=== 5. AI 抛错 → 降级正则，不抛异常 ===");
  await setSettings({ aiExtract: true });
  chatCalls = 0;
  chatBehavior = () => { throw new Error("model boom"); };
  let threw = false, r4 = null;
  try { r4 = await dm.ipcAutoExtract("记住我的生日是 3 月 8 日"); } catch (e) { threw = true; }
  ok("未抛异常", threw === false);
  ok("有返回（降级完成）", !!r4 && typeof r4.success === "boolean", r4 && r4.message);

  console.log("\n==================================");
  console.log("通过 " + pass + " / 失败 " + fail);
  console.log("==================================");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("测试崩溃:", e); process.exit(1); });