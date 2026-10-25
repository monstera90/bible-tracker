/* ===========================================================================
   calendar.js
   Версия: 6.0 (25.10)
   Вкладка «Календарь» (ключ `calendar`, кнопка `settingsTabCalendarBtn` — самый нижний язычок бокового стека набора 1,
   под «В работе»). Точка входа — window.CalendarTab.render(); my.js зовёт её из switchSettingsTab (renderSettingsTabCalendar).
   Два режима, кнопка-переключатель — первая в нижнем ряду (`calendarModeBtn`), выбор хранится в `calendarMode_v1`
   ("list" | "week"), рисует нужный `renderMain` (из форм возвращаются тоже через него):
   • «Список» (в стиле центра событий — вкладки-колокольчика, eventlog.js: `.event-center`, `.event-day`, `.event-row`,
     `.event-time`) — `renderList`;
   • «Неделя» (как в Google Календаре) — `renderWeek`: шапка с «‹ › Сегодня» и диапазоном дат, ряд дней Пн–Вс, сетка
     24 часа × `hourPx` (щипок двумя пальцами по вертикали меняет высоту часа в пределах `HOUR_MIN`…`HOUR_MAX`, значение
     хранится в `calendarHourPx_v1`; на время жеста блоки пересчитываются на месте `applyZoom`, по отпусканию неделя
     перерисовывается — перераскладка пересечений), события блоками на своём месте (`weekSegments`: событие через полночь режется по дням, пересекающиеся
     встают в колонки `packDay`). Показываются ВСЕ повторения серий этой недели (сворачивания серий в неделе нет). Тап по
     блоку — форма этого повторения, тап по пустому месту сетки — форма нового мероприятия на этот день с началом в начале
     нажатого часа (`openForm(null, null, начало)`); смена недели — стрелки или свайп по сетке. Вход во вкладку открывает текущую неделю;
     возвращение из формы — ту же неделю с той же прокруткой (`weekStart`, `weekScrollKeep`). Шапка липкая (`position:sticky`;
     на старом WebView без sticky просто прокручивается вместе с сеткой).
   Экран: список мероприятий (дни без мероприятий не показываются) и нижний ряд кнопок `.mdeditor-fab-row`: «+» (новое
   мероприятие) слева от «домика»; «домик» здесь — пустышка в углу, как на списках «Мои книги» и «Карточки предметов».
   Тап по мероприятию открывает ту же форму для правки (с кнопкой «Удалить»).
   Мероприятие: {id, title, start, end, repeat, cal, updatedAt[, until, skip]}; cal — календарь: "personal" (по умолчанию, и если поля нет) | "shared"
   (поле «Календарь» в форме; пока различие только в цвете: личный — как «Радость» в диаграмме настроений (--mood-joy), общий — цвет
   выделенной вкладки (--wood); переменные --cal-personal/--cal-shared и классы .cal-c-personal/.cal-c-shared в components.css); start/end — мс (локальное время), repeat — "" | day |
   week | month | year. Хранилище — провайдер от my.js (`setStore`, раздел «КАЛЕНДАРЬ: СИНХРОНИЗАЦИЯ МЕРОПРИЯТИЙ» в my.js): мероприятие — как задача.
   Личное лежит в личном `state` (ключ `ev:<id>`) и едет вместе с личными задачами; общее — в группе (`/groups/<groupId>/events`)
   и едет вместе с общими задачами, доступ тот же, что к общим задачам (читатель группы только смотрит). Модуль работает с полным списком
   (`load()` — копии записей), а `save(list)` сам сравнивает его с хранилищем и отдаёт провайдеру только изменённые/удалённые записи
   (`put`/`remove`), поэтому остальной код (форма, серии) списком по-прежнему оперирует целиком. Старые данные из localStorage
   `calendarEvents_v1` один раз переносятся в провайдер при первом открытии вкладки (`importLegacy`, флаг `calendarImported_v1`).
   Без провайдера (не должно случаться) работает прежний localStorage `calendarEvents_v1`.
   Серия (repeat != ""): `until` — мс, повторения с началом >= until не существуют (серию «разрезали»: дальше идёт другая
   серия); `skip` — массив дат "ГГГГ-ММ-ДД" повторений, которых в серии нет (их отвязали или удалили). Как в Google Календаре:
   правка/удаление повторения спрашивает «Только это» / «Это и все последующие» (`askScope`). «Только это» — повторение
   отвязывается: в серии на этот день пропуск (`skip`), а правка сохраняется отдельным обычным мероприятием. «Это и последующие»
   (`applyFollowing`) — старой серии ставится `until = начало этого повторения`, с него стартует новая серия с правками; правка
   самого первого повторения меняет серию на месте. Прошедшие повторения не трогаются. Если в форме изменено только поле
   «Повторения», вопрос не задаётся — это всегда «последующие». Пропуски переносятся в новую серию, только если дата начала и
   вид повтора не менялись.
   Список: каждая серия — ОДНА строка, ближайшее ещё не закончившееся повторение (`upcoming`, смотрит до 400 дней вперёд); у
   неё значок «↻ ещё N». Двойной тап по строке серии (тайминг как у переворота карточки в itemcards.js, DOUBLE_MS = 300) или тап
   по значку раскрывает до EXPAND_COUNT ближайших повторений (`expanded`); повторный двойной тап / значок / тап мимо строк
   сворачивает; выход из формы и повторный вход на вкладку тоже сворачивают. Одиночный тап по строке серии ждёт DOUBLE_MS, у
   обычных мероприятий форма открывается сразу. Тап открывает форму ИМЕННО того повторения (`data-at`), а не первого.
   Повторы считаются от первого начала: k-е повторение = start + k периодов; для месяца/года день прижимается к концу
   месяца (31-е → 30-е/28-е), как у напоминаний карточек. Длительность повторения = end − start.
   Список показывает окно: LIST_BACK_DAYS дней назад … LIST_AHEAD_DAYS вперёд от сегодня; при открытии прокручен к
   сегодняшнему дню (или к ближайшему следующему).
   =========================================================================== */
