/* ===========================================================================
   workouts.js
   Версия: 5.1 (31.10)
   Версия: 2.0 (28.10) — структурная правка: «Нагрузка» (метод sRPE): окно оценки после тренировки в области панели записи (`rpeCardHtml`, `saveRpe`, `pendingRecord`), запрет новой записи до ответа (`startNative` → "rpe"), баллы у каждой записи, кнопка-индикатор суммы за 7 дней слева от «1 мес.» (`weekLoad`, `#wkLoadBtn`) и краткая справка (`infoCardHtml`).
   Версия: 1.3 (28.10) — `WorkoutsTab.start()` (старт записи без экрана, для QR «Комбинированный»).
   Версия: 1.2 (27.10) — панель записи закреплена внизу над нижним рядом (не прокручивается), отступ до ряда = зазору между кнопками ряда; список тренировок прокручивается в оставшейся области (`.wk-scroll`).
   Версия: 1.1 (27.10) — кнопки периода («1 мес. / 3 мес. / 6 мес. / Год») перенесены в нижний ряд слева от «Записи»; свайп влево/вправо работает по всей области вкладки (слушатели на контейнере).
   Версия: 1.0 (27.10) — новый файл. Вкладка «Тренировки» (`workouts`, кнопка `settingsTabWorkoutsBtn` в нижнем ряду набора 1,
   между шестерёнкой и «Картой дней года»). `window.WorkoutsTab.{setStore, render, drain, refreshIfOpen, refreshTabMark, start}`.

   Что на экране:
   • период: «1 мес. / 3 мес. / 6 мес. / Год» (кнопки в нижнем ряду), стрелки «‹ ›» листают период назад и вперёд (свайп влево/вправо по
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

   Запись тренировки: {id, start, end, m (метры, итог), rawM (метры по GPS), totalMs, lostMs, gaps:[[с,по]], how:"map"|"raw"[, jumps (сколько раз GPS «уезжал» в сторону и это отброшено, только если было), rpe (1…10)]}.

   «Нагрузка» (sRPE, session RPE): сразу после остановки (кнопкой в панели, в уведомлении или в острове — не важно, запись попадает в `drain`)
   запись помечается как ожидающая оценки (поле `needRpe:1` в самой записи, поэтому метка уезжает в облако и окно оценки появляется и на другом устройстве; `needRpe` снимается при сохранении оценки; старый локальный список `workoutsPendingRpe_v1` один раз переносится в записи — `migrateLocalPending`) и в области панели записи (`#wkLive`,
   там же, где идёт таймер) вместо итога появляется окно «Насколько тяжёлой была тренировка?» с кнопками 1…10 и «Сохранить». Окно не закрывается
   и ждёт ответа сколько угодно (если запись удалить, ожидание снимается). Пока идёт запись или есть тренировка без оценки, язычок вкладки подсвечен как у непрочитанного ИПКД (`workouts-tab-unread`, `refreshTabMark`, раз в 2 с и после слияния с облаком). Карточка «Тренировка сохранена» после оценки без кнопок: закрывается нажатием и сама исчезает при следующем открытии вкладки. Пока оценки нет, новая запись не стартует
   (`startNative` отвечает "rpe"; кнопка «Запись» приглушена; `start()` для QR «Комбинированный» тоже отвечает "rpe"). Баллы тренировки =
   минуты × оценка; минуты — `Math.round(totalMs / 60000)` (общее время существующего таймера, с учётом и без учёта километров),
   баллы не хранятся, а считаются из `totalMs` и `rpe` (`loadOf`). Баллы показаны в строке записи списка и на итоговой карточке.
   Кнопка-индикатор `#wkLoadBtn` (размер обычной кнопки ряда, самая левая в ряду, слева от «1 мес.») показывает сумму баллов за 7 дней: сегодня и 6 предыдущих
   календарных дней по дню начала тренировки (`loadWindowStart`: календарная дата, не 7×24 ч — безопасно при переводе часов; дни выпадают сами в полночь).
   Записи без оценки в сумму не входят (в том числе все записи, сделанные до появления «Нагрузки»). Нажатие на кнопку открывает/закрывает справку.
   Импорт (кнопка со стрелкой вверх в нижнем ряду, слева от индикатора нагрузки, `#wkImportBtn`, скрытый `<input type=\"file\" id=\"wkImportInput\">`; `onImportFile`) принимает два вида файла, определяет их по содержимому:
   (1) локальный архив «Экспортировать личные данные» (ZIP с data.json или сам data.json, `readLocalArchive`): берутся ТОЛЬКО записи `wk:*` из `rawState.data` (метры, время, оценка), остальные данные не трогаются; уже имеющиеся id пропускаются, метка `needRpe` не переносится;
   (2) CSV-выгрузка стороннего трекера (`parseCsv`, колонки `date`, `distance_km`, `type_label`/`type_code`, `has_workout`): берутся только пробежки (`CSV_RUN_LABELS`/`CSV_RUN_CODES`) с километражем > 0 — дата и километры, без времени и баллов. Запись {start (дата и часы:минуты из колонки), end=start, m, rawM, totalMs:0, how:\"imp\", imp:1}, id `imp-ГГГГММДД-ЧЧММ` (повторный импорт не дублирует). Импортированные записи не попадают в `records()` для календаря (нет длительности).
   Информация — кнопка «i» (`#wkInfoBtn`) открывает экран «Тренировки — кнопки» (`renderInfoScreen`), «домик» возвращает на вкладку.
   Для экспорта — `WorkoutsTab.exportRecords()` (читаемый раздел `workouts` в data.json, собирает my.js).
   Хранилище — провайдер от my.js (`setStore`, раздел «ТРЕНИРОВКИ» в my.js): запись лежит в личном `state` под ключом
   `wk:<id>` = {c, t} и едет в облако вместе с остальными данными и в экспорт; удаление — тумбстоун {c:null, t}.
   =========================================================================== */
