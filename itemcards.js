/* ===========================================================================
   itemcards.js
   Версия: 22.0 (24.10) — структурная правка: новый тип карточки «Напоминание» (`remind`, без QR-кода): название, комментарий (`comment`), цвет, дата и время (`remindAt`), повтор `repeatKind` (час / 8 часов / день / неделя / месяц / год; `REPEAT_KINDS`, `addKind`, `kthIdx`, `lastOcc`, `nextOccurrence`); пункт «Напоминание» в «+» и в воронке; уходит в планировщик через `getRemindableCards` (с `repeatKind` — его повторяет и оболочка); в PDF не попадает, оборота с QR нет; форма — `openForm("remind")`.
   Версия: 21.0 (24.10) — структурная правка: запись в журнал событий (`eventlog.js`, `evLog`): сканирования QR (карточки, привычки, «Сегодня», «Напоминалка», заметки, задачи, чужие коды), установка/остановка таймера.
   Версия: 20.0 (24.10) — структурная правка: QR привычки несёт название (`lt://v1/habit/<id>/<название до 40 знаков>`, `qrTextFor`; цвета в коде нет — его каждый выбирает себе сам): скан на устройстве без такой карточки создаёт её по коду (`habitFromCode`: тот же id, название из кода, пустые `days`, без цвета) и отмечает сегодняшний день; сначала карточка ищется у себя и в облаке (если синхронизация настроена). Название привычки в форме — до 40 знаков (иначе не поместится в код). Прежние коды `lt://v1/card/<id>` привычек работают как раньше, но только там, где карточка есть. Откат: itemcards.js 19.0.
   Версия: 19.0 (24.10) — структурная правка: цвет карточки у ВСЕХ типов (таймер, предмет, «Создавать задачу», привычка, «Сегодня», «Напоминалка»): необязательное поле `color` ("#rrggbb"; пусто — без цвета, карточка как раньше), ходит через облако (`cloudShape`) и красит карточку в сетке (`applyCardLook`, вместо `applyHabitLook`). Палитра формы — общая (`colorPaletteHtml`): первый пастельный квадрат стал ПУСТЫМ цветом (был пастельный красный). Цвет по умолчанию — пустой; выбранный цвет запоминается по типу карточки (`itemCardsColorDefaults_v1`, `defaultColorFor`/`rememberColorFor`, только на этом устройстве) и подставляется в новые карточки этого типа. «Сегодня» и «Напоминалка»: создаются и правятся маленькой формой с одним цветом (`createSingletonCard` убран; у них при удержании появилась кнопка «Изменить»). У привычки без цвета отметки на карте и точка в заголовке берут цвет темы (`var(--wood)`), `HABIT_DEFAULT_COLOR` убран. Показ карточки по скану ВСЕГДА цвета холста (`.scan-card`), цвет карточки там не применяется. Откат: itemcards.js 18.1.
   Версия: 18.1 (24.10) — цвета привычек: красный #ff0000, жёлтый #ffff00, фиолетовый #7f00ff в верхнем ряду; зелёный #9cdb4e и бирюзовый #40d5b5 вместо пастельных в нижнем. Прежняя 18.0 (23.10) — структурная правка: новый тип карточки «Привычка» (`habit`, поля `color`, `days`): пункт «Привычка» в меню «+» и в выборе типа при создании под напечатанный код; форма — название и цвет квадратиками (8 ярких + 8 пастельных, `HABIT_COLORS_*`); пункт «Привычки» в меню воронки; при удержании три кнопки в одном стиле — глаз, удаление, правка (`.item-card-edit-btn`); тап — карта дней (`openHabitMap`, `habitMapMarkup`: вид и классы «Карты дней года», отмеченные дни — цветом привычки), двойной тап — оборот с QR как обычно; скан кода карточки отмечает сегодняшний день (`markHabitToday`: один день — одна отметка, повторный скан в тот же день ничего не делает) и показывает карточку с подписью «Сегодня отмечено» / «Сегодня уже отмечено»; `days` ходят через облако и объединяются при сверке (`mergeHabitDays` в `reconcileCloud`); стили формы — из JS (`ensureHabitStyles`). Откат: itemcards.js 17.1. Скан кода привычки сканер принимает после удержания не меньше 0,5 с (`longHold` в `openScan`, cardscan.js 2.2).
   Версия: 17.1 (22.10) — в PDF у «Создавать задачу» печатается только текст задачи, без названия категории (категория остаётся в QR-коде и на карточке в приложении). Откат: itemcards.js 17.0.
   Версия: 17.0 (22.10) — структурная правка: при долгом нажатии у карточки две кнопки — глаз и удаление (кнопки «Изменить» нет: карточка открывается на правку тапом); глаз получил класс `mdeditor-share-btn` (общая скрытость до `.visible`, как у кнопки удаления) и стоит левее удаления. Откат: itemcards.js 16.1.
   Версия: 16.1 (22.10) — кнопка `#itemCardsHiddenBtn` больше не заливается цветом: состояние показывает только значок (глаз / перечёркнутый глаз). Откат: itemcards.js 16.0.
   Версия: 16.0 (22.10) — структурная правка: признак карточки `hidden` («скрыть», общий для всех типов, ходит через облако в `cloudShape`): третья кнопка-глаз `.item-card-eye-btn` при долгом нажатии (глаз — показана, перечёркнутый глаз — скрыта); кнопка `#itemCardsHiddenBtn` в нижнем ряду (глаз — показаны все, перечёркнутый — скрытые не показываются; выбор в `itemCardsShowHidden_v1`, `getShowHidden`/`setShowHidden`); скрытая карточка при показе всех бледнее (`.item-card-hidden`); скрытые не попадают в PDF (`exportPdf`); по QR скрытые карточки работают как обычно. Откат: itemcards.js 15.0.
   Версия: 15.0 (22.10) — структурная правка: фильтр карточек по типу — кнопка-воронка `#itemCardsFilterBtn` слева от «+» с выпадающим списком «Все / Таймеры / Предметы / Задачи / Особые» (`FILTERS`, `getFilter`/`setFilter`/`cardMatchesFilter`, выбор помнится в `itemCardsFilter_v1`); «Особые» — «Сегодня» и «Напоминалка». При фильтре кнопка залита (`.pressed`); создание карточки скрытого типа сбрасывает фильтр на «Все». PDF по-прежнему печатает все карточки. Откат: itemcards.js 14.0.
   Версия: 14.0 (22.10) — структурная правка: список категорий в форме «Создавать задачу» берётся из карточек, а не из задач (`cardTaskTags`: категории карточек типа task, без повторов, по алфавиту); последняя карточка с категорией удалена — категория из списка пропадает. `deps.getTaskTags` больше не используется. Откат: itemcards.js 13.0.
   Версия: 13.0 (22.10) — структурная правка: у «Создавать задачу» необязательный тег-категория (`tag`, до 16 знаков, `taskTag`): в QR `lt://v1/task/<вкладка>#<тег>/<текст>`, в форме выпадающий список категорий, уже стоящих на задачах (`deps.getTaskTags`), пункт «Новая категория…» и «Без категории»; тег уходит в `deps.addTaskFromQr(tab, text, tag)`, на карточке показывается «#тег», в PDF — перед текстом; карточки без тега и коды без `#` работают как раньше. Откат: itemcards.js 12.0.
   Версия: 12.0 (22.10) — структурная правка: тип карточки «Создавать задачу» (`type:"task"`: `title` — текст задачи до 80 знаков, `icon` — ключ вкладки задач). QR `lt://v1/task/<ключ вкладки>/<текст>` несёт задачу в самом коде (`qrTextFor`, `taskText`); форма с выбором вкладки по пиктограммам (`openForm`, `deps.getTaskTabs`); скан → `handleScannedTask`/`applyScannedTask` (`deps.addTaskFromQr`: добавляет задачу либо, если такая же невыполненная уже есть, переносит её в конец вкладки) → слой `showTaskResultOverlay` (текст, пиктограмма и название вкладки); из окна ярлыка задача кладётся в очередь `pendingScanTasks_v1` и приложение открывается входом `newtask` (`drainPendingTasks`, без правок Kotlin). Откат: itemcards.js 11.0.
   Версия: 11.0 (21.10) — структурная правка: на карточке-таймере две равные кнопки — «Стоп» слева и «Пуск» справа (`.item-card-timer-btns`); `stopTimerForCard` отменяет таймер (в оболочке `cancelCardTimer`, в окне ярлыка `deps.timers.cancel`, в браузере — запасной localStorage); цифры возвращаются к заданному времени. Откат: itemcards.js 10.2.
   Версия: 10.3 (22.10) — QR «Сегодня» и «Напоминалки» одинаковые у всех (`lt://v1/today`, `lt://v1/reminder`): `qrTextFor` для этих типов возвращает общий код, `handleScanned` разбирает `today`/`reminder` без поиска карточки (напоминание — из «Комментариев» сканирующего, «Сегодня» — новая заметка сканирующего; из окна ярлыка — вход в приложение с id `today`, режим `note`). Прежние коды по id карточки работают как раньше. Откат: itemcards.js 10.2.
   Версия: 10.2 (21.10) — `qrTextFor`: обрезка названия таймера не оставляет половину эмодзи (иначе библиотека QR падала и код не рисовался). Откат: itemcards.js 10.1.
   Версия: 10.1 (21.10) — QR таймера несёт время и название в самом коде (`lt://v1/timer/<секунды>[/<название до 40 знаков>]`): `qrTextFor`, `timerFromCode`/`timerCodeId`/`virtualCards`; скан такого кода запускает таймер на любом устройстве без карточки; `buildQr` и PDF берут текст через `qrTextFor`. Откат: itemcards.js 10.0.
   Версия: 10.0 (21.10) — структурная правка: тип карточки `reminder` («Напоминалка», одна на приложение, как «Сегодня»): `createSingletonCard` (вместо `createDateNoteCard`), `isSingletonCard`/`cardTitle`, `reminderPool`/`pickReminder` (бочонки в `reminderBag_v1`)/`showReminderOverlay`, уведомление `noreminders`; «Заметка с датой» переименована в «Сегодня» (название всегда берётся из кода, у старых карточек в записях может лежать прежнее). Откат: itemcards.js 9.0.
   Версия: 9.0 (21.10) — структурная правка: тип карточки «заметка» и её скрытая заметка УБРАНЫ (`openNoteCard`/`backToGrid`/`openNoteFromScan`/`openNoteWhenReady`, `data-type="note"`, кнопка «Поля карточки»); прежние карточки-заметки при загрузке отбрасываются (их заметки mdeditor.js 14.0 переносит в папку `cards-notes`), записи таких карточек в облаке удаляются. Вместо этого сканер понимает QR заметки `lt://v1/note/<id>` (кнопка QR в редакторе заметок): `handleScanned` → `openNoteByQrWhenReady`, из окна ярлыка — `openInApp(id,"note")` и `openCardFromNative`. Откат: itemcards.js 8.0.
   Версия: 8.0 (20.10) — структурная правка: тип карточки `datenote` («Заметка с датой»): пункт «Создать новую заметку с датой» в меню «+» (пока такая карточка есть, пункта нет), только QR на обороте; скан (и из окна ярлыка через `openInApp(id,"note")`) сразу создаёт ОБЫЧНУЮ заметку блокнота с сегодняшней датой в имени в папке `notes` в корне — `createDatedNote` (mdeditor.js), `showScanned`/`openDatedNoteFromScan`/`createDatedNoteWhenReady`, деп `openNotesTab`. Откат: itemcards.js 7.1.
   Версия: 7.1 (20.10) — окно ярлыка: сканеру передаётся `windowed: standalone` (видоискатель в центральной рамке, вокруг прозрачно).
   Версия: 7.0 (19.10) — структурная правка: размер и способ раскладки карточек — как у сетки обложек в книгах (`.books-cover-grid`: колонки repeat(auto-fill, minmax(110px, 1fr)), зазор 2px): база 110px × ползунок, карточки растягиваются на всю ширину, число колонок и точную ширину считает `applySize` (`--item-card-cols`, `--item-card-w`), пропорция 3:4 и ползунок (0,7–2) без изменений. Откат: itemcards.js 6.1.
   Версия: 6.1 (18.10) — пропорция карточки 3:4 вместо 2:3 (показ по скану: ширина с учётом высоты ×4/3). Откат: itemcards.js 6.0.
   Версия: 6.0 (17.10) — структурная правка: напоминания карточек (шаг 6а ТЗ): кнопка-часы в правом нижнем углу карточки-предмета и заметки (у таймера нет), окно даты/времени и повтор (1…180 дней) из notifications.js, поля remindAt/repeatDays (синхронизируются) и remindDone (только на устройстве), `getRemindableCards` для планировщика (my.js getRemindableTasks), `focusCard` — переход к карточке из уведомления с жирной обводкой до первого взаимодействия. Откат: itemcards.js 5.0.
   Версия: 5.0 (17.10) — структурная правка: кнопка «PDF» в нижнем ряду (после сканера; на Android 5 её нет) и меню «4 / 12 / 24 на лист» — `openPdfMenu`/`exportPdf`, сборка листов в cardpdf.js, сохранение в «Загрузки» через <a download>. Откат: itemcards.js 4.0.
   Версия: 4.0 (17.10) — структурная правка: таймеры карточек (шаг 5а ТЗ): кнопка «Пуск» (внизу по центру) на карточке-таймере, оставшееся время в сетке и на показе по скану, запуск таймера по скану (`startTimerForCard`, `getTimerApi`: оболочка — CardTimers через мост, scan.html — `deps.timers`, браузер — запасной таймер в localStorage `itemCardTimers_v1`). Откат: itemcards.js 3.0.
   Версия: 3.0 (17.10) — структурная правка: синхронизация записей карточек (вариант А ТЗ, 12.4): зеркало каждой карточки в скрытой записи заметок через mdeditor.js (`cardMetaSave/Remove/All/Pull/Status`), сверка `reconcileCloud` (last-write-wins по updatedAt; «уже синхронизирована» и «удалить в облаке» хранятся в `itemCardsSync_v1`), запуск при входе во вкладку, после каждого сохранения (debounce) и по приходу правок с другого устройства. Откат: itemcards.js 2.0.
   Версия: 2.0 (16.10) — структурная правка: сканирование (шаги 3 и 5 ТЗ): кнопка сканера, слой «карточка при сканировании», кнопка «сегодняшняя дата», «карточка не найдена» → создание с тем же id, чужие коды; режим standalone для scan.html (ScanActivity); `openCardFromNative`.
   Вкладка «Карточки предметов» (девятая боковая вкладка второго набора,
   settingsTabSet2Btn9 / "set2s_9"), ТЗ TASK_ITEM_CARDS_QR.md.

   Что здесь сделано (шаги 1, 2, 4, 5б, 7 плана ТЗ):
   - сетка карточек 3:4 (было 2:3), число колонок считается от ширины карточки;
   - типы: «таймер», «предмет», «Сегодня» (бывшая «заметка с датой») и «Напоминалка»; формы создания/правки (таймер, предмет);
   - у каждой карточки личный id (8 знаков) и QR `lt://v1/card/<id>` на обороте
     (двойной тап; QR строится лениво, библиотека vendor/qrcode.min.js);
   - долгий тап раскрывает кнопки «правка»/«удаление» (те же классы, что у обложек книг);
   - ползунок размера (0,7–2), нижний ряд кнопок;
   - QR заметок «Моего блокнота» (`lt://v1/note/<id>`) строит кнопка в редакторе заметок (mdeditor.js);
     здесь сканер открывает такую заметку (`openNoteByQrWhenReady`).

   Сканирование: камера и разбор кода — cardscan.js (CardScan); показ результата — здесь
   (openScan → handleScanned → showCardOverlay / showNoticeOverlay). Тот же код работает на
   странице scan.html (deps.standalone + deps.native, мост ScanBridge из ScanActivity.kt).

   Чего здесь ещё нет (следующие шаги ТЗ): таймер по скану (Пуск), PDF, напоминания, облачная синхронизация записей карточек (записи карточек синхронизируются зеркалом в заметках, см. ниже).

   Хранилище записей — только функции loadCards/saveCards (localStorage), чтобы потом
   подменить их на sync-engine, не трогая остальной код.
   =========================================================================== */

