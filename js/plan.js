// 平面資料：依計畫書圖 9-27（九至十四層平面）與圖 9-29（面積計算，公分）以公尺描繪
// x：A1 西側外牆＝0 往東；y：A2 北側外牆＝0 往南。全棟 33.6m × 22.6m，中心 (16.8, 11.3)
// 內部格子 1px＝5cm。只描左上象限（A1 角間、A2 中間戶），其餘六戶鏡射；核心筒依原圖。
import { SCHEMES } from './schemes.js';
export const S = 0.05;
const P = m => Math.round(40 + m / S);                 // 公尺 → 格子 px
export const CX = P(16.8), CY = P(11.3);               // 平面中心＝世界原點
export const GX0 = 10, GY0 = 4, GW = 740, GH = 532;
const GX0_ = GX0, GY0_ = GY0, GW_ = GW, GH_ = GH;
export const FLOOR_H = 3.2, CEIL_H = 2.8;
export const toX = x => (x - CX) * S, toZ = y => (y - CY) * S;
export const toPX = X => X / S + CX, toPY = Z => Z / S + CY;
export const mToPX = P;

const KINDS = { 陽台: 'bal', 工作陽台: 'bal', 設備平台: 'ac', 梯廳: 'lobby', 電梯: 'core', 樓梯: 'core', 排煙室: 'core', 管道間: 'core' };
export const kindOf = t => KINDS[t] || 'room';

