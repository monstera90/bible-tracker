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
    if (!value) hidePanel();
  }

  // Видимая на экране панель логов — аналог window.onerror из index.html
  // (тот выводит JS-ошибки на экран), но для произвольных отладочных
  // сообщений, которые сам код помечает через Debug.log(...).
  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement("div");
    panelEl.id = "debugLogPanel";
    panelEl.style.cssText =
      "position:fixed;left:4px;right:4px;bottom:4px;max-height:40vh;overflow:auto;" +
      "background:rgba(0,0,0,0.85);color:#0f0;font:10px monospace;padding:6px;" +
      "z-index:999999;white-space:pre-wrap;";
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function hidePanel() {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
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
    if (panelEl) panelEl.innerHTML = "";
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
  // поле перерисовано обратно в обычный вид.
  function guardTaskListScroll() {
    var container = document.getElementById("settingsTabContent");
    if (!container) return function () {};
    var savedScroll = container.scrollTop;
    function snapshot() {
      return {
        scrollTop: container.scrollTop,
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
})();
