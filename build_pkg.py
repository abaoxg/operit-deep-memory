#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包 deep_memory 为 .toolpkg（zip），内置两道校验：
  1. manifest.api_version 必须 >= 1.0.1（Tools.Chat.call 的硬门槛，缺失按 1.0.0 处理会直接抛错）
  2. registerNavigationEntry 的 surface 必须落在白名单内
     （非法值会让宿主在包解析阶段抛 IllegalArgumentException，整包失败、插件从列表消失）

白名单实测值：toolbox / TOOLBOX / MAIN_SIDEBAR_PLUGINS / main_sidebar_plugins
"""
import io
import json
import os
import re
import sys
import zipfile

WORK = "/sdcard/dm_work2"
OUT_DIR = "/sdcard/dm_out"
PKG_ID = "com.operit.deep_memory"
VERSION = "1.2.0"

NAV_SURFACE_WHITELIST = {
    "toolbox", "TOOLBOX",
    "MAIN_SIDEBAR_PLUGINS", "main_sidebar_plugins",
}

# 打进包的文件（相对 WORK）
FILES = [
    "manifest.json",
    "README.md",
    "tsconfig.json",
    "dist/main.js",
    "dist/memory-core.js",
    "dist/ai-extract.js",
    "dist/packages/deep_memory.js",
    "dist/ui/index.ui.js",
    "src/main.ts",
    "src/memory-core.ts",
    "src/ai-extract.ts",
    "src/packages/deep_memory.ts",
    "src/ui/index.ui.ts",
    "test_ai_extract.js",
    "test_injection.js",
    "test_integration.js",
    "test_e2e.js",
    "test_character.js",
]


def die(msg):
    print("[FATAL] %s" % msg)
    sys.exit(1)


def check_manifest():
    path = os.path.join(WORK, "manifest.json")
    with io.open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    m = json.loads(raw)

    api = m.get("api_version")
    if not api:
        die("manifest 缺少 api_version（宿主会按 1.0.0 处理，Tools.Chat.call 会失败）")
    parts = re.match(r"^(\d+)\.(\d+)\.(\d+)$", api)
    if not parts:
        die("manifest.api_version 格式非法: %r（必须 major.minor.patch 三段）" % api)
    major, minor, patch = (int(x) for x in parts.groups())
    if (major, minor, patch) < (1, 0, 1):
        die("manifest.api_version=%s 低于 1.0.1，Tools.Chat.call 会被拒" % api)

    if m.get("version") != VERSION:
        die("manifest.version=%r 与目标版本 %r 不一致" % (m.get("version"), VERSION))

    print("  [OK] api_version=%s   version=%s" % (api, m.get("version")))
    return m


def check_nav_surface():
    """扫描所有 dist js，校验 registerNavigationEntry 的 surface"""
    bad = []
    found = []
    for rel in FILES:
        if not rel.endswith(".js"):
            continue
        p = os.path.join(WORK, rel)
        with io.open(p, "r", encoding="utf-8") as f:
            text = f.read()
        # 匹配 surface: "xxx" 出现在 registerNavigationEntry 之后 200 字符内
        for mm in re.finditer(r"registerNavigationEntry\s*\(\s*\{", text):
            seg = text[mm.start(): mm.start() + 600]
            for sm in re.finditer(r'surface\s*:\s*["\']([^"\']+)["\']', seg):
                val = sm.group(1)
                found.append(val)
                if val not in NAV_SURFACE_WHITELIST:
                    bad.append((rel, val))

    if bad:
        for rel, val in bad:
            print("  [BAD] %s -> surface=%r 不在白名单" % (rel, val))
        die("存在非法 surface 值，宿主会在解析阶段直接拒绝整包")
    if found:
        print("  [OK] registerNavigationEntry surface 全部合法: %s" % ", ".join(sorted(set(found))))
    else:
        print("  [--] 未发现 registerNavigationEntry（跳过）")


def check_hook_exports():
    """校验 registerXxxHook({..., function: NAME}) 引用的函数确实被导出。

    踩过的坑：src/main.ts 的 export 列表里有 onChatMessagePersisted，
    但编译产物 dist/main.js 漏了 `exports.onChatMessagePersisted = ...`，
    宿主因此拒绝注册，报 registerChatMessageHook function must be exported
    from a toolpkg module —— 主通道静默失效，且被 try/catch 吞掉不报错。
    """
    pattern = re.compile(r"register[A-Za-z]*Hook\s*\(\s*\{[^}]*?function\s*:\s*([A-Za-z_$][\w$]*)")
    bad = []
    checked = 0
    for rel in FILES:
        if not rel.endswith(".js") or not rel.startswith("dist/"):
            continue
        p = os.path.join(WORK, rel)
        with io.open(p, "r", encoding="utf-8") as f:
            text = f.read()
        exported = set(re.findall(r"exports\.([A-Za-z_$][\w$]*)\s*=", text))
        for name in set(pattern.findall(text)):
            checked += 1
            if name not in exported:
                bad.append((rel, name))
    if bad:
        for rel, name in bad:
            print("  [BAD] %s 注册了 %s，但没有 exports.%s" % (rel, name, name))
        die("存在未导出的钩子函数，宿主会拒绝注册且被 try/catch 静默吞掉")
    print("  [OK] 钩子函数导出完整（检查 %d 处）" % checked)


def build():
    # 校验文件齐全
    missing = []
    for rel in FILES:
        p = os.path.join(WORK, rel)
        if not os.path.isfile(p):
            missing.append(rel)
    if missing:
        die("缺少文件: %s" % ", ".join(missing))

    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)

    out = os.path.join(OUT_DIR, "com-operit-deep-memory-v%s.toolpkg" % VERSION)
    if os.path.exists(out):
        os.remove(out)
        print("  [--] 已删除同名旧包")

    total = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in FILES:
            p = os.path.join(WORK, rel)
            z.write(p, rel)
            sz = os.path.getsize(p)
            total += sz
            print("  + %-34s %7d" % (rel, sz))

    pkg_size = os.path.getsize(out)
    print()
    print("  产物: %s" % out)
    print("  原始总字节: %d" % total)
    print("  包体积    : %d" % pkg_size)

    # 回读校验
    with zipfile.ZipFile(out) as z:
        names = sorted(z.namelist())
        m = json.loads(z.read("manifest.json").decode("utf-8"))
    expect = sorted(FILES)
    if names != expect:
        die("包内清单不符:\n  实际=%s\n  期望=%s" % (names, expect))
    if m.get("version") != VERSION:
        die("包内 manifest version 不符")
    print("  [OK] 回读校验通过，包内 %d 个文件、version=%s、api_version=%s"
          % (len(names), m.get("version"), m.get("api_version")))
    return out


def main():
    print("=== 1. 校验 manifest ===")
    check_manifest()
    print("=== 2. 校验导航入口 surface ===")
    check_nav_surface()
    print("=== 3. 校验钩子函数导出 ===")
    check_hook_exports()
    print("=== 4. 打包 ===")
    out = build()
    print()
    print("完成: %s" % out)


main()