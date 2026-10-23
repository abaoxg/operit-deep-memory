#!/system/bin/sh
# 校验缓存目录与源包逐文件一致性（只读）
P=/storage/emulated/0/Android/data/com.ai.assistance.operit/files/packages/com-operit-deep-memory-v1.2.3.toolpkg
C=/data/data/com.ai.assistance.operit/files/toolpkg_cache/com.operit.deep_memory-8eab72cc

cd "$C" || exit 1

# 用 unzip -l 提取文件清单（跳过表头/表尾）
unzip -l "$P" 2>/dev/null | awk 'NR>3 && NF>=4 {print $4}' | grep -v '/$' | grep -v '^$' > $(cd "$(dirname "$0")" && pwd)/.pkglist

TOTAL=0; OK=0; DIFF=0
while read -r f; do
  [ -z "$f" ] && continue
  TOTAL=$((TOTAL+1))
  a=$(unzip -p "$P" "$f" 2>/dev/null | md5sum | cut -d' ' -f1)
  b=$(md5sum "$f" 2>/dev/null | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then
    OK=$((OK+1))
  else
    DIFF=$((DIFF+1))
    echo "DIFF: $f  pkg=$a  cache=$b"
  fi
done < $(cd "$(dirname "$0")" && pwd)/.pkglist

echo "包内文件数=$TOTAL  一致=$OK  不一致=$DIFF"

# 缓存中是否有多余文件
echo "--- 缓存多余文件 ---"
find . -type f | sed 's|^\./||' | while read -r ff; do
  if ! grep -qx "$ff" $(cd "$(dirname "$0")" && pwd)/.pkglist; then
    echo "EXTRA: $ff"
  fi
done
echo "--- 结束 ---"
