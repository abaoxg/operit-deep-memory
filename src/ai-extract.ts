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

import {
  DATA_DIR,
  TYPE_MAP,
  closeAiSideTasks,
  extractMemoryIntent,
  findRedundant,
  loadSettings,
  loadStore,
  remember,
  saveStore
} from "./memory-core";

const AI_STATE_FILE = `${DATA_DIR}/ai_state.json`;
const AI_LOG_FILE = `${DATA_DIR}/ai_extract.log`;
const MAX_LOG_LINES = 200;

export const DEFAULTS = {
  aiExtract: true,
  aiExtractType: "MEMORY",
  aiExtractFallbackType: "CHAT",
  aiExtractMinLen: 6,
  aiExtractMaxPerHour: 60,
  aiExtractMaxItems: 3,
  aiExtractThinking: false,
  aiExtractRecordUsage: false,
  aiExtractTimeoutMs: 45000,
  // ---- AI 侧记忆（v1.2.4）----
  aiSideExtract: true,
  aiSideMinLen: 24,
  aiSideMaxPerHour: 60,
  aiSideMaxItems: 3,
  // ---- AI 侧记忆质量（v1.2.5）----
  aiSideDedup: true,
  aiSideTaskAutoClose: true,
  aiSideTaskTtlHours: 72
};


export interface AiItem {
  content: string;
  type: string;
  importance: number;
  sensitive: boolean;
  space: string;
}

export interface AiExtractResult {
  aiUsed: boolean;
  skipped?: string;
  functionType?: string;
  remembered: { id: string; content: string; type: string; merged: boolean; importance: number }[];
  parseOk?: boolean;
  error?: string;
  raw?: string;
  forget?: string;
}

/* ---------------- 小工具 ---------------- */

function nowMs(): number { return Date.now(); }

export function hourKey(ts?: number): string {
  const d = new Date(ts || nowMs());
  return `${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}${d.getHours()}`;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

async function readJson(path: string, fallback: any): Promise<any> {
  try {
    const r: any = await (globalThis as any).Tools.Files.read(path);
    const c = r && r.content ? r.content : (typeof r === "string" ? r : "");
    if (c) return JSON.parse(c);
  } catch (e) { /* not exists */ }
  return fallback;
}

async function writeJson(path: string, obj: any): Promise<boolean> {
  try {
    await (globalThis as any).Tools.Files.write(path, JSON.stringify(obj), false);
    return true;
  } catch (e) {
    return false;
  }
}

interface AiState {
  hourKey: string;
  callCount: number;
  totalCalls: number;
  totalRemembered: number;
  totalSkipped: number;
  totalErrors: number;
  lastAt: number;
  lastError: string;
  lastOutcome: string;
  lastItems: any[];
  activeFunctionType: string;
  /* AI 侧独立计数：与用户侧完全分开，避免互相吃掉配额 */
  aiSideHourKey?: string;
  aiSideCallCount?: number;
  aiSideTotalCalls?: number;
  aiSideTotalRemembered?: number;
  aiSideTotalSkipped?: number;
  aiSideLastAt?: number;
  aiSideLastOutcome?: string;
  aiSideLastItems?: any[];
  /* v1.2.7：把「被限流拦下」单独记账，避免与「模型判断无需记忆」混为一谈 */
  aiSideTotalCapped?: number;
  totalCapped?: number;
  /* v1.2.9：本小时已写入条数（配额按这个算，不再按尝试次数） */
  aiSideHourSaved?: number;
}

function emptyState(): AiState {
  return {
    hourKey: "", callCount: 0, totalCalls: 0, totalRemembered: 0,
    totalSkipped: 0, totalErrors: 0, lastAt: 0, lastError: "",
    lastOutcome: "", lastItems: [], activeFunctionType: ""
  };
}

export async function loadState(): Promise<AiState> {
  const s = await readJson(AI_STATE_FILE, null);
  return s && typeof s === "object" ? s as AiState : emptyState();
}

export async function saveState(st: AiState): Promise<void> {
  await writeJson(AI_STATE_FILE, st);
}

async function appendLog(line: string): Promise<void> {
  try {
    let old = "";
    try {
      const r: any = await (globalThis as any).Tools.Files.read(AI_LOG_FILE);
      old = r && r.content ? r.content : (typeof r === "string" ? r : "");
    } catch (e) { old = ""; }
    const rows = old ? old.split("\n").filter(Boolean) : [];
    rows.push(`[${new Date().toLocaleString()}] ${line}`);
    await (globalThis as any).Tools.Files.write(AI_LOG_FILE, rows.slice(-MAX_LOG_LINES).join("\n"), false);
  } catch (e) { /* ignore */ }
}

/* ---------------- 宿主模型调用 ---------------- */

/** 单次模型调用的硬超时。宿主对 hook Promise 没有超时保护，
 *  模型不返回时消息管线会被永久挂住，所以必须在插件侧自己收口。 */
const AI_TIMEOUT_MIN_MS = 3000;
const AI_TIMEOUT_MAX_MS = 300000;

function timeoutMsOf(settings: any): number {
  const n = Number(settings && settings.aiExtractTimeoutMs);
  if (!isFinite(n) || n <= 0) return DEFAULTS.aiExtractTimeoutMs;
  return Math.max(AI_TIMEOUT_MIN_MS, Math.min(AI_TIMEOUT_MAX_MS, Math.floor(n)));
}

/**
 * 给任意 Promise 套一层超时。
 * 超时后 reject TimeoutError（由 callModelCascade 捕获并降级），
 * 底层 Promise 无法真正取消（宿主不提供 abort），但控制权必须交回。
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: any = null;
  const guard = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      const e: any = new Error(`${label} 超时 ${ms}ms`);
      e.__dmTimeout = true;
      reject(e);
    }, ms);
    /* 不要 unref：宿主不是 Node，若存在 polyfill 的 unref 会让看门狗不触发，
       反而失去意义。定时器必须保持活跃直到 fire 或被 clearTimeout 清掉。 */
  });
  return Promise.race([p, guard]).then(
    (v) => { if (timer) clearTimeout(timer); return v; },
    (e) => { if (timer) clearTimeout(timer); throw e; }
  );
}

