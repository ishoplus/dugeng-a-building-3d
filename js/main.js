import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { S, GX0, GY0, GW, GH, FLOOR_H, CEIL_H, FOOTPRINT, CORE_BOX, toX, toZ, toPX, toPY, buildPlan, wallSegments, decompose, UNIT_ORDER } from './plan.js';
import { makeMaterials, applyTheme, applyFinish, dressMaterials, THEMES } from './materials.js';
import { buildFloor } from './build.js';
import { buildReno, ruleOf, zoneOf, ZONES } from './reno.js';
import { SCHEMES, parseSchemes, loadCustom } from './schemes.js';
import { initReqs } from './reqs.js';
import { buildVenues, venueSegments } from './venue.js';
import { buildCity } from './city.js';
import { Walker, FACE_YAW } from './walk.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const BASE = 0.3;                                    // 室外地面到一樓樓板
const MAXF = 24;
// 計畫書：地上 21 層，1F 高 4.6m（店鋪），2F 以上每層 3.2m；標準層 3～21F 每層 8 戶
const FLOORS = 21, F1_H = 4.6, MIN_F = 3;
// 指北針：北方＝平面圖上方往東（右）偏約 9°（圖 9-27）
const PLAN_NORTH = 9;
// A、B 兩棟互為鏡像，柱線中心距 34.15/2+16.85+34.15/2 ≈ 51m，B 在東側
const TOWERS = { A: { x: 0, s: 1 }, B: { x: 51.0, s: -1 } };
// 計畫書面積計算（圖 9-29，B棟同A棟）：主建物、陽台 ㎡
const OFFICIAL = { A1: [80.43, 9.73], A2: [54.27, 5.07], A3: [54.12, 5.07], A5: [79.58, 9.73], A6: [80.32, 9.73], A7: [54.12, 5.07], A8: [54.27, 5.07], A9: [80.43, 9.73] };

const uParam = (params.get('unit') || 'A1').toUpperCase();
const state = {
  mode: 'overview', tower: uParam[0] === 'B' ? 'B' : 'A', unit: 'A' + uParam.slice(1),
  floors: FLOORS, floor: THREE.MathUtils.clamp(+(params.get('floor') || 10), MIN_F, FLOORS),
  time: +(params.get('t') || 10), season: params.get('season') || 'equinox',
  north: params.has('north') ? +params.get('north') : PLAN_NORTH, theme: params.get('theme') || 'nordic',
  finish: params.get('finish') === 'bare' ? 'bare' : 'sample',   // bare 毛胚屋／sample 樣品屋
  venue: ['roof', 'b1', 'b2'].includes(params.get('venue')) ? params.get('venue') : 'lobby',           // 公設參觀：lobby 1F 門廳大廳／roof A 棟屋頂花園
  reno: params.get('reno') === '1',                                 // 客變範圍圖層
  scheme: null,                                                     // 客變方案 { corner, mid }（下面載完自訂方案再解析）
};
if (!['A1', 'A2', 'A3', 'A5', 'A6', 'A7', 'A8', 'A9'].includes(state.unit)) state.unit = 'A1';
for (const id of (params.get('scheme') || '').split(',')) if (/^r[0-9a-f]{8}$/.test(id)) await loadCustom(id.slice(1));
state.scheme = parseSchemes(params.get('scheme'));
const T = () => TOWERS[state.tower];
const dn = u => state.tower + u.slice(1);              // 顯示用戶名（B棟 B1…）
const floorY = f => BASE + (f >= 2 ? F1_H + (f - 2) * FLOOR_H : 0);
const wx = px => T().x + T().s * toX(px);             // 平面 px → 世界 x（含鏡像）

// ---------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcdd8e2, 400, 16000);   // 遠到看得見後山與陽明山
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 40000);
const controls = new OrbitControls(camera, renderer.domElement);

// 高畫質：環境光遮蔽（手機預設關閉，可用 ?hq=1 強制開）
const HQ = params.get('hq') ? params.get('hq') === '1' : !matchMedia('(pointer:coarse)').matches;
let composer = null, gtao = null;
if (HQ) {
  const pr = renderer.getPixelRatio();
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.blendIntensity = 1;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
}
const setAO = walk => gtao && gtao.updateGtaoMaterial(walk
  ? { radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.3, samples: 16 }
  : { radius: 2.5, distanceExponent: 1.2, thickness: 3, scale: 1.0, samples: 12 });
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 4; controls.maxDistance = 320;

const sky = new Sky(); sky.scale.setScalar(36000); sky.frustumCulled = false; scene.add(sky);
Object.assign(sky.material.uniforms, {});
sky.material.uniforms.turbidity.value = 5;
sky.material.uniforms.rayleigh.value = 1.4;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.82;

const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x9a907f, 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 260 });
scene.add(sun, sun.target);

// ---------- 資料與幾何
const M = makeMaterials();
dressMaterials(M);
M.mirror.envMap = scene.environment; M.mirror.envMapIntensity = 0.85; M.mirror.needsUpdate = true;   // 鏡子自帶環境貼圖，不受場景壓低的環境光影響
applyTheme(M, state.theme);
const plan = buildPlan(state.scheme);
const F = buildFloor(plan, M);
applyFinish(M, state.finish, state.theme);
const city = buildCity(scene);
city.onload = () => city.setOverview(state.mode === 'overview');

const floorGroup = new THREE.Group();
F.detail.forEach(m => floorGroup.add(m));
const furnGroup = new THREE.Group(); F.furniture.forEach(m => furnGroup.add(m)); floorGroup.add(furnGroup);
const finGroup = new THREE.Group(); F.finish.forEach(m => finGroup.add(m)); floorGroup.add(finGroup);
const ceilGroup = new THREE.Group(); F.ceiling.forEach(m => ceilGroup.add(m)); floorGroup.add(ceilGroup);
const capGroup = new THREE.Group(); Object.values(F.caps).forEach(g => capGroup.add(g)); floorGroup.add(capGroup);
const reno = buildReno(plan), renoGroup = new THREE.Group();
renoGroup.add(reno.all); Object.values(reno.units).forEach(g => renoGroup.add(g)); floorGroup.add(renoGroup);
// 標籤另外一個 scene 疊在後製之後畫，避免被 AO 當成實體
const labelScene = new THREE.Scene();
const labelGroup = new THREE.Group(); labelScene.add(labelGroup);

// 兩棟各自一組外殼（instanced），B 棟用負縮放鏡像
const [FX1, FY1, FX2, FY2] = FOOTPRINT, FW = (FX2 - FX1) * S, FD = (FY2 - FY1) * S, FCX = toX((FX1 + FX2) / 2), FCZ = toZ((FY1 + FY2) / 2);
function makeTower(key) {
  const g = new THREE.Group(); g.position.x = TOWERS[key].x; g.scale.x = TOWERS[key].s; scene.add(g);
  const inst = (geo, mat, count, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, count); m.castShadow = shadow && !mat.transparent; m.receiveShadow = !mat.transparent;
    if (mat.transparent) m.renderOrder = 2;
    g.add(m); return m;
  };
  const t = { g };
  Object.assign(t, { shell: F.shell.map(m => inst(m.geometry, m.material, MAXF)), mass: inst(F.mass.geometry, M.mass, MAXF, false), slab: inst(F.slabGeo, M.slab, MAXF + 1) });
  const colGeo = new THREE.BoxGeometry(1, 1, 1); colGeo.translate(0, 0.5, 0);
  t.cols = inst(colGeo, M.slab, plan.colsAll.length);
  const box = (parent, mat, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  // 屋頂：女兒牆、屋突三層、木紋格柵冠頂
  // 東西兩短向立面靠角落的木紋色格柵（圖 9-32 東／西向立面、模擬圖 9-50），3F 到屋頂
  { const y1 = floorY(3), y2 = floorY(FLOORS + 1) + 1.2, fin = new THREE.BoxGeometry(0.12, y2 - y1, 0.05), pos = [];
    for (const xm of [-0.14, 33.74]) for (const [a, b] of [[1.0, 1.95], [20.65, 21.6]]) for (let z = a; z <= b + 1e-6; z += 0.19) pos.push([xm - 16.8, z - 11.3]);
    const im = new THREE.InstancedMesh(fin, M.louver, pos.length); im.castShadow = true;
    fin.translate(0, (y2 - y1) / 2, 0); fin.scale(1, 1 / (y2 - y1), 1);              // 高度在 updateBuilding 設（樣品屋模式切到選取樓層）
    t.fins = { im, pos, y1 }; g.add(im); }
  t.roof = new THREE.Group(); g.add(t.roof);
  box(t.roof, M.slab, FW, 1.2, 0.3, FCX, 0, FCZ - FD / 2); box(t.roof, M.slab, FW, 1.2, 0.3, FCX, 0, FCZ + FD / 2);
  box(t.roof, M.slab, 0.3, 1.2, FD, FCX - FW / 2, 0, FCZ); box(t.roof, M.slab, 0.3, 1.2, FD, FCX + FW / 2, 0, FCZ);
  { const [c1, c2, c3, c4] = CORE_BOX; box(t.roof, M.facade, toX(c3) - toX(c1), 8.7, toZ(c4) - toZ(c2), toX((c1 + c3) / 2), 0, toZ((c2 + c4) / 2)); }
  // 屋頂冠：圖 9-32～9-34 木紋色金屬隔柵約兩層高（R1F 3.2m＋R2F 2.9m），上緣白色框梁
  const CROWN = 6.1, slats = [], sg = new THREE.BoxGeometry(0.1, CROWN - 1.7, 0.3);
  for (let x = FCX - FW / 2 + 0.4; x < FCX + FW / 2; x += 0.75) for (const z of [FCZ - FD / 2, FCZ + FD / 2]) slats.push([x, z]);
  for (let z = FCZ - FD / 2 + 0.4; z < FCZ + FD / 2; z += 0.75) for (const x of [FCX - FW / 2, FCX + FW / 2]) slats.push([x, z]);
  const sl = new THREE.InstancedMesh(sg, M.louver, slats.length); sl.castShadow = true;
  slats.forEach(([x, z], i) => { m4.makeTranslation(x, 1.2 + (CROWN - 1.7) / 2, z); sl.setMatrixAt(i, m4); });
  t.roof.add(sl);
  for (const [w, d, x, z] of [[FW + 0.4, 0.5, FCX, FCZ - FD / 2], [FW + 0.4, 0.5, FCX, FCZ + FD / 2], [0.5, FD, FCX - FW / 2, FCZ], [0.5, FD, FCX + FW / 2, FCZ]]) box(t.roof, M.slab, w, 0.5, d, x, CROWN - 0.5, z);
  // 一樓：沿街店鋪玻璃＋石材柱
  const podH = F1_H - (FLOOR_H - CEIL_H);
  t.podium = [box(g, M.shopGlass, FW - 2.4, podH, FD - 2.4, FCX, BASE, FCZ)];
  for (let x = FCX - FW / 2 + 0.6; x <= FCX + FW / 2; x += (FW - 1.2) / 8) for (const z of [FCZ - FD / 2 + 0.9, FCZ + FD / 2 - 0.9]) t.podium.push(box(g, M.stone, 0.9, podH, 0.9, x, BASE, z));
  for (let z = FCZ - FD / 2 + 0.9; z <= FCZ + FD / 2; z += (FD - 1.8) / 4) for (const x of [FCX - FW / 2 + 0.9, FCX + FW / 2 - 0.9]) t.podium.push(box(g, M.stone, 0.9, podH, 0.9, x, BASE, z));
  box(g, M.stone, FW + 1, BASE, FD + 1, FCX, 0, FCZ);
  return t;
}
const m4 = new THREE.Matrix4();
const towers = { A: makeTower('A'), B: makeTower('B') };
let lobbyBox = null;
renderer.localClippingEnabled = true;
// 車道（A 棟平面 x 34.6～69、y -7.2～-1.05）在世界座標的範圍；四個平面取交集＝挖掉這個柱狀範圍內的地形
const RAMP_HOLE = [[-1, 0, 0, 34.6 - 16.8], [1, 0, 0, -(69 - 16.8)], [0, 0, -1, -7.2 - 11.3], [0, 0, 1, -(-1.05 - 11.3)]].map(([x, y, z, c]) => new THREE.Plane(new THREE.Vector3(x, y, z), c));   // 每個平面在範圍內為負（被裁掉的一側）
// 兩棟中間的大廳（1F）與 3F 露台
{
  lobbyBox = new THREE.Mesh(new THREE.BoxGeometry(12, F1_H - 0.4, 14), M.shopGlass); lobbyBox.position.set(25.5, BASE + (F1_H - 0.4) / 2, 1); scene.add(lobbyBox);
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.5, 9), M.slab); roofL.position.set(25.5, floorY(3) - 0.25, -2); roofL.castShadow = roofL.receiveShadow = true; scene.add(roofL);
}
// 選取樓層框
const hlBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(FW + 0.8, FLOOR_H, FD + 0.8)), new THREE.LineBasicMaterial({ color: 0xffb547 }));
scene.add(hlBox);

