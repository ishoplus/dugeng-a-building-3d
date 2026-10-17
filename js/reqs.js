// 客變需求單：列出需求、標示目前方案做到沒有、可增刪修改，存到伺服器（/api/req，見 scripts/serve.py）
// 修改權限：建立時伺服器回傳 key，只存在建立者的瀏覽器（localStorage），別人拿到連結只能看
import { SCHEMES } from './schemes.js';

// 目前提過的需求（預設內容）；id 用來比對方案有沒有做到
export const CATALOG = [
  { id: 'open-kitchen', text: '開放式廚房' },
  { id: 'island', text: '中島' },
  { id: 'study', text: '書房' },
  { id: 'mbath4', text: '主衛乾濕分離四件套（浴缸、淋浴、面盆、馬桶）' },
  { id: 'gbath3', text: '客衛乾濕分離三件套（淋浴、面盆、馬桶）' },
  { id: 'laundry', text: '家事間（洗烘、儲藏，和工作陽台分工）' },
  { id: 'coffee', text: '咖啡飲料吧台' },
  { id: 'bevfridge', text: '冷飲小冰箱' },
  { id: 'appliance', text: '電器櫃（氣炸鍋、微波爐、烤箱、電飯煲、電鍋）' },
  { id: 'dishwasher', text: '洗碗機' },
  { id: 'display', text: '展示櫃' },
  { id: 'storage', text: '收納空間' },
  { id: 'entry', text: '玄關' },
  { id: 'coat', text: '髒衣外套櫃' },
  { id: 'shoe', text: '鞋櫃' },
  { id: 'shoebench', text: '穿鞋凳' },
  { id: 'lsofa', text: 'L 沙發' },
  { id: 'dressing', text: '更衣化妝空間' },
];
// 各方案做到哪些
const BASE = ['entry', 'shoe'];
export const MEETS = {
  c0: BASE, c1: [...BASE, 'open-kitchen'], c2: [...BASE, 'study'], c3: [...BASE, 'dressing'],
  c4: [...BASE, 'open-kitchen', 'island', 'laundry', 'storage'],
  c5: CATALOG.map(c => c.id),
  m0: BASE, m1: [...BASE, 'study'], m2: BASE, m3: [...BASE, 'open-kitchen'],
  m4: [...BASE, 'open-kitchen', 'island', 'study', 'mbath4', 'gbath3'],
};

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = 'dugeng-req';                        // localStorage：{ mine: [{ id, key, unit, name, updated }], cur: { [unit]: id }, draft: { [unit]: doc } }
const store = () => {
  let st; try { st = JSON.parse(localStorage.getItem(LS)) || {}; } catch { st = {}; }
  st.mine ??= []; st.cur ??= {};
  for (const [k, v] of Object.entries(st)) if (/^[AB][1-9]$/.test(k) && v?.id) {   // 舊格式 { A1: { id, key } } 轉成清單
    if (!st.mine.some(r => r.id === v.id)) st.mine.push({ ...v, unit: k }); st.cur[k] ??= v.id; delete st[k];
  }
  return st;
};
const kindOf = unit => /[1569]$/.test(unit) ? 'corner' : 'mid';
const blank = unit => ({ unit, items: CATALOG.map(c => ({ ...c })), note: '', name: '' });
const save = o => localStorage.setItem(LS, JSON.stringify(o));

let ctx = null, doc = null, mine = false, shareId = null;

// ctx: { unit: 'A1'（含棟別）, kind: 'corner'|'mid', scheme: 'c5', applyScheme(id) }
export function initReqs(getCtx) {
  const q = new URLSearchParams(location.search).get('req'), sharedId = /^[0-9a-f]{8}$/.test(q || '') ? q : null;   // 只收 8 碼十六進位，其他一律忽略
  let first = true;
  const open = async () => {
    ctx = getCtx();
    const st = store();
    await load(first && sharedId || st.cur[ctx.unit] || null);
    first = false;
    $('#reqModal').classList.add('open');
  };
  document.querySelectorAll('[data-open-req]').forEach(b => b.onclick = open);
  $('#reqClose').onclick = () => $('#reqModal').classList.remove('open');
  $('#reqModal').addEventListener('pointerdown', e => { if (e.target.id === 'reqModal') $('#reqModal').classList.remove('open'); });
  if (sharedId) setTimeout(open, 1500);
}