// 開口：o=h 水平線(at=y, c=x中心) / v 垂直線(at=x, c=y中心)；w 寬；單位公尺
// k: door 門 / open 開口 / slide 落地拉門 / win 窗 / high 高窗 / elev 電梯門
// sw 門扇開向（+1 往座標增加側），hg 鉸鏈端（-1 在座標小的一端）
export const TEMPLATES = {
  corner: {
    label: '3房2廳2衛', size: '42～43 坪', spawn: [7.65, 10.7], face: 'up',
    rooms: [
      { t: '客餐廳', sp: 'pub', r: [3.9, 3.9, 8.55, 8.565] },     // 走道併入公共空間
      { t: '客餐廳', sp: 'pub', r: [5.3, 1.84, 8.55, 8.5] },
      { t: '玄關', sp: 'pub', r: [7.2, 8.5, 8.55, 9.6] },
      { t: '玄關', sp: 'pub', r: [7.2, 9.6, 8.1, 11.3] },
      { t: '陽台', sp: 'bal1', r: [5.3, 0.54, 8.55, 1.84] },
      { t: '主臥室', sp: 'mb', r: [0, 0.615, 2.95, 4.95] },
      { t: '主臥室', sp: 'mb', r: [2.95, 3.9, 3.9, 4.95] },        // L 形主臥的入口前廳：主浴門開在這裡（主浴在主臥門內）
      { t: '臥室', sp: 'b1', r: [2.95, 0.615, 5.3, 3.9] },
      { t: '主浴', sp: 'mbath', r: [0, 4.95, 3.9, 6.75] },
      { t: '廚房', sp: 'kit', r: [0, 6.75, 4.2, 8.565] },
      { t: '工作陽台', sp: 'bal2', r: [0, 8.565, 2.05, 11.3] },
      { t: '臥室', sp: 'b2', r: [2.05, 8.565, 5.27, 11.3] },
      { t: '客浴', sp: 'bath', r: [5.27, 8.5, 7.2, 11.3] },
    ],
    openings: [
      { o: 'v', at: 8.1, c: 10.45, w: 1.0, k: 'door', sw: -1, hg: 1 },
      { o: 'v', at: 3.9, c: 4.4, w: 0.85, k: 'door', sw: -1, hg: -1 },   // 主臥門：前廳靠客廳那側
      { o: 'h', at: 3.9, c: 4.75, w: 0.85, k: 'door', sw: -1, hg: 1 },
      { o: 'h', at: 4.95, c: 3.45, w: 0.75, k: 'door', sw: 1, hg: 1 },
      { o: 'v', at: 4.2, c: 7.85, w: 1.1, k: 'open' },
      { o: 'h', at: 8.565, c: 4.75, w: 0.85, k: 'door', sw: 1, hg: 1 },
      { o: 'h', at: 8.5, c: 6.2, w: 0.75, k: 'door', sw: 1, hg: -1 },
      { o: 'h', at: 8.565, c: 1.55, w: 0.8, k: 'door', sw: 1, hg: -1 },
      { o: 'h', at: 1.84, c: 6.9, w: 2.6, k: 'slide' },
      { o: 'v', at: 0, c: 2.8, w: 1.6, k: 'win' },
      { o: 'h', at: 0.615, c: 4.1, w: 1.4, k: 'win' },
      { o: 'v', at: 0, c: 5.85, w: 0.6, k: 'high' },
      { o: 'v', at: 0, c: 7.25, w: 0.8, k: 'win' },
      { o: 'v', at: 2.05, c: 9.95, w: 1.4, k: 'win' },
    ],
    furniture: [
      // 客餐廳
      { f: 'rug', x: 7.1, y: 3.6, face: 'left', a: [2.2, 1.7] },
      { f: 'sofa', x: 8.1, y: 3.6, face: 'left', a: [2.1] },
      { f: 'coffeeTable', x: 7.1, y: 3.6, face: 'left' },
      { f: 'tvUnit', x: 5.5, y: 2.9, face: 'right', a: [1.8] },
      { f: 'art', x: 8.53, y: 3.6, face: 'left', a: [1.5, 3] },
      { f: 'dining', x: 6.9, y: 6.3, face: 'left', a: [1.5, 0.85] },
      { f: 'pendant', x: 6.9, y: 6.3 },
      { f: 'shoeCabinet', x: 8.36, y: 7.6, face: 'left', a: [1.0] },
      { f: 'plant', x: 8.25, y: 2.15 },
      { f: 'floorLamp', x: 8.3, y: 5.0 },
      // 廚房
      { f: 'kitchen', x: 2.3, y: 7.05, face: 'down', a: [3.0] },
      { f: 'fridge', x: 0.38, y: 8.1, face: 'right' },
      // 主臥
      { f: 'rug', x: 1.5, y: 2.2, face: 'down', a: [2.2, 1.6] },
      { f: 'bed', x: 1.5, y: 1.7, face: 'down', a: [1.8, 2.0] },
      { f: 'nightstand', x: 0.33, y: 0.85, face: 'down', a: [0.4] },     // 床頭板 1.9m，兩側只剩 44cm
      { f: 'nightstand', x: 2.67, y: 0.85, face: 'down', a: [0.4] },
      { f: 'wardrobe', x: 1.2, y: 4.65, face: 'up', a: [2.0] },
      { f: 'art', x: 1.5, y: 0.64, face: 'down', a: [0.5, 1] },
      // 臥室
      { f: 'bed', x: 4.64, y: 1.6, face: 'down', a: [1.06, 1.9] },        // 東側貼隔間牆，不凸進牆
      { f: 'desk', x: 3.52, y: 0.92, face: 'down', a: [1.0] },
      { f: 'wardrobe', x: 3.6, y: 3.6, face: 'up', a: [1.2] },
      // 主浴
      { f: 'tub', x: 0.4, y: 5.85, face: 'right' },
      { f: 'vanity', x: 1.6, y: 5.2, face: 'down', a: [1.0] },
      { f: 'toilet', x: 2.5, y: 6.4, face: 'up' },
      // 臥室B
      { f: 'bed', x: 4.25, y: 10.6, face: 'left', a: [1.06, 1.9] },
      { f: 'desk', x: 2.35, y: 10.0, face: 'right', a: [1.2] },          // 窗下書桌；衣櫃移到門邊，開門不碰書桌
      { f: 'wardrobe', x: 3.72, y: 8.86, face: 'down', a: [1.2] },
      // 客浴
      { f: 'toilet', x: 6.6, y: 10.95, face: 'up' },
      { f: 'vanity', x: 5.52, y: 9.4, face: 'right', a: [0.8] },
      { f: 'shower', x: 5.75, y: 10.8, face: 'up' },                    // 入口朝洗手台
      // 陽台
      { f: 'washer', x: 1.69, y: 10.95, face: 'left' },                 // 靠東側牆（原本背靠玻璃欄杆）
      { f: 'plant', x: 0.35, y: 10.95 },
      { f: 'laundrySink', x: 0.42, y: 8.88, face: 'down' },              // 工作陽台：洗衣槽、熱水器靠廚房牆，曬衣架靠外側
      { f: 'waterHeater', x: 0.93, y: 8.63, face: 'down' },
      { f: 'dryingRack', x: 1.02, y: 10.9, face: 'down', a: [1.7] },
      { f: 'bistro', x: 6.4, y: 1.2 },
      { f: 'plant', x: 8.2, y: 0.9 },
      { f: 'sconce', x: 8.38, y: 1.84, face: 'up' },
    ],
  },
  mid: {
    label: '2房2廳2衛', size: '26～28 坪', spawn: [9.4, 9.1], face: 'up',
    rooms: [
      { t: '客餐廳', sp: 'pub', r: [8.55, 0, 11.5, 6.65] },
      { t: '玄關', sp: 'pub', r: [8.55, 6.65, 10.3, 9.6] },
      { t: '走道', sp: 'pub', r: [11.5, 4.15, 14.1, 4.9] },
      { t: '陽台', sp: 'bal1', r: [11.5, -0.9, 14.1, 1.24] },
      { t: '設備平台', sp: 'ac', r: [14.1, 0, 16.8, 1.24] },
      { t: '臥室', sp: 'b1', r: [11.5, 1.24, 14.1, 4.15] },
      { t: '主臥室', sp: 'mb', r: [14.1, 1.24, 16.8, 4.15] },
      { t: '主臥室', sp: 'mb', r: [14.1, 4.15, 16.8, 4.9] },       // 主臥下方那段併入主臥，主浴門開在這裡（主浴在主臥門內）
      { t: '客浴', sp: 'bath', r: [11.5, 4.9, 14.1, 6.65] },
      { t: '主浴', sp: 'mbath', r: [14.1, 4.9, 16.8, 6.65] },
    ],
    openings: [
      { o: 'h', at: 9.6, c: 9.4, w: 1.0, k: 'door', sw: -1, hg: -1 },
      { o: 'h', at: 4.15, c: 13.5, w: 0.85, k: 'door', sw: -1, hg: 1 },
      { o: 'v', at: 14.1, c: 4.525, w: 0.75, k: 'door', sw: 1, hg: -1 },  // 主臥門：走道盡頭
      { o: 'h', at: 4.9, c: 12.0, w: 0.75, k: 'door', sw: 1, hg: -1 },
      { o: 'h', at: 4.9, c: 16.2, w: 0.75, k: 'door', sw: 1, hg: 1 },
      { o: 'v', at: 11.5, c: 0.62, w: 1.1, k: 'slide' },
      { o: 'h', at: 0, c: 10.0, w: 2.0, k: 'win' },
      { o: 'h', at: 1.24, c: 12.8, w: 1.4, k: 'win' },
      { o: 'h', at: 1.24, c: 15.45, w: 1.4, k: 'win' },
    ],
    furniture: [
      { f: 'rug', x: 9.9, y: 2.1, face: 'right', a: [2.0, 1.6] },
      { f: 'sofa', x: 9.0, y: 2.1, face: 'right', a: [2.0] },
      { f: 'coffeeTable', x: 9.95, y: 2.1, face: 'right' },
      { f: 'tvUnit', x: 11.3, y: 2.5, face: 'left', a: [1.6] },
      { f: 'art', x: 8.57, y: 2.1, face: 'right', a: [1.2, 2] },
      { f: 'kitchen', x: 8.85, y: 5.3, face: 'right', a: [2.4] },
      { f: 'fridge', x: 8.93, y: 3.65, face: 'right' },
      { f: 'dining', x: 11.12, y: 5.6, face: 'left', a: [1.2, 0.75, 1] },
      { f: 'pendant', x: 11.12, y: 5.6 },
      { f: 'shoeCabinet', x: 10.11, y: 7.8, face: 'left', a: [1.0] },
      { f: 'plant', x: 8.95, y: 0.4 },
      // 臥室
      { f: 'bed', x: 13.55, y: 2.2, face: 'down', a: [1.06, 1.9] },
      { f: 'desk', x: 11.8, y: 2.1, face: 'right', a: [1.1] },
      { f: 'wardrobe', x: 11.8, y: 3.5, face: 'right', a: [1.0] },
      // 主臥
      { f: 'rug', x: 15.4, y: 2.45, face: 'left', a: [2.0, 1.4] },
      // 主臥淨寬只有 2.5m：衣櫃沿著通往主浴的走道那一側擺（背對走道、門朝房內），床頭靠東牆、一側靠窗牆，
      // 衣櫃前留 60cm、床尾留 60cm；從走道東端進房
      { f: 'bed', x: 15.74, y: 2.22, face: 'left', a: [1.5, 1.9] },
      { f: 'nightstand', x: 16.53, y: 3.25, face: 'left', a: [0.4] },
      { f: 'wardrobe', x: 14.92, y: 3.86, face: 'up', a: [1.5] },
      { f: 'art', x: 16.78, y: 2.22, face: 'left', a: [0.9, 2] },
      // 衛浴
      // 2.5×1.6m 小浴室：淋浴佔一端整個深度、洗手台在門與淋浴間之間、馬桶在對面牆（原本洗手台前只剩 22cm 就碰到淋浴間）
      { f: 'vanity', x: 12.82, y: 5.15, face: 'down', a: [0.8] },
      { f: 'toilet', x: 12.5, y: 6.3, face: 'up' },
      { f: 'shower', x: 13.64, y: 5.76, face: 'left', a: [1.58, 0.8] },      // 浴室淨深 1.59m
      { f: 'vanity', x: 15.4, y: 5.15, face: 'down', a: [0.8] },
      { f: 'toilet', x: 15.95, y: 6.3, face: 'up' },
      { f: 'shower', x: 14.56, y: 5.76, face: 'right', a: [1.58, 0.8] },
      // 陽台
      // 洗衣機、洗衣槽靠設備平台那道牆（原本洗衣機背靠玻璃欄杆）；熱水器掛在臥室窗旁的牆上
      { f: 'washer', x: 13.74, y: 0.88, face: 'left' },
      { f: 'laundrySink', x: 13.79, y: 0.3, face: 'left', a: [0.5] },
      { f: 'waterHeater', x: 13.78, y: 1.18, face: 'up' },
      { f: 'dryingRack', x: 12.55, y: -0.5, face: 'down', a: [1.7] },
      { f: 'plant', x: 11.85, y: -0.5 },
      { f: 'sconce', x: 11.5, y: -0.45, face: 'right' },
      { f: 'acUnit', x: 14.7, y: 0.85, face: 'up' },                     // 出風朝外（原本朝著臥室牆吹）
      { f: 'acUnit', x: 15.8, y: 0.85, face: 'up' },
    ],
  },
};