// 室內燈（固定 12 盞，換戶只搬位置，避免重新編譯 shader）
const lamps = Array.from({ length: 12 }, () => { const l = new THREE.PointLight(0xffe2b8, 0, 7, 2); floorGroup.add(l); return l; });
// 窗戶天光（面光源，固定 3 盞只搬位置）：優先放在所在房間的窗，其次該戶最大的窗；漫遊白天的主要室內光；手機不開（太吃效能）
if (HQ) RectAreaLightUniformsLib.init();
const winLights = HQ ? Array.from({ length: 3 }, () => { const l = new THREE.RectAreaLight(0xe6eef7, 0, 1, 1); scene.add(l); return l; }) : [];

// ---------- 文字標籤
function sprite(text, sub, { scale = 1, badge = false } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = '600 56px "PingFang TC","Noto Sans TC",sans-serif', fsub = '400 38px "PingFang TC","Noto Sans TC",sans-serif';
  g.font = font; let w = g.measureText(text).width; g.font = fsub; if (sub) w = Math.max(w, g.measureText(sub).width);
  c.width = badge ? 150 : w + 56; c.height = badge ? 150 : (sub ? 138 : 92);
  if (badge) { g.fillStyle = '#1f5f5b'; g.beginPath(); g.arc(75, 75, 70, 0, 7); g.fill(); g.fillStyle = '#fff'; }
  else { g.fillStyle = 'rgba(255,255,255,.92)'; roundRect(g, 0, 0, c.width, c.height, 26); g.fill(); g.fillStyle = '#23302f'; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font;
  g.fillText(text, c.width / 2, badge ? 78 : (sub ? 46 : 48));
  if (sub) { g.font = fsub; g.fillStyle = '#5d6b6a'; g.fillText(sub, c.width / 2, 102); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, fog: false }));
  const h = (badge ? 1.5 : 0.55 * (c.height / 92)) * scale;
  sp.scale.set(h * c.width / c.height, h, 1); sp.renderOrder = 20;
  return sp;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const pin = a => `約 ${a.toFixed(1)}㎡・${(a / 3.3058).toFixed(1)} 坪`;
const esc = v => String(v ?? '').replace(/[&<>"'`]/g, c => `&#${c.charCodeAt(0)};`);   // 方案文字可能間接來自住戶輸入，插進 HTML 一律跳脫
const roomName = sp => esc(sp.type);
const unitBadges = {}, roomLabels = {};
const badgeSprites = { A: {}, B: {} };
for (const [name, u] of Object.entries(plan.units)) {
  const pub = plan.spaces[u.spaces[0]];
  for (const tw of ['A', 'B']) {
    const b = sprite(tw + name.slice(1), null, { badge: true }); b.position.set(toX(pub.cx), CEIL_H + 1.4, toZ(pub.cy)); labelGroup.add(b); badgeSprites[tw][name] = b;
  }
  for (const fk of ['sample', 'bare']) {
    roomLabels[fk + name] = u.spaces.map(id => {
      const sp = plan.spaces[id]; if (sp.kind === 'ac') return null;
      // 毛胚標淨尺寸，方便住戶自己量家具
      const sub = fk === 'bare' && sp.dims ? `${sp.dims[0].toFixed(2)} × ${sp.dims[1].toFixed(2)} m` : pin(sp.area);
      const l = sprite(fk === 'bare' && sp.type === '客餐廳' ? '客餐廳（開放）' : sp.type, sub, { scale: 0.9 }); l.position.set(toX(sp.cx), 1.5, toZ(sp.cy)); labelGroup.add(l); return l;
    }).filter(Boolean);
  }
}

// ---------- 漫遊
const walker = new Walker(plan, state.finish === 'bare' ? F.blockedBare : F.blocked);
walker.mirror = T().s;
walker.onRoom = sp => {
  if (state.mode !== 'walk') return;
  const t = $('#toast');
  t.innerHTML = `<b>${sp.unit ? dn(sp.unit) + '・' : ''}${roomName(sp)}</b><span>${sp.kind === 'lobby' ? '公共梯廳' : pin(sp.area) + (state.finish === 'bare' && sp.dims ? `・淨寬 ${sp.dims[0].toFixed(2)} × ${sp.dims[1].toFixed(2)} m` : '')}${state.reno && sp.unit ? '<br>' + ruleOf(sp, plan.units[sp.unit]) : ''}</span>`;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  if (sp.unit && sp.unit !== state.unit) selectUnit(sp.unit, { keepCamera: true });
  else placeWinLights();
  drawMini();
};

// ---------- 公設參觀（js/venue.js）：各自一個漫遊者，輸入與鏡頭共用實境漫遊那一套
const venues = buildVenues(M, { roofY: floorY(FLOORS + 1), b1Y: BASE - 4.5, b2Y: BASE - 7.5 });
const firstV = Object.values(venues)[0];
firstV.water.envMap = scene.environment; firstV.water.envMapIntensity = 1.2;
for (const V of Object.values(venues)) scene.add(V.group);
function ensureVenue(V) {                            // 第一次進去才建幾何與漫遊者
  if (V.walker) return V;
  V.build();
  V.walker = new Walker(V.plan, V.blocked);
  V.walker.onRoom = sp => { if (state.mode === 'venue' && sp.type) toast(sp.type, sp.note || ''); };
  return V;
}
let eyeH = 0;                                        // 公設地坪起伏時的額外視線高度
const walkish = () => state.mode === 'walk' || state.mode === 'venue';
const curV = () => state.mode === 'venue' ? venues[state.venue] : null;
const W = () => curV()?.walker || walker;
function enterVenue(key = state.venue) {
  state.venue = key;
  const V = ensureVenue(venues[key]);
  V.group.add(hoverRing, destMark); hoverRing.visible = destMark.visible = false;
  V.walker.place(...V.spawn); V.walker.room = 0; V.walker.checkRoom(); eyeH = V.hAt ? V.hAt(V.walker.x, V.walker.y) : 0;
  camera.fov = zoomFov = 70; camera.updateProjectionMatrix();
  if (innerWidth <= 760) document.body.classList.add('side-closed');
  updateBuilding(); renderVenue(); drawMap();
}
function renderVenue() {
  const V = venues[state.venue];
  document.querySelectorAll('#venueTabs button').forEach(b => b.classList.toggle('on', b.dataset.venue === state.venue));
  $('#venueDesc').textContent = V.desc;
  $('#sheetTitle').innerHTML = `公設<small>${esc(V.name)}</small>`;
  $('#venueStops').innerHTML = V.stops.map((st, i) => `<button data-i="${i}">${esc(st.name)}</button>`).join('');
  $('#venueStops').querySelectorAll('button').forEach(b => b.onclick = () => {
    const st = V.stops[+b.dataset.i];
    walkTo(...st.p, { yaw: st.yaw, pitch: st.pitch ?? -0.04 }, 70, st.note ? [st.name, st.note] : null);
  });
}

// ---------- 建物顯示狀態
function updateBuilding() {
  const sel = state.floor, N = state.floors, doll = state.mode === 'doll';
  const y0 = floorY(sel), tw = T();
  if (floorGroup.parent !== towers[state.tower].g) towers[state.tower].g.add(floorGroup);
  floorGroup.position.y = y0;
  labelGroup.position.set(tw.x, y0, 0); labelGroup.scale.x = tw.s;
  walker.mirror = tw.s;
  for (const [key, t] of Object.entries(towers)) {
    const isSel = key === state.tower, top = doll && isSel ? sel : N;
    let n = 0;
    for (let f = 2; f <= top; f++) { m4.makeTranslation(0, floorY(f), 0); t.shell.forEach(m => m.setMatrixAt(n, m4)); n++; }
    t.shell.forEach(m => { m.count = n; m.instanceMatrix.needsUpdate = true; });
    n = 0;
    for (let f = 2; f <= top; f++) if (!(isSel && f === sel)) { m4.makeTranslation(0, floorY(f), 0); t.mass.setMatrixAt(n++, m4); }
    t.mass.count = n; t.mass.instanceMatrix.needsUpdate = true;
    n = 0;
    for (let f = 2; f <= (doll && isSel ? sel : N + 1); f++) { m4.makeTranslation(0, floorY(f), 0); t.slab.setMatrixAt(n++, m4); }
    t.slab.count = n; t.slab.instanceMatrix.needsUpdate = true;
    const h = (doll && isSel ? y0 + CEIL_H : floorY(N + 1) + 6.1) - floorY(2) + 0.4;   // 白色邊框柱一路到屋頂冠框梁
    plan.colsAll.forEach(([x1, y1, x2, y2], i) => {
      m4.compose(new THREE.Vector3(toX((x1 + x2) / 2), floorY(2) - 0.4, toZ((y1 + y2) / 2)), new THREE.Quaternion(), new THREE.Vector3((x2 - x1) * S, h, (y2 - y1) * S));
      t.cols.setMatrixAt(i, m4);
    });
    t.cols.instanceMatrix.needsUpdate = true;
    { const f = t.fins, top = doll && isSel ? y0 + CEIL_H : floorY(N + 1) + 1.2;
      f.pos.forEach(([x, z], i) => { m4.compose(new THREE.Vector3(x, f.y1, z), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.01, top - f.y1), 1)); f.im.setMatrixAt(i, m4); });
      f.im.instanceMatrix.needsUpdate = true; }
    t.roof.visible = !(doll && isSel); t.roof.position.y = floorY(N + 1);
  }
  hlBox.visible = state.mode === 'overview';
  hlBox.position.set(tw.x + tw.s * FCX, y0 + FLOOR_H / 2 - 0.4, FCZ);
  ceilGroup.visible = state.mode === 'walk';
  capGroup.visible = doll;
  for (const [u, g] of Object.entries(F.caps)) g.visible = u !== state.unit;
  labelGroup.visible = doll;
  for (const tk of ['A', 'B']) for (const [u, b] of Object.entries(badgeSprites[tk])) b.visible = tk === state.tower && u !== state.unit;
  for (const [k, ls] of Object.entries(roomLabels)) ls.forEach(l => l.visible = k === state.finish + state.unit);
  furnGroup.visible = finGroup.visible = state.finish === 'sample';
  renoGroup.visible = state.reno && state.mode !== 'overview';
  for (const [u, g] of Object.entries(reno.units)) g.visible = u === state.unit;
  reno.beams.visible = doll;
  const rooms = plan.units[state.unit].spaces.map(i => plan.spaces[i]).filter(s => s.kind === 'room');
  // 夜間燈光：先放在這戶的檯燈／吊燈／立燈位置，剩下的放房間中央（嵌燈）
  const spots = F.lampAt.filter(l => l.unit === state.unit).map(l => l.p).concat(rooms.map(s => [toX(s.cx), CEIL_H - 0.3, toZ(s.cy), 1]));
  lamps.forEach((l, i) => {
    const s = spots[i]; l.visible = !!s;
    if (s) { l.position.set(s[0], s[1], s[2]); l.userData.w = s[3]; }
  });
  placeWinLights(); placeSpots(); updatePlates();
  spotGroup.visible = state.mode === 'walk';
  hoverRing.visible = hoverRing.visible && state.mode === 'walk'; destMark.visible = destMark.visible && state.mode === 'walk';
  sun.target.position.set(tw.x, y0, 0);
  const V = curV();
  floorGroup.visible = !V;
  for (const v of Object.values(venues)) v.group.visible = v === V;
  const inLobby = V?.key === 'lobby';
  for (const t of Object.values(towers)) t.podium.forEach(m => m.visible = !inLobby);   // 一樓景觀場景有自己的店鋪量體
  lobbyBox.visible = !inLobby; city.siteTrees.forEach(m => m.visible = !inLobby); city.siteGround.forEach(m => m.visible = !inLobby);
  city.northGround.forEach(m => m.position.y = m.userData.y0 + (inLobby ? 2.4 : 0));   // 一樓景觀場景：北側 207 巷跟著基地抬高
  city.terrainMat.clippingPlanes = inLobby ? RAMP_HOLE : []; city.terrainMat.needsUpdate = true;
  if (V) sun.target.position.set(V.world.x, V.world.y, 0);
  updateSun();
}
// 梯廳文字：門牌、電梯樓層顯示、消防栓箱面板（B 棟鏡像時把字翻回來）
const plateMeshes = F.plates.map(pl => {
  const c = document.createElement('canvas'); c.width = pl.kind === 'hydrant' ? 256 : 256; c.height = pl.kind === 'hydrant' ? 512 : 96;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const lit = pl.kind === 'elev' || pl.kind === 'exit';
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pl.w, pl.h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: lit ? 0xffffff : 0x000000, emissiveMap: lit ? tex : null, emissiveIntensity: lit ? 1.2 : 0 }));
  m.position.set(pl.H ? pl.u : pl.n, pl.y, pl.H ? pl.n : pl.u);
  m.rotation.y = pl.H ? (pl.d > 0 ? 0 : Math.PI) : pl.d * Math.PI / 2;
  m.userData = { pl, c, tex, key: '' };
  floorGroup.add(m); return m;
});
function updatePlates() {
  const mir = T().s < 0;
  for (const m of plateMeshes) {
    const { pl, c, tex } = m.userData, g = c.getContext('2d');
    m.scale.x = mir ? -1 : 1;
    const key = pl.kind + state.floor + state.tower; if (m.userData.key === key) continue; m.userData.key = key;
    const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    if (pl.kind === 'unit') {
      g.fillStyle = '#2b2f31'; g.fillRect(0, 0, W, H); g.fillStyle = '#c9b48a'; g.fillRect(6, 6, W - 12, H - 12); g.fillStyle = '#2b2f31'; g.fillRect(10, 10, W - 20, H - 20);
      g.fillStyle = '#e8dcc0'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 46px "PingFang TC","Noto Sans TC",sans-serif'; g.fillText(`${state.floor}F ${dn(pl.unit)}`, W / 2, H / 2 + 2);
    } else if (pl.kind === 'elev') {
      g.fillStyle = '#050505'; g.fillRect(0, 0, W, H); g.fillStyle = '#ff5a36'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 64px "Menlo",monospace'; g.fillText(String(state.floor), W / 2 + 18, H / 2 + 4);
      g.beginPath(); g.moveTo(40, 30); g.lineTo(58, 62); g.lineTo(22, 62); g.fill();
    } else if (pl.kind === 'exit') {            // 避難方向指示燈：綠底白色奔跑人形＋門
      g.fillStyle = '#17924c'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
      g.fillRect(150, 14, 46, 68); g.fillStyle = '#17924c'; g.fillRect(158, 22, 30, 60);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(104, 22, 9, 0, 7); g.fill();
      g.lineWidth = 9; g.lineCap = 'round'; g.strokeStyle = '#fff'; g.beginPath();
      g.moveTo(100, 34); g.lineTo(92, 58); g.lineTo(112, 72); g.moveTo(92, 58); g.lineTo(74, 80);
      g.moveTo(98, 40); g.lineTo(120, 50); g.moveTo(98, 40); g.lineTo(78, 46); g.stroke();
      g.beginPath(); g.moveTo(30, 48); g.lineTo(60, 48); g.moveTo(30, 48); g.lineTo(42, 36); g.moveTo(30, 48); g.lineTo(42, 60); g.stroke();
    } else {
      g.fillStyle = '#b8322a'; g.fillRect(0, 0, W, H); g.strokeStyle = '#7a1d18'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 46px "PingFang TC","Noto Sans TC",sans-serif';
      ['消', '防', '栓'].forEach((t, i) => g.fillText(t, W / 2, 90 + i * 58));
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(40, 300, W - 80, 6); g.font = '400 24px sans-serif'; g.fillText('火警發信機', W / 2, 360);
      g.beginPath(); g.arc(W / 2, 420, 26, 0, 7); g.fill(); g.fillStyle = '#b8322a'; g.beginPath(); g.arc(W / 2, 420, 14, 0, 7); g.fill();
    }
    tex.needsUpdate = true;
  }
}
function placeWinLights() {
  floorGroup.updateMatrixWorld(true);
  const here = state.mode === 'walk' ? plan.id(walker.x, walker.y) : -1;
  const wins = F.lights.filter(w => w.unit === state.unit).sort((a, b) => (b.sp === here) - (a.sp === here) || b.w * b.h - a.w * a.h);
  winLights.forEach((l, i) => {
    const w = wins[i]; l.visible = !!w && state.mode === 'walk'; l.userData.bal = w?.bal;
    if (!w) return;
    l.width = w.w; l.height = w.h;
    l.position.copy(floorGroup.localToWorld(new THREE.Vector3(w.x + w.nx * 0.12, w.y, w.z + w.nz * 0.12)));
    l.lookAt(floorGroup.localToWorld(new THREE.Vector3(w.x + w.nx * 2, w.y - 0.3, w.z + w.nz * 2)));
  });
  if (winLights.length) updateSun();
}

