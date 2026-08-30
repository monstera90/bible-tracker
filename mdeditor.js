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
  function openDb(){
    return new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function(){ req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
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
  var screen = "setup";          // "setup" | "list" | "editor"
  var setupNeedsPermission = false;
  var statusMessage = "", statusIsError = false;
  var openFile = null;           // {fileHandle,dirHandle,name,text,dirty}
  var cmView = null;
  var livePreviewCompartment = null;
  var codeMode = false;
  var saveTimer = null;
  var renaming = false;
  // если "открыть заметку по имени снаружи" (см. openNoteExternally ниже)
  // пришло РАНЬШЕ, чем закончилась инициализация (папка ещё не выбрана/не
  // просканирована, initFromStoredHandle ещё выполняется) — запоминаем имя
  // здесь и открываем сразу по готовности (см. конец initFromStoredHandle)
  var pendingExternalOpen = null;
  // взводится openNoteExternally перед открытием заметки по [[ссылке]],
  // пришедшей СНАРУЖИ модуля (из другой вкладки) — само открытие заметки
  // в этом случае не отдельный шаг "назад" внутри блокнота, а продолжение
  // ОДНОГО клика по ссылке: переход уже зарегистрирован снаружи вызовом
  // switchSettingsTab (см. initAutoFormatting/switchSettingsTab в my.js),
  // и "назад" должен вести прямо туда, откуда кликнули по ссылке, а не в
  // список заметок блокнота. См. pushMdNav ниже.
  var suppressNextNavPush = false;

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
  function scanTree(dh){
    return (async function(){
      var node = { dirHandle: dh, name: "", folders: [], files: [], images: [] };
      for await (var pair of dh.entries()){
        var name = pair[0], handle = pair[1];
        if(handle.kind === "file"){
          if(/\.md$/i.test(name)) node.files.push({ name: name.replace(/\.md$/i, ""), handle: handle });
          else if(IMAGE_EXT_RE.test(name)) node.images.push({ name: name, handle: handle });
        } else if(handle.kind === "directory"){
          var child = await scanTree(handle);
          child.name = name;
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
        }
      }
      return node;
    })();
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

  async function rescan(){
    var tree = await scanTree(dirHandle);
    tree.name = "";
    rootTree = tree;
    currentDirNode = tree;
    var idx = new Map();
    var imgIdx = new Map();
    buildIndex(tree, idx, imgIdx);
    nameIndex = idx;
    imageIndex = imgIdx;
  }

  async function ensurePermissionSilently(handle){
    try{
      return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
    }catch(e){ return false; }
  }

  // ---------------------------------------------------------------------
  // Точка входа — вызывается из switchSettingsTab при каждом открытии
  // вкладки. Состояние (dirHandle/дерево/открытая заметка) переживает
  // переключения между вкладками настроек в рамках одной сессии.
  // ---------------------------------------------------------------------
  function renderSettingsTabMdEditor(){
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
    try{
      var stored = await idbGet("root");
      if(stored){
        dirHandle = stored;
        var ok = await ensurePermissionSilently(stored);
        if(ok){
          await rescan();
          // заметка, которую попросили открыть ИЗВНЕ ещё до того, как
          // папка успела просканироваться (см. openNoteExternally ниже) —
          // открываем её сразу вместо списка
          if(pendingExternalOpen){
            var name = pendingExternalOpen;
            pendingExternalOpen = null;
            handleLinkClick(name);
            return;
          }
          screen = "list";
          render();
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
    if(screen === "editor" && openFile) renderEditorScreen(container);
    else if(screen === "list" && currentDirNode) renderListScreen(container);
    else renderSetupScreen(container);
  }

  // ---------------------------------------------------------------------
  // Экран выбора/переподтверждения папки — виден при первом запуске
  // вкладки (пока путь не указан) и если браузер отозвал разрешение.
  // ---------------------------------------------------------------------
  function renderSetupScreen(container){
    var hint = setupNeedsPermission
      ? "Доступ к папке с заметками нужно подтвердить заново."
      : "Укажите папку с заметками (.md), чтобы начать.";
    container.innerHTML =
      '<div class="mdeditor-tab">' +
        '<h3 class="workbooks-title">Мой блокнот</h3>' +
        '<p class="mdeditor-hint">' + hint + '</p>' +
        '<div class="mdeditor-setup-row">' +
          '<button type="button" class="task-import-attach-btn" id="mdEditorAttachBtn" title="' +
            (setupNeedsPermission ? "Подтвердить доступ" : "Выбрать папку") + '">' + PAPERCLIP_ICON_SVG + '</button>' +
        '</div>' +
        (statusMessage ? '<p class="mdeditor-hint' + (statusIsError ? ' error' : '') + '" style="margin-top:10px;' + (statusIsError ? 'color:var(--status-err,#c0392b);' : '') + '">' + escName(statusMessage) + '</p>' : '') +
      '</div>';

    document.getElementById("mdEditorAttachBtn").addEventListener("click", async function(){
      statusMessage = "";
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
          var handle = await window.showDirectoryPicker({ mode: "readwrite" });
          dirHandle = handle;
          try{ await idbSet("root", handle); }catch(e){}
          // новая папка — старые URL картинок из прошлой библиотеки больше
          // не нужны и указывают на чужие файлы, освобождаем память
          imageUrlCache.forEach(function(v){ if(v && v.url) URL.revokeObjectURL(v.url); });
          imageUrlCache.clear();
        }
        setupNeedsPermission = false;
        statusMessage = "Сканируем папку…"; statusIsError = false; render();
        await rescan();
        statusMessage = "";
        screen = "list";
        render();
      }catch(e){
        if(e && e.name === "AbortError") return;
        statusMessage = "Не удалось получить доступ к папке."; statusIsError = true; render();
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
      items.forEach(function(it){
        var row = document.createElement("button");
        row.type = "button";
        row.className = "mdeditor-row";
        row.innerHTML = (it.type === "folder" ? FOLDER_ICON_SVG : it.type === "image" ? IMAGE_ICON_SVG : FILE_ICON_SVG) +
          '<span class="mdeditor-row-name"></span>';
        row.querySelector(".mdeditor-row-name").textContent = it.name;
        row.addEventListener("click", function(){
          if(it.type === "folder"){
            var prevDirNode = currentDirNode;
            pushMdNav(function(){ currentDirNode = prevDirNode; render(); });
            currentDirNode = it.node;
            render();
          }
          else if(it.type === "image"){ openImagePreview(it.handle, it.name); }
          else { openNoteByEntry({ fileHandle: it.handle, dirHandle: node.dirHandle, name: it.name }); }
        });
        listEl.appendChild(row);
      });
    }
  }

  // ---------------------------------------------------------------------
  // Экран заметки: шапка (домик / заголовок-переименование / переключатель
  // режима) + хост CodeMirror 6, занимающий всё оставшееся место вкладки.
  // ---------------------------------------------------------------------
  function renderEditorScreen(container){
    container.innerHTML =
      '<div class="mdeditor-tab mdeditor-editor-tab">' +
        '<div class="mdeditor-title-row" id="mdEditorTitleRow">' +
          '<span class="mdeditor-title" id="mdEditorTitle" title="Нажмите, чтобы переименовать"></span>' +
        '</div>' +
        '<div class="mdeditor-status" id="mdEditorStatus"></div>' +
        '<div class="mdeditor-editor-host" id="mdEditorHost"></div>' +
        '<div class="mdeditor-fab-row">' +
          '<button type="button" class="mdeditor-fab-btn" id="mdEditorModeBtn" title="Переключить режим кода">' + (codeMode ? EYE_ICON_SVG : CODE_ICON_SVG) + '</button>' +
          '<button type="button" class="mdeditor-fab-btn" id="mdEditorHomeBtn2" title="К списку заметок">' + HOME_ICON_SVG + '</button>' +
        '</div>' +
      '</div>';
    document.getElementById("mdEditorTitle").textContent = openFile.name;

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
    });
    document.getElementById("mdEditorTitle").addEventListener("click", startRename);

    mountEditor();
  }

  function goHome(){
    flushAutosaveNow();
    destroyEditor();
    openFile = null;
    currentDirNode = rootTree;
    screen = "list";
    render();
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
  function openNoteByEntry(entry){
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
      openFile = { fileHandle: entry.fileHandle, dirHandle: entry.dirHandle, name: entry.name, text: text, dirty: false };
      screen = "editor";
      render();
    }).catch(function(){
      setStatus("Не удалось открыть заметку.", true);
    });
  }

  // Клик по [[ссылке]] на несуществующую заметку — сразу создаём пустой
  // файл в корне и открываем его (решение согласовано с пользователем).
  async function createAndOpenNote(name){
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
    setStatus("Сохранение…", false);
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){ flushAutosaveNow(); }, 700);
  }

  function flushAutosaveNow(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
    if(!openFile || !cmView || !openFile.dirty) return;
    var text = cmView.state.doc.toString();
    var fileRef = openFile;
    fileRef.dirty = false;
    openFile.fileHandle.createWritable().then(function(w){
      return w.write(text).then(function(){ return w.close(); });
    }).then(function(){
      fileRef.text = text;
      if(openFile === fileRef) setStatus("Сохранено.", false);
    }).catch(function(e){
      fileRef.dirty = true;
      if(openFile === fileRef) setStatus("Не удалось сохранить: " + (e && e.message ? e.message : e), true);
    });
  }

  // вызывается из общего блока flush* в switchSettingsTab (my.js) при
  // любом уходе со вкладки настроек
  function flushPendingMdEditorEdit(){
    flushAutosaveNow();
  }

  function destroyEditor(){
    if(cmView){ cmView.destroy(); cmView = null; }
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
  function makeLivePreviewExtension(cm){
    var Decoration = cm.view.Decoration, ViewPlugin = cm.view.ViewPlugin, WidgetType = cm.view.WidgetType;
    var RangeSetBuilder = cm.state.RangeSetBuilder;

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
    // происходит при любом изменении документа, даже не в этой строке). ----
    function ImageWidget(name){ this.name = name; }
    ImageWidget.prototype = Object.create(WidgetType.prototype);
    ImageWidget.prototype.eq = function(other){ return other.name === this.name; };
    ImageWidget.prototype.toDOM = function(){
      var wrap = document.createElement("span");
      wrap.className = "cm-md-image-wrap";
      var img = document.createElement("img");
      img.className = "cm-md-image";
      img.alt = this.name;
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

    var headingLineDeco = [
      Decoration.line({ attributes: { class: "cm-md-h1" } }),
      Decoration.line({ attributes: { class: "cm-md-h2" } }),
      Decoration.line({ attributes: { class: "cm-md-h3" } })
    ];
    var boldMark = Decoration.mark({ class: "cm-md-bold" });
    var italicMark = Decoration.mark({ class: "cm-md-italic" });
    var highlightMark = Decoration.mark({ class: "cm-md-mark" });
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

    function decorateLine(builder, lineText, lineFrom, isParaStart){
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
      var mQuote = null, mList = null, mNum = null;
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

      scanPair(/\*\*([^*\n]+?)\*\*/g, 2, boldMark);
      scanPair(/==([^=\n]+?)==/g, 2, highlightMark);
      scanPair(/\[\[([^\[\]\n]+)\]\]/g, 2, linkMark);
      scanPair(/\*([^*\n]+?)\*/g, 1, italicMark);
      scanPair(/_([^_\n]+?)_/g, 1, italicMark);

      claims.sort(function(a, b){ return a.start - b.start; });
      if(mHead) builder.add(lineFrom, lineFrom, headingLineDeco[mHead[1].length - 1]);
      else if(mQuote) builder.add(lineFrom, lineFrom, quoteLineDeco);
      else if(mList) builder.add(lineFrom, lineFrom, listLineDeco);
      else if(mNum) builder.add(lineFrom, lineFrom, listLineDeco);
      else if(mImgOnly) builder.add(lineFrom, lineFrom, imageLineDeco);
      else if(isParaStart) builder.add(lineFrom, lineFrom, paraStartLineDeco);
      claims.forEach(function(c){ c.emit(); });
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
          decorateLine(builder, line.text, line.from, isParaStart);
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
          EditorView.updateListener.of(function(u){ if(u.docChanged) scheduleAutosave(); }),
          EditorView.domEventHandlers({ mousedown: handleMouseDown })
        ];
        var state = EditorState.create({ doc: openFile.text, extensions: extensions });
        cmView = new EditorView({ state: state, parent: host });
      }catch(e){
        setStatus("Не удалось запустить редактор: " + (e && e.message ? e.message : e), true);
      }
    }).catch(function(e){
      setStatus("Не удалось загрузить редактор (нужен интернет при первом запуске): " + (e && e.message ? e.message : e), true);
    });
  }

  return {
    renderSettingsTabMdEditor: renderSettingsTabMdEditor,
    flushPendingMdEditorEdit: flushPendingMdEditorEdit,
    openNoteExternally: openNoteExternally
  };
};
