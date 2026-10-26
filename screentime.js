/* ===========================================================================
   screentime.js
   Версия: 1.0 (26.10) — новый файл. Вкладка «Трекер экранов» (`screentime`, язычок над «Событиями» в стеке набора 1).
   `window.ScreenTime.{init, render, getTotals, setAppActive}`.

   Что считает (всё суммируется по ВСЕМ устройствам):
     music  — сколько приложение воспроизводило музыку (считает оболочка Android: `ScreenTimeStats.kt`, мост `getScreenTimeTotals`, версия 16);
     read   — экранное время: ридер книг («Мои книги», только открытая книга) + вкладка ИПКД;
     tasks  — экранное время на всех вкладках задач (TASK_TAB_IDS, архив) и на вкладке «Календарь»; «Comments» не входит;
     notes  — экранное время «Моего блокнота» + «Извлечения субтитров» (один счётчик);
     qr     — экранное время, пока открыта форма создания/правки карточки с QR (вкладка «Карточки предметов», `#itemCardForm`);
     timers — сколько насчитали все таймеры карточек (считает оболочка: `CardTimers.kt` → `ScreenTimeStats`).
   Экранное время идёт, только если окно настроек открыто, страница видима и приложение не свёрнуто (`__ltOnAppPause`/`__ltOnAppResume`).

   Хранение и синхронизация: в общем `state` у КАЖДОГО устройства свой ключ `__screenTime:<deviceId>` = {c:{music,read,tasks,notes,qr,timers}, t}
   (миллисекунды, только растут). Устройство пишет только свой ключ, поэтому слияние по ключам (last-write-wins) конфликтов не даёт;
   общий итог = сумма по всем ключам с этим префиксом. В облако ключ уходит редко: при сворачивании приложения и не чаще раза в
   PUSH_EVERY_MS, пока приложение открыто (в локальное хранилище — раз в SAVE_EVERY_MS).
   Чтобы добавить новый счётчик: строка в CATEGORIES, правило в `categoryFor` (экранный) или источник в `readNative` (оболочка).
   =========================================================================== */
