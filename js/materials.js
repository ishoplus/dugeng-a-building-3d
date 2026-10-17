import * as THREE from 'three';

// ---- 程式產生的材質貼圖（不依賴外部圖檔）
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
function tone(hex, dl) {
  const c = new THREE.Color(hex), hsl = {};
  c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + dl, 0, 1));
  return '#' + c.getHexString();
}
function finish(c, size) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / size, 1 / size);   // 地板 UV 以公尺為單位
  return t;
}
export function woodTexture(base, seed = 7) {
  const [c, g] = cv(1024, 1024), r = rng(seed), rows = 8, ph = 1024 / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 700;
    while (x < 1024) {
      const len = 420 + r() * 480;
      g.fillStyle = tone(base, (r() - 0.5) * 0.09);
      g.fillRect(x, i * ph, len, ph);
      g.globalAlpha = 0.1;
      for (let k = 0; k < 16; k++) {
        g.strokeStyle = tone(base, -0.18); g.lineWidth = 0.8 + r() * 1.6;
        const y = i * ph + r() * ph;
        g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 10, x + len * 0.7, y + (r() - 0.5) * 10, x + len, y + (r() - 0.5) * 6);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect(x, i * ph, 2, ph);
      x += len;
    }
    g.fillStyle = 'rgba(40,25,10,.3)'; g.fillRect(0, i * ph, 1024, 2);
  }
  return finish(c, 1.6);
}
export function tileTexture(base, grout = '#bdb8b0', n = 2, veins = true, seed = 3, size = 1.2) {
  const [c, g] = cv(1024, 1024), r = rng(seed), ts = 1024 / n;
  g.fillStyle = grout; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * ts + 3, y = j * ts + 3, w = ts - 6;
    g.fillStyle = tone(base, (r() - 0.5) * 0.04); g.fillRect(x, y, w, w);
    if (veins) {
      g.save(); g.beginPath(); g.rect(x, y, w, w); g.clip();
      for (let k = 0; k < 5; k++) {
        g.strokeStyle = `rgba(120,115,110,${0.08 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 2.2;
        g.beginPath(); let px = x + r() * w, py = y; g.moveTo(px, py);
        for (let s = 0; s < 6; s++) { px += (r() - 0.5) * w * 0.4; py += w / 6; g.lineTo(px, py); }
        g.stroke();
      }
      g.restore();
    }
  }
  return finish(c, size);
}
export function cityWindowTexture(seed, lit) {
  // 8x8 個開間（每格 3.5m x 3.2m），lit=true 時只畫亮燈窗做夜間發光
  const [c, g] = cv(512, 512), r = rng(seed);
  g.fillStyle = lit ? '#000' : '#cfd3d6'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const on = r() < 0.38;
    if (lit && !on) continue;
    g.fillStyle = lit ? (r() < 0.5 ? '#ffd9a0' : '#fff1d6') : (r() < 0.5 ? '#5d6f7d' : '#6f8291');
    g.fillRect(i * 64 + 9, j * 64 + 14, 46, 34);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function concreteTexture(base = '#a9a7a2', seed = 21, size = 2.0, speck = 0.18) {
  // 混凝土／水泥粉光：底色＋大塊斑駁＋細砂點
  const [c, g] = cv(512, 512), r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    const x = r() * 512, y = r() * 512, rad = 30 + r() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.5 ? '0,0,0' : '255,255,255';
    gr.addColorStop(0, `rgba(${col},${0.012 + r() * 0.025})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '40,40,40' : '240,240,240'},${r() * speck})`; g.fillRect(r() * 512, r() * 512, 1.2, 1.2); }
  return finish(c, size);
}

// ---- 家具表面細節（灰階，乘上材質顏色；同一張當 bumpMap）
function grayTex(c, rep) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(rep, rep);
  return t;
}
export function fabricTexture(seed = 5) {
  // 粗織布：經緯線＋不規則粗細
  const [c, g] = cv(256, 256), r = rng(seed);
  g.fillStyle = '#ebebeb'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 2) {
    g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.07})`; g.fillRect(0, i, 256, 1);
    g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; g.fillRect(i, 0, 1, 256);
  }
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1); }
  return grayTex(c, 3);
}
export function grainTexture(seed = 8) {
  // 家具木紋：細長年輪線
  const [c, g] = cv(512, 512), r = rng(seed);
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 90; k++) {
    g.strokeStyle = `rgba(60,40,20,${0.05 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 2;
    const y = r() * 512; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 90 + k) * 6 + (r() - 0.5) * 2);
    g.stroke();
  }
  return grayTex(c, 1);
}
export function paintingTexture(seed, palette) {
  // 抽象畫：底色＋幾塊半透明色面＋筆觸
  const [c, g] = cv(512, 512), r = rng(seed), P = palette;
  g.fillStyle = P[0]; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 7; i++) {
    g.globalAlpha = 0.35 + r() * 0.5; g.fillStyle = P[1 + (i % (P.length - 1))];
    g.beginPath(); const x = r() * 512, y = r() * 512, rx = 60 + r() * 200, ry = 40 + r() * 160;
    g.ellipse(x, y, rx, ry, r() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 0.5;
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = P[Math.floor(r() * P.length)]; g.lineWidth = 2 + r() * 10; g.beginPath();
    const x = r() * 512, y = r() * 512; g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 300, y + (r() - 0.5) * 300, x + (r() - 0.5) * 400, y + (r() - 0.5) * 200); g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function pileTexture(seed = 13) {
  // 地毯絨毛：細密雜點＋淡淡的大塊明暗
  const [c, g] = cv(256, 256), r = rng(seed);
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.12})`; g.fillRect(r() * 256, r() * 256, 1, 1 + r() * 2); }
  return grayTex(c, 2);
}