// ---------- 日照
const SEASON_DEC = { summer: 23.44, equinox: 0, winter: -23.44 };
const northVec = () => { const a = THREE.MathUtils.degToRad(state.north); return [Math.sin(a), -Math.cos(a)]; };
const LAT = THREE.MathUtils.degToRad(25.03);
const cFog = new THREE.Color(), cDay = new THREE.Color(0xcfdbe6), cDusk = new THREE.Color(0xe2bf9c), cNight = new THREE.Color(0x141b26);
function sunVector() {
  const dec = THREE.MathUtils.degToRad(SEASON_DEC[state.season]), H = THREE.MathUtils.degToRad(15 * (state.time - 12));
  const sinEl = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)); // 由南往西
  const [nx, nz] = northVec(), ex = -nz, ez = nx;
  const hx = -nx * Math.cos(az) - ex * Math.sin(az), hz = -nz * Math.cos(az) - ez * Math.sin(az);
  return { v: new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)), el };
}
function updateSun() {
  const { v, el } = sunVector();
  const day = THREE.MathUtils.smoothstep(Math.sin(el), -0.06, 0.22);
  const sunUp = THREE.MathUtils.smoothstep(Math.sin(el), 0.0, 0.12);
  const night = 1 - day;
  sky.material.uniforms.sunPosition.value.copy(v);
  sun.position.copy(sun.target.position).addScaledVector(v, 120);
  sun.intensity = 3.8 * sunUp;
  sun.color.setHSL(0.09, 0.6 * (1 - Math.min(1, Math.sin(el) * 3)), 0.6 + 0.4 * Math.min(1, Math.sin(el) * 2.5));
  const inLobby = state.mode === 'venue' && (state.venue === 'lobby' || venues[state.venue]?.indoor);
  const walk = state.mode === 'walk' || inLobby;
  const lit = state.mode === 'walk' && HQ;                  // 有窗戶天光時，壓低均勻補光讓室內有明暗
  hemi.intensity = 0.06 + (lit ? 0.12 : walk ? 0.55 : 0.5) * day;
  scene.environmentIntensity = 0.08 + (lit ? 0.22 : walk ? 0.55 : 0.45) * day;
  winLights.forEach(l => { l.intensity = (l.userData.bal ? 4.5 : 6) * day; l.color.set(0xe6eef7).lerp(cDusk, Math.max(0, 1 - Math.abs(Math.sin(el) - 0.05) / 0.2) * 0.5); });
  renderer.toneMappingExposure = walk ? (lit ? 0.9 : 1.05) + 0.25 * night : 0.62 + 0.25 * night;
  const dusk = Math.max(0, 1 - Math.abs(Math.sin(el) - 0.05) / 0.2) * day;
  cFog.copy(cNight).lerp(cDay, day).lerp(cDusk, dusk * 0.6);
  scene.fog.color.copy(cFog);
  M.lamp.emissiveIntensity = 0.5 + 3 * night;
  M.downlight.emissiveIntensity = state.mode === 'walk' ? 0.6 + 2.5 * night : 0.4;
  M.mass.emissiveIntensity = 0.16 * night;
  city.bmat.emissiveIntensity = 1.4 * night;
  city.wheelLit.emissiveIntensity = 2.5 * night;
  city.towerLit.emissiveIntensity = 1.6 * night;
  for (const v of Object.values(venues)) {
    const on = curV() === v;
    v.lights.forEach(l => l.intensity = on ? (v.indoor ? 6 : (v.key === 'lobby' ? 1.2 : 0.15) + 4 * night) * l.userData.w : 0);
    v.glow.emissiveIntensity = 1.2 + 2.5 * night;
  }
  lamps.forEach(l => l.intensity = state.mode === 'overview' ? 0 : ((state.mode === 'walk' ? (lit ? 0 : 1.2) : 0.5) + 5 * night) * (l.userData.w ?? 1));
  const hh = Math.floor(state.time), mm = Math.round((state.time - hh) * 60);
  $('#timeLabel').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
  $('#sunInfo').textContent = el > 0 ? `太陽高度 ${THREE.MathUtils.radToDeg(el).toFixed(0)}°` : '日落後';
}

// ---------- 相機
let fly = null;
function flyTo(pos, target, dur = 1.1) {
  if (params.get('shot')) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, k: 0, dur };
}
function unitCenter(u) {
  const ids = plan.units[u].spaces; let x = 0, y = 0, n = 0;
  for (const i of ids) { const s = plan.spaces[i]; x += s.cx * s.cells; y += s.cy * s.cells; n += s.cells; }
  return [x / n, y / n];
}
function viewDoll() {
  const [ux, uy] = unitCenter(state.unit), y0 = floorY(state.floor);
  const t = new THREE.Vector3(wx(ux), y0 + 0.6, toZ(uy));
  const dir = new THREE.Vector3(Math.sign(toX(ux) || 1) * T().s * 0.55, 1.6, Math.sign(t.z || 1) * 1.0).normalize();
  flyTo(t.clone().addScaledVector(dir, 17), t);
}
function viewOverview() {
  const y = floorY(state.floor);
  // 從文德路斜看兩棟，選取那棟在近側
  flyTo(new THREE.Vector3(25.5 - T().s * 70, 38, 125), new THREE.Vector3(25.5 - T().s * 6, Math.max(y * 0.75, 24), 0));
}