export const QUADS = [
  { mx: 0, my: 0, corner: 'A1', mid: 'A2' },
  { mx: 1, my: 0, corner: 'A5', mid: 'A3' },
  { mx: 1, my: 1, corner: 'A6', mid: 'A7' },
  { mx: 0, my: 1, corner: 'A9', mid: 'A8' },
];
export const UNIT_ORDER = ['A1', 'A2', 'A3', 'A5', 'A9', 'A8', 'A7', 'A6'];

const CORE = [
  { t: '梯廳', sp: 'lobby', r: [10.3, 9.6, 23.3, 13.0] },
  { t: '梯廳', sp: 'lobby', r: [8.1, 9.6, 10.3, 13.0] },
  { t: '梯廳', sp: 'lobby', r: [23.3, 9.6, 25.5, 13.0] },
  { t: '電梯', sp: 'e1', r: [10.3, 6.65, 13.0, 9.6] },
  { t: '排煙室', sp: 'v1', r: [13.0, 6.65, 16.1, 9.6] },
  { t: '電梯', sp: 'e2', r: [16.1, 6.65, 18.4, 9.6] },
  { t: '樓梯', sp: 's1', r: [18.4, 6.65, 21.4, 9.6] },
  { t: '排煙室', sp: 'v2', r: [21.4, 6.65, 23.3, 9.6] },
  { t: '電梯', sp: 'e3', r: [10.3, 13.0, 13.0, 15.95] },
  { t: '排煙室', sp: 'v3', r: [13.0, 13.0, 16.3, 15.95] },
  // 對照計畫書：南側只有一部電梯，排煙室東邊是管道間（沿梯廳一長條），樓梯在管道間後面
  { t: '管道間', sp: 'p2', r: [16.3, 13.0, 23.3, 13.7] },
  { t: '樓梯', sp: 's2', r: [16.3, 13.7, 23.3, 15.95] },
];
const CORE_OPENINGS = [
  { o: 'h', at: 9.6, c: 11.65, w: 0.9, k: 'elev' },
  { o: 'h', at: 9.6, c: 17.25, w: 0.9, k: 'elev' },
  { o: 'h', at: 9.6, c: 14.5, w: 0.9, k: 'door', sw: -1, hg: -1 },
  // 特別安全梯：梯廳 → 排煙室（附室）→ 樓梯，門都往避難方向開
  { o: 'h', at: 9.6, c: 22.35, w: 0.9, k: 'door', sw: -1, hg: 1 },
  { o: 'v', at: 21.4, c: 8.9, w: 0.9, k: 'door', sw: 1, hg: 1 },     // 梯間太短，門扇往附室開才不會打到踏階
  { o: 'h', at: 13.0, c: 11.65, w: 0.9, k: 'elev' },
  { o: 'h', at: 13.0, c: 14.6, w: 0.9, k: 'door', sw: 1, hg: -1 },
  { o: 'v', at: 16.3, c: 15.2, w: 0.9, k: 'door', sw: 1, hg: 1 },
];
// 外牆角柱（左上象限，鏡射；白灰色框架）
const COLS_M = [[-0.45, 0.2, 0.25, 0.95], [8.2, -0.3, 8.9, 0.4], [16.45, -0.3, 17.15, 0.4]];
export const COLS = COLS_M.map(r => r.map(P));
export const FOOTPRINT = [-0.6, -1.05, 34.2, 23.65].map(P);
export const CORE_BOX = [10.3, 6.65, 23.3, 15.95].map(P);

