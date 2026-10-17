# dugeng.xi-za.com 源站：只綁 127.0.0.1，版本號路徑長快取、index.html 不快取
# /api/req：客變需求單（存 data/requirements/<id>.json，不在 site/ 底下）
#   POST /api/req              建立 → {id, key}（key 只回給建立者，修改要帶）
#   GET  /api/req/<id>         讀取（不含 key）
#   POST /api/req/<id>         修改，body 要帶 key
#   POST /api/req/<id>/submit  送出給 Claude Code 設計（job 排隊，scripts/req_worker.py 每分鐘處理），body 要帶 key
# /custom/<id>.json、<id>.png：工作機設計好的方案（data/custom/）
# /api/worker/*：給 Mac 上的 Claude Code 工作機（scripts/req_worker.py）拿單、回報進度、交結果；要帶 X-Worker-Token（環境變數 DUGENG_WORKER_TOKEN，沒設就關閉）
#   GET  /api/worker/jobs               排隊中（含設計中太久沒回報）的需求單
#   POST /api/worker/jobs/<id>          更新 job 欄位 {state, msg, ...}
#   POST /api/worker/jobs/<id>/result   交設計結果 {design: {...}, png: base64}
import http.server, os, sys, json, secrets, time, re, hashlib, base64, glob
from reqstore import DATA, CUSTOM, locked, read, write

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('DUGENG_ROOT') or os.path.join(HERE, '..', 'site')          # 本機測試可指到專案根目錄
MAX_BODY = 32 * 1024
WORKER_MAX_BODY = 4 * 1024 * 1024        # 結果含俯視圖 PNG
WORKER_TOKEN = os.environ.get('DUGENG_WORKER_TOKEN', '')
STALE = 3600
RATE = {}                                   # (用途, IP) → 時間戳（滑動視窗限流）
SUBMITS_PER_DAY = 5                         # 每張需求單
SUBMITS_PER_IP_DAY = 10
SUBMITS_ALL_DAY = 30                        # 全站一天最多送給 Claude Code 幾次（保護額度）
QUEUE_MAX = 10
FILES_MAX = 5000

def limited(kind, ip, n, window):
    now = time.time(); k = (kind, ip)
    RATE[k] = [t for t in RATE.get(k, []) if now - t < window]
    if len(RATE[k]) >= n: return True
    RATE[k].append(now); return False

def csp():
    # 只允許自己和 unpkg（three.js）的腳本；唯一的行內腳本 importmap 用雜湊放行，其他行內腳本（含 onerror 這類）一律擋
    try: html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    except OSError: html = ''
    hs = ' '.join("'sha256-%s'" % base64.b64encode(hashlib.sha256(m.encode()).digest()).decode()
                  for m in re.findall(r'<script type="importmap">(.*?)</script>', html, re.S))
    return ("default-src 'self'; script-src 'self' https://unpkg.com " + hs + "; connect-src 'self' https://unpkg.com; "
            "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")

def clean(d):
    """只留允許的欄位、限制長度"""
    items = []
    for it in (d.get('items') or [])[:100]:
        if not isinstance(it, dict): continue
        text = str(it.get('text', '')).strip()[:200]
        if not text: continue
        cid = it.get('id')
        items.append({'text': text, **({'id': str(cid)[:40]} if cid else {})})
    unit = str(d.get('unit', ''))[:4]
    return {'unit': unit if re.fullmatch(r'[AB][1-9]', unit) else '', 'scheme': str(d.get('scheme', ''))[:20],
            'name': str(d.get('name', '')).strip()[:40], 'note': str(d.get('note', '')).strip()[:2000], 'items': items}

