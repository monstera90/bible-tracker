// syncengine_notesbinding_test.js
// Версия: 1.2 (23.09) — группы B/C (тесты «старый клиент», needLive: true, 6 шт.)
// удалены по решению пользователя при верификации шага 5 (23.09): они сравнивали
// новый код с РЕАЛЬНЫМ текстом старого pushDirtyNotes/syncNotesFromCloud, вырезанным
// из mdeditor.js по текстовым маркерам (sliceLive/vm) — но этот код физически удалён
// из mdeditor.js в шаге 5.2, и старой копии файла не сохранилось, так что сравнивать
// больше не с чем ни на какой текущей или будущей версии mdeditor.js. Вместе с тестами
// убраны неиспользуемые больше sliceLive()/LIVE/createLegacyDevice() и needLive-ветка
// раннера. Содержательно это не регресс: совместимость форматов (что новый код читает
// то, что писал старый, и наоборот) была подтверждена этими тестами в 5.1/5.2, пока
// старый код ещё существовал — см. STEP5_VERIFICATION.md, находка 2.
// Версия: 1.1 (23.09) — тест №4 («удаление») обновлён под фактическую
// семантику syncengine_notesbinding.js v1.1 (шаг 5.2, п.2): проверка
// «использован один DELETE» заменена на «DELETE не было, тело стёрто
// тем же PATCH, что и notesMeta (notes/<id>: null)». Раньше тест закладывал
// СТАРУЮ семантику (отдельный DELETE) и падал против актуального кода
// биндинга — несоответствие найдено при верификации шага 5 (23.09).
// Версия: 1.0 (19.09)
//
// Синтетические тесты Шага 5.1 (TASK_UNIFIED_SYNC.md) для syncengine_notesbinding.js.
// Запуск: node syncengine_notesbinding_test.js  (Node 18+, без сети).
//
// Гоняется НАСТОЯЩИЙ код: syncengine.js + syncengine_notescrypto.js +
// syncengine_notesbinding.js. Подменена только сеть — эмулятор Realtime
// Database (syncengine_fakedb.js, null не хранится), обёрнутый в те же три
// функции, что my.js отдаёт mdeditor.js (fetchCloudPath/patchCloud/deleteCloudPath).

'use strict';

var SyncEngine = require('./syncengine.js');
var NotesCrypto = require('./syncengine_notescrypto.js');
var NotesBinding = require('./syncengine_notesbinding.js');
var FakeDb = require('./syncengine_fakedb.js');

var passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) {
  var sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg + '\n      ожидалось: ' + sb + '\n      получено:  ' + sa); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function waitFor(cond, ms) {
  var until = Date.now() + (ms || 1500);
  while (Date.now() < until) { if (await cond()) return true; await sleep(5); }
  return false;
}

var SYNC = 'sync-notes-account-001';

// ---- «облачные» функции my.js поверх эмулятора ------------------------------------
function makeIo(db, ref, hooks) {
  hooks = hooks || {};
  function url(sub) {
    return db.baseUrl + '/syncs/' + ref.id + (sub ? '/' + sub : '') + '.json';
  }
  return {
    fetchCloudPath: async function (sub) {
      if (hooks.onFetch) hooks.onFetch(sub);
      var res = await db.fetch(url(sub), { method: 'GET' });
      if (!res.ok) throw new Error('fetch_' + res.status);
      return res.json();
    },
    patchCloud: async function (patch, o) {
      var res = await db.fetch(url(''), { method: 'PATCH', body: JSON.stringify(patch), keepalive: !!(o && o.keepalive) });
      if (!res.ok) throw new Error('patch_' + res.status);
    },
    deleteCloudPath: async function (sub, o) {
      var res = await db.fetch(url(sub), { method: 'DELETE', keepalive: !!(o && o.keepalive) });
      if (!res.ok) throw new Error('delete_' + res.status);
    },
  };
}

async function cloudPayload(db, ref, noteId) {
  var enc = db.raw('/syncs/' + ref.id + '/notes/' + noteId);
  if (!enc) return null;
  return NotesCrypto.makeNotesHooks(ref.id).decryptHook(enc);
}

