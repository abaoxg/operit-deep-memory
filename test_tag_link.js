/**
 * test_tag_link.js -- v1.2.6 标签治理与自动关联测试
 *
 * 背景（实测数据）：
 *   - 库里 75 个标签有 66 个只出现过一次，等于没打标签，还白占注入预算。
 *   - autoLink 只生成「建议」、从不落盘，导致 links 恒为 0。
 *
 * 定案策略：
 *   - 标签只收可辨识标识（文件名/驼峰键/带分隔符标识/版本号），中文短语不进标签；
 *   - 新增 pruneTagsByReuse：候选标签必须在库里已出现过（含本条 >= 2 次）才保留；
 *   - autoLink 真正建双向关联，条件是同角色 + 同空间 + 至少共享 1 个标签，最多 3 条。
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

/* ================= 1. 标签只收可辨识标识 ================= */
function test1_extract() {
  console.log('\n[1] 标签提取：只要标识，不要句子碎片');
  const core = loadCore();

  const t1 = core.extractTags('修复 ai-extract.ts 的 findRedundant 闸门，发布 v1.2.6');
  ok('收文件名', t1.indexOf('ai-extract.ts') >= 0, JSON.stringify(t1));
  ok('收驼峰键', t1.indexOf('findredundant') >= 0, JSON.stringify(t1));
  ok('收版本号', t1.some((x) => x.indexOf('v1.2.6') >= 0), JSON.stringify(t1));
  ok('单条不超过 5 个', t1.length <= 5, 'len=' + t1.length);

  const t2 = core.extractTags('这个问题的情况比较麻烦，需要确认一下内容');
  ok('纯中文句子不产标签', t2.length === 0, JSON.stringify(t2));

  const t3 = core.extractTags('用户喜欢简洁直接的回答方式');
  ok('偏好类叙述不产标签', t3.length === 0, JSON.stringify(t3));

  const t4 = core.extractTags('deep_memory 的 settings.json 里 aiSideDedup 默认开');
  ok('收带分隔符标识', t4.indexOf('deep_memory') >= 0, JSON.stringify(t4));
  ok('收配置文件名', t4.indexOf('settings.json') >= 0, JSON.stringify(t4));
}

/* ================= 2. 复用过滤：单条不再自造碎片 ================= */
function test2_prune() {
  console.log('\n[2] 复用过滤 pruneTagsByReuse');
  const core = loadCore();

  /* 库里已有别人用过 deep_memory，新记忆带它 → 保留 */
  const store = { version: 1, items: [
    { id: 'a', content: 'deep_memory 插件已上线', tags: ['deep_memory'], type: 'fact' }
  ], updatedAt: 0 };
  const keep = core.pruneTagsByReuse(store, ['deep_memory', 'onceonly-file.ts'], '新内容提到 deep_memory 与 onceonly-file.ts');
  ok('已被别人用过的保留', keep.indexOf('deep_memory') >= 0, JSON.stringify(keep));
  ok('首次出现的丢弃', keep.indexOf('onceonly-file.ts') < 0, JSON.stringify(keep));

  const empty = core.pruneTagsByReuse({ version: 1, items: [] }, ['brandnew.ts'], 'brandnew.ts 第一次出现');
  ok('空库全部丢弃', empty.length === 0, JSON.stringify(empty));

  /* 标签最终数量受控 */
  const many = core.pruneTagsByReuse(store, ['deep_memory', 'a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'], 'x');
  ok('上限 5', many.length <= 5, 'len=' + many.length);
}

/* ================= 3. autoLink 真正建链 ================= */
async function test3_link() {
  console.log('\n[3] autoLink 自动建双向关联');
  const fake = fakeHost();
  const core = loadCore();
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, {
    autoTag: true, autoLink: true, autoExtract: true,
    characterIsolation: false, spaces: ['general'], activeSpace: 'general'
  });

  const store = { version: 1, items: [], updatedAt: 0 };
  const r1 = await core.remember(store, {
    content: 'toolpkg 打包必须写 manifest 的 api_version 为 10.1 否则报错', type: 'fact'
  }, settings);
  /* 先手动给它一个标签，模拟库里已存在该标识（真实场景由历史记忆提供） */
  r1.item.tags = ['toolpkg'];

  const r2 = await core.remember(store, {
    content: 'toolpkg 的 navigation surface 只能是四个合法值之一', type: 'fact'
  }, settings);

  ok('第二条带上了复用标签', (r2.item.tags || []).indexOf('toolpkg') >= 0, JSON.stringify(r2.item.tags));
  ok('共享标签被自动关联', (r2.item.links || []).length >= 1, 'links=' + JSON.stringify(r2.item.links));
  ok('关联是双向的', (r1.item.links || []).indexOf(r2.item.id) >= 0, 'r1=' + JSON.stringify(r1.item.links));

  const r3 = await core.remember(store, {
    content: '用户喜欢简洁直接的回答不要客套开场', type: 'preference'
  }, settings);
  ok('无共享标签不硬连', (r3.item.links || []).length === 0, 'links=' + JSON.stringify(r3.item.links));

  /* 关闭开关 */
  const core2 = loadCore();
  const store2 = { version: 1, items: [], updatedAt: 0 };
  const s2 = Object.assign({}, core2.DEFAULT_SETTINGS, { autoTag: false, autoLink: false, spaces: ['general'], activeSpace: 'general' });
  const a1 = await core2.remember(store2, { content: 'toolpkg 的 api_version 必须写 10.1', type: 'fact' }, s2);
  const a2 = await core2.remember(store2, { content: 'toolpkg 的 surface 只能四个值', type: 'fact' }, s2);
  ok('autoLink=false 零关联', (a2.item.links || []).length === 0 && (a1.item.links || []).length === 0,
    JSON.stringify([a1.item.links, a2.item.links]));
}

