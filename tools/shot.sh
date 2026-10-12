#!/usr/bin/env bash
# Скриншот сцены: tools/shot.sh out.png "параметры игры" кадров "js подготовки" ["js после"]
# Пример: tools/shot.sh /tmp/a.png "lv=1&st=1&nobrief=1" 200 ""
CH="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
OUT="$1"; Q="$2"; N="${3:-120}"; JS="$4"; JS2="$5"
enc() { python -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="file:///$(cygpath -m "$ROOT" | sed 's/ /%20/g')/tools/shot.html?q=$(enc "$Q")&n=$N&js=$(enc "$JS")&js2=$(enc "$JS2")"
P=$(mktemp -d)
"$CH" --headless=new --disable-gpu --allow-file-access-from-files --user-data-dir="$(cygpath -w "$P")" --hide-scrollbars \
  --window-size=${W:-1280},${H:-720} --virtual-time-budget=${BUDGET:-4000} --screenshot="$(cygpath -w "$OUT")" "$URL" 2>/dev/null
rm -rf "$P"
