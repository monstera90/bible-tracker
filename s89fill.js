/* ===========================================================================
   s89fill.js
   Вкладка "Заполнение бланков S-89" (settingsTabSet2GearBtn2 / "set2b_2").
   Полностью в браузере: берёт подложку (шаблон-картинку) и .docx с
   графиком, разбирает его (S89Tasks - порт task-jpg-script.py, см.
   s89tasks.js) и для каждого подходящего задания рисует поверх подложки
   заполненный бланк (S89Draw - Canvas вместо Pillow, см. s89draw.js),
   после чего все получившиеся JPG скачиваются в Downloads.

   Подложка и документ сохраняются между перезапусками приложения - их
   содержимое (как base64) лежит в localStorage, чтобы не прикреплять
   заново каждый раз (см. persistFile/loadPersistedFile ниже).
   =========================================================================== */

window.initS89FillModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml || function(s){ return String(s); };
  var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG || "";

  var TEMPLATE_KEY = "s89TemplateFile";   // { name, dataUrl }
  var DOCUMENT_KEY = "s89SourceDocument"; // { name, dataUrl }
  var YEAR_KEY = "s89StartYear";
  var DEFAULT_START_YEAR = 2026;
  var FONT_URL = "DejaVuSans.ttf";

  var fontLoadPromise = null;

  // ---- сохранение/загрузка прикреплённых файлов между запусками ----

  function persistFile(key, file){
    return new Promise(function(resolve){
      var reader = new FileReader();
      reader.onload = function(){
        try{
          localStorage.setItem(key, JSON.stringify({ name: file.name, dataUrl: reader.result }));
        }catch(e){
          console.error("s89fill: не удалось сохранить файл в localStorage", e);
        }
        resolve();
      };
      reader.onerror = function(){ resolve(); };
      reader.readAsDataURL(file);
    });
  }

  function loadPersisted(key){
    try{
      var raw = localStorage.getItem(key);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){
      return null;
    }
  }

  function dataUrlToBlob(dataUrl){
    return fetch(dataUrl).then(function(r){ return r.blob(); });
  }

  function loadStartYear(){
    try{
      var raw = localStorage.getItem(YEAR_KEY);
      var n = raw ? parseInt(raw, 10) : NaN;
      return isFinite(n) && n > 2000 ? n : DEFAULT_START_YEAR;
    }catch(e){
      return DEFAULT_START_YEAR;
    }
  }

  function saveStartYear(year){
    try{ localStorage.setItem(YEAR_KEY, String(year)); }catch(e){}
  }

  // ---- вкладка ----

  function renderSettingsTabS89Fill(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var persistedTemplate = loadPersisted(TEMPLATE_KEY);
    var persistedDocument = loadPersisted(DOCUMENT_KEY);
    var startYear = loadStartYear();

    // Текущее состояние вкладки - файлы (persisted или только что выбранные)
    // и результат последнего запуска.
    var templateInfo = persistedTemplate; // { name, dataUrl } | null
    var documentInfo = persistedDocument; // { name, dataUrl } | null
    var generatedFiles = null; // [{ name, blob }] | null

    container.innerHTML =
      '<div class="settings-content-bottom">' +
        '<h3 class="workbooks-title">Заполнение бланков S-89</h3>' +
        '<p style="opacity:.7;font-size:.9em;margin-top:2px;">Прикрепите подложку-бланк (картинку) и документ с графиком (.docx) — для каждого подходящего задания будет создан отдельный заполненный бланк.</p>' +
        '<div class="s89-year-row">' +
          '<label for="s89YearInput">Год начала отсчёта:</label>' +
          '<input type="number" id="s89YearInput" class="s89-year-input" value="' + startYear + '">' +
        '</div>' +
        '<div class="workbooks-files-grid">' +
          '<div class="workbooks-file-slot">' +
            '<div class="workbooks-file-slot-body">' +
              '<span id="s89TemplateStatus" class="task-import-file-name">' +
                (templateInfo ? escapeHtml(templateInfo.name) : "Файл не выбран") +
              '</span>' +
            '</div>' +
            '<button type="button" class="task-import-attach-btn" id="s89TemplateAttachBtn" title="Выбрать подложку">' + PAPERCLIP_ICON_SVG + '</button>' +
            '<input type="file" id="s89TemplateInput" style="display:none;">' +
          '</div>' +
          '<div class="workbooks-file-slot">' +
            '<div class="workbooks-file-slot-body">' +
              '<span id="s89DocumentStatus" class="task-import-file-name">' +
                (documentInfo ? escapeHtml(documentInfo.name) : "Файл не выбран") +
              '</span>' +
            '</div>' +
            '<button type="button" class="task-import-attach-btn" id="s89DocumentAttachBtn" title="Выбрать документ">' + PAPERCLIP_ICON_SVG + '</button>' +
            '<input type="file" accept=".docx" id="s89DocumentInput" style="display:none;">' +
          '</div>' +
        '</div>' +
        '<div class="workbooks-actions-row">' +
          '<button type="button" id="s89StartBtn" class="workbooks-run-btn"' + (templateInfo && documentInfo ? '' : ' disabled') + '>Начать</button>' +
          '<button type="button" id="s89DownloadBtn" class="workbooks-result-btn workbooks-download-btn" disabled>Скачать</button>' +
        '</div>' +
        '<div id="s89Log" class="workbooks-run-summary"></div>' +
      '</div>';

    var templateStatusEl = document.getElementById("s89TemplateStatus");
    var documentStatusEl = document.getElementById("s89DocumentStatus");
    var logEl = document.getElementById("s89Log");
    var startBtn = document.getElementById("s89StartBtn");
    var downloadBtn = document.getElementById("s89DownloadBtn");
    var yearInput = document.getElementById("s89YearInput");

    yearInput.addEventListener("change", function(){
      var n = parseInt(yearInput.value, 10);
      if(isFinite(n) && n > 2000){
        startYear = n;
        saveStartYear(n);
      }
    });

    function refreshStartEnabled(){
      startBtn.disabled = !(templateInfo && documentInfo);
    }

    function log(text){
      if(logEl) logEl.textContent = text;
    }

    document.getElementById("s89TemplateAttachBtn").addEventListener("click", function(){
      document.getElementById("s89TemplateInput").click();
    });
    document.getElementById("s89TemplateInput").addEventListener("change", function(e){
      var f = e.target.files && e.target.files[0];
      if(!f) return;
      templateStatusEl.textContent = "Проверяю…";
      S89Draw.loadImage(f).then(function(){
        templateStatusEl.textContent = f.name;
        return persistFile(TEMPLATE_KEY, f);
      }).then(function(){
        templateInfo = loadPersisted(TEMPLATE_KEY);
        refreshStartEnabled();
      }).catch(function(){
        templateStatusEl.textContent = "Это не изображение — выбери другой файл";
      });
    });

    document.getElementById("s89DocumentAttachBtn").addEventListener("click", function(){
      document.getElementById("s89DocumentInput").click();
    });
    document.getElementById("s89DocumentInput").addEventListener("change", function(e){
      var f = e.target.files && e.target.files[0];
      if(!f) return;
      documentStatusEl.textContent = f.name;
      persistFile(DOCUMENT_KEY, f).then(function(){
        documentInfo = loadPersisted(DOCUMENT_KEY);
        refreshStartEnabled();
      });
    });

    startBtn.addEventListener("click", function(){
      if(!templateInfo || !documentInfo) return;
      startBtn.disabled = true;
      downloadBtn.disabled = true;
      downloadBtn.classList.remove("ready");
      generatedFiles = null;
      log("Читаю документ…");

      if(!fontLoadPromise){
        fontLoadPromise = S89Draw.loadFont(FONT_URL);
      }

      Promise.all([
        dataUrlToBlob(documentInfo.dataUrl).then(function(blob){ return blob.arrayBuffer(); }),
        dataUrlToBlob(templateInfo.dataUrl).then(function(blob){ return S89Draw.loadImage(blob); }),
        fontLoadPromise,
      ]).then(function(results){
        var docBuf = results[0];
        var templateImage = results[1];

        return MiniZip.extractDocxDocumentXml(docBuf).then(function(xml){
          log("Разбираю задания…");
          var tasks = S89Tasks.buildTasks([xml], startYear);

          if(!tasks.length){
            log("В документе не нашлось подходящих заданий.");
            startBtn.disabled = false;
            return;
          }

          var results2 = [];
          var i = 0;
          var sharedCanvas = S89Draw.createCanvasForImage(templateImage);
          var batchStart = performance.now();
          var drawTotalMs = 0;
          var encodeTotalMs = 0;

          function renderNext(){
            if(i >= tasks.length){
              generatedFiles = results2;
              var totalMs = performance.now() - batchStart;
              var perImage = tasks.length ? totalMs / tasks.length : 0;
              log(
                "Готово: заполнено бланков - " + results2.length + " за " +
                (totalMs / 1000).toFixed(1) + " с (в среднем " + perImage.toFixed(0) +
                " мс/бланк; рисование " + (drawTotalMs / tasks.length).toFixed(0) +
                " мс, сохранение в PNG " + (encodeTotalMs / tasks.length).toFixed(0) + " мс)."
              );
              downloadBtn.disabled = false;
              downloadBtn.classList.add("ready");
              startBtn.disabled = false;
              return;
            }
            var task = tasks[i];
            log("Рисую " + (i + 1) + " из " + tasks.length + "…");
            S89Draw.renderTaskImage(task, templateImage, sharedCanvas, function(timing){
              drawTotalMs += timing.drawMs;
              encodeTotalMs += timing.encodeMs;
            }).then(function(blob){
              var studentPart = S89Draw.sanitizeFilename(task.student).replace(/\s+/g, "_");
              var filename = task.date + "_" + studentPart + "_" + task.itemNumber + ".png";
              results2.push({ name: filename, blob: blob });
              i++;
              renderNext();
            }).catch(function(err){
              console.error("s89fill: ошибка отрисовки задания", task, err);
              i++;
              renderNext();
            });
          }
          renderNext();
        });
      }).catch(function(err){
        console.error("s89fill:", err);
        log("Ошибка: " + (err && err.message ? err.message : String(err)));
        startBtn.disabled = false;
      });
    });

    downloadBtn.addEventListener("click", function(){
      if(!generatedFiles || !generatedFiles.length) return;
      var i = 0;
      function downloadNext(){
        if(i >= generatedFiles.length) return;
        var item = generatedFiles[i];
        var url = URL.createObjectURL(item.blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 10000);
        i++;
        setTimeout(downloadNext, 150);
      }
      downloadNext();
    });
  }

  return {
    renderSettingsTabS89Fill: renderSettingsTabS89Fill
  };
};
