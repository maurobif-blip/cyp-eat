/* CYP EAT: the rules. The same text runs in the Google script (shared database), in the app (to show a change at once)
   and in the tests. Plain ES5 so it runs everywhere. */
var EAT_VERSION = 'alpha 0.5';
var EAT_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
var EAT_ROLES = ['Volunteer', 'Canteen', 'Educator'];
var EAT_TYPES = ['people', 'menu', 'before', 'after', 'skip', 'received', 'endweek', 'note', 'startweek', 'dmenu', 'dbefore', 'dafter', 'dskip'];
/* the food is counted for the whole day: dmenu (all meals at once), dbefore (quantities for today), dafter (left at the end of the day), dskip.
   The old types menu, before, after, skip (one meal) are still read. */
/* protein of the day on the weekly canteen sheet: Sun..Sat */
var EAT_PLAN = ['chk', 'egg', 'chk', 'egg', 'fsh', 'bea', 'egg'];

function eatDefaultItems() {
  /* unit: how the store counts it; use: how the cooks take it out; per: how many "use" in one "unit" (0 = not set) */
  return [
    { id: 'mm', name: 'Mealie meal', unit: 'bags', use: 'kg', per: 25, stock: true },
    { id: 'chk', name: 'Chicken', unit: 'chickens', use: 'chickens', per: 1, stock: true, relish: true },
    { id: 'egg', name: 'Eggs', unit: 'trays', use: 'eggs', per: 30, stock: true, relish: true },
    { id: 'fsh', name: 'Fish', unit: 'kg', use: 'kg', per: 1, stock: true, relish: true },
    { id: 'bea', name: 'Beans', unit: 'bags', use: 'kg', per: 0, stock: true, relish: true },
    { id: 'prk', name: 'Pork', unit: 'kg', use: 'kg', per: 1, stock: true, relish: true },
    { id: 'sau', name: 'Sausages', unit: 'sausages', use: 'sausages', per: 1, stock: true, relish: true },
    { id: 'veg', name: 'Vegetables', unit: 'kg', use: 'kg', per: 1, stock: false },
    { id: 'brd', name: 'Bread', unit: 'loaves', use: 'loaves', per: 1, stock: true }
  ];
}
function eatDefaultCentres() {
  return [
    { id: 'MIN', name: 'Minsundu', meals: ['Breakfast', 'Lunch', 'Dinner'], left: true },
    { id: 'LUI', name: 'Luigi', meals: ['Lunch'] },
    { id: 'NKW', name: 'Nkwazi', meals: ['Lunch', 'Dinner'] },
    { id: 'MCU', name: 'Mary Christine / Ukubalula', meals: ['Lunch'] }
  ];
}
/* a database made before a new default item: add the item */
function eatUpgrade(db) {
  var d = eatDefaultItems(), changed = false;
  for (var i = 0; i < d.length; i++) if (!eatFind(db.items, d[i].id)) { d[i].rev = 0; db.items.push(d[i]); changed = true; }
  /* leftovers at the end of the day: counted only where food is cooked in advance (Minsundu, for dinner) */
  for (i = 0; i < db.centres.length; i++) if (typeof db.centres[i].left !== 'boolean') { db.centres[i].left = db.centres[i].id === 'MIN'; changed = true; }
  return changed;
}
/* a quantity in the unit the person chose ('unit' = store unit, else use unit) -> {use, unit}; null when the size is not set */
function eatConv(it, q, u) {
  if (q == null) return { use: null, unit: null };
  if (it.unit === it.use) return { use: q, unit: q };
  if (u === 'unit') return { unit: q, use: it.per ? Math.round(q * it.per * 1000) / 1000 : null };
  return { use: q, unit: it.per ? Math.round(q / it.per * 1000) / 1000 : null };
}
function eatNewDb() {
  var db = { v: 1, rev: 0, settings: { rev: 0, entry: null, admin: null, fails: { entry: 0, admin: 0 }, lock: { entry: '', admin: '' } }, names: [], centres: eatDefaultCentres(), items: eatDefaultItems(), entries: [], comments: [], opIds: [] };
  for (var i = 0; i < db.centres.length; i++) db.centres[i].rev = 0;
  for (i = 0; i < db.items.length; i++) db.items[i].rev = 0;
  return db;
}

