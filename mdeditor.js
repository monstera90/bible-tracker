/* ===========================================================================
   mdeditor.js
   Вкладка "Мой блокнот" (первая боковая вкладка второго набора,
   settingsTabSet2Btn1 / "set2s_1") — работа с .md заметками в стиле
   Obsidian. Вынесена в отдельный файл по тому же образцу, что и
   Workbooks/JwlMerge/EpubSplit/ImgResize (см. my.js).

   Коротко о принципе редактора (подробности — в исходном ТЗ):
   один и тот же документ показывается в двух режимах ("без кода" и "с
   кодом") БЕЗ переключения между textarea и HTML-рендером — это одно и то
   же поле CodeMirror 6, режим "без кода" просто включает decorations,
   которые визуально скрывают служебные символы разметки (**, [[, ]], ==,
   #, >) и стилизуют содержимое, не трогая сам текст документа. Именно поэтому
   при переключении режима нет "скачков" — позиция курсора и видимая
   область не пересчитываются, потому что документ не меняется, меняется
   только его декорирование.

   Decorations всегда считаются от содержимого документа, а не от того, где
   сейчас стоит курсор (в отличие от настоящего Obsidian): открытая
   [[ссылка]] или **жирный текст** остаются decorированными, даже если
   курсор внутри них — почитать/убрать служебные символы можно, переключив
   документ в режим "с кодом". Это осознанное упрощение (см. ТЗ).

   CodeMirror 6 подключается динамически (dynamic import()) с esm.sh —
   пакетов ровно три: @codemirror/state, @codemirror/view,
   @codemirror/commands (без @codemirror/lang-markdown — разметка достаточно
   простая и разбирается собственными регулярками, см. ниже), версии
   зафиксированы через ?deps=, чтобы esm.sh не подтянул конфликтующие
   версии @codemirror/state под /view и /commands.
   =========================================================================== */


