// syncengine_personalbinding.js
// Версия: 3.0 (21.09) — TASK_UNIFIED_SYNC.md, Шаг 8 (cutover личных задач): структурная правка —
// добавлены `binding.snapshot({filter})` (снимок store для чтения: [{id, c, t, dead}] в общей очереди,
// данные копируются) и чистые функции `buildCutoverPlan`/`formatCutoverPlan` (что изменится в списках
// после переключения чтения на store: исчезнут/появятся/изменятся, рост дублей текста). Модуль по-прежнему
// НЕ читает и не меняет `state` и ничего не показывает — «вид» для UI, зеркалирование в state и флаг
// переключения живут в my.js (раздел «ЛИЧНЫЕ ЗАДАЧИ: ТЕНЕВАЯ ЗАПИСЬ…», подраздел «Шаг 8»).
// `save/remove/reconcile/syncNow/diagnose/parity` не менялись.
// Версия: 2.0 (21.09) — TASK_UNIFIED_SYNC.md, Шаг 7 (parity check): структурная правка —
// добавлены `binding.parity(state, opts)` и чистые функции `buildParityReport`,
// `formatParityReport`, `formatParityHeadline`, `summarizeCompletions` (см. раздел «Шаг 7»
// ниже). ТОЛЬКО ДИАГНОСТИКА: parity ничего не пишет ни в store, ни в state, ни в облако
// (облако — один GET через переданную снаружи `readCloud`); `save/remove/reconcile/diagnose`
// не менялись.
// Версия: 1.0 (20.09) — TASK_UNIFIED_SYNC.md, Шаг 6: личные задачи — «теневая» запись
// в sync-engine. Новый файл.
//
// Что это. Связка «личные записи старого state (`task:<id>` = {c, t}) ↔ sync-engine ↔
// транспорт ↔ шифрование личным ключом». Это ТЕНЕВОЙ store: старый state остаётся
// единственным источником истины (читает UI, синхронизирует doCloudSync/mergeStates),
// а здесь копится параллельная копия — «дублирующий дневник» для проверки на шаге 7
// (parity) и для переключения на шаге 8. Ничего из этого модуля не читает UI.
//
// Модель. Один binding = один облачный узел личного аккаунта:
//   /syncs/<syncId>/<cloudBranch>/<id> = { c: <шифротекст>, t: <мс> }
// (формат {c,t} и шифрование SHA-256(syncId) → AES-GCM — из syncengine_personalcrypto.js).
// Ветка ОБЯЗАНА быть внесена в CLOUD_RESERVED_SUBTREES в my.js — иначе mergeStates/
// joinWithCode подмешают её в `state` (та же ошибка уже случалась с fileBlobs/notes).
//
// Три способа записать в store (все — через engine, вне engine store не меняется):
//   save(id, data, t) / remove(id, t) — «живая» мутация (dirty → push через транспорт).
//       Метка t — та же, что записана в старый state (engine v2.2, opts.updatedAt).
//   reconcile(state, {tombstoneMissing}) — «догоняющая» сверка: любая запись старого
//       state, которой нет в store или которая новее — пишется БЕЗ dirty (mergeIncoming,
//       last-write-wins); отправку в облако потом делает syncNow (он лечит «локально новее
//       облака», см. transport.syncNow). Это страховка от любого места my.js, которое
//       меняет state в обход save/remove: миграции общих задач, приём с облака
//       (doCloudSync), импорт, joinWithCode. tombstoneMissing:true — записи store, которых
//       НЕТ в state, гасятся тумбстоуном (нужно после ПОЛНОЙ замены state: импорт/подключение
//       по коду).
//   Все три идут через ОДНУ очередь (по одному за раз): mergeIncoming и saveRecord не
//   пересекаются, «правка во время сверки» не теряет dirty-флаг.
//
// Локальное хранение store — IndexedDB (своя база на область: syncId или «local»), а не
// localStorage: копия личных задач не делит квоту с `main` (история переполнения квоты,
// см. PROJECT_MAP_MYJS.md). Если IndexedDB недоступна — store в памяти (сверка при старте
// пересоберёт его из state). Dirty-флаги движка живут только в памяти (находка 2 шага 2) —
// их потерю лечит syncNow.
//
// Что НЕ делает: не читает и не меняет `state` (получает его как аргумент только для чтения),
// ничего не показывает пользователю, не решает «синхронизировать ли» (флаги — в my.js).
// Смена syncId (создать код / подключиться / отключиться) обнаруживается сама на ближайшей
// операции: у каждой области свой store, база прежней области удаляется.
//
// Отладка — только через opts.log (в проекте window.Debug.log).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEnginePersonalBinding = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IDB_STORE = 'records';
  var DEFAULT_KEY_PREFIX = 'task:';
  var BAD_KEY_CHARS = /[.$#\[\]\/\u0000-\u001f\u007f]/;

  function errMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  // Ключ Realtime Database (так же, как в транспорте): не пустой, ≤768 байт, без . $ # [ ] /
  function isValidRecordId(id) {
    if (typeof id !== 'string' || !id) return false;
    if (BAD_KEY_CHARS.test(id)) return false;
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(id).length <= 768;
    return id.length <= 256;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Строка с отсортированными ключами — для сравнения содержимого «по значению».
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(value[k]);
    }).join(',') + '}';
  }

  // ---- локальное хранилище store ------------------------------------------
  // Контракт движка: {getAll, get, put} — все методы возвращают Promise.
  function createMemoryStorage() {
    var map = new Map();
    return {
      getAll: function () { return Promise.resolve(Array.from(map.values())); },
      get: function (id) { return Promise.resolve(map.has(id) ? map.get(id) : null); },
      put: function (record) { map.set(record.id, record); return Promise.resolve(); },
      destroy: function () { map.clear(); return Promise.resolve(); },
      getMode: function () { return 'memory'; },
    };
  }

  /**
   * createIdbStorage(dbName, {indexedDB, log}) -> storage
   * Запись целиком ({id, data, deleted, updatedAt}) лежит в одном object store 'records',
   * ключ — id. База открывается лениво (первой операцией). Если IndexedDB недоступна или
   * упала — переключается на память (одна строка в журнал), дальше работает как memory.
   */
  function createIdbStorage(dbName, o) {
    o = o || {};
    var idb = o.indexedDB !== undefined ? o.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var log = typeof o.log === 'function' ? o.log : function () {};
    var mem = null;
    var dbPromise = null;
    var mode = idb ? 'idb' : 'memory';
    if (!idb) mem = createMemoryStorage();

    function fallback(err) {
      if (mode === 'memory') return;
      mode = 'memory';
      mem = createMemoryStorage();
      dbPromise = null;
      log('PersonalBinding: IndexedDB "' + dbName + '" недоступна (' + errMessage(err) + ') — store в памяти до перезагрузки');
    }

    function openDb() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        var req;
        try {
          req = idb.open(dbName, 1);
        } catch (e) {
          reject(e);
          return;
        }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () {
          var db = req.result;
          db.onversionchange = function () {
            try { db.close(); } catch (e) { /* ignore */ }
            dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = function () { reject(req.error || new Error('idb_open_error')); };
        req.onblocked = function () { reject(new Error('idb_open_blocked')); };
      });
      return dbPromise;
    }

    function run(kind, arg) {
      if (mode === 'memory') return mem[kind](arg);
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, kind === 'put' ? 'readwrite' : 'readonly');
          var st = tx.objectStore(IDB_STORE);
          var req = kind === 'getAll' ? st.getAll() : (kind === 'get' ? st.get(arg) : st.put(arg));
          tx.oncomplete = function () {
            if (kind === 'put') resolve(undefined);
            else if (kind === 'get') resolve(req.result || null);
            else resolve(req.result || []);
          };
          tx.onerror = tx.onabort = function () { reject(tx.error || req.error || new Error('idb_tx_error')); };
        });
      }).catch(function (err) {
        fallback(err);
        return mem[kind](arg);
      });
    }

    return {
      getAll: function () { return run('getAll'); },
      get: function (id) { return run('get', id); },
      put: function (record) { return run('put', record); },
      getMode: function () { return mode; },
      // Удаляет саму базу (область больше не нужна: сменился syncId).
      destroy: function () {
        var closing = dbPromise
          ? dbPromise.then(function (db) { try { db.close(); } catch (e) { /* ignore */ } }, function () {})
          : Promise.resolve();
        return closing.then(function () {
          if (!idb) return undefined;
          return new Promise(function (resolve) {
            try {
              var r = idb.deleteDatabase(dbName);
              r.onsuccess = r.onerror = r.onblocked = function () { resolve(); };
            } catch (e) {
              resolve();
            }
          });
        });
      },
    };
  }

  // ==========================================================================================
  // Шаг 7 (21.09): сверка (parity check) старого state и нового store личных задач.
  // ТОЛЬКО ДИАГНОСТИКА — всё ниже читает данные и строит отчёт; ничего не пишет.
  //
  // Три источника одной и той же записи (id задачи):
  //   state — старый путь (`task:<id>` = {c, t}), единственный источник истины на шаге 7;
  //   store — новый теневой store (IndexedDB) этого устройства;
  //   облако — ветка `/syncs/<syncId>/personalTasks` (то, что успели отправить ВСЕ устройства
  //            аккаунта; читается одним GET, содержимое НЕ расшифровывается — сверяются id,
  //            метка `t` и признак «удалена»).
  // Виды расхождений (kinds):
  //   state ↔ store:  noStore (в store нет), storeOlder (в store старее), storeNewer (в store
  //                   новее), deadMismatch (метка та же, жива/удалена не так), contentDiff
  //                   (метка та же, поля не совпали), storeExtra (живая в store, в state нет),
  //                   invalidState (запись state неверной формы);
  //   store ↔ облако: notPushed (в облако не отправлено: живой записи там нет или она старее; удалённой
  //                   записи, которой в облаке нет вообще, это НЕ касается), notPulled (из
  //                   облака не принято: у store нет или старее), cloudDeadMismatch (метка та
  //                   же, жива/удалена не так), invalidCloud (запись облака неверной формы).
  // «Свежее» расхождение — самая новая метка записи моложе freshMs (по умолчанию 10 мин):
  // правка могла ещё не доехать. «Устойчивое» — старше: так не должно быть, это и ищем.
  // ==========================================================================================
  var COMPLETION_PREFIX = 'taskcompletion:';
  var DEFAULT_FRESH_MS = 10 * 60 * 1000;
  var DEFAULT_TEXT_LEN = 30;

  // 53-битный нестойкий хэш (cyrb53) — только чтобы сравнить наборы записей на разных
  // устройствах «одним словом». Не криптография. Возвращает 10 hex-символов.
  function hashString(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    while (hex.length < 14) hex = '0' + hex;
    return hex.slice(-10);
  }

  // Отпечаток набора записей [{id, t, dead}] по строкам «id|t|d» (порядок не важен).
  function fingerprintOf(list) {
    var lines = list.map(function (e) { return e.id + '|' + e.t + '|' + (e.dead ? 1 : 0); }).sort();
    return { count: lines.length, hash: hashString(lines.join('\n')) };
  }

  function snippetOf(c, maxLen) {
    if (!c || typeof c !== 'object' || typeof c.text !== 'string') return '';
    var s = c.text.replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  }

  // Верхнеуровневые поля объекта задачи, значения которых различаются.
  function diffFields(a, b) {
    var keys = {};
    [a, b].forEach(function (o) {
      if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { keys[k] = true; });
    });
    return Object.keys(keys).sort().filter(function (k) {
      return stableStringify(a ? a[k] : undefined) !== stableStringify(b ? b[k] : undefined);
    });
  }

  /**
   * summarizeCompletions(stateObj, {taskPrefix, completionPrefix, sample}) -> сводка по записям
   * `taskcompletion:*` («когда задачу выполняли» — «Карта дней года», экспорт). В store они НЕ
   * входят (шаг 6), поэтому в сверку state ↔ store не попадают; сводка нужна для решения на
   * шагах 8–9: можно ли хранить факт выполнения внутри самой задачи.
   *   live/tombstones — живые/погашенные записи;
   *   linked — живые, на которые ссылается completionKey какой-то живой задачи;
   *   orphans (+orphanIds) — живые, на которые не ссылается ни одна живая задача;
   *   brokenLinks (+brokenLinkIds) — живые задачи, чей completionKey указывает на
   *     отсутствующую/погашенную запись;
   *   checkedWithoutKey — отмеченные задачи без completionKey.
   */
  function summarizeCompletions(stateObj, o) {
    o = o || {};
    var taskPrefix = o.taskPrefix || DEFAULT_KEY_PREFIX;
    var compPrefix = o.completionPrefix || COMPLETION_PREFIX;
    var sample = typeof o.sample === 'number' ? o.sample : 5;
    var st = stateObj || {};
    var out = { total: 0, live: 0, tombstones: 0, linked: 0, orphans: 0, orphanIds: [],
      brokenLinks: 0, brokenLinkIds: [], checkedWithoutKey: 0 };
    var referenced = new Set();
    var keys = Object.keys(st);
    keys.forEach(function (k) {
      if (k.indexOf(taskPrefix) !== 0) return;
      var rec = st[k];
      if (!rec || typeof rec !== 'object' || !rec.c || typeof rec.c !== 'object') return;
      var ck = rec.c.completionKey;
      if (typeof ck === 'string' && ck) {
        referenced.add(ck);
        var target = st[ck];
        if (!target || typeof target !== 'object' || !target.c) {
          out.brokenLinks += 1;
          if (out.brokenLinkIds.length < sample) out.brokenLinkIds.push(k.slice(taskPrefix.length));
        }
      } else if (rec.c.checked) {
        out.checkedWithoutKey += 1;
      }
    });
    keys.forEach(function (k) {
      if (k.indexOf(compPrefix) !== 0) return;
      out.total += 1;
      var rec = st[k];
      if (!rec || typeof rec !== 'object' || !rec.c) { out.tombstones += 1; return; }
      out.live += 1;
      if (referenced.has(k)) out.linked += 1;
      else {
        out.orphans += 1;
        if (out.orphanIds.length < sample) out.orphanIds.push(k.slice(compPrefix.length));
      }
    });
    return out;
  }

  /**
   * buildParityReport(input) -> report   (чистая функция: только читает input)
   *   input.state    — объект state (или его копия с ключами task:* / taskcompletion:*)
   *   input.records  — записи store: [{id, data, deleted, updatedAt}] (engine.listRecords, includeDeleted)
   *   input.cloud    — ветка облака «id → {c, t}» | null (ветка пуста) | undefined (не проверялась)
   *   input.cloudError — строка: облако читали, но не вышло (тогда сверка store ↔ облако пропускается)
   *   input.now, input.freshMs, input.maxTextLen, input.keyPrefix, input.completions (false — без сводки)
   *   input.meta     — {scope, cloudAttached, storageMode, cloudNote}: копируется в отчёт как есть
   */
  function buildParityReport(input) {
    input = input || {};
    var keyPrefix = input.keyPrefix || DEFAULT_KEY_PREFIX;
    var now = typeof input.now === 'number' && isFinite(input.now) ? input.now : Date.now();
    var freshMs = typeof input.freshMs === 'number' && input.freshMs >= 0 ? input.freshMs : DEFAULT_FRESH_MS;
    var textLen = typeof input.maxTextLen === 'number' && input.maxTextLen > 0 ? input.maxTextLen : DEFAULT_TEXT_LEN;
    var stateObj = input.state || {};
    var records = Array.isArray(input.records) ? input.records : [];
    var meta = input.meta || {};

    // ---- разбор трёх источников ----
    var st = new Map();
    var invalidState = [];
    Object.keys(stateObj).forEach(function (k) {
      if (k.indexOf(keyPrefix) !== 0) return;
      var id = k.slice(keyPrefix.length);
      var rec = stateObj[k];
      if (!isValidRecordId(id) || !rec || typeof rec !== 'object' || typeof rec.t !== 'number' || !isFinite(rec.t)) {
        invalidState.push(id || k);
        return;
      }
      st.set(id, { id: id, t: rec.t, dead: !rec.c, c: rec.c || null });
    });
    var tr = new Map();
    records.forEach(function (r) {
      tr.set(r.id, { id: r.id, t: r.updatedAt, dead: !!r.deleted, c: r.deleted ? null : r.data });
    });
    var cloudError = input.cloudError ? String(input.cloudError) : '';
    var cloudChecked = input.cloud !== undefined && !cloudError;
    var cl = new Map();
    var invalidCloud = [];
    if (cloudChecked && input.cloud !== null) {
      if (typeof input.cloud !== 'object') {
        cloudError = 'облако вернуло не объект';
        cloudChecked = false;
      } else {
        Object.keys(input.cloud).forEach(function (id) {
          var rec = input.cloud[id];
          var ok = isValidRecordId(id) && rec && typeof rec === 'object' && typeof rec.t === 'number' && isFinite(rec.t) &&
            (rec.c === undefined || rec.c === null || typeof rec.c === 'string');
          if (!ok) { invalidCloud.push(id); return; }
          cl.set(id, { id: id, t: rec.t, dead: !rec.c });
        });
      }
    }

    // ---- расхождения по id ----
    var byId = new Map();
    function issue(id) {
      var x = byId.get(id);
      if (!x) { x = { id: id, kinds: [], fields: [] }; byId.set(id, x); }
      return x;
    }
    st.forEach(function (s, id) {
      var t = tr.get(id);
      var kind = null;
      if (!t) kind = 'noStore';
      else if (t.t < s.t) kind = 'storeOlder';
      else if (t.t > s.t) kind = 'storeNewer';
      else if (t.dead !== s.dead) kind = 'deadMismatch';
      else if (!s.dead && stableStringify(t.c) !== stableStringify(s.c)) kind = 'contentDiff';
      if (!kind) return;
      var x = issue(id);
      x.kinds.push(kind);
      if (t && !s.dead && !t.dead) x.fields = diffFields(s.c, t.c);
    });
    tr.forEach(function (t, id) {
      if (!st.has(id) && !t.dead) issue(id).kinds.push('storeExtra');
    });
    invalidState.forEach(function (id) { issue(id).kinds.push('invalidState'); });
    if (cloudChecked) {
      tr.forEach(function (t, id) {
        var c = cl.get(id);
        // Тумбстоун store, которого в облаке нет вообще, — НЕ расхождение: транспорт сознательно не
        // отправляет удаления записей, которых в облаке никогда не было (старая история удалённых
        // задач приезжает из state через reconcile без dirty, и так и остаётся только локальной).
        if (!c) { if (!t.dead) issue(id).kinds.push('notPushed'); }
        else if (c.t < t.t) issue(id).kinds.push('notPushed');
        else if (c.t > t.t) issue(id).kinds.push('notPulled');
        else if (c.dead !== t.dead) issue(id).kinds.push('cloudDeadMismatch');
      });
      cl.forEach(function (c, id) {
        if (!tr.has(id)) issue(id).kinds.push('notPulled');
      });
      invalidCloud.forEach(function (id) { issue(id).kinds.push('invalidCloud'); });
    }

    // ---- оформление ----
    var issues = [];
    byId.forEach(function (x, id) {
      var s = st.get(id), t = tr.get(id), c = cl.get(id);
      x.s = s ? { t: s.t, dead: s.dead } : null;
      x.t = t ? { t: t.t, dead: t.dead } : null;
      x.c = c ? { t: c.t, dead: c.dead } : null;
      x.text = snippetOf(s && !s.dead ? s.c : (t && !t.dead ? t.c : null), textLen);
      var newest = -Infinity;
      [x.s, x.t, x.c].forEach(function (src) { if (src && src.t > newest) newest = src.t; });
      x.newest = newest === -Infinity ? null : newest;
      x.fresh = x.newest !== null && now - x.newest < freshMs;
      issues.push(x);
    });
    issues.sort(function (a, b) {
      if (a.fresh !== b.fresh) return a.fresh ? 1 : -1; // устойчивые — первыми
      var an = a.newest === null ? 0 : a.newest, bn = b.newest === null ? 0 : b.newest;
      if (an !== bn) return bn - an;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    var counts = { total: issues.length, stable: 0, fresh: 0, byKind: {} };
    issues.forEach(function (x) {
      if (x.fresh) counts.fresh += 1; else counts.stable += 1;
      x.kinds.forEach(function (k) { counts.byKind[k] = (counts.byKind[k] || 0) + 1; });
    });
    var verdict = !counts.total ? 'ok' : (counts.stable ? 'mismatch' : 'fresh');

    function tally(map) {
      var live = 0, tomb = 0;
      map.forEach(function (e) { if (e.dead) tomb += 1; else live += 1; });
      return { live: live, tombstones: tomb };
    }
    var stTally = tally(st), trTally = tally(tr), clTally = tally(cl);
    var report = {
      at: now,
      freshMs: freshMs,
      scope: meta.scope || null,
      cloudAttached: !!meta.cloudAttached,
      storageMode: meta.storageMode || null,
      cloudChecked: cloudChecked,
      cloudNote: cloudChecked ? '' : (cloudError || meta.cloudNote || 'не проверялось'),
      state: { live: stTally.live, tombstones: stTally.tombstones, invalid: invalidState.length },
      store: { live: trTally.live, tombstones: trTally.tombstones },
      cloud: cloudChecked ? { live: clTally.live, tombstones: clTally.tombstones, invalid: invalidCloud.length } : null,
      fingerprint: {
        state: fingerprintOf(Array.from(st.values())),
        store: fingerprintOf(Array.from(tr.values())),
        cloud: cloudChecked ? fingerprintOf(Array.from(cl.values())) : null,
      },
      issues: issues,
      counts: counts,
      verdict: verdict,
      completions: input.completions === false ? null : summarizeCompletions(stateObj, { taskPrefix: keyPrefix }),
    };
    return report;
  }

  var KIND_LABELS = {
    noStore: 'нет в store',
    storeOlder: 'в store старее',
    storeNewer: 'в store новее',
    storeExtra: 'лишняя в store',
    deadMismatch: 'удалена/жива не так',
    contentDiff: 'поля не совпали',
    invalidState: 'некорректная запись в state',
    notPushed: 'не отправлено в облако',
    notPulled: 'из облака не принято',
    cloudDeadMismatch: 'в облаке удалена/жива не так',
    invalidCloud: 'некорректная запись в облаке',
  };
  var KIND_ORDER = ['noStore', 'storeOlder', 'storeNewer', 'storeExtra', 'deadMismatch', 'contentDiff', 'invalidState',
    'notPushed', 'notPulled', 'cloudDeadMismatch', 'invalidCloud'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ms) {
    var d = new Date(ms);
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtSource(label, src) {
    return label + ': ' + (src ? (src.dead ? 'удалена ' : 'жива ') + fmtTime(src.t) : '—');
  }
  function verdictText(rep) {
    var mins = Math.round(rep.freshMs / 60000);
    if (rep.verdict === 'ok') return 'РАСХОЖДЕНИЙ НЕТ';
    if (rep.verdict === 'fresh') return 'ЕСТЬ ТОЛЬКО СВЕЖИЕ РАСХОЖДЕНИЯ (' + rep.counts.fresh + ', моложе ' + mins + ' мин) — повторить сверку через несколько минут';
    return 'РАСХОЖДЕНИЯ: устойчивых ' + rep.counts.stable + ', свежих ' + rep.counts.fresh;
  }
  function summaryLines(rep) {
    var lines = [];
    lines.push('state: живых ' + rep.state.live + ', удалённых ' + rep.state.tombstones + (rep.state.invalid ? ', некорректных ' + rep.state.invalid : '') +
      ' · отпечаток ' + rep.fingerprint.state.hash);
    lines.push('store: живых ' + rep.store.live + ', удалённых ' + rep.store.tombstones + ' · отпечаток ' + rep.fingerprint.store.hash);
    if (rep.cloud) {
      lines.push('облако: живых ' + rep.cloud.live + ', удалённых ' + rep.cloud.tombstones + (rep.cloud.invalid ? ', некорректных ' + rep.cloud.invalid : '') +
        ' · отпечаток ' + rep.fingerprint.cloud.hash);
    } else {
      lines.push('облако: не сверялось (' + rep.cloudNote + ')');
    }
    return lines;
  }

  /** Короткая шапка отчёта (3–4 строки, без текстов задач) — для журнала отладки. */
  function formatParityHeadline(rep) {
    var lines = ['Сверка личных задач: ' + verdictText(rep)];
    summaryLines(rep).forEach(function (l) { lines.push(l); });
    var kinds = KIND_ORDER.filter(function (k) { return rep.counts.byKind[k]; })
      .map(function (k) { return KIND_LABELS[k] + ' ' + rep.counts.byKind[k]; });
    if (kinds.length) lines.push('по видам: ' + kinds.join(', '));
    return lines.join('\n');
  }

  /** Полный текстовый отчёт (для «скопировать» и отправки в чат). fopts.maxIssues — сколько расхождений показать. */
  function formatParityReport(rep, fopts) {
    fopts = fopts || {};
    var maxIssues = typeof fopts.maxIssues === 'number' && fopts.maxIssues > 0 ? fopts.maxIssues : 40;
    var lines = [];
    lines.push('СВЕРКА ЛИЧНЫХ ЗАДАЧ (шаг 7) — ' + fmtTime(rep.at));
    lines.push('Вердикт: ' + verdictText(rep));
    lines.push('Область: ' + (rep.scope === 'local' ? 'local (нет syncId)' : 'syncId') + ', облако ' + (rep.cloudAttached ? 'подключено' : 'нет') +
      ', хранилище ' + (rep.storageMode || '?'));
    summaryLines(rep).forEach(function (l) { lines.push(l); });
    var fp = rep.fingerprint;
    if (fp.state.hash === fp.store.hash) lines.push('Отпечатки state и store совпадают');
    else lines.push('Отпечатки state и store РАЗНЫЕ');
    if (fp.cloud) {
      lines.push('Отпечаток store ' + (fp.store.hash === fp.cloud.hash ? 'совпадает с облаком' : 'РАЗНЫЙ с облаком'));
    }
    var kinds = KIND_ORDER.filter(function (k) { return rep.counts.byKind[k]; })
      .map(function (k) { return KIND_LABELS[k] + ' ' + rep.counts.byKind[k]; });
    if (kinds.length) lines.push('По видам: ' + kinds.join(', '));
    if (rep.issues.length) {
      lines.push('');
      lines.push('Расхождения (показано ' + Math.min(maxIssues, rep.issues.length) + ' из ' + rep.issues.length + ', устойчивые первыми):');
      rep.issues.slice(0, maxIssues).forEach(function (x, i) {
        var what = x.kinds.map(function (k) { return KIND_LABELS[k]; }).join(' + ');
        if (x.fields.length) what += ' (поля: ' + x.fields.join(', ') + ')';
        var cells = [x.kinds.indexOf('invalidState') !== -1 ? 'state: некорректная запись' : fmtSource('state', x.s), fmtSource('store', x.t)];
        if (rep.cloud) cells.push(x.kinds.indexOf('invalidCloud') !== -1 ? 'облако: некорректная запись' : fmtSource('облако', x.c));
        lines.push((i + 1) + '. [' + (x.fresh ? 'свежее' : 'УСТОЙЧИВОЕ') + '] ' + x.id + (x.text ? ' «' + x.text + '»' : '') + ' — ' + what);
        lines.push('   ' + cells.join(' · '));
      });
      if (rep.issues.length > maxIssues) lines.push('… и ещё ' + (rep.issues.length - maxIssues) + ' (не показаны)');
    }
    var cp = rep.completions;
    if (cp) {
      lines.push('');
      lines.push('НЕ ВХОДИТ В СВЕРКУ — taskcompletion:* (в store не пишутся): всего ' + cp.total + ', живых ' + cp.live + ', погашенных ' + cp.tombstones + '.');
      lines.push('Из живых: привязано к живой задаче ' + cp.linked + ', «осиротевших» ' + cp.orphans +
        (cp.orphanIds.length ? ' (' + cp.orphanIds.join(', ') + (cp.orphans > cp.orphanIds.length ? ', …' : '') + ')' : '') + '.');
      lines.push('Задач со ссылкой на несуществующую запись ' + cp.brokenLinks +
        (cp.brokenLinkIds.length ? ' (' + cp.brokenLinkIds.join(', ') + (cp.brokenLinks > cp.brokenLinkIds.length ? ', …' : '') + ')' : '') +
        '; отмеченных задач без completionKey ' + cp.checkedWithoutKey + '.');
    }
    lines.push('');
    lines.push('Пояснения: сверка содержимого облака — только id, метка и «удалена» (не расшифровывается). ' +
      'Чтобы сверить устройства, запустите на каждом и сравните отпечаток облака: после сверки с облаком он должен совпасть.');
    return lines.join('\n');
  }

  // ==========================================================================================
  // Шаг 8 (21.09): переключение ЧТЕНИЯ личных задач на store (cutover) — план переключения.
  // Чистые функции (ничего не пишут, тестируются без движка). my.js зовёт их перед включением:
  // «вид» для UI = last-write-wins по метке t между state и store (при равной метке остаётся
  // state — так же, как в my.js, где уже лежащая в виде запись равной/более старой не заменяется).
  // Отсюда честный ответ на вопрос «что изменится в списках задач после переключения»:
  //   disappear — живы в state, а в store новее тумбстоун (задачу удалили/перенесли там, куда
  //               старый путь ещё не дошёл, ИЛИ её «воскресил» старый doCloudSync после импорта);
  //   appear    — живы в store, а в state нет / удалены (пришли новым путём или state их потерял);
  //   changed   — живы и там и там, в store новее, содержимое отличается.
  // Дубли: одинаковый непустой текст у РАЗНЫХ живых id — счётчик по state и по виду; рост
  // после переключения — повод проверить вручную («не задвоилась ли задача»).
  // ==========================================================================================
  var DEFAULT_PLAN_ITEMS = 8;

  function countTextDuplicates(map) {
    var byText = new Map();
    map.forEach(function (v) {
      if (!v || !v.c) return;
      var s = snippetOf(v.c, 1000000).toLowerCase();
      if (!s) return;
      byText.set(s, (byText.get(s) || 0) + 1);
    });
    var n = 0;
    byText.forEach(function (cnt) { if (cnt > 1) n += cnt; });
    return n;
  }

  /**
   * buildCutoverPlan(input) -> plan
   *   input.state      — объект state; читаются только ключи с префиксом input.prefix (по умолчанию 'task:')
   *   input.records    — снимок store: [{id, c, t, dead}] (binding.snapshot() БЕЗ filter)
   *   input.maxTextLen — длина фрагмента текста в отчёте (по умолчанию 30)
   *   plan = {state:{live,tombstones,invalid}, view:{live,tombstones}, store:{live,tombstones},
   *           disappear:[{id,text,stateT,storeT}], appear:[{id,text,storeT}], changed:[{id,text,fields}],
   *           duplicateTexts:{state,view}, invalidIds, signature}
   *   signature — короткий хэш id из disappear: одинаковый набор → одинаковая подпись (двойное подтверждение).
   */
  function buildCutoverPlan(input) {
    input = input || {};
    var prefix = input.prefix || DEFAULT_KEY_PREFIX;
    var stateObj = input.state || {};
    var records = input.records || [];
    var textLen = input.maxTextLen || DEFAULT_TEXT_LEN;
    var st = new Map();
    var invalidIds = [];
    Object.keys(stateObj).forEach(function (k) {
      if (k.indexOf(prefix) !== 0) return;
      var id = k.slice(prefix.length);
      var rec = stateObj[k];
      if (!rec || typeof rec !== 'object' || typeof rec.t !== 'number' || !isFinite(rec.t)) { invalidIds.push(id); return; }
      st.set(id, { c: rec.c || null, t: rec.t });
    });
    var plan = {
      state: { live: 0, tombstones: 0, invalid: invalidIds.length },
      view: { live: 0, tombstones: 0 },
      store: { live: 0, tombstones: 0 },
      disappear: [], appear: [], changed: [],
      duplicateTexts: { state: 0, view: 0 },
      invalidIds: invalidIds,
      signature: '',
    };
    var view = new Map();
    st.forEach(function (s, id) {
      view.set(id, s);
      if (s.c) plan.state.live += 1; else plan.state.tombstones += 1;
    });
    records.forEach(function (r) {
      if (!r || typeof r.id !== 'string' || typeof r.t !== 'number' || !isFinite(r.t)) return;
      var rc = r.dead ? null : (r.c || null);
      if (rc) plan.store.live += 1; else plan.store.tombstones += 1;
      var s = st.get(r.id);
      if (s && s.t >= r.t) return; // state не старее — в виде остаётся state
      view.set(r.id, { c: rc, t: r.t });
      if (s && s.c && !rc) {
        plan.disappear.push({ id: r.id, text: snippetOf(s.c, textLen), stateT: s.t, storeT: r.t });
      } else if (rc && (!s || !s.c)) {
        plan.appear.push({ id: r.id, text: snippetOf(rc, textLen), storeT: r.t });
      } else if (rc && s && s.c && stableStringify(s.c) !== stableStringify(rc)) {
        plan.changed.push({ id: r.id, text: snippetOf(rc, textLen), fields: diffFields(s.c, rc) });
      }
    });
    view.forEach(function (v) { if (v.c) plan.view.live += 1; else plan.view.tombstones += 1; });
    plan.duplicateTexts = { state: countTextDuplicates(st), view: countTextDuplicates(view) };
    function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
    plan.disappear.sort(byId);
    plan.appear.sort(byId);
    plan.changed.sort(byId);
    plan.signature = hashString(plan.disappear.map(function (x) { return x.id + '|' + x.storeT; }).join('\n'));
    return plan;
  }

  /** formatCutoverPlan(plan, {maxItems}) -> строка отчёта (с фрагментами текста задач — только для копирования вручную). */
  function formatCutoverPlan(plan, fopts) {
    fopts = fopts || {};
    var maxItems = fopts.maxItems || DEFAULT_PLAN_ITEMS;
    var lines = [];
    lines.push('State сейчас: живых ' + plan.state.live + ', удалённых ' + plan.state.tombstones +
      (plan.state.invalid ? ', некорректных ' + plan.state.invalid : '') +
      '. Store: живых ' + plan.store.live + ', удалённых ' + plan.store.tombstones + '.');
    lines.push('После переключения в списках будет: живых ' + plan.view.live + ', удалённых ' + plan.view.tombstones + '.');
    function list(title, arr, describe) {
      lines.push(title + ': ' + arr.length + (arr.length ? '' : ' — нет'));
      arr.slice(0, maxItems).forEach(function (x) { lines.push('  • ' + describe(x)); });
      if (arr.length > maxItems) lines.push('  … и ещё ' + (arr.length - maxItems));
    }
    list('ИСЧЕЗНУТ из списков (живы в state, в store новее тумбстоун)', plan.disappear,
      function (x) { return x.id + (x.text ? ' «' + x.text + '»' : '') + ' — state ' + fmtTime(x.stateT) + ', удалена в store ' + fmtTime(x.storeT); });
    list('ПОЯВЯТСЯ в списках (живы в store, в state нет или удалены)', plan.appear,
      function (x) { return x.id + (x.text ? ' «' + x.text + '»' : '') + ' — store ' + fmtTime(x.storeT); });
    list('ИЗМЕНЯТСЯ (в store новее, содержимое другое)', plan.changed,
      function (x) { return x.id + (x.text ? ' «' + x.text + '»' : '') + ' — поля: ' + (x.fields.join(', ') || '—'); });
    lines.push('Одинаковый текст у разных живых задач: в state ' + plan.duplicateTexts.state + ', после переключения ' + plan.duplicateTexts.view +
      (plan.duplicateTexts.view > plan.duplicateTexts.state ? ' — ВЫРОС, проверьте вручную, не задвоилось ли что-то' : ' — не вырос') + '.');
    if (plan.invalidIds.length) {
      lines.push('Некорректные записи state (в store не попадают; в списках остаются, пока читается state): ' + plan.invalidIds.slice(0, maxItems).join(', ') +
        (plan.invalidIds.length > maxItems ? ', …' : ''));
    }
    return lines.join('\n');
  }

  /**
   * createPersonalBinding(opts) -> binding
   *   opts.engine         — экземпляр SyncEngine v2.2+ (нужен opts.updatedAt у saveRecord/deleteRecord)
   *   opts.transport      — экземпляр SyncEngineTransport (attachStore/detachStore/syncNow/pushNow/on)
   *   opts.makeHooks      — SyncEnginePersonalCrypto.makePersonalHooks
   *   opts.getSyncId      — () => текущий syncId или null
   *   opts.cloudBranch    — имя ветки под /syncs/<syncId>/ (например 'personalTasks')
   *   opts.name           — имя binding'а ('tasks'), входит в storeId и имя базы
   *   opts.keyPrefix      — префикс ключей старого state, 'task:'
   *   opts.syncsPath      — '/syncs'
   *   opts.isCloudEnabled — () => boolean: false = только локальный store, сеть не трогаем
   *   opts.canSync        — () => boolean: false = не ходить в сеть (режим «оффлайн»)
   *   opts.openStorage    — (scope) => storage; по умолчанию IndexedDB (запас — память)
   *   opts.dbPrefix       — префикс имени базы IndexedDB
   *   opts.now            — () => мс (тесты)
   *   opts.onRemoteChange — вызывается, когда pull применил чужие записи
   *   opts.onCloudSynced  — вызывается после каждой сверки с облаком (syncNow), с её результатом
   *   opts.readCloud     — () => Promise<object|null>: только чтение ветки облака (один GET, без
   *                         расшифровки) — нужна ТОЛЬКО для parity (шаг 7); без неё parity сверяет state ↔ store
   *   opts.log            — функция(строка) для отладки
   *
   * binding:
   *   save(id, data, t)              -> Promise<{ok, value|error}>   «живая» запись (dirty)
   *   remove(id, t)                  -> Promise<{ok, value|error}>   тумбстоун (dirty)
   *   reconcile(state, {tombstoneMissing, cloudDelayMs, verbose}) -> Promise<{ok, value:{total, written,
   *                                     skipped, tombstoned, invalid[]}}>   сверка «state → store» без dirty
   *                                     (в журнал — только если что-то записано/погашено/некорректно,
   *                                     либо verbose:true)
   *   syncNow()                      -> Promise<{ok, value:{pull, push}|null}>  pull → сверка → push
   *   scheduleCloudSync(delayMs)                                      отложенный syncNow (склеивается)
   *   pushNow(opts)                  -> Promise|null                  срочная отправка dirty
   *   diagnose(state)                -> Promise<{ok, value:report}>   сравнение state и store
   *   parity(state, {readCloud, cloud, completions, freshMs, maxTextLen, now}) -> Promise<{ok, value:report}>
   *                                     шаг 7: подробная сверка state ↔ store ↔ облако по каждой задаче
   *                                     (см. buildParityReport); ничего не пишет
   *   snapshot({filter})             -> Promise<{ok, value:{scope,total,live,tombstones,records:[{id,c,t,dead}]}}>
   *                                     шаг 8: снимок store для чтения (в общей очереди, данные копируются);
   *                                     filter(id, updatedAt, scope) === false — запись пропускается
   *   whenIdle()                     -> Promise                        очередь опустела (тесты)
   *   getStoreId()/getScope()/isCloudAttached()/getStorageMode()
   *   detach(dropStorage)/destroy()
   */
  function createPersonalBinding(opts) {
    opts = opts || {};
    var engine = opts.engine;
    var transport = opts.transport;
    var makeHooks = opts.makeHooks;
    var getSyncId = opts.getSyncId;
    var cloudBranch = opts.cloudBranch;
    var name = opts.name || 'tasks';
    var keyPrefix = opts.keyPrefix || DEFAULT_KEY_PREFIX;
    var syncsPath = opts.syncsPath || '/syncs';
    var isCloudEnabled = typeof opts.isCloudEnabled === 'function' ? opts.isCloudEnabled : function () { return true; };
    var canSync = typeof opts.canSync === 'function' ? opts.canSync : function () { return true; };
    var now = typeof opts.now === 'function' ? opts.now : Date.now;
    var onRemoteChange = typeof opts.onRemoteChange === 'function' ? opts.onRemoteChange : function () {};
    var onCloudSynced = typeof opts.onCloudSynced === 'function' ? opts.onCloudSynced : function () {};
    var readCloudDefault = typeof opts.readCloud === 'function' ? opts.readCloud : null;
    var log = typeof opts.log === 'function' ? opts.log : function () {};
    var tag = 'PersonalBinding:' + name;

    if (!engine || typeof engine.registerStore !== 'function' || typeof engine.saveRecord !== 'function') {
      throw new Error('[PersonalBinding] opts.engine обязателен');
    }
    if (!transport || typeof transport.attachStore !== 'function') throw new Error('[PersonalBinding] opts.transport обязателен');
    if (typeof makeHooks !== 'function') throw new Error('[PersonalBinding] opts.makeHooks обязателен');
    if (typeof getSyncId !== 'function') throw new Error('[PersonalBinding] opts.getSyncId обязателен');
    if (typeof cloudBranch !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cloudBranch)) {
      throw new Error('[PersonalBinding] opts.cloudBranch должен быть простым словом (personalTasks)');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('[PersonalBinding] opts.name должен быть простым словом');
    var dbPrefix = opts.dbPrefix || ('biblePersonalShadow_v1_' + name + '_');
    var openStorage = typeof opts.openStorage === 'function'
      ? opts.openStorage
      : function (scope) { return createIdbStorage(dbPrefix + scope, { log: log }); };

    var current = null; // { scope, syncId, storeId, storage, cloud, attached }
    var seq = 0;
    var queue = Promise.resolve();
    var cloudTimer = null;
    var cloudRunning = null;
    var cloudRerun = false;
    var destroyed = false;

    // ---- привязка к текущей области (syncId | local) ------------------------
    function ensure() {
      if (destroyed) throw new Error(tag + ' уничтожен');
      var sid = getSyncId() || null;
      var scope = sid || 'local';
      if (current && current.scope === scope) return current;
      if (current) detachCurrent(true); // syncId сменился — прежняя область больше не нужна
      seq += 1;
      var storeId = 'personalbinding:' + name + ':' + scope + ':' + seq;
      var storage = openStorage(scope);
      var cfg = { storage: storage };
      var cloud = !!sid && !!isCloudEnabled();
      if (cloud) {
        try {
          var hooks = makeHooks(sid);
          cfg.cloudPath = syncsPath + '/' + sid + '/' + cloudBranch;
          cfg.encryptHook = hooks.encryptHook;
          cfg.decryptHook = hooks.decryptHook;
        } catch (err) {
          cloud = false;
          log(tag + ': облачная часть отключена (' + errMessage(err) + '), работает только локальный store');
        }
      }
      engine.registerStore(storeId, cfg);
      var att = { scope: scope, syncId: sid, storeId: storeId, storage: storage, cloud: cloud, attached: false };
      current = att; // до attachStore: события транспорта сверяют current.storeId
      if (cloud) {
        try {
          transport.attachStore(storeId);
          att.attached = true;
        } catch (err2) {
          att.cloud = false;
          log(tag + ': не удалось подключить store к транспорту (' + errMessage(err2) + '), работает только локальный store');
        }
      }
      log(tag + ': подключён, область=' + (sid ? 'syncId' : 'local') + ', облако=' + (att.attached ? 'да' : 'нет') + ', store=' + storeId);
      return att;
    }

    function detachCurrent(dropStorage) {
      var att = current;
      if (!att) return;
      current = null;
      clearTimeout(cloudTimer);
      cloudTimer = null;
      cloudRerun = false;
      if (att.attached) {
        try { transport.detachStore(att.storeId); } catch (err) { log(tag + ' detach: ' + errMessage(err)); }
      }
      if (dropStorage && att.storage && typeof att.storage.destroy === 'function') {
        Promise.resolve(att.storage.destroy()).catch(function () {});
      }
      log(tag + ': отключён, store=' + att.storeId + (dropStorage ? ' (база области удалена)' : ''));
    }

    // ---- события транспорта (общий emitter на все store — фильтруем по своему) ----
    var offs = [];
    if (typeof transport.on === 'function') {
      offs.push(transport.on('pulled', function (e) {
        if (current && e && e.storeId === current.storeId) {
          log(tag + ': pull применил ' + e.applied + ' зап. из облака');
          try { onRemoteChange(e); } catch (err) { log(tag + ' onRemoteChange: ' + errMessage(err)); }
        }
      }));
      offs.push(transport.on('warning', function (e) {
        if (current && e && e.storeId === current.storeId) {
          log(tag + ': предупреждение транспорта: ' + e.kind + ' (' + (e.ids ? e.ids.length : 0) + ' зап.)');
        }
      }));
      offs.push(transport.on('error', function (e) {
        if (current && e && e.storeId === current.storeId) {
          log(tag + ': ошибка транспорта (' + e.phase + '): ' + errMessage(e.error));
        }
      }));
    }

    // ---- очередь: одна операция за раз -----------------------------------------
    function safe(label, fn) {
      var p = queue.then(fn);
      queue = p.then(function () {}, function () {});
      return p.then(
        function (value) { return { ok: true, value: value }; },
        function (error) {
          log(tag + ' ' + label + ': ОШИБКА — ' + errMessage(error));
          return { ok: false, error: error };
        }
      );
    }

    function failed(label, err) {
      log(tag + ' ' + label + ': ОШИБКА — ' + errMessage(err));
      return Promise.resolve({ ok: false, error: err });
    }

    function checkTimestamp(t) {
      var ts = t === undefined || t === null ? now() : t;
      if (typeof ts !== 'number' || !isFinite(ts) || ts < 0) throw new Error('метка времени должна быть числом >= 0');
      return ts;
    }

    // «Живая» запись: data копируется СРАЗУ (вызывающий код правит объект задачи на месте —
    // без копии store увидел бы чужую правку без dirty и без новой метки).
    function save(id, data, t) {
      var snap, ts;
      try {
        if (!isValidRecordId(id)) throw new Error('недопустимый id "' + id + '"');
        if (data === undefined) throw new Error('data не передан');
        snap = cloneJson(data);
        ts = checkTimestamp(t);
      } catch (err) {
        return failed('save ' + id, err);
      }
      return safe('save ' + id, function () {
        var att = ensure();
        return engine.saveRecord(att.storeId, id, snap, { updatedAt: ts });
      });
    }

    function remove(id, t) {
      var ts;
      try {
        if (!isValidRecordId(id)) throw new Error('недопустимый id "' + id + '"');
        ts = checkTimestamp(t);
      } catch (err) {
        return failed('remove ' + id, err);
      }
      return safe('remove ' + id, function () {
        var att = ensure();
        return engine.deleteRecord(att.storeId, id, { updatedAt: ts });
      });
    }

    // Сверка «state → store». state только читается.
    function reconcile(stateObj, ropts) {
      ropts = ropts || {};
      var stateRef = stateObj || {};
      return safe('reconcile', async function () {
        var att = ensure();
        var res = { total: 0, written: 0, skipped: 0, tombstoned: 0, invalid: [] };
        var existing = await engine.listRecords(att.storeId, { includeDeleted: true });
        var exMap = new Map();
        existing.forEach(function (r) { exMap.set(r.id, r); });
        var seen = new Set();
        var incoming = [];
        Object.keys(stateRef).forEach(function (k) {
          if (k.indexOf(keyPrefix) !== 0) return;
          var id = k.slice(keyPrefix.length);
          var rec = stateRef[k];
          res.total += 1;
          if (!isValidRecordId(id) || !rec || typeof rec !== 'object' || typeof rec.t !== 'number' || !isFinite(rec.t) || rec.t < 0) {
            res.invalid.push(id || k);
            return;
          }
          seen.add(id);
          var ex = exMap.get(id);
          if (ex && ex.updatedAt >= rec.t) { res.skipped += 1; return; }
          var dead = !rec.c;
          var data = null;
          if (!dead) {
            try { data = cloneJson(rec.c); } catch (e) { res.invalid.push(id); return; }
          }
          incoming.push({ id: id, data: data, deleted: dead, updatedAt: rec.t });
        });
        if (incoming.length) {
          var merge = await engine.mergeIncoming(att.storeId, incoming);
          res.written = merge.applied.length;
          res.skipped += merge.skipped.length;
        }
        if (ropts.tombstoneMissing) {
          var ts = now();
          for (var i = 0; i < existing.length; i++) {
            var ex2 = existing[i];
            if (!ex2.deleted && !seen.has(ex2.id)) {
              await engine.deleteRecord(att.storeId, ex2.id, { updatedAt: ts });
              res.tombstoned += 1;
            }
          }
        }
        if (ropts.verbose || res.written || res.tombstoned || res.invalid.length) {
          log(tag + ' reconcile: в state ' + res.total + ' зап., записано в store ' + res.written + ', уже актуальны ' + res.skipped +
            (res.tombstoned ? ', погашено ' + res.tombstoned : '') + (res.invalid.length ? ', пропущено некорректных ' + res.invalid.length : ''));
        }
        if (res.written || res.tombstoned) scheduleCloudSync(ropts.cloudDelayMs);
        return res;
      });
    }

    // ---- облако -------------------------------------------------------------------
    function scheduleCloudSync(delayMs) {
      if (destroyed) return;
      var att;
      try {
        att = ensure(); // область могла смениться — привязываемся заново, если нужно
      } catch (err) {
        log(tag + ' scheduleCloudSync: ' + errMessage(err));
        return;
      }
      if (!att.attached) return;
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(function () {
        cloudTimer = null;
        runCloudSync();
      }, delayMs === undefined || delayMs === null ? 2000 : delayMs);
    }

    function runCloudSync() {
      if (destroyed || !current || !current.attached) return Promise.resolve({ ok: true, value: null });
      if (!canSync()) {
        log(tag + ': сверка с облаком пропущена — сеть запрещена (оффлайн)');
        return Promise.resolve({ ok: true, value: null });
      }
      if (cloudRunning) {
        cloudRerun = true;
        return cloudRunning;
      }
      cloudRunning = syncNow().then(function (r) {
        cloudRunning = null;
        try { onCloudSynced(r); } catch (err) { log(tag + ' onCloudSynced: ' + errMessage(err)); }
        if (cloudRerun) {
          cloudRerun = false;
          scheduleCloudSync(500);
        }
        return r;
      });
      return cloudRunning;
    }

    function syncNow() {
      return safe('syncNow', function () {
        var att = ensure();
        if (!att.attached) return null;
        log(tag + ': syncNow');
        return transport.syncNow(att.storeId);
      });
    }

    function pushNow(popts) {
      if (!current || !current.attached) return null;
      return transport.pushNow(current.storeId, popts);
    }

    // ---- диагностика: сравнение старого state и store ---------------------------------
    function diagnose(stateObj) {
      var stateRef = stateObj || {};
      return safe('diagnose', async function () {
        var att = ensure();
        var records = await engine.listRecords(att.storeId, { includeDeleted: true });
        var exMap = new Map();
        records.forEach(function (r) { exMap.set(r.id, r); });
        var rep = {
          scope: att.scope,
          storeId: att.storeId,
          cloud: att.attached,
          storageMode: att.storage && typeof att.storage.getMode === 'function' ? att.storage.getMode() : 'unknown',
          state: { live: 0, tombstones: 0, invalid: 0 },
          store: { live: 0, tombstones: 0 },
          missingInStore: [],
          olderInStore: [],
          newerInStore: [],
          extraInStore: [],
          deletedMismatch: [],
          contentDiff: [],
          ok: true,
        };
        records.forEach(function (r) { if (r.deleted) rep.store.tombstones += 1; else rep.store.live += 1; });
        var seen = new Set();
        Object.keys(stateRef).forEach(function (k) {
          if (k.indexOf(keyPrefix) !== 0) return;
          var id = k.slice(keyPrefix.length);
          var rec = stateRef[k];
          if (!isValidRecordId(id) || !rec || typeof rec !== 'object' || typeof rec.t !== 'number' || !isFinite(rec.t)) {
            rep.state.invalid += 1;
            return;
          }
          seen.add(id);
          var dead = !rec.c;
          if (dead) rep.state.tombstones += 1; else rep.state.live += 1;
          var ex = exMap.get(id);
          if (!ex) { rep.missingInStore.push(id); return; }
          if (ex.updatedAt < rec.t) { rep.olderInStore.push(id); return; }
          if (ex.updatedAt > rec.t) { rep.newerInStore.push(id); return; }
          if (!!ex.deleted !== dead) { rep.deletedMismatch.push(id); return; }
          if (!dead && stableStringify(ex.data) !== stableStringify(rec.c)) rep.contentDiff.push(id);
        });
        records.forEach(function (r) {
          if (!seen.has(r.id) && !r.deleted) rep.extraInStore.push(r.id);
        });
        rep.ok = !(rep.missingInStore.length || rep.olderInStore.length || rep.newerInStore.length ||
          rep.extraInStore.length || rep.deletedMismatch.length || rep.contentDiff.length || rep.state.invalid);
        return rep;
      });
    }

    // ---- шаг 7: parity (только чтение) ---------------------------------------------------
    // 1) state копируется СРАЗУ (правка во время сетевого запроса отчёт не искажает);
    // 2) записи store читаются в общей очереди (как diagnose) — согласованный снимок;
    // 3) облако читается ВНЕ очереди (сеть не должна задерживать записи) и только если область
    //    привязана к облаку и сеть разрешена; ошибка чтения не роняет отчёт — уходит в cloudNote.
    function snapshotForParity(stateObj, withCompletions, compPrefix) {
      var snap = {};
      Object.keys(stateObj || {}).forEach(function (k) {
        if (k.indexOf(keyPrefix) === 0 || (withCompletions && k.indexOf(compPrefix) === 0)) {
          try { snap[k] = cloneJson(stateObj[k]); } catch (e) { snap[k] = null; }
        }
      });
      return snap;
    }

    function parity(stateObj, popts) {
      popts = popts || {};
      var withCompletions = popts.completions !== false;
      var snap = snapshotForParity(stateObj, withCompletions, COMPLETION_PREFIX);
      var readCloud = typeof popts.readCloud === 'function' ? popts.readCloud : readCloudDefault;
      return safe('parity', async function () {
        var att = ensure();
        var records = await engine.listRecords(att.storeId, { includeDeleted: true });
        return {
          records: records,
          meta: {
            // в отчёте — «local» | «syncId», сам syncId (att.scope) в отчёт не попадает: его копируют в чат
            scope: att.scope === 'local' ? 'local' : 'syncId',
            cloudAttached: att.attached,
            storageMode: att.storage && typeof att.storage.getMode === 'function' ? att.storage.getMode() : null,
          },
        };
      }).then(async function (local) {
        if (!local.ok) return local;
        var input = {
          state: snap,
          records: local.value.records,
          meta: local.value.meta,
          keyPrefix: keyPrefix,
          now: popts.now !== undefined ? popts.now : now(),
          freshMs: popts.freshMs,
          maxTextLen: popts.maxTextLen,
          completions: withCompletions,
        };
        if (popts.cloud !== undefined) {
          input.cloud = popts.cloud; // готовый снимок облака (тесты)
        } else if (!local.value.meta.cloudAttached) {
          input.meta.cloudNote = local.value.meta.scope === 'local' ? 'нет syncId — облако не подключено' : 'облако выключено флагом устройства';
        } else if (!readCloud) {
          input.meta.cloudNote = 'чтение облака не подключено';
        } else if (!canSync()) {
          input.meta.cloudNote = 'режим оффлайн';
        } else {
          try {
            var raw = await readCloud();
            input.cloud = raw === undefined ? null : raw;
          } catch (err) {
            input.cloudError = 'не удалось прочитать облако: ' + errMessage(err);
          }
        }
        try {
          return { ok: true, value: buildParityReport(input) };
        } catch (err2) {
          log(tag + ' parity: ОШИБКА — ' + errMessage(err2));
          return { ok: false, error: err2 };
        }
      });
    }

    // ---- шаг 8: снимок store для чтения ---------------------------------------------------
    // Идёт в общей очереди — после уже поставленных save/remove/reconcile (согласованный срез).
    // Данные КОПИРУЮТСЯ (JSON): «вид» и state в my.js правят объект задачи на месте, без копии это тихо
    // меняло бы запись в кэше store (у memory-хранилища запись отдаётся по ссылке) — без dirty и без метки.
    // filter(id, updatedAt, scope) === false — запись не копируется и в результат не попадает (счётчики
    // live/tombstones считаются по всем записям): «вид» берёт только то, что новее уже известного ему.
    function snapshot(sopts) {
      sopts = sopts || {};
      var filter = typeof sopts.filter === 'function' ? sopts.filter : null;
      return safe('snapshot', async function () {
        var att = ensure();
        var list = await engine.listRecords(att.storeId, { includeDeleted: true });
        var out = { scope: att.scope, total: list.length, live: 0, tombstones: 0, records: [] };
        list.forEach(function (r) {
          if (r.deleted) out.tombstones += 1; else out.live += 1;
          if (filter && !filter(r.id, r.updatedAt, att.scope)) return;
          out.records.push({ id: r.id, c: r.deleted ? null : cloneJson(r.data), t: r.updatedAt, dead: !!r.deleted });
        });
        return out;
      });
    }

    function whenIdle() {
      var q = queue;
      return q.then(function () { return queue === q ? undefined : whenIdle(); });
    }

    function detach(dropStorage) {
      detachCurrent(!!dropStorage);
    }

    function destroy() {
      destroyed = true;
      offs.forEach(function (off) { try { off(); } catch (e) { /* ignore */ } });
      offs = [];
      detachCurrent(false);
    }

    return {
      save: save,
      remove: remove,
      reconcile: reconcile,
      syncNow: syncNow,
      scheduleCloudSync: scheduleCloudSync,
      pushNow: pushNow,
      diagnose: diagnose,
      parity: parity,
      snapshot: snapshot,
      whenIdle: whenIdle,
      detach: detach,
      destroy: destroy,
      getStoreId: function () { return current ? current.storeId : null; },
      getScope: function () { return current ? current.scope : null; },
      isCloudAttached: function () { return !!(current && current.attached); },
      getStorageMode: function () {
        return current && current.storage && typeof current.storage.getMode === 'function' ? current.storage.getMode() : null;
      },
    };
  }

  return {
    createPersonalBinding: createPersonalBinding,
    createIdbStorage: createIdbStorage,
    createMemoryStorage: createMemoryStorage,
    isValidRecordId: isValidRecordId,
    buildParityReport: buildParityReport,
    formatParityReport: formatParityReport,
    formatParityHeadline: formatParityHeadline,
    summarizeCompletions: summarizeCompletions,
    buildCutoverPlan: buildCutoverPlan,
    formatCutoverPlan: formatCutoverPlan,
  };
});
