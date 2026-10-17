import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, CX, CY, GX0, GY0, GW, GH, CEIL_H, FLOOR_H, FOOTPRINT, toX, toZ, decompose, wallSegments } from './plan.js';
import { makeFurniture } from './furniture.js';

// 依材質收集幾何，最後合併成少量 draw call
export class Batcher {
  constructor() { this.b = new Map(); }
  add(mat, geo) {
    if (geo.index) geo = geo.toNonIndexed();
    if (!this.b.has(mat)) this.b.set(mat, []);
    this.b.get(mat).push(geo);
  }
  box(mat, x1, x2, y1, y2, z1, z2) {
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1), d = Math.abs(z2 - z1);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    if (mat.userData.worldUV) {                 // 貼磚：UV 用世界公尺座標，磚縫才會連續
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), az = Math.abs(n.getZ(i));
        uv.setXY(i, ax > 0.5 ? p.getZ(i) : p.getX(i), ax > 0.5 || az > 0.5 ? p.getY(i) : p.getZ(i));
      }
    }
    this.add(mat, g);
  }
  plane(mat, x1, x2, z1, z2, y, down = false) {
    const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
    this.add(mat, g);
  }
  object(obj) {
    obj.updateMatrixWorld(true);
    obj.traverse(o => { if (o.isMesh) this.add(o.material, o.geometry.clone().applyMatrix4(o.matrixWorld)); });
  }
  meshes({ shadow = true } = {}) {
    const out = [];
    for (const [mat, geos] of this.b) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      const clear = mat.transparent;
      m.castShadow = shadow && !clear; m.receiveShadow = !clear;
      if (clear) m.renderOrder = 2;
      out.push(m);
    }
    return out;
  }
}

const THICK = { ext: 0.22, party: 0.18, int: 0.12 };
const LOBBY_CEIL = 2.5;                      // 梯廳天花降到 2.5m（上方走消防、空調、弱電管線）
// 收起的窗簾：沿牆方向起伏的布面（約 14cm 一個褶），H 為沿 x 的牆、n 為牆法向座標
function drape(H, ua, ub, y1, y2, n) {
  const w = ub - ua, seg = Math.max(8, Math.round(w / 0.025)), g = new THREE.PlaneGeometry(w, y2 - y1, seg, 6), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + w / 2, y = p.getY(i) + (y2 - y1) / 2, off = 0.035 * Math.sin(u / 0.14 * Math.PI * 2) * (0.85 + 0.15 * y / (y2 - y1));
    if (H) p.setXYZ(i, ua + u, y1 + y, n + off); else p.setXYZ(i, n + off, y1 + y, ua + u);
  }
  g.computeVertexNormals();
  return g;
}
const PASSABLE = { door: 1, open: 1, slide: 1 };

