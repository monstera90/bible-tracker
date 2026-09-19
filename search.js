/* ===========================================================================
   search.js
   Версия: 2.5 (19.09) — в строке результата по задачам добавлена пиктограмма-часы
   «напоминание» (крайняя справа, правее кружка приоритета; ТЗ пользователя от
   19.09). Разметку даёт деп getReminderBtnHtml (taskReminderBtnHtml из my.js),
   логику — bindTaskRowActions. Чемодана и «копировать» в этой строке, как и
   раньше, нет.
   Версия: 2.4 (19.09) — в строке результата по задачам добавлен крестик «удалить задачу»
   (слева от карандаша; логику и подтверждение даёт bindTaskRowActions из my.js, деп getCrossIcon).
   Версия: 2.3 (19.09) — кнопка режима чтения на вкладке "Поиск" (ТЗ пользователя
   от 19.09): крайняя слева в нижнем ряду, левее "Поиск по задачам"/"Поиск по
   заметкам" (их позиции не сдвинулись). Тот же переключатель и та же иконка
   (.reading-mode-btn), что в редакторе заметок/ридере книг — приходят деп-ами
   toggleReadingMode/applyReadingModeVisual из my.js.
   Версия: 2.2 (15.09)
   Вкладка "Поиск" (третья боковая вкладка второго набора,
   settingsTabSet2Btn3 / "set2s_3") — ТЗ пользователя от 08.09. Раньше была
   заглушкой (renderSettingsTabSet2Stub в my.js) — ЭТО БОЛЬШЕ НЕ ЗАГЛУШКА.
   Вынесена в отдельный файл по тому же образцу, что и Workbooks/JwlMerge/
   EpubSplit/ImgResize/MdEditor (см. my.js).

   Два независимых режима поиска, переключаются кнопками внизу экрана
   (см. renderSettingsTabSearch ниже): "Поиск по задачам" и "Поиск по
   заметкам". Каждый режим ищет только в своей области и выдаёт свой формат
   результатов — они никогда не смешиваются в одном списке.

   Правило совпадения слова (общее для обоих режимов): слово документа
   подходит под искомое слово запроса, если оно НАЧИНАЕТСЯ с него (без
   учёта регистра) — например, "заметк" находит и "заметка", и "заметки",
   а "заметка" находит только "заметка" (не находит "заметки", т.к. это не
   префикс). Несколько слов через пробел — соединяются через И (должны
   встретиться оба, в любом месте документа, не обязательно рядом).

   Для заметок, где найдено 2+ вхождений (два и более разных слова запроса,
   или одно слово, но в разных местах текста) — показываются ДВА примера-
   фрагмента вместо одного: первый — самое раннее вхождение по тексту,
   второй — вхождение, максимально удалённое от первого (по расстоянию в
   символах). Это самый простой способ гарантированно взять примеры из
   разных, а не соседних мест документа — при двух разных словах запроса
   это к тому же почти всегда естественно разводит примеры по разным
   словам, без специального кода под этот случай.
   =========================================================================== */