const mr = (r, q) => {
  let [x1, y1, x2, y2] = r;
  if (q.mx) [x1, x2] = [2 * CX - x2, 2 * CX - x1];
  if (q.my) [y1, y2] = [2 * CY - y2, 2 * CY - y1];
  return [x1, y1, x2, y2];
};
const mp = (x, y, q) => [q.mx ? 2 * CX - x : x, q.my ? 2 * CY - y : y];
const mface = (f, q) => {
  if (q.mx && (f === 'left' || f === 'right')) return f === 'left' ? 'right' : 'left';
  if (q.my && (f === 'up' || f === 'down')) return f === 'up' ? 'down' : 'up';
  return f;
};
function mo(o, q) {
  const n = { ...o, sw: o.sw || 1, hg: o.hg || 1 };
  if (o.o === 'h') {
    if (q.mx) { n.c = 2 * CX - o.c; n.hg = -n.hg; }
    if (q.my) { n.at = 2 * CY - o.at; n.sw = -n.sw; }
  } else {
    if (q.my) { n.c = 2 * CY - o.c; n.hg = -n.hg; }
    if (q.mx) { n.at = 2 * CX - o.at; n.sw = -n.sw; }
  }
  return n;
}

const pxo = o => ({ ...o, at: P(o.at), c: 40 + o.c / S, w: o.w / S });

