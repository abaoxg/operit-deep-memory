/**
 * test_group_scope.js -- v1.2.8 群聊记忆归属测试
 *
 * 要验证的核心规则：
 *   R1 用户本人在群里说的话 → scope=global（用户画像跨场景）
 *   R2 群成员/AI 在群里说的话 → scope=group，带发言人
 *   R3 群记忆不外流：A 群的记忆在 B 群、单聊都看不到
 *   R4 但 speaker=user 的群记忆可升格注入（老数据兼容）
 *   R5 老数据无 scope 字段时按 characterId 前缀推断，行为不变
 *   R6 speaker 能落盘并读回
 */
'use strict';
const path = require('path');
const fs = require('fs');
const DIST = path.join(__dirname, 'dist');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
function load(rel) {
  const p = require.resolve(path.join(DIST, rel));
  delete require.cache[p];
  return require(p);
}

const mem = {};
function fakeHost() {
  globalThis.Tools = {
    Files: {
      read: async (p) => ({ content: mem[p] || '' }),
      write: async (p, c) => { mem[p] = c; return { success: true }; },
      exists: async (p) => ({ exists: Object.prototype.hasOwnProperty.call(mem, p) }),
      mkdir: async () => ({ success: true }),
      append: async (p, c) => { mem[p] = (mem[p] || '') + c; return { success: true }; }
    },
    Chat: { call: async () => ({ text: '{"remember":false,"items":[]}', finishReason: 'stop' }) }
  };
  globalThis.ToolPkg = { ipc: { on: () => {} }, log: () => {} };
}

/* ---------- 1. 数据层：speaker / scope 落盘与读回 ---------- */
async function test1_persist() {
  console.log('\n[1] speaker / scope 能落盘并读回');
  fakeHost();
  const core = load('memory-core.js');
  const store = { items: [], updatedAt: Date.now(), version: 1 };
  const s = Object.assign({}, core.DEFAULTS, { autoTag: false });

  const a = await core.remember(store, {
    content: '张三喜欢喝美式咖啡，不加糖', type: 'preference',
    characterId: 'group:g1', characterName: '1',
    speaker: '张三', speakerId: 'm-aaa', scope: 'group'
  }, s);
  ok('写入后 speaker 正确', a.item.speaker === '张三', a.item.speaker);
  ok('写入后 speakerId 正确', a.item.speakerId === 'm-aaa');
  ok('写入后 scope 正确', a.item.scope === 'group', a.item.scope);

  const b = await core.remember(store, {
    content: '用户做网络运维工作，主要负责路由器与内网', type: 'fact',
    speaker: 'user', scope: 'global'
  }, s);
  ok('用户自述无 characterId', !b.item.characterId, b.item.characterId);
  ok('用户自述 scope=global', b.item.scope === 'global', b.item.scope);
  ok('用户自述 speaker=user', b.item.speaker === 'user');

  /* 序列化往返 */
  const raw = JSON.parse(JSON.stringify(store));
  const back = core.normalizeStore ? core.normalizeStore(raw) : raw;
  const bs = (back.items || []).filter((x) => x.speaker === '张三');
  ok('反序列化后 speaker 不丢', bs.length === 1, bs.length);
  ok('反序列化后 scope 不丢', bs.length === 1 && bs[0].scope === 'group');

  /* 老数据：无 scope / 无 speaker，应能推断 */
  const legacy = { items: [
    { id: 'L1', content: '老群记忆', type: 'fact', tags: [], importance: 3, source: 'import',
      createdAt: 1, updatedAt: 1, lastAccessAt: 1, accessCount: 0, reviewCount: 0,
      lastReviewedAt: 0, nextReviewAt: 0, links: [], space: 'general', characterId: 'group:g1' },
    { id: 'L2', content: '老单聊记忆', type: 'fact', tags: [], importance: 3, source: 'import',
      createdAt: 1, updatedAt: 1, lastAccessAt: 1, accessCount: 0, reviewCount: 0,
      lastReviewedAt: 0, nextReviewAt: 0, links: [], space: 'general', characterId: 'role:小明' },
    { id: 'L3', content: '老全局记忆', type: 'fact', tags: [], importance: 3, source: 'import',
      createdAt: 1, updatedAt: 1, lastAccessAt: 1, accessCount: 0, reviewCount: 0,
      lastReviewedAt: 0, nextReviewAt: 0, links: [], space: 'general' }
  ] };
  const lb = core.normalizeStore ? core.normalizeStore(legacy) : legacy;
  const gm = (lb.items || []).find((x) => x.id === 'L1');
  const cm = (lb.items || []).find((x) => x.id === 'L2');
  const um = (lb.items || []).find((x) => x.id === 'L3');
  ok('老群记忆推断为 group', gm && core.scopeOf(gm) === 'group', gm && gm.scope);
  ok('老角色记忆推断为 character', cm && core.scopeOf(cm) === 'character');
  ok('老全局记忆推断为 global', um && core.scopeOf(um) === 'global');
}

