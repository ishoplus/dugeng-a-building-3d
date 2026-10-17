#!/bin/zsh
# 產生 site/：程式放進 v<時間戳>/ 版本號路徑（xi-za.com 的 Cloudflare 會把 JS 快取 4 小時），index.html 不快取
set -e
cd "$(dirname "$0")/.."
V="v$(date +%s)"
mkdir -p site
rm -rf site/index.html
mkdir -p "site/$V" && cp -R js "site/$V/js"
sed "s#src=\"js/main.js\"#src=\"$V/js/main.js\"#" index.html > site/index.html
cp og.jpg site/og.jpg                       # LINE／FB 分享縮圖（og:image）
# 只留最近 3 版，避免舊分頁還在載入時 404
for d in $(ls -d site/v* | sort -r | tail -n +4); do rm -rf "$d"; done
echo "published $V"