// choice：{ corner: 'c2', mid: 'm1' } 客變方案（schemes.js），套在樣板複本上
export function resolveTemplate(kind, id) {
  const t = structuredClone(TEMPLATES[kind]);
  SCHEMES[kind].find(s => s.id === id)?.apply(t);
  return t;
}
export function buildPlan(choice = {}) {
  const tpl = {};
  for (const kind of Object.keys(TEMPLATES)) tpl[kind] = resolveTemplate(kind, choice[kind]);
  const ids = new Int32Array(GW * GH);
  const spaces = [null], keyIdx = new Map(), openings = new Map(), allOpenings = [];
  const units = {}, furniture = [];
  let uid = 0;
  const idx = (x, y) => (y - GY0) * GW + (x - GX0);
  const space = (key, info) => {
    let id = keyIdx.get(key);
    if (!id) { id = spaces.length; spaces.push({ id, key, ...info, cells: 0, sx: 0, sy: 0 }); keyIdx.set(key, id); }
    return id;
  };
  const paint = (r, id) => {
    const [x1, y1, x2, y2] = r.map(Math.round);
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) ids[idx(x, y)] = id;
  };
  const addOpening = (o, unit) => {
    const op = { ...o, uid: ++uid, unit, a: Math.round(o.c - o.w / 2), b: Math.round(o.c + o.w / 2) };
    for (let t = op.a; t < op.b; t++) openings.set(`${o.o}${o.at},${t}`, op);
    allOpenings.push(op);
  };

  for (const q of QUADS) for (const kind of ['corner', 'mid']) {
    const T = tpl[kind], unit = q[kind];
    const u = units[unit] = { name: unit, kind, label: T.label, size: T.size, spaces: [], spawn: mp(P(T.spawn[0]), P(T.spawn[1]), q), face: mface(T.face, q) };
    for (const r of T.rooms) {
      const id = space(`${unit}:${r.sp}`, { unit, type: r.t, kind: kindOf(r.t) });
      if (!u.spaces.includes(id)) u.spaces.push(id);
      paint(mr(r.r.map(P), q), id);
    }
    for (const o of T.openings) addOpening(mo(pxo(o), q), unit);
    for (const f of T.furniture) {
      const [x, y] = mp(P(f.x), P(f.y), q);
      furniture.push({ ...f, x, y, face: mface(f.face || 'down', q), unit });
    }
  }
  for (const r of CORE) paint(r.r.map(P), space(`core:${r.sp}`, { unit: null, type: r.t, kind: kindOf(r.t) }));
  for (const o of CORE_OPENINGS) addOpening({ sw: 1, hg: 1, ...pxo(o) }, null);

  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const id = ids[y * GW + x];
    if (id) {
      const s = spaces[id]; s.cells++; s.sx += x + GX0; s.sy += y + GY0;
      s.bx1 = Math.min(s.bx1 ?? 1e9, x); s.bx2 = Math.max(s.bx2 ?? -1, x); s.by1 = Math.min(s.by1 ?? 1e9, y); s.by2 = Math.max(s.by2 ?? -1, y);
    }
  }
  for (const s of spaces.slice(1)) {
    s.cx = s.sx / s.cells; s.cy = s.sy / s.cells; s.area = s.cells * S * S;
    // 矩形房間才標長寬（L 形的客餐廳不標）
    const bw = s.bx2 - s.bx1 + 1, bh = s.by2 - s.by1 + 1;
    if (s.cells >= bw * bh * 0.97) s.dims = [bw * S, bh * S];
  }
  for (const u of Object.values(units)) {
    u.indoor = 0; u.balcony = 0;
    for (const id of u.spaces) { const s = spaces[id]; if (s.kind === 'room') u.indoor += s.area; else u.balcony += s.area; }
  }
  const id = (x, y) => (x < GX0 || y < GY0 || x >= GX0 + GW || y >= GY0 + GH) ? 0 : ids[idx(x | 0, y | 0)];
  return { ids, spaces, openings, allOpenings, units, furniture, id, colsAll: QUADS.flatMap(q => COLS.map(c => mr(c, q))) };
}

