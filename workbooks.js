/* ===========================================================================
   workbooks.js
   Функционал вкладки "Извлечение информации из графиков" (первая нижняя
   вкладка второго набора, settingsTabSet2GearBtn1 / ключ "set2b_1" в
   my.js). Выделено в отдельный файл по тому же образцу, что и mood.js —
   модуль создаётся вызовом window.initWorkbooksModule(deps) из my.js.

   Сейчас реализовано: 8 полей для ссылок на гугл-документы (сохраняются
   в localStorage, переживают перезапуск приложения) и кнопка "Начать",
   которая реально скачивает каждый документ (.../export?format=docx,
   CORS для этого домена проверен вручную - работает), распаковывает его
   через MiniZip (см. minizip.js - собственный ZIP-ридер) и показывает
   статус по каждой ссылке (включая число найденных таблиц). Сама
   разборка содержимого таблиц в задания и сборка .xlsx (то же, что
   делает python-скрипт workbook-script.py) добавится здесь же следующим
   шагом.
   =========================================================================== */

(function(global){
  "use strict";

  function initWorkbooksModule(deps){
    deps = deps || {};
    var escapeHtml = deps.escapeHtml || function(s){ return String(s); };

    var LINKS_KEY = "workbooksLinks";
    var LINKS_COUNT = 8;

    // Загруженные на последний "Начать" документы: XML-содержимое
    // word/document.xml для каждой ссылки (0..7), уже готовое к разбору
    // таблиц следующим шагом. Существует только в памяти вкладки.
    var lastDocumentXmls = [];

    function loadLinks(){
      try{
        var raw = localStorage.getItem(LINKS_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        if(!Array.isArray(arr)) arr = [];
        while(arr.length < LINKS_COUNT) arr.push("");
        return arr.slice(0, LINKS_COUNT);
      }catch(e){
        return new Array(LINKS_COUNT).fill("");
      }
    }

    function saveLinks(links){
      try{ localStorage.setItem(LINKS_KEY, JSON.stringify(links)); }catch(e){}
    }

    function readLinksFromInputs(){
      var links = [];
      for(var i = 0; i < LINKS_COUNT; i++){
        var el = document.getElementById("workbooksLink" + i);
        links.push(el ? el.value.trim() : "");
      }
      return links;
    }

    // Принимает любую ссылку на гугл-документ (обычную .../edit?...,
    // уже готовую .../export?format=docx, или просто ID документа) и
    // приводит её к виду .../export?format=docx. Возвращает null, если
    // это не похоже на ссылку/ID гугл-документа.
    function toExportUrl(raw){
      var s = (raw || "").trim();
      if(!s) return null;

      var m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
      if(m) return "https://docs.google.com/document/d/" + m[1] + "/export?format=docx";

      if(/^[a-zA-Z0-9_-]{20,}$/.test(s)){
        return "https://docs.google.com/document/d/" + s + "/export?format=docx";
      }

      return null;
    }

    function renderLinkInputsHtml(links){
      var html = "";
      for(var i = 0; i < LINKS_COUNT; i++){
        html +=
          '<input type="text" id="workbooksLink' + i + '" class="workbooks-link-input" ' +
          'placeholder="Ссылка на документ ' + (i + 1) + '" value="' +
          escapeHtml(links[i] || "") + '">';
      }
      return html;
    }

    function setStatusLine(index, html){
      var el = document.getElementById("workbooksLinkStatus" + index);
      if(el) el.innerHTML = html;
    }

    function runFetchAll(){
      var links = readLinksFromInputs();
      saveLinks(links);
      lastDocumentXmls = new Array(LINKS_COUNT).fill(null);

      var summaryEl = document.getElementById("workbooksRunSummary");
      var anyLink = links.some(function(l){ return l; });
      if(!anyLink){
        if(summaryEl) summaryEl.textContent = "Сначала вставь хотя бы одну ссылку.";
        return;
      }
      if(summaryEl) summaryEl.textContent = "Загружаю…";

      var tasks = links.map(function(link, i){
        setStatusLine(i, "");
        if(!link) return Promise.resolve();

        var exportUrl = toExportUrl(link);
        if(!exportUrl){
          setStatusLine(i, '<span class="workbooks-status-err">Не похоже на ссылку гугл-документа</span>');
          return Promise.resolve();
        }

        setStatusLine(i, "Загружаю…");
        return fetch(exportUrl)
          .then(function(response){
            if(!response.ok){
              setStatusLine(i, '<span class="workbooks-status-err">HTTP ' + response.status + '</span>');
              return;
            }
            return response.arrayBuffer().then(function(buf){
              setStatusLine(i, "Распаковываю…");
              return MiniZip.extractDocxDocumentXml(buf).then(function(xml){
                lastDocumentXmls[i] = xml;
                var tableCount = (xml.match(/<w:tbl>/g) || []).length;
                var kb = Math.round(buf.byteLength / 1024);
                setStatusLine(i, '<span class="workbooks-status-ok">' + kb + ' КБ, таблиц: ' + tableCount + '</span>');
              });
            });
          })
          .catch(function(err){
            setStatusLine(i, '<span class="workbooks-status-err">Ошибка: ' +
              escapeHtml(String(err && err.message || err)) + '</span>');
          });
      });

      Promise.all(tasks).then(function(){
        var okCount = lastDocumentXmls.filter(function(x){ return x; }).length;
        if(summaryEl){
          summaryEl.textContent = okCount > 0
            ? "Готово: успешно обработано документов - " + okCount + ". Разбор таблиц в задания добавим следующим шагом."
            : "Ни один файл не обработался — проверь ссылки.";
        }
      });
    }

    // Вкладка рисуется прямо в общую рабочую область окна настроек, как и
    // остальные вкладки (см. renderSettingsTabExtra/renderSettingsTabMood
    // в my.js/mood.js) — контейнер запрашиваем напрямую, без пробрасывания
    // через deps, тем же способом, что и в mood.js.
    function renderSettingsTabWorkbooks(){
      var container = document.getElementById("settingsTabContent");
      if(!container) return;

      var links = loadLinks();

      var rowsHtml = "";
      for(var i = 0; i < LINKS_COUNT; i++){
        rowsHtml +=
          '<div class="workbooks-link-row">' +
            '<input type="text" id="workbooksLink' + i + '" class="workbooks-link-input" ' +
            'placeholder="Ссылка на документ ' + (i + 1) + '" value="' +
            escapeHtml(links[i] || "") + '">' +
            '<div id="workbooksLinkStatus' + i + '" class="workbooks-link-status"></div>' +
          '</div>';
      }

      container.innerHTML =
        '<div class="workbooks-tab">' +
          '<h3 class="workbooks-title">Извлечение информации из графиков</h3>' +
          '<div class="workbooks-links-list">' + rowsHtml + '</div>' +
          '<button type="button" id="workbooksRunBtn" class="workbooks-run-btn">Начать</button>' +
          '<div id="workbooksRunSummary" class="workbooks-run-summary"></div>' +
        '</div>';

      // сохраняем ссылки по мере ввода, чтобы не потерять их, даже если
      // "Начать" ни разу не нажали
      for(var j = 0; j < LINKS_COUNT; j++){
        (function(idx){
          var el = document.getElementById("workbooksLink" + idx);
          if(el){
            el.addEventListener("input", function(){
              saveLinks(readLinksFromInputs());
            });
          }
        })(j);
      }

      var runBtn = document.getElementById("workbooksRunBtn");
      if(runBtn) runBtn.addEventListener("click", runFetchAll);
    }

    return {
      renderSettingsTabWorkbooks: renderSettingsTabWorkbooks
    };
  }

  global.initWorkbooksModule = initWorkbooksModule;
})(typeof window !== "undefined" ? window : this);
