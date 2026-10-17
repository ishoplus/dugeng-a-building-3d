// 客變範圍圖層：依計畫書圖 9-27 的柱位、分戶牆、管道間（打叉方格）推估哪些可改、哪些不能動
// 室內隔間是 RC 還是輕隔間計畫書看不出來，結論以建商客變手冊與結構圖為準
import * as THREE from 'three';
import { S, CEIL_H, toX, toZ, mToPX, decompose, wallSegments } from './plan.js';

export const ZONES = {
  free: { color: 0x3fae6a, css: '#3fae6a', name: '可以改', desc: '非承重隔間、門位、地坪壁面、插座燈具' },
  cond: { color: 0xe8a93a, css: '#e8a93a', name: '有條件', desc: '浴室、廚房：受管道間與排水限制' },
  fixed: { color: 0xd9534f, css: '#d9534f', name: '不能動', desc: '柱、梁、分戶牆、外牆與窗、陽台、管道間' },
};

// 左上象限（A1／A2）以公尺描，其餘鏡射；全棟 33.6 × 22.6m
const W = 33.6, D = 22.6;
// 柱：軸線交點（Y2～Y6 × X2～X5），外圍柱對齊模型外牆柱，內柱位置依原圖量
const COLS = [
  [-0.1, 0.575, 0.7, 0.75],    // 角柱
  [8.55, 0.05, 0.7, 0.7], [16.8, 0.05, 0.7, 0.7],
  [-0.1, 7.2, 0.7, 0.7],       // 西側外牆中段
  [8.55, 6.75, 0.6, 1.0],      // A1／A2 分戶牆靠核心端
  [16.8, 6.2, 1.2, 0.7],       // A2／A3 分戶牆靠核心端（併在核心牆內）
];
// 大梁沿柱線（推估）：[x1, y1, x2, y2]，畫成軸向的帶狀
const BEAMS = [
  [-0.1, 0.3, 16.8, 0.3], [-0.1, 0.575, -0.1, 11.3], [8.55, 0.05, 8.55, 11.3], [16.8, 0.05, 16.8, 6.2],
  [-0.1, 6.95, 16.8, 6.95],
];
// 管道間（圖上打叉處）：[x, y, 說明]
const SHAFTS = [
  [3.65, 6.5, 'A1 主浴管道間'], [1.8, 8.8, 'A1 工作陽台排水'], [6.95, 10.0, 'A1 客浴管道間'], [14.1, 5.4, 'A2 兩間浴室共用管道間'],
];
const mirror = ([x, y], mx, my) => [mx ? W - x : x, my ? D - y : y];
const QS = [[0, 0], [1, 0], [1, 1], [0, 1]];

const WET = /浴|廁|廚房|家事/;
export function zoneOf(sp) {
  if (!sp || !sp.unit) return null;
  if (sp.kind === 'bal' || sp.kind === 'ac') return 'fixed';
  return WET.test(sp.type) ? 'cond' : 'free';
}

export function ruleOf(sp, unit) {
  if (!sp) return '';
  if (!sp.unit) return '公共空間：住戶不能改';
  const mid = unit?.kind === 'mid';
  switch (sp.type) {
    case '主浴': case '客浴': case '主浴濕區': case '客浴濕區':
      return mid ? '有條件：兩間浴室背靠同一個管道間，位置基本固定；可換設備、淋浴／浴缸、縮小'
        : '有條件：馬桶要靠管道間，一般只能挪 1～1.5m；可換設備、淋浴／浴缸、縮小';
    case '廚房': return '有條件：可改開放式（爐具改 IH）、調整廚具；水槽靠排水，排油煙走原路徑';
    case '陽台': case '工作陽台': return '不能動：不可外推或併入室內；地磚、曬衣架、洗衣機位置可調';
    case '設備平台': return '不能動：冷氣室外機位置，不可改作他用';
    case '客餐廳': case '玄關': case '走道': return '可以改：隔間、玄關收納、燈具插座、地坪壁面；客廳上方可能有梁';
    default: return '可以改：可併入相鄰房間或客廳、移門位；靠外牆的窗不能動';
  }
}

