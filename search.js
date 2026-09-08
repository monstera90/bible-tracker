/* ===========================================================================
   search.js
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
  // "Поиск по заметкам" — из mdeditor.js (openNoteById/getSearchableNotes,
  // см. деп-контракт ниже); заметки могут быть ещё не готовы (нет
  // синхронизации) — тогда getSearchableNotes() просто вернёт [].
  var openNoteById = deps.openNoteById;
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

  function renderSettingsTabSearch(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML =
      '<div class="mdeditor-tab">' +
        '<h3 class="common-tab-title">Поиск</h3>' +
        '<div class="search-input-row">' +
          '<input type="text" class="search-input" id="searchQueryInput" placeholder="Слово или несколько слов…" enterkeyhint="search">' +
        '</div>' +
      '</div>' +
      '<div class="mdeditor-tab settings-content-bottom">' +
        '<div class="search-results" id="searchResultsWrap">' +
          '<div class="search-empty">Выберите, что искать — задачи или заметки, — и введите слово.</div>' +
        '</div>' +
      '</div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn" id="searchTasksBtn" title="Поиск по задачам">' + SEARCH_TASKS_ICON_SVG + '</button>' +
        '<button type="button" class="mdeditor-fab-btn" id="searchNotesBtn" title="Поиск по заметкам">' + SEARCH_NOTES_ICON_SVG + '</button>' +
      '</div>';

    var input = document.getElementById("searchQueryInput");
    var tasksBtn = document.getElementById("searchTasksBtn");
    var notesBtn = document.getElementById("searchNotesBtn");

    function runActiveSearch(){
      if(activeMode === "notes") runNotesSearch(input.value);
      else if(activeMode === "tasks") runTasksSearch(input.value);
    }
    function pressMode(mode){
      activeMode = mode;
      if(tasksBtn) tasksBtn.classList.toggle("pressed", mode === "tasks");
      if(notesBtn) notesBtn.classList.toggle("pressed", mode === "notes");
      runActiveSearch();
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
    }
  }

  // ---------------------------------------------------------------------
  // Пиктограммы — свои, придуманы под эту вкладку (лупа + характерный
  // силуэт задачи/заметки), тот же стиль обводки, что и у остальных иконок
  // проекта (stroke=currentColor, viewBox 24x24).
  // ---------------------------------------------------------------------
  var SEARCH_TASKS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9.5 4h6a1 1 0 0 1 1 1v1.5h-8V5a1 1 0 0 1 1-1z"></path>' +
    '<path d="M6.5 6.5h9a1 1 0 0 1 1 1V15h-11V7.5a1 1 0 0 1 1-1z"></path>' +
    '<path d="M8.3 9.6l1.3 1.3 2.2-2.4"></path>' +
    '<line x1="13.3" y1="9.7" x2="14.7" y2="9.7"></line>' +
    '<path d="M8.3 12.6l1.3 1.3 2.2-2.4"></path>' +
    '<line x1="13.3" y1="12.7" x2="14.7" y2="12.7"></line>' +
    '<circle cx="17.3" cy="17.3" r="3.1"></circle>' +
    '<line x1="19.6" y1="19.6" x2="22" y2="22"></line>' +
    '</svg>';
  var SEARCH_NOTES_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 3.5h8l3 3V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"></path>' +
    '<path d="M13 3.5v3h3"></path>' +
    '<line x1="6.5" y1="10" x2="12.5" y2="10"></line>' +
    '<line x1="6.5" y1="13" x2="10.5" y2="13"></line>' +
    '<circle cx="16.3" cy="16.3" r="3.1"></circle>' +
    '<line x1="18.6" y1="18.6" x2="21" y2="21"></line>' +
    '</svg>';

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
        if(openNoteById) openNoteById(id, null, null, qWordsForHighlight);
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
        '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + getPencilIcon() + '</button>' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + getCheckIcon() + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + getMoveIcon() + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + getNextIcon() + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
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
