/* ===========================================================================
   opfs-shim.js
   Запасное хранилище файлов на IndexedDB для WebView/браузеров БЕЗ OPFS.
   Версия: 1.0 (09.10) — первая версия. Причина: на старых телефонах Android в WebView нет
   `navigator.storage.getDirectory()` (OPFS), из-за чего не работали книги, обложки и картинки заметок
   («Браузер не поддерживает OPFS»).

   Что делает: если OPFS есть — НИЧЕГО (код выходит в первой же проверке, поведение прежнее). Если OPFS нет —
   подставляет `navigator.storage.getDirectory()`, который возвращает корень «виртуальной файловой системы»
   поверх IndexedDB (база `lt_opfs_shim_v1`). Остальной код приложения (my.js, mdeditor.js) не меняется:
   он по-прежнему зовёт getDirectoryHandle / getFileHandle / createWritable / getFile / entries / removeEntry.

   Поддержано (всё, что реально использует приложение, плюс очевидные соседи):
     DirectoryHandle: kind, name, getDirectoryHandle(name,{create}), getFileHandle(name,{create}),
       removeEntry(name,{recursive}), entries()/keys()/values()/[Symbol.asyncIterator] (и for await, и ручной next()),
       remove({recursive}), isSameEntry, queryPermission/requestPermission («granted»).
     FileHandle: kind, name, getFile() → File (arrayBuffer, text, size, slice...), createWritable({keepExistingData}),
       remove(), isSameEntry, queryPermission/requestPermission.
     Writable: write(строка | ArrayBuffer | TypedArray | Blob | {type:"write"|"seek"|"truncate",...}), seek, truncate,
       close, abort. Содержимое попадает в файл только при close() (как в настоящем OPFS), abort() его отбрасывает.
     Ошибки с теми же именами, что в настоящем OPFS: NotFoundError, TypeMismatchError, InvalidModificationError.
   Не поддержано: createSyncAccessHandle (только для воркеров; приложение его не использует).

   ⚠️ Решение «прослойка или родной OPFS» принимается так: нет родного — ставится прослойка и в localStorage
   пишется флаг `ltOpfsShimActive_v1`. Пока флаг есть, прослойка остаётся включённой, даже если WebView позже
   обновят и родной OPFS появится: иначе файлы, лежащие в IndexedDB, «пропали» бы (новый OPFS пуст).
   Перенос данных между ними (если понадобится) — отдельная задача.

   Диагностика: `window.OpfsShim` ({active, hadNative, stats()}); в консоли при установке одна строка.
   База `lt_opfs_shim_v1` внесена в EXPORT_REGISTRY.indexedDB.excludeNames (my.js 57.2): её содержимое уходит
   в резервный архив как обычные файлы (images/, books/) через обход «OPFS».
   =========================================================================== */
