/* ===========================================================================
   system.js
   Версия: 2.1 (09.11)
   Вкладка «Система» (set2s_15, кнопка settingsTabSet2Btn15; язычок режима колеса — в вертикальном стеке набора 1 самый нижний).
   Здесь — функции, связанные с работой всей системы телефона. Сейчас две: «Использовать системный плавающий остров»
   (галочка, по умолчанию включена; мост ≥27 `islandGet` / `islandSetSystem` / `islandOpenOverlaySettings`; IslandSettings.kt) и
   «Усиление громкости в системе»
   (100 % по умолчанию / 125 % / 150 % / 200 %) и выбор способа усиления (1 — LoudnessEnhancer, 2 — DynamicsProcessing; мост ≥21, `volumeBoostSetEngine`): прошивки принимают эффекты по-разному. Звук усиливает оболочка Android (VolumeBoost.kt, служба
   VolumeBoostService.kt; мост LifeTrackerNative версии 20: volumeBoostGet / volumeBoostSet), страница только
   показывает выбор и состояние. В браузере без моста вкладка показывает пояснение.
   Точка входа — window.SystemTabMod.render(); my.js зовёт её из switchSettingsTab.
   =========================================================================== */
(function(){
  "use strict";

  var ROOT_ID = "systemTabRoot";
  var POLL_MS = 2000;
  var OPTIONS = [100, 125, 150, 200];
  var pollTimer = null;

  function bridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.volumeBoostSet === "function" && typeof b.volumeBoostGet === "function") ? b : null;
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function readState(){
    var b = bridge(); if(!b) return null;
    try{ return JSON.parse(b.volumeBoostGet() || "{}"); }catch(e){ return null; }
  }
  // Системный остров: нужен мост ≥27 (islandGet); на старой оболочке блок не показывается.
  function islandBridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.islandGet === "function" && typeof b.islandSetSystem === "function") ? b : null;
  }
  function readIsland(){
    var b = islandBridge(); if(!b) return null;
    try{ return JSON.parse(b.islandGet() || "{}"); }catch(e){ return null; }
  }

  function ensureStyle(){
    if(document.getElementById("systemTabStyle")) return;
    var st = document.createElement("style");
    st.id = "systemTabStyle";
    st.textContent =
      ".sys-card{padding:0 0 14px;}" +
      ".sys-title{font-size:16px;font-weight:700;color:var(--ink,#3b3350);margin:0 0 4px;}" +
      ".sys-sub{font-size:13px;color:var(--ink-soft,#6a6080);margin:0 0 10px;line-height:1.35;}" +
      ".sys-opts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;}" +
      ".sys-opt{flex:1 1 60px;min-width:60px;font:inherit;font-size:15px;font-weight:600;padding:10px 6px;border-radius:10px;" +
      "border:1px solid var(--wood,#8f7fb8);background:var(--parchment,#f4f0f8);color:var(--wood-dark,#6a5a91);cursor:pointer;}" +
      ".sys-opt.on{background:var(--wood,#8f7fb8);color:var(--parchment,#f4f0f8);}" +
      ".sys-engine-title{font-size:13px;font-weight:600;color:var(--ink,#3b3350);margin:12px 0 6px;}" +
      ".sys-engine-sub{font-size:12px;color:var(--ink-soft,#6a6080);margin:0 0 8px;line-height:1.35;}" +
      ".sys-island-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 6px;font-size:15px;font-weight:600;color:var(--ink,#3b3350);}" +
      ".sys-island-row input[type=checkbox]{width:22px;height:22px;flex-shrink:0;accent-color:var(--wood,#8f7fb8);}" +
      ".sys-island-perm{font:inherit;font-size:14px;font-weight:600;padding:8px 12px;margin:6px 0 0;border-radius:10px;border:1px solid var(--wood,#8f7fb8);" +
      "background:var(--parchment,#f4f0f8);color:var(--wood-dark,#6a5a91);cursor:pointer;}" +
      ".sys-divider{border:0;border-top:1px solid var(--wood,#8f7fb8);opacity:.25;margin:14px 0;}" +
      ".sys-status{font-size:13px;line-height:1.35;min-height:18px;color:var(--ink-soft,#6a6080);}" +
      ".sys-status.ok{color:var(--status-ok,#2fa15f);}" +
      ".sys-status.err{color:var(--status-err,#b0432e);}";
    document.head.appendChild(st);
  }

  function statusText(st){
    if(!st) return { cls: "", text: "" };
    if(st.pct <= 100) return { cls: "", text: "Усиление выключено." };
    if(st.works) return { cls: "ok", text: "Включено: звук всей системы усилен до " + st.pct + " %. Пока усиление включено, в шторке висит уведомление." };
    return { cls: "err", text: "Телефон не применил усиление" + (st.error ? " (" + esc(st.error) + ")" : "") +
      ". На части прошивок общий звук нельзя усилить обычному приложению." };
  }

  function paint(st){
    var root = document.getElementById(ROOT_ID);
    if(!root) return;
    var pct = st ? st.pct : 100;
    var btns = root.querySelectorAll(".sys-opt");
    for(var i = 0; i < btns.length; i++){
      btns[i].classList.toggle("on", Number(btns[i].getAttribute("data-pct")) === pct);
    }
    var eng = st && st.engine === 1 ? 1 : 0;
    var eb = root.querySelectorAll(".sys-eng");
    for(var j = 0; j < eb.length; j++){
      eb[j].classList.toggle("on", Number(eb[j].getAttribute("data-eng")) === eng);
    }
    var s = statusText(st);
    var el = document.getElementById("systemBoostStatus");
    if(el){ el.className = "sys-status " + s.cls; el.innerHTML = s.text; }
  }

  function paintIsland(st){
    var cb = document.getElementById("systemIslandCb");
    var hint = document.getElementById("systemIslandHint");
    var btn = document.getElementById("systemIslandPermBtn");
    if(!cb) return;
    if(st && typeof st.system === "boolean") cb.checked = st.system;
    // Без галочки плашка вне приложения рисуется поверх других окон — для этого нужно разрешение «Поверх других приложений».
    var needPerm = !!(st && st.system === false && st.overlay === false);
    if(hint){
      hint.className = "sys-status" + (needPerm ? " err" : "");
      hint.textContent = needPerm ? "Не выдано разрешение «Поверх других приложений» (на Xiaomi — «Отображение всплывающих окон»): без него плашка вне приложения не появится." : "";
    }
    if(btn) btn.style.display = needPerm ? "" : "none";
  }

  function stopPoll(){
    if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
    document.removeEventListener("visibilitychange", onVisible);
  }
  function onVisible(){
    if(document.hidden) return;
    if(!document.getElementById(ROOT_ID)){ stopPoll(); return; }
    paint(readState());
    paintIsland(readIsland());
  }
  function startPoll(){
    stopPoll();
    // состояние может поменяться снаружи (кнопка «Выключить» в уведомлении) — пока вкладка на экране, перечитываем
    pollTimer = setInterval(function(){
      if(!document.getElementById(ROOT_ID)){ stopPoll(); return; }
      if(!document.hidden){ paint(readState()); paintIsland(readIsland()); }
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }

  function render(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    ensureStyle();
    var b = bridge();
    if(!b){
      c.innerHTML =
        '<h3 class="common-tab-title">Система</h3>' +
        '<div class="mood-diagram-empty">Вкладка «Система» работает только в приложении (APK) с обновлённой оболочкой.</div>';
      return;
    }
    var opts = "";
    for(var i = 0; i < OPTIONS.length; i++){
      opts += '<button type="button" class="sys-opt" data-pct="' + OPTIONS[i] + '">' + OPTIONS[i] + ' %</button>';
    }
    var ib = islandBridge();
    var islandHtml = ib ?
      '<div class="sys-card">' +
        '<label class="sys-island-row"><span>Использовать системный плавающий остров</span><input type="checkbox" id="systemIslandCb" checked></label>' +
        '<div class="sys-sub">По умолчанию включено. Если выключить, функции приложения работают плавнее, а таймеры, секундомер, помодоро и музыку показывает собственная плашка у выреза камеры: она висит постоянно, в том числе поверх других приложений. Но она может перекрыть системный остров других приложений.</div>' +
        '<div class="sys-status" id="systemIslandHint"></div>' +
        '<button type="button" class="sys-island-perm" id="systemIslandPermBtn" style="display:none">Выдать разрешение</button>' +
      '</div><hr class="sys-divider">' : '';
    c.innerHTML =
      '<div id="' + ROOT_ID + '">' +
        '<h3 class="common-tab-title">Система</h3>' +
        islandHtml +
        '<div class="sys-card">' +
          '<div class="sys-title">Усиление громкости в системе</div>' +
          '<div class="sys-sub">Усиливает звук всех приложений. 100 % — без усиления. Выше 100 % звук может хрипеть, а на полной громкости — вредить слуху и динамикам: начните со 125 %.</div>' +
          '<div class="sys-opts">' + opts + '</div>' +
          '<div class="sys-status" id="systemBoostStatus"></div>' +
          (typeof b.volumeBoostSetEngine === "function" ?
            '<div class="sys-engine-title">Способ усиления</div>' +
            '<div class="sys-engine-sub">Если на 125–200 % громкость не меняется, переключите способ: телефоны принимают их по-разному.</div>' +
            '<div class="sys-opts"><button type="button" class="sys-opt sys-eng" data-eng="0">1</button>' +
            '<button type="button" class="sys-opt sys-eng" data-eng="1">2</button></div>' : '') +
        '</div>' +
      '</div>';
    var root = document.getElementById(ROOT_ID);
    root.addEventListener("click", function(ev){
      var t = ev.target;
      while(t && t !== root && !(t.classList && t.classList.contains("sys-opt"))) t = t.parentNode;
      if(!t || t === root) return;
      if(t.classList.contains("sys-eng")){
        var est = null;
        try{ est = JSON.parse(b.volumeBoostSetEngine(Number(t.getAttribute("data-eng"))) || "{}"); }catch(e){ est = null; }
        paint(est && est.pct ? est : readState());
        return;
      }
      var pct = Number(t.getAttribute("data-pct"));
      var st = null;
      try{ st = JSON.parse(b.volumeBoostSet(pct) || "{}"); }catch(e){ st = null; }
      paint(st && st.pct ? st : readState());
    });
    var icb = document.getElementById("systemIslandCb");
    if(icb && ib){
      icb.addEventListener("change", function(){
        var st = null;
        try{ st = JSON.parse(ib.islandSetSystem(!!icb.checked) || "{}"); }catch(e){ st = null; }
        paintIsland(st && typeof st.system === "boolean" ? st : readIsland());
      });
      var pbtn = document.getElementById("systemIslandPermBtn");
      if(pbtn) pbtn.addEventListener("click", function(){
        if(typeof ib.islandOpenOverlaySettings === "function"){ try{ ib.islandOpenOverlaySettings(); }catch(e){} }
      });
    }
    paint(readState());
    paintIsland(readIsland());
    startPoll();
  }

  window.SystemTabMod = { render: render };
})();
