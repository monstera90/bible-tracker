/* ===========================================================================
   desk.js
   Версия: 2.1 (10.11)
   Вкладка «Стол» (set2s_14, кнопка settingsTabSet2Btn14; в стеке второго набора стоит над «Изменением размера
   изображения»): несколько картинок рядом друг с другом, как на столе, и несколько страниц-«столов», которые
   листаются. Точка входа — window.initDeskModule(deps) → { renderSettingsTabDesk }; my.js зовёт её из switchSettingsTab.

   Что умеет: добавить картинки (кнопка «фото+», можно сразу несколько; новые встают на свободное место рядом с
   прежними); двигать картинку пальцем; менять размер — угловой кружок выбранной картинки или щипок двумя пальцами;
   «на передний/задний план»; удалить картинку/страницу (двойное нажатие); листать страницы кнопками ‹ › или
   свайпом по пустому месту стола; добавить страницу «+».

   Хранение — только на этом устройстве (в облако и в экспорт не входит):
   - раскладка (страницы, положение и размер картинок) — localStorage `deskLayout_v1`;
   - сами картинки — IndexedDB `lt_desk_v1` (хранилище `img`, ключ = id картинки, значение = data:URL; перед записью
     картинка уменьшается до MAX_SIDE по длинной стороне).
   Положение и ширина картинки хранятся долями ширины стола (x, y, w), высота считается по соотношению сторон `ar`,
   поэтому раскладка переживает поворот экрана; на показе картинка всегда подгоняется внутрь стола (в данные это
   не записывается — только жест пользователя меняет сохранённые числа).

   Старый WebView (Android 5.0): только ES5, touch-события (+ мышь для браузера), без pointer events, без flex-gap,
   без canvas.toBlob (картинки идут через toDataURL), без Element.closest.
   Файлы из системного выбора Android (content://) бывают без расширения и с пустым `type`, поэтому тип определяется по
   сигнатуре файла (`sniffMime`), а не по имени/`file.type`; декодирование — через blob-URL, как в imgresize.js.
   =========================================================================== */

