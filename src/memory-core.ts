/**
 * Deep Memory - memory core
 * 六边形长期记忆核心：存储 / 遗忘曲线 / 标签引擎 / 检索打分 / 关联 / 统计
 * 纯逻辑 + Tools.Files IO，可被 main / sandbox 工具 / UI 共用。
 */

export const PLUGIN_ID = "com.operit.deep_memory";
export const DATA_DIR = `/sdcard/Download/Operit/plugins/${PLUGIN_ID}`;
export const MEMORY_FILE = `${DATA_DIR}/memories.json`;
export const SETTINGS_FILE = `${DATA_DIR}/settings.json`;
export const IMAGES_DIR = `${DATA_DIR}/images`;
export const EXPORT_DIR = `/sdcard/Download/Operit/export/${PLUGIN_ID}`;
export const MAX_MEMORIES = 100000; // 存储无硬上限（受物理空间限制）
export const MAX_LINKS_PER_MEMORY = 64;
export const DEFAULT_IMPORTANCE = 3;

/* ---------------- 类型定义 ---------------- */

export type MemoryType = "fact" | "preference" | "event" | "relation" | "idea" | "task";

export const MEMORY_TYPES: { key: MemoryType; labelZh: string; labelEn: string; emoji: string; colorA: string; colorB: string }[] = [
  { key: "fact", labelZh: "事实", labelEn: "Fact", emoji: "📌", colorA: "#4FC3F7", colorB: "#0288D1" },
  { key: "preference", labelZh: "偏好", labelEn: "Preference", emoji: "❤️", colorA: "#F06292", colorB: "#C2185B" },
  { key: "event", labelZh: "事件", labelEn: "Event", emoji: "🗓️", colorA: "#FFB74D", colorB: "#E65100" },
  { key: "relation", labelZh: "关系", labelEn: "Relation", emoji: "🔗", colorA: "#BA68C8", colorB: "#6A1B9A" },
  { key: "idea", labelZh: "想法", labelEn: "Idea", emoji: "💡", colorA: "#AED581", colorB: "#33691E" },
  { key: "task", labelZh: "任务", labelEn: "Task", emoji: "✅", colorA: "#4DB6AC", colorB: "#00695C" }
];

export const TYPE_MAP: Record<string, { key: MemoryType; labelZh: string; labelEn: string; emoji: string; colorA: string; colorB: string }> = {};
MEMORY_TYPES.forEach((t) => { TYPE_MAP[t.key] = t; });

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;      // 1-5
  source: string;          // chat / user / ai / ai-action / manual / ui / import / auto
  createdAt: number;
  updatedAt: number;
  lastAccessAt: number;
  accessCount: number;
  reviewCount: number;
  lastReviewedAt: number;
  nextReviewAt: number;    // 遗忘曲线：到期时间
  links: string[];         // 关联记忆 id
  space: string;           // 记忆空间：general / 工作 / 生活 / 学习 ...
  chatId?: string;         // 单独记忆：仅该对话框可见；空=通用记忆（全局共享）
  /**
   * 角色归属（角色主线隔离）。
   * - undefined / "" = 全局记忆，任何角色可见（默认）
   * - 具体 id       = 仅该角色可见（角色私域记忆）
   * 与 chatId 是两个独立维度：chatId 管"在哪个对话"，characterId 管"对谁而言"。
   */
  characterId?: string;
  characterName?: string;  // 角色显示名快照（便于 UI 展示与角色删除后溯源）
  /**
   * 发言人（v1.2.8 群聊改造）。
   * - "user"      = 用户本人说的话
   * - 其他字符串  = 群成员的显示名（如 "张三"）
   * - undefined   = 未知发言人（老数据，无归属）
   *
   * 为什么必须单独存：群聊里"我喜欢美式"脱离了发言人就是垃圾数据——
   * 张三的偏好和李四的偏好会被混成同一个人。characterId 表达的是
   * "这条记忆带给谁看"，speaker 表达的是"这句话是谁说的"，两者正交。
   */
  speaker?: string;
  speakerId?: string;      // 发言人稳定 id（成员 id，改名不失联）
  /**
   * 归属作用域（v1.2.8）。显式记录本条记忆的可见性边界，
   * 不再靠 characterId 是否带 "group:" 前缀去反推。
   * - "global"    = 全局（用户本人画像，任何场景可见）
   * - "character" = 某角色私域
   * - "group"     = 某群共享（仅该群可见）
   * 缺省时由 characterId 推断，保证老数据行为不变。
   */
  scope?: string;
  sensitive?: boolean;     // 敏感内容加密存储
  imagePath?: string;      // 关联图片（记忆目录内相对路径 images/<id>.ext），空=无图
  expiryAt?: number;       // 可选过期时间
  pinned?: boolean;        // 置顶
}

export interface MemorySettings {
  autoInject: boolean;             // 是否把高价值记忆注入系统提示词
  injectCount: number;             // 每次注入条数（默认 5）
  injectIncludeDue: boolean;       // 注入时是否包含到期复习项
  reviewEnabled: boolean;          // 是否启用遗忘曲线
  reviewBaseDays: number;          // 首次复习间隔天数（默认 1）
  reviewGrowth: number;            // 间隔增长倍数（默认 2）
  defaultImportance: number;       // 默认重要性
  autoTag: boolean;                // 自动提取标签
  autoLink: boolean;               // 自动建议关联
  autoExtract: boolean;            // 对话中自动提取记忆（"记住/我叫/我喜欢"等句式）
  conflictCheck: boolean;          // 新记忆与旧记忆冲突检测
  dueRemind: boolean;              // 注入时标注到期/过期任务提醒
  spaces: string[];                // 记忆空间列表
  activeSpace: string;             // 当前激活空间
  encryptKey: string;              // 敏感记忆加密密钥（空=不启用加密）
  autoBackup: boolean;             // 每次写入自动备份
  embedEnabled: boolean;           // 语义检索（Embedding API）
  embedEndpoint: string;           // 如 https://api.openai.com/v1/embeddings
  embedKey: string;
  embedModel: string;
  /* 省钱引擎 */
  compactInject: boolean;          // 注入压缩（条数/长度/标签精简）
  cacheFriendly: boolean;          // 缓存友好注入（文本稳定 + 缓存文件复用，配合前缀缓存省钱）
  hotColdSplit: boolean;           // 冷热分级（热记忆全量 + 冷记忆标题行）
  /* 记忆注入范围：通用记忆(全局共享) + 单独记忆(仅当前对话框) 组合 */
  injectGeneral: boolean;          // 注入通用记忆（全部全局记忆可见）
  injectSpace: boolean;            // 注入单独记忆（仅当前对话框的记忆）
  autoExtractChat: boolean;        // 自动提取的记忆存入单独记忆（仅当前对话框），关=存通用记忆
  /* 好用增强 */
  autoCleanExpired: boolean;       // 过期记忆自动清理
  expiredCleanDays: number;        // 过期多少天后清理（默认 7）
  birthdayRemind: boolean;         // 重要日期（生日/纪念日）提前提醒
  quickForget: boolean;            // 快捷遗忘（"忘了关于X的事"自动删除）
  /* ---- AI 智能记忆（v1.1.0 新增）---- */
  aiExtract: boolean;              // 由宿主模型语义判断该不该记（替代固定正则）
  aiExtractType: string;           // 主通道 functionType（MEMORY）
  aiExtractFallbackType: string;   // 降级通道 functionType（CHAT）
  aiExtractThinking: boolean;      // 调用时是否启用思考
  aiExtractRecordUsage: boolean;   // 是否记录 token 用量
  aiExtractMinLen: number;         // 触发 AI 判定的最短消息长度
  aiExtractMaxPerHour: number;     // 每小时最多调用次数
  aiExtractMaxItems: number;       // 单条消息最多提取条数
  aiExtractTimeoutMs: number;      // 单次模型调用超时（毫秒）；宿主侧无超时保护，插件必须自己兜底
  /* ---- AI 侧记忆（v1.2.4 新增）：不只记用户说的话，也记 AI 自己做了什么、要做什么 ---- */
  aiSideExtract: boolean;          // 记录 AI 侧的行动/待办/结论（开关）
  aiSideMinLen: number;            // AI 回复触发抽取的最短长度（AI 回复通常很长，门槛可略高）
  aiSideMaxPerHour: number;        // AI 侧每小时最多调用次数（与用户侧独立计数）
  aiSideMaxItems: number;          // AI 侧单条回复最多提取条数
  /* ---- v1.2.5：AI 侧记忆质量（去重 + 待办结案）---- */
  aiSideDedup: boolean;            // AI 侧写入前做语义去重，避免同一件事反复记
  aiSideTaskAutoClose: boolean;    // AI 侧待办自动结案（完成即删除，不留僵尸待办）
  contextDedup: boolean;           // 写入前把库里已有的高重要性记忆一并给模型做参照去重（v1.2.9）
  aiSideTaskTtlHours: number;      // 未结案待办的保留小时数，超时自动过期
  /* 注入预算 */
  injectPinnedAlways: boolean;     // 置顶记忆常驻注入
  injectBudgetChars: number;       // 注入字符预算
  /* ---- 角色主线隔离（v1.2.0 新增）---- */
  characterIsolation: boolean;     // 启用角色隔离：按当前角色过滤注入与检索
  injectGlobalMemory: boolean;     // 注入全局记忆（characterId 为空的，任何角色都可见）
  injectCharacterMemory: boolean;  // 注入当前角色的私域记忆
  injectGroupMemory: boolean;      // v1.2.8：注入当前群的共享记忆（仅在该群内）
  promoteGroupUserMemory: boolean; // v1.2.8：群聊里「用户本人」说的话升格为全局可见
  characterAutoTag: boolean;       // 自动写入时把当前角色记到 characterId 上
  characterFallbackGlobal: boolean;// 拿不到角色 id 时降级为全局可见（true）还是什么都不注入（false）
  characterRegistry: CharacterEntry[]; // 角色注册表（id → 显示名，用于 UI 与历史记忆补名）
}

/** 角色注册表条目：记忆库里出现的角色快照 */
export interface CharacterEntry {
  id: string;
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  count: number;   // 该角色名下记忆条数（读取时实时计算，仅供展示）
}

export const DEFAULT_SETTINGS: MemorySettings = {
  autoInject: true,
  injectCount: 3,
  injectIncludeDue: true,
  reviewEnabled: true,
  reviewBaseDays: 1,
  reviewGrowth: 2,
  defaultImportance: 3,
  autoTag: true,
  autoLink: true,
  autoExtract: true,
  conflictCheck: true,
  dueRemind: true,
  spaces: ["general", "工作", "生活", "学习"],
  activeSpace: "general",
  encryptKey: "",
  autoBackup: true,
  embedEnabled: false,
  embedEndpoint: "",
  embedKey: "",
  embedModel: "",
  compactInject: true,
  cacheFriendly: true,
  hotColdSplit: true,
  injectGeneral: true,
  injectSpace: true,
  autoExtractChat: false,
  autoCleanExpired: true,
  expiredCleanDays: 7,
  birthdayRemind: true,
  quickForget: true,
  // ---- AI 智能记忆（v1.1.0 新增）----
  aiExtract: true,
  aiExtractType: "MEMORY",
  aiExtractFallbackType: "CHAT",
  aiExtractThinking: false,
  aiExtractRecordUsage: false,
  aiExtractMinLen: 6,
  aiExtractMaxPerHour: 60,
  aiExtractMaxItems: 3,
  // 宿主对 hook 返回的 Promise 没有超时保护（dex 里 timeoutSec 可为 null），
  // 一旦模型不返回，消息管线会被永久挂住。这里给单次调用设硬上限。
  aiExtractTimeoutMs: 45000,
  // ---- AI 侧记忆（v1.2.4 新增）----
  // 默认开启：只记用户说的话会导致「只记住你是谁，没记住我们做到哪」。
  aiSideExtract: true,
  aiSideMinLen: 24,
  aiSideMaxPerHour: 20,
  aiSideMaxItems: 3,
  // ---- v1.2.5：AI 侧记忆质量 ----
  // 去重默认开：实测不加会 10 分钟写 30 条近重复过程叙述。
  aiSideDedup: true,
  // 待办自动结案默认开：一次性待办完成后必须消失，否则会一直注入「尚未验证」误导后续对话。
  aiSideTaskAutoClose: true,
  // v1.2.9：只做「批内」去重挡不住改写（实测 45 对同义句相似度最高仅 0.487），
  // 必须把库里已有约束一起给模型看，才可能认出「换了个说法的同一件事」。
  contextDedup: true,
  aiSideTaskTtlHours: 72,
  // 注入预算：pinned 常驻 + 按重要性挑选，避免记忆变多后盖不全
  injectPinnedAlways: true,
  injectBudgetChars: 1600,
  // ---- 角色主线隔离（v1.2.0 新增）----
  characterIsolation: true,        // 默认开启：不同角色不串记忆
  injectGlobalMemory: true,        // 全局记忆照常注入（你的偏好/习惯对所有角色通用）
  injectCharacterMemory: true,     // 角色私域记忆也注入
  injectGroupMemory: true,         // v1.2.8：群共享记忆在本群内注入
  promoteGroupUserMemory: true,    // v1.2.8：群里用户本人的自述升格为全局（用户画像不该被群边界切断）
  characterAutoTag: true,          // 自动提取时记录当前角色
  characterFallbackGlobal: true,   // 拿不到角色（普通对话）→ 按全局处理
  characterRegistry: []
};