window.initItemCardsModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml;
  var READER_HOME_ICON_SVG = deps.READER_HOME_ICON_SVG;
  var PENCIL_ICON_SVG = deps.PENCIL_ICON_SVG;
  var DELETE_ICON_SVG = deps.DELETE_ICON_SVG;
  var openAppConfirmBar = deps.openAppConfirmBar;
  var getMdEditor = deps.getMdEditor || function(){ return null; };
  var standalone = !!deps.standalone;   // true на странице scan.html (окно ScanActivity, без приложения)
  var nativeScan = deps.native || null; // мост оболочки: openInApp(id, mode), openUrl(url), close()

  var CARDS_KEY = "itemCards_v1";
  var SIZE_KEY = "itemCardsSize_v1";
  var QR_PREFIX = "lt://v1/card/";
  var TIMER_PREFIX = "lt://v1/timer/";
  var HABIT_PREFIX = "lt://v1/habit/";
  var TASK_PREFIX = "lt://v1/task/";
  var TASK_TEXT_MAX = 80; // текст задачи в коде: длиннее — код плотнее и хуже читается на малой наклейке (на карточке и в PDF показывается только начало)
  var PENDING_TASKS_KEY = "pendingScanTasks_v1"; // очередь «окно ярлыка → приложение» (тот же localStorage)
  var TASK_NATIVE_ID = "newtask"; // служебный id входа из оболочки для задач (проходит проверку оболочки: 4–32 букв и цифр)
  var TODAY_CODE = "lt://v1/today";
  var REMINDER_CODE = "lt://v1/reminder";
  var TODAY_NATIVE_ID = "today"; // служебный id для входа из оболочки (не совпадает с id карточек: в них нет буквы «o»)
  var HABIT_TITLE_MAX = 40; // название привычки: в форме и в коде
  var TIMER_QR_TITLE_MAX = 40; // название в коде таймера: длиннее — код плотнее и хуже читается на малой наклейке
  // Текст QR карточки. Таймер несёт время и название в самом коде (lt://v1/timer/<секунды>/<название>): любое устройство
  // с приложением запускает такой таймер по скану, карточка там не нужна (код можно напечатать и карточку удалить).
  // Остальные карточки — как раньше, по id (lt://v1/card/<id>). Ранее напечатанные коды таймеров по id работают, пока карточка есть.
  // текст задачи: пробелы схлопнуты, длина не больше max, парный знак (эмодзи) не режется пополам
  function taskText(s, max){
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, max || TASK_TEXT_MAX);
    if(/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
    return t.replace(/ $/, "");
  }
  // тег-категория задачи: пробелы и «/» схлопнуты в один пробел, до 16 знаков (в коде «/» закончил бы тег)
  var TASK_TAG_MAX = 16;
  function taskTag(s){
    var t = String(s == null ? "" : s).replace(/[\s\/]+/g, " ").replace(/^ | $/g, "").slice(0, TASK_TAG_MAX);
    if(/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
    return t.replace(/ $/, "");
  }
  // категории карточек «Создавать задачу»: без повторов (без учёта регистра), по алфавиту; пропадают вместе с последней карточкой
  function cardTaskTags(){
    var seen = {}, out = [];
    loadCards().forEach(function(c){
      if(!c || c.type !== "task") return;
      var t = taskTag(c.tag);
      if(!t) return;
      var k = t.toLowerCase();
      if(seen[k]) return;
      seen[k] = 1; out.push(t);
    });
    out.sort(function(a, b){ return a.localeCompare(b, "ru"); });
    return out;
  }
  function qrTextFor(c){
    if(c && c.type === "task" && c.icon && taskText(c.title)){ // задача в самом коде (тег — необязательно, после ключа вкладки через «#»)
      var tg = taskTag(c.tag);
      return TASK_PREFIX + c.icon + (tg ? "#" + tg : "") + "/" + taskText(c.title);
    }
    if(c && c.type === "timer" && c.seconds > 0){
      var t = String(c.title || "").replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, TIMER_QR_TITLE_MAX);
      if(/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1); // обрезка не должна оставлять половину эмодзи (парный знак)
      return TIMER_PREFIX + (c.seconds | 0) + (t ? "/" + t : "");
    }
    if(c && c.type === "habit" && c.id){ // привычка: id и название в самом коде (цвет не передаётся — у каждого свой)
      var ht = String(c.title || "").replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, HABIT_TITLE_MAX);
      if(/[\uD800-\uDBFF]$/.test(ht)) ht = ht.slice(0, -1);
      if(ht) return HABIT_PREFIX + c.id + "/" + ht;
    }
    // «Сегодня» и «Напоминалка»: код один на всех, не зависит от карточки и аккаунта — что откроется, решает тот, кто сканирует
    if(c && c.type === "datenote") return TODAY_CODE;
    if(c && c.type === "reminder") return REMINDER_CODE;
    return QR_PREFIX + (c ? c.id : "");
  }
  // таймер из отсканированного кода: «виртуальная» карточка (в список не попадает); id считается от времени и названия,
  // поэтому повторный скан того же кода перезапускает тот же таймер, а разные коды не мешают друг другу
  var virtualCards = {};
  function timerCodeId(seconds, title){
    var str = seconds + "|" + title, h1 = 5381, h2 = 52711;
    for(var i = 0; i < str.length; i++){
      var ch = str.charCodeAt(i);
      h1 = ((h1 * 33) ^ ch) >>> 0;
      h2 = ((h2 * 31) + ch) >>> 0;
    }
    return "q" + h1.toString(36) + h2.toString(36);
  }
  function timerFromCode(p){
    var title = String(p.title || "").slice(0, 80);
    var vc = { id: timerCodeId(p.seconds, title), type: "timer", title: title, icon: "", date: "", seconds: p.seconds, virtual: true };
    virtualCards[vc.id] = vc;
    return vc;
  }
  var SIZE_MIN = 0.7, SIZE_MAX = 2;
  var ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // без похожих знаков (i, l, o, 0, 1)

  // ---------- пиктограммы: имя -> содержимое <svg> (стиль закладок: 24x24, линия 1,7) ----------
  var ICONS = {
    bottle: '<path d="M10 2.5h4v3l1.5 2.5v12.2a1.3 1.3 0 0 1-1.3 1.3H9.8a1.3 1.3 0 0 1-1.3-1.3V8L10 5.5z"></path><path d="M8.5 12h7"></path><path d="M8.5 16h7"></path>',
    container: '<rect x="3" y="8" width="18" height="11" rx="2"></rect><path d="M5 8V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V8"></path><path d="M8 13.5h8"></path>',
    jar: '<path d="M8 3h8v2.5H8z"></path><path d="M7 5.5h10v2c1.2.8 2 2 2 3.5v7a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-7c0-1.5.8-2.7 2-3.5z"></path><path d="M9 13h6"></path>',
    bicycle: '<circle cx="6" cy="16" r="3.5"></circle><circle cx="18" cy="16" r="3.5"></circle><path d="M6 16l4-7h5l3 7"></path><path d="M10 9l2.5 7"></path><path d="M9 6.5h2.5"></path><path d="M15 9l-1-2.5h2"></path>',
    car: '<path d="M4 12l2-4.5a2 2 0 0 1 1.8-1.2h8.4a2 2 0 0 1 1.8 1.2L20 12"></path><path d="M3.5 12h17v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"></path><path d="M6.5 15h.01M17.5 15h.01"></path><path d="M6 18v2M18 18v2"></path>',
    vegetable: '<path d="M12 7.5c-4.5 0-7.5 2.6-7.5 6.2 0 3.6 3 6.3 7.5 6.3s7.5-2.7 7.5-6.3c0-3.6-3-6.2-7.5-6.2z"></path><path d="M12 7.5V4"></path><path d="M12 7.5c-2-.5-3.5-1.5-4-3 2 0 3.5.5 4 1.5M12 7.5c2-.5 3.5-1.5 4-3-2 0-3.5.5-4 1.5"></path>',
    paper: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4"></path><path d="M9 12h6M9 15.5h6"></path>',
    reminder: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"></path><path d="M10 20.5a2 2 0 0 0 4 0"></path>',
    datepaper: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4"></path><rect x="8.5" y="11.5" width="7" height="6" rx="1"></rect><path d="M8.5 14h7"></path><path d="M10.5 10.2v2.2M13.5 10.2v2.2"></path>'
  };
  var ICON_ORDER = ["bottle", "container", "jar", "bicycle", "car", "vegetable", "paper"];
  var DEFAULT_ICON = { item: "", timer: "", task: "", datenote: "datepaper", reminder: "reminder" };
  ICONS.habit = '<rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16M8 3v4M16 3v4"></path><path d="M9 15l2 2 4-4"></path>';
  var DATENOTE_TITLE = "Сегодня";
  var REMINDER_TITLE = "Напоминалка";
  // «Сегодня» (бывшая «Заметка с датой») и «Напоминалка» — по одной на приложение, без формы: название всегда своё
  // (в записях и в облаке у старых карточек «Сегодня» может лежать прежнее название — оно не показывается)
  // ---------- привычка ----------
  // Карточка-привычка: {type:"habit", title, color:"#rrggbb", days:["2026-10-23", …]}. Её QR — обычный код карточки
  // (lt://v1/card/<id>); скан отмечает сегодняшний день (в один день засчитывается один раз), тап открывает карту дней.
  // Палитра цвета карточки (у ВСЕХ типов карточек): 8 ярких и 8 пастельных; первый пастельный квадрат — ПУСТОЙ цвет (""): карточка
  // без заливки, как раньше. Пустой цвет — по умолчанию; у привычки отметки на карте тогда берут цвет темы (var(--wood)).
  var HABIT_COLORS_BRIGHT = ["#ff0000", "#fb8c00", "#ffff00", "#43a047", "#00acc1", "#1e88e5", "#7f00ff", "#d81b60"];
  var HABIT_COLORS_PASTEL = ["", "#ffcba4", "#fff3a3", "#9cdb4e", "#40d5b5", "#a9ccf4", "#d4b8f0", "#f8bbd9"];
  var HABIT_MAX_DAYS = 1830; // пять лет отметок; больше в записи (и в облаке) не держим
  function isCardColor(v){ return /^#[0-9a-fA-F]{6}$/.test(String(v || "")); }
  function cardColor(c){ return c && isCardColor(c.color) ? String(c.color).toLowerCase() : ""; } // "" — без цвета
  // Запомненный цвет по умолчанию для новых карточек каждого типа (только на этом устройстве): выбрал цвет для таймера — все новые
  // таймеры создаются с ним, пока не выберет другой (в том числе пустой). Запоминается, когда цвет выбран в форме и форма сохранена.
  var COLOR_DEFAULTS_KEY = "itemCardsColorDefaults_v1";
  function loadColorDefaults(){
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(COLOR_DEFAULTS_KEY) || "null"); }catch(e){ o = null; }
    return (o && typeof o === "object") ? o : {};
  }
  function defaultColorFor(type){ var v = loadColorDefaults()[type]; return isCardColor(v) ? String(v).toLowerCase() : ""; }
  function rememberColorFor(type, color){
    var o = loadColorDefaults();
    o[type] = isCardColor(color) ? String(color).toLowerCase() : "";
    try{ localStorage.setItem(COLOR_DEFAULTS_KEY, JSON.stringify(o)); }catch(e){}
  }
  function normHabitDays(arr){
    var seen = {}, out = [];
    if(Array.isArray(arr)){
      arr.forEach(function(d){
        if(typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !seen[d]){ seen[d] = 1; out.push(d); }
      });
    }
    out.sort();
    return out.length > HABIT_MAX_DAYS ? out.slice(-HABIT_MAX_DAYS) : out;
  }
  function habitDays(c){ return normHabitDays(c && c.days); }
  function mergeHabitDays(a, b){ return normHabitDays((a || []).concat(b || [])); } // объединение: отметки не пропадают при расхождении устройств
  // цвет текста на карточке цвета hex: тёмный на светлом, белый на тёмном
  function cardInk(hex){
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#1b1b1b" : "#ffffff";
  }
  function cardBg(c){
    var hex = cardColor(c);
    if(!c.hidden) return hex;
    var n = parseInt(hex.slice(1), 16); // скрытая карточка (когда показаны все) — бледнее, как и остальные
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + ",.45)";
  }
  // Заливка карточки в сетке своим цветом; без цвета — стили по умолчанию (фон страницы). Показ по скану (showCardOverlay) цвет НЕ применяет.
  function applyCardLook(cardNode, c){
    if(!cardColor(c)){
      cardNode.style.background = "";
      cardNode.style.color = "";
      cardNode.style.removeProperty("--ink-soft");
      return;
    }
    var ink = cardInk(cardColor(c));
    cardNode.style.background = cardBg(c);
    cardNode.style.color = ink;
    cardNode.style.setProperty("--ink-soft", ink); // дата на карточке читается и на тёмной заливке
  }
  var habitStyleDone = false;
  function ensureHabitStyles(){
    if(habitStyleDone || document.getElementById("habitCardStyle")) { habitStyleDone = true; return; }
    habitStyleDone = true;
    var st = document.createElement("style");
    st.id = "habitCardStyle";
    st.textContent =
      ".habit-colors{display:flex;flex-direction:column;gap:8px;margin:10px 0;padding:4px;}" +
      ".habit-color-row{display:flex;gap:6px;}" +
      // квадрат без aspect-ratio: проценты в padding считаются от ширины строки, поэтому высота = ширине
      ".habit-color{flex:0 0 calc((100% - 42px) / 8);height:0;padding:0 0 calc((100% - 42px) / 8) 0;border:1px solid rgba(0,0,0,.18);border-radius:8px;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
      ".habit-color.none{background:transparent;background-image:linear-gradient(to top right, transparent calc(50% - 1px), rgba(0,0,0,.45) calc(50% - 1px), rgba(0,0,0,.45) calc(50% + 1px), transparent calc(50% + 1px));}" +
      ".habit-color.selected{box-shadow:0 0 0 2px var(--parchment,#fff),0 0 0 4px var(--ink,#000);}" +
      ".habit-map-dot{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:8px;vertical-align:-1px;border:1px solid rgba(0,0,0,.2);}" +
      ".habit-scan-note{position:absolute;left:0;right:0;bottom:9%;text-align:center;color:#fff;font-size:18px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none;padding:0 16px;}";
    document.head.appendChild(st);
  }
  function isSingletonCard(c){ return !!c && (c.type === "datenote" || c.type === "reminder"); }
  function cardTitle(c){
    if(c.type === "datenote") return DATENOTE_TITLE;
    if(c.type === "reminder") return REMINDER_TITLE;
    return c.title || "";
  }
  // вкладки задач, куда можно положить задачу: [{key,title,svg}] — список и пиктограммы отдаёт my.js (в scan.html их нет)
  function taskTabs(){
    try{ return (deps.getTaskTabs && deps.getTaskTabs()) || []; }catch(e){ return []; }
  }
  function taskTabSvg(key){
    var tabs = taskTabs();
    for(var i = 0; i < tabs.length; i++) if(tabs[i].key === key) return tabs[i].svg || "";
    return "";
  }
  function iconSvg(name){
    if(!name || !ICONS[name]) return "";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }
  var PLUS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  var SIZE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="12" rx="1.5"></rect><rect x="13" y="9" width="8" height="12" rx="1.5"></rect></svg>';
  var SCAN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"></path><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"></path><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"></path><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"></path><rect x="8" y="8" width="3" height="3"></rect><rect x="13" y="8" width="3" height="3"></rect><rect x="8" y="13" width="3" height="3"></rect><path d="M13 13h3v3"></path></svg>';
  // часы со стрелкой вокруг («история»), слегка изменённые: стрелка по часовой, на кнопке «сегодняшняя дата»
  var TODAY_ICON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"></path><path d="M20 4v4.5h-4.5"></path><path d="M12 7.5V12l3 2"></path></svg>';
  var PDF_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z"></path><path d="M14 3v4h4"></path><path d="M9 12.5h6"></path><path d="M9 15.5h6"></path><path d="M9 18h3"></path></svg>';

  // ---------- хранилище ----------
  var cardsCache = null;
  function loadCards(){
    if(cardsCache) return cardsCache;
    var arr = [];
    try{ arr = JSON.parse(localStorage.getItem(CARDS_KEY) || "[]"); }catch(e){ arr = []; }
    if(!Array.isArray(arr)) arr = [];
    // тип «note» (скрытые заметки-карточки) убран: такие записи отбрасываются, их тела стали обычными заметками в папке cards-notes (mdeditor.js)
    cardsCache = arr.filter(function(c){ return c && c.id && c.type && c.type !== "note"; });
    return cardsCache;
  }
  function persistCards(){
    try{ localStorage.setItem(CARDS_KEY, JSON.stringify(cardsCache || [])); }catch(e){}
  }
  // сохранить и поставить сверку с облаком в очередь (в scan.html облака нет — сверка при следующем входе во вкладку)
  function saveCards(){
    persistCards();
    scheduleCloudSync();
    rescheduleReminders(); // название, дата-время или повтор могли поменяться — планировщик пересчитывает сроки
  }

  // ---------- синхронизация записей карточек (вариант А ТЗ 12.4) ----------
  // Источник для экрана — localStorage (как раньше). Зеркало — скрытая запись заметок на каждую карточку
  // (mdeditor.js: cardMeta*), её шифрует, отправляет и принимает движок заметок. Конфликт — по updatedAt (новее побеждает).
  // «Синхронизирована» (itemCardsSync_v1.synced) — запись уже была в облаке: если потом её там нет, а облако прочитано целиком,
  // значит удалена на другом устройстве. «Удалить в облаке» (pending) — карточки, удалённые здесь.
  var SYNC_KEY = "itemCardsSync_v1";
  function loadSyncInfo(){
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); }catch(e){ o = null; }
    if(!o || typeof o !== "object") o = {};
    if(!o.synced || typeof o.synced !== "object") o.synced = {};
    if(!Array.isArray(o.pending)) o.pending = [];
    return o;
  }
  function saveSyncInfo(o){
    try{ localStorage.setItem(SYNC_KEY, JSON.stringify(o)); }catch(e){}
  }
  // запись карточки в том виде, как она ходит между устройствами (и проверка пришедшей из облака)
  function cloudShape(r){
    if(!r || typeof r.id !== "string" || !/^[A-Za-z0-9]{4,32}$/.test(r.id)) return null;
    if(r.type !== "timer" && r.type !== "item" && r.type !== "task" && r.type !== "datenote" && r.type !== "reminder" && r.type !== "habit" && r.type !== "remind") return null;
    var o = {
      id: r.id,
      type: r.type,
      title: String(r.title == null ? "" : r.title).slice(0, 200),
      icon: String(r.icon == null ? "" : r.icon).slice(0, 40),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) ? r.date : "",
      seconds: Math.max(0, Math.floor(Number(r.seconds) || 0)),
      createdAt: Number(r.createdAt) || 0,
      updatedAt: Number(r.updatedAt) || 0
    };
    if(r.type === "task") o.tag = taskTag(r.tag);
    if(r.hidden) o.hidden = 1; // «скрыть» — общий признак карточки любого типа
    var col = cardColor(r); if(col) o.color = col; // цвет карточки — у любого типа (пусто — без цвета)
    if(r.type === "habit") o.days = habitDays(r);
    if(r.type === "item"){
      // напоминание карточки: выбранная дата-время и период повтора (remindDone — только на этом устройстве, наружу не идёт)
      o.remindAt = Math.max(0, Math.floor(Number(r.remindAt) || 0));
      o.repeatDays = REPEAT_STEPS.indexOf(r.repeatDays | 0) >= 0 ? (r.repeatDays | 0) : 0;
    }
    if(r.type === "remind"){
      o.comment = String(r.comment == null ? "" : r.comment).slice(0, REMIND_COMMENT_MAX);
      o.remindAt = Math.max(0, Math.floor(Number(r.remindAt) || 0));
      o.repeatKind = kindOf(r);
    }
    return o;
  }
  // true — локальный список изменился (пришло из облака / удалено на другом устройстве)
  function reconcileCloud(){
    var md = getMdEditor();
    if(standalone || !md || !md.cardMetaStatus || !md.cardMetaAll) return false;
    var st = md.cardMetaStatus();
    if(!st || !st.ready) return false; // синхронизация не настроена или заметки не загружены: карточки живут только здесь
    var info = loadSyncInfo();
    var changed = false;
    // 1) удалённые здесь — убрать из облака (если id уже занят новой карточкой, не трогаем)
    info.pending.forEach(function(id){ if(!findCard(id)) md.cardMetaRemove(id); });
    info.pending = [];
    // 2) облако → словарь
    var remote = {};
    md.cardMetaAll().forEach(function(r){
      if(r && r.type === "note" && typeof r.id === "string"){ md.cardMetaRemove(r.id); return; } // прежние карточки-заметки: записи из облака убираем
      var n = cloudShape(r);
      if(n) remote[n.id] = n;
    });
    // 3) локальные карточки против облака
    var out = [];
    loadCards().forEach(function(c){
      var r = remote[c.id];
      if(!r){
        if(info.synced[c.id]){
          // была в облаке, теперь нет: удалена на другом устройстве — но только если облако прочитано целиком
          if(st.pulled){ delete info.synced[c.id]; changed = true; return; }
          out.push(c);
          return;
        }
        var mine = cloudShape(c);
        if(mine){ md.cardMetaSave(mine); info.synced[c.id] = 1; }
        out.push(c);
        return;
      }
      delete remote[c.id];
      info.synced[c.id] = 1;
      var ru = r.updatedAt || 0, lu = c.updatedAt || 0;
      // привычка: отметки дней объединяются (скан на одном устройстве не должен затираться правкой на другом)
      var daysLocalGrew = false, daysRemoteLacks = false;
      if(c.type === "habit" && r.type === "habit"){
        var mergedDays = mergeHabitDays(c.days, r.days);
        daysLocalGrew = mergedDays.length !== habitDays(c).length;
        daysRemoteLacks = mergedDays.length !== habitDays(r).length;
        c.days = mergedDays; r.days = mergedDays.slice();
      }
      if(ru > lu){
        // пришла более новая версия: журнал срабатываний (remindDone) остаётся своим, если напоминание то же; иначе отсчёт заново
        var same = (Number(c.remindAt) || 0) === (Number(r.remindAt) || 0) && repeatOf(c) === repeatOf(r) && kindOf(c) === kindOf(r);
        r.remindDone = same ? (Number(c.remindDone) || 0) : 0;
        if(!same) markPastDone(r);
        if(daysRemoteLacks){ var mr = cloudShape(r); if(mr) md.cardMetaSave(mr); }
        out.push(r); changed = true; return;
      }
      if(lu > ru || daysRemoteLacks){ var m2 = cloudShape(c); if(m2) md.cardMetaSave(m2); }
      if(daysLocalGrew) changed = true;
      out.push(c);
    });
    // 4) новые из облака
    Object.keys(remote).forEach(function(id){
      markPastDone(remote[id]); // повтор уже шёл на другом устройстве: прошлые сроки здесь не показываем
      out.push(remote[id]);
      info.synced[id] = 1;
      changed = true;
    });
    saveSyncInfo(info);
    if(changed){ cardsCache = out; persistCards(); rescheduleReminders(); }
    return changed;
  }
  function gridVisible(){ return screenMode === "grid" && !!document.getElementById("itemCardsGrid"); }
  var cloudSyncTimer = null;
  function scheduleCloudSync(){
    if(standalone) return;
    if(cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(function(){
      cloudSyncTimer = null;
      if(reconcileCloud() && gridVisible()) renderGrid();
    }, 800);
  }
  var cloudListenerSet = false;
  function cloudSyncOnEnter(){
    var md = getMdEditor();
    if(standalone || !md || !md.cardMetaPull) return;
    if(!cloudListenerSet && md.setCardMetaListener){
      cloudListenerSet = true;
      // приход записей карточек с другого устройства, пока вкладка открыта
      md.setCardMetaListener(function(){ if(reconcileCloud() && gridVisible()) renderGrid(); });
    }
    if(reconcileCloud()) renderGrid();
    md.cardMetaPull().then(function(){
      if(reconcileCloud() && gridVisible()) renderGrid();
    });
  }
  function findCard(id){
    var list = loadCards();
    for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
    return virtualCards[id] || null;
  }
  function newId(){
    var out = "";
    var buf = new Uint8Array(8);
    if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    else for(var i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
    for(var j = 0; j < 8; j++) out += ID_ALPHABET.charAt(buf[j] % ID_ALPHABET.length);
    return findCard(out) ? newId() : out;
  }
  function todayIso(){
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function isoToRu(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? (m[3] + "." + m[2] + "." + m[1]) : "";
  }
  function formatTimer(sec){
    sec = Math.max(0, sec | 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + pad2(m) : m) + ":" + pad2(s);
  }

  // ---------- размер карточки ----------
  function getScale(){
    var v = parseFloat(localStorage.getItem(SIZE_KEY));
    if(!isFinite(v)) v = 1;
    return Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));
  }
  function setScale(v){
    try{ localStorage.setItem(SIZE_KEY, String(v)); }catch(e){}
  }
  // Раскладка — та же, что у сетки обложек в книгах (components.css .books-cover-grid): колонки
  // repeat(auto-fill, minmax(110px, 1fr)) с зазором 2px. База 110px × ползунок — это минимальная ширина карточки,
  // колонок помещается столько, сколько влезает, и карточки растягиваются на всю ширину области вкладки (без пустых
  // полей по бокам; поля — только 8px самой вкладки, как у книг). Саму ширину считаем здесь, а не в CSS, потому что
  // от неё считается всё внутри карточки (шрифты, пиктограмма, кнопки: переменная --item-card-w).
  var BOOKS_BASE_PX = 110;
  var GRID_GAP_PX = 2;
  function applySize(rootEl){
    if(!rootEl) return;
    var cs = window.getComputedStyle(rootEl);
    var inner = rootEl.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if(!(inner > 40)) inner = 329; // область вкладки ещё не измерима: запасное значение (экран ~390px)
    var base = BOOKS_BASE_PX * getScale();
    var cols = Math.max(1, Math.floor((inner + GRID_GAP_PX) / (base + GRID_GAP_PX)));
    var w = (inner - GRID_GAP_PX * (cols - 1)) / cols;
    rootEl.style.setProperty("--item-card-cols", String(cols));
    rootEl.style.setProperty("--item-card-w", (Math.floor(w * 100) / 100) + "px");
  }
  // поворот экрана и смена ширины окна: колонки пересчитываются
  var resizeTimer = null;
  window.addEventListener("resize", function(){
    if(resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      var tab = document.querySelector(".item-cards-tab");
      if(tab && document.getElementById("itemCardsGrid")) applySize(tab);
    }, 120);
  });

  // ---------- состояние экрана ----------
  var screenMode = "grid"; // grid | form
  var revealedIds = {};
  var flippedId = null;
  var typeMenuOpen = false;
  // фильтр по типу карточек (кнопка-воронка слева от «+»): all | timer | item | task | special («Особые» — «Сегодня» и «Напоминалка»)
  var FILTER_KEY = "itemCardsFilter_v1";
  var FILTERS = [
    { key: "all", label: "Все" },
    { key: "timer", label: "Таймеры" },
    { key: "item", label: "Предметы" },
    { key: "task", label: "Задачи" },
    { key: "habit", label: "Привычки" },
    { key: "remind", label: "Напоминания" },
    { key: "special", label: "Особые" }
  ];
  var cardFilter = null;
  function getFilter(){
    if(cardFilter === null){
      var v = "all";
      try{ v = localStorage.getItem(FILTER_KEY) || "all"; }catch(e){}
      cardFilter = FILTERS.some(function(f){ return f.key === v; }) ? v : "all";
    }
    return cardFilter;
  }
  function setFilter(v){
    cardFilter = v;
    try{ if(v === "all") localStorage.removeItem(FILTER_KEY); else localStorage.setItem(FILTER_KEY, v); }catch(e){}
  }
  function cardMatchesFilter(c, f){
    f = f || getFilter();
    if(f === "all") return true;
    if(f === "special") return c.type === "datenote" || c.type === "reminder";
    return c.type === f;
  }
  // «Показать/скрыть скрытые»: глаз — показаны все карточки, перечёркнутый глаз — карточки с признаком `hidden` не показываются
  var SHOWHID_KEY = "itemCardsShowHidden_v1";
  var showHidden = null;
  function getShowHidden(){
    if(showHidden === null){
      var v = "1";
      try{ v = localStorage.getItem(SHOWHID_KEY) || "1"; }catch(e){}
      showHidden = v !== "0";
    }
    return showHidden;
  }
  function setShowHidden(v){
    showHidden = !!v;
    try{ localStorage.setItem(SHOWHID_KEY, showHidden ? "1" : "0"); }catch(e){}
  }
  var EYE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  var EYE_OFF_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle><path d="M4 4l16 16"></path></svg>';
  var FILTER_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5z"></path></svg>';

  function container(){ return document.getElementById("settingsTabContent"); }
  // Android 5: PDF не реализуется (решение заказчика, ТЗ 16.10.2026) — кнопки нет
  function isAndroid5(){ return /Android [1-5]\./.test(navigator.userAgent || ""); }
  function isLegacyAnim(){
    try{
      if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    }catch(e){}
    return /Android [1-5]\./.test(navigator.userAgent || "");
  }

  // ---------- сетка ----------
  // ---------- напоминания карточек (шаг 6а ТЗ) ----------
  var REPEAT_STEPS = [1, 2, 3, 5, 10, 14, 21, 30, 60, 90, 180];
  var DAY_MS = 86400000;
  var FIRED_KEY = "taskRemindersFired_v1"; // «уже показанные» напоминания (notifications.js) — id карточек там вида «card:<id>»
  function repeatOf(c){ var d = (c && c.repeatDays) | 0; return REPEAT_STEPS.indexOf(d) >= 0 ? d : 0; }
  // карточка «Напоминание» (type "remind"): повтор по видам, а не по дням — каждый час / 8 часов / день / неделя / месяц / год
  var REMIND_COMMENT_MAX = 500;
  var REPEAT_KINDS = [
    { key: "hour", label: "Каждый час", ms: 3600000 },
    { key: "8h", label: "Каждые 8 часов", ms: 28800000 },
    { key: "day", label: "Каждый день", ms: 86400000 },
    { key: "week", label: "Каждую неделю", ms: 604800000 },
    { key: "month", label: "Каждый месяц", est: 28 * 86400000 },
    { key: "year", label: "Каждый год", est: 365 * 86400000 }
  ];
  function kindInfo(k){ for(var i = 0; i < REPEAT_KINDS.length; i++) if(REPEAT_KINDS[i].key === k) return REPEAT_KINDS[i]; return null; }
  function kindOf(c){ var k = c && c.repeatKind; return kindInfo(k) ? k : ""; }
  // прибавить месяцы с «прижиманием» дня к концу короткого месяца (31 января + 1 месяц = 28/29 февраля; так же считает оболочка)
  function addMonthsTs(ts, n){
    var d = new Date(ts), day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d.getTime();
  }
  // срок номер k от базы (k = 0 — сама база)
  function addKind(base, kind, k){
    var info = kindInfo(kind);
    if(info.ms) return base + k * info.ms;
    return addMonthsTs(base, kind === "year" ? 12 * k : k);
  }
  // наибольший k ≥ 0, при котором срок не позже t (base ≤ t)
  function kthIdx(base, kind, t){
    var info = kindInfo(kind);
    var k = Math.max(0, Math.floor((t - base) / (info.ms || info.est)));
    while(addKind(base, kind, k + 1) <= t) k++;
    while(k > 0 && addKind(base, kind, k) > t) k--;
    return k;
  }
  // последний наступивший срок повтора (0 — повтора нет или ещё не начался)
  function lastOcc(c, t){
    var base = Number(c && c.remindAt) || 0, kind = kindOf(c);
    if(!kind || !(base > 0) || base > t) return 0;
    return addKind(base, kind, kthIdx(base, kind, t));
  }
  function nextOccurrence(c){
    var kind0 = kindOf(c);
    if(kind0){
      var b0 = Number(c.remindAt) || 0;
      if(!(b0 > 0)) return 0;
      var done0 = Number(c.remindDone) || 0;
      if(done0 < b0) return b0;
      return addKind(b0, kind0, kthIdx(b0, kind0, done0) + 1);
    }
    var base = Number(c && c.remindAt) || 0;
    if(!(base > 0)) return 0;
    var p = repeatOf(c) * DAY_MS;
    if(!p) return base;
    var done = Number(c.remindDone) || 0;
    if(done < base) return base;
    return base + (Math.floor((done - base) / p) + 1) * p;
  }
  // последний наступивший срок повтора (новые с другого устройства карточки не должны «догонять» прошлое)
  function markPastDone(c){
    if(kindOf(c)){ var lo = lastOcc(c, Date.now()); if(lo) c.remindDone = lo; return; }
    var p = repeatOf(c) * DAY_MS, base = Number(c.remindAt) || 0, now = Date.now();
    if(p && base > 0 && base <= now) c.remindDone = base + Math.floor((now - base) / p) * p;
  }
  function remindBtnHtml(c){
    if(c.type === "timer" || c.type === "remind" || isSingletonCard(c) || !deps.reminderBtnParts) return "";
    var at = nextOccurrence(c);
    var p = deps.reminderBtnParts(at || 0);
    return '<button type="button" class="task-icon-btn task-reminder-btn item-card-remind-btn' + (at ? ' active' : '') + p.cls + '" data-card-id="' + escapeHtml(c.id) + '" title="' +
      (at && deps.formatReminder ? escapeHtml("Напоминание: " + deps.formatReminder(at) + (repeatOf(c) ? ", повтор каждые " + repeatOf(c) + " дн." : "")) : "Напоминание") + '">' + p.inner + '</button>';
  }
  function refreshRemindBtn(c){
    var b = document.querySelector('.item-card-remind-btn[data-card-id="' + c.id + '"]');
    if(!b || !deps.reminderBtnParts) return;
    var at = nextOccurrence(c);
    var p = deps.reminderBtnParts(at || 0);
    b.className = 'task-icon-btn task-reminder-btn item-card-remind-btn' + (at ? ' active' : '') + p.cls;
    b.innerHTML = p.inner;
    b.title = at && deps.formatReminder ? "Напоминание: " + deps.formatReminder(at) + (repeatOf(c) ? ", повтор каждые " + repeatOf(c) + " дн." : "") : "Напоминание";
  }
  // снимок для планировщика уведомлений (my.js getRemindableTasks → notifications.js): [{id: "card:<id>", c: {text, remindAt, repeatDays, checked}}]
  function getRemindableCards(){
    var fired = {};
    try{ fired = JSON.parse(localStorage.getItem(FIRED_KEY) || "{}") || {}; }catch(e){ fired = {}; }
    var changed = false, out = [];
    loadCards().forEach(function(c){
      if(c.type === "timer" || isSingletonCard(c) || !(Number(c.remindAt) > 0)) return;
      var key = "card:" + c.id, f = fired[key];
      if(c.type === "remind"){
        // «Напоминание»: сработавший срок (здесь или в оболочке) → отработанным считаем последний наступивший (пропущенные не повторяем)
        var rk = kindOf(c), rd = Number(c.remindDone) || 0;
        if(typeof f === "number" && f >= (Number(c.remindAt) || 0) && f > rd){
          var lo = rk ? lastOcc(c, Date.now()) : 0;
          c.remindDone = Math.max(f, lo); changed = true;
        }
        if(!rk && (Number(c.remindDone) || 0) >= Number(c.remindAt)) return; // разовое уже сработало — больше не планируем
        var rat = nextOccurrence(c);
        if(rat > 0){
          var rt = String(c.title || "").trim() || "Напоминание";
          var cm = String(c.comment || "").replace(/\s+/g, " ").trim();
          out.push({ id: key, c: { text: cm ? (rt + ": " + cm) : rt, remindAt: rat, repeatDays: 0, repeatKind: rk, checked: false } });
        }
        return;
      }
      // срабатывание повтора (здесь или в оболочке) запоминаем в самой карточке: журнал показанных чистится через ~2 месяца
      if(repeatOf(c) && typeof f === "number" && f > (Number(c.remindDone) || 0)){ c.remindDone = f; changed = true; }
      var at = nextOccurrence(c);
      if(at > 0) out.push({ id: key, c: { text: c.title || "", remindAt: at, repeatDays: repeatOf(c), checked: false } });
    });
    if(changed) persistCards();
    return out;
  }
  function rescheduleReminders(){ if(deps.rescheduleReminders) deps.rescheduleReminders(); }
  function openCardReminder(c){
    if(!deps.openReminderDialog) return;
    var sel = '.item-card-remind-btn[data-card-id="' + c.id + '"]';
    var btn = function(){ return document.querySelector(sel); };
    deps.openReminderDialog({
      anchorEl: btn(),
      getAnchorEl: btn,
      currentTs: nextOccurrence(c) || null,
      repeatDays: repeatOf(c),
      onSave: function(ts){
        var cur = findCard(c.id);
        if(!cur) return;
        cur.remindAt = ts; cur.remindDone = 0; cur.updatedAt = Date.now(); // новая выбранная дата — отсчёт повтора заново
        saveCards(); refreshRemindBtn(cur);
      },
      onRepeat: function(d){
        var cur = findCard(c.id);
        if(!cur) return;
        if(d === 0 && repeatOf(cur)){ cur.remindAt = nextOccurrence(cur) || cur.remindAt; cur.remindDone = 0; } // выключили повтор: остаётся ближайший срок
        cur.repeatDays = d;
        cur.updatedAt = Date.now();
        saveCards(); refreshRemindBtn(cur);
      }
    });
  }
  function clearCardReminder(id){
    var cur = findCard(id);
    if(!cur) return;
    cur.remindAt = 0; cur.repeatDays = 0; cur.remindDone = 0; cur.updatedAt = Date.now();
    saveCards(); refreshRemindBtn(cur);
  }
  // выделение карточки жирной обводкой (переход из уведомления); пропадает после первого взаимодействия
  var attentionId = null;
  function clearAttention(id){
    if(attentionId !== id) return;
    attentionId = null;
    var el = cardEl(id);
    if(el) el.classList.remove("item-card-attn");
  }
  function focusCard(id){
    attentionId = findCard(id) ? id : null;
    renderGrid();
    var el = attentionId ? cardEl(attentionId) : null;
    if(el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
  }

  var REMIND_BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"></path><path d="M10 20.5a2 2 0 0 0 4 0"></path></svg>';
  function remindShort(ts){ var d = new Date(ts); return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function cardFrontHtml(c){
    var icon = iconSvg(c.icon);
    if(c.type === "timer"){
      return '<div class="item-card-title"></div>' +
        '<div class="item-card-time" data-id="' + escapeHtml(c.id) + '">' + escapeHtml(timerTextFor(c)) + '</div>' +
        '<div class="item-card-timer-btns">' +
          '<button type="button" class="item-card-stop-btn" title="Остановить таймер">Стоп</button>' +
          '<button type="button" class="item-card-start-btn" title="Запустить таймер">Пуск</button>' +
        '</div>';
    }
    if(c.type === "habit"){ // цвет привычки — фон всей карточки (applyCardLook), здесь значок календаря с галочкой и название
      return '<div class="item-card-icon">' + iconSvg("habit") + '</div>' +
        '<div class="item-card-title"></div>';
    }
    if(c.type === "remind"){ // колокольчик, название и ближайший срок (QR-кода нет)
      var nxt = nextOccurrence(c);
      return '<div class="item-card-icon">' + REMIND_BELL_SVG + '</div>' +
        '<div class="item-card-title"></div>' +
        (nxt ? '<div class="item-card-date">' + escapeHtml(remindShort(nxt)) + '</div>' : '');
    }
    if(c.type === "task"){ // пиктограмма вкладки, куда код кладёт задачу, и начало текста задачи (название обрезается стилем)
      return '<div class="item-card-icon">' + taskTabSvg(c.icon) + '</div>' +
        '<div class="item-card-title"></div>' +
        (taskTag(c.tag) ? '<div class="item-card-date">#' + escapeHtml(taskTag(c.tag)) + '</div>' : '');
    }
    return '<div class="item-card-icon">' + icon + '</div>' +
      '<div class="item-card-title"></div>' +
      '<div class="item-card-date">' + escapeHtml(isoToRu(c.date)) + '</div>' +
      remindBtnHtml(c);
  }
  function renderGrid(){
    screenMode = "grid";
    ensureHabitStyles();
    var el = container();
    if(!el) return;
    var cards = loadCards();
    var html = '<div class="mdeditor-tab item-cards-tab" id="itemCardsTab">';
    html += '<div class="item-cards-grid" id="itemCardsGrid"></div>';
    // «Сегодня» — одна на всё приложение: пока карточка есть, пункта в меню нет (вернётся после удаления карточки)
    var hasDateNote = cards.some(function(c){ return c.type === "datenote"; });
    // «Напоминалка» — тоже одна на приложение, по тому же правилу
    var hasReminder = cards.some(function(c){ return c.type === "reminder"; });
    html += '<div class="item-type-menu" id="itemTypeMenu" style="display:none;">' +
      '<button type="button" class="workbooks-run-btn" data-type="timer">Таймер</button>' +
      '<button type="button" class="workbooks-run-btn" data-type="item">Предмет</button>' +
      '<button type="button" class="workbooks-run-btn" data-type="task">Создавать задачу</button>' +
      '<button type="button" class="workbooks-run-btn" data-type="habit">Привычка</button>' +
      '<button type="button" class="workbooks-run-btn" data-type="remind">Напоминание</button>' +
      (hasDateNote ? '' : '<button type="button" class="workbooks-run-btn" data-type="datenote">' + DATENOTE_TITLE + '</button>') +
      (hasReminder ? '' : '<button type="button" class="workbooks-run-btn" data-type="reminder">' + REMINDER_TITLE + '</button>') +
    '</div>';
    var showPdf = !isAndroid5();
    if(showPdf){
      html += '<div class="item-type-menu" id="itemPdfMenu" style="display:none;">' +
        '<button type="button" class="workbooks-run-btn" data-per="4">Большие (4 на лист)</button>' +
        '<button type="button" class="workbooks-run-btn" data-per="12">Средние (12 на лист)</button>' +
        '<button type="button" class="workbooks-run-btn" data-per="24">Маленькие (24 на лист)</button>' +
        '<div class="item-pdf-status" id="itemPdfStatus" style="display:none;"></div>' +
      '</div>';
    }
    var curFilter = getFilter();
    var showAll = getShowHidden();
    html += '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsHiddenBtn" title="' + (showAll ? 'Показаны все карточки (нажмите, чтобы скрыть скрытые)' : 'Скрытые карточки не показаны (нажмите, чтобы показать все)') + '">' + (showAll ? EYE_ICON_SVG : EYE_OFF_ICON_SVG) + '</button>' +
      '<span class="item-filter-wrap">' +
        '<div class="item-type-menu item-filter-menu" id="itemFilterMenu" style="display:none;">' +
          FILTERS.map(function(f){
            return '<button type="button" class="workbooks-run-btn' + (f.key === curFilter ? ' selected' : '') + '" data-filter="' + f.key + '">' + f.label + '</button>';
          }).join('') +
        '</div>' +
        '<button type="button" class="mdeditor-fab-btn' + (curFilter !== "all" ? ' pressed' : '') + '" id="itemCardsFilterBtn" title="Показать карточки: ' + FILTERS.filter(function(f){ return f.key === curFilter; })[0].label + '">' + FILTER_ICON_SVG + '</button>' +
      '</span>' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsAddBtn" title="Новая карточка">' + PLUS_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsScanBtn" title="Сканировать QR-код">' + SCAN_ICON_SVG + '</button>' +
      (showPdf ? '<button type="button" class="mdeditor-fab-btn" id="itemCardsPdfBtn" title="PDF с QR-кодами для печати">' + PDF_ICON_SVG + '</button>' : '') +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsSizeBtn" title="Размер карточек">' + SIZE_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsHomeStub" tabindex="-1" aria-disabled="true">' + READER_HOME_ICON_SVG + '</button>' +
    '</div>';
    html += '<div class="fontsize-bar" id="itemCardsSizeBar">' +
      '<span class="task-iconsize-dot task-iconsize-dot-s"></span>' +
      '<input type="range" class="fontsize-bar-range" id="itemCardsSizeRange" min="' + SIZE_MIN + '" max="' + SIZE_MAX + '" step="0.05" value="1" aria-label="Размер карточек">' +
      '<span class="task-iconsize-dot task-iconsize-dot-l"></span>' +
      '<span class="fontsize-bar-val" id="itemCardsSizeVal"></span>' +
    '</div>';
    html += '</div>';
    el.innerHTML = html;
    var tab = document.getElementById("itemCardsTab");
    applySize(tab);

    var grid = document.getElementById("itemCardsGrid");
    var shown = cards.filter(function(c){ return cardMatchesFilter(c, curFilter) && (showAll || !c.hidden); });
    if(!shown.length){
      grid.className = "item-cards-grid item-cards-empty";
    }
    shown.forEach(function(c){
      var card = document.createElement("div");
      card.className = "item-card item-card-" + c.type + (attentionId === c.id ? " item-card-attn" : "") + (c.hidden ? " item-card-hidden" : "");
      card.dataset.id = c.id;
      var revealed = !!revealedIds[c.id];
      card.innerHTML =
        '<div class="item-card-front">' + cardFrontHtml(c) + '</div>' +
        '<div class="item-card-back" style="display:none;"><div class="item-card-qr"></div></div>' +
        '<div class="book-cover-actions">' +
          '<button type="button" class="mdeditor-share-btn item-card-eye-btn' + (revealed ? " visible" : "") + '" title="' + (c.hidden ? "Скрыта (нажмите, чтобы показывать всегда)" : "Показана (нажмите, чтобы скрыть)") + '">' + (c.hidden ? EYE_OFF_ICON_SVG : EYE_ICON_SVG) + '</button>' +
          '<button type="button" class="mdeditor-delete-btn' + (revealed ? " visible" : "") + '" title="Удалить">' + DELETE_ICON_SVG + '</button>' +
          // у привычки тап открывает карту, а не форму — правка отдельной кнопкой (тот же тёмный полупрозрачный стиль, что у глаза)
          ((c.type === "habit" || isSingletonCard(c)) ? '<button type="button" class="mdeditor-share-btn item-card-edit-btn' + (revealed ? " visible" : "") + '" title="Изменить">' + PENCIL_ICON_SVG + '</button>' : '') +
        '</div>';
      card.querySelector(".item-card-title").textContent = cardTitle(c);
      applyCardLook(card, c);
      grid.appendChild(card);
    });
    bindGrid(grid);
    syncTimersView();
    bindFab(tab);
    if(flippedId && findCard(flippedId)) flipCard(flippedId, true, true); else flippedId = null;
  }

  function cardEl(id){
    return document.querySelector('#itemCardsGrid .item-card[data-id="' + id + '"]');
  }

  // ---------- карта привычки ----------
  // Те же классы и вид, что у «Карты дней года» (my.js, buildYearGridMarkup): последние 365 дней, неделя в строке (Пн…Вс),
  // сетка прокручена к текущей неделе. Отмеченные дни закрашены цветом привычки. Стили карты — общие (components.css).
  var HABIT_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var HABIT_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  function isoOfDate(d){ return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function habitMapMarkup(c){
    var color = cardColor(c) || "var(--wood)"; // без цвета — цвет выбранной вкладки (темы)
    var marked = {};
    habitDays(c).forEach(function(d){ marked[d] = 1; });
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var winStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 364); // 365 дней включительно
    var gridStart = new Date(winStart.getFullYear(), winStart.getMonth(), winStart.getDate() - ((winStart.getDay() + 6) % 7));
    var gridEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - ((today.getDay() + 6) % 7)));
    var rows = Math.ceil((Math.round((gridEnd - gridStart) / DAY_MS) + 1) / 7);
    var html = '<div class="year-grid-v-row year-grid-v-header"><span class="year-grid-v-month-label"></span>';
    for(var wd = 0; wd < 7; wd++) html += '<span class="year-grid-v-weekday">' + HABIT_WEEKDAYS[wd] + '</span>';
    html += '</div>';
    var lastMonth = -1, count = 0, todayIsoStr = isoOfDate(today);
    for(var row = 0; row < rows; row++){
      var first = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + row * 7);
      var label = "";
      if(first >= winStart && first.getMonth() !== lastMonth){ lastMonth = first.getMonth(); label = HABIT_MONTHS[lastMonth]; }
      html += '<div class="year-grid-v-row"><span class="year-grid-v-month-label">' + label + '</span>';
      for(var col = 0; col < 7; col++){
        var d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + row * 7 + col);
        var cls = "year-grid-v-cell", style = "";
        if(d < winStart) cls += " empty";
        else if(d > today) cls += " future";
        else {
          var iso = isoOfDate(d);
          if(marked[iso]){ count++; style = ' style="background:' + color + ';border-color:rgba(0,0,0,.25);"'; }
          if(iso === todayIsoStr) cls += " today";
        }
        html += '<span class="' + cls + '"' + style + '></span>';
      }
      html += '</div>';
    }
    // невидимая строка-распорка внизу: последняя неделя при прокрутке до упора выходит из-под затемняющей маски (как в «Карте дней года»)
    html += '<div class="year-grid-v-row year-grid-v-spacer-row"><span class="year-grid-v-month-label"></span>';
    for(var sp = 0; sp < 7; sp++) html += '<span class="year-grid-v-cell empty"></span>';
    html += '</div>';
    return { html: html, count: count };
  }
  function openHabitMap(id){
    var c = findCard(id);
    var el = container();
    if(!c || !el) return;
    ensureHabitStyles();
    screenMode = "form"; // не сетка: возврат на вкладку всегда перерисовывает сетку карточек
    var built = habitMapMarkup(c);
    el.innerHTML =
      '<div class="year-grid-tab-header">' +
        '<div class="common-tab-title"><span class="habit-map-dot" style="background:' + (cardColor(c) || "var(--wood)") + ';"></span><span id="habitMapTitle"></span></div>' +
        '<button type="button" class="year-grid-active-days-btn" tabindex="-1" title="Дней с отметками за последние 365 дней">' + built.count + '</button>' +
      '</div>' +
      '<div class="year-grid-v-scroll" id="habitMapScroll">' + built.html + '</div>';
    document.getElementById("habitMapTitle").textContent = c.title || "Привычка";
    var sc = document.getElementById("habitMapScroll");
    requestAnimationFrame(function(){ sc.scrollTop = sc.scrollHeight; }); // сразу к текущей неделе (внизу)
    if(window.AppNav) window.AppNav.push(function(){ renderGrid(); });
  }

  // ---------- оборот карточки: QR ----------
  function buildQr(card, id){
    var host = card.querySelector(".item-card-qr");
    if(!host) return;
    var cc = findCard(id);
    var text = cc ? qrTextFor(cc) : QR_PREFIX + id; // у таймера в коде время и название, поэтому «построено» помечается самим текстом
    if(host.dataset.built === text) return;
    host.dataset.built = text;
    host.innerHTML = "";
    deps.loadQrLib().then(function(){
      if(host.dataset.built !== text) return;
      var size = Math.max(60, Math.round(card.clientWidth * 0.72));
      var qo = { text: text, width: size, height: size, colorDark: "#000000", colorLight: "#ffffff" };
      if(cc && cc.type === "task") qo.correctLevel = window.QRCode.CorrectLevel.M; // текст внутри кода: уровень M — меньше модулей, код крупнее
      try{ new window.QRCode(host, qo); }catch(e){}
    }).catch(function(){ host.textContent = "QR недоступен"; });
  }
  function setFace(card, back){
    card.querySelector(".item-card-front").style.display = back ? "none" : "";
    card.querySelector(".item-card-back").style.display = back ? "flex" : "none";
    card.classList.toggle("flipped", !!back);
  }
  function flipCard(id, toBack, instant){
    var card = cardEl(id);
    if(!card) return;
    if(toBack) buildQr(card, id);
    if(instant || isLegacyAnim()){ setFace(card, toBack); }
    else {
      // лёгкая анимация: только transform на одной карточке (сжали по X, сменили сторону, вернули)
      card.style.transition = "transform .15s ease-in";
      card.style.transform = "scaleX(0.02)";
      setTimeout(function(){
        setFace(card, toBack);
        card.style.transition = "transform .15s ease-out";
        card.style.transform = "scaleX(1)";
        setTimeout(function(){ card.style.transition = ""; card.style.transform = ""; }, 170);
      }, 150);
    }
    flippedId = toBack ? id : null;
  }
  function unflipAny(){
    if(flippedId) flipCard(flippedId, false);
  }

  function hideRevealed(){
    var any = false;
    for(var k in revealedIds){ if(revealedIds.hasOwnProperty(k)){ any = true; break; } }
    if(!any) return;
    revealedIds = {};
    var btns = document.querySelectorAll("#itemCardsGrid .mdeditor-delete-btn.visible, #itemCardsGrid .item-card-eye-btn.visible, #itemCardsGrid .item-card-edit-btn.visible");
    for(var i = 0; i < btns.length; i++) btns[i].classList.remove("visible");
  }

  function bindGrid(grid){
    var LONG_MS = 350, MOVE_PX = 10, DOUBLE_MS = 300;
    var pressTimer = null, startXY = null, longFired = false;
    var lastTapId = null, lastTapAt = 0, singleTimer = null;
    function clearPress(){ clearTimeout(pressTimer); pressTimer = null; }
    function startPress(cardNode, x, y, target){
      if(!cardNode) return;
      longFired = false; startXY = { x: x, y: y };
      clearPress();
      // удержание часов напоминания — снять напоминание (как у задач); кнопки правки/удаления при этом не раскрываются
      if(target && target.closest && target.closest(".item-card-remind-btn")){
        pressTimer = setTimeout(function(){ longFired = true; clearCardReminder(cardNode.dataset.id); }, LONG_MS);
        return;
      }
      pressTimer = setTimeout(function(){
        longFired = true;
        clearAttention(cardNode.dataset.id);
        revealedIds[cardNode.dataset.id] = true;
        var btns = cardNode.querySelectorAll(".mdeditor-delete-btn, .item-card-eye-btn, .item-card-edit-btn");
        for(var i = 0; i < btns.length; i++) btns[i].classList.add("visible");
      }, LONG_MS);
    }
    function movePress(x, y){
      if(!startXY) return;
      var dx = x - startXY.x, dy = y - startXY.y;
      if(Math.sqrt(dx * dx + dy * dy) > MOVE_PX) clearPress();
    }
    grid.addEventListener("touchstart", function(e){ var t = e.touches[0]; startPress(e.target.closest(".item-card"), t.clientX, t.clientY, e.target); }, { passive: true });
    grid.addEventListener("touchmove", function(e){ var t = e.touches[0]; movePress(t.clientX, t.clientY); }, { passive: true });
    grid.addEventListener("touchend", clearPress);
    grid.addEventListener("touchcancel", clearPress);
    grid.addEventListener("mousedown", function(e){ startPress(e.target.closest(".item-card"), e.clientX, e.clientY, e.target); });
    grid.addEventListener("mousemove", function(e){ movePress(e.clientX, e.clientY); });
    grid.addEventListener("mouseup", clearPress);
    grid.addEventListener("mouseleave", clearPress);
    grid.addEventListener("contextmenu", function(e){ e.preventDefault(); });

    grid.addEventListener("click", function(e){
      var cardNode = e.target.closest(".item-card");
      if(!cardNode) return;
      var id = cardNode.dataset.id;
      var c = findCard(id);
      if(!c) return;
      if(longFired){ longFired = false; return; }
      e.stopPropagation();
      clearAttention(id); // любое взаимодействие с карточкой снимает жирную обводку
      if(e.target.closest(".item-card-remind-btn")){ hideRevealed(); openCardReminder(c); return; }
      if(e.target.closest(".item-card-eye-btn")){ // глаз: показывать всегда ↔ скрыть (скрытая видна и в PDF не попадает)
        if(c.hidden) delete c.hidden; else c.hidden = 1;
        c.updatedAt = Date.now();
        saveCards();
        renderGrid(); // кнопки остаются раскрытыми (revealedIds), значок меняется
        return;
      }
      if(e.target.closest(".item-card-edit-btn")){ hideRevealed(); openForm(c.type, c); return; }
      if(e.target.closest(".mdeditor-delete-btn")){
        openAppConfirmBar("Удалить карточку «" + (c.title || "без названия") + "»?" + (c.type === "remind" ? " Напоминание будет отменено." : " QR-код перестанет работать."), function(){
          deleteCard(c.id);
        }, { anchorEl: e.target.closest(".mdeditor-delete-btn") });
        return;
      }
      if(flippedId === id){ flipCard(id, false); return; } // тап по QR/обороту — назад
      if(flippedId) unflipAny();
      if(e.target.closest(".item-card-start-btn")){ startTimerForCard(c); return; } // «Пуск»: запуск, а если уже идёт — заново
      if(e.target.closest(".item-card-stop-btn")){ stopTimerForCard(c); return; } // «Стоп»: отмена таймера
      if(revealedIds[id]){ hideRevealed(); return; }
      if(c.type === "remind"){ onCardTap(c); return; } // у «Напоминания» нет QR-кода: оборота нет, тап сразу открывает форму
      var now = Date.now();
      if(lastTapId === id && now - lastTapAt < DOUBLE_MS){
        clearTimeout(singleTimer); lastTapId = null;
        flipCard(id, true);
        return;
      }
      lastTapId = id; lastTapAt = now;
      clearTimeout(singleTimer);
      singleTimer = setTimeout(function(){
        lastTapId = null;
        onCardTap(c);
      }, DOUBLE_MS);
    });
    // тап мимо карточки: оборот возвращается, раскрытые кнопки прячутся
    grid.parentNode.addEventListener("click", function(e){
      if(e.target.closest(".item-card") || e.target.closest(".mdeditor-fab-row") || e.target.closest(".fontsize-bar") || e.target.closest(".item-type-menu")) return;
      unflipAny(); hideRevealed(); closeTypeMenu();
    });
  }

  function onCardTap(c){
    if(isSingletonCard(c)) return; // «Сегодня» и «Напоминалка» работают только по QR-коду (двойной тап — оборот с кодом)
    if(c.type === "habit"){ openHabitMap(c.id); return; } // привычка: карта дней (правка — кнопкой при удержании)
    openForm(c.type, c); // таймер и предмет: форма с заполненными полями
  }

  // ---------- нижний ряд ----------
  var pdfBusy = false;
  function closeTypeMenu(){
    typeMenuOpen = false;
    var m = document.getElementById("itemTypeMenu");
    if(m) m.style.display = "none";
    var fm = document.getElementById("itemFilterMenu");
    if(fm) fm.style.display = "none";
    var pm = document.getElementById("itemPdfMenu");
    if(pm && !pdfBusy) pm.style.display = "none"; // во время сборки PDF меню остаётся — на нём строка «Готовлю…»
  }

  // ---------- PDF с кодами (шаг 6 ТЗ) ----------
  function exportPdf(perPage){
    if(pdfBusy) return;
    var allCards = loadCards();
    var cards = allCards.filter(function(c){ return !c.hidden && c.type !== "remind"; }); // скрытые и «Напоминания» (кода нет) в PDF не попадают
    if(!cards.length){ alert(allCards.length ? "Все карточки скрыты — PDF собирать не из чего." : "Карточек пока нет — PDF собирать не из чего."); return; }
    if(!window.CardPdf){ alert("Модуль PDF не загружен."); return; }
    var menu = document.getElementById("itemPdfMenu");
    var status = document.getElementById("itemPdfStatus");
    function setStatus(t){ if(status){ status.style.display = t ? "block" : "none"; status.textContent = t || ""; } }
    function setButtons(disabled){
      if(!menu) return;
      var bs = menu.querySelectorAll("button");
      for(var i = 0; i < bs.length; i++) bs[i].disabled = disabled;
    }
    pdfBusy = true; setButtons(true); setStatus("Готовлю PDF…");
    // у «Создавать задачу» рядом с кодом печатается только начало текста (полный текст лежит в самом коде)
    var forPdf = cards.map(function(c){
      var ttl = cardTitle(c);
      if(c.type === "task"){
        if(ttl.length > 40) ttl = taskText(ttl, 40) + "…";
      }
      return { id: c.id, title: ttl, qr: qrTextFor(c) };
    });
    deps.loadQrLib().then(function(){
      return window.CardPdf.build(forPdf, perPage, { onProgress: function(done, total){ setStatus("Готовлю PDF… " + done + " из " + total); } });
    }).then(function(blob){
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "cards-qr-" + todayIso() + ".pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    }).catch(function(err){
      console.error(err);
      alert("Не удалось собрать PDF.");
    }).then(function(){
      pdfBusy = false; setButtons(false); setStatus("");
      var m = document.getElementById("itemPdfMenu");
      if(m) m.style.display = "none";
    });
  }
  function bindFab(tab){
    var addBtn = document.getElementById("itemCardsAddBtn");
    var menu = document.getElementById("itemTypeMenu");
    var hiddenBtn = document.getElementById("itemCardsHiddenBtn");
    hiddenBtn.addEventListener("click", function(){
      closeTypeMenu();
      var sb1 = document.getElementById("itemCardsSizeBar");
      if(sb1) sb1.classList.remove("open");
      setShowHidden(!getShowHidden());
      unflipAny();
      renderGrid();
    });
    var filterBtn = document.getElementById("itemCardsFilterBtn");
    var filterMenu = document.getElementById("itemFilterMenu");
    filterBtn.addEventListener("click", function(){
      var open = filterMenu.style.display !== "flex";
      closeTypeMenu();
      var sb0 = document.getElementById("itemCardsSizeBar");
      if(sb0) sb0.classList.remove("open");
      if(open) filterMenu.style.display = "flex";
    });
    filterMenu.addEventListener("click", function(e){
      var b = e.target.closest("button[data-filter]");
      if(!b) return;
      setFilter(b.dataset.filter);
      unflipAny();
      renderGrid();
    });
    addBtn.addEventListener("click", function(){
      var bar = document.getElementById("itemCardsSizeBar");
      if(bar) bar.classList.remove("open");
      var fm0 = document.getElementById("itemFilterMenu");
      if(fm0) fm0.style.display = "none";
      var pm = document.getElementById("itemPdfMenu");
      if(pm && !pdfBusy) pm.style.display = "none";
      typeMenuOpen = !typeMenuOpen;
      menu.style.display = typeMenuOpen ? "flex" : "none";
    });
    menu.addEventListener("click", function(e){
      var b = e.target.closest("button[data-type]");
      if(!b) return;
      closeTypeMenu();
      if(!cardMatchesFilter({ type: b.dataset.type })) setFilter("all"); // новая карточка не должна пропасть под фильтром
      openForm(b.dataset.type, null);
    });
    var pdfBtn = document.getElementById("itemCardsPdfBtn");
    var pdfMenu = document.getElementById("itemPdfMenu");
    if(pdfBtn && pdfMenu){
      pdfBtn.addEventListener("click", function(){
        var sb2 = document.getElementById("itemCardsSizeBar");
        if(sb2) sb2.classList.remove("open");
        var open = pdfMenu.style.display !== "flex";
        closeTypeMenu();
        if(open) pdfMenu.style.display = "flex";
      });
      pdfMenu.addEventListener("click", function(e){
        var b = e.target.closest("button[data-per]");
        if(!b) return;
        exportPdf(parseInt(b.dataset.per, 10));
      });
    }
    document.getElementById("itemCardsScanBtn").addEventListener("click", function(){
      closeTypeMenu();
      var sb = document.getElementById("itemCardsSizeBar");
      if(sb) sb.classList.remove("open");
      openScan();
    });
    var bar = document.getElementById("itemCardsSizeBar");
    var range = document.getElementById("itemCardsSizeRange");
    var val = document.getElementById("itemCardsSizeVal");
    function showVal(){ val.textContent = Math.round(getScale() * 100) + "%"; }
    document.getElementById("itemCardsSizeBtn").addEventListener("click", function(){
      closeTypeMenu();
      var open = !bar.classList.contains("open");
      bar.classList.toggle("open", open);
      if(open){ range.value = String(getScale()); showVal(); }
    });
    range.addEventListener("mousedown", function(e){ e.preventDefault(); });
    range.addEventListener("input", function(){
      var v = parseFloat(range.value);
      if(!isFinite(v)) return;
      setScale(v); applySize(tab); showVal();
    });
  }

  function deleteCard(id){
    var list = loadCards();
    var c = findCard(id);
    if(!c) return;
    cardsCache = list.filter(function(x){ return x.id !== id; });
    delete revealedIds[id];
    if(flippedId === id) flippedId = null;
    var syncInfo = loadSyncInfo();
    delete syncInfo.synced[id];
    if(syncInfo.pending.indexOf(id) < 0) syncInfo.pending.push(id);
    if(syncInfo.pending.length > 300) syncInfo.pending = syncInfo.pending.slice(-300);
    saveSyncInfo(syncInfo); // удалить и запись в облаке (reconcileCloud)
    saveCards();
    renderGrid();
  }

  // ---------- форма создания / правки ----------
  var TYPE_LABEL = { timer: "Таймер", item: "Предмет", task: "Создавать задачу", habit: "Привычка", datenote: DATENOTE_TITLE, reminder: REMINDER_TITLE, remind: "Напоминание" };
  // выбор цвета карточки (необязательный, у любого типа): разметка и привязка; первый пастельный квадрат — пустой цвет
  function colorPaletteHtml(type){
    var h = '<div class="item-form-hint">' + (type === "habit"
      ? 'Цвет карточки и отметок на карте. Пустой квадрат — карточка без заливки, отметки в цвете темы.'
      : 'Цвет карточки — необязательно. Пустой квадрат — карточка без заливки.') + '</div>';
    h += '<div class="habit-colors" id="icfColors">';
    [HABIT_COLORS_BRIGHT, HABIT_COLORS_PASTEL].forEach(function(row){
      h += '<div class="habit-color-row">';
      row.forEach(function(hex){
        h += hex
          ? '<button type="button" class="habit-color" data-color="' + hex + '" style="background:' + hex + ';" title="' + hex + '"></button>'
          : '<button type="button" class="habit-color none" data-color="" title="Без цвета"></button>';
      });
      h += '</div>';
    });
    return h + '</div>';
  }
  function openForm(type, card, forcedId){
    screenMode = "form";
    var el = container();
    if(!el) return;
    var isNew = !card;
    ensureHabitStyles();
    var isSingle = (type === "datenote" || type === "reminder"); // «Сегодня» и «Напоминалка»: в форме только цвет
    var data = card ? JSON.parse(JSON.stringify(card)) : {
      type: type, title: isSingle ? TYPE_LABEL[type] : "", icon: DEFAULT_ICON[type] || "", date: isSingle ? "" : todayIso(), seconds: 0
    };
    data.color = isNew ? defaultColorFor(type) : cardColor(card); // новая карточка — с запомненным цветом этого типа
    var colorTouched = false;
    if(type === "habit" && isNew) data.days = [];
    var html = '<div class="mdeditor-tab item-card-form" id="itemCardForm">';
    html += '<h3 class="common-tab-title">' + escapeHtml(TYPE_LABEL[type]) + '</h3>';
    if(type === "habit"){
      html += '<div class="item-form-hint">Каждое сканирование кода отмечает сегодняшний день на карте привычки. В один день засчитывается одно сканирование — повторные в тот же день ничего не меняют. Название (до 40 знаков) зашито в код: если кто-то отсканирует его на другом устройстве, там появится такая же привычка (цвет каждый выбирает себе сам) и отметки пойдут уже у него.</div>';
    }
    if(type === "task"){
      html += '<div class="item-form-hint">Код с текстом задачи: кто его отсканирует в приложении, получит эту задачу на выбранной вкладке. Такая же невыполненная задача второй раз не создаётся — её переносят в конец списка вкладки. Категория (тег) необязательна: задача получит её сразу, по тегу задачи можно отбирать на вкладке.</div>';
    }
    if(type === "remind"){
      html += '<div class="item-form-hint">Напоминание сработает в выбранный день и час. QR-кода у этой карточки нет.</div>';
    }
    if(!isSingle) html += '<input type="text" class="mdeditor-cleanup-input item-form-title" id="icfTitle" placeholder="' + (type === "task" ? "Текст задачи (до " + TASK_TEXT_MAX + " знаков)" : "Название") + '" maxlength="' + (type === "task" ? TASK_TEXT_MAX : (type === "habit" ? HABIT_TITLE_MAX : 80)) + '" autocomplete="off">';
    if(isSingle){
      // только цвет (ниже)
    } else if(type === "task"){
      html += '<div class="item-form-tabs" id="icfTabs">';
      taskTabs().forEach(function(t){
        html += '<button type="button" class="item-form-tab" data-tab="' + escapeHtml(t.key) + '" title="' + escapeHtml(t.title) + '">' + (t.svg || "") + '<span>' + escapeHtml(t.title) + '</span></button>';
      });
      html += '</div>';
      // категория (тег): выпадающий список категорий, которые уже есть у карточек «Создавать задачу», «Без категории» и «Новая категория…» с полем ввода
      var catList = cardTaskTags();
      var curTag = taskTag(data.tag);
      if(curTag && catList.map(function(x){ return String(x).toLowerCase(); }).indexOf(curTag.toLowerCase()) < 0) catList = catList.concat([curTag]);
      html += '<div class="item-form-cat" id="icfCat"><select class="mdeditor-cleanup-input" id="icfCatSel"><option value="">Без категории</option>';
      catList.forEach(function(x){ html += '<option value="' + escapeHtml(x) + '">' + escapeHtml(x) + '</option>'; });
      html += '<option value="__new__">Новая категория…</option></select>' +
        '<input type="text" class="mdeditor-cleanup-input" id="icfCatNew" placeholder="Новая категория (до ' + TASK_TAG_MAX + ' знаков)" maxlength="' + TASK_TAG_MAX + '" autocomplete="off" style="display:none;"></div>';
    } else if(type === "habit"){
      // у привычки только название и цвет (ниже)
    } else if(type === "remind"){
      html += '<textarea class="mdeditor-cleanup-input item-form-comment" id="icfComment" rows="3" maxlength="' + REMIND_COMMENT_MAX + '" placeholder="Комментарий" style="resize:vertical;font-family:inherit;"></textarea>';
      html += '<div class="item-form-row"><div class="item-form-date">' +
        '<button type="button" class="reminder-bubble reminder-bubble-time" id="icfTimeBtn" title="Время"></button>' +
        '<input type="time" class="reminder-hidden-input" id="icfTimeInput" tabindex="-1" aria-hidden="true">' +
      '</div><div class="item-form-date">' +
        '<button type="button" class="reminder-bubble reminder-bubble-date" id="icfDateBtn" title="Дата"></button>' +
        '<input type="date" class="reminder-hidden-input" id="icfDateInput" tabindex="-1" aria-hidden="true">' +
      '</div></div>';
      html += '<select class="mdeditor-cleanup-input" id="icfRepeat"><option value="">Без повтора</option>';
      REPEAT_KINDS.forEach(function(k){ html += '<option value="' + k.key + '">' + k.label + '</option>'; });
      html += '</select>';
    } else if(type === "timer"){
      html += '<div class="item-form-timer" id="icfTimer">' +
        wheelHtml("h", 24, "ч") + wheelHtml("m", 60, "мин") + wheelHtml("s", 60, "с") +
      '</div>';
    } else {
      html += '<div class="item-form-row">';
      html += '<div class="item-form-icons" id="icfIcons">';
      ICON_ORDER.forEach(function(name){
        html += '<button type="button" class="item-form-icon" data-icon="' + name + '" title="' + name + '">' + iconSvg(name) + '</button>';
      });
      html += '</div>';
      html += '<div class="item-form-date">' +
        '<button type="button" class="reminder-bubble reminder-bubble-date" id="icfDateBtn" title="Дата"></button>' +
        '<input type="date" class="reminder-hidden-input" id="icfDateInput" tabindex="-1" aria-hidden="true">' +
      '</div>';
      html += '</div>';
    }
    html += colorPaletteHtml(type);
    html += '<div class="item-form-error" id="icfError"></div>';
    html += '<div class="item-form-buttons">' +
      '<button type="button" class="workbooks-run-btn" id="icfSave">Сохранить</button>' +
      '<button type="button" class="workbooks-run-btn" id="icfCancel">Отмена</button>' +
    '</div>';
    html += '</div>';
    el.innerHTML = html;

    var titleEl = document.getElementById("icfTitle");
    if(titleEl) titleEl.value = data.title || "";
    var errEl = document.getElementById("icfError");

    if(type === "timer"){
      var total = data.seconds | 0;
      setWheel("h", Math.floor(total / 3600));
      setWheel("m", Math.floor((total % 3600) / 60));
      setWheel("s", total % 60);
    } else if(isSingle || type === "habit"){
      // ничего, кроме цвета
    } else if(type === "remind"){
      var cmEl = document.getElementById("icfComment"), repEl = document.getElementById("icfRepeat");
      cmEl.value = data.comment || "";
      repEl.value = kindOf(data);
      var base0 = Number(data.remindAt) > 0 ? Number(data.remindAt) : (function(){ var d0 = new Date(Date.now() + 30 * 60000); d0.setSeconds(0, 0); return d0.getTime(); })();
      var bd = new Date(base0);
      data.rDate = bd.getFullYear() + "-" + pad2(bd.getMonth() + 1) + "-" + pad2(bd.getDate());
      data.rTime = pad2(bd.getHours()) + ":" + pad2(bd.getMinutes());
      var rDateBtn = document.getElementById("icfDateBtn"), rDateIn = document.getElementById("icfDateInput");
      var rTimeBtn = document.getElementById("icfTimeBtn"), rTimeIn = document.getElementById("icfTimeInput");
      function showRDate(){ rDateBtn.textContent = isoToRu(data.rDate) || "дата"; rDateIn.value = data.rDate || ""; }
      function showRTime(){ rTimeBtn.textContent = data.rTime || "время"; rTimeIn.value = data.rTime || ""; }
      showRDate(); showRTime();
      function openPicker(inp){ try{ if(typeof inp.showPicker === "function"){ inp.showPicker(); return; } }catch(e){} try{ inp.focus(); inp.click(); }catch(e){} }
      rDateBtn.addEventListener("click", function(){ openPicker(rDateIn); });
      rTimeBtn.addEventListener("click", function(){ openPicker(rTimeIn); });
      rDateIn.addEventListener("change", function(){ if(rDateIn.value) data.rDate = rDateIn.value; showRDate(); });
      rTimeIn.addEventListener("change", function(){ if(rTimeIn.value) data.rTime = rTimeIn.value; showRTime(); });
    } else if(type === "task"){
      var tabsEl = document.getElementById("icfTabs");
      function markTabs(){
        var bs = tabsEl.querySelectorAll(".item-form-tab");
        for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].dataset.tab === data.icon);
      }
      markTabs();
      tabsEl.addEventListener("click", function(e){
        var b = e.target.closest(".item-form-tab");
        if(!b) return;
        data.icon = b.dataset.tab;
        markTabs();
      });
      var catSel = document.getElementById("icfCatSel"), catNew = document.getElementById("icfCatNew");
      function showCatNew(){ catNew.style.display = catSel.value === "__new__" ? "" : "none"; if(catSel.value === "__new__") catNew.focus(); }
      var tg0 = taskTag(data.tag);
      if(tg0){
        for(var oi = 0; oi < catSel.options.length; oi++) if(catSel.options[oi].value.toLowerCase() === tg0.toLowerCase()) catSel.selectedIndex = oi;
      }
      catSel.addEventListener("change", showCatNew);
    } else {
      var iconsEl = document.getElementById("icfIcons");
      function markIcons(){
        var bs = iconsEl.querySelectorAll(".item-form-icon");
        for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].dataset.icon === data.icon);
      }
      markIcons();
      iconsEl.addEventListener("click", function(e){
        var b = e.target.closest(".item-form-icon");
        if(!b) return;
        // повторный тап по выбранному снимает выбор (пиктограмма не обязательна)
        data.icon = (data.icon === b.dataset.icon) ? "" : b.dataset.icon;
        markIcons();
      });
      // дата — тот же приём, что у даты напоминания задач: кнопка + скрытый <input type=date>
      var dateBtn = document.getElementById("icfDateBtn");
      var dateInput = document.getElementById("icfDateInput");
      function showDate(){ dateBtn.textContent = isoToRu(data.date) || "дата"; dateInput.value = data.date || ""; }
      showDate();
      dateBtn.addEventListener("click", function(){
        try{
          if(typeof dateInput.showPicker === "function"){ dateInput.showPicker(); return; }
        }catch(e){}
        try{ dateInput.focus(); dateInput.click(); }catch(e){}
      });
      dateInput.addEventListener("change", function(){
        if(dateInput.value) data.date = dateInput.value;
        showDate();
      });
    }

    var colorsEl = document.getElementById("icfColors");
    var markColors = function(){
      var bs = colorsEl.querySelectorAll(".habit-color");
      for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].dataset.color === (data.color || ""));
    };
    markColors();
    colorsEl.addEventListener("click", function(e){
      var b = e.target.closest(".habit-color");
      if(!b) return;
      data.color = b.dataset.color; // "" — пустой цвет
      colorTouched = true;
      markColors();
    });

    function leave(){ renderGrid(); }
    document.getElementById("icfCancel").addEventListener("click", leave);
    if(window.AppNav) window.AppNav.push(function(){ renderGrid(); });

    document.getElementById("icfSave").addEventListener("click", function(){
      var title = titleEl ? titleEl.value.replace(/^\s+|\s+$/g, "") : data.title;
      errEl.textContent = "";
      if(type === "task"){
        title = taskText(title);
        if(!title){ errEl.textContent = "Введите текст задачи."; return; }
        if(!data.icon){ errEl.textContent = "Выберите вкладку, куда добавлять задачу."; return; }
        var csel = document.getElementById("icfCatSel"), cnew = document.getElementById("icfCatNew");
        data.tag = taskTag(csel.value === "__new__" ? cnew.value : csel.value);
        if(csel.value === "__new__" && !data.tag){ errEl.textContent = "Введите название категории или выберите «Без категории»."; return; }
      }
      if(!title && !isSingle){ errEl.textContent = "Введите название."; return; }
      if(type === "remind"){
        var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.rDate || ""), tm = /^(\d{2}):(\d{2})$/.exec(data.rTime || "");
        if(!dm || !tm){ errEl.textContent = "Выберите дату и время напоминания."; return; }
        var at = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0).getTime();
        if(!(at > Date.now())){ errEl.textContent = "Время напоминания уже прошло — выберите время в будущем."; return; }
        data.remindAt = at;
        data.comment = document.getElementById("icfComment").value.replace(/^\s+|\s+$/g, "").slice(0, REMIND_COMMENT_MAX);
        data.repeatKind = document.getElementById("icfRepeat").value;
        if(!kindInfo(data.repeatKind)) data.repeatKind = "";
        data.remindDone = 0;
        delete data.rDate; delete data.rTime;
      }
      if(type === "timer"){
        var sec = getWheel("h") * 3600 + getWheel("m") * 60 + getWheel("s");
        if(sec <= 0){ errEl.textContent = "Задайте время."; return; }
        data.seconds = sec;
      }
      data.title = title;
      var now = Date.now();
      if(!data.color) delete data.color; // пустой цвет в записи не хранится
      if(colorTouched) rememberColorFor(type, data.color || "");
      if(isNew && isSingle && loadCards().some(function(x){ return x.type === type; })){ leave(); return; } // такая карточка уже есть
      if(isNew){
        data.id = (forcedId && !findCard(forcedId)) ? forcedId : newId(); // forcedId: карточка создаётся под уже напечатанный код
        data.createdAt = now;
        data.updatedAt = now;
        loadCards().push(data);
      } else {
        var cur = findCard(card.id);
        if(cur){
          cur.title = data.title;
          cur.icon = data.icon;
          if(type === "task") cur.tag = data.tag;
          if(data.color) cur.color = data.color; else delete cur.color; // отметки дней (days) правка не трогает
          cur.date = data.date;
          cur.seconds = data.seconds;
          if(type === "remind"){ cur.comment = data.comment; cur.remindAt = data.remindAt; cur.repeatKind = data.repeatKind; cur.remindDone = 0; }
          cur.updatedAt = now;
        }
      }
      saveCards();
      leave();
    });
  }

  // колесо времени «как в часах»: вертикальная прокрутка с прилипанием, значение = позиция
  var WHEEL_ROW = 40;
  function wheelHtml(key, count, label){
    var rows = '<div class="item-wheel-pad"></div>';
    for(var i = 0; i < count; i++) rows += '<div class="item-wheel-row">' + pad2(i) + '</div>';
    rows += '<div class="item-wheel-pad"></div>';
    return '<div class="item-wheel-col"><div class="item-wheel" id="icfWheel_' + key + '">' + rows + '</div><div class="item-wheel-label">' + label + '</div></div>';
  }
  function setWheel(key, v){
    var w = document.getElementById("icfWheel_" + key);
    if(w) w.scrollTop = v * WHEEL_ROW;
  }
  function getWheel(key){
    var w = document.getElementById("icfWheel_" + key);
    return w ? Math.max(0, Math.round(w.scrollTop / WHEEL_ROW)) : 0;
  }



  // ---------- таймеры карточек (шаг 5а ТЗ) ----------
  // Отсчёт ведёт не страница: в оболочке — Kotlin (CardTimers: будильник, уведомление/остров, вибрация в конце), он идёт при
  // закрытом приложении; на странице scan.html — тот же CardTimers через мост окна (deps.timers); в браузере (без оболочки) —
  // запасной вариант: момент окончания в localStorage, вибрацию в конце даёт только открытая страница.
  var TIMERS_KEY = "itemCardTimers_v1";
  var timerApi = null;
  var timerList = [];
  var tickTimer = null;
  function makeWebTimers(){
    function read(){ try{ return JSON.parse(localStorage.getItem(TIMERS_KEY) || "{}") || {}; }catch(e){ return {}; } }
    function write(o){ try{ localStorage.setItem(TIMERS_KEY, JSON.stringify(o)); }catch(e){} }
    function sweep(){
      var o = read(), now = Date.now(), fired = false;
      Object.keys(o).forEach(function(id){ if(o[id].running && o[id].endAt <= now){ delete o[id]; fired = true; } });
      if(fired){
        write(o);
        try{ if(navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]); }catch(e){}
      }
    }
    return {
      start: function(id, title, sec){
        var o = read();
        o[id] = { id: id, title: title, durationMs: sec * 1000, running: true, endAt: Date.now() + sec * 1000, remainingMs: 0 };
        write(o);
        return true;
      },
      cancel: function(id){ var o = read(); if(o[id]){ delete o[id]; write(o); } },
      list: function(){ sweep(); var o = read(); return Object.keys(o).map(function(k){ return o[k]; }); }
    };
  }
  function getTimerApi(){
    if(timerApi) return timerApi;
    if(deps.timers){ timerApi = deps.timers; return timerApi; }
    var N = window.LifeTrackerNative;
    if(N && typeof N.getCardTimers === "function"){
      timerApi = {
        start: function(id, title, sec){ return N.startCardTimer(id, title, sec | 0); },
        // cancelCardTimer есть в мосте с версии 7; проверка — на случай старой оболочки
        cancel: function(id){ if(typeof N.cancelCardTimer === "function") N.cancelCardTimer(id); },
        list: function(){ try{ return JSON.parse(N.getCardTimers() || "[]"); }catch(e){ return []; } }
      };
    } else {
      timerApi = makeWebTimers();
    }
    return timerApi;
  }
  function refreshTimers(){
    try{ timerList = getTimerApi().list() || []; }catch(e){ timerList = []; }
  }
  // {running, leftMs} для идущего или приостановленного таймера этой карточки, иначе null
  function timerInfo(id){
    for(var i = 0; i < timerList.length; i++){
      var t = timerList[i];
      if(t.id !== id) continue;
      if(t.running){
        var left = t.endAt - Date.now();
        return left > 0 ? { running: true, leftMs: left } : null;
      }
      return { running: false, leftMs: t.remainingMs || 0 };
    }
    return null;
  }
  function timerTextFor(c){
    var info = timerInfo(c.id);
    return formatTimer(info ? Math.ceil(info.leftMs / 1000) : c.seconds);
  }
  // обновляет цифры на всех видимых карточках-таймерах; true — есть идущий или приостановленный таймер
  function updateTimerTexts(){
    var any = false;
    var nodes = document.querySelectorAll(".item-card-time[data-id]");
    for(var i = 0; i < nodes.length; i++){
      var id = nodes[i].getAttribute("data-id");
      var c = findCard(id);
      if(!c) continue;
      var info = timerInfo(id);
      nodes[i].textContent = formatTimer(info ? Math.ceil(info.leftMs / 1000) : c.seconds);
      nodes[i].classList.toggle("running", !!(info && info.running));
      nodes[i].classList.toggle("paused", !!(info && !info.running));
      if(info) any = true;
    }
    return any;
  }
  function ensureTick(){
    if(tickTimer) return;
    tickTimer = setInterval(function(){
      refreshTimers();
      var active = updateTimerTexts();
      var visible = !!document.querySelector(".item-card-time[data-id]");
      if(!active || !visible){ clearInterval(tickTimer); tickTimer = null; }
    }, 1000);
  }
  // после отрисовки сетки или показа карточки: подтянуть состояние и, если что-то идёт, запустить обновление цифр
  function syncTimersView(){
    refreshTimers();
    if(updateTimerTexts()) ensureTick();
  }
  function evLog(text, opts){ try{ if(window.EventLog) window.EventLog.add(text, opts); }catch(e){} }
  function startTimerForCard(c){
    if(!c || c.type !== "timer" || !(c.seconds > 0)) return;
    try{ getTimerApi().start(c.id, c.title || "", c.seconds); }catch(e){}
    try{ if(window.EventLog) window.EventLog.timerStarted(c.id, c.title || "", c.seconds); }catch(e){}
    syncTimersView();
  }
  // «Стоп»: таймер отменяется целиком (пауза не нужна), цифры возвращаются к заданному времени; закончившийся таймер — гасит вибрацию
  function stopTimerForCard(c){
    if(!c || c.type !== "timer") return;
    try{ var api = getTimerApi(); if(api && typeof api.cancel === "function") api.cancel(c.id); }catch(e){}
    try{ if(window.EventLog) window.EventLog.timerCancelled(c.id); }catch(e){}
    syncTimersView();
  }

  // ---------- сканирование (шаги 3 и 5 ТЗ) ----------
  var scanHandle = null;   // активный сканер (CardScan.open) или null
  var overlayEl = null;    // слой «карточка при сканировании» или null
  var scanNav = null;      // шаг «назад» на время сканирования: {active}
  var scanDirty = false;   // дата карточки менялась кнопкой в углу — сетке нужна перерисовка

  function reloadCards(){ cardsCache = null; return loadCards(); }
  function scanNavStart(){
    if(!window.AppNav){ scanNav = null; return; } // scan.html: своей истории нет, закрытие — через мост оболочки
    var token = { active: true };
    scanNav = token;
    window.AppNav.push(function(){
      if(!token.active) return;
      token.active = false; scanNav = null;
      closeScanSession();
    });
  }
  // goBack=true — просто закрываем сканирование (убираем свой шаг «назад»); false — дальше сразу идёт
  // другая навигация (заметка, форма): шаг оставляем, как у остальных экранов вкладки.
  function scanNavEnd(goBack){
    var t = scanNav;
    scanNav = null;
    if(!t || !t.active) return;
    t.active = false;
    if(goBack){ try{ history.back(); }catch(e){} }
  }
  function closeOverlayEl(){
    if(overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }
  function closeScanSession(){
    closeOverlayEl();
    if(scanHandle){ scanHandle.close(); scanHandle = null; }
    finishScanSession();
  }
  function finishScanSession(){
    if(standalone){ leaveStandalone(); return; }
    if(scanDirty && screenMode === "grid" && document.getElementById("itemCardsGrid")){ renderGrid(); }
    scanDirty = false;
  }
  function endScanSession(goBack){
    closeOverlayEl();
    if(scanHandle){ scanHandle.close(); scanHandle = null; }
    scanNavEnd(goBack);
    finishScanSession();
  }
  function leaveStandalone(){
    if(nativeScan && nativeScan.close){ try{ nativeScan.close(); return; }catch(e){} }
    try{ history.back(); }catch(e){}
  }

  function openScan(){
    if(!window.CardScan) return;
    closeOverlayEl();
    if(scanHandle){ scanHandle.close(); scanHandle = null; }
    scanNavEnd(false);
    scanNavStart();
    scanHandle = window.CardScan.open({
      loadJsqr: deps.loadJsqrLib,
      windowed: standalone,
      // скан привычки отмечает день без отмены — для таких кодов сканер держит дольше (как для таймера и задачи)
      longHold: function(p){ if(p && p.kind === "habit") return true; if(!p || p.kind !== "card") return false; var cc = findCard(p.id); return !!cc && cc.type === "habit"; },
      onCode: function(text){ scanHandle = null; handleScanned(text); },
      onBack: function(){ scanHandle = null; endScanSession(true); }
    });
  }

  function handleScanned(text){
    var p = window.CardScan.parseCode(text);
    if(p.kind === "card"){
      reloadCards();
      var c = findCard(p.id);
      if(!c && !standalone && reconcileCloud()) c = findCard(p.id);
      if(c){
        showScanned(c);
        return;
      }
      // карточки нет на этом устройстве: если настроена синхронизация — ищем в облаке (не дольше 2,5 с)
      var md = getMdEditor();
      var st = (!standalone && md && md.cardMetaStatus && md.cardMetaPull) ? md.cardMetaStatus() : null;
      if(st && st.ready){
        showNoticeOverlay({ kind: "text", text: "Ищу карточку в облаке…" });
        var waitEl = overlayEl;
        var done = false;
        var finish = function(){
          if(done) return;
          done = true;
          if(overlayEl !== waitEl) return; // пользователь уже закрыл окно
          reconcileCloud();
          var c2 = findCard(p.id);
          if(c2) showScanned(c2);
          else { evLog("Просканирована карточка, которой нет на этом устройстве"); showNoticeOverlay({ kind: "missing", id: p.id }); }
        };
        setTimeout(finish, 2500);
        md.cardMetaPull().then(finish, finish);
        return;
      }
      evLog("Просканирована карточка, которой нет на этом устройстве");
      showNoticeOverlay({ kind: "missing", id: p.id });
      return;
    }
    if(p.kind === "habit"){ handleScannedHabit(p); return; } // привычка с названием в коде: нет карточки — создаём по коду
    if(p.kind === "reminder"){ showReminderOverlay(); return; } // общий код «Напоминалки»: карточка не нужна
    if(p.kind === "today"){ openTodayFromScan(); return; }       // общий код «Сегодня»: карточка не нужна
    if(p.kind === "note"){ openScannedNote(p.id); return; }
    if(p.kind === "task"){ handleScannedTask(p); return; }  // задача в самом коде: карточка не нужна
    if(p.kind === "timer"){ showScanned(timerFromCode(p)); return; } // таймер из самого кода: отсчёт стартует сразу, карточка не нужна
    evLog("Просканирован QR-код: " + String(p.url || p.text || "").slice(0, 80));
    showNoticeOverlay({ kind: p.kind, url: p.url, text: p.text });
  }

  // ---------- привычка из кода lt://v1/habit/<id>/<название> ----------
  // Карточка на этом устройстве есть — обычный скан (отметка дня). Нет — сначала смотрим в облаке (если синхронизация настроена,
  // не дольше 2,5 с: вдруг это своя карточка, ещё не дошедшая сюда), потом создаём её по коду: тот же id, название из кода,
  // пустые `days`, без цвета. Одинаковый id — своя история отметок у каждого, при общей синхронизации дни объединяются.
  function habitFromCode(p){
    var c = findCard(p.id);
    if(c) return c;
    var now = Date.now();
    c = { id: p.id, type: "habit", title: String(p.title || "").slice(0, 80), icon: DEFAULT_ICON.habit || "", date: "", seconds: 0, days: [], createdAt: now, updatedAt: now };
    var col = defaultColorFor("habit"); if(col) c.color = col;
    loadCards().push(c);
    saveCards();
    return c;
  }
  function handleScannedHabit(p){
    reloadCards();
    var c = findCard(p.id);
    if(!c && !standalone && reconcileCloud()) c = findCard(p.id);
    if(c){ showScanned(c); return; }
    var md = getMdEditor();
    var st = (!standalone && md && md.cardMetaStatus && md.cardMetaPull) ? md.cardMetaStatus() : null;
    if(st && st.ready){
      showNoticeOverlay({ kind: "text", text: "Ищу карточку в облаке…" });
      var waitEl = overlayEl;
      var done = false;
      var finish = function(){
        if(done) return;
        done = true;
        if(overlayEl !== waitEl) return; // пользователь уже закрыл окно
        reconcileCloud();
        showScanned(habitFromCode(p));
      };
      setTimeout(finish, 2500);
      md.cardMetaPull().then(finish, finish);
      return;
    }
    showScanned(habitFromCode(p));
  }

  // ---------- «Создавать задачу»: скан кода lt://v1/task/<вкладка>/<текст> ----------
  // В приложении задачу добавляет my.js (deps.addTaskFromQr): новую создаёт на вкладке, а если такая же невыполненная уже есть —
  // не плодит дубликат, а переносит её в конец списка этой вкладки. Окно ярлыка (scan.html) приложения не содержит: задача
  // кладётся в очередь (тот же localStorage) и приложение открывается входом TASK_NATIVE_ID — оболочка ничего нового не знает.
  function handleScannedTask(p){
    if(standalone){
      try{
        var q = JSON.parse(localStorage.getItem(PENDING_TASKS_KEY) || "[]");
        if(!Array.isArray(q)) q = [];
        q.push({ tab: p.tab, tag: p.tag || "", text: p.text, at: Date.now() });
        localStorage.setItem(PENDING_TASKS_KEY, JSON.stringify(q.slice(-20)));
      }catch(e){}
      if(nativeScan && nativeScan.openInApp){ try{ nativeScan.openInApp(TASK_NATIVE_ID, "note"); }catch(e){} }
      leaveStandalone();
      return;
    }
    applyScannedTask(p);
  }
  function applyScannedTask(p, silent){
    var res;
    try{ res = deps.addTaskFromQr ? deps.addTaskFromQr(p.tab, p.text, p.tag || "") : { status: "error", reason: "unsupported" }; }
    catch(e){ console.error(e); res = { status: "error", reason: "fail" }; }
    if(res && res.status === "added") evLog("Была добавлена новая задача «" + (res.text || p.text) + "»");
    else if(res && res.status === "moved") evLog("Задача «" + (res.text || p.text) + "» перенесена в конец вкладки" + (res.tabTitle ? " " + res.tabTitle : ""));
    if(!silent) showTaskResultOverlay(p, res);
    return res;
  }
  // очередь из окна ярлыка: свежие записи (не старше 30 минут) выполняются, слой показывает результат последней
  function drainPendingTasks(){
    var q = [];
    try{ q = JSON.parse(localStorage.getItem(PENDING_TASKS_KEY) || "[]"); }catch(e){ q = []; }
    try{ localStorage.removeItem(PENDING_TASKS_KEY); }catch(e){}
    if(!Array.isArray(q)) return;
    var now = Date.now();
    q = q.filter(function(x){ return x && typeof x.tab === "string" && typeof x.text === "string" && now - (Number(x.at) || 0) < 30 * 60 * 1000; });
    for(var i = 0; i < q.length; i++) applyScannedTask(q[i], i < q.length - 1);
  }
  // слой: задача «…» добавлена (или перенесена в конец) на вкладку (пиктограмма и название)
  function showTaskResultOverlay(p, res){
    var o = newOverlay();
    var card = document.createElement("div");
    card.className = "scan-task-card";
    card.addEventListener("click", function(e){ e.stopPropagation(); });
    var head = document.createElement("div");
    head.className = "scan-task-head";
    var txt = document.createElement("div");
    txt.className = "scan-task-text";
    txt.textContent = "«" + (res && res.text ? res.text : p.text) + "»";
    if(res && (res.status === "added" || res.status === "moved")){
      head.textContent = res.status === "added" ? "Задача добавлена на вкладку" : "Такая задача уже была — перенесена в конец вкладки";
      card.appendChild(txt);
      card.appendChild(head);
      var tab = document.createElement("div");
      tab.className = "scan-task-tab";
      tab.innerHTML = '<div class="scan-task-ico">' + (res.tabSvg || "") + '</div>';
      var nm = document.createElement("span");
      nm.textContent = res.tabTitle || "";
      tab.appendChild(nm);
      card.appendChild(tab);
      if(res.tag){
        var tgEl = document.createElement("div");
        tgEl.className = "scan-task-tag";
        tgEl.textContent = "Тег: " + res.tag;
        card.appendChild(tgEl);
      }
    } else {
      var why = res && res.reason;
      head.textContent = why === "badtab" ? "Код ссылается на вкладку, которой нет в этой версии приложения."
        : why === "readonly" ? "Задачу не добавить: на вкладке «Общие задачи» у вас только просмотр."
        : why === "unsupported" ? "Эта версия приложения не умеет добавлять задачи по коду."
        : "Не удалось добавить задачу.";
      card.appendChild(head);
      card.appendChild(txt);
    }
    o.appendChild(card);
    if(isLegacyAnim()){ o.style.animation = "none"; card.style.animation = "none"; } // Android 5: без анимации
  }

  // найденная по скану карточка: таймер стартует сразу и показывается слоем; «Сегодня» слоя не имеет — сразу создаёт заметку
  // отметить сегодняшний день: true — отмечено сейчас, false — сегодня уже отмечено (или это не привычка)
  function markHabitToday(id){
    var c = findCard(id);
    if(!c || c.type !== "habit") return false;
    var t = todayIso();
    var days = habitDays(c);
    if(days.indexOf(t) >= 0) return false;
    days.push(t);
    c.days = normHabitDays(days);
    c.updatedAt = Date.now();
    saveCards();
    return true;
  }
  function showScanned(c){
    if(c.type === "habit"){ // скан привычки: один день — одна отметка, повторный скан в тот же день ничего не делает
      var added = markHabitToday(c.id);
      evLog(cardTitle(c));
      scanDirty = true;
      showCardOverlay(findCard(c.id) || c, added ? "Сегодня отмечено" : "Сегодня уже отмечено");
      return;
    }
    if(c.type === "task"){ handleScannedTask({ tab: c.icon, tag: taskTag(c.tag), text: c.title }); return; } // на случай кода по id карточки
    if(c.type === "datenote"){ openDatedNoteFromScan(c); return; }
    if(c.type === "reminder"){ showReminderOverlay(); return; } // «Напоминалка»: случайное напоминание из «Комментариев» слоем
    if(c.type === "timer") startTimerForCard(c); // скан таймера: отсчёт стартует сразу (если уже шёл — заново)
    else evLog(cardTitle(c)); // предмет и прочие карточки: в журнал — название
    showCardOverlay(c);
  }
  function openDatedNoteFromScan(c){ openTodayFromScan(c.id); }
  function openTodayFromScan(id){
    evLog("Сегодня");
    if(standalone){
      // окно ярлыка: открываем приложение тем же входом (mode "note"), заметку создаст страница приложения
      if(nativeScan && nativeScan.openInApp){ try{ nativeScan.openInApp(id || TODAY_NATIVE_ID, "note"); }catch(e){} }
      leaveStandalone();
      return;
    }
    endScanSession(false);
    createDatedNoteWhenReady(0);
  }
  // Новая ОБЫЧНАЯ заметка блокнота (вкладка «Мои заметки», не скрытая заметка карточки) с сегодняшней датой в имени, в папке notes
  // в корне; сразу открывается на редактирование. На холодном старте заметки могут быть ещё не загружены — ждём.
  function createDatedNoteWhenReady(n){
    var md = getMdEditor();
    if(n === 0 && deps.openNotesTab){ try{ deps.openNotesTab(); }catch(e){} }
    if(md && md.createDatedNote && md.createDatedNote()) return;
    if(n < 25){ setTimeout(function(){ createDatedNoteWhenReady(n + 1); }, 300); return; }
    alert("Заметки ещё не готовы: нужна настроенная синхронизация.");
  }

  // ---------- «Напоминалка»: случайное напоминание из вкладки «Комментарии» ----------
  // Комментарии лежат в общем состоянии приложения (localStorage `bibleReadingProgress_v2`, записи `comment:<id>` = {c:{text}, t}),
  // его читает и окно ярлыка scan.html (там my.js нет). Выбор — «лотерейные бочонки»: в `reminderBag_v1` помнится, какие уже
  // показаны в этом круге ({shown:[id…], last}); каждый раз вынимается случайный из ещё не показанных; когда показаны все,
  // круг начинается заново (первое — снова случайное, но не то же самое, что показано последним, если комментариев больше одного).
  // Новые комментарии сами попадают в «не показанные», удалённые из учёта выпадают.
  var STATE_STORAGE_KEY = "bibleReadingProgress_v2";
  var REMINDER_BAG_KEY = "reminderBag_v1";
  function cleanReminderText(t){
    return String(t || "")
      .replace(/!\[\[[^\]\n]*\]\]/g, "")        // картинки ![[имя]] в слой не берём
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/==([^=\n]+)==/g, "$1")
      .replace(/~~([^~\n]+)~~/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function reminderPool(){
    var st = {};
    try{ st = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY) || "{}") || {}; }catch(e){ st = {}; }
    var list = [];
    Object.keys(st).forEach(function(k){
      if(k.indexOf("comment:") !== 0) return;
      var rec = st[k];
      var text = rec && rec.c && typeof rec.c.text === "string" ? cleanReminderText(rec.c.text) : "";
      if(text) list.push({ id: k.slice(8), text: text });
    });
    return list;
  }
  function pickReminder(){
    var pool = reminderPool();
    if(!pool.length) return null;
    var bag = {};
    try{ bag = JSON.parse(localStorage.getItem(REMINDER_BAG_KEY) || "{}") || {}; }catch(e){ bag = {}; }
    if(!bag || typeof bag !== "object") bag = {};
    var inPool = {};
    pool.forEach(function(r){ inPool[r.id] = true; });
    var shown = (Array.isArray(bag.shown) ? bag.shown : []).filter(function(id){ return inPool[id]; });
    var left = pool.filter(function(r){ return shown.indexOf(r.id) < 0; });
    if(!left.length){ // вынуты все — бочонки снова в мешок, новый круг
      shown = [];
      left = pool.filter(function(r){ return pool.length < 2 || r.id !== bag.last; });
    }
    var pick = left[Math.floor(Math.random() * left.length)];
    shown.push(pick.id);
    try{ localStorage.setItem(REMINDER_BAG_KEY, JSON.stringify({ shown: shown, last: pick.id })); }catch(e){}
    return pick;
  }
  // слой с карточкой-текстом поверх приложения или рабочего стола; тап мимо карточки закрывает (как у остальных слоёв скана)
  function showReminderOverlay(){
    evLog("Напоминалка");
    var pick = pickReminder();
    if(!pick){ showNoticeOverlay({ kind: "noreminders" }); return; }
    var o = newOverlay();
    var card = document.createElement("div");
    card.className = "scan-reminder-card";
    card.addEventListener("click", function(e){ e.stopPropagation(); });
    var txt = document.createElement("div");
    txt.className = "scan-reminder-text";
    txt.textContent = pick.text;
    card.appendChild(txt);
    o.appendChild(card);
    if(isLegacyAnim()){ o.style.animation = "none"; card.style.animation = "none"; } // Android 5: без анимации
  }


  function newOverlay(){
    closeOverlayEl();
    var o = document.createElement("div");
    o.className = "scan-card-overlay";
    // тап мимо карточки закрывает показ (из приложения — назад на вкладку 9, из ярлыка — на рабочий стол)
    o.addEventListener("click", function(){ endScanSession(true); });
    document.body.appendChild(o);
    overlayEl = o;
    return o;
  }
  // ширина карточки при сканировании: почти вся ширина экрана с полями, на низком экране ограничена высотой
  function overlayCardWidth(){
    var vw = window.innerWidth || 360, vh = window.innerHeight || 640;
    return Math.max(120, Math.floor(Math.min(vw - 32, (vh - 120) / (4 / 3), 480))); // высота карточки = ширина × 4/3 (3:4)
  }
  function showCardOverlay(c, noteText){
    ensureHabitStyles();
    var o = newOverlay();
    var card = document.createElement("div");
    card.className = "item-card item-card-" + c.type + " scan-card";
    card.style.setProperty("--item-card-w", overlayCardWidth() + "px");
    // цвет карточки при сканировании НЕ применяется: показ всегда цвета холста (.scan-card), что бы ни было выбрано в сетке
    card.innerHTML = '<div class="item-card-front">' + cardFrontHtml(c) + '</div>';
    card.querySelector(".item-card-title").textContent = cardTitle(c);
    card.addEventListener("click", function(e){
      e.stopPropagation();
      if(c.type === "timer" && e.target.closest(".item-card-start-btn")) startTimerForCard(c); // «Пуск» на показе: заново
      if(c.type === "timer" && e.target.closest(".item-card-stop-btn")) stopTimerForCard(c); // «Стоп» на показе
    });
    o.appendChild(card);
    if(noteText){
      var noteEl = document.createElement("div");
      noteEl.className = "habit-scan-note";
      noteEl.textContent = noteText;
      o.appendChild(noteEl);
    }
    if(c.type === "timer") syncTimersView();
    if(isLegacyAnim()){ o.style.animation = "none"; card.style.animation = "none"; } // Android 5: без анимации
    if(c.type === "item"){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "scan-card-today-btn";
      b.title = "Поставить сегодняшнюю дату";
      b.innerHTML = TODAY_ICON_SVG;
      b.addEventListener("click", function(e){
        e.stopPropagation();
        reloadCards();
        var cur = findCard(c.id);
        if(!cur) return;
        cur.date = todayIso();
        cur.updatedAt = Date.now();
        saveCards();
        scanDirty = true;
        var d = card.querySelector(".item-card-date");
        if(d) d.textContent = isoToRu(cur.date);
      });
      o.appendChild(b);
    }
  }
  function showNoticeOverlay(info){
    var o = newOverlay();
    var box = document.createElement("div");
    box.className = "scan-notice";
    box.addEventListener("click", function(e){ e.stopPropagation(); });
    var msg = document.createElement("div");
    msg.className = "scan-notice-text";
    var btns = document.createElement("div");
    btns.className = "scan-notice-buttons";
    function addBtn(label, fn){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "workbooks-run-btn";
      b.textContent = label;
      b.addEventListener("click", fn);
      btns.appendChild(b);
    }
    if(info.kind === "missing"){
      msg.textContent = "Карточка не найдена. Возможно, ещё не синхронизирована.";
      addBtn("Создать карточку с этим кодом", function(){
        if(standalone){
          if(nativeScan && nativeScan.openInApp){ try{ nativeScan.openInApp(info.id, "create"); }catch(e){} }
          leaveStandalone();
          return;
        }
        endScanSession(false);
        openTypeChooser(info.id);
      });
    } else if(info.kind === "url"){
      msg.textContent = info.url;
      msg.classList.add("scan-notice-url");
      addBtn("Открыть", function(){
        if(standalone && nativeScan && nativeScan.openUrl){ try{ nativeScan.openUrl(info.url); }catch(e){} leaveStandalone(); return; }
        openExternalUrl(info.url);
        endScanSession(true);
      });
    } else if(info.kind === "noreminders"){
      msg.textContent = "Напоминаний пока нет. Добавьте комментарии на вкладке «Комментарии».";
    } else {
      msg.textContent = info.kind === "unknown"
        ? "Код не поддерживается этой версией приложения: " + (info.text || "")
        : (info.text || "Код пустой.");
      msg.classList.add("scan-notice-url");
    }
    addBtn("Закрыть", function(){ endScanSession(true); });
    box.appendChild(msg);
    box.appendChild(btns);
    o.appendChild(box);
  }
  function openExternalUrl(url){
    var a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // выбор типа для карточки под уже напечатанный код (id не найден на устройстве)
  function openTypeChooser(forcedId){
    screenMode = "form";
    var el = container();
    if(!el) return;
    el.innerHTML = '<div class="mdeditor-tab item-card-form" id="itemCardForm">' +
      '<h3 class="common-tab-title">Новая карточка</h3>' +
      '<div class="item-form-buttons item-form-types">' +
        '<button type="button" class="workbooks-run-btn" data-type="timer">Таймер</button>' +
        '<button type="button" class="workbooks-run-btn" data-type="item">Предмет</button>' +
        '<button type="button" class="workbooks-run-btn" data-type="habit">Привычка</button>' +
      '</div>' +
      '<div class="item-form-buttons"><button type="button" class="workbooks-run-btn" id="icfTypeCancel">Отмена</button></div>' +
    '</div>';
    el.addEventListener("click", function onClick(e){
      var b = e.target.closest("button[data-type]");
      if(!b) return;
      el.removeEventListener("click", onClick);
      openForm(b.dataset.type, null, forcedId);
    });
    document.getElementById("icfTypeCancel").addEventListener("click", function(){ renderGrid(); });
    if(window.AppNav) window.AppNav.push(function(){ renderGrid(); });
  }

  // заметка по скану её QR (`lt://v1/note/<id>`): на холодном старте приложения заметки могут быть ещё не загружены — ждём
  function openNoteByQrWhenReady(id, n){
    var md = getMdEditor();
    if(n === 0 && deps.openNotesTab){ try{ deps.openNotesTab(); }catch(e){} }
    if(md && md.openNoteByQr && md.openNoteByQr(id)){
      var nm = "";
      try{ (md.getSearchableNotes() || []).forEach(function(x){ if(x.id === id) nm = x.name; }); }catch(e){}
      evLog(nm ? ("Открыта заметка «" + nm + "»") : "Открыта заметка по QR-коду");
      return;
    }
    if(n < 25){ setTimeout(function(){ openNoteByQrWhenReady(id, n + 1); }, 300); return; }
    alert("Заметка не найдена на этом устройстве. Возможно, ещё не синхронизирована.");
  }
  // скан QR заметки: из окна ярлыка открываем приложение тем же входом, что у «Сегодня» (mode "note"), иначе открываем сразу
  function openScannedNote(id){
    if(standalone){
      if(nativeScan && nativeScan.openInApp){ try{ nativeScan.openInApp(id, "note"); }catch(e){} }
      leaveStandalone();
      return;
    }
    endScanSession(false);
    openNoteByQrWhenReady(id, 0);
  }

  // вход из оболочки (ScanActivity → MainActivity): mode "note" — «Сегодня» (id карточки) либо заметка по QR (id заметки),
  // "create" — создать карточку с этим id (код уже напечатан)
  function openCardFromNative(id, mode){
    if(mode === "note" && id === TASK_NATIVE_ID){ drainPendingTasks(); return; } // «Создавать задачу», отсканированный в окне ярлыка
    if(mode === "note" && id === TODAY_NATIVE_ID){ createDatedNoteWhenReady(0); return; } // общий код «Сегодня» из окна ярлыка
    reloadCards();
    var c = findCard(id);
    if(mode === "create" && !c){ openTypeChooser(id); return; }
    if(mode === "note" && c && c.type === "datenote"){ createDatedNoteWhenReady(0); return; } // скан «Сегодня» из окна ярлыка
    if(mode === "note" && !c){ openNoteByQrWhenReady(id, 0); return; } // id не карточки — id заметки из QR (скан в окне ярлыка)
    renderGrid();
  }

  // страница scan.html: сразу сканер, результат — на прозрачном фоне поверх рабочего стола
  function startStandaloneScan(){
    reloadCards();
    openScan();
  }

  // ---------- вход вкладки ----------
  function renderSettingsTabItemCards(){
    flippedId = null;
    typeMenuOpen = false;
    cardsCache = null; // записи могла изменить страница scan.html (кнопка «сегодняшняя дата»)
    renderGrid();
    cloudSyncOnEnter();
  }

  return {
    renderSettingsTabItemCards: renderSettingsTabItemCards,
    openScan: openScan,
    getRemindableCards: getRemindableCards,
    focusCard: focusCard,
    openCardFromNative: openCardFromNative,
    startStandaloneScan: startStandaloneScan,
    getCards: function(){ return loadCards().slice(); },
    qrTextForId: function(id){ return QR_PREFIX + id; }
  };
};
