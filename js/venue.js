// 公設參觀：1F 門廳大廳（含入口前庭、鏡面水池、通廊、A 棟梯廳、管理委員會使用空間）與 A 棟屋頂花園
// 位置依計畫書圖 9-19（一層平面）、9-21（二層挑空）、9-30／9-49（屋突層、屋頂景觀）量圖估算，裝修依建材表「1F 門廳」示意
// 座標沿用平面的公尺（A 棟平面座標）；大廳在兩棟之間超出單層格子，往西平移 SHIFT 公尺再擺回世界座標
import * as THREE from 'three';
import { S, GX0, GY0, GW, GH, toX, toZ, mToPX as P, wallSegments, decompose } from './plan.js';
import { makeFurniture } from './furniture.js';
import { Batcher } from './build.js';

const SHIFT = 0;
// 一樓基地場景的格子：A 棟平面公尺 x -11～96、y -7.5～32.5（整個基地含兩棟、四周步道），比單層格子大
const GSITE = { x0: -60, y0: -170, w: 2020, h: 860 };
// 基地範圍（A 棟平面公尺）：西到 6M 巷、北到 207 巷、東到東側 6M 巷、南到文德路緣石（同 city.js 的道路位置）
const SITE = { x1: -8.6, y1: -10.1, x2: 94.8, y2: 31.4 };
const BX1 = 50.1, BX2 = 85.2;
// 基地高低差（圖 9-47／9-54 標高：文德路側約 ±0、建物一樓 +0.3～+0.5、北側 207 巷步道約 +2.0～+2.8）
// 以 A 棟平面公尺給地面高程（相對南側人行道），一樓景觀場景的地坪、景觀物件、視線高度都照這個抬高
const SLOPE_N = 2.4, RTOP = 1.0;
export function siteH(x, y) {
  if (x > 34.5 && x < 69.05 && y > -7.25 && y < -1.0) return 0;                      // 車道（另外處理）
  if (x >= 69 && x <= 80 && y >= -7.5 && y < -1.0) return RTOP;                       // 車道頂端平台 +1.0
  if (x >= 69 && x <= 80 && y < -7.5) return Math.min(SLOPE_N, RTOP + (SLOPE_N - RTOP) * (-7.5 - y) / 2.6);   // 穿越步道上到 207 巷
  if (y < -6.1) return SLOPE_N;                                                        // 北側步道
  if (x > -0.6 && x < 34.6 && y < -1.3) {                                              // 北側花園斜坡、木平台
    if (x > 20.1 && x < 34.3 && y > -2.9) return 0.4;
    return Math.min(SLOPE_N, 0.4 + (SLOPE_N - 0.4) * (-1.3 - y) / 4.8);
  }
  if ((x < -0.8 || x > 85.4) && y < 23.65) return SLOPE_N * (23.65 - y) / 29.75;      // 西側、東側步道一路往北爬升
  return 0;
}
// 基地邊界（圖 9-47 紅色虛線，量圖）：東北是斜線、西北是圓角、西側往南略外斜；邊界內緣 2.5m 是人行道
const neLine = y => 2.0 + (y < 1.5 ? 74.3 + (y + 9.4) * 1.02 : 85.4 + (y - 1.5) * 0.573);   // 東北斜界的 x
const wLine = y => -3.9 - (y + 1) * 0.16;                                                     // 西界的 x（y > 4）
const NW = { x: 8, y: 4, r: 12.7 };                                                           // 西北圓角                 // B 棟（A 棟鏡像）在 A 棟平面座標的範圍

// ---------- 小型平面（同 buildPlan 的資料形狀，給 Walker／wallSegments 用）
const G0 = { x0: GX0, y0: GY0, w: GW, h: GH };
function makePlan(rooms, openings, g = G0) {
  const { x0: GX0, y0: GY0, w: GW, h: GH } = g;
  const ids = new Int32Array(GW * GH), spaces = [null], keyIdx = new Map(), opMap = new Map(), allOpenings = [];
  const idx = (x, y) => (y - GY0) * GW + (x - GX0);
  for (const r of rooms) {
    let id = keyIdx.get(r.key);
    if (!id) { id = spaces.length; spaces.push({ id, key: r.key, type: r.t, kind: r.kind || 'room', unit: null, walk: r.walk !== false, out: !!r.out, h: r.h || 3, floor: r.floor, wall: r.wall, note: r.note, lab: r.lab, open: !!r.open, cells: 0, sx: 0, sy: 0 }); keyIdx.set(r.key, id); }
    const [x1, y1, x2, y2] = r.r.map(P);
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (x >= GX0 && y >= GY0 && x < GX0 + GW && y < GY0 + GH) ids[idx(x, y)] = id;
  }
  let uid = 0;
  for (const o of openings) {
    const at = P(o.at), c = 40 + o.c / S, w = o.w / S;
    const op = { ...o, at, c, w, uid: ++uid, a: Math.round(c - w / 2), b: Math.round(c + w / 2) };
    for (let t = op.a; t < op.b; t++) opMap.set(`${o.o}${at},${t}`, op);
    allOpenings.push(op);
  }
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const s = spaces[ids[y * GW + x]]; if (!s) continue;
    s.cells++; s.sx += x + GX0; s.sy += y + GY0;
  }
  for (const s of spaces.slice(1)) { s.cx = s.sx / s.cells; s.cy = s.sy / s.cells; s.area = s.cells * S * S; }
  const id = (x, y) => (x < GX0 || y < GY0 || x >= GX0 + GW || y >= GY0 + GH) ? 0 : ids[idx(x | 0, y | 0)];
  return { ids, spaces, openings: opMap, allOpenings, units: {}, furniture: [], id, g };
}

// 牆段：plan.js 的 wallSegments 只依牆種類合併，跨過不同空間也會連成一段；公設的室內外交界多，要依「兩側空間＋開口」切段
export function venueSegments(plan) {
  const segs = [], { x0: GX0, y0: GY0, w: GW, h: GH } = plan.g || G0;
  const scan = (o, cellA, cellB) => {
    const [L1, L2, T1, T2] = o === 'h' ? [GY0 + 1, GY0 + GH, GX0, GX0 + GW] : [GX0 + 1, GX0 + GW, GY0, GY0 + GH];
    for (let at = L1; at < L2; at++) {
      let cur = null;
      for (let t = T1; t < T2; t++) {
        const a = cellA(at, t), b = cellB(at, t), op = a !== b ? plan.openings.get(`${o}${at},${t}`) || null : null;
        const k = a !== b && (a || b) ? `${a}|${b}|${op ? op.uid : ''}` : null;
        if (cur && cur.k === k) cur.t2 = t + 1;
        else { if (cur) segs.push(cur); cur = k ? { o, at, t1: t, t2: t + 1, a, b, op, k } : null; }
      }
      if (cur) segs.push(cur);
    }
  };
  scan('h', (y, x) => plan.id(x, y - 1), (y, x) => plan.id(x, y));
  scan('v', (x, y) => plan.id(x - 1, y), (x, y) => plan.id(x, y));
  return segs;
}

// 把三角形切到水平邊長都 ≤ maxLen（非索引幾何；position／normal／uv 一起內插）
function subdivide(geo, maxLen) {
  if (geo.index) geo = geo.toNonIndexed();
  const names = ['position', 'normal', 'uv'].filter(n => geo.attributes[n]), src = names.map(n => geo.attributes[n]);
  const out = names.map(() => []), stack = [];
  const vtx = (i) => src.map(a => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k]));
  const mid = (A, B) => A.map((a, j) => a.map((v, k) => (v + B[j][k]) / 2));
  const hl = (A, B) => Math.hypot(A[0][0] - B[0][0], A[0][2] - B[0][2]);
  for (let t = 0; t < src[0].count; t += 3) stack.push([vtx(t), vtx(t + 1), vtx(t + 2)]);
  while (stack.length) {
    const [a, b, c] = stack.pop(), e = [hl(a, b), hl(b, c), hl(c, a)], m = Math.max(...e);
    if (m <= maxLen) { for (const v of [a, b, c]) v.forEach((arr, j) => out[j].push(...arr)); continue; }
    if (e[0] === m) { const d = mid(a, b); stack.push([a, d, c], [d, b, c]); }
    else if (e[1] === m) { const d = mid(b, c); stack.push([a, b, d], [a, d, c]); }
    else { const d = mid(c, a); stack.push([a, b, d], [d, b, c]); }
  }
  const g = new THREE.BufferGeometry();
  names.forEach((n, j) => g.setAttribute(n, new THREE.Float32BufferAttribute(out[j], src[j].itemSize)));
  return g;
}

// ---------- 公設專用的造型
function grassMat() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#5f7f45'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `hsl(${85 + Math.random() * 30},${35 + Math.random() * 20}%,${25 + Math.random() * 22}%)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
}
const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };

// 喬木：日日櫻（粉紅花）／白水木（銀綠葉）
function tree(V, kind, x, z, h = 3.2) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, h * 0.55, 8), V.bark, 0, h * 0.275, 0));
  const leaf = kind === 'sakura' ? V.leafPink : kind === 'gold' ? V.leafGold : kind === 'street' ? V.leafGreen : V.leafSilver;
  const r = kind === 'sakura' ? 0.85 : kind === 'street' ? 1.15 : 1.0;
  for (const [dx, dy, dz, s] of [[0, 0.75, 0, 1], [0.45, 0.6, 0.2, 0.75], [-0.4, 0.62, -0.25, 0.7], [0.1, 0.95, -0.35, 0.65], [-0.2, 0.55, 0.4, 0.6]]) {
    const b = mesh(new THREE.IcosahedronGeometry(r * s, 1), leaf, dx * r, h * dy, dz * r); b.scale.y = 0.8; g.add(b);
  }
  return g;
}
// 大廳吊燈：兩圈光環＋吊桿＋中心水晶串
function chandelier(V, y0) {
  const g = new THREE.Group();
  for (const [r, y] of [[1.7, y0 - 1.6], [1.1, y0 - 2.0]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.045, 10, 96), V.glow); ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + r; g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, y0 - y, 4), V.steel, Math.cos(a) * r, (y0 + y) / 2, Math.sin(a) * r)); }
  }
  for (let i = 0; i < 24; i++) { const a = i * 2.4, rr = 0.15 + (i % 5) * 0.08; g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), V.glow, Math.cos(a) * rr, y0 - 1.8 - (i % 7) * 0.12, Math.sin(a) * rr)); }
  return g;
}

