/* ===========================================================================
   eventlog.js
   Версия: 1.1 (24.10) — «Таймер … остановлен пользователем» (отличается от «сработал»). Версия 1.0: новый файл. Журнал событий приложения («Центр событий», вкладка `events` над «Архивом»).
   `window.EventLog`: `add(text, opts)` — записать событие; `list()` — записанные события; `upcoming()` — предстоящие (напоминания и таймеры,
   в журнал не пишутся, считаются на лету); `timerStarted/timerCancelled/reconcileTimers` — учёт таймеров карточек (событие «сработал»
   пишется, когда таймер закончился, даже если приложение было закрыто); `noteVersion` — «Приложение было обновлено до версии …»;
   `setUpcomingProvider(fn)` — источник предстоящих напоминаний (notifications.js); `onChange(fn)`; `start()` — наблюдение за таймерами
   (только главная страница; scan.html только пишет); `renderInto(container)` — экран вкладки.
   Хранение: localStorage `bibleEventLog_v1` (массив {t, s[, k]}, не больше MAX_ENTRIES, старые отбрасываются). Только на этом устройстве, в экспорт
   не входит. Один и тот же localStorage пишут и приложение, и окно ярлыка сканера (scan.html), поэтому каждое добавление читает журнал заново.
   Экран: шрифт, размер (`--mdeditor-font-size`, общий «Аа») и интерлиньяж — как у заметок, ридера и задач; кнопки «Аа» на вкладке нет.
   Откат: файл удалить, убрать вызовы `EventLog` (все под проверкой `window.EventLog`).
   =========================================================================== */
