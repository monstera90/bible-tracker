// syncengine.js
// Версия: 2.2 (20.09) — saveRecord/deleteRecord принимают необязательный 4-й/3-й аргумент
// { updatedAt } — метку времени записи задаёт вызывающий код (TASK_UNIFIED_SYNC.md, шаг 6:
// «теневая» запись личных задач должна нести ТУ ЖЕ метку, что и запись в старом state, иначе
// на шаге 7 нельзя сверить наборы по времени). Без аргумента — как раньше (clock()); остальное
// без изменений, обратная совместимость полная.
// Версия: 2.1 (19.09) — moveRecord: атомарный перенос записи между двумя store
// (TASK_UNIFIED_SYNC.md, шаг 4.2). Остальное без изменений.
// Версия: 2.0 (18.09)
//
// Единая точка мутации данных для всего проекта (TASK_UNIFIED_SYNC.md, шаг 1).
// Движок работает ТОЛЬКО с абстрактными записями (store/record) — ничего не
// знает про задачи/заметки/группы. Правило движка: "изменить запись" и
// "поставить её в очередь на отправку" — одно неразделимое действие
// (saveRecord/deleteRecord), поэтому dirty-tracking невозможно забыть.
//
// Границы: сам движок по-прежнему не знает ни про сеть, ни про шифрование —
// только хранит точки расширения (config.encryptHook/decryptHook/cloudPath),
// которые читает транспортный адаптер (syncengine_transport.js, шаг 2) через
// engine.getStoreConfig. Тесты гоняются без сети — см. syncengine_test.js.
//
// v2.0 (шаг 2): добавлен getStoreConfig(storeId) — единственное изменение API.
// v2.1 (шаг 4.2): добавлен moveRecord(fromStoreId, toStoreId, recordId, data) —
// перенос записи между store одним вызовом (запись в целевой store + soft-delete
// в исходном), см. комментарий у функции.
//
// Требования "не висеть во время синка" и "синк без ручного обновления
// страницы" (см. TASK_UNIFIED_SYNC.md) для этого файла означают:
//   - все публичные методы асинхронные (Promise), ни один не держит цикл
//     событий синхронным циклом;
//   - mergeIncoming обрабатывает входящие записи пачками (CHUNK_SIZE) и
//     отдаёт control в event loop между пачками — большой входящий пакет
//     (первый синк, восстановление после офлайна) не подвешивает вкладку;
//   - движок эмитит события 'dirty' и 'merged' — на шаге 2 транспортный
//     адаптер подписывается на них, чтобы: (а) запускать push сразу же по
//     'dirty' (debounce), без ожидания следующего ручного действия; (б) на
//     'merged' обновлять UI сразу, как только применились чужие изменения.
//     Про то, ЧТО должно порождать входящие данные для mergeIncoming на
//     шаге 2 — см. комментарий "Про 'стража'" в конце файла.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHUNK_SIZE = 50;

  // ---- Хранилище по умолчанию (in-memory) ---------------------------------
  // Реальная персистентность (localStorage/IndexedDB) подключается снаружи
  // через config.storage при registerStore — движок не знает, ГДЕ физически
  // лежат записи, только КАК их менять. Тот же контракт {getAll,get,put}
  // должен быть у реального адаптера на шаге 2/6.
  function createMemoryStorage() {
    var data = new Map(); // recordId -> record
    return {
      getAll: function () {
        return Promise.resolve(Array.from(data.values()));
      },
      get: function (id) {
        return Promise.resolve(data.has(id) ? data.get(id) : null);
      },
      put: function (record) {
        data.set(record.id, record);
        return Promise.resolve();
      },
    };
  }

  function yieldToEventLoop() {
    return new Promise(function (resolve) {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(function () { resolve(); }, { timeout: 50 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  // Выполняет fn СРАЗУ (синхронно) и заворачивает результат/исключение в Promise.
  function callNow(fn) {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Promise -> Promise<{ok:true,value}|{ok:false,error}> — не отклоняется никогда.
  function settle(p) {
    return p.then(
      function (value) { return { ok: true, value: value }; },
      function (error) { return { ok: false, error: error }; }
    );
  }

  // ---- Простой event emitter ------------------------------------------------
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
        (listeners[event] || []).forEach(function (fn) {
          try {
            fn(payload);
          } catch (err) {
            if (typeof console !== 'undefined') {
              console.error('[SyncEngine] listener error for "' + event + '":', err);
            }
          }
        });
      },
    };
  }

  function validateStoreId(storeId) {
    if (typeof storeId !== 'string' || !storeId) {
      throw new Error('[SyncEngine] storeId должен быть непустой строкой');
    }
  }

  function validateRecordId(recordId) {
    if (typeof recordId !== 'string' || !recordId) {
      throw new Error('[SyncEngine] recordId должен быть непустой строкой');
    }
  }

  // Метка времени записи: opts.updatedAt (если передана — конечное число >= 0), иначе clock().
  // Проверка идёт ДО любой записи: неверная метка не должна оставить полузаписанное состояние.
  function resolveTimestamp(opts, clock) {
    if (opts && opts.updatedAt !== undefined && opts.updatedAt !== null) {
      var ts = opts.updatedAt;
      if (typeof ts !== 'number' || !isFinite(ts) || ts < 0) {
        throw new Error('[SyncEngine] opts.updatedAt должен быть конечным числом >= 0, получено: ' + ts);
      }
      return ts;
    }
    return clock();
  }

  /**
   * createEngine(options?) -> engine
   * options.clock     — функция () => ms, по умолчанию Date.now (для тестов
   *                      с детерминированным временем).
   * options.chunkSize — размер пачки для mergeIncoming, по умолчанию 50.
   */
  function createEngine(options) {
    options = options || {};
    var clock = options.clock || Date.now;
    var chunkSize = options.chunkSize || CHUNK_SIZE;
    var stores = new Map(); // storeId -> { config, storage, dirty:Map<id,true> }
    var emitter = createEmitter();

    function getStoreOrThrow(storeId) {
      validateStoreId(storeId);
      var store = stores.get(storeId);
      if (!store) {
        throw new Error('[SyncEngine] store "' + storeId + '" не зарегистрирован');
      }
      return store;
    }

    /**
     * registerStore(storeId, config?)
     * config (все поля опциональны):
     *   storage      — {getAll,get,put} — адаптер персистентности,
     *                  по умолчанию in-memory (см. createMemoryStorage).
     *   encryptHook / decryptHook — читает транспорт (шаг 2), сам движок их
     *                  не вызывает и не знает про алгоритм внутри.
     *   cloudPath / access — тоже для транспорта/прав доступа, движком не
     *                  используется.
     */
    function registerStore(storeId, config) {
      validateStoreId(storeId);
      if (stores.has(storeId)) {
        throw new Error('[SyncEngine] store "' + storeId + '" уже зарегистрирован');
      }
      config = config || {};
      stores.set(storeId, {
        config: config,
        storage: config.storage || createMemoryStorage(),
        dirty: new Map(),
      });
    }

    function isRegistered(storeId) {
      return stores.has(storeId);
    }

    /**
     * getStoreConfig(storeId) -> config
     * Отдаёт config, с которым store был зарегистрирован (cloudPath,
     * encryptHook/decryptHook, access и т.д.) — чтобы транспортный адаптер
     * брал настройки store из одного места, а не дублировал их у себя.
     * Бросает исключение для незарегистрированного store.
     */
    function getStoreConfig(storeId) {
      return getStoreOrThrow(storeId).config;
    }

    /**
     * saveRecord(storeId, recordId, data, opts?) -> Promise<record>
     * ЕДИНСТВЕННАЯ точка мутации: пишет локально И помечает на отправку
     * одним вызовом — между записью и dirty-флагом нет шага, который можно
     * забыть сделать в вызывающем коде.
     * opts.updatedAt (v2.2) — метка времени записи, если её задаёт вызывающий
     * код (шаг 6: «теневая» копия записи старого state с ТОЙ ЖЕ меткой t).
     * По умолчанию — clock(). Неверное значение (не число, NaN, < 0) — исключение
     * до любой записи.
     */
    async function saveRecord(storeId, recordId, data, opts) {
      validateRecordId(recordId);
      var store = getStoreOrThrow(storeId);
      var record = { id: recordId, data: data, deleted: false, updatedAt: resolveTimestamp(opts, clock) };
      await store.storage.put(record);
      store.dirty.set(recordId, true);
      emitter.emit('dirty', { storeId: storeId, recordId: recordId, record: record });
      return record;
    }

    /** deleteRecord(storeId, recordId, opts?) -> Promise<record> — soft-delete той же атомарной точкой (opts.updatedAt — как у saveRecord, v2.2). */
    async function deleteRecord(storeId, recordId, opts) {
      validateRecordId(recordId);
      var store = getStoreOrThrow(storeId);
      var record = { id: recordId, data: null, deleted: true, updatedAt: resolveTimestamp(opts, clock) };
      await store.storage.put(record);
      store.dirty.set(recordId, true);
      emitter.emit('dirty', { storeId: storeId, recordId: recordId, record: record });
      return record;
    }

    /**
     * moveRecord(fromStoreId, toStoreId, recordId, data) -> Promise<{target, tombstone}>
     * Атомарный перенос записи между двумя store (шаг 4.2): в целевой store
     * пишется запись с данными `data`, в исходном — тумбстоун (soft-delete),
     * ОДНИМ вызовом. Раньше это были два независимых шага в вызывающем коде
     * (saveRecord в одном store + deleteRecord в другом): между ними можно было
     * остановиться (сбой, закрытая вкладка) и получить запись сразу в обоих
     * store или ни в одном.
     *
     * Гарантии:
     *  1. Оба store проверяются ДО любой записи (не зарегистрирован / совпадают
     *     — ничего не изменилось).
     *  2. Обе локальные записи стартуют СИНХРОННО внутри вызова, до первого
     *     await (тот же контракт, что у saveRecord: отрисовка сразу после
     *     вызова уже видит и новую запись, и тумбстоун).
     *  3. Обе записи получают ОДНУ и ту же метку updatedAt (одно чтение clock) —
     *     на другом устройстве перенос упорядочивается одинаково в обоих store.
     *  4. Dirty-флаги ставятся ТОЛЬКО когда обе записи легли; событие 'dirty'
     *     идёт сначала для целевого store, потом для исходного (транспорт
     *     стартует отправку в этом порядке: сначала «новый дом», потом
     *     погашение старого).
     *  5. Если одна из двух записей не легла — вторая откатывается к тому, что
     *     было до вызова (если запись в store не существовала — остаётся
     *     тумбстоун с той же меткой, локальный и без dirty), dirty не ставится,
     *     вызов бросает исключение (в тексте — «откат выполнен» или «откат НЕ
     *     выполнен»). Пока dirty не поставлен, в облако ничего не уходит.
     * Сетевая отправка остаётся ДВУМЯ push (у store разные облачные пути) —
     * это забота транспорта, движок про сеть не знает.
     */
    async function moveRecord(fromStoreId, toStoreId, recordId, data) {
      validateRecordId(recordId);
      var from = getStoreOrThrow(fromStoreId);
      var to = getStoreOrThrow(toStoreId);
      if (fromStoreId === toStoreId) {
        throw new Error('[SyncEngine] moveRecord: исходный и целевой store совпадают (' + fromStoreId + ')');
      }
      var ts = clock();
      var target = { id: recordId, data: data, deleted: false, updatedAt: ts };
      var tombstone = { id: recordId, data: null, deleted: true, updatedAt: ts };

      // Всё ниже до await выполняется синхронно. Сначала снимок «как было»
      // (для отката), потом обе записи.
      var prevTo = settle(callNow(function () { return to.storage.get(recordId); }));
      var prevFrom = settle(callNow(function () { return from.storage.get(recordId); }));
      var putTo = settle(callNow(function () { return to.storage.put(target); }));
      var putFrom = settle(callNow(function () { return from.storage.put(tombstone); }));

      var r = await Promise.all([prevTo, prevFrom, putTo, putFrom]);
      var prevToR = r[0], prevFromR = r[1], putToR = r[2], putFromR = r[3];

      if (putToR.ok && putFromR.ok) {
        to.dirty.set(recordId, true);
        from.dirty.set(recordId, true);
        emitter.emit('dirty', { storeId: toStoreId, recordId: recordId, record: target });
        emitter.emit('dirty', { storeId: fromStoreId, recordId: recordId, record: tombstone });
        return { target: target, tombstone: tombstone };
      }

      // Сбой (частичный или полный). Стороны, где put удался, откатываем
      // обязательно; на стороне, где put упал, пробуем вернуть прежнее
      // состояние «на всякий случай» (адаптер мог успеть записать до ошибки) —
      // неудача такого отката не считается сбоем отката.
      var failure = !putToR.ok ? putToR.error : putFromR.error;
      var rb = await Promise.all([
        rollbackSide(to, recordId, prevToR, ts, putToR.ok),
        rollbackSide(from, recordId, prevFromR, ts, putFromR.ok),
      ]);
      var rollbackNote = '';
      if (putToR.ok || putFromR.ok) {
        rollbackNote = (rb[0] && rb[1])
          ? ' (откат выполнен)'
          : ' (⚠️ откат НЕ выполнен — состояние двух store может расходиться)';
      }
      throw new Error('[SyncEngine] moveRecord ' + fromStoreId + ' → ' + toStoreId + ', запись "' +
        recordId + '": ' + (failure && failure.message ? failure.message : String(failure)) + rollbackNote);
    }

    // Возвращает Promise<boolean> — «с этой стороной всё в порядке».
    // prevR — результат settle() от storage.get ДО записи: {ok, value};
    // applied — put этой стороны удался (тогда откат обязателен). Записи не
    // было (null) — стереть нельзя (в контракте storage нет delete), поэтому
    // кладём тумбстоун (только если сторона успела лечь).
    function rollbackSide(store, recordId, prevR, ts, applied) {
      if (!prevR.ok) return Promise.resolve(!applied); // прежнее состояние неизвестно
      if (!prevR.value && !applied) return Promise.resolve(true); // нечего возвращать
      var back = prevR.value || { id: recordId, data: null, deleted: true, updatedAt: ts };
      return settle(callNow(function () { return store.storage.put(back); })).then(function (x) {
        return applied ? x.ok : true;
      });
    }

    /** getRecord(storeId, recordId) -> Promise<record|null> */
    async function getRecord(storeId, recordId) {
      return getStoreOrThrow(storeId).storage.get(recordId);
    }

    /**
     * listRecords(storeId, { includeDeleted }) -> Promise<record[]>
     * По умолчанию не отдаёт soft-deleted (для UI); includeDeleted:true — для диагностики.
     */
    async function listRecords(storeId, opts) {
      var store = getStoreOrThrow(storeId);
      var includeDeleted = !!(opts && opts.includeDeleted);
      var all = await store.storage.getAll();
      return includeDeleted ? all : all.filter(function (r) { return !r.deleted; });
    }

    /** getDirty(storeId) -> Promise<record[]> — записи, ожидающие отправки в облако. */
    async function getDirty(storeId) {
      var store = getStoreOrThrow(storeId);
      var ids = Array.from(store.dirty.keys());
      var records = [];
      for (var i = 0; i < ids.length; i++) {
        var r = await store.storage.get(ids[i]);
        if (r) records.push(r);
      }
      return records;
    }

    /**
     * markPushed(storeId, recordId, pushedUpdatedAt) -> Promise<boolean>
     * Снимает dirty-флаг, ТОЛЬКО если локальная запись не поменялась с
     * момента, за который шёл push (updatedAt совпадает с тем, что реально
     * ушло на сервер). Если во время сетевого запроса запись успели
     * поменять ещё раз — оставляем dirty, следующий push отправит уже
     * актуальную версию, вместо того чтобы молча считать её отправленной.
     */
    async function markPushed(storeId, recordId, pushedUpdatedAt) {
      var store = getStoreOrThrow(storeId);
      var current = await store.storage.get(recordId);
      if (!current || current.updatedAt !== pushedUpdatedAt) {
        return false;
      }
      store.dirty.delete(recordId);
      return true;
    }

    /**
     * mergeIncoming(storeId, incomingRecords) -> Promise<{applied, skipped}>
     * Last-write-wins по updatedAt: входящая запись побеждает, только если
     * incoming.updatedAt строго больше локального (при равенстве оставляем
     * локальную версию — иначе одинаковые данные будут гоняться туда-обратно
     * между устройствами). Soft-delete участвует в сравнении по тем же
     * правилам времени, отдельной логики для него нет.
     * Обрабатывает пачками (chunkSize) с отдачей event loop между ними —
     * большой входящий пакет не блокирует вкладку.
     */
    async function mergeIncoming(storeId, incomingRecords) {
      var store = getStoreOrThrow(storeId);
      var applied = [];
      var skipped = [];
      for (var i = 0; i < incomingRecords.length; i++) {
        var incoming = incomingRecords[i];
        if (!incoming || typeof incoming.id !== 'string' || typeof incoming.updatedAt !== 'number') {
          skipped.push(incoming);
          continue;
        }
        var local = await store.storage.get(incoming.id);
        var localWins = local && local.updatedAt >= incoming.updatedAt;
        if (localWins) {
          skipped.push(incoming);
        } else {
          var merged = {
            id: incoming.id,
            data: incoming.deleted ? null : incoming.data,
            deleted: !!incoming.deleted,
            updatedAt: incoming.updatedAt,
          };
          await store.storage.put(merged);
          // Входящая запись победила локальную — если по ней ещё висел
          // локальный dirty-флаг (были несинхронизированные локальные правки
          // старее, чем то, что пришло с сервера), он больше не актуален:
          // иначе следующий push отправит обратно уже перезаписанные данные.
          store.dirty.delete(incoming.id);
          applied.push(merged);
          emitter.emit('merged', { storeId: storeId, recordId: incoming.id, record: merged });
        }
        if ((i + 1) % chunkSize === 0) {
          await yieldToEventLoop();
        }
      }
      return { applied: applied, skipped: skipped };
    }

    return {
      registerStore: registerStore,
      isRegistered: isRegistered,
      getStoreConfig: getStoreConfig,
      saveRecord: saveRecord,
      deleteRecord: deleteRecord,
      moveRecord: moveRecord,
      getRecord: getRecord,
      listRecords: listRecords,
      getDirty: getDirty,
      markPushed: markPushed,
      mergeIncoming: mergeIncoming,
      on: emitter.on,
    };
  }

  return { createEngine: createEngine, createMemoryStorage: createMemoryStorage };
});

// ---- Про "стража" (вопрос из чата, не код шага 1) --------------------------
// Транспорт — Firebase Realtime Database. У неё уже есть штатный push-режим:
// подписка `ref.on('value', cb)` / `on('child_changed', cb)` держит один
// постоянный сокет и сама получает колбэк в момент изменения данных в
// облаке — без опроса (polling) и без действий пользователя. Отдельный
// "страж", который бы сам ходил и проверял актуальность — не нужен и был бы
// дороже по ресурсам, чем штатная подписка, которая и так всегда открыта,
// пока открыта вкладка. На шаге 2 (транспортный адаптер) это будет выглядеть
// так: подписка на путь стора → на колбэк вызывается
// `engine.mergeIncoming(storeId, [изменившаяся запись])` → это же само по
// себе решает "без ручного обновления страницы". Здесь, в движке шага 1,
// под это уже есть точка входа (mergeIncoming) и событие 'merged' для
// перерисовки UI сразу после применения.
