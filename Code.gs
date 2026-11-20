/* CYP EAT: the rules. The same text runs in the Google script (shared database), in the app (to show a change at once)
   and in the tests. Plain ES5 so it runs everywhere. */
var EAT_VERSION = 'alpha 0.15';
var EAT_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
var EAT_ROLES = ['Volunteer', 'Canteen', 'Educator'];
/* three accesses: entry (people and food), delivery (photos of the delivery notes), admin (overview) */
var EAT_MODES = ['entry', 'delivery', 'admin'];
/* how the store can count a food: in its own unit (kg, chickens, eggs…) or in a container, with how much one container holds */
var EAT_PACKS = ['bags', 'trays', 'cans', 'packs', 'pieces'];
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
    { id: 'bea', name: 'Beans', unit: 'cans', use: 'kg', per: 0, stock: true, relish: true },
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
  return { rev: s.rev, entry: s.entry ? { salt: s.entry.salt } : null, admin: s.admin ? { salt: s.admin.salt } : null, delivery: s.delivery ? { salt: s.delivery.salt } : null };
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
/* centres with a canteen (people and food are counted); places only receive deliveries */
/* The place written by hand on a delivery note ("Misundu Canteen", "S.S. Luigi Canteen") -> the id of the centre or place, or ''.
   Spelling slips are accepted: up to one letter in four. A group that eats at a centre (Holy Family) gives that centre. */
