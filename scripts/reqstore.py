# 需求單檔案存取：serve.py（網站）和 req_worker.py（Claude Code 工作機）是兩個行程，用 flock 鎖同一把鎖
import os, json, fcntl, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('DUGENG_DATA') or os.path.join(HERE, '..', 'data', 'requirements')
CUSTOM = os.environ.get('DUGENG_CUSTOM') or os.path.join(HERE, '..', 'data', 'custom')
for d in (DATA, CUSTOM): os.makedirs(d, exist_ok=True)

@contextlib.contextmanager
def locked():
    with open(os.path.join(DATA, '.lock'), 'w') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(f, fcntl.LOCK_UN)

def path(rid): return os.path.join(DATA, rid + '.json')

def read(rid):
    try:
        with open(path(rid)) as f: return json.load(f)
    except (OSError, ValueError): return None

def write(rid, rec):
    tmp = path(rid) + '.tmp'
    with open(tmp, 'w') as f: json.dump(rec, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path(rid))

def set_job(rid, **job):
    """工作機更新進度（鎖住、只改 job 欄位，不碰使用者正在改的內容）"""
    with locked():
        rec = read(rid)
        if not rec: return None
        rec['job'] = {**(rec.get('job') or {}), **job}
        write(rid, rec)
        return rec
