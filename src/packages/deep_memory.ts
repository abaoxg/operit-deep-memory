/* METADATA
{
    "name": "deep_memory",
    "display_name": {
        "zh": "深度记忆",
        "en": "Deep Memory"
    },
    "description": {
        "zh": "六边形长期记忆插件：AI 可以像人一样长期记住事实/偏好/事件/关系/想法/任务，并随时检索、关联、复习、统计与管理。记忆持久化保存在本地，跨对话不丢失。",
        "en": "Hexagon long-term memory: AI can durably remember facts/preferences/events/relations/ideas/tasks, and recall, link, review, analyze and manage them across conversations."
    },
    "category": "Productivity",
    "tools": [
        {
            "name": "dm_remember",
            "description": {
                "zh": "写入一条长期记忆。适合记录用户的关键信息（事实/偏好/事件/关系/想法/任务）。自动提取标签、自动去重合并相似内容，并返回可能相关的记忆。记忆会持久保存，跨对话生效。",
                "en": "Write a long-term memory. Good for recording key user info (fact/preference/event/relation/idea/task). Auto-extracts tags, merges similar content, and returns related memories. Persists across conversations."
            },
            "parameters": [
                {
                    "name": "content",
                    "description": {
                        "zh": "记忆内容（一句话，清晰完整，建议包含具体细节）",
                        "en": "Memory content (one clear sentence with concrete details)"
                    },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "type",
                    "description": {
                        "zh": "记忆类型：fact事实 / preference偏好 / event事件 / relation关系 / idea想法 / task任务，默认 fact",
                        "en": "Memory type: fact/preference/event/relation/idea/task, default fact"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "tags",
                    "description": {
                        "zh": "自定义标签数组（与自动提取的标签合并）",
                        "en": "Custom tag array (merged with auto-extracted tags)"
                    },
                    "type": "array",
                    "required": false
                },
                {
                    "name": "importance",
                    "description": {
                        "zh": "重要性 1~5（默认 3，5=极其重要，影响注入系统提示词的优先级）",
                        "en": "Importance 1-5 (default 3; 5 = critical, affects auto-injection priority)"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "linkIds",
                    "description": {
                        "zh": "关联的记忆 ID 数组（建立双向关联）",
                        "en": "Memory IDs to link with (bidirectional)"
                    },
                    "type": "array",
                    "required": false
                },
                {
                    "name": "expiryDays",
                    "description": {
                        "zh": "可选：N 天后过期（临时记忆用，如一次性任务），不填则永久保留",
                        "en": "Optional: expire after N days (for temporary memories), omit for permanent"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "pinned",
                    "description": {
                        "zh": "是否置顶（常驻提示，默认 false）",
                        "en": "Pin this memory (always prioritized, default false)"
                    },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "space",
                    "description": {
                        "zh": "记忆空间（general/工作/生活/学习 等），默认当前激活空间",
                        "en": "Memory space (general/work/life/study etc), default active space"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "sensitive",
                    "description": {
                        "zh": "true=敏感内容，启用加密存储（需在设置中配置加密密钥）",
                        "en": "true = sensitive content, encrypted at rest (requires encryption key in settings)"
                    },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "chatId",
                    "description": {
                        "zh": "单独记忆：传入对话框 ID 则该记忆仅该对话框可见；不传=通用记忆（所有对话共享）",
                        "en": "Chat-scoped memory: pass a chat ID to make it visible only in that chat; omit for global memory"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "imagePath",
                    "description": {
                        "zh": "图片记忆：本地图片文件路径（jpg/png/webp/gif/bmp/heic/avif），会自动复制进记忆库并与本条记忆关联；content 可留空或写描述",
                        "en": "Image memory: local image path (jpg/png/webp/gif/bmp/heic/avif); auto-copied into the library and linked to this memory; content optional or a caption"
                    },
                    "type": "string",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_recall",
            "description": {
                "zh": "检索长期记忆。支持关键词、类型、标签、时间范围过滤，按相关度/时间/重要性/活跃度排序。适合在对话中回忆用户之前说过的重要信息。",
                "en": "Recall long-term memories. Filter by keyword/type/tags/time range, sort by relevance/time/importance/access. Use it to remember what the user said before."
            },
            "parameters": [
                {
                    "name": "query",
                    "description": {
                        "zh": "关键词（支持中文分词匹配与标签匹配），不填则按排序返回",
                        "en": "Keyword (Chinese token matching + tag matching); empty = return by sort"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "type",
                    "description": {
                        "zh": "记忆类型过滤：fact/preference/event/relation/idea/task",
                        "en": "Type filter: fact/preference/event/relation/idea/task"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "tags",
                    "description": {
                        "zh": "标签过滤数组（需全部命中）",
                        "en": "Tag filter array (all must match)"
                    },
                    "type": "array",
                    "required": false
                },
                {
                    "name": "dateFrom",
                    "description": {
                        "zh": "开始时间戳（毫秒），过滤更新时间",
                        "en": "Start timestamp (ms) to filter updatedAt"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "dateTo",
                    "description": {
                        "zh": "结束时间戳（毫秒），过滤更新时间",
                        "en": "End timestamp (ms) to filter updatedAt"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "limit",
                    "description": {
                        "zh": "返回条数，默认 10，最大 100",
                        "en": "Result count, default 10, max 100"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "sortBy",
                    "description": {
                        "zh": "排序：relevance相关度(默认) / time最新 / importance重要性 / access活跃度 / health健康度",
                        "en": "Sort: relevance(default)/time/importance/access/health"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "space",
                    "description": {
                        "zh": "记忆空间过滤，默认当前激活空间",
                        "en": "Space filter, default active space"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "allSpaces",
                    "description": {
                        "zh": "true=忽略空间过滤，检索全部空间",
                        "en": "true = search across all spaces"
                    },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "chatId",
                    "description": {
                        "zh": "对话框 ID：传=通用记忆+该对话框单独记忆；不传=仅通用记忆",
                        "en": "Chat ID: pass = global + that chat's scoped memories; omit = global only"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "allChats",
                    "description": {
                        "zh": "true=包含全部对话框的单独记忆",
                        "en": "true = include scoped memories from all chats"
                    },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_forget",
            "description": {
                "zh": "删除记忆。支持按 ID 删除、按关键词批量删除、按类型清空或全部清空。删除不可恢复，请谨慎。",
                "en": "Delete memories by ID, keyword, type, or clear all. Irreversible - be careful."
            },
            "parameters": [
                {
                    "name": "id",
                    "description": {
                        "zh": "要删除的记忆 ID",
                        "en": "Memory ID to delete"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "keyword",
                    "description": {
                        "zh": "包含该关键词的记忆将被删除（与 id 二选一）",
                        "en": "Memories containing this keyword will be deleted (alternative to id)"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "type",
                    "description": {
                        "zh": "删除某类型全部记忆（如 task）",
                        "en": "Delete all memories of a type (e.g. task)"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "clearAll",
                    "description": {
                        "zh": "true=清空全部记忆（危险操作）",
                        "en": "true = wipe all memories (dangerous)"
                    },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "space",
                    "description": {
                        "zh": "限定只在某个记忆空间内删除（如 工作）。不传=跨全部空间删除，请务必确认",
                        "en": "Restrict deletion to one memory space. Omit = across all spaces"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "dryRun",
                    "description": {
                        "zh": "true=只预演，返回将被删除的条目但不动数据。建议批量删除前先用它确认",
                        "en": "true = dry run: report what would be deleted without changing data"
                    },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_update",
            "description": {
                "zh": "更新已有记忆：修改内容、重要性、标签、置顶状态或延长过期时间。按 id 定位。",
                "en": "Update an existing memory by id: content, importance, tags, pinned, or extend expiry."
            },
            "parameters": [
                {
                    "name": "id",
                    "description": {
                        "zh": "目标记忆 ID",
                        "en": "Target memory ID"
                    },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "content",
                    "description": {
                        "zh": "新的记忆内容（不传则保留原内容）",
                        "en": "New content (keep original if omitted)"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "importance",
                    "description": {
                        "zh": "新的重要性 1~5",
                        "en": "New importance 1-5"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "tags",
                    "description": {
                        "zh": "新的标签数组（覆盖原标签）",
                        "en": "New tags (replace original)"
                    },
                    "type": "array",
                    "required": false
                },
                {
                    "name": "pinned",
                    "description": {
                        "zh": "置顶状态",
                        "en": "Pinned state"
                    },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "expiryDays",
                    "description": {
                        "zh": "从当前时间起 N 天后过期（传 0 可移除过期时间）",
                        "en": "Expire N days from now (0 removes expiry)"
                    },
                    "type": "number",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_link",
            "description": {
                "zh": "在两记忆之间建立双向关联（记忆图谱边）。",
                "en": "Create a bidirectional link between two memories (graph edge)."
            },
            "parameters": [
                {
                    "name": "fromId",
                    "description": {
                        "zh": "起点记忆 ID",
                        "en": "Source memory ID"
                    },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "toId",
                    "description": {
                        "zh": "终点记忆 ID",
                        "en": "Target memory ID"
                    },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "dm_unlink",
            "description": {
                "zh": "解除两记忆之间的双向关联。",
                "en": "Remove the bidirectional link between two memories."
            },
            "parameters": [
                {
                    "name": "fromId",
                    "description": {
                        "zh": "起点记忆 ID",
                        "en": "Source memory ID"
                    },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "toId",
                    "description": {
                        "zh": "终点记忆 ID",
                        "en": "Target memory ID"
                    },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "dm_review",
            "description": {
                "zh": "艾宾浩斯遗忘曲线复习：返回到期需要复习的记忆（防止遗忘），可对复习完成的记忆调用 complete 参数标记。",
                "en": "Ebbinghaus review: return memories due for review to prevent forgetting; mark done with complete."
            },
            "parameters": [
                {
                    "name": "limit",
                    "description": {
                        "zh": "返回条数，默认 10，最大 50",
                        "en": "Count, default 10, max 50"
                    },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "complete",
                    "description": {
                        "zh": "true=把本次返回的全部到期记忆标记为已复习（可选）",
                        "en": "true = mark all returned due memories as reviewed (optional)"
                    },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_stats",
            "description": {
                "zh": "记忆统计洞察：总量、今日/本周新增、类型分布、标签云、复习待办、平均健康度、最活跃/最重要记忆等。",
                "en": "Memory insights: totals, today/week additions, type distribution, tag cloud, review due, avg health, top active/important."
            },
            "parameters": []
        },
        {
            "name": "dm_options",
            "description": {
                "zh": "查看记忆系统的元信息：可用类型、标签列表、当前设置、统计摘要。",
                "en": "View memory system meta: types, tag list, current settings, stats summary."
            },
            "parameters": []
        },
        {
            "name": "dm_export",
            "description": {
                "zh": "导出全部记忆为 JSON 字符串（用于备份/迁移）。",
                "en": "Export all memories as a JSON string (backup/migration)."
            },
            "parameters": []
        },
        {
            "name": "dm_import",
            "description": {
                "zh": "从 JSON 字符串导入记忆（merge 合并去重 / replace 完全替换）。",
                "en": "Import memories from JSON string (merge dedupes / replace overwrites)."
            },
            "parameters": [
                {
                    "name": "json",
                    "description": {
                        "zh": "dm_export 导出的 JSON 内容",
                        "en": "JSON content exported by dm_export"
                    },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "mode",
                    "description": {
                        "zh": "merge=合并（默认）/ replace=替换全部",
                        "en": "merge (default) / replace"
                    },
                    "type": "string",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_report",
            "description": {
                "zh": "生成记忆报告（Markdown）：概览、类型分布、热门标签、记忆列表。可按空间/最近N天筛选。",
                "en": "Generate a Markdown memory report: overview, type distribution, top tags, memory list. Filter by space/last N days."
            },
            "parameters": [
                {
                    "name": "space",
                    "description": {
                        "zh": "按空间筛选报告，不传=全部空间",
                        "en": "Filter report by space; omit for all"
                    },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "days",
                    "description": {
                        "zh": "只看最近 N 天的记忆",
                        "en": "Only memories from the last N days"
                    },
                    "type": "number",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_extract",
            "description": {
                "zh": "解析一段文本，检测其中是否包含值得记忆的内容（记住/我叫/我喜欢/生日/地址/任务截止等句式），返回建议的类型/重要性/敏感标记。供确认后写入。",
                "en": "Parse a text and detect memorable content (remember/name/birthday/address/task deadline patterns), returning suggested type/importance/sensitive flag."
            },
            "parameters": [
                {
                    "name": "text",
                    "description": {
                        "zh": "要解析的文本（如用户刚说的话）",
                        "en": "Text to parse (e.g. what the user just said)"
                    },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "dm_conflicts",
            "description": {
                "zh": "查看或清空记忆冲突提醒（同主题关键信息不一致时自动记录，供确认）。",
                "en": "View or clear memory conflict alerts (recorded automatically when key info on the same topic conflicts)."
            },
            "parameters": [
                {
                    "name": "clear",
                    "description": {
                        "zh": "true=清空全部冲突提醒",
                        "en": "true = clear all conflict alerts"
                    },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "dm_export_bundle",
            "description": {
                "zh": "导出完整记忆包（ZIP：memories.json + images/ 全部图片），用于备份/迁移/存档。输出到 Download/Operit/export/。",
                "en": "Export a full memory bundle (ZIP: memories.json + all images) for backup/migration/archive. Output to Download/Operit/export/."
            },
            "parameters": []
        },
        {
            "name": "dm_import_bundle",
            "description": {
                "zh": "从记忆包（dm_export_bundle 生成的 .toolpkg）导入：恢复记忆 JSON + 图片（合并模式，按 id 去重）。",
                "en": "Import from a memory bundle (.toolpkg from dm_export_bundle): restores memory JSON + images (merge mode, dedupe by id)."
            },
            "parameters": [
                {
                    "name": "path",
                    "description": {
                        "zh": "记忆包文件路径（.toolpkg）",
                        "en": "Bundle file path (.toolpkg)"
                    },
                    "type": "string",
                    "required": true
                }
            ]
        }
    ]
}
*/

