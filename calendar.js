/* ===========================================================================
   calendar.js
   Версия: 12.1 (31.10)
   Версия: 8.0 (27.10) — «Неделя»: (1) листание недели как в Google Календаре — соседняя неделя едет следом за пальцем (`slideStart/slideTo/slideFinish` в `renderWeek`), отпустили — доезжает или возвращается; кнопки ‹ › листают так же; неделя по-прежнему Пн–Вс; (2) при открытии вкладки неделя всегда с 7:00 (красная линия может быть за экраном), к красной линии (на 2 часа раньше) — только по кнопке «Сегодня» (`weekScrollToNow`). Откат: calendar.js 7.0.
   Версия: 7.0 (25.10)
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
   Цвета календарей: кнопка «Цвета» (`calendarColorBtn`, нижний ряд, после «Трекеров») открывает экран `openColors` в стиле формы
   комбинированных карточек (палитра 2×8, пустой квадрат — цвет по умолчанию): личный календарь, общий календарь, трекеры занятий.
   Выбор хранится на устройстве (`calendarColors_v1` = {personal, shared, trk, hid, past} — "#rrggbb" или ""), `applyUserColors` кладёт его в
   `--cal-personal` / `--cal-shared` / `--cal-trk` / `--cal-hid` / `--cal-past` на `<html>` (пусто — убирает, действует цвет по умолчанию из components.css).
   Цвет прошедших мероприятий (`past`): пока не выбран, прошедшие остаются цвета своего календаря; выбран — класс `cal-has-past-color` на `<html>`
   и прошедшие блоки недели/строки списка (`.cal-wk-past`/`.cal-row-past`) рисуются этим цветом, в том числе скрытые.
   Скрытые мероприятия: поле «Отображение» в форме («Показать»/«Скрыть»); признак хранится ТОЛЬКО на устройстве (`calendarHiddenIds_v1` = {id:1}),
   в запись мероприятия и в облако не уходит — скрытие общего мероприятия действует лишь у того, кто его скрыл. Кнопка-глаз `calendarHiddenBtn`
   (нижний ряд, после «Трекеров», не заливается — состояние показывает значок): глаз открыт — скрытые видны (`calendarShowHidden_v1` = "1"),
   перечёркнут — не показываются ни в списке, ни в неделе (`isHidden`, `setHidden`, `showHidden`). Скрывается серия целиком.
   Настройки календаря: кнопка-шестерёнка `calendarSettingsBtn` (нижний ряд, после «Цветов») открывает экран `openSettings`. Галочка
   «Видимые мероприятия всегда перекрывают скрытые» (`calendarVisOverHidden_v1`, `visOverHidden`): в неделе `weekHtml` раскладывает
   скрытые и видимые (вместе с трекерами) по колонкам раздельно (`packDay` дважды) и рисует видимые после скрытых — поверх.
   Мероприятие: {id, title, start, end, repeat, cal, updatedAt[, until, skip]}; cal — календарь: "personal" (по умолчанию, и если поля нет) | "shared"
   (поле «Календарь» в форме; в НОВОМ мероприятии стоит календарь последнего сохранённого — `calendarLastCal_v1`, `lastCal`/`rememberCal`, на устройстве; пока различие только в цвете: личный — как «Радость» в диаграмме настроений (--mood-joy), общий — цвет
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
  var LAST_CAL_KEY = "calendarLastCal_v1"; // календарь последнего сохранённого мероприятия ("personal" | "shared"), подставляется в новое
  var LIST_BACK_DAYS = 7;
  var LIST_AHEAD_DAYS = 90;
  var HOUR_MS = 3600000;
  var DAY_MS = 86400000;
  var HOUR_DEFAULT = 44;    // высота часа в режиме «Неделя» по умолчанию
  var HOUR_MIN = 28, HOUR_MAX = 110; // пределы щипка
  var WEEK_OPEN_HOUR = 8;   // с какого часа неделя показана при открытии вкладки
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
  var TRK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"></path></svg>';
  var TRK_OFF_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"></path><path d="M4 4l16 16"></path></svg>';
  var COLOR_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.7 1.9-1.7H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.7 3.5 12 3.5z"></path>' +
      '<circle cx="7.8" cy="11.5" r="1" fill="currentColor" stroke="none"></circle><circle cx="10.6" cy="7.6" r="1" fill="currentColor" stroke="none"></circle><circle cx="15.2" cy="7.8" r="1" fill="currentColor" stroke="none"></circle></svg>';
  var PLUS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';

  var screen = "list"; // "list" | "week" | "form" — что сейчас нарисовано во вкладке
  var mode = "list";    // выбранный режим: "list" | "week" (хранится в MODE_KEY)
  var weekStart = null; // начало (понедельник 00:00) показанной недели; null — текущая
  var weekScrollKeep = null; // прокрутка недели, которую вернуть после формы
  var weekScrollToNow = false; // кнопка «Сегодня»: один раз прокрутить к красной линии (иначе неделя всегда открывается с 8:00)
  var WEEK_SLIDE_MS = 260;   // длительность доезжания недели при перелистывании
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
  // Календарь, в котором сохраняли мероприятие в прошлый раз, — по умолчанию в форме нового (хранится на устройстве)
  function lastCal(){
    try{ return localStorage.getItem(LAST_CAL_KEY) === "shared" ? "shared" : "personal"; }catch(e){ return "personal"; }
  }
  function rememberCal(v){ try{ localStorage.setItem(LAST_CAL_KEY, v === "shared" ? "shared" : "personal"); }catch(e){} }
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
  // ---------- «Трекеры занятий»: точное время того, что я делал (сейчас — записи тренировок; позже музыка, чтение и т. п.) ----------
  // Отдельный слой поверх запланированных мероприятий; кнопка в нижнем ряду показывает/скрывает его (TRK_KEY, на устройстве).
  // Новый трекер = ещё один элемент TRACKER_SOURCES: get() отдаёт [{start, end, sub}] (мс), label — название занятия.
  var TRK_KEY = "calendarTrackers_v1";
  var trackersOn = false;
  var TRACKER_SOURCES = [
    { key: "workout", label: "Тренировка", get: function(){
      var W = window.WorkoutsTab;
      var list = (W && W.records) ? W.records() : [];
      return list.map(function(r){
        var sub = [];
        if(r.totalMs > 0){ var mins = Math.round(r.totalMs / 60000); sub.push(mins >= 60 ? Math.floor(mins / 60) + " ч " + pad2(mins % 60) + " мин" : mins + " мин"); }
        if(r.m > 0) sub.push((Math.round(r.m / 10) / 100).toFixed(2).replace(".", ",") + " км");
        return { start: r.start, end: r.end, dur: r.totalMs, sub: sub.join(" · ") };
      });
    } }
  ];
  function loadTrackersOn(){ try{ trackersOn = localStorage.getItem(TRK_KEY) === "1"; }catch(e){ trackersOn = false; } }
  function saveTrackersOn(){ try{ localStorage.setItem(TRK_KEY, trackersOn ? "1" : "0"); }catch(e){} }
  // ---------- цвета календарей (личный, общий, трекеры занятий): выбор пользователя, на устройстве ----------
  var COLORS_KEY = "calendarColors_v1";
  // ---------- скрытые мероприятия: только на этом устройстве ----------
  var HIDDEN_KEY = "calendarHiddenIds_v1";
  var SHOW_HIDDEN_KEY = "calendarShowHidden_v1";
  var hiddenIds = null;
  function loadHidden(){
    if(hiddenIds) return hiddenIds;
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "null"); }catch(e){ o = null; }
    hiddenIds = (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    return hiddenIds;
  }
  function isHidden(id){ return !!loadHidden()[id]; }
  function setHidden(id, on){
    var h = loadHidden();
    if(on) h[id] = 1; else delete h[id];
    try{ localStorage.setItem(HIDDEN_KEY, JSON.stringify(h)); }catch(e){}
  }
  function showHidden(){ try{ return localStorage.getItem(SHOW_HIDDEN_KEY) === "1"; }catch(e){ return false; } }
  function saveShowHidden(v){ try{ localStorage.setItem(SHOW_HIDDEN_KEY, v ? "1" : "0"); }catch(e){} }
  // видно ли мероприятие в списке/неделе
  function visibleEv(ev){ return showHidden() || !isHidden(ev.id); }
  var EYE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  var EYE_OFF_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle><path d="M4 4l16 16"></path></svg>';
  // ---------- настройки календаря (кнопка-шестерёнка `calendarSettingsBtn`): на устройстве ----------
  var VIS_OVER_KEY = "calendarVisOverHidden_v1";
  function visOverHidden(){ try{ return localStorage.getItem(VIS_OVER_KEY) === "1"; }catch(e){ return false; } }
  function saveVisOverHidden(v){ try{ localStorage.setItem(VIS_OVER_KEY, v ? "1" : "0"); }catch(e){} }
  var GEAR_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="3"></circle>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
  function eyeTitle(){ return showHidden() ? 'Скрытые мероприятия показаны (нажмите, чтобы скрыть)' : 'Скрытые мероприятия не показаны (нажмите, чтобы показать)'; }
  var COLOR_ITEMS = [
    { key: "personal", label: "Личный календарь", cssVar: "--cal-personal" },
    { key: "shared",   label: "Общий календарь",  cssVar: "--cal-shared" },
    { key: "trk",      label: "Трекеры занятий",  cssVar: "--cal-trk" },
    { key: "hid",      label: "Скрытые мероприятия", cssVar: "--cal-hid" },
    { key: "past",     label: "Прошедшие мероприятия", cssVar: "--cal-past" }
  ];
  // та же палитра, что в форме комбинированных карточек (itemcards.js HABIT_COLORS_*): первый пастельный квадрат — «по умолчанию»
  var COLORS_BRIGHT = ["#ff0000", "#fb8c00", "#ffff00", "#43a047", "#00acc1", "#1e88e5", "#7f00ff", "#d81b60"];
  var COLORS_PASTEL = ["", "#ffcba4", "#fff3a3", "#9cdb4e", "#40d5b5", "#a9ccf4", "#d4b8f0", "#f8bbd9"];
  var userColors = { personal: "", shared: "", trk: "", hid: "", past: "" };
  function loadColors(){
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(COLORS_KEY) || "null"); }catch(e){ o = null; }
    COLOR_ITEMS.forEach(function(it){
      var v = o && typeof o[it.key] === "string" ? o[it.key] : "";
      userColors[it.key] = /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "";
    });
  }
  function saveColors(){ try{ localStorage.setItem(COLORS_KEY, JSON.stringify(userColors)); }catch(e){} }
  function applyUserColors(){
    var root = document.documentElement;
    if(!root || !root.style) return;
    COLOR_ITEMS.forEach(function(it){
      var v = userColors[it.key];
      if(v) root.style.setProperty(it.cssVar, v); else root.style.removeProperty(it.cssVar);
    });
    // цвет прошедших включается только классом: пока пользователь его не выбрал, мероприятия остаются цвета своего календаря
    if(root.classList){ if(userColors.past) root.classList.add("cal-has-past-color"); else root.classList.remove("cal-has-past-color"); }
  }
  // трекеры, пересекающие отрезок [from, to): [{src, label, start, end, sub}]; запись без конца — по длительности, иначе минутная
  function trackerItems(from, to){
    var out = [];
    TRACKER_SOURCES.forEach(function(src){
      var list = [];
      try{ list = src.get() || []; }catch(e){ list = []; }
      list.forEach(function(r){
        if(!r || typeof r.start !== "number" || !isFinite(r.start)) return;
        var end = r.end > r.start ? r.end : r.start + Math.max(60000, r.dur || 0);
        if(r.start >= to || end <= from) return;
        out.push({ src: src.key, label: src.label, start: r.start, end: end, sub: r.sub || "" });
      });
    });
    return out;
  }
  function trackerText(t){ return t.label + " · " + timeRange(t.start, t.end - t.start) + (t.sub ? " · " + t.sub : ""); }
  // куски трекеров недели по дням (как weekSegments): [день 0..6] → [{top, bottom, t}]
  function weekTrackerSegments(ws){
    var days = [[], [], [], [], [], [], []];
    trackerItems(ws, dayStartAt(ws, 7)).forEach(function(t){
      for(var i = 0; i < 7; i++){
        var ds = dayStartAt(ws, i), de = dayStartAt(ws, i + 1);
        if(t.end <= ds || t.start >= de) continue;
        var top = t.start > ds ? minutesOfDay(t.start) : 0;
        var bottom = t.end >= de ? 1440 : minutesOfDay(t.end);
        days[i].push({ top: top, bottom: Math.max(bottom, top + 1), t: t });
      }
    });
    return days;
  }
  var trkToastTimer = null;
  function trackerToast(text){
    var old = document.getElementById("calTrkToast");
    if(old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement("div");
    el.id = "calTrkToast";
    el.className = "cal-trk-toast";
    el.textContent = text;
    document.body.appendChild(el);
    clearTimeout(trkToastTimer);
    trkToastTimer = setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 4000);
  }

  var weekRenderedAt = 0;      // когда нарисована неделя: от этого дня считается красная линия «сейчас»
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
      if(!visibleEv(ev)) return;
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
    if(trackersOn) trackerItems(from, to).forEach(function(t){
      rows.push({ at: t.start, dur: t.end - t.start, trk: t });
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
      if(r.trk){
        html += '<div class="event-row cal-trk-row"><span class="event-time">' + timeRange(r.at, r.dur) + '</span> ' + esc(r.trk.label) + (r.trk.sub ? '<span class="cal-rep"> · ' + esc(r.trk.sub) + '</span>' : '') + '</div>';
        return;
      }
      var badge = "";
      if(r.series && r.more > 0){
        badge = ' <span class="cal-more">' + (r.open ? '↻ свернуть' : '↻ ещё ' + r.more) + '</span>';
      }
      html += '<div class="event-row cal-row cal-c-' + calOf(r.ev) + (isHidden(r.ev.id) ? ' cal-hid' : '') + (r.at + r.dur < now ? ' cal-row-past' : '') + (r.series && !r.first ? ' cal-row-exp' : '') +
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
    el.style.setProperty("--cal-trk-fg", fgFor("--cal-trk"));
    el.style.setProperty("--cal-hid-fg", fgFor("--cal-hid"));
    if(userColors.past) el.style.setProperty("--cal-past-fg", fgFor("--cal-past")); else el.style.removeProperty("--cal-past-fg");
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
    loadTrackersOn();
    loadColors();
    applyUserColors();
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
      '<button type="button" class="mdeditor-fab-btn" id="calendarTrkBtn" title="' + (trackersOn ? 'Скрыть трекеры занятий' : 'Показать трекеры занятий') + '">' + (trackersOn ? TRK_ICON_SVG : TRK_OFF_ICON_SVG) + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarHiddenBtn" title="' + eyeTitle() + '">' + (showHidden() ? EYE_ICON_SVG : EYE_OFF_ICON_SVG) + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarColorBtn" title="Цвета календаря">' + COLOR_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarSettingsBtn" title="Настройки календаря">' + GEAR_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarAddBtn" title="Новое мероприятие">' + PLUS_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarHomeStub" tabindex="-1" aria-disabled="true">' + HOME_ICON_SVG + '</button>' +
    '</div>';
  }
  function bindFab(){
    document.getElementById("calendarAddBtn").addEventListener("click", function(){ weekRememberScroll(); openForm(null); });
    document.getElementById("calendarColorBtn").addEventListener("click", function(){ weekRememberScroll(); openColors(); });
    document.getElementById("calendarSettingsBtn").addEventListener("click", function(){ weekRememberScroll(); openSettings(); });
    document.getElementById("calendarHiddenBtn").addEventListener("click", function(){
      saveShowHidden(!showHidden());
      var hb = document.getElementById("calendarHiddenBtn");
      if(hb){ hb.innerHTML = showHidden() ? EYE_ICON_SVG : EYE_OFF_ICON_SVG; hb.title = eyeTitle(); }
      if(mode === "week"){ weekRememberScroll(); renderWeek(); return; }
      refreshList();
    });
    document.getElementById("calendarTrkBtn").addEventListener("click", function(){
      trackersOn = !trackersOn;
      saveTrackersOn();
      var tb = document.getElementById("calendarTrkBtn");
      if(mode === "week"){ weekRememberScroll(); renderWeek(); return; }
      refreshList(); // список: обновляется только содержимое, прокрутка остаётся
      if(tb){ tb.innerHTML = trackersOn ? TRK_ICON_SVG : TRK_OFF_ICON_SVG; tb.title = trackersOn ? "Скрыть трекеры занятий" : "Показать трекеры занятий"; }
    });
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
      if(!visibleEv(ev)) return;
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
    var trkByDay = trackersOn ? weekTrackerSegments(ws) : null;
    var head = '<div class="cal-wk-head"><div class="cal-wk-gutter"></div>';
    var cols = '';
    for(var i = 0; i < 7; i++){
      var ds = dayStartAt(ws, i), isToday = dateValue(ds) === todayKey;
      head += '<div class="cal-wk-dayh' + (isToday ? ' cal-wk-today' : '') + '"><span>' + WEEKDAYS[i] + '</span><b>' + new Date(ds).getDate() + '</b></div>';
      // трекеры — такие же блоки, как мероприятия: общая раскладка дня, в колонки они встают только при пересечении по времени
      var segs = segsByDay[i].slice();
      if(trkByDay) trkByDay[i].forEach(function(tg){ segs.push(tg); });
      if(visOverHidden()){
        // видимые мероприятия (и трекеры) не замечают скрытые: раскладываются отдельно и рисуются после них, то есть поверх
        var hidSegs = [], visSegs = [];
        segs.forEach(function(sg){ (sg.ev && isHidden(sg.ev.id) ? hidSegs : visSegs).push(sg); });
        packDay(hidSegs); packDay(visSegs);
        segs = hidSegs.concat(visSegs);
      } else packDay(segs);
      var blocks = '';
      segs.forEach(function(sg){
        var top = sg.top * hourPx / 60;
        var h = Math.max(MIN_BLOCK_PX, (sg.bottom - sg.top) * hourPx / 60 - 1);
        var w = 100 / sg.cols, left = sg.col * w;
        var posCss = 'left:' + left.toFixed(2) + '%;width:calc(' + w.toFixed(2) + '% - 1px)';
        var tall = h >= 30;
        if(sg.t){
          blocks += '<div class="cal-wk-trk cal-trk-' + sg.t.src + '" data-t="' + sg.top + '" data-b="' + sg.bottom + '" data-txt="' + esc(trackerText(sg.t)) + '"' +
            ' style="top:' + top.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;' + posCss + '">' +
            esc(sg.t.label) + '</div>';
          return;
        }
        blocks += '<div class="cal-wk-ev cal-c-' + calOf(sg.ev) + (isHidden(sg.ev.id) ? ' cal-hid' : '') + (sg.at + sg.dur < now ? ' cal-wk-past' : '') + '" data-id="' + esc(sg.ev.id) + '" data-at="' + sg.at + '" data-e="' + (sg.at + sg.dur) + '"' +
          ' data-t="' + sg.top + '" data-b="' + sg.bottom + '" style="top:' + top.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;' + posCss + '">' +
          esc(sg.ev.title) + '</div>';
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
    list = wk.querySelectorAll(".cal-wk-trk");
    for(i = 0; i < list.length; i++){
      var tt = +list[i].getAttribute("data-t"), tb = +list[i].getAttribute("data-b");
      list[i].style.top = (tt * hourPx / 60).toFixed(1) + "px";
      list[i].style.height = Math.max(MIN_BLOCK_PX, (tb - tt) * hourPx / 60 - 1).toFixed(1) + "px";
    }
    list = wk.querySelectorAll(".cal-wk-now");
    for(i = 0; i < list.length; i++) list[i].style.top = (+list[i].getAttribute("data-m") * hourPx / 60).toFixed(1) + "px";
  }
  // Красная линия «сейчас» и затенение прошедших событий на уже нарисованной неделе. Зовётся раз в 30 с, при возврате
  // на страницу и из my.js (`__ltOnAppResume`). Сменился день — неделя перерисовывается (прокрутка сохраняется).
  function weekNowTick(){
    if(screen !== "week" || mode !== "week") return;
    var c = container(), wk = document.getElementById("calWeek");
    if(!c || !wk || wk.querySelector(".cal-wk-clone")) return; // нет недели на экране или идёт листание
    var now = Date.now();
    if(weekRenderedAt && dateValue(now) !== dateValue(weekRenderedAt)){
      if(weekStart !== null && weekStart === mondayOf(weekRenderedAt)) weekStart = mondayOf(now); // смотрели текущую неделю — идём за сегодняшней
      weekScrollKeep = c.scrollTop;
      renderWeek();
      return;
    }
    var i, m = minutesOfDay(now), list = wk.querySelectorAll(".cal-wk-now");
    for(i = 0; i < list.length; i++){
      list[i].setAttribute("data-m", String(m));
      list[i].style.top = (m * hourPx / 60).toFixed(1) + "px";
    }
    list = wk.querySelectorAll(".cal-wk-ev");
    for(i = 0; i < list.length; i++){
      var e = +list[i].getAttribute("data-e");
      if(e) list[i].classList.toggle("cal-wk-past", e < now);
    }
  }
  setInterval(weekNowTick, 30000);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) weekNowTick(); });
  window.addEventListener("focus", weekNowTick);
  window.addEventListener("pageshow", weekNowTick);
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
    weekRenderedAt = Date.now();
    bindFab();
    syncFlush();
    applyCalColors(document.getElementById("calWeek"));
    // Перелистывание недели как в Google Календаре: соседняя неделя (копия без id) ставится рядом, обе едут за пальцем
    // (или сами по кнопкам ‹ ›), по окончании настоящая перерисовка renderWeek() подменяет копию — картинка не меняется.
    var slide = null; // {dir, nw, nws, W, finishing}
    var prevOverflowX = "";
    function slideStart(dir){
      var nws = dayStartAt(ws, 7 * dir);
      // копия соседней недели кладётся ВНУТРИ текущей, сбоку (на ширину недели): едет вместе с ней как одна лента;
      // сам элемент недели не переносится — палец, начавший жест на нём, не теряется
      var W = wk.getBoundingClientRect().width || c.clientWidth || 360;
      var nw = document.createElement("div");
      nw.className = "cal-week cal-wk-clone";
      nw.setAttribute("aria-hidden", "true");
      nw.innerHTML = weekHtml(nws).replace(/\sid="[^"]*"/g, "");
      nw.style.cssText = "position:absolute;top:0;left:0;width:100%;pointer-events:none;transform:translate3d(" + (dir * W) + "px,0,0);";
      wk.style.position = "relative";
      wk.appendChild(nw);
      applyCalColors(nw);
      prevOverflowX = c.style.overflowX;
      c.style.overflowX = "hidden";
      slide = { dir: dir, nw: nw, nws: nws, W: W, finishing: false };
    }
    function slideTo(dx, animate){
      var s = slide;
      if(!s) return;
      dx = s.dir > 0 ? Math.min(0, Math.max(-s.W, dx)) : Math.max(0, Math.min(s.W, dx));
      wk.style.transition = animate ? "transform " + WEEK_SLIDE_MS + "ms cubic-bezier(.2,.8,.2,1)" : "none";
      wk.style.transform = "translate3d(" + dx + "px,0,0)";
    }
    function slideUnwrap(){
      var s = slide;
      if(!s) return;
      slide = null;
      wk.style.transform = ""; wk.style.transition = ""; wk.style.position = "";
      if(s.nw.parentNode) s.nw.parentNode.removeChild(s.nw);
      c.style.overflowX = prevOverflowX;
    }
    function slideFinish(commit, fromDx){
      var s = slide;
      if(!s || s.finishing) return;
      s.finishing = true;
      slideTo(commit ? -s.dir * s.W : 0, true);
      setTimeout(function(){
        if(slide !== s) return;
        if(commit){
          slide = null;
          c.style.overflowX = prevOverflowX;
          weekStart = s.nws; weekScrollKeep = c.scrollTop; renderWeek();
        } else slideUnwrap();
      }, WEEK_SLIDE_MS + 30);
    }
    function shift(n){
      if(slide) return;
      slideStart(n);
      slideTo(0, false);
      void wk.offsetWidth; // зафиксировать стартовое положение, чтобы переход анимировался
      slideFinish(true);
    }
    document.getElementById("calWkPrev").addEventListener("click", function(){ shift(-1); });
    document.getElementById("calWkNext").addEventListener("click", function(){ shift(1); });
    document.getElementById("calWkToday").addEventListener("click", function(){ if(slide) return; weekStart = null; weekScrollKeep = null; weekScrollToNow = true; renderWeek(); });
    var wk = document.getElementById("calWeek");
    wk.addEventListener("click", function(e){
      if(Date.now() - pinchEndedAt < 350) return; // тап, оставшийся от щипка
      var trk = e.target.closest ? e.target.closest(".cal-wk-trk") : null;
      if(trk){ trackerToast(trk.getAttribute("data-txt") || ""); return; }
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
    var sx = 0, sy = 0, tracking = false, lock = null, t0 = 0, lastDx = 0; // lock: null | "h" (листаем неделю) | "v" (обычная прокрутка)
    var pinch = null; // {gap0, px0, anchor (минуты под серединой пальцев)}
    function gapOf(t){ return Math.abs(t[0].clientY - t[1].clientY); }
    function midOf(t){ return (t[0].clientY + t[1].clientY) / 2; }
    wk.addEventListener("touchstart", function(e){
      if(slide && slide.finishing) return; // неделя ещё доезжает — новый жест не начинаем
      if(e.touches && e.touches.length === 2){
        tracking = false; lock = null;
        if(slide) slideUnwrap(); // второй палец: перелистывание отменяется, дальше щипок
        var g = gapOf(e.touches);
        var body = document.getElementById("calWkBody");
        if(g >= PINCH_MIN_GAP && body){
          pinch = { gap0: g, px0: hourPx, anchor: (midOf(e.touches) - body.getBoundingClientRect().top) / hourPx };
        } else pinch = null;
        return;
      }
      if(!e.touches || e.touches.length !== 1){ tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true; lock = null; t0 = Date.now(); lastDx = 0;
    }, { passive: true });
    wk.addEventListener("touchmove", function(e){
      if(!pinch && tracking && lock !== "v" && e.touches && e.touches.length === 1){
        var mdx = e.touches[0].clientX - sx, mdy = e.touches[0].clientY - sy;
        if(lock === null && (Math.abs(mdx) > 8 || Math.abs(mdy) > 8)){
          lock = Math.abs(mdx) > Math.abs(mdy) * 1.4 ? "h" : "v";
        }
        if(lock === "h"){
          if(e.cancelable) e.preventDefault();
          var want = mdx < 0 ? 1 : -1;
          if(slide && slide.dir !== want && mdx !== 0) slideUnwrap(); // палец перешёл на другую сторону — другая соседняя неделя
          if(!slide && mdx !== 0) slideStart(want);
          lastDx = mdx;
          slideTo(mdx, false);
        }
        return;
      }
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
      if(!tracking) return;
      tracking = false;
      if(lock === "h" && slide){
        var dx = lastDx, ms = Math.max(1, Date.now() - t0);
        var far = Math.abs(dx) > Math.min(slide.W * 0.3, 140), fast = Math.abs(dx) / ms > 0.45 && Math.abs(dx) > 25;
        var right = (slide.dir > 0) === (dx < 0); // ушли в сторону, где лежит соседняя неделя
        pinchEndedAt = Date.now(); // тап, оставшийся от жеста, не открывает форму
        slideFinish(right && (far || fast));
      }
      lock = null;
    }, { passive: true });
    wk.addEventListener("touchcancel", function(){
      tracking = false; lock = null;
      if(slide && !slide.finishing) slideFinish(false);
    }, { passive: true });
    var goNow = weekScrollToNow; weekScrollToNow = false;
    scrollWeek(c, goNow);
  }
  // isNow — только после кнопки «Сегодня»: прокрутить к красной линии; иначе (открытие вкладки, листание) день виден с 8:00
  function scrollWeek(c, isNow){
    var keep = weekScrollKeep;
    weekScrollKeep = null;
    function go(){
      if(keep !== null){ c.scrollTop = keep; return; }
      var body = document.getElementById("calWkBody"), top = c.querySelector(".cal-wk-top");
      if(!body) return;
      var hour = isNow ? Math.max(0, new Date().getHours() - 2) : WEEK_OPEN_HOUR;
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
    var nid = newId();
    list.push({ id: nid, title: title, start: s, end: e, repeat: "", cal: cal, updatedAt: Date.now() });
    save(list);
    return nid;
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
    var usedId = ev.id;
    if(at === ev.start){
      replaceInList(list, make(ev.id));
    } else {
      for(var i = 0; i < list.length; i++){
        if(list[i].id === ev.id){
          list[i].until = list[i].until ? Math.min(list[i].until, at) : at;
          list[i].updatedAt = now;
        }
      }
      usedId = newId();
      list.push(make(usedId));
    }
    save(list);
    return usedId;
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
      '<div class="cal-field"><div class="item-form-hint">Отображение</div>' +
        '<select class="mdeditor-cleanup-input" id="calVis"><option value="show">Показать</option><option value="hide">Скрыть</option></select></div>' +
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
    var repEl = document.getElementById("calRepeat"), calEl = document.getElementById("calCal"), visEl = document.getElementById("calVis"), errEl = document.getElementById("calError");
    if(ev){
      titleEl.value = ev.title;
      sd.value = dateValue(baseS); st.value = timeValue(baseS);
      ed.value = dateValue(baseE); et.value = timeValue(baseE);
      repEl.value = ev.repeat || "";
      calEl.value = calOf(ev);
      visEl.value = isHidden(ev.id) ? "hide" : "show";
    } else if(preset){
      sd.value = dateValue(preset); st.value = timeValue(preset);
      ed.value = dateValue(preset + HOUR_MS); et.value = timeValue(preset + HOUR_MS);
    }

    // Общий календарь у читателя группы — только просмотр (как общие задачи): новое общее не создать, существующее не правится
    var readOnly = !!ev && !canEdit(ev);
    if(!readOnly && !canEdit({ cal: "shared" }) && !(ev && calOf(ev) === "shared")){
      for(var oi = calEl.options.length - 1; oi >= 0; oi--) if(calEl.options[oi].value === "shared") calEl.remove(oi);
    }
    if(isNew){ // новое мероприятие — в том календаре, в котором сохраняли прошлое (если он доступен; можно сменить)
      var lc = lastCal();
      for(var li = 0; li < calEl.options.length; li++) if(calEl.options[li].value === lc) calEl.value = lc;
    }
    if(readOnly){
      [titleEl, sd, st, ed, et, repEl, calEl].forEach(function(el){ el.disabled = true; });
      var delRow = document.getElementById("calDelRow"), cnBtn = document.getElementById("calCancel");
      if(delRow) delRow.style.display = "none";
      if(cnBtn) cnBtn.textContent = "Назад";
      errEl.textContent = "Общий календарь: у вас доступ только для чтения (отображение можно менять).";
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
      var hideNow = visEl.value === "hide";
      if(readOnly){ setHidden(ev.id, hideNow); return renderMain(); } // читатель группы меняет только своё отображение
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
        if(title === ev.title && s === baseS && e === baseE && r === ev.repeat && calv === calOf(ev)){ // менялось ли только отображение
          if(hideNow !== isHidden(ev.id)) setHidden(ev.id, hideNow);
          return renderMain();
        }
        var following = function(){ setHidden(applyFollowing(ev, baseS, title, s, e, r, calv), hideNow); rememberCal(calv); renderMain(); }; // не function-объявление в блоке: старый WebView (Android 5)
        if(r !== ev.repeat) return following(); // менялся вид повтора — это всегда «последующие», вопрос не нужен
        return askScope("Это повторяющееся мероприятие. Сохранить изменения:",
          function(){ setHidden(applyOnlyThis(ev, baseS, title, s, e, calv), hideNow); rememberCal(calv); renderMain(); },
          following);
      }

      var list = load();
      var rec = { id: ev ? ev.id : newId(), title: title, start: s, end: e, repeat: r, cal: calv, updatedAt: Date.now() };
      if(!replaceInList(list, rec)) list.push(rec);
      save(list);
      setHidden(rec.id, hideNow);
      rememberCal(calv);
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
        setHidden(ev.id, false);
        renderMain();
      });
    }
  }

  // ---------- экран «Цвета календаря» (разметка и классы как в форме комбинированных карточек) ----------
  function paletteHtml(key){
    var h = '<div class="cal-palette" data-key="' + key + '">';
    [COLORS_BRIGHT, COLORS_PASTEL].forEach(function(row){
      h += '<div class="cal-palette-row">';
      row.forEach(function(hex){
        h += hex
          ? '<button type="button" class="cal-swatch" data-color="' + hex + '" style="background:' + hex + ';" title="' + hex + '"></button>'
          : '<button type="button" class="cal-swatch none" data-color="" title="По умолчанию"></button>';
      });
      h += '</div>';
    });
    return h + '</div>';
  }
  function openColors(){
    var c = container();
    if(!c) return;
    clearTimeout(tapTimer); tapTimer = null;
    screen = "form";
    var draft = {};
    COLOR_ITEMS.forEach(function(it){ draft[it.key] = userColors[it.key]; });
    var html = '<div class="mdeditor-tab item-card-form" id="calendarColorForm">' +
      '<h3 class="common-tab-title">Цвета календаря</h3>' +
      '<div class="item-form-hint">Цвет каждого календаря и трекеров занятий — необязательно. Пустой квадрат — цвет по умолчанию. Выбор действует на этом устройстве.</div>';
    COLOR_ITEMS.forEach(function(it){
      html += '<div class="cal-field"><div class="item-form-hint">' + esc(it.label) + '</div>' + paletteHtml(it.key) + '</div>';
    });
    html += '<div class="item-form-buttons">' +
        '<button type="button" class="workbooks-run-btn" id="calColorSave">Сохранить</button>' +
        '<button type="button" class="workbooks-run-btn" id="calColorCancel">Отмена</button>' +
      '</div></div>';
    c.innerHTML = html;
    syncFlush();
    c.scrollTop = 0;
    function mark(){
      Array.prototype.forEach.call(c.querySelectorAll(".cal-palette"), function(pal){
        var cur = draft[pal.getAttribute("data-key")] || "";
        Array.prototype.forEach.call(pal.querySelectorAll(".cal-swatch"), function(b){
          var on = (b.getAttribute("data-color") || "") === cur;
          if(on) b.classList.add("selected"); else b.classList.remove("selected");
        });
      });
    }
    mark();
    document.getElementById("calendarColorForm").addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest(".cal-swatch") : null;
      if(!b) return;
      var pal = b.parentNode && b.parentNode.parentNode;
      var key = pal && pal.getAttribute ? pal.getAttribute("data-key") : null;
      if(!key || !draft.hasOwnProperty(key)) return;
      draft[key] = b.getAttribute("data-color") || "";
      mark();
    });
    document.getElementById("calColorSave").addEventListener("click", function(){
      COLOR_ITEMS.forEach(function(it){ userColors[it.key] = draft[it.key] || ""; });
      saveColors();
      applyUserColors();
      renderMain();
    });
    document.getElementById("calColorCancel").addEventListener("click", function(){ renderMain(); });
  }

  // ---------- экран «Настройки календаря» ----------
  function openSettings(){
    var c = container();
    if(!c) return;
    clearTimeout(tapTimer); tapTimer = null;
    screen = "form";
    var html = '<div class="mdeditor-tab item-card-form" id="calendarSettingsForm">' +
      '<h3 class="common-tab-title">Настройки календаря</h3>' +
      '<label style="display:flex;align-items:center;"><input type="checkbox" id="calSetVisOver"' + (visOverHidden() ? ' checked' : '') + ' style="width:22px;height:22px;flex-shrink:0;margin:0 10px 0 0;accent-color:var(--wood);"><span>Видимые мероприятия всегда перекрывают скрытые</span></label>' +
      '<div class="item-form-hint">Работает в режиме «Неделя», когда показаны скрытые мероприятия: видимые рисуются поверх скрытых, не делят с ними место на колонки и не сужаются. Выбор действует на этом устройстве.</div>' +
      '<div class="item-form-buttons">' +
        '<button type="button" class="workbooks-run-btn" id="calSetSave">Сохранить</button>' +
        '<button type="button" class="workbooks-run-btn" id="calSetCancel">Отмена</button>' +
      '</div></div>';
    c.innerHTML = html;
    syncFlush();
    c.scrollTop = 0;
    document.getElementById("calSetSave").addEventListener("click", function(){
      saveVisOverHidden(document.getElementById("calSetVisOver").checked);
      renderMain();
    });
    document.getElementById("calSetCancel").addEventListener("click", function(){ renderMain(); });
  }

  window.CalendarTab = {
    // my.js отдаёт хранилище (см. шапку); зовётся до первого render
    setStore: function(store){ STORE = store || null; },
    render: function(){ importLegacy(); loadMode(); weekStart = null; weekScrollKeep = null; lastSig = JSON.stringify(load()); renderMain(); },
    // данные могли измениться снаружи (пришли чужие правки группы): перерисовать текущий экран, если список изменился.
    // Открытую форму не трогаем; прокрутка сохраняется. my.js зовёт только когда вкладка «Календарь» на экране.
    // возврат в приложение (оболочка зовёт из my.js `__ltOnAppResume`): красная линия и прошедшие события — по текущему времени
    tick: function(){ weekNowTick(); },
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
