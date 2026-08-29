/* ===========================================================================
   imgresize.js
   Вкладка "Изменение размера изображения" (шестая боковая вкладка второго
   набора, settingsTabSet2Btn6 / "set2s_6"). Полностью в браузере (без
   сервера): пользователь прикрепляет .jpg/.png, задаёт нужную ширину и
   высоту в пикселях — картинка перерисовывается на Canvas и скачивается
   уже нужного размера (типовой случай — сделать из иконки 512×512 иконку
   меньшего размера). Вынесена в отдельный файл по тому же образцу, что и
   Workbooks/JwlMerge/EpubSplit (см. my.js).

   Ключевое решение по поводу растягивания пикселей (см. также
   renderSettingsTabImgResize ниже): пиксели НИКОГДА не растягиваются —
   масштаб по обеим осям всегда одинаковый. Разница только в том, что
   происходит, если соотношение сторон исходника не совпадает с заданным
   ширина×высота:
   - галочка "Сохранять пропорции" включена (по умолчанию) — картинка
     вписывается в рамку целиком (масштаб = МЕНЬШИЙ из двух возможных
     коэффициентов), лишнее место по краям остаётся пустым (прозрачным у
     png, белым у jpg — как то же самое, что называют object-fit:contain);
   - галочка выключена (надпись меняется на "Изображение будет обрезано") —
     рамка заполняется целиком (масштаб = БОЛЬШИЙ из двух коэффициентов), а
     то, что не поместилось, обрезается ровно по центру (object-fit:cover).

   Поля "Ширина"/"Высота" синхронизированы друг с другом ровно в том же
   режиме, что и определяет галочка выше: пока "Сохранять пропорции"
   включена, ввод в одно поле сам пересчитывает другое по соотношению
   сторон ИМЕННО загруженной картинки (см. widthInput/heightInput "input"
   в renderSettingsTabImgResize) — так пара чисел в полях всегда остаётся
   валидной парой пропорций, а не просто двумя независимо введёнными
   числами. Когда галочка выключена, поля отвязаны друг от друга — в
   режиме обрезки это и есть смысл: ширина и высота могут не совпадать по
   пропорциям с исходником.
   =========================================================================== */

