/**
 * Kindle Highlights — Google Sheets sync backend (Google Apps Script).
 *
 * SETUP (one time, ~2 minutes):
 *  1. Open your Google Sheet (or make a new one at sheets.new).
 *  2. Extensions → Apps Script. Delete any code, paste THIS file in.
 *  3. Change TOKEN below to your own secret (any string).
 *  4. Run the `setup` function once (choose it in the toolbar dropdown, click Run).
 *     Approve the permission prompt. This creates the tabs with headers.
 *  5. Deploy → New deployment → type "Web app".
 *       Execute as: Me.   Who has access: Anyone.
 *     Click Deploy, copy the "/exec" Web app URL.
 *  6. In the app: ⚙ Settings → paste the URL and the same TOKEN → "Test & sync now".
 *
 * To change the code later: edit, then Deploy → Manage deployments → edit → Version:
 * "New version" → Deploy. The URL stays the same.
 */

var TOKEN = 'CHANGE_ME_to_a_secret';   // <-- set this, and paste the same value in the app

var TABS = {
  fav:   { name: 'Favourites', headers: ['id'] },
  del:   { name: 'Deleted',    headers: ['id'] },
  note:  { name: 'Notes',      headers: ['id', 'text'] },
  hl:    { name: 'Highlights', headers: ['id', 'book_title', 'author', 'location', 'text', 'themes', 'addedAt'] },
  book:  { name: 'Books',      headers: ['id', 'title', 'author', 'blurb'] }
};

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (k) {
    var t = TABS[k];
    var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
    if (sh.getLastRow() === 0) sh.appendRow(t.headers);
  });
  // tidy: remove default empty "Sheet1" if present and unused
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.token !== TOKEN) return json({ ok: false, error: 'bad token' });
    var a = body.action;
    if (a === 'ping')   return json({ ok: true, pong: true });
    if (a === 'state')  return json(readState());
    if (a === 'fav')    return json(toggleRow('fav', body.id, body.on));
    if (a === 'del')    return json(toggleRow('del', body.id, body.on));
    if (a === 'note')   return json(setNote(body.id, body.text));
    if (a === 'addHl')  return json(addHl(body.hl, body.newBook));
    return json({ ok: false, error: 'unknown action ' + a });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// GET is handy for a quick browser sanity check
function doGet() {
  return json({ ok: true, hint: 'Kindle Highlights sync is deployed. POST actions from the app.' });
}

function sheet(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = TABS[key];
  var sh = ss.getSheetByName(t.name);
  if (!sh) { sh = ss.insertSheet(t.name); sh.appendRow(t.headers); }
  return sh;
}

function readState() {
  var favSh = sheet('fav'), delSh = sheet('del'), noteSh = sheet('note'), hlSh = sheet('hl'), bookSh = sheet('book');
  var favourites = colValues(favSh, 1);
  var deleted = colValues(delSh, 1);
  var notes = {};
  var nvals = noteSh.getDataRange().getValues();
  for (var i = 1; i < nvals.length; i++) { if (nvals[i][0] !== '') notes[String(nvals[i][0])] = String(nvals[i][1] || ''); }
  var addedHighlights = [];
  var hvals = hlSh.getDataRange().getValues();
  for (var j = 1; j < hvals.length; j++) {
    var r = hvals[j];
    if (r[4] === '' && r[1] === '') continue; // skip blank rows
    addedHighlights.push({
      id: r[0], title: r[1], author: r[2], loc: r[3], text: r[4], themes: r[5], addedAt: r[6]
    });
  }
  var addedBooks = [];
  var bvals = bookSh.getDataRange().getValues();
  for (var k = 1; k < bvals.length; k++) {
    if (bvals[k][1] === '') continue;
    addedBooks.push({ id: bvals[k][0], title: bvals[k][1], author: bvals[k][2], blurb: bvals[k][3] });
  }
  return { ok: true, favourites: favourites, deleted: deleted, notes: notes, addedHighlights: addedHighlights, addedBooks: addedBooks, updatedAt: new Date().toISOString() };
}

function colValues(sh, col) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, col, last - 1, 1).getValues().map(function (r) { return r[0]; }).filter(function (v) { return v !== '' && v !== null; });
}

function findRow(sh, id) {
  var vals = sh.getRange(2, 1, Math.max(0, sh.getLastRow() - 1), 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(id)) return i + 2;
  return -1;
}

function toggleRow(key, id, on) {
  var sh = sheet(key);
  var row = findRow(sh, id);
  if (on) { if (row === -1) sh.appendRow([id]); }
  else { if (row !== -1) sh.deleteRow(row); }
  return { ok: true };
}

function setNote(id, text) {
  var sh = sheet('note');
  var row = findRow(sh, id);
  if (text && String(text).trim()) {
    if (row === -1) sh.appendRow([id, text]);
    else sh.getRange(row, 2).setValue(text);
  } else if (row !== -1) {
    sh.deleteRow(row);
  }
  return { ok: true };
}

function addHl(hl, newBook) {
  var sh = sheet('hl');
  var themes = Array.isArray(hl.themes) ? hl.themes.join(',') : (hl.themes || '');
  var id = hl.id || (Date.now());
  // avoid dup if the same id already present
  if (findRow(sh, id) === -1) {
    sh.appendRow([id, hl.title || '', hl.author || '', hl.loc || '', hl.text || '', themes, hl.addedAt || Date.now()]);
  }
  if (newBook && newBook.title) {
    var bsh = sheet('book');
    if (findRow(bsh, newBook.id) === -1) bsh.appendRow([newBook.id, newBook.title, newBook.author || '', newBook.blurb || '']);
  }
  return { ok: true, id: id };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
