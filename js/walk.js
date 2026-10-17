import { S, GX0, GY0, GW, GH, toX, toZ } from './plan.js';

// 第一人稱漫遊：位置用平面 px，碰撞與尋路都在格子上做
const R = 4;                      // 人的半徑 ≈ 0.2m（1px＝5cm）
const SPEED = 1.3 / S;            // px/s
export const FACE_YAW = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

export class Walker {
  constructor(plan, blocked) {
    this.plan = plan;
    const g = plan.g || { x0: GX0, y0: GY0, w: GW, h: GH };          // 格子範圍：預設單層，公設基地場景另給
    this.G = g;
    this.x = 0; this.y = 0; this.yaw = 0; this.pitch = -0.05;
    this.keys = {}; this.joy = { x: 0, y: 0 };
    this.path = null; this.arrive = null; this.tour = null; this.onRoom = null; this.room = 0; this.mirror = 1;
    this.cache = new Map();
    this.setBlocked(blocked);
  }
  // 可站立格＝阻擋格膨脹 R（毛胚／樣品屋各一份，算過就快取）
  setBlocked(blocked) {
    if (this.cache.has(blocked)) { this.free = this.cache.get(blocked); return; }
    const tmp = new Uint8Array(this.G.w * this.G.h), free = new Uint8Array(this.G.w * this.G.h);
    for (let y = 0; y < this.G.h; y++) for (let x = 0; x < this.G.w; x++) {
      let b = 0; for (let k = -R; k <= R && !b; k++) { const xx = x + k; if (xx < 0 || xx >= this.G.w || blocked[y * this.G.w + xx]) b = 1; }
      tmp[y * this.G.w + x] = b;
    }
    for (let y = 0; y < this.G.h; y++) for (let x = 0; x < this.G.w; x++) {
      let b = 0; for (let k = -R; k <= R && !b; k++) { const yy = y + k; if (yy < 0 || yy >= this.G.h || tmp[yy * this.G.w + x]) b = 1; }
      free[y * this.G.w + x] = !b;
    }
    this.free = free; this.cache.set(blocked, free);
    if (this.x && !this.ok(this.x, this.y)) [this.x, this.y] = this.nearestFree(this.x, this.y);
  }
  ok(x, y) { x = Math.round(x) - this.G.x0; y = Math.round(y) - this.G.y0; return x >= 0 && y >= 0 && x < this.G.w && y < this.G.h && this.free[y * this.G.w + x] === 1; }
  nearestFree(x, y, sameRoom = true) {
    x = Math.round(x); y = Math.round(y);
    const room = sameRoom ? this.plan.id(x, y) : 0;
    for (let r = 0; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (this.ok(x + dx, y + dy) && (!room || this.plan.id(x + dx, y + dy) === room)) return [x + dx, y + dy];
    }
    if (room) return this.nearestFree(x, y, false);
    return [x, y];
  }
  place(x, y, yaw) { [this.x, this.y] = this.nearestFree(x, y); if (yaw !== undefined) this.yaw = yaw; this.path = null; this.arrive = null; this.checkRoom(); }