import {
  MEMORY_TYPES,
  PLUGIN_ID,
  TYPE_MAP,
  buildInjection,
  buildReport,
  buildStats,
  clampImportance,
  completeReview,
  conflictDetect,
  detectImageExt,
  exportBundle,
  exportJson,
  extractMemoryIntent,
  extractTags,
  findById,
  findRelated,
  formatTime,
  healthScore,
  importBundle,
  importJson,
  loadSettings,
  loadStore,
  normalizeType,
  recall,
  remember,
  reviewQueue,
  saveSettings,
  saveStore,
  type BundleExportResult,
  type BundleImportResult,
  type ConflictInfo,
  type MemoryItem,
  type MemorySettings,
  type MemoryStats,
  type MemoryStore
} from "../memory-core";

export interface ToolResult {
  success: boolean;
  message: string;
  data: unknown;
}

function wrapResult(ok: boolean, message: string, data: unknown): ToolResult {
  return { success: ok, message, data };
}

function publicItem(m: MemoryItem): Record<string, unknown> {
  const t = TYPE_MAP[m.type] || TYPE_MAP["fact"];
  return {
    id: m.id,
    type: m.type,
    typeLabel: t.labelZh,
    emoji: t.emoji,
    content: m.content,
    tags: m.tags,
    importance: m.importance,
    source: m.source,
    pinned: !!m.pinned,
    createdAt: m.createdAt,
    createdAtText: formatTime(m.createdAt),
    updatedAt: m.updatedAt,
    updatedAtText: formatTime(m.updatedAt),
    accessCount: m.accessCount,
    reviewCount: m.reviewCount,
    nextReviewAt: m.nextReviewAt,
    nextReviewText: m.nextReviewAt ? formatTime(m.nextReviewAt) : "",
    health: healthScore(m),
    links: m.links,
    space: m.space,
    chatId: m.chatId || "",
    imagePath: m.imagePath ? `/sdcard/Download/Operit/plugins/${PLUGIN_ID}/${m.imagePath}` : "",
    expiryAt: m.expiryAt || null
  };
}

