# -*- coding: utf-8 -*-
"""回填 v1.2.8 清理时误删的「环境知识」。
   背景：清理时按 source=ai-action 整批移除，但其中混着一批真正有价值、
   且与工程流水无关的「宿主环境/API 事实」（如 Files API 没有 move、
   ipc.call 必须传 targetRuntime、热安装广播怎么发）。
   这些是可复用知识，属于该记的，不该陪流水一起被删。
   做法：从清理前备份里按白名单特征挑出，回填为 scope=global 记忆。
"""
import json, io, re, os, time

D = '/sdcard/Download/Operit/plugins/com.operit.deep_memory'
P = os.path.join(D, 'memories.json')
BAK = os.path.join(D, 'backup', 'memories_before_meta_cleanup_1792726107769.json')

live = json.loads(io.open(P, encoding='utf-8').read())
bak = json.loads(io.open(BAK, encoding='utf-8').read())
cur = live.get('items', [])
cur_txt = set(str(x.get('content', '')).strip() for x in cur)

# 环境知识白名单：讲的是「宿主/工具/路径的限制与正确用法」，不是「我干了什么」
KEEP = re.compile(
    r'(Files API|Tools\.Files|Tools\.Chat\.call|ToolPkg\.ipc\.call|registerToolboxUiModule|'
    r'registerNavigationEntry|subpackages|toolpkg_cache|api_version|surface 只有|'
    r'FUSE 路径|热安装|DEBUG_REFRESH_PACKAGES|DEBUG_INSTALL_TOOLPKG|'
    r'super_admin:terminal|Compose DSL|onLoad 只在根节点|'
    r'排障铁律|环境限制|实测可用|正确做法|必须传|没有 move|无 move)'
)
# 流水特征（讲「我改了什么/跑了什么」），出现即不要
FLOW = re.compile(
    r'(已完成|已部署|已打包|已修复|已修改|已更新|已生成|已保存|已落盘|已就位|'
    r'跑完|编译通过|测试通过|回归通过|全绿|重新打包|重新部署|'
    r'^AI 在 |^AI 编写|^AI 新建|^AI 核实|^AI 查明|^AI确认|^AI 确认|^AI 发现|^AI 待验|^AI 规划|'
    r'^AI 完成|^AI 已在|^AI 已将|^AI 已广播|^AI已|^AI 已)'
)

picked = []
for it in bak.get('items', []):
    c = str(it.get('content', '')).strip()
    if not c or c in cur_txt:
        continue
    if not KEEP.search(c):
        continue
    if FLOW.search(c):
        continue
    if len(c) < 20:
        continue
    picked.append(it)

print('=== 回填候选 %d 条 ===' % len(picked))
for it in picked:
    print('  +', str(it.get('content', ''))[:110])

if '--apply' not in __import__('sys').argv:
    print('\n[DRY-RUN] 未加 --apply')
    raise SystemExit(0)

ts = int(time.time() * 1000)
for i, it in enumerate(picked):
    row = dict(it)
    row['id'] = 'backfill_%d_%d' % (ts, i)
    row['scope'] = 'global'
    row['source'] = 'ai'
    row.pop('characterId', None)
    row.pop('characterName', None)
    row.pop('speaker', None)
    row.pop('speakerId', None)
    row['createdAt'] = ts
    row['updatedAt'] = ts
    cur.append(row)

live['items'] = cur
live['updatedAt'] = ts
payload = json.dumps(live, ensure_ascii=False, separators=(',', ':'))
io.open(P + '.tmp', 'w', encoding='utf-8').write(payload)
io.open(P, 'w', encoding='utf-8').write(payload)

back = json.loads(io.open(P, encoding='utf-8').read())
print('\n回填完成，现条数:', len(back.get('items', [])))
print('OK')