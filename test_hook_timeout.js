#!/usr/bin/env node
"use strict";
/**
 * AUDIT-002 专项测试：钩子超时保护
 *
 * 背景：宿主对 hook 返回的 Promise 没有超时保护（dex 里 timeoutSec 可为 null）。
 * 模型不返回时，旧实现会把消息管线永久挂住。本测试验证三层兜底：
 *  1. callModel 单次调用超时 → reject，cascade 继续降级到 CHAT
 *  2. cascade 总预算：MEMORY 卡住 + CHAT 卡住，总耗时不超过 ~总预算
 *  3. dmHandleContent 看门狗：整条链路卡死时，hook 返回的 Promise 仍会在预算内 resolve
 *  4. 并发闸门：上一次没结束时，新的消息直接跳过，不叠加
 */
const path = require("path");
const fs = require("fs");

const WORK = path.resolve(__dirname);
const DATA = "/tmp/dm_timeout_data";
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

/* DATA_DIR 重定向到 /tmp，避免污染真实记忆 */
const corePath = path.join(WORK, "dist/memory-core.js");
const SRC_TARGET = "exports.DATA_DIR = `/sdcard/Download/Operit/plugins/${exports.PLUGIN_ID}`";
const coreSrc = fs.readFileSync(corePath, "utf8");
if (coreSrc.indexOf(SRC_TARGET) < 0) {
    console.error("!! 未找到 DATA_DIR 定义，终止（防止污染真实数据）");
    process.exit(2);
}
const patchedCore = path.join(DATA, "memory-core.patched.js");
fs.writeFileSync(patchedCore, coreSrc.replace(SRC_TARGET, "exports.DATA_DIR = \"/tmp/dm_timeout_data/data\""), "utf8");
fs.mkdirSync(path.join(DATA, "data"), { recursive: true });

const files = new Map();
const dirs = new Set();
let chatCalls = [];
let chatMode = "hang"; // hang | ok

globalThis.Tools = {
    Files: {
        read: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return { content: files.get(p) }; },
        write: async (p, c) => { files.set(p, c); return { success: true }; },
        exists: async (p) => ({ exists: files.has(p) || dirs.has(p) }),
        mkdir: async (p) => { dirs.add(p); return { success: true }; },
        list: async () => ({ entries: [] }),
        deleteFile: async (p) => { files.delete(p); return { success: true }; },
        copy: async () => ({ success: true }),
        unzip: async () => ({ success: true })
    },
    Chat: {
        call: async (opts) => {
            chatCalls.push(opts.functionType);
            if (chatMode === "hang") return new Promise(() => { }); // 永不 resolve：模拟模型卡死
            return { text: '{"remember":false,"items":[]}', finishReason: "stop" };
        }
    },
    System: { toast: async () => ({}) },
    SoftwareSettings: {}
};

/* main.js 顶层会直接调用 ToolPkg.ipc.on / registerXxx，必须先 mock 再 require */
globalThis.ToolPkg = {
    ipc: { on: () => { }, call: async () => ({ success: true }) },
    registerToolboxUiModule: () => { },
    registerNavigationEntry: () => { },
    registerXmlRenderPlugin: () => { },
    registerSystemPromptComposeHook: () => { },
    registerPromptInputHook: () => { },
    registerPromptFinalizeHook: () => { },
    registerMessageProcessingPlugin: () => { },
    registerChatMessageHook: () => { }
};

const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === "./memory-core" || request.endsWith("memory-core") || request.endsWith("memory-core.js")) return patchedCore;
    return origResolve.call(this, request, parent, ...rest);
};