// ---------- 通用建造：地板、牆、開口、天花、家具、碰撞
function construct(V, M, plan, { furniture = [], extras = () => {} }) {
  const { x0: GX0, y0: GY0, w: GW, h: GH } = plan.g || G0;
  const b = new Batcher(), group = V.group, blocked = new Uint8Array(GW * GH);
  const block = (x, y) => { if (x >= GX0 && y >= GY0 && x < GX0 + GW && y < GY0 + GH) blocked[(y - GY0) * GW + (x - GX0)] = 1; };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const s = plan.spaces[plan.ids[y * GW + x]]; if (!s || !s.walk) blocked[y * GW + x] = 1; }
  const FLOOR = { stone: M.floorStone, wood: M.floorWood, deck: M.floorBal, paving: V.paving, grass: V.grass, road: V.asphalt, epoxy: V.epoxy, concrete: V.concrete };
  for (const r of decompose(plan)) {
    const s = plan.spaces[r.id], mat = FLOOR[s.floor]; if (!mat) continue;
    b.plane(mat, toX(r.x1), toX(r.x2), toZ(r.y1), toZ(r.y2), 0.004);
    if (!s.out) b.plane(s.ceil || M.ceiling, toX(r.x1), toX(r.x2), toZ(r.y1), toZ(r.y2), s.h, true);
  }
  // 牆：只在「至少一側是室內」時長牆；高度取室內那側
  for (const seg of venueSegments(plan)) {
    const A = plan.spaces[seg.a], B = plan.spaces[seg.b], inA = A && !A.out, inB = B && !B.out;
    if (!inA && !inB) continue;
    if (A?.open || B?.open) continue;                          // open：同一個大空間裡的分區（坡道、中島），不長牆
    const H = seg.o === 'h', n0 = H ? toZ(seg.at) : toX(seg.at), u1 = H ? toX(seg.t1) : toZ(seg.t1), u2 = H ? toX(seg.t2) : toZ(seg.t2);
    const h = Math.max(inA ? A.h : 0, inB ? B.h : 0), t = (!A || !B || A.out || B.out) ? 0.24 : 0.16;
    const box = (mat, ua, ub, y1, y2, na, nb) => H ? b.box(mat, ua, ub, y1, y2, na, nb) : b.box(mat, na, nb, y1, y2, ua, ub);
    // 牆體刷漆；室外那面貼外牆材、石材空間那面貼石材（A 側＝座標小的一側）
    const skin = sp => !sp || sp.out ? (V.extSkin || M.facade) : sp.wall === 'stone' ? M.lobbyWall : null;
    const face = (y1, y2, ua = u1, ub = u2) => {
      if (y2 <= y1) return;
      box(M.paint, ua, ub, y1, y2, n0 - t / 2, n0 + t / 2);
      const ma = skin(A), mb = skin(B);
      if (ma) box(ma, ua, ub, y1, inA ? Math.min(y2, A.h) : y2, n0 - t / 2 - 0.012, n0 - t / 2);
      if (mb) box(mb, ua, ub, y1, inB ? Math.min(y2, B.h) : y2, n0 + t / 2, n0 + t / 2 + 0.012);
    };
    const k = seg.op ? seg.op.k : 'wall', passable = k === 'open' || k === 'door' || k === 'auto';
    if (!passable) for (let tt = seg.t1; tt < seg.t2; tt++) H ? (block(tt, seg.at - 1), block(tt, seg.at)) : (block(seg.at - 1, tt), block(seg.at, tt));
    if (k === 'wall') { face(0, h, u1 - t / 2, u2 + t / 2); continue; }
    const top = k === 'open' ? (seg.op.oh ?? Math.min(inA ? A.h : 99, inB ? B.h : 99)) : k === 'door' ? 2.3 : k === 'win' ? 2.4 : (seg.op.gh ?? h);
    face(top, h);
    const glaze = (y1, y2, mull) => {
      box(seg.op.shop ? M.shopGlass : M.glass, u1, u2, y1, y2, n0 - 0.006, n0 + 0.006);
      box(M.frame, u1, u2, y1, y1 + 0.05, n0 - 0.04, n0 + 0.04); box(M.frame, u1, u2, y2 - 0.05, y2, n0 - 0.04, n0 + 0.04);
      const n = Math.max(1, Math.round((u2 - u1) / mull));
      for (let i = 0; i <= n; i++) { const m = u1 + (u2 - u1) * i / n; box(M.frame, m - 0.03, m + 0.03, y1, y2, n0 - 0.05, n0 + 0.05); }
    };
    if (k === 'glass') glaze(0, top, seg.op.mull || 1.6);
    else if (k === 'win') { face(0, 0.9); glaze(0.9, 2.4, 1.0); }
    else if (k === 'auto') {                                    // 自動門：兩片玻璃拉開疊在兩側
      const m = (u1 + u2) / 2, w = (u2 - u1) / 2;
      box(M.frame, u1, u2, top - 0.25, top, n0 - 0.12, n0 + 0.12);
      for (const s of [-1, 1]) { const a = s < 0 ? u1 - w * 0.75 : u2 - w * 0.25; box(M.glass, a, a + w, 0.02, top - 0.25, n0 + 0.06 * s - 0.008, n0 + 0.06 * s + 0.008); }
      box(M.black, m - 0.25, m + 0.25, top - 0.2, top - 0.08, n0 - 0.13, n0 + 0.13);
    } else if (k === 'door') {                                  // 木門＋門框（開著）
      box(M.frame, u1 - 0.05, u1, 0, 2.3, n0 - t / 2 - 0.01, n0 + t / 2 + 0.01); box(M.frame, u2, u2 + 0.05, 0, 2.3, n0 - t / 2 - 0.01, n0 + t / 2 + 0.01);
      box(M.frame, u1 - 0.05, u2 + 0.05, 2.25, 2.35, n0 - t / 2 - 0.01, n0 + t / 2 + 0.01);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(u2 - u1 - 0.04, 2.2, 0.045), M.door);
      const s = seg.op.sw || 1, hu = u1 + 0.02, a = THREE.MathUtils.degToRad(80);
      const cu = hu + Math.cos(a) * (u2 - u1) / 2, cn = n0 + s * Math.sin(a) * (u2 - u1) / 2;
      H ? leaf.position.set(cu, 1.1, cn) : leaf.position.set(cn, 1.1, cu);
      leaf.rotation.y = H ? -s * a : Math.PI / 2 + s * a; b.object(leaf);
    }
  }
  // 家具（沿用住戶家具）：平面公尺 → 格子 px
  const tmp = new THREE.Group();
  for (const f of furniture) tmp.add(makeFurniture({ ...f, x: 40 + f.x / S, y: 40 + f.y / S }, M));
  extras(tmp, b);
  tmp.updateMatrixWorld(true);
  for (const o of tmp.children) {
    if (o.userData.noBlock || o.userData.walkable) continue;
    const bb = new THREE.Box3().setFromObject(o); if (bb.isEmpty() || bb.min.y > 1.2) continue;
    for (let y = Math.floor(bb.min.z / S + toPYo); y < Math.ceil(bb.max.z / S + toPYo); y++) for (let x = Math.floor(bb.min.x / S + toPXo); x < Math.ceil(bb.max.x / S + toPXo); x++) block(x, y);
  }
  const warp = V.warp;
  const meshes = b.meshes();
  if (warp) for (const m of meshes) m.geometry = subdivide(m.geometry, 1.5);   // 大面積的板只有四個角，要先切細才能貼著起伏
  if (warp) {                                              // 地坪起伏：頂點（y ≥ -0.15）依所在位置抬高；子物件整個抬高
    for (const m of meshes) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) >= -0.15) p.setY(i, p.getY(i) + warp(p.getX(i), p.getZ(i))); p.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); }
    for (const o of tmp.children) if (!o.userData.noWarp) o.position.y += warp(o.position.x, o.position.z);
  }
  for (const m of meshes) group.add(m);
  group.add(tmp);
  V.floorMeshes = group.children.filter(o => o.isMesh);
  V.blocked = blocked;
}
const toPXo = P(16.8), toPYo = P(11.3);        // 世界原點對應的格子 px（= plan.js 的 CX、CY）