/* ---------- small helpers ---------- */
function eatText(x, max) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function eatFind(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
function eatIsDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function eatToday(iso) { var d = new Date(Date.parse(iso) + 2 * 3600000); return d.toISOString().slice(0, 10); } /* Ndola time, UTC+2 */
function eatAddDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function eatWeekday(s) { return new Date(s + 'T12:00:00Z').getUTCDay(); }
function eatMonday(s) { var w = eatWeekday(s); return eatAddDays(s, w === 0 ? -6 : 1 - w); }
function eatNum(x) {
  if (x === '' || x == null) return null;
  var n = typeof x === 'number' ? x : eatFrac(x);
  return n != null && isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
}
/* "0.5", "0,5", "1/2", "1 1/2", "½", "1½", "¼", "¾" -> number; null when it is not a quantity */
function eatFrac(t) {
  t = String(t).trim().replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(',', '.').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  var m = /^(\d+(?:\.\d+)?)$/.exec(t); if (m) return Number(m[1]);
  m = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(t);
  if (m && Number(m[3]) > 0) return (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
  return null;
}
function eatKey(type, centre, date, meal) { return type + '|' + centre + '|' + date + '|' + (meal || ''); }
function eatPublicSettings(s) {
  return { rev: s.rev, entry: s.entry ? { salt: s.entry.salt } : null, admin: s.admin ? { salt: s.admin.salt } : null };
}

/* ---------- reading entries ---------- */
function eatIndex(db) {
  /* key -> entry, kept on the db object and rebuilt when the count of entries changes */
  if (db._ix && db._ixN === db.entries.length && db._ixRev === db.rev) return db._ix;
  var ix = {};
  for (var i = 0; i < db.entries.length; i++) { var e = db.entries[i]; if (!e.del) ix[e.key] = e; }
  try { Object.defineProperty(db, '_ix', { value: ix, writable: true, enumerable: false, configurable: true }); Object.defineProperty(db, '_ixN', { value: db.entries.length, writable: true, enumerable: false, configurable: true }); Object.defineProperty(db, '_ixRev', { value: db.rev, writable: true, enumerable: false, configurable: true }); } catch (x) {}
  return ix;
}
function eatGet(db, type, centre, date, meal) { return eatIndex(db)[eatKey(type, centre, date, meal)] || null; }
function eatItemsOf(db) { return db.items; }
function eatItem(db, id) { return eatFind(db.items, id); }
function eatCentre(db, id) { return eatFind(db.centres, id); }

/* the food rows of a meal: what the menu says, else the day's plan */
function eatMenuOf(db, centre, date, meal) {
  var m = eatGet(db, 'menu', centre, date, meal);
  if (m) return { saved: true, mm: !!m.data.mm, bread: !!m.data.bread, relish: (m.data.relish || []).slice(), veg: m.data.veg || '' };
  if (meal === 'Breakfast') return { saved: false, mm: true, bread: false, relish: [], veg: '' };
  return { saved: false, mm: true, bread: false, relish: [EAT_PLAN[eatWeekday(date)]], veg: '' };
}
function eatRows(db, centre, date, meal) {
  var m = eatMenuOf(db, centre, date, meal), rows = [];
  if (m.mm) rows.push('mm');
  if (m.bread && eatItem(db, 'brd')) rows.push('brd');
  for (var i = 0; i < m.relish.length; i++) if (eatItem(db, m.relish[i]) && rows.indexOf(m.relish[i]) < 0) rows.push(m.relish[i]);
  if (m.veg) rows.push('veg');
  return rows;
}
function eatLaterMeal(db, centre, meal) {
  var c = eatCentre(db, centre); if (!c) return '';
  var i = EAT_MEALS.indexOf(meal);
  for (var j = i + 1; j < EAT_MEALS.length; j++) if (c.meals.indexOf(EAT_MEALS[j]) >= 0) return EAT_MEALS[j];
  return '';
}

/* what one meal used. used[item] is in "use" units, usedU[item] in store units; null = not counted or size not set. */
function eatMealUse(db, centre, date, meal) {
  var out = { skipped: false, hasBefore: false, hasAfter: false, used: {}, usedU: {}, pieces: null, plates: null, kept: null, base: null };
  var p = eatGet(db, 'people', centre, date, meal); if (p) out.plates = p.data.n;
  var sk = eatGet(db, 'skip', centre, date, meal);
  if (sk && sk.data.on) { out.skipped = true; return out; }
  var b = eatGet(db, 'before', centre, date, meal), a = eatGet(db, 'after', centre, date, meal);
  if (!b) return out;
  out.hasBefore = true; out.hasAfter = !!a;
  var bq = b.data.q || {}, bnc = b.data.nc || {}, bu = b.data.u || {}, aq = a ? (a.data.q || {}) : {}, anc = a ? (a.data.nc || {}) : {}, au = a ? (a.data.u || {}) : {};
  function r3(x) { return x == null ? null : Math.max(0, Math.round(x * 1000) / 1000); }
  for (var id in bq) {
    if (id === 'pcs') continue;
    var it = eatItem(db, id);
    if (!it || bnc[id] || bq[id] == null || (a && anc[id])) { out.used[id] = null; out.usedU[id] = null; continue; }
    var tb = eatConv(it, bq[id], bu[id]), ta = eatConv(it, a && aq[id] != null ? aq[id] : 0, au[id] || bu[id]);
    out.used[id] = tb.use == null || ta.use == null ? null : r3(tb.use - ta.use);
    out.usedU[id] = tb.unit == null || ta.unit == null ? null : r3(tb.unit - ta.unit);
  }
  for (id in bnc) if (bnc[id] && id !== 'pcs') { out.used[id] = null; out.usedU[id] = null; }
  if (bq.pcs != null && !bnc.pcs) out.pieces = Math.max(0, bq.pcs - (a && aq.pcs != null && !anc.pcs ? aq.pcs : 0));
  if (a && a.data.kept != null && !a.data.keptNc) out.kept = a.data.kept;
  if (out.plates != null) out.base = out.plates + (out.kept || 0);
  out.closed = out.hasAfter;
  return out;
}
/* ---------- the food of a whole day ---------- */
function eatLeft(db, centre) { var c = eatCentre(db, centre); return !!(c && c.left); }
/* the menu of the day: what is saved, else the weekly plan for each meal of the centre */
function eatDayMenu(db, centre, date) {
  var e = eatGet(db, 'dmenu', centre, date, ''), c = eatCentre(db, centre), meals = c ? c.meals : ['Lunch'], out = { saved: !!e, meals: {} };
  for (var i = 0; i < meals.length; i++) {
    var m = meals[i], x = e && e.data.meals ? e.data.meals[m] : null;
    if (m === 'Breakfast') out.meals[m] = x ? { mm: !!x.mm, other: x.other || '' } : { mm: true, other: '' };
    else out.meals[m] = x ? { mm: !!x.mm, relish: (x.relish || []).slice(), veg: x.veg || '' } : { mm: true, relish: [EAT_PLAN[eatWeekday(date)]], veg: '' };
  }
  return out;
}
/* the food rows of the day, from its menu */
function eatDayRows(db, centre, date) {
  var mn = eatDayMenu(db, centre, date), rows = [], veg = false;
  for (var m in mn.meals) { var x = mn.meals[m]; if (x.mm && rows.indexOf('mm') < 0) rows.push('mm'); }
  for (m in mn.meals) { x = mn.meals[m]; for (var i = 0; i < (x.relish || []).length; i++) if (eatItem(db, x.relish[i]) && rows.indexOf(x.relish[i]) < 0) rows.push(x.relish[i]); if (x.veg) veg = true; }
  if (veg && eatItem(db, 'veg')) rows.push('veg');
  return rows;
}
/* what one day used. Where the leftovers are not counted, everything taken out is used. */
function eatDayUse(db, centre, date) {
  var out = { day: true, skipped: false, hasBefore: false, hasAfter: false, closed: false, used: {}, usedU: {}, pieces: null, plates: null, base: null, peopleMissing: 0 };
  var c = eatCentre(db, centre), meals = c ? c.meals : [];
  for (var i = 0; i < meals.length; i++) { var p = eatGet(db, 'people', centre, date, meals[i]); if (p) out.plates = (out.plates || 0) + p.data.n; else out.peopleMissing++; }
  out.base = out.plates;
  var sk = eatGet(db, 'dskip', centre, date, '');
  if (sk && sk.data.on) { out.skipped = true; return out; }
  var b = eatGet(db, 'dbefore', centre, date, ''), a = eatGet(db, 'dafter', centre, date, ''), left = eatLeft(db, centre);
  if (!b) return out;
  out.hasBefore = true; out.hasAfter = !!a; out.closed = !!a || !left;
  if (!left) a = null;
  var bq = b.data.q || {}, bnc = b.data.nc || {}, bu = b.data.u || {}, aq = a ? (a.data.q || {}) : {}, anc = a ? (a.data.nc || {}) : {}, au = a ? (a.data.u || {}) : {};
  function r3(x) { return x == null ? null : Math.max(0, Math.round(x * 1000) / 1000); }
  for (var id in bq) {
    if (id === 'pcs') continue;
    var it = eatItem(db, id);
    if (!it || bnc[id] || bq[id] == null || (a && anc[id])) { out.used[id] = null; out.usedU[id] = null; continue; }
    var tb = eatConv(it, bq[id], bu[id]), ta = eatConv(it, a && aq[id] != null ? aq[id] : 0, au[id] || bu[id]);
    out.used[id] = tb.use == null || ta.use == null ? null : r3(tb.use - ta.use);
    out.usedU[id] = tb.unit == null || ta.unit == null ? null : r3(tb.unit - ta.unit);
  }
  for (id in bnc) if (bnc[id] && id !== 'pcs') { out.used[id] = null; out.usedU[id] = null; }
  if (bq.pcs != null && !bnc.pcs) out.pieces = Math.max(0, bq.pcs - (a && aq.pcs != null && !anc.pcs ? aq.pcs : 0));
  return out;
}
/* the uses of a day for the store: the day count when there is one, else the old counts by meal */
function eatUsesOfDay(db, centre, date) {
  var d = eatDayUse(db, centre, date);
  if (d.hasBefore || d.skipped) return [d];
  var c = eatCentre(db, centre), meals = c ? c.meals : EAT_MEALS, out = [];
  for (var m = 0; m < meals.length; m++) out.push(eatMealUse(db, centre, date, meals[m]));
  return out;
}
/* per plate needs the quantities after and the people count */
function eatPerPlate(use, id) {
  if (!use.closed || use.base == null || use.base <= 0 || use.used[id] == null) return null;
  return use.used[id] / use.base;
}

/* stock of one centre. A count at the start of a day (startweek) comes before that day's deliveries and meals;
   a count at the end of a day (endweek) comes after them. atStart: the stock in the morning of upTo, before its count. */
function eatCountKey(e) { return e.type === 'startweek' ? e.date + '|0' : (e.type === 'endweek' ? e.date + '|2' : ''); }
function eatStock(db, centre, upTo, atStart) {
  var lim = upTo + (atStart ? '|0' : '|2'), last = null, lastK = '', i, e, k;
  for (i = 0; i < db.entries.length; i++) {
    e = db.entries[i];
    if (e.del || e.centre !== centre) continue;
    k = eatCountKey(e); if (!k || k >= lim) continue;
    if (!last || k > lastK) { last = e; lastK = k; }
  }
  var first, lastDay = atStart ? eatAddDays(upTo, -1) : upTo, out = {}, items = db.items;
  if (last) first = last.type === 'startweek' ? last.date : eatAddDays(last.date, 1);
  else { first = upTo; for (i = 0; i < db.entries.length; i++) { e = db.entries[i]; if (!e.del && e.centre === centre && e.date < first) first = e.date; } }
  for (i = 0; i < items.length; i++) {
    var it = items[i]; if (!it.stock) continue;
    var start = last ? (last.data.nc && last.data.nc[it.id] ? null : (last.data.q[it.id] != null ? last.data.q[it.id] : 0)) : 0;
    out[it.id] = { start: start, startDate: last ? last.date : '', startKind: last ? (last.type === 'startweek' ? 'start' : 'end') : '', inn: 0, used: 0, usedOk: true, expected: null };
  }
  for (i = 0; i < db.entries.length; i++) {
    e = db.entries[i];
    if (e.del || e.centre !== centre || e.date < first || e.date > lastDay) continue;
    if (e.type === 'received' || (e.type === 'note' && !e.data.off)) for (var id in e.data.q) if (out[id] && e.data.q[id] != null) out[id].inn += e.data.q[id];
  }
  for (var d = first, guard = 0; d <= lastDay && guard < 400; d = eatAddDays(d, 1), guard++) {
    var uses = eatUsesOfDay(db, centre, d);
    for (var m = 0; m < uses.length; m++) {
      var u = uses[m];
      if (!u.hasBefore) continue;
      for (id in out) {
        if (!(id in u.used)) continue;
        if (u.usedU[id] == null) { out[id].usedOk = false; continue; }
        out[id].used += u.usedU[id];
      }
    }
  }
  for (id in out) {
    var s = out[id]; s.used = Math.round(s.used * 100) / 100; s.inn = Math.round(s.inn * 100) / 100;
    s.expected = s.start == null || !s.usedOk ? null : Math.round((s.start + s.inn - s.used) * 100) / 100;
  }
  return out;
}
/* the count of a week: the first start count, the last end count */
function eatWeekCount(db, centre, monday, type) {
  var sun = eatAddDays(monday, 6), hit = null;
  for (var i = 0; i < db.entries.length; i++) {
    var e = db.entries[i];
    if (e.del || e.type !== type || e.centre !== centre || e.date < monday || e.date > sun) continue;
    if (!hit || (type === 'startweek' ? e.date < hit.date : e.date > hit.date)) hit = e;
  }
  return hit;
}
/* the last day a delivery should cover */
function eatNoteUntil(e) { var n = e && e.data ? e.data.days : null; return n ? eatAddDays(e.date, n - 1) : ''; }

/* ---------- delivery notes (from the Self Reliance books) ---------- */
function eatNoteNo(x) { var t = String(x == null ? '' : x).replace(/\D/g, ''); return t.length >= 1 && t.length <= 8 ? String(Number(t)) : ''; }
function eatNote(db, no) { no = eatNoteNo(no); return no ? eatIndex(db)['note|' + no] || null : null; }
/* notes with a date from..to (both included), not removed, by date then number */
function eatNotes(db, from, to, centre) {
  var out = [];
  for (var i = 0; i < db.entries.length; i++) {
    var e = db.entries[i];
    if (e.del || e.type !== 'note' || e.data.off || e.date < from || e.date > to || (centre && e.centre !== centre)) continue;
    out.push(e);
  }
  return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.data.no) - Number(b.data.no); });
}
/* numbers missing in each book: numbers close to each other (less than 50 apart) are one book */
function eatNoteGaps(db) {
  var nos = [], i, gaps = [];
  for (i = 0; i < db.entries.length; i++) { var e = db.entries[i]; if (!e.del && e.type === 'note' && nos.indexOf(Number(e.data.no)) < 0) nos.push(Number(e.data.no)); }
  nos.sort(function (a, b) { return a - b; });
  for (i = 1; i < nos.length; i++) { var d = nos[i] - nos[i - 1]; if (d > 1 && d < 50) gaps.push({ from: nos[i - 1] + 1, to: nos[i] - 1 }); }
  return gaps;
}

