/* ===========================================================================
   workouts.js
   Версия: 1.0 (27.10) — новый файл. Вкладка «Тренировки» (`workouts`, кнопка `settingsTabWorkoutsBtn` в нижнем ряду набора 1,
   между шестерёнкой и «Картой дней года»). `window.WorkoutsTab.{setStore, render, drain, refreshIfOpen}`.

   Что на экране:
   • сверху — период: «Месяц / 3 мес. / 6 мес. / Год», стрелки «‹ ›» листают период назад и вперёд (свайп влево/вправо по
     экрану — то же); выбор периода хранится в `workoutsPeriod_v1`. Период всегда заканчивается выбранным месяцем и не уходит
     в будущее дальше текущего месяца;
   • итог за период: километры (одна десятая, «10,7 км»; сотые в записях остаются и участвуют в суммах), число тренировок,
     общее время. За несколько месяцев ниже — строки по месяцам (тап по месяцу открывает его целиком);
   • список тренировок периода по дням (новые сверху): дата, дистанция, общее время; тап по записи — «Удалить» (два нажатия);
   • нижний ряд `.mdeditor-fab-row`: кнопка «Запись» и «домик»-пустышка (как на других вкладках).

   Запись (только в APK, мост `LifeTrackerNative` версии 17 — `WorkoutTracker.kt`/`WorkoutService.kt`):
   «Запись» → `workoutStart()`: «Поиск спутников» (время не идёт, показывается число найденных спутников) → «Связь установлена»
   (метка с красной становится зелёной, идёт время) → если связь пропала, километры на этом участке не считаются, а время
   идёт; при остановке показывается сообщение «не писалась с … по …». Пауза и остановка — в панели и в уведомлении/острове
   Xiaomi. Общее время = время с учётом километров + время без учёта. После остановки оболочка сопоставляет маршрут с картой
   OpenStreetMap (если сервис недоступен — остаётся расстояние по GPS) и кладёт готовую запись в очередь; страница забирает её
   `drain()` (при открытии вкладки, при возврате в приложение, после остановки) и сохраняет через хранилище.

   Запись тренировки: {id, start, end, m (метры, итог), rawM (метры по GPS), totalMs, lostMs, gaps:[[с,по]], how:"map"|"raw"}.
   Хранилище — провайдер от my.js (`setStore`, раздел «ТРЕНИРОВКИ» в my.js): запись лежит в личном `state` под ключом
   `wk:<id>` = {c, t} и едет в облако вместе с остальными данными и в экспорт; удаление — тумбстоун {c:null, t}.
   =========================================================================== */