(function(){
  "use strict";

  var LOG_KEY = "bibleEventLog_v1";
  var PENDING_KEY = "bibleEventTimersPending_v1";
  var VERSION_KEY = "bibleEventLastVersion_v1";
  var TIMERS_WEB_KEY = "itemCardTimers_v1"; // запасное хранилище таймеров в браузере (itemcards.js, makeWebTimers)
  var MAX_ENTRIES = 1000;
  var DEDUPE_MS = 15000;      // одинаковый текст чаще, чем раз в 15 секунд, не пишется (скан в окне ярлыка и повторный вход в приложение)
  var RECONCILE_MS = 2000;
  var REFRESH_MS = 20000;     // экран при открытой вкладке освежает «предстоящие»

  var listeners = [];
  var upcomingProvider = null;
  var started = false;

  // ---------------------------------------------------------------- журнал

  function readLog(){
    try{
      var a = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    }catch(e){ return []; }
  }
  function writeLog(a){
    try{ localStorage.setItem(LOG_KEY, JSON.stringify(a)); }catch(e){}
  }
  function fire(){
    for(var i = 0; i < listeners.length; i++){
      try{ listeners[i](); }catch(e){}
    }
  }
  function cleanText(s){
    return String(s == null ? "" : s).replace(/!\[\[[^\]]*\]\]/g, "[изображение]").replace(/\s+/g, " ").trim();
  }
  // opts: at — момент события (мс, по умолчанию сейчас); key — уникальный ключ (событие с таким ключом второй раз не пишется)
  function add(text, opts){
    text = cleanText(text);
    if(!text) return false;
    opts = opts || {};
    var at = (typeof opts.at === "number" && isFinite(opts.at) && opts.at > 0) ? opts.at : Date.now();
    var key = opts.key ? String(opts.key) : "";
    var log = readLog();
    var i;
    if(key){
      for(i = log.length - 1; i >= 0 && i >= log.length - 300; i--){
        if(log[i] && log[i].k === key) return false;
      }
    } else {
      for(i = log.length - 1; i >= 0 && i >= log.length - 30; i--){
        if(log[i] && log[i].s === text && Math.abs((log[i].t || 0) - at) < DEDUPE_MS) return false;
      }
    }
    var entry = { t: at, s: text };
    if(key) entry.k = key;
    // по порядку времени: запись «из прошлого» (напоминание, сработавшее без страницы) встаёт на своё место
    var pos = log.length;
    while(pos > 0 && (log[pos - 1].t || 0) > at) pos--;
    log.splice(pos, 0, entry);
    if(log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
    writeLog(log);
    fire();
    return true;
  }
  function list(){ return readLog(); }

  // ---------------------------------------------------------------- версия приложения

  function noteVersion(version){
    if(!version) return;
    var v = String(version).replace(/^v/i, "");
    if(!v || v === "—") return;
    var prev = null;
    try{ prev = localStorage.getItem(VERSION_KEY); }catch(e){}
    if(prev === v) return;
    try{ localStorage.setItem(VERSION_KEY, v); }catch(e){}
    add("Приложение было обновлено до версии " + v, { key: "version:" + v });
  }

  // ---------------------------------------------------------------- таймеры карточек

  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function formatDuration(sec){
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? (h + ":" + pad2(m) + ":" + pad2(s)) : (pad2(m) + ":" + pad2(s));
  }
  function readPending(){
    try{
      var o = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    }catch(e){ return {}; }
  }
  function writePending(o){
    try{ localStorage.setItem(PENDING_KEY, JSON.stringify(o)); }catch(e){}
  }
  // текущие таймеры [{id, title, running, endAt, remainingMs}] или null, если прочитать негде
  function readTimers(){
    var N = window.LifeTrackerNative;
    if(N && typeof N.getCardTimers === "function"){
      try{
        var a = JSON.parse(N.getCardTimers() || "[]");
        return Array.isArray(a) ? a : [];
      }catch(e){ return null; }
    }
    try{
      var o = JSON.parse(localStorage.getItem(TIMERS_WEB_KEY) || "{}") || {};
      return Object.keys(o).map(function(k){ return o[k]; });
    }catch(e){ return null; }
  }
  function timerName(title){
    var t = cleanText(title);
    return t ? ("«" + t + "»") : "";
  }
  function timerStarted(id, title, seconds){
    seconds = Number(seconds) || 0;
    if(!id || seconds <= 0) return;
    var pend = readPending();
    pend[id] = { id: String(id), title: cleanText(title), seconds: seconds, endAt: Date.now() + seconds * 1000, paused: false };
    writePending(pend);
    var nm = timerName(title);
    add(nm ? ("Был установлен таймер " + nm) : ("Был установлен таймер на " + formatDuration(seconds)));
  }
  function timerCancelled(id){
    var pend = readPending();
    var p = pend[id];
    if(!p) return;
    delete pend[id];
    writePending(pend);
    logStopped(p, Date.now());
  }
  function logStopped(p, at){
    var nm = timerName(p.title);
    add((nm ? ("Таймер " + nm) : "Таймер") + " остановлен пользователем", { at: at, key: "timer-stopped:" + p.id + ":" + p.endAt });
  }
  // Сверка со списком таймеров оболочки. Пропал из списка после срока окончания — сработал (событие ставится на момент окончания);
  // пропал раньше срока — остановлен пользователем (пишется «Таймер … остановлен пользователем»). Остановка кнопкой в уведомлении при закрытом приложении от сработавшего после срока не отличима.
  function reconcileTimers(){
    var pend = readPending();
    var ids = Object.keys(pend);
    if(!ids.length) return;
    var tl = readTimers();
    if(tl === null) return;
    var now = Date.now();
    var byId = {};
    tl.forEach(function(t){ if(t && t.id != null) byId[String(t.id)] = t; });
    var changed = false;
    ids.forEach(function(id){
      var p = pend[id];
      var t = byId[id];
      if(t && t.running && t.endAt > now){
        if(p.endAt !== t.endAt || p.paused){ p.endAt = t.endAt; p.paused = false; changed = true; }
        return;
      }
      if(t && !t.running){
        if(!p.paused){ p.paused = true; changed = true; }
        return;
      }
      if(!p.paused && now >= p.endAt - 2000){
        var nm = timerName(p.title);
        add((nm ? ("Таймер " + nm + " сработал") : "Таймер сработал") + " через " + formatDuration(p.seconds),
          { at: p.endAt, key: "timer-fired:" + id + ":" + p.endAt });
      }
      if(!p.paused && now < p.endAt - 2000) logStopped(p, now); // пропал из списка раньше срока (кнопка в уведомлении или на острове)
      delete pend[id];
      changed = true;
    });
    if(changed) writePending(pend);
  }

  // ---------------------------------------------------------------- предстоящее

  function setUpcomingProvider(fn){ upcomingProvider = (typeof fn === "function") ? fn : null; }
  function upcoming(){
    var now = Date.now();
    var out = [];
    if(upcomingProvider){
      try{
        (upcomingProvider() || []).forEach(function(x){
          if(x && typeof x.at === "number" && x.at > now && x.text) out.push({ at: x.at, text: String(x.text) });
        });
      }catch(e){}
    }
    var tl = readTimers() || [];
    tl.forEach(function(t){
      if(!t || !t.running || !(t.endAt > now)) return;
      var nm = timerName(t.title);
      out.push({ at: t.endAt, text: nm ? ("Сработает сигнал по окончанию таймера " + nm) : "Сработает сигнал по окончанию таймера" });
    });
    out.sort(function(a, b){ return a.at - b.at; });
    return out;
  }

  // ---------------------------------------------------------------- экран вкладки

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function dateLabel(ts){
    var d = new Date(ts);
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear();
  }
  function timeLabel(ts){
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function listHtml(){
    var rows = readLog().map(function(e){ return { at: e.t || 0, text: e.s || "", up: false }; });
    upcoming().forEach(function(u){ rows.push({ at: u.at, text: u.text, up: true }); });
    if(!rows.length) return '<div class="event-empty">Событий пока нет</div>';
    rows.sort(function(a, b){ return a.at - b.at; }); // сортировка устойчивая не везде — порядок внутри минуты неважен
    var html = "", lastDay = "";
    rows.forEach(function(r){
      var day = dateLabel(r.at);
      if(day !== lastDay){
        html += '<div class="event-day">' + day + '</div>';
        lastDay = day;
      }
      html += '<div class="event-row' + (r.up ? ' event-row-upcoming' : '') + '"><span class="event-time">' + timeLabel(r.at) +
        '</span> ' + esc(r.text) + '</div>';
    });
    return html;
  }
  function scrollToBottom(container){
    function go(){ container.scrollTop = container.scrollHeight; }
    go();
    if(window.requestAnimationFrame) window.requestAnimationFrame(go);
    setTimeout(go, 60);
    setTimeout(go, 250);
  }
  var scrollHost = null;
  function refreshOpenScreen(){
    var box = document.getElementById("eventCenterList");
    if(!box || !scrollHost) return;
    var nearBottom = (scrollHost.scrollHeight - scrollHost.scrollTop - scrollHost.clientHeight) < 48;
    var keep = scrollHost.scrollTop;
    box.innerHTML = listHtml();
    if(nearBottom) scrollHost.scrollTop = scrollHost.scrollHeight; else scrollHost.scrollTop = keep;
  }
  var refreshTimer = null;
  function renderInto(container){
    if(!container) return;
    scrollHost = container;
    try{ reconcileTimers(); }catch(e){}
    container.innerHTML = '<div class="event-center"><div id="eventCenterList">' + listHtml() + '</div></div>';
    scrollToBottom(container); // вкладка всегда открывается в самом низу событий
    if(!refreshTimer){
      refreshTimer = setInterval(function(){
        if(!document.getElementById("eventCenterList")) return;
        refreshOpenScreen();
      }, REFRESH_MS);
    }
  }

  function onChange(fn){ if(typeof fn === "function") listeners.push(fn); }
  listeners.push(function(){ if(document.getElementById("eventCenterList")) refreshOpenScreen(); });

  function start(){
    if(started) return;
    started = true;
    try{ reconcileTimers(); }catch(e){}
    setInterval(function(){ try{ reconcileTimers(); }catch(e){} }, RECONCILE_MS);
    document.addEventListener("visibilitychange", function(){ try{ reconcileTimers(); }catch(e){} });
  }

  window.EventLog = {
    add: add,
    list: list,
    upcoming: upcoming,
    noteVersion: noteVersion,
    timerStarted: timerStarted,
    timerCancelled: timerCancelled,
    reconcileTimers: reconcileTimers,
    setUpcomingProvider: setUpcomingProvider,
    onChange: onChange,
    start: start,
    renderInto: renderInto
  };
})();
