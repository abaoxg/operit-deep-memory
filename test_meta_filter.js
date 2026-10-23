/**
 * test_meta_filter.js -- 验证「操作流水」元记忆过滤规则
 *  1) 应拦下：AI 干活流水
 *  2) 不能误杀：用户的事实/偏好
 */
'use strict';
const path = require('path');
const fs = require('fs');
const DIST = path.resolve(__dirname, 'dist');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
const mem = {};
globalThis.Tools = {
  Files: {
    read: async (p) => ({ content: mem[p] || '' }),
    write: async (p, c) => { mem[p] = c; return { success: true }; },
    exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(mem, p) }),
    mkdir: async () => ({ success: true }),
    list: async () => ({ entries: [] })
  },
  Chat: { call: async () => ({ text: '{"remember":false,"items":[]}', finishReason: 'stop' }) }
};
globalThis.ToolPkg = { ipc: { on: () => {} }, log: () => {} };

function load(rel) {
  const p = require.resolve(path.join(DIST, rel));
  delete require.cache[p];
  return require(p);
}

(async () => {
  console.log('=== v1.2.8 操作流水过滤：真实数据回放 ===');
  const ai = load('ai-extract.js');
  /* 规则没导出，用 aiExtractMessage 的 ruleSkip 路径验证：Chat.call 不应被调用 */
  let chatCalled = 0;
  globalThis.Tools.Chat.call = async () => { chatCalled++; return { text: '{"remember":false,"items":[]}', finishReason: 'stop' }; };

  const S = {
    aiExtract: true, aiExtractMaxPerHour: 60, aiExtractMinLen: 10,
    aiSideExtract: true, aiSideMinLen: 24, aiSideMaxPerHour: 60,
    aiSideMaxItems: 2, aiSideDedup: true
  };

  /* ---- 应当拦下的（AI 干活流水） ---- */
  const flows = [
    'AI 已完成 v1.2.8 打包并部署，dist 产物可加载',
    'AI 已将 com.operit.deep_memory-v1.2.8.toolpkg 复制到 /storage/emulated/0/Android/data/com.ai.assistance.operit/files/packages/',
    'AI 已完成 deep_memory 包内 50 项静态检查，结果 bad=0 全部通过',
    'AI 已确认线上缓存 dist 更新到 11:10，memory-core.js 含 targetSpeaker',
    'AI 已修复 test_group_scope.js 截断问题，文件共 252 行、结果 62 通过 0 失败'
  ];
  for (const t of flows) {
    chatCalled = 0;
    const r = await ai.aiExtractMessage(t, 'c1', S, undefined, undefined, 'ai');
    const reason = String(r.skipped || '');
    /* 必须是被元记忆规则拦下，而不是碰巧「太短」或模型自己判断不记 */
    const blocked = chatCalled === 0 && reason.indexOf('操作流水') >= 0;
    ok('拦下流水: ' + t.slice(0, 24), blocked, r.skipped);
    if (blocked) console.log('        原因: ' + r.skipped);
  }

  /* ---- 不能误杀的（用户的真实信息） ---- */
  const keep = [
    '用户做网络运维工作，主要负责路由器与内网维护，家里用某品牌 AX 路由器',
    '用户偏好简洁直接的回复，不喜欢反复确认',
    '用户的名字叫小明，住在杭州，平时用 Android 手机',
    /* 下面三条故意带「我/已/路径」等易误杀要素，用来钉住规则的保守性 */
    '用户我已经把家里的路由器刷成 OpenWrt，管理地址是 192.168.1.1',
    '用户已把工作文件都放在 /sdcard/dm_work2 目录下，方便统一管理',
    '用户的习惯是先看日志再动手，不喜欢盲目改配置'
  ];
  for (const t of keep) {
    chatCalled = 0;
    const r = await ai.aiExtractMessage(t, 'c1', S, undefined, undefined, 'user');
    const reached = chatCalled > 0;
    ok('放行用户信息: ' + t.slice(0, 20), reached, r.skipped);
  }

  /* ---- AI 侧描述用户（不是自述）也要放行 ---- */
  const aboutUser = [
    '用户已全权授权 AI 自行决策执行，不再逐项询问，习惯单字回复确认',
    '用户要求 AI 把生成的文件都放到 /sdcard/dm_out 目录，方便他自己取'
  ];
  for (const t of aboutUser) {
    chatCalled = 0;
    const r = await ai.aiExtractMessage(t, 'c1', S, undefined, undefined, 'ai');
    ok('放行「AI 侧记录的关于用户的事实」', chatCalled > 0, r.skipped);
  }

  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log('  FAIL 异常: ' + (e && e.stack || e));
  process.exit(2);
});