/* ================= 4. 兼容性与实现约束 ================= */
function test4_compat() {
  console.log('\n[4] 兼容性与实现约束');
  const core = loadCore();
  ok('extractTags 仍可用', typeof core.extractTags === 'function');
  ok('导出 pruneTagsByReuse', typeof core.pruneTagsByReuse === 'function');
  ok('findRelated 仍在', typeof core.findRelated === 'function');
  const src = fs.readFileSync(path.join(__dirname, 'src/memory-core.ts'), 'utf8');
  ok('remember 走复用过滤', src.indexOf('pruneTagsByReuse(store, rawTags, content)') >= 0);
  ok('建链按 shared >= 1', src.indexOf('x.shared >= 1') >= 0);
  ok('建链上限 3 条', src.indexOf('.slice(0, 3)') >= 0);
}
/* ================= 5. retagAll 幂等与收敛 ================= */
function test5_retag() {
  console.log('\n[5] retagAll 全库重算：幂等 + 收敛');
  const core = loadCore();
  const mk = (content, tags) => ({ id: 'x' + Math.random().toString(36).slice(2, 8), content: content, type: 'fact',
    tags: tags || [], importance: 3, createdAt: 1, updatedAt: 1, accessCount: 0, lastAccessAt: 0,
    reviewCount: 0, nextReviewAt: 0, links: [], space: 'general', source: 'test', pinned: false, sensitive: false });
  const store = { version: 1, items: [
    mk('toolpkg 打包要写 manifest 的 api_version', []),
    mk('toolpkg 的 surface 只有四个合法值', []),
    mk('deep_memory 的 autoTag 开关默认开启', []),
    mk('deep_memory 的 autoLink 现在会真正建链', []),
    mk('用户喜欢简洁直接的回答', []),
    mk('今天天气不错适合出门散步', []),
    mk('aiSideDedup 去重开关必须配对 featureAnchors', []),
    mk('aiSideDedup 关闭时不做语义去重', [])
  ], updatedAt: 1 };

  const r1 = core.retagAll(store);
  ok('首次重算有改动', r1.changed > 0, 'changed=' + r1.changed);
  ok('产出标签', r1.tagged > 0, 'tagged=' + r1.tagged);
  ok('唯一值收敛（< 条数）', r1.unique < store.items.length, 'unique=' + r1.unique);

  const snap1 = JSON.stringify(store.items.map((m) => [m.id, m.tags]));
  const r2 = core.retagAll(store);
  const snap2 = JSON.stringify(store.items.map((m) => [m.id, m.tags]));
  ok('幂等：第二遍零改动', r2.changed === 0, 'changed=' + r2.changed);
  ok('幂等：标签快照不变', snap1 === snap2);

  const r3 = core.retagAll(store);
  ok('幂等：第三遍仍零改动', r3.changed === 0, 'changed=' + r3.changed);

  /* 每个保留的标签都必须至少挂在 2 条记忆上（共享才有价值） */
  const cnt = {};
  store.items.forEach((m) => (m.tags || []).forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; }));
  const lonely = Object.keys(cnt).filter((t) => cnt[t] < 2);
  ok('没有只挂 1 条的碎片标签', lonely.length === 0, JSON.stringify(lonely));

  /* 同类标识应挂到多条上：toolpkg 必须在两条记忆上 */
  const toolpkgHits = store.items.filter((m) => (m.tags || []).indexOf('toolpkg') >= 0).length;
  ok('toolpkg 被共享到 2 条', toolpkgHits === 2, 'hits=' + toolpkgHits);
  const dedupHits = store.items.filter((m) => (m.tags || []).indexOf('aisidededup') >= 0).length;
  ok('aisidededup 被共享到 2 条', dedupHits === 2, 'hits=' + dedupHits);

  /* 中文碎片不进标签 */
  const allTags = store.items.reduce((a, m) => a.concat(m.tags || []), []);
  const chinese = allTags.filter((t) => /[\u4e00-\u9fa5]/.test(t));
  ok('标签里没有中文碎片', chinese.length === 0, JSON.stringify(chinese));

  /* 只改 tags，不动正文与其他字段 */
  const keep = store.items.every((m) => m.content && m.type === 'fact' && m.importance === 3 && m.createdAt === 1);
  ok('只改 tags 不动其他字段', keep);

  /* 空库安全 */
  const empty = { version: 1, items: [], updatedAt: 0 };
  const re = core.retagAll(empty);
  ok('空库不报错且零改动', re.changed === 0 && re.tagged === 0, JSON.stringify(re));
}

(async () => {
  console.log('=== deep_memory v1.2.6 标签与关联测试 ===');
  try {
    test1_extract();
    test2_prune();
    await test3_link();
    test4_compat();
    test5_retag();
  } catch (e) {
    fail++;
    console.log('  FAIL 测试异常: ' + (e && e.stack || e));
  }
  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail === 0 ? 0 : 1);
})();