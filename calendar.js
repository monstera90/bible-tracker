/* ===========================================================================
   calendar.js
   Версия: 18.8 (26.11) — мышь и тачпад: (1) перетаскивание блока в «Неделе» и «Двух неделях» теперь работает и мышью (левая кнопка удержана, блок идёт за курсором, отпускание кладёт на место, Esc отменяет; раньше `onLong` отсекал всё, кроме касания); (2) размер часа в неделе и в дневном виде меняется Ctrl+колесом мыши и щипком по тачпаду (событие wheel с ctrlKey), как щипок двумя пальцами. Откат: calendar.js 18.7.
   Версия: 18.7 (21.11) — (1) перетаскивание в «Неделе» и «Двух неделях»: долгое удержание мероприятия или задачи (`LTPress`, `DRAG_MS`), блок-копия идёт за пальцем, по отпусканию встаёт на день под пальцем и время со сдвигом в 5 минут (`DRAG_SNAP_MIN`); на другую неделю тянуть нельзя (рамка — видимые дни), у края экрана сетка сама прокручивается; у повторяющегося мероприятия спрашивает «Только это» / «Это и все последующие» (`applyOnlyThis` / `applyFollowing`), общее мероприятие читателя группы не двигается; (2) новый режим «Две недели» (`mode = "two"`, 14 колонок: текущая и следующая неделя, без стрелок и свайпа), показывается только если окно не уже `TWO_WEEK_MIN_W` (телефон в горизонтальном положении); в кругу кнопки режима: список → неделя → две недели → список; на узком экране режим «две недели» пропускается, а сохранённый выбор возвращается при повороте. Откат: calendar.js 18.6.
   Версия: 18.6 (19.11) — в нижнем ряду («Список» и «Неделя») слева от «домика» кнопка полноэкранного режима (`#calendarFullscreenBtn`, `window.LTFullscreen` из my.js). Откат: calendar.js 18.5.
   Версия: 18.5 (19.11) — настройки календаря (скрытые, цвета, переключатели) синхронизируются между устройствами через хранилище my.js (`prefGet/prefSet/hiddenAll/hiddenSet`, `importPrefs`, `refreshDayCols`); задачу в календаре можно сохранить с одной картинкой без названия (`IMG_ONLY_TITLE`). Откат: calendar.js 18.4.
   Версия: 18.4 (19.11) — скрытие повторяющегося мероприятия (поле «Отображение» в форме) спрашивает «Только это» / «Это и все последующие», как правка и удаление; признак по-прежнему только на устройстве и серию не меняет: `isHidden(id, at)`, `setHidden(id, on, at, following)` (запись {b, r} с правилами по дням/«с этого дня»; старый вид {id:1} читается как раньше), `hideOccurrence`; список/неделя/виджет проверяют скрытие по каждому повторению. Откат: calendar.js 18.3.
   Версия: 18.3 (16.11) — `CalendarTab.openTask(taskId)`: форма задачи календаря по id задачи (одно нажатие на карточку задачи в виджете, my.js `__ltOpenTaskForm`). Откат: calendar.js 18.2.
   Версия: 18.2 (14.11) — `CalendarTab.openEvent(id, at)`: форма конкретного мероприятия по нажатию на карточку события в виджете (my.js `__ltOpenCalendarEvent`).
   Версия: 8.0 (27.10) — «Неделя»: (1) листание недели как в Google Календаре — соседняя неделя едет следом за пальцем (`slideStart/slideTo/slideFinish` в `renderWeek`), отпустили — доезжает или возвращается; кнопки ‹ › листают так же; неделя по-прежнему Пн–Вс; (2) при открытии вкладки неделя всегда с 7:00 (красная линия может быть за экраном), к красной линии (на 2 часа раньше) — только по кнопке «Сегодня» (`weekScrollToNow`). Откат: calendar.js 7.0.
   Версия: 7.0 (25.10)
   Вкладка «Календарь» (ключ `calendar`, кнопка `settingsTabCalendarBtn` — самостоятельный нижний язычок набора 1 справа от «Задачи»,
   без бокового ряда; окно открывается на всю область, как у заметок и книг). Точка входа — window.CalendarTab.render(); my.js зовёт её из switchSettingsTab (renderSettingsTabCalendar).
   Два режима, кнопка-переключатель — первая в нижнем ряду (`calendarModeBtn`), выбор хранится в `calendarMode_v1`
   ("list" | "week"), рисует нужный `renderMain` (из форм возвращаются тоже через него):
   • «Список» (в стиле центра событий — вкладки-колокольчика, eventlog.js: `.event-center`, `.event-day`, `.event-row`,
     `.event-time`) — `renderList`;
   • «Неделя» (как в Google Календаре) — `renderWeek`: шапка с «‹ ›» и диапазоном дат, ряд дней Пн–Вс, сетка
     24 часа × `hourPx` (щипок двумя пальцами по вертикали меняет высоту часа в пределах `HOUR_MIN`…`HOUR_MAX`, значение
     хранится в `calendarHourPx_v1`; на время жеста блоки пересчитываются на месте `applyZoom`, по отпусканию неделя
     перерисовывается — перераскладка пересечений), события блоками на своём месте (`weekSegments`: событие через полночь режется по дням, пересекающиеся
     встают в колонки `packDay`). Показываются ВСЕ повторения серий этой недели (сворачивания серий в неделе нет). Тап по
     блоку — форма этого повторения, тап по пустому месту сетки — форма нового мероприятия на этот день с началом в начале
     нажатого часа (`openForm(null, null, начало)`); смена недели — стрелки или свайп по сетке. Вход во вкладку открывает текущую неделю;
     возвращение из формы — ту же неделю с той же прокруткой (`weekStart`, `weekScrollKeep`). Шапка липкая (`position:sticky`;
     на старом WebView без sticky просто прокручивается вместе с сеткой).
   Экран: список мероприятий (дни без мероприятий не показываются) и нижний ряд кнопок `.mdeditor-fab-row`: «+» (новое
   мероприятие) слева от «домика»; «домик» (`calendarHomeBtn`) — «сегодня»: в неделе открывает текущую неделю и крутит к красной линии, в списке сворачивает серии и возвращает наверх.
   Тап по мероприятию открывает ту же форму для правки (с кнопкой «Удалить»).
   Версия: 18.8 (22.11) — трекеры занятий накладываются поверх мероприятий (`dayColHtml`: раскладка `packDay` отдельно для мероприятий и для трекеров, трекеры рисуются последними, `z-index:2`), а не делят с ними ширину колонки.
   Цвета календарей: кнопка «Цвета» (`calendarColorBtn`, нижний ряд, после «Трекеров») открывает экран `openColors` в стиле формы
   комбинированных карточек (палитра 2×8, пустой квадрат — цвет по умолчанию): личный календарь, общий календарь, трекеры занятий.
   Выбор хранится на устройстве (`calendarColors_v1` = {personal, shared, task, trk, hid, past, trk_<ключ трекера>} — "#rrggbb" или ""), `applyUserColors` кладёт его в
   `--cal-personal` / `--cal-shared` / `--cal-trk` / `--cal-hid` / `--cal-past` на `<html>` (пусто — убирает, действует цвет по умолчанию из components.css).
   У каждого трекера из `TRACKER_SOURCES` своя палитра (`trk_<key>`, строки в `COLOR_ITEMS` добавляются сами): выбранный цвет пишется прямо в `style`
   блока недели / строки списка (`trkOwnColor`, `trkBlockCss`); пусто — действует общий цвет «Трекеры занятий» (`trk`).
   Цвет прошедших мероприятий (`past`): пока не выбран, прошедшие остаются цвета своего календаря; выбран — прошедшие блоки недели и
   строки списка получают его прямо в `style` (`pastBlockCss`, `paintPastBlock`; главнее цвета календаря; у скрытого мероприятия с выбранным цветом скрытых действует цвет скрытых — `usePastColor`).
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
   Список показывает только предстоящее: с начала сегодняшнего дня и LIST_AHEAD_DAYS вперёд, прошедшие дни не показываются.
   Список и неделя независимы: выбранная в неделе дата на список не влияет.
   Колонка дня в ежедневной заметке: `CalendarTab.mountDayColumn(host, {day, beforeForm})` (зовёт mdeditor.js `mountDayCalendar`) кладёт в начало
   `host` плавающую колонку `.cal-daycol` (float:right, ширина = одного дня недели на телефоне, `--daycal-w`, у правого края окна) с одним днём
   (`dayColHtml`, `weekSegments(day, 1)`): те же блоки, трекеры, красная линия, цвета, скрытые; тап по блоку — форма, тап по пустому месту — новое
   мероприятие на этот час, щипок по вертикали — масштаб (общий `calendarHourPx_v1`); подписи часов лежат внутри колонки. Форма открывается ПОВЕРХ заметки
   (`extForm`: `.cal-dayform` в `.settings-modal-box`, `container()` отдаёт её, `renderMain` при открытой форме её закрывает и возвращает `screen`),
   заметка и редактор не перерисовываются. Колонка сама перерисовывается при изменении данных (раз в 30 с и из `tick`), сама снимается, если host ушёл из DOM.
   Окно колонки (`dayWindowStart`): не с 00:00, а с первого ещё не закончившегося нескрытого мероприятия дня за вычетом 2 часов (не больше 2 пустых
   часов сверху; если все прошли — с первого за день; нет ни одного нескрытого мероприятия — колонки нет, `opts.onLayout` просит редактор перемерить). Смещение `winOff` (минуты) учитывают раскладка блоков,
   подписи часов, сетка, красная линия, щипок и тап по пустому месту. Окно пересчитывается в `tick`, когда мероприятие заканчивается.
   Хранилище для неё подготавливает my.js: `window.__ltEnsureCalendarStore`.
   =========================================================================== */