/* ---------- writing: one function for the server and the phone ---------- */
/* mode: 'entry' (people who count) or 'admin' (overview). Returns {ok, error}. */
function eatApply(db, mode, op, nowIso, info) {
  info = info || { entries: [], audit: [], comments: [] };
  var k = op.kind, i;
  function bump(o) { db.rev++; o.rev = db.rev; }
  function admin() { return mode === 'admin'; }
  if (k === 'entry') {
    var e = op.e || {};
    if (EAT_TYPES.indexOf(e.type) < 0 || !eatCentre(db, e.centre) || !eatIsDate(e.date)) return { ok: false, error: 'fields' };
    if (e.date > eatToday(nowIso)) return { ok: false, error: 'future' };
    var meal = e.meal || '';
    if (['people', 'menu', 'before', 'after', 'skip'].indexOf(e.type) >= 0 && EAT_MEALS.indexOf(meal) < 0) return { ok: false, error: 'meal' };
    if (['received', 'endweek', 'note', 'startweek', 'dmenu', 'dbefore', 'dafter', 'dskip'].indexOf(e.type) >= 0) meal = '';
    var key = eatKey(e.type, e.centre, e.date, meal);
    /* a delivery note is one paper note: its number is the key, whatever the centre or the date */
    if (e.type === 'note') { var no = eatNoteNo((e.data || {}).no); if (!no) return { ok: false, error: 'note_no' }; key = 'note|' + no; }
    var old = eatIndex(db)[key] || null;
    /* two phones on the same meal: the later save stays */
    if (old && old.at && e.at && old.at > e.at) return { ok: true, older: true };
    var rec = { id: String(op.id), key: key, type: e.type, centre: e.centre, date: e.date, meal: meal, data: eatClean(db, e.type, e.data || {}), by: eatText(e.by, 40), byName: eatText(e.byName, 60), at: eatText(e.at, 30) || nowIso, saved: nowIso, mode: mode };
    if (old) { old.del = true; bump(old); }
    bump(rec); db.entries.push(rec);
    info.entries.push(rec);
    return { ok: true };
  }
  if (k === 'comment') {
    var c = op.c || {};
    if (!eatText(c.text)) return { ok: false, error: 'fields' };
    if (eatFind(db.comments, String(op.id))) return { ok: true };
    var cm = { id: String(op.id), text: eatText(c.text, 1000), screen: eatText(c.screen, 60), byName: eatText(c.byName, 60), centre: eatText(c.centre, 10), at: nowIso, done: false, version: eatText(c.version, 20), mode: mode };
    bump(cm); db.comments.push(cm); info.comments.push(cm);
    info.audit.push({ time: nowIso, who: cm.byName, action: 'Comment', detail: cm.screen + ': ' + cm.text.slice(0, 80) });
    return { ok: true };
  }
  if (!admin()) return { ok: false, error: 'rights' };
  if (k === 'comment_done') {
    var cd = eatFind(db.comments, op.cid); if (!cd) return { ok: false, error: 'id' };
    cd.done = !!op.done; bump(cd); info.comments.push(cd); return { ok: true };
  }
  if (k === 'name_add') {
    var nm = eatText(op.name, 60), role = EAT_ROLES.indexOf(op.role) >= 0 ? op.role : 'Volunteer';
    if (!nm) return { ok: false, error: 'fields' };
    for (i = 0; i < db.names.length; i++) if (db.names[i].active && db.names[i].name.toLowerCase() === nm.toLowerCase()) return { ok: false, error: 'same' };
    var n = { id: String(op.nid || op.id), name: nm, role: role, active: true };
    bump(n); db.names.push(n);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Name added', detail: nm + ' (' + role + ')' });
    return { ok: true };
  }
  if (k === 'name_off') {
    var no = eatFind(db.names, op.nid); if (!no) return { ok: false, error: 'id' };
    no.active = false; bump(no);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Name removed', detail: no.name });
    return { ok: true };
  }
  if (k === 'centre_meals') {
    var ce = eatCentre(db, op.cid); if (!ce) return { ok: false, error: 'id' };
    var ms = []; for (i = 0; i < EAT_MEALS.length; i++) if ((op.meals || []).indexOf(EAT_MEALS[i]) >= 0) ms.push(EAT_MEALS[i]);
    if (!ms.length) return { ok: false, error: 'fields' };
    ce.meals = ms; bump(ce);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Meals changed', detail: ce.name + ': ' + ms.join(', ') });
    return { ok: true };
  }
  if (k === 'centre_left') {
    var cl = eatCentre(db, op.cid); if (!cl) return { ok: false, error: 'id' };
    cl.left = !!op.on; bump(cl);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Leftovers', detail: cl.name + (cl.left ? ': counted at the end of the day' : ': not counted') });
    return { ok: true };
  }
  if (k === 'item_per') {
    var it = eatItem(db, op.iid); if (!it) return { ok: false, error: 'id' };
    var per = eatNum(op.per); if (per == null) return { ok: false, error: 'fields' };
    it.per = per; bump(it);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Unit changed', detail: it.name + ': 1 ' + it.unit + ' = ' + per + ' ' + it.use });
    return { ok: true };
  }
  if (k === 'pin_set') {
    if (op.which !== 'entry' && op.which !== 'admin') return { ok: false, error: 'fields' };
    if (!op.salt || !op.cred) return { ok: false, error: 'fields' };
    db.settings[op.which] = { salt: String(op.salt), cred: String(op.cred) };
    db.settings.rev = ++db.rev;
    info.audit.push({ time: nowIso, who: 'Overview', action: 'PIN changed', detail: op.which === 'entry' ? 'Data entry PIN' : 'Overview PIN' });
    return { ok: true };
  }
  return { ok: false, error: 'kind' };
}
/* keep only numbers and known fields */
function eatClean(db, type, d) {
  function qs(q) { var o = {}; if (!q) return o; for (var id in q) { if (id !== 'pcs' && !eatItem(db, id)) continue; var n = eatNum(q[id]); o[id] = n; } return o; }
  function ncs(nc) { var o = {}; if (!nc) return o; for (var id in nc) if (nc[id]) o[id] = true; return o; }
  if (type === 'people') return { n: Math.max(0, Math.min(5000, Math.round(Number(d.n) || 0))) };
  if (type === 'menu') { var r = []; for (var i = 0; i < (d.relish || []).length; i++) { var it = eatItem(db, d.relish[i]); if (it && it.relish && r.indexOf(it.id) < 0) r.push(it.id); } var br = !!d.bread && !!eatItem(db, 'brd'); return { mm: !!d.mm, bread: br, relish: r, veg: eatText(d.veg, 60) }; }
  function us(u) { var o = {}; if (!u) return o; for (var id in u) { var it = eatItem(db, id); if (it && it.unit !== it.use && (u[id] === 'unit' || u[id] === 'use')) o[id] = u[id]; } return o; }
  if (type === 'before' || type === 'after') { var o = { q: qs(d.q), nc: ncs(d.nc), u: us(d.u) }; if (type === 'after') { o.kept = eatNum(d.kept); o.keptNc = !!d.keptNc; } return o; }
  if (type === 'skip' || type === 'dskip') return { on: !!d.on };
  if (type === 'dbefore' || type === 'dafter') return { q: qs(d.q), nc: ncs(d.nc), u: us(d.u) };
  if (type === 'dmenu') {
    var ms = {}, src = d.meals || {};
    for (var mi = 0; mi < EAT_MEALS.length; mi++) {
      var mk = EAT_MEALS[mi], x = src[mk]; if (!x) continue;
      if (mk === 'Breakfast') { ms[mk] = { mm: !!x.mm, other: eatText(x.other, 60) }; continue; }
      var rr = []; for (var ri = 0; ri < (x.relish || []).length; ri++) { var ri2 = eatItem(db, x.relish[ri]); if (ri2 && ri2.relish && rr.indexOf(ri2.id) < 0) rr.push(ri2.id); }
      ms[mk] = { mm: !!x.mm, relish: rr, veg: eatText(x.veg, 60) };
    }
    return { meals: ms };
  }
  if (type === 'received') return { q: qs(d.q) };
  if (type === 'endweek' || type === 'startweek') return { q: qs(d.q), nc: ncs(d.nc) };
  if (type === 'note') { var nq = qs(d.q), q2 = {}; for (var k2 in nq) if (k2 !== 'pcs' && nq[k2] != null && nq[k2] > 0) q2[k2] = nq[k2]; var dy = Math.round(Number(d.days)); return { no: eatNoteNo(d.no), q: q2, days: isFinite(dy) && dy >= 1 && dy <= 60 ? dy : null, remark: eatText(d.remark, 200), recv: eatText(d.recv, 60), off: !!d.off }; }
  return {};
}

