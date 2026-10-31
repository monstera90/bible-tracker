/* pdfreader.js — постраничный просмотр PDF картинками (страницы как в настоящем PDF-просмотрщике).
   Версия: 1.0 (31.10)

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
     mount(container, root, handle, o)   → контроллер {destroy, goTo, setZoom, getZoom, getPosition, flush, pageCount}
        container — прокручиваемый #settingsTabContent; root — пустой элемент для страниц;
        o.startPage (с 1), o.startFrac (0..1 — доля высоты страницы), o.zoom,
        o.onPage(page, total) — смена текущей страницы, o.onPosition(page, frac) — позиция (debounce 500 мс).
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

    // ---- жесты: щипок двумя пальцами и двойное касание ----
    var pinch = null, lastTap = {t: 0, x: 0, y: 0};
    function dist(a, b){ var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }
    function onTouchStart(e){
      if(e.touches.length === 2){
        var cr = container.getBoundingClientRect(), it = inner.getBoundingClientRect();
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinch = {d0: dist(e.touches[0], e.touches[1]), vx: mx - cr.left, vy: my - cr.top, s: 1};
        inner.style.transformOrigin = (mx - it.left) + "px " + (my - it.top) + "px";
      }
    }
    function onTouchMove(e){
      if(!pinch || e.touches.length < 2) return;
      if(e.cancelable) e.preventDefault();
      var s = dist(e.touches[0], e.touches[1]) / pinch.d0;
      s = clamp(s, MIN_ZOOM / zoom, MAX_ZOOM / zoom);
      pinch.s = s;
      inner.style.transform = "scale(" + s + ")";
    }
    function onTouchEnd(e){
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
