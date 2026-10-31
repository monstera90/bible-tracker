/* ===========================================================================
   screentime.js
   Версия: 3.0 (31.10)
   Вкладка «Трекер экранов» (`screentime`, язычок над «Событиями» в стеке набора 1).
   `window.ScreenTime.{init, render, getTotals, getPeriodTotals, setAppActive, readingPeriods}`.

   Что считает (всё суммируется по ВСЕМ устройствам):
     music  — сколько приложение воспроизводило музыку (считает оболочка Android: `ScreenTimeStats.kt`, мост `getScreenTimeTotals`, версия 16);
     read   — экранное время: ридер книг («Мои книги», только открытая книга) + вкладка ИПКД;
     tasks  — экранное время на всех вкладках задач (TASK_TAB_IDS, архив) и на вкладке «Календарь»; «Comments» не входит;
     notes  — экранное время «Моего блокнота» + «Извлечения субтитров» (один счётчик);
     qr     — экранное время, пока открыта форма создания/правки карточки с QR (вкладка «Карточки предметов», `#itemCardForm`);
     timers — сколько насчитали все таймеры карточек (считает оболочка: `CardTimers.kt` → `ScreenTimeStats`).
   Экранное время идёт, только если окно настроек открыто, страница видима и приложение не свёрнуто (`__ltOnAppPause`/`__ltOnAppResume`).

   Периоды на экране (кнопки нижнего ряда, `PERIODS`, выбор — `localStorage` `screenTimePeriod_v1`): «День» (листать назад по дням,
   вчера, позавчера…), «Нед.» (пн–вс), «Мес.» (календарный месяц), «6 мес.» (шесть календарных месяцев, последний — выбранный).
   Листание — стрелки ‹ › и свайп по вкладке (как в «Тренировках»); в будущее листать нельзя (`shift`, `clampAnchor`).

   Хранение и синхронизация: в общем `state` у КАЖДОГО устройства свой ключ `__screenTime:<deviceId>` =
   {c:{music,read,tasks,notes,qr,timers}, d:{"ГГГГ-ММ-ДД":[music,read,tasks,notes,qr,timers]}, t}
   (миллисекунды, только растут; `c` — накопленное за всё время, `d` — по суткам, порядок массива = порядок `CATEGORIES`, хранится
   KEEP_DAYS суток). Время оболочки (музыка, таймеры) относится к суткам, в которые оно считано при записи (`flush`). Устройство пишет
   только свой ключ, поэтому слияние по ключам (last-write-wins) конфликтов не даёт; итог за период = сумма по всем ключам с этим префиксом.
   В облако ключ уходит редко: при сворачивании приложения и не чаще раза в PUSH_EVERY_MS, пока приложение открыто (в локальное
   хранилище — раз в SAVE_EVERY_MS).
   «Чтение» для календаря (`readingPeriods`, трекер «Чтение» в calendar.js) — НЕ счётчик времени, а отдельная логика поверх того же признака
   «открыт ридер книг/ИПКД» (`categoryFor` = "read"). Заход = непрерывное присутствие (паузы до RV_JOIN_MS склеиваются). Заход ≥ RV_QUALIFY_MS —
   «засчитанный». Цепочка = заходы, между которыми меньше RV_GAP_MS; начинается засчитанным заходом. Период чтения показывается, если один заход
   длился ≥ RV_CONT_MS либо в цепочке ≥ 2 засчитанных захода и от начала первого до конца последнего ≥ RV_SPAN_MS; после этого любой следующий заход
   (хоть секундный) в пределах RV_GAP_MS продлевает период (`rvChains`, `rvEst`). Нет захода RV_GAP_MS — цепочка закрыта и уходит в готовые
   периоды (`rvSave`); следующий заход начинает новую. Хранение — только на устройстве, `localStorage` `readVisits_v1` {v: заходы, p: периоды, c: текущий заход}.
   Чтобы добавить новый счётчик: строка В КОНЕЦ `CATEGORIES` (индекс в `d` — позиция), правило в `categoryFor` (экранный) или источник в `readNative` (оболочка).
   =========================================================================== */
