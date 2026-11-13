# 下載 Poly Haven（CC0）貼圖與家具模型原檔到 scripts/asset_raw/（不進版控），再跑 scripts/build_assets.sh 轉成 assets/
import json, sys, urllib.request, os
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "asset_raw"); os.makedirs(out, exist_ok=True)
tex = {'laminate_floor_02': ['Diffuse','nor_gl'], 'oak_veneer_01': ['Diffuse','nor_gl'],
       'rough_linen': ['Diffuse','nor_gl'], 'curly_teddy_natural': ['Diffuse','nor_gl'], 'plastered_wall_04': ['nor_gl'], 'long_white_tiles': ['Diffuse','nor_gl'], 'large_square_pattern_01': ['Diffuse','nor_gl']}
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'dugeng'})).read()
for k, maps in tex.items():
    f = json.loads(get(f'https://api.polyhaven.com/files/{k}'))
    for m in maps:
        u = f[m]['1k']['jpg']['url']; open(os.path.join(out, f'{k}_{m}.jpg'), 'wb').write(get(u)); print(k, m)
models = ['modern_ceiling_lamp_01','modern_wooden_cabinet','potted_plant_02','desk_lamp_arm_01','outdoor_table_chair_set_01','potted_plant_04','modern_coffee_table_01','modern_arm_chair_01']
for k in models:
    f = json.loads(get(f'https://api.polyhaven.com/files/{k}'))['gltf']['1k']['gltf']
    d = os.path.join(out, k); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, os.path.basename(f['url'])), 'wb').write(get(f['url']))
    for rel, v in f.get('include', {}).items():
        p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(get(v['url']))
    print(k, 'ok')