function eatPlaceNorm(t) {
  var w = String(t || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/), out = [];
  for (var i = 0; i < w.length; i++) if (w[i] && ['canteen', 'centre', 'center', 'ss', 's', 'kitchen', 'the', 'ms', 'm'].indexOf(w[i]) < 0) out.push(w[i]);
  return out.join(' ');
}
function eatLev(a, b) {
  var prev = [], cur, i, j; for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) { cur = [i]; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
function eatPlaceMatch(db, text) {
  var t = eatPlaceNorm(text), best = '', bestD = 99; if (!t) return '';
  var tw = t.split(' '), ps = eatPlaces(db);
  /* one word of a name against the words written: the smallest number of wrong letters, or 99 when too many */
  function word(w) { var lim = w.length < 4 ? 0 : (w.length < 8 ? 1 : 2), m = 99; for (var k = 0; k < tw.length; k++) m = Math.min(m, eatLev(w, tw[k])); return m <= lim ? m : 99; }
  for (var i = 0; i < ps.length; i++) {
    var names = ps[i].name.split('/').concat(ps[i].groups || []);
    for (var j = 0; j < names.length; j++) {
      var n = eatPlaceNorm(names[j]); if (!n) continue;
      var nw = n.split(' '), d = word(nw[0]);
      /* a long first word is enough (Minsundu, Chinika); a short one (Mary, Holy) needs the other words too */
      if (nw[0].length < 5) for (var x = 1; x < nw.length; x++) d += word(nw[x]);
      if (t === n) d = 0;
      if (d < bestD && d < 99) { best = ps[i].id; bestD = d; }
    }
  }
  return best;
}
/* the plates of one meal: the centre's own, and the groups that eat food cooked there (Luigi cooks for Holy Family) */
function eatPlates(p) { var t = p.data.n || 0, g = p.data.g || {}; for (var k in g) t += g[k] || 0; return t; }
function eatCanteens(db) { var o = []; for (var i = 0; i < db.centres.length; i++) if (!db.centres[i].place && !db.centres[i].off) o.push(db.centres[i]); return o; }
function eatPlaces(db) { var o = []; for (var i = 0; i < db.centres.length; i++) if (!db.centres[i].off) o.push(db.centres[i]); return o; }

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
  var p = eatGet(db, 'people', centre, date, meal); if (p) out.plates = eatPlates(p);
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
  var e = eatGet(db, 'dmenu', centre, date, ''), c = eatCentre(db, centre), meals = c ? c.meals : ['Lunch'], out = { saved: !!e, meals: {}, cook: e && e.data.cook ? e.data.cook : '' };
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
  for (var i = 0; i < meals.length; i++) { var p = eatGet(db, 'people', centre, date, meals[i]); if (p) out.plates = (out.plates || 0) + eatPlates(p); else out.peopleMissing++; }
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
    if (e.del || e.date < first || e.date > lastDay) continue;
    var id, nq = e.type === 'received' && e.centre === centre ? e.data.q : (e.type === 'note' && !e.data.off && eatNoteHas(e, centre) ? eatNoteQ(e, centre) : null);
    if (nq) for (id in nq) if (out[id] && nq[id] != null) out[id].inn += nq[id];
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
/* the store of one centre in one week, to compare what should be there with what is there:
   start (the stock in the morning of Monday, carried from the last count; or a count at the start of this week on the old sheets)
   + delivered − cooked (from the daily counts) = expected; next to it the count at the end of the week, and the difference.
   Without a count at the end of the week it runs to today (Sunday at most). */
function eatWeekCheck(db, centre, monday, today) {
  var sun = eatAddDays(monday, 6), end = eatWeekCount(db, centre, monday, 'endweek'), sw = eatWeekCount(db, centre, monday, 'startweek');
  if (sw && end && sw.date > end.date) sw = null;
  var to = end ? end.date : (sun < today ? sun : today), from = sw ? sw.date : monday;
  var out = { from: from, to: to, endDate: end ? end.date : '', startDate: sw ? sw.date : '', startCounted: !!sw, days: 0, daysFood: 0, daysSkipped: 0, items: {} };
  var st = sw ? null : eatStock(db, centre, monday, true), i, e, id, x;
  function r2(v) { return Math.round(v * 100) / 100; }
  for (i = 0; i < db.items.length; i++) {
    var it = db.items[i]; if (!it.stock) continue;
    var start = sw ? (sw.data.nc && sw.data.nc[it.id] ? null : (sw.data.q[it.id] != null ? sw.data.q[it.id] : 0)) : (st[it.id] && st[it.id].startDate ? st[it.id].expected : null);
    if (!sw && st[it.id] && st[it.id].startDate && !out.startDate) out.startDate = st[it.id].startDate;
    out.items[it.id] = { start: start, inn: 0, used: 0, usedOk: true, expected: null, counted: end ? (end.data.nc && end.data.nc[it.id] ? null : (end.data.q[it.id] != null ? end.data.q[it.id] : 0)) : undefined, diff: null };
  }
  if (to < from) return out;
  for (i = 0; i < db.entries.length; i++) {
    e = db.entries[i];
    if (e.del || e.date < from || e.date > to) continue;
    var nq = e.type === 'received' && e.centre === centre ? e.data.q : (e.type === 'note' && !e.data.off && eatNoteHas(e, centre) ? eatNoteQ(e, centre) : null);
    if (nq) for (id in nq) if (out.items[id] && nq[id] != null) out.items[id].inn += nq[id];
  }
  for (var d = from, guard = 0; d <= to && guard < 8; d = eatAddDays(d, 1), guard++) {
    var uses = eatUsesOfDay(db, centre, d), food = false, skip = false;
    out.days++;
    for (var m = 0; m < uses.length; m++) {
      var u = uses[m];
      if (u.skipped) skip = true;
      if (!u.hasBefore) continue;
      food = true;
      for (id in out.items) {
        if (!(id in u.used)) continue;
        if (u.usedU[id] == null) { out.items[id].usedOk = false; continue; }
        out.items[id].used += u.usedU[id];
      }
    }
    if (food) out.daysFood++; else if (skip) out.daysSkipped++;
  }
  for (id in out.items) {
    x = out.items[id]; x.inn = r2(x.inn); x.used = r2(x.used);
    x.expected = x.start == null || !x.usedOk ? null : r2(x.start + x.inn - x.used);
    x.diff = x.expected == null || x.counted == null ? null : r2(x.counted - x.expected);
  }
  return out;
}
/* the last day a delivery should cover */
function eatNoteUntil(e) { var n = e && e.data ? e.data.days : null; return n ? eatAddDays(e.date, n - 1) : ''; }

/* ---------- delivery notes (from the Self Reliance books) ---------- */
function eatNoteNo(x) { var t = String(x == null ? '' : x).replace(/\D/g, ''); return t.length >= 1 && t.length <= 8 ? String(Number(t)) : ''; }
function eatNote(db, no) { no = eatNoteNo(no); return no ? eatIndex(db)['note|' + no] || null : null; }
/* notes with a date from..to (both included), not removed, by date then number */
/* A note can say that a part is for another place ("02 chickens for Chinika House"): data.parts = [{ to, name, q }].
   The quantities on the note are the whole delivery; the part is taken off the note's centre and counted for the other place. */
function eatNoteHas(e, centre) {
  if (e.centre === centre) return true;
  var ps = (e.data || {}).parts || []; for (var i = 0; i < ps.length; i++) if (ps[i].to === centre) return true;
  return false;
}
function eatNoteQ(e, centre) {
  var q = {}, ps = (e.data || {}).parts || [], id, i;
  if (e.centre === centre) {
    for (id in e.data.q) q[id] = e.data.q[id];
    for (i = 0; i < ps.length; i++) for (id in ps[i].q) if (q[id] != null) q[id] = Math.max(0, Math.round((q[id] - ps[i].q[id]) * 1000) / 1000);
  } else for (i = 0; i < ps.length; i++) if (ps[i].to === centre) for (id in ps[i].q) q[id] = (q[id] || 0) + ps[i].q[id];
  return q;
}
function eatNotes(db, from, to, centre) {
  var out = [];
  for (var i = 0; i < db.entries.length; i++) {
    var e = db.entries[i];
    if (e.del || e.type !== 'note' || e.data.off || e.date < from || e.date > to || (centre && !eatNoteHas(e, centre))) continue;
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
  if (mode === 'delivery' && !(k === 'comment' || (k === 'entry' && op.e && op.e.type === 'note'))) return { ok: false, error: 'rights' };
  if (k === 'entry') {
    var e = op.e || {};
    if (EAT_TYPES.indexOf(e.type) < 0 || !eatCentre(db, e.centre) || !eatIsDate(e.date)) return { ok: false, error: 'fields' };
    if (e.type !== 'note' && eatCentre(db, e.centre).place) return { ok: false, error: 'place' };
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
  if (k === 'name_edit') {
    var ne = eatFind(db.names, op.nid), nn2 = eatText(op.name, 60); if (!ne || !ne.active) return { ok: false, error: 'id' };
    if (!nn2) return { ok: false, error: 'fields' };
    for (i = 0; i < db.names.length; i++) if (db.names[i] !== ne && db.names[i].active && db.names[i].name.toLowerCase() === nn2.toLowerCase()) return { ok: false, error: 'same' };
    var was = ne.name + ' (' + ne.role + ')';
    ne.name = nn2; if (EAT_ROLES.indexOf(op.role) >= 0) ne.role = op.role; bump(ne);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Name changed', detail: was + ' -> ' + ne.name + ' (' + ne.role + ')' });
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
  if (k === 'place_add') {
    var pn = eatText(op.name, 60); if (!pn) return { ok: false, error: 'fields' };
    for (i = 0; i < db.centres.length; i++) if (!db.centres[i].off && db.centres[i].name.toLowerCase() === pn.toLowerCase()) return { ok: false, error: 'same' };
    var pid = 'P' + (db.centres.length + 1); while (eatCentre(db, pid)) pid += 'x';
    var pl = { id: pid, name: pn, meals: [], left: false, place: true };
    bump(pl); db.centres.push(pl);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Place added', detail: pn });
    return { ok: true };
  }
  if (k === 'place_off') {
    var po = eatCentre(db, op.cid); if (!po || !po.place) return { ok: false, error: 'id' };
    po.off = true; bump(po);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Place removed', detail: po.name });
    return { ok: true };
  }
  if (k === 'centre_groups') {
    var cg = eatCentre(db, op.cid); if (!cg || cg.place) return { ok: false, error: 'id' };
    var gs = []; for (i = 0; i < (op.groups || []).length && gs.length < 4; i++) { var gt = eatText(op.groups[i], 40); if (gt && gs.indexOf(gt) < 0 && gt !== cg.name) gs.push(gt); }
    cg.groups = gs; bump(cg);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Groups', detail: cg.name + ': ' + (gs.join(', ') || 'none') });
    return { ok: true };
  }
  if (k === 'centre_left') {
    var cl = eatCentre(db, op.cid); if (!cl) return { ok: false, error: 'id' };
    cl.left = !!op.on; bump(cl);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Leftovers', detail: cl.name + (cl.left ? ': counted at the end of the day' : ': not counted') });
    return { ok: true };
  }
  /* the unit of a food in the store: its own unit (kg, chickens…) or a container (bags, trays, cans, packs) and how much one holds */
  if (k === 'item_unit') {
    var iu = eatItem(db, op.iid); if (!iu) return { ok: false, error: 'id' };
    var un = String(op.unit || '');
    if (un === iu.use) { iu.unit = iu.use; iu.per = 1; }
    else if (EAT_PACKS.indexOf(un) >= 0) { var pr = eatNum(op.per); iu.unit = un; iu.per = pr == null ? 0 : pr; }
    else return { ok: false, error: 'fields' };
    bump(iu);
    info.audit.push({ time: nowIso, who: 'Overview', action: 'Unit changed', detail: iu.name + ': counted in ' + iu.unit + (iu.unit !== iu.use ? ', 1 ' + iu.unit.replace(/s$/, '') + ' = ' + (iu.per || '?') + ' ' + iu.use : '') });
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
    if (EAT_MODES.indexOf(op.which) < 0) return { ok: false, error: 'fields' };
    if (!op.salt || !op.cred) return { ok: false, error: 'fields' };
    db.settings[op.which] = { salt: String(op.salt), cred: String(op.cred) };
    db.settings.rev = ++db.rev;
    info.audit.push({ time: nowIso, who: 'Overview', action: 'PIN changed', detail: op.which === 'entry' ? 'Data entry PIN' : (op.which === 'delivery' ? 'Deliveries PIN' : 'Overview PIN') });
    return { ok: true };
  }
  return { ok: false, error: 'kind' };
}
/* keep only numbers and known fields */
function eatClean(db, type, d) {
  function qs(q) { var o = {}; if (!q) return o; for (var id in q) { if (id !== 'pcs' && !eatItem(db, id)) continue; var n = eatNum(q[id]); o[id] = n; } return o; }
  function ncs(nc) { var o = {}; if (!nc) return o; for (var id in nc) if (nc[id]) o[id] = true; return o; }
  if (type === 'people') {
    var pn = function (x) { return Math.max(0, Math.min(5000, Math.round(Number(x) || 0))); }, pg = {}, gi = 0;
    for (var gk in (d.g || {})) { var gn = eatText(gk, 40); if (gn && gi < 4) { pg[gn] = pn(d.g[gk]); gi++; } }
    var pd = gi ? { n: pn(d.n), g: pg } : { n: pn(d.n) }; if (d.done) pd.done = true; return pd;
  }
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
    return { meals: ms, cook: eatText(d.cook, 60) };
  }
  if (type === 'received') return { q: qs(d.q) };
  if (type === 'endweek' || type === 'startweek') return { q: qs(d.q), nc: ncs(d.nc) };
  if (type === 'note') { var nq = qs(d.q), q2 = {}; for (var k2 in nq) if (k2 !== 'pcs' && nq[k2] != null && nq[k2] > 0) q2[k2] = nq[k2]; var dy = Math.round(Number(d.days)); var parts = [], psrc = d.parts || [];
    for (var pi = 0; pi < psrc.length && parts.length < 4; pi++) {
      var pp = psrc[pi] || {}, pq = qs(pp.q), pq2 = {}, pany = false, pto = eatCentre(db, pp.to) ? String(pp.to) : '', pname = eatText(pp.name, 60) || (pto ? eatCentre(db, pto).name : '');
      for (var pk in pq) if (q2[pk] && pq[pk] > 0) { pq2[pk] = Math.min(pq[pk], q2[pk]); pany = true; }
      if (pany && pname) parts.push({ to: pto, name: pname, q: pq2 });
    }
    var nd = { no: eatNoteNo(d.no), q: q2, days: isFinite(dy) && dy >= 1 && dy <= 60 ? dy : null, remark: eatText(d.remark, 200), recv: eatText(d.recv, 60), off: !!d.off, photo: /^[A-Za-z0-9_\-]{10,80}$/.test(String(d.photo || '')) ? String(d.photo) : '' }; if (parts.length) nd.parts = parts; return nd; }
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
  var mode = EAT_MODES.indexOf(req.mode) >= 0 ? req.mode : 'entry';
  if (!s.fails) s.fails = {}; if (!s.lock) s.lock = {};
  if (!s[mode]) return { ok: false, error: mode === 'delivery' ? 'no_pin' : 'empty' };
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
  /* the photo of a delivery note: saved on Drive and read by the photo reader; nothing is written in the database here */
  if (a === 'read') {
    if (mode === 'entry') return { ok: false, error: 'rights' };
    if (!store.read || !(store.readerOn && store.readerOn())) return { ok: false, error: 'no_reader' };
    var img = String(req.image || '');
    if (!img || img.length > 6000000 || !/^[A-Za-z0-9+\/=]+$/.test(img)) return { ok: false, error: 'image' };
    try { return store.read(img, db); } catch (err) { return { ok: false, error: 'reader', detail: String(err).slice(0, 200) }; }
  }
  if (a === 'reader_key') {
    if (mode !== 'admin' || !store.setReaderKey) return { ok: false, error: 'rights' };
    store.setReaderKey(String(req.value || '').trim());
    return { ok: true, reader: !!(store.readerOn && store.readerOn()) };
  }
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
  out.ok = true; out.results = results; out.rev = db.rev; out.now = now; out.full = since === 0; out.reader = !!(store.readerOn && store.readerOn()); if (mode === 'admin' && store.backupInfo) out.backup = store.backupInfo();
  out.entries = [];
  for (i = 0; i < db.entries.length; i++) if (db.entries[i].rev > since) out.entries.push(db.entries[i]);
  out.comments = [];
  for (i = 0; i < db.comments.length; i++) if (db.comments[i].rev > since && (mode === 'admin')) out.comments.push(db.comments[i]);
  return out;
}

/* ===== Google side: the Google Sheet shows the counts; Drive holds the database file and a daily copy =====
   How to install: open the Google Sheet "CYP EAT database" > Extensions > Apps Script > paste this whole file > Save.
   Run "setup" once. Then Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
   Write the web app URL in WEB_APP_URL (near the end of this file) and run "link": the link for the staff appears in the sheet "link". */
var SHEET_ID = ''; /* leave empty when the script is opened from inside the Sheet */
var DB_FILE = 'cyp-eat-database.json';
var PEOPLE_HEAD = ['Date', 'Centre', 'Meal', 'Plates', 'Counted by', 'Saved', 'Key'];
var FOOD_HEAD = ['Date', 'Centre', 'Meal', 'Step', 'Details', 'By', 'Saved', 'Key'];
var STOCK_HEAD = ['Date', 'Centre', 'What', 'Details', 'By', 'Saved', 'Key'];
var NOTE_HEAD = ['Note no.', 'Date', 'Centre', 'Items', 'Remark', 'Received by', 'Copied by', 'Saved', 'Key'];
var LOG_HEAD = ['Time', 'Who', 'Action', 'Detail'];
var COM_HEAD = ['Time', 'Who', 'Centre', 'Screen', 'Comment', 'Version', 'Done', 'Id'];
var BOOK_ = null;
function props_() { return PropertiesService.getScriptProperties(); }
function book_() { if (!BOOK_) BOOK_ = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); return BOOK_; }
function sheet_(name, head) {
  var sh = book_().getSheetByName(name);
  if (!sh) { sh = book_().insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function folder_() { var it = DriveApp.getFileById(book_().getId()).getParents(); return it.hasNext() ? it.next() : DriveApp.getRootFolder(); }
function when_(iso) { return iso ? Utilities.formatDate(new Date(iso), 'Africa/Lusaka', 'yyyy-MM-dd HH:mm') : ''; }
function safe_(t) { t = String(t == null ? '' : t); return /^[=+\-@]/.test(t) ? "'" + t : t; }
/* one row for each key: a new save of the same meal replaces its row */
function upsert_(sh, head, key, values) {
  var col = head.length, last = sh.getLastRow(), row = 0;
  if (last > 1) { var hit = sh.getRange(2, col, last - 1, 1).createTextFinder(key).matchEntireCell(true).findNext(); if (hit) row = hit.getRow(); }
  if (!row) row = last + 1;
  sh.getRange(row, 1, 1, head.length).setValues([values]);
}
function details_(db, e) {
  var d = e.data || {}, parts = [], id, it;
  if (e.type === 'menu') {
    if (d.mm) parts.push(e.meal === 'Breakfast' ? 'Porridge' : 'Nshima');
    if (d.bread) parts.push('Bread');
    for (var i = 0; i < (d.relish || []).length; i++) { it = eatItem(db, d.relish[i]); if (it) parts.push(it.name); }
    if (d.veg) parts.push(d.veg);
    return parts.join(', ');
  }
  if (e.type === 'skip' || e.type === 'dskip') return d.on ? 'Food not counted' : 'Food counted again';
  if (e.type === 'dmenu') {
    for (var m in (d.meals || {})) {
      var x = d.meals[m], p2 = [];
      if (x.mm) p2.push(m === 'Breakfast' ? 'Porridge' : 'Nshima');
      if (x.other) p2.push(x.other);
      for (var j = 0; j < (x.relish || []).length; j++) { it = eatItem(db, x.relish[j]); if (it) p2.push(it.name); }
      if (x.veg) p2.push(x.veg);
      parts.push(m + ': ' + p2.join(', '));
    }
    if (d.cook) parts.push('Cook: ' + d.cook);
    return parts.join(' | ');
  }
  var q = d.q || {}, nc = d.nc || {};
  for (id in q) {
    if (id === 'pcs') { parts.push('Chicken pieces ' + (nc.pcs ? 'not counted' : q[id])); continue; }
    it = eatItem(db, id); if (!it) continue;
    var unit = e.type === 'received' || e.type === 'endweek' || e.type === 'startweek' || e.type === 'note' || (d.u && d.u[id] === 'unit') ? it.unit : it.use;
    parts.push(it.name + ' ' + (nc[id] || q[id] == null ? 'not counted' : q[id] + ' ' + unit));
  }
  if (e.type === 'note') (d.parts || []).forEach(function (pt) { var w = []; for (var k in pt.q) { var pit = eatItem(db, k); if (pit) w.push(pt.q[k] + ' ' + pit.unit + ' of ' + pit.name.toLowerCase()); } parts.push('Of which for ' + pt.name + ': ' + w.join(', ')); });
  if (e.type === 'note' && d.days) parts.push('Should last ' + d.days + (d.days === 1 ? ' day' : ' days'));
  if (e.type === 'after' && (d.kept != null || d.keptNc)) parts.push('Meals kept for later: ' + (d.keptNc ? 'not counted' : d.kept));
  return parts.join('; ');
}
var STEP_ = { menu: 'What we eat', before: 'Quantities before', after: 'Quantities after', skip: 'Food not counted', received: 'Food delivered', endweek: 'End of the week', startweek: 'Start of the week', dmenu: 'What we eat today', dbefore: 'Quantities for today', dafter: 'Leftovers', dskip: 'Food not counted' };
function mirror_(db, list) {
  if (!list.length) return;
  for (var i = 0; i < list.length; i++) {
    var e = list[i], c = eatCentre(db, e.centre), cn = c ? c.name : e.centre;
    if (e.type === 'note') upsert_(sheet_('deliveries', NOTE_HEAD), NOTE_HEAD, e.key, [Number(e.data.no), e.date, cn, e.data.off ? 'Removed' : safe_(details_(db, e)), safe_(e.data.remark + (e.data.photo ? (e.data.remark ? ' · ' : '') + 'photo: https://drive.google.com/file/d/' + e.data.photo + '/view' : '')), safe_(e.data.recv), safe_(e.byName), when_(e.saved), e.key]);
    else if (e.type === 'people') upsert_(sheet_('people', PEOPLE_HEAD), PEOPLE_HEAD, e.key, [e.date, cn, e.meal, e.data.g ? eatPlates(e) + ' (' + e.data.n + ' ' + cn + Object.keys(e.data.g).map(function (k) { return ', ' + e.data.g[k] + ' ' + k; }).join('') + ')' : e.data.n, safe_(e.byName), when_(e.saved), e.key]);
    else if (e.type === 'received' || e.type === 'endweek' || e.type === 'startweek') upsert_(sheet_('stock', STOCK_HEAD), STOCK_HEAD, e.key, [e.date, cn, STEP_[e.type], safe_(details_(db, e)), safe_(e.byName), when_(e.saved), e.key]);
    else upsert_(sheet_('food', FOOD_HEAD), FOOD_HEAD, e.key, [e.date, cn, e.meal || 'Whole day', STEP_[e.type], safe_(details_(db, e)), safe_(e.byName), when_(e.saved), e.key]);
  }
}
function comments_(list) {
  if (!list.length) return;
  var sh = sheet_('comments', COM_HEAD);
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    upsert_(sh, COM_HEAD, c.id, [when_(c.at), safe_(c.byName), c.centre, safe_(c.screen), safe_(c.text), c.version, c.done ? 'Done' : '', c.id]);
  }
}
function audit_(list) {
  if (!list.length) return;
  var sh = sheet_('log', LOG_HEAD), rows = [];
  for (var i = 0; i < list.length; i++) rows.push([when_(list[i].time), safe_(list[i].who), list[i].action, safe_(list[i].detail)]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEAD.length).setValues(rows);
}
function store_() {
  var P = props_();
  return {
    key: function () { return P.getProperty('key') || ''; },
    now: function () { return new Date().toISOString(); },
    load: function () { var id = P.getProperty('dbId'); return id ? JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8')) : null; },
    readerOn: readerOn_,
    setReaderKey: function (v) { if (v) props_().setProperty('geminiKey', v); else props_().deleteProperty('geminiKey'); },
    read: readNote_,
    backupInfo: backupInfo_,
    save: function (db, info) {
      var text = JSON.stringify(db), id = P.getProperty('dbId'), f = folder_();
      if (id) DriveApp.getFileById(id).setContent(text); else P.setProperty('dbId', f.createFile(DB_FILE, text, 'application/json').getId());
      var day = new Date().toISOString().slice(0, 10);
      if (P.getProperty('backupDay') !== day) { f.createFile('cyp-eat-backup-' + day + '.json', text, 'application/json'); P.setProperty('backupDay', day); }
      if (info) { mirror_(db, info.entries || []); audit_(info.audit || []); comments_(info.comments || []); }
    }
  };
}
/* ===== the photo reader: a photo of a delivery note, saved on Drive and read by Gemini =====
   The key is written from the app (Overview > Settings > Photo reader) and kept in the script properties, never in the database. */
var PHOTO_DIR = 'CYP EAT delivery photos';
function photoFolder_() { var f = folder_(), it = f.getFoldersByName(PHOTO_DIR); return it.hasNext() ? it.next() : f.createFolder(PHOTO_DIR); }
function readerOn_() { return !!props_().getProperty('geminiKey'); }
function readerPrompt_(db) {
  var places = eatPlaces(db).map(function (c) { return c.name; }).join('; ');
  var items = db.items.map(function (it) { return it.id + ' = ' + it.name + ' (in ' + it.unit + ')'; }).join('; ');
  return 'You read a photo of a paper delivery note of Self Reliance, the farm and butchery of the Pope John XXIII Association in Ndola, Zambia. ' +
    'The note has a printed red number, a date, the place the food goes to, lines with a quantity and an item, and "received by". ' +
    'The photo often shows the booklet open, with two notes side by side: read every note in the photo. ' +
    'Return only this JSON: {"notes": [{"readable": true or false, "note_number": "the digits of the red number, or empty", "date": "YYYY-MM-DD, or empty", ' +
    '"place": "the place the food goes to (after M/s): one of ' + places + ', or the name as written", "items": [{"item": "item id", "quantity": number}], ' +
    '"for_others": [{"place": "the other place", "items": [{"item": "item id", "quantity": number}]}], ' +
    '"received_by": "the name, or empty", "remark": "anything else written, short"}]}. ' +
    '"for_others": only when the note says that a part of the food is for another place, for example "02 chickens for Chinika House" written or circled on a note for Minsundu: ' +
    'then "items" keeps the whole quantity of the line (26 chickens) and "for_others" has the part (2 chickens for Chinika House). Otherwise leave it empty. ' +
    'Item ids: ' + items + '. Give each quantity in the unit in brackets: mealie meal in bags (packs or bags of mealie meal are bags), eggs in trays, chickens as whole chickens, pork and fish in kg. ' +
    'Halves and quarters as 0.5 and 0.25. Dates are written day/month/year; the year is 20' + new Date().getFullYear().toString().slice(2) + ' if not written. ' +
    'If a note is empty, cut, or its number or quantities cannot be read, set its "readable" to false. If the photo shows no delivery note, return {"notes": []}.';
}
function readNote_(img, db) {
  var key = props_().getProperty('geminiKey'); if (!key) return { ok: false, error: 'no_reader' };
  var name = 'delivery-' + Utilities.formatDate(new Date(), 'Africa/Lusaka', 'yyyy-MM-dd_HHmmss') + '.jpg';
  var file = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(img), 'image/jpeg', name));
  var body = { contents: [{ parts: [{ text: readerPrompt_(db) }, { inline_data: { mime_type: 'image/jpeg', data: img } }] }], generationConfig: { responseMimeType: 'application/json' } };
  /* Flash-Lite reads a photo in about 10 seconds. Flash takes one to two minutes on the free key (20/11/2026): it is used only
     if the Flash-Lite name stops existing. A note Flash-Lite cannot read is photographed again: that is faster than waiting. */
  var models = [props_().getProperty('geminiModel') || 'gemini-flash-lite-latest', 'gemini-flash-latest'], best = null, last = '';
  for (var i = 0; i < models.length && !best; i++) {
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', { method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true });
    var code = res.getResponseCode(); last = code + ' ' + res.getContentText().slice(0, 160);
    if (code === 404) continue;
    if (code !== 200) return { ok: false, error: code === 400 || code === 403 ? 'reader_key' : (code === 429 ? 'reader_busy' : 'reader'), detail: last, photo: file.getId() };
    var out = JSON.parse(res.getContentText()), parts = (((out.candidates || [])[0] || {}).content || {}).parts || [], text = '';
    for (var j = 0; j < parts.length; j++) if (parts[j].text) text += parts[j].text;
    var r; try { r = JSON.parse(text.replace(/^\s*```(?:json)?/, '').replace(/```\s*$/, '')); } catch (e) { return { ok: false, error: 'reader', detail: 'not json', photo: file.getId() }; }
    var notes = (r.notes || (r.note_number !== undefined ? [r] : [])).map(function (n) { return readOne_(n, db); });
    best = { notes: notes, model: models[i] };
  }
  if (!best) return { ok: false, error: 'reader', detail: last, photo: file.getId() };
  return { ok: true, photo: file.getId(), reads: best.notes, read: best.notes[0] || { clear: false, no: '', date: '', centre: '', q: {} }, model: best.model };
}
function placeId_(text, db) { return eatPlaceMatch(db, text); }
function readItems_(list, db) { var q = {}; (list || []).forEach(function (x) { var it = eatItem(db, String(x.item || '')); var n = eatNum(x.quantity); if (it && n) q[it.id] = (q[it.id] || 0) + n; }); return q; }
function readOne_(r, db) {
  var centre = placeId_(r.place, db), q = readItems_(r.items, db), parts = [];
  /* a part for another place: only for items on the note, and not more than the note has */
  (r.for_others || []).forEach(function (o) {
    var pq = readItems_(o.items, db), ok = {}, any = false, to = placeId_(o.place, db), name = eatText(o.place, 60);
    for (var id in pq) if (q[id]) { ok[id] = Math.min(pq[id], q[id]); any = true; }
    if (any && name && to !== centre) parts.push({ to: to, name: to ? eatCentre(db, to).name : name, q: ok });
  });
  return { clear: r.readable !== false, no: eatNoteNo(r.note_number), date: eatIsDate(r.date) ? r.date : '', centre: centre, placeText: eatText(r.place, 60), q: q, parts: parts, recv: eatText(r.received_by, 60), remark: eatText(r.remark, 200) };
}
/* Run once from the editor after this update: Google asks Mauro to allow the photo reader (internet calls and the photo folder). */
function authorize() { UrlFetchApp.fetch('https://generativelanguage.googleapis.com/', { muteHttpExceptions: true }); photoFolder_(); Logger.log('Done: the photo reader is allowed. The key is written in the app: Overview > Settings > Photo reader.'); }
/* ===== the backup of every night: a copy of the database file in the folder "CYP EAT backups", at 2:00 (Ndola time) =====
   installBackup() is run once from the editor; Google then runs nightlyBackup() by itself every night. */
var BACKUP_DIR = 'CYP EAT backups';
function backupFolder_() { var f = folder_(), it = f.getFoldersByName(BACKUP_DIR); return it.hasNext() ? it.next() : f.createFolder(BACKUP_DIR); }
function nightlyBackup() {
  var id = props_().getProperty('dbId'); if (!id) return;
  var text = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'), db = JSON.parse(text);
  var name = 'cyp-eat-backup-' + Utilities.formatDate(new Date(), 'Africa/Lusaka', 'yyyy-MM-dd_HHmm') + '.json';
  backupFolder_().createFile(name, text, 'application/json');
  props_().setProperty('backupLast', new Date().toISOString());
  Logger.log('Backup saved: ' + name + ' (' + db.entries.length + ' entries, ' + Math.round(text.length / 1024) + ' KB)');
}
function installBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'nightlyBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlyBackup').timeBased().everyDays(1).atHour(2).nearMinute(0).inTimezone('Africa/Lusaka').create();
  props_().setProperty('backupOn', '1');
  nightlyBackup();
  Logger.log('Done: a backup is saved every night at about 2:00 (Ndola time), in the folder "' + BACKUP_DIR + '". One was saved now.');
}
function backupInfo_() { return { on: props_().getProperty('backupOn') === '1', last: props_().getProperty('backupLast') || '' }; }
function reply_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  var lock = null;
  try {
    var req = JSON.parse(e.postData.contents);
    /* one phone at a time, so two saves never overwrite each other */
    /* reading a photo takes several seconds and writes nothing in the database: it does not wait for the others */
    if (req.action !== 'hello' && req.action !== 'read') { lock = LockService.getScriptLock(); lock.waitLock(25000); }
    return reply_(eatHandle(req, store_()));
  } catch (err) { return reply_({ ok: false, error: 'server', detail: String(err) }); }
  finally { if (lock) { try { lock.releaseLock(); } catch (x) {} } }
}
function doGet(e) { return ContentService.createTextOutput('CYP EAT shared database'); }
/* Run once from the editor: prepares the sheets and the key. */
function setup() {
  sheet_('people', PEOPLE_HEAD); sheet_('food', FOOD_HEAD); sheet_('stock', STOCK_HEAD); sheet_('deliveries', NOTE_HEAD); sheet_('log', LOG_HEAD); sheet_('comments', COM_HEAD);
  if (!props_().getProperty('key')) props_().setProperty('key', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('Ready. Now: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone. Then write the web app URL in WEB_APP_URL and run the function "link".');
}
/* Run after the deployment: writes the link for the staff in the sheet "link". */
var WEB_APP_URL = '';
var APP_URL = 'https://maurobif-blip.github.io/cyp-eat/';
function link() {
  if (!WEB_APP_URL) { Logger.log('Write the web app URL (it ends with /exec) in WEB_APP_URL, then run "link" again.'); return; }
  var code = Utilities.base64EncodeWebSafe(WEB_APP_URL + '|' + props_().getProperty('key')).replace(/=+$/, '');
  var sh = sheet_('link', ['CYP EAT: link for the people who count. Keep it inside the team. They also need the data entry PIN.']);
  sh.getRange(2, 1).setValue(APP_URL + '?db=' + code);
  sh.setColumnWidth(1, 900);
  Logger.log('Done. The link is in the sheet "link", cell A2.');
}