/* ---------- 2. 可见性：群隔离 + 用户画像升格 ---------- */
function test2_visibility() {
  console.log('\n[2] 群隔离与用户画像升格');
  const core = load('memory-core.js');
  const s = Object.assign({}, core.DEFAULTS, {
    characterIsolation: true, injectGlobalMemory: true,
    injectCharacterMemory: true, injectGroupMemory: true, promoteGroupUserMemory: true
  });
  const mk = (o) => Object.assign({
    id: 'x', type: 'fact', content: 'c', tags: [], importance: 3, source: 'ai',
    createdAt: 1, updatedAt: 1, lastAccessAt: 1, accessCount: 0, reviewCount: 0,
    lastReviewedAt: 0, nextReviewAt: 0, links: [], space: 'general'
  }, o);

  const mGroupA = mk({ id: 'A', characterId: 'group:gA', scope: 'group', speaker: '张三' });
  const mGroupAUser = mk({ id: 'AU', characterId: 'group:gA', scope: 'group', speaker: 'user' });
  const mGlobal = mk({ id: 'G', scope: 'global', speaker: 'user' });
  const mChar = mk({ id: 'C', characterId: 'role:小明', scope: 'character' });

  /* R3：群记忆只在群内可见 */
  ok('A 群记忆在 A 群可见', core.isInjectable(mGroupA, 'group:gA', s) === true);
  ok('A 群记忆在 B 群不可见', core.isInjectable(mGroupA, 'group:gB', s) === false);
  ok('A 群记忆在单聊不可见', core.isInjectable(mGroupA, 'role:小明', s) === false);
  ok('A 群记忆无角色时不可见', core.isInjectable(mGroupA, '', s) === false);

  /* R4：speaker=user 的群记忆升格 */
  ok('用户群里自述可注入到单聊', core.isInjectable(mGroupAUser, 'role:小明', s) === true);
  ok('用户群里自述可注入到别的群', core.isInjectable(mGroupAUser, 'group:gB', s) === true);
  const sOff = Object.assign({}, s, { promoteGroupUserMemory: false });
  ok('关掉升格开关后不注入', core.isInjectable(mGroupAUser, 'role:小明', sOff) === false);

  /* 全局记忆任何场景可见 */
  ok('全局记忆在单聊可见', core.isInjectable(mGlobal, 'role:小明', s) === true);
  ok('全局记忆在群可见', core.isInjectable(mGlobal, 'group:gA', s) === true);

  /* v1.2.8 回归护栏：用户在群里说的话被定成 global，但事件里仍带着 group:xxx 的
     characterId。这类「全局却带归属」的记忆必须跨场景可见，否则用户在群里说过的
     关于自己的事，出了这个群就全丢了 —— 正是 v1.2.8 第一版实现里的真 bug。 */
  const mGlobalWithOwner = mk({ id: 'GO', characterId: 'group:gA', scope: 'global', speaker: 'user' });
  ok('带归属的全局记忆在单聊仍可见', core.isInjectable(mGlobalWithOwner, 'role:小明', s) === true);
  ok('带归属的全局记忆在他群仍可见', core.isInjectable(mGlobalWithOwner, 'group:gB', s) === true);
  ok('带归属的全局记忆在同群可见', core.isInjectable(mGlobalWithOwner, 'group:gA', s) === true);
  ok('带归属的全局记忆无角色身份也可注入', core.isInjectable(mGlobalWithOwner, '', s) === true);
  const sNoGlobal = Object.assign({}, s, { injectGlobalMemory: false });
  ok('关掉 injectGlobalMemory 后带归属全局记忆不注入',
    core.isInjectable(mGlobalWithOwner, 'role:小明', sNoGlobal) === false);
  ok('scopeOf 认的是 global 而不是 group', core.scopeOf(mGlobalWithOwner) === 'global');

  /* 角色私域不外流 */
  ok('角色私域在别的角色不可见', core.isInjectable(mChar, 'role:小红', s) === false);
  ok('角色私域在本角色可见', core.isInjectable(mChar, 'role:小明', s) === true);

  /* injectGroupMemory 关掉后群记忆不注入 */
  const sNoGroup = Object.assign({}, s, { injectGroupMemory: false });
  ok('关掉 injectGroupMemory 后群记忆不注入', core.isInjectable(mGroupA, 'group:gA', sNoGroup) === false);
}

