/* ===========================================================================
   widgets.js
   Версия: 7.13 (21.11) — `dropNote` (заметка снята двойным нажатием в самом виджете) больше не показывает тост; тост остаётся только при двойном нажатии на карточку-заметку в приложении (`dropNoteEverywhere`). Откат: widgets.js 7.12.
   Версия: 7.12 (21.11) — свой тост при снятии заметки со всех виджетов («…в ваших виджетах», `TOAST_NOTE_OFF_ALL`). Откат: widgets.js 7.11.
   Версия: 7.11 (21.11) — `dropNoteEverywhere(id)`: двойное нажатие на карточку-заметку в приложении убирает её из всех виджетов, куда она добавлена. Откат: widgets.js 7.10.
   Версия: 7.10 (21.11) — `dropNote(widgetId, key)`: заметка, снятая с виджета двойным нажатием на карточку «Заметки» (мост ≥ 40), убирается из `noteList` этого виджета. Откат: widgets.js 7.9.
   Версия: 7.9 (19.11) — галочка «Показывать карточку о том, что заряд телефона достиг 80%» (`chargeDone`, цвет `chargeColor`, палитра `icfColors7`): служебная карточка «Заряд телефона» — пока телефон на зарядке и заряд 80…100 %, наверху стопки «Можно отключать от зарядки» (оболочка, QrCharge.kt; мост менять не нужно: страница шлёт флаг и цвет в `widgetsSync`); в форме образец лица — `chargeFaceHtml`, цвет по умолчанию `CHARGE_COLOR` (зелёный). Откат: widgets.js 7.8.
   Версия: 7.8 (19.11) — у обычной карточки-таймера в стопке (не группа «Таймеры») в `cards` передаются `tsec` (заданное время, с), `tcol` (цвет) и `thid` (скрытый): оболочка рисует на ней кольцо с минутами, пока этот таймер идёт или на паузе, так что таймер, запущенный в другом виджете (или в приложении), виден и здесь — это один и тот же таймер (общее хранилище `CardTimers`). Откат: widgets.js 7.7.
   Версия: 7.7 (19.11) — своё имя виджета: поле под заголовком формы (`wgNameInput`, `name`, до 40 знаков; пусто — «Виджет N»); имя видно в списке виджетов, в выборе виджета для книги/заметки (`widgetsForBook` отдаёт `name`) и уходит оболочке полем `name`. Откат: widgets.js 7.6.
   Версия: 7.6 (19.11) — ТОЛЬКО ДИАГНОСТИКА: кнопка «▶ Виджеты: журнал оболочки» в панели отладки (`diagReport`). Откат: widgets.js 7.5.
   Версия: 7.5 (18.11) — «Отображать книги» и «Отображать заметки» — две отдельные галочки и две отдельные карточки в стопке: у виджета `books`/`bookList` (только книги) и `notes`/`noteList` (только заметки, id с приставкой `nt_`); в оболочку уходят `bks` и `nts` (у заметки — `times`: время суток приоритета, которое задано на экране «Заметки-карточки», `LTNoteCards.getTime`). Старые виджеты, где заметки лежали в `bookList`, при загрузке разносятся по двум спискам (`splitNotes`). Откат: widgets.js 7.4.
   Версия: 7.4 (18.11) — заметки-карточки в карточке «Книги»: заметку можно добавить в виджет с экрана «Заметки-карточки» (долгое нажатие → кнопка с виджетом; `toggleBook(…, "note")`). Заметка лежит в том же списке `bookList`, id с приставкой `nt_` (`isNoteId`), лицо рисует `noteFacePng` (цвет заметки, значок, название); список заметок для лиц — деп `listNotes`. Нажатие на карточку открывает заметку. Откат: widgets.js 7.3.
   Версия: 7.3 (17.11) — лицо книги шириной 480 px, как у остальных лиц (было 400): в StackView более узкая картинка не заполняла слот, книга выходила меньше и сдвинутой, а из-за неё выглядывала задняя карточка. Откат: widgets.js 7.2.
   Версия: 7.2 (17.11) — галочка «Отображать книги» (`books`, список книг виджета — `bookList`: [{h: id книги, n: имя}]): в стопку добавляется ОДНА карточка со всеми книгами, добавленными в этот виджет на экране «Книги-карточки» (долгое нажатие на книге → кнопка со списком виджетов; `WidgetsTab.toggleBook`, `widgetsForBook`; тосты — здесь же). Лицо книги (обложка по положению, цветной выступ как в приложении, у книги без обложки — название на заглушке) рисует страница (`bookFacePng`, ключ картинки `bk_<id>`) и шлёт оболочке; в `bks` уходят ключ и название. Листание краями и точки — как у карточек-групп (QrPriority `bk_0`). Откат: widgets.js 7.1.
   Версия: 7.1 (17.11) — конструктор открывается кнопкой из вкладки «QR-коды» (`render({onExit})`): на списке виджетов домик и «назад» возвращают к карточкам; вкладки колеса больше нет. Откат: widgets.js 7.0.
   Версия: 6.14 (16.11) — у привычек (экран «Привычки») и карточки «Сегодня» в времени суток появился чип «Целый день» (`a`): карточка весь день стоит выше, пока не отмечена (привычка — отметкой, «Сегодня» — нажатием/сканом; у «Сегодня» с «Целым днём» после срабатывания карточка скрывается до полуночи). «Целый день» и утро/обед/вечер взаимоисключающи. Откат: widgets.js 6.13.
   Версия: 6.13 (16.11) — в `tmr` у каждого таймера поле `hidden` (скрытый таймер без острова, `noIsland` в itemcards.js): скрытые таймеры входят в карточку «Таймеры», оболочка запускает их скрытыми; подсказка галочки «Отображать таймеры» обновлена. Откат: widgets.js 6.12.
   Версия: 6.12 (16.11) — в `tmr` у каждого таймера поле `color` (цвет таймера на вкладке QR-кодов): лицо в виджете и образец в форме рисуются этим цветом, а не зелёным. Откат: widgets.js 6.11.
   Версия: 7.0 (16.11) — вместо галочки «Показывать только мероприятия на сегодня и на завтра» — «Показывать мероприятия на [N] день/дня/дней вперёд» (`eventsSoon` — галочка, `eventsDays` — число 1…15 из выпадающей сетки 5×3, 1 — только сегодня; уходит в оболочку полем `eventsDays`; прежняя включённая галочка переносится как «на 2 дня»). Лента событий для карточек берётся на нужное число суток (`eventsFeedDays`), для события на семь суток вперёд и дальше шлётся картинка `<ключ>_d` с датой («25 ноября, Среда»; день недели один уже неоднозначен). Откат: widgets.js 6.11.
   Версия: 6.11 (15.11) — галочка «Отображать таймеры» (`timers`, время суток каждого таймера в этом виджете — `timerCfg`, экран «Таймеры» по нажатию на карточку в форме): в стопку добавляется одна карточка со ВСЕМИ таймерами пользователя (обычные карточки-таймеры вкладки QR-кодов; `widgetTimers` в itemcards.js; в оболочку уходят до `MAX_TIMERS` штук в поле `tmr`: ключ, название, `sec`, `live`, `times`). Лицо рисует оболочка (QrTimerFace.kt: зелёная карточка, кольцо и минуты, кольцо перерисовывается раз в минуту). Идущий таймер — выше всего (выше «Как тренировка?» и календаря), несколько идущих сменяют друг друга по минуте; таймер «в своё время суток» — выше календаря и привычек; края карточки листают таймеры, центр запускает показанный. Откат: widgets.js 6.10.
   Версия: 6.10 (15.11) — тексты в форме описывают общее правило круга равных: любые карточки с одинаковым верхним баллом сменяют друг друга по минуте, а карточка-группа («Привычки», «Будильники») всегда одна, и по минутам меняется её элемент (оболочка: QrPriority 4.9).
   Версия: 6.9 (15.11) — в описании «Переключение по релевантности» добавлен круг равных (привычки «в своё время» и календарь по очереди по минуте).
   Версия: 6.8 (15.11) — под «Показывать события календаря» галочка «Показывать только мероприятия на сегодня и на завтра» (`eventsSoon`, по умолчанию выключена; уходит в оболочку полем `eventsSoon`): карточка события показывает только сегодня и завтра, нет событий — карточки в стопке нет.
   Версия: 6.7 (14.11) — галочка «Отображать карточки привычек» (`habits`, время суток и дни недели каждой привычки в этом виджете — `habitCfg`, экран «Привычки» по нажатию на карточку в форме): привычки в оболочку уходят полем `hab`; привычки из списка выбора убраны, ранее выбранные переносятся на галочку (`migrateHabitCards`). Откат: widgets.js 6.6.
   Версия: 6.6 (14.11) — в описании заряда наушников указано, откуда он взят (`bt.src`: система, метаданные, вещание, команды гарнитуры, BLE).
   Версия: 6.5 (14.11) — палитры цвета в форме свёрнуты: справа от пункта квадрат выбранного цвета, нажатие открывает палитру, после выбора она сворачивается; палитры (`rpeColor`, `moodColor`, `icfColors5/6`) у «Спрашивать о тренировке» и «Спрашивать о настроении»; из описания «заряд (несколько устройств)» убран список парных Bluetooth-устройств.
   Версия: 6.4 (14.11) — «Сегодня, <день>» и «Как настроение?» того же размера, что на карточке события календаря (образец `moodFaceHtml`; в виджете — QrMood.kt).
   Версия: 6.3 (14.11) — галочка «Спрашивать о настроении» (`moodAsk`): служебная карточка «Как настроение?» (оболочка, QrMood.kt; в форме — образец `moodFaceHtml`, цвет `RPE_COLOR`); ответ из виджета страница вносит в журнал настроения (mood.js `drainWidgetMood`, мост ≥37).
   Версия: 6.2 (14.11)
   Экран «Конструктор виджетов» (кнопка #itemCardsWidgetsBtn в нижнем ряду вкладки «QR-коды»; ключ "widgets" остаётся для комбинированных карточек): виджеты рабочего стола «Стопка QR-карточек» 2×2 (Android, QrWidgets.kt).
   В виджет входит до 10 карточек вкладки «QR-коды» (itemcards.js); виден один, смахивание вверх/вниз листает по кругу; нажатие — как скан кода карточки.
   Настройки виджета: слайд-шоу «Переключать виджеты по кругу» (раз в N минут) ИЛИ «Переключение по релевантности»; у каждой карточки —
   необязательные время суток (утро/обед/вечер) и дни недели, когда она поднимается наверх, и что делать со стопкой после срабатывания карточки
   (`after`: "none" — ничего (по умолчанию) / "hide" — скрыть до конца дня / "end" — переместить в конец) и «Приоритет» (`prio`: "normal" — обычный (по умолчанию) / "top" — +300 к баллам / "low" — не поднимается по сигналам и стоит ниже обычных; действует при «Переключении по релевантности», считает QrPriority.kt).
   В форме виджета при включённой релевантности строка «Сейчас сверху: … — причина» (мост версии ≥36 `widgetWhy`, `whyText`; обновляется при открытии формы и через пару секунд после правки).
   Галочка «Отображать заряд аккумулятора» (`battery`): в стопку добавляется служебная карточка с зарядом телефона и Bluetooth-наушников — её рисует оболочка (QrBattery.kt), страница шлёт только флаг.
   Цвет карточки «Заряд» (`batColor`: "" — по умолчанию, сиреневый, иначе "#rrggbb") выбирается палитрой под галочкой — той же, что в форме карточки QR-кодов (itemcards.js `colorPalette`, запомненный цвет — `defaultColor/rememberColor`); карточка заряда показана в форме после последнего слота (и кнопки «+») (`batFaceHtml`), статус наушников из оболочки — `batStatusText`.
   Галочка «Отображать заряд аккумулятора (несколько устройств)» (`batteryMulti`, цвет `bat2Color`, палитра `icfColors2`): ещё одна служебная карточка — только значки и кольца заряда, без надписей: телефон и до трёх подключённых Bluetooth-устройств (QrBattery.renderMulti); в форме её лицо — `bat2FaceHtml`, значки — `iconSvg` (списка парных Bluetooth-устройств под галочкой нет).
   Галочка «Спрашивать о тренировке» (`rpeAsk`): пока есть тренировка без оценки нагрузки (1–10), над всеми карточками стопки стоит служебная карточка «Как тренировка?» с кнопками 1…10 — её рисует оболочка (QrRpe.kt), страница шлёт только флаг; в форме показан образец лица (`rpeFaceHtml`, цвет `RPE_COLOR`). Оценку из виджета страница забирает в workouts.js (`drainWidgetRpe`, мост ≥33).
   Галочки «Показывать задачи» (`tasks`, цвет `tasksColor`, палитра `icfColors3`) и «Показывать события календаря» (`events`, цвет `eventsColor`, палитра `icfColors4`): в стопку добавляются динамические карточки по данным календаря (`CalendarTab.widgetFeed` через `deps.getCalendarFeed`, `buildFeed`). Задачи: открытые задачи календаря на ближайшую неделю (`FEED_DAYS`) и просроченные — в оболочку уходят до `MAX_TASKS` кандидатов, а в стопке одна карточка задач, которую нажатием у левого/правого края листают по задачам (QrWidgets.kt `taskNav`); событие: ближайшее запланированное в пределах недели (в оболочку уходят `MAX_EVENTS` кандидатов, показывает первое будущее — решает QrWidgets.kt по текущему времени). Лицо — `drawDynFace` (размеры сняты с макета, доли ширины карточки — `DYN`), у каждой карточки до четырёх картинок: `<ключ>` («Сегодня»), `<ключ>_t` («Завтра»), `<ключ>_w` (день недели, если до даты два дня и больше) и `<ключ>_s`/`<ключ>_y`/`<ключ>_o` («Просрочено, сегодня» / «…, вчера» / «…, 1 января», только у задачи); какую показать — выбирает оболочка (так надпись меняется в полночь без приложения). Данные меняются → `feedChanged` (из my.js: запись состояния и возврат в приложение) сверяет `feedSig` и при отличии шлёт `syncNow`. Палитра общая с карточками QR-кодов (`itemcards.colorPalette`), цвет по умолчанию — как на макете (`TASK_COLOR`/`EVENT_COLOR`), последний выбранный — `widgetsDynColors_v1`.
   Галочка «Показывать будильники» (`alarms`): в стопку добавляется одна карточка со ВСЕМИ будильниками пользователя (карточки «Будильник» вкладки QR-кодов; `widgetAlarms` в itemcards.js; в оболочку уходят до `MAX_ALARMS` штук в поле `alm`: ключ карточки, id и настройки будильника, название). Карточка всегда одна. У каждого будильника свой приоритет (звонит сейчас — выше всего, зазвонит в ближайшие 30 минут — «скоро»); такие будильники сменяют друг друга на карточке по минутам (круг равных). Нажатие у левого/правого края листает ВСЕ будильники (QrWidgets.kt `groupNav`), нажатие в центре заводит/выключает показанный будильник. Лицо каждого будильника — `alarmFace`, два состояния (`<id>` и `<id>_on`) шлются как прежде. Отдельно будильник в стопку больше не выбирается (из списка «Выберите карточку» убран); будильники, выбранные в виджете раньше, при первой отправке переносятся на галочку (`migrateAlarmCards`).
   Галочка «Спрашивать о настроении» (`moodAsk`): с 20:30, если сегодня не было ни одной отметки настроения, над всеми обычными карточками (под «Как тренировка?», выше календаря) стоит служебная карточка «Как настроение?» с восемью эмодзи-кнопками — её рисует оболочка (QrMood.kt), страница шлёт только флаг и сообщает время последней отметки (mood.js `syncWidgetMood`, мост ≥37). Нажатие на эмодзи сразу записывает настроение и убирает карточку.
   Галочка «Показывать карточку о том, что заряд телефона достиг 80%» (`chargeDone`, цвет `chargeColor`): пока телефон подключён к питанию и заряд не ниже 80 % (80, 81 … 100), над стопкой стоит служебная карточка «Заряд телефона … % — можно отключать от зарядки» — её рисует оболочка (QrCharge.kt), страница шлёт только флаг и цвет. Приоритет: ниже идущего таймера и карточки низкого заряда (ниже 30 %), выше «Как тренировка?» и «Как настроение?»; при любом режиме.
   Данные: localStorage `qrWidgets_v1` ({n, ever, list:[{id,n,cards:[{cid,times,days,after,prio}],rotate,rotateMin,relevance,battery,batColor,batteryMulti,bat2Color,tasks,tasksColor,events,eventsColor,alarms,habits,habitCfg:{<id привычки>:{times,days}},rpeAsk,rpeColor,moodAsk,moodColor,chargeDone,chargeColor}]}), только на устройстве.
   Страница рисует лица карточек в PNG (canvas, `pngFor`) и шлёт их оболочке вместе с настройками (мост ≥31 `widgetsSync`).
   Галочка «Отображать карточки привычек» (`habits`): в стопку добавляются карточки ВСЕХ привычек пользователя (карточки «Привычка» вкладки QR-кодов; `widgetHabits` в itemcards.js; в оболочку уходят до `MAX_HABITS` штук в поле `hab`: ключ карточки, код, название, время суток и дни недели привычки в этом виджете, `last` — последний отмеченный день). Карточка привычек в стопке всегда ОДНА (свайп листает карточки, а не привычки). Привычка, у которой сейчас её время, участвует в круге равных: по минутам на этой же карточке сменяют друг друга такие привычки; не в своё время — в круг не попадает, но листается нажатием у левого/правого края карточки (QrWidgets.kt `groupNav`). Одно нажатие открывает карту дней привычки, двойное отмечает её и убирает из стопки до полуночи; все привычки отмечены — карточки нет. Время суток и дни привычки задаются здесь, в форме виджета (`habitCfg`, экран «Привычки»), а не в самой привычке. Отдельно привычка в стопку больше не выбирается (из списка «Выберите карточку» убрана); привычки, выбранные в виджете раньше, при первой отправке переносятся на галочку вместе с их временем (`migrateHabitCards`).
   Точка входа: window.initWidgetsModule(deps) → window.WidgetsTab.{render, scheduleSync}.
   =========================================================================== */