// 載入某張需求單（id 為空＝新的一張：草稿或預設內容）
async function load(id) {
  const st = store();
  if (id && !/^[0-9a-f]{8}$/.test(id)) id = null;
  shareId = id; doc = null;
  if (id) { try { const r = await fetch('/api/req/' + id); if (r.ok) doc = await r.json(); } catch {} }
  if (!doc) { shareId = null; doc = st.draft?.[ctx.unit] || blank(ctx.unit); }
  mine = !shareId || st.mine.some(r => r.id === shareId && r.key);
  render();
}

function statusOf(it, schemeId) {
  const sc = Object.values(SCHEMES).flat().find(s => s.id === schemeId);
  if (sc?.results?.length) {                                   // Claude Code 設計的方案：照它回報的對照
    const r = sc.results.find(r => r.text === it.text); return r ? (r.done ? 'done' : 'todo') : 'custom';
  }
  if (!it.id) return 'custom';
  return (MEETS[schemeId] || []).includes(it.id) ? 'done' : 'todo';
}
const JOB = {
  queued: '已送出，等 Claude Code 接手（工作機每分鐘檢查一次）',
  working: '設計中',
  done: '設計完成',
  failed: '沒有完成',
};
function jobHTML(job, ro) {
  if (!job) return '';
  const busy = job.state === 'queued' || job.state === 'working';
  return `<div class="rjob ${job.state}">
    <b>${busy ? '<span class="spin"></span>' : ''}${JOB[job.state] || job.state}</b>
    <span>${esc(job.msg || '')}${busy ? '・通常 5～20 分鐘，可以先關掉，回來再看' : ''}</span>
    ${job.state === 'done' ? `<img src="/custom/${shareId}.png?${Math.round(job.finished || 0)}" alt=""><button id="reqView" class="primary">在 3D 裡看這個方案</button>` : ''}
    ${job.state === 'failed' && !ro ? '<span>可以調整需求後再送出一次。</span>' : ''}
  </div>`;
}
let poll = null;
function watch() {
  clearTimeout(poll);
  const busy = doc?.job && (doc.job.state === 'queued' || doc.job.state === 'working');
  if (!busy || !shareId) return;
  poll = setTimeout(async () => {
    if (!$('#reqModal').classList.contains('open')) return watch();
    try {
      const r = await fetch('/api/req/' + shareId); if (!r.ok) return watch();
      const j = await r.json(); doc.job = j.job;
      if (j.job?.state === 'done' || j.job?.state === 'failed') render();     // 完成才整個重畫（設計中不打斷使用者正在改的字）
      else if ($('#reqJob')) $('#reqJob').innerHTML = jobHTML(j.job, !mine);
    } catch {}
    watch();
  }, 15000);
}
// 哪個方案做到最多項
function best(items, kind) {
  let top = null;
  for (const s of SCHEMES[kind]) { const n = items.filter(it => it.id && (MEETS[s.id] || []).includes(it.id)).length; if (!top || n > top.n) top = { s, n }; }
  return top;
}