(function(){
  "use strict";

  var KEY = "calendarEvents_v1";
  var MODE_KEY = "calendarMode_v1";
  var LIST_BACK_DAYS = 7;
  var LIST_AHEAD_DAYS = 90;
  var HOUR_MS = 3600000;
  var DAY_MS = 86400000;
  var HOUR_DEFAULT = 44;    // высота часа в режиме «Неделя» по умолчанию
  var HOUR_MIN = 28, HOUR_MAX = 110; // пределы щипка
  var ZOOM_KEY = "calendarHourPx_v1";
  var PINCH_MIN_GAP = 30;   // щипок считается, только если пальцы разведены по вертикали хотя бы на столько px
  var MIN_BLOCK_PX = 14;    // минимальная высота блока события в неделе
  var SWIPE_DX = 70, SWIPE_DY = 50;
  var DOUBLE_MS = 300;      // как в itemcards.js (двойной тап по карточке)
  var EXPAND_COUNT = 12;    // сколько ближайших повторений показывает раскрытая серия
  var REPEATS = [
    { key: "day", label: "Каждый день" },
    { key: "week", label: "Каждую неделю" },
    { key: "month", label: "Каждый месяц" },
    { key: "year", label: "Каждый год" }
  ];
  var CALS = [{ key: "personal", label: "Личный календарь" }, { key: "shared", label: "Общий календарь" }];
  var WEEKDAYS_UP = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
  var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var MONTHS_SHORT = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];
  // значок кнопки режима: показывает, НА ЧТО переключит нажатие
  var WEEK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16"></path><path d="M9.3 10v10"></path><path d="M14.7 10v10"></path></svg>';
  var LIST_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 6h11"></path><path d="M9 12h11"></path><path d="M9 18h11"></path><path d="M4.5 6h.01"></path><path d="M4.5 12h.01"></path><path d="M4.5 18h.01"></path></svg>';
  var HOME_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 11.5L12 4l8 7.5"></path><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"></path><path d="M10 20v-5h4v5"></path>' +
    '</svg>';
  var PLUS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';

  var screen = "list"; // "list" | "week" | "form" — что сейчас нарисовано во вкладке
  var mode = "list";    // выбранный режим: "list" | "week" (хранится в MODE_KEY)
  var weekStart = null; // начало (понедельник 00:00) показанной недели; null — текущая
  var weekScrollKeep = null; // прокрутка недели, которую вернуть после формы
  var hourPx = HOUR_DEFAULT; // текущая высота часа в неделе
  var pinchEndedAt = 0;      // когда закончился щипок (тап сразу после него игнорируется)
  var expanded = {};   // id серий, раскрытых в списке
  var tapTimer = null; // отложенный одиночный тап по строке серии

  // ---------- вспомогательное ----------
  function container(){ return document.getElementById("settingsTabContent"); }
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function dateValue(ts){ var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function timeValue(ts){ var d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function dateLabel(ts){ var d = new Date(ts); return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear(); }
  // заголовок дня в списке: «ПН 26.10.2026»
  function dayLabel(ts){ return WEEKDAYS_UP[(new Date(ts).getDay() + 6) % 7] + " " + dateLabel(ts); }
  function calOf(ev){ return ev && ev.cal === "shared" ? "shared" : "personal"; }
  function parseLocal(dateStr, timeStr){
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || ""), tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr || "");
    if(!dm || !tm) return NaN;
    var d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
    return d.getTime();
  }
  function startOfDay(ts){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime(); }
  function newId(){ return "ev" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- хранение ----------
  var STORE = null;            // провайдер хранилища от my.js: {list, put, remove, importLocal, canEditShared}
  var IMPORTED_KEY = "calendarImported_v1";
  var lastSig = null;          // подпись списка при последней отрисовке/обновлении (refresh не перерисовывает без перемен)
  function validEvent(e){
    return e && typeof e === "object" && typeof e.id === "string" && typeof e.title === "string" &&
      typeof e.start === "number" && isFinite(e.start) && typeof e.end === "number" && isFinite(e.end);
  }
  function legacyLoad(){
    try{
      var a = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(a) ? a.filter(validEvent) : [];
    }catch(e){ return []; }
  }
  function legacySave(list){
    try{ localStorage.setItem(KEY, JSON.stringify(list)); }catch(e){}
  }
  // полный список мероприятий (копии: правка элементов на месте хранилище не меняет)
  function load(){
    if(!STORE) return legacyLoad();
    try{
      var a = STORE.list();
      return Array.isArray(a) ? a.filter(validEvent) : [];
    }catch(e){ return []; }
  }
  // Принимает полный список (как раньше), но провайдеру отдаёт только отличия от текущего содержимого хранилища:
  // новые и изменённые — put, пропавшие — remove; смена календаря (личный ↔ общий) — remove из старого и put в новый.
  function save(list){
    if(!STORE){ legacySave(list); return; }
    var prev = {};
    load().forEach(function(e){ prev[e.id] = e; });
    var seen = {};
    list.forEach(function(ev){
      seen[ev.id] = true;
      var p = prev[ev.id];
      if(p && JSON.stringify(p) === JSON.stringify(ev)) return;
      if(p && calOf(p) !== calOf(ev)) STORE.remove(p);
      STORE.put(ev);
    });
    Object.keys(prev).forEach(function(id){ if(!seen[id]) STORE.remove(prev[id]); });
  }
  // Общее мероприятие читателя группы только смотрит (как общие задачи): правка и удаление закрыты
  function canEdit(ev){
    if(!STORE || !STORE.canEditShared) return true;
    if(ev && calOf(ev) === "shared") return !!STORE.canEditShared();
    return true;
  }
  // Старые мероприятия из localStorage — в провайдер, один раз (без перезаписи уже существующих id)
  function importLegacy(){
    if(!STORE) return;
    try{ if(localStorage.getItem(IMPORTED_KEY)) return; }catch(e){ return; }
    var old = legacyLoad();
    if(old.length){
      var have = {};
      load().forEach(function(e){ have[e.id] = true; });
      old.forEach(function(ev){
        if(have[ev.id]) return;
        if(STORE.importLocal) STORE.importLocal(ev); else STORE.put(ev);
      });
    }
    try{ localStorage.setItem(IMPORTED_KEY, "1"); }catch(e){}
  }
  function findEvent(id){
    var list = load();
    for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
    return null;
  }

  // ---------- повторы ----------
  // k-е повторение: start + k периодов (от первого начала, а не от предыдущего — чтобы 31-е не «уползало» на 28-е навсегда)
  function addPeriod(ts, kind, k){
    var d = new Date(ts), h = d.getHours(), mi = d.getMinutes();
    if(kind === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, h, mi).getTime();
    if(kind === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * k, h, mi).getTime();
    var months = (kind === "year" ? 12 : 1) * k;
    var m = d.getMonth() + months;
    var ny = d.getFullYear() + Math.floor(m / 12), nm = ((m % 12) + 12) % 12;
    var dim = new Date(ny, nm + 1, 0).getDate();
    return new Date(ny, nm, Math.min(d.getDate(), dim), h, mi).getTime();
  }
  // все начала мероприятия в окне [from, to)
  function occurrenceStarts(ev, from, to){
    var out = [];
    if(!ev.repeat){
      if(ev.start >= from && ev.start < to) out.push(ev.start);
      return out;
    }
    var k0 = 0;
    if(from > ev.start){
      var span = from - ev.start;
      // нижняя граница k берётся по САМОМУ ДЛИННОМУ возможному периоду (месяц ≤ 31 дня, год ≤ 366): тогда она не перескочит нужные повторения
      var per = ev.repeat === "day" ? DAY_MS : (ev.repeat === "week" ? 7 * DAY_MS : (ev.repeat === "month" ? 31 * DAY_MS : 366 * DAY_MS));
      k0 = Math.max(0, Math.floor(span / per) - 1);
    }
    var skip = ev.skip && ev.skip.length ? ev.skip : null;
    for(var k = k0, guard = 0; guard < 4000; k++, guard++){
      var at = addPeriod(ev.start, ev.repeat, k);
      if(at >= to) break;
      if(ev.until && at >= ev.until) break;
      if(at >= from){
        if(skip && skip.indexOf(dateValue(at)) >= 0) continue; // повторение отвязано или удалено
        out.push(at);
      }
    }
    return out;
  }
  // ближайшие n повторений серии, которые ещё не закончились (идущее сейчас — тоже)
  function upcoming(ev, now, n){
    var dur = Math.max(0, ev.end - ev.start);
    var from = now - dur;
    return occurrenceStarts(ev, from, from + 400 * DAY_MS).slice(0, n);
  }
  function repeatLabel(key){
    for(var i = 0; i < REPEATS.length; i++) if(REPEATS[i].key === key) return REPEATS[i].label.toLowerCase();
    return "";
  }

  // ---------- экран «Список» ----------
  function timeRange(at, dur){
    var s = timeValue(at), end = at + dur;
    var txt = s + "–" + timeValue(end);
    if(dateValue(end) !== dateValue(at)) txt = s + "–" + dateLabel(end).slice(0, 5) + " " + timeValue(end);
    return txt;
  }
  function listHtml(){
    var now = Date.now();
    var from = startOfDay(now) - LIST_BACK_DAYS * DAY_MS;
    var to = startOfDay(now) + (LIST_AHEAD_DAYS + 1) * DAY_MS;
    var rows = [];
    load().forEach(function(ev){
      var dur = Math.max(0, ev.end - ev.start);
      if(!ev.repeat){
        if(ev.start >= from && ev.start < to) rows.push({ at: ev.start, dur: dur, ev: ev });
        return;
      }
      var list = upcoming(ev, now, EXPAND_COUNT);
      var open = !!expanded[ev.id];
      (open ? list : list.slice(0, 1)).forEach(function(at, i){
        rows.push({ at: at, dur: dur, ev: ev, series: true, first: i === 0, open: open, more: list.length - 1 });
      });
    });
    if(!rows.length) return '<div class="event-empty">Мероприятий пока нет. Нажмите «+», чтобы добавить.</div>';
    rows.sort(function(a, b){ return a.at - b.at; });
    var html = "", lastDay = "";
    rows.forEach(function(r){
      var day = dateValue(r.at);
      if(day !== lastDay){
        html += '<div class="event-day" data-day="' + day + '">' + dayLabel(r.at) + '</div>';
        lastDay = day;
      }
      var badge = "";
      if(r.series && r.more > 0){
        badge = ' <span class="cal-more">' + (r.open ? '↻ свернуть' : '↻ ещё ' + r.more) + '</span>';
      }
      html += '<div class="event-row cal-row cal-c-' + calOf(r.ev) + (r.at + r.dur < now ? ' cal-row-past' : '') + (r.series && !r.first ? ' cal-row-exp' : '') +
        '" data-id="' + esc(r.ev.id) + '" data-at="' + r.at + '">' +
        '<span class="event-time">' + timeRange(r.at, r.dur) + '</span> ' + esc(r.ev.title) +
        (r.ev.repeat ? '<span class="cal-rep"> · ' + repeatLabel(r.ev.repeat) + '</span>' : '') + badge + '</div>';
    });
    return html;
  }
  function scrollToToday(c){
    function go(){
      var today = dateValue(Date.now());
      var days = c.querySelectorAll(".event-day[data-day]");
      var target = null;
      for(var i = 0; i < days.length; i++){
        if(days[i].getAttribute("data-day") >= today){ target = days[i]; break; }
      }
      if(!target){ c.scrollTop = c.scrollHeight; return; }
      c.scrollTop += target.getBoundingClientRect().top - c.getBoundingClientRect().top - 4;
    }
    go();
    if(window.requestAnimationFrame) window.requestAnimationFrame(go);
    setTimeout(go, 60);
    setTimeout(go, 250);
  }
  // ---------- цвета календарей и отступы окна ----------
  // цвет текста на блоке недели: тёмный или светлый — по яркости цвета календаря (цвета зависят от темы)
  function fgFor(cssVar){
    var host = container() || document.body;
    var probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(" + cssVar + ");";
    host.appendChild(probe);
    var col = getComputedStyle(probe).color;
    host.removeChild(probe);
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(col || "");
    if(!m) return "var(--ink)";
    var lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
    return lum > 0.6 ? "var(--ink)" : "var(--parchment)";
  }
  function applyCalColors(el){
    if(!el || !el.style || !el.style.setProperty) return;
    el.style.setProperty("--cal-personal-fg", fgFor("--cal-personal"));
    el.style.setProperty("--cal-shared-fg", fgFor("--cal-shared"));
  }
  // В режиме «Неделя» у окна убираются боковые поля (класс cal-week-flush на .settings-modal-box, modals.css), чтобы сетка
  // влезала целиком. Класс снимается сам, как только во вкладке перестаёт быть .cal-week (другой экран или другая вкладка):
  // за этим следит MutationObserver на #settingsTabContent (без :has — он есть не везде).
  var flushObserver = null;
  function syncFlush(){
    var c = container();
    if(!c) return;
    var box = c.parentNode;
    if(!box || !box.classList) return;
    var has = !!(c.firstElementChild && c.firstElementChild.classList.contains("cal-week"));
    if(has) box.classList.add("cal-week-flush"); else box.classList.remove("cal-week-flush");
    if(!flushObserver && window.MutationObserver){
      flushObserver = new MutationObserver(syncFlush);
      flushObserver.observe(c, { childList: true });
    }
  }

  // ---------- нижний ряд и режимы ----------
  function clampHour(v){ return Math.max(HOUR_MIN, Math.min(HOUR_MAX, v)); }
  function loadMode(){
    try{
      mode = localStorage.getItem(MODE_KEY) === "week" ? "week" : "list";
      var z = parseFloat(localStorage.getItem(ZOOM_KEY));
      hourPx = isFinite(z) ? clampHour(z) : HOUR_DEFAULT;
    }catch(e){ mode = "list"; hourPx = HOUR_DEFAULT; }
  }
  function saveMode(){ try{ localStorage.setItem(MODE_KEY, mode); }catch(e){} }
  function fabRowHtml(){
    return '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarModeBtn" title="' + (mode === "week" ? "Режим: список" : "Режим: неделя") + '">' +
        (mode === "week" ? LIST_ICON_SVG : WEEK_ICON_SVG) + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarAddBtn" title="Новое мероприятие">' + PLUS_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarHomeStub" tabindex="-1" aria-disabled="true">' + HOME_ICON_SVG + '</button>' +
    '</div>';
  }
  function bindFab(){
    document.getElementById("calendarAddBtn").addEventListener("click", function(){ weekRememberScroll(); openForm(null); });
    document.getElementById("calendarModeBtn").addEventListener("click", function(){
      mode = mode === "week" ? "list" : "week";
      saveMode();
      weekStart = null; weekScrollKeep = null;
      renderMain();
    });
  }
  function renderMain(){ if(mode === "week") renderWeek(); else renderList(); }

  // ---------- экран «Неделя» ----------
  function mondayOf(ts){
    var d = new Date(ts);
    var back = (d.getDay() + 6) % 7; // пн = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 0, 0, 0, 0).getTime();
  }
  function dayStartAt(base, i){ var d = new Date(base); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 0, 0, 0, 0).getTime(); }
  function minutesOfDay(ts){ var d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
  function weekTitle(ws){
    var a = new Date(ws), b = new Date(dayStartAt(ws, 6));
    if(a.getFullYear() !== b.getFullYear())
      return a.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " " + a.getFullYear() + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
    if(a.getMonth() !== b.getMonth())
      return a.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
    return a.getDate() + "–" + b.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " " + b.getFullYear();
  }
  // куски событий недели по дням: [день 0..6] → [{top,bottom (минуты), ev, at, dur}]
  function weekSegments(ws){
    var days = [[], [], [], [], [], [], []];
    var weekEnd = dayStartAt(ws, 7);
    load().forEach(function(ev){
      var dur = Math.max(0, ev.end - ev.start);
      occurrenceStarts(ev, ws - dur, weekEnd).forEach(function(at){
        var end = at + dur;
        for(var i = 0; i < 7; i++){
          var ds = dayStartAt(ws, i), de = dayStartAt(ws, i + 1);
          if(end <= ds && !(dur === 0 && at === ds)) continue;
          if(at >= de) continue;
          var top = at > ds ? minutesOfDay(at) : 0;
          var bottom = end >= de ? 1440 : minutesOfDay(end);
          days[i].push({ top: top, bottom: Math.max(bottom, top + 1), ev: ev, at: at, dur: dur });
        }
      });
    });
    return days;
  }
  // раскладка пересекающихся блоков дня по колонкам: проставляет seg.col и seg.cols
  function packDay(segs){
    var minH = MIN_BLOCK_PX * 60 / hourPx; // минимальная высота блока в минутах — по ней считается пересечение
    segs.sort(function(a, b){ return a.top - b.top || b.bottom - a.bottom; });
    var cluster = [], colEnds = [], clusterEnd = -1;
    function flush(){
      for(var i = 0; i < cluster.length; i++) cluster[i].cols = colEnds.length;
      cluster = []; colEnds = []; clusterEnd = -1;
    }
    segs.forEach(function(sg){
      var bottom = Math.max(sg.bottom, sg.top + minH);
      if(cluster.length && sg.top >= clusterEnd) flush();
      var col = -1;
      for(var c = 0; c < colEnds.length; c++){ if(colEnds[c] <= sg.top){ col = c; break; } }
      if(col < 0){ col = colEnds.length; colEnds.push(0); }
      colEnds[col] = bottom;
      sg.col = col;
      cluster.push(sg);
      clusterEnd = Math.max(clusterEnd, bottom);
    });
    flush();
  }
  function weekHtml(ws){
    var now = Date.now(), todayKey = dateValue(now);
    var segsByDay = weekSegments(ws);
    var head = '<div class="cal-wk-head"><div class="cal-wk-gutter"></div>';
    var cols = '';
    for(var i = 0; i < 7; i++){
      var ds = dayStartAt(ws, i), isToday = dateValue(ds) === todayKey;
      head += '<div class="cal-wk-dayh' + (isToday ? ' cal-wk-today' : '') + '"><span>' + WEEKDAYS[i] + '</span><b>' + new Date(ds).getDate() + '</b></div>';
      var segs = segsByDay[i];
      packDay(segs);
      var blocks = '';
      segs.forEach(function(sg){
        var top = sg.top * hourPx / 60;
        var h = Math.max(MIN_BLOCK_PX, (sg.bottom - sg.top) * hourPx / 60 - 1);
        var w = 100 / sg.cols, left = sg.col * w;
        var tall = h >= 30;
        blocks += '<div class="cal-wk-ev cal-c-' + calOf(sg.ev) + (sg.at + sg.dur < now ? ' cal-wk-past' : '') + '" data-id="' + esc(sg.ev.id) + '" data-at="' + sg.at + '"' +
          ' data-t="' + sg.top + '" data-b="' + sg.bottom + '" style="top:' + top.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;left:' + left.toFixed(2) + '%;width:calc(' + w.toFixed(2) + '% - 1px)">' +
          (tall ? '<span class="cal-wk-et">' + timeValue(sg.at) + '</span>' : '') + esc(sg.ev.title) + '</div>';
      });
      var nowLine = isToday ? '<div class="cal-wk-now" data-m="' + minutesOfDay(now) + '" style="top:' + (minutesOfDay(now) * hourPx / 60).toFixed(1) + 'px"></div>' : '';
      cols += '<div class="cal-wk-col' + (isToday ? ' cal-wk-today-col' : '') + '" data-day="' + ds + '">' + blocks + nowLine + '</div>';
    }
    head += '</div>';
    var labels = '';
    for(var h2 = 1; h2 < 24; h2++) labels += '<span data-h="' + h2 + '" style="top:' + (h2 * hourPx - 6) + 'px">' + pad2(h2) + ':00</span>';
    return '<div class="cal-wk-top">' +
        '<div class="cal-wk-nav">' +
          '<button type="button" class="cal-wk-btn" id="calWkPrev" title="Предыдущая неделя">‹</button>' +
          '<div class="cal-wk-title">' + weekTitle(ws) + '</div>' +
          '<button type="button" class="cal-wk-btn" id="calWkNext" title="Следующая неделя">›</button>' +
          '<button type="button" class="cal-wk-btn cal-wk-todaybtn" id="calWkToday">Сегодня</button>' +
        '</div>' + head +
      '</div>' +
      '<div class="cal-wk-body" id="calWkBody" style="height:' + (24 * hourPx) + 'px">' +
        '<div class="cal-wk-gutter cal-wk-labels">' + labels + '</div>' +
        '<div class="cal-wk-cols" style="background-size:100% ' + hourPx + 'px">' + cols + '</div>' +
      '</div>';
  }
  // пересчитать геометрию недели под новую высоту часа без перерисовки (на время щипка)
  function applyZoom(px){
    hourPx = clampHour(px);
    var wk = document.getElementById("calWeek");
    if(!wk) return;
    var body = document.getElementById("calWkBody"), cols = wk.querySelector(".cal-wk-cols");
    if(body) body.style.height = (24 * hourPx) + "px";
    if(cols) cols.style.backgroundSize = "100% " + hourPx + "px";
    var i, list = wk.querySelectorAll(".cal-wk-labels span");
    for(i = 0; i < list.length; i++) list[i].style.top = (+list[i].getAttribute("data-h") * hourPx - 6) + "px";
    list = wk.querySelectorAll(".cal-wk-ev");
    for(i = 0; i < list.length; i++){
      var t = +list[i].getAttribute("data-t"), b = +list[i].getAttribute("data-b");
      list[i].style.top = (t * hourPx / 60).toFixed(1) + "px";
      list[i].style.height = Math.max(MIN_BLOCK_PX, (b - t) * hourPx / 60 - 1).toFixed(1) + "px";
    }
    list = wk.querySelectorAll(".cal-wk-now");
    for(i = 0; i < list.length; i++) list[i].style.top = (+list[i].getAttribute("data-m") * hourPx / 60).toFixed(1) + "px";
  }
  function weekRememberScroll(){
    var c = container();
    weekScrollKeep = (mode === "week" && c) ? c.scrollTop : null;
  }
  function renderWeek(){
    var c = container();
    if(!c) return;
    screen = "week";
    expanded = {};
    clearTimeout(tapTimer); tapTimer = null;
    var cur = mondayOf(Date.now());
    if(weekStart === null) weekStart = cur;
    var ws = weekStart;
    c.innerHTML = '<div class="cal-week" id="calWeek">' + weekHtml(ws) + '</div>' + fabRowHtml();
    bindFab();
    syncFlush();
    applyCalColors(document.getElementById("calWeek"));
    function shift(n){ weekStart = dayStartAt(ws, 7 * n); weekScrollKeep = c.scrollTop; renderWeek(); }
    document.getElementById("calWkPrev").addEventListener("click", function(){ shift(-1); });
    document.getElementById("calWkNext").addEventListener("click", function(){ shift(1); });
    document.getElementById("calWkToday").addEventListener("click", function(){ weekStart = null; weekScrollKeep = null; renderWeek(); });
    var wk = document.getElementById("calWeek");
    wk.addEventListener("click", function(e){
      if(Date.now() - pinchEndedAt < 350) return; // тап, оставшийся от щипка
      var blk = e.target.closest ? e.target.closest(".cal-wk-ev") : null;
      if(blk){
        var ev = findEvent(blk.getAttribute("data-id"));
        if(!ev) return;
        weekRememberScroll();
        openForm(ev, +blk.getAttribute("data-at"));
        return;
      }
      var col = e.target.closest ? e.target.closest(".cal-wk-col") : null;
      if(!col) return;
      // пустое место сетки: новое мероприятие на этот день, начало — начало нажатого часа
      var hour = Math.max(0, Math.min(23, Math.floor((e.clientY - col.getBoundingClientRect().top) / hourPx)));
      var d = new Date(+col.getAttribute("data-day"));
      weekRememberScroll();
      openForm(null, null, new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0).getTime());
    });
    // жесты: один палец — свайп недели; два пальца по вертикали — щипок (размер сетки)
    var sx = 0, sy = 0, tracking = false;
    var pinch = null; // {gap0, px0, anchor (минуты под серединой пальцев)}
    function gapOf(t){ return Math.abs(t[0].clientY - t[1].clientY); }
    function midOf(t){ return (t[0].clientY + t[1].clientY) / 2; }
    wk.addEventListener("touchstart", function(e){
      if(e.touches && e.touches.length === 2){
        tracking = false;
        var g = gapOf(e.touches);
        var body = document.getElementById("calWkBody");
        if(g >= PINCH_MIN_GAP && body){
          pinch = { gap0: g, px0: hourPx, anchor: (midOf(e.touches) - body.getBoundingClientRect().top) / hourPx };
        } else pinch = null;
        return;
      }
      if(!e.touches || e.touches.length !== 1){ tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    wk.addEventListener("touchmove", function(e){
      if(!pinch || !e.touches || e.touches.length !== 2) return;
      if(e.cancelable) e.preventDefault(); // не даём странице прокручиваться/масштабироваться самой
      var g = Math.max(gapOf(e.touches), 1);
      applyZoom(pinch.px0 * g / pinch.gap0);
      var body = document.getElementById("calWkBody");
      if(body){ // точка под серединой пальцев остаётся на месте
        c.scrollTop += body.getBoundingClientRect().top + pinch.anchor * hourPx - midOf(e.touches);
      }
    }, { passive: false });
    wk.addEventListener("touchend", function(e){
      if(pinch){
        if(!e.touches || e.touches.length < 2){
          pinch = null; tracking = false;
          pinchEndedAt = Date.now();
          try{ localStorage.setItem(ZOOM_KEY, String(hourPx)); }catch(err){}
          weekScrollKeep = c.scrollTop;
          renderWeek(); // перерисовка: пересчёт раскладки пересекающихся блоков под новую высоту
        }
        return;
      }
      if(!tracking || !e.changedTouches || !e.changedTouches.length) return;
      tracking = false;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if(Math.abs(dx) > SWIPE_DX && Math.abs(dy) < SWIPE_DY) shift(dx < 0 ? 1 : -1);
    }, { passive: true });
    scrollWeek(c, ws === cur);
  }
  function scrollWeek(c, isCurrent){
    var keep = weekScrollKeep;
    weekScrollKeep = null;
    function go(){
      if(keep !== null){ c.scrollTop = keep; return; }
      var body = document.getElementById("calWkBody"), top = c.querySelector(".cal-wk-top");
      if(!body) return;
      var hour = isCurrent ? Math.max(0, new Date().getHours() - 2) : 7;
      var headH = top ? top.getBoundingClientRect().height : 0;
      c.scrollTop += body.getBoundingClientRect().top - c.getBoundingClientRect().top - headH + hour * hourPx;
    }
    go();
    if(window.requestAnimationFrame) window.requestAnimationFrame(go);
    setTimeout(go, 60);
    setTimeout(go, 250);
  }

  // перерисовать только список (раскрытие/сворачивание серий), не трогая прокрутку
  function refreshList(){
    var c = container(), list = document.getElementById("calendarList");
    if(!c || !list) return;
    var top = c.scrollTop;
    list.innerHTML = listHtml();
    c.scrollTop = top;
  }
  function toggleExpand(id){
    if(expanded[id]) delete expanded[id]; else expanded[id] = true;
    refreshList();
  }
  function anyExpanded(){
    for(var k in expanded){ if(expanded.hasOwnProperty(k)) return true; }
    return false;
  }
  function renderList(){
    var c = container();
    if(!c) return;
    screen = "list";
    expanded = {};
    clearTimeout(tapTimer); tapTimer = null;
    c.innerHTML =
      '<div class="event-center cal-center" id="calendarList">' + listHtml() + '</div>' +
      fabRowHtml();
    bindFab();
    syncFlush();
    var lastKey = null, lastAt = 0;
    document.getElementById("calendarList").addEventListener("click", function(e){
      var row = e.target.closest ? e.target.closest(".cal-row") : null;
      if(!row){
        if(anyExpanded()){ expanded = {}; refreshList(); } // тап мимо строк сворачивает раскрытые серии
        return;
      }
      var id = row.getAttribute("data-id"), at = +row.getAttribute("data-at");
      var ev = findEvent(id);
      if(!ev) return;
      if(!ev.repeat){ openForm(ev, at); return; }
      if(e.target.closest(".cal-more")){ lastKey = null; clearTimeout(tapTimer); toggleExpand(id); return; }
      var key = id + ":" + at, now = Date.now();
      if(lastKey === key && now - lastAt < DOUBLE_MS){ // двойной тап: раскрыть/свернуть серию
        clearTimeout(tapTimer); lastKey = null;
        toggleExpand(id);
        return;
      }
      lastKey = key; lastAt = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function(){ lastKey = null; openForm(ev, at); }, DOUBLE_MS);
    });
    scrollToToday(c);
  }

  // ---------- сохранение и удаление повторений ----------
  function replaceInList(list, rec){
    for(var i = 0; i < list.length; i++) if(list[i].id === rec.id){ list[i] = rec; return true; }
    return false;
  }
  // «Только это»: повторение отвязывается — в серии на этот день пропуск, правка живёт отдельным обычным мероприятием
  function skipOccurrence(list, ev, at){
    var key = dateValue(at);
    for(var i = 0; i < list.length; i++){
      if(list[i].id !== ev.id) continue;
      var sk = (list[i].skip || []).slice();
      if(sk.indexOf(key) < 0) sk.push(key);
      list[i].skip = sk;
      list[i].updatedAt = Date.now();
    }
  }
  function applyOnlyThis(ev, at, title, s, e, cal){
    var list = load();
    skipOccurrence(list, ev, at);
    list.push({ id: newId(), title: title, start: s, end: e, repeat: "", cal: cal, updatedAt: Date.now() });
    save(list);
  }
  // «Это и последующие»: первое повторение — серия правится на месте; иначе старая серия обрывается (until), с этого повторения стартует новая
  function applyFollowing(ev, at, title, s, e, r, cal){
    var list = load(), now = Date.now();
    var atKey = dateValue(at);
    var same = dateValue(s) === atKey && r === (ev.repeat || "");
    var skip = same ? (ev.skip || []).filter(function(k){ return k >= atKey; }) : [];
    function make(id){
      var rec = { id: id, title: title, start: s, end: e, repeat: r, cal: cal, updatedAt: now };
      if(r){
        if(ev.until && ev.until > s) rec.until = ev.until;
        if(skip.length) rec.skip = skip;
      }
      return rec;
    }
    if(at === ev.start){
      replaceInList(list, make(ev.id));
    } else {
      for(var i = 0; i < list.length; i++){
        if(list[i].id === ev.id){
          list[i].until = list[i].until ? Math.min(list[i].until, at) : at;
          list[i].updatedAt = now;
        }
      }
      list.push(make(newId()));
    }
    save(list);
  }
  function deleteOccurrence(ev, at, following){
    var list = load();
    if(following && at === ev.start){
      list = list.filter(function(x){ return x.id !== ev.id; });
    } else if(following){
      for(var i = 0; i < list.length; i++){
        if(list[i].id === ev.id){
          list[i].until = list[i].until ? Math.min(list[i].until, at) : at;
          list[i].updatedAt = Date.now();
        }
      }
    } else {
      skipOccurrence(list, ev, at);
    }
    save(list);
  }

  // ---------- форма ----------
  // ev — мероприятие (null — новое); at — начало того повторения, по которому нажали (у серии форма показывает его, а не первое начало);
  // preset — для нового мероприятия: начало (мс), которое подставляется в форму (тап по пустому месту недели), окончание = начало + 1 час
  function openForm(ev, at, preset){
    var c = container();
    if(!c) return;
    clearTimeout(tapTimer); tapTimer = null;
    screen = "form";
    var isNew = !ev;
    var baseS = ev ? (ev.repeat && isFinite(at) ? at : ev.start) : 0;
    var baseE = ev ? baseS + Math.max(0, ev.end - ev.start) : 0;
    var html = '<div class="mdeditor-tab item-card-form" id="calendarForm">' +
      '<h3 class="common-tab-title">' + (isNew ? "Новое мероприятие" : "Мероприятие") + '</h3>' +
      '<input type="text" class="mdeditor-cleanup-input item-form-title" id="calTitle" placeholder="Название мероприятия" maxlength="120" autocomplete="off">' +
      '<div class="cal-field"><div class="item-form-hint">Начало</div><div class="cal-dt">' +
        '<input type="date" class="mdeditor-cleanup-input" id="calStartDate" aria-label="Дата начала">' +
        '<input type="time" class="mdeditor-cleanup-input" id="calStartTime" aria-label="Время начала">' +
      '</div></div>' +
      '<div class="cal-field"><div class="item-form-hint">Окончание</div><div class="cal-dt">' +
        '<input type="date" class="mdeditor-cleanup-input" id="calEndDate" aria-label="Дата окончания">' +
        '<input type="time" class="mdeditor-cleanup-input" id="calEndTime" aria-label="Время окончания">' +
      '</div></div>' +
      '<div class="cal-field"><div class="item-form-hint">Повторения</div>' +
        '<select class="mdeditor-cleanup-input" id="calRepeat"><option value="">Не повторять</option>' +
        REPEATS.map(function(r){ return '<option value="' + r.key + '">' + r.label + '</option>'; }).join("") +
        '</select></div>' +
      '<div class="cal-field"><div class="item-form-hint">Календарь</div>' +
        '<select class="mdeditor-cleanup-input" id="calCal">' +
        CALS.map(function(k){ return '<option value="' + k.key + '">' + k.label + '</option>'; }).join("") +
        '</select></div>' +
      '<div class="item-form-error" id="calError"></div>' +
      '<div class="cal-scope" id="calScope" style="display:none"></div>' +
      '<div class="item-form-buttons" id="calBtns">' +
        '<button type="button" class="workbooks-run-btn" id="calSave">Сохранить</button>' +
        '<button type="button" class="workbooks-run-btn" id="calCancel">Отмена</button>' +
      '</div>' +
      (isNew ? '' : '<div class="item-form-buttons" id="calDelRow"><button type="button" class="workbooks-run-btn" id="calDelete">Удалить</button></div>') +
    '</div>';
    c.innerHTML = html;
    syncFlush();
    c.scrollTop = 0;

    var titleEl = document.getElementById("calTitle");
    var sd = document.getElementById("calStartDate"), st = document.getElementById("calStartTime");
    var ed = document.getElementById("calEndDate"), et = document.getElementById("calEndTime");
    var repEl = document.getElementById("calRepeat"), calEl = document.getElementById("calCal"), errEl = document.getElementById("calError");
    if(ev){
      titleEl.value = ev.title;
      sd.value = dateValue(baseS); st.value = timeValue(baseS);
      ed.value = dateValue(baseE); et.value = timeValue(baseE);
      repEl.value = ev.repeat || "";
      calEl.value = calOf(ev);
    } else if(preset){
      sd.value = dateValue(preset); st.value = timeValue(preset);
      ed.value = dateValue(preset + HOUR_MS); et.value = timeValue(preset + HOUR_MS);
    }

    // Общий календарь у читателя группы — только просмотр (как общие задачи): новое общее не создать, существующее не правится
    var readOnly = !!ev && !canEdit(ev);
    if(!readOnly && !canEdit({ cal: "shared" }) && !(ev && calOf(ev) === "shared")){
      for(var oi = calEl.options.length - 1; oi >= 0; oi--) if(calEl.options[oi].value === "shared") calEl.remove(oi);
    }
    if(readOnly){
      [titleEl, sd, st, ed, et, repEl, calEl].forEach(function(el){ el.disabled = true; });
      var svBtn = document.getElementById("calSave"), delRow = document.getElementById("calDelRow"), cnBtn = document.getElementById("calCancel");
      if(svBtn) svBtn.style.display = "none";
      if(delRow) delRow.style.display = "none";
      if(cnBtn) cnBtn.textContent = "Назад";
      errEl.textContent = "Общий календарь: у вас доступ только для чтения.";
    }

    // окончание = начало + 1 час, пока пользователь сам не правил окончание (у существующего мероприятия — не трогаем)
    var endTouched = !isNew;
    function onStart(){
      if(endTouched) return;
      var s = parseLocal(sd.value, st.value);
      if(isNaN(s)) return;
      var e = s + HOUR_MS;
      ed.value = dateValue(e);
      et.value = timeValue(e);
    }
    function onEnd(){ endTouched = true; }
    ["change", "input"].forEach(function(t){
      sd.addEventListener(t, onStart); st.addEventListener(t, onStart);
      ed.addEventListener(t, onEnd); et.addEventListener(t, onEnd);
    });

    function leave(){ renderMain(); }
    document.getElementById("calCancel").addEventListener("click", leave);
    if(window.AppNav) window.AppNav.push(function(){ if(screen === "form") renderMain(); });

    function fail(msg){ errEl.textContent = msg; }
    var scopeEl = document.getElementById("calScope"), btnsEl = document.getElementById("calBtns"), delRowEl = document.getElementById("calDelRow");
    // вопрос «только это / это и последующие» вместо кнопок формы
    function askScope(text, onOnly, onFollowing){
      errEl.textContent = "";
      scopeEl.innerHTML = '<div class="item-form-hint">' + esc(text) + '</div>' +
        '<button type="button" class="workbooks-run-btn" id="calScopeOnly">Только это</button>' +
        '<button type="button" class="workbooks-run-btn" id="calScopeFollow">Это и все последующие</button>' +
        '<button type="button" class="workbooks-run-btn" id="calScopeBack">Назад</button>';
      scopeEl.style.display = "flex";
      btnsEl.style.display = "none";
      if(delRowEl) delRowEl.style.display = "none";
      document.getElementById("calScopeOnly").addEventListener("click", onOnly);
      document.getElementById("calScopeFollow").addEventListener("click", onFollowing);
      document.getElementById("calScopeBack").addEventListener("click", function(){
        scopeEl.style.display = "none"; scopeEl.innerHTML = "";
        btnsEl.style.display = "";
        if(delRowEl) delRowEl.style.display = "";
      });
    }

    document.getElementById("calSave").addEventListener("click", function(){
      var title = titleEl.value.replace(/^\s+|\s+$/g, "");
      if(!title) return fail("Введите название мероприятия");
      var s = parseLocal(sd.value, st.value);
      if(isNaN(s)) return fail("Укажите дату и время начала");
      var e;
      if(!ed.value && !et.value) e = s + HOUR_MS;
      else {
        e = parseLocal(ed.value, et.value);
        if(isNaN(e)) return fail("Укажите дату и время окончания");
      }
      if(e <= s) return fail("Окончание должно быть позже начала");
      var r = repEl.value || "";
      var calv = calEl.value === "shared" ? "shared" : "personal";

      if(ev && ev.repeat){ // правка повторения серии
        if(title === ev.title && s === baseS && e === baseE && r === ev.repeat && calv === calOf(ev)) return renderMain(); // ничего не менялось
        var following = function(){ applyFollowing(ev, baseS, title, s, e, r, calv); renderMain(); }; // не function-объявление в блоке: старый WebView (Android 5)
        if(r !== ev.repeat) return following(); // менялся вид повтора — это всегда «последующие», вопрос не нужен
        return askScope("Это повторяющееся мероприятие. Сохранить изменения:",
          function(){ applyOnlyThis(ev, baseS, title, s, e, calv); renderMain(); },
          following);
      }

      var list = load();
      var rec = { id: ev ? ev.id : newId(), title: title, start: s, end: e, repeat: r, cal: calv, updatedAt: Date.now() };
      if(!replaceInList(list, rec)) list.push(rec);
      save(list);
      renderMain();
    });

    var delBtn = document.getElementById("calDelete");
    if(delBtn){
      var armed = false, armTimer = null;
      delBtn.addEventListener("click", function(){
        if(ev.repeat){ // серия: вопрос вместо двойного нажатия
          return askScope("Это повторяющееся мероприятие. Удалить:",
            function(){ deleteOccurrence(ev, baseS, false); renderMain(); },
            function(){ deleteOccurrence(ev, baseS, true); renderMain(); });
        }
        if(!armed){
          armed = true;
          delBtn.textContent = "Точно удалить?";
          armTimer = setTimeout(function(){ armed = false; delBtn.textContent = "Удалить"; }, 3000);
          return;
        }
        clearTimeout(armTimer);
        save(load().filter(function(x){ return x.id !== ev.id; }));
        renderMain();
      });
    }
  }

  window.CalendarTab = {
    // my.js отдаёт хранилище (см. шапку); зовётся до первого render
    setStore: function(store){ STORE = store || null; },
    render: function(){ importLegacy(); loadMode(); weekStart = null; weekScrollKeep = null; lastSig = JSON.stringify(load()); renderMain(); },
    // данные могли измениться снаружи (пришли чужие правки группы): перерисовать текущий экран, если список изменился.
    // Открытую форму не трогаем; прокрутка сохраняется. my.js зовёт только когда вкладка «Календарь» на экране.
    refresh: function(){
      if(screen === "form") return;
      var sig = JSON.stringify(load());
      if(sig === lastSig) return;
      lastSig = sig;
      var c = container(), top = c ? c.scrollTop : 0;
      if(mode === "week") weekScrollKeep = top;
      renderMain();
      if(c && mode !== "week") c.scrollTop = top;
    },
    // для проверки/других модулей: мероприятия на отрезке [from, to) — [{id,title,at,dur,repeat}]
    occurrences: function(from, to){
      var out = [];
      load().forEach(function(ev){
        occurrenceStarts(ev, from, to).forEach(function(at){
          out.push({ id: ev.id, title: ev.title, at: at, dur: Math.max(0, ev.end - ev.start), repeat: ev.repeat || "" });
        });
      });
      out.sort(function(a, b){ return a.at - b.at; });
      return out;
    }
  };
})();
