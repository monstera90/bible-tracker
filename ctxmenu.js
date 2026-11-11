/* ===========================================================================
   ctxmenu.js
   Версия: 1.0 (10.11)
   Круговое контекстное меню выделения текста и история скопированных в приложении фрагментов.
   Системное меню выделения в APK скрыто (SelectionMenuWebView.kt), поэтому «Копировать / Вставить / Вырезать» и
   «Переслать в задачу» — здесь. Круг из пяти секторов-пиктограмм: копировать, вставить, вырезать, переслать (стрелка
   вправо), последние 10 скопированных фрагментов.
   Экспорт: window.LTClip.{push,list,clear} — история (localStorage `ltClipHistory_v1`, только устройство; пишет
   window.LTCopyText из my.js); window.LTCtx.{init,hide,toast}. my.js зовёт init({cm, sendToTask}) один раз.
   Без сторонних библиотек, ES5 (старый WebView): без pointer events, без :has(), без flex-gap.
   =========================================================================== */
(function(){
  "use strict";

  // ===================== ИСТОРИЯ СКОПИРОВАННЫХ ФРАГМЕНТОВ =====================
  // Только то, что скопировано внутри приложения (через window.LTCopyText). Новые — сверху, повтор поднимается наверх.
  var HIST_KEY = "ltClipHistory_v1";
  var HIST_MAX = 10;
  var HIST_ITEM_MAX = 500000; // знаков; больший фрагмент в историю не кладётся (в буфере обмена он всё равно есть)

  function histLoad(){
    try{
      var a = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
      if(!(a instanceof Array)) return [];
      return a.filter(function(x){ return typeof x === "string" && x; });
    }catch(e){ return []; }
  }
  function histSave(a){
    // не хватило места в localStorage — выбрасываем самые старые, пока не поместится
    while(true){
      try{ localStorage.setItem(HIST_KEY, JSON.stringify(a)); return; }catch(e){}
      if(a.length <= 1) return;
      a.pop();
    }
  }
  function histPush(text){
    text = String(text == null ? "" : text);
    if(!text.replace(/\s+/g, "") || text.length > HIST_ITEM_MAX) return;
    var a = histLoad().filter(function(x){ return x !== text; });
    a.unshift(text);
    if(a.length > HIST_MAX) a.length = HIST_MAX;
    histSave(a);
  }
  window.LTClip = {
    push: histPush,
    list: histLoad,
    clear: function(){ try{ localStorage.removeItem(HIST_KEY); }catch(e){} }
  };

  // ===================== СОСТОЯНИЕ =====================
  var SIZE = 156;          // сторона круга, px
  var SHOW_DELAY = 380;    // мс покоя выделения до показа круга (ручки выделения двигаются без событий касания)
  var LONG_PRESS_MS = 650; // долгое нажатие в поле ввода без выделения → круг с «Вставить»
  var S = {
    hooks: {},
    ctx: null,       // {kind:"cm"|"ce"|"field"|"ro", text, rect, ...} — что выделено, пока открыто меню
    root: null,      // круг
    listEl: null,    // список фрагментов
    cx: 0, cy: 0,    // центр круга (список встаёт рядом)
    armT: 0,
    dismissed: null, // «вид:текст» выделения, с которым круг уже закрыли действием — не показывать снова, пока выделение то же
    touchAt: 0,
    lpT: 0, lpX: 0, lpY: 0
  };

  // ===================== СТИЛИ (вставляет сам модуль) =====================
  function injectStyle(){
    if(document.getElementById("ltCtxStyle")) return;
    var st = document.createElement("style");
    st.id = "ltCtxStyle";
    st.textContent =
      ".lt-ctx-root{position:fixed;left:0;top:0;width:" + SIZE + "px;height:" + SIZE + "px;z-index:100000;" +
        "-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;" +
        "opacity:0;-webkit-transform:scale(.86);transform:scale(.86);-webkit-transition:opacity .12s,-webkit-transform .12s;transition:opacity .12s,transform .12s;}" +
      ".lt-ctx-root.on{opacity:1;-webkit-transform:scale(1);transform:scale(1);}" +
      ".lt-ctx-root svg{display:block;width:" + SIZE + "px;height:" + SIZE + "px;overflow:visible;-webkit-filter:drop-shadow(0 3px 7px rgba(0,0,0,.38));filter:drop-shadow(0 3px 7px rgba(0,0,0,.38));}" +
      ".lt-ctx-sec{color:var(--wood-dark);cursor:pointer;}" +
      ".lt-ctx-sec path.lt-ctx-bg{fill:var(--parchment);stroke:var(--wood);stroke-width:1.5;stroke-linejoin:round;}" +
      ".lt-ctx-sec:active path.lt-ctx-bg{fill:var(--gold);}" +
      ".lt-ctx-ico{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;}" +
      ".lt-ctx-dis{opacity:.38;cursor:default;}" +
      ".lt-ctx-dis:active path.lt-ctx-bg{fill:var(--parchment);}" +
      ".lt-ctx-hub{fill:var(--parchment-dark);stroke:var(--wood);stroke-width:1.5;cursor:pointer;}" +
      ".lt-ctx-hubx{fill:none;stroke:var(--ink-soft);stroke-width:1.8;stroke-linecap:round;pointer-events:none;}" +
      ".lt-ctx-list{position:fixed;z-index:100001;box-sizing:border-box;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
        "background:var(--parchment);border:1px solid var(--groove-shadow);border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.4);" +
        "font-family:\"Palatino Linotype\",Georgia,serif;color:var(--ink);-webkit-user-select:none;user-select:none;}" +
      ".lt-ctx-item{display:block;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;text-align:left;border:0;" +
        "border-bottom:1px solid var(--parchment-dark);background:transparent;color:var(--ink);font:inherit;font-size:15px;line-height:1.3;cursor:pointer;" +
        "-webkit-tap-highlight-color:transparent;}" +
      ".lt-ctx-item:last-child{border-bottom:0;}" +
      ".lt-ctx-item:active{background:var(--gold-light);}" +
      ".lt-ctx-item span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:pre-wrap;word-wrap:break-word;word-break:break-word;}" +
      ".lt-ctx-empty{padding:14px;font-size:15px;color:var(--ink-soft);text-align:center;}" +
      ".lt-ctx-toast{position:fixed;left:50%;bottom:96px;-webkit-transform:translateX(-50%);transform:translateX(-50%);max-width:84%;" +
        "box-sizing:border-box;padding:9px 16px;border-radius:18px;background:var(--ink);color:var(--parchment);z-index:100002;opacity:.96;" +
        "font:15px \"Palatino Linotype\",Georgia,serif;text-align:center;pointer-events:none;}";
    document.head.appendChild(st);
  }

  // ===================== ПИКТОГРАММЫ (24×24, штрих) =====================
  var ICONS = {
    copy:  '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a1 1 0 0 1 1-1h9"></path>',
    paste: '<path d="M9 3h6v3H9z"></path><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"></path>',
    cut:   '<circle cx="6" cy="6" r="2.6"></circle><circle cx="6" cy="18" r="2.6"></circle><path d="M8 7.8L20 18"></path><path d="M8 16.2L20 6"></path>',
    fwd:   '<path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path>',
    hist:  '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"></path><path d="M3.5 4v4.5H8"></path><path d="M12 7.5V12l3 2"></path>'
  };
  var SECTORS = [
    { act: "copy",  title: "Копировать" },
    { act: "paste", title: "Вставить" },
    { act: "cut",   title: "Вырезать" },
    { act: "fwd",   title: "Переслать в задачи" },
    { act: "hist",  title: "Последние скопированные" }
  ];

  function pt(cx, cy, r, deg){
    var a = deg * Math.PI / 180;
    return (cx + r * Math.cos(a)).toFixed(2) + " " + (cy + r * Math.sin(a)).toFixed(2);
  }
  // кольцевой сектор от угла a0 до a1 (градусы, 0 — вправо, -90 — вверх, по часовой)
  function sectorPath(cx, cy, R, r, a0, a1){
    return "M" + pt(cx, cy, R, a0) + " A" + R + " " + R + " 0 0 1 " + pt(cx, cy, R, a1) +
      " L" + pt(cx, cy, r, a1) + " A" + r + " " + r + " 0 0 0 " + pt(cx, cy, r, a0) + " Z";
  }

  function menuSvg(en){
    var c = SIZE / 2, R = c - 4, r = 25, n = SECTORS.length, step = 360 / n;
    var html = '<svg viewBox="0 0 ' + SIZE + ' ' + SIZE + '" xmlns="http://www.w3.org/2000/svg">';
    for(var i = 0; i < n; i++){
      var a0 = -90 - step / 2 + step * i + 1, a1 = a0 + step - 2, mid = a0 + (step - 2) / 2;
      var mp = pt(c, c, (R + r) / 2, mid).split(" ");
      var sec = SECTORS[i];
      html += '<g class="lt-ctx-sec' + (en[sec.act] ? '' : ' lt-ctx-dis') + '" data-act="' + sec.act + '">' +
        '<title>' + sec.title + '</title>' +
        '<path class="lt-ctx-bg" d="' + sectorPath(c, c, R, r, a0, a1) + '"></path>' +
        '<g class="lt-ctx-ico" transform="translate(' + (parseFloat(mp[0]) - 12).toFixed(2) + ' ' + (parseFloat(mp[1]) - 12).toFixed(2) + ')">' + ICONS[sec.act] + '</g>' +
        '</g>';
    }
    html += '<g data-act="close"><circle class="lt-ctx-hub" cx="' + c + '" cy="' + c + '" r="' + (r - 3) + '"></circle>' +
      '<path class="lt-ctx-hubx" d="M' + (c - 6) + ' ' + (c - 6) + 'L' + (c + 6) + ' ' + (c + 6) + 'M' + (c + 6) + ' ' + (c - 6) + 'L' + (c - 6) + ' ' + (c + 6) + '"></path></g>';
    return html + '</svg>';
  }

  // ===================== УТИЛИТЫ =====================
  function kbHeight(){
    try{
      var vk = navigator.virtualKeyboard;
      if(vk && vk.boundingRect && vk.boundingRect.height) return vk.boundingRect.height;
    }catch(e){}
    return 0;
  }
  function inOwnUi(el){
    return !!(el && el.closest && el.closest(".lt-ctx-root, .lt-ctx-list"));
  }
  function skipEl(el){
    return !!(el && el.closest && el.closest("[data-lt-noctx]"));
  }
  function sigOf(c){ return c.kind + "|" + c.text; }
  function isTextField(el){
    if(!el || !el.tagName) return false;
    if(el.tagName === "TEXTAREA") return true;
    if(el.tagName !== "INPUT") return false;
    var t = (el.getAttribute("type") || "text").toLowerCase();
    return t === "text" || t === "search" || t === "url" || t === "tel" || t === "email";
  }
  function toast(msg){
    injectStyle();
    var old = document.querySelector(".lt-ctx-toast");
    if(old && old.parentNode) old.parentNode.removeChild(old);
    var d = document.createElement("div");
    d.className = "lt-ctx-toast";
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function(){ if(d.parentNode) d.parentNode.removeChild(d); }, 1900);
  }
  function rectOfRange(range){
    var rs = range.getClientRects();
    if(rs && rs.length){
      var b = range.getBoundingClientRect();
      var first = rs[0], last = rs[rs.length - 1];
      return { left: b.left, right: b.right, top: first.top, bottom: last.bottom };
    }
    var bb = range.getBoundingClientRect();
    if(bb && (bb.width || bb.height)) return { left: bb.left, right: bb.right, top: bb.top, bottom: bb.bottom };
    return null;
  }

  // Что выделено прямо сейчас и где. null — меню здесь не нужно.
  function readCtx(){
    var ae = document.activeElement;
    if(isTextField(ae)){
      if(skipEl(ae) || inOwnUi(ae)) return null;
      var a = null, b = null;
      try{ a = ae.selectionStart; b = ae.selectionEnd; }catch(e){}
      if(a == null || b == null) return null;
      var r = ae.getBoundingClientRect();
      return { kind: "field", el: ae, from: a, to: b, text: ae.value.slice(a, b),
        rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
    }
    var sel = window.getSelection && window.getSelection();
    if(!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    if(!el || inOwnUi(el) || skipEl(el)) return null;
    var cmEl = el.closest ? el.closest(".cm-editor") : null;
    if(cmEl){
      var cmh = S.hooks.cm;
      var info = cmh && cmh.info ? cmh.info(cmEl) : null;
      if(!info) return null;
      return { kind: "cm", from: info.from, to: info.to, text: info.text, rect: rectOfRange(range) };
    }
    var text = sel.toString();
    if(el.isContentEditable){
      var root = el;
      while(root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
      return { kind: "ce", root: root, range: range.cloneRange(), text: text, rect: rectOfRange(range) };
    }
    return { kind: "ro", text: text, rect: rectOfRange(range) };
  }

  // ===================== ДЕЙСТВИЯ НАД ИСТОЧНИКОМ =====================
  function fire(el){ try{ el.dispatchEvent(new Event("input", { bubbles: true })); }catch(e){} }

  function ceRestore(c){
    if(!c.root || !document.body.contains(c.root)) return false;
    try{ c.root.focus(); }catch(e){}
    var s = window.getSelection();
    if(!s) return false;
    try{ s.removeAllRanges(); s.addRange(c.range); }catch(e){ return false; }
    return true;
  }
  // заменить выделенное текстом (text === "" — просто удалить); true — получилось
  function replaceSel(c, text){
    if(c.kind === "cm"){
      var cmh = S.hooks.cm;
      return !!(cmh && cmh.replace && cmh.replace(c.from, c.to, text));
    }
    if(c.kind === "field"){
      var el = c.el;
      if(!document.body.contains(el)) return false;
      try{ el.focus(); el.setSelectionRange(c.from, c.to); }catch(e){}
      var ok = false;
      try{ ok = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text); }catch(e){ ok = false; }
      if(!ok){
        try{ el.setRangeText(text, c.from, c.to, "end"); }
        catch(e2){ el.value = el.value.slice(0, c.from) + text + el.value.slice(c.to); }
        fire(el);
      }
      return true;
    }
    if(c.kind === "ce"){
      if(!ceRestore(c)) return false;
      var done = false;
      try{ done = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text); }catch(e){ done = false; }
      if(!done){
        try{
          c.range.deleteContents();
          if(text){
            var tn = document.createTextNode(text);
            c.range.insertNode(tn);
            c.range.setStartAfter(tn);
            c.range.collapse(true);
          }
          var s = window.getSelection();
          s.removeAllRanges(); s.addRange(c.range);
        }catch(e3){ return false; }
        fire(c.root);
      }
      return true;
    }
    return false; // "ro": читать можно, менять нельзя
  }

  // ===================== БУФЕР ОБМЕНА =====================
  function copyText(text){
    if(window.LTCopyText) return window.LTCopyText(text);
    return Promise.resolve(false);
  }
  // Текст из буфера обмена: мост APK (≥30) → navigator.clipboard → последний скопированный в приложении фрагмент.
  function readClipboard(cb){
    var last = histLoad()[0] || "";
    try{
      var N = window.LifeTrackerNative;
      if(N && typeof N.pasteText !== "undefined"){
        var t = N.pasteText();
        if(typeof t === "string" && t){ cb(t); return; }
      }
    }catch(e){}
    if(navigator.clipboard && navigator.clipboard.readText){
      navigator.clipboard.readText().then(function(t){ cb(t || last); }, function(){ cb(last); });
      return;
    }
    cb(last);
  }

  // ===================== ПОКАЗ / СКРЫТИЕ =====================
  function placeBox(w, h, a){
    var vw = window.innerWidth, vh = window.innerHeight;
    var top0 = 6, bot0 = vh - kbHeight() - 6;
    var cx = (a.left + a.right) / 2;
    var left = Math.round(Math.max(6, Math.min(vw - w - 6, cx - w / 2)));
    var cand = [a.top - h - 10, a.bottom + 36]; // сначала над выделением, затем под ним (ниже ручек выделения)
    for(var i = 0; i < cand.length; i++){
      if(cand[i] >= top0 && cand[i] + h <= bot0) return { left: left, top: Math.round(cand[i]) };
    }
    return { left: left, top: Math.round(Math.max(top0, (bot0 - h) / 2)) };
  }

  function removeEls(){
    if(S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    if(S.listEl && S.listEl.parentNode) S.listEl.parentNode.removeChild(S.listEl);
    S.root = null; S.listEl = null;
  }
  function hide(){
    removeEls();
    S.ctx = null;
  }

  function show(ctx, rect){
    injectStyle();
    removeEls();
    S.ctx = ctx;
    var editable = ctx.kind !== "ro";
    var has = !!(ctx.text && ctx.text.replace(/\s+/g, ""));
    var en = {
      copy: has,
      paste: editable,
      cut: editable && has,
      fwd: has && !!S.hooks.sendToTask,
      hist: editable
    };
    var a = rect || ctx.rect || { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2 };
    var pos = placeBox(SIZE, SIZE, a);
    var root = document.createElement("div");
    root.className = "lt-ctx-root";
    root.style.left = pos.left + "px";
    root.style.top = pos.top + "px";
    root.innerHTML = menuSvg(en);
    // нажатие на круг не отнимает фокус и не сбрасывает выделение
    root.addEventListener("mousedown", function(e){ e.preventDefault(); });
    root.addEventListener("click", onRootClick);
    document.body.appendChild(root);
    S.root = root;
    S.cx = pos.left + SIZE / 2;
    S.cy = pos.top + SIZE / 2;
    requestAnimationFrame(function(){ if(S.root === root) root.className = "lt-ctx-root on"; });
  }

  // Первые строки фрагмента и «…», если есть что-то ещё (вставляется всегда весь фрагмент).
  function preview(text){
    var t = String(text).replace(/^\s+|\s+$/g, "");
    var lines = t.split(/\s*\n\s*/);
    var head = lines.slice(0, 2).join("\n");
    var more = lines.length > 2;
    if(head.length > 140){ head = head.slice(0, 140); more = true; }
    return head.replace(/\s+$/, "") + (more ? "…" : "");
  }

  function openList(){
    var c = S.ctx;
    if(!c) return;
    var items = histLoad();
    if(S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    S.root = null;
    var vw = window.innerWidth, vh = window.innerHeight, bot0 = vh - kbHeight() - 8;
    var w = Math.min(340, vw - 16);
    var box = document.createElement("div");
    box.className = "lt-ctx-list";
    box.style.width = w + "px";
    box.style.maxHeight = Math.max(120, Math.min(Math.round(vh * 0.6), bot0 - 8)) + "px";
    if(!items.length){
      box.innerHTML = '<div class="lt-ctx-empty">Пока ничего не скопировано</div>';
    }else{
      var h = "";
      for(var i = 0; i < items.length; i++){
        var p = preview(items[i]).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        h += '<button type="button" class="lt-ctx-item" data-i="' + i + '"><span>' + p + '</span></button>';
      }
      box.innerHTML = h;
    }
    box.addEventListener("mousedown", function(e){ e.preventDefault(); });
    box.addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
      if(!b) return;
      var full = histLoad()[parseInt(b.getAttribute("data-i"), 10)];
      var ctx = S.ctx;
      if(ctx) S.dismissed = sigOf(ctx);
      hide();
      if(full && ctx && !replaceSel(ctx, full)) toast("Не удалось вставить");
    });
    document.body.appendChild(box);
    var left = Math.round(Math.max(8, Math.min(vw - w - 8, S.cx - w / 2)));
    var hh = box.offsetHeight;
    var top = Math.round(Math.max(8, Math.min(bot0 - hh, S.cy - hh / 2)));
    box.style.left = left + "px";
    box.style.top = top + "px";
    S.listEl = box;
  }

  function onRootClick(e){
    var g = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if(!g) return;
    var act = g.getAttribute("data-act");
    var c = S.ctx;
    if(act === "close" || !c){ if(c) S.dismissed = sigOf(c); hide(); return; }
    if(g.getAttribute("class") && g.getAttribute("class").indexOf("lt-ctx-dis") !== -1) return;
    if(act === "hist"){ openList(); return; }
    S.dismissed = sigOf(c);
    hide();
    var N = window.LifeTrackerNative;
    var nativeToast = !!(N && typeof N.showToast !== "undefined");
    if(act === "copy"){
      copyText(c.text).then(function(ok){ if(!ok) toast("Не удалось скопировать"); else if(!nativeToast) toast("Скопировано"); });
    }else if(act === "cut"){
      copyText(c.text).then(function(ok){
        if(!ok){ toast("Не удалось скопировать"); return; }
        if(!replaceSel(c, "")) toast("Скопировано, но убрать не удалось");
        else if(!nativeToast) toast("Вырезано");
      });
    }else if(act === "paste"){
      readClipboard(function(t){
        if(!t){ toast("Буфер обмена пуст"); return; }
        if(!replaceSel(c, t)) toast("Не удалось вставить");
      });
    }else if(act === "fwd"){
      // у книги и другого текста «только для чтения» выделение остаётся на месте; в заметке и задаче — убирается
      var remove = c.kind === "ro" ? null : function(){ return replaceSel(c, ""); };
      S.hooks.sendToTask(c.text, { remove: remove });
    }
  }

  // ===================== КОГДА ПОКАЗЫВАТЬ =====================
  function arm(delay){
    clearTimeout(S.armT);
    S.armT = setTimeout(maybeShow, delay == null ? SHOW_DELAY : delay);
  }
  function maybeShow(){
    S.armT = 0;
    if(S.listEl) return;
    if(S.touchAt && Date.now() - S.touchAt < 3000) return; // палец ещё на экране: покажем после отпускания
    var c = readCtx();
    if(!c || !c.text || !c.text.replace(/\s+/g, "")) return;
    if(S.dismissed && S.dismissed === sigOf(c)) return;
    show(c, c.rect);
  }

  document.addEventListener("selectionchange", function(){
    if(S.listEl) return;
    if(S.root) hide();
    arm();
  });
  document.addEventListener("touchstart", function(e){
    var t = e.target;
    if(inOwnUi(t)) return;
    if(S.root || S.listEl) hide();
    S.dismissed = null; // новое касание вне круга: тап по выделенному тексту снова вызывает круг
    S.touchAt = Date.now();
    // долгое нажатие в поле ввода без выделенного слова — круг с «Вставить» и историей
    clearTimeout(S.lpT);
    if(e.touches && e.touches.length === 1 && t && !skipEl(t)){
      var editable = (t.isContentEditable) || (t.closest && t.closest(".cm-editor")) || isTextField(t);
      if(editable){
        S.lpX = e.touches[0].clientX; S.lpY = e.touches[0].clientY;
        S.lpT = setTimeout(onLongPress, LONG_PRESS_MS);
      }
    }
  }, true);
  document.addEventListener("touchmove", function(e){
    if(!S.lpT) return;
    var t0 = e.touches && e.touches[0];
    if(t0 && (Math.abs(t0.clientX - S.lpX) > 10 || Math.abs(t0.clientY - S.lpY) > 10)){ clearTimeout(S.lpT); S.lpT = 0; }
  }, true);
  function touchEnd(e){
    if(e && inOwnUi(e.target)) return;
    clearTimeout(S.lpT); S.lpT = 0;
    S.touchAt = 0;
    arm(250);
  }
  document.addEventListener("touchend", touchEnd, true);
  document.addEventListener("touchcancel", touchEnd, true);
  document.addEventListener("mouseup", function(e){
    if(inOwnUi(e.target)) return;
    arm(250);
  }, true);

  function onLongPress(){
    S.lpT = 0;
    S.touchAt = 0;
    var c = readCtx();
    if(!c) return;
    if(c.text && c.text.replace(/\s+/g, "")){ arm(0); return; } // выделено слово — обычный путь
    show(c, { left: S.lpX, right: S.lpX, top: S.lpY - 6, bottom: S.lpY + 6 });
  }

  // сдвинулась страница / набирают текст / закрыли окно — круг уже не там
  window.addEventListener("scroll", function(e){
    if(S.listEl && e && e.target && S.listEl.contains && S.listEl.contains(e.target)) return;
    if(S.root || S.listEl){ hide(); arm(); }
  }, true);
  window.addEventListener("resize", function(){ hide(); });
  document.addEventListener("keydown", function(){ if(S.root || S.listEl) hide(); }, true);
  document.addEventListener("input", function(){ if(S.root) hide(); }, true);
  document.addEventListener("visibilitychange", function(){ if(document.hidden) hide(); });
  window.addEventListener("popstate", function(){ hide(); });

  // ===================== ПУБЛИЧНОЕ =====================
  // hooks: { cm: {info(el)→{from,to,text}|null, replace(from,to,text)→bool}, sendToTask(text, {remove}) }
  window.LTCtx = {
    init: function(hooks){
      S.hooks = hooks || {};
      injectStyle();
    },
    hide: hide,
    toast: toast
  };
})();