// ---- 裝修風格
export const THEMES = {
  modern: { name: '現代簡約', floor: '#bba892', wall: 0xf2f0ec, fabric: 0x7b828a, fabric2: 0xe4e0d8, cabinet: 0xe6e2dc, wood: 0x9d7c5b, accent: 0x2b2b2b, rug: 0xa9a39b, tile: '#d8d5cf' },
  nordic: { name: '北歐木質', floor: '#d3ad80', wall: 0xfaf8f2, fabric: 0xcbc2b2, fabric2: 0xf3eee4, cabinet: 0xf4f1e9, wood: 0xc99b68, accent: 0x5f7a69, rug: 0xd9cfbf, tile: '#e9e5dc' },
  luxe: { name: '輕奢大理石', floor: '#6e5241', wall: 0xebe5dd, fabric: 0x2e3a48, fabric2: 0xdcd4c8, cabinet: 0x2f2a26, wood: 0x5a3f2e, accent: 0xb89558, rug: 0x8e8478, tile: '#f0ede7' },
};

export function makeMaterials() {
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
  return {
    paint: std(0xf2f0ec, { roughness: 0.95 }),
    facade: std(0x3e4043, { roughness: 0.75 }),          // 黑灰色系面磚（N3）
    facadeDark: std(0x8a8580, { roughness: 0.85 }),
    slab: std(0xe8e6e1, { roughness: 0.85 }),            // 白灰色系面磚／石材（N9）
    louver: std(0xa9744a, { roughness: 0.6 }),           // 木紋色格柵
    stone: std(0xb9b6b0, { roughness: 0.7 }),
    shopGlass: std(0x2c3439, { roughness: 0.08, metalness: 0.4, emissive: 0xffd9a8, emissiveIntensity: 0 }),
    ceiling: std(0xfbfbf9, { roughness: 1, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb0b8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false }),
    railGlass: new THREE.MeshPhysicalMaterial({ color: 0xcfe2ea, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false }),
    frame: std(0x3d4246, { roughness: 0.45, metalness: 0.6 }),
    steel: std(0xb9bec2, { roughness: 0.3, metalness: 0.85 }),
    sink: std(0x7f868a, { roughness: 0.38, metalness: 0.85, envMapIntensity: 0.35 }),          // 水槽內面（髮絲紋不鏽鋼，比把手暗）
    floorWood: std(0xffffff, { roughness: 0.55 }),
    floorTile: std(0xffffff, { roughness: 0.35 }),
    floorBal: std(0xffffff, { roughness: 0.8 }),
    floorStone: std(0xffffff, { roughness: 0.4 }),
    floorDark: std(0x3b3f44, { roughness: 0.6 }),
    door: std(0xd9d3c8, { roughness: 0.6 }),
    baseboard: std(0xe9e5de, { roughness: 0.5 }),
    wallTile: Object.assign(std(0xffffff, { roughness: 0.22 }), { userData: { worldUV: true } }),
    lobbyWall: Object.assign(std(0xffffff, { roughness: 0.3 }), { userData: { worldUV: true } }),   // 梯廳石材薄板
    fireDoor: std(0x9aa0a4, { roughness: 0.45, metalness: 0.6 }),        // 鋼製防火門
    entryDoor: std(0x8a6a4e, { roughness: 0.55, metalness: 0.1 }),        // 住戶大門（防火防盜門，木紋鋼板；門框同色）
    exitSign: std(0x1f9d55, { emissive: 0x33dd77, emissiveIntensity: 1.2, roughness: 0.4 }),
    hydrant: std(0xb8322a, { roughness: 0.4, metalness: 0.3 }),
    button: std(0xdfe6ea, { emissive: 0x9fd2ff, emissiveIntensity: 0.6, roughness: 0.3 }),
    curtain: std(0xefe9df, { roughness: 1 }),
    art1: std(0xc98f5a, { roughness: 0.9 }), art2: std(0x5f7f8c, { roughness: 0.9 }), art3: std(0xe2d3b5, { roughness: 0.9 }),
    fabric: std(0x7b828a, { roughness: 1 }),
    fabric2: std(0xe4e0d8, { roughness: 1 }),
    linen: std(0xf7f5f0, { roughness: 1 }),
    cabinet: std(0xe6e2dc, { roughness: 0.55 }),
    wood: std(0x9d7c5b, { roughness: 0.6 }),
    accent: std(0x2b2b2b, { roughness: 0.5 }),
    rug: std(0xa9a39b, { roughness: 1 }),
    counter: std(0xe9e7e3, { roughness: 0.25 }),
    porcelain: std(0xfbfbfb, { roughness: 0.15 }),
    mirror: std(0xd4dade, { roughness: 0.04, metalness: 0.9 }),          // 沒有即時反射，main.js 另外給它環境貼圖
    screen: std(0x0d0f12, { roughness: 0.2, metalness: 0.3 }),
    black: std(0x1e1f21, { roughness: 0.5 }),
    leaf: std(0x4f7a3a, { roughness: 0.9 }),
    pot: std(0xcfc6b8, { roughness: 0.8 }),
    lamp: std(0xfff4e0, { emissive: 0xffd9a0, emissiveIntensity: 0.4, roughness: 0.9 }),
    downlight: std(0xffffff, { emissive: 0xfff2dc, emissiveIntensity: 0.6 }),
    water: std(0xd8eef2, { roughness: 0.05, metalness: 0.1 }),
    mass: std(0x50565c, { roughness: 0.9, emissive: 0xffc98a, emissiveIntensity: 0 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 1, transparent: true, opacity: 0.92 }),
    elevator: std(0x9aa1a7, { roughness: 0.25, metalness: 0.9 }),
    stair: std(0xc9c6c0, { roughness: 0.9 }),
  };
}

