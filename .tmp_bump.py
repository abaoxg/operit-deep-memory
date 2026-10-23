# -*- coding: utf-8 -*-
"""升版本号 1.2.8 -> 1.2.9，并更新描述（配额语义变更 + 工作区规范化）。
   为什么升版本：AI 侧配额从「尝试次数」改为「已写入条数」是行为变更，
   用户能直接感知（不再一小时被卡死），不是同版本缺陷修补，应该升号。
"""
import io, os, json, re

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

p = os.path.join(ROOT, 'manifest.json')
m = json.loads(io.open(p, encoding='utf-8').read())
old_ver = m.get('version')
m['version'] = '1.2.9'

zh = (
    "六边形长期记忆插件 · v1.2.9 配额语义修正版：AI 侧每小时配额改为只统计"
    "「真正写进库的记忆条数」，不再按调用尝试次数计费 —— 规则能拦下的操作流水不再消耗额度，"
    "避免连续工具输出几分钟就刷满额度、导致之后整小时用户的话一条也记不进来。"
    "用户侧记身份/偏好/事件/关系，AI 侧只提取关于用户与事件的事实，不记自身的工程流水。"
    "支持群聊记忆归属（scope=global/character/group + speaker，用户本人在群里说的话跨场景可见、"
    "群成员的话只在该群可见）、角色记忆隔离、类型与重要性自动判定、冲突检测、艾宾浩斯复习、"
    "注入预算优化，以及坏库隔离与备份回退的数据安全保护。零外部依赖，无需 API Key。"
)
en = (
    "Hexagonal long-term memory plugin, v1.2.9 (quota semantics fix). The AI-side hourly quota now "
    "counts only memories actually written, not extraction attempts, so on-rule-rejected tool logs "
    "no longer burn the budget and block the user's real statements for the rest of the hour. "
    "User side stores identity/preferences/events/relations; the AI side only extracts facts about "
    "the user and events. Group chat ownership (scope=global/character/group plus speaker) keeps user "
    "statements visible across scenes while group members stay scoped to that group. Includes character "
    "isolation, auto type/importance, conflict detection, Ebbinghaus review, injection budgeting, and "
    "corrupt-store isolation with backup fallback. Zero deps, no API key."
)

desc = m.get('description')
if isinstance(desc, dict):
    desc['zh'] = zh
    desc['en'] = en
else:
    m['description'] = {'zh': zh, 'en': en}

io.open(p, 'w', encoding='utf-8').write(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
print('manifest.json: %s -> %s' % (old_ver, m['version']))

# package.json 若有版本也同步
pj = os.path.join(ROOT, 'package.json')
if os.path.exists(pj):
    d = json.loads(io.open(pj, encoding='utf-8').read())
    if d.get('version'):
        print('package.json: %s -> 1.2.9' % d['version'])
        d['version'] = '1.2.9'
        io.open(pj, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')

# 回读校验
back = json.loads(io.open(p, encoding='utf-8').read())
print('回读 version =', back['version'])
print('描述含配额说明 =', '配额' in back['description']['zh'])
print('OK')