export interface MemoryStore {
  version: number;
  items: MemoryItem[];
  updatedAt: number;
  conflicts?: ConflictInfo[];  // 最近的记忆冲突提醒
}

/* ---------------- 基础工具 ---------------- */

export function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const p = (n: number) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (e) {
    return "";
  }
}

export function genId(): string {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- 敏感内容加密 ---------------- */

/** 自实现 Base64（兼容 quickjs/node，无外部依赖） */
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Encode(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++) & 0xff;
    const c2 = i < input.length ? input.charCodeAt(i++) & 0xff : NaN;
    const c3 = i < input.length ? input.charCodeAt(i++) & 0xff : NaN;
    out += B64_CHARS.charAt(c1 >> 2);
    out += B64_CHARS.charAt(((c1 & 3) << 4) | (isNaN(c2) ? 0 : (c2 >> 4)));
    out += isNaN(c2) ? "=" : B64_CHARS.charAt(((c2 & 15) << 2) | (isNaN(c3) ? 0 : (c3 >> 6)));
    out += isNaN(c3) ? "=" : B64_CHARS.charAt(c3 & 63);
  }
  return out;
}
function base64Decode(input: string): string {
  const clean = String(input).replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "";
  let i = 0;
  while (i + 1 < clean.length) {
    const c1c = clean.charAt(i);
    const c2c = clean.charAt(i + 1);
    const c3c = clean.charAt(i + 2);
    const c4c = clean.charAt(i + 3);
    if (!c1c || !c2c) break;
    const e1 = B64_CHARS.indexOf(c1c);
    const e2 = B64_CHARS.indexOf(c2c);
    const e3 = c3c === "=" ? 64 : B64_CHARS.indexOf(c3c);
    const e4 = c4c === "=" ? 64 : B64_CHARS.indexOf(c4c);
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== 64) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== 64) out += String.fromCharCode(((e3 & 3) << 6) | e4);
    i += 4;
  }
  return out;
}

/** XOR 流加密（本地混淆级，无需外部依赖） */
function xorCipher(text: string, key: string): string {
  const k = key || "deep_memory";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ k.charCodeAt(i % k.length));
  }
  return out;
}

/** 尝试 CryptoJS.AES 加密（运行时存在则用），否则回退 XOR+Base64 */
export function encryptText(plain: string, key: string): string {
  if (!key) return plain;
  try {
    const aes: any = (globalThis as any).CryptoJS && (globalThis as any).CryptoJS.AES;
    if (aes && typeof aes.encrypt === "function") {
      return "AES:" + aes.encrypt(plain, key).toString();
    }
  } catch (e) {
    // fallthrough
  }
  try {
    // 先转 %XX ASCII 串再 XOR（避免中文 charCode 高位截断），再 base64
    const b64 = base64Encode(xorCipher(encodeURIComponent(plain), key));
    return "XOR:" + b64;
  } catch (e) {
    return "XOR:" + xorCipher(plain, key).split("").map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  }
}

export function decryptText(cipher: string, key: string): string {
  if (!key || !cipher) return cipher;
  try {
    if (cipher.startsWith("AES:")) {
      const aes: any = (globalThis as any).CryptoJS && (globalThis as any).CryptoJS.AES;
      if (aes && typeof aes.decrypt === "function") {
        const bytes = aes.decrypt(cipher.slice(4), key);
        const text = bytes && typeof bytes.toString === "function" ? bytes.toString((globalThis as any).CryptoJS.enc.Utf8) : "";
        return text || cipher;
      }
      return cipher;
    }
    if (cipher.startsWith("XOR:")) {
      const raw = cipher.slice(4);
      try {
        const decoded = xorCipher(base64Decode(raw), key);
        return decodeURIComponent(decoded);
      } catch (e) {
        const hex: string[] = (raw.match(/.{1,2}/g) || []).slice();
        const s = hex.map((h: string) => String.fromCharCode(parseInt(h, 16))).join("");
        return xorCipher(s, key);
      }
    }
  } catch (e) {
    // ignore
  }
  return cipher;
}

/* ---------------- 自动记忆提取（句式解析） ---------------- */

export interface ExtractIntent {
  content: string;
  type: MemoryType;
  importance: number;
  sensitive: boolean;
  kind?: "remember" | "forget"; // remember=写入；forget=删除（快捷遗忘）
}

const EXTRACT_PATTERNS: { re: RegExp; type: MemoryType; importance: number; sensitive: boolean; kind?: "remember" | "forget" }[] = [
  { re: /(?:请记住|记住|别忘了|记一下)[:：，,]?\s*(.+)/, type: "fact", importance: 4, sensitive: false },
  { re: /(?:我叫|我是|我的名字(?:是|叫))\s*(.+)/, type: "fact", importance: 5, sensitive: false },
  { re: /(?:我(?:的)?生日(?:是|在))\s*(.+)/, type: "fact", importance: 5, sensitive: false },
  { re: /(?:我(?:的)?(?:地址|住址)(?:是|在))\s*(.+)/, type: "fact", importance: 4, sensitive: true },
  { re: /(?:我(?:的)?(?:手机号|电话|号码|微信号|微信|qq|邮箱|email)(?:是|为))\s*(.+)/, type: "fact", importance: 5, sensitive: true },
  { re: /(?:我(?:的)?(?:身份证|证件号|卡号|密码|账号)(?:是|为))\s*(.+)/, type: "fact", importance: 5, sensitive: true },
  { re: /(?:我(?:的)?(?:公司|工作|职业|职位|单位)(?:是|在))\s*(.+)/, type: "fact", importance: 4, sensitive: false },
  { re: /(?:我(?:的)?(?:学校|专业|班级|学历)(?:是|在))\s*(.+)/, type: "fact", importance: 4, sensitive: false },
  { re: /(?:我喜欢|我热爱|我最喜欢|我爱)\s*(.+)/, type: "preference", importance: 4, sensitive: false },
  { re: /(?:我不喜欢|我讨厌|我反感)\s*(.+)/, type: "preference", importance: 4, sensitive: false },
  { re: /(?:我(?:的)?习惯是|我习惯)\s*(.+)/, type: "preference", importance: 3, sensitive: false },
  { re: /(?:下周|明天|后天|本周|这个月|月底|年底|截止|deadline|ddl)[^，。！？]*?(?:要|需|得|必须|记得)?\s*(?:交|完成|做|提交|发|写|去)\s*(.+)/, type: "task", importance: 4, sensitive: false },
  { re: /(?:任务|待办|事项|计划|安排)[:：]?\s*(.+)/, type: "task", importance: 3, sensitive: false },
  { re: /(?:我和|我认识|我的(?:朋友|同事|家人|对象|老婆|老公|儿子|女儿|孩子|亲戚))\s*(.+)/, type: "relation", importance: 4, sensitive: false },
  { re: /(?:我的想法是|我觉得|我认为|我想)\s*(.+)/, type: "idea", importance: 3, sensitive: false },
  { re: /(?:忘了|忘掉|删除|移除|不记得|不需要|删掉)[:：，,]?\s*(?:关于|这条|这些)?\s*(.+)/, type: "fact", importance: 3, sensitive: false, kind: "forget" }
];

/** 从用户消息中解析记忆意图（含快捷遗忘）；无命中返回 null */
export function extractMemoryIntent(text: string): ExtractIntent | null {
  const t = String(text || "").trim();
  if (!t || t.length > 2000) return null;
  for (const p of EXTRACT_PATTERNS) {
    const m = t.match(p.re);
    if (m && m[1] && m[1].trim().length >= 2) {
      const content = m[1].trim();
      if (content.length < 4 && p.kind !== "forget") continue;
      // 内容含敏感词 → 自动标记敏感
      const sensitive = p.sensitive || /(地址|住址|手机号|电话|号码|微信号|微信|qq|邮箱|email|身份证|证件号|卡号|密码|账号|银行卡)/.test(content);
      return {
        content,
        type: p.type,
        importance: p.importance,
        sensitive,
        kind: p.kind
      };
    }
  }
  return null;
}

/* ---------------- 冲突检测 ---------------- */

export interface ConflictInfo {
  existingId: string;
  existingContent: string;
  newContent: string;
  field: string;
  at: number;
}

/** 同主题关键值冲突检测：token 重叠度高但数字/日期等关键值不同 */
export function conflictDetect(store: MemoryStore, content: string): ConflictInfo[] {
  const out: ConflictInfo[] = [];
  const newNums: string[] = (content.match(/(\d{2,4})/g) || []).slice();
  if (!newNums.length) return out;
  const newTokens = new Set(tokenize(content));
  for (const old of store.items) {
    const overlap = newTokens.size ? Array.from(newTokens).filter((tk) => old.content.toLowerCase().includes(tk)).length / Math.min(newTokens.size, tokenize(old.content).length || 1) : 0;
    if (overlap < 0.5) continue;
    const oldNums: string[] = (old.content.match(/(\d{2,4})/g) || []).slice();
    if (!oldNums.length) continue;
    const differs = oldNums.some((n) => !newNums.includes(n));
    if (differs) {
      out.push({ existingId: old.id, existingContent: old.content.slice(0, 120), newContent: content.slice(0, 120), field: oldNums.join("/"), at: Date.now() });
    }
  }
  return out.slice(0, 5);
}

/* ---------------- 记忆报告 ---------------- */

export function buildReport(store: MemoryStore, settings: MemorySettings, space?: string, days?: number): string {
  const now = Date.now();
  const items = store.items.filter((m) => {
    if (space && m.space !== space) return false;
    if (typeof days === "number" && days > 0 && m.createdAt < now - days * 86400000) return false;
    return true;
  });
  const stats = buildStats({ ...store, items }, settings);
  const L: string[] = [];
  L.push("# 深度记忆报告");
  L.push("");
  L.push(`生成时间：${formatTime(now)}`);
  L.push(`范围：${space || "全部空间"}${typeof days === "number" && days > 0 ? " / 最近 " + days + " 天" : " / 全部时间"}`);
  L.push("");
  L.push(`## 概览`);
  L.push(`共 ${items.length} 条记忆，今日新增 ${stats.todayAdded}，本周新增 ${stats.weekAdded}，待复习 ${stats.dueReview}，平均健康度 ${stats.avgHealth}/100。`);
  L.push("");
  L.push(`## 类型分布`);
  stats.typeDist.filter((d) => d.count > 0).forEach((d) => L.push(`- ${d.label}：${d.count} 条`));
  L.push("");
  L.push(`## 热门标签`);
  stats.tagCloud.slice(0, 15).forEach((t) => L.push(`- #${t.tag}（${t.count}）`));
  L.push("");
  L.push(`## 记忆列表（按时间倒序）`);
  sortItems(items, "time").forEach((m) => {
    const t = TYPE_MAP[m.type] || TYPE_MAP["fact"];
    L.push(`- [${t.labelZh}|★${m.importance}|${formatTime(m.createdAt)}] ${m.content}${m.tags.length ? " #" + m.tags.slice(0, 4).join(" #") : ""}`);
  });
  return L.join("\n");
}

/* ---------------- 语义检索（Embedding，可选） ---------------- */

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedTexts(texts: string[], settings: MemorySettings): Promise<number[][]> {
  const clean = texts.map((t) => String(t).slice(0, 8000));
  const http: any = (globalThis as any).Tools && (globalThis as any).Tools.Net;
  if (!http || typeof http.http !== "function") throw new Error("Tools.Net unavailable");
  const endpoint = settings.embedEndpoint || "https://api.openai.com/v1/embeddings";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.embedKey) headers["Authorization"] = "Bearer " + settings.embedKey;
  const res = await http.http({
    url: endpoint,
    method: "POST",
    headers,
    body: { input: clean, model: settings.embedModel || "text-embedding-3-small" },
    responseType: "json"
  });
  const body = res && res.body ? res.body : res;
  const list = (body && (body.data || (body.body && body.body.data))) || [];
  return list.map((item: any) => Array.isArray(item.embedding) ? item.embedding : []);
}