// 家具表面紋理與軟質標記（furniture.js 依 userData.soft 決定圓角大小）
export function dressMaterials(M) {
  const fab = fabricTexture(), grain = grainTexture(), pile = pileTexture();
  for (const k of ['fabric', 'fabric2', 'linen', 'curtain']) Object.assign(M[k], { map: fab, bumpMap: fab, bumpScale: 1.2 });
  Object.assign(M.rug, { map: pile, bumpMap: pile, bumpScale: 2 });
  Object.assign(M.wood, { map: grain, bumpMap: grain, bumpScale: 0.4, roughness: 0.5 });
  for (const k of ['fabric', 'fabric2', 'linen', 'rug', 'curtain']) M[k].userData.soft = true;
  M.counter.userData.sharp = true;
  Object.assign(M.entryDoor, { map: grainTexture(19), bumpMap: null }); M.entryDoor.needsUpdate = true;
  M.lobbyWall.map = tileTexture('#d9d2c6', '#c4bcae', 1, true, 23, 1.2); M.lobbyWall.needsUpdate = true;   // 120cm 見方的米色石材                // 檯面拼接處不倒角，才不會看到縫
  const pals = [['#e9dfcc', '#c98f5a', '#7c5a3c', '#2f3b45', '#d8b98a'], ['#5f7f8c', '#2e4651', '#c9b48f', '#e8e2d6', '#8aa3a8'], ['#efe8da', '#b9a382', '#5a6b5c', '#d6c3a1', '#3b3a36']];
  ['art1', 'art2', 'art3'].forEach((k, i) => { M[k].color.set(0xffffff); M[k].map = paintingTexture(31 + i * 17, pals[i]); M[k].needsUpdate = true; });
  M.curtain.side = THREE.DoubleSide;
  M.leaf.side = THREE.DoubleSide; M.leaf.roughness = 0.6;
  for (const k of ['fabric', 'fabric2', 'linen', 'rug', 'wood', 'curtain', 'leaf']) M[k].needsUpdate = true;
}