// ---------- 1F 門廳大廳
// 一樓景觀：行道樹（樹穴＋矮灌木）、兩個廣場、北側彩葉樹與木平台、車道、路燈與座椅
function streetTree(V, x, z, h = 4.2) {
  const t = tree(V, 'street', x, z, h); t.userData.noBlock = true;
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5)); trunk.position.set(x, 0.5, z); trunk.visible = false;   // 只擋樹幹附近
  return [t, trunk];
}
// 設施：車道出入口警示燈與反光鏡、都市更新成果告示牌、人行步道空間告示牌（圖 9-47、14-2、9-54）
function signTex(lines, w = 512, h = 320, bg = '#1f5f5b') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const k = c.getContext('2d');
  k.fillStyle = bg; k.fillRect(0, 0, w, h); k.fillStyle = '#fff'; k.textAlign = 'center';
  lines.forEach(([t, sz], i) => { k.font = `700 ${sz}px "PingFang TC","Noto Sans TC",sans-serif`; k.fillText(t, w / 2, 70 + i * (h - 90) / Math.max(1, lines.length - 1)); });
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 });
}
function siteSigns(M, V, g, b, lx, lz) {
  const board = (x, y, rot, mat, w = 1.2, h = 0.75, y0 = 1.0) => {
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, y0 + h, 0.06), M.frame); p.position.set(lx(x) + Math.cos(rot) * s * (w / 2 - 0.05), (y0 + h) / 2, lz(y) - Math.sin(rot) * s * (w / 2 - 0.05)); g.add(p); }
    const pn = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), mat); pn.position.set(lx(x), y0 + h / 2, lz(y)); pn.rotation.y = rot; g.add(pn);
  };
  board(87.6, 23.0, 0, signTex([['都市更新成果告示牌', 46], ['文德段一小段 130 地號等 2 筆', 30], ['實施者　興富發建設', 30]]));
  board(-3.0, 22.6, 0, signTex([['人行步道空間', 48], ['供公眾通行・不得設置障礙物', 28], ['依都市更新事業計畫留設', 28]], 512, 320, '#2f6f8f'));
  // 車道出入口：警示燈（黃色閃燈）＋凸面反光鏡
  const pole = (x, y, h) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 10), M.frame); p.position.set(lx(x), h / 2, lz(y)); g.add(p); };
  pole(69.6, -8.0, 2.6);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 16), V.warn); lamp.position.set(lx(69.6), 2.7, lz(-8.0)); g.add(lamp);
  pole(77.0, -9.4, 2.8);
  const mir = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), M.mirror); mir.position.set(lx(77.0), 2.9, lz(-9.4) - 0.06); mir.rotation.y = Math.PI * 0.8; g.add(mir);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24), V.warnRim); rim.position.copy(mir.position); rim.rotation.copy(mir.rotation); g.add(rim);
  // 穿越人行步道的段落：黃色警示線
  for (const x of [70.5, 76.3]) b.box(V.warn, lx(x) - 0.06, lx(x) + 0.06, 0.003, 0.01, lz(SITE.y1), lz(-7.5));
}
function siteLandscape(M, V, g, b, lx, lz) {
  const { x1: SX1, y1: SY1, x2: SX2, y2: SY2 } = SITE;
  const add = (...o) => o.flat().forEach(m => g.add(m));
  const pit = (x, y, w = 1.4, d = 1.4) => {                    // 樹穴：石緣＋地被
    b.box(M.stone, lx(x) - w / 2, lx(x) + w / 2, 0, 0.18, lz(y) - d / 2, lz(y) + d / 2);
    b.plane(V.grass, lx(x) - w / 2 + 0.08, lx(x) + w / 2 - 0.08, lz(y) - d / 2 + 0.08, lz(y) + d / 2 - 0.08, 0.19);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d)); blk.position.set(lx(x), 0.2, lz(y)); blk.visible = false; g.add(blk);
  };
  const lamp = (x, y) => {                                     // 路燈（夜間發光，沒有實際光源以免太耗效能）
    b.box(M.frame, lx(x) - 0.06, lx(x) + 0.06, 0, 4.2, lz(y) - 0.06, lz(y) + 0.06);
    b.box(M.frame, lx(x) - 0.05, lx(x) + 0.05, 4.1, 4.2, lz(y) - 0.06, lz(y) + 0.5);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.4), V.glow); head.position.set(lx(x), 4.05, lz(y) + 0.42); head.userData.noBlock = true; g.add(head);
  };
  // 南側：沿緣石一排行道樹（約 4.4m 一棵），入口與兩個廣場留空；樹之間矮灌木帶
  for (let x = 1.5; x < 84; x += 4.4) {
    if (x > 38.5 && x < 45.8) continue;
    pit(x, 29.6, 1.4, 1.4); add(streetTree(V, lx(x), lz(29.6)));
  }
  for (let x = 3.7; x < 82; x += 8.8) if (x < 37 || x > 47) { b.box(V.hedge, lx(x) - 1.1, lx(x) + 1.1, 0, 0.55, lz(29.6) - 0.35, lz(29.6) + 0.35); const blk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.7)); blk.position.set(lx(x), 0.25, lz(29.6)); blk.visible = false; g.add(blk); }
  for (const x of [8, 26, 58, 76]) lamp(x, 30.6);
  for (const x of [12, 30, 62, 80]) add(makeFurniture({ f: 'bench', x: 40 + x / S, y: 40 + 28.4 / S, face: 'up', a: [1.8] }, M));
  // 西側、東側、北側：行道樹
  // 西側：貼牆一排樹（樹穴），外側 2.5m 人行道；北側：人行道上一排樹；東北：沿斜界一排樹
  for (let y = 9.5; y < 23; y += 4.4) { pit(-1.25, y, 0.9, 1.2); add(streetTree(V, lx(-1.25), lz(y), 4.0)); }
  for (let x = 6; x < 69.5; x += 4.4) { pit(x, -8.6, 1.0, 0.9); add(streetTree(V, lx(x), lz(-8.6), 4.6)); }
  siteSigns(M, V, g, b, lx, lz);
  for (let y = 3; y < 23; y += 4.0) { const x = neLine(y) - 1.6; pit(x, y, 1.0, 1.0); add(streetTree(V, lx(x), lz(y), 4.4)); }
  lamp(-3.9, 6); lamp(neLine(14) - 0.6, 14); lamp(20, -9.8); lamp(55, -9.8);
  // 西北角、東北角退縮花園的樹
  for (const [x, y] of [[1.2, 0.8], [2.4, 4.6], [-0.6, -4.8], [2.5, -6.4]]) { const t = tree(V, 'street', lx(x), lz(y), 4.2); t.userData.noBlock = true; g.add(t); }
  for (const [x, y] of [[81.8, 1.2], [83.2, 4.8]]) { const t = tree(V, 'street', lx(x), lz(y), 4.2); t.userData.noBlock = true; g.add(t); }
  // 北側花園：彩葉樹＋灌木；木平台的座椅
  // 北側花園：木平台前一排 5 棵彩葉樹（圖 9-46 彩色樹冠），西段兩排綠樹
  for (const [x, k] of [[13.5, 'gold'], [18.0, 'sakura'], [22.5, 'gold'], [27.0, 'sakura'], [31.5, 'gold']]) { const t = tree(V, k, lx(x), lz(-4.9), 3.2); t.userData.noBlock = true; g.add(t); }
  for (const [x, y] of [[6.5, -3.5], [9.8, -5.6], [9.5, -2.2]]) { const t = tree(V, 'street', lx(x), lz(y), 3.8); t.userData.noBlock = true; g.add(t); }
  b.box(V.hedge, lx(4.8), lx(20.0), 0, 0.5, lz(-1.6), lz(-1.15));
  for (const x of [23.5, 30.5]) add(makeFurniture({ f: 'bench', x: 40 + x / S, y: 40 + (-2.6) / S, face: 'down', a: [1.6] }, M));
  b.box(M.wood, lx(20.1), lx(34.3), -0.3, -0.01, lz(-2.9), lz(-1.05));
  b.box(M.stone, lx(-0.6), lx(34.6), -0.3, 0.0, lz(-6.25), lz(-6.0));   // 花園上緣的矮擋土牆
  // 車道：往西下坡（1:8）到地下室，兩側矮牆
  const RX1 = 34.6, RX2 = 69.0, RZ1 = -7.2, RZ2 = -1.05, len = RX2 - RX1, drop = len / 8;   // 1:8 往西下降
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(len / Math.cos(Math.atan2(drop, len)), lz(RZ2) - lz(RZ1)), V.asphalt);
  ramp.geometry.rotateX(-Math.PI / 2); ramp.rotation.z = Math.atan2(drop, len);
  ramp.position.set((lx(RX1) + lx(RX2)) / 2, RTOP - drop / 2, (lz(RZ1) + lz(RZ2)) / 2); ramp.userData.noBlock = true; g.add(ramp);
  { // 止滑橫溝（圖 9-47「車道止滑處理」）＋兩側白色邊線，順著坡度
    const ang = Math.atan2(drop, len), grooves = [];
    for (let d = 0.4; d < len; d += 0.4) grooves.push(d);
    const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.02, lz(RZ2) - lz(RZ1) - 0.4), V.groove, grooves.length), mm = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang));
    grooves.forEach((d, i) => { mm.compose(new THREE.Vector3(lx(RX2) - d * Math.cos(ang), RTOP - d * Math.sin(ang) + 0.012, (lz(RZ1) + lz(RZ2)) / 2), q, new THREE.Vector3(1, 1, 1)); gm.setMatrixAt(i, mm); });
    gm.userData.noBlock = true; g.add(gm);
    for (const z of [lz(RZ1) + 0.25, lz(RZ2) - 0.25]) { const ln = new THREE.Mesh(new THREE.BoxGeometry(len / Math.cos(ang), 0.02, 0.12), V.lineW); ln.position.set((lx(RX1) + lx(RX2)) / 2, RTOP - drop / 2 + 0.012, z); ln.rotation.z = ang; ln.userData.noBlock = true; g.add(ln); }
  }
  // 擋土牆：北側擋住 +2.4 的步道（高出步道 0.9m 當欄牆），南側靠建物；不受地坪起伏影響
  const wallM = (z, top) => { const h = top + drop + 0.3, w = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.2), M.stone); w.position.set((lx(RX1) + lx(RX2)) / 2, top - h / 2, z); w.userData.noWarp = true; w.castShadow = w.receiveShadow = true; g.add(w); };
  wallM(lz(RZ1) - 0.1, SLOPE_N + 0.9); wallM(lz(RZ2), RTOP + 0.9);
  { const e = new THREE.Mesh(new THREE.BoxGeometry(0.4, drop + 0.3 + SLOPE_N + 0.9, lz(RZ2) - lz(RZ1)), M.black); e.position.set(lx(RX1) + 0.2, (SLOPE_N + 0.9 - drop - 0.3) / 2, (lz(RZ1) + lz(RZ2)) / 2); e.userData.noWarp = true; g.add(e); }
  ramp.userData.noWarp = true;
  // 街角廣場：同心圓鋪面＋低矮圓形座椅
  const pc = [lx(-5.0), lz(26.6)];
  for (let r = 1; r <= 4.4; r += 0.8) { const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 64).rotateX(-Math.PI / 2), V.ringMat); ring.position.set(pc[0], 0.008, pc[1]); ring.userData.noBlock = true; g.add(ring); }
  { const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.45, 32), M.stone); seat.position.set(pc[0], 0.225, pc[1]); g.add(seat); }
  // 大樹廣場：大樹＋圓形樹台兼座椅
  const qc = [lx(90.0), lz(24.6)];
  { const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.45, 40), M.stone); base.position.set(qc[0], 0.225, qc[1]); g.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.05, 40), M.wood); top.position.set(qc[0], 0.47, qc[1]); top.userData.noBlock = true; g.add(top);
    const big = tree(V, 'street', qc[0], qc[1], 6.5); big.scale.set(1.7, 1.25, 1.7); big.position.y = 0.45; big.userData.noBlock = true; g.add(big);
    for (let r = 2.6; r <= 5.0; r += 1.2) { const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 64).rotateX(-Math.PI / 2), V.ringMat); ring.position.set(qc[0], 0.008, qc[1]); ring.userData.noBlock = true; g.add(ring); } }
}