// ---- новое устройство: настоящий движок + binding поверх своей notesMap ---------------
var allDevices = [];
function createDevice(db, ref, extra) {
  extra = extra || {};
  var notesMap = new Map();
  var d = {
    notesMap: notesMap, ref: ref, online: true, persistScheduled: 0, persistNow: 0,
    remote: [], logs: [], fetchedSubs: [], inflight: 0, maxInflight: 0,
  };
  var io = makeIo(db, ref, {
    onFetch: function (sub) { d.fetchedSubs.push(sub); },
  });
  if (extra.trackConcurrency) {
    var origFetch = io.fetchCloudPath;
    io.fetchCloudPath = async function (sub) {
      d.inflight++; d.maxInflight = Math.max(d.maxInflight, d.inflight);
      try { return await origFetch(sub); } finally { d.inflight--; }
    };
  }
  d.io = io;
  d.engine = SyncEngine.createEngine();
  d.binding = NotesBinding.createNotesBinding({
    engine: d.engine, io: io,
    makeHooks: extra.makeHooks || NotesCrypto.makeNotesHooks,
    getSyncId: function () { return ref.id; },
    notesMap: notesMap,
    isOnline: function () { return d.online; },
    debounceMs: 5, retryDelays: extra.retryDelays || [15, 30, 60], pushChunkSize: extra.pushChunkSize,
    maxParallelFetch: extra.maxParallelFetch, reconcile: !!extra.reconcile,
    schedulePersist: function () { d.persistScheduled++; },
    persistNow: function () { d.persistNow++; },
    onRemoteApplied: function (e) { d.remote.push(e); },
    log: function (s) { d.logs.push(s); },
  });
  allDevices.push(d);
  return d;
}
function note(name, text, p) { return { name: name, path: p || '', text: text }; }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ==========================================================================
test('save: локальная запись в notesMap СИНХРОННА, объект записи не заменяется, кэш ставится в очередь', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  var p = d.binding.save('n1', note('Первая', 'привет'));
  var rec = d.notesMap.get('n1');
  ok(rec && rec.name === 'Первая' && rec.text === 'привет' && typeof rec.t === 'number', 'запись видна в notesMap сразу после вызова (до await)');
  ok(d.persistScheduled === 1, 'schedulePersist вызван синхронно вместе с записью');
  await p;
  d.binding.save('n1', note('Первая', 'привет2'));
  ok(d.notesMap.get('n1') === rec && rec.text === 'привет2', 'повторная запись правит тот же объект (ссылки mdeditor.js остаются живыми)');
  eq(await d.binding.getDirtyIds(), ['n1'], 'запись поставлена на отправку тем же вызовом');
});

test('формат облака = формат mdeditor.js: notes/<id>={iv,data}, notesMeta/<id>={t,deleted}, ничего лишнего', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  await d.binding.save('n1', note('Заметка', 'текст', 'Папка'));
  var r = await d.binding.pushNow();
  eq([r.pushed, r.failed.length, r.error], [1, 0, null], 'отправлена 1 заметка');
  var t = d.notesMap.get('n1').t;
  eq(db.raw('/syncs/' + SYNC + '/notesMeta/n1'), { t: t, deleted: false }, 'notesMeta открытым текстом: {t, deleted:false}');
  var body = db.raw('/syncs/' + SYNC + '/notes/n1');
  eq(Object.keys(body).sort(), ['data', 'iv'], 'тело — объект с двумя полями iv и data');
  eq(await cloudPayload(db, ref, 'n1'), { name: 'Заметка', path: 'Папка', text: 'текст' }, 'расшифровка даёт {name, path, text}');
  eq(Object.keys(db.raw('/syncs/' + SYNC)).sort(), ['notes', 'notesMeta'], 'в /syncs/<id> появились только notes и notesMeta');
  eq(await d.binding.getDirtyIds(), [], 'после успешной отправки dirty снят');
});

test('debounce: пачка быстрых правок — один PATCH, в облаке последняя версия', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  for (var i = 1; i <= 5; i++) { d.binding.save('n1', note('Н', 'версия ' + i)); }
  ok(await waitFor(function () { return db.raw('/syncs/' + SYNC + '/notesMeta/n1'); }), 'автоотправка сработала сама (без ручного pushNow)');
  await sleep(30);
  eq(db.callsBy('PATCH').length, 1, 'ушёл ровно один PATCH');
  eq((await cloudPayload(db, ref, 'n1')).text, 'версия 5', 'в облаке последняя версия');
});