  // BFS 尋路（2px 一格），再用視線檢查拉直
  findPath(tx, ty) {
    const st = 1, w = Math.ceil(this.G.w / st), h = Math.ceil(this.G.h / st);
    const cell = (x, y) => [Math.round((x - this.G.x0) / st), Math.round((y - this.G.y0) / st)];
    const okc = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h && this.ok(this.G.x0 + cx * st, this.G.y0 + cy * st);
    const [sx, sy] = cell(this.x, this.y), [ex, ey] = cell(...this.nearestFree(tx, ty));
    const prev = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h);
    let qh = 0, qt = 0; const s0 = sy * w + sx; prev[s0] = s0; q[qt++] = s0;
    const goal = ey * w + ex;
    while (qh < qt) {
      const c = q[qh++]; if (c === goal) break;
      const cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * w + nx;
        if (!okc(nx, ny) || prev[n] !== -1) continue;
        if (dx && dy && (!okc(cx + dx, cy) || !okc(cx, cy + dy))) continue;
        prev[n] = c; q[qt++] = n;
      }
    }
    let end = goal;
    if (prev[goal] === -1) {                 // 目的地在走不進去的死角（例如檯面與窗之間）：改去走得到的格子裡離目的地最近的
      let bd = Infinity;
      for (let i = 0; i < qt; i++) { const c = q[i], d = Math.hypot(c % w - ex, ((c / w) | 0) - ey); if (d < bd) { bd = d; end = c; } }
      if (bd > 40) return null;              // 差太遠（> 2m）就當作走不到
    }
    const pts = [];
    for (let c = end; c !== s0; c = prev[c]) pts.push([this.G.x0 + (c % w) * st, this.G.y0 + ((c / w) | 0) * st]);
    pts.reverse();
    const out = []; let from = [this.x, this.y], i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.los(from, pts[j])) j--;
      out.push(pts[j]); from = pts[j]; i = j + 1;
    }
    return out;
  }
  los(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d);
    for (let i = 1; i <= n; i++) if (!this.ok(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) return false;
    return true;
  }
  // arrive：抵達後轉向 { yaw, pitch }（看景、進房間面窗）
  goTo(x, y, arrive = null) { this.tour = null; this.path = this.findPath(x, y); this.arrive = this.path ? arrive : null; return this.path; }

  startTour(spaceIds, onDone) {
    const order = ['客餐廳', '廚房', '陽台', '主臥室', '主浴', '臥室', '客浴', '工作陽台'];
    const sp = spaceIds.map(i => this.plan.spaces[i]).filter(s => s.kind !== 'ac')
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    this.tour = { stops: sp, i: -1, wait: 0, onDone };
    this.nextStop();
  }
  nextStop() {
    const t = this.tour; t.i++;
    if (t.i >= t.stops.length) { const d = t.onDone; this.tour = null; d && d(); return; }
    const s = t.stops[t.i];
    this.path = this.findPath(s.cx, s.cy);
    t.wait = 0; t.look = null;
  }

  checkRoom() {
    const id = this.plan.id(this.x, this.y);
    if (id && id !== this.room) { this.room = id; this.onRoom && this.onRoom(this.plan.spaces[id]); }
  }

  update(dt) {
    let mx = 0, my = 0;
    const k = this.keys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) - this.joy.y;
    const side = ((k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + this.joy.x) * this.mirror;
    const turn = (k.ArrowLeft || k.KeyQ ? 1 : 0) - (k.ArrowRight || k.KeyE ? 1 : 0);
    if (turn) this.yaw += turn * 1.6 * dt * this.mirror;
    const sp = SPEED * (k.ShiftLeft || k.ShiftRight ? 1.8 : 1);
    if (Math.abs(fwd) > 0.05 || Math.abs(side) > 0.05) {
      this.path = null; this.arrive = null; if (this.tour) this.tour = null;
      const f = Math.min(1, Math.hypot(fwd, side));
      const a = Math.atan2(side, fwd);
      mx = (-Math.sin(this.yaw) * Math.cos(a) + Math.cos(this.yaw) * Math.sin(a)) * sp * f * dt;
      my = (-Math.cos(this.yaw) * Math.cos(a) - Math.sin(this.yaw) * Math.sin(a)) * sp * f * dt;
    } else if (this.path && this.path.length) {
      const [tx, ty] = this.path[0], dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      const step = SPEED * 0.9 * dt;
      if (d <= step) { this.x = tx; this.y = ty; this.path.shift(); }
      else { mx = dx / d * step; my = dy / d * step; }
      const want = Math.atan2(-dx, -dy);
      this.yaw += angDiff(want, this.yaw) * Math.min(1, dt * 4);
      this.pitch += (-0.05 - this.pitch) * Math.min(1, dt * 3);
    } else if (this.arrive) {
      const a = this.arrive, f = Math.min(1, dt * 4);
      this.yaw += angDiff(a.yaw, this.yaw) * f;
      if (a.pitch !== undefined) this.pitch += (a.pitch - this.pitch) * f;
      if (Math.abs(angDiff(a.yaw, this.yaw)) < 0.003) this.arrive = null;
    } else if (this.tour) {
      // 到點後環顧一下再前往下一間
      const t = this.tour; t.wait += dt;
      if (t.look === null) t.look = this.yaw;
      this.yaw = t.look + Math.sin(t.wait / 3.2 * Math.PI) * 0.9;
      if (t.wait > 3.2) this.nextStop();
    }
    if (mx || my) {
      // 被擋住時：先試著往兩側偏一點（過門時會順著門框滑進去），再退而沿牆滑動
      const tries = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
      const hit = tries.find(a => { const c = Math.cos(a), s = Math.sin(a); return this.ok(this.x + (mx * c - my * s) * c, this.y + (mx * s + my * c) * c); });
      if (hit !== undefined) { const c = Math.cos(hit), s = Math.sin(hit); this.x += (mx * c - my * s) * c; this.y += (mx * s + my * c) * c; }
      else if (this.ok(this.x + mx, this.y)) this.x += mx;
      else if (this.ok(this.x, this.y + my)) this.y += my;
      this.checkRoom();
    }
  }
  apply(camera, floorY) {
    camera.position.set(toX(this.x), floorY + 1.58, toZ(this.y));
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
export const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
