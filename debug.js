// debug.js — общее место для отладочного кода "Графика чтения Библии".
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
    } else {
      startImageLineWatch();
      startTaskScrollWatch();
    }
  }

  // Видимая на экране панель логов — аналог window.onerror из index.html
  // (тот выводит JS-ошибки на экран), но для произвольных отладочных
  // сообщений, которые сам код помечает через Debug.log(...).
  var logLines = []; // полный текст лога, для кнопки "скопировать" ниже —
  // на фото/скриншоте панели часть строк перекрывается другими элементами
  // экрана и мелкий шрифт плохо распознаётся, точный текст надёжнее.
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

    // Кнопка "скопировать весь лог" — единственный интерактивный элемент
    // на всей панели (pointer-events:auto точечно перебивает none у
    // родителя, это штатно работает в CSS). Копирует ПОЛНЫЙ текст лога
    // (logLines), а не только то, что видно в обрезанной по высоте
    // панели — так в буфер попадают и более ранние строки, уехавшие
    // вверх за пределы видимой области.
    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "⧉ копировать лог";
    copyBtn.style.cssText =
      "position:sticky;top:0;left:0;display:block;margin-bottom:4px;" +
      "pointer-events:auto;background:#111;color:#0f0;border:1px solid #0f0;" +
      "font:10px monospace;padding:3px 8px;z-index:1;";
    copyBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var text = logLines.join("\n");
      function done(ok) {
        copyBtn.textContent = ok ? "✓ скопировано" : "не удалось скопировать";
        setTimeout(function () {
          copyBtn.textContent = "⧉ копировать лог";
        }, 1500);
      }
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
    });
    panelEl.appendChild(copyBtn);

    document.body.appendChild(panelEl);
    return panelEl;
  }

  function hidePanel() {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    logLines = [];
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

  if (isEnabled()) {
    startImageLineWatch();
    startTaskScrollWatch();
  }
})();
