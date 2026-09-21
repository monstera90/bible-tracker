// syncengine_personalbinding.js
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
  };
});
