/**
 * test_ai_side_extract.js —— v1.2.4 AI 侧记忆专项测试
 *
 * 目的：验证「不只记用户说的话，也记 AI 自己做了什么」这条新链路。
 * 不依赖宿主：直接 require dist 产物，用假的 Tools.Chat.call 喂固定 JSON。
 *
 * 覆盖点：
 *  1. AI 侧提示词与用户侧不同（主语是 AI，不是用户）
 *  2. AI 侧写入的 source 是 ai-action，用户侧仍是 ai
 *  3. AI 侧不触发正则兜底（不会把「我已完成…」当成用户自述）
 *  4. AI 侧不接受 forget 指令
 *  5. AI 侧条目若是「用户」开头的会被丢弃（防串味）
 *  6. AI 侧配额与用户侧独立
 *  7. aiSideExtract=false 时完全不动
 *  8. 长回复走头尾取样而不是整段送模型
 */
"use strict";

const path = require("path");
const fs = require("fs");

const DIST = path.join(__dirname, "dist");
const DATA = path.join(__dirname, "_test_data_ai_side");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? " → " + extra : "")); }
}

/* ---------- 造一个假宿主 ---------- */
function makeFakeHost(replyJson, opts) {
  const o = opts || {};
  const calls = [];
  globalThis.Tools = {
    Files: {
      read: async (p) => {
        try { return { content: fs.readFileSync(p, "utf8") }; }
        catch (e) { return { content: "" }; }
      },
      write: async (p, content) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
        return { success: true };
      },
      exists: async (p) => ({ exists: fs.existsSync(p) }),
      mkdir: async (p) => { fs.mkdirSync(p, { recursive: true }); return { success: true }; }
    },
    Chat: {
      call: async (payload) => {
        calls.push(payload);
        if (o.throwOnce) return { text: "", finishReason: "error" };
        return { text: typeof replyJson === "string" ? replyJson : JSON.stringify(replyJson), finishReason: "stop" };
      }
    }
  };
  globalThis.ToolPkg = { ipc: { on: () => {} }, registerToolboxUiModule: () => {} };
  globalThis.__DM_CALLS__ = calls;
  return calls;
}

/* ---------- 准备数据目录 ---------- */
function resetData(settingsOverride) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, "settings.json"), JSON.stringify(settingsOverride || {}));
  fs.writeFileSync(path.join(DATA, "memories.json"), JSON.stringify({ version: 1, items: [], updatedAt: Date.now() }));
}

/* core 里的 DATA_DIR 是常量，需要先把它指向测试目录再加载模块 */
function loadCore() {
  const corePath = require.resolve(path.join(DIST, "memory-core.js"));
  delete require.cache[corePath];
  return require(corePath);
}

function makeCoreWithDataDir() {
  /* memory-core 用 Tools.Files 读写，DATA_DIR 已硬编码到真实插件目录。
     为了让测试不污染真实数据，这里用一个最小的内存文件系统代理。 */
  const fake = {};
  globalThis.Tools = {
    Files: {
      read: async (p) => ({ content: fake[p] || "" }),
      write: async (p, c) => { fake[p] = c; return { success: true }; },
      exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(fake, p) }),
      mkdir: async () => ({ success: true })
    },
    Chat: { call: async () => ({ text: "{}", finishReason: "stop" }) }
  };
  globalThis.ToolPkg = { ipc: { on: () => {} } };
  return { fake };
}

