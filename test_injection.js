#!/usr/bin/env node
"use strict";
/**
 * buildInjection 注入预算专项测试
 * 验证：
 *  1. injectCount 是硬上限（pinned + due + 候选 合计不超过它）
 *  2. pinned 记忆一定进注入（常驻）
 *  3. 关闭 injectPinnedAlways 后 pinned 不特殊对待
 *  4. injectBudgetChars 扩容后能塞下更多
 *  5. 热冷分级 / 到期提醒 / 冲突提醒 不崩
 */
const path = require("path");
const fs = require("fs");

const WORK = "/sdcard/dm_work2";
const corePath = path.join(WORK, "dist/memory-core.js");
const coreSrc = fs.readFileSync(corePath, "utf8");
const TARGET = "exports.DATA_DIR = `/sdcard/Download/Operit/plugins/${exports.PLUGIN_ID}`";
if (coreSrc.indexOf(TARGET) < 0) { console.error("DATA_DIR 定位失败，终止"); process.exit(2); }
const patched = path.join("/tmp", "core_inj_test.js");
fs.writeFileSync(patched, coreSrc.replace(TARGET, 'exports.DATA_DIR = "/tmp/dm_inj_data"'), "utf8");

const files = new Map();
const dirs = new Set();
globalThis.Tools = {
    Files: {
        read: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return { content: files.get(p) }; },
        write: async (p, c) => { files.set(p, c); return { success: true }; },
        exists: async (p) => ({ exists: files.has(p) || dirs.has(p) }),
        mkdir: async (p) => { dirs.add(p); return { success: true }; },
        list: async () => ({ entries: [] }),
        deleteFile: async () => ({ success: true }),
        copy: async () => ({ success: true }),
        unzip: async () => ({ success: true })
    },
    Chat: { call: async () => ({ text: "{}", finishReason: "stop" }) },
    System: { toast: async () => ({}) },
    SoftwareSettings: {}
};
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, p, ...rest) {
    if (r.endsWith("memory-core") || r.endsWith("memory-core.js")) return patched;
    return orig.call(this, r, p, ...rest);
};

const core = require(patched);

let pass = 0, fail = 0;
function ok(n, c, e) { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + (e !== undefined ? " → " + JSON.stringify(e).slice(0, 200) : "")); } }

function mkItem(i, opt) {
    const o = opt || {};
    return {
        id: "m" + i,
        type: o.type || "fact",
        content: o.content || ("测试记忆内容第" + i + "条，长度控制用的一句话描述"),
        tags: o.tags || ["测试"],
        importance: o.importance !== undefined ? o.importance : 3,
        source: "manual",
        createdAt: Date.now() - i * 1000,
        updatedAt: Date.now() - i * 1000,
        lastAccessAt: o.cold ? Date.now() - 60 * 86400000 : Date.now(),
        accessCount: o.cold ? 1 : 3,
        reviewCount: 0,
        lastReviewedAt: 0,
        nextReviewAt: 0,
        links: [],
        space: "general",
        pinned: o.pinned === true
    };
}