function render() {
  const unit = doc.unit || ctx.unit, kind = kindOf(unit), here = unit.slice(1) === ctx.unit.slice(1);
  const sc = SCHEMES[kind].find(s => s.id === ctx.schemes[kind]) || SCHEMES[kind][0];
  const items = doc.items, done = items.filter(it => statusOf(it, sc.id) === 'done').length;
  const b = best(items, kind), ro = !mine, list = store().mine;
  const missing = CATALOG.filter(c => !items.some(it => it.id === c.id));
  const label = r => `${r.name ? esc(r.name) + '・' : ''}${esc(r.unit)}・#${esc(r.id)}`;
  $('#reqBody').innerHTML = `
    <div class="rpick">
      <select id="reqPick">
        ${list.map(r => `<option value="${r.id}" ${r.id === shareId ? 'selected' : ''}>${label(r)}</option>`).join('')}
        ${shareId && !list.some(r => r.id === shareId) ? `<option value="${shareId}" selected>別人分享的・${esc(unit)}・#${shareId}</option>` : ''}
        ${!shareId ? `<option value="" selected>新需求單（${esc(ctx.unit)}，尚未儲存）</option>` : ''}
      </select>
      <button id="reqNewDoc">＋新增一張</button>
    </div>
    <p class="rmeta"><b>${esc(unit)}</b>・目前方案「${esc(sc.name)}」做到 <b>${done}</b>／${items.length} 項
      ${here && b && b.s.id !== sc.id && b.n > done ? `<button id="reqBest" class="link">改看「${esc(b.s.name)}」（做到 ${b.n} 項）</button>` : ''}</p>
    <div id="reqJob">${jobHTML(doc.job, ro)}</div>
    ${!shareId ? `<p class="note">新需求單綁定目前選的戶別 <b>${esc(ctx.unit)}</b>；要填別戶，先關掉這個視窗、在側欄換戶再新增。</p>` : ''}
    ${ro ? '<p class="note">這是別人分享的需求單，只能查看。要修改請在填寫的那台裝置上打開。</p>' : ''}
    <ul id="reqList">${items.map((it, i) => {
      const st = statusOf(it, sc.id);
      return `<li class="${st}"><i title="${st === 'done' ? '目前方案已做到' : st === 'todo' ? '目前方案還沒做到' : '新需求，待設計'}"></i>
        <input data-i="${i}" value="${esc(it.text)}" ${ro ? 'readonly' : ''}>
        <small>${st === 'done' ? '已做到' : st === 'todo' ? '未做到' : '待設計'}</small>
        ${ro ? '' : `<button data-del="${i}" title="刪除">×</button>`}</li>`;
    }).join('')}</ul>
    ${ro ? '' : `<div class="radd"><input id="reqNew" placeholder="新增需求，例如：主臥要有梳妝鏡燈" maxlength="200"><button id="reqAdd">新增</button></div>
    ${missing.length ? `<div class="rchips"><span>加回常見需求：</span>${missing.map(c => `<button data-cat="${c.id}">${esc(c.text.replace(/（.*/, ''))}</button>`).join('')}</div>` : ''}`}
    <label class="rlab">其他說明（家庭成員、作息、風格、預算）</label>
    <textarea id="reqNote" rows="3" maxlength="2000" ${ro ? 'readonly' : ''} placeholder="例如：夫妻＋1 小孩，常在家工作；喜歡木質調">${esc(doc.note || '')}</textarea>
    <label class="rlab">稱呼（選填）</label><input id="reqName" maxlength="40" value="${esc(doc.name || '')}" ${ro ? 'readonly' : ''}>
    <div class="ract">
      ${ro ? '' : '<button id="reqSave">儲存需求單</button>'}
      ${ro || ['queued', 'working'].includes(doc.job?.state) ? '' : `<button id="reqSubmit" class="primary">${doc.job ? '重新送出' : '送出'}，請 Claude 設計</button>`}
      ${shareId ? `<button id="reqCopy">複製分享連結</button>` : ''}
    </div>
    <p id="reqMsg" class="note">${shareId ? `需求單編號 ${shareId}${doc.updated ? '・最後更新 ' + new Date(doc.updated * 1000).toLocaleString('zh-TW', { hour12: false }) : ''}` : '還沒儲存：按「儲存需求單」後會產生編號與分享連結。'}</p>`;
  const sync = () => {                                     // 把畫面上的修改收回 doc（改了文字就不再算目錄裡的那一項）
    document.querySelectorAll('#reqList input').forEach(el => {
      const it = items[+el.dataset.i], t = el.value.trim();
      if (t !== it.text) { it.text = t; delete it.id; }
    });
    doc.note = $('#reqNote').value; doc.name = $('#reqName').value;
    if (mine && !shareId) { const st = store(); st.draft = { ...(st.draft || {}), [ctx.unit]: doc }; save(st); }
  };
  $('#reqBody').oninput = e => { if (!ro && e.target.id !== 'reqPick') sync(); };
  $('#reqPick').onchange = e => load(e.target.value || null);
  $('#reqNewDoc').onclick = () => { const st = store(); if (st.draft) delete st.draft[ctx.unit]; save(st); shareId = null; doc = blank(ctx.unit); mine = true; render(); };
  $('#reqBody').querySelectorAll('[data-del]').forEach(el => el.onclick = () => { sync(); doc.items.splice(+el.dataset.del, 1); render(); });
  $('#reqBody').querySelectorAll('[data-cat]').forEach(el => el.onclick = () => { sync(); doc.items.push({ ...CATALOG.find(c => c.id === el.dataset.cat) }); render(); });
  const add = () => { const t = $('#reqNew').value.trim(); if (!t) return; sync(); doc.items.push({ text: t }); render(); $('#reqNew').focus(); };
  if ($('#reqAdd')) { $('#reqAdd').onclick = add; $('#reqNew').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) add(); }; }
  if ($('#reqBest')) $('#reqBest').onclick = () => ctx.applyScheme(b.s.id);
  if ($('#reqView')) $('#reqView').onclick = () => ctx.applyScheme('r' + shareId, unit);
  if ($('#reqSubmit')) $('#reqSubmit').onclick = async () => {
    const btn = $('#reqSubmit'); btn.disabled = true;
    if (!(await doSave())) { btn.disabled = false; return; }
    const rec = store().mine.find(r => r.id === shareId);
    try {
      const r = await fetch(`/api/req/${shareId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: rec.key }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      doc.job = j.job; render();
    } catch (e) { $('#reqMsg').textContent = '送出失敗：' + e.message; btn.disabled = false; }
  };
  watch();
  if ($('#reqCopy')) $('#reqCopy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?unit=${doc.unit || ctx.unit}&req=${shareId}`;
    try { await navigator.clipboard.writeText(url); $('#reqMsg').textContent = '已複製：' + url; } catch { $('#reqMsg').textContent = url; }
  };
  async function doSave() {
    sync(); doc.items = doc.items.filter(it => it.text);
    const st = store(), rec = shareId && st.mine.find(r => r.id === shareId);
    const body = { unit: shareId ? unit : ctx.unit, scheme: sc.id, name: doc.name, note: doc.note, items: doc.items, ...(rec ? { key: rec.key } : {}) };
    try {
      const r = await fetch(shareId ? '/api/req/' + shareId : '/api/req', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      if (!shareId) { shareId = j.id; doc.unit = ctx.unit; st.mine.push({ id: j.id, key: j.key, unit: ctx.unit }); if (st.draft) delete st.draft[ctx.unit]; }
      const r2 = st.mine.find(r => r.id === shareId); Object.assign(r2, { name: doc.name, updated: j.updated }); st.cur[r2.unit] = shareId; save(st);
      doc.updated = j.updated;
      return true;
    } catch (e) { $('#reqMsg').textContent = '儲存失敗：' + e.message; return false; }
  }
  if ($('#reqSave')) $('#reqSave').onclick = async () => {
    $('#reqSave').disabled = true;
    if (await doSave()) { render(); $('#reqMsg').textContent = `已儲存・需求單編號 ${shareId}`; } else $('#reqSave').disabled = false;
  };
}