(function(){
  "use strict";

  var PERIOD_KEY = "workoutsPeriod_v1";
  var LAST_RESULT_KEY = "workoutsLastResult_v1";
  var PENDING_KEY = "workoutsPendingRpe_v1";   // id записей, ждущих оценки (только это устройство)
  var LOAD_DAYS = 7;                           // окно суммы баллов: сегодня и 6 предыдущих дней
  var LOAD_CHECK_MS = 60000;                   // как часто пересчитывать кнопку-индикатор (дни выпадают сами)
  var RPE_LABELS = ["Очень легко", "Легко", "Умеренно", "Немного тяжело", "Тяжело", "Тяжело", "Очень тяжело", "Очень тяжело", "Почти предел", "Максимум усилий"];
  var CSV_RUN_LABELS = ["бег"];                // какие занятия из CSV считаются пробежкой (type_label)
  var CSV_RUN_CODES = ["1", "8"];             // запасной признак, если type_label пуст (type_code)
  var POLL_MS = 500;
  var TAB_MARK_MS = 2000;                      // как часто обновлять подсветку язычка вкладки
  var PEND_CACHE_MS = 1500;
  var SWIPE_DX = 70, SWIPE_DY = 50;
  var MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var MONTHS_SHORT = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];
  var WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  var PERIODS = [
    { months: 1, label: "1 мес." },
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
  var INFO_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M12 11v6"></path><circle cx="12" cy="7.7" r="1" fill="currentColor" stroke="none"></circle></svg>';
  var IMPORT_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V10"></path><path d="M7.5 13.5L12 9l4.5 4.5"></path><path d="M4.5 5.5h15"></path></svg>';
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
  var rpeSel = 0;          // выбранная, но ещё не сохранённая оценка в окне «Насколько тяжёлой была тренировка?»
  var infoOpen = false;    // открыта справка про sRPE (кнопка-индикатор)
  var lastLoadCheck = 0;   // когда в последний раз пересчитывали кнопку-индикатор
  var pendCache = null;    // {at, val}: короткий кэш pendingRecord (чтобы не перебирать все записи на каждом тике)
  var tabMarkTimer = null; // таймер подсветки язычка вкладки
  var infoScreen = false;  // открыт экран «Тренировки — кнопки» (кнопка «i»)
  var importMsg = "";      // итог последнего импорта (карточка над панелью записи; нажатие закрывает)
  var importBusy = false;  // идёт чтение файла импорта

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

  // ---------- «Нагрузка» (sRPE) ----------
  function rpeOk(v){ v = Number(v); return v >= 1 && v <= 10 && Math.floor(v) === v; }
  function minutesOf(r){ return Math.round(Math.max(0, num(r.totalMs)) / 60000); }
  function loadOf(r){ return rpeOk(r.rpe) ? minutesOf(r) * Number(r.rpe) : 0; }
  function pointsWord(n){ return plural(n, "балл", "балла", "баллов"); }
  // на кнопке места мало: до 9999 — как есть, дальше «12,3к»
  function fmtPoints(n){
    n = Math.round(num(n));
    return n >= 10000 ? (Math.round(n / 100) / 10).toFixed(1).replace(".", ",") + "к" : String(n);
  }
  // начало окна: полночь дня «сегодня − 6» по календарной дате (не «минус 7 × 24 ч» — сутки при переводе часов бывают 23/25 ч)
  function loadWindowStart(){
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() - (LOAD_DAYS - 1), 0, 0, 0, 0).getTime();
  }
  function weekLoad(){
    var from = loadWindowStart(), s = 0;
    allRecords().forEach(function(r){ if(r.start >= from) s += loadOf(r); });
    return s;
  }
  function updateLoadBtn(){
    var b = document.getElementById("wkLoadBtn");
    if(!b) return;
    var t = fmtPoints(weekLoad());
    if(b.textContent !== t) b.textContent = t;
    b.classList.toggle("long", t.length >= 5);
    lastLoadCheck = Date.now();
  }

  // Запись ждёт оценки, если в ней стоит needRpe и нет оценки 1…10. Метка лежит в самой записи и синхронизируется вместе с ней.
  function needsRpe(r){ return !!(r && r.needRpe && !rpeOk(r.rpe)); }
  // старый локальный список ожидающих (только это устройство) → метка needRpe в записях; выполняется один раз
  function readPending(){
    try{
      var a = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
      return Array.isArray(a) ? a.filter(function(x){ return typeof x === "string"; }) : [];
    }catch(e){ return []; }
  }
  function migrateLocalPending(){
    var ids = readPending();
    if(!ids.length || !STORE) return;
    var byId = {};
    allRecords().forEach(function(r){ byId[r.id] = r; });
    ids.forEach(function(id){
      var r = byId[id];
      if(!r || rpeOk(r.rpe) || r.needRpe) return;
      var c = {};
      Object.keys(r).forEach(function(k){ if(k !== "id") c[k] = r[k]; });
      c.needRpe = 1;
      try{ STORE.put(id, c); }catch(e){}
    });
    try{ localStorage.removeItem(PENDING_KEY); }catch(e){}
    pendCache = null;
  }
  // самая старая запись, которой ещё нужна оценка (удалённые в списке не видны); null — ждать нечего
  function pendingRecord(){
    if(!STORE) return null;
    var now = Date.now();
    if(pendCache && now - pendCache.at < PEND_CACHE_MS) return pendCache.val;
    migrateLocalPending();
    var found = null;
    allRecords().forEach(function(r){
      if(needsRpe(r) && (!found || num(r.start) < num(found.start))) found = r;
    });
    pendCache = { at: now, val: found };
    return found;
  }
  // язычок вкладки: подсвечен, пока идёт запись или есть тренировка без оценки
  function refreshTabMark(){
    var btn = document.getElementById("settingsTabWorkoutsBtn");
    if(!btn) return;
    var st = readState();
    var active = !!(st && st.status && st.status !== "idle");
    btn.classList.toggle("workouts-tab-unread", active || !!pendingRecord());
  }
  function startTabMark(){
    if(tabMarkTimer) return;
    tabMarkTimer = setInterval(refreshTabMark, TAB_MARK_MS);
    refreshTabMark();
  }
  function saveRpe(){
    var rec = pendingRecord();
    if(!rec || !rpeOk(rpeSel) || !STORE) return;
    var c = {};
    Object.keys(rec).forEach(function(k){ if(k !== "id") c[k] = rec[k]; });
    c.rpe = rpeSel;
    delete c.needRpe;
    try{ STORE.put(rec.id, c); }
    catch(e){ setMessage("Не удалось сохранить оценку. Попробуйте ещё раз.", ""); return; }
    pendCache = null;
    saveLastResult({ id: rec.id, start: rec.start, m: rec.m, totalMs: rec.totalMs, gaps: rec.gaps || [], how: rec.how, jumps: rec.jumps, rpe: rpeSel });
    rpeSel = 0; message = ""; messageAction = "";
    render(); // обновит список, кнопку-индикатор и панель
    refreshTabMark();
  }

  // ---------- стили ----------
  function ensureStyle(){
    if(document.getElementById("workoutsStyle")) return;
    var st = document.createElement("style");
    st.id = "workoutsStyle";
    st.textContent =
      ".wk-root{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}" +
      ".wk-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none;padding-bottom:12px;}" +
      ".wk-scroll::-webkit-scrollbar{display:none;width:0;height:0;}" +
      "#wkLive{flex:none;max-height:60%;overflow-y:auto;margin-bottom:calc(var(--fab-size,36px) + 2 * var(--fab-gap,6px));}" +
      "#wkLive .wk-card,#wkLive .wk-msg{margin-bottom:0;}" +
      "#wkLive > * + *{margin-top:var(--fab-gap,6px);}" +
      ".wk-per{width:auto;min-width:40px;padding:0 6px;font:inherit;font-size:11px;white-space:nowrap;}" +
      ".wk-per.on{background:var(--wood);color:var(--parchment);border-color:var(--wood);}" +
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
      "#wkRecBtn.wk-active{color:#e53935;}" +
      "#wkRecBtn.wk-blocked{opacity:.45;}" +
      ".wk-load{padding:0;font:inherit;font-size:12px;font-weight:bold;line-height:1;font-variant-numeric:tabular-nums;color:var(--wood-dark);overflow:hidden;}" +
      ".wk-load.long{font-size:10px;}" +
      ".wk-load.on{background:var(--wood);color:var(--parchment);border-color:var(--wood);}" +
      ".wk-info .wk-note{color:var(--ink);}" +
      ".wk-rpe-q{font-weight:bold;font-size:1.1em;}" +
      ".wk-rpe-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px;}" +
      ".wk-rpe-btn{height:44px;border-radius:10px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font:inherit;font-size:1.15em;font-weight:bold;font-variant-numeric:tabular-nums;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
      ".wk-rpe-btn.on{background:var(--wood);border-color:var(--wood);color:var(--parchment);}" +
      ".wk-rpe-hint{margin-top:8px;color:var(--ink-soft);min-height:2.4em;}" +
      ".wk-btns button.wk-save:not(:disabled){background:var(--wood);border-color:var(--wood);color:var(--parchment);}" +
      ".wk-btns button:disabled{opacity:.4;cursor:default;}";
    document.head.appendChild(st);
  }

  // ---------- главный экран ----------
  function fabRowHtml(){
    var active = lastState && lastState.status && lastState.status !== "idle";
    var lt = fmtPoints(weekLoad());
    return '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="wkInfoBtn" title="Информация" aria-label="Информация">' + INFO_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="wkImportBtn" title="Загрузить тренировки из файла" aria-label="Загрузить тренировки из файла">' + IMPORT_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn wk-load' + (lt.length >= 5 ? " long" : "") + (infoOpen ? " on" : "") + '" id="wkLoadBtn" title="Нагрузка за 7 дней" aria-label="Нагрузка за 7 дней">' + esc(lt) + '</button>' +
      PERIODS.map(function(p){
        return '<button type="button" class="mdeditor-fab-btn wk-per' + (p.months === months ? " on" : "") + '" data-months="' + p.months + '">' + p.label + '</button>';
      }).join("") +
      '<button type="button" class="mdeditor-fab-btn' + (active ? ' wk-active' : '') + (pendingRecord() && !active ? ' wk-blocked' : '') + '" id="wkRecBtn" title="' + (active ? "Идёт запись" : "Записать тренировку") + '">' + REC_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="wkHomeStub" tabindex="-1" aria-disabled="true">' + HOME_ICON_SVG + '</button>' +
      '</div>' +
      '<input type="file" id="wkImportInput" accept=".zip,.json,.csv,text/csv,application/zip,application/json" style="display:none;">';
  }

  function render(){
    var c = container();
    if(!c) return;
    pendCache = null;
    infoScreen = false;
    ensureStyle();
    loadPeriod();
    clampEnd();
    var recs = inRange(allRecords());
    var html = '<div class="wk-root" id="' + rootId + '">' +
      '<div class="wk-scroll">' +
      '<h3 class="common-tab-title">Тренировки</h3>' +
      '<div class="wk-nav"><button type="button" id="wkPrev" aria-label="Назад">‹</button><div class="wk-title">' + esc(periodTitle()) +
      '</div><button type="button" id="wkNext" aria-label="Вперёд"' + (endMonth.getTime() >= curMonth().getTime() ? " disabled" : "") + '>›</button></div>' +
      '<div class="wk-total"><div class="wk-km">' + esc(fmtKm(sumM(recs))) + '</div><div class="wk-sub">' +
        summaryHtml(recs) +
      '</div></div>' +
      byMonthHtml(recs) +
      listHtml(recs) +
      '</div>' +
      '<div id="wkLive"></div>' +
      '</div>' + fabRowHtml();
    c.innerHTML = html;
    lastLoadCheck = Date.now();
    bind(c);
    lastShape = "";
    pollOnce(true);
    startPoll();
    refreshTabMark();
  }

  // «86 тренировок · из них 2 · 21 мин»: время есть не у всех записей (импортированные без времени)
  function summaryHtml(recs){
    if(!recs.length) return "тренировок нет";
    var timed = recs.filter(function(r){ return num(r.totalMs) > 0; });
    var out = recs.length + " " + plural(recs.length, "тренировка", "тренировки", "тренировок");
    if(!timed.length) return out;
    if(timed.length < recs.length) out += " · из них " + timed.length;
    return out + " · " + esc(fmtTotal(sumMs(timed)));
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
    var pend = pendingRecord(), pid = pend ? pend.id : "";
    return recs.map(function(r){
      var sub = [];
      if(rpeOk(r.rpe)) sub.push(minutesOf(r) + " мин × " + r.rpe + " = " + loadOf(r) + " " + pointsWord(loadOf(r)));
      else if(r.id === pid) sub.push("ждёт оценки");
      if(r.imp) sub.push("импорт");
      else if(r.how === "raw") sub.push("по GPS");
      if(num(r.jumps) > 0) sub.push("выбросов GPS: " + Math.round(num(r.jumps)));
      if(num(r.lostMs) >= 1000) sub.push("без учёта км: " + fmtDur(r.lostMs));
      var open = openedId === r.id;
      return '<div class="wk-row" data-id="' + esc(r.id) + '">' +
        '<span class="wk-date">' + esc(dayLabel(r.start)) + ' <span class="wk-sub">' + esc(fmtHM(r.start)) + (sub.length ? " · " + esc(sub.join(" · ")) : "") + '</span></span>' +
        '<span class="wk-dist">' + esc(fmtKm(r.m)) + '</span>' +
        '<span class="wk-time">' + (num(r.totalMs) > 0 ? esc(fmtClock(r.totalMs)) : "") + '</span></div>' +
        (open ? '<button type="button" class="wk-del" data-del="' + esc(r.id) + '">Удалить</button>' : "");
    }).join("");
  }

  function bind(c){
    var seg = c.querySelectorAll(".wk-per");
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
    var lb = document.getElementById("wkLoadBtn");
    if(lb) lb.addEventListener("click", function(){
      infoOpen = !infoOpen;
      lb.classList.toggle("on", infoOpen);
      paintLive(true);
    });
    var ib = document.getElementById("wkInfoBtn");
    if(ib) ib.addEventListener("click", renderInfoScreen);
    var imb = document.getElementById("wkImportBtn"), inp = document.getElementById("wkImportInput");
    if(imb && inp){
      imb.addEventListener("click", function(){ if(!importBusy) inp.click(); });
      inp.addEventListener("change", function(){
        var f = inp.files && inp.files[0];
        inp.value = "";
        if(f) onImportFile(f);
      });
    }
    bindSwipe(c);
  }

  function shift(dir){
    clampEnd();
    var n = addMonths(endMonth, dir * months);
    if(n.getTime() > curMonth().getTime()) n = curMonth();
    endMonth = n;
    openedId = null;
    render();
  }

  var swipeEl = null, swipeStart = null, swipeEnd = null;
  // свайп по всей области вкладки (в том числе по пустому месту под списком); слушатели снимаются при каждой перерисовке
  function bindSwipe(el){
    if(swipeEl){
      swipeEl.removeEventListener("touchstart", swipeStart, true);
      swipeEl.removeEventListener("touchend", swipeEnd, true);
    }
    var sx = 0, sy = 0, on = false;
    swipeStart = function(e){
      if(!document.getElementById(rootId) || !e.touches || e.touches.length !== 1){ on = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = true;
    };
    swipeEnd = function(e){
      if(!on) return;
      on = false;
      if(!document.getElementById(rootId)) return;
      var t = e.changedTouches && e.changedTouches[0];
      if(!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if(Math.abs(dx) >= SWIPE_DX && Math.abs(dy) <= SWIPE_DY) shift(dx > 0 ? -1 : 1);
    };
    swipeEl = el;
    el.addEventListener("touchstart", swipeStart, { passive: true, capture: true });
    el.addEventListener("touchend", swipeEnd, { passive: true, capture: true });
  }

  function clearArm(){ if(delArm){ clearTimeout(delArm.timer); delArm = null; } }
  function onDelete(btn){
    var id = btn.getAttribute("data-del");
    if(delArm && delArm.id === id){
      clearArm();
      try{ if(STORE) STORE.remove(id); }catch(e){}
      pendCache = null;
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

  // старт записи без экрана (кнопка и QR «Комбинированный»): "ok" | "permission" | "gps_off" | "busy" | "nonative" | "error"
  function startNative(){
    var n = nat();
    if(!n) return "nonative";
    if(pendingRecord()) return "rpe"; // предыдущая тренировка ещё без оценки — новую не начинаем
    try{ return String(n.workoutStart()); }catch(e){ return "error"; }
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
    var res = startNative();
    if(res === "ok"){ message = ""; messageAction = ""; }
    else if(res === "permission") setMessage("Разрешите доступ к геолокации в окне системы — запись начнётся сама.", "");
    else if(res === "gps_off") setMessage("GPS выключен. Включите геолокацию и нажмите «Запись» снова.", "gps");
    else if(res === "busy") message = "";
    else if(res === "rpe") setMessage("Сначала оцените предыдущую тренировку — окно с вопросом выше.", "");
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
    if(Date.now() - lastLoadCheck >= LOAD_CHECK_MS) updateLoadBtn();
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
    var pendAny = pendingRecord();
    var pend = active ? null : pendAny;
    var recBtn = document.getElementById("wkRecBtn");
    if(recBtn) recBtn.classList.toggle("wk-blocked", !!pendAny && !active);
    var shape = (active ? st.status + ":" + (st.fix ? 1 : 0) + ":" + ((st.gaps || []).length) : "idle") + "|" + (res ? res.id : "") + "|" + message + messageAction +
      "|" + (pend ? pend.id + ":" + rpeSel : "") + "|" + (infoOpen ? "i" : "") + "|" + importMsg;
    if(!force && shape === lastShape && active){
      updateLiveNumbers(box, st);
      return;
    }
    if(!force && shape === lastShape) return;
    lastShape = shape;
    var html = "";
    if(infoOpen) html += infoCardHtml();
    if(importMsg) html += '<div class="wk-msg" id="wkImportMsg">' + esc(importMsg) + '</div>';
    if(message){
      html += '<div class="wk-msg">' + esc(message) +
        (messageAction === "gps" ? '<br><button type="button" id="wkGpsBtn">Открыть настройки геолокации</button>' : "") + '</div>';
    }
    if(active) html += liveCardHtml(st);
    else if(pend) html += rpeCardHtml(pend);
    else if(res) html += resultCardHtml(res);
    box.innerHTML = html;
    var gb = document.getElementById("wkGpsBtn");
    if(gb) gb.addEventListener("click", function(){ var n = nat(); if(n) try{ n.openLocationSettings(); }catch(e){} });
    var pb = document.getElementById("wkPauseBtn");
    if(pb) pb.addEventListener("click", function(){ var n = nat(); if(n) try{ n.workoutPause(); }catch(e){} pollOnce(true); });
    var sb = document.getElementById("wkStopBtn");
    if(sb) sb.addEventListener("click", onStopTap);
    var im = document.getElementById("wkImportMsg");
    if(im) im.addEventListener("click", function(){ importMsg = ""; lastShape = ""; paintLive(true); });
    var ic = document.getElementById("wkInfoCard");
    if(ic) ic.addEventListener("click", function(){
      infoOpen = false;
      var lb = document.getElementById("wkLoadBtn");
      if(lb) lb.classList.remove("on");
      paintLive(true);
    });
    Array.prototype.forEach.call(box.querySelectorAll(".wk-rpe-btn"), function(b){
      b.addEventListener("click", function(){ rpeSel = parseInt(b.getAttribute("data-rpe"), 10) || 0; paintLive(true); });
    });
    var rs = document.getElementById("wkRpeSave");
    if(rs) rs.addEventListener("click", saveRpe);
    var rc = document.getElementById("wkResultCard");
    if(rc) rc.addEventListener("click", function(){ saveLastResult(null); lastShape = ""; paintLive(true); }); // нажатие на карточку закрывает её
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

  // окно оценки: стоит там, где во время тренировки идёт таймер; ждёт ответа, пока человек не выберет оценку и не нажмёт «Сохранить»
  function rpeCardHtml(rec){
    var btns = "";
    for(var i = 1; i <= 10; i++){
      btns += '<button type="button" class="wk-rpe-btn' + (i === rpeSel ? " on" : "") + '" data-rpe="' + i + '">' + i + '</button>';
    }
    var mins = minutesOf(rec);
    var hint = rpeOk(rpeSel)
      ? '<b>' + rpeSel + '</b> — ' + esc(RPE_LABELS[rpeSel - 1]) + '. ' + mins + ' мин × ' + rpeSel + ' = ' + (mins * rpeSel) + ' ' + pointsWord(mins * rpeSel)
      : 'Выберите оценку: 1 — очень легко, 10 — максимум усилий.';
    return '<div class="wk-card"><div class="wk-live-head"><span class="wk-dot ok"></span><span class="wk-rpe-q">Насколько тяжёлой была тренировка?</span></div>' +
      '<div class="wk-note">' + esc(dayLabel(rec.start)) + ' · ' + esc(fmtHM(rec.start)) + ' · ' + esc(fmtClock(rec.totalMs)) + ' · ' + esc(fmtKm(rec.m)) + '</div>' +
      '<div class="wk-rpe-grid">' + btns + '</div>' +
      '<div class="wk-rpe-hint">' + hint + '</div>' +
      '<div class="wk-btns"><button type="button" class="wk-save" id="wkRpeSave"' + (rpeOk(rpeSel) ? "" : " disabled") + '>Сохранить</button></div></div>';
  }

  // краткая справка по кнопке-индикатору
  function infoCardHtml(){
    return '<div class="wk-card wk-info" id="wkInfoCard"><div class="wk-live-head"><span>Нагрузка (метод sRPE)</span></div>' +
      '<div class="wk-note">sRPE (session RPE) — простой способ оценить, сколько нагрузки дала тренировка. После неё вы оцениваете, насколько она была тяжёлой, по шкале от 1 (очень легко) до 10 (максимум усилий).</div>' +
      '<div class="wk-note">Баллы тренировки = минуты × оценка. Например, 40 минут с оценкой 6 дают 240 баллов.</div>' +
      '<div class="wk-note">Число на кнопке — сумма баллов за последние 7 дней: сегодня и шесть предыдущих дней, старые дни выпадают сами. Тренировки без оценки в сумму не входят. Сравнивайте недели между собой: резкий скачок вверх — повод дать телу время на восстановление.</div>' +
      '<div class="wk-note">Нажмите на карточку, чтобы закрыть.</div></div>';
  }

  function resultCardHtml(r){
    var how = r.how === "map" ? "маршрут сверен с картой OpenStreetMap" : "расстояние по GPS (сверить с картой не удалось)";
    return '<div class="wk-card" id="wkResultCard"><div class="wk-live-head"><span class="wk-dot ok"></span><span>Тренировка сохранена</span></div>' +
      '<div class="wk-live-time">' + esc(fmtKm(r.m)) + '</div>' +
      '<div class="wk-live-dist">' + esc(fmtClock(r.totalMs)) + '</div>' +
      '<div class="wk-note">' + esc(how) + '</div>' +
      (num(r.jumps) > 0 ? '<div class="wk-note">Отброшено выбросов GPS: ' + Math.round(num(r.jumps)) + '</div>' : "") +
      (rpeOk(r.rpe) ? '<div class="wk-note">Нагрузка: ' + minutesOf(r) + ' мин × ' + r.rpe + ' = ' + loadOf(r) + ' ' + pointsWord(loadOf(r)) + '</div>' : "") +
      gapsHtml(r.gaps) + '</div>';
  }

  // ---------- экран «Тренировки — кнопки» (кнопка «i») ----------
  function renderInfoScreen(){
    var c = container();
    if(!c) return;
    infoScreen = true;
    function row(svg, html){
      return '<div class="task-info-item"><div class="task-info-icon">' + svg + '</div><div class="task-info-text">' + html + '</div></div>';
    }
    var html = "";
    html += row(REC_ICON_SVG, "Вкладка записывает пробежки по GPS и считает километры. Запись («красный кружок») работает только в приложении для Android: поиск спутников → «Связь установлена» → пауза/стоп в панели или в уведомлении. После остановки оцените, насколько тяжёлой была тренировка (1…10).");
    html += row('<span style="font-size:12px;font-weight:bold;">0</span>', "Число слева в нижнем ряду — нагрузка за 7 дней: баллы = минуты × оценка. Нажатие открывает пояснение.");
    html += row('<span style="font-size:11px;font-weight:bold;">1 мес.</span>', "Период: месяц, 3 месяца, полгода, год. Стрелки ‹ › и свайп листают назад и вперёд, сверху — сумма километров и число тренировок. Нажатие на строку записи открывает «Удалить» (нужно нажать дважды).");
    html += row(IMPORT_ICON_SVG, "Загружает тренировки из файла. Подходят два вида: архив «Экспортировать личные данные» (ZIP или data.json) — из него берутся только тренировки, остальные данные не меняются; и CSV-выгрузка стороннего трекера — из неё берутся только пробежки: дата и километры (время и баллы не переносятся). Уже имеющиеся тренировки повторно не добавляются.");
    html += row(INFO_ICON_SVG, "Эта справка. Тренировки входят в экспорт личных данных: дата, километры, время и баллы.");
    c.innerHTML =
      '<h3 class="common-tab-title">Тренировки — кнопки</h3>' +
      '<div class="task-info-body">' + html + '</div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn" id="wkInfoHomeBtn" title="Назад к тренировкам">' + HOME_ICON_SVG + '</button>' +
      '</div>';
    var hb = document.getElementById("wkInfoHomeBtn");
    if(hb) hb.addEventListener("click", function(){
      // «Действие ВПЕРЁД»: шаг «назад» вернёт на этот экран — тот же приём, что у инструкции вкладки «Книги»
      if(window.AppNav) window.AppNav.push(function(){ renderInfoScreen(); });
      render();
    });
  }

  // ---------- импорт тренировок из файла ----------
  function readFileBytes(file){
    return new Promise(function(resolve, reject){
      var fr = new FileReader();
      fr.onload = function(){ resolve(new Uint8Array(fr.result)); };
      fr.onerror = function(){ reject(new Error("read")); };
      fr.readAsArrayBuffer(file);
    });
  }
  function decodeText(bytes){
    var t = new TextDecoder("utf-8").decode(bytes);
    return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
  }
  function localDate(ts){
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // CSV → массив строк-массивов (кавычки, \r\n, разделитель «,» или «;» — по первой строке)
  function csvRows(text){
    var first = text.split("\n", 1)[0];
    var sep = (first.split(";").length > first.split(",").length) ? ";" : ",";
    var rows = [], row = [], cur = "", q = false;
    for(var i = 0; i < text.length; i++){
      var ch = text.charAt(i);
      if(q){
        if(ch === '"'){ if(text.charAt(i + 1) === '"'){ cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if(ch === '"') q = true;
      else if(ch === sep){ row.push(cur); cur = ""; }
      else if(ch === "\n"){ row.push(cur); cur = ""; rows.push(row); row = []; }
      else if(ch !== "\r") cur += ch;
    }
    if(cur !== "" || row.length){ row.push(cur); rows.push(row); }
    return rows;
  }

  // CSV стороннего трекера: только пробежки с километражем; берётся дата (с часами и минутами из неё) и километры
  function parseCsv(text){
    var rows = csvRows(text);
    if(!rows.length) throw new Error("csv_format");
    var head = rows[0].map(function(h){ return String(h).trim().toLowerCase(); });
    var iDate = head.indexOf("date"), iKm = head.indexOf("distance_km");
    if(iDate < 0 || iKm < 0) throw new Error("csv_format");
    var iLabel = head.indexOf("type_label"), iCode = head.indexOf("type_code"), iHas = head.indexOf("has_workout");
    var out = [], used = {};
    for(var r = 1; r < rows.length; r++){
      var row = rows[r];
      if(iHas >= 0 && String(row[iHas] || "").trim() !== "1") continue;
      var label = iLabel >= 0 ? String(row[iLabel] || "").trim().toLowerCase() : "";
      var code = iCode >= 0 ? String(row[iCode] || "").trim() : "";
      var isRun = label ? CSV_RUN_LABELS.indexOf(label) >= 0 : CSV_RUN_CODES.indexOf(code) >= 0;
      if(!isRun) continue;
      var km = parseFloat(String(row[iKm] || "").replace(",", "."));
      if(!(km > 0)) continue;
      var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(row[iDate] || "").trim());
      if(!m) continue;
      var hh = m[4] != null ? parseInt(m[4], 10) : 12, mi = m[5] != null ? parseInt(m[5], 10) : 0;
      var start = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hh, mi, 0, 0).getTime();
      if(!isFinite(start)) continue;
      var id = "imp-" + m[1] + m[2] + m[3] + "-" + pad2(hh) + pad2(mi), n = 1, base = id;
      while(used[id]){ n++; id = base + "-" + n; }
      used[id] = true;
      var meters = Math.round(km * 1000);
      out.push({ id: id, c: { start: start, end: start, m: meters, rawM: meters, totalMs: 0, lostMs: 0, gaps: [], how: "imp", imp: 1 } });
    }
    return out;
  }

  // запись из локального архива → безопасный вид (как у drain), без метки ожидания оценки
  function cleanRecord(c){
    if(!c || typeof c !== "object" || typeof c.start !== "number" || !isFinite(c.start)) return null;
    var o = {
      start: c.start, end: num(c.end), m: Math.round(num(c.m)), rawM: Math.round(num(c.rawM)),
      totalMs: Math.round(num(c.totalMs)), lostMs: Math.round(num(c.lostMs)),
      gaps: Array.isArray(c.gaps) ? c.gaps.filter(function(g){ return Array.isArray(g) && g.length === 2; }) : [],
      how: (c.how === "map" || c.how === "imp") ? c.how : "raw"
    };
    if(num(c.jumps) > 0) o.jumps = Math.round(num(c.jumps));
    if(rpeOk(c.rpe)) o.rpe = Number(c.rpe);
    if(c.imp) o.imp = 1;
    return o;
  }
  function recordsFromRawState(raw){
    var out = [];
    Object.keys(raw).forEach(function(k){
      if(k.indexOf("wk:") !== 0) return;
      var rec = raw[k];
      if(!rec || !rec.c) return; // тумбстоуны не переносим
      var c = cleanRecord(rec.c);
      if(c) out.push({ id: k.slice(3), c: c });
    });
    return out;
  }
  function readLocalArchive(bytes, isZip){
    function fromJson(text){
      var parsed;
      try{ parsed = JSON.parse(text); }catch(e){ throw new Error("bad_json"); }
      if(!parsed || !parsed.rawState || typeof parsed.rawState.data !== "object" || !parsed.rawState.data) throw new Error("no_raw_state");
      return recordsFromRawState(parsed.rawState.data);
    }
    if(!isZip) return Promise.resolve(fromJson(decodeText(bytes)));
    if(!window.MiniZip || !window.MiniZip.extractAllFiles) return Promise.reject(new Error("no_zip_module"));
    return window.MiniZip.extractAllFiles(bytes).then(function(entries){
      var entry = null;
      entries.forEach(function(e){ if(/(^|\/)data\.json$/i.test(e.path)) entry = e; });
      if(!entry) throw new Error("no_data_json");
      return fromJson(decodeText(entry.data));
    });
  }

  function importErrorText(err){
    var code = err && err.message;
    if(code === "csv_format") return "Не удалось импортировать: в CSV нет колонок date и distance_km.";
    if(code === "no_raw_state") return "Не удалось импортировать: в файле нет данных приложения (возможно, архив сделан старой версией).";
    if(code === "no_data_json") return "Не удалось импортировать: в архиве нет data.json.";
    if(code === "no_zip_module") return "Не удалось прочитать ZIP: модуль не загружен.";
    return "Не удалось прочитать файл. Подходят архив «Экспортировать личные данные» (ZIP или data.json) и CSV-выгрузка с тренировками.";
  }

  function applyImport(list, kindLabel){
    if(!STORE) throw new Error("no_store");
    var have = {};
    allRecords().forEach(function(r){ have[r.id] = true; });
    var items = [], skipped = 0, meters = 0;
    list.forEach(function(it){
      if(have[it.id]){ skipped++; return; }
      have[it.id] = true;
      items.push(it);
      meters += num(it.c.m);
    });
    if(items.length){
      if(typeof STORE.putMany === "function") STORE.putMany(items);
      else items.forEach(function(it){ STORE.put(it.id, it.c); });
    }
    pendCache = null;
    var text;
    if(!list.length) text = "В файле не найдено тренировок для импорта.";
    else {
      text = kindLabel + ": добавлено " + items.length + " " + plural(items.length, "тренировка", "тренировки", "тренировок") +
        (items.length ? " (" + fmtKm(meters) + ")" : "");
      if(skipped) text += ", уже были: " + skipped;
      text += ".";
    }
    return text;
  }

  function onImportFile(file){
    if(importBusy) return;
    importBusy = true;
    importMsg = "Читаю файл…";
    lastShape = ""; paintLive(true);
    readFileBytes(file).then(function(bytes){
      var isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4B;
      var head = isZip ? "" : decodeText(bytes.subarray(0, Math.min(bytes.length, 64))).replace(/^\s+/, "");
      if(isZip) return readLocalArchive(bytes, true).then(function(l){ return { list: l, label: "Архив приложения" }; });
      if(head.charAt(0) === "{") return readLocalArchive(bytes, false).then(function(l){ return { list: l, label: "Архив приложения" }; });
      return { list: parseCsv(decodeText(bytes)), label: "CSV" };
    }).then(function(res){
      importMsg = applyImport(res.list, res.label);
    }).catch(function(err){
      importMsg = importErrorText(err);
    }).then(function(){
      importBusy = false;
      render(); // новые записи сразу видны в итогах
      lastShape = ""; paintLive(true);
    });
  }

  // ---------- забрать готовые записи у оболочки ----------
  function drain(){
    var n = nat();
    if(!n || !STORE) return;
    var arr;
    try{ arr = JSON.parse(String(n.workoutTakeFinished())); }catch(e){ return; }
    if(!Array.isArray(arr) || !arr.length) return;
    var ids = [];
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
        if(num(r.jumps) > 0) c.jumps = Math.round(num(r.jumps));
        c.needRpe = 1; // сначала оценка тяжести (sRPE), итоговая карточка появится после неё; метка едет в облако вместе с записью
        try{ STORE.put(r.id, c); }catch(e){ return; }
        pendCache = null;
      }
      ids.push(r.id);
    });
    if(ids.length){ try{ n.workoutAckFinished(JSON.stringify(ids)); }catch(e){} }
    refreshIfOpen();
    refreshTabMark();
  }

  // вкладка открыта — перерисовать (после слияния с облаком, после забора записей)
  function refreshIfOpen(){
    pendCache = null;
    refreshTabMark();
    var btn = document.getElementById("settingsTabWorkoutsBtn");
    if(!btn || !btn.classList.contains("active")) return;
    if(infoScreen) return;
    var a = document.activeElement;
    if(a && a.tagName === "INPUT") return;
    render();
  }

  window.WorkoutsTab = {
    setStore: function(s){ STORE = s; pendCache = null; startTabMark(); },
    render: function(){ infoOpen = false; importMsg = ""; saveLastResult(null); render(); }, // итоговая карточка живёт до ухода с вкладки
    drain: drain,
    // для календаря («трекеры занятий»): записи как есть — [{id, start, end, totalMs (мс чистого движения), m (метры)}], новые сверху
    records: function(){
      return allRecords().filter(function(r){ return !r.imp; }).map(function(r){ return { id: r.id, start: r.start, end: num(r.end), totalMs: num(r.totalMs), m: num(r.m) }; });
    },
    // для экспорта (раздел `workouts` в data.json): читаемые записи, старые сверху
    exportRecords: function(){
      return allRecords().slice().reverse().map(function(r){
        var o = {
          id: r.id, date: localDate(r.start), start: new Date(r.start).toISOString(),
          km: Math.round(num(r.m) / 10) / 100, meters: Math.round(num(r.m)),
          source: r.imp ? "импорт" : (r.how === "map" ? "GPS + карта" : "GPS")
        };
        if(!r.imp){
          o.rawMeters = Math.round(num(r.rawM));
          o.totalSeconds = Math.round(num(r.totalMs) / 1000);
          o.minutes = minutesOf(r);
          o.lostSeconds = Math.round(num(r.lostMs) / 1000);
          if(num(r.jumps) > 0) o.gpsJumps = Math.round(num(r.jumps));
          if(rpeOk(r.rpe)){ o.rpe = Number(r.rpe); o.points = loadOf(r); }
        }
        return o;
      });
    },
    refreshIfOpen: refreshIfOpen,
    refreshTabMark: refreshTabMark,
    start: function(){ var r = startNative(); if(r === "rpe") setMessage("Сначала оцените предыдущую тренировку — окно с вопросом выше.", ""); else if(r === "gps_off") setMessage("GPS выключен. Включите геолокацию и нажмите «Запись» снова.", "gps"); else if(r === "permission") setMessage("Разрешите доступ к геолокации в окне системы — запись начнётся сама.", ""); return r; }
  };
})();
