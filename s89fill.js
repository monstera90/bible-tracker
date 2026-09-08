/* ===========================================================================
   s89fill.js
   Вкладка "Заполнение бланков S-89" (settingsTabSet2GearBtn2 / "set2b_2").
   Полностью в браузере: берёт подложку (шаблон-картинку, локальный файл)
   и ссылку на гугл-документ с графиком, разбирает его (S89Tasks - порт
   task-jpg-script.py, см. s89tasks.js) и для каждого подходящего задания
   рисует поверх подложки заполненный бланк (S89Draw - Canvas вместо
   Pillow, см. s89draw.js), после чего все получившиеся PNG скачиваются
   в Downloads.

   Подложка (картинка) прикрепляется локальным файлом - её содержимое (как
   base64 data:URL) лежит в localStorage, как и раньше (быстрый локальный
   рендер, работает офлайн), НО с 08.09 она же хранится в облаке — том же
   коде синхронизации, что и остальные данные приложения (state, заметки):
   если синхронизация настроена (deps.getSyncId() возвращает код), при
   каждом открытии вкладки подложка сверяется с облаком по метке времени
   (см. reconcileTemplateWithCloud) и после выбора нового файла скрепкой -
   отправляется туда (см. pushTemplateToCloud). Firebase Realtime Database
   не различает типы файлов - это просто JSON-дерево, картинка хранится
   строкой, как и текст заметок. Если синхронизация не настроена - подложка
   остаётся только локальной, как раньше. Документ - это ссылка на
   гугл-документ (как на первой вкладке, workbooks.js): скрепка не
   открывает выбор файла, а раскрывает поле для ввода ссылки; ссылка
   хранится только локально (localStorage), в облако не идёт.
   =========================================================================== */

