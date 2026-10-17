import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityWindowTexture } from './materials.js';

// 周邊街景：真實圖資（scripts/bake_geo.py 產生 geo-data.json）
// 建物輪廓 Overture Maps／OpenStreetMap、道路水域綠地 OpenStreetMap、地形 AWS Terrain Tiles；多數建物高度為估計
// 基地本身與北側 6M 巷、東西兩側 6M 巷依計畫書由這裡自畫
export const ROAD = { z1: 20.1, z2: 50.1 };          // 30M 文德路（示意範圍，實際道路由圖資畫）
export const NROAD = { z1: -27.4, z2: -21.4 };      // 北側 6M 文德街207巷（依圖 9-47：基地北界距 A 棟北牆約 9m）
const LANES = [[-24, 6], [81, 6]];                  // 基地東西兩側 6M 巷 [x, 寬]（西界距 A 棟西牆約 3.6m，圖 9-47）
const FRONT = [-150, 52, 200, 175];                 // 外觀鏡頭與大樓之間（文德路對面），外觀模式隱藏

const PALETTE = [0xe8e1d4, 0xd9d4cc, 0xc9c3b8, 0xbfc5c9, 0xe3d6c2, 0xd2c2ad, 0xaeb4b8, 0xf0ebe2];
const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

export function buildCity(scene) {
  const g = new THREE.Group(); scene.add(g);
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });
  const lift = (m, f) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f * 2 });
  const flat = (x1, z1, x2, z2, mat, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), mat);
    m.rotation.x = -Math.PI / 2; m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); m.receiveShadow = true; g.add(m); return m;
  };
  const asphalt = lift(std(0x3e4247), -4), walk = lift(std(0xc9c4ba), -5), grass = lift(std(0x8fa47a), -6), plaza = lift(std(0xd8d2c6), -5);
  // 基地：鋪面＋草地、北側與東西側 6M 巷、文德路側人行道
  const northGround = [flat(-27, NROAD.z1, 84, NROAD.z2, asphalt, 0.01)];
  for (const [x, w] of LANES) flat(x - w / 2, NROAD.z1, x + w / 2, ROAD.z1 + 3, asphalt, 0.01);
  northGround.push(flat(-27, NROAD.z1 - 3, 84, NROAD.z1, walk, 0.02)); northGround.forEach(m => m.userData.y0 = m.position.y);
  flat(-27, ROAD.z1 - 4.5, 78, ROAD.z1 + 2.5, walk, 0.03);
  const siteGround = [flat(-21, NROAD.z2, 78, ROAD.z1 - 4.5, plaza, 0.02), flat(-20.5, NROAD.z2 + 0.5, 77, -14.5, grass, 0.025), flat(-20.5, -14.5, -18, 14, grass, 0.025), flat(71, -14.5, 77, 14, grass, 0.025)];   // 一樓景觀場景有自己的地坪（含車道下坡），進去時隱藏

  const r = rng(20261016);
  const wallTex = cityWindowTexture(5, false), litTex = cityWindowTexture(5, true);
  const bmat = new THREE.MeshStandardMaterial({ vertexColors: true, map: wallTex, emissiveMap: litTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.75 });

  // 基地周邊樹（圖資載入前就有）
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 2.6, 6), trunkMat = std(0x6b5440), crownMat = std(0xffffff);   // 顏色由 instanceColor 給
  const siteTrees = [[-19.5, 8], [-19.5, -2], [-19.5, -12], [75, 8], [75, -2], [75, -12], [0, -19.5], [25, -19.5], [50, -19.5], [20, 15], [31, 15]];
  for (let x = -20; x < 78; x += 9) siteTrees.push([x, ROAD.z1 - 1.2]);
  const siteTreeMeshes = plantTrees(siteTrees.map(([x, z]) => [x, z, 0, 0.8 + r() * 0.5]), new THREE.IcosahedronGeometry(1.7, 1), true);   // 一樓景觀場景會自己種，進去時隱藏

  function plantTrees(list, crownGeo, shadow) {
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length), crown = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
    trunk.castShadow = crown.castShadow = shadow;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    list.forEach(([x, z, y, s], i) => {
      m4.compose(p.set(x, y + 1.3 * s, z), q, sc.set(s, s, s)); trunk.setMatrixAt(i, m4);
      m4.compose(p.set(x, y + 3.4 * s, z), q, sc.set(s, s * 1.1, s)); crown.setMatrixAt(i, m4);
      crown.setColorAt(i, c.setHSL(0.26 + r() * 0.06, 0.32 + r() * 0.15, 0.3 + r() * 0.1));
    });
    g.add(trunk, crown);
    return [trunk, crown];
  }

  const cars = [], wheels = [];
  const wheelLit = std(0xf4f1ea, { emissive: 0xffd6a0, emissiveIntensity: 0, roughness: 0.5, metalness: 0.4 });
  const towerLit = std(0x6f978f, { emissive: 0xa8e0d0, emissiveIntensity: 0, roughness: 0.35, metalness: 0.45 });
  const city = {
    terrainMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, clipIntersection: true }),   // 一樓景觀的車道下坡在地面以下，進場景時用 clippingPlanes 在地形上挖一個洞
    group: g, bmat, wheelLit, towerLit, front: null, ground: () => 0, siteTrees: siteTreeMeshes, siteGround, northGround,
    update(dt) {
      for (const w of wheels) w.rotation.z += dt * Math.PI * 2 / 1020;     // 一圈約 17 分鐘
      for (const c of cars) {
        const P = c.userData.path; let s = (c.userData.s + c.userData.v * dt) % P.len;
        c.userData.s = s;
        let i = 0; while (i < P.cum.length - 2 && P.cum[i + 1] < s) i++;
        const f = (s - P.cum[i]) / (P.cum[i + 1] - P.cum[i] || 1), [x1, z1] = P.pts[i], [x2, z2] = P.pts[i + 1];
        const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1, o = c.userData.off;
        const x = x1 + dx * f - dz / L * o, z = z1 + dz * f + dx / L * o;
        c.position.set(x, city.ground(x, z), z); c.rotation.y = Math.atan2(-dz, dx);
      }
    },
    setOverview(on) { if (city.front) city.front.visible = !on; },
  };

  fetch(new URL('./geo-data.json', import.meta.url)).then(res => res.json()).then(D => {
    // ---------- 地形
    const T = D.terrain, X = T.xs, Z = T.zs, nx = X.length, nz = Z.length;
    const hAt = (i, j) => T.h[j * nx + i] / 10;
    const find = (a, v) => { let lo = 0, hi = a.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; a[m] <= v ? lo = m : hi = m - 1; } return lo; };
    const ground = city.ground = (x, z) => {
      const i = find(X, x), j = find(Z, z);
      const fx = THREE.MathUtils.clamp((x - X[i]) / (X[i + 1] - X[i]), 0, 1), fz = THREE.MathUtils.clamp((z - Z[j]) / (Z[j + 1] - Z[j]), 0, 1);
      return hAt(i, j) * (1 - fx) * (1 - fz) + hAt(i + 1, j) * fx * (1 - fz) + hAt(i, j + 1) * (1 - fx) * fz + hAt(i + 1, j + 1) * fx * fz;
    };
    {
      const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), idx = [];
      const cCity = new THREE.Color(0xa9ad9c), cGrass = new THREE.Color(0x8fa47a), cWood = new THREE.Color(0x5a7546), cHigh = new THREE.Color(0x4f6a42), c = new THREE.Color();
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, h = hAt(i, j), m = T.mask[k];
        pos.set([X[i], h - 0.05, Z[j]], k * 3);
        const slope = i > 0 && j > 0 && i < nx - 1 && j < nz - 1 ? Math.hypot(hAt(i + 1, j) - hAt(i - 1, j), hAt(i, j + 1) - hAt(i, j - 1)) / (X[i + 1] - X[i - 1]) : 0;
        const wood = Math.max(m === 3 ? 1 : 0, THREE.MathUtils.smoothstep(h, 4, 25), THREE.MathUtils.smoothstep(slope, 0.06, 0.2));
        c.copy(m === 2 ? cGrass : cCity).lerp(cWood, wood).lerp(cHigh, THREE.MathUtils.smoothstep(h, 150, 600));
        const n = (Math.sin(X[i] * 0.013 + Z[j] * 0.021) + Math.sin(X[i] * 0.031 - Z[j] * 0.017)) * 0.025 * wood;
        col.set([c.r + n, c.g + n, c.b + n], k * 3);
        if (i < nx - 1 && j < nz - 1) idx.push(k, k + nx, k + 1, k + 1, k + nx, k + nx + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, city.terrainMat); m.receiveShadow = true; g.add(m);
    }
    const pts = a => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i] / 10, a[i + 1] / 10]); return o; };

    // ---------- 平地多邊形（水面、綠地）
    const polyMesh = (list, mat, dy) => {
      const geos = [];
      for (const p of list) {
        const y = p[0] / 10 + dy, v = pts(p.slice(1)).map(([x, z]) => new THREE.Vector2(x, z));
        if (v.length < 3) continue;
        const tri = THREE.ShapeUtils.triangulateShape(v, []), pos = [];
        for (const t of tri) {
          const [a, b, c] = t.map(i => v[i]);
          const up = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;   // x-z 平面上的繞向 → 法線朝上
          for (const q of up ? [a, b, c] : [a, c, b]) pos.push(q.x, y, q.y);
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); geos.push(geo);
      }
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = true; g.add(m);
    };
    polyMesh(D.green, lift(std(0x8fa47a), -2), 0.02);
    polyMesh(D.water, lift(new THREE.MeshStandardMaterial({ color: 0x4f6f73, roughness: 0.08, metalness: 0.15, envMapIntensity: 1.4 }), -3), 0.06);

    // ---------- 道路（沿地形的帶狀面）
    {
      const byCls = [[], [], []];
      for (const rd of D.roads) {
        const w = rd[0] / 10, P = pts(rd.slice(2)), dense = [];
        for (let i = 0; i < P.length - 1; i++) {
          const [x1, z1] = P[i], [x2, z2] = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 12));
          for (let k = 0; k < n; k++) dense.push([x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n]);
        }
        dense.push(P[P.length - 1]);
        const pos = [], idx = [];
        dense.forEach(([x, z], i) => {
          const [ax, az] = dense[Math.max(0, i - 1)], [bx, bz] = dense[Math.min(dense.length - 1, i + 1)];
          const L = Math.hypot(bx - ax, bz - az) || 1, ox = -(bz - az) / L * w / 2, oz = (bx - ax) / L * w / 2, y = ground(x, z) + 0.04;
          pos.push(x + ox, y, z + oz, x - ox, y, z - oz);
          if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i, 2 * i - 1, 2 * i + 1);
        });
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
        byCls[rd[1]].push(geo.toNonIndexed());
      }
      [[0x3e4247, -4], [0x52565b, -3], [0xb8b2a6, -2]].forEach(([c, f], k) => {
        if (!byCls[k].length) return;
        const geo = mergeGeometries(byCls[k]); geo.computeVertexNormals();
        // 帶狀面繞向不一，法線一律朝上
        const nrm = geo.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
        const m = new THREE.Mesh(geo, lift(std(c, { side: THREE.DoubleSide }), f)); m.receiveShadow = true; g.add(m);
      });
    }

    // ---------- 捷運高架（文湖線）
    {
      const deck = [], piers = [], DECK_Y = 11;
      for (const a of D.rails) {
        const P = pts(a);
        for (let i = 0; i < P.length - 1; i++) {
          const [x1, z1] = P[i], [x2, z2] = P[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
          if (L < 0.5) continue;
          const y = (ground(x1, z1) + ground(x2, z2)) / 2 + DECK_Y;
          const b = new THREE.BoxGeometry(L + 0.6, 1.8, 8.5); b.rotateY(Math.atan2(-(z2 - z1), x2 - x1)); b.translate((x1 + x2) / 2, y, (z1 + z2) / 2); deck.push(b);
          for (let s = 15; s < L; s += 30) {
            const x = x1 + (x2 - x1) * s / L, z = z1 + (z2 - z1) * s / L, gy = ground(x, z);
            const c = new THREE.CylinderGeometry(1.1, 1.1, DECK_Y - 0.9, 10); c.translate(x, gy + (DECK_Y - 0.9) / 2, z); piers.push(c);
          }
        }
      }
      if (deck.length) {
        const m = new THREE.Mesh(mergeGeometries([...deck, ...piers]), std(0xc9c6bf, { roughness: 0.8 }));
        m.castShadow = m.receiveShadow = true; g.add(m);
      }
    }

    // ---------- 高架道路（高速公路、環東大道、橋）：橋面高度依 OSM layer 估，接地端斜坡
    {
      const deck = [], piers = [], top = [];
      for (const a of D.bridges || []) {
        const w = a[0] / 10, P = [];
        for (let i = 1; i < a.length; i += 3) { const x = a[i] / 10, z = a[i + 1] / 10; P.push([x, z, ground(x, z) + a[i + 2] / 10]); }
        const pos = [], idx = [];
        P.forEach(([x, z, y], i) => {
          const [ax, az] = P[Math.max(0, i - 1)], [bx, bz] = P[Math.min(P.length - 1, i + 1)];
          const L = Math.hypot(bx - ax, bz - az) || 1, ox = -(bz - az) / L * w / 2, oz = (bx - ax) / L * w / 2;
          pos.push(x + ox, y + 0.06, z + oz, x - ox, y + 0.06, z - oz);
          if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i, 2 * i - 1, 2 * i + 1);
        });
        const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setIndex(idx); top.push(tg.toNonIndexed());
        for (let i = 0; i < P.length - 1; i++) {
          const [x1, z1, y1] = P[i], [x2, z2, y2] = P[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
          if (L < 0.5) continue;
          const b = new THREE.BoxGeometry(Math.hypot(L, y2 - y1) + 0.6, 1.6, w + 0.6);
          b.rotateZ(Math.atan2(y2 - y1, L)); b.rotateY(Math.atan2(-(z2 - z1), x2 - x1)); b.translate((x1 + x2) / 2, (y1 + y2) / 2 - 0.8, (z1 + z2) / 2); deck.push(b);
          for (let s = 18; s < L; s += 36) {
            const x = x1 + (x2 - x1) * s / L, z = z1 + (z2 - z1) * s / L, gy = ground(x, z), h = y1 + (y2 - y1) * s / L - 1.6 - gy;
            if (h < 3) continue;
            const c = new THREE.BoxGeometry(2.2, h, Math.min(w * 0.5, 6)); c.rotateY(Math.atan2(-(z2 - z1), x2 - x1)); c.translate(x, gy + h / 2, z); piers.push(c);
          }
        }
      }
      if (deck.length) {
        const m = new THREE.Mesh(mergeGeometries([...deck, ...piers]), std(0xbdb9b1, { roughness: 0.85 }));
        m.castShadow = m.receiveShadow = true; g.add(m);
        const tgeo = mergeGeometries(top), nrm = (tgeo.computeVertexNormals(), tgeo.attributes.normal);
        for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
        g.add(Object.assign(new THREE.Mesh(tgeo, std(0x3e4247, { side: THREE.DoubleSide })), { receiveShadow: true }));
      }
    }

    // ---------- 建物（輪廓擠出，牆面貼窗戶貼圖，UV 以公尺計）
    {
      const near = [], far = [], front = [], roofs = [], frontRoofs = [];
      for (const b of D.buildings) {
        const h = b[0] / 10, y0 = b[2] / 10, P = pts(b.slice(3));
        let sa = 0; for (let i = 0; i < P.length; i++) { const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % P.length]; sa += x1 * z2 - x2 * z1; }
        if (sa > 0) P.reverse();
        const y1 = y0 + 0.6 + h, pos = [], uv = [], nrm = [];
        const off = r(); let u = 0;
        for (let i = 0; i < P.length; i++) {
          const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % P.length], L = Math.hypot(x2 - x1, z2 - z1);
          if (L < 0.05) continue;
          const nx_ = -(z2 - z1) / L, nz_ = (x2 - x1) / L, u1 = off + u / 28, u2 = off + (u + L) / 28, v1 = 0, v2 = (y1 - y0) / 25.6;
          pos.push(x1, y0, z1, x2, y0, z2, x2, y1, z2, x1, y0, z1, x2, y1, z2, x1, y1, z1);
          uv.push(u1, v1, u2, v1, u2, v2, u1, v1, u2, v2, u1, v2);
          for (let k = 0; k < 6; k++) nrm.push(nx_, 0, nz_);
          u += L;
        }
        const v2 = P.map(([x, z]) => new THREE.Vector2(x, z));
        for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
          const [a, b2, c] = t.map(i => v2[i]);
          const up = (b2.x - a.x) * (c.y - a.y) - (b2.y - a.y) * (c.x - a.x) < 0;
          for (const q of up ? [a, b2, c] : [a, c, b2]) { pos.push(q.x, y1, q.y); uv.push(0.005, 0.005); nrm.push(0, 1, 0); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const tint = new THREE.Color(PALETTE[(r() * PALETTE.length) | 0]), cols = new Float32Array(pos.length);
        for (let i = 0; i < cols.length; i += 3) cols.set([tint.r, tint.g, tint.b], i);
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length;
        const isFront = cx > FRONT[0] && cx < FRONT[2] && cz > FRONT[1] && cz < FRONT[3];
        (isFront ? front : Math.hypot(cx - 25, cz) < 260 ? near : far).push(geo);
        if (h > 8 && Math.abs(sa) > 120 && r() < 0.7) {     // 屋頂水塔／樓梯間
          const s = 2 + r() * 2.5, rb = new THREE.BoxGeometry(s, 2.6, s * (0.8 + r() * 0.6)); rb.rotateY(r() * Math.PI); rb.translate(cx, y1 + 1.3, cz); (isFront ? frontRoofs : roofs).push(rb);
        }
      }
      const add = (list, shadow) => {
        if (!list.length) return null;
        const m = new THREE.Mesh(mergeGeometries(list), bmat); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
      };
      const roofMat = std(0x8f9294), addRoofs = list => { if (!list.length) return null; const m = new THREE.Mesh(mergeGeometries(list), roofMat); m.castShadow = true; g.add(m); return m; };
      add(near, true); add(far, false); addRoofs(roofs);
      const fm = [add(front, true), addRoofs(frontRoofs)].filter(Boolean);
      city.front = { set visible(v) { fm.forEach(m => m.visible = v); } };
    }

    // ---------- 地標：美麗華摩天輪（輪頂離地 100m、直徑 70m，架在商場屋頂）
    // ---------- 地標：台北 101（底座斜收 → 八節倒梯形 → 頂部 → 尖塔，屋頂 449m、塔尖 508m）
    for (const L of D.landmarks || []) {
      if (L.type !== 'tower101') continue;
      const seg = [], sq = (w0, w1, y0, y1) => {              // 方形截錐：底半寬 w0、頂半寬 w1
        const c = new THREE.CylinderGeometry(w1 * Math.SQRT2, w0 * Math.SQRT2, y1 - y0, 4); c.rotateY(Math.PI / 4); c.translate(0, (y0 + y1) / 2, 0); seg.push(c);
      };
      sq(35, 27, 0, 110);
      for (let i = 0; i < 8; i++) { const y = 110 + i * 37.5; sq(22, 30, y, y + 36); sq(24, 24, y + 36, y + 37.5); }
      sq(20, 20, 410, 425); sq(14, 14, 425, 440); sq(9, 9, 440, 449);
      const spire = new THREE.CylinderGeometry(0.8, 3, 59, 8); spire.translate(0, 449 + 29.5, 0); seg.push(spire);
      const podium = new THREE.BoxGeometry(150, 30, 100); podium.translate(25, 15, 0);
      const root = new THREE.Group(); root.position.set(L.x, L.y0, L.z); root.rotation.y = L.yaw;
      root.add(new THREE.Mesh(mergeGeometries(seg), towerLit), new THREE.Mesh(podium, std(0xb9bdb8, { roughness: 0.7 })));
      g.add(root);
    }

    // ---------- 地標：大巨蛋（球冠屋頂，地上 64m、半徑約 100m）
    for (const L of D.landmarks || []) {
      if (L.type !== 'dome') continue;
      const Rs = (L.r * L.r + L.top * L.top) / (2 * L.top), cap = new THREE.SphereGeometry(Rs, 72, 18, 0, Math.PI * 2, 0, Math.asin(L.r / Rs));
      cap.translate(0, L.top - Rs, 0);
      const m = new THREE.Mesh(cap, std(0xe4e6e8, { roughness: 0.45, metalness: 0.3 }));
      m.position.set(L.x, L.y0, L.z); m.castShadow = true; g.add(m);
    }

    // ---------- 地標：小巨蛋（真實輪廓擠出，屋頂高暫定 40m）
    for (const L of D.landmarks || []) {
      if (L.type !== 'arena') continue;
      const shape = new THREE.Shape(pts(L.pts).map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: L.top, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, std(0xd9dde0, { roughness: 0.4, metalness: 0.35 }));
      m.position.y = L.y0; m.castShadow = true; g.add(m);
    }

    for (const L of D.landmarks || []) {
      if (L.type !== 'wheel') continue;
      const R = L.d / 2, hub = L.top - R, root = new THREE.Group(), rot = new THREE.Group(), parts = [], lit = [];
      root.position.set(L.x, L.y0, L.z); root.rotation.y = L.yaw; rot.position.y = hub;
      for (const zz of [-2.2, 2.2]) {
        const rim = new THREE.TorusGeometry(R, 0.6, 6, 96); rim.translate(0, 0, zz); lit.push(rim);
        for (let i = 0; i < 24; i++) {
          const sp = new THREE.CylinderGeometry(0.15, 0.15, R, 4); sp.translate(0, R / 2, 0); sp.rotateZ(i / 24 * Math.PI * 2); sp.translate(0, 0, zz); parts.push(sp);
        }
      }
      const axle = new THREE.CylinderGeometry(1.6, 1.6, 6, 12); axle.rotateX(Math.PI / 2); parts.push(axle);
      const cabs = [];
      for (let i = 0; i < 48; i++) {
        const a = i / 48 * Math.PI * 2, c = new THREE.BoxGeometry(2.2, 2.6, 2.6); c.translate(Math.cos(a) * (R + 1.2), Math.sin(a) * (R + 1.2) - 1.3, 0); cabs.push(c);
      }
      const steel = std(0xdedcd6, { roughness: 0.5, metalness: 0.5 });
      rot.add(new THREE.Mesh(mergeGeometries(parts), steel), new THREE.Mesh(mergeGeometries(lit), wheelLit), new THREE.Mesh(mergeGeometries(cabs), std(0xd8443a, { roughness: 0.6 })));
      const legs = [];                                     // A 字形支架：從屋頂（輪底）到輪軸
      for (const zz of [-5, 5]) for (const xx of [-14, 14]) {
        const len = Math.hypot(xx, hub - (L.top - L.d)), leg = new THREE.CylinderGeometry(0.7, 0.9, len, 8);
        leg.translate(0, len / 2, 0); leg.rotateZ(-Math.atan2(-xx, hub - (L.top - L.d))); leg.translate(xx, L.top - L.d, zz); legs.push(leg);
      }
      root.add(rot, new THREE.Mesh(mergeGeometries(legs), steel));
      root.traverse(m => { if (m.isMesh) m.castShadow = true; });
      g.add(root); wheels.push(rot);
    }

    // ---------- 公園／林地樹木
    {
      const list = [];
      for (let i = 0; i < D.trees.length; i += 2) { const x = D.trees[i] / 10, z = D.trees[i + 1] / 10; list.push([x, z, ground(x, z), 1.5 + r() * 1.2]); }
      if (list.length) plantTrees(list, new THREE.IcosahedronGeometry(1.7, 0), false);
    }

    // ---------- 車流（文德路兩向車道）
    const carMats = [0xe9e9e9, 0x2d2f33, 0x9aa4ad, 0x7b1e22, 0x274a7a, 0xd8d2c4].map(c => std(c, { roughness: 0.35, metalness: 0.5 }));
    const body = new THREE.BoxGeometry(4.4, 0.75, 1.8); body.translate(0, 0.6, 0);
    const cabin = new THREE.BoxGeometry(2.4, 0.6, 1.6); cabin.translate(-0.2, 1.25, 0);
    const carGeo = mergeGeometries([body, cabin]);
    for (const a of D.cars) {
      const P = pts(a), cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const path = { pts: P, cum, len: cum[cum.length - 1] };
      for (let i = 0; i < Math.round(path.len / 30); i++) {
        const c = new THREE.Mesh(carGeo, carMats[cars.length % carMats.length]); c.castShadow = true;
        c.userData = { path, s: r() * path.len, v: 9 + r() * 6, off: [-3.6, 0, 3.6][i % 3] };
        g.add(c); cars.push(c);
      }
    }
    city.update(0);
    city.views = D.views || [];
    city.onViews?.();
    city.onload?.();
  }).catch(e => console.warn('周邊圖資載入失敗', e));

  return city;
}