test('удаление: notes/<id> стирается физически, в notesMeta остаётся {t, deleted:true}; запись остаётся тумбстоуном', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  await d.binding.save('n1', note('Н', 'текст'));
  await d.binding.pushNow();
  ok(db.raw('/syncs/' + SYNC + '/notes/n1') !== null, 'до удаления тело есть');
  await d.binding.remove('n1');
  var rec = d.notesMap.get('n1');
  ok(rec.deleted === true && rec.text === '' && rec.name === 'Н', 'локально: deleted=true, текст очищен, имя сохранено');
  await d.binding.pushNow();
  eq(db.raw('/syncs/' + SYNC + '/notes/n1'), null, 'тело в облаке стёрто физически');
  eq(db.raw('/syncs/' + SYNC + '/notesMeta/n1'), { t: rec.t, deleted: true }, 'в notesMeta — тумбстоун {t, deleted:true}');
  // Решение пользователя (шаг 5.2, п.2, syncengine_notesbinding.js v1.1): удаление
  // тела объединено в тот же PATCH, что и notesMeta (значение null), отдельного
  // DELETE-запроса больше нет — io.deleteCloudPath остаётся в контракте конструктора,
  // но pushOnce его не вызывает. Было: ok(db.callsBy('DELETE').length === 1, ...).
  ok(db.callsBy('DELETE').length === 0, 'отдельного DELETE не было (v1.1: тело стирается тем же PATCH)');
  var deletePatch = db.callsBy('PATCH').find(function (c) { return c.body && c.body['notes/n1'] === null; });
  ok(!!deletePatch, 'в PATCH-теле было notes/n1: null');
  ok(deletePatch.body['notesMeta/n1'] && deletePatch.body['notesMeta/n1'].deleted === true, 'и notesMeta/n1 с deleted:true в том же PATCH');
});

test('remove несуществующей записи — ничего не делает', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  eq(await d.binding.remove('нет-такой'), null, 'вернул null');
  ok(!d.notesMap.has('нет-такой'), 'фантомная запись в notesMap не появилась');
  eq(await d.binding.getDirtyIds(), [], 'dirty пуст');
});

test('pull двухступенчатый: один GET notesMeta, тела — только у новых заметок', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Раз', 'один')); await a.binding.save('n2', note('Два', 'два')); await a.binding.save('n3', note('Три', 'три'));
  await a.binding.pushNow();
  var r = await b.binding.pullNow();
  eq([r.applied, r.hadFetchError, r.error], [3, false, null], 'B получил 3 заметки');
  eq(b.fetchedSubs, ['notesMeta', 'notes/n1', 'notes/n2', 'notes/n3'], 'один GET notesMeta + по GET тела на каждую новую заметку');
  b.fetchedSubs.length = 0;
  r = await b.binding.pullNow();
  eq([r.applied, r.skipped], [0, 3], 'повторный pull: ничего нового');
  eq(b.fetchedSubs, ['notesMeta'], 'повторный pull — ТОЛЬКО лёгкий GET notesMeta, ни одного тела');
  await a.binding.save('n2', note('Два', 'два (правка)')); await a.binding.pushNow();
  b.fetchedSubs.length = 0;
  r = await b.binding.pullNow();
  eq(b.fetchedSubs, ['notesMeta', 'notes/n2'], 'после правки одной заметки тянется только её тело');
  eq(b.notesMap.get('n2').text, 'два (правка)', 'правка применена');
});

test('onRemoteApplied: получает rec и снимок prev; persistNow вызывается после применения чужих правок', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Старое имя', 'v1')); await a.binding.pushNow();
  await b.binding.pullNow();
  b.remote.length = 0; b.persistNow = 0;
  await sleep(3);
  await a.binding.save('n1', note('Новое имя', 'v2', 'Папка')); await a.binding.pushNow();
  await b.binding.pullNow();
  eq(b.remote.length, 1, 'колбэк вызван один раз');
  var e = b.remote[0];
  eq([e.id, e.deleted, e.rec.name, e.rec.text, e.rec.path], ['n1', false, 'Новое имя', 'v2', 'Папка'], 'rec — новое состояние');
  eq([e.prev.name, e.prev.text], ['Старое имя', 'v1'], 'prev — состояние ДО применения (нужно для nameIndex)');
  ok(b.persistNow === 1, 'persistNow вызван один раз');
  b.remote.length = 0;
  await b.binding.pullNow();
  eq([b.remote.length, b.persistNow], [0, 1], 'без изменений колбэк и persistNow не вызываются');
});