window.initS89FillModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml || function(s){ return String(s); };
  var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG || "";
  // Облачное хранение подложки - необязательные deps (см. комментарий в
  // шапке файла и точку входа S89Fill в my.js). Если не переданы (или
  // синхронизация не настроена - getSyncId() вернёт пусто), весь код ниже
  // просто не пытается ходить в облако, подложка работает как раньше.
  var getSyncId = deps.getSyncId || function(){ return null; };
  var fetchCloudPath = deps.fetchCloudPath || function(){ return Promise.reject(new Error("no_cloud")); };
  var patchCloud = deps.patchCloud || function(){ return Promise.reject(new Error("no_cloud")); };
  var TEMPLATE_CLOUD_PATH = "s89Template";

  var TEMPLATE_KEY = "s89TemplateFile";   // { name, dataUrl }
  var DOCUMENT_LINK_KEY = "s89DocumentLink"; // строка-ссылка
  var DOCUMENT_NAME_KEY = "s89DocumentName"; // имя файла из docProps/core.xml документа, кэш
  var YEAR_KEY = "s89StartYear";
  var DEFAULT_START_YEAR = 2026;
  var FONT_URL = "DejaVuSans.ttf";

  var fontLoadPromise = null;

  // ---- сохранение/загрузка подложки (локальный файл + облако) ----

  function persistFile(key, file){
    return new Promise(function(resolve){
      var reader = new FileReader();
      reader.onload = function(){
        var info = { name: file.name, dataUrl: reader.result, t: Date.now() };
        try{
          localStorage.setItem(key, JSON.stringify(info));
        }catch(e){
          console.error("s89fill: не удалось сохранить файл в localStorage", e);
        }
        resolve(info);
      };
      reader.onerror = function(){ resolve(null); };
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

  function saveTemplateLocally(info){
    try{ localStorage.setItem(TEMPLATE_KEY, JSON.stringify(info)); }catch(e){}
  }

  function dataUrlToBlob(dataUrl){
    return fetch(dataUrl).then(function(r){ return r.blob(); });
  }

  // Отправка подложки в облако - вызывается сразу после явного выбора
  // нового файла скрепкой (см. обработчик s89TemplateInput ниже). Молча
  // проглатывает ошибки (нет сети, синхронизация не настроена) - подложка
  // в любом случае уже сохранена локально, отправка в облако лучше-чем-
  // ничего, а не обязательное условие работы вкладки.
  function pushTemplateToCloud(info){
    if(!getSyncId() || !info) return Promise.resolve();
    var payload = {};
    payload[TEMPLATE_CLOUD_PATH] = info;
    return patchCloud(payload).catch(function(e){
      console.error("s89fill: не удалось отправить подложку в облако", e);
    });
  }

  // Сверка локальной подложки с облачной - вызывается при каждом открытии
  // вкладки (тот же приём, что syncNotesOnTabEnter у "Моего блокнота",
  // см. mdeditor.js): побеждает версия с более поздней меткой времени.
  // Если облако пусто, а локальная подложка уже есть - значит её ещё ни
  // разу не отправляли (добавлена до включения синхронизации либо на
  // устройстве, где облачная запись потерялась) - отправляем её.
  function reconcileTemplateWithCloud(localInfo, onCloudNewer){
    if(!getSyncId()) return;
    fetchCloudPath(TEMPLATE_CLOUD_PATH).then(function(cloudInfo){
      var localT = (localInfo && localInfo.t) || 0;
      var cloudT = (cloudInfo && cloudInfo.t) || 0;
      if(cloudInfo && cloudT > localT){
        saveTemplateLocally(cloudInfo);
        onCloudNewer(cloudInfo);
      }else if(localInfo && localT > cloudT){
        pushTemplateToCloud(localInfo);
      }
    }).catch(function(e){
      console.error("s89fill: не удалось сверить подложку с облаком", e);
    });
  }

  // ---- ссылка на документ ----

  function loadDocumentLink(){
    try{ return localStorage.getItem(DOCUMENT_LINK_KEY) || ""; }catch(e){ return ""; }
  }

  function saveDocumentLink(link){
    try{ localStorage.setItem(DOCUMENT_LINK_KEY, link); }catch(e){}
  }

  function loadDocumentName(){
    try{ return localStorage.getItem(DOCUMENT_NAME_KEY) || ""; }catch(e){ return ""; }
  }

  function saveDocumentName(name){
    try{ localStorage.setItem(DOCUMENT_NAME_KEY, name); }catch(e){}
  }

  // Тот же приём, что и в workbooks.js: обычная ссылка .../edit?...,
  // готовая .../export?format=docx, или просто ID документа - достаём ID.
  function extractDocId(raw){
    var s = (raw || "").trim();
    if(!s) return null;
    var m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if(m) return m[1];
    if(/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return null;
  }

  function toExportUrl(raw){
    var docId = extractDocId(raw);
    return docId ? "https://docs.google.com/document/d/" + docId + "/export?format=docx" : null;
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

  // Основной источник имени - mobilebasic-страница (см. выше), с откатом
  // на старый способ (dc:title в docProps/core.xml экспортированного
  // .docx), если mobilebasic недоступна или пуста.
  function fetchDocumentName(link, exportUrl){
    var docId = extractDocId(link);
    var mobilebasicAttempt = docId
      ? fetchNameFromMobilebasic(docId).catch(function(){ return null; })
      : Promise.resolve(null);

    return mobilebasicAttempt.then(function(name){
      if(name) return name;
      return fetch(exportUrl)
        .then(function(r){
          if(!r.ok) return null;
          return r.arrayBuffer().then(function(buf){
            return MiniZip.extractDocxTitle(buf);
          });
        })
        .catch(function(){ return null; });
    });
  }

  function displayLabel(link, name){
    if(!link) return "Ссылка";
    if(name) return name;
    return link.length > 40 ? link.slice(0, 37) + "…" : link;
  }

  // ---- год начала отсчёта ----

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

    var templateInfo = loadPersisted(TEMPLATE_KEY); // { name, dataUrl } | null
    var documentLink = loadDocumentLink(); // строка
    var documentName = loadDocumentName(); // строка (кэш, может быть пустой)
    var startYear = loadStartYear();
    var generatedFiles = null; // [{ name, blob }] | null

    container.innerHTML =
      '<div class="settings-content-bottom s89fill-tab">' +
        '<h3 class="common-tab-title">Заполнение бланков S-89</h3>' +
        '<p style="opacity:.7;font-family:\'Palatino Linotype\',Georgia,serif;font-size:var(--mdeditor-font-size, 15.5px);margin-top:2px;">Прикрепите подложку-бланк (картинку) и ссылку на гугл-документ с графиком — для каждого подходящего задания будет создан отдельный заполненный бланк.</p>' +
        '<div class="s89-year-row">' +
          '<label for="s89YearInput">Год начала отсчёта:</label>' +
          '<input type="number" id="s89YearInput" class="s89-year-input" value="' + startYear + '">' +
        '</div>' +
        '<div id="s89Log" class="workbooks-run-summary"></div>' +
        '<div class="workbooks-files-grid">' +
          '<div class="workbooks-file-slot">' +
            '<div class="workbooks-file-slot-body">' +
              '<span id="s89TemplateStatus" class="task-import-file-name">' +
                (templateInfo ? escapeHtml(templateInfo.name) : "Файл не выбран") +
              '</span>' +
            '</div>' +
            '<button type="button" class="mdeditor-fab-btn" id="s89TemplateAttachBtn" title="Выбрать подложку">' + PAPERCLIP_ICON_SVG + '</button>' +
            '<input type="file" id="s89TemplateInput" style="display:none;">' +
          '</div>' +
          '<div class="workbooks-file-slot">' +
            '<div class="workbooks-file-slot-body">' +
              '<span id="s89DocumentText" class="task-import-file-name">' + escapeHtml(displayLabel(documentLink, documentName)) + '</span>' +
              '<input type="text" id="s89DocumentInput" class="workbooks-link-inline-input" ' +
                'style="display:none;" placeholder="Ссылка на документ" value="' + escapeHtml(documentLink) + '">' +
            '</div>' +
            '<button type="button" class="mdeditor-fab-btn" id="s89DocumentAttachBtn" title="Ссылка на документ">' + PAPERCLIP_ICON_SVG + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="workbooks-actions-row">' +
          '<button type="button" id="s89StartBtn" class="workbooks-run-btn"' + (templateInfo && documentLink ? '' : ' disabled') + '>Начать</button>' +
          '<button type="button" id="s89DownloadBtn" class="workbooks-result-btn workbooks-download-btn" disabled>Скачать</button>' +
        '</div>' +
      '</div>';

    var templateStatusEl = document.getElementById("s89TemplateStatus");
    var documentTextEl = document.getElementById("s89DocumentText");
    var documentInputEl = document.getElementById("s89DocumentInput");
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
      startBtn.disabled = !(templateInfo && documentLink);
    }

    // Сверка с облаком - если на другом устройстве подложку меняли позже,
    // подхватываем её здесь (см. reconcileTemplateWithCloud выше); если
    // же облако не в курсе локальной подложки - тихо отправляем её туда.
    // Пользователь мог уже уйти со вкладки к моменту ответа - на этот
    // случай элементы вкладки проверяются на присутствие в DOM.
    reconcileTemplateWithCloud(templateInfo, function(cloudInfo){
      templateInfo = cloudInfo;
      if(document.getElementById("s89TemplateStatus") === templateStatusEl){
        templateStatusEl.textContent = cloudInfo.name;
        refreshStartEnabled();
      }
    });

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
      }).then(function(info){
        templateInfo = info;
        refreshStartEnabled();
        // Явный выбор скрепкой - отправляем в облако сразу, не дожидаясь
        // следующего открытия вкладки.
        pushTemplateToCloud(info);
      }).catch(function(){
        templateStatusEl.textContent = "Это не изображение — выбери другой файл";
      });
    });

    document.getElementById("s89DocumentAttachBtn").addEventListener("click", function(){
      var showingInput = documentInputEl.style.display !== "none";
      if(showingInput){
        documentInputEl.style.display = "none";
        documentTextEl.style.display = "";
      }else{
        documentTextEl.style.display = "none";
        documentInputEl.style.display = "";
        documentInputEl.focus();
        documentInputEl.select();
      }
    });

    function commitDocumentLink(){
      var newLink = documentInputEl.value.trim();
      var linkChanged = newLink !== documentLink;
      documentLink = newLink;
      saveDocumentLink(documentLink);
      if(linkChanged){
        documentName = "";
        saveDocumentName("");
      }
      documentTextEl.textContent = displayLabel(documentLink, documentName);
      documentInputEl.style.display = "none";
      documentTextEl.style.display = "";
      refreshStartEnabled();

      var exportUrl = toExportUrl(documentLink);
      if(linkChanged && exportUrl){
        fetchDocumentName(documentLink, exportUrl).then(function(realName){
          if(realName && documentLink === newLink){
            documentName = realName;
            saveDocumentName(realName);
            documentTextEl.textContent = realName;
          }
        });
      }
    }
    documentInputEl.addEventListener("blur", commitDocumentLink);
    documentInputEl.addEventListener("keydown", function(e){
      if(e.key === "Enter") documentInputEl.blur();
    });

    startBtn.addEventListener("click", function(){
      if(!templateInfo || !documentLink) return;
      var exportUrl = toExportUrl(documentLink);
      if(!exportUrl){
        log("Не похоже на ссылку гугл-документа.");
        return;
      }

      startBtn.disabled = true;
      downloadBtn.disabled = true;
      downloadBtn.classList.remove("ready");
      generatedFiles = null;
      log("Загружаю документ…");

      if(!fontLoadPromise){
        fontLoadPromise = S89Draw.loadFont(FONT_URL);
      }

      // Имя запрашиваем с mobilebasic-страницы параллельно с загрузкой
      // .docx - если она не даст имени, ниже используется dc:title из уже
      // скачанного buf (без повторной загрузки).
      var docIdForName = extractDocId(documentLink);
      var namePromise = docIdForName
        ? fetchNameFromMobilebasic(docIdForName).catch(function(){ return null; })
        : Promise.resolve(null);

      Promise.all([
        fetch(exportUrl).then(function(r){
          if(!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        }).then(function(buf){
          return namePromise.then(function(mobileName){
            return (mobileName ? Promise.resolve(mobileName) : MiniZip.extractDocxTitle(buf));
          }).then(function(realName){
            if(realName && realName !== documentName){
              documentName = realName;
              saveDocumentName(realName);
              documentTextEl.textContent = realName;
            }
            return buf;
          });
        }),
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