function lobby(M, V) {
  const X = m => m - SHIFT;                    // A 棟平面公尺 → 本場景公尺
  const R = (x1, y1, x2, y2) => [X(x1), y1, X(x2), y2];
  const { x1: SX1, y1: SY1, x2: SX2, y2: SY2 } = SITE;
  const rooms = [
    // ---- 基地景觀（圖 9-46／9-47 地面層景觀配置）：四周步道，後面的房間會蓋過前面的
    { t: '文德路林蔭步道', key: 'walkS', out: true, floor: 'paving', r: [SX1, 23.65, SX2, SY2], note: '沿文德路的退縮人行步道（約 4m）＋公有人行道，一排行道樹（圖 9-46 林蔭步道）' },
    { t: '西側綠帶步道', key: 'walkW', out: true, floor: 'paving', r: [SX1, SY1, -0.6, 23.65], note: '基地西側沿 6M 巷，2.5m 人行道＋貼牆一排樹（圖 9-47）' },
    { t: '北側林蔭步道', key: 'walkN', out: true, floor: 'paving', r: [SX1, SY1, SX2, -6.1], note: '沿 6M 文德街 207 巷的 4m 退縮人行步道（含行道樹），往北是後山（圖 9-1 人行步道①、9-46 林蔭步道）' },
    { t: '北側花園', key: 'gardenNW', out: true, walk: false, floor: 'grass', r: [-0.6, -6.1, 34.6, -1.05] },
    { t: '東側綠帶步道', key: 'walkE', out: true, floor: 'paving', r: [BX2, -7.6, SX2, 23.65], note: '基地東側沿 8M 道路的斜向綠帶與人行道（圖 9-47）' },
    // 兩棟一樓的外側角（A 西北、B 東北）退縮成花園
    { t: '西北角花園', key: 'notchA', out: true, walk: false, floor: 'grass', r: [-0.6, -1.05, 4.65, 7.3] },
    { t: '東北角花園', key: 'notchB', out: true, walk: false, floor: 'grass', r: [79.95, -1.05, BX2, 7.3] },
    { t: '街角廣場', key: 'plazaW', out: true, floor: 'paving', r: [SX1, 20.0, -0.6, SY2], note: '西南角的圓形鋪面廣場（圖 9-46 街角廣場）' },
    { t: '大樹廣場', key: 'plazaE', out: true, floor: 'paving', r: [BX2, 16.5, SX2, SY2], note: '東南角，一棵大樹配環形座椅（圖 9-46 大樹廣場）' },
    // 兩棟一樓（店鋪、梯廳、管委會等，不開放參觀）：只做外牆與店面玻璃
    { t: 'A 棟一樓店鋪', key: 'shopA', h: 4.2, floor: 'stone', walk: false, r: [4.65, -1.05, 34.2, 7.3] },
    { t: 'A 棟一樓店鋪', key: 'shopA', h: 4.2, floor: 'stone', walk: false, r: [-0.6, 7.3, 34.2, 23.65] },
    { t: 'B 棟一樓店鋪', key: 'shopB', h: 4.2, floor: 'stone', walk: false, r: [BX1, -1.05, 79.95, 7.3] },
    { t: 'B 棟一樓店鋪', key: 'shopB', h: 4.2, floor: 'stone', walk: false, r: [BX1, 7.3, BX2, 23.65] },
    // A 棟北側：花園＋木平台（接管委會）、往地下室的車道
    { t: '木平台', key: 'woodDeck', out: true, floor: 'wood', r: [20.1, -2.9, 34.3, -1.05], note: '管理委員會使用空間外的木平台，前面一排彩葉樹（圖 9-46）；從管委會開門出來' },
    { t: '車道（往地下停車場）', key: 'ramp', out: true, walk: false, r: [34.6, -7.2, 69.0, -1.05], note: '汽機車共用車道，寬 6.15m、坡度 1:8、路面止滑處理，往地下 1～4 樓停車場（圖 9-47）' },
    { t: '車道出入口平台', key: 'apron', out: true, floor: 'paving', r: [69.0, -7.5, 79.95, -1.05], note: '車道頂端的緩衝平台（圖 9-47 約 12.3×6.45m）' },
    { t: '汽機車道出入口', key: 'cross', out: true, floor: 'road', r: [70.4, SY1, 76.4, -7.5], note: '車子從這裡穿越人行步道進出 207 巷（單行道，需 180° 迴轉），設警示燈（圖 9-54 汽機車道出入口）；行人注意來車' },
    { t: '綠籬', key: 'hedgeN', out: true, walk: false, floor: 'grass', r: [34.05, -1.05, 50.1, 0.3] },
    ...(() => {
      const out = [];
      for (let y = SY1; y < 23.6; y += 1) { const x = neLine(y + 0.5); if (x < SX2) out.push({ t: '基地外坡地', key: 'outNE', out: true, walk: false, floor: 'grass', r: [x, y, SX2, y + 1] }); }
      // 西北圓角：外面是基地外，圓角內 2.5m 是人行道（接西側與北側步道），再往內是花園
      for (let y = SY1; y < NW.y; y += 0.5) for (let x = SX1; x < NW.x; x += 0.5) {
        const d = Math.hypot(x + 0.25 - NW.x, y + 0.25 - NW.y), inBld = x >= -0.6 && y >= -1.05;
        if (d > NW.r) out.push({ t: '基地外', key: 'outW', out: true, walk: false, floor: 'road', r: [x, y, x + 0.5, y + 0.5] });
        else if (d > NW.r - 2.5) out.push({ t: '北側林蔭步道', key: 'walkN', out: true, floor: 'paving', r: [x, y, x + 0.5, y + 0.5] });
        else if (!inBld && x < -0.6 + 0.01 || !inBld && y < -1.05) out.push({ t: '北側花園', key: 'gardenNW', out: true, walk: false, floor: 'grass', r: [x, y, x + 0.5, y + 0.5] });
      }
      for (let y = NW.y; y < SY2; y += 0.5) { const x = wLine(y + 0.25); if (x > SX1) out.push({ t: '基地外', key: 'outW', out: true, walk: false, floor: 'road', r: [SX1, y, x, y + 0.5] }); }
      return out;
    })(),
    // ---- 大廳一帶
    { t: '入口前庭', key: 'court', out: true, floor: 'paving', r: R(34.05, 14.7, 50.1, 23.65), note: '大廳入口退縮在兩棟之間（計畫書審議紀錄：入口向內，避免壓縮店鋪）' },
    { t: '花圃', key: 'bedW', out: true, walk: false, floor: 'grass', r: R(34.4, 16.3, 38.3, 21.8) },
    { t: '花圃', key: 'bedE', out: true, walk: false, floor: 'grass', r: R(45.85, 16.3, 49.75, 21.8) },
    { t: '門廳大廳', key: 'lobby', h: 7.2, floor: 'stone', wall: 'stone', r: R(34.05, 7.0, 50.1, 14.7), note: '二層挑空約 7.2m；牆面石材與木作、地坪高級石材、藝術造型天花＋美術吊燈（建材表 1F 門廳）' },
    { t: '鏡面水池', key: 'pool', out: true, walk: false, r: R(34.05, 0.3, 50.1, 7.0), note: '大廳北側的水景（圖 9-19）' },
    { t: '通廊', key: 'corr', h: 3.4, floor: 'stone', wall: 'stone', r: R(23.3, 9.6, 34.05, 13.0) },
    { t: 'A 棟 1F 梯廳', key: 'hall', h: 3.2, floor: 'stone', wall: 'stone', r: R(16.0, 9.6, 23.3, 13.0), note: '電梯直達地下停車場與各樓層' },
    { t: '管理委員會使用空間', key: 'mgmt', h: 3.4, floor: 'wood', r: R(23.3, -1.05, 33.6, 9.6), note: '依公寓大廈管理條例屬共用部分，不得約定專用（計畫書第 14 章）' },
    { t: '通廊（B 棟）', key: 'corrB', h: 3.4, floor: 'stone', wall: 'stone', r: R(50.1, 9.6, 60.85, 13.0) },
    { t: 'B 棟 1F 梯廳', key: 'hallB', h: 3.2, floor: 'stone', wall: 'stone', r: R(60.85, 9.6, 72.9, 13.0), note: '電梯直達地下停車場與各樓層' },
    { t: '管理委員會使用空間（B 棟）', key: 'mgmtB', h: 3.4, floor: 'wood', r: R(50.55, -1.05, 60.85, 9.6), note: '圖 9-19：大廳東側也有一間管理委員會使用空間' },
    { t: '防災中心', key: 'ctrl', h: 3.2, walk: false, floor: 'stone', r: R(72.9, 8.0, 80.5, 13.0), note: '監控、消防受信總機、緊急廣播（圖 9-19）；值勤空間，隔玻璃看' },
  ];
  const openings = [
    { o: 'h', at: 14.7, c: X((34.05 + 40.9) / 2), w: 40.9 - 34.05, k: 'glass', gh: 4.2 },
    { o: 'h', at: 14.7, c: X((43.3 + 50.1) / 2), w: 50.1 - 43.3, k: 'glass', gh: 4.2 },
    { o: 'h', at: 14.7, c: X(42.1), w: 2.4, k: 'auto', gh: 4.2 },
    { o: 'h', at: 7.0, c: X(42.075), w: 16.0, k: 'glass', gh: 6.8 },              // 大廳北側整面玻璃看水池（計畫書未畫通往水池的門）
    { o: 'v', at: X(34.05), c: 11.3, w: 3.2, k: 'open', oh: 3.4 },
    { o: 'v', at: X(23.3), c: 11.3, w: 3.4, k: 'open', oh: 3.2 },
    { o: 'h', at: 9.6, c: X(28.0), w: 1.0, k: 'door', sw: -1 },
    { o: 'h', at: -1.05, c: X(25.0), w: 2.2, k: 'win' }, { o: 'h', at: -1.05, c: X(28.3), w: 2.2, k: 'win' },
    { o: 'h', at: -1.05, c: X(31.0), w: 1.0, k: 'door', sw: -1 },              // 管委會 → 木平台
    { o: 'v', at: X(50.1), c: 11.3, w: 3.2, k: 'open', oh: 3.4 },
    { o: 'v', at: X(60.85), c: 11.3, w: 3.4, k: 'open', oh: 3.2 },
    { o: 'h', at: 9.6, c: X(56.15), w: 1.0, k: 'door', sw: -1 },
    { o: 'h', at: -1.05, c: X(53.6), w: 2.2, k: 'glass', gh: 2.4 }, { o: 'h', at: -1.05, c: X(57.6), w: 2.2, k: 'glass', gh: 2.4 },
    { o: 'v', at: X(72.9), c: 11.4, w: 2.4, k: 'glass', gh: 2.4 },               // 防災中心對梯廳的值勤窗
    // 店面玻璃（A 棟 S1～S5、B 棟 S6～S9 沿文德路；西、東側面也有店面）
    ...[[0.4, 7.6], [8.6, 16.2], [17.2, 25.4], [26.4, 33.4]].map(([a, c]) => ({ o: 'h', at: 23.65, c: (a + c) / 2, w: c - a, k: 'glass', gh: 3.8, shop: 1, mull: 2.4 })),
    ...[[51.0, 58.4], [59.4, 67.6], [68.6, 76.2], [77.2, 84.4]].map(([a, c]) => ({ o: 'h', at: 23.65, c: (a + c) / 2, w: c - a, k: 'glass', gh: 3.8, shop: 1, mull: 2.4 })),
    ...[[15.0, 22.6]].map(([a, c]) => ({ o: 'v', at: -0.6, c: (a + c) / 2, w: c - a, k: 'glass', gh: 3.8, shop: 1, mull: 2.4 })),
    ...[[15.0, 22.6]].map(([a, c]) => ({ o: 'v', at: BX2, c: (a + c) / 2, w: c - a, k: 'glass', gh: 3.8, shop: 1, mull: 2.4 })),
  ];
  const plan = makePlan(rooms, openings, GSITE);
  const lx = m => toX(P(X(m))), lz = m => toZ(P(m));        // A 棟平面公尺 → 群組內座標
  const furniture = [
    // 大廳：沙發區、植栽、門口地墊
    { f: 'rug', x: X(39.0), y: 11.0, face: 'down', a: [3.2, 2.4] },
    { f: 'sofa', x: X(39.0), y: 9.35, face: 'down', a: [2.4] },
    { f: 'sofa', x: X(39.0), y: 12.65, face: 'up', a: [2.4] },
    { f: 'coffeeTable', x: X(39.0), y: 11.0, face: 'down' },
    { f: 'plant', x: X(35.0), y: 7.8 }, { f: 'plant', x: X(49.2), y: 7.8 }, { f: 'plant', x: X(35.0), y: 14.0 }, { f: 'plant', x: X(49.2), y: 14.0 },
    { f: 'floorLamp', x: X(36.6), y: 11.0 },
    { f: 'rug', x: X(42.1), y: 14.1, face: 'down', a: [2.4, 0.9] },
    // 通廊：牆上掛畫、植栽
    { f: 'art', x: X(26.5), y: 12.98, face: 'up', a: [1.6, 2] }, { f: 'art', x: X(31.0), y: 12.98, face: 'up', a: [1.6, 2] },
    { f: 'plant', x: X(33.4), y: 12.5 },
    // 管委會：會議桌、書櫃、沙發
    { f: 'dining', x: X(28.4), y: 5.2, face: 'down', a: [2.4, 1.0, 2] }, { f: 'pendant', x: X(28.4), y: 5.2 },
    { f: 'bookshelf', x: X(23.55), y: 5.0, face: 'right', a: [2.6] },
    { f: 'sofa', x: X(32.2), y: 2.0, face: 'left', a: [1.8] },
    { f: 'art', x: X(33.58), y: 6.5, face: 'left', a: [1.8, 1] },
    { f: 'plant', x: X(24.0), y: 1.6 },
  ];
  V.warp = (x, z) => siteH(x + 16.8, z + 11.3);              // 群組座標 → A 棟平面公尺
  V.hAt = (px, py) => siteH((px - 40) * S, (py - 40) * S);
  construct(V, M, plan, {
    furniture,
    extras(g, b) {
      // 大廳天花：藝術造型（格柵＋周邊燈槽）＋吊燈＋壁燈
      const H = 7.2, x1 = lx(34.05), x2 = lx(50.1), z1 = lz(7.0), z2 = lz(14.7);
      for (let x = x1 + 1.2; x < x2 - 0.6; x += 1.6) b.box(M.wood, x - 0.05, x + 0.05, H - 0.5, H - 0.01, z1 + 0.6, z2 - 0.6);
      b.box(M.lamp, x1 + 0.3, x2 - 0.3, H - 0.62, H - 0.58, z1 + 0.3, z1 + 0.36); b.box(M.lamp, x1 + 0.3, x2 - 0.3, H - 0.62, H - 0.58, z2 - 0.36, z2 - 0.3);
      const ch = chandelier(V, H); ch.position.set(lx(42.1), 0, lz(10.85)); ch.userData.noBlock = true; g.add(ch);
      V.lightSpots.push([lx(42.1), H - 2.0, lz(10.85), 2.2], [lx(37.5), 3.0, lz(11), 0.8], [lx(46.8), 3.0, lz(10.2), 0.8]);
      for (const z of [lz(8.2), lz(13.5)]) for (const x of [x1 + 0.08, x2 - 0.08]) b.box(M.lamp, x - 0.05, x + 0.05, 2.5, 2.9, z - 0.15, z + 0.15);
      // 東牆：木格柵主牆＋信箱牆＋往 B 棟的門框（不可通行）
      for (let z = z1 + 0.4; z < z2 - 0.3; z += 0.18) b.box(M.wood, x2 - 0.16, x2 - 0.1, 3.6, H - 0.6, z, z + 0.08);
      b.box(M.cabinet, x2 - 0.45, x2 - 0.1, 0.2, 2.1, lz(13.05), lz(14.5));
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) b.box(M.steel, x2 - 0.46, x2 - 0.45, 0.35 + r * 0.29, 0.6 + r * 0.29, lz(13.1) + c * 0.34, lz(13.1) + c * 0.34 + 0.31);
      // 管理櫃台
      const cx = lx(46.8), cz = lz(10.2);
      b.box(M.wood, cx - 1.5, cx + 1.5, 0, 1.05, cz - 0.4, cz + 0.4); b.box(M.counter, cx - 1.55, cx + 1.55, 1.05, 1.1, cz - 0.45, cz + 0.45);
      b.box(M.screen, cx - 0.5, cx - 0.1, 1.1, 1.4, cz - 0.3, cz - 0.27); b.box(M.screen, cx + 0.2, cx + 0.6, 1.1, 1.4, cz - 0.3, cz - 0.27);
      const desk = new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.1, 0.9)); desk.position.set(cx, 0.55, cz); desk.visible = false; g.add(desk);   // 碰撞用
      // 鏡面水池：水面＋石緣＋背景綠籬與樹
      const px1 = lx(34.05), px2 = lx(50.1), pz1 = lz(0.3), pz2 = lz(7.0);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(px2 - px1 - 0.4, pz2 - pz1 - 0.6).rotateX(-Math.PI / 2), V.water); water.position.set((px1 + px2) / 2, -0.06, (pz1 + pz2) / 2 + 0.1); water.userData.noBlock = true; g.add(water);   // 水面不算障礙（可不可走由空間決定）
      b.box(M.stone, px1, px2, -0.3, 0.12, pz2 - 0.4, pz2);                            // 玻璃牆外的池緣
      V.lightSpots.push([lx(42.1), 1.2, lz(3.5), 0.5]);
      // 水池中央的圓形樹島（圖 9-46 鏡面水池中央畫有一棵樹）
      { const isl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 0.5, 40), M.stone); isl.position.set(lx(42.1), -0.05, lz(2.0)); isl.userData.noBlock = true; g.add(isl);
        const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.02, 40), V.grass); soil.position.set(lx(42.1), 0.21, lz(2.0)); soil.userData.noBlock = true; g.add(soil);
        const t = tree(V, 'sakura', lx(42.1), lz(2.0), 2.8); t.position.y = 0.2; t.userData.noBlock = true; g.add(t); }
      b.box(M.stone, px1, px1 + 0.2, -0.3, 0.12, pz1, pz2); b.box(M.stone, px2 - 0.2, px2, -0.3, 0.12, pz1, pz2);
      b.box(V.hedge, px1, px2, 0, 1.6, pz1 - 0.6, pz1);
      for (const [x, k] of [[36.5, 'silver'], [40.5, 'sakura'], [44.5, 'silver'], [48.0, 'sakura']]) g.add(tree(V, k, lx(x), lz(0.6), 3.4));
      // 入口：雨遮、店鋪側牆（A 棟店鋪隱藏時補上外牆）、花圃與喬木、地燈
      b.box(M.slab, lx(38.6), lx(45.6), 4.0, 4.15, lz(14.7), lz(17.0)); b.box(M.frame, lx(38.6), lx(45.6), 3.95, 4.0, lz(16.95), lz(17.0));
      V.lightSpots.push([lx(42.1), 3.8, lz(15.8), 0.6]);
      for (const [a, c] of [[34.4, 38.3], [45.85, 49.75]]) {
        b.box(M.stone, lx(a), lx(c), 0, 0.45, lz(16.3), lz(21.8)); b.plane(V.grass, lx(a) + 0.08, lx(c) - 0.08, lz(16.3) + 0.08, lz(21.8) - 0.08, 0.46);
        const sh = tree(V, 'street', (lx(a) + lx(c)) / 2, lz(19.2), 2.2); sh.scale.set(1.3, 1, 1.3); sh.position.y = 0.45; g.add(sh);   // 圖 9-47：兩側各一株圓形灌木
      }
      for (const z of [17.5, 20.5]) for (const x of [38.5, 45.7]) b.box(M.steel, lx(x) - 0.06, lx(x) + 0.06, 0, 0.7, lz(z) - 0.06, lz(z) + 0.06);
      // 整個基地的地坪基座（高出路面 30cm），鏡面水池那塊挖空，水面才不會被蓋住
      // 挖空：鏡面水池（x 34.05～50.1、y 0.3～7.0）、車道（x 34.6～69、y -7.2～-1.05）
      const slabBox = (x1, x2, y1, y2) => b.box(M.stone, lx(x1), lx(x2), -0.3, -0.002, lz(y1), lz(y2));
      slabBox(SX1, 34.05, SY1, SY2); slabBox(69.0, SX2, SY1, SY2);
      slabBox(34.05, 69.0, SY1, -7.2); slabBox(34.05, 34.6, -7.2, 0.3); slabBox(50.1, 69.0, -1.05, SY2);
      slabBox(34.6, 50.1, -1.05, 0.3); slabBox(34.05, 50.1, 7.0, SY2);
      siteLandscape(M, V, g, b, lx, lz);
      b.box(M.black, lx(34.05), lx(50.1), -0.3, -0.25, lz(0.3), lz(7.0));                 // 水池池底
      // 梯廳：電梯門＋叫車鈕、往排煙室的防火門（關著）
      const hz = lz(9.6) + 0.13;
      b.box(M.elevator, lx(16.8), lx(17.7), 0, 2.1, hz - 0.02, hz); b.box(M.steel, lx(16.72), lx(17.78), 2.1, 2.2, hz - 0.02, hz + 0.02);
      b.box(M.steel, lx(18.0), lx(18.12), 0.95, 1.25, hz, hz + 0.015); b.box(M.black, lx(17.0), lx(17.5), 2.25, 2.37, hz, hz + 0.02);
      b.box(M.fireDoor, lx(21.9), lx(22.8), 0, 2.1, hz - 0.02, hz + 0.01); b.box(M.exitSign, lx(22.15), lx(22.55), 2.2, 2.34, hz, hz + 0.05);
      // B 棟側：梯廳電梯與防火門、管委會（B）、防災中心內部
      const hzB = lz(9.6) + 0.13;
      b.box(M.elevator, lx(66.4), lx(67.3), 0, 2.1, hzB - 0.02, hzB); b.box(M.steel, lx(66.32), lx(67.38), 2.1, 2.2, hzB - 0.02, hzB + 0.02);
      b.box(M.steel, lx(66.1), lx(66.22), 0.95, 1.25, hzB, hzB + 0.015); b.box(M.black, lx(66.6), lx(67.1), 2.25, 2.37, hzB, hzB + 0.02);
      b.box(M.fireDoor, lx(61.5), lx(62.4), 0, 2.1, hzB - 0.02, hzB + 0.01); b.box(M.exitSign, lx(61.75), lx(62.15), 2.2, 2.34, hzB, hzB + 0.05);
      for (const [f, x, y, face, a] of [['dining', 55.7, 4.6, 'down', [2.4, 1.0, 2]], ['bookshelf', 60.6, 4.0, 'left', [2.6]], ['plant', 51.2, 0.0]])
        g.add(makeFurniture({ f, x: 40 + X(x) / S, y: 40 + y / S, face, a }, M));
      { const cx2 = lx(77.6), cz2 = lz(10.6);                                     // 防災中心：監控牆＋值勤台
        b.box(M.black, cx2 + 2.5, cx2 + 2.75, 0.8, 2.6, cz2 - 1.8, cz2 + 1.8);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) b.box(M.screen, cx2 + 2.48, cx2 + 2.5, 0.95 + r * 0.55, 1.4 + r * 0.55, cz2 - 1.6 + c * 0.82, cz2 - 0.9 + c * 0.82);
        b.box(M.hydrant, cx2 - 0.4, cx2 + 0.2, 0, 1.8, lz(8.1), lz(8.1) + 0.4);
        b.box(M.wood, cx2 - 1.2, cx2 + 1.2, 0, 0.75, cz2 - 0.4, cz2 + 0.4); b.box(M.screen, cx2 - 0.5, cx2 + 0.1, 0.75, 1.1, cz2 - 0.1, cz2 - 0.07); }
      for (let x = 51.5; x < 60.5; x += 2.2) V.lightSpots.push([lx(x), 3.2, lz(11.3), 0.35]);
      V.lightSpots.push([lx(55.7), 2.6, lz(4.6), 0.6]);
      // 管委會門牌燈、通廊嵌燈
      for (let x = 24.5; x < 33.5; x += 2.2) V.lightSpots.push([lx(x), 3.2, lz(11.3), 0.35]);
      V.lightSpots.push([lx(28.4), 2.6, lz(5.2), 0.8], [lx(19.5), 3.0, lz(11.3), 0.5]);
    },
  });
  // 給外面判斷用：A 棟平面公尺 → 群組內 px
  const PX = (x, y) => [P(X(x)), P(y)];
  Object.assign(V, {
    plan, spawn: [...PX(42.1, 27.0), 0],
    stops: [
      { name: '文德路林蔭步道', p: PX(20.0, 26.2), yaw: Math.PI / 2, note: '' },
      { name: '街角廣場', p: PX(-5.0, 28.4), yaw: Math.PI * 0.8, note: '' },
      { name: '西側綠帶步道', p: PX(-3.4, 10.0), yaw: 0, note: '' },
      { name: '北側林蔭步道', p: PX(10.0, -8.4), yaw: -Math.PI / 2, note: '' },
      { name: '木平台', p: PX(24.2, -1.7), yaw: 0.4, note: '' },
      { name: '東側綠帶步道', p: PX(88.2, 14.0), yaw: Math.PI * 0.85, note: '' },
      { name: '大樹廣場', p: PX(88.0, 27.0), yaw: -0.6, note: '旁邊是都市更新成果告示牌' },
      { name: '汽機車道出入口', p: PX(73.4, -9.3), yaw: Math.PI, note: '車道穿越北側人行步道接 207 巷，設警示燈與反光鏡' },
      { name: '入口前庭', p: PX(42.1, 19.0), yaw: 0, note: '從文德路退縮進來的入口，室外無障礙坡道坡度約 1/46（圖 9-54）' },
      { name: '門廳大廳', p: PX(42.1, 13.2), yaw: 0, note: '二樓挑空、藝術天花與吊燈，正面看出去是鏡面水池' },
      { name: '沙發區', p: PX(41.0, 11.0), yaw: Math.PI / 2, note: '' },
      { name: '管理櫃台', p: PX(46.8, 11.6), yaw: 0, note: '信箱牆在東側；往東經通廊到 B 棟梯廳與防災中心' },
      { name: '鏡面水池（隔玻璃）', p: PX(42.1, 7.7), yaw: 0, pitch: -0.2, note: '水池在大廳北側，計畫書沒有畫通往水池的門，隔著整面玻璃欣賞' },
      { name: '管理委員會使用空間', p: PX(28.4, 7.6), yaw: 0, note: '' },
      { name: 'A 棟梯廳', p: PX(19.5, 11.3), yaw: 0, note: '' },
      { name: '管理委員會使用空間（B 棟）', p: PX(56.15, 7.6), yaw: 0, note: '' },
      { name: 'B 棟梯廳', p: PX(65.0, 11.3), yaw: Math.PI, note: '' },
      { name: '防災中心（值勤窗）', p: PX(71.8, 11.4), yaw: -Math.PI / 2, note: '防災中心是值勤空間，從梯廳的值勤窗看進去' },
    ],
  });
}