/** 语义检索重排：对候选按 embedding 余弦相似度加分 */
export async function rerankByEmbedding(items: MemoryItem[], query: string, settings: MemorySettings): Promise<MemoryItem[]> {
  if (!settings.embedEnabled || !query || !items.length) return items;
  try {
    const vecs = await embedTexts([query].concat(items.slice(0, 30).map((m) => m.content)), settings);
    const qv = vecs[0];
    if (!qv || !qv.length) return items;
    const scored = items.slice(0, 30).map((m, i) => ({ m, s: cosine(qv, vecs[i + 1] || []) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m).concat(items.slice(30));
  } catch (e) {
    return items;
  }
}

export function clampImportance(v: unknown): number {
  const n = parseInt(String(v), 10);
  if (isNaN(n)) return DEFAULT_IMPORTANCE;
  return Math.max(1, Math.min(5, n));
}

export function normalizeType(v?: string): MemoryType {
  const k = String(v || "").trim().toLowerCase();
  return (TYPE_MAP[k] ? k : "fact") as MemoryType;
}

/* ---------------- 标签引擎 ---------------- */

const STOP_WORDS = new Set([
  "一个", "这个", "那个", "什么", "怎么", "可以", "知道", "觉得", "喜欢", "我们", "你们", "他们", "自己",
  "因为", "所以", "但是", "如果", "就是", "还是", "已经", "没有", "不要", "不会", "不能", "应该", "可能",
  "今天", "明天", "昨天", "时候", "地方", "东西", "事情", "一下", "一些", "有点", "非常", "特别", "真的",
  "the", "and", "that", "this", "with", "have", "from", "your", "about", "will", "would", "there"
]);

/** 双字切分时跳过的高频虚词字（避免产出"欢喝/喝冰"类噪音标签） */
const STOP_CHARS = new Set([
  "的", "了", "是", "在", "和", "有", "去", "喝", "吃", "欢", "喜", "爱", "会", "能", "要", "想",
  "觉", "知", "说", "看", "玩", "还", "就", "都", "也", "很", "个", "吧", "吗", "呢", "啊", "哦",
  "这", "那", "我", "你", "他", "她", "它", "们", "上", "下", "里", "中", "到", "对", "给", "把",
  "被", "让", "从", "向", "于", "之", "与", "及", "或", "而", "但", "并", "又", "再", "更", "最",
  "每", "第", "某", "各", "此", "该", "另", "别", "同", "随", "跟", "向", "朝", "往", "为", "因"
]);

/** 从文本提取候选标签：hashtag、英文词、中文双字+片段 */
/* v1.2.6 标签治理
 *
 * 实测结论：按「自然语言分词」打标签必然失败。库里 75 个标签有 66 个只出现过一次，
 * 等于没打标签，还白占注入预算。根因是「每条记忆内容不同 → 抽出的词天然不同 →
 * 标签天然不可复用」，换分词算法救不回来（试过 4 种，唯一值反而从 75 涨到 220）。
 *
 * 现在的策略：
 *   1. 标签只收「可辨识标识」——文件名、驼峰键、带分隔符标识符、版本号。
 *      中文短语一律不进标签：它本质是内容切片，复用率为 0。
 *   2. 写入时用 pruneTagsByReuse 过滤：候选标签必须在库里已经出现过（含本条则 ≥2 次），
 *      否则丢弃。这样标签天然是「复用型索引」而不是「专属碎片」。
 *   3. 单条上限 5 个，宁缺勿滥；全部被过滤掉就留空数组，允许没有标签。
 */
const TAG_TOKEN = /[A-Za-z0-9][A-Za-z0-9_]*(?:[.:-][A-Za-z0-9_]+)*/g;
const TAG_COMMON = new Set([
  "的", "了", "是", "在", "和",
  "the", "and", "for", "with", "that", "this", "from", "have", "will", "but", "not",
  "you", "all", "can", "are", "was", "were", "has", "had", "its", "our", "out", "one",
  "get", "set", "use", "used", "must", "more", "than", "then", "them", "there", "these",
  "those", "what", "when", "which", "who", "why", "how", "does", "doing", "done", "make",
  "made", "need", "needs", "only", "also", "just", "even", "still", "very", "into", "over",
  "after", "before", "because", "would", "could", "should", "may", "might", "much", "many",
  "some", "any", "each", "every", "both", "other", "another", "same", "diff", "new", "old",
  "yes", "off", "now", "run", "ran", "try", "tried", "add", "added", "fix", "fixed", "see",
  "seen", "say", "said", "way", "here", "where", "about", "above", "below", "again", "once",
  "always", "never", "often", "less", "most", "own", "per", "pre", "sub", "non", "via", "yet",
  "etc", "like", "want", "wants", "know", "think", "take", "give", "keep", "let", "put",
  "true", "false", "null", "none", "void", "type", "name", "value", "data", "item", "list",
  "map", "obj", "func", "var", "const", "async", "await", "return", "import", "export",
  "class", "public", "private", "static", "string", "number", "boolean", "array", "object",
  "error", "warn", "info", "debug", "test", "tests", "main", "index", "file", "files", "path",
  "text", "code", "json", "http", "https", "html", "css", "api", "url", "uri", "key", "keys",
  "log", "logs", "line", "lines", "node", "dist", "src", "lib", "bin", "tmp", "temp", "user",
  "users", "root", "home", "admin", "system", "tool", "tools", "pkg", "cmd", "exec", "shell",
  "bash", "python", "npm", "git", "commit", "branch", "call", "read", "write", "start", "stop",
  /* 记忆自身的结构字段与类型名：它们出现在几乎所有正文里，共享度高但没有区分力 */
  "fact", "idea", "event", "relation", "preference", "task", "content", "content", "source",
  "memory", "memories", "plugin", "plugins", "package", "packages", "file", "files",
  /* 纯英文字母碎片：长度小于 6 的裸英文词通常是动词/介词残留 */
  "done", "soon", "next", "last", "first", "second", "third", "week", "month", "year", "time",
  "times", "case", "cases", "point", "level", "stage", "step", "steps", "part", "parts"
]);
function normTag(raw: string): string {
  let v = String(raw || "").toLowerCase();
  v = v.replace(/^[._:+-]+|[._:+-]+$/g, "");
  v = v.replace(/[._-]?\d{10,}$/, "");
  return v;
}
/**
 * 抽取候选标签（未经复用过滤）。
 *
 * 职责划分（v1.2.6 重构）：
 *   - 这里只管「宽」：把所有 ASCII 标识类 token 都交出来，不做语义判断；
 *   - 收敛交给 pruneTagsByReuse：没被别的记忆用过的，一律丢弃。
 *
 * 为什么不收中文：中文切片本质是正文碎片，实测 88% 只出现一次，
 * 且切词器会产出「需要确认一下内容」这类句子碎片。换四种切分方案
 * 唯一值反从 75 涨到 220，证明这条路不通。中文正文本身已在注入里可见，
 * 且 scoreRelevance 用 qTokens 对正文加分，不靠中文标签检索。
 */
export function extractTags(content: string, existing: string[] = []): string[] {
  const text = String(content || "");
  const out = new Set<string>();
  const add = (raw: string) => {
    const v = normTag(raw);
    if (v.length < 4 || v.length > 40) return;
    const letters = v.replace(/[^a-z]/g, "").length;
    if (letters === 0) return;             // 纯数字/纯符号不做标签
    /* 版本号（v1.2.5）与短标识（2.4g）是有效标识，只要带数字就放行；
       纯字母裸词则要求 >= 4 个字母，挡掉 com/api/key/doc 这类三级短词。 */
    const hasDigit = /[0-9]/.test(v);
    if (!hasDigit && letters < 4) return;
    if (TAG_COMMON.has(v)) return;
    out.add(v);
  };
  (text.match(TAG_TOKEN) || []).forEach(add);
  (existing || []).forEach((e) => {
    const v = normTag(e);
    if (v && v.length >= 2) out.add(v);
  });
  /* 常量更多候选（12），让 prune 在其中挑出最多 5 个可复用的；
     若在这里就截断到 5，前面不可复用的候选会把后面可用的挤死。 */
  return Array.from(out).slice(0, 12);
}
/**
 * 复用过滤：只保留「库里已经有另一条记忆也带这个标识」的标签。
 * 这样标签总量受词表收敛约束，不会随记忆条数线性膨胀。
 */
/* 标识频次缓存：key = 条数|updatedAt，命中即复用，避免每次写入都全库重算 */
let _tagFreqCache: { key: string; map: Map<string, number> } | null = null;
/**
 * 统计每个标识在多少条记忆里出现过（按候选集口径，不是子串匹配）。
 * 用候选集口径的原因：子串匹配会把 com 命中 command、key 命中 keynote，
 * 频次虚高，等于把「谁都沾一点的词」当成索引。
 */
export function tagFreqMap(store: MemoryStore): Map<string, number> {
  const items = (store && store.items) || [];
  const key = items.length + '|' + (store && store.updatedAt ? store.updatedAt : 0);
  if (_tagFreqCache && _tagFreqCache.key === key) return _tagFreqCache.map;
  const map = new Map<string, number>();
  for (const m of items) {
    /* 只吃正文候选集，不吃 m.tags：否则标签会自我强化（写进去→频次+1→留下）
       → 重算结果随上一轮结果漂移，永远不收敛。标签必须是正文的纯函数。 */
    const set = new Set<string>(extractTags(String(m.content || ""), []));
    set.forEach((tg) => { if (tg) map.set(tg, (map.get(tg) || 0) + 1); });
  }
  _tagFreqCache = { key, map };
  return map;
}
/**
 * 复用过滤：只保留「被 >= 2 条记忆共享」的标识。
 *
 * 为什么必须共享：标签的价值在于把多条记忆连成网。一条记忆独占的标识
 * 既找不到同伴、也建不出关联，还白占注入预算——实测库里 88% 的标签是这种碎片。
 *
 * 为什么用全库频次而不是「别人提过没有」：后者看的是写入瞬间的库状态，
 * 同一个标识先写后写结论不同，结果随写入顺序漂移，且无法对存量库重算收敛。
 * 全库频次只依赖各条记忆正文，与顺序无关，因此幂等、可反复重算。
 */
export function pruneTagsByReuse(store: MemoryStore, tags: string[], selfContent?: string): string[] {
  const cand = (tags || []).map(normTag).filter((x) => x.length >= 2);
  if (cand.length === 0) return [];
  const freq = tagFreqMap(store);
  const keep: string[] = [];
  for (const tg of cand) {
    /* 若本条已在 store 里，它已计入 freq；若还没有（写入前调用），freq 里没有本条，
       此时只要「已有 >= 1 条别的记忆带它」就说明将来会成为共享标签，故门槛取 1。 */
    const inStore = store.items.some((m) => String(m.content || "") === String(selfContent || ""));
    const n = (freq.get(tg) || 0) + (inStore ? 0 : 1);
    if (n >= 2) {
      keep.push(tg);
      if (keep.length >= 5) break;
    }
  }
  return keep;
}
/**
 * 存量建链：按当前 autoLink 规则给全库重建关联。
 *
 * 之前的 autoLink 只在 remember() 里跑，存量记忆永远等不到建链机会——
 * 实测 65 条记忆、按规则本该有 117 条边，实际 links 全为 0。
 *
 * 规则与 remember 内保持一致：同角色 + 同空间 + 共享标签 >= 1，最多 3 条，双向。
 * 幂等：已存在的边不重复加；每次从零重算，避免旧边越积越多。
 */
export function relinkAll(store: MemoryStore, settings: MemorySettings): { linked: number; edges: number; pruned: number } {
  const before = store.items.reduce((a, m) => a + (m.links || []).length, 0);
  /* 先清空，再按规则重建，保证幂等且能把失效边一并清掉 */
  store.items.forEach((m) => { m.links = []; });
  const byId = new Map<string, MemoryItem>();
  store.items.forEach((m) => byId.set(m.id, m));
  for (const item of store.items) {
    const mine = new Set((item.tags || []).map((x) => String(x).toLowerCase()));
    if (mine.size === 0) continue;
    const linkable = store.items
      .filter((m) => m.id !== item.id)
      .filter((m) => String(m.characterId || "") === String(item.characterId || ""))
      .filter((m) => (m.space || "general") === (item.space || "general"))
      .map((m) => {
        const shared = (m.tags || []).filter((x) => mine.has(String(x).toLowerCase())).length;
        return { m, shared };
      })
      .filter((x) => x.shared >= 1)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 3);
    linkable.forEach((x) => {
      if (item.links.indexOf(x.m.id) < 0) item.links.push(x.m.id);
      if (x.m.links.indexOf(item.id) < 0) x.m.links.push(item.id);
    });
  }
  store.items.forEach((m) => { m.links = m.links.slice(0, MAX_LINKS_PER_MEMORY); });
  const after = store.items.reduce((a, m) => a + (m.links || []).length, 0);
  const linked = store.items.filter((m) => (m.links || []).length > 0).length;
  return { linked, edges: after, pruned: Math.max(0, before - after) };
}
/**
 * 存量重算：按当前策略把全库标签重算一遍。
 * 只改 tags，不动正文/链接/时间戳；幂等，可重复执行。
 */
export function retagAll(store: MemoryStore): { changed: number; tagged: number; unique: number; removed: number } {
  const freq = tagFreqMap(store);
  let changed = 0, tagged = 0, removed = 0;
  const uniq = new Set<string>();
  for (const m of store.items) {
    let cand = extractTags(String(m.content || ""), []).map(normTag);
    cand = cand.filter((tg) => (freq.get(tg) || 0) >= 2).slice(0, 5);
    const before = (m.tags || []).map(normTag).join(",");
    const after = cand.join(",");
    const oldLen = (m.tags || []).length;
    if (before !== after) {
      m.tags = cand;
      changed++;
      if (cand.length < oldLen) removed += oldLen - cand.length;
    }
    if (cand.length) { tagged++; cand.forEach((tg) => uniq.add(tg)); }
  }
  _tagFreqCache = null;
  return { changed, tagged, unique: uniq.size, removed };
}
function tagShared(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  let hit = 0;
  b.forEach((t) => { if (setA.has(t.toLowerCase())) hit++; });
  return hit;
}

/* ---------------- 遗忘曲线 ---------------- */

export function computeNextReview(reviewCount: number, importance: number, baseDays: number, growth: number): number {
  const days = baseDays * Math.pow(growth, Math.min(reviewCount, 10)) * (1 + (importance - 3) * 0.3);
  return Date.now() + Math.round(days * 86400000);
}

/** 记忆健康度 0-100：重要性 + 访问活跃 - 遗忘惩罚 */
export function healthScore(item: MemoryItem): number {
  const now = Date.now();
  const ageDays = (now - item.createdAt) / 86400000;
  const idleDays = (now - item.lastAccessAt) / 86400000;
  let score = item.importance * 15; // 15-75
  score += Math.min(15, item.accessCount * 0.8);
  score -= Math.min(30, idleDays * 0.5);
  score -= Math.min(20, Math.max(0, ageDays - 90) * 0.08);
  if (item.pinned) score = Math.max(score, 80);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 是否到期需要复习 */
export function isReviewDue(item: MemoryItem, settings: MemorySettings): boolean {
  if (!settings.reviewEnabled) return false;
  if (!item.nextReviewAt) return false;
  return Date.now() >= item.nextReviewAt;
}

/* ---------------- 检索打分 ---------------- */

export interface RecallQuery {
  query?: string;
  type?: string;
  tags?: string[];
  dateFrom?: number;
  dateTo?: number;
  limit?: number;
  sortBy?: string; // relevance | time | importance | access | health
  includeExpired?: boolean;
  space?: string;   // 记忆空间过滤
  allSpaces?: boolean; // true=忽略空间过滤
  chatId?: string;  // 不传=仅通用记忆；传=通用 + 该对话框单独记忆
  allChats?: boolean; // true=包含全部对话的单独记忆
  characterId?: string; // 当前角色 id；不传=只看全局记忆
  allCharacters?: boolean; // true=忽略角色隔离（管理面板/统计用）
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const words = text.match(/[a-zA-Z0-9][a-zA-Z0-9_-]{1,24}/g) || [];
  words.forEach((w) => out.push(w.toLowerCase()));
  const cnChunks = text.match(/[\u4e00-\u9fa5]{2,20}/g) || [];
  cnChunks.forEach((chunk) => {
    out.push(chunk);
    if (chunk.length >= 3) {
      for (let i = 0; i < chunk.length - 1; i++) out.push(chunk.slice(i, i + 2));
    }
  });
  return out;
}

/** 相关度打分：词命中加权 + 标签加权 + 时间衰减 */
export function scoreRelevance(item: MemoryItem, qTokens: string[], tags: string[]): number {
  let score = 0;
  const contentL = item.content.toLowerCase();
  const tagL = item.tags.map((t) => t.toLowerCase());
  qTokens.forEach((tk) => {
    if (contentL.includes(tk)) score += 2;
    if (tagL.some((t) => t.includes(tk) || tk.includes(t))) score += 3;
  });
  tags.forEach((tg) => {
    if (tagL.includes(tg.toLowerCase())) score += 4;
  });
  if (score <= 0) return 0;
  // 时间衰减：近期访问权重略高
  const idleDays = (Date.now() - item.lastAccessAt) / 86400000;
  const decay = Math.exp(-idleDays / 60);
  return Math.round(score * (0.75 + 0.25 * decay) * 100) / 100;
}

export function sortItems(items: MemoryItem[], sortBy: string): MemoryItem[] {
  const arr = items.slice();
  switch (sortBy) {
    case "time":
      arr.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
    case "importance":
      arr.sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt);
      break;
    case "access":
      arr.sort((a, b) => b.accessCount - a.accessCount || b.lastAccessAt - a.lastAccessAt);
      break;
    case "health":
      arr.sort((a, b) => healthScore(b) - healthScore(a));
      break;
    case "relevance":
    default:
      break;
  }
  return arr;
}

/** 对命中记忆做一次访问记录（提高活跃度） */
export function touchItems(items: MemoryItem[]): void {
  const now = Date.now();
  items.forEach((it) => {
    it.accessCount += 1;
    it.lastAccessAt = now;
  });
}

/* ---------------- 存储 ---------------- */

function emptyStore(): MemoryStore {
  return { version: 1, items: [], updatedAt: Date.now() };
}

export function normalizeItem(raw: Record<string, any>): MemoryItem | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const ts = Date.now();
  const item: MemoryItem = {
    id: String(raw.id),
    type: normalizeType(raw.type),
    content: typeof raw.content === "string" ? raw.content : "",
    tags: Array.isArray(raw.tags) ? raw.tags.map((t: any) => String(t)).slice(0, 30) : [],
    importance: clampImportance(raw.importance),
    source: typeof raw.source === "string" ? raw.source : "import",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : ts,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : ts,
    lastAccessAt: typeof raw.lastAccessAt === "number" ? raw.lastAccessAt : ts,
    accessCount: typeof raw.accessCount === "number" ? raw.accessCount : 0,
    reviewCount: typeof raw.reviewCount === "number" ? raw.reviewCount : 0,
    lastReviewedAt: typeof raw.lastReviewedAt === "number" ? raw.lastReviewedAt : 0,
    nextReviewAt: typeof raw.nextReviewAt === "number" ? raw.nextReviewAt : 0,
    links: Array.isArray(raw.links) ? raw.links.map((l: any) => String(l)).slice(0, MAX_LINKS_PER_MEMORY) : [],
    space: typeof raw.space === "string" && raw.space ? raw.space : "general"
  };
  /* v1.2.8：新字段必须反序列化回来，否则每次 loadStore 都会丢发言人 */
  if (typeof raw.speaker === "string" && raw.speaker) item.speaker = raw.speaker;
  if (typeof raw.speakerId === "string" && raw.speakerId) item.speakerId = raw.speakerId;
  /* 先还原 characterId，再推断 scope —— 顺序反了会把老群数据全判成 global */
  if (typeof raw.characterId === "string" && raw.characterId) item.characterId = raw.characterId;
  if (typeof raw.characterName === "string" && raw.characterName) item.characterName = raw.characterName;
  if (typeof raw.scope === "string" && raw.scope) item.scope = raw.scope;
  else if (item.characterId) item.scope = String(item.characterId).indexOf("group:") === 0 ? "group" : "character";
  else item.scope = "global";
  if (typeof raw.chatId === "string" && raw.chatId) item.chatId = raw.chatId;
  if (typeof raw.imagePath === "string" && raw.imagePath) item.imagePath = raw.imagePath;
  if (typeof raw.expiryAt === "number") item.expiryAt = raw.expiryAt;
  if (raw.pinned === true) item.pinned = true;
  if (raw.sensitive === true) item.sensitive = true;
  return item;
}