test('LWW: новее в облаке — побеждает облако; новее локально — локальная остаётся и НЕ затирается pull-ом; при равенстве — локальная', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Н', 'a1')); await a.binding.pushNow();
  await b.binding.pullNow();
  await sleep(3);
  await b.binding.save('n1', note('Н', 'b2 (новее)'));  // локальная у B новее облака (не отправлена)
  await b.binding.pullNow();
  eq(b.notesMap.get('n1').text, 'b2 (новее)', 'pull не затирает более новую локальную правку');
  await b.binding.pushNow();
  await a.binding.pullNow();
  eq(a.notesMap.get('n1').text, 'b2 (новее)', 'после отправки A получает правку B');
  var t = a.notesMap.get('n1').t;
  var r = await a.binding.pullNow();
  eq([r.applied, a.notesMap.get('n1').t === t], [0, true], 'равная метка — ничего не применяется');
});

test('чужой тумбстоун применяется, локальная запись новее тумбстоуна — выживает', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Удаляемая', 'текст')); await a.binding.save('n2', note('Живая', 'текст'));
  await a.binding.pushNow();
  await b.binding.pullNow();
  await sleep(3);
  await a.binding.remove('n1'); await a.binding.remove('n2'); await a.binding.pushNow();
  await sleep(3);
  await b.binding.save('n2', note('Живая', 'правка после удаления на A'));
  await b.binding.pullNow();
  ok(b.notesMap.get('n1').deleted === true && b.notesMap.get('n1').text === '', 'n1: тумбстоун применён, текст очищен');
  ok(!b.notesMap.get('n2').deleted && b.notesMap.get('n2').text === 'правка после удаления на A', 'n2: более новая локальная правка не потеряна');
  eq(b.remote.filter(function (e) { return e.deleted; }).map(function (e) { return e.id; }), ['n1'], 'onRemoteApplied сообщил об удалении n1 (mdeditor.js закроет открытый редактор)');
});

test('тумбстоун для заметки, которой у устройства не было, создаёт запись-тумбстоун (как старый код)', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, b = createDevice(db, ref);
  db.seed('/syncs/' + SYNC + '/notesMeta/nX', { t: 12345, deleted: true });
  await b.binding.pullNow();
  var rec = b.notesMap.get('nX');
  ok(rec && rec.deleted === true && rec.t === 12345 && rec.text === '', 'создан тумбстоун с t из облака');
});

test('ошибки чтения: сбой одного тела / чужой ключ / битый payload → остальные применены, hadFetchError=true', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Раз', 'один')); await a.binding.save('n2', note('Два', 'два')); await a.binding.save('n3', note('Три', 'три'));
  await a.binding.pushNow();
  // n2: тело зашифровано чужим ключом; n3: расшифровывается, но не объект заметки
  var foreign = await NotesCrypto.makeNotesHooks('чужой-аккаунт').encryptHook(note('Два', 'чужое'));
  db.seed('/syncs/' + SYNC + '/notes/n2', foreign);
  var bad = await NotesCrypto.makeNotesHooks(SYNC).encryptHook([1, 2, 3]);
  db.seed('/syncs/' + SYNC + '/notes/n3', bad);
  var r = await b.binding.pullNow();
  eq([r.applied, r.hadFetchError, r.failedIds.sort()], [1, true, ['n2', 'n3']], 'применена n1; n2 и n3 пропущены, флаг поднят');
  ok(!b.notesMap.has('n2') && !b.notesMap.has('n3'), 'битые записи НЕ попали в notesMap (в старом коде n3 стала бы записью с name=undefined)');
});

test('сеть: сбой GET notesMeta не бросает исключение, а возвращается {hadFetchError:true, error}', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, b = createDevice(db, ref);
  db.failNext({ network: true });
  var r = await b.binding.pullNow();
  ok(r.hadFetchError === true && r.error && r.applied === 0, 'ошибка возвращена значением');
  db.failNext({ status: 500 });
  r = await b.binding.pullNow();
  ok(r.hadFetchError === true && r.error, 'HTTP 500 — тоже значением');
  r = await b.binding.pullNow();
  eq([r.hadFetchError, r.error], [false, null], 'следующий pull после сбоя снова работает');
});

test('заметка с notesMeta, но без тела в облаке: тихий пропуск без hadFetchError (как в старом коде)', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, b = createDevice(db, ref);
  db.seed('/syncs/' + SYNC + '/notesMeta/nY', { t: 500, deleted: false });
  var r = await b.binding.pullNow();
  eq([r.hadFetchError, r.missingBody, b.notesMap.has('nY')], [false, ['nY'], false], 'пропущена, учтена в missingBody');
});

