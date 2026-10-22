"use strict";
/**
 * Deep Memory · AI 提取引擎
 *
 * 通过宿主模型接口 Tools.Chat.call 让当前对话模型判断
 * 「这条消息里有没有值得长期记住的东西」，替代原先 16 条固定正则。
 *
 * 设计要点：
 *  1. 零外部依赖：不需要 API Key，用宿主已配置的模型（functionType=MEMORY，失败降级 CHAT）
 *  2. 语义判定：AI 输出严格 JSON，含 remember / items / type / importance / sensitive / space
 *  3. 三层兜底：AI 不可用 → 正则（原逻辑）→ 不写入
 *  4. 成本护栏：最小长度、每小时次数上限、单次最多 3 条、去重合并（复用 remember 的相似合并）
 *  5. 可观测：状态写入 ai_state.json，面板可查最后一次调用结果与错误
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiProbe = exports.aiResetState = exports.aiStatus = exports.aiExtractText = exports.aiExtractMessage = void 0;
const memory_core_1 = require("./memory-core");
const AI_STATE_FILE = `${memory_core_1.DATA_DIR}/ai_state.json`;
const AI_LOG_FILE = `${memory_core_1.DATA_DIR}/ai_extract.log`;
const MAX_LOG_LINES = 200;
const DEFAULTS = {
    aiExtract: true,
    aiExtractType: "MEMORY",
    aiExtractFallbackType: "CHAT",
    aiExtractMinLen: 6,
    aiExtractMaxPerHour: 60,
    aiExtractMaxItems: 3,
    aiExtractThinking: false,
    aiExtractRecordUsage: false
};
/* ---------------- 小工具 ---------------- */
function nowMs() { return Date.now(); }
function hourKey(ts) {
    const d = new Date(ts || nowMs());
    return `${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}${d.getHours()}`;
}
function str(v) {
    return v === undefined || v === null ? "" : String(v);
}
async function readJson(path, fallback) {
    try {
        const r = await globalThis.Tools.Files.read(path);
        const c = r && r.content ? r.content : (typeof r === "string" ? r : "");
        if (c)
            return JSON.parse(c);
    }
    catch (e) { /* not exists */ }
    return fallback;
}
async function writeJson(path, obj) {
    try {
        await globalThis.Tools.Files.write(path, JSON.stringify(obj), false);
        return true;
    }
    catch (e) {
        return false;
    }
}
function emptyState() {
    return {
        hourKey: "", callCount: 0, totalCalls: 0, totalRemembered: 0,
        totalSkipped: 0, totalErrors: 0, lastAt: 0, lastError: "",
        lastOutcome: "", lastItems: [], activeFunctionType: ""
    };
}
async function loadState() {
    const s = await readJson(AI_STATE_FILE, null);
    return s && typeof s === "object" ? s : emptyState();
}
async function saveState(st) {
    await writeJson(AI_STATE_FILE, st);
}
async function appendLog(line) {
    try {
        let old = "";
        try {
            const r = await globalThis.Tools.Files.read(AI_LOG_FILE);
            old = r && r.content ? r.content : (typeof r === "string" ? r : "");
        }
        catch (e) {
            old = "";
        }
        const rows = old ? old.split("\n").filter(Boolean) : [];
        rows.push(`[${new Date().toLocaleString()}] ${line}`);
        await globalThis.Tools.Files.write(AI_LOG_FILE, rows.slice(-MAX_LOG_LINES).join("\n"), false);
    }
    catch (e) { /* ignore */ }
}
/* ---------------- 宿主模型调用 ---------------- */
function chatApi() {
    try {
        const g = globalThis;
        const T = g && g.Tools ? g.Tools : null;
        if (T && T.Chat && typeof T.Chat.call === "function")
            return T.Chat;
    }
    catch (e) { }
    return null;
}
async function callModel(functionType, turns, opts) {
    const chat = chatApi();
    if (!chat)
        throw new Error("Tools.Chat.call 不可用");
    const o = opts || {};
    const payload = { functionType: String(functionType || "CHAT"), turns };
    if (o.recordTokenUsage !== undefined)
        payload.recordTokenUsage = !!o.recordTokenUsage;
    if (o.enableThinking !== undefined)
        payload.enableThinking = !!o.enableThinking;
    const res = await chat.call(payload);
    if (!res)
        throw new Error("模型返回空");
    const text = str(res.text).trim();
    if (!text) {
        if (str(res.finishReason) === "tool_call")
            throw new Error("模型返回 tool_call 而非文本");
        throw new Error("模型返回空文本");
    }
    return { text, finishReason: str(res.finishReason) };
}
async function callModelCascade(turns, settings) {
    const primary = str(settings.aiExtractType || DEFAULTS.aiExtractType).trim() || "MEMORY";
    const fallback = str(settings.aiExtractFallbackType || DEFAULTS.aiExtractFallbackType).trim() || "CHAT";
    const opts = {
        enableThinking: settings.aiExtractThinking === true,
        recordTokenUsage: settings.aiExtractRecordUsage === true
    };
    const tried = [];
    let lastErr = null;
    for (const ft of [primary, fallback]) {
        if (!ft || tried.indexOf(ft) >= 0)
            continue;
        tried.push(ft);
        try {
            const r = await callModel(ft, turns, opts);
            return { ok: true, text: r.text, functionType: ft };
        }
        catch (e) {
            lastErr = e;
            await appendLog(`调用失败 functionType=${ft}: ${str(e && e.message || e)}`);
        }
    }
    return { ok: false, error: str(lastErr && lastErr.message || lastErr || "未知错误"), tried };
}
/* ---------------- 提示词 ---------------- */
const SYSTEM_PROMPT = [
    "你是「长期记忆提取器」。判断用户这条消息里有没有值得长期记住的信息，只输出一个 JSON，不要任何解释、不要 markdown 代码块。",
    "",
    "【应该记住】",
    "1. 身份与联系方式：姓名、称呼、年龄、生日、职业、公司、学校、所在地",
    "2. 账号类：手机号、邮箱、微信号、账号、密码、证件号、银行卡（标记 sensitive=true）",
    "3. 稳定偏好与习惯：喜欢/讨厌的东西、说话风格要求、工作习惯、口味、作息",
    "4. 人与关系：家人、朋友、同事、伴侣及与用户的关系",
    "5. 长期目标、计划、约定、期限（含日期数字要原样保留）",
    "6. 用户明确要求记住的内容（如「记住：xxx」）",
    "7. 用户对 AI 的长期设定与约束（如「以后都用中文」「别再问我密码」「保持简短」）",
    "8. 项目/设备/环境的稳定事实（如设备型号、服务器地址、路径约定、不可变更的边界）",
    "",
    "【不应该记住】",
    "1. 问候、寒暄、情绪、语气词、单纯的「好」「继续」「收到」",
    "2. 一次性的临时请求（如「帮我看下这个文件」），除非含长期约定",
    "3. 对当前屏幕/报错的即时描述，且不含稳定结论",
    "4. 复述代码、日志、命令输出、大段文本本身",
    "5. 已经在上下文里出现过的重复信息（宁可漏记，不要凑数）",
    "6. 用户明确说「不用记」「忘掉」的内容",
    "",
    "【字段规则】",
    "- content：第三人称客观陈述，去掉「我」改成「用户」，保留原始数字、名称、日期，长度 6-60 字",
    "- type：fact | preference | event | relation | idea | task",
    "- importance：1-5 整数。身份/联系方式/密码/长期边界=5；偏好习惯/项目事实=4；计划观点=3；边缘信息=2",
    "- sensitive：含地址/电话/邮箱/账号/密码/证件/银行卡时为 true",
    "- space：工作 | 生活 | 学习 | general，按内容领域判断",
    "",
    "【输出格式】",
    '{"remember":true,"items":[{"content":"...","type":"fact","importance":4,"sensitive":false,"space":"general"}]}',
    '没有值得记的信息时输出：{"remember":false,"items":[]}',
    "",
    "【遗忘请求】若用户要求删除/忘掉某条记忆，输出：",
    '{"remember":false,"items":[],"forget":{"keyword":"要删除的关键词"}}'
].join("\n");
function buildTurns(text) {
    return [
        { kind: "SYSTEM", content: SYSTEM_PROMPT },
        { kind: "USER", content: text }
    ];
}
/* ---------------- 解析 ---------------- */
function parseJsonLoose(raw) {
    let t = str(raw).trim();
    if (!t)
        return null;
    t = t.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```\s*$/g, "").trim();
    const tryParse = (s) => { try {
        return JSON.parse(s);
    }
    catch (e) {
        return null;
    } };
    const v = tryParse(t);
    if (v)
        return v;
    const start = t.indexOf("{");
    if (start < 0)
        return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < t.length; i++) {
        const c = t[i];
        if (inStr) {
            if (esc) {
                esc = false;
                continue;
            }
            if (c === "\\") {
                esc = true;
                continue;
            }
            if (c === '"')
                inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            continue;
        }
        if (c === "{")
            depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0)
        return null;
    return tryParse(t.slice(start, end + 1));
}
const VALID_TYPES = ["fact", "preference", "event", "relation", "idea", "task"];
const VALID_SPACES = ["general", "工作", "生活", "学习"];
function clampImp(v, dflt) {
    const n = Number(v);
    if (!isFinite(n))
        return dflt;
    return Math.max(1, Math.min(5, Math.round(n)));
}
function normalizeItem(raw, settings) {
    if (!raw || typeof raw !== "object")
        return null;
    let content = str(raw.content).replace(/\s+/g, " ").trim();
    if (content.length < 4)
        return null;
    if (content.length > 200)
        content = content.slice(0, 200);
    let type = str(raw.type).toLowerCase().trim();
    if (VALID_TYPES.indexOf(type) < 0)
        type = "fact";
    const space = VALID_SPACES.indexOf(str(raw.space).trim()) >= 0 ? str(raw.space).trim() : "general";
    const sensitive = raw.sensitive === true ||
        /(地址|住址|手机号|电话|号码|微信号|微信|qq|邮箱|email|身份证|证件号|卡号|密码|账号|银行卡)/i.test(content);
    return {
        content,
        type,
        importance: clampImp(raw.importance, settings && settings.defaultImportance ? settings.defaultImportance : 3),
        sensitive,
        space
    };
}
/* ---------------- 主流程 ---------------- */
function shouldSkipByRule(text, settings) {
    const t = str(text).trim();
    const minLen = Math.max(2, Number(settings.aiExtractMinLen) || DEFAULTS.aiExtractMinLen);
    if (!t)
        return "空消息";
    if (t.length < minLen && !/记住|忘了/.test(t))
        return "太短";
    if (/^[\s\p{P}\p{S}]+$/u.test(t))
        return "纯符号";
    if (/^(好|好的|嗯|哦|行|可以|收到|继续|ok|okay|谢谢|多谢|你好|在吗|1|2|3)[。！!.~]*$/i.test(t))
        return "寒暄确认";
    if (/^```/.test(t))
        return "代码块";
    if (t.length > 4000)
        return "过长";
    return "";
}
async function bumpState(st, patch) {
    Object.keys(patch || {}).forEach((k) => { st[k] = patch[k]; });
    st.lastAt = nowMs();
    await saveState(st);
}
async function aiExtractMessage(text, chatId, settings, characterId, characterName) {
    const s = settings || await (0, memory_core_1.loadSettings)();
    const out = { aiUsed: false, remembered: [] };
    if (s.aiExtract === false) {
        out.skipped = "AI 提取已关闭";
        return out;
    }
    const skip = shouldSkipByRule(text, s);
    if (skip) {
        out.skipped = skip;
        return out;
    }
    const st = await loadState();
    const hk = hourKey();
    if (st.hourKey !== hk) {
        st.hourKey = hk;
        st.callCount = 0;
    }
    const cap = Math.max(1, Number(s.aiExtractMaxPerHour) || DEFAULTS.aiExtractMaxPerHour);
    if (st.callCount >= cap) {
        out.skipped = `已达每小时上限 ${cap} 次`;
        return out;
    }
    const t = str(text).slice(0, 4000);
    st.callCount = (st.callCount || 0) + 1;
    st.totalCalls = (st.totalCalls || 0) + 1;
    const res = await callModelCascade(buildTurns(t), s);
    out.aiUsed = true;
    if (!res.ok) {
        out.error = res.error;
        st.totalErrors = (st.totalErrors || 0) + 1;
        st.lastError = res.error || "";
        st.lastOutcome = "AI 调用失败";
        await bumpState(st);
        await appendLog(`AI 失败，降级正则：${res.error}`);
        return out;
    }
    out.functionType = res.functionType;
    st.activeFunctionType = res.functionType || "";
    out.raw = res.text;
    const parsed = parseJsonLoose(res.text || "");
    if (!parsed || typeof parsed !== "object") {
        out.parseOk = false;
        st.totalErrors = (st.totalErrors || 0) + 1;
        st.lastError = "返回内容不是合法 JSON";
        st.lastOutcome = "解析失败，降级正则";
        await bumpState(st);
        await appendLog(`解析失败：${(res.text || "").slice(0, 120)}`);
        return out;
    }
    out.parseOk = true;
    st.lastError = "";
    out.skipped = "";
    if (parsed.forget && str(parsed.forget.keyword).trim() && s.quickForget !== false) {
        out.forget = str(parsed.forget.keyword).trim();
        st.lastOutcome = `遗忘：${out.forget}`;
        await bumpState(st);
        return out;
    }
    if (parsed.remember !== true) {
        st.totalSkipped = (st.totalSkipped || 0) + 1;
        st.lastOutcome = "AI 判定：无需记忆";
        st.lastItems = [];
        await bumpState(st);
        return out;
    }
    const maxItems = Math.max(1, Number(s.aiExtractMaxItems) || DEFAULTS.aiExtractMaxItems);
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
        .slice(0, maxItems)
        .map((x) => normalizeItem(x, s))
        .filter(Boolean);
    if (!items.length) {
        st.totalSkipped = (st.totalSkipped || 0) + 1;
        st.lastOutcome = "AI 判定：无需记忆（条目无效）";
        await bumpState(st);
        return out;
    }
    const store = await (0, memory_core_1.loadStore)();
    const targetChatId = s.autoExtractChat === true && chatId ? chatId : undefined;
    // 角色归属：开启自动打角色且当前确实有角色时，记忆落到该角色名下
    const targetCharId = s.characterAutoTag !== false && characterId ? characterId : undefined;
    const brief = [];
    for (const it of items) {
        try {
            const r = await (0, memory_core_1.remember)(store, {
                content: it.content,
                type: it.type,
                importance: it.importance,
                source: "ai",
                sensitive: it.sensitive,
                space: it.space,
                chatId: targetChatId,
                characterId: targetCharId,
                characterName: targetCharId ? characterName : undefined
            }, s);
            if (r.conflicts && r.conflicts.length) {
                store.conflicts = (store.conflicts || []).concat(r.conflicts).slice(-10);
            }
            out.remembered.push({
                id: r.item.id, content: r.item.content, type: r.item.type,
                merged: r.merged, importance: r.item.importance
            });
            brief.push(`${r.merged ? "更新" : "新增"}「${r.item.content.slice(0, 30)}」`);
        }
        catch (e) {
            await appendLog(`写入失败：${str(e && e.message || e)}`);
        }
    }
    if (out.remembered.length) {
        await (0, memory_core_1.saveStore)(store);
        st.totalRemembered = (st.totalRemembered || 0) + out.remembered.length;
        st.lastOutcome = `记忆 ${out.remembered.length} 条`;
        st.lastItems = out.remembered.slice(0, 5);
        await appendLog(`AI(${res.functionType}) 命中：${brief.join("；")}`);
    }
    else {
        st.totalSkipped = (st.totalSkipped || 0) + 1;
        st.lastOutcome = "写入全部失败";
    }
    await bumpState(st);
    return out;
}
exports.aiExtractMessage = aiExtractMessage;
/** 先 AI 判定，失败/关闭时降级正则；返回 ToolResult 结构 */
async function aiExtractText(text, chatId, characterId, characterName) {
    const s = await (0, memory_core_1.loadSettings)();
    let res = null;
    try {
        res = await aiExtractMessage(text, chatId, s, characterId, characterName);
    }
    catch (e) {
        res = { aiUsed: false, remembered: [], error: str(e && e.message || e) };
    }
    if (res && res.aiUsed && res.parseOk && !res.remembered.length && !res.forget) {
        return { success: true, message: "AI 判定无需记忆", data: { matched: false, by: "ai" } };
    }
    if (res && res.forget) {
        const dm = require("./packages/deep_memory");
        const fr = await dm.dm_forget({ keyword: res.forget });
        return { success: true, message: `AI 遗忘「${res.forget}」→ ${fr.message}`, data: { matched: true, kind: "forget", by: "ai" } };
    }
    if (res && res.remembered.length) {
        const first = res.remembered[0];
        const ti = memory_core_1.TYPE_MAP[first.type] || memory_core_1.TYPE_MAP["fact"];
        const head = res.remembered.length > 1 ? `AI 记住 ${res.remembered.length} 条：` : "AI 已记忆：";
        return {
            success: true,
            message: head + `${ti.emoji}${ti.labelZh}「${first.content.slice(0, 60)}」`,
            data: { matched: true, by: "ai", items: res.remembered, functionType: res.functionType || "" }
        };
    }
    const intent = (0, memory_core_1.extractMemoryIntent)(text);
    if (!intent)
        return { success: true, message: "未命中（AI 与正则均无）", data: { matched: false, by: "regex" } };
    if (intent.kind === "forget") {
        const dm = require("./packages/deep_memory");
        const fr = await dm.dm_forget({ keyword: intent.content });
        return { success: true, message: `已执行快捷遗忘：「${intent.content}」→ ${fr.message}`, data: { matched: true, kind: "forget", by: "regex" } };
    }
    const store = await (0, memory_core_1.loadStore)();
    const targetChatId = s.autoExtractChat === true && chatId ? chatId : undefined;
    const targetCharId = s.characterAutoTag !== false && characterId ? characterId : undefined;
    const r = await (0, memory_core_1.remember)(store, {
        content: intent.content,
        type: intent.type,
        importance: intent.importance,
        source: "auto",
        sensitive: intent.sensitive,
        chatId: targetChatId,
        characterId: targetCharId,
        characterName: targetCharId ? characterName : undefined
    }, s);
    if (r.conflicts && r.conflicts.length) {
        store.conflicts = (store.conflicts || []).concat(r.conflicts).slice(-10);
    }
    await (0, memory_core_1.saveStore)(store);
    const ti = memory_core_1.TYPE_MAP[r.item.type] || memory_core_1.TYPE_MAP["fact"];
    return {
        success: true,
        message: `已自动记忆（正则兜底）：${ti.emoji}${ti.labelZh}「${r.item.content.slice(0, 60)}」`,
        data: { matched: true, by: "regex", id: r.item.id }
    };
}
exports.aiExtractText = aiExtractText;
async function aiStatus() {
    const s = await (0, memory_core_1.loadSettings)();
    const st = await loadState();
    const chat = chatApi();
    let logTail = "";
    try {
        const r = await globalThis.Tools.Files.read(AI_LOG_FILE);
        const c = r && r.content ? r.content : (typeof r === "string" ? r : "");
        logTail = c.split("\n").filter(Boolean).slice(-8).join("\n");
    }
    catch (e) { }
    return {
        available: !!chat,
        enabled: s.aiExtract !== false,
        functionType: str(s.aiExtractType || DEFAULTS.aiExtractType),
        fallbackType: str(s.aiExtractFallbackType || DEFAULTS.aiExtractFallbackType),
        activeFunctionType: st.activeFunctionType || "",
        hourQuotaUsed: st.hourKey === hourKey() ? (st.callCount || 0) : 0,
        hourQuotaCap: Math.max(1, Number(s.aiExtractMaxPerHour) || DEFAULTS.aiExtractMaxPerHour),
        totalCalls: st.totalCalls || 0,
        totalRemembered: st.totalRemembered || 0,
        totalSkipped: st.totalSkipped || 0,
        totalErrors: st.totalErrors || 0,
        lastAt: st.lastAt || 0,
        lastError: st.lastError || "",
        lastOutcome: st.lastOutcome || "",
        lastItems: st.lastItems || [],
        logTail,
        minLen: Number(s.aiExtractMinLen) || DEFAULTS.aiExtractMinLen,
        maxItems: Number(s.aiExtractMaxItems) || DEFAULTS.aiExtractMaxItems,
        settings: s
    };
}
exports.aiStatus = aiStatus;
async function aiResetState() {
    const st = emptyState();
    st.hourKey = hourKey();
    await saveState(st);
    return { success: true };
}
exports.aiResetState = aiResetState;
async function aiProbe() {
    const s = await (0, memory_core_1.loadSettings)();
    const testText = "记住：我的测试暗号是 7788，我是做网络运维的。";
    const res = await callModelCascade(buildTurns(testText), s);
    if (!res.ok)
        return { ok: false, error: res.error, tried: res.tried };
    const parsed = parseJsonLoose(res.text || "");
    return {
        ok: true,
        functionType: res.functionType,
        raw: (res.text || "").slice(0, 600),
        parseOk: !!parsed,
        parsed: parsed || null
    };
}
exports.aiProbe = aiProbe;