export function buildFloor(plan, M) {
  const det = new Batcher(), shell = new Batcher(), fin = new Batcher();   // fin：裝修層（毛胚時隱藏）
  const blocked = new Uint8Array(GW * GH);
  const lights = [];                       // 對外窗／落地門：漫遊時放面光源模擬天光
  const curtains = [];
  const plates = [], hydrantSpots = [];      // 門牌／電梯樓層顯示（文字在 main.js 畫）、消防栓候選牆面

  const block = (x, y) => { if (x >= GX0 && y >= GY0 && x < GX0 + GW && y < GY0 + GH) blocked[(y - GY0) * GW + (x - GX0)] = 1; };

  // ---- 牆、門窗
  for (const s of wallSegments(plan)) {
    const H = s.o === 'h';
    const k = s.op ? s.op.k : 'wall';
    if (!PASSABLE[k]) for (let t = s.t1; t < s.t2; t++) H ? (block(t, s.at - 1), block(t, s.at)) : (block(s.at - 1, t), block(s.at, t));
    const n0 = H ? toZ(s.at) : toX(s.at);
    const u1 = H ? toX(s.t1) : toZ(s.t1), u2 = H ? toX(s.t2) : toZ(s.t2);
    const box = (B, mat, ua, ub, y1, y2, na, nb) => H ? B.box(mat, ua, ub, y1, y2, na, nb) : B.box(mat, na, nb, y1, y2, ua, ub);
    if (k === 'win' || k === 'high' || k === 'slide') {
      const A = plan.spaces[s.a], Bs = plan.spaces[s.b], roomA = A?.kind === 'room', roomB = Bs?.kind === 'room';
      if (roomA !== roomB) {
        const inward = roomA ? -1 : 1, y1 = k === 'slide' ? 0.05 : k === 'high' ? 1.6 : 0.9, y2 = k === 'slide' ? 2.4 : 2.2, um = (u1 + u2) / 2;
        lights.push({ unit: (roomA ? A : Bs).unit, sp: roomA ? s.a : s.b, x: H ? um : n0, z: H ? n0 : um, y: (y1 + y2) / 2, w: u2 - u1, h: y2 - y1,
          nx: H ? 0 : inward, nz: H ? inward : 0, bal: !!(roomA ? Bs : A) });
      }
    }

    // 立面（圖 9-32～9-34）：外牆在樓板高度也是黑灰色面磚，立面不出現白色樓板線；白色水平線只在陽台板緣
    const SL = FLOOR_H - CEIL_H;
    if (s.cls === 'ext') box(shell, M.facade, u1 - 0.11, u2 + 0.11, -SL, 0, n0 - 0.11, n0 + 0.11);
    if (s.cls === 'rail') {             // 陽台欄杆：矮牆＋玻璃＋扶手，高 1.2m（建築技術規則第 38 條：十層以上不得小於 1.2m）
      const na = n0 - 0.06, nb = n0 + 0.06, sp = plan.spaces[s.a] || plan.spaces[s.b];
      box(shell, M.slab, u1 - 0.09, u2 + 0.09, -SL, 0.0, n0 - 0.09, n0 + 0.09);   // 陽台板緣：白灰色系面磚（N9）
      box(shell, M.facade, u1 - 0.06, u2 + 0.06, 0, 0.3, na, nb);
      if (sp?.kind === 'ac') {          // 設備平台：鋁格柵（通風散熱、遮住室外機），到 1.2m
        for (let u = u1 + 0.04; u < u2 - 0.02; u += 0.09) box(shell, M.frame, u - 0.012, u + 0.012, 0.3, 1.15, na + 0.02, nb - 0.02);
      } else box(shell, M.railGlass, u1, u2, 0.3, 1.15, n0 - 0.01, n0 + 0.01);
      box(shell, M.frame, u1 - 0.03, u2 + 0.03, 1.15, 1.2, na + 0.02, nb - 0.02);
      continue;
    }
    const t = THICK[s.cls], ext = s.cls === 'ext';
    const wetA = /浴|廁/.test(plan.spaces[s.a]?.type ?? ''), wetB = /浴|廁/.test(plan.spaces[s.b]?.type ?? '');
    const lobA = plan.spaces[s.a]?.kind === 'lobby', lobB = plan.spaces[s.b]?.kind === 'lobby';
    const lobDir = lobA ? -1 : lobB ? 1 : 0, lobFace = n0 + lobDir * (THICK[s.cls] ?? 0.12) / 2;   // 梯廳那一面
    const core = !plan.spaces[s.a]?.unit && !plan.spaces[s.b]?.unit;
    const wall = (ua, ub, y1, y2) => {
      const na = n0 - t / 2, nb = n0 + t / 2;
      // 浴室牆面貼磚（裝修層，毛胚時隱藏）
      if (wetA) box(fin, M.wallTile, ua, ub, y1, y2, na - 0.008, na);
      if (wetB) box(fin, M.wallTile, ua, ub, y1, y2, nb, nb + 0.008);
      // 梯廳牆面：石材薄板到 2.5m（公設，毛胚也有）＋不鏽鋼踢腳
      if (lobA || lobB) {
        const f = lobA ? na : nb, d = lobA ? -1 : 1, top = Math.min(y2, LOBBY_CEIL);
        if (top > y1) box(det, M.lobbyWall, ua, ub, y1, top, f, f + d * 0.012);
        if (y1 === 0) box(det, M.steel, ua, ub, 0, 0.1, f + d * 0.012, f + d * 0.018);
      }
      if (!ext) return box(det, M.paint, ua, ub, y1, y2, na, nb);
      if (s.out < 0) { box(shell, M.facade, ua, ub, y1, y2, na, na + 0.1); box(det, M.paint, ua, ub, y1, y2, na + 0.1, nb); }
      else { box(det, M.paint, ua, ub, y1, y2, na, nb - 0.1); box(shell, M.facade, ua, ub, y1, y2, nb - 0.1, nb); }
    };
    const glazing = (ua, ub, y1, y2, mullions) => {
      const B = ext ? shell : det, gn = ext ? n0 + s.out * 0.06 : n0, f = 0.045;
      box(B, M.glass, ua, ub, y1, y2, gn - 0.006, gn + 0.006);
      box(B, M.frame, ua, ub, y1, y1 + f, gn - 0.04, gn + 0.04);
      box(B, M.frame, ua, ub, y2 - f, y2, gn - 0.04, gn + 0.04);
      box(B, M.frame, ua, ua + f, y1, y2, gn - 0.04, gn + 0.04);
      box(B, M.frame, ub - f, ub, y1, y2, gn - 0.04, gn + 0.04);
      for (let i = 1; i < mullions; i++) { const m = ua + (ub - ua) * i / mullions; box(B, M.frame, m - f / 2, m + f / 2, y1, y2, gn - 0.04, gn + 0.04); }
    };

    const base = (ua, ub) => { box(fin, M.baseboard, ua, ub, 0, 0.08, n0 - t / 2 - 0.012, n0 + t / 2 + 0.012); };
    const roomSide = sp => sp && sp.kind === 'room' && !/浴|廚房/.test(sp.type);
    const curtain = (ua, ub) => {
      // 窗簾掛在室內側（外牆）；兩片收在窗戶兩側。等家具擺好再畫：窗前有家具擋到就改成收在上緣的捲簾
      const inSp = plan.spaces[s.out < 0 ? s.b : s.a];
      if (!ext || !roomSide(inSp)) return;
      const n = n0 - s.out * (t / 2 + 0.1), cw = Math.min(0.45, (ub - ua) * 0.3), face = n0 - s.out * t / 2, deep = face - s.out * 0.45;
      const panels = [[ua - 0.15, ua - 0.15 + cw], [ub + 0.15 - cw, ub + 0.15]];
      const rect = ([a, b]) => H ? [a, Math.min(face, deep), b, Math.max(face, deep)] : [Math.min(face, deep), a, Math.max(face, deep), b];   // [x1, z1, x2, z2]
      curtains.push({
        rects: panels.map(rect),
        drapes() {
          for (const [a, b] of panels) fin.add(M.curtain, drape(H, a, b, 0.02, CEIL_H - 0.08, n));
          box(fin, M.frame, ua - 0.25, ub + 0.25, CEIL_H - 0.08, CEIL_H - 0.05, n - 0.015, n + 0.015);
        },
        blind() {                                // 捲簾：窗頂一支布捲＋放下一小段
          const bn = n0 - s.out * (t / 2 + 0.05);
          box(fin, M.curtain, ua - 0.03, ub + 0.03, 2.17, 2.24, bn - 0.035, bn + 0.035);
          box(fin, M.curtain, ua, ub, 2.02, 2.17, bn - 0.004, bn + 0.004);
          box(fin, M.frame, ua, ub, 2.005, 2.022, bn - 0.008, bn + 0.008);
        },
      });
    };
    if (k === 'wall') {
      // 牆端多延伸半個牆厚讓轉角接密；但端點接的是門窗開口就不延伸，否則會伸進門洞蓋住門框
      const nextOp = tt => plan.openings.has(`${s.o}${s.at},${tt}`);
      wall(u1 - (nextOp(s.t1 - 1) ? 0 : t / 2), u2 + (nextOp(s.t2) ? 0 : t / 2), 0, CEIL_H); base(u1, u2);
      if (lobDir && core && u2 - u1 > 1.0) hydrantSpots.push({ H, u: (u1 + u2) / 2, len: u2 - u1, n: lobFace, d: lobDir });
    }
    else if (k === 'elev') {
      wall(u1 - t / 2, u2 + t / 2, 0, CEIL_H);
      box(det, M.elevator, u1, u2, 0, 2.1, n0 - t / 2 - 0.02, n0 + t / 2 + 0.02);
      box(det, M.black, (u1 + u2) / 2 - 0.004, (u1 + u2) / 2 + 0.004, 0, 2.1, n0 - t / 2 - 0.03, n0 + t / 2 + 0.03);
      if (lobDir) {                    // 梯廳側：不鏽鋼門框、叫車按鈕、樓層顯示（文字由 main.js 畫）
        const f = lobFace + lobDir * 0.012, o = v => f + lobDir * v;
        box(det, M.steel, u1 - 0.08, u1, 0, 2.2, f, o(0.03)); box(det, M.steel, u2, u2 + 0.08, 0, 2.2, f, o(0.03));
        box(det, M.steel, u1 - 0.08, u2 + 0.08, 2.1, 2.2, f, o(0.03));
        const bu = u2 + 0.3;
        box(det, M.steel, bu - 0.06, bu + 0.06, 0.95, 1.25, f, o(0.015));
        for (const y of [1.05, 1.15]) {
          const c = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16); c.rotateX(Math.PI / 2); if (!H) c.rotateY(Math.PI / 2);
          H ? c.translate(bu, y, o(0.02)) : c.translate(o(0.02), y, bu); det.add(M.button, c);
        }
        box(det, M.black, (u1 + u2) / 2 - 0.16, (u1 + u2) / 2 + 0.16, 2.24, 2.36, f, o(0.02));
        plates.push({ kind: 'elev', H, u: (u1 + u2) / 2, y: 2.3, n: o(0.022), d: lobDir, w: 0.28, h: 0.1 });
      }
    } else if (k === 'door' || k === 'open') {
      if (!s.op.full) wall(u1, u2, k === 'door' ? 2.1 : 2.35, CEIL_H);            // full：整面打開（客變拆牆，不留下垂壁）
      if (k === 'door') {
        // 大門（住戶↔梯廳）毛胚也有；室內門扇、門框屬裝修
        const entry = s.cls === 'party', fire = core, D = entry || fire ? det : fin;
        // 門框嵌在門洞內（貼齊洞口三邊、凸出牆面 1.5cm，外加 2cm 收邊蓋住牆面接縫）；門扇縮在門框內
        const fw = fire ? 0.06 : 0.045, ht = 2.1, op = s.op, w = (u2 - u1) - 2 * fw - 0.006, lh = ht - fw - 0.01, a = THREE.MathUtils.degToRad(78);
        const leafMat = fire ? M.fireDoor : entry ? M.entryDoor : M.door;
        const hingeU = op.hg < 0 ? u1 + fw + 0.003 : u2 - fw - 0.003, d0 = op.hg < 0 ? 1 : -1;
        // 門扇方向＝沿牆方向旋轉 a 度朝開啟側
        const du = Math.cos(a) * d0, dn = Math.sin(a) * op.sw;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, lh, fire || entry ? 0.05 : 0.04), leafMat);
        const cu = hingeU + du * w / 2, cn = n0 + dn * w / 2;
        let dx, dz;
        if (H) { leaf.position.set(cu, lh / 2, cn); dx = du; dz = dn; }
        else { leaf.position.set(cn, lh / 2, cu); dx = dn; dz = du; }
        leaf.rotation.y = Math.atan2(-dz, dx);
        D.object(leaf);
        // 門框
        const fm = fire ? M.fireDoor : entry ? M.entryDoor : M.door, na = n0 - t / 2 - 0.015, nb = n0 + t / 2 + 0.015, lip = 0.02;
        box(D, fm, u1, u1 + fw, 0, ht, na, nb);
        box(D, fm, u2 - fw, u2, 0, ht, na, nb);
        box(D, fm, u1, u2, ht - fw, ht, na, nb);
        for (const [p, q] of [[na, na + 0.015], [nb - 0.015, nb]]) {           // 兩面收邊
          box(D, fm, u1 - lip, u1, 0, ht + lip, p, q); box(D, fm, u2, u2 + lip, 0, ht + lip, p, q); box(D, fm, u1 - lip, u2 + lip, ht, ht + lip, p, q);
        }
        if (lobDir && fire) {          // 防火門：開著用電磁門扣固定（火警時釋放自動關閉）＋門上方避難方向指示燈
          const f = lobFace + lobDir * 0.012, o = v => f + lobDir * v, um = (u1 + u2) / 2;
          box(det, M.exitSign, um - 0.18, um + 0.18, 2.22, 2.36, f, o(0.06));
          box(det, M.black, um - 0.2, um + 0.2, 2.2, 2.22, f, o(0.06));
          plates.push({ kind: 'exit', H, u: um, y: 2.29, n: o(0.062), d: lobDir, w: 0.34, h: 0.12 });
        }
        if (lobDir && entry) {         // 大門：門牌（main.js 畫字）、對講門鈴
          const f = lobFace + lobDir * 0.012, o = v => f + lobDir * v, side = op.hg < 0 ? u2 + 0.28 : u1 - 0.28;
          plates.push({ kind: 'unit', unit: (plan.spaces[s.a]?.unit || plan.spaces[s.b]?.unit), H, u: (u1 + u2) / 2, y: 2.3, n: o(0.008), d: lobDir, w: 0.3, h: 0.12 });
          box(det, M.black, side - 0.06, side + 0.06, 1.3, 1.5, f, o(0.025));
          box(det, M.button, side - 0.015, side + 0.015, 1.34, 1.37, o(0.025), o(0.03));
          box(det, M.screen, side - 0.04, side + 0.04, 1.4, 1.46, o(0.025), o(0.028));
        }
      }
    } else if (k === 'slide') {
      wall(u1, u2, 2.4, CEIL_H);
      const mid = (u1 + u2) / 2;
      glazing(u1, mid + 0.05, 0.02, 2.4, 1);              // 一扇固定、一扇拉開
      const B = det, gn = n0 + 0.05;
      box(B, M.frame, u1, u2, 0, 0.03, n0 - 0.06, n0 + 0.06);
      box(B, M.glass, mid - 0.05, u2 - 0.4, 0.04, 2.38, gn - 0.006, gn + 0.006);
    } else if (k === 'glass') {          // 室內玻璃隔間（客變）：黑框強化玻璃到 2.35m，上方下垂壁；leaf＝旁邊開口的拉門片疊在固定片後
      wall(u1, u2, 2.35, CEIL_H);
      glazing(u1, u2, 0.0, 2.35, Math.max(1, Math.round((u2 - u1) / 0.5)));
      if (s.op.leaf) box(det, M.glass, u1 + 0.03, u2 - 0.03, 0.04, 2.31, n0 + 0.05, n0 + 0.062);
    } else if (k === 'win' || k === 'high') {
      const sill = k === 'high' ? 1.6 : 0.9;
      wall(u1, u2, 0, sill); wall(u1, u2, 2.2, CEIL_H); base(u1, u2);
      if (k === 'win') curtain(u1, u2);
      glazing(u1, u2, sill, 2.2, (u2 - u1) > 1.2 ? 2 : 1);
      if (ext) box(fin, M.counter, u1 - 0.03, u2 + 0.03, sill - 0.02, sill, n0 - t / 2 - 0.05, n0 + t / 2 + 0.05);
    }
  }

  // 外部與不可走空間
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const id = plan.ids[y * GW + x], sp = plan.spaces[id];
    if (!id || sp.kind === 'core' && sp.type === '電梯' || sp.kind === 'ac') blocked[y * GW + x] = 1;
  }
  const blockedBare = blocked.slice();      // 毛胚：沒有家具的碰撞

  // ---- 地板
  const floorMat = sp => {
    if (sp.kind === 'bal' || sp.kind === 'ac') return M.floorBal;
    if (sp.kind === 'lobby' || sp.type === '排煙室') return M.floorStone;
    if (sp.type === '電梯') return M.floorDark;
    if (sp.type === '樓梯') return M.stair;
    if (sp.type === '管道間') return M.floorDark;
    if (/浴|廚房|家事/.test(sp.type)) return M.floorTile;
    return M.floorWood;
  };
  const rects = decompose(plan);
  for (const r of rects) det.plane(floorMat(plan.spaces[r.id]), toX(r.x1), toX(r.x2), toZ(r.y1), toZ(r.y2), 0.003);
  // 樓梯：雙跑梯。入口端是樓層平台，第一跑 0→1.6m 到中間平台，第二跑 1.6→3.2m 往上接上一層（穿過天花）
  // 第二跑底下太矮、樓梯本身都不能走，只留樓層平台可以站
  const STAIRS = { 'core:s1': { axis: 'x', entry: 1 }, 'core:s2': { axis: 'x', entry: -1 } };   // entry：入口在 +端／-端
  for (const r of rects) {
    const cfg = STAIRS[plan.spaces[r.id].key]; if (!cfg) continue;
    const X1 = toX(r.x1) + 0.06, X2 = toX(r.x2) - 0.06, Z1 = toZ(r.y1) + 0.06, Z2 = toZ(r.y2) - 0.06;
    const L = X2 - X1, Wd = Z2 - Z1, half = (Wd - 0.12) / 2, steps = 10, rise = FLOOR_H / 2 / steps;
    const short = L < 4, Lm = short ? 0.8 : 0.9, run = Math.min(9 * 0.27, L - Lm - (short ? 0.55 : 0.8)), Ld = L - run - Lm, tr = run / 9;   // 北側梯間只有 3m，平台縮小
    // 沿跑向的座標 a（從入口端量起）→ 世界 x
    const ax = a => cfg.entry > 0 ? X2 - a : X1 + a;
    const bx = (a1, a2, y1, y2, z1, z2, m = M.stair) => det.box(m, Math.min(ax(a1), ax(a2)), Math.max(ax(a1), ax(a2)), y1, y2, z1, z2);
    const side1 = [Z1, Z1 + half], side2 = [Z2 - half, Z2];                  // 第一跑在 side1、第二跑在 side2
    for (let i = 0; i < 9; i++) bx(Ld + i * tr, Ld + (i + 1) * tr, 0, rise * (i + 1), ...side1);          // 第一跑：入口往裡上
    bx(Ld + run, L, 0, FLOOR_H / 2, Z1, Z2);                                                          // 中間平台
    for (let i = 0; i < 9; i++) {                                                                       // 第二跑：裡往入口上（底下架空）
      const y = FLOOR_H / 2 + rise * (i + 1); bx(Ld + run - (i + 1) * tr, Ld + run - i * tr, y - 0.25, y, ...side2);
    }
    // 梯間中央的矮牆＋扶手（沿兩跑斜上）
    bx(Ld, Ld + run, 0, 0.9, Z1 + half, Z2 - half, M.stair);
    for (const [zz, up] of [[Z1 + half - 0.02, 1], [Z2 - half + 0.02, -1]]) {
      const a1 = Ld, a2 = Ld + run, y1 = up > 0 ? 0.9 : FLOOR_H + 0.9, y2 = FLOOR_H / 2 + 0.9, len = Math.hypot(run, y2 - y1);
      const g = new THREE.CylinderGeometry(0.022, 0.022, len, 10); g.rotateZ(Math.PI / 2);
      g.rotateZ((cfg.entry > 0 ? -1 : 1) * Math.atan2(y2 - y1, run)); g.translate((ax(a1) + ax(a2)) / 2, (y1 + y2) / 2, zz); det.add(M.steel, g);
    }
    // 樓梯本身與中間平台、第二跑底下：不可走
    const px = v => Math.round(v / S + CX), pz = v => Math.round(v / S + CY);
    const bx1 = px(Math.min(ax(Ld), ax(L))), bx2 = px(Math.max(ax(Ld), ax(L)));
    for (let y = pz(Z1); y <= pz(Z2); y++) for (let x = bx1; x <= bx2; x++) { block(x, y); if (x >= GX0 && y >= GY0 && x < GX0 + GW && y < GY0 + GH) blockedBare[(y - GY0) * GW + (x - GX0)] = 1; }
  }

  // ---- 家具（合併）＋碰撞
  // 家具所在房間可用範圍：牆面＝牆中心往內半牆厚
  // 多個矩形組成的房間（L 形、客餐廳＋玄關）：從家具中心往四個方向找最近的牆（換成別的空間或外面的那一格）
  const roomLimits = f => {
    const id = plan.id(f.x, f.y); if (!id) return null;
    // 半牆厚：外牆 11cm、分戶牆（隔壁是別戶或梯廳）9cm、戶內隔間 6cm，再留 5mm 避免貼面閃爍
    const me = plan.spaces[id].unit, half = (x, y) => { const sp = plan.spaces[plan.id(x, y)]; return (!sp ? 0.11 : sp.unit !== me ? 0.09 : 0.06) + 0.005; };
    const scan = (dx, dy) => { let x = Math.round(f.x), y = Math.round(f.y); while (plan.id(x + dx, y + dy) === id) { x += dx; y += dy; } return dx ? x + (dx > 0 ? 1 : 0) : y + (dy > 0 ? 1 : 0); };
    const xl = scan(-1, 0), xr = scan(1, 0), yt = scan(0, -1), yb = scan(0, 1);
    return [toX(xl) + half(xl - 2, f.y), toX(xr) - half(xr + 2, f.y), toZ(yt) + half(f.x, yt - 2), toZ(yb) - half(f.x, yb + 2)];
  };
  const furn = new Batcher(), lampAt = [], furnBoxes = [], furnAll = [], furnNoBlock = [];
  const winBox = L => { const a = L.nx === 0; return new THREE.Box3(new THREE.Vector3(a ? L.x - L.w / 2 : L.x - 0.35, L.y - L.h / 2, a ? L.z - 0.35 : L.z - L.w / 2), new THREE.Vector3(a ? L.x + L.w / 2 : L.x + 0.35, L.y + L.h / 2, a ? L.z + 0.35 : L.z + L.w / 2)); };
  const winBoxes = lights.map(winBox);
  for (const f of plan.furniture) {
    const g = makeFurniture(f, M);
    // 凸進牆裡就推回房內（家具座標多半照牆中心線給，會吃進半個牆厚）；掛畫本來就貼牆、地毯可以壓到牆邊
    const lim = roomLimits(f);
    if (lim && !['rug', 'art', 'pendant'].includes(f.f)) {
      const b = new THREE.Box3().setFromObject(g);
      const dx = Math.max(0, lim[0] - b.min.x) - Math.max(0, b.max.x - lim[1]), dz = Math.max(0, lim[2] - b.min.z) - Math.max(0, b.max.z - lim[3]);
      if ((dx || dz) && Math.abs(dx) < 0.2 && Math.abs(dz) < 0.2) { g.position.x += dx; g.position.z += dz; g.updateMatrixWorld(true); }
    }
    // 碰到窗台（窗下牆＋凸出 5cm 的窗台板）就往房間內推開，避免螢幕、床頭板跟窗台疊在一起閃爍
    for (const L of lights) {
      const sill = L.y - L.h / 2; if (L.bal || sill < 0.5) continue;
      const b = new THREE.Box3().setFromObject(g); if (b.max.y <= sill + 0.001) continue;
      const a = L.nx === 0, lo = (a ? L.x : L.z) - L.w / 2 - 0.03, hi = (a ? L.x : L.z) + L.w / 2 + 0.03;
      if ((a ? b.max.x : b.max.z) <= lo || (a ? b.min.x : b.min.z) >= hi) continue;
      const c = a ? L.z : L.x, n = a ? L.nz : L.nx, edge = c + n * 0.18;           // 牆中心＋半牆厚 11cm＋窗台 6cm＋1cm
      const push = n > 0 ? edge - (a ? b.min.z : b.min.x) : (a ? b.max.z : b.max.x) - edge;
      if (push > 0 && push < 0.4) { g.position[a ? 'z' : 'x'] += n * push; g.updateMatrixWorld(true); }
    }
    if (g.userData.light) { const [x, y, z, w] = g.userData.light; g.userData.lightAt = [...g.localToWorld(new THREE.Vector3(x, y, z)).toArray(), w]; }
    // 床頭掛畫碰到窗就不掛
    const art = []; g.traverse(o => { if (o.userData.art) art.push(o); });
    if (art.some(o => { const b = new THREE.Box3().setFromObject(o); return winBoxes.some(w => w.intersectsBox(b)); })) art.forEach(o => o.removeFromParent());
    furn.object(g);
    furnAll.push(new THREE.Box3().setFromObject(g)); furnNoBlock.push(!!g.userData.noBlock);
    if (!g.userData.noBlock && f.f !== 'plant') { const b = new THREE.Box3().setFromObject(g); if (b.max.y > 0.45) furnBoxes.push(b); }   // 盆栽可以站在窗簾前
    if (g.userData.lightAt) lampAt.push({ unit: f.unit, p: g.userData.lightAt });
    if (g.userData.noBlock || f.f === 'shower') continue;
    const bb = new THREE.Box3().setFromObject(g);
    if (bb.min.y > 1.2) continue;
    const px1 = Math.floor(bb.min.x / S + CX), px2 = Math.ceil(bb.max.x / S + CX);
    const py1 = Math.floor(bb.min.z / S + CY), py2 = Math.ceil(bb.max.z / S + CY);
    for (let y = py1; y < py2; y++) for (let x = px1; x < px2; x++) block(x, y);
  }

  if (globalThis.__dbgFurn) {                // 開發檢查：家具凸出牆面（家具中心所在房間的牆面，外牆半厚 11cm、內牆 6cm）
    plan.furniture.forEach((f, i) => {
      const b = furnAll[i], lim = roomLimits(f); if (!b || !lim || ['rug', 'art', 'pendant'].includes(f.f)) return;
      const pen = [lim[0] - b.min.x, b.max.x - lim[1], lim[2] - b.min.z, b.max.z - lim[3]];
      const bad = pen.map((v, k) => v > 0.01 ? ['W', 'E', 'N', 'S'][k] + ' ' + Math.round(v * 100) + 'cm' : null).filter(Boolean);
      if (bad.length) console.log('WALL', f.unit, plan.spaces[plan.id(f.x, f.y)].type, f.f, f.x, f.y, bad.join(' '));
    });
  }
  if (globalThis.__dbgFurn) {                // 開發檢查：家具互相重疊、衣櫃門前 55cm 被佔用
    const items = plan.furniture.map((f, i) => ({ f, b: furnAll[i], nb: furnNoBlock[i] })).filter(o => o.b && !o.nb && !['rug', 'art', 'pendant'].includes(o.f.f));   // 懸空／掛牆的不算
    for (const A of items) for (const B of items) {
      if (A === B || A.f.unit !== B.f.unit) continue;
      let zone = null;
      if (A.f.f === 'wardrobe' && !(A.f.a || [])[1]) {
        const [dx, dz] = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] }[A.f.face || 'down'], b = A.b;
        zone = new THREE.Box3(new THREE.Vector3(dx > 0 ? b.max.x : dx < 0 ? b.max.x - 0.0 - (b.max.x - b.min.x) - 0.55 : b.min.x, 0, dz > 0 ? b.max.z : dz < 0 ? b.min.z - 0.55 : b.min.z),
                              new THREE.Vector3(dx > 0 ? b.max.x + 0.55 : dx < 0 ? b.min.x : b.max.x, 3, dz > 0 ? b.max.z + 0.55 : dz < 0 ? b.min.z : b.max.z));
      }
      const ov = (p, q) => Math.min(p.max.x, q.max.x) - Math.max(p.min.x, q.min.x) > 0.02 && Math.min(p.max.z, q.max.z) - Math.max(p.min.z, q.min.z) > 0.02;
      const leafy = A.f.f === 'plant' || B.f.f === 'plant';                  // 盆栽葉子伸到別的家具上方是正常的
      if (plan.furniture.indexOf(A.f) < plan.furniture.indexOf(B.f) && !leafy && ov(A.b, B.b)) console.log('OVERLAP', A.f.unit, A.f.f, B.f.f);
      if (zone && ov(zone, B.b)) console.log('DOOR', A.f.unit, 'wardrobe', A.f.x, A.f.y, 'blocked by', B.f.f, B.f.x, B.f.y);
    }
  }

  // ---- 窗簾：窗兩側 45cm 內有家具（書桌、螢幕、衣櫃…）就改捲簾
  for (const c of curtains) {
    const hit = c.rects.some(([x1, z1, x2, z2]) => furnBoxes.some(b => b.max.x > x1 && b.min.x < x2 && b.max.z > z1 && b.min.z < z2));
    hit ? c.blind() : c.drapes();
  }

  // ---- 天花（漫遊時才顯示）、嵌燈
  const ceil = new Batcher();
  for (const r of rects) {
    const lob = plan.spaces[r.id].kind === 'lobby';
    ceil.plane(M.ceiling, toX(r.x1), toX(r.x2), toZ(r.y1), toZ(r.y2), (lob ? LOBBY_CEIL : CEIL_H) - 0.002, true);
    if (!lob) continue;
    // 梯廳天花：沿長邊每 2.4m 一盞嵌燈，中間交錯偵煙器、灑水頭；短邊方向 2 排
    const x1 = toX(r.x1), x2 = toX(r.x2), z1 = toZ(r.y1), z2 = toZ(r.y2), along = x2 - x1 >= z2 - z1;
    const L = along ? x2 - x1 : z2 - z1, n = Math.max(1, Math.round(L / 2.4));
    for (let i = 0; i < n; i++) {
      const a = (along ? x1 : z1) + L * (i + 0.5) / n, b = along ? (z1 + z2) / 2 : (x1 + x2) / 2;
      const at = (a_, b_) => along ? [a_, b_] : [b_, a_];
      const dl = new THREE.CylinderGeometry(0.08, 0.08, 0.01, 20); dl.translate(...(([x, z]) => [x, LOBBY_CEIL - 0.006, z])(at(a, b))); ceil.add(M.downlight, dl);
      const [sx, sz] = at(a + L / n / 2 * (i < n - 1 ? 1 : 0), b + 0.6);
      if (i < n - 1 || n === 1) {
        const sd = new THREE.CylinderGeometry(0.05, 0.06, 0.035, 16); sd.translate(sx, LOBBY_CEIL - 0.02, sz); ceil.add(M.porcelain, sd);   // 偵煙器
        const [px, pz] = at(a + L / n / 2 * (i < n - 1 ? 1 : 0), b - 0.6);
        const sp = new THREE.CylinderGeometry(0.025, 0.012, 0.05, 10); sp.translate(px, LOBBY_CEIL - 0.025, pz); ceil.add(M.steel, sp);       // 灑水頭
        const rs = new THREE.CylinderGeometry(0.035, 0.035, 0.006, 16); rs.translate(px, LOBBY_CEIL - 0.004, pz); ceil.add(M.steel, rs);
      }
      if (i === 0 || i === n - 1) {                                   // 緊急照明燈（兩端）
        const [ex, ez] = at(a, b - 1.1); const e = new THREE.BoxGeometry(0.3, 0.06, 0.1); e.translate(ex, LOBBY_CEIL - 0.03, ez); ceil.add(M.porcelain, e);
      }
    }
  }
  // 消防栓箱：梯廳最長的兩段實牆各一個（嵌牆，正面紅字由材質貼圖）
  for (const h of hydrantSpots.sort((a, b) => b.len - a.len).slice(0, 2)) {
    const g = new THREE.BoxGeometry(0.75, 1.5, 0.04), f = h.n + h.d * 0.012 + h.d * 0.02;
    if (!h.H) g.rotateY(Math.PI / 2);
    h.H ? g.translate(h.u, 0.4 + 0.75, f) : g.translate(f, 0.4 + 0.75, h.u);
    det.add(M.hydrant, g.toNonIndexed());
    plates.push({ kind: 'hydrant', H: h.H, u: h.u, y: 1.15, n: f + h.d * 0.021, d: h.d, w: 0.7, h: 1.45 });
  }
  // 陽台地排：每個陽台／設備平台一個不鏽鋼排水孔，放在靠欄杆的角落
  for (const sp of plan.spaces.slice(1)) {
    if (sp.kind !== 'bal' && sp.kind !== 'ac') continue;
    const r = rects.filter(r => r.id === sp.id)[0]; if (!r) continue;
    const cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2, out = (x, y) => !plan.spaces[plan.id(x, y)];
    const ex = out(r.x1 - 3, cy) ? r.x1 + 6 : out(r.x2 + 3, cy) ? r.x2 - 6 : cx, ey = out(cx, r.y1 - 3) ? r.y1 + 6 : out(cx, r.y2 + 3) ? r.y2 - 6 : cy;
    det.box(M.steel, toX(ex) - 0.06, toX(ex) + 0.06, 0.003, 0.008, toZ(ey) - 0.06, toZ(ey) + 0.06);
    for (let i = -2; i <= 2; i++) det.box(M.black, toX(ex) - 0.045, toX(ex) + 0.045, 0.006, 0.009, toZ(ey) + i * 0.02 - 0.004, toZ(ey) + i * 0.02 + 0.004);
  }
  for (const sp of plan.spaces.slice(1)) {
    if (sp.kind !== 'room') continue;
    const g = new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16);
    g.translate(toX(sp.cx), CEIL_H - 0.006, toZ(sp.cy));
    ceil.add(M.downlight, g);
  }

  // ---- 各戶頂蓋（樣品屋模式遮住非選取戶）
  const caps = {};
  for (const u of Object.keys(plan.units)) {
    const b = new Batcher();
    for (const r of rects) if (plan.spaces[r.id].unit === u) b.plane(M.cap, toX(r.x1), toX(r.x2), toZ(r.y1), toZ(r.y2), CEIL_H + 0.02);
    const g = new THREE.Group(); b.meshes({ shadow: false }).forEach(m => { m.castShadow = false; g.add(m); });
    caps[u] = g;
  }

  // ---- 其他樓層用的室內量體（從窗外看是深色室內）
  const massB = new Batcher();
  for (const r of rects) {
    const sp = plan.spaces[r.id];
    if (sp.kind === 'bal' || sp.kind === 'ac') continue;
    massB.box(M.mass, toX(r.x1), toX(r.x2), 0.01, CEIL_H, toZ(r.y1), toZ(r.y2));
  }

  // ---- 樓板（含外凸雨遮）
  // 只鋪在室內與陽台底下（不再整片外凸），邊緣由外牆的面磚帶或陽台白色板緣包住
  const slabB = new Batcher();
  for (const r of rects) slabB.box(M.slab, toX(r.x1), toX(r.x2), -(FLOOR_H - CEIL_H), 0, toZ(r.y1), toZ(r.y2));
  const slabGeo = slabB.meshes()[0].geometry;

  return {
    detail: det.meshes(), finish: fin.meshes(), blockedBare, furniture: furn.meshes(), ceiling: ceil.meshes({ shadow: false }), caps,
    shell: shell.meshes(), mass: massB.meshes()[0], slabGeo, blocked, lights, lampAt, plates,
  };
}
