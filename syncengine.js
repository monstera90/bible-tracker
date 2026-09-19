// syncengine.js
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
     * saveRecord(storeId, recordId, data) -> Promise<record>
     * ЕДИНСТВЕННАЯ точка мутации: пишет локально И помечает на отправку
     * одним вызовом — между записью и dirty-флагом нет шага, который можно
     * забыть сделать в вызывающем коде.
     */
    async function saveRecord(storeId, recordId, data) {
      validateRecordId(recordId);
      var store = getStoreOrThrow(storeId);
      var record = { id: recordId, data: data, deleted: false, updatedAt: clock() };
      await store.storage.put(record);
      store.dirty.set(recordId, true);
      emitter.emit('dirty', { storeId: storeId, recordId: recordId, record: record });
      return record;
    }

    /** deleteRecord(storeId, recordId) -> Promise<record> — soft-delete той же атомарной точкой. */
    async function deleteRecord(storeId, recordId) {
      validateRecordId(recordId);
      var store = getStoreOrThrow(storeId);
      var record = { id: recordId, data: null, deleted: true, updatedAt: clock() };
      await store.storage.put(record);
      store.dirty.set(recordId, true);
      emitter.emit('dirty', { storeId: storeId, recordId: recordId, record: record });
      return record;
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
