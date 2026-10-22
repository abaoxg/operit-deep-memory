#!/usr/bin/env node
"use strict";
/**
 * 端到端冒烟测试：模拟宿主加载 dist/main.js
 *  1. main.js 能正常加载（模块级不报错）
 *  2. registerToolPkg 能注册全部 4 个钩子（含 chatMessage）
 *  3. 模拟宿主下发一条用户消息 → chatMessage 钩子 → AI 判定 → 真的写进库
 *  4. 模拟一条 AI 自己的消息（sender=assistant）→ 不应写入
 *  5. 模拟一条寒暄 → AI 判无需记 → 不写入
 */
const path = require("path");
const fs = require("fs");
const WORK = "/sdcard/dm_work2";
const DATA = "/tmp/dm_e2e";
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

const corePath = path.join(WORK, "dist/memory-core.js");
const TARGET = "exports.DATA_DIR = `/sdcard/Download/Operit/plugins/${exports.PLUGIN_ID}`";
const src = fs.readFileSync(corePath, "utf8");
if (src.indexOf(TARGET) < 0) { console.error("!! DATA_DIR 锚点缺失，终止"); process.exit(2); }
const patchedCore = path.join(DATA, "memory-core.patched.js");
fs.writeFileSync(patchedCore, src.replace(TARGET, 'exports.DATA_DIR = "/tmp/dm_e2e/data"'), "utf8");
fs.mkdirSync(path.join(DATA, "data"), { recursive: true });

/* ---- Tools mock ---- */
const files = new Map();
const dirs = new Set();
let chatCalls = 0;
let chatReply = '{"remember":false,"items":[]}';
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
    copy: async () => ({ success: true }), unzip: async () => ({ success: true })
  },
  Chat: {
    call: async () => { chatCalls++; return { text: chatReply, finishReason: "stop" }; }
  },
  System: { toast: async () => ({}) },
  SoftwareSettings: {}
};

/* ---- ToolPkg mock：记录注册了哪些钩子 ---- */
const hooks = { chatMessage: [], msgProcessing: [], systemPrompt: [], xml: [], toolboxUi: [] };
const ipcHandlers = {};
globalThis.ToolPkg = {
  ipc: {
    on: (ch, fn) => { ipcHandlers[ch] = fn; },
    call: async () => null
  },
  registerToolboxUiModule: (o) => { hooks.toolboxUi.push(o.id); },
  registerXmlRenderPlugin: (o) => { hooks.xml.push(o.id); },
  registerSystemPromptComposeHook: (o) => { hooks.systemPrompt.push(o.id); },
  registerMessageProcessingPlugin: (o) => { hooks.msgProcessing.push(o); },
  registerChatMessageHook: (o) => { hooks.chatMessage.push(o); },
  _m: () => {}  /* 宿主注入的标记函数，原版 dist 末尾就有 ToolPkg._m(...) */
};

const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.endsWith("memory-core") || request.endsWith("memory-core.js")) return patchedCore;
  return origResolve.call(this, request, parent, ...rest);
};

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + (e !== undefined ? "  → " + JSON.stringify(e) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("=== 1. 加载 dist/main.js ===");
  let main = null, loadErr = null;
  try { main = require(path.join(WORK, "dist/main.js")); } catch (e) { loadErr = e; }
  ok("模块加载成功", !!main, loadErr && String(loadErr.message));
  if (!main) { process.exit(1); }
  ok("导出 registerToolPkg", typeof main.registerToolPkg === "function");
  ok("模块级就注册了 IPC（memory.get_all）", !!ipcHandlers["memory.get_all"]);
  ok("模块级就挂了同上下文桥 __DM_BRIDGE__", !!globalThis.__DM_BRIDGE__);
  ok("桥里有 memory.ai_probe", typeof (globalThis.__DM_BRIDGE__ || {})["memory.ai_probe"] === "function");

  console.log("\n=== 2. registerToolPkg 注册钩子 ===");
  const r = main.registerToolPkg();
  ok("返回 true", r === true);
  ok("工具箱 UI 已注册", hooks.toolboxUi.length === 1, hooks.toolboxUi);
  ok("注入 Hook 已注册", hooks.systemPrompt.length === 1, hooks.systemPrompt);
  ok("msgproc Hook 已注册", hooks.msgProcessing.length === 1);
  ok("★ chatMessage 钩子已注册（主通道）", hooks.chatMessage.length === 1, hooks.chatMessage);

  const core = require(patchedCore);
  const settings = await core.loadSettings();
  await core.saveSettings(Object.assign({}, settings, { autoExtract: true, aiExtract: true, aiScoped: true }));

  console.log("\n=== 3. 用户真实消息 → AI 判定 → 写库 ===");
  chatReply = '{"remember":true,"items":[{"content":"用户是做网络运维的，管一堆路由器","type":"fact","importance":4,"sensitive":false,"space":"工作"}]}';
  chatCalls = 0;
  const before = (await core.loadStore()).items.length;
  hooks.chatMessage[0].function({ eventPayload: { chatId: "chat_e2e_1", content: "我是做网络运维的，家里一堆路由器", sender: "user" } });
  await sleep(300);
  const after = (await core.loadStore()).items.length;
  ok("chatMessage 钩子被调用后调了模型", chatCalls >= 1, chatCalls);
  ok("库条数 +1", after === before + 1, { before, after });
  const gained = (await core.loadStore()).items.slice(-1)[0];
  ok("写入内容来自 AI", /网络运维/.test(gained && gained.content), gained && gained.content);
  ok("类型=fact / 空间=工作", gained && gained.type === "fact" && gained.space === "工作", gained && { t: gained.type, s: gained.space });

  console.log("\n=== 4. AI 自己发的消息不应触发 ===");
  chatCalls = 0;
  const b2 = (await core.loadStore()).items.length;
  hooks.chatMessage[0].function({ eventPayload: { chatId: "chat_e2e_1", content: "好的，已帮你记住了这些信息", sender: "assistant" } });
  await sleep(200);
  const a2 = (await core.loadStore()).items.length;
  ok("模型未被调用", chatCalls === 0, chatCalls);
  ok("库条数不变", a2 === b2, { b2, a2 });

  console.log("\n=== 5. 寒暄消息 → AI 判无需记 → 不写 ===");
  chatReply = '{"remember":false,"items":[]}';
  chatCalls = 0;
  const b3 = (await core.loadStore()).items.length;
  hooks.chatMessage[0].function({ eventPayload: { chatId: "chat_e2e_2", content: "好的我明白了谢谢你啊", sender: "user" } });
  await sleep(300);
  const a3 = (await core.loadStore()).items.length;
  ok("库条数不变", a3 === b3, { b3, a3 });

  console.log("\n=== 6. 同一条消息重复下发 → 去重只处理一次 ===");
  chatReply = '{"remember":true,"items":[{"content":"用户的测试暗号是 8899","type":"fact","importance":3}]}';
  chatCalls = 0;
  const msg = { eventPayload: { chatId: "chat_e2e_3", content: "记住我的测试暗号是 8899", sender: "user" } };
  hooks.chatMessage[0].function(msg);
  hooks.msgProcessing[0].function({ eventPayload: { chatId: "chat_e2e_3", messageContent: "记住我的测试暗号是 8899", probeOnly: false } });
  await sleep(400);
  ok("两个通道合计只调一次模型", chatCalls === 1, chatCalls);

  console.log("\n==================================");
  console.log("通过 " + pass + " / 失败 " + fail);
  console.log("==================================");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("崩溃:", e); process.exit(1); });