/* ---------- the shared database: one request at a time ---------- */
function eatHandle(req, store) {
  if (!req || !store.key() || req.key !== store.key()) return { ok: false, error: 'key' };
  var db = store.load() || eatNewDb(), now = store.now(), a = req.action, s = db.settings, i;
  var upgraded = eatUpgrade(db);
  function pub() { return { settings: eatPublicSettings(s), names: db.names, centres: db.centres, items: db.items }; }
  if (a === 'hello') { var h = pub(); h.ok = true; h.empty = !s.entry || !s.admin; h.now = now; h.version = EAT_VERSION; return h; }
  if (a === 'setup') {
    if (s.entry && s.admin) return { ok: false, error: 'not_empty' };
    if (!req.entry || !req.admin || !req.entry.salt || !req.entry.cred || !req.admin.salt || !req.admin.cred) return { ok: false, error: 'fields' };
    s.entry = { salt: String(req.entry.salt), cred: String(req.entry.cred) };
    s.admin = { salt: String(req.admin.salt), cred: String(req.admin.cred) };
    s.rev = ++db.rev;
    store.save(db, { entries: [], comments: [], audit: [{ time: now, who: 'Setup', action: 'PINs set', detail: '' }] });
    return { ok: true };
  }
  var mode = req.mode === 'admin' ? 'admin' : 'entry';
  if (!s[mode]) return { ok: false, error: 'empty' };
  if (s.lock[mode] && now < s.lock[mode]) return { ok: false, error: 'locked', until: s.lock[mode] };
  if (!req.cred || req.cred !== s[mode].cred) {
    s.fails[mode] = (s.fails[mode] || 0) + 1;
    if (s.fails[mode] >= 5) { s.fails[mode] = 0; s.lock[mode] = new Date(Date.parse(now) + 60000).toISOString(); }
    store.save(db, null);
    return { ok: false, error: 'pin' };
  }
  var dirty = upgraded;
  if (s.fails[mode] || s.lock[mode]) { s.fails[mode] = 0; s.lock[mode] = ''; dirty = true; }
  if (a === 'login') { if (dirty) store.save(db, null); return { ok: true, now: now }; }
  if (a !== 'sync') return { ok: false, error: 'action' };
  var results = [], info = { entries: [], audit: [], comments: [] }, ops = req.ops || [];
  for (i = 0; i < ops.length; i++) {
    var op = ops[i], res;
    if (!op || !op.id) { results.push({ id: '', ok: false, error: 'op' }); continue; }
    if (db.opIds.indexOf(op.id) >= 0) { results.push({ id: op.id, ok: true, again: true }); continue; }
    try { res = eatApply(db, mode, op, now, info); } catch (err) { res = { ok: false, error: 'server', detail: String(err) }; }
    res.id = op.id; results.push(res);
    db.opIds.push(op.id); if (db.opIds.length > 5000) db.opIds.splice(0, db.opIds.length - 5000);
    dirty = true;
  }
  if (dirty) store.save(db, info);
  var since = Number(req.since) || 0, out = pub();
  out.ok = true; out.results = results; out.rev = db.rev; out.now = now; out.full = since === 0;
  out.entries = [];
  for (i = 0; i < db.entries.length; i++) if (db.entries[i].rev > since) out.entries.push(db.entries[i]);
  out.comments = [];
  for (i = 0; i < db.comments.length; i++) if (db.comments[i].rev > since && (mode === 'admin')) out.comments.push(db.comments[i]);
  return out;
}
if (typeof module !== 'undefined') module.exports = { eatNewDb: eatNewDb, eatApply: eatApply, eatHandle: eatHandle, eatMealUse: eatMealUse, eatNote: eatNote, eatNotes: eatNotes, eatNoteGaps: eatNoteGaps, eatNoteNo: eatNoteNo, eatUpgrade: eatUpgrade, eatConv: eatConv, eatStock: eatStock, eatDayUse: eatDayUse, eatDayMenu: eatDayMenu, eatDayRows: eatDayRows, eatUsesOfDay: eatUsesOfDay, eatNum: eatNum, eatLeft: eatLeft, eatWeekCount: eatWeekCount, eatNoteUntil: eatNoteUntil, eatPerPlate: eatPerPlate, eatRows: eatRows, eatMenuOf: eatMenuOf, eatGet: eatGet, eatKey: eatKey, eatMonday: eatMonday, eatAddDays: eatAddDays, eatToday: eatToday, eatWeekday: eatWeekday, EAT_VERSION: EAT_VERSION };
