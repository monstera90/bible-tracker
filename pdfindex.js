/* ===========================================================================
   pdfindex.js
   Версия: 1.0 (31.10)
   Индекс текста PDF-файлов для режима «PDF» во вкладке «Поиск» (search.js).

   Что делает:
     1. Папка с PDF. В APK — системное окно выбора папки (мост LifeTrackerNative версии 19:
        pdfGetFolder / pdfPickFolder / pdfListAll; сами файлы читаются по https://localhost/__pdflib/<docId>).
        В обычном браузере с showDirectoryPicker (десктопный Chrome/Edge) — дескриптор папки, сохранённый в IndexedDB.
        Без того и другого режим PDF недоступен (`reason()` объясняет почему).
     2. Разбор. PdfParse.extractPages → PdfParse.pagesToParagraphs → одна строка текста файла (абзацы через «\n»)
        и карта страниц `po` = [номер страницы (с 1), смещение первого абзаца, …].
     3. Хранение. IndexedDB `lt_pdf_index_v1`: `meta` (имя, путь, размер, дата, число страниц, ошибка — маленькие записи),
        `text` (id, text, po — тяжёлые), `kv` (дескриптор папки браузера). Только на устройстве: в облако и экспорт
        не входит. Поиск читает тексты по одному курсором, целиком в память они не загружаются.
     4. `sync` сверяет папку с индексом: новые и изменённые (размер/дата) файлы разбираются, пропавшие удаляются.
        Файл без текстового слоя или нечитаемый получает запись `err` и больше не разбирается, пока не изменится.

   Экспорт window.PdfIndex:
     reason() -> "" | текст причины, почему режим PDF недоступен
     getFolder() -> Promise<{set, name}>
     pickFolder() -> Promise<boolean>
     loadMeta() -> Promise<meta[]>      (по имени; также обновляет `metaCache()`)
     metaCache() -> meta[]              (последнее загруженное, синхронно)
     pending() -> Promise<{ok, needAccess, add, changed, remove}>   — сколько файлов ждут разбора (без разбора)
     sync({onProgress}) -> Promise<{added, removed, failed:[{name, msg}], total}>
     isSyncing() -> boolean
     eachText(cb) -> Promise            — cb({id, text, po}); вернуть false — остановить
     pageOf(rec, offset) -> номер страницы (с 1) по смещению в тексте
   Без fetch, async/await и let/const — работает в WebView Android 5.
   =========================================================================== */
