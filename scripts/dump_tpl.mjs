// 把各方案套用後的樣板（左上象限，公尺）輸出成 JSON，給 req_worker.py 當 Claude Code 的參考與驗收基準
import { resolveTemplate } from '../js/plan.js';
import { SCHEMES } from '../js/schemes.js';
const out = {};
for (const [kind, list] of Object.entries(SCHEMES)) {
  out[kind] = {};
  for (const s of list) if (!s.custom) {
    const t = resolveTemplate(kind, s.id);
    out[kind][s.id] = { name: s.name, tag: s.tag, summary: s.summary, label: t.label, rooms: t.rooms, openings: t.openings, furniture: t.furniture };
  }
}
console.log(JSON.stringify(out));