// ---------- A 棟屋頂花園（屋突層）
function roof(M, V) {
  const beds = [
    [-0.3, -0.75, 15.6, 0.85], [18.0, -0.75, 33.9, 0.85], [-0.3, 21.75, 15.6, 23.35], [18.0, 21.75, 33.9, 23.35],
    [-0.3, 0.85, 1.3, 10.1], [-0.3, 12.5, 1.3, 21.75], [32.3, 0.85, 33.9, 10.1], [32.3, 12.5, 33.9, 21.75],
  ];
  const rooms = [
    { t: '屋頂花園', key: 'deck', out: true, floor: 'deck', lab: [16.8, 19.6], r: [-0.3, -0.75, 33.9, 23.35], note: '四周花台種日日櫻、白水木，地面石材與防滑石英磚（圖 9-49、建材表）' },
    ...beds.map((r, i) => ({ t: '花台', key: 'bed' + i, out: true, walk: false, floor: 'grass', r })),
    { t: '屋突（樓梯間・機房）', key: 'core', out: true, walk: false, lab: [16.8, 11.3], r: [10.3, 6.65, 23.3, 15.95] },
  ];
  const plan = makePlan(rooms, []);
  const lx = m => toX(P(m)), lz = m => toZ(P(m));
  const furniture = [];
  for (const x of [4, 8.5, 25, 29.5]) { furniture.push({ f: 'bench', x, y: 2.3, face: 'up', a: [1.6] }, { f: 'bench', x, y: 20.3, face: 'down', a: [1.6] }); }
  for (const y of [5, 17.5]) { furniture.push({ f: 'bench', x: 2.75, y, face: 'left', a: [1.6] }, { f: 'bench', x: 30.85, y, face: 'right', a: [1.6] }); }
  construct(V, M, plan, {
    furniture,
    extras(g, b) {
      let k = 0;
      for (const [x1, y1, x2, y2] of beds) {
        b.box(M.stone, lx(x1), lx(x2), 0, 0.5, lz(y1), lz(y2)); b.plane(V.grass, lx(x1) + 0.08, lx(x2) - 0.08, lz(y1) + 0.08, lz(y2) - 0.08, 0.51);
        const along = x2 - x1 > y2 - y1, len = along ? x2 - x1 : y2 - y1, n = Math.max(1, Math.round(len / 1.9));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n, x = along ? x1 + len * t : (x1 + x2) / 2, y = along ? (y1 + y2) / 2 : y1 + len * t;
          const tr = tree(V, k++ % 3 === 0 ? 'sakura' : 'silver', lx(x), lz(y), 2.8); tr.position.y = 0.5; tr.userData.noBlock = true; g.add(tr);
        }
      }
      // 屋突出入口：鋼門＋雨遮＋壁燈
      const dz = lz(15.95) + 0.02;
      b.box(M.fireDoor, lx(16.9), lx(18.1), 0, 2.2, dz, dz + 0.04); b.box(M.slab, lx(16.4), lx(18.6), 2.5, 2.6, dz, dz + 1.0); b.box(M.exitSign, lx(17.3), lx(17.7), 2.28, 2.42, dz, dz + 0.05);
      // 步道地燈
      for (let x = 3; x < 32; x += 4) for (const y of [1.6, 21.0]) { b.box(M.steel, lx(x) - 0.05, lx(x) + 0.05, 0, 0.55, lz(y) - 0.05, lz(y) + 0.05); b.box(M.lamp, lx(x) - 0.06, lx(x) + 0.06, 0.55, 0.62, lz(y) - 0.06, lz(y) + 0.06); }
    },
  });
  Object.assign(V, {
    plan, spawn: [P(17.5), P(16.9), Math.PI],
    stops: [
      { name: '屋突出入口', p: [P(17.5), P(16.9)], yaw: Math.PI, note: '從樓梯間上來；屋頂是否開放使用依管委會規約' },
      { name: '南側（文德路、101 方向）', p: [P(16.8), P(22.7)], yaw: Math.PI, note: '花台中間的缺口可以走到女兒牆邊' },
      { name: '西側（美麗華方向）', p: [P(0.3), P(11.3)], yaw: Math.PI / 2, note: '' },
      { name: '北側（後山、碧湖）', p: [P(16.8), P(-0.2)], yaw: 0, note: '' },
      { name: '東側（B 棟）', p: [P(33.3), P(11.3)], yaw: -Math.PI / 2, note: '' },
    ],
    edgeRing: true,
  });
}


