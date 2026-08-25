/* ===========================================================================
   workbooks.js
   Функционал вкладки "Извлечение информации из графиков" (первая нижняя
   вкладка второго набора, settingsTabSet2GearBtn1 / ключ "set2b_1" в
   my.js). Выделено в отдельный файл по тому же образцу, что и mood.js —
   модуль создаётся вызовом window.initWorkbooksModule(deps) из my.js.

   Реализовано полностью: 8 слотов для прикрепления файлов .docx (значки
   со скрепкой — тот же приём, что и во вкладке "Объединение заметок", см.
   jwlmerge.js/fileRowHtml), два в ряд (4 ряда). Кнопка "Начать" разбирает
   каждый прикреплённый файл прямо на устройстве — распаковывает через
   MiniZip (minizip.js), разбирает таблицы через DocxParse (docxparse.js)
   и WorkbookParse (workbookparse.js — перенос python-скрипта
   workbook-script.py, все 14 вкладок), собирает итоговый .xlsx через
   MiniXlsx (minixlsx.js). Кнопка "Скачать" рядом с "Начать" — обычная
   загрузка в Downloads; неактивна (в базовом стиле .workbooks-result-btn),
   пока файл не собран, и становится залитой фиолетовым (класс "ready",
   тот же вид, что и у рабочей кнопки "Начать") как только .xlsx готов.
   Файлы (в памяти вкладки, объект File — до перезагрузки страницы) и
   собранный .xlsx остаются между переключениями вкладок до следующего
   запуска "Начать", как и раньше.
   =========================================================================== */