/* ---------------- dm_remember ---------------- */

export async function dm_remember(params?: {
  content?: string;
  type?: string;
  tags?: string[];
  importance?: number;
  linkIds?: string[];
  expiryDays?: number;
  pinned?: boolean;
  space?: string;
  sensitive?: boolean;
  chatId?: string;  // 单独记忆：仅该对话框可见；空=通用记忆
  imagePath?: string; // 图片记忆：本地图片路径（复制进记忆库）
}): Promise<ToolResult> {
  const p = params || {};
  const content = String(p.content || "").trim();
  if (!content && !p.imagePath) {
    return wrapResult(false, "缺少 content 或 imagePath 参数：请告诉我记住什么内容（或附上一张图片）。", null);
  }
  if (p.imagePath && !detectImageExt(p.imagePath)) {
    return wrapResult(false, "imagePath 不是支持的图片格式（jpg/png/webp/gif/bmp/heic/avif）。", null);
  }
  const store = await loadStore();
  const settings = await loadSettings();
  const expiryAt = typeof p.expiryDays === "number" && p.expiryDays > 0
    ? Date.now() + Math.round(p.expiryDays * 86400000)
    : undefined;
  const result = await remember(store, {
    content: content || "（图片记忆）",
    type: p.type,
    tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t)) : undefined,
    importance: p.importance,
    source: "ai",
    linkIds: Array.isArray(p.linkIds) ? p.linkIds.map((t) => String(t)) : undefined,
    expiryAt,
    pinned: p.pinned,
    space: p.space,
    sensitive: p.sensitive,
    chatId: p.chatId,
    imagePath: p.imagePath
  }, settings);
  // 记录冲突到 store（供注入提醒）
  if (result.conflicts && result.conflicts.length) {
    store.conflicts = (store.conflicts || []).concat(result.conflicts).slice(-10);
  }
  await saveStore(store);

  const item = result.item;
  const typeInfo = TYPE_MAP[item.type] || TYPE_MAP["fact"];
  const head = result.merged ? "已合并更新已有记忆" : "已写入长期记忆";
  const spaceText = item.space && item.space !== "general" ? `（空间：${item.space}）` : "";
  const sensText = item.sensitive ? "，已加密存储 🔒" : "";
  const relatedText = result.related.length
    ? "；相关记忆建议：" + result.related.slice(0, 3).map((r) => `${r.id}(${r.content.slice(0, 20)})`).join("、")
    : "";
  const conflictText = result.conflicts && result.conflicts.length
    ? `；⚠️ 冲突提醒：${result.conflicts.map((c) => `新信息「${c.newContent.slice(0, 30)}」与旧记忆「${c.existingContent.slice(0, 30)}」的${c.field}不一致`).join("；")}`
    : "";
  return wrapResult(
    true,
    `${head}：${typeInfo.emoji} ${typeInfo.labelZh}「${item.content.slice(0, 60)}」（ID=${item.id}，重要性 ${item.importance}/5${item.pinned ? "，已置顶" : ""}${spaceText}${sensText}）${relatedText}${conflictText}`,
    publicItem(item)
  );
}