/* ================= 测试 1：提示词分流 ================= */
function test1_promptSplit() {
  console.log("\n[1] 提示词分流");
  const src = fs.readFileSync(path.join(__dirname, "src/ai-extract.ts"), "utf8");
  ok("存在 AI 侧专用提示词 AI_SIDE_PROMPT", src.indexOf("AI_SIDE_PROMPT") >= 0);
  /* v1.2.8：提示词从「AI 行动记录器」改为「对话记忆整理器」，
     因为记录 AI 自己的工程流水正是元记忆污染的源头 */
  ok("AI 侧提示词是对话记忆整理器", src.indexOf("对话记忆整理器") >= 0);
  ok("AI 侧提示词禁止记自身流水", src.indexOf("不记「我干了什么活」") >= 0);
  ok("AI 侧提示词旧身份已移除", src.indexOf("AI 行动记录器") < 0);
  // v1.2.9：buildTurns 增加可选的 ctxHint（已有记忆上下文），断言不再写死完整签名
  ok("buildTurns 接受 side 参数", /function buildTurns\(text: string, side\?: string/.test(src));
  ok("AI 侧走 AI_SIDE_PROMPT", /side === "ai" \? AI_SIDE_PROMPT : SYSTEM_PROMPT/.test(src));
  ok("AI 侧禁止 forget", src.indexOf("遗忘只能由用户侧发起") >= 0);
}

/* ================= 测试 2：源码层关键分支 ================= */
function test2_guardBranches() {
  console.log("\n[2] 源码层关键分支");
  const src = fs.readFileSync(path.join(__dirname, "src/ai-extract.ts"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "src/main.ts"), "utf8");

  ok("AI 侧 source 标记为 ai-action", src.indexOf('source: isAiSide ? "ai-action" : "ai"') >= 0);
  ok("AI 侧配额独立（aiSideMaxPerHour）", src.indexOf("aiSideMaxPerHour") >= 0);
  ok("AI 侧计数器独立（aiSideCallCount）", src.indexOf("aiSideCallCount") >= 0);
  ok("AI 侧不吃 forget", /quickForget !== false && !isAiSide/.test(src));
  ok("AI 侧不做正则兜底", /if \(isAiSide\) \{\s*\n\s*const why/.test(src));
  ok("AI 侧仍拦截「把自己的活记成用户的事」", src.indexOf("把 AI 的活记成用户的事") >= 0);
  ok("AI 侧长文本头尾取样", src.indexOf("sampleForAiSide") >= 0);
  ok("AI 侧无中文直接跳过", src.indexOf("无中文（多半是代码或日志）") >= 0);

  ok("main 放行 AI 消息", /const isAI = sender === "ai"/.test(main));
  ok("main 两侧独立闸门", main.indexOf("__DM_AI_INFLIGHT_AI__") >= 0);
  ok("main 传 side 给 dmHandleContent", /dmHandleContent\(content, chatId, isAI \? "chatmsg-ai" : "chatmsg", who\.id, who\.name, side, si\)/.test(main));
  ok("main 未知 sender 仍按用户侧处理", main.indexOf("无法归类，按用户侧处理") >= 0);
  ok("dmSeen 键带 side 防止两侧互吞", /dmSeen\(chatId \+ "\\|" \+ side \+ "\\|" \+ content\)/.test(main));
}

/* ================= 测试 3：设置项存在且默认开启 ================= */
function test3_settings() {
  console.log("\n[3] 设置项与默认值");
  const core = fs.readFileSync(path.join(__dirname, "src/memory-core.ts"), "utf8");
  const ai = fs.readFileSync(path.join(__dirname, "src/ai-extract.ts"), "utf8");

  ok("MemorySettings 声明 aiSideExtract", /aiSideExtract: boolean;/.test(core));
  ok("MemorySettings 声明 aiSideMinLen", /aiSideMinLen: number;/.test(core));
  ok("MemorySettings 声明 aiSideMaxPerHour", /aiSideMaxPerHour: number;/.test(core));
  ok("MemorySettings 声明 aiSideMaxItems", /aiSideMaxItems: number;/.test(core));
  ok("DEFAULT_SETTINGS 默认开启 aiSideExtract", /aiSideExtract: true,/.test(core));
  ok("ai-extract DEFAULTS 同步默认值", /aiSideExtract: true,/.test(ai));
  ok("aiStatus 暴露 AI 侧字段", ai.indexOf("aiSideTotalRemembered") >= 0);
}

/* ================= 测试 4：真机行为——用假宿主跑一遍 ================= */
async function test4_behavior() {
  console.log("\n[4] 行为验证（假宿主 + 真实 dist 产物）");
  const { fake } = makeCoreWithDataDir();

  /* 先写 settings，让 core 读到 */
  const core = loadCore();
  const aiPath = require.resolve(path.join(DIST, "ai-extract.js"));
  delete require.cache[aiPath];

  /* 设定：AI 侧开启 */
  fake[core.DATA_DIR + "/settings.json"] = JSON.stringify({
    aiExtract: true, aiSideExtract: true, autoExtract: true,
    autoTag: false, characterAutoTag: false,
    aiExtractMinLen: 6, aiSideMinLen: 10, aiExtractMaxPerHour: 60, aiSideMaxPerHour: 20,
    aiExtractMaxItems: 3, aiSideMaxItems: 3, aiExtractTimeoutMs: 3000
  });
  fake[core.DATA_DIR + "/memories.json"] = JSON.stringify({ version: 1, items: [], updatedAt: 0 });

  /* 模型固定返回一条 event */
  let seenSystem = "";
  globalThis.Tools.Chat.call = async (payload) => {
    const arr = (payload && payload.turns) || payload || [];
    try {
      const sys = arr.find((m) => m && (m.kind === "SYSTEM" || m.role === "system"));
      if (sys) seenSystem = String(sys.content || "");
    } catch (e) {}
    return { text: JSON.stringify({ remember: true, items: [{ content: "用户反馈路由器散热偏烫，建议换到通风位置", type: "event", importance: 4, space: "工作" }] }), finishReason: "stop" };
  };

  const ai = require(aiPath);
  /* 注意：这里的输入不能是「AI 已…+ 工程痕迹」，那是 v1.2.8 元记忆规则明确要拦的操作流水 */
  const r = await ai.aiExtractText("用户今天反馈路由器散热偏烫，换到通风位置摆放可能更稳。", "chatX", "", "", "ai");

  ok("AI 侧调用成功写入", r && r.success === true);
  ok("返回标记 side=ai", r && r.data && r.data.side === "ai");
  ok("使用了 AI 侧提示词", seenSystem.indexOf("对话记忆整理器") >= 0, seenSystem.slice(0, 40));
  /* v1.2.8 护栏：本用例输入必须不是操作流水，否则会被元记忆规则提前拦下 */
  ok("测试输入不含操作流水特征", !(/(已确认|已完成|已部署|已打包|已修复|已修改|已更新|已落盘)/.test("用户今天反馈路由器散热偏烫，换到通风位置摆放可能更稳。") && /(toolpkg|md5|tsc|dist\/|\.ts\b|sdcard\/|字节|行号)/.test("用户今天反馈路由器散热偏烫，换到通风位置摆放可能更稳。")));

  /* 检查落库的 source */
  const storeRaw = fake[core.DATA_DIR + "/memories.json"];
  const store = JSON.parse(storeRaw);
  const item = (store.items || [])[0];
  ok("已写入 1 条记忆", (store.items || []).length === 1, storeRaw.slice(0, 120));
  ok("source 是 ai-action", item && item.source === "ai-action", item && item.source);
  ok("type 是 event", item && item.type === "event", item && item.type);
  ok("space 是工作", item && item.space === "工作", item && item.space);

  /* 用户侧对照 */
  delete require.cache[aiPath];
  const ai2 = require(aiPath);
  globalThis.Tools.Chat.call = async () => ({ text: JSON.stringify({ remember: true, items: [{ content: "用户要求所有改动先跑 tsc 门禁", type: "preference", importance: 4, space: "工作" }] }), finishReason: "stop" });
  const r2 = await ai2.aiExtractText("以后每次改代码都要先跑 tsc 再打包", "chatX", "", "", "user");
  ok("用户侧 side=user", r2 && r2.data && r2.data.side === "user");
  const store2 = JSON.parse(fake[core.DATA_DIR + "/memories.json"]);
  const userItem = (store2.items || []).find((x) => x.content.indexOf("用户要求") >= 0);
  ok("用户侧 source 仍是 ai", userItem && userItem.source === "ai", userItem && userItem.source);
}

/* ================= 测试 5：AI 侧不受 forget 影响 ================= */
async function test5_noForget() {
  console.log("\n[5] AI 侧不吃 forget");
  const { fake } = makeCoreWithDataDir();
  const core = loadCore();
  fake[core.DATA_DIR + "/settings.json"] = JSON.stringify({
    aiExtract: true, aiSideExtract: true, autoExtract: true, autoTag: false,
    quickForget: true, aiSideMinLen: 5, aiExtractMinLen: 5, characterAutoTag: false
  });
  fake[core.DATA_DIR + "/memories.json"] = JSON.stringify({ version: 1, items: [], updatedAt: 0 });

  const aiPath = require.resolve(path.join(DIST, "ai-extract.js"));
  delete require.cache[aiPath];
  globalThis.Tools.Chat.call = async () => ({
    text: JSON.stringify({ remember: false, items: [], forget: { keyword: "路由器" } }),
    finishReason: "stop"
  });
  const ai = require(aiPath);
  const r = await ai.aiExtractText("AI 说：要不把路由器那条忘了？其实只是随口一提。", "c1", "", "", "ai");
  ok("AI 侧不返回 forget 动作", !(r && r.data && r.data.kind === "forget"), JSON.stringify(r && r.data));
  ok("AI 侧结果仍是无需记忆", r && r.success === true);
}

/* ================= 测试 6：关闭开关后完全不动 ================= */
async function test6_disabled() {
  console.log("\n[6] aiSideExtract=false 时不调模型");
  const { fake } = makeCoreWithDataDir();
  const core = loadCore();
  fake[core.DATA_DIR + "/settings.json"] = JSON.stringify({
    aiExtract: true, aiSideExtract: false, autoExtract: true, autoTag: false, characterAutoTag: false
  });
  fake[core.DATA_DIR + "/memories.json"] = JSON.stringify({ version: 1, items: [], updatedAt: 0 });

  let called = 0;
  globalThis.Tools.Chat.call = async () => { called++; return { text: "{}", finishReason: "stop" }; };
  const aiPath = require.resolve(path.join(DIST, "ai-extract.js"));
  delete require.cache[aiPath];
  const ai = require(aiPath);
  const r = await ai.aiExtractText("AI 已部署 v1.2.4 到 packages 目录并重铺缓存", "c1", "", "", "ai");
  ok("开关关闭时零模型调用", called === 0, "called=" + called);
  ok("返回未记录原因", r && String(r.message).indexOf("未记录") >= 0, r && r.message);
}

/* ================= 测试 7：防串味过滤 ================= */
function test7_guard() {
  console.log("\n[7] 防串味过滤（源码级断言）");
  const src = fs.readFileSync(path.join(__dirname, "src/ai-extract.ts"), "utf8");
  /* v1.2.8：不能按「用户开头」一刀切，必须同时带执行动作才丢 */
  ok("过滤条件限定 AI 侧", /if \(isAiSide && \/\^用户\//.test(src));
  ok("过滤条件要求执行动作", /已落盘\|已就位\|跑完\|编译通过/.test(src));
  ok("丢弃时写日志", src.indexOf('appendLog("AI 侧条目把 AI 的活记成用户的事，已丢弃：') >= 0);
}

/* ================= 主入口 ================= */
(async () => {
  console.log("=== deep_memory v1.2.4 AI 侧记忆测试 ===");
  try {
    test1_promptSplit();
    test2_guardBranches();
    test3_settings();
    test7_guard();
    await test4_behavior();
    await test5_noForget();
    await test6_disabled();
  } catch (e) {
    fail++;
    console.log("  ✗ 测试过程异常: " + (e && e.stack || e));
  }
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log("\n=== 结果: " + pass + " 通过 / " + fail + " 失败 ===");
  process.exit(fail === 0 ? 0 : 1);
})();