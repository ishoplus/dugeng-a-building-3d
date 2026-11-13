import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CEIL_H } from './plan.js';

// 真實家具模型（Poly Haven，CC0；原檔由 scripts/fetch_assets.py 下載、build_assets.sh 轉檔）
// 家具本地座標：正面朝 +z、y=0 為地板；size＝程式家具的外框 [寬, 高, 深]
// fit：box＝縮放到外框（可不等比）／height＝等比縮放到外框高度、底部置中／top＝原尺寸、頂端貼天花板
const BASE = new URL('assets/models/', document.baseURI);   // 網站根目錄 /assets（程式在版本號目錄，素材不跟著換版）
const DEFS = {
  coffeeTable: { file: 'modern_coffee_table_01.glb', rotY: Math.PI / 2, fit: 'box' },
  tvUnit: { file: 'modern_wooden_cabinet.glb', fit: 'box' },
  plant: { file: 'potted_plant_02.glb', fit: 'height', rotY: 0.6 },
  bistro: { file: 'outdoor_table_chair_set_01.glb', fit: 'height', rotY: Math.PI / 2 },   // 陽台：木條摺疊桌＋兩張椅子
  succulent: { file: 'potted_plant_04.glb', fit: 'height' },
  deskLamp: { file: 'desk_lamp_arm_01.glb', fit: 'height', rotY: Math.PI },
  // 原模型是直徑 43cm 的灰色金屬球罩：縮到 32cm、改白色烤漆，燈泡玻璃換成場景的燈材質（跟著日夜發光）
  pendant: {
    file: 'modern_ceiling_lamp_01.glb', fit: 'top', scale: 0.75,
    mats(m, M) {
      if (/glass/.test(m.name)) return M.lamp;
      if (/globe/.test(m.name)) { Object.assign(m, { map: null, metalnessMap: null, metalness: 0.05, roughness: 0.35 }); m.color.set(0xf1eee8); }
      return m;
    },
  },
};

const loader = new GLTFLoader();
const cache = {};
function load(name, M) {
  return cache[name] ??= loader.loadAsync(new URL(DEFS[name].file, BASE).href).then(gltf => {
    const root = gltf.scene, d = DEFS[name];
    root.rotation.y = d.rotY || 0; root.scale.setScalar(d.scale || 1);
    if (d.mats) root.traverse(o => { if (o.isMesh) o.material = d.mats(o.material, M); });
    const wrap = new THREE.Group(); wrap.add(root); wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    root.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = 8; } });
    return { wrap, box };
  });
}

// 把模型照家具位置放進 group；回傳 Promise，全部好了才 resolve（任何一個失敗就 reject，呼叫端保留程式家具）
export async function placeModels(list, group, M) {
  const names = [...new Set(list.map(m => m.name))].filter(n => DEFS[n]);
  const loaded = Object.fromEntries(await Promise.all(names.map(async n => [n, await load(n, M)])));
  for (const m of list) {
    const L = loaded[m.name]; if (!L) continue;
    const { wrap, box } = L, d = DEFS[m.name], sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const [w, h, dd] = m.size, o = wrap.clone(true);
    if (d.fit === 'box') { o.scale.set(w / sz.x, h / sz.y, dd / sz.z); o.position.set(-c.x * w / sz.x, -box.min.y * h / sz.y, -c.z * dd / sz.z); }
    else if (d.fit === 'height') { const k = h / sz.y; o.scale.setScalar(k); o.position.set(-c.x * k, -box.min.y * k, -c.z * k); }
    else { o.position.set(-c.x, CEIL_H - box.max.y, -c.z); }
    const holder = new THREE.Group(); holder.add(o);
    holder.matrixAutoUpdate = false; holder.matrix.copy(m.matrix); holder.userData.unit = m.unit;
    group.add(holder);
  }
}