// 把同一空間的格子合併成矩形（給地板、天花、量體用）
export function decompose(plan, filter = () => true) {
  const { ids } = plan, { x0: GX0, y0: GY0, w: GW, h: GH } = plan.g || { x0: GX0_, y0: GY0_, w: GW_, h: GH_ }, used = new Uint8Array(GW * GH), rects = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x, id = ids[i];
    if (!id || used[i] || !filter(plan.spaces[id])) continue;
    let w = 1; while (x + w < GW && ids[i + w] === id && !used[i + w]) w++;
    let h = 1;
    grow: while (y + h < GH) {
      for (let k = 0; k < w; k++) { const j = (y + h) * GW + x + k; if (ids[j] !== id || used[j]) break grow; }
      h++;
    }
    for (let yy = 0; yy < h; yy++) used.fill(1, (y + yy) * GW + x, (y + yy) * GW + x + w);
    rects.push({ id, x1: x + GX0, y1: y + GY0, x2: x + GX0 + w, y2: y + GY0 + h });
  }
  return rects;
}

// 牆線段：比對相鄰格的空間，合併成連續段
export function wallSegments(plan) {
  const { spaces, openings } = plan, segs = [];
  const classify = (a, b) => {
    if (a === b) return null;
    const A = spaces[a], B = spaces[b];
    if (!A || !B) { const s = A || B; return (s.kind === 'bal' || s.kind === 'ac') ? 'rail' : 'ext'; }
    if (A.unit !== B.unit) return 'party';
    if (A.key === B.key) return null;
    return 'int';
  };
  const scan = (o, lineFrom, lineTo, runFrom, runTo, cellA, cellB) => {
    for (let at = lineFrom; at < lineTo; at++) {
      let cur = null;
      for (let t = runFrom; t < runTo; t++) {
        const a = cellA(at, t), b = cellB(at, t), cls = classify(a, b);
        let op = null;
        if (cls && cls !== 'rail') op = openings.get(`${o}${at},${t}`) || null;
        const k = cls ? cls + '|' + (op ? op.uid : '') : null;
        if (cur && cur.k === k) cur.t2 = t + 1;
        else {
          if (cur) segs.push(cur);
          cur = k ? { o, at, t1: t, t2: t + 1, cls, op, k, out: !spaces[a] ? -1 : !spaces[b] ? 1 : 0, a, b } : null;
        }
      }
      if (cur) segs.push(cur);
    }
  };
  scan('h', GY0 + 1, GY0 + GH, GX0, GX0 + GW, (y, x) => plan.id(x, y - 1), (y, x) => plan.id(x, y));
  scan('v', GX0 + 1, GX0 + GW, GY0, GY0 + GH, (x, y) => plan.id(x - 1, y), (x, y) => plan.id(x, y));
  return segs;
}