/* ---------------- dm_recall ---------------- */

export async function dm_recall(params?: {
  query?: string;
  type?: string;
  tags?: string[];
  dateFrom?: number;
  dateTo?: number;
  limit?: number;
  sortBy?: string;
  space?: string;
  allSpaces?: boolean;
  chatId?: string;
  allChats?: boolean;
}): Promise<ToolResult> {
  const p = params || {};
  const store = await loadStore();
  const settings = await loadSettings();
  const r = await recall(store, {
    query: p.query,
    type: p.type,
    tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t)) : undefined,
    dateFrom: typeof p.dateFrom === "number" ? p.dateFrom : undefined,
    dateTo: typeof p.dateTo === "number" ? p.dateTo : undefined,
    limit: typeof p.limit === "number" ? p.limit : 10,
    sortBy: p.sortBy,
    space: p.space,
    allSpaces: p.allSpaces === true,
    chatId: p.chatId,
    allChats: p.allChats === true
  }, settings);
  if (r.touched) await saveStore(store);

  const list = r.items.map(publicItem);
  if (!r.total) {
    return wrapResult(true, "没有找到匹配的记忆。可以先用 dm_remember 记录重要信息。", { total: 0, items: [] });
  }
  const spaceText = p.allSpaces ? "（全部空间）" : p.space ? `（空间：${p.space}）` : "";
  const summary = list.map((it: any) => `${it.emoji}[${it.id}] ${it.content.slice(0, 50)}${it.tags.length ? " #" + it.tags.slice(0, 3).join("#") : ""}`).join("\n");
  return wrapResult(
    true,
    `找到 ${r.total} 条记忆${spaceText}（显示前 ${list.length} 条）：\n${summary}`,
    { total: r.total, items: list }
  );
}