window.initDeskModule = function(deps){
  "use strict";

  var LAYOUT_KEY = "deskLayout_v1";
  var DB_NAME = "lt_desk_v1";
  var STORE = "img";
  var ROOT_ID = "deskTabRoot";
  var MAX_SIDE = 1600;          // длинная сторона картинки после уменьшения, px
  var KEEP_ORIGINAL_BYTES = 900 * 1024; // маленький исходник jpg/png в пределах MAX_SIDE оставляем как есть
  var MAX_PAGES = 50;
  var MAX_ITEMS = 60;           // на одну страницу
  var NEW_W = 0.3;              // ширина новой картинки, доля ширины стола
  var MIN_W = 0.14;             // наименьшая ширина картинки, доля ширины стола
  var SWIPE_MIN = 60;           // px — свайп по пустому месту листает страницу
  var ARM_MS = 2600;            // сколько секунд «взведено» двойное нажатие удаления
  var DECODE_MS = 12000;        // сколько ждём открытия картинки одним способом, мс
  var FILE_MS = 35000;          // сколько ждём одну картинку целиком, мс (дольше — сообщаем, на каком шаге застряли)
  var IDB_MS = 8000;            // сколько ждём IndexedDB, мс; не ответил — картинка идёт в запасное хранилище
  var LS_PREFIX = "deskImg_";   // запасное хранение картинки в localStorage, если IndexedDB не отвечает

  var ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"></path></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"></path></svg>',
    addImg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="14" height="12" rx="1.5"></rect><circle cx="7" cy="9" r="1.2" fill="currentColor" stroke="none"></circle><path d="M3.5 14.5l3.4-3.6 2.4 2.2 3-3.4 3.2 4.2"></path><path d="M19 15v6M16 18h6"></path></svg>',
    addPage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3h8l4 4v6"></path><path d="M5.5 3v17a1 1 0 0 0 1 1H12"></path><path d="M13.5 3v4h4"></path><path d="M18 15.5v6M15 18.5h6"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M9.5 7V4.5h5V7"></path><path d="M6.5 7l1 13h9l1-13"></path><path d="M10 11v6M14 11v6"></path></svg>',
    front: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="12" height="12" rx="1.3"></rect><rect x="9" y="9" width="12" height="12" rx="1.3" fill="currentColor" fill-opacity=".35"></rect></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="1.3"></rect><rect x="3" y="3" width="12" height="12" rx="1.3" fill="currentColor" fill-opacity=".35"></rect></svg>'
  };

  // ---------------------------------------------------------------- данные
  var data = null;            // { v:1, cur:0, pages:[{id, items:[{id,x,y,w,ar}]}] }; порядок items = порядок наложения (последний сверху)
  var imgCache = {};          // id → data:URL (только для картинок текущей страницы)
  var selId = null;           // выбранная картинка
  var gesture = null;
  var lastTouchAt = 0;
  var saveTimer = null;
  var toastTimer = null;
  var armTimer = null;
  var armed = "";             // "item" | "page" — какая кнопка удаления сейчас «взведена»
  var resizeBound = false;
  var dbRef = null;
  var dbFailed = false;
  var adding = false;         // идёт добавление картинок

  function dlog(t){ try{ if(window.Debug && window.Debug.log) window.Debug.log("Стол: " + t); }catch(e){} }

  function uid(){ return "d" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }

  function loadData(){
    var d = null;
    try{ d = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"); }catch(e){ d = null; }
    if(!d || !d.pages || !d.pages.length){
      d = { v: 1, cur: 0, pages: [{ id: uid(), items: [] }] };
    }
    if(typeof d.cur !== "number" || d.cur < 0 || d.cur >= d.pages.length) d.cur = 0;
    for(var p = 0; p < d.pages.length; p++){
      var its = d.pages[p].items;
      if(!its || !its.length){ d.pages[p].items = []; continue; }
      var clean = [];
      for(var i = 0; i < its.length; i++){
        var it = its[i];
        if(it && it.id && isFinite(it.x) && isFinite(it.y) && it.w > 0 && it.ar > 0) clean.push(it);
      }
      d.pages[p].items = clean;
    }
    return d;
  }
  function saveNow(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
    try{ localStorage.setItem(LAYOUT_KEY, JSON.stringify(data)); }catch(e){}
  }
  function saveSoon(){
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function page(){ return data.pages[data.cur]; }
  function findItem(id){
    var its = page().items;
    for(var i = 0; i < its.length; i++) if(its[i].id === id) return its[i];
    return null;
  }

  // ---------------------------------------------------------------- IndexedDB (картинки)
  function openDb(cb){
    if(dbRef){ cb(dbRef); return; }
    if(dbFailed || !window.indexedDB){ dbFailed = true; cb(null); return; }
    var req;
    try{ req = indexedDB.open(DB_NAME, 1); }catch(e){ dbFailed = true; cb(null); return; }
    req.onupgradeneeded = function(){
      try{ req.result.createObjectStore(STORE); }catch(e){}
    };
    req.onsuccess = function(){ dbRef = req.result; cb(dbRef); };
    req.onerror = function(){ dbFailed = true; cb(null); };
    req.onblocked = function(){ dbFailed = true; cb(null); };
  }
  function lsPut(id, url){
    try{ localStorage.setItem(LS_PREFIX + id, url); return true; }catch(e){ return false; }
  }
  function lsGet(id){
    try{ var v = localStorage.getItem(LS_PREFIX + id); return typeof v === "string" && v ? v : null; }catch(e){ return null; }
  }
  function lsDel(id){ try{ localStorage.removeItem(LS_PREFIX + id); }catch(e){} }
  function idbPut(id, url, cb){
    var fin = false;
    var t = setTimeout(function(){ if(!fin){ fin = true; dlog("IndexedDB не ответил на запись"); cb(false); } }, IDB_MS);
    function end(ok){ if(fin) return; fin = true; clearTimeout(t); cb(ok); }
    openDb(function(db){
      if(!db){ end(false); return; }
      try{
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(url, id);
        tx.oncomplete = function(){ end(true); };
        tx.onerror = function(){ end(false); };
        tx.onabort = function(){ end(false); };
      }catch(e){ end(false); }
    });
  }
  function idbGet(id, cb){
    var fin = false;
    var t = setTimeout(function(){ if(!fin){ fin = true; cb(null); } }, IDB_MS);
    function end(v){ if(fin) return; fin = true; clearTimeout(t); cb(v); }
    openDb(function(db){
      if(!db){ end(null); return; }
      try{
        var r = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
        r.onsuccess = function(){ end(typeof r.result === "string" ? r.result : null); };
        r.onerror = function(){ end(null); };
      }catch(e){ end(null); }
    });
  }
  function idbDelete(ids){
    if(!ids || !ids.length) return;
    for(var j = 0; j < ids.length; j++) lsDel(ids[j]);
    openDb(function(db){
      if(!db) return;
      try{
        var tx = db.transaction(STORE, "readwrite");
        var os = tx.objectStore(STORE);
        for(var i = 0; i < ids.length; i++) os["delete"](ids[i]);
      }catch(e){}
    });
  }

  // ---------------------------------------------------------------- чтение и уменьшение картинки
  // Явно не картинка (pdf, видео, текст): тип известен и не image/*. Пустой тип и application/octet-stream
  // пропускаем — так приходят файлы из системного выбора Android, настоящий тип узнаём по сигнатуре (sniffMime).
  function isClearlyNotImage(f){
    var t = String(f.type || "").toLowerCase();
    return !!t && t.indexOf("image/") !== 0 && t !== "application/octet-stream";
  }
  // Тип картинки по первым байтам файла; "" — не узнали.
  function sniffMime(u8){
    function at(i, str){
      for(var k = 0; k < str.length; k++) if(u8[i + k] !== str.charCodeAt(k)) return false;
      return true;
    }
    if(!u8 || u8.length < 12) return "";
    if(u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return "image/jpeg";
    if(u8[0] === 0x89 && at(1, "PNG")) return "image/png";
    if(at(0, "GIF8")) return "image/gif";
    if(at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
    if(at(0, "BM")) return "image/bmp";
    if(at(4, "ftyp")){
      var brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
      if(/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "image/heic";
      if(/^avi[fs]$/.test(brand)) return "image/avif";
    }
    return "";
  }
  // Уменьшает уже открытую картинку до MAX_SIDE и отдаёт data:URL. origBlob — исходник (только известные jpg/png):
  // маленький исходник в пределах MAX_SIDE остаётся как есть.
  function fitImage(img, isPng, origBlob, done){
    var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    if(!(nw > 0 && nh > 0)){ done(null, "картинка не открылась"); return; }
    var scale = Math.min(1, MAX_SIDE / Math.max(nw, nh));
    if(scale === 1 && origBlob && origBlob.size <= KEEP_ORIGINAL_BYTES){
      var fr2 = new FileReader();
      fr2.onerror = function(){ done(null, "файл не читается"); };
      fr2.onload = function(){ done({ url: String(fr2.result || ""), w: nw, h: nh }); };
      fr2.readAsDataURL(origBlob);
      return;
    }
    var cw = Math.max(1, Math.round(nw * scale)), ch = Math.max(1, Math.round(nh * scale));
    try{
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d");
      if(!isPng){ ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch); }
      ctx.drawImage(img, 0, 0, cw, ch);
      var out = isPng ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.86);
      if(out.indexOf("data:image/") !== 0){ done(null, "не удалось уменьшить"); return; }
      done({ url: out, w: cw, h: ch });
    }catch(e){ done(null, "не хватило памяти на уменьшение"); }
  }

  // Открывает Blob/File как картинку через blob-URL с таймаутом. cb(img|null, why, release): release() отпускает blob-URL
  // (звать, когда картинка больше не нужна).
  function decodeBlob(blob, cb){
    var URLApi = window.URL || window.webkitURL, u = null, img = new Image(), fin = false, t = null;
    function release(){ try{ if(u) URLApi.revokeObjectURL(u); }catch(e){} u = null; }
    function end(ok, why){
      if(fin) return;
      fin = true; clearTimeout(t);
      img.onload = null; img.onerror = null;
      cb(ok ? img : null, why, release);
    }
    try{ u = URLApi.createObjectURL(blob); }catch(e){ end(false, "не удалось подготовить файл"); return; }
    t = setTimeout(function(){ end(false, "картинка не открывается (нет ответа)"); }, DECODE_MS);
    img.onerror = function(){ end(false, "картинка не открылась"); };
    img.onload = function(){ end(true); };
    img.src = u;
  }

  // cb(res, why): res = {url, w, h} (data:URL уже уменьшенной картинки) или null и причина why для сообщения.
  // stage(текст) — на каком шаге сейчас файл (для сообщения на экране). Два способа: сначала файл открывается напрямую
  // (без чтения в память: у файлов из Android-выбора бывает пустой тип), не вышло — читаем FileReader и определяем тип по сигнатуре.
  function readAndFit(file, cb, stage){
    var over = false, curStage = "начало";
    function st(t){ curStage = t; if(stage) stage(t); }
    var total = setTimeout(function(){
      if(over) return;
      over = true;
      dlog("таймаут на шаге «" + curStage + "»");
      cb(null, "нет ответа на шаге «" + curStage + "»");
    }, FILE_MS);
    function fin(res, why){
      if(over) return;
      over = true; clearTimeout(total);
      cb(res, why);
    }
    var ft = String(file.type || "").toLowerCase();
    var guessPng = ft === "image/png" || /\.png$/i.test(String(file.name || ""));

    function viaReader(why1){
      st("читаю файл");
      var fr = new FileReader();
      fr.onerror = function(){ fin(null, "файл не читается"); };
      fr.onload = function(){
        if(over) return;
        var mime = "";
        try{ mime = sniffMime(new Uint8Array(fr.result)); }catch(e){ mime = ""; }
        if(!mime){
          if(/^image\/(jpeg|png|gif|webp|bmp)$/.test(ft)) mime = ft; // сигнатуру не узнали, но система уверена в типе
        }
        if(!mime){ fin(null, "это не картинка"); return; }
        var blob = null;
        try{ blob = new Blob([fr.result], { type: mime }); }catch(e){ fin(null, "не удалось подготовить файл"); return; }
        st("открываю картинку (запасной способ)");
        decodeBlob(blob, function(img, why, release){
          if(!img){
            release();
            fin(null, (mime === "image/heic" || mime === "image/avif") ? "формат " + (mime === "image/heic" ? "HEIC" : "AVIF") + " не открывается" : (why || why1 || "картинка не открылась"));
            return;
          }
          st("уменьшаю");
          var keep = (mime === "image/png" || mime === "image/jpeg") ? blob : null;
          fitImage(img, mime === "image/png", keep, function(res, why3){ release(); fin(res, why3); });
        });
      };
      try{ fr.readAsArrayBuffer(file); }catch(e){ fin(null, "файл не читается"); }
    }

    st("открываю картинку");
    decodeBlob(file, function(img, why, release){
      if(over){ release(); return; }
      if(!img){ release(); dlog("напрямую не открылась (" + why + "), читаю через FileReader"); viaReader(why); return; }
      st("уменьшаю");
      fitImage(img, guessPng, null, function(res, why2){
        release();
        if(!res){ dlog("напрямую не уменьшилась (" + why2 + "), читаю через FileReader"); viaReader(why2); return; }
        fin(res, why2);
      });
    });
  }

  // ---------------------------------------------------------------- DOM
  function ensureStyle(){
    if(document.getElementById("deskTabStyle")) return;
    var st = document.createElement("style");
    st.id = "deskTabStyle";
    st.textContent =
      "#deskTabRoot{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;color:var(--wood,#5b4a8a);}" +
      "#deskTabRoot .desk-bar{display:flex;align-items:center;flex:0 0 auto;padding:4px 0 6px;}" +
      "#deskTabRoot .desk-ib{flex:0 0 auto;width:36px;height:36px;padding:7px;margin-right:4px;box-sizing:border-box;border-radius:8px;" +
        "border:1px solid var(--wood,#5b4a8a);background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);display:flex;align-items:center;justify-content:center;" +
        "-webkit-tap-highlight-color:transparent;}" +
      "#deskTabRoot .desk-ib svg{width:100%;height:100%;}" +
      "#deskTabRoot .desk-ib[disabled]{opacity:.35;}" +
      "#deskTabRoot .desk-ib.armed{background:#c62828;border-color:#c62828;color:#fff;}" +
      "#deskTabRoot .desk-pg{flex:0 0 auto;min-width:58px;padding:0 4px;text-align:center;font-size:15px;font-weight:600;margin-right:4px;}" +
      "#deskTabRoot .desk-sp{flex:1 1 auto;min-width:0;}" +
      "#deskTabRoot .desk-tools{display:flex;flex:0 0 auto;align-items:center;}" +
      "#deskTabRoot .desk-tools .desk-ib:last-child{margin-right:0;}" +
      "#deskTabRoot .desk-stage{position:relative;flex:1 1 auto;min-height:200px;overflow:hidden;border-radius:10px;" +
        "border:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:rgba(127,127,127,.13);box-shadow:inset 0 1px 6px rgba(0,0,0,.18);" +
        "-ms-touch-action:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}" +
      "#deskTabRoot .desk-sheet{position:absolute;left:0;top:0;right:0;bottom:0;}" +
      "#deskTabRoot .desk-item{position:absolute;box-sizing:border-box;background:#fff;box-shadow:0 2px 7px rgba(0,0,0,.38);}" +
      "#deskTabRoot .desk-item.sel{outline:2px solid #7F00FF;}" +
      "#deskTabRoot .desk-item img{display:block;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none;}" +
      "#deskTabRoot .desk-handle{position:absolute;right:0;bottom:0;width:34px;height:34px;}" +
      "#deskTabRoot .desk-handle:after{content:'';position:absolute;right:3px;bottom:3px;width:20px;height:20px;border-radius:50%;" +
        "background:#7F00FF;border:2px solid #fff;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.5);}" +
      "#deskTabRoot .desk-empty{position:absolute;left:0;right:0;top:40%;padding:0 20px;text-align:center;font-size:15px;line-height:1.45;opacity:.8;pointer-events:none;}" +
      "#deskTabRoot .desk-toast{position:absolute;left:10px;right:10px;bottom:10px;padding:7px 10px;border-radius:8px;text-align:center;font-size:13px;" +
        "background:rgba(0,0,0,.72);color:#fff;pointer-events:none;opacity:0;-webkit-transition:opacity .2s;transition:opacity .2s;}" +
      "#deskTabRoot .desk-toast.on{opacity:1;}";
    document.head.appendChild(st);
  }

  function rootEl(){ return document.getElementById(ROOT_ID); }
  function q(id){ return document.getElementById(id); }
  function stageEl(){ return q("deskStage"); }
  function sheetEl(){ return q("deskSheet"); }
  function esc(s){ return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function toast(text, ms){
    var t = q("deskToast");
    if(!t) return;
    t.textContent = text;
    t.className = "desk-toast on";
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ var x = q("deskToast"); if(x) x.className = "desk-toast"; }, ms || 2400);
  }

  function disarm(){
    armed = "";
    if(armTimer){ clearTimeout(armTimer); armTimer = null; }
    var b1 = q("deskDelItemBtn"), b2 = q("deskDelPageBtn");
    if(b1) b1.className = "desk-ib";
    if(b2) b2.className = "desk-ib";
  }
  function arm(kind, btnId, hint){
    disarm();
    armed = kind;
    var b = q(btnId);
    if(b) b.className = "desk-ib armed";
    toast(hint);
    armTimer = setTimeout(disarm, ARM_MS);
  }

  function renderShell(){
    var c = q("settingsTabContent");
    if(!c) return false;
    ensureStyle();
    c.innerHTML =
      '<div id="' + ROOT_ID + '">' +
        '<div class="desk-bar">' +
          '<button type="button" class="desk-ib" id="deskPrevBtn" title="Предыдущая страница">' + ICON.prev + '</button>' +
          '<div class="desk-pg" id="deskPageNum"></div>' +
          '<button type="button" class="desk-ib" id="deskNextBtn" title="Следующая страница">' + ICON.next + '</button>' +
          '<div class="desk-sp"></div>' +
          '<div class="desk-tools" id="deskPageTools">' +
            '<button type="button" class="desk-ib" id="deskAddImgBtn" title="Добавить картинки">' + ICON.addImg + '</button>' +
            '<button type="button" class="desk-ib" id="deskAddPageBtn" title="Новая страница">' + ICON.addPage + '</button>' +
            '<button type="button" class="desk-ib" id="deskDelPageBtn" title="Удалить страницу">' + ICON.trash + '</button>' +
          '</div>' +
          '<div class="desk-tools" id="deskItemTools" style="display:none;">' +
            '<button type="button" class="desk-ib" id="deskFrontBtn" title="На передний план">' + ICON.front + '</button>' +
            '<button type="button" class="desk-ib" id="deskBackBtn" title="На задний план">' + ICON.back + '</button>' +
            '<button type="button" class="desk-ib" id="deskDelItemBtn" title="Удалить картинку">' + ICON.trash + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="desk-stage" id="deskStage"><div class="desk-sheet" id="deskSheet"></div>' +
          '<div class="desk-empty" id="deskEmpty">Стол пуст.<br>Нажмите кнопку с картинкой и «+», чтобы выложить фото.</div>' +
          '<div class="desk-toast" id="deskToast"></div>' +
        '</div>' +
        '<input type="file" id="deskFileInput" accept="image/*" multiple style="display:none;">' +
      '</div>';
    bindShell();
    return true;
  }

  function stageSize(){
    var s = stageEl();
    return { w: s ? s.clientWidth : 0, h: s ? s.clientHeight : 0 };
  }

  // Прямоугольник картинки в пикселях стола, всегда целиком внутри него (только для показа, в данные не пишется).
  function rectOf(it, W, H){
    var w = it.w * W;
    var maxW = Math.min(W, H / it.ar);
    if(w > maxW) w = maxW;
    if(w < 1) w = 1;
    var h = w * it.ar;
    var x = it.x * W, y = it.y * W;
    if(x > W - w) x = W - w;
    if(y > H - h) y = H - h;
    if(x < 0) x = 0;
    if(y < 0) y = 0;
    return { x: x, y: y, w: w, h: h };
  }
  function applyRect(el, r){
    el.style.left = r.x + "px";
    el.style.top = r.y + "px";
    el.style.width = r.w + "px";
    el.style.height = r.h + "px";
  }
  function itemEl(id){
    var sh = sheetEl();
    if(!sh) return null;
    var kids = sh.childNodes;
    for(var i = 0; i < kids.length; i++) if(kids[i].getAttribute && kids[i].getAttribute("data-id") === id) return kids[i];
    return null;
  }
  function restack(){
    var its = page().items;
    // порядок наложения задаёт только z-index: DOM-узлы не переставляем (перестановка во время касания сбивает жест)
    for(var i = 0; i < its.length; i++){
      var el = itemEl(its[i].id);
      if(el) el.style.zIndex = String(i + 1);
    }
  }

  function setImgSrc(id){
    var el = itemEl(id);
    if(!el) return;
    var im = el.getElementsByTagName("img")[0];
    if(im && imgCache[id] && im.getAttribute("src") !== imgCache[id]) im.src = imgCache[id];
  }

  function makeItemEl(it){
    var el = document.createElement("div");
    el.className = "desk-item";
    el.setAttribute("data-id", it.id);
    var im = document.createElement("img");
    im.alt = "";
    im.draggable = false;
    el.appendChild(im);
    return el;
  }

  function syncSelectionView(){
    var sh = sheetEl();
    if(!sh) return;
    var kids = sh.childNodes;
    for(var i = 0; i < kids.length; i++){
      var el = kids[i];
      var isSel = el.getAttribute("data-id") === selId;
      el.className = isSel ? "desk-item sel" : "desk-item";
      var h = null, ch = el.childNodes;
      for(var k = 0; k < ch.length; k++) if(ch[k].className === "desk-handle") h = ch[k];
      if(isSel && !h){
        h = document.createElement("div");
        h.className = "desk-handle";
        el.appendChild(h);
      } else if(!isSel && h){
        el.removeChild(h);
      }
    }
    var pt = q("deskPageTools"), itl = q("deskItemTools");
    if(pt) pt.style.display = selId ? "none" : "flex";
    if(itl) itl.style.display = selId ? "flex" : "none";
    disarm();
  }

  function updateBar(){
    var n = q("deskPageNum");
    if(n) n.textContent = (data.cur + 1) + " / " + data.pages.length;
    var p = q("deskPrevBtn"), nx = q("deskNextBtn");
    if(p) p.disabled = data.cur <= 0;
    if(nx) nx.disabled = data.cur >= data.pages.length - 1;
    var em = q("deskEmpty");
    if(em) em.style.display = page().items.length ? "none" : "";
  }

  // Полная перерисовка текущей страницы. dir: -1/1 — направление листания для короткой анимации, 0 — без неё.
  function renderPage(dir){
    var sh = sheetEl();
    if(!sh) return;
    var sz = stageSize();
    var its = page().items;
    // кэш картинок держим только для текущей страницы
    var keep = {};
    for(var k = 0; k < its.length; k++) keep[its[k].id] = true;
    for(var key in imgCache) if(imgCache.hasOwnProperty(key) && !keep[key]) delete imgCache[key];

    sh.innerHTML = "";
    for(var i = 0; i < its.length; i++){
      var el = makeItemEl(its[i]);
      applyRect(el, rectOf(its[i], sz.w, sz.h));
      el.style.zIndex = String(i + 1);
      sh.appendChild(el);
      if(imgCache[its[i].id]) setImgSrc(its[i].id);
      else loadImage(its[i].id);
    }
    if(selId && !findItem(selId)) selId = null;
    syncSelectionView();
    updateBar();
    if(dir){
      sh.style.webkitTransition = "none"; sh.style.transition = "none";
      sh.style.webkitTransform = "translateX(" + (dir * 28) + "%)"; sh.style.transform = "translateX(" + (dir * 28) + "%)";
      sh.style.opacity = "0";
      void sh.offsetWidth; // принудительный пересчёт, иначе переход не сработает
      sh.style.webkitTransition = "-webkit-transform .18s, opacity .18s"; sh.style.transition = "transform .18s, opacity .18s";
      sh.style.webkitTransform = "translateX(0)"; sh.style.transform = "translateX(0)";
      sh.style.opacity = "1";
    }
  }

  function loadImage(id){
    idbGet(id, function(url){
      if(!url) url = lsGet(id);
      if(url){ imgCache[id] = url; setImgSrc(id); }
    });
  }

  function relayout(){
    var sh = sheetEl();
    if(!sh) return;
    var sz = stageSize();
    var its = page().items;
    for(var i = 0; i < its.length; i++){
      var el = itemEl(its[i].id);
      if(el) applyRect(el, rectOf(its[i], sz.w, sz.h));
    }
  }

  // ---------------------------------------------------------------- страницы
  function gotoPage(n, dir){
    if(n < 0 || n >= data.pages.length || n === data.cur) return;
    data.cur = n;
    selId = null;
    saveSoon();
    renderPage(dir || 1);
  }
  function addPage(){
    if(data.pages.length >= MAX_PAGES){ toast("Больше " + MAX_PAGES + " страниц не поместится."); return; }
    data.pages.splice(data.cur + 1, 0, { id: uid(), items: [] });
    data.cur++;
    selId = null;
    saveNow();
    renderPage(1);
  }
  function deletePage(){
    var pg = page();
    var ids = [];
    for(var i = 0; i < pg.items.length; i++) ids.push(pg.items[i].id);
    idbDelete(ids);
    for(var j = 0; j < ids.length; j++) delete imgCache[ids[j]];
    if(data.pages.length === 1){
      pg.items = [];
    } else {
      data.pages.splice(data.cur, 1);
      if(data.cur >= data.pages.length) data.cur = data.pages.length - 1;
    }
    selId = null;
    saveNow();
    renderPage(0);
  }

  // ---------------------------------------------------------------- картинки: добавление, порядок, удаление
  // Ищем свободное место для новой картинки (шириной w, высотой h — в долях ширины стола); не нашли — каскадом.
  function findSlot(w, h, hr){
    var its = page().items, step = 0.02;
    for(var y = 0.02; y + h <= hr - 0.01; y += step){
      for(var x = 0.02; x + w <= 1 - 0.01; x += step){
        var free = true;
        for(var i = 0; i < its.length; i++){
          var o = its[i], ow = o.w, oh = o.w * o.ar;
          if(x < o.x + ow && x + w > o.x && y < o.y + oh && y + h > o.y){ free = false; break; }
        }
        if(free) return { x: x, y: y };
      }
    }
    var n = its.length % 8;
    return { x: Math.min(0.02 + n * 0.04, Math.max(0, 1 - w)), y: Math.min(0.02 + n * 0.04, Math.max(0, hr - h)) };
  }

  // files — массив File; onEnd() — когда все обработаны (или ушли с ошибкой).
  function addFiles(files, onEnd){
    var list = [];
    for(var i = 0; i < files.length; i++) if(!isClearlyNotImage(files[i])) list.push(files[i]);
    if(!list.length){ toast("Нужны файлы-картинки.", 5000); if(onEnd) onEnd(); return; }
    adding = true;
    var pageId = page().id, added = 0, failed = 0, full = false, idx = 0, firstWhy = "", viaLs = 0;
    function finish(){
      adding = false;
      if(onEnd) onEnd();
    }
    function next(){
      if(idx >= list.length){
        var msg = added ? ("Добавлено: " + added) : "Ничего не добавлено";
        if(failed) msg += ". Не удалось добавить: " + failed + (firstWhy ? " (" + firstWhy + ")" : "");
        if(full) msg += ". На странице уже " + MAX_ITEMS + " картинок";
        if(viaLs) msg += ". Сохранено запасным способом: " + viaLs;
        dlog(msg);
        toast(msg + ".", failed ? 9000 : 2400);
        finish();
        return;
      }
      var n = idx + 1;
      toast("Файл " + n + " из " + list.length + "…", 40000);
      var f = list[idx++];
      dlog("файл " + n + ": имя=" + (f.name || "?") + ", тип=" + (f.type || "пусто") + ", размер=" + (f.size || 0));
      var pg = null;
      for(var p = 0; p < data.pages.length; p++) if(data.pages[p].id === pageId) pg = data.pages[p];
      if(!pg){ finish(); return; } // страницу удалили, пока читались файлы
      if(pg.items.length >= MAX_ITEMS){ full = true; idx = list.length; next(); return; }
      readAndFit(f, function(res, why){
        if(!res){ failed++; if(!firstWhy) firstWhy = why || ""; dlog("файл " + n + ": ошибка — " + why); next(); return; }
        var id = uid();
        toast("Файл " + n + " из " + list.length + ": сохраняю…", 40000);
        idbPut(id, res.url, function(ok){
          if(!ok){
            if(lsPut(id, res.url)){ viaLs++; }
            else { failed++; if(!firstWhy) firstWhy = "не удалось сохранить на устройстве"; next(); return; }
          }
          imgCache[id] = res.url;
          var sz = stageSize();
          var hr = sz.w > 0 ? sz.h / sz.w : 1.3;
          var ar = res.h / res.w;
          var w = Math.min(NEW_W, hr / ar);
          var pos = findSlot(w, w * ar, hr);
          var it = { id: id, x: pos.x, y: pos.y, w: w, ar: ar };
          // страница могла смениться, пока читался файл
          var shNow = sheetEl();
          if(shNow && page().id === pageId){
            pg.items.push(it);
            var el = makeItemEl(it);
            applyRect(el, rectOf(it, sz.w, sz.h));
            el.style.zIndex = String(pg.items.length);
            shNow.appendChild(el);
            setImgSrc(id);
            updateBar();
          } else {
            pg.items.push(it);
          }
          added++;
          saveNow();
          next();
        });
      }, function(t){ toast("Файл " + n + " из " + list.length + ": " + t + "…", 40000); });
    }
    next();
  }

  function bringTo(id, toFront){
    var its = page().items, at = -1;
    for(var i = 0; i < its.length; i++) if(its[i].id === id) at = i;
    if(at < 0) return;
    var it = its.splice(at, 1)[0];
    if(toFront) its.push(it); else its.unshift(it);
    restack();
    saveSoon();
  }
  function deleteItem(id){
    var its = page().items;
    for(var i = 0; i < its.length; i++){
      if(its[i].id === id){ its.splice(i, 1); break; }
    }
    idbDelete([id]);
    delete imgCache[id];
    var el = itemEl(id);
    if(el && el.parentNode) el.parentNode.removeChild(el);
    selId = null;
    restack();
    syncSelectionView();
    updateBar();
    saveNow();
  }

  function select(id){
    if(selId === id) return;
    selId = id;
    syncSelectionView();
  }

  // ---------------------------------------------------------------- жесты (touch + мышь)
  function hitItem(target){
    var n = target;
    while(n && n !== document){
      if(n.getAttribute && n.getAttribute("data-id") && n.className && String(n.className).indexOf("desk-item") === 0) return n;
      n = n.parentNode;
    }
    return null;
  }
  function isHandle(target){
    return !!(target && target.className && String(target.className).indexOf("desk-handle") !== -1);
  }
  function localPoint(p){
    var r = stageEl().getBoundingClientRect();
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function dist(a, b){
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function beginGesture(pts, target){
    var sz = stageSize();
    if(pts.length >= 2){
      // щипок: масштабируем выбранную картинку (или ту, на которой начат жест)
      var id = selId || (gesture && gesture.id);
      var it = id ? findItem(id) : null;
      if(!it){ gesture = null; return; }
      var r = rectOf(it, sz.w, sz.h);
      gesture = { type: "pinch", id: id, d0: Math.max(10, dist(pts[0], pts[1])), r0: r };
      return;
    }
    var p = pts[0];
    var handle = isHandle(target);
    var el = hitItem(target);
    if(el){
      var iid = el.getAttribute("data-id");
      var it2 = findItem(iid);
      if(!it2){ gesture = null; return; }
      if(!handle && selId !== iid){
        var its = page().items;
        if(its[its.length - 1].id !== iid) bringTo(iid, true);
      }
      select(iid);
      var r2 = rectOf(it2, sz.w, sz.h);
      gesture = { type: handle ? "resize" : "move", id: iid, sx: p.x, sy: p.y, r0: r2, moved: false };
      return;
    }
    gesture = { type: "swipe", sx: p.x, sy: p.y, moved: false, dx: 0, dy: 0 };
  }

  function setItemFromRect(it, r, sz){
    it.x = r.x / sz.w;
    it.y = r.y / sz.w;
    it.w = r.w / sz.w;
  }

  function moveGesture(pts){
    if(!gesture) return;
    var sz = stageSize();
    if(sz.w <= 0) return;
    var g = gesture;
    if(g.type === "pinch"){
      if(pts.length < 2) return;
      var it = findItem(g.id);
      if(!it) return;
      var s = dist(pts[0], pts[1]) / g.d0;
      var maxW = Math.min(sz.w, sz.h / it.ar), minW = MIN_W * sz.w;
      var w = Math.max(minW, Math.min(maxW, g.r0.w * s));
      var h = w * it.ar;
      var cx = g.r0.x + g.r0.w / 2, cy = g.r0.y + g.r0.h / 2;
      var x = Math.max(0, Math.min(sz.w - w, cx - w / 2));
      var y = Math.max(0, Math.min(sz.h - h, cy - h / 2));
      var rr = { x: x, y: y, w: w, h: h };
      setItemFromRect(it, rr, sz);
      var el = itemEl(g.id); if(el) applyRect(el, rr);
      g.moved = true;
      return;
    }
    var p = pts[0];
    var dx = p.x - g.sx, dy = p.y - g.sy;
    if(g.type === "swipe"){
      g.dx = dx; g.dy = dy;
      if(Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
      return;
    }
    var it3 = findItem(g.id);
    if(!it3) return;
    if(Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true;
    if(g.type === "move"){
      var x2 = Math.max(0, Math.min(sz.w - g.r0.w, g.r0.x + dx));
      var y2 = Math.max(0, Math.min(sz.h - g.r0.h, g.r0.y + dy));
      var r3 = { x: x2, y: y2, w: g.r0.w, h: g.r0.h };
      setItemFromRect(it3, r3, sz);
      var el3 = itemEl(g.id); if(el3) applyRect(el3, r3);
    } else { // resize: масштаб по проекции смещения на диагональ картинки, левый верхний угол стоит
      var w0 = g.r0.w, h0 = g.r0.h;
      var sc = 1 + (dx * w0 + dy * h0) / (w0 * w0 + h0 * h0);
      var maxW2 = Math.min(sz.w - g.r0.x, (sz.h - g.r0.y) / it3.ar), minW2 = MIN_W * sz.w;
      var nw = Math.max(minW2, Math.min(maxW2, w0 * sc));
      var r4 = { x: g.r0.x, y: g.r0.y, w: nw, h: nw * it3.ar };
      setItemFromRect(it3, r4, sz);
      var el4 = itemEl(g.id); if(el4) applyRect(el4, r4);
    }
  }

  function endGesture(){
    var g = gesture;
    gesture = null;
    if(!g) return;
    if(g.type === "swipe"){
      if(!g.moved){ select(null); return; } // тап по пустому месту — снять выбор
      if(Math.abs(g.dx) >= SWIPE_MIN && Math.abs(g.dx) > Math.abs(g.dy) * 1.5){
        if(g.dx < 0) gotoPage(data.cur + 1, 1); else gotoPage(data.cur - 1, -1);
      }
      return;
    }
    if(g.moved) saveNow();
  }

  function bindStage(){
    var st = stageEl();
    function pointsOf(e){
      var out = [];
      for(var i = 0; i < e.touches.length; i++) out.push(localPoint(e.touches[i]));
      return out;
    }
    st.addEventListener("touchstart", function(e){
      lastTouchAt = Date.now();
      if(e.touches.length > 2) return;
      if(e.cancelable) e.preventDefault();
      var pts = pointsOf(e);
      if(e.touches.length === 2){
        if(gesture && gesture.type === "swipe") gesture = null;
        beginGesture(pts, e.target);
      } else {
        beginGesture(pts, e.target);
      }
    }, { passive: false });
    st.addEventListener("touchmove", function(e){
      lastTouchAt = Date.now();
      if(e.cancelable) e.preventDefault();
      moveGesture(pointsOf(e));
    }, { passive: false });
    function touchDone(e){
      lastTouchAt = Date.now();
      if(e.touches && e.touches.length === 1 && gesture && gesture.type === "pinch"){
        // один палец остался — продолжаем как перемещение выбранной картинки
        var keepId = gesture.id;
        saveNow();
        var it = findItem(keepId), sz = stageSize();
        if(it){
          var p = localPoint(e.touches[0]);
          gesture = { type: "move", id: keepId, sx: p.x, sy: p.y, r0: rectOf(it, sz.w, sz.h), moved: true };
        } else gesture = null;
        return;
      }
      if(e.touches && e.touches.length > 0) return;
      endGesture();
    }
    st.addEventListener("touchend", touchDone, { passive: true });
    st.addEventListener("touchcancel", function(){ lastTouchAt = Date.now(); if(gesture && gesture.type !== "swipe") saveNow(); gesture = null; }, { passive: true });

    // мышь (браузер на компьютере); после касания эмулированные события мыши игнорируем
    st.addEventListener("mousedown", function(e){
      if(Date.now() - lastTouchAt < 700 || e.button !== 0) return;
      e.preventDefault();
      beginGesture([localPoint(e)], e.target);
      function mm(ev){ moveGesture([localPoint(ev)]); }
      function mu(){
        document.removeEventListener("mousemove", mm, false);
        document.removeEventListener("mouseup", mu, false);
        endGesture();
      }
      document.addEventListener("mousemove", mm, false);
      document.addEventListener("mouseup", mu, false);
    }, false);
  }

  // ---------------------------------------------------------------- кнопки и запуск
  function bindShell(){
    bindStage();
    var fileInput = q("deskFileInput");
    q("deskPrevBtn").addEventListener("click", function(){ gotoPage(data.cur - 1, -1); });
    q("deskNextBtn").addEventListener("click", function(){ gotoPage(data.cur + 1, 1); });
    q("deskAddPageBtn").addEventListener("click", addPage);
    q("deskAddImgBtn").addEventListener("click", function(){
      if(adding){ toast("Идёт добавление, подождите…", 2500); return; }
      toast("Открываю выбор файла…", 3000);
      try{ fileInput.click(); }catch(e){ toast("Не удалось открыть выбор файла.", 5000); }
    });
    function onPicked(){
      var fl = fileInput.files;
      var arr = [];
      if(fl) for(var i = 0; i < fl.length; i++) arr.push(fl[i]);
      dlog("выбор файлов: " + arr.length);
      if(!arr.length){ return; }
      if(adding){ return; }
      toast("Выбрано файлов: " + arr.length, 40000);
      // значение поля не сбрасываем, пока файлы не обработаны: иначе системная ссылка на файл может отпуститься раньше чтения
      addFiles(arr, function(){ try{ fileInput.value = ""; }catch(e){} });
    }
    fileInput.addEventListener("change", onPicked);
    fileInput.addEventListener("input", onPicked);
    q("deskDelPageBtn").addEventListener("click", function(){
      if(armed === "page"){ disarm(); deletePage(); return; }
      var n = page().items.length;
      arm("page", "deskDelPageBtn", data.pages.length > 1 ? "Нажмите ещё раз — страница удалится" : (n ? "Нажмите ещё раз — стол очистится" : "Это единственная страница"));
    });
    q("deskFrontBtn").addEventListener("click", function(){ if(selId) bringTo(selId, true); });
    q("deskBackBtn").addEventListener("click", function(){ if(selId) bringTo(selId, false); });
    q("deskDelItemBtn").addEventListener("click", function(){
      if(!selId) return;
      if(armed === "item"){ disarm(); deleteItem(selId); return; }
      arm("item", "deskDelItemBtn", "Нажмите ещё раз — картинка удалится");
    });
    if(!resizeBound){
      resizeBound = true;
      window.addEventListener("resize", function(){ if(rootEl()) relayout(); });
    }
  }

  function renderSettingsTabDesk(){
    if(!data) data = loadData();
    selId = null;
    gesture = null;
    armed = "";
    if(!renderShell()) return;
    renderPage(0);
    // размеры стола известны только после раскладки окна — подгоняем картинки ещё раз
    setTimeout(function(){ if(rootEl()) relayout(); }, 60);
  }

  return {
    renderSettingsTabDesk: renderSettingsTabDesk
  };
};