/* ---------- 3. 注入文本：群成员的话要带发言人 ---------- */
function test3_inject() {
  console.log('\n[3] 注入内容可区分发言人');
  const core = load('memory-core.js');
  const s = Object.assign({}, core.DEFAULTS, {
    autoInject: true, injectCount: 10, injectGeneral: true, injectSpace: true,
    compactInject: false, hotColdSplit: false, characterIsolation: true,
    injectGlobalMemory: true, injectCharacterMemory: true,
    injectGroupMemory: true, promoteGroupUserMemory: true
  });
  const mk = (o) => Object.assign({
    id: 'x', type: 'fact', content: 'c', tags: [], importance: 3, source: 'ai',
    createdAt: Date.now(), updatedAt: Date.now(), lastAccessAt: Date.now(), accessCount: 0,
    reviewCount: 0, lastReviewedAt: 0, nextReviewAt: 0, links: [], space: 'general'
  }, o);
  const store = { items: [
    mk({ id: 'A', content: '张三喜欢喝美式咖啡', characterId: 'group:gA', scope: 'group', speaker: '张三' }),
    mk({ id: 'B', content: '李四喜欢喝拿铁咖啡', characterId: 'group:gA', scope: 'group', speaker: '李四' }),
    mk({ id: 'C', content: '用户做网络运维工作', scope: 'global', speaker: 'user' })
  ] };
  const txt = core.buildInjection(store, s, 3000, undefined, 'group:gA');
  ok('注入含张三的记忆', txt.indexOf('张三喜欢喝美式咖啡') >= 0, txt.slice(0, 200));
  ok('注入含李四的记忆', txt.indexOf('李四喜欢喝拿铁咖啡') >= 0);
  ok('注入含全局用户画像', txt.indexOf('用户做网络运维工作') >= 0);
}

/* ---------- 4. 源码静态检查：链路是否真的接上 ---------- */
function test4_static() {
  console.log('\n[4] 链路静态检查');
  const main = fs.readFileSync(path.join(__dirname, 'src/main.ts'), 'utf8');
  const ai = fs.readFileSync(path.join(__dirname, 'src/ai-extract.ts'), 'utf8');
  const coreSrc = fs.readFileSync(path.join(__dirname, 'src/memory-core.ts'), 'utf8');

  ok('main 有 resolveSpeaker', main.indexOf('function resolveSpeaker(') >= 0);
  ok('main 有 resolveMemoryScope', main.indexOf('function resolveMemoryScope(') >= 0);
  ok('main 有字段探针', main.indexOf('function probeEventFields(') >= 0);
  ok('chatmsg 通道调 resolveSpeaker', main.indexOf('const sp = resolveSpeaker(event);') >= 0);
  ok('chatmsg 通道传 si', main.indexOf('who.id, who.name, side, si)') >= 0);
  ok('msgproc 通道传 si', main.indexOf('who.id, who.name, "user", si)') >= 0);
  ok('dmHandleContent 收 scopeInfo', main.indexOf('side, scopeInfo?) {') >= 0);
  ok('aiExtractText 收 scopeInfo', ai.indexOf('side?: string, scopeInfo?: any): Promise<any>') >= 0);
  ok('aiExtractMessage 收 scopeInfo', ai.indexOf('side?: string, scopeInfo?: any): Promise<AiExtractResult>') >= 0);
  ok('AI 链路传 speaker', ai.indexOf('speaker: si ? si.speaker : undefined') >= 0 && ai.indexOf('speaker: scopeInfo ?') < 0);
  ok('兜底链路传 speaker', ai.indexOf('speaker: si2 ? si2.speaker : undefined') >= 0);
  ok('global 时清空 characterId', ai.indexOf('si.scope === "global" ? undefined') >= 0);
  ok('core 有 scopeOf', coreSrc.indexOf('export function scopeOf(') >= 0);
  ok('core 有 isInjectable', coreSrc.indexOf('export function isInjectable(') >= 0);
  ok('buildInjection 用 isInjectable', coreSrc.indexOf('if (!isInjectable(m, curChar, settings)) return false;') >= 0);
  ok('recall 用 isInjectable', coreSrc.indexOf('!isInjectable(m, q.characterId, settings)') >= 0);
  /* 发言人字段确实被读取了（旧版全为 0） */
  ['senderName', 'memberName', 'nickname', 'speakerName'].forEach((f) => {
    ok('main 读 ' + f, main.indexOf(f) >= 0);
  });
}

