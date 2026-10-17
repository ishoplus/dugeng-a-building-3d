# Railway：靜態網站＋需求單 API（scripts/serve.py，只用 Python 標準庫）
FROM python:3.12-slim
WORKDIR /app
COPY scripts/serve.py scripts/reqstore.py /app/scripts/
COPY index.html og.jpg /app/build/
COPY js/ /app/build/js/
COPY img/ /app/site/img/
# 程式放進版本號目錄、首頁改指新路徑：xi-za.com 的 Cloudflare 會把 JS 快取 4 小時，不換路徑住戶會拿到舊版
RUN V=v$(date +%s) \
 && mkdir -p /app/site/$V \
 && mv /app/build/js /app/site/$V/js \
 && sed "s#src=\"js/main.js\"#src=\"$V/js/main.js\"#" /app/build/index.html > /app/site/index.html \
 && mv /app/build/og.jpg /app/site/og.jpg && rm -rf /app/build
# 需求單與設計結果放在 Railway volume（掛在 /data），重新部署不會不見
ENV HOST=0.0.0.0 DUGENG_ROOT=/app/site DUGENG_DATA=/data/requirements DUGENG_CUSTOM=/data/custom PYTHONUNBUFFERED=1
CMD ["python3", "scripts/serve.py"]
