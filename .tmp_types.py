# -*- coding: utf-8 -*-
"""把 types 声明目录从「工作区外上层」改为「项目内 types/」，并同步所有引用。
   原因：迁移工作区后 types 跟着项目走，相对层级从 ../types 变成 ./types。
"""
import io, os

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

changed = []


def rw(path, pairs):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p):
        print('skip', path)
        return
    s = io.open(p, encoding='utf-8').read()
    old = s
    for o, n in pairs:
        c = s.count(o)
        if c:
            print('%s  hit=%d  %s' % (path, c, o[:60]))
        s = s.replace(o, n)
    if s != old:
        io.open(p, 'w', encoding='utf-8').write(s)
        changed.append(path)


# tsconfig：typeRoots 与 include 指向项目内 types
rw('tsconfig.json', [
    ('"../types"', '"./types"'),
    ('"../types/**/*.d.ts"', '"./types/**/*.d.ts"'),
])

# 源码里的相对引用：src/xxx.ts -> ../types/，src/ui/xxx.ts -> ../../types/
rw('src/main.ts', [
    ('"../../types/toolpkg"', '"../types/toolpkg"'),
    ('"../../types/compose-dsl"', '"../types/compose-dsl"'),
])
rw('src/ui/index.ui.ts', [
    ('"../../../types/compose-dsl"', '"../../types/compose-dsl"'),
    ('"../../../types/toolpkg"', '"../../types/toolpkg"'),
])

# 全局扫一遍还有没有指向 ../../types 的（层级超出的写法）
import subprocess
out = subprocess.run(['grep', '-rn', 'types/toolpkg\\|types/compose-dsl', 'src'],
                     cwd=ROOT, capture_output=True, text=True).stdout
print('\n=== 当前引用 ===')
for line in out.strip().split('\n'):
    if line:
        print('  ' + line)

print('\n改动:', changed)