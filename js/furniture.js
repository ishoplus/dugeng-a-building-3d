import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toX, toZ } from './plan.js';

// 圓角：布面（userData.soft）圓角大、硬木櫃只留一點倒角，讓邊緣有高光
const geoCache = new Map();
function rbox(w, h, d, soft) {
  const m = Math.min(w, h, d), r = soft === 'sharp' ? 0 : soft ? Math.min(0.06, m * 0.42) : Math.min(0.006, m * 0.3);
  const key = [w, h, d, soft].map(v => typeof v === 'number' ? v.toFixed(3) : v).join();
  if (!geoCache.has(key)) geoCache.set(key, r < 0.002 || m < 0.012 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, soft ? 3 : 1, r));
  return geoCache.get(key);
}
// 碗形面盆：外徑 20cm、高 12cm，內凹（Lathe 旋轉出來，內外兩層）
let basin = null;
function basinGeo() {
  if (basin) return basin;
  const pts = [[0.0, 0.0], [0.15, 0.0], [0.2, 0.06], [0.205, 0.12], [0.19, 0.12], [0.185, 0.07], [0.14, 0.025], [0.0, 0.025]].map(([x, y]) => new THREE.Vector2(x, y));
  return (basin = new THREE.LatheGeometry(pts, 40));
}
// 葉片：橢圓葉形，沿長軸微彎
let leafGeo = null;
function leaf() {
  if (leafGeo) return leafGeo;
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.06, 0.09, 0, 0.22); sh.quadraticCurveTo(-0.06, 0.09, 0, 0);
  const g = new THREE.ShapeGeometry(sh, 6), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setZ(i, -y * y * 0.9 - Math.abs(x) * 0.25); }
  g.computeVertexNormals();
  return (leafGeo = g);
}

// 家具用基本形體拼出來；本地座標：正面朝 +z、背面朝 -z、y=0 為地板
const FACE = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };

function kit(g) {
  return {
    box(m, w, h, d, x = 0, y = 0, z = 0) {
      const o = new THREE.Mesh(rbox(w, h, d, m.userData.sharp ? 'sharp' : !!m.userData.soft), m); o.position.set(x, y + h / 2, z); g.add(o); return o;
    },
    // 枕頭／抱枕：大圓角再把中間鼓起
    pillow(m, w, h, d, x = 0, y = 0, z = 0) {
      const geo = new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d) * 0.48), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const u = 1 - (2 * p.getX(i) / w) ** 2, v = 1 - (2 * p.getY(i) / h) ** 2; p.setZ(i, p.getZ(i) * (0.55 + 0.45 * Math.max(0, u * v))); }
      geo.computeVertexNormals();
      const o = new THREE.Mesh(geo, m); o.position.set(x, y + h / 2, z); g.add(o); return o;
    },
    // 一叢葉子：從 (x,y,z) 往上長，n 片，高 h、張開半徑 r
    foliage(m, n, h, r, x = 0, y = 0, z = 0, seed = 1, size = 1) {
      let s_ = seed;
      const rnd = () => (s_ = (s_ * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < n; i++) {
        const t = i / n, a = i * 2.39996 + rnd() * 0.4, rr = r * (0.35 + 0.65 * Math.sqrt(1 - t)), hy = y + h * (0.25 + 0.75 * t);
        const o = new THREE.Mesh(leaf(), m), k = size * (0.75 + rnd() * 0.5);
        o.position.set(x + Math.cos(a) * rr * 0.5, hy, z + Math.sin(a) * rr * 0.5);
        o.rotation.set(0, -a + Math.PI / 2, 0); o.rotateX(-0.4 - rnd() * 0.7 + t * 0.5); o.scale.setScalar(k);
        g.add(o);
      }
    },
    cyl(m, rt, rb, h, x = 0, y = 0, z = 0, seg = 20) {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y + h / 2, z); g.add(o); return o;
    },
    ball(m, r, x, y, z, sx = 1, sy = 1, sz = 1) {
      const o = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); g.add(o); return o;
    },
  };
}

