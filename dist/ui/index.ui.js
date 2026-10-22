"use strict";
/**
 * Deep Memory - pure text panel (Compose DSL)
 * 纯文字面板：纯白背景，只有文字与必要的文字输入/按钮，无图标、无装饰。
 */
Object.defineProperty(exports, "__esModule", { value: true });
const INK = "#000000";
const INK_SOFT = "#444444";
const INK_FAINT = "#888888";
const LINE = "#EDEDED";
const TYPE_LABEL = {
    fact: "事实",
    preference: "偏好",
    event: "事件",
    relation: "关系",
    idea: "想法",
    task: "任务"
};
function typeLabel(type) {
    return TYPE_LABEL[type] || "记忆";
}
function stars(n) {
    return "★".repeat(Math.max(1, Math.min(5, n || 3)));
}
function divider(ctx) {
    return ctx.UI.Box({
        fillMaxWidth: true,
        height: 1,
        backgroundBrush: { type: "verticalGradient", colors: [LINE, LINE] }
    });
}

/* 模块级 IPC 帮助：settingsText 等屏幕外函数也要能拿到 main 上下文数据。
   screen() 内的 callIpc 已经带了 targetRuntime 与退避重试，这里复用同一套逻辑。 */
async function dmIpc(channel, payload) {
    try {
        const br = (typeof globalThis !== "undefined") ? globalThis.__DM_BRIDGE__ : null;
        if (br && typeof br[channel] === "function") {
            const rb = await br[channel](payload);
            if (rb !== undefined && rb !== null) {
                return (rb && rb.data !== undefined && rb.data !== null) ? rb.data : rb;
            }
        }
    } catch (e) { /* 落到 IPC */ }
    let lastErr = null;
    for (let i = 0; i < 6; i++) {
        try {
            const r = await ToolPkg.ipc.call(channel, payload, { targetRuntime: "main" });
            return (r && r.data !== undefined && r.data !== null) ? r.data : r;
        } catch (e1) {
            lastErr = e1;
            const m = String((e1 && e1.message) ? e1.message : e1);
            if (!/not registered|未注册|no handler|not found/i.test(m)) break;
            await new Promise(function (res) { setTimeout(res, 150 * (i + 1)); });
        }
    }
    try {
        const r2 = await ToolPkg.ipc.call(channel, payload);
        return (r2 && r2.data !== undefined && r2.data !== null) ? r2.data : r2;
    } catch (e2) {
        console.log("[deep_memory] dmIpc " + channel + " 失败: " + String((lastErr && lastErr.message) || lastErr) + " / " + String((e2 && e2.message) || e2));
        return null;
    }
}

