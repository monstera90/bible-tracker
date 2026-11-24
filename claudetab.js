/* ===========================================================================
   claudetab.js
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
      "#claudeTabView{width:100%;}";
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
    hide();
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

  function hide(){
    var was = active;
    active = false;
    lastRect = "";
    stopTimer();
    var b = bridge();
    if(was && b){ try{ b.claudeHide(); }catch(e){} }
  }
  function onSwitch(tab){ if(tab !== TAB) hide(); }

  window.ClaudeTabMod = { render: render, onSwitch: onSwitch, hide: hide };
})();
