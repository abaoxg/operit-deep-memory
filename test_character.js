#!/usr/bin/env node
"use strict";
/**
 * 角色主线隔离专项测试（v1.2.0）
 * 验证的核心命题：隔离必须在「所有出口」都生效，而不只是存的时候分开了。
 *   1. isVisibleToCharacter 判定矩阵（隔离关/开、全局/私域、有/无角色、匹配/不匹配）
 *   2. recall 不会漏出别的角色的记忆
 *   3. buildInjection 不会把角色 A 的记忆注入给角色 B
 *   4. injectionCacheHash 随角色变化（否则切角色会命中上一角色的缓存文本）
 *   5. remember 跨角色绝不合并（否则角色 A 的话会被并进角色 B）
 *   6. characterStats / touchCharacterRegistry / resolveCharacterId 行为正确
 *   7. 旧数据（无 characterId）不受影响，默认行为与 v1.1.x 一致
 */
const path = require("path");
const fs = require("fs");
const WORK = "/sdcard/dm_work2";
const corePath = path.join(WORK, "dist/memory-core.js");
const coreSrc = fs.readFileSync(corePath, "utf8");
const TARGET = "exports.DATA_DIR = `/sdcard/Download/Operit/plugins/${exports.PLUGIN_ID}`";
if (coreSrc.indexOf(TARGET) < 0) { console.error("DATA_DIR 定位失败，终止"); process.exit(2); }
const patched = path.join("/tmp", "core_char_test.js");
fs.writeFileSync(patched, coreSrc.replace(TARGET, 'exports.DATA_DIR = "/tmp/dm_char_data"'), "utf8");

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
function ok(n, c, e) { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + (e !== undefined ? " → " + JSON.stringify(e).slice(0, 240) : "")); } }

function mkItem(i, opt) {
    const o = opt || {};
    const it = {
        id: "m" + i,
        type: o.type || "fact",
        content: o.content || ("记忆内容 " + i + " 号，用于隔离测试的一句话"),
        tags: o.tags || ["测试"],
        importance: o.importance !== undefined ? o.importance : 4,
        source: "manual",
        createdAt: Date.now() - i * 1000,
        updatedAt: Date.now() - i * 1000,
        lastAccessAt: Date.now(),
        accessCount: 3,
        reviewCount: 0,
        lastReviewedAt: 0,
        nextReviewAt: 0,
        links: [],
        space: "general",
        pinned: false
    };
    if (o.characterId) it.characterId = o.characterId;
    if (o.characterName) it.characterName = o.characterName;
    return it;
}

function baseSettings(patch) {
    return Object.assign({
        autoInject: true,
        characterIsolation: true,
        injectGlobalMemory: true,
        injectCharacterMemory: true,
        characterAutoTag: true,
        characterFallbackGlobal: true,
        characterRegistry: [],
        injectGeneral: true,
        injectSpace: true,
        injectIncludeDue: false,
        injectCount: 20,
        injectBudgetChars: 4000,
        compactInject: false,
        cacheFriendly: false,
        hotColdSplit: false,
        reviewEnabled: false,
        conflictCheck: false,
        dueRemind: false,
        birthdayRemind: false,
        activeSpace: "general"
    }, patch || {});
}