/* ---------------- 记忆条目：纯文字 ---------------- */
function memoryText(ctx, m) {
    const tags = (m.tags || []).slice(0, 4).join(" #");
    const first = `${typeLabel(m.type)} · ${stars(m.importance)}${m.pinned ? " · 置顶" : ""}${m.imagePath ? " · 🖼️图片" : ""}${m.chatId ? " · 单独记忆" : ""}`;
    const second = (m.updatedAtText || "") + (tags ? "  #" + tags : "");
    return ctx.UI.Column({ spacing: 2 }, [
        ctx.UI.Text({ text: (m.imagePath ? "🖼️ " : "") + m.content, style: "bodyMedium", color: INK, maxLines: 4 }),
        ctx.UI.Text({ text: first, style: "labelSmall", color: INK_SOFT }),
        ctx.UI.Text({ text: second, style: "labelSmall", color: INK_FAINT }),
        ctx.UI.Spacer({ height: 4 }),
        divider(ctx)
    ]);
}
/* ---------------- 页面：全部为纯文字 ---------------- */
function dashboardText(ctx, stats) {
    const s = stats || {};
    const dist = (s.typeDist || []).filter((d) => d.count > 0)
        .map((d) => `${typeLabel(d.type)} ${d.count}`).join("，") || "无";
    const tags = (s.tagCloud || []).slice(0, 8)
        .map((t) => `#${t.tag}(${t.count})`).join("  ");
    return ctx.UI.Column({ spacing: 6 }, [
        ctx.UI.Text({ text: "深度记忆", style: "headlineSmall", fontWeight: "bold", color: INK }),
        ctx.UI.Text({ text: `共 ${s.total || 0} 条记忆，今日新增 ${s.todayAdded || 0}，本周新增 ${s.weekAdded || 0}，待复习 ${s.dueReview || 0}。平均健康度 ${s.avgHealth || 0}/100，累计访问 ${s.totalAccess || 0} 次，置顶 ${s.pinned || 0} 条。`, style: "bodyMedium", color: INK_SOFT }),
        ctx.UI.Text({ text: `类型分布：${dist}`, style: "bodyMedium", color: INK }),
        ctx.UI.Text({ text: tags ? `热门标签：${tags}` : "还没有标签，写入记忆后自动提取。", style: "bodySmall", color: INK_SOFT })
    ]);
}
function searchText(ctx, q, setQ, result, busy, onSearch) {
    return ctx.UI.Column({ spacing: 8 }, [
        ctx.UI.TextField({
            value: q,
            onValueChange: setQ,
            placeholder: "输入关键词搜索记忆",
            singleLine: true
        }),
        ctx.UI.Row({ verticalAlignment: "center", spacing: 8 }, [
            ctx.UI.Button({ text: busy ? "搜索中…" : "搜索", weight: 1, onClick: onSearch }),
            ctx.UI.Text({ text: result ? `命中 ${result.total || 0} 条` : "", style: "labelSmall", color: INK_SOFT })
        ]),
        ...(result && result.items && result.items.length
            ? result.items.map((m) => memoryText(ctx, m))
            : [ctx.UI.Text({ text: result ? "没有找到匹配的记忆。" : "输入关键词开始搜索，或在「时间线」浏览全部记忆。", style: "bodySmall", color: INK_FAINT })])
    ]);
}
function timelineText(ctx, items, busy) {
    return ctx.UI.Column({ spacing: 4 }, [
        ctx.UI.Text({ text: "记忆时间线", style: "titleMedium", fontWeight: "bold", color: INK }),
        ...(busy
            ? [ctx.UI.Text({ text: "加载中…", style: "bodySmall", color: INK_FAINT })]
            : items.length
                ? items.map((m) => memoryText(ctx, m))
                : [ctx.UI.Text({ text: "还没有记忆，让 AI 用 dm_remember 记录第一条。", style: "bodySmall", color: INK_FAINT })])
    ]);
}
function graphText(ctx, center, links, suggestions, allItems, onPick) {
    const pickable = allItems || [];
    /* P11：宿主 Text 支持 modifier.clickable（JsComposeDslBridge 的 ctx.Modifier 链式构建器），
       因此「全部记忆」可以直接渲染成可点击列表，点击后走 pickCenter() 设为中心并拉建议关联。 */
    const itemRow = (m) => ctx.UI.Text({
        text: `${typeLabel(m.type)}：${String(m.content || "").slice(0, 30)}${(m.links || []).length ? `（${m.links.length} 关联）` : ""}`,
        style: "bodySmall",
        color: INK,
        maxLines: 2,
        modifier: ctx.Modifier.clickable(() => onPick(m))
    });
    return ctx.UI.Column({ spacing: 6 }, [
        ctx.UI.Text({ text: "记忆图谱", style: "titleMedium", fontWeight: "bold", color: INK }),
        ...(center
            ? [
                ctx.UI.Text({ text: `中心记忆：${center.content}`, style: "bodyMedium", fontWeight: "bold", color: INK, maxLines: 3 }),
                ctx.UI.Text({ text: `ID：${center.id}，关联 ${(center.links || []).length} 条。`, style: "labelSmall", color: INK_FAINT }),
                divider(ctx)
            ]
            : [ctx.UI.Text({ text: "在下方列表点击一条记忆，查看它的关联。", style: "bodySmall", color: INK_FAINT })]),
        ctx.UI.Text({ text: "关联记忆", style: "titleSmall", fontWeight: "bold", color: INK }),
        ...(links.length
            ? links.map((m) => ctx.UI.Text({ text: `${typeLabel(m.type)}：${m.content}`, style: "bodySmall", color: INK, maxLines: 2 }))
            : [ctx.UI.Text({ text: center ? "该记忆暂无关联。" : "先选一条记忆作为中心。", style: "bodySmall", color: INK_FAINT })]),
        ctx.UI.Text({ text: "建议关联", style: "titleSmall", fontWeight: "bold", color: INK }),
        ...(suggestions.length
            ? suggestions.map((m) => ctx.UI.Text({ text: `${typeLabel(m.type)}：${m.content}`, style: "bodySmall", color: INK_SOFT, maxLines: 2 }))
            : [ctx.UI.Text({ text: center ? "没有建议。" : "先选一条记忆作为中心。", style: "bodySmall", color: INK_FAINT })]),
        divider(ctx),
        ctx.UI.Text({ text: `全部记忆（点击设为中心）· ${pickable.length} 条`, style: "titleSmall", fontWeight: "bold", color: INK }),
        ...(pickable.length
            ? pickable.slice(0, 30).map(itemRow)
            : [ctx.UI.Text({ text: "暂无记忆。", style: "bodySmall", color: INK_FAINT })])
    ]);
}
function reviewText(ctx, due, busy, onDone, onDoneAll, allItems) {
    /* P11：按 nextReviewAt 升序取 5 条，用于「接下来到期」提示 */
    const upcoming = (allItems || []).slice()
        .filter((m) => typeof m.nextReviewAt === "number" && m.nextReviewAt > Date.now())
        .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
        .slice(0, 5);
    return ctx.UI.Column({ spacing: 8 }, [
        ctx.UI.Text({ text: `艾宾浩斯复习 · 到期 ${due.length} 条`, style: "titleMedium", fontWeight: "bold", color: INK }),
        ...(due.length
            ? [
                ctx.UI.Button({ text: "全部标记已复习", onClick: onDoneAll }),
                ...due.map((m) => ctx.UI.Column({ spacing: 2 }, [
                    ctx.UI.Text({ text: m.content, style: "bodySmall", color: INK, maxLines: 2 }),
                    ctx.UI.Text({ text: `已复习 ${m.reviewCount || 0} 次 · ${m.nextReviewText || ""}`, style: "labelSmall", color: INK_FAINT }),
                    ctx.UI.Button({ text: "标记已复习", onClick: () => onDone(m.id) })
                ]))
            ]
            : [ctx.UI.Text({ text: busy ? "加载中…" : "没有到期记忆，记忆都很新鲜。", style: "bodySmall", color: INK_FAINT })]),
        /* P11：到期 0 条时也给出可用信息——列出接下来要到期的条目 */
        ...(!due.length && !busy
            ? (upcoming.length
                ? [
                    divider(ctx),
                    ctx.UI.Text({ text: "接下来到期", style: "titleSmall", fontWeight: "bold", color: INK }),
                    ...upcoming.map((m) => ctx.UI.Text({
                        text: `${typeLabel(m.type)}：${String(m.content || "").slice(0, 26)} · ${m.nextReviewText || ""}`,
                        style: "bodySmall",
                        color: INK_SOFT,
                        maxLines: 2
                    }))
                ]
                : [])
            : [])
    ]);
}
function settingsText(ctx, s, setS, onSave) {
    const st = s || {};
    const [aiMsg, setAiMsg] = ctx.useState("dm_ai_msg", "");
    const toggleRow = (label, key) => ctx.UI.Row({ verticalAlignment: "center", spacing: 8 }, [
        ctx.UI.Text({ text: label, style: "bodyMedium", color: INK, weight: 1, maxLines: 2 }),
        ctx.UI.Switch({ checked: !!st[key], onCheckedChange: (v) => setS({ [key]: v }) })
    ]);
    const numberRow = (label, key) => ctx.UI.Row({ verticalAlignment: "center", spacing: 8 }, [
        ctx.UI.Text({ text: label, style: "bodyMedium", color: INK, weight: 1, maxLines: 1 }),
        ctx.UI.TextField({
            value: String(st[key] ?? ""),
            onValueChange: (v) => setS({ [key]: parseInt(v, 10) || 0 }),
            singleLine: true,
            supportingText: ctx.UI.Text({ text: "", style: "labelSmall", color: "#00000000" })
        })
    ]);
    return ctx.UI.Column({ spacing: 8 }, [
        ctx.UI.Text({ text: "记忆引擎设置", style: "titleMedium", fontWeight: "bold", color: INK }),
        toggleRow("自动注入上下文", "autoInject"),
        toggleRow("注入含到期复习项", "injectIncludeDue"),
        toggleRow("遗忘曲线复习", "reviewEnabled"),
        toggleRow("自动提取标签", "autoTag"),
        toggleRow("自动关联建议", "autoLink"),
        divider(ctx),
        toggleRow("对话自动记忆（记住/我叫/我喜欢/生日/截止）", "autoExtract"),
        toggleRow("★ AI 智能判定该不该记（推荐开）", "aiExtract"),
        toggleRow("AI 返回 JSON 时启用思考(更准但更慢)", "aiExtractThinking"),
        numberRow("AI 判定最短触发字数", "aiExtractMinLen"),
        numberRow("AI 每小时最多调用次数", "aiExtractMaxPerHour"),
        numberRow("AI 单条消息最多记几条", "aiExtractMaxItems"),
        toggleRow("快捷遗忘（忘了关于X的事）", "quickForget"),
        toggleRow("记忆冲突检测", "conflictCheck"),
        toggleRow("到期任务提醒", "dueRemind"),
        toggleRow("重要日期提醒（生日/纪念日）", "birthdayRemind"),
        toggleRow("自动备份", "autoBackup"),
        divider(ctx),
        ctx.UI.Text({ text: "省钱引擎", style: "titleSmall", fontWeight: "bold", color: INK }),
        toggleRow("注入压缩（条数/长度/标签精简）", "compactInject"),
        toggleRow("缓存友好注入（文本稳定复用，前缀缓存省钱）", "cacheFriendly"),
        toggleRow("冷热分级（热记忆全量+冷记忆标题）", "hotColdSplit"),
        divider(ctx),
        ctx.UI.Text({ text: "注入范围", style: "titleSmall", fontWeight: "bold", color: INK }),
        toggleRow("通用记忆（所有记忆全局可见）", "injectGeneral"),
        toggleRow("单独记忆（仅当前对话框可见）", "injectSpace"),
        toggleRow("自动提取存入单独记忆（默认存通用）", "autoExtractChat"),
        toggleRow("过期记忆自动清理", "autoCleanExpired"),
        numberRow("过期清理保留天数", "expiredCleanDays"),
        divider(ctx),
        numberRow("注入条数", "injectCount"),
        numberRow("首次复习间隔(天)", "reviewBaseDays"),
        numberRow("间隔增长倍数", "reviewGrowth"),
        numberRow("默认重要性 1-5", "defaultImportance"),
        numberRow("敏感记忆加密密钥(空=不加密)", "encryptKey"),
        ctx.UI.Button({ text: "保存设置", onClick: onSave }),
        ctx.UI.Row({ verticalAlignment: "center", spacing: 8 }, [
            ctx.UI.Button({
                text: "AI 自检",
                onClick: async () => {
                    setAiMsg("自检中…");
                    try {
                        const d = (await dmIpc("memory.ai_probe")) || {};
                        const lines = [];
                        lines.push(d.ok ? ("✅ 模型连通正常（" + (d.functionType || "?") + "）") : "❌ 调用失败");
                        if (d.error) lines.push("错误：" + String(d.error).slice(0, 160));
                        if (d.ok && d.parseOk === false) lines.push("⚠️ 返回不是合法 JSON（可关掉思考重试）");
                        if (d.parsed && d.parsed.items) lines.push("解析 " + d.parsed.items.length + " 条");
                        if (d.parsed && d.parsed.items && d.parsed.items[0]) lines.push("示例：" + String(d.parsed.items[0].content || "").slice(0, 60));
                        if (d.raw) lines.push("原文：" + String(d.raw).slice(0, 200));
                        setAiMsg(lines.join("\n"));
                    } catch (e) {
                        setAiMsg("自检异常：" + String((e && e.message) || e));
                    }
                }
            }),,
            ctx.UI.Button({
                text: "查看AI日志",
                onClick: async () => {
                    setAiMsg("读取中…");
                    try {
                        const d = (await dmIpc("memory.ai_log")) || {};
                        const tail = String(d.logTail || "").split("\n").filter(Boolean).slice(-6).join("\n");
                        const rt = (d.log || []).slice(-4).join("\n");
                        setAiMsg([tail, rt].filter(Boolean).join("\n") || "暂无日志：还没有触发过（或 autoExtract 关闭）");
                    } catch (e) {
                        setAiMsg("读取失败：" + String((e && e.message) || e));
                    }
                }
            })
        ]),
        aiMsg ? ctx.UI.Text({ text: aiMsg, style: "labelSmall", color: INK_SOFT }) : ctx.UI.Text({ text: "", style: "labelSmall", color: "#00000000" }),
        ctx.UI.Text({
            text: "提示：AI 可通过 dm_remember / dm_recall / dm_link / dm_review / dm_report 等工具自主管理记忆。空间：写入时可用 space 参数指定（工作/生活/学习）。",
            style: "labelSmall",
            color: INK_FAINT
        })
    ]);
}
/* ---------------- 主屏 ---------------- */
const TABS = ["总览", "搜索", "时间线", "图谱", "复习", "设置"];
/* P10：模块级「已启动」标记，保证刷新只真正跑一次 */
let __dmBooted = false;
let __dmBootToken = 0;
function screen(ctx) {
    const [tab, setTab] = ctx.useState("dm_tab", "总览");
    const [stats, setStats] = ctx.useState("dm_stats", null);
    const [allItems, setAllItems] = ctx.useState("dm_all_items", []);
    const [q, setQ] = ctx.useState("dm_q", "");
    const [searchResult, setSearchResult] = ctx.useState("dm_search_result", null);
    const [due, setDue] = ctx.useState("dm_due", []);
    const [settings, setSettings] = ctx.useState("dm_settings", null);
    const [center, setCenter] = ctx.useState("dm_center", null);
    const [suggestions, setSuggestions] = ctx.useState("dm_suggestions", []);
    const [busy, setBusy] = ctx.useState("dm_busy", false);
    const [loaded, setLoaded] = ctx.useState("dm_loaded", false);
    const [loadErr, setLoadErr] = ctx.useState("dm_load_err", "");
    function unwrapResult(r) {
        if (r && r.data !== undefined && r.data !== null)
            return r.data;
        if (r && r.items !== undefined)
            return r;
        return r;
    }
    /* ===== P9：UI 在独立 JS engine，IPC 必须显式指定 targetRuntime:"main" ===== */
    function __dmIpcNotReady(e) {
        const m = String((e && e.message) ? e.message : e);
        return /not registered|未注册|no handler|not found/i.test(m);
    }
    async function __dmSleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }
    let __dmLastErr = "";
    async function callIpc(channel, payload) {
        /* ① 同上下文直连桥（若 UI 与 main 共享 globalThis 时可直接命中） */
        try {
            const br = (typeof globalThis !== "undefined") ? globalThis.__DM_BRIDGE__ : null;
            if (br && typeof br[channel] === "function") {
                const rb = await br[channel](payload);
                if (rb !== undefined && rb !== null)
                    return unwrapResult(rb);
            }
        }
        catch (e) { /* 落到 IPC */ }
        /* ② 官方 IPC 桥：必须带 targetRuntime:"main"，否则消息到不了 main 上下文 */
        let lastErr = null;
        for (let i = 0; i < 6; i++) {
            try {
                const r = await ToolPkg.ipc.call(channel, payload, { targetRuntime: "main" });
                return unwrapResult(r);
            }
            catch (e1) {
                lastErr = e1;
                /* 首次渲染可能早于 main 侧 ipc.on 注册完成 → 短退避重试 */
                if (!__dmIpcNotReady(e1)) break;
                await __dmSleep(150 * (i + 1));
            }
        }
        /* ③ 极老宿主不支持第三参数时，退回两参数调用 */
        try {
            const r2 = await ToolPkg.ipc.call(channel, payload);
            return unwrapResult(r2);
        }
        catch (e2) {
            __dmLastErr = channel + " | " + String((lastErr && lastErr.message) ? lastErr.message : (lastErr || "")) +
                " | " + String((e2 && e2.message) ? e2.message : e2);
            return null;
        }
    }
    async function refreshAll() {
        setBusy(true);
        let ok = 0;
        try {
            const s = await callIpc("memory.stats");
            if (s) { setStats(s); ok++; }
            const all = await callIpc("memory.get_all", { limit: 200 });
            if (all && Array.isArray(all.items)) { setAllItems(all.items); ok++; }
            const r = await callIpc("memory.review", { limit: 30 });
            if (r && Array.isArray(r.items)) { setDue(r.items); ok++; }
            const st = await callIpc("memory.settings.get");
            if (st) { setSettings(st); ok++; }
        }
        catch (e) {
            __dmLastErr = "refreshAll: " + String((e && e.message) ? e.message : e);
        }
        /* 全部通道都失败时，把最近一次错误暴露到面板上，避免「静默 0 条」 */
        setLoadErr(ok === 0 ? (__dmLastErr || "IPC 无响应") : "");
        setBusy(false);
        return ok;
    }
    async function doSearch() {
        setBusy(true);
        const r = await callIpc("memory.recall", { query: q, limit: 50, sortBy: "relevance" });
        if (r)
            setSearchResult(r);
        setBusy(false);
    }
    async function reviewDone(id) {
        await callIpc("memory.review_done", { id });
        await refreshAll();
        ctx.showToast("已标记复习完成");
    }
    async function reviewDoneAll() {
        for (const m of due) {
            await callIpc("memory.review_done", { id: m.id });
        }
        await refreshAll();
        ctx.showToast("全部标记完成");
    }
    async function saveSettings() {
        await callIpc("memory.settings.set", settings || {});
        await refreshAll();
        ctx.showToast("设置已保存");
    }
    async function pickCenter(m) {
        setCenter(m);
        const sug = await callIpc("memory.suggest_links", { id: m.id });
        if (sug && Array.isArray(sug))
            setSuggestions(sug);
    }
    const linkedItems = center
        ? (allItems || []).filter((m) => (center.links || []).includes(m.id))
        : [];
    function contentNode() {
        switch (tab) {
            case "搜索":
                return searchText(ctx, q, setQ, searchResult, busy, doSearch);
            case "时间线":
                return timelineText(ctx, allItems || [], busy);
            case "图谱":
                return graphText(ctx, center, linkedItems, suggestions, allItems || [], pickCenter);
            case "复习":
                return reviewText(ctx, due, busy, reviewDone, reviewDoneAll, allItems || []);
            case "设置":
                return settingsText(ctx, settings, (patch) => setSettings({ ...(settings || {}), ...patch }), saveSettings);
            case "总览":
            default:
                return dashboardText(ctx, stats);
        }
    }
    /* ===== P10：宿主只派发根节点上的 onLoad，必须挂在根 Box 上 ===== */
    async function __dmOnLoad() {
        if (typeof __dmBooted !== "undefined" && __dmBooted)
            return;
        try {
            __dmBooted = true;
        }
        catch (e) { /* ignore */ }
        const n = await refreshAll();
        if (n > 0)
            setLoaded(true);
    }
    return ctx.UI.Box({
        fillMaxSize: true,
        backgroundBrush: { type: "verticalGradient", colors: ["#FFFFFF", "#FFFFFF"] },
        onLoad: __dmOnLoad,
        content: [
            ctx.UI.Column({ fillMaxSize: true }, [
                /* 头部：纯文字 */
                ctx.UI.Box({
                    fillMaxWidth: true,
                    padding: { horizontal: 16, vertical: 10 },
                    content: [
                        ctx.UI.Row({ verticalAlignment: "center", spacing: 8 }, [
                            ctx.UI.Text({ text: "深度记忆", style: "titleMedium", fontWeight: "bold", color: INK }),
                            ctx.UI.Spacer({ weight: 1 }),
                            ctx.UI.Text({ text: `共 ${(stats && stats.total) || 0} 条`, style: "labelSmall", color: INK_SOFT })
                        ]),
                        loadErr
                            ? ctx.UI.Text({ text: `加载失败：${loadErr}`, style: "labelSmall", color: "#C0392B" })
                            : ctx.UI.Text({ text: " ", style: "labelSmall", color: INK_SOFT })
                    ]
                }),
                divider(ctx),
                /* 内容区：纯文字 */
                ctx.UI.LazyColumn({
                    weight: 1,
                    fillMaxWidth: true,
                    padding: { horizontal: 16, vertical: 10 },
                    spacing: 10,
                    /* P10：宿主不读 LazyColumn 的 onLoad（renderLazyColumnNode 只处理
                       spacing/reverseLayout/autoScrollToEnd），加载已上移到根 Box 的 onLoad */
                    content: [contentNode()]
                }),
                /* 底部导航：纯文字 */
                ctx.UI.Box({
                    fillMaxWidth: true,
                    padding: { horizontal: 8, vertical: 6 },
                    backgroundBrush: { type: "verticalGradient", colors: ["#FFFFFF", "#FFFFFF"] },
                    content: [
                        ctx.UI.Row({ spacing: 2 }, TABS.map((t) => ctx.UI.Button({
                            text: t,
                            weight: 1,
                            onClick: () => setTab(t),
                            contentPadding: { horizontal: 2, vertical: 6 }
                        })))
                    ]
                })
            ])
        ]
    });
}
exports.default = screen;