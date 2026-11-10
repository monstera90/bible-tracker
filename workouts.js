/* ===========================================================================
   workouts.js
   Версия: 12.0 (10.11)
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
   Xiaomi. Общее время = время с учётом километров + время без учёта. Расстояние всегда по GPS (сверки с картой нет — на бездорожье
   она искажала километры): оболочка сглаживает точки и отсекает дрожание, готовую запись кладёт в очередь, страница забирает её
   `drain()` (при открытии вкладки, при возврате в приложение, после остановки) и сохраняет через хранилище. Обновления `upd:1` (от старых версий оболочки)
   и метка `pend` игнорируются.

   Запись тренировки: {id, start, end, m (метры, итог), rawM (метры по GPS), totalMs, lostMs, gaps:[[с,по]], how:"raw" (у записей старых версий встречается "map"; у импортированных "imp")[, up (набор высоты, м, только если был; считает оболочка по высоте GPS), jumps (сколько раз GPS «уезжал» в сторону и это отброшено, только если было), rpe (1…10)]}.

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
   Кубок — кнопка `#wkRecordsBtn` (между лампочкой «Советы» и индикатором нагрузки) открывает экран `renderTrophyScreen` из трёх частей «Рекорды | Цели | Награды» (строка заголовков `.wk-sw`, нажатие или свайп влево/вправо; открытая часть запоминается — `workoutsTrophyTab_v1`).
   На каждой части слева от «домика» — кнопка «i» (`#wkTrophyInfoBtn`): экран `renderTrophyInfoScreen` с общими правилами этой части (то, чего нет на самом экране и в описаниях наград; тексты — `trophyInfoRows`); «домик» на нём возвращает к той же части.
   Часть «Рекорды» (`recordsBodyHtml`, расчёт — `bestRecords`):
   самое долгое время и самая длинная дистанция (`totalMs`, `m` по всем записям, у импортированных нет времени) и лучшее время на 5 км, 10 км, полумарафоне, марафоне. Дистанция записи считается
   по целой записи: подходит запись длиной от `REC_DIST_MIN` до `REC_DIST_MAX` от дистанции, время пересчитывается на ровную дистанцию (`totalMs × дистанция / m`). Нет подходящей записи — «ожидается».
   Для экспорта — `WorkoutsTab.exportRecords()` (читаемый раздел `workouts` в data.json, собирает my.js).
   Часть «Цели»: цель — на текущий месяц, три вида (`GOAL_TYPES`): километраж 50/100/200/300/500 км, набор высоты 300/600/1000/2000/3000 м, время тренировок 5/10/20/30/40 ч. Пока цель вида в месяце не достигнута, другую того же вида поставить нельзя; предлагаются только значения больше уже набранного за месяц; после достижения можно поставить следующую. Прогресс — по всем записям месяца (км — `m`, высота — `up`, время — `totalMs`), полоса заполняется сама. Запись цели — `wkgoal:<вид-месяц-значение>` = {type, month, target, setAt[, p50, p75, done]} (метки времени 50 %/75 %/достигнута, едут в облако). Цели прошлых месяцев — список «Прошлые цели».
   Часть «Награды»: каталог `AWARD_DEFS` (`buildAwardDefs`): первая тренировка, первые 5 / 10 км, первый полумарафон, первый марафон (одна тренировка не короче 98 % дистанции — как в рекордах), общий километраж, число тренировок, серии дней подряд, время и набор высоты за одну тренировку и суммарно (Эверест 8849 м), скорость (5 км быстрее 30/25 мин, 10 км быстрее 60/50 мин, полумарафон быстрее 2 ч, марафон быстрее 4 ч), привычки (ранняя пташка, сова, год в движении), цели месяца (по награде за каждое значение цели, «Первая цель», «Тройная цель»). Условия считаются по записям (`awardCtx`), раз полученная награда хранится — `wkaward:<id>` = {ts (когда заслужена), at}; неполученные показаны бледно с прогрессом (`prog`). **Обнуление:** долгое нажатие на полученную награду (`askResetAward`, `bindRowLongPress(row, onPress)`) → плашка с крестиком (`AppConfirmBar.openGrid`) → `resetAward`: запись `wkaward:<id>` заменяется на `{reset: ts}` (не «получена»: `awardsMap` берёт только записи с `ts`), сообщение `a:<id>` стирается; `awardResets`/`awardCtxFor` → `awardCtx(since)` считают только записи с `start ≥ reset` и цели с `done ≥ reset`, прогресс бледной награды тоже с нуля.
   Сообщения: награда, 50 %, 75 % цели и достигнутая цель (`evalProgress` на открытии вкладки, после забора записи, при открытии экрана кубка) складываются в `workoutsNotices_v1` (localStorage, только это устройство) и показываются в области совета дня вместо него (`noticeToShow`, карточка `#wkNoticeCard`; совет дня в это время не выбирается). Видно весь день события; на следующие дни — пока экран кубка не открывали (`markNoticesSeen`), сколько бы дней ни прошло. Нажатие на карточку открывает экран кубка на нужной части. О новой награде сообщение есть всегда; молчат только награды старше 3 дней при самом первом пересчёте на устройстве (`AWARD_BASE_KEY`).
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
  var TIP_DAY_KEY = "workoutsTipDay_v1";       // {day:"ГГГГ-ММ-ДД", id, ref}: совет сегодняшнего дня и id оценённой тренировки, под которую он выбран (только это устройство)
  var TIP_SEEN_KEY = "workoutsTipSeen_v1";     // id советов, уже показанных в текущем круге (без повторов, пока не покажутся все подходящие)
  var TIP_CTX_DAYS = 3;                        // оценка и дистанция берутся от последней оценённой тренировки не старше стольких календарных дней
  var TIP_LONG_DAYS = 90;                      // «длинная» пробежка = не короче медианы пробежек за столько дней
  var TIP_LONG_MIN_RUNS = 5;                   // пробежек нужно для медианы; меньше — фиксированная граница
  var TIP_LONG_FALLBACK_M = 5000;
  var REC_DISTS = [                            // дистанции экрана «Рекорды» (метры)
    { key: "5", label: "5 км", m: 5000 },
    { key: "10", label: "10 км", m: 10000 },
    { key: "21", label: "Полумарафон", m: 21097.5 },
    { key: "42", label: "Марафон", m: 42195 }
  ];
  var REC_DIST_MIN = 0.98, REC_DIST_MAX = 1.10; // запись подходит на дистанцию, если её длина — от 98 % до 110 % дистанции
  var REC_WAIT_TEXT = "ожидается";
  var TROPHY_TABS = [                          // части экрана кубка (слева направо)
    { key: "records", label: "Рекорды" },
    { key: "goals", label: "Цели" },
    { key: "awards", label: "Награды" }
  ];
  var TROPHY_TAB_KEY = "workoutsTrophyTab_v1"; // какая часть экрана кубка открыта (только это устройство)
  var NOTICE_KEY = "workoutsNotices_v1";       // сообщения о целях и наградах, показываемые вместо совета дня (только это устройство)
  var NOTICE_KEEP_MAX = 60;                    // сколько сообщений хранится (непрочитанные не пропадают по времени, только если их стало больше)
  var AWARD_BASE_KEY = "workoutsAwardsBase_v1"; // «первый пересчёт наград на этом устройстве уже был» (только это устройство)
  var NOTICE_RECENT_MS = 3 * 86400000;         // только при самом первом пересчёте: награды старше молчат (старая история не сыплется сообщениями)
  var GOAL_TYPES = [                           // виды месячных целей; opts — варианты (км / метры набора / часы)
    { key: "km", title: "Километраж", unit: "км", opts: [50, 100, 200, 300, 500],
      awardPrefix: "Цель месяца: ", awardSuffix: "", awardText: "Достигнута месячная цель по километражу:" },
    { key: "up", title: "Набор высоты", unit: "м", opts: [300, 600, 1000, 2000, 3000],
      awardPrefix: "Цель месяца: ", awardSuffix: " набора", awardText: "Достигнута месячная цель по набору высоты:" },
    { key: "time", title: "Время тренировок", unit: "ч", opts: [5, 10, 20, 30, 40],
      awardPrefix: "Цель месяца: ", awardSuffix: " тренировок", awardText: "Достигнута месячная цель по времени тренировок:" }
  ];
  var AWARD_CATS = ["Дистанция за одну тренировку", "Общий километраж", "Регулярность", "Время и высота", "Скорость", "Привычки", "Цели месяца"];
  var TIP_CATS = ["Объём и регулярность", "Техника", "Силовая", "Восстановление", "Анализ", "Другое"];
  var TIP_RPE_OPTS = [["", "Любая"], ["low", "Лёгкая 1–3"], ["mid", "Средняя 4–6"], ["high", "Тяжёлая 7–10"]];
  var TIP_DIST_OPTS = [["", "Любая"], ["short", "Короткая"], ["long", "Длинная"]];
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
  var TIP_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"></path><path d="M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"></path></svg>';
  var CUP_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0z"></path><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5"></path><path d="M16 6h3v1.5a3 3 0 0 1-3 3"></path><path d="M12 13v5"></path><path d="M8.5 19.5h7"></path></svg>';
  var MEDAL_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5.5"></circle><path d="M8.7 13.6L7 21l5-2.6 5 2.6-1.7-7.4"></path></svg>';
  var PLUS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  var CHECK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
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
  var infoScreen = false;  // открыт боковой экран вместо вкладки: «Тренировки — кнопки» («i») или «Советы»
  var tipsCache = null;    // {at, val}: короткий кэш списка советов
  var tipHidden = false;   // карточка совета закрыта нажатием (до следующего открытия вкладки)
  var tipEdit = null;      // форма совета: {id, ts, cat, rpe, dist, text}
  var tipDelArm = null;    // {id, timer}: первое нажатие «Удалить» у совета сделано
  var tipDayMem = null;    // {day, id, ref}: совет дня в памяти — запасной вариант, если localStorage недоступен
  var importMsg = "";      // итог последнего импорта (карточка над панелью записи; нажатие закрывает)
  var importBusy = false;  // идёт чтение файла импорта
  var trophyTab = "records"; // открытая часть экрана кубка
  var goalSel = {};        // выбранная, но ещё не поставленная цель: {km|up|time: значение}

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
  // «↑ 235 м»: стрелка вверх рисуется, а не символом (в старом WebView шрифт может её не знать)
  var UP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5"></path><path d="M6 11l6-6 6 6"></path></svg>';
  function fmtUpHtml(m){ return UP_SVG + " " + Math.round(num(m)) + " м"; }
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

  function fmtDate(ts){
    var d = new Date(ts);
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear();
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
  function sumUp(list){ var s = 0; list.forEach(function(r){ s += num(r.up); }); return s; } // высота: и с тренировок, и внесённая вручную
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
    saveLastResult({ id: rec.id, start: rec.start, m: rec.m, totalMs: rec.totalMs, gaps: rec.gaps || [], how: rec.how, jumps: rec.jumps, up: rec.up, rpe: rpeSel });
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
      ".wk-root{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative;}" +
      ".wk-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none;padding-bottom:12px;}" +
      ".wk-scroll::-webkit-scrollbar{display:none;width:0;height:0;}" +
      "#wkLive{position:absolute;left:0;right:0;bottom:calc(var(--fab-size,36px) + 2 * var(--fab-gap,6px));max-height:60%;overflow-y:auto;z-index:5;pointer-events:none;}" +
      "#wkLive > *{pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.28);}" +
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
      ".wk-total .wk-up{font-size:.52em;font-weight:600;white-space:nowrap;margin-left:.45em;}" +
      ".wk-total .wk-up svg{width:.95em;height:.95em;vertical-align:-.12em;}" +
      ".wk-row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--groove-shadow);cursor:pointer;}" +
      ".wk-row:first-of-type{border-top:none;}" +
      ".wk-row .wk-date{flex:1;}" +
      ".wk-row .wk-dist{font-weight:bold;font-variant-numeric:tabular-nums;}" +
      ".wk-row .wk-time{color:var(--ink-soft);min-width:64px;text-align:right;font-variant-numeric:tabular-nums;}" +
      ".wk-row .wk-sub{display:block;font-size:.8em;color:var(--ink-soft);}" +
      ".wk-row.wk-row-del,.wk-award.wk-row-del{background:rgba(180,60,60,.12);}" +
      ".wk-row[data-id]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}" +
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
      ".wk-btns button:disabled{opacity:.4;cursor:default;}" +
      ".wk-tip-ico{display:inline-block;width:18px;height:18px;flex:0 0 18px;color:var(--wood-dark);}" +
      ".wk-tip-ico svg{display:block;width:18px;height:18px;}" +
      ".wk-tip-text{margin-top:6px;line-height:1.35;}" +
      ".wk-tip-meta{font-size:.8em;}" +
      ".wk-tip-cat{margin:14px 0 2px;font-weight:bold;color:var(--wood-dark);}" +
      ".wk-tip-row{padding:8px 2px;border-top:1px solid var(--groove-shadow);cursor:pointer;line-height:1.35;}" +
      ".wk-tip-cat + .wk-tip-row{border-top:none;}" +
      ".wk-tip-row .wk-sub{display:block;font-size:.8em;color:var(--ink-soft);margin-top:2px;}" +
      ".wk-tip-lbl{margin:14px 0 6px;color:var(--ink-soft);}" +
      ".wk-tip-input{display:block;width:100%;box-sizing:border-box;min-height:110px;padding:8px 10px;border-radius:10px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font:inherit;resize:vertical;}" +
      ".wk-seg-btn{display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border-radius:10px;border:1px solid var(--groove-shadow);background:transparent;color:var(--ink);font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
      ".wk-seg-btn.on{background:var(--wood);border-color:var(--wood);color:var(--parchment);}" +
      ".wk-rec-cat{margin:14px 0 2px;font-weight:bold;color:var(--wood-dark);}" +
      ".wk-rec-cat:first-child{margin-top:4px;}" +
      ".wk-rec{display:flex;align-items:center;gap:10px;padding:10px 2px;border-top:1px solid var(--groove-shadow);line-height:1.3;}" +
      ".wk-rec:first-child{border-top:none;}" +
      ".wk-rec .wk-rec-name{flex:1;min-width:0;}" +
      ".wk-rec .wk-sub{display:block;font-size:.8em;color:var(--ink-soft);margin-top:2px;}" +
      ".wk-rec .wk-rec-val{font-weight:bold;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}" +
      ".wk-rec .wk-rec-val.wait{font-weight:normal;color:var(--ink-soft);white-space:normal;max-width:45%;}" +
      ".wk-tip-note{margin-top:10px;color:var(--ink-soft);font-size:.9em;}" +
      ".wk-tip-err{margin-top:8px;color:var(--danger);}" +
      // строка «Рекорды | Цели | Награды» — копия .nb-switch (components.css) под три части
      ".wk-sw{display:flex;margin:2px 0 0 0;border-bottom:1px solid var(--groove-shadow);}" +
      ".wk-sw-item{flex:1 1 33.333%;min-width:0;box-sizing:border-box;padding:6px 0;font-family:\"Palatino Linotype\",Georgia,serif;font-size:var(--mdeditor-font-size,15.5px);font-weight:bold;color:var(--wood);text-align:center;opacity:.4;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;}" +
      ".wk-sw-item.active{opacity:1;cursor:default;}" +
      // цели: карточка с полосой прогресса
      ".wk-goal{margin:6px 0 8px;}" +
      ".wk-goal-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:bold;}" +
      ".wk-goal-pct{font-variant-numeric:tabular-nums;color:var(--wood-dark);white-space:nowrap;}" +
      ".wk-goal-pct.done{color:#2fa15f;}" +
      ".wk-bar{height:10px;border-radius:6px;background:var(--groove-shadow);overflow:hidden;margin:8px 0 6px;}" +
      ".wk-bar-fill{height:100%;border-radius:6px;background:var(--wood);transition:width .3s;}" +
      ".wk-bar-fill.done{background:#2fa15f;}" +
      ".wk-goal .wk-sub{display:block;font-size:.85em;color:var(--ink-soft);}" +
      ".wk-goal-set{display:block;margin:6px 0 4px;padding:8px 14px;border-radius:10px;border:1px solid var(--wood);background:var(--wood);color:var(--parchment);font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
      ".wk-goal-set:disabled{background:transparent;border-color:var(--groove-shadow);color:var(--ink-soft);opacity:.6;cursor:default;}" +
      // награды
      ".wk-award{align-items:flex-start;}" +
      ".wk-award:not(.on){opacity:.5;}" +
      ".wk-medal{flex:0 0 28px;width:28px;height:28px;margin-top:1px;color:var(--ink-soft);}" +
      ".wk-medal svg{display:block;width:28px;height:28px;}" +
      ".wk-award.on .wk-medal{color:var(--wood-dark);}" +
      ".wk-award.on .wk-medal circle{fill:var(--gold-light);}" +
      ".wk-award .wk-award-meta{color:var(--wood-dark);}" +
      ".wk-notice .wk-tip-text + .wk-tip-text{margin-top:8px;}";
    document.head.appendChild(st);
  }

  // ---------- главный экран ----------
  function fabRowHtml(){
    var active = lastState && lastState.status && lastState.status !== "idle";
    var lt = fmtPoints(weekLoad());
    return '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="wkInfoBtn" title="Информация" aria-label="Информация">' + INFO_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="wkImportBtn" title="Загрузить тренировки из файла" aria-label="Загрузить тренировки из файла">' + IMPORT_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="wkTipsBtn" title="Советы" aria-label="Советы">' + TIP_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="wkRecordsBtn" title="Рекорды" aria-label="Рекорды">' + CUP_ICON_SVG + '</button>' +
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
    evalProgress();
    var recs = inRange(allRecords());
    var html = '<div class="wk-root" id="' + rootId + '">' +
      '<div class="wk-scroll">' +
      '<h3 class="common-tab-title">Тренировки</h3>' +
      '<div class="wk-nav"><button type="button" id="wkPrev" aria-label="Назад">‹</button><div class="wk-title">' + esc(periodTitle()) +
      '</div><button type="button" id="wkNext" aria-label="Вперёд"' + (endMonth.getTime() >= curMonth().getTime() ? " disabled" : "") + '>›</button></div>' +
      '<div class="wk-total"><div class="wk-km">' + esc(fmtKm(sumM(recs))) + '<span class="wk-up">• ' + fmtUpHtml(sumUp(recs)) + '</span></div><div class="wk-sub">' +
        summaryHtml(recs.filter(function(r){ return !r.man; })) +
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

  // «86 тренировок, из них 2 · 21 мин»: время есть не у всех записей (импортированные без времени)
  function summaryHtml(recs){
    if(!recs.length) return "тренировок нет";
    var timed = recs.filter(function(r){ return num(r.totalMs) > 0; });
    var out = recs.length + " " + plural(recs.length, "тренировка", "тренировки", "тренировок");
    if(!timed.length) return out;
    if(timed.length < recs.length) out += ", из них " + timed.length;
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
      var partUp = sumUp(part);
      part = part.filter(function(r){ return !r.man; }); // записи «внесено вручную» числом тренировок не считаются
      out.push('<div class="wk-row" data-month="' + ms.getFullYear() + "-" + ms.getMonth() + '">' +
        '<span class="wk-date">' + esc(MONTHS[ms.getMonth()]) + (months === 12 || ms.getFullYear() !== endMonth.getFullYear() ? " " + ms.getFullYear() : "") + (partUp > 0 ? ' <span class="wk-sub">↑ ' + Math.round(partUp) + ' м</span>' : '') + '</span>' +
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
      if(r.man){ // высота «внесена вручную» (карточка «+ к высоте»), когда в этот день тренировки не было: строка без километров и времени
        return '<div class="wk-row" data-id="' + esc(r.id) + '">' +
          '<span class="wk-date">' + esc(dayLabel(r.start)) + ' <span class="wk-sub">' + esc(fmtHM(r.start)) + ' · ↑ ' + Math.round(num(r.up)) + ' м · внесено вручную</span></span>' +
          '<span class="wk-dist"></span><span class="wk-time"></span></div>';
      }
      var sub = [];
      if(rpeOk(r.rpe)) sub.push(minutesOf(r) + " мин × " + r.rpe + " = " + loadOf(r) + " " + pointsWord(loadOf(r)));
      else if(r.id === pid) sub.push("ждёт оценки");
      if(r.imp) sub.push("импорт");
      else if(r.how === "raw") sub.push("по GPS");
      if(num(r.up) > 0) sub.push("↑ " + Math.round(num(r.up)) + " м" + (num(r.upMan) > 0 ? " (из них внесено вручную " + Math.round(num(r.upMan)) + " м)" : ""));
      if(num(r.jumps) > 0) sub.push("выбросов GPS: " + Math.round(num(r.jumps)));
      if(num(r.lostMs) >= 1000) sub.push("без учёта км: " + fmtDur(r.lostMs));
      return '<div class="wk-row" data-id="' + esc(r.id) + '">' +
        '<span class="wk-date">' + esc(dayLabel(r.start)) + ' <span class="wk-sub">' + esc(fmtHM(r.start)) + (sub.length ? " · " + esc(sub.join(" · ")) : "") + '</span></span>' +
        '<span class="wk-dist">' + esc(fmtKm(r.m)) + '</span>' +
        '<span class="wk-time">' + (num(r.totalMs) > 0 ? esc(fmtClock(r.totalMs)) : "") + '</span></div>';
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
    Array.prototype.forEach.call(c.querySelectorAll(".wk-row[data-id]"), function(r){ bindRowLongPress(r); });
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
    var tb = document.getElementById("wkTipsBtn");
    if(tb) tb.addEventListener("click", renderTipsScreen);
    var rb = document.getElementById("wkRecordsBtn");
    if(rb) rb.addEventListener("click", function(){ renderTrophyScreen(); });
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
  // удаление записи (тренировка или «внесено вручную») — долгое нажатие на строке списка, плашка с одним крестиком (как у задач):
  // нажатие на крестик удаляет, нажатие мимо — отмена
  var ROW_PRESS_MS = 500, ROW_PRESS_TOL = 10;
  var CROSS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>';
  function clearRowMark(){
    var hl = document.querySelectorAll(".wk-row-del");
    for(var i = 0; i < hl.length; i++) hl[i].classList.remove("wk-row-del");
  }
  function askDeleteRow(id, row){
    var bar = window.AppConfirmBar;
    if(!bar || !bar.openGrid) return;
    clearRowMark();
    row.classList.add("wk-row-del");
    // клик, которым заканчивается долгое нажатие, не должен сразу закрыть плашку как «клик мимо»
    function guard(e){ e.stopImmediatePropagation(); e.preventDefault(); }
    document.addEventListener("click", guard, true);
    setTimeout(function(){ document.removeEventListener("click", guard, true); }, 700);
    bar.openGrid(row, [{ key: "del", svg: CROSS_SVG, title: "Удалить" }], function(){
      clearRowMark();
      try{ if(STORE) STORE.remove(id); }catch(e){}
      pendCache = null;
      openedId = null;
      render();
    }, { label: "Удалить запись?", onCancel: clearRowMark });
  }
  // долгое нажатие на полученную награду → плашка с крестиком «Обнулить»; нажатие мимо — отмена
  function askResetAward(id, row){
    var bar = window.AppConfirmBar;
    if(!bar || !bar.openGrid) return;
    clearRowMark();
    row.classList.add("wk-row-del");
    function guard(e){ e.stopImmediatePropagation(); e.preventDefault(); }
    document.addEventListener("click", guard, true);
    setTimeout(function(){ document.removeEventListener("click", guard, true); }, 700);
    bar.openGrid(row, [{ key: "del", svg: CROSS_SVG, title: "Обнулить" }], function(){
      clearRowMark();
      resetAward(id);
      renderTrophyScreen("awards");
    }, { label: "Обнулить награду?", onCancel: clearRowMark });
  }
  function bindRowLongPress(row, onPress){
    var timer = null, sx = 0, sy = 0, lastTouchAt = 0;
    function cancel(){ if(timer){ clearTimeout(timer); timer = null; } }
    function down(e, isTouch){
      if(isTouch) lastTouchAt = Date.now();
      else if(Date.now() - lastTouchAt < 800) return; // эмулированные мышиные события после касания
      var pt = (e.touches && e.touches[0]) || e;
      sx = pt.clientX; sy = pt.clientY;
      cancel();
      timer = setTimeout(function(){
        timer = null;
        try{ if(navigator.vibrate) navigator.vibrate(20); }catch(err){}
        (onPress || askDeleteRow)(row.getAttribute("data-id"), row);
      }, ROW_PRESS_MS);
    }
    function move(e){
      if(!timer) return;
      var pt = (e.touches && e.touches[0]) || e;
      if(Math.abs(pt.clientX - sx) > ROW_PRESS_TOL || Math.abs(pt.clientY - sy) > ROW_PRESS_TOL) cancel();
    }
    row.addEventListener("touchstart", function(e){ down(e, true); });
    row.addEventListener("touchmove", move);
    row.addEventListener("touchend", cancel);
    row.addEventListener("touchcancel", cancel);
    row.addEventListener("mousedown", function(e){ down(e, false); });
    row.addEventListener("mousemove", move);
    row.addEventListener("mouseup", cancel);
    row.addEventListener("mouseleave", cancel);
    row.addEventListener("contextmenu", function(e){ e.preventDefault(); }); // системное меню при долгом нажатии не нужно
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
    // сообщение о награде / половине / трёх четвертях цели занимает место совета дня (и тогда совет дня не выбирается и не «сгорает»)
    var notice = (!active && !pend) ? noticeToShow() : null;
    var tip = (!active && !pend && !notice) ? dayTip() : null;
    var calm = !tipHidden && !infoOpen && !importMsg && !message;
    var showNotice = !!notice && calm;
    var showTip = !!tip && calm;
    var shape = (active ? st.status + ":" + (st.fix ? 1 : 0) + ":" + ((st.gaps || []).length) : "idle") + "|" + (res ? res.id : "") + "|" + message + messageAction +
      "|" + (pend ? pend.id + ":" + rpeSel : "") + "|" + (infoOpen ? "i" : "") + "|" + importMsg + "|" + (showTip ? tip.id + ":" + tip.text.length : "") + "|" + (showNotice ? notice.sig : "");
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
    if(showNotice) html += noticeCardHtml(notice);
    else if(showTip) html += tipCardHtml(tip);
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
    var nc = document.getElementById("wkNoticeCard");
    if(nc) nc.addEventListener("click", function(){ renderTrophyScreen(nc.getAttribute("data-tab")); }); // нажатие открывает экран кубка на нужной части
    var tc = document.getElementById("wkTipCard");
    if(tc) tc.addEventListener("click", function(){ tipHidden = true; lastShape = ""; paintLive(true); }); // нажатие закрывает карточку до следующего открытия вкладки
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
      body = '<div class="wk-live-time" id="wkTime"></div><div class="wk-live-dist" id="wkDist"></div><div class="wk-lost" id="wkLost" style="display:none"></div><div class="wk-note" id="wkClimb" style="display:none"></div>' +
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
    var t = box.querySelector("#wkTime"), d = box.querySelector("#wkDist"), l = box.querySelector("#wkLost"), cl = box.querySelector("#wkClimb");
    if(cl){
      if(num(st.upM) >= 1){ cl.style.display = ""; cl.textContent = "Набрано высоты: " + Math.round(num(st.upM)) + " м"; }
      else cl.style.display = "none";
    }
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
      '<div class="wk-note">' + esc(dayLabel(rec.start)) + ' · ' + esc(fmtHM(rec.start)) + ' · ' + esc(fmtClock(rec.totalMs)) + ' · ' + esc(fmtKm(rec.m)) + (num(rec.up) > 0 ? ' · ↑ ' + Math.round(num(rec.up)) + ' м' : '') + '</div>' +
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
    var how = r.how === "map" ? "маршрут сверен с картой OpenStreetMap" : "расстояние по GPS";
    return '<div class="wk-card" id="wkResultCard"><div class="wk-live-head"><span class="wk-dot ok"></span><span>Тренировка сохранена</span></div>' +
      '<div class="wk-live-time">' + esc(fmtKm(r.m)) + '</div>' +
      '<div class="wk-live-dist">' + esc(fmtClock(r.totalMs)) + '</div>' +
      '<div class="wk-note">' + esc(how) + '</div>' +
      (num(r.up) > 0 ? '<div class="wk-note">Набрано высоты: ' + Math.round(num(r.up)) + ' м</div>' : "") +
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
    html += row(REC_ICON_SVG, "Запись («красный кружок») работает только в приложении для Android: поиск спутников → «Связь установлена» → идёт время. Пауза и стоп — в панели, в уведомлении или на «острове». Время на паузе и при поиске спутников не идёт. После остановки оцените, насколько тяжёлой была тренировка (1…10).");
    html += row(REC_ICON_SVG, "Как считаются километры. Расстояние всегда берётся только из GPS — с картой дорог оно не сверяется, поэтому бег по лесу, полю и бездорожью считается честно, без «спрямления» по чужим тропам. Интернет для записи не нужен.");
    html += row(REC_ICON_SVG, "Как приложение борется с ошибками GPS. Каждая точка сглаживается с учётом заявленной погрешности, а шаг засчитывается, только когда вы действительно ушли дальше этой погрешности — «петли» и дрожание на месте километры не растят. Если спутниковый датчик скорости показывает, что вы стоите, небольшие смещения тоже не считаются. Точки, до которых пришлось бы бежать быстрее 32 км/ч, отбрасываются; если GPS «уехал» в сторону и держится там, это считается сдвигом: переход к нему в километры не входит. Число таких случаев показано в записи («выбросов GPS»).");
    html += row(REC_ICON_SVG, "Потеря связи. Если годной точки (погрешность до 20 м) нет больше 10 секунд, километры не считаются, а время идёт — на записи это видно как «без учёта км». Когда сигнал вернулся, расстояние между точкой потери и точкой возврата не добавляется. Под густой листвой, в ущельях и между высокими домами километраж может быть немного неточным.");
    html += row(REC_ICON_SVG, "Набор высоты («↑ м») считается по высоте GPS: она сглаживается, подъём засчитывается после изменения больше 3 м. Для записи достаточно разрешения геолокации «Во время использования приложения» (с включённым «Точным местоположением»): запись идёт и при выключенном экране, пока висит уведомление тренировки. Начинайте запись при открытом приложении и не ограничивайте его в расходе батареи (на Xiaomi — «Без ограничений» и «Автозапуск»), иначе система может остановить запись. Записи хранятся на устройстве и входят в облачную синхронизацию и экспорт.");
    html += row('<span style="font-size:12px;font-weight:bold;">0</span>', "Число слева в нижнем ряду — нагрузка за 7 дней: баллы = минуты × оценка. Нажатие открывает пояснение.");
    html += row('<span style="font-size:11px;font-weight:bold;">1 мес.</span>', "Период: месяц, 3 месяца, полгода, год. Стрелки ‹ › и свайп листают назад и вперёд, сверху — сумма километров и число тренировок. Нажатие на строку записи открывает «Удалить» (нужно нажать дважды).");
    html += row(UP_SVG, "Удалить тренировку или внесённую высоту — долгое нажатие на строке списка, затем крестик на плашке (нажатие мимо — отмена). Высота рядом с километражом — сумма набора за выбранный период. Метры, внесённые карточкой «+ к высоте» (или её QR-кодом), добавляются к последней сегодняшней тренировке, а если сегодня тренировки не было — в общий счётчик высоты отдельной строкой «внесено вручную».");
    html += row(IMPORT_ICON_SVG, "Загружает тренировки из файла. Подходят два вида: архив «Экспортировать личные данные» (ZIP или data.json) — из него берутся только тренировки, остальные данные не меняются; и CSV-выгрузка стороннего трекера — из неё берутся только пробежки: дата и километры (время и баллы не переносятся). Уже имеющиеся тренировки повторно не добавляются.");
    html += row(TIP_ICON_SVG, "Советы: один совет в день показывается внизу вкладки, когда запись не идёт. Нажатие на карточку закрывает её до следующего открытия вкладки. Кнопка открывает список советов: добавить, изменить, удалить; у каждого — категория и необязательные отметки: тяжесть последней тренировки (1–3, 4–6, 7–10) и её дистанция (короткая/длинная). Без отметок совет подходит всегда.");
    html += row(CUP_ICON_SVG, "Рекорды: самое долгое время и самая длинная дистанция, а также лучшее время на 5 км, 10 км, полумарафоне и марафоне. На дистанцию подходит запись длиной от 98 % до 110 % этой дистанции (время пересчитывается на ровную дистанцию); импортированные записи без времени в лучших временах не участвуют. Пока подходящей записи нет, пишет «ожидается».");
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

  // ---------- экран кубка: «Рекорды | Цели | Награды» ----------
  // Три части на одной строке заголовков — как «Заметки | Книги» (my.js, NotesBooksSwitch): нажатие на заголовок или свайп влево/вправо.
  // Стили свои (.wk-sw*, копия .nb-switch), чтобы не задеть переключатель заметок/книг. Открытая часть запоминается (`workoutsTrophyTab_v1`).
  function trophyIndex(key){
    for(var i = 0; i < TROPHY_TABS.length; i++){ if(TROPHY_TABS[i].key === key) return i; }
    return -1;
  }
  function loadTrophyTab(){
    var v = "";
    try{ v = localStorage.getItem(TROPHY_TAB_KEY) || ""; }catch(e){}
    return trophyIndex(v) !== -1 ? v : TROPHY_TABS[0].key;
  }
  function swHtml(active){
    return '<div class="wk-sw" role="tablist">' + TROPHY_TABS.map(function(t){
      return '<span class="wk-sw-item' + (t.key === active ? " active" : "") + '" role="tab" data-wktab="' + t.key + '">' + esc(t.label) + '</span>';
    }).join("") + '</div>';
  }

  // ---------- часть «Рекорды» ----------
  // самая долгая и самая длинная запись; лучшее время на каждой дистанции из REC_DISTS (по целым записям подходящей длины)
  function bestRecords(){
    var out = { time: null, dist: null, races: {} };
    allRecords().forEach(function(r){
      var m = num(r.m), t = num(r.totalMs);
      if(m > 0 && (!out.dist || m > num(out.dist.m))) out.dist = r;
      if(t > 0 && (!out.time || t > num(out.time.totalMs))) out.time = r;
      if(m <= 0 || t <= 0) return;
      REC_DISTS.forEach(function(d){
        if(m < d.m * REC_DIST_MIN || m > d.m * REC_DIST_MAX) return;
        var ms = t * d.m / m; // время на ровную дистанцию
        var cur = out.races[d.key];
        if(!cur || ms < cur.ms) out.races[d.key] = { ms: ms, rec: r };
      });
    });
    return out;
  }

  function recRowHtml(name, val, sub){
    if(val === null){
      return '<div class="wk-rec"><span class="wk-rec-name">' + esc(name) + '</span><span class="wk-rec-val wait">' + esc(REC_WAIT_TEXT) + '</span></div>';
    }
    return '<div class="wk-rec"><span class="wk-rec-name">' + esc(name) + (sub ? '<span class="wk-sub">' + esc(sub) + '</span>' : "") +
      '</span><span class="wk-rec-val">' + esc(val) + '</span></div>';
  }
  // «12.10.2026 · 14,2 км · темп 5:12 /км»; темп — по целой записи или по ровной дистанции, если передана distM
  function recSub(r, withKm, withTime, paceMs, paceM){
    var parts = [fmtDate(r.start)];
    if(withKm) parts.push(fmtKm(r.m));
    if(withTime) parts.push(fmtClock(r.totalMs));
    if(paceMs > 0 && paceM > 0) parts.push("темп " + fmtClock(paceMs / (paceM / 1000)) + " /км");
    return parts.join(" · ");
  }

  function recordsBodyHtml(){
    var b = bestRecords();
    var html = '<div class="wk-rec-cat">Самое долгое и самое длинное</div><div class="wk-card" style="padding:4px 12px;">';
    html += recRowHtml("Максимальное время бега", b.time ? fmtClock(b.time.totalMs) : null,
      b.time ? recSub(b.time, true, false, num(b.time.totalMs), num(b.time.m)) : "");
    html += recRowHtml("Максимальная дистанция бега", b.dist ? fmtKm(b.dist.m) : null,
      b.dist ? recSub(b.dist, false, num(b.dist.totalMs) > 0, num(b.dist.totalMs), num(b.dist.m)) : "");
    html += '</div><div class="wk-rec-cat">Лучшее время на дистанции</div><div class="wk-card" style="padding:4px 12px;">';
    REC_DISTS.forEach(function(d){
      var x = b.races[d.key];
      html += recRowHtml(d.label, x ? fmtClock(x.ms) : null, x ? recSub(x.rec, true, false, x.ms, d.m) : "");
    });
    return html + '</div>';
  }

  // ---------- цели месяца ----------
  // Цель = запись личного state `wkgoal:<id>` = {c:{type, month:"ГГГГ-ММ", target, setAt[, p50, p75, done]}, t}; id = «вид-месяц-значение».
  // p50/p75/done — метки времени, когда прогресс впервые дошёл до 50 % / 75 % / 100 % (едут в облако: второе устройство уже не сообщает о них заново).
  function monthKey(d){ return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }
  function monthRange(key){
    var p = String(key).split("-");
    var a = monthStart(parseInt(p[0], 10) || 1970, (parseInt(p[1], 10) || 1) - 1);
    return [a.getTime(), addMonths(a, 1).getTime()];
  }
  function monthTitle(key){
    var p = String(key).split("-");
    return (MONTHS[(parseInt(p[1], 10) || 1) - 1] || "") + " " + p[0];
  }
  function endOf(r){ return num(r.end) > num(r.start) ? num(r.end) : num(r.start); }
  function goalType(key){
    for(var i = 0; i < GOAL_TYPES.length; i++){ if(GOAL_TYPES[i].key === key) return GOAL_TYPES[i]; }
    return null;
  }
  // вклад одной записи в цель, в единицах цели: км / метры набора / часы
  function valOf(type, r){
    if(type === "km") return num(r.m) / 1000;
    if(type === "up") return num(r.up);
    return num(r.totalMs) / 3600000;
  }
  function recsAsc(){ return allRecords().slice().reverse(); } // allRecords — новые сверху
  function monthProgress(type, key, asc){
    var rg = monthRange(key), sum = 0;
    asc.forEach(function(r){ if(r.start >= rg[0] && r.start < rg[1]) sum += valOf(type, r); });
    return sum;
  }
  function targetLabel(type, target){ return target + " " + goalType(type).unit; }
  function goalLabel(g){ return monthTitle(g.month) + " · " + targetLabel(g.type, g.target); }
  function progText(type, val, target){
    if(type === "km") return fmtKm(val * 1000) + " из " + target + " км";
    if(type === "up") return Math.round(val) + " из " + target + " м";
    return fmtTotal(val * 3600000) + " из " + target + " ч";
  }
  function leftText(type, val, target){
    var left = Math.max(0, target - val);
    if(type === "km") return fmtKm(left * 1000);
    if(type === "up") return Math.ceil(left) + " м";
    return fmtTotal(left * 3600000);
  }

  function goalsList(){
    if(!STORE || typeof STORE.listGoals !== "function") return [];
    var list = [];
    try{ list = STORE.listGoals() || []; }catch(e){ list = []; }
    return list.filter(function(g){ return g && goalType(g.type) && typeof g.month === "string" && num(g.target) > 0; });
  }
  function goalCopy(g){
    var c = {};
    Object.keys(g).forEach(function(k){ if(k !== "id") c[k] = g[k]; });
    return c;
  }
  function goalAwardTitle(type, target){ return goalType(type).awardPrefix + targetLabel(type, target) + goalType(type).awardSuffix; }

  // пересчёт целей: отметки 50 % / 75 % / «достигнута»; для каждой отметки — сообщение вместо совета дня
  function evalGoals(){
    var goals = goalsList();
    if(!goals.length) return;
    var asc = recsAsc(), now = Date.now(), curKey = monthKey(new Date());
    goals.forEach(function(g){
      if(g.done) return;
      var rg = monthRange(g.month), cum = 0, cross = 0;
      asc.forEach(function(r){
        if(r.start < rg[0] || r.start >= rg[1]) return;
        cum += valOf(g.type, r);
        if(!cross && cum >= g.target) cross = endOf(r);
      });
      var pct = cum / g.target * 100;
      var c = goalCopy(g), changed = false;
      if(pct >= 100){
        c.done = cross || now;
        if(!c.p50) c.p50 = now;
        if(!c.p75) c.p75 = now;
        changed = true;
        pushNotice({ k: "gd:" + g.id, kind: "goal", tab: "goals",
          text: "Цель «" + goalLabel(g) + "» достигнута! Награда: «" + goalAwardTitle(g.type, g.target) + "»." });
      } else if(g.month === curKey){
        if(pct >= 75 && !c.p75){
          c.p75 = now; if(!c.p50) c.p50 = now; changed = true;
          pushNotice({ k: "g75:" + g.id, kind: "goal", tab: "goals",
            text: "Цель «" + goalLabel(g) + "»: пройдено три четверти пути — " + progText(g.type, cum, g.target) + "." });
        } else if(pct >= 50 && !c.p50){
          c.p50 = now; changed = true;
          pushNotice({ k: "g50:" + g.id, kind: "goal", tab: "goals",
            text: "Цель «" + goalLabel(g) + "»: пройдена половина пути — " + progText(g.type, cum, g.target) + "." });
        }
      }
      if(changed){ try{ STORE.putGoal(g.id, c); }catch(e){} }
    });
  }

  // можно ли поставить цель: нет невыполненной цели этого вида на текущий месяц и значение больше уже набранного за месяц
  function setGoal(type, target){
    var gt = goalType(type);
    if(!gt || gt.opts.indexOf(target) === -1 || !STORE || typeof STORE.putGoal !== "function") return false;
    var key = monthKey(new Date()), asc = recsAsc();
    var open = goalsList().some(function(g){ return g.type === type && g.month === key && !g.done; });
    if(open) return false;
    var cum = monthProgress(type, key, asc);
    if(cum >= target) return false;
    var now = Date.now(), c = { type: type, month: key, target: target, setAt: now };
    var pct = cum / target * 100;
    if(pct >= 50) c.p50 = now; // что уже пройдено на момент выбора — молча, без сообщений
    if(pct >= 75) c.p75 = now;
    try{ STORE.putGoal(type + "-" + key + "-" + target, c); }catch(e){ return false; }
    return true;
  }

  function barHtml(pct, done){
    var w = Math.max(0, Math.min(100, pct));
    return '<div class="wk-bar"><div class="wk-bar-fill' + (done ? " done" : "") + '" style="width:' + w.toFixed(1) + '%"></div></div>';
  }

  function goalCardHtml(g, cum){
    var pct = Math.min(100, cum / g.target * 100);
    var done = !!g.done;
    return '<div class="wk-card wk-goal">' +
      '<div class="wk-goal-head"><span class="wk-goal-name">' + esc(goalLabel(g)) + '</span><span class="wk-goal-pct' + (done ? " done" : "") + '">' +
        (done ? "✓ 100%" : Math.floor(pct) + "%") + '</span></div>' +
      barHtml(done ? 100 : pct, done) +
      '<div class="wk-sub">' + (done
        ? esc("Достигнута " + fmtDate(g.done) + " · " + progText(g.type, Math.max(cum, g.target), g.target))
        : esc(progText(g.type, cum, g.target) + " · осталось " + leftText(g.type, cum, g.target))) + '</div></div>';
  }

  function goalsBodyHtml(){
    var now = new Date(), key = monthKey(now), asc = recsAsc(), goals = goalsList();
    var html = '<div class="wk-tip-note" style="margin:0 0 2px;">Цели — на текущий месяц (' + esc(monthTitle(key)) +
      '). Пока цель не достигнута, другую того же вида поставить нельзя. За каждую достигнутую цель — награда.</div>';
    GOAL_TYPES.forEach(function(gt){
      html += '<div class="wk-rec-cat">' + esc(gt.title) + '</div>';
      var cum = monthProgress(gt.key, key, asc);
      var mine = goals.filter(function(g){ return g.type === gt.key && g.month === key; })
        .sort(function(a, b){ return a.target - b.target; });
      var open = mine.filter(function(g){ return !g.done; })[0];
      mine.forEach(function(g){ html += goalCardHtml(g, cum); });
      if(open){
        html += '<div class="wk-tip-note">Другую цель можно будет поставить, когда эта будет достигнута.</div>';
        return;
      }
      var opts = gt.opts.filter(function(o){ return o > cum; });
      if(goalSel[gt.key] && opts.indexOf(goalSel[gt.key]) === -1) goalSel[gt.key] = 0;
      if(!opts.length){
        html += '<div class="wk-tip-note">Все цели этого вида на ' + esc(MONTHS[now.getMonth()].toLowerCase()) + ' уже превзойдены.</div>';
        return;
      }
      html += '<div class="wk-tip-note" style="margin:0 0 6px;">' + (mine.length ? "Можно поставить следующую:" : "Выберите цель:") + '</div><div>';
      opts.forEach(function(o){
        html += '<button type="button" class="wk-seg-btn' + (goalSel[gt.key] === o ? " on" : "") + '" data-gsel="' + gt.key + ':' + o + '">' +
          esc(monthTitle(key) + " · " + targetLabel(gt.key, o)) + '</button>';
      });
      html += '</div>';
      var sel = goalSel[gt.key];
      html += '<button type="button" class="wk-goal-set" data-gset="' + gt.key + '"' + (sel ? "" : " disabled") + '>' +
        (sel ? esc("Поставить цель: " + targetLabel(gt.key, sel)) : "Поставить цель") + '</button>';
    });
    // прошлые месяцы: достигнутые и нет
    var past = goals.filter(function(g){ return g.month !== key; })
      .sort(function(a, b){ return a.month < b.month ? 1 : (a.month > b.month ? -1 : (a.type < b.type ? -1 : b.target - a.target)); });
    if(past.length){
      html += '<div class="wk-rec-cat">Прошлые цели</div><div class="wk-card" style="padding:4px 12px;">';
      past.slice(0, 12).forEach(function(g){
        var res = g.done ? "✓ достигнута" : esc(progText(g.type, monthProgress(g.type, g.month, asc), g.target));
        html += '<div class="wk-rec"><span class="wk-rec-name">' + esc(goalLabel(g)) + '<span class="wk-sub">' + esc(goalType(g.type).title) +
          '</span></span><span class="wk-rec-val' + (g.done ? "" : " wait") + '">' + res + '</span></div>';
      });
      html += '</div>';
    }
    return html;
  }

  // ---------- награды ----------
  // Награда = запись личного state `wkaward:<id>` = {c:{ts (когда заслужена), at (когда записана)}, t}.
  // Условия считаются по записям тренировок и целям (`AWARD_DEFS`); раз полученная награда остаётся, даже если запись потом удалили.
  var AWARD_DEFS = null;
  function awardsMap(){
    var map = {};
    if(!STORE || typeof STORE.listAwards !== "function") return map;
    var list = [];
    try{ list = STORE.listAwards() || []; }catch(e){ list = []; }
    list.forEach(function(a){ if(a && a.id && num(a.ts) > 0) map[a.id] = a; }); // запись только с `reset` (награду обнулили) — не «получена»
    return map;
  }
  // обнулённые награды: id → момент обнуления; считаются только тренировки и цели после него
  function awardResets(){
    var map = {};
    if(!STORE || typeof STORE.listAwards !== "function") return map;
    var list = [];
    try{ list = STORE.listAwards() || []; }catch(e){ list = []; }
    list.forEach(function(a){ if(a && a.id && !(num(a.ts) > 0) && num(a.reset) > 0) map[a.id] = num(a.reset); });
    return map;
  }
  // контекст расчёта для награды с учётом обнуления (одинаковые «с какого момента» считаются один раз)
  function awardCtxFor(){
    var resets = awardResets(), cache = {};
    return function(id){
      var s = resets[id] || 0;
      return cache[s] || (cache[s] = awardCtx(s));
    };
  }
  function resetAward(id){
    if(!STORE || typeof STORE.putAwardMany !== "function") return false;
    try{ STORE.putAwardMany([{ id: id, c: { reset: Date.now() } }]); }catch(e){ return false; }
    // иначе сообщение о повторной награде не появится: pushNotice не повторяет уже бывший ключ
    writeJson(NOTICE_KEY, readNotices().filter(function(x){ return !(x && x.k === "a:" + id); }));
    lastShape = "";
    return true;
  }

  function awardCtx(since){
    since = num(since);
    var asc = recsAsc();
    if(since > 0) asc = asc.filter(function(r){ return r.start >= since; });
    var runs = asc.filter(function(r){ return num(r.m) > 0; });
    var timed = runs.filter(function(r){ return !r.imp && num(r.totalMs) > 0; });
    var x = { asc: asc, runs: runs, timed: timed, goals: goalsList().filter(function(g){ return !(since > 0) || (g.done && g.done >= since); }), totalM: 0, maxM: 0, maxMs: 0, maxUp: 0, totalUp: 0,
      maxStreak: 0, streakReach: {}, bestRace: {}, early: [], owl: [] };
    var dayLast = {};
    runs.forEach(function(r){
      x.totalM += num(r.m);
      if(num(r.m) > x.maxM) x.maxM = num(r.m);
      var k = dayKey(new Date(r.start));
      if(!dayLast[k] || r.start > dayLast[k]) dayLast[k] = r.start;
      var h = new Date(r.start).getHours();
      if(h >= 4 && h < 7) x.early.push(r);
      if(h >= 21 || h < 4) x.owl.push(r);
    });
    asc.forEach(function(r){
      if(num(r.totalMs) > x.maxMs) x.maxMs = num(r.totalMs);
      if(!r.man && num(r.up) > x.maxUp) x.maxUp = num(r.up);
      x.totalUp += num(r.up);
    });
    timed.forEach(function(r){
      REC_DISTS.forEach(function(d){
        var m = num(r.m);
        if(m < d.m * REC_DIST_MIN || m > d.m * REC_DIST_MAX) return;
        var ms = num(r.totalMs) * d.m / m;
        var cur = x.bestRace[d.key];
        if(!cur || ms < cur) x.bestRace[d.key] = ms;
      });
    });
    var keys = Object.keys(dayLast).sort();
    var prevIdx = null, len = 0;
    keys.forEach(function(k){
      var p = k.split("-");
      var idx = Math.round(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)) / 86400000);
      len = (prevIdx !== null && idx === prevIdx + 1) ? len + 1 : 1;
      prevIdx = idx;
      if(len > x.maxStreak) x.maxStreak = len;
      if(!x.streakReach[len]) x.streakReach[len] = dayLast[k];
    });
    return x;
  }

  function cumReach(list, fn, target){
    var s = 0;
    for(var i = 0; i < list.length; i++){
      s += fn(list[i]);
      if(s >= target) return endOf(list[i]);
    }
    return 0;
  }
  function firstWhere(list, pred){
    for(var i = 0; i < list.length; i++){ if(pred(list[i])) return endOf(list[i]); }
    return 0;
  }
  function goalDoneTs(ctx, type, target){
    var best = 0;
    ctx.goals.forEach(function(g){
      if(g.done && g.type === type && g.target === target && (!best || g.done < best)) best = g.done;
    });
    return best;
  }

  function buildAwardDefs(){
    var out = [];
    function add(cat, id, title, text, calc, prog){ out.push({ cat: cat, id: id, title: title, text: text, calc: calc, prog: prog || null, noNotice: false }); }
    var C = AWARD_CATS;
    var distName = { "5": "5 км", "10": "10 км", "21": "21,1 км", "42": "42,2 км" };

    add(C[0], "first", "Первая тренировка", "Записана первая тренировка с пройденными километрами.",
      function(x){ return x.runs.length ? endOf(x.runs[0]) : 0; });
    REC_DISTS.forEach(function(d){
      var title = d.key === "21" ? "Первый полумарафон (" + distName[d.key] + ")" : (d.key === "42" ? "Первый марафон (" + distName[d.key] + ")" : "Первые " + d.label);
      var need = d.m * REC_DIST_MIN;
      add(C[0], "d" + d.key, title, "Одна тренировка не короче 98 % дистанции" + (d.key === "5" || d.key === "10" ? " " + distName[d.key] : "") + " — от " + fmtKm(need) + ".",
        function(x){ return firstWhere(x.runs, function(r){ return num(r.m) >= need; }); },
        function(x){ return x.maxM > 0 ? "самая длинная: " + fmtKm(x.maxM) : ""; });
    });

    [[100, "Сто километров"], [500, "Пятьсот километров"], [1000, "Тысяча километров"], [2000, "Две тысячи километров"]].forEach(function(p){
      add(C[1], "c" + p[0], p[1], "Суммарно пройдено " + p[0] + " км.",
        function(x){ return cumReach(x.runs, function(r){ return num(r.m) / 1000; }, p[0]); },
        function(x){ return fmtKm(x.totalM) + " из " + p[0] + " км"; });
    });

    [10, 50, 100, 250].forEach(function(n){
      add(C[2], "n" + n, n + " " + plural(n, "тренировка", "тренировки", "тренировок"), "Записано " + n + " " + plural(n, "тренировка", "тренировки", "тренировок") + " с километрами.",
        function(x){ return x.runs.length >= n ? endOf(x.runs[n - 1]) : 0; },
        function(x){ return x.runs.length + " из " + n; });
    });
    [[3, "3 дня подряд"], [7, "Неделя подряд"], [14, "Две недели подряд"], [30, "Месяц подряд"]].forEach(function(p){
      add(C[2], "s" + p[0], p[1], "Тренировки " + p[0] + " " + plural(p[0], "день", "дня", "дней") + " подряд.",
        function(x){ return x.streakReach[p[0]] || 0; },
        function(x){ return "лучшая серия: " + x.maxStreak + " из " + p[0]; });
    });

    [[60, "Час в движении"], [120, "Два часа в движении"]].forEach(function(p){
      add(C[3], "t" + p[0], p[1], "Одна тренировка длиной от " + (p[0] / 60) + " " + plural(p[0] / 60, "часа", "часов", "часов") + ".",
        function(x){ return firstWhere(x.timed, function(r){ return num(r.totalMs) >= p[0] * 60000; }); },
        function(x){ return x.maxMs > 0 ? "самая долгая: " + fmtTotal(x.maxMs) : ""; });
    });
    [[100, "Первая сотня метров вверх"], [500, "Горный бегун"]].forEach(function(p){
      add(C[3], "u" + p[0], p[1], "За одну тренировку набрано от " + p[0] + " м высоты.",
        function(x){ return firstWhere(x.asc, function(r){ return !r.man && num(r.up) >= p[0]; }); },
        function(x){ return x.maxUp > 0 ? "наибольший набор: " + Math.round(x.maxUp) + " м" : ""; });
    });
    [[1000, "Тысяча метров вверх"], [8849, "Эверест"]].forEach(function(p){
      add(C[3], "uc" + p[0], p[1], "Суммарный набор высоты " + p[0] + " м" + (p[0] === 8849 ? " — как высота Эвереста." : "."),
        function(x){ return cumReach(x.asc, function(r){ return num(r.up); }, p[0]); },
        function(x){ return Math.round(x.totalUp) + " из " + p[0] + " м"; });
    });

    [["5", 30, "5 км быстрее 30 минут"], ["5", 25, "5 км быстрее 25 минут"], ["10", 60, "10 км быстрее часа"], ["10", 50, "10 км быстрее 50 минут"],
     ["21", 120, "Полумарафон быстрее 2 часов"], ["42", 240, "Марафон быстрее 4 часов"]].forEach(function(p){
      var d = null;
      REC_DISTS.forEach(function(q){ if(q.key === p[0]) d = q; });
      var limit = p[1] * 60000;
      add(C[4], "p" + p[0] + "_" + p[1], p[2], "Время на дистанции меньше " + p[1] + " мин (по целой тренировке длиной " + fmtKm(d.m * REC_DIST_MIN).replace(" км", "") + "–" + fmtKm(d.m * REC_DIST_MAX).replace(" км", "") + " км).",
        function(x){
          return firstWhere(x.timed, function(r){
            var m = num(r.m);
            if(m < d.m * REC_DIST_MIN || m > d.m * REC_DIST_MAX) return false;
            return num(r.totalMs) * d.m / m < limit;
          });
        },
        function(x){ return x.bestRace[d.key] ? "лучшее время: " + fmtClock(x.bestRace[d.key]) : ""; });
    });

    add(C[5], "early", "Ранняя пташка", "5 тренировок, начатых между 4:00 и 7:00.",
      function(x){ return x.early.length >= 5 ? endOf(x.early[4]) : 0; }, function(x){ return x.early.length + " из 5"; });
    add(C[5], "owl", "Сова", "5 тренировок, начатых между 21:00 и 4:00.",
      function(x){ return x.owl.length >= 5 ? endOf(x.owl[4]) : 0; }, function(x){ return x.owl.length + " из 5"; });
    add(C[5], "year", "Год в движении", "Прошёл год с первой записанной тренировки.",
      function(x){
        if(!x.runs.length) return 0;
        var ts = x.runs[0].start + 365 * 86400000;
        return ts <= Date.now() ? ts : 0;
      },
      function(x){
        if(!x.runs.length) return "";
        return "прошло " + Math.max(0, Math.floor((Date.now() - x.runs[0].start) / 86400000)) + " из 365 дн.";
      });

    add(C[6], "g1", "Первая цель", "Достигнута первая цель месяца.",
      function(x){
        var best = 0;
        x.goals.forEach(function(g){ if(g.done && (!best || g.done < best)) best = g.done; });
        return best;
      });
    add(C[6], "g3", "Тройная цель", "В одном месяце достигнуты цели и по километражу, и по набору высоты, и по времени.",
      function(x){
        var byMonth = {}, best = 0;
        x.goals.forEach(function(g){
          if(!g.done) return;
          var m = byMonth[g.month] = byMonth[g.month] || {};
          if(!m[g.type] || g.done < m[g.type]) m[g.type] = g.done;
        });
        Object.keys(byMonth).forEach(function(k){
          var m = byMonth[k];
          if(!m.km || !m.up || !m.time) return;
          var ts = Math.max(m.km, m.up, m.time);
          if(!best || ts < best) best = ts;
        });
        return best;
      });
    GOAL_TYPES.forEach(function(gt){
      gt.opts.forEach(function(o){
        add(C[6], "gt_" + gt.key + "_" + o, goalAwardTitle(gt.key, o), gt.awardText + " " + targetLabel(gt.key, o) + ".",
          function(x){ return goalDoneTs(x, gt.key, o); });
        out[out.length - 1].noNotice = true; // о цели сообщает карточка самой цели
      });
    });
    return out;
  }
  function awardDefs(){ if(!AWARD_DEFS) AWARD_DEFS = buildAwardDefs(); return AWARD_DEFS; }

  // пересчёт наград: новые записываются одной пачкой и о каждой новой есть сообщение (непрочитанные ждут, пока открывают экран кубка);
  // исключение — самый первый пересчёт на устройстве: там молчат награды старше NOTICE_RECENT_MS (старая история)
  function evalAwards(){
    var stored = awardsMap(), ctxFor = awardCtxFor(), now = Date.now(), items = [];
    var base = false;
    try{ base = localStorage.getItem(AWARD_BASE_KEY) === "1"; }catch(e){ base = true; }
    awardDefs().forEach(function(def){
      if(stored[def.id]) return;
      var ts = def.calc(ctxFor(def.id));
      if(!(ts > 0)) return;
      items.push({ id: def.id, c: { ts: ts, at: now } });
      if(def.noNotice || (!base && ts < now - NOTICE_RECENT_MS)) return;
      pushNotice({ k: "a:" + def.id, kind: "award", tab: "awards", text: "Новая награда: «" + def.title + "». " + def.text });
    });
    if(items.length){ try{ STORE.putAwardMany(items); }catch(e){} }
    if(!base){ try{ localStorage.setItem(AWARD_BASE_KEY, "1"); }catch(e){} }
  }

  function evalProgress(){
    if(!STORE || typeof STORE.putGoal !== "function" || typeof STORE.putAwardMany !== "function") return;
    try{ evalGoals(); }catch(e){}
    try{ evalAwards(); }catch(e){}
  }

  function awardsBodyHtml(){
    var stored = awardsMap(), ctxFor = awardCtxFor(), defs = awardDefs();
    var got = defs.filter(function(d){ return !!stored[d.id]; }).length;
    var html = '<div class="wk-tip-note" style="margin:0 0 2px;">Получено наград: ' + got + ' из ' + defs.length + '.</div>';
    AWARD_CATS.forEach(function(cat){
      var part = defs.filter(function(d){ return d.cat === cat; });
      if(!part.length) return;
      html += '<div class="wk-rec-cat">' + esc(cat) + '</div><div class="wk-card" style="padding:4px 12px;">';
      part.forEach(function(d){
        var st = stored[d.id];
        var meta = st ? "Получена " + fmtDate(st.ts) : (d.prog ? d.prog(ctxFor(d.id)) : "");
        html += '<div class="wk-rec wk-award' + (st ? " on" : "") + '"' + (st ? ' data-aid="' + esc(d.id) + '"' : "") + '><span class="wk-medal">' + MEDAL_ICON_SVG + '</span>' +
          '<span class="wk-rec-name">' + esc(d.title) + '<span class="wk-sub">' + esc(d.text) + '</span>' +
          (meta ? '<span class="wk-sub wk-award-meta">' + esc(meta) + '</span>' : "") + '</span></div>';
      });
      html += '</div>';
    });
    return html;
  }

  // ---------- сообщения о целях и наградах (вместо совета дня) ----------
  // Событие (награда / 50 % / 75 % / цель достигнута) записывается на устройстве и показывается в области совета дня весь день события;
  // на следующие дни остаётся, пока человек не открыл экран кубка (хоть через месяц). Открыл — на следующий день уже совет дня.
  function dayIndex(key){
    var p = String(key).split("-");
    return Math.round(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)) / 86400000);
  }
  function readNotices(){
    var v = readJson(NOTICE_KEY, []);
    return Array.isArray(v) ? v : [];
  }
  function pushNotice(it){
    var list = readNotices(), today = dayKey();
    if(list.some(function(x){ return x && x.k === it.k; })) return;
    it.day = today; it.ts = Date.now(); it.seen = 0;
    list.push(it);
    var ti = dayIndex(today);
    list = list.filter(function(x){ return x && x.day && (!x.seen ? true : ti - dayIndex(x.day) <= 1); });
    if(list.length > NOTICE_KEEP_MAX) list = list.slice(list.length - NOTICE_KEEP_MAX);
    writeJson(NOTICE_KEY, list);
    lastShape = "";
  }
  function visibleNotices(){
    var today = dayKey(), ti = dayIndex(today);
    return readNotices().filter(function(x){
      if(!x || !x.day) return false;
      var age = ti - dayIndex(x.day);
      return age === 0 || (!x.seen && age > 0);
    }).sort(function(a, b){ return num(b.ts) - num(a.ts); });
  }
  function markNoticesSeen(){
    var list = readNotices(), ch = false;
    list.forEach(function(x){ if(x && !x.seen){ x.seen = 1; ch = true; } });
    if(ch) writeJson(NOTICE_KEY, list);
  }
  function noticeToShow(){
    var vis = visibleNotices();
    if(!vis.length) return null;
    var shown = vis.slice(0, 3);
    var hasAward = shown.some(function(x){ return x.kind === "award" || String(x.k).indexOf("gd:") === 0; });
    return {
      sig: shown.map(function(x){ return x.k; }).join(","),
      head: hasAward ? "Награда" : "Цель месячного плана",
      lines: shown.map(function(x){ return x.text; }),
      more: vis.length - shown.length,
      tab: shown[0].tab === "awards" ? "awards" : "goals"
    };
  }
  function noticeCardHtml(n){
    return '<div class="wk-card wk-tip wk-notice" id="wkNoticeCard" data-tab="' + esc(n.tab) + '"><div class="wk-live-head"><span class="wk-tip-ico">' + CUP_ICON_SVG + '</span><span>' + esc(n.head) + '</span></div>' +
      n.lines.map(function(l){ return '<div class="wk-tip-text">' + esc(l) + '</div>'; }).join("") +
      '<div class="wk-note wk-tip-meta">' + (n.more > 0 ? "и ещё " + n.more + " · " : "") + 'Нажмите, чтобы открыть</div></div>';
  }

  // ---------- сам экран ----------
  function renderTrophyScreen(tab){
    var c = container();
    if(!c) return;
    infoScreen = true;
    ensureStyle();
    if(trophyIndex(tab) === -1) tab = loadTrophyTab();
    trophyTab = tab;
    try{ localStorage.setItem(TROPHY_TAB_KEY, tab); }catch(e){}
    var keep = document.getElementById("wkTrophy") ? { c: c.scrollTop, b: document.getElementById("wkTrophy").scrollTop } : null;
    evalProgress();
    markNoticesSeen();
    var body = tab === "goals" ? goalsBodyHtml() : (tab === "awards" ? awardsBodyHtml() : recordsBodyHtml());
    c.innerHTML = swHtml(tab) + '<div class="task-info-body" id="wkTrophy">' + body + '</div><div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="wkTrophyInfoBtn" title="Как это работает" aria-label="Как это работает">' + INFO_ICON_SVG + '</button>' +
      tipsHomeBtnHtml("wkRecordsHomeBtn", "Назад к тренировкам") + '</div>';
    if(keep){
      c.scrollTop = keep.c;
      var tb = document.getElementById("wkTrophy");
      if(tb) tb.scrollTop = keep.b;
    }
    Array.prototype.forEach.call(c.querySelectorAll(".wk-sw-item"), function(it){
      it.addEventListener("click", function(){
        var k = it.getAttribute("data-wktab");
        if(k !== trophyTab) renderTrophyScreen(k);
      });
    });
    Array.prototype.forEach.call(c.querySelectorAll("[data-gsel]"), function(b){
      b.addEventListener("click", function(){
        var p = String(b.getAttribute("data-gsel")).split(":");
        goalSel[p[0]] = parseInt(p[1], 10) || 0;
        renderTrophyScreen("goals");
      });
    });
    Array.prototype.forEach.call(c.querySelectorAll("[data-gset]"), function(b){
      b.addEventListener("click", function(){
        var type = b.getAttribute("data-gset");
        if(goalSel[type]) setGoal(type, goalSel[type]);
        goalSel[type] = 0;
        renderTrophyScreen("goals");
      });
    });
    if(tab === "awards"){
      Array.prototype.forEach.call(c.querySelectorAll(".wk-award[data-aid]"), function(r){
        bindRowLongPress(r, function(){ askResetAward(r.getAttribute("data-aid"), r); });
      });
    }
    var ab = document.getElementById("wkTrophyInfoBtn");
    if(ab) ab.addEventListener("click", function(){
      // шаг «назад» вернёт на ту же часть кубка
      var k = trophyTab;
      if(window.AppNav) window.AppNav.push(function(){ renderTrophyScreen(k); });
      renderTrophyInfoScreen(k);
    });
    var hb = document.getElementById("wkRecordsHomeBtn");
    if(hb) hb.addEventListener("click", function(){
      // «Действие ВПЕРЁД»: шаг «назад» вернёт на этот экран — тот же приём, что у справки «i»
      if(window.AppNav) window.AppNav.push(function(){ renderTrophyScreen(trophyTab); });
      render();
    });
    bindTrophySwipe(c);
  }

  // ---------- справка частей кубка (кнопка «i» слева от «домика») ----------
  // Только общие правила; то, что уже написано на самом экране или под названием награды, не повторяется.
  function trophyInfoRows(tab){
    if(tab === "records") return [
      "Откуда берутся. Рекорды считаются по всем записям заново при каждом открытии, поэтому удалили запись — рекорд пересчитался. Сообщений о новых рекордах нет.",
      "Время и дистанция. «Максимальное время» берётся по общему времени тренировки, «Максимальная дистанция» — по километрам. У записей, импортированных из CSV, нет времени: они участвуют только в дистанции. Строка «только высота» не учитывается.",
      "Лучшее время на дистанции. Берётся только целая тренировка длиной от 98 % до 110 % дистанции: кусок внутри длинной пробежки не засчитывается. Время пересчитывается на ровную дистанцию, и темп в строке — тоже по ровной дистанции.",
      "Дистанции. Полумарафон — 21,0975 км, марафон — 42,195 км.",
      "«Ожидается» значит, что подходящей записи ещё нет."
    ];
    if(tab === "goals") return [
      "Как считается прогресс. По всем записям месяца, по дате начала тренировки: тренировка, начатая 31-го вечером, идёт в тот месяц. Километры — по записи, высота — набор (включая внесённый вручную), время — общее время тренировки. У записей, импортированных из CSV, времени нет.",
      "Что предлагается. Только значения больше уже набранного за месяц. По одной цели каждого вида можно вести одновременно: километраж, высота и время не мешают друг другу.",
      "Сообщения. На 50 % и 75 % цели текущего месяца и при достижении на вкладке «Тренировки» появляется карточка вместо совета дня. Если вы выбрали цель, когда половина или три четверти уже пройдены, об этих отметках сообщения не будет. Карточки хранятся на этом устройстве; отметки 50 %, 75 % и достижения синхронизируются, поэтому второе устройство не повторяет сообщение.",
      "Дата достижения. Это окончание той тренировки, на которой цель набрана.",
      "Достигнутая цель остаётся достигнутой, даже если тренировку потом удалили. Цель, не выполненная в свой месяц, остаётся в «Прошлых целях» с итоговым прогрессом; если позже добавить или импортировать тренировки за тот месяц и набрать нужное, она засчитается задним числом. В «Прошлых целях» показаны последние 12."
    ];
    return [
      "Что засчитывается. Награды считаются по записанным тренировкам с километрами. Строка «только высота» (метры, внесённые в день без тренировки) тренировкой не считается: в награды «за одну тренировку» по высоте она не входит, но в суммарный набор высоты метры идут. Записи, загруженные из CSV стороннего трекера, учитываются в километрах, числе тренировок, сериях и привычках; в наградах за время и скорость — нет, потому что у них нет времени.",
      "Дни в сериях. День — календарный, по дате начала тренировки (местное время). Несколько тренировок за день — один день серии.",
      "Дата награды. Это день, когда условие было выполнено, а не день, когда вы открыли экран. Старые тренировки засчитываются задним числом — в том числе после импорта.",
      "Награда не пропадает сама. Раз полученная награда остаётся, даже если тренировку потом удалили. Награды синхронизируются между вашими устройствами и входят в экспорт личных данных.",
      "Когда пересчитываются. При открытии вкладки «Тренировки», после новой записи и при открытии экрана кубка.",
      "Обнуление. Долгое нажатие на полученную награду открывает плашку с крестиком (нажатие мимо — отмена). После крестика награда пропадает, и её нужно заслужить заново с нуля: считаются только тренировки, начатые после обнуления (для наград за цели месяца — цели, достигнутые после обнуления; сами цели не меняются). Обнуление синхронизируется между устройствами; из экспорта обнулённая награда исчезает. Ещё не полученные (бледные) награды не обнуляются.",
      "Бледные и яркие. Яркая — получена (с датой), бледная — ещё нет. Под названием бледной награды — текущий прогресс; у наград без прогресса (например, «Первая цель») строки нет.",
      "Сообщения. О каждой новой награде на вкладке «Тренировки» появляется карточка вместо совета дня: весь день события, а дальше — пока вы не откроете экран кубка. Нажатие на карточку открывает награды. Исключения: о наградах за цели месяца сообщает карточка самой цели; при самом первом пересчёте на устройстве молчат награды старше 3 дней. Сообщения хранятся только на этом устройстве."
    ];
  }
  function renderTrophyInfoScreen(tab){
    var c = container();
    if(!c) return;
    infoScreen = true;
    ensureStyle();
    if(trophyIndex(tab) === -1) tab = loadTrophyTab();
    var icon = tab === "awards" ? MEDAL_ICON_SVG : CUP_ICON_SVG;
    var label = TROPHY_TABS[trophyIndex(tab)].label;
    var html = trophyInfoRows(tab).map(function(t){
      return '<div class="task-info-item"><div class="task-info-icon">' + icon + '</div><div class="task-info-text">' + esc(t) + '</div></div>';
    }).join("");
    c.innerHTML =
      '<h3 class="common-tab-title">' + esc(label) + ' — правила</h3>' +
      '<div class="task-info-body">' + html + '</div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn" id="wkTrophyInfoHomeBtn" title="Назад к «' + esc(label) + '»" aria-label="Назад к «' + esc(label) + '»">' + HOME_ICON_SVG + '</button>' +
      '</div>';
    var hb = document.getElementById("wkTrophyInfoHomeBtn");
    if(hb) hb.addEventListener("click", function(){
      // «Действие ВПЕРЁД»: шаг «назад» вернёт на эту справку
      if(window.AppNav) window.AppNav.push(function(){ renderTrophyInfoScreen(tab); });
      renderTrophyScreen(tab);
    });
  }

  // свайп влево/вправо между частями; слушатели навешиваются один раз на контейнер и работают, только пока на экране есть #wkTrophy
  var trophySwipeEl = null;
  function bindTrophySwipe(c){
    if(trophySwipeEl === c) return;
    trophySwipeEl = c;
    var sx = 0, sy = 0, st = 0, armed = false;
    c.addEventListener("touchstart", function(e){
      armed = false;
      if(!document.getElementById("wkTrophy") || !e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];
      var w = window.innerWidth || document.documentElement.clientWidth || 0;
      if(t.clientX < 24 || (w && t.clientX > w - 24)) return; // у краёв — системный жест «назад»
      sx = t.clientX; sy = t.clientY; st = Date.now(); armed = true;
    }, { passive: true });
    c.addEventListener("touchend", function(e){
      if(!armed) return;
      armed = false;
      if(!document.getElementById("wkTrophy")) return;
      var t = e.changedTouches && e.changedTouches[0];
      if(!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if(Date.now() - st > 700) return;
      if(Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
      var n = trophyIndex(trophyTab) + (dx < 0 ? 1 : -1);
      if(n < 0 || n >= TROPHY_TABS.length) return;
      renderTrophyScreen(TROPHY_TABS[n].key);
    }, { passive: true });
    c.addEventListener("touchcancel", function(){ armed = false; }, { passive: true });
  }

  // ---------- советы ----------
  // Совет = запись личного state под ключом "wktip:<id>" (хранилище my.js: listTips/putTip/removeTip) = {text, cat, rpe, dist, ts};
  // едет в облако и в экспорт вместе с остальным state. rpe: ""|"low"(1–3)|"mid"(4–6)|"high"(7–10); dist: ""|"short"|"long"; пусто = подходит всегда.
  function dayKey(d){ d = d || new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function rpeBand(v){
    v = Number(v);
    if(!rpeOk(v)) return "";
    return v <= 3 ? "low" : (v <= 6 ? "mid" : "high");
  }
  function readJson(key, def){
    try{ var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; }catch(e){ return def; }
  }
  function writeJson(key, v){ try{ localStorage.setItem(key, JSON.stringify(v)); return true; }catch(e){ return false; } }
  function newTipId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function tipsList(){
    if(!STORE || typeof STORE.listTips !== "function") return [];
    var now = Date.now();
    if(tipsCache && now - tipsCache.at < PEND_CACHE_MS) return tipsCache.val;
    var list = [];
    try{ list = STORE.listTips() || []; }catch(e){ list = []; }
    list = list.filter(function(x){ return x && typeof x.text === "string" && x.text.trim() !== ""; })
      .sort(function(a, b){ return num(a.ts) - num(b.ts); });
    tipsCache = { at: now, val: list };
    return list;
  }

  // граница «длинной» пробежки: середина (медиана) пробежек за последние TIP_LONG_DAYS дней; пробежек мало — фиксированная
  function longThreshold(){
    var n = new Date();
    var from = new Date(n.getFullYear(), n.getMonth(), n.getDate() - TIP_LONG_DAYS, 0, 0, 0, 0).getTime();
    var ms = [];
    allRecords().forEach(function(r){ if(r.start >= from && num(r.m) > 0) ms.push(num(r.m)); });
    if(ms.length < TIP_LONG_MIN_RUNS) return { m: TIP_LONG_FALLBACK_M, auto: false };
    ms.sort(function(a, b){ return a - b; });
    var h = Math.floor(ms.length / 2);
    return { m: (ms.length % 2) ? ms[h] : (ms[h - 1] + ms[h]) / 2, auto: true };
  }
  // контекст выбора совета: тяжесть и дистанция последней оценённой тренировки не старше TIP_CTX_DAYS дней; нет такой — пустой контекст
  function tipContext(){
    var n = new Date();
    var from = new Date(n.getFullYear(), n.getMonth(), n.getDate() - (TIP_CTX_DAYS - 1), 0, 0, 0, 0).getTime();
    var ref = null;
    allRecords().forEach(function(r){ // новые сверху
      if(!ref && !r.imp && r.start >= from && rpeOk(r.rpe) && num(r.m) > 0) ref = r;
    });
    if(!ref) return { rpe: "", dist: "", ref: "" };
    return { rpe: rpeBand(ref.rpe), dist: num(ref.m) >= longThreshold().m ? "long" : "short", ref: String(ref.id != null ? ref.id : ref.start) };
  }
  function tipFits(x, ctx){ return (!x.rpe || x.rpe === ctx.rpe) && (!x.dist || x.dist === ctx.dist); }

  // совет сегодняшнего дня: выбирается при первом показе за день и до полуночи не меняется, пока не появится новая оценённая
  // тренировка (её id — `ref` в записи дня): тогда выбирается новый совет под её тяжесть и дистанцию; без повторов, пока не покажутся все подходящие
  function dayTip(){
    var list = tipsList();
    if(!list.length) return null;
    var today = dayKey();
    var ctx = tipContext();
    var rec = readJson(TIP_DAY_KEY, null) || tipDayMem;
    var prevId = null;
    if(rec && rec.day === today){
      if((rec.ref || "") === ctx.ref){
        for(var i = 0; i < list.length; i++){ if(list[i].id === rec.id) return list[i]; }
      } else {
        prevId = rec.id; // основание для совета изменилось (новая оценённая тренировка) — прежний совет не повторяем
      }
    }
    var pool = list.filter(function(x){ return tipFits(x, ctx); });
    if(!pool.length) return null;
    var seen = readJson(TIP_SEEN_KEY, []);
    if(!Array.isArray(seen)) seen = [];
    var fresh = pool.filter(function(x){ return seen.indexOf(x.id) === -1 && x.id !== prevId; });
    if(!fresh.length){
      seen = seen.filter(function(id){ return !pool.some(function(x){ return x.id === id; }); });
      fresh = pool.filter(function(x){ return x.id !== prevId; });
      if(!fresh.length) fresh = pool;
    }
    var pick = fresh[Math.floor(Math.random() * fresh.length)];
    seen.push(pick.id);
    writeJson(TIP_SEEN_KEY, seen);
    var dayRec = { day: today, id: pick.id, ref: ctx.ref };
    tipDayMem = writeJson(TIP_DAY_KEY, dayRec) ? null : dayRec; // в памяти держим, только если localStorage не принял запись
    return pick;
  }

  function tipCardHtml(x){
    return '<div class="wk-card wk-tip" id="wkTipCard"><div class="wk-live-head"><span class="wk-tip-ico">' + TIP_ICON_SVG + '</span><span>Совет дня</span></div>' +
      '<div class="wk-tip-text">' + esc(x.text).replace(/\n/g, "<br>") + '</div>' +
      '<div class="wk-note wk-tip-meta">' + esc(x.cat || "Другое") + '</div></div>';
  }

  // ---------- экран «Советы» (кнопка-лампочка в нижнем ряду) ----------
  function tipCatOf(x){ return TIP_CATS.indexOf(x.cat) !== -1 ? x.cat : "Другое"; }
  function tipTagsText(x){
    var out = [];
    if(x.rpe === "low") out.push("тяжесть 1–3");
    else if(x.rpe === "mid") out.push("тяжесть 4–6");
    else if(x.rpe === "high") out.push("тяжесть 7–10");
    if(x.dist === "short") out.push("короткая дистанция");
    else if(x.dist === "long") out.push("длинная дистанция");
    return out.length ? out.join(" · ") : "подходит всегда";
  }
  function clearTipArm(){ if(tipDelArm){ clearTimeout(tipDelArm.timer); tipDelArm = null; } }
  function tipsHomeBtnHtml(id, title){
    return '<button type="button" class="mdeditor-fab-btn" id="' + id + '" title="' + title + '" aria-label="' + title + '">' + HOME_ICON_SVG + '</button>';
  }

  function renderTipsScreen(){
    var c = container();
    if(!c) return;
    infoScreen = true;
    tipEdit = null;
    clearTipArm();
    tipsCache = null;
    var list = tipsList();
    var thr = longThreshold();
    var html = '<h3 class="common-tab-title">Советы</h3><div class="task-info-body">';
    html += '<div class="wk-tip-note" style="margin:0 0 4px;">Длинная пробежка сейчас — от ' + esc(fmtKm(thr.m)) +
      (thr.auto ? " (середина ваших пробежек за 3 месяца)." : " (пока мало пробежек — граница фиксированная).") + '</div>';
    if(!list.length){
      html += '<div class="wk-empty">Советов пока нет.<br>Нажмите «+», чтобы добавить.</div>';
    } else {
      TIP_CATS.forEach(function(cat){
        var part = list.filter(function(x){ return tipCatOf(x) === cat; });
        if(!part.length) return;
        html += '<div class="wk-tip-cat">' + esc(cat) + '</div>';
        part.forEach(function(x){
          html += '<div class="wk-tip-row" data-tip="' + esc(x.id) + '">' + esc(x.text).replace(/\n/g, "<br>") + '<span class="wk-sub">' + esc(tipTagsText(x)) + '</span></div>';
        });
      });
    }
    html += '</div><div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="wkTipAddBtn" title="Добавить совет" aria-label="Добавить совет">' + PLUS_ICON_SVG + '</button>' +
      tipsHomeBtnHtml("wkTipsHomeBtn", "Назад к тренировкам") + '</div>';
    c.innerHTML = html;
    var add = document.getElementById("wkTipAddBtn");
    if(add) add.addEventListener("click", function(){ renderTipForm(null); });
    Array.prototype.forEach.call(c.querySelectorAll(".wk-tip-row"), function(row){
      row.addEventListener("click", function(){
        var id = row.getAttribute("data-tip"), found = null;
        tipsList().forEach(function(x){ if(x.id === id) found = x; });
        if(found) renderTipForm(found);
      });
    });
    var hb = document.getElementById("wkTipsHomeBtn");
    if(hb) hb.addEventListener("click", function(){
      // «Действие ВПЕРЁД»: шаг «назад» вернёт на этот экран — тот же приём, что у справки «i»
      if(window.AppNav) window.AppNav.push(function(){ renderTipsScreen(); });
      render();
    });
  }

  function segHtml(field, opts, cur){
    return opts.map(function(o){
      return '<button type="button" class="wk-seg-btn' + (o[0] === cur ? " on" : "") + '" data-f="' + field + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join("");
  }

  // x — существующий совет или null (новый)
  function renderTipForm(x){
    var c = container();
    if(!c) return;
    infoScreen = true;
    clearTipArm();
    tipEdit = {
      id: x ? x.id : "", ts: x ? num(x.ts) : 0,
      cat: x ? tipCatOf(x) : TIP_CATS[0], rpe: x ? (x.rpe || "") : "", dist: x ? (x.dist || "") : "",
      text: x ? x.text : ""
    };
    var html = '<h3 class="common-tab-title">' + (x ? "Совет" : "Новый совет") + '</h3><div class="task-info-body">' +
      '<textarea id="wkTipText" class="wk-tip-input" rows="5" placeholder="Текст совета">' + esc(tipEdit.text) + '</textarea>' +
      '<div class="wk-tip-lbl">Категория</div>' + segHtml("cat", TIP_CATS.map(function(k){ return [k, k]; }), tipEdit.cat) +
      '<div class="wk-tip-lbl">Тяжесть последней тренировки</div>' + segHtml("rpe", TIP_RPE_OPTS, tipEdit.rpe) +
      '<div class="wk-tip-lbl">Дистанция последней тренировки</div>' + segHtml("dist", TIP_DIST_OPTS, tipEdit.dist) +
      '<div class="wk-tip-note">«Любая» — отметка не учитывается. Отметки сравниваются с последней оценённой тренировкой за ' + TIP_CTX_DAYS +
      ' дня; если такой нет, показываются только советы без отметок.</div>' +
      '<div class="wk-tip-err" id="wkTipErr"></div>' +
      (x ? '<button type="button" class="wk-del" id="wkTipDel" style="margin-top:14px;">Удалить</button>' : "") +
      '</div><div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="wkTipSaveBtn" title="Сохранить" aria-label="Сохранить">' + CHECK_ICON_SVG + '</button>' +
      tipsHomeBtnHtml("wkTipFormHomeBtn", "К списку советов") + '</div>';
    c.innerHTML = html;
    Array.prototype.forEach.call(c.querySelectorAll(".wk-seg-btn"), function(b){
      b.addEventListener("click", function(){
        var f = b.getAttribute("data-f");
        tipEdit[f] = b.getAttribute("data-v") || "";
        Array.prototype.forEach.call(c.querySelectorAll('.wk-seg-btn[data-f="' + f + '"]'), function(o){ o.classList.toggle("on", o === b); });
      });
    });
    var sv = document.getElementById("wkTipSaveBtn");
    if(sv) sv.addEventListener("click", saveTipForm);
    var hb = document.getElementById("wkTipFormHomeBtn");
    if(hb) hb.addEventListener("click", renderTipsScreen);
    var del = document.getElementById("wkTipDel");
    if(del) del.addEventListener("click", function(){ onTipDelete(del); });
  }

  function saveTipForm(){
    if(!tipEdit) return;
    var ta = document.getElementById("wkTipText"), err = document.getElementById("wkTipErr");
    var text = ta ? String(ta.value).trim() : "";
    if(!text){
      if(err) err.textContent = "Введите текст совета.";
      if(ta) ta.focus();
      return;
    }
    if(!STORE || typeof STORE.putTip !== "function"){
      if(err) err.textContent = "Хранилище недоступно. Перезапустите приложение.";
      return;
    }
    var id = tipEdit.id || newTipId();
    try{ STORE.putTip(id, { text: text, cat: tipEdit.cat, rpe: tipEdit.rpe, dist: tipEdit.dist, ts: tipEdit.ts || Date.now() }); }
    catch(e){ if(err) err.textContent = "Не удалось сохранить совет. Попробуйте ещё раз."; return; }
    tipsCache = null;
    renderTipsScreen();
  }

  // два нажатия, как у удаления записи тренировки
  function onTipDelete(btn){
    var id = tipEdit && tipEdit.id;
    if(!id) return;
    if(tipDelArm && tipDelArm.id === id){
      clearTipArm();
      try{ if(STORE && typeof STORE.removeTip === "function") STORE.removeTip(id); }catch(e){}
      tipsCache = null;
      renderTipsScreen();
      return;
    }
    clearTipArm();
    btn.textContent = "Нажмите ещё раз";
    btn.classList.add("armed");
    tipDelArm = { id: id, timer: setTimeout(function(){
      tipDelArm = null;
      if(btn.isConnected !== false){ btn.textContent = "Удалить"; btn.classList.remove("armed"); }
    }, 3000) };
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
      how: (c.how === "map" || c.how === "imp" || c.how === "man") ? c.how : "raw"
    };
    if(num(c.up) > 0) o.up = Math.round(num(c.up));
    if(num(c.upMan) > 0) o.upMan = Math.round(num(c.upMan));
    if(c.man) o.man = 1;
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
      if(r && r.upd === 1 && typeof r.id === "string"){
        // достройка по карте от старых версий оболочки: сверки с картой больше нет, километры не меняем — просто убираем из очереди
        ids.push(r.id);
        return;
      }
      if(!r || typeof r.id !== "string" || typeof r.start !== "number") return;
      if(!have[r.id]){
        var c = {
          start: r.start, end: num(r.end), m: Math.round(num(r.m)), rawM: Math.round(num(r.rawM)),
          totalMs: Math.round(num(r.totalMs)), lostMs: Math.round(num(r.lostMs)),
          gaps: Array.isArray(r.gaps) ? r.gaps.filter(function(g){ return Array.isArray(g) && g.length === 2; }) : [],
          how: "raw"
        };
        if(num(r.up) > 0) c.up = Math.round(num(r.up));
        if(num(r.jumps) > 0) c.jumps = Math.round(num(r.jumps));
        c.needRpe = 1; // сначала оценка тяжести (sRPE), итоговая карточка появится после неё; метка едет в облако вместе с записью
        try{ STORE.put(r.id, c); }catch(e){ return; }
        have[r.id] = true;
        pendCache = null;
      }
      ids.push(r.id);
    });
    if(ids.length){ try{ n.workoutAckFinished(JSON.stringify(ids)); }catch(e){} }
    evalProgress();
    refreshIfOpen();
    refreshTabMark();
  }

  // «+ к высоте» (карточка/QR из itemcards.js): метры добавляются к последней сегодняшней тренировке (up и upMan — «внесено вручную»);
  // сегодня тренировки не было — в запись-строку того же дня (`man:1`, без км и времени), она идёт только в счётчик высоты.
  // → {status:"added", onto:"workout"|"alone", total (набор высоты за сегодня, м)} | {status:"error"}
  var CLIMB_MAX = 9999;
  function addClimb(m){
    m = Math.round(num(m));
    if(!STORE || !(m >= 1) || m > CLIMB_MAX) return { status: "error" };
    try{ drain(); }catch(e){}
    var now = new Date();
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    var today = allRecords().filter(function(r){ return r.start >= d0 && r.start < d1; }); // новые сверху
    var target = null, alone = null;
    today.forEach(function(r){ if(r.man){ if(!alone) alone = r; } else if(!target) target = r; });
    var rec = target || alone, onto = target ? "workout" : "alone";
    try{
      if(rec){
        var c = {};
        Object.keys(rec).forEach(function(k){ if(k !== "id") c[k] = rec[k]; });
        c.up = Math.round(num(rec.up)) + m;
        c.upMan = Math.round(num(rec.upMan)) + m;
        STORE.put(rec.id, c);
      } else {
        var ts = Date.now(), d = new Date(ts);
        STORE.put("man-" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()),
          { start: ts, end: ts, m: 0, rawM: 0, totalMs: 0, lostMs: 0, gaps: [], how: "man", man: 1, up: m, upMan: m });
      }
    }catch(e){ return { status: "error" }; }
    pendCache = null;
    try{ evalProgress(); }catch(e){}
    refreshIfOpen();
    var total = 0;
    allRecords().forEach(function(r){ if(r.start >= d0 && r.start < d1) total += num(r.up); });
    return { status: "added", onto: onto, total: Math.round(total) };
  }

  // вкладка открыта — перерисовать (после слияния с облаком, после забора записей)
  function refreshIfOpen(){
    pendCache = null;
    tipsCache = null;
    refreshTabMark();
    var btn = document.getElementById("settingsTabWorkoutsBtn");
    if(!btn || !btn.classList.contains("active")) return;
    if(infoScreen) return;
    var a = document.activeElement;
    if(a && a.tagName === "INPUT") return;
    render();
  }

  window.WorkoutsTab = {
    setStore: function(s){ STORE = s; pendCache = null; tipsCache = null; startTabMark(); },
    render: function(){ infoOpen = false; importMsg = ""; tipHidden = false; saveLastResult(null); render(); }, // итоговая карточка живёт до ухода с вкладки
    drain: drain,
    addClimb: addClimb,
    // для календаря («трекеры занятий»): записи как есть — [{id, start, end, totalMs (мс чистого движения), m (метры)}], новые сверху
    records: function(){
      return allRecords().filter(function(r){ return !r.imp && !r.man; }).map(function(r){ return { id: r.id, start: r.start, end: num(r.end), totalMs: num(r.totalMs), m: num(r.m) }; });
    },
    // для экспорта (раздел `workouts` в data.json): читаемые записи, старые сверху
    exportRecords: function(){
      return allRecords().slice().reverse().map(function(r){
        var o = {
          id: r.id, date: localDate(r.start), start: new Date(r.start).toISOString(),
          km: Math.round(num(r.m) / 10) / 100, meters: Math.round(num(r.m)),
          source: r.imp ? "импорт" : (r.man ? "внесено вручную" : (r.how === "map" ? "GPS + карта" : "GPS"))
        };
        if(!r.imp){
          o.rawMeters = Math.round(num(r.rawM));
          o.totalSeconds = Math.round(num(r.totalMs) / 1000);
          o.minutes = minutesOf(r);
          o.lostSeconds = Math.round(num(r.lostMs) / 1000);
          if(num(r.up) > 0) o.climbMeters = Math.round(num(r.up));
          if(num(r.upMan) > 0) o.manualClimbMeters = Math.round(num(r.upMan));
          if(num(r.jumps) > 0) o.gpsJumps = Math.round(num(r.jumps));
          if(rpeOk(r.rpe)){ o.rpe = Number(r.rpe); o.points = loadOf(r); }
        }
        return o;
      });
    },
    // для экспорта (раздел `workouts` в data.json): советы как есть, по категориям
    exportTips: function(){
      return tipsList().map(function(x){
        return { category: x.cat || "Другое", text: x.text, rpe: x.rpe || "", distance: x.dist || "" };
      });
    },
    // для экспорта (раздел `workouts` в data.json): цели месяцев (прогресс пересчитывается по записям)
    exportGoals: function(){
      var asc = recsAsc();
      return goalsList().sort(function(a, b){ return a.month < b.month ? -1 : (a.month > b.month ? 1 : (a.type < b.type ? -1 : a.target - b.target)); }).map(function(g){
        var cum = monthProgress(g.type, g.month, asc);
        var o = { month: g.month, kind: goalType(g.type).title, target: g.target + " " + goalType(g.type).unit,
          progress: (g.type === "km" ? Math.round(cum * 10) / 10 : (g.type === "up" ? Math.round(cum) : Math.round(cum * 10) / 10)) + " " + goalType(g.type).unit,
          achieved: !!g.done };
        if(g.done) o.achievedDate = localDate(g.done);
        return o;
      });
    },
    // для экспорта: полученные награды (без служебных записей), по дате
    exportAwards: function(){
      var stored = awardsMap(), out = [];
      awardDefs().forEach(function(d){ if(stored[d.id]) out.push({ title: d.title, description: d.text, date: localDate(stored[d.id].ts), ts: stored[d.id].ts }); });
      out.sort(function(a, b){ return a.ts - b.ts; });
      return out.map(function(o){ return { title: o.title, description: o.description, date: o.date }; });
    },
    refreshIfOpen: refreshIfOpen,
    refreshTabMark: refreshTabMark,
    start: function(){ var r = startNative(); if(r === "rpe") setMessage("Сначала оцените предыдущую тренировку — окно с вопросом выше.", ""); else if(r === "gps_off") setMessage("GPS выключен. Включите геолокацию и нажмите «Запись» снова.", "gps"); else if(r === "permission") setMessage("Разрешите доступ к геолокации в окне системы — запись начнётся сама.", ""); return r; }
  };
})();