(function(){
  "use strict";

  var KEY_PREFIX = "__screenTime:";
  var TICK_MS = 1000;
  var SAVE_EVERY_MS = 60 * 1000;        // запись в локальный state
  var PUSH_EVERY_MS = 10 * 60 * 1000;   // отправка в облако, пока приложение открыто
  var NATIVE_EVERY_MS = 30 * 1000;      // опрос счётчиков оболочки
  var MAX_GAP_MS = 3000;                // дольше пауза между тиками = сон/заморозка страницы, не считаем

  // порядок = порядок строк на экране
  var CATEGORIES = [
    { id: "music",  title: "Музыка",              hint: "сколько приложение играло музыку",
      svg: '<path d="M9 18V6l10-2v12"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="16.5" cy="16" r="2.5"></circle>' },
    { id: "read",   title: "Чтение книг и ИПКД",  hint: "открыт ридер книг или вкладка ИПКД",
      svg: '<path d="M3 5.5C5.5 4.3 8.5 4.3 12 6c3.5-1.7 6.5-1.7 9-.5V19c-2.5-1.2-5.5-1.2-9 .5-3.5-1.7-6.5-1.7-9-.5z"></path><path d="M12 6v13.5"></path>' },
    { id: "tasks",  title: "Задачи и календарь",  hint: "все вкладки задач и календарь (без Comments)",
      svg: '<rect x="4" y="3.5" width="16" height="17" rx="2"></rect><path d="M8 9l1.6 1.6L12.5 7.7"></path><path d="M8 15h8"></path>' },
    { id: "notes",  title: "Заметки и субтитры",  hint: "«Мой блокнот» и «Извлечение субтитров»",
      svg: '<path d="M6 3.5h9l3 3V20.5H6z"></path><path d="M9 11h6"></path><path d="M9 14.5h6"></path>' },
    { id: "qr",     title: "QR-коды",             hint: "создание и правка карточек с QR",
      svg: '<rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="4" width="6" height="6" rx="1"></rect><rect x="4" y="14" width="6" height="6" rx="1"></rect><path d="M14 14h2.5v2.5H14zM18 18h2M18 14v2"></path>' },
    { id: "timers", title: "Таймеры",             hint: "сколько насчитали все таймеры",
      svg: '<circle cx="12" cy="13.5" r="7.5"></circle><path d="M12 9.5v4l2.5 1.5"></path><path d="M9.5 2.5h5"></path>' }
  ];
  var SCREEN_IDS = ["read", "tasks", "notes", "qr"];   // считаются здесь, по экрану
  var NATIVE_IDS = ["music", "timers"];                 // считает оболочка

  var deps = null;
  var appActive = true;
  var pending = {};        // не записанные в state миллисекунды экранных счётчиков
  var lastTick = 0;
  var lastSave = 0, lastPush = 0, lastNative = 0;
  var dirtySincePush = false;
  var tickTimer = null, renderTimer = null;

  function zeroSet(){ var o = {}; CATEGORIES.forEach(function(c){ o[c.id] = 0; }); return o; }
  function num(v){ v = Number(v); return (isFinite(v) && v > 0) ? Math.floor(v) : 0; }

  function myKey(){ return KEY_PREFIX + deps.getDeviceId(); }

  function getMyRecord(){
    var st = deps.getState() || {};
    var rec = st[myKey()];
    return (rec && rec.c && typeof rec.c === "object") ? rec.c : null;
  }

  // ---------- какой счётчик сейчас идёт ----------
  function categoryFor(ctx){
    if(!ctx || !ctx.open) return null;
    var tab = ctx.tab;
    if(tab === "set2s_8") return "read";
    if(tab === "set2s_7") return ctx.reader ? "read" : null;
    if(tab === "set2s_1" || tab === "set2b_4") return "notes";
    if(tab === "set2s_9") return ctx.qrForm ? "qr" : null;
    if(tab === ctx.calendarKey || tab === "jointArchive" || (ctx.taskTabs && ctx.taskTabs.indexOf(tab) !== -1)) return "tasks";
    return null;
  }

  function isScreenOn(){
    return appActive && document.visibilityState !== "hidden";
  }

  function tick(){
    var now = Date.now();
    var gap = now - lastTick;
    lastTick = now;
    if(gap < 0 || gap > MAX_GAP_MS) gap = 0;
    if(gap && isScreenOn()){
      var cat = null;
      try{ cat = categoryFor(deps.getContext()); }catch(e){}
      if(cat){ pending[cat] = (pending[cat] || 0) + gap; dirtySincePush = true; }
    }
    if(now - lastNative >= NATIVE_EVERY_MS && isScreenOn()) readNative();
    if(now - lastSave >= SAVE_EVERY_MS) flush(false);
    if(dirtySincePush && now - lastPush >= PUSH_EVERY_MS) flush(true);
  }

  // ---------- счётчики оболочки ----------
  var nativeTotals = null;
  function readNative(){
    lastNative = Date.now();
    try{
      var n = window.LifeTrackerNative;
      if(!n || typeof n.getScreenTimeTotals !== "function") return;
      var o = JSON.parse(n.getScreenTimeTotals());
      nativeTotals = { music: num(o.music), timers: num(o.timers) };
    }catch(e){}
  }

  // ---------- запись в state ----------
  function flush(push){
    var now = Date.now();
    lastSave = now;
    if(deps.isReady && !deps.isReady()) return;
    readNative();
    var cur = getMyRecord();
    var next = zeroSet();
    var changed = !cur;
    CATEGORIES.forEach(function(c){ next[c.id] = cur ? num(cur[c.id]) : 0; });
    SCREEN_IDS.forEach(function(id){
      var add = num(pending[id]);
      if(add){ next[id] += add; changed = true; }
      pending[id] = 0;
    });
    NATIVE_IDS.forEach(function(id){
      var v = nativeTotals ? num(nativeTotals[id]) : 0;
      if(v > next[id]){ next[id] = v; changed = true; }   // только растёт
    });
    if(changed){
      var st = deps.getState();
      if(st){
        st[myKey()] = { c: next, t: now };
        deps.saveLocalState();
      }
    }
    if(push && (changed || dirtySincePush)){
      lastPush = now;
      dirtySincePush = false;
      deps.scheduleCloudPush();
    }
  }

  // ---------- итоги по всем устройствам ----------
  function getTotals(){
    var total = zeroSet(), devices = 0;
    var st = deps.getState() || {};
    var mine = myKey();
    Object.keys(st).forEach(function(k){
      if(k.indexOf(KEY_PREFIX) !== 0) return;
      var rec = st[k];
      if(!rec || !rec.c) return;
      var c = rec.c;
      devices++;
      CATEGORIES.forEach(function(cat){ total[cat.id] += num(c[cat.id]); });
    });
    // то, что ещё не записано в state на этом устройстве
    var cur = getMyRecord();
    if(!cur) devices++;
    SCREEN_IDS.forEach(function(id){ total[id] += num(pending[id]); });
    NATIVE_IDS.forEach(function(id){
      var have = cur ? num(cur[id]) : 0;
      var v = nativeTotals ? num(nativeTotals[id]) : 0;
      if(v > have) total[id] += v - have;
    });
    total.devices = devices;
    return total;
  }

  function fmt(ms){
    var min = Math.floor(ms / 60000);
    var h = Math.floor(min / 60), m = min % 60;
    if(h > 0) return h + " ч " + (m < 10 ? "0" : "") + m + " мин";
    return m + " мин";
  }

  // ---------- экран вкладки ----------
  function ensureStyle(){
    if(document.getElementById("screenTimeStyle")) return;
    var st = document.createElement("style");
    st.id = "screenTimeStyle";
    st.textContent =
      ".st-root{padding:14px 14px 24px;color:var(--wood);}" +
      ".st-title{font-size:1.15em;font-weight:600;margin:2px 0 4px;}" +
      ".st-sub{opacity:.7;font-size:.85em;margin-bottom:14px;}" +
      ".st-row{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid rgba(127,127,127,.25);}" +
      ".st-row:last-child{border-bottom:none;}" +
      ".st-ico{flex:0 0 34px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;}" +
      ".st-ico svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}" +
      ".st-main{flex:1 1 auto;min-width:0;}" +
      ".st-name{font-weight:600;}" +
      ".st-hint{opacity:.65;font-size:.8em;}" +
      ".st-val{text-align:right;white-space:nowrap;}" +
      ".st-big{font-weight:700;font-size:1.05em;}" +
      ".st-min{opacity:.65;font-size:.8em;}";
    document.head.appendChild(st);
  }

  function esc(s){ return String(s).replace(/[&<>"]/g, function(ch){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]; }); }

  function html(){
    var t = getTotals();
    var rows = CATEGORIES.map(function(c){
      var ms = t[c.id];
      return '<div class="st-row">' +
        '<div class="st-ico"><svg viewBox="0 0 24 24">' + c.svg + '</svg></div>' +
        '<div class="st-main"><div class="st-name">' + esc(c.title) + '</div><div class="st-hint">' + esc(c.hint) + '</div></div>' +
        '<div class="st-val"><div class="st-big">' + fmt(ms) + '</div><div class="st-min">' + Math.floor(ms / 60000) + ' мин</div></div>' +
        '</div>';
    }).join("");
    return '<div class="st-root" id="screenTimeRoot">' +
      '<div class="st-title">Трекер экранов</div>' +
      '<div class="st-sub">Сумма по всем устройствам (устройств в счёте: ' + t.devices + ')</div>' + rows + '</div>';
  }

  function render(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    ensureStyle();
    readNative();
    flush(false);
    container.innerHTML = html();
    clearInterval(renderTimer);
    renderTimer = setInterval(function(){
      var root = document.getElementById("screenTimeRoot");
      if(!root){ clearInterval(renderTimer); renderTimer = null; return; }
      var tmp = document.createElement("div");
      tmp.innerHTML = html();
      if(tmp.firstChild) root.innerHTML = tmp.firstChild.innerHTML;
    }, 5000);
  }

  function setAppActive(on){
    on = !!on;
    if(appActive === on) return;
    appActive = on;
    lastTick = Date.now();
    if(!on){ flush(true); }          // свернули: записать и отправить в облако
    else readNative();
  }

  function init(d){
    deps = d;
    lastTick = lastSave = lastPush = Date.now();
    readNative();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", function(){
      lastTick = Date.now();
      if(document.visibilityState === "hidden") flush(true);
    });
  }

  window.ScreenTime = { init: init, render: render, getTotals: getTotals, setAppActive: setAppActive };
})();
