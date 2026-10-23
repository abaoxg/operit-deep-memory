#!/usr/bin/env node
"use strict";
/**
 * ai-extract 本地单元测试
 * 用 mock 的 Tools.Files / Tools.Chat 跑通：
 *  1. 跳过规则（寒暄/太短/代码块）
 *  2. AI 返回 remember:true → 写入
 *  3. AI 返回 remember:false → 不写
 *  4. AI 返回非法 JSON → 降级正则
 *  5. AI 调用抛错 → 降级正则
 *  6. functionType MEMORY 失败 → 降级 CHAT
 *  7. 每小时配额
 */
const path = require("path");
const fs = require("fs");

const WORK = path.resolve(__dirname);
const DATA = "/tmp/dm_test_data";
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });

/* ---- mock：把 DATA_DIR 指向 /tmp，避免污染真实记忆 ---- */
const corePath = path.join(WORK, "dist/memory-core.js");
const SRC_TARGET = "exports.DATA_DIR = `/sdcard/Download/Operit/plugins/${exports.PLUGIN_ID}`";
const coreSrc = fs.readFileSync(corePath, "utf8");
if (coreSrc.indexOf(SRC_TARGET) < 0) {
    console.error("!! 未找到 DATA_DIR 定义，测试可能污染真实数据，终止");
    process.exit(2);
}
const patchedCorePath = path.join(DATA, "memory-core.patched.js");
fs.writeFileSync(patchedCorePath, coreSrc.replace(
    SRC_TARGET,
    "exports.DATA_DIR = \"/tmp/dm_test_data/data\""
), "utf8");
fs.mkdirSync(path.join(DATA, "data"), { recursive: true });

/* ---- mock Tools ---- */
const files = new Map();
const dirs = new Set();
let chatCalls = [];
let chatBehavior = null; // function(ft, turns) -> {text,finishReason} | throws

globalThis.Tools = {
    Files: {
        read: async (p) => {
            if (!files.has(p)) throw new Error("ENOENT " + p);
            return { content: files.get(p) };
        },
        write: async (p, content) => { files.set(p, content); return { success: true }; },
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
            chatCalls.push(opts);
            if (chatBehavior) return chatBehavior(opts);
            return { text: '{"remember":false,"items":[]}', finishReason: "stop" };
        }
    },
    System: { toast: async () => ({}) },
    SoftwareSettings: {}
};

/* ---- 注入 patched core ---- */
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === "./memory-core" || request.endsWith("memory-core") || request.endsWith("memory-core.js")) {
        return patchedCorePath;
    }
    return origResolve.call(this, request, parent, ...rest);
};

const core = require(patchedCorePath);
const ai = require(path.join(WORK, "dist/ai-extract.js"));