export function buildReno(plan) {
  const mats = {}, mat = (z, o) => mats[z + o] ??= new THREE.MeshBasicMaterial({ color: ZONES[z].color, transparent: true, opacity: o, depthWrite: false, toneMapped: false });
  const units = {}, all = new THREE.Group();
  const ug = u => units[u] ??= new THREE.Group();
  const add = (g, z, o, w, h, d, x, y, zz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(z, o)); m.position.set(x, y, zz); m.renderOrder = 3; g.add(m); return m; };

  // 地板色塊
  for (const r of decompose(plan, s => !!s.unit)) {
    const sp = plan.spaces[r.id], z = zoneOf(sp);
    const g = new THREE.Mesh(new THREE.PlaneGeometry((r.x2 - r.x1) * S, (r.y2 - r.y1) * S).rotateX(-Math.PI / 2), mat(z, 0.3));
    g.position.set(toX((r.x1 + r.x2) / 2), 0.02, toZ((r.y1 + r.y2) / 2)); g.renderOrder = 3; ug(sp.unit).add(g);
  }

  // 牆頂色條（樣品屋鳥瞰看得到；漫遊時被天花遮住）
  const TH = { ext: 0.22, party: 0.18, int: 0.12, rail: 0.12 };
  for (const s of wallSegments(plan)) {
    const A = plan.spaces[s.a], B = plan.spaces[s.b];
    if (!A?.unit && !B?.unit || s.op?.full) continue;
    let z;
    if (s.cls !== 'int') z = 'fixed';                                                   // 外牆、分戶牆、欄杆
    else if ([A, B].some(x => x.kind === 'bal' || x.kind === 'ac')) z = 'fixed';       // 室內與陽台之間＝立面
    else if ([A, B].some(x => WET.test(x.type))) z = 'cond';
    else z = 'free';
    const H = s.o === 'h', n = H ? toZ(s.at) : toX(s.at), u1 = H ? toX(s.t1) : toZ(s.t1), u2 = H ? toX(s.t2) : toZ(s.t2);
    const t = TH[s.cls] + 0.06, top = s.cls === 'rail' ? 1.2 : CEIL_H;
    for (const u of new Set([A?.unit, B?.unit].filter(Boolean)))
      H ? add(ug(u), z, 0.9, u2 - u1, 0.05, t, (u1 + u2) / 2, top + 0.035, n) : add(ug(u), z, 0.9, t, 0.05, u2 - u1, n, top + 0.035, (u1 + u2) / 2);
  }

  // 管道間
  for (const [mx, my] of QS) for (const [x0, y0, label] of SHAFTS) {
    const [x, y] = mirror([x0, y0], mx, my), X = toX(mToPX(x)), Z = toZ(mToPX(y));
    const sp = plan.spaces[plan.id(mToPX(x), mToPX(y))];
    const g = sp?.unit ? ug(sp.unit) : all;
    add(g, 'fixed', 0.75, 0.4, CEIL_H, 0.4, X, CEIL_H / 2, Z).userData.label = label;
    // 頂上打叉
    for (const r of [Math.PI / 4, -Math.PI / 4]) { const m = add(g, 'fixed', 1, 0.5, 0.02, 0.05, X, CEIL_H + 0.07, Z); m.rotation.y = r; }
  }

  // 柱（整層）＋梁（推估，只在鳥瞰顯示）
  const seen = new Set();
  for (const [mx, my] of QS) for (const [x0, y0, w, d] of COLS) {
    const [x, y] = mirror([x0, y0], mx, my), k = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (seen.has(k)) continue; seen.add(k);
    add(all, 'fixed', 0.65, w + 0.04, CEIL_H + 0.1, d + 0.04, toX(mToPX(x)), (CEIL_H + 0.1) / 2, toZ(mToPX(y)));
  }
  const beams = new THREE.Group(); all.add(beams);
  const bseen = new Set();
  for (const [mx, my] of QS) for (const b of BEAMS) {
    const [x1, y1] = mirror([b[0], b[1]], mx, my), [x2, y2] = mirror([b[2], b[3]], mx, my);
    const k = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(v => v.toFixed(2)).join();
    if (bseen.has(k)) continue; bseen.add(k);
    const X1 = toX(mToPX(Math.min(x1, x2))), X2 = toX(mToPX(Math.max(x1, x2))), Z1 = toZ(mToPX(Math.min(y1, y2))), Z2 = toZ(mToPX(Math.max(y1, y2)));
    const bw = 0.45;
    add(beams, 'fixed', 0.35, Math.max(X2 - X1, bw), 0.04, Math.max(Z2 - Z1, bw), (X1 + X2) / 2, CEIL_H + 0.12, (Z1 + Z2) / 2);
  }
  return { units, all, beams };
}