export function normalizeStore(raw: unknown): MemoryStore {
  const store = emptyStore();
  if (!raw || typeof raw !== "object") return store;
  const obj = raw as Record<string, any>;
  if (Array.isArray(obj.items)) {
    store.items = obj.items
      .map((it: any) => normalizeItem(it))
      .filter((it: MemoryItem | null): it is MemoryItem => !!it && it.content.length > 0)
      .slice(0, MAX_MEMORIES);
  }
  if (Array.isArray(obj.conflicts)) {
    store.conflicts = obj.conflicts
      .filter((c: any) => c && typeof c === "object" && c.existingId && c.newContent)
      .slice(-10);
  }
  return store;
}

async function ensureDir(): Promise<void> {
  try {
    const r = await Tools.Files.exists(DATA_DIR);
    if (!r.exists) await Tools.Files.mkdir(DATA_DIR, true);
  } catch (e) {
    // ignore
  }
}

/** 加密 store 中敏感记忆内容（带 key） */
export function encryptStoreItems(store: MemoryStore, key: string): void {
  if (!key) return;
  store.items.forEach((m) => {
    if (m.sensitive && m.content && !m.content.startsWith("AES:") && !m.content.startsWith("XOR:")) {
      m.content = encryptText(m.content, key);
    }
  });
}

/** 解密 store 中敏感记忆内容 */
export function decryptStoreItems(store: MemoryStore, key: string): void {
  if (!key) return;
  store.items.forEach((m) => {
    if (m.sensitive && m.content && (m.content.startsWith("AES:") || m.content.startsWith("XOR:"))) {
      const dec = decryptText(m.content, key);
      if (dec && dec !== m.content) m.content = dec;
    }
  });
}