/* ---------- 5. resolveMemoryScope 行为（用 dist 里的真实实现验证规则）---------- */
function test5_rules() {
  console.log('\n[5] 归属规则（模拟 main 的 resolveMemoryScope 判定）');
  /* main.ts 里的函数未导出，这里按同一套规则做等价实现校验，
     同时用源码断言保证 dist 与测试口径一致 */
  const main = fs.readFileSync(path.join(__dirname, 'src/main.ts'), 'utf8');
  ok('规则1：用户的话归 global', main.indexOf('if (sp.isUser && side !== "ai")') >= 0);
  ok('规则1：global 时 characterId 置空', main.indexOf('characterId: undefined as string | undefined') >= 0);
  ok('规则2：群成员归 group', main.indexOf('if (isGroupScope) {') >= 0);
  ok('规则2：群成员带 speaker', main.indexOf('speaker: (sp.name || (side === "ai" ? "AI" : "")) || undefined') >= 0);
  ok('规则3：单聊沿用旧行为', main.indexOf('scope: charId ? "character" : "global"') >= 0);
  ok('群判定含 activePrompt.type', main.indexOf('=== "character_group"') >= 0);
  ok('群判定含 isGroup 字段', main.indexOf('p.isGroup === true') >= 0);

  /* 真机验证：把 main.ts 里的函数抠出来跑 */
  const fnSrc = main.slice(
    main.indexOf('function resolveMemoryScope('),
    main.indexOf('/** 一次性字段探针')
  );
  /* main.ts 是 TS 源码，new Function 前必须剥掉类型注解 */
  const jsSrc = fnSrc
    .replace('(who: any, sp: any, side: string)', '(who, sp, side)')
    .replace(/undefined as string \| undefined/g, 'undefined');
  const factory = new Function(jsSrc + '; return resolveMemoryScope;');
  const resolve = factory();

  const whoGroup = { id: 'group:gA', name: '1' };
  const whoChar = { id: 'role:小明', name: '小明' };
  const userSp = { name: '', id: '', isUser: true, isGroup: true };
  const memberSp = { name: '张三', id: 'm-1', isUser: false, isGroup: true };

  const r1 = resolve(whoGroup, userSp, 'user');
  ok('群里用户说话 → scope=global', r1.scope === 'global', r1.scope);
  ok('群里用户说话 → characterId 为空', r1.characterId === undefined, r1.characterId);
  ok('群里用户说话 → speaker=user', r1.speaker === 'user');

  const r2 = resolve(whoGroup, memberSp, 'ai');
  ok('群里成员说话 → scope=group', r2.scope === 'group', r2.scope);
  ok('群里成员说话 → characterId=群 id', r2.characterId === 'group:gA', r2.characterId);
  ok('群里成员说话 → speaker=张三', r2.speaker === '张三', r2.speaker);

  const r3 = resolve(whoChar, userSp, 'user');
  ok('单聊用户说话 → scope=global', r3.scope === 'global', r3.scope);

  const r4 = resolve(whoChar, { name: '小明', id: 'c1', isUser: false, isGroup: false }, 'ai');
  ok('单聊 AI 说话 → scope=character', r4.scope === 'character', r4.scope);
  ok('单聊 AI 说话 → characterId 保留', r4.characterId === 'role:小明');
}