(function(global){
  "use strict";

  function initWorkbooksModule(deps){
    deps = deps || {};
    var escapeHtml = deps.escapeHtml || function(s){ return String(s); };
    var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG || "";

    var FILES_COUNT = 8;

    // Прикреплённые файлы — только в памяти вкладки (File нельзя положить
    // в localStorage), как и во вкладке "Объединение заметок" (см.
    // jwlmerge.js). Переживают переключение вкладок (модуль создаётся
    // один раз), но не перезагрузку страницы.
    var selectedFiles = new Array(FILES_COUNT).fill(null);

    // Последний собранный .xlsx — хранится в памяти вкладки и "не
    // исчезает", пока не запущен новый разбор.
    var lastXlsxBlob = null;
    var lastXlsxFilename = "Сводная_таблица.xlsx";

    function setStatusLine(index, html){
      var el = document.getElementById("workbooksLinkStatus" + index);
      if(el) el.innerHTML = html;
    }

    function setFileName(index, name){
      var el = document.getElementById("workbooksFileName" + index);
      if(el) el.textContent = name || ("Документ " + (index + 1));
    }

    function refreshDownloadBtn(){
      var btn = document.getElementById("workbooksDownloadBtn");
      if(!btn) return;
      btn.disabled = !lastXlsxBlob;
      btn.classList.toggle("ready", !!lastXlsxBlob);
    }

    function runFetchAll(){
      var summaryEl = document.getElementById("workbooksRunSummary");
      var anyFile = selectedFiles.some(function(f){ return f; });
      if(!anyFile){
        if(summaryEl) summaryEl.textContent = "Сначала прикрепи хотя бы один файл.";
        return;
      }
      if(summaryEl) summaryEl.textContent = "Разбираю…";
      lastXlsxBlob = null;
      refreshDownloadBtn();

      var xmls = new Array(FILES_COUNT).fill(null);

      var tasks = selectedFiles.map(function(file, i){
        setStatusLine(i, "");
        if(!file) return Promise.resolve();

        setStatusLine(i, "Распаковываю…");
        return file.arrayBuffer()
          .then(function(buf){
            return MiniZip.extractDocxDocumentXml(buf).then(function(xml){
              xmls[i] = xml;
              var tableCount = (xml.match(/<w:tbl>/g) || []).length;
              var kb = Math.round(buf.byteLength / 1024);
              setStatusLine(i, '<span class="workbooks-status-ok">' + kb + ' КБ, таблиц: ' + tableCount + '</span>');
            });
          })
          .catch(function(err){
            setStatusLine(i, '<span class="workbooks-status-err">Ошибка: ' +
              escapeHtml(String(err && err.message || err)) + '</span>');
          });
      });

      Promise.all(tasks).then(function(){
        var okXmls = xmls.filter(function(x){ return x; });
        if(summaryEl){
          summaryEl.textContent = okXmls.length > 0
            ? "Собрано документов: " + okXmls.length + ". Формирую таблицу…"
            : "Ни один файл не обработался — проверь документы.";
        }
        if(okXmls.length === 0){
          refreshDownloadBtn();
          return;
        }
        try{
          var wb = WorkbookParse.buildWorkbook(okXmls);
          var sheets = wb.order.map(function(name){
            return { name: name, rows: wb.sheets[name] };
          });
          var xlsxBytes = MiniXlsx.buildXlsx(sheets);
          lastXlsxBlob = new Blob([xlsxBytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          });
          if(summaryEl){
            summaryEl.textContent = "Готово: обработано документов - " + okXmls.length + ".";
          }
        }catch(err){
          lastXlsxBlob = null;
          if(summaryEl){
            summaryEl.textContent = "Ошибка при сборке таблицы: " + (err && err.message || err);
          }
        }
        refreshDownloadBtn();
      });
    }

    function downloadToDownloads(){
      if(!lastXlsxBlob) return;
      var url = URL.createObjectURL(lastXlsxBlob);
      var a = document.createElement("a");
      a.href = url;
      a.download = lastXlsxFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
    }

    // Один слот сетки: скрепка + имя выбранного файла + статус разбора.
    // initialName приходит из selectedFiles при повторном открытии вкладки
    // (DOM пересоздаётся, но выбор файлов — нет).
    function fileSlotHtml(idx, initialName){
      return '' +
        '<div class="workbooks-file-slot">' +
          '<button type="button" class="task-import-attach-btn" id="workbooksAttachBtn' + idx + '" title="Прикрепить файл">' + PAPERCLIP_ICON_SVG + '</button>' +
          '<div class="workbooks-file-slot-body">' +
            '<span id="workbooksFileName' + idx + '" class="task-import-file-name">' +
              escapeHtml(initialName || ("Документ " + (idx + 1))) +
            '</span>' +
            '<div id="workbooksLinkStatus' + idx + '" class="workbooks-link-status"></div>' +
          '</div>' +
          '<input type="file" accept=".docx" id="workbooksFileInput' + idx + '" style="display:none;">' +
        '</div>';
    }

    // Вкладка рисуется прямо в общую рабочую область окна настроек, как и
    // остальные вкладки (см. renderSettingsTabExtra/renderSettingsTabMood
    // в my.js/mood.js) — контейнер запрашиваем напрямую, без пробрасывания
    // через deps, тем же способом, что и в mood.js.
    function renderSettingsTabWorkbooks(){
      var container = document.getElementById("settingsTabContent");
      if(!container) return;

      var slotsHtml = "";
      for(var i = 0; i < FILES_COUNT; i++){
        slotsHtml += fileSlotHtml(i, selectedFiles[i] ? selectedFiles[i].name : null);
      }

      container.innerHTML =
        '<div class="workbooks-tab settings-content-bottom">' +
          '<h3 class="workbooks-title">Извлечение информации из графиков</h3>' +
          '<div class="workbooks-files-grid">' + slotsHtml + '</div>' +
          '<div class="workbooks-actions-row">' +
            '<button type="button" id="workbooksRunBtn" class="workbooks-run-btn">Начать</button>' +
            '<button type="button" id="workbooksDownloadBtn" class="workbooks-result-btn workbooks-download-btn" disabled>Скачать</button>' +
          '</div>' +
          '<div id="workbooksRunSummary" class="workbooks-run-summary"></div>' +
        '</div>';

      for(var j = 0; j < FILES_COUNT; j++){
        (function(idx){
          var input = document.getElementById("workbooksFileInput" + idx);
          var attachBtn = document.getElementById("workbooksAttachBtn" + idx);
          if(attachBtn) attachBtn.addEventListener("click", function(){ input.click(); });
          if(input){
            input.addEventListener("change", function(){
              var f = input.files && input.files[0] ? input.files[0] : null;
              selectedFiles[idx] = f;
              setFileName(idx, f ? f.name : null);
              setStatusLine(idx, "");
            });
          }
        })(j);
      }

      var runBtn = document.getElementById("workbooksRunBtn");
      if(runBtn) runBtn.addEventListener("click", runFetchAll);

      var downloadBtn = document.getElementById("workbooksDownloadBtn");
      if(downloadBtn) downloadBtn.addEventListener("click", downloadToDownloads);

      refreshDownloadBtn(); // покажет "Скачать" активной, если файл уже был собран ранее
    }

    return {
      renderSettingsTabWorkbooks: renderSettingsTabWorkbooks
    };
  }

  global.initWorkbooksModule = initWorkbooksModule;
})(typeof window !== "undefined" ? window : this);