/** 自动备份：写入 backup/memories_<ts>.json，保留最近 20 份 */
async function backupStore(store: MemoryStore, key: string): Promise<void> {
  try {
    const backupDir = DATA_DIR + "/backup";
    const exists = await Tools.Files.exists(backupDir);
    if (!exists.exists) await Tools.Files.mkdir(backupDir, true);
    const backupStore: MemoryStore = JSON.parse(JSON.stringify(store));
    encryptStoreItems(backupStore, key);
    await Tools.Files.write(backupDir + "/memories_" + Date.now() + ".json", JSON.stringify(backupStore), false);
    // 保留最近 20 份
    try {
      const listRes = await Tools.Files.list(backupDir);
      const files = (listRes && listRes.entries ? listRes.entries : [])
        .filter((e: any) => !e.isDirectory && String(e.name || "").endsWith(".json"))
        .map((e: any) => ({ name: String(e.name), path: backupDir + "/" + String(e.name) }))
        .sort((a: any, b: any) => b.name.localeCompare(a.name));
      for (const f of files.slice(20)) {
        try { await Tools.Files.deleteFile(f.path, false, "android"); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ignore
    }
  } catch (e) {
    // ignore
  }
}

export async function loadStore(): Promise<MemoryStore> {
  try {
    await ensureDir();
    const res = await Tools.Files.exists(MEMORY_FILE);
    if (!res.exists) return emptyStore();
    const data = await Tools.Files.read(MEMORY_FILE);
    const raw = data.content || "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      /* v1.2.8 数据安全：解析失败绝不能静默返回空库。
         原实现会返回 emptyStore()，随后任意一次 saveStore 就把整库覆盖成空，
         这在「写入非原子 + 并发读写」时是真实可复现的丢库路径。 */
      const r2 = await Tools.Files.read(MEMORY_FILE);
      try {
        parsed = JSON.parse((r2 && r2.content) || "");
      } catch (e2) {
        parsed = null;
      }
      if (parsed === null) {
        /* 最后一道防线：从 backup/ 找最新一份能解析的顶上 */
        try {
          const backupDir = DATA_DIR + "/backup";
          const listRes = (await Tools.Files.list(backupDir)) as any;
          const files = (listRes && listRes.entries ? listRes.entries : [])
            .filter((en: any) => !en.isDirectory && String(en.name || "").endsWith(".json"))
            .map((en: any) => String(en.name))
            .sort()
            .reverse();
          for (const nm of files.slice(0, 5)) {
            try {
              const bd = await Tools.Files.read(backupDir + "/" + nm);
              const bparsed = JSON.parse((bd && bd.content) || "");
              if (bparsed && Array.isArray((bparsed as any).items)) {
                parsed = bparsed;
                console.log("[dm] 主库损坏，已回退备份 " + nm);
                break;
              }
            } catch (eb) { /* 试下一份 */ }
          }
        } catch (el) { /* ignore */ }
      }
      if (parsed === null) {
        const brokenPath = MEMORY_FILE + ".broken_" + Date.now();
        try { await Tools.Files.write(brokenPath, raw, false); } catch (e3) { /* ignore */ }
        throw new Error("记忆库解析失败，已隔离原文到 " + brokenPath);
      }
    }
    const store = normalizeStore(parsed);
    try {
      const settings = await loadSettings();
      decryptStoreItems(store, settings.encryptKey || "");
    } catch (e) {
      // ignore
    }
    return store;
  } catch (e) {
    /* v1.2.8：外层 catch 不能把「坏库」错误吞掉。
       否则内层辛苦抛出的异常会在这里被抹平，仍旧静默返回空库。 */
    const msg = String((e && (e as any).message) || "");
    if (msg.indexOf("记忆库解析失败") >= 0) throw e;
    return emptyStore();
  }
}

export async function saveStore(store: MemoryStore): Promise<void> {
  await ensureDir();
  store.updatedAt = Date.now();
  let key = "";
  try {
    const settings = await loadSettings();
    key = settings.encryptKey || "";
    // 过期记忆自动清理（保留 expiredCleanDays 天缓冲，有备份兜底）
    if (settings.autoCleanExpired) {
      const cutoff = Date.now() - Math.max(0, settings.expiredCleanDays || 7) * 86400000;
      const before = store.items.length;
      store.items = store.items.filter((m) => !(typeof m.expiryAt === "number" && m.expiryAt < cutoff));
      if (store.items.length < before) {
        const keepIds = new Set(store.items.map((m) => m.id));
        store.items.forEach((m) => { m.links = m.links.filter((l) => keepIds.has(l)); });
      }
    }
    if (settings.autoBackup) {
      await backupStore(store, key);
    }
  } catch (e) {
    // ignore
  }
  const clone: MemoryStore = JSON.parse(JSON.stringify(store));
  encryptStoreItems(clone, key);
  /* v1.2.8 写入健壮性：
     宿主 Files 只有 read/write/copy/deleteFile/list，没有 move/rename，
     做不了真正的 rename 原子替换。改为三步：
       ① 先写 .tmp 完整副本（此时主文件仍完好）
       ② 再覆盖主文件
       ③ 万一主文件解析失败，loadStore 会回退到 backup/ 最新可解析副本
     实测过并发读写会读到半截 JSON；这套能保证「读到半截」不演变成「丢库」。 */
  const tmpFile = MEMORY_FILE + ".tmp";
  const payload = JSON.stringify(clone);
  try {
    await Tools.Files.write(tmpFile, payload, false);
  } catch (e) {
    /* .tmp 写失败不阻断主写入 */
  }
  await Tools.Files.write(MEMORY_FILE, payload, false);
}

export async function loadSettings(): Promise<MemorySettings> {
  try {
    await ensureDir();
    const res = await Tools.Files.exists(SETTINGS_FILE);
    if (!res.exists) return { ...DEFAULT_SETTINGS };
    const data = await Tools.Files.read(SETTINGS_FILE);
    const parsed = JSON.parse(data.content || "{}");
    return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: MemorySettings): Promise<void> {
  await ensureDir();
  await Tools.Files.write(SETTINGS_FILE, JSON.stringify(s, null, 2), false);
}

/* ---------------- 记忆 CRUD ---------------- */

export interface RememberInput {
  content: string;
  type?: string;
  tags?: string[];
  importance?: number;
  source?: string;
  linkIds?: string[];
  expiryAt?: number;
  pinned?: boolean;
  space?: string;
  sensitive?: boolean;
  chatId?: string;         // 单独记忆：仅该对话框可见；空=通用记忆
  characterId?: string;    // 角色归属：空=全局记忆（所有角色可见）
  characterName?: string;  // 角色名快照
  speaker?: string;        // 发言人（v1.2.8）：user / 群成员名
  speakerId?: string;      // 发言人稳定 id
  scope?: string;          // 归属作用域：global / character / group
  imagePath?: string;      // 本地图片路径（复制进记忆库）
  mergeSimilar?: boolean; // 相似内容去重合并
}

export function findById(store: MemoryStore, id: string): MemoryItem | null {
  return store.items.find((m) => m.id === id) || null;
}

/** 相似度去重：内容重叠 >= 0.6 视为重复 */
function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  let hit = 0;
  tb.forEach((t) => { if (setA.has(t)) hit++; });
  return hit / Math.min(ta.length, tb.length);
}

/**
 * v1.2.5 AI 侧语义去重。
 *
 * 为什么不能用词面相似度：AI 侧写的是过程叙述，
 * 「已核实缓存指纹 fb46435a」和「确认四个文件已写入且指纹一致」字面差别很大、
 * 语义完全重复，token 重合度抓不住这种冗余，只会越记越臃肿。
 *
 * 真正能区分「有没有新增信息」的是**可辨识错点**：文件名、路径、哈希、版本号、
 * 带分隔符的标识符、驼峰设置键。它们才是记忆的载荷；
 * 中文描述只是包装，同一件事换个说法，错点集合不变。
 *
 * 判定规则（用 30 条真实 AI 侧记忆逐对校准过）：
 *   候选的特征集合被某条同类型旧记忆**完全包含**，且候选自身错点 >= 3 个
 *   -> 候选没有任何新增信息 -> 视为重复，不必再写一条。
 * 只要候选多出哪怕一个错点（新文件、新值、新路径）就照常写入，绝不误杀。
 */
const FEATURE_PATTERNS = [
  /[A-Za-z0-9_-]+\.[A-Za-z]{2,6}(?![A-Za-z0-9])/g,
  /[0-9a-f]{8,}/g,
  /v\d+\.\d+(?:\.\d+)?/g,
  /[a-z]+[A-Z][A-Za-z0-9]{2,}/g,
  /[A-Za-z][A-Za-z0-9]*(?:[._:-][A-Za-z0-9]+)+/g
];
/** 抽出可辨识错点。时间戳后缀要归一化，否则同一条记忆换个时间就变成「新信息」 */
export function featureAnchors(text: string): string[] {
  const s = String(text || "");
  const out = new Set<string>();
  FEATURE_PATTERNS.forEach((re) => {
    const found = s.match(re) || [];
    found.forEach((raw) => {
      let a = raw.replace(/[_-]?\d{10,}/g, "").toLowerCase();
      a = a.replace(/^[/_.-]+|[/_.-]+$/g, "");
      if (a.length >= 3) out.add(a);
    });
  });
  return Array.from(out);
}
/**
 * 判断候选记忆是否只是旧记忆的复述。
 * 只与同 type 同角色的条目比对 —— 一个 task 和一个 fact 说同一件事不算重复。
 */
export function findRedundant(
  store: MemoryStore,
  content: string,
  opts: { type?: string; characterId?: string; threshold?: number; minFeatures?: number } = {}
): { item: MemoryItem; score: number } | null {
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.85;
  const minFeatures = typeof opts.minFeatures === "number" ? opts.minFeatures : 3;
  const cand = featureAnchors(content);
  // 错点太少的条目（比如「任务已清理」）没有可比对的骨架，一律放行，宁多记不误删
  if (cand.length < minFeatures) return null;
  const candSet = new Set(cand);
  const targetType = opts.type ? normalizeType(opts.type) : "";
  const targetChar = String(opts.characterId || "");
  let best: { item: MemoryItem; score: number } | null = null;
  for (const old of store.items) {
    if (String(old.characterId || "") !== targetChar) continue;
    if (targetType && normalizeType(old.type) !== targetType) continue;
    const oldFeat = featureAnchors(old.content);
    if (oldFeat.length < minFeatures) continue;
    const oldSet = new Set(oldFeat);
    let hit = 0;
    oldFeat.forEach((t) => { if (candSet.has(t)) hit++; });
    const score = hit / Math.min(cand.length, oldFeat.length);
    if (score < threshold) continue;
    // 关键闸门：候选若有旧记忆没有的错点，就是新增信息，不能判重复
    const newInCand = cand.filter((t) => !oldSet.has(t));
    if (newInCand.length > 0) continue;
    if (!best || score > best.score) best = { item: old, score };
  }
  return best;
}

/**
 * v1.2.5 待办结案：把「已完成」的 AI 侧一次性待办从库里清掉。
 *
 * 为什么必须有这一步：v1.2.4 写的 task 型记忆没有闭环，
 * 「待验证 xxx」这类一次性待办在事情做完后仍永久留在库中，
 * 还会被注入到后续对话，反复告诉模型「这件事还没做完」，属于主动误导。
 *
 * 结案规则（保守，宁可留错也不误删）：
 *   1. 只处理 source=ai-action 且 type=task 的条目 —— 用户侧的待办绝不代用户处理。
 *   2. 命中 doneKeywords（已完成/已验证/通过/已修复…）且不含 pendingKeywords（待/未/尚未…）
 *      → 判定已完成 → 直接删除。
 *   3. 未结案的按 aiSideTaskTtlHours 过期：超过时限的待办自动标记过期，
 *      由既有的 expiryAt 清理机制收走，不再无限累积。
 * 返回 { closed, expired }，调用方负责 saveStore。
 */
const DONE_KEYWORDS = ["已完成", "已通过", "验证通过", "已修复", "已解决", "已完成并", "已确认", "成功", "跑通"];
const PENDING_KEYWORDS = ["待", "未", "尚未", "还需", "需要", "下一步", "下次", "尚未确认", "未完成"];
export function closeAiSideTasks(
  store: MemoryStore,
  settings: any
): { closed: MemoryItem[]; expired: MemoryItem[] } {
  const closed: MemoryItem[] = [];
  const expired: MemoryItem[] = [];
  if (settings.aiSideTaskAutoClose === false) return { closed, expired };
  const now = Date.now();
  const ttlHours = Math.max(1, Number(settings.aiSideTaskTtlHours) || 72);
  const keep: MemoryItem[] = [];
  for (const m of store.items) {
    const isAiTask = m.source === "ai-action" && normalizeType(m.type) === "task";
    if (!isAiTask) { keep.push(m); continue; }
    const c = String(m.content || "");
    const hasDone = DONE_KEYWORDS.some((k) => c.indexOf(k) >= 0);
    const hasPending = PENDING_KEYWORDS.some((k) => c.indexOf(k) >= 0);
    // 同时含「已完成」和「待」的，多半是「待验证是否已完成」这类真待办，不能删
    if (hasDone && !hasPending) {
      closed.push(m);
      continue;
    }
    // 超时未结案：打上过期时间交给 expiryAt 清理，避免永久占用注入预算
    if (typeof m.expiryAt !== "number") {
      const age = now - (m.createdAt || now);
      if (age > ttlHours * 3600000) {
        m.expiryAt = now;
        m.updatedAt = now;
        expired.push(m);
      }
    }
    keep.push(m);
  }
  store.items = keep;
  return { closed, expired };
}

/** 写入一条记忆（自动标签 / 去重合并 / 关联 / 空间 / 敏感加密） */
export async function remember(store: MemoryStore, input: RememberInput, settings: MemorySettings): Promise<{ item: MemoryItem; merged: boolean; related: MemoryItem[]; conflicts: ConflictInfo[] }> {
  const content = String(input.content || "").trim();
  const now = Date.now();
  const space = input.space && settings.spaces.includes(input.space) ? input.space : settings.activeSpace || "general";

  // 冲突检测
  let conflicts: ConflictInfo[] = [];
  if (settings.conflictCheck) {
    conflicts = conflictDetect(store, content);
  }

  // 去重合并：内容高度相似时更新旧记忆（有冲突时不合并，保留旧记忆供确认）
  // 作用域隔离：只在同一作用域内合并 —— 否则角色A的话会被并进角色B的记忆，隔离从根上失效
  // v1.2.8：光比 characterId 不够。群里张三和李四可能说同一句「我喜欢咖啡」，
  //   若合并，发言人会被覆盖成后说的那个 —— 发言人本身就是要记的信息，必须一并比对。
  let merged = false;
  if (input.mergeSimilar !== false && conflicts.length === 0) {
    const targetChar = String(input.characterId || "");
    const targetSpeaker = String(input.speaker || "");
    for (const old of store.items) {
      if (String(old.characterId || "") !== targetChar) continue;   // 跨作用域绝不合并
      if (String(old.speaker || "") !== targetSpeaker) continue;    // 不同发言人绝不合并
      if (old.space === space && similarity(old.content, content) >= 0.6) {
        old.content = content;
        old.updatedAt = now;
        if (input.type) old.type = normalizeType(input.type);
        if (input.tags && input.tags.length) {
          const set = new Set([...old.tags, ...input.tags.map((t) => String(t).toLowerCase())]);
          old.tags = Array.from(set).slice(0, 30);
        }
        if (input.importance) old.importance = clampImportance(input.importance);
        if (input.pinned !== undefined) old.pinned = input.pinned;
        if (input.sensitive === true) old.sensitive = true;
        return { item: old, merged: true, related: findRelated(store, old, settings), conflicts };
      }
    }
  }

  // v1.2.6：autoTag 现在等于「生成候选 + 复用过滤」，不再直接信任分词结果
  const rawTags = settings.autoTag
    ? extractTags(content, input.tags || [])
    : (input.tags || []).map((t) => String(t).toLowerCase()).slice(0, 30);
  const tags = settings.autoTag ? pruneTagsByReuse(store, rawTags, content) : rawTags;

  const item: MemoryItem = {
    id: genId(),
    type: normalizeType(input.type),
    content,
    tags,
    importance: clampImportance(input.importance !== undefined ? input.importance : settings.defaultImportance),
    source: input.source || "manual",
    createdAt: now,
    updatedAt: now,
    lastAccessAt: now,
    accessCount: 1,
    reviewCount: 0,
    lastReviewedAt: 0,
    nextReviewAt: computeNextReview(0, clampImportance(input.importance !== undefined ? input.importance : settings.defaultImportance), settings.reviewBaseDays, settings.reviewGrowth),
    links: (input.linkIds || []).slice(0, MAX_LINKS_PER_MEMORY),
    space
  };
  /* v1.2.8：发言人必须跟着记忆一起落盘，否则群聊记忆是无主句 */
  if (input.speaker) item.speaker = String(input.speaker).slice(0, 40);
  if (input.speakerId) item.speakerId = String(input.speakerId).slice(0, 80);
  /* scope 显式化：老调用方不传时按 characterId 反推，行为与升级前一致 */
  item.scope = input.scope
    ? String(input.scope)
    : (input.characterId ? (String(input.characterId).indexOf("group:") === 0 ? "group" : "character") : "global");
  if (typeof input.chatId === "string" && input.chatId) item.chatId = input.chatId;
  /* v1.2.9：scope=global 时不允许再挂 characterId。
     之前会出现「scope=global 但 characterId=group:xxx」这种脏组合：
     可见性判断按 global 走（正确），但「角色」页统计却把它算进该角色名下，
     于是用户看到「某个群 0 条」却查不出这 0 条是怎么来的 —— 数据本身是自相矛盾的。
     现在落盘即规整：全局记忆一律不归属任何角色。 */
  if (item.scope === "global") {
    delete (item as any).characterId;
    delete (item as any).characterName;
  } else if (typeof input.characterId === "string" && input.characterId) {
    item.characterId = input.characterId;
    if (typeof input.characterName === "string" && input.characterName) item.characterName = input.characterName;
  }
  // 图片记忆：复制图片进库并关联
  if (input.imagePath && detectImageExt(input.imagePath)) {
    const rel = await copyImageIntoLibrary(input.imagePath, item.id);
    if (rel) item.imagePath = rel;
  }
  if (typeof input.expiryAt === "number") item.expiryAt = input.expiryAt;
  if (input.pinned === true) item.pinned = true;
  if (input.sensitive === true) item.sensitive = true;

  store.items.unshift(item);
  if (store.items.length > MAX_MEMORIES) {
    store.items = store.items.slice(0, MAX_MEMORIES);
  }

  // v1.2.6：autoLink 真正建链（之前它只生成建议、从不落盘，导致 links 恒为 0）
  // 建链条件保守：同角色 + 同空间 + 共享标签 >= 2，最多 3 条，宁少勿滥
  if (settings.autoLink !== false) {
    // 实测同一主题的两条记忆往往只共享 1 个标签（如 toolpkg），2 个的门槛会永远不建链。
    // 改为共享 1 个即建链，但靠下面的互斥条件防滥连：只取分数最高的 3 条，且必须同角色同空间。
    const mine = new Set(item.tags.map((x) => String(x).toLowerCase()));
    const linkable = store.items
      .filter((m) => m.id !== item.id)
      .filter((m) => String(m.characterId || "") === String(item.characterId || ""))
      .filter((m) => m.space === item.space)
      .map((m) => {
        const shared = (m.tags || []).filter((x) => mine.has(String(x).toLowerCase())).length;
        return { m, shared };
      })
      .filter((x) => x.shared >= 1)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 3);
    linkable.forEach((x) => {
      if (item.links.length >= MAX_LINKS_PER_MEMORY) return;
      if (item.links.indexOf(x.m.id) < 0) item.links.push(x.m.id);
      if (x.m.links.indexOf(item.id) < 0) {
        x.m.links.push(item.id);
        x.m.links = x.m.links.slice(0, MAX_LINKS_PER_MEMORY);
      }
    });
  }
  // 反向关联：把关联写入目标记忆
  item.links.forEach((lid) => {
    const target = findById(store, lid);
    if (target && !target.links.includes(item.id)) {
      target.links.push(item.id);
      target.links = target.links.slice(0, MAX_LINKS_PER_MEMORY);
    }
  });

  return { item, merged: false, related: findRelated(store, item, settings), conflicts };
}

