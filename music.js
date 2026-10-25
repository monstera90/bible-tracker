/* ===========================================================================
   music.js
   Версия: 1.1 (25.10) — жест «назад» поднимает на уровень выше: вход в подпапку кладёт возврат в стек window.AppNav (как везде в приложении), кнопка ← в шапке делает history.back().
   Версия: 1.0 (25.10)
   Вкладка «Музыка» (set2s_11, между «Забытыми заметками» и «Разделением epub»): библиотека и плеер.
   Звук играет оболочка Android (MusicPlayer.kt, служба MusicService.kt; мост LifeTrackerNative версии 13: musicGetFolder /
   musicPickFolder / musicList / musicPlay / musicToggle / musicNext / musicPrev / musicClose / musicState), здесь —
   только экран: выбор папки с музыкой при первом входе, список «папки и треки как есть» и тонкая полоса плеера прямо над
   нижним рядом вкладок (⏮ ⏯ ⏭ и ✕). Полоса видна только на этой вкладке; музыка при уходе с вкладки не прерывается.
   В браузере без моста вкладка показывает пояснение. Точка входа — window.MusicTab.render(); my.js зовёт её из
   switchSettingsTab. Опрос состояния плеера (раз в 500 мс) останавливается сам, когда экран вкладки пропал из DOM.
   =========================================================================== */