const ITEMS = {
  bed(M, w = 1.5, l = 2.0) {
    // 床頭貼牆：床位 y 的 -l/2 約在牆面，床頭板佔最前 10cm，掛畫貼牆面掛在床頭板上方
    const g = new THREE.Group(), k = kit(g), h0 = -l / 2 + 0.04, L = l - 0.12, zc = h0 + 0.08 + L / 2;
    k.box(M.wood, w + 0.06, 0.26, L, 0, 0.04, zc);                               // 床架
    k.box(M.linen, w - 0.04, 0.22, L - 0.06, 0, 0.3, zc);                        // 床墊
    k.box(M.fabric2, w + 0.04, 0.1, L * 0.66, 0, 0.47, zc + L * 0.17);           // 被子（兩側垂下一點）
    k.box(M.fabric2, w - 0.02, 0.05, 0.3, 0, 0.55, zc - L * 0.15).rotation.x = 0.06;
    k.box(M.fabric, w + 0.06, 0.03, 0.5, 0, 0.56, zc + L * 0.32);                // 床尾毯
    const n = Math.max(2, Math.round(w / 0.4)), pw = (w + 0.1) / n;              // 繃布床頭板（直條）
    for (let i = 0; i < n; i++) k.box(M.fabric, pw - 0.01, 1.05, 0.09, -w / 2 - 0.05 + pw * (i + 0.5), 0, h0 + 0.045);
    const pn = w > 1.2 ? 2 : 1;
    for (let i = 0; i < pn; i++) k.pillow(M.linen, w / pn - 0.12, 0.42, 0.16, pn === 1 ? 0 : (i - 0.5) * w / 2, 0.48, h0 + 0.24).rotation.x = -0.28;
    k.pillow(M.fabric, Math.min(0.45, w * 0.3), 0.3, 0.12, 0, 0.5, h0 + 0.4).rotation.x = -0.18;
    const aw = Math.min(1.1, w * 0.7);                                           // 床頭掛畫
    k.box(M.black, aw, aw * 0.6, 0.025, 0, 1.25, h0 - 0.0).userData.art = true;   // 床頭若是窗，build.js 會拿掉
    k.box(M.art2, aw - 0.06, aw * 0.6 - 0.06, 0.01, 0, 1.28, h0 + 0.012).userData.art = true;
    return g;
  },
  nightstand(M, w = 0.45) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.cabinet, w, 0.5, 0.4);
    k.box(M.wood, w + 0.02, 0.03, 0.42, 0, 0.5);
    k.cyl(M.steel, 0.012, 0.012, 0.3, 0, 0.53, -0.05);
    k.cyl(M.lamp, 0.09, 0.12, 0.16, 0, 0.78, -0.05);
    g.userData.light = [0, 0.86, -0.05, 0.45];
    return g;
  },
  wardrobe(M, w = 1.2, slide = false) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.cabinet, w, 2.3, 0.58, 0, 0, -0.01);
    if (slide) {                                                       // 推拉門：兩片前後錯開＋上軌道、內嵌把手
      k.box(M.accent, w, 0.03, 0.06, 0, 2.27, 0.27);
      for (const [x, z] of [[-w / 4 - 0.01, 0.285], [w / 4 + 0.01, 0.305]]) {
        k.box(M.cabinet, w / 2 + 0.02, 2.22, 0.018, x, 0.04, z);
        k.box(M.accent, 0.012, 0.35, 0.006, x + (x < 0 ? w / 4 - 0.06 : -w / 4 + 0.06), 0.95, z + 0.01);
      }
      g.userData.slide = true;
      return g;
    }
    const n = Math.max(2, Math.round(w / 0.5));
    for (let i = 1; i < n; i++) k.box(M.accent, 0.008, 2.2, 0.01, -w / 2 + (w / n) * i, 0.05, 0.285);
    for (let i = 0; i < n; i++) k.box(M.steel, 0.015, 0.3, 0.025, -w / 2 + (w / n) * (i + (i % 2 ? 0.12 : 0.88)), 1.0, 0.29);
    return g;
  },
  desk(M, w = 1.2) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.wood, w, 0.03, 0.6, 0, 0.72, 0);
    for (const sx of [-1, 1]) k.box(M.accent, 0.03, 0.72, 0.55, sx * (w / 2 - 0.04), 0, 0);
    k.box(M.screen, 0.55, 0.32, 0.02, 0, 0.9, -0.2);
    k.box(M.accent, 0.04, 0.16, 0.04, 0, 0.75, -0.2);
    // 椅子
    k.box(M.fabric, 0.45, 0.06, 0.45, 0, 0.44, 0.48);
    k.box(M.fabric, 0.45, 0.45, 0.05, 0, 0.5, 0.7);
    k.cyl(M.accent, 0.02, 0.02, 0.42, 0, 0.02, 0.48, 8);
    k.cyl(M.accent, 0.25, 0.25, 0.03, 0, 0, 0.48, 16);
    return g;
  },
  sofa(M, len = 2.1) {
    const g = new THREE.Group(), k = kit(g);
    for (const sx of [-1, 1]) k.cyl(M.accent, 0.018, 0.012, 0.1, sx * (len / 2 - 0.12), 0, 0.3, 8), k.cyl(M.accent, 0.018, 0.012, 0.1, sx * (len / 2 - 0.12), 0, -0.3, 8);
    k.box(M.fabric, len, 0.3, 0.9, 0, 0.1, 0);                                  // 底座
    k.box(M.fabric, len - 0.3, 0.42, 0.22, 0, 0.36, -0.33);                     // 椅背底
    for (const sx of [-1, 1]) k.box(M.fabric, 0.17, 0.32, 0.9, sx * (len / 2 - 0.085), 0.36, 0);   // 扶手
    const n = Math.max(2, Math.round(len / 0.75)), cw = (len - 0.34) / n;
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.17 + cw * (i + 0.5);
      k.box(M.fabric, cw - 0.015, 0.16, 0.66, x, 0.39, 0.1);                    // 座墊
      k.box(M.fabric, cw - 0.03, 0.46, 0.2, x, 0.5, -0.24).rotation.x = -0.14;  // 背墊
    }
    k.pillow(M.fabric2, 0.44, 0.42, 0.14, -len / 2 + 0.42, 0.5, -0.1).rotation.set(-0.25, 0.25, 0.08);
    k.pillow(M.rug, 0.4, 0.38, 0.13, len / 2 - 0.42, 0.5, -0.1).rotation.set(-0.25, -0.3, -0.06);
    return g;
  },
  coffeeTable(M) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.wood, 1.1, 0.04, 0.55, 0, 0.38, 0);
    k.box(M.accent, 1.0, 0.02, 0.45, 0, 0.12, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(M.accent, 0.03, 0.38, 0.03, sx * 0.5, 0, sz * 0.23);
    k.box(M.fabric2, 0.25, 0.04, 0.18, 0.2, 0.42, 0.05);
    return g;
  },
  tvUnit(M, len = 1.8) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.cabinet, len, 0.42, 0.4, 0, 0.12, 0);
    k.box(M.accent, len - 0.1, 0.12, 0.34, 0, 0, 0);
    const tw = Math.min(len - 0.2, 1.45);
    k.box(M.screen, tw, tw * 0.565, 0.04, 0, 1.0, -0.17);
    k.cyl(M.pot, 0.08, 0.07, 0.16, len / 2 - 0.15, 0.54, 0);
    k.foliage(M.leaf, 14, 0.22, 0.25, len / 2 - 0.15, 0.62, 0, 3, 0.55);
    const bk = [M.accent, M.linen, M.wood, M.fabric, M.fabric2];               // 一排書，最後一本斜靠
    for (let i = 0; i < 5; i++) k.box(bk[i], 0.03 + (i % 3) * 0.006, 0.2 + ((i * 7) % 5) * 0.012, 0.15, -len / 2 + 0.2 + i * 0.042, 0.54, 0).rotation.z = i === 4 ? -0.35 : 0;
    return g;
  },
  dining(M, l = 1.4, w = 0.8, sides = 2) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.wood, l, 0.04, w, 0, 0.72, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(M.accent, 0.04, 0.72, 0.04, sx * (l / 2 - 0.08), 0, sz * (w / 2 - 0.08));
    const per = l >= 1.4 ? 2 : 1;
    for (const sz of sides === 2 ? [-1, 1] : [1]) for (let i = 0; i < per; i++) {
      const x = per === 1 ? 0 : (i - 0.5) * l * 0.5, z = sz * (w / 2 + 0.22);
      k.box(M.fabric2, 0.42, 0.05, 0.42, x, 0.44, z);
      k.box(M.fabric2, 0.42, 0.42, 0.04, x, 0.49, z + sz * 0.19);
      for (const a of [-1, 1]) for (const b of [-1, 1]) k.box(M.accent, 0.025, 0.44, 0.025, x + a * 0.18, 0, z + b * 0.18);
    }
    k.cyl(M.porcelain, 0.12, 0.08, 0.08, 0, 0.76, 0);
    return g;
  },
  pendant(M) {
    const g = new THREE.Group(), k = kit(g);
    k.cyl(M.black, 0.005, 0.005, 0.85, 0, 1.95, 0, 6);
    k.cyl(M.lamp, 0.08, 0.24, 0.18, 0, 1.78, 0);
    g.userData.noBlock = true; g.userData.light = [0, 1.7, 0, 1.6];
    return g;
  },
  shoeCabinet(M, len = 1.1) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.cabinet, len, 1.0, 0.38, 0, 0.12, 0);
    k.box(M.wood, len, 0.03, 0.4, 0, 1.12, 0);
    k.box(M.mirror, 0.6, 0.9, 0.02, 0, 1.35, -0.18);
    return g;
  },
  plant(M) {
    const g = new THREE.Group(), k = kit(g);
    k.cyl(M.pot, 0.17, 0.13, 0.38, 0, 0, 0, 24);
    k.cyl(M.soil ?? M.black, 0.16, 0.16, 0.01, 0, 0.35, 0, 24);
    k.cyl(M.wood, 0.012, 0.02, 1.0, 0, 0.36, 0, 6);
    k.foliage(M.leaf, 46, 1.1, 0.75, 0, 0.5, 0, 7, 1.15);
    return g;
  },
  floorLamp(M) {
    const g = new THREE.Group(), k = kit(g);
    k.cyl(M.accent, 0.14, 0.14, 0.02);
    k.cyl(M.accent, 0.012, 0.012, 1.45, 0, 0.02, 0, 6);
    k.cyl(M.lamp, 0.14, 0.2, 0.26, 0, 1.4, 0);
    g.userData.light = [0, 1.45, 0, 1];
    return g;
  },
  kitchen(M, len = 3.0, dw = false) {
    const g = new THREE.Group(), k = kit(g), mod = len / Math.max(1, Math.round(len / 0.6));
    const sx = -len / 4, SW = 0.56, SD = 0.4, SZ = 0.02;                         // 水槽開口（檯面挖空）
    k.box(M.accent, len, 0.1, 0.5, 0, 0, -0.06);                                // 踢腳板（內縮）
    k.box(M.cabinet, len, 0.56, 0.56, 0, 0.1, -0.03);                            // 下櫃櫃體（頂面低於水槽底，門板與檯面把上緣遮住）
    for (const sx of [-1, 1]) k.box(M.cabinet, 0.018, 0.76, 0.58, sx * (len / 2 - 0.009), 0.1, -0.02);   // 兩端側板（櫃體降低後側邊不能鏤空）
    k.box(M.cabinet, len, 0.76, 0.012, 0, 0.1, -0.304);                         // 背板
    let dwAt = null;                                                             // 洗碗機：水槽往爐台方向的下一個模組
    if (dw) { let best = 1e9; for (let x = -len / 2; x < len / 2 - 0.01; x += mod) { const c = x + mod / 2, d = Math.abs(c - (sx + mod)); if (d < best) { best = d; dwAt = c; } } }
    for (let x = -len / 2; x < len / 2 - 0.01; x += mod) {                       // 門板＋把手
      const c = x + mod / 2;
      if (c === dwAt) {
        k.box(M.steel, mod - 0.006, 0.72, 0.02, c, 0.12, 0.26);
        k.box(M.black, mod - 0.04, 0.06, 0.005, c, 0.76, 0.272);
        k.box(M.steel, mod * 0.6, 0.015, 0.03, c, 0.7, 0.29);
        continue;
      }
      k.box(M.cabinet, mod - 0.006, 0.72, 0.02, c, 0.12, 0.26);
      k.box(M.steel, Math.min(0.3, mod * 0.5), 0.012, 0.02, c, 0.76, 0.28);
    }
    // 檯面：水槽四周四塊
    const L = -len / 2 - 0.01, R = len / 2 + 0.01, F = 0.31, B = -0.31;
    k.box(M.counter, sx - SW / 2 - L, 0.04, F - B, (L + sx - SW / 2) / 2, 0.86, 0);
    k.box(M.counter, R - sx - SW / 2, 0.04, F - B, (R + sx + SW / 2) / 2, 0.86, 0);
    k.box(M.counter, SW, 0.04, SZ - SD / 2 - B, sx, 0.86, (B + SZ - SD / 2) / 2);
    k.box(M.counter, SW, 0.04, F - SZ - SD / 2, sx, 0.86, (F + SZ + SD / 2) / 2);
    // 不鏽鋼水槽：深 20cm
    k.box(M.sink, SW - 0.01, 0.01, SD - 0.01, sx, 0.69, SZ);
    for (const d of [-1, 1]) {
      k.box(M.sink, SW - 0.01, 0.2, 0.008, sx, 0.69, SZ + d * (SD / 2 - 0.009));
      k.box(M.sink, 0.008, 0.2, SD - 0.01, sx + d * (SW / 2 - 0.009), 0.69, SZ);
    }
    k.cyl(M.black, 0.04, 0.04, 0.004, sx, 0.7, SZ, 16);
    // 鵝頸水龍頭
    k.cyl(M.steel, 0.025, 0.03, 0.05, sx, 0.9, -0.24, 16);
    const neck = new THREE.CatmullRomCurve3([[0, 0.94, -0.24], [0, 1.18, -0.24], [0, 1.27, -0.17], [0, 1.22, -0.08], [0, 1.12, -0.06]].map(([x, y, z]) => new THREE.Vector3(sx + x, y, z)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 24, 0.014, 10), M.steel));
    k.box(M.steel, 0.012, 0.012, 0.09, sx + 0.04, 1.0, -0.22).rotation.y = -0.6;  // 把手
    k.box(M.counter, len, 0.6, 0.02, 0, 0.9, -0.3);                              // 防濺牆
    k.box(M.black, 0.6, 0.008, 0.5, len / 4, 0.9, 0.0);                           // 爐台
    for (const [a, b] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {               // 爐圈
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.003, 4, 40), M.steel);
      ring.rotation.x = Math.PI / 2; ring.position.set(len / 4 + a * 0.14, 0.909, b * 0.12); g.add(ring);
    }
    // 吊櫃
    k.box(M.cabinet, len, 0.7, 0.34, 0, 1.55, -0.14);
    for (let x = -len / 2; x < len / 2 - 0.01; x += mod) {
      if (Math.abs(x + mod / 2 - len / 4) < mod / 2) continue;                  // 抽油煙機上方不做門
      k.box(M.cabinet, mod - 0.006, 0.68, 0.02, x + mod / 2, 1.56, 0.04);
      k.box(M.steel, 0.012, 0.012, 0.02, x + mod / 2 + mod * 0.38, 1.6, 0.06);
    }
    k.box(M.steel, 0.7, 0.14, 0.48, len / 4, 1.45, -0.06);                       // 抽油煙機
    k.box(M.black, 0.6, 0.004, 0.38, len / 4, 1.448, -0.04);
    return g;
  },
  fridge(M) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.steel, 0.76, 1.8, 0.68);
    k.box(M.accent, 0.76, 0.008, 0.69, 0, 1.15);
    k.box(M.black, 0.02, 0.5, 0.03, -0.3, 1.3, 0.35);
    return g;
  },
  toilet(M) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.porcelain, 0.4, 0.75, 0.18, 0, 0.05, -0.26);
    k.cyl(M.porcelain, 0.19, 0.15, 0.4, 0, 0, 0.03);
    k.cyl(M.porcelain, 0.2, 0.2, 0.03, 0, 0.4, 0.03);
    return g;
  },
  vanity(M, w = 0.9) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.wood, w, 0.45, 0.48, 0, 0.4, 0);
    k.box(M.counter, w + 0.02, 0.04, 0.5, 0, 0.85, 0);
    const bowl = new THREE.Mesh(basinGeo(), M.porcelain); bowl.position.set(0, 0.89, 0.02); g.add(bowl);   // 碗形面盆（中空）
    k.cyl(M.steel, 0.012, 0.012, 0.22, 0, 0.89, -0.18, 8);
    k.box(M.mirror, w * 0.9, 0.8, 0.02, 0, 1.15, -0.24);
    return g;
  },
  tub(M) {
    // 中空浴缸：外殼＋四邊 6cm 厚的緣，內底在 15cm 高
    const g = new THREE.Group(), k = kit(g), L = 1.6, W = 0.75, H = 0.55, t = 0.06;
    k.box(M.porcelain, L, 0.15, W);
    for (const s of [-1, 1]) { k.box(M.porcelain, L, H - 0.15, t, 0, 0.15, s * (W / 2 - t / 2)); k.box(M.porcelain, t, H - 0.15, W - 2 * t, s * (L / 2 - t / 2), 0.15, 0); }
    k.cyl(M.steel, 0.015, 0.015, 0.2, 0.7, 0.55, -0.3, 8);
    k.cyl(M.black, 0.025, 0.025, 0.004, 0.62, 0.15, 0, 16);
    return g;
  },
  shower(M, w = 0.9, d = 0.9) {
    // w 沿本地 x、d 沿本地 z；正面（+z）是入口：只裝一半玻璃當拉門，另一半留空
    const g = new THREE.Group(), k = kit(g);
    k.box(M.porcelain, w, 0.04, d);
    k.box(M.glass, w, 2.0, 0.01, 0, 0.04, -d / 2);
    k.box(M.glass, 0.01, 2.0, d, w / 2, 0.04, 0);
    k.box(M.glass, 0.01, 2.0, d, -w / 2, 0.04, 0);
    k.box(M.glass, w * 0.45, 2.0, 0.01, -w * 0.275, 0.04, d / 2);
    k.box(M.steel, w, 0.02, 0.02, 0, 2.02, d / 2);                               // 拉門上軌
    k.box(M.steel, 0.015, 0.3, 0.02, -w * 0.07, 0.95, d / 2 + 0.015);          // 門把
    k.cyl(M.steel, 0.1, 0.1, 0.02, 0, 2.0, -d / 2 + 0.25);                      // 頂噴
    k.cyl(M.steel, 0.012, 0.012, 0.25, 0, 1.78, -d / 2 + 0.05, 8);
    k.cyl(M.black, 0.04, 0.04, 0.004, w * 0.3, 0.04, -d * 0.3, 16);             // 排水孔
    g.userData.glassy = true;
    return g;
  },
  laundrySink(M, w = 0.6) {
    // 工作陽台洗衣槽：落地櫃＋深槽（槽邊附洗衣板）＋水龍頭
    const g = new THREE.Group(), k = kit(g), d = 0.5;
    k.box(M.porcelain, w, 0.62, d);
    k.box(M.porcelain, w, 0.06, 0.05, 0, 0.62, d / 2 - 0.025); k.box(M.porcelain, w, 0.06, 0.05, 0, 0.62, -d / 2 + 0.025);
    k.box(M.porcelain, 0.05, 0.06, d, w / 2 - 0.025, 0.62, 0); k.box(M.porcelain, 0.05, 0.06, d, -w / 2 + 0.025, 0.62, 0);
    for (let i = 0; i < 6; i++) k.box(M.porcelain, w * 0.35, 0.012, 0.025, -w * 0.25, 0.6 + i * 0.003, -0.05 + i * 0.04).rotation.x = -0.25;   // 洗衣板
    k.cyl(M.steel, 0.012, 0.012, 0.35, w * 0.15, 0.68, -d / 2 + 0.03, 8);
    k.box(M.steel, 0.02, 0.02, 0.16, w * 0.15, 1.02, -d / 2 + 0.1);
    return g;
  },
  waterHeater(M) {
    // 強制排氣熱水器：掛牆 1.3m 高，上方排氣管穿出、下方進出水管
    const g = new THREE.Group(), k = kit(g);
    // 本地 z=0 是牆面，機體往前 20cm
    k.box(M.porcelain, 0.36, 0.56, 0.2, 0, 1.3, 0.1);
    k.box(M.screen, 0.1, 0.06, 0.005, 0, 1.55, 0.203);
    k.cyl(M.steel, 0.05, 0.05, 0.75, 0, 1.86, 0.1, 16);
    for (const x of [-0.1, 0, 0.1]) k.cyl(M.steel, 0.012, 0.012, 1.3, x, 0, 0.03, 8);
    g.userData.noBlock = true;
    return g;
  },
  dryingRack(M, len = 1.6) {
    // 天花升降曬衣架：兩支桿＋吊架，掛幾件衣服
    const g = new THREE.Group(), k = kit(g), y = 2.38;
    for (const z of [-0.12, 0.12]) { const b = k.cyl(M.steel, 0.012, 0.012, len, 0, y, z, 8); b.rotation.z = Math.PI / 2; b.position.y = y; }
    for (const x of [-len / 2 + 0.08, len / 2 - 0.08]) k.cyl(M.steel, 0.008, 0.008, 2.8 - y, x, y, 0, 6);
    const cloth = [[M.linen, -0.45, 0.62], [M.fabric, -0.05, 0.48], [M.fabric2, 0.35, 0.7]];
    for (const [m, x, h] of cloth) if (Math.abs(x) < len / 2 - 0.2) { k.box(m, 0.42, h, 0.015, x, y - h - 0.04, 0.12); k.box(M.steel, 0.4, 0.008, 0.01, x, y - 0.04, 0.12); }
    g.userData.noBlock = true;
    return g;
  },
  sconce(M) {
    // 陽台壁燈：牆面 2.0m 高
    const g = new THREE.Group(), k = kit(g);
    k.box(M.black, 0.1, 0.22, 0.06, 0, 1.9, 0.03);
    k.box(M.lamp, 0.07, 0.16, 0.02, 0, 1.93, 0.065);
    g.userData.noBlock = true; g.userData.light = [0, 1.95, 0.25, 0.5];
    return g;
  },
  washerDryer(M) {
    // 洗烘塔：下滾筒洗衣機、上熱泵烘衣機（免排氣管），底下防水盤
    const g = new THREE.Group(), k = kit(g);
    k.box(M.steel, 0.68, 0.03, 0.68, 0, 0, 0);
    for (const y of [0.03, 0.9]) {
      k.box(M.porcelain, 0.6, 0.85, 0.6, 0, y, 0);
      const d = k.cyl(M.screen, 0.18, 0.18, 0.03, 0, y + 0.42, 0.3); d.rotation.x = Math.PI / 2;
      k.box(M.black, 0.3, 0.05, 0.01, -0.08, y + 0.75, 0.301);
    }
    return g;
  },
  foldTable(M, w = 0.9) {
    // 摺衣檯：檯面 85cm（低於窗台，可放窗下）＋下層洗衣籃
    const g = new THREE.Group(), k = kit(g);
    k.box(M.cabinet, w, 0.03, 0.55, 0, 0.82, 0);
    for (const sx of [-1, 1]) k.box(M.cabinet, 0.025, 0.82, 0.55, sx * (w / 2 - 0.0125), 0, 0);
    k.box(M.cabinet, w - 0.05, 0.02, 0.5, 0, 0.12, 0);
    for (const sx of [-0.22, 0.22]) k.box(M.linen, 0.36, 0.3, 0.4, sx * w / 0.9, 0.14, 0);
    return g;
  },
  washer(M) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.porcelain, 0.6, 0.85, 0.6);
    const d = k.cyl(M.screen, 0.18, 0.18, 0.03, 0, 0.42, 0.3); d.rotation.x = Math.PI / 2;
    return g;
  },
  bistro(M) {
    const g = new THREE.Group(), k = kit(g);
    k.cyl(M.accent, 0.3, 0.3, 0.02, 0, 0.7, 0);
    k.cyl(M.accent, 0.02, 0.02, 0.7, 0, 0, 0, 6);
    for (const sx of [-1, 1]) {
      k.box(M.wood, 0.4, 0.04, 0.4, sx * 0.55, 0.44, 0);
      k.box(M.wood, 0.04, 0.4, 0.4, sx * 0.75, 0.48, 0);
      k.box(M.accent, 0.3, 0.44, 0.3, sx * 0.55, 0, 0).scale.set(0.1, 1, 0.1);
    }
    return g;
  },
  acUnit(M) {
    // 冷氣室外機：正面（+z）是出風網罩
    const g = new THREE.Group(), k = kit(g);
    k.box(M.porcelain, 0.8, 0.6, 0.3);
    const f = k.cyl(M.black, 0.21, 0.21, 0.02, -0.12, 0.3, 0.15, 24); f.rotation.x = Math.PI / 2; f.position.set(-0.12, 0.3, 0.15);
    for (let i = -2; i <= 2; i++) k.box(M.steel, 0.44, 0.006, 0.006, -0.12, 0.3 + i * 0.07 - 0.003, 0.163);
    k.box(M.accent, 0.12, 0.5, 0.01, 0.3, 0.05, 0.151);
    for (const x of [-0.3, 0.3]) k.box(M.black, 0.06, 0.08, 0.3, x, -0.0, 0);
    return g;
  },
  art(M, w = 1.2, n = 3) {
    // 牆上掛畫：一組 n 幅，掛在背靠的牆上
    const g = new THREE.Group(), k = kit(g), pw = (w - 0.08 * (n - 1)) / n, mats = [M.art1, M.art2, M.art3];
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + pw / 2 + i * (pw + 0.08);
      k.box(M.black, pw, pw * 1.3, 0.03, x, 1.35, -0.015);
      k.box(mats[i % 3], pw - 0.06, pw * 1.3 - 0.06, 0.01, x, 1.38, 0.005);
    }
    g.userData.noBlock = true;
    return g;
  },
  applianceTower(M, w = 0.9) {
    // 電器櫃（高 2.3m、深 60cm）：下抽屜／抽拉層板（電鍋、電子鍋，蒸氣不悶在櫃裡）／嵌入烤箱／微波爐＋氣炸鍋開放層／上櫃
    const g = new THREE.Group(), k = kit(g), D = 0.6, z = D / 2;
    k.box(M.cabinet, w, 2.3, 0.02, 0, 0, -z + 0.01);
    for (const sx of [-1, 1]) k.box(M.cabinet, 0.02, 2.3, D, sx * (w / 2 - 0.01), 0, 0);
    k.box(M.accent, w, 0.1, D - 0.05, 0, 0, -0.02);
    for (const [y, h] of [[0.1, 0.2], [0.3, 0.2]]) { k.box(M.cabinet, w - 0.01, h - 0.006, 0.02, 0, y, z - 0.01); k.box(M.steel, 0.3, 0.012, 0.02, 0, y + h - 0.05, z + 0.01); }
    for (const y of [0.5, 0.95, 1.55, 1.95]) k.box(M.cabinet, w - 0.04, 0.02, D - 0.04, 0, y, 0);
    k.box(M.cabinet, w - 0.04, 0.02, 0.45, 0, 0.55, 0.06);                         // 抽拉層板（拉出一截）
    k.cyl(M.porcelain, 0.13, 0.13, 0.22, -w / 4, 0.57, 0.1, 20);                  // 電鍋
    k.cyl(M.porcelain, 0.13, 0.13, 0.03, -w / 4, 0.79, 0.1, 20);
    k.box(M.black, 0.26, 0.22, 0.28, w / 4, 0.57, 0.08);                          // 電子鍋
    k.box(M.black, 0.56, 0.58, 0.02, 0, 0.97, z - 0.01);                         // 嵌入烤箱
    k.box(M.glass, 0.42, 0.28, 0.01, 0, 1.12, z + 0.001);
    k.box(M.steel, 0.4, 0.015, 0.03, 0, 1.45, z + 0.02);
    k.box(M.steel, 0.5, 0.3, 0.4, -w / 2 + 0.29, 1.57, 0.02);                    // 微波爐
    k.box(M.screen, 0.3, 0.2, 0.005, -w / 2 + 0.24, 1.62, 0.222);
    k.box(M.black, 0.26, 0.32, 0.3, w / 2 - 0.17, 1.57, 0.04);                    // 氣炸鍋
    k.box(M.cabinet, w - 0.01, 0.34, 0.02, 0, 1.96, z - 0.01);
    return g;
  },
  coffeeBar(M, w = 1.4) {
    // 咖啡飲料吧台：下櫃（一格冷飲小冰箱、玻璃門）＋檯面（咖啡機、熱水壺、杯）＋上方開放層架
    const g = new THREE.Group(), k = kit(g), z = 0.3;
    k.box(M.accent, w - 0.06, 0.1, 0.5, 0, 0, -0.04);
    k.box(M.cabinet, w, 0.78, 0.58, 0, 0.1, -0.01);
    k.box(M.black, 0.6, 0.76, 0.02, -w / 2 + 0.32, 0.11, z - 0.01);               // 冷飲冰箱
    k.box(M.glass, 0.52, 0.64, 0.005, -w / 2 + 0.32, 0.17, z + 0.002);
    for (const y of [0.25, 0.45, 0.62]) for (let i = 0; i < 4; i++) k.cyl(i % 2 ? M.art2 : M.art1, 0.03, 0.03, 0.15, -w / 2 + 0.12 + i * 0.13, y, z - 0.12, 10);
    for (let x = 0.04; x < w / 2 - 0.05; x += (w / 2 - 0.08) / 2) { k.box(M.cabinet, (w / 2 - 0.08) / 2 - 0.006, 0.74, 0.02, x + (w / 2 - 0.08) / 4, 0.12, z - 0.01); }
    k.box(M.counter, w + 0.02, 0.04, 0.6, 0, 0.88, 0);
    k.box(M.black, 0.3, 0.38, 0.36, w / 2 - 0.3, 0.92, -0.08);                    // 咖啡機
    k.box(M.steel, 0.12, 0.04, 0.12, w / 2 - 0.3, 1.0, 0.13);
    k.cyl(M.steel, 0.07, 0.08, 0.22, 0.05, 0.92, -0.1, 16);                       // 熱水壺
    for (let i = 0; i < 3; i++) k.cyl(M.porcelain, 0.035, 0.03, 0.08, -0.25 + i * 0.1, 0.92, 0.12, 12);
    k.box(M.counter, w, 0.5, 0.012, 0, 0.92, -0.29);                              // 防濺背板
    for (const y of [1.45, 1.85]) {
      k.box(M.wood, w, 0.03, 0.28, 0, y, -0.15);
      for (let i = 0; i < 5; i++) k.cyl(i % 3 ? M.porcelain : M.glass, 0.04, 0.035, 0.1 + (i % 2) * 0.04, -w / 2 + 0.15 + i * (w - 0.3) / 4, y + 0.03, -0.15, 12);
    }
    return g;
  },
  displayCabinet(M, w = 1.0) {
    // 展示櫃：高 2.1m、深 40cm、玻璃門、層板燈
    const g = new THREE.Group(), k = kit(g), z = 0.2, H = 2.1;
    k.box(M.cabinet, w, H, 0.02, 0, 0, -z + 0.01);
    for (const sx of [-1, 1]) k.box(M.cabinet, 0.025, H, 0.4, sx * (w / 2 - 0.0125), 0, 0);
    k.box(M.cabinet, w, 0.6, 0.4, 0, 0, 0);                                        // 下櫃
    for (const y of [0.6, 1.1, 1.6, H - 0.03]) { k.box(M.glass, w - 0.05, 0.012, 0.36, 0, y, 0); k.box(M.lamp, w - 0.08, 0.008, 0.02, 0, y - 0.01, z - 0.04); }
    const items = [M.art1, M.porcelain, M.art3, M.wood, M.art2, M.porcelain];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) { const m = items[(r * 3 + i) % items.length]; i % 2 ? k.ball(m, 0.07, -w / 3 + i * w / 3, 0.68 + r * 0.5, -0.03) : k.cyl(m, 0.05, 0.06, 0.18 + r * 0.04, -w / 3 + i * w / 3, 0.62 + r * 0.5, -0.03, 14); }
    k.box(M.glass, w - 0.04, H - 0.62, 0.01, 0, 0.61, z - 0.005);
    k.box(M.frame, 0.015, H - 0.62, 0.02, 0, 0.61, z);
    return g;
  },
  coatCloset(M, w = 1.0) {
    // 髒衣外套櫃：高 2.3m，百葉門通風（外套、包包、安全帽不帶進房間）
    const g = new THREE.Group(), k = kit(g), z = 0.29;
    k.box(M.cabinet, w, 2.3, 0.58, 0, 0, -0.01);
    for (let y = 0.15; y < 2.15; y += 0.06) k.box(M.wood, w - 0.03, 0.03, 0.02, 0, y, z - 0.005).rotation.x = -0.35;
    k.box(M.accent, 0.008, 2.2, 0.02, 0, 0.05, z);
    for (const sx of [-1, 1]) k.box(M.steel, 0.015, 0.25, 0.025, sx * 0.04, 1.0, z + 0.01);
    return g;
  },
  shoeBench(M, w = 1.1) {
    // 玄關鞋櫃（高 2.3m、深 38cm）：一半整櫃（附穿衣鏡），一半下方挖空成穿鞋凳、凳下放室內拖，上方吊櫃
    const g = new THREE.Group(), k = kit(g), D = 0.38, z = D / 2, h = w / 2;
    k.box(M.cabinet, w, 2.3, 0.02, 0, 0, -z + 0.01);
    for (const sx of [-1, 0, 1]) k.box(M.cabinet, 0.02, 2.3, D, sx * (w / 2 - 0.01), 0, 0);
    k.box(M.cabinet, h - 0.02, 2.28, 0.02, -h / 2, 0.01, z - 0.01);              // 左：整櫃門
    k.box(M.mirror, h - 0.12, 1.3, 0.01, -h / 2, 0.6, z + 0.005);
    k.box(M.cabinet, h - 0.02, 1.1, 0.02, h / 2, 1.2, z - 0.01);                 // 右：上吊櫃
    k.box(M.wood, h - 0.03, 0.04, D - 0.02, h / 2, 0.41, 0);                      // 凳面
    k.box(M.fabric, h - 0.06, 0.04, D - 0.06, h / 2, 0.45, 0.01);
    k.box(M.wood, h - 0.03, 0.02, D - 0.04, h / 2, 0.1, 0);
    k.box(M.fabric2, 0.12, 0.06, 0.26, h / 2 - 0.08, 0.12, 0); k.box(M.fabric2, 0.12, 0.06, 0.26, h / 2 + 0.08, 0.12, 0);
    k.box(M.lamp, h - 0.06, 0.01, 0.03, h / 2, 1.19, z - 0.06);                  // 凳上方燈條
    return g;
  },
  bench(M, w = 0.9) {
    // 穿鞋凳：坐高 45cm，下方放室內拖
    const g = new THREE.Group(), k = kit(g);
    k.box(M.wood, w, 0.04, 0.36, 0, 0.41, 0);
    k.box(M.fabric, w - 0.06, 0.04, 0.32, 0, 0.45, 0);
    for (const sx of [-1, 1]) k.box(M.wood, 0.03, 0.41, 0.34, sx * (w / 2 - 0.03), 0, 0);
    k.box(M.wood, w - 0.06, 0.02, 0.32, 0, 0.12, 0);
    for (const sx of [-0.2, 0.15]) k.box(M.fabric2, 0.12, 0.06, 0.26, sx, 0.14, 0);
    return g;
  },
  sofaL(M, len = 2.5, chaise = 1.6) {
    // L 型沙發：主座沿本地 x、背靠 -z；+x 端貴妃椅往 +z 延伸到 chaise 深
    const g = new THREE.Group(), k = kit(g), D = 0.9;
    k.box(M.fabric, len, 0.3, D, 0, 0.1, 0);
    k.box(M.fabric, len - 0.17, 0.42, 0.22, -0.085, 0.36, -0.33);
    k.box(M.fabric, 0.17, 0.32, D, -len / 2 + 0.085, 0.36, 0);
    const cx = len / 2 - D / 2, cz = (chaise - D) / 2;
    k.box(M.fabric, D, 0.3, chaise - D + 0.001, cx, 0.1, D / 2 + cz);
    k.box(M.fabric, 0.17, 0.32, chaise, len / 2 - 0.085, 0.36, (chaise - D) / 2);
    const n = Math.max(2, Math.round((len - D) / 0.7)), cw = (len - D - 0.17) / n;
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 0.17 + cw * (i + 0.5);
      k.box(M.fabric, cw - 0.015, 0.16, 0.66, x, 0.39, 0.1);
      k.box(M.fabric, cw - 0.03, 0.46, 0.2, x, 0.5, -0.24).rotation.x = -0.14;
    }
    k.box(M.fabric, D - 0.2, 0.16, chaise - 0.24, cx - 0.085, 0.39, (chaise - D) / 2 + 0.1);
    k.box(M.fabric, D - 0.2, 0.46, 0.2, cx - 0.085, 0.5, -0.24).rotation.x = -0.14;
    for (let i = 0; i < 4; i++) k.box(M.accent, 0.04, 0.1, 0.04, (i % 2 ? 1 : -1) * (len / 2 - 0.1), 0, i < 2 ? -0.38 : 0.38);
    k.pillow(M.fabric2, 0.44, 0.42, 0.14, -len / 2 + 0.42, 0.5, -0.1).rotation.set(-0.25, 0.25, 0.08);
    k.pillow(M.rug, 0.4, 0.38, 0.13, cx - 0.1, 0.5, -0.1).rotation.set(-0.25, -0.3, -0.06);
    return g;
  },
  rainShower(M) {
    // 乾濕分離淋浴區（無淋浴拉門，玻璃隔間另做）：頂噴、手持花灑、牆面置物凹槽、線性排水溝；背靠的牆在 -z
    const g = new THREE.Group(), k = kit(g);
    k.box(M.steel, 0.025, 0.025, 0.36, 0, 2.05, 0.2);                          // 頂噴臂從牆面伸出
    k.cyl(M.steel, 0.15, 0.15, 0.015, 0, 2.02, 0.36, 32);
    k.cyl(M.steel, 0.012, 0.012, 1.0, 0.22, 0.9, 0.03, 8);                       // 手持花灑滑桿
    k.box(M.steel, 0.06, 0.12, 0.05, 0.22, 1.05, 0.04);
    k.box(M.black, 0.3, 0.3, 0.02, -0.22, 1.1, 0.01);                            // 置物凹槽
    k.box(M.steel, 0.6, 0.008, 0.06, 0, 0.002, 0.55);                            // 線性排水溝
    g.userData.noBlock = true;
    return g;
  },
  island(M, len = 2.2) {
    // 中島：檯面 90cm 高、深 90cm，前側（+z）出挑 25cm 當吧台，配高腳椅
    const g = new THREE.Group(), k = kit(g), n = Math.max(2, Math.round(len / 0.6));
    k.box(M.accent, len - 0.1, 0.1, 0.55, 0, 0, -0.1);
    k.box(M.cabinet, len, 0.76, 0.6, 0, 0.1, -0.12);
    for (let i = 0; i < n; i++) k.box(M.cabinet, len / n - 0.006, 0.72, 0.02, -len / 2 + (len / n) * (i + 0.5), 0.12, -0.43);
    k.box(M.counter, len + 0.04, 0.04, 0.92, 0, 0.86, 0.0);
    k.box(M.black, 0.6, 0.006, 0.45, -len / 4, 0.9, -0.15);                      // IH 爐（第二工作區）
    const ns = Math.max(2, Math.floor(len / 0.55));
    for (let i = 0; i < ns; i++) {
      const x = -len / 2 + (len / ns) * (i + 0.5);
      k.cyl(M.fabric, 0.17, 0.17, 0.05, x, 0.64, 0.62, 20);
      k.cyl(M.accent, 0.018, 0.018, 0.64, x, 0, 0.62, 8);
      k.cyl(M.accent, 0.2, 0.2, 0.012, x, 0, 0.62, 20);
    }
    return g;
  },
  bookshelf(M, w = 1.6) {
    // 開放書櫃：高 2.1m、深 35cm，五層，隨機放書與擺飾
    const g = new THREE.Group(), k = kit(g), H = 2.1, D = 0.35, n = 5, cols = Math.max(2, Math.round(w / 0.8));
    k.box(M.cabinet, w, H, 0.02, 0, 0, -D / 2 + 0.01);
    for (const sx of [-1, 1]) k.box(M.cabinet, 0.025, H, D, sx * (w / 2 - 0.0125), 0, 0);
    for (let i = 1; i < cols; i++) k.box(M.cabinet, 0.02, H, D, -w / 2 + (w / cols) * i, 0, 0);
    const bk = [M.accent, M.linen, M.wood, M.fabric, M.fabric2, M.art1, M.art2];
    for (let r = 0; r <= n; r++) k.box(M.cabinet, w, 0.025, D, 0, r * (H - 0.025) / n, 0);
    for (let r = 0; r < n; r++) for (let c = 0; c < cols; c++) {
      const x0 = -w / 2 + (w / cols) * c + 0.03, x1 = x0 + w / cols - 0.06, y = r * (H - 0.025) / n + 0.025, seed = r * 7 + c * 3;
      if (seed % 5 === 2) { k.cyl(M.pot, 0.06, 0.05, 0.14, (x0 + x1) / 2, y, 0, 12); continue; }
      let x = x0 + (seed % 3) * 0.05;
      for (let i = 0; x < x1 - 0.03 - (seed % 4) * 0.08; i++) { const bw = 0.025 + ((seed + i) % 3) * 0.008; k.box(bk[(seed + i) % bk.length], bw, 0.2 + ((seed + i * 5) % 4) * 0.025, 0.22, x + bw / 2, y, -0.03); x += bw + 0.003; }
    }
    return g;
  },
  dresser(M, w = 1.0) {
    // 梳妝台：檯面＋抽屜＋立鏡＋椅凳
    const g = new THREE.Group(), k = kit(g);
    k.box(M.cabinet, w, 0.03, 0.45, 0, 0.74, 0);
    k.box(M.cabinet, w * 0.4, 0.2, 0.42, w * 0.28, 0.54, 0);
    for (const sx of [-1, 1]) k.box(M.accent, 0.03, 0.74, 0.4, sx * (w / 2 - 0.03), 0, 0);
    k.box(M.mirror, 0.5, 0.65, 0.02, -0.1, 0.8, -0.18);
    k.box(M.accent, 0.54, 0.69, 0.015, -0.1, 0.78, -0.195);
    k.cyl(M.fabric, 0.18, 0.18, 0.08, -0.1, 0.38, 0.42, 20);
    k.cyl(M.accent, 0.02, 0.02, 0.38, -0.1, 0, 0.42, 8);
    return g;
  },
  rug(M, w = 2, d = 1.6) {
    const g = new THREE.Group(), k = kit(g);
    k.box(M.rug, w, 0.012, d, 0, 0.004, 0);
    g.userData.noBlock = true;
    return g;
  },
};

export function makeFurniture(spec, M) {
  const g = ITEMS[spec.f](M, ...(spec.a || []));
  g.position.set(toX(spec.x), 0, toZ(spec.y));
  g.rotation.y = FACE[spec.face || 'down'];
  g.updateMatrixWorld(true);
  if (g.userData.light) { const [x, y, z, w] = g.userData.light; g.userData.lightAt = [...g.localToWorld(new THREE.Vector3(x, y, z)).toArray(), w]; }
  return g;
}
