/* ===========================================================================
   jwlmerge.js
   Вкладка "Объединение заметок" (settingsTabSet2GearBtn3 / "set2b_3").
   Полностью в браузере (без сервера) объединяет два экспортированных из
   JW Library файла .jwlibrary в один — переносит логику из отдельного
   Python-скрипта (jwl_merge.py), уже проверенного на реальных файлах.

   Технические решения (см. также пояснения в коде ниже):
   - SQLite читаем/пишем через sql.js (WebAssembly-сборка SQLite) —
     подгружается лениво, только при первом открытии вкладки, по тому же
     принципу, что loadQrLib/loadJsqrLib в my.js.
   - ZIP: свой читатель (STORED и DEFLATE) и писатель (со сжатием DEFLATE
     через CompressionStream, с откатом на STORED, если API недоступно) —
     отдельно от buildZipBlob в my.js, чтобы не трогать существующий код.
   - "Снимок по устройствам" для защиты от повторного появления удалённых
     заметок хранится в localStorage (браузерный аналог отдельного
     jwl_merge_state.json рядом со скриптом в Python-версии).
   =========================================================================== */

window.initJwlMergeModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml;
  var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG;
  var switchSettingsTab = deps.switchSettingsTab;

  // ===================== СХЕМА JWLIBRARY (см. jwl_merge.py) =====================

  var TABLE_ORDER = [
    "Location", "IndependentMedia", "PlaylistItemAccuracy", "Tag", "PlaylistItem",
    "UserMark", "BlockRange", "Note", "Bookmark", "TagMap", "InputField",
    "PlaylistItemIndependentMediaMap", "PlaylistItemLocationMap", "PlaylistItemMarker",
    "PlaylistItemMarkerBibleVerseMap", "PlaylistItemMarkerParagraphMap"
  ];

  var UNTOUCHED_TABLES = {"LastModified":1, "android_metadata":1, "grdb_migrations":1};

  var IDENTITY_KEYS = {
    "Location": ["BookNumber","ChapterNumber","DocumentId","Track","IssueTagNumber","KeySymbol","MepsLanguage","Type"],
    "IndependentMedia": ["FilePath"],
    "PlaylistItemAccuracy": ["Description"],
    "Tag": ["Type","Name"],
    "PlaylistItem": ["Label","ThumbnailFilePath"],
    "UserMark": ["UserMarkGuid"],
    "BlockRange": ["UserMarkId","BlockType","Identifier","StartToken","EndToken"],
    "Note": ["Guid"],
    "Bookmark": ["PublicationLocationId","Slot"],
    "TagMap": ["TagId","PlaylistItemId","LocationId","NoteId"],
    "InputField": ["LocationId","TextTag"],
    "PlaylistItemIndependentMediaMap": ["PlaylistItemId","IndependentMediaId"],
    "PlaylistItemLocationMap": ["PlaylistItemId","LocationId"],
    "PlaylistItemMarker": ["PlaylistItemId","StartTimeTicks"],
    "PlaylistItemMarkerBibleVerseMap": ["PlaylistItemMarkerId","VerseId"],
    "PlaylistItemMarkerParagraphMap": ["PlaylistItemMarkerId","MepsDocumentId","ParagraphIndex","MarkerIndexWithinParagraph"]
  };

  // Таблицы, для которых отслеживаем удаления между запусками (снимок по устройствам).
  var BASELINE_TABLES = ["Note","UserMark","Tag","PlaylistItem","Bookmark"];
  var STATE_STORAGE_KEY = "jwlMergeState_v1";

  var NON_MEDIA_FILES = {"manifest.json":1, "userData.db":1, "userData.db-journal":1,
                          "userData.db-wal":1, "userData.db-shm":1};

  // ===================== CRC32 (для ZIP) =====================

  var crc32Table = null;
  function crc32(bytes){
    if(!crc32Table){
      crc32Table = new Uint32Array(256);
      for(var n = 0; n < 256; n++){
        var c = n;
        for(var k = 0; k < 8; k++){ c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
        crc32Table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for(var i = 0; i < bytes.length; i++){
      crc = crc32Table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ===================== ЧТЕНИЕ ZIP (.jwlibrary) =====================
  // Общего вида читатель (в отличие от extractDataJsonFromZip в my.js,
  // который ищет конкретно data.json) — читает центральный каталог и
  // возвращает содержимое ЛЮБОЙ записи по имени, поддерживает и STORED
  // (метод 0), и DEFLATE (метод 8, через DecompressionStream).

  function readZipCentralDirectory(bytes){
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocdOffset = -1;
    var scanFrom = Math.max(0, bytes.length - 65557);
    for(var i = bytes.length - 22; i >= scanFrom; i--){
      if(view.getUint32(i, true) === 0x06054b50){ eocdOffset = i; break; }
    }
    if(eocdOffset === -1) throw new Error("not_a_zip");
    var entryCount = view.getUint16(eocdOffset + 10, true);
    var centralOffset = view.getUint32(eocdOffset + 16, true);
    var decoder = new TextDecoder();
    var entries = [];
    var pos = centralOffset;
    for(var e = 0; e < entryCount; e++){
      if(view.getUint32(pos, true) !== 0x02014b50) break;
      var method = view.getUint16(pos + 10, true);
      var compSize = view.getUint32(pos + 20, true);
      var uncompSize = view.getUint32(pos + 24, true);
      var nameLen = view.getUint16(pos + 28, true);
      var extraLen = view.getUint16(pos + 30, true);
      var commentLen = view.getUint16(pos + 32, true);
      var localOffset = view.getUint32(pos + 42, true);
      var name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.push({name:name, method:method, compSize:compSize, uncompSize:uncompSize, localOffset:localOffset});
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function readZipEntryBytes(bytes, view, entry){
    var lNameLen = view.getUint16(entry.localOffset + 26, true);
    var lExtraLen = view.getUint16(entry.localOffset + 28, true);
    var dataStart = entry.localOffset + 30 + lNameLen + lExtraLen;
    var compBytes = bytes.subarray(dataStart, dataStart + entry.compSize);
    if(entry.method === 0){
      return Promise.resolve(compBytes);
    }
    if(entry.method === 8 && typeof DecompressionStream !== "undefined"){
      var stream = new Response(compBytes).body.pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).arrayBuffer().then(function(buf){ return new Uint8Array(buf); });
    }
    return Promise.reject(new Error("unsupported_zip_method_" + entry.method));
  }

  // Возвращает Promise<{name: Uint8Array, ...}> — все файлы архива по именам.
  function readAllZipEntries(arrayBuffer){
    var bytes = new Uint8Array(arrayBuffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var entries = readZipCentralDirectory(bytes);
    var result = {};
    return entries.reduce(function(chain, entry){
      return chain.then(function(){
        return readZipEntryBytes(bytes, view, entry).then(function(data){
          result[entry.name] = data;
        });
      });
    }, Promise.resolve()).then(function(){ return result; });
  }

  // ===================== ЗАПИСЬ ZIP (для итогового .jwlibrary) =====================
  // manifest.json пишем без сжатия (STORED, он крошечный), userData.db —
  // со сжатием DEFLATE через CompressionStream (это, судя по независимому
  // разбору формата, ожидается настоящим JW Library); если API недоступно
  // в этом браузере — откатываемся на STORED и для базы (файл будет
  // крупнее, но по структуре всё равно корректный ZIP).

  function deflateRawIfPossible(bytes){
    if(typeof CompressionStream === "undefined") return Promise.resolve({method:0, data:bytes});
    var stream = new Response(bytes).body.pipeThrough(new CompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function(buf){
      return {method:8, data:new Uint8Array(buf)};
    });
  }

  function buildZipLocalAndCentral(name, uncompBytes, compResult, offset){
    var encoder = new TextEncoder();
    var nameBytes = encoder.encode(name);
    var crc = crc32(uncompBytes);
    var compSize = compResult.data.length;
    var uncompSize = uncompBytes.length;
    var method = compResult.method;
    var dosDate = 0x21, dosTime = 0;

    var lh = new Uint8Array(30 + nameBytes.length);
    var ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0, true);
    ldv.setUint16(8, method, true);
    ldv.setUint16(10, dosTime, true);
    ldv.setUint16(12, dosDate, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, compSize, true);
    ldv.setUint32(22, uncompSize, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    var ch = new Uint8Array(46 + nameBytes.length);
    var cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, method, true);
    cdv.setUint16(12, dosTime, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, compSize, true);
    cdv.setUint32(24, uncompSize, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    return {local:[lh, compResult.data], central:ch, size: lh.length + compResult.data.length};
  }

  // files: [{name, data: Uint8Array}]. Возвращает Promise<Blob>.
  function buildJwlibraryZip(files){
    return files.reduce(function(chain, f){
      return chain.then(function(acc){
        return deflateRawIfPossible(f.data).then(function(compResult){
          acc.push({name:f.name, uncompBytes:f.data, compResult:compResult});
          return acc;
        });
      });
    }, Promise.resolve([])).then(function(prepared){
      var localParts = [], centralParts = [], offset = 0;
      prepared.forEach(function(p){
        var built = buildZipLocalAndCentral(p.name, p.uncompBytes, p.compResult, offset);
        localParts = localParts.concat(built.local);
        centralParts.push(built.central);
        offset += built.size;
      });
      var centralSize = centralParts.reduce(function(a,p){ return a + p.length; }, 0);
      var eocd = new Uint8Array(22);
      var edv = new DataView(eocd.buffer);
      edv.setUint32(0, 0x06054b50, true);
      edv.setUint16(4, 0, true);
      edv.setUint16(6, 0, true);
      edv.setUint16(8, prepared.length, true);
      edv.setUint16(10, prepared.length, true);
      edv.setUint32(12, centralSize, true);
      edv.setUint32(16, offset, true);
      edv.setUint16(20, 0, true);
      return new Blob(localParts.concat(centralParts, [eocd]), {type:"application/octet-stream"});
    });
  }

  // ===================== SHA-256 (для manifest.json) =====================

  function sha256Hex(bytes){
    return crypto.subtle.digest("SHA-256", bytes).then(function(hashBuf){
      var hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");
    });
  }

  // ===================== ЛЕНИВАЯ ЗАГРУЗКА sql.js =====================
  // По тому же принципу, что loadQrLib/loadJsqrLib в my.js — подгружаем
  // тяжёлую WASM-библиотеку только при первом реальном использовании
  // вкладки, а не при каждом запуске приложения.

  var SQLJS_CDN_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
  var sqlJsPromise = null;
  function loadSqlJs(){
    if(sqlJsPromise) return sqlJsPromise;
    sqlJsPromise = new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = SQLJS_CDN_BASE + "sql-wasm.js";
      s.onload = function(){
        window.initSqlJs({locateFile: function(file){ return SQLJS_CDN_BASE + file; }})
          .then(resolve, reject);
      };
      s.onerror = function(){ reject(new Error("sqljs_load_failed")); };
      document.head.appendChild(s);
    });
    return sqlJsPromise;
  }

  // ===================== РАЗБОР ОДНОГО .jwlibrary ФАЙЛА =====================

  function parseBackup(file){
    return file.arrayBuffer().then(function(buf){
      return readAllZipEntries(buf);
    }).then(function(entries){
      var manifestBytes = entries["manifest.json"];
      var dbBytes = entries["userData.db"];
      if(!manifestBytes || !dbBytes){
        throw new Error("not_a_valid_jwlibrary");
      }
      var manifest = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes));
      var udb = manifest.userDataBackup || {};
      var mediaFiles = [];
      Object.keys(entries).forEach(function(name){
        if(!NON_MEDIA_FILES[name]) mediaFiles.push({name:name, data:entries[name]});
      });
      return sha256Hex(dbBytes).then(function(actualHash){
        if(udb.hash && actualHash.toLowerCase() !== String(udb.hash).toLowerCase()){
          console.warn("jwlmerge: хеш базы в " + file.name + " не совпадает с manifest.json — " +
                       "файл мог быть повреждён при передаче.");
        }
        return {
          sourceName: file.name,
          dbBytes: dbBytes,
          manifest: manifest,
          schemaVersion: udb.schemaVersion,
          lastModified: udb.lastModifiedDate || "",
          deviceName: udb.deviceName || file.name,
          mediaFiles: mediaFiles
        };
      });
    });
  }

  // ===================== ИНТРОСПЕКЦИЯ СХЕМЫ (PK/FK) =====================
  // Аналог класса SchemaInfo в jwl_merge.py — ничего не хардкодим под
  // конкретную версию схемы, всё берём через PRAGMA.

  function queryObjects(db, sql){
    var stmt = db.prepare(sql);
    var rows = [];
    while(stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryObjectsParams(db, sql, params){
    var stmt = db.prepare(sql);
    stmt.bind(params);
    var rows = [];
    while(stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function buildSchemaInfo(db){
    var tables = {};
    queryObjects(db, "SELECT name FROM sqlite_master WHERE type='table'").forEach(function(r){
      tables[r.name] = true;
    });

    var primaryKeys = {}, pkIsInteger = {}, fkMap = {};
    Object.keys(tables).forEach(function(table){
      var cols = queryObjects(db, "PRAGMA table_info('" + table + "')");
      var pkCols = cols.filter(function(c){ return c.pk > 0; })
                        .sort(function(a,b){ return a.pk - b.pk; });
      primaryKeys[table] = pkCols.map(function(c){ return c.name; });
      pkIsInteger[table] = (pkCols.length === 1 && String(pkCols[0].type).toUpperCase() === "INTEGER");

      var fks = queryObjects(db, "PRAGMA foreign_key_list('" + table + "')");
      if(fks.length){
        fkMap[table] = {};
        fks.forEach(function(fk){
          fkMap[table][fk.from] = {refTable: fk.table, refCol: fk.to};
        });
      }
    });

    return {
      tables: tables,
      primaryKeys: primaryKeys,
      isAutoincrement: function(table){ return !!pkIsInteger[table]; },
      fkMap: fkMap
    };
  }

  // ===================== СНИМОК ПО УСТРОЙСТВАМ (localStorage) =====================
  // Аналог jwl_merge_state.json в Python-версии — но в браузере файловой
  // системы нет, поэтому естественный аналог "рядом со скриптом" — это
  // localStorage (данные привязаны к этому устройству/браузеру же).

  function keyStr(tuple){ return JSON.stringify(tuple); }

  function bookmarkNaturalKeys(db){
    // getAsObject не различает колонки с одинаковым именем из разных таблиц,
    // поэтому явно даём алиасы каждой колонке Location, чтобы не перепутать их.
    var aliasCols = IDENTITY_KEYS["Location"].map(function(c, i){ return "l.[" + c + "] as loc_" + i; }).join(", ");
    var rows = queryObjects(db, "SELECT b.BookmarkId as _bid, " + aliasCols + ", b.Slot as _slot" +
      " FROM Bookmark b JOIN Location l ON b.PublicationLocationId = l.LocationId");
    var result = {};
    rows.forEach(function(r){
      var natural = IDENTITY_KEYS["Location"].map(function(c, i){ return r["loc_" + i]; });
      natural.push(r._slot);
      result[r._bid] = natural;
    });
    return result;
  }

  function readTrackedIdentities(db){
    var result = {};
    BASELINE_TABLES.forEach(function(table){
      if(table === "Bookmark"){
        var bm = bookmarkNaturalKeys(db);
        result[table] = {};
        Object.keys(bm).forEach(function(bid){ result[table][keyStr(bm[bid])] = true; });
      } else {
        var cols = IDENTITY_KEYS[table];
        var aliasCols = cols.map(function(c, i){ return "[" + c + "] as c" + i; }).join(", ");
        var rows = queryObjects(db, "SELECT " + aliasCols + " FROM [" + table + "]");
        var set = {};
        rows.forEach(function(r){
          var tuple = cols.map(function(c, i){ return r["c" + i]; });
          set[keyStr(tuple)] = true;
        });
        result[table] = set;
      }
    });
    return result;
  }

  function loadDeviceState(){
    try{
      var raw = localStorage.getItem(STATE_STORAGE_KEY);
      if(!raw) return null;
      var data = JSON.parse(raw);
      return data.devices || {};
    }catch(e){
      console.warn("jwlmerge: не удалось прочитать снимок по устройствам, начну заново.", e);
      return null;
    }
  }

  function saveDeviceState(perDeviceIdentities){
    var payload = {
      version: 2,
      lastMerge: new Date().toISOString(),
      devices: perDeviceIdentities
    };
    try{
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(payload));
    }catch(e){
      console.warn("jwlmerge: не удалось сохранить снимок по устройствам.", e);
    }
  }

  // Возвращает {deletedSet, perSourceIdentities, hadState}.
  // deletedSet: {table: {keyStr: true}}; perSourceIdentities: {deviceName: {table:{keyStr:true}}}
  function computeDeletedSet(backups, dbs){
    var previous = loadDeviceState();
    var perSourceIdentities = {};
    backups.forEach(function(backup, i){
      perSourceIdentities[backup.deviceName] = readTrackedIdentities(dbs[i]);
    });

    var deletedSet = {};
    BASELINE_TABLES.forEach(function(t){ deletedSet[t] = {}; });

    if(previous === null){
      return {deletedSet: deletedSet, perSourceIdentities: perSourceIdentities, hadState: false};
    }

    Object.keys(perSourceIdentities).forEach(function(deviceName){
      var prevTables = previous[deviceName];
      if(!prevTables) return; // новое устройство — сравнивать не с чем
      var currentTables = perSourceIdentities[deviceName];
      BASELINE_TABLES.forEach(function(table){
        var prevSet = prevTables[table] || {};
        var curSet = currentTables[table] || {};
        Object.keys(prevSet).forEach(function(k){
          if(!curSet[k]) deletedSet[table][k] = true;
        });
      });
    });

    return {deletedSet: deletedSet, perSourceIdentities: perSourceIdentities, hadState: true};
  }

  // ===================== ПАРСИНГ ДАТЫ =====================

  function parseTs(raw){
    if(!raw) return -8640000000000000; // аналог datetime.min
    var txt = String(raw).trim();
    var ms = Date.parse(txt);
    return isNaN(ms) ? -8640000000000000 : ms;
  }

  // ===================== ЯДРО СЛИЯНИЯ (аналог класса Merger в jwl_merge.py) =====================

  function runAndGetLastId(db, sql, params){
    db.run(sql, params || []);
    var res = db.exec("SELECT last_insert_rowid()");
    return res.length ? res[0].values[0][0] : null;
  }

  function createMerger(backups, deletedSet){
    var merger = {
      backups: backups,
      deletedSet: deletedSet,
      stats: {inserted:{}, updatedNewer:{}, skippedDuplicate:{}, skippedDeleted:{}, errors:[]},
      pkRemap: {},
      deletedOldPks: {},
      sourceBookmarkNatural: {},
      existingBackupTs: -8640000000000000
    };

    function bump(bucket, table){
      merger.stats[bucket][table] = (merger.stats[bucket][table] || 0) + 1;
    }

    // ---------- 4.1/4.2: подготовка объединённой БД ----------
    function prepareMergedDb(SQL){
      var base = backups[0];
      var db = new SQL.Database(base.dbBytes); // независимая копия в памяти
      db.run("PRAGMA foreign_keys = OFF");
      var schema = buildSchemaInfo(db);
      Object.keys(schema.tables).forEach(function(table){
        if(UNTOUCHED_TABLES[table]) return;
        try{ db.run("DELETE FROM [" + table + "]"); }catch(e){ /* таблицы без данных — ок */ }
      });
      return {db:db, schema:schema};
    }

    // ---------- индекс "естественный ключ -> pk" по текущему состоянию БД ----------
    function buildIdentityIndex(db, schema){
      var index = {};
      TABLE_ORDER.forEach(function(tableName){
        var idCols = IDENTITY_KEYS[tableName];
        if(!schema.tables[tableName] || !idCols){ index[tableName] = {}; return; }
        var autoincrement = schema.isAutoincrement(tableName);
        try{
          if(autoincrement){
            var pkCol = schema.primaryKeys[tableName][0];
            var aliasCols = idCols.map(function(c, i){ return "[" + c + "] as c" + i; }).join(", ");
            var rows = queryObjects(db, "SELECT [" + pkCol + "] as _pk, " + aliasCols + " FROM [" + tableName + "]");
            var map = {};
            rows.forEach(function(r){
              var tuple = idCols.map(function(c, i){ return r["c" + i]; });
              map[keyStr(tuple)] = r._pk;
            });
            index[tableName] = map;
          } else {
            var aliasCols2 = idCols.map(function(c, i){ return "[" + c + "] as c" + i; }).join(", ");
            var rows2 = queryObjects(db, "SELECT " + aliasCols2 + " FROM [" + tableName + "]");
            var map2 = {};
            rows2.forEach(function(r){
              var tuple = idCols.map(function(c, i){ return r["c" + i]; });
              map2[keyStr(tuple)] = true;
            });
            index[tableName] = map2;
          }
        }catch(e){ index[tableName] = {}; }
      });
      return index;
    }

    // ---------- перепривязка внешних ключей ----------
    function remapFks(schema, table, row){
      var fks = schema.fkMap[table];
      if(!fks) return;
      Object.keys(fks).forEach(function(col){
        if(!(col in row)) return;
        var ref = fks[col];
        if(!schema.isAutoincrement(ref.refTable)) return;
        var refPkCol = (schema.primaryKeys[ref.refTable] || [null])[0];
        if(ref.refCol !== refPkCol) return;
        var oldVal = row[col];
        var remap = merger.pkRemap[ref.refTable] || {};
        if(oldVal !== null && oldVal !== undefined && Object.prototype.hasOwnProperty.call(remap, oldVal)){
          row[col] = remap[oldVal];
        }
      });
    }

    function isCascadeDeleted(schema, tableName, row){
      var fks = schema.fkMap[tableName];
      if(!fks) return false;
      return Object.keys(fks).some(function(col){
        var refTable = fks[col].refTable;
        var deletedPks = merger.deletedOldPks[refTable];
        if(!deletedPks) return false;
        var val = row[col];
        return val !== null && val !== undefined && deletedPks[val];
      });
    }

    function naturalKeyForTracked(tableName, row, oldPk){
      if(tableName === "Bookmark"){
        var nat = merger.sourceBookmarkNatural[oldPk];
        return nat ? keyStr(nat) : null;
      }
      var idCols = IDENTITY_KEYS[tableName] || [];
      return keyStr(idCols.map(function(c){ return row[c]; }));
    }

    // ---------- вставка одной строки ----------
    function insertRow(db, schema, tableName, row){
      var pkCols = schema.primaryKeys[tableName] || [];
      var autoincrement = schema.isAutoincrement(tableName);
      var insertRowObj = {};
      Object.keys(row).forEach(function(k){ insertRowObj[k] = row[k]; });
      if(autoincrement && pkCols.length) delete insertRowObj[pkCols[0]];

      if(tableName === "TagMap") return insertTagMap(db, insertRowObj);

      var cols = Object.keys(insertRowObj);
      var colsSql = cols.map(function(c){ return "[" + c + "]"; }).join(", ");
      var placeholders = cols.map(function(){ return "?"; }).join(", ");
      try{
        return runAndGetLastId(db,
          "INSERT INTO [" + tableName + "] (" + colsSql + ") VALUES (" + placeholders + ")",
          cols.map(function(c){ return insertRowObj[c]; }));
      }catch(e){
        merger.stats.errors.push(tableName + ": " + e.message + " — строка пропущена");
        return null;
      }
    }

    function insertTagMap(db, insertRowObj){
      var cols = Object.keys(insertRowObj);
      var colsSql = cols.map(function(c){ return "[" + c + "]"; }).join(", ");
      var placeholders = cols.map(function(){ return "?"; }).join(", ");
      try{
        return runAndGetLastId(db, "INSERT INTO [TagMap] (" + colsSql + ") VALUES (" + placeholders + ")",
          cols.map(function(c){ return insertRowObj[c]; }));
      }catch(e){
        // Конфликт UNIQUE(TagId, Position) — ставим в конец списка для этого тега.
        try{
          var stmt = db.prepare("SELECT COALESCE(MAX(Position), -1) + 1 FROM TagMap WHERE TagId = ?");
          stmt.bind([insertRowObj.TagId]);
          stmt.step();
          insertRowObj.Position = stmt.get()[0];
          stmt.free();
          var cols2 = Object.keys(insertRowObj);
          var colsSql2 = cols2.map(function(c){ return "[" + c + "]"; }).join(", ");
          var placeholders2 = cols2.map(function(){ return "?"; }).join(", ");
          return runAndGetLastId(db, "INSERT INTO [TagMap] (" + colsSql2 + ") VALUES (" + placeholders2 + ")",
            cols2.map(function(c){ return insertRowObj[c]; }));
        }catch(e2){
          merger.stats.errors.push("TagMap: " + e2.message + " — строка пропущена");
          return null;
        }
      }
    }

    // ---------- Note: "побеждает более свежая версия" ----------
    function mergeNote(db, schema, row, identityIndex, oldPk){
      var guid = row.Guid;

      if(guid && deletedSet.Note[keyStr([guid])]){
        if(oldPk !== null && oldPk !== undefined){
          merger.deletedOldPks.Note = merger.deletedOldPks.Note || {};
          merger.deletedOldPks.Note[oldPk] = true;
        }
        bump("skippedDeleted", "Note");
        return;
      }

      var tableIndex = identityIndex.Note = identityIndex.Note || {};

      if(!guid){
        insertRow(db, schema, "Note", row);
        bump("inserted", "Note");
        return;
      }

      var existingPk = tableIndex[keyStr([guid])];

      if(existingPk === undefined){
        var newPk = insertRow(db, schema, "Note", row);
        if(oldPk !== null && oldPk !== undefined && newPk !== null){
          merger.pkRemap.Note[oldPk] = newPk;
        }
        if(newPk !== null) tableIndex[keyStr([guid])] = newPk;
        bump("inserted", "Note");
        return;
      }

      if(oldPk !== null && oldPk !== undefined) merger.pkRemap.Note[oldPk] = existingPk;

      var existingRows = queryObjects(db, "SELECT LastModified FROM Note WHERE NoteId = " + existingPk);
      var existingTs = parseTs(existingRows.length ? existingRows[0].LastModified : null);
      var incomingTs = parseTs(row.LastModified);

      if(incomingTs > existingTs){
        var updateCols = Object.keys(row).filter(function(c){ return c !== "NoteId"; });
        var setClause = updateCols.map(function(c){ return "[" + c + "] = ?"; }).join(", ");
        var params = updateCols.map(function(c){ return row[c]; });
        params.push(existingPk);
        db.run("UPDATE Note SET " + setClause + " WHERE NoteId = ?", params);
        bump("updatedNewer", "Note");
      } else {
        bump("skippedDuplicate", "Note");
      }
    }

    // ---------- UserMark: свежесть сравниваем по дате экспорта файла ----------
    function mergeUserMark(db, schema, row, identityIndex, oldPk, backup){
      var guid = row.UserMarkGuid;

      if(guid && deletedSet.UserMark[keyStr([guid])]){
        if(oldPk !== null && oldPk !== undefined){
          merger.deletedOldPks.UserMark = merger.deletedOldPks.UserMark || {};
          merger.deletedOldPks.UserMark[oldPk] = true;
        }
        bump("skippedDeleted", "UserMark");
        return;
      }

      var tableIndex = identityIndex.UserMark = identityIndex.UserMark || {};

      if(!guid){
        insertRow(db, schema, "UserMark", row);
        bump("inserted", "UserMark");
        return;
      }

      var existingPk = tableIndex[keyStr([guid])];

      if(existingPk === undefined){
        var newPk = insertRow(db, schema, "UserMark", row);
        if(oldPk !== null && oldPk !== undefined && newPk !== null){
          merger.pkRemap.UserMark[oldPk] = newPk;
        }
        if(newPk !== null) tableIndex[keyStr([guid])] = newPk;
        bump("inserted", "UserMark");
        return;
      }

      if(oldPk !== null && oldPk !== undefined) merger.pkRemap.UserMark[oldPk] = existingPk;

      var existingRows = queryObjects(db, "SELECT ColorIndex, StyleIndex FROM UserMark WHERE UserMarkId = " + existingPk);
      var ex = existingRows[0] || {};

      if(ex.ColorIndex !== row.ColorIndex || ex.StyleIndex !== row.StyleIndex){
        var incomingTs = parseTs(backup.lastModified);
        if(incomingTs > merger.existingBackupTs){
          db.run("UPDATE UserMark SET ColorIndex = ?, StyleIndex = ? WHERE UserMarkId = ?",
            [row.ColorIndex, row.StyleIndex, existingPk]);
          bump("updatedNewer", "UserMark");
        }
      } else {
        bump("skippedDuplicate", "UserMark");
      }
    }

    // ---------- InputField: составной PK, своей даты изменения нет ----------
    function mergeInputField(db, row, identityIndex, backup){
      var key = [row.LocationId, row.TextTag];
      var k = keyStr(key);
      var tableIndex = identityIndex.InputField = identityIndex.InputField || {};

      if(tableIndex[k]){
        var existingRows = queryObjectsParams(db,
          "SELECT Value FROM InputField WHERE LocationId = ? AND TextTag = ?",
          [row.LocationId, row.TextTag]);
        var existingVal = existingRows.length ? existingRows[0].Value : undefined;
        if(existingRows.length && existingVal !== row.Value){
          var incomingTs = parseTs(backup.lastModified);
          if(incomingTs > merger.existingBackupTs){
            db.run("UPDATE InputField SET Value = ? WHERE LocationId = ? AND TextTag = ?",
              [row.Value, key[0], key[1]]);
            bump("updatedNewer", "InputField");
          }
        } else {
          bump("skippedDuplicate", "InputField");
        }
        return;
      }

      try{
        db.run("INSERT INTO InputField (LocationId, TextTag, Value) VALUES (?, ?, ?)",
          [key[0], key[1], row.Value]);
        tableIndex[k] = true;
        bump("inserted", "InputField");
      }catch(e){
        merger.stats.errors.push("InputField: " + e.message + " — строка пропущена");
      }
    }

    // ---------- общая обработка строки ----------
    function mergeRow(db, schema, tableName, row, identityIndex, backup){
      var pkCols = schema.primaryKeys[tableName] || [];
      var autoincrement = schema.isAutoincrement(tableName);
      var oldPk = (autoincrement && pkCols.length) ? row[pkCols[0]] : null;

      // 0. Каскад удаления родителя.
      if(isCascadeDeleted(schema, tableName, row)){
        if(autoincrement && oldPk !== null && oldPk !== undefined){
          merger.deletedOldPks[tableName] = merger.deletedOldPks[tableName] || {};
          merger.deletedOldPks[tableName][oldPk] = true;
        }
        bump("skippedDeleted", tableName);
        return;
      }

      // 1. Перепривязка внешних ключей.
      remapFks(schema, tableName, row);

      // 2. Особая обработка "свежести".
      if(tableName === "Note"){ mergeNote(db, schema, row, identityIndex, oldPk); return; }
      if(tableName === "UserMark"){ mergeUserMark(db, schema, row, identityIndex, oldPk, backup); return; }
      if(tableName === "InputField"){ mergeInputField(db, row, identityIndex, backup); return; }

      // 2б. Tag / PlaylistItem / Bookmark — проверка на удаление по снимку.
      if(BASELINE_TABLES.indexOf(tableName) !== -1){
        var naturalKey = naturalKeyForTracked(tableName, row, oldPk);
        if(naturalKey !== null && deletedSet[tableName][naturalKey]){
          if(autoincrement && oldPk !== null && oldPk !== undefined){
            merger.deletedOldPks[tableName] = merger.deletedOldPks[tableName] || {};
            merger.deletedOldPks[tableName][oldPk] = true;
          }
          bump("skippedDeleted", tableName);
          return;
        }
      }

      // 3. Обычная обработка по естественному ключу.
      var idCols = IDENTITY_KEYS[tableName] || [];
      var identityTuple = keyStr(idCols.map(function(c){ return row[c]; }));
      var tableIndex = identityIndex[tableName] = identityIndex[tableName] || {};
      var existing = tableIndex[identityTuple];

      if(existing !== undefined){
        bump("skippedDuplicate", tableName);
        if(autoincrement && oldPk !== null && oldPk !== undefined && existing !== true){
          merger.pkRemap[tableName][oldPk] = existing;
        }
        return;
      }

      var newPk = insertRow(db, schema, tableName, row);
      if(autoincrement){
        if(oldPk !== null && oldPk !== undefined && newPk !== null) merger.pkRemap[tableName][oldPk] = newPk;
        if(idCols.length) tableIndex[identityTuple] = newPk;
      } else {
        if(idCols.length) tableIndex[identityTuple] = true;
      }
      bump("inserted", tableName);
    }

    // ---------- обработка одного исходного файла целиком ----------
    function mergeOneSource(mergedDb, schema, srcDb, backup, identityIndex){
      merger.pkRemap = {};
      TABLE_ORDER.forEach(function(t){ merger.pkRemap[t] = {}; });
      merger.deletedOldPks = {};
      merger.sourceBookmarkNatural = bookmarkNaturalKeys(srcDb);

      TABLE_ORDER.forEach(function(tableName){
        if(!schema.tables[tableName]) return;
        var rows;
        try{ rows = queryObjects(srcDb, "SELECT * FROM [" + tableName + "]"); }
        catch(e){ return; }
        rows.forEach(function(row){
          try{ mergeRow(mergedDb, schema, tableName, row, identityIndex, backup); }
          catch(e){ merger.stats.errors.push(tableName + ": " + e.message); }
        });
      });
    }

    // ---------- запуск всего слияния ----------
    // Возвращает {db, schema, stats}. Вызывающий код сам решает, когда
    // вызвать db.export() и db.close() (после этого делаем manifest/zip).
    merger.run = function(SQL){
      var prepared = prepareMergedDb(SQL);
      var mergedDb = prepared.db, schema = prepared.schema;

      merger.existingBackupTs = parseTs(backups[0].lastModified);

      backups.forEach(function(backup, i){
        var srcDb = new SQL.Database(backup.dbBytes);
        var identityIndex = buildIdentityIndex(mergedDb, schema);
        mergeOneSource(mergedDb, schema, srcDb, backup, identityIndex);
        srcDb.close();
        merger.existingBackupTs = parseTs(backup.lastModified);
      });

      try{
        mergedDb.run("UPDATE LastModified SET LastModified = ?", [new Date().toISOString().replace(/\.\d+Z$/, "Z")]);
      }catch(e){ /* таблицы может не быть — не критично */ }

      return {db: mergedDb, schema: schema};
    };

    return merger;
  }

  // ===================== СБОРКА ИТОГОВОГО .jwlibrary =====================

  function buildManifest(dbHash, outputName, backups){
    var now = new Date();
    var deviceNames = [];
    backups.forEach(function(b){ if(deviceNames.indexOf(b.deviceName) === -1) deviceNames.push(b.deviceName); });
    deviceNames.sort();
    var schemaVersions = backups.map(function(b){ return b.schemaVersion; }).filter(Boolean);
    var schemaVersion = schemaVersions.length ? Math.max.apply(null, schemaVersions) : 16;

    return {
      name: outputName,
      creationDate: now.toISOString().slice(0, 10),
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: now.toISOString().replace(/\.\d+Z$/, "Z"),
        deviceName: ("Merged (" + deviceNames.join(", ") + ")").slice(0, 100),
        databaseName: "userData.db",
        hash: dbHash,
        schemaVersion: schemaVersion
      }
    };
  }

  function packageOutput(dbBytes, outputName, backups){
    return sha256Hex(dbBytes).then(function(hash){
      var manifest = buildManifest(hash, outputName, backups);
      var manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

      var mediaByName = {};
      backups.forEach(function(b){
        b.mediaFiles.forEach(function(m){
          if(!mediaByName[m.name]) mediaByName[m.name] = m.data;
        });
      });

      var files = [
        {name: "manifest.json", data: manifestBytes},
        {name: "userData.db", data: dbBytes}
      ];
      Object.keys(mediaByName).forEach(function(name){
        files.push({name: name, data: mediaByName[name]});
      });

      return buildJwlibraryZip(files);
    });
  }

  // ===================== ГЛАВНАЯ ФУНКЦИЯ: СЛИЯНИЕ ДВУХ ФАЙЛОВ =====================
  // Возвращает Promise<{blob, stats, outputName}>.

  function mergeTwoFiles(file1, file2){
    var SQLref;
    return loadSqlJs().then(function(SQL){
      SQLref = SQL;
      return Promise.all([parseBackup(file1), parseBackup(file2)]);
    }).then(function(parsed){
      var backups = parsed.slice().sort(function(a, b){ return parseTs(a.lastModified) - parseTs(b.lastModified); });

      var tmpDbs = backups.map(function(b){ return new SQLref.Database(b.dbBytes); });
      var deletedInfo = computeDeletedSet(backups, tmpDbs);
      tmpDbs.forEach(function(d){ d.close(); });

      var merger = createMerger(backups, deletedInfo.deletedSet);
      var result = merger.run(SQLref);
      var dbBytes = result.db.export();
      result.db.close();

      saveDeviceState(deletedInfo.perSourceIdentities);

      var outputName = "merged.jwlibrary";
      return packageOutput(dbBytes, outputName, backups).then(function(blob){
        return {blob: blob, stats: merger.stats, outputName: outputName, hadState: deletedInfo.hadState};
      });
    });
  }

  // ===================== "ОТКРЫТЬ СЕЙЧАС" / "СОХРАНИТЬ В DOWNLOADS" =====================

  // Возвращает Promise<{ok:bool, reason?:string}> — вызывающий код показывает
  // понятное сообщение вместо тихого "ничего не произошло".
  // Кнопку "Открыть сейчас" (через navigator.share) убрали: у Chrome есть
  // жёсткий список разрешённых для шаринга типов файлов, и архивы (.jwlibrary
  // в том числе) туда не входят ни при каком MIME-типе — по документации
  // MDN (Shareable file types) это подтверждённое ограничение браузера, а
  // не что-то поправимое в коде. Вместо неё — подсказка рядом с кнопкой
  // "Сохранить в Downloads" (см. renderSettingsTabNotesMerge ниже).

  function downloadFile(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }

  // ===================== ИНТЕРФЕЙС ВКЛАДКИ =====================

  var STAT_LABELS = {
    inserted: "добавлено новых записей",
    updatedNewer: "обновлено (взята более свежая версия)",
    skippedDuplicate: "пропущено как дубликат",
    skippedDeleted: "распознано как удалённое (не восстановлено)"
  };

  function statsToHtml(stats){
    var blocks = [];
    ["inserted","updatedNewer","skippedDuplicate","skippedDeleted"].forEach(function(kind){
      var data = stats[kind];
      var keys = Object.keys(data || {});
      if(!keys.length) return;
      var lines = keys.sort().map(function(t){ return escapeHtml(t) + ": " + data[t]; }).join("<br>");
      blocks.push('<div class="workbooks-run-summary"><b>' + STAT_LABELS[kind] + ':</b><br>' + lines + '</div>');
    });
    if(stats.errors && stats.errors.length){
      blocks.push('<div class="workbooks-status-err">Ошибок при вставке: ' + stats.errors.length + '</div>');
    }
    return blocks.join("");
  }

  function fileRowHtml(idx){
    return '' +
      '<p style="margin-bottom:4px;">Выберите файл ' + idx + '</p>' +
      '<div class="task-import-file-row">' +
        '<button type="button" class="task-import-attach-btn" id="jwlMergeAttachBtn' + idx + '" title="Прикрепить файл">' + PAPERCLIP_ICON_SVG + '</button>' +
        '<span id="jwlMergeFileName' + idx + '" class="task-import-file-name">Файл не выбран</span>' +
      '</div>' +
      '<input type="file" accept=".jwlibrary" id="jwlMergeFileInput' + idx + '" style="display:none;">';
  }

  function renderSettingsTabNotesMerge(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var selectedFile1 = null, selectedFile2 = null, resultBlob = null, resultName = "merged.jwlibrary";

    container.innerHTML =
      '<div class="settings-content-bottom">' +
        '<div class="workbooks-title">Объединение заметок</div>' +
        '<p style="opacity:.7;font-size:.9em;margin-top:2px;">Объединит два файла резервной копии JW Library (.jwlibrary) в один — общие заметки, подчёркивания, закладки и теги сольются без дублей, при конфликте берётся более свежая версия.</p>' +
        fileRowHtml(1) +
        '<div style="height:12px;"></div>' +
        fileRowHtml(2) +
        '<button class="modal-btn primary" id="jwlMergeStartBtn" style="margin-top:16px;" disabled>Начать</button>' +
        '<div id="jwlMergeStatus" style="margin-top:10px;"></div>' +
        '<div id="jwlMergeResult" style="display:none;margin-top:10px;">' +
          '<button class="modal-btn primary" id="jwlMergeSaveBtn">Сохранить в Downloads</button>' +
          '<p style="opacity:.7;font-size:.85em;margin-top:6px;">После сохранения откройте уведомление о загрузке (или значок загрузок в браузере) и нажмите там «Открыть» — так можно будет выбрать JW Library.</p>' +
          '<div id="jwlMergeStats" style="margin-top:8px;"></div>' +
        '</div>' +
      '</div>';

    var startBtn = document.getElementById("jwlMergeStartBtn");
    var statusEl = document.getElementById("jwlMergeStatus");
    var resultEl = document.getElementById("jwlMergeResult");
    var statsEl = document.getElementById("jwlMergeStats");

    function refreshStartEnabled(){
      startBtn.disabled = !(selectedFile1 && selectedFile2);
    }

    [1, 2].forEach(function(idx){
      var input = document.getElementById("jwlMergeFileInput" + idx);
      var nameEl = document.getElementById("jwlMergeFileName" + idx);
      document.getElementById("jwlMergeAttachBtn" + idx).addEventListener("click", function(){ input.click(); });
      input.addEventListener("change", function(){
        var f = input.files && input.files[0] ? input.files[0] : null;
        if(idx === 1) selectedFile1 = f; else selectedFile2 = f;
        nameEl.textContent = f ? f.name : "Файл не выбран";
        refreshStartEnabled();
      });
    });

    startBtn.addEventListener("click", function(){
      startBtn.disabled = true;
      resultEl.style.display = "none";
      statusEl.innerHTML = '<div class="mood-diagram-empty">Идёт объединение…</div>';

      mergeTwoFiles(selectedFile1, selectedFile2).then(function(res){
        resultBlob = res.blob;
        resultName = res.outputName;
        statusEl.innerHTML = '<div class="workbooks-status-ok">Готово: ' + escapeHtml(res.outputName) + '</div>';
        statsEl.innerHTML = statsToHtml(res.stats);
        resultEl.style.display = "";
        refreshStartEnabled();
      }).catch(function(err){
        console.error("jwlmerge:", err);
        statusEl.innerHTML = '<div class="workbooks-status-err">Не удалось объединить файлы: ' +
          escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
        refreshStartEnabled();
      });
    });

    document.getElementById("jwlMergeSaveBtn").addEventListener("click", function(){
      if(resultBlob) downloadFile(resultBlob, resultName);
    });
  }

  return {
    renderSettingsTabNotesMerge: renderSettingsTabNotesMerge
  };
};