/* ---------------- dm_forget ---------------- */

export async function dm_forget(params?: { id?: string; keyword?: string; type?: string; clearAll?: boolean; clearExpired?: boolean; space?: string; dryRun?: boolean }): Promise<ToolResult> {
  const p = params || {};
  const store = await loadStore();
  let removed = 0;
  let detail = "";

  if (p.clearExpired === true) {
    const now = Date.now();
    removed = store.items.filter((m) => typeof m.expiryAt === "number" && m.expiryAt < now).length;
    store.items = store.items.filter((m) => !(typeof m.expiryAt === "number" && m.expiryAt < now));
    store.items.forEach((m) => {
      m.links = m.links.filter((l) => !store.items.some((k) => k.id === l));
    });
    detail = removed ? `已清理 ${removed} 条过期记忆` : "没有过期记忆";
  } else if (p.clearAll === true) {
    removed = store.items.length;
    store.items = [];
    detail = "全部记忆已清空";
  } else if (p.id) {
    const before = store.items.length;
    store.items = store.items.filter((m) => m.id !== p.id);
    removed = before - store.items.length;
    // 清理关联引用
    store.items.forEach((m) => {
      m.links = m.links.filter((l) => l !== p.id);
    });
    detail = removed ? `已删除记忆 ${p.id}` : `未找到记忆 ${p.id}`;
  } else if (p.keyword) {
    const kw = String(p.keyword).toLowerCase();
    const keep = store.items.filter((m) => (p.space && m.space !== p.space) || (!m.content.toLowerCase().includes(kw) && !m.tags.some((t) => t.includes(kw))));
    removed = store.items.length - keep.length;
    store.items = keep;
    store.items.forEach((m) => {
      m.links = m.links.filter((l) => !keep.some((k) => k.id === l));
    });
    detail = removed ? `已删除包含「${p.keyword}」的 ${removed} 条记忆` : `没有包含「${p.keyword}」的记忆`;
  } else if (p.type) {
    const t = normalizeType(p.type);
    const keep = store.items.filter((m) => (p.space && m.space !== p.space) || m.type !== t);
    removed = store.items.length - keep.length;
    store.items = keep;
    detail = removed ? `已删除 ${TYPE_MAP[t].labelZh} 类型记忆 ${removed} 条` : `没有 ${TYPE_MAP[t].labelZh} 类型记忆`;
  } else {
    return wrapResult(false, "请提供 id / keyword / type / clearAll 之一。", null);
  }

  if ((p as any).dryRun === true) {
    return wrapResult(true, `【预演】${detail}，尚未真正删除（确认后去掉 dryRun 再执行）`, { removed, total: store.items.length, dryRun: true });
  }
  await saveStore(store);
  return wrapResult(true, detail + `（剩余 ${store.items.length} 条）`, { removed, total: store.items.length });
}

/* ---------------- dm_update ---------------- */

export async function dm_update(params?: {
  id?: string;
  content?: string;
  importance?: number;
  tags?: string[];
  pinned?: boolean;
  expiryDays?: number;
}): Promise<ToolResult> {
  const p = params || {};
  const id = String(p.id || "").trim();
  if (!id) return wrapResult(false, "缺少 id 参数。", null);
  const store = await loadStore();
  const settings = await loadSettings();
  const item = findById(store, id);
  if (!item) return wrapResult(false, `未找到记忆 ${id}`, null);

  const changed: string[] = [];
  if (typeof p.content === "string" && p.content.trim()) {
    item.content = p.content.trim();
    if (settings.autoTag !== false) item.tags = extractTags(item.content, item.tags);
    changed.push("内容");
  }
  if (typeof p.importance === "number") {
    item.importance = clampImportance(p.importance);
    changed.push("重要性");
  }
  if (Array.isArray(p.tags)) {
    item.tags = p.tags.map((t) => String(t).toLowerCase()).slice(0, 30);
    changed.push("标签");
  }
  if (typeof p.pinned === "boolean") {
    item.pinned = p.pinned;
    changed.push("置顶");
  }
  if (typeof p.expiryDays === "number") {
    if (p.expiryDays <= 0) {
      delete item.expiryAt;
      changed.push("移除过期");
    } else {
      item.expiryAt = Date.now() + Math.round(p.expiryDays * 86400000);
      changed.push("过期时间");
    }
  }
  item.updatedAt = Date.now();
  await saveStore(store);
  return wrapResult(true, `已更新记忆 ${id}（${changed.join("、") || "无字段变更"}）`, publicItem(item));
}

/* ---------------- dm_link / dm_unlink ---------------- */

