/* ===========================================================================
   claudetab.js
   Версия: 2.1 (28.11) — учёт «когда вкладке Claude последний раз давали задачу через приложение» (localStorage `claudeTabLastSent_v1`, {id вкладки: время}, только это устройство) и выбор свободного агента: `pickFreeTab()` — вкладка, которой не давали задач последние 5 ч 1 мин (из нескольких — та, что простаивает дольше всех; не бывало задач — раньше всех), `nextFreeAt()` — когда освободится ближайшая. Время ставится при принятой оболочкой отправке и откатывается, если пришёл итог «не отправлено». Откат: claudetab.js 2.0.
   Версия: 2.0 (28.11) — `focusTab(id)`: выбрать вкладку ряда перед показом вкладки Claude (нажатие на карточку агента в острове открывает вкладку, где он работает). Откат: claudetab.js 1.9.
   Версия: 1.9 (28.11) — режим «Обычная задача»: `canSendPlain()` и `sendTask(tabId, taskId, text, images, plain)` — при plain задача уходит как есть (текст + картинки), без архива репозитория и без автокоммита (мост `claudeSendTaskPlain`). Стили второй плашки выбора режима. Откат: claudetab.js 1.8.
   Версия: 1.8 (27.11) — `sendTask`: пока задача с этим id отправляется (итог ещё не пришёл), повторный вызов не отправляет её второй раз и не увеличивает счётчик ожидания (защита от дубля сообщения в чате). Откат: claudetab.js 1.7.
   Версия: 1.7 (25.11) — отправка задачи с картинками: `sendTask(tabId, taskId, text, images)`, где images — [{name, mime, b64}] (мост `claudeSendTaskImages`); `canSendImages()` — есть ли такой метод в оболочке. Без картинок всё как раньше. Откат: claudetab.js 1.6.
   Версия: 1.6 (24.11) — отправка задачи в новый диалог выбранной вкладки Claude (сундучок у задачи, my.js): `ClaudeTabMod.sendTask(tabId, taskId, text)` → мост `claudeSendTask` (оболочка в фоне скачивает архив репозитория, открывает claude.ai/new в этой вкладке, прикрепляет архив и отправляет текст задачи); итог приходит опросом `claudeTaskResults` → `ClaudeTabMod.onTaskResult(taskId, ok, msg)`. Также наружу: `tabIds()` (номера вкладок для выбора), `canSendTask()`, `ensureStyle()`, `tabIconHtml(n)`. Нужен мост с методами claudeSendTask/claudeTaskResults (иначе выбор показывает пояснение).
   Версия: 1.5 (24.11) — ряд вкладок Claude внутри вкладки: колонка слева от бокового ряда (выходит из его вкладок, начиная со второй: нижняя вкладка бокового ряда стоит над нижним рядом кнопок приложения, из неё ничего не выходит). Первая вкладка нового ряда — прежняя «Claude» (вход общий, как раньше), над ней «+»: новая вкладка Claude БЕЗ входа, у каждой вкладки свой вход (профиль WebView, ClaudeTabs.kt/ClaudeTab.kt 1.8). Долгое нажатие на добавленную вкладку (1 с) → крестик, следующее нажатие закрывает её вместе со входом. Список вкладок — localStorage `claudeTabs_v1` ({tabs:[id], cur}), только на этом устройстве. Нужны методы моста claudeSelect/claudeRemove/claudeTabsSupported (иначе ряда нет, вкладка одна, как раньше). claude.ai укорачивается по колонке (она не должна лежать под нативным WebView).
   Версия: 1.4 (24.11) — убрана верхняя полоса («Что отправлять» + статус): текст автоотправки остаётся прежним (сохранённый, по умолчанию «Дальше»), статус автоотправки — во всплывающей подсказке кнопки «Авто». Добавлена кнопка «i» (самая левая в нижнем ряду): экран с короткими пояснениями ко всем кнопкам вкладки.
   Версия: 1.3 (20.11) — кнопки «Авто», «⏱ 5 ч», «Тест», «⟳» перенесены в нижний ряд (#siteFabRow, слева от «полного экрана» и «домика»), а claude.ai растянут на всю область и заходит под них: оболочка прорезывает «окна» под кнопки (мост claudeHoles, как у вкладок-сайтов; без него сайт заканчивается над рядом). Вверху остались только поле «Что отправлять» и статус (виден, пока включено «Авто»).
   Версия: 1.2 (03.11)
   Вкладка «Claude» (set2s_10, верхняя в вертикальном стеке второго набора, над «Карточками предметов»).
   Сам claude.ai показывает ОБОЛОЧКА: второй WebView поверх области #claudeTabView (мост LifeTrackerNative,
   версия 9: claudeShow/claudeHide/...). Здесь — только верхняя панель (автоотправка «Дальше» после снятия
   лимита) и пустая область, чей прямоугольник отправляется оболочке. В браузере (без моста) вкладка
   показывает пояснение. Точка входа — window.ClaudeTabMod.{render, onSwitch, hide}; my.js вызывает
   render из switchSettingsTab и onSwitch/hide при уходе с вкладки и закрытии окна настроек.
   =========================================================================== */
