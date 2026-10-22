"use strict";
/**
 * Deep Memory - main entry
 * 注册：工具箱 UI（液态玻璃六屏记忆面板）、XML 渲染（<memory_card/>）、IPC（记忆读写检索）、
 *       系统提示词注入 Hook（把高价值长期记忆自动注入对话上下文）
 */
import type { ToolPkg as ToolPkgType } from "../../types/toolpkg";
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
        // 缓存友好：hash 未变则复用缓存文本（前缀缓存命中→省钱）；关闭则实时构建
        if (settings.cacheFriendly !== false) {
            const hash = (0, memory_core_1.injectionCacheHash)(store, settings, chatId);
            const cached = await (0, memory_core_1.loadInjectionCache)();
            if (cached && cached.hash === hash && cached.text) {
                return { systemPrompt: cached.text };
            }
            const injection = (0, memory_core_1.buildInjection)(store, settings, Number(settings.injectBudgetChars) || 1200, chatId);
            if (injection) {
                await (0, memory_core_1.saveInjectionCache)(hash, injection);
                return { systemPrompt: injection };
            }
            return null;
        }
        const injection = (0, memory_core_1.buildInjection)(store, settings, Number(settings.injectBudgetChars) || 1200, chatId);
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

/** 统一处理入口：AI 判定 → 写入；失败自动降级正则 */
function dmHandleContent(content, chatId, source) {
    (async () => {
        try {
            const settings = await memory_core_1.loadSettings();
            if (!settings.autoExtract) {
                dmLog(source + " 自动记忆已关闭(settings.autoExtract=false)");
                return;
            }
            const r = await ai_extract_1.aiExtractText(content, chatId);
            const by = r && r.data ? String(r.data.by || "") : "";
            dmLog(source + " 处理完成 by=" + (by || "?") + " msg=" + String(r && r.message || "").slice(0, 100));
        }
        catch (e) {
            dmLog(source + " 异常: " + String(e && e.message || e));
        }
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
        if (dmSeen(chatId + "|" + content)) { dmLog("msgproc 重复消息跳过"); return; }
        dmHandleContent(content, chatId, "msgproc");
    }
    catch (e) {
        dmLog("msgproc 外层异常: " + String(e && e.message || e));
    }
    return;
}

/**
 * 主通道：消息落库后触发（实测远稳于 msgproc）
 * 事件字段：chatId / content / sender / completedAt
 * 只处理用户发出的消息（sender 为 user），AI 自己的回复不参与提取。
 */
function onChatMessagePersisted(event) {
    try {
        const p = event && event.eventPayload ? event.eventPayload : (event || {});
        const content = String(p.content || p.messageContent || "").trim();
        const chatId = String(p.chatId || "");
        const sender = String(p.sender || "").toLowerCase();
        if (!content) return;
        dmLog("chatmsg 触发 sender=" + sender + " chat=" + chatId.slice(0, 8) + " len=" + content.length);
        // 只处理用户消息
        if (sender && sender !== "user" && sender !== "human") {
            return;
        }
        if (dmSeen(chatId + "|" + content)) { dmLog("chatmsg 重复消息跳过"); return; }
        dmHandleContent(content, chatId, "chatmsg");
    }
    catch (e) {
        dmLog("chatmsg 外层异常: " + String(e && e.message || e));
    }
    return;
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
    ToolPkg.registerMessageProcessingPlugin({
        id: "deep_memory_probe",
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
    onChatMessagePersisted
};

