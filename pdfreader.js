/* pdfreader.js — постраничный просмотр PDF картинками (страницы как в настоящем PDF-просмотрщике).
   Версия: 2.0 (01.11)

   Зачем: книги-PDF во вкладке «Мои книги» раньше разбирались в текст (pdfparse.js) и показывались как fb2/epub.
   Теперь PDF открывается страницами — с картинками, шрифтами и вёрсткой оригинала. pdfparse.js остаётся для
   поиска по PDF (pdfindex.js) и как запасной путь, если этот модуль не смог открыть файл.

   Движок: pdf.js (vendor/pdfjs/, build legacy, ES-модули), подключается динамическим import() — как
   codemirror.bundle.js. Страницы рисуются на canvas лениво: только видимые и ближайшие, остальные
   освобождаются. Размеры всех страниц читаются фоном (страницы в PDF бывают разного формата).

   Экспорт — window.PdfPageReader:
     supported()                         → true, если браузер умеет динамический import (иначе — текстовый ридер)
     load(arrayBuffer)                   → Promise<handle>; handle = {doc, numPages}; прошлый открытый документ освобождается.
                                           Буфер НЕ копируется и становится непригодным — передавать копию.
     release(handle)                     → освободить документ
     cover(handle, widthPx)              → Promise<{base64, contentType}> — первая страница JPEG (для обложки)
     mount(container, root, handle, o)   → контроллер {destroy, goTo, setZoom, getZoom, getPosition, flush, setHighlights, pageCount}
        container — прокручиваемый #settingsTabContent; root — пустой элемент для страниц;
        o.startPage (с 1), o.startFrac (0..1 — доля высоты страницы), o.zoom,
        o.onPage(page, total) — смена текущей страницы, o.onPosition(page, frac) — позиция (debounce 500 мс).
        Подчёркивание мыслей (как в тексте книг): удержание 250 мс на слове подчёркивает его, не отпуская — ведём палец,
        выделение растягивается по словам (в пределах страницы), у краёв экрана страница прокручивается сама.
        o.onSelect({page, text, rects}) — выделение готово (палец отпущен), rects — [[x,y,w,h]…] в долях страницы;
        o.onNoText() — на странице нет текстового слоя (скан без распознавания); o.highlights — [{id,page,rects}] уже
        сохранённые подсветки, setHighlights(list) заменяет их; o.onHighlightTap(hl, clientRect) — тап по подсветке.
        Слова и их границы берутся из getTextContent() (без текстового слоя pdf.js и без его CSS), геометрия —
        в долях страницы, поэтому от масштаба не зависит; повёрнутый текст (и страницы с /Rotate) не выделяется.
     askPage(total, current, cb)         → маленькое окно «перейти на страницу» (prompt() в WebView не работает)

   Старый WebView (Android 5.0): динамического import() там нет — supported() вернёт false, ридер уйдёт в текстовый режим. */