export async function dm_link(params?: { fromId?: string; toId?: string }): Promise<ToolResult> {
  const p = params || {};
  const a = String(p.fromId || "").trim();
  const b = String(p.toId || "").trim();
  if (!a || !b) return wrapResult(false, "需要 fromId 和 toId。", null);
  if (a === b) return wrapResult(false, "不能与自己关联。", null);
  const store = await loadStore();
  const ia = findById(store, a);
  const ib = findById(store, b);
  if (!ia || !ib) return wrapResult(false, "关联失败：其中一个记忆不存在。", null);
  if (!ia.links.includes(b)) ia.links.push(b);
  if (!ib.links.includes(a)) ib.links.push(a);
  await saveStore(store);
  return wrapResult(true, `已建立关联：${a} ↔ ${b}`, { from: publicItem(ia), to: publicItem(ib) });
}

export async function dm_unlink(params?: { fromId?: string; toId?: string }): Promise<ToolResult> {
  const p = params || {};
  const a = String(p.fromId || "").trim();
  const b = String(p.toId || "").trim();
  if (!a || !b) return wrapResult(false, "需要 fromId 和 toId。", null);
  const store = await loadStore();
  const ia = findById(store, a);
  const ib = findById(store, b);
  if (!ia || !ib) return wrapResult(false, "解除关联失败：其中一个记忆不存在。", null);
  ia.links = ia.links.filter((l) => l !== b);
  ib.links = ib.links.filter((l) => l !== a);
  await saveStore(store);
  return wrapResult(true, `已解除关联：${a} ↮ ${b}`, null);
}

/* ---------------- dm_review ---------------- */

export async function dm_review(params?: { limit?: number; complete?: boolean }): Promise<ToolResult> {
  const p = params || {};
  const store = await loadStore();
  const settings = await loadSettings();
  const queue = reviewQueue(store, settings, typeof p.limit === "number" ? p.limit : 10);
  if (p.complete === true) {
    queue.forEach((m) => completeReview(m, settings));
    await saveStore(store);
  }
  if (!queue.length) {
    return wrapResult(true, "太棒了！当前没有到期需要复习的记忆，记忆都很新鲜 ✨", { due: 0, items: [] });
  }
  const list = queue.map(publicItem);
  const lines = list.map((it: any) => `- ${it.emoji} ${it.content.slice(0, 60)}（距上次复习 ${it.reviewCount} 次，健康度 ${it.health}）`).join("\n");
  return wrapResult(
    true,
    `有 ${queue.length} 条记忆到期需要复习（遗忘曲线）：\n${lines}\n复习完成后可调用 dm_review(complete=true) 标记。`,
    { due: queue.length, items: list }
  );
}

/* ---------------- dm_stats ---------------- */

export async function dm_stats(): Promise<ToolResult> {
  const store = await loadStore();
  const settings = await loadSettings();
  const stats: MemoryStats = buildStats(store, settings);
  const dist = stats.typeDist.filter((d) => d.count > 0).map((d) => `${d.emoji}${d.label} ${d.count}`).join("、");
  const tags = stats.tagCloud.slice(0, 10).map((t) => `#${t.tag}(${t.count})`).join(" ");
  const money = stats.injectTokenEstimate
    ? `单次注入约 ${stats.injectTokenEstimate} token（压缩后，缓存命中时几乎免费）`
    : "注入已关闭";
  const cleanTip = stats.lowHealth > 0
    ? `；${stats.lowHealth} 条低健康度记忆可清理（dm_forget 按需删除）`
    : "";
  const expiredTip = stats.expired > 0
    ? `；${stats.expired} 条已过期（自动清理开启后 ${settings.expiredCleanDays || 7} 天内移除）`
    : "";
  return wrapResult(
    true,
    `记忆洞察：共 ${stats.total} 条（${stats.sinceDays} 天内积累），今日新增 ${stats.todayAdded}，本周新增 ${stats.weekAdded}，平均健康度 ${stats.avgHealth}/100，累计访问 ${stats.totalAccess} 次，待复习 ${stats.dueReview} 条。\n类型分布：${dist || "无"}${stats.tagCloud.length ? "\n热门标签：" + tags : ""}\n省钱统计：${money}${cleanTip}${expiredTip}`,
    stats
  );
}

/* ---------------- dm_options ---------------- */

export async function dm_options(): Promise<ToolResult> {
  const store = await loadStore();
  const settings = await loadSettings();
  const allTags = Array.from(new Set(store.items.flatMap((m) => m.tags))).sort();
  const injection = buildInjection(store, settings, 400);
  const conflicts = store.conflicts || [];
  return wrapResult(
    true,
    `记忆系统信息：类型=${MEMORY_TYPES.map((t) => `${t.emoji}${t.labelZh}(${t.key})`).join("、")}；空间=${settings.spaces.join("、")}（当前 ${settings.activeSpace}）；全部标签 ${allTags.length} 个；冲突待确认 ${conflicts.length} 处；设置=${JSON.stringify(settings)}${injection ? "\n当前注入预览：\n" + injection : ""}`,
    {
      types: MEMORY_TYPES,
      tags: allTags,
      settings,
      spaces: settings.spaces,
      activeSpace: settings.activeSpace,
      conflicts,
      total: store.items.length,
      injectionPreview: injection
    }
  );
}

