/* ===========================================================================
   claudetab.js
   Версия: 1.0 (21.10)
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
      ".claude-tab-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 0 6px;}" +
      ".claude-tab-bar button,.claude-tab-bar input{font:inherit;font-size:14px;padding:6px 10px;border-radius:8px;" +
      "border:1px solid var(--wood,#5b4a8a);background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);}" +
      ".claude-tab-bar input{flex:1 1 90px;min-width:70px;}" +
      ".claude-tab-bar button.on{background:var(--wood,#5b4a8a);color:var(--parchment,#f4f0f8);}" +
      ".claude-tab-status{font-size:12px;opacity:.85;min-height:16px;padding:0 0 6px;}" +
      "#claudeTabView{width:100%;}";
    document.head.appendChild(st);
  }

  function render(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    var b = bridge();
    if(!b){
      c.innerHTML = '<div class="mood-diagram-empty">Вкладка Claude работает только в приложении (APK) с обновлённой оболочкой.</div>';
      return;
    }
    ensureStyle();
    var st = readState();
    var text = st.text || "Дальше";
    c.innerHTML =
      '<div class="claude-tab-bar">' +
        '<button id="claudeAutoBtn" class="' + (st.auto ? "on" : "") + '">Авто: ' + (st.auto ? "вкл" : "выкл") + '</button>' +
        '<input id="claudeAutoText" type="text" maxlength="200" value="' + esc(text) + '" placeholder="Что отправлять">' +
        '<button id="claudeArmBtn" title="Отправить через 5 часов, даже если плашка лимита не распознана">⏱ 5 ч</button>' +
        '<button id="claudeTestBtn" title="Отправить текст в чат сейчас">Тест</button>' +
        '<button id="claudeReloadBtn" title="Обновить страницу">⟳</button>' +
      '</div>' +
      '<div class="claude-tab-status" id="claudeTabStatus"></div>' +
      '<div id="claudeTabView"></div>';

    var autoBtn = document.getElementById("claudeAutoBtn");
    var input = document.getElementById("claudeAutoText");
    function apply(enabled){
      try{ b.claudeSetAuto(!!enabled, input.value); }catch(e){}
      autoBtn.classList.toggle("on", !!enabled);
      autoBtn.textContent = "Авто: " + (enabled ? "вкл" : "выкл");
    }
    autoBtn.addEventListener("click", function(){ apply(!autoBtn.classList.contains("on")); });
    input.addEventListener("change", function(){ apply(autoBtn.classList.contains("on")); });
    document.getElementById("claudeArmBtn").addEventListener("click", function(){
      if(!autoBtn.classList.contains("on")) apply(true);
      try{ b.claudeArm(300); }catch(e){}
    });
    document.getElementById("claudeTestBtn").addEventListener("click", function(){ try{ b.claudeSendNow(); }catch(e){} });
    document.getElementById("claudeReloadBtn").addEventListener("click", function(){ try{ b.claudeReload(); }catch(e){} });

    active = true;
    lastRect = "";
    startTimer();
    sizeAndPush();
    setTimeout(sizeAndPush, 120);
  }

  // область под панелью растягивается до низа содержимого вкладки; прямоугольник отправляется оболочке
  function sizeAndPush(){
    var c = document.getElementById("settingsTabContent");
    var v = document.getElementById("claudeTabView");
    var b = bridge();
    if(!active || !c || !v || !b) return;
    var cr = c.getBoundingClientRect();
    var pad = parseFloat(getComputedStyle(c).paddingBottom) || 0;
    var top = v.getBoundingClientRect().top;
    var h = Math.max(160, Math.floor(cr.bottom - pad - top));
    v.style.height = h + "px";
    var r = v.getBoundingClientRect();
    var key = [r.left, r.top, r.width, r.height].map(Math.round).join(",");
    if(key === lastRect) return;
    lastRect = key;
    try{ b.claudeShow(r.left, r.top, r.width, r.height); }catch(e){}
  }

  function updateStatus(){
    var el = document.getElementById("claudeTabStatus");
    if(!el) return;
    var st = readState(), s = st.status || {}, msg;
    if(!st.created) msg = "Страница загружается…";
    else if(!st.auto) msg = "Автоотправка выключена";
    else if(s.hit && s.resetAt) msg = "Лимит: жду до " + hhmm(s.resetAt) + (s.info ? " · " + s.info : "");
    else if(s.info) msg = s.info;
    else msg = "Автоотправка включена, лимит не обнаружен";
    el.textContent = msg;
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