// ---------- 地下停車場（圖 9-15～9-17 地下一～四層平面、9-55／9-56 無障礙）
// 座標同 A 棟平面公尺；柱網 Y2～Y12（x）、X1～X5（y）依圖面尺寸；B2～B4 汽車層格局相同，B1 以機車停車為主
const PK = { x1: -1.5, y1: -6.0, x2: 86.9, y2: 29.8 };
const COLX = [0, 8.75, 16.95, 25.15, 34.15, 41.65, 51.0, 60.0, 68.2, 76.4, 85.15].map(v => v - 0.1);
const COLY = [-5.4, 1.5, 8.5, 16.8, 23.8, 29.2];
const RAMP = { x: 38.25, y: 6.06, r1: 5.8, r2: 11.6 };      // 中央螺旋坡道（環形車道），中島是法定停車位
const MX = x => 84.6 - x;                                  // B 棟＝A 棟鏡射
const inRamp = (x, y, pad = 0.6) => Math.hypot(x - RAMP.x, y - RAMP.y) < RAMP.r2 + pad;

function carMesh(M, V, hue) {
  const g = new THREE.Group(), body = V.carPaint[hue % V.carPaint.length];
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
  add(new THREE.BoxGeometry(1.8, 0.62, 4.4), body, 0, 0.55, 0);
  add(new THREE.BoxGeometry(1.6, 0.5, 2.3), V.carGlass, 0, 1.1, -0.15);
  for (const [x, z] of [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14), V.tire); w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w); }
  return g;
}
function scooterMesh(M, V, hue) {
  // 速克達：踏板、前擋、座墊、把手、兩輪（約 0.7 寬 × 1.8 長）
  const g = new THREE.Group(), body = V.carPaint[hue % V.carPaint.length];
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  add(new THREE.BoxGeometry(0.3, 0.12, 0.8), body, 0, 0.32, 0.05);                  // 踏板
  add(new THREE.BoxGeometry(0.34, 0.75, 0.16), body, 0, 0.62, 0.55, -0.25);          // 前擋
  add(new THREE.BoxGeometry(0.34, 0.32, 0.7), body, 0, 0.55, -0.45);                 // 後車身
  add(new THREE.BoxGeometry(0.3, 0.1, 0.62), V.tire, 0, 0.76, -0.42);                // 座墊
  add(new THREE.BoxGeometry(0.62, 0.04, 0.04), M.steel, 0, 1.05, 0.62);             // 把手
  for (const z of [0.68, -0.62]) { const w = add(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 14), V.tire, 0, 0.2, z); w.rotation.z = Math.PI / 2; }
  return g;
}
function park(M, V, level) {
  const B1 = level === 'b1', H = B1 ? 4.0 : 3.0;
  const core = mx => {                                     // 電梯廳（排煙室）＋電梯＋樓梯＋機電，B 棟用 MX 鏡射
    const R = (x1, y1, x2, y2) => { const a = mx(x1), b = mx(x2); return [Math.min(a, b), y1, Math.max(a, b), y2]; };
    const k = mx === MX ? 'B' : 'A';
    return [
      { t: '機電空間', key: 'mep' + k, h: H, walk: false, floor: 'concrete', r: R(10.8, 8.8, 12.6, 12.2) },
      { t: '無障礙電梯', key: 'el1' + k, h: H, walk: false, floor: 'concrete', r: R(12.6, 8.8, 14.6, 12.2) },
      { t: `${k} 棟電梯廳（排煙室）`, key: 'lob' + k, h: H, floor: 'stone', wall: 'stone', r: R(14.6, 8.8, 17.6, 14.4), note: '無障礙電梯與一般電梯直達各樓層；梯廳兼排煙室，平時門開著' },
      { t: '電梯', key: 'el2' + k, h: H, walk: false, floor: 'concrete', r: R(17.6, 8.8, 19.4, 12.2) },
      { t: '安全梯', key: 'st' + k, h: H, walk: false, floor: 'concrete', r: R(19.4, 8.8, 25.0, 12.2) },
    ];
  };
  const rooms = [
    { t: B1 ? '地下一層停車場' : '地下二層停車場', key: 'park', h: H, floor: 'epoxy', r: [PK.x1, PK.y1, PK.x2, PK.y2], note: B1 ? '以機車停車位為主（321 格），東北側是汽車位與電動車充電預留' : '汽車停車層（B3、B4 格局相同）；車道寬 6m，停車格 2.5×5.5m' },
    ...core(x => x), ...core(MX),
  ];
  // 中央坡道：北半圈是往上下層的坡道（不可走），中島是停車位（不可走）
  for (let y = PK.y1; y < RAMP.y + 0.01; y += 0.5) for (let x = RAMP.x - RAMP.r2; x < RAMP.x + RAMP.r2; x += 0.5) {
    const d = Math.hypot(x + 0.25 - RAMP.x, y + 0.25 - RAMP.y);
    if (d > RAMP.r1 && d < RAMP.r2) rooms.push({ t: '螺旋坡道', key: 'ramp', h: H, walk: false, open: true, floor: 'epoxy', r: [x, y, x + 0.5, y + 0.5], note: '往上下樓層的汽車坡道（坡度 1:6，車道止滑處理）' });
  }
  rooms.push({ t: '坡道中島（停車位）', key: 'island', h: H, walk: false, open: true, floor: 'epoxy', r: [RAMP.x - 5.2, RAMP.y - 4.6, RAMP.x + 5.2, RAMP.y + 4.6] });
  if (B1) rooms.push(
    { t: '垃圾儲藏室', key: 'trash', h: H, floor: 'concrete', r: [16.9, 17.4, 25.4, 25.8], note: '社區垃圾與資源回收集中存放，垃圾車從臨時停車空間收運（圖 9-17）' },
    { t: '臨時停車空間', key: 'temp', h: H, floor: 'epoxy', r: [25.6, 17.4, 33.4, 25.8], note: '垃圾車與臨時卸貨用（3 格）' },
    { t: '電信機電設備空間', key: 'tel', h: H, walk: false, floor: 'concrete', r: [74.3, 12.4, 78.3, 20.6] },
    { t: '發電機電設備空間', key: 'gen', h: H, walk: false, floor: 'concrete', r: [78.3, 12.4, 86.9, 21.0] },
    { t: '台電配電室', key: 'tpc', h: H, walk: false, floor: 'concrete', r: [78.3, 21.0, 86.9, 29.8] },
  );
  const openings = [
    { o: 'h', at: 14.4, c: 16.1, w: 1.0, k: 'door', sw: 1 }, { o: 'h', at: 14.4, c: MX(16.1), w: 1.0, k: 'door', sw: 1 },
    ...(B1 ? [{ o: 'h', at: 17.4, c: 21.2, w: 2.4, k: 'open', oh: 2.6 }, { o: 'v', at: 25.6, c: 21.6, w: 3.0, k: 'open', oh: 3.0 }, { o: 'h', at: 17.4, c: 29.5, w: 7.0, k: 'open', oh: 3.2 }] : []),
  ];
  const plan = makePlan(rooms, openings, GSITE);
  const lx = m => toX(P(m)), lz = m => toZ(P(m));
  V.extSkin = V.concrete;
  construct(V, M, plan, {
    extras(g, b) {
      let seed = level === 'b1' ? 7 : 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const stalls = [];                                   // [x, y, 朝向(+1 車頭朝南 / -1 朝北), 寬, 深, 類型]
      const row = (x1, x2, y1, face, kind = 'car', w = 2.5, d = 5.5) => {
        for (let x = x1; x + w <= x2 + 0.01; x += w) {
          const cx = x + w / 2, cy = y1 + d / 2;
          if (inRamp(cx, cy) || COLX.some(c => Math.abs(c - x) < 0.01 && false)) continue;
          if (plan.spaces[plan.id(P(cx), P(cy))]?.key !== 'park') continue;
          stalls.push([cx, cy, face, w, d, kind]);
        }
      };
      if (!B1) {
        row(0.2, 27.7, -5.6, 1); row(50.4, 84.0, -5.6, 1);
        row(0.2, 10.2, 6.6, -1); row(0.2, 10.2, 12.1, 1); row(MX(10.2), MX(0.2), 6.6, -1); row(MX(10.2), MX(0.2), 12.1, 1);
        row(10.6, 25.6, 14.6, 1); row(MX(25.6), MX(10.6), 14.6, 1);
        row(26.0, 31.0, 6.6, -1); row(MX(31.0), MX(26.0), 6.6, -1); row(26.0, 31.0, 12.1, 1); row(MX(31.0), MX(26.0), 12.1, 1);
        row(0.2, 67.7, 23.6, -1); row(75.4, 84.4, 23.6, -1);
        row(68.2, 71.5, 23.6, -1, 'acc', 3.3); row(71.6, 75.0, 23.6, -1, 'acc', 3.3);   // 無障礙車位（含 1.5m 下車區，圖 9-56）
      } else {
        row(51.6, 84.0, -5.6, 1, 'ev');                                                // 東北側汽車位（電動車充電預留）
        row(MX(10.2), MX(0.2), 6.6, -1, 'ev'); row(MX(25.6), MX(10.6), 14.6, 1); row(MX(10.2), MX(0.2), 12.1, 1);
        // 機車位 0.9×2.2：A 棟側成排、南側一長排、B 棟中段
        const moto = (x1, x2, y1, face) => row(x1, x2, y1, face, 'moto', 0.9, 2.2);
        moto(0.2, 27.8, -5.6, 1); for (const y of [-0.8, 1.4, 5.2, 7.4]) moto(0.4, 10.2, y, y > 3 ? -1 : 1);
        for (const y of [13.6, 18.5, 20.7, 23.0]) moto(0.4, 16.4, y, 1);
        moto(18.0, 66.2, 27.4, -1); moto(26.0, 31.4, 1.0, 1); moto(46.0, 52.0, 18.0, 1); moto(47.4, 64.4, 13.0, 1); moto(51.0, 72.4, 20.3, 1); moto(51.0, 72.4, 22.5, -1);
        for (const y of [0.0, 2.2]) moto(-1.2, -0.3, y, 1);
        // 無障礙機車位（圖 9-56，A 棟電梯廳西側）
        row(1.0, 9.0, 15.4, 1, 'accm', 2.25, 2.2);
      }
      // 停車格線、車輛（約七成有車）、無障礙標示
      for (const [x, y, face, w, d, kind] of stalls) {
        const X1 = lx(x - w / 2), X2 = lx(x + w / 2), Z1 = lz(y - d / 2), Z2 = lz(y + d / 2);
        const line = kind === 'acc' || kind === 'accm' ? V.lineBlue : V.lineW;
        b.box(line, X1, X1 + 0.08, 0.004, 0.01, Z1, Z2); b.box(line, X2 - 0.08, X2, 0.004, 0.01, Z1, Z2);
        b.box(line, X1, X2, 0.004, 0.01, face > 0 ? Z2 - 0.08 : Z1, face > 0 ? Z2 : Z1 + 0.08);
        if (kind === 'acc' || kind === 'accm') { b.box(V.lineBlue, X1 + 0.3, X2 - 0.3, 0.003, 0.008, Z1 + 0.6, Z2 - 0.6); continue; }   // 無障礙格（藍底），空著示意
        if (kind === 'ev') b.box(V.warn, X1 + w / 2 - 0.25, X1 + w / 2 + 0.25, 1.2, 1.5, face > 0 ? Z1 + 0.05 : Z2 - 0.1, face > 0 ? Z1 + 0.1 : Z2 - 0.05);   // 充電座位置
        if (rnd() < 0.3) continue;
        const v = kind === 'moto' ? scooterMesh(M, V, Math.floor(rnd() * 9)) : carMesh(M, V, Math.floor(rnd() * 9));
        v.position.set(lx(x), 0, lz(y)); g.add(v);
      }
      // 坡道中島的車（不可走）
      for (const dx of [-3.75, -1.25, 1.25, 3.75]) for (const dy of [-2.7, 2.7]) if (rnd() > 0.25) { const v = carMesh(M, V, Math.floor(rnd() * 9)); v.position.set(lx(RAMP.x + dx), 0, lz(RAMP.y + dy)); v.userData.noBlock = true; g.add(v); }
      b.box(M.stone, lx(RAMP.x - 5.3), lx(RAMP.x + 5.3), 0, 0.15, lz(RAMP.y - 4.7), lz(RAMP.y + 4.7));
      // 螺旋坡道：北半圈做成往上爬的環形坡面，南半圈是平的環形車道（畫行車方向箭頭）
      { const geo = new THREE.RingGeometry(RAMP.r1, RAMP.r2, 64, 1, 0, Math.PI), p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)); p.setZ(i, (a / Math.PI) * H); }
        geo.rotateX(-Math.PI / 2); geo.computeVertexNormals();
        const ramp = new THREE.Mesh(geo, V.epoxyDark); ramp.position.set(lx(RAMP.x), 0.02, lz(RAMP.y)); ramp.material.side = THREE.DoubleSide; ramp.userData.noBlock = true; g.add(ramp);
        const edge = new THREE.Mesh(new THREE.TorusGeometry(RAMP.r1, 0.12, 6, 64, Math.PI), M.stone); edge.rotation.x = -Math.PI / 2; edge.position.set(lx(RAMP.x), 0.12, lz(RAMP.y)); edge.userData.noBlock = true; g.add(edge);
        for (const a of [0.2, 0.8]) { const ar = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 3), V.lineW); ar.rotation.set(-Math.PI / 2, 0, a < 0.5 ? Math.PI / 2 : -Math.PI / 2); ar.position.set(lx(RAMP.x + Math.cos(a * Math.PI) * 8.7), 0.02, lz(RAMP.y + Math.sin(a * Math.PI) * 8.7)); ar.scale.y = 0.05; ar.userData.noBlock = true; g.add(ar); }
      }
      // 柱（0.9m 見方，坡道範圍內沒有）
      for (const x of COLX) for (const y of COLY) {
        if (inRamp(x, y, -0.5) && Math.hypot(x - RAMP.x, y - RAMP.y) > RAMP.r1 - 0.5) continue;
        if (plan.spaces[plan.id(P(x), P(y))]?.key !== 'park' && !(y < -5 || y > 29)) continue;
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, H, 0.9), V.concrete); c.position.set(lx(x), H / 2, lz(y)); g.add(c);
        for (const [y1, y2] of [[0, 0.2], [0.4, 0.6], [0.8, 1.0]]) b.box(V.warn, lx(x) - 0.46, lx(x) + 0.46, y1, y2, lz(y) - 0.46, lz(y) + 0.46);   // 柱腳黃色防撞條紋
      }
      // 電梯門、日光燈、出口指示
      for (const mx of [x => x, MX]) {
        const zD = lz(12.2) + 0.12;
        for (const [a, c] of [[12.9, 14.3], [17.8, 19.2]]) { const x1 = lx(Math.min(mx(a), mx(c))), x2 = lx(Math.max(mx(a), mx(c))); b.box(M.elevator, x1, x2, 0, 2.1, zD - 0.02, zD); b.box(M.steel, x1 - 0.06, x2 + 0.06, 2.1, 2.2, zD - 0.02, zD + 0.02); }
        b.box(M.exitSign, lx(mx(15.7)) - 0.2, lx(mx(15.7)) + 0.2, 2.3, 2.44, lz(14.4) + 0.1, lz(14.4) + 0.15);
      }
      for (const y of [-2.6, 20.6]) for (let x = 1; x < 84; x += 3.2) if (!inRamp(x, y)) b.box(M.lamp, lx(x) - 0.6, lx(x) + 0.6, H - 0.06, H - 0.02, lz(y) - 0.06, lz(y) + 0.06);
      for (const x of [5.2, MX(5.2), 18, MX(18)]) for (let y = 1; y < 23; y += 3.2) b.box(M.lamp, lx(x) - 0.06, lx(x) + 0.06, H - 0.06, H - 0.02, lz(y) - 0.6, lz(y) + 0.6);
      V.lightSpots.push([lx(16.1), H - 0.3, lz(11.5), 0.6], [lx(MX(16.1)), H - 0.3, lz(11.5), 0.6], [lx(38.25), H - 0.3, lz(20.5), 0.8], [lx(10), H - 0.3, lz(-2.6), 0.8], [lx(70), H - 0.3, lz(-2.6), 0.8], [lx(10), H - 0.3, lz(20.6), 0.8], [lx(70), H - 0.3, lz(20.6), 0.8]);
      if (B1) {                                            // 垃圾儲藏室：子母車＋回收桶
        for (let i = 0; i < 4; i++) { const bin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.0), i % 2 ? V.binG : V.binB); bin.position.set(lx(18.2 + i * 1.6), 0.55, lz(24.8)); g.add(bin); }
        for (const x of [27.0, 29.5, 32.0]) { b.box(V.lineW, lx(x) - 1.2, lx(x) - 1.12, 0.004, 0.01, lz(18), lz(25.4)); }
      }
    },
  });
  const PX = (x, y) => [P(x), P(y)];
  Object.assign(V, {
    plan, spawn: [...PX(16.1, 13.4), Math.PI],
    stops: [
      { name: 'A 棟電梯廳', p: PX(16.1, 13.4), yaw: Math.PI, note: '' },
      { name: 'B 棟電梯廳', p: PX(MX(16.1), 13.4), yaw: Math.PI, note: '' },
      { name: '中央螺旋坡道', p: PX(38.25, 20.4), yaw: 0, pitch: 0.05, note: '環形車道；北半圈是往上下樓層的坡道，中島也是停車位' },
      ...(B1 ? [
        { name: '機車停車區', p: PX(5.2, 4.3), yaw: Math.PI / 2, note: '機車位 0.9×2.2m，共 321 格，24 格有充電插座' },
        { name: '垃圾儲藏室', p: PX(21.2, 16.4), yaw: Math.PI, note: '' },
        { name: '臨時停車空間', p: PX(29.5, 16.4), yaw: Math.PI, note: '' },
        { name: '汽車位（電動車預留）', p: PX(67, 0.6), yaw: 0, note: '東北側汽車位，黃色是充電座預留位置（圖 9-17：22 格預留充電管線）' },
        { name: '無障礙機車位', p: PX(5.0, 14.4), yaw: Math.PI, note: '靠近 A 棟電梯廳（圖 9-56）' },
      ] : [
        { name: '無障礙車位', p: PX(71.6, 21.8), yaw: Math.PI, note: '兩格 3.3m 寬無障礙車位，經無障礙通路到 B 棟電梯廳（圖 9-56）' },
        { name: '北側車道', p: PX(14, -2.6), yaw: Math.PI / 2, note: '' },
        { name: '南側車道', p: PX(60, 20.6), yaw: Math.PI / 2, note: '' },
      ]),
    ],
  });
}