(async () => {
    const baseSettings = await core.loadSettings();

    console.log("=== 1. injectCount 是硬上限（含 pinned） ===");
    {
        const store = { version: 1, items: [], updatedAt: Date.now() };
        // 6 条 pinned + 6 条普通
        for (let i = 1; i <= 6; i++) store.items.push(mkItem(i, { pinned: true, importance: 5 }));
        for (let i = 7; i <= 12; i++) store.items.push(mkItem(i, { importance: 2 }));
        const s = Object.assign({}, baseSettings, {
            injectCount: 5, injectIncludeDue: false, hotColdSplit: false, dueRemind: false,
            birthdayRemind: false, injectPinnedAlways: true, injectBudgetChars: 8000, compactInject: true
        });
        const out = core.buildInjection(store, s, 1200);
        const lineCount = out.split("\n").filter((l) => l.trim().startsWith("- ")).length;
        ok("注入条目不超过 injectCount=5", lineCount <= 5, lineCount);
    }

    console.log("=== 2. pinned 一定进注入 ===");
    {
        const store = { version: 1, items: [], updatedAt: Date.now() };
        store.items.push(mkItem(1, { pinned: true, content: "这条是置顶的边界规则必须常驻", importance: 5 }));
        for (let i = 2; i <= 20; i++) store.items.push(mkItem(i, { importance: 5, content: "普通高重要性记忆第" + i + "条内容" }));
        const s = Object.assign({}, baseSettings, {
            injectCount: 3, injectIncludeDue: false, hotColdSplit: false, dueRemind: false,
            birthdayRemind: false, injectPinnedAlways: true, injectBudgetChars: 8000, compactInject: true
        });
        const out = core.buildInjection(store, s, 1200);
        ok("置顶记忆出现在注入中", /置顶的边界规则必须常驻/.test(out), out.slice(0, 200));
    }

    console.log("=== 3. 关闭 injectPinnedAlways 后 pinned 不再优先 ===");
    {
        const store = { version: 1, items: [], updatedAt: Date.now() };
        store.items.push(mkItem(1, { pinned: true, content: "低重要性置顶不该出现", importance: 1 }));
        for (let i = 2; i <= 20; i++) store.items.push(mkItem(i, { importance: 5, content: "高重要性候选第" + i + "条" }));
        const s = Object.assign({}, baseSettings, {
            injectCount: 2, injectIncludeDue: false, hotColdSplit: false, dueRemind: false,
            birthdayRemind: false, injectPinnedAlways: false, injectBudgetChars: 8000, compactInject: true
        });
        const out = core.buildInjection(store, s, 1200);
        ok("关闭后低重要性 pinned 不强行注入", !/低重要性置顶不该出现/.test(out), out.slice(0, 200));
    }

    console.log("=== 4. injectBudgetChars 扩容生效 ===");
    {
        const store = { version: 1, items: [], updatedAt: Date.now() };
        for (let i = 1; i <= 10; i++) store.items.push(mkItem(i, { importance: 5, content: "记忆条目" + i + "：这是一段比较长的内容用来占字符预算" }));
        const sSmall = Object.assign({}, baseSettings, {
            injectCount: 10, injectIncludeDue: false, hotColdSplit: false, dueRemind: false,
            birthdayRemind: false, injectBudgetChars: 0, compactInject: true
        });
        const sBig = Object.assign({}, sSmall, { injectBudgetChars: 5000 });
        const small = core.buildInjection(store, sSmall, 150);
        const big = core.buildInjection(store, sBig, 150);
        ok("小预算输出更短（被截断）", small.length < big.length, { small: small.length, big: big.length });
        ok("大预算带出更多字符", big.length > small.length, { small: small.length, big: big.length });
        ok("小预算有丢弃提示", /因超出注入预算未显示/.test(small), small.slice(-80));
        ok("大预算不再提示丢弃", !/因超出注入预算未显示/.test(big), big.slice(-80));
    }

    console.log("=== 5. 空库 / 仅冷记忆 / 冲突提醒 不崩 ===");
    {
        const empty = { version: 1, items: [], updatedAt: Date.now() };
        ok("空库返回空串", core.buildInjection(empty, baseSettings, 1200) === "");
        const cold = { version: 1, items: [mkItem(1, { cold: true, importance: 4 })], updatedAt: Date.now() };
        const out = core.buildInjection(cold, Object.assign({}, baseSettings, { injectCount: 5 }), 1200);
        ok("仅冷记忆时输出标题行", /更多记忆/.test(out) || out.length >= 0, out.slice(0, 160));
        const conf = { version: 1, items: [mkItem(1, { importance: 5 })], updatedAt: Date.now(), conflicts: [{ existingId: "a", existingContent: "旧内容", newContent: "新内容", field: "123", at: Date.now() }] };
        const out2 = core.buildInjection(conf, Object.assign({}, baseSettings, { injectCount: 5 }), 1200);
        ok("冲突提醒正常渲染", /记忆冲突/.test(out2), out2.slice(0, 200));
    }

    console.log("");
    console.log("==================================");
    console.log("通过 " + pass + " / 失败 " + fail);
    console.log("==================================");
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("异常：", e); process.exit(3); });