// ---------- 模式
function setMode(mode) {
  const prev = state.mode;
  state.mode = mode;
  document.body.dataset.mode = mode;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  controls.enabled = mode !== 'walk' && mode !== 'venue';
  if (prev === 'venue' && mode !== 'venue') { floorGroup.add(hoverRing, destMark); hoverRing.visible = destMark.visible = false; }
  if (mode === 'venue') { fly = null; setAO(true); city.setOverview(false); enterVenue(); renderSide(); return; }
  if (mode === 'walk') {
    fly = null;
    if (prev !== 'walk') {
      const u = plan.units[state.unit];
      if (plan.spaces[plan.id(walker.x, walker.y)]?.unit !== state.unit || !walker.x) walker.place(...u.spawn, FACE_YAW[u.face]);
      walker.room = 0; walker.checkRoom();
      camera.fov = zoomFov = 70; camera.updateProjectionMatrix();
      if (innerWidth <= 760) document.body.classList.add('side-closed');
    }
  } else {
    walker.tour = null; walker.path = null;
    camera.fov = 50; camera.updateProjectionMatrix();
    if (prev === 'walk') { camera.position.y += 0; }
    mode === 'doll' ? viewDoll() : viewOverview();
  }
  setAO(mode === 'walk');
  city.setOverview(mode === 'overview');
  updateBuilding(); renderSide();
}
function selectUnit(u, { keepCamera = false } = {}) {
  state.unit = u;
  updateBuilding(); renderSide(); drawMini();
  if (keepCamera) return;
  if (state.mode === 'doll') viewDoll();
  if (state.mode === 'walk') { const U = plan.units[u]; walker.place(...U.spawn, FACE_YAW[U.face]); walker.room = 0; walker.checkRoom(); }
}
function setFinish(f) {
  state.finish = f;
  document.body.dataset.finish = f;
  document.querySelectorAll('#finish button').forEach(b => b.classList.toggle('on', b.dataset.finish === f));
  applyFinish(M, f, state.theme);
  walker.setBlocked(f === 'bare' ? F.blockedBare : F.blocked);
  if (walker.path && walker.path.length) { const g = walker.path[walker.path.length - 1]; walker.goTo(...g); }
  updateBuilding(); renderSide();
}
function selectTower(t) {
  if (t === state.tower) return;
  state.tower = t; miniFor = null;
  document.querySelectorAll('#towers button').forEach(b => b.classList.toggle('on', b.dataset.tower === t));
  updateBuilding(); renderSide(); drawMini();
  if (state.mode === 'doll') viewDoll();
  if (state.mode === 'overview') viewOverview();
  if (state.mode === 'walk') { const U = plan.units[state.unit]; walker.place(...U.spawn, FACE_YAW[U.face]); walker.room = 0; walker.checkRoom(); }
}
function setFloor(f) {
  state.floor = THREE.MathUtils.clamp(f, MIN_F, state.floors);
  $('#floorLabel').textContent = `${state.floor}F`;
  updateBuilding();
  if (state.mode === 'doll') viewDoll();
  if (state.mode === 'overview') viewOverview();
  renderSide();
}

// ---------- 側欄
const SIDE_N = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const WIND = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
function compass(side) {
  const [sx, sz] = SIDE_N[side], x = sx * T().s, z = sz;           // 鏡像後的世界方向
  const [nx, nz] = northVec(), ex = -nz, ez = nx;
  const b = (THREE.MathUtils.radToDeg(Math.atan2(x * ex + z * ez, x * nx + z * nz)) + 360) % 360;
  return WIND[Math.round(b / 45) % 8];
}
const UNIT_SIDES = { A1: ['up', 'left'], A2: ['up'], A3: ['up'], A5: ['up', 'right'], A6: ['down', 'right'], A7: ['down'], A8: ['down'], A9: ['down', 'left'] };
const ping = a => (a / 3.3058).toFixed(2);
function renderSide() {
  const u = plan.units[state.unit], sides = UNIT_SIDES[state.unit], [main, bal] = OFFICIAL[state.unit];
  const road = sides.includes('down');
  renderSchemes(u);
  if (state.mode !== 'venue') { const sc = SCHEMES[u.kind].find(x => x.id === state.scheme[u.kind]) || SCHEMES[u.kind][0]; $('#sheetTitle').innerHTML = `${dn(u.name)}・${state.floor}F<small>${esc(sc.name)}</small>`; }
  $('#unitCard').innerHTML = `
    <div class="uhead"><span class="ubadge">${dn(u.name)}</span><div><b>${state.tower}棟・${esc(u.label)}</b><small>${u.kind === 'corner' ? '角間・三面採光' : '中間戶・單面採光'}</small></div></div>
    <dl>
      <dt>坪數</dt><dd>${u.size}（含公設）</dd>
      <dt>主建物</dt><dd>${main}㎡（${ping(main)} 坪）</dd>
      <dt>陽台</dt><dd>${bal}㎡（${ping(bal)} 坪）</dd>
      <dt>開窗面向</dt><dd>${sides.map(compass).join('、')}</dd>
      <dt>臨路</dt><dd>${road ? '面 30M 文德路：視野開闊、車聲較明顯' : '北側 6M 文德街207巷：較安靜'}</dd>
      <dt>所在樓層</dt><dd>${state.floor}F・視線高度約 ${(floorY(state.floor) + 1.6).toFixed(0)} 公尺</dd>
    </dl>
    ${state.reno ? renoCard(u) : ''}
    ${state.finish === 'bare' ? '<p class="note">毛胚示意：牆面、天花為混凝土原貌，地坪為水泥粉光；含大門與窗，不含室內門、廚具、衛浴設備與家具。實際交屋標準以契約為準。</p>' : ''}`;
  const rooms = u.spaces.map(i => plan.spaces[i]).filter(s => s.kind !== 'ac');
  $('#roomList').innerHTML = rooms.map(s => `<button data-space="${s.id}"><span>${roomName(s)}</span><small>${(s.area / 3.3058).toFixed(1)} 坪</small></button>`).join('');
  $('#roomList').querySelectorAll('button').forEach(b => b.onclick = () => {
    const s = plan.spaces[+b.dataset.space];
    if (state.mode !== 'walk') { setMode('walk'); }
    const w = F.lights.filter(l => l.sp === s.id).sort((a, b) => b.w * b.h - a.w * a.h)[0];   // 進房間後面向最大的窗
    walkTo(s.cx, s.cy, w ? { yaw: Math.atan2(w.nx, w.nz), pitch: -0.05 } : null);
  });
}