(function(){
  "use strict";

  var KEY_PREFIX = "__screenTime:";
  var TICK_MS = 1000;
  var SAVE_EVERY_MS = 60 * 1000;        // запись в локальный state
  var PUSH_EVERY_MS = 10 * 60 * 1000;   // отправка в облако, пока приложение открыто
  var NATIVE_EVERY_MS = 30 * 1000;      // опрос счётчиков оболочки
  var MAX_GAP_MS = 3000;                // дольше пауза между тиками = сон/заморозка страницы, не считаем
  var KEEP_DAYS = 200;                  // сколько суток хранится посуточная разбивка (хватает на «6 мес.»)
  var PERIOD_KEY = "screenTimePeriod_v1";
  var RV_KEY = "readVisits_v1";
  var RV_JOIN_MS = 60 * 1000;            // уход из ридера короче минуты — тот же заход
  var RV_QUALIFY_MS = 2 * 60 * 1000;     // заход, который считается «заходом»
  var RV_GAP_MS = 20 * 60 * 1000;        // без заходов дольше — чтение закончилось
  var RV_SPAN_MS = 15 * 60 * 1000;       // от первого захода до последнего (при ≥ 2 засчитанных)
  var RV_CONT_MS = 20 * 60 * 1000;       // непрерывное чтение одним заходом
  var RV_SAVE_MS = 15 * 1000;
  var RV_KEEP_MS = 400 * 24 * 3600 * 1000;
  var SWIPE_DX = 70, SWIPE_DY = 50;     // как в workouts.js
  var PERIODS = [
    { id: "day",   label: "День" },
    { id: "week",  label: "Нед." },
    { id: "month", label: "Мес." },
    { id: "6m",    label: "6 мес." }
  ];
  var MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MONTHS_SHORT = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];
  var WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  var HOME_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 11.5L12 4l8 7.5"></path><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"></path><path d="M10 20v-5h4v5"></path></svg>';

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
  var pending = {};        // не записанные в state миллисекунды экранных счётчиков: {"ГГГГ-ММ-ДД": {read: мс, …}}
  var period = "day";      // выбранный период (PERIODS)
  var anchor = null;       // дата (Date, 00:00), по которой определяется показанный период
  var lastTick = 0;
  var lastSave = 0, lastPush = 0, lastNative = 0;
  var dirtySincePush = false;
  var tickTimer = null, renderTimer = null;
  var rv = { v: [], p: [] };  // заходы [начало, конец] и готовые периоды чтения [начало, конец] (мс)
  var rvCur = null;           // текущий заход
  var rvDirty = false, rvLastSave = 0;

  function zeroSet(){ var o = {}; CATEGORIES.forEach(function(c){ o[c.id] = 0; }); return o; }
  function num(v){ v = Number(v); return (isFinite(v) && v > 0) ? Math.floor(v) : 0; }
  function zeroArr(){ return CATEGORIES.map(function(){ return 0; }); }
  function catIndex(id){ for(var i = 0; i < CATEGORIES.length; i++){ if(CATEGORIES[i].id === id) return i; } return -1; }

  // ---------- даты (календарной датой, не прибавлением 24 ч: переход на летнее время) ----------
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function dayKey(d){ return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function dayStart(ts){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function monthStart(d, n){ return new Date(d.getFullYear(), d.getMonth() + (n || 0), 1); }
  function mondayOf(d){ return addDays(d, -((d.getDay() + 6) % 7)); }

  function myKey(){ return KEY_PREFIX + deps.getDeviceId(); }

  // ---------- «Чтение» для календаря (не счётчик времени: см. шапку файла) ----------
  function rvPairs(a){
    var out = [];
    if(!Array.isArray(a)) return out;
    a.forEach(function(x){
      if(Array.isArray(x) && isFinite(x[0]) && isFinite(x[1]) && x[1] >= x[0]) out.push([+x[0], +x[1]]);
    });
    return out;
  }
  function rvLoad(){
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(RV_KEY) || "null"); }catch(e){ o = null; }
    rv = { v: rvPairs(o && o.v), p: rvPairs(o && o.p) };
    var c = rvPairs(o && o.c ? [o.c] : []);
    rvCur = c.length ? c[0] : null;
  }
  // один тик присутствия в ридере/ИПКД
  function rvTouch(now){
    if(rvCur && now - rvCur[1] <= RV_JOIN_MS) rvCur[1] = now;
    else{
      if(rvCur) rv.v.push(rvCur);
      rvCur = [now, now];
    }
    rvDirty = true;
  }
  function rvEst(c){
    var span = c.e - c.s + TICK_MS; // отметки идут раз в TICK_MS: заход из N отметок длится N·TICK_MS
    return span >= RV_CONT_MS || (c.q >= 2 && span >= RV_SPAN_MS);
  }
  // заходы (по времени) → цепочки {s, e, q (засчитанных заходов), vs (заходы цепочки)}
  function rvChains(vis){
    var out = [], cur = null;
    vis.forEach(function(v){
      var qual = (v[1] - v[0] + TICK_MS) >= RV_QUALIFY_MS;
      if(cur && v[0] - cur.e >= RV_GAP_MS){ out.push(cur); cur = null; }
      if(!cur){
        if(!qual) return; // начать чтение может только засчитанный заход
        cur = { s: v[0], e: v[1], q: 1, vs: [v] };
        return;
      }
      if(qual || rvEst(cur)){ // короткий заход продлевает уже состоявшееся чтение
        cur.e = Math.max(cur.e, v[1]);
        if(qual) cur.q++;
        cur.vs.push(v);
      }
    });
    if(cur) out.push(cur);
    return out;
  }
  function rvAll(){
    var all = rv.v.slice();
    if(rvCur) all.push(rvCur);
    all.sort(function(a, b){ return a[0] - b[0]; });
    return all;
  }
  // закрытые цепочки переезжают в готовые периоды, старые заходы убираются
  function rvFinalize(now){
    if(rvCur && now - rvCur[1] > RV_JOIN_MS){ rv.v.push(rvCur); rvCur = null; }
    var chains = rvChains(rvAll());
    var open = [];
    chains.forEach(function(c){
      if(c.e < now - RV_GAP_MS){ if(rvEst(c)) rv.p.push([c.s, c.e]); }
      else c.vs.forEach(function(v){ open.push(v); });
    });
    rv.v = rv.v.filter(function(v){ return v[1] > now - RV_GAP_MS || open.indexOf(v) !== -1; });
    var lim = now - RV_KEEP_MS;
    rv.p = rv.p.filter(function(p){ return p[1] >= lim; });
  }
  function rvSave(now){
    rvLastSave = now;
    rvDirty = false;
    try{
      rvFinalize(now);
      localStorage.setItem(RV_KEY, JSON.stringify({ v: rv.v, p: rv.p, c: rvCur }));
    }catch(e){}
  }
  // периоды чтения для календаря: [{start, end}] (мс), включая идущий сейчас
  function readingPeriods(){
    var out = rv.p.map(function(p){ return { start: p[0], end: p[1] }; });
    rvChains(rvAll()).forEach(function(c){ if(rvEst(c)) out.push({ start: c.s, end: c.e }); });
    return out;
  }

  function getMyRecord(){
    var st = deps.getState() || {};
    var rec = st[myKey()];
    return (rec && rec.c && typeof rec.c === "object") ? rec.c : null;
  }
  function getMyDays(){
    var st = deps.getState() || {};
    var rec = st[myKey()];
    return (rec && rec.d && typeof rec.d === "object") ? rec.d : {};
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
      if(cat){
        var dk = dayKey(new Date(now));
        var po = pending[dk] || (pending[dk] = {});
        po[cat] = (po[cat] || 0) + gap;
        dirtySincePush = true;
        if(cat === "read") rvTouch(now);
      }
    }
    if(now - lastNative >= NATIVE_EVERY_MS && isScreenOn()) readNative();
    if(now - lastSave >= SAVE_EVERY_MS) flush(false);
    if(rvDirty && now - rvLastSave >= RV_SAVE_MS) rvSave(now);
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
    var days = {};
    var oldDays = getMyDays();
    Object.keys(oldDays).forEach(function(k){ if(Object.prototype.toString.call(oldDays[k]) === "[object Array]") days[k] = oldDays[k]; });
    var next = zeroSet();
    var changed = !cur;
    CATEGORIES.forEach(function(c){ next[c.id] = cur ? num(cur[c.id]) : 0; });
    var todayKey = dayKey(new Date(now));
    function bump(dk, id, add){
      var arr = days[dk] ? days[dk].slice() : zeroArr();
      var i = catIndex(id);
      arr[i] = num(arr[i]) + add;
      days[dk] = arr;
    }
    Object.keys(pending).forEach(function(dk){
      var o = pending[dk];
      SCREEN_IDS.forEach(function(id){
        var add = num(o[id]);
        if(add){ next[id] += add; bump(dk, id, add); changed = true; }
      });
    });
    pending = {};
    NATIVE_IDS.forEach(function(id){
      var v = nativeTotals ? num(nativeTotals[id]) : 0;
      if(v > next[id]){
        if(cur) bump(todayKey, id, v - next[id]);   // прирост за время с прошлой записи — в сегодняшние сутки
        next[id] = v; changed = true;                // только растёт
      }
    });
    var oldest = dayKey(addDays(dayStart(now), -KEEP_DAYS));
    Object.keys(days).forEach(function(k){ if(k < oldest){ delete days[k]; changed = true; } });
    if(changed){
      var st = deps.getState();
      if(st){
        st[myKey()] = { c: next, d: days, t: now };
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
    Object.keys(pending).forEach(function(dk){
      SCREEN_IDS.forEach(function(id){ total[id] += num(pending[dk][id]); });
    });
    NATIVE_IDS.forEach(function(id){
      var have = cur ? num(cur[id]) : 0;
      var v = nativeTotals ? num(nativeTotals[id]) : 0;
      if(v > have) total[id] += v - have;
    });
    total.devices = devices;
    return total;
  }

  // ---------- итоги за период ----------
  // сутки всех устройств + ещё не записанное на этом: {"ГГГГ-ММ-ДД": {music,read,…}}
  function collectDays(){
    var out = {};
    function add(dk, id, ms){
      if(!ms) return;
      var o = out[dk] || (out[dk] = zeroSet());
      o[id] += ms;
    }
    var st = deps.getState() || {};
    Object.keys(st).forEach(function(k){
      if(k.indexOf(KEY_PREFIX) !== 0) return;
      var rec = st[k];
      if(!rec || !rec.d || typeof rec.d !== "object") return;
      Object.keys(rec.d).forEach(function(dk){
        var arr = rec.d[dk];
        if(Object.prototype.toString.call(arr) !== "[object Array]") return;
        CATEGORIES.forEach(function(c, i){ add(dk, c.id, num(arr[i])); });
      });
    });
    Object.keys(pending).forEach(function(dk){
      SCREEN_IDS.forEach(function(id){ add(dk, id, num(pending[dk][id])); });
    });
    var cur = getMyRecord();
    if(cur){
      var todayKey = dayKey(new Date());
      NATIVE_IDS.forEach(function(id){
        var v = nativeTotals ? num(nativeTotals[id]) : 0;
        if(v > num(cur[id])) add(todayKey, id, v - num(cur[id]));
      });
    }
    return out;
  }

  // границы показанного периода (Date, включительно)
  function rangeOf(per, a){
    if(per === "week"){ var m = mondayOf(a); return { from: m, to: addDays(m, 6) }; }
    if(per === "month"){ return { from: monthStart(a, 0), to: addDays(monthStart(a, 1), -1) }; }
    if(per === "6m"){ return { from: monthStart(a, -5), to: addDays(monthStart(a, 1), -1) }; }
    return { from: a, to: a };
  }

  // итоги по категориям за период [from, to] (Date)
  function getPeriodTotals(from, to){
    var days = collectDays();
    var total = zeroSet();
    for(var d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)){
      var o = days[dayKey(d)];
      if(o) CATEGORIES.forEach(function(c){ total[c.id] += o[c.id]; });
    }
    return total;
  }

  function loadPeriod(){
    try{
      var v = localStorage.getItem(PERIOD_KEY);
      if(PERIODS.some(function(p){ return p.id === v; })) period = v;
    }catch(e){}
  }
  function savePeriod(){ try{ localStorage.setItem(PERIOD_KEY, period); }catch(e){} }

  function clampAnchor(){
    var today = dayStart(Date.now());
    if(!anchor || anchor.getTime() > today.getTime()) anchor = today;
  }

  function isLatest(){
    return rangeOf(period, anchor).to.getTime() >= dayStart(Date.now()).getTime();
  }

  function shift(dir){
    clampAnchor();
    if(period === "day") anchor = addDays(anchor, dir);
    else if(period === "week") anchor = addDays(anchor, dir * 7);
    else if(period === "month") anchor = monthStart(anchor, dir);
    else anchor = monthStart(anchor, dir * 6);
    clampAnchor();
    render();
  }

  function periodTitle(){
    var r = rangeOf(period, anchor);
    var today = dayStart(Date.now());
    if(period === "day"){
      var diff = Math.round((today.getTime() - r.from.getTime()) / 86400000);
      if(diff === 0) return "Сегодня";
      if(diff === 1) return "Вчера";
      if(diff === 2) return "Позавчера";
      return WEEKDAYS[r.from.getDay()] + ", " + r.from.getDate() + " " + MONTHS_GEN[r.from.getMonth()] + (r.from.getFullYear() !== today.getFullYear() ? " " + r.from.getFullYear() : "");
    }
    if(period === "week"){
      var a = r.from, b = r.to;
      var left = a.getDate() + (a.getMonth() !== b.getMonth() ? " " + MONTHS_SHORT[a.getMonth()] : "");
      return left + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
    }
    if(period === "month") return MONTHS[r.from.getMonth()] + " " + r.from.getFullYear();
    var f = r.from, t = r.to;
    return MONTHS_SHORT[f.getMonth()] + (f.getFullYear() !== t.getFullYear() ? " " + f.getFullYear() : "") + " – " + MONTHS_SHORT[t.getMonth()] + " " + t.getFullYear();
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
      ".st-root{padding:14px 14px 64px;color:var(--wood);}" +
      ".st-nav{display:flex;align-items:center;justify-content:space-between;margin:4px 0 6px;}" +
      ".st-nav button{width:40px;height:36px;border-radius:10px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font-size:1.3em;line-height:1;cursor:pointer;}" +
      ".st-nav button:disabled{opacity:.3;cursor:default;}" +
      ".st-nav .st-per-title{font-weight:bold;text-align:center;flex:1;color:var(--ink);}" +
      ".st-per{width:auto;min-width:40px;padding:0 6px;font:inherit;font-size:11px;white-space:nowrap;}" +
      ".st-per.on{background:var(--wood);color:var(--parchment);border-color:var(--wood);}" +
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

  function rowsHtml(){
    var r = rangeOf(period, anchor);
    var t = getPeriodTotals(r.from, r.to);
    return CATEGORIES.map(function(c){
      var ms = t[c.id];
      return '<div class="st-row">' +
        '<div class="st-ico"><svg viewBox="0 0 24 24">' + c.svg + '</svg></div>' +
        '<div class="st-main"><div class="st-name">' + esc(c.title) + '</div><div class="st-hint">' + esc(c.hint) + '</div></div>' +
        '<div class="st-val"><div class="st-big">' + fmt(ms) + '</div><div class="st-min">' + Math.floor(ms / 60000) + ' мин</div></div>' +
        '</div>';
    }).join("");
  }

  function subText(){
    return "Сумма по всем устройствам (устройств в счёте: " + getTotals().devices + ")";
  }

  function html(){
    return '<div class="st-root" id="screenTimeRoot">' +
      '<div class="st-title">Трекер экранов</div>' +
      '<div class="st-nav"><button type="button" id="stPrev" aria-label="Назад">‹</button><div class="st-per-title" id="stPerTitle">' + esc(periodTitle()) +
      '</div><button type="button" id="stNext" aria-label="Вперёд"' + (isLatest() ? " disabled" : "") + '>›</button></div>' +
      '<div class="st-sub" id="screenTimeSub">' + esc(subText()) + '</div>' +
      '<div id="screenTimeRows">' + rowsHtml() + '</div></div>';
  }

  function fabRowHtml(){
    return '<div class="mdeditor-fab-row">' +
      PERIODS.map(function(p){
        return '<button type="button" class="mdeditor-fab-btn st-per' + (p.id === period ? " on" : "") + '" data-period="' + p.id + '">' + p.label + '</button>';
      }).join("") +
      '<button type="button" class="mdeditor-fab-btn" id="stHomeStub" tabindex="-1" aria-disabled="true">' + HOME_ICON_SVG + '</button>' +
      '</div>';
  }

  var swipeEl = null, swipeStart = null, swipeEnd = null;
  // свайп по всей области вкладки; слушатели снимаются при каждой перерисовке
  function bindSwipe(el){
    if(swipeEl){
      swipeEl.removeEventListener("touchstart", swipeStart, true);
      swipeEl.removeEventListener("touchend", swipeEnd, true);
    }
    var sx = 0, sy = 0, on = false;
    swipeStart = function(e){
      if(!document.getElementById("screenTimeRoot") || !e.touches || e.touches.length !== 1){ on = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true;
    };
    swipeEnd = function(e){
      if(!on) return;
      on = false;
      if(!document.getElementById("screenTimeRoot")) return;
      var t = e.changedTouches && e.changedTouches[0];
      if(!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if(Math.abs(dx) < SWIPE_DX || Math.abs(dy) > SWIPE_DY) return;
      if(dx < 0 && isLatest()) return;   // в будущее листать нельзя
      shift(dx > 0 ? -1 : 1);
    };
    swipeEl = el;
    el.addEventListener("touchstart", swipeStart, { passive: true, capture: true });
    el.addEventListener("touchend", swipeEnd, { passive: true, capture: true });
  }

  function bind(container){
    Array.prototype.forEach.call(container.querySelectorAll(".st-per"), function(b){
      b.addEventListener("click", function(){
        period = b.getAttribute("data-period");
        savePeriod();
        render();
      });
    });
    var prev = document.getElementById("stPrev"), next = document.getElementById("stNext");
    if(prev) prev.addEventListener("click", function(){ shift(-1); });
    if(next) next.addEventListener("click", function(){ if(!isLatest()) shift(1); });
    bindSwipe(container);
  }

  function render(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    ensureStyle();
    loadPeriod();
    clampAnchor();
    readNative();
    flush(false);
    container.innerHTML = html() + fabRowHtml();
    bind(container);
    clearInterval(renderTimer);
    renderTimer = setInterval(function(){
      var rows = document.getElementById("screenTimeRows");
      if(!rows){ clearInterval(renderTimer); renderTimer = null; return; }
      rows.innerHTML = rowsHtml();
      var sub = document.getElementById("screenTimeSub");
      if(sub) sub.textContent = subText();
    }, 5000);
  }

  function setAppActive(on){
    on = !!on;
    if(appActive === on) return;
    appActive = on;
    lastTick = Date.now();
    if(!on){ flush(true); rvSave(Date.now()); }          // свернули: записать и отправить в облако
    else readNative();
  }

  function init(d){
    deps = d;
    lastTick = lastSave = lastPush = Date.now();
    rvLoad();
    rvSave(lastTick);
    readNative();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", function(){
      lastTick = Date.now();
      if(document.visibilityState === "hidden"){ flush(true); rvSave(Date.now()); }
    });
  }

  window.ScreenTime = { init: init, render: render, getTotals: getTotals, getPeriodTotals: getPeriodTotals, setAppActive: setAppActive, readingPeriods: readingPeriods };
})();
