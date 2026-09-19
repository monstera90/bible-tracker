// syncengine_transport.js
// Версия: 1.2 (19.09) — новая опция opts.canSync (режим «оффлайн» в my.js): пока она
// возвращает false, фоновые push (по событию dirty и повторы после ошибки) не
// запускаются, записи остаются dirty. Остальная логика не менялась.
// Версия: 1.1 (19.09) — только диагностика (в журнал, через opts.log, теперь
// пишутся и УСПЕШНЫЕ push/pull, событие dirty, пропущенный фоновый push);
// логика не менялась. Раньше в журнал попадали только ошибки, поэтому по нему
// нельзя было отличить «не отправлялось» от «отправилось, но не дошло».
//
// TASK_UNIFIED_SYNC.md, Шаг 2, часть 1 из 3: транспорт sync-engine поверх
// Firebase Realtime Database (REST, как везде в my.js — без SDK).
//
// Что делает: берёт из движка (syncengine.js) записи, ожидающие отправки
// (dirty), шифрует их хуком store и PATCH-ит в облако; читает облако,
// расшифровывает и отдаёт движку на слияние (mergeIncoming, last-write-wins).
// Сам движок про сеть и шифрование по-прежнему ничего не знает.
//
// Формат записи в облаке — тот же, что у общих задач в my.js:
//   <cloudPath>/<recordId> = { c: <шифротекст-строка>, t: <updatedAt, мс> }
// Удалённая запись (soft-delete) = { c: null, t } — Realtime Database не
// хранит null, поэтому в облаке лежит просто { t: <число> } БЕЗ поля c.
// Читая облако, тумбстоуном считается любая запись без c (null или
// undefined) — это важно, см. TASK_UNIFIED_SYNC.md, «находки шага 2».
//
// Как подключить store (пример; всё это делается ПОЗЖЕ, на шаге 3+):
//   var engine = SyncEngine.createEngine();
//   var hooks = SyncEngineGroupCrypto.makeGroupHooks(groupId);
//   engine.registerStore('groupTasks', {
//     cloudPath: '/groups/' + groupId + '/tasks',
//     encryptHook: hooks.encryptHook, decryptHook: hooks.decryptHook });
//   var transport = SyncEngineTransport.createTransport({
//     engine: engine, dbUrl: FIREBASE_DB_URL, allowProductionPaths: true,
//     log: window.Debug && window.Debug.log });
//   transport.attachStore('groupTasks');   // с этого момента saveRecord сам
//                                          // уходит в облако (debounce)
//   transport.syncNow('groupTasks');       // при открытии вкладки / 'online'
//
// ЗАЩИТА ШАГА 2: пока allowProductionPaths не выставлен в true, транспорт
// отказывается работать с любым cloudPath вне тестовой ветки
// /__syncengine_test__/ — боевые /groups/... и /syncs/... случайно не
// затронуть. На шаге 3 флаг включается осознанно.
//
// Что НЕ делает (осознанно): постоянной подписки на изменения (SSE/стрим) —
// pull вызывается снаружи (открытие вкладки, событие 'online', таймер);
// отладочный вывод — только через переданный opts.log (в проекте это
// window.Debug.log), console не используется.
//
// Ограничение модели (унаследовано от старого кода общих задач): PATCH
// перезаписывает запись в облаке вслепую, сервер не сравнивает t. Окно
// гонки — миллисекунды между чужим push и нашим. syncNow (pull → push)
// сокращает его; полностью закрывается только правилом безопасности БД.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEngineTransport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TEST_ROOT = '/__syncengine_test__/';
  var DEFAULT_DEBOUNCE_MS = 400;
  var DEFAULT_PUSH_TIMEOUT_MS = 15000;
  var DEFAULT_PULL_TIMEOUT_MS = 10000;
  var DEFAULT_PUSH_CHUNK = 100;
  var DEFAULT_RETRY_BASE_MS = 2000;
  var DEFAULT_RETRY_MAX_MS = 60000;

  // ---- валидация путей/ключей по правилам Realtime Database ----------------
  // Ключ: не пустой, ≤768 байт UTF-8, без . $ # [ ] / и управляющих символов.
  var BAD_KEY_CHARS = /[.$#\[\]\/\u0000-\u001f\u007f]/;

  function isValidKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (BAD_KEY_CHARS.test(key)) return false;
    if (typeof TextEncoder !== 'undefined' && new TextEncoder().encode(key).length > 768) return false;
    return true;
  }

  function validateCloudPath(cloudPath, allowProductionPaths) {
    if (typeof cloudPath !== 'string' || cloudPath.charAt(0) !== '/' || cloudPath.length < 2) {
      throw new Error('[SyncEngineTransport] cloudPath должен быть строкой вида "/a/b", получено: ' + cloudPath);
    }
    var segments = cloudPath.slice(1).split('/');
    for (var i = 0; i < segments.length; i++) {
      if (!isValidKey(segments[i])) {
        throw new Error('[SyncEngineTransport] недопустимый сегмент "' + segments[i] + '" в cloudPath "' + cloudPath + '"');
      }
    }
    if (!allowProductionPaths && cloudPath.indexOf(TEST_ROOT) !== 0) {
      throw new Error('[SyncEngineTransport] cloudPath "' + cloudPath + '" вне тестовой ветки ' + TEST_ROOT +
        ' — боевые пути запрещены, пока не выставлен allowProductionPaths (шаг 3+)');
    }
    return segments;
  }

  function createEmitter() {
    var listeners = Object.create(null);
    return {
      on: function (event, fn) {
        (listeners[event] || (listeners[event] = [])).push(fn);
        return function off() {
          listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
        };
      },
      emit: function (event, payload) {
        (listeners[event] || []).slice().forEach(function (fn) {
          try { fn(payload); } catch (err) { /* слушатель не должен ломать транспорт */ }
        });
      },
      clear: function () { listeners = Object.create(null); },
    };
  }

  function errMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  /**
   * createTransport(opts) -> transport
   *   opts.engine               — экземпляр SyncEngine (обязательно)
   *   opts.dbUrl                — URL базы, как FIREBASE_DB_URL в my.js (обязательно)
   *   opts.fetch                — fetch-совместимая функция (по умолчанию глобальный fetch)
   *   opts.autoPush             — true (по умолчанию): push сам по событию 'dirty' (debounce)
   *   opts.debounceMs           — 400
   *   opts.pushTimeoutMs / pullTimeoutMs — 15000 / 10000
   *   opts.pushChunkSize        — записей в одном PATCH, 100
   *   opts.retryBaseMs / retryMaxMs — backoff повтора после сетевой ошибки, 2000 / 60000
   *   opts.canSync              — функция() -> boolean; false = сеть запрещена (режим «оффлайн» в my.js): фоновые push не запускаются, записи остаются dirty (по умолчанию всегда true)
   *   opts.allowProductionPaths — false: только /__syncengine_test__/...
   *   opts.log                  — функция(строка) для отладки (window.Debug.log)
   */
  function createTransport(opts) {
    opts = opts || {};
    var engine = opts.engine;
    if (!engine || typeof engine.getStoreConfig !== 'function' || typeof engine.getDirty !== 'function') {
      throw new Error('[SyncEngineTransport] opts.engine обязателен (экземпляр SyncEngine v2.0+)');
    }
    if (typeof opts.dbUrl !== 'string' || !/^https?:\/\//.test(opts.dbUrl)) {
      throw new Error('[SyncEngineTransport] opts.dbUrl обязателен (URL базы Firebase)');
    }
    var dbUrl = opts.dbUrl.replace(/\/+$/, '');
    var fetchImpl = opts.fetch || function (url, options) { return fetch(url, options); };
    var autoPush = opts.autoPush !== false;
    var debounceMs = opts.debounceMs != null ? opts.debounceMs : DEFAULT_DEBOUNCE_MS;
    var pushTimeoutMs = opts.pushTimeoutMs || DEFAULT_PUSH_TIMEOUT_MS;
    var pullTimeoutMs = opts.pullTimeoutMs || DEFAULT_PULL_TIMEOUT_MS;
    var pushChunkSize = opts.pushChunkSize || DEFAULT_PUSH_CHUNK;
    var retryBaseMs = opts.retryBaseMs || DEFAULT_RETRY_BASE_MS;
    var retryMaxMs = opts.retryMaxMs || DEFAULT_RETRY_MAX_MS;
    var canSync = typeof opts.canSync === 'function' ? opts.canSync : function () { return true; };
    var allowProduction = !!opts.allowProductionPaths;
    var log = typeof opts.log === 'function' ? opts.log : function () {};

    var attached = new Map(); // storeId -> состояние store в транспорте
    var emitter = createEmitter();
    var offDirty = null;
    var destroyed = false;

    // ---- сеть -------------------------------------------------------------
    // Таймаут вокруг fetch И разбора тела ответа: зависший запрос не должен
    // держать push/pull вечно. Сочетаем AbortController (реально рвёт запрос)
    // и Promise.race (работает и там, где abort игнорируется).
    function request(url, options, timeoutMs, wantJson) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer;
      var timeout = new Promise(function (resolve, reject) {
        timer = setTimeout(function () {
          if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
          reject(new Error('timeout_' + timeoutMs + 'ms'));
        }, timeoutMs);
      });
      var reqOptions = {};
      Object.keys(options).forEach(function (k) { reqOptions[k] = options[k]; });
      if (ctrl) reqOptions.signal = ctrl.signal;
      var work = Promise.resolve().then(function () {
        return fetchImpl(url, reqOptions);
      }).then(function (res) {
        if (!res.ok) return { ok: false, status: res.status, body: null };
        if (!wantJson) return { ok: true, status: res.status, body: null };
        return res.json().then(function (body) { return { ok: true, status: res.status, body: body }; });
      });
      return Promise.race([work, timeout]).then(function (v) {
        clearTimeout(timer);
        return v;
      }, function (e) {
        clearTimeout(timer);
        throw e;
      });
    }

    function getStoreOrThrow(storeId) {
      var st = attached.get(storeId);
      if (!st) throw new Error('[SyncEngineTransport] store "' + storeId + '" не подключён к транспорту (attachStore)');
      return st;
    }

    // ---- подключение store ---------------------------------------------------
    function attachStore(storeId) {
      if (destroyed) throw new Error('[SyncEngineTransport] транспорт уничтожен');
      if (attached.has(storeId)) {
        throw new Error('[SyncEngineTransport] store "' + storeId + '" уже подключён');
      }
      var cfg = engine.getStoreConfig(storeId); // бросает, если store не зарегистрирован
      var segments = validateCloudPath(cfg.cloudPath, allowProduction);
      if (typeof cfg.encryptHook !== 'function' || typeof cfg.decryptHook !== 'function') {
        // Шифрование обязательно: без хуков в облако мог бы уйти открытый текст.
        throw new Error('[SyncEngineTransport] store "' + storeId + '": нужны и encryptHook, и decryptHook');
      }
      attached.set(storeId, {
        storeId: storeId,
        cloudPath: cfg.cloudPath,
        url: dbUrl + '/' + segments.map(encodeURIComponent).join('/') + '.json',
        encryptHook: cfg.encryptHook,
        decryptHook: cfg.decryptHook,
        timer: null,        // debounce push
        retryTimer: null,
        retryDelay: retryBaseMs,
        pushing: null,      // Promise выполняющегося push (для склейки вызовов)
        rerun: false,
        extra: new Map(),   // записи, добавленные syncNow-сверкой (id -> record)
      });
      if (autoPush && !offDirty) {
        offDirty = engine.on('dirty', function (e) {
          var st = attached.get(e.storeId);
          if (st) {
            log('SyncEngineTransport "' + e.storeId + '": dirty ' + e.recordId + ' → push через ' + debounceMs + ' мс');
            schedulePush(st);
          } else {
            log('SyncEngineTransport: dirty для неподключённого store "' + e.storeId + '" (запись ' + e.recordId + ') — push НЕ запланирован');
          }
        });
      }
    }

    function detachStore(storeId) {
      var st = attached.get(storeId);
      if (!st) return;
      clearTimeout(st.timer);
      clearTimeout(st.retryTimer);
      attached.delete(storeId);
    }

    // ---- push -----------------------------------------------------------------
    // push из таймера: store мог быть отключён, а любая ошибка — только в лог
    // (pushNow сетевые ошибки и так не бросает; это страховка от необработанного reject).
    function backgroundPush(st) {
      if (destroyed || attached.get(st.storeId) !== st) {
        log('SyncEngineTransport фоновый push "' + st.storeId + '" пропущен: store отключён или транспорт уничтожен');
        return;
      }
      if (!canSync()) {
        // режим «оффлайн»: не пытаемся и не планируем повтор — записи остаются dirty,
        // их отправит syncNow/pushNow после снятия запрета
        log('SyncEngineTransport фоновый push "' + st.storeId + '" пропущен: сеть запрещена (canSync=false), записи остаются dirty');
        return;
      }
      pushNow(st.storeId).catch(function (err) {
        log('SyncEngineTransport фоновый push "' + st.storeId + '": ' + errMessage(err));
      });
    }

    function schedulePush(st) {
      if (destroyed) return;
      clearTimeout(st.timer);
      st.timer = setTimeout(function () {
        st.timer = null;
        backgroundPush(st);
      }, debounceMs);
    }

    function scheduleRetry(st) {
      if (!autoPush || destroyed || st.retryTimer) return;
      var delay = st.retryDelay;
      st.retryDelay = Math.min(st.retryDelay * 2, retryMaxMs);
      st.retryTimer = setTimeout(function () {
        st.retryTimer = null;
        backgroundPush(st);
      }, delay);
    }

    // Отправляет records (уже полученные из движка) пачками. Записи, которые
    // не ушли (сеть/шифрование/плохой id), остаются dirty — движок их не
    // «забывает»; markPushed снимает флаг ТОЛЬКО если запись не менялась во
    // время запроса (см. engine.markPushed).
    async function pushRecords(st, records, pushOpts) {
      var result = { pushed: 0, failed: [], error: null };
      for (var start = 0; start < records.length; start += pushChunkSize) {
        var chunk = records.slice(start, start + pushChunkSize);
        var payload = {};
        var sent = [];
        for (var i = 0; i < chunk.length; i++) {
          var rec = chunk[i];
          if (!isValidKey(rec.id)) {
            result.failed.push({ id: rec.id, reason: 'invalid_id' });
            continue;
          }
          try {
            if (rec.deleted) {
              payload[rec.id] = { c: null, t: rec.updatedAt };
            } else if (rec.data === undefined) {
              result.failed.push({ id: rec.id, reason: 'no_data' });
              continue;
            } else {
              payload[rec.id] = { c: await st.encryptHook(rec.data), t: rec.updatedAt };
            }
            sent.push({ id: rec.id, updatedAt: rec.updatedAt });
          } catch (err) {
            result.failed.push({ id: rec.id, reason: 'encrypt: ' + errMessage(err) });
          }
        }
        if (!sent.length) continue;
        var reqOptions = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
        if (pushOpts && pushOpts.keepalive) reqOptions.keepalive = true;
        try {
          var res = await request(st.url, reqOptions, pushTimeoutMs, false);
          if (!res.ok) throw new Error('push_failed_' + res.status);
        } catch (err) {
          result.error = err;
          sent.forEach(function (s) { result.failed.push({ id: s.id, reason: 'network: ' + errMessage(err) }); });
          break; // сеть недоступна — остальные пачки не пытаемся, всё останется dirty
        }
        for (var j = 0; j < sent.length; j++) {
          await engine.markPushed(st.storeId, sent[j].id, sent[j].updatedAt);
        }
        result.pushed += sent.length;
      }
      return result;
    }

    async function pushOnce(st, pushOpts) {
      var dirty = await engine.getDirty(st.storeId);
      // Дополняем записями из сверки syncNow (локально новее облака, но dirty-флаг потерян).
      var byId = new Map();
      dirty.forEach(function (r) { byId.set(r.id, r); });
      var dirtyCount = dirty.length;
      var extraCount = st.extra.size;
      st.extra.forEach(function (r, id) {
        var cur = byId.get(id);
        if (!cur || cur.updatedAt < r.updatedAt) byId.set(id, r);
      });
      st.extra.clear();
      var toSend = Array.from(byId.values());
      var pushT0 = Date.now();
      log('SyncEngineTransport push "' + st.storeId + '": старт, к отправке ' + toSend.length + ' зап. (dirty=' + dirtyCount + ', из сверки=' + extraCount + ')');
      var pushRes = await pushRecords(st, toSend, pushOpts);
      log('SyncEngineTransport push "' + st.storeId + '": итог — отправлено ' + pushRes.pushed + ', не ушло ' + pushRes.failed.length +
        (pushRes.error ? ', ОШИБКА ' + errMessage(pushRes.error) : '') + ', ' + (Date.now() - pushT0) + ' мс');
      return pushRes;
    }

    /**
     * pushNow(storeId, { keepalive }) -> Promise<{pushed, failed:[{id,reason}], error}>
     * Отправляет все dirty-записи store. НЕ бросает на сетевых ошибках —
     * они возвращаются в result.error (записи остаются dirty). Параллельные
     * вызовы склеиваются: если во время push пришла новая правка, после
     * него сразу идёт ещё один проход, ничего не теряется.
     */
    function pushNow(storeId, pushOpts) {
      var st = getStoreOrThrow(storeId);
      if (st.pushing) {
        st.rerun = true;
        return st.pushing;
      }
      st.pushing = (async function () {
        var result;
        try {
          do {
            st.rerun = false;
            result = await pushOnce(st, pushOpts);
          } while (st.rerun && !result.error);
        } finally {
          st.pushing = null;
        }
        if (result.error) {
          scheduleRetry(st);
          emitter.emit('error', { storeId: storeId, phase: 'push', error: result.error });
          log('SyncEngineTransport push "' + storeId + '": ошибка ' + errMessage(result.error));
        } else {
          st.retryDelay = retryBaseMs;
          if (result.pushed) emitter.emit('pushed', { storeId: storeId, count: result.pushed });
          if (result.failed.length) {
            emitter.emit('warning', { storeId: storeId, kind: 'push_failed', ids: result.failed.map(function (f) { return f.id; }), details: result.failed });
            log('SyncEngineTransport push "' + storeId + '": не отправлено ' + result.failed.length + ' зап.');
          }
        }
        return result;
      })();
      return st.pushing;
    }

    // ---- pull -----------------------------------------------------------------
    // Firebase отдаёт узел с «последовательными» целочисленными ключами как
    // массив (с null-дырками) — приводим к объекту.
    function normalizeRaw(raw) {
      if (raw === null || raw === undefined) return {};
      if (Array.isArray(raw)) {
        var obj = {};
        raw.forEach(function (v, i) { if (v !== null && v !== undefined) obj[String(i)] = v; });
        return obj;
      }
      if (typeof raw === 'object') return raw;
      return null; // не объект — неожиданная форма
    }

    async function pullInternal(st) {
      var out = { applied: 0, skipped: 0, undecryptable: [], invalid: [], cloudTimes: {}, error: null };
      var pullT0 = Date.now();
      log('SyncEngineTransport pull "' + st.storeId + '": старт');
      var raw;
      try {
        var res = await request(st.url, { method: 'GET' }, pullTimeoutMs, true);
        if (!res.ok) throw new Error('pull_failed_' + res.status);
        raw = normalizeRaw(res.body);
        if (raw === null) throw new Error('pull_bad_shape');
      } catch (err) {
        out.error = err;
        emitter.emit('error', { storeId: st.storeId, phase: 'pull', error: err });
        log('SyncEngineTransport pull "' + st.storeId + '": ошибка ' + errMessage(err));
        return out;
      }

      var local = await engine.listRecords(st.storeId, { includeDeleted: true });
      var localTimes = new Map();
      local.forEach(function (r) { localTimes.set(r.id, r.updatedAt); });

      var incoming = [];
      var ids = Object.keys(raw);
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var w = raw[id];
        if (!w || typeof w !== 'object' || typeof w.t !== 'number' || !isFinite(w.t)) {
          out.invalid.push(id);
          continue;
        }
        out.cloudTimes[id] = w.t;
        var lt = localTimes.get(id);
        if (lt !== undefined && lt >= w.t) { out.skipped++; continue; } // локальная не старше — расшифровывать незачем
        if (w.c === null || w.c === undefined) {
          // Тумбстоун. Realtime Database не хранит null, поэтому c ОТСУТСТВУЕТ.
          incoming.push({ id: id, data: null, deleted: true, updatedAt: w.t });
          continue;
        }
        if (typeof w.c !== 'string') { out.invalid.push(id); continue; }
        try {
          incoming.push({ id: id, data: await st.decryptHook(w.c), deleted: false, updatedAt: w.t });
        } catch (err) {
          // Одна нечитаемая запись (чужой ключ, порча) не должна ронять всю загрузку.
          out.undecryptable.push(id);
        }
      }

      var merge = await engine.mergeIncoming(st.storeId, incoming);
      out.applied = merge.applied.length;
      out.skipped += merge.skipped.length;
      if (out.undecryptable.length) {
        emitter.emit('warning', { storeId: st.storeId, kind: 'undecryptable', ids: out.undecryptable });
        log('SyncEngineTransport pull "' + st.storeId + '": не расшифровано ' + out.undecryptable.length + ' зап.');
      }
      if (out.invalid.length) {
        emitter.emit('warning', { storeId: st.storeId, kind: 'invalid', ids: out.invalid });
      }
      if (out.applied) emitter.emit('pulled', { storeId: st.storeId, applied: out.applied });
      log('SyncEngineTransport pull "' + st.storeId + '": итог — в облаке ' + ids.length + ' зап., применено ' + out.applied +
        ', пропущено ' + out.skipped + ', нечитаемых ' + out.undecryptable.length + ', невалидных ' + out.invalid.length + ', ' + (Date.now() - pullT0) + ' мс');
      return out;
    }

    /**
     * pullNow(storeId) -> Promise<{applied, skipped, undecryptable:[id], invalid:[id], error}>
     * Читает облако и сливает в движок (last-write-wins). Сетевые ошибки
     * не бросает — кладёт в result.error.
     */
    async function pullNow(storeId) {
      var st = getStoreOrThrow(storeId);
      var r = await pullInternal(st);
      return { applied: r.applied, skipped: r.skipped, undecryptable: r.undecryptable, invalid: r.invalid, error: r.error };
    }

    /**
     * syncNow(storeId) -> Promise<{pull, push}>
     * pull → сверка → push. Сверка лечит потерянные dirty-флаги (они живут
     * в памяти движка и пропадают при перезагрузке страницы): любая
     * локальная запись, которой нет в облаке или которая новее облачной,
     * отправляется, даже если dirty-флага уже нет. Локальные тумбстоуны
     * записей, которых в облаке никогда не было, не отправляются.
     * Вызывать при открытии вкладки / событии 'online' / по таймеру.
     */
    async function syncNow(storeId) {
      var st = getStoreOrThrow(storeId);
      var pull = await pullInternal(st);
      if (!pull.error) {
        var local = await engine.listRecords(st.storeId, { includeDeleted: true });
        local.forEach(function (r) {
          var ct = pull.cloudTimes[r.id];
          if (ct === undefined) {
            if (!r.deleted) st.extra.set(r.id, r);
          } else if (r.updatedAt > ct) {
            st.extra.set(r.id, r);
          }
        });
      }
      var push = await pushNow(storeId);
      return {
        pull: { applied: pull.applied, skipped: pull.skipped, undecryptable: pull.undecryptable, invalid: pull.invalid, error: pull.error },
        push: push,
      };
    }

    function destroy() {
      destroyed = true;
      attached.forEach(function (st) {
        clearTimeout(st.timer);
        clearTimeout(st.retryTimer);
      });
      attached.clear();
      if (offDirty) { offDirty(); offDirty = null; }
      emitter.clear();
    }

    return {
      attachStore: attachStore,
      detachStore: detachStore,
      pushNow: pushNow,
      pullNow: pullNow,
      syncNow: syncNow,
      on: emitter.on,
      destroy: destroy,
    };
  }

  return {
    createTransport: createTransport,
    TEST_ROOT: TEST_ROOT,
    // для тестов/диагностики
    _isValidKey: isValidKey,
  };
});