/* ---------------- dm_report / dm_extract / dm_conflicts ---------------- */

export async function dm_report(params?: { space?: string; days?: number }): Promise<ToolResult> {
  const p = params || {};
  const store = await loadStore();
  const settings = await loadSettings();
  const report = buildReport(store, settings, p.space, typeof p.days === "number" ? p.days : undefined);
  return wrapResult(true, `已生成记忆报告（${report.length} 字符）：\n${report.slice(0, 600)}${report.length > 600 ? "\n…（完整报告见 data.report）" : ""}`, { report });
}

export async function dm_extract(params?: { text?: string }): Promise<ToolResult> {
  const p = params || {};
  const text = String(p.text || "").trim();
  if (!text) return wrapResult(false, "缺少 text 参数：请提供要解析的文本（如用户消息）。", null);
  const intent = extractMemoryIntent(text);
  if (!intent) {
    return wrapResult(true, "未检测到需要记忆的内容。可主动使用 dm_remember 写入。", { matched: false });
  }
  return wrapResult(
    true,
    `检测到记忆意图：类型=${TYPE_MAP[intent.type].labelZh}，重要性 ${intent.importance}/5${intent.sensitive ? "，敏感（将加密存储）" : ""}。内容：「${intent.content}」。可直接调用 dm_remember 写入（或确认后由自动提取写入）。`,
    { matched: true, intent }
  );
}

export async function dm_conflicts(params?: { clear?: boolean }): Promise<ToolResult> {
  const p = params || {};
  const store = await loadStore();
  const conflicts = store.conflicts || [];
  if (p.clear === true) {
    store.conflicts = [];
    await saveStore(store);
    return wrapResult(true, "冲突提醒已清空。", { conflicts: [] });
  }
  if (!conflicts.length) {
    return wrapResult(true, "当前没有记忆冲突。", { conflicts: [] });
  }
  const lines = conflicts.map((c, i) => `${i + 1}. 旧记忆「${c.existingContent.slice(0, 50)}」vs 新信息「${c.newContent.slice(0, 50)}」——${c.field} 不一致（${formatTime(c.at)}）`);
  return wrapResult(true, `有 ${conflicts.length} 处记忆冲突待确认：\n${lines.join("\n")}\n确认后可用 dm_update 修正旧记忆，或用 dm_conflicts(clear=true) 清空提醒。`, { conflicts });
}

/* ---------------- dm_export / dm_import ---------------- */

export async function dm_export(): Promise<ToolResult> {
  const store = await loadStore();
  const json = exportJson(store);
  return wrapResult(true, `已导出 ${store.items.length} 条记忆（JSON 字符串见 data.json），可用于备份或迁移。`, { json, count: store.items.length });
}

export async function dm_import(params?: { json?: string; mode?: string }): Promise<ToolResult> {
  const p = params || {};
  const raw = String(p.json || "").trim();
  if (!raw) return wrapResult(false, "缺少 json 参数（dm_export 的导出内容）。", null);
  const store = await loadStore();
  const mode = p.mode === "replace" ? "replace" : "merge";
  try {
    const r = importJson(store, raw, mode);
    await saveStore(store);
    return wrapResult(true, `导入完成：${r.added} 条（模式 ${mode}），当前共 ${r.total} 条记忆。`, r);
  } catch (e: any) {
    return wrapResult(false, "导入失败：" + (e && e.message ? e.message : String(e)), null);
  }
}

/* ---------------- dm_export_bundle / dm_import_bundle（JSON + 图片完整备份） ---------------- */

export async function dm_export_bundle(): Promise<ToolResult> {
  const store = await loadStore();
  const settings = await loadSettings();
  try {
    const r: BundleExportResult = await exportBundle(store, settings);
    return wrapResult(
      true,
      `已导出完整记忆包（${r.memoryCount} 条记忆，${r.imageCount} 张图片）：${r.bundlePath}\n该包包含 memories.json + images/，可用 dm_import_bundle 恢复，或直接解压查看。`,
      r
    );
  } catch (e: any) {
    return wrapResult(false, "导出失败：" + (e && e.message ? e.message : String(e)), null);
  }
}

export async function dm_import_bundle(params?: { path?: string }): Promise<ToolResult> {
  const p = params || {};
  const path = String(p.path || "").trim();
  if (!path) return wrapResult(false, "缺少 path 参数：请提供要导入的记忆包路径（dm_export_bundle 生成的 .toolpkg）。", null);
  const store = await loadStore();
  const settings = await loadSettings();
  try {
    const r: BundleImportResult = await importBundle(store, path, settings);
    await saveStore(store);
    return wrapResult(
      true,
      `导入完成：新增 ${r.added} 条记忆，${r.imageCount} 张图片（合并模式），当前共 ${store.items.length} 条。`,
      r
    );
  } catch (e: any) {
    return wrapResult(false, "导入失败：" + (e && e.message ? e.message : String(e)), null);
  }
}

/* ---------------- IPC 辅助（main 用） ---------------- */

