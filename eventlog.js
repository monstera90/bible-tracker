/* ===========================================================================
   eventlog.js
   Версия: 2.0 (25.10) — структурная правка: у таймера и будильника ОДНА запись на запуск, которая меняется по ходу дела: «8:00 Был установлен таймер «Кофе»» → после срока «… и сработал через 23 минуты в **8:23**» / «… и был остановлен пользователем через 15 минут 23 секунды в **8:15**»;
   будильник — «Будильник «Название» сработал в **8:00** и **8:15**, а в **8:16** был отключён пользователем» (в процессе повторов — отдельные строки «сработал первый/второй раз», при сборке записи они убираются). Предстоящее (серым): «Сработает уведомление по истечению таймера «Кофе»», «Будильник «Название» сработает через 8 часов 52 минуты» (и по строке на каждый оставшийся повтор).
   Новое: `update(key, text, opts)`, `alarmStarted/alarmCancelled`, `reconcileAlarms` (сверка со списком будильников оболочки — `getCardAlarms`), жирное выделение внутри текста — метки ⟦…⟧ (при показе → <b>), поле записи `b` (запись составная), `g` (группа временных строк). Откат: eventlog.js 1.1.
   Версия 1.1 (24.10) — «Таймер … остановлен пользователем» (отличается от «сработал»). Версия 1.0: новый файл. Журнал событий приложения («Центр событий», вкладка `events` над «Архивом»).
   `window.EventLog`: `add(text, opts)` — записать событие; `list()` — записанные события; `upcoming()` — предстоящие (напоминания и таймеры,
   в журнал не пишутся, считаются на лету); `timerStarted/timerCancelled/reconcileTimers` — учёт таймеров карточек (итог пишется, когда таймер закончился, даже если приложение было закрыто); `noteVersion` — «Приложение было обновлено до версии …»;
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
  var ALARMS_PENDING_KEY = "bibleEventAlarmsPending_v1"; // заведённые будильники, чей итог ещё не записан
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
    if(opts.group) entry.g = String(opts.group);
    if(opts.bold) entry.b = 1;
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
  // меняет текст уже записанного события по ключу (время записи остаётся); false — такой записи нет
  function update(key, text, opts){
    text = cleanText(text);
    if(!key || !text) return false;
    opts = opts || {};
    var log = readLog();
    for(var i = log.length - 1; i >= 0; i--){
      if(log[i] && log[i].k === key){
        log[i].s = text;
        if(opts.bold) log[i].b = 1;
        writeLog(log);
        fire();
        return true;
      }
    }
    return false;
  }
  // убирает временные строки группы (например «сработал первый раз»), когда собрана итоговая запись
  function removeGroup(group){
    if(!group) return;
    var log = readLog();
    var out = log.filter(function(e){ return !(e && e.g === group); });
    if(out.length !== log.length){ writeLog(out); fire(); }
  }

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
  function plural(n, f){
    var a = n % 100, b = n % 10;
    if(a >= 11 && a <= 14) return f[2];
    if(b === 1) return f[0];
    if(b >= 2 && b <= 4) return f[1];
    return f[2];
  }
  var U_HOUR = ["час", "часа", "часов"], U_MIN = ["минуту", "минуты", "минут"], U_SEC = ["секунду", "секунды", "секунд"];
  // «1 час 5 минут 10 секунд» (нулевые части опускаются)
  function ruDur(sec){
    sec = Math.max(0, Math.round(sec));
    if(sec < 1) return "менее секунды";
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, out = [];
    if(h) out.push(h + " " + plural(h, U_HOUR));
    if(m) out.push(m + " " + plural(m, U_MIN));
    if(s) out.push(s + " " + plural(s, U_SEC));
    return out.join(" ");
  }
  // до будильника: часы и минуты, минуты округляются вверх («8 часов 52 минуты»)
  function ruDurMin(sec){
    var total = Math.max(1, Math.ceil(sec / 60)), h = Math.floor(total / 60), m = total % 60, out = [];
    if(h) out.push(h + " " + plural(h, U_HOUR));
    if(m) out.push(m + " " + plural(m, U_MIN));
    return out.join(" ");
  }
  function B(txt){ return "\u27E6" + txt + "\u27E7"; } // метки жирного: при показе превращаются в <b>
  function joinAnd(a){
    if(a.length <= 1) return a.join("");
    return a.slice(0, -1).join(", ") + " и " + a[a.length - 1];
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
  function timerStartAt(p){ return p.startAt || (p.endAt - p.seconds * 1000); }
  function timerKey(p){ return p.key || ("timer:" + p.id + ":" + timerStartAt(p)); }
  function timerHead(p){
    var nm = timerName(p.title);
    return nm ? ("Был установлен таймер " + nm) : ("Был установлен таймер на " + ruDur(p.seconds));
  }
  // итог запуска таймера: та же запись («Был установлен таймер …») дополняется продолжением
  function finishTimer(p, how, at){
    var text;
    if(how === "fired"){
      text = timerHead(p) + " и сработал через " + ruDur(p.seconds) + " в " + B(timeLabel(at));
    } else {
      var el = (p.paused && p.remainingMs != null) ? (p.seconds * 1000 - p.remainingMs) : (at - timerStartAt(p));
      text = timerHead(p) + " и был остановлен пользователем через " + ruDur(el / 1000) + " в " + B(timeLabel(at));
    }
    var key = timerKey(p);
    if(!update(key, text, { bold: true })) add(text, { at: timerStartAt(p), key: key, bold: true });
  }
  function timerStarted(id, title, seconds){
    seconds = Number(seconds) || 0;
    if(!id || seconds <= 0) return;
    var pend = readPending();
    var now = Date.now();
    if(pend[id]) finishTimer(pend[id], "stopped", now); // тот же таймер завели заново, пока шёл прежний
    var p = { id: String(id), title: cleanText(title), seconds: seconds, startAt: now, endAt: now + seconds * 1000, paused: false };
    p.key = "timer:" + p.id + ":" + now;
    pend[id] = p;
    writePending(pend);
    add(timerHead(p), { at: now, key: p.key });
  }
  function timerCancelled(id){
    var pend = readPending();
    var p = pend[id];
    if(!p) return;
    delete pend[id];
    writePending(pend);
    finishTimer(p, "stopped", Date.now());
  }
  // Сверка со списком таймеров оболочки. Пропал из списка после срока окончания — сработал (время итога — момент окончания);
  // пропал раньше срока — остановлен пользователем. Остановка кнопкой в уведомлении при закрытом приложении после срока от сработавшего не отличима.
  function reconcileTimers(){
    reconcileAlarms();
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
        if(!p.paused || p.remainingMs !== t.remainingMs){ p.paused = true; p.remainingMs = t.remainingMs; changed = true; }
        return;
      }
      if(!p.paused && now >= p.endAt - 2000) finishTimer(p, "fired", p.endAt);
      else finishTimer(p, "stopped", now); // пропал из списка раньше срока (кнопка в уведомлении или на острове)
      delete pend[id];
      changed = true;
    });
    if(changed) writePending(pend);
  }

  // ---------------------------------------------------------------- будильники карточек

  var ORD = ["первый", "второй", "третий", "четвёртый", "пятый"];
  function readAlarmPend(){
    try{
      var o = JSON.parse(localStorage.getItem(ALARMS_PENDING_KEY) || "{}");
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    }catch(e){ return {}; }
  }
  function writeAlarmPend(o){
    try{ localStorage.setItem(ALARMS_PENDING_KEY, JSON.stringify(o)); }catch(e){}
  }
  // заведённые будильники оболочки [{id, title, every, times, k, firstAt, nextAt}] или null, если читать негде
  function readAlarms(){
    var N = window.LifeTrackerNative;
    if(N && typeof N.getCardAlarms === "function"){
      try{
        var a = JSON.parse(N.getCardAlarms() || "[]");
        return Array.isArray(a) ? a : [];
      }catch(e){ return null; }
    }
    return null;
  }
  function alarmName(title){
    var nm = timerName(title);
    return nm ? ("Будильник " + nm) : "Будильник";
  }
  function ringTimes(p){
    var out = [];
    for(var n = 0; n <= (p.times | 0); n++) out.push(p.firstAt + n * (p.every | 0) * 60000);
    return out;
  }
  // итог будильника. how: "finished" — отзвонил все звонки; "cancelled" — отключён пользователем; "replaced" — заведён заново
  function finishAlarm(p, how, at){
    removeGroup(p.key);
    var rings = ringTimes(p).filter(function(t){ return t <= at + 2000; });
    var off = (how === "cancelled");
    if(!rings.length){
      if(off) add(alarmName(p.title) + " был отключён пользователем", { at: at, key: p.key + ":off" });
      return;
    }
    var text = alarmName(p.title) + " сработал в " + joinAnd(rings.map(function(t){ return B(timeLabel(t)); }));
    if(off) text += ", а в " + B(timeLabel(at)) + " был отключён пользователем";
    if(!update(p.key, text, { bold: true })) add(text, { at: p.setAt, key: p.key, bold: true });
  }
  // text — запись «будильник заведён» (её составляет карточка); firstAt — момент первого звонка
  function alarmStarted(id, title, firstAt, every, times, text){
    if(!id || !(firstAt > 0)) return;
    var pend = readAlarmPend();
    var now = Date.now();
    if(pend[id]) finishAlarm(pend[id], "replaced", now);
    var p = { id: String(id), title: cleanText(title), setAt: now, firstAt: firstAt, every: every | 0, times: (every | 0) ? (times | 0) : 0, logged: 0 };
    p.key = "alarm:" + p.id + ":" + now;
    pend[id] = p;
    writeAlarmPend(pend);
    add(text, { at: now, key: p.key });
  }
  // «Выкл.» на карточке (вызывать ДО отмены в оболочке: иначе будильника уже нет в списке)
  function alarmCancelled(id, title){
    var pend = readAlarmPend();
    var p = pend[id];
    if(p){
      delete pend[id];
      writeAlarmPend(pend);
      finishAlarm(p, "cancelled", Date.now());
      return;
    }
    var al = readAlarms();
    var known = false;
    if(al) al.forEach(function(a){ if(a && String(a.id) === String(id)) known = true; });
    if(known) add(alarmName(title) + " был отключён пользователем");
  }
  function reconcileAlarms(){
    var pend = readAlarmPend();
    var ids = Object.keys(pend);
    if(!ids.length) return;
    var list = readAlarms();
    if(list === null) return;
    var byId = {};
    list.forEach(function(a){ if(a && a.id != null) byId[String(a.id)] = a; });
    var now = Date.now(), changed = false;
    ids.forEach(function(id){
      var p = pend[id], a = byId[id], times = ringTimes(p);
      if(a && a.firstAt === p.firstAt){
        var done = Math.min(a.k | 0, times.length);
        for(var n = p.logged | 0; n < done; n++){
          if(p.times > 0) add(alarmName(p.title) + " сработал " + ORD[n] + " раз", { at: times[n], key: p.key + ":r" + n, group: p.key });
        }
        if((p.logged | 0) < done){ p.logged = done; changed = true; }
        return;
      }
      // будильника в списке нет: отзвонил всё (итог — «сработал в …») или его сняли раньше срока
      finishAlarm(p, now >= times[times.length - 1] - 2000 ? "finished" : "cancelled", now);
      delete pend[id];
      changed = true;
    });
    if(changed) writeAlarmPend(pend);
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
      out.push({ at: t.endAt, text: nm ? ("Сработает уведомление по истечению таймера " + nm) : "Сработает уведомление по истечению таймера" });
    });
    (readAlarms() || []).forEach(function(a){
      if(!a) return;
      var every = a.every | 0, times = a.times | 0;
      for(var n = a.k | 0; n <= times; n++){
        var at = a.firstAt + n * every * 60000;
        if(!(at > now)) continue;
        out.push({ at: at, text: alarmName(a.title) + (n === 0 ? " сработает через " : " сработает ещё раз через ") + ruDurMin((at - now) / 1000) });
      }
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
  function boldMarks(html){ return html.replace(/\u27E6([^\u27E7]*)\u27E7/g, "<b>$1</b>"); }
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
        '</span> ' + boldMarks(esc(r.text)) + '</div>';
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
    update: update,
    list: list,
    upcoming: upcoming,
    noteVersion: noteVersion,
    timerStarted: timerStarted,
    timerCancelled: timerCancelled,
    reconcileTimers: reconcileTimers,
    alarmStarted: alarmStarted,
    alarmCancelled: alarmCancelled,
    reconcileAlarms: reconcileAlarms,
    setUpcomingProvider: setUpcomingProvider,
    onChange: onChange,
    start: start,
    renderInto: renderInto
  };
})();