function chatApi(): any {
  try {
    const g = globalThis as any;
    const T = g && g.Tools ? g.Tools : null;
    if (T && T.Chat && typeof T.Chat.call === "function") return T.Chat;
  } catch (e) { }
  return null;
}

async function callModel(functionType: string, turns: any[], opts?: any): Promise<{ text: string; finishReason: string }> {
  const chat = chatApi();
  if (!chat) throw new Error("Tools.Chat.call 不可用");
  const o = opts || {};
  const payload: any = { functionType: String(functionType || "CHAT"), turns };
  if (o.recordTokenUsage !== undefined) payload.recordTokenUsage = !!o.recordTokenUsage;
  if (o.enableThinking !== undefined) payload.enableThinking = !!o.enableThinking;
  const res = await withTimeout<any>(
    Promise.resolve().then(() => chat.call(payload)),
    o.timeoutMs && o.timeoutMs > 0 ? o.timeoutMs : DEFAULTS.aiExtractTimeoutMs,
    `Chat.call(${String(functionType || "CHAT")})`
  );
  if (!res) throw new Error("模型返回空");
  const text = str(res.text).trim();
  if (!text) {
    if (str(res.finishReason) === "tool_call") throw new Error("模型返回 tool_call 而非文本");
    throw new Error("模型返回空文本");
  }
  return { text, finishReason: str(res.finishReason) };
}