window.initMdEditorModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml;
  var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG;
  // распознавание ссылок на Библию (то же, что и в "Карте дней года", см.
  // SCRIPTURE_RE/BOOK_ALIASES/scriptureRefLink в my.js) — regexSource
  // приходит строкой, здесь собирается СВОЙ экземпляр RegExp с флагом "g",
  // чтобы не делить mutable lastIndex с регэкспом из my.js.
  var SCRIPTURE_RE = deps.scriptureRegexSource ? new RegExp(deps.scriptureRegexSource, "g") : null;
  var BOOK_ALIASES = deps.bookAliases || null;
  var scriptureRefLink = deps.scriptureRefLink || null;
  // для задач формата "- [ ] текст" в режиме "без кода" (см.
  // TaskActionsWidget/decorateLine в makeLivePreviewExtension ниже) — те же
  // иконки и действия, что и у обычных задач на вкладках задач (см. ТЗ
  // пользователя от 30.08: кнопки/разделители как во вкладках задач,
  // перенос ОДНОСТОРОННИЙ, отметка "[x]" отправляет в архив).
  var CHECK_ICON_SVG = deps.CHECK_ICON_SVG || "";
  var ARROW_MOVE_ICON_SVG = deps.ARROW_MOVE_ICON_SVG || "";
  // крестик удаления заметки в общем списке (см. renderListScreen ниже) —
  // та же иконка, что и у "Удалить навсегда" в архиве задач (my.js),
  // передана через deps, а не своя копия.
  var DELETE_ICON_SVG = deps.DELETE_ICON_SVG || "";
  var createArchivedTaskWithText = deps.createArchivedTaskWithText || null;
  var openTaskMoveTargetPicker = deps.openTaskMoveTargetPicker || null;
  var refitAllVisibleTaskBodies = deps.refitAllVisibleTaskBodies || function(){};
  var getSyncedBookmarkNames = deps.getSyncedBookmarkNames || function(){ return []; };
  var setSyncedBookmark = deps.setSyncedBookmark || function(){};
  var recordNoteCreated = deps.recordNoteCreated || function(){};
  // ---------------------------------------------------------------------
  // ОБЛАЧНОЕ ХРАНЕНИЕ ЗАМЕТОК С ШИФРОВАНИЕМ (см. TASK_MDNOTES_CLOUD.md,
  // шаг 1 "Ядро", 05.09). Firebase-специфика (URL, /syncs/<id>) осознанно
  // остаётся внутри my.js — сюда передаются только узкие функции, уже
  // привязанные к ветке /notes(Meta) ТЕКУЩЕГО syncId устройства (раздел 2
  // ТЗ: "свой fetchCloudBlob-подобный запрос для /notes").
  // ---------------------------------------------------------------------
  var getSyncId = deps.getSyncId || function(){ return null; };
  var openSyncModal = deps.openSyncModal || function(){};
  var fetchCloudPath = deps.fetchCloudPath || function(){ return Promise.reject(new Error("no_sync")); };
  var patchCloud = deps.patchCloud || function(){ return Promise.reject(new Error("no_sync")); };
  var deleteCloudPath = deps.deleteCloudPath || function(){ return Promise.reject(new Error("no_sync")); };
  var generateId = deps.generateId || function(){ return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2,10); };
  var NOTES_PUSH_DEBOUNCE_MS = deps.notesPushDebounceMs || 400;
  var NOTES_RETRY_DELAYS = deps.notesRetryDelays || [5000, 15000, 40000, 90000];
  function isOnline(){ return navigator.onLine; }
  // Импорт/экспорт .md/.zip заметок (TASK_MDNOTES_CLOUD.md, шаг 2) —
  // используем общий самописный ZIP-парсер проекта напрямую через window,
  // тем же способом, каким его используют workbooks.js/s89fill.js (свой
  // экземпляр deps сюда не заводим, MiniZip — общая утилита без состояния).
  var MiniZip = window.MiniZip || null;

  // ---------------------------------------------------------------------
  // Метаданные заметки (дата создания/редактирования[/открытия]) — ТЗ
  // пользователя от 04.09, дата открытия добавлена 05.09. Хранятся ПЕРВОЙ
  // строкой самого .md файла в служебном формате
  // "%%meta:ДД.ММ.ГГГГ:ДД.ММ.ГГГГ[:ДД.ММ.ГГГГ]%%" (создание:редактирование
  // [:открытие]) — часть обычного документа CodeMirror, поэтому видны как
  // есть в режиме "с кодом" и скрываются decoration'ом в режиме "без кода"
  // (см. decorateLine/META_LINE_RE ниже в makeLivePreviewExtension). Само
  // поле над текстом заметки (#mdEditorDatesRow, см. renderEditorScreen) —
  // это ОТДЕЛЬНЫЙ, нередактируемый элемент интерфейса, просто прочитавший
  // эти даты; сама строка метаданных не редактируется вручную.
  //
  // "%%...%%" — родной синтаксис комментария Obsidian (скрыт в Reading
  // View, виден серым в Source/Live Preview), поэтому сама эта строка не
  // портит открытие заметок в настоящем Obsidian. Но это ОБЫЧНАЯ первая
  // строка документа, а не YAML frontmatter (не "---"), поэтому если у
  // заметки, перенесённой из Obsidian, УЖЕ есть свой frontmatter
  // ("---\n...\n---" первой секцией) — при первом автосохранении здесь
  // (см. flushAutosaveNow) наша строка допишется ПЕРЕД ним, и Obsidian
  // перестанет распознавать этот frontmatter как properties (первой
  // строкой файла у него по спецификации должно быть "---"). На сами
  // данные пользователя это не влияет (ничего не удаляется, страница
  // читается как обычный текст), но это стоит иметь в виду при переносе
  // существующего Obsidian-vault — при желании можно отдельно обсудить
  // защиту от этого случая.
  //
  // Дата открытия НЕ показывается пользователю нигде в интерфейсе (ТЗ
  // 05.09) — только хранится на будущее внутри самого файла (третье поле)
  // и используется для сортировки "Забытых заметок" через быстрый
  // отдельный индекс (см. openedIndex ниже), а не через чтение этого поля
  // из каждого файла на диске.
  //
  // Заметки, созданные ДО появления этой функции, не трогаются на диске,
  // пока их не откроют и не отредактируют хотя бы раз (см. ТЗ) — метаданные
  // им проставляются при первом реальном автосохранении текста (см.
  // flushAutosaveNow). До этого момента в поле дат используется виртуальная
  // "давность 6 месяцев" — см. LEGACY_META_DATE_RU/virtualLegacyDatePairRu()
  // ниже. ВАЖНО (баг, найден пользователем 05.09): эта дата — ОДНА
  // ЗАФИКСИРОВАННАЯ константа (посчитана один раз, на день введения этой
  // функции), а НЕ "сегодня минус 6 месяцев" пересчитываемая каждый день —
  // иначе разные заметки, впервые открытые/отредактированные в разные дни,
  // получали бы РАЗНЫЕ "даты создания", что бессмысленно (это не настоящая
  // история, а условная общая метка "старая заметка"). В "Забытых
  // заметках" (см. virtualLegacyOpenedMs ниже) используется отдельная,
  // по-прежнему рекалькулируемая версия — там это лишь порядок сортировки,
  // а не значение, которое пишется на диск и должно быть стабильным.
  var META_LINE_RE = /^%%meta:(\d{2}\.\d{2}\.\d{4}):(\d{2}\.\d{2}\.\d{4})(?::(\d{2}\.\d{2}\.\d{4}))?%%\n?/;
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function formatDateRu(d){
    return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear();
  }
  function todayRu(){ return formatDateRu(new Date()); }
  // opened необязателен — вызовы buildMetaLine ДО появления этой функции
  // (и код, которому дата открытия не важна) продолжают писать 2-польный
  // формат; следующее реальное автосохранение (flushAutosaveNow) само
  // допишет 3-е поле.
  function buildMetaLine(created, updated, opened){
    return "%%meta:" + created + ":" + updated + (opened ? ":" + opened : "") + "%%\n";
  }
  // распарсенные метаданные из НАЧАЛА текста заметки, либо null, если их
  // ещё нет (старая заметка, ни разу не редактированная после появления
  // этой функции). opened === null, если заметка ещё в старом 2-польном
  // формате (записана до 05.09, но уже была хоть раз отредактирована).
  function parseNoteMeta(text){
    var m = META_LINE_RE.exec(text || "");
    if(!m) return null;
    return { created: m[1], updated: m[2], opened: m[3] || null, raw: m[0] };
  }
  // Фиксированная дата-заглушка для старых заметок без метастроки —
  // посчитана ОДИН РАЗ (день введения этой функции, 05.09.2026, минус
  // 6 месяцев) и одинакова для всех таких заметок, когда бы их ни открыли
  // или отредактировали (см. пояснение выше). Раньше пересчитывалась как
  // "сегодня минус 6 месяцев" при каждом вызове — из-за этого разные
  // заметки получали разные "даты создания" в зависимости от дня первого
  // редактирования (баг, найден пользователем 05.09).
  var LEGACY_META_DATE_RU = "05.03.2026";
  // виртуальная пара дат для заметок без метаданных — см. пояснение выше
  function virtualLegacyDatePairRu(){
    return { created: LEGACY_META_DATE_RU, updated: LEGACY_META_DATE_RU };
  }
  // то же самое, но как ms-таймстамп — для заметок без записи в openedIndex
  // (см. loadForgottenNotesData ниже)
  function virtualLegacyOpenedMs(){
    var d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.getTime();
  }
  // даты заметки для отображения/расчётов — реальные метаданные, если они
  // есть, иначе виртуальная "давность 6 месяцев" (см. выше)
  function getNoteDatesRu(text){
    var meta = parseNoteMeta(text);
    return meta ? { created: meta.created, updated: meta.updated } : virtualLegacyDatePairRu();
  }
  // разбор "ДД.ММ.ГГГГ" в Date (полночь) — нужен для сравнения давности
  // (см. "Забытые заметки", renderSettingsTabForgottenNotes ниже)
  function parseRuDate(s){
    var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || "");
    if(!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  // Ищет библейскую ссылку в строке, под которой находится offset (символ
  // клика) — используется и для decorations (см. makeLivePreviewExtension),
  // и для обработки клика (см. handleMouseDown).
  function findScriptureRefAt(lineText, offset){
    if(!SCRIPTURE_RE) return null;
    SCRIPTURE_RE.lastIndex = 0;
    var m;
    while((m = SCRIPTURE_RE.exec(lineText))){
      var a = m.index, b = a + m[0].length;
      if(offset >= a && offset <= b) return m;
      if(m[0].length === 0) SCRIPTURE_RE.lastIndex++;
    }
    return null;
  }

  // Открывает найденную ссылку тем же способом, что и обычные внешние
  // ссылки/ссылки на Библию в остальном приложении (target="_blank") —
  // сама ссылка ведёт на jw.org finder, который на устройстве с
  // установленной JW Library открывается в ней (та же схема, что уже
  // работает в "Карте дней года"). Если в найденной ссылке нет номера
  // стиха (просто "Книга 6" или диапазон глав "Книга 6-7" без двоеточия) —
  // scriptureRefLink сама открывает всю первую главу целиком (см. её
  // определение в my.js).
  function openScriptureLink(m){
    if(!BOOK_ALIASES || !scriptureRefLink) return;
    var canonical = BOOK_ALIASES[m[1]];
    if(!canonical) return;
    var link = scriptureRefLink(canonical, Number(m[2]), m[3] ? Number(m[3]) : undefined, m[4] ? Number(m[4]) : undefined);
    if(link) window.open(link, "_blank", "noopener,noreferrer");
  }

  // ---------------------------------------------------------------------
  // Пиктограммы (тот же стиль, что и у остальных вкладок: viewBox 24×24,
  // stroke="currentColor")
  // ---------------------------------------------------------------------
  var HOME_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 11.5L12 4l8 7.5"></path>' +
      '<path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"></path>' +
      '<path d="M10 20v-5h4v5"></path>' +
    '</svg>';
  // закладка (лента/флажок) — единая пиктограмма для ВСЕХ мест, где можно
  // добавить заметку в закладки или увидеть, что она уже там (см. ТЗ
  // пользователя: "пусть пиктограмма активной закладки будет везде
  // одинаковой") — строка списка (после долгого нажатия, см.
  // renderListScreen), шапка открытой заметки (renderEditorScreen) и сама
  // вкладка "Закладки" (renderBookmarksScreen). Активное/неактивное
  // состояние — не отдельная иконка, а инверсия заливки (см.
  // .mdeditor-bookmark-btn.active в components.css: пустой контур —
  // не в закладках, залитый — в закладках).
  var BOOKMARK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4-6.5 4V4.5a1 1 0 0 1 1-1z"></path>' +
    '</svg>';
  // папка — переиспользуем ровно тот же контур, что и у вкладки-заглушки
  // "projects" (#settingsTabProjectsBtn в index.html), для единообразия
  var FOLDER_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z"></path>' +
    '</svg>';
  var FILE_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path>' +
      '<path d="M15 3v4h4"></path>' +
      '<line x1="7.5" y1="11" x2="14" y2="11"></line>' +
      '<line x1="7.5" y1="15" x2="14" y2="15"></line>' +
    '</svg>';
  // картинка — для строк-изображений в списке (та же папка, где лежат
  // .md заметки) и как заглушка-иконка, пока сама картинка не загрузилась
  var IMAGE_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="18" height="16" rx="2"></rect>' +
      '<circle cx="8.5" cy="9.5" r="1.6"></circle>' +
      '<path d="M21 16l-5.5-5.5a1.5 1.5 0 0 0-2.1 0L4 20"></path>' +
    '</svg>';
  // "код" — переключиться в режим "с кодом" (показан, когда сейчас активен
  // режим "без кода")
  var CODE_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 6l-5.5 6L9 18"></path>' +
      '<path d="M15 6l5.5 6-5.5 6"></path>' +
    '</svg>';
  // "глаз" — переключиться в режим "без кода" (показан, когда сейчас
  // активен режим "с кодом")
  var EYE_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2 12c2.5-5 7-8 10-8s7.5 3 10 8c-2.5 5-7 8-10 8s-7.5-3-10-8z"></path>' +
      '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>';
  // "+" — кнопка "новая заметка" в ряду плавающих кнопок списка (см.
  // renderListScreen/openNewNoteDialog ниже, ТЗ пользователя от 05.09),
  // слева от домика.
  var PLUS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="12" y1="5" x2="12" y2="19"></line>' +
      '<line x1="5" y1="12" x2="19" y2="12"></line>' +
    '</svg>';
  // корзина — кнопка "удалить неиспользуемые файлы" (см. openCleanupDialog
  // ниже, ТЗ пользователя от 04.09), только в корне списка
  var TRASH_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 7h16"></path>' +
      '<path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"></path>' +
      '<path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"></path>' +
      '<path d="M10 11v6"></path>' +
      '<path d="M14 11v6"></path>' +
    '</svg>';
  // стрелка вниз в лоток — "скачать" (см. downloadSingleNote/downloadAllNotesZip
  // ниже, ТЗ TASK_MDNOTES_CLOUD.md раздел 6): одна и та же пиктограмма для
  // скачивания и одной заметки (кнопка в шапке открытой заметки), и всего
  // блокнота целиком (кнопка внизу общего списка).
  var DOWNLOAD_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3v11"></path>' +
      '<path d="M7.5 10.5L12 15l4.5-4.5"></path>' +
      '<path d="M4.5 18.5h15"></path>' +
    '</svg>';

  // ---------------------------------------------------------------------
  // IndexedDB — хранение directory handle между сессиями. FileSystem*Handle
  // структурно клонируем, поэтому его можно класть в IndexedDB напрямую.
  // ---------------------------------------------------------------------
  var DB_NAME = "mdEditorDB", STORE_NAME = "handles";
  // Соединение открывается один раз и переиспользуется всеми idbGet/idbSet
  // за сессию — раньше indexedDB.open() вызывался заново на КАЖДЫЙ вызов
  // (а их немало уже при самом старте: fontSizeStep, bookmarks, root,
  // теперь ещё и treeShape ниже), это лишний асинхронный круг на пустом
  // месте (см. ТЗ пользователя от 31.08). При ошибке открытия dbPromise
  // сбрасывается, чтобы следующий вызов мог попробовать снова, а не
  // навсегда застрять с отклонённым промисом.
  var dbPromise = null;
  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }
  function idbGet(key){
    return openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, "readonly");
        var r = tx.objectStore(STORE_NAME).get(key);
        r.onsuccess = function(){ resolve(r.result || null); };
        r.onerror = function(){ reject(r.error); };
      });
    }).catch(function(){ return null; });
  }
  function idbSet(key, value){
    return openDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ reject(tx.error); };
      });
    });
  }

  // ---------------------------------------------------------------------
  // Индекс дат открытия заметок (ТЗ пользователя от 05.09) — один маленький
  // объект { "имя заметки в нижнем регистре": ms-таймстамп } в IndexedDB
  // (ключ OPENED_INDEX_KEY), а не отдельный файл на диске через SAF: сама
  // задача была в том, чтобы "Забытые заметки" не трогали диск на каждый
  // файл (см. loadForgottenNotesData ниже) — чтение ОДНОГО ключа
  // IndexedDB кардинально быстрее, чем 315 отдельных getFile() через
  // SAF-провайдер, и укладывается в доли секунды. Дублирующая копия даты
  // открытия ВНУТРИ самого .md файла (3-е поле строки метаданных, см.
  // buildMetaLine/parseNoteMeta выше) пишется на будущее (на случай,
  // если этот индекс когда-то понадобится восстановить) — но пишется не
  // сразу при открытии (это означало бы диск-запись на каждый простой
  // просмотр заметки), а заодно со следующим реальным автосохранением
  // текста (см. flushAutosaveNow), так что может немного отставать от
  // реальной последней даты открытия — это нормально, авторитетный
  // источник для сортировки и для счётчика "N/M" — именно этот индекс,
  // а не содержимое файлов.
  var OPENED_INDEX_KEY = "openedIndex";
  var openedIndexCache = null;    // объект после первой загрузки за сессию
  var openedIndexLoadPromise = null;
  function loadOpenedIndex(){
    if(openedIndexCache) return Promise.resolve(openedIndexCache);
    if(!openedIndexLoadPromise){
      openedIndexLoadPromise = idbGet(OPENED_INDEX_KEY).then(function(v){
        openedIndexCache = (v && typeof v === "object") ? v : {};
        openedIndexLoadPromise = null;
        return openedIndexCache;
      });
    }
    return openedIndexLoadPromise;
  }
  // вызывается из openNoteByEntry/createAndOpenNote при каждом открытии —
  // не блокирует открытие заметки (запись в IndexedDB уходит в фоне);
  // ошибка записи молча игнорируется (не критично — при следующем
  // открытии "Забытых" просто останется чуть более старая метка)
  function recordNoteOpened(name){
    var key = (name || "").toLowerCase();
    if(!key) return;
    loadOpenedIndex().then(function(idx){
      idx[key] = Date.now();
      idbSet(OPENED_INDEX_KEY, idx).catch(function(){});
    });
  }

  // ---------------------------------------------------------------------
  // Динамическая загрузка CodeMirror 6 (один раз на сессию)
  // ---------------------------------------------------------------------
  var cmModules = null, cmModulesPromise = null;
  function loadCM(){
    if(cmModulesPromise) return cmModulesPromise;
    cmModulesPromise = Promise.all([
      import("https://esm.sh/@codemirror/state@6"),
      import("https://esm.sh/@codemirror/view@6?deps=@codemirror/state@6"),
      import("https://esm.sh/@codemirror/commands@6?deps=@codemirror/state@6,@codemirror/view@6")
    ]).then(function(mods){
      cmModules = { state: mods[0], view: mods[1], commands: mods[2] };
      return cmModules;
    });
    return cmModulesPromise;
  }

  // ---------------------------------------------------------------------
  // Состояние модуля (живёт между переключениями вкладок в рамках одной
  // открытой страницы — так же, как у настоящего Obsidian, вкладка не
  // "забывает" открытую заметку, просто уходя на соседнюю вкладку настроек)
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Состояние модуля (живёт между переключениями вкладок в рамках одной
  // открытой страницы). ЗАМЕТКИ (см. TASK_MDNOTES_CLOUD.md) — единственный
  // источник истины: notesMap, Map noteId -> {id,name,path,text,t,deleted}.
  // Дерево папок каждый раз ПЕРЕСТРАИВАЕТСЯ из notesMap (см.
  // buildTreeFromNotes ниже), а не обходом файловой системы, как раньше.
  // ---------------------------------------------------------------------
  var initStarted = false;
  var notesReady = false;        // true после первой загрузки локального кэша заметок
  // Кэш грузится сразу при старте модуля (см. preloadNotesCache/вызов внизу
  // файла), а не лениво по первому открытию вкладки, как было раньше —
  // иначе "Мой блокнот" был единственным местом в приложении, где список
  // на экране не появлялся мгновенно (задачи всегда доступны сразу, т.к.
  // их state читается синхронно из localStorage при загрузке страницы;
  // у заметок IndexedDB асинхронна по своей природе, но раз она стартует
  // заранее, к моменту реального открытия вкладки уже готова).
  var notesMap = new Map();
  var rootTree = null;           // {name, path, folders:[...], files:[{name,id}], parent}
  var currentDirNode = null;     // текущая открытая "папка" в списке
  var nameIndex = new Map();     // имя_в_нижнем_регистре -> noteId (уникальность имени по всему дереву, раздел 2 ТЗ)
  // Индекс картинок (TASK_MDNOTES_CLOUD.md, шаг 3, 05.09) —
  // имя_в_нижнем_регистре -> {handle: FileSystemFileHandle, name}, строится
  // рекурсивным обходом отдельной папки с изображениями (см.
  // buildImageIndex/imagesDirHandle ниже). До первого подключения папки (или
  // пока не подтверждены права после перезапуска) остаётся пустым — decorations
  // (см. makeLivePreviewExtension) ничего не находят и показывают плейсхолдер
  // "не найдено" (см. loadImageInto/ImageWidget).
  var imageIndex = new Map();
  var imageUrlCache = new Map();
  var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  // ---------------------------------------------------------------------
  // Отдельная папка с локальными изображениями (раздел 8 ТЗ) — независима
  // от облачного хранения текста заметок: картинки НИКОГДА не идут в
  // Firebase (лимит бесплатного Storage мал и платный), между устройствами
  // пользователь переносит их сам (Syncthing и т.п.). Доступ — тот же
  // File System Access API, что раньше использовался для папки самих
  // заметок (см. историю проекта), но теперь только для картинок и с
  // правами "readwrite" (нужны для автономной корзины сирот, раздел 10).
  // ---------------------------------------------------------------------
  var imagesDirHandle = null;      // FileSystemDirectoryHandle | null
  var imagesDirName = null;        // handle.name, для показа в кнопке
  var imagesDirPermission = "none"; // "none" (нет сохранённого handle) | "prompt" | "denied" | "granted"
  var imageIndexBuilt = false;     // хоть раз просканировали успешно
  var imageIndexBuilding = false;
  // реестр смонтированных DOM-узлов картинки/плейсхолдера — тем же приёмом,
  // что и linkNodesByHref у ссылок (см. ниже, makeLivePreviewExtension):
  // позволяет ПОДМЕНИТЬ плейсхолдер на настоящую картинку на месте, без
  // пересборки decorations, когда папка подключается уже после того, как
  // заметка отрисована (раздел 9 ТЗ: "без перезагрузки заметки целиком").
  var imageNodesByName = new Map(); // имя_в_нижнем_регистре -> Set<{wrap, img}>
  function registerImageNode(name, entry){
    var set = imageNodesByName.get(name);
    if(!set){ set = new Set(); imageNodesByName.set(name, set); }
    set.add(entry);
  }
  function unregisterImageNode(name, entry){
    var set = imageNodesByName.get(name);
    if(set){ set.delete(entry); if(!set.size) imageNodesByName.delete(name); }
  }
  var IMAGES_DIR_HANDLE_KEY = "imagesDirHandle";
  var IMAGES_WARNED_KEY = "imagesCleanupWarned";
  var imageCleanupInFlight = false;
  // "Продолжить с той же заметки и с того же места" — по решению
  // пользователя от 05.09 (переход на облако) это ТЕПЕРЬ ЛОКАЛЬНАЯ функция
  // устройства, а не синхронизируется между устройствами (раньше ехала
  // файлом через Syncthing вместе с самими заметками — этого канала больше
  // нет). Хранится только в IndexedDB (idbSet("lastNote", ...)).
  var docState = { screen: null, id: null, name: null, cursorPos: 0, scrollPercent: null, updatedAt: 0 };
  var screen = "setup";          // "setup" (нет синхронизации/не готово) | "list" | "editor"
  var attachPickerBusy = false;
  var statusMessage = "", statusIsError = false;
  var openFile = null;           // {id,name,path,text,dirty,cursorPos,scrollPercent}
  var cmView = null;
  var mdEditorImageResizeObserver = null; // пересчёт cm-md-image-float при изменении ширины редактора, см. mountEditor/destroyEditor
  // Какая из ДВУХ боковых вкладок второго набора сейчас показывает
  // содержимое этого модуля — "editor" для "Моего блокнота" (set2s_1) и
  // "bookmarks" для вкладки "Закладки" (set2s_2). Обе вкладки делят один и
  // тот же notesMap/nameIndex/openFile.
  var activeMdTab = "editor";

  // ---- закладки заметок (см. ТЗ пользователя: вкладка "Закладки",
  // долгое нажатие в общем списке, кнопка в шапке открытой заметки) —
  // множество имён заметок в нижнем регистре (имена внутри одного
  // "блокнота" уникальны без учёта регистра, см. nameIndex/buildIndex
  // выше, поэтому имени достаточно как ключа — путь/handle не нужны,
  // сама запись при показе списка закладок ищется в nameIndex заново, см.
  // renderBookmarksScreen). Сохраняется в IndexedDB (тем же способом, что
  // и fontSizeStep/dirHandle выше), поэтому переживает перезапуск
  // приложения. ----
  var bookmarkedNames = new Set();
  // какие строки основного списка сейчас показывают кнопку закладки
  // ВРЕМЕННО, после долгого нажатия, хотя заметка ещё не добавлена в
  // закладки (см. ТЗ: "по умолчанию эта кнопка не показывается,
  // показывается только для тех заметок, которые добавлены в закладки" —
  // долгое нажатие раскрывает её для добавления). Живёт только в памяти,
  // сама принадлежность к закладкам хранится в bookmarkedNames выше.
  var revealedBookmarkRows = new Set();
  // те же долгие нажатия, но для СТРОК-ПАПОК в общем списке (см. ТЗ
  // пользователя от 06.09: крестик удаления, как у заметок, только для
  // удаления папки целиком со всем её содержимым) — отдельный Set, чтобы
  // не путать ключи с именами заметок: у папки ключ — её `path` (уникален
  // и стабилен в пределах дерева, в отличие от имени, которое не
  // проверяется на уникальность между папками).
  var revealedFolderDeleteRows = new Set();

  // Оборачивает текущее выделение в CodeMirror маркерами форматирования
  // (см. кнопки "Ж"/"К"/"П"/"Ч" в renderEditorScreen выше и ТЗ
  // пользователя от 31.08). Если выделения нет — ничего не делает
  // (оборачивать в пустые маркеры нечего). После вставки курсор/выделение
  // переносится на обёрнутый текст, чтобы можно было сразу применить ещё
  // один стиль поверх (например Ж, затем К).
  function wrapCmSelection(prefix, suffix){
    if(!cmView) return;
    var sel = cmView.state.selection.main;
    if(sel.from === sel.to) return;
    var text = cmView.state.sliceDoc(sel.from, sel.to);
    cmView.dispatch({
      changes: { from: sel.from, to: sel.to, insert: prefix + text + suffix },
      selection: { anchor: sel.from, head: sel.from + prefix.length + text.length + suffix.length }
    });
    cmView.focus();
  }

  // ---------------------------------------------------------------------
  // Папка с локальными изображениями (раздел 8 ТЗ) — подключение,
  // повторное подтверждение прав, рекурсивное сканирование, автономная
  // корзина сирот (раздел 10). Права запрашиваются в режиме "readwrite" —
  // "только чтение" хватило бы для показа картинок, но корзина ниже должна
  // уметь удалять файлы.
  // ---------------------------------------------------------------------
  var IMAGES_PERMISSION_OPTS = { mode: "readwrite" };
  // queryPermission — без пользовательского жеста (можно звать при
  // старте приложения); requestPermission требует жеста, поэтому
  // requestIfNeeded=true разрешено передавать только из обработчика клика.
  function verifyImagesPermission(handle, requestIfNeeded){
    if(!handle || !handle.queryPermission) return Promise.resolve(false);
    return handle.queryPermission(IMAGES_PERMISSION_OPTS).then(function(state){
      if(state === "granted") return true;
      if(!requestIfNeeded || !handle.requestPermission) return false;
      return handle.requestPermission(IMAGES_PERMISSION_OPTS).then(function(state2){
        return state2 === "granted";
      });
    }).catch(function(){ return false; });
  }

  // Вызывается один раз при старте модуля (см. конец файла) — молча
  // проверяет права на РАНЕЕ сохранённый handle, без системного диалога и
  // без жеста пользователя. Если прав уже нет — просто оставляет
  // imagesDirPermission не "granted"; кнопка/плейсхолдер (см. renderListScreen/
  // ImageWidget) в этом случае предложат подключить папку заново кликом.
  function loadStoredImagesDirHandle(){
    idbGet(IMAGES_DIR_HANDLE_KEY).then(function(handle){
      if(!handle){ imagesDirPermission = "none"; return; }
      imagesDirHandle = handle;
      imagesDirName = handle.name;
      return verifyImagesPermission(handle, false).then(function(ok){
        imagesDirPermission = ok ? "granted" : "prompt";
        if(ok){
          return buildImageIndex().then(maybeRunImageCleanup);
        }
      });
    }).catch(function(){});
  }

  // Рекурсивный обход папки с изображениями — собирает ПЛОСКИЙ индекс
  // имя_в_нижнем_регистре -> {handle, name} по всем вложенным подпапкам
  // (раздел 8 ТЗ: "поиск... по всем подпапкам рекурсивно"), без привязки к
  // какой-либо конкретной подпапке (в отличие от старой схемы с
  // обязательной "files"). Коллизия имени между разными подпапками
  // (одинаковое имя файла в двух местах) разрешается в пользу
  // последнего найденного — на практике это не должно происходить, т.к.
  // ![[имя]] в заметках и так не различает подпапки.
  function buildImageIndex(){
    if(!imagesDirHandle) return Promise.resolve();
    imageIndexBuilding = true;
    var newIndex = new Map();
    function walk(dirHandle){
      return dirHandle.entries ? walkEntries(dirHandle) : Promise.resolve();
    }
    async function walkEntries(dirHandle){
      for await (var entry of dirHandle.entries()){
        var name = entry[0], handle = entry[1];
        if(handle.kind === "directory"){
          await walkEntries(handle);
        } else if(handle.kind === "file" && IMAGE_EXT_RE.test(name)){
          newIndex.set(name.toLowerCase(), { handle: handle, name: name });
        }
      }
    }
    return walk(imagesDirHandle).then(function(){
      imageIndex = newIndex;
      imageIndexBuilt = true;
      imageIndexBuilding = false;
      refreshMountedImageNodes();
    }).catch(function(e){
      imageIndexBuilding = false;
      setStatus("Не удалось прочитать папку с изображениями: " + (e && e.message ? e.message : e), true);
    });
  }

  // Собирает разметку плейсхолдера прямо внутри wrapEl (переиспользуем
  // тот же <span>, а не пересоздаём его — иначе он выпал бы из
  // imageNodesByName). Форма/цвет — раздел 9 ТЗ: прямоугольник 16:9,
  // скруглённые углы, прозрачный фон, тонкая рамка в тон обычной
  // (см. .cm-md-image-missing* в components.css), без акцентного цвета
  // (это обычное ожидаемое состояние, не ошибка). Кнопка-скрепка —
  // та же иконка, что и у кнопки "прикрепить"/выбрать папку, запускает
  // (пере)подключение папки тем же путём, что и обычная кнопка в списке
  // заметок (см. reconnectImagesFolder). На уровне модуля (не внутри
  // makeLivePreviewExtension), т.к. вызывается и из ImageWidget (там), и
  // из refreshMountedImageNodes (здесь, вне CodeMirror-области видимости).
  function buildImagePlaceholder(wrapEl, name){
    wrapEl.className = "cm-md-image-wrap cm-md-image-missing";
    wrapEl.innerHTML =
      '<span class="cm-md-image-missing-caption"></span>' +
      '<button type="button" class="cm-md-image-missing-btn" title="Подключить папку с изображениями">' + PAPERCLIP_ICON_SVG + '</button>';
    wrapEl.querySelector(".cm-md-image-missing-caption").textContent = name;
    wrapEl.querySelector(".cm-md-image-missing-btn").addEventListener("click", function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      reconnectImagesFolder();
    });
  }
  // Подменяет содержимое wrapEl на настоящую картинку — общая точка и
  // для первого показа, и для "починки" плейсхолдера на месте (см.
  // refreshMountedImageNodes ниже).
  function setWrapToImage(wrapEl, url, name){
    wrapEl.className = "cm-md-image-wrap";
    wrapEl.innerHTML = "";
    var img = document.createElement("img");
    img.className = "cm-md-image";
    img.alt = name;
    // Реальный размер (а значит и решение float/block) известен только
    // после загрузки. requestAnimationFrame — чтобы clientWidth строки
    // успел посчитаться после того, как узел реально встал в DOM.
    img.addEventListener("load", function(){
      requestAnimationFrame(function(){ applyImageFloatLayout(wrapEl); });
    });
    img.src = url;
    wrapEl.appendChild(img);
    if(wrapEl.mdImageEntry) wrapEl.mdImageEntry.loaded = true;
  }
  // Множество имён, для которых сейчас уже идёт чтение файла (getFile()) —
  // ключ и здесь, и в imageUrlCache/imageIndex один и тот же
  // (имя_в_нижнем_регистре). Нужно, чтобы НЕ запускать второе параллельное
  // чтение того же файла, если loadImageInto вызвали на него ещё раз, пока
  // первое чтение не завершилось (например, из-за повторного
  // refreshMountedImageNodes — см. cleanupOrphanedImages ниже: если бы оба
  // чтения пошли параллельно с разными handle на один файл, конкурентный
  // обход директории мог подвесить оба навсегда, оставляя wrap в
  // состоянии "loading" без кнопки и без картинки).
  var imageLoadPromises = new Map();
  function loadImageInto(name, wrapEl){
    var key = name.toLowerCase();
    var cached = imageUrlCache.get(key);
    if(cached){
      if(cached.url) setWrapToImage(wrapEl, cached.url, name);
      else {
        buildImagePlaceholder(wrapEl, name);
        if(wrapEl.mdImageEntry) wrapEl.mdImageEntry.loaded = false;
      }
      return;
    }
    var found = imageIndex && imageIndex.get(key);
    if(!found){
      imageUrlCache.set(key, { error: true });
      buildImagePlaceholder(wrapEl, name);
      if(wrapEl.mdImageEntry) wrapEl.mdImageEntry.loaded = false;
      return;
    }
    wrapEl.className = "cm-md-image-wrap cm-md-image-loading";
    wrapEl.innerHTML = "";
    var pending = imageLoadPromises.get(key);
    if(!pending){
      pending = found.handle.getFile().then(function(f){
        var result = { url: URL.createObjectURL(f) };
        imageUrlCache.set(key, result);
        return result;
      }).catch(function(){
        var result = { error: true };
        imageUrlCache.set(key, result);
        return result;
      });
      pending.then(function(){ imageLoadPromises.delete(key); });
      imageLoadPromises.set(key, pending);
    }
    pending.then(function(result){
      if(result.url) setWrapToImage(wrapEl, result.url, name);
      else {
        buildImagePlaceholder(wrapEl, name);
        if(wrapEl.mdImageEntry) wrapEl.mdImageEntry.loaded = false;
      }
    });
  }

  // Точечно подгружает картинку в УЖЕ смонтированные плейсхолдеры/узлы
  // (см. imageNodesByName/registerImageNode выше) после того, как индекс
  // пересобрался — без пересборки CodeMirror decorations и без перезагрузки
  // заметки целиком (раздел 9 ТЗ). Чинит только те узлы, у которых сейчас
  // нет валидного <img> (плейсхолдер "не найдено") — уже загруженную
  // картинку трогать незачем.
  function refreshMountedImageNodes(){
    imageNodesByName.forEach(function(set, key){
      set.forEach(function(entry){
        if(entry.loaded) return;
        loadImageInto(entry.name, entry.wrap);
      });
    });
  }

  // Разовое предупреждение (раздел 8 ТЗ) — тот же приём карточки поверх
  // окна настроек, что и у остальных диалогов блокнота
  // (.mdeditor-cleanup-overlay/-card, см. openNewNoteDialog/confirmDeleteNote).
  function showImagesFirstConnectWarning(callback){
    var box = document.querySelector(".settings-modal-box");
    if(!box){ callback(true); return; }
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title">Изображения, которых нет в заметках, будут удаляться из этой папки. Продолжить?</div>' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="mdEditorImgWarnCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="mdEditorImgWarnOk">Продолжить</button>' +
      '</div>';
    overlay.appendChild(card);
    box.appendChild(overlay);
    function close(result){
      if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
      callback(result);
    }
    document.getElementById("mdEditorImgWarnCancel").addEventListener("click", function(){ close(false); });
    document.getElementById("mdEditorImgWarnOk").addEventListener("click", function(){ close(true); });
  }

  // Открывает системный диалог выбора папки. Показывает разовое
  // предупреждение ПЕРЕД первым же подключением на этом устройстве (флаг
  // в IndexedDB, раздел 8 ТЗ) — при отмене предупреждения папка не
  // сохраняется (можно попробовать снова тем же кликом). Показ
  // предупреждения не повторяется, даже если папку потом переподключат
  // заново после отзыва прав (флаг не сбрасывается). Возвращает
  // Promise<boolean> — true, если папка в итоге подключена с правами
  // (нужно кнопке-скрепке "Вставить картинку", см. insertImageAtCursor
  // ниже, чтобы дождаться результата перед открытием выбора файла).
  function pickNewImagesFolder(){
    if(!window.showDirectoryPicker){
      setStatus("Браузер не поддерживает выбор папки с изображениями.", true);
      return Promise.resolve(false);
    }
    return window.showDirectoryPicker(IMAGES_PERMISSION_OPTS).then(function(handle){
      return new Promise(function(resolve){
        function proceed(){
          imagesDirHandle = handle;
          imagesDirName = handle.name;
          imagesDirPermission = "granted";
          idbSet(IMAGES_DIR_HANDLE_KEY, handle).catch(function(){});
          buildImageIndex().then(function(){
            maybeRunImageCleanup();
            renderImagesFolderControls();
            resolve(true);
          });
        }
        idbGet(IMAGES_WARNED_KEY).then(function(warned){
          if(warned){ proceed(); return; }
          showImagesFirstConnectWarning(function(confirmed){
            if(!confirmed){ resolve(false); return; } // отмена — папка не подключается, флаг не трогаем
            idbSet(IMAGES_WARNED_KEY, true).catch(function(){});
            proceed();
          });
        });
      });
    }).catch(function(e){
      if(e && e.name !== "AbortError"){ // системный диалог закрыт пользователем — не ошибка
        setStatus("Не удалось выбрать папку: " + (e && e.message ? e.message : e), true);
      }
      return false;
    });
  }

  // Пробует молча/через жест подтвердить права на РАНЕЕ сохранённый
  // handle, и только если это не удалось — открывает системный диалог
  // выбора папки. Возвращает Promise<boolean> (см. pickNewImagesFolder).
  function ensureImagesReady(){
    if(imagesDirHandle){
      return verifyImagesPermission(imagesDirHandle, true).then(function(ok){
        if(ok){
          imagesDirPermission = "granted";
          return buildImageIndex().then(function(){
            maybeRunImageCleanup();
            renderImagesFolderControls();
            return true;
          });
        }
        return pickNewImagesFolder();
      });
    }
    return pickNewImagesFolder();
  }

  // Точка входа для кнопки "Папка с изображениями" (renderListScreen) и
  // для кнопки-скрепки на плейсхолдере отсутствующей картинки (раздел 9
  // ТЗ) — те же места не ждут результата, поэтому промис просто
  // игнорируется; см. ensureImagesReady выше для мест, которым результат
  // нужен (insertImageAtCursor).
  function reconnectImagesFolder(){
    ensureImagesReady();
  }

  // Перерисовывает ТОЛЬКО кнопку/статус папки с изображениями в текущем
  // списке заметок (если он сейчас на экране) — не весь список целиком,
  // чтобы не терять прокрутку/раскрытые состояния строк.
  function renderImagesFolderControls(){
    var btn = document.getElementById("mdEditorImagesDirBtn");
    if(btn) btn.textContent = imagesFolderButtonLabel();
  }
  function imagesFolderButtonLabel(){
    if(imagesDirPermission === "granted" && imagesDirName){
      return "Папка с изображениями: «" + imagesDirName + "» (сменить)";
    }
    if(imagesDirName){
      return "Подключить папку с изображениями заново («" + imagesDirName + "»)";
    }
    return "Указать папку с локальными изображениями";
  }

  // Подбирает свободное имя файла картинки вида "имя (2).ext", "имя (3).ext",
  // с сохранением расширения.
  function suggestFreeImageName(name){
    var extM = /^(.*)(\.[^.]+)$/.exec(name);
    var base = extM ? extM[1] : name, ext = extM ? extM[2] : "";
    var m = /^(.*) \((\d+)\)$/.exec(base);
    var stem = m ? m[1] : base;
    var n = m ? Number(m[2]) + 1 : 2;
    var candidate;
    do{
      candidate = stem + " (" + n + ")" + ext;
      n++;
    } while(imageIndex.has(candidate.toLowerCase()));
    return candidate;
  }

  // Копирует выбранный файл В КОРЕНЬ подключённой папки с изображениями
  // (раздел 8 ТЗ: без принудительной подпапки) и вставляет "![[имя]]" в
  // позицию курсора текущей заметки. Имя, уже занятое в imageIndex (в т.ч.
  // в другой подпапке — индекс плоский по всей папке), получает суффикс
  // "(2)" и т.д. через suggestFreeImageName выше, а не молча
  // перезаписывает существующий файл.
  function insertImageAtCursor(file){
    if(!cmView || !imagesDirHandle) return;
    var finalName = imageIndex.has(file.name.toLowerCase()) ? suggestFreeImageName(file.name) : file.name;
    imagesDirHandle.getFileHandle(finalName, { create: true }).then(function(fileHandle){
      return fileHandle.createWritable().then(function(writable){
        return writable.write(file).then(function(){ return writable.close(); });
      }).then(function(){ return fileHandle; });
    }).then(function(fileHandle){
      imageIndex.set(finalName.toLowerCase(), { handle: fileHandle, name: finalName });
      var sel = cmView.state.selection.main;
      var insertText = "![[" + finalName + "]]";
      cmView.dispatch({
        changes: { from: sel.from, to: sel.to, insert: insertText },
        selection: { anchor: sel.from + insertText.length }
      });
      cmView.focus();
    }).catch(function(e){
      setStatus("Не удалось сохранить картинку: " + (e && e.message ? e.message : e), true);
    });
  }

  // Множество имён картинок, реально встречающихся в тексте заметок
  // (![[имя]], тот же регэксп, что и у decorateLine/imgRe в
  // makeLivePreviewExtension ниже) — по ВСЕМ заметкам пользователя,
  // источник текста — notesMap (облачные/кэшированные записи), а не файлы
  // на диске (раздел 10 ТЗ: старая логика читала это через
  // fileHandle.getFile() по nameIndex, теперь заметки и так уже в памяти).
  var MEDIA_REF_RE = /!\[\[([^\[\]\n]+)\]\]/g;
  function collectReferencedMediaNames(){
    var names = new Set();
    notesMap.forEach(function(rec){
      if(!rec || rec.deleted || !rec.text) return;
      MEDIA_REF_RE.lastIndex = 0;
      var m;
      while((m = MEDIA_REF_RE.exec(rec.text))){
        names.add(m[1].trim().toLowerCase());
        if(m[0].length === 0) MEDIA_REF_RE.lastIndex++;
      }
    });
    return names;
  }

  // Корзина неиспользуемых картинок (раздел 10 ТЗ, замена старого
  // openCleanupDialog) — работает молча и полностью автономно: без
  // диалога подтверждения, без списка на экране. Условие запуска — папка
  // с картинками подключена (imagesDirHandle && "granted"); если не
  // подключена, эта функция просто не вызывается (см. maybeRunImageCleanup
  // ниже) — ни сообщений, ни disabled-состояний пользователю не показываем.
  function cleanupOrphanedImages(){
    if(!imagesDirHandle || imagesDirPermission !== "granted") return Promise.resolve();
    if(imageCleanupInFlight) return Promise.resolve();
    imageCleanupInFlight = true;
    var referenced = collectReferencedMediaNames();
    var deletedAny = false;
    async function walkAndClean(dirHandle){
      for await (var entry of dirHandle.entries()){
        var name = entry[0], handle = entry[1];
        if(handle.kind === "directory"){
          await walkAndClean(handle);
        } else if(handle.kind === "file" && IMAGE_EXT_RE.test(name)){
          if(!referenced.has(name.toLowerCase())){
            try{ await dirHandle.removeEntry(name); deletedAny = true; }catch(e){ /* права/гонка — пропускаем молча */ }
          }
        }
      }
    }
    return walkAndClean(imagesDirHandle).then(function(){
      imageCleanupInFlight = false;
      // Пересканируем индекс, только если что-то реально удалили — если
      // сирот не было, индекс и так уже актуален (его только что построил
      // buildImageIndex перед вызовом корзины), а лишний повторный обход
      // папки только заново дёргал бы refreshMountedImageNodes() ещё раз
      // поверх уже загружающихся картинок (см. imageLoadPromises выше —
      // само по себе это теперь безопасно, но обход папки всё равно не
      // нужен, если удалять было нечего).
      if(deletedAny) return buildImageIndex();
    }).catch(function(){ imageCleanupInFlight = false; });
  }

  // Запускает корзину сирот, только когда есть и подключённая папка
  // картинок, и уже загруженный список заметок (иначе "неиспользуемых"
  // посчитать не из чего, и можно случайно удалить то, что используется в
  // заметках, ещё не подтянутых из офлайн-кэша/облака) — вызывается после
  // buildImageIndex() и после готовности notesMap (см. initNotesModule).
  function maybeRunImageCleanup(){
    if(imagesDirHandle && imagesDirPermission === "granted" && notesReady && imageIndexBuilt){
      cleanupOrphanedImages();
    }
  }

  var livePreviewCompartment = null;
  var codeMode = false;
  var saveTimer = null;
  // ---- поле связей заметки (см. refreshLinksField/renderLinksField
  // ниже) — строка под заголовком со всеми исходящими [[ссылками]] из
  // текста текущей заметки. linksDebounceTimer откладывает пересчёт до
  // паузы в наборе текста (та же задержка, что и у автосохранения).
  var linksDebounceTimer = null;
  var renaming = false;
  // если "открыть заметку по имени снаружи" (см. openNoteExternally ниже)
  // пришло РАНЬШЕ, чем закончилась инициализация (папка ещё не выбрана/не
  // просканирована, initFromStoredHandle ещё выполняется) — запоминаем имя
  // здесь и открываем сразу по готовности (см. конец initFromStoredHandle)
  var pendingExternalOpen = null;
  // Промис ТЕКУЩЕГО фонового полного сканирования папки (см. rescan() и
  // initFromStoredHandle ниже) — пока список показан мгновенно из кэша
  // прошлого сканирования (см. shapeToStubNode), у части строк ещё нет
  // настоящего FileSystemHandle; клик по такой строке просто ждёт этот
  // промис вместо ошибки (см. openStubItemWhenReady). null, когда фонового
  // сканирования сейчас не идёт.
  var pendingRescanPromise = null;
  // взводится openNoteExternally перед открытием заметки по [[ссылке]],
  // пришедшей СНАРУЖИ модуля (из другой вкладки) — само открытие заметки
  // в этом случае не отдельный шаг "назад" внутри блокнота, а продолжение
  // ОДНОГО клика по ссылке: переход уже зарегистрирован снаружи вызовом
  // switchSettingsTab (см. initAutoFormatting/switchSettingsTab в my.js),
  // и "назад" должен вести прямо туда, откуда кликнули по ссылке, а не в
  // список заметок блокнота. См. pushMdNav ниже.
  var suppressNextNavPush = false;
  // ---- размер шрифта (кнопка "Аа") — "единица" равна FONT_SIZE_STEP_PX,
  // применяется через CSS-переменную --mdeditor-font-size, выставляемую
  // на :root (document.documentElement), а не только на хост редактора —
  // это ЕДИНАЯ настройка на всё приложение (см. applyFontSize ниже и ТЗ
  // пользователя от 31.08: "Аа" должна менять шрифт сразу и в "Моём
  // блокноте", и на вкладках задач, чтобы он был одинаков везде — сама
  // "Аа" продублирована там же, слева от "+", см. initTaskGlobalToolbar в
  // my.js). За исходный (шаг 0) берётся текущий стандартный размер
  // FONT_SIZE_BASE_PX. Сохраняется в IndexedDB (как и dirHandle выше),
  // поэтому переживает перезапуск приложения — грузится и применяется
  // сразу при создании модуля (см. IIFE сразу после объявлений ниже), а
  // не только при первом открытии вкладки "Мой блокнот", иначе задачи,
  // открытые раньше блокнота, короткое время показывались бы со старым
  // размером. ----
  var FONT_SIZE_BASE_PX = 15.5;
  var FONT_SIZE_STEP_PX = 1;
  var FONT_SIZE_MIN_STEP = -6;
  var FONT_SIZE_MAX_STEP = 12;
  var fontSizeStep = 0;
  var fontSizePanelOpen = false; // временные кнопки "+"/"-" сейчас показаны?
  var formatPanelOpen = false; // попап "Ж"/"К"/"П"/"Ч" сейчас показан?

  // Пересчитывает подгонку кнопок ВСЕХ уже отрисованных строк задач при
  // каждом изменении размера шрифта — не только по клику "Аа"/"+"/"-"
  // (changeFontSizeStep ниже), но и при самом первом, АСИНХРОННОМ
  // применении сохранённого размера при старте (см. idbGet ниже): до того,
  // как он придёт из IndexedDB, задачи успевают отрисоваться с временным
  // размером по умолчанию (FONT_SIZE_BASE_PX, шаг 0) — см. комментарий
  // выше про "короткое время показывались бы со старым размером". Именно
  // в этот момент .task-actions (см. fitTaskActions в my.js) уже
  // подогнаны под ЭТУ, временную, разбивку текста на строки; когда чуть
  // позже применяется настоящий сохранённый размер и текст перетекает
  // по-другому, без повторного вызова refitAllVisibleTaskBodies кнопки
  // остаются на старом месте — отсюда и лишний перенос кнопок на
  // отдельную строку даже там, где после реального размера шрифта места
  // достаточно (см. ТЗ пользователя от 31.08).
  function applyFontSize(){
    var px = (FONT_SIZE_BASE_PX + fontSizeStep * FONT_SIZE_STEP_PX) + "px";
    document.documentElement.style.setProperty("--mdeditor-font-size", px);
    refitAllVisibleTaskBodies();
  }
  function changeFontSizeStep(delta){
    var next = fontSizeStep + delta;
    if(next < FONT_SIZE_MIN_STEP || next > FONT_SIZE_MAX_STEP) return;
    fontSizeStep = next;
    applyFontSize();
    idbSet("fontSizeStep", fontSizeStep).catch(function(){});
  }
  // применяется сразу, не дожидаясь открытия вкладки "Мой блокнот" (см.
  // пояснение выше) — idbGet/idbSet объявлены ниже как function-декларации
  // и поэтому уже доступны здесь благодаря hoisting.
  idbGet("fontSizeStep").then(function(savedStep){
    if(typeof savedStep === "number" && isFinite(savedStep)){
      fontSizeStep = Math.max(FONT_SIZE_MIN_STEP, Math.min(FONT_SIZE_MAX_STEP, savedStep));
    }
    applyFontSize();
  }).catch(function(){ applyFontSize(); });
  // закладки — теперь читаются из синхронизируемого state my.js (см.
  // getSyncedBookmarkNames/setSyncedBookmark выше), а не из IndexedDB:
  // state уже загружен из localStorage синхронно к моменту вызова
  // initMdEditorModule, поэтому, в отличие от fontSizeStep выше, здесь
  // не нужно ждать асинхронного idbGet — значение доступно сразу же.
  bookmarkedNames = new Set(getSyncedBookmarkNames());
  // Одноразовая миграция закладок, оставшихся в IndexedDB с ДО того, как
  // они стали синхронизироваться в облаке (см. ТЗ пользователя от
  // 01.09) — если в синхронизируемом state закладок ещё нет, а в
  // IndexedDB что-то лежит, переносим их туда. Сразу же очищаем сам
  // ключ IndexedDB (idbSet("bookmarks", [])) — иначе, если человек потом
  // ДЕЙСТВИТЕЛЬНО уберёт все закладки (то есть в state и вправду 0), эта
  // же миграция при следующем запуске снова прочитала бы старый ключ и
  // ошибочно вернула бы удалённые закладки обратно.
  if(bookmarkedNames.size === 0){
    idbGet("bookmarks").then(function(savedNames){
      if(!Array.isArray(savedNames) || !savedNames.length) return;
      savedNames.forEach(function(n){
        bookmarkedNames.add(n);
        setSyncedBookmark(n, true);
      });
      idbSet("bookmarks", []).catch(function(){});
      if(initStarted) render();
    }).catch(function(){});
  }
  // Переключает принадлежность заметки к закладкам и точечно обновляет
  // все места, где её кнопка закладки сейчас видна — БЕЗ полной
  // перерисовки экрана открытой заметки (иначе пришлось бы пересоздавать
  // CodeMirror, см. renderEditorScreen/mountEditor). Список (обычный или
  // сама вкладка "Закладки") перерисовать целиком безопасно — там нет
  // "живого" редактора.
  function toggleBookmarkNote(name){
    var key = name.toLowerCase();
    var nowBookmarked;
    if(bookmarkedNames.has(key)){
      bookmarkedNames.delete(key);
      nowBookmarked = false;
      // при снятии закладки кнопка должна вернуться к дефолтному скрытому
      // состоянию в общем списке, а не просто стать "неактивной" — иначе
      // она осталась бы видна (пустым контуром) там, где её когда-то
      // раскрыли долгим нажатием, хотя по ТЗ по умолчанию она скрыта и
      // видна только для заметок, которые ДЕЙСТВИТЕЛЬНО в закладках.
      revealedBookmarkRows.delete(key);
    } else {
      bookmarkedNames.add(key);
      nowBookmarked = true;
    }
    setSyncedBookmark(key, nowBookmarked);
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(screen === "editor" && openFile && openFile.name.toLowerCase() === key){
      var hdrBtn = document.getElementById("mdEditorBookmarkBtn");
      if(hdrBtn) hdrBtn.classList.toggle("active", bookmarkedNames.has(key));
    }
    if(activeMdTab === "bookmarks") renderBookmarksScreen(container);
    else if(activeMdTab === "forgotten") renderForgottenNotesScreen(container);
    else if(screen === "list") renderListScreen(container);
  }

  // Вызывается снаружи (см. rerenderAllFromState в my.js) каждый раз,
  // когда облачная синхронизация приносит state, отличающийся от
  // локального — например, закладку добавили на другом устройстве.
  // Перечитывает список закладок из state и, если сейчас открыт список
  // заметок или сама вкладка "Закладки"/открытая заметка с изменившейся
  // отметкой, перерисовывает нужное место — тем же точечным способом,
  // что и toggleBookmarkNote выше (никогда не трогая "живой" редактор
  // ради самой заметки, только её кнопку закладки).
  function refreshBookmarksFromState(){
    var fresh = new Set(getSyncedBookmarkNames());
    var changed = fresh.size !== bookmarkedNames.size;
    if(!changed){
      fresh.forEach(function(k){ if(!bookmarkedNames.has(k)) changed = true; });
    }
    if(!changed) return;
    bookmarkedNames = fresh;
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(screen === "editor" && openFile){
      var hdrBtn = document.getElementById("mdEditorBookmarkBtn");
      if(hdrBtn) hdrBtn.classList.toggle("active", bookmarkedNames.has(openFile.name.toLowerCase()));
    }
    if(activeMdTab === "bookmarks") renderBookmarksScreen(container);
    else if(activeMdTab === "forgotten") renderForgottenNotesScreen(container);
    else if(screen === "list") renderListScreen(container);
  }

  function escName(s){ return escapeHtml ? escapeHtml(s) : String(s); }

  // Регистрирует один шаг навигации внутри "Моего блокнота" в общем стеке
  // "назад" (см. window.AppNav в my.js) — если он есть; съедает ОДНО
  // ожидающее подавление (см. suppressNextNavPush выше), чтобы переход,
  // пришедший снаружи по [[ссылке]], не задваивал запись в истории.
  function pushMdNav(restoreFn){
    if(suppressNextNavPush){ suppressNextNavPush = false; return; }
    if(window.AppNav && typeof window.AppNav.push === "function") window.AppNav.push(restoreFn);
  }

  function setStatus(msg, isError){
    statusMessage = msg || "";
    statusIsError = !!isError;
    var el = document.getElementById("mdEditorStatus");
    if(el){
      el.textContent = statusMessage;
      el.classList.toggle("error", statusIsError);
    }
  }

  // ---------------------------------------------------------------------
  // ОБЛАЧНОЕ ХРАНЕНИЕ ЗАМЕТОК (TASK_MDNOTES_CLOUD.md, шаг 1 "Ядро").
  // Формат узла в облаке:
  //   /syncs/<id>/notesMeta/<noteId> = { t: <ms>, deleted: true|false }
  //   /syncs/<id>/notes/<noteId>     = { iv: "<base64>", data: "<base64>" }
  // notesMeta — ОТКРЫТЫМ текстом (id + время правки + флаг удаления) — это
  // и есть "лёгкий запрос" из раздела 4.1 ТЗ: один GET по всем заметкам без
  // единого байта текста. notes/<id> — шифроблок AES-GCM-256 (ключ —
  // SHA-256(syncId), раздел 1 ТЗ), внутри JSON {name, path, text}: решено
  // шифровать name и path вместе с текстом одним и тем же ключом/IV.
  // ---------------------------------------------------------------------

  // ---- шифрование ----
  var notesCryptoKeyPromise = null, notesCryptoSyncId = null;
  function getNotesCryptoKey(){
    var id = getSyncId();
    if(!id) return Promise.reject(new Error("no_sync"));
    if(notesCryptoKeyPromise && notesCryptoSyncId === id) return notesCryptoKeyPromise;
    notesCryptoSyncId = id;
    notesCryptoKeyPromise = crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)).then(function(hash){
      return crypto.subtle.importKey("raw", hash, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
    });
    return notesCryptoKeyPromise;
  }
  function b64FromBuf(buf){
    var bytes = new Uint8Array(buf), bin = "";
    for(var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function bufFromB64(b64){
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }
  // Свой случайный IV (12 байт) на каждую операцию — не переиспользуется
  // (раздел 1 ТЗ).
  function encryptNotePayload(payload){
    return getNotesCryptoKey().then(function(key){
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify(payload));
      return crypto.subtle.encrypt({name:"AES-GCM", iv:iv}, key, data).then(function(cipher){
        return { iv: b64FromBuf(iv.buffer), data: b64FromBuf(cipher) };
      });
    });
  }
  function decryptNotePayload(enc){
    return getNotesCryptoKey().then(function(key){
      return crypto.subtle.decrypt({name:"AES-GCM", iv: new Uint8Array(bufFromB64(enc.iv))}, key, bufFromB64(enc.data)).then(function(buf){
        return JSON.parse(new TextDecoder().decode(buf));
      });
    });
  }

  // ---- локальный офлайн-кэш заметок (IndexedDB) — расшифрованные
  // заметки, чтобы список/чтение работали сразу при холодном старте без
  // сети (раздел 3 ТЗ) ----
  var NOTES_CACHE_KEY = "notesCache_v1";
  var notesCacheSaveTimer = null;
  function persistNotesCache(){
    var plain = {};
    notesMap.forEach(function(rec, id){ plain[id] = rec; });
    idbSet(NOTES_CACHE_KEY, plain).catch(function(){});
  }
  function scheduleNotesCachePersist(){
    if(notesCacheSaveTimer) clearTimeout(notesCacheSaveTimer);
    notesCacheSaveTimer = setTimeout(persistNotesCache, 300);
  }
  // Принудительный, немедленный сброс этого debounce — вызывается при
  // visibilitychange/pagehide (см. ниже), тем же приёмом, что и
  // flushPendingSyncNow у общего state в my.js (там localStorage.setItem
  // делается синхронно в обход debounce). Без этого правка, сделанная
  // офлайн прямо перед сворачиванием/заморозкой вкладки, могла бы не
  // попасть ни в облако (сети нет), ни в этот локальный кэш (300мс
  // таймер не успел сработать) — и потеряться безвозвратно.
  function flushNotesCacheNow(){
    if(notesCacheSaveTimer){ clearTimeout(notesCacheSaveTimer); notesCacheSaveTimer = null; }
    persistNotesCache();
  }
  function loadNotesCache(){
    return idbGet(NOTES_CACHE_KEY).then(function(plain){
      if(!plain || typeof plain !== "object") return;
      Object.keys(plain).forEach(function(id){
        var rec = plain[id];
        if(!rec) return;
        notesMap.set(id, rec);
        if(!rec.deleted && rec.name) nameIndex.set(rec.name.toLowerCase(), id);
      });
    }).catch(function(){});
  }

  // Единая точка предзагрузки: вызывается один раз при старте модуля (см.
  // низ файла), а также из initNotesModule на случай, если синхронизация
  // была настроена уже ПОСЛЕ старта модуля (тогда getSyncId() при первом
  // вызове внизу файла ещё возвращал null, и предзагрузка не запускалась).
  // notesCachePreloadPromise защищает от повторной загрузки — второй и
  // последующие вызовы просто возвращают тот же промис.
  var notesCachePreloadPromise = null;
  function preloadNotesCache(){
    if(notesCachePreloadPromise) return notesCachePreloadPromise;
    notesCachePreloadPromise = loadNotesCache().then(function(){
      rebuildTree();
      notesReady = true;
      maybeRunImageCleanup(); // папка картинок могла быть готова раньше notesMap
    });
    return notesCachePreloadPromise;
  }

  // ---- дерево папок из notesMap.path (раздел 2 ТЗ: "папка" — это просто
  // общий префикс path у нескольких заметок, реальной файловой системы
  // больше нет) ----
  function buildTreeFromNotes(){
    var root = { name: "", path: "", folders: [], files: [] };
    var folderCache = { "": root };
    function getFolderNode(pathStr){
      pathStr = pathStr || "";
      if(folderCache[pathStr]) return folderCache[pathStr];
      var parts = pathStr.split("/").filter(Boolean);
      var cur = root, curPath = "";
      for(var i = 0; i < parts.length; i++){
        curPath = curPath ? curPath + "/" + parts[i] : parts[i];
        if(folderCache[curPath]){ cur = folderCache[curPath]; continue; }
        var node = { name: parts[i], path: curPath, folders: [], files: [], parent: cur };
        cur.folders.push(node);
        folderCache[curPath] = node;
        cur = node;
      }
      return cur;
    }
    notesMap.forEach(function(rec, id){
      if(!rec || rec.deleted || !rec.name) return;
      var folder = getFolderNode(rec.path);
      folder.files.push({ name: rec.name, id: id });
    });
    return root;
  }
  // Цепочка имён папок от корня до узла — используется, чтобы после
  // перестроения дерева (новый объект, старые ссылки на узлы не годятся)
  // найти "то же самое" место, а не сбрасывать пользователя в корень.
  function folderPath(node){
    var path = [];
    var n = node;
    while(n && n.parent){ path.unshift(n.name); n = n.parent; }
    return path;
  }
  function findNodeByPath(root, path){
    var n = root;
    for(var i = 0; i < path.length; i++){
      var found = null;
      for(var j = 0; j < n.folders.length; j++){
        if(n.folders[j].name === path[i]){ found = n.folders[j]; break; }
      }
      if(!found) return null;
      n = found;
    }
    return n;
  }
  function rebuildTree(){
    var oldPath = currentDirNode ? folderPath(currentDirNode) : null;
    rootTree = buildTreeFromNotes();
    currentDirNode = oldPath ? (findNodeByPath(rootTree, oldPath) || rootTree) : rootTree;
  }
  // Уникальность имени по ВСЕМУ дереву без учёта регистра (раздел 2 ТЗ:
  // перелинковка [[имя]] требует, чтобы двух заметок с одинаковым именем
  // не существовало одновременно).
  function isNoteNameTaken(name, exceptId){
    var id = nameIndex.get((name || "").toLowerCase());
    return !!(id && id !== exceptId);
  }

  // ---- CRUD над notesMap — синхронные, локальные правки; в облако уходят
  // debounce-пушем (см. ниже, раздел 3 ТЗ) ----
  var dirtyNoteIds = new Set();
  function markNoteDirty(id){
    dirtyNoteIds.add(id);
    scheduleNotesCachePersist();
    scheduleNotesCloudPush();
  }
  function createNoteRecord(name, path){
    var id = generateId();
    var today = todayRu();
    var text = buildMetaLine(today, today, today);
    var rec = { id: id, name: name, path: path || "", text: text, t: Date.now() };
    notesMap.set(id, rec);
    nameIndex.set(name.toLowerCase(), id);
    markNoteDirty(id);
    return rec;
  }
  function renameNoteRecord(id, newName){
    var rec = notesMap.get(id);
    if(!rec) return false;
    nameIndex.delete(rec.name.toLowerCase());
    rec.name = newName;
    rec.t = Date.now();
    nameIndex.set(newName.toLowerCase(), id);
    markNoteDirty(id);
    return true;
  }
  function editNoteRecordText(id, newText){
    var rec = notesMap.get(id);
    if(!rec) return;
    rec.text = newText;
    rec.t = Date.now();
    markNoteDirty(id);
  }
  function deleteNoteRecord(id){
    var rec = notesMap.get(id);
    if(!rec) return;
    nameIndex.delete(rec.name.toLowerCase());
    rec.deleted = true;
    rec.t = Date.now();
    markNoteDirty(id);
  }
  // Правки в тексте ДРУГИХ заметок при переименовании (замена [[старое]] на
  // [[новое]] — существовавшая и раньше фича, см. историю правок) — теперь
  // просто синхронный проход по notesMap в памяти, без файлового I/O.
  function propagateRenameInMemory(oldName, newName){
    var esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("\\[\\[(" + esc + ")\\]\\]", "gi");
    notesMap.forEach(function(rec, id){
      if(rec.deleted || !rec.text) return;
      re.lastIndex = 0;
      if(!re.test(rec.text)) return;
      re.lastIndex = 0;
      rec.text = rec.text.replace(re, "[[" + newName + "]]");
      rec.t = Date.now();
      markNoteDirty(id);
      if(openFile && openFile.id === id){
        openFile.text = rec.text;
        if(cmView) cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: rec.text } });
      }
    });
  }

  // ---------------------------------------------------------------------
  // ИМПОРТ / ЭКСПОРТ .md И .zip (TASK_MDNOTES_CLOUD.md, шаг 2 "Интерфейс
  // списка", раздел 5-7 ТЗ). Кнопки — последние элементы прокручиваемого
  // списка заметок, см. renderListScreen ниже; кнопка скачивания ОДНОЙ
  // заметки — в шапке открытой заметки, см. renderEditorScreen.
  // ---------------------------------------------------------------------

  // Скачивание произвольного Blob — общий приём (createObjectURL + клик по
  // временной невидимой ссылке), используется и для .md, и для .zip ниже.
  function triggerBlobDownload(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      if(a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // Заметка -> имя файла .md внутри архива, с учётом её "папки" (path,
  // см. buildTreeFromNotes выше) — сохраняем структуру дерева в zip
  // (раздел 6 ТЗ: "с сохранением структуры папок через MiniZip.createZip").
  function noteZipEntryName(rec){
    return (rec.path ? rec.path + "/" : "") + rec.name + ".md";
  }

  // Раздел 6 ТЗ: скачать ОДНУ открытую заметку как .md-файл — кнопка в
  // шапке экрана редактора (см. renderEditorScreen).
  function downloadSingleNote(){
    if(!openFile) return;
    var blob = new Blob([openFile.text], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, openFile.name + ".md");
  }

  // Раздел 6 ТЗ: скачать ВСЕ заметки пользователя как .zip, расшифровывая
  // на лету (заметки в памяти, notesMap, УЖЕ расшифрованы — шифруется
  // только то, что уходит/приходит из Firebase, см. encryptNotePayload/
  // decryptNotePayload выше) — с сохранением структуры папок.
  function downloadAllNotesZip(){
    if(!MiniZip){
      setStatus("Не удалось собрать .zip: модуль ZIP не загружен.", true);
      return;
    }
    var files = [];
    notesMap.forEach(function(rec){
      if(!rec || rec.deleted || !rec.name) return;
      files.push({ name: noteZipEntryName(rec), data: new TextEncoder().encode(rec.text || "") });
    });
    if(!files.length){
      setStatus("Заметок пока нет — нечего скачивать.", true);
      return;
    }
    try{
      var zipBytes = MiniZip.createZip(files);
      var blob = new Blob([zipBytes], { type: "application/zip" });
      triggerBlobDownload(blob, "Мой блокнот.zip");
    }catch(e){
      setStatus("Не удалось собрать .zip: " + (e && e.message ? e.message : e), true);
    }
  }

  // ---- импорт: создание записи заметки БЕЗ форсирования строки метаданных
  // (в отличие от createNoteRecord выше, которая пишет её сразу для
  // ЗАВЕДОМО новой пустой заметки) — импортированный текст сохраняется как
  // есть; своя строка метаданных допишется при первом реальном
  // автосохранении, как и у любой "старой" заметки без неё (см.
  // parseNoteMeta/virtualLegacyDatePairRu выше). ----
  function createImportedNoteRecord(name, path, text){
    var id = generateId();
    var rec = { id: id, name: name, path: path || "", text: text || "", t: Date.now() };
    notesMap.set(id, rec);
    nameIndex.set(name.toLowerCase(), id);
    markNoteDirty(id);
    recordNoteCreated(name);
    return rec;
  }

  // ---------------------------------------------------------------------
  // Подтверждение перезаписи при импорте (раздел 5 ТЗ пересмотрен
  // пользователем 06.09: вместо диалога "что делать с ЭТОЙ заметкой" по
  // каждому конфликту — импорт всегда заменяет заметки, совпавшие по
  // имени, текстом из файла/архива. Если совпадений вообще нет — импорт
  // идёт молча, без единого диалога. Если хотя бы одно совпадение есть —
  // одно общее предупреждение на весь импорт, до того как что-либо
  // изменится: пользователь либо подтверждает замену всех совпавших
  // разом, либо отменяет весь импорт целиком (частичной отмены нет).
  // Тот же приём карточки поверх окна настроек, что и у
  // openNewNoteDialog/confirmDeleteNote выше (.mdeditor-cleanup-overlay/
  // -card). Возвращает Promise<boolean> (true — подтверждено).
  // ---------------------------------------------------------------------
  function showOverwriteConfirmDialog(count){
    return new Promise(function(resolve){
      var box = document.querySelector(".settings-modal-box");
      if(!box){ resolve(false); return; }
      var overlay = document.createElement("div");
      overlay.className = "mdeditor-cleanup-overlay";
      var card = document.createElement("div");
      card.className = "mdeditor-cleanup-card";
      card.innerHTML =
        '<div class="mdeditor-cleanup-title"></div>' +
        '<div class="mdeditor-cleanup-actions">' +
          '<button type="button" class="mdeditor-cleanup-cancel" id="mdEditorOverwriteCancel">Отмена</button>' +
          '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-danger" id="mdEditorOverwriteOk">Заменить</button>' +
        '</div>';
      card.querySelector(".mdeditor-cleanup-title").textContent = count === 1
        ? 'Заметка с таким именем уже есть в блокноте — она будет заменена версией из файла. Продолжить?'
        : 'Заметок с такими же именами уже ' + count + ' — они будут заменены версиями из файла/архива. Продолжить?';
      overlay.appendChild(card);
      box.appendChild(overlay);
      function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
      document.getElementById("mdEditorOverwriteCancel").addEventListener("click", function(){ close(); resolve(false); });
      document.getElementById("mdEditorOverwriteOk").addEventListener("click", function(){ close(); resolve(true); });
      overlay.addEventListener("click", function(ev){ if(ev.target === overlay){ close(); resolve(false); } });
    });
  }

  // Простое информационное окно с одной кнопкой "Понятно" — тот же
  // .mdeditor-cleanup-card, что и у диалогов выше, но без выбора (раздел 5
  // ТЗ: предупреждение, что картинки/прочие файлы из архива не перенесены).
  function showImportInfoDialog(message){
    var box = document.querySelector(".settings-modal-box");
    if(!box) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title"></div>' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="mdEditorImportInfoOk">Понятно</button>' +
      '</div>';
    card.querySelector(".mdeditor-cleanup-title").textContent = message;
    overlay.appendChild(card);
    box.appendChild(overlay);
    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    document.getElementById("mdEditorImportInfoOk").addEventListener("click", close);
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });
  }

  // Импортирует набор записей {name, path, text} (одна для .md-файла,
  // несколько для .zip — см. вызовы ниже). Раздел 5 ТЗ пересмотрен
  // пользователем 06.09: конфликт имени больше не разбирается по одной
  // заметке за раз — заметки, совпавшие по имени с уже существующими,
  // всегда ЗАМЕНЯЮТСЯ текстом из импорта. Если совпадений вообще нет —
  // импорт применяется сразу, без единого диалога (см.
  // showOverwriteConfirmDialog выше). Если совпадения есть — сначала одно
  // общее предупреждение на весь импорт; отмена — отменяет импорт
  // целиком, ничего не меняя (частичного импорта при отмене нет).
  // Возвращает Promise<{imported, replaced, cancelled}>.
  function importNoteEntries(entries){
    var conflictCount = 0;
    for(var j = 0; j < entries.length; j++){
      if(isNoteNameTaken(entries[j].name)) conflictCount++;
    }
    function applyEntries(){
      var imported = 0, replaced = 0;
      entries.forEach(function(entry){
        var name = entry.name, path = entry.path, text = entry.text;
        var existingId = isNoteNameTaken(name) ? nameIndex.get(name.toLowerCase()) : null;
        if(existingId){
          editNoteRecordText(existingId, text);
          replaced++;
        } else {
          createImportedNoteRecord(name, path, text);
          imported++;
        }
      });
      return { imported: imported, replaced: replaced, cancelled: false };
    }
    if(!conflictCount) return Promise.resolve(applyEntries());
    return showOverwriteConfirmDialog(conflictCount).then(function(confirmed){
      if(!confirmed) return { imported: 0, replaced: 0, cancelled: true };
      return applyEntries();
    });
  }

  // Обрабатывает выбранный пользователем файл (.md или .zip) — точка входа
  // для кнопки "Загрузить .md или .zip" (см. renderListScreen ниже).
  // targetNode — текущая открытая "папка" (одиночный .md кладётся в неё;
  // структура папок ИЗ .zip самодостаточна и используется как есть,
  // раздел 5 ТЗ, поэтому targetNode для .zip не участвует).
  function handleImportFile(file, targetNode){
    var lowerName = (file.name || "").toLowerCase();
    if(lowerName.endsWith(".zip")){
      if(!MiniZip){
        setStatus("Не удалось прочитать .zip: модуль ZIP не загружен.", true);
        return;
      }
      file.arrayBuffer().then(function(buf){
        return MiniZip.extractMarkdownFiles(buf);
      }).then(function(result){
        var entries = result.mdFiles.map(function(f){
          var slash = f.path.lastIndexOf("/");
          var dir = slash >= 0 ? f.path.slice(0, slash) : "";
          var base = slash >= 0 ? f.path.slice(slash + 1) : f.path;
          var noteName = base.replace(/\.md$/i, "").trim() || "Без названия";
          return { name: noteName, path: dir, text: f.text };
        });
        if(!entries.length){
          setStatus("В архиве не найдено файлов .md.", true);
          return;
        }
        return importNoteEntries(entries).then(function(summary){
          if(summary.cancelled){
            setStatus("Импорт отменён.", false);
            return;
          }
          rebuildTree();
          var container = document.getElementById("settingsTabContent");
          if(container) render();
          setStatus("Импортировано: " + summary.imported +
            (summary.replaced ? ", заменено: " + summary.replaced : "") + ".", false);
          if(result.hasOtherFiles){
            showImportInfoDialog("В архиве были и другие файлы (например, картинки) — они не перенесены. Изображения в «Моём блокноте» подключаются отдельно, через папку картинок.");
          }
        });
      }).catch(function(e){
        setStatus("Не удалось прочитать .zip: " + (e && e.message ? e.message : e), true);
      });
      return;
    }
    if(lowerName.endsWith(".md")){
      file.text().then(function(text){
        var noteName = file.name.replace(/\.md$/i, "").trim() || "Без названия";
        return importNoteEntries([{ name: noteName, path: targetNode ? targetNode.path : "", text: text }]);
      }).then(function(summary){
        if(summary.cancelled){
          setStatus("Загрузка отменена.", false);
          return;
        }
        rebuildTree();
        render();
        if(summary.replaced) setStatus("Заметка заменена.", false);
        else setStatus("Заметка загружена.", false);
      }).catch(function(e){
        setStatus("Не удалось прочитать файл: " + (e && e.message ? e.message : e), true);
      });
      return;
    }
    setStatus("Выберите файл .md или .zip.", true);
  }

  // ---- облачный пуш: debounce + повтор с нарастающей паузой, тот же
  // принцип, что и у общего state, но полностью НЕЗАВИСИМЫЙ цикл (раздел 2
  // ТЗ) ----
  var notesPushTimer = null, notesRetryTimer = null, notesRetryCount = 0;
  var notesSyncInProgress = false, notesPendingPushAfterSync = false;
  function scheduleNotesCloudPush(){
    if(!getSyncId()) return;
    clearTimeout(notesRetryTimer); notesRetryCount = 0;
    if(notesSyncInProgress){ notesPendingPushAfterSync = true; return; }
    clearTimeout(notesPushTimer);
    notesPushTimer = setTimeout(function(){ pushDirtyNotes(false); }, NOTES_PUSH_DEBOUNCE_MS);
  }
  // urgent=true — уход со страницы/заметки, просим keepalive у сети (тот
  // же приём, что и у flushPendingSyncNow в my.js, раздел 3 ТЗ).
  function pushDirtyNotes(urgent){
    if(!getSyncId() || !isOnline()) return Promise.resolve();
    if(notesSyncInProgress){ notesPendingPushAfterSync = true; return Promise.resolve(); }
    var ids = Array.from(dirtyNoteIds);
    if(!ids.length) return Promise.resolve();
    notesSyncInProgress = true;
    var patch = {};
    return Promise.all(ids.map(function(id){
      var rec = notesMap.get(id);
      if(!rec) return null;
      if(rec.deleted){
        patch["notesMeta/" + id] = { t: rec.t, deleted: true };
        return deleteCloudPath("notes/" + id, { keepalive: urgent }).catch(function(){});
      }
      return encryptNotePayload({ name: rec.name, path: rec.path, text: rec.text }).then(function(enc){
        patch["notes/" + id] = enc;
        patch["notesMeta/" + id] = { t: rec.t, deleted: false };
      });
    })).then(function(){
      return patchCloud(patch, { keepalive: urgent });
    }).then(function(){
      ids.forEach(function(id){ dirtyNoteIds.delete(id); });
      notesRetryCount = 0;
      clearTimeout(notesRetryTimer);
      if(notesPendingPushAfterSync){ notesPendingPushAfterSync = false; scheduleNotesCloudPush(); }
    }).catch(function(){
      if(notesRetryCount < NOTES_RETRY_DELAYS.length){
        var d = NOTES_RETRY_DELAYS[notesRetryCount]; notesRetryCount++;
        clearTimeout(notesRetryTimer);
        notesRetryTimer = setTimeout(function(){ pushDirtyNotes(false); }, d);
      }
    }).finally(function(){
      notesSyncInProgress = false;
    });
  }

  // ---- облачный пул: раздел 4.1 ТЗ — сначала лёгкий запрос метаданных,
  // текст только у заметок, где облачная t новее локальной ----
  function syncNotesFromCloud(){
    if(!getSyncId() || !isOnline()) return Promise.resolve();
    return fetchCloudPath("notesMeta").then(function(meta){
      meta = meta || {};
      var toFetch = [];
      // раздел 4.1 ТЗ: "открытая заметка... должна обновиться" — если
      // ИМЕННО открытая сейчас в редакторе заметка пришла удалённой с
      // другого устройства, редактор придётся закрыть; делаем это уже
      // после того, как notesMap приведён в порядок, см. .then ниже.
      var openFileDeletedRemotely = false;
      Object.keys(meta).forEach(function(id){
        var cloudEntry = meta[id] || {};
        var local = notesMap.get(id);
        var cloudT = typeof cloudEntry.t === "number" ? cloudEntry.t : 0;
        var localT = local ? (local.t || 0) : -1;
        if(cloudT <= localT) return;
        if(cloudEntry.deleted){
          if(local && local.name) nameIndex.delete(local.name.toLowerCase());
          notesMap.set(id, { id: id, deleted: true, t: cloudT, name: local && local.name, path: local && local.path, text: "" });
          if(openFile && openFile.id === id && !openFile.dirty) openFileDeletedRemotely = true;
        } else {
          toFetch.push(id);
        }
      });
      var fetchPromise = !toFetch.length ? Promise.resolve() : Promise.all(toFetch.map(function(id){
        return fetchCloudPath("notes/" + id).then(function(enc){
          if(!enc) return;
          return decryptNotePayload(enc).then(function(payload){
            var existing = notesMap.get(id);
            if(existing && existing.name) nameIndex.delete(existing.name.toLowerCase());
            notesMap.set(id, { id: id, name: payload.name, path: payload.path, text: payload.text, t: meta[id].t });
            nameIndex.set(payload.name.toLowerCase(), id);
            // Заметка, обновлённая с другого устройства, в этот момент
            // открыта в редакторе на этом — подхватываем текст на месте,
            // без пересборки всего экрана. Пропускаем, если в ней есть
            // несохранённые локальные правки (dirty — автосохранение ещё
            // не сбросило их в notesMap): иначе рискуем стереть то, что
            // пользователь только что печатает. В этом случае облачная
            // версия просто останется в notesMap и проиграет при
            // следующем локальном flushAutosaveNow/pushDirtyNotes (t
            // пользователя будет свежее) — тем же принципом LWW, что и у
            // раздела 4.
            if(openFile && openFile.id === id && !openFile.dirty && cmView){
              openFile.text = payload.text;
              openFile.path = payload.path;
              cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: payload.text } });
              refreshDatesField();
            }
          });
        }).catch(function(){ /* пропускаем одну заметку — не мешаем остальным */ });
      }));
      return fetchPromise.then(function(){
        persistNotesCache();
        if(openFileDeletedRemotely){
          openFile = null;
          destroyEditor();
          screen = "list";
          setStatus("Эта заметка была удалена на другом устройстве.", false);
        }
      });
    });
  }

  // ---------------------------------------------------------------------
  // Точки входа вкладок — вызываются из switchSettingsTab при каждом
  // открытии. Состояние (notesMap/открытая заметка) переживает
  // переключения между вкладками настроек в рамках одной сессии.
  // ---------------------------------------------------------------------
  // раздел 4.1 ТЗ: лёгкая сверка с облаком (метаданные всех заметок, точечно
  // текст только у изменившихся, см. syncNotesFromCloud) — обязательна при
  // КАЖДОМ переходе на вкладку "Мой блокнот"/"Закладки"/"Забытые заметки",
  // а не только при самом первом её открытии за сессию (это было упущено —
  // initNotesModule ниже запускался лишь один раз, под флагом initStarted,
  // и на повторные заходы на вкладку сверка вообще не срабатывала). Не
  // блокирует немедленный локальный рендер из кэша — сверка идёт фоном,
  // экран обновляется только если результат реально что-то изменил и мы
  // всё ещё на подходящем экране (список/закладки/забытые — не поверх
  // активно открытого редактора, см. проверку ниже и обновление самой
  // открытой заметки внутри syncNotesFromCloud).
  function syncNotesOnTabEnter(){
    if(!getSyncId() || !notesReady) return;
    syncNotesFromCloud().then(function(){
      rebuildTree();
      maybeRunImageCleanup(); // свежие заметки с облака могли изменить список используемых картинок
      // "Забытые заметки" кэширует список в forgottenNotesData (см. выше) и
      // сам его не перечитывает при простом render() — без явного сброса
      // фоновая сверка не долистнула бы туда новые/удалённые заметки.
      if(activeMdTab === "forgotten") forgottenNotesData = null;
      if(screen === "list" || activeMdTab === "bookmarks" || activeMdTab === "forgotten") render();
    });
  }

  function renderSettingsTabMdEditor(){
    activeMdTab = "editor";
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(!initStarted){
      initStarted = true;
      container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
      initNotesModule();
      return;
    }
    render();
    syncNotesOnTabEnter();
  }
  function renderSettingsTabMdBookmarks(){
    activeMdTab = "bookmarks";
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(!initStarted){
      initStarted = true;
      container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
      initNotesModule();
      return;
    }
    render();
    syncNotesOnTabEnter();
  }

  // Загрузка локального кэша (мгновенно, офлайн) + первая фоновая сверка с
  // облаком, см. syncNotesOnTabEnter выше (тот же вызов используется и здесь,
  // и при каждом последующем переходе на вкладку). Без syncId вкладка не
  // работает (раздел 1 ТЗ) — экран объясняет это и предлагает настроить
  // синхронизацию, а не заводит отдельный контур.
  function initNotesModule(){
    if(!getSyncId()){
      screen = "setup";
      render();
      return;
    }
    preloadNotesCache().then(function(){
      resumeLastNoteOrShowList();
      syncNotesOnTabEnter();
    });
  }

  // Открывает заметку по имени СНАРУЖИ модуля (клик по [[ссылке]] из
  // другой вкладки, см. handleLinkClick/initAutoFormatting в my.js).
  function openNoteExternally(name){
    suppressNextNavPush = true;
    if(!notesReady){
      pendingExternalOpen = name;
      return;
    }
    handleLinkClick(name);
  }

  function render(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(window.Debug && activeMdTab === "forgotten"){
      window.Debug.log("forgotten:render() called", { hasRootTree: !!rootTree, screen: screen });
    }
    // вкладка "Закладки" (set2s_2) показывается вместо обычного списка,
    // но только когда папка уже выбрана и просканирована (rootTree
    // готов) — иначе (первый запуск/нужно заново подтвердить доступ)
    // ниже сработает тот же экран настройки папки, что и у "Моего
    // блокнота" (общий для обеих вкладок, см. activeMdTab выше).
    if(activeMdTab === "bookmarks" && rootTree){ renderBookmarksScreen(container); return; }
    // вкладка "Забытые заметки" (set2s_4, ТЗ пользователя от 04.09) — по
    // тому же принципу, что и "Закладки" выше: отдельный экран поверх
    // обычного списка/редактора, показывается только когда папка уже
    // выбрана и просканирована.
    if(activeMdTab === "forgotten" && rootTree){ renderForgottenNotesScreen(container); return; }
    if(screen === "editor" && openFile) renderEditorScreen(container);
    else if(screen === "list" && currentDirNode) renderListScreen(container);
    else renderSetupScreen(container);
  }

  // ---------------------------------------------------------------------
  // Экран "нет синхронизации" / загрузки — заметки доступны и работают
  // ТОЛЬКО если на устройстве уже настроена обычная синхронизация (раздел
  // 1 ТЗ): без неё нет syncId, а значит и ключа шифрования.
  // ---------------------------------------------------------------------
  function renderSetupScreen(container){
    if(!getSyncId()){
      container.innerHTML =
        '<div class="mdeditor-tab settings-content-bottom">' +
          '<h3 class="workbooks-title">Мой блокнот</h3>' +
          '<p class="mdeditor-hint">Заметки хранятся в облаке и шифруются кодом синхронизации устройства. Сначала настройте обычную синхронизацию, а затем вернитесь на эту вкладку.</p>' +
          '<div class="mdeditor-setup-row">' +
            '<button type="button" class="task-import-attach-btn" id="mdEditorOpenSyncBtn" title="Настроить синхронизацию">' + PAPERCLIP_ICON_SVG + '</button>' +
          '</div>' +
          (statusMessage ? '<p class="mdeditor-hint' + (statusIsError ? " error" : "") + '" style="margin-top:10px;' + (statusIsError ? "color:var(--status-err,#c0392b);" : "") + '">' + escName(statusMessage) + '</p>' : "") +
        '</div>';
      var btn = document.getElementById("mdEditorOpenSyncBtn");
      if(btn) btn.addEventListener("click", function(){
        if(attachPickerBusy) return;
        attachPickerBusy = true;
        try{ openSyncModal(); } finally { attachPickerBusy = false; }
      });
      return;
    }
    container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
  }

  // ---------------------------------------------------------------------
  // Экран списка тем: алфавитный список внутри текущей "папки" (то есть
  // внутри общего префикса path, см. buildTreeFromNotes выше) — файлы из
  // вложенных папок в общий список НЕ попадают, вместо них показывается
  // сама папка; "домик" всегда ведёт в корень.
  // ---------------------------------------------------------------------
  function renderListScreen(container){
    var node = currentDirNode;
    var visibleFolders = node.folders.filter(function(fo){
      return fo.name.charAt(0) !== ".";
    });
    var folderItems = visibleFolders.map(function(fo){ return { type: "folder", name: fo.name, node: fo }; });
    var fileItems = node.files.map(function(f){ return { type: "file", name: f.name, id: f.id }; });
    folderItems.sort(function(a, b){ return a.name.localeCompare(b.name, "ru", { sensitivity: "base" }); });
    fileItems.sort(function(a, b){
      var da = /^\d/.test(a.name) ? 1 : 0;
      var db = /^\d/.test(b.name) ? 1 : 0;
      if(da !== db) return da - db;
      return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
    });
    var items = folderItems.concat(fileItems);

    var isRoot = (node === rootTree);
    // Есть ли хоть одна незыделенная заметка ВООБЩЕ (не только в текущей
    // папке) — определяет, показывать ли кнопку "Скачать .zip" (раздел 7
    // ТЗ: скачивать целиком нечего, пока заметок нет вообще ни одной).
    // Кнопка "Загрузить" показывается всегда, включая самый первый пустой
    // экран (раздел 7 ТЗ).
    var hasAnyNotes = false;
    notesMap.forEach(function(rec){ if(rec && !rec.deleted && rec.name) hasAnyNotes = true; });
    var html = '<div class="mdeditor-tab">';
    html += '<h3 class="workbooks-title" style="margin:0 0 4px 0;">' + (isRoot ? "Мой блокнот" : escName(node.name)) + '</h3>';
    if(!items.length){
      html += '<div class="mdeditor-empty">' + (isRoot ? "Заметок пока нет." : "Здесь пока пусто.") + '</div>';
    } else {
      html += '<div class="mdeditor-list" id="mdEditorList"></div>';
    }
    // Строка статуса — сюда попадают результаты импорта/экспорта
    // (см. handleImportFile/downloadAllNotesZip выше): "Импортировано: N",
    // ошибки чтения файла и т.п. Тот же #mdEditorStatus/setStatus, что и в
    // экране открытой заметки, просто на этом экране своя копия разметки.
    html += '<div class="mdeditor-status" id="mdEditorStatus"></div>';
    // Кнопки загрузки/скачивания — часть обычного потока страницы, НЕ
    // floating (раздел 7 ТЗ: "физически являются последними элементами
    // прокручиваемого списка"), поэтому просто идут дальше по разметке
    // .mdeditor-tab, а не в .mdeditor-fab-row (тот — position:absolute).
    // Стиль переиспользован у "Начать"/"Скачать" остальных вкладок
    // (.workbooks-run-btn, components.css), как и попросили — свой стиль
    // не изобретаем.
    html += '<div class="mdeditor-list-actions">';
    html += '<button type="button" class="workbooks-run-btn mdeditor-list-action-btn" id="mdEditorImportBtn">Загрузить .md или .zip, содержащий файлы .md</button>';
    if(hasAnyNotes){
      html += '<button type="button" class="workbooks-run-btn mdeditor-list-action-btn" id="mdEditorExportZipBtn">Скачать .zip, содержащий файлы .md</button>';
    }
    // Папка с изображениями (раздел 8 ТЗ) — отдельная от всего, что
    // связано с самими заметками, но показывается только в корне списка
    // (не имеет смысла повторять в каждой вложенной "папке" заметок).
    // Подпись меняется в зависимости от состояния (см.
    // imagesFolderButtonLabel/renderImagesFolderControls выше).
    if(isRoot){
      html += '<button type="button" class="workbooks-run-btn mdeditor-list-action-btn" id="mdEditorImagesDirBtn">' + escName(imagesFolderButtonLabel()) + '</button>';
    }
    html += '</div>';
    html += '<input type="file" accept=".md,.zip,text/markdown,application/zip" id="mdEditorImportInput" style="display:none;">';
    html += '<div class="mdeditor-fab-row">';
    html += '<button type="button" class="mdeditor-fab-btn" id="mdEditorNewNoteBtn" title="Новая заметка">' + PLUS_ICON_SVG + '</button>';
    html += '<button type="button" class="mdeditor-fab-btn" id="mdEditorHomeBtn" title="К списку заметок">' + HOME_ICON_SVG + '</button>';
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    var importInput = document.getElementById("mdEditorImportInput");
    var importBtn = document.getElementById("mdEditorImportBtn");
    if(importBtn && importInput){
      importBtn.addEventListener("click", function(){ importInput.click(); });
      importInput.addEventListener("change", function(){
        var file = importInput.files && importInput.files[0];
        importInput.value = ""; // разрешаем выбрать тот же файл ещё раз
        if(file) handleImportFile(file, node);
      });
    }
    var exportZipBtn = document.getElementById("mdEditorExportZipBtn");
    if(exportZipBtn){
      exportZipBtn.addEventListener("click", downloadAllNotesZip);
    }

    var imagesDirBtn = document.getElementById("mdEditorImagesDirBtn");
    if(imagesDirBtn){
      imagesDirBtn.addEventListener("click", reconnectImagesFolder);
    }

    var newNoteBtn = document.getElementById("mdEditorNewNoteBtn");
    if(newNoteBtn){
      newNoteBtn.addEventListener("click", function(){ openNewNoteDialog(node); });
    }

    var homeBtn = document.getElementById("mdEditorHomeBtn");
    if(homeBtn){
      homeBtn.addEventListener("click", function(){
        if(!isRoot){
          var prevDirNode = currentDirNode;
          pushMdNav(function(){ currentDirNode = prevDirNode; render(); });
          currentDirNode = rootTree;
          render();
        } else {
          var sc = document.getElementById("settingsTabContent");
          if(sc) sc.scrollTop = 0;
        }
      });
    }

    var listEl = document.getElementById("mdEditorList");
    if(listEl){
      items.forEach(function(it, idx){
        var row = document.createElement("div");
        row.className = "mdeditor-row";
        row.dataset.index = String(idx);
        var isNote = (it.type === "file");
        row.innerHTML = (it.type === "folder" ? FOLDER_ICON_SVG : FILE_ICON_SVG) +
          '<span class="mdeditor-row-name"></span>' +
          (isNote ?
            '<button type="button" class="mdeditor-delete-btn" title="Удалить">' + DELETE_ICON_SVG + '</button><button type="button" class="mdeditor-bookmark-btn" title="Закладка">' + BOOKMARK_ICON_SVG + '</button>' :
            '<button type="button" class="mdeditor-delete-btn" title="Удалить папку">' + DELETE_ICON_SVG + '</button>');
        row.querySelector(".mdeditor-row-name").textContent = it.name;
        if(isNote){
          var key = it.name.toLowerCase();
          var bmBtn = row.querySelector(".mdeditor-bookmark-btn");
          var bookmarked = bookmarkedNames.has(key);
          bmBtn.classList.toggle("active", bookmarked);
          bmBtn.classList.toggle("visible", bookmarked || revealedBookmarkRows.has(key));
          var delBtn = row.querySelector(".mdeditor-delete-btn");
          delBtn.classList.toggle("visible", revealedBookmarkRows.has(key));
        } else {
          var folderDelBtn = row.querySelector(".mdeditor-delete-btn");
          folderDelBtn.classList.toggle("visible", revealedFolderDeleteRows.has(it.node.path));
        }
        listEl.appendChild(row);
      });

      var LONG_PRESS_MS = 350, MOVE_CANCEL_PX = 10;
      var pressTimer = null, pressStartXY = null, longPressFired = false;
      function clearPressTimer(){ clearTimeout(pressTimer); pressTimer = null; }
      function startPress(rowEl, x, y){
        if(!rowEl) return;
        var it = items[Number(rowEl.dataset.index)];
        if(!it || (it.type !== "file" && it.type !== "folder")) return;
        longPressFired = false;
        pressStartXY = { x: x, y: y };
        clearPressTimer();
        pressTimer = setTimeout(function(){
          longPressFired = true;
          if(it.type === "file"){
            var key = it.name.toLowerCase();
            revealedBookmarkRows.add(key);
            var bmBtn = rowEl.querySelector(".mdeditor-bookmark-btn");
            if(bmBtn) bmBtn.classList.add("visible");
            var delBtn = rowEl.querySelector(".mdeditor-delete-btn");
            if(delBtn) delBtn.classList.add("visible");
          } else {
            revealedFolderDeleteRows.add(it.node.path);
            var folderDelBtn = rowEl.querySelector(".mdeditor-delete-btn");
            if(folderDelBtn) folderDelBtn.classList.add("visible");
          }
        }, LONG_PRESS_MS);
      }
      function movePress(x, y){
        if(!pressStartXY) return;
        var dx = x - pressStartXY.x, dy = y - pressStartXY.y;
        if(Math.sqrt(dx*dx + dy*dy) > MOVE_CANCEL_PX) clearPressTimer();
      }
      listEl.addEventListener("touchstart", function(e){
        var t = e.touches[0];
        startPress(e.target.closest(".mdeditor-row"), t.clientX, t.clientY);
      }, {passive:true});
      listEl.addEventListener("touchmove", function(e){ var t = e.touches[0]; movePress(t.clientX, t.clientY); }, {passive:true});
      listEl.addEventListener("touchend", clearPressTimer);
      listEl.addEventListener("touchcancel", clearPressTimer);
      listEl.addEventListener("mousedown", function(e){
        startPress(e.target.closest(".mdeditor-row"), e.clientX, e.clientY);
      });
      listEl.addEventListener("mousemove", function(e){ movePress(e.clientX, e.clientY); });
      listEl.addEventListener("mouseup", clearPressTimer);
      listEl.addEventListener("mouseleave", clearPressTimer);

      function hideRevealedBookmarkRows(){
        if(!revealedBookmarkRows.size && !revealedFolderDeleteRows.size) return;
        revealedBookmarkRows.clear();
        revealedFolderDeleteRows.clear();
        var rows = listEl.querySelectorAll(".mdeditor-row");
        rows.forEach(function(rowEl){
          var it = items[Number(rowEl.dataset.index)];
          if(!it) return;
          if(it.type === "file"){
            var key = it.name.toLowerCase();
            var bmBtn = rowEl.querySelector(".mdeditor-bookmark-btn");
            if(bmBtn) bmBtn.classList.toggle("visible", bookmarkedNames.has(key));
            var delBtn = rowEl.querySelector(".mdeditor-delete-btn");
            if(delBtn) delBtn.classList.remove("visible");
          } else {
            var folderDelBtn = rowEl.querySelector(".mdeditor-delete-btn");
            if(folderDelBtn) folderDelBtn.classList.remove("visible");
          }
        });
      }

      listEl.addEventListener("click", function(e){
        var rowEl = e.target.closest(".mdeditor-row");
        if(!rowEl) return;
        var it = items[Number(rowEl.dataset.index)];
        if(!it) return;
        if(e.target.closest(".mdeditor-delete-btn")){
          longPressFired = false;
          if(it.type === "folder") confirmDeleteFolder(it, node);
          else confirmDeleteNote(it, node);
          return;
        }
        if(e.target.closest(".mdeditor-bookmark-btn")){
          toggleBookmarkNote(it.name);
          return;
        }
        hideRevealedBookmarkRows();
        if(longPressFired){ longPressFired = false; return; }
        if(it.type === "folder"){
          var prevDirNode = currentDirNode;
          pushMdNav(function(){ currentDirNode = prevDirNode; render(); });
          currentDirNode = it.node;
          render();
        } else {
          openNoteById(it.id);
        }
      });

      container.addEventListener("click", function(e){
        if(!e.target.closest(".mdeditor-row")) hideRevealedBookmarkRows();
      });
    }
  }

  function openNewNoteDialog(targetNode){
    var box = document.querySelector(".settings-modal-box");
    if(!box) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title">Имя новой заметки</div>' +
      '<input type="text" class="mdeditor-cleanup-input" id="mdEditorNewNoteInput">' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="mdEditorNewNoteCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="mdEditorNewNoteCreate">Создать</button>' +
      '</div>';
    overlay.appendChild(card);
    box.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });

    var input = document.getElementById("mdEditorNewNoteInput");
    input.focus();

    function submit(){
      var name = (input.value || "").trim();
      if(!name) return;
      if(isNoteNameTaken(name)){
        input.style.borderColor = "var(--danger, #c0392b)";
        return;
      }
      close();
      createAndOpenNoteInPath(name, targetNode);
    }
    document.getElementById("mdEditorNewNoteCancel").addEventListener("click", close);
    document.getElementById("mdEditorNewNoteCreate").addEventListener("click", submit);
    document.getElementById("mdEditorNewNoteCreate").addEventListener("mousedown", function(ev){ ev.preventDefault(); });
    input.addEventListener("keydown", function(ev){
      if(ev.key === "Enter"){ ev.preventDefault(); submit(); }
      else if(ev.key === "Escape"){ ev.preventDefault(); close(); }
    });
  }

  // ---------------------------------------------------------------------
  // Удаление заметки из общего списка — крестик, появляющийся вместе с
  // кнопкой закладки по долгому нажатию (см. renderListScreen выше, ТЗ
  // пользователя от 05.09). Подтверждение — тот же overlay/card, что и у
  // openNewNoteDialog/openCleanupDialog выше.
  // ---------------------------------------------------------------------
  function confirmDeleteNote(it, node){
    var box = document.querySelector(".settings-modal-box");
    if(!box) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title"></div>' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="mdEditorDeleteNoteCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-danger" id="mdEditorDeleteNoteConfirm">Удалить</button>' +
      '</div>';
    card.querySelector(".mdeditor-cleanup-title").textContent = 'Удалить заметку «' + it.name + '»?';
    overlay.appendChild(card);
    box.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });
    document.getElementById("mdEditorDeleteNoteCancel").addEventListener("click", close);
    document.getElementById("mdEditorDeleteNoteConfirm").addEventListener("click", function(){
      close();
      deleteNoteEntry(it, node);
    });
  }

  function deleteNoteEntry(it, node){
    var key = it.name.toLowerCase();
    deleteNoteRecord(it.id);
    if(bookmarkedNames.has(key)){
      bookmarkedNames.delete(key);
      setSyncedBookmark(key, false);
    }
    revealedBookmarkRows.delete(key);
    rebuildTree();
    var container = document.getElementById("settingsTabContent");
    if(container) renderListScreen(container);
  }

  // ---------------------------------------------------------------------
  // Удаление папки целиком — тот же крестик по долгому нажатию, что и у
  // заметок (ТЗ пользователя от 06.09), только удаляет ВСЕ заметки, чей
  // `path` совпадает с папкой или лежит внутри неё (включая вложенные
  // подпапки) — папки как отдельной сущности в хранилище нет (раздел 2
  // ТЗ: папка — это просто общий префикс `path`, см. buildTreeFromNotes),
  // поэтому "удалить папку" на практике значит "удалить эти заметки".
  // ---------------------------------------------------------------------
  function collectNoteIdsInFolder(folderPathStr){
    var ids = [];
    notesMap.forEach(function(rec, id){
      if(!rec || rec.deleted || !rec.name) return;
      if(rec.path === folderPathStr || (rec.path && rec.path.indexOf(folderPathStr + "/") === 0)){
        ids.push(id);
      }
    });
    return ids;
  }

  function confirmDeleteFolder(it, node){
    var box = document.querySelector(".settings-modal-box");
    if(!box) return;
    var count = collectNoteIdsInFolder(it.node.path).length;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title"></div>' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="mdEditorDeleteFolderCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-danger" id="mdEditorDeleteFolderConfirm">Удалить</button>' +
      '</div>';
    card.querySelector(".mdeditor-cleanup-title").textContent = count > 0
      ? 'Удалить папку «' + it.name + '» и все заметки внутри неё (' + count + ')? Это нельзя отменить.'
      : 'Удалить пустую папку «' + it.name + '»?';
    overlay.appendChild(card);
    box.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });
    document.getElementById("mdEditorDeleteFolderCancel").addEventListener("click", close);
    document.getElementById("mdEditorDeleteFolderConfirm").addEventListener("click", function(){
      close();
      deleteFolderEntry(it, node);
    });
  }

  function deleteFolderEntry(it, node){
    var ids = collectNoteIdsInFolder(it.node.path);
    ids.forEach(function(id){
      var rec = notesMap.get(id);
      if(rec){
        var key = rec.name.toLowerCase();
        if(bookmarkedNames.has(key)){
          bookmarkedNames.delete(key);
          setSyncedBookmark(key, false);
        }
        revealedBookmarkRows.delete(key);
      }
      deleteNoteRecord(id);
    });
    revealedFolderDeleteRows.delete(it.node.path);
    rebuildTree();
    var container = document.getElementById("settingsTabContent");
    if(container) renderListScreen(container);
  }

  function renderBookmarksScreen(container){
    var items = [];
    bookmarkedNames.forEach(function(key){
      var id = nameIndex.get(key);
      var rec = id ? notesMap.get(id) : null;
      if(rec && !rec.deleted) items.push({ name: rec.name, id: id });
    });
    items.sort(function(a, b){
      var da = /^\d/.test(a.name) ? 1 : 0;
      var db = /^\d/.test(b.name) ? 1 : 0;
      if(da !== db) return da - db;
      return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
    });

    var html = '<div class="mdeditor-tab">';
    html += '<h3 class="workbooks-title" style="margin:0 0 4px 0;">Закладки</h3>';
    if(!items.length){
      html += '<div class="mdeditor-empty">Пока нет ни одной заметки в закладках.<br>Чтобы добавить: удержите заметку в общем списке или нажмите на значок закладки в открытой заметке.</div>';
    } else {
      html += '<div class="mdeditor-list" id="mdBookmarksList"></div>';
    }
    html += '<div class="mdeditor-fab-row">';
    html += '<button type="button" class="mdeditor-fab-btn" id="mdBookmarksHomeBtn" title="Наверх списка">' + HOME_ICON_SVG + '</button>';
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    var homeBtn = document.getElementById("mdBookmarksHomeBtn");
    if(homeBtn){
      homeBtn.addEventListener("click", function(){
        var sc = document.getElementById("settingsTabContent");
        if(sc) sc.scrollTop = 0;
      });
    }

    var listEl = document.getElementById("mdBookmarksList");
    if(listEl){
      items.forEach(function(it){
        var row = document.createElement("div");
        row.className = "mdeditor-row";
        row.innerHTML = FILE_ICON_SVG + '<span class="mdeditor-row-name"></span>' +
          '<button type="button" class="mdeditor-bookmark-btn active visible" title="Убрать из закладок">' + BOOKMARK_ICON_SVG + '</button>';
        row.querySelector(".mdeditor-row-name").textContent = it.name;
        row.addEventListener("click", function(){
          openNoteById(it.id);
        });
        row.querySelector(".mdeditor-bookmark-btn").addEventListener("click", function(e){
          e.stopPropagation();
          toggleBookmarkNote(it.name);
        });
        listEl.appendChild(row);
      });
    }
  }

  // ---------------------------------------------------------------------
  // Вкладка "Забытые заметки" (4-я вкладка вертикального стека второго
  // набора, set2s_4 — ТЗ пользователя от 04.09). Стиль текста/кнопок/
  // подписей взят у "Объединение заметок" (см. workbooks-title и
  // .settings-content-bottom в jwlmerge.js), строка списка — тот же вид,
  // что и в "Моём блокноте" (.mdeditor-row/.mdeditor-list, включая
  // закладку по долгому нажатию, см. renderListScreen выше), пилюли
  // периода — тот же вид и поведение, что и на вкладке "Обзор"
  // (.review-pill/.review-pills, см. renderReviewTabContent в my.js: клик
  // по пилюле пересчитывает список сразу, без переоткрытия вкладки).
  //
  // "Забытая" = дата последнего ОТКРЫТИЯ заметки (не редактирования, ТЗ
  // пользователя от 05.09) старше выбранного периода. Список — ВСЕ заметки
  // во всех папках (тот же плоский nameIndex, что и для [[ссылок]]), не
  // только текущая. Даты открытия берутся ОДИН раз при каждом открытии
  // вкладки из openedIndex (см. forgottenNotesData/loadOpenedIndex ниже,
  // сбрасывается в null при каждом заходе на вкладку) — это чтение одного
  // маленького объекта из IndexedDB, а не файлов с диска, поэтому
  // укладывается в доли секунды даже на большой библиотеке; переключение
  // пилюль внутри уже открытой вкладки только перефильтровывает уже
  // прочитанное.
  // Пороги — календарные месяцы (setMonth), а не фиксированное число дней:
  // "2 месяца назад" от 31 марта и от 30 апреля — разные даты, и это
  // важнее на длинных интервалах (полгода/год), чем на "2 неделях" раньше.
  // Фильтрация — ПОЛОСАМИ (band), не кумулятивная: пилюля "2 мес."
  // показывает заметки, не открывавшиеся от 2 до 6 месяцев (до границы
  // следующей пилюли), "6 мес." — от 6 месяцев до года, "1 год" — год и
  // дальше без верхней границы. Раньше было кумулятивно ("не открывалось
  // ХОТЯ БЫ N назад"), из-за чего "2 мес." включала в себя всё то же, что
  // и "6 мес."/"1 год", и пилюли выглядели одинаково (ТЗ пользователя от
  // 05.09, схема с полосами на таймлайне).
  function monthsAgoTs(n){
    var d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.getTime();
  }
  var FORGOTTEN_PERIODS = [
    { key: "2m", label: "2 мес.", months: 2 },
    { key: "6m", label: "6 мес.", months: 6 },
    { key: "1y", label: "1 год", months: 12 }
  ];
  // Полоса для пилюли под индексом periodIndex — от её порога до порога
  // следующей по старшинству пилюли (у последней верхней границы нет,
  // см. пояснение у самой фильтрации ниже). Вынесено в отдельную функцию,
  // т.к. используется дважды: для самого списка на экране и для
  // автовыбора первой непустой пилюли при заходе на вкладку (см.
  // renderSettingsTabForgottenNotes, ТЗ пользователя от 05.09).
  function filterForgottenByPeriod(items, periodIndex){
    var period = FORGOTTEN_PERIODS[periodIndex];
    var thresholdTs = monthsAgoTs(period.months);
    var nextPeriod = FORGOTTEN_PERIODS[periodIndex + 1];
    var nextThresholdTs = nextPeriod ? monthsAgoTs(nextPeriod.months) : null;
    return items.filter(function(it){
      if(it.openedTs > thresholdTs) return false;
      if(nextThresholdTs !== null && it.openedTs <= nextThresholdTs) return false;
      return true;
    });
  }
  // Первая непустая пилюля (по возрастанию давности) для данного набора
  // заметок, или -1, если пусты все три полосы (в теории невозможно, если
  // в библиотеке вообще есть заметки, — учтено экраном как отдельный
  // случай, см. renderForgottenNotesScreen).
  function pickFirstNonEmptyPeriodIndex(items){
    for(var i = 0; i < FORGOTTEN_PERIODS.length; i++){
      if(filterForgottenByPeriod(items, i).length > 0) return i;
    }
    return -1;
  }
  var forgottenSelectedPeriod = "2m";
  var forgottenNotesData = null; // null — ещё не прочитано (см. loadForgottenNotesData) в этом заходе на вкладку; после — { items, matchedCount, total }
  // защита от повторного запуска чтения поверх уже идущего (см. пояснение
  // у renderForgottenNotesScreen ниже — раньше двойной render() в
  // initFromStoredHandle из-за кэша-"слепка" запускал loadForgottenNotesData
  // ДВАЖДЫ параллельно, что и было настоящей причиной затянутой загрузки)
  var forgottenLoadPromise = null;

  function renderSettingsTabForgottenNotes(){
    activeMdTab = "forgotten";
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(!initStarted){
      initStarted = true;
      container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
      initNotesModule();
      return;
    }
    forgottenSelectedPeriod = "2m";
    forgottenNotesData = null;
    render();
    syncNotesOnTabEnter();
  }

  // Не читает ни одного файла и не обращается к сети — просто проход по
  // notesMap в памяти (раздел 05.09 ТЗ про производительность этой
  // вкладки полностью применим и здесь: заметки уже загружены заранее).
  async function loadForgottenNotesData(){
    var entries = [];
    notesMap.forEach(function(rec, id){
      if(!rec || rec.deleted || !rec.name) return;
      entries.push({ name: rec.name, id: id });
    });
    var openedIndex = await loadOpenedIndex();
    var virtualMs = virtualLegacyOpenedMs();
    var matchedCount = 0;
    var results = entries.map(function(entry){
      var key = entry.name.toLowerCase();
      var hasReal = Object.prototype.hasOwnProperty.call(openedIndex, key) && typeof openedIndex[key] === "number";
      if(hasReal) matchedCount++;
      return { name: entry.name, entry: entry.id, openedTs: hasReal ? openedIndex[key] : virtualMs };
    });
    results.sort(function(a, b){ return a.openedTs - b.openedTs; });
    return { items: results, matchedCount: matchedCount, total: entries.length };
  }

  function renderForgottenNotesScreen(container){
    if(forgottenNotesData === null){
      if(window.Debug) window.Debug.log("forgotten:render:loading-branch", { alreadyInFlight: !!forgottenLoadPromise });
      container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
      // если чтение уже идёт (см. forgottenLoadPromise выше) — просто
      // подписываемся на РЕЗУЛЬТАТ ТОГО ЖЕ вызова, а не запускаем вторую
      // независимую загрузку поверх первой (именно это раньше и
      // происходило при двойном render() из initFromStoredHandle, см.
      // пояснение у forgottenLoadPromise выше)
      if(!forgottenLoadPromise){
        forgottenLoadPromise = loadForgottenNotesData();
      }
      forgottenLoadPromise.then(function(data){
        forgottenLoadPromise = null;
        // пока читали — могли уйти с вкладки; тогда результат уже не нужен
        if(activeMdTab !== "forgotten") return;
        forgottenNotesData = data;
        // Автовыбор пилюли ровно один раз, сразу после свежей загрузки
        // (не при каждой перерисовке — переключение вкладок сбрасывает
        // forgottenSelectedPeriod на "2m" и обнуляет forgottenNotesData
        // выше, в renderSettingsTabForgottenNotes, так что этот блок
        // выполняется один раз на заход на вкладку): если у "2 мес."
        // пусто — переключаемся на "6 мес.", если и там пусто — на
        // "1 год". Если пусты все три полосы — оставляем последнюю
        // пилюлю ("1 год") выбранной, экран покажет отдельное сообщение
        // о том, что забытых заметок вообще нет ни в одной полосе (ТЗ
        // пользователя от 05.09: такого не может быть, но на всякий
        // случай обработано явно, а не тихо остаётся на пустой "2 мес.").
        var autoIndex = pickFirstNonEmptyPeriodIndex(data.items);
        forgottenSelectedPeriod = FORGOTTEN_PERIODS[autoIndex >= 0 ? autoIndex : FORGOTTEN_PERIODS.length - 1].key;
        render();
      }).catch(function(e){
        forgottenLoadPromise = null;
        // раньше при любой ошибке внутри загрузки экран так и оставался
        // молча висеть на "Загрузка…" без объяснений (непойманный отказ
        // промиса, см. ТЗ пользователя от 05.09) — теперь хотя бы видно,
        // что что-то пошло не так, и можно повторить
        if(activeMdTab !== "forgotten") return;
        if(window.Debug) window.Debug.log("forgotten:load:CATCH (не должно было сюда дойти после withTimeout)", e && (e.message || String(e)));
        container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Не удалось прочитать список заметок' +
          (e && e.message ? " (" + escName(e.message) + ")" : "") + '.</div>';
      });
      return;
    }

    var periodIndex = 0;
    for(var pi = 0; pi < FORGOTTEN_PERIODS.length; pi++){
      if(FORGOTTEN_PERIODS[pi].key === forgottenSelectedPeriod){ periodIndex = pi; break; }
    }
    var items = filterForgottenByPeriod(forgottenNotesData.items, periodIndex);

    // Счётчик покрытия индекса дат открытия (ТЗ пользователя от 05.09):
    // "315/315" — у всех заметок уже есть настоящая дата открытия;
    // "308/315" — у 7 её ещё нет (используется виртуальная "6 месяцев
    // назад", см. loadForgottenNotesData), они станут учтены сами по себе,
    // как только пользователь их откроет хотя бы раз. Строка не нужна,
    // когда список пуст — там просто нечего "покрывать" на экране (ТЗ
    // пользователя от 05.09).
    var coverageLine = !items.length ? "" : '<div class="mdeditor-hint" style="margin:8px 0 0 0;font-size:0.85em;opacity:0.7;">' +
      'Данные об открытии: ' + forgottenNotesData.matchedCount + '/' + forgottenNotesData.total +
      (forgottenNotesData.matchedCount < forgottenNotesData.total ? ' (для остальных — оценка «6 мес.»)' : '') +
      '</div>';

    // Пилюли переключателя периода вынесены из обычного потока вкладки
    // (были в самом низу, после списка и строки покрытия, прижаты через
    // margin-top:auto у .settings-content-bottom — до них приходилось
    // докручивать длинный список) — теперь это отдельный плавающий ряд
    // (.mdeditor-forgotten-pills, см. modals.css), который всегда виден
    // поверх списка независимо от прокрутки, тем же приёмом, что и
    // .mdeditor-fab-row (position:absolute от .settings-modal-box, ТЗ
    // пользователя от 05.09). Кнопки внутри — те же .review-pill, что и
    // раньше, стиль не меняется.
    var pillsHtml = '<div class="mdeditor-forgotten-pills" id="mdForgottenPills">' + FORGOTTEN_PERIODS.map(function(p){
      return '<button type="button" class="review-pill' + (p.key === forgottenSelectedPeriod ? " active" : "") + '" data-period="' + p.key + '">' + escName(p.label) + '</button>';
    }).join("") + '</div>';

    var html = '<div class="mdeditor-tab mdeditor-forgotten-tab">';
    html += '<h3 class="workbooks-title" style="margin:0 0 4px 0;">Забытые заметки</h3>';
    if(!items.length){
      // Крайний случай (в теории невозможен, если в библиотеке вообще
      // есть заметки, — см. пояснение у pickFirstNonEmptyPeriodIndex
      // выше): пусты ВСЕ три полосы, а не только выбранная сейчас —
      // тогда обычное "за период нет" вводило бы в заблуждение (можно
      // было бы подумать, что стоит попробовать другую пилюлю), поэтому
      // отдельное сообщение (ТЗ пользователя от 05.09).
      var allEmpty = pickFirstNonEmptyPeriodIndex(forgottenNotesData.items) === -1;
      html += '<div class="mdeditor-empty">' + (allEmpty ?
        'Забытых заметок нет ни в одной из полос — похоже, все заметки открывались недавно.' :
        'За выбранный период забытых заметок нет.') + '</div>';
    } else {
      html += '<div class="mdeditor-list" id="mdForgottenList"></div>';
    }
    html += coverageLine;
    html += '</div>';
    html += pillsHtml;
    container.innerHTML = html;

    var listEl = document.getElementById("mdForgottenList");
    if(listEl){
      items.forEach(function(it){
        var row = document.createElement("div");
        row.className = "mdeditor-row";
        var key = it.name.toLowerCase();
        var bookmarked = bookmarkedNames.has(key);
        row.innerHTML = FILE_ICON_SVG + '<span class="mdeditor-row-name"></span>' +
          '<button type="button" class="mdeditor-bookmark-btn' + (bookmarked ? " active visible" : "") + '" title="Закладка">' + BOOKMARK_ICON_SVG + '</button>';
        row.querySelector(".mdeditor-row-name").textContent = it.name;
        row.addEventListener("click", function(){
          // см. пояснение выше про activeMdTab — без этого render() после
          // открытия заметки продолжил бы показывать список "Забытых",
          // а не саму заметку (тот же приём нужен и в renderBookmarksScreen,
          // но её не трогаем — не входит в эту задачу)
          activeMdTab = "editor";
          openNoteById(it.entry);
        });
        row.querySelector(".mdeditor-bookmark-btn").addEventListener("click", function(e){
          e.stopPropagation();
          // сама перерисовка строки (снятие/наведение "активности" кнопки)
          // происходит внутри toggleBookmarkNote — она уже знает про
          // activeMdTab === "forgotten" (см. правку в toggleBookmarkNote
          // выше) и сама вызовет renderForgottenNotesScreen заново
          toggleBookmarkNote(it.name);
        });
        listEl.appendChild(row);
      });
    }

    Array.prototype.forEach.call(container.querySelectorAll(".review-pill"), function(btn){
      btn.addEventListener("click", function(){
        forgottenSelectedPeriod = btn.getAttribute("data-period");
        render();
      });
    });
  }

  function renderEditorScreen(container){
    fontSizePanelOpen = false; // экран перерисован заново — попап "+"/"-" каждый раз стартует закрытым
    formatPanelOpen = false; // и попап "Ж"/"К"/"П"/"Ч" тоже
    container.innerHTML =
      '<div class="mdeditor-tab mdeditor-editor-tab">' +
        '<div class="mdeditor-title-row" id="mdEditorTitleRow">' +
          '<span class="mdeditor-title" id="mdEditorTitle" title="Нажмите, чтобы переименовать"></span>' +
          '<button type="button" class="mdeditor-bookmark-btn visible" id="mdEditorBookmarkBtn" title="Закладка">' + BOOKMARK_ICON_SVG + '</button>' +
        '</div>' +
        '<div class="mdeditor-dates-row" id="mdEditorDatesRow"></div>' +
        '<div class="mdeditor-links-row" id="mdEditorLinksRow"></div>' +
        '<div class="mdeditor-status" id="mdEditorStatus"></div>' +
        '<div class="mdeditor-editor-host" id="mdEditorHost"></div>' +
        '<input type="file" accept="image/*" id="mdEditorImageInput" style="display:none;">' +
        '<div class="mdeditor-fab-row">' +
          '<span class="mdeditor-fontsize-wrap" id="mdEditorFormatWrap">' +
            '<div class="mdeditor-fontsize-popup" id="mdEditorFormatPopup">' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text fmt-btn-bold" id="mdEditorFmtBoldBtn" title="Жирный">Ж</button>' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text fmt-btn-italic" id="mdEditorFmtItalicBtn" title="Курсив">К</button>' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text fmt-btn-underline" id="mdEditorFmtUnderlineBtn" title="Подчёркнутый">П</button>' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text fmt-btn-strike" id="mdEditorFmtStrikeBtn" title="Зачёркнутый">Ч</button>' +
            '</div>' +
            '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text fmt-btn-bold" id="mdEditorFormatBtn" title="Форматирование выделенного текста">Ж</button>' +
          '</span>' +
          '<span class="mdeditor-fontsize-wrap" id="mdEditorFontSizeWrap">' +
            '<div class="mdeditor-fontsize-popup" id="mdEditorFontSizePopup">' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="mdEditorFontPlusBtn" title="Крупнее">+</button>' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="mdEditorFontMinusBtn" title="Мельче">&minus;</button>' +
            '</div>' +
            '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="mdEditorFontSizeBtn" title="Размер шрифта">Аа</button>' +
          '</span>' +
          '<button type="button" class="mdeditor-fab-btn" id="mdEditorImageBtn" title="Вставить картинку">' + PAPERCLIP_ICON_SVG + '</button>' +
          '<button type="button" class="mdeditor-fab-btn" id="mdEditorDownloadBtn" title="Скачать .md">' + DOWNLOAD_ICON_SVG + '</button>' +
          '<button type="button" class="mdeditor-fab-btn" id="mdEditorModeBtn" title="Переключить режим кода">' + (codeMode ? EYE_ICON_SVG : CODE_ICON_SVG) + '</button>' +
          '<button type="button" class="mdeditor-fab-btn" id="mdEditorHomeBtn2" title="К списку заметок">' + HOME_ICON_SVG + '</button>' +
        '</div>' +
      '</div>';
    document.getElementById("mdEditorTitle").textContent = openFile.name;
    applyFontSize();

    // кнопка закладки в шапке — второй способ добавить/убрать заметку из
    // закладок (см. ТЗ пользователя), всегда видна (класс "visible" уже в
    // разметке выше), активность показана заливкой значка (см.
    // .mdeditor-bookmark-btn.active в components.css) — та же пиктограмма
    // и тот же переключатель toggleBookmarkNote, что и в общем списке/на
    // вкладке "Закладки".
    // Один делегированный обработчик клика по полю связей — переживает
    // любое количество перерисовок содержимого строки (см. renderLinksField
    // выше), в отличие от прежних addEventListener на каждый отдельный
    // .mdeditor-links-item, которые терялись при повторной перерисовке.
    var linksRow = document.getElementById("mdEditorLinksRow");
    if(linksRow){
      linksRow.addEventListener("click", function(ev){
        var item = ev.target.closest ? ev.target.closest(".mdeditor-links-item") : null;
        if(!item) return;
        handleLinkClick(item.getAttribute("data-name"));
      });
    }
    var editorBmBtn = document.getElementById("mdEditorBookmarkBtn");
    if(editorBmBtn){
      editorBmBtn.classList.toggle("active", bookmarkedNames.has(openFile.name.toLowerCase()));
      editorBmBtn.addEventListener("click", function(e){
        e.stopPropagation();
        toggleBookmarkNote(openFile.name);
      });
    }

    // "Аа" — левее скрепки (см. ТЗ пользователя от 31.08): клик открывает
    // над кнопкой две временные "+"/"-", повторный клик по "Аа" их
    // прячет — единственный способ закрыть попап (клик мимо НЕ закрывает
    // его, так и было заказано). "+"/"-" меняют fontSizeStep на одну
    // единицу (см. changeFontSizeStep выше) и сохраняются в IndexedDB, за
    // исходный размер (шаг 0) принят текущий стандартный (см.
    // FONT_SIZE_BASE_PX выше).
    document.getElementById("mdEditorFontSizeBtn").addEventListener("click", function(){
      fontSizePanelOpen = !fontSizePanelOpen;
      var popup = document.getElementById("mdEditorFontSizePopup");
      if(popup) popup.classList.toggle("open", fontSizePanelOpen);
    });
    document.getElementById("mdEditorFontPlusBtn").addEventListener("click", function(){ changeFontSizeStep(1); });
    document.getElementById("mdEditorFontMinusBtn").addEventListener("click", function(){ changeFontSizeStep(-1); });

    // "Ж" — форматирование выделенного текста, левее "Аа" (см. ТЗ
    // пользователя от 31.08): та же механика попапа, что и у "Аа" (клик
    // раскрывает столбик из четырёх кнопок над ней, повторный клик
    // прячет), но при выборе конкретного стиля (Ж/К/П/Ч) попап
    // ЗАКРЫВАЕТСЯ САМ — см. bindFormatBtn ниже. mousedown с
    // preventDefault на самой "Ж" не обязателен (CodeMirror не теряет
    // выделение при уходе фокуса), но не мешает и на всякий случай
    // держит курсор/скролл редактора на месте.
    document.getElementById("mdEditorFormatBtn").addEventListener("mousedown", function(e){ e.preventDefault(); });
    document.getElementById("mdEditorFormatBtn").addEventListener("click", function(){
      formatPanelOpen = !formatPanelOpen;
      var popup = document.getElementById("mdEditorFormatPopup");
      if(popup) popup.classList.toggle("open", formatPanelOpen);
    });
    function bindFormatBtn(id, prefix, suffix){
      var btn = document.getElementById(id);
      if(!btn) return;
      btn.addEventListener("mousedown", function(e){ e.preventDefault(); });
      btn.addEventListener("click", function(){
        wrapCmSelection(prefix, suffix);
        formatPanelOpen = false;
        var popup = document.getElementById("mdEditorFormatPopup");
        if(popup) popup.classList.remove("open");
      });
    }
    bindFormatBtn("mdEditorFmtBoldBtn", "**", "**");
    bindFormatBtn("mdEditorFmtItalicBtn", "*", "*");
    bindFormatBtn("mdEditorFmtUnderlineBtn", "++", "++");
    bindFormatBtn("mdEditorFmtStrikeBtn", "~~", "~~");

    // "скрепка" — правее "Аа", левее переключателя кода (см. ТЗ
    // пользователя от 31.08), в том же стиле .mdeditor-fab-btn, что и
    // остальные кнопки ряда. Вставляет картинку, выбранную через системный
    // диалог, в место курсора — сама картинка при этом копируется В КОРЕНЬ
    // папки с изображениями (раздел 8 ТЗ: без принудительной подпапки
    // "files", в отличие от старой схемы) через insertImageAtCursor ниже.
    // Если папка ещё не подключена (или её права пришлось запрашивать
    // заново) — сначала пробуем добиться готовности тем же кликом
    // (ensureImagesReady, см. выше), и только при успехе открываем выбор
    // файла. В редком случае, когда сохранённый handle потерял права И
    // пришлось бы показать ЕЩЁ и системный диалог выбора папки в рамках
    // ТОГО ЖЕ клика — браузер может не засчитать это как пользовательский
    // жест дважды подряд; тогда просто просим повторить клик (см. catch
    // ниже) — не критично, но подпись кнопки уже покажет актуальное
    // состояние после первой попытки.
    document.getElementById("mdEditorImageBtn").addEventListener("click", function(){
      ensureImagesReady().then(function(ok){
        if(!ok){
          setStatus("Чтобы вставлять картинки, подключите папку с изображениями (кнопка в общем списке заметок).", true);
          return;
        }
        var input = document.getElementById("mdEditorImageInput");
        if(input) input.click();
      });
    });
    document.getElementById("mdEditorImageInput").addEventListener("change", function(){
      var input = document.getElementById("mdEditorImageInput");
      var file = input.files && input.files[0];
      input.value = ""; // разрешаем выбрать тот же файл ещё раз
      if(file) insertImageAtCursor(file);
    });

    document.getElementById("mdEditorDownloadBtn").addEventListener("click", downloadSingleNote);


    document.getElementById("mdEditorHomeBtn2").addEventListener("click", function(){
      var prevScreen = screen, prevDirNode = currentDirNode, prevOpenFile = openFile;
      pushMdNav(function(){
        flushAutosaveNow();
        destroyEditor();
        openFile = prevOpenFile;
        currentDirNode = prevDirNode;
        screen = prevScreen;
        render();
      });
      goHome();
    });
    document.getElementById("mdEditorModeBtn").addEventListener("click", function(){
      setCodeMode(!codeMode);
      var btn = document.getElementById("mdEditorModeBtn");
      if(btn) btn.innerHTML = codeMode ? EYE_ICON_SVG : CODE_ICON_SVG;
      // поле связей не показывается в режиме "с кодом" (см. ТЗ
      // пользователя от 31.08) — сама разметка/список уже посчитаны,
      // тут только скрыть/показать строку, без пересчёта.
      applyLinksFieldVisibility();
    });
    document.getElementById("mdEditorTitle").addEventListener("click", startRename);

    mountEditor();
    applyLinksFieldVisibility();
    refreshLinksField();
    refreshDatesField();
  }

  // Поле дат над заметкой (#mdEditorDatesRow, см. renderEditorScreen выше)
  // — просто две даты через " · ", без подписей, по центру (ТЗ
  // пользователя от 04.09): дата создания слева, редактирования справа,
  // совпадают, если заметку ни разу не редактировали. Источник — метаданные
  // из текста заметки, либо виртуальная "давность 6 месяцев" для старых
  // заметок без метаданных (см. getNoteDatesRu выше).
  function refreshDatesField(){
    var row = document.getElementById("mdEditorDatesRow");
    if(!row || !openFile) return;
    var dates = getNoteDatesRu(openFile.text);
    row.textContent = dates.created + " · " + dates.updated;
  }

  function goHome(){
    flushAutosaveNow();
    pushDirtyNotes(true);
    destroyEditor();
    openFile = null;
    currentDirNode = rootTree;
    screen = "list";
    render();
    persistDocStateNow({ screen: "list", id: null, name: null, cursorPos: 0, scrollPercent: null });
  }

  // Жест/кнопка "назад" внутри "Моего блокнота" теперь не обрабатывается
  // отдельной функцией — каждый шаг навигации (открытие/закрытие заметки,
  // переход в папку/из папки, начало переименования) сам регистрирует
  // свою отмену в общем стеке навигации в момент перехода (см. pushMdNav
  // выше и window.AppNav в my.js), так что "назад" срабатывает
  // единообразно со всем остальным приложением.

  // ---- переименование через шапку (замена заголовка на поле ввода) ----
  function startRename(){
    if(renaming || !openFile) return;
    renaming = true;
    pushMdNav(function(){ renaming = false; render(); });
    var row = document.getElementById("mdEditorTitleRow");
    var titleEl = document.getElementById("mdEditorTitle");
    if(!row || !titleEl) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "mdeditor-title-input";
    input.value = openFile.name;
    var okBtn = document.createElement("button");
    okBtn.type = "button"; okBtn.className = "mdeditor-title-confirm"; okBtn.title = "Сохранить имя"; okBtn.innerHTML = "&#10003;";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button"; cancelBtn.className = "mdeditor-title-cancel"; cancelBtn.title = "Отмена"; cancelBtn.innerHTML = "&times;";

    row.replaceChild(input, titleEl);
    row.appendChild(okBtn);
    row.appendChild(cancelBtn);
    input.focus();
    input.select();

    function finish(commit){
      renaming = false;
      if(commit) commitRename(input.value);
      else render();
    }
    okBtn.addEventListener("click", function(){ finish(true); });
    cancelBtn.addEventListener("click", function(){ finish(false); });
    // mousedown с preventDefault ДО click — иначе на телефоне первый тап по
    // кнопке сначала уводит фокус с поля ввода (закрывается виртуальная
    // клавиатура), из-за чего разметка сдвигается ДО того, как успевает
    // сработать сам клик — палец в этот момент уже промахивается мимо
    // сдвинувшейся кнопки, и клик пропадает: приходилось нажимать "птичку"
    // второй раз, уже когда клавиатура закрыта и всё устоялось (ТЗ
    // пользователя от 31.08). preventDefault на mousedown не даёт полю
    // потерять фокус раньше времени, поэтому сдвига до клика не происходит.
    okBtn.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
    cancelBtn.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
    input.addEventListener("keydown", function(ev){
      if(ev.key === "Enter"){ ev.preventDefault(); finish(true); }
      else if(ev.key === "Escape"){ ev.preventDefault(); finish(false); }
    });
  }

  function commitRename(newNameRaw){
    var newName = (newNameRaw || "").trim();
    if(!newName || newName === openFile.name){ render(); return; }
    if(isNoteNameTaken(newName, openFile.id)){
      setStatusAndRerenderTitle("Заметка с таким именем уже есть.", true);
      return;
    }
    var oldName = openFile.name;
    renameNoteRecord(openFile.id, newName);
    openFile.name = newName;
    if(bookmarkedNames.has(oldName.toLowerCase())){
      bookmarkedNames.delete(oldName.toLowerCase());
      bookmarkedNames.add(newName.toLowerCase());
      setSyncedBookmark(oldName.toLowerCase(), false);
      setSyncedBookmark(newName.toLowerCase(), true);
    }
    propagateRenameInMemory(oldName, newName);
    rebuildTree();
    setStatusAndRerenderTitle("Переименовано.", false);
    render();
  }

  function setStatusAndRerenderTitle(msg, isError){
    setStatus(msg, isError);
  }

  // ---------------------------------------------------------------------
  // Открытие заметки — id вместо fileHandle/dirHandle (раздел 2 ТЗ). Закрытие
  // ПРЕДЫДУЩЕЙ открытой заметки шлёт её в облако немедленно (раздел 4.1 ТЗ:
  // "при закрытии открытой заметки"), не дожидаясь debounce.
  // ---------------------------------------------------------------------
  function openNoteById(id, restorePos, scrollPercent){
    var rec = notesMap.get(id);
    if(!rec || rec.deleted){
      setStatus("Заметка не найдена.", true);
      return;
    }
    var prevScreen = screen, prevDirNode = currentDirNode, prevOpenFile = openFile;
    var prevScrollTop = null;
    if(prevScreen === "list"){
      var scrollHost = document.getElementById("settingsTabContent");
      if(scrollHost) prevScrollTop = scrollHost.scrollTop;
    }
    pushMdNav(function(){
      flushAutosaveNow();
      pushDirtyNotes(true);
      destroyEditor();
      openFile = prevOpenFile;
      currentDirNode = prevDirNode;
      screen = prevScreen;
      render();
      if(prevScrollTop !== null){
        var restoredScrollHost = document.getElementById("settingsTabContent");
        if(restoredScrollHost) restoredScrollHost.scrollTop = prevScrollTop;
      }
    });
    flushAutosaveNow();
    pushDirtyNotes(true);
    destroyEditor();
    var pos = typeof restorePos === "number" ? Math.max(0, Math.min(restorePos, rec.text.length)) : 0;
    var pct = typeof scrollPercent === "number" ? Math.max(0, Math.min(1, scrollPercent)) : null;
    openFile = { id: id, name: rec.name, path: rec.path, text: rec.text, dirty: false, cursorPos: pos, scrollPercent: pct };
    screen = "editor";
    recordNoteOpened(rec.name);
    render();
    persistDocStateNow({ screen: "editor", id: id, name: rec.name, cursorPos: pos, scrollPercent: pct });
  }

  function createAndOpenNoteInPath(name, targetNode){
    var path = targetNode ? targetNode.path : "";
    if(isNoteNameTaken(name)){
      setStatus("Заметка с таким именем уже есть.", true);
      return;
    }
    var rec = createNoteRecord(name, path);
    recordNoteCreated(name);
    recordNoteOpened(name);
    rebuildTree();
    var prevScreen = screen, prevDirNode = currentDirNode, prevOpenFile = openFile;
    var prevScrollTop = null;
    if(prevScreen === "list"){
      var scrollHost = document.getElementById("settingsTabContent");
      if(scrollHost) prevScrollTop = scrollHost.scrollTop;
    }
    pushMdNav(function(){
      flushAutosaveNow();
      pushDirtyNotes(true);
      destroyEditor();
      openFile = prevOpenFile;
      currentDirNode = prevDirNode;
      screen = prevScreen;
      render();
      if(prevScrollTop !== null){
        var restoredScrollHost = document.getElementById("settingsTabContent");
        if(restoredScrollHost) restoredScrollHost.scrollTop = prevScrollTop;
      }
    });
    flushAutosaveNow();
    pushDirtyNotes(true);
    destroyEditor();
    openFile = { id: rec.id, name: rec.name, path: rec.path, text: rec.text, dirty: false };
    screen = "editor";
    render();
  }

  function handleLinkClick(name){
    var trimmed = (name || "").trim();
    if(!trimmed || !notesReady) return;
    var id = nameIndex.get(trimmed.toLowerCase());
    if(id) openNoteById(id);
    else createAndOpenNoteInPath(trimmed, null);
  }

  // ---------------------------------------------------------------------
  // Поле связей заметки — строка под заголовком (см. #mdEditorLinksRow в
  // renderEditorScreen выше), автоматически собранная из ИСХОДЯЩИХ
  // [[ссылок]] текущего текста и ВХОДЯЩИХ ("обратных") ссылок — других
  // заметок, у которых в тексте есть [[эта заметка]]. Сама по себе не
  // редактируется — единственный способ убрать ссылку из поля — убрать
  // её из текста заметки (своей или чужой), см. ТЗ пользователя от
  // 31.08. Не показывается в режиме "с кодом" (см. applyLinksFieldVisibility
  // и клик по mdEditorModeBtn выше).
  // ---------------------------------------------------------------------

  // Все обычные [[ссылки]] в тексте (без учёта встроенных картинок
  // "![[имя]]" — та же логика различения по ведущему "!", что и в
  // buildDecorations/imgRe ниже, но здесь достаточно простого
  // negative lookbehind вместо ручного разбора claims). Возвращает
  // ИМЕНА КАК НАПИСАНЫ в тексте (обрезанные по краям), без дедупликации.
  var OUTGOING_LINK_RE = /(?<!!)\[\[([^\[\]\n]+)\]\]/g;
  function extractOutgoingLinkNames(text){
    var out = [];
    if(!text) return out;
    OUTGOING_LINK_RE.lastIndex = 0;
    var m;
    while((m = OUTGOING_LINK_RE.exec(text))){
      var nm = m[1].trim();
      if(nm) out.push(nm);
      if(m[0].length === 0) OUTGOING_LINK_RE.lastIndex++;
    }
    return out;
  }

  function resolveLinkDisplayName(rawName){
    var trimmed = (rawName || "").trim();
    if(!trimmed) return trimmed;
    var id = nameIndex.get(trimmed.toLowerCase());
    var rec = id ? notesMap.get(id) : null;
    return rec ? rec.name : trimmed;
  }

  function applyLinksFieldVisibility(){
    var row = document.getElementById("mdEditorLinksRow");
    if(row) row.classList.toggle("code-hidden", codeMode);
  }

  function scheduleLinksFieldRefresh(){
    if(linksDebounceTimer) clearTimeout(linksDebounceTimer);
    linksDebounceTimer = setTimeout(function(){ refreshLinksField(); }, 700);
  }

  function sortedLinkNames(map){
    var names = Array.from(map.values());
    names.sort(function(a, b){ return a.localeCompare(b, "ru"); });
    return names;
  }

  // Пересобирает и перерисовывает поле связей текущей открытой заметки —
  // ТОЛЬКО исходящие [[ссылки]] из ЖИВОГО текста в CodeMirror, простым
  // синхронным regex по уже загруженному тексту, без единого обращения к
  // файловой системе.
  //
  // Раньше здесь ВТОРЫМ, асинхронным проходом досчитывались ещё и
  // ВХОДЯЩИЕ ("обратные") ссылки — для этого при КАЖДОМ открытии заметки
  // приходилось читать содержимое ВСЕХ .md файлов в блокноте целиком
  // (см. историю правок). На больших блокнотах это означало десятки/сотни
  // параллельных чтений файлов через File System Access API при каждом
  // открытии заметки — и именно это оказалось причиной ощутимых зависаний
  // (список переставал откликаться на нажатия, пока шёл обход) — см. ТЗ
  // пользователя от 31.08: "не нужно пересчитывать все файлы сразу".
  // Обратные ссылки убраны совсем, а не заменены на кэш — кэш всё равно
  // потребовал бы хотя бы ОДИН полный обход всех файлов, чтобы его
  // построить (та же тяжёлая операция, просто отложенная), а поддержание
  // его в актуальном состоянии (правки в ЛЮБОЙ другой заметке могут
  // добавить/убрать ссылку на текущую) потребовало бы либо пересчитывать
  // его заново на каждое сохранение любого файла, либо жить с устаревшими
  // данными — в обоих случаях выигрыш по сравнению с "просто не считать"
  // сомнительный, а сложность заметно выше.
  function refreshLinksField(){
    if(!openFile) return;
    var text = cmView ? cmView.state.doc.toString() : openFile.text;
    var outgoingRaw = extractOutgoingLinkNames(text);
    var selfKey = openFile.name.toLowerCase();
    var map = new Map(); // ключ — имя в нижнем регистре, значение — имя для показа
    outgoingRaw.forEach(function(raw){
      var key = raw.toLowerCase();
      if(!key || key === selfKey) return; // ссылка заметки саму на себя в поле не показываем
      if(!map.has(key)) map.set(key, resolveLinkDisplayName(raw));
    });
    renderLinksField(sortedLinkNames(map));
  }

  function renderLinksField(names){
    var row = document.getElementById("mdEditorLinksRow");
    if(!row) return;
    if(!names.length){
      row.innerHTML = "";
      applyLinksFieldVisibility();
      return;
    }
    row.innerHTML = names.map(function(nm){
      return '<span class="mdeditor-links-item" data-name="' + escapeHtml(nm) + '">' + escapeHtml(nm) + '</span>';
    }).join('<span class="mdeditor-links-sep">|</span>');
    // Клик обрабатывается ОДНИМ делегированным слушателем на самой строке
    // #mdEditorLinksRow (см. renderEditorScreen ниже), а не отдельным
    // addEventListener на каждый .mdeditor-links-item здесь — поле связей
    // перерисовывается ДВАЖДЫ (сразу исходящие ссылки, затем ещё раз, когда
    // подтянутся входящие, см. refreshLinksField выше), и старые
    // прибиндженные сюда обработчики каждый раз молча терялись вместе со
    // старой разметкой (innerHTML). Раньше именно из-за этого клик по
    // ссылке в шапке иногда не срабатывал ("ничего не дало", см. ТЗ
    // пользователя от 31.08) — переход по [[ссылке]] ПРЯМО В ТЕКСТЕ этой
    // проблемы не имел, т.к. там клик ловится один раз на весь
    // CodeMirror-хост (см. handleMouseDown), а не на сами ссылки.
    applyLinksFieldVisibility();
  }

  // ---------------------------------------------------------------------
  // Автосохранение — пишем на диск через createWritable()/write()/close()
  // с небольшой задержкой после последнего изменения; принудительный сброс
  // (flushAutosaveNow) вызывается перед уходом со вкладки/сменой заметки —
  // тем же приёмом, что и flushPendingTaskEdits/flushPendingCommentEdits
  // в my.js (см. flushPendingMdEditorEdit ниже).
  // ---------------------------------------------------------------------
  function scheduleAutosave(){
    if(!openFile) return;
    openFile.dirty = true;
    // сохраняется молча (см. ТЗ пользователя от 31.08) — статус
    // "Сохранение…" больше не показывается, только реальная ошибка
    // сохранения (см. setStatus(..., true) в flushAutosaveNow ниже).
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){ flushAutosaveNow(); }, 700);
  }

  // Некоторые источники (сайт/приложение JW Library при копировании
  // стиха, автозамена на телефоне и т.п.) подставляют вместо обычного
  // пробела "неразрывные" юникод-пробелы — глазами они неотличимы от
  // обычного, но браузер не переносит строку в этом месте. Из-за этого
  // слово перед таким пробелом иногда целиком уезжает на новую строку,
  // хотя по ширине ещё помещалось бы (переносится не оно само, а весь
  // "склеенный" им кусок текста). Чистим такие пробелы на обычные при
  // каждом автосохранении — file на диске сам "лечится" по мере
  // редактирования заметок; открытые сейчас в редакторе места
  // подхватят это уже при следующем открытии заметки.
  var INVISIBLE_SPACE_RE = /[\u00A0\u202F\u2007\u2060]/g;
  function stripInvisibleSpaces(str){
    return str.replace(INVISIBLE_SPACE_RE, " ");
  }

  // У части заметок в тексте остался лишний "/" прямо перед [[ссылкой]] —
  // след старого формата ссылок на тему (см. ТЗ пользователя от 31.08,
  // скриншот с "/[[себялюбие]]"): само по себе "/" здесь ничего не
  // значит и в текущем формате [[Название]] не участвует, поэтому просто
  // убирается, чтобы получилось "[[Название]]". Чистится тем же приёмом,
  // что и невидимые пробелы выше — при каждом автосохранении.
  var STRAY_SLASH_BEFORE_LINK_RE = /\/\[\[/g;
  function stripStraySlashBeforeLinks(str){
    return str.replace(STRAY_SLASH_BEFORE_LINK_RE, "[[");
  }

  // ---------------------------------------------------------------------
  // "Продолжить с той же заметки и с того же места" — по решению
  // пользователя от 05.09 (переход на облако) ТОЛЬКО локально на этом
  // устройстве: раньше это ехало файлом .mdeditor-state.json вместе с
  // самими заметками через Syncthing — этого канала больше нет, а
  // заводить для него отдельный облачный путь пользователь не захотел.
  // ---------------------------------------------------------------------
  var mdEditorScrollContainer = null;
  var mdEditorScrollHandler = null;
  var docStateSaveTimer = null;
  function persistDocStateNow(patch){
    for(var k in patch){ if(patch.hasOwnProperty(k)) docState[k] = patch[k]; }
    docState.updatedAt = Date.now();
    idbSet("lastNote", docState).catch(function(){});
  }
  function currentScrollPercent(){
    var sc = document.getElementById("settingsTabContent");
    if(!sc) return null;
    var max = sc.scrollHeight - sc.clientHeight;
    if(max <= 0) return 0;
    return Math.max(0, Math.min(1, sc.scrollTop / max));
  }
  function flushDocStateNow(){
    if(docStateSaveTimer){ clearTimeout(docStateSaveTimer); docStateSaveTimer = null; }
    if(!openFile || !cmView) return;
    var pos = cmView.state.selection.main.head;
    var pct = currentScrollPercent();
    openFile.cursorPos = pos;
    openFile.scrollPercent = pct;
    persistDocStateNow({ screen: "editor", id: openFile.id, name: openFile.name, cursorPos: pos, scrollPercent: pct });
  }
  function scheduleDocStateSave(){
    if(docStateSaveTimer) clearTimeout(docStateSaveTimer);
    docStateSaveTimer = setTimeout(flushDocStateNow, 500);
  }
  // Только это устройство (см. решение пользователя от 05.09) — просто
  // читаем IndexedDB, файла на диске больше нет вовсе.
  function resumeLastNoteOrShowList(){
    return idbGet("lastNote").then(function(v){
      if(v && typeof v === "object"){
        for(var k in v){ if(v.hasOwnProperty(k)) docState[k] = v[k]; }
      }
      if(docState.screen === "editor" && docState.id && notesMap.has(docState.id) && !notesMap.get(docState.id).deleted){
        openNoteById(docState.id, docState.cursorPos, docState.scrollPercent);
      } else {
        screen = "list";
        render();
      }
    }).catch(function(){
      screen = "list";
      render();
    });
  }

  // ---------------------------------------------------------------------
  // Автосохранение — теперь просто обновляет notesMap в памяти и ставит
  // заметку "грязной" для облачного пуша (раздел 3 ТЗ), вместо записи на
  // диск через createWritable()/write()/close(); никакой ретрай-логики на
  // случай "протухшего" handle больше не нужно — handle'ов не осталось.
  // ---------------------------------------------------------------------
  function flushAutosaveNow(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
    flushDocStateNow();
    if(!openFile || !cmView || !openFile.dirty) return;
    var raw = stripStraySlashBeforeLinks(stripInvisibleSpaces(cmView.state.doc.toString()));

    var meta = parseNoteMeta(raw);
    var today = todayRu();
    var bodyText = meta ? raw.slice(meta.raw.length) : raw;
    var createdForMeta = meta ? meta.created : virtualLegacyDatePairRu().created;
    var openedKey = (openFile.name || "").toLowerCase();
    var openedTsForMeta = (openedIndexCache && openedIndexCache[openedKey]) ? openedIndexCache[openedKey] : Date.now();
    var openedForMeta = formatDateRu(new Date(openedTsForMeta));
    var metaLine = buildMetaLine(createdForMeta, today, openedForMeta);
    var text = metaLine + bodyText;

    if(text !== raw){
      var oldMetaLen = meta ? meta.raw.length : 0;
      cmView.dispatch({ changes: { from: 0, to: oldMetaLen, insert: metaLine } });
    }

    openFile.dirty = false;
    openFile.text = text;
    editNoteRecordText(openFile.id, text);
    refreshDatesField();
    setStatus("", false);
  }

  // Уход со вкладки "Мой блокнот"/"Закладки" на другую вкладку настроек, при
  // открытой заметке — тоже "уход с экрана редактора" (раздел 4.1 ТЗ),
  // поэтому шлёт правки в облако немедленно, а не по debounce.
  function flushPendingMdEditorEdit(){
    flushAutosaveNow();
    pushDirtyNotes(true);
    destroyEditor();
  }

  function destroyEditor(){
    if(cmView){ cmView.destroy(); cmView = null; }
    if(mdEditorImageResizeObserver){ mdEditorImageResizeObserver.disconnect(); mdEditorImageResizeObserver = null; }
    if(linksDebounceTimer){ clearTimeout(linksDebounceTimer); linksDebounceTimer = null; }
    if(mdEditorScrollContainer && mdEditorScrollHandler){
      mdEditorScrollContainer.removeEventListener("scroll", mdEditorScrollHandler);
    }
    mdEditorScrollContainer = null;
    mdEditorScrollHandler = null;
  }

  // ---------------------------------------------------------------------
  // Decorations режима "без кода" — построены поверх видимых строк
  // (view.visibleRanges), пересчитываются на каждое изменение документа
  // или прокрутку (см. update ниже) — CodeMirror 6 сам инкрементально
  // перерисовывает только то, что видно, поэтому лишних оптимизаций не
  // требуется (см. ТЗ).
  //
  // Клик по [[ссылке]] определяется отдельно, простым регэкспом по строке
  // под курсором (см. handleMouseDown) — не зависит от decorations и
  // работает в обоих режимах.
  // ---------------------------------------------------------------------

  // ---- встроенные картинки: обтекание текстом (см. .cm-md-image-float в
  // components.css). Вынесено на уровень модуля (а не внутрь
  // makeLivePreviewExtension), т.к. relayoutImageFloats вызывается также
  // из mountEditor() через ResizeObserver — при ширине редактора,
  // изменившейся не из-за ввода текста (поворот планшета, изменение
  // ширины окна настроек и т.п.). ----
  // Порог в 150px — не CSS (обычный float обтекается при ЛЮБОМ оставшемся
  // месте, хоть 5px, и текст превращается в узкую нечитаемую колонку),
  // поэтому решение "включать float или нет" считаем сами: доступная
  // ширина строки минус фактическая ширина картинки (⩽600px, см.
  // .cm-md-image-wrap) должна быть не меньше порога. wrap.parentElement
  // — это сам .cm-line редактора: его clientWidth не зависит от того,
  // floated картинка внутри него или нет (float не меняет ширину
  // собственного родителя), так что измерение не "скачет" при
  // переключении класса туда-обратно.
  var IMAGE_FLOAT_MIN_GAP = 150;
  var IMAGE_MAX_WIDTH = 600;
  function applyImageFloatLayout(wrap){
    var img = wrap.querySelector(".cm-md-image");
    var line = wrap.parentElement;
    if(!img || !img.naturalWidth || !line) return;
    var lineWidth = line.clientWidth;
    if(!lineWidth) return;
    var imgWidth = Math.min(img.naturalWidth, IMAGE_MAX_WIDTH, lineWidth);
    wrap.classList.toggle("cm-md-image-float", (lineWidth - imgWidth) >= IMAGE_FLOAT_MIN_GAP);
  }
  // Пересчёт всех картинок сразу — при изменении ширины редактора
  // (поворот планшета, изменение ширины окна настроек и т.п., см.
  // ResizeObserver в mountEditor). Картинки, которые ещё не
  // загрузились (img.naturalWidth === 0), applyImageFloatLayout молча
  // пропускает — досчитаются сами по своему load (ниже).
  function relayoutImageFloats(host){
    var wraps = host.querySelectorAll(".cm-md-image-wrap");
    for(var i = 0; i < wraps.length; i++) applyImageFloatLayout(wraps[i]);
  }

  // ---- заголовки вставленных ссылок (см. LinkWidget/getLinkWidget внутри
  // makeLivePreviewExtension ниже) — реестр реально смонтированных DOM-
  // узлов на уровне модуля, а не внутри makeLivePreviewExtension, т.к. она
  // вызывается заново при каждом mountEditor()/переключении режима "без
  // кода"/"с кодом" (см. mountEditor/setCodeMode ниже): подписка на
  // deps.onLinkTitleResolved должна случиться РОВНО ОДИН РАЗ за всё время
  // жизни модуля, иначе на каждый повторный вызов копился бы ещё один
  // обработчик и заголовок обновлялся бы по нескольку раз подряд. Сам
  // реестр обновлять DOM точечно, без пересборки decorations, тоже может в
  // любой момент — CodeMirror decorations нельзя точечно пересчитать без
  // полного docChanged, а тут достаточно поменять textContent. ----
  var linkNodesByHref = new Map(); // href -> Set<HTMLElement>
  function registerLinkNode(href, el){
    var set = linkNodesByHref.get(href);
    if(!set){ set = new Set(); linkNodesByHref.set(href, set); }
    set.add(el);
  }
  function unregisterLinkNode(href, el){
    var set = linkNodesByHref.get(href);
    if(set){ set.delete(el); if(!set.size) linkNodesByHref.delete(href); }
  }
  if(deps.onLinkTitleResolved){
    deps.onLinkTitleResolved(function(href){
      var set = linkNodesByHref.get(href);
      if(!set) return;
      var info = deps.autoLinkTitle(href); // текущий (уже свежий) текст
      set.forEach(function(el){ el.textContent = info.text; });
    });
  }

  function makeLivePreviewExtension(cm){
    var Decoration = cm.view.Decoration, ViewPlugin = cm.view.ViewPlugin, WidgetType = cm.view.WidgetType;
    var RangeSetBuilder = cm.state.RangeSetBuilder;

    // строка-задача в стиле Obsidian: "- [ ] текст" (не отмечена) или
    // "- [x] текст" (отмечена) — группы: 1) всё до "[" включительно,
    // 2) сам символ отметки (" "/"x"/"X"), 3) "]" и пробелы после него,
    // 4) сам текст задачи. Раздельные группы 1/2/3 (а не один общий
    // "маркер") нужны, чтобы точно знать АБСОЛЮТНУЮ позицию символа
    // отметки в документе — так кнопка "✓" ниже может править именно его,
    // не трогая остальную строку (см. TaskActionsWidget).
    var TASK_LINE_RE = /^(\s*[-*]\s+\[)([ xX])(\]\s*)(.*)$/;

    function BulletWidget(){}
    BulletWidget.prototype = Object.create(WidgetType.prototype);
    BulletWidget.prototype.toDOM = function(){
      var span = document.createElement("span");
      span.className = "cm-md-bullet";
      span.textContent = "• ";
      return span;
    };
    BulletWidget.prototype.eq = function(){ return true; };
    var bulletWidgetInstance = new BulletWidget();

    // ---- встроенные картинки: ![[имя.ext]] (тот же двойной-скобочный
    // синтаксис, что и у ссылок на заметки [[имя]], плюс "!" — как в
    // Obsidian). Сама картинка читается лениво через imageIndex (см.
    // buildImageIndex/imagesDirHandle выше) и кэшируется в imageUrlCache по
    // имени, чтобы не перечитывать файл на каждую перестройку decorations
    // (она происходит при любом изменении документа, даже не в этой
    // строке). applyImageFloatLayout/relayoutImageFloats вынесены на
    // уровень модуля — см. выше перед makeLivePreviewExtension.
    //
    // Плейсхолдер отсутствующей картинки (раздел 9 ТЗ) — показывается,
    // если папка с картинками не подключена ИЛИ подключена, но именно этот
    // файл в ней не найден. wrap регистрируется в imageNodesByName (см.
    // выше), чтобы после успешного подключения папки (см.
    // refreshMountedImageNodes) картинка могла подгрузиться НА МЕСТО
    // плейсхолдера, без пересборки decorations и без перезагрузки заметки
    // целиком. ----
    function ImageWidget(name){ this.name = name; }
    ImageWidget.prototype = Object.create(WidgetType.prototype);
    ImageWidget.prototype.eq = function(other){ return other.name === this.name; };
    ImageWidget.prototype.toDOM = function(){
      var wrap = document.createElement("span");
      wrap.className = "cm-md-image-wrap";
      var entry = { wrap: wrap, name: this.name, loaded: false };
      wrap.mdImageEntry = entry;
      registerImageNode(this.name.toLowerCase(), entry);
      loadImageInto(this.name, wrap);
      return wrap;
    };
    ImageWidget.prototype.destroy = function(dom){
      var entry = dom.mdImageEntry;
      if(entry) unregisterImageNode(this.name.toLowerCase(), entry);
    };
    ImageWidget.prototype.ignoreEvent = function(){ return true; };
    var imageWidgetCache = new Map(); // имя -> ImageWidget (переиспользуем, чтобы eq() совпадал между перестройками)
    function getImageWidget(name){
      var w = imageWidgetCache.get(name);
      if(!w){ w = new ImageWidget(name); imageWidgetCache.set(name, w); }
      return w;
    }
    // buildImagePlaceholder/setWrapToImage/loadImageInto вынесены на
    // уровень модуля (см. выше, рядом с registerImageNode) — они не
    // используют ничего из CodeMirror и должны быть видны также из
    // refreshMountedImageNodes, который живёт на уровне модуля, а не
    // внутри makeLivePreviewExtension (исправление бага "loadImageInto is
    // not defined": функции звались оттуда, но были объявлены только
    // здесь, во вложенной области видимости).

    // ---- заголовок вставленной ссылки (YouTube/публикации/домен, см.
    // autoLinkTitle в my.js, передан сюда как deps.autoLinkTitle) — по
    // образцу ImageWidget выше, но проще (не читает файлы, ссылка уже
    // готова: настоящий <a target="_blank">, клик обрабатывает браузер
    // нативно, свой обработчик не нужен). Текст внутри уже смонтированного
    // узла не пересоздаётся новым экземпляром виджета — обновляется прямо
    // в DOM через registerLinkNode/onLinkTitleResolved (см. реестр на
    // уровне модуля выше), поэтому eq() ниже сравнивает и текст тоже: пока
    // текст совпадает, CodeMirror переиспользует старый DOM-узел (и он
    // остаётся в реестре), а как только текст обновится — старый виджет
    // выпадет из кеша (см. getLinkWidget), CodeMirror пересоздаст DOM,
    // сработает destroy() старого узла и toDOM() нового.
    function LinkWidget(href, initialText){
      this.href = href;
      this.text = initialText;
    }
    LinkWidget.prototype = Object.create(WidgetType.prototype);
    LinkWidget.prototype.eq = function(other){ return other.href === this.href && other.text === this.text; };
    LinkWidget.prototype.toDOM = function(){
      var a = document.createElement("a");
      a.href = this.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "auto-link resource-link";
      a.textContent = this.text;
      registerLinkNode(this.href, a);
      return a;
    };
    LinkWidget.prototype.destroy = function(dom){ unregisterLinkNode(this.href, dom); };
    LinkWidget.prototype.ignoreEvent = function(){ return true; }; // как у ImageWidget/TaskActionsWidget — не мешать клику браузера по <a>
    var linkWidgetCache = new Map(); // href -> LinkWidget (текст внутри не подменяем в существующем экземпляре — см. eq() выше)
    function getLinkWidget(href, text){
      var w = linkWidgetCache.get(href);
      if(!w || w.text !== text){ w = new LinkWidget(href, text); linkWidgetCache.set(href, w); }
      return w;
    }

    // ---- кнопки задачи "- [ ] текст" (см. TASK_LINE_RE выше) — те же
    // классы, что и у строки обычной задачи на вкладках задач (см.
    // .task-actions/.task-icon-btn в modals.css), чтобы выглядело
    // единообразно (см. ТЗ). Показывается только у НЕ отмеченной задачи —
    // у отмеченной ("[x]") показывать уже нечего, она и так уже отправлена
    // в архив в момент отметки (см. "✓" ниже).
    //   "✓" ("В архив")   — как и у обычной задачи: сразу создаёт запись
    //                        в архиве (createArchivedTaskWithText) и,
    //                        чтобы в самой заметке было видно, что задача
    //                        обработана, правит "[ ]" на "[x]" прямо в
    //                        документе (единственная правка документа, на
    //                        которую способны эти кнопки).
    //   "→" ("Перенести") — открывает тот же пикер выбора вкладки, что и у
    //                        обычной задачи, и создаёт НА ВЫБРАННОЙ вкладке
    //                        новую (ещё не отмеченную) задачу с этим
    //                        текстом. Сама заметка при этом не меняется —
    //                        перенос из блокнота на вкладку задач
    //                        ОДНОСТОРОННИЙ, обратно такая задача уже не
    //                        возвращается и никак с исходной строкой не
    //                        связана (см. ТЗ).
    function TaskActionsWidget(checkPos, text){
      this.checkPos = checkPos;
      this.text = text;
    }
    TaskActionsWidget.prototype = Object.create(WidgetType.prototype);
    TaskActionsWidget.prototype.eq = function(other){
      return other.checkPos === this.checkPos && other.text === this.text;
    };
    // как и у ImageWidget выше — клики/т.п. по кнопкам обрабатываются
    // самим виджетом напрямую, CodeMirror их трогать не должен (иначе
    // попытался бы поставить курсор туда же, куда кликнули)
    TaskActionsWidget.prototype.ignoreEvent = function(){ return true; };
    TaskActionsWidget.prototype.toDOM = function(){
      var self = this;
      var wrap = document.createElement("span");
      wrap.className = "task-actions cm-md-task-actions";
      var doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "task-icon-btn cm-md-task-done-btn";
      doneBtn.title = "В архив";
      doneBtn.innerHTML = CHECK_ICON_SVG;
      doneBtn.addEventListener("click", function(ev){
        ev.preventDefault();
        if(createArchivedTaskWithText) createArchivedTaskWithText(self.text);
        if(cmView){
          cmView.dispatch({ changes: { from: self.checkPos, to: self.checkPos + 1, insert: "x" } });
        }
      });
      wrap.appendChild(doneBtn);
      if(openTaskMoveTargetPicker){
        var moveBtn = document.createElement("button");
        moveBtn.type = "button";
        moveBtn.className = "task-icon-btn cm-md-task-move-btn";
        moveBtn.title = "Перенести";
        moveBtn.innerHTML = ARROW_MOVE_ICON_SVG;
        moveBtn.addEventListener("click", function(ev){
          ev.preventDefault();
          openTaskMoveTargetPicker(self.text);
        });
        wrap.appendChild(moveBtn);
      }
      return wrap;
    };

    var headingLineDeco = [
      Decoration.line({ attributes: { class: "cm-md-h1" } }),
      Decoration.line({ attributes: { class: "cm-md-h2" } }),
      Decoration.line({ attributes: { class: "cm-md-h3" } })
    ];
    var boldMark = Decoration.mark({ class: "cm-md-bold" });
    var italicMark = Decoration.mark({ class: "cm-md-italic" });
    var highlightMark = Decoration.mark({ class: "cm-md-mark" });
    // зачёркнутый ("~~текст~~") / подчёркнутый ("++текст++" — своё
    // обозначение, см. кнопки "Ч"/"П" в renderEditorScreen и ТЗ
    // пользователя от 31.08).
    var strikeMark = Decoration.mark({ class: "cm-md-strike" });
    var underlineMark = Decoration.mark({ class: "cm-md-underline" });
    var linkMark = Decoration.mark({ class: "cm-md-link" });
    // ссылка на Библию, найденная в свободном тексте ("Матфея 5:3" и т.п.,
    // см. SCRIPTURE_RE/findScriptureRefAt выше) — используется ТОТ ЖЕ
    // класс ("auto-link scripture-link"), что и везде в проекте (см.
    // единое правило .auto-link.scripture-link в components.css и
    // scripturifyHtml/initAutoScriptureLinks в my.js) — один стиль
    // ссылки на Библию везде, а не отдельный для блокнота. Сам клик
    // обрабатывается в handleMouseDown ниже.
    var scriptureLinkMark = Decoration.mark({ class: "auto-link scripture-link" });
    var quoteLineDeco = Decoration.line({ attributes: { class: "cm-md-quote" } });
    // строка-задача (см. TASK_LINE_RE выше) — отдельно для отмеченной и
    // не отмеченной (разное оформление текста, см. components.css), плюс
    // ДВЕ отдельные строчные decoration для верхнего/нижнего разделителя
    // (см. .cm-md-task-sep-top/-bottom в components.css) — добавляются
    // НЕЗАВИСИМО друг от друга и не на каждую строку-задачу, а только с
    // той стороны, где соседняя строка документа НЕ такая же задача (см.
    // prevIsTaskLine/nextIsTaskLine в buildDecorations ниже) — так у двух
    // идущих подряд задач между ними остаётся ровно ОДИН разделитель, а не
    // два слипшихся (см. ТЗ пользователя от 30.08).
    var taskLineDecoUnchecked = Decoration.line({ attributes: { class: "cm-md-task-line cm-md-task-unchecked" } });
    var taskLineDecoChecked = Decoration.line({ attributes: { class: "cm-md-task-line cm-md-task-checked" } });
    var taskSepTopDeco = Decoration.line({ attributes: { class: "cm-md-task-sep-top" } });
    var taskSepBottomDeco = Decoration.line({ attributes: { class: "cm-md-task-sep-bottom" } });
    // "красная строка" — отступ первой строки абзаца (см. ТЗ: примерно
    // 2 пробела), только у обычного текста (не у заголовков/цитат/списков,
    // у них уже своя, другая логика начала строки)
    var paraStartLineDeco = Decoration.line({ attributes: { class: "cm-md-para-start" } });
    // нумерованный список ("1. ", "2. ", ... или "1) ", "2) ", ...) — в
    // отличие от маркера "-"/"*" сама цифра НЕ скрывается (порядковый
    // номер — это содержимое, а не просто оформление), только красится тем
    // же цветом, что и маркер "•" у обычного списка.
    var numListMark = Decoration.mark({ class: "cm-md-bullet" });
    // строка ЛЮБОГО пункта списка — маркированного ("-"/"*") или
    // нумерованного ("1.", "2.", ...) — получает и "красную строку" (та же
    // .cm-md-para-start, что и у обычного абзаца, но применяется к
    // КАЖДОМУ пункту, а не только к первой строке после пустой), и
    // отдельный класс с отступом МЕЖДУ пунктами (.cm-md-list-line в
    // components.css) — без него соседние пункты списка визуально
    // склеивались в один абзац, если между ними нет пустой строки.
    var listLineDeco = Decoration.line({ attributes: { class: "cm-md-para-start cm-md-list-line" } });
    // пустая строка между абзацами — уменьшенный межстрочный интервал (см.
    // .cm-md-blank-line в components.css), чтобы промежуток между абзацами
    // был вдвое компактнее обычного расстояния между строками
    var blankLineDeco = Decoration.line({ attributes: { class: "cm-md-blank-line" } });
    // строка, ЦЕЛИКОМ состоящая из одной картинки ("![[имя]]", возможно с
    // пробелами вокруг) — реальный видимый размер задаёт сама картинка
    // (виджет), а обычный line-height строки (как у текстовой строки)
    // сверху добавлял ЛИШНЕЕ зарезервированное место над и под ней — это
    // и была основная причина большого отступа, а не margin у
    // .cm-md-image-wrap (см. components.css); line-height:0 у самой строки
    // убирает этот лишний зазор, оставляя только собственные размеры
    // картинки и её небольшой margin.
    var imageLineDeco = Decoration.line({ attributes: { class: "cm-md-image-line" } });
    var hideDeco = Decoration.replace({});
    var bulletDeco = Decoration.replace({ widget: bulletWidgetInstance });
    // строка метаданных (дата создания/редактирования, см. META_LINE_RE
    // выше в начале модуля) — ВСЕГДА первая строка документа, если есть.
    // В режиме "без кода" полностью скрывается (сами даты показаны
    // отдельным нередактируемым полем #mdEditorDatesRow, см.
    // renderEditorScreen/refreshDatesField) — ТЗ пользователя от 04.09:
    // "отображать можно, разве что в коде, в тексте не нужно".
    var META_LINE_EXACT_RE = /^%%meta:\d{2}\.\d{2}\.\d{4}:\d{2}\.\d{2}\.\d{4}(?::\d{2}\.\d{2}\.\d{4})?%%$/;
    // Возврат к line-декорации + CSS-классу (.cm-md-meta-hidden в
    // components.css, display:none — правило там ЕСТЬ и работает).
    // Предыдущая попытка (Decoration.replace с block:true) ломала
    // редактор с первого же нажатия клавиши: CodeMirror 6 запрещает
    // блочные decorations, объявленные из ViewPlugin ("RangeError: Block
    // decorations may not be specified via plugins") — их можно отдавать
    // только из StateField. Настоящая причина видимости строки была не
    // в CSS и не в способе скрытия, а в стартовой позиции курсора (см.
    // initialPos/minCursorPos в mountEditor) — она уже исправлена.
    var hiddenMetaLineDeco = Decoration.line({ attributes: { class: "cm-md-meta-hidden" } });

    function decorateLine(builder, lineText, lineFrom, isParaStart, prevIsTaskLine, nextIsTaskLine){
      if(lineText.trim() === ""){
        builder.add(lineFrom, lineFrom, blankLineDeco);
        return;
      }
      var claims = [];
      function tryClaim(start, end, emit){
        for(var i = 0; i < claims.length; i++){
          if(start < claims[i].end && end > claims[i].start) return;
        }
        claims.push({ start: start, end: end, emit: emit });
      }
      function scanPair(regex, delimLen, markDeco){
        var m;
        regex.lastIndex = 0;
        while((m = regex.exec(lineText))){
          (function(a, b){
            tryClaim(a, b, function(){
              builder.add(lineFrom + a, lineFrom + a + delimLen, hideDeco);
              builder.add(lineFrom + a + delimLen, lineFrom + b - delimLen, markDeco);
              builder.add(lineFrom + b - delimLen, lineFrom + b, hideDeco);
            });
          })(m.index, m.index + m[0].length);
          if(m[0].length === 0) regex.lastIndex++;
        }
      }

      var mHead = /^(#{1,3})(\s+)/.exec(lineText);
      var mQuote = null, mList = null, mNum = null, mTask = null, taskChecked = false;
      // строка целиком — одна картинка (без остального текста рядом);
      // проверяется независимо от остальной цепочки mHead/mQuote/mList/
      // mNum ниже, конфликтов с ними быть не может (эти маркеры никогда
      // не начинаются с "![[")
      var mImgOnly = /^\s*!\[\[[^\[\]\n]+\]\]\s*$/.test(lineText);
      if(mHead){
        var hideEnd = mHead[0].length;
        tryClaim(0, hideEnd, function(){
          builder.add(lineFrom, lineFrom + hideEnd, hideDeco);
        });
      } else {
        mQuote = /^(\s*>+ ?)/.exec(lineText);
        if(mQuote){
          var qEnd = mQuote[0].length;
          tryClaim(0, qEnd, function(){
            builder.add(lineFrom, lineFrom + qEnd, hideDeco);
          });
        } else {
          // "- [ ] текст" / "- [x] текст" — проверяется РАНЬШЕ обычного
          // маркированного списка ниже (иначе "[ ]"/"[x]" остались бы
          // просто текстом внутри обычного пункта списка, см. ТЗ)
          mTask = TASK_LINE_RE.exec(lineText);
          if(mTask){
            taskChecked = mTask[2] === "x" || mTask[2] === "X";
            // скрывается ВЕСЬ маркер целиком — "- [ ] "/"- [x] " (кнопки и
            // разделители вместо него достраивает decoration строки ниже,
            // см. taskLineDecoUnchecked/taskLineDecoChecked и
            // TaskActionsWidget выше)
            var tHideEnd = mTask[1].length + 1 + mTask[3].length;
            tryClaim(0, tHideEnd, function(){
              builder.add(lineFrom, lineFrom + tHideEnd, hideDeco);
            });
          } else {
            mList = /^(\s*)([-*])(\s+)/.exec(lineText);
            if(mList){
              var s = mList[1].length, e = mList[0].length;
              tryClaim(s, e, function(){
                builder.add(lineFrom + s, lineFrom + e, bulletDeco);
              });
            } else {
              mNum = /^(\s*)(\d{1,4}[.)])(\s+)/.exec(lineText);
              if(mNum){
                var nMarkStart = mNum[1].length, nMarkEnd = nMarkStart + mNum[2].length;
                tryClaim(nMarkStart, nMarkEnd, function(){
                  builder.add(lineFrom + nMarkStart, lineFrom + nMarkEnd, numListMark);
                });
              }
            }
          }
        }
      }

      // встроенная картинка — раньше остальных scanPair (в т.ч. раньше
      // обычных [[ссылок]]), чтобы "!" тоже попал в claim и вся запись
      // ![[имя]] целиком превратилась в widget, а не в скрытый "!" рядом
      // с обычной decorированной ссылкой на несуществующую заметку
      var imgRe = /!\[\[([^\[\]\n]+)\]\]/g, mImg;
      imgRe.lastIndex = 0;
      while((mImg = imgRe.exec(lineText))){
        (function(a, b, imgName){
          tryClaim(a, b, function(){
            builder.add(lineFrom + a, lineFrom + b, Decoration.replace({ widget: getImageWidget(imgName) }));
          });
        })(mImg.index, mImg.index + mImg[0].length, mImg[1].trim());
        if(mImg[0].length === 0) imgRe.lastIndex++;
      }

      // ссылки на Библию ("Матфея 5:3", "Быт. 1:1-2" и т.п.) — раньше
      // обычных **жирный**/*курсив* и т.д., чтобы служебные символы
      // разметки внутри найденной ссылки (крайне маловероятно, но
      // возможно) не перехватили её часть себе
      if(SCRIPTURE_RE){
        SCRIPTURE_RE.lastIndex = 0;
        var mScr;
        while((mScr = SCRIPTURE_RE.exec(lineText))){
          (function(a, b){
            tryClaim(a, b, function(){
              builder.add(lineFrom + a, lineFrom + b, scriptureLinkMark);
            });
          })(mScr.index, mScr.index + mScr[0].length);
          if(mScr[0].length === 0) SCRIPTURE_RE.lastIndex++;
        }
      }

      // обычные ссылки http(s)://, www. (тот же приём "заявок", что и у
      // остальных блоков decorateLine) — строго ПОСЛЕ ссылок на Библию и
      // ПЕРЕД scanPair(**жирный** и т.д.) ниже: иначе "_"/"*", случайно
      // попавшие в query-строку URL, перехватились бы italic-регэкспами
      // раньше, чем URL успеет заявить на себя весь диапазон. Заголовок —
      // через deps.autoLinkTitle (см. my.js): для YouTube асинхронно (сеть,
      // временная заглушка на время загрузки), для остального сразу.
      var urlRe = /((?:https?:\/\/|www\.)[^\s<]+)/gi, mUrl;
      var LINKIFY_TRAIL_RE = /[.,;:!?)\]}'"]+$/; // тот же паттерн отсечения хвостовой пунктуации, что и в my.js
      urlRe.lastIndex = 0;
      while((mUrl = urlRe.exec(lineText))){
        (function(raw0, a){
          var trailM = raw0.match(LINKIFY_TRAIL_RE);
          var trail = trailM ? trailM[0] : "";
          var core = trail ? raw0.slice(0, raw0.length - trail.length) : raw0;
          if(!core) return;
          var b = a + core.length;
          tryClaim(a, b, function(){
            var href = /^https?:\/\//i.test(core) ? core : "https://" + core;
            var info = deps.autoLinkTitle ? deps.autoLinkTitle(href) : { text: href };
            builder.add(lineFrom + a, lineFrom + b, Decoration.replace({ widget: getLinkWidget(href, info.text) }));
          });
        })(mUrl[0], mUrl.index);
        if(mUrl[0].length === 0) urlRe.lastIndex++;
      }

      scanPair(/\*\*([^*\n]+?)\*\*/g, 2, boldMark);
      scanPair(/==([^=\n]+?)==/g, 2, highlightMark);
      scanPair(/~~([^~\n]+?)~~/g, 2, strikeMark);
      scanPair(/\+\+([^+\n]+?)\+\+/g, 2, underlineMark);
      scanPair(/\[\[([^\[\]\n]+)\]\]/g, 2, linkMark);
      scanPair(/\*([^*\n]+?)\*/g, 1, italicMark);
      scanPair(/_([^_\n]+?)_/g, 1, italicMark);

      claims.sort(function(a, b){ return a.start - b.start; });
      if(mHead) builder.add(lineFrom, lineFrom, headingLineDeco[mHead[1].length - 1]);
      else if(mQuote) builder.add(lineFrom, lineFrom, quoteLineDeco);
      else if(mTask){
        builder.add(lineFrom, lineFrom, taskChecked ? taskLineDecoChecked : taskLineDecoUnchecked);
        // разделитель сверху/снизу — только там, где соседняя строка сама
        // не такая же задача (см. пояснение у taskSepTopDeco выше)
        if(!prevIsTaskLine) builder.add(lineFrom, lineFrom, taskSepTopDeco);
        if(!nextIsTaskLine) builder.add(lineFrom, lineFrom, taskSepBottomDeco);
      }
      else if(mList) builder.add(lineFrom, lineFrom, listLineDeco);
      else if(mNum) builder.add(lineFrom, lineFrom, listLineDeco);
      else if(mImgOnly) builder.add(lineFrom, lineFrom, imageLineDeco);
      else if(isParaStart) builder.add(lineFrom, lineFrom, paraStartLineDeco);
      claims.forEach(function(c){ c.emit(); });
      // кнопки "✓"/"→" — только у ещё не отмеченной задачи (см. пояснение
      // у TaskActionsWidget выше), точкой в самом конце строки, чтобы
      // "подверстывались" к тексту тем же приёмом, что и .task-actions на
      // вкладках задач (float:right, см. components.css)
      if(mTask && !taskChecked){
        var widgetPos = lineFrom + lineText.length;
        builder.add(widgetPos, widgetPos, Decoration.widget({
          widget: new TaskActionsWidget(lineFrom + mTask[1].length, mTask[4]),
          side: 1
        }));
      }
    }

    function buildDecorations(view){
      var builder = new RangeSetBuilder();
      var doc = view.state.doc;
      for(var i = 0; i < view.visibleRanges.length; i++){
        var vr = view.visibleRanges[i];
        var pos = vr.from;
        for(;;){
          var line = doc.lineAt(pos);
          // начало абзаца: непустая строка, а перед ней — пустая строка,
          // ЛИБО самое начало документа, ЛИБО (специально для этого) сразу
          // заголовок ("# ...") или строка-иллюстрация ("![[имя]]") без
          // пустой строки-разделителя — раньше в этих двух случаях красная
          // строка не появлялась, хотя абзац фактически начинался заново
          // сразу после заголовка/картинки. Смотрим соседнюю строку
          // напрямую по документу, а не по уже пройденным строкам этого
          // цикла, чтобы работало одинаково с любого места прокрутки, а не
          // только с самого верха заметки.
          // строка метаданных (см. META_LINE_EXACT_RE выше) — только если
          // она реально первая строка документа, полностью скрывается,
          // остальная разметка/decorations для неё не считаются
          if(line.from === 0 && META_LINE_EXACT_RE.test(line.text)){
            builder.add(line.from, line.from, hiddenMetaLineDeco);
            if(line.to >= vr.to || line.to >= doc.length) break;
            pos = line.to + 1;
            continue;
          }
          var isParaStart = line.text.trim() !== "";
          if(isParaStart && line.from !== 0){
            var prevText = doc.lineAt(line.from - 1).text;
            isParaStart = prevText.trim() === "" ||
              /^(#{1,3})(\s+)/.test(prevText) ||
              /^\s*!\[\[[^\[\]\n]+\]\]\s*$/.test(prevText) ||
              // скрытая строка метаданных (см. выше) не должна считаться
              // "непустым" предыдущим абзацем — иначе самый первый видимый
              // абзац заметки навсегда терял бы "красную строку"
              (doc.lineAt(line.from - 1).from === 0 && META_LINE_EXACT_RE.test(prevText));
          }
          // соседняя строка документа (не обязательно видимая) — тоже
          // задача "- [ ]"/"- [x]"? см. taskSepTopDeco/taskSepBottomDeco
          // выше: разделитель между двумя задачами подряд должен быть
          // только один, а не два слипшихся.
          var prevIsTaskLine = line.from !== 0 && TASK_LINE_RE.test(doc.lineAt(line.from - 1).text);
          var nextIsTaskLine = line.to < doc.length && TASK_LINE_RE.test(doc.lineAt(line.to + 1).text);
          decorateLine(builder, line.text, line.from, isParaStart, prevIsTaskLine, nextIsTaskLine);
          if(line.to >= vr.to || line.to >= doc.length) break;
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }

    function Plugin(view){ this.decorations = buildDecorations(view); }
    Plugin.prototype.update = function(u){
      if(u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
    };

    return ViewPlugin.fromClass(Plugin, { decorations: function(p){ return p.decorations; } });
  }

  function handleMouseDown(ev, view){
    if(ev.button !== 0 || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
    var pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
    if(pos == null) return false;
    var line = view.state.doc.lineAt(pos);
    var offset = pos - line.from;
    var re = /\[\[([^\[\]\n]+)\]\]/g;
    var m;
    while((m = re.exec(line.text))){
      var a = m.index, b = a + m[0].length;
      if(offset >= a && offset <= b){
        ev.preventDefault();
        handleLinkClick(m[1]);
        return true;
      }
    }
    var scr = findScriptureRefAt(line.text, offset);
    if(scr){
      ev.preventDefault();
      openScriptureLink(scr);
      return true;
    }
    return false;
  }

  function setCodeMode(value){
    codeMode = value;
    if(!cmView || !cmModules || !livePreviewCompartment) return;
    cmView.dispatch({
      effects: livePreviewCompartment.reconfigure(codeMode ? [] : [makeLivePreviewExtension(cmModules)])
    });
  }

  function mountEditor(){
    var hostAtCallTime = document.getElementById("mdEditorHost");
    if(!hostAtCallTime || !openFile) return;
    var fileAtMountTime = openFile;
    loadCM().then(function(cm){
      // вкладку могли закрыть/переключить заметку, пока грузился CodeMirror
      var host = document.getElementById("mdEditorHost");
      if(!host || openFile !== fileAtMountTime) return;
      try{
        var EditorState = cm.state.EditorState;
        var EditorView = cm.view.EditorView;
        var Compartment = cm.state.Compartment;
        var keymap = cm.view.keymap;
        var history = cm.commands.history, historyKeymap = cm.commands.historyKeymap;
        var defaultKeymap = cm.commands.defaultKeymap, indentWithTab = cm.commands.indentWithTab;

        livePreviewCompartment = new Compartment();
        var extensions = [
          history(),
          keymap.of(defaultKeymap.concat(historyKeymap, [indentWithTab])),
          EditorView.lineWrapping,
          livePreviewCompartment.of(codeMode ? [] : [makeLivePreviewExtension(cm)]),
          EditorView.updateListener.of(function(u){
            if(u.docChanged){
              scheduleAutosave();
              scheduleLinksFieldRefresh();
            }
            if(u.docChanged || u.selectionSet) scheduleDocStateSave();
          }),
          EditorView.domEventHandlers({ mousedown: handleMouseDown })
        ];
        // Курсор по умолчанию (cursorPos не задан/равен 0) не должен
        // попадать НИЖЕ конца скрытой строки метаданных — иначе он
        // физически стоит в самом начале документа, то есть внутри этой
        // строки (визуально она скрыта, display:none в components.css,
        // но позиция в документе никуда не делась). Первый же набранный
        // символ вставлялся прямо туда, портил точный формат
        // "%%meta:...%%" и строка становилась видимой — баг найден
        // пользователем 05.09 ("отображается после начала
        // редактирования"), причина была не в CSS, а именно в стартовой
        // позиции курсора.
        var metaMatchForCursor = META_LINE_RE.exec(openFile.text || "");
        var minCursorPos = metaMatchForCursor ? metaMatchForCursor[0].length : 0;
        var initialPos = Math.max(minCursorPos, Math.min(openFile.cursorPos || 0, openFile.text.length));
        var state = EditorState.create({ doc: openFile.text, selection: { anchor: initialPos }, extensions: extensions });
        cmView = new EditorView({ state: state, parent: host });
        // Ширина редактора может измениться не только от ввода текста
        // (что и так пересчитывает decorations) — поворот планшета,
        // изменение ширины окна настроек (layoutSettingsModal в my.js) и
        // т.п. тоже должны пересчитать float/block-режим у уже
        // вставленных картинок (см. cm-md-image-float в components.css).
        if(mdEditorImageResizeObserver){ mdEditorImageResizeObserver.disconnect(); mdEditorImageResizeObserver = null; }
        if(typeof ResizeObserver !== "undefined"){
          mdEditorImageResizeObserver = new ResizeObserver(function(){ relayoutImageFloats(host); });
          mdEditorImageResizeObserver.observe(host);
        }
        // Обычная прокрутка БЕЗ клика/движения курсора (просто чтение) тоже
        // должна запоминаться — иначе "то же место" остаётся только позицией
        // курсора, которая при чтении не меняется вовсе (см. ТЗ пользователя
        // от 01.09, пункт 1: после сворачивания/возврата вкладки заметка
        // оказывалась прокручена в начало, хотя курсор и правда стоял там же,
        // где его в последний раз кто-то поставил).
        // ИСПРАВЛЕНО (01.09, вторая попытка): слушать нужно НЕ
        // cmView.scrollDOM (у .cm-editor нет ограничения по высоте, он
        // растёт на весь текст и физически никогда не скроллится — см.
        // currentScrollPercent выше), а #settingsTabContent — реальный
        // прокручиваемый элемент вкладки. Слушатель снимается в
        // destroyEditor() при уходе с заметки/вкладки, чтобы не копились
        // дубликаты при каждом повторном mountEditor().
        var scrollContainer = document.getElementById("settingsTabContent");
        if(scrollContainer){
          if(mdEditorScrollContainer && mdEditorScrollHandler){
            mdEditorScrollContainer.removeEventListener("scroll", mdEditorScrollHandler);
          }
          mdEditorScrollHandler = function(){ scheduleDocStateSave(); };
          mdEditorScrollContainer = scrollContainer;
          scrollContainer.addEventListener("scroll", mdEditorScrollHandler, { passive: true });
        }
        // Восстановление позиции при открытии/перемонтировании —
        // приоритет у сохранённого процента прокрутки (openFile.
        // scrollPercent), а если его нет (совсем новая заметка) —
        // scrollIntoView по позиции курсора. (Пробовали cmView.
        // scrollSnapshot() — не годится для нашего случая, см. комментарий
        // в flushDocStateNow: он работает только с прокруткой самого
        // редактора, а не объемлющего #settingsTabContent.)
        var restorePercent = openFile.scrollPercent;
        requestAnimationFrame(function(){
          if(!cmView) return;
          var sc = document.getElementById("settingsTabContent");
          var max = sc ? sc.scrollHeight - sc.clientHeight : 0;
          if(sc && typeof restorePercent === "number" && max > 0){
            sc.scrollTop = restorePercent * max;
          } else {
            cmView.dispatch({ effects: EditorView.scrollIntoView(initialPos, { y: "center" }) });
          }
        });
      }catch(e){
        setStatus("Не удалось запустить редактор: " + (e && e.message ? e.message : e), true);
      }
    }).catch(function(e){
      setStatus("Не удалось загрузить редактор (нужен интернет при первом запуске): " + (e && e.message ? e.message : e), true);
    });
  }

  // Сброс несохранённых правок и немедленная отправка в облако ПЕРЕД
  // уходом вкладки в фон/закрытием (раздел 4.1 ТЗ: "переключение вкладки
  // настроек, сворачивание приложения" — тот же список случаев, что и у
  // flushPendingSyncNow в my.js).
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "hidden"){
      flushAutosaveNow();
      flushNotesCacheNow();
      pushDirtyNotes(true);
    }
  });
  window.addEventListener("pagehide", function(){
    flushAutosaveNow();
    flushNotesCacheNow();
    pushDirtyNotes(true);
  });

  // Просим постоянное (persistent) хранилище для origin — это не влияет
  // напрямую на разрешение SAF на папку с заметками, но снижает риск,
  // что браузер под давлением на память сам решит вытеснить данные origin'а
  // (IndexedDB и с ним — сохранённый dirHandle), что было бы уже настоящей
  // потерей доступа, а не временной. Дешёвая подстраховка, без гарантии.
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(function(){});
  }

  // Папка с изображениями (раздел 8 ТЗ) не завязана на syncId/облако —
  // пробуем молча поднять права на ранее выбранную папку сразу при запуске
  // модуля, независимо от того, открыта ли вкладка "Мой блокнот" прямо
  // сейчас (см. loadStoredImagesDirHandle выше).
  loadStoredImagesDirHandle();

  // Кэш заметок (см. preloadNotesCache выше) — тоже сразу при запуске
  // модуля, тем же приёмом: тогда к моменту, когда пользователь реально
  // откроет вкладку "Мой блокнот" (или "Закладки"/"Забытые заметки"),
  // notesMap уже готов и рендер списка мгновенный — офлайн из локального
  // кэша, онлайн так же мгновенно из него же, а сверка с облаком идёт уже
  // потом, в фоне (см. syncNotesOnTabEnter). Без syncId (синхронизация не
  // настроена) не запускаем — тогда нечем расшифровывать, и initNotesModule
  // сам вызовет preloadNotesCache() позже, когда/если синхронизацию
  // настроят.
  if(getSyncId()) preloadNotesCache();

  return {
    renderSettingsTabMdEditor: renderSettingsTabMdEditor,
    renderSettingsTabMdBookmarks: renderSettingsTabMdBookmarks,
    // "Забытые заметки" (set2s_4, ТЗ пользователя от 04.09) — см.
    // renderSettingsTabForgottenNotes выше
    renderSettingsTabForgottenNotes: renderSettingsTabForgottenNotes,
    flushPendingMdEditorEdit: flushPendingMdEditorEdit,
    openNoteExternally: openNoteExternally,
    // вызывается извне (см. rerenderAllFromState в my.js) после того, как
    // облачная синхронизация приносит state, отличающийся от локального —
    // например, закладку добавили на другом устройстве.
    refreshBookmarksFromState: refreshBookmarksFromState,
    // используются кнопками "Аа"/"Ж" на вкладках задач (см.
    // initTaskGlobalToolbar в my.js и ТЗ пользователя от 31.08) — тот же
    // общий размер шрифта и то же форматирование выделения, что и в
    // "Моём блокноте".
    getFontSizeStep: function(){ return fontSizeStep; },
    changeFontSizeStep: changeFontSizeStep,
    FONT_SIZE_MIN_STEP: FONT_SIZE_MIN_STEP,
    FONT_SIZE_MAX_STEP: FONT_SIZE_MAX_STEP,
    // Восстановление сети (раздел 3 ТЗ TASK_MDNOTES_CLOUD.md): pushDirtyNotes
    // сам по себе выходит молча, если сеть недоступна (isOnline()===false),
    // и НЕ ставит ретрай в этом случае — ретраи через NOTES_RETRY_DELAYS
    // планируются только после реально неудавшегося сетевого запроса (см.
    // .catch() внутри pushDirtyNotes). Значит, накопленные dirtyNoteIds сами
    // по себе не отправятся при возврате сети — нужен внешний толчок.
    // Вызывается из window "online" в my.js, тем же приёмом, что и
    // doCloudSync там же (сброс счётчика ретраев + немедленный вызов).
    retryNotesPushOnReconnect: function(){
      notesRetryCount = 0;
      clearTimeout(notesRetryTimer);
      pushDirtyNotes(false);
    }
  };
};
