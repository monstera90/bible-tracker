/* ===========================================================================
   workbooks.js
   Функционал вкладки "Извлечение информации из графиков" (первая нижняя
   вкладка второго набора, settingsTabSet2GearBtn1 / ключ "set2b_1" в
   my.js). Выделено в отдельный файл по тому же образцу, что и mood.js —
   модуль создаётся вызовом window.initWorkbooksModule(deps) из my.js.

   8 слотов - каждый со скрепкой, но скрепка здесь не открывает выбор
   файла, а раскрывает поле для ввода ссылки на гугл-документ (клик по
   скрепке ещё раз/потеря фокуса — сворачивает обратно). Ссылки хранятся
   в localStorage - переживают закрытие вкладки и перезапуск приложения.
   Кнопка "Начать" реально скачивает каждый документ
   (.../export?format=docx, CORS на docs.google.com проверен вручную -
   работает), распаковывает через MiniZip (minizip.js), разбирает таблицы
   через DocxParse (docxparse.js) и WorkbookParse (workbookparse.js -
   перенос python-скрипта workbook-script.py, все 14 вкладок), собирает
   итоговый .xlsx через MiniXlsx (minixlsx.js). Кнопка "Скачать" рядом -
   обычная загрузка в Downloads, активна (залита фиолетовым, класс
   "ready") только когда .xlsx готов.
   =========================================================================== */

