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
  var createArchivedTaskWithText = deps.createArchivedTaskWithText || null;
  var openTaskMoveTargetPicker = deps.openTaskMoveTargetPicker || null;
  // пересчёт подгонки кнопок задач (см. fitTaskActions/refitAllVisibleTaskBodies
  // в my.js) — нужен здесь же, а не только в initTaskGlobalToolbar (my.js), т.к.
  // размер шрифта может смениться АСИНХРОННО ниже (idbGet("fontSizeStep") при
  // старте приложения), в момент, когда вкладка задач уже отрисована со
  // старым (по умолчанию) размером — без этого вызова кнопки остаются
  // подогнаны под УЖЕ неверную (старую) разбивку текста на строки.
  var refitAllVisibleTaskBodies = deps.refitAllVisibleTaskBodies || function(){};
  // "Закладки" — теперь синхронизируются в облаке вместе с остальными
  // данными приложения (см. ТЗ пользователя от 01.09), поэтому источник
  // истины для них — не IndexedDB (локальна для устройства/браузера, см.
  // idbGet/idbSet выше), а тот же state my.js, что и у переключателей
  // настроек: getSyncedBookmarkNames читает текущий список имён из state
  // (без сети, синхронно — state уже загружен из localStorage к моменту
  // инициализации этого модуля), setSyncedBookmark пишет в state ОДНО имя
  // разом (true/false) и сама планирует и локальное сохранение, и
  // облачную отправку (saveLocalState/scheduleCloudPush внутри my.js) —
  // тем же путём, каким устроена вся остальная синхронизация в
  // приложении. Каждое имя — отдельный ключ state (как отдельная глава в
  // остальном state), поэтому слияние с облаком идёт ПОИМЕННО, а не
  // целым списком — закладка, добавленная на одном устройстве, не теряет
  // закладку, добавленную тем временем на другом.
  var getSyncedBookmarkNames = deps.getSyncedBookmarkNames || function(){ return []; };
  var setSyncedBookmark = deps.setSyncedBookmark || function(){};

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
  var initStarted = false;
  var dirHandle = null;          // FileSystemDirectoryHandle корня
  var rootTree = null;           // {dirHandle, name, folders:[...], files:[{name,handle}]}
  var currentDirNode = null;     // текущая открытая "папка" в списке
  var nameIndex = null;          // Map: имя_в_нижнем_регистре -> {fileHandle,dirHandle,name}
  var imageIndex = null;         // Map: имя_файла.ext (в нижнем регистре) -> {fileHandle,dirHandle,name}
  // Кэш уже прочитанных картинок: имя.ext (в нижнем регистре) ->
  // {url} | {error:true}. Живёт, пока открыта вкладка/страница — так
  // повторные decorations (buildDecorations пересчитывается на каждое
  // изменение документа, даже в другом месте заметки) не перечитывают и не
  // перекодируют один и тот же файл заново. Чистится при выборе новой папки
  // (см. клик по скрепке в renderSetupScreen ниже).
  var imageUrlCache = new Map();
  var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  // единая папка для всех вложений (картинок и mp3) — см.
  // migrateStrayMediaFiles/ensureFilesFolder и insertImageAtCursor ниже
  // (ТЗ пользователя от 31.08: файлы этих расширений, "потерявшиеся" где-то
  // ещё в дереве — например, в корне — автоматически переносятся сюда).
  var FILES_FOLDER_NAME = "files";
  var MEDIA_MOVE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|mp3)$/i;
  // "Продолжить с той же заметки и с того же места" (см. ТЗ пользователя от
  // 01.09) — состояние {screen, name, cursorPos, scrollPercent, updatedAt}.
  // Хранится и в IndexedDB (idbSet("lastNote", ...), быстрый локальный кэш),
  // и файлом ".mdeditor-state.json" в корне синхронизируемой папки — этот
  // файл едет вместе с остальными заметками через Syncthing на другое
  // устройство, поэтому при холодном старте побеждает та копия (диск или
  // IndexedDB), у которой updatedAt новее (см. readDocStateFromDisk/
  // initFromStoredHandle ниже). screen === "list" означает, что пользователь
  // сам ушёл на список ("домой") — тогда холодный старт должен показать
  // список, а не автоматически открывать заметку (см. goHome ниже).
  var docState = { screen: null, name: null, cursorPos: 0, scrollPercent: null, updatedAt: 0 };
  var STATE_FILE_NAME = ".mdeditor-state.json";
  var screen = "setup";          // "setup" | "list" | "editor"
  var setupNeedsPermission = false;
  // Защита от повторного открытия диалога выбора папки, пока предыдущий
  // ещё не закрыт — браузер разрешает только ОДИН одновременно открытый
  // showDirectoryPicker()/requestPermission() и на повторный вызов кидает
  // "File picker already active". Раньше двойное нажатие на скрепку
  // (например, двойной тап на телефоне) приводило именно к этой ошибке —
  // см. ТЗ пользователя от 31.08.
  var attachPickerBusy = false;
  var statusMessage = "", statusIsError = false;
  var openFile = null;           // {fileHandle,dirHandle,name,text,dirty}
  var cmView = null;
  var mdEditorImageResizeObserver = null; // пересчёт cm-md-image-float при изменении ширины редактора, см. mountEditor/destroyEditor
  // Какая из ДВУХ боковых вкладок второго набора сейчас показывает
  // содержимое этого модуля — "editor" для "Моего блокнота" (set2s_1:
  // список папок/заметок или открытая заметка, старое поведение) и
  // "bookmarks" для вкладки "Закладки" (set2s_2, см.
  // renderSettingsTabMdBookmarks/renderBookmarksScreen ниже). Обе вкладки
  // делят один и тот же rootTree/nameIndex/openFile — заметка, открытая
  // из закладок, открывается тем же экраном "editor", что и обычно (см.
  // render() ниже), поэтому отдельного состояния "screen" для закладок не
  // требуется — важно только, какая вкладка АКТИВНА для показа списка.
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
  // Сканирование директории: рекурсивно собираем дерево .md файлов и
  // индекс имён (без учёта регистра). Пустые папки (без .md ни в них
  // самих, ни во вложенных) в дерево не попадают.
  // ---------------------------------------------------------------------
  async function scanTree(dh){
    var node = { dirHandle: dh, name: "", folders: [], files: [], images: [] };
    // Подпапки собираем в список и сканируем их все ПАРАЛЛЕЛЬНО ниже —
    // раньше for-await дожидался ПОЛНОГО скана одной вложенной папки
    // (со всеми её вложенными подпапками) и только потом переходил к
    // следующей; на дереве с несколькими папками время складывалось из
    // всех подряд, и это была основная причина заметной паузы при каждом
    // открытии "Моего блокнота"/подключении папки (см. ТЗ пользователя от
    // 31.08 — "открываться должно всё мгновенно"). Сам перебор
    // dh.entries() остаётся последовательным (это ограничение самого
    // File System Access API — за раз можно получить только одну запись),
    // но он быстрый: тут нет чтения содержимого файлов, только список имён.
    var subdirs = [];
    for await (var pair of dh.entries()){
      var name = pair[0], handle = pair[1];
      if(handle.kind === "file"){
        if(/\.md$/i.test(name)) node.files.push({ name: name.replace(/\.md$/i, ""), handle: handle });
        else if(IMAGE_EXT_RE.test(name)) node.images.push({ name: name, handle: handle });
      } else if(handle.kind === "directory"){
        subdirs.push({ name: name, handle: handle });
      }
    }
    var children = await Promise.all(subdirs.map(function(sd){ return scanTree(sd.handle); }));
    children.forEach(function(child, i){
      child.name = subdirs[i].name;
      // ссылка на родителя — нужна, чтобы жест "назад" внутри списка
      // заметок поднимался на один уровень вверх, а не сразу в корень
      // (см. pushMdNav в местах перехода по папкам ниже); у
      // rootTree.parent остаётся undefined.
      child.parent = node;
      // папка остаётся в дереве, если внутри (в т.ч. вложенно) есть
      // .md заметки, ПОДпапки или изображения — папка, где лежат
      // только картинки для заметок (без единого .md), раньше молча
      // выпадала из дерева и была не видна в списке; теперь видна.
      if(child.files.length || child.folders.length || child.images.length) node.folders.push(child);
    });
    return node;
  }

  function buildIndex(node, index, imgIndex){
    node.files.forEach(function(f){
      index.set(f.name.toLowerCase(), { fileHandle: f.handle, dirHandle: node.dirHandle, name: f.name });
    });
    node.images.forEach(function(im){
      imgIndex.set(im.name.toLowerCase(), { fileHandle: im.handle, dirHandle: node.dirHandle, name: im.name });
    });
    node.folders.forEach(function(fo){ buildIndex(fo, index, imgIndex); });
  }

  // Цепочка имён папок от корня до узла (для узла-корня — пустой массив)
  // — используется, чтобы после пересканирования (новый объект дерева,
  // старые ссылки на узлы уже не годятся) найти "то же самое" место и не
  // сбрасывать пользователя в корень, если он успел куда-то перейти, пока
  // сканирование шло в фоне (см. rescan/shapeToStubNode ниже).
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

  // "Форма" дерева без FileSystemHandle — только имена папок/заметок/
  // картинок, поэтому спокойно кладётся в IndexedDB и мгновенно читается
  // обратно при следующем открытии вкладки (см. shapeToStubNode и
  // initFromStoredHandle ниже — ТЗ пользователя от 31.08: "открываться
  // должно всё мгновенно").
  function treeToShape(node){
    var shape = {
      folders: node.folders.map(treeToShape),
      files: node.files.map(function(f){ return { name: f.name }; }),
      images: (node.images || []).map(function(im){ return { name: im.name }; })
    };
    if(node.name) shape.name = node.name; // у корня имя пустое — не сохраняем
    return shape;
  }
  // Обратное превращение — черновое дерево из кэша, по форме идентичное
  // настоящему (те же folders/files/images/parent), но с handle: null у
  // каждого файла/картинки. Список из такого дерева рисуется точно так
  // же, как из настоящего (см. renderListScreen), просто клик по строке
  // с ещё не готовым handle ждёт окончания настоящего сканирования (см.
  // openNoteByEntry/openStubItemWhenReady) вместо мгновенной ошибки.
  function shapeToStubNode(shape, parent){
    var node = { dirHandle: null, name: shape.name || "", folders: [], files: [], images: [], stub: true };
    if(parent) node.parent = parent;
    node.folders = (shape.folders || []).map(function(fs){ return shapeToStubNode(fs, node); });
    node.files = (shape.files || []).map(function(f){ return { name: f.name, handle: null }; });
    node.images = (shape.images || []).map(function(im){ return { name: im.name, handle: null }; });
    return node;
  }

  async function rescan(){
    // Раньше перенос "потерявшихся" картинок/mp3 (см. migrateStrayMediaFiles
    // ниже) выполнялся ПЕРЕД построением дерева и блокировал появление
    // списка заметок целиком — если файлов для переноса было много (каждый
    // читается/пишется/удаляется ПО ОДНОМУ, последовательно), сканирование
    // могло зависать на много секунд, и список не показывался вообще (см.
    // ТЗ пользователя от 31.08). Само дерево .md заметок этой миграцией не
    // затрагивается (переносятся только картинки/mp3, см.
    // MEDIA_MOVE_EXT_RE), а imageIndex строится по ВСЕМУ дереву независимо
    // от того, в какой конкретно папке физически лежит файл — поэтому
    // список и открытие заметок с картинками корректны и без ожидания
    // миграции. Сначала строим дерево/индекс (быстро, список появляется
    // сразу), перенос запускаем следом, в фоне, не блокируя rescan().
    var tree = await scanTree(dirHandle);
    tree.name = "";
    // Сохраняем текущее положение в дереве ДО того, как оно будет
    // заменено новым объектом — актуально прежде всего для фонового
    // пересканирования поверх мгновенно показанного кэша (см.
    // initFromStoredHandle): пока оно шло, пользователь мог успеть зайти
    // в какую-то папку, и после замены дерева его не должно откидывать
    // обратно в корень.
    var oldPath = currentDirNode ? folderPath(currentDirNode) : null;
    rootTree = tree;
    currentDirNode = oldPath ? (findNodeByPath(tree, oldPath) || tree) : tree;
    var idx = new Map();
    var imgIdx = new Map();
    buildIndex(tree, idx, imgIdx);
    nameIndex = idx;
    imageIndex = imgIdx;
    // заметки, отсутствующие локально на ЭТОМ устройстве (не синхронизированы
    // Syncthing'ом сюда, либо переименованы/удалены), больше не выкидывают
    // закладку из общего (облачного) списка — она синхронизируется в
    // облаке вместе с остальными данными (см. getSyncedBookmarkNames/
    // setSyncedBookmark выше), поэтому не может быть удалена только на
    // основании того, что файла нет именно здесь: он вполне может быть
    // на другом устройстве. renderBookmarksScreen сам тихо пропускает
    // такие имена (см. entry && ... ниже) — они просто временно не
    // отображаются в списке этого устройства.

    migrateStrayMediaFiles().catch(function(){});
    // Кэш "формы" дерева (см. treeToShape выше) — используется при
    // СЛЕДУЮЩЕМ открытии вкладки, чтобы показать список мгновенно, ещё до
    // окончания настоящего сканирования (см. initFromStoredHandle).
    // Само сканирование при этом никогда не пропускается — кэш только
    // ускоряет первую отрисовку, актуальность данных всегда сверяется
    // заново.
    idbSet("treeShape", treeToShape(tree)).catch(function(){});
  }

  // Клик по строке из мгновенно показанного кэша (см. shapeToStubNode
  // выше), у которой ещё нет настоящего handle, — вместо ошибки просто
  // ждём текущее фоновое сканирование (см. pendingRescanPromise) и
  // открываем по имени уже из настоящего индекса. Название на экране от
  // этого не меняется — просто открытие происходит на долю секунды позже,
  // чем клик.
  function openStubItemWhenReady(name, kind, restorePos, silentFallback, scrollPercent){
    var p = pendingRescanPromise;
    if(!p){
      if(silentFallback){ screen = "list"; render(); return; }
      setStatus("Не удалось найти файл.", true);
      return;
    }
    if(!silentFallback) setStatus("Открываю…");
    p.then(function(){
      setStatus("");
      var key = name.toLowerCase();
      if(kind === "image"){
        var im = imageIndex && imageIndex.get(key);
        if(im) openImagePreview(im.fileHandle, im.name);
        else if(!silentFallback) setStatus("Файл не найден.", true);
      } else {
        var entry = nameIndex && nameIndex.get(key);
        if(entry) openNoteByEntry(entry, restorePos, undefined, scrollPercent);
        else if(silentFallback){ screen = "list"; render(); }
        else setStatus("Заметка не найдена.", true);
      }
    }, function(){
      if(silentFallback){ screen = "list"; render(); return; }
      setStatus("Не удалось обновить список. Попробуйте открыть заметку ещё раз.", true);
    });
  }

  async function ensurePermissionSilently(handle){
    try{
      return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
    }catch(e){ return false; }
  }

  // ---------------------------------------------------------------------
  // Папка "files" — единое место для всех вложений (картинок и mp3, см.
  // MEDIA_MOVE_EXT_RE выше). Файлы этих расширений, лежащие где-то ещё в
  // дереве (например, в самом корне — пользователь мог просто перетащить
  // их туда через проводник), при каждом сканировании автоматически
  // переносятся сюда (см. ТЗ пользователя от 31.08). Картинки в заметках
  // ищутся по имени по всему дереву (см. imageIndex/buildIndex выше), а
  // не по папке конкретной заметки — поэтому от их физического
  // расположения ничего не зависит, переносить их безопасно.
  // ---------------------------------------------------------------------
  async function ensureFilesFolder(){
    return await dirHandle.getDirectoryHandle(FILES_FOLDER_NAME, { create: true });
  }

  // рекурсивно собирает файлы нужных расширений по всему дереву (кроме
  // самой папки "files" в корне — её содержимое не трогаем)
  async function collectStrayMediaEntries(dh, isRootLevel, out){
    for await (var pair of dh.entries()){
      var name = pair[0], handle = pair[1];
      if(handle.kind === "file"){
        if(MEDIA_MOVE_EXT_RE.test(name)) out.push({ dh: dh, handle: handle, name: name });
      } else if(handle.kind === "directory"){
        if(isRootLevel && name === FILES_FOLDER_NAME) continue;
        await collectStrayMediaEntries(handle, false, out);
      }
    }
  }

  // переносит один файл в "files" — копирует содержимое и удаляет
  // оригинал; если в "files" УЖЕ есть файл с таким именем, ничего не
  // перезаписывает и оставляет файл на старом месте (конфликт имён
  // пользователь решает сам, переименовав один из файлов)
  async function moveFileIntoFilesFolder(entry, filesDirHandle){
    try{ await filesDirHandle.getFileHandle(entry.name); return false; }
    catch(e){ /* такого имени в "files" ещё нет — переносим */ }
    var file = await entry.handle.getFile();
    var buf = await file.arrayBuffer();
    var newHandle = await filesDirHandle.getFileHandle(entry.name, { create: true });
    var writable = await newHandle.createWritable();
    await writable.write(buf);
    await writable.close();
    await entry.dh.removeEntry(entry.name);
    return true;
  }

  async function migrateStrayMediaFiles(){
    if(!dirHandle) return;
    var filesDirHandle;
    try{ filesDirHandle = await ensureFilesFolder(); }catch(e){ return; }
    var entries = [];
    try{ await collectStrayMediaEntries(dirHandle, true, entries); }catch(e){ return; }
    // Если несколько файлов из РАЗНЫХ папок называются одинаково — в
    // "files" переезжает только первый (по порядку обхода), остальные
    // остаются на месте, ровно как и раньше при последовательном переносе
    // одного за другим (конфликт имён пользователь решает сам). Помечаем
    // дубликаты здесь, ДО запуска параллельно, а не полагаемся на
    // проверку "такое имя уже есть в files" внутри moveFileIntoFilesFolder
    // — при параллельном переносе несколько таких проверок могли бы
    // одновременно не увидеть друг друга и одинаково "выиграть" гонку.
    var seenNames = new Set();
    var toMigrate = [];
    for(var i = 0; i < entries.length; i++){
      var key = entries[i].name.toLowerCase();
      if(seenNames.has(key)) continue;
      seenNames.add(key);
      toMigrate.push(entries[i]);
    }
    await Promise.all(toMigrate.map(function(entry){
      return moveFileIntoFilesFolder(entry, filesDirHandle).catch(function(){
        /* пропускаем один файл — не мешаем переносу остальных */
      });
    }));
  }


  // ---------------------------------------------------------------------
  // Точка входа — вызывается из switchSettingsTab при каждом открытии
  // вкладки. Состояние (dirHandle/дерево/открытая заметка) переживает
  // переключения между вкладками настроек в рамках одной сессии.
  // ---------------------------------------------------------------------
  function renderSettingsTabMdEditor(){
    activeMdTab = "editor";
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(!initStarted){
      initStarted = true;
      container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
      initFromStoredHandle();
      return;
    }
    render();
  }

  // ---------------------------------------------------------------------
  // Точка входа для вкладки "Закладки" (вторая боковая вкладка второго
  // набора, settingsTabSet2Btn2 / "set2s_2") — та же папка (File System
  // Access API), что и у "Моего блокнота" (см. activeMdTab выше), просто
  // показывает плоский отфильтрованный список вместо дерева папок. Если
  // папка ещё не выбрана — initFromStoredHandle() ниже сам заведёт на
  // общий экран настройки (render() затем сам решит, что показать, см.
  // выше).
  // ---------------------------------------------------------------------
  function renderSettingsTabMdBookmarks(){
    activeMdTab = "bookmarks";
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(!initStarted){
      initStarted = true;
      container.innerHTML = '<div class="mdeditor-tab mdeditor-hint">Загрузка…</div>';
      initFromStoredHandle();
      return;
    }
    render();
  }

  async function initFromStoredHandle(){
    // fontSizeStep уже загружен и применён сразу при создании модуля
    // (см. IIFE рядом с объявлением FONT_SIZE_BASE_PX выше) — здесь
    // повторно грузить его не нужно.
    try{
      var stored = await idbGet("root");
      if(stored){
        dirHandle = stored;
        var ok = await ensurePermissionSilently(stored);
        if(ok){
          // Запускаем загрузку CodeMirror в фоне ПРЯМО СЕЙЧАС, не дожидаясь
          // первого открытия заметки — раньше первый клик по заметке всегда
          // упирался в сетевой import() редактора (см. loadCM выше), теперь
          // к этому моменту он обычно уже готов или почти готов (ТЗ
          // пользователя от 31.08: "открываться должно всё мгновенно").
          loadCM().catch(function(){});

          if(pendingExternalOpen){
            // заметку попросили открыть ИЗВНЕ ещё до того, как папка
            // успела просканироваться (см. openNoteExternally ниже) —
            // список тут вообще не нужен, ждём настоящее сканирование и
            // сразу открываем нужную заметку.
            pendingRescanPromise = rescan();
            await pendingRescanPromise;
            pendingRescanPromise = null;
            var name = pendingExternalOpen;
            pendingExternalOpen = null;
            handleLinkClick(name);
            return;
          }

          // Мгновенный показ списка из кэша ПРЕДЫДУЩЕГО сканирования (см.
          // treeToShape/idbSet("treeShape") в rescan() выше), пока
          // настоящее сканирование (теперь полностью параллельное, см.
          // scanTree) идёт в фоне. Если кэша ещё нет (самый первый запуск
          // после выбора папки) — просто ждём как раньше. Строки, для
          // которых кэш ещё не подтверждён реальным сканированием, при
          // клике не ломаются, а ждут его окончания (см.
          // openStubItemWhenReady/openNoteByEntry) — свежие/удалённые
          // заметки в любом случае появятся/пропадут из списка, как только
          // настоящее сканирование закончится.
          var cachedShape = null;
          try{ cachedShape = await idbGet("treeShape"); }catch(e){}
          var haveStub = false;
          if(cachedShape){
            try{
              var stub = shapeToStubNode(cachedShape, null);
              stub.name = "";
              rootTree = stub;
              currentDirNode = stub;
              var sIdx = new Map(), sImgIdx = new Map();
              buildIndex(stub, sIdx, sImgIdx);
              nameIndex = sIdx;
              imageIndex = sImgIdx;
              haveStub = true;
            }catch(e){ haveStub = false; }
          }

          pendingRescanPromise = rescan();

          // "Продолжить с той же заметки" (см. persistDocStateNow/
          // flushDocStateNow/scheduleDocStateSave выше) — читаем ОДИН раз
          // здесь, до ветвления на haveStub/не-haveStub, и используем в
          // обеих ветках ниже. Читаем СРАЗУ ДВЕ копии состояния — локальную
          // из IndexedDB и файловую с диска (.mdeditor-state.json,
          // см. readDocStateFromDisk) — и берём ту, что новее по updatedAt:
          // файловая копия могла приехать через Syncthing с ДРУГОГО
          // устройства уже после того, как это устройство в последний раз
          // писало в свою собственную IndexedDB (см. ТЗ пользователя от
          // 01.09, пункт 3). Если заметки с таким именем не нашлось
          // (переименована/удалена со времени последнего запуска) —
          // openStubItemWhenReady с silentFallback=true сам вернёт на
          // список, без сообщения об ошибке (см. ниже). screen !== "editor"
          // (например, пользователь в прошлый раз явно ушёл на список
          // кнопкой "домой" — см. goHome) означает, что автоматически
          // открывать заметку не нужно (см. ТЗ, пункт 2).
          var diskStatePromise = readDocStateFromDisk();
          var localState = null;
          try{ localState = await idbGet("lastNote"); }catch(e){}
          var diskState = null;
          try{ diskState = await diskStatePromise; }catch(e){}
          var resolvedState = localState;
          if(diskState && (!localState || (diskState.updatedAt || 0) > (localState.updatedAt || 0))){
            resolvedState = diskState;
          }
          for(var k in resolvedState){ if(resolvedState.hasOwnProperty(k)) docState[k] = resolvedState[k]; }
          var lastNote = docState;

          if(haveStub){
            var resumedFromStub = (lastNote.screen === "editor" && lastNote.name) ? nameIndex.get(lastNote.name.toLowerCase()) : null;
            if(resumedFromStub){
              openNoteByEntry(resumedFromStub, lastNote.cursorPos, true, lastNote.scrollPercent);
            } else {
              screen = "list";
              render();
            }
            pendingRescanPromise.then(function(){
              pendingRescanPromise = null;
              // перерисовываем, только если пользователь всё ещё смотрит
              // список (а не уже открыл заметку из кэша и т.п.) — заметку,
              // открытую тем временем через openStubItemWhenReady, лишний
              // render() тут не потревожит.
              if(screen === "list") render();
            }, function(){ pendingRescanPromise = null; });
            return;
          }

          await pendingRescanPromise;
          pendingRescanPromise = null;
          var resumedEntry = (lastNote.screen === "editor" && lastNote.name) ? nameIndex.get(lastNote.name.toLowerCase()) : null;
          if(resumedEntry){
            openNoteByEntry(resumedEntry, lastNote.cursorPos, undefined, lastNote.scrollPercent);
          } else {
            screen = "list";
            render();
          }
          return;
        }
        setupNeedsPermission = true;
        screen = "setup";
        render();
        return;
      }
    }catch(e){}
    setupNeedsPermission = false;
    screen = "setup";
    render();
  }

  // Открывает заметку по имени СНАРУЖИ модуля — используется, когда клик
  // по [[ссылке]] произошёл НЕ внутри "Моего блокнота" (например, в
  // тексте задачи GTD на другой вкладке, см. initAutoFormatting в my.js):
  // сначала вызывающий код переключает вкладку настроек на "Мой блокнот"
  // (switchSettingsTab("set2s_1") — обычный публичный API my.js), а сразу
  // следом — этот метод. Поведение то же, что и у клика по [[ссылке]]
  // ВНУТРИ самого блокнота (см. handleLinkClick выше), включая
  // автосоздание отсутствующей заметки. Если инициализация (выбор папки/
  // сканирование) ещё не завершилась — запоминает имя и открывает его
  // сразу по готовности (см. конец initFromStoredHandle выше).
  function openNoteExternally(name){
    suppressNextNavPush = true;
    if(!nameIndex){
      pendingExternalOpen = name;
      return;
    }
    handleLinkClick(name);
  }

  function render(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    // вкладка "Закладки" (set2s_2) показывается вместо обычного списка,
    // но только когда папка уже выбрана и просканирована (rootTree
    // готов) — иначе (первый запуск/нужно заново подтвердить доступ)
    // ниже сработает тот же экран настройки папки, что и у "Моего
    // блокнота" (общий для обеих вкладок, см. activeMdTab выше).
    if(activeMdTab === "bookmarks" && rootTree){ renderBookmarksScreen(container); return; }
    if(screen === "editor" && openFile) renderEditorScreen(container);
    else if(screen === "list" && currentDirNode) renderListScreen(container);
    else renderSetupScreen(container);
  }

  // ---------------------------------------------------------------------
  // Экран выбора/переподтверждения папки — виден при первом запуске
  // вкладки (пока путь не указан) и если браузер отозвал разрешение.
  // ---------------------------------------------------------------------
  // Android WebView-браузеры без полноценного Chromium (например, Hermit)
  // заявляют showDirectoryPicker в window, но не реализуют сам системный
  // пикер папок — вызов падает с NotAllowedError про активацию, даже если
  // клик был настоящим (см. ТЗ пользователя от 01.09: работает в Chrome,
  // не работает в Hermit). "; wv)" в UA — стандартный маркер WebView с
  // Android 5.0+; по нему предупреждаем заранее и даём точную причину при
  // отказе вместо голого текста ошибки браузера (см. catch ниже).
  var IS_LIKELY_UNSUPPORTED_WEBVIEW = /;\s*wv\)/i.test(navigator.userAgent);

  // ---------------------------------------------------------------------
  // Отладочный снимок окружения — по прямому запросу пользователя от 02.09
  // ("нужен какой-то отладчик в коде, который покажет, что происходит").
  // Общего сообщения об ошибке недостаточно, чтобы различить причину:
  // снимаем navigator.userActivation.isActive СИНХРОННО в момент клика
  // (единственный момент, когда это значение вообще что-то значит — см.
  // MDN про transient activation) — если оно true, а showDirectoryPicker
  // всё равно падает с NotAllowedError, значит клик тут ни при чём, дело
  // в самой реализации браузера. При отказе дополнительно пробуем
  // showOpenFilePicker() ТОЙ ЖЕ активацией: если он срабатывает, а
  // showDirectoryPicker нет — ломается именно выбор ПАПКИ, а не File
  // System Access целиком (см. обсуждение в Chromium про Android:
  // https://groups.google.com/a/chromium.org/g/blink-dev/c/x3IcFv2jY6c).
  // У Hermit нет встроенных devtools под рукой, поэтому результат
  // выводится прямо на экране (см. renderSetupScreen ниже), а не в
  // консоль.
  var lastDebugSnapshot = null;

  function captureEnvSnapshot(){
    return {
      ua: navigator.userAgent,
      secure: window.isSecureContext,
      hasDirPicker: ("showDirectoryPicker" in window),
      hasOpenPicker: ("showOpenFilePicker" in window),
      activationIsActive: navigator.userActivation ? navigator.userActivation.isActive : "API недоступен",
      activationHasBeenActive: navigator.userActivation ? navigator.userActivation.hasBeenActive : "API недоступен",
      standalone: !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches),
      looksLikeWebView: IS_LIKELY_UNSUPPORTED_WEBVIEW
    };
  }

  function formatDebugSnapshot(s){
    if(!s) return "";
    var lines = [
      "User-Agent: " + s.ua,
      "Secure context: " + s.secure,
      "showDirectoryPicker в window: " + s.hasDirPicker,
      "showOpenFilePicker в window: " + s.hasOpenPicker,
      "userActivation.isActive в момент клика: " + s.activationIsActive,
      "userActivation.hasBeenActive: " + s.activationHasBeenActive,
      "display-mode: standalone: " + s.standalone,
      'Похоже на WebView по UA ("; wv)"): ' + s.looksLikeWebView
    ];
    if("dirPickerResult" in s) lines.push("Результат showDirectoryPicker: " + s.dirPickerResult);
    if("openPickerTest" in s) lines.push("Доп. тест showOpenFilePicker(): " + s.openPickerTest);
    return lines.join("\n");
  }

  function renderSetupScreen(container){
    var hint = setupNeedsPermission
      ? "Доступ к папке с заметками нужно подтвердить заново."
      : "Укажите папку с заметками (.md), чтобы начать.";
    if(IS_LIKELY_UNSUPPORTED_WEBVIEW){
      hint += " Похоже, это браузер на основе Android WebView (например, Hermit) — такие браузеры обычно не умеют показывать системный выбор папки. Если кнопка ниже не сработает, откройте эту страницу в Chrome.";
    }
    var debugBlock = (lastDebugSnapshot && statusIsError)
      ? '<details class="mdeditor-hint" style="margin-top:10px;">' +
          '<summary style="cursor:pointer;">Подробности (отладка)</summary>' +
          '<pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;margin-top:6px;">' + escName(formatDebugSnapshot(lastDebugSnapshot)) + '</pre>' +
        '</details>'
      : '';
    container.innerHTML =
      '<div class="mdeditor-tab settings-content-bottom">' +
        '<h3 class="workbooks-title">Мой блокнот</h3>' +
        '<p class="mdeditor-hint">' + hint + '</p>' +
        '<div class="mdeditor-setup-row">' +
          '<button type="button" class="task-import-attach-btn" id="mdEditorAttachBtn" title="' +
            (setupNeedsPermission ? "Подтвердить доступ" : "Выбрать папку") + '">' + PAPERCLIP_ICON_SVG + '</button>' +
        '</div>' +
        (statusMessage ? '<p class="mdeditor-hint' + (statusIsError ? ' error' : '') + '" style="margin-top:10px;' + (statusIsError ? 'color:var(--status-err,#c0392b);' : '') + '">' + escName(statusMessage) + '</p>' : '') +
        debugBlock +
      '</div>';

    document.getElementById("mdEditorAttachBtn").addEventListener("click", async function(){
      if(attachPickerBusy) return;
      attachPickerBusy = true;
      statusMessage = "";
      var snap = captureEnvSnapshot();
      lastDebugSnapshot = snap;
      try{
        if(setupNeedsPermission && dirHandle){
          var perm = await dirHandle.requestPermission({ mode: "readwrite" });
          if(perm !== "granted"){
            statusMessage = "Доступ не предоставлен."; statusIsError = true; render(); return;
          }
        } else {
          if(!("showDirectoryPicker" in window)){
            statusMessage = "Этот браузер не поддерживает выбор папки (нужен Chrome или Edge, на Android или на компьютере).";
            statusIsError = true; render(); return;
          }
          var handle;
          try{
            handle = await window.showDirectoryPicker({ mode: "readwrite" });
            snap.dirPickerResult = "успех";
          }catch(pickerErr){
            snap.dirPickerResult = (pickerErr && pickerErr.name) + (pickerErr && pickerErr.message ? (": " + pickerErr.message) : "");
            // Доп. тест ТОЙ ЖЕ активацией — см. комментарий про
            // lastDebugSnapshot выше.
            if(pickerErr && pickerErr.name === "NotAllowedError" && ("showOpenFilePicker" in window)){
              try{
                await window.showOpenFilePicker({ multiple:false });
                snap.openPickerTest = "сработал (диалог открылся) — проблема именно в выборе ПАПКИ";
              }catch(secErr){
                if(secErr && secErr.name === "AbortError"){
                  snap.openPickerTest = "сработал (диалог открылся, отменено) — проблема именно в выборе ПАПКИ";
                } else {
                  snap.openPickerTest = "тоже отказал: " + (secErr && secErr.name) + (secErr && secErr.message ? (": " + secErr.message) : "");
                }
              }
            }
            throw pickerErr;
          }
          dirHandle = handle;
          try{ await idbSet("root", handle); }catch(e){}
          // новая папка — старые URL картинок из прошлой библиотеки больше
          // не нужны и указывают на чужие файлы, освобождаем память
          imageUrlCache.forEach(function(v){ if(v && v.url) URL.revokeObjectURL(v.url); });
          imageUrlCache.clear();
        }
        setupNeedsPermission = false;
        statusMessage = "Сканируем папку…"; statusIsError = false; render();
        // редактор грузится параллельно со сканированием, а не только по
        // первому клику на заметку (см. ТЗ пользователя от 31.08)
        loadCM().catch(function(){});
        pendingRescanPromise = rescan();
        await pendingRescanPromise;
        pendingRescanPromise = null;
        statusMessage = "";
        // "продолжить с той же заметки" (см. ТЗ пользователя от 01.09) —
        // этот экран показывается именно тогда, когда после закрытия
        // приложения разрешение на папку пришлось подтверждать заново
        // (setupNeedsPermission) или папка выбирается впервые; в обоих
        // случаях нужно попытаться вернуться на последнюю открытую
        // заметку, а не молча сбрасывать на список (см.
        // resumeLastNoteOrShowList выше).
        await resumeLastNoteOrShowList();
      }catch(e){
        if(e && e.name === "AbortError") return;
        // NotAllowedError именно на ПЕРВОМ выборе папки (не на переподтверждении
        // прав уже сохранённого dirHandle — см. IS_LIKELY_UNSUPPORTED_WEBVIEW
        // выше) — это не отказ пользователя, а браузер, который заявляет
        // showDirectoryPicker, но не реализует сам системный диалог (Hermit и
        // другие WebView-обёртки без полноценного Chromium). Полный разбор —
        // в lastDebugSnapshot, выводится ниже блоком "Подробности (отладка)"
        // (запрос пользователя на отладчик от 02.09).
        if(e && e.name === "NotAllowedError" && !(setupNeedsPermission && dirHandle)){
          statusMessage = "Этот браузер не даёт открыть системный выбор папки" +
            (IS_LIKELY_UNSUPPORTED_WEBVIEW ? " — так бывает в браузерах на основе Android WebView (например, Hermit)." : ".") +
            " Откройте эту страницу в Chrome или Edge. Подробности — ниже.";
          statusIsError = true; render(); return;
        }
        // Показываем настоящую причину (имя/текст ошибки браузера), а не
        // один и тот же общий текст на любую проблему — иначе непонятно,
        // где именно оно ломается: при выборе папки, при подтверждении
        // доступа или уже при самом сканировании (см. ТЗ пользователя от
        // 31.08 — по одной фразе "не удалось получить доступ" невозможно
        // было разобрать, что происходит на самом деле).
        var detail = e && (e.message || e.name) ? (e.name ? e.name + (e.message ? ": " + e.message : "") : e.message) : String(e);
        statusMessage = "Не удалось получить доступ к папке" + (detail ? " (" + detail + ")" : "") + ".";
        statusIsError = true; render();
      }finally{
        attachPickerBusy = false;
      }
    });
  }

  // ---------------------------------------------------------------------
  // Экран списка тем: алфавитный список внутри текущей "папки" — файлы
  // из вложенных папок в общий список НЕ попадают, вместо них показывается
  // сама папка (см. ТЗ пользователя); "домик" всегда ведёт в корень.
  // ---------------------------------------------------------------------
  function renderListScreen(container){
    var node = currentDirNode;
    var folderItems = node.folders.map(function(fo){ return { type: "folder", name: fo.name, node: fo }; });
    var fileItems = node.files.map(function(f){ return { type: "file", name: f.name, handle: f.handle }; });
    // изображения (из "отдельной папки" рядом с заметками, см. scanTree) —
    // отдельной группой ПОСЛЕ заметок, тем же алфавитным порядком; клик
    // открывает картинку крупно поверх вкладки (см. openImagePreview)
    var imageItems = (node.images || []).map(function(im){ return { type: "image", name: im.name, handle: im.handle }; });
    folderItems.sort(function(a, b){ return a.name.localeCompare(b.name, "ru", { sensitivity: "base" }); });
    // заметки, чьё имя начинается с цифры (даты вроде "04.2025",
    // "2026-04-27" и т.п.), — отдельной группой В КОНЦЕ списка, а не в
    // начале, как получалось при простой алфавитной сортировке (цифры
    // сортируются раньше букв). Внутри каждой из двух групп порядок
    // остаётся прежним — алфавитным/хронологическим.
    fileItems.sort(function(a, b){
      var da = /^\d/.test(a.name) ? 1 : 0;
      var db = /^\d/.test(b.name) ? 1 : 0;
      if(da !== db) return da - db;
      return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
    });
    imageItems.sort(function(a, b){ return a.name.localeCompare(b.name, "ru", { sensitivity: "base" }); });
    var items = folderItems.concat(fileItems).concat(imageItems);

    var isRoot = (node === rootTree);
    var html = '<div class="mdeditor-tab">';
    html += '<h3 class="workbooks-title" style="margin:0 0 4px 0;">' + (isRoot ? "Мой блокнот" : escName(node.name)) + '</h3>';
    if(!items.length){
      html += '<div class="mdeditor-empty">' + (isRoot ? "В этой папке нет .md заметок." : "Здесь пока пусто.") + '</div>';
    } else {
      html += '<div class="mdeditor-list" id="mdEditorList"></div>';
    }
    html += '<div class="mdeditor-fab-row">';
    // "домик" теперь ВСЕГДА активен (не disabled даже в корне) — раньше в
    // корне списка кнопка была просто неактивной заглушкой; теперь клик по
    // ней в корне прокручивает список к самому началу (полезно, когда
    // список длинный и прокручен вниз), а вне корня — как и раньше,
    // возвращает в корень.
    html += '<button type="button" class="mdeditor-fab-btn" id="mdEditorHomeBtn" title="К списку заметок">' + HOME_ICON_SVG + '</button>';
    html += '</div>';
    html += '</div>';
    container.innerHTML = html;

    var homeBtn = document.getElementById("mdEditorHomeBtn");
    if(homeBtn){
      homeBtn.addEventListener("click", function(){
        if(!isRoot){
          var prevDirNode = currentDirNode;
          pushMdNav(function(){ currentDirNode = prevDirNode; render(); });
          currentDirNode = rootTree;
          render();
        } else {
          // прокручивается #settingsTabContent целиком (тот же приём, что
          // и везде в проекте, см. switchSettingsTab в my.js) — а НЕ
          // .mdeditor-list, у которого своей прокрутки нет: список внутри
          // просто растягивает содержимое, и физически скроллится именно
          // #settingsTabContent
          var sc = document.getElementById("settingsTabContent");
          if(sc) sc.scrollTop = 0;
        }
      });
    }

    var listEl = document.getElementById("mdEditorList");
    if(listEl){
      // Строки создаются БЕЗ индивидуальных слушателей (раньше на каждую
      // заметку вешалось до 9: клик по строке, клик по кнопке закладки и
      // 7 touch/mouse для долгого нажатия) — на блокноте с сотнями заметок
      // это была заметная работа при каждой отрисовке списка (см. ТЗ
      // пользователя от 31.08). Вместо этого ниже один делегированный
      // набор слушателей на весь список (#mdEditorList) — строка находится
      // по data-index через closest(), поведение то же самое.
      items.forEach(function(it, idx){
        // строка — <div>, а не <button> — заметкам (it.type==="file")
        // нужна ВТОРАЯ, отдельно кликабельная зона справа от названия
        // (кнопка закладки, см. ниже), а вложенный <button> внутри
        // <button> — невалидная разметка; тот же приём (div-строка +
        // кнопки действий внутри), что и у строк задач на вкладках задач,
        // см. .task-row/.task-actions в my.js.
        var row = document.createElement("div");
        row.className = "mdeditor-row";
        row.dataset.index = String(idx);
        var isNote = (it.type === "file");
        row.innerHTML = (it.type === "folder" ? FOLDER_ICON_SVG : it.type === "image" ? IMAGE_ICON_SVG : FILE_ICON_SVG) +
          '<span class="mdeditor-row-name"></span>' +
          (isNote ? '<button type="button" class="mdeditor-bookmark-btn" title="Закладка">' + BOOKMARK_ICON_SVG + '</button>' : '');
        row.querySelector(".mdeditor-row-name").textContent = it.name;
        if(isNote){
          var key = it.name.toLowerCase();
          var bmBtn = row.querySelector(".mdeditor-bookmark-btn");
          var bookmarked = bookmarkedNames.has(key);
          bmBtn.classList.toggle("active", bookmarked);
          bmBtn.classList.toggle("visible", bookmarked || revealedBookmarkRows.has(key));
        }
        listEl.appendChild(row);
      });

      // ---- долгое нажатие (350мс) на строку заметки — тот же приём, что
      // и раньше (таймер, сброс при заметном сдвиге пальца/курсора), но
      // ОДНИМ набором слушателей на весь список вместо отдельного на
      // каждую строку.
      var LONG_PRESS_MS = 350, MOVE_CANCEL_PX = 10;
      var pressTimer = null, pressStartXY = null, longPressFired = false;
      function clearPressTimer(){ clearTimeout(pressTimer); pressTimer = null; }
      function startPress(rowEl, x, y){
        if(!rowEl) return;
        var it = items[Number(rowEl.dataset.index)];
        if(!it || it.type !== "file") return;
        longPressFired = false;
        pressStartXY = { x: x, y: y };
        clearPressTimer();
        pressTimer = setTimeout(function(){
          longPressFired = true;
          var key = it.name.toLowerCase();
          revealedBookmarkRows.add(key);
          var bmBtn = rowEl.querySelector(".mdeditor-bookmark-btn");
          if(bmBtn) bmBtn.classList.add("visible");
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

      // ---- клик по строке (открыть/перейти) и по кнопке закладки —
      // тоже один делегированный обработчик вместо двух на каждую строку.
      listEl.addEventListener("click", function(e){
        var rowEl = e.target.closest(".mdeditor-row");
        if(!rowEl) return;
        var it = items[Number(rowEl.dataset.index)];
        if(!it) return;
        if(e.target.closest(".mdeditor-bookmark-btn")){
          toggleBookmarkNote(it.name);
          return;
        }
        if(longPressFired){ longPressFired = false; return; }
        if(it.type === "folder"){
          var prevDirNode = currentDirNode;
          pushMdNav(function(){ currentDirNode = prevDirNode; render(); });
          currentDirNode = it.node;
          render();
        }
        else if(it.type === "image"){
          if(it.handle) openImagePreview(it.handle, it.name);
          else openStubItemWhenReady(it.name, "image");
        }
        else { openNoteByEntry({ fileHandle: it.handle, dirHandle: node.dirHandle, name: it.name }); }
      });
    }
  }

  // ---------------------------------------------------------------------
  // Вкладка "Закладки" (вторая боковая вкладка второго набора,
  // settingsTabSet2Btn2 / "set2s_2", см. renderSettingsTabMdBookmarks
  // выше) — БОЛЬШЕ НЕ ЗАГЛУШКА: плоский список заметок, добавленных в
  // закладки (см. bookmarkedNames/toggleBookmarkNote выше), в ТОМ ЖЕ
  // стиле строки, что и обычный список "Моего блокнота" (см.
  // renderListScreen выше) — просто без папок/картинок и без
  // вложенности, сортировка та же (сперва имена не с цифры, по алфавиту,
  // затем "числовые" имена тоже по алфавиту). Кнопка закладки у каждой
  // строки здесь всегда видна и всегда "активна" (иначе заметки в этом
  // списке бы не было) — клик по ней снимает закладку, и заметка сразу
  // пропадает из списка (см. ТЗ пользователя), тем же переключателем
  // toggleBookmarkNote, что и везде.
  // ---------------------------------------------------------------------
  function renderBookmarksScreen(container){
    var items = [];
    bookmarkedNames.forEach(function(key){
      var entry = nameIndex && nameIndex.get(key);
      if(entry) items.push({ name: entry.name, handle: entry.fileHandle, dirHandle: entry.dirHandle });
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
          openNoteByEntry({ fileHandle: it.handle, dirHandle: it.dirHandle, name: it.name });
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
  // "Скрепка" в редакторе заметки (см. renderEditorScreen выше) — картинка
  // из системного диалога копируется в папку "files" (создаётся, если её
  // ещё нет) и сразу вставляется в документ как "![[имя]]" на месте
  // курсора — тот же синтаксис вложенной картинки, что и везде в "Моём
  // блокноте" (см. ImageWidget выше).
  // ---------------------------------------------------------------------
  // если файл с таким именем в "files" уже есть — не перезаписываем его,
  // а подбираем свободное имя (" (2)", " (3)", ... перед расширением, как
  // это обычно делают файловые менеджеры)
  async function uniqueFileNameIn(dh, rawName){
    var name = rawName || "image";
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : "";
    var candidate = name, n = 1;
    for(;;){
      try{ await dh.getFileHandle(candidate); }
      catch(e){ return candidate; }
      n++;
      candidate = base + " (" + n + ")" + ext;
    }
  }

  async function insertImageAtCursor(file){
    if(!dirHandle || !cmView) return;
    setStatus("Добавляем картинку…", false);
    try{
      var filesDirHandle = await ensureFilesFolder();
      var name = await uniqueFileNameIn(filesDirHandle, file.name || "image");
      var buf = await file.arrayBuffer();
      var newHandle = await filesDirHandle.getFileHandle(name, { create: true });
      var writable = await newHandle.createWritable();
      await writable.write(buf);
      await writable.close();
      // сразу доступна по имени, как и остальные картинки (см.
      // imageIndex/buildIndex выше) — без ожидания следующего rescan()
      if(imageIndex) imageIndex.set(name.toLowerCase(), { fileHandle: newHandle, dirHandle: filesDirHandle, name: name });
      var pos = cmView.state.selection.main.head;
      var insertText = "![[" + name + "]]";
      cmView.dispatch({
        changes: { from: pos, to: pos, insert: insertText },
        selection: { anchor: pos + insertText.length }
      });
      cmView.focus();
      setStatus("", false);
    }catch(e){
      setStatus("Не удалось добавить картинку: " + (e && e.message ? e.message : e), true);
    }
  }


  // ---------------------------------------------------------------------
  // Экран заметки: шапка (домик / заголовок-переименование / переключатель
  // режима) + хост CodeMirror 6, занимающий всё оставшееся место вкладки.
  // ---------------------------------------------------------------------

  function renderEditorScreen(container){
    fontSizePanelOpen = false; // экран перерисован заново — попап "+"/"-" каждый раз стартует закрытым
    formatPanelOpen = false; // и попап "Ж"/"К"/"П"/"Ч" тоже
    container.innerHTML =
      '<div class="mdeditor-tab mdeditor-editor-tab">' +
        '<div class="mdeditor-title-row" id="mdEditorTitleRow">' +
          '<span class="mdeditor-title" id="mdEditorTitle" title="Нажмите, чтобы переименовать"></span>' +
          '<button type="button" class="mdeditor-bookmark-btn visible" id="mdEditorBookmarkBtn" title="Закладка">' + BOOKMARK_ICON_SVG + '</button>' +
        '</div>' +
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
    // остальные кнопки ряда. Вставляет картинку, выбранную через
    // системный диалог, в место курсора — сама картинка при этом
    // копируется в папку "files" (см. insertImageAtCursor ниже), как и
    // mp3/картинки, "потерявшиеся" где-то ещё в дереве (см.
    // migrateStrayMediaFiles выше).
    document.getElementById("mdEditorImageBtn").addEventListener("click", function(){
      var input = document.getElementById("mdEditorImageInput");
      if(input) input.click();
    });
    document.getElementById("mdEditorImageInput").addEventListener("change", function(ev){
      var file = ev.target.files && ev.target.files[0];
      // сбрасываем value — иначе повторный выбор ТОГО ЖЕ файла подряд не
      // порождает новое событие "change"
      ev.target.value = "";
      if(file) insertImageAtCursor(file);
    });

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
  }

  function goHome(){
    flushAutosaveNow();
    destroyEditor();
    openFile = null;
    currentDirNode = rootTree;
    screen = "list";
    render();
    // Явный уход на список ("домой") — при следующем холодном старте нужно
    // показать список, а НЕ снова открыть заметку, из которой ушли (см. ТЗ
    // пользователя от 01.09, пункт 2). persistDocStateNow пишет это сразу,
    // без дебаунса — как и остальные явные переходы (см. openNoteByEntry).
    persistDocStateNow({ screen: "list", name: null, cursorPos: 0, scrollPercent: null });
    // не ждём дебаунс на запись файла (см. scheduleDiskStateWrite выше) —
    // это осознанный уход на список, а не рядовая правка текста, пишем на
    // диск сразу же, чтобы другое устройство тоже увидело "список" при
    // следующей синхронизации Syncthing.
    writeDocStateToDiskNow();
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

  async function commitRename(newNameRaw){
    var newName = (newNameRaw || "").trim();
    if(!newName || newName === openFile.name){ render(); return; }
    var key = newName.toLowerCase();
    if(nameIndex.has(key)){
      setStatusAndRerenderTitle("Заметка с таким именем уже есть.", true);
      return;
    }
    setStatusAndRerenderTitle("Переименование…", false);
    try{
      var dh = openFile.dirHandle;
      var newHandle = await dh.getFileHandle(newName + ".md", { create: true });
      var writable = await newHandle.createWritable();
      await writable.write(openFile.text);
      await writable.close();
      await dh.removeEntry(openFile.name + ".md");
      var oldName = openFile.name;
      openFile.fileHandle = newHandle;
      openFile.name = newName;
      // "продолжить с той же заметки" хранит имя заметки (см. docState
      // выше) — без этого холодный старт после переименования искал бы
      // заметку под старым, уже не существующим именем.
      flushDocStateNow();
      // если переименованная заметка была в закладках — закладка следует
      // за новым именем (ключ закладки — имя в нижнем регистре, см.
      // bookmarkedNames выше); теперь это два отдельных ключа
      // синхронизируемого state (см. setSyncedBookmark), поэтому старое
      // имя явно снимается с закладок, а не просто перестаёт
      // встречаться в индексе.
      if(bookmarkedNames.has(oldName.toLowerCase())){
        bookmarkedNames.delete(oldName.toLowerCase());
        bookmarkedNames.add(newName.toLowerCase());
        setSyncedBookmark(oldName.toLowerCase(), false);
        setSyncedBookmark(newName.toLowerCase(), true);
      }

      await rescan();
      // rescan() пересобирает дерево и индекс с нуля — переоткрытая заметка
      // (уже с новым именем) в нём уже есть.
      setStatusAndRerenderTitle("Обновляем ссылки в остальных заметках…", false);
      await propagateRename(oldName, newName);
      setStatusAndRerenderTitle("Переименовано.", false);
      render();
    }catch(e){
      setStatusAndRerenderTitle("Не удалось переименовать: " + (e && e.message ? e.message : e), true);
      render();
    }
  }

  function setStatusAndRerenderTitle(msg, isError){
    setStatus(msg, isError);
  }

  // Проходит по ВСЕМ .md файлам директории (по актуальному nameIndex,
  // построенному rescan()) и заменяет точные совпадения [[старое_имя]]
  // (без учёта регистра) на [[новое_имя]] — выполняется асинхронно, не
  // блокируя ввод в открытой заметке.
  async function propagateRename(oldName, newName){
    var esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("\\[\\[(" + esc + ")\\]\\]", "gi");
    var entries = Array.from(nameIndex.values());
    for(var i = 0; i < entries.length; i++){
      var entry = entries[i];
      try{
        var file = await entry.fileHandle.getFile();
        var text = await file.text();
        re.lastIndex = 0;
        if(!re.test(text)) continue;
        re.lastIndex = 0;
        var updated = text.replace(re, "[[" + newName + "]]");
        var w = await entry.fileHandle.createWritable();
        await w.write(updated);
        await w.close();
        if(openFile && entry.name.toLowerCase() === openFile.name.toLowerCase() && entry.fileHandle === openFile.fileHandle){
          openFile.text = updated;
          if(cmView){
            cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: updated } });
          }
        }
      }catch(e){ /* пропускаем файл, если не удалось прочитать/записать */ }
    }
  }

  // ---------------------------------------------------------------------
  // Открытие заметки / переход по [[ссылке]]
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Переактивация ПРАВА НА ЗАПИСЬ реальным requestPermission() — один раз
  // за сессию, при первом клике по заметке (см. переписку с пользователем:
  // подтверждено тестированием, что именно это чинит проблему). Дело в
  // том, что queryPermission() при холодном старте (см.
  // ensurePermissionSilently/initFromStoredHandle выше) читает
  // ЗАКЭШИРОВАННУЮ запись о разрешении внутри Chrome и на части
  // Android-планшетов возвращает "granted" даже тогда, когда фактический
  // грант на запись у SAF-провайдера ОС уже не активен — из-за этого
  // список заметок открывается нормально (чтение работает), но ПЕРВАЯ ЖЕ
  // попытка записи падает с NotFoundError. requestPermission(), в отличие
  // от queryPermission(), действительно сверяется с ОС — это тот самый
  // вызов, что срабатывает при нажатии "подтвердить доступ" на экране
  // настройки папки (см. renderSetupScreen выше). Вызываем его здесь же,
  // но автоматически, при первом клике по заметке в сессии — открытие
  // заметки уже гарантированно происходит по клику пользователя, так что
  // "user activation" для этого вызова есть. Не await'им и не блокируем
  // открытие заметки: если разрешение и так рабочее, requestPermission()
  // резолвится почти мгновенно и без всякого диалога (диалог показывается,
  // только если текущее состояние — "prompt", а не "granted"); если нет —
  // ошибка при необходимости всё ещё проявится при автосохранении, как и
  // раньше, просто это теперь редкий случай, а не постоянный.
  var writePermissionReverified = false;
  function reverifyWritePermissionOnce(){
    if(writePermissionReverified || !dirHandle || !dirHandle.requestPermission) return;
    writePermissionReverified = true;
    dirHandle.requestPermission({ mode: "readwrite" }).catch(function(){});
  }

  function openNoteByEntry(entry, restorePos, silentFallback, scrollPercent){
    reverifyWritePermissionOnce();
    // Запись из мгновенно показанного кэша (см. shapeToStubNode), для
    // которой настоящее сканирование ещё не подобрало handle, — ждём его
    // вместо попытки читать null как файл (см. openStubItemWhenReady).
    if(!entry || !entry.fileHandle){
      if(entry) openStubItemWhenReady(entry.name, "file", restorePos, silentFallback, scrollPercent);
      return;
    }
    // снимок состояния ДО открытия заметки — если открытие пришло по
    // [[ссылке]] снаружи модуля, регистрация подавляется (см. pushMdNav и
    // openNoteExternally выше), и "назад" вернёт прямо на вкладку/экран,
    // откуда кликнули по ссылке, а не в список заметок блокнота.
    var prevScreen = screen, prevDirNode = currentDirNode, prevOpenFile = openFile;
    pushMdNav(function(){
      flushAutosaveNow();
      destroyEditor();
      openFile = prevOpenFile;
      currentDirNode = prevDirNode;
      screen = prevScreen;
      render();
    });
    flushAutosaveNow();
    destroyEditor();
    entry.fileHandle.getFile().then(function(f){ return f.text(); }).then(function(text){
      var pos = typeof restorePos === "number" ? Math.max(0, Math.min(restorePos, text.length)) : 0;
      var pct = typeof scrollPercent === "number" ? Math.max(0, Math.min(1, scrollPercent)) : null;
      openFile = { fileHandle: entry.fileHandle, dirHandle: entry.dirHandle, name: entry.name, text: text, dirty: false, cursorPos: pos, scrollPercent: pct };
      screen = "editor";
      render();
      // "продолжить с той же заметки" (см. flushDocStateNow/scheduleDocStateSave
      // ниже) — помечаем эту заметку как текущую сразу при открытии, не
      // дожидаясь первого редактирования: если пользователь просто закроет
      // приложение, ничего не поправив, холодный старт всё равно вернёт
      // сюда же.
      persistDocStateNow({ screen: "editor", name: entry.name, cursorPos: pos, scrollPercent: pct });
      // как и в goHome — это осознанная навигация, не рядовая правка текста
      // под дебаунсом; пишем на диск сразу (см. writeDocStateToDiskNow).
      writeDocStateToDiskNow();
    }).catch(function(){
      setStatus("Не удалось открыть заметку.", true);
    });
  }


  // Клик по [[ссылке]] на несуществующую заметку — сразу создаём пустой
  // файл в корне и открываем его (решение согласовано с пользователем).
  async function createAndOpenNote(name){
    reverifyWritePermissionOnce();
    try{
      var fh = await dirHandle.getFileHandle(name + ".md", { create: true });
      var w = await fh.createWritable();
      await w.write("");
      await w.close();
      nameIndex.set(name.toLowerCase(), { fileHandle: fh, dirHandle: dirHandle, name: name });
      rootTree.files.push({ name: name, handle: fh });
      var prevScreen = screen, prevDirNode = currentDirNode, prevOpenFile = openFile;
      pushMdNav(function(){
        flushAutosaveNow();
        destroyEditor();
        openFile = prevOpenFile;
        currentDirNode = prevDirNode;
        screen = prevScreen;
        render();
      });
      flushAutosaveNow();
      destroyEditor();
      openFile = { fileHandle: fh, dirHandle: dirHandle, name: name, text: "", dirty: false };
      screen = "editor";
      render();
    }catch(e){
      setStatus("Не удалось создать заметку: " + (e && e.message ? e.message : e), true);
    }
  }

  function handleLinkClick(name){
    var trimmed = (name || "").trim();
    if(!trimmed || !nameIndex) return;
    var entry = nameIndex.get(trimmed.toLowerCase());
    if(entry) openNoteByEntry(entry);
    else createAndOpenNote(trimmed);
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

  // Каноническое имя для отображения: если заметка с таким именем
  // существует — берём её реальное имя файла (правильный регистр),
  // иначе показываем как набрано в тексте (ссылка на ещё не созданную
  // заметку — клик по ней создаст её, см. handleLinkClick).
  function resolveLinkDisplayName(rawName){
    var trimmed = (rawName || "").trim();
    if(!trimmed) return trimmed;
    var entry = nameIndex ? nameIndex.get(trimmed.toLowerCase()) : null;
    return entry ? entry.name : trimmed;
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
  // Просмотр картинки крупно — по клику на строку-изображение в списке
  // тем/папок. Полупрозрачная подложка поверх ВСЕГО settings-modal-box
  // (см. .mdeditor-image-overlay в components.css), закрывается по клику
  // в любом месте. Object URL создаётся заново при каждом открытии и
  // освобождается при закрытии (файл может быть большим, не держим ссылку
  // дольше, чем реально показываем).
  // ---------------------------------------------------------------------
  function openImagePreview(handle, name){
    var box = document.querySelector(".settings-modal-box");
    if(!box) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-image-overlay";
    var img = document.createElement("img");
    img.alt = name;
    overlay.appendChild(img);
    var objectUrl = null;
    function close(){
      if(objectUrl) URL.revokeObjectURL(objectUrl);
      overlay.removeEventListener("click", close);
      if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.addEventListener("click", close);
    box.appendChild(overlay);
    handle.getFile().then(function(f){
      objectUrl = URL.createObjectURL(f);
      img.src = objectUrl;
    }).catch(function(){
      overlay.textContent = "Не удалось открыть «" + name + "».";
    });
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

  // Планшеты (в первую очередь Android, Storage Access Framework) иногда
  // сами "протухают" уже выданный FileSystemFileHandle — как правило,
  // после сворачивания приложения или любого изменения файла в обход
  // самого хендла (например, синхронизация облака). Попытка
  // createWritable()/write() на таком хендле кидает DOMException
  // "An operation that depends on state cached in an interface object
  // was made but the state had changed since it was read from disk."
  // Сам по себе хендл при этом не "лечится" — единственный выход:
  // заново получить свежий хендл на тот же файл у родительской папки
  // (fileRef.dirHandle+fileRef.name) и повторить запись уже с ним.
  // Делаем это один раз (isRetry защищает от бесконечного цикла) — если
  // и повторная попытка не поможет, значит дело не в протухшем хендле,
  // а в чём-то другом, и ошибку показываем как есть.
  function isStaleHandleError(e){
    return !!(e && (e.name === "InvalidStateError" || e.name === "NotReadableError") &&
      /state had changed since it was read from disk/i.test((e.message || "")));
  }
  // Отдельный случай (в отличие от isStaleHandleError выше) — планшеты
  // Android чаще ЗАМОРАЖИВАЮТ вкладку в фоне, а не убивают её целиком (в
  // отличие от телефонов с меньшим запасом RAM): JS-состояние (dirHandle,
  // openFile) остаётся как есть, но SAF-провайдер (отдельный процесс ОС,
  // через который Android резолвит content-URI под хендлами) тем временем
  // может быть перезапущен системой независимо от вкладки. Первая же
  // попытка записи после разморозки вкладки иногда попадает на ещё не
  // "прогретый" провайдер и кидает DOMException NotFoundError ("A
  // requested file or directory could not be found..."), хотя реального
  // отзыва разрешения нет (queryPermission() в этот момент всё ещё вернул
  // бы "granted") — лечится так же, как и stale handle выше: заново
  // получить свежий fileHandle у dirHandle и повторить запись, но с
  // небольшой задержкой перед повтором (провайдеру нужна доля секунды на
  // переподключение) и до двух попыток вместо одной, т.к. это не
  // одномоментная "порча" хендла, а именно гонка с ещё не готовым
  // провайдером.
  function isTransientNotFoundError(e){
    return !!(e && e.name === "NotFoundError" &&
      /could not be found/i.test((e.message || "")));
  }
  function delay(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function writeFileText(fileRef, text, attempt){
    attempt = attempt || 0;
    return fileRef.fileHandle.createWritable().then(function(w){
      return w.write(text).then(function(){ return w.close(); });
    }).catch(function(e){
      var canRetry = fileRef.dirHandle && fileRef.name && attempt < 2;
      if(canRetry && isStaleHandleError(e)){
        return fileRef.dirHandle.getFileHandle(fileRef.name, { create:false }).then(function(freshHandle){
          fileRef.fileHandle = freshHandle;
          return writeFileText(fileRef, text, attempt + 1);
        });
      }
      if(canRetry && isTransientNotFoundError(e)){
        return delay(250 * (attempt + 1)).then(function(){
          return fileRef.dirHandle.getFileHandle(fileRef.name, { create:false }).then(function(freshHandle){
            fileRef.fileHandle = freshHandle;
            return writeFileText(fileRef, text, attempt + 1);
          });
        });
      }
      throw e;
    });
  }

  // ---------------------------------------------------------------------
  // "Продолжить с той же заметки и с того же места" (см. ТЗ пользователя
  // от 01.09) — отдельно от автосохранения ТЕКСТА В ФАЙЛ: здесь запоминаем,
  // какая заметка сейчас открыта (или что пользователь ушёл на список),
  // курсор И реальную прокрутку (в процентах — так, что "то же место"
  // остаётся тем же и на устройстве с другой шириной экрана/переносом
  // строк, где абсолютный пиксель ничего не значит), чтобы при следующем
  // холодном старте (в т.ч. на ДРУГОМ устройстве через Syncthing — см.
  // writeDocStateToDiskNow/readDocStateFromDisk ниже) открыть то же самое
  // место (см. initFromStoredHandle). Нарочно не завязано на
  // openFile.dirty/успешность записи текста файла — позицию надо помнить,
  // даже если пользователь просто прокручивал/кликал, не меняя текста, и
  // даже если сама запись текста в файл в этот момент не удалась.
  var docStateSaveTimer = null;
  // Ссылка на #settingsTabContent и на конкретную функцию-обработчик,
  // навешанную на его "scroll" в mountEditor() — нужна, чтобы снять именно
  // этот слушатель в destroyEditor() и не плодить дубликаты при каждом
  // повторном открытии заметки/перемонтировании редактора (см. mountEditor).
  var mdEditorScrollContainer = null;
  var mdEditorScrollHandler = null;
  function persistDocStateNow(patch){
    for(var k in patch){ if(patch.hasOwnProperty(k)) docState[k] = patch[k]; }
    docState.updatedAt = Date.now();
    idbSet("lastNote", docState).catch(function(){});
    scheduleDiskStateWrite();
  }
  // Реальная прокрутка редактора В ПРОЦЕНТАХ от прокручиваемой высоты —
  // именно это, а не только позиция курсора, нужно, чтобы "то же место"
  // восстанавливалось и при простом чтении/прокрутке без единого клика
  // (см. переписку с пользователем от 01.09, пункт 1: раньше запоминалась
  // только позиция курсора, которая при чтении без правок вообще не
  // менялась, поэтому после возврата вкладки видно было самое начало).
  // ИСПРАВЛЕНО (01.09, вторая попытка): у .mdeditor-editor-host/.cm-editor
  // нет своего overflow/ограничения по высоте — редактор растягивается на
  // всю высоту текста, поэтому cmView.scrollDOM физически никогда не
  // скроллится (scrollHeight===clientHeight у него всегда, max<=0 — эта
  // функция раньше всегда возвращала 0, а восстановление ниже в mountEditor
  // по той же причине никогда не срабатывало и откатывалось на позицию
  // курсора). Реальная прокрутка, которую видит пользователь, происходит на
  // #settingsTabContent — том же самом элементе, что прокручивает список
  // заметок (см. renderListScreen выше, комментарий про "домик"). Считаем
  // процент по нему.
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
    // ВАЖНО: mountEditor() при повторном монтировании (см. ниже) читает
    // позицию курсора/прокрутки НАПРЯМУЮ из openFile, а не из docState —
    // а повторное монтирование происходит не только на холодном старте, но
    // и при обычном переключении вкладок НАСТРОЕК внутри приложения
    // (switchSettingsTab в my.js вызывает flushPendingMdEditorEdit, а
    // затем при возврате на вкладку "Мой блокнот" — render(), который
    // каждый раз пересоздаёт DOM редактора и вызывает mountEditor() заново,
    // см. renderEditorScreen). Раньше openFile.cursorPos/scrollPercent
    // обновлялись только один раз, в момент открытия заметки, поэтому
    // прокрутка при обычном переключении вкладок внутри приложения
    // терялась, даже если сама заметка никуда не закрывалась. Держим оба
    // места (openFile — для немедленного перемонтирования, docState — для
    // холодного старта/синхронизации между устройствами) в актуальном
    // состоянии одновременно.
    //
    // (Пробовали ещё view.scrollSnapshot() — не подходит: по документации
    // CodeMirror сам метод честно предупреждает "only affects the editor's
    // own scrollable element, not parents", а прокручивается у нас именно
    // родитель, #settingsTabContent, а не cmView.scrollDOM — см.
    // currentScrollPercent ниже. Настоящая причина сброса была не в
    // способе восстановления, а в том, что flushPendingMdEditorEdit не
    // завершал жизненный цикл предыдущего cmView, см. эту функцию и
    // destroyEditor.)
    openFile.cursorPos = pos;
    openFile.scrollPercent = pct;
    persistDocStateNow({
      screen: "editor",
      name: openFile.name,
      cursorPos: pos,
      scrollPercent: pct
    });
  }
  function scheduleDocStateSave(){
    if(docStateSaveTimer) clearTimeout(docStateSaveTimer);
    docStateSaveTimer = setTimeout(flushDocStateNow, 500);
  }

  // ---------------------------------------------------------------------
  // Синхронизация "того же места" МЕЖДУ УСТРОЙСТВАМИ (см. ТЗ пользователя
  // от 01.09, пункт 3) — IndexedDB локальна для устройства/браузера и сама
  // по себе никуда не переезжает. Пишем то же самое состояние ЕЩЁ И
  // маленьким json-файлом в корень выбранной папки — раз пользователь и так
  // синхронизирует эту папку через Syncthing (форк на Android), файл
  // приедет на другое устройство сам, без какой-либо новой инфраструктуры.
  // Имя файла с точки ("." в начале) не попадает под /\.md$/i и
  // IMAGE_EXT_RE (см. scanTree выше), поэтому в списке заметок/картинок не
  // отображается. Запись на диск дебаунсится (реже, чем в IndexedDB — это
  // настоящий файловый I/O) и форсируется в flushAutosaveNow вместе с
  // остальным автосохранением (см. ниже), чтобы гарантированно попасть на
  // диск ДО сворачивания/закрытия вкладки, а не потеряться в замороженном
  // таймере (та же причина, что и у visibilitychange/pagehide выше).
  var diskStateWriteTimer = null;
  function writeDocStateToDiskNow(){
    if(diskStateWriteTimer){ clearTimeout(diskStateWriteTimer); diskStateWriteTimer = null; }
    if(!dirHandle) return;
    var payload = JSON.stringify(docState);
    dirHandle.getFileHandle(STATE_FILE_NAME, { create: true }).then(function(fh){
      return fh.createWritable();
    }).then(function(w){
      return w.write(payload).then(function(){ return w.close(); });
    }).catch(function(){
      // синхронизация позиции — вспомогательная функция, не мешаем
      // основной работе (тексту заметок), если она не удалась
    });
  }
  function scheduleDiskStateWrite(){
    if(diskStateWriteTimer) clearTimeout(diskStateWriteTimer);
    diskStateWriteTimer = setTimeout(writeDocStateToDiskNow, 1000);
  }
  // Читает состояние, записанное ЛЮБЫМ устройством (в т.ч. этим же) в файл
  // на диске — вызывается один раз при холодном старте (см.
  // initFromStoredHandle), результат сверяется по updatedAt с копией из
  // IndexedDB, побеждает более свежая (см. там же).
  // "Продолжить с той же заметки и с того же места" после того, как
  // rootTree только что просканирован — общая логика, вынесенная из
  // initFromStoredHandle (ветка без кэшированного stub-дерева, см. там же),
  // чтобы её же можно было переиспользовать из renderSetupScreen: раньше
  // холодный старт, требующий повторного requestPermission() (пользователь
  // должен САМ нажать на скрепку, см. ТЗ пользователя от 01.09, пункт 4),
  // просто открывал список заметок, вообще не читая docState — восстановление
  // срабатывало только в "тихой" ветке (ensurePermissionSilently === true).
  // Именно поэтому "продолжить с той же заметки" переживало переключение
  // вкладок (docState живёт в памяти модуля, см. выше), но не переживало
  // закрытие всего приложения, если разрешение на папку приходилось
  // подтверждать заново.
  function resumeLastNoteOrShowList(){
    var diskStatePromise = readDocStateFromDisk();
    var localState = null;
    return Promise.resolve().then(function(){
      try{ return idbGet("lastNote"); }catch(e){ return null; }
    }).then(function(v){
      localState = v;
      return diskStatePromise;
    }).catch(function(){
      return diskStatePromise;
    }).then(function(diskState){
      var resolvedState = localState;
      if(diskState && (!localState || (diskState.updatedAt || 0) > (localState.updatedAt || 0))){
        resolvedState = diskState;
      }
      for(var k in resolvedState){ if(resolvedState.hasOwnProperty(k)) docState[k] = resolvedState[k]; }
      var lastNote = docState;
      var resumedEntry = (lastNote.screen === "editor" && lastNote.name) ? nameIndex.get(lastNote.name.toLowerCase()) : null;
      if(resumedEntry){
        openNoteByEntry(resumedEntry, lastNote.cursorPos, undefined, lastNote.scrollPercent);
      } else {
        screen = "list";
        render();
      }
    });
  }

  function readDocStateFromDisk(){
    if(!dirHandle) return Promise.resolve(null);
    return dirHandle.getFileHandle(STATE_FILE_NAME, { create: false }).then(function(fh){
      return fh.getFile();
    }).then(function(f){ return f.text(); }).then(function(text){
      try{
        var parsed = JSON.parse(text);
        return (parsed && typeof parsed === "object") ? parsed : null;
      }catch(e){ return null; }
    }).catch(function(){ return null; });
  }

  function flushAutosaveNow(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
    flushDocStateNow();
    writeDocStateToDiskNow();
    if(!openFile || !cmView || !openFile.dirty) return;
    var text = stripStraySlashBeforeLinks(stripInvisibleSpaces(cmView.state.doc.toString()));
    var fileRef = openFile;
    fileRef.dirty = false;
    writeFileText(fileRef, text).then(function(){
      fileRef.text = text;
      // сохраняется молча (см. ТЗ пользователя от 31.08) — раньше здесь
      // показывалось "Сохранено.", теперь просто гасим статус (пустая
      // строка), ничего не показывая. Не убираем вызов setStatus совсем,
      // а не оставляем прежний текст: если до этого показывалась ошибка
      // предыдущей попытки сохранения, успешное сохранение должно её
      // погасить, а не оставить висеть навсегда.
      if(openFile === fileRef) setStatus("", false);
    }).catch(function(e){
      fileRef.dirty = true;
      if(openFile === fileRef) setStatus("Не удалось сохранить: " + (e && e.message ? e.message : e), true);
    });
  }

  // вызывается из общего блока flush* в switchSettingsTab (my.js) при
  // любом уходе со вкладки настроек.
  // ИСПРАВЛЕНО (01.09, четвёртая попытка): раньше здесь только сохранялось
  // состояние (flushAutosaveNow), а сам cmView оставался висеть "живым",
  // хотя его DOM тут же подменялся содержимым другой вкладки настроек
  // (switchSettingsTab перезаписывает #settingsTabContent.innerHTML сразу
  // после этого вызова). Из-за этого при СЛЕДУЮЩЕМ вызове
  // flushPendingMdEditorEdit (когда пользователь уходит уже СО ВТОРОЙ
  // вкладки, например уходит с "Закладок" обратно на "Мой блокнот") здесь
  // видели тот же самый, но уже "протухший" cmView (проверка "if(!openFile
  // || !cmView) return" в flushDocStateNow его не отсекала) и на этом
  // основании ещё раз считали currentScrollPercent() — а физически
  // #settingsTabContent в этот момент содержит DOM СОВСЕМ ДРУГОЙ вкладки
  // (той, с которой уходим), а не редактор. В итоге только что правильно
  // сохранённая позиция заметки перезатиралась мусорным значением (обычно
  // 0, т.к. чужая вкладка обычно ещё не прокручена) ещё ДО того, как
  // mountEditor() успевал её восстановить при возврате — то есть
  // восстановление ломалось на ровном месте при каждом переключении.
  // Заодно "протухший" cmView, ни разу не уничтоженный, мог продолжать
  // слать измерения от старого (уже отсоединённого от DOM) редактора,
  // что и объясняет замеченные отступы сверху/снизу при новом монтировании.
  // Решение: полноценно завершать жизненный цикл редактора здесь же, сразу
  // после сохранения — destroyEditor() обнуляет cmView, так что повторный
  // вызов этой функции (с другой, чужой вкладки) становится безопасным
  // no-op'ом благодаря той же самой проверке "if(!cmView) return".
  function flushPendingMdEditorEdit(){
    flushAutosaveNow();
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
    // rescan/buildIndex выше) и кэшируется в imageUrlCache по имени, чтобы
    // не перечитывать файл на каждую перестройку decorations (она
    // происходит при любом изменении документа, даже не в этой строке).
    // applyImageFloatLayout/relayoutImageFloats вынесены на уровень
    // модуля — см. выше перед makeLivePreviewExtension. ----
    function ImageWidget(name){ this.name = name; }
    ImageWidget.prototype = Object.create(WidgetType.prototype);
    ImageWidget.prototype.eq = function(other){ return other.name === this.name; };
    ImageWidget.prototype.toDOM = function(){
      var wrap = document.createElement("span");
      wrap.className = "cm-md-image-wrap";
      var img = document.createElement("img");
      img.className = "cm-md-image";
      img.alt = this.name;
      // Реальный размер (а значит и решение float/block) известен только
      // после загрузки — до этого картинка либо ещё не выбрана из кэша
      // (imageUrlCache), либо .cm-md-image-loading-заглушка вообще без
      // <img>. requestAnimationFrame — чтобы clientWidth строки успел
      // посчитаться после того, как виджет реально встал в DOM.
      img.addEventListener("load", function(){
        requestAnimationFrame(function(){ applyImageFloatLayout(wrap); });
      });
      wrap.appendChild(img);
      loadImageInto(this.name, img, wrap);
      return wrap;
    };
    ImageWidget.prototype.ignoreEvent = function(){ return true; };
    var imageWidgetCache = new Map(); // имя -> ImageWidget (переиспользуем, чтобы eq() совпадал между перестройками)
    function getImageWidget(name){
      var w = imageWidgetCache.get(name);
      if(!w){ w = new ImageWidget(name); imageWidgetCache.set(name, w); }
      return w;
    }
    function loadImageInto(name, imgEl, wrapEl){
      var key = name.toLowerCase();
      var cached = imageUrlCache.get(key);
      if(cached){
        if(cached.url) imgEl.src = cached.url;
        else { wrapEl.classList.add("cm-md-image-missing"); wrapEl.textContent = "🖼 " + name + " — файл не найден"; }
        return;
      }
      var entry = imageIndex && imageIndex.get(key);
      if(!entry){
        imageUrlCache.set(key, { error: true });
        wrapEl.classList.add("cm-md-image-missing");
        wrapEl.textContent = "🖼 " + name + " — файл не найден";
        return;
      }
      wrapEl.classList.add("cm-md-image-loading");
      entry.fileHandle.getFile().then(function(f){
        var url = URL.createObjectURL(f);
        imageUrlCache.set(key, { url: url });
        wrapEl.classList.remove("cm-md-image-loading");
        imgEl.src = url;
      }).catch(function(){
        imageUrlCache.set(key, { error: true });
        wrapEl.classList.remove("cm-md-image-loading");
        wrapEl.classList.add("cm-md-image-missing");
        wrapEl.textContent = "🖼 " + name + " — не удалось загрузить";
      });
    }

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
          var isParaStart = line.text.trim() !== "";
          if(isParaStart && line.from !== 0){
            var prevText = doc.lineAt(line.from - 1).text;
            isParaStart = prevText.trim() === "" ||
              /^(#{1,3})(\s+)/.test(prevText) ||
              /^\s*!\[\[[^\[\]\n]+\]\]\s*$/.test(prevText);
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
              // Реальное нажатие клавиши — в отличие от открытия заметки
              // кликом (см. openNoteByEntry), при автоматическом
              // восстановлении последней заметки на холодном старте (см.
              // initFromStoredHandle) открытие происходит БЕЗ клика, так
              // что там reverifyWritePermissionOnce() мог не сработать
              // (нет user activation). Здесь же, на docChanged, activation
              // гарантированно есть — это подстраховка именно для такого
              // автовосстановленного случая.
              reverifyWritePermissionOnce();
              scheduleAutosave();
              scheduleLinksFieldRefresh();
            }
            if(u.docChanged || u.selectionSet) scheduleDocStateSave();
          }),
          EditorView.domEventHandlers({ mousedown: handleMouseDown })
        ];
        var initialPos = Math.max(0, Math.min(openFile.cursorPos || 0, openFile.text.length));
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

  // ---------------------------------------------------------------------
  // Сброс несохранённых правок ПЕРЕД уходом вкладки в фон — раньше
  // автосохранение срабатывало только по debounce-таймеру (700мс) и при
  // явной навигации внутри самого редактора (goHome, смена заметки),
  // поэтому правка, сделанная прямо перед сворачиванием/переключением
  // приложений на планшете, могла попасть ровно в то окно, где Android
  // замораживает вкладку, не дав debounce-таймеру сработать. visibilitychange
  // в "hidden" срабатывает синхронно и раньше, чем ОС успевает заморозить
  // страницу, pagehide — подстраховка на случай, если вкладку не просто
  // сворачивают, а закрывают/выгружают. Оба события дёшевы при "нечего
  // сохранять" (flushAutosaveNow сам проверяет openFile.dirty).
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "hidden") flushAutosaveNow();
  });
  window.addEventListener("pagehide", function(){ flushAutosaveNow(); });

  // При возврате вкладки из фона (см. комментарий у isTransientNotFoundError
  // выше) SAF-провайдер на планшетах иногда ещё не "прогрелся" — обычный
  // queryPermission() тут не помогает, он спрашивает про разрешение, а не
  // про готовность провайдера резолвить документ. Пробуем один раз тихо
  // прогреть провайдер безобидным чтением каталога files сразу после
  // возврата, чтобы, если он ещё не готов, наткнуться на NotFoundError
  // именно здесь (без всякого влияния на пользователя), а не в момент
  // следующего автосохранения. Ошибку намеренно проглатываем — это только
  // попытка прогрева, не диагностика.
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "visible" && dirHandle){
      ensureFilesFolder().catch(function(){});
    }
  });

  // Просим постоянное (persistent) хранилище для origin — это не влияет
  // напрямую на разрешение SAF на папку с заметками, но снижает риск,
  // что браузер под давлением на память сам решит вытеснить данные origin'а
  // (IndexedDB и с ним — сохранённый dirHandle), что было бы уже настоящей
  // потерей доступа, а не временной. Дешёвая подстраховка, без гарантии.
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(function(){});
  }

  return {
    renderSettingsTabMdEditor: renderSettingsTabMdEditor,
    renderSettingsTabMdBookmarks: renderSettingsTabMdBookmarks,
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
    FONT_SIZE_MAX_STEP: FONT_SIZE_MAX_STEP
  };
};