(function(){
  "use strict";

  var BASE = "vendor/pdfjs/";
  var GAP = 6;                 // зазор между страницами, px (совпадает с margin-bottom у .pdf-page в components.css)
  var MIN_ZOOM = 1, MAX_ZOOM = 5;
  var MAX_PIXELS = 3500000;    // потолок площади canvas одной страницы (память на слабых телефонах)
  var KEEP_BEHIND = 3, KEEP_AHEAD = 4;   // сколько страниц вокруг видимых держим отрисованными
  var WANT_BEHIND = 1, WANT_AHEAD = 2;   // сколько страниц вокруг видимых дорисовываем заранее

  var libPromise = null;
  var libModule = null;
  var HOLD_MS = 250, HOLD_MOVE_PX = 10;   // как в ридере книг (my.js LT_HOLD_MARK_MS / LT_HOLD_MOVE_PX)
  var currentHandle = null;

  function absUrl(p){ return new URL(p, document.baseURI).href; }

  function supported(){
    try{ new Function("return import('data:text/javascript,')"); }catch(e){ return false; }
    return typeof Promise !== "undefined" && typeof Uint8Array !== "undefined" && !!document.createElement("canvas").getContext;
  }

  // Динамический import() — обычный, а при сбое (повторный import() того же адреса после неудачи браузер может не
  // повторять, см. loadCM в mdeditor.js) — через blob:-адрес с текстом модуля: у него каждый раз новый адрес.
  // pdf.min.mjs самодостаточен (статических import нет), поэтому из blob: он работает так же.
  function importVia(url){ return new Function("u", "return import(u)")(url); }
  function importViaBlob(url){
    return fetch(url).then(function(r){
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function(text){
      var blobUrl = URL.createObjectURL(new Blob([text], {type: "text/javascript"}));
      return importVia(blobUrl);
    });
  }
  function loadLib(){
    if(libPromise) return libPromise;
    var url = absUrl(BASE + "pdf.min.mjs");
    libPromise = importVia(url).catch(function(){ return importViaBlob(url); }).then(function(m){
      m.GlobalWorkerOptions.workerSrc = absUrl(BASE + "pdf.worker.min.mjs");
      libModule = m;
      return m;
    }, function(e){ libPromise = null; throw e; });
    return libPromise;
  }

  function release(handle){
    if(!handle) return;
    handle.released = true;
    try{ handle.doc.destroy(); }catch(e){}
    if(currentHandle === handle) currentHandle = null;
  }

  function load(buffer){
    return loadLib().then(function(lib){
      if(currentHandle) release(currentHandle);
      var task = lib.getDocument({
        data: new Uint8Array(buffer),
        wasmUrl: absUrl(BASE),       // openjpeg/jbig2/qcms: JPX- и JBIG2-картинки сканов, ICC-профили
        isEvalSupported: false,
        useSystemFonts: true
      });
      return task.promise.then(function(doc){
        var handle = {doc: doc, numPages: doc.numPages};
        currentHandle = handle;
        return handle;
      });
    });
  }

  function cover(handle, widthPx){
    return handle.doc.getPage(1).then(function(page){
      var vp1 = page.getViewport({scale: 1});
      var vp = page.getViewport({scale: (widthPx || 240) / vp1.width});
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({canvasContext: ctx, viewport: vp}).promise.then(function(){
        var url = canvas.toDataURL("image/jpeg", 0.82);
        try{ page.cleanup(); }catch(e){}
        return {base64: url.slice(url.indexOf(",") + 1), contentType: "image/jpeg"};
      });
    });
  }

  function clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }

  // ---- слова страницы (для подчёркивания) ----
  var measureCtx = null;
  function measure(str){
    if(!measureCtx){
      measureCtx = document.createElement("canvas").getContext("2d");
      measureCtx.font = "100px sans-serif";
    }
    return measureCtx.measureText(str).width;
  }
  // Слова страницы в порядке чтения PDF: {t, x0, x1, top, bot, h, cy} — всё в долях ширины/высоты страницы.
  // Границы слов внутри куска текста — по пропорциям ширины символов запасного шрифта (точность «до слова»).
  function buildWords(page){
    var vp = page.getViewport({scale: 1});
    return page.getTextContent().then(function(tc){
      var W = vp.width, H = vp.height, words = [], Util = libModule && libModule.Util;
      if(!Util) return words;
      for(var k = 0; k < tc.items.length; k++){
        var it = tc.items[k];
        if(!it.str || !it.transform || !/\S/.test(it.str)) continue;
        var tx = Util.transform(vp.transform, it.transform);
        var fh = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
        if(!(fh > 0)) continue;
        if(Math.abs(Math.atan2(tx[1], tx[0])) > 0.2) continue;   // повёрнутый текст не берём
        var left = tx[4], base = tx[5], w = (it.width || 0) * vp.scale;
        var top = base - fh * 0.92, bot = base + fh * 0.22;
        var str = it.str, total = measure(str) || 1;
        var re = /\S+/g, m;
        while((m = re.exec(str))){
          var x0 = left + w * measure(str.slice(0, m.index)) / total;
          var x1 = left + w * measure(str.slice(0, m.index + m[0].length)) / total;
          words.push({
            t: m[0],
            x0: clamp(x0 / W, 0, 1), x1: clamp(x1 / W, 0, 1),
            top: top / H, bot: bot / H, h: (bot - top) / H, cy: (top + bot) / 2 / H
          });
        }
      }
      return words;
    });
  }
  // ближайшее к точке слово (расстояние — в долях ширины страницы; aspect = высота/ширина страницы)
  function nearestWord(words, fx, fy, aspect){
    var best = -1, bd = 1e9;
    for(var i = 0; i < words.length; i++){
      var w = words[i];
      var dx = fx < w.x0 ? w.x0 - fx : (fx > w.x1 ? fx - w.x1 : 0);
      var dy = fy < w.top ? w.top - fy : (fy > w.bot ? fy - w.bot : 0);
      var d = Math.sqrt(dx * dx + dy * aspect * dy * aspect);
      if(d < bd){ bd = d; best = i; }
    }
    return {i: best, d: bd};
  }
  function rectsOfWords(words, lo, hi){
    var out = [], cur = null;
    for(var k = lo; k <= hi; k++){
      var w = words[k];
      if(cur && Math.abs(w.cy - cur.cy) < 0.5 * Math.max(w.h, cur.h)){
        cur.x0 = Math.min(cur.x0, w.x0); cur.x1 = Math.max(cur.x1, w.x1);
        cur.top = Math.min(cur.top, w.top); cur.bot = Math.max(cur.bot, w.bot);
      } else {
        if(cur) out.push(cur);
        cur = {x0: w.x0, x1: w.x1, top: w.top, bot: w.bot, cy: w.cy};
      }
    }
    if(cur) out.push(cur);
    return out.map(function(r){
      function q(v){ return Math.round(v * 10000) / 10000; }
      return [q(r.x0), q(r.top), q(r.x1 - r.x0), q(r.bot - r.top)];
    });
  }
  function textOfWords(words, lo, hi){
    var s = "";
    for(var k = lo; k <= hi; k++){
      var w = words[k];
      if(k > lo){
        var prev = words[k - 1];
        var newLine = Math.abs(w.cy - prev.cy) > 0.5 * Math.max(w.h, prev.h);
        // перенос слова: «компь-» в конце строки и «ютер» в начале следующей склеиваем без дефиса
        if(newLine && /[A-Za-zА-Яа-яЁё]-$/.test(s) && /^[a-zа-яё]/.test(w.t)) s = s.slice(0, -1);
        else s += " ";
      }
      s += w.t;
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function mount(container, root, handle, o){
    o = o || {};
    var doc = handle.doc, n = handle.numPages;
    var zoom = clamp(o.zoom || 1, MIN_ZOOM, MAX_ZOOM);
    var dead = false;
    var sizes = [], heights = [], tops = [], els = [], states = [];
    var curPage = 0, curFrac = 0, shownPage = -1;
    var rafPending = false, saveTimer = null;
    var queueRunning = false;
    var lastRootW = 0;
    var wordsP = [], wordsSync = [];            // слова страниц: промис и готовый массив
    var hlData = (o.highlights || []).slice();   // сохранённые подсветки [{id,page,rects}]
    var sel = null;                              // идущее выделение {p, a, b, words}
    var holdTimer = null, holdStart = null, touching = false, holdToken = 0;
    var lastX = 0, lastY = 0, autoOn = false, swallowUntil = 0;

    var inner = document.createElement("div");
    inner.className = "pdf-pages-inner";
    root.appendChild(inner);
    // Браузер сам «якорит» прокрутку при смене высоты содержимого выше экрана — а мы компенсируем это вручную
    // (applySize), иначе поправка вышла бы двойной. Пока смонтирован просмотр, автоякорь у контейнера выключен.
    var prevAnchor = container.style.overflowAnchor;
    container.style.overflowAnchor = "none";

    function baseW(){ return Math.max(120, root.clientWidth || container.clientWidth || 360); }
    function pageW(){ return baseW() * zoom; }
    function innerTop(){
      return inner.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop + container.scrollTop;
    }
    function isAlive(){
      if(dead) return false;
      if(!document.documentElement.contains(root)){ destroy(); return false; }
      return true;
    }

    // ---- каркас страниц ----
    var firstSize = [595, 842]; // A4 в пунктах, пока не прочитан настоящий размер первой страницы
    var frag = document.createDocumentFragment();
    for(var i = 0; i < n; i++){
      sizes[i] = firstSize;
      var el = document.createElement("div");
      el.className = "pdf-page";
      el.setAttribute("data-n", String(i + 1));
      frag.appendChild(el);
      els[i] = el;
      states[i] = {};
    }
    inner.appendChild(frag);

    function layoutFrom(from){
      var W = pageW();
      var y = from > 0 ? tops[from - 1] + heights[from - 1] + GAP : 0;
      for(var k = from; k < n; k++){
        var h = Math.round(W * sizes[k][1] / sizes[k][0]);
        heights[k] = h;
        tops[k] = y;
        els[k].style.height = h + "px";
        y += h + GAP;
      }
    }
    inner.style.width = (zoom * 100) + "%";
    layoutFrom(0);

    function pageAt(scrollTop){
      var y = scrollTop - innerTop();
      var lo = 0, hi = n - 1, found = 0;
      while(lo <= hi){
        var mid = (lo + hi) >> 1;
        if(tops[mid] <= y + 1){ found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return found;
    }

    function positionOf(scrollTop){
      var p = pageAt(scrollTop);
      var f = heights[p] > 0 ? (scrollTop - innerTop() - tops[p]) / heights[p] : 0;
      return {page: p, frac: clamp(f, 0, 1)};
    }

    // ---- отрисовка ----
    function evict(i){
      var st = states[i];
      if(st.task){ try{ st.task.cancel(); }catch(e){} st.task = null; }
      var c = els[i].firstChild;
      if(c && c.tagName === "CANVAS"){ c.width = 0; c.height = 0; }
      els[i].textContent = "";
      st.done = false; st.key = null; st.err = false;
      wordsP[i] = null; wordsSync[i] = null;
    }

    function renderKey(){ return Math.round(pageW()) + "@" + (window.devicePixelRatio || 1); }

    function renderPage(i){
      var st = states[i], key = renderKey();
      if(st.done && st.key === key) return Promise.resolve();
      if(st.done) evict(i);
      return doc.getPage(i + 1).then(function(page){
        if(!isAlive()) return;
        var vp1 = page.getViewport({scale: 1});
        applySize(i, vp1.width, vp1.height);
        var scale = (pageW() / vp1.width) * Math.min(window.devicePixelRatio || 1, 2.5);
        var px = vp1.width * vp1.height * scale * scale;
        if(px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
        var vp = page.getViewport({scale: scale});
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        canvas.className = "pdf-canvas";
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        var task = page.render({canvasContext: ctx, viewport: vp});
        st.task = task;
        return task.promise.then(function(){
          st.task = null;
          if(!isAlive()) return;
          els[i].textContent = "";
          els[i].appendChild(canvas);
          st.done = true; st.key = key; st.err = false;
          paintHl(i);
          if(o.onSelect) getWords(i);   // слова готовим заранее, чтобы удержание сработало сразу
          try{ page.cleanup(); }catch(e){}
        }, function(e){
          st.task = null;
          if(e && e.name === "RenderingCancelledException") return;
          st.err = true;
          els[i].textContent = "Не удалось показать страницу " + (i + 1);
        });
      }, function(){
        st.err = true;
        els[i].textContent = "Не удалось показать страницу " + (i + 1);
      });
    }

    // одна отрисовка за раз, ближайшие к экрану — первыми
    function wanted(){
      var first = pageAt(container.scrollTop);
      var last = pageAt(container.scrollTop + container.clientHeight);
      return {first: first, last: last,
        lo: Math.max(0, first - WANT_BEHIND), hi: Math.min(n - 1, last + WANT_AHEAD)};
    }
    function pickNext(){
      var w = wanted(), key = renderKey(), best = -1, bestD = 1e9;
      for(var i = w.lo; i <= w.hi; i++){
        var st = states[i];
        if((st.done && st.key === key) || st.err) continue;
        var d = i < w.first ? (w.first - i) * 1.5 : (i > w.last ? i - w.last : 0);
        if(d < bestD){ bestD = d; best = i; }
      }
      return best;
    }
    function pump(){
      if(queueRunning || !isAlive()) return;
      var i = pickNext();
      if(i < 0) return;
      queueRunning = true;
      renderPage(i).then(function(){}, function(){}).then(function(){
        queueRunning = false;
        pump();
      });
    }

    function update(){
      rafPending = false;
      if(!isAlive()) return;
      // сохраняемое место — верхний край экрана (без сдвига, иначе при каждом открытии место уезжало бы вниз);
      // номер страницы для индикатора — чуть ниже верхнего края, чтобы не мигал на стыке страниц
      var pos = positionOf(container.scrollTop);
      curPage = pos.page; curFrac = pos.frac;
      var shown = positionOf(container.scrollTop + Math.min(40, container.clientHeight / 6)).page;
      if(shown !== shownPage){ shownPage = shown; if(o.onPage) o.onPage(shown + 1, n); }
      // освобождаем далёкие страницы
      var w = wanted();
      for(var i = 0; i < n; i++){
        if((i < w.first - KEEP_BEHIND || i > w.last + KEEP_AHEAD) && (states[i].done || states[i].task)) evict(i);
      }
      pump();
      if(saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function(){ saveTimer = null; flush(); }, 500);
    }
    function schedule(){
      if(rafPending) return;
      rafPending = true;
      requestAnimationFrame(update);
    }
    function flush(){
      if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
      if(o.onPosition && !dead) o.onPosition(curPage + 1, curFrac);
    }

    // ---- размеры страниц разного формата ----
    function applySize(i, w, h){
      var cur = sizes[i];
      if(Math.abs(cur[0] - w) < 0.5 && Math.abs(cur[1] - h) < 0.5) return;
      var oldH = heights[i];
      sizes[i] = [w, h];
      layoutFrom(i);
      var delta = heights[i] - oldH;
      // страница выше текущей изменила высоту — держим читаемое место на месте
      if(delta !== 0 && i < curPage) container.scrollTop += delta;
    }
    function scanSizes(){
      var i = 0;
      function step(){
        if(!isAlive() || i >= n) return;
        doc.getPage(i + 1).then(function(page){
          if(!isAlive()) return;
          var vp = page.getViewport({scale: 1});
          if(i === 0 && sizes[0] === firstSize) firstSizeKnown(vp.width, vp.height);
          else applySize(i, vp.width, vp.height);
          try{ page.cleanup(); }catch(e){}
          i++;
          if(i % 25 === 0) setTimeout(step, 0); else step();
        }, function(){ i++; step(); });
      }
      step();
    }
    // все страницы, пока не прочитаны, считаются такими же, как первая (у большинства книг это так)
    function firstSizeKnown(w, h){
      for(var k = 0; k < n; k++) if(sizes[k] === firstSize) sizes[k] = [w, h];
      layoutFrom(0);
    }

    // ---- перейти / масштаб ----
    function goTo(page, frac){
      var p = clamp((page | 0) - 1, 0, n - 1);
      curPage = p; curFrac = frac || 0;
      container.scrollTop = Math.round(innerTop() + tops[p] + (frac || 0) * heights[p]);
      update();
    }

    function relayoutKeepingPlace(newZoom, vx, vy){
      var cr = container.getBoundingClientRect();
      if(vx == null) vx = cr.width / 2;
      if(vy == null) vy = cr.height / 2;
      var ratio = newZoom / zoom;
      // горизонтально прокручивается root (у #settingsTabContent overflow-x:hidden), вертикально — container
      var rootLeft = root.getBoundingClientRect().left - cr.left;
      var vxRoot = vx - rootLeft;
      var contentX = root.scrollLeft + vxRoot;
      var contentY = container.scrollTop + vy - innerTop();
      zoom = newZoom;
      inner.style.width = (zoom * 100) + "%";
      for(var i = 0; i < n; i++) if(states[i].done || states[i].task) evict(i);
      layoutFrom(0);
      root.scrollLeft = Math.max(0, Math.round(contentX * ratio - vxRoot));
      container.scrollTop = Math.max(0, Math.round(innerTop() + contentY * ratio - vy));
      lastRootW = root.clientWidth;
      update();
    }
    function setZoom(z, vx, vy){
      z = clamp(z, MIN_ZOOM, MAX_ZOOM);
      if(Math.abs(z - zoom) < 0.001) return zoom;
      relayoutKeepingPlace(z, vx, vy);
      return zoom;
    }

    // ---- подчёркивание мыслей: слова, подсветки, выделение удержанием ----
    function getWords(i){
      if(wordsP[i]) return wordsP[i];
      wordsP[i] = doc.getPage(i + 1).then(function(page){
        return buildWords(page).then(function(words){
          try{ page.cleanup(); }catch(e){}
          wordsSync[i] = words;
          return words;
        });
      }).catch(function(){ wordsSync[i] = []; return []; });
      return wordsP[i];
    }
    function paintHl(i){
      var el = els[i];
      if(!el) return;
      var old = el.querySelector(".pdf-hl-layer");
      if(old) el.removeChild(old);
      var list = [], k, j;
      for(k = 0; k < hlData.length; k++) if(hlData[k].page === i + 1) list.push({rects: hlData[k].rects, cls: "pdf-hl"});
      if(sel && sel.p === i){
        var lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
        list.push({rects: rectsOfWords(sel.words, lo, hi), cls: "pdf-hl pdf-hl-sel"});
      }
      if(!list.length || !states[i].done) return;
      var layer = document.createElement("div");
      layer.className = "pdf-hl-layer";
      for(k = 0; k < list.length; k++){
        for(j = 0; j < list[k].rects.length; j++){
          var r = list[k].rects[j], d = document.createElement("div");
          d.className = list[k].cls;
          d.style.left = (r[0] * 100) + "%"; d.style.top = (r[1] * 100) + "%";
          d.style.width = (r[2] * 100) + "%"; d.style.height = (r[3] * 100) + "%";
          layer.appendChild(d);
        }
      }
      el.appendChild(layer);
    }
    function setHighlights(list){
      hlData = (list || []).slice();
      for(var i = 0; i < n; i++) if(states[i].done) paintHl(i);
    }
    function pageIndexAtClientY(cy){
      var cr = container.getBoundingClientRect();
      var y = container.scrollTop + cy - cr.top - container.clientTop;
      var p = pageAt(y);
      var r = els[p].getBoundingClientRect();
      return (cy >= r.top && cy <= r.bottom) ? p : -1;
    }
    function holdCancel(){ if(holdTimer){ clearTimeout(holdTimer); holdTimer = null; } holdToken++; }
    function selCancel(){
      if(!sel) return;
      var p = sel.p; sel = null; paintHl(p);
    }
    function selStart(p, words, x, y){
      if(!words.length){ if(o.onNoText) o.onNoText(); return; }
      var r = els[p].getBoundingClientRect();
      var aspect = r.height / r.width;
      var nb = nearestWord(words, (x - r.left) / r.width, (y - r.top) / r.height, aspect);
      if(nb.i < 0 || nb.d > 1.5 * words[nb.i].h * aspect) return;
      sel = {p: p, a: nb.i, b: nb.i, words: words};
      lastX = x; lastY = y;
      paintHl(p);
      try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){}
      autoScroll();
    }
    function holdFire(){
      holdTimer = null;
      if(dead || !holdStart || !touching) return;
      var x = holdStart.x, y = holdStart.y, token = holdToken;
      var p = pageIndexAtClientY(y);
      if(p < 0) return;
      if(wordsSync[p]){ selStart(p, wordsSync[p], x, y); return; }
      getWords(p).then(function(words){
        if(dead || token !== holdToken || !touching || sel) return;
        selStart(p, words, x, y);
      });
    }
    function selUpdate(){
      if(!sel) return;
      var p2 = pageIndexAtClientY(lastY), words = sel.words, b = sel.b;
      if(p2 < 0) return;
      if(p2 < sel.p) b = 0;
      else if(p2 > sel.p) b = words.length - 1;
      else {
        var r = els[p2].getBoundingClientRect();
        var nb = nearestWord(words, (lastX - r.left) / r.width, (lastY - r.top) / r.height, r.height / r.width);
        if(nb.i < 0) return;
        b = nb.i;
      }
      if(b !== sel.b){ sel.b = b; paintHl(sel.p); }
    }
    function autoScroll(){
      if(autoOn) return;
      autoOn = true;
      function tick(){
        if(!sel || dead){ autoOn = false; return; }
        var cr = container.getBoundingClientRect();
        var top = Math.max(cr.top, 0) + 70;
        var bottom = Math.min(cr.bottom, window.innerHeight) - 110;
        var dy = 0;
        if(lastY < top) dy = -Math.min(14, 2 + (top - lastY) / 6);
        else if(lastY > bottom) dy = Math.min(14, 2 + (lastY - bottom) / 6);
        if(dy){ container.scrollTop += dy; selUpdate(); }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    function selCommit(){
      var s = sel;
      sel = null;
      if(!s) return;
      paintHl(s.p);
      var lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
      var text = textOfWords(s.words, lo, hi);
      if(!text) return;
      if(o.onSelect) o.onSelect({page: s.p + 1, text: text, rects: rectsOfWords(s.words, lo, hi)});
    }
    function onClick(e){
      if(Date.now() < swallowUntil){ e.preventDefault(); e.stopPropagation(); return; }
      if(!o.onHighlightTap || !hlData.length || !root.contains(e.target)) return;
      var p = pageIndexAtClientY(e.clientY);
      if(p < 0) return;
      var r = els[p].getBoundingClientRect();
      var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      for(var k = 0; k < hlData.length; k++){
        if(hlData[k].page !== p + 1) continue;
        var rs = hlData[k].rects;
        for(var j = 0; j < rs.length; j++){
          var q = rs[j];
          if(fx >= q[0] - 0.004 && fx <= q[0] + q[2] + 0.004 && fy >= q[1] - 0.004 && fy <= q[1] + q[3] + 0.004){
            e.stopPropagation();
            o.onHighlightTap(hlData[k], {
              left: r.left + q[0] * r.width, top: r.top + q[1] * r.height,
              width: q[2] * r.width, height: q[3] * r.height
            });
            return;
          }
        }
      }
    }

    // ---- жесты: щипок двумя пальцами и двойное касание ----
    var pinch = null, lastTap = {t: 0, x: 0, y: 0};
    function dist(a, b){ var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }
    function onTouchStart(e){
      holdCancel();
      if(sel) selCancel();
      touching = e.touches.length > 0;
      if(e.touches.length === 1 && o.onSelect && root.contains(e.target)){
        var t0 = e.touches[0];
        holdStart = {x: t0.clientX, y: t0.clientY};
        lastX = t0.clientX; lastY = t0.clientY;
        holdTimer = setTimeout(holdFire, HOLD_MS);
      }
      if(e.touches.length === 2){
        var cr = container.getBoundingClientRect(), it = inner.getBoundingClientRect();
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinch = {d0: dist(e.touches[0], e.touches[1]), vx: mx - cr.left, vy: my - cr.top, s: 1};
        inner.style.transformOrigin = (mx - it.left) + "px " + (my - it.top) + "px";
      }
    }
    function onTouchMove(e){
      if(sel){
        // выделение идёт: палец ведёт выделение, а не прокручивает страницу
        if(e.cancelable) e.preventDefault();
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        selUpdate();
        return;
      }
      if(holdTimer && holdStart && e.touches.length === 1){
        var tm = e.touches[0];
        if(Math.abs(tm.clientX - holdStart.x) > HOLD_MOVE_PX || Math.abs(tm.clientY - holdStart.y) > HOLD_MOVE_PX) holdCancel();
      }
      if(!pinch || e.touches.length < 2) return;
      if(e.cancelable) e.preventDefault();
      var s = dist(e.touches[0], e.touches[1]) / pinch.d0;
      s = clamp(s, MIN_ZOOM / zoom, MAX_ZOOM / zoom);
      pinch.s = s;
      inner.style.transform = "scale(" + s + ")";
    }
    function onTouchEnd(e){
      holdCancel();
      if(e.touches.length === 0) touching = false;
      if(sel){
        if(e.type === "touchcancel") selCancel();
        else {
          // отпускание после удержания не должно считаться ни кликом, ни двойным касанием
          swallowUntil = Date.now() + 500;
          lastTap.t = 0;
          selCommit();
        }
        return;
      }
      if(pinch && e.touches.length < 2){
        var p = pinch; pinch = null;
        inner.style.transform = ""; inner.style.transformOrigin = "";
        setZoom(zoom * p.s, p.vx, p.vy);
        lastTap.t = 0;
        return;
      }
      if(e.touches.length === 0 && e.changedTouches.length === 1){
        var t = e.changedTouches[0], now = Date.now();
        if(now - lastTap.t < 300 && Math.abs(t.clientX - lastTap.x) < 30 && Math.abs(t.clientY - lastTap.y) < 30){
          var cr2 = container.getBoundingClientRect();
          setZoom(zoom > 1.2 ? 1 : 2.5, t.clientX - cr2.left, t.clientY - cr2.top);
          lastTap.t = 0;
        } else {
          lastTap = {t: now, x: t.clientX, y: t.clientY};
        }
      }
    }

    function onContextMenu(e){ if(o.onSelect && root.contains(e.target)) e.preventDefault(); }

    function onResize(){
      if(!isAlive()) return;
      var w = root.clientWidth;
      if(!w || Math.abs(w - lastRootW) < 2) return;
      lastRootW = w;
      var keep = {page: curPage, frac: curFrac};
      for(var i = 0; i < n; i++) if(states[i].done || states[i].task) evict(i);
      layoutFrom(0);
      container.scrollTop = Math.round(innerTop() + tops[keep.page] + keep.frac * heights[keep.page]);
      update();
    }

    container.addEventListener("scroll", schedule, {passive: true});
    container.addEventListener("touchstart", onTouchStart, {passive: true});
    container.addEventListener("touchmove", onTouchMove, {passive: false});
    container.addEventListener("touchend", onTouchEnd, {passive: true});
    container.addEventListener("touchcancel", onTouchEnd, {passive: true});
    container.addEventListener("click", onClick);
    container.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("resize", onResize);

    function destroy(){
      if(dead) return;
      dead = true;
      container.style.overflowAnchor = prevAnchor || "";
      if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
      container.removeEventListener("scroll", schedule);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      container.removeEventListener("click", onClick);
      container.removeEventListener("contextmenu", onContextMenu);
      holdCancel();
      sel = null;
      window.removeEventListener("resize", onResize);
      for(var i = 0; i < n; i++){
        var st = states[i];
        if(st.task){ try{ st.task.cancel(); }catch(e){} st.task = null; }
        var c = els[i].firstChild;
        if(c && c.tagName === "CANVAS"){ c.width = 0; c.height = 0; }
      }
    }

    // старт: размер первой страницы → раскладка → нужное место → фоновое чтение остальных размеров
    lastRootW = root.clientWidth;
    doc.getPage(1).then(function(page){
      if(!isAlive()) return;
      var vp = page.getViewport({scale: 1});
      firstSizeKnown(vp.width, vp.height);
      try{ page.cleanup(); }catch(e){}
      goTo(o.startPage || 1, o.startFrac || 0);
      scanSizes();
    }, function(){
      if(!isAlive()) return;
      goTo(o.startPage || 1, o.startFrac || 0);
    });

    return {
      destroy: destroy,
      goTo: goTo,
      setZoom: setZoom,
      getZoom: function(){ return zoom; },
      getPosition: function(){ return {page: curPage + 1, frac: curFrac}; },
      flush: flush,
      setHighlights: setHighlights,
      pageCount: n
    };
  }

  function askPage(total, current, cb){
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;";
    var box = document.createElement("div");
    box.style.cssText = "background:var(--paper,#fff);color:var(--ink,#222);border-radius:12px;padding:16px;min-width:220px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:16px sans-serif;";
    box.innerHTML = '<div style="margin-bottom:10px;">Страница (1–' + total + ')</div>' +
      '<input type="number" inputmode="numeric" min="1" max="' + total + '" value="' + current + '" style="width:100%;box-sizing:border-box;font-size:18px;padding:8px;margin-bottom:12px;">' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button type="button" data-a="no" style="font-size:16px;padding:8px 14px;">Отмена</button>' +
      '<button type="button" data-a="ok" style="font-size:16px;padding:8px 14px;">Перейти</button></div>';
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    var input = box.querySelector("input");
    function close(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    function ok(){
      var v = parseInt(input.value, 10);
      close();
      if(!isNaN(v)) cb(clamp(v, 1, total));
    }
    box.querySelector('[data-a="ok"]').addEventListener("click", ok);
    box.querySelector('[data-a="no"]').addEventListener("click", close);
    wrap.addEventListener("click", function(e){ if(e.target === wrap) close(); });
    input.addEventListener("keydown", function(e){ if(e.key === "Enter") ok(); });
    setTimeout(function(){ try{ input.focus(); input.select(); }catch(e){} }, 50);
  }

  window.PdfPageReader = {
    supported: supported, load: load, release: release, cover: cover, mount: mount, askPage: askPage
  };
})();
