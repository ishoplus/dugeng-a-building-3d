#!/usr/bin/env python3
"""把 scripts/geo_raw/ 的真實圖資轉成模型座標，輸出 js/geo-data.json（前端 city.js 讀取）

座標：模型 +x＝平面右、-z＝平面上；北方＝平面上方往東偏 9°（同 main.js PLAN_NORTH）。
對位：文德路北側車道中心線對齊模型 30M 道路北半、文德路207巷對齊北側 6M 巷（TX, TZ 由兩條路的實際位置求得）。
高度：Overture／OSM 有樓層或高度就用，沒有就依輪廓面積估（標 est=1）。地形以盆地面 BASE 為 0，基地周邊壓平。
"""
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, 'geo_raw')
OUT = os.path.join(HERE, '..', 'js', 'geo-data.json')
LAT0, LON0 = 25.0791, 121.5871
NORTH = math.radians(9)
TX, TZ = 15.0, -10.0
KX = 111000 * math.cos(math.radians(LAT0)); KY = 111000
C, S = math.cos(NORTH), math.sin(NORTH)
SITE = (-45, -30, 95, 22)                 # 基地街廓（舊建物拆除、道路由模型自畫）
BASE = 22.0                               # 盆地地面海拔（m），以下視為 0
FLAT_BOX, FLAT_D0, FLAT_D1 = (-60, -24, 110, 50), 8, 45   # 只壓平基地街廓＋北側巷＋文德路，外 8～45m 漸變回真實地形（後山獅頭山緊鄰北側）
FLOOR_H = 3.2

def to_w(lon, lat):
    e, n = (lon - LON0) * KX, (lat - LAT0) * KY
    return e * C + n * S + TX, e * S - n * C + TZ

def to_ll(x, z):
    x, z = x - TX, z - TZ
    e, n = x * C + z * S, x * S - z * C      # 反射矩陣，反矩陣是自己
    return LON0 + e / KX, LAT0 + n / KY