// 客變方案：換方案要重建整層幾何，直接帶參數重新載入
function stateURL(patch = {}) {
  const q = new URLSearchParams();
  const sc = { ...state.scheme, ...(patch.scheme || {}) };
  q.set('unit', state.tower + state.unit.slice(1)); q.set('floor', state.floor); q.set('mode', patch.mode || state.mode);
  q.set('t', state.time); q.set('season', state.season); q.set('theme', state.theme); q.set('north', state.north);
  if (state.finish === 'bare') q.set('finish', 'bare');
  if (state.reno) q.set('reno', '1');
  if ((patch.mode || state.mode) === 'venue') q.set('venue', state.venue);
  const ids = Object.values(sc).filter(id => id !== 'c0' && id !== 'm0'); if (ids.length) q.set('scheme', ids.join(','));
  if (params.get('hq')) q.set('hq', params.get('hq'));
  return '?' + q.toString();
}
function renderSchemes(u) {
  const list = SCHEMES[u.kind], cur = list.find(s => s.id === state.scheme[u.kind]) || list[0];
  const li = a => a ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  $('#schemes').innerHTML = `<h3>客變方案（${u.kind === 'corner' ? '角間 A1／A5／A6／A9' : '中間戶 A2／A3／A7／A8'}）</h3>
    <div class="chips">${list.map(s => `<button data-id="${s.id}" class="${s === cur ? 'on' : ''}"><b>${esc(s.name)}</b><small>${esc(s.tag)}</small></button>`).join('')}</div>
    <p class="ssum">${esc(cur.summary)}</p>
    <button class="reqOpen" data-open-req>查看／修改客變需求單</button>
    ${cur.results?.length ? `<details open><summary>需求單對照（做到 ${cur.results.filter(r => r.done).length}／${cur.results.length}）</summary><ul class="rres">${cur.results.map(r => `<li class="${r.done ? 'ok' : 'no'}"><b>${r.done ? '✓' : '✗'}</b> ${esc(r.text)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
    ${cur.changes ? `<details ${cur.results?.length ? '' : 'open'}><summary>改了什麼</summary>${li(cur.changes)}</details><details><summary>為什麼住起來舒服</summary>${li(cur.comfort)}</details><details><summary>合法性檢查</summary>${li(cur.legal)}</details>` : ''}`;
  $('#schemes').querySelector('[data-open-req]').onclick = () => $('#reqTop').click();
  $('#schemes').querySelectorAll('.chips button').forEach(b => b.onclick = () => {
    if (b.dataset.id === cur.id) return;
    $('#loading')?.classList.remove('done');
    location.href = stateURL({ scheme: { [u.kind]: b.dataset.id }, mode: state.mode === 'overview' ? 'doll' : state.mode });
  });
}
function renoCard(u) {
  const rooms = u.spaces.map(i => plan.spaces[i]).filter(s => s.kind !== 'ac' || u.kind === 'mid');
  const seen = new Set(), rows = rooms.filter(s => !seen.has(s.type) && seen.add(s.type));
  return `<div class="reno"><div class="legend">${Object.values(ZONES).map(z => `<span><i style="background:${z.css}"></i>${z.name}</span>`).join('')}</div>
    <ul>${rows.map(s => `<li><i style="background:${ZONES[zoneOf(s)].css}"></i><b>${roomName(s)}</b>${ruleOf(s, u).replace(/^[^：]+：/, '')}</li>`).join('')}</ul>
    <p class="note">紅色方柱＝結構柱，打叉方塊＝管道間，淡紅帶＝推估的梁位。依計畫書平面圖推估，室內隔間是否為 RC 圖上看不出來，請以建商客變手冊與結構圖為準。客變要在結構施工到該樓層前提出；交屋後自行改隔間或結構，保固會失效。樣品屋模式點房間可看說明。</p></div>`;
}

// ---------- 小地圖
const mini = $('#mini'), mg = mini.getContext('2d');
const miniImg = document.createElement('canvas'); miniImg.width = GW; miniImg.height = GH;
const UNIT_COLORS = { A1: '#e9b872', A2: '#8fbfb0', A3: '#a7b9e0', A5: '#d9a3a3', A6: '#e9b872', A7: '#8fbfb0', A8: '#a7b9e0', A9: '#d9a3a3' };
function paintMiniBase() {
  const g = miniImg.getContext('2d'), img = g.createImageData(GW, GH), col = {};
  for (let i = 0; i < GW * GH; i++) {
    const id = plan.ids[i]; let c = [0, 0, 0, 0];
    if (id) {
      const sp = plan.spaces[id];
      if (!col[id]) {
        let hex = sp.kind === 'lobby' ? '#f4f2ec' : sp.kind === 'core' ? '#a9adb0' : UNIT_COLORS[sp.unit];
        const cc = new THREE.Color(hex); if (sp.unit && sp.unit !== state.unit) cc.lerp(new THREE.Color('#ffffff'), 0.55);
        if (sp.kind === 'bal' || sp.kind === 'ac') cc.lerp(new THREE.Color('#ffffff'), 0.4);
        col[id] = [cc.r * 255, cc.g * 255, cc.b * 255, 255];
      }
      c = col[id];
    }
    img.data.set(c, i * 4);
  }
  // 牆線
  for (let y = 1; y < GH; y++) for (let x = 1; x < GW; x++) {
    const i = y * GW + x;
    if (F.blocked[i] && (plan.ids[i] !== plan.ids[i - 1] || plan.ids[i] !== plan.ids[i - GW])) img.data.set([60, 66, 70, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
}
let miniFor = null;
function drawMini() {
  const key = state.unit;
  if (miniFor !== key) { paintMiniBase(); miniFor = key; }
  const W = mini.width, H = mini.height, sc = Math.min(W / GW, H / GH), ox = (W - GW * sc) / 2, oy = (H - GH * sc) / 2;
  mg.clearRect(0, 0, W, H);
  mg.imageSmoothingEnabled = true;
  const mir = T().s < 0;
  mg.save(); if (mir) { mg.translate(W, 0); mg.scale(-1, 1); }
  mg.drawImage(miniImg, ox, oy, GW * sc, GH * sc);
  if (state.mode === 'walk') {
    const px = ox + (walker.x - GX0) * sc, py = oy + (walker.y - GY0) * sc;
    mg.save(); mg.translate(px, py); mg.rotate(-walker.yaw);
    mg.fillStyle = 'rgba(255,140,40,.28)'; mg.beginPath(); mg.moveTo(0, 0); mg.arc(0, 0, 26, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); mg.fill();
    mg.fillStyle = '#ff7a1a'; mg.beginPath(); mg.arc(0, 0, 4.5, 0, 7); mg.fill();
    mg.restore();
  }
  mg.restore();
  mg.textAlign = 'center'; mg.textBaseline = 'middle';
  for (const [n, u] of Object.entries(plan.units)) {
    const [cx, cy] = unitCenter(n), sel = n === state.unit;
    mg.font = `${sel ? 700 : 600} ${sel ? 15 : 13}px "PingFang TC",sans-serif`;
    mg.fillStyle = sel ? '#1f5f5b' : '#455';
    const x = ox + (cx - GX0) * sc;
    mg.fillText(dn(n), mir ? W - x : x, oy + (cy - GY0) * sc);
  }
  // 指北
  mg.save(); mg.translate(W - 16, 16); mg.rotate(THREE.MathUtils.degToRad(state.north));
  mg.fillStyle = '#c0392b'; mg.beginPath(); mg.moveTo(0, -10); mg.lineTo(5, 6); mg.lineTo(0, 3); mg.lineTo(-5, 6); mg.fill(); mg.restore();
  mg.fillStyle = '#c0392b'; mg.font = '600 10px sans-serif'; mg.fillText('N', W - 16, 34);
  mini._map = { sc, ox, oy };
}
mini.addEventListener('click', e => {
  const r = mini.getBoundingClientRect(), { sc, ox, oy } = mini._map;
  let px = (e.clientX - r.left) * (mini.width / r.width); if (T().s < 0) px = mini.width - px;
  const py = (e.clientY - r.top) * (mini.height / r.height);
  const x = GX0 + (px - ox) / sc, y = GY0 + (py - oy) / sc, sp = plan.spaces[plan.id(x, y)];
  if (!sp) return;
  if (state.mode === 'walk') { if (sp.unit === state.unit || sp.kind === 'lobby') walkTo(x, y); else selectUnit(sp.unit); }
  else if (sp.unit) selectUnit(sp.unit);
});

// ---------- 漫遊小地圖：只畫目前這一戶的平面（牆、門弧、窗、房名坪數）、自己的位置與視線、指北；可關閉、放大，點了走過去
const mapEl = $('#map'), mapc = $('#mapc'), mc = mapc.getContext('2d');
const SEGS = wallSegments(plan), decomposeRects = decompose(plan);
const ROOM_FILL = t => /浴/.test(t) ? '#e2ecef' : /廚房/.test(t) ? '#efe9e1' : /陽台|平台/.test(t) ? '#e9eef0' : /臥/.test(t) ? '#eef0e6' : /玄關/.test(t) ? '#f1ece2' : '#f5eedf';
const unitBox = {};
function mapBox(u) {                         // 這一戶的範圍（格子 px）＋邊界；u='core' 是梯廳＋電梯樓梯
  if (unitBox[u]) return unitBox[u];
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const sp = plan.spaces[plan.ids[y * GW + x]];
    if (u === 'core' ? sp && !sp.unit : sp?.unit === u) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
  }
  const m = 14; return (unitBox[u] = [GX0 + x1 - m, GY0 + y1 - m, GX0 + x2 + m, GY0 + y2 + m]);
}
const mapState = { closed: localStorage.getItem('mapClosed') === '1', big: false };
const syncMapUI = () => { document.body.classList.toggle('map-closed', mapState.closed); document.body.classList.toggle('map-big', mapState.big && !mapState.closed); drawMap(); };
$('#mapClose').onclick = e => { e.stopPropagation(); mapState.closed = true; mapState.big = false; localStorage.setItem('mapClosed', '1'); syncMapUI(); };
$('#mapOpen').onclick = () => { mapState.closed = false; localStorage.setItem('mapClosed', '0'); syncMapUI(); };
$('#mapZoom').onclick = e => { e.stopPropagation(); mapState.big = !mapState.big; syncMapUI(); };
addEventListener('keydown', e => { if (e.code === 'KeyM' && walkish() && e.target.tagName !== 'INPUT') { mapState.big = !mapState.big; if (mapState.big) mapState.closed = false; syncMapUI(); } });
function drawMap() {
  if (!walkish() || mapState.closed) return;
  if (curV()) return drawVenueMap(curV());
  const dpr = Math.min(devicePixelRatio, 2), W = mapEl.clientWidth, H = mapEl.clientHeight;
  if (!W) return;
  if (mapc.width !== W * dpr) { mapc.width = W * dpr; mapc.height = H * dpr; }
  const inCore = !plan.spaces[plan.id(walker.x, walker.y)]?.unit, focus = inCore ? 'core' : state.unit;   // 走到梯廳時地圖改畫公共區
  const [bx1, by1, bx2, by2] = mapBox(focus), sc = Math.min(W / (bx2 - bx1), H / (by2 - by1)), ox = (W - (bx2 - bx1) * sc) / 2, oy = (H - (by2 - by1) * sc) / 2;
  const mir = T().s < 0, X = x => { const v = ox + (x - bx1) * sc; return mir ? W - v : v; }, Y = y => oy + (y - by1) * sc;
  mc.setTransform(dpr, 0, 0, dpr, 0, 0); mc.clearRect(0, 0, W, H);
  // 房間底色（其他戶淡灰）
  for (const r of decomposeRects) {
    const sp = plan.spaces[r.id]; if (r.x2 < bx1 || r.x1 > bx2 || r.y2 < by1 || r.y1 > by2) continue;
    mc.fillStyle = (inCore ? !sp.unit : sp.unit === state.unit) ? (sp.unit ? ROOM_FILL(sp.type) : sp.kind === 'lobby' ? '#f3ecdc' : '#dfe3e5') : sp.kind === 'lobby' ? '#f2f1ec' : '#e6e6e3';
    const xa = X(r.x1), xb = X(r.x2); mc.fillRect(Math.min(xa, xb), Y(r.y1), Math.abs(xb - xa), (r.y2 - r.y1) * sc);
  }
  // 牆、門、窗
  mc.lineCap = 'butt';
  for (const s of SEGS) {
    const A = plan.spaces[s.a], B = plan.spaces[s.b];
    if (inCore ? (A?.unit && B?.unit) : (A?.unit !== state.unit && B?.unit !== state.unit)) continue;
    const H_ = s.o === 'h', k = s.op ? s.op.k : 'wall', th = (s.cls === 'ext' ? 0.22 : s.cls === 'party' ? 0.18 : s.cls === 'rail' ? 0.08 : 0.12) / S * sc;
    const p = (t, n = 0) => H_ ? [X(t), Y(s.at + n)] : [X(s.at + n), Y(t)];
    const line = (t1, t2, w, col) => { mc.strokeStyle = col; mc.lineWidth = w; mc.beginPath(); mc.moveTo(...p(t1)); mc.lineTo(...p(t2)); mc.stroke(); };
    if (s.cls === 'rail') { line(s.t1, s.t2, Math.max(1.5, th), '#8aa0a8'); continue; }
    if (k === 'wall' || k === 'elev') line(s.t1, s.t2, Math.max(2, th), '#39434a');
    else if (k === 'win' || k === 'high' || k === 'slide') {
      line(s.t1, s.t2, Math.max(2, th), '#ffffff');
      for (const n of [-0.3, 0.3]) { const q = th / sc * n; mc.strokeStyle = '#4b88a6'; mc.lineWidth = 1.2; mc.beginPath(); mc.moveTo(...p(s.t1, q)); mc.lineTo(...p(s.t2, q)); mc.stroke(); }
    } else if (k === 'door') {
      const op = s.op, hinge = op.hg < 0 ? s.t1 : s.t2, free = op.hg < 0 ? s.t2 : s.t1, r = Math.abs(s.t2 - s.t1);
      const [hx, hy] = p(hinge), [fx, fy] = p(free), [ex, ey] = p(hinge, op.sw * r);
      mc.strokeStyle = '#7a8890'; mc.lineWidth = 1; mc.beginPath(); mc.moveTo(hx, hy); mc.lineTo(ex, ey); mc.stroke();
      mc.setLineDash([2, 2]); mc.beginPath(); mc.moveTo(fx, fy); mc.quadraticCurveTo(fx + ex - hx, fy + ey - hy, ex, ey); mc.stroke(); mc.setLineDash([]);
    }
  }
  // 房名、坪數
  mc.textAlign = 'center'; mc.textBaseline = 'middle';
  const big = mapState.big, f1 = big ? 15 : W < 200 ? 9 : 11;
  const labelIds = inCore ? plan.spaces.slice(1).filter(sp => !sp.unit && sp.type !== '梯廳').map(sp => sp.id).concat(plan.spaces.findIndex(sp => sp?.type === '梯廳')) : plan.units[state.unit].spaces;
  for (const i of labelIds) {
    const sp = plan.spaces[i]; if (sp.kind === 'ac' && !big) continue;
    const x = X(sp.cx), y = Y(sp.cy);
    mc.fillStyle = '#33403f'; mc.font = `600 ${f1}px "PingFang TC","Noto Sans TC",sans-serif`; mc.fillText(sp.type, x, y - (big ? 8 : 0));
    if (big) { mc.fillStyle = '#6b7775'; mc.font = `400 12px "PingFang TC",sans-serif`; mc.fillText(`${(sp.area / 3.3058).toFixed(1)} 坪`, x, y + 10); }
  }
  // 自己：圓點＋視線扇形
  const px = X(walker.x), py = Y(walker.y), yaw = walker.yaw * (mir ? -1 : 1), rr = big ? 46 : 30;
  mc.save(); mc.translate(px, py); mc.rotate(-yaw);
  const gr = mc.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, 'rgba(255,122,26,.45)'); gr.addColorStop(1, 'rgba(255,122,26,0)');
  mc.fillStyle = gr; mc.beginPath(); mc.moveTo(0, 0); mc.arc(0, 0, rr, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); mc.fill();
  mc.fillStyle = '#ff7a1a'; mc.strokeStyle = '#fff'; mc.lineWidth = 2; mc.beginPath(); mc.arc(0, 0, big ? 6 : 4.5, 0, 7); mc.fill(); mc.stroke();
  mc.restore();
  // 目的地
  if (walker.path && walker.path.length) { const [dx, dy] = walker.path[walker.path.length - 1]; mc.strokeStyle = '#2f7d6d'; mc.lineWidth = 2; mc.beginPath(); mc.arc(X(dx), Y(dy), 5, 0, 7); mc.stroke(); }
  // 指北（含東南西）
  const R = big ? 20 : W < 200 ? 10 : 13, cx = W - R - (big ? 22 : 15), cy = R + (big ? 22 : 15);
  mc.save(); mc.translate(cx, cy); mc.fillStyle = 'rgba(255,255,255,.9)'; mc.beginPath(); mc.arc(0, 0, R + (big ? 20 : 12), 0, 7); mc.fill();
  mc.rotate(THREE.MathUtils.degToRad(state.north));
  mc.fillStyle = '#c0392b'; mc.beginPath(); mc.moveTo(0, -R); mc.lineTo(R * 0.38, 0); mc.lineTo(-R * 0.38, 0); mc.fill();
  mc.fillStyle = '#9aa3a6'; mc.beginPath(); mc.moveTo(0, R); mc.lineTo(R * 0.38, 0); mc.lineTo(-R * 0.38, 0); mc.fill();
  mc.font = `700 ${big ? 12 : 8}px sans-serif`;
  for (const [t, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const r2 = R + (big ? 13 : 7), ang = THREE.MathUtils.degToRad(a);
    mc.save(); mc.translate(Math.sin(ang) * r2, -Math.cos(ang) * r2); mc.rotate(-THREE.MathUtils.degToRad(state.north));
    mc.fillStyle = t === 'N' ? '#c0392b' : '#6b7775'; mc.fillText(t, 0, 0); mc.restore();
  }
  mc.restore();
  mapc._map = { sc, ox, oy, bx1, by1, W, mir };
  $('#unitName').textContent = dn(state.unit);
}
// 公設小地圖：畫整個公設平面（地坪顏色、牆、玻璃、門、空間名稱），自己的位置與指北同戶內地圖
const VENUE_FILL = { stone: '#efe6d6', wood: '#ead9bf', paving: '#e4e2dc', grass: '#a9c48e', deck: '#e4e2dc' };
const venueCache = new Map();
function venueGeom(V) {
  if (venueCache.has(V)) return venueCache.get(V);
  const rects = decompose(V.plan), segs = venueSegments(V.plan);
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const r of rects) { x1 = Math.min(x1, r.x1); y1 = Math.min(y1, r.y1); x2 = Math.max(x2, r.x2); y2 = Math.max(y2, r.y2); }
  const g = { rects, segs, box: [x1 - 10, y1 - 10, x2 + 10, y2 + 10] };
  venueCache.set(V, g); return g;
}
function drawVenueMap(V) {
  const dpr = Math.min(devicePixelRatio, 2), W = mapEl.clientWidth, H = mapEl.clientHeight;
  if (!W) return;
  if (mapc.width !== W * dpr) { mapc.width = W * dpr; mapc.height = H * dpr; }
  const { rects, segs, box } = venueGeom(V), walker = V.walker, big = mapState.big;
  let [bx1, by1, bx2, by2] = box;
  // 場景比小地圖大很多時（一樓基地約 105m 寬），小地圖改成以自己為中心、約 34m 見方；放大時才看全區
  const span = 680;
  if (!big && (bx2 - bx1 > span * 1.4 || by2 - by1 > span * 1.4)) {
    const hw = span / 2 * Math.max(1, W / H), hh = span / 2 * Math.max(1, H / W);
    bx1 = walker.x - hw; bx2 = walker.x + hw; by1 = walker.y - hh; by2 = walker.y + hh;
  }
  const sc = Math.min(W / (bx2 - bx1), H / (by2 - by1)), ox = (W - (bx2 - bx1) * sc) / 2, oy = (H - (by2 - by1) * sc) / 2;
  const X = x => ox + (x - bx1) * sc, Y = y => oy + (y - by1) * sc;
  mc.setTransform(dpr, 0, 0, dpr, 0, 0); mc.clearRect(0, 0, W, H);
  for (const r of rects) {
    const sp = V.plan.spaces[r.id];
    mc.fillStyle = sp.key === 'pool' ? '#9cc3d3' : sp.key === 'core' ? '#c9cdcf' : VENUE_FILL[sp.floor] || '#e6e6e3';
    mc.fillRect(X(r.x1), Y(r.y1), (r.x2 - r.x1) * sc, (r.y2 - r.y1) * sc);
  }
  for (const s of segs) {
    const A = V.plan.spaces[s.a], B = V.plan.spaces[s.b];
    if (!(A && !A.out) && !(B && !B.out)) continue;                 // 只畫室內的牆（同 3D）
    const H_ = s.o === 'h', k = s.op ? s.op.k : 'wall', p = t => H_ ? [X(t), Y(s.at)] : [X(s.at), Y(t)];
    const line = (w, col, dash) => { mc.strokeStyle = col; mc.lineWidth = w; mc.setLineDash(dash || []); mc.beginPath(); mc.moveTo(...p(s.t1)); mc.lineTo(...p(s.t2)); mc.stroke(); mc.setLineDash([]); };
    if (k === 'wall') line(Math.max(2, 0.2 / S * sc), '#39434a');
    else if (k === 'glass' || k === 'win') line(2, '#4b88a6');
    else if (k === 'auto') line(2, '#4b88a6', [3, 3]);
    else if (k === 'door') line(1.5, '#7a8890', [2, 2]);
  }
  mc.textAlign = 'center'; mc.textBaseline = 'middle';
  const f1 = big ? 14 : W < 200 ? 8.5 : 10, seen = new Set();
  for (const sp of V.plan.spaces.slice(1)) {
    if (seen.has(sp.type) || /花圃|花台/.test(sp.type)) continue; seen.add(sp.type);
    if (!big && sp.area < 12) continue;
    if (sp.walk === false && /店鋪|綠籬|花園/.test(sp.type) && !big) continue;
    mc.fillStyle = '#33403f'; mc.font = `600 ${f1}px "PingFang TC","Noto Sans TC",sans-serif`;
    const name = !big && sp.type.length > 6 ? sp.type.replace('管理委員會使用空間', '管委會').replace(/（.*）/, '') : sp.type;
    const [lx, ly] = sp.lab ? sp.lab.map(v => 40 + v / S) : [sp.cx, sp.cy];   // 環形空間（屋頂步道）重心落在別的空間上，另給標字位置
    mc.fillText(name, X(lx), Y(ly));
  }
  // 自己
  const px = X(walker.x), py = Y(walker.y), rr = big ? 46 : 30;
  mc.save(); mc.translate(px, py); mc.rotate(-walker.yaw);
  const gr = mc.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, 'rgba(255,122,26,.45)'); gr.addColorStop(1, 'rgba(255,122,26,0)');
  mc.fillStyle = gr; mc.beginPath(); mc.moveTo(0, 0); mc.arc(0, 0, rr, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); mc.fill();
  mc.fillStyle = '#ff7a1a'; mc.strokeStyle = '#fff'; mc.lineWidth = 2; mc.beginPath(); mc.arc(0, 0, big ? 6 : 4.5, 0, 7); mc.fill(); mc.stroke();
  mc.restore();
  if (walker.path && walker.path.length) { const [dx, dy] = walker.path[walker.path.length - 1]; mc.strokeStyle = '#2f7d6d'; mc.lineWidth = 2; mc.beginPath(); mc.arc(X(dx), Y(dy), 5, 0, 7); mc.stroke(); }
  // 指北
  const R = big ? 20 : W < 200 ? 10 : 13, cx = W - R - (big ? 22 : 15), cy = R + (big ? 22 : 15);
  mc.save(); mc.translate(cx, cy); mc.fillStyle = 'rgba(255,255,255,.9)'; mc.beginPath(); mc.arc(0, 0, R + (big ? 20 : 12), 0, 7); mc.fill();
  mc.rotate(THREE.MathUtils.degToRad(state.north));
  mc.fillStyle = '#c0392b'; mc.beginPath(); mc.moveTo(0, -R); mc.lineTo(R * 0.38, 0); mc.lineTo(-R * 0.38, 0); mc.fill();
  mc.fillStyle = '#9aa3a6'; mc.beginPath(); mc.moveTo(0, R); mc.lineTo(R * 0.38, 0); mc.lineTo(-R * 0.38, 0); mc.fill();
  mc.font = `700 ${big ? 12 : 8}px sans-serif`;
  for (const [t, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const r2 = R + (big ? 13 : 7), ang = THREE.MathUtils.degToRad(a);
    mc.save(); mc.translate(Math.sin(ang) * r2, -Math.cos(ang) * r2); mc.rotate(-THREE.MathUtils.degToRad(state.north));
    mc.fillStyle = t === 'N' ? '#c0392b' : '#6b7775'; mc.fillText(t, 0, 0); mc.restore();
  }
  mc.restore();
  mapc._map = { sc, ox, oy, bx1, by1, W, mir: false, venue: V };
}
mapc.addEventListener('click', e => {
  const r = mapc.getBoundingClientRect(), m = mapc._map; if (!m) return;
  let px = e.clientX - r.left; if (m.mir) px = m.W - px;
  const x = m.bx1 + (px - m.ox) / m.sc, y = m.by1 + (e.clientY - r.top - m.oy) / m.sc;
  if (m.venue) {                                   // 公設：點可走的地方就走過去
    if (curV() !== m.venue) return;
    const [fx, fy] = m.venue.walker.nearestFree(x, y);
    if (m.venue.plan.spaces[m.venue.plan.id(fx, fy)]?.walk) { walkTo(fx, fy); if (mapState.big) { mapState.big = false; syncMapUI(); } }
    return;
  }
  const sp = plan.spaces[plan.id(x, y)];
  if (!sp) return;
  if (sp.unit === state.unit || sp.kind === 'lobby') { walkTo(x, y); if (mapState.big) { mapState.big = false; syncMapUI(); } }
  else selectUnit(sp.unit);
});
mapc.addEventListener('pointerdown', e => e.stopPropagation());
// 換戶：依平面順時針順序（UNIT_ORDER）
const stepUnit = d => { const i = UNIT_ORDER.indexOf(state.unit); selectUnit(UNIT_ORDER[(i + d + UNIT_ORDER.length) % UNIT_ORDER.length]); };
$('#unitPrev').onclick = e => { e.stopPropagation(); stepUnit(-1); };
$('#unitNext').onclick = e => { e.stopPropagation(); stepUnit(1); };
$('#disclaimer').onclick = () => $('#disclaimer').classList.toggle('open');
addEventListener('resize', () => drawMap());

// ---------- 輸入：點擊、拖曳視角、搖桿、鍵盤
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function floorHit(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.constant = -floorY(state.floor);
  return ray.ray.intersectPlane(plane, hit) ? [toPX((hit.x - T().x) * T().s), toPY(hit.z)] : null;
}
// 漫遊點擊落點：射線打到牆／家具側面時退回鏡頭這一側，不會穿到隔壁房間（只對牆地板這組低面數幾何做射線）
const visibleChain = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function walkTarget(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hs = ray.intersectObjects(spotGroup.children, false)[0];
  if (hs && visibleChain(hs.object)) return { spot: hs.object.userData.spot };
  const h = ray.intersectObjects(F.detail, false).find(h => visibleChain(h.object) && !(h.object.material.transparent && h.object.material.opacity < 0.5));
  if (!h) return null;
  const p = h.point.clone(), n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  if (Math.abs(n.y) < 0.7) p.add(ray.ray.direction.clone().setY(0).normalize().multiplyScalar(-0.35));
  floorGroup.worldToLocal(p);
  const [x, y] = walker.nearestFree(toPX(p.x), toPY(p.z));
  return plan.spaces[plan.id(x, y)] ? { p: [x, y] } : null;
}
function venueTarget(e) {
  const V = curV(); if (!V) return null;
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(V.floorMeshes, false).find(h => !(h.object.material.transparent && h.object.material.opacity < 0.5));
  if (!h) return null;
  const p = h.point.clone(), n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  if (Math.abs(n.y) < 0.7) p.add(ray.ray.direction.clone().setY(0).normalize().multiplyScalar(-0.35));
  V.group.worldToLocal(p);
  const [x, y] = V.walker.nearestFree(toPX(p.x), toPY(p.z));
  return V.plan.spaces[V.plan.id(x, y)]?.walk ? { p: [x, y] } : null;
}
const targetFor = e => state.mode === 'venue' ? venueTarget(e) : walkTarget(e);
// 地面提示圈（滑鼠移動時）與目的地記號
const ringMat = new THREE.MeshBasicMaterial({ color: 0x2f7d6d, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
const hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.21, 40).rotateX(-Math.PI / 2), ringMat);
const destMark = new THREE.Mesh(new THREE.CircleGeometry(0.21, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2f7d6d, transparent: true, opacity: 0.5, depthWrite: false }));
hoverRing.visible = destMark.visible = false; hoverRing.renderOrder = destMark.renderOrder = 3;
floorGroup.add(hoverRing, destMark);
const putOnFloor = (m, [x, y]) => { m.position.set(toX(x), 0.015 + (curV()?.hAt ? curV().hAt(x, y) : 0), toZ(y)); m.visible = true; };
// 走過去（所有點擊移動都經過這裡）：放目的地記號、望遠歸位
function walkTo(x, y, arrive = null, fov = 70, msg = null) {
  const path = W().goTo(x, y, arrive);
  if (path && path.length) putOnFloor(destMark, path[path.length - 1]); else destMark.visible = false;
  if (path) { zoomFov = path.length ? 70 : fov; pendingView = { fov, msg }; }   // 望遠與看景說明等抵達、轉好方向再出現
  return path;
}
let pendingView = null;
// 窗前看景標記：該戶每扇對外窗前 0.7m，點了走過去面向窗外
const spotTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2f7d6d'; g.lineWidth = 7; g.beginPath(); g.moveTo(22, 64); g.quadraticCurveTo(64, 22, 106, 64); g.quadraticCurveTo(64, 106, 22, 64); g.stroke();
  g.fillStyle = '#2f7d6d'; g.beginPath(); g.arc(64, 64, 15, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const spotGroup = new THREE.Group(); floorGroup.add(spotGroup);
const spotGeo = new THREE.CircleGeometry(0.17, 32).rotateX(-Math.PI / 2), spotMat = new THREE.MeshBasicMaterial({ map: spotTex, transparent: true, depthWrite: false });
function placeSpots() {
  spotGroup.clear();
  for (const w of F.lights.filter(w => w.unit === state.unit && !/浴/.test(plan.spaces[w.sp].type) && w.y - w.h / 2 < 1.2)) {   // 浴室、高窗不放
    const [x, y] = walker.nearestFree(toPX(w.x + w.nx * 0.7), toPY(w.z + w.nz * 0.7));
    const m = new THREE.Mesh(spotGeo, spotMat); m.renderOrder = 3;
    m.position.set(toX(x), 0.02, toZ(y)); m.userData.spot = { p: [x, y], yaw: Math.atan2(w.nx, w.nz) };
    spotGroup.add(m);
  }
}
// 看景按鈕：在該戶每扇窗前／陽台上取幾個候選站位，從眼睛高度往目標拉視線，
// 25m 內碰到牆、窗框、陽台側牆就淘汰；剩下的挑最正對窗外的，走過去、轉向、遠的目標自動望遠
const viewRay = new THREE.Raycaster();
function clearView(sx, sz, tw) {
  const eye = floorGroup.localToWorld(new THREE.Vector3(toX(sx), 1.58, toZ(sz)));
  viewRay.set(eye, tw.clone().sub(eye).normalize()); viewRay.far = 25;
  const objs = [...F.detail, ...finGroup.children, ...towers[state.tower].shell];
  return !viewRay.intersectObjects(objs, false).some(h => visibleChain(h.object) && !(h.object.material.transparent && h.object.material.opacity < 0.5));
}
function viewTo(v) {
  floorGroup.updateMatrixWorld(true);
  const tw = new THREE.Vector3(v.x, v.y, v.z), t = floorGroup.worldToLocal(tw.clone());
  let best = null;
  for (const w of F.lights.filter(w => w.unit === state.unit)) {
    const tx_ = -w.nz, tz_ = w.nx, cands = [];
    if (w.bal) for (const o of [0.6, 1.0]) for (const l of [-w.w / 3, 0, w.w / 3]) cands.push([w.x - w.nx * o + tx_ * l, w.z - w.nz * o + tz_ * l]);
    else for (const o of [0.4, 0.8]) for (const l of [-w.w / 4, w.w / 4, 0]) cands.push([w.x + w.nx * o + tx_ * l, w.z + w.nz * o + tz_ * l]);
    for (const [cx, cz] of cands) {
      const [px, py] = walker.nearestFree(toPX(cx), toPY(cz)), x = toX(px), z = toZ(py);
      if (Math.hypot(x - cx, z - cz) > 0.3) continue;                            // 站不到那裡
      const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz), face = (-w.nx * dx - w.nz * dz) / d;
      if (face < 0.2) continue;
      const sc = face + (w.bal ? 0.15 : 0) - (/浴/.test(plan.spaces[w.sp].type) ? 0.4 : 0);
      if (best && sc <= best.sc) continue;
      if (!clearView(px, py, tw)) continue;
      best = { sc, px, py, d, dx, dz, w };
    }
  }
  if (!best) return toast(`這一戶看不到${v.name}的方向`, '窗戶都不朝那邊，或被牆擋住；換一戶或換棟看看');
  const { px, py, d, dx, dz, w } = best, fov = d > 2000 ? 24 : d > 800 ? 40 : 70;
  const where = w.bal ? plan.spaces[w.sp].type + '外陽台' : plan.spaces[w.sp].type + '窗前';
  const msg = [`看${v.name}`, `${where}・約 ${d > 1000 ? (d / 1000).toFixed(1) + ' 公里' : Math.round(d) + ' 公尺'}・${fov < 70 ? '已拉近視角・' : ''}被擋住代表這層樓看不到`];
  if (!walkTo(px, py, { yaw: Math.atan2(-dx, -dz), pitch: THREE.MathUtils.clamp(Math.atan2(t.y - 1.58, d), -0.5, 0.5) }, fov, msg))
    toast('走不過去', '');
}
function toast(b, s) { const t = $('#toast'); t.innerHTML = `<b>${b}</b><span>${s}</span>`; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
city.onViews = () => {
  $('#views').innerHTML = '<span>看景</span>' + city.views.map((v, i) => `<button data-v="${i}">${v.name}</button>`).join('');
  $('#views').querySelectorAll('button').forEach(b => b.onclick = () => viewTo(city.views[+b.dataset.v]));
};
// 望遠：滾輪／雙指縮放改視角，走動時歸位
let zoomFov = 70;
const zoomTag = $('#zoomTag'); zoomTag.onclick = () => { zoomFov = 70; };
{
  renderer.domElement.addEventListener('wheel', e => {
    if (!walkish()) return;
    e.preventDefault(); zoomFov = THREE.MathUtils.clamp(zoomFov * Math.exp(e.deltaY * 0.0015), 12, 70);
  }, { passive: false });
}
const touches = new Map(); let pinch0 = null;

let down = null;
const cvs = renderer.domElement;
cvs.addEventListener('pointerdown', e => {
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), fov: zoomFov }; down = null; return; }
  down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, id: e.pointerId, moved: 0 };
});
const endTouch = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch0 = null; };
addEventListener('pointercancel', endTouch);
let hoverQ = null;
addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch0 && touches.size === 2 && walkish()) {
    const [a, b] = [...touches.values()];
    zoomFov = THREE.MathUtils.clamp(pinch0.fov * pinch0.d / Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), 12, 70);
    return;
  }
  if (!down && walkish() && e.pointerType === 'mouse') {             // 滑鼠移動：更新地面提示圈（每畫面最多算一次）
    if (e.target !== cvs) { hoverRing.visible = false; return; }
    if (!hoverQ) requestAnimationFrame(() => { const t = targetFor(hoverQ); hoverQ = null; if (t?.p) putOnFloor(hoverRing, t.p); else hoverRing.visible = false; });
    hoverQ = e;
  }
  if (!down || e.pointerId !== down.id) return;
  const dx = e.clientX - down.lx, dy = e.clientY - down.ly; down.lx = e.clientX; down.ly = e.clientY;
  down.moved += Math.abs(dx) + Math.abs(dy);
  if (walkish()) {
    const w = W(); w.arrive = null;
    // 抓著畫面拖：每像素轉的角度＝視角換算，畫面跟手指 1:1 同步（原本快約 2.6 倍，畫面會跑在手指前面）
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / innerHeight;
    w.yaw += dx * k * (curV() ? 1 : T().s); w.pitch = THREE.MathUtils.clamp(w.pitch + dy * k, -1.1, 1.0);
    if (w.tour) w.tour = null;
  }
});
addEventListener('pointerup', e => {
  endTouch(e);
  if (!down || e.pointerId !== down.id) return;
  const click = down.moved < 6; down = null;
  if (!click || e.target !== cvs) return;
  if (walkish()) {
    const t = targetFor(e); if (!t) return;
    if (t.spot) walkTo(...t.spot.p, { yaw: t.spot.yaw, pitch: -0.03 });
    else walkTo(...t.p);
    return;
  }
  const p = floorHit(e); if (!p) return;
  const sp = plan.spaces[plan.id(...p)];
  if (state.mode === 'doll' && sp) {
    if (state.reno && sp.unit === state.unit) { toast(`${dn(sp.unit)}・${roomName(sp)}`, ruleOf(sp, plan.units[sp.unit])); return; }
    if (sp.unit === state.unit) {
      setMode('walk');
      const [ux, uy] = walker.nearestFree(...p);
      const yaw = Math.atan2(-(sp.cx - ux), -(sp.cy - uy));
      walker.place(ux, uy, Math.hypot(sp.cx - ux, sp.cy - uy) > 3 ? yaw : walker.yaw);
    } else if (sp.unit) selectUnit(sp.unit);
  }
});
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  W().keys[e.code] = true;
  if (e.code === 'Escape' && state.mode === 'walk') setMode('doll');
  if (e.code === 'Escape' && state.mode === 'venue') setMode('overview');
});
addEventListener('keyup', e => { W().keys[e.code] = false; walker.keys[e.code] = false; });
// 搖桿
const joy = $('#joy'), knob = $('#knob');
let joyId = null, joyC = null;
joy.addEventListener('pointerdown', e => { joyId = e.pointerId; const r = joy.getBoundingClientRect(); joyC = [r.left + r.width / 2, r.top + r.height / 2]; joy.setPointerCapture(e.pointerId); moveJoy(e); e.stopPropagation(); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) moveJoy(e); });
const endJoy = e => { if (e.pointerId !== joyId) return; joyId = null; W().joy.x = W().joy.y = 0; knob.style.transform = ''; };
joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  let dx = e.clientX - joyC[0], dy = e.clientY - joyC[1]; const d = Math.hypot(dx, dy), m = 44;
  if (d > m) { dx *= m / d; dy *= m / d; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  W().joy.x = dx / m; W().joy.y = dy / m;
}