const core = require(patchedCore);
const ai = require(path.join(WORK, "dist/ai-extract.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log("  ✅ " + name); }
    else { fail++; console.log("  ❌ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 200) : "")); }
}

(async () => {
    /* 超时下限是 3000ms。总预算要 > 2×下限，两个通道才都能拿到时间（8000 时各 3000/5000） */
    const settings = await core.loadSettings();
    settings.aiExtractTimeoutMs = 8000;
    settings.aiExtractMinLen = 2;
    await core.saveSettings(settings);

    console.log("=== 1. 单通道超时 → 降级 CHAT ===");
    chatCalls = [];
    chatMode = "hang";
    let t0 = Date.now();
    const r1 = await ai.aiExtractText("这是一条足够长的测试消息用于触发判定", undefined);
    const el1 = Date.now() - t0;
    ok("两个通道都被尝试过", chatCalls.length === 2, chatCalls);
    /* 断言的是「超时机制生效」，不是「计时精确」。
       下限：两个通道各拿 3000ms，所以不可能早于 6s 返回。
       上限：总预算 8s，允许 +2s 调度抖动（机器忙时 setTimeout 会迟到）。 */
    ok("在总预算内返回（6s~10s）", el1 >= 5500 && el1 <= 10000, el1);
    ok("失败后不抛异常、返回结果", !!(r1 && typeof r1 === "object"), r1);
    ok("统计记录为错误", /超时|timeout/i.test(String((await ai.aiStatus()).lastError || "")), (await ai.aiStatus()).lastError);

    console.log("=== 2. 看门狗：整条链路卡死也能返回 ===");
    /* 调小超时让看门狗预算 = 3000*2+10000 = 16s，测试不至于跑太久 */
    const s2 = await core.loadSettings();
    s2.aiExtractTimeoutMs = 3000;
    await core.saveSettings(s2);
    /* 直接测 dmHandleContent：把 aiExtractText 换成永不 resolve */
    const aiPath = path.join(WORK, "dist/ai-extract.js");
    const aiMod = require(aiPath);
    const origExtract = aiMod.aiExtractText;
    let recordCalled = 0;
    aiMod.aiExtractText = () => new Promise(() => { }); // 永久挂起（模拟卡在 IO/解析层）
    const main = require(path.join(WORK, "dist/main.js"));
    const g = globalThis;
    g.__DM_AI_INFLIGHT__ = null;
    chatCalls = [];
    t0 = Date.now();
    const hookP = main.onChatMessagePersisted({
        eventPayload: { chatId: "c1", content: "记住：我的测试编号是 4242", sender: "user" }
    });
    ok("钩子返回了 Promise", !!(hookP && typeof hookP.then === "function"), typeof hookP);
    const raced = await Promise.race([
        hookP.then(() => "resolved"),
        new Promise((res) => setTimeout(() => res("timeout-too-slow"), 40000))
    ]);
    const el2 = Date.now() - t0;
    ok("钩子在看门狗预算内 resolve（未被永久挂住）", raced === "resolved", { raced, el2 });
    /* 看门狗预算 = 3000*2 + 10000 = 16s。只验证「约在预算附近」：
       不能明显早于 13s（那说明根本没等超时），也不能晚于 22s（那说明看门狗没生效）。
       原来写 ±4s 太窄，机器一忙 setTimeout 迟到就随机失败。 */
    ok("耗时在预算附近（13s~22s）", el2 >= 13000 && el2 <= 22000, el2);

    aiMod.aiExtractText = origExtract;

    console.log("=== 3. 并发闸门：卡住时不叠加新调用 ===");
    aiMod.aiExtractText = () => new Promise(() => { });
    g.__DM_AI_INFLIGHT__ = null;
    const p1 = main.onChatMessagePersisted({ eventPayload: { chatId: "c2", content: "记住：并发测试第一条消息", sender: "user" } });
    await new Promise((r) => setTimeout(r, 300));
    t0 = Date.now();
    const p2 = main.onChatMessagePersisted({ eventPayload: { chatId: "c3", content: "记住：并发测试第二条消息", sender: "user" } });
    const fast = await Promise.race([
        p2.then(() => "skipped"),
        new Promise((res) => setTimeout(() => res("would-block"), 2000))
    ]);
    ok("第二条被并发闸门直接跳过（立即返回）", fast === "skipped", fast);
    ok("闸门耗时 < 2s", Date.now() - t0 < 2000, Date.now() - t0);

    console.log("=== 4. 正常路径不受影响 ===");
    aiMod.aiExtractText = origExtract;
    g.__DM_AI_INFLIGHT__ = null;
    chatMode = "ok";
    chatCalls = [];
    const r4 = await ai.aiExtractText("这是一条正常的测试消息内容", undefined);
    ok("正常调用成功", r4 && r4.success !== false, r4 && r4.message);
    ok("只调用一次模型", chatCalls.length === 1, chatCalls);

    console.log("");
    console.log("通过 " + pass + " / 失败 " + fail);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error("测试异常：", e);
    process.exit(3);
});