# ---------- 地形（z14 近、z12 遠）
class DEM:
    def __init__(self, z):
        ix = json.load(open(f'{RAW}/terrain/index{z}.json')); self.z = z; self.ix = ix
        nx, ny = ix['x1'] - ix['x0'] + 1, ix['y1'] - ix['y0'] + 1
        H = np.zeros((ny * 256, nx * 256), np.float32)
        for i in range(nx):
            for j in range(ny):
                a = np.asarray(Image.open(f"{RAW}/terrain/{z}_{ix['x0'] + i}_{ix['y0'] + j}.png").convert('RGB')).astype(np.float32)
                H[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        self.H = np.maximum(H, 0)
    def px(self, lon, lat):
        n = 2 ** self.z
        x = ((lon + 180) / 360 * n - self.ix['x0']) * 256
        y = ((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n - self.ix['y0']) * 256
        return x - 0.5, y - 0.5
    def sample(self, lon, lat):
        x, y = self.px(lon, lat); h, w = self.H.shape
        if not (0 <= x < w - 1 and 0 <= y < h - 1): return None
        x0, y0 = int(x), int(y); fx, fy = x - x0, y - y0; H = self.H
        return float(H[y0, x0] * (1 - fx) * (1 - fy) + H[y0, x0 + 1] * fx * (1 - fy) + H[y0 + 1, x0] * (1 - fx) * fy + H[y0 + 1, x0 + 1] * fx * fy)

near, far = DEM(14), DEM(12)
def dem(lon, lat):
    h = near.sample(lon, lat)
    return far.sample(lon, lat) or 0 if h is None else h
# 山頂校正：30m 地形把小山削低（獅頭山原始資料只到約 45m，OSM 標 58m），以 OSM 標高補一個高斯隆起
PEAKS = []
for e in json.load(open(f'{RAW}/peaks.json'))['elements']:
    try: ele = float(e['tags']['ele'])
    except ValueError: continue
    px, pz = to_w(e['lon'], e['lat']); dd = ele - dem(e['lon'], e['lat'])
    if math.hypot(px - 25, pz) < 4000 and dd > 2: PEAKS.append((px, pz, dd))
def elev(x, z):
    lon, lat = to_ll(x, z)
    h = dem(lon, lat) + sum(dd * math.exp(-((x - px) ** 2 + (z - pz) ** 2) / (2 * 55 ** 2)) for px, pz, dd in PEAKS)
    h = max(0.0, h - BASE)
    bx0, bz0, bx1, bz1 = FLAT_BOX
    d = math.hypot(max(bx0 - x, 0, x - bx1), max(bz0 - z, 0, z - bz1))
    t = min(1, max(0, (d - FLAT_D0) / (FLAT_D1 - FLAT_D0)))
    return h * t * t * (3 - 2 * t)

def axis():                                # 近處 20m 一格（後山），500m 外 40m，3km 外逐漸放寬到 15km
    v, s, a = [0.0], 20.0, 0.0
    while a < 15000:
        a += s; v.append(a)
        if a >= 500: s = max(s, 40.0)
        if a > 3000: s *= 1.06
    return [-x for x in v[:0:-1]] + v

xs = [round(x + 25) for x in axis()]; zs = [round(z) for z in axis()]
raw = np.array([[elev(x, z) for x in xs] for z in zs], np.float32)
# 3x3 平滑去雜訊（30m 原始資料在盆地內有 ±10m 起伏）
pad = np.pad(raw, 1, mode='edge')
Hs = sum(pad[1 + dy:1 + dy + raw.shape[0], 1 + dx:1 + dx + raw.shape[1]] * w
         for dy, dx, w in [(0, 0, .25), (-1, 0, .125), (1, 0, .125), (0, -1, .125), (0, 1, .125), (-1, -1, .0625), (-1, 1, .0625), (1, -1, .0625), (1, 1, .0625)])
xs_a, zs_a = np.array(xs, float), np.array(zs, float)
def ground(x, z):                          # 與前端地形網格相同的雙線性內插
    i = int(np.clip(np.searchsorted(xs_a, x) - 1, 0, len(xs) - 2)); j = int(np.clip(np.searchsorted(zs_a, z) - 1, 0, len(zs) - 2))
    fx = (x - xs[i]) / (xs[i + 1] - xs[i]); fz = (z - zs[j]) / (zs[j + 1] - zs[j])
    fx, fz = min(1, max(0, fx)), min(1, max(0, fz))
    return float(Hs[j, i] * (1 - fx) * (1 - fz) + Hs[j, i + 1] * fx * (1 - fz) + Hs[j + 1, i] * (1 - fx) * fz + Hs[j + 1, i + 1] * fx * fz)

# ---------- OSM
osm = [e for e in json.load(open(f'{RAW}/osm.json'))['elements'] if e['type'] == 'way'] + json.load(open(f'{RAW}/osm_rel.json'))['elements']
def ring(geom): return [to_w(p['lon'], p['lat']) for p in geom if p]
def area(pts): return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2
def inside(x, z, r): return r[0] < x < r[2] and r[1] < z < r[3]
def simplify(pts, tol=0.6):              # Douglas-Peucker
    if len(pts) < 3: return pts
    (ax, az), (bx, bz) = pts[0], pts[-1]; dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz)
    d = [abs(dx * (z - az) - dz * (x - ax)) / L if L > 1e-6 else math.hypot(x - ax, z - az) for x, z in pts[1:-1]]
    i = max(range(len(d)), key=d.__getitem__)
    if d[i] < tol: return [pts[0], pts[-1]]
    return simplify(pts[:i + 2], tol)[:-1] + simplify(pts[i + 1:], tol)

def stitch(ways):                          # relation 外框：首尾相接成環
    ways = [w[:] for w in ways if len(w) > 1]; rings = []
    while ways:
        r = ways.pop(0)
        while r[0] != r[-1]:
            for i, w in enumerate(ways):
                if w[0] == r[-1]: r += w[1:]
                elif w[-1] == r[-1]: r += w[::-1][1:]
                elif w[-1] == r[0]: r = w + r[1:]
                elif w[0] == r[0]: r = w[::-1] + r[1:]
                else: continue
                ways.pop(i); break
            else: break
        if len(r) > 3: rings.append(r)
    return rings

WIDTH = {'motorway': 24, 'motorway_link': 7, 'trunk_link': 7, 'primary_link': 7, 'secondary_link': 7, 'tertiary_link': 6, 'trunk': 20, 'primary': 16, 'secondary': 14, 'tertiary': 10, 'unclassified': 7, 'residential': 6.5,
         'living_street': 5, 'service': 4.5, 'pedestrian': 4, 'footway': 2.2, 'path': 1.6, 'steps': 2, 'cycleway': 2.5, 'track': 3}
CLS = {'motorway': 0, 'motorway_link': 0, 'trunk_link': 0, 'primary_link': 0, 'secondary_link': 0, 'tertiary_link': 0, 'trunk': 0, 'primary': 0, 'secondary': 0, 'tertiary': 0, 'unclassified': 1, 'residential': 1, 'living_street': 1, 'service': 1,
       'pedestrian': 2, 'footway': 2, 'path': 2, 'steps': 2, 'cycleway': 2, 'track': 2}
ROAD_R = 2600
WEST = (121.5455, 25.0700, 121.5615, 25.0960)   # 同 fetch_geo.py：往西補到美麗華的建物／道路
def in_west(x, z):
    lon, lat = to_ll(x, z); return WEST[0] < lon < WEST[2] and WEST[1] < lat < WEST[3]
SW = (121.5440, 25.0300, 121.5800, 25.0690)    # 同 fetch_geo.py：往西南補到大巨蛋／小巨蛋（約 5km），道路只有 OSM 範圍內的主要道路
def in_sw(x, z):
    lon, lat = to_ll(x, z); return SW[0] < lon < SW[2] and SW[1] < lat < SW[3]
roads, rails, water, green, wood, cars = [], [], [], [], [], []
# 高架道路：bridge／viaduct 或 layer≥1 的車道另外輸出，橋面高度依 layer 估（未逐段查證），接地端以 6% 坡度爬升
LAYER_H = {1: 8, 2: 15, 3: 22, 4: 30}
def layer(t):
    try: return int(t.get('layer', '0'))
    except ValueError: return 0
key = lambda p: (round(p['lon'], 7), round(p['lat'], 7))
elev_ways, grounded = [], set()
q = lambda v: round(v * 10)              # 公分→十公分整數
flat = lambda pts: [q(c) for p in pts for c in p]

for e in osm:
    t = e.get('tags', {}); g = e.get('geometry')
    hw = t.get('highway')
    if hw and g and hw in WIDTH and t.get('tunnel') not in ('yes', 'building_passage') and t.get('layer', '0')[:1] != '-' and t.get('area') != 'yes':
        pts = ring(g)
        if t.get('name') == '文德路207巷': continue                       # 模型自畫北側 6M 巷
        if not any(math.hypot(x - 25, z) < ROAD_R or in_west(x, z) or (CLS[hw] == 0 and in_sw(x, z)) for x, z in pts): continue
        if CLS[hw] == 2 and not any(math.hypot(x - 25, z) < 900 for x, z in pts): continue
        if t.get('name') != '文德路' and all(inside(x, z, SITE) for x, z in pts): continue
        w = WIDTH[hw]
        if hw in ('secondary', 'primary', 'tertiary') and t.get('oneway') == 'yes': w = {'secondary': 12.5, 'primary': 13, 'tertiary': 8}[hw]
        if t.get('width'):
            try: w = float(t['width'].split()[0])
            except ValueError: pass
        if hw in ('motorway', 'trunk') and t.get('oneway') == 'yes' and not t.get('width'): w = {'motorway': 12, 'trunk': 11}[hw]
        if CLS[hw] < 2 and (t.get('bridge') in ('yes', 'viaduct') or layer(t) >= 1):
            elev_ways.append((w, LAYER_H.get(min(4, max(1, layer(t))), 8), key(g[0]), key(g[-1]), simplify(pts, 0.4))); continue
        if CLS[hw] < 2: grounded.update(key(p) for p in g if p)
        pts = simplify(pts, 0.4)
        roads.append([q(w), CLS[hw]] + flat(pts))
        if t.get('name') == '文德路' and t.get('oneway') == 'yes' and len(g) > 8:
            L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            if L > 300 and any(math.hypot(x - 25, z) < 200 for x, z in pts): cars.append(flat(pts))
    rw = t.get('railway')
    if rw in ('subway', 'light_rail', 'rail') and g and (t.get('bridge') or t.get('layer', '0')[:1] not in ('-', '0')) and t.get('tunnel') is None:
        pts = ring(g)
        if any(math.hypot(x - 25, z) < 3000 for x, z in pts): rails.append(flat(simplify(pts, 0.5)))
    polys = []
    if e['type'] == 'way' and g and len(g) > 3: polys = [ring(g)]
    elif e['type'] == 'relation': polys = stitch([ring(m['geometry']) for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry')])
    for pts in polys:
        if not any(math.hypot(x - 25, z) < 9000 for x, z in pts): continue
        if t.get('natural') == 'water' or t.get('water') or t.get('waterway') == 'riverbank': water.append(pts)
        elif t.get('natural') in ('wood', 'scrub') or t.get('landuse') in ('forest',): wood.append(pts)
        elif t.get('leisure') in ('park', 'garden', 'golf_course', 'dog_park') or t.get('landuse') in ('grass', 'meadow', 'recreation_ground', 'cemetery') or t.get('natural') == 'grassland':
            green.append(pts)

# 端點高度：接到地面道路＝0，否則取相接高架的平均
end_h = {}
for w, H, k0, k1, pts in elev_ways:
    for k in (k0, k1): end_h.setdefault(k, []).append(H)
bridges = []
for w, H, k0, k1, pts in elev_ways:
    e0, e1 = [0.0 if k in grounded else sum(end_h[k]) / len(end_h[k]) for k in (k0, k1)]
    d = [0.0]
    for i in range(1, len(pts)): d.append(d[-1] + math.dist(pts[i - 1], pts[i]))
    tot, out = d[-1], [q(w)]
    for (x, z), s in zip(pts, d):
        r0 = min(1, s / max(1, abs(H - e0) / 0.06)); r1 = min(1, (tot - s) / max(1, abs(H - e1) / 0.06))
        out += [q(x), q(z), q(max(0.0, H + (e0 - H) * (1 - r0) + (e1 - H) * (1 - r1)))]
    bridges.append(out)

# ---------- 湖面：地形網格在水域內壓到水面以下（30m 地形在湖上有起伏，會蓋住湖）
def pip(x, z, pts):
    c = False
    for i in range(len(pts)):
        (x1, z1), (x2, z2) = pts[i - 1], pts[i]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1: c = not c
    return c
water_y = []
for pts in water:
    shore = sorted(ground(x, z) for x, z in pts); wy = shore[len(shore) // 5]
    water_y.append(wy)
    if area(pts) < 1500: continue
    xs_, zs_ = [p[0] for p in pts], [p[1] for p in pts]
    i0, i1 = np.searchsorted(xs_a, min(xs_)), np.searchsorted(xs_a, max(xs_)); j0, j1 = np.searchsorted(zs_a, min(zs_)), np.searchsorted(zs_a, max(zs_))
    for j in range(max(0, j0 - 1), min(len(zs), j1 + 1)):
        for i in range(max(0, i0 - 1), min(len(xs), i1 + 1)):
            # 水域內，或離岸 25m 內的格點都壓下去（網格 40m，否則岸邊三角形會切過湖面）
            if pip(xs[i], zs[j], pts) or min(math.hypot(xs[i] - x, zs[j] - z) for x, z in pts) < 25:
                Hs[j, i] = min(Hs[j, i], wy - 0.4)

# ---------- 綠地遮罩（10m 柵格，地形著色用）
MR, MS = 9000, 10
mask_img = Image.new('L', (2 * MR // MS, 2 * MR // MS), 0); dr = ImageDraw.Draw(mask_img)
mp = lambda pts: [((x - 25 + MR) / MS, (z + MR) / MS) for x, z in pts]
for pts in wood: dr.polygon(mp(pts), fill=255)
for pts in green: dr.polygon(mp(pts), fill=170)
for pts in water: dr.polygon(mp(pts), fill=0)
M = np.asarray(mask_img)
def maskv(x, z):
    i, j = int((x - 25 + MR) / MS), int((z + MR) / MS)
    return int(M[j, i]) if 0 <= i < M.shape[1] and 0 <= j < M.shape[0] else 0
tmask = [maskv(x, z) // 85 for z in zs for x in xs]   # 0 無、2 綠地、3 林地

# ---------- 平地綠地／水面（攤平 overlay）
def flat_poly(pts, y=None):
    pts = simplify(pts + [pts[0]], 0.5)[:-1]
    if y is None: y = min(ground(x, z) for x, z in pts)
    return [q(y)] + flat(pts)
water_out = [flat_poly(p, wy) for p, wy in zip(water, water_y) if area(p) > 30]
green_out = [flat_poly(p) for p in green if area(p) > 40 and min(math.hypot(x - 25, z) for x, z in p) < 1800
             and max(ground(x, z) for x, z in p) < 1.0]

# ---------- 公園／林地樹木
rnd = random.Random(20261016); trees = []
for pts, dens in [(p, 1 / 70) for p in green] + [(p, 1 / 45) for p in wood]:
    a = area(pts)
    if a < 150 or min(math.hypot(x - 25, z) for x, z in pts) > 1400: continue
    xs_, zs_ = [p[0] for p in pts], [p[1] for p in pts]
    for _ in range(min(int(a * dens), 900)):
        x, z = rnd.uniform(min(xs_), max(xs_)), rnd.uniform(min(zs_), max(zs_))
        if pip(x, z, pts) and not inside(x, z, SITE) and not any(pip(x, z, w) for w in water if abs(w[0][0] - x) < 600): trees.append((x, z))
trees = trees[:9000]

# ---------- 建物
bl = json.load(open(f'{RAW}/buildings.json')); seen = {b['id'] for b in bl}
bl += [b for b in json.load(open(f'{RAW}/buildings_west.json')) if b['id'] not in seen]; seen = {b['id'] for b in bl}
bl += [dict(b, sw=1) for b in json.load(open(f'{RAW}/buildings_sw.json')) if b['id'] not in seen]; bout = []; nest = 0
DROP = {'7de041aa-611', '054957e0-21c', '6ecf1ca2-e55'}   # 大巨蛋、小巨蛋、101（含購物中心整塊拉到 508m）輪廓，改由地標畫
FIX_H = {'2d955bf3-95a': 30,              # 美麗華百樂園（OSM 無高度；摩天輪輪底約在屋頂、離地 30m）
         'b8601a53-728': 14}              # 內湖高中游泳館：池在 2 樓（全國運動場館資訊網），推估 3 層
# 有可靠來源的高度（不標估）：內湖高中 115 學年度校舍配置圖，A～D 棟與實踐樓（特科）皆 5 層，學校樓層高約 3.6m
REAL_H = {k: 19.5 for k in ('446490db-701', 'be218ae2-be4', '0f8bc890-d13', 'ede79030-e9b', '957be885-a27')}
def est_floors(a, cls, r):
    if cls in ('roof', 'carport'): return 0.4
    if a < 45: return 1 + (r < 0.5)
    if a < 120: return 3 + (r < 0.4)
    if a < 350: return 4 + (r < 0.5)
    if a < 900: return 5 + int(r * 3)
    return 6 + int(r * 6)
for b in bl:
    pts = ring_pts = [to_w(lon, lat) for lon, lat in b['g']['coordinates'][0]]
    if pts[0] == pts[-1]: pts = pts[:-1]
    if len(pts) < 3: continue
    cx, cz = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    if inside(cx, cz, SITE): continue
    a = area(pts)
    if a < 12 or b['id'][:12] in DROP: continue
    if b.get('sw') and a < 150 and not b['h'] and (b['f'] or 0) < 4: continue   # 遠處西南區只留看得到的樓，控制資料量
    h, est = None, 0
    fix = next((v for k, v in FIX_H.items() if b['id'].startswith(k)), None)
    if fix: h, est = fix, 1
    elif b['id'][:12] in REAL_H: h = REAL_H[b['id'][:12]]
    elif b['h']: h = b['h']
    elif b['f']: h = b['f'] * FLOOR_H + 1
    else:
        rr = random.Random(b['id']).random()
        h = est_floors(a, b['cls'], rr) * FLOOR_H + 0.8; est = 1; nest += 1
    pts = simplify(pts + [pts[0]], 0.35)[:-1]
    if len(pts) < 3: continue
    y0 = min(ground(x, z) for x, z in pts) - 0.6
    bout.append([q(h), est, q(y0)] + flat(pts))

# ---------- 地標：美麗華摩天輪（OSM node 5121602758，height=100；直徑 70m，輪面朝向未查證，暫定正對基地）
wx, wz = to_w(121.5577156, 25.082807)
landmarks = [{'type': 'wheel', 'x': round(wx, 1), 'z': round(wz, 1), 'y0': round(ground(wx, wz), 1), 'top': 100, 'd': 70,
              'yaw': round(math.atan2(25 - wx, 0 - wz), 3)}]
# 台北 101（約 5.5km、建物資料範圍外單獨放）：屋頂 449m、尖塔頂 508m，方正對齊正北
# 大巨蛋：Overture 輪廓中心、地上 64m（公視報導）、輪廓等面積半徑約 100m
dx_, dz_ = to_w(121.559404, 25.042419)
landmarks.append({'type': 'dome', 'x': round(dx_, 1), 'z': round(dz_, 1), 'y0': round(ground(dx_, dz_), 1), 'r': 100, 'top': 64})
# 小巨蛋：Overture 輪廓擠出，地上 5 層，屋頂高未查證暫定 40m，外觀用淺色金屬與一般樓區分
arena = next(b for b in bl if b['id'].startswith('054957e0-21c'))
apts = simplify([to_w(lon, lat) for lon, lat in arena['g']['coordinates'][0]], 0.5)[:-1]
landmarks.append({'type': 'arena', 'top': 40, 'y0': round(min(ground(x, z) for x, z in apts), 1), 'pts': flat(apts)})
tx_, tz_ = to_w(121.56452, 25.03390)
landmarks.append({'type': 'tower101', 'x': round(tx_, 1), 'z': round(tz_, 1), 'y0': round(ground(tx_, tz_), 1), 'yaw': round(-NORTH, 3)})

# 漫遊「看景」目標：世界座標＋瞄準高度（101 瞄上段、湖瞄湖面）
def centroid(pts): return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
lake = next(w for w in water_out if pip(-231, -325, [(w[i] / 10, w[i + 1] / 10) for i in range(1, len(w), 2)]))
lx_, lz_ = centroid([(lake[i] / 10, lake[i + 1] / 10) for i in range(1, len(lake), 2)])
ax_, az_ = centroid(apts)
views = [{'name': '101', 'x': round(tx_, 1), 'z': round(tz_, 1), 'y': 300}, {'name': '摩天輪', 'x': round(wx, 1), 'z': round(wz, 1), 'y': 65},
         {'name': '大巨蛋', 'x': round(dx_, 1), 'z': round(dz_, 1), 'y': 40}, {'name': '小巨蛋', 'x': round(ax_, 1), 'z': round(az_, 1), 'y': 25},
         {'name': '碧湖', 'x': round(lx_, 1), 'z': round(lz_, 1), 'y': 0}]

data = {
    'note': '周邊真實圖資：建物輪廓 Overture Maps（含 OpenStreetMap）、道路水域綠地 OpenStreetMap、地形 AWS Terrain Tiles；座標為模型公尺×10',
    'buildings': bout, 'roads': roads, 'bridges': bridges, 'rails': rails, 'water': water_out, 'green': green_out,
    'trees': [q(c) for p in trees for c in p], 'cars': cars, 'landmarks': landmarks, 'views': views,
    'terrain': {'xs': xs, 'zs': zs, 'h': [q(v) for v in Hs.flatten()], 'mask': tmask},
}
json.dump(data, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f"buildings {len(bout)}（估高 {nest}） roads {len(roads)} bridges {len(bridges)} rails {len(rails)} water {len(water_out)} green {len(green_out)} trees {len(trees)} cars {len(cars)} terrain {len(xs)}x{len(zs)}  max {Hs.max():.0f}m")
print('size', os.path.getsize(OUT) // 1024, 'KB')