(function(){
  "use strict";

  var ROOT_ID = "musicTabRoot";
  var POLL_MS = 500;

  var stack = null;      // путь по папкам: [{id, name}], первый элемент — корень выбранной папки (id пустой)
  var folderName = "";
  var items = [];        // содержимое открытой папки
  var timer = null;
  var lastState = null;

  function bridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.musicList === "function") ? b : null;
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function parse(json, fallback){
    try{ return JSON.parse(json || ""); }catch(e){ return fallback; }
  }

  var ICON = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z"></path></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="16.5" cy="16" r="2.5"></circle></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.5" height="14" rx="1"></rect><path d="M19 5.5v13a.8.8 0 0 1-1.25.65l-9-6.5a.8.8 0 0 1 0-1.3l9-6.5A.8.8 0 0 1 19 5.5z"></path></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.5" y="5" width="2.5" height="14" rx="1"></rect><path d="M5 5.5v13a.8.8 0 0 0 1.25.65l9-6.5a.8.8 0 0 0 0-1.3l-9-6.5A.8.8 0 0 0 5 5.5z"></path></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z"></path></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"></rect><rect x="14" y="4.5" width="4" height="15" rx="1"></rect></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"></path></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z"></path><path d="M12 11v5M9.5 13.5h5"></path></svg>'
  };

  function ensureStyle(){
    if(document.getElementById("musicTabStyle")) return;
    var st = document.createElement("style");
    st.id = "musicTabStyle";
    st.textContent =
      "#musicTabRoot{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;color:var(--wood,#5b4a8a);}" +
      "#musicTabRoot .music-head{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:6px 2px;}" +
      "#musicTabRoot .music-path{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      "#musicTabRoot .music-ib{flex:0 0 auto;width:36px;height:36px;padding:7px;border-radius:8px;border:1px solid var(--wood,#5b4a8a);" +
        "background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);display:flex;align-items:center;justify-content:center;}" +
      "#musicTabRoot .music-ib svg{width:100%;height:100%;}" +
      "#musicTabRoot .music-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none;}" +
      "#musicTabRoot .music-list::-webkit-scrollbar{display:none;width:0;height:0;}" +
      "#musicTabRoot .music-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:9px 6px;text-align:start;" +
        "border:none;border-bottom:1px solid rgba(127,127,127,.22);background:transparent;color:inherit;font:inherit;font-size:15px;}" +
      "#musicTabRoot .music-row svg{flex:0 0 22px;width:22px;height:22px;opacity:.85;}" +
      "#musicTabRoot .music-row span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      "#musicTabRoot .music-row.cur{background:rgba(127,0,255,.14);font-weight:600;}" +
      "#musicTabRoot .music-empty{padding:28px 14px;text-align:center;font-size:15px;line-height:1.45;opacity:.9;}" +
      "#musicTabRoot .music-big{margin-top:14px;font:inherit;font-size:15px;padding:10px 18px;border-radius:10px;border:1px solid var(--wood,#5b4a8a);" +
        "background:var(--wood,#5b4a8a);color:var(--parchment,#f4f0f8);}" +
      "#musicTabRoot .music-bar{flex:0 0 auto;display:flex;align-items:center;gap:2px;height:46px;box-sizing:border-box;padding:0 2px;" +
        "border-top:1px solid var(--groove-shadow,rgba(0,0,0,.35));background:var(--parchment,#f4f0f8);}" +
      "#musicTabRoot .music-bar[hidden]{display:none;}" +
      "#musicTabRoot .music-bar button{flex:0 0 auto;width:40px;height:40px;padding:9px;border:none;background:transparent;color:inherit;border-radius:8px;}" +
      "#musicTabRoot .music-bar button svg{width:100%;height:100%;}" +
      "#musicTabRoot .music-bar-title{flex:1 1 auto;min-width:0;padding:0 6px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      "#musicTabRoot .music-bar-title.err{color:#c62828;}";
    document.head.appendChild(st);
  }

  function rootEl(){ return document.getElementById(ROOT_ID); }

  // ---------- экраны ----------

  function renderNoBridge(c){
    c.innerHTML = '<div class="mood-diagram-empty">Вкладка «Музыка» работает только в приложении (APK) с обновлённой оболочкой.</div>';
  }

  function renderPick(c, text){
    ensureStyle();
    c.innerHTML =
      '<div id="' + ROOT_ID + '"><div class="music-empty">' + esc(text) +
      '<br><button class="music-big" id="musicPickBtn">Выбрать папку с музыкой</button></div></div>';
    document.getElementById("musicPickBtn").addEventListener("click", pickFolder);
  }

  function pickFolder(){
    var b = bridge();
    if(!b) return;
    try{ b.musicPickFolder(); }catch(e){}
  }

  // оболочка сообщает, чем закончился выбор папки
  window.__ltOnMusicFolder = function(ok){
    if(!ok) return;
    stack = null;
    var c = document.getElementById("settingsTabContent");
    if(c && (rootEl() || c.querySelector("#musicPickBtn"))) render();
  };

  function render(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    var b = bridge();
    if(!b){ renderNoBridge(c); return; }
    var info = parse(b.musicGetFolder(), {});
    if(!info.set){
      stack = null;
      stopTimer();
      renderPick(c, "Укажите, где лежит ваша музыка. Папку нужно выбрать один раз; позже её можно сменить кнопкой вверху экрана.");
      return;
    }
    folderName = info.name || "Музыка";
    if(!stack || !stack.length) stack = [{ id: "", name: folderName }];
    ensureStyle();
    c.innerHTML =
      '<div id="' + ROOT_ID + '">' +
        '<div class="music-head">' +
          '<button class="music-ib" id="musicBackBtn" title="Назад" style="visibility:hidden">' + ICON.back + '</button>' +
          '<div class="music-path" id="musicPath"></div>' +
          '<button class="music-ib" id="musicChangeBtn" title="Сменить папку с музыкой">' + ICON.gear + '</button>' +
        '</div>' +
        '<div class="music-list" id="musicList"></div>' +
        '<div class="music-bar" id="musicBar" hidden>' +
          '<button id="musicPrevBtn" title="Предыдущий трек">' + ICON.prev + '</button>' +
          '<button id="musicToggleBtn" title="Пауза / играть">' + ICON.pause + '</button>' +
          '<button id="musicNextBtn" title="Следующий трек">' + ICON.next + '</button>' +
          '<div class="music-bar-title" id="musicBarTitle"></div>' +
          '<button id="musicCloseBtn" title="Закрыть">' + ICON.close + '</button>' +
        '</div>' +
      '</div>';

    document.getElementById("musicBackBtn").addEventListener("click", goUp);
    document.getElementById("musicChangeBtn").addEventListener("click", pickFolder);
    document.getElementById("musicList").addEventListener("click", onListClick);
    bindBar(b);
    lastState = null;
    openFolder();
    poll();
    startTimer();
  }

  function cur(){ return stack[stack.length - 1]; }

  function openFolder(){
    var b = bridge(); if(!b) return;
    var res = parse(b.musicList(cur().id), { ok: false });
    var list = document.getElementById("musicList");
    var path = document.getElementById("musicPath");
    var back = document.getElementById("musicBackBtn");
    if(!list) return;
    path.textContent = stack.map(function(s){ return s.name; }).join(" / ");
    back.style.visibility = stack.length > 1 ? "visible" : "hidden";
    if(!res.ok){
      items = [];
      list.innerHTML = '<div class="music-empty">Не удалось прочитать папку.<br><button class="music-big" id="musicPickBtn2">Выбрать папку заново</button></div>';
      document.getElementById("musicPickBtn2").addEventListener("click", pickFolder);
      return;
    }
    items = res.items || [];
    if(!items.length){
      list.innerHTML = '<div class="music-empty">В этой папке нет подпапок и звуковых файлов.</div>';
      return;
    }
    var html = "";
    for(var i = 0; i < items.length; i++){
      var it = items[i];
      html += '<button class="music-row" data-i="' + i + '">' + (it.dir ? ICON.folder : ICON.note) + '<span>' + esc(it.name) + '</span></button>';
    }
    list.innerHTML = html;
    list.scrollTop = 0;
    markCurrent();
  }

  // шаг наверх; вызывается жестом «назад» (через AppNav) и, без AppNav, кнопкой ←
  function popFolder(){
    if(!stack || stack.length < 2) return;
    stack.pop();
    if(rootEl()) openFolder();
  }

  // кнопка ←: идём через историю, чтобы стек AppNav не рассинхронизировался с глубиной
  function goUp(){
    if(!stack || stack.length < 2) return;
    if(window.AppNav) history.back();
    else popFolder();
  }

  function onListClick(ev){
    var row = ev.target.closest ? ev.target.closest(".music-row") : null;
    if(!row) return;
    var it = items[parseInt(row.getAttribute("data-i"), 10)];
    if(!it) return;
    if(it.dir){
      stack.push({ id: it.id, name: it.name });
      openFolder();
      if(window.AppNav) window.AppNav.push(popFolder);
      return;
    }
    var b = bridge(); if(!b) return;
    var ok = false;
    try{ ok = b.musicPlay(cur().id, it.id, cur().name); }catch(e){}
    if(ok) setTimeout(poll, 150);
  }

  // ---------- полоса плеера ----------

  function bindBar(b){
    function call(name){
      return function(){
        try{ b[name](); }catch(e){}
        setTimeout(poll, 150);
      };
    }
    document.getElementById("musicPrevBtn").addEventListener("click", call("musicPrev"));
    document.getElementById("musicToggleBtn").addEventListener("click", call("musicToggle"));
    document.getElementById("musicNextBtn").addEventListener("click", call("musicNext"));
    document.getElementById("musicCloseBtn").addEventListener("click", call("musicClose"));
  }

  function markCurrent(){
    var list = document.getElementById("musicList");
    if(!list) return;
    var id = (lastState && lastState.active) ? lastState.id : "";
    var rows = list.querySelectorAll(".music-row");
    for(var i = 0; i < rows.length; i++){
      var it = items[parseInt(rows[i].getAttribute("data-i"), 10)];
      rows[i].classList.toggle("cur", !!(it && !it.dir && id && it.id === id));
    }
  }

  function poll(){
    var root = rootEl();
    var b = bridge();
    if(!root || !b){ stopTimer(); return; }
    var st = parse(b.musicState(), {});
    var bar = document.getElementById("musicBar");
    if(!bar) return;
    var sameTrack = lastState && lastState.id === st.id && lastState.active === st.active;
    bar.hidden = !st.active;
    if(st.active){
      var t = document.getElementById("musicBarTitle");
      var text = (st.error ? "⚠ " + st.error : (st.title || ""));
      if(t.textContent !== text) t.textContent = text;
      t.classList.toggle("err", !!st.error);
      document.getElementById("musicToggleBtn").innerHTML = st.playing ? ICON.pause : ICON.play;
    }
    lastState = st;
    if(!sameTrack) markCurrent();
  }

  function startTimer(){
    if(timer) return;
    timer = setInterval(poll, POLL_MS);
  }
  function stopTimer(){
    if(timer){ clearInterval(timer); timer = null; }
  }

  window.MusicTab = { render: render };
})();
