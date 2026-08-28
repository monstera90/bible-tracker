/* ===========================================================================
   s89draw.js
   Отрисовка одного задания поверх подложки S-89 через Canvas API - прямой
   аналог того, что в Python-версии (task-jpg-script.py) делал Pillow.
   Координаты полей и логика переноса/центрирования "Задание №" перенесены
   1:1 - они уже подобраны и проверены по пикселям на реальном s-89.jpg.

   Экспортирует:
     S89Draw.loadFont(fontUrl) -> Promise<FontFace>
     S89Draw.loadImage(blob) -> Promise<ImageBitmap|HTMLImageElement>
     S89Draw.renderTaskImage(task, templateImage) -> Promise<Blob> (image/png)
     S89Draw.sanitizeFilename(name) -> string
   =========================================================================== */

(function (global) {
  "use strict";

  const FONT_FAMILY = "DejaVuSans";
  const FONT_SIZE = 60;

  // Координаты полей на подложке (см. пояснения и подбор в task-jpg-script.py -
  // подобраны по пикселям под s-89.jpg, 1287x1621 px). Y - координата самой
  // линии, текст рисуется чуть выше неё по baseline (TEXT_GAP).
  const NAME_LINE_X = 235, NAME_LINE_Y = 349;
  const PARTNER_LINE_X = 410, PARTNER_LINE_Y = 473;
  const DATE_LINE_X = 235, DATE_LINE_Y = 598;
  const TASK_LINE_X = 450, TASK_LINE_Y = 723;
  const TASK_LINE_RIGHT_EDGE = 1217;
  const TASK_LINE_CENTER_X = (TASK_LINE_X + TASK_LINE_RIGHT_EDGE) / 2;
  const TASK_LINE_MAX_WIDTH = 762;
  const TASK_LINE_GAP = 66;
  const TEXT_GAP = 8;

  const CHECKBOX_MAIN_HALL = [129, 925, 174, 971]; // "В главном зале" -> зал 1
  const CHECKBOX_ADDITIONAL = [129, 1001, 174, 1047]; // "В дополнительном классе" -> зал 2

  function loadFont(fontUrl) {
    if (typeof FontFace === "undefined") {
      return Promise.resolve(null); // рисовать всё равно можно - будет системный шрифт
    }
    const fontFace = new FontFace(FONT_FAMILY, "url(" + fontUrl + ")");
    return fontFace
      .load()
      .then(function (loaded) {
        document.fonts.add(loaded);
        return loaded;
      })
      .catch(function (err) {
        console.error("s89draw: не удалось загрузить шрифт, будет системный", err);
        return null;
      });
  }

  function loadImage(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob);
    }
    // Запасной вариант для окружений без createImageBitmap.
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function (e) {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  // Разбивает текст на строки так, чтобы каждая помещалась в maxWidth
  // (измеряется уже настроенным ctx.font) - порт wrap_text из Python.
  function wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let current = "";
    for (const w of words) {
      const candidate = (current + " " + w).trim();
      const width = ctx.measureText(candidate).width;
      if (width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // Аккуратная галочка внутри прямоугольника чекбокса - порт draw_checkmark.
  function drawCheckmark(ctx, box) {
    const [x0, y0, x1, y1] = box;
    const w = x1 - x0;
    const h = y1 - y0;
    const p1 = [x0 + 0.16 * w, y0 + 0.55 * h];
    const p2 = [x0 + 0.42 * w, y0 + 0.8 * h];
    const p3 = [x0 + 0.86 * w, y0 + 0.16 * h];

    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.stroke();
    ctx.restore();
  }

  function sanitizeFilename(name) {
    return String(name).replace(/[<>:"/\\|?*]/g, "").trim();
  }

  // task: { date, student, partner, hall, itemNumber, itemTitle }
  // templateImage: ImageBitmap | HTMLImageElement (см. loadImage)
  // canvas: <canvas> - создать ОДИН раз снаружи и переиспользовать для
  // всех заданий подряд (пересоздавать canvas на каждое задание накладно
  // по памяти и заметно замедляет пакетную отрисовку на телефоне).
  // Возвращает Promise<Blob> (image/png - для такой картинки на белом
  // фоне кодируется заметно быстрее, чем image/jpeg).
  function createCanvasForImage(templateImage){
    const width = templateImage.width || templateImage.naturalWidth;
    const height = templateImage.height || templateImage.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function renderTaskImage(task, templateImage, canvas, onTiming) {
    const width = templateImage.width || templateImage.naturalWidth;
    const height = templateImage.height || templateImage.naturalHeight;
    const ctx = canvas.getContext("2d");

    const drawStart = performance.now();

    ctx.drawImage(templateImage, 0, 0, width, height);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT_SIZE + "px " + FONT_FAMILY;

    ctx.textAlign = "left";
    ctx.fillText(task.student, NAME_LINE_X, NAME_LINE_Y - TEXT_GAP);
    if (task.partner) {
      ctx.fillText(task.partner, PARTNER_LINE_X, PARTNER_LINE_Y - TEXT_GAP);
    }
    ctx.fillText(task.date, DATE_LINE_X, DATE_LINE_Y - TEXT_GAP);

    const taskLabel = task.itemNumber + ". " + task.itemTitle;
    const isPlainTalk = task.itemTitle.trim().toLowerCase() === "речь";
    const lines = wrapText(ctx, taskLabel, TASK_LINE_MAX_WIDTH);
    lines.forEach(function (line, i) {
      const y = TASK_LINE_Y - TEXT_GAP + i * TASK_LINE_GAP;
      if (isPlainTalk) {
        ctx.textAlign = "left";
        ctx.fillText(line, TASK_LINE_X, y);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(line, TASK_LINE_CENTER_X, y);
      }
    });

    const box = task.hall === 1 ? CHECKBOX_MAIN_HALL : CHECKBOX_ADDITIONAL;
    drawCheckmark(ctx, box);

    const drawMs = performance.now() - drawStart;
    const encodeStart = performance.now();

    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (onTiming) onTiming({ drawMs: drawMs, encodeMs: performance.now() - encodeStart });
          if (blob) resolve(blob);
          else reject(new Error("Не удалось создать изображение"));
        },
        "image/png"
      );
    });
  }

  global.S89Draw = {
    loadFont: loadFont,
    loadImage: loadImage,
    createCanvasForImage: createCanvasForImage,
    renderTaskImage: renderTaskImage,
    sanitizeFilename: sanitizeFilename,
  };
})(typeof window !== "undefined" ? window : globalThis);
