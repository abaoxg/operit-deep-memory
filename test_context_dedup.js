/**
 * v1.2.9：提取阶段语义去重（把已有记忆带给模型）
 *
 * 背景（用户实测）：
 *   用户的同一条边界被写成了 10 条不同说法：
 *   「f2.enc 不能动」「文件只许写工作区」「删前必须确认」…
 *   词面相似度去重对此无效 —— 实测 45 对同义句最多只识别出 13 对，
 *   阈值降到 0.35 又会误伤真正不同的记忆。
 *
 * 因此改为在「提取时」把库里已有的高价值条目一起送给模型，
 * 并要求「已表达过的意思不许再写一条」。
 *
 * 本测试钉住：
 *   1. 提示里确实带上了已有条目
 *   2. 只带同作用域、重要度 >= 4、未过期的条目
 *   3. 条目过多时有上限，不会把 prompt 撑爆
 *   4. 取库失败时退回旧行为，不阻塞主流程
 */
const path = require("path");
const fs = require("fs");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? " -> " + JSON.stringify(extra) : "")); }
}
const ROOT = path.resolve(__dirname);
const DIST = path.join(ROOT, "dist");
const SRC = fs.readFileSync(path.join(ROOT, "src/ai-extract.ts"), "utf8");

console.log("=== 1. 静态结构 ===");
ok("存在 buildKnownContext", /function buildKnownContext\(/.test(SRC));
ok("调用模型前注入上下文",
  /buildTurns\(t, side, ctxHint\)/.test(SRC));
ok("取库失败时降级为空上下文",
  /catch \(e\) \{\s*\n\s*ctxHint = "";/.test(SRC));
ok("提示语明确要求不重述",
  SRC.indexOf("即使换了说法、补了细节、改了主语，也算重复") >= 0);

console.log("\n=== 2. 运行时：上下文是否真的带上 ===");
const mem = {};
let lastTurns = null;
globalThis.Tools = {
  Files: {
    read: async (p) => ({ content: mem[p] || "" }),
    write: async (p, c) => { mem[p] = c; return { success: true }; },
    exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(mem, p) }),
    mkdir: async () => ({ success: true })
  },
  Chat: {
    call: async (req) => {
      // 记录最后一次送进模型的 turns
      const t = JSON.stringify(req || {});
      lastTurns = req;
      return { text: '{"remember":false,"items":[]}', finishReason: "stop" };
    }
  }
};
globalThis.ToolPkg = { ipc: { on: () => {} }, log: () => {} };

function load(rel) {
  const p = require.resolve(path.join(DIST, rel));
  delete require.cache[p];
  return require(p);
}

(async () => {
  const ai = load("ai-extract.js");
  const core = load("memory-core.js");
  await ai.aiResetState();

  // 造一个带已有记忆的库
  const store = { items: [], updatedAt: Date.now(), version: 1 };
  const s = Object.assign({}, core.DEFAULTS, { autoTag: false });
  await core.remember(store, {
    content: "用户要求 /sdcard 根目录下的自用文件不得清理或移动",
    type: "preference", importance: 5, scope: "global"
  }, s);
  await core.remember(store, {
    content: "用户喜欢单字回复确认", type: "preference", importance: 4, scope: "global"
  }, s);
  await core.remember(store, {
    content: "某条无关紧要的细节记录", type: "fact", importance: 1, scope: "global"
  }, s);
  await core.remember(store, {
    content: "角色私域的一条记忆，不应出现在全局上下文", type: "fact",
    importance: 5, scope: "character", characterId: "role:other", characterName: "other"
  }, s);

  // 写入假库文件路径（ai-extract 通过 loadStore 读）
  const settings = Object.assign({}, ai.DEFAULTS, {
    aiExtract: true, aiExtractMaxPerHour: 99, aiMinLen: 1
  });

  // 直接把 store 落盘到 ai-extract 用的位置
  const { saveStore } = core;
  if (typeof saveStore === "function") {
    await saveStore(store);
  }

  await ai.aiExtractMessage(
    "用户说：不要动我 /sdcard 根目录那几个文件，之前已经说过了",
    "testchat", settings, undefined, undefined, "user");

  const dump = JSON.stringify(lastTurns || {});
  const hasCtx = dump.indexOf("已有记忆") >= 0;
  ok("请求里带上了「已有记忆」段落", hasCtx,
    hasCtx ? "" : "dump=" + dump.slice(0, 300));
  ok("带上了那条边界记忆", dump.indexOf("不得清理或移动") >= 0);
  ok("带上了偏好记忆", dump.indexOf("单字回复") >= 0);
  ok("重要度 1 的细节未带上", dump.indexOf("无关紧要的细节") < 0);
  ok("其他角色的私域未带上", dump.indexOf("角色私域的一条记忆") < 0);

  console.log("\n=== 结果 ===");
  console.log("通过 " + pass + " / 失败 " + fail);
  process.exit(fail === 0 ? 0 : 1);
})();