// ---------- UI 綁定
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#fup').onclick = () => setFloor(state.floor + 1);
$('#fdn').onclick = () => setFloor(state.floor - 1);
$('#enterWalk').onclick = () => setMode('walk');
$('#tour').onclick = () => {
  if (state.mode !== 'walk') setMode('walk');
  const u = plan.units[state.unit];
  walker.place(...u.spawn, FACE_YAW[u.face]);
  walker.startTour(u.spaces, () => { $('#toast').innerHTML = '<b>導覽結束</b><span>可以自由走動，或點地面直接走過去</span>'; $('#toast').classList.remove('show'); void $('#toast').offsetWidth; $('#toast').classList.add('show'); });
};
$('#exitWalk').onclick = () => setMode(state.mode === 'venue' ? 'overview' : 'doll');
document.querySelectorAll('#venueTabs button').forEach(b => b.onclick = () => { if (state.mode === 'venue') enterVenue(b.dataset.venue); else { state.venue = b.dataset.venue; setMode('venue'); } });
$('#time').value = state.time; $('#time').oninput = e => { state.time = +e.target.value; updateSun(); };
$('#season').value = state.season; $('#season').onchange = e => { state.season = e.target.value; updateSun(); };
$('#north').value = state.north; $('#north').onchange = e => { state.north = +e.target.value; updateSun(); renderSide(); drawMini(); };
document.querySelectorAll('#towers button').forEach(b => { b.classList.toggle('on', b.dataset.tower === state.tower); b.onclick = () => selectTower(b.dataset.tower); });
$('#themes').innerHTML = Object.entries(THEMES).map(([k, t]) => `<button data-theme="${k}">${t.name}</button>`).join('');
const markTheme = () => document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('on', b.dataset.theme === state.theme));
document.querySelectorAll('#themes button').forEach(b => b.onclick = () => { state.theme = b.dataset.theme; markTheme(); if (state.finish === 'bare') setFinish('sample'); else applyTheme(M, state.theme); });
document.querySelectorAll('#finish button').forEach(b => b.onclick = () => setFinish(b.dataset.finish));
const markReno = () => { $('#renoBtn').classList.toggle('on', state.reno); $('#renoBtn').textContent = state.reno ? '顯示中' : '顯示'; };
$('#renoBtn').onclick = () => { state.reno = !state.reno; markReno(); updateBuilding(); renderSide(); if (state.reno && state.mode === 'overview') setMode('doll'); };
markReno();
initReqs(() => {
  const kind = plan.units[state.unit].kind;
  return { unit: dn(state.unit), kind, scheme: state.scheme[kind], schemes: state.scheme, applyScheme: (id, unit) => {
    if (unit && unit !== dn(state.unit)) { state.tower = unit[0]; state.unit = 'A' + unit.slice(1); }
    const k = /[1569]$/.test(state.unit) ? 'corner' : 'mid';
    location.href = stateURL({ scheme: { [k]: id }, mode: state.mode === 'overview' ? 'doll' : state.mode });
  } };
});
document.querySelectorAll('#finish button').forEach(b => b.classList.toggle('on', b.dataset.finish === state.finish));
document.body.dataset.finish = state.finish;
markTheme();
$('#envToggle').onclick = () => document.body.classList.toggle('env-open');
// ---------- 第一次來：三步驟引導＋示意聲明（看過記在 localStorage；? 按鈕可再打開）
{
  const g = { tower: state.tower, unit: state.unit, floor: state.floor };
  const big = localStorage.getItem('bigText') === '1';
  document.body.classList.toggle('bigtext', big); $('#gBigText').checked = big;
  $('#gBigText').onchange = e => { document.body.classList.toggle('bigtext', e.target.checked); localStorage.setItem('bigText', e.target.checked ? '1' : '0'); };
  const draw = () => {
    $('#gTower').innerHTML = ['A', 'B'].map(t => `<button data-t="${t}" class="${t === g.tower ? 'on' : ''}">${t} 棟</button>`).join('');
    $('#gUnit').innerHTML = UNIT_ORDER.slice().sort().map(u => `<button data-u="${u}" class="${u === g.unit ? 'on' : ''}">${g.tower}${u.slice(1)}</button>`).join('');
    $('#gFloor').textContent = `${g.floor}F`;
    const U = plan.units[g.unit], [main] = OFFICIAL[g.unit];
    $('#gInfo').textContent = `${g.tower}${g.unit.slice(1)}・${g.floor} 樓：${U.label}，${U.kind === 'corner' ? '角間三面採光' : '中間戶單面採光'}，主建物 ${main}㎡（${(main / 3.3058).toFixed(1)} 坪）`;
    $('#gTower').querySelectorAll('button').forEach(b => b.onclick = () => { g.tower = b.dataset.t; draw(); });
    $('#gUnit').querySelectorAll('button').forEach(b => b.onclick = () => { g.unit = b.dataset.u; draw(); });
  };
  $('#gFdn').onclick = () => { g.floor = Math.max(MIN_F, g.floor - 1); draw(); };
  $('#gFup').onclick = () => { g.floor = Math.min(FLOORS, g.floor + 1); draw(); };
  const close = () => { $('#guide').classList.remove('open'); localStorage.setItem('guideSeen', '1'); };
  const apply = () => { if (g.tower !== state.tower) selectTower(g.tower); if (g.floor !== state.floor) setFloor(g.floor); if (g.unit !== state.unit) selectUnit(g.unit); };
  $('#gGo').onclick = () => { close(); apply(); setMode('walk'); };
  $('#gLook').onclick = () => { close(); apply(); };
  const open = () => { Object.assign(g, { tower: state.tower, unit: state.unit, floor: state.floor }); draw(); $('#guide').classList.add('open'); };
  $('#helpBtn').onclick = open;
  // 帶了指定參數（分享連結、截圖、測試）就不打擾
  const direct = ['mode', 'req', 'shot', 'selftest', 'scheme', 'venue'].some(k => params.has(k));
  if (!localStorage.getItem('guideSeen') && !direct) open();
}
// 手機底部抽屜：點標題列切換；在標題列上滑展開、下拉收合
const setSheet = open => { document.body.classList.toggle('side-closed', !open); if (!open) $('#side').scrollTop = 0; };
{
  const head = $('#sheetHead'); let y0 = null, moved = false;
  head.addEventListener('pointerdown', e => { y0 = e.clientY; moved = false; head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove', e => { if (y0 === null) return; const dy = e.clientY - y0; if (Math.abs(dy) > 24) { moved = true; setSheet(dy < 0); y0 = null; } });
  head.addEventListener('pointerup', () => { if (y0 !== null && !moved) setSheet(document.body.classList.contains('side-closed')); y0 = null; });
  head.addEventListener('pointercancel', () => { y0 = null; });
}
if (innerWidth <= 760 && !params.get('mode')) document.body.classList.add('side-closed');
$('#floorLabel').textContent = `${state.floor}F`;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); drawMini();
  if (composer) { composer.setSize(innerWidth, innerHeight); gtao.setSize(innerWidth, innerHeight); }
});

