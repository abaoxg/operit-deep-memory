/**
 * test_ai_cap.js -- 限流可观测性测试（v1.2.9 配额语义）
 *
 * 背景（实测缺陷）：
 *   触到每小时上限时，代码直接 return，没走 markSkipped，
 *   导致「被限流拦住」在面板上完全不可见，只能看到「无需记忆」，
 *   把配置问题伪装成模型判断问题。
 *
 * v1.2.9 语义变更：配额只算「真正写进库的条数」，不算尝试次数。
 *   这样规则能拦掉的操作流水不再消耗额度（实测曾 3 分钟刷满 60 次，
 *   之后整小时用户的话一条都记不进来）。
 *
 * 判定点：
 *   1. 上限触发时 out.skipped 必须能表达「被限流」（含「每小时上限」或「本小时已记满」）
 *   2. 上限触发必须计入 aiSideTotalSkipped
 *   3. 上限触发必须单独计入 aiSideTotalCapped（与「无需记忆」区分）
 *   4. aiStatus() 必须暴露 aiSideTotalCapped / aiSideHourQuotaUsed / aiSideHourQuotaCap
 *   5. 用户侧也要有 totalCapped
 */
'use strict';
const path = require('path');
const fs = require('fs');
const DIST = path.join(__dirname, 'dist');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function load(rel) {
  const p = require.resolve(path.join(DIST, rel));
  delete require.cache[p];
  return require(p);
}

/* ---------- 1. 静态结构：限流分支必须走 markSkipped ---------- */
function test1_static() {
  console.log('\n[1] 限流分支必须记账（静态检查）');
  const src = fs.readFileSync(path.join(__dirname, 'src/ai-extract.ts'), 'utf8');

  ok('限流分支不再裸 return',
    src.indexOf('out.skipped = `AI 侧已达每小时上限') < 0,
    '仍存在直接赋值后 return 的旧写法');

  ok('限流调用 markSkipped',
    src.indexOf('markSkipped(`AI 侧本小时已记满') >= 0,
    '未找到 AI 侧限流记账调用');

  ok('isCap 同时认新旧两种限流文案',
    src.indexOf('msg.indexOf("每小时上限") >= 0 || msg.indexOf("本小时已记满") >= 0') >= 0,
    'isCap 判断没同步新文案，capped 会永远为 0');

  ok('用户侧限流也记账',
    src.indexOf('markSkipped(`已达每小时上限') >= 0);

  ok('markSkipped 里区分限流',
    src.indexOf('const isCap = msg.indexOf("每小时上限") >= 0') >= 0);

  ok('限流计入 aiSideTotalCapped',
    src.indexOf('st.aiSideTotalCapped = (st.aiSideTotalCapped || 0) + 1') >= 0);

  ok('限流计入 totalCapped',
    src.indexOf('st.totalCapped = (st.totalCapped || 0) + 1') >= 0);

  ok('aiStatus 暴露 capped',
    src.indexOf('aiSideTotalCapped: st.aiSideTotalCapped || 0') >= 0);
}