(function(){
  "use strict";
  var KEY = "qrWidgets_v1";
  var PICK_FILTER_KEY = "widgetsPickFilter_v1";
  var MAX_CARDS = 50;
  var WNAME_MAX = 40; // длина своего имени виджета
  var FACE_PX = 480; // ширина картинки лица для оболочки
  var FACE_BODY = 1.02; // высота тела карточки = ширина × FACE_BODY (то же — CARD_ASPECT в itemcards.js и FACE_BODY/FACE_SHADE в QrWidgets.kt)
  var FACE_SHADE = 0.04; // цветной выступ снизу, доля ширины
  var LEGACY_BAT_COLOR = "#2175d9"; // цвет карточки заряда у виджетов, сохранённых до выбора цвета: остаются синими
  var TASK_COLOR = "#1e88e5"; // цвет карточек задач по умолчанию (синий макета; квадрат палитры QR-кодов)
  var CHARGE_COLOR = "#43a047"; // цвет карточки «Заряд телефона достиг 80 %» по умолчанию (зелёный из палитры карточек; в оболочке — QrCharge.DEFAULT_COLOR)
 var RPE_COLOR = "#8000ff"; // цвет карточки «Как тренировка?» (фиолетовый макета; в оболочке — QrRpe.DEFAULT_COLOR)
  var EVENT_COLOR = "#317bf6"; // цвет карточки события по умолчанию (синий макета, чуть насыщеннее)
  var DYN_LAST_KEY = "widgetsDynColors_v1"; // последний выбранный цвет карточек задач/событий: {task, event}
  var MAX_TASKS = 12; // задач, между которыми листает единственная карточка задач (ближайшие по времени, просроченные первыми; то же число — QrPriority.TASK_NAV_MAX)
  var MAX_HABITS = 24; // привычек, которые уходят оболочке для карточек привычек (то же число — QrPriority.HABIT_NAV_MAX)
  var MAX_TIMERS = 24; // таймеров, между которыми листает карточка «Таймеры» (то же число — QrPriority.TIMER_NAV_MAX)
  var TIMER_COLOR = "#55cc0a"; // зелёный образца заказчика: цвет карточки «Таймеры» (в оболочке — QrTimerFace.COLOR)
  var MAX_BOOKS = 24; // книг в карточке «Книги» одного виджета (то же число — QrPriority.BOOK_NAV_MAX)
  var BOOK_FACE_PX = 480; // ширина картинки лица книги для оболочки: как у остальных лиц (FACE_PX) — более узкая в StackView не заполняет слот
  var BOOK_PLACEHOLDER_SRC = "book-cover-placeholder.jpg"; // та же заглушка, что у книг без обложки в приложении (лежит рядом с index.html)
  var TOAST_BOOK_ON = "Теперь книга будет отображаться в вашем виджете";
  var TOAST_BOOK_OFF = "Теперь эта книга не будет отображаться в вашем виджете";
  var TOAST_NO_BOOKS = "Вы еще не добавили ни одной книги для отображения в виджете. Вы можете сделать это на экране «Книги-карточки».";
var TOAST_NO_NOTES = "Вы еще не добавили ни одной заметки для отображения в виджете. Вы можете сделать это на экране «Заметки-карточки».";
var MAX_NOTES = 24; // заметок в карточке «Заметки» одного виджета (то же число — QrPriority.NOTE_NAV_MAX)
  var NOTE_ID_PREFIX = "nt_"; // id заметки в карточке «Книги» (то же — noteWidgetId в my.js); id книги такой приставки иметь не может
var NOTE_DEFAULT_COLOR = "#7f00ff"; // цвет заметки-карточки, пока цвет не выбран (как в components.css, .note-card)
var TOAST_NOTE_ON = "Теперь заметка будет отображаться в вашем виджете";
var TOAST_NOTE_OFF_ALL = "Теперь эта заметка не будет отображаться в ваших виджетах"; // двойное нажатие на карточку-заметку в приложении: убрана из всех виджетов
var TOAST_NOTE_OFF = "Теперь эта заметка не будет отображаться в вашем виджете";
var NOTE_FACE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M15 3v4h4"></path><line x1="7.5" y1="11" x2="14" y2="11"></line><line x1="7.5" y1="15" x2="14" y2="15"></line></svg>'; // та же пиктограмма заметки, что на карточке в приложении
var TOAST_NO_WIDGETS = "У вас пока нет виджетов. Создайте их в конструкторе виджетов: он открывается кнопкой в нижнем ряду вкладки «Карточки».";
  var MAX_ALARMS = 16; // будильников, между которыми листает карточка будильников (то же число — QrPriority.ALARM_NAV_MAX)
  var MAX_EVENTS = 10; // кандидатов в «следующее событие»: оболочка показывает первое, которое ещё не началось, а нажатие у края карточки листает до 10 событий вперёд/назад (без зацикливания)
  var FEED_DAYS = 7; // неделя вперёд (сегодня…через 6 дней, чтобы название дня недели было однозначным): оболочка сама решает по часам, что показать, пока приложение закрыто
  var EVENTS_DAYS_MAX = 15; // «Показывать мероприятия на N дней вперёд»: N от 1 до 15 (1 — только сегодня; то же число — QrPriority.EVENTS_DAYS_MAX)
var DAY_MS = 86400000;
  // Лицо динамической карточки (доли ширины карточки; сняты с макета 660 px): значок Tabler — «circle-check» / «calendar-event» (сетка 24, линия 2),
  // надпись «Сегодня»…, название (serif, жирное), время (крупно). Базовые линии букв, верх значка — от верха карточки. Верхние ≈7 % лица в виджете скрыты обрезкой стопки (qr_widget.xml: передняя карточка выходит за слот сверху), поэтому значок не поднимается выше `iconTop2`, а лишняя строка названия (`DYN2`) уходит вниз.
  var DYN = { unit: 0.00955, iconTop: 0.138, labelBase: 0.448, titleBase: 0.577, timeBase: 0.858, labelFs: 0.076, labelFsMax: 0.1, titleFs: 0.108, timeFs: 0.27 };
  var DYN2 = { iconTop: 0.126, labelBase: 0.432, titleBase: 0.543, lineH: 1.1, timeGap: 0.281 }; // название в две строки: значок почти на месте (выше нельзя — обрежется), остальное сдвигается вниз
  var DYN_ICONS = {
    task: '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2l4 -4"/>',
    event: '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/><path d="M8 15h2v2h-2z"/>',
    alarm: '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>'
  };
  var ALARM_ON_LABEL = "Заведён"; // надпись на лице карточки-будильника, пока будильник заведён (место надписи дня у карточки события)
  var ALARM_OFF_LABEL = "Не заведён"; // и пока не заведён
  var DYN_LABELS = { today: "Сегодня", over: "Просрочено", tom: "Завтра" }; // у просроченной задачи к «Просрочено» добавляется «, сегодня» / «, вчера» / «, 1 января»
  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var WEEKDAYS_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]; // по Date.getDay(): надпись карточки через два дня и дальше
  var DYN_SAMPLE = { task: { title: "Купить молоко", time: "18:00" }, event: { title: "Приём у врача", time: "15:30" } };
  // интервалы времени суток — те же значения в QrWidgets.kt (WINDOWS)
  var WINDOWS = [
    { k: "m", label: "Утро", hint: "5–11" },
    { k: "d", label: "Обед", hint: "11–15" },
    { k: "e", label: "Вечер", hint: "17–23" }
  ];
  var WINDOW_ALL = { k: "a", label: "Целый день", hint: "0–24" }; // «Целый день»: только у привычек и карточки «Сегодня»; в оболочке — QrPriority.WINDOWS[\"a\"]
  var AFTERS = [
    { k: "none", label: "Ничего не делать" },
    { k: "hide", label: "Скрывать карточку в стопке" },
    { k: "end", label: "Перемещать карточку в конец стопки" }
  ];
  var PRIOS = [
    { k: "normal", label: "Обычный" },
    { k: "top", label: "Наверх (+300 к баллам)" },
    { k: "low", label: "Вниз (не поднимать, ниже обычных)" }
  ];
  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]; // 1..7
  var PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  var INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5.5"></path><circle cx="12" cy="7.6" r="0.6" fill="currentColor"></circle></svg>';
  var FILTER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5z"></path></svg>';

  window.initWidgetsModule = function(deps){
    var esc = deps.escapeHtml;
    var HOME_SVG = deps.READER_HOME_ICON_SVG;
    var data = load();
    var stack = [{ s: "list" }];
    var armed = null;
    var syncTimer = null;
    var feedTimer = null;
    var lastFeedSig = "";
    var pngCache = {};
    var styleDone = false;

    // ---------- хранилище ----------
    function load(){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(KEY) || "null"); }catch(e){}
      if(!o || typeof o !== "object" || !Array.isArray(o.list)) o = { n: 0, ever: false, list: [] };
      o.list = o.list.filter(function(w){ return w && w.id && Array.isArray(w.cards); });
      o.list.forEach(function(w){
        w.cards = w.cards.filter(function(c){ return c && c.cid; }).slice(0, MAX_CARDS);
        w.cards.forEach(function(c){ c.times = Array.isArray(c.times) ? c.times : []; c.days = Array.isArray(c.days) ? c.days : []; c.after = normAfter(c.after); c.prio = normPrio(c.prio); });
        w.name = (typeof w.name === "string") ? w.name.replace(/^\s+|\s+$/g, "").slice(0, WNAME_MAX) : "";
        w.rotateMin = Math.max(1, Math.min(720, w.rotateMin | 0 || 5));
        w.rotate = !!w.rotate; w.relevance = !!w.relevance && !w.rotate; w.battery = !!w.battery;
        if(typeof w.batColor !== "string") w.batColor = w.battery ? LEGACY_BAT_COLOR : "";
        else if(w.batColor && !/^#[0-9a-fA-F]{6}$/.test(w.batColor)) w.batColor = "";
        w.batteryMulti = !!w.batteryMulti;
        if(typeof w.bat2Color !== "string" || (w.bat2Color && !/^#[0-9a-fA-F]{6}$/.test(w.bat2Color))) w.bat2Color = "";
        w.tasks = !!w.tasks; w.events = !!w.events; w.eventsSoon = !!w.events && !!w.eventsSoon; w.eventsDays = normDays(w.eventsDays, w.eventsSoon ? 2 : 1); w.alarms = !!w.alarms; w.habits = !!w.habits; w.habitCfg = normHabitCfg(w.habitCfg); w.timers = !!w.timers; w.timerCfg = normTimerCfg(w.timerCfg); splitNotes(w); w.books = !!w.books; w.bookList = normBookList(w.bookList, MAX_BOOKS, false); w.notes = !!w.notes; w.noteList = normBookList(w.noteList, MAX_NOTES, true); w.rpeAsk = !!w.rpeAsk; w.moodAsk = !!w.moodAsk;
        w.tasksColor = normHex(w.tasksColor); w.eventsColor = normHex(w.eventsColor);
        w.rpeColor = normHex(w.rpeColor) || RPE_COLOR; w.moodColor = normHex(w.moodColor) || RPE_COLOR; // служебные карточки: пусто — фиолетовый макета, как было до палитры
        w.chargeDone = !!w.chargeDone; w.chargeColor = normHex(w.chargeColor) || CHARGE_COLOR; // «Заряд телефона достиг 80 %»: пусто — зелёный
      });
      return o;
    }
    // число дней вперёд для событий: целое 1…EVENTS_DAYS_MAX, иначе `def` (раньше была только галочка «сегодня и завтра» — она переносится как 2)
    function normDays(v, def){ v = parseInt(v, 10); return isFinite(v) ? Math.max(1, Math.min(EVENTS_DAYS_MAX, v)) : def; }
    // «день» (1), «дня» (2–4), «дней» (5–20; 11–14 — тоже «дней»)
    function dayWord(n){ var m = n % 100, r = n % 10; return (m >= 11 && m <= 14) ? "дней" : (r === 1 ? "день" : ((r >= 2 && r <= 4) ? "дня" : "дней")); }
    // время суток и дни недели привычек этого виджета: {<id привычки>: {times:["m"|"d"|"e"], days:[1..7]}}; пустые записи не хранятся
    function normHabitCfg(o){
      var out = {};
      if(o && typeof o === "object") Object.keys(o).forEach(function(cid){
        var v = o[cid]; if(!v || typeof v !== "object") return;
        var t = (Array.isArray(v.times) ? v.times : []).filter(function(k){ return k === "m" || k === "d" || k === "e" || k === "a"; });
        if(t.indexOf("a") >= 0) t = ["a"];
        var d = (Array.isArray(v.days) ? v.days : []).filter(function(n){ return n >= 1 && n <= 7; });
        if(t.length || d.length) out[cid] = { times: t, days: d };
      });
      return out;
    }
    function habitCfgOf(w, cid){
      if(!w.habitCfg || typeof w.habitCfg !== "object") w.habitCfg = {};
      if(!w.habitCfg[cid]) w.habitCfg[cid] = { times: [], days: [] };
      return w.habitCfg[cid];
    }
    function trimHabitCfg(w, cid){ var h = w.habitCfg && w.habitCfg[cid]; if(h && !h.times.length && !h.days.length) delete w.habitCfg[cid]; }
    // время суток таймеров этого виджета: {<id таймера>: {times:["m"|"d"|"e"]}}; пустые записи не хранятся (таймер без времени суток «своего» времени не имеет)
    function normTimerCfg(o){
      var out = {};
      if(o && typeof o === "object") Object.keys(o).forEach(function(cid){
        var v = o[cid]; if(!v || typeof v !== "object") return;
        var t = (Array.isArray(v.times) ? v.times : []).filter(function(k){ return k === "m" || k === "d" || k === "e"; });
        if(t.length) out[cid] = { times: t };
      });
      return out;
    }
    function timerCfgOf(w, cid){
      if(!w.timerCfg || typeof w.timerCfg !== "object") w.timerCfg = {};
      if(!w.timerCfg[cid]) w.timerCfg[cid] = { times: [] };
      return w.timerCfg[cid];
    }
    function trimTimerCfg(w, cid){ var h = w.timerCfg && w.timerCfg[cid]; if(h && !h.times.length) delete w.timerCfg[cid]; }
    // книги виджета: [{h: id книги (латиница/цифры/«_»/«-», до 24 знаков), n: имя на момент добавления}], без повторов, не больше MAX_BOOKS
    function normBookList(a, max, notes){
      var out = [], seen = {};
      max = max || MAX_BOOKS;
      (Array.isArray(a) ? a : []).forEach(function(x){
        if(!x || typeof x.h !== "string" || !/^[A-Za-z0-9_-]{1,24}$/.test(x.h) || seen[x.h] || out.length >= max || !!notes !== isNoteId(x.h)) return; // в списке книг — только книги, в списке заметок — только заметки
        seen[x.h] = 1;
        out.push({ h: x.h, n: typeof x.n === "string" ? x.n.slice(0, 120) : "" });
      });
      return out;
    }
    // до 7.5 книги и заметки лежали в одном списке `bookList` под одной галочкой `books` (заметки — с приставкой nt_): разносим по двум карточкам; галочка «книги», включённая ради одних заметок, переходит на «заметки»
    function splitNotes(w){
      if(Array.isArray(w.noteList)) return;
      var all = Array.isArray(w.bookList) ? w.bookList : [];
      var nts = all.filter(function(x){ return x && isNoteId(x.h); });
      w.noteList = nts;
      w.bookList = all.filter(function(x){ return !(x && isNoteId(x.h)); });
      w.notes = !!w.books && nts.length > 0;
      if(nts.length && !w.bookList.length) w.books = false;
    }
    function bookIndex(w, id){ var list = isNoteId(id) ? w.noteList : w.bookList; for(var i = 0; i < list.length; i++) if(list[i].h === id) return i; return -1; }
    function bookKey(id){ return "bk_" + id; } // ключ книги в оболочке и имя её картинки (до 27 знаков — укладывается в 40)
    function normHex(v){ return (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) ? v.toLowerCase() : ""; }
    function hasContent(w){ return !!(w.cards.length || w.battery || w.batteryMulti || w.tasks || w.events || w.alarms || w.habits || w.timers || w.books || w.notes || w.rpeAsk || w.moodAsk || w.chargeDone); }
    function normAfter(v){ return (v === "hide" || v === "end") ? v : "none"; }
    function normPrio(v){ return (v === "top" || v === "low") ? v : "normal"; }
    function save(){ try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){} }
    function changed(){ save(); scheduleSync(600); }
    function widgetById(id){ for(var i = 0; i < data.list.length; i++) if(data.list[i].id === id) return data.list[i]; return null; }
    function wname(w){ var c = (w && typeof w.name === "string") ? w.name.replace(/^\s+|\s+$/g, "") : ""; return c || ("Виджет " + w.n); } // своё имя (`name`, до WNAME_MAX знаков) или «Виджет N»
    function bridge(){ var b = window.LifeTrackerNative; return (b && typeof b.widgetsSync === "function") ? b : null; }
    function nativeState(){
      var b = bridge(); if(!b) return null;
      try{ return JSON.parse(b.widgetsState() || "{}"); }catch(e){ return null; }
    }
    function cardsOf(){ return deps.getItemCards(); }
    // Будильник в стопку по одному больше не выбирается: у виджетов, где он уже стоит среди карточек, он убирается, а вместо него включается «Показывать будильники»
    function migrateAlarmCards(){
      var changedAny = false;
      try{
        var ic = cardsOf();
        if(!ic || typeof ic.widgetFace !== "function") return;
        data.list.forEach(function(w){
          var keep = w.cards.filter(function(c){ var f = ic.widgetFace(c.cid); return !(f && f.type === "alarm"); });
          if(keep.length !== w.cards.length){ w.cards = keep; w.alarms = true; changedAny = true; }
        });
      }catch(e){}
      if(changedAny) save();
    }
    // Привычка в стопку по одной больше не выбирается: у виджетов, где она уже стоит среди карточек, она убирается, а вместо неё включается «Отображать карточки привычек»;
    // время суток и дни, заданные у карточки-привычки, переходят в настройки привычки этого виджета (`habitCfg`)
    function migrateHabitCards(){
      var changedAny = false;
      try{
        var ic = cardsOf();
        if(!ic || typeof ic.widgetFace !== "function") return;
        data.list.forEach(function(w){
          var keep = [];
          w.cards.forEach(function(c){
            var f = ic.widgetFace(c.cid);
            if(f && f.type === "habit"){
              if(!(w.habitCfg && w.habitCfg[c.cid]) && ((c.times && c.times.length) || (c.days && c.days.length))){
                var hc = habitCfgOf(w, c.cid);
                hc.times = (c.times || []).slice(); hc.days = (c.days || []).slice();
              }
            } else keep.push(c);
          });
          if(keep.length !== w.cards.length){ w.cards = keep; w.habits = true; changedAny = true; }
        });
      }catch(e){}
      if(changedAny) save();
    }
    function batHex(w){ return cardsOf().paletteColor(w.batColor); } // цвет, которым рисуется карточка заряда (пусто — сиреневый)
    function bat2Hex(w){ return cardsOf().paletteColor(w.bat2Color); } // то же для карточки заряда нескольких устройств
    function rpeHex(w){ return w.rpeColor || RPE_COLOR; } // цвет карточки «Как тренировка?»
    function moodHex(w){ return w.moodColor || RPE_COLOR; } // цвет карточки «Как настроение?»
    function chargeHex(w){ return w.chargeColor || CHARGE_COLOR; } // цвет карточки «Заряд телефона достиг 80 %»
    function dynHex(w, kind){ return cardsOf().paletteColor(kind === "task" ? w.tasksColor : w.eventsColor); } // цвет карточек задач / события (пусто — сиреневый)
    // цвет для только что включённой галочки: последний выбранный (в том числе сиреневый), иначе синий макета
    function dynColorFor(kind){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(DYN_LAST_KEY) || "null"); }catch(e){}
      if(o && typeof o === "object" && typeof o[kind] === "string") return normHex(o[kind]);
      return kind === "task" ? TASK_COLOR : EVENT_COLOR;
    }
    function rememberDynColor(kind, hex){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(DYN_LAST_KEY) || "null"); }catch(e){}
      if(!o || typeof o !== "object") o = {};
      o[kind] = normHex(hex);
      try{ localStorage.setItem(DYN_LAST_KEY, JSON.stringify(o)); }catch(e){}
    }

    // ---------- лицо карточки → PNG для оболочки ----------
    function rrect(g, x, y, w, h, r){
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
      g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
      g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
      g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
    }
    function wrapLines(g, text, maxW){
      var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = "";
      words.forEach(function(w){
        var t = cur ? cur + " " + w : w;
        if(cur && g.measureText(t).width > maxW){ lines.push(cur); cur = w; } else cur = t;
      });
      if(cur) lines.push(cur);
      return lines;
    }
    function svgImage(svg){
      return new Promise(function(resolve){
        if(!svg) return resolve(null);
        var s = String(svg).replace(/currentColor/g, "#ffffff");
        if(s.indexOf("xmlns") < 0) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"');
        var img = new Image();
        img.onload = function(){ resolve(img); };
        img.onerror = function(){ resolve(null); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      });
    }
    function drawFace(face, icon){
      var S = FACE_PX, bodyH = Math.round(S * FACE_BODY), shift = Math.round(S * FACE_SHADE), cv = document.createElement("canvas");
      cv.width = S; cv.height = bodyH + shift;
      var g = cv.getContext("2d");
      var r = S * 0.12;
      rrect(g, 0, shift, S, bodyH, r); g.fillStyle = face.shade; g.fill();   // цветной выступ снизу
      rrect(g, 0, 0, S, bodyH, r); g.fillStyle = face.color; g.fill();
      var maxW = S * 0.86, serif = '"Palatino Linotype",Georgia,serif', sans = "sans-serif";
      var items = [];
      if(icon) items.push({ h: S * 0.27, gap: S * 0.03, icon: true });
      var tfs = S * ((face.type === "timer" || face.type === "alarm") ? 0.11 : 0.12), lines = [];
      if(face.title){
        for(;;){
          g.font = "700 " + tfs + "px " + serif;
          var widest = 0;
          String(face.title).split(/\s+/).forEach(function(w){ var m = g.measureText(w).width; if(m > widest) widest = m; });
          if(widest <= maxW || tfs <= S * 0.07) break;
          tfs *= 0.92;
        }
        lines = wrapLines(g, face.title, maxW);
        if(lines.length > 2){ lines = lines.slice(0, 2); lines[1] = lines[1].replace(/.?$/, "…"); }
        items.push({ h: lines.length * tfs * 1.25, gap: S * 0.03, title: true });
      }
      var bfs = S * 0.19;
      if(face.big) items.push({ h: bfs * 1.1, gap: S * 0.03, big: true });
      var sfs = S * 0.09;
      if(face.sub) items.push({ h: sfs * 1.2, gap: 0, sub: true });
      var total = 0; items.forEach(function(it){ total += it.h + it.gap; });
      if(items.length) total -= items[items.length - 1].gap;
      var y = (bodyH - total) / 2;
      g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = "#ffffff";
      items.forEach(function(it){
        if(it.icon){ if(icon) g.drawImage(icon, (S - it.h) / 2, y, it.h, it.h); }
        else if(it.title){
          g.font = "700 " + tfs + "px " + serif;
          lines.forEach(function(ln, i){ g.fillText(ln, S / 2, y + i * tfs * 1.25 + tfs * 0.12); });
        } else if(it.big){
          g.font = "700 " + bfs + "px " + sans;
          g.fillText(face.big, S / 2, y + bfs * 0.04, maxW);
        } else if(it.sub){
          g.font = "400 " + sfs + "px " + sans;
          g.fillText(face.sub, S / 2, y + sfs * 0.06, maxW);
        }
        y += it.h + it.gap;
      });
      return cv;
    }
    function pngFor(face){
      var sig = JSON.stringify([face.color, face.title, face.big, face.sub, face.svg, face.type]);
      var hit = pngCache[face.id];
      if(hit && hit.sig === sig) return Promise.resolve(hit.url);
      return svgImage(face.svg).then(function(icon){
        var url = "";
        try{ url = drawFace(face, icon).toDataURL("image/png"); }
        catch(e){ try{ url = drawFace(face, null).toDataURL("image/png"); }catch(e2){ url = ""; } } // холст «испачкан» значком — рисуем без него
        if(url) pngCache[face.id] = { sig: sig, url: url };
        return url;
      });
    }

    // ---------- карточки «Задачи» и «События календаря» ----------
    function dynIconSvg(kind){
      return '<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + DYN_ICONS[kind] + '</svg>';
    }
    // название: одна строка (шрифт ужимается до 0,088 ширины), иначе две (до 0,07), иначе вторая строка обрезается «…»
    function fitTitle(g, text, S, maxW, fam){
      text = String(text || "").replace(/\s+/g, " ").replace(/^ | $/g, "") || "Без названия";
      function setF(f){ g.font = "700 " + f + "px " + fam; }
      var fs;
      for(fs = S * DYN.titleFs; fs >= S * 0.088; fs *= 0.96){ setF(fs); if(g.measureText(text).width <= maxW) return { lines: [text], fs: fs }; }
      for(fs = S * 0.09; fs >= S * 0.07; fs *= 0.95){
        setF(fs);
        var lines = wrapLines(g, text, maxW), ok = lines.length <= 2;
        if(ok) lines.forEach(function(l){ if(g.measureText(l).width > maxW) ok = false; });
        if(ok) return { lines: lines, fs: fs };
      }
      fs = S * 0.07; setF(fs);
      var ls = wrapLines(g, text, maxW);
      if(ls.length > 2){
        ls = ls.slice(0, 2);
        var last = ls[1];
        while(last.length > 1 && g.measureText(last + "…").width > maxW) last = last.slice(0, -1);
        ls[1] = last + "…";
      }
      return { lines: ls, fs: fs };
    }
    // face: {color, shade, kind, label, title, time}
    function drawDynFace(face, icon){
      var S = FACE_PX, bodyH = Math.round(S * FACE_BODY), shift = Math.round(S * FACE_SHADE), cv = document.createElement("canvas");
      cv.width = S; cv.height = bodyH + shift;
      var g = cv.getContext("2d"), r = S * 0.12;
      rrect(g, 0, shift, S, bodyH, r); g.fillStyle = face.shade; g.fill();   // цветной выступ снизу
      rrect(g, 0, 0, S, bodyH, r); g.fillStyle = face.color; g.fill();
      var maxW = S * 0.86, serif = '"Palatino Linotype",Georgia,serif', sans = "sans-serif";
      var fit = fitTitle(g, face.title, S, maxW, serif), n = fit.lines.length, lh = fit.fs * (n > 1 ? DYN2.lineH : 1.2);
      var iconTop = n > 1 ? DYN2.iconTop : DYN.iconTop, labelBase = n > 1 ? DYN2.labelBase : DYN.labelBase, titleBase = n > 1 ? DYN2.titleBase : DYN.titleBase;
      var timeBase = n > 1 ? titleBase + (n - 1) * lh / S + DYN2.timeGap : DYN.timeBase;
      g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillStyle = "#ffffff";
      if(icon){ var u = S * DYN.unit; g.drawImage(icon, (S - 24 * u) / 2, S * iconTop - 2 * u, 24 * u, 24 * u); }
      var lfs = S * DYN.labelFsMax; // надпись дня крупнее: «Сегодня, Четверг» — до labelFsMax, длинные ужимаются, но не меньше labelFs
      var lw = face.labelBold ? "700 " : "400 ";
      g.font = lw + lfs + "px " + sans;
      while(lfs > S * DYN.labelFs && g.measureText(face.label).width > maxW){ lfs *= 0.97; g.font = lw + lfs + "px " + sans; }
      g.fillText(face.label, S / 2, S * labelBase, maxW);
      g.font = "700 " + fit.fs + "px " + serif;
      fit.lines.forEach(function(ln, i){ g.fillText(ln, S / 2, S * titleBase + i * lh, maxW); });
      g.font = "700 " + (S * DYN.timeFs) + "px " + sans;
      g.fillText(face.time, S / 2, S * timeBase, maxW);
      return cv;
    }
    // лицо карточки-будильника — как у события календаря (значок, надпись, название, время); надпись «Заведён» — только у заведённого
    function alarmFace(f, armed){
      return { id: "alarm:" + f.id + (armed ? "_on" : ""), color: f.color, shade: f.shade, kind: "alarm", label: armed ? ALARM_ON_LABEL : ALARM_OFF_LABEL, labelBold: true, title: f.title || "Будильник", time: f.big || "" };
    }
    function dynPng(face){
      var sig = JSON.stringify([face.color, face.kind, face.label, face.labelBold, face.title, face.time]);
      var hit = pngCache[face.id];
      if(hit && hit.sig === sig) return Promise.resolve(hit.url);
      return svgImage(dynIconSvg(face.kind)).then(function(icon){
        var url = "";
        try{ url = drawDynFace(face, icon).toDataURL("image/png"); }
        catch(e){ try{ url = drawDynFace(face, null).toDataURL("image/png"); }catch(e2){ url = ""; } }
        if(url) pngCache[face.id] = { sig: sig, url: url };
        return url;
      });
    }
    function startOfDay(ts){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    function addDays(ts, n){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); } // календарные дни (переход на летнее время не сдвигает полночь)
    function hhmm(ts){ var d = new Date(ts), h = d.getHours(), m = d.getMinutes(); return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
    function usesAlarms(){ for(var i = 0; i < data.list.length; i++) if(data.list[i].alarms) return true; return false; }
    function usesHabits(){ for(var i = 0; i < data.list.length; i++) if(data.list[i].habits) return true; return false; }
    function usesTimers(){ for(var i = 0; i < data.list.length; i++) if(data.list[i].timers) return true; return false; }
    function usesBooks(){ for(var i = 0; i < data.list.length; i++) if(data.list[i].books && data.list[i].bookList.length) return true; return false; }
    function usesDyn(){ for(var i = 0; i < data.list.length; i++) if(data.list[i].tasks || data.list[i].events) return true; return false; }
    // что нужно карточкам: {tasks:[{at,title}], events:[{at,title}]}; задачи — открытые на сегодня и просроченные, события — ещё не начавшиеся
    // на сколько суток вперёд нужны события: неделя, а если у какого-то виджета «на N дней вперёд» и N больше — столько
    function eventsFeedDays(){
      var d = FEED_DAYS;
      data.list.forEach(function(w){ if(w.events && w.eventsSoon) d = Math.max(d, normDays(w.eventsDays, 1)); });
      return d;
    }
    function buildFeed(){
      var now = Date.now(), list = [], feed = { tasks: [], events: [] }, tasksTo = addDays(startOfDay(now), FEED_DAYS);
      try{ list = (deps.getCalendarFeed && deps.getCalendarFeed(now, addDays(startOfDay(now), eventsFeedDays()))) || []; }catch(e){ list = []; }
      list.forEach(function(it){
        var o = { at: it.at, title: it.title };
        if(it.k === "task"){ if(it.at >= tasksTo) return; o.tid = it.tid || ""; if(feed.tasks.length < MAX_TASKS) feed.tasks.push(o); }
        else if(it.at >= now && feed.events.length < MAX_EVENTS){ o.eid = String(it.id || ""); feed.events.push(o); }
      });
      return feed;
    }
    function feedSig(feed){
      function f(a){ return a.map(function(x){ return [x.at, x.title, x.tid || "", x.eid || ""]; }); }
      return JSON.stringify([f(feed.tasks), f(feed.events)]);
    }
    // Карточки виджетов и картинки к ним. Ключи — `dt_<id виджета>_<n>` (задача) и `de_<id виджета>_<n>` (событие). Надпись зависит от того, сколько дней
    // осталось до даты карточки, и меняется в полночь без приложения, поэтому шлются все картинки, которые понадобятся: `<ключ>` — «Сегодня», `<ключ>_t` — «Завтра»,
    // `<ключ>_w` — день недели («Суббота»; только если до даты два дня и больше); у задачи ещё `<ключ>_s` — «Просрочено, сегодня» (время прошло, день тот же), `<ключ>_y` — «Просрочено, вчера», `<ключ>_o` — «Просрочено, 1 января» (дата задачи; раньше вчера). Какую показать, выбирает оболочка.
    function dynItems(feed){
      var today = startOfDay(Date.now()), jobs = [], per = {};
      data.list.forEach(function(w){
        var items = [];
        function add(kind, list, prefix){
          var hex = dynHex(w, kind), shade = cardsOf().cardShade(hex);
          list.forEach(function(it, i){
            var key = prefix + w.id + "_" + i, dayAt = startOfDay(it.at), d0 = Math.round((dayAt - today) / DAY_MS);
            function face(id, label){ return { id: "dyn:" + id, color: hex, shade: shade, kind: kind, label: label, title: it.title, time: hhmm(it.at) }; }
            function put(suffix, label){ jobs.push({ key: key + suffix, face: face(key + suffix, label) }); }
            var wd = WEEKDAYS_FULL[new Date(it.at).getDay()];
            if(d0 >= 7){ var fd = new Date(it.at); put("_d", fd.getDate() + " " + MONTHS_GEN[fd.getMonth()] + ", " + wd); } // через неделю и дальше день недели один неоднозначен — с датой
            if(d0 >= 2) put("_w", wd);
            if(d0 >= 1) put("_t", DYN_LABELS.tom + ", " + wd);
            if(d0 >= 0) put("", DYN_LABELS.today + ", " + wd);
            if(kind === "task"){
              var od = new Date(it.at);
              if(d0 >= 0) put("_s", DYN_LABELS.over + ", сегодня");
              if(d0 >= -1) put("_y", DYN_LABELS.over + ", вчера");
              put("_o", DYN_LABELS.over + ", " + od.getDate() + " " + MONTHS_GEN[od.getMonth()]);
            }
            items.push({ key: key, k: kind, at: it.at, title: it.title, tid: it.tid || "", eid: it.eid || "" });
          });
        }
        if(w.tasks) add("task", feed.tasks, "dt_");
        if(w.events) add("event", feed.events, "de_");
        per[w.id] = items;
      });
      return { perWidget: per, jobs: jobs };
    }
    // данные календаря или время изменились: если для карточек «задачи»/«события» это что-то меняет — отправить виджеты заново
    function feedChanged(){
      if(feedTimer || !bridge() || !usesDyn()) return;
      feedTimer = setTimeout(function(){
        feedTimer = null;
        if(!usesDyn()) return;
        var sig = "";
        try{ sig = feedSig(buildFeed()); }catch(e){ return; }
        if(sig !== lastFeedSig) scheduleSync(300);
      }, 4000);
    }

    // ---------- карточка «Книги» ----------
    // Тост приложения (ctxmenu.js, LTCtx.toast; нет его — тост оболочки): ms — сколько держится (по умолчанию 1,9 с — для длинных текстов мало)
    function say(msg, ms){
      try{ if(window.LTCtx && typeof window.LTCtx.toast === "function"){ window.LTCtx.toast(msg, ms); return; } }catch(e){}
      try{ var N = window.LifeTrackerNative; if(N && typeof N.showToast !== "undefined") N.showToast(msg); }catch(e2){}
    }
    function loadImage(src){
      return new Promise(function(resolve){
        if(!src) return resolve(null);
        var im = new Image();
        im.onload = function(){ resolve(im.naturalWidth ? im : null); };
        im.onerror = function(){ resolve(null); };
        im.src = src;
      });
    }
    // цвет выступа под обложкой — та же формула, что applyCoverShade в my.js: средний цвет нижней части видимой области, темнее на 20 %
    function coverShade(img, pos){
      try{
        var nw = img.naturalWidth, nh = img.naturalHeight;
        if(!nw || !nh) return "";
        var target = 1 / FACE_BODY, ar = nw / nh, vh = ar < target ? nh * ar / target : nh;
        var y0 = (nh - vh) * pos / 100 + vh * 0.7, sh = vh * 0.3;
        var cv = document.createElement("canvas"); cv.width = 24; cv.height = 8;
        var g = cv.getContext("2d");
        g.drawImage(img, 0, y0, nw, sh, 0, 0, 24, 8);
        var d = g.getImageData(0, 0, 24, 8).data, r = 0, gr = 0, b = 0, n = 0;
        for(var i = 0; i < d.length; i += 4){ if(d[i + 3] < 128) continue; r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
        if(!n) return "";
        var hx = function(v){ var t = Math.round(v / n * 0.8).toString(16); return t.length < 2 ? "0" + t : t; };
        return "#" + hx(r) + hx(gr) + hx(b);
      }catch(e){ return ""; }
    }
    // название на заглушке (у книги без обложки): в верхней белой плашке шаблона, до трёх строк
    function drawBookTitle(g, S, title){
      var serif = '"Palatino Linotype",Georgia,serif', maxW = S * 0.76, fs = S * 0.095, lines = [];
      for(;;){
        g.font = "700 " + fs + "px " + serif;
        lines = wrapLines(g, title || "Книга", maxW);
        var widest = 0;
        lines.forEach(function(ln){ var m = g.measureText(ln).width; if(m > widest) widest = m; });
        if((lines.length <= 3 && widest <= maxW) || fs <= S * 0.055) break;
        fs *= 0.92;
      }
      if(lines.length > 3){ lines = lines.slice(0, 3); lines[2] = lines[2].replace(/.?$/, "…"); }
      g.fillStyle = "#3d3a35"; g.textAlign = "center"; g.textBaseline = "top";
      var top = S * 0.0926 + (S * 0.235 - lines.length * fs * 1.2) / 2;
      lines.forEach(function(ln, i){ g.fillText(ln, S * 0.51, top + i * fs * 1.2, maxW); });
    }
    // лицо книги: карточка как «Книги-карточки» в приложении — обложка (object-fit: cover, по вертикали по положению pos, %), цветной выступ снизу
    function drawBookFace(img, pos, title, placeholder){
      var S = BOOK_FACE_PX, bodyH = Math.round(S * FACE_BODY), shift = Math.round(S * FACE_SHADE), r = S * 0.12;
      var cv = document.createElement("canvas"); cv.width = S; cv.height = bodyH + shift;
      var g = cv.getContext("2d");
      var shade = (img && coverShade(img, pos)) || "#8d8576";
      rrect(g, 0, shift, S, bodyH, r); g.fillStyle = shade; g.fill();
      g.save();
      rrect(g, 0, 0, S, bodyH, r); g.clip();
      g.fillStyle = "#b5ad9d"; g.fillRect(0, 0, S, bodyH);
      if(img){
        var sc = Math.max(S / img.naturalWidth, bodyH / img.naturalHeight), dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
        g.drawImage(img, (S - dw) / 2, (bodyH - dh) * pos / 100, dw, dh);
      }
      if(placeholder) drawBookTitle(g, S, title);
      g.restore();
      return cv;
    }
    // PNG-подобная картинка лица книги (WebP с прозрачными углами; браузер без WebP отдаёт PNG — оболочка читает оба); кэш — пока те же название, обложка и положение
    function bookFacePng(b){
      return Promise.resolve(typeof deps.bookCover === "function" ? deps.bookCover(b.hash) : null).catch(function(){ return null; }).then(function(cv){
        var url = cv && cv.url ? cv.url : "", pos = cv && cv.pos >= 0 && cv.pos <= 100 ? cv.pos : 50;
        var sig = JSON.stringify([b.name, url.length, url.slice(-32), pos]), key = bookKey(b.id), hit = pngCache[key];
        if(hit && hit.sig === sig) return hit.url;
        return loadImage(url).then(function(cover){
          return (cover ? Promise.resolve(null) : loadImage(BOOK_PLACEHOLDER_SRC)).then(function(plain){
            var out = "";
            try{
              var cvs = cover ? drawBookFace(cover, pos, b.name, false) : drawBookFace(plain, 0, b.name, true); // заглушка — с верха: там плашка для названия
              out = cvs.toDataURL("image/webp", 0.9);
            }catch(e){ out = ""; }
            if(out) pngCache[key] = { sig: sig, url: out };
            return out;
          });
        });
      });
    }
    function isNoteId(id){ return typeof id === "string" && id.indexOf(NOTE_ID_PREFIX) === 0; }
    // лицо заметки: та же карточка, что «Заметки-карточки» в приложении — заливка цветом заметки, цветной выступ снизу, белая пиктограмма и название (до трёх строк)
    function noteFacePng(b){
      var color = normHex(b.color) || NOTE_DEFAULT_COLOR, name = String(b.name || "Заметка");
      var sig = JSON.stringify([name, color]), key = bookKey(b.id), hit = pngCache[key];
      if(hit && hit.sig === sig) return Promise.resolve(hit.url);
      return svgImage(NOTE_FACE_ICON_SVG).then(function(ico){
        var out = "";
        try{
          var S = BOOK_FACE_PX, bodyH = Math.round(S * FACE_BODY), shift = Math.round(S * FACE_SHADE), r = S * 0.12;
          var cv = document.createElement("canvas"); cv.width = S; cv.height = bodyH + shift;
          var g = cv.getContext("2d");
          rrect(g, 0, shift, S, bodyH, r); g.fillStyle = cardsOf().cardShade(color); g.fill(); // выступ снизу
          rrect(g, 0, 0, S, bodyH, r); g.fillStyle = color; g.fill();
          var isz = S * 0.32, itop = S * 0.14;
          if(ico) g.drawImage(ico, (S - isz) / 2, itop, isz, isz);
          var maxW = S * 0.8, fs = S * 0.095, lines = [];
          for(;;){
            g.font = "700 " + fs + "px sans-serif";
            lines = wrapLines(g, name, maxW);
            var widest = 0;
            lines.forEach(function(ln){ var m = g.measureText(ln).width; if(m > widest) widest = m; });
            if((lines.length <= 3 && widest <= maxW) || fs <= S * 0.055) break;
            fs *= 0.92;
          }
          if(lines.length > 3){ lines = lines.slice(0, 3); lines[2] = lines[2].replace(/.?$/, "…"); }
          g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "top";
          var top = itop + isz + S * 0.05;
          lines.forEach(function(ln, i){ g.fillText(ln, S / 2, top + i * fs * 1.2, maxW); });
          out = cv.toDataURL("image/webp", 0.9);
        }catch(e){ out = ""; }
        if(out) pngCache[key] = { sig: sig, url: out };
        return out;
      });
    }
    // все книги и заметки, лежащие хоть в одном виджете с включённой галочкой: [{id, name, png, time}] (time — время суток заметки); тех, которых в библиотеке уже нет, пропускаем
    function loadBookRows(){
      var want = {}, ids = [];
      data.list.forEach(function(w){ (w.books ? w.bookList : []).concat(w.notes ? w.noteList : []).forEach(function(x){ if(!want.hasOwnProperty(x.h)){ want[x.h] = x.n; ids.push(x.h); } }); });
      if(!ids.length || typeof deps.listBooks !== "function") return Promise.resolve([]);
      var wantNotes = ids.some(isNoteId);
      return Promise.all([
        Promise.resolve().then(function(){ return deps.listBooks(); }).catch(function(){ return null; }),
        wantNotes && typeof deps.listNotes === "function" ? Promise.resolve().then(function(){ return deps.listNotes(); }).catch(function(){ return null; }) : Promise.resolve(null)
      ]).then(function(res){
        var all = res[0], notes = res[1];
        var failed = !Array.isArray(all), notesFailed = !Array.isArray(notes), byId = {}; // список не прочитался — они остаются в виджетах, лица — с запомненным названием
        if(!failed) all.forEach(function(b){ byId[b.id] = b; });
        if(!notesFailed) notes.forEach(function(n){ byId[n.id] = { id: n.id, name: n.name, note: true, color: n.color || "", time: n.time || "" }; });
        var rows = [];
        ids.forEach(function(id){
          var b;
          if(isNoteId(id)) b = notesFailed ? { id: id, name: want[id], note: true, color: "" } : byId[id];
          else b = failed ? { id: id, name: want[id], hash: null } : byId[id];
          if(b) rows.push(b);
        });
        return Promise.all(rows.map(function(b){
          return (b.note ? noteFacePng(b) : bookFacePng(b)).then(function(png){ return { id: b.id, name: b.name, png: png, time: b.time || "" }; });
        }));
      });
    }
    // книги одного виджета для оболочки: ключ (он же имя картинки) и название — в порядке добавления
    function bookEntries(w, rows){
      var have = {};
      rows.forEach(function(r){ have[r.id] = r; });
      return w.bookList.filter(function(x){ return have[x.h]; }).map(function(x){ return { key: bookKey(x.h), title: have[x.h].name }; });
    }
    // заметки одного виджета для оболочки: ключ (он же имя картинки), название и время суток приоритета (`times`: [] — не выбрано, иначе одна из букв m, d, e, a) — в порядке добавления
    function noteEntries(w, rows){
      var have = {};
      rows.forEach(function(r){ have[r.id] = r; });
      return w.noteList.filter(function(x){ return have[x.h]; }).map(function(x){
        var t = have[x.h].time;
        return { key: bookKey(x.h), title: have[x.h].name, times: (t === "m" || t === "d" || t === "e" || t === "a") ? [t] : [] };
      });
    }
    // экран «Книги-карточки» (my.js): список виджетов для выбранной книги — [{id, n, has}], has — книга уже в этом виджете
    function widgetsForBook(bookId){
      return data.list.map(function(w){ return { id: w.id, n: w.n, name: wname(w), has: bookIndex(w, bookId) >= 0 }; });
    }
    // добавить книгу (или заметку) в виджет / убрать из него (повторный выбор того же виджета): включает галочку «Отображать книги» (заметке — «Отображать заметки»); тост — здесь
    function toggleBook(widgetId, bookId, name, kind){
      var isNote = kind === "note" || isNoteId(bookId); // заметка-карточка лежит в своём списке `noteList` (id с приставкой nt_), книги — в `bookList`
      var w = widgetById(widgetId);
      if(!w || !bookId) return "";
      var list = isNote ? w.noteList : w.bookList, max = isNote ? MAX_NOTES : MAX_BOOKS;
      var i = bookIndex(w, bookId);
      if(i >= 0){
        list.splice(i, 1);
        changed();
        say(isNote ? TOAST_NOTE_OFF : TOAST_BOOK_OFF, 3400);
        return "removed";
      }
      if(list.length >= max){ say("В виджете уже " + max + (isNote ? " заметок" : " книг") + " — больше не помещается. Уберите ненужные.", 4200); return ""; }
      list.push({ h: bookId, n: String(name || "").slice(0, 120) });
      if(isNote) w.notes = true; else w.books = true;
      changed();
      say(isNote ? TOAST_NOTE_ON : TOAST_BOOK_ON, 3400);
      return "added";
    }

    // двойное нажатие на карточку-заметку в приложении («Заметки-карточки», mdeditor.js): заметка убирается из всех виджетов, куда добавлена; возвращает число таких виджетов
    function dropNoteEverywhere(id){
      if(!isNoteId(id)) return 0;
      var n = 0;
      data.list.forEach(function(w){
        var i = bookIndex(w, id);
        if(i >= 0){ w.noteList.splice(i, 1); n++; }
      });
      if(n){ changed(); say(TOAST_NOTE_OFF_ALL, 3400); }
      return n;
    }
    // заметку сняли с виджета двойным нажатием на карточку «Заметки» (оболочка → my.js drainWidgetNotes): убрать её из списка этого виджета; true — заметки там уже нет
    function dropNote(widgetId, key){
      var w = widgetById(widgetId);
      if(!w) return true; // виджета уже нет — снимать нечего
      var id = String(key || "");
      if(id.indexOf("bk_") === 0) id = id.slice(3); // ключ в оболочке — «bk_» + id заметки (nt_…)
      if(!isNoteId(id)) return true;
      var i = bookIndex(w, id);
      if(i < 0) return true;
      w.noteList.splice(i, 1);
      changed(); // без тоста: заметку сняли двойным нажатием в самом виджете — он и так это показал
      return true;
    }

    // ---------- отправка оболочке ----------
    function scheduleSync(ms){
      if(!bridge()) return;
      if(!data.list.length && !data.ever) return;
      if(syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(function(){ syncTimer = null; syncNow(); }, ms == null ? 1500 : ms);
    }
    function syncNow(){
      var b = bridge();
      if(!b) return Promise.resolve(false);
      migrateAlarmCards();
      migrateHabitCards();
      var ic = cardsOf(), ids = {}, faces = {};
      data.list.forEach(function(w){ w.cards.forEach(function(c){ ids[c.cid] = 1; }); });
      var alarmRows = []; // все будильники пользователя для карточки «Будильники» (у кого в виджете включена галочка)
      if(usesAlarms()){
        try{ alarmRows = ic.widgetAlarms().filter(function(f){ return f.alarmSpec; }).slice(0, MAX_ALARMS); }catch(e){ alarmRows = []; }
        alarmRows.forEach(function(f){ ids[f.id] = 1; });
      }
      var habitRows = []; // все привычки пользователя для карточек привычек (у кого в виджете включена галочка)
      if(usesHabits()){
        try{ habitRows = ic.widgetHabits().slice(0, MAX_HABITS); }catch(e){ habitRows = []; }
        habitRows.forEach(function(f){ ids[f.id] = 1; });
      }
      var timerRows = []; // все обычные таймеры пользователя для карточки «Таймеры» (у кого в виджете включена галочка); лицо рисует оболочка, картинки не нужны
      if(usesTimers()){
        try{ timerRows = (typeof ic.widgetTimers === "function" ? ic.widgetTimers() : []).filter(function(f){ return f.seconds > 0; }).slice(0, MAX_TIMERS); }catch(e){ timerRows = []; }
      }
      return loadBookRows().then(function(bookRows){
      Object.keys(ids).forEach(function(id){ var f = ic.widgetFace(id); if(f) faces[id] = f; });
      var keys = Object.keys(faces);
      var feed = usesDyn() ? buildFeed() : null;
      var dyn = feed ? dynItems(feed) : { perWidget: {}, jobs: [] };
      // карточка-будильник: два лица — `<id>` (не заведён) и `<id>_on` (заведён, с надписью «Заведён»); какое показать, решает оболочка по CardAlarms
      var alarmKeys = keys.filter(function(k){ return faces[k].type === "alarm"; });
      var all = keys.map(function(k){ return faces[k].type === "alarm" ? dynPng(alarmFace(faces[k], false)) : pngFor(faces[k]); })
        .concat(dyn.jobs.map(function(j){ return dynPng(j.face); }))
        .concat(alarmKeys.map(function(k){ return dynPng(alarmFace(faces[k], true)); }));
      return Promise.all(all).then(function(urls){
        var images = {};
        keys.forEach(function(k, i){ if(urls[i]) images[k] = urls[i]; });
        dyn.jobs.forEach(function(j, i){ if(urls[keys.length + i]) images[j.key] = urls[keys.length + i]; });
        bookRows.forEach(function(r){ if(r.png) images[bookKey(r.id)] = r.png; });
        alarmKeys.forEach(function(k, i){ var u = urls[keys.length + dyn.jobs.length + i]; if(u) images[k + "_on"] = u; });
        var widgets = data.list.map(function(w){
          return {
            id: w.id, name: wname(w), rotate: w.rotate, rotateMin: w.rotateMin, relevance: w.relevance, battery: !!w.battery, batColor: w.battery ? batHex(w) : "", batteryMulti: !!w.batteryMulti, bat2Color: w.batteryMulti ? bat2Hex(w) : "", chargeDone: !!w.chargeDone, chargeColor: w.chargeDone ? chargeHex(w) : "",
            tasks: !!w.tasks, events: !!w.events, eventsSoon: !!w.events && !!w.eventsSoon, eventsDays: normDays(w.eventsDays, 1), alarms: !!w.alarms, alm: w.alarms ? alarmRows.map(function(f){ return { key: f.id, alarm: f.alarmId || "", alarmSpec: f.alarmSpec, title: f.title }; }) : [], habits: !!w.habits, hab: w.habits ? habitRows.map(function(f){ var hc = (w.habitCfg && w.habitCfg[f.id]) || {}; return { key: f.id, code: f.code, title: f.title, times: hc.times || [], days: hc.days || [], last: f.last || "" }; }) : [], timers: !!w.timers, tmr: w.timers ? timerRows.map(function(f){ var tc = (w.timerCfg && w.timerCfg[f.id]) || {}; return { key: f.id, code: f.code, title: f.title, sec: f.seconds, live: f.live, times: tc.times || [], color: f.color, hidden: !!f.noIsland }; }) : [], books: !!w.books, bks: w.books ? bookEntries(w, bookRows) : [], notes: !!w.notes, nts: w.notes ? noteEntries(w, bookRows) : [], rpeAsk: !!w.rpeAsk, rpeColor: w.rpeAsk ? rpeHex(w) : "", moodAsk: !!w.moodAsk, moodColor: w.moodAsk ? moodHex(w) : "", dyn: dyn.perWidget[w.id] || [],
            cards: w.cards.filter(function(c){ return faces[c.cid]; }).map(function(c){
              var f = faces[c.cid];
              return { key: c.cid, code: f.code, title: f.title, live: f.live, times: c.times, days: c.days, after: (f.type === "datenote" && c.times.indexOf("a") >= 0 && normAfter(c.after) === "none") ? "hide" : normAfter(c.after), prio: normPrio(c.prio), habit: f.type === "habit", tsec: f.type === "timer" ? (f.seconds | 0) : 0, tcol: f.type === "timer" ? f.color : "", thid: f.type === "timer" && !!f.noIsland, alarm: f.type === "alarm" ? (f.alarmId || "") : "", alarmSpec: f.type === "alarm" ? (f.alarmSpec || null) : null };
            })
          };
        });
        if(data.list.length && !data.ever){ data.ever = true; save(); }
        var ok = false;
        try{ ok = !!b.widgetsSync(JSON.stringify({ v: 1, widgets: widgets, images: images })); }catch(e){ ok = false; }
        if(ok && feed) lastFeedSig = feedSig(feed);
        if(ok) setTimeout(refreshWhy, 1500); // оболочка перерисовывает виджеты сразу после sync, причину верхней карточки берём уже после пересчёта
        return ok;
      });
      });
    }

    // ---------- навигация внутри вкладки ----------
    function rootEl(){ return document.getElementById("widgetsTabRoot"); }
    function arm(){
      if(armed || !window.AppNav) return;
      var t = { active: true };
      armed = t;
      window.AppNav.push(function(){
        if(!t.active) return;
        t.active = false; if(armed === t) armed = null;
        if(!rootEl()) return;
        leaveScreen(stack.pop());
        if(stack.length > 1) arm();
        render();
      });
    }
    function disarm(){
      if(!armed) return;
      var t = armed; armed = null; t.active = false;
      try{ history.back(); }catch(e){}
    }
    function go(s, a){ stack.push({ s: s, a: a }); arm(); render(); }
    function backUi(){
      if(stack.length <= 1) return;
      leaveScreen(stack.pop());
      if(stack.length <= 1) disarm();
      render();
    }
    function homeUi(){
      while(stack.length > 1) leaveScreen(stack.pop());
      disarm();
      render();
    }
    function leaveScreen(top){
      if(top && top.s === "form" && top.a && top.a.draft && !hasContent(top.a.w)) top.a.draft = false; // пустой новый виджет не сохраняется
    }
    function cur(){ return stack[stack.length - 1]; }

    // ---------- стили ----------
    function ensureStyles(){
      if(styleDone || document.getElementById("widgetsTabStyle")){ styleDone = true; return; }
      styleDone = true;
      var st = document.createElement("style");
      st.id = "widgetsTabStyle";
      st.textContent =
        ".widgets-tab{padding:10px 12px 96px;}" +
        ".widgets-tab .common-tab-title{margin-bottom:12px;}" +
        ".wg-hint{font-size:13px;line-height:1.35;color:var(--ink-soft);margin:6px 2px 10px;}" +
        ".wg-row{display:flex;align-items:center;padding:10px 12px;margin:0 0 8px;border-radius:14px;background:var(--gold-light);color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-row-ico{flex:0 0 auto;width:42px;height:42px;border-radius:10px;margin-right:12px;}" +
        ".wg-row-txt{flex:1 1 auto;min-width:0;}" +
        ".wg-row-name{font-weight:700;font-size:16px;}" +
        ".wg-name{margin:0 2px 12px;}" +
        ".wg-name input{width:100%;box-sizing:border-box;font-size:16px;}" +
        ".wg-row-sub{font-size:13px;color:var(--ink-soft);}" +
        ".wg-empty{text-align:center;color:var(--ink-soft);padding:40px 16px;font-size:15px;}" +
        ".wg-slots{display:flex;flex-wrap:wrap;justify-content:center;margin:0 -6px 8px;}" +
        ".wg-slot{position:relative;margin:6px 6px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-slot-empty{width:96px;height:98px;box-sizing:border-box;border:2px dashed var(--groove-shadow);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--ink-soft);}" +
        ".wg-slot-empty svg{width:34px;height:34px;}" +
        ".wg-card{position:relative;width:96px;height:98px;border-radius:12px;color:#fff;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:5px;}" +
        ".wg-card > *{flex:0 0 auto;max-width:100%;box-sizing:border-box;}" +
        ".wg-card.used{opacity:.35;}" +
        ".wg-card-ico{width:26px;height:26px;margin-bottom:3px;}" +
        ".wg-card-ico svg{display:block;width:26px;height:26px;}" +
        ".wg-card-title{font-family:\"Palatino Linotype\",Georgia,serif;font-size:11.5px;line-height:1.25;font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:normal;}" +
        ".wg-card-title.t-s{font-size:10px;}" +
        ".wg-card-title.t-xs{font-size:8.5px;}" +
        ".wg-card-big{font-size:18px;line-height:1.1;font-weight:700;white-space:nowrap;margin-top:3px;}" +
        ".wg-card-sub{font-size:8.6px;line-height:1.2;margin-top:3px;}" +
        ".wg-bat-card{padding:0;}" +
        ".wg-bat-card svg{display:block;width:100%;height:100%;}" +
        ".wg-bat-status{font-size:13px;line-height:1.35;color:var(--ink);margin:6px 2px 10px;}" +
        ".wg-badge{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--wood);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;}" +
        ".wg-check{display:flex;align-items:center;margin:10px 2px;font-size:15px;color:var(--ink);}" +
        ".wg-checkrow{display:flex;align-items:center;}" +
        ".wg-checkrow .wg-check{flex:1 1 auto;min-width:0;}" +
        ".wg-swatch{flex:0 0 auto;width:30px;height:30px;margin:0 2px 0 10px;padding:0;border-radius:8px;border:1px solid rgba(0,0,0,.25);box-shadow:inset 0 0 0 2px rgba(255,255,255,.35);cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-swatch.open{box-shadow:0 0 0 2px var(--parchment,#fff),0 0 0 4px var(--ink,#000);}" +
        ".wg-check input[type=checkbox]{width:22px;height:22px;margin:0 10px 0 0;flex:0 0 auto;}" +
        ".wg-evtxt{flex:1 1 auto;min-width:0;line-height:1.9;}" +
        ".wg-daybtn{display:inline-block;min-width:54px;margin:0 2px;padding:3px 10px;border-radius:10px;border:1px solid var(--groove-shadow,rgba(0,0,0,.3));background:var(--gold-light);color:var(--ink);font-size:15px;font-weight:700;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-daybtn.open{background:var(--wood);color:#fff;}" +
        ".wg-caret{margin-left:6px;font-size:11px;}" +
        ".wg-daygrid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:0 2px 10px 32px;max-width:300px;}" +
        ".wg-daycell{padding:10px 0;border-radius:10px;border:0;background:var(--gold-light);color:var(--ink);font-size:16px;font-weight:700;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-daycell.on{background:var(--wood);color:#fff;}" +
        ".wg-min{margin:0 2px 8px 32px;font-size:14px;color:var(--ink);}" +
        ".wg-min input{width:64px;font-size:16px;padding:4px 6px;margin:0 6px;text-align:center;}" +
        ".wg-chips{display:flex;flex-wrap:wrap;margin:6px 0 4px;}" +
        ".wg-chip{margin:0 8px 8px 0;padding:8px 14px;border-radius:18px;background:var(--gold-light);color:var(--ink);font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-chip.on{background:var(--wood);color:#fff;}" +
        ".wg-chip small{opacity:.7;margin-left:4px;font-size:11px;}" +
        ".wg-sec{font-weight:700;margin:14px 2px 2px;color:var(--ink);}" +
        ".wg-habit-dot{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:8px;vertical-align:-1px;border:1px solid rgba(0,0,0,.2);}" +
        ".wg-habit{margin:0 0 10px;padding:0 0 4px;border-bottom:1px solid rgba(0,0,0,.08);}" +
        ".wg-btns{display:flex;flex-direction:column;margin-top:14px;}" +
        ".wg-btns .workbooks-run-btn{margin:0 0 10px;}" +
        ".wg-preview{display:flex;justify-content:center;margin:4px 0 10px;}" +
        ".wg-menu{position:fixed;right:12px;bottom:84px;z-index:30;background:var(--parchment);border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.3);padding:6px;max-height:60vh;overflow:auto;}" +
        ".wg-menu button{display:block;width:100%;text-align:left;margin:2px 0;}" +
        ".wg-menu button.selected{background:var(--wood);color:#fff;}";
      document.head.appendChild(st);
    }

    // ---------- разметка ----------
    function titleSize(t){
      var m = 0; String(t).split(/\s+/).forEach(function(w){ if(w.length > m) m = w.length; });
      var base = (arguments[1] === "timer" || arguments[1] === "alarm") ? 1 : 0;
      return (m >= 11) ? " t-xs" : (m >= 8 + base ? " t-s" : "");
    }
    // Карточка-будильник в форме: то же лицо, что рисует drawDynFace (без надписи «Заведён»; числа — доли ширины карточки ×100, см. DYN)
    function alarmFaceHtml(f, cls, extra){
      var u = DYN.unit * 100, t = '<g transform="translate(' + (50 - 12 * u).toFixed(2) + ' ' + (DYN.iconTop * 100 - 2 * u).toFixed(2) + ') scale(' + u.toFixed(4) + ')" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + DYN_ICONS.alarm + '</g>';
      t += '<text x="50" y="' + (DYN.titleBase * 100).toFixed(1) + '" font-size="' + (DYN.titleFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" textLength="' + Math.min(82, Math.round(String(f.title || "Будильник").length * 6.2)) + '" lengthAdjust="spacingAndGlyphs" font-family="\'Palatino Linotype\',Georgia,serif">' + esc(f.title || "Будильник") + '</text>';
      t += '<text x="50" y="' + (DYN.timeBase * 100).toFixed(1) + '" font-size="' + (DYN.timeFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" font-family="sans-serif">' + esc(f.big || "") + '</text>';
      return '<div class="wg-card wg-bat-card' + (cls ? " " + cls : "") + '" style="background:' + f.color + ';box-shadow:0 4px 0 ' + f.shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg>' + (extra || '') + '</div>';
    }
    function faceHtml(f, cls, extra){
      if(f.type === "alarm") return alarmFaceHtml(f, cls, extra);
      return '<div class="wg-card' + (cls ? " " + cls : "") + '" style="background:' + f.color + ';box-shadow:0 4px 0 ' + f.shade + ';">' +
        (f.svg ? '<div class="wg-card-ico">' + String(f.svg).replace(/currentColor/g, "#ffffff") + '</div>' : '') +
        (f.title ? '<div class="wg-card-title' + titleSize(f.title, f.type) + '">' + esc(f.title) + '</div>' : '') +
        (f.big ? '<div class="wg-card-big">' + esc(f.big) + '</div>' : '') +
        (f.sub ? '<div class="wg-card-sub">' + esc(f.sub) + '</div>' : '') +
        (extra || '') + '</div>';
    }
    // Карточка «Заряд» в форме: уменьшенная копия лица, которое рисует оболочка (QrBattery.kt; числа — доли ширины карточки ×100, образец 78 % / 64 %)
    var WH = ' fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"';
    var ICON_SCALE = 1.5; // как ICON_SCALE в QrBattery.kt: значок и кольцо крупнее исходных, толщина линий прежняя
    // Значок устройства с центром (cx, cy): phone / headphones / watch / speaker / generic (знак Bluetooth)
    function iconSvg(kind, cx, cy){
      var sw = ' stroke-width="' + (1.26 / ICON_SCALE).toFixed(3) + '"', t = '';
      if(kind === "headphones"){
        var ac = cy + 0.63, ct = cy + 1.31, cb = cy + 5.48, L = cx - 4.87, R = cx + 4.87;
        t += '<path d="M' + L + ' ' + ac + ' A4.87 4.87 0 0 1 ' + R + ' ' + ac + '"' + WH + sw + '/>';
        t += '<path d="M' + L + ' ' + ac + ' V' + (ct + 1.49) + ' M' + R + ' ' + ac + ' V' + (ct + 1.49) + '"' + WH + sw + '/>';
        t += '<rect x="' + L + '" y="' + ct + '" width="2.98" height="' + (cb - ct) + '" rx="1.49"' + WH + sw + '/>';
        t += '<rect x="' + (R - 2.98) + '" y="' + ct + '" width="2.98" height="' + (cb - ct) + '" rx="1.49"' + WH + sw + '/>';
      } else if(kind === "watch"){
        t += '<rect x="' + (cx - 3.2) + '" y="' + (cy - 3.4) + '" width="6.4" height="6.8" rx="1.4"' + WH + sw + '/>';
        t += '<rect x="' + (cx - 1.7) + '" y="' + (cy - 5.8) + '" width="3.4" height="2.4" rx="0.8"' + WH + sw + '/>';
        t += '<rect x="' + (cx - 1.7) + '" y="' + (cy + 3.4) + '" width="3.4" height="2.4" rx="0.8"' + WH + sw + '/>';
      } else if(kind === "speaker"){
        t += '<rect x="' + (cx - 3.5) + '" y="' + (cy - 5.5) + '" width="7" height="11" rx="1.6"' + WH + sw + '/>';
        t += '<circle cx="' + cx + '" cy="' + (cy - 3) + '" r="0.9" fill="#fff"/>';
        t += '<circle cx="' + cx + '" cy="' + (cy + 1.8) + '" r="2.2"' + WH + sw + '/>';
      } else if(kind === "earbuds"){
        [-1, 1].forEach(function(sg){
          t += '<circle cx="' + (cx + sg * 2.8) + '" cy="' + (cy - 1.4) + '" r="1.8"' + WH + sw + '/>';
          t += '<path d="M' + (cx + sg * 4.4) + ' ' + (cy - 1.4) + ' V' + (cy + 4) + '"' + WH + sw + '/>';
        });
      } else if(kind === "keyboard"){
        t += '<rect x="' + (cx - 5.2) + '" y="' + (cy - 3) + '" width="10.4" height="6" rx="0.8"' + WH + sw + '/>';
        for(var k = -2; k <= 2; k++){
          t += '<circle cx="' + (cx + k * 1.6) + '" cy="' + (cy - 1.5) + '" r="0.45" fill="#fff"/>';
          t += '<circle cx="' + (cx + k * 1.6) + '" cy="' + (cy - 0.3) + '" r="0.45" fill="#fff"/>';
        }
        t += '<path d="M' + (cx - 2.6) + ' ' + (cy + 1.5) + ' H' + (cx + 2.6) + '"' + WH + sw + '/>';
      } else if(kind === "laptop"){
        t += '<rect x="' + (cx - 3.6) + '" y="' + (cy - 4) + '" width="7.2" height="5.6" rx="0.6"' + WH + sw + '/>';
        t += '<path d="M' + (cx - 5) + ' ' + (cy + 3.4) + ' H' + (cx + 5) + '"' + WH + sw + '/>';
      } else if(kind === "tablet"){
        t += '<rect x="' + (cx - 5.8) + '" y="' + (cy - 4.2) + '" width="11.6" height="8.4" rx="1"' + WH + sw + '/>';
        t += '<circle cx="' + (cx + 4.6) + '" cy="' + cy + '" r="0.5" fill="#fff"/>';
      } else if(kind === "shutter"){
        t += '<circle cx="' + cx + '" cy="' + cy + '" r="4"' + WH + sw + '/>';
        t += '<circle cx="' + cx + '" cy="' + cy + '" r="2.2" fill="#fff"/>';
      } else if(kind === "generic"){
        t += '<path d="M' + (cx - 2.8) + ' ' + (cy - 2.6) + ' L' + (cx + 2.8) + ' ' + (cy + 2.6) + ' L' + cx + ' ' + (cy + 5.4) + ' L' + cx + ' ' + (cy - 5.4) + ' L' + (cx + 2.8) + ' ' + (cy - 2.6) + ' L' + (cx - 2.8) + ' ' + (cy + 2.6) + '"' + WH + sw + '/>';
      } else {
        var mid = cy + 0.57;
        t += '<rect x="' + (cx - 3.67) + '" y="' + (mid - 5.47) + '" width="7.34" height="10.94" rx="1.27"' + WH + sw + '/>';
        t += '<rect x="' + (cx - 1.2) + '" y="' + (mid - 5.87) + '" width="2.4" height="1.63" rx="0.63" fill="#fff"/>';
        t += '<circle cx="' + cx + '" cy="' + (mid + 3.16) + '" r="0.64" fill="#fff"/>';
      }
      return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + ICON_SCALE + ') translate(' + (-cx) + ' ' + (-cy) + ')">' + t + '</g>';
    }
    // Кольцо заряда (доля pct, 0..100) со значком внутри
    function ringSvg(cx, cy, pct, kind){
      var r = 12.63 * ICON_SCALE, c = 2 * Math.PI * r, t = "";
      t += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.12"/>';
      t += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) + '"' + WH + ' stroke-width="2.12" stroke-dasharray="' + (c * pct / 100).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      return t + iconSvg(kind, cx, cy);
    }
    function batFaceHtml(w){
      var hex = batHex(w), shade = cardsOf().cardShade(hex);
      function col(cx, pct, hp){
        var cy = 31, t = ringSvg(cx, cy, pct, hp ? "headphones" : "phone");
        t += '<text x="' + cx + '" y="58.2" font-size="5.11" text-anchor="middle" fill="#fff" font-family="sans-serif">Заряд</text>';
        t += '<text x="' + cx + '" y="66.7" font-size="6.5" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">' + (hp ? "Наушники" : "Телефон") + '</text>';
        t += '<text x="' + cx + '" y="85.7" font-size="16" text-anchor="middle" fill="#fff" font-weight="900" font-family="sans-serif">' + pct + '%</text>';
        return t;
      }
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + col(26.8, 78, false) + col(73.2, 64, true) + '</svg></div>';
    }
    // Карточка «несколько устройств» в форме: четыре кольца без надписей (образец; в виджете — телефон и до трёх подключённых Bluetooth-устройств)
    function bat2FaceHtml(w){
      var hex = bat2Hex(w), shade = cardsOf().cardShade(hex);
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' +
        ringSvg(26.8, 31, 78, "phone") + ringSvg(73.2, 31, 64, "headphones") + ringSvg(26.8, 74, 52, "watch") + ringSvg(73.2, 74, 90, "speaker") + '</svg></div>';
    }
    // Карточка задачи / события в форме: образец лица (в виджете — настоящие задачи и событие; числа — доли ширины карточки ×100, см. DYN)
    function dynFaceHtml(kind, hex){
      var shade = cardsOf().cardShade(hex), smp = DYN_SAMPLE[kind], u = DYN.unit * 100;
      var t = '<g transform="translate(' + (50 - 12 * u).toFixed(2) + ' ' + (DYN.iconTop * 100 - 2 * u).toFixed(2) + ') scale(' + u.toFixed(4) + ')" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + DYN_ICONS[kind] + '</g>';
      t += '<text x="50" y="' + (DYN.labelBase * 100).toFixed(1) + '" font-size="' + (DYN.labelFsMax * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-family="sans-serif">' + DYN_LABELS.today + ', ' + WEEKDAYS_FULL[4] + '</text>';
      t += '<text x="50" y="' + (DYN.titleBase * 100).toFixed(1) + '" font-size="' + (DYN.titleFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">' + esc(smp.title) + '</text>';
      t += '<text x="50" y="' + (DYN.timeBase * 100).toFixed(1) + '" font-size="' + (DYN.timeFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" font-family="sans-serif">' + smp.time + '</text>';
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Как тренировка?» в форме: образец лица (в виджете её рисует оболочка, QrRpe.kt; числа — доли ширины карточки ×100: значок «календарь с галочкой» (клетка 0,96), две строки заголовка, сетка кнопок 2×5)
    function rpeFaceHtml(w){
      var hex = w ? rpeHex(w) : RPE_COLOR, shade = cardsOf().cardShade(hex), serif = "font-family=\"'Palatino Linotype',Georgia,serif\"";
      var t = '<g transform="translate(38.48 3.5) scale(0.96)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M11.5 21h-5.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/><path d="M15 19l2 2l4 -4"/></g>';
      t += '<text x="50" y="41.3" font-size="13" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>Как</text>';
      t += '<text x="50" y="54.2" font-size="13" text-anchor="middle" fill="#fff" font-weight="700" textLength="82" lengthAdjust="spacingAndGlyphs" ' + serif + '>тренировка?</text>';
      for(var i = 0; i < 10; i++){
        var x = 4.7 + (i % 5) * 18.73, y = i < 5 ? 62.06 : 80.88;
        t += '<rect x="' + (x + 0.48).toFixed(2) + '" y="' + (y + 0.48).toFixed(2) + '" width="14.74" height="14.54" rx="2.9" fill="none" stroke="#fff" stroke-width="0.95"/>';
        t += '<text x="' + (x + 7.85).toFixed(2) + '" y="' + (y + 9.7).toFixed(2) + '" font-size="5.5" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>' + (i + 1) + '</text>';
      }
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Как настроение?» в форме: образец лица (в виджете её рисует оболочка, QrMood.kt; числа — доли ширины карточки ×100: значок «смайлик в круге» (клетка 0,756), «Сегодня, <день недели>», заголовок, сетка кнопок-эмодзи 2×4; значок сдвинут на 4 вниз, к кнопкам; надписи — того же размера, что на карточке события календаря)
    var MOOD_EMOJI = ["😌", "😊", "🙄", "😕", "😰", "😡", "🥱", "😔"]; // как CHECKIN_ORDER в mood.js: Внутренний мир, Радость, Спокойствие, Грусть, Тревожность, Раздражительность, Сонливость, Подавленность
    function moodFaceHtml(w){
      var hex = w ? moodHex(w) : RPE_COLOR, shade = cardsOf().cardShade(hex), serif = "font-family=\"'Palatino Linotype',Georgia,serif\"";
      var day = WEEKDAYS_FULL[new Date().getDay()].toLowerCase();
      var t = '<g transform="translate(50 17.8) scale(0.756)" fill="none" stroke="#fff" stroke-width="0.97" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="0" cy="0" r="9"/><path d="M-3 -2h.01"/><path d="M3 -2h.01"/><path d="M-2.5 3a3.5 3.5 0 0 0 5 0"/></g>';
      var lbl = DYN_LABELS.today + ', ' + day; // надписи — того же размера, что у карточки события календаря (DYN.labelFsMax / DYN.titleFs); длинные ужимаются до 86 (как maxW там)
      t += '<text x="50" y="37.2" font-size="' + (DYN.labelFsMax * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-family="sans-serif"' + (lbl.length * 5.2 > 86 ? ' textLength="86" lengthAdjust="spacingAndGlyphs"' : '') + '>' + esc(lbl) + '</text>';
      t += '<text x="50" y="48.2" font-size="' + (DYN.titleFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" textLength="86" lengthAdjust="spacingAndGlyphs" ' + serif + '>Как настроение?</text>';
      for(var i = 0; i < 8; i++){
        var cx = 15.35 + (i % 4) * 23.09, cy = i < 4 ? 63.8 : 86.93;
        t += '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="10.07" fill="none" stroke="#fff" stroke-width="0.82"/>';
        t += '<text x="' + cx.toFixed(2) + '" y="' + (cy + 0.4).toFixed(2) + '" font-size="9.4" text-anchor="middle" dominant-baseline="central">' + MOOD_EMOJI[i] + '</text>';
      }
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Заряд телефона достиг 80 %» в форме: образец лица (в виджете её рисует оболочка, QrCharge.kt; числа — доли ширины карточки ×100: заголовок, кольцо заряда с молнией и процентом внутри, две строки внизу)
    function chargeFaceHtml(w){
      var hex = w ? chargeHex(w) : CHARGE_COLOR, shade = cardsOf().cardShade(hex), serif = "font-family=\"'Palatino Linotype',Georgia,serif\"";
      var cx = 50, cy = 47, r = 21, c = 2 * Math.PI * r, pct = 85;
      var t = '<text x="50" y="17" font-size="10.8" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>Заряд телефона</text>';
      t += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3.6"/>';
      t += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="' + (c * pct / 100).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      t += '<g transform="translate(44 34) scale(0.5)" fill="none" stroke="#fff" stroke-width="2.52" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v7h6l-8 11v-7h-6z"/></g>';
      t += '<text x="50" y="58" font-size="14" text-anchor="middle" fill="#fff" font-weight="900" font-family="sans-serif">' + pct + '%</text>';
      t += '<text x="50" y="83.5" font-size="8.5" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>Можно отключать</text>';
      t += '<text x="50" y="93" font-size="8.5" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>от зарядки</text>';
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Будильники» в форме: лицо первого будильника пользователя (в виджете — все будильники, их листают у краёв), нет будильников — образец
    function alarmsFaceHtml(){
      var list = [];
      try{ list = cardsOf().widgetAlarms(); }catch(e){ list = []; }
      if(list.length) return alarmFaceHtml(list[0], "");
      var hex = cardsOf().paletteColor("");
      return alarmFaceHtml({ title: "Подъём", big: "07:00", color: hex, shade: cardsOf().cardShade(hex) }, "");
    }
    // Карточка привычек в форме: лицо первой привычки пользователя (в виджете — все привычки: «в своё время» по кругу, остальные листаются у краёв), нет привычек — образец
    function habitsFaceHtml(){
      var list = [];
      try{ list = cardsOf().widgetHabits(); }catch(e){ list = []; }
      if(list.length) return faceHtml(list[0], "");
      var hex = cardsOf().paletteColor("");
      return faceHtml({ type: "habit", title: "Бег", color: hex, shade: cardsOf().cardShade(hex), svg: "", big: "", sub: "" }, "");
    }
    // Число в кольце карточки «Таймеры» — как в оболочке (QrTimerFace.numberText для не запущенного таймера): до 99 минут включительно — целые минуты вверх («99»), дольше «Ч:ММ», короче минуты — «0:СС»
    function timerNumText(sec){
      sec = Math.max(0, sec | 0);
      if(sec > 99 * 60){ var tm = Math.ceil(sec / 60); return Math.floor(tm / 60) + ":" + (tm % 60 < 10 ? "0" : "") + (tm % 60); }
      if(sec >= 60) return String(Math.ceil(sec / 60));
      return "0:" + (sec < 10 ? "0" : "") + sec;
    }
    // Карточка «Таймеры» в форме: образец лица (в виджете её рисует оболочка, QrTimerFace.kt; числа — доли ширины карточки ×100, сняты с образца заказчика: название, кольцо с минутами);
    // берётся первый таймер пользователя, нет таймеров — образец «Таймер» / 23
    function timersFaceHtml(){
      var list = [];
      try{ list = typeof cardsOf().widgetTimers === "function" ? cardsOf().widgetTimers() : []; }catch(e){ list = []; }
      var title = list.length ? (list[0].title || "Таймер") : "Таймер", num = list.length ? timerNumText(list[0].seconds) : "23";
      var faceColor = list.length && list[0].color ? list[0].color : TIMER_COLOR; // цвет лица — цвет самого таймера на вкладке QR-кодов
      var shade = cardsOf().cardShade(faceColor);
      var t = '<text x="50" y="18.4" font-size="10.8" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">' + esc(title.length > 16 ? title.slice(0, 15) + "…" : title) + '</text>';
      t += '<circle cx="50" cy="59" r="25.75" fill="none" stroke="#fff" stroke-width="3.8"/>';
      t += '<text x="50" y="' + (59 + 29 * 0.355).toFixed(1) + '" font-size="' + (num.length > 3 ? 20 : 29) + '" text-anchor="middle" fill="#fff" font-family="sans-serif">' + esc(num) + '</text>';
      return '<div class="wg-card wg-bat-card" style="background:' + faceColor + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Книги» в форме: образец (в виджете на ней лицо книги — обложка; листается краями, внизу точки по числу книг)
    function booksFaceHtml(w){
      var color = "#9a917f", shade = cardsOf().cardShade(color), n = w.bookList.length;
      var icon = '<g transform="translate(32 17) scale(1.5)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6v13"/><path d="M12 6v13"/><path d="M21 6v13"/></g>';
      var t = icon + '<text x="50" y="68" font-size="12.5" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">Книги</text>';
      t += '<text x="50" y="83" font-size="10" text-anchor="middle" fill="#fff" font-family="sans-serif">' + (n ? esc(String(n)) : "пока нет") + '</text>';
      return '<div class="wg-card wg-bat-card" style="background:' + color + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Заметки» в форме: образец (в виджете на ней лицо заметки — цвет и название заметки; листается краями, внизу точки по числу заметок)
    function notesFaceHtml(w){
      var color = NOTE_DEFAULT_COLOR, shade = cardsOf().cardShade(color), n = w.noteList.length;
      var icon = '<g transform="translate(32 17) scale(1.5)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4"/><line x1="7.5" y1="11" x2="14" y2="11"/><line x1="7.5" y1="15" x2="14" y2="15"/></g>';
      var t = icon + '<text x="50" y="68" font-size="12.5" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">Заметки</text>';
      t += '<text x="50" y="83" font-size="10" text-anchor="middle" fill="#fff" font-family="sans-serif">' + (n ? esc(String(n)) : "пока нет") + '</text>';
      return '<div class="wg-card wg-bat-card" style="background:' + color + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    function tasksFaceHtml(w){ return dynFaceHtml("task", dynHex(w, "task")); }
    function eventsFaceHtml(w){ return dynFaceHtml("event", dynHex(w, "event")); }
    // Строка списка виджетов: что в стопке, кроме карточек QR-кодов
    function contentText(w){
      var extra = [];
      if(w.battery) extra.push("заряд");
      if(w.batteryMulti) extra.push("заряд устройств");
      if(w.tasks) extra.push("задачи");
      if(w.events) extra.push("события");
      if(w.alarms) extra.push("будильники");
      if(w.habits) extra.push("привычки");
      if(w.timers) extra.push("таймеры");
      if(w.books) extra.push("книги");
      if(w.notes) extra.push("заметки");
      if(w.rpeAsk) extra.push("вопрос о тренировке");
      if(w.moodAsk) extra.push("вопрос о настроении");
      if(w.chargeDone) extra.push("заряд телефона 80 %");
      if(w.cards.length) return cardWord(w.cards.length) + (extra.length ? " + " + extra.join(" + ") : "");
      if(!extra.length) return cardWord(0);
      return (w.battery && extra.length === 1) ? "заряд аккумулятора" : extra.join(" + ");
    }
    // Что с наушниками сейчас (из оболочки, поле bt в widgetsState): причина, по которой в карточке «Заряд» нет их заряда
    function batStatusText(){
      var st = nativeState(), bt = st && st.bt;
      if(!bt) return "";
      var n = bt.name ? " «" + bt.name + "»" : "";
      if(bt.reason === "ok"){
        var srcName = {system:"из системы", meta:"из метаданных", broadcast:"из вещания", hfp:"из команд гарнитуры", gatt:"по BLE"}[bt.src];
        return "Наушники" + n + ": заряд " + bt.level + " %" + (srcName ? " (" + srcName + ")" : "") + ".";
      }
      if(bt.reason === "nolevel") return "Наушники" + n + " подключены, но телефон пока не передал их заряд — в карточке «--%». Заряд появится, когда наушники сообщат его (обычно при подключении или смене заряда).";
      if(bt.reason === "perm") return "Нет доступа к Bluetooth: разрешите приложению «Устройства поблизости» (настройки телефона → Приложения → Разрешения). Пока в карточке только телефон.";
      if(bt.reason === "off") return "Bluetooth выключен — в карточке только телефон.";
      if(bt.reason === "nobt") return "На этом телефоне нет Bluetooth — в карточке только телефон.";
      return "Подключённых Bluetooth-наушников не найдено — в карточке только телефон.";
    }
    function fabRow(inner){ return '<div class="mdeditor-fab-row">' + inner + '</div>'; }
    var exitCb = null, exitArmed = null; // открыт из вкладки «QR-коды»: домик и «назад» на списке виджетов возвращают к карточкам
    function homeBtn(title, disabled){
      return '<button type="button" class="mdeditor-fab-btn" id="wgHomeBtn" title="' + esc(title) + '"' + (disabled ? ' tabindex="-1" aria-disabled="true"' : '') + '>' + HOME_SVG + '</button>';
    }
    // «Сейчас сверху: … — причина»: что оболочка (QrWidgets.kt, мост ≥36 widgetWhy) поставила наверх этого виджета при последнем расчёте. Пусто — моста нет, виджет ещё не отправлен оболочке или порядок не зависит от баллов
    function whyText(w){
      var b = window.LifeTrackerNative;
      if(!w || !bridge() || typeof b.widgetWhy !== "function" || !(w.relevance || w.rpeAsk || w.moodAsk || w.chargeDone)) return "";
      var o = null;
      try{ o = JSON.parse(b.widgetWhy(w.id) || "{}"); }catch(e){ o = null; }
      if(!o || typeof o.key !== "string") return "";
      if(o.key) return "Сейчас сверху: «" + (o.title || "карточка") + "»" + (o.reason ? " — " + o.reason : "") + ".";
      return w.relevance ? "Сейчас сверху ничего не выделено: карточки идут в вашем порядке." : "";
    }
    var whyWid = "";
    function refreshWhy(){
      var el = document.getElementById("wgWhy");
      if(!el || !whyWid) return;
      var w = widgetById(whyWid), t = w ? whyText(w) : "";
      el.textContent = t; el.style.display = t ? "" : "none";
    }
    function modeText(w){
      if(w.rotate) return "по кругу, раз в " + w.rotateMin + " мин";
      if(w.relevance) return "по релевантности";
      return "листаете сами";
    }
    function cardWord(n){
      var m = n % 10, h = n % 100;
      return n + " " + (m === 1 && h !== 11 ? "карточка" : ((m >= 2 && m <= 4 && (h < 12 || h > 14)) ? "карточки" : "карточек"));
    }

    function listHtml(){
      var st = nativeState(), placed = (st && st.placed) || {};
      var html = '<h3 class="common-tab-title">Конструктор виджетов</h3>';
      if(!data.list.length){
        html += '<div class="wg-empty">Виджетов пока нет.<br>Нажмите «+», чтобы собрать стопку из карточек QR-кодов.</div>';
      }
      data.list.forEach(function(w){
        var f = w.cards.length ? cardsOf().widgetFace(w.cards[0].cid) : null;
        html += '<div class="wg-row" data-id="' + esc(w.id) + '">' +
          '<div class="wg-row-ico" style="background:' + (f ? f.color : (w.battery ? batHex(w) : (w.batteryMulti ? bat2Hex(w) : (w.tasks ? dynHex(w, "task") : (w.events ? dynHex(w, "event") : (w.alarms ? cardsOf().paletteColor("") : (w.habits ? cardsOf().paletteColor("") : (w.timers ? TIMER_COLOR : "var(--gold)")))))))) + ';"></div>' +
          '<div class="wg-row-txt"><div class="wg-row-name">' + esc(wname(w)) + '</div>' +
          '<div class="wg-row-sub">' + contentText(w) + ' · ' + modeText(w) + (placed[w.id] ? ' · на рабочем столе' : '') + '</div></div></div>';
      });
      if(!bridge()) html += '<div class="wg-hint">Виджеты работают только в приложении на телефоне (Android).</div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn" id="wgAddBtn" title="Новый виджет">' + PLUS_SVG + '</button>' + homeBtn(exitCb ? "К карточкам" : "", !exitCb));
      return html;
    }

    // строка пункта с галочкой; у пунктов с цветом справа квадрат выбранного цвета (нажатие открывает палитру `pal`, она сворачивается после выбора)
    function checkRow(id, on, text, pal, hex){
      return '<div class="wg-checkrow"><label class="wg-check"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '>' + text + '</label>' +
        (pal && on ? '<button type="button" class="wg-swatch" id="wgSw_' + pal[0] + '" data-pal="' + pal[0] + '" style="background:' + hex + ';" title="Цвет карточки" aria-label="Цвет карточки"></button>' : '') + '</div>';
    }
    function palBlock(pal){ return '<div class="wg-pal" id="wgPal_' + pal[0] + '" style="display:none">' + cardsOf().colorPalette(pal[1], pal[0]) + '</div>'; }
    // «Показывать мероприятия на [N ▾] день/дня/дней вперёд»: галочка, число с выпадающей сеткой 5×3 (1…15) и склоняемое слово
    function eventsDaysRow(w){
      var n = normDays(w.eventsDays, 1);
      var h = '<div class="wg-check wg-evsoon"><input type="checkbox" id="wgEventsSoon"' + (w.eventsSoon ? ' checked' : '') + '><span class="wg-evtxt">' +
        '<label for="wgEventsSoon">Показывать мероприятия на</label> ' +
        '<button type="button" class="wg-daybtn" id="wgEvDaysBtn" aria-haspopup="true" aria-expanded="false" title="Сколько дней вперёд">' + n + '<span class="wg-caret">▾</span></button> ' +
        '<label for="wgEventsSoon">' + dayWord(n) + ' вперёд</label></span></div>';
      h += '<div class="wg-daygrid" id="wgEvDaysGrid" style="display:none">';
      for(var i = 1; i <= EVENTS_DAYS_MAX; i++) h += '<button type="button" class="wg-daycell' + (i === n ? ' on' : '') + '" data-n="' + i + '">' + i + '</button>';
      return h + '</div>';
    }
    function formHtml(a){
      var w = a.w, html = '<h3 class="common-tab-title" id="wgFormTitle">' + esc(wname(w)) + '</h3>' +
        '<div class="wg-name"><input type="text" class="mdeditor-cleanup-input" id="wgNameInput" maxlength="' + WNAME_MAX + '" placeholder="Виджет ' + w.n + '" value="' + esc(w.name || "") + '" autocomplete="off" aria-label="Название виджета" title="Название виджета"></div>' +
        '<div class="wg-slots">';
      for(var i = 0; i < w.cards.length; i++){
        var c = w.cards[i], f = cardsOf().widgetFace(c.cid);
        if(f){
          var sched = (c.times.length || c.days.length) ? '<div class="wg-badge">⏰</div>' : '';
          html += '<div class="wg-slot" data-i="' + i + '">' + faceHtml(f, "", sched) + '</div>';
        } else {
          html += '<div class="wg-slot" data-i="' + i + '"><div class="wg-slot-empty">?</div></div>'; // карточку удалили
        }
      }
      if(w.cards.length < MAX_CARDS) html += '<div class="wg-slot" data-add="1"><div class="wg-slot-empty">' + PLUS_SVG + '</div></div>'; // всегда одна «+», пока не достигнут предел
      if(w.battery) html += '<div class="wg-slot" data-bat="1" id="wgBatSlot">' + batFaceHtml(w) + '</div>'; // карточка заряда — последняя в стопке, после слотов и «+»
      if(w.batteryMulti) html += '<div class="wg-slot" data-bat="1" id="wgBat2Slot">' + bat2FaceHtml(w) + '</div>'; // карточка заряда нескольких устройств — после карточки заряда
      if(w.tasks) html += '<div class="wg-slot" data-bat="1" id="wgTasksSlot">' + tasksFaceHtml(w) + '</div>'; // образец карточки задач (в виджете это одна карточка, которую листают по задачам)
      if(w.events) html += '<div class="wg-slot" data-bat="1" id="wgEventsSlot">' + eventsFaceHtml(w) + '</div>'; // образец карточки события
      if(w.alarms) html += '<div class="wg-slot" data-bat="1" id="wgAlarmsSlot">' + alarmsFaceHtml() + '</div>'; // карточка будильников (в виджете одна на все будильники, листается у краёв)
      if(w.habits) html += '<div class="wg-slot" data-habits="1" id="wgHabitsSlot">' + habitsFaceHtml() + '</div>'; // карточка привычек (нажатие — время суток и дни каждой привычки)
      if(w.timers) html += '<div class="wg-slot" data-timers="1" id="wgTimersSlot">' + timersFaceHtml() + '</div>'; // карточка таймеров (нажатие — время суток каждого таймера)
      if(w.books) html += '<div class="wg-slot" data-bat="1" id="wgBooksSlot">' + booksFaceHtml(w) + '</div>'; // образец карточки книг (книги добавляются на экране «Книги-карточки»)
      if(w.notes) html += '<div class="wg-slot" data-bat="1" id="wgNotesSlot">' + notesFaceHtml(w) + '</div>'; // образец карточки заметок (заметки добавляются на экране «Заметки-карточки»)
      if(w.rpeAsk) html += '<div class="wg-slot" data-bat="1" id="wgRpeSlot">' + rpeFaceHtml(w) + '</div>'; // образец «Как тренировка?» (в виджете она стоит над всеми карточками, пока есть запись без оценки)
      if(w.moodAsk) html += '<div class="wg-slot" data-bat="1" id="wgMoodSlot">' + moodFaceHtml(w) + '</div>'; // образец «Как настроение?» (в виджете она стоит над всеми обычными карточками с 20:30, пока сегодня не отмечено настроение)
      if(w.chargeDone) html += '<div class="wg-slot" data-bat="1" id="wgChargeSlot">' + chargeFaceHtml(w) + '</div>'; // образец «Заряд телефона достиг 80 %» (в виджете она стоит наверху, пока телефон на зарядке и заряд 80…100 %)
      html += '</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgRotate"' + (w.rotate ? ' checked' : '') + '>Переключать виджеты по кругу</label>';
      if(w.rotate) html += '<div class="wg-min">каждые<input type="number" id="wgRotMin" min="1" max="720" value="' + w.rotateMin + '">мин</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgRel"' + (w.relevance ? ' checked' : '') + '>Переключение по релевантности</label>';
      if(bridge() && typeof window.LifeTrackerNative.widgetWhy === "function" && (w.relevance || w.rpeAsk || w.moodAsk || w.chargeDone)){
        whyWid = w.id;
        var wt = whyText(w);
        html += '<div class="wg-bat-status" id="wgWhy"' + (wt ? '' : ' style="display:none"') + '>' + esc(wt) + '</div>';
      }
      html += checkRow("wgBat", w.battery, "Отображать заряд аккумулятора (наушники и телефон)", ["icfColors", "battery"], batHex(w));
      if(w.battery){
        html += palBlock(["icfColors", "battery"]);
        var bst = batStatusText();
        if(bst) html += '<div class="wg-bat-status" id="wgBatStatus">' + esc(bst) + '</div>';
      }
      html += checkRow("wgBat2", w.batteryMulti, "Отображать заряд аккумулятора (несколько устройств)", ["icfColors2", "battery2"], bat2Hex(w));
      if(w.batteryMulti) html += palBlock(["icfColors2", "battery2"]);
      html += checkRow("wgTasks", w.tasks, "Показывать задачи", ["icfColors3", "wgtasks"], dynHex(w, "task"));
      if(w.tasks) html += palBlock(["icfColors3", "wgtasks"]);
      html += checkRow("wgEvents", w.events, "Показывать события календаря", ["icfColors4", "wgevents"], dynHex(w, "event"));
      if(w.events) html += palBlock(["icfColors4", "wgevents"]);
      if(w.events) html += eventsDaysRow(w);
      html += '<label class="wg-check"><input type="checkbox" id="wgAlarms"' + (w.alarms ? ' checked' : '') + '>Показывать будильники</label>';
      html += '<label class="wg-check"><input type="checkbox" id="wgHabits"' + (w.habits ? ' checked' : '') + '>Отображать карточки привычек</label>';
      if(w.habits) html += '<div class="wg-hint">Нажмите на карточку привычек выше, чтобы задать время суток и дни недели каждой привычки: привычка в своё время встаёт в круг наравне с календарём.</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgTimers"' + (w.timers ? ' checked' : '') + '>Отображать таймеры</label>';
      if(w.timers) html += '<div class="wg-hint">Нажмите на карточку таймеров выше, чтобы выбрать каждому таймеру время суток (необязательно): в своё время таймер встаёт выше календаря. Идущий таймер всегда наверху.</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgBooks"' + (w.books ? ' checked' : '') + '>Отображать книги</label>';
      if(w.books) html += '<div class="wg-hint">Книги добавляются на экране «Книги-карточки»: долгое нажатие на книге, затем кнопка с виджетом. Нажатие на карточку в виджете открывает книгу. Сейчас в этом виджете книг: ' + w.bookList.length + '.</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgNotes"' + (w.notes ? ' checked' : '') + '>Отображать заметки</label>';
      if(w.notes) html += '<div class="wg-hint">Заметки добавляются на экране «Заметки-карточки»: долгое нажатие на заметке, затем кнопка с виджетом. Там же, в «Настройках карточки», выбирается время суток, когда заметка встаёт наверх. Нажатие на карточку в виджете открывает заметку. Сейчас в этом виджете заметок: ' + w.noteList.length + '.</div>';
      html += checkRow("wgRpe", w.rpeAsk, "Спрашивать о тренировке", ["icfColors5", "wgrpe"], rpeHex(w));
      if(w.rpeAsk) html += palBlock(["icfColors5", "wgrpe"]);
      html += checkRow("wgMood", w.moodAsk, "Спрашивать о настроении", ["icfColors6", "wgmood"], moodHex(w));
      if(w.moodAsk) html += palBlock(["icfColors6", "wgmood"]);
      html += checkRow("wgCharge", w.chargeDone, "Показывать карточку о том, что заряд телефона достиг 80%", ["icfColors7", "wgcharge"], chargeHex(w));
      if(w.chargeDone) html += palBlock(["icfColors7", "wgcharge"]);
      var st = nativeState(), placed = st && st.placed && st.placed[w.id];
      html += '<div class="wg-btns">';
      if(bridge()) html += '<button type="button" class="workbooks-run-btn" id="wgPinBtn">' + (placed ? 'Добавить ещё один на рабочий стол' : 'Добавить на рабочий стол') + '</button><div class="wg-hint" id="wgPinHint"></div>';
      html += '<button type="button" class="workbooks-run-btn" id="wgDelBtn">Удалить виджет</button></div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn" id="wgInfoBtn" title="Описание галочек">' + INFO_SVG + '</button>' + homeBtn("К списку виджетов"));
      return html;
    }

    // экран «i»: описание всех галочек формы виджета (в самой форме остаются только пункты с галочками)
    var INFO_ITEMS = [
      ["Переключать виджеты по кругу", "Карточки сменяют друг друга сами раз в заданное число минут. Включить можно что-то одно: «по кругу» или «по релевантности»."],
      ["Переключение по релевантности", "Наверху то, что запущено сейчас (тренировка, затем помодоро, затем таймеры и секундомер), следом карточки, у которых сейчас их время суток и день. Если наверху оказались несколько карточек с одинаковым приоритетом (например, несколько «утренних», календарь, привычки, у которых время пришло), они сменяют друг друга наверху по очереди, каждая на минуту. Карточка со многими элементами (привычки, будильники) всегда одна: по очереди меняются её элементы с самым высоким приоритетом; элементы не в своё время в круг не входят. Всё, что важнее (идёт занятие, звонит или скоро зазвонит будильник, скоро событие), круг прерывает. Если стопку пролистали вручную, через минуту она возвращается наверх. Включить можно что-то одно: «по кругу» или «по релевантности»."],
      ["Отображать заряд аккумулятора (наушники и телефон)", "В стопке появится карточка с зарядом телефона и, если подключены Bluetooth-наушники, их заряда. Нет галочки — карточки в стопке нет."],
      ["Отображать заряд аккумулятора (несколько устройств)", "Ещё одна карточка в стопке — без надписей, только значки и кольца заряда: телефон и до трёх подключённых Bluetooth-устройств (наушники, часы, колонка и т. п.)."],
      ["Показывать задачи", "Одна карточка с ближайшими невыполненными задачами из календаря: просроченные первыми, затем сегодняшние и на неделю вперёд. Нажатие у левого или правого края карточки листает задачи, двойное нажатие в центре отмечает показанную задачу выполненной, и на её место встаёт следующая. Если не отметить, вместо «Сегодня» будет «Просрочено». Через минуту без нажатий снова показывается первая задача. Нет галочки — карточки задач в стопке нет."],
      ["Показывать события календаря", "Одна карточка — следующее запланированное событие, с надписью «Сегодня, Четверг», «Завтра, Суббота» или, если до него неделя и больше, «25 ноября, Среда». Нажатие у левого или правого края листает ближайшие события (до десяти). Если событий в нужном окне нет, карточки в стопке нет; по умолчанию окно — ближайшая неделя, его можно изменить галочкой ниже. Нет галочки — карточки события в стопке нет."],
      ["Показывать мероприятия на [число] день/дня/дней вперёд", "Появляется под «Показывать события календаря», по умолчанию выключена. Нажмите на число и выберите его в сетке от 1 до 15: 1 — только сегодняшние мероприятия, 2 — сегодня и завтра, 3 — на три дня и так далее (выбор числа сам включает галочку). Карточка события показывает только мероприятия в этом окне, а если в нём событий нет, карточки календаря в стопке нет. Если галочка выключена — мероприятия ближайшей недели."],
      ["Показывать будильники", "Одна карточка со всеми вашими будильниками (карточки «Будильник» вкладки QR-кодов): время, название и надпись «Заведён» / «Не заведён». Нажатие у левого или правого края карточки листает все будильники, нажатие в центре заводит показанный будильник или выключает его. Пока будильник звонит, показан он (если звонят несколько — по очереди, по минуте); перед звонком (за 30 минут) — тот, что скоро зазвонит; иначе — ближайший из заведённых (нет заведённых — первый по времени). Через минуту без нажатий карточка снова возвращается к этому правилу. Нет галочки — карточки будильников в стопке нет."],
      ["Отображать карточки привычек", "Карточки ваших привычек (карточки «Привычка» вкладки QR-кодов). Нажмите на карточку привычек в форме и задайте каждой привычке время суток и дни недели. Карточка привычек в стопке всегда одна. Привычка, у которой сейчас её время, участвует в круге равных (при «Переключении по релевантности»): по минутам на карточке показывается очередная такая привычка. Привычки не в своё время в круг не попадают. Нажатие у левого или правого края карточки листает все привычки (выбор держится минуту после последнего нажатия), одно нажатие в центре открывает карту дней привычки, двойное — отмечает её выполненной: исчезает только эта привычка, до конца дня. Когда отмечены все привычки, карточки привычек в стопке нет совсем. Нет галочки — привычек в стопке нет."],
      ["Отображать таймеры", "Одна карточка со всеми вашими таймерами (карточки «Таймер» вкладки QR-кодов, скрытые таймеры тоже: они идут так же, только без острова): цвета самого таймера (того, что задан ему на вкладке QR-кодов), с названием, кольцом и числом минут. Не запущенный таймер показывает заданное время, идущий — остаток; кольцо и минуты перерисовываются раз в минуту. Нажатие у левого или правого края листает таймеры, нажатие в центре запускает показанный таймер (идущий не трогает). Идущий таймер — самая важная карточка: она встаёт наверх выше «Как тренировка?», календаря и всего остального, даже без «Переключения по релевантности». Если идут два таймера и больше, они сменяют друг друга по очереди, каждый на минуту. Нажмите на карточку таймеров в форме и выберите таймеру время суток — необязательно: в своё время (если таймер не запущен) он встаёт выше календаря и привычек и сменяет такие же по минутам; без времени суток таймер наверх не поднимается, его можно найти, листая карточку у краёв. Нет галочки — карточки таймеров в стопке нет."],
      ["Отображать книги", "Одна карточка со всеми книгами, которые вы добавили в этот виджет. Добавить книгу можно на экране «Книги-карточки» (вкладка «Мои книги»): долгое нажатие на книге, затем кнопка с виджетом — откроется список ваших виджетов; выберите нужный, и книга будет отображаться в нём. Тот же выбор ещё раз убирает книгу из этого виджета. На карточке — обложка книги (положение обложки и цвет выступа такие же, как в приложении; у книги без обложки — название на заглушке). Нажатие у левого или правого края листает книги, внизу кружки показывают, сколько книг и какая сейчас. Если включить галочку, когда в виджете ещё нет ни одной книги, появится подсказка, где их добавить. Нет галочки — карточки книг в стопке нет."],
      ["Отображать заметки", "Одна карточка со всеми заметками, которые вы добавили в этот виджет, отдельно от карточки книг. Добавить заметку можно на экране «Заметки-карточки» (вкладка «Мои заметки»): долгое нажатие на заметке, затем кнопка с виджетом — откроется список ваших виджетов; выберите нужный. Тот же выбор ещё раз убирает заметку из этого виджета. На карточке — цвет и название заметки (цвет выбирается в «Настройках карточки»). Там же выбирается время суток заметки: «Не выбрано», «Утро», «Обед», «Вечер» или «Все время». Заметка в своё время (если включено «Переключение по релевантности») встаёт в круг наравне с календарём и привычками; «Все время» — заметка всегда в этом круге. Нажатие у левого или правого края листает заметки, внизу кружки показывают, сколько заметок и какая сейчас; нажатие в центре открывает заметку. Нет галочки — карточки заметок в стопке нет."],
      ["Спрашивать о тренировке", "После тренировки, пока вы не оценили нагрузку, наверху стопки появляется карточка «Как тренировка?» с кнопками от 1 до 10. Нажатие на число сразу сохраняет оценку, и карточка исчезает. Если пролистнуть на другую карточку, через минуту она вернётся наверх; порядок остальных карточек не меняется. Нет галочки — карточки нет."],
      ["Показывать карточку о том, что заряд телефона достиг 80%", "Пока телефон стоит на зарядке и его заряд не ниже 80 % (80, 81, 85 … 100 %), наверху стопки стоит карточка «Заряд телефона» с текущим процентом и надписью «Можно отключать от зарядки». Отключили телефон от зарядки — карточка уходит сама. Она важнее «Как тренировка?» и «Как настроение?», но ниже карточки низкого заряда (ниже 30 %) и идущего таймера; работает при любом режиме, даже без «Переключения по релевантности». Нажатия на карточке нет. Если приложение выгружено из памяти, карточка может появиться с задержкой до пяти минут. Цвет выбирается палитрой справа от галочки."],
      ["Спрашивать о настроении", "Каждый вечер в 20:30, если за день вы ни разу не отметили настроение (ни в приложении, ни в виджете), наверху стопки появляется карточка «Как настроение?» с восемью эмодзи — теми же чувствами, что на вкладке настроения. Нажатие на эмодзи сразу записывает настроение, и карточка исчезает; не отметили — в полночь она уходит сама, а завтра вечером придёт снова. Она стоит выше календаря и остальных карточек (как «Как тренировка?»); если ждут обе, «Как тренировка?» выше. Если пролистнуть на другую карточку, через минуту она вернётся наверх. Нет галочки — карточки нет."]
    ];
    function infoHtml(){
      var html = '<h3 class="common-tab-title">Описание галочек</h3>';
      INFO_ITEMS.forEach(function(it){
        html += '<div class="wg-sec">' + esc(it[0]) + '</div><div class="wg-hint">' + esc(it[1]) + '</div>';
      });
      html += fabRow(homeBtn("К виджету"));
      return html;
    }

    // экран «Привычки»: у каждой привычки — время суток и дни недели (необязательно), только для этого виджета
    function habitsHtml(a){
      var w = a.w, list = [];
      try{ list = cardsOf().widgetHabits().slice(0, MAX_HABITS); }catch(e){ list = []; }
      var html = '<h3 class="common-tab-title">Привычки</h3>';
      html += '<div class="wg-hint">Время суток и дни недели — необязательно. Если сейчас время привычки (её время суток и день), она встаёт в круг карточек наравне с календарём и другими такими привычками. «Целый день» — время привычки весь день (в выбранные дни недели): она стоит выше, пока не отмечена, а отмеченная убирается до полуночи. Привычка без времени в круг не попадает: её можно найти, листая карточку привычек нажатием у левого и правого края.</div>';
      if(!list.length) html += '<div class="wg-empty">Привычек пока нет.<br>Создайте их на вкладке QR-кодов: «+» → «Привычка».</div>';
      list.forEach(function(f){
        var hc = (w.habitCfg && w.habitCfg[f.id]) || { times: [], days: [] };
        html += '<div class="wg-habit" data-cid="' + esc(f.id) + '"><div class="wg-sec"><span class="wg-habit-dot" style="background:' + f.color + ';"></span>' + esc(f.title || "Привычка") + '</div>';
        html += '<div class="wg-chips wg-habit-times">';
        WINDOWS.concat([WINDOW_ALL]).forEach(function(t){ html += '<div class="wg-chip' + (hc.times.indexOf(t.k) >= 0 ? ' on' : '') + '" data-k="' + t.k + '">' + t.label + '<small>' + t.hint + ' ч</small></div>'; });
        html += '</div><div class="wg-chips wg-habit-days">';
        DAYS.forEach(function(d, i){ html += '<div class="wg-chip' + (hc.days.indexOf(i + 1) >= 0 ? ' on' : '') + '" data-d="' + (i + 1) + '">' + d + '</div>'; });
        html += '</div></div>';
      });
      html += fabRow(homeBtn("К виджету"));
      return html;
    }

    // экран «Таймеры»: у каждого таймера — время суток (необязательно), только для этого виджета
    function timersHtml(a){
      var w = a.w, list = [];
      try{ list = typeof cardsOf().widgetTimers === "function" ? cardsOf().widgetTimers().slice(0, MAX_TIMERS) : []; }catch(e){ list = []; }
      var html = '<h3 class="common-tab-title">Таймеры</h3>';
      html += '<div class="wg-hint">Время суток — необязательно. Если таймер не запущен и сейчас его время суток, он встаёт выше календаря и привычек (при «Переключении по релевантности»), а несколько таких таймеров сменяют друг друга по минутам. Таймер без времени суток наверх не поднимается: его можно найти, листая карточку таймеров нажатием у левого и правого края. Идущий таймер всегда наверху, что бы тут ни стояло.</div>';
      if(!list.length) html += '<div class="wg-empty">Таймеров пока нет.<br>Создайте их на вкладке QR-кодов: «+» → «Таймер».</div>';
      list.forEach(function(f){
        var tc = (w.timerCfg && w.timerCfg[f.id]) || { times: [] };
        html += '<div class="wg-habit" data-cid="' + esc(f.id) + '"><div class="wg-sec"><span class="wg-habit-dot" style="background:' + (f.color || TIMER_COLOR) + ';"></span>' + esc(f.title || "Таймер") + ' · ' + esc(f.big) + '</div>';
        html += '<div class="wg-chips wg-timer-times">';
        WINDOWS.forEach(function(t){ html += '<div class="wg-chip' + (tc.times.indexOf(t.k) >= 0 ? ' on' : '') + '" data-k="' + t.k + '">' + t.label + '<small>' + t.hint + ' ч</small></div>'; });
        html += '</div></div>';
      });
      html += fabRow(homeBtn("К виджету"));
      return html;
    }

    function cardHtml(a){
      var w = a.w, c = w.cards[a.i], f = c ? cardsOf().widgetFace(c.cid) : null;
      if(!c) return '';
      var html = '<h3 class="common-tab-title">Карточка ' + (a.i + 1) + ' из ' + w.cards.length + '</h3>';
      if(f) html += '<div class="wg-preview">' + faceHtml(f, "") + '</div>';
      var isToday = !!(f && f.type === "datenote");
      html += '<div class="wg-sec">Время суток</div><div class="wg-chips" id="wgTimes">';
      (isToday ? WINDOWS.concat([WINDOW_ALL]) : WINDOWS).forEach(function(t){ html += '<div class="wg-chip' + (c.times.indexOf(t.k) >= 0 ? ' on' : '') + '" data-k="' + t.k + '">' + t.label + '<small>' + t.hint + ' ч</small></div>'; });
      html += '</div><div class="wg-sec">Дни недели</div><div class="wg-chips" id="wgDays">';
      DAYS.forEach(function(d, i){ html += '<div class="wg-chip' + (c.days.indexOf(i + 1) >= 0 ? ' on' : '') + '" data-d="' + (i + 1) + '">' + d + '</div>'; });
      html += '</div><div class="wg-hint">Необязательно. Если выбрать, карточка поднимается наверх в эти часы и дни — при включённом «Переключении по релевантности». Если не выбрано ничего, она ничем не выделяется.' + (isToday ? ' «Целый день» — карточка весь день стоит выше, пока не нажата: после нажатия (или скана) она скрывается до полуночи.' : '') + '</div>';
      html += '<div class="wg-sec">После срабатывания</div><select class="mdeditor-cleanup-input" id="wgAfter" aria-label="После срабатывания карточки">' +
        AFTERS.map(function(o){ return '<option value="' + o.k + '"' + (normAfter(c.after) === o.k ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') + '</select>' +
        '<div class="wg-hint">Что делать с карточкой в стопке, когда её действие сработало — по нажатию в виджете, в приложении или по скану кода. Скрытая карточка возвращается на следующий день; если скрыты все, виджет пишет «На сегодня больше ничего».</div>';
      html += '<div class="wg-sec">Приоритет</div><select class="mdeditor-cleanup-input" id="wgPrio" aria-label="Приоритет карточки">' +
        PRIOS.map(function(o){ return '<option value="' + o.k + '"' + (normPrio(c.prio) === o.k ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') + '</select>' +
        '<div class="wg-hint">Работает при включённом «Переключении по релевантности». «Наверх» прибавляет карточке 300 баллов к тем, что у неё есть по занятиям, будильнику, времени суток и дням: сама по себе она встанет выше обычных карточек, но не выше идущей тренировки, звонящего будильника и близкого события. «Вниз» — по сигналам карточка не поднимается и стоит ниже обычных. Перенос «в конец» и скрытие сильнее приоритета.</div>';
      html += '<div class="wg-btns"><button type="button" class="workbooks-run-btn" id="wgReplaceBtn">Заменить карточку</button>' +
        '<button type="button" class="workbooks-run-btn" id="wgRemoveBtn">Убрать из виджета</button></div>';
      html += fabRow(homeBtn("К виджету"));
      return html;
    }

    function pickFilter(){ var v = "all"; try{ v = localStorage.getItem(PICK_FILTER_KEY) || "all"; }catch(e){} return v; }
    function pickHtml(a){
      var filters = cardsOf().widgetFilters(), fk = pickFilter();
      if(!filters.some(function(f){ return f.key === fk; })) fk = "all";
      var used = {}; a.w.cards.forEach(function(c, i){ if(i !== a.replace) used[c.cid] = 1; });
      var list = cardsOf().widgetCards(fk);
      var html = '<h3 class="common-tab-title">Выберите карточку</h3><div class="wg-slots">';
      if(!list.length) html += '<div class="wg-empty">Нет подходящих карточек.</div>';
      list.forEach(function(f){
        html += '<div class="wg-slot" data-cid="' + esc(f.id) + '"' + (used[f.id] ? ' data-used="1"' : '') + '>' + faceHtml(f, used[f.id] ? "used" : "") + '</div>';
      });
      html += '</div>';
      html += '<div class="wg-menu" id="wgFilterMenu" style="display:none;">' + filters.map(function(f){
        return '<button type="button" class="workbooks-run-btn' + (f.key === fk ? ' selected' : '') + '" data-filter="' + f.key + '">' + esc(f.label) + '</button>';
      }).join('') + '</div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn' + (fk !== "all" ? ' pressed' : '') + '" id="wgFilterBtn" title="Показать карточки">' + FILTER_SVG + '</button>' + homeBtn("К виджету"));
      return html;
    }

    // ---------- отрисовка и события ----------
    function render(){
      var el = document.getElementById("settingsTabContent");
      if(!el) return;
      ensureStyles();
      var top = cur(), body = "";
      if(top.s === "list") body = listHtml();
      else if(top.s === "form") body = formHtml(top.a);
      else if(top.s === "card") body = cardHtml(top.a);
      else if(top.s === "pick") body = pickHtml(top.a);
      else if(top.s === "info") body = infoHtml();
      else if(top.s === "habits") body = habitsHtml(top.a);
      else if(top.s === "timers") body = timersHtml(top.a);
      el.innerHTML = '<div class="mdeditor-tab widgets-tab" id="widgetsTabRoot">' + body + '</div>';
      bind(top);
    }
    function $(id){ return document.getElementById(id); }
    function bind(top){
      var root = rootEl(); if(!root) return;
      var home = $("wgHomeBtn");
      if(home && !home.getAttribute("aria-disabled")) home.addEventListener("click", function(){ if(top.s === "form") homeUi(); else if(top.s === "list") exitToCards(); else backUi(); });
      if(top.s === "list"){
        $("wgAddBtn").addEventListener("click", function(){
          var w = { id: "w" + Date.now().toString(36), n: data.n + 1, cards: [], rotate: false, rotateMin: 5, relevance: true, books: false, bookList: [], notes: false, noteList: [] }; // у нового виджета «Переключение по релевантности» включено по умолчанию
          go("form", { w: w, draft: true });
        });
        Array.prototype.forEach.call(root.querySelectorAll(".wg-row"), function(r){
          r.addEventListener("click", function(){ var w = widgetById(r.getAttribute("data-id")); if(w) go("form", { w: w }); });
        });
      } else if(top.s === "form"){
        bindForm(top.a);
      } else if(top.s === "card"){
        bindCard(top.a);
      } else if(top.s === "pick"){
        bindPick(top.a);
      } else if(top.s === "habits"){
        bindHabits(top.a);
      } else if(top.s === "timers"){
        bindTimers(top.a);
      }
    }
    function commitDraft(a){
      if(a.draft && hasContent(a.w)){ a.draft = false; data.n = Math.max(data.n, a.w.n); data.list.push(a.w); }
    }
    function bindForm(a){
      var w = a.w;
      // имя виджета: правится прямо в форме; пусто — снова «Виджет N». Заголовок обновляется сразу, имя уходит оболочке (выбор виджета на рабочем столе) после ввода
      var nameEl = $("wgNameInput");
      if(nameEl){
        var titleEl = $("wgFormTitle");
        var applyName = function(){
          w.name = nameEl.value.replace(/^\s+|\s+$/g, "").slice(0, WNAME_MAX);
          if(titleEl) titleEl.textContent = wname(w);
        };
        nameEl.addEventListener("input", function(){ applyName(); save(); });
        nameEl.addEventListener("change", function(){ applyName(); if(!a.draft) changed(); else save(); });
        nameEl.addEventListener("keydown", function(ev){ if(ev.key === "Enter" || ev.keyCode === 13){ ev.preventDefault(); nameEl.blur(); } });
      }
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-slot"), function(s){
        s.addEventListener("click", function(){
          if(s.getAttribute("data-habits")){ go("habits", { w: w, form: a }); return; } // карточка привычек: время суток и дни каждой привычки
          if(s.getAttribute("data-timers")){ go("timers", { w: w, form: a }); return; } // карточка таймеров: время суток каждого таймера
          if(s.getAttribute("data-bat")) return; // карточку заряда не выбирают и не настраивают по времени — только цвет под галочкой
          if(s.getAttribute("data-add")) go("pick", { w: w, draft: a.draft, replace: -1, form: a });
          else go("card", { w: w, i: parseInt(s.getAttribute("data-i"), 10), form: a });
        });
      });
      var infoBtn = $("wgInfoBtn");
      if(infoBtn) infoBtn.addEventListener("click", function(){ go("info", {}); });
      var rot = $("wgRotate"), rel = $("wgRel");
      rot.addEventListener("change", function(){ w.rotate = rot.checked; if(w.rotate) w.relevance = false; commitDraft(a); changed(); render(); });
      rel.addEventListener("change", function(){ w.relevance = rel.checked; if(w.relevance) w.rotate = false; commitDraft(a); changed(); render(); });
      var bat = $("wgBat");
      bat.addEventListener("change", function(){
        w.battery = bat.checked;
        if(w.battery) w.batColor = cardsOf().defaultColor("battery"); // запомненный цвет (как у новых карточек QR-кодов), иначе сиреневый
        commitDraft(a); changed(); render();
      });
      var bat2 = $("wgBat2");
      bat2.addEventListener("change", function(){
        w.batteryMulti = bat2.checked;
        if(w.batteryMulti) w.bat2Color = cardsOf().defaultColor("battery2");
        commitDraft(a); changed(); render();
      });
      var tk = $("wgTasks");
      tk.addEventListener("change", function(){
        w.tasks = tk.checked;
        if(w.tasks) w.tasksColor = dynColorFor("task");
        commitDraft(a); changed(); render();
      });
      var ev = $("wgEvents");
      ev.addEventListener("change", function(){
        w.events = ev.checked;
        if(w.events) w.eventsColor = dynColorFor("event");
        else w.eventsSoon = false;
        commitDraft(a); changed(); render();
      });
      var evs = $("wgEventsSoon");
      if(evs) evs.addEventListener("change", function(){
        w.eventsSoon = evs.checked;
        commitDraft(a); changed(); render();
      });
      // число дней: нажатие на число открывает сетку 5×3, выбор числа включает галочку и сворачивает сетку (форма перерисовывается)
      var evBtn = $("wgEvDaysBtn"), evGrid = $("wgEvDaysGrid");
      if(evBtn && evGrid){
        evBtn.addEventListener("click", function(){
          var open = evGrid.style.display === "none";
          evGrid.style.display = open ? "" : "none";
          evBtn.className = "wg-daybtn" + (open ? " open" : "");
          evBtn.setAttribute("aria-expanded", open ? "true" : "false");
        });
        Array.prototype.forEach.call(evGrid.querySelectorAll(".wg-daycell"), function(cell){
          cell.addEventListener("click", function(){
            w.eventsDays = normDays(cell.getAttribute("data-n"), 1);
            w.eventsSoon = true;
            commitDraft(a); changed(); render();
          });
        });
      }
      var alm = $("wgAlarms");
      alm.addEventListener("change", function(){
        w.alarms = alm.checked;
        commitDraft(a); changed(); render();
      });
      var hab = $("wgHabits");
      hab.addEventListener("change", function(){
        w.habits = hab.checked;
        commitDraft(a); changed(); render();
      });
      var tmrCb = $("wgTimers");
      tmrCb.addEventListener("change", function(){
        w.timers = tmrCb.checked;
        commitDraft(a); changed(); render();
      });
      var bksCb = $("wgBooks");
      bksCb.addEventListener("change", function(){
        w.books = bksCb.checked;
        commitDraft(a); changed(); render();
        if(w.books && !w.bookList.length) say(TOAST_NO_BOOKS, 5600); // ни одной книги ещё не добавлено: подсказываем, где это делается
      });
      var ntsCb = $("wgNotes");
      ntsCb.addEventListener("change", function(){
        w.notes = ntsCb.checked;
        commitDraft(a); changed(); render();
        if(w.notes && !w.noteList.length) say(TOAST_NO_NOTES, 5600); // ни одной заметки ещё не добавлено: подсказываем, где это делается
      });
      var rpe = $("wgRpe");
      rpe.addEventListener("change", function(){
        w.rpeAsk = rpe.checked;
        if(w.rpeAsk) w.rpeColor = cardsOf().defaultColor("wgrpe") || RPE_COLOR; // запомненный цвет, иначе фиолетовый макета
        commitDraft(a); changed(); render();
      });
      var mood = $("wgMood");
      mood.addEventListener("change", function(){
        w.moodAsk = mood.checked;
        if(w.moodAsk) w.moodColor = cardsOf().defaultColor("wgmood") || RPE_COLOR;
        commitDraft(a); changed(); render();
      });
      var chg = $("wgCharge");
      chg.addEventListener("change", function(){
        w.chargeDone = chg.checked;
        if(w.chargeDone) w.chargeColor = cardsOf().defaultColor("wgcharge") || CHARGE_COLOR; // запомненный цвет, иначе зелёный
        commitDraft(a); changed(); render();
      });
      // палитры цвета карточек (свёрнуты; открываются квадратом справа от пункта, после выбора сворачиваются):
      // [id палитры, поле цвета, ключ запомненного цвета, id места карточки, лицо карточки, вид динамической карточки, сиреневый квадрат — явный цвет (служебные карточки)]
      [["icfColors", "batColor", "battery", "wgBatSlot", batFaceHtml], ["icfColors2", "bat2Color", "battery2", "wgBat2Slot", bat2FaceHtml],
       ["icfColors3", "tasksColor", "", "wgTasksSlot", tasksFaceHtml, "task"], ["icfColors4", "eventsColor", "", "wgEventsSlot", eventsFaceHtml, "event"],
       ["icfColors5", "rpeColor", "wgrpe", "wgRpeSlot", rpeFaceHtml, "", true], ["icfColors6", "moodColor", "wgmood", "wgMoodSlot", moodFaceHtml, "", true],
       ["icfColors7", "chargeColor", "wgcharge", "wgChargeSlot", chargeFaceHtml, "", true]].forEach(function(p){
        var colorsEl = $(p[0]), palEl = $("wgPal_" + p[0]), sw = $("wgSw_" + p[0]);
        if(!colorsEl) return;
        var lilac = cardsOf().paletteColor("");
        var curVal = function(){ var v = w[p[1]] || ""; return (p[6] && v === lilac) ? "" : v; }; // у служебных карточек пусто значит фиолетовый, поэтому сиреневый хранится явно
        var markColors = function(){
          var bs = colorsEl.querySelectorAll(".habit-color");
          for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].getAttribute("data-color") === curVal());
        };
        markColors();
        if(sw && palEl) sw.addEventListener("click", function(){
          var open = palEl.style.display === "none";
          palEl.style.display = open ? "" : "none";
          sw.classList.toggle("open", open);
        });
        colorsEl.addEventListener("click", function(e){
          var b = e.target.closest(".habit-color");
          if(!b) return;
          var c = b.getAttribute("data-color") || "";
          w[p[1]] = (p[6] && !c) ? lilac : c; // "" — по умолчанию (сиреневый)
          if(p[5]) rememberDynColor(p[5], w[p[1]]); else cardsOf().rememberColor(p[2], w[p[1]]);
          markColors();
          if(sw){ sw.style.background = p[6] ? w[p[1]] : cardsOf().paletteColor(w[p[1]]); sw.classList.remove("open"); }
          if(palEl) palEl.style.display = "none"; // после выбора палитра сворачивается
          var slot = $(p[3]); if(slot) slot.innerHTML = p[4](w);
          commitDraft(a); changed();
        });
      });
      var mn = $("wgRotMin");
      if(mn) mn.addEventListener("change", function(){ w.rotateMin = Math.max(1, Math.min(720, parseInt(mn.value, 10) || 5)); mn.value = w.rotateMin; commitDraft(a); changed(); });
      var pin = $("wgPinBtn");
      if(pin) pin.addEventListener("click", function(){
        var hint = $("wgPinHint");
        if(!hasContent(w)){ hint.textContent = "Сначала добавьте в виджет карточку или включите одну из галочек (заряд, задачи, события, будильники, привычки)."; return; }
        commitDraft(a); save();
        hint.textContent = "Готовлю…";
        syncNow().then(function(ok){
          if(!ok){ hint.textContent = "Не удалось передать виджет оболочке."; return; }
          var res = "failed";
          try{ res = String(bridge().widgetPin(w.id)); }catch(e){}
          hint.textContent = res === "requested" ? "Подтвердите добавление на рабочем столе."
            : "Рабочий стол не принял запрос. Добавьте виджет «Стопка QR-карточек» через меню виджетов (долгое нажатие на пустом месте рабочего стола) и выберите «" + wname(w) + "».";
        });
      });
      var del = $("wgDelBtn"), armedDel = false;
      del.addEventListener("click", function(){
        if(!armedDel){ armedDel = true; del.textContent = "Нажмите ещё раз — удалить"; setTimeout(function(){ armedDel = false; if(del.parentNode) del.textContent = "Удалить виджет"; }, 3500); return; }
        data.list = data.list.filter(function(x){ return x.id !== w.id; });
        a.draft = false; changed(); homeUi();
      });
    }
    // чип времени суток: «Целый день» (a) исключает утро/обед/вечер и наоборот; подсветку чипов контейнера пересчитываем по массиву
    function toggleTime(arr, k, box){
      var i = arr.indexOf(k);
      if(i >= 0) arr.splice(i, 1);
      else {
        if(k === "a") arr.length = 0;
        else { var j = arr.indexOf("a"); if(j >= 0) arr.splice(j, 1); }
        arr.push(k); arr.sort();
      }
      Array.prototype.forEach.call(box.children, function(ch){
        if(arr.indexOf(ch.getAttribute("data-k")) >= 0) ch.classList.add("on"); else ch.classList.remove("on");
      });
    }
    function bindCard(a){
      var c = a.w.cards[a.i]; if(!c) return;
      function toggle(arr, v){ var i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); arr.sort(); }
      Array.prototype.forEach.call($("wgTimes").children, function(ch){
        ch.addEventListener("click", function(){ toggleTime(c.times, ch.getAttribute("data-k"), $("wgTimes")); changed(); });
      });
      Array.prototype.forEach.call($("wgDays").children, function(ch){
        ch.addEventListener("click", function(){ toggle(c.days, parseInt(ch.getAttribute("data-d"), 10)); ch.classList.toggle("on"); changed(); });
      });
      var aft = $("wgAfter");
      if(aft) aft.addEventListener("change", function(){ c.after = normAfter(aft.value); changed(); });
      var prio = $("wgPrio");
      if(prio) prio.addEventListener("change", function(){ c.prio = normPrio(prio.value); changed(); });
      $("wgReplaceBtn").addEventListener("click", function(){ go("pick", { w: a.w, draft: false, replace: a.i, form: a }); });
      $("wgRemoveBtn").addEventListener("click", function(){ a.w.cards.splice(a.i, 1); changed(); backUi(); });
    }
    function bindHabits(a){
      var w = a.w;
      function toggle(arr, v){ var i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); arr.sort(); }
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-habit"), function(blk){
        var cid = blk.getAttribute("data-cid");
        Array.prototype.forEach.call(blk.querySelectorAll(".wg-habit-times .wg-chip"), function(ch){
          ch.addEventListener("click", function(){ var hc = habitCfgOf(w, cid); toggleTime(hc.times, ch.getAttribute("data-k"), blk.querySelector(".wg-habit-times")); trimHabitCfg(w, cid); changed(); });
        });
        Array.prototype.forEach.call(blk.querySelectorAll(".wg-habit-days .wg-chip"), function(ch){
          ch.addEventListener("click", function(){ var hc = habitCfgOf(w, cid); toggle(hc.days, parseInt(ch.getAttribute("data-d"), 10)); ch.classList.toggle("on"); trimHabitCfg(w, cid); changed(); });
        });
      });
    }
    function bindTimers(a){
      var w = a.w;
      function toggle(arr, v){ var i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); arr.sort(); }
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-habit"), function(blk){
        var cid = blk.getAttribute("data-cid");
        Array.prototype.forEach.call(blk.querySelectorAll(".wg-timer-times .wg-chip"), function(ch){
          ch.addEventListener("click", function(){ var tc = timerCfgOf(w, cid); toggle(tc.times, ch.getAttribute("data-k")); ch.classList.toggle("on"); trimTimerCfg(w, cid); changed(); });
        });
      });
    }
    function bindPick(a){
      var menu = $("wgFilterMenu");
      $("wgFilterBtn").addEventListener("click", function(e){ e.stopPropagation(); menu.style.display = menu.style.display === "none" ? "block" : "none"; });
      Array.prototype.forEach.call(menu.querySelectorAll("button"), function(b){
        b.addEventListener("click", function(){
          try{ var k = b.getAttribute("data-filter"); if(k === "all") localStorage.removeItem(PICK_FILTER_KEY); else localStorage.setItem(PICK_FILTER_KEY, k); }catch(e){}
          render();
        });
      });
      rootEl().addEventListener("click", function(e){ if(menu.style.display !== "none" && !menu.contains(e.target)) menu.style.display = "none"; }, true);
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-slot[data-cid]"), function(s){
        s.addEventListener("click", function(){
          if(s.getAttribute("data-used")) return;
          var cid = s.getAttribute("data-cid"), w = a.w;
          if(a.replace >= 0 && w.cards[a.replace]) w.cards[a.replace].cid = cid;
          else if(w.cards.length < MAX_CARDS) w.cards.push({ cid: cid, times: [], days: [], after: "none", prio: "normal" });
          var form = a.form && a.form.draft !== undefined ? a.form : null;
          if(a.draft && form) commitDraft(form);
          changed();
          backUi();
        });
      });
    }

    function exitToCards(){
      var cb = exitCb;
      if(!cb) return;
      var t = exitArmed; exitCb = null; exitArmed = null;
      if(t && t.active){ t.active = false; try{ history.back(); }catch(e){} }
      cb();
    }
    function renderTab(opts){
      if(armed){ armed.active = false; armed = null; }
      if(exitArmed){ exitArmed.active = false; exitArmed = null; }
      exitCb = (opts && typeof opts.onExit === "function") ? opts.onExit : null;
      if(exitCb && window.AppNav){ // кнопка «назад» телефона на списке виджетов — к карточкам
        var et = { active: true }; exitArmed = et;
        window.AppNav.push(function(){
          if(!et.active) return;
          et.active = false; if(exitArmed === et) exitArmed = null;
          var cb = exitCb; exitCb = null;
          if(rootEl() && cb) cb();
        });
      }
      stack = [{ s: "list" }];
      data = load();
      migrateAlarmCards();
      migrateHabitCards();
      render();
    }

    // Диагностика (только чтение): кнопка «▶ Виджеты: журнал оболочки» в панели отладки (галочка «Включить режим отладки») — журнал QrDiag оболочки + что страница знает о виджетах
    function diagReport(){
      var b = window.LifeTrackerNative, lines = [];
      lines.push("Виджетов в конструкторе: " + data.list.length);
      data.list.forEach(function(w){ lines.push("  " + w.id + " (№" + w.n + "): карточек " + w.cards.length + ", книги " + (w.books ? "вкл" : "выкл") + "/" + w.bookList.length + ", заметки " + (w.notes ? "вкл" : "выкл") + "/" + w.noteList.map(function(x){ return x.h; }).join(",") + ", релевантность " + (w.relevance ? "вкл" : "выкл")); });
      var log = "";
      try{ log = (b && typeof b.widgetDiagLog === "function") ? String(b.widgetDiagLog() || "") : "(в этой сборке оболочки нет widgetDiagLog — нужна пересборка APK)"; }catch(e){ log = "(ошибка чтения журнала: " + e + ")"; }
      var text = lines.join("\n") + "\n--- журнал оболочки ---\n" + (log || "(пусто)");
      return Promise.resolve({ text: text, headline: lines[0] + "; журнал оболочки " + (log ? log.split("\n").length + " строк" : "пуст") });
    }
    try{ if(window.Debug && typeof window.Debug.registerAction === "function") window.Debug.registerAction("Виджеты: журнал оболочки", diagReport); }catch(e){}

    return { render: renderTab, scheduleSync: scheduleSync, syncNow: syncNow, feedChanged: feedChanged, widgetsForBook: widgetsForBook, toggleBook: toggleBook, dropNote: dropNote, dropNoteEverywhere: dropNoteEverywhere, toast: say, noWidgetsText: TOAST_NO_WIDGETS, timeWindows: function(){ return WINDOWS.concat([WINDOW_ALL]); }, hasWidgets: function(){ return data.list.length > 0 || !!data.ever; } };
  };
})();
