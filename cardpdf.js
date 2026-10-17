/* ===========================================================================
   cardpdf.js
   Версия: 1.0 (17.10)
   PDF с QR-кодами карточек для печати наклеек (ТЗ TASK_ITEM_CARDS_QR.md, раздел 4б, шаг 6): лист A4, три размера —
   большие 4, средние 12, маленькие 24 кода на лист; под каждым кодом название карточки (пиктограммы нет).
   Готовый PDF отдаётся как Blob; сохранение в «Загрузки» — обычным <a download> (в APK его перехватывает native-shell.js).

   Библиотек для PDF в проекте нет, поэтому здесь минимальный собственный писатель: каждая страница рисуется на canvas
   (200 dpi, QR — векторными квадратами из матрицы qrcode.min.js, название — обычным текстом браузера, поэтому кириллица
   и любые символы работают без встраивания шрифта) и кладётся в PDF как JPEG на всю страницу. Текст в PDF не
   выделяется — для печати наклеек это не нужно.

   window.CardPdf = { SIZES, build(cards, perPage, opts) → Promise<Blob> }
   Нужен window.QRCode (vendor/qrcode.min.js, грузит вызывающий код).
   =========================================================================== */
window.CardPdf = (function(){
  "use strict";

  // раскладка листа: колонки × строки
  var SIZES = {
    4:  { cols: 2, rows: 2 },
    12: { cols: 3, rows: 4 },
    24: { cols: 4, rows: 6 }
  };
  var DPI = 200;
  var MM = DPI / 25.4;
  var PAGE_W_PX = Math.round(210 * MM);   // A4
  var PAGE_H_PX = Math.round(297 * MM);
  var PAGE_W_PT = 595.28;
  var PAGE_H_PT = 841.89;
  var MARGIN_PX = Math.round(8 * MM);
  var QR_PREFIX = "lt://v1/card/";

  // матрица QR: {n, dark(r, c)} из модели qrcode.min.js (correctLevel M — меньше модулей, код крупнее на малой наклейке)
  function qrMatrix(text){
    var host = document.createElement("div");
    var q = new window.QRCode(host, { text: text, width: 64, height: 64, correctLevel: window.QRCode.CorrectLevel.M });
    var m = q && q._oQRCode;
    if(!m || typeof m.getModuleCount !== "function" || typeof m.isDark !== "function") throw new Error("qr_model");
    return { n: m.getModuleCount(), dark: function(r, c){ return m.isDark(r, c); } };
  }

  // до двух строк названия по ширине maxW; лишнее обрезается многоточием
  function wrapTitle(ctx, text, maxW){
    var words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
    var lines = [], cur = "";
    for(var i = 0; i < words.length; i++){
      var w = words[i];
      // слово длиннее строки — режем по символам
      while(ctx.measureText(w).width > maxW && w.length > 1){
        var k = w.length;
        while(k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
        if(cur){ lines.push(cur); cur = ""; }
        lines.push(w.slice(0, k));
        w = w.slice(k);
      }
      var next = cur ? cur + " " + w : w;
      if(ctx.measureText(next).width <= maxW) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if(cur) lines.push(cur);
    if(lines.length > 2){
      var last = lines[1];
      while(last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      lines = [lines[0], last + "…"];
    }
    return lines;
  }

  function drawCell(ctx, x, y, w, h, card){
    // тонкая пунктирная рамка — по ней режут наклейки
    ctx.save();
    ctx.strokeStyle = "#b8b8b8";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();

    var pad = Math.round(Math.min(w, h) * 0.05);
    var fs = Math.max(20, Math.min(60, Math.round(w * 0.085)));
    var lineH = Math.round(fs * 1.2);
    var titleH = lineH * 2;
    var qr = Math.floor(Math.min(w * 0.86, h - titleH - pad * 3));
    var blockH = qr + pad + titleH;
    var top = y + Math.round((h - blockH) / 2);
    var left = x + Math.round((w - qr) / 2);

    // QR: белая подложка с полем в 2 модуля (тёмные темы приложения на печать не влияют), чёрные квадраты
    var m = qrMatrix(QR_PREFIX + card.id);
    var quiet = 2;
    var cellPx = qr / (m.n + quiet * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(left, top, qr, qr);
    ctx.fillStyle = "#000000";
    for(var r = 0; r < m.n; r++){
      for(var c = 0; c < m.n; c++){
        if(!m.dark(r, c)) continue;
        var px = left + (c + quiet) * cellPx, py = top + (r + quiet) * cellPx;
        // +0.6: соседние квадраты слегка перекрываются, швов нет
        ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cellPx + 0.6), Math.ceil(cellPx + 0.6));
      }
    }

    // название
    ctx.fillStyle = "#000000";
    ctx.font = "700 " + fs + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var lines = wrapTitle(ctx, card.title || "Без названия", w - pad * 2);
    var ty = top + qr + pad;
    for(var i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + w / 2, ty + i * lineH);
  }

  function canvasToJpeg(canvas){
    return new Promise(function(resolve, reject){
      canvas.toBlob(function(blob){
        if(!blob){ reject(new Error("jpeg")); return; }
        var fr = new FileReader();
        fr.onload = function(){ resolve(new Uint8Array(fr.result)); };
        fr.onerror = function(){ reject(new Error("read")); };
        fr.readAsArrayBuffer(blob);
      }, "image/jpeg", 0.92);
    });
  }

  // ---- запись PDF ----
  function ascii(s){
    var a = new Uint8Array(s.length);
    for(var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255;
    return a;
  }
  function writePdf(jpegs, w, h){
    // объекты: 1 каталог, 2 страницы, затем на страницу: страница, содержимое, картинка
    var parts = [], offsets = [], size = 0;
    function push(u8){ parts.push(u8); size += u8.length; }
    function pushStr(s){ push(ascii(s)); }
    function beginObj(num){ offsets[num] = size; pushStr(num + " 0 obj\n"); }
    var count = jpegs.length;
    var total = 2 + count * 3;
    pushStr("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    beginObj(1); pushStr("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    var kids = [];
    for(var i = 0; i < count; i++) kids.push((3 + i * 3) + " 0 R");
    beginObj(2); pushStr("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + count + " >>\nendobj\n");
    for(var p = 0; p < count; p++){
      var pageNum = 3 + p * 3, contentNum = pageNum + 1, imgNum = pageNum + 2;
      beginObj(pageNum);
      pushStr("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W_PT + " " + PAGE_H_PT + "] " +
        "/Resources << /XObject << /Im0 " + imgNum + " 0 R >> >> /Contents " + contentNum + " 0 R >>\nendobj\n");
      var content = "q " + PAGE_W_PT + " 0 0 " + PAGE_H_PT + " 0 0 cm /Im0 Do Q\n";
      beginObj(contentNum);
      pushStr("<< /Length " + content.length + " >>\nstream\n" + content + "endstream\nendobj\n");
      beginObj(imgNum);
      pushStr("<< /Type /XObject /Subtype /Image /Width " + w + " /Height " + h + " /ColorSpace /DeviceRGB " +
        "/BitsPerComponent 8 /Filter /DCTDecode /Length " + jpegs[p].length + " >>\nstream\n");
      push(jpegs[p]);
      pushStr("\nendstream\nendobj\n");
    }
    var xrefAt = size;
    var xref = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for(var n = 1; n <= total; n++) xref += ("0000000000" + offsets[n]).slice(-10) + " 00000 n \n";
    pushStr(xref + "trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }

  // cards — [{id, title}], perPage — 4 | 12 | 24; opts.onProgress(done, total)
  function build(cards, perPage, opts){
    opts = opts || {};
    var layout = SIZES[perPage];
    if(!layout) return Promise.reject(new Error("size"));
    if(!window.QRCode) return Promise.reject(new Error("qrlib"));
    var list = (cards || []).filter(function(c){ return c && typeof c.id === "string"; });
    if(!list.length) return Promise.reject(new Error("empty"));
    var pages = Math.ceil(list.length / perPage);
    var cellW = Math.floor((PAGE_W_PX - MARGIN_PX * 2) / layout.cols);
    var cellH = Math.floor((PAGE_H_PX - MARGIN_PX * 2) / layout.rows);
    var jpegs = [];
    var canvas = document.createElement("canvas");
    canvas.width = PAGE_W_PX;
    canvas.height = PAGE_H_PX;

    function renderPage(pi){
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);
      for(var k = 0; k < perPage; k++){
        var idx = pi * perPage + k;
        if(idx >= list.length) break;
        var col = k % layout.cols, row = Math.floor(k / layout.cols);
        drawCell(ctx, MARGIN_PX + col * cellW, MARGIN_PX + row * cellH, cellW, cellH, list[idx]);
      }
      return canvasToJpeg(canvas);
    }
    // страницы — по одной, с передышкой между ними (интерфейс не замирает на большом числе карточек)
    function next(pi){
      if(pi >= pages) return Promise.resolve(writePdf(jpegs, PAGE_W_PX, PAGE_H_PX));
      return renderPage(pi).then(function(u8){
        jpegs.push(u8);
        if(opts.onProgress) opts.onProgress(pi + 1, pages);
        return new Promise(function(res){ setTimeout(res, 0); });
      }).then(function(){ return next(pi + 1); });
    }
    return next(0);
  }

  return { SIZES: SIZES, build: build };
})();