(function(global){
  "use strict";

  var DB_NAME = "lt_pdf_index_v1";
  var MAX_BYTES = 100 * 1024 * 1024;

  // ------------------------------------------------------------------ IndexedDB
  var dbPromise = null;
  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject){
      var req;
      try{ req = indexedDB.open(DB_NAME, 1); }catch(e){ reject(e); return; }
      req.onupgradeneeded = function(){
        var db = req.result;
        if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
        if(!db.objectStoreNames.contains("text")) db.createObjectStore("text", { keyPath: "id" });
        if(!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ dbPromise = null; reject(req.error || new Error("IndexedDB недоступна")); };
    });
    return dbPromise;
  }
  function reqP(req){
    return new Promise(function(resolve, reject){
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function txDone(tx){
    return new Promise(function(resolve, reject){
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
      tx.onabort = function(){ reject(tx.error || new Error("Запись в IndexedDB прервана")); };
    });
  }
  function kvGet(k){
    return openDb().then(function(db){
      return reqP(db.transaction("kv", "readonly").objectStore("kv").get(k));
    }).then(function(r){ return r ? r.v : null; });
  }
  function kvSet(k, v){
    return openDb().then(function(db){
      var tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ k: k, v: v });
      return txDone(tx);
    });
  }

  // ------------------------------------------------------------------ бэкенды папки
  function nb(){
    var b = global.LifeTrackerNative;
    return (b && typeof b.pdfListAll === "function") ? b : null;
  }
  function hasFs(){ return typeof global.showDirectoryPicker === "function"; }

  function reason(){
    if(nb() || hasFs()) return "";
    if(global.LifeTrackerNative) return "Для поиска по PDF нужна новая версия приложения (пересборка APK).";
    return "Выбор папки с PDF работает в приложении для Android (APK) и в браузерах с доступом к папкам (Chrome/Edge на компьютере).";
  }

  function parseJson(s, fallback){
    try{ return JSON.parse(s || ""); }catch(e){ return fallback; }
  }

  // --- браузер (File System Access)
  var fsHandle = null;
  function fsLoadHandle(){
    if(fsHandle) return Promise.resolve(fsHandle);
    return kvGet("dirHandle").then(function(h){ fsHandle = h || null; return fsHandle; });
  }
  function fsPermission(handle, ask){
    if(!handle || !handle.queryPermission) return Promise.resolve(true);
    return handle.queryPermission({ mode: "read" }).then(function(st){
      if(st === "granted") return true;
      if(!ask || !handle.requestPermission) return false;
      return handle.requestPermission({ mode: "read" }).then(function(st2){ return st2 === "granted"; });
    });
  }
  function fsWalk(dir, prefix, depth, out, files){
    var it = dir.values();
    function next(){
      return it.next().then(function(r){
        if(r.done) return null;
        var e = r.value;
        if(!e || !e.name || e.name.charAt(0) === ".") return next();
        if(e.kind === "directory"){
          if(depth >= 8) return next();
          return fsWalk(e, prefix + e.name + "/", depth + 1, out, files).then(next, next);
        }
        if(/\.pdf$/i.test(e.name) && out.length < 5000){
          return e.getFile().then(function(f){
            var path = prefix + e.name;
            out.push({ id: path, name: e.name, path: path, size: f.size, mtime: f.lastModified || 0 });
            files[path] = f;
          }).then(next, next);
        }
        return next();
      });
    }
    return next();
  }

  // --- общий интерфейс
  function getFolder(){
    var b = nb();
    if(b){
      var info = parseJson(b.pdfGetFolder(), {});
      return Promise.resolve({ set: !!info.set, name: info.name || "" });
    }
    if(hasFs()){
      return fsLoadHandle().then(function(h){ return { set: !!h, name: h ? h.name : "" }; });
    }
    return Promise.resolve({ set: false, name: "" });
  }

  var pickResolver = null;
  global.__ltOnPdfFolder = function(ok){
    var r = pickResolver;
    pickResolver = null;
    if(r) r(!!ok);
  };

  // Вызывать прямо из обработчика нажатия (для браузера окно выбора требует жеста пользователя).
  function pickFolder(){
    var b = nb();
    if(b){
      return new Promise(function(resolve){
        pickResolver = resolve;
        var started = false;
        try{ started = b.pdfPickFolder(); }catch(e){}
        if(!started){ pickResolver = null; resolve(false); }
      });
    }
    if(hasFs()){
      return global.showDirectoryPicker({ mode: "read" }).then(function(h){
        fsHandle = h;
        return kvSet("dirHandle", h).then(function(){ return true; });
      }, function(){ return false; });
    }
    return Promise.resolve(false);
  }

  // Список PDF папки: {ok, needAccess, items, files} — files только у браузерного бэкенда (File по id).
  function scanFolder(askAccess){
    var b = nb();
    if(b){
      var res = parseJson(b.pdfListAll(), { ok: false });
      return Promise.resolve({ ok: !!res.ok, items: res.items || [], files: null });
    }
    if(hasFs()){
      return fsLoadHandle().then(function(h){
        if(!h) return { ok: false, items: [], files: null };
        return fsPermission(h, askAccess).then(function(granted){
          if(!granted) return { ok: false, needAccess: true, items: [], files: null };
          var out = [], files = {};
          return fsWalk(h, "", 0, out, files).then(function(){ return { ok: true, items: out, files: files }; });
        });
      });
    }
    return Promise.resolve({ ok: false, items: [], files: null });
  }

  function encodeId(id){
    return encodeURIComponent(id).replace(/%2F/g, "/").replace(/%3A/gi, ":");
  }

  // Содержимое файла как ArrayBuffer.
  function readBuffer(item, files){
    if(files){
      var f = files[item.id];
      if(!f) return Promise.reject(new Error("Файл недоступен."));
      return new Promise(function(resolve, reject){
        var fr = new FileReader();
        fr.onload = function(){ resolve(fr.result); };
        fr.onerror = function(){ reject(new Error("Не удалось прочитать файл.")); };
        fr.readAsArrayBuffer(f);
      });
    }
    return new Promise(function(resolve, reject){
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/__pdflib/" + encodeId(item.id), true);
      xhr.responseType = "arraybuffer";
      xhr.onload = function(){
        if(xhr.status === 200 && xhr.response) resolve(xhr.response);
        else reject(new Error("Файл недоступен (возможно, снято право на папку)."));
      };
      xhr.onerror = function(){ reject(new Error("Не удалось прочитать файл.")); };
      xhr.send();
    });
  }

  // ------------------------------------------------------------------ индекс
  var cache = [];
  function byName(a, b){
    var x = (a.path || a.name || "").toLowerCase(), y = (b.path || b.name || "").toLowerCase();
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  function loadMeta(){
    return openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var out = [];
        var req = db.transaction("meta", "readonly").objectStore("meta").openCursor();
        req.onsuccess = function(){
          var c = req.result;
          if(c){ out.push(c.value); c.continue(); }
          else resolve(out);
        };
        req.onerror = function(){ reject(req.error); };
      });
    }).then(function(list){
      list.sort(byName);
      cache = list;
      return list;
    });
  }

  function diff(items, meta){
    var byId = {}, seen = {};
    meta.forEach(function(m){ byId[m.id] = m; });
    var add = [], changed = [], remove = [];
    items.forEach(function(it){
      seen[it.id] = true;
      var m = byId[it.id];
      if(!m) add.push(it);
      else if(m.size !== it.size || m.mtime !== it.mtime) changed.push(it);
    });
    meta.forEach(function(m){ if(!seen[m.id]) remove.push(m); });
    return { add: add, changed: changed, remove: remove };
  }

  function pending(){
    return Promise.all([scanFolder(false), loadMeta()]).then(function(r){
      var scan = r[0];
      if(!scan.ok) return { ok: false, needAccess: !!scan.needAccess, add: 0, changed: 0, remove: 0 };
      var d = diff(scan.items, r[1]);
      return { ok: true, needAccess: false, add: d.add.length, changed: d.changed.length, remove: d.remove.length };
    });
  }

  function buildText(pages){
    var paras = global.PdfParse.pagesToParagraphs(pages);
    var parts = [], po = [], pos = 0, lastPage = -1;
    paras.forEach(function(p){
      if(p.page !== lastPage){ po.push(p.page + 1, pos); lastPage = p.page; }
      parts.push(p.text);
      pos += p.text.length + 1;
    });
    return { text: parts.join("\n"), po: po };
  }

  function putMeta(m){
    return openDb().then(function(db){
      var tx = db.transaction(["meta", "text"], "readwrite");
      tx.objectStore("meta").put(m);
      if(!m.hasText) tx.objectStore("text").delete(m.id);
      return txDone(tx);
    });
  }
  function putMetaAndText(m, text, po){
    return openDb().then(function(db){
      var tx = db.transaction(["meta", "text"], "readwrite");
      tx.objectStore("meta").put(m);
      tx.objectStore("text").put({ id: m.id, text: text, po: po });
      return txDone(tx);
    });
  }
  function removeIds(ids){
    if(!ids.length) return Promise.resolve();
    return openDb().then(function(db){
      var tx = db.transaction(["meta", "text"], "readwrite");
      ids.forEach(function(id){ tx.objectStore("meta").delete(id); tx.objectStore("text").delete(id); });
      return txDone(tx);
    });
  }

  function indexOne(item, files, onPage){
    var base = { id: item.id, name: item.name, path: item.path || item.name, size: item.size, mtime: item.mtime, pages: 0, chars: 0, err: "", hasText: false };
    if(item.size > MAX_BYTES){
      base.err = "файл больше 100 МБ — пропущен";
      return putMeta(base).then(function(){ return base; });
    }
    return readBuffer(item, files).then(function(buf){
      return global.PdfParse.extractPages(buf, { onProgress: onPage });
    }).then(function(r){
      var built = buildText(r.pages);
      base.pages = r.pageCount;
      if(!built.text.replace(/\s+/g, "").length){
        base.err = (r.stats && r.stats.unmapped > 0 && r.stats.mapped === 0)
          ? "нестандартные шрифты без таблицы символов — текст не извлечь"
          : "нет текстового слоя (скан или набор картинок)";
        return putMeta(base).then(function(){ return base; });
      }
      base.chars = built.text.length;
      base.hasText = true;
      return putMetaAndText(base, built.text, built.po).then(function(){ return base; });
    }, function(e){
      base.err = (e && e.message) ? e.message : "не удалось разобрать";
      return putMeta(base).then(function(){ return base; });
    });
  }

  var running = null;
  function isSyncing(){ return !!running; }

  // Сверка папки с индексом. onProgress({phase, index, total, name, page, pages}).
  function sync(opts){
    if(running) return running;
    opts = opts || {};
    function progress(o){ if(opts.onProgress){ try{ opts.onProgress(o); }catch(e){} } }
    if(!global.PdfParse){
      return Promise.reject(new Error("Модуль разбора PDF (pdfparse.js) не загружен."));
    }
    running = scanFolder(true).then(function(scan){
      if(!scan.ok){
        throw new Error(scan.needAccess ? "Нет доступа к папке — разрешите его в окне браузера." : "Папка недоступна — выберите её заново.");
      }
      return loadMeta().then(function(meta){
        var d = diff(scan.items, meta);
        var todo = d.add.concat(d.changed);
        var failed = [];
        var done = 0;
        return removeIds(d.remove.map(function(m){ return m.id; })).then(function(){
          function next(){
            if(done >= todo.length) return null;
            var item = todo[done];
            progress({ phase: "parse", index: done + 1, total: todo.length, name: item.name, page: 0, pages: 0 });
            return indexOne(item, scan.files, function(p, total){
              progress({ phase: "parse", index: done + 1, total: todo.length, name: item.name, page: p, pages: total });
            }).then(function(m){
              if(m.err) failed.push({ name: m.path, msg: m.err });
              done++;
              return new Promise(function(r){ setTimeout(r, 0); }).then(next);
            });
          }
          return Promise.resolve(next());
        }).then(function(){
          return loadMeta();
        }).then(function(all){
          // ошибки прошлых разборов (файл не менялся) тоже показываются в итоге
          var seen = {};
          failed.forEach(function(f){ seen[f.name] = true; });
          all.forEach(function(m){ if(m.err && !seen[m.path]) failed.push({ name: m.path, msg: m.err }); });
          return { added: todo.length, removed: d.remove.length, failed: failed, total: all.length };
        });
      });
    }).then(function(r){ running = null; return r; }, function(e){ running = null; throw e; });
    return running;
  }

  // Перебор текстов по одному (курсор). cb({id, text, po}); false — прервать.
  function eachText(cb){
    return openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var req = db.transaction("text", "readonly").objectStore("text").openCursor();
        req.onsuccess = function(){
          var c = req.result;
          if(!c){ resolve(); return; }
          var keep = true;
          try{ keep = cb(c.value) !== false; }catch(e){ reject(e); return; }
          if(keep) c.continue(); else resolve();
        };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }

  // Номер страницы (с 1) по смещению в тексте файла.
  function pageOf(rec, offset){
    var po = rec && rec.po ? rec.po : [];
    var page = po.length ? po[0] : 1;
    for(var i = 0; i + 1 < po.length; i += 2){
      if(po[i + 1] <= offset) page = po[i]; else break;
    }
    return page;
  }

  global.PdfIndex = {
    reason: reason,
    getFolder: getFolder,
    pickFolder: pickFolder,
    loadMeta: loadMeta,
    metaCache: function(){ return cache; },
    pending: pending,
    sync: sync,
    isSyncing: isSyncing,
    eachText: eachText,
    pageOf: pageOf
  };
})(typeof window !== "undefined" ? window : globalThis);
