/* CYP EAT: the rules. The same text runs in the Google script (shared database), in the app (to show a change at once)
   and in the tests. Plain ES5 so it runs everywhere. */
var EAT_VERSION = 'alpha 0.1';
var EAT_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
var EAT_ROLES = ['Volunteer', 'Canteen', 'Educator'];
var EAT_TYPES = ['people', 'menu', 'before', 'after', 'skip', 'received', 'endweek'];
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
    { id: 'veg', name: 'Vegetables', unit: 'kg', use: 'kg', per: 1, stock: false }
  ];
}
function eatDefaultCentres() {
  return [
    { id: 'MIN', name: 'Minsundu', meals: ['Breakfast', 'Lunch', 'Dinner'] },
    { id: 'LUI', name: 'Luigi', meals: ['Lunch'] },
    { id: 'NKW', name: 'Nkwazi', meals: ['Lunch', 'Dinner'] },
    { id: 'MCU', name: 'Mary Christine / Ukubalula', meals: ['Lunch'] }
  ];
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
function eatNum(x) { if (x === '' || x == null) return null; var n = Number(x); return isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null; }
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
  if (m) return { saved: true, mm: !!m.data.mm, relish: (m.data.relish || []).slice(), veg: m.data.veg || '' };
  if (meal === 'Breakfast') return { saved: false, mm: true, relish: [], veg: '' };
  return { saved: false, mm: true, relish: [EAT_PLAN[eatWeekday(date)]], veg: '' };
}
function eatRows(db, centre, date, meal) {
  var m = eatMenuOf(db, centre, date, meal), rows = [];
  if (m.mm) rows.push('mm');
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

/* what one meal used. used[item] is in "use" units; null = not counted. */
function eatMealUse(db, centre, date, meal) {
  var out = { skipped: false, hasBefore: false, hasAfter: false, used: {}, pieces: null, plates: null, kept: null, base: null };
  var p = eatGet(db, 'people', centre, date, meal); if (p) out.plates = p.data.n;
  var sk = eatGet(db, 'skip', centre, date, meal);
  if (sk && sk.data.on) { out.skipped = true; return out; }
  var b = eatGet(db, 'before', centre, date, meal), a = eatGet(db, 'after', centre, date, meal);
  if (!b) return out;
  out.hasBefore = true; out.hasAfter = !!a;
  var bq = b.data.q || {}, bnc = b.data.nc || {}, aq = a ? (a.data.q || {}) : {}, anc = a ? (a.data.nc || {}) : {};
  for (var id in bq) {
    if (id === 'pcs') continue;
    if (bnc[id] || bq[id] == null) { out.used[id] = null; continue; }
    if (a && (anc[id])) { out.used[id] = null; continue; }
    var back = a && aq[id] != null ? aq[id] : 0;
    out.used[id] = Math.max(0, Math.round((bq[id] - back) * 1000) / 1000);
  }
  for (id in bnc) if (bnc[id]) out.used[id] = null;
  if (bq.pcs != null && !bnc.pcs) out.pieces = Math.max(0, bq.pcs - (a && aq.pcs != null && !anc.pcs ? aq.pcs : 0));
  if (a && a.data.kept != null && !a.data.keptNc) out.kept = a.data.kept;
  if (out.plates != null) out.base = out.plates + (out.kept || 0);
  return out;
}
/* per plate needs the quantities after and the people count */
function eatPerPlate(use, id) {
  if (!use.hasAfter || use.base == null || use.base <= 0 || use.used[id] == null) return null;
  return use.used[id] / use.base;
}

/* stock of one centre on a day: last end-of-week count before that day, plus received, minus used, up to that day */
function eatStock(db, centre, upTo) {
  var last = null, i, e;
  for (i = 0; i < db.entries.length; i++) {
    e = db.entries[i];
    if (e.del || e.type !== 'endweek' || e.centre !== centre || e.date >= upTo) continue;
    if (!last || e.date > last.date) last = e;
  }
  var from = last ? last.date : '', out = {}, items = db.items;
  for (i = 0; i < items.length; i++) {
    var it = items[i]; if (!it.stock) continue;
    var start = last ? (last.data.nc && last.data.nc[it.id] ? null : (last.data.q[it.id] != null ? last.data.q[it.id] : 0)) : 0;
    out[it.id] = { start: start, startDate: from, inn: 0, used: 0, usedOk: true, expected: null };
  }
  for (i = 0; i < db.entries.length; i++) {
    e = db.entries[i];
    if (e.del || e.centre !== centre || e.date <= from || e.date > upTo) continue;
    if (e.type === 'received') for (var id in e.data.q) if (out[id] && e.data.q[id] != null) out[id].inn += e.data.q[id];
  }
  var c = eatCentre(db, centre), meals = c ? c.meals : EAT_MEALS, d = from ? eatAddDays(from, 1) : null;
  /* without a count, the stock starts at the first entry of the centre */
  if (!d) { d = upTo; for (i = 0; i < db.entries.length; i++) { e = db.entries[i]; if (!e.del && e.centre === centre && e.date < d) d = e.date; } }
  for (var guard = 0; d <= upTo && guard < 400; d = eatAddDays(d, 1), guard++) {
    for (var m = 0; m < meals.length; m++) {
      var u = eatMealUse(db, centre, d, meals[m]);
      if (!u.hasBefore) continue;
      for (id in out) {
        if (!(id in u.used)) continue;
        var it2 = eatItem(db, id);
        if (u.used[id] == null || !it2.per) { out[id].usedOk = false; continue; }
        out[id].used += u.used[id] / it2.per;
      }
    }
  }
  for (id in out) {
    var s = out[id]; s.used = Math.round(s.used * 100) / 100; s.inn = Math.round(s.inn * 100) / 100;
    s.expected = s.start == null || !s.usedOk ? null : Math.round((s.start + s.inn - s.used) * 100) / 100;
  }
  return out;
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
    if (['received', 'endweek'].indexOf(e.type) >= 0) meal = '';
    var key = eatKey(e.type, e.centre, e.date, meal), old = eatIndex(db)[key] || null;
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
  if (type === 'menu') { var r = []; for (var i = 0; i < (d.relish || []).length; i++) { var it = eatItem(db, d.relish[i]); if (it && it.relish && r.indexOf(it.id) < 0) r.push(it.id); } return { mm: !!d.mm, relish: r, veg: eatText(d.veg, 60) }; }
  if (type === 'before' || type === 'after') { var o = { q: qs(d.q), nc: ncs(d.nc) }; if (type === 'after') { o.kept = eatNum(d.kept); o.keptNc = !!d.keptNc; } return o; }
  if (type === 'skip') return { on: !!d.on };
  if (type === 'received') return { q: qs(d.q) };
  if (type === 'endweek') return { q: qs(d.q), nc: ncs(d.nc) };
  return {};
}

/* ---------- the shared database: one request at a time ---------- */
function eatHandle(req, store) {
  if (!req || !store.key() || req.key !== store.key()) return { ok: false, error: 'key' };
  var db = store.load() || eatNewDb(), now = store.now(), a = req.action, s = db.settings, i;
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
  var dirty = false;
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

/* ===== Google side: the Google Sheet shows the counts; Drive holds the database file and a daily copy =====
   How to install: open the Google Sheet "CYP EAT database" > Extensions > Apps Script > paste this whole file > Save.
   Run "setup" once. Then Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
   Write the web app URL in WEB_APP_URL (near the end of this file) and run "link": the link for the staff appears in the sheet "link". */
var SHEET_ID = ''; /* leave empty when the script is opened from inside the Sheet */
var DB_FILE = 'cyp-eat-database.json';
var PEOPLE_HEAD = ['Date', 'Centre', 'Meal', 'Plates', 'Counted by', 'Saved', 'Key'];
var FOOD_HEAD = ['Date', 'Centre', 'Meal', 'Step', 'Details', 'By', 'Saved', 'Key'];
var STOCK_HEAD = ['Date', 'Centre', 'What', 'Details', 'By', 'Saved', 'Key'];
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
    if (d.mm) parts.push('Nshima');
    for (var i = 0; i < (d.relish || []).length; i++) { it = eatItem(db, d.relish[i]); if (it) parts.push(it.name); }
    if (d.veg) parts.push(d.veg);
    return parts.join(', ');
  }
  if (e.type === 'skip') return d.on ? 'Food not counted' : 'Food counted again';
  var q = d.q || {}, nc = d.nc || {};
  for (id in q) {
    if (id === 'pcs') { parts.push('Chicken pieces ' + (nc.pcs ? 'not counted' : q[id])); continue; }
    it = eatItem(db, id); if (!it) continue;
    var unit = e.type === 'received' || e.type === 'endweek' ? it.unit : it.use;
    parts.push(it.name + ' ' + (nc[id] || q[id] == null ? 'not counted' : q[id] + ' ' + unit));
  }
  if (e.type === 'after' && (d.kept != null || d.keptNc)) parts.push('Meals kept for later: ' + (d.keptNc ? 'not counted' : d.kept));
  return parts.join('; ');
}
var STEP_ = { menu: 'What we eat', before: 'Quantities before', after: 'Quantities after', skip: 'Food not counted', received: 'Received', endweek: 'End of week count' };
function mirror_(db, list) {
  if (!list.length) return;
  for (var i = 0; i < list.length; i++) {
    var e = list[i], c = eatCentre(db, e.centre), cn = c ? c.name : e.centre;
    if (e.type === 'people') upsert_(sheet_('people', PEOPLE_HEAD), PEOPLE_HEAD, e.key, [e.date, cn, e.meal, e.data.n, safe_(e.byName), when_(e.saved), e.key]);
    else if (e.type === 'received' || e.type === 'endweek') upsert_(sheet_('stock', STOCK_HEAD), STOCK_HEAD, e.key, [e.date, cn, STEP_[e.type], safe_(details_(db, e)), safe_(e.byName), when_(e.saved), e.key]);
    else upsert_(sheet_('food', FOOD_HEAD), FOOD_HEAD, e.key, [e.date, cn, e.meal, STEP_[e.type], safe_(details_(db, e)), safe_(e.byName), when_(e.saved), e.key]);
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
    save: function (db, info) {
      var text = JSON.stringify(db), id = P.getProperty('dbId'), f = folder_();
      if (id) DriveApp.getFileById(id).setContent(text); else P.setProperty('dbId', f.createFile(DB_FILE, text, 'application/json').getId());
      var day = new Date().toISOString().slice(0, 10);
      if (P.getProperty('backupDay') !== day) { f.createFile('cyp-eat-backup-' + day + '.json', text, 'application/json'); P.setProperty('backupDay', day); }
      if (info) { mirror_(db, info.entries || []); audit_(info.audit || []); comments_(info.comments || []); }
    }
  };
}
function reply_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  var lock = null;
  try {
    var req = JSON.parse(e.postData.contents);
    /* one phone at a time, so two saves never overwrite each other */
    if (req.action !== 'hello') { lock = LockService.getScriptLock(); lock.waitLock(25000); }
    return reply_(eatHandle(req, store_()));
  } catch (err) { return reply_({ ok: false, error: 'server', detail: String(err) }); }
  finally { if (lock) { try { lock.releaseLock(); } catch (x) {} } }
}
function doGet(e) { return ContentService.createTextOutput('CYP EAT shared database'); }
/* Run once from the editor: prepares the sheets and the key. */
function setup() {
  sheet_('people', PEOPLE_HEAD); sheet_('food', FOOD_HEAD); sheet_('stock', STOCK_HEAD); sheet_('log', LOG_HEAD); sheet_('comments', COM_HEAD);
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