const texCache = {};
let bareTex = null;
// 交屋狀態：bare 毛胚（清水混凝土／粉光地坪），sample 樣品屋（依裝潢風格）
export function applyFinish(M, finishKey, themeKey) {
  if (finishKey === 'bare') {
    bareTex ??= { wall: concreteTexture('#b3b0aa', 21, 1.0), floor: concreteTexture('#9e9b95', 33, 2.4, 0.25), ceil: concreteTexture('#bdbab4', 45, 1.0) };
    M.paint.color.set(0xffffff); M.paint.map = bareTex.wall;
    M.floorWood.map = M.floorTile.map = bareTex.floor; M.floorWood.roughness = M.floorTile.roughness = 0.92;
    M.ceiling.map = bareTex.ceil; M.ceiling.color.set(0xffffff);
    M.downlight.visible = false;
  } else {
    M.paint.map = null; M.ceiling.map = null; M.ceiling.color.set(0xfbfbf9); M.downlight.visible = true;
    M.floorTile.roughness = 0.35;
    applyTheme(M, themeKey);
  }
  for (const k of ['paint', 'floorWood', 'floorTile', 'ceiling', 'downlight']) M[k].needsUpdate = true;
}
export function applyTheme(M, key) {
  const T = THEMES[key];
  M.paint.color.set(T.wall);
  for (const k of ['fabric', 'fabric2', 'cabinet', 'wood', 'accent', 'rug']) M[k].color.set(T[k]);
  texCache[key] ??= {
    wood: key === 'luxe' ? tileTexture('#ece8e1', '#d6d0c6', 2, true, 11, 1.6) : woodTexture(T.floor),
    tile: tileTexture(T.tile, '#b8b2a8', 3, key === 'luxe', 5, 0.9),
  };
  M.floorWood.map = texCache[key].wood;
  M.floorWood.roughness = key === 'luxe' ? 0.18 : 0.55;
  M.floorTile.map = texCache[key].tile;
  texCache[key].wallTile ??= tileTexture(key === 'luxe' ? '#efece6' : key === 'nordic' ? '#f1efe9' : '#e9e8e4', '#cfcac2', 2, key === 'luxe', 17, 0.6);
  M.wallTile.map = texCache[key].wallTile; M.wallTile.needsUpdate = true;
  M.door.color.set(key === 'luxe' ? 0x3a322c : key === 'nordic' ? 0xe8dcc8 : 0xd9d3c8);
  M.baseboard.color.set(key === 'luxe' ? 0x3a322c : key === 'nordic' ? 0xd8c4a5 : 0xe3ded6);
  M.curtain.color.set(key === 'luxe' ? 0x8a8076 : key === 'nordic' ? 0xefe7d8 : 0xd9d6d0);
  M.floorWood.needsUpdate = M.floorTile.needsUpdate = M.door.needsUpdate = true;
  if (!M.floorBal.map) {
    M.floorBal.map = tileTexture('#b9b4ab', '#9f998f', 4, false, 9, 1.2);
    M.floorStone.map = tileTexture('#d9d4cb', '#c4beb3', 2, true, 13, 1.6);
  }
}