(function(){
  "use strict";
  var TAB = "set2s_10";
  var active = false;
  var timer = null;
  var lastRect = "";
  var lastPoll = 0;
  var TABS_KEY = "claudeTabs_v1";
  var MAIN = "main";
  var ID_OK = /^[a-z0-9]{1,24}$/;
  var LONG_MS = 1000, ARM_MS = 4000;
  var extra = [];          // id добавленных вкладок (порядок создания)
  var curId = MAIN;        // выбранная вкладка ряда
  var armedId = null, armTimer = null;
  var multiCache = null;

  function loadTabs(){
    try{
      var o = JSON.parse(localStorage.getItem(TABS_KEY) || "{}");
      extra = (o && Array.isArray(o.tabs) ? o.tabs : []).filter(function(id, i, a){ return typeof id === "string" && ID_OK.test(id) && id !== MAIN && a.indexOf(id) === i; });
      curId = (o && typeof o.cur === "string" && (o.cur === MAIN || extra.indexOf(o.cur) >= 0)) ? o.cur : MAIN;
    }catch(e){ extra = []; curId = MAIN; }
  }
  function saveTabs(){ try{ localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: extra, cur: curId })); }catch(e){} }
  loadTabs();

  // несколько вкладок возможны, если оболочка новая и WebView умеет отдельные профили
  function multiOk(b){
    if(multiCache === null){
      multiCache = false;
      try{
        if(typeof b.claudeSelect === "function" && typeof b.claudeRemove === "function" && typeof b.claudeTabsSupported === "function") multiCache = !!b.claudeTabsSupported();
      }catch(e){}
    }
    return multiCache;
  }

  function bridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.claudeShow === "function") ? b : null;
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function readState(){
    var b = bridge(); if(!b) return {};
    try{ return JSON.parse(b.claudeGetState() || "{}"); }catch(e){ return {}; }
  }
  function hhmm(ts){ var d = new Date(ts); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }

  function ensureStyle(){
    if(document.getElementById("claudeTabStyle")) return;
    var st = document.createElement("style");
    st.id = "claudeTabStyle";
    st.textContent =
      ".claude-tab-bar{display:flex;gap:6px;align-items:center;padding:6px 0;}" +
      ".claude-tab-bar input{flex:1 1 90px;min-width:70px;font:inherit;font-size:14px;padding:6px 10px;border-radius:8px;" +
      "border:1px solid var(--wood,#5b4a8a);background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);}" +
      ".claude-tab-status{flex:0 1 55%;min-width:0;font-size:12px;line-height:1.3;padding:5px 8px;border-radius:8px;" +
      "background:#fffef8;border:1px solid var(--groove-shadow,#b9b0a0);color:var(--wood,#5b4a8a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".claude-tab-status:empty{display:none;}" +
      "#claudeTabView{width:100%;box-sizing:border-box;}" +
      ".claude-sub-tabs{position:absolute;inset-inline-end:0;bottom:0;z-index:3;display:flex;flex-direction:column-reverse;gap:1px;pointer-events:none;}" +
      ".claude-sub-tab,.claude-sub-gap{width:35px;height:var(--tab-len,60px);flex:0 0 var(--tab-len,60px);box-sizing:border-box;}" +
      ".claude-sub-gap{visibility:hidden;}" +
      ".claude-sub-tab{pointer-events:auto;position:relative;display:flex;align-items:center;justify-content:center;padding:0;margin:0;border:none;outline:none;" +
        "-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;cursor:pointer;" +
        "background:var(--tab-bg,var(--parchment));color:var(--wood);border-radius:0;border-start-start-radius:14px;border-end-start-radius:14px;" +
        "box-shadow:calc(-2px * var(--hand-sign,1)) 2px 5px rgba(0,0,0,.3);}" +
      ".claude-sub-tab svg{width:26px;height:26px;}" +
      ".claude-sub-tab.active{background:var(--wood);color:var(--parchment);}" +
      ".claude-sub-tab .claude-sub-num{position:absolute;bottom:3px;inset-inline-start:5px;font-size:10px;line-height:1;font-weight:700;}" +
      ".claude-sub-tab.armed{background:#b23b3b;color:#fff;}" +
      // плашка выбора вкладки Claude для задачи (сундучок): те же кнопки, что в ряду вкладок, но россыпью
      ".claude-pick-overlay{position:fixed;inset:0;z-index:1700;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);padding:16px;box-sizing:border-box;}" +
      ".claude-pick{max-width:92vw;max-height:80vh;overflow:auto;box-sizing:border-box;padding:12px 14px 14px;border-radius:16px;background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);border:1px solid var(--wood,#5b4a8a);box-shadow:0 4px 18px rgba(0,0,0,.4);}" +
      ".claude-pick-title{font-size:14px;line-height:1.3;margin:0 0 10px;text-align:center;}" +
      ".claude-pick-note{font-size:13px;line-height:1.4;max-width:260px;}" +
      ".claude-pick-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}" +
      ".claude-pick-row .claude-sub-tab{width:44px;height:56px;flex:0 0 44px;border-radius:12px;border:1px solid var(--wood,#5b4a8a);box-shadow:1px 2px 5px rgba(0,0,0,.3);}" +
      // вторая плашка: режим отправки (fix.zip / обычная задача)
      ".claude-pick-modes{display:flex;flex-direction:column;gap:8px;min-width:200px;}" +
      ".claude-pick-mode{display:block;width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid var(--wood,#5b4a8a);background:var(--tab-bg,var(--parchment,#f4f0f8));color:var(--wood,#5b4a8a);font:inherit;font-size:15px;line-height:1.2;text-align:center;box-shadow:1px 2px 5px rgba(0,0,0,.3);cursor:pointer;-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;}" +
      ".claude-pick-mode:active{background:var(--wood,#5b4a8a);color:var(--parchment,#f4f0f8);}";
    document.head.appendChild(st);
  }

  // нижний ряд «полный экран + домик» (my.js, mountSiteFabRow)
  function mountFab(c){
    try{
      if(window.SiteTabFab) window.SiteTabFab.mount(c, function(){
        var b = bridge();
        if(b && typeof b.claudeHome === "function"){ try{ b.claudeHome(); }catch(e){} }
      });
    }catch(e){}
  }

  // значки кнопок ряда — те же штрихи, что у остальных кнопок (16px, currentColor)
  function svg(d){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  var ICON_AUTO = svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>');
  var ICON_TIMER = svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>');
  var ICON_SEND = svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>');
  var ICON_RELOAD = svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>');

  var ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M12 11v6"></path><circle cx="12" cy="7.7" r="1" fill="currentColor" stroke="none"></circle></svg>';
  var ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>';

  // кнопка нижнего ряда (#siteFabRow, my.js mountSiteFabRow): встаёт левее «полного экрана»
  function addRowBtn(id, title, icon){
    var row = document.getElementById("siteFabRow");
    var bt = document.createElement("button");
    bt.type = "button";
    bt.className = "mdeditor-fab-btn";
    bt.id = id;
    if(title){ bt.title = title; bt.setAttribute("aria-label", title); }
    bt.innerHTML = icon;
    if(row) row.insertBefore(bt, document.getElementById("siteFullscreenBtn"));
    return bt;
  }

  // оболочка умеет «окна»: claude.ai растянут под кнопки нижнего ряда, а в местах кнопок не рисуется (сквозь окна видна страница)
  var holeSupport = null;
  function holesOk(b){
    if(holeSupport === null){
      holeSupport = false;
      if(typeof b.claudeHoles === "function"){ try{ holeSupport = !!b.claudeHoles(""); }catch(e){} }
    }
    return holeSupport;
  }
  // прямоугольники кнопок ряда: «x,y,w,h;x,y,w,h»
  function holesOf(row){
    var out = [], btns = row.querySelectorAll(".mdeditor-fab-btn");
    for(var i = 0; i < btns.length; i++){
      var r = btns[i].getBoundingClientRect();
      if(r.width > 0 && r.height > 0) out.push([r.left, r.top, r.width, r.height].map(function(n){ return Math.round(n * 10) / 10; }).join(","));
    }
    return out.join(";");
  }

  // ---------- ряд вкладок Claude (слева от бокового ряда) ----------
  var ICON_CLAUDE = svg('<path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-8l-4.5 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/><path d="M12 8v5M9.5 9.5l5 2M14.5 9.5l-5 2"/>');
  var ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>');
  var ICON_CROSS = svg('<path d="M6 6l12 12M18 6L6 18"/>');

  function subRow(){ return document.getElementById("claudeSubTabs"); }
  function unmountRow(){
    var r = subRow();
    if(r && r.parentNode) r.parentNode.removeChild(r);
    armedId = null;
    if(armTimer){ clearTimeout(armTimer); armTimer = null; }
  }
  // колонка стоит в рамке окна (там же, где боковой ряд), прижата к низу; первая ячейка — пустая: напротив нижней вкладки бокового ряда ничего нет
  function mountRow(){
    var frame = document.querySelector(".settings-modal-frame");
    if(!frame) return;
    var r = subRow();
    if(!r){
      r = document.createElement("div");
      r.id = "claudeSubTabs";
      r.className = "claude-sub-tabs";
      frame.appendChild(r);
    }
    paintRow();
  }
  function newId(){
    for(var n = 0; n < 20; n++){
      var id = Math.random().toString(36).slice(2, 8);
      if(ID_OK.test(id) && id !== MAIN && extra.indexOf(id) < 0) return id;
    }
    return "t" + Date.now().toString(36);
  }
  function paintRow(){
    var r = subRow();
    if(!r) return;
    r.innerHTML = "";
    var gap = document.createElement("div");
    gap.className = "claude-sub-gap";
    r.appendChild(gap);
    var ids = [MAIN].concat(extra);
    ids.forEach(function(id, i){
      var bt = document.createElement("button");
      bt.type = "button";
      bt.className = "claude-sub-tab" + (id === curId ? " active" : "") + (id === armedId ? " armed" : "");
      bt.setAttribute("data-claude-tab", id);
      var t = id === armedId ? "Нажмите ещё раз, чтобы закрыть вкладку вместе с входом" : "Claude " + (i + 1);
      bt.title = t; bt.setAttribute("aria-label", t);
      bt.innerHTML = (id === armedId ? ICON_CROSS : ICON_CLAUDE + '<span class="claude-sub-num">' + (i + 1) + '</span>');
      bindTab(bt, id);
      r.appendChild(bt);
    });
    var add = document.createElement("button");
    add.type = "button";
    add.className = "claude-sub-tab";
    add.id = "claudeSubAddBtn";
    add.title = "Новая вкладка Claude (без входа)"; add.setAttribute("aria-label", add.title);
    add.innerHTML = ICON_PLUS;
    add.addEventListener("click", addTab);
    r.appendChild(add);
    lastRect = ""; // колонка могла сдвинуться — пересчитать область claude.ai
  }
  function bindTab(bt, id){
    var timer2 = null, longFired = false;
    function start(){
      longFired = false;
      if(timer2){ clearTimeout(timer2); timer2 = null; }
      if(id === MAIN) return; // первую вкладку закрыть нельзя
      timer2 = setTimeout(function(){ timer2 = null; longFired = true; arm(id); }, LONG_MS);
    }
    function end(){ if(timer2){ clearTimeout(timer2); timer2 = null; } }
    bt.addEventListener("touchstart", start, { passive: true });
    bt.addEventListener("touchend", end);
    bt.addEventListener("touchcancel", end);
    bt.addEventListener("touchmove", end, { passive: true });
    bt.addEventListener("mousedown", start);
    bt.addEventListener("mouseup", end);
    bt.addEventListener("mouseleave", end);
    bt.addEventListener("contextmenu", function(e){ e.preventDefault(); });
    bt.addEventListener("click", function(){
      if(longFired){ longFired = false; return; }
      if(armedId === id){ removeTab(id); return; }
      if(armedId){ armedId = null; paintRow(); }
      selectTab(id);
    });
  }
  function arm(id){
    armedId = id;
    paintRow();
    if(armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(function(){ armTimer = null; armedId = null; paintRow(); }, ARM_MS);
  }
  function selectTab(id){
    if(id === curId) return;
    hideNative();
    curId = id;
    saveTabs();
    render();
  }
  function addTab(){
    var id = newId();
    extra.push(id);
    hideNative();
    curId = id;
    saveTabs();
    render();
  }
  function removeTab(id){
    var b = bridge();
    armedId = null;
    if(armTimer){ clearTimeout(armTimer); armTimer = null; }
    extra = extra.filter(function(x){ return x !== id; });
    if(b){ try{ b.claudeRemove(id); }catch(e){} }
    if(curId === id){
      hideNative();
      curId = MAIN;
      saveTabs();
      render();
    }else{
      saveTabs();
      paintRow();
    }
  }

  function render(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    var b = bridge();
    if(!b){
      c.innerHTML = '<div class="mood-diagram-empty">Вкладка Claude работает только в приложении (APK) с обновлённой оболочкой.</div>';
      mountFab(c);
      return;
    }
    ensureStyle();
    var multi = multiOk(b);
    if(multi){
      if(curId !== MAIN && extra.indexOf(curId) < 0) curId = MAIN;
      try{ b.claudeSelect(curId); }catch(e){}
    }
    var st = readState();
    var text = st.text || "Дальше";
    c.innerHTML = '<div id="claudeTabView"></div>';

    mountFab(c); // ряд кнопок создаётся здесь; свои кнопки встают в него левее «полного экрана» и «домика»
    var infoBtn = addRowBtn("claudeInfoBtn", "Информация", ICON_INFO);
    var autoBtn = addRowBtn("claudeAutoBtn", "", ICON_AUTO);
    var armBtn = addRowBtn("claudeArmBtn", "Отправить через 5 часов, даже если плашка лимита не распознана", ICON_TIMER);
    var testBtn = addRowBtn("claudeTestBtn", "Отправить текст в чат сейчас", ICON_SEND);
    var reloadBtn = addRowBtn("claudeReloadBtn", "Обновить страницу", ICON_RELOAD);
    function paintAuto(on){
      autoBtn.classList.toggle("pressed", !!on);
      var t = "Авто: " + (on ? "вкл" : "выкл") + " — отправлять текст после снятия лимита";
      var stt = statusText();
      if(on && stt) t += ". " + stt;
      autoBtn.title = t; autoBtn.setAttribute("aria-label", t);
    }
    paintAuto(!!st.auto);
    function apply(enabled){
      try{ b.claudeSetAuto(!!enabled, text); }catch(e){}
      paintAuto(enabled);
      updateStatus();
    }
    autoBtn.addEventListener("click", function(){ apply(!autoBtn.classList.contains("pressed")); });
    infoBtn.addEventListener("click", function(){ renderInfo(); });
    armBtn.addEventListener("click", function(){
      if(!autoBtn.classList.contains("pressed")) apply(true);
      try{ b.claudeArm(300); }catch(e){}
    });
    testBtn.addEventListener("click", function(){ try{ b.claudeSendNow(); }catch(e){} });
    reloadBtn.addEventListener("click", function(){ try{ b.claudeReload(); }catch(e){} });

    if(multi) mountRow(); else unmountRow();
    updateStatus();
    active = true;
    lastRect = "";
    startTimer();
    sizeAndPush();
    setTimeout(sizeAndPush, 120);
  }

  // область под полем ввода растягивается до низа содержимого вкладки (под кнопки); прямоугольник и «окна» под кнопки отправляются оболочке
  function sizeAndPush(){
    var c = document.getElementById("settingsTabContent");
    var v = document.getElementById("claudeTabView");
    var b = bridge();
    if(!active || !c || !v || !b) return;
    var cr = c.getBoundingClientRect();
    var pad = parseFloat(getComputedStyle(c).paddingBottom) || 0;
    var top = v.getBoundingClientRect().top;
    var bottom = cr.bottom - pad;
    // ряд вкладок стоит справа (или слева у левши) на краю содержимого: claude.ai не должен заходить под него — нативный WebView лежит поверх страницы
    var cs = getComputedStyle(c);
    var innerL = cr.left + (parseFloat(cs.paddingLeft) || 0), innerR = cr.right - (parseFloat(cs.paddingRight) || 0);
    var baseL = innerL;
    var sr = subRow();
    if(sr){
      var kr = sr.getBoundingClientRect();
      if(kr.width > 0){
        if(kr.left > (cr.left + cr.right) / 2) innerR = Math.min(innerR, kr.left - 2);
        else innerL = Math.max(innerL, kr.right + 2);
      }
    }
    v.style.marginLeft = Math.round(innerL - baseL) + "px";
    v.style.width = Math.max(120, Math.floor(innerR - innerL)) + "px";
    var row = document.getElementById("siteFabRow");
    var holes = "";
    if(row){
      if(holesOk(b)) holes = holesOf(row);
      else{ // без «окон» нативный WebView лежит поверх страницы — сайт заканчивается над рядом кнопок
        var rr = row.getBoundingClientRect();
        if(rr.height > 0) bottom = Math.min(bottom, rr.top - 4);
      }
    }
    var h = Math.max(160, Math.floor(bottom - top));
    v.style.height = h + "px";
    var r = v.getBoundingClientRect();
    var key = [r.left, r.top, r.width, r.height].map(Math.round).join(",") + "|" + holes;
    if(key === lastRect) return;
    lastRect = key;
    try{ b.claudeShow(r.left, r.top, r.width, r.height); }catch(e){}
    if(holeSupport){ try{ b.claudeHoles(holes); }catch(e){} }
  }

  function statusText(){
    var st = readState(), s = st.status || {}, msg;
    if(!st.created) msg = "Страница загружается…";
    else if(!st.auto) msg = "Автоотправка выключена";
    else if(s.hit && s.resetAt) msg = "Лимит: жду до " + hhmm(s.resetAt) + (s.info ? " · " + s.info : "");
    else if(s.info) msg = s.info;
    else msg = "Автоотправка включена, лимит не обнаружен";
    return st.auto ? msg : "";
  }
  // полосы больше нет — статус виден в подсказке кнопки «Авто» (title)
  function updateStatus(){
    var autoBtn = document.getElementById("claudeAutoBtn");
    if(!autoBtn) return;
    var on = autoBtn.classList.contains("pressed");
    var t = "Авто: " + (on ? "вкл" : "выкл") + " — отправлять текст после снятия лимита";
    var stt = statusText();
    if(on && stt) t += ". " + stt;
    autoBtn.title = t; autoBtn.setAttribute("aria-label", t);
  }

  // экран «i»: короткие пояснения к кнопкам; нативный claude.ai на это время прячется, «домик» возвращает на вкладку
  function renderInfo(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    hideNative();
    function item(icon, txt){
      return '<div class="task-info-item"><div class="task-info-icon">' + icon + '</div><div class="task-info-text">' + txt + '</div></div>';
    }
    var fs = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    c.innerHTML =
      '<h3 class="common-tab-title">Claude — кнопки</h3>' +
      '<div class="task-info-body">' +
        item(ICON_AUTO, "Авто: после снятия лимита сам отправляет в чат «Дальше». Горит — включено.") +
        item(ICON_TIMER, "Отправит текст через 5 часов, даже если Claude не показал плашку лимита.") +
        item(ICON_SEND, "Отправляет текст в чат прямо сейчас — проверить, что всё работает.") +
        item(ICON_RELOAD, "Перезагружает страницу Claude.") +
        item(fs, "Полный экран: скрывает строку состояния телефона.") +
        item(ICON_HOME, "Домик: возвращает на главную страницу Claude.") +
        item(ICON_PLUS, "Ряд слева: «+» открывает ещё одну вкладку Claude без входа. Вход в каждой вкладке свой и сохраняется. Долгое нажатие на вкладку и ещё одно нажатие — закрыть её (первую закрыть нельзя).") +
      '</div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn" id="claudeInfoHomeBtn" title="Назад к Claude">' + ICON_HOME + '</button>' +
      '</div>';
    document.getElementById("claudeInfoHomeBtn").addEventListener("click", function(){ render(); });
  }

  function startTimer(){
    if(timer) return;
    timer = setInterval(function(){
      sizeAndPush();
      var now = Date.now();
      if(now - lastPoll > 2000){ lastPoll = now; updateStatus(); }
    }, 400);
    window.addEventListener("resize", sizeAndPush);
  }
  function stopTimer(){
    if(timer){ clearInterval(timer); timer = null; }
    window.removeEventListener("resize", sizeAndPush);
  }

  // спрятать нативный claude.ai (ряд вкладок остаётся: так нужно экрану «i» и переключению вкладок)
  function hideNative(){
    var was = active;
    active = false;
    lastRect = "";
    stopTimer();
    var b = bridge();
    if(was && b){ try{ b.claudeHide(); }catch(e){} }
  }
  // уход с вкладки Claude или закрытие окна: прячется и ряд вкладок
  function hide(){
    hideNative();
    unmountRow();
  }
  function onSwitch(tab){ if(tab !== TAB) hide(); }

  // ---------- отправка задачи в новый диалог вкладки Claude (сундучок у задачи) ----------
  // Номера для выбора: порядок вкладок ряда (1 — первая, «main»); без поддержки нескольких вкладок — только первая.
  function tabIds(){
    var b = bridge(), ids = [MAIN];
    try{ if(b && multiOk(b)) ids = ids.concat(extra); }catch(e){}
    return ids;
  }
  function canSendTask(){
    var b = window.LifeTrackerNative;
    return !!(b && typeof b.claudeSendTask === "function" && typeof b.claudeTaskResults === "function");
  }
  function canSendImages(){
    var b = window.LifeTrackerNative;
    return !!(canSendTask() && typeof b.claudeSendTaskImages === "function");
  }
  function canSendPlain(){
    var b = window.LifeTrackerNative;
    return !!(canSendTask() && typeof b.claudeSendTaskPlain === "function");
  }
  function tabIconHtml(n){ return ICON_CLAUDE + '<span class="claude-sub-num">' + n + '</span>'; }

  var taskPollTimer = null, taskPendingCount = 0;
  var taskInflight = {}; // id задачи → {t: когда отправили, tab: вкладка, prev: прежнее «последний раз» вкладки}; снимается, когда пришёл итог (или через 6 минут)

  // ---------- свободный агент ----------
  // Агент = вкладка Claude. Свободен, если последние 5 часов и 1 минуту ему не давались задачи через приложение.
  var LAST_KEY = "claudeTabLastSent_v1";
  var FREE_MS = (5 * 60 + 1) * 60 * 1000;
  function lastLoad(){
    try{
      var o = JSON.parse(localStorage.getItem(LAST_KEY) || "{}");
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    }catch(e){ return {}; }
  }
  function lastSave(m){ try{ localStorage.setItem(LAST_KEY, JSON.stringify(m)); }catch(e){} }
  function lastOf(m, id){ var v = m[id]; return (typeof v === "number" && isFinite(v) && v > 0) ? v : 0; }
  // свободная вкладка (id) или null; из нескольких — та, что простаивает дольше всех (при равенстве — первая в ряду)
  function pickFreeTab(){
    var m = lastLoad(), now = Date.now(), best = null, bestT = Infinity;
    tabIds().forEach(function(id){
      var t = lastOf(m, id);
      if(now - t > FREE_MS && t < bestT){ best = id; bestT = t; }
    });
    return best;
  }
  // когда освободится ближайший агент (мс), или 0, если свободный уже есть / вкладок нет
  function nextFreeAt(){
    var m = lastLoad(), now = Date.now(), min = Infinity, ids = tabIds();
    for(var i = 0; i < ids.length; i++){
      var at = lastOf(m, ids[i]) + FREE_MS;
      if(at < now) return 0;
      if(at < min) min = at;
    }
    return min === Infinity ? 0 : min;
  }
  function taskPoll(){
    var b = window.LifeTrackerNative;
    if(!b || typeof b.claudeTaskResults !== "function") return;
    var arr = [];
    try{ arr = JSON.parse(b.claudeTaskResults() || "[]"); }catch(e){ arr = []; }
    if(!Array.isArray(arr)) arr = [];
    arr.forEach(function(r){
      if(!r || typeof r.id !== "string") return;
      if(taskPendingCount > 0) taskPendingCount--;
      var fl = taskInflight[r.id];
      if(fl && !r.ok){ // не отправлено — вкладка не получала задачу: возвращаем прежнее «последний раз», если его не перекрыла более новая отправка
        var lm = lastLoad();
        if(lm[fl.tab] === fl.t){ if(fl.prev) lm[fl.tab] = fl.prev; else delete lm[fl.tab]; lastSave(lm); }
      }
      delete taskInflight[r.id];
      try{ if(typeof api.onTaskResult === "function") api.onTaskResult(r.id, !!r.ok, String(r.msg || "")); }catch(e){}
    });
    if(taskPendingCount <= 0 && taskPollTimer){ clearInterval(taskPollTimer); taskPollTimer = null; taskPendingCount = 0; }
  }
  function taskPollStart(){ if(!taskPollTimer) taskPollTimer = setInterval(taskPoll, 2000); }
  // true — оболочка приняла задачу (дальше всё в фоне; итог — onTaskResult)
  // images — необязательный массив [{name, mime, b64}]: картинки задачи, которые уйдут в чат вместе с архивом
  // plain — «Обычная задача»: текст и картинки уходят как есть, без архива репозитория; автокоммит в этом чате не работает
  function sendTask(tabId, taskId, text, images, plain){
    var b = window.LifeTrackerNative;
    if(!canSendTask() || typeof taskId !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(taskId)) return false;
    if(taskInflight[taskId] && Date.now() - taskInflight[taskId].t < 6 * 60 * 1000) return true; // эта задача уже отправляется — второй раз не шлём
    var ok = false;
    try{
      if(plain){
        if(!canSendPlain()) return false;
        ok = !!b.claudeSendTaskPlain(String(tabId || MAIN), taskId, String(text || ""), JSON.stringify(images || []));
      }else if(images && images.length){
        if(!canSendImages()) return false;
        ok = !!b.claudeSendTaskImages(String(tabId || MAIN), taskId, String(text || ""), JSON.stringify(images));
      }else{
        ok = !!b.claudeSendTask(String(tabId || MAIN), taskId, String(text || ""));
      }
    }catch(e){ ok = false; }
    if(ok){
      var tid = String(tabId || MAIN), now = Date.now(), lm = lastLoad();
      taskInflight[taskId] = { t: now, tab: tid, prev: lastOf(lm, tid) };
      lm[tid] = now;
      lastSave(lm);
      taskPendingCount++; taskPollStart();
    }
    return ok;
  }
  // итоги прежних отправок (страницу могли перезагрузить, пока шла отправка)
  setTimeout(function(){ if(canSendTask()){ taskPendingCount = 1; taskPoll(); } }, 3000);

  // выбрать вкладку ряда (id или «main») без перерисовки: показ вкладки Claude (switchSettingsTab → render) подхватит выбор; неизвестный id — первая вкладка
  function focusTab(id){
    id = String(id || MAIN);
    if(id !== MAIN && extra.indexOf(id) < 0) loadTabs();
    if(id !== MAIN && extra.indexOf(id) < 0) id = MAIN;
    if(id === curId) return;
    if(active) hideNative();
    curId = id;
    saveTabs();
  }

  var api = { focusTab: focusTab, render: render, onSwitch: onSwitch, hide: hide,
    tabIds: tabIds, pickFreeTab: pickFreeTab, nextFreeAt: nextFreeAt, canSendTask: canSendTask, canSendImages: canSendImages, canSendPlain: canSendPlain, sendTask: sendTask, ensureStyle: ensureStyle, tabIconHtml: tabIconHtml, onTaskResult: null };
  window.ClaudeTabMod = api;
})();