export function buildVenues(M, { roofY, b1Y, b2Y }) {
  const shared = {
    paving: Object.assign(M.floorBal.clone(), {}), grass: grassMat(), hedge: new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.95 }),
    bark: new THREE.MeshStandardMaterial({ color: 0x6b5644, roughness: 0.9 }),
    leafPink: new THREE.MeshStandardMaterial({ color: 0xe9a9bd, roughness: 0.85 }),
    leafGold: new THREE.MeshStandardMaterial({ color: 0xd9a845, roughness: 0.85 }), leafGreen: new THREE.MeshStandardMaterial({ color: 0x6f9a55, roughness: 0.85 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3e4247, roughness: 0.9 }), groove: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 1 }), lineW: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 }),
    warn: new THREE.MeshStandardMaterial({ color: 0xf2b01e, emissive: 0xffa000, emissiveIntensity: 0.6, roughness: 0.5 }), warnRim: new THREE.MeshStandardMaterial({ color: 0xe8541e, roughness: 0.5 }), ringMat: new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9 }), leafSilver: new THREE.MeshStandardMaterial({ color: 0x8fa58f, roughness: 0.85 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xfff2d6, emissive: 0xffe2b0, emissiveIntensity: 1.6, roughness: 0.4 }),
    steel: M.steel, water: new THREE.MeshStandardMaterial({ color: 0x52666d, roughness: 0.03, metalness: 0.95 }),
    epoxy: new THREE.MeshStandardMaterial({ color: 0x8c9a92, roughness: 0.45 }), epoxyDark: new THREE.MeshStandardMaterial({ color: 0x6f7a74, roughness: 0.5 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.9 }), lineBlue: new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.7 }),
    carGlass: new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.15, metalness: 0.4 }), tire: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.9 }),
    binG: new THREE.MeshStandardMaterial({ color: 0x3f7f4a, roughness: 0.7 }), binB: new THREE.MeshStandardMaterial({ color: 0x3a5f9a, roughness: 0.7 }),
    carPaint: [0xf2f2f0, 0x1d1e21, 0x8a9096, 0xb5b9bd, 0x7a1f24, 0x2c3e66, 0xe7e2d6, 0x4b4f54, 0x9aa7a0].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.5 })),
  };
  const mk = (key, name, desc) => ({ key, name, desc, group: new THREE.Group(), lightSpots: [], ...shared });
  const L = mk('lobby', '1F 大廳與景觀', '兩棟之間的住宅入口，二樓挑空、北側鏡面水池；往西經通廊到 A 棟梯廳與管委會。外面一圈是基地景觀：文德路林蔭步道、街角廣場、大樹廣場、西側與東側綠帶、北側林蔭步道與木平台');
  const T = mk('roof', 'A 棟屋頂花園', '21 樓頂上的屋突層，四周花台與喬木圍一圈步道，可以看四周景觀');
  const K1 = mk('b1', 'B1 機車層', '地下一層：機車停車位為主，另有垃圾儲藏室、臨時停車空間、電信／發電機電與台電配電室，東北側汽車位預留電動車充電');
  const K2 = mk('b2', 'B2 汽車層', '地下二層汽車停車（B3、B4 格局相同），中央螺旋坡道串起各層，B 棟電梯旁有兩格無障礙車位');
  // 第一次進場景才建（四個場景一起建要好幾秒，手機開頁會明顯變慢）
  const builders = { lobby: () => lobby(M, L), roof: () => roof(M, T), b1: () => park(M, K1, 'b1'), b2: () => park(M, K2, 'b2') };
  L.world = { x: SHIFT, y: 0.3, z: 0 }; T.world = { x: 0, y: roofY, z: 0 };
  K1.world = { x: 0, y: b1Y, z: 0 }; K1.indoor = true; K2.world = { x: 0, y: b2Y, z: 0 }; K2.indoor = true;
  for (const V of [L, T, K1, K2]) {
    V.group.visible = false; V.group.position.set(V.world.x, V.world.y, 0); V.lights = [];
    V.build = () => {
      if (V.built) return V; V.built = true;
      builders[V.key]();
      V.group.position.set(V.world.x, V.world.y, 0);
      V.lights = V.lightSpots.slice(0, 10).map(([x, y, z, w]) => { const l = new THREE.PointLight(0xffe2b8, 0, 9, 2); l.position.set(x, y, z); l.userData.w = w; V.group.add(l); return l; });
      return V;
    };
  }
  return { lobby: L, roof: T, b1: K1, b2: K2 };
}