(function(){
  "use strict";

  var STICKY_KEY = "ltOpfsShimActive_v1";
  var DB_NAME = "lt_opfs_shim_v1";
  var STORE = "nodes";

  var storage = null;
  try{ storage = navigator.storage || null; }catch(e){ storage = null; }
  var hasNative = !!(storage && typeof storage.getDirectory === "function");
  var sticky = false;
  try{ sticky = localStorage.getItem(STICKY_KEY) === "1"; }catch(e){ sticky = false; }

  if(hasNative && !sticky) return;                 // родной OPFS есть — прослойка не нужна
  if(!window.indexedDB) return;                    // нет и IndexedDB — оставляем как есть (приложение покажет прежнюю ошибку)
  if(typeof Blob !== "function" || typeof File !== "function") return;

  if(!hasNative){
    try{ localStorage.setItem(STICKY_KEY, "1"); }catch(e){}
  }

  // ---------------------------------------------------------------------
  // Вспомогательное
  // ---------------------------------------------------------------------
  function domErr(name, message){
    try{ return new DOMException(message, name); }
    catch(e){ var er = new Error(message); er.name = name; return er; }
  }

  function checkName(name){
    if(typeof name !== "string" || name === "" || name === "." || name === ".." || name.indexOf("/") >= 0){
      throw new TypeError("Некорректное имя файла или папки: " + String(name));
    }
  }

  function joinPath(parent, name){ return parent + "/" + name; }

  var MIME = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
    epub: "application/epub+zip", fb2: "application/x-fictionbook+xml",
    txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", xml: "application/xml"
  };
  // В настоящем OPFS тип File берётся из расширения имени.
  function mimeFor(name, fallback){
    var i = name.lastIndexOf(".");
    var ext = i >= 0 ? name.slice(i + 1).toLowerCase() : "";
    return MIME[ext] || fallback || "";
  }

  // ---------------------------------------------------------------------
  // IndexedDB: одно хранилище nodes, ключ — полный путь ("/images/a.png"), индекс parent — путь папки.
  // Корень — путь "" (в базе не хранится, существует всегда).
  // ---------------------------------------------------------------------
  var dbPromise = null;
  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject){
      var req;
      try{ req = indexedDB.open(DB_NAME, 1); }catch(e){ dbPromise = null; reject(e); return; }
      req.onupgradeneeded = function(){
        var db = req.result;
        var st = db.createObjectStore(STORE, { keyPath: "path" });
        st.createIndex("parent", "parent", { unique: false });
      };
      req.onsuccess = function(){
        var db = req.result;
        db.onversionchange = function(){ try{ db.close(); }catch(e){} dbPromise = null; };
        resolve(db);
      };
      req.onerror = function(){ dbPromise = null; reject(req.error || new Error("IndexedDB недоступна")); };
    });
    return dbPromise;
  }

  // work(store, done(value), fail(error)) выполняется внутри одной транзакции; промис завершается по её окончании.
  function inTx(mode, work){
    return openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx;
        try{ tx = db.transaction(STORE, mode); }
        catch(e){ dbPromise = null; reject(e); return; }
        var result;
        var failure = null;
        tx.oncomplete = function(){ if(failure) reject(failure); else resolve(result); };
        tx.onerror = function(ev){
          reject(failure || (ev && ev.target && ev.target.error) || tx.error || new Error("IndexedDB: ошибка операции"));
        };
        tx.onabort = function(){
          reject(failure || tx.error || domErr("AbortError", "Транзакция IndexedDB прервана"));
        };
        function done(value){ result = value; }
        function fail(error){ failure = error; try{ tx.abort(); }catch(e){} }
        try{ work(tx.objectStore(STORE), done, fail); }
        catch(e){ fail(e); }
      });
    });
  }

  // Папка handle должна существовать (корень — всегда), иначе NotFoundError (папку могли удалить после получения handle).
  function needDir(st, dir, fail, next){
    if(dir._p === "") { next(); return; }
    var r = st.get(dir._p);
    r.onsuccess = function(){
      var rec = r.result;
      if(rec && rec.kind === "directory") next();
      else fail(domErr("NotFoundError", "Папка не найдена: " + dir.name));
    };
  }

  function toHandle(rec){
    return rec.kind === "directory" ? new DirHandle(rec.path, rec.name) : new FileHandle(rec.path, rec.name);
  }

  function makeFile(rec){
    return new File([rec.blob], rec.name, {
      type: mimeFor(rec.name, rec.blob && rec.blob.type),
      lastModified: rec.lastModified || Date.now()
    });
  }

  // Удаление записи по пути; для папки — вместе с содержимым при recursive, иначе только пустой.
  function removePath(path, recursive){
    return inTx("readwrite", function(st, done, fail){
      var r = st.get(path);
      r.onsuccess = function(){
        var rec = r.result;
        if(!rec){ fail(domErr("NotFoundError", "Не найдено")); return; }
        if(rec.kind === "file"){ st.delete(path); done(); return; }
        if(recursive){
          // все потомки: ключи, начинающиеся с path + "/" (символ "0" идёт сразу после "/")
          st.delete(IDBKeyRange.bound(path + "/", path + "0", false, true));
          st.delete(path);
          done();
          return;
        }
        var c = st.index("parent").count(IDBKeyRange.only(path));
        c.onsuccess = function(){
          if(c.result > 0){ fail(domErr("InvalidModificationError", "Папка не пуста")); return; }
          st.delete(path);
          done();
        };
      };
    });
  }

  // ---------------------------------------------------------------------
  // Перебор (entries / keys / values) — объект с next() и Symbol.asyncIterator.
  // ---------------------------------------------------------------------
  function makeIterator(loadList, pick){
    var items = null;
    var idx = 0;
    var it = {
      next: function(){
        var ready = items ? Promise.resolve() : loadList().then(function(list){ items = list; });
        return ready.then(function(){
          if(idx >= items.length) return { done: true, value: undefined };
          return { done: false, value: pick(items[idx++]) };
        });
      }
    };
    if(typeof Symbol === "function" && Symbol.asyncIterator){
      it[Symbol.asyncIterator] = function(){ return this; };
    }
    return it;
  }

  // ---------------------------------------------------------------------
  // DirectoryHandle
  // ---------------------------------------------------------------------
  function DirHandle(path, name){
    this.kind = "directory";
    this.name = name;
    this._p = path;
  }

  DirHandle.prototype.getDirectoryHandle = function(name, options){
    var self = this;
    return Promise.resolve().then(function(){
      checkName(name);
      var create = !!(options && options.create);
      var path = joinPath(self._p, name);
      return inTx(create ? "readwrite" : "readonly", function(st, done, fail){
        needDir(st, self, fail, function(){
          var r = st.get(path);
          r.onsuccess = function(){
            var rec = r.result;
            if(rec){
              if(rec.kind !== "directory"){ fail(domErr("TypeMismatchError", "«" + name + "» — файл, а не папка")); return; }
              done(new DirHandle(path, name));
              return;
            }
            if(!create){ fail(domErr("NotFoundError", "Папка не найдена: " + name)); return; }
            st.put({ path: path, parent: self._p, name: name, kind: "directory", lastModified: Date.now() });
            done(new DirHandle(path, name));
          };
        });
      });
    });
  };

  DirHandle.prototype.getFileHandle = function(name, options){
    var self = this;
    return Promise.resolve().then(function(){
      checkName(name);
      var create = !!(options && options.create);
      var path = joinPath(self._p, name);
      return inTx(create ? "readwrite" : "readonly", function(st, done, fail){
        needDir(st, self, fail, function(){
          var r = st.get(path);
          r.onsuccess = function(){
            var rec = r.result;
            if(rec){
              if(rec.kind !== "file"){ fail(domErr("TypeMismatchError", "«" + name + "» — папка, а не файл")); return; }
              done(new FileHandle(path, name));
              return;
            }
            if(!create){ fail(domErr("NotFoundError", "Файл не найден: " + name)); return; }
            st.put({ path: path, parent: self._p, name: name, kind: "file", blob: new Blob([]), size: 0, lastModified: Date.now() });
            done(new FileHandle(path, name));
          };
        });
      });
    });
  };

  DirHandle.prototype.removeEntry = function(name, options){
    var self = this;
    return Promise.resolve().then(function(){
      checkName(name);
      return removePath(joinPath(self._p, name), !!(options && options.recursive));
    }).then(function(){});
  };

  DirHandle.prototype.remove = function(options){
    var self = this;
    return Promise.resolve().then(function(){
      if(self._p === "") throw domErr("NoModificationAllowedError", "Корень удалить нельзя");
      return removePath(self._p, !!(options && options.recursive));
    }).then(function(){});
  };

  DirHandle.prototype._list = function(){
    var self = this;
    return inTx("readonly", function(st, done, fail){
      needDir(st, self, fail, function(){
        var r = st.index("parent").getAll(IDBKeyRange.only(self._p));
        r.onsuccess = function(){
          var list = r.result || [];
          list.sort(function(a, b){ return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
          done(list);
        };
      });
    });
  };

  DirHandle.prototype.entries = function(){
    var self = this;
    return makeIterator(function(){ return self._list(); }, function(rec){ return [rec.name, toHandle(rec)]; });
  };
  DirHandle.prototype.keys = function(){
    var self = this;
    return makeIterator(function(){ return self._list(); }, function(rec){ return rec.name; });
  };
  DirHandle.prototype.values = function(){
    var self = this;
    return makeIterator(function(){ return self._list(); }, function(rec){ return toHandle(rec); });
  };
  if(typeof Symbol === "function" && Symbol.asyncIterator){
    DirHandle.prototype[Symbol.asyncIterator] = DirHandle.prototype.entries;
  }

  // ---------------------------------------------------------------------
  // FileHandle и запись
  // ---------------------------------------------------------------------
  function FileHandle(path, name){
    this.kind = "file";
    this.name = name;
    this._p = path;
  }

  FileHandle.prototype.getFile = function(){
    var self = this;
    return inTx("readonly", function(st, done, fail){
      var r = st.get(self._p);
      r.onsuccess = function(){
        var rec = r.result;
        if(!rec || rec.kind !== "file"){ fail(domErr("NotFoundError", "Файл не найден: " + self.name)); return; }
        done(makeFile(rec));
      };
    });
  };

  FileHandle.prototype.createWritable = function(options){
    var self = this;
    var keep = !!(options && options.keepExistingData);
    return inTx("readonly", function(st, done, fail){
      var r = st.get(self._p);
      r.onsuccess = function(){
        var rec = r.result;
        if(!rec || rec.kind !== "file"){ fail(domErr("NotFoundError", "Файл не найден: " + self.name)); return; }
        done(keep ? rec.blob : null);
      };
    }).then(function(base){
      return new Writable(self, base);
    });
  };

  FileHandle.prototype.remove = function(){
    var self = this;
    return removePath(self._p, false).then(function(){});
  };

  function sameEntry(a, b){
    return Promise.resolve(!!b && a.kind === b.kind && a._p === b._p);
  }
  function grant(){ return Promise.resolve("granted"); }
  DirHandle.prototype.isSameEntry = function(other){ return sameEntry(this, other); };
  FileHandle.prototype.isSameEntry = function(other){ return sameEntry(this, other); };
  DirHandle.prototype.queryPermission = grant;
  DirHandle.prototype.requestPermission = grant;
  FileHandle.prototype.queryPermission = grant;
  FileHandle.prototype.requestPermission = grant;

  function isBinary(x){
    return x instanceof ArrayBuffer || (typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(x));
  }

  // Буфер записи: части (Blob) копятся в памяти до close(); последовательная дозапись — самый частый случай.
  function Writable(handle, baseBlob){
    this._h = handle;
    this._parts = baseBlob && baseBlob.size ? [baseBlob] : [];
    this._size = baseBlob ? baseBlob.size : 0;
    this._pos = 0;
    this._closed = false;
  }

  Writable.prototype._check = function(){
    if(this._closed) throw new TypeError("Поток записи уже закрыт");
  };

  Writable.prototype._seekTo = function(position){
    if(typeof position !== "number" || !(position >= 0)) throw new TypeError("Некорректная позиция");
    this._pos = Math.floor(position);
  };

  Writable.prototype._truncateTo = function(size){
    if(typeof size !== "number" || !(size >= 0)) throw new TypeError("Некорректный размер");
    size = Math.floor(size);
    var all = new Blob(this._parts);
    if(size < all.size){
      this._parts = [all.slice(0, size)];
    } else if(size > all.size){
      this._parts = [all, new Blob([new Uint8Array(size - all.size)])];
    }
    this._size = size;
    if(this._pos > size) this._pos = size;
  };

  Writable.prototype._writeChunk = function(chunk){
    if(chunk === undefined || chunk === null) throw new TypeError("Нет данных для записи");
    var b = chunk instanceof Blob ? chunk : new Blob([chunk]);
    if(this._pos === this._size){
      if(b.size){ this._parts.push(b); }
      this._size += b.size;
      this._pos = this._size;
      return;
    }
    var all = new Blob(this._parts);
    var end = this._pos + b.size;
    var parts = [];
    if(this._pos > all.size){
      parts.push(all);
      parts.push(new Blob([new Uint8Array(this._pos - all.size)]));
    } else {
      parts.push(all.slice(0, this._pos));
    }
    parts.push(b);
    if(end < all.size) parts.push(all.slice(end));
    this._parts = parts;
    this._size = Math.max(all.size, end);
    this._pos = end;
  };

  Writable.prototype.write = function(data){
    var self = this;
    return Promise.resolve().then(function(){
      self._check();
      var chunk = data;
      if(data && typeof data === "object" && !(data instanceof Blob) && !isBinary(data) && "type" in data){
        if(data.type === "seek"){ self._seekTo(data.position); return; }
        if(data.type === "truncate"){ self._truncateTo(data.size); return; }
        if(data.type !== "write") throw new TypeError("Неизвестный тип записи: " + String(data.type));
        if(typeof data.position === "number") self._seekTo(data.position);
        chunk = data.data;
      }
      self._writeChunk(chunk);
    });
  };

  Writable.prototype.seek = function(position){
    var self = this;
    return Promise.resolve().then(function(){ self._check(); self._seekTo(position); });
  };

  Writable.prototype.truncate = function(size){
    var self = this;
    return Promise.resolve().then(function(){ self._check(); self._truncateTo(size); });
  };

  // Содержимое попадает в файл только здесь (как в настоящем OPFS).
  Writable.prototype.close = function(){
    var self = this;
    return Promise.resolve().then(function(){
      self._check();
      self._closed = true;
      var blob = new Blob(self._parts);
      self._parts = [];
      return inTx("readwrite", function(st, done, fail){
        var r = st.get(self._h._p);
        r.onsuccess = function(){
          var rec = r.result;
          if(!rec || rec.kind !== "file"){ fail(domErr("NotFoundError", "Файл удалён до завершения записи")); return; }
          rec.blob = blob;
          rec.size = blob.size;
          rec.lastModified = Date.now();
          st.put(rec);
          done();
        };
      });
    }).then(function(){});
  };

  Writable.prototype.abort = function(){
    this._closed = true;
    this._parts = [];
    return Promise.resolve();
  };

  // ---------------------------------------------------------------------
  // Подключение к navigator.storage
  // ---------------------------------------------------------------------
  function getDirectory(){
    return openDb().then(function(){ return new DirHandle("", ""); });
  }

  try{
    if(storage){
      // defineProperty на самом объекте работает, даже если на прототипе свойство есть, но только для чтения
      try{ Object.defineProperty(storage, "getDirectory", { value: getDirectory, configurable: true, writable: true, enumerable: true }); }
      catch(e){ storage.getDirectory = getDirectory; }
      if(typeof storage.getDirectory !== "function" || storage.getDirectory !== getDirectory) return;
    } else {
      var stub = {
        getDirectory: getDirectory,
        persist: function(){ return Promise.resolve(false); },
        persisted: function(){ return Promise.resolve(false); },
        estimate: function(){ return Promise.resolve({ usage: 0, quota: 0 }); }
      };
      Object.defineProperty(navigator, "storage", { value: stub, configurable: true });
    }
  }catch(e){
    return; // подставить не удалось — всё остаётся как было
  }

  window.OpfsShim = {
    active: true,
    hadNative: hasNative,
    version: "1.0",
    dbName: DB_NAME,
    // Сколько файлов и байт лежит в прослойке (для диагностики).
    stats: function(){
      return inTx("readonly", function(st, done){
        var files = 0, bytes = 0;
        var cur = st.openCursor();
        cur.onsuccess = function(){
          var c = cur.result;
          if(!c){ done({ files: files, bytes: bytes }); return; }
          if(c.value.kind === "file"){ files++; bytes += c.value.size || 0; }
          c.continue();
        };
      });
    }
  };
  try{ console.log("opfs-shim: родного OPFS нет, файлы хранятся в IndexedDB (" + DB_NAME + ")"); }catch(e){}
})();
