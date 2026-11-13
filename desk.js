/* ===========================================================================
   desk.js
   Версия: 5.0 (13.11)
   Вкладка «Стол» (set2s_14, кнопка settingsTabSet2Btn14; в стеке второго набора стоит над «Изменением размера
   изображения»): несколько картинок рядом друг с другом, как на столе, и несколько страниц-«столов», которые
   листаются. Точка входа — window.initDeskModule(deps) → { renderSettingsTabDesk }; my.js зовёт её из switchSettingsTab.

   Что умеет: добавить картинки (кнопка «фото+», можно сразу несколько; новые встают на свободное место рядом с
   прежними); двигать картинку пальцем; менять размер — угловой кружок выбранной картинки или щипок двумя пальцами;
   «на передний/задний план»; удалить картинку/страницу (двойное нажатие); листать страницы кнопками ‹ › или
   свайпом по пустому месту стола; добавить страницу «+».
   Масштаб всего стола: щипок двумя пальцами по пустому месту (оба пальца не на выбранной картинке/рисунке) увеличивает и
   уменьшает стол вместе с картинками и рисунками (`Z`, слой `#deskZoom`, `applyZoom`), двумя пальцами же стол двигается;
   пока масштаб не 100 %, один палец по пустому месту тоже двигает стол (а не листает страницу), значок «NN %» справа
   вверху возвращает 100 %. Масштаб нигде не хранится. Координаты жестов (`localPoint`) пересчитаны в координаты стола
   (`x`/`y`), а сырые экранные — `rx`/`ry` (нужны самому жесту масштаба).

   Рисунки поверх стола (кнопка «фигуры» в нижнем ряду открывает панель инструментов): карандаш, линия, стрелка, квадрат,
   круг, треугольник, текст и палитра цвета. Рисунки лежат в отдельном слое над ВСЕМИ картинками страницы (`.desk-marks`,
   один SVG на страницу) и хранятся в `page.marks` (не в `items`); каждый рисунок — самостоятельный элемент: его можно
   выбрать нажатием на линию, двигать, менять размер (угловые кружки или щипок), перекрашивать и удалять (двойное нажатие).
   Геометрия — точки `p` в долях ширины стола (как x/y/w у картинок); у текста `p[0]` — левый верхний угол, `fs` — кегль в долях ширины.
   Кнопка «во весь экран» — самая правая в нижнем ряду (та же, что на других вкладках: handleFullscreenBtnTap из deps).

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
var MIN_ZOOM = 0.5;           // масштаб всего стола: наименьший и наибольший
var MAX_ZOOM = 5;
  var NEW_W = 0.3;              // ширина новой картинки, доля ширины стола
  var MIN_W = 0.14;             // наименьшая ширина картинки, доля ширины стола
  var SWIPE_MIN = 60;           // px — свайп по пустому месту листает страницу
  var ARM_MS = 2600;            // сколько секунд «взведено» двойное нажатие удаления
  var DECODE_MS = 12000;        // сколько ждём открытия картинки одним способом, мс
  var FILE_MS = 35000;          // сколько ждём одну картинку целиком, мс (дольше — сообщаем, на каком шаге застряли)
  var IDB_MS = 8000;            // сколько ждём IndexedDB, мс; не ответил — картинка идёт в запасное хранилище
  var PICK_KEY = "deskPickAt_v1"; // метка «выбор файла открыт»; осталась после перезагрузки страницы — приложение перезапустилось во время выбора
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

  ICON.draw = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="5"></circle><rect x="11" y="11" width="10" height="10" rx="1.5"></rect></svg>';
  ICON.pen = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8 19z"></path><path d="M14.5 6.5l3 3"></path></svg>';
  ICON.line = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5L19.5 4.5"></path></svg>';
  ICON.arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5L19 5"></path><path d="M10 5h9v9"></path></svg>';
  ICON.rect = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="1.5"></rect></svg>';
  ICON.circle = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle></svg>';
  ICON.tri = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5l8.5 15h-17z"></path></svg>';
  ICON.text = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 7V5h13v2"></path><path d="M12 5v14.5"></path><path d="M9 19.5h6"></path></svg>';

  var TOOLS = [
    ["pen", "Карандаш"], ["line", "Линия"], ["arrow", "Стрелка"], ["rect", "Квадрат"],
    ["circle", "Круг"], ["tri", "Треугольник"], ["text", "Текст"]
  ];
  var PALETTE = ["#000000", "#ffffff", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#5e35b1", "#d81b60", "#8d6e63", "#757575"];
  var MARK_KINDS = { pen: 1, line: 1, arrow: 1, rect: 1, circle: 1, tri: 1, text: 1 };
  var COLOR_KEY = "deskColor_v1";
  var DEF_COLOR = "#e53935";
  var MAX_MARKS = 300;          // рисунков на страницу
  var MAX_PEN_PTS = 1500;       // точек в одном штрихе карандаша
  var TEXT_FS = 0.06;           // кегль нового текста, доля ширины стола
  var HIT_PX = 16;              // допуск нажатия на линию рисунка, px
  var HANDLE_PX = 24;           // допуск нажатия на угловой кружок, px
  var MIN_MARK_PX = 24;         // наименьший размер рисунка при масштабировании, px

  // ---------------------------------------------------------------- данные
  var data = null;            // { v:1, cur:0, pages:[{id, items:[{id,x,y,w,ar}]}] }; порядок items = порядок наложения (последний сверху)
  var imgCache = {};          // id → data:URL (только для картинок текущей страницы)
  var selId = null;           // выбранная картинка
  var gesture = null;
  var Z = { z: 1, tx: 0, ty: 0 }; // масштаб и сдвиг всего стола (только показ, не хранится): экран = z * точка стола + (tx, ty)
  var lastTouchAt = 0;
  var saveTimer = null;
  var toastTimer = null;
  var armTimer = null;
  var armed = "";             // "item" | "page" — какая кнопка удаления сейчас «взведена»
  var resizeBound = false;
  var dbRef = null;
  var dbFailed = false;
  var pickWait = false;       // системный выбор файла открыт, ответа ещё нет
  var pickBound = false;
  var adding = false;         // идёт добавление картинок
  var selMark = null;         // выбранный рисунок (selId и selMark не бывают заняты одновременно)
  var tool = "";              // активный инструмент рисования: pen|line|arrow|rect|circle|tri|text или ""
  var drawOpen = false;       // панель инструментов открыта
  var paletteOpen = false;
  var curColor = DEF_COLOR;
  var marksRaf = 0;
  var sizeTimer = null;
  var lastSize = "";
  var dlgState = null;        // окно ввода текста: { mode:"new"|"edit", x, y, id }

  function dlog(t){ try{ if(window.Debug && window.Debug.log) window.Debug.log("Стол: " + t); }catch(e){} }

  function uid(){ return "d" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }

  function cleanMarks(ms){
    var out = [];
    if(!ms || !ms.length) return out;
    for(var i = 0; i < ms.length && out.length < MAX_MARKS; i++){
      var m = ms[i];
      if(!m || !m.id || !MARK_KINDS[m.k] || !m.p || !m.p.length) continue;
      var ok = true, pp = [];
      for(var j = 0; j < m.p.length && j < MAX_PEN_PTS; j++){
        var pt = m.p[j];
        if(!pt || !isFinite(pt[0]) || !isFinite(pt[1])){ ok = false; break; }
        pp.push([pt[0], pt[1]]);
      }
      if(!ok) continue;
      if(m.k === "text"){
        if(!(m.fs > 0) || typeof m.t !== "string" || !m.t) continue;
      } else if(m.k !== "pen" && pp.length < 2) continue;
      out.push({ id: String(m.id), k: m.k, c: typeof m.c === "string" && /^#[0-9a-f]{6}$/i.test(m.c) ? m.c : DEF_COLOR, p: pp, fs: m.fs, t: m.t });
    }
    return out;
  }

  function loadData(){
    var d = null;
    try{ d = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null"); }catch(e){ d = null; }
    if(!d || !d.pages || !d.pages.length){
      d = { v: 1, cur: 0, pages: [{ id: uid(), items: [], marks: [] }] };
    }
    if(typeof d.cur !== "number" || d.cur < 0 || d.cur >= d.pages.length) d.cur = 0;
    for(var p = 0; p < d.pages.length; p++){
      d.pages[p].marks = cleanMarks(d.pages[p].marks);
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
      "#deskTabRoot{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;color:var(--wood,#5b4a8a);}" +
      "#deskTabRoot .desk-bar{position:absolute;left:var(--fab-gap,6px);right:var(--fab-gap,6px);bottom:var(--fab-gap,6px);z-index:5;display:flex;align-items:center;gap:var(--fab-gap,6px);pointer-events:none;}" +
      "#deskTabRoot .desk-ib{flex:0 1 auto;min-width:28px;width:var(--fab-size,36px);height:var(--fab-size,36px);padding:8px;box-sizing:border-box;border-radius:8px;pointer-events:auto;" +
        "border:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:#fffef8;color:var(--wood,#5b4a8a);box-shadow:0 2px 6px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;" +
        "-webkit-tap-highlight-color:transparent;}" +
      "#deskTabRoot .desk-ib svg{width:100%;height:100%;}" +
      "#deskTabRoot .desk-ib[disabled]{opacity:.35;}" +
      "#deskTabRoot .desk-ib.armed{background:#c62828;border-color:#c62828;color:#fff;}" +
      "#deskTabRoot .desk-ib.on{background:#7F00FF;border-color:#7F00FF;color:#fff;}" +
      "#deskTabRoot .desk-dot{display:block;width:100%;height:100%;border-radius:50%;border:2px solid rgba(0,0,0,.4);box-sizing:border-box;}" +
      "#deskTabRoot .desk-dbar{position:absolute;left:var(--fab-gap,6px);right:var(--fab-gap,6px);bottom:calc(var(--fab-size,36px) + var(--fab-gap,6px) * 2);z-index:6;display:none;justify-content:flex-end;pointer-events:none;}" +
      "#deskTabRoot .desk-dbar.on{display:flex;}" +
      "#deskTabRoot .desk-dbar .desk-ib{margin-left:var(--fab-gap,6px);}" +
      "#deskTabRoot .desk-pal{position:absolute;right:var(--fab-gap,6px);bottom:calc(var(--fab-size,36px) + var(--fab-gap,6px) * 2 + 4px);z-index:7;display:none;width:244px;max-width:calc(100% - 12px);padding:8px;box-sizing:border-box;border-radius:10px;" +
        "border:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:#fffef8;box-shadow:0 2px 8px rgba(0,0,0,.35);}" +
      "#deskTabRoot .desk-pal.on{display:block;}" +
      "#deskTabRoot .desk-pal.up{bottom:calc(var(--fab-size,36px) * 2 + var(--fab-gap,6px) * 3 + 4px);}" +
      "#deskTabRoot .desk-sw{display:inline-block;vertical-align:top;width:30px;height:30px;margin:4px;border-radius:50%;box-sizing:border-box;border:2px solid rgba(0,0,0,.3);}" +
      "#deskTabRoot .desk-sw.cur{border:3px solid #7F00FF;}" +
      "#deskTabRoot .desk-marks{position:absolute;left:0;top:0;right:0;bottom:0;z-index:100000;pointer-events:none;}" +
      "#deskTabRoot .desk-marks svg{display:block;}" +
      "#deskTabRoot .desk-dlg{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30;display:none;background:rgba(0,0,0,.35);}" +
      "#deskTabRoot .desk-dlg.on{display:block;}" +
      "#deskTabRoot .desk-dlg-box{position:absolute;left:12px;right:12px;top:12%;padding:10px;box-sizing:border-box;border-radius:10px;background:#fffef8;box-shadow:0 3px 12px rgba(0,0,0,.45);}" +
      "#deskTabRoot .desk-dlg textarea{display:block;width:100%;min-height:84px;box-sizing:border-box;padding:8px;font-size:16px;line-height:1.35;border-radius:8px;resize:none;" +
        "border:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:#fff;color:#222;-webkit-user-select:text;user-select:text;}" +
      "#deskTabRoot .desk-dlg-btns{display:flex;justify-content:flex-end;margin-top:8px;}" +
      "#deskTabRoot .desk-dlg-btns button{height:36px;padding:0 16px;margin-left:8px;border-radius:8px;font-size:15px;border:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:#fffef8;color:var(--wood,#5b4a8a);}" +
      "#deskTabRoot .desk-dlg-btns button.ok{background:#7F00FF;border-color:#7F00FF;color:#fff;}" +
      "#deskTabRoot .desk-pg{flex:0 0 auto;min-width:var(--fab-size,36px);height:var(--fab-size,36px);padding:0 8px;box-sizing:border-box;border-radius:8px;display:flex;align-items:center;justify-content:center;" +
        "border:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:#fffef8;box-shadow:0 2px 6px rgba(0,0,0,.28);font-size:14px;font-weight:600;pointer-events:none;}" +
      "#deskTabRoot .desk-sp{flex:1 1 auto;min-width:0;}" +
      "#deskTabRoot .desk-tools{display:flex;flex:0 0 auto;align-items:center;gap:var(--fab-gap,6px);}" +
      "#deskTabRoot .desk-stage{position:relative;flex:1 1 auto;min-height:200px;overflow:hidden;background:rgba(127,127,127,.13);" +
        "-ms-touch-action:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}" +
      "#deskTabRoot .desk-zoom{position:absolute;left:0;top:0;right:0;bottom:0;-webkit-transform-origin:0 0;transform-origin:0 0;}" +
      "#deskTabRoot .desk-zoom-badge{position:absolute;top:8px;right:8px;z-index:7;display:none;padding:5px 10px;border-radius:14px;font-size:13px;font-weight:700;background:rgba(0,0,0,.65);color:#fff;-webkit-tap-highlight-color:transparent;}" +
      "#deskTabRoot .desk-sheet{position:absolute;left:0;top:0;right:0;bottom:0;}" +
      "#deskTabRoot .desk-item{position:absolute;box-sizing:border-box;background:#fff;box-shadow:0 2px 7px rgba(0,0,0,.38);}" +
      "#deskTabRoot .desk-item.sel{outline:2px solid #7F00FF;}" +
      "#deskTabRoot .desk-item img{display:block;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none;}" +
      "#deskTabRoot .desk-handle{position:absolute;right:0;bottom:0;width:34px;height:34px;}" +
      "#deskTabRoot .desk-handle:after{content:'';position:absolute;right:3px;bottom:3px;width:20px;height:20px;border-radius:50%;" +
        "background:#7F00FF;border:2px solid #fff;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.5);}" +
      "#deskTabRoot .desk-empty{position:absolute;left:0;right:0;top:40%;padding:0 20px;text-align:center;font-size:15px;line-height:1.45;opacity:.8;pointer-events:none;}" +
      "#deskTabRoot .desk-toast{position:absolute;left:10px;right:10px;bottom:calc(var(--fab-size,36px) + var(--fab-gap,6px) * 2 + 4px);padding:7px 10px;border-radius:8px;text-align:center;font-size:13px;" +
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
    var b1 = q("deskDelItemBtn"), b2 = q("deskDelPageBtn"), b3 = q("deskDelMarkBtn");
    if(b1) b1.className = "desk-ib";
    if(b2) b2.className = "desk-ib";
    if(b3) b3.className = "desk-ib";
  }
  function arm(kind, btnId, hint){
    disarm();
    armed = kind;
    var b = q(btnId);
    if(b) b.className = "desk-ib armed";
    toast(hint);
    armTimer = setTimeout(disarm, ARM_MS);
  }

  function toolButtonsHtml(){
    var h = "";
    for(var i = 0; i < TOOLS.length; i++){
      h += '<button type="button" class="desk-ib" data-tool="' + TOOLS[i][0] + '" id="deskTool_' + TOOLS[i][0] + '" title="' + TOOLS[i][1] + '">' + ICON[TOOLS[i][0]] + '</button>';
    }
    return h;
  }
  function paletteHtml(){
    var h = "";
    for(var i = 0; i < PALETTE.length; i++) h += '<span class="desk-sw" data-c="' + PALETTE[i] + '" style="background:' + PALETTE[i] + ';"></span>';
    return h;
  }

  function renderShell(){
    var c = q("settingsTabContent");
    if(!c) return false;
    ensureStyle();
    Z.z = 1; Z.tx = 0; Z.ty = 0;
    c.innerHTML =
      '<div id="' + ROOT_ID + '">' +
        '<div class="desk-stage" id="deskStage"><div class="desk-zoom" id="deskZoom"><div class="desk-sheet" id="deskSheet"></div></div>' +
          '<div class="desk-zoom-badge" id="deskZoomBadge">100%</div>' +
          '<div class="desk-empty" id="deskEmpty">Стол пуст.<br>Нажмите кнопку с картинкой и «+», чтобы выложить фото.</div>' +
          '<div class="desk-toast" id="deskToast"></div>' +
        '</div>' +
        '<div class="desk-dbar" id="deskDrawBar">' + toolButtonsHtml() +
          '<button type="button" class="desk-ib" id="deskColorBtn" title="Цвет"></button>' +
        '</div>' +
        '<div class="desk-pal" id="deskPalette">' + paletteHtml() + '</div>' +
        '<div class="desk-dlg" id="deskDlg"><div class="desk-dlg-box">' +
          '<textarea id="deskDlgText" rows="3" maxlength="400" placeholder="Текст"></textarea>' +
          '<div class="desk-dlg-btns"><button type="button" id="deskDlgCancel">Отмена</button><button type="button" class="ok" id="deskDlgOk">Готово</button></div>' +
        '</div></div>' +
        '<div class="desk-bar">' +
          '<button type="button" class="desk-ib" id="deskPrevBtn" title="Предыдущая страница">' + ICON.prev + '</button>' +
          '<div class="desk-pg" id="deskPageNum"></div>' +
          '<button type="button" class="desk-ib" id="deskNextBtn" title="Следующая страница">' + ICON.next + '</button>' +
          '<div class="desk-sp"></div>' +
          '<div class="desk-tools" id="deskPageTools">' +
            '<button type="button" class="desk-ib" id="deskDrawBtn" title="Рисование">' + ICON.draw + '</button>' +
            '<button type="button" class="desk-ib" id="deskAddImgBtn" title="Добавить картинки">' + ICON.addImg + '</button>' +
            '<button type="button" class="desk-ib" id="deskAddPageBtn" title="Новая страница">' + ICON.addPage + '</button>' +
            '<button type="button" class="desk-ib" id="deskDelPageBtn" title="Удалить страницу">' + ICON.trash + '</button>' +
          '</div>' +
          '<div class="desk-tools" id="deskItemTools" style="display:none;">' +
            '<button type="button" class="desk-ib" id="deskFrontBtn" title="На передний план">' + ICON.front + '</button>' +
            '<button type="button" class="desk-ib" id="deskBackBtn" title="На задний план">' + ICON.back + '</button>' +
            '<button type="button" class="desk-ib" id="deskDelItemBtn" title="Удалить картинку">' + ICON.trash + '</button>' +
          '</div>' +
          '<div class="desk-tools" id="deskMarkTools" style="display:none;">' +
            '<button type="button" class="desk-ib" id="deskMarkColorBtn" title="Цвет"></button>' +
            '<button type="button" class="desk-ib" id="deskMarkEditBtn" title="Изменить текст" style="display:none;">' + ICON.text + '</button>' +
            '<button type="button" class="desk-ib" id="deskDelMarkBtn" title="Удалить рисунок">' + ICON.trash + '</button>' +
          '</div>' +
          '<button type="button" class="desk-ib fullscreen-mode-btn" id="deskFullscreenBtn" title="Полноэкранный режим"></button>' +
        '</div>' +
        '<input type="file" id="deskFileInput" accept="image/*" style="display:none;">' +
      '</div>';
    bindShell();
    return true;
  }

  function stageSize(){
    var s = stageEl();
    return { w: s ? s.clientWidth : 0, h: s ? s.clientHeight : 0 };
  }

  // Масштаб всего стола. Слой #deskZoom (внутри — лист с картинками и рисунками) сдвигается и растягивается как есть;
  // данные и размеры картинок не меняются.
  function clampZoom(){
    var sz = stageSize();
    Z.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Z.z));
    var ex = sz.w * (1 - Z.z), ey = sz.h * (1 - Z.z);
    Z.tx = Math.max(Math.min(0, ex), Math.min(Math.max(0, ex), Z.tx));
    Z.ty = Math.max(Math.min(0, ey), Math.min(Math.max(0, ey), Z.ty));
  }
  function zoomed(){ return Math.abs(Z.z - 1) > 0.02; }
  function applyZoom(){
    var el = q("deskZoom");
    if(!el) return;
    clampZoom();
    var tr = (!zoomed() && Math.abs(Z.tx) < 0.5 && Math.abs(Z.ty) < 0.5) ? "" : "translate(" + Z.tx.toFixed(1) + "px," + Z.ty.toFixed(1) + "px) scale(" + Z.z.toFixed(4) + ")";
    el.style.webkitTransform = tr;
    el.style.transform = tr;
    var b = q("deskZoomBadge");
    if(b){
      b.style.display = zoomed() ? "block" : "none";
      b.innerHTML = Math.round(Z.z * 100) + "%";
    }
  }
  function resetZoom(){ Z.z = 1; Z.tx = 0; Z.ty = 0; applyZoom(); }

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
      if(!el.getAttribute || !el.getAttribute("data-id")) continue; // слой рисунков
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
    var pt = q("deskPageTools"), itl = q("deskItemTools"), mt = q("deskMarkTools");
    if(pt) pt.style.display = (selId || selMark) ? "none" : "flex";
    if(itl) itl.style.display = selId ? "flex" : "none";
    if(mt) mt.style.display = selMark ? "flex" : "none";
    var sm = selMark ? findMark(selMark) : null;
    var eb = q("deskMarkEditBtn");
    if(eb) eb.style.display = (sm && sm.k === "text") ? "" : "none";
    syncColorBtns();
    disarm();
    renderMarks();
  }

  function updateBar(){
    var n = q("deskPageNum");
    if(n) n.textContent = (data.cur + 1) + " / " + data.pages.length;
    var p = q("deskPrevBtn"), nx = q("deskNextBtn");
    if(p) p.disabled = data.cur <= 0;
    if(nx) nx.disabled = data.cur >= data.pages.length - 1;
    var em = q("deskEmpty");
    if(em) em.style.display = (page().items.length || page().marks.length) ? "none" : "";
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

    sh.innerHTML = '<div class="desk-marks" id="deskMarks"></div>';
    for(var i = 0; i < its.length; i++){
      var el = makeItemEl(its[i]);
      applyRect(el, rectOf(its[i], sz.w, sz.h));
      el.style.zIndex = String(i + 1);
      sh.appendChild(el);
      if(imgCache[its[i].id]) setImgSrc(its[i].id);
      else loadImage(its[i].id);
    }
    if(selId && !findItem(selId)) selId = null;
    if(selMark && !findMark(selMark)) selMark = null;
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
    renderMarks();
    applyZoom();
  }

  // ---------------------------------------------------------------- страницы
  function gotoPage(n, dir){
    if(n < 0 || n >= data.pages.length || n === data.cur) return;
    data.cur = n;
    selId = null; selMark = null;
    saveSoon();
    renderPage(dir || 1);
  }
  function addPage(){
    if(data.pages.length >= MAX_PAGES){ toast("Больше " + MAX_PAGES + " страниц не поместится."); return; }
    data.pages.splice(data.cur + 1, 0, { id: uid(), items: [], marks: [] });
    data.cur++;
    selId = null; selMark = null;
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
      pg.marks = [];
    } else {
      data.pages.splice(data.cur, 1);
      if(data.cur >= data.pages.length) data.cur = data.pages.length - 1;
    }
    selId = null; selMark = null;
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
    if(selId === id && !selMark) return;
    selId = id;
    selMark = null;
    syncSelectionView();
  }
  function selectMark(id){
    if(selMark === id && !selId) return;
    selMark = id;
    selId = null;
    syncSelectionView();
  }
  function clearSel(){
    if(!selId && !selMark) return;
    selId = null;
    selMark = null;
    syncSelectionView();
  }

  // ---------------------------------------------------------------- рисунки поверх стола
  function findMark(id){
    var ms = page().marks;
    for(var i = 0; i < ms.length; i++) if(ms[i].id === id) return ms[i];
    return null;
  }
  function cloneMark(m){
    var c = { id: m.id, k: m.k, c: m.c, p: [], fs: m.fs, t: m.t };
    for(var i = 0; i < m.p.length; i++) c.p.push([m.p[i][0], m.p[i][1]]);
    return c;
  }
  function r4(v){ return Math.round(v * 10000) / 10000; }
  function n1(v){ return Math.round(v * 10) / 10; }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function strokeW(W){ return clamp(W * 0.011, 3, 7); }

  var measureCtx = null;
  function textSize(m, W){
    var fs = m.fs * W, lines = String(m.t || "").split("\n"), mw = 0, i;
    try{
      if(!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
      measureCtx.font = "600 " + fs + "px sans-serif";
      for(i = 0; i < lines.length; i++) mw = Math.max(mw, measureCtx.measureText(lines[i]).width);
    }catch(e){
      for(i = 0; i < lines.length; i++) mw = Math.max(mw, lines[i].length * fs * 0.58);
    }
    return { w: Math.max(mw, fs * 0.6), h: lines.length * fs * 1.2 };
  }
  function ptsPx(m, W){
    var out = [];
    for(var i = 0; i < m.p.length; i++) out.push({ x: m.p[i][0] * W, y: m.p[i][1] * W });
    return out;
  }
  function bboxPx(m, W){
    if(m.k === "text"){
      var ts = textSize(m, W);
      return { x: m.p[0][0] * W, y: m.p[0][1] * W, w: ts.w, h: ts.h };
    }
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for(var i = 0; i < m.p.length; i++){
      var x = m.p[i][0] * W, y = m.p[i][1] * W;
      if(x < x0) x0 = x; if(x > x1) x1 = x;
      if(y < y0) y0 = y; if(y > y1) y1 = y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // --- попадание пальцем
  function segDist(p, a, b){
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = 0;
    if(l2 > 0) t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
    var x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
    return Math.sqrt(x * x + y * y);
  }
  function polyDist(p, V, closed){
    var best = 1e9, n = V.length;
    for(var i = 0; i < n - 1; i++) best = Math.min(best, segDist(p, V[i], V[i + 1]));
    if(closed && n > 2) best = Math.min(best, segDist(p, V[n - 1], V[0]));
    return best;
  }
  function inRect(p, b, pad){
    return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
  }
  function hitOne(m, pt, W){
    var k = m.k, b = bboxPx(m, W), P = ptsPx(m, W), T = HIT_PX;
    if(k === "text") return inRect(pt, b, 6);
    if(k === "line" || k === "arrow") return segDist(pt, P[0], P[1]) <= T;
    if(k === "pen") return P.length === 1 ? segDist(pt, P[0], P[0]) <= T : polyDist(pt, P, false) <= T;
    if(b.w < T * 2 && b.h < T * 2) return inRect(pt, b, T);
    if(k === "rect") return polyDist(pt, [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], true) <= T;
    if(k === "tri") return polyDist(pt, [{ x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], true) <= T;
    if(k === "circle"){
      var rx = Math.max(b.w / 2, 1), ry = Math.max(b.h / 2, 1);
      var nx = (pt.x - (b.x + rx)) / rx, ny = (pt.y - (b.y + ry)) / ry;
      return Math.abs(Math.sqrt(nx * nx + ny * ny) - 1) * Math.min(rx, ry) <= T;
    }
    return false;
  }
  function hitMark(pt, W){
    var ms = page().marks;
    for(var i = ms.length - 1; i >= 0; i--) if(hitOne(ms[i], pt, W)) return ms[i];
    return null;
  }

  // Кружки выбранного рисунка: у фигур по двум точкам — на самих точках (h = 0/1), у карандаша и текста — «s» в углу рамки.
  function markHandles(m, W){
    var P = ptsPx(m, W);
    if(m.k === "pen" || m.k === "text"){
      var b = bboxPx(m, W), sz = stageSize();
      return [{ h: "s", x: sz.w > 0 ? Math.min(b.x + b.w + 8, sz.w - 10) : b.x + b.w + 8, y: sz.h > 0 ? Math.min(b.y + b.h + 8, sz.h - 10) : b.y + b.h + 8 }];
    }
    return [{ h: 0, x: P[0].x, y: P[0].y }, { h: 1, x: P[1].x, y: P[1].y }];
  }
  function handleAt(m, pt, W){
    var hs = markHandles(m, W), best = null, bd = HANDLE_PX;
    for(var i = 0; i < hs.length; i++){
      var dx = hs[i].x - pt.x, dy = hs[i].y - pt.y, d = Math.sqrt(dx * dx + dy * dy);
      if(d <= bd){ bd = d; best = hs[i].h; }
    }
    return best;
  }

  // --- отрисовка (один SVG на страницу; пересобирается целиком, не чаще кадра)
  function shapeSvg(m, P, W, sw, col, halo){
    var s = "", i, k = m.k;
    var st = ' fill="none" stroke="' + col + '" stroke-width="' + n1(sw) + '" stroke-linecap="round" stroke-linejoin="round"';
    if(k === "line" || k === "arrow"){
      s += '<line x1="' + n1(P[0].x) + '" y1="' + n1(P[0].y) + '" x2="' + n1(P[1].x) + '" y2="' + n1(P[1].y) + '"' + st + '/>';
      if(k === "arrow"){
        var dx = P[1].x - P[0].x, dy = P[1].y - P[0].y, len = Math.sqrt(dx * dx + dy * dy);
        if(len > 1){
          var a = Math.atan2(dy, dx), L = Math.min(14 + sw * 2, len * 0.6);
          s += '<path d="M' + n1(P[1].x - L * Math.cos(a - 0.5)) + ' ' + n1(P[1].y - L * Math.sin(a - 0.5)) +
            'L' + n1(P[1].x) + ' ' + n1(P[1].y) +
            'L' + n1(P[1].x - L * Math.cos(a + 0.5)) + ' ' + n1(P[1].y - L * Math.sin(a + 0.5)) + '"' + st + '/>';
        }
      }
    } else if(k === "rect" || k === "circle" || k === "tri"){
      var b = bboxPx(m, W);
      if(k === "rect"){
        s += '<rect x="' + n1(b.x) + '" y="' + n1(b.y) + '" width="' + n1(b.w) + '" height="' + n1(b.h) + '"' + st + '/>';
      } else if(k === "circle"){
        s += '<ellipse cx="' + n1(b.x + b.w / 2) + '" cy="' + n1(b.y + b.h / 2) + '" rx="' + n1(b.w / 2) + '" ry="' + n1(b.h / 2) + '"' + st + '/>';
      } else {
        s += '<polygon points="' + n1(b.x + b.w / 2) + ',' + n1(b.y) + ' ' + n1(b.x + b.w) + ',' + n1(b.y + b.h) + ' ' + n1(b.x) + ',' + n1(b.y + b.h) + '"' + st + '/>';
      }
    } else if(k === "pen"){
      if(P.length === 1){
        s += '<circle cx="' + n1(P[0].x) + '" cy="' + n1(P[0].y) + '" r="' + n1(sw / 2) + '" fill="' + col + '"/>';
      } else {
        var d = "M" + n1(P[0].x) + " " + n1(P[0].y);
        for(i = 1; i < P.length - 1; i++){
          d += "Q" + n1(P[i].x) + " " + n1(P[i].y) + " " + n1((P[i].x + P[i + 1].x) / 2) + " " + n1((P[i].y + P[i + 1].y) / 2);
        }
        d += "L" + n1(P[P.length - 1].x) + " " + n1(P[P.length - 1].y);
        s += '<path d="' + d + '"' + st + '/>';
      }
    } else if(k === "text"){
      var fs = m.fs * W, lines = String(m.t || "").split("\n");
      s += '<text font-size="' + n1(fs) + '" font-weight="600" font-family="sans-serif" fill="' + col + '"' +
        (halo ? ' stroke="#444" stroke-width="3" stroke-linejoin="round"' : '') + '>';
      for(i = 0; i < lines.length; i++){
        s += '<tspan x="' + n1(P[0].x) + '" y="' + n1(P[0].y + fs * (0.9 + 1.2 * i)) + '">' + esc(lines[i]) + '</tspan>';
      }
      s += '</text>';
    }
    return s;
  }
  function markSvg(m, W, sw){
    var P = ptsPx(m, W), col = m.c || DEF_COLOR, out = "";
    if(col.toLowerCase() === "#ffffff") out += shapeSvg(m, P, W, sw + 3, "#444444", true); // тёмная подложка, чтобы белое было видно на светлом
    return out + shapeSvg(m, P, W, sw, col, false);
  }
  function selectionSvg(m, W){
    var b = bboxPx(m, W), s = "", hs = markHandles(m, W), pad = 8;
    s += '<rect x="' + n1(b.x - pad) + '" y="' + n1(b.y - pad) + '" width="' + n1(b.w + pad * 2) + '" height="' + n1(b.h + pad * 2) + '" fill="none" stroke="#7F00FF" stroke-width="1.5" stroke-dasharray="5 4"/>';
    for(var i = 0; i < hs.length; i++){
      s += '<circle cx="' + n1(hs[i].x) + '" cy="' + n1(hs[i].y) + '" r="9" fill="#7F00FF" stroke="#ffffff" stroke-width="2"/>';
    }
    return s;
  }
  function renderMarks(){
    var host = q("deskMarks");
    if(!host) return;
    var sz = stageSize();
    if(sz.w <= 0 || sz.h <= 0) return;
    var ms = page().marks, sw = strokeW(sz.w), html = "";
    for(var i = 0; i < ms.length; i++) html += markSvg(ms[i], sz.w, sw);
    var sm = selMark ? findMark(selMark) : null;
    if(sm) html += selectionSvg(sm, sz.w);
    host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz.w + '" height="' + sz.h + '" viewBox="0 0 ' + sz.w + ' ' + sz.h + '">' + html + '</svg>';
  }
  function scheduleMarks(){
    if(marksRaf) return;
    var run = function(){ marksRaf = 0; renderMarks(); };
    marksRaf = (window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 16)) || 1;
  }

  // --- правка рисунка
  // Целиком внутрь стола (только сдвигом).
  function fitMarkIntoStage(m, sz){
    var b = bboxPx(m, sz.w), dx = 0, dy = 0;
    if(b.x < 0) dx = -b.x; else if(b.x + b.w > sz.w) dx = sz.w - b.x - b.w;
    if(b.y < 0) dy = -b.y; else if(b.y + b.h > sz.h) dy = sz.h - b.y - b.h;
    if(!dx && !dy) return;
    for(var i = 0; i < m.p.length; i++) m.p[i] = [r4(m.p[i][0] + dx / sz.w), r4(m.p[i][1] + dy / sz.w)];
  }
  function translateMark(m, orig, dx, dy, sz){
    var b = bboxPx(orig, sz.w), nx = b.x + dx, ny = b.y + dy;
    if(b.w <= sz.w) nx = clamp(nx, 0, sz.w - b.w);
    if(b.h <= sz.h) ny = clamp(ny, 0, sz.h - b.h);
    var ddx = (nx - b.x) / sz.w, ddy = (ny - b.y) / sz.w;
    for(var i = 0; i < orig.p.length; i++) m.p[i] = [r4(orig.p[i][0] + ddx), r4(orig.p[i][1] + ddy)];
  }
  // Равномерное масштабирование относительно точки (cx, cy), px.
  function scaleMark(m, orig, s, cx, cy, sz){
    for(var i = 0; i < orig.p.length; i++){
      m.p[i] = [r4((cx + (orig.p[i][0] * sz.w - cx) * s) / sz.w), r4((cy + (orig.p[i][1] * sz.w - cy) * s) / sz.w)];
    }
    if(orig.k === "text") m.fs = r4(orig.fs * s);
  }
  function scaleLimits(orig, sz, maxByStage){
    var b = bboxPx(orig, sz.w), big = Math.max(b.w, b.h, 1);
    var minS = Math.min(1, MIN_MARK_PX / big);
    var maxS = maxByStage ? Math.min(maxByStage.w / Math.max(b.w, 1), maxByStage.h / Math.max(b.h, 1)) : 1e9;
    if(orig.k === "text") maxS = Math.min(maxS, 0.4 / orig.fs);
    return { min: minS, max: Math.max(minS, maxS) };
  }

  function deleteMark(id){
    var ms = page().marks;
    for(var i = 0; i < ms.length; i++){ if(ms[i].id === id){ ms.splice(i, 1); break; } }
    selMark = null;
    syncSelectionView();
    updateBar();
    saveNow();
  }

  // --- жесты рисунков. beginMarkGesture: true — касание забрали рисунки (выбор, перенос, кружок, новый штрих).
  function beginMarkGesture(p, sz){
    var sm = selMark ? findMark(selMark) : null;
    if(sm){
      var h = handleAt(sm, p, sz.w);
      if(h !== null){
        gesture = { type: "mhandle", id: sm.id, h: h, sx: p.x, sy: p.y, orig: cloneMark(sm), moved: false };
        return true;
      }
      // без инструмента нажатие внутри рамки двигает выбранный рисунок; с инструментом — только по самой линии (иначе не нарисовать рядом)
      if(!tool && (hitOne(sm, p, sz.w) || inRect(p, bboxPx(sm, sz.w), 8))){
        gesture = { type: "mmove", id: sm.id, sx: p.x, sy: p.y, orig: cloneMark(sm), moved: false, wasSel: true };
        return true;
      }
    }
    if(tool){
      startDraw(p, sz);
      return true;
    }
    var hm = hitMark(p, sz.w);
    if(hm){
      selectMark(hm.id);
      gesture = { type: "mmove", id: hm.id, sx: p.x, sy: p.y, orig: cloneMark(hm), moved: false, wasSel: false };
      return true;
    }
    return false;
  }

  function startDraw(p, sz){
    if(tool === "text"){
      gesture = { type: "text", sx: p.x, sy: p.y, moved: false };
      return;
    }
    var ms = page().marks;
    if(ms.length >= MAX_MARKS){ toast("На странице уже " + MAX_MARKS + " рисунков."); gesture = { type: "text", sx: p.x, sy: p.y, moved: true }; return; }
    var x = r4(clamp(p.x, 0, sz.w) / sz.w), y = r4(clamp(p.y, 0, sz.h) / sz.w);
    var m = { id: uid(), k: tool, c: curColor, p: [[x, y]] };
    if(tool !== "pen") m.p.push([x, y]);
    ms.push(m);
    if(selMark){ selMark = null; syncSelectionView(); }
    gesture = { type: "draw", id: m.id, lx: p.x, ly: p.y, sx: p.x, sy: p.y, len: 0, moved: false };
    scheduleMarks();
  }

  function moveMarkGesture(g, pts, sz){
    var p = pts[0], m, dx, dy;
    if(g.type === "text"){
      if(Math.abs(p.x - g.sx) > 8 || Math.abs(p.y - g.sy) > 8) g.moved = true;
      return;
    }
    m = findMark(g.id);
    if(!m) return;
    if(g.type === "draw"){
      var cx = clamp(p.x, 0, sz.w), cy = clamp(p.y, 0, sz.h);
      if(m.k === "pen"){
        var ddx = cx - g.lx, ddy = cy - g.ly, dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if(dd >= 2.5 && m.p.length < MAX_PEN_PTS){
          m.p.push([r4(cx / sz.w), r4(cy / sz.w)]);
          g.lx = cx; g.ly = cy; g.len += dd;
        }
      } else {
        m.p[1] = [r4(cx / sz.w), r4(cy / sz.w)];
        var sx0 = m.p[0][0] * sz.w - cx, sy0 = m.p[0][1] * sz.w - cy;
        g.len = Math.sqrt(sx0 * sx0 + sy0 * sy0);
      }
      g.moved = true;
      scheduleMarks();
      return;
    }
    if(g.type === "mpinch"){
      if(pts.length < 2) return;
      var b0 = bboxPx(g.orig, sz.w), lim = scaleLimits(g.orig, sz, { w: sz.w, h: sz.h });
      var s = clamp(dist(pts[0], pts[1]) / g.d0, lim.min, lim.max);
      scaleMark(m, g.orig, s, b0.x + b0.w / 2, b0.y + b0.h / 2, sz);
      fitMarkIntoStage(m, sz);
      g.moved = true;
      scheduleMarks();
      return;
    }
    dx = p.x - g.sx; dy = p.y - g.sy;
    if(Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true;
    if(!g.moved) return;
    if(g.type === "mmove"){
      translateMark(m, g.orig, dx, dy, sz);
    } else if(g.h === "s"){ // карандаш и текст: масштаб от левого верхнего угла рамки по проекции смещения на диагональ
      var b = bboxPx(g.orig, sz.w), den = b.w * b.w + b.h * b.h;
      var lim2 = scaleLimits(g.orig, sz, { w: Math.max(1, sz.w - b.x), h: Math.max(1, sz.h - b.y) });
      var s2 = clamp(1 + (den > 0 ? (dx * b.w + dy * b.h) / den : 0), lim2.min, lim2.max);
      scaleMark(m, g.orig, s2, b.x, b.y, sz);
    } else { // фигура: тянем одну из двух точек
      m.p[g.h] = [r4(clamp(p.x, 0, sz.w) / sz.w), r4(clamp(p.y, 0, sz.h) / sz.w)];
    }
    scheduleMarks();
  }

  function removeMarkQuiet(id){
    var ms = page().marks;
    for(var i = 0; i < ms.length; i++){ if(ms[i].id === id){ ms.splice(i, 1); return; } }
  }
  function abortDraw(){
    var g = gesture;
    gesture = null;
    if(g && g.type === "draw") removeMarkQuiet(g.id);
    renderMarks();
  }

  function endMarkGesture(g){
    var sz = stageSize();
    if(g.type === "text"){
      if(!g.moved && tool === "text"){
        openTextDlg({ mode: "new", x: clamp(g.sx, 0, sz.w), y: clamp(g.sy, 0, sz.h) });
      }
      return;
    }
    if(g.type === "draw"){
      var m = findMark(g.id);
      if(!m) return;
      var tiny = (m.k === "pen") ? g.len < 3 : g.len < 10;
      if(tiny){ removeMarkQuiet(g.id); renderMarks(); updateBar(); return; }
      updateBar();
      saveNow();
      if(m.k !== "pen"){ tool = ""; syncDrawUi(); selectMark(m.id); } // фигура: инструмент сам выключается, рисунок выбран — сразу можно поправить
      else renderMarks();
      return;
    }
    if(g.moved){ saveNow(); renderMarks(); return; }
    // нажатие на уже выбранный текст без сдвига — правка текста
    if(g.type === "mmove" && g.wasSel){
      var tm = findMark(g.id);
      if(tm && tm.k === "text") openTextDlg({ mode: "edit", id: tm.id });
    }
  }

  // --- текст
  function openTextDlg(st){
    var dlg = q("deskDlg"), ta = q("deskDlgText");
    if(!dlg || !ta) return;
    dlgState = st;
    var cur = "";
    if(st.mode === "edit"){ var m = findMark(st.id); cur = m ? m.t : ""; }
    ta.value = cur;
    dlg.className = "desk-dlg on";
    setTimeout(function(){ try{ ta.focus(); }catch(e){} }, 60);
  }
  function closeTextDlg(){
    var dlg = q("deskDlg"), ta = q("deskDlgText");
    if(ta){ try{ ta.blur(); }catch(e){} }
    if(dlg) dlg.className = "desk-dlg";
    dlgState = null;
  }
  function okTextDlg(){
    var ta = q("deskDlgText"), st = dlgState;
    var txt = ta ? String(ta.value || "").replace(/\s+$/, "") : "";
    closeTextDlg();
    if(!st || !txt.replace(/\s/g, "")) return;
    var sz = stageSize();
    if(st.mode === "edit"){
      var m = findMark(st.id);
      if(!m) return;
      m.t = txt;
      fitMarkIntoStage(m, sz);
      saveNow();
      renderMarks();
      return;
    }
    if(page().marks.length >= MAX_MARKS){ toast("На странице уже " + MAX_MARKS + " рисунков."); return; }
    var nm = { id: uid(), k: "text", c: curColor, p: [[r4(st.x / sz.w), r4(st.y / sz.w)]], fs: TEXT_FS, t: txt };
    fitMarkIntoStage(nm, sz);
    page().marks.push(nm);
    tool = "";
    syncDrawUi();
    updateBar();
    saveNow();
    selectMark(nm.id);
  }

  // --- панель инструментов и палитра
  function swatchHtml(c){ return '<span class="desk-dot" style="background:' + c + ';"></span>'; }
  function syncColorBtns(){
    var sm = selMark ? findMark(selMark) : null;
    var c = sm ? sm.c : curColor;
    var a = q("deskColorBtn"), b = q("deskMarkColorBtn");
    if(a) a.innerHTML = swatchHtml(c);
    if(b) b.innerHTML = swatchHtml(c);
    var pal = q("deskPalette");
    if(pal){
      var kids = pal.childNodes;
      for(var i = 0; i < kids.length; i++){
        if(kids[i].getAttribute) kids[i].className = "desk-sw" + (kids[i].getAttribute("data-c") === c ? " cur" : "");
      }
    }
  }
  function syncDrawUi(){
    var bar = q("deskDrawBar"), btn = q("deskDrawBtn"), pal = q("deskPalette");
    if(bar) bar.className = "desk-dbar" + (drawOpen ? " on" : "");
    if(btn) btn.className = "desk-ib" + (drawOpen ? " on" : "");
    for(var i = 0; i < TOOLS.length; i++){
      var tb = q("deskTool_" + TOOLS[i][0]);
      if(tb) tb.className = "desk-ib" + (tool === TOOLS[i][0] ? " on" : "");
    }
    if(pal) pal.className = "desk-pal" + (paletteOpen ? " on" : "") + (drawOpen ? " up" : "");
    syncColorBtns();
  }
  function setPalette(on){
    paletteOpen = !!on;
    syncDrawUi();
  }
  function setTool(k){
    tool = (tool === k) ? "" : k;
    if(tool){ clearSel(); paletteOpen = false; }
    syncDrawUi();
    if(tool === "text") toast("Нажмите на стол там, где нужен текст", 2600);
  }
  function setColor(c){
    curColor = c;
    try{ localStorage.setItem(COLOR_KEY, c); }catch(e){}
    var sm = selMark ? findMark(selMark) : null;
    if(sm){ sm.c = c; saveNow(); renderMarks(); }
    paletteOpen = false;
    syncDrawUi();
  }

  function startSizeWatch(){
    if(sizeTimer) clearInterval(sizeTimer);
    lastSize = "";
    // стол меняет размер без события resize (полноэкранный режим, клавиатура) — следим сами
    sizeTimer = setInterval(function(){
      if(!rootEl()){ clearInterval(sizeTimer); sizeTimer = null; return; }
      var sz = stageSize(), key = sz.w + "x" + sz.h;
      if(key !== lastSize){ lastSize = key; relayout(); }
    }, 350);
  }

  function bindMarkUi(){
    q("deskDrawBtn").addEventListener("click", function(){
      drawOpen = !drawOpen;
      if(!drawOpen){ tool = ""; paletteOpen = false; }
      syncDrawUi();
    });
    for(var i = 0; i < TOOLS.length; i++){
      (function(k){ q("deskTool_" + k).addEventListener("click", function(){ setTool(k); }); })(TOOLS[i][0]);
    }
    q("deskColorBtn").addEventListener("click", function(){ setPalette(!paletteOpen); });
    q("deskMarkColorBtn").addEventListener("click", function(){ setPalette(!paletteOpen); });
    q("deskPalette").addEventListener("click", function(e){
      var t = e.target, c = t && t.getAttribute ? t.getAttribute("data-c") : null;
      if(c) setColor(c);
    });
    q("deskMarkEditBtn").addEventListener("click", function(){
      var m = selMark ? findMark(selMark) : null;
      if(m && m.k === "text") openTextDlg({ mode: "edit", id: m.id });
    });
    q("deskDelMarkBtn").addEventListener("click", function(){
      if(!selMark) return;
      if(armed === "mark"){ disarm(); deleteMark(selMark); return; }
      arm("mark", "deskDelMarkBtn", "Нажмите ещё раз — рисунок удалится");
    });
    q("deskDlgOk").addEventListener("click", okTextDlg);
    q("deskDlgCancel").addEventListener("click", closeTextDlg);
    var fsb = q("deskFullscreenBtn");
    if(fsb){
      if(deps && deps.handleFullscreenBtnTap && deps.bindTapOrHold){
        var fsOn = deps.getHideStatusBarEnabled ? deps.getHideStatusBarEnabled() : false;
        fsb.innerHTML = fsOn ? deps.FULLSCREEN_MODE_ON_ICON_SVG : deps.FULLSCREEN_MODE_ICON_SVG;
        fsb.title = fsOn ? "Выйти из полноэкранного режима" : "Полноэкранный режим";
        fsb.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
        deps.bindTapOrHold(fsb, function(){
          deps.handleFullscreenBtnTap();
          var delays = [120, 450, 1000];
          for(var d = 0; d < delays.length; d++) setTimeout(function(){ if(rootEl()) relayout(); }, delays[d]);
        }, function(){});
      } else {
        fsb.style.display = "none";
      }
    }
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
    var rx = p.clientX - r.left, ry = p.clientY - r.top;
    // x, y — в координатах стола (с учётом масштаба), rx, ry — на экране относительно стола
    return { x: (rx - Z.tx) / Z.z, y: (ry - Z.ty) / Z.z, rx: rx, ry: ry };
  }
  function dist(a, b){
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // targets — элементы под пальцами (для щипка): по ним видно, на выбранной ли картинке пальцы
  function beginGesture(pts, target, targets){
    var sz = stageSize();
    if(pts.length >= 2){
      var smp = selMark ? findMark(selMark) : null;
      if(smp){
        var bb = bboxPx(smp, sz.w), onMark = false;
        for(var mi = 0; mi < 2; mi++) if(pts[mi].x >= bb.x - 30 && pts[mi].x <= bb.x + bb.w + 30 && pts[mi].y >= bb.y - 30 && pts[mi].y <= bb.y + bb.h + 30) onMark = true;
        if(onMark){
          gesture = { type: "mpinch", id: smp.id, d0: Math.max(10, dist(pts[0], pts[1])), orig: cloneMark(smp), moved: false };
          return;
        }
      }
      // щипок: масштабируем выбранную картинку (или ту, на которой начат жест), если хоть один палец на ней
      var id = selId || (gesture && gesture.id);
      var it = id ? findItem(id) : null;
      var onIt = false;
      if(it && targets){
        for(var ti = 0; ti < targets.length; ti++){
          var hel = hitItem(targets[ti]);
          if(hel && hel.getAttribute("data-id") === id) onIt = true;
        }
      }
      if(it && (onIt || !targets)){
        var r = rectOf(it, sz.w, sz.h);
        gesture = { type: "pinch", id: id, d0: Math.max(10, dist(pts[0], pts[1])), r0: r };
        return;
      }
      // иначе — масштаб и сдвиг всего стола
      gesture = { type: "zoom", d0: Math.max(10, rawDist(pts[0], pts[1])), z0: Z.z, tx0: Z.tx, ty0: Z.ty, mx0: (pts[0].rx + pts[1].rx) / 2, my0: (pts[0].ry + pts[1].ry) / 2 };
      return;
    }
    var p = pts[0];
    if(beginMarkGesture(p, sz)) return;
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
    if(zoomed()){ gesture = { type: "pan", sx: p.rx, sy: p.ry, tx0: Z.tx, ty0: Z.ty, moved: false }; return; } // стол увеличен/уменьшен — палец двигает стол
    gesture = { type: "swipe", sx: p.x, sy: p.y, moved: false, dx: 0, dy: 0 };
  }
  function rawDist(a, b){ var dx = a.rx - b.rx, dy = a.ry - b.ry; return Math.sqrt(dx * dx + dy * dy); }
  function zoomTo(z, tx, ty){ Z.z = z; Z.tx = tx; Z.ty = ty; applyZoom(); }

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
    if(g.type === "zoom"){
      if(pts.length < 2) return;
      var nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, g.z0 * rawDist(pts[0], pts[1]) / g.d0));
      var mx = (pts[0].rx + pts[1].rx) / 2, my = (pts[0].ry + pts[1].ry) / 2;
      // точка стола под серединой пальцев в начале жеста остаётся под серединой пальцев
      var cx0 = (g.mx0 - g.tx0) / g.z0, cy0 = (g.my0 - g.ty0) / g.z0;
      zoomTo(nz, mx - nz * cx0, my - nz * cy0);
      g.moved = true;
      return;
    }
    if(g.type === "pan"){
      var pp = pts[0];
      if(Math.abs(pp.rx - g.sx) > 4 || Math.abs(pp.ry - g.sy) > 4) g.moved = true;
      if(g.moved) zoomTo(Z.z, g.tx0 + (pp.rx - g.sx), g.ty0 + (pp.ry - g.sy));
      return;
    }
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
    if(g.type === "mpinch" || g.type === "mmove" || g.type === "mhandle" || g.type === "draw" || g.type === "text"){
      moveMarkGesture(g, pts, sz);
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
    if(g.type === "draw" || g.type === "text" || g.type === "mmove" || g.type === "mhandle" || g.type === "mpinch"){
      endMarkGesture(g);
      return;
    }
    if(g.type === "zoom") return;
    if(g.type === "pan"){ if(!g.moved) clearSel(); return; }
    if(g.type === "swipe"){
      if(!g.moved){ clearSel(); return; } // тап по пустому месту — снять выбор
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
      if(paletteOpen) setPalette(false);
      if(e.cancelable) e.preventDefault();
      if(e.target && e.target.id === "deskZoomBadge"){ gesture = null; resetZoom(); return; }
      var pts = pointsOf(e);
      if(e.touches.length === 2){
        if(gesture && (gesture.type === "swipe" || gesture.type === "pan")) gesture = null;
        else if(gesture && gesture.type === "draw") abortDraw();
        else if(gesture && gesture.type === "text") gesture = null;
        beginGesture(pts, e.target, [e.touches[0].target, e.touches[1].target]);
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
      if(e.touches && e.touches.length === 1 && gesture && gesture.type === "mpinch"){
        var mpId = gesture.id, mp0 = findMark(mpId);
        saveNow();
        if(mp0){
          var mpp = localPoint(e.touches[0]);
          gesture = { type: "mmove", id: mpId, sx: mpp.x, sy: mpp.y, orig: cloneMark(mp0), moved: true, wasSel: true };
        } else gesture = null;
        return;
      }
      if(e.touches && e.touches.length === 1 && gesture && gesture.type === "zoom"){
        // один палец остался — дальше он двигает стол
        var zp = localPoint(e.touches[0]);
        gesture = { type: "pan", sx: zp.rx, sy: zp.ry, tx0: Z.tx, ty0: Z.ty, moved: true };
        return;
      }
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
    st.addEventListener("touchcancel", function(){
      lastTouchAt = Date.now();
      var gc = gesture;
      gesture = null;
      if(!gc) return;
      if(gc.type === "draw" || gc.type === "text" || gc.type === "mmove" || gc.type === "mhandle" || gc.type === "mpinch") endMarkGesture(gc);
      else if(gc.type !== "swipe" && gc.type !== "zoom" && gc.type !== "pan") saveNow();
    }, { passive: true });

    // колесо мыши (браузер на компьютере) — масштаб стола вокруг указателя
    st.addEventListener("wheel", function(e){
      if(e.cancelable) e.preventDefault();
      var rp = localPoint(e), nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Z.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      var cx = rp.x, cy = rp.y;
      zoomTo(nz, rp.rx - nz * cx, rp.ry - nz * cy);
    }, { passive: false });

    // мышь (браузер на компьютере); после касания эмулированные события мыши игнорируем
    st.addEventListener("mousedown", function(e){
      if(Date.now() - lastTouchAt < 700 || e.button !== 0) return;
      e.preventDefault();
      if(e.target && e.target.id === "deskZoomBadge"){ resetZoom(); return; }
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
      pickWait = true;
      try{ localStorage.setItem(PICK_KEY, String(Date.now())); }catch(e){}
      try{ fileInput.click(); }catch(e){ pickWait = false; toast("Не удалось открыть выбор файла.", 5000); }
    });
    function onBack(){
      if(!pickWait) return;
      setTimeout(function(){
        if(!pickWait) return;
        pickWait = false;
        try{ localStorage.removeItem(PICK_KEY); }catch(e){}
        dlog("после выбора файла событие не пришло");
        toast("Система не передала файл (или выбор отменён).", 6000);
      }, 2500);
    }
    if(!pickBound){
      pickBound = true;
      window.addEventListener("focus", onBack);
      document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "visible") onBack(); });
    }
    function onPicked(){
      pickWait = false;
      try{ localStorage.removeItem(PICK_KEY); }catch(e){}
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
    bindMarkUi();
    if(!resizeBound){
      resizeBound = true;
      window.addEventListener("resize", function(){ if(rootEl()) relayout(); });
    }
  }

  function renderSettingsTabDesk(){
    if(!data) data = loadData();
    selId = null;
    selMark = null;
    gesture = null;
    armed = "";
    tool = "";
    drawOpen = false;
    paletteOpen = false;
    dlgState = null;
    try{ var sc = localStorage.getItem(COLOR_KEY); if(sc && /^#[0-9a-f]{6}$/i.test(sc)) curColor = sc; }catch(e){}
    if(!renderShell()) return;
    renderPage(0);
    syncDrawUi();
    startSizeWatch();
    try{
      var pk = parseInt(localStorage.getItem(PICK_KEY) || "0", 10);
      if(pk){
        localStorage.removeItem(PICK_KEY);
        if(Date.now() - pk < 600000){
          dlog("страница перезапущена во время выбора файла");
          toast("Приложение перезапустилось, пока был открыт выбор файла.", 9000);
        }
      }
    }catch(e){}
    // размеры стола известны только после раскладки окна — подгоняем картинки ещё раз
    setTimeout(function(){ if(rootEl()) relayout(); }, 60);
  }

  return {
    renderSettingsTabDesk: renderSettingsTabDesk
  };
};
