# -*- coding: utf-8 -*-
import io, os
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

reps = {
    'release.js': [
        ('/sdcard/dm_out', 'path.resolve(__dirname, "..", "dm_out")'),
        ('/sdcard/dm_work2/manifest.json', 'path.resolve(__dirname, "manifest.json")'),
    ],
    'test_meta_filter.js': [
        ("const DIST = '/sdcard/dm_work2/dist';", "const DIST = path.resolve(__dirname, 'dist');"),
    ],
}

for f, pairs in reps.items():
    p = os.path.join(ROOT, f)
    if not os.path.exists(p):
        print('skip', f)
        continue
    s = io.open(p, encoding='utf-8').read()
    for o, n in pairs:
        print('%s hit=%d  %s' % (f, s.count(o), o))
        s = s.replace(o, n)
    io.open(p, 'w', encoding='utf-8').write(s)

# 复核 release.js 是否已无绝对路径
s = io.open(os.path.join(ROOT, 'release.js'), encoding='utf-8').read()
print('\nrelease.js 残留 /sdcard:', s.count('/sdcard'))
s2 = io.open(os.path.join(ROOT, 'test_meta_filter.js'), encoding='utf-8').read()
print('test_meta_filter.js 残留 /sdcard/dm_work2:', s2.count('/sdcard/dm_work2'))
print('OK')