async function callModelCascade(turns: any[], settings: any): Promise<{ ok: boolean; text?: string; functionType?: string; error?: string; tried?: string[] }> {
  const primary = str(settings.aiExtractType || DEFAULTS.aiExtractType).trim() || "MEMORY";
  const fallback = str(settings.aiExtractFallbackType || DEFAULTS.aiExtractFallbackType).trim() || "CHAT";
  const opts = {
    enableThinking: settings.aiExtractThinking === true,
    recordTokenUsage: settings.aiExtractRecordUsage === true
  };
  const tried: string[] = [];
  let lastErr: any = null;
  /* 总预算：主通道 + 降级通道共享，避免「MEMORY 卡住 + CHAT 再卡一次」
     把 hook 拖到两倍超时。先算出要尝试的通道数，再按剩余时间均分。 */
  const totalBudget = timeoutMsOf(settings);
  const deadline = Date.now() + totalBudget;
  const queue: string[] = [];
  for (const ft of [primary, fallback]) {
    if (ft && queue.indexOf(ft) < 0) queue.push(ft);
  }
  for (let i = 0; i < queue.length; i++) {
    const ft = queue[i];
    const remain = deadline - Date.now();
    if (remain <= 200) {
      await appendLog(`预算耗尽，跳过 functionType=${ft}`);
      break;
    }
    const slots = queue.length - i;
    /* 按剩余通道数均分：每个通道最多吃掉「剩余时间 - 给后续通道预留的下限」。
       只在第一个通道就用满总预算，会导致降级通道完全没有时间，
       实测就是这样漏掉 CHAT 的（MEMORY 吃满 3000ms，CHAT 直接没机会）。 */
    const reserve = (slots - 1) * AI_TIMEOUT_MIN_MS;
    const share = Math.floor((remain - reserve) / slots);
    const useMs = Math.max(AI_TIMEOUT_MIN_MS, Math.min(remain, share));
    tried.push(ft);
    try {
      const r = await callModel(ft, turns, { ...opts, timeoutMs: useMs });
      return { ok: true, text: r.text, functionType: ft };
    } catch (e: any) {
      lastErr = e;
      const timedOut = !!(e && e.__dmTimeout);
      await appendLog(`调用失败 functionType=${ft}${timedOut ? `（超时 ${useMs}ms）` : ""}: ${str(e && e.message || e)}`);
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

/* ================= AI 侧记忆（v1.2.4）=================
 * 只记用户说的话，会导致记忆库「只记住你是谁，没记住我们做到哪」。
 * 这条提示词与用户侧完全独立：主语是 AI，目标是行动、待办、决策与结论。
 */
const AI_SIDE_PROMPT = [
  "你是「对话记忆整理器」。从这段 AI 回复里提取值得长期记住的信息，只输出一个 JSON，不要解释、不要 markdown 代码块。",
  "",
  "【最重要的一条】记「人和事」，不记「我干了什么活」。",
  "这些记忆会在几十轮之后被重新读到，用来更好地理解用户、接上之前的话题；",
  "写进去一句「AI 已完成打包，md5 为 xxx」，几十轮后毫无用处，还会把真正重要的信息挤出窗口。",
  "",
  "【应该记住】",
  "1. 关于用户的事实：身份、职业、家庭、设备、环境、所在地、身体状况、作息",
  "2. 用户的偏好与习惯：说话风格、决策方式、禁忌、明确表示不喜欢的东西",
  "3. 用户的决策、授权与边界：同意了、否决了、定了新约定、划了红线",
  "4. 用户提到的长期目标、困扰与在办的事：他卡在哪、想解决什么、下一步要做什么",
  "5. 重要事件的结论：发生了什么事、结果如何、对以后有什么影响",
  "",
  "【不应该记住 · 一律跳过】",
  "1. AI 自己的操作过程与工程流水：改了哪个文件、跑了什么命令、打包了什么产物、",
  "   校验了多少字节、md5 是多少、第几行、编译通过没有、测试多少项通过 ——",
  "   这些是过程日志，不是记忆，全部跳过。",
  "2. 寒暄、过渡句、语气词、「好的」「继续」类应答",
  "3. 复述代码、日志、命令输出、大段原文本身",
  "4. AI 对自己能力的自我描述（「我可以帮你…」「我能做到…」）",
  "5. 纯推测、未验证的猜想",
  "6. 任何密码、令牌、密钥的明文值（只记「已配置」不记值）",
  "",
  "【去重】多条说同一件事只留信息量最大的一条，不要拆成多条。",
  "",
  "【字段规则】",
  "- content：主语是「用户」或事件本身；不要以「AI」开头；不要写「已完成/已部署/已修复」这类流水句。长度 8-120 字",
  "- type：身份与环境用 fact；偏好习惯用 preference；发生过的事用 event；关系用 relation；结论教训用 idea；确实未完成的待办用 task",
  "- importance：安全边界/授权变更/长期身份=5；偏好与重要事件=4；一般事实=3；细节=2",
  "- sensitive：涉及地址/账号/证件等为 true（不写具体值）",
  "- space：工作 / 生活 / 学习 / general",
  "",
  "【输出格式】",
  '{"remember":true,"items":[{"content":"用户做网络运维，家里用某品牌 AX 路由器，管理地址 192.168.1.1","type":"fact","importance":4,"sensitive":false,"space":"工作"}]}',
  '没有值得记的信息时输出：{"remember":false,"items":[]}',
  "",
  "【禁止】不要输出 forget 字段，遗忘只能由用户侧发起。"
].join("\n");

/** AI 回复通常很长，结论往往在头尾。头部给上下文，尾部给结论。 */
function sampleForAiSide(t: string): string {
  const s = str(t);
  if (s.length <= 4000) return s;
  const head = s.slice(0, 1200);
  const tail = s.slice(-2700);
  return head + "\n…（中间省略 " + (s.length - 3900) + " 字）…\n" + tail;
}

function buildTurns(text: string, side?: string): any[] {
  return [
    { kind: "SYSTEM", content: side === "ai" ? AI_SIDE_PROMPT : SYSTEM_PROMPT },
    { kind: "USER", content: text }
  ];
}

/* ---------------- 解析 ---------------- */

function parseJsonLoose(raw: string): any {
  let t = str(raw).trim();
  if (!t) return null;
  t = t.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```\s*$/g, "").trim();
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch (e) { return null; } };
  const v = tryParse(t);
  if (v) return v;
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  return tryParse(t.slice(start, end + 1));
}

const VALID_TYPES = ["fact", "preference", "event", "relation", "idea", "task"];
const VALID_SPACES = ["general", "工作", "生活", "学习"];

function clampImp(v: unknown, dflt: number): number {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeItem(raw: any, settings: any): AiItem | null {
  if (!raw || typeof raw !== "object") return null;
  let content = str(raw.content).replace(/\s+/g, " ").trim();
  if (content.length < 4) return null;
  if (content.length > 200) content = content.slice(0, 200);
  let type = str(raw.type).toLowerCase().trim();
  if (VALID_TYPES.indexOf(type) < 0) type = "fact";
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

function shouldSkipByRule(text: string, settings: any, side?: string): string {
  const t = str(text).trim();
  const isAiSide = side === "ai";
  const minLen = isAiSide
    ? Math.max(2, Number(settings.aiSideMinLen) || DEFAULTS.aiSideMinLen)
    : Math.max(2, Number(settings.aiExtractMinLen) || DEFAULTS.aiExtractMinLen);
  if (!t) return "空消息";
  /* v1.2.8 元记忆过滤：AI 侧最容易把「我自己的干活流水」当成记忆存进去。
     实测 195 条里 98 条是「AI 已…/已部署/已打包/md5 为…」，
     它们不是关于用户的长期知识，纯占预算，还把真正的用户信息挤出注入窗口。
     判据 = 自指（AI/助手/我）+ 动作（已将/已修复/跑完/通过…）+ 工程痕迹三件套；
     缺工程痕迹时按长度兜底，三者缺一不拦，避免误杀「用户已装 Termux，常用 /sdcard」。
     必须放在长度门槛之前：否则短流水会被报成「太短」，掩盖真实原因。 */
  if (isAiSide) {
    /* SELF 覆盖三种真实写法：「AI 已…」「AI查明…」（动词直接贴住，无空格）「AI 的…」 */
    const SELF = /(^|[\s，。；：、])(AI|助手)([\s，。；：、]|已|在|把|对|将|要|准备|刚刚|查|确|发|做|写|修|改|建|新|跑|验|核|复|重|生|编|部|备|删|创|加|移|换|补|清|记|列|统|整|判|选|定|$)|(^|[\s，。；：、])(AI|助手)的|^我/;
    const ACTION = /(已[确认完成部署打包修改修复新增重做核对清理写入更新生成保存通过补齐落盘就位将复制同步比对替换执行运行验证检查安装上传下载备份删除创建]|已经|刚刚|跑完|编译通过|测试通过|回归通过|全绿|重新打包|重新部署)/;
    const ARTIFACT = /(toolpkg|md5|tsc|grep|dist\/|\.ts\b|\.js\b|\.py\b|toolpkg_cache|logcat|am broadcast|sdcard\/|data\/data\/|字节|行号|锚点|断言|接口签名|字段名)/;
    const EXEC_STRONG = /(已完成|已部署|已打包|已修复|已修改|已更新|已生成|已保存|已落盘|已就位|跑完|编译通过|测试通过|回归通过|全绿|重新打包|重新部署)/;
    /* 主语是用户/他/她时，讲的就不是「我干了什么」，不能按自述流水处理。
       这道闸防止「用户要求 AI 把文件放到 /sdcard」被误杀。 */
    const USER_SUBJECT = /^(用户|他|她|对方|大家)/;
    const FLOW = "操作流水（AI 自身工作记录，非用户信息）";
    /* 「AI 的 v1.2.8 校验中仍有 1 项失败」这类没有动作词的纯自指记录，也要拦 */
    if (!USER_SUBJECT.test(t) && SELF.test(t) && ARTIFACT.test(t)) return FLOW;
    if (!USER_SUBJECT.test(t)) {
      /* 实测：存量 138 条漏网样本都是这个形态 —— 有 AI 自指 + 工程痕迹，但没有强执行动词
         （「AI 新建了 .tmp_test_fallback.js」「AI 在 dm_work2 核实 memory-core.ts」）。
         对 AI 侧而言，自指 + 工程痕迹已经足以判定为流水。 */
      if (SELF.test(t) && ARTIFACT.test(t)) return FLOW;
      if (SELF.test(t) && ACTION.test(t) && t.length < 200) return FLOW;
    }
    if (EXEC_STRONG.test(t) && ARTIFACT.test(t) && !USER_SUBJECT.test(t)) return FLOW;
  }
  // 用户侧「记住/忘了」不受长度门槛限制；AI 侧没有这种豁免
  if (t.length < minLen && !(!isAiSide && /记住|忘了/.test(t))) return "太短";
  if (/^[\s\p{P}\p{S}]+$/u.test(t)) return "纯符号";
  if (/^(好|好的|嗯|哦|行|可以|收到|继续|ok|okay|谢谢|多谢|你好|在吗|1|2|3)[。！!.~]*$/i.test(t)) return "寒暄确认";
  if (!isAiSide && /^```/.test(t)) return "代码块";
  // AI 侧常见整段代码/日志/JSON：没有中文基本不可能含有效结论，跳过省一次模型调用
  if (isAiSide && !/[\u4e00-\u9fa5]/.test(t)) return "无中文（多半是代码或日志）";
  // AI 侧不做「过长」跳过：走 sampleForAiSide 头尾取样
  if (!isAiSide && t.length > 4000) return "过长";
  return "";
}

async function bumpState(st: AiState, patch?: Record<string, any>): Promise<void> {
  Object.keys(patch || {}).forEach((k) => { (st as any)[k] = (patch as any)[k]; });
  st.lastAt = nowMs();
  await saveState(st);
}

export async function aiExtractMessage(text: string, chatId?: string, settings?: any, characterId?: string, characterName?: string, side?: string, scopeInfo?: any): Promise<AiExtractResult> {
  const s = settings || await loadSettings();
  const out: AiExtractResult = { aiUsed: false, remembered: [] };
  const isAiSide = side === "ai";
  const st = await loadState();
  const hk = hourKey();
  /* 计数器分流：AI 侧与用户侧各自记账，面板能分别看出「记了你说的话」和「记了我做的事」 */
  const markSkipped = (msg: string) => {
    out.skipped = msg;   // v1.2.5：跳过原因要往上传，否则外层只能一律报「无需记忆」
    /* v1.2.7：区分「被限流拦下」与「模型判断无需记忆」，否则配额问题会被伪装成判断问题 */
    /* v1.2.9：限流文案改成「本小时已记满」后，这里必须同时认两种说法，
       否则新文案会被当成普通跳过，capped 永远为 0，面板上看不出被限过流。 */
    const isCap = msg.indexOf("每小时上限") >= 0 || msg.indexOf("本小时已记满") >= 0;
    if (isAiSide) {
      st.aiSideTotalSkipped = (st.aiSideTotalSkipped || 0) + 1;
      if (isCap) st.aiSideTotalCapped = (st.aiSideTotalCapped || 0) + 1;
      st.aiSideLastOutcome = msg;
      st.aiSideLastItems = [];
      st.aiSideLastAt = nowMs();
    } else {
      st.totalSkipped = (st.totalSkipped || 0) + 1;
      if (isCap) st.totalCapped = (st.totalCapped || 0) + 1;
      st.lastOutcome = msg;
      st.lastItems = [];
    }
  };
  /* v1.2.7：前置跳过（开关关闭 / 规则拦掉）同样要记账并落盘，
     否则面板上永远只显示 lastOutcome，看不出到底哪一步在丢消息 */
  if (isAiSide) {
    if (s.aiSideExtract === false) { markSkipped("AI 侧记忆已关闭"); await bumpState(st); return out; }
  } else if (s.aiExtract === false) { markSkipped("AI 提取已关闭"); await bumpState(st); return out; }
  const ruleSkip = shouldSkipByRule(text, s, side);
  if (ruleSkip) { markSkipped(ruleSkip); await bumpState(st); return out; }
  const markRemembered = (rows: any[], msg: string) => {
    if (isAiSide) {
      st.aiSideTotalRemembered = (st.aiSideTotalRemembered || 0) + rows.length;
      /* v1.2.9：真正写进库才消耗配额 */
      st.aiSideHourSaved = (st.aiSideHourSaved || 0) + rows.length;
      st.aiSideLastOutcome = msg;
      st.aiSideLastItems = rows.slice(0, 5);
      st.aiSideLastAt = nowMs();
    } else {
      st.totalRemembered = (st.totalRemembered || 0) + rows.length;
      st.lastOutcome = msg;
      st.lastItems = rows.slice(0, 5);
    }
  };
  /* 两侧配额完全独立：AI 回复量大，若共用计数器会把你这条消息的额度吃掉 */
  const cap = isAiSide
    ? Math.max(1, Number(s.aiSideMaxPerHour) || DEFAULTS.aiSideMaxPerHour)
    : Math.max(1, Number(s.aiExtractMaxPerHour) || DEFAULTS.aiExtractMaxPerHour);
  if (isAiSide) {
    if (st.aiSideHourKey !== hk) {
      st.aiSideHourKey = hk;
      st.aiSideCallCount = 0;
      st.aiSideHourSaved = 0;
    }
    /* v1.2.9：配额只算「真正写入的记忆条数」，不再限制尝试次数。
       实测教训：v1.2.8 用尝试次数计配额时，AI 连续输出工具日志，
       3 分钟内就把 60 次额度刷满，此后一小时用户真正说的话一条也记不进来 ——
       配额本该防止刷屏，结果拦住了真正重要的信息。
       现在规则能拦掉的流水根本不计额度，只有写进库才扣。 */
    const savedThisHour = st.aiSideHourSaved || 0;
    if (savedThisHour >= cap) {
      markSkipped(`AI 侧本小时已记满 ${cap} 条，剩余时间仅做规则过滤（不消耗额度）`);
      await bumpState(st);
      return out;
    }
  } else {
    if (st.hourKey !== hk) { st.hourKey = hk; st.callCount = 0; }
    if (st.callCount >= cap) {
      markSkipped(`已达每小时上限 ${cap} 次`);
      await bumpState(st);
      return out;
    }
  }
  const t = isAiSide ? sampleForAiSide(str(text)) : str(text).slice(0, 4000);
  if (isAiSide) {
    /* 尝试次数只做观测，不再当配额用（见上方 v1.2.9 说明） */
    st.aiSideCallCount = (st.aiSideCallCount || 0) + 1;
    st.aiSideTotalCalls = (st.aiSideTotalCalls || 0) + 1;
  } else {
    st.callCount = (st.callCount || 0) + 1;
    st.totalCalls = (st.totalCalls || 0) + 1;
  }
  const res = await callModelCascade(buildTurns(t, side), s);
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

  if (parsed.forget && str(parsed.forget.keyword).trim() && s.quickForget !== false && !isAiSide) {
    out.forget = str(parsed.forget.keyword).trim();
    st.lastOutcome = `遗忘：${out.forget}`;
    await bumpState(st);
    await appendLog(`AI 遗忘：${out.forget}（${res.functionType}）`);
    return out;
  }

  if (parsed.remember !== true) {
    markSkipped("AI 判定：无需记忆");
    await bumpState(st);
    // 成功路径也要留痕：否则出问题时无法区分“AI 说不用记”和“根本没调”
    await appendLog(`AI 判定无需记忆（${res.functionType}${isAiSide ? "/AI侧" : ""}，${t.length}字）`);
    return out;
  }

  const maxItems = isAiSide
    ? Math.max(1, Number(s.aiSideMaxItems) || DEFAULTS.aiSideMaxItems)
    : Math.max(1, Number(s.aiExtractMaxItems) || DEFAULTS.aiExtractMaxItems);
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .slice(0, maxItems)
    .map((x: any) => normalizeItem(x, s))
    .filter(Boolean)
    .filter((it: any) => {
      /* AI 侧防串味：模型偶尔会退化成用户视角，把自己的活记成用户的事
         （「用户已完成打包部署」）。v1.2.8 之后 AI 侧的正当产出恰恰是关于用户的事实，
         因此不能再按「用户开头」一刀切，只在「动作 + 工程痕迹」同时出现时才丢弃。 */
      const c = str(it.content);
      if (isAiSide && /^用户/.test(c) &&
          /(已完成|已部署|已打包|已修复|已修改|已更新|已生成|已保存|已落盘|已就位|跑完|编译通过|回归通过|全绿)/.test(c)) {
        appendLog("AI 侧条目把 AI 的活记成用户的事，已丢弃：" + c.slice(0, 40));
        return false;
      }
      return true;
    }) as AiItem[];
  if (!items.length) {
    markSkipped("AI 判定：无需记忆（条目无效）");
    await bumpState(st);
    await appendLog(`AI 判定条目无效（${res.functionType}${isAiSide ? "/AI侧" : ""}）`);
    return out;
  }

  const store = await loadStore();
  const targetChatId = s.autoExtractChat === true && chatId ? chatId : undefined;
  // 角色归属：开启自动打角色且当前确实有角色时，记忆落到该角色名下
  /* v1.2.8：有 scopeInfo 时以它为准。
     scope==="global" 时 characterId 必须为空——
     否则「用户本人在群里说的话」会被绑到群作用域，回单聊就查不到
     （这是用户画像断裂的根因）。 */
  const si: any = scopeInfo || null;
  const targetCharId = si && si.scope !== undefined
    ? (si.scope === "global" ? undefined : (si.characterId || undefined))
    : (s.characterAutoTag !== false && characterId ? characterId : undefined);
  const brief: string[] = [];
  const dedupSkipped: string[] = [];
  for (const it of items) {
    // v1.2.5 语义去重：AI 侧只记结论，同一件事换种说法不该再写一条
    if (isAiSide && s.aiSideDedup !== false) {
      const dup = findRedundant(store, it.content, { type: it.type, characterId: targetCharId });
      if (dup) {
        dedupSkipped.push(it.content.slice(0, 40));
        await appendLog("AI 侧重复已跳过：" + it.content.slice(0, 50));
        continue;
      }
    }
    try {
      const r = await remember(store, {
        content: it.content,
        type: it.type,
        importance: it.importance,
        source: isAiSide ? "ai-action" : "ai",
        sensitive: it.sensitive,
        space: it.space,
        chatId: targetChatId,
        characterId: targetCharId,
        characterName: targetCharId ? characterName : undefined,
        /* v1.2.8：发言人 + 显式作用域，群聊记忆不再是无主句 */
        speaker: si ? si.speaker : undefined,
        speakerId: si ? si.speakerId : undefined,
        scope: si ? si.scope : undefined
      } as any, s);
      if (r.conflicts && r.conflicts.length) {
        store.conflicts = (store.conflicts || []).concat(r.conflicts).slice(-10);
      }
      out.remembered.push({
        id: r.item.id, content: r.item.content, type: r.item.type,
        merged: r.merged, importance: r.item.importance
      });
      brief.push(`${r.merged ? "更新" : "新增"}「${r.item.content.slice(0, 30)}」`);
    } catch (e: any) {
      await appendLog(`写入失败：${str(e && e.message || e)}`);
    }
  }
  let closeChanged = 0;
  // v1.2.5 待办结案：AI 侧一次性待办完成后必须消失，否则会被注入成「还没做完」
  if (isAiSide) {
    try {
      const closeRes = closeAiSideTasks(store, s);
      closeChanged = closeRes.closed.length + closeRes.expired.length;
      if (closeRes.closed.length) {
        await appendLog("AI 侧待办自动结案：" + closeRes.closed.length + " 条已完成待办已移除");
      }
      if (closeRes.expired.length) {
        await appendLog("AI 侧待办超时过期：" + closeRes.expired.length + " 条");
      }
    } catch (e: any) {
      await appendLog("待办结案失败：" + str(e && e.message || e));
    }
    if (dedupSkipped.length) {
      await appendLog("AI 侧去重共跳过 " + dedupSkipped.length + " 条重复");
    }
  }
  if (out.remembered.length) {
    await saveStore(store);
    markRemembered(out.remembered, `记忆 ${out.remembered.length} 条`);
    await appendLog(`AI(${res.functionType}${isAiSide ? "/AI侧" : ""}) 命中：${brief.join("；")}`);
  } else if (closeChanged > 0) {
    await saveStore(store);
    markSkipped("本轮无新记忆，已结案 " + closeChanged + " 条待办");
  } else if (dedupSkipped.length > 0 && out.remembered.length === 0) {
    // 全部因重复被跳过：这不是错误，是去重生效
    markSkipped("全部重复，已跳过 " + dedupSkipped.length + " 条");
  } else {
    markSkipped("写入全部失败");
  }
  await bumpState(st);
  return out;
}

/** 先 AI 判定，失败/关闭时降级正则；返回 ToolResult 结构 */
export async function aiExtractText(text: string, chatId?: string, characterId?: string, characterName?: string, side?: string, scopeInfo?: any): Promise<any> {
  const s = await loadSettings();
  const isAiSide = side === "ai";
  let res: AiExtractResult | null = null;
  try {
    res = await aiExtractMessage(text, chatId, s, characterId, characterName, side, scopeInfo);
  } catch (e: any) {
    res = { aiUsed: false, remembered: [], error: str(e && e.message || e) };
  }

  if (res && res.aiUsed && res.parseOk && res.remembered.length === 0 && res.forget === undefined) {
    const whySkip = res.skipped ? String(res.skipped) : "AI 判定无需记忆";
    return { success: true, message: whySkip.indexOf("AI 判定") === 0 ? whySkip : ("AI 侧未记录（" + whySkip + "）"), data: { matched: false, by: "ai", side: side || "user" } };
  }
  if (res && res.forget) {
    const dm = require("./packages/deep_memory");
    const fr = await dm.dm_forget({ keyword: res.forget });
    return { success: true, message: `AI 遗忘「${res.forget}」→ ${fr.message}`, data: { matched: true, kind: "forget", by: "ai" } };
  }
  if (res && res.remembered.length) {
    const first = res.remembered[0];
    const ti: any = (TYPE_MAP as any)[first.type] || (TYPE_MAP as any)["fact"];
    const head = res.remembered.length > 1 ? `AI 记住 ${res.remembered.length} 条：` : "AI 已记忆：";
    return {
      success: true,
      message: head + `${ti.emoji}${ti.labelZh}「${first.content.slice(0, 60)}」`,
      data: { matched: true, by: "ai", side: side || "user", items: res.remembered, functionType: res.functionType || "" }
    };
  }
  /* AI 侧到此为止：正则兜底是为用户句式（我叫/我喜欢/记住）写的，
     套用到 AI 回复上会把「我已完成…」误判成用户自述，因此不降级。 */
  if (isAiSide) {
    const why = res && (res.skipped || res.error) ? (res.skipped || res.error) : "无有效条目";
    return { success: true, message: `AI 侧未记录（${why}）`, data: { matched: false, by: "ai", side: "ai" } };
  }
  const intent = extractMemoryIntent(text);
  if (!intent) return { success: true, message: "未命中（AI 与正则均无）", data: { matched: false, by: "regex" } };
  if (intent.kind === "forget") {
    const dm = require("./packages/deep_memory");
    const fr = await dm.dm_forget({ keyword: intent.content });
    return { success: true, message: `已执行快捷遗忘：「${intent.content}」→ ${fr.message}`, data: { matched: true, kind: "forget", by: "regex" } };
  }
  const store = await loadStore();
  const targetChatId = s.autoExtractChat === true && chatId ? chatId : undefined;
  /* v1.2.8：兜底链路同样按 scopeInfo 定归属，否则两条链路写入归属不一致 */
  const si2: any = scopeInfo || null;
  const targetCharId = si2 && si2.scope !== undefined
    ? (si2.scope === "global" ? undefined : (si2.characterId || undefined))
    : (s.characterAutoTag !== false && characterId ? characterId : undefined);
  const r = await remember(store, {
    content: intent.content,
    type: intent.type,
    importance: intent.importance,
    source: "auto",
    sensitive: intent.sensitive,
    chatId: targetChatId,
    characterId: targetCharId,
    characterName: targetCharId ? characterName : undefined,
    /* v1.2.8：兜底链路同样带发言人，否则同一条消息走不同链路归属会不一致 */
    speaker: si2 ? si2.speaker : undefined,
    speakerId: si2 ? si2.speakerId : undefined,
    scope: si2 ? si2.scope : undefined
  } as any, s);
  if (r.conflicts && r.conflicts.length) {
    store.conflicts = (store.conflicts || []).concat(r.conflicts).slice(-10);
  }
  await saveStore(store);
  const ti: any = (TYPE_MAP as any)[r.item.type] || (TYPE_MAP as any)["fact"];
  return {
    success: true,
    message: `已自动记忆（正则兜底）：${ti.emoji}${ti.labelZh}「${r.item.content.slice(0, 60)}」`,
    data: { matched: true, by: "regex", id: r.item.id }
  };
}

/**
 * hook 侧看门狗触发时调用：记一次错误并留痕。
 * 为什么需要：模型侧超时会被 callModelCascade 捕获并降级；但如果卡在
 * 文件 IO、解析或 remember 写入等其它环节，只有外层看门狗能兜住，
 * 这时必须留下可见痕迹，否则面板上只看到「没反应」。
 */
export async function aiRecordHookTimeout(ms: number, note?: string): Promise<void> {
  try {
    const st = await loadState();
    st.totalErrors = (st.totalErrors || 0) + 1;
    st.lastError = `hook 看门狗超时 ${ms}ms` + (note ? `（${note}）` : "");
    st.lastOutcome = "hook 超时，已放弃本次判定";
    await bumpState(st);
    await appendLog(`hook 看门狗触发：${ms}ms 未返回，放弃本次判定${note ? " " + note : ""}`);
  } catch (e) { /* ignore */ }
}

export async function aiStatus(): Promise<any> {
  const s = await loadSettings();
  const st = await loadState();
  const chat = chatApi();
  let logTail = "";
  try {
    const r: any = await (globalThis as any).Tools.Files.read(AI_LOG_FILE);
    const c = r && r.content ? r.content : (typeof r === "string" ? r : "");
    logTail = c.split("\n").filter(Boolean).slice(-8).join("\n");
  } catch (e) { }
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
    /* AI 侧（v1.2.4）独立面板字段 */
    aiSideEnabled: s.aiSideExtract !== false,
    aiSideHourQuotaUsed: st.aiSideHourKey === hourKey() ? (st.aiSideCallCount || 0) : 0,
    aiSideHourQuotaCap: Math.max(1, Number(s.aiSideMaxPerHour) || DEFAULTS.aiSideMaxPerHour),
    aiSideTotalCalls: st.aiSideTotalCalls || 0,
    aiSideTotalRemembered: st.aiSideTotalRemembered || 0,
    aiSideTotalSkipped: st.aiSideTotalSkipped || 0,
    aiSideTotalCapped: st.aiSideTotalCapped || 0,
    totalCapped: st.totalCapped || 0,
    aiSideLastAt: st.aiSideLastAt || 0,
    aiSideLastOutcome: st.aiSideLastOutcome || "",
    aiSideLastItems: st.aiSideLastItems || [],
    aiSideMinLen: Number(s.aiSideMinLen) || DEFAULTS.aiSideMinLen,
    logTail,
    minLen: Number(s.aiExtractMinLen) || DEFAULTS.aiExtractMinLen,
    maxItems: Number(s.aiExtractMaxItems) || DEFAULTS.aiExtractMaxItems,
    timeoutMs: timeoutMsOf(s),
    settings: s
  };
}

export async function aiResetState(): Promise<any> {
  const st = emptyState();
  st.hourKey = hourKey();
  await saveState(st);
  return { success: true };
}

export async function aiProbe(): Promise<any> {
  const s = await loadSettings();
  const testText = "记住：我的测试暗号是 7788，我是做网络运维的。";
  const res = await callModelCascade(buildTurns(testText), s);
  if (!res.ok) return { ok: false, error: res.error, tried: res.tried };
  const parsed = parseJsonLoose(res.text || "");
  return {
    ok: true,
    functionType: res.functionType,
    raw: (res.text || "").slice(0, 600),
    parseOk: !!parsed,
    parsed: parsed || null
  };
}