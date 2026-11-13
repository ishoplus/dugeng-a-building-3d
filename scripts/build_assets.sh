#!/bin/bash
# scripts/asset_raw/（fetch_assets.py 下載的原檔）→ assets/：貼圖轉 webp、模型轉 glb（webp 貼圖、量化頂點）
# 布料／木紋／地毯轉灰階並把平均亮度拉到 ~0.86，顏色交給 materials.js 的裝潢風格去乘
# 需要：ffmpeg、cwebp、gltf-transform（npm i -g @gltf-transform/cli 或 GT=路徑）
set -e
cd "$(dirname "$0")/.."
RAW=scripts/asset_raw; OUT=assets; GT=${GT:-gltf-transform}
mkdir -p $OUT/tex $OUT/models
tmp=$(mktemp -d)
gray() {   # 灰階＋亮度正規化
  local mean; mean=$(ffmpeg -v error -i "$1" -vf format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=- -f null - | grep -o 'YAVG=[0-9.]*' | cut -d= -f2)
  local k; k=$(python3 -c "print(min(2.5, 219/$mean))")
  ffmpeg -v error -y -i "$1" -vf "format=gray,lutyuv=y='clip(val*$k,0,255)'" "$tmp/g.png"
  cwebp -quiet -q 82 "$tmp/g.png" -o "$2"
}
col() { cwebp -quiet -q "${3:-82}" "$1" -o "$2"; }
col $RAW/laminate_floor_02_Diffuse.jpg $OUT/tex/floor_col.webp
col $RAW/laminate_floor_02_nor_gl.jpg $OUT/tex/floor_nor.webp 90
gray $RAW/oak_veneer_01_Diffuse.jpg $OUT/tex/oak_gray.webp
col $RAW/oak_veneer_01_nor_gl.jpg $OUT/tex/oak_nor.webp 90
gray $RAW/rough_linen_Diffuse.jpg $OUT/tex/linen_gray.webp
col $RAW/rough_linen_nor_gl.jpg $OUT/tex/linen_nor.webp 90
gray $RAW/curly_teddy_natural_Diffuse.jpg $OUT/tex/teddy_gray.webp
col $RAW/curly_teddy_natural_nor_gl.jpg $OUT/tex/teddy_nor.webp 90
col $RAW/plastered_wall_04_nor_gl.jpg $OUT/tex/plaster_nor.webp 85
gray $RAW/long_white_tiles_Diffuse.jpg $OUT/tex/subway_gray.webp
col $RAW/long_white_tiles_nor_gl.jpg $OUT/tex/subway_nor.webp 90
for d in modern_ceiling_lamp_01 modern_wooden_cabinet potted_plant_02 modern_coffee_table_01 desk_lamp_arm_01; do
  $GT optimize $RAW/$d/*.gltf $OUT/models/$d.glb --compress quantize --texture-compress webp --texture-size 1024 --simplify false >/dev/null
done
rm -rf "$tmp"
ls -la $OUT/tex $OUT/models