export async function ipcGetAll(limit?: number): Promise<ToolResult> {
  const store = await loadStore();
  const cap = Math.max(1, Math.min(500, limit || 100));
  // 时间线按创建时间倒序：最新的记忆排在最上面。
  // 原实现直接 slice 取插入顺序，导致 旧→新 且超限时丢掉最新记忆。
  const items = store.items
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, cap)
    .map(publicItem);
  return wrapResult(true, `共 ${store.items.length} 条记忆`, { total: store.items.length, items });
}

export async function ipcDelete(id: string): Promise<ToolResult> {
  return dm_forget({ id });
}

export async function ipcUpdateImportance(id: string, importance: number): Promise<ToolResult> {
  return dm_update({ id, importance });
}

export async function ipcSetPinned(id: string, pinned: boolean): Promise<ToolResult> {
  return dm_update({ id, pinned });
}

export async function ipcReviewDone(id: string): Promise<ToolResult> {
  const store = await loadStore();
  const settings = await loadSettings();
  const item = findById(store, id);
  if (!item) return wrapResult(false, `未找到记忆 ${id}`, null);
  completeReview(item, settings);
  await saveStore(store);
  return wrapResult(true, `记忆 ${id} 已标记复习完成，下次复习：${formatTime(item.nextReviewAt)}`, publicItem(item));
}

export async function ipcSettingsGet(): Promise<ToolResult> {
  const settings = await loadSettings();
  return wrapResult(true, "设置已加载", settings);
}

export async function ipcSettingsSet(patch: Record<string, unknown>): Promise<ToolResult> {
  const settings = await loadSettings();
  Object.keys(patch || {}).forEach((k) => {
    const v = (patch as Record<string, any>)[k];
    if (v !== undefined) (settings as Record<string, any>)[k] = v;
  });
  await saveSettings(settings);
  return wrapResult(true, "设置已保存", settings);
}

export async function ipcSuggestLinks(id: string): Promise<ToolResult> {
  const store = await loadStore();
  const settings = await loadSettings();
  const item = findById(store, id);
  if (!item) return wrapResult(false, `未找到记忆 ${id}`, null);
  const related = findRelated(store, item, settings, 8);
  return wrapResult(true, `找到 ${related.length} 条可关联记忆`, related.map(publicItem));
}

export async function ipcRecallForUi(params: Record<string, unknown>): Promise<ToolResult> {
  return dm_recall(params as any);
}

export async function ipcStatsForUi(): Promise<ToolResult> {
  return dm_stats();
}

export async function ipcReviewForUi(limit?: number): Promise<ToolResult> {
  return dm_review({ limit });
}

export async function ipcInjectionPreview(): Promise<ToolResult> {
  const store = await loadStore();
  const settings = await loadSettings();
  return wrapResult(true, "注入预览", buildInjection(store, settings));
}

export async function ipcReport(space?: string, days?: number): Promise<ToolResult> {
  return dm_report({ space, days });
}

export async function ipcConflicts(clear?: boolean): Promise<ToolResult> {
  return dm_conflicts({ clear });
}

export async function ipcAutoExtract(text: string, chatId?: string): Promise<ToolResult> {
  const t = String(text || "").trim();
  if (!t) return wrapResult(false, "缺少文本", null);
  /* v1.1.0：优先交给 AI 判定该不该记（关闭 aiExtract 时自动落回正则）。
     延迟 require 避免与 ai-extract 形成加载期循环依赖。 */
  try {
    const st0 = await loadSettings();
    if ((st0 as any).aiExtract !== false) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ai = require("../ai-extract");
      if (ai && typeof ai.aiExtractText === "function") {
        return await ai.aiExtractText(t, chatId);
      }
    }
  } catch (e) { /* AI 不可用则继续走正则 */ }
  const intent = extractMemoryIntent(t);
  if (!intent) return wrapResult(true, "未命中记忆句式", { matched: false });

  // 快捷遗忘：删除匹配关键词的记忆
  if (intent.kind === "forget") {
    const forgetRes = await dm_forget({ keyword: intent.content });
    return wrapResult(
      true,
      `已执行快捷遗忘：「${intent.content}」→ ${forgetRes.message}`,
      { matched: true, kind: "forget", result: forgetRes.data }
    );
  }

  const store = await loadStore();
  const settings = await loadSettings();
  // 自动提取归属：autoExtractChat 开 → 单独记忆（当前对话框）；关 → 通用记忆
  const targetChatId = settings.autoExtractChat === true && chatId ? chatId : undefined;
  const result = await remember(store, {
    content: intent.content,
    type: intent.type,
    importance: intent.importance,
    source: "auto",
    sensitive: intent.sensitive,
    chatId: targetChatId
  }, settings);
  if (result.conflicts && result.conflicts.length) {
    store.conflicts = (store.conflicts || []).concat(result.conflicts).slice(-10);
  }
  await saveStore(store);
  const typeInfo = TYPE_MAP[result.item.type] || TYPE_MAP["fact"];
  return wrapResult(
    true,
    `已自动记忆：${typeInfo.emoji} ${typeInfo.labelZh}「${result.item.content.slice(0, 60)}」${result.item.sensitive ? "（已加密）" : ""}${result.item.chatId ? "（单独记忆·仅本对话框）" : "（通用记忆）"}${result.conflicts.length ? " ⚠️ 发现冲突：" + result.conflicts.length + " 处" : ""}`,
    publicItem(result.item)
  );
}