def public(rec):
    d = {k: v for k, v in rec.items() if k not in ('key', 'history', 'submits')}
    return d

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        p = self.path.split('?')[0]
        if p.startswith('/v'): self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else: self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        if p in ('/', '/index.html'): self.send_header('Content-Security-Policy', csp())
        super().end_headers()
    def log_message(self, *a): pass

    def json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def body(self, limit=MAX_BODY):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > limit: return None
        try: return json.loads(self.rfile.read(n))
        except Exception: return None
    def rid(self, suffix=''):
        m = re.fullmatch(r'/api/req/([0-9a-f]{8})' + suffix, self.path.split('?')[0])
        return m and m.group(1)

    def ip(self):
        # Cloudflare 前面帶 CF-Connecting-IP；直接打 Railway 網址時用 X-Forwarded-For 第一段
        return self.headers.get('CF-Connecting-IP') or (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip() or self.client_address[0]
    def is_worker(self): return bool(WORKER_TOKEN) and secrets.compare_digest(self.headers.get('X-Worker-Token', ''), WORKER_TOKEN)

    def worker(self, method):
        if not self.is_worker(): return self.json(403, {'error': 'forbidden'})
        p = self.path.split('?')[0]
        if method == 'GET' and p == '/api/worker/jobs':
            now, out = time.time(), []
            for f in glob.glob(os.path.join(DATA, '*.json')):
                try: rec = json.load(open(f))
                except Exception: continue
                job = rec.get('job') or {}
                if job.get('state') == 'queued' or (job.get('state') == 'working' and now - job.get('at', 0) > STALE):
                    out.append({k: rec.get(k) for k in ('id', 'unit', 'items', 'note', 'scheme', 'job')})
            return self.json(200, {'jobs': out})
        m = re.fullmatch(r'/api/worker/jobs/([0-9a-f]{8})(/result)?', p)
        if method != 'POST' or not m: return self.json(404, {'error': 'not found'})
        rid = m.group(1)
        d = self.body(WORKER_MAX_BODY)
        if d is None: return self.json(400, {'error': 'bad body'})
        if m.group(2):
            design, png = d.get('design'), d.get('png')
            if not isinstance(design, dict) or not isinstance(png, str): return self.json(400, {'error': 'bad result'})
            raw = base64.b64decode(png)
            if not raw.startswith(b'\x89PNG'): return self.json(400, {'error': 'not png'})
            for name, data in ((f'{rid}.json', json.dumps(design, ensure_ascii=False).encode()), (f'{rid}.png', raw)):
                tmp = os.path.join(CUSTOM, name + '.tmp'); open(tmp, 'wb').write(data); os.replace(tmp, os.path.join(CUSTOM, name))
            return self.json(200, {'ok': True})
        with locked():
            rec = read(rid)
            if not rec: return self.json(404, {'error': 'not found'})
            job = {k: v for k, v in d.items() if k in ('state', 'msg', 'at', 'scheme', 'unit', 'finished')}
            rec['job'] = {**(rec.get('job') or {}), **job}
            write(rid, rec)
        return self.json(200, {'job': rec['job']})

    def do_GET(self):
        p = self.path.split('?')[0]
        if p.startswith('/api/worker/'): return self.worker('GET')
        if p == '/healthz': return self.json(200, {'ok': True})
        if (p.startswith('/api/') or p.startswith('/custom/')) and limited('get', self.ip(), 600, 3600):
            return self.json(429, {'error': '查詢太頻繁，請稍後再試'})
        m = re.fullmatch(r'/custom/([0-9a-f]{8})\.(json|png)', p)
        if m:
            f = os.path.join(CUSTOM, f'{m.group(1)}.{m.group(2)}')
            if not os.path.exists(f): return self.json(404, {'error': '還沒有設計結果'})
            b = open(f, 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8' if m.group(2) == 'json' else 'image/png')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        if not p.startswith('/api/'): return super().do_GET()
        rid = self.rid()
        rec = rid and read(rid)
        if not rec: return self.json(404, {'error': '找不到這張需求單'})
        self.json(200, public(rec))

    def do_POST(self):
        if self.path.startswith('/api/worker/'): return self.worker('POST')
        d = self.body()
        if d is None: return self.json(400, {'error': '格式不對'})
        p = self.path.split('?')[0]
        if p == '/api/req':
            now = time.time()
            if len(glob.glob(os.path.join(DATA, '*.json'))) >= FILES_MAX: return self.json(503, {'error': '需求單已達上限，請聯絡管理者'})
            if limited('create', self.ip(), 20, 3600): return self.json(429, {'error': '建立太頻繁，請稍後再試'})
            rid, key = secrets.token_hex(4), secrets.token_urlsafe(16)
            with locked(): write(rid, {'id': rid, 'key': key, 'created': now, 'updated': now, **clean(d), 'history': []})
            return self.json(200, {'id': rid, 'key': key, 'updated': now})
        sub = self.rid('/submit')
        rid = sub or self.rid()
        with locked():
            rec = rid and read(rid)
            if not rec: return self.json(404, {'error': '找不到這張需求單'})
            if not secrets.compare_digest(str(d.get('key', '')), rec['key']): return self.json(403, {'error': '這台裝置沒有修改權限'})
            now = time.time()
            if sub:
                job = rec.get('job') or {}
                if job.get('state') in ('queued', 'working'): return self.json(409, {'error': '已經在排隊或設計中', 'job': job})
                if not rec.get('items'): return self.json(400, {'error': '需求單是空的，先寫幾項需求'})
                allrecs = [json.load(open(f)) for f in glob.glob(os.path.join(DATA, '*.json'))]
                if sum(1 for r in allrecs if (r.get('job') or {}).get('state') in ('queued', 'working')) >= QUEUE_MAX:
                    return self.json(503, {'error': '目前排隊的需求單太多，請稍後再送出'})
                if sum(1 for r in allrecs for t in r.get('submits', []) if now - t < 86400) >= SUBMITS_ALL_DAY:
                    return self.json(503, {'error': '今天的設計名額已滿，請明天再送出'})
                if limited('submit', self.ip(), SUBMITS_PER_IP_DAY, 86400): return self.json(429, {'error': '今天送出太多次了，請明天再試'})
                recent = [t for t in rec.get('submits', []) if now - t < 86400]
                if len(recent) >= SUBMITS_PER_DAY: return self.json(429, {'error': f'每張需求單一天最多送出 {SUBMITS_PER_DAY} 次'})
                rec['submits'] = recent + [now]
                rec['job'] = {'state': 'queued', 'at': now, 'rev': rec.get('updated')}
                write(rid, rec)
                return self.json(200, {'job': rec['job']})
            old = {k: rec.get(k) for k in ('items', 'note', 'name', 'unit', 'scheme', 'updated')}
            rec['history'] = (rec.get('history') or [])[-19:] + [old]   # 留最近 20 版
            rec.update(clean(d)); rec['updated'] = now
            write(rid, rec)
        self.json(200, {'id': rid, 'updated': rec['updated']})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 17089))
    host = os.environ.get('HOST', '127.0.0.1')            # Railway 要設 0.0.0.0
    http.server.ThreadingHTTPServer((host, port), H).serve_forever()
