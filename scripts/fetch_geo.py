#!/usr/bin/env python3
"""抓周邊真實圖資原料到 scripts/geo_raw/（只需跑一次；bake_geo.py 再轉成前端用的 js/geo-data.json）
- 建物輪廓：Overture Maps（OpenStreetMap＋衛星影像 AI 輪廓），少數有樓層／高度
- 道路、水域、綠地、捷運：OpenStreetMap（Overpass）
- 地形：AWS Terrain Tiles（terrarium PNG）
"""
import json, math, os, sys, time, urllib.request, urllib.parse
RAW = os.path.join(os.path.dirname(__file__), 'geo_raw')
LAT0, LON0 = 25.0791, 121.5871            # 基地附近（文德路207巷）
B_R, T_R = 2600, 4500                      # 建物／地形半徑（m）
dlat = lambda m: m / 111000
dlon = lambda m: m / (111000 * math.cos(math.radians(LAT0)))
UA = {'User-Agent': 'dugeng-sample-house/1.0'}

WEST = (121.5455, 25.0700, 121.5615, 25.0960)   # 往西補到美麗華摩天輪（約 3km）：lon1, lat1, lon2, lat2

def overture(box=None, name='buildings'):
    import duckdb
    c = duckdb.connect(); c.sql("INSTALL spatial;LOAD spatial;INSTALL httpfs;LOAD httpfs;SET s3_region='us-west-2';")
    x1, x2, y1, y2 = LON0 - dlon(B_R), LON0 + dlon(B_R), LAT0 - dlat(B_R), LAT0 + dlat(B_R)
    if box: x1, y1, x2, y2 = box
    rows = c.sql(f"""SELECT id, sources[1].dataset src, height, num_floors, min_height, class, ST_AsGeoJSON(geometry) g
      FROM read_parquet('s3://overturemaps-us-west-2/release/2026-09-23.1/theme=buildings/type=building/*', hive_partitioning=1)
      WHERE bbox.xmin>{x1} AND bbox.xmax<{x2} AND bbox.ymin>{y1} AND bbox.ymax<{y2}""").fetchall()
    out = [dict(id=r[0], src=r[1], h=r[2], f=r[3], minh=r[4], cls=r[5], g=json.loads(r[6])) for r in rows]
    json.dump(out, open(f'{RAW}/{name}.json', 'w'))
    print(name, len(out))

def overture_west(): overture(WEST, 'buildings_west')
SW = (121.5440, 25.0300, 121.5800, 25.0690)     # 往西南補到大巨蛋／小巨蛋（約 5km）
def overture_sw(): overture(SW, 'buildings_sw')

def overpass():
    s, w, n, e = LAT0 - dlat(T_R * 0.8), LON0 - dlon(T_R * 0.8), LAT0 + dlat(T_R * 0.8), LON0 + dlon(T_R * 0.8)
    bb = f'({s},{w},{n},{e})'
    q = f"""[out:json][timeout:120];(
      way["highway"]{bb};
      way["railway"~"subway|light_rail|rail"]{bb};
      way["natural"~"water|wood|scrub"]{bb};
      way["waterway"~"river|stream|canal"]{bb};
      way["leisure"~"park|pitch|golf_course|garden"]{bb};
      way["landuse"~"grass|forest|cemetery|recreation_ground|meadow"]{bb};
      way["amenity"~"school|university|college"]{bb};
    );out geom tags;"""
    for i in range(8):
        for m in ['overpass-api.de/api/interpreter', 'overpass.private.coffee/api/interpreter', 'overpass.kumi.systems/api/interpreter']:
            try:
                req = urllib.request.Request('https://' + m, data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
                d = json.load(urllib.request.urlopen(req, timeout=180))
                json.dump(d, open(f'{RAW}/osm.json', 'w')); print('osm', len(d['elements']), m); return
            except Exception as ex: print('retry', m, ex)
        time.sleep(10 * (i + 1))
    sys.exit('overpass failed')

def peaks():                               # 山頂標高（30m 地形會把小山削低，bake 時用來校正）
    s, w, n, e = LAT0 - dlat(T_R * 0.8), LON0 - dlon(T_R * 0.8), LAT0 + dlat(T_R * 0.8), LON0 + dlon(T_R * 0.8)
    q = f'[out:json][timeout:60];node["natural"~"peak|hill"]["ele"]({s},{w},{n},{e});out;'
    for i in range(8):
        for m in ['overpass-api.de/api/interpreter', 'overpass.private.coffee/api/interpreter', 'overpass.kumi.systems/api/interpreter']:
            try:
                req = urllib.request.Request('https://' + m, data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
                d = json.load(urllib.request.urlopen(req, timeout=120)); json.dump(d, open(f'{RAW}/peaks.json', 'w')); print('peaks', len(d['elements'])); return
            except Exception as ex: print('retry', m, ex)
        time.sleep(10 * (i + 1))
    sys.exit('overpass failed')

def relations():                           # 多段邊界的水域（碧湖、基隆河），需要 out geom 才有成員座標
    s, w, n, e = LAT0 - dlat(T_R * 0.8), LON0 - dlon(T_R * 0.8), LAT0 + dlat(T_R * 0.8), LON0 + dlon(T_R * 0.8)
    q = f'[out:json][timeout:120];(relation["natural"="water"]({s},{w},{n},{e});relation["waterway"="riverbank"]({s},{w},{n},{e}););out geom;'
    for i in range(8):
        try:
            req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(), headers=UA)
            d = json.load(urllib.request.urlopen(req, timeout=180)); json.dump(d, open(f'{RAW}/osm_rel.json', 'w')); print('relations', len(d['elements'])); return
        except Exception as ex: print('retry', ex); time.sleep(10 * (i + 1))
    sys.exit('overpass failed')

def terrain(z=14, R=T_R):
    def tile(lat, lon):
        n = 2 ** z; x = (lon + 180) / 360 * n
        y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        return int(x), int(y)
    xa, ya = tile(LAT0 + dlat(R), LON0 - dlon(R)); xb, yb = tile(LAT0 - dlat(R), LON0 + dlon(R))
    os.makedirs(f'{RAW}/terrain', exist_ok=True)
    for x in range(xa, xb + 1):
        for y in range(ya, yb + 1):
            p = f'{RAW}/terrain/{z}_{x}_{y}.png'
            if not os.path.exists(p):
                urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', p)
    json.dump(dict(z=z, x0=xa, y0=ya, x1=xb, y1=yb), open(f'{RAW}/terrain/index{z}.json', 'w'))
    print('terrain tiles', (xb - xa + 1) * (yb - ya + 1))

def terrain_far(): terrain(12, 15000)   # 遠景山脈（陽明山、南港山）

if __name__ == '__main__':
    os.makedirs(RAW, exist_ok=True)
    for name in sys.argv[1:] or ['terrain', 'terrain_far', 'overpass', 'peaks', 'relations', 'overture', 'overture_west', 'overture_sw']: globals()[name]()
