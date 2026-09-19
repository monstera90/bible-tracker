// syncengine_groupbinding.js
// Версия: 1.0 (19.09)
//
// TASK_UNIFIED_SYNC.md, Шаг 3: связка «групповой облачный путь ↔ sync-engine ↔
// транспорт ↔ локальный кэш my.js». Первый реальный потребитель движка.
//
// Зачем отдельный файл. my.js — ~17 тыс. строк, а эта логика (адаптер
// хранилища, жизненный цикл store при смене группы, события транспорта) не
// зависит от DOM и остальных функций my.js — так её можно гонять в Node
// синтетическими тестами (syncengine_groupbinding_test.js) против настоящих
// syncengine.js / syncengine_transport.js / syncengine_groupcrypto.js. Шаг 4
// (архив общих задач) подключается тем же файлом: другой `name` ('archive') и
// другой кэш — новый код push/pull не нужен.
//
// Модель. Один binding = один облачный путь группы:
//   /groups/<groupId>/<name>/<id> = { c: <шифротекст>, t: <мс> }   (формат
//   {c,t} и шифрование SHA-256(groupId) → AES-GCM — те же, что у старого
//   клиента, поэтому участники со старой версией приложения не ломаются).
//
// Локальный кэш остаётся СИНХРОННЫМ (my.js читает его прямо во время
// отрисовки: getAllGroupTasks/getGroupTaskById). Поэтому адаптер хранилища
// для движка — тонкая обёртка над кэшем my.js: id → {c, t}, где c === null —
// тумбстоун. Движок пишет в кэш ТОЛЬКО через адаптер (storage.put), а значит
// «изменить запись» и «поставить на отправку» — один вызов save()/remove().
//
// ⚠️ Контракт, на который опирается my.js: локальная запись в кэш происходит
// СИНХРОННО внутри вызова save()/remove() (put адаптера выполняется до первого
// await внутри engine.saveRecord), а dirty-флаг и событие 'dirty' — на
// микротакт позже. Отрисовка сразу после save() поэтому уже видит новую
// запись. Тест «локальная запись синхронна» в syncengine_groupbinding_test.js
// ловит поломку этого контракта при обновлении движка.
//
// Смена/выход из группы: у каждой привязки к группе свой storeId
// ('groupbinding:<name>:<groupId>:<n>') — незавершённые dirty старой привязки
// не переезжают в новую. Адаптер хранилища привязан к своей привязке и
// отказывает (reject), если группа уже другая/отвязана — записи чужой группы в
// кэш текущей попасть не могут.
//
// Что НЕ делает: не читает и не показывает ничего пользователю, не решает
// «активна ли группа» (это getGroupId() из my.js), не хранит dirty-флаги между
// перезагрузками (их лечит transport.syncNow — сверка «локально новее облака»).
//
// Отладка — только через opts.log (в проекте window.Debug.log).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEngineGroupBinding = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function errMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  // Выполняет fn СРАЗУ (синхронно) и заворачивает результат/исключение в
  // Promise — важно для контракта «локальная запись синхронна», см. шапку.
  function runNow(fn) {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * createGroupBinding(opts) -> binding
   *   opts.engine        — экземпляр SyncEngine (v2.0+), общий для приложения
   *   opts.transport     — экземпляр SyncEngineTransport (attachStore/syncNow/...),
   *                        созданный с allowProductionPaths: true
   *   opts.makeHooks     — SyncEngineGroupCrypto.makeGroupHooks
   *   opts.name          — имя ветки группы: 'tasks' (шаг 3), 'archive' (шаг 4)
   *   opts.groupsPath    — корень групп в базе, у my.js '/groups'
   *   opts.getGroupId    — () => текущий groupId или null
   *   opts.cache         — синхронный локальный кэш my.js:
   *                          load(groupId) — загрузить кэш этой группы (идемпотентно),
   *                          get()         — ТЕКУЩИЙ объект id → {c, t} (после load),
   *                          save()        — записать кэш в localStorage
   *   opts.onRemoteChange— (событие) вызывается, когда pull применил чужие правки
   *   opts.log           — функция(строка) для отладки
   *
   * binding:
   *   save(id, data)     -> Promise<record>   создать/изменить запись
   *   remove(id)         -> Promise<record>   soft-delete (тумбстоун)
   *   syncNow()          -> Promise<{pull, push}>  pull → сверка → push
   *   pushNow(opts)      -> Promise<{pushed, failed, error}>
   *   detach()                                отключиться от текущей группы
   *   getStoreId()       -> string|null
   *   destroy()                               снять подписки (для тестов)
   */
  function createGroupBinding(opts) {
    opts = opts || {};
    var engine = opts.engine;
    var transport = opts.transport;
    var makeHooks = opts.makeHooks;
    var name = opts.name;
    var groupsPath = opts.groupsPath || '/groups';
    var getGroupId = opts.getGroupId;
    var cache = opts.cache;
    var onRemoteChange = typeof opts.onRemoteChange === 'function' ? opts.onRemoteChange : function () {};
    var log = typeof opts.log === 'function' ? opts.log : function () {};

    if (!engine || typeof engine.registerStore !== 'function') throw new Error('[GroupBinding] opts.engine обязателен');
    if (!transport || typeof transport.attachStore !== 'function') throw new Error('[GroupBinding] opts.transport обязателен');
    if (typeof makeHooks !== 'function') throw new Error('[GroupBinding] opts.makeHooks обязателен');
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('[GroupBinding] opts.name должен быть простым словом (tasks/archive)');
    if (typeof getGroupId !== 'function') throw new Error('[GroupBinding] opts.getGroupId обязателен');
    if (!cache || typeof cache.load !== 'function' || typeof cache.get !== 'function' || typeof cache.save !== 'function') {
      throw new Error('[GroupBinding] opts.cache должен иметь load/get/save');
    }

    var current = null; // { groupId, storeId } — текущая привязка
    var seq = 0;

    // ---- адаптер хранилища движка поверх синхронного кэша my.js ------------
    function makeStorage(att) {
      function open() {
        if (current !== att || getGroupId() !== att.groupId) {
          throw new Error('[GroupBinding:' + name + '] привязка к группе уже неактуальна (группа сменилась/отвязана)');
        }
        cache.load(att.groupId);
        return cache.get();
      }
      function toRecord(id, rec) {
        var dead = rec.c === null || rec.c === undefined;
        return {
          id: id,
          data: dead ? null : rec.c,
          deleted: dead,
          updatedAt: typeof rec.t === 'number' ? rec.t : 0,
        };
      }
      return {
        getAll: function () {
          return runNow(function () {
            var st = open();
            var out = [];
            Object.keys(st).forEach(function (id) {
              if (st[id] && typeof st[id] === 'object') out.push(toRecord(id, st[id]));
            });
            return out;
          });
        },
        get: function (id) {
          return runNow(function () {
            var st = open();
            var rec = st[id];
            return rec && typeof rec === 'object' ? toRecord(id, rec) : null;
          });
        },
        put: function (record) {
          return runNow(function () {
            var st = open();
            st[record.id] = { c: record.deleted ? null : record.data, t: record.updatedAt };
            cache.save();
          });
        },
      };
    }

    // ---- привязка к текущей группе -----------------------------------------
    function ensure() {
      var groupId = getGroupId();
      if (!groupId) throw new Error('[GroupBinding:' + name + '] нет активной группы');
      if (current && current.groupId === groupId) return current;
      if (current) detach(); // группа сменилась — старую привязку отключаем
      seq += 1;
      var att = { groupId: groupId, storeId: 'groupbinding:' + name + ':' + groupId + ':' + seq };
      var hooks = makeHooks(groupId);
      engine.registerStore(att.storeId, {
        cloudPath: groupsPath + '/' + groupId + '/' + name,
        encryptHook: hooks.encryptHook,
        decryptHook: hooks.decryptHook,
        storage: makeStorage(att),
      });
      current = att; // до attachStore: адаптер сверяет current === att
      try {
        transport.attachStore(att.storeId);
      } catch (err) {
        current = null;
        throw err;
      }
      log('GroupBinding:' + name + ' подключён к группе, store=' + att.storeId);
      return att;
    }

    function detach() {
      if (!current) return;
      var att = current;
      current = null;
      try {
        transport.detachStore(att.storeId);
      } catch (err) {
        log('GroupBinding:' + name + ' detach: ' + errMessage(err));
      }
      log('GroupBinding:' + name + ' отключён, store=' + att.storeId);
    }

    // ---- события транспорта (общий emitter на все store — фильтруем по своему) ----
    var offs = [];
    if (typeof transport.on === 'function') {
      offs.push(transport.on('pulled', function (e) {
        if (current && e && e.storeId === current.storeId) {
          try { onRemoteChange(e); } catch (err) { log('GroupBinding:' + name + ' onRemoteChange: ' + errMessage(err)); }
        }
      }));
      offs.push(transport.on('warning', function (e) {
        if (current && e && e.storeId === current.storeId) {
          log('GroupBinding:' + name + ' предупреждение транспорта: ' + e.kind + ' (' + (e.ids ? e.ids.length : 0) + ' зап.)');
        }
      }));
      offs.push(transport.on('error', function (e) {
        if (current && e && e.storeId === current.storeId) {
          log('GroupBinding:' + name + ' ошибка транспорта (' + e.phase + '): ' + errMessage(e.error));
        }
      }));
    }

    function save(id, data) {
      return engine.saveRecord(ensure().storeId, id, data);
    }

    function remove(id) {
      return engine.deleteRecord(ensure().storeId, id);
    }

    function syncNow() {
      return transport.syncNow(ensure().storeId);
    }

    function pushNow(pushOpts) {
      return transport.pushNow(ensure().storeId, pushOpts);
    }

    function destroy() {
      offs.forEach(function (off) { try { off(); } catch (e) { /* ignore */ } });
      offs = [];
      detach();
    }

    return {
      save: save,
      remove: remove,
      syncNow: syncNow,
      pushNow: pushNow,
      detach: detach,
      getStoreId: function () { return current ? current.storeId : null; },
      destroy: destroy,
    };
  }

  return { createGroupBinding: createGroupBinding };
});