/** 自动关联建议：共享标签的记忆（>=2 个共同标签，或小标签集命中 1 个） */
export function findRelated(store: MemoryStore, item: MemoryItem, settings: MemorySettings, max: number = 6): MemoryItem[] {
  if (!settings.autoLink) return [];
  const candidates = store.items
    .filter((m) => m.id !== item.id && !item.links.includes(m.id))
    .map((m) => {
      const shared = tagShared(item.tags, m.tags);
      const minLen = Math.min(item.tags.length, m.tags.length);
      const hit = shared >= 2 || (shared >= 1 && minLen <= 5);
      return { m, s: hit ? shared + 1 / (minLen + 1) : 0 };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max);
  return candidates.map((x) => x.m);
}

/* ---------------- 角色主线隔离 ---------------- */

/**
 * 角色可见性契约（唯一判定入口，注入/检索/统计全部必须走这里）：
 *   - 未启用隔离          → 全部可见（向后兼容）
 *   - 记忆无 characterId  → 全局记忆，是否可见取决于 injectGlobalMemory
 *   - 记忆有 characterId  → 仅当与当前角色一致才可见，取决于 injectCharacterMemory
 *   - 当前无角色          → 只能看到全局记忆
 *
 * 关键设计：所有路径共用这一个函数，杜绝"存的时候隔离了、查的时候漏了"。
 */
/**
 * v1.2.8：算出本条记忆的归属作用域。
 * 优先用显式 scope 字段；老数据没有该字段，按 characterId 前缀推断，
 * 保证升级后老库行为与升级前完全一致。
 */
export function scopeOf(item: MemoryItem): string {
  const s = String(item.scope || "");
  if (s === "global" || s === "character" || s === "group") return s;
  const cid = String(item.characterId || "");
  if (!cid) return "global";
  return cid.indexOf("group:") === 0 ? "group" : "character";
}

export function isVisibleToCharacter(item: MemoryItem, characterId: string | undefined, settings: MemorySettings): boolean {
  if (!settings.characterIsolation) return true;
  const cur = String(characterId || "");
  const owner = String(item.characterId || "");
  /* v1.2.8：先判 scope。用户在群里说的话被定成 global，但事件里仍带着 group:xxx 的
     characterId（归属字段没清）。若只按「owner 为空」判全局，这类记忆会被当成群私域，
     导致「用户本人在群里说的话」在单聊/他群完全不可见 —— 与设计意图正好相反。 */
  if (scopeOf(item) === "global") return settings.injectGlobalMemory !== false;
  if (!owner) return settings.injectGlobalMemory !== false;
  if (!cur) return false;                       // 无角色身份：看不到任何角色私域记忆
  /* v1.2.8 群聊语义：group:xxx 是群共享池。
     只有当"当前作用域"就是这个群时才可见——群记忆不能漏到别的群/单聊。
     这与升级前行为一致（owner !== cur 即 false），但语义显式化了。 */
  if (scopeOf(item) === "group") return owner === cur && settings.injectGroupMemory !== false;
  if (owner !== cur) return false;              // 别的角色：一律不可见
  return settings.injectCharacterMemory !== false;
}

/**
 * v1.2.8 新增：判定「这条记忆要不要注入给当前作用域」。
 *
 * 与 isVisibleToCharacter 的分工：
 *   isVisibleToCharacter 只答「角色边界允不允许」
 *   isInjectable        再叠加「跨场景升格」规则
 *
 * 跨场景升格（解决用户画像断裂）：
 *   用户在群 A 说的「我是做网络运维的」，speaker=user。
 *   这条属于用户本人，不是群 A 的私有知识。
 *   因此 speaker=user 的群记忆，对任何作用域都可注入。
 *   而 speaker=张三 的群记忆只在群 A 内可见，绝不外流。
 *
 * 这样：用户画像全局随身带，群成员的隐私留在群里。
 */
export function isInjectable(item: MemoryItem, scopeId: string | undefined, settings: MemorySettings): boolean {
  if (isVisibleToCharacter(item, scopeId, settings)) return true;
  if (!settings.characterIsolation) return true;
  const sc = scopeOf(item);
  if (sc !== "group") return false;
  /* 群记忆升格条件（两条必须同时成立）：
     1. 发言人是用户本人（speaker=user），不是群成员
     2. 开关允许（默认开，可关） */
  const sp = String(item.speaker || "");
  if (sp !== "user") return false;
  if (settings.promoteGroupUserMemory === false) return false;
  return settings.injectGlobalMemory !== false;
}
/**
 * 严格解析：只认宿主真实下发的 activePrompt，绝不拿 roleName 猜。
 *
 * 字段候选面依据宿主 dex 证据拓宽（均零成本，命中即用）：
 *   - id 候选：id / cardId / characterCardId / characterId / promptId
 *   - 类型候选：type / promptType（dex 中 ActivePrompt 侧两者并存）
 *   - 名称候选：name / displayName / title / cardName / characterName
 *
 * 运行时实测（宿主 1.12.2，composeSystemPrompt / promptFinalize 双通道）：
 *   event.eventPayload.metadata.activePrompt = { type, id, name }
 *   type 实测取值：character_group（群聊）。宿主 dex 中的合法常量有
 *   character_card / character_group（classes12 各 35 处、classes8 各 20 处）。
 *
 * 关键教训：v1.2.0 首版白名单只放行 character_card/character/persona，
 * 导致群聊（character_group）被误杀、resolved 恒为空——白名单必须包含
 * 宿主的全部角色类 prompt 类型，否则等于没解析。
 */
export function resolvePromptScope(evt: any): { id: string; name: string; type: string } {
  const paths: any[] = [
    // 实测命中路径：两条钩子的 activePrompt 都在 eventPayload.metadata 下
    evt && evt.eventPayload && evt.eventPayload.metadata && evt.eventPayload.metadata.activePrompt,
    evt && evt.metadata && evt.metadata.activePrompt,
    evt && evt.eventPayload && evt.eventPayload.activePrompt,
    evt && evt.activePrompt,
  ];
  for (const p of paths) {
    if (!p || typeof p !== "object") continue;
    const type = String(p.type || p.promptType || "").toLowerCase();
    const id = p.id || p.cardId || p.characterCardId || p.characterId || p.promptId;
    if (!id) continue;
    // 只排除明确非角色的类型；未知类型放行（宁可多认也不要漏）。
    if (type === "system" || type === "tool" || type === "none") continue;
    const name = p.name || p.displayName || p.title || p.cardName || p.characterName || "";
    // 群聊作用域：宿主下发的是"群 id"，不是角色卡 id，必须加前缀区分域，
    // 否则同名 uuid 在群聊与单聊之间会串味。
    const scopeId = type === "character_group" ? "group:" + String(id) : String(id);
    return { id: scopeId, name: String(name), type: type };
  }
  return { id: "", name: "", type: "" };
}

/**
 * 兼容层：解析当前角色。优先真实 activePrompt；拿不到才退回 roleName 虚拟 id。
 *
 * 注意：roleName 兜底只用于"冷启动首次"这类实在没有上下文的情况。一旦
 * 注入钩子把真实 id 缓存下来，调用方应优先用缓存（见 currentCharacterId），
 * 否则会出现"注入用 group:x、落库用 role:<角色名>"的同一角色双 id 撕裂，
 * 记忆永远注入不回来。
 */
export function resolveCharacterId(evt: any): { id: string; name: string } {
  const strict = resolvePromptScope(evt);
  if (strict.id) return { id: strict.id, name: strict.name };
  // 最后兜底：chatmsg / msgproc 通道没有 metadata，只有 roleName。
  // 用 "role:<名字>" 作为稳定虚拟 id，保证群聊场景下的角色隔离不至于完全空转。
  // 注意：改名会导致 id 变化，因此只在拿不到真实 cardId 时使用。
  const payload = (evt && evt.eventPayload) || evt || {};
  const roleName = String(payload.roleName || payload.characterName || "").trim();
  if (roleName) return { id: "role:" + roleName, name: roleName };
  return { id: "", name: "" };
}

/** 判定一个显示名是不是「弱名字」：空、纯数字、单字符、或明显是会话编号。
 *  群里第一条消息的标题常常就是 "1" 这种，不能拿它盖掉已经记好的名字。 */
export function isWeakCharacterName(name: string): boolean {
  const s = String(name || "").trim();
  if (!s) return true;
  if (s.length < 2) return true;
  if (/^[\d\s._\-]+$/.test(s)) return true;
  if (/^(未命名角色|未知角色|undefined|null|NaN)$/i.test(s)) return true;
  return false;
}

/** 维护角色注册表：记录出现过的角色，便于 UI 分组与历史记忆补名 */
export function touchCharacterRegistry(settings: MemorySettings, id: string, name: string): boolean {
  if (!id) return false;
  if (!Array.isArray(settings.characterRegistry)) settings.characterRegistry = [];
  const now = Date.now();
  const hit = settings.characterRegistry.find((c) => c.id === id);
  if (hit) {
    let changed = false;
    // v1.2.9：只有新名字更「实」时才覆盖。否则 "1" 这类群标题会把好名字冲掉。
    const incomingWeak = isWeakCharacterName(name);
    const currentWeak = isWeakCharacterName(hit.name);
    if (name && hit.name !== name && (!incomingWeak || currentWeak)) { hit.name = name; changed = true; }
    if (now - hit.lastSeenAt > 60000) { hit.lastSeenAt = now; changed = true; }
    return changed;
  }
  settings.characterRegistry.push({ id, name: name || "未命名角色", firstSeenAt: now, lastSeenAt: now, count: 0 });
  return true;
}

/** 统计每个角色名下记忆条数（纯计算，不落盘） */
export function characterStats(store: MemoryStore, settings: MemorySettings): { id: string; name: string; count: number }[] {
  const map = new Map<string, { id: string; name: string; count: number }>();
  store.items.forEach((m) => {
    if (!m.characterId) return;
    const cur = map.get(m.characterId) || {
      id: m.characterId,
      name: m.characterName || (settings.characterRegistry || []).find((c) => c.id === m.characterId)?.name || "未知角色",
      count: 0,
    };
    cur.count += 1;
    map.set(m.characterId, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/** 执行检索（含过滤 + 打分 + 排序 + 访问记录 + 空间过滤 + 可选语义重排） */
export async function recall(store: MemoryStore, q: RecallQuery, settings: MemorySettings): Promise<{ items: MemoryItem[]; total: number; touched: boolean }> {
  const now = Date.now();
  const query = String(q.query || "").trim();
  const qTokens = query ? tokenize(query) : [];
  const tags = (q.tags || []).map((t) => String(t).toLowerCase());
  const type = q.type ? normalizeType(q.type) : null;
  const space = q.allSpaces ? null : (q.space || settings.activeSpace || "general");

  let filtered = store.items.filter((m) => {
    if (space && m.space !== space) return false;
    // 角色主流隔离：唯一判定入口（characterId 缺省=全局可见）
    if (!q.allCharacters && !isInjectable(m, q.characterId, settings)) return false;
    // 对话归属过滤：默认仅通用记忆；传 chatId 则含该对话单独记忆；allChats 含全部
    if (q.allChats !== true) {
      if (q.chatId) {
        if (m.chatId && m.chatId !== q.chatId) return false;
      } else if (m.chatId) {
        return false;
      }
    }
    if (type && m.type !== type) return false;
    if (tags.length && !tags.every((tg) => m.tags.map((t) => t.toLowerCase()).includes(tg))) return false;
    if (typeof q.dateFrom === "number" && m.updatedAt < q.dateFrom) return false;
    if (typeof q.dateTo === "number" && m.updatedAt > q.dateTo) return false;
    if (!q.includeExpired && typeof m.expiryAt === "number" && m.expiryAt < now) return false;
    if (qTokens.length && scoreRelevance(m, qTokens, tags) <= 0) return false;
    return true;
  });

  const total = filtered.length;

  if (qTokens.length || tags.length) {
    const scored = filtered.map((m) => ({ m, s: scoreRelevance(m, qTokens, tags) }));
    scored.sort((a, b) => b.s - a.s || b.m.updatedAt - a.m.updatedAt);
    filtered = scored.map((x) => x.m);
    // 记录访问
    const top = filtered.slice(0, Math.min(20, total));
    touchItems(top);
  } else {
    filtered = sortItems(filtered, q.sortBy || "time");
    const top = filtered.slice(0, Math.min(20, total));
    touchItems(top);
  }

  // 语义检索重排（可选，embedding API 配置后启用）
  if (qTokens.length && settings.embedEnabled) {
    filtered = await rerankByEmbedding(filtered, query, settings);
  }

  const limit = Math.max(1, Math.min(100, q.limit || 10));
  return { items: filtered.slice(0, limit), total, touched: true };
}

/* ---------------- 统计洞察 ---------------- */

export interface MemoryStats {
  total: number;
  expired: number;
  pinned: number;
  todayAdded: number;
  weekAdded: number;
  dueReview: number;
  typeDist: { type: string; label: string; emoji: string; count: number }[];
  tagCloud: { tag: string; count: number }[];
  topActive: MemoryItem[];
  topImportant: MemoryItem[];
  avgHealth: number;
  totalAccess: number;
  sinceDays: number;
  lowHealth: number;         // 低健康度（<40）条数，建议清理
  injectTokenEstimate: number; // 单次注入估算 token（省钱统计）
}

export function buildStats(store: MemoryStore, settings: MemorySettings): MemoryStats {
  const now = Date.now();
  const day = 86400000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = now - 7 * day;

  const tagCount: Record<string, number> = {};
  store.items.forEach((m) => {
    m.tags.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; });
  });
  const tagCloud = Object.keys(tagCount)
    .map((tag) => ({ tag, count: tagCount[tag] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const typeDist = MEMORY_TYPES.map((t) => ({
    type: t.key,
    label: t.labelZh,
    emoji: t.emoji,
    count: store.items.filter((m) => m.type === t.key).length
  }));

  const dueReview = store.items.filter((m) => isReviewDue(m, settings)).length;

  const sortedByAccess = sortItems(store.items, "access").slice(0, 5);
  const sortedByImportance = sortItems(store.items, "importance").slice(0, 5);

  const healthSum = store.items.reduce((s, m) => s + healthScore(m), 0);
  const avgHealth = store.items.length ? Math.round(healthSum / store.items.length) : 0;

  const totalAccess = store.items.reduce((s, m) => s + m.accessCount, 0);
  const sinceDays = store.items.length
    ? Math.max(1, Math.round((now - Math.min(...store.items.map((m) => m.createdAt))) / day))
    : 1;

  const injection = buildInjection(store, settings);
  const injectTokenEstimate = injection ? Math.max(10, Math.round(injection.length / 1.5)) : 0;

  return {
    total: store.items.length,
    expired: store.items.filter((m) => typeof m.expiryAt === "number" && m.expiryAt < now).length,
    pinned: store.items.filter((m) => m.pinned).length,
    todayAdded: store.items.filter((m) => m.createdAt >= startOfToday.getTime()).length,
    weekAdded: store.items.filter((m) => m.createdAt >= startOfWeek).length,
    dueReview,
    typeDist,
    tagCloud,
    topActive: sortedByAccess,
    topImportant: sortedByImportance,
    avgHealth,
    totalAccess,
    sinceDays,
    lowHealth: store.items.filter((m) => healthScore(m) < 40).length,
    injectTokenEstimate
  };
}

/* ---------------- 复习队列 ---------------- */

export function reviewQueue(store: MemoryStore, settings: MemorySettings, limit: number = 10): MemoryItem[] {
  if (!settings.reviewEnabled) return [];
  return store.items
    .filter((m) => isReviewDue(m, settings))
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
    .slice(0, Math.max(1, Math.min(50, limit)));
}

/** 完成一次复习：重置遗忘曲线 */
export function completeReview(item: MemoryItem, settings: MemorySettings): void {
  const now = Date.now();
  item.reviewCount += 1;
  item.lastReviewedAt = now;
  item.nextReviewAt = computeNextReview(item.reviewCount, item.importance, settings.reviewBaseDays, settings.reviewGrowth);
}

/* ---------------- 注入系统提示词 ---------------- */

/* ---------------- 注入系统提示词（省钱引擎：压缩/缓存友好/冷热分级/日期提醒） ---------------- */

/** 提取重要日期（生日/纪念日）：返回 月/日 */
export function extractAnnualDate(content: string): { month: number; day: number } | null {
  const m = String(content || "").match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** 计算距离下次该日期的天数（0=今天） */
function daysUntil(month: number, day: number): number {
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), month - 1, day);
  const diff = Math.ceil((thisYear.getTime() - now.getTime()) / 86400000);
  if (diff >= 0) return diff;
  const nextYear = new Date(now.getFullYear() + 1, month - 1, day);
  return Math.ceil((nextYear.getTime() - now.getTime()) / 86400000);
}

/** 注入缓存（缓存友好模式：文本稳定复用，配合前缀缓存省钱） */
const INJECTION_CACHE_FILE = DATA_DIR + "/injection_cache.json";

export async function loadInjectionCache(): Promise<{ hash: string; text: string } | null> {
  try {
    const res = await Tools.Files.exists(INJECTION_CACHE_FILE);
    if (!res.exists) return null;
    const data = await Tools.Files.read(INJECTION_CACHE_FILE);
    const parsed = JSON.parse(data.content || "{}");
    if (parsed && parsed.hash && typeof parsed.text === "string") return parsed;
    return null;
  } catch (e) {
    return null;
  }
}

export async function saveInjectionCache(hash: string, text: string): Promise<void> {
  try {
    await ensureDir();
    await Tools.Files.write(INJECTION_CACHE_FILE, JSON.stringify({ hash, text }), false);
  } catch (e) {
    // ignore
  }
}

/** 注入缓存 hash：记忆库版本 + 关键设置 + 当前对话 → 文本不变则缓存命中 */
export function injectionCacheHash(store: MemoryStore, settings: MemorySettings, chatId?: string, characterId?: string): string {
  const parts = [
    String(store.updatedAt),
    String(store.items.length),
    String(chatId || ""),
    String(characterId || ""),   // 角色必须进 hash，否则切角色会命中上一角色的缓存
    settings.activeSpace,
    String(settings.injectCount),
    String(settings.injectIncludeDue),
    String(settings.dueRemind),
    String(settings.compactInject),
    String(settings.hotColdSplit),
    String(settings.injectGeneral),
    String(settings.injectSpace),
    String(settings.birthdayRemind),
    String(settings.reviewEnabled),
    String(settings.characterIsolation),
    String(settings.injectGlobalMemory),
    String(settings.injectCharacterMemory),
    String(settings.injectGroupMemory),
    String(settings.promoteGroupUserMemory)
  ];
  return parts.join("|");
}

export function buildInjection(store: MemoryStore, settings: MemorySettings, maxChars: number = 1200, chatId?: string, characterId?: string): string {
  if (!settings.autoInject || store.items.length === 0) return "";
  const now = Date.now();
  // 注入范围：三层过滤 —— 角色隔离 ∩ 对话归属 ∩ 空间
  //   角色：isVisibleToCharacter 统一判定（全局记忆 or 当前角色私域）
  //   对话：通用记忆（chatId 为空，全局共享）∪ 单独记忆（chatId == 当前对话框）
  const curChar = String(characterId || "");
  const scopeItems = store.items.filter((m) => {
    /* v1.2.8：改用 isInjectable，它会额外把「群里用户本人的自述」升格为全局 */
    if (!isInjectable(m, curChar, settings)) return false;
    return (
      (settings.injectGeneral !== false && !m.chatId) ||
      (settings.injectSpace !== false && chatId && m.chatId === chatId)
    );
  });
  const compact = settings.compactInject !== false;
  const contentMax = compact ? 80 : 120;
  const tagMax = compact ? 2 : 4;

  // 冷热分级：热记忆（30 天内访问过或访问≥2）全量；冷记忆仅标题行
  const hotItems = settings.hotColdSplit !== false
    ? scopeItems.filter((m) => now - m.lastAccessAt < 30 * 86400000 || m.accessCount >= 2)
    : scopeItems;
  const coldItems = settings.hotColdSplit !== false
    ? scopeItems.filter((m) => !(now - m.lastAccessAt < 30 * 86400000 || m.accessCount >= 2))
    : [];

  const due = settings.injectIncludeDue
    ? scopeItems.filter((m) => isReviewDue(m, settings)).slice(0, 2)
    : [];
  const picked: MemoryItem[] = [];
  const seen = new Set<string>();
  // 注入总条数上限（修复：原实现只约束了候选填充，pinned+due 可无限挤入）
  const cap = Math.max(1, Number(settings.injectCount) || 3);
  // 置顶记忆优先占位（pinned = 常驻提示）；数量受总上限约束，避免置顶过多把预算吃光
  if (settings.injectPinnedAlways !== false) {
    scopeItems
      .filter((m) => m.pinned === true)
      .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
      .forEach((m) => {
        if (picked.length >= cap) return;
        if (!seen.has(m.id)) { seen.add(m.id); picked.push(m); }
      });
  }
  // 到期复习项占用剩余名额
  due.forEach((m) => {
    if (picked.length >= cap) return;
    if (!seen.has(m.id)) { seen.add(m.id); picked.push(m); }
  });
  const candidates = sortItems(hotItems.filter((m) => !seen.has(m.id)), "importance");
  for (const m of candidates) {
    if (picked.length >= cap) break;
    if (typeof m.expiryAt === "number" && m.expiryAt < now) continue;
    picked.push(m);
  }

  const lines: string[] = [];
  picked.forEach((m) => {
    const t = TYPE_MAP[m.type] || TYPE_MAP["fact"];
    const tagPart = m.tags.length ? " #" + m.tags.slice(0, tagMax).join("#") : "";
    const spacePart = m.space !== "general" ? "[" + m.space + "] " : "";
    const sensPart = m.sensitive ? "🔒" : "";
    if (compact) {
      lines.push(`- ${t.emoji}${m.content.slice(0, contentMax)}${sensPart}${tagPart}`);
    } else {
      const timePart = formatTime(m.createdAt);
      lines.push(`- [${t.emoji}${t.labelZh}|★${m.importance}|${timePart}] ${spacePart}${m.content.slice(0, contentMax)}${sensPart}${tagPart}`);
    }
  });

  // 冷记忆标题行（最多 2 条）
  if (settings.hotColdSplit !== false && coldItems.length) {
    const coldTop = sortItems(coldItems, "importance").slice(0, 2);
    const coldLines = coldTop.map((m) => {
      const t = TYPE_MAP[m.type] || TYPE_MAP["fact"];
      return `${t.emoji}${m.content.slice(0, 16)}…`;
    });
    if (coldLines.length) lines.push(`(更多记忆：${coldLines.join("、")}，需要详情可用 dm_recall 检索)`);
  }

  // 到期/过期提醒（通用 + 当前空间）
  if (settings.dueRemind) {
    const expired = scopeItems.filter((m) => typeof m.expiryAt === "number" && m.expiryAt < now).slice(0, 2);
    const dueSoon = scopeItems.filter((m) => typeof m.expiryAt === "number" && m.expiryAt >= now && m.expiryAt - now <= 86400000).slice(0, 2);
    expired.forEach((m) => lines.push(`⚠️[已过期]${m.content.slice(0, 60)}`));
    dueSoon.forEach((m) => lines.push(`⏰[今日到期]${m.content.slice(0, 60)}`));
  }

  // 重要日期提醒（生日/纪念日，通用 + 当前空间）
  if (settings.birthdayRemind) {
    const dateItems = scopeItems.filter((m) => /(生日|纪念日|周年)/.test(m.content));
    for (const m of dateItems) {
      const d = extractAnnualDate(m.content);
      if (!d) continue;
      const days = daysUntil(d.month, d.day);
      if (days >= 0 && days <= 7) {
        const head = days === 0 ? "🎂今天" : `📅${days}天后`;
        lines.push(`${head}是${m.content.slice(0, 30).replace(/我的|我是|的生日/g, "")}的生日/纪念日（${d.month}月${d.day}日）`);
        break;
      }
    }
  }

  // 冲突提醒
  const conflicts = store.conflicts || [];
  if (conflicts.length) {
    const last = conflicts[conflicts.length - 1];
    lines.push(`⚠️[记忆冲突]${last.newContent.slice(0, 30)} 与旧记忆不一致，可用 dm_conflicts 确认`);
  }

  if (!lines.length) return "";
  const scopeName = (settings.injectGeneral !== false ? "通用" : "") + ((settings.injectGeneral !== false && settings.injectSpace !== false && chatId) ? "+单独" : "") + (settings.injectSpace !== false && chatId ? "" : "");
  const header = compact ? `\n[深度记忆${scopeName ? "·" + scopeName : ""}]` : `\n[深度记忆] 注入范围：${scopeName || "全部"}，当前可能相关的记忆：`;
  // 整行裁剪：超出预算时丢弃整条并告知条数，避免把某条记忆切断成半句
  const assemble = (budget: number) => {
    let out = header;
    let drop = 0;
    for (const ln of lines) {
      if (out.length + 1 + ln.length > budget) { drop++; continue; }
      out += "\n" + ln;
    }
    return { out, drop };
  };
  let r = assemble(maxChars);
  if (r.drop > 0) {
    // 预算不够时：先按字符上限扩容一次（injectBudgetChars），仍不够才提示丢弃
    const bigger = Math.max(maxChars, Number(settings.injectBudgetChars) || 0);
    if (bigger > maxChars) {
      const r2 = assemble(bigger);
      if (r2.drop === 0) return r2.out;
      r = r2;
      maxChars = bigger;
    }
    const note = `\n…（另有 ${r.drop} 条因超出注入预算未显示，可用 dm_recall 检索）`;
    r = assemble(maxChars - note.length);
    r.out += note;
  }
  return r.out.length > maxChars ? r.out.slice(0, maxChars) + "\n…" : r.out;
}

/* ---------------- 图片记忆 ---------------- */

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "avif"];

/** 校验路径是否为图片文件，返回扩展名；非图片返回空 */
export function detectImageExt(path: string): string {
  const m = String(path || "").match(/\.([a-zA-Z0-9]+)$/);
  if (!m) return "";
  const ext = m[1].toLowerCase();
  return IMAGE_EXTS.includes(ext) ? ext : "";
}

/** 复制本地图片进记忆库 images/ 目录，返回相对路径（images/<id>.<ext>）；失败返回空 */
export async function copyImageIntoLibrary(sourcePath: string, id: string): Promise<string> {
  const ext = detectImageExt(sourcePath);
  if (!ext) return "";
  try {
    const dirExists = await Tools.Files.exists(IMAGES_DIR);
    if (!dirExists.exists) await Tools.Files.mkdir(IMAGES_DIR, true);
    const dest = `${IMAGES_DIR}/${id}.${ext}`;
    await Tools.Files.copy(sourcePath, dest, false, "android", "android");
    return `images/${id}.${ext}`;
  } catch (e) {
    return "";
  }
}

/** 把记忆关联的图片复制到导出目录（返回导出的绝对路径） */
export async function copyImageForExport(item: MemoryItem, targetDir: string): Promise<string> {
  if (!item.imagePath) return "";
  try {
    const src = `${DATA_DIR}/${item.imagePath}`;
    const exists = await Tools.Files.exists(src);
    if (!exists.exists) return "";
    const name = item.imagePath.split("/").pop() || "image";
    const dest = `${targetDir}/${name}`;
    await Tools.Files.copy(src, dest, false, "android", "android");
    return dest;
  } catch (e) {
    return "";
  }
}

/* ---------------- 导出导入 bundle（JSON + 图片） ---------------- */

export interface BundleExportResult {
  bundlePath: string;
  memoryCount: number;
  imageCount: number;
}

/** 导出完整记忆包（目录：memories.json + images/），可直接拷贝/压缩分享 */
export async function exportBundle(store: MemoryStore, settings: MemorySettings): Promise<BundleExportResult> {
  const dir = `${EXPORT_DIR}/backup_${Date.now()}`;
  await Tools.Files.mkdir(dir, true);
  // 写 memories.json（含加密）
  const clone: MemoryStore = JSON.parse(JSON.stringify(store));
  encryptStoreItems(clone, settings.encryptKey || "");
  await Tools.Files.write(`${dir}/memories.json`, JSON.stringify(clone, null, 2), false);
  // 复制图片
  const imageDir = `${dir}/images`;
  await Tools.Files.mkdir(imageDir, true);
  const itemsWithImage = clone.items.filter((m) => m.imagePath);
  let imageCount = 0;
  for (const item of itemsWithImage) {
    const src = `${DATA_DIR}/${item.imagePath}`;
    try {
      const exists = await Tools.Files.exists(src);
      if (exists.exists) {
        const name = item.imagePath!.split("/").pop() || "image";
        await Tools.Files.copy(src, `${imageDir}/${name}`, false, "android", "android");
        imageCount++;
      }
    } catch (e) {
      // skip missing image
    }
  }
  // 写入说明
  await Tools.Files.write(
    `${dir}/README.txt`,
    `深度记忆备份\n时间：${formatTime(Date.now())}\n记忆条数：${clone.items.length}\n图片：${imageCount} 张\n恢复：dm_import_bundle(path="此目录或压缩包")`,
    false
  );
  return { bundlePath: dir, memoryCount: clone.items.length, imageCount };
}

export interface BundleImportResult {
  added: number;
  imageCount: number;
}

/** 从 bundle 导入（支持目录或 zip；合并；memories.json 内为加密内容时需密钥） */
export async function importBundle(store: MemoryStore, bundlePath: string, settings: MemorySettings): Promise<BundleImportResult> {
  let baseDir = bundlePath;
  const directExists = await Tools.Files.exists(`${bundlePath}/memories.json`);
  if (!directExists.exists) {
    // 可能是 zip，解压到临时目录
    const tmpDir = `${DATA_DIR}/import_tmp_${Date.now()}`;
    await Tools.Files.mkdir(tmpDir, true);
    try {
      await Tools.Files.unzip(bundlePath, tmpDir, "android");
    } catch (e) {
      return { added: 0, imageCount: 0 };
    }
    baseDir = tmpDir;
  }
  const memRes = await Tools.Files.exists(`${baseDir}/memories.json`);
  if (!memRes.exists) return { added: 0, imageCount: 0 };
  const data = await Tools.Files.read(`${baseDir}/memories.json`);
  const parsed = JSON.parse(data.content || "{}");
  const imported = normalizeStore(parsed);
  decryptStoreItems(imported, settings.encryptKey || "");
  // 复制图片
  let imageCount = 0;
  try {
    const imgDir = `${baseDir}/images`;
    const imgExists = await Tools.Files.exists(imgDir);
    if (imgExists.exists) {
      const listRes = await Tools.Files.list(imgDir);
      const files = (listRes && listRes.entries ? listRes.entries : []).filter((e: any) => !e.isDirectory);
      for (const f of files) {
        const name = String(f.name);
        if (!name) continue;
        const src = `${imgDir}/${name}`;
        const dest = `${IMAGES_DIR}/${name}`;
        const destExists = await Tools.Files.exists(dest);
        if (!destExists.exists) {
          await Tools.Files.copy(src, dest, false, "android", "android");
          imageCount++;
        }
      }
    }
  } catch (e) {
    // ignore
  }
  const existing = new Set(store.items.map((m) => m.id));
  const fresh = imported.items.filter((m) => !existing.has(m.id));
  store.items = fresh.concat(store.items).slice(0, MAX_MEMORIES);
  return { added: fresh.length, imageCount };
}

/* ---------------- 导入导出 ---------------- */

export function exportJson(store: MemoryStore): string {
  return JSON.stringify({ app: "deep_memory", version: 1, exportedAt: Date.now(), items: store.items }, null, 2);
}

export function importJson(store: MemoryStore, raw: string, mode: "merge" | "replace"): { added: number; total: number } {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error("JSON 解析失败");
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : []);
  const imported = list
    .map((it: any) => normalizeItem(it))
    .filter((it: MemoryItem | null): it is MemoryItem => !!it);
  if (!imported.length) return { added: 0, total: store.items.length };

  if (mode === "replace") {
    store.items = imported.slice(0, MAX_MEMORIES);
    return { added: imported.length, total: store.items.length };
  } else {
    const existing = new Set(store.items.map((m) => m.id));
    const fresh = imported.filter((m) => !existing.has(m.id));
    store.items = fresh.concat(store.items).slice(0, MAX_MEMORIES);
    return { added: fresh.length, total: store.items.length };
  }
}