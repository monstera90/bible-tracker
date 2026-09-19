// debug.js — общее место для отладочного кода "Графика чтения Библии".
// Версия: 1.2 (19.09) — в панели лога вторая кнопка «⧉ последние N»: копирует
// последние COPY_LAST_LINES строк, но не больше COPY_LAST_MAX_CHARS символов
// (пояснение у констант ниже). Код копирования в буфер вынесен в
// copyTextToClipboard, обе кнопки лежат в одной липкой полосе сверху панели.
// Версия: 1.1 (17.09)
//
// НАЗНАЧЕНИЕ: если задача не решается с первого раза и нужна диагностика
// прямо на устройстве пользователя (на мобильном нет консоли), временный
// отладочный код пишется сюда, а не прямо в my.js/mdeditor.js/другие
// файлы. Здесь он живёт в одном месте, включается/выключается галочкой
// "Включить режим отладки" в настройках (не правкой кода), и его проще
// найти и убрать целиком, когда задача решена.
//
// ВАЖНО ДЛЯ БУДУЩИХ ПРАВОК (в т.ч. для нейросети, читающей этот проект):
// если при работе с другим файлом встретился отладочный код, вставленный
// "на месте" для диагностики конкретной задачи (видимая на экране
// панель логов, console.log-цепочки и т.п.) — не переноси его сюда молча
// и не удаляй. Напиши об этом пользователю в ответе, чтобы перенос сюда
// сделали осознанно.
//
// Логирование (log/панель на экране) в этом файле — no-op, пока режим
// отладки выключен: log() ничего не делает, пока isEnabled() не вернёт
// true. Поэтому вызовы Debug.log(...) можно оставлять в коде — они не
// будут ничего показывать обычным пользователям. Если в файл добавляется
// не только логирование, а рабочий обходной манёвр (как
// guardTaskListScroll ниже) — сам манёвр должен работать всегда, а
// отладочным (гейтится галочкой) остаётся только его лог.

