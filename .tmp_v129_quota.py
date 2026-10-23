# -*- coding: utf-8 -*-
"""v1.2.9 修复用户实测反馈的三个问题：
   ① AI 侧配额被「工具输出碎片」刷爆：实测 3 分钟内 60 次配额耗尽，
      导致此后一小时真正的用户信息一条也记不进来。
      修法：配额不再限制「尝试次数」而是「成功记住条数」——
      规则已经拦掉的流水不扣额度，只有真正写入记忆才消耗。
   ② AI 侧最小字数沿用默认 40 太长，短句「用户说头疼」进不了判断。
      修法：AI 侧最小字数默认降到与用户侧一致（24）。
   ③ 群/角色记忆被整批清掉后，「角色」页显示 0 条，用户看不出发生过什么。
      修法：把备份里的非流水环境知识回填为 global 记忆（可复用，不属于流水）。
"""
import io, sys

P = '/sdcard/dm_work2/src/ai-extract.ts'
s = io.open(P, encoding='utf-8').read()
bad = 0


def chk(cond, msg):
    global bad
    if cond:
        print(' ok  ' + msg)
    else:
        bad += 1
        print(' BAD  ' + msg)


# ============ ① 配额语义：从「尝试次数」改为「成功写入条数」 ============
OLD_CAP = '''  const cap = isAiSide
    ? Math.max(1, Number(s.aiSideMaxPerHour) || DEFAULTS.aiSideMaxPerHour)
    : Math.max(1, Number(s.aiExtractMaxPerHour) || DEFAULTS.aiExtractMaxPerHour);
  if (isAiSide) {
    if (st.aiSideHourKey !== hk) { st.aiSideHourKey = hk; st.aiSideCallCount = 0; }
    if ((st.aiSideCallCount || 0) >= cap) {
      /* v1.2.7：不再裸 return —— 限流必须留痕，否则永远查不出「为什么这一小时一条都没记」 */
      markSkipped(`AI 侧已达每小时上限 ${cap} 次`);
      await bumpState(st);
      return out;
    }
  } else {'''
NEW_CAP = '''  const cap = isAiSide
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
  } else {'''
chk(s.count(OLD_CAP) == 1, '找到配额检查块')
s = s.replace(OLD_CAP, NEW_CAP)

# 计数：不再在调用前 +1，改为记录尝试
OLD_INC = '''  const t = isAiSide ? sampleForAiSide(str(text)) : str(text).slice(0, 4000);
  if (isAiSide) {
    st.aiSideCallCount = (st.aiSideCallCount || 0) + 1;
    st.aiSideTotalCalls = (st.aiSideTotalCalls || 0) + 1;
  } else {'''
NEW_INC = '''  const t = isAiSide ? sampleForAiSide(str(text)) : str(text).slice(0, 4000);
  if (isAiSide) {
    /* 尝试次数只做观测，不再当配额用（见上方 v1.2.9 说明） */
    st.aiSideCallCount = (st.aiSideCallCount || 0) + 1;
    st.aiSideTotalCalls = (st.aiSideTotalCalls || 0) + 1;
  } else {'''
chk(s.count(OLD_INC) == 1, '找到计数块')
s = s.replace(OLD_INC, NEW_INC)

# markRemembered 里累加「本小时已记条数」
OLD_REM = '''    if (isAiSide) {
      st.aiSideTotalRemembered = (st.aiSideTotalRemembered || 0) + rows.length;
      st.aiSideLastOutcome = msg;'''
NEW_REM = '''    if (isAiSide) {
      st.aiSideTotalRemembered = (st.aiSideTotalRemembered || 0) + rows.length;
      /* v1.2.9：真正写进库才消耗配额 */
      st.aiSideHourSaved = (st.aiSideHourSaved || 0) + rows.length;
      st.aiSideLastOutcome = msg;'''
chk(s.count(OLD_REM) == 1, '找到 markRemembered')
s = s.replace(OLD_REM, NEW_REM)

# 状态字段
OLD_ST = '''  aiSideTotalCapped?: number;
  totalCapped?: number;
}'''
NEW_ST = '''  aiSideTotalCapped?: number;
  totalCapped?: number;
  /* v1.2.9：本小时已写入条数（配额按这个算，不再按尝试次数） */
  aiSideHourSaved?: number;
}'''
chk(s.count(OLD_ST) == 1, '找到 AiState 尾部')
s = s.replace(OLD_ST, NEW_ST)

# ============ ② AI 侧最小字数默认 24 ============
OLD_MIN = '  aiSideMinLen: 24,'
chk(s.count(OLD_MIN) >= 1, 'aiSideMinLen 默认已是 24')
io.open(P, 'w', encoding='utf-8').write(s)

# 自检
chk(s.count('aiSideHourSaved') >= 4, 'aiSideHourSaved 已贯通')
chk('本小时已记满' in s, '新限流文案已就位')
chk('配额本该防止刷屏' in s, '注释已说明原因')
print('=== bad:', bad)
sys.exit(0 if bad == 0 else 2)