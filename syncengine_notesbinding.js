// syncengine_notesbinding.js
// Версия: 1.1 (19.09) — TASK_UNIFIED_SYNC.md, шаг 5.2 (решение пользователя,
// п.2): удаление тела заметки теперь идёт ОДНИМ PATCH вместе с notesMeta
// (значение "notes/<id>": null — Realtime Database стирает путь при null в
// PATCH, тот же приём, что и в putCloudBlob/patchNotesCloud my.js), а не
// отдельным DELETE-запросом. io.deleteCloudPath по-прежнему обязателен в
// контракте (my.js его передаёт), но pushOnce ниже его больше не вызывает.
// Подключено в mdeditor.js (шаг 5.2). reconcile — оставлен ВЫКЛЮЧЕННЫМ
// (решение пользователя, п.1): syncNow ведёт себя как старый код (pull, без
// досылки «локально новее облака»).
// Версия: 1.0 (19.09)
//
// TASK_UNIFIED_SYNC.md, Шаг 5.1: связка «заметки mdeditor.js ↔ sync-engine ↔
// облако». Аналог syncengine_groupbinding.js (шаги 3–4), но для заметок — а
// заметки в облаке лежат ИНАЧЕ, чем общие задачи, поэтому общий транспорт
// (syncengine_transport.js) для них не подходит. Сверено с mdeditor.js 3.1:
//
//   общие задачи (транспорт шага 2):    /groups/<g>/tasks/<id> = { c, t }
//   ЗАМЕТКИ (mdeditor.js, формат ниже НЕ МЕНЯЕТСЯ — старые клиенты живы):
//       /syncs/<syncId>/notesMeta/<id> = { t, deleted }      ← открытым текстом
//       /syncs/<syncId>/notes/<id>     = { iv, data }        ← шифроблок AES-GCM
//   удаление: notes/<id> стирается физически, в notesMeta остаётся { t, deleted:true }.
//
// Почему нельзя общий транспорт: (1) другая раскладка (две ветки вместо одной);
// (2) он читает ВСЮ ветку целиком, а старый pull заметок сознательно двухступенчатый
// — лёгкий GET notesMeta (без единого байта текста), тело заметки тянется
// только там, где облачная t новее локальной; заметки — самые тяжёлые данные
// проекта, «GET всех тел» на каждой сверке — регресс и риск таймаутов;
// (3) другой формат шифроблока ({iv,data}, см. syncengine_notescrypto.js).
// Общие syncengine.js/syncengine_transport.js НЕ ТРОНУТЫ (шаги 3–4 ещё ждут
// проверки в браузере) — здесь только новый файл.
//
// Что берётся от движка (syncengine.js 2.1): единая точка записи
// saveRecord/deleteRecord («изменить» и «поставить на отправку» — один вызов),
// dirty-флаги, last-write-wins (mergeIncoming), markPushed — снимает dirty ТОЛЬКО
// если запись не менялась во время отправки.
//
// ⚠️ Находка (воспроизведена на дословном тексте pushDirtyNotes из mdeditor.js,
// см. syncengine_notesbinding_test.js, раздел «старый код»): в старом
// pushDirtyNotes правка, сделанная ПОКА идёт отправка, теряется для облака:
// (а) dirty-флаг всех отправляемых id снимается по завершении PATCH — в том
// числе у заметки, отредактированной уже после снимка; (б) метка t в notesMeta
// читается ПОСЛЕ асинхронного шифрования, т.е. может оказаться новее, чем
// текст, который реально ушёл. Итог: в облаке лежит старый текст с новой
// меткой; другие устройства заберут его как «свежий», а сама правка не
// уйдёт, пока заметку не отредактируют ещё раз. Здесь это закрыто: снимок
// записи (текст и t вместе) берётся один раз, а dirty снимается через
// engine.markPushed(…, t снимка).
//
// Локальное хранилище — тот же notesMap, что использует mdeditor.js (Map
// id → {id, name, path, text, t, deleted}); адаптер движка пишет в него на
// месте (объект записи не заменяется — ссылки, которые держит mdeditor.js,
// остаются живыми). Формат записи и IndexedDB-кэш (notesCache_v1) НЕ меняются;
// сохранение кэша — через колбэки schedulePersist/persistNow, которые
// передаёт mdeditor.js.
//
// ⚠️ Контракт, на который опирается mdeditor.js (как у groupbinding): локальная
// запись в notesMap СИНХРОННА внутри save()/remove() (put адаптера выполняется
// до первого await в engine.saveRecord). Тест «локальная запись синхронна»
// ловит поломку контракта при обновлении движка. dirty и событие 'dirty' —
// на микротакт позже; pushNow дожидается уже начатых save/remove, поэтому
// «правка → сразу pushNow(срочно)» отправляет и эту правку.
//
// Сеть — только через три функции, которые mdeditor.js уже получает от my.js
// (deps.fetchCloudPath / patchCloud / deleteCloudPath, привязаны к
// /syncs/<текущий syncId>/): Firebase-специфика остаётся в my.js, второго
// канала к /syncs не заводится. Семантика та же, что в старом коде:
// fetchCloudPath(sub) → Promise<значение|null> (reject при сбое),
// patchCloud(patch, {keepalive}), deleteCloudPath(sub, {keepalive}).
//
// Что делает по сравнению со старым кодом (осознанные отличия, все закрыты
// тестами): (1) снимок записи и markPushed (см. находку выше); (2) отправка
// пачками по pushChunkSize заметок, а не одним PATCH на всё; (3) загрузка тел
// заметок с ограничением параллелизма (maxParallelFetch), а не «все разом» —
// при первом синке сотен заметок это был шторм запросов; (4) проверка формы
// расшифрованного payload — заметка с битым payload пропускается и поднимает
// hadFetchError, а не заносится в notesMap с name=undefined; (5) сбой GET
// notesMeta возвращается как { hadFetchError:true, error } — раньше это был
// необработанный reject в syncNotesOnTabEnter; (6) если syncId сменился во
// время pull — результат не применяется (записи чужого аккаунта не попадут в
// notesMap); (7) syncNow может (reconcile:true) отправить записи, которые
// локально новее облака, даже если dirty-флаг потерян при перезагрузке —
// по умолчанию ВЫКЛЮЧЕНО, потому что старый код так не делал и потому что
// в mdeditor.js кэш notesCache_v1 не привязан к syncId: если при смене
// аккаунта кэш не очищается (что делает my.js — на момент шага 5.1 не
// проверялось, my.js не загружался), reconcile залил бы локальные заметки
// прежнего аккаунта в новый. Решение пользователя (шаг 5.2): оставить
// ВЫКЛЮЧЕННЫМ — mdeditor.js передаёт reconcile:false явно.
//
// Не делает: не показывает ничего пользователю, не строит дерево/nameIndex, не
// закрывает открытый редактор — это остаётся в mdeditor.js и подключается через
// onRemoteApplied({id, rec, prev, deleted}). dirty-флаги живут в памяти (как и
// раньше — dirtyNoteIds) и при перезагрузке теряются; лечит только reconcile.
//
// Отладка — только через opts.log (в проекте window.Debug.log).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEngineNotesBinding = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_DEBOUNCE_MS = 400;                          // как NOTES_PUSH_DEBOUNCE_MS
  var DEFAULT_RETRY_DELAYS = [5000, 15000, 40000, 90000]; // как NOTES_RETRY_DELAYS
  var DEFAULT_PUSH_CHUNK = 25;
  var DEFAULT_MAX_PARALLEL_FETCH = 6;

  // Ключ Realtime Database: не пустой, ≤768 байт, без . $ # [ ] / и управляющих.
  var BAD_KEY_CHARS = /[.$#\[\]\/\u0000-\u001f\u007f]/;
  function isValidKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (BAD_KEY_CHARS.test(key)) return false;
    if (typeof TextEncoder !== 'undefined' && new TextEncoder().encode(key).length > 768) return false;
    return true;
  }

  function errMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  function runNow(fn) {
    try { return Promise.resolve(fn()); } catch (err) { return Promise.reject(err); }
  }

  function resolveEngine() {
    if (typeof SyncEngine !== 'undefined' && SyncEngine && typeof SyncEngine.createEngine === 'function') {
      return SyncEngine.createEngine();
    }
    if (typeof require === 'function') {
      return require('./syncengine.js').createEngine();
    }
    throw new Error('[NotesBinding] SyncEngine не найден: подключите syncengine.js или передайте opts.engine');
  }

  // Firebase отдаёт узел с «последовательными» целыми ключами массивом — приводим к объекту.
  function normalizeMeta(raw) {
    if (raw === null || raw === undefined) return {};
    if (Array.isArray(raw)) {
      var obj = {};
      raw.forEach(function (v, i) { if (v !== null && v !== undefined) obj[String(i)] = v; });
      return obj;
    }
    if (typeof raw === 'object') return raw;
    return null;
  }

  // Пул: не больше limit одновременных задач; ошибки задач наружу не бросает.
  async function runPool(items, limit, worker) {
    var next = 0;
    async function lane() {
      while (next < items.length) {
        var item = items[next++];
        await worker(item);
      }
    }
    var lanes = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) lanes.push(lane());
    await Promise.all(lanes);
  }

  /**
   * createNotesBinding(opts) -> binding
   *   opts.io            — { fetchCloudPath(sub), patchCloud(patch, {keepalive}),
   *                          deleteCloudPath(sub, {keepalive}) } — deps mdeditor.js
   *   opts.makeHooks     — SyncEngineNotesCrypto.makeNotesHooks (syncId -> {encryptHook, decryptHook})
   *   opts.getSyncId     — () => текущий syncId или null
   *   opts.notesMap      — Map mdeditor.js: id -> {id, name, path, text, t, deleted?}
   *   opts.engine        — экземпляр SyncEngine (v2.1+); по умолчанию создаётся свой
   *   opts.storeId       — имя store в движке, по умолчанию 'notes'
   *   opts.isOnline      — () => bool, по умолчанию navigator.onLine
   *   opts.debounceMs / retryDelays / pushChunkSize / maxParallelFetch — см. константы
   *   opts.reconcile     — false (по умолчанию): syncNow не досылает «локально новее облака»
   *   opts.schedulePersist — () => void: запланировать сохранение notesCache (после каждой записи)
   *   opts.persistNow    — () => void: сохранить notesCache сразу (после применения чужих правок)
   *   opts.onRemoteApplied — ({id, rec, prev, deleted}) — pull применил чужую правку
   *   opts.log           — функция(строка)
   *
   * binding:
   *   save(id, {name, path, text}) -> Promise<record>   создать/изменить (локально — синхронно)
   *   remove(id)                   -> Promise<record|null>  soft-delete (тумбстоун)
   *   pushNow({keepalive})         -> Promise<{pushed, failed, error, skipped?}>
   *   pullNow()                    -> Promise<{applied, skipped, hadFetchError, error, failedIds, missingBody, offline}>
   *   syncNow()                    -> Promise<{pull, push}>  pull → (сверка) → push
   *   retryPushOnReconnect()       -> Promise  сброс счётчика повторов + pushNow (для события 'online')
   *   getDirtyIds()                -> Promise<string[]>
   *   getStoreId(), destroy()
   */
  function createNotesBinding(opts) {
    opts = opts || {};
    var io = opts.io;
    var makeHooks = opts.makeHooks;
    var getSyncId = opts.getSyncId;
    var notesMap = opts.notesMap;
    var storeId = opts.storeId || 'notes';
    var debounceMs = opts.debounceMs != null ? opts.debounceMs : DEFAULT_DEBOUNCE_MS;
    var retryDelays = opts.retryDelays || DEFAULT_RETRY_DELAYS;
    var pushChunkSize = opts.pushChunkSize || DEFAULT_PUSH_CHUNK;
    var maxParallelFetch = opts.maxParallelFetch || DEFAULT_MAX_PARALLEL_FETCH;
    var reconcile = !!opts.reconcile;
    var isOnline = typeof opts.isOnline === 'function' ? opts.isOnline
      : function () { return typeof navigator === 'undefined' || navigator.onLine !== false; };
    var schedulePersist = typeof opts.schedulePersist === 'function' ? opts.schedulePersist : function () {};
    var persistNow = typeof opts.persistNow === 'function' ? opts.persistNow : function () {};
    var onRemoteApplied = typeof opts.onRemoteApplied === 'function' ? opts.onRemoteApplied : function () {};
    var log = typeof opts.log === 'function' ? opts.log : function () {};

    if (!io || typeof io.fetchCloudPath !== 'function' || typeof io.patchCloud !== 'function' || typeof io.deleteCloudPath !== 'function') {
      throw new Error('[NotesBinding] opts.io должен иметь fetchCloudPath/patchCloud/deleteCloudPath');
    }
    if (typeof makeHooks !== 'function') throw new Error('[NotesBinding] opts.makeHooks обязателен');
    if (typeof getSyncId !== 'function') throw new Error('[NotesBinding] opts.getSyncId обязателен');
    if (!notesMap || typeof notesMap.get !== 'function' || typeof notesMap.set !== 'function' || typeof notesMap.forEach !== 'function') {
      throw new Error('[NotesBinding] opts.notesMap должен быть Map');
    }

    var engine = opts.engine || resolveEngine();
    var destroyed = false;

    // Хуки привязаны к syncId (см. syncengine_notescrypto.js) — пересоздаём при смене.
    var hooksSyncId = null, hooksObj = null;
    function getHooks() {
      var id = getSyncId();
      if (!id) throw new Error('no_sync');
      if (hooksSyncId !== id) { hooksObj = makeHooks(id); hooksSyncId = id; }
      return hooksObj;
    }

    // ---- адаптер хранилища движка поверх notesMap ------------------------------
    function toRecord(id, rec) {
      var dead = !!rec.deleted;
      return {
        id: id,
        data: dead ? null : {
          name: rec.name,
          path: rec.path == null ? '' : rec.path,
          text: rec.text == null ? '' : rec.text,
        },
        deleted: dead,
        updatedAt: typeof rec.t === 'number' ? rec.t : 0,
      };
    }
    var storage = {
      getAll: function () {
        return runNow(function () {
          var out = [];
          notesMap.forEach(function (rec, id) { if (rec && typeof rec === 'object') out.push(toRecord(id, rec)); });
          return out;
        });
      },
      get: function (id) {
        return runNow(function () {
          var rec = notesMap.get(id);
          return rec && typeof rec === 'object' ? toRecord(id, rec) : null;
        });
      },
      put: function (record) {
        return runNow(function () {
          var prev = notesMap.get(record.id);
          if (record.deleted) {
            // Тумбстоун: имя/путь сохраняем (как старый код), текст очищаем.
            if (prev) { prev.deleted = true; prev.t = record.updatedAt; prev.text = ''; }
            else notesMap.set(record.id, { id: record.id, deleted: true, t: record.updatedAt, name: undefined, path: undefined, text: '' });
          } else {
            var d = record.data || {};
            if (prev) {
              prev.name = d.name; prev.path = d.path; prev.text = d.text; prev.t = record.updatedAt;
              delete prev.deleted;
            } else {
              notesMap.set(record.id, { id: record.id, name: d.name, path: d.path, text: d.text, t: record.updatedAt });
            }
          }
          try { schedulePersist(); } catch (e) { log('NotesBinding: schedulePersist: ' + errMessage(e)); }
        });
      },
    };

    engine.registerStore(storeId, {
      storage: storage,
      // Движок хуки не вызывает; они здесь для единообразия конфига store и диагностики.
      encryptHook: function (d) { return getHooks().encryptHook(d); },
      decryptHook: function (c) { return getHooks().decryptHook(c); },
      layout: 'notesMeta+notes',
    });

    // ---- состояние отправки -----------------------------------------------------
    var timer = null, retryTimer = null, retryCount = 0;
    var pushing = null, rerun = false, keepaliveWanted = false;
    var writes = new Set(); // начатые save/remove — pushNow дожидается их dirty-флагов
    var extra = new Map();  // записи из reconcile-сверки (id -> record)

    function track(p) {
      writes.add(p);
      var done = function () { writes.delete(p); };
      p.then(done, done);
      return p;
    }
    function settleWrites() {
      var list = Array.from(writes).map(function (p) { return p.then(function () {}, function () {}); });
      return Promise.all(list);
    }

    function backgroundPush() {
      if (destroyed) return;
      pushNow().catch(function (err) { log('NotesBinding: фоновый push: ' + errMessage(err)); });
    }

    // Как scheduleNotesCloudPush: правка сбрасывает повторы и ставит debounce;
    // если отправка уже идёт — просим ещё один проход после неё.
    function schedulePush() {
      if (destroyed || !getSyncId()) return;
      clearTimeout(retryTimer); retryTimer = null; retryCount = 0;
      if (pushing) { rerun = true; return; }
      clearTimeout(timer);
      timer = setTimeout(function () { timer = null; backgroundPush(); }, debounceMs);
    }

    function scheduleRetry() {
      if (destroyed || retryTimer || retryCount >= retryDelays.length) return;
      var d = retryDelays[retryCount]; retryCount++;
      retryTimer = setTimeout(function () { retryTimer = null; backgroundPush(); }, d);
    }

    var offDirty = engine.on('dirty', function (e) {
      if (e && e.storeId === storeId) schedulePush();
    });

    // ---- push -----------------------------------------------------------------------
    async function pushOnce(keepalive) {
      var out = { pushed: 0, failed: [], error: null };
      await settleWrites();
      var dirty = await engine.getDirty(storeId);
      var byId = new Map();
      dirty.forEach(function (r) { byId.set(r.id, r); });
      var dirtyCount = dirty.length, extraCount = extra.size;
      extra.forEach(function (r, id) {
        var cur = byId.get(id);
        if (!cur || cur.updatedAt < r.updatedAt) byId.set(id, r);
      });
      extra.clear();
      var toSend = Array.from(byId.values());
      if (!toSend.length) return out;

      var t0 = Date.now();
      log('NotesBinding push: старт, к отправке ' + toSend.length + ' заметок (dirty=' + dirtyCount + ', из сверки=' + extraCount + ')');
      var hooks;
      try { hooks = getHooks(); } catch (err) { out.error = err; return out; }
      var ioOpts = { keepalive: !!keepalive };

      for (var start = 0; start < toSend.length; start += pushChunkSize) {
        var chunk = toSend.slice(start, start + pushChunkSize);
        var patch = {}, sent = [];
        for (var i = 0; i < chunk.length; i++) {
          var rec = chunk[i];
          if (!isValidKey(rec.id)) { out.failed.push({ id: rec.id, reason: 'invalid_id' }); continue; }
          try {
            if (rec.deleted) {
              // Решение пользователя (шаг 5.2, п.2): тело стирается тем же PATCH,
              // значением null — Firebase Realtime Database удаляет путь при null
              // в multi-location PATCH, отдельный DELETE-запрос больше не нужен.
              patch['notes/' + rec.id] = null;
              patch['notesMeta/' + rec.id] = { t: rec.updatedAt, deleted: true };
            } else {
              // Снимок: текст и t — из ОДНОЙ записи, взятой движком (а не читаются заново после шифрования).
              patch['notes/' + rec.id] = await hooks.encryptHook(rec.data);
              patch['notesMeta/' + rec.id] = { t: rec.updatedAt, deleted: false };
            }
            sent.push({ id: rec.id, updatedAt: rec.updatedAt });
          } catch (err) {
            out.failed.push({ id: rec.id, reason: 'encrypt: ' + errMessage(err) });
          }
        }
        if (!sent.length) continue;
        try {
          // Удаление тела заметки (null в patch) и notesMeta уходят одним PATCH
          // (см. версию 1.1 выше) — отдельного DELETE больше нет.
          await io.patchCloud(patch, ioOpts);
        } catch (err) {
          out.error = err;
          sent.forEach(function (s) { out.failed.push({ id: s.id, reason: 'network: ' + errMessage(err) }); });
          break; // сеть недоступна — остальные пачки не пытаемся, всё останется dirty
        }
        for (var j = 0; j < sent.length; j++) {
          await engine.markPushed(storeId, sent[j].id, sent[j].updatedAt);
        }
        out.pushed += sent.length;
      }
      log('NotesBinding push: итог — отправлено ' + out.pushed + ', не ушло ' + out.failed.length +
        (out.error ? ', ОШИБКА ' + errMessage(out.error) : '') + ', ' + (Date.now() - t0) + ' мс');
      return out;
    }

    function pushNow(pushOpts) {
      if (destroyed) return Promise.resolve({ pushed: 0, failed: [], error: null, skipped: 'destroyed' });
      if (!getSyncId() || !isOnline()) {
        return Promise.resolve({ pushed: 0, failed: [], error: null, skipped: 'offline_or_no_sync' });
      }
      if (pushOpts && pushOpts.keepalive) keepaliveWanted = true;
      if (pushing) { rerun = true; return pushing; }
      pushing = (async function () {
        // Итог — сумма по всем проходам (повторный проход из-за правки во время
        // отправки не должен «затирать» результат первого).
        var result = { pushed: 0, failed: [], error: null };
        try {
          do {
            rerun = false;
            var ka = keepaliveWanted; keepaliveWanted = false;
            var pass = await pushOnce(ka);
            result.pushed += pass.pushed;
            result.failed = result.failed.concat(pass.failed);
            result.error = pass.error;
          } while (rerun && !result.error);
        } finally {
          pushing = null;
        }
        if (result.error) {
          scheduleRetry();
          log('NotesBinding push: ошибка ' + errMessage(result.error));
        } else {
          retryCount = 0;
          clearTimeout(retryTimer); retryTimer = null;
        }
        return result;
      })();
      return pushing;
    }

    // ---- pull: сначала лёгкий notesMeta, тела — только у новых ----------------------
    async function pullInternal() {
      var out = { applied: 0, skipped: 0, hadFetchError: false, error: null, failedIds: [], missingBody: [], offline: false, cloudTimes: {} };
      var startId = getSyncId();
      if (destroyed || !startId || !isOnline()) { out.offline = true; return out; }
      var t0 = Date.now();
      log('NotesBinding pull: старт');
      var hooks;
      try { hooks = getHooks(); } catch (err) { out.error = err; out.hadFetchError = true; return out; }

      var meta;
      try {
        meta = normalizeMeta(await io.fetchCloudPath('notesMeta'));
        if (meta === null) throw new Error('pull_bad_shape');
      } catch (err) {
        out.error = err; out.hadFetchError = true;
        log('NotesBinding pull: ошибка notesMeta — ' + errMessage(err));
        return out;
      }

      var tombstones = [], toFetch = [], cloudT = {};
      Object.keys(meta).forEach(function (id) {
        var entry = meta[id];
        if (!entry || typeof entry !== 'object') return;
        var ct = typeof entry.t === 'number' && isFinite(entry.t) ? entry.t : 0;
        cloudT[id] = ct;
        out.cloudTimes[id] = ct;
        var local = notesMap.get(id);
        var localT = local ? (local.t || 0) : -1;
        if (ct <= localT) { out.skipped++; return; }
        if (entry.deleted) tombstones.push({ id: id, data: null, deleted: true, updatedAt: ct });
        else toFetch.push(id);
      });

      var fetched = [];
      await runPool(toFetch, maxParallelFetch, async function (id) {
        try {
          var enc = await io.fetchCloudPath('notes/' + id);
          if (!enc) { out.missingBody.push(id); return; } // как в старом коде: тихий пропуск
          var payload = await hooks.decryptHook(enc);
          if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string' || typeof payload.text !== 'string') {
            throw new Error('bad_payload');
          }
          fetched.push({
            id: id,
            data: { name: payload.name, path: typeof payload.path === 'string' ? payload.path : '', text: payload.text },
            deleted: false,
            updatedAt: cloudT[id],
          });
        } catch (err) {
          // Одна нечитаемая заметка не мешает остальным; факт пропуска — во флаге
          // (по нему корзина сирот картинок пропускает цикл, см. баг от 14.09).
          out.hadFetchError = true;
          out.failedIds.push(id);
        }
      });

      if (destroyed || getSyncId() !== startId) {
        out.error = new Error('sync_id_changed');
        out.hadFetchError = true;
        log('NotesBinding pull: syncId сменился во время сверки — результат отброшен');
        return out;
      }

      var incoming = tombstones.concat(fetched);
      var prevSnap = new Map();
      incoming.forEach(function (r) {
        var p = notesMap.get(r.id);
        prevSnap.set(r.id, p ? Object.assign({}, p) : null);
      });
      var merge = await engine.mergeIncoming(storeId, incoming);
      out.applied = merge.applied.length;
      out.skipped += merge.skipped.length;
      if (merge.applied.length) {
        try { persistNow(); } catch (e) { log('NotesBinding: persistNow: ' + errMessage(e)); }
        merge.applied.forEach(function (r) {
          try {
            onRemoteApplied({ id: r.id, rec: notesMap.get(r.id), prev: prevSnap.get(r.id) || null, deleted: !!r.deleted });
          } catch (e) { log('NotesBinding: onRemoteApplied: ' + errMessage(e)); }
        });
      }
      log('NotesBinding pull: итог — в облаке ' + Object.keys(meta).length + ' заметок, применено ' + out.applied +
        ', пропущено ' + out.skipped + ', не прочитано ' + out.failedIds.length + ', без тела ' + out.missingBody.length +
        ', ' + (Date.now() - t0) + ' мс');
      return out;
    }

    function publicPull(p) {
      return { applied: p.applied, skipped: p.skipped, hadFetchError: p.hadFetchError, error: p.error,
        failedIds: p.failedIds, missingBody: p.missingBody, offline: p.offline };
    }

    async function pullNow() {
      return publicPull(await pullInternal());
    }

    async function syncNow() {
      var pull = await pullInternal();
      if (reconcile && !pull.error && !pull.offline) {
        var local = await engine.listRecords(storeId, { includeDeleted: true });
        local.forEach(function (r) {
          var ct = pull.cloudTimes[r.id];
          if (ct === undefined) { if (!r.deleted) extra.set(r.id, r); }
          else if (r.updatedAt > ct) extra.set(r.id, r);
        });
      }
      var push = await pushNow();
      return { pull: publicPull(pull), push: push };
    }

    // ---- запись -------------------------------------------------------------------------
    function save(id, data) {
      if (destroyed) throw new Error('[NotesBinding] binding уничтожен');
      if (!data || typeof data !== 'object' || typeof data.name !== 'string') {
        throw new Error('[NotesBinding] save: нужен объект {name, path, text}');
      }
      return track(engine.saveRecord(storeId, id, {
        name: data.name,
        path: data.path == null ? '' : String(data.path),
        text: data.text == null ? '' : String(data.text),
      }));
    }

    function remove(id) {
      if (destroyed) throw new Error('[NotesBinding] binding уничтожен');
      if (!notesMap.has(id)) return Promise.resolve(null); // как deleteNoteRecord: нет записи — нечего удалять
      return track(engine.deleteRecord(storeId, id));
    }

    function retryPushOnReconnect() {
      retryCount = 0;
      clearTimeout(retryTimer); retryTimer = null;
      return pushNow();
    }

    function getDirtyIds() {
      return engine.getDirty(storeId).then(function (list) { return list.map(function (r) { return r.id; }); });
    }

    function destroy() {
      destroyed = true;
      clearTimeout(timer); clearTimeout(retryTimer);
      timer = null; retryTimer = null;
      try { offDirty(); } catch (e) { /* ignore */ }
    }

    return {
      save: save,
      remove: remove,
      pushNow: pushNow,
      pullNow: pullNow,
      syncNow: syncNow,
      retryPushOnReconnect: retryPushOnReconnect,
      getDirtyIds: getDirtyIds,
      getStoreId: function () { return storeId; },
      destroy: destroy,
    };
  }

  return { createNotesBinding: createNotesBinding };
});