/* ---- 断言 ---- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log("  ✅ " + name); }
    else { fail++; console.log("  ❌ " + name + (extra ? "  → " + JSON.stringify(extra).slice(0, 300) : "")); }
}
async function getStore() { return core.loadStore(); }

(async () => {
    console.log("=== 1. 跳过规则 ===");
    let r = await ai.aiExtractText("好的", undefined);
    ok("寒暄「好的」不调模型", chatCalls.length === 0, { calls: chatCalls.length, msg: r.message });
    r = await ai.aiExtractText("嗯", undefined);
    ok("「嗯」不调模型", chatCalls.length === 0);
    r = await ai.aiExtractText("```js\nconsole.log(1)\n```", undefined);
    ok("代码块不调模型", chatCalls.length === 0);

    console.log("=== 2. AI 判定记住 ===");
    chatCalls = [];
    chatBehavior = (o) => ({
        text: JSON.stringify({
            remember: true,
            items: [{ content: "用户是网络运维工程师", type: "fact", importance: 5, sensitive: false, space: "工作" }]
        }),
        finishReason: "stop"
    });
    r = await ai.aiExtractText("我是做网络运维的，平时负责机房和路由器", undefined);
    ok("调用了一次模型", chatCalls.length === 1, chatCalls.length);
    ok("functionType 首选 MEMORY", chatCalls[0] && chatCalls[0].functionType === "MEMORY", chatCalls[0] && chatCalls[0].functionType);
    ok("turns 含 SYSTEM+USER", chatCalls[0] && chatCalls[0].turns.length === 2);
    ok("结果 matched=true by=ai", r.data && r.data.matched === true && r.data.by === "ai", r.data);
    let st = await getStore();
    ok("记忆已写入", st.items.length === 1, st.items.length);
    ok("类型=fact 重要性=5", st.items[0] && st.items[0].type === "fact" && st.items[0].importance === 5, st.items[0]);
    ok("space=工作", st.items[0] && st.items[0].space === "工作", st.items[0] && st.items[0].space);

    console.log("=== 3. AI 判定不记 ===");
    chatCalls = [];
    chatBehavior = () => ({ text: '{"remember":false,"items":[]}', finishReason: "stop" });
    const before = (await getStore()).items.length;
    r = await ai.aiExtractText("帮我把这个文件复制到另一个目录去", undefined);
    const after = (await getStore()).items.length;
    ok("不写入新记忆", after === before, { before, after });
    ok("message 含无需记忆", /无需记忆/.test(r.message), r.message);

    console.log("=== 4. 非法 JSON → 降级正则 ===");
    chatCalls = [];
    chatBehavior = () => ({ text: "抱歉，我不明白", finishReason: "stop" });
    r = await ai.aiExtractText("记住：我的门禁密码是 5566", undefined);
    ok("降级 by=regex", r.data && r.data.by === "regex", r.data);
    st = await getStore();
    ok("正则兜底写入成功", st.items.some((x) => /5566/.test(x.content)), st.items.map((x) => x.content.slice(0, 20)));

    console.log("=== 5. 模型抛错 → 降级正则 ===");
    chatCalls = [];
    chatBehavior = () => { throw new Error("network down"); };
    r = await ai.aiExtractText("我喜欢用 zig 写代码", undefined);
    ok("降级正则命中", r.data && r.data.by === "regex", r.data);
    st = await getStore();
    ok("zig 记忆已写入", st.items.some((x) => /zig/i.test(x.content)), st.items.length);

    console.log("=== 6. MEMORY 失败 → 降级 CHAT ===");
    chatCalls = [];
    chatBehavior = (o) => {
        if (o.functionType === "MEMORY") throw new Error("Invalid function_type: MEMORY");
        return { text: '{"remember":true,"items":[{"content":"用户偏好单字回复确认","type":"preference","importance":4,"sensitive":false,"space":"general"}]}', finishReason: "stop" };
    };
    r = await ai.aiExtractText("以后确认我都是单字回复，别啰嗦", undefined);
    ok("尝试了 2 次", chatCalls.length === 2, chatCalls.map((c) => c.functionType));
    ok("成功走 CHAT", r.data && r.data.functionType === "CHAT", r.data);
    st = await getStore();
    ok("偏好已写入", st.items.some((x) => /单字回复/.test(x.content)), st.items.length);

    console.log("=== 7. JSON 带代码块包裹也能解析 ===");
    chatCalls = [];
    chatBehavior = () => ({
        text: '```json\n{"remember":true,"items":[{"content":"用户设备是某品牌X1","type":"fact","importance":4,"sensitive":false,"space":"general"}]}\n```',
        finishReason: "stop"
    });
    r = await ai.aiExtractText("我这台是某品牌 X1，系统是安卓 13", undefined);
    ok("从代码块中解析出记忆", r.data && r.data.by === "ai" && r.data.matched === true, r.data);

    console.log("=== 8. 敏感词自动标记 ===");
    chatCalls = [];
    chatBehavior = () => ({
        text: '{"remember":true,"items":[{"content":"用户的路由器密码是 987654","type":"fact","importance":5,"sensitive":false,"space":"general"}]}',
        finishReason: "stop"
    });
    r = await ai.aiExtractText("路由器管理密码 987654 你记一下别忘", undefined);
    st = await getStore();
    const sensItem = st.items.find((x) => /987654/.test(x.content));
    ok("密码条目敏感标记=true", !!(sensItem && sensItem.sensitive), sensItem && sensItem.sensitive);

    console.log("=== 9. 条数上限 ===");
    chatCalls = [];
    chatBehavior = () => ({
        text: JSON.stringify({
            remember: true,
            items: [
                { content: "用户第一条测试记忆项", type: "fact", importance: 3, sensitive: false, space: "general" },
                { content: "用户第二条测试记忆项", type: "fact", importance: 3, sensitive: false, space: "general" },
                { content: "用户第三条测试记忆项", type: "fact", importance: 3, sensitive: false, space: "general" },
                { content: "用户第四条测试记忆项", type: "fact", importance: 3, sensitive: false, space: "general" },
                { content: "用户第五条测试记忆项", type: "fact", importance: 3, sensitive: false, space: "general" }
            ]
        }),
        finishReason: "stop"
    });
    r = await ai.aiExtractText("这是一次测试，包含多条信息，看看会不会被截断到三条以内", undefined);
    ok("最多写入 3 条", r.data && r.data.items && r.data.items.length === 3, r.data && r.data.items && r.data.items.length);

    console.log("=== 10. aiStatus 可用 ===");
    const s = await ai.aiStatus();
    ok("available=true", s.available === true);
    ok("统计有累加", s.totalCalls > 0, s.totalCalls);
    ok("有 lastOutcome", !!s.lastOutcome, s.lastOutcome);
    ok("日志非空", !!s.logTail, s.logTail && s.logTail.slice(0, 60));

    console.log("=== 11. probe 探针 ===");
    chatBehavior = () => ({ text: '{"remember":true,"items":[{"content":"用户测试暗号是7788","type":"fact","importance":4,"sensitive":false,"space":"general"}]}', finishReason: "stop" });
    const pr = await ai.aiProbe();
    ok("probe ok", pr.ok === true && pr.parseOk === true, pr);

    console.log("");
    console.log("==================================");
    console.log("通过 " + pass + " / 失败 " + fail);
    console.log("==================================");
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error("测试异常：", e);
    process.exit(3);
});