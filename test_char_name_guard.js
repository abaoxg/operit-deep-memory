/**
 * v1.2.9 角色注册表「弱名字不覆盖」回归测试
 * 背景：群会话的标题常常就是 "1"，旧逻辑会把注册表里已经记好的名字冲成 "1"。
 */
const path = require('path');
const core = require(path.join(__dirname, 'dist', 'memory-core.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' => ' + extra : '')); }
}

(async () => {
  console.log('=== 角色注册表弱名字防护测试（v1.2.9）===');

  // ---- 1. isWeakCharacterName 判定 ----
  const weak = ['', '  ', '1', '42', '7', 'a', '未命名角色', '未知角色', 'undefined', 'null', '...', '1.2'];
  const strong = ['助手A', '运维助手', '工作群', 'Team Alpha', '家庭网络群'];
  weak.forEach((n) => ok('弱名字: ' + JSON.stringify(n), core.isWeakCharacterName(n) === true));
  strong.forEach((n) => ok('强名字: ' + JSON.stringify(n), core.isWeakCharacterName(n) === false));

  // ---- 2. 弱名字不冲掉已有强名字 ----
  const s = { characterRegistry: [] };
  const id = 'group:test-0001';
  core.touchCharacterRegistry(s, id, '家庭运维群');
  ok('首次登记名字', s.characterRegistry[0].name === '家庭运维群', s.characterRegistry[0].name);

  const ch1 = core.touchCharacterRegistry(s, id, '1');
  ok('弱名字 "1" 不覆盖', s.characterRegistry[0].name === '家庭运维群', s.characterRegistry[0].name);
  ok('弱名字不触发写入', ch1 === false);

  core.touchCharacterRegistry(s, id, '42');
  ok('弱名字 "42" 不覆盖', s.characterRegistry[0].name === '家庭运维群', s.characterRegistry[0].name);

  // ---- 3. 强名字可以更新 ----
  const ch2 = core.touchCharacterRegistry(s, id, '家庭网络运维群');
  ok('强名字可以覆盖', s.characterRegistry[0].name === '家庭网络运维群', s.characterRegistry[0].name);
  ok('强名字触发写入', ch2 === true);

  // ---- 4. 弱名字可以救活弱名字（初始就是 1 的情况）----
  const s2 = { characterRegistry: [{ id: 'group:x', name: '1', firstSeenAt: 1, lastSeenAt: Date.now(), count: 0 }] };
  core.touchCharacterRegistry(s2, 'group:x', '真正的群名');
  ok('弱名字可被强名字救活', s2.characterRegistry[0].name === '真正的群名', s2.characterRegistry[0].name);

  const s3 = { characterRegistry: [{ id: 'group:y', name: '1', firstSeenAt: 1, lastSeenAt: Date.now(), count: 0 }] };
  core.touchCharacterRegistry(s3, 'group:y', '9');
  ok('弱覆盖弱：允许（都是垃圾名，写谁无所谓）', s3.characterRegistry[0].name === '9', s3.characterRegistry[0].name);

  // ---- 5. 空 id 不写 ----
  const s4 = { characterRegistry: [] };
  ok('空 id 不登记', core.touchCharacterRegistry(s4, '', '名字') === false && s4.characterRegistry.length === 0);

  // ---- 6. characterRegistry 非数组时自愈 ----
  const s5 = { characterRegistry: null };
  core.touchCharacterRegistry(s5, 'group:z', '群Z');
  ok('registry 非数组时自愈', Array.isArray(s5.characterRegistry) && s5.characterRegistry[0].name === '群Z');

  // ---- 7. contextDedup 设置项存在 ----
  ok('contextDedup 默认开', core.DEFAULT_SETTINGS.contextDedup === true, String(core.DEFAULT_SETTINGS.contextDedup));

  console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(' FAIL 测试异常: ' + (e && e.stack || e));
  process.exit(1);
});