(function(global){
  "use strict";

  function initWorkbooksModule(deps){
    deps = deps || {};
    var escapeHtml = deps.escapeHtml || function(s){ return String(s); };
    var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG || "";

    var LINKS_COUNT = 8;
    var LINKS_KEY = "workbooksLinks";
    var NAMES_KEY = "workbooksLinkNames"; // имена файлов из docProps/core.xml документа, кэш

    var lastXlsxBlob = null;
    var lastXlsxFilename = "Сводная_таблица.xlsx";

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

    function loadNames(){
      try{
        var raw = localStorage.getItem(NAMES_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        if(!Array.isArray(arr)) arr = [];
        while(arr.length < LINKS_COUNT) arr.push("");
        return arr.slice(0, LINKS_COUNT);
      }catch(e){
        return new Array(LINKS_COUNT).fill("");
      }
    }

    function saveNames(names){
      try{ localStorage.setItem(NAMES_KEY, JSON.stringify(names)); }catch(e){}
    }

    // ID документа отдельно от готового .../export?format=docx URL - нужен
    // и для mobilebasic-страницы ниже (у неё свой путь).
    function extractDocId(raw){
      var s = (raw || "").trim();
      if(!s) return null;
      var m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
      if(m) return m[1];
      if(/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
      return null;
    }

    // Имя файла через заголовок Content-Disposition не достать: Google не
    // открывает его для кросс-доменных запросов через
    // Access-Control-Expose-Headers. dc:title внутри docProps/core.xml
    // экспортированного .docx (см. MiniZip.extractDocxTitle) тоже не
    // годится в качестве основного источника - это отдельное поле
    // "Название документа" (Файл → Сведения о документе), которое почти
    // никогда не заполняется и не совпадает с именем файла на Диске.
    // Настоящее имя файла лежит в <title> лёгкой мобильной HTML-страницы
    // документа (.../mobilebasic) - она доступна без входа для файлов с
    // доступом по ссылке и не требует скачивания/распаковки всего .docx.
    function mobilebasicUrl(docId){
      return "https://docs.google.com/document/d/" + docId + "/mobilebasic";
    }

    function fetchNameFromMobilebasic(docId){
      return fetch(mobilebasicUrl(docId))
        .then(function(r){
          if(!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function(html){
          var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
          if(!m) return null;
          var title = MiniZip.decodeXmlEntities(m[1]).trim();
          return title || null;
        });
    }

    // Основной источник имени - mobilebasic-страница (см. выше). Если она
    // недоступна (сеть, HTTP-код, документ без доступа по ссылке) или в
    // ней нет <title>, откатываемся на старый способ - dc:title внутри
    // самого экспортированного .docx (для этого файл приходится полностью
    // скачать). Ошибка из запасного пути не глотается, а прокидывается
    // вызывающему коду (commit() ниже), чтобы он мог показать причину в
    // статусной строке слота.
    function fetchDocumentName(link, exportUrl){
      var docId = extractDocId(link);
      var mobilebasicAttempt = docId
        ? fetchNameFromMobilebasic(docId).catch(function(){ return null; })
        : Promise.resolve(null);

      return mobilebasicAttempt.then(function(name){
        if(name) return name;
        return fetch(exportUrl)
          .then(function(r){
            if(!r.ok) throw new Error("HTTP " + r.status);
            return r.arrayBuffer();
          })
          .then(function(buf){
            return MiniZip.extractDocxTitle(buf);
          });
      });
    }

    // Принимает любую ссылку на гугл-документ (обычную .../edit?...,
    // уже готовую .../export?format=docx, или просто ID документа) и
    // приводит её к виду .../export?format=docx. null, если не похоже
    // на ссылку/ID гугл-документа.
    function toExportUrl(raw){
      var docId = extractDocId(raw);
      return docId ? "https://docs.google.com/document/d/" + docId + "/export?format=docx" : null;
    }

    function displayLabel(idx, link, name){
      if(!link) return "Ссылка " + (idx + 1);
      if(name) return name;
      return link.length > 40 ? link.slice(0, 37) + "…" : link;
    }

    function setStatusLine(index, html){
      var el = document.getElementById("workbooksLinkStatus" + index);
      if(el) el.innerHTML = html;
    }

    function refreshDownloadBtn(){
      var btn = document.getElementById("workbooksDownloadBtn");
      if(!btn) return;
      btn.disabled = !lastXlsxBlob;
      btn.classList.toggle("ready", !!lastXlsxBlob);
    }

    function runFetchAll(links){
      var summaryEl = document.getElementById("workbooksRunSummary");
      var anyLink = links.some(function(l){ return l; });
      if(!anyLink){
        if(summaryEl) summaryEl.textContent = "Сначала укажи хотя бы одну ссылку.";
        return;
      }
      if(summaryEl) summaryEl.textContent = "Загружаю…";
      lastXlsxBlob = null;
      refreshDownloadBtn();

      var xmls = new Array(LINKS_COUNT).fill(null);
      var names = loadNames();

      var tasks = links.map(function(link, i){
        setStatusLine(i, "");
        if(!link) return Promise.resolve();

        var exportUrl = toExportUrl(link);
        if(!exportUrl){
          setStatusLine(i, '<span class="workbooks-status-err">Не похоже на ссылку гугл-документа</span>');
          return Promise.resolve();
        }

        setStatusLine(i, "Загружаю…");
        // Имя запрашиваем с mobilebasic-страницы параллельно с загрузкой
        // .docx для таблиц - не последовательно, чтобы не удваивать
        // задержку. Если mobilebasic не дал имени, ниже используется
        // dc:title из уже скачанного buf (без повторной загрузки).
        var docId = extractDocId(link);
        var namePromise = docId
          ? fetchNameFromMobilebasic(docId).catch(function(){ return null; })
          : Promise.resolve(null);

        return fetch(exportUrl)
          .then(function(response){
            if(!response.ok){
              setStatusLine(i, '<span class="workbooks-status-err">HTTP ' + response.status + '</span>');
              return;
            }
            return response.arrayBuffer().then(function(buf){
              return namePromise.then(function(mobileName){
                var titlePromise = mobileName ? Promise.resolve(mobileName) : MiniZip.extractDocxTitle(buf);
                return titlePromise.then(function(realName){
                  if(realName && realName !== names[i]){
                    names[i] = realName;
                    saveNames(names);
                    var textEl = document.getElementById("workbooksLinkText" + i);
                    if(textEl) textEl.textContent = realName;
                  }
                  return MiniZip.extractDocxDocumentXml(buf).then(function(xml){
                    xmls[i] = xml;
                    var tableCount = (xml.match(/<w:tbl>/g) || []).length;
                    var kb = Math.round(buf.byteLength / 1024);
                    setStatusLine(i, '<span class="workbooks-status-ok">' + kb + ' КБ, таблиц: ' + tableCount + '</span>');
                  });
                });
              });
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
            : "Ни один файл не обработался — проверь ссылки.";
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

    // Один слот: скрепка (переключает видимость поля ссылки) + статус
    // текст/поле ввода + строка результата разбора.
    function linkSlotHtml(idx, link, name){
      return '' +
        '<div class="workbooks-file-slot">' +
          '<div class="workbooks-file-slot-body">' +
            '<span id="workbooksLinkText' + idx + '" class="task-import-file-name">' +
              escapeHtml(displayLabel(idx, link, name)) +
            '</span>' +
            '<input type="text" id="workbooksLinkInput' + idx + '" class="workbooks-link-inline-input" ' +
              'style="display:none;" placeholder="Ссылка на документ" value="' + escapeHtml(link || "") + '">' +
            '<div id="workbooksLinkStatus' + idx + '" class="workbooks-link-status"></div>' +
          '</div>' +
          '<button type="button" class="task-import-attach-btn" id="workbooksAttachBtn' + idx + '" title="Ссылка на документ">' + PAPERCLIP_ICON_SVG + '</button>' +
        '</div>';
    }

    // Вкладка рисуется прямо в общую рабочую область окна настроек, как и
    // остальные вкладки (см. renderSettingsTabExtra/renderSettingsTabMood
    // в my.js/mood.js) — контейнер запрашиваем напрямую, без пробрасывания
    // через deps, тем же способом, что и в mood.js.
    function renderSettingsTabWorkbooks(){
      var container = document.getElementById("settingsTabContent");
      if(!container) return;

      var links = loadLinks();
      var names = loadNames();

      var slotsHtml = "";
      for(var i = 0; i < LINKS_COUNT; i++){
        slotsHtml += linkSlotHtml(i, links[i], names[i]);
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

      for(var j = 0; j < LINKS_COUNT; j++){
        (function(idx){
          var textEl = document.getElementById("workbooksLinkText" + idx);
          var input = document.getElementById("workbooksLinkInput" + idx);
          var attachBtn = document.getElementById("workbooksAttachBtn" + idx);

          attachBtn.addEventListener("click", function(){
            var showingInput = input.style.display !== "none";
            if(showingInput){
              input.style.display = "none";
              textEl.style.display = "";
            }else{
              textEl.style.display = "none";
              input.style.display = "";
              input.focus();
              input.select();
            }
          });

          function commit(){
            var newLink = input.value.trim();
            var linkChanged = newLink !== links[idx];
            links[idx] = newLink;
            saveLinks(links);
            if(linkChanged){
              names[idx] = ""; // старое имя больше не актуально для новой ссылки
              saveNames(names);
            }
            textEl.textContent = displayLabel(idx, links[idx], names[idx]);
            input.style.display = "none";
            textEl.style.display = "";

            var exportUrl = toExportUrl(links[idx]);
            if(linkChanged && exportUrl){
              setStatusLine(idx, "Загружаю имя…");
              fetchDocumentName(links[idx], exportUrl).then(function(realName){
                // ссылка могла ещё раз измениться, пока шёл запрос - применяем,
                // только если это всё ещё актуальная ссылка для этого слота
                if(links[idx] !== newLink) return;
                if(realName){
                  names[idx] = realName;
                  saveNames(names);
                  textEl.textContent = realName;
                  setStatusLine(idx, "");
                }else{
                  // не удалось получить имя ни через mobilebasic, ни через
                  // dc:title в docProps/core.xml (app.xml) экспортированного
                  // .docx - показываем это явно, а не молчим
                  setStatusLine(idx, '<span class="workbooks-status-err">Не удалось определить имя документа</span>');
                }
              }).catch(function(err){
                if(links[idx] !== newLink) return;
                setStatusLine(idx, '<span class="workbooks-status-err">Не удалось получить имя: ' +
                  escapeHtml(String(err && err.message || err)) + '</span>');
              });
            }
          }

          input.addEventListener("blur", commit);
          input.addEventListener("keydown", function(e){
            if(e.key === "Enter") input.blur();
          });
        })(j);
      }

      var runBtn = document.getElementById("workbooksRunBtn");
      if(runBtn) runBtn.addEventListener("click", function(){ runFetchAll(loadLinks()); });

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