/* ---------- 2. 运行时：真的会累计 ---------- */
function test2_runtime() {
  console.log('\n[2] 运行时：限流计数真的会涨');
  /* 用假宿主把 state 文件落在内存里 */
  const mem = {};
  globalThis.Tools = {
    Files: {
      read: async (p) => ({ content: mem[p] || '' }),
      write: async (p, c) => { mem[p] = c; return { success: true }; },
      exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(mem, p) }),
      mkdir: async () => ({ success: true })
    },
    Chat: { call: async () => ({ text: '{"items":[]}', finishReason: 'stop' }) }
  };
  globalThis.ToolPkg = { ipc: { on: () => {} } };

  const ai = load('ai-extract.js');
  ok('aiExtractMessage 可用', typeof ai.aiExtractMessage === 'function');
  ok('aiStatus 可用', typeof ai.aiStatus === 'function');
  ok('aiResetState 可用', typeof ai.aiResetState === 'function');

  /* 直接构造「已用满」的状态，验证下一次调用会被拦并记账 */
  return (async () => {
    await ai.aiResetState();
    const st0 = await ai.loadState();
    ok('state 初始 skipped 为 0', (st0.aiSideTotalSkipped || 0) === 0);

    const hk = ai.hourKey();
    const st = await ai.loadState();
    st.aiSideHourKey = hk;
    /* v1.2.9：配额看「已写入条数」，所以这里把 saved 拉到上限之上。
       aiSideCallCount 只做观测，设成 999 已不再触发限流 —— 这正是本次修复的目的。 */
    st.aiSideHourSaved = 999;
    st.aiSideCallCount = 3;
    st.aiSideTotalSkipped = 0;
    st.aiSideTotalCapped = 0;
    await ai.saveState(st);

    const settings = Object.assign({}, ai.DEFAULTS, {
      aiSideExtract: true,
      aiSideMaxPerHour: 5,
      aiSideMinLen: 1
    });
    const r = await ai.aiExtractMessage(
      '这是一段足够长的测试文本，用来触发 AI 侧提取流程并检查限流分支是否记账。'.repeat(3),
      'testchat', settings, undefined, undefined, 'ai');
    ok('被限流时 aiUsed=false', r.aiUsed === false);
    const skipMsg = String(r.skipped || '');
    ok('被限流时 skipped 能表达限流',
      skipMsg.indexOf('本小时已记满') >= 0 || skipMsg.indexOf('每小时上限') >= 0,
      'skipped=' + JSON.stringify(r.skipped));

    const st1 = await ai.loadState();
    ok('限流计入 aiSideTotalSkipped', (st1.aiSideTotalSkipped || 0) === 1,
      'skipped=' + st1.aiSideTotalSkipped);
    ok('限流计入 aiSideTotalCapped', (st1.aiSideTotalCapped || 0) === 1,
      'capped=' + st1.aiSideTotalCapped);

    const status = await ai.aiStatus();
    ok('aiStatus 暴露 aiSideTotalCapped', status.aiSideTotalCapped === 1,
      'got=' + status.aiSideTotalCapped);
    ok('aiStatus 暴露 hourQuotaUsed', typeof status.aiSideHourQuotaUsed === 'number');
    ok('aiStatus 暴露 hourQuotaCap 为正数', status.aiSideHourQuotaCap > 0,
      'got=' + status.aiSideHourQuotaCap);
    ok('aiStatus 暴露 aiSideTotalSkipped', status.aiSideTotalSkipped === 1);

    /* 「无需记忆」不应污染 capped */
    const st2 = await ai.loadState();
    st2.aiSideHourKey = hk;
    st2.aiSideHourSaved = 0;   // 配额未满，才能走到规则判断
    st2.aiSideCallCount = 0;
    await ai.saveState(st2);
    const s2 = Object.assign({}, ai.DEFAULTS, { aiSideExtract: true, aiSideMaxPerHour: 5, aiSideMinLen: 1 });
    /* 太短的文本应被 shouldSkipByRule 拦掉，属于「规则跳过」而非「限流跳过」 */
    await ai.aiExtractMessage('短', 'testchat', s2, undefined, undefined, 'ai');
    const st3 = await ai.loadState();
    ok('规则跳过不污染 capped', (st3.aiSideTotalCapped || 0) === 1,
      'capped=' + st3.aiSideTotalCapped);
    ok('规则跳过会涨 skipped', (st3.aiSideTotalSkipped || 0) === 2,
      'skipped=' + st3.aiSideTotalSkipped);
  })();
}