window.initImgResizeModule = function(deps){
  "use strict";
  var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG;

  // ---- сохранение результата на диск, тот же приём, что и в downloadFile
  // из jwlmerge.js/epubsplit.js (эти модули не делятся кодом друг с
  // другом, у каждого своя маленькая копия) ----
  function downloadFile(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  // "photo.jpg" -> "photo" (без точки — как есть, без изменений)
  function baseNameWithoutExt(name){
    var idx = name.lastIndexOf(".");
    return idx > 0 ? name.slice(0, idx) : name;
  }

  function isJpegFile(file){
    return /^image\/jpeg$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
  }
  function isPngFile(file){
    return /^image\/png$/i.test(file.type) || /\.png$/i.test(file.name);
  }

  function renderSettingsTabImgResize(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var selectedFile = null;     // выбранный File
    var sourceImg = null;        // загруженный Image() с этим файлом
    var sourceObjectUrl = null;  // его blob-URL — освобождаем при смене файла
    var resultBlob = null;
    var resultName = "";

    container.innerHTML =
      '<div class="settings-content-bottom imgresize-tab">' +
        '<h3 class="workbooks-title">Изменение размера изображения</h3>' +
        '<p class="subtitle-extract-hint">Прикрепите изображение (.jpg или .png), задайте нужные ширину и высоту в пикселях и нажмите «Начать».</p>' +
        '<div class="subtitle-file-row">' +
          '<span id="imgResizeFileStatus" class="subtitle-file-status">Файл не загружен</span>' +
          '<button type="button" class="task-import-attach-btn" id="imgResizeAttachBtn" title="Прикрепить файл">' + PAPERCLIP_ICON_SVG + '</button>' +
        '</div>' +
        '<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" id="imgResizeFileInput" style="display:none;">' +
        '<div class="settings-row">' +
          '<span>Ширина:</span>' +
          '<input type="number" min="1" step="1" inputmode="numeric" id="imgResizeWidthInput" class="imgresize-dim-input" placeholder="px">' +
        '</div>' +
        '<div class="settings-row">' +
          '<span>Высота:</span>' +
          '<input type="number" min="1" step="1" inputmode="numeric" id="imgResizeHeightInput" class="imgresize-dim-input" placeholder="px">' +
        '</div>' +
        '<div class="settings-row">' +
          '<span id="imgResizeAspectLabel">Сохранять пропорции</span>' +
          '<input type="checkbox" id="imgResizeAspectCb" checked>' +
        '</div>' +
        '<div class="workbooks-actions-row">' +
          '<button class="workbooks-run-btn" id="imgResizeStartBtn" disabled>Начать</button>' +
          '<button class="workbooks-result-btn workbooks-download-btn" id="imgResizeSaveBtn" disabled>Скачать</button>' +
        '</div>' +
      '</div>';

    var fileInput = document.getElementById("imgResizeFileInput");
    var fileStatusEl = document.getElementById("imgResizeFileStatus");
    var widthInput = document.getElementById("imgResizeWidthInput");
    var heightInput = document.getElementById("imgResizeHeightInput");
    var aspectCb = document.getElementById("imgResizeAspectCb");
    var aspectLabel = document.getElementById("imgResizeAspectLabel");
    var startBtn = document.getElementById("imgResizeStartBtn");
    var saveBtn = document.getElementById("imgResizeSaveBtn");

    // Строка слева от скрепки играет те же две роли, что и в
    // renderSettingsTabSubtitleExtract — имя файла ДО запуска, статус
    // операции ПОСЛЕ.
    function setFileStatus(text, kind){
      fileStatusEl.textContent = text || "";
      fileStatusEl.classList.remove("success", "error");
      if(kind) fileStatusEl.classList.add(kind);
    }

    function refreshAspectLabel(){
      aspectLabel.textContent = aspectCb.checked ? "Сохранять пропорции" : "Изображение будет обрезано";
    }
    aspectCb.addEventListener("change", refreshAspectLabel);

    function refreshStartEnabled(){
      var w = parseInt(widthInput.value, 10);
      var h = parseInt(heightInput.value, 10);
      startBtn.disabled = !(selectedFile && sourceImg && w > 0 && h > 0);
    }
    // Поля Ширина/Высота считаются связанными, ПОКА включена галочка
    // "Сохранять пропорции": меняешь одно — второе пересчитывается само,
    // чтобы соотношение сторон всегда совпадало с исходной картинкой (и
    // на канвасе никогда не пришлось бы растягивать пиксели). Соотношение
    // на каждый пересчёт берётся заново от sourceImg.naturalWidth/Height
    // (а не от уже округлённого числа в соседнем поле), чтобы округление
    // не накапливалось при многократном наборе. Если галочка выключена
    // ("Изображение будет обрезано") — поля независимы: в этом режиме
    // нужный необязательно пропорциональный размер как раз и получают
    // обрезкой кадра, см. startBtn ниже.
    widthInput.addEventListener("input", function(){
      if(aspectCb.checked && sourceImg){
        var w = parseInt(widthInput.value, 10);
        if(w > 0) heightInput.value = Math.max(1, Math.round(w * sourceImg.naturalHeight / sourceImg.naturalWidth));
      }
      refreshStartEnabled();
    });
    heightInput.addEventListener("input", function(){
      if(aspectCb.checked && sourceImg){
        var h = parseInt(heightInput.value, 10);
        if(h > 0) widthInput.value = Math.max(1, Math.round(h * sourceImg.naturalWidth / sourceImg.naturalHeight));
      }
      refreshStartEnabled();
    });

    function refreshSaveEnabled(){
      saveBtn.disabled = !resultBlob;
      saveBtn.classList.toggle("ready", !!resultBlob);
    }

    function resetResult(){
      resultBlob = null;
      resultName = "";
      refreshSaveEnabled();
    }

    document.getElementById("imgResizeAttachBtn").addEventListener("click", function(){
      fileInput.click();
    });

    fileInput.addEventListener("change", function(){
      var f = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      resetResult();
      sourceImg = null;
      if(sourceObjectUrl){ URL.revokeObjectURL(sourceObjectUrl); sourceObjectUrl = null; }

      if(!f){
        selectedFile = null;
        setFileStatus("Файл не загружен");
        refreshStartEnabled();
        return;
      }
      if(!isJpegFile(f) && !isPngFile(f)){
        selectedFile = null;
        setFileStatus("Нужен файл в формате JPG или PNG.", "error");
        refreshStartEnabled();
        return;
      }

      selectedFile = f;
      setFileStatus("Загружаем «" + f.name + "»…");
      sourceObjectUrl = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function(){
        sourceImg = img;
        var ratio = img.naturalWidth / img.naturalHeight;
        if(!widthInput.value && !heightInput.value){
          // ни одно поле ещё не тронуто — подставляем точный размер
          // исходника целиком (типовой случай — уменьшить иконку 512×512)
          widthInput.value = img.naturalWidth;
          heightInput.value = img.naturalHeight;
        } else if(aspectCb.checked){
          // одно из полей уже что-то содержит (файл прикрепили после
          // того, как начали вводить размер), а галочка требует держать
          // пропорции — досчитываем недостающее по соотношению сторон
          // ИМЕННО ЭТОЙ картинки, отталкиваясь от того, что уже ввёл
          // человек (см. также widthInput/heightInput "input" ниже —
          // та же логика применяется и при дальнейшем наборе)
          if(widthInput.value){
            var w0 = parseInt(widthInput.value, 10);
            if(w0 > 0) heightInput.value = Math.max(1, Math.round(w0 / ratio));
          } else if(heightInput.value){
            var h0 = parseInt(heightInput.value, 10);
            if(h0 > 0) widthInput.value = Math.max(1, Math.round(h0 * ratio));
          }
        }
        setFileStatus(f.name + " (" + img.naturalWidth + "×" + img.naturalHeight + " px)");
        refreshStartEnabled();
      };
      img.onerror = function(){
        selectedFile = null;
        sourceImg = null;
        setFileStatus("Не удалось прочитать изображение.", "error");
        refreshStartEnabled();
      };
      img.src = sourceObjectUrl;
    });

    startBtn.addEventListener("click", function(){
      if(!sourceImg || !selectedFile) return;
      var targetW = parseInt(widthInput.value, 10);
      var targetH = parseInt(heightInput.value, 10);
      if(!(targetW > 0) || !(targetH > 0)) return;

      var srcW = sourceImg.naturalWidth, srcH = sourceImg.naturalHeight;
      var canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      var ctx = canvas.getContext("2d");

      var jpegOut = isJpegFile(selectedFile);
      if(jpegOut){
        // у jpeg нет альфа-канала — если при "сохранять пропорции"
        // останутся пустые поля по краям, подкладываем под них белый фон,
        // а не чёрный фон canvas по умолчанию
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
      }

      if(aspectCb.checked){
        // "Сохранять пропорции" — вписываем картинку целиком, без
        // искажений (масштаб один и тот же по обеим осям — берём МЕНЬШИЙ
        // из двух коэффициентов), лишнее место по краям остаётся пустым
        var scaleFit = Math.min(targetW / srcW, targetH / srcH);
        var fitW = srcW * scaleFit, fitH = srcH * scaleFit;
        ctx.drawImage(sourceImg, (targetW - fitW) / 2, (targetH - fitH) / 2, fitW, fitH);
      } else {
        // "Изображение будет обрезано" — пиксели не растягиваются, но
        // рамка заполняется целиком: берём БОЛЬШИЙ из двух коэффициентов,
        // а то, что вышло за края, обрезается ровно по центру
        var scaleCover = Math.max(targetW / srcW, targetH / srcH);
        var coverW = srcW * scaleCover, coverH = srcH * scaleCover;
        ctx.drawImage(sourceImg, (targetW - coverW) / 2, (targetH - coverH) / 2, coverW, coverH);
      }

      var mime = jpegOut ? "image/jpeg" : "image/png";
      var ext = jpegOut ? ".jpg" : ".png";
      canvas.toBlob(function(blob){
        if(!blob){
          setFileStatus("Не удалось собрать результат.", "error");
          return;
        }
        resultBlob = blob;
        resultName = baseNameWithoutExt(selectedFile.name) + "_" + targetW + "x" + targetH + ext;
        setFileStatus("Готово: " + targetW + "×" + targetH + " px.", "success");
        refreshSaveEnabled();
      }, mime, 0.92);
    });

    saveBtn.addEventListener("click", function(){
      if(resultBlob) downloadFile(resultBlob, resultName);
    });
  }

  return {
    renderSettingsTabImgResize: renderSettingsTabImgResize
  };
};