// ---------- 啟動
updateBuilding();
camera.position.set(-90, 70, 120); controls.target.set(0, 15, 0);
setMode(params.get('mode') || 'overview');
if (params.get('mode') !== 'walk') { /* 由 setMode 處理相機 */ }
if (params.get('tour')) $('#tour').click();
if (params.get('room')) { const s = plan.units[state.unit].spaces.map(i => plan.spaces[i]).find(s => s.type === params.get('room')); if (s) walker.place(s.cx, s.cy, params.get('yaw') ? +params.get('yaw') : undefined); }
renderSide(); drawMini();

const clock = new THREE.Clock();
let miniT = 0, first = true;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  city.update(dt);
  if (fly) {
    fly.k = Math.min(1, fly.k + dt / fly.dur); const e = 1 - Math.pow(1 - fly.k, 3);
    camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (fly.k >= 1) fly = null;
  }
  if (walkish()) {
    const walker = W(), V = curV();
    const moving = walker.keys.KeyW || walker.keys.KeyS || walker.keys.KeyA || walker.keys.KeyD || walker.keys.ArrowUp || walker.keys.ArrowDown || Math.hypot(walker.joy.x, walker.joy.y) > 0.05;
    if (moving) { zoomFov = 70; destMark.visible = false; pendingView = null; }
    walker.update(dt);
    if (destMark.visible && !(walker.path && walker.path.length)) destMark.visible = false;
    if (pendingView && !(walker.path && walker.path.length) && !walker.arrive) {      // 抵達並轉好方向
      zoomFov = pendingView.fov; if (pendingView.msg) toast(...pendingView.msg); pendingView = null;
    }
    if (Math.abs(camera.fov - zoomFov) > 0.05) { camera.fov += (zoomFov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
    zoomTag.classList.toggle('on', zoomFov < 69); zoomTag.textContent = `望遠 ${(Math.tan(THREE.MathUtils.degToRad(35)) / Math.tan(THREE.MathUtils.degToRad(zoomFov / 2))).toFixed(1)}×　點此恢復`;
    if (V) {
      eyeH += ((V.hAt ? V.hAt(walker.x, walker.y) : 0) - eyeH) * Math.min(1, dt * 8);   // 地坪起伏：視線高度平順跟著走
      camera.position.copy(V.group.localToWorld(new THREE.Vector3(toX(walker.x), 1.58 + eyeH, toZ(walker.y))));
      // 基地很大：陰影範圍跟著人走
      const off = sun.position.clone().sub(sun.target.position); sun.target.position.set(camera.position.x, V.world.y, camera.position.z); sun.position.copy(sun.target.position).add(off);
    }
    else camera.position.set(wx(walker.x), floorY(state.floor) + 1.58, toZ(walker.y));
    camera.rotation.set(walker.pitch, walker.yaw * (V ? 1 : T().s), 0, 'YXZ');
    if ((miniT += dt) > 0.1) { miniT = 0; if (!V) drawMini(); drawMap(); }
  } else controls.update();
  composer ? composer.render(dt) : renderer.render(scene, camera);
  if (labelGroup.visible) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(labelScene, camera); renderer.autoClear = true; }
  if (first) { first = false; $('#loading').classList.add('done'); if (params.get('shot')) $('#loading').remove(); }
});
if (params.get('selftest')) {
  // 每戶從玄關走到每個房間，確認門都通
  let bad = 0;
  for (const grid of [F.blocked, F.blockedBare]) { walker.setBlocked(grid);
  for (const [n, u] of Object.entries(plan.units)) for (const id of u.spaces) {
    const sp = plan.spaces[id]; if (sp.kind === 'ac') continue;
    walker.place(...u.spawn); const p = walker.findPath(sp.cx, sp.cy);
    if (!p) { bad++; console.log('UNREACHABLE', n, sp.type); }
  } }
  walker.setBlocked(state.finish === 'bare' ? F.blockedBare : F.blocked);
  for (const V0 of Object.values(venues)) {
    const V = ensureVenue(V0), w = V.walker;
    for (const sp of V.plan.spaces.slice(1)) if (sp.walk) { w.place(...V.spawn);
      let t = null; const g = V.plan.g; for (let y = g.y0; y < g.y0 + g.h && !t; y += 4) for (let x = g.x0; x < g.x0 + g.w && !t; x += 4) if (V.plan.id(x, y) === sp.id && w.ok(x, y)) t = [x, y];   // 該空間裡任一可站的格子
      if (!t || !w.findPath(...t)) { bad++; console.log('UNREACHABLE venue', V.key, sp.type); } }
    for (const st of V.stops) { w.place(...V.spawn); const [x, y] = w.nearestFree(...st.p); if (Math.hypot(x - st.p[0], y - st.p[1]) > 10 || !w.findPath(...st.p)) { bad++; console.log('UNREACHABLE venue stop', V.key, st.name); } }
    w.place(...V.spawn);
  }
  console.log('SELFTEST done, unreachable =', bad);
}
window.__app = { state, plan, walker, venues, W, setMode, selectUnit, setFloor, selectTower, setFinish, camera, controls, city };
