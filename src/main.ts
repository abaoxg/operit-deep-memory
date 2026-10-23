"use strict";
/**
 * Deep Memory - main entry
 * 注册：工具箱 UI（液态玻璃六屏记忆面板）、XML 渲染（<memory_card/>）、IPC（记忆读写检索）、
 *       系统提示词注入 Hook（把高价值长期记忆自动注入对话上下文）
 */
import type { ToolPkg as ToolPkgType } from "../types/toolpkg";
import * as memory_core_1 from "./memory-core";
import * as deep_memory_1 from "./packages/deep_memory";
import * as ai_extract_1 from "./ai-extract";
import * as ui_index_1 from "./ui/index.ui.js";
/* P7：同上下文直连桥。UI 与 main 共享同一 JS 上下文时，UI 优先调用这里的函数，
   彻底绕过 ToolPkg.ipc 的跨上下文路由（原实现面板因此拿不到任何数据）。 */
globalThis.__DM_BRIDGE__ = {
    "memory.get_all": (p) => deep_memory_1.ipcGetAll(p && typeof p.limit === "number" ? p.limit : 100),
    "memory.recall": (p) => deep_memory_1.ipcRecallForUi(p || {}),
    "memory.stats": () => deep_memory_1.ipcStatsForUi(),
    "memory.review": (p) => deep_memory_1.ipcReviewForUi(p && typeof p.limit === "number" ? p.limit : 20),
    "memory.delete": (p) => deep_memory_1.ipcDelete(p && p.id),
    "memory.update_importance": (p) => deep_memory_1.ipcUpdateImportance(p && p.id, p && typeof p.importance === "number" ? p.importance : 3),
    "memory.set_pinned": (p) => deep_memory_1.ipcSetPinned(p && p.id, !!(p && p.pinned === true)),
    "memory.review_done": (p) => deep_memory_1.ipcReviewDone(p && p.id),
    "memory.settings.get": () => deep_memory_1.ipcSettingsGet(),
    "memory.settings.set": (p) => deep_memory_1.ipcSettingsSet(p || {}),
    "memory.suggest_links": (p) => deep_memory_1.ipcSuggestLinks(p && p.id),
    "memory.injection_preview": () => deep_memory_1.ipcInjectionPreview(),
    "memory.report": (p) => deep_memory_1.ipcReport(p && p.space, p && p.days),
    "memory.conflicts": (p) => deep_memory_1.ipcConflicts(!!(p && p.clear === true)),
    /* 角色主线：注册表 / 归属 / 迁移 / 遗忘 / 预演 */
    "memory.character_list": () => deep_memory_1.ipcCharacterList(),
    "memory.character_register": (p) => deep_memory_1.ipcCharacterRegister(String((p && p.id) || ""), String((p && p.name) || "")),
    "memory.character_assign": (p) => deep_memory_1.ipcCharacterAssign(String((p && p.memoryId) || ""), String((p && p.characterId) || ""), p && p.characterName ? String(p.characterName) : undefined),
    "memory.character_migrate": (p) => deep_memory_1.ipcCharacterMigrate(String((p && p.fromId) || ""), String((p && p.toId) || ""), p && p.toName ? String(p.toName) : undefined),
    "memory.character_forget": (p) => deep_memory_1.ipcCharacterForget(String((p && p.id) || ""), !(p && p.keepMemories === false)),
    "memory.character_preview": (p) => deep_memory_1.ipcCharacterPreview(String((p && p.characterId) || "")),
    "memory.extract": (p) => deep_memory_1.ipcAutoExtract(p && p.text),
    "memory.ai_status": () => ai_extract_1.aiStatus(),
    "memory.ai_probe": () => ai_extract_1.aiProbe(),
    "memory.ai_log": async () => {
        const st = await ai_extract_1.aiStatus();
        return { success: true, message: "AI 日志", data: { logTail: st.logTail, log: (globalThis.__DM_LOG__ || []).slice(-60) } };
    },
    "memory.ai_try": (p) => ai_extract_1.aiExtractText(p && p.text, p && p.chatId ? String(p.chatId) : undefined)
};
const XML_TAG = "memory_card";
/** XML 渲染：AI 回复中输出 <memory_card id="mxxx"/> 时渲染为文本记忆卡 */
function onXmlRender(event) {
    try {
        const payload = event && event.eventPayload ? event.eventPayload : (event || {});
        const tagName = payload.tagName;
        if (!tagName || tagName !== XML_TAG) {
            return { handled: false };
        }
        const attrs = payload.attributes || payload.attrs || {};
        const id = String(attrs.id || "").trim();
        if (!id)
            return { handled: false };
        return {
            handled: true,
            text: `🧠 [深度记忆] 记忆条目 ${id}（可在面板中查看详情）`
        };
    }
    catch (e) {
        return { handled: false };
    }
}
/* ---------- IPC：main 承载文件状态，供 UI / 其他上下文读取 ---------- */
ToolPkg.ipc.on("memory.get_all", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcGetAll)(typeof p.limit === "number" ? p.limit : 100);
});
ToolPkg.ipc.on("memory.recall", async (payload) => {
    return (0, deep_memory_1.ipcRecallForUi)(payload || {});
});
ToolPkg.ipc.on("memory.stats", async () => {
    return (0, deep_memory_1.ipcStatsForUi)();
});
ToolPkg.ipc.on("memory.review", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcReviewForUi)(typeof p.limit === "number" ? p.limit : 20);
});
ToolPkg.ipc.on("memory.delete", async (payload) => {
    const p = payload || {};
    if (!p.id)
        return { success: false, message: "缺少 id", data: null };
    return (0, deep_memory_1.ipcDelete)(p.id);
});
ToolPkg.ipc.on("memory.update_importance", async (payload) => {
    const p = payload || {};
    if (!p.id)
        return { success: false, message: "缺少 id", data: null };
    return (0, deep_memory_1.ipcUpdateImportance)(p.id, typeof p.importance === "number" ? p.importance : 3);
});
ToolPkg.ipc.on("memory.set_pinned", async (payload) => {
    const p = payload || {};
    if (!p.id)
        return { success: false, message: "缺少 id", data: null };
    return (0, deep_memory_1.ipcSetPinned)(p.id, p.pinned === true);
});
ToolPkg.ipc.on("memory.review_done", async (payload) => {
    const p = payload || {};
    if (!p.id)
        return { success: false, message: "缺少 id", data: null };
    return (0, deep_memory_1.ipcReviewDone)(p.id);
});
ToolPkg.ipc.on("memory.settings.get", async () => {
    return (0, deep_memory_1.ipcSettingsGet)();
});
ToolPkg.ipc.on("memory.settings.set", async (payload) => {
    return (0, deep_memory_1.ipcSettingsSet)(payload || {});
});
ToolPkg.ipc.on("memory.suggest_links", async (payload) => {
    const p = payload || {};
    if (!p.id)
        return { success: false, message: "缺少 id", data: null };
    return (0, deep_memory_1.ipcSuggestLinks)(p.id);
});
ToolPkg.ipc.on("memory.injection_preview", async () => {
    return (0, deep_memory_1.ipcInjectionPreview)();
});
ToolPkg.ipc.on("memory.report", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcReport)(p.space, typeof p.days === "number" ? p.days : undefined);
});
ToolPkg.ipc.on("memory.conflicts", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcConflicts)(p.clear === true);
});
/* ---------- 角色主线 IPC ---------- */
ToolPkg.ipc.on("memory.character_list", async () => {
    return (0, deep_memory_1.ipcCharacterList)();
});
ToolPkg.ipc.on("memory.character_register", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcCharacterRegister)(String(p.id || ""), String(p.name || ""));
});
ToolPkg.ipc.on("memory.character_assign", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcCharacterAssign)(String(p.memoryId || ""), String(p.characterId || ""), p.characterName ? String(p.characterName) : undefined);
});
ToolPkg.ipc.on("memory.character_migrate", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcCharacterMigrate)(String(p.fromId || ""), String(p.toId || ""), p.toName ? String(p.toName) : undefined);
});
ToolPkg.ipc.on("memory.character_forget", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcCharacterForget)(String(p.id || ""), p.keepMemories !== false);
});
ToolPkg.ipc.on("memory.character_preview", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.ipcCharacterPreview)(String(p.characterId || ""));
});
ToolPkg.ipc.on("memory.extract", async (payload) => {
    const p = payload || {};
    if (!p.text)
        return { success: false, message: "缺少 text", data: null };
    return (0, deep_memory_1.ipcAutoExtract)(p.text);
});
ToolPkg.ipc.on("memory.remember", async (payload) => {
    const p = (payload || {});
    if (!p.content)
        return { success: false, message: "缺少 content", data: null };
    const r = await (0, deep_memory_1.dm_remember)({ ...p, source: "ui" });
    return r;
});
ToolPkg.ipc.on("memory.recall_simple", async (payload) => {
    const p = payload || {};
    return (0, deep_memory_1.dm_recall)({ query: p.query, limit: typeof p.limit === "number" ? p.limit : 10, sortBy: "relevance" });
});
/* ---------- AI 提取引擎：状态 / 自检 / 日志 ---------- */
ToolPkg.ipc.on("memory.ai_status", async () => {
    try {
        const st = await ai_extract_1.aiStatus();
        return { success: true, message: "AI 状态", data: st };
    }
    catch (e) {
        return { success: false, message: String(e && e.message || e), data: null };
    }
});
ToolPkg.ipc.on("memory.ai_probe", async () => {
    try {
        const r = await ai_extract_1.aiProbe();
        return { success: !!r.ok, message: r.ok ? "模型连通正常（" + r.functionType + "）" : ("调用失败：" + r.error), data: r };
    }
    catch (e) {
        return { success: false, message: String(e && e.message || e), data: null };
    }
});
ToolPkg.ipc.on("memory.ai_reset", async () => {
    try {
        await ai_extract_1.aiResetState();
        return { success: true, message: "AI 统计已重置", data: null };
    }
    catch (e) {
        return { success: false, message: String(e && e.message || e), data: null };
    }
});
ToolPkg.ipc.on("memory.ai_log", async () => {
    try {
        const st = await ai_extract_1.aiStatus();
        return { success: true, message: "AI 日志", data: { logTail: st.logTail, log: (globalThis.__DM_LOG__ || []).slice(-60) } };
    }
    catch (e) {
        return { success: false, message: String(e && e.message || e), data: null };
    }
});
/** 手动触发一次提取（调参/验收用） */
ToolPkg.ipc.on("memory.ai_try", async (payload) => {
    const p = payload || {};
    if (!p.text) return { success: false, message: "缺少 text", data: null };
    try {
        return await ai_extract_1.aiExtractText(String(p.text), p.chatId ? String(p.chatId) : undefined);
    }
    catch (e) {
        return { success: false, message: String(e && e.message || e), data: null };
    }
});
/* ---------- 系统提示词注入 Hook：长期记忆自动进入上下文 ---------- */
async function composeSystemPrompt(event) {
    try {
        const store = await (0, memory_core_1.loadStore)();
        const settings = await (0, memory_core_1.loadSettings)();
        if (!settings.autoInject || store.items.length === 0)
            return null;
        const chatId = event && event.eventPayload ? String(event.eventPayload.chatId || "") : "";
        // 角色主线：从 event 里解析当前角色（多层兜底 + PromptInput 通道缓存），拿不到就是 ""（全局域）
        const who = currentCharacterId(event);
        let characterId = who.id;
        dmLog("inject 角色域=" + (characterId || "(全局)"));
        // 热路径写回角色注册表（只在真有角色且确实有变化时才落盘，避免每轮都写）
        if (characterId && settings.characterAutoTag !== false) {
            try {
                if ((0, memory_core_1.touchCharacterRegistry)(settings, who.id, who.name)) {
                    await (0, memory_core_1.saveSettings)(settings);
                }
            }
            catch (e) { }
        }
        // 拿不到角色时的兜底策略：降级全局（true）或什么都不注入（false）
        if (!characterId && settings.characterFallbackGlobal === false && settings.characterIsolation) {
            return null;
        }
        // 缓存友好：hash 未变则复用缓存文本（前缀缓存命中→省钱）；关闭则实时构建
        if (settings.cacheFriendly !== false) {
            const hash = (0, memory_core_1.injectionCacheHash)(store, settings, chatId, characterId);
            const cached = await (0, memory_core_1.loadInjectionCache)();
            if (cached && cached.hash === hash && cached.text) {
                return { systemPrompt: cached.text };
            }
            const injection = (0, memory_core_1.buildInjection)(store, settings, Number(settings.injectBudgetChars) || 1200, chatId, characterId);
            if (injection) {
                await (0, memory_core_1.saveInjectionCache)(hash, injection);
                return { systemPrompt: injection };
            }
            return null;
        }
        const injection = (0, memory_core_1.buildInjection)(store, settings, Number(settings.injectBudgetChars) || 1200, chatId, characterId);
        if (!injection)
            return null;
        return { systemPrompt: injection };
    }
    catch (e) {
        return null;
    }
}
/** 诊断日志：插件被调用过几次都记下来，便于定位「钩子是否被调度」 */
function dmLog(line) {
    try {
        if (!globalThis.__DM_LOG__) globalThis.__DM_LOG__ = [];
        globalThis.__DM_LOG__.push("[" + new Date().toISOString() + "] " + line);
        if (globalThis.__DM_LOG__.length > 300) globalThis.__DM_LOG__.shift();
        console.log("[deep_memory] " + line);
    } catch (e) { }
}
/** 每条消息只处理一次（两个钩子可能同时触发） */
function dmSeen(key) {
    try {
        if (!globalThis.__DM_SEEN__) globalThis.__DM_SEEN__ = {};
        const now = Date.now();
        const seen = globalThis.__DM_SEEN__;
        // 清理超过 5 分钟的旧记录
        Object.keys(seen).forEach((k) => { if (now - seen[k] > 300000) delete seen[k]; });
        if (seen[key]) return true;
        seen[key] = now;
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * 统一处理入口：AI 判定 → 写入；失败自动降级正则。
 *
 * 关键（v1.2.2 修复）：必须把 Promise 返回给宿主，由宿主 handleAsync 维持
 * 调用上下文（__operitCurrentCallId / toolPkgApi.apiVersion）直到 Promise 结束。
 * 旧实现用游离 async IIFE，hook 同步返回后宿主立刻 finalizeCall 清空 callId，
 * 之后 Tools.Chat.call 缺 apiVersion 直接抛错，AI 语义判定 100% 失效、
 * 只能降级正则——ai_extract.log 里成片的
 * "requires a ToolPkg execution context with a valid manifest.api_version" 即此。
 */
function dmHandleContent(content, chatId, source, characterId, characterName, side, scopeInfo?) {
    const isAiSide = side === "ai";
    /* 并发闸门：上一次判定还挂着时不再叠加。
       宿主对 hook 返回的 Promise 没有超时保护，若模型一直不返回，
       每次新消息都会再起一个调用，几分钟就能堆出几十个僵尸 Promise。
       v1.2.4：两侧各自一把闸门。共用一把会互相饿死——
       用户消息判定要挂 45s，期间 AI 回复到达就被整条丢掉。 */
    const g: any = globalThis as any;
    const gateKey = isAiSide ? "__DM_AI_INFLIGHT_AI__" : "__DM_AI_INFLIGHT__";
    const inflight = g[gateKey];
    if (inflight && Date.now() - inflight.at < (inflight.budget || 60000)) {
        dmLog(source + " 上一次 AI 判定仍在进行，跳过本条");
        return Promise.resolve();
    }
    return (async () => {
        let settings: any = {};
        try {
            settings = await memory_core_1.loadSettings();
            if (!settings.autoExtract) {
                dmLog(source + " 自动记忆已关闭(settings.autoExtract=false)");
                return;
            }
            if (isAiSide && settings.aiSideExtract === false) {
                dmLog(source + " AI 侧记忆已关闭(settings.aiSideExtract=false)");
                return;
            }
        }
        catch (e) { }
        const t = Number(settings && settings.aiExtractTimeoutMs) > 0 ? Number(settings.aiExtractTimeoutMs) : 45000;
        // 看门狗比模型预算更宽：模型自身超时由 ai-extract 处理并降级，
        // 这一层只兜「卡在 IO / 解析 / 写入」等模型之外的环节。
        const budget = Math.min(t * 2 + 10000, 240000);
        g[gateKey] = { at: Date.now(), budget, source };
        let done = false;
        const work = (async () => {
            try {
                const r = await ai_extract_1.aiExtractText(content, chatId, characterId, characterName, side, scopeInfo);
                const by = r && r.data ? String(r.data.by || "") : "";
                dmLog(source + " 处理完成 by=" + (by || "?") + " 角色=" + String(characterId || "全局").slice(0, 8) + " msg=" + String(r && r.message || "").slice(0, 100));
            }
            catch (e) {
                dmLog(source + " 异常: " + String(e && e.message || e));
            }
            finally {
                done = true;
                if (g[gateKey] && g[gateKey].source === source) g[gateKey] = null;
            }
        })();
        const watchdog = new Promise<void>((resolve) => {
            const timer = setTimeout(async () => {
                if (done) { resolve(); return; }
                dmLog(source + " 看门狗触发：" + budget + "ms 未完成，交回控制权");
                try { await ai_extract_1.aiRecordHookTimeout(budget, source); } catch (e) { }
                if (g[gateKey] && g[gateKey].source === source) g[gateKey] = null;
                resolve();
            }, budget);
        });
        // 关键：永远 resolve，不 reject。钩子抛错会被宿主当异常处理，
        // 而这里的目标只是「不阻塞管线」，失败需要静默降级而非打断对话。
        await Promise.race([work, watchdog]);
    })();
}

/** 消息处理：msgproc 通道（保留兼容；部分版本不下发，故以 chatMessage 为主） */
function onMessageProcessing(event) {
    try {
        const payload = event && event.eventPayload ? event.eventPayload : (event || {});
        const content = String(payload.messageContent || payload.content || "").trim();
        if (!content) { dmLog("msgproc 空消息"); return; }
        const chatId = String(payload.chatId || "");
        const p = payload;
        dmLog("msgproc 触发 probeOnly=" + String(p.probeOnly) + " chat=" + chatId.slice(0, 8) + " len=" + content.length);
        if (p.probeOnly === true) { dmLog("msgproc probeOnly=true 跳过"); return; }
        if (dmSeen(chatId + "|user|" + content)) { dmLog("msgproc 重复消息跳过"); return; }
        const who = currentCharacterId(event);
        probeEventFields(event);
        const sp = resolveSpeaker(event);
        const si = resolveMemoryScope(who, sp, "user");
        dmLog("msgproc 归属 scope=" + si.scope + " speaker=" + String(si.speaker || "-") + " 群=" + (sp.isGroup ? "是" : "否"));
        // 返回 Promise：让宿主 handleAsync 维持 call 上下文，Tools.Chat.call 才有 apiVersion
        return dmHandleContent(content, chatId, "msgproc", who.id, who.name, "user", si);
    }
    catch (e) {
        dmLog("msgproc 外层异常: " + String(e && e.message || e));
    }
    return;
}

/**
 * 主通道：消息落库后触发（实测远稳于 msgproc）
 * 事件字段：chatId / content / sender / completedAt
 * v1.2.4：不再只收用户消息。sender=user 走「用户侧」提示词，
 * sender=ai/assistant 走「AI 侧」提示词，记录 AI 自己的行动、待办与结论。
 * 两条链路配额与并发闸门都独立，互不挤占。
 */
function onChatMessagePersisted(event) {
    try {
        const p = event && event.eventPayload ? event.eventPayload : (event || {});
        const content = String(p.content || p.messageContent || "").trim();
        const chatId = String(p.chatId || "");
        const sender = String(p.sender || "").toLowerCase();
        if (!content) return;
        const isUser = !sender || sender === "user" || sender === "human";
        const isAI = sender === "ai" || sender === "assistant" || sender === "bot" || sender === "model";
        dmLog("chatmsg 触发 sender=" + sender + " 侧=" + (isUser ? "user" : isAI ? "ai" : "skip") + " chat=" + chatId.slice(0, 8) + " len=" + content.length);
        /* 未知 sender 仍然放行到用户侧：部分宿主版本 sender 为空或叫别的名字，
           若一律丢弃会导致主通道彻底失效（v1.2.3 之前就是这样踩过的）。 */
        if (!isUser && !isAI) {
            dmLog("chatmsg sender=" + sender + " 无法归类，按用户侧处理");
        }
        const side = isAI ? "ai" : "user";
        if (dmSeen(chatId + "|" + side + "|" + content)) { dmLog("chatmsg 重复消息跳过"); return; }
        const who = currentCharacterId(event);
        probeEventFields(event);
        const sp = resolveSpeaker(event);
        const si = resolveMemoryScope(who, sp, side);
        dmLog("chatmsg 归属 scope=" + si.scope + " speaker=" + String(si.speaker || "-") + " 群=" + (sp.isGroup ? "是" : "否")
            + " 检出名=" + (sp.name || "-") + " 检出id=" + (sp.id || "-"));
        // 同上：必须把 Promise 交给宿主，否则 AI 通道必失效
        return dmHandleContent(content, chatId, isAI ? "chatmsg-ai" : "chatmsg", who.id, who.name, side, si);
    }
    catch (e) {
        dmLog("chatmsg 外层异常: " + String(e && e.message || e));
    }
    return;
}
/**
 * 角色 id 探测通道（v1.2.0 补强）：
 * registerSystemPromptComposeHook 的 event 是否带 metadata.activePrompt 未经实测，
 * 而参考插件 character_memory_engine 实测可用的是 registerPromptInputHook /
 * registerPromptFinalizeHook（两者的 event 均带 evt.metadata.activePrompt）。
 * 故额外注册一条 PromptInput 通道，专职解析角色 id 并缓存到 globalThis，
 * 注入/写入/检索三条链路共享同一份解析结果，避免"注入时取不到、写入时也取不到"。
 */
function onPromptInput(input) {
    try {
        // 参考插件实测：payload 在 input.eventPayload，且有 stage 守卫
        const evt = (input && input.eventPayload) || {};
        const stage = String((evt as any).stage ?? (input && (input as any).eventName) ?? "");
        if (stage && stage !== "before_send_to_model")
            return null;
        const who = (0, memory_core_1.resolveCharacterId)(input);
        if (!who.id) {
            // 取不到不覆盖已有值：可能是同一次会话里其它不带角色的钩子先触发
            return null;
        }
        globalThis.__DM_CHAR__ = { id: who.id, name: who.name, at: Date.now() };
        dmLog("promptInput 角色解析 id=" + who.id.slice(0, 12) + " name=" + who.name);
    }
    catch (e) { }
    return null;
}
/**
 * 结算钩子（registerPromptFinalizeHook）：参考插件实测该通道的 event 必带
 * evt.metadata.activePrompt。这里既做角色探测，也把结构落盘供验收。
 */
function onPromptFinalize(event) {
    try {
        // 真实角色 id 优先写入共享缓存，供注入与写入链路使用
        const who = (0, memory_core_1.resolveCharacterId)(event);
        if (who.id && who.id.indexOf("role:") !== 0) {
            globalThis.__DM_CHAR__ = { id: who.id, name: who.name, at: Date.now() };
        }
    }
    catch (e) { }
    return null;
}
/* ================= v1.2.8 群聊发言人解析 =================
 * 背景：旧版只读 sender（user/ai 二分），完全不知道群里是谁在说话。
 * 实测 grep 确认 senderName / memberName / nickname / speaker / isGroup
 * 在 main.ts 与 memory-core.ts 里出现次数均为 0。
 *
 * 后果：张三说「我喜欢美式」、李四说「我喜欢拿铁」，
 * 两条都存成无主语记忆，注入时 AI 会以为都是用户本人的偏好。
 *
 * 字段候选按「零成本、命中即用」排列：真实字段名未知，故全部试探；
 * 一个都对不上时 speaker 留空，行为退回 v1.2.7（不会比现在更差）。
 */
function pickStr(o: any, keys: string[]): string {
    if (!o || typeof o !== "object") return "";
    for (const k of keys) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
        if (v && typeof v === "object" && typeof v.name === "string" && v.name.trim()) return v.name.trim();
    }
    return "";
}
/** 解析发言人。返回 { name, id, isUser, isGroup } */
function resolveSpeaker(event: any) {
    const p = (event && event.eventPayload) || event || {};
    const md = p.metadata || (p.eventPayload && p.eventPayload.metadata) || {};
    const ap = md.activePrompt || {};
    const sender = String(p.sender || p.role || "").toLowerCase();
    const isUserMsg = !sender || sender === "user" || sender === "human";
    /* 发言人显示名候选面 */
    const name = pickStr(p, ["senderName", "memberName", "nickname", "speakerName", "userName", "fromName", "nickName"])
        || pickStr(md, ["senderName", "memberName", "nickname", "speakerName"])
        || "";
    const id = pickStr(p, ["senderId", "memberId", "fromId", "userId", "speakerId"])
        || pickStr(md, ["senderId", "memberId"])
        || "";
    /* 群聊判定：任何一条成立即可 */
    const isGroup = p.isGroup === true || p.groupId !== undefined || p.groupName !== undefined
        || String(ap.type || "").toLowerCase() === "character_group"
        || (/^group:/.test(String((globalThis as any).__DM_CHAR__ && (globalThis as any).__DM_CHAR__.id || "")));
    return { name, id, isUser: isUserMsg, isGroup };
}
/** 计算这条记忆的归属：{ scope, characterId, characterName, speaker, speakerId }
 *
 * 核心规则（v1.2.8 的设计核心）：
 *   1. 用户本人在群里说的话 → scope=global
 *      「我」跨场景都是同一个你，用户画像不该被群边界切断。
 *      以前这条会被存进 group:xxx，回单聊就查不到。
 *   2. 群成员 / AI 在群里说的话 → scope=group，characterId=群作用域
 *      群里的私有知识不外流到别的群或单聊。
 *   3. 单聊（非群）→ 沿用旧逻辑，characterId 原样。
 */
function resolveMemoryScope(who: any, sp: any, side: string) {
    const charId = String((who && who.id) || "");
    const charName = String((who && who.name) || "");
    const isGroupScope = /^group:/.test(charId);
    /* 用户本人的话：无论在不在群，都归全局 */
    if (sp.isUser && side !== "ai") {
        return {
            scope: "global",
            characterId: undefined as string | undefined,
            characterName: undefined as string | undefined,
            speaker: "user",
            speakerId: sp.id || "user",
        };
    }
    /* 群成员 / AI 在群里：归该群，带发言人 */
    if (isGroupScope) {
        return {
            scope: "group",
            characterId: charId,
            characterName: charName,
            speaker: (sp.name || (side === "ai" ? "AI" : "")) || undefined,
            speakerId: sp.id || undefined,
        };
    }
    /* 单聊：沿用旧行为 */
    return {
        scope: charId ? "character" : "global",
        characterId: charId || undefined,
        characterName: charId ? charName : undefined,
        speaker: sp.isUser ? "user" : (sp.name || undefined),
        speakerId: sp.id || undefined,
    };
}
/** 一次性字段探针：把事件里真实存在的键写进日志，用于回填发言人字段名。
 *  只在第一次见到某个组合时写，避免刷屏。 */
function probeEventFields(event: any): void {
    try {
        const g: any = globalThis as any;
        if (g.__DM_PROBED__) return;
        g.__DM_PROBED__ = true;
        const p = (event && event.eventPayload) || event || {};
        const keys: string[] = [];
        const walk = (o: any, pre: string, d: number) => {
            if (!o || typeof o !== "object" || d > 2) return;
            Object.keys(o).forEach((k) => {
                const v = (o as any)[k];
                const t = typeof v;
                if (t === "string" || t === "number" || t === "boolean") {
                    keys.push(pre + k + "=" + String(v).slice(0, 30));
                } else if (v && t === "object") {
                    keys.push(pre + k + "={" + Object.keys(v).join(",") + "}");
                }
            });
        };
        walk(p, "", 0);
        dmLog("PROBE 事件字段: " + keys.join(" | "));
    } catch (e) { }
}
/** 取当前角色。三层优先级，且强制"真实 id 一旦拿到就压制 roleName 兜底"：
 *   1. 本 event 直接解析出的 activePrompt（最准）
 *   2. 全局缓存 __DM_CHAR__（注入钩子先跑、chatmsg 后跑时的共享来源）
 *   3. roleName 虚拟 id（仅在从未见过真实 id 的冷启动期使用）
 *
 * 为什么必须压制：chatmsg 通道没有 metadata，只能凭 roleName 造 "role:<角色名>"；
 * 而注入通道能拿到 "group:fe64d9e1-..."。若两者并存，同一条消息会被写成
 * role: 记忆、却用 group: 去检索，注入率恒为 0——这是 v1.2.0 首版的真实缺陷。
 * 因此只要缓存里有真实 id（非 role: 前缀），就无条件覆盖 roleName 结果。
 */
function currentCharacterId(event) {
    const direct = (0, memory_core_1.resolvePromptScope)(event);
    if (direct.id)
        return { id: direct.id, name: direct.name || "" };
    const c = globalThis.__DM_CHAR__;
    if (c && c.id && Date.now() - c.at < 600000)
        return { id: c.id, name: c.name || "" };
    const loose = (0, memory_core_1.resolveCharacterId)(event);
    if (loose.id)
        return loose;
    return { id: "", name: "" };
}
function registerToolPkg() {
    ToolPkg.registerToolboxUiModule({
        id: "deep_memory_panel",
        runtime: "compose_dsl",
        screen: ui_index_1.default || ui_index_1,
        params: {},
        title: {
            zh: "深度记忆",
            en: "Deep Memory"
        }
    });
    /* 侧边栏快捷入口：挂到侧边栏插件分组，不用每次进工具箱翻。 */
    try {
        (ToolPkg as any).registerNavigationEntry({
            id: "deep_memory_nav_sidebar",
            route: "toolpkg:com.operit.deep_memory:ui:deep_memory_panel",
            surface: "main_sidebar_plugins",
            title: { zh: "深度记忆", en: "Deep Memory", default: "Deep Memory" },
            icon: "psychology",
            order: 205
        });
    } catch (e) {}
    ToolPkg.registerXmlRenderPlugin({
        id: "deep_memory_xml_render",
        tag: XML_TAG,
        function: onXmlRender
    });
    ToolPkg.registerSystemPromptComposeHook({
        id: "deep_memory_inject",
        function: composeSystemPrompt
    });
    /* 角色 id 探测通道：参考插件实测 registerPromptInputHook 的 event 必带
       evt.metadata.activePrompt，用它兜住 registerSystemPromptComposeHook 可能缺失的 metadata。 */
    try {
        if (ToolPkg && typeof (ToolPkg as any).registerPromptInputHook === "function") {
            (ToolPkg as any).registerPromptInputHook({ id: "deep_memory_prompt_input", function: onPromptInput });
            dmLog("注册 registerPromptInputHook 成功（角色探测通道）");
        } else {
            dmLog("宿主不支持 registerPromptInputHook，角色仅靠 compose 钩子直取");
        }
    } catch (e) {
        dmLog("注册 registerPromptInputHook 失败: " + String(e && e.message || e));
    }
    /* 结算通道：参考插件实测 event 必带 metadata.activePrompt，作为角色 id 的第二来源 */
    try {
        if (ToolPkg && typeof (ToolPkg as any).registerPromptFinalizeHook === "function") {
            (ToolPkg as any).registerPromptFinalizeHook({ id: "deep_memory_prompt_finalize", function: onPromptFinalize });
            dmLog("注册 registerPromptFinalizeHook 成功（角色探测通道2）");
        } else {
            dmLog("宿主不支持 registerPromptFinalizeHook");
        }
    } catch (e) {
        dmLog("注册 registerPromptFinalizeHook 失败: " + String(e && e.message || e));
    }
    ToolPkg.registerMessageProcessingPlugin({
        id: "deep_memory_msgproc",
        function: onMessageProcessing
    });
    // 主通道：消息落库钩子（实测 2020 条零丢失，远稳于 msgproc）
    try {
        if (ToolPkg && typeof ToolPkg.registerChatMessageHook === "function") {
            ToolPkg.registerChatMessageHook({ id: "deep_memory_chatmsg", function: onChatMessagePersisted });
            dmLog("注册 chatMessage 钩子成功");
        } else {
            dmLog("宿主不支持 registerChatMessageHook，仅用 msgproc");
        }
    } catch (e) {
        dmLog("注册 chatMessage 钩子失败: " + String(e && e.message || e));
    }
    dmLog("registerToolPkg 完成");
    return true;
}
export {
    registerToolPkg,
    onXmlRender,
    composeSystemPrompt,
    onMessageProcessing,
    onChatMessagePersisted,
    onPromptInput,
    onPromptFinalize,
    currentCharacterId,
};