/* ---------- 6. 去重合并必须按发言人隔离 ---------- */
async function test6_dedup() {
  console.log('\n[6] 不同发言人不会被合并');
  fakeHost();
  const core = load('memory-core.js');
  const store = { items: [], updatedAt: Date.now(), version: 1 };
  const s = Object.assign({}, core.DEFAULTS, { autoTag: false, mergeSimilar: true });

  /* 张三说「我喜欢喝咖啡」 */
  const a = await core.remember(store, {
    content: '我喜欢喝咖啡', type: 'preference',
    characterId: 'group:gA', characterName: '1',
    speaker: '张三', speakerId: 'm-zs', scope: 'group'
  }, s);
  ok('张三写入未合并', a.merged === false, a.merged);

  /* 李四同一句话——绝不能并进张三那条 */
  const b = await core.remember(store, {
    content: '我喜欢喝咖啡', type: 'preference',
    characterId: 'group:gA', characterName: '1',
    speaker: '李四', speakerId: 'm-ls', scope: 'group'
  }, s);
  ok('李四未被合并进张三', b.merged === false, b.merged);
  ok('库里是两条', store.items.length === 2, store.items.length);
  ok('两条发言人不同', store.items[0].speaker !== store.items[1].speaker,
    [store.items[0].speaker, store.items[1].speaker]);

  /* 张三再说一次同样的话——这才应该合并 */
  const c = await core.remember(store, {
    content: '我喜欢喝咖啡', type: 'preference',
    characterId: 'group:gA', characterName: '1',
    speaker: '张三', speakerId: 'm-zs', scope: 'group'
  }, s);
  ok('同一个人重复才合并', c.merged === true, c.merged);
  ok('合并后仍是两条', store.items.length === 2, store.items.length);

  /* 跨作用域同样不合并：单聊的 AI 记忆不能并进群记忆 */
  const d = await core.remember(store, {
    content: '我喜欢喝咖啡', type: 'preference',
    characterId: 'role:小明', characterName: '小明',
    speaker: '小明', scope: 'character'
  }, s);
  ok('跨作用域不合并', d.merged === false, d.merged);
  ok('跨作用域后三条', store.items.length === 3, store.items.length);
}

/* ---------- 7. v1.2.9：global 不挂 characterId（脏组合防线） ---------- */
async function test7_global_purity() {
  console.log('\n[7] v1.2.9 global 记忆不归属任何角色');
  fakeHost();
  const core = load('memory-core.js');
  const store = { items: [], updatedAt: Date.now(), version: 1 };
  const s = Object.assign({}, core.DEFAULTS, { autoTag: false });

  // 模拟「用户在群里发言」：scope 走全局，但仍带着群 characterId
  const g = await core.remember(store, {
    content: '用户本人要求所有文件只能写在绑定的工作区内',
    type: 'preference',
    speaker: 'user',
    scope: 'global',
    characterId: 'group:fe64d9e1-test',
    characterName: '1'
  }, s);
  ok('scope=global', g.item.scope === 'global', g.item.scope);
  ok('global 不挂 characterId', !g.item.characterId, g.item.characterId);
  ok('global 不挂 characterName', !g.item.characterName, g.item.characterName);
  ok('speaker 仍保留', g.item.speaker === 'user', g.item.speaker);

  // 角色私域仍要正常挂归属
  const c = await core.remember(store, {
    content: '助手A 观察到这台机器 root 权限可用',
    type: 'fact', scope: 'character', characterId: 'role:助手A', characterName: '助手A'
  }, s);
  ok('character 仍挂 characterId', c.item.characterId === 'role:助手A', c.item.characterId);

  // 统计口径：全局不计数到任何角色
  const stats = core.characterStats(store, s);
  const hit = stats.find((x) => x.id === 'group:fe64d9e1-test');
  ok('角色统计里没有那条全局记忆', !hit, hit);
  const roleHit = stats.find((x) => x.id === 'role:助手A');
  ok('角色统计正确计入私域 1 条', roleHit && roleHit.count === 1, roleHit);
}

(async () => {
  console.log('=== deep_memory v1.2.8 群聊归属测试 ===');
  try {
    await test1_persist();
    test2_visibility();
    test3_inject();
    test4_static();
    test5_rules();
    await test6_dedup();
    await test7_global_purity();
  } catch (e) {
    fail++;
    console.log('  FAIL 测试异常: ' + (e && e.stack || e));
  }
  console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail === 0 ? 0 : 1);
})();