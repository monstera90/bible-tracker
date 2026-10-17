/* ===========================================================================
   cardscan.js
   Версия: 1.0 (16.10)
   Сканер QR-кодов карточек предметов (ТЗ TASK_ITEM_CARDS_QR.md, шаг 3): отдельный
   полноэкранный слой — видео с задней камеры, рамка-прицел, кнопка «Назад» и строка
   подсказки для ошибок. Больше ничего (решение заказчика, часть 8–9). Сканеры
   синхронизации в my.js (renderScanScreen / renderGroupScanScreen) не затрагиваются.

   Используется в двух местах:
   - вкладка 9 внутри приложения (itemcards.js → openScan);
   - отдельная страница scan.html, которую открывает ScanActivity по ярлыку
     «Сканировать QR-код» (камера и разбор те же).

   window.CardScan = { parseCode(text), open(opts) }
   =========================================================================== */
window.CardScan = (function(){
  "use strict";

  var QR_PREFIX = "lt://v1/card/";

  // Разбор текста из QR:
  //   {kind:"card", id}   — код карточки приложения (lt://v1/card/<id>)
  //   {kind:"unknown", text} — наша схема lt://, но другая версия/вид (не выполняется)
  //   {kind:"url", url}   — обычная ссылка http(s)
  //   {kind:"text", text} — всё остальное
  function parseCode(text){
    var t = String(text == null ? "" : text).replace(/^\s+|\s+$/g, "");
    if(t.indexOf(QR_PREFIX) === 0){
      var id = t.slice(QR_PREFIX.length);
      if(/^[A-Za-z0-9]{4,32}$/.test(id)) return { kind: "card", id: id };
      return { kind: "unknown", text: t };
    }
    if(/^lt:\/\//i.test(t)) return { kind: "unknown", text: t };
    if(/^https?:\/\/\S+$/i.test(t)) return { kind: "url", url: t };
    return { kind: "text", text: t };
  }

  // open({ loadJsqr: () => Promise, onCode(text), onBack() }) → { close() }
  // onCode вызывается один раз, камера к этому моменту уже остановлена и слой убран.
  function open(opts){
    var stream = null, raf = null, closed = false;

    var layer = document.createElement("div");
    layer.className = "card-scan-screen";
    layer.innerHTML =
      '<div class="scan-video-wrap"><video id="cardScanVideo" playsinline autoplay muted></video><div class="scan-frame"></div></div>' +
      '<canvas id="cardScanCanvas" style="display:none;"></canvas>' +
      '<div class="modal-note card-scan-note" id="cardScanNote"></div>' +
      '<button type="button" class="modal-btn card-scan-back" id="cardScanBack">Назад</button>';
    document.body.appendChild(layer);

    var video = layer.querySelector("#cardScanVideo");
    var canvas = layer.querySelector("#cardScanCanvas");
    var note = layer.querySelector("#cardScanNote");

    function stopCamera(){
      if(raf){ cancelAnimationFrame(raf); raf = null; }
      if(stream){
        try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
        stream = null;
      }
    }
    function close(){
      if(closed) return;
      closed = true;
      stopCamera();
      if(layer.parentNode) layer.parentNode.removeChild(layer);
    }
    function showError(msg){
      note.className = "modal-note card-scan-note error";
      note.textContent = msg;
    }

    layer.querySelector("#cardScanBack").addEventListener("click", function(){
      close();
      if(opts.onBack) opts.onBack();
    });

    Promise.resolve(opts.loadJsqr ? opts.loadJsqr() : null).then(function(){
      if(closed) return;
      if(typeof window.jsQR !== "function"){
        showError("Не удалось загрузить модуль сканирования.");
        return;
      }
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        showError("Камера недоступна на этом устройстве.");
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function(s){
        if(closed){ try{ s.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} return; }
        stream = s;
        video.srcObject = s;
        try{ video.play(); }catch(e){}
        raf = requestAnimationFrame(tick);
      }).catch(function(err){
        console.error(err);
        showError("Не удалось получить доступ к камере.");
      });
    }).catch(function(){
      showError("Не удалось загрузить модуль сканирования.");
    });

    function tick(){
      if(closed) return;
      if(video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth){
        // уменьшаем кадр для скорости, пропорции сохраняем
        var w = Math.min(480, video.videoWidth);
        var h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth));
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        var data = ctx.getImageData(0, 0, w, h);
        var result = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" });
        if(result && result.data){
          close();
          if(opts.onCode) opts.onCode(result.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    }

    return { close: close };
  }

  return { parseCode: parseCode, open: open, QR_PREFIX: QR_PREFIX };
})();