(function(){
  "use strict";

  var KEY = "calendarEvents_v1";
  var MODE_KEY = "calendarMode_v1";
  var LAST_CAL_KEY = "calendarLastCal_v1"; // календарь последнего сохранённого мероприятия ("personal" | "shared"), подставляется в новое
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
  var DRAG_MS = 450;        // сколько держать палец на блоке недели, чтобы начать перетаскивание
  var DRAG_SNAP_MIN = 5;    // шаг времени при перетаскивании, минут
  var TWO_WEEK_MIN_W = 640; // режим «Две недели» показывается, только если окно не уже стольких px (телефон в горизонтальном положении да, в вертикальном нет)
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
  var TWO_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="2.5" y="5" width="19" height="15" rx="2"></rect><path d="M2.5 10h19"></path><path d="M12 5v15" stroke-width="2.4"></path><path d="M5.7 10v10"></path><path d="M8.8 10v10"></path><path d="M15.2 10v10"></path><path d="M18.3 10v10"></path></svg>';
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
  var mode = "list";    // выбранный режим: "list" | "week" | "two" (хранится в MODE_KEY); "two" на узком окне рисуется как "week" (см. effMode)
  var wkN = 7;          // сколько дней в нарисованной сетке: 7 («Неделя») или 14 («Две недели»)
  var dragOn = false;   // идёт перетаскивание блока: фоновые перерисовки ждут
  var weekStart = null; // начало (понедельник 00:00) показанной недели; null — текущая
  var weekScrollKeep = null; // прокрутка недели, которую вернуть после формы
  var weekScrollToNow = false; // «домик»: один раз прокрутить к красной линии (иначе неделя всегда открывается с 8:00)
  var WEEK_SLIDE_MS = 260;   // длительность доезжания недели при перелистывании
  var hourPx = HOUR_DEFAULT; // текущая высота часа в неделе
  var pinchEndedAt = 0;      // когда закончился щипок (тап сразу после него игнорируется)
  var extForm = null;  // форма, открытая ПОВЕРХ ежедневной заметки: {el, prevScreen, owner, onClose}; пока она есть, container() отдаёт её
  var dayCols = [];    // живые колонки дня в заметках: [{tick, destroy, refresh}]
  var expanded = {};   // id серий, раскрытых в списке
  var tapTimer = null; // отложенный одиночный тап по строке серии

  // ---------- вспомогательное ----------
  function container(){ return extForm ? extForm.el : document.getElementById("settingsTabContent"); }
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
  // ---------- настройки календаря: едут между устройствами вместе с мероприятиями ----------
  // Скрытие мероприятий, цвета, «показывать скрытые», «видимые поверх скрытых» и кнопка трекеров занятий лежат в хранилище my.js
  // (state: "calhid:<id>" и "calpref:<имя>" = {c, t}; last-write-wins, в облако уходят тем же doCloudSync). Без хранилища — localStorage.
  // localStorage остаётся зеркалом на устройстве и источником разового переноса прежних настроек (importPrefs).
  // Режим «Список/Неделя», масштаб часа и календарь последнего мероприятия — вид самого экрана, они остаются на устройстве.
  var PREFS_IMPORTED_KEY = "calendarPrefsImported_v1";
  var IMG_ONLY_TITLE = "Картинка"; // название записи календаря у задачи, в тексте которой только картинка
  function prefStoreGet(name){
    if(!STORE || !STORE.prefGet) return undefined;
    try{ return STORE.prefGet(name); }catch(e){ return undefined; }
  }
  function prefStoreSet(name, value){
    if(!STORE || !STORE.prefSet) return;
    try{ STORE.prefSet(name, value); }catch(e){}
  }
  function flagGet(name, lsKey){
    var v = prefStoreGet(name);
    if(v === 0 || v === 1) return v === 1;
    try{ return localStorage.getItem(lsKey) === "1"; }catch(e){ return false; }
  }
  function flagSet(name, lsKey, on){
    try{ localStorage.setItem(lsKey, on ? "1" : "0"); }catch(e){}
    prefStoreSet(name, on ? 1 : 0);
  }
  // прежние настройки этого устройства — в общее хранилище, один раз; запись переноса самая «старая» (t=1), любая настоящая правка с другого устройства главнее
  function importPrefs(){
    if(!STORE || !STORE.prefImport) return;
    try{ if(localStorage.getItem(PREFS_IMPORTED_KEY)) return; }catch(e){ return; }
    try{
      var h = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "null");
      if(h && typeof h === "object" && !Array.isArray(h) && STORE.hiddenImport) Object.keys(h).forEach(function(id){ STORE.hiddenImport(id, h[id]); });
      var col = JSON.parse(localStorage.getItem(COLORS_KEY) || "null");
      if(col && typeof col === "object" && !Array.isArray(col)) STORE.prefImport("colors", col);
      [["showHidden", SHOW_HIDDEN_KEY], ["visOver", VIS_OVER_KEY], ["trackers", TRK_KEY]].forEach(function(p){
        var v = localStorage.getItem(p[1]);
        if(v === "1" || v === "0") STORE.prefImport(p[0], v === "1" ? 1 : 0);
      });
    }catch(e){}
    try{ localStorage.setItem(PREFS_IMPORTED_KEY, "1"); }catch(e){}
  }
  // подпись настроек из хранилища: чужие правки (пришли с облака) видны по её смене
  function prefsSig(){
    if(!STORE || !STORE.prefGet) return "";
    var o = { c: prefStoreGet("colors"), s: prefStoreGet("showHidden"), v: prefStoreGet("visOver"), t: prefStoreGet("trackers"), h: null };
    try{ o.h = STORE.hiddenAll ? STORE.hiddenAll() : null; }catch(e){}
    return JSON.stringify(o);
  }
  function reloadPrefs(){ hiddenIds = null; loadTrackersOn(); loadColors(); applyUserColors(); }
  var POMO_CAL_MIN_MS = 20 * 60 * 1000; // рабочие отрезки помодоро короче 20 минут в календарь не попадают (в «Истории» и трекере экранов они остаются)
  var WORKOUT_KIND_LABELS = { run: "Бег", walk: "Ходьба", bike: "Велосипед" };
  var TRACKER_SOURCES = [
    { key: "workout", label: "Тренировка", get: function(){
      var W = window.WorkoutsTab;
      var list = (W && W.records) ? W.records() : [];
      return list.map(function(r){
        var sub = [];
        if(r.totalMs > 0){ var mins = Math.round(r.totalMs / 60000); sub.push(mins >= 60 ? Math.floor(mins / 60) + " ч " + pad2(mins % 60) + " мин" : mins + " мин"); }
        if(r.m > 0) sub.push((Math.round(r.m / 10) / 100).toFixed(2).replace(".", ",") + " км");
        // подпись блока — вид занятия (Бег / Ходьба / Велосипед), слово «Тренировка» в календарь не пишется
        return { start: r.start, end: r.end, dur: r.totalMs, title: WORKOUT_KIND_LABELS[r.type] || WORKOUT_KIND_LABELS.run, sub: sub.join(" · ") };
      });
    } },
    // помодоро: законченные рабочие отрезки (pomodoro.js, `records()`; едут в облако — видны и на другом устройстве); название блока — название сессии
    { key: "pomodoro", label: "Помодоро", get: function(){
      var P = window.PomodoroTab;
      var list = (P && P.records) ? P.records() : [];
      return list.filter(function(r){ return r.end - r.start >= POMO_CAL_MIN_MS; }).map(function(r){
        var mins = Math.max(1, Math.round((r.end - r.start) / 60000));
        return { start: r.start, end: r.end, dur: r.end - r.start, title: r.task, sub: mins >= 60 ? Math.floor(mins / 60) + " ч " + pad2(mins % 60) + " мин" : mins + " мин" };
      });
    } },
    // чтение: периоды считает screentime.js (`readingPeriods`: ридер/ИПКД, правила заходов — в его шапке); только на этом устройстве
    { key: "read", label: "Чтение", get: function(){
      var S = window.ScreenTime;
      var list = (S && S.readingPeriods) ? S.readingPeriods() : [];
      return list.map(function(r){
        var mins = Math.max(1, Math.round((r.end - r.start) / 60000));
        return { start: r.start, end: r.end, dur: r.end - r.start, sub: mins >= 60 ? Math.floor(mins / 60) + " ч " + pad2(mins % 60) + " мин" : mins + " мин" };
      });
    } }
  ];
  function loadTrackersOn(){ trackersOn = flagGet("trackers", TRK_KEY); }
  function saveTrackersOn(){ flagSet("trackers", TRK_KEY, trackersOn); }
  // ---------- цвета календарей (личный, общий, трекеры занятий): выбор пользователя, общий для устройств ----------
  var COLORS_KEY = "calendarColors_v1";
  // ---------- скрытые мероприятия: общие для устройств (state "calhid:<id>", у каждого мероприятия своя запись) ----------
  var HIDDEN_KEY = "calendarHiddenIds_v1";
  var SHOW_HIDDEN_KEY = "calendarShowHidden_v1";
  var hiddenIds = null;
  var hiddenSnap = {}; // что сейчас лежит в хранилище: saveHidden отдаёт ему только отличия
  function loadHidden(){
    if(hiddenIds) return hiddenIds;
    var o = null;
    if(STORE && STORE.hiddenAll){
      try{ o = STORE.hiddenAll(); }catch(e){ o = null; }
    }
    if(!o){
      try{ o = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "null"); }catch(e){ o = null; }
    }
    hiddenIds = (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    hiddenSnap = JSON.parse(JSON.stringify(hiddenIds));
    return hiddenIds;
  }
  // Признак скрытия: 1 — вся серия (или обычное мероприятие); {b, r} — серия с исключениями: b — состояние по умолчанию (0/1), r — правила
  // по порядку создания, позднее главнее: {d:"ГГГГ-ММ-ДД", v} — только повторение этого дня, {t:мс, v} — это повторение и все последующие.
  // `at` — начало повторения (у обычного мероприятия не нужно). Старые записи вида {id:1} читаются как раньше.
  function isHidden(id, at){
    var h = loadHidden()[id];
    if(!h) return false;
    if(typeof h !== "object") return true;
    var v = !!h.b;
    if(at === undefined || at === null || !isFinite(at)) return v;
    var key = dateValue(at), r = h.r || [];
    for(var i = 0; i < r.length; i++){
      var q = r[i];
      if(q.d !== undefined ? q.d === key : at >= q.t) v = !!q.v;
    }
    return v;
  }
  function saveHidden(){
    var cur = loadHidden();
    try{ localStorage.setItem(HIDDEN_KEY, JSON.stringify(cur)); }catch(e){}
    if(!STORE || !STORE.hiddenSet) return;
    var ids = {};
    Object.keys(cur).forEach(function(k){ ids[k] = 1; });
    Object.keys(hiddenSnap).forEach(function(k){ ids[k] = 1; });
    Object.keys(ids).forEach(function(id){
      var has = Object.prototype.hasOwnProperty.call(cur, id), had = Object.prototype.hasOwnProperty.call(hiddenSnap, id);
      if(has && had && JSON.stringify(cur[id]) === JSON.stringify(hiddenSnap[id])) return;
      try{ STORE.hiddenSet(id, has ? cur[id] : null); }catch(e){}
    });
    hiddenSnap = JSON.parse(JSON.stringify(cur));
  }
  // без `at` — всё мероприятие целиком (как раньше); с `at` — только это повторение (following=false) или это и все последующие (following=true)
  function setHidden(id, on, at, following){
    var h = loadHidden();
    if(at === undefined || at === null){
      if(on) h[id] = 1; else delete h[id];
      return saveHidden();
    }
    var cur = h[id];
    var base = (cur && typeof cur === "object") ? (cur.b ? 1 : 0) : (cur ? 1 : 0);
    var r = (cur && typeof cur === "object" && cur.r) ? cur.r.slice() : [];
    var key = dateValue(at), v = on ? 1 : 0;
    if(following){
      r = r.filter(function(q){ return q.d !== undefined ? q.d < key : q.t < at; });
      r.push({ t: at, v: v });
    } else {
      r = r.filter(function(q){ return q.d !== key; });
      r.push({ d: key, v: v });
    }
    if(r.length > 300) r = r.slice(r.length - 300);
    var same = true;
    for(var i = 0; i < r.length; i++) if((r[i].v ? 1 : 0) !== base) same = false;
    if(same) r = []; // все правила совпали с состоянием по умолчанию — исключений нет
    if(!r.length){ if(base) h[id] = 1; else delete h[id]; }
    else h[id] = { b: base, r: r };
    saveHidden();
  }
  // скрыть/показать повторение серии: только его или его и все последующие (если оно первое — это вся серия)
  function hideOccurrence(ev, at, on, following){
    if(following && at <= ev.start) setHidden(ev.id, on);
    else setHidden(ev.id, on, at, following);
  }
  function showHidden(){ return flagGet("showHidden", SHOW_HIDDEN_KEY); }
  function saveShowHidden(v){ flagSet("showHidden", SHOW_HIDDEN_KEY, v); }
  // видно ли мероприятие в списке/неделе
  function visibleEv(ev, at){ if(isTask(ev) && taskStateOf(ev) !== "open") return false; return showHidden() || !isHidden(ev.id, at); }
  var EYE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  var EYE_OFF_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle><path d="M4 4l16 16"></path></svg>';
  // ---------- настройки календаря (кнопка-шестерёнка `calendarSettingsBtn`): общие для устройств ----------
  var VIS_OVER_KEY = "calendarVisOverHidden_v1";
  function visOverHidden(){ return flagGet("visOver", VIS_OVER_KEY); }
  function saveVisOverHidden(v){ flagSet("visOver", VIS_OVER_KEY, v); }
  var GEAR_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="3"></circle>' +
      '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
  function eyeTitle(){ return showHidden() ? 'Скрытые мероприятия показаны (нажмите, чтобы скрыть)' : 'Скрытые мероприятия не показаны (нажмите, чтобы показать)'; }
  var COLOR_ITEMS = [
    { key: "personal", label: "Личный календарь", cssVar: "--cal-personal" },
    { key: "shared",   label: "Общий календарь",  cssVar: "--cal-shared" },
    { key: "task",     label: "Задачи",           cssVar: "--cal-task" },
    { key: "trk",      label: "Трекеры занятий (общий цвет)", cssVar: "--cal-trk" },
    { key: "hid",      label: "Скрытые мероприятия", cssVar: "--cal-hid" },
    { key: "past",     label: "Прошедшие мероприятия", cssVar: "--cal-past" }
  ].concat(TRACKER_SOURCES.map(function(src){
    // свой цвет у каждого трекера занятий; пусто — общий цвет «Трекеры занятий»
    return { key: "trk_" + src.key, label: "Трекер: " + src.label, cssVar: "--cal-trk-" + src.key };
  }));
  // та же палитра, что в форме комбинированных карточек (itemcards.js HABIT_COLORS_*): первый пастельный квадрат — «по умолчанию»
  var COLORS_BRIGHT = ["#ff0000", "#fb8c00", "#ffff00", "#43a047", "#00acc1", "#1e88e5", "#7f00ff", "#d81b60"];
  var COLORS_PASTEL = ["", "#ffcba4", "#fff3a3", "#9cdb4e", "#40d5b5", "#a9ccf4", "#d4b8f0", "#f8bbd9"];
  var userColors = { personal: "", shared: "", task: "", trk: "", hid: "", past: "" };
  function loadColors(){
    var o = prefStoreGet("colors");
    if(!o || typeof o !== "object"){
      o = null;
      try{ o = JSON.parse(localStorage.getItem(COLORS_KEY) || "null"); }catch(e){ o = null; }
    }
    COLOR_ITEMS.forEach(function(it){
      var v = o && typeof o[it.key] === "string" ? o[it.key] : "";
      userColors[it.key] = /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "";
    });
  }
  function saveColors(){
    try{ localStorage.setItem(COLORS_KEY, JSON.stringify(userColors)); }catch(e){}
    prefStoreSet("colors", JSON.parse(JSON.stringify(userColors)));
  }
  function applyUserColors(){
    var root = document.documentElement;
    if(!root || !root.style) return;
    COLOR_ITEMS.forEach(function(it){
      var v = userColors[it.key];
      if(v) root.style.setProperty(it.cssVar, v); else root.style.removeProperty(it.cssVar);
    });
  }
  // собственный цвет трекера (выбранный в «Цветах»): "#rrggbb" или "" — тогда действует общий цвет трекеров
  function trkOwnColor(srcKey){ return userColors["trk_" + srcKey] || ""; }
  function trkBlockCss(srcKey){
    var c = trkOwnColor(srcKey);
    return c ? "background:" + c + ";color:" + fgForHex(c) + ";" : "";
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
        out.push({ src: src.key, label: (typeof r.title === "string" && r.title.trim()) ? r.title.trim() : src.label, start: r.start, end: end, sub: r.sub || "" }); // r.title — своё название блока (помодоро: название сессии)
      });
    });
    return out;
  }
  function trackerText(t){ return t.label + " · " + timeRange(t.start, t.end - t.start) + (t.sub ? " · " + t.sub : ""); }
  // куски трекеров недели по дням (как weekSegments): [день 0..6] → [{top, bottom, t}]
  function weekTrackerSegments(ws, n){
    n = n || 7;
    var days = [];
    for(var di = 0; di < n; di++) days.push([]);
    trackerItems(ws, dayStartAt(ws, n)).forEach(function(t){
      for(var i = 0; i < n; i++){
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
  var dayColSig = null;         // то же для колонок дня в заметках (refreshDayCols)
  function sigNow(){ return JSON.stringify(load()) + "|" + prefsSig(); }
  var lastSig = null;          // подпись списка при последней отрисовке/обновлении (refresh не перерисовывает без перемен)
  // задачи календаря: провайдер от my.js (setTasks): add(title)→id, state(id)→"open"|"done"|"gone", rename(id,title), remove(id)
  var TASKS = null;
  var OPEN_TODAY = null; // my.js: открыть/создать сегодняшнюю заметку (setOpenToday)
  var TASK_BLOCK_MIN = 30; // высота блока задачи в неделе, минут
  function isTask(ev){ return !!(ev && ev.kind === "task" && ev.taskId); }
  function taskStateOf(ev){
    if(!TASKS || !TASKS.state) return "open";
    try{ return TASKS.state(ev.taskId) || "open"; }catch(e){ return "open"; }
  }
  function taskMark(ev){ return taskStateOf(ev) === "done" ? "\u2611 " : "\u2610 "; }
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
    importPrefs();
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
    var all = occurrenceStarts(ev, from, from + 400 * DAY_MS);
    if(!showHidden()) all = all.filter(function(at){ return !isHidden(ev.id, at); }); // скрытые повторения серии не считаются ближайшими
    return all.slice(0, n);
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
    var from = startOfDay(now);
    var to = startOfDay(now) + (LIST_AHEAD_DAYS + 1) * DAY_MS;
    var rows = [];
    load().forEach(function(ev){
      if(!ev.repeat ? !visibleEv(ev) : (isTask(ev) && taskStateOf(ev) !== "open")) return; // у серии скрытие смотрит по каждому повторению (upcoming)
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
        html += '<div class="event-row cal-trk-row"' + (trkOwnColor(r.trk.src) ? ' style="border-left-color:' + trkOwnColor(r.trk.src) + ';"' : '') + '><span class="event-time">' + timeRange(r.at, r.dur) + '</span> ' + esc(r.trk.label) + (r.trk.sub ? '<span class="cal-rep"> · ' + esc(r.trk.sub) + '</span>' : '') + '</div>';
        return;
      }
      var badge = "";
      if(r.series && r.more > 0){
        badge = ' <span class="cal-more">' + (r.open ? '↻ свернуть' : '↻ ещё ' + r.more) + '</span>';
      }
      html += '<div class="event-row cal-row cal-c-' + (isTask(r.ev) ? 'task' : calOf(r.ev)) + (isHidden(r.ev.id, r.at) ? ' cal-hid' : '') + (r.at + r.dur < now ? ' cal-row-past' : '') + (r.series && !r.first ? ' cal-row-exp' : '') +
        '" data-id="' + esc(r.ev.id) + '" data-at="' + r.at + '"' + (r.at + r.dur < now && usePastColor(isHidden(r.ev.id, r.at)) ? ' style="border-left-color:' + userColors.past + ' !important;"' : '') + '>' +
        '<span class="event-time">' + timeRange(r.at, r.dur) + '</span> ' + (isTask(r.ev) ? taskMark(r.ev) : '') + esc(r.ev.title) +
        (r.ev.repeat ? '<span class="cal-rep"> · ' + repeatLabel(r.ev.repeat) + '</span>' : '') + badge + '</div>';
    });
    return html;
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
  // Цвет прошедших мероприятий пишется прямо в style блока/строки (с !important), а не правилом в components.css: так он главнее
  // цвета календаря и скрытых и не зависит от того, какая версия стилей загружена. Пока цвет не выбран — ничего не пишется.
  function fgForHex(hex){
    var n = parseInt(hex.slice(1), 16);
    var lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? "var(--ink)" : "var(--parchment)";
  }
  // красить ли прошедшее мероприятие цветом прошедших: у скрытого с выбранным цветом скрытых главнее цвет скрытых
  function usePastColor(hiddenEv){ return !!userColors.past && !(hiddenEv && userColors.hid); }
  function pastBlockCss(){ return userColors.past ? "background:" + userColors.past + " !important;color:" + fgForHex(userColors.past) + " !important;" : ""; }
  function paintPastBlock(el){
    if(!userColors.past || !el || !el.style || !el.style.setProperty) return;
    el.style.setProperty("background", userColors.past, "important");
    el.style.setProperty("color", fgForHex(userColors.past), "important");
  }
  function applyCalColors(el){
    if(!el || !el.style || !el.style.setProperty) return;
    el.style.setProperty("--cal-personal-fg", fgFor("--cal-personal"));
    el.style.setProperty("--cal-shared-fg", fgFor("--cal-shared"));
    el.style.setProperty("--cal-task-fg", fgFor("--cal-task"));
    el.style.setProperty("--cal-trk-fg", fgFor("--cal-trk"));
    el.style.setProperty("--cal-hid-fg", fgFor("--cal-hid"));
  }
  // В режиме «Неделя» у окна убираются боковые поля (класс cal-week-flush на .settings-modal-box, modals.css), чтобы сетка
  // влезала целиком. Класс снимается сам, как только во вкладке перестаёт быть .cal-week (другой экран или другая вкладка):
  // за этим следит MutationObserver на #settingsTabContent (без :has — он есть не везде).
  var flushObserver = null;
  function syncFlush(){
    if(extForm) return; // форма поверх заметки: окно календаря не трогаем
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
    hiddenIds = null; // скрытые могли прийти с другого устройства
    loadTrackersOn();
    loadColors();
    applyUserColors();
    try{
      var sm = localStorage.getItem(MODE_KEY);
      mode = sm === "week" || sm === "two" ? sm : "list";
      var z = parseFloat(localStorage.getItem(ZOOM_KEY));
      hourPx = isFinite(z) ? clampHour(z) : HOUR_DEFAULT;
    }catch(e){ mode = "list"; hourPx = HOUR_DEFAULT; }
  }
  function saveMode(){ try{ localStorage.setItem(MODE_KEY, mode); }catch(e){} }
  function weekLike(){ return mode === "week" || mode === "two"; } // на экране сетка дней (а не список)
  // хватает ли окну места на две недели (ширина самого окна календаря, а не экрана: на телефоне вертикально — нет, горизонтально — да)
  function twoOk(){
    var c = container(), w = (c && c.clientWidth) || window.innerWidth || 0;
    return w >= TWO_WEEK_MIN_W;
  }
  function effMode(){ return mode === "two" && !twoOk() ? "week" : mode; }
  // куда переключит кнопка: список → неделя → две недели (если есть место) → список
  function nextMode(){
    var m = effMode();
    if(m === "list") return "week";
    if(m === "week") return twoOk() ? "two" : "list";
    return "list";
  }
  var fabTwoOk = false; // было ли место на две недели, когда рисовали нижний ряд (поворот экрана меняет кнопку режима)
  function fabRowHtml(){
    fabTwoOk = twoOk();
    var nm = nextMode();
    return '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarModeBtn" title="' + (nm === "list" ? "Режим: список" : (nm === "two" ? "Режим: две недели" : "Режим: неделя")) + '">' +
        (nm === "list" ? LIST_ICON_SVG : (nm === "two" ? TWO_ICON_SVG : WEEK_ICON_SVG)) + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarTrkBtn" title="' + (trackersOn ? 'Скрыть трекеры занятий' : 'Показать трекеры занятий') + '">' + (trackersOn ? TRK_ICON_SVG : TRK_OFF_ICON_SVG) + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarHiddenBtn" title="' + eyeTitle() + '">' + (showHidden() ? EYE_ICON_SVG : EYE_OFF_ICON_SVG) + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarColorBtn" title="Цвета календаря">' + COLOR_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarSettingsBtn" title="Настройки календаря">' + GEAR_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="calendarAddBtn" title="Новое мероприятие">' + PLUS_ICON_SVG + '</button>' +
      (window.LTFullscreen ? window.LTFullscreen.btnHtml("calendarFullscreenBtn") : '') + // полноэкранный режим — сразу слева от «домика»
      '<button type="button" class="mdeditor-fab-btn" id="calendarHomeBtn" title="Сегодня">' + HOME_ICON_SVG + '</button>' +
    '</div>';
  }
  function bindFab(){
    if(window.LTFullscreen) window.LTFullscreen.bind("calendarFullscreenBtn");
    document.getElementById("calendarAddBtn").addEventListener("click", function(){ weekRememberScroll(); openForm(null); });
    document.getElementById("calendarColorBtn").addEventListener("click", function(){ weekRememberScroll(); openColors(); });
    document.getElementById("calendarSettingsBtn").addEventListener("click", function(){ weekRememberScroll(); openSettings(); });
    document.getElementById("calendarHiddenBtn").addEventListener("click", function(){
      saveShowHidden(!showHidden());
      var hb = document.getElementById("calendarHiddenBtn");
      if(hb){ hb.innerHTML = showHidden() ? EYE_ICON_SVG : EYE_OFF_ICON_SVG; hb.title = eyeTitle(); }
      if(weekLike()){ weekRememberScroll(); renderWeek(); return; }
      refreshList();
    });
    document.getElementById("calendarTrkBtn").addEventListener("click", function(){
      trackersOn = !trackersOn;
      saveTrackersOn();
      var tb = document.getElementById("calendarTrkBtn");
      if(weekLike()){ weekRememberScroll(); renderWeek(); return; }
      refreshList(); // список: обновляется только содержимое, прокрутка остаётся
      if(tb){ tb.innerHTML = trackersOn ? TRK_ICON_SVG : TRK_OFF_ICON_SVG; tb.title = trackersOn ? "Скрыть трекеры занятий" : "Показать трекеры занятий"; }
    });
    document.getElementById("calendarModeBtn").addEventListener("click", function(){
      mode = nextMode();
      saveMode();
      weekStart = null; weekScrollKeep = null;
      renderMain();
    });
  }
  function renderMain(){
    if(extForm){ closeExtForm(); return; } // форма была открыта поверх заметки: выход из неё — обратно в заметку
    if(weekLike()) renderWeek(); else renderList();
  }
  // поворот экрана: «Неделя» ↔ «Две недели» по месту; кнопка режима и список сами пересчитывают, что дальше в круге
  var resizeTimer = null;
  function onResize(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      if(screen !== "week" || dragOn || !document.getElementById("calWeek")) return;
      var want = (mode === "two" && twoOk()) ? 14 : 7;
      if(want === wkN && twoOk() === fabTwoOk) return;
      weekRememberScroll();
      renderWeek();
    }, 200);
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  // ---------- экран «Неделя» ----------
  function mondayOf(ts){
    var d = new Date(ts);
    var back = (d.getDay() + 6) % 7; // пн = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 0, 0, 0, 0).getTime();
  }
  function dayStartAt(base, i){ var d = new Date(base); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 0, 0, 0, 0).getTime(); }
  function minutesOfDay(ts){ var d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
  function weekTitle(ws, n){
    var a = new Date(ws), b = new Date(dayStartAt(ws, (n || 7) - 1));
    if(a.getFullYear() !== b.getFullYear())
      return a.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " " + a.getFullYear() + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
    if(a.getMonth() !== b.getMonth())
      return a.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear();
    return a.getDate() + "–" + b.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " " + b.getFullYear();
  }
  // куски событий недели по дням: [день 0..6] → [{top,bottom (минуты), ev, at, dur}]
  function weekSegments(ws, n){
    n = n || 7;
    var days = [];
    for(var di = 0; di < n; di++) days.push([]);
    var weekEnd = dayStartAt(ws, n);
    load().forEach(function(ev){
      if(isTask(ev) && taskStateOf(ev) !== "open") return;
      var dur = Math.max(0, ev.end - ev.start);
      occurrenceStarts(ev, ws - dur, weekEnd).forEach(function(at){
        if(!visibleEv(ev, at)) return; // скрытое повторение серии — только если включён показ скрытых
        var end = at + dur;
        for(var i = 0; i < n; i++){
          var ds = dayStartAt(ws, i), de = dayStartAt(ws, i + 1);
          if(end <= ds && !(dur === 0 && at === ds)) continue;
          if(at >= de) continue;
          var top = at > ds ? minutesOfDay(at) : 0;
          var bottom = end >= de ? 1440 : minutesOfDay(end);
          if(isTask(ev)) bottom = Math.min(1440, top + TASK_BLOCK_MIN);
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
    var cluster = [], colEnds = [], colGrp = [], clusterEnd = -1;
    function flush(){
      for(var i = 0; i < cluster.length; i++) cluster[i].cols = colEnds.length;
      cluster = []; colEnds = []; colGrp = []; clusterEnd = -1;
    }
    segs.forEach(function(sg){
      var bottom = Math.max(sg.bottom, sg.top + minH);
      if(cluster.length && sg.top >= clusterEnd) flush();
      // тренировки, идущие подряд или внахлёст, не делят ширину: следующая рисуется поверх предыдущей в той же колонке
      var grp = (sg.t && sg.t.src === "workout") ? "workout" : "";
      var col = -1;
      for(var c = 0; c < colEnds.length; c++){ if(colEnds[c] <= sg.top || (grp && colGrp[c] === grp)){ col = c; break; } }
      if(col < 0){ col = colEnds.length; colEnds.push(0); colGrp.push(""); }
      colEnds[col] = Math.max(colEnds[col], bottom);
      colGrp[col] = grp;
      sg.col = col;
      cluster.push(sg);
      clusterEnd = Math.max(clusterEnd, bottom);
    });
    flush();
  }
  // колонка одного дня: блоки мероприятий/трекеров (раскладка пересечений) и красная линия «сейчас»; общая для недели и колонки в ежедневной заметке
  function dayColHtml(ds, daySegs, dayTrk, isToday, now, off){
    off = off || 0; // колонка в заметке показывает день не с 00:00, а с минуты off (dayWindowStart)
    // трекеры не делят ширину с мероприятиями: мероприятия раскладываются сами по себе, а трекеры — отдельно (между собой — по колонкам при
    // пересечении) и рисуются после мероприятий, то есть поверх них (ТЗ 22.11)
    var trkSegs = dayTrk ? dayTrk.slice() : [];
    var segs = daySegs.slice();
    if(visOverHidden()){
      // видимые мероприятия не замечают скрытые: раскладываются отдельно и рисуются после них, то есть поверх
      var hidSegs = [], visSegs = [];
      segs.forEach(function(sg){ (sg.ev && isHidden(sg.ev.id, sg.at) ? hidSegs : visSegs).push(sg); });
      packDay(hidSegs); packDay(visSegs);
      segs = hidSegs.concat(visSegs);
    } else packDay(segs);
    packDay(trkSegs);
    segs = segs.concat(trkSegs);
    var blocks = '';
    segs.forEach(function(sg){
      var top = (sg.top - off) * hourPx / 60;
      var h = Math.max(MIN_BLOCK_PX, (sg.bottom - sg.top) * hourPx / 60 - 1);
      var w = 100 / sg.cols, left = sg.col * w;
      var posCss = 'left:' + left.toFixed(2) + '%;width:calc(' + w.toFixed(2) + '% - 1px)';
      var tall = h >= 30;
      if(sg.t){
        blocks += '<div class="cal-wk-trk cal-trk-' + sg.t.src + '" data-t="' + sg.top + '" data-b="' + sg.bottom + '" data-txt="' + esc(trackerText(sg.t)) + '"' +
          ' style="top:' + top.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;' + posCss + ';' + trkBlockCss(sg.t.src) + '">' +
          esc(sg.t.label) + '</div>';
        return;
      }
      blocks += '<div class="cal-wk-ev cal-c-' + (isTask(sg.ev) ? 'task' : calOf(sg.ev)) + (isHidden(sg.ev.id, sg.at) ? ' cal-hid' : '') + (sg.at + sg.dur < now ? ' cal-wk-past' : '') + '" data-id="' + esc(sg.ev.id) + '" data-at="' + sg.at + '" data-e="' + (sg.at + sg.dur) + '"' +
        ' data-t="' + sg.top + '" data-b="' + sg.bottom + '" style="top:' + top.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;' + posCss + (sg.at + sg.dur < now && usePastColor(isHidden(sg.ev.id, sg.at)) ? ';' + pastBlockCss() : '') + '">' +
        esc(sg.ev.title) + '</div>';
    });
    var nowLine = isToday ? '<div class="cal-wk-now" data-m="' + minutesOfDay(now) + '" style="top:' + ((minutesOfDay(now) - off) * hourPx / 60).toFixed(1) + 'px"></div>' : '';
    return '<div class="cal-wk-col' + (isToday ? ' cal-wk-today-col' : '') + '" data-day="' + ds + '">' + blocks + nowLine + '</div>';
  }
  function weekHtml(ws){
    var now = Date.now(), todayKey = dateValue(now);
    var segsByDay = weekSegments(ws, wkN);
    var trkByDay = trackersOn ? weekTrackerSegments(ws, wkN) : null;
    var head = '<div class="cal-wk-head"><div class="cal-wk-gutter"></div>';
    var cols = '';
    for(var i = 0; i < wkN; i++){
      var ds = dayStartAt(ws, i), isToday = dateValue(ds) === todayKey;
      var sep = i === 7; // вторая неделя в режиме «Две недели» — с жирной границей слева
      head += '<div class="cal-wk-dayh' + (isToday ? ' cal-wk-today' : '') + (sep ? ' cal-wk-wk2' : '') + '" data-day="' + ds + '"><span>' + WEEKDAYS[i % 7] + '</span><b>' + new Date(ds).getDate() + '</b></div>';
      var colHtml = dayColHtml(ds, segsByDay[i], trkByDay ? trkByDay[i] : null, isToday, now);
      cols += sep ? colHtml.replace("cal-wk-col", "cal-wk-col cal-wk-wk2") : colHtml;
    }
    head += '</div>';
    var labels = '';
    for(var h2 = 1; h2 < 24; h2++) labels += '<span data-h="' + h2 + '" style="top:' + (h2 * hourPx - 6) + 'px">' + pad2(h2) + ':00</span>';
    return '<div class="cal-wk-top">' +
        '<div class="cal-wk-nav">' +
          (wkN === 7 ? '<button type="button" class="cal-wk-btn" id="calWkPrev" title="Предыдущая неделя">‹</button>' : '') +
          '<div class="cal-wk-title">' + weekTitle(ws, wkN) + '</div>' +
          (wkN === 7 ? '<button type="button" class="cal-wk-btn" id="calWkNext" title="Следующая неделя">›</button>' : '') +
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
  // Красная линия «сейчас» и пометка прошедших событий (класс и выбранный цвет) на уже нарисованной неделе. Зовётся раз в 30 с, при возврате
  // на страницу и из my.js (`__ltOnAppResume`). Сменился день — неделя перерисовывается (прокрутка сохраняется).
  function weekNowTick(){
    if(screen !== "week" || !weekLike() || dragOn) return;
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
      if(e){
        list[i].classList.toggle("cal-wk-past", e < now);
        if(e < now && usePastColor(list[i].classList.contains("cal-hid"))) paintPastBlock(list[i]);
      }
    }
  }
  setInterval(weekNowTick, 30000);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) weekNowTick(); });
  window.addEventListener("focus", weekNowTick);
  window.addEventListener("pageshow", weekNowTick);
  function weekRememberScroll(){
    var c = container();
    weekScrollKeep = (weekLike() && c) ? c.scrollTop : null;
  }
  function renderWeek(){
    var c = container();
    if(!c) return;
    screen = "week";
    expanded = {};
    clearTimeout(tapTimer); tapTimer = null;
    var cur = mondayOf(Date.now());
    wkN = (mode === "two" && twoOk()) ? 14 : 7;
    if(weekStart === null || wkN === 14) weekStart = cur; // «Две недели» — всегда текущая и следующая
    var ws = weekStart;
    c.innerHTML = '<div class="cal-week' + (wkN === 14 ? ' cal-wk-two' : '') + '" id="calWeek">' + weekHtml(ws) + '</div>' + fabRowHtml();
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
    var prevBtn = document.getElementById("calWkPrev"), nextBtn = document.getElementById("calWkNext");
    if(prevBtn) prevBtn.addEventListener("click", function(){ shift(-1); });
    if(nextBtn) nextBtn.addEventListener("click", function(){ shift(1); });
    document.getElementById("calendarHomeBtn").addEventListener("click", function(){ if(slide) return; weekStart = null; weekScrollKeep = null; weekScrollToNow = true; renderWeek(); });
    var wk = document.getElementById("calWeek");
    wk.addEventListener("click", function(e){
      if(Date.now() - pinchEndedAt < 350) return; // тап, оставшийся от щипка
      var trk = e.target.closest ? e.target.closest(".cal-wk-trk") : null;
      if(trk){ trackerToast(trk.getAttribute("data-txt") || ""); return; }
      // дата любого дня в шапке недели: открыть заметку этого дня (нет — создать)
      var dayHead = e.target.closest ? e.target.closest(".cal-wk-dayh") : null;
      if(dayHead){ if(OPEN_TODAY){ try{ OPEN_TODAY(+dayHead.getAttribute("data-day")); }catch(err){ console.error(err); } } return; }
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
    var drag = null; // идёт перетаскивание: {ev, at, blk, ghost, ...}
    // жесты: один палец — свайп недели; два пальца по вертикали — щипок (размер сетки)
    var sx = 0, sy = 0, tracking = false, lock = null, t0 = 0, lastDx = 0; // lock: null | "h" (листаем неделю) | "v" (обычная прокрутка)
    var pinch = null; // {gap0, px0, anchor (минуты под серединой пальцев)}
    function gapOf(t){ return Math.abs(t[0].clientY - t[1].clientY); }
    function midOf(t){ return (t[0].clientY + t[1].clientY) / 2; }
    wk.addEventListener("touchstart", function(e){
      if(drag){ if(e.touches && e.touches.length > 1) dragEnd(false); return; } // второй палец — перетаскивание отменяется
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
      if(drag){ var dt = e.touches && e.touches[0]; if(dt) dragMove(dt.clientX, dt.clientY); if(e.cancelable) e.preventDefault(); return; }
      if(!pinch && tracking && lock !== "v" && e.touches && e.touches.length === 1){
        var mdx = e.touches[0].clientX - sx, mdy = e.touches[0].clientY - sy;
        if(lock === null && (Math.abs(mdx) > 8 || Math.abs(mdy) > 8)){
          lock = (wkN === 7 && Math.abs(mdx) > Math.abs(mdy) * 1.4) ? "h" : "v"; // в «Двух неделях» листать нечего: жест — обычная прокрутка
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
      if(drag){ if(!e.touches || e.touches.length === 0) dragEnd(true); return; }
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
      if(drag){ dragEnd(false); return; }
      tracking = false; lock = null;
      if(slide && !slide.finishing) slideFinish(false);
    }, { passive: true });
    // Ctrl+колесо мыши и щипок по тачпаду (браузер присылает его как wheel с ctrlKey) — размер часа, как щипок двумя пальцами;
    // точка под курсором остаётся на месте, сохранение и перерисовка — когда колесо замолчит
    var wheelTimer = null;
    wk.addEventListener("wheel", function(e){
      if(!e.ctrlKey || drag || slide || pinch) return;
      var body = document.getElementById("calWkBody");
      if(!body) return;
      e.preventDefault();
      var anchor = (e.clientY - body.getBoundingClientRect().top) / hourPx;
      var dy = Math.max(-30, Math.min(30, e.deltaY));
      applyZoom(hourPx * Math.exp(-dy * 0.01));
      c.scrollTop += body.getBoundingClientRect().top + anchor * hourPx - e.clientY;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function(){
        wheelTimer = null;
        if(!document.getElementById("calWeek")) return;
        pinchEndedAt = Date.now();
        try{ localStorage.setItem(ZOOM_KEY, String(hourPx)); }catch(err){}
        weekScrollKeep = c.scrollTop;
        renderWeek();
      }, 250);
    }, { passive: false });

    // ----- перетаскивание: долгое удержание блока мероприятия/задачи, дальше блок-копия идёт за пальцем, по отпусканию — на новое место -----
    // Рамка — видимые дни и сутки (на другую неделю не утащить); день берётся по пальцу, время — по верху блока со сдвигом DRAG_SNAP_MIN минут.
    function dragStart(blk){
      if(drag || slide || pinch || lock !== null) return;
      var ev = findEvent(blk.getAttribute("data-id"));
      if(!ev || !canEdit(ev)) return; // общее мероприятие читателя группы не двигается
      var box = wk.querySelector(".cal-wk-cols"), body = document.getElementById("calWkBody");
      var colEls = box ? box.querySelectorAll(".cal-wk-col") : null;
      if(!box || !body || !colEls || colEls.length !== wkN) return;
      var origIdx = -1;
      for(var i = 0; i < colEls.length; i++) if(colEls[i] === blk.parentNode) origIdx = i;
      if(origIdx < 0) return;
      var r = blk.getBoundingClientRect(), t = lastTouch;
      var ghost = blk.cloneNode(false);
      ghost.removeAttribute("data-id"); ghost.removeAttribute("data-at");
      ghost.className += " cal-wk-ghost";
      var gw = Math.max(r.width, 64);
      ghost.innerHTML = '<span></span><span class="cal-wk-et"></span>';
      ghost.firstChild.textContent = ev.title;
      ghost.style.width = gw + "px"; ghost.style.height = r.height + "px";
      wk.style.position = "relative";
      wk.appendChild(ghost);
      blk.classList.add("cal-wk-dragging");
      dragOn = true; tracking = false; lock = null;
      drag = {
        ev: ev, at: +blk.getAttribute("data-at"), blk: blk, ghost: ghost, box: box, body: body, colEls: colEls, hi: -1,
        origIdx: origIdx, origTop: +blk.getAttribute("data-t"), dur: Math.max(0, ev.end - ev.start),
        w: gw, h: r.height, gx: (t ? t.x : r.left) - r.left, gy: (t ? t.y : r.top) - r.top,
        x: t ? t.x : r.left, y: t ? t.y : r.top, dayDiff: 0, minDiff: 0, newStart: 0, timer: null
      };
      drag.timer = setInterval(dragScroll, 30);
      try{ if(navigator.vibrate) navigator.vibrate(20); }catch(err){}
      dragMove(drag.x, drag.y);
    }
    function dragMove(x, y){
      var d = drag;
      if(!d) return;
      d.x = x; d.y = y;
      var cr = d.box.getBoundingClientRect(), br = d.body.getBoundingClientRect(), wr = wk.getBoundingClientRect();
      var gx = Math.max(cr.left, Math.min(cr.right - d.w, x - d.gx));
      var gy = Math.max(br.top, Math.min(br.bottom - d.h, y - d.gy));
      d.ghost.style.left = (gx - wr.left) + "px";
      d.ghost.style.top = (gy - wr.top) + "px";
      var idx = Math.max(0, Math.min(wkN - 1, Math.floor((x - cr.left) / (cr.width / wkN))));
      var raw = (gy - br.top) * 60 / hourPx - d.origTop;
      var minDiff = Math.round(raw / DRAG_SNAP_MIN) * DRAG_SNAP_MIN;
      minDiff = Math.max(-d.origTop, Math.min(1435 - d.origTop, minDiff));
      d.dayDiff = idx - d.origIdx; d.minDiff = minDiff;
      var a = new Date(d.at);
      d.newStart = new Date(a.getFullYear(), a.getMonth(), a.getDate() + d.dayDiff, a.getHours(), a.getMinutes() + minDiff).getTime();
      if(d.hi !== idx){
        if(d.hi >= 0) d.colEls[d.hi].classList.remove("cal-wk-drop");
        d.colEls[idx].classList.add("cal-wk-drop");
        d.hi = idx;
      }
      var lab = d.ghost.lastChild;
      if(lab) lab.textContent = WEEKDAYS[(new Date(d.newStart).getDay() + 6) % 7] + " " + (isTask(d.ev) ? timeValue(d.newStart) : timeRange(d.newStart, d.dur));
    }
    // у верхнего/нижнего края окна сетка сама прокручивается
    function dragScroll(){
      var d = drag;
      if(!d) return;
      var cb = c.getBoundingClientRect(), top = c.querySelector(".cal-wk-top"), headH = top ? top.getBoundingClientRect().height : 0;
      var dy = 0;
      if(d.y < cb.top + headH + 36) dy = -10; else if(d.y > cb.bottom - 96) dy = 10;
      if(!dy) return;
      var before = c.scrollTop;
      c.scrollTop = before + dy;
      if(c.scrollTop !== before) dragMove(d.x, d.y);
    }
    function dragEnd(commit){
      var d = drag;
      if(!d) return;
      drag = null; dragOn = false;
      mouseDragOff();
      clearInterval(d.timer);
      if(d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      d.blk.classList.remove("cal-wk-dragging");
      if(d.hi >= 0) d.colEls[d.hi].classList.remove("cal-wk-drop");
      wk.style.position = "";
      pinchEndedAt = Date.now(); // click, оставшийся от жеста, не открывает форму
      if(!commit || (!d.dayDiff && !d.minDiff)) return;
      moveEventTo(d.ev, d.at, d.newStart);
    }
    // мышь / тачпад: блок удержан левой кнопкой (LTPress, via:"mouse") — дальше он идёт за курсором, отпускание кнопки кладёт его на место,
    // Esc отменяет. Слушатели висят на document только на время переноса (курсор может выйти за пределы недели).
    function mouseDragMove(e){ if(!drag) return; if(e.cancelable) e.preventDefault(); dragMove(e.clientX, e.clientY); }
    function mouseDragUp(){ mouseDragOff(); if(drag) dragEnd(true); }
    function mouseDragKey(e){ if(e.key === "Escape"){ mouseDragOff(); if(drag) dragEnd(false); } }
    function mouseDragOn(){
      document.addEventListener("mousemove", mouseDragMove, true);
      document.addEventListener("mouseup", mouseDragUp, true);
      document.addEventListener("keydown", mouseDragKey, true);
    }
    function mouseDragOff(){
      document.removeEventListener("mousemove", mouseDragMove, true);
      document.removeEventListener("mouseup", mouseDragUp, true);
      document.removeEventListener("keydown", mouseDragKey, true);
    }
    var lastTouch = null; // где палец/курсор: onLong от LTPress отдаёт координаты начала удержания
    if(window.LTPress){
      LTPress.bind(wk, { sel: ".cal-wk-ev", ms: DRAG_MS, blockAll: true, onLong: function(info){
        if(info.via === "context") return; // правая кнопка / клавиша «Меню»: переноса нет
        lastTouch = { x: info.x, y: info.y };
        dragStart(info.el);
        lastTouch = null;
        if(drag && info.via === "mouse") mouseDragOn();
      } });
    }
    var goNow = weekScrollToNow; weekScrollToNow = false;
    scrollWeek(c, goNow);
  }
  // isNow — только после «домика»: прокрутить к красной линии; иначе (открытие вкладки, листание) день виден с 8:00
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

  // ---------- колонка дня в ежедневной заметке (см. шапку) ----------
  function loadZoom(){
    try{
      var z = parseFloat(localStorage.getItem(ZOOM_KEY));
      hourPx = isFinite(z) ? clampHour(z) : HOUR_DEFAULT;
    }catch(e){ hourPx = HOUR_DEFAULT; }
  }
  // закрыть форму, открытую поверх заметки: вернуть `screen`, убрать слой, перерисовать колонку
  function closeExtForm(){
    var f = extForm;
    if(!f) return;
    extForm = null;
    if(f.el.parentNode) f.el.parentNode.removeChild(f.el);
    screen = f.prevScreen;
    try{ f.onClose(); }catch(e){}
  }
  // С какой минуты дня показывать колонку в заметке: с первого ещё не закончившегося мероприятия дня за вычетом 2 часов (сегодня; если все прошли — с первого за день),
  // но не больше 2 пустых часов сверху. Скрытые на этом устройстве мероприятия не считаются; нет ни одного нескрытого мероприятия — возвращает -1 (колонка не показывается).
  var DAYCOL_LEAD_MIN = 120;
  function dayWindowStart(segs, isToday, now){
    var first = -1, firstAny = -1;
    segs.forEach(function(sg){
      if(!sg.ev || isHidden(sg.ev.id, sg.at)) return; // трекеры и скрытые мероприятия окно не двигают
      if(firstAny < 0 || sg.top < firstAny) firstAny = sg.top;
      var over = isToday && (sg.at + sg.dur < now); // как пометка .cal-wk-past
      if(!over && (first < 0 || sg.top < first)) first = sg.top;
    });
    var m = first >= 0 ? first : firstAny;
    if(m < 0) return -1;
    return m > DAYCOL_LEAD_MIN ? Math.floor(m) - DAYCOL_LEAD_MIN : 0;
  }
  function mountDayColumn(host, opts){
    if(!host) return null;
    opts = opts || {};
    try{ if(window.__ltEnsureCalendarStore) window.__ltEnsureCalendarStore(); }catch(e){} // хранилище и трекеры готовит my.js (до открытия вкладки «Календарь» их нет)
    importLegacy(); hiddenIds = null; loadTrackersOn(); loadColors(); applyUserColors(); loadZoom(); dayColSig = sigNow();
    var stale = host.querySelector(".cal-daycol");
    if(stale && stale.parentNode) stale.parentNode.removeChild(stale);
    var day = startOfDay(opts.day || Date.now());
    var el = document.createElement("div");
    el.className = "cal-daycol";
    host.insertBefore(el, host.firstChild);
    host.classList.add("daycal-on");
    var dead = false, sig = "", wasToday = false, pinch = null, timer = null, ctl = null, winOff = 0;

    function signature(){
      return JSON.stringify(load()) + "|" + (trackersOn ? JSON.stringify(trackerItems(day, dayStartAt(day, 1))) : "") + "|" + (showHidden() ? 1 : 0) + "|" + hourPx;
    }
    function draw(){
      if(dead) return;
      var now = Date.now(), isToday = dateValue(day) === dateValue(now);
      wasToday = isToday;
      var segs = weekSegments(day, 1)[0];
      var trk = trackersOn ? weekTrackerSegments(day, 1)[0] : null;
      winOff = dayWindowStart(segs, isToday, now);
      if(winOff < 0){ // в этот день нет нескрытых мероприятий — колонку не показываем, заметка идёт на всю ширину
        var wasShown = el.style.display !== "none";
        el.innerHTML = "";
        el.style.display = "none";
        host.classList.remove("daycal-on");
        sig = signature();
        if(wasShown && opts.onLayout){ try{ opts.onLayout(); }catch(e){} }
        return;
      }
      var wasHidden = el.style.display === "none";
      el.style.display = "";
      host.classList.add("daycal-on");
      var labels = "";
      for(var h = 1; h < 24; h++){
        if(h * 60 <= winOff) continue;
        labels += '<span data-h="' + h + '" style="top:' + (((h * 60 - winOff) * hourPx / 60) + 1) + 'px">' + pad2(h) + ':00</span>';
      }
      el.innerHTML = '<div class="cal-dc-body" style="height:' + ((1440 - winOff) * hourPx / 60) + 'px;overflow:hidden;background-size:100% ' + hourPx + 'px;background-position:0 ' + (((60 - winOff % 60) % 60) * hourPx / 60) + 'px">' +
        '<div class="cal-dc-labels">' + labels + '</div>' + dayColHtml(day, segs, trk, isToday, now, winOff) + '</div>';
      applyCalColors(el);
      sig = signature();
      if(wasHidden && opts.onLayout){ try{ opts.onLayout(); }catch(e){} } // колонка появилась — редактор перемерить
    }
    // красная линия «сейчас» и пометка прошедших — на месте; изменились данные или сменился «сегодня» — полная перерисовка
    function tick(){
      if(dead) return;
      if(!document.body.contains(el)){ destroy(); return; } // заметку закрыли/перерисовали — колонка не нужна
      if(extForm) return;
      var now = Date.now();
      var nowToday = dateValue(day) === dateValue(now);
      if(signature() !== sig || nowToday !== wasToday || dayWindowStart(weekSegments(day, 1)[0], nowToday, now) !== winOff){ draw(); return; }
      var i, m = minutesOfDay(now), list = el.querySelectorAll(".cal-wk-now");
      for(i = 0; i < list.length; i++){
        list[i].setAttribute("data-m", String(m));
        list[i].style.top = ((m - winOff) * hourPx / 60).toFixed(1) + "px";
      }
      list = el.querySelectorAll(".cal-wk-ev");
      for(i = 0; i < list.length; i++){
        var e = +list[i].getAttribute("data-e");
        if(e){
          list[i].classList.toggle("cal-wk-past", e < now);
          if(e < now && usePastColor(list[i].classList.contains("cal-hid"))) paintPastBlock(list[i]);
        }
      }
    }
    function destroy(){
      if(dead) return;
      dead = true;
      // редактор мог просто пересобраться (возврат в приложение): открытую форму не трогаем, но если новой колонки так и не появилось — убираем её
      if(extForm && extForm.owner === ctl) setTimeout(function(){ if(extForm && extForm.owner === ctl && !dayCols.length) closeExtForm(); }, 1500);
      clearInterval(timer);
      var k = dayCols.indexOf(ctl);
      if(k >= 0) dayCols.splice(k, 1);
      if(el.parentNode) el.parentNode.removeChild(el);
      host.classList.remove("daycal-on");
    }
    // форма мероприятия — слоем поверх окна (редактор заметки под ней не перерисовывается)
    function openOver(fn){
      if(extForm || dead) return;
      var box = null, n = el.parentNode;
      while(n && n !== document.body){
        if(n.classList && n.classList.contains("settings-modal-box")){ box = n; break; }
        n = n.parentNode;
      }
      if(!box) return;
      if(opts.beforeForm){ try{ opts.beforeForm(); }catch(e){} }
      var ov = document.createElement("div");
      ov.className = "cal-dayform";
      box.appendChild(ov);
      extForm = { el: ov, prevScreen: screen, owner: ctl, onClose: function(){ dayCols.slice().forEach(function(c){ c.refresh(); }); } };
      try{ fn(); }catch(err){ closeExtForm(); }
    }
    el.addEventListener("click", function(e){
      if(Date.now() - pinchEndedAt < 350) return; // тап, оставшийся от щипка
      var trkEl = e.target.closest ? e.target.closest(".cal-wk-trk") : null;
      if(trkEl){ trackerToast(trkEl.getAttribute("data-txt") || ""); return; }
      var blk = e.target.closest ? e.target.closest(".cal-wk-ev") : null;
      if(blk){
        var ev = findEvent(blk.getAttribute("data-id"));
        if(!ev) return;
        var at = +blk.getAttribute("data-at");
        openOver(function(){ openForm(ev, at); });
        return;
      }
      var col = e.target.closest ? e.target.closest(".cal-wk-col") : null;
      if(!col) return;
      // пустое место: новое мероприятие на этот день, начало — начало нажатого часа
      var hour = Math.max(0, Math.min(23, Math.floor((winOff + (e.clientY - col.getBoundingClientRect().top) * 60 / hourPx) / 60)));
      var d = new Date(+col.getAttribute("data-day"));
      var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0).getTime();
      openOver(function(){ openForm(null, null, start); });
    });
    // щипок двумя пальцами по вертикали — размер часа (как в неделе); один палец — обычная прокрутка заметки
    function applyDayZoom(px){
      hourPx = clampHour(px);
      var body = el.querySelector(".cal-dc-body");
      if(body){ body.style.height = ((1440 - winOff) * hourPx / 60) + "px"; body.style.backgroundSize = "100% " + hourPx + "px"; body.style.backgroundPosition = "0 " + (((60 - winOff % 60) % 60) * hourPx / 60) + "px"; }
      var i, list = el.querySelectorAll(".cal-dc-labels span");
      for(i = 0; i < list.length; i++) list[i].style.top = (((+list[i].getAttribute("data-h") * 60 - winOff) * hourPx / 60) + 1) + "px";
      list = el.querySelectorAll(".cal-wk-ev, .cal-wk-trk");
      for(i = 0; i < list.length; i++){
        var t = +list[i].getAttribute("data-t"), b = +list[i].getAttribute("data-b");
        list[i].style.top = ((t - winOff) * hourPx / 60).toFixed(1) + "px";
        list[i].style.height = Math.max(MIN_BLOCK_PX, (b - t) * hourPx / 60 - 1).toFixed(1) + "px";
      }
      list = el.querySelectorAll(".cal-wk-now");
      for(i = 0; i < list.length; i++) list[i].style.top = ((+list[i].getAttribute("data-m") - winOff) * hourPx / 60).toFixed(1) + "px";
    }
    function gapOf(t){ return Math.abs(t[0].clientY - t[1].clientY); }
    function midOf(t){ return (t[0].clientY + t[1].clientY) / 2; }
    el.addEventListener("touchstart", function(e){
      if(!e.touches || e.touches.length !== 2){ if(e.touches && e.touches.length > 2) pinch = null; return; }
      var g = gapOf(e.touches), body = el.querySelector(".cal-dc-body");
      pinch = (g >= PINCH_MIN_GAP && body) ? { gap0: g, px0: hourPx, anchor: (midOf(e.touches) - body.getBoundingClientRect().top) / hourPx } : null;
    }, { passive: true });
    el.addEventListener("touchmove", function(e){
      if(!pinch || !e.touches || e.touches.length !== 2) return;
      if(e.cancelable) e.preventDefault();
      applyDayZoom(pinch.px0 * Math.max(gapOf(e.touches), 1) / pinch.gap0);
      var body = el.querySelector(".cal-dc-body"), sc = document.getElementById("settingsTabContent");
      if(body && sc) sc.scrollTop += body.getBoundingClientRect().top + pinch.anchor * hourPx - midOf(e.touches); // точка под пальцами остаётся на месте
    }, { passive: false });
    el.addEventListener("touchend", function(e){
      if(!pinch || (e.touches && e.touches.length >= 2)) return;
      pinch = null;
      pinchEndedAt = Date.now();
      try{ localStorage.setItem(ZOOM_KEY, String(hourPx)); }catch(err){}
      draw(); // перерисовка: пересчёт раскладки пересекающихся блоков под новую высоту
    }, { passive: true });
    el.addEventListener("touchcancel", function(){ pinch = null; }, { passive: true });
    // Ctrl+колесо мыши и щипок по тачпаду — размер часа (как щипок двумя пальцами)
    var dayWheelTimer = null;
    el.addEventListener("wheel", function(e){
      if(!e.ctrlKey || pinch) return;
      var body = el.querySelector(".cal-dc-body"), sc = document.getElementById("settingsTabContent");
      if(!body || !sc) return;
      e.preventDefault();
      var anchor = (e.clientY - body.getBoundingClientRect().top) / hourPx;
      var dy = Math.max(-30, Math.min(30, e.deltaY));
      applyDayZoom(hourPx * Math.exp(-dy * 0.01));
      sc.scrollTop += body.getBoundingClientRect().top + anchor * hourPx - e.clientY;
      clearTimeout(dayWheelTimer);
      dayWheelTimer = setTimeout(function(){
        dayWheelTimer = null;
        if(dead) return;
        pinchEndedAt = Date.now();
        try{ localStorage.setItem(ZOOM_KEY, String(hourPx)); }catch(err){}
        draw();
      }, 250);
    }, { passive: false });

    ctl = { tick: tick, destroy: destroy, refresh: draw };
    dayCols.push(ctl);
    timer = setInterval(tick, 30000);
    draw();
    return ctl;
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
    document.getElementById("calendarHomeBtn").addEventListener("click", function(){
      expanded = {};
      refreshList();
      var cc = container();
      if(cc) cc.scrollTop = 0;
    });
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
  // вопрос после перетаскивания повторяющегося мероприятия: cb(true) — это и все последующие, cb(false) — только это; «Отмена» ничего не меняет
  function askMoveScope(cb){
    var old = document.getElementById("calMoveScope");
    if(old && old.parentNode) old.parentNode.removeChild(old);
    var ov = document.createElement("div");
    ov.id = "calMoveScope";
    ov.className = "cal-scope-ov";
    ov.innerHTML = '<div class="cal-scope-box"><div class="item-form-hint">Это повторяющееся мероприятие. Перенести:</div>' +
      '<button type="button" class="workbooks-run-btn" data-a="one">Только это</button>' +
      '<button type="button" class="workbooks-run-btn" data-a="all">Это и все последующие</button>' +
      '<button type="button" class="workbooks-run-btn" data-a="no">Отмена</button></div>';
    ov.addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest("button") : null;
      if(!b && e.target !== ov) return;
      var a = b ? b.getAttribute("data-a") : "no";
      if(ov.parentNode) ov.parentNode.removeChild(ov);
      if(a === "one") cb(false); else if(a === "all") cb(true);
    });
    document.body.appendChild(ov);
  }
  // перетащенное в «Неделе» / «Двух неделях» мероприятие или задачу — на новое начало `newStart` (длительность сохраняется; у задачи начало = конец).
  // at — начало того повторения, которое тащили (у серии)
  function moveEventTo(ev, at, newStart){
    var dur = Math.max(0, ev.end - ev.start);
    var newEnd = isTask(ev) ? newStart : newStart + dur;
    function done(){
      if(screen !== "week" || !weekLike()) return;
      var c = container();
      if(c) weekScrollKeep = c.scrollTop;
      renderWeek();
    }
    if(isTask(ev) || !ev.repeat){
      var list = load(), rec = JSON.parse(JSON.stringify(ev));
      rec.start = newStart; rec.end = newEnd; rec.updatedAt = Date.now();
      if(!replaceInList(list, rec)) return;
      save(list);
      done();
      return;
    }
    askMoveScope(function(following){
      var hide = isHidden(ev.id, at); // скрытое повторение остаётся скрытым на новом месте
      var nid = following ? applyFollowing(ev, at, ev.title, newStart, newEnd, ev.repeat, calOf(ev)) : applyOnlyThis(ev, at, ev.title, newStart, newEnd, calOf(ev));
      setHidden(nid, hide);
      done();
    });
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
      '<h3 class="common-tab-title" id="calFormTitle">' + (isNew ? "Новое мероприятие" : (isTask(ev) ? "Задача" : "Мероприятие")) + '</h3>' +
      (isNew && TASKS ? '<div class="item-form-buttons cal-kind" id="calKind"><button type="button" class="workbooks-run-btn cal-kind-on" id="calKindEv">Мероприятие</button><button type="button" class="workbooks-run-btn" id="calKindTask">Задача</button></div>' : '') +
      '<input type="text" class="mdeditor-cleanup-input item-form-title" id="calTitle" placeholder="Название мероприятия" maxlength="120" autocomplete="off">' +
      '<div class="cal-field" id="calImgField" style="display:none"><div class="cal-img-row" id="calImgRow"></div><button type="button" class="workbooks-run-btn cal-attach-btn" id="calAttach"></button></div>' +
      '<div class="cal-field"><div class="item-form-hint">Начало</div><div class="cal-dt">' +
        '<input type="date" class="mdeditor-cleanup-input" id="calStartDate" aria-label="Дата начала">' +
        '<input type="time" class="mdeditor-cleanup-input" id="calStartTime" aria-label="Время начала">' +
      '</div></div>' +
      '<div class="cal-field" id="calEndField"><div class="item-form-hint">Окончание</div><div class="cal-dt">' +
        '<input type="date" class="mdeditor-cleanup-input" id="calEndDate" aria-label="Дата окончания">' +
        '<input type="time" class="mdeditor-cleanup-input" id="calEndTime" aria-label="Время окончания">' +
      '</div></div>' +
      '<div class="cal-field" id="calRepField"><div class="item-form-hint">Повторения</div>' +
        '<select class="mdeditor-cleanup-input" id="calRepeat"><option value="">Не повторять</option>' +
        REPEATS.map(function(r){ return '<option value="' + r.key + '">' + r.label + '</option>'; }).join("") +
        '</select></div>' +
      '<div class="cal-field" id="calCalField"><div class="item-form-hint">Календарь</div>' +
        '<select class="mdeditor-cleanup-input" id="calCal">' +
        CALS.map(function(k){ return '<option value="' + k.key + '">' + k.label + '</option>'; }).join("") +
        '</select></div>' +
      '<div class="cal-field" id="calVisField"><div class="item-form-hint">Отображение</div>' +
        '<select class="mdeditor-cleanup-input" id="calVis"><option value="show">Показать</option><option value="hide">Скрыть</option></select></div>' +
      '<div class="item-form-error" id="calError"></div>' +
      '<div class="cal-scope" id="calScope" style="display:none"></div>' +
      '<div class="item-form-buttons" id="calBtns">' +
        '<button type="button" class="workbooks-run-btn" id="calSave">Сохранить</button>' +
        '<button type="button" class="workbooks-run-btn" id="calCancel">Отмена</button>' +
      '</div>' +
      (isNew ? '' : '<div class="item-form-buttons" id="calDelRow"><button type="button" class="workbooks-run-btn" id="calDelete">Удалить</button>' + (isTask(ev) ? '<button type="button" class="workbooks-run-btn" id="calDone">Выполнена</button>' : '') + '</div>') +
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
      visEl.value = isHidden(ev.id, baseS) ? "hide" : "show";
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

    // режим «Задача»: только название, дата и время; сама задача создаётся на вкладке «Ожидание»
    var taskMode = isTask(ev);
    // Картинки задачи («скрепка») — те же, что у задачи на вкладках задач: живут в её тексте, календарь только показывает и меняет их через TASKS
    var imgs = [], taskInfo = null;
    if(ev && isTask(ev) && TASKS && TASKS.get){ try{ taskInfo = TASKS.get(ev.taskId); }catch(e){ taskInfo = null; } }
    if(taskInfo){
      imgs = taskInfo.images.slice();
      titleEl.value = taskInfo.title || ""; // название берётся из самой задачи (его могли поправить на вкладке задач)
    }
    var imgsStart = imgs.join("\n");
    var canAttach = !!(TASKS && TASKS.pickImage) && !readOnly;
    var imgRowEl = document.getElementById("calImgRow"), attachBtn = document.getElementById("calAttach");
    function renderImgs(){
      if(!imgRowEl) return;
      var ph = (TASKS && TASKS.attachIcon) || "";
      imgRowEl.innerHTML = imgs.map(function(n, i){
        return '<span class="cal-img-item"><span class="task-img-wrap" data-img-name="' + esc(n) + '">' + ph + '</span>' +
          '<button type="button" class="cal-img-del" data-i="' + i + '" aria-label="Убрать картинку">\u00d7</button></span>';
      }).join("");
    }
    if(imgRowEl) imgRowEl.addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest(".cal-img-del") : null;
      if(!b) return;
      imgs.splice(parseInt(b.getAttribute("data-i"), 10), 1);
      renderImgs();
    });
    if(attachBtn){
      attachBtn.innerHTML = ((TASKS && TASKS.attachIcon) || "") + '<span>Прикрепить картинку</span>';
      attachBtn.addEventListener("click", function(){
        TASKS.pickImage().then(function(name){
          if(name && imgs.indexOf(name) < 0){ imgs.push(name); renderImgs(); }
        });
      });
    }
    renderImgs();
    function applyKind(){
      var hide = taskMode ? "none" : "";
      ["calEndField", "calRepField", "calCalField", "calVisField"].forEach(function(id){
        var el = document.getElementById(id); if(el) el.style.display = hide;
      });
      var imgField = document.getElementById("calImgField");
      if(imgField) imgField.style.display = (taskMode && canAttach) ? "" : "none";
      var hd = document.getElementById("calFormTitle");
      if(hd && isNew) hd.textContent = taskMode ? "Новая задача" : "Новое мероприятие";
      titleEl.placeholder = taskMode ? "Название задачи" : "Название мероприятия";
      var b1 = document.getElementById("calKindEv"), b2 = document.getElementById("calKindTask");
      if(b1 && b2){ b1.className = "workbooks-run-btn" + (taskMode ? "" : " cal-kind-on"); b2.className = "workbooks-run-btn" + (taskMode ? " cal-kind-on" : ""); }
    }
    var kEv = document.getElementById("calKindEv"), kTask = document.getElementById("calKindTask");
    if(kEv) kEv.addEventListener("click", function(){ taskMode = false; applyKind(); });
    if(kTask) kTask.addEventListener("click", function(){ taskMode = true; applyKind(); });
    applyKind();

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
      if(taskMode && !readOnly){
        var ttl = titleEl.value.replace(/^\s+|\s+$/g, "");
        if(!ttl && !imgs.length) return fail("Введите название или прикрепите картинку"); // ссылка на картинку — тоже содержимое задачи
        var ts = parseLocal(sd.value, st.value);
        if(isNaN(ts)) return fail("Укажите дату и время");
        if(!TASKS) return fail("Задачи недоступны");
        var tl = load(), trec;
        if(ev){
          trec = { id: ev.id, title: ttl || IMG_ONLY_TITLE, start: ts, end: ts, repeat: "", cal: "personal", kind: "task", taskId: ev.taskId, updatedAt: Date.now() };
          var curTitle = taskInfo ? taskInfo.title : ev.title;
          if(ttl !== curTitle || imgs.join("\n") !== imgsStart){
            try{ if(TASKS.update) TASKS.update(ev.taskId, ttl, imgs); else TASKS.rename(ev.taskId, ttl); }catch(e){}
          }
        } else {
          var tid = null;
          try{ tid = TASKS.add(ttl, imgs); }catch(e){ tid = null; }
          if(!tid) return fail("Не удалось создать задачу");
          trec = { id: newId(), title: ttl || IMG_ONLY_TITLE, start: ts, end: ts, repeat: "", cal: "personal", kind: "task", taskId: tid, updatedAt: Date.now() };
        }
        if(!replaceInList(tl, trec)) tl.push(trec);
        save(tl);
        return renderMain();
      }
      if(readOnly){ // читатель группы меняет только своё отображение
        if(hideNow === isHidden(ev.id, baseS)) return renderMain();
        if(ev.repeat) return askScope(hideNow ? "Это повторяющееся мероприятие. Скрыть:" : "Это повторяющееся мероприятие. Показать:",
          function(){ hideOccurrence(ev, baseS, hideNow, false); renderMain(); },
          function(){ hideOccurrence(ev, baseS, hideNow, true); renderMain(); });
        setHidden(ev.id, hideNow);
        return renderMain();
      }
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
          if(hideNow === isHidden(ev.id, baseS)) return renderMain();
          // скрыть/показать — как правка и удаление повторения: спрашиваем «только это» или «это и все последующие» (признак на устройстве, серия не трогается)
          return askScope(hideNow ? "Это повторяющееся мероприятие. Скрыть:" : "Это повторяющееся мероприятие. Показать:",
            function(){ hideOccurrence(ev, baseS, hideNow, false); renderMain(); },
            function(){ hideOccurrence(ev, baseS, hideNow, true); renderMain(); });
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

    var doneBtn = document.getElementById("calDone");
    if(doneBtn) doneBtn.addEventListener("click", function(){
      if(TASKS && TASKS.done){ try{ TASKS.done(ev.taskId); }catch(e){} }
      renderMain(); // выполненная задача из календаря исчезает
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
        if(isTask(ev) && TASKS){ try{ TASKS.remove(ev.taskId); }catch(e){} }
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
      '<div class="item-form-hint">Цвет каждого календаря и трекеров занятий — необязательно. Пустой квадрат — цвет по умолчанию (у отдельного трекера — общий цвет трекеров). Выбор общий для всех ваших устройств.</div>';
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
      '<div class="item-form-hint">Работает в режиме «Неделя», когда показаны скрытые мероприятия: видимые рисуются поверх скрытых, не делят с ними место на колонки и не сужаются. Выбор общий для всех ваших устройств.</div>' +
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
    // my.js отдаёт работу с задачами «Ожидания» (см. шапку)
    setTasks: function(t){ TASKS = t || null; },
    // my.js отдаёт открытие сегодняшней заметки (тап по сегодняшней дате в шапке недели)
    setOpenToday: function(fn){ OPEN_TODAY = typeof fn === "function" ? fn : null; },
    render: function(){ if(extForm) closeExtForm(); importLegacy(); loadMode(); weekStart = null; weekScrollKeep = null; lastSig = sigNow(); renderMain(); },
    // данные могли измениться снаружи (пришли чужие правки группы): перерисовать текущий экран, если список изменился.
    // Открытую форму не трогаем; прокрутка сохраняется. my.js зовёт только когда вкладка «Календарь» на экране.
    // возврат в приложение (оболочка зовёт из my.js `__ltOnAppResume`): красная линия и прошедшие события — по текущему времени
    tick: function(){ weekNowTick(); dayCols.slice().forEach(function(c){ c.tick(); }); },
    // данные календаря пришли с другого устройства (my.js после слияния с облаком): перерисовать колонки дня в заметках, если что-то изменилось
    refreshDayCols: function(){
      if(!dayCols.length || extForm) return;
      var sig = sigNow();
      if(sig === dayColSig) return;
      dayColSig = sig;
      reloadPrefs();
      dayCols.slice().forEach(function(col){ try{ col.refresh(); }catch(e){} });
    },
    // колонка одного дня (по умолчанию сегодня) внутри host — для ежедневной заметки, см. шапку; возвращает {tick, destroy, refresh}
    mountDayColumn: function(host, opts){ return mountDayColumn(host, opts); },
    refresh: function(){
      if(screen === "form" || dragOn) return; // во время перетаскивания сетку не перерисовываем (подпись не запоминаем — обновится позже)
      var sig = sigNow();
      if(sig === lastSig) return;
      lastSig = sig;
      reloadPrefs(); // скрытые, цвета и переключатели могли прийти с другого устройства
      var c = container(), top = c ? c.scrollTop : 0;
      if(weekLike()) weekScrollKeep = top;
      renderMain();
      if(c && !weekLike()) c.scrollTop = top;
    },
    // для «Конструктора виджетов» (widgets.js): задачи и события для карточек стопки. Открытые задачи календаря, начало которых раньше `to`
    // (просроченные — тоже), и ближайшие повторения обычных мероприятий с началом в [from, to). Скрытые на этом устройстве не отдаются.
    // [{k:"task"|"event", id, title, at[, tid — id задачи у k="task"]}] по возрастанию `at`; хранилище и задачи должны быть заданы (my.js `__ltEnsureCalendarStore`)
    widgetFeed: function(from, to){
      var out = [];
      load().forEach(function(ev){
        if(isTask(ev) && isHidden(ev.id)) return;
        if(isTask(ev)){
          if(taskStateOf(ev) !== "open" || ev.start >= to) return;
          var title = ev.title;
          if(TASKS && TASKS.get){ try{ var ti = TASKS.get(ev.taskId); if(ti && ti.title) title = ti.title; }catch(e){} }
          out.push({ k: "task", id: ev.id, tid: String(ev.taskId), title: String(title || ""), at: ev.start });
          return;
        }
        occurrenceStarts(ev, from, to).forEach(function(at){ if(!isHidden(ev.id, at)) out.push({ k: "event", id: ev.id, title: String(ev.title || ""), at: at }); });
      });
      out.sort(function(a, b){ return a.at - b.at; });
      return out;
    },
    // форма редактирования мероприятия `id` (нажатие на карточку события в виджете): у серии — повторение, начавшееся в `at` (мс).
    // false — вкладка не на экране или такого мероприятия (ещё) нет; my.js повторяет попытку, пока хранилище не загрузилось
    openEvent: function(id, at){
      if(!container()) return false;
      var ev = findEvent(String(id || ""));
      if(!ev || isTask(ev)) return false;
      at = +at;
      openForm(ev, isFinite(at) && at > 0 ? at : ev.start);
      return true;
    },
    // форма редактирования ЗАДАЧИ календаря по id самой задачи (нажатие на карточку задачи в виджете — та же форма, что по нажатию на задачу в календаре).
    // false — вкладка не на экране или записи календаря с такой задачей (ещё) нет; my.js повторяет попытку, пока хранилище не загрузилось
    openTask: function(taskId){
      if(!container()) return false;
      taskId = String(taskId || "");
      if(!taskId) return false;
      var found = null;
      load().forEach(function(ev){ if(!found && isTask(ev) && String(ev.taskId) === taskId) found = ev; });
      if(!found) return false;
      openForm(found, found.start);
      return true;
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
