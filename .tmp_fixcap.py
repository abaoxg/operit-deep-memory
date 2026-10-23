# -*- coding: utf-8 -*-
"""把 test_ai_cap.js 迁到 v1.2.9 的新配额语义。
   旧用例构造「超限」靠 aiSideCallCount=999（尝试次数），
   新语义下配额看 aiSideHourSaved（真正写入条数），所以用例必须改。
   同时补一条：规则拦掉的流水不该消耗配额 —— 这是本次修复的核心。
"""
import io, os

ROOT = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(ROOT, 'test_ai_cap.js')
s = io.open(p, encoding='utf-8').read()

pairs = [
    # ① 文档头更新
    (' * test_ai_cap.js -- v1.2.6 限流可观测性测试',
     ' * test_ai_cap.js -- 限流可观测性测试（v1.2.9 配额语义）'),

    (' * 判定点：\n *   1. 上限触发时 out.skipped 必须带上「每小时上限」字样',
     ' * v1.2.9 语义变更：配额只算「真正写进库的条数」，不算尝试次数。\n'
     ' *   这样规则能拦掉的操作流水不再消耗额度（实测曾 3 分钟刷满 60 次，\n'
     ' *   之后整小时用户的话一条都记不进来）。\n'
     ' *\n'
     ' * 判定点：\n *   1. 上限触发时 out.skipped 必须能表达「被限流」（含「每小时上限」或「本小时已记满」）'),

    # ② 静态检查：旧文案断言改成同时接受新文案
    ("""  ok('限流调用 markSkipped',
    src.indexOf('markSkipped(`AI 侧已达每小时上限') >= 0);""",
     """  ok('限流调用 markSkipped',
    src.indexOf('markSkipped(`AI 侧本小时已记满') >= 0,
    '未找到 AI 侧限流记账调用');

  ok('isCap 同时认新旧两种限流文案',
    src.indexOf('msg.indexOf("每小时上限") >= 0 || msg.indexOf("本小时已记满") >= 0') >= 0,
    'isCap 判断没同步新文案，capped 会永远为 0');"""),

    # ③ 运行时：用 aiSideHourSaved 触限
    ("""    st.aiSideHourKey = hk;
    st.aiSideCallCount = 999;          // 必然超上限
    st.aiSideTotalSkipped = 0;
    st.aiSideTotalCapped = 0;
    await ai.saveState(st);""",
     """    st.aiSideHourKey = hk;
    /* v1.2.9：配额看「已写入条数」，所以这里把 saved 拉到上限之上。
       aiSideCallCount 只做观测，设成 999 已不再触发限流 —— 这正是本次修复的目的。 */
    st.aiSideHourSaved = 999;
    st.aiSideCallCount = 3;
    st.aiSideTotalSkipped = 0;
    st.aiSideTotalCapped = 0;
    await ai.saveState(st);"""),

    # ④ 断言文案
    ("""    ok('被限流时 slipped 带「每小时上限」',
      String(r.skipped || '').indexOf('每小时上限') >= 0, 'skipped=' + JSON.stringify(r.skipped));""",
     """    const skipMsg = String(r.skipped || '');
    ok('被限流时 skipped 能表达限流',
      skipMsg.indexOf('本小时已记满') >= 0 || skipMsg.indexOf('每小时上限') >= 0,
      'skipped=' + JSON.stringify(r.skipped));"""),

    # ⑤ 规则跳过场景：重置 saved 而不是 callCount
    ("""    const st2 = await ai.loadState();
    st2.aiSideHourKey = hk;
    st2.aiSideCallCount = 0;
    await ai.saveState(st2);""",
     """    const st2 = await ai.loadState();
    st2.aiSideHourKey = hk;
    st2.aiSideHourSaved = 0;   // 配额未满，才能走到规则判断
    st2.aiSideCallCount = 0;
    await ai.saveState(st2);"""),

    # ⑥ 标题
    ("console.log('=== deep_memory v1.2.6 限流可观测性测试 ===');",
     "console.log('=== deep_memory 限流可观测性测试（v1.2.9 配额语义） ===');"),
]

hit = 0
for o, n in pairs:
    c = s.count(o)
    print('hit=%d  %s' % (c, o.split('\n')[0][:70]))
    if c:
        hit += 1
    s = s.replace(o, n)

io.open(p, 'w', encoding='utf-8').write(s)
print('\n替换成功 %d/%d' % (hit, len(pairs)))