/* ---------- 3. UI 必须展示 ---------- */
function test3_ui() {
  console.log('\n[3] 面板必须展示 AI 侧状态');
  const ui = fs.readFileSync(path.join(__dirname, 'src/ui/index.ui.ts'), 'utf8');

  ok('UI 拉取 memory.ai_status',
    ui.indexOf('memory.ai_status') >= 0);
  ok('UI 保存 aiSt 状态',
    ui.indexOf('"dm_ai_state"') >= 0);
  ok('dashboard 接收 aiSt',
    ui.indexOf('dashboardText(ctx: ComposeDslContext, stats: any, aiSt?: any)') >= 0);
  ok('dashboard 调用传 aiSt',
    ui.indexOf('dashboardText(ctx, stats, aiSt)') >= 0);
  ok('展示跳过条数',
    ui.indexOf('跳过 ${a.aiSideTotalSkipped') >= 0);
  ok('展示小时配额',
    ui.indexOf('本小时已用 ${used}/${cap}') >= 0);
  ok('展示被上限拦下次数',
    ui.indexOf('累计被上限拦下 ${capped} 次') >= 0);
  ok('配额满时告警文案',
    ui.indexOf('已达上限，本小时不再记录') >= 0);
  ok('WARN 颜色已定义',
    ui.indexOf('const WARN = ') >= 0);
}

/* ---------- 4. v1.2.9：被规则拦掉的流水不消耗配额 ---------- */
async function test4_rule_skip_no_quota() {
  console.log("\n[4] v1.2.9 规则拦掉的流水不消耗配额");
  const mem = {};
  globalThis.Tools = {
    Files: {
      read: async (p) => ({ content: mem[p] || "" }),
      write: async (p, c) => { mem[p] = c; return { success: true }; },
      exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(mem, p) }),
      mkdir: async () => ({ success: true })
    },
    Chat: { call: async () => ({ text: '{"items":[]}', finishReason: "stop" }) }
  };
  globalThis.ToolPkg = { ipc: { on: () => {} } };

  const ai = load("ai-extract.js");
  await ai.aiResetState();
  const st = await ai.loadState();
  st.aiSideHourKey = ai.hourKey();
  st.aiSideHourSaved = 0;
  st.aiSideCallCount = 0;
  await ai.saveState(st);

  const settings = Object.assign({}, ai.DEFAULTS, {
    aiSideExtract: true,
    aiSideMaxPerHour: 3,   // 配额很小，方便验证不被流水刷爆
    aiSideMinLen: 1
  });

  // 连发 10 条典型操作流水
  const flows = [
    "AI 已完成 src/ai-extract.ts 的修改，tsc EXIT=0",
    "AI 已重新打包 /data/.../com.operit.deep_memory-v1.2.9.toolpkg，221204 字节",
    "AI 在 dm_work2 核实 memory-core.ts 的 saveStore 实现",
    "AI 新建了 .tmp_test_fallback.js 用于验证",
    "AI 查明 Files API 无 move 方法，可用方法仅 copy/deleteFile",
    "AI 已部署到 packages 目录，md5 一致",
    "AI 跑完 13 个测试文件，372 通过 / 0 失败",
    "AI 确认 ai-extract.ts 的 shouldSkipByRule 逻辑正确",
    "AI 编写 .tmp_v129_quota.py 修复配额语义",
    "AI 已将工作区迁移到绑定目录并清理 /sdcard 根目录"
  ];
  for (const f of flows) {
    await ai.aiExtractMessage(f, "testchat", settings, undefined, undefined, "ai");
  }

  const after = await ai.loadState();
  ok("流水全部被规则拦下，不写库", (after.aiSideHourSaved || 0) === 0,
    "saved=" + after.aiSideHourSaved);
  ok("配额未被刷爆（saved 未达上限）", (after.aiSideHourSaved || 0) < 3,
    "saved=" + after.aiSideHourSaved);

  // 反向验证：正常用户事实应能写进去
  await ai.aiExtractMessage(
    "用户要求以后所有脚本都必须放在绑定工作区内，不许写到 /sdcard 根目录",
    "testchat", settings, undefined, undefined, "ai");
  const after2 = await ai.loadState();
  ok("配额满之前，模型仍会被真正调用", (after2.aiSideCallCount || 0) > 0,
    "calls=" + after2.aiSideCallCount);
}

(async () => {
  console.log('=== deep_memory 限流可观测性测试（v1.2.9 配额语义） ===');
  try {
    test1_static();
    await test2_runtime();
    test3_ui();
    await test4_rule_skip_no_quota();
  } catch (e) {
    fail++;
    console.log('  FAIL 测试异常: ' + (e && e.stack || e));
  }
  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail === 0 ? 0 : 1);
})();