test('параллелизм загрузки тел ограничен maxParallelFetch (первый синк сотен заметок — не шторм)', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref, { trackConcurrency: true, maxParallelFetch: 3 });
  for (var i = 0; i < 20; i++) await a.binding.save('n' + i, note('Н' + i, 'текст ' + i));
  await a.binding.pushNow();
  db.setLatency(6);
  var r = await b.binding.pullNow();
  db.setLatency(0);
  eq(r.applied, 20, 'все 20 заметок получены');
  ok(b.maxInflight <= 3, 'одновременно в полёте не больше 3 запросов (было: ' + b.maxInflight + ')');
  ok(b.maxInflight >= 2, 'и параллелизм реально используется (' + b.maxInflight + ')');
});

test('отправка пачками: 60 заметок → PATCH по ≤25, dirty снят у всех', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref, { pushChunkSize: 25 });
  for (var i = 0; i < 60; i++) await d.binding.save('n' + i, note('Н' + i, 'текст ' + i));
  var r = await d.binding.pushNow();
  eq([r.pushed, r.failed.length], [60, 0], 'отправлено 60');
  var sizes = db.callsBy('PATCH').map(function (c) { return Object.keys(c.body).filter(function (k) { return k.indexOf('notes/') === 0; }).length; });
  eq(sizes, [25, 25, 10], 'размеры пачек 25/25/10');
  eq(await d.binding.getDirtyIds(), [], 'dirty пуст');
});

test('повтор при сбое сети: записи остаются dirty, потом уходят сами; после исчерпания повторов — стоп до новой правки/online', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref, { retryDelays: [15, 30] });
  db.failNext({ network: true }, 2);
  d.binding.save('n1', note('Н', 'текст'));
  ok(await waitFor(function () { return db.raw('/syncs/' + SYNC + '/notesMeta/n1'); }, 2000), 'после двух сбоев третья попытка дошла сама');
  eq(await d.binding.getDirtyIds(), [], 'dirty снят только после успешной отправки');
  // исчерпание повторов: 1 попытка + 2 повтора = 3 сбоя
  var d2 = createDevice(db, ref, { retryDelays: [15, 30] });
  db.failNext({ network: true }, 3);            // ровно на три попытки: 1 + 2 повтора
  var before = db.callsBy('PATCH').length;
  d2.binding.save('m1', note('М', 'текст'));
  await sleep(200);
  eq(db.callsBy('PATCH').length - before, 3, 'ровно 3 попытки (1 + 2 повтора), потом остановка');
  eq(await d2.binding.getDirtyIds(), ['m1'], 'запись осталась dirty');
  await d2.binding.retryPushOnReconnect();
  eq(await d2.binding.getDirtyIds(), [], 'retryPushOnReconnect (событие online) дослал накопленное');
});

test('правка, сделанная ВО ВРЕМЯ отправки, не теряется; t и текст в облаке согласованы', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var slow = function (id) {
    var h = NotesCrypto.makeNotesHooks(id);
    return { encryptHook: async function (p) { await sleep(40); return h.encryptHook(p); }, decryptHook: h.decryptHook };
  };
  var d = createDevice(db, ref, { makeHooks: slow });
  await d.binding.save('n1', note('Н', 'v1'));
  var push = d.binding.pushNow();
  await sleep(15);                      // снимок v1 уже взят, идёт шифрование
  await d.binding.save('n1', note('Н', 'v2'));
  var t2 = d.notesMap.get('n1').t;
  await push;
  ok(await waitFor(async function () { return (await d.binding.getDirtyIds()).length === 0; }, 2000), 'dirty в итоге снят');
  eq((await cloudPayload(db, ref, 'n1')).text, 'v2', 'в облаке ПОСЛЕДНЯЯ версия v2 (не потеряна)');
  eq(db.raw('/syncs/' + SYNC + '/notesMeta/n1').t, t2, 't в notesMeta соответствует тексту v2');
});

test('срочный pushNow сразу после save отправляет эту правку и передаёт keepalive:true', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  d.binding.save('n1', note('Н', 'срочно'));           // без await — как в flush при уходе со страницы
  var r = await d.binding.pushNow({ keepalive: true });
  eq(r.pushed, 1, 'правка отправлена тем же вызовом (dirty ещё не был выставлен в момент вызова)');
  var patches = db.callsBy('PATCH');
  ok(patches.length === 1 && patches[0].options.keepalive === true, 'PATCH ушёл с keepalive:true');
});

test('нет syncId или нет сети: save работает локально, в сеть ничего не идёт; после появления — syncNow досылает', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: null }, d = createDevice(db, ref);
  await d.binding.save('n1', note('Н', 'локально'));
  ok(d.notesMap.get('n1').text === 'локально', 'без syncId запись доступна локально');
  var r = await d.binding.pushNow();
  ok(r.skipped && db.calls.length === 0, 'без syncId в сеть ничего не идёт');
  ref.id = SYNC; d.online = false;
  r = await d.binding.pushNow();
  ok(r.skipped && db.calls.length === 0, 'офлайн — в сеть ничего не идёт');
  d.online = true;
  var s = await d.binding.syncNow();
  eq([s.push.pushed, (await cloudPayload(db, ref, 'n1')).text], [1, 'локально'], 'после появления syncId/сети накопленное ушло');
});

test('syncId сменился во время pull → результат отброшен, notesMap не тронут', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Н', 'текст')); await a.binding.pushNow();
  db.setLatency(20);
  var p = b.binding.pullNow();
  await sleep(5); ref.id = 'другой-аккаунт';
  var r = await p;
  db.setLatency(0);
  ok(r.error && r.error.message === 'sync_id_changed' && r.hadFetchError === true, 'pull завершился ошибкой sync_id_changed');
  eq(b.notesMap.size, 0, 'записи старого аккаунта не попали в notesMap');
  ref.id = SYNC;
});

test('невалидный id (недопустимый ключ базы) не отправляется, остальные уходят', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC }, d = createDevice(db, ref);
  await d.binding.save('плохой/id', note('Х', 'текст')); await d.binding.save('норм', note('Н', 'текст'));
  var r = await d.binding.pushNow();
  eq([r.pushed, r.failed], [1, [{ id: 'плохой/id', reason: 'invalid_id' }]], 'ушла одна, вторая отмечена invalid_id');
});

test('reconcile: по умолчанию syncNow НЕ досылает потерянные dirty (как старый код); с reconcile:true — досылает', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var lost = { id: 'nL', name: 'Потерянная', path: '', text: 'не ушла', t: 1000 };   // как после перезагрузки: есть в кэше, dirty нет
  var off = createDevice(db, ref), on = createDevice(db, ref, { reconcile: true });
  off.notesMap.set('nL', Object.assign({}, lost)); on.notesMap.set('nL', Object.assign({}, lost));
  await off.binding.syncNow();
  eq(db.raw('/syncs/' + SYNC + '/notesMeta/nL'), null, 'reconcile выключен: в облако не ушла');
  await on.binding.syncNow();
  eq(db.raw('/syncs/' + SYNC + '/notesMeta/nL'), { t: 1000, deleted: false }, 'reconcile включён: ушла');
  eq((await cloudPayload(db, ref, 'nL')).text, 'не ушла', 'с нужным текстом');
});

test('два устройства: разнесённые правки разных заметок сходятся, конфликт одной заметки решает последняя правка', async function () {
  var db = FakeDb.createFakeDb(), ref = { id: SYNC };
  var a = createDevice(db, ref), b = createDevice(db, ref);
  await a.binding.save('n1', note('Раз', 'a')); await a.binding.save('n2', note('Два', 'a'));
  await a.binding.syncNow(); await b.binding.syncNow();
  await sleep(3);
  await a.binding.save('n1', note('Раз', 'правка A')); await sleep(3);
  await b.binding.save('n2', note('Два', 'правка B')); await sleep(3);
  await b.binding.save('n1', note('Раз', 'правка B (позже)'));
  await a.binding.syncNow(); await b.binding.syncNow(); await a.binding.syncNow();
  function view(dev) { return ['n1', 'n2'].map(function (id) { return dev.notesMap.get(id).text; }); }
  eq(view(a), ['правка B (позже)', 'правка B'], 'A сошлось');
  eq(view(b), ['правка B (позже)', 'правка B'], 'B сошлось');
});

// --------------------------------------------------------------------------
(async function main() {
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    console.log('\n' + (i + 1) + '. ' + t.name);
    try { await t.fn(); }
    catch (err) { failed++; console.log('  ✗ тест упал с исключением: ' + (err && err.stack ? err.stack : err)); }
  }
  allDevices.forEach(function (d) { try { d.binding.destroy(); } catch (e) { /* ignore */ } });
  console.log('\n' + (failed ? 'ПРОВАЛ' : 'ОК') + ': пройдено ' + passed + ', провалено ' + failed);
  process.exit(failed ? 1 : 0);
})();
