# -*- coding: utf-8 -*-
"""恢复被误删的「角色私域记忆」。
   v1.2.8 清理时按 source=ai-action 整批删除，但其中 116 条属于 role:助手A、
   77 条属于 group:fe64d9e1 的私域记忆 —— 它们是「在某个角色/群场景下发生过的事」，
   不是 AI 的工程流水。整批删掉导致「角色」页显示 0 条，等于把角色的记忆史抹了。

   恢复策略（保守）：
   - 只恢复带 characterId（role:/group:）的条目
   - 排除明显讲「我改了哪个文件/跑了什么测试」的工程流水
   - 保持原 scope/speaker/characterId 不变，尊重当时的归属
   - 单独备份当前库
"""
import json, io, re, os, time, sys

D = '/sdcard/Download/Operit/plugins/com.operit.deep_memory'
P = os.path.join(D, 'memories.json')
BAK = os.path.join(D, 'backup', 'memories_before_meta_cleanup_1792726107769.json')

live = json.loads(io.open(P, encoding='utf-8').read())
bak = json.loads(io.open(BAK, encoding='utf-8').read())
cur = live.get('items', [])
cur_txt = set(str(x.get('content', '')).strip() for x in cur)

# 明确的工程流水特征（讲 AI 自己的活）
FLOW = re.compile(
    r'(\.tmp_|\.py\b|\.js\b|\.ts\b|toolpkg|md5|md5sum|tsc -p|tsc 无错误|'
    r'am broadcast|grep -|/sdcard/dm_work2|/sdcard/dm_out|build_pkg|'
    r'test_\w+\.js|锚点|断言|行号|字节|dist/|memory-core\.ts|ai-extract\.ts|'
    r'saveStore|loadStore|normalizeItem|shouldSkipByRule|dedup|'
    r'已完成打包|已部署|已重新打包|回归|全绿|通过 / 0 失败|通过/0 失败)'
)
# 角色/群场景里「关于用户或人物」的内容，即使含技术词也值得留
PERSONAL = re.compile(r'(用户|他|她|喜欢|偏好|习惯|决定|授权|不喜欢|讨厌|要求|约定|边界)')

picked, skipped = [], 0
for it in bak.get('items', []):
    c = str(it.get('content', '')).strip()
    cid = str(it.get('characterId', ''))
    if not cid:
        continue
    if c in cur_txt:
        continue
    # 收紧：必须「讲的不是我的工程活」才恢复。
    # 上一版只排除了部分流水词，结果把「AI 已完成打包并部署」这类也当成角色记忆恢复了 ——
    # 它们只是恰好被归到 role:助手A 名下，内容仍是 AI 工程流水。
    self_work = re.match(r'\s*(AI|助手)\s*(已|在|把|对|将|查|确|发|做|写|修|改|建|新|跑|验|核|复|重|生|编|部|备|删|创|加|移|换|补|清|记|列|统|整|判|选|定|待|编|规)', c)
    if self_work:
        skipped += 1
        continue
    if FLOW.search(c):
        skipped += 1
        continue
    picked.append(it)

print('=== 角色私域记忆恢复 ===')
print('备份中带归属的条目: %d' % len([x for x in bak.get('items', []) if x.get('characterId')]))
print('判定为工程流水而跳过: %d' % skipped)
print('将恢复              : %d' % len(picked))
for it in picked[:20]:
    print('  + [%s] %s' % (it.get('characterId', ''), str(it.get('content', ''))[:80]))

if '--apply' not in sys.argv:
    print('\n[DRY-RUN] 未加 --apply')
    raise SystemExit(0)

ts = int(time.time() * 1000)
for i, it in enumerate(picked):
    row = dict(it)
    row['id'] = 'restore_%d_%d' % (ts, i)
    row['updatedAt'] = ts
    cur.append(row)

live['items'] = cur
live['updatedAt'] = ts
payload = json.dumps(live, ensure_ascii=False, separators=(',', ':'))
io.open(P + '.tmp', 'w', encoding='utf-8').write(payload)
io.open(P, 'w', encoding='utf-8').write(payload)

back = json.loads(io.open(P, encoding='utf-8').read())
from collections import Counter
print('\n恢复完成，现条数:', len(back.get('items', [])))
print('scope:', Counter([x.get('scope', '') for x in back.get('items', [])]))
print('characterId:', Counter([x.get('characterId', '(空)') for x in back.get('items', [])]))
print('OK')