(function () {
  "use strict";

  var DEBUG_MODE_KEY = "bibleDebugMode_v1";
  var panelEl = null;

  // Включён ли режим отладки (галочка в настройках, вкладка "Шестерёнка").
  function isEnabled() {
    try {
      return localStorage.getItem(DEBUG_MODE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  // Вызывается из обработчика галочки в my.js (renderSettingsTabGear).
  function setEnabled(value) {
    try {
      localStorage.setItem(DEBUG_MODE_KEY, value ? "1" : "0");
    } catch (e) {}
    if (!value) {
      hidePanel();
      stopImageLineWatch();
      stopTaskScrollWatch();
      stopFreezeWatch();
    } else {
      startImageLineWatch();
      startTaskScrollWatch();
      startFreezeWatch();
    }
  }

  // Видимая на экране панель логов — аналог window.onerror из index.html
  // (тот выводит JS-ошибки на экран), но для произвольных отладочных
  // сообщений, которые сам код помечает через Debug.log(...).
  var logLines = []; // полный текст лога, для кнопки "скопировать" ниже —
  // на фото/скриншоте панели часть строк перекрывается другими элементами
  // экрана и мелкий шрифт плохо распознаётся, точный текст надёжнее.

  // ⚠️ ДОБАВЛЕНО (17.09, TASK_FIX_TASK_IMAGE_LOSS.md, продолжение): панель
  // выше живёт только в памяти вкладки — при любом обновлении страницы
  // (а баг именно в том, что происходит МЕЖДУ обновлениями, иногда с
  // задержкой до минуты) весь лог этого промежутка терялся ещё до того,
  // как его можно было прочитать. Здесь — отдельный, маленький и НЕ
  // связанный с основным state журнал: каждая строка лога (пока включена
  // галочка) дублируется в свой ключ localStorage, обрезанный по числу
  // строк. При следующей загрузке страницы, если галочка всё ещё
  // включена, этот журнал ПРОШЛОЙ сессии показывается первым в панели (с
  // явным разделителем), а сам ключ обнуляется под текущую сессию — то
  // есть на каждой перезагрузке видно ровно то, что произошло МЕЖДУ ней и
  // предыдущей, без накопления вручную. Пишется в СВОЙ ключ, не в
  // STORAGE_KEY/NOTES_STORAGE_KEY из my.js — переполнение квоты этим
  // журналом (try/catch ниже) никак не пересекается с задачами/картинками
  // и не может их утопить, как это уже было с notes:* (см. my.js).
  var DEBUG_PERSIST_KEY = "bibleDebugPersistLog_v1";
  var DEBUG_PERSIST_MAX_LINES = 150;
  var persistedLines = null; // строки ТЕКУЩЕЙ сессии, накапливаются сюда же, что пишется в localStorage
  // Пишем в localStorage не на КАЖДУЮ строку лога (детекторы фризов/сети
  // могут сыпать строками пачками — сама синхронная запись на каждую
  // добавила бы джиттер и исказила бы то, что эти же детекторы измеряют),
  // а не чаще раза в PERSIST_WRITE_THROTTLE_MS — но обязательно ДОПИСЫВАЕМ
  // немедленно перед возможной выгрузкой страницы (см. три слушателя
  // ниже), чтобы не потерять как раз последние строки перед перезагрузкой
  // — то, ради чего весь этот журнал и заводился.
  var PERSIST_WRITE_THROTTLE_MS = 300;
  var persistWriteTimer = null;
  var persistWritePending = false;

  function flushPersistedLines() {
    persistWritePending = false;
    if (persistedLines === null) return;
    try {
      localStorage.setItem(DEBUG_PERSIST_KEY, JSON.stringify(persistedLines));
    } catch (e) {
      // Некритично — журнал этой конкретной строки просто не переживёт
      // следующую перезагрузку, само приложение это ронять не должно.
    }
  }

  function loadPersistedLines() {
    try {
      var raw = localStorage.getItem(DEBUG_PERSIST_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function persistLine(line) {
    if (persistedLines === null) persistedLines = [];
    persistedLines.push(line);
    if (persistedLines.length > DEBUG_PERSIST_MAX_LINES) {
      persistedLines = persistedLines.slice(persistedLines.length - DEBUG_PERSIST_MAX_LINES);
    }
    if (!persistWritePending) {
      persistWritePending = true;
      clearTimeout(persistWriteTimer);
      persistWriteTimer = setTimeout(flushPersistedLines, PERSIST_WRITE_THROTTLE_MS);
    }
  }

  // Подстраховка на выгрузку страницы — те же три события, что my.js уже
  // использует для своего saveLocalState (см. TASK_FIX_TASK_IMAGE_LOSS.md):
  // на разных мобильных браузерах надёжно срабатывает не один и тот же из
  // них, поэтому все три сразу, а не один "самый правильный".
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && persistWritePending) flushPersistedLines();
  });
  window.addEventListener("pagehide", function () {
    if (persistWritePending) flushPersistedLines();
  });
  window.addEventListener("beforeunload", function () {
    if (persistWritePending) flushPersistedLines();
  });

  // Добавляет строку в панель НАПРЯМУЮ (logLines + DOM), БЕЗ повторной
  // записи в persistLine — иначе строки прошлой сессии переписывались бы
  // в журнал текущей на каждой загрузке и накапливались бы бесконечно.
  function appendRawLine(line) {
    var panel = ensurePanel();
    logLines.push(line);
    var p = document.createElement("div");
    p.textContent = line;
    panel.appendChild(p);
    panel.scrollTop = panel.scrollHeight;
  }

  // Вызывается один раз при старте (см. низ файла) — показывает журнал,
  // накопленный ДО этой загрузки страницы, явно помеченным блоком поверх
  // обычного лога текущей сессии, и обнуляет ключ под неё.
  function showPreviousSessionLog() {
    var prev = loadPersistedLines();
    if (!prev.length) return;
    appendRawLine("═══ ЛОГ ДО ЭТОЙ ЗАГРУЗКИ СТРАНИЦЫ (" + prev.length + " строк) ═══");
    prev.forEach(function (line) { appendRawLine(line); });
    appendRawLine("═══ ТЕКУЩАЯ ЗАГРУЗКА ═══");
    try { localStorage.removeItem(DEBUG_PERSIST_KEY); } catch (e) {}
    persistedLines = [];
  }
  // ⚠️ ДОБАВЛЕНО (19.09): вторая кнопка панели — «последние N строк». Полный
  // лог не всегда доезжает целиком: 19.09 файл с логом дошёл до чата обрезанным
  // РОВНО на 20 000 символов (на полуслове, без блока «ТЕКУЩАЯ ЗАГРУЗКА») —
  // часть ПОСЛЕ перезагрузки страницы, ради которой лог и снимался, терялась.
  // Буфер обмена Android тут не при чём (у него практический предел порядка
  // 1 МБ) — узким местом оказался приём текста в чате. Поэтому вторая кнопка
  // берёт последние COPY_LAST_LINES строк, но целыми строками и не больше
  // COPY_LAST_MAX_CHARS символов с конца (что наступит раньше) — с запасом до
  // 20 000 на строку-заголовок. Значения — константы здесь, при необходимости
  // правятся в одном месте.
  var COPY_LAST_LINES = 100;
  var COPY_LAST_MAX_CHARS = 18000;

  function buildLastLinesText() {
    var chosen = [];
    var size = 0;
    for (var i = logLines.length - 1; i >= 0 && chosen.length < COPY_LAST_LINES; i--) {
      var line = logLines[i];
      if (size + line.length + 1 > COPY_LAST_MAX_CHARS) {
        // одна-единственная строка длиннее потолка — берём её хвост, иначе
        // кнопка вообще ничего бы не скопировала
        if (!chosen.length) chosen.push(line.slice(-COPY_LAST_MAX_CHARS));
        break;
      }
      chosen.push(line);
      size += line.length + 1;
    }
    chosen.reverse();
    return "… (последние " + chosen.length + " из " + logLines.length +
      " строк лога, не больше " + COPY_LAST_MAX_CHARS + " символов)\n" + chosen.join("\n");
  }

  // Копирование текста в буфер обмена: navigator.clipboard, а если его нет —
  // запасной путь через скрытый textarea + execCommand. done(true/false).
  function copyTextToClipboard(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done(true);
    } catch (err) {
      done(false);
    }
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement("div");
    panelEl.id = "debugLogPanel";
    // Наверху экрана, а не внизу — внизу панель перекрывала кнопки
    // интерфейса и мешала на них нажимать (замечено пользователем 05.09).
    // Полупрозрачная (фон 0.35 вместо 0.85) и "прозрачная для кликов"
    // (pointer-events:none) — панель лежит поверх интерфейса ТОЛЬКО чтобы
    // показывать текст, сама панель клики/тапы не перехватывает, они
    // проходят насквозь к кнопкам под ней (ТЗ пользователя от 12.09).
    // Панель себя не скроллит вручную (scrollTop выставляется кодом ниже
    // на каждую новую строку) — отключённые pointer-events на это не
    // влияют, а прокрутить её пальцем, чтобы прочитать более ранние
    // строки, тоже больше нельзя — поэтому и нужна кнопка "скопировать"
    // ниже, а не попытка визуально прочитать панель целиком.
    panelEl.style.cssText =
      "position:fixed;left:4px;right:4px;top:4px;max-height:55vh;overflow:auto;" +
      "background:rgba(0,0,0,0.35);color:#0f0;font:10px monospace;padding:6px;" +
      "z-index:999999;white-space:pre-wrap;pointer-events:none;";

    // Кнопки копирования — единственные интерактивные элементы на всей
    // панели (pointer-events:auto точечно перебивает none у родителя, это
    // штатно работает в CSS). Обе лежат в одной липкой полосе сверху:
    //  1) «копировать лог» — ПОЛНЫЙ текст лога (logLines), а не только то,
    //     что видно в обрезанной по высоте панели — так в буфер попадают и
    //     более ранние строки, уехавшие вверх за пределы видимой области;
    //  2) «последние N» (19.09) — только хвост лога, см. COPY_LAST_LINES /
    //     COPY_LAST_MAX_CHARS выше.
    var btnBar = document.createElement("div");
    btnBar.style.cssText =
      "position:sticky;top:0;left:0;display:flex;flex-wrap:wrap;gap:4px;" +
      "margin-bottom:4px;pointer-events:none;z-index:1;";
    function addCopyButton(label, getText) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.cssText =
        "pointer-events:auto;background:#111;color:#0f0;border:1px solid #0f0;" +
        "font:10px monospace;padding:3px 8px;";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var text = getText();
        copyTextToClipboard(text, function (ok) {
          btn.textContent = ok ? "✓ скопировано, " + text.length + " симв." : "не удалось скопировать";
          setTimeout(function () { btn.textContent = label; }, 2000);
        });
      });
      btnBar.appendChild(btn);
    }
    addCopyButton("⧉ копировать лог", function () { return logLines.join("\n"); });
    addCopyButton("⧉ последние " + COPY_LAST_LINES, buildLastLinesText);
    panelEl.appendChild(btnBar);

    document.body.appendChild(panelEl);
    return panelEl;
  }

  function hidePanel() {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    logLines = [];
    // Галочка выключена явно пользователем — журнал прошлой сессии больше
    // не нужен и не должен неожиданно всплыть, если галочку включат снова
    // сильно позже, по несвязанному поводу.
    persistedLines = [];
    try { localStorage.removeItem(DEBUG_PERSIST_KEY); } catch (e) {}
  }

  function safeStringify(data) {
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data);
    } catch (e) {
      return String(data);
    }
  }

  // Debug.log(label[, data]) — печатает строку с меткой времени в панель на
  // экране (если режим отладки включён) и всегда дублирует в console.debug.
  // Ничего не делает и не создаёт панель, пока isEnabled() не true — можно
  // расставлять вызовы свободно, не заботясь о влиянии на обычных
  // пользователей.
  function log(label, data) {
    if (!isEnabled()) return;
    var panel = ensurePanel();
    var line =
      (Date.now() % 100000) +
      " " +
      label +
      (data !== undefined ? " " + safeStringify(data) : "");
    logLines.push(line);
    persistLine(line);
    var p = document.createElement("div");
    p.textContent = line;
    panel.appendChild(p);
    panel.scrollTop = panel.scrollHeight;
    try {
      console.debug("[debug]", label, data);
    } catch (e) {}
  }

  // Очистить видимую панель логов, не выключая режим отладки.
  function clear() {
    logLines = [];
    persistedLines = [];
    try { localStorage.removeItem(DEBUG_PERSIST_KEY); } catch (e) {}
    if (panelEl) {
      panelEl.innerHTML = "";
      // кнопку "скопировать" innerHTML="" тоже стирает — пересоздаём панель
      // с нуля тем же приёмом, что и при первом показе.
      panelEl.parentNode.removeChild(panelEl);
      panelEl = null;
      ensurePanel();
    }
  }

  // guardTaskListScroll() — защита от прыжка/подёргивания списка задач при
  // потере фокуса в никуда (ТЗ пользователя от 02.09, перенесено сюда из
  // my.js). Сама защита (откат scrollTop контейнера) работает ВСЕГДА,
  // независимо от режима отладки — это не диагностика, а рабочий обходной
  // манёвр. А вот подробный лог по каждому событию scroll/resize виден
  // только при включённой галочке "Включить режим отладки" (через log(),
  // который сам по себе no-op при isEnabled() === false).
  //
  // Вызывается в my.js на "blur" редактируемого поля задачи/комментария;
  // возвращает функцию restore(), которую нужно вызвать после того, как
  // поле перерисовано обратно в обычный вид. Необязательный параметр
  // container — какой именно элемент сторожить: по умолчанию
  // #settingsTabContent (так для обычных вкладок задач/комментариев — там
  // скроллится именно он), но на экране "Все задачи проекта" (openTaskNextPicker
  // в my.js) реальный скролл-контейнер вложенный — #taskProjectArea
  // (.task-project-area, overflow-y:auto в modals.css); у самого
  // #settingsTabContent там overflow:hidden через .task-project-modal-body,
  // и scrollTop всегда 0 — сторожить его бессмысленно, поэтому my.js
  // передаёт туда #taskProjectArea явно (см. 12.09, пятый заход — до этого
  // защита молча не работала именно на этом экране).
  function guardTaskListScroll(container) {
    container = container || document.getElementById("settingsTabContent");
    if (!container) return function () {};
    var savedScroll = container.scrollTop;
    function snapshot() {
      // ДОБАВЛЕНО (третий заход): в двух прогонах подряд scrollTop был 0
      // ВЕЗДЕ, от первой до последней строки — то есть тест проходил на
      // экране, где контейнеру физически нечего было скроллить (список
      // помещался целиком). Без scrollHeight/clientHeight это было видно
      // только "на глаз", постфактум, разбором лога. scrollHeight >
      // clientHeight здесь и значит "было что терять".
      return {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        winY: window.scrollY,
        vvH: window.visualViewport ? Math.round(window.visualViewport.height) : "?"
      };
    }
    log("blur:start", snapshot());
    var onScroll = function () {
      log("container scroll", snapshot());
      // Подстраховка: если гипотеза (не удалять узел сразу) не убрала сброс
      // целиком, хотя бы откатываем его сразу же, а не оставляем как есть.
      if (container.scrollTop !== savedScroll) container.scrollTop = savedScroll;
    };
    var onWinScroll = function () {
      log("window scroll", snapshot());
    };
    var onResize = function () {
      log("resize", snapshot());
    };
    container.addEventListener("scroll", onScroll);
    window.addEventListener("scroll", onWinScroll);
    window.addEventListener("resize", onResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
    setTimeout(function () {
      log("guard:end", snapshot());
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onWinScroll);
      window.removeEventListener("resize", onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", onResize);
    }, 2000);
    return function () {
      log("restore-called", snapshot());
      if (document.body.contains(container) && container.scrollTop !== savedScroll) container.scrollTop = savedScroll;
    };
  }

  window.Debug = {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    log: log,
    clear: clear,
    guardTaskListScroll: guardTaskListScroll
  };

  // ---------------------------------------------------------------------
  // ВРЕМЕННО (ТЗ пользователя от 06.09): непонятно, откуда берётся
  // визуальный отступ сверху/снизу картинки в "Моём блокноте" (режим
  // просмотра) — правка padding у .cm-md-image-line в components.css
  // (8px → 4px → 2px) визуально ничего не поменяла, хотя по всем файлам
  // проекта (components/modals/theme/base/footer.css, index.html)
  // конкурирующего правила не найдено. Этот блок ничего не чинит и не
  // подменяет — только замеряет, что браузер РЕАЛЬНО применил к строке с
  // картинкой (computed style) и какая у неё РЕАЛЬНАЯ высота на экране
  // (getBoundingClientRect), плюс то же самое для соседних строк — часто
  // "отступ вокруг картинки" на глаз на самом деле оказывается отступом
  // соседней текстовой строки. Само себя устанавливает через
  // MutationObserver, без единой правки в my.js/mdeditor.js — включается/
  // выключается той же галочкой "Включить режим отладки", что и остальной
  // Debug.log() (см. setEnabled выше). Убрать вместе с остальным
  // диагностическим кодом этой задачи, когда причина найдена.
  // ---------------------------------------------------------------------
  var imageLineObserver = null;

  function inspectImageLine(el) {
    if (!isEnabled()) return;
    var cs = window.getComputedStyle(el);
    var wrap = el.querySelector(".cm-md-image-wrap");
    var img = el.querySelector(".cm-md-image, .cm-md-image-missing, .cm-md-image-loading");
    var wrapCs = wrap ? window.getComputedStyle(wrap) : null;
    var imgCs = img ? window.getComputedStyle(img) : null;
    log("imgline class", el.className);
    log("imgline padding t/b", cs.paddingTop + " / " + cs.paddingBottom);
    log("imgline lineHeight/fontSize", cs.lineHeight + " / " + cs.fontSize);
    if (wrapCs) log("wrap margin t/b + display", wrapCs.marginTop + "/" + wrapCs.marginBottom + " " + wrapCs.display);
    if (imgCs) log("img margin+border t/b", (imgCs.marginTop + "+" + imgCs.borderTopWidth) + " / " + (imgCs.marginBottom + "+" + imgCs.borderBottomWidth));

    var lineRect = el.getBoundingClientRect();
    log("imgline rect", { top: Math.round(lineRect.top), bottom: Math.round(lineRect.bottom), height: Math.round(lineRect.height) });
    log("imgline border t/b", cs.borderTopWidth + " / " + cs.borderBottomWidth);
    log("imgline children count", el.children.length);
    for (var ci = 0; ci < el.children.length; ci++) {
      var child = el.children[ci];
      var childRect = child.getBoundingClientRect();
      var childCs = window.getComputedStyle(child);
      log(
        "child[" + ci + "] " + child.tagName + "." + child.className,
        { top: Math.round(childRect.top), bottom: Math.round(childRect.bottom), height: Math.round(childRect.height), display: childCs.display, margin: childCs.marginTop + "/" + childCs.marginBottom }
      );
    }
    log("imgline outerHTML", el.outerHTML.slice(0, 500));
    if (wrap) {
      var wrapRect = wrap.getBoundingClientRect();
      log("wrap rect", { top: Math.round(wrapRect.top), bottom: Math.round(wrapRect.bottom), height: Math.round(wrapRect.height) });
      log("gap line-top..wrap-top / wrap-bottom..line-bottom", Math.round(wrapRect.top - lineRect.top) + " / " + Math.round(lineRect.bottom - wrapRect.bottom));
    }

    var prev = el.previousElementSibling, next = el.nextElementSibling;
    if (prev) {
      var prevCs = window.getComputedStyle(prev);
      var prevRect = prev.getBoundingClientRect();
      log("prev line class/padding/rect.bottom", prev.className + " | " + prevCs.paddingTop + "/" + prevCs.paddingBottom + " | " + Math.round(prevRect.bottom));
      log("gap prev.bottom..imgline.top", Math.round(lineRect.top - prevRect.bottom));
    }
    if (next) {
      var nextCs = window.getComputedStyle(next);
      var nextRect = next.getBoundingClientRect();
      log("next line class/padding/rect.top", next.className + " | " + nextCs.paddingTop + "/" + nextCs.paddingBottom + " | " + Math.round(nextRect.top));
      log("gap imgline.bottom..next.top", Math.round(nextRect.top - lineRect.bottom));
    }
  }

  function startImageLineWatch() {
    if (imageLineObserver) return;
    imageLineObserver = new MutationObserver(function () {
      if (!isEnabled()) return;
      var lines = document.querySelectorAll(".cm-md-image-line");
      for (var i = 0; i < lines.length; i++) {
        var el = lines[i];
        if (el._debugInspected) continue; // не спамить панель на каждый ререндер decorations
        el._debugInspected = true;
        inspectImageLine(el);
      }
    });
    imageLineObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopImageLineWatch() {
    if (!imageLineObserver) return;
    imageLineObserver.disconnect();
    imageLineObserver = null;
  }

  // ---------------------------------------------------------------------
  // ВРЕМЕННО (ТЗ пользователя от 12.09, второй заход): раздел "Все задачи
  // проекта" (openTaskNextPicker в my.js) и вкладки задач вообще — прыжок
  // #settingsTabContent.scrollTop в начало, когда отредактировал задачу и
  // нажал мимо (например, на другую задачу, чтобы текущая сохранилась).
  // В my.js уже есть два обходных манёвра (Debug.guardTaskListScroll()
  // ниже + свой отдельный RAF-сторож прямо в openTaskNextPicker) — прыжок
  // всё равно проскакивает, значит настоящий источник ещё не найден.
  //
  // Этот блок ничего не чинит — только смотрит, ОТКУДА реально приходит
  // сброс, тремя независимыми способами:
  // 1) Перехватывает scrollTop контейнера #settingsTabContent через
  //    собственный get/set (Object.defineProperty прямо на узле, без
  //    трогания прототипа) — это ловит ЛЮБУЮ запись в scrollTop, кто бы
  //    её ни сделал: наш код, чужой код, или сам браузер (например, при
  //    схлопывании высоты — см. layoutSettingsModal). К каждой записи
  //    цепляется короткий кусок Error().stack (2-4 строки, с номерами
  //    строк my.js) — по нему будет видно, какая именно функция это
  //    сделала, даже если это анонимная функция без имени.
  // 2) MutationObserver на самом контейнере (childList, subtree:true) —
  //    отличает ПОЛНУЮ пересборку списка (container.innerHTML = ...,
  //    мутация прямо на контейнере, много добавленных/удалённых узлов) от
  //    точечного обновления одной строки (мутация глубже, на конкретном
  //    .task-body, один узел) — само по себе браузер обнуляет scrollTop
  //    только при полной пересборке ИЛИ при схлопывании высоты, так что
  //    это ключевой сигнал.
  // 3) focus/blur на .task-editable (capture-фаза, эти события не
  //    всплывают) + window/visualViewport resize (закрытие клавиатуры на
  //    мобильном меняет высоту именно так) — чтобы видеть, в каком
  //    порядке относительно смены фокуса приходит resize и мутация DOM.
  //
  // Всё это льётся в общую панель Debug.log в порядке появления — при
  // повторении бага (отредактировать задачу → тапнуть на другую) в панели
  // будет видна вся цепочка событий с точностью до строки my.js, которая
  // обнулила scrollTop. Включается/выключается той же галочкой "Включить
  // режим отладки". Убрать вместе с остальным диагностическим кодом этой
  // задачи, когда причина найдена.
  // ---------------------------------------------------------------------
  var scrollWatchContainer = null;
  var scrollWatchContainerObserver = null;
  var scrollWatchListenersInstalled = false;
  var scrollWatchLastKnown = null; // последнее известное значение scrollTop
  var scrollWatchPollHandle = null;
  var scrollWatchOrigGet = null; // "сырой" геттер прототипа, в обход нашего перехватчика

  // scrollTop/innerHTML определены через getter/setter где-то в цепочке
  // прототипов (обычно на Element.prototype/Node.prototype, но это не
  // гарантировано во всех браузерах) — getOwnPropertyDescriptor смотрит
  // только на сам объект, поэтому поднимаемся по цепочке, пока не найдём
  // его. Раньше эта функция была заточена только под scrollTop
  // (findScrollTopDescriptor) — обобщена 12.09 (второй заход), чтобы тем
  // же приёмом перехватывать и innerHTML (см. installInnerHTMLWatch ниже).
  function findPropDescriptor(obj, propName) {
    var proto = obj;
    while (proto) {
      var d = Object.getOwnPropertyDescriptor(proto, propName);
      if (d) return d;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }
  function findScrollTopDescriptor(obj) {
    return findPropDescriptor(obj, "scrollTop");
  }

  // короткий "откуда вызвано" — несколько строк стека (пропускаем первую,
  // саму эту функцию), без полного трейса — в панели логов на мобильном и
  // так тесно. Не трогаем текст самого стека, кроме обрезки длины: номера
  // строк/имена функций в нём и есть то, ради чего это всё затевалось.
  function shortStack(skip) {
    var e = new Error();
    if (!e.stack) return "(нет stack)";
    var lines = e.stack.split("\n").slice(skip || 2, (skip || 2) + 4);
    return lines.join(" <- ").slice(0, 400);
  }

  function installScrollTopWatch(container) {
    if (scrollWatchContainer === container) return;
    if (scrollWatchContainer) uninstallScrollTopWatch();
    var descriptor = findScrollTopDescriptor(container);
    if (!descriptor || !descriptor.get || !descriptor.set) {
      log("scrollWatch: не удалось найти дескриптор scrollTop, слежение отключено");
      return;
    }
    scrollWatchContainer = container;
    scrollWatchOrigGet = descriptor.get;
    scrollWatchLastKnown = descriptor.get.call(container);
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: function () {
        return descriptor.get.call(this);
      },
      set: function (v) {
        var before = descriptor.get.call(this);
        if (v !== before) {
          log("scrollTop СВОИМ JS: " + before + " -> " + v, shortStack(3));
        }
        scrollWatchLastKnown = v;
        return descriptor.set.call(this, v);
      }
    });
    log("scrollWatch: перехватчик scrollTop поставлен на #settingsTabContent");
    startScrollPoll();
  }

  function uninstallScrollTopWatch() {
    stopScrollPoll();
    if (!scrollWatchContainer) return;
    try {
      delete scrollWatchContainer.scrollTop; // возвращает поведение прототипа
    } catch (e) {}
    scrollWatchContainer = null;
    scrollWatchOrigGet = null;
  }

  // ДОБАВЛЕНО 12.09 (второй заход): предыдущий прогон лога показал, что
  // ни "scrollTop СВОИМ JS", ни "scrollTop БЕЗ JS-set" ни разу не
  // сработали за всю сессию — то есть scrollTop контейнера ни разу не
  // менялся за время записи лога (снимки во всех событиях, включая
  // blur:start, показывали 0). Это значит, что тот прогон не застал
  // самого прыжка — список либо и так был у самого верха, либо сброс
  // произошёл ДО того, как включили галочку отладки. Чтобы поймать
  // настоящий момент, нужно знать не только КОГДА меняется scrollTop, но
  // и КТО именно переписывает innerHTML контейнера (полная пересборка
  // сама по себе всегда обнуляет scrollTop — вопрос в том, какой вызов
  // это делает и восстанавливает ли он позицию после). Тем же приёмом,
  // что и scrollTop выше — свой get/set прямо на узле контейнера,
  // перехватывает любую запись в innerHTML и печатает короткий stack
  // (номера строк my.js), не трогая сам вызов.
  var innerHTMLWatchContainer = null;

  function installInnerHTMLWatch(container) {
    if (innerHTMLWatchContainer === container) return;
    if (innerHTMLWatchContainer) uninstallInnerHTMLWatch();
    var descriptor = findPropDescriptor(container, "innerHTML");
    if (!descriptor || !descriptor.get || !descriptor.set) {
      log("innerHTMLWatch: не удалось найти дескриптор innerHTML, слежение отключено");
      return;
    }
    innerHTMLWatchContainer = container;
    Object.defineProperty(container, "innerHTML", {
      configurable: true,
      get: function () {
        return descriptor.get.call(this);
      },
      set: function (v) {
        var rawScroll = scrollWatchOrigGet ? scrollWatchOrigGet.call(container) : container.scrollTop;
        log("innerHTML= (scrollTop до записи=" + rawScroll + ")", shortStack(3));
        return descriptor.set.call(this, v);
      }
    });
    log("innerHTMLWatch: перехватчик innerHTML поставлен на #settingsTabContent");
  }

  function uninstallInnerHTMLWatch() {
    if (!innerHTMLWatchContainer) return;
    try {
      delete innerHTMLWatchContainer.innerHTML; // возвращает поведение прототипа
    } catch (e) {}
    innerHTMLWatchContainer = null;
  }

  // ГЛАВНОЕ ДОПОЛНЕНИЕ: наш перехватчик выше ловит только явные
  // присваивания вида "container.scrollTop = X" из JS. Если браузер сам,
  // в обход любого JS-кода, меняет фактическую прокрутку контейнера
  // (например, компенсируя появление/скрытие виртуальной клавиатуры, или
  // из-за внутреннего рефлоу при схлопывании высоты) — такое изменение
  // НЕ проходит через наш set() и осталось бы полностью незамеченным. Раз
  // в предыдущем прогоне ни одной строки "scrollTop СВОИМ JS" в логе не
  // появилось, а scrollTop всё равно обнулился — подозрение именно на
  // это. Поэтому опрашиваем "сырое" значение на каждом кадре
  // (requestAnimationFrame) и сравниваем с последним известным: если оно
  // изменилось без прохождения через наш set() — значит, это браузер, а
  // не наш код.
  function startScrollPoll() {
    if (scrollWatchPollHandle) return;
    function tick() {
      if (!scrollWatchContainer || !scrollWatchOrigGet) {
        scrollWatchPollHandle = null;
        return;
      }
      var current = scrollWatchOrigGet.call(scrollWatchContainer);
      if (current !== scrollWatchLastKnown) {
        log("scrollTop БЕЗ JS-set (похоже, браузер сам): " + scrollWatchLastKnown + " -> " + current);
        scrollWatchLastKnown = current;
      }
      scrollWatchPollHandle = requestAnimationFrame(tick);
    }
    scrollWatchPollHandle = requestAnimationFrame(tick);
  }

  function stopScrollPoll() {
    if (scrollWatchPollHandle) {
      cancelAnimationFrame(scrollWatchPollHandle);
      scrollWatchPollHandle = null;
    }
  }

  // Сворачиваем однотипные мутации в одну итоговую строку за пачку (браузер
  // и так доставляет все мутации одного синхронного блока кода одним
  // вызовом колбэка) — иначе полная пересборка списка из десятка задач
  // выглядит как полтора десятка одинаковых строк "task-body" подряд и
  // выталкивает из панели самые важные (и самые ранние) строки диагностики.
  function watchContainerMutations(container) {
    if (scrollWatchContainerObserver) scrollWatchContainerObserver.disconnect();
    scrollWatchContainerObserver = new MutationObserver(function (mutations) {
      var onContainer = null;
      var taskBodyCount = 0;
      var otherCount = 0;
      mutations.forEach(function (m) {
        if (m.type !== "childList") return;
        if (m.addedNodes.length === 0 && m.removedNodes.length === 0) return;
        if (m.target === container) {
          onContainer = { added: m.addedNodes.length, removed: m.removedNodes.length };
        } else if (m.target.className && String(m.target.className).indexOf("task-body") !== -1) {
          taskBodyCount++;
        } else {
          otherCount++;
        }
      });
      // ДОБАВЛЕНО 12.09: сырое значение scrollTop прямо в момент мутации —
      // раньше эти строки лога не содержали scrollTop вообще, и по ним
      // было невозможно понять, менялось ли что-то именно в этот момент
      // или нет (приходилось гадать по соседним строкам). scrollWatchOrigGet
      // — тот самый "сырой" геттер (мимо нашего перехватчика), см. выше.
      var rawScrollNow = scrollWatchOrigGet ? scrollWatchOrigGet.call(container) : container.scrollTop;
      if (onContainer) {
        onContainer.scrollTopNow = rawScrollNow;
        onContainer.scrollHeight = container.scrollHeight;
        onContainer.clientHeight = container.clientHeight;
        log("DOM: ПОЛНАЯ пересборка #settingsTabContent (innerHTML=)", onContainer);
      }
      if (taskBodyCount) log("DOM: точечных .task-body обновлений " + taskBodyCount + ", scrollTop=" + rawScrollNow);
      if (otherCount) log("DOM: прочих мутаций " + otherCount + ", scrollTop=" + rawScrollNow);
    });
    scrollWatchContainerObserver.observe(container, { childList: true, subtree: true });
  }

  function installFocusBlurWatch() {
    if (scrollWatchListenersInstalled) return;
    scrollWatchListenersInstalled = true;
    document.addEventListener(
      "focus",
      function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains("task-editable")) {
          log("focus -> task-editable", t.id || t.getAttribute("data-task-id"));
        }
      },
      true
    );
    document.addEventListener(
      "blur",
      function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains("task-editable")) {
          log("blur <- task-editable", t.id || t.getAttribute("data-task-id"));
        }
      },
      true
    );
    window.addEventListener("resize", function () {
      var c = scrollWatchContainer;
      log("window resize", {
        innerHeight: window.innerHeight,
        scrollTop: c ? c.scrollTop : "(нет контейнера)"
      });
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        var c = scrollWatchContainer;
        log("visualViewport resize", {
          vvHeight: Math.round(window.visualViewport.height),
          scrollTop: c ? c.scrollTop : "(нет контейнера)"
        });
      });
    }
  }

  // Сам контейнер #settingsTabContent — статический узел разметки (только
  // его innerHTML переписывается при смене вкладки), но окно настроек
  // могло ещё ни разу не открыться к моменту включения галочки — поэтому
  // ищем контейнер и по MutationObserver на body (тот же приём, что и у
  // imageLineObserver выше), и сразу же при старте, если он уже есть.
  var scrollWatchBootObserver = null;
  function startTaskScrollWatch() {
    installFocusBlurWatch();
    var existing = document.getElementById("settingsTabContent");
    if (existing) {
      installScrollTopWatch(existing);
      installInnerHTMLWatch(existing);
      watchContainerMutations(existing);
      return;
    }
    if (scrollWatchBootObserver) return;
    scrollWatchBootObserver = new MutationObserver(function () {
      if (!isEnabled()) return;
      var el = document.getElementById("settingsTabContent");
      if (el) {
        installScrollTopWatch(el);
        installInnerHTMLWatch(el);
        watchContainerMutations(el);
      }
    });
    scrollWatchBootObserver.observe(document.body, { childList: true, subtree: true });
  }

  function stopTaskScrollWatch() {
    uninstallScrollTopWatch();
    uninstallInnerHTMLWatch();
    if (scrollWatchContainerObserver) {
      scrollWatchContainerObserver.disconnect();
      scrollWatchContainerObserver = null;
    }
    if (scrollWatchBootObserver) {
      scrollWatchBootObserver.disconnect();
      scrollWatchBootObserver = null;
    }
    // focus/blur/resize-слушатели намеренно не снимаем — они сами по себе
    // ничего не показывают и не логируют, пока isEnabled() === false
    // (log() внутри них — no-op), снимать и заново вешать их при каждом
    // переключении галочки просто не нужно.
  }

  // ---------------------------------------------------------------------
  // ДОБАВЛЕНО (диагностика фризов интерфейса, ТЗ от 16.09): общий детектор
  // зависаний главного потока — не привязан к конкретной функции, поэтому
  // работает уже сейчас, до того как виновник найден в коде. Рабочая
  // гипотеза (TASK_FILE_SYNC_RTDB.md, шаги 1-6 уже сделаны, шаг 7 — нет):
  // синхронизация файлов книг/картинок (`fileBlobs`) идёт через RTDB, и по
  // разделу 4.2 того ТЗ на узел `fileBlobs` НИГДЕ не должно быть
  // постоянного `on('value', ...)` — только точечный `get()`. Если это
  // правило где-то нарушено (или соблюдено, но расшифровка/декодирование
  // large base64 blob всё равно идёт синхронно в основном потоке), Firebase
  // при каждом изменении узла присылает его целиком — decode+decrypt
  // мегабайтного blob'а синхронно и есть механика фриза. Три независимых
  // сигнала, друг друга не заменяют:
  // 1) PerformanceObserver('longtask') — браузер сам сообщает о синхронных
  //    задачах длиннее ~50мс (стандартный порог Long Task API).
  // 2) Разрыв между кадрами requestAnimationFrame — ловит и то, что
  //    браузер не посчитал "long task" (например, серию мелких вызовов).
  // 3) Обёртка window.fetch и WebSocket, включая размер входящих
  //    WebSocket-сообщений — Firebase RTDB обычно ходит именно через
  //    WebSocket, и ненормально большое входящее сообщение (десятки/сотни
  //    КБ и больше) в момент фриза — прямая улика в пользу гипотезы выше
  //    (весь `fileBlobs` пришёл разом вместо точечного файла).
  // Включается/выключается той же галочкой "Включить режим отладки".
  // Убрать вместе с остальным диагностическим кодом этой задачи, когда
  // причина найдена.
  // ---------------------------------------------------------------------
  var longTaskObserver = null;
  var frameWatchHandle = null;
  var frameWatchLast = null;
  var netWatchInstalled = false;
  var WS_MSG_SIZE_WARN = 20000; // символов — заведомо больше одной картинки-миниатюры

  function startFreezeWatch() {
    // 1. Long Task API
    if (!longTaskObserver && typeof PerformanceObserver !== "undefined") {
      try {
        longTaskObserver = new PerformanceObserver(function (list) {
          if (!isEnabled()) return;
          list.getEntries().forEach(function (entry) {
            log("LONGTASK " + Math.round(entry.duration) + "мс", {
              start: Math.round(entry.startTime),
              name: entry.name
            });
          });
        });
        longTaskObserver.observe({ entryTypes: ["longtask"] });
      } catch (e) {
        log("freezeWatch: PerformanceObserver('longtask') недоступен", String(e));
      }
    }

    // 2. Разрыв между кадрами — обычный кадр ~16мс, порог ниже это заметный
    // на глаз фриз, а не рядовой джиттер.
    if (!frameWatchHandle) {
      frameWatchLast = performance.now();
      var FRAME_GAP_THRESHOLD_MS = 150;
      var frameTick = function () {
        var now = performance.now();
        var gap = now - frameWatchLast;
        if (gap > FRAME_GAP_THRESHOLD_MS && isEnabled()) {
          log("FREEZE (разрыв между кадрами) " + Math.round(gap) + "мс");
        }
        frameWatchLast = now;
        frameWatchHandle = requestAnimationFrame(frameTick);
      };
      frameWatchHandle = requestAnimationFrame(frameTick);
    }

    // 3. Сеть — устанавливается один раз навсегда (как focus/blur-слушатели
    // выше), сама обёртка ничего не логирует, пока isEnabled() === false,
    // поэтому снимать её при выключении галочки не нужно.
    if (!netWatchInstalled) {
      netWatchInstalled = true;
      if (window.fetch) {
        var origFetch = window.fetch;
        window.fetch = function () {
          var url = arguments[0] && arguments[0].url ? arguments[0].url : arguments[0];
          var t0 = performance.now();
          if (isEnabled()) log("fetch start", String(url).slice(0, 120));
          return origFetch.apply(this, arguments).then(
            function (res) {
              if (isEnabled()) log("fetch done " + Math.round(performance.now() - t0) + "мс", String(url).slice(0, 120));
              return res;
            },
            function (err) {
              if (isEnabled()) log("fetch error " + Math.round(performance.now() - t0) + "мс", String(err));
              throw err;
            }
          );
        };
      }
      if (window.WebSocket) {
        var OrigWS = window.WebSocket;
        var WrappedWS = function (url, protocols) {
          var ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
          var t0 = performance.now();
          if (isEnabled()) log("WebSocket open", String(url).slice(0, 120));
          ws.addEventListener("message", function (ev) {
            if (!isEnabled()) return;
            var size = ev && ev.data ? (ev.data.length || (ev.data.byteLength || 0)) : 0;
            if (size > WS_MSG_SIZE_WARN) {
              log("WebSocket БОЛЬШОЕ сообщение " + size + " симв.", String(url).slice(0, 120));
            }
          });
          ws.addEventListener("close", function () {
            if (isEnabled()) log("WebSocket close после " + Math.round(performance.now() - t0) + "мс", String(url).slice(0, 120));
          });
          return ws;
        };
        WrappedWS.prototype = OrigWS.prototype;
        WrappedWS.CONNECTING = OrigWS.CONNECTING;
        WrappedWS.OPEN = OrigWS.OPEN;
        WrappedWS.CLOSING = OrigWS.CLOSING;
        WrappedWS.CLOSED = OrigWS.CLOSED;
        window.WebSocket = WrappedWS;
      }
    }
  }

  function stopFreezeWatch() {
    if (longTaskObserver) {
      longTaskObserver.disconnect();
      longTaskObserver = null;
    }
    if (frameWatchHandle) {
      cancelAnimationFrame(frameWatchHandle);
      frameWatchHandle = null;
    }
    // fetch/WebSocket обёртки не снимаем — см. комментарий в startFreezeWatch.
  }

  if (isEnabled()) {
    showPreviousSessionLog();
    startImageLineWatch();
    startTaskScrollWatch();
    startFreezeWatch();
    startFreezeWatch();
  }
})();