(async () => {
    /* ================= 1. 判定矩阵 ================= */
    console.log("=== 1. isVisibleToCharacter 判定矩阵 ===");
    {
        const g = mkItem(1);                                    // 全局
        const a = mkItem(2, { characterId: "A", characterName: "甲" });
        const b = mkItem(3, { characterId: "B", characterName: "乙" });

        const on = baseSettings();
        ok("隔离开·无角色身份只看到全局", core.isVisibleToCharacter(g, "", on) === true && core.isVisibleToCharacter(a, "", on) === false);
        ok("隔离开·角色A看到自己的", core.isVisibleToCharacter(a, "A", on) === true);
        ok("隔离开·角色A看不到B的", core.isVisibleToCharacter(b, "A", on) === false);
        ok("隔离开·角色A看到全局", core.isVisibleToCharacter(g, "A", on) === true);

        const off = baseSettings({ characterIsolation: false });
        ok("隔离关·全可见（向后兼容）", core.isVisibleToCharacter(a, "B", off) === true && core.isVisibleToCharacter(b, "A", off) === true);

        const noGlobal = baseSettings({ injectGlobalMemory: false });
        ok("关掉 injectGlobalMemory 后全局记忆不可见", core.isVisibleToCharacter(g, "A", noGlobal) === false);

        const noOwn = baseSettings({ injectCharacterMemory: false });
        ok("关掉 injectCharacterMemory 后自己的记忆也不可见", core.isVisibleToCharacter(a, "A", noOwn) === false);
    }

    /* ================= 2. recall 不漏 ================= */
    console.log("=== 2. recall 不漏出别的角色 ===");
    {
        const store = {
            version: 1, updatedAt: Date.now(),
            items: [
                mkItem(1, { content: "全局暗号是 1111", tags: ["暗号"] }),
                mkItem(2, { content: "甲的暗号是 2222", tags: ["暗号"], characterId: "A", characterName: "甲" }),
                mkItem(3, { content: "乙的暗号是 3333", tags: ["暗号"], characterId: "B", characterName: "乙" })
            ]
        };
        const st = baseSettings();

        const rA = await core.recall(store, { query: "暗号", limit: 20, characterId: "A" }, st);
        const idsA = rA.items.map((m) => m.id).sort();
        ok("角色A只检索到 自己的+全局", idsA.join(",") === "m1,m2", idsA);

        const rB = await core.recall(store, { query: "暗号", limit: 20, characterId: "B" }, st);
        const idsB = rB.items.map((m) => m.id).sort();
        ok("角色B只检索到 自己的+全局", idsB.join(",") === "m1,m3", idsB);

        const rNone = await core.recall(store, { query: "暗号", limit: 20 }, st);
        ok("无角色身份只检索到全局", rNone.items.map((m) => m.id).join(",") === "m1", rNone.items.map((m) => m.id));

        const rAll = await core.recall(store, { query: "暗号", limit: 20, allCharacters: true }, st);
        ok("allCharacters=true 时能看到全部（管理场景）", rAll.items.length === 3, rAll.items.length);
    }

    /* ================= 3. buildInjection 不串 ================= */
    console.log("=== 3. buildInjection 不把甲的记忆注入给乙 ===");
    {
        const store = {
            version: 1, updatedAt: Date.now(),
            items: [
                mkItem(1, { content: "GLOBALMARK 全局共享事实" }),
                mkItem(2, { content: "ALPHAONLY 甲的专属秘密", characterId: "A", characterName: "甲" }),
                mkItem(3, { content: "BETAONLY 乙的专属秘密", characterId: "B", characterName: "乙" })
            ]
        };
        const st = baseSettings({ injectCount: 20, injectBudgetChars: 4000 });

        const tA = core.buildInjection(store, st, 4000, undefined, "A");
        ok("注入给A：含全局", tA.indexOf("GLOBALMARK") >= 0);
        ok("注入给A：含甲自己的", tA.indexOf("ALPHAONLY") >= 0);
        ok("注入给A：不含乙的", tA.indexOf("BETAONLY") < 0);

        const tB = core.buildInjection(store, st, 4000, undefined, "B");
        ok("注入给B：不含甲的", tB.indexOf("ALPHAONLY") < 0);
        ok("注入给B：含乙自己的", tB.indexOf("BETAONLY") >= 0);

        const tNone = core.buildInjection(store, st, 4000, undefined, "");
        ok("无角色身份：只有全局", tNone.indexOf("GLOBALMARK") >= 0 && tNone.indexOf("ALPHAONLY") < 0 && tNone.indexOf("BETAONLY") < 0);

        const stOff = baseSettings({ characterIsolation: false });
        const tOff = core.buildInjection(store, stOff, 4000, undefined, "A");
        ok("隔离关：三处内容都进（旧行为）", tOff.indexOf("ALPHAONLY") >= 0 && tOff.indexOf("BETAONLY") >= 0);
    }

    /* ================= 4. 缓存 hash 随角色变化 ================= */
    console.log("=== 4. injectionCacheHash 必须随角色变化 ===");
    {
        const store = {
            version: 1, updatedAt: Date.now(),
            items: [
                mkItem(1, { content: "全局事实" }),
                mkItem(2, { content: "甲的专属", characterId: "A" }),
                mkItem(3, { content: "乙的专属", characterId: "B" })
            ]
        };
        const st = baseSettings();
        const hA = core.injectionCacheHash(store, st, "A");
        const hB = core.injectionCacheHash(store, st, "B");
        const hN = core.injectionCacheHash(store, st, "");
        ok("A 与 B 的缓存 hash 不同", hA !== hB, [hA, hB]);
        ok("A 与 无角色 的缓存 hash 不同", hA !== hN, [hA, hN]);

        // 关掉 injectCharacterMemory 也要让 hash 变，否则改设置不生效
        const st2 = baseSettings({ injectCharacterMemory: false });
        ok("改 injectCharacterMemory 后 hash 变化", core.injectionCacheHash(store, st2, "A") !== hA);
        const st3 = baseSettings({ injectGlobalMemory: false });
        ok("改 injectGlobalMemory 后 hash 变化", core.injectionCacheHash(store, st3, "A") !== hA);
        const st4 = baseSettings({ characterIsolation: false });
        ok("关掉隔离后 hash 变化", core.injectionCacheHash(store, st4, "A") !== hA);
    }

    /* ================= 5. remember 跨角色绝不合并 ================= */
    console.log("=== 5. remember 跨角色绝不合并 ===");
    {
        const store = {
            version: 1, updatedAt: Date.now(),
            items: [mkItem(1, { content: "我的生日是 3 月 5 日", characterId: "A", characterName: "甲" })]
        };
        const st = baseSettings();

        // 同一句话，但归属角色 B —— 绝不能被合并进 A 的那条
        const r = await core.remember(store, {
            content: "我的生日是 3 月 5 日",
            characterId: "B",
            characterName: "乙"
        }, st);
        ok("跨角色同句不合并（新增而非合并）", store.items.length === 2, store.items.length);
        /* remember 用 unshift 插入，新条目在数组首位 */
        const added = store.items[0];
        ok("新条目归属角色 B", String(added.characterId) === "B", added.characterId);
        ok("原条目仍归属角色 A（未被篡改）", String(store.items[1].characterId) === "A", store.items[1].characterId);

        // 同一角色内同句仍应合并（保持原有去重能力）
        const before = store.items.length;
        await core.remember(store, {
            content: "我的生日是 3 月 5 日",
            characterId: "B",
            characterName: "乙"
        }, st);
        ok("同角色内同句仍会合并（去重未被破坏）", store.items.length === before, [before, store.items.length]);

        // 全局记忆也不该被角色记忆吞掉
        const store2 = {
            version: 1, updatedAt: Date.now(),
            items: [mkItem(1, { content: "关键约定是 K9", characterId: "A" })]
        };
        await core.remember(store2, { content: "关键约定是 K9" }, st);
        ok("全局记忆不与角色记忆合并", store2.items.length === 2, store2.items.length);
    }

    /* ================= 6. 注册表 / 统计 / 解析 ================= */
    console.log("=== 6. 注册表 / 统计 / 角色解析 ===");
    {
        const st = baseSettings();
        const c1 = core.touchCharacterRegistry(st, "A", "甲");
        ok("首次登记返回 changed=true", c1 === true);
        ok("注册表里有 A", st.characterRegistry.length === 1 && st.characterRegistry[0].name === "甲");
        const c2 = core.touchCharacterRegistry(st, "A", "甲");
        ok("60 秒内重复登记返回 false（避免每轮都落盘）", c2 === false);
        const c3 = core.touchCharacterRegistry(st, "A", "甲改");
        ok("改名返回 true", c3 === true && st.characterRegistry[0].name === "甲改");

        const store = {
            version: 1, updatedAt: Date.now(),
            items: [
                mkItem(1),
                mkItem(2, { characterId: "A", characterName: "甲" }),
                mkItem(3, { characterId: "A", characterName: "甲" }),
                mkItem(4, { characterId: "B", characterName: "乙" })
            ]
        };
        const stats = core.characterStats(store, st);
        const map = {};
        stats.forEach((s) => { map[s.id] = s.count; });
        ok("统计：A=2 B=1", map["A"] === 2 && map["B"] === 1, map);

        // resolveCharacterId 的四种 event 结构
        ok("从 metadata.activePrompt 解析", core.resolveCharacterId({ metadata: { activePrompt: { type: "character_card", id: "X", name: "某角色" } } }).id === "X");
        ok("从 eventPayload.metadata.activePrompt 解析",
            core.resolveCharacterId({ eventPayload: { metadata: { activePrompt: { type: "character", id: "Y" } } } }).id === "Y");
        ok("从 eventPayload.activePrompt 解析",
            core.resolveCharacterId({ eventPayload: { activePrompt: { type: "persona", id: "Z" } } }).id === "Z");
        ok("非角色类型不误判",
            core.resolveCharacterId({ metadata: { activePrompt: { type: "system", id: "W" } } }).id === "");
        ok("无 activePrompt 时返回空", core.resolveCharacterId({ eventPayload: { chatId: "c1" } }).id === "");
    }

    /* ================= 7. 旧数据兼容 ================= */
    console.log("=== 7. 旧数据（无 characterId）兼容 ===");
    {
        const store = {
            version: 1, updatedAt: Date.now(),
            items: [mkItem(1, { content: "旧数据一" }), mkItem(2, { content: "旧数据二" })]
        };
        const st = baseSettings();
        const t = core.buildInjection(store, st, 4000, undefined, "A");
        ok("旧数据在隔离开时仍是全局可见", t.indexOf("旧数据一") >= 0 && t.indexOf("旧数据二") >= 0);
        const st2 = baseSettings({ characterIsolation: false });
        const t2 = core.buildInjection(store, st2, 4000, undefined, "");
        ok("旧数据在隔离关时也正常", t2.indexOf("旧数据一") >= 0);
    }

    console.log("==================================");
    console.log("通过 " + pass + " / 失败 " + fail);
    console.log("==================================");
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("测试异常:", e); process.exit(2); });