(function(){
  "use strict";

  var PERIOD_KEY = "workoutsPeriod_v1";
  var LAST_RESULT_KEY = "workoutsLastResult_v1";
  var POLL_MS = 500;
  var SWIPE_DX = 70, SWIPE_DY = 50;
  var MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_SHORT = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];
  var WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  var PERIODS = [
    { months: 1, label: "Месяц" },
    { months: 3, label: "3 мес." },
    { months: 6, label: "6 мес." },
    { months: 12, label: "Год" }
  ];

  var HOME_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 11.5L12 4l8 7.5"></path><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"></path><path d="M10 20v-5h4v5"></path></svg>';
  var REC_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"></circle></svg>';
  var PAUSE_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';
  var PLAY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"></path></svg>';
  var STOP_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';

  var STORE = null;        // провайдер хранилища от my.js: {list, put, remove}
  var months = 1;          // период: 1 | 3 | 6 | 12
  var endMonth = null;     // первый день последнего месяца периода (Date)
  var rootId = "workoutsRoot";
  var pollTimer = null;
  var lastState = null;    // последнее состояние записи от оболочки
  var lastShape = "";      // «форма» панели записи (что рисовано), чтобы перерисовывать только при смене
  var message = "";        // подсказка над панелью («Разрешите геолокацию» и т.п.)
  var messageAction = "";  // "gps" — у подсказки кнопка «Открыть настройки»
  var openedId = null;     // запись, у которой раскрыта кнопка «Удалить»
  var delArm = null;       // {id, timer}: первое нажатие «Удалить» сделано

  // ---------- вспомогательное ----------
  function container(){ return document.getElementById("settingsTabContent"); }
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function nat(){
    var n = window.LifeTrackerNative;
    return (n && typeof n.workoutStart !== "undefined") ? n : null;
  }
  function monthStart(y, m){ return new Date(y, m, 1, 0, 0, 0, 0); }
  function addMonths(d, k){ return monthStart(d.getFullYear(), d.getMonth() + k); }
  function curMonth(){ var n = new Date(); return monthStart(n.getFullYear(), n.getMonth()); }
  function num(v){ v = Number(v); return isFinite(v) ? v : 0; }

  // «10,7 км»: одна десятая, запятая; суммы считаются по точным метрам, округляется только показ
  function fmtKm(m){ return (Math.round(num(m) / 100) / 10).toFixed(1).replace(".", ",") + " км"; }
  function fmtClock(ms){
    var s = Math.max(0, Math.floor(num(ms) / 1000));
    var h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
    return h > 0 ? (h + ":" + pad2(mi) + ":" + pad2(se)) : (mi + ":" + pad2(se));
  }
  function fmtTotal(ms){
    var mi = Math.round(Math.max(0, num(ms)) / 60000);
    var h = Math.floor(mi / 60);
    return h > 0 ? (h + " ч " + pad2(mi % 60) + " мин") : (mi + " мин");
  }
  function fmtHM(ts){ var d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function fmtDur(ms){
    var s = Math.round(Math.max(0, num(ms)) / 1000);
    if(s < 60) return s + " с";
    var mi = Math.round(s / 60);
    if(mi < 60) return mi + " мин";
    return Math.floor(mi / 60) + " ч " + pad2(mi % 60) + " мин";
  }
  function dayLabel(ts){
    var d = new Date(ts);
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + " · " + WEEKDAYS[d.getDay()];
  }

  // ---------- период ----------
  function loadPeriod(){
    try{
      var v = parseInt(localStorage.getItem(PERIOD_KEY), 10);
      if(v === 1 || v === 3 || v === 6 || v === 12) months = v;
    }catch(e){}
    if(!endMonth) endMonth = curMonth();
  }
  function savePeriod(){ try{ localStorage.setItem(PERIOD_KEY, String(months)); }catch(e){} }
  function rangeStart(){ return addMonths(endMonth, -(months - 1)); }
  function rangeEnd(){ return addMonths(endMonth, 1); }
  function clampEnd(){
    var cm = curMonth();
    if(endMonth.getTime() > cm.getTime()) endMonth = cm;
  }
  function periodTitle(){
    var a = rangeStart(), b = endMonth;
    if(months === 1) return MONTHS[b.getMonth()] + " " + b.getFullYear();
    if(a.getFullYear() === b.getFullYear()) return MONTHS_SHORT[a.getMonth()] + " – " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
    return MONTHS_SHORT[a.getMonth()] + " " + a.getFullYear() + " – " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
  }

  // ---------- записи ----------
  function allRecords(){
    var list = [];
    try{ list = STORE ? (STORE.list() || []) : []; }catch(e){ list = []; }
    return list.filter(function(r){ return r && typeof r.start === "number" && isFinite(r.start); })
      .sort(function(a, b){ return b.start - a.start; });
  }
  function inRange(list){
    var a = rangeStart().getTime(), b = rangeEnd().getTime();
    return list.filter(function(r){ return r.start >= a && r.start < b; });
  }
  function sumM(list){ var s = 0; list.forEach(function(r){ s += num(r.m); }); return s; }
  function sumMs(list){ var s = 0; list.forEach(function(r){ s += num(r.totalMs); }); return s; }

  // ---------- стили ----------
  function ensureStyle(){
    if(document.getElementById("workoutsStyle")) return;
    var st = document.createElement("style");
    st.id = "workoutsStyle";
    st.textContent =
      ".wk-root{padding-bottom:84px;touch-action:pan-y;}" +
      ".wk-seg{display:flex;gap:6px;margin:6px 0 10px;}" +
      ".wk-seg button{flex:1;padding:7px 4px;border-radius:10px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font:inherit;font-size:.9em;cursor:pointer;}" +
      ".wk-seg button.on{background:var(--wood);border-color:var(--wood);color:var(--parchment);}" +
      ".wk-nav{display:flex;align-items:center;justify-content:space-between;margin:4px 0 6px;}" +
      ".wk-nav button{width:40px;height:36px;border-radius:10px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font-size:1.3em;line-height:1;cursor:pointer;}" +
      ".wk-nav button:disabled{opacity:.3;cursor:default;}" +
      ".wk-nav .wk-title{font-weight:bold;text-align:center;flex:1;}" +
      ".wk-total{text-align:center;margin:6px 0 12px;}" +
      ".wk-total .wk-km{font-size:2.3em;font-weight:bold;font-variant-numeric:tabular-nums;color:var(--wood-dark);}" +
      ".wk-total .wk-sub{color:var(--ink-soft);margin-top:2px;}" +
      ".wk-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--groove-shadow);cursor:pointer;}" +
      ".wk-row:first-of-type{border-top:none;}" +
      ".wk-row .wk-date{flex:1;}" +
      ".wk-row .wk-dist{font-weight:bold;font-variant-numeric:tabular-nums;}" +
      ".wk-row .wk-time{color:var(--ink-soft);min-width:64px;text-align:right;font-variant-numeric:tabular-nums;}" +
      ".wk-row .wk-sub{display:block;font-size:.8em;color:var(--ink-soft);}" +
      ".wk-del{margin:0 0 6px auto;display:block;padding:6px 14px;border-radius:10px;border:1px solid var(--danger);background:transparent;color:var(--danger);font:inherit;cursor:pointer;}" +
      ".wk-del.armed{background:var(--danger);color:var(--parchment);}" +
      ".wk-empty{color:var(--ink-soft);text-align:center;margin:26px 0;}" +
      ".wk-card{border:1px solid var(--groove-shadow);border-radius:14px;padding:12px 14px;margin:6px 0 12px;background:var(--parchment-dark);}" +
      ".wk-live-head{display:flex;align-items:center;gap:10px;font-weight:bold;}" +
      ".wk-dot{width:14px;height:14px;border-radius:50%;flex:0 0 14px;background:#e53935;box-shadow:0 0 0 3px rgba(229,57,53,.2);}" +
      ".wk-dot.ok{background:#2fa15f;box-shadow:0 0 0 3px rgba(47,161,95,.22);}" +
      ".wk-dot.pause{background:#ffb300;box-shadow:0 0 0 3px rgba(255,179,0,.25);}" +
      ".wk-live-time{font-size:2.2em;font-weight:bold;font-variant-numeric:tabular-nums;margin:8px 0 0;}" +
      ".wk-live-dist{font-size:1.3em;font-variant-numeric:tabular-nums;}" +
      ".wk-lost{color:#c0504d;opacity:.8;margin-top:4px;}" +
      ".wk-note{color:var(--ink-soft);margin-top:6px;}" +
      ".wk-btns{display:flex;gap:10px;margin-top:12px;}" +
      ".wk-btns button{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font:inherit;cursor:pointer;}" +
      ".wk-btns button svg{width:20px;height:20px;}" +
      ".wk-btns button.wk-stop{background:var(--danger);border-color:var(--danger);color:var(--parchment);}" +
      ".wk-msg{border-radius:12px;padding:10px 12px;margin:6px 0 12px;background:var(--gold-light);color:var(--ink);}" +
      ".wk-msg button{margin-top:8px;padding:6px 12px;border-radius:10px;border:1px solid var(--wood);background:transparent;color:var(--wood-dark);font:inherit;cursor:pointer;}" +
      ".wk-gaps{margin-top:8px;color:var(--ink);}" +
      ".wk-gaps div{margin-top:3px;}" +
      "#wkRecBtn.wk-active{color:#e53935;}";
    document.head.appendChild(st);
  }

  // ---------- главный экран ----------
  function fabRowHtml(){
    var active = lastState && lastState.status && lastState.status !== "idle";
    return '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn' + (active ? ' wk-active' : '') + '" id="wkRecBtn" title="' + (active ? "Идёт запись" : "Записать тренировку") + '">' + REC_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="wkHomeStub" tabindex="-1" aria-disabled="true">' + HOME_ICON_SVG + '</button>' +
      '</div>';
  }

  function render(){
    var c = container();
    if(!c) return;
    ensureStyle();
    loadPeriod();
    clampEnd();
    var recs = inRange(allRecords());
    var html = '<div class="wk-root" id="' + rootId + '">' +
      '<h3 class="common-tab-title">Тренировки</h3>' +
      '<div id="wkLive"></div>' +
      '<div class="wk-seg">' + PERIODS.map(function(p){
        return '<button type="button" data-months="' + p.months + '" class="' + (p.months === months ? "on" : "") + '">' + p.label + '</button>';
      }).join("") + '</div>' +
      '<div class="wk-nav"><button type="button" id="wkPrev" aria-label="Назад">‹</button><div class="wk-title">' + esc(periodTitle()) +
      '</div><button type="button" id="wkNext" aria-label="Вперёд"' + (endMonth.getTime() >= curMonth().getTime() ? " disabled" : "") + '>›</button></div>' +
      '<div class="wk-total"><div class="wk-km">' + esc(fmtKm(sumM(recs))) + '</div><div class="wk-sub">' +
        (recs.length ? recs.length + " " + plural(recs.length, "тренировка", "тренировки", "тренировок") + " · " + esc(fmtTotal(sumMs(recs))) : "тренировок нет") +
      '</div></div>' +
      byMonthHtml(recs) +
      listHtml(recs) +
      '</div>' + fabRowHtml();
    c.innerHTML = html;
    bind(c);
    lastShape = "";
    pollOnce(true);
    startPoll();
  }

  function plural(n, a, b, c){
    var m10 = n % 10, m100 = n % 100;
    if(m10 === 1 && m100 !== 11) return a;
    if(m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
    return c;
  }

  // строки по месяцам (только когда период больше месяца)
  function byMonthHtml(recs){
    if(months === 1) return "";
    var out = [];
    for(var i = 0; i < months; i++){
      var ms = addMonths(endMonth, -i);
      var a = ms.getTime(), b = addMonths(ms, 1).getTime();
      var part = recs.filter(function(r){ return r.start >= a && r.start < b; });
      out.push('<div class="wk-row" data-month="' + ms.getFullYear() + "-" + ms.getMonth() + '">' +
        '<span class="wk-date">' + esc(MONTHS[ms.getMonth()]) + (months === 12 || ms.getFullYear() !== endMonth.getFullYear() ? " " + ms.getFullYear() : "") + '</span>' +
        '<span class="wk-dist">' + esc(fmtKm(sumM(part))) + '</span>' +
        '<span class="wk-time">' + (part.length ? part.length + " " + plural(part.length, "трен.", "трен.", "трен.") : "—") + '</span></div>');
    }
    return '<div class="wk-card" style="padding:4px 12px;">' + out.join("") + '</div>';
  }

  function listHtml(recs){
    if(!recs.length) return '<div class="wk-empty">В этом периоде тренировок нет.<br>Нажмите кнопку записи внизу, чтобы начать.</div>';
    if(months !== 1) return "";
    return recs.map(function(r){
      var sub = [];
      if(r.how === "raw") sub.push("по GPS");
      if(num(r.lostMs) >= 1000) sub.push("без учёта км: " + fmtDur(r.lostMs));
      var open = openedId === r.id;
      return '<div class="wk-row" data-id="' + esc(r.id) + '">' +
        '<span class="wk-date">' + esc(dayLabel(r.start)) + ' <span class="wk-sub">' + esc(fmtHM(r.start)) + (sub.length ? " · " + esc(sub.join(" · ")) : "") + '</span></span>' +
        '<span class="wk-dist">' + esc(fmtKm(r.m)) + '</span>' +
        '<span class="wk-time">' + esc(fmtClock(r.totalMs)) + '</span></div>' +
        (open ? '<button type="button" class="wk-del" data-del="' + esc(r.id) + '">Удалить</button>' : "");
    }).join("");
  }

  function bind(c){
    var seg = c.querySelectorAll(".wk-seg button");
    Array.prototype.forEach.call(seg, function(b){
      b.addEventListener("click", function(){
        months = parseInt(b.getAttribute("data-months"), 10) || 1;
        savePeriod();
        openedId = null;
        render();
      });
    });
    var prev = document.getElementById("wkPrev"), next = document.getElementById("wkNext");
    if(prev) prev.addEventListener("click", function(){ shift(-1); });
    if(next) next.addEventListener("click", function(){ shift(1); });
    Array.prototype.forEach.call(c.querySelectorAll(".wk-row[data-month]"), function(row){
      row.addEventListener("click", function(){
        var p = String(row.getAttribute("data-month")).split("-");
        months = 1; savePeriod();
        endMonth = monthStart(parseInt(p[0], 10), parseInt(p[1], 10));
        render();
      });
    });
    Array.prototype.forEach.call(c.querySelectorAll(".wk-row[data-id]"), function(row){
      row.addEventListener("click", function(){
        var id = row.getAttribute("data-id");
        openedId = (openedId === id) ? null : id;
        clearArm();
        render();
      });
    });
    Array.prototype.forEach.call(c.querySelectorAll(".wk-del"), function(b){
      b.addEventListener("click", function(){ onDelete(b); });
    });
    var rec = document.getElementById("wkRecBtn");
    if(rec) rec.addEventListener("click", onRecordTap);
    bindSwipe(document.getElementById(rootId));
  }

  function shift(dir){
    clampEnd();
    var n = addMonths(endMonth, dir * months);
    if(n.getTime() > curMonth().getTime()) n = curMonth();
    endMonth = n;
    openedId = null;
    render();
  }

  function bindSwipe(el){
    if(!el) return;
    var sx = 0, sy = 0, on = false;
    el.addEventListener("touchstart", function(e){
      if(!e.touches || e.touches.length !== 1){ on = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true;
    }, { passive: true });
    el.addEventListener("touchend", function(e){
      if(!on) return;
      on = false;
      var t = e.changedTouches && e.changedTouches[0];
      if(!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if(Math.abs(dx) >= SWIPE_DX && Math.abs(dy) <= SWIPE_DY) shift(dx > 0 ? -1 : 1);
    }, { passive: true });
  }

  function clearArm(){ if(delArm){ clearTimeout(delArm.timer); delArm = null; } }
  function onDelete(btn){
    var id = btn.getAttribute("data-del");
    if(delArm && delArm.id === id){
      clearArm();
      try{ if(STORE) STORE.remove(id); }catch(e){}
      openedId = null;
      render();
      return;
    }
    clearArm();
    btn.textContent = "Нажмите ещё раз";
    btn.classList.add("armed");
    delArm = { id: id, timer: setTimeout(function(){
      delArm = null;
      if(btn.isConnected !== false){ btn.textContent = "Удалить"; btn.classList.remove("armed"); }
    }, 3000) };
  }

  // ---------- запись ----------
  function setMessage(text, action){
    message = text || "";
    messageAction = action || "";
    lastShape = "";
    paintLive();
  }

  function onRecordTap(){
    var n = nat();
    if(!n){
      setMessage("Запись тренировки доступна только в приложении для Android.", "");
      return;
    }
    if(lastState && lastState.status && lastState.status !== "idle"){
      return; // запись уже идёт: управление — в панели
    }
    var res = "";
    try{ res = String(n.workoutStart()); }catch(e){ res = "error"; }
    if(res === "ok"){ message = ""; messageAction = ""; }
    else if(res === "permission") setMessage("Разрешите доступ к геолокации в окне системы — запись начнётся сама.", "");
    else if(res === "gps_off") setMessage("GPS выключен. Включите геолокацию и нажмите «Запись» снова.", "gps");
    else if(res === "busy") message = "";
    else setMessage("Не удалось начать запись.", "");
    pollOnce(true);
  }

  window.__ltOnLocationPermission = function(granted){
    if(granted){ message = ""; messageAction = ""; }
    else setMessage("Без доступа к геолокации тренировку записать нельзя. Разрешение можно выдать в настройках приложения.", "");
    pollOnce(true);
  };

  function readState(){
    var n = nat();
    if(!n) return null;
    try{ return JSON.parse(String(n.workoutState())); }catch(e){ return null; }
  }

  function startPoll(){
    if(pollTimer) return;
    pollTimer = setInterval(function(){
      if(!document.getElementById(rootId)){ clearInterval(pollTimer); pollTimer = null; return; }
      pollOnce(false);
    }, POLL_MS);
  }

  function pollOnce(force){
    var st = readState();
    var prev = lastState;
    lastState = st;
    if(st && st.status === "idle" && (st.pending > 0 || (prev && prev.status && prev.status !== "idle"))){
      // запись закончилась: забрать готовую запись от оболочки
      drain();
    }
    var recBtn = document.getElementById("wkRecBtn");
    if(recBtn){
      var active = !!(st && st.status && st.status !== "idle");
      recBtn.classList.toggle("wk-active", active);
    }
    paintLive(force);
  }

  function gapsHtml(gaps){
    if(!gaps || !gaps.length) return "";
    var shown = gaps.slice(0, 5).map(function(g){
      return '<div>с ' + esc(fmtHM(g[0])) + ' по ' + esc(fmtHM(g[1])) + ' (' + esc(fmtDur(g[1] - g[0])) + ')</div>';
    }).join("");
    var more = gaps.length > 5 ? '<div>и ещё ' + (gaps.length - 5) + '</div>' : "";
    return '<div class="wk-gaps">Тренировка не писалась:' + shown + more +
      '<div class="wk-note">Время учтено полностью, а километры на этих отрезках — нет.</div></div>';
  }

  function readLastResult(){
    try{ var r = JSON.parse(localStorage.getItem(LAST_RESULT_KEY) || "null"); return (r && r.id) ? r : null; }catch(e){ return null; }
  }
  function saveLastResult(rec){
    try{ if(rec) localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(rec)); else localStorage.removeItem(LAST_RESULT_KEY); }catch(e){}
  }

  // панель записи / итог / подсказка в верху экрана; перерисовывается по месту, без полного render()
  function paintLive(force){
    var box = document.getElementById("wkLive");
    if(!box) return;
    var st = lastState;
    var active = st && st.status && st.status !== "idle";
    var res = readLastResult();
    var shape = (active ? st.status + ":" + (st.fix ? 1 : 0) + ":" + ((st.gaps || []).length) : "idle") + "|" + (res ? res.id : "") + "|" + message + messageAction;
    if(!force && shape === lastShape && active){
      updateLiveNumbers(box, st);
      return;
    }
    if(!force && shape === lastShape) return;
    lastShape = shape;
    var html = "";
    if(message){
      html += '<div class="wk-msg">' + esc(message) +
        (messageAction === "gps" ? '<br><button type="button" id="wkGpsBtn">Открыть настройки геолокации</button>' : "") + '</div>';
    }
    if(active) html += liveCardHtml(st);
    else if(res) html += resultCardHtml(res);
    box.innerHTML = html;
    var gb = document.getElementById("wkGpsBtn");
    if(gb) gb.addEventListener("click", function(){ var n = nat(); if(n) try{ n.openLocationSettings(); }catch(e){} });
    var pb = document.getElementById("wkPauseBtn");
    if(pb) pb.addEventListener("click", function(){ var n = nat(); if(n) try{ n.workoutPause(); }catch(e){} pollOnce(true); });
    var sb = document.getElementById("wkStopBtn");
    if(sb) sb.addEventListener("click", onStopTap);
    var cb = document.getElementById("wkResultOk");
    if(cb) cb.addEventListener("click", function(){ saveLastResult(null); lastShape = ""; paintLive(true); });
    if(active) updateLiveNumbers(box, st);
  }

  var stopArm = 0;
  function onStopTap(){
    var n = nat();
    if(!n) return;
    var btn = document.getElementById("wkStopBtn");
    var now = Date.now();
    if(now - stopArm > 3000){
      stopArm = now;
      if(btn){
        var lab = btn.querySelector("span"), was = lab.textContent;
        lab.textContent = "Нажмите ещё раз";
        setTimeout(function(){ stopArm = 0; if(lab.isConnected !== false) lab.textContent = was; }, 3000);
      }
      return;
    }
    stopArm = 0;
    try{ n.workoutStop(); }catch(e){}
    pollOnce(true);
  }

  function liveCardHtml(st){
    var status = st.status;
    var head, dotClass = "";
    if(status === "searching"){
      head = "Поиск спутников…";
    } else if(status === "finishing"){
      head = "Сопоставляю маршрут с картой…";
    } else if(status === "paused"){
      head = "Пауза"; dotClass = " pause";
    } else if(st.fix){
      head = "Связь установлена"; dotClass = " ok";
    } else {
      head = "Связь потеряна — километры не считаются";
    }
    var body = "";
    if(status === "searching"){
      body = '<div class="wk-note" id="wkSat"></div><div class="wk-note">Время тренировки начнётся, когда связь будет установлена.</div>';
    } else {
      body = '<div class="wk-live-time" id="wkTime"></div><div class="wk-live-dist" id="wkDist"></div><div class="wk-lost" id="wkLost" style="display:none"></div>' +
        (status === "finishing" ? gapsHtml(st.gaps) : "");
    }
    var btns = "";
    if(status === "searching"){
      btns = '<div class="wk-btns"><button type="button" class="wk-stop" id="wkStopBtn">' + STOP_ICON_SVG + '<span>Отмена</span></button></div>';
    } else if(status === "running" || status === "paused"){
      btns = '<div class="wk-btns"><button type="button" id="wkPauseBtn">' + (status === "paused" ? PLAY_ICON_SVG + "<span>Продолжить</span>" : PAUSE_ICON_SVG + "<span>Пауза</span>") +
        '</button><button type="button" class="wk-stop" id="wkStopBtn">' + STOP_ICON_SVG + '<span>Стоп</span></button></div>';
    }
    return '<div class="wk-card"><div class="wk-live-head"><span class="wk-dot' + dotClass + '"></span><span>' + esc(head) + '</span></div>' + body + btns + '</div>';
  }

  function updateLiveNumbers(box, st){
    var sat = box.querySelector("#wkSat");
    if(sat) sat.textContent = (st.sat >= 0) ? ("Найдено спутников: " + st.sat + (st.satTotal > 0 ? " из " + st.satTotal + " в зоне видимости" : "")) : "Ждём сигнал GPS";
    var t = box.querySelector("#wkTime"), d = box.querySelector("#wkDist"), l = box.querySelector("#wkLost");
    if(t) t.textContent = fmtClock(st.totalMs);
    if(d) d.textContent = fmtKm(st.distM);
    if(l){
      if(num(st.lostMs) >= 1000){ l.style.display = ""; l.textContent = "Километры не учитывались: " + fmtClock(st.lostMs); }
      else l.style.display = "none";
    }
  }

  function resultCardHtml(r){
    var how = r.how === "map" ? "маршрут сверен с картой OpenStreetMap" : "расстояние по GPS (сверить с картой не удалось)";
    return '<div class="wk-card"><div class="wk-live-head"><span class="wk-dot ok"></span><span>Тренировка сохранена</span></div>' +
      '<div class="wk-live-time">' + esc(fmtKm(r.m)) + '</div>' +
      '<div class="wk-live-dist">' + esc(fmtClock(r.totalMs)) + '</div>' +
      '<div class="wk-note">' + esc(how) + '</div>' +
      gapsHtml(r.gaps) +
      '<div class="wk-btns"><button type="button" id="wkResultOk">Понятно</button></div></div>';
  }

  // ---------- забрать готовые записи у оболочки ----------
  function drain(){
    var n = nat();
    if(!n || !STORE) return;
    var arr;
    try{ arr = JSON.parse(String(n.workoutTakeFinished())); }catch(e){ return; }
    if(!Array.isArray(arr) || !arr.length) return;
    var ids = [], newest = null;
    var have = {};
    allRecords().forEach(function(r){ have[r.id] = true; });
    arr.forEach(function(r){
      if(!r || typeof r.id !== "string" || typeof r.start !== "number") return;
      if(!have[r.id]){
        var c = {
          start: r.start, end: num(r.end), m: Math.round(num(r.m)), rawM: Math.round(num(r.rawM)),
          totalMs: Math.round(num(r.totalMs)), lostMs: Math.round(num(r.lostMs)),
          gaps: Array.isArray(r.gaps) ? r.gaps.filter(function(g){ return Array.isArray(g) && g.length === 2; }) : [],
          how: r.how === "map" ? "map" : "raw"
        };
        try{ STORE.put(r.id, c); }catch(e){ return; }
        if(!newest || r.start > newest.start) newest = { id: r.id, start: c.start, m: c.m, totalMs: c.totalMs, gaps: c.gaps, how: c.how };
      }
      ids.push(r.id);
    });
    if(ids.length){ try{ n.workoutAckFinished(JSON.stringify(ids)); }catch(e){} }
    if(newest) saveLastResult(newest);
    refreshIfOpen();
  }

  // вкладка открыта — перерисовать (после слияния с облаком, после забора записей)
  function refreshIfOpen(){
    var btn = document.getElementById("settingsTabWorkoutsBtn");
    if(!btn || !btn.classList.contains("active")) return;
    var a = document.activeElement;
    if(a && a.tagName === "INPUT") return;
    render();
  }

  window.WorkoutsTab = {
    setStore: function(s){ STORE = s; },
    render: render,
    drain: drain,
    refreshIfOpen: refreshIfOpen
  };
})();
