/**
 * test_ai_side_quality.js -- v1.2.5 AI 侧记忆质量专项测试
 * 覆盖：语义去重（featureAnchors/findRedundant）与待办自动结案（closeAiSideTasks）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const DIST = path.join(__dirname, 'dist');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function loadCore() {
  const p = require.resolve(path.join(DIST, 'memory-core.js'));
  delete require.cache[p];
  return require(p);
}
function fakeHost() {
  const fake = {};
  globalThis.Tools = {
    Files: {
      read: async (p) => ({ content: fake[p] || '' }),
      write: async (p, c) => { fake[p] = c; return { success: true }; },
      exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(fake, p) }),
      mkdir: async () => ({ success: true })
    },
    Chat: { call: async () => ({ text: '{}', finishReason: 'stop' }) }
  };
  globalThis.ToolPkg = { ipc: { on: () => {} } };
  return fake;
}
function mk(id, content, type, source, extra) {
  const o = { id: id, content: content, type: type, source: source, importance: 3, createdAt: Date.now(), updatedAt: Date.now() };
  return Object.assign(o, extra || {});
}
/* ================= 1. featureAnchors ================= */
function test1_anchors() {
  console.log('\n[1] 特征锚点提取');
  const core = loadCore();
  const a = core.featureAnchors('ai-extract.ts 新增 AI_SIDE_PROMPT，已跑 v1.2.5 门禁');
  ok('抽出 ai-extract.ts', a.indexOf('ai-extract.ts') >= 0, JSON.stringify(a));
  ok('抽出 AI_SIDE_PROMPT', a.indexOf('ai_side_prompt') >= 0, JSON.stringify(a));
  ok('抽出 v1.2.5', a.indexOf('v1.2.5') >= 0, JSON.stringify(a));
  const b = core.featureAnchors('缓存指纹写入 /data/local/tmp/dm_cache_1792718379000');
  ok('时间戳后缀归一化', b.some((x) => x.indexOf('dm_cache') >= 0) && b.every((x) => /[0-9]{10,}/.test(x) === false), JSON.stringify(b));
  const c = core.featureAnchors('已清理 3 条僵尸待办');
  ok('纯中文无错点返回空', c.length === 0, JSON.stringify(c));
}
/* ================= 2. findRedundant ================= */
function test2_dedup() {
  console.log('\n[2] 语义去重判定');
  const core = loadCore();
  const store = { version: 1, items: [
    mk('o1', 'ai-extract.ts 新增 AI_SIDE_PROMPT 与去重闸门，v1.2.5 已跑通 tsc', 'event', 'ai-action')
  ], updatedAt: 0 };
  const dup = core.findRedundant(store, 'ai-extract.ts 新增 AI_SIDE_PROMPT 与去重闸门，v1.2.5 已跑通 tsc 门禁', { type: 'event' });
  ok('同锚点复述判为重复', dup ? true : false, dup ? dup.item.id : 'null');
  const add = core.findRedundant(store, 'ai-extract.ts 新增 AI_SIDE_PROMPT 与去重闸门，v1.2.5 已跑通 tsc，另修 memory-core.ts 的 closeAiSideTasks', { type: 'event' });
  ok('带新错点放行', add === null, add ? add.item.id : 'null');
  const cross = core.findRedundant(store, 'ai-extract.ts 新增 AI_SIDE_PROMPT 与去重闸门，v1.2.5 已跑通 tsc', { type: 'task' });
  ok('跨 type 不比对', cross === null);
  const store2 = { version: 1, items: [mk('o2', 'ai-extract.ts 已改完 v1.2.5 去重', 'event', 'ai-action', { characterId: 'xiaofashi' })], updatedAt: 0 };
  const cc = core.findRedundant(store2, 'ai-extract.ts 已改完 v1.2.5 去重', { type: 'event', characterId: 'other' });
  ok('跨角色不比对', cc === null);
  const short = core.findRedundant(store, '已清理 3 条', { type: 'event' });
  ok('错点不足一律放行', short === null);
}
/* ================= 3. closeAiSideTasks ================= */
function test3_close() {
  console.log('\n[3] 待办自动结案');
  const core = loadCore();
  const mkSt = (items) => ({ version: 1, items: items, updatedAt: 0 });
  const st = mkSt([
    mk('t1', 'AI 待验证 v1.2.5 去重是否生效', 'task', 'ai-action')
  ]);
  const r1 = core.closeAiSideTasks(st, { aiSideTaskAutoClose: true, aiSideTaskTtlHours: 72 });
  ok('真待办保留', st.items.length === 1, 'len=' + st.items.length);
  ok('未误删', r1.closed.length === 0, 'closed=' + r1.closed.length);
  const st2 = mkSt([mk('t2', 'AI 已完成 v1.2.5 去重改造', 'task', 'ai-action')]);
  const r2 = core.closeAiSideTasks(st2, { aiSideTaskAutoClose: true });
  ok('已完成待办移除', st2.items.length === 0, 'len=' + st2.items.length);
  ok('结案计数正确', r2.closed.length === 1);
  const st3 = mkSt([mk('t3', 'AI 已完成改造，待下次登录验证', 'task', 'ai-action')]);
  core.closeAiSideTasks(st3, { aiSideTaskAutoClose: true });
  ok('已完成+待 同时出现不删', st3.items.length === 1);
  const st4 = mkSt([mk('u1', '用户已完成 v1.2.5 验收', 'task', 'ai')]);
  core.closeAiSideTasks(st4, { aiSideTaskAutoClose: true });
  ok('用户侧 task 不动', st4.items.length === 1);
  const st5 = mkSt([mk('e1', 'AI 已完成去重改造', 'event', 'ai-action')]);
  core.closeAiSideTasks(st5, { aiSideTaskAutoClose: true });
  ok('非 task 类型不动', st5.items.length === 1);
  const st6 = mkSt([mk('x1', 'AI 已完成改造', 'task', 'ai-action')]);
  const r6 = core.closeAiSideTasks(st6, { aiSideTaskAutoClose: false });
  ok('开关关闭零动作', st6.items.length === 1 && r6.closed.length === 0);
  const old = Date.now() - 100 * 3600000;
  const st7 = mkSt([mk('x2', 'AI 待验证缓存签名', 'task', 'ai-action', { createdAt: old })]);
  const r7 = core.closeAiSideTasks(st7, { aiSideTaskAutoClose: true, aiSideTaskTtlHours: 72 });
  ok('超时待办标记过期', r7.expired.length === 1, 'expired=' + r7.expired.length);
  ok('过期项打上 expiryAt', typeof st7.items[0].expiryAt === 'number', String(st7.items[0].expiryAt));
}
/* ================= 4. 源码与提示词约束 ================= */
function test4_source() {
  console.log('\n[4] 源码与提示词约束');
  const ai = fs.readFileSync(path.join(__dirname, 'src/ai-extract.ts'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, 'src/memory-core.ts'), 'utf8');
  ok('提示词禁过程流水', ai.indexOf('过程流水') >= 0 || ai.indexOf('工程流水') >= 0);
  ok('提示词含结论优先原则', ai.indexOf('只记「结论」') >= 0 || ai.indexOf('只记结论') >= 0);
  ok('提示词含去重段', ai.indexOf('【去重】') >= 0);
  ok('提示词含 task 规则', ai.indexOf('确实未完成的待办用 task') >= 0
    || ai.indexOf('已经完成的一律用 event') >= 0);
  ok('写入前有去重闸门', ai.indexOf('findRedundant(store, it.content') >= 0);
  ok('写入后调用结案', ai.indexOf('closeAiSideTasks(store, s)') >= 0);
  ok('去重跳过计入 skip 文案', ai.indexOf('全部重复，已跳过') >= 0);
  ok('结案后仍保存 store', ai.indexOf('本轮无新记忆，已结案') >= 0);
  ok('core 导出 featureAnchors', core.indexOf('export function featureAnchors') >= 0);
  ok('core 导出 findRedundant', core.indexOf('export function findRedundant') >= 0);
  ok('core 导出 closeAiSideTasks', core.indexOf('export function closeAiSideTasks') >= 0);
  const ui = fs.readFileSync(path.join(__dirname, 'src/ui/index.ui.ts'), 'utf8');
  ok('UI 有 aiSideDedup 开关', ui.indexOf('aiSideDedup') >= 0);
  ok('UI 有 aiSideTaskAutoClose 开关', ui.indexOf('aiSideTaskAutoClose') >= 0);
}
/* ================= 5. 行为：去重与结案联动 ================= */
async function test5_behavior() {
  console.log('\n[5] 行为级：写入去重与结案联动');
  const fake = fakeHost();
  const core = loadCore();
  const mem = core.DATA_DIR + '/memories.json';
  const setFile = core.DATA_DIR + '/settings.json';
  const items = [mk('old1', '用户要求 v1.2.5 的 ai-extract.ts 的 shouldSkipByRule 保留去重闸门', 'event', 'ai-action')];
  fake[mem] = JSON.stringify({ version: 1, items: items, updatedAt: 0 });
  fake[setFile] = JSON.stringify({ aiExtract: true, aiSideExtract: true, autoExtract: true, aiExtractMinLen: 6, aiSideMinLen: 10, aiExtractMaxPerHour: 60, aiSideMaxPerHour: 20, aiExtractMaxItems: 3, aiSideMaxItems: 3, aiExtractTimeoutMs: 3000, aiSideDedup: true, aiSideTaskAutoClose: true, aiSideTaskTtlHours: 72, autoTag: false, characterAutoTag: false });
  globalThis.Tools.Chat.call = async () => ({ text: JSON.stringify({ remember: true, items: [{ content: '用户要求 v1.2.5 的 ai-extract.ts 的 shouldSkipByRule 保留去重闸门', type: 'event', importance: 4, space: '工作' }] }), finishReason: 'stop' });
  const aiPath = require.resolve(path.join(DIST, 'ai-extract.js'));
  delete require.cache[aiPath];
  const ai = require(aiPath);
  const r = await ai.aiExtractText('用户再次强调 v1.2.5 的 ai-extract.ts 要去重闸门留着，别动。', 'chatZ', '', '', 'ai');
  /* v1.2.8 护栏：本用例测的是「去重闸门」，输入必须不是操作流水，
     否则会被元记忆规则提前拦下，用例就变成在测规则而不是测去重。 */
  const after = JSON.parse(fake[mem]).items;
  ok('重复未超写到库里', after.length === 1, 'len=' + after.length);
  ok('返回明确为已跳过', String(r && r.message).indexOf('跳过') >= 0 || String(r && r.message).indexOf('重复') >= 0, r && r.message);
}
/* ================= 主入口 ================= */
(async () => {
  console.log('=== deep_memory v1.2.5 AI 侧记忆质量测试 ===');
  try {
    test1_anchors();
    test2_dedup();
    test3_close();
    test4_source();
    await test5_behavior();
  } catch (e) { fail++; console.log('  FAIL 测试异常: ' + (e && e.stack || e)); }
  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail === 0 ? 0 : 1);
})();