window.initSearchModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml;
  var switchSettingsTab = deps.switchSettingsTab;
  // "Поиск по заметкам" — из mdeditor.js (openNoteByIdExternally/
  // getSearchableNotes, см. деп-контракт ниже); заметки могут быть ещё не
  // готовы (нет синхронизации) — тогда getSearchableNotes() просто вернёт
  // [].
  var openNoteByIdExternally = deps.openNoteByIdExternally;
  var getSearchableNotes = deps.getSearchableNotes;
  // "Поиск по задачам" — из my.js. getSearchableTasks уже исключает архив
  // (выполненные задачи) — так попросили, архив в поиске не участвует.
  var getSearchableTasks = deps.getSearchableTasks;
  var renderTaskRowEdit = deps.renderTaskRowEdit;
  var bindTaskRowActions = deps.bindTaskRowActions;
  var fitTaskActions = deps.fitTaskActions;
  // иконки-пиктограммы приходят геттерами (не голыми строками) — PENCIL_
  // ICON_SVG в my.js объявлен ПОСЛЕ создания модулей типа MdEditor/Search
  // (var, а не function — не поднимается), геттер читает её уже готовой
  // на момент реального рендера строки, а не в момент создания модуля.
  var getPencilIcon = deps.getPencilIcon || function(){ return ""; };
  var getCheckIcon = deps.getCheckIcon || function(){ return ""; };
  var getMoveIcon = deps.getMoveIcon || function(){ return ""; };
  var getNextIcon = deps.getNextIcon || function(){ return ""; };
  var getCrossIcon = deps.getCrossIcon || function(){ return ""; };
  var getReminderBtnHtml = deps.getReminderBtnHtml || function(){ return ""; };
  // Кнопка режима чтения (ТЗ пользователя от 19.09) — та же единая точка
  // переключения, что у заметок/книг/задач в my.js. Иконку и title кнопке
  // ставит applyReadingModeVisual (кнопка рендерится пустой, узнаётся по
  // классу .reading-mode-btn).
  var toggleReadingMode = deps.toggleReadingMode || function(){};
  var applyReadingModeVisual = deps.applyReadingModeVisual || function(){};

  // ---------------------------------------------------------------------
  // Алгоритм совпадения — см. пояснение в шапке файла. WORD_TOKEN_RE —
  // тот же список "буквенно-цифровых" символов (латиница/кириллица/цифры),
  // что и в поиске "==выделения=="/ссылок в mdeditor.js, но здесь свой
  // независимый экземпляр — простоты ради, дублировать общий модуль между
  // двумя файлами ради десяти строк регэкспа не стали (тот же принцип, что
  // у epubsplit.js/jwlmerge.js со своими копиями ZIP-ридера, см. карту
  // проекта).
  // ---------------------------------------------------------------------
  var WORD_TOKEN_RE = /[a-zA-Zа-яёА-ЯЁ0-9]+/g;

  function tokenize(text){
    var out = [];
    if(!text) return out;
    WORD_TOKEN_RE.lastIndex = 0;
    var m;
    while((m = WORD_TOKEN_RE.exec(text))){
      out.push({ text: m[0], from: m.index, to: m.index + m[0].length });
    }
    return out;
  }

  function splitQueryWords(raw){
    return (raw || "").toLowerCase().split(/\s+/).map(function(w){ return w.trim(); }).filter(Boolean);
  }

  // occurrences: одна запись на каждое слово документа, подошедшее под
  // ЛЮБОЕ из слов запроса (qIndex — под какое именно, для покрытия ниже)
  function findOccurrences(tokens, queryWords){
    var occ = [];
    tokens.forEach(function(tok){
      var lower = tok.text.toLowerCase();
      for(var i = 0; i < queryWords.length; i++){
        if(lower.indexOf(queryWords[i]) === 0){
          occ.push({ from: tok.from, to: tok.to, text: tok.text, qIndex: i });
          break;
        }
      }
    });
    return occ;
  }

  // документ подходит, только если КАЖДОЕ слово запроса встретилось хотя
  // бы один раз (И, а не ИЛИ) — см. ТЗ ("чтобы оба были в документе")
  function coversAllQueryWords(occurrences, queryWordCount){
    var seen = {};
    occurrences.forEach(function(o){ seen[o.qIndex] = true; });
    for(var i = 0; i < queryWordCount; i++){
      if(!seen[i]) return false;
    }
    return true;
  }

  // см. пояснение алгоритма в шапке файла
  function pickExampleOccurrences(occurrences){
    if(!occurrences.length) return [];
    var sorted = occurrences.slice().sort(function(a, b){ return a.from - b.from; });
    if(sorted.length === 1) return [sorted[0]];
    var first = sorted[0];
    var best = sorted[1];
    var bestDist = Math.abs(sorted[1].from - first.from);
    for(var i = 2; i < sorted.length; i++){
      var d = Math.abs(sorted[i].from - first.from);
      if(d > bestDist){ bestDist = d; best = sorted[i]; }
    }
    return first.from <= best.from ? [first, best] : [best, first];
  }

  // фрагмент — 4-5 слов до/после найденного слова (по индексу токена в
  // общем массиве tokens, не по символам — иначе "слова" считались бы
  // неровно на границах пунктуации)
  function buildFragmentHtml(text, tokens, occ){
    var idx = -1;
    for(var i = 0; i < tokens.length; i++){
      if(tokens[i].from === occ.from && tokens[i].to === occ.to){ idx = i; break; }
    }
    if(idx === -1) return escapeHtml(occ.text);
    var startTok = tokens[Math.max(0, idx - 4)];
    var endTok = tokens[Math.min(tokens.length - 1, idx + 4)];
    var from = startTok.from, to = endTok.to;
    var clean = function(s){ return s.replace(/\s+/g, " "); };
    var before = clean(text.slice(from, occ.from));
    var word = text.slice(occ.from, occ.to);
    var after = clean(text.slice(occ.to, to));
    return (from > 0 ? "…" : "") + escapeHtml(before) +
      '<mark class="search-highlight-mark">' + escapeHtml(word) + '</mark>' +
      escapeHtml(after) + (to < text.length ? "…" : "");
  }

  function scrollSearchToBottom(){
    var scroller = document.getElementById("settingsTabContent");
    if(scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  var activeMode = null; // "notes" | "tasks"
  // Последний реально выполненный запрос — чтобы при возврате на вкладку
  // (например, кнопкой "назад" после перехода в открытую по клику
  // заметку) выдача была на месте, а не начиналась заново с пустого
  // поля/подсказки. Живёт на уровне модуля (не внутри
  // renderSettingsTabSearch), поэтому переживает пересоздание разметки
  // вкладки при каждом заходе (ТЗ пользователя от 08.09, второй заход).
  var lastQuery = "";

  function renderSettingsTabSearch(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML =
      '<div class="mdeditor-tab">' +
        '<h3 class="common-tab-title search-tab-title">Поиск</h3>' +
        '<div class="search-input-row">' +
          '<input type="text" class="search-input" id="searchQueryInput" placeholder="Слово или несколько слов…" enterkeyhint="search">' +
        '</div>' +
        '<div class="search-title-matches" id="searchTitleMatchesWrap"></div>' +
      '</div>' +
      '<div class="mdeditor-tab settings-content-bottom">' +
        '<div class="search-results" id="searchResultsWrap">' +
          '<div class="search-empty">Выберите, что искать — задачи или заметки, — и введите слово.</div>' +
        '</div>' +
      '</div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn reading-mode-btn" id="searchReadingBtn" title="Режим чтения"></button>' +
        '<button type="button" class="mdeditor-fab-btn" id="searchTasksBtn" title="Поиск по задачам">' + SEARCH_TASKS_ICON_SVG + '</button>' +
        '<button type="button" class="mdeditor-fab-btn" id="searchNotesBtn" title="Поиск по заметкам">' + SEARCH_NOTES_ICON_SVG + '</button>' +
      '</div>';

    var input = document.getElementById("searchQueryInput");
    var tasksBtn = document.getElementById("searchTasksBtn");
    var notesBtn = document.getElementById("searchNotesBtn");
    var readingBtn = document.getElementById("searchReadingBtn");
    if(readingBtn){
      // mousedown с preventDefault — чтобы нажатие не отнимало фокус у поля
      // поиска (клавиатура не прыгает), как у той же кнопки в заметках/книгах.
      readingBtn.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
      readingBtn.addEventListener("click", function(){ toggleReadingMode(); });
    }
    applyReadingModeVisual();

    function runActiveSearch(){
      lastQuery = input.value;
      if(activeMode === "notes") runNotesSearch(input.value);
      else if(activeMode === "tasks") runTasksSearch(input.value);
    }
    // Живой блок "совпадение по заголовку" сразу под строкой поиска — не
    // ждёт Enter, обновляется на каждое нажатие клавиши. Показывается
    // только в режиме "по заметкам" (в режиме "по задачам" заголовков
    // заметок искать незачем — блок просто очищается).
    function syncTitleMatches(query){
      if(activeMode === "notes"){ runTitleSearch(query); return; }
      var wrap = document.getElementById("searchTitleMatchesWrap");
      if(wrap) wrap.innerHTML = "";
    }
    function pressMode(mode){
      activeMode = mode;
      if(tasksBtn) tasksBtn.classList.toggle("pressed", mode === "tasks");
      if(notesBtn) notesBtn.classList.toggle("pressed", mode === "notes");
      runActiveSearch();
      syncTitleMatches(input ? input.value : "");
      // "в поле ввода сразу ставится курсор и появляется клавиатура" — по
      // ТЗ, при нажатии ЛЮБОЙ из двух кнопок, независимо от того, есть ли
      // уже что искать.
      if(input){ input.focus(); }
    }
    if(tasksBtn) tasksBtn.addEventListener("click", function(){ pressMode("tasks"); });
    if(notesBtn) notesBtn.addEventListener("click", function(){ pressMode("notes"); });
    if(input){
      input.addEventListener("keydown", function(e){
        if(e.key === "Enter"){
          e.preventDefault();
          input.blur(); // прячем клавиатуру, как обычно ожидается по Enter
          runActiveSearch();
        }
      });
      // Живой поиск по заголовкам — на каждое изменение текста, без
      // ожидания Enter (в отличие от основной выдачи внизу).
      input.addEventListener("input", function(){
        syncTitleMatches(input.value);
      });
      // Нажатие/фокус на само поле ввода — если пользователь ещё не выбрал
      // режим кнопкой внизу (activeMode === null), по умолчанию включаем
      // "Поиск по заметкам" и сразу выполняем поиск (как при нажатии
      // кнопки notesBtn, только без принудительного повторного фокуса —
      // поле и так в фокусе). Если режим уже выбран — ничего не трогаем,
      // повторный запуск поиска тут не нужен.
      input.addEventListener("focus", function(){
        if(!activeMode){
          activeMode = "notes";
          if(notesBtn) notesBtn.classList.add("pressed");
          if(tasksBtn) tasksBtn.classList.remove("pressed");
          runActiveSearch();
          syncTitleMatches(input.value);
        }
      });
    }

    // Восстановление последнего запроса при возврате на вкладку — без
    // фокуса/клавиатуры (в отличие от pressMode выше): это не новое
    // нажатие кнопки пользователем, а просто повторный показ уже
    // выполненного поиска.
    if(activeMode && input){
      input.value = lastQuery;
      if(tasksBtn) tasksBtn.classList.toggle("pressed", activeMode === "tasks");
      if(notesBtn) notesBtn.classList.toggle("pressed", activeMode === "notes");
      if(activeMode === "notes") runNotesSearch(lastQuery);
      else if(activeMode === "tasks") runTasksSearch(lastQuery);
      syncTitleMatches(lastQuery);
    }
  }

  // ---------------------------------------------------------------------
  // Пиктограммы — свои, придуманы под эту вкладку. "По задачам" — галочка
  // (выполненное дело) + лупа. "По заметкам" — листок с загнутым уголком,
  // из-под которого выступает ярлычок-бирка с надписью "md" (формат
  // заметок), + лупа. Лупа на обеих кнопках одинаковая (тот же кружок и
  // ручка, та же позиция), меняется только основной объект иконки. Тот
  // же стиль обводки, что и у остальных иконок проекта (stroke=
  // currentColor, viewBox 24x24); буквы "md" — единственная заливка
  // (fill=currentColor вместо обводки), иначе на 24px нечитаемо.
  // ---------------------------------------------------------------------
  var SEARCH_TASKS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 9.3l4.2 4.4L15.5 3.8" stroke-width="2.3"></path>' +
    '<circle cx="17.6" cy="18.6" r="3.1" stroke-width="1.7"></circle>' +
    '<line x1="19.9" y1="20.9" x2="22.3" y2="23.3" stroke-width="1.7"></line>' +
    '</svg>';
  var SEARCH_NOTES_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M7 2.5h7l3 3V14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"></path>' +
    '<path d="M14 2.5v3h3"></path>' +
    '<rect x="1.5" y="12.4" width="9" height="6.4" rx="1.4"></rect>' +
    '<text x="6" y="17.2" font-family="Georgia, serif" font-size="5.3" font-weight="bold" text-anchor="middle" stroke="none" fill="currentColor">md</text>' +
    '<circle cx="17.6" cy="18.6" r="3.1"></circle>' +
    '<line x1="19.9" y1="20.9" x2="22.3" y2="23.3"></line>' +
    '</svg>';

  // ===================== ЖИВОЙ ПОИСК ПО ЗАГОЛОВКАМ =====================
  // Отдельный блок сразу под строкой поиска (searchTitleMatchesWrap) —
  // не путать с основной выдачей по тексту заметок внизу (runNotesSearch).
  // Здесь совпадение ТОЧНОЕ (слово запроса должно целиком совпасть со
  // словом заголовка, без учёта регистра, а не просто быть его началом,
  // как в основном поиске), и ищется по всем словам заголовка, а не
  // только по первому — если из нескольких слов запроса совпадает не
  // первое слово заголовка, а, например, второе, заметка всё равно
  // находится. Все слова запроса (если их несколько) обязаны найтись
  // в заголовке (И, как и в основном поиске) — каждое отдельным словом.
  function titleMatchesQuery(name, queryWords){
    var lowerTokens = tokenize(name).map(function(t){ return t.text.toLowerCase(); });
    for(var i = 0; i < queryWords.length; i++){
      if(lowerTokens.indexOf(queryWords[i]) === -1) return false;
    }
    return true;
  }

  function highlightTitleMatches(name, queryWords){
    var tokens = tokenize(name);
    var html = "";
    var last = 0;
    tokens.forEach(function(tok){
      var isMatch = queryWords.indexOf(tok.text.toLowerCase()) !== -1;
      if(isMatch){
        html += escapeHtml(name.slice(last, tok.from));
        html += '<mark class="search-highlight-mark">' + escapeHtml(name.slice(tok.from, tok.to)) + '</mark>';
        last = tok.to;
      }
    });
    html += escapeHtml(name.slice(last));
    return html;
  }

  function runTitleSearch(rawQuery){
    var wrap = document.getElementById("searchTitleMatchesWrap");
    if(!wrap) return;
    var queryWords = splitQueryWords(rawQuery);
    if(!queryWords.length){
      wrap.innerHTML = "";
      return;
    }
    var notes = getSearchableNotes ? getSearchableNotes() : [];
    var matches = notes.filter(function(rec){ return titleMatchesQuery(rec.name || "", queryWords); });
    if(!matches.length){
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = matches.map(function(r){
      return '<div class="search-title-match" data-note-id="' + r.id + '">' +
        highlightTitleMatches(r.name || "", queryWords) +
        '</div>';
    }).join("");
    Array.prototype.forEach.call(wrap.querySelectorAll(".search-title-match"), function(el){
      el.addEventListener("click", function(){
        var id = el.getAttribute("data-note-id");
        if(switchSettingsTab) switchSettingsTab("set2s_1");
        if(openNoteByIdExternally) openNoteByIdExternally(id, queryWords);
      });
    });
  }

  // ===================== ПОИСК ПО ЗАМЕТКАМ =====================
  function runNotesSearch(rawQuery){
    var wrap = document.getElementById("searchResultsWrap");
    if(!wrap) return;
    var queryWords = splitQueryWords(rawQuery);
    if(!queryWords.length){
      wrap.innerHTML = '<div class="search-empty">Введите слово для поиска.</div>';
      return;
    }
    var notes = getSearchableNotes ? getSearchableNotes() : [];
    var results = [];
    notes.forEach(function(rec){
      var text = rec.text || "";
      var tokens = tokenize(text);
      var occurrences = findOccurrences(tokens, queryWords);
      if(!coversAllQueryWords(occurrences, queryWords.length)) return;
      var examples = pickExampleOccurrences(occurrences).map(function(o){
        return buildFragmentHtml(text, tokens, o);
      });
      results.push({ id: rec.id, name: rec.name, fragments: examples });
    });
    if(!results.length){
      wrap.innerHTML = '<div class="search-empty">Ничего не найдено.</div>';
      return;
    }
    wrap.innerHTML = results.map(function(r){
      return '<div class="search-result-card" data-note-id="' + r.id + '">' +
        '<div class="search-result-title">' + escapeHtml(r.name) + '</div>' +
        r.fragments.map(function(f){ return '<div class="search-result-fragment">' + f + '</div>'; }).join("") +
        '</div>';
    }).join("");
    var qWordsForHighlight = queryWords;
    Array.prototype.forEach.call(wrap.querySelectorAll(".search-result-card"), function(card){
      card.addEventListener("click", function(){
        var id = card.getAttribute("data-note-id");
        if(switchSettingsTab) switchSettingsTab("set2s_1");
        if(openNoteByIdExternally) openNoteByIdExternally(id, qWordsForHighlight);
      });
    });
    scrollSearchToBottom();
  }

  // ===================== ПОИСК ПО ЗАДАЧАМ =====================
  function runTasksSearch(rawQuery){
    var wrap = document.getElementById("searchResultsWrap");
    if(!wrap) return;
    var queryWords = splitQueryWords(rawQuery);
    if(!queryWords.length){
      wrap.innerHTML = '<div class="search-empty">Введите слово для поиска.</div>';
      return;
    }
    var tasks = getSearchableTasks ? getSearchableTasks() : [];
    var matches = [];
    tasks.forEach(function(t){
      var text = t.c.text || "";
      var tokens = tokenize(text);
      var occurrences = findOccurrences(tokens, queryWords);
      if(coversAllQueryWords(occurrences, queryWords.length)){
        matches.push({ task: t, occurrences: occurrences });
      }
    });
    if(!matches.length){
      wrap.innerHTML = '<div class="search-empty">Ничего не найдено.</div>';
      return;
    }
    wrap.innerHTML = matches.map(function(m){
      return '<div class="task-row" data-id="' + m.task.id + '"><div class="task-body" data-id="' + m.task.id + '"></div></div>';
    }).join("");
    matches.forEach(function(m){ renderSearchTaskRow(m.task.id, m.occurrences); });
    scrollSearchToBottom();
  }

  function removeSearchTaskRow(id){
    var row = document.querySelector('.search-results .task-row[data-id="' + id + '"]');
    if(row && row.parentNode) row.parentNode.removeChild(row);
    var wrap = document.getElementById("searchResultsWrap");
    if(wrap && !wrap.querySelector(".task-row")){
      wrap.innerHTML = '<div class="search-empty">Ничего не найдено.</div>';
    }
  }

  // Строка задачи в результатах поиска — те же кнопки/логика, что и у
  // обычной строки задачи (renderTaskRowView в my.js), но с декоративной
  // подсветкой найденных слов прямо в тексте вместо linkifyHtml (см. ТЗ:
  // подсветка "никак не влияет на форматирование и текущие функции" —
  // проще всего гарантировать это, не пропуская текст через автоссылки
  // здесь; после архивации/переноса задача убирается из выдачи (см.
  // onAfterAction ниже), после редактирования/смены приоритета строка
  // возвращается к обычному виду my.js — там уже без подсветки, это
  // сознательное упрощение).
  function renderSearchTaskRow(id, occurrences){
    var body = document.querySelector('.task-body[data-id="' + id + '"]');
    if(!body) return;
    // getTaskById не передан отдельным депом — достаточно найти саму
    // задачу среди getSearchableTasks() (то же самое хранилище).
    var all = getSearchableTasks ? getSearchableTasks() : [];
    var found = null;
    for(var i = 0; i < all.length; i++){ if(all[i].id === id){ found = all[i]; break; } }
    if(!found) return;
    var text = found.c.text || "";
    var sorted = occurrences.slice().sort(function(a, b){ return a.from - b.from; });
    var html = "";
    var last = 0;
    sorted.forEach(function(o){
      html += escapeHtml(text.slice(last, o.from));
      html += '<mark class="search-highlight-mark">' + escapeHtml(text.slice(o.from, o.to)) + '</mark>';
      last = o.to;
    });
    html += escapeHtml(text.slice(last));
    var isProjectsTab = found.c.tab === "projects";
    var flagClass = found.c.flag === "red" ? " flag-red" : (found.c.flag === "yellow" ? " flag-yellow" : "");
    body.innerHTML =
      '<span class="task-text-view">' + (text ? html : '<span class="task-text-placeholder">Новая задача</span>') + '</span>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-delete-btn" title="Удалить">' + getCrossIcon() + '</button>' +
        '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + getPencilIcon() + '</button>' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + getCheckIcon() + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + getMoveIcon() + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + getNextIcon() + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
        getReminderBtnHtml(found) +
      '</span>';
    var onAfterAction = function(){ removeSearchTaskRow(id); };
    body.querySelector(".task-edit-btn").addEventListener("click", function(){
      renderTaskRowEdit(id, found.c.tab, onAfterAction);
    });
    bindTaskRowActions(body, id, found.c.tab, onAfterAction);
    fitTaskActions(body);
  }

  return {
    renderSettingsTabSearch: renderSettingsTabSearch
  };
};
