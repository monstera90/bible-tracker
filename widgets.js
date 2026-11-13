/* ===========================================================================
   widgets.js
   Версия: 5.3 (13.11)
   Вкладка «Конструктор виджетов» (ключ "widgets", кнопка settingsTabWidgetsBtn): виджеты рабочего стола «Стопка QR-карточек» 2×2 (Android, QrWidgets.kt).
   В виджет входит до 10 карточек вкладки «QR-коды» (itemcards.js); виден один, смахивание вверх/вниз листает по кругу; нажатие — как скан кода карточки.
   Настройки виджета: слайд-шоу «Переключать виджеты по кругу» (раз в N минут) ИЛИ «Переключение по релевантности»; у каждой карточки —
   необязательные время суток (утро/обед/вечер) и дни недели, когда она поднимается наверх, и что делать со стопкой после срабатывания карточки
   (`after`: "none" — ничего (по умолчанию) / "hide" — скрыть до конца дня / "end" — переместить в конец).
   Галочка «Отображать заряд аккумулятора» (`battery`): в стопку добавляется служебная карточка с зарядом телефона и Bluetooth-наушников — её рисует оболочка (QrBattery.kt), страница шлёт только флаг.
   Цвет карточки «Заряд» (`batColor`: "" — по умолчанию, сиреневый, иначе "#rrggbb") выбирается палитрой под галочкой — той же, что в форме карточки QR-кодов (itemcards.js `colorPalette`, запомненный цвет — `defaultColor/rememberColor`); карточка заряда показана в форме после последнего слота (и кнопки «+») (`batFaceHtml`), статус наушников из оболочки — `batStatusText`.
   Галочка «Отображать заряд аккумулятора (несколько устройств)» (`batteryMulti`, цвет `bat2Color`, палитра `icfColors2`): ещё одна служебная карточка — только значки и кольца заряда, без надписей: телефон и до трёх подключённых Bluetooth-устройств (QrBattery.renderMulti); в форме её лицо — `bat2FaceHtml`, значки — `iconSvg`, список парных устройств из оболочки — `batDevicesText`.
   Галочка «Спрашивать о тренировке» (`rpeAsk`): пока есть тренировка без оценки нагрузки (1–10), над всеми карточками стопки стоит служебная карточка «Как тренировка?» с кнопками 1…10 — её рисует оболочка (QrRpe.kt), страница шлёт только флаг; в форме показан образец лица (`rpeFaceHtml`, цвет `RPE_COLOR`). Оценку из виджета страница забирает в workouts.js (`drainWidgetRpe`, мост ≥33).
   Галочки «Показывать задачи» (`tasks`, цвет `tasksColor`, палитра `icfColors3`) и «Показывать события календаря» (`events`, цвет `eventsColor`, палитра `icfColors4`): в стопку добавляются динамические карточки по данным календаря (`CalendarTab.widgetFeed` через `deps.getCalendarFeed`, `buildFeed`). Задачи: каждая открытая задача календаря на ближайшую неделю (`FEED_DAYS`) или просроченная — отдельная карточка (до `MAX_TASKS`); событие: ближайшее запланированное в пределах недели (в оболочку уходят `MAX_EVENTS` кандидатов, показывает первое будущее — решает QrWidgets.kt по текущему времени). Лицо — `drawDynFace` (размеры сняты с макета, доли ширины карточки — `DYN`), у каждой карточки до четырёх картинок: `<ключ>` («Сегодня»), `<ключ>_t` («Завтра»), `<ключ>_w` (день недели, если до даты два дня и больше) и `<ключ>_s`/`<ключ>_y`/`<ключ>_o` («Просрочено, сегодня» / «…, вчера» / «…, 1 января», только у задачи); какую показать — выбирает оболочка (так надпись меняется в полночь без приложения). Данные меняются → `feedChanged` (из my.js: запись состояния и возврат в приложение) сверяет `feedSig` и при отличии шлёт `syncNow`. Палитра общая с карточками QR-кодов (`itemcards.colorPalette`), цвет по умолчанию — как на макете (`TASK_COLOR`/`EVENT_COLOR`), последний выбранный — `widgetsDynColors_v1`.
   Данные: localStorage `qrWidgets_v1` ({n, ever, list:[{id,n,cards:[{cid,times,days,after}],rotate,rotateMin,relevance,battery,batColor,batteryMulti,bat2Color,tasks,tasksColor,events,eventsColor,rpeAsk}]}), только на устройстве.
   Страница рисует лица карточек в PNG (canvas, `pngFor`) и шлёт их оболочке вместе с настройками (мост ≥31 `widgetsSync`).
   Точка входа: window.initWidgetsModule(deps) → window.WidgetsTab.{render, scheduleSync}.
   =========================================================================== */
(function(){
  "use strict";
  var KEY = "qrWidgets_v1";
  var PICK_FILTER_KEY = "widgetsPickFilter_v1";
  var MAX_CARDS = 50;
  var FACE_PX = 480; // ширина картинки лица для оболочки
  var FACE_BODY = 1.02; // высота тела карточки = ширина × FACE_BODY (то же — CARD_ASPECT в itemcards.js и FACE_BODY/FACE_SHADE в QrWidgets.kt)
  var FACE_SHADE = 0.04; // цветной выступ снизу, доля ширины
  var LEGACY_BAT_COLOR = "#2175d9"; // цвет карточки заряда у виджетов, сохранённых до выбора цвета: остаются синими
  var TASK_COLOR = "#1e88e5"; // цвет карточек задач по умолчанию (синий макета; квадрат палитры QR-кодов)
  var RPE_COLOR = "#8000ff"; // цвет карточки «Как тренировка?» (фиолетовый макета; в оболочке — QrRpe.DEFAULT_COLOR)
  var EVENT_COLOR = "#317bf6"; // цвет карточки события по умолчанию (синий макета, чуть насыщеннее)
  var DYN_LAST_KEY = "widgetsDynColors_v1"; // последний выбранный цвет карточек задач/событий: {task, event}
  var MAX_TASKS = 12; // карточек задач в виджете (ближайшие по времени, просроченные первыми)
  var MAX_EVENTS = 4; // кандидатов в «следующее событие»: оболочка показывает первое, которое ещё не началось
  var FEED_DAYS = 7; // неделя вперёд (сегодня…через 6 дней, чтобы название дня недели было однозначным): оболочка сама решает по часам, что показать, пока приложение закрыто
  var DAY_MS = 86400000;
  // Лицо динамической карточки (доли ширины карточки; сняты с макета 660 px): значок Tabler — «circle-check» / «calendar-event» (сетка 24, линия 2),
  // надпись «Сегодня»…, название (serif, жирное), время (крупно). Базовые линии букв, верх значка — от верха карточки. Верхние ≈7 % лица в виджете скрыты обрезкой стопки (qr_widget.xml: передняя карточка выходит за слот сверху), поэтому значок не поднимается выше `iconTop2`, а лишняя строка названия (`DYN2`) уходит вниз.
  var DYN = { unit: 0.00955, iconTop: 0.138, labelBase: 0.448, titleBase: 0.577, timeBase: 0.858, labelFs: 0.076, labelFsMax: 0.1, titleFs: 0.108, timeFs: 0.27 };
  var DYN2 = { iconTop: 0.126, labelBase: 0.432, titleBase: 0.543, lineH: 1.1, timeGap: 0.281 }; // название в две строки: значок почти на месте (выше нельзя — обрежется), остальное сдвигается вниз
  var DYN_ICONS = {
    task: '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2l4 -4"/>',
    event: '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/><path d="M8 15h2v2h-2z"/>'
  };
  var DYN_LABELS = { today: "Сегодня", over: "Просрочено", tom: "Завтра" }; // у просроченной задачи к «Просрочено» добавляется «, сегодня» / «, вчера» / «, 1 января»
  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var WEEKDAYS_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]; // по Date.getDay(): надпись карточки через два дня и дальше
  var DYN_SAMPLE = { task: { title: "Купить молоко", time: "18:00" }, event: { title: "Приём у врача", time: "15:30" } };
  // интервалы времени суток — те же значения в QrWidgets.kt (WINDOWS)
  var WINDOWS = [
    { k: "m", label: "Утро", hint: "5–11" },
    { k: "d", label: "Обед", hint: "11–15" },
    { k: "e", label: "Вечер", hint: "17–23" }
  ];
  var AFTERS = [
    { k: "none", label: "Ничего не делать" },
    { k: "hide", label: "Скрывать карточку в стопке" },
    { k: "end", label: "Перемещать карточку в конец стопки" }
  ];
  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]; // 1..7
  var PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  var FILTER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5z"></path></svg>';

  window.initWidgetsModule = function(deps){
    var esc = deps.escapeHtml;
    var HOME_SVG = deps.READER_HOME_ICON_SVG;
    var data = load();
    var stack = [{ s: "list" }];
    var armed = null;
    var syncTimer = null;
    var feedTimer = null;
    var lastFeedSig = "";
    var pngCache = {};
    var styleDone = false;

    // ---------- хранилище ----------
    function load(){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(KEY) || "null"); }catch(e){}
      if(!o || typeof o !== "object" || !Array.isArray(o.list)) o = { n: 0, ever: false, list: [] };
      o.list = o.list.filter(function(w){ return w && w.id && Array.isArray(w.cards); });
      o.list.forEach(function(w){
        w.cards = w.cards.filter(function(c){ return c && c.cid; }).slice(0, MAX_CARDS);
        w.cards.forEach(function(c){ c.times = Array.isArray(c.times) ? c.times : []; c.days = Array.isArray(c.days) ? c.days : []; c.after = normAfter(c.after); });
        w.rotateMin = Math.max(1, Math.min(720, w.rotateMin | 0 || 5));
        w.rotate = !!w.rotate; w.relevance = !!w.relevance && !w.rotate; w.battery = !!w.battery;
        if(typeof w.batColor !== "string") w.batColor = w.battery ? LEGACY_BAT_COLOR : "";
        else if(w.batColor && !/^#[0-9a-fA-F]{6}$/.test(w.batColor)) w.batColor = "";
        w.batteryMulti = !!w.batteryMulti;
        if(typeof w.bat2Color !== "string" || (w.bat2Color && !/^#[0-9a-fA-F]{6}$/.test(w.bat2Color))) w.bat2Color = "";
        w.tasks = !!w.tasks; w.events = !!w.events; w.rpeAsk = !!w.rpeAsk;
        w.tasksColor = normHex(w.tasksColor); w.eventsColor = normHex(w.eventsColor);
      });
      return o;
    }
    function normHex(v){ return (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) ? v.toLowerCase() : ""; }
    function hasContent(w){ return !!(w.cards.length || w.battery || w.batteryMulti || w.tasks || w.events || w.rpeAsk); }
    function normAfter(v){ return (v === "hide" || v === "end") ? v : "none"; }
    function save(){ try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){} }
    function changed(){ save(); scheduleSync(600); }
    function widgetById(id){ for(var i = 0; i < data.list.length; i++) if(data.list[i].id === id) return data.list[i]; return null; }
    function wname(w){ return "Виджет " + w.n; }
    function bridge(){ var b = window.LifeTrackerNative; return (b && typeof b.widgetsSync === "function") ? b : null; }
    function nativeState(){
      var b = bridge(); if(!b) return null;
      try{ return JSON.parse(b.widgetsState() || "{}"); }catch(e){ return null; }
    }
    function cardsOf(){ return deps.getItemCards(); }
    function batHex(w){ return cardsOf().paletteColor(w.batColor); } // цвет, которым рисуется карточка заряда (пусто — сиреневый)
    function bat2Hex(w){ return cardsOf().paletteColor(w.bat2Color); } // то же для карточки заряда нескольких устройств
    function dynHex(w, kind){ return cardsOf().paletteColor(kind === "task" ? w.tasksColor : w.eventsColor); } // цвет карточек задач / события (пусто — сиреневый)
    // цвет для только что включённой галочки: последний выбранный (в том числе сиреневый), иначе синий макета
    function dynColorFor(kind){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(DYN_LAST_KEY) || "null"); }catch(e){}
      if(o && typeof o === "object" && typeof o[kind] === "string") return normHex(o[kind]);
      return kind === "task" ? TASK_COLOR : EVENT_COLOR;
    }
    function rememberDynColor(kind, hex){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(DYN_LAST_KEY) || "null"); }catch(e){}
      if(!o || typeof o !== "object") o = {};
      o[kind] = normHex(hex);
      try{ localStorage.setItem(DYN_LAST_KEY, JSON.stringify(o)); }catch(e){}
    }

    // ---------- лицо карточки → PNG для оболочки ----------
    function rrect(g, x, y, w, h, r){
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
      g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
      g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
      g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
    }
    function wrapLines(g, text, maxW){
      var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = "";
      words.forEach(function(w){
        var t = cur ? cur + " " + w : w;
        if(cur && g.measureText(t).width > maxW){ lines.push(cur); cur = w; } else cur = t;
      });
      if(cur) lines.push(cur);
      return lines;
    }
    function svgImage(svg){
      return new Promise(function(resolve){
        if(!svg) return resolve(null);
        var s = String(svg).replace(/currentColor/g, "#ffffff");
        if(s.indexOf("xmlns") < 0) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"');
        var img = new Image();
        img.onload = function(){ resolve(img); };
        img.onerror = function(){ resolve(null); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      });
    }
    function drawFace(face, icon){
      var S = FACE_PX, bodyH = Math.round(S * FACE_BODY), shift = Math.round(S * FACE_SHADE), cv = document.createElement("canvas");
      cv.width = S; cv.height = bodyH + shift;
      var g = cv.getContext("2d");
      var r = S * 0.12;
      rrect(g, 0, shift, S, bodyH, r); g.fillStyle = face.shade; g.fill();   // цветной выступ снизу
      rrect(g, 0, 0, S, bodyH, r); g.fillStyle = face.color; g.fill();
      var maxW = S * 0.86, serif = '"Palatino Linotype",Georgia,serif', sans = "sans-serif";
      var items = [];
      if(icon) items.push({ h: S * 0.27, gap: S * 0.03, icon: true });
      var tfs = S * ((face.type === "timer" || face.type === "alarm") ? 0.11 : 0.12), lines = [];
      if(face.title){
        for(;;){
          g.font = "700 " + tfs + "px " + serif;
          var widest = 0;
          String(face.title).split(/\s+/).forEach(function(w){ var m = g.measureText(w).width; if(m > widest) widest = m; });
          if(widest <= maxW || tfs <= S * 0.07) break;
          tfs *= 0.92;
        }
        lines = wrapLines(g, face.title, maxW);
        if(lines.length > 2){ lines = lines.slice(0, 2); lines[1] = lines[1].replace(/.?$/, "…"); }
        items.push({ h: lines.length * tfs * 1.25, gap: S * 0.03, title: true });
      }
      var bfs = S * 0.19;
      if(face.big) items.push({ h: bfs * 1.1, gap: S * 0.03, big: true });
      var sfs = S * 0.09;
      if(face.sub) items.push({ h: sfs * 1.2, gap: 0, sub: true });
      var total = 0; items.forEach(function(it){ total += it.h + it.gap; });
      if(items.length) total -= items[items.length - 1].gap;
      var y = (bodyH - total) / 2;
      g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = "#ffffff";
      items.forEach(function(it){
        if(it.icon){ if(icon) g.drawImage(icon, (S - it.h) / 2, y, it.h, it.h); }
        else if(it.title){
          g.font = "700 " + tfs + "px " + serif;
          lines.forEach(function(ln, i){ g.fillText(ln, S / 2, y + i * tfs * 1.25 + tfs * 0.12); });
        } else if(it.big){
          g.font = "700 " + bfs + "px " + sans;
          g.fillText(face.big, S / 2, y + bfs * 0.04, maxW);
        } else if(it.sub){
          g.font = "400 " + sfs + "px " + sans;
          g.fillText(face.sub, S / 2, y + sfs * 0.06, maxW);
        }
        y += it.h + it.gap;
      });
      return cv;
    }
    function pngFor(face){
      var sig = JSON.stringify([face.color, face.title, face.big, face.sub, face.svg, face.type]);
      var hit = pngCache[face.id];
      if(hit && hit.sig === sig) return Promise.resolve(hit.url);
      return svgImage(face.svg).then(function(icon){
        var url = "";
        try{ url = drawFace(face, icon).toDataURL("image/png"); }
        catch(e){ try{ url = drawFace(face, null).toDataURL("image/png"); }catch(e2){ url = ""; } } // холст «испачкан» значком — рисуем без него
        if(url) pngCache[face.id] = { sig: sig, url: url };
        return url;
      });
    }

    // ---------- карточки «Задачи» и «События календаря» ----------
    function dynIconSvg(kind){
      return '<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + DYN_ICONS[kind] + '</svg>';
    }
    // название: одна строка (шрифт ужимается до 0,088 ширины), иначе две (до 0,07), иначе вторая строка обрезается «…»
    function fitTitle(g, text, S, maxW, fam){
      text = String(text || "").replace(/\s+/g, " ").replace(/^ | $/g, "") || "Без названия";
      function setF(f){ g.font = "700 " + f + "px " + fam; }
      var fs;
      for(fs = S * DYN.titleFs; fs >= S * 0.088; fs *= 0.96){ setF(fs); if(g.measureText(text).width <= maxW) return { lines: [text], fs: fs }; }
      for(fs = S * 0.09; fs >= S * 0.07; fs *= 0.95){
        setF(fs);
        var lines = wrapLines(g, text, maxW), ok = lines.length <= 2;
        if(ok) lines.forEach(function(l){ if(g.measureText(l).width > maxW) ok = false; });
        if(ok) return { lines: lines, fs: fs };
      }
      fs = S * 0.07; setF(fs);
      var ls = wrapLines(g, text, maxW);
      if(ls.length > 2){
        ls = ls.slice(0, 2);
        var last = ls[1];
        while(last.length > 1 && g.measureText(last + "…").width > maxW) last = last.slice(0, -1);
        ls[1] = last + "…";
      }
      return { lines: ls, fs: fs };
    }
    // face: {color, shade, kind, label, title, time}
    function drawDynFace(face, icon){
      var S = FACE_PX, bodyH = Math.round(S * FACE_BODY), shift = Math.round(S * FACE_SHADE), cv = document.createElement("canvas");
      cv.width = S; cv.height = bodyH + shift;
      var g = cv.getContext("2d"), r = S * 0.12;
      rrect(g, 0, shift, S, bodyH, r); g.fillStyle = face.shade; g.fill();   // цветной выступ снизу
      rrect(g, 0, 0, S, bodyH, r); g.fillStyle = face.color; g.fill();
      var maxW = S * 0.86, serif = '"Palatino Linotype",Georgia,serif', sans = "sans-serif";
      var fit = fitTitle(g, face.title, S, maxW, serif), n = fit.lines.length, lh = fit.fs * (n > 1 ? DYN2.lineH : 1.2);
      var iconTop = n > 1 ? DYN2.iconTop : DYN.iconTop, labelBase = n > 1 ? DYN2.labelBase : DYN.labelBase, titleBase = n > 1 ? DYN2.titleBase : DYN.titleBase;
      var timeBase = n > 1 ? titleBase + (n - 1) * lh / S + DYN2.timeGap : DYN.timeBase;
      g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillStyle = "#ffffff";
      if(icon){ var u = S * DYN.unit; g.drawImage(icon, (S - 24 * u) / 2, S * iconTop - 2 * u, 24 * u, 24 * u); }
      var lfs = S * DYN.labelFsMax; // надпись дня крупнее: «Сегодня, Четверг» — до labelFsMax, длинные ужимаются, но не меньше labelFs
      g.font = "400 " + lfs + "px " + sans;
      while(lfs > S * DYN.labelFs && g.measureText(face.label).width > maxW){ lfs *= 0.97; g.font = "400 " + lfs + "px " + sans; }
      g.fillText(face.label, S / 2, S * labelBase, maxW);
      g.font = "700 " + fit.fs + "px " + serif;
      fit.lines.forEach(function(ln, i){ g.fillText(ln, S / 2, S * titleBase + i * lh, maxW); });
      g.font = "700 " + (S * DYN.timeFs) + "px " + sans;
      g.fillText(face.time, S / 2, S * timeBase, maxW);
      return cv;
    }
    function dynPng(face){
      var sig = JSON.stringify([face.color, face.kind, face.label, face.title, face.time]);
      var hit = pngCache[face.id];
      if(hit && hit.sig === sig) return Promise.resolve(hit.url);
      return svgImage(dynIconSvg(face.kind)).then(function(icon){
        var url = "";
        try{ url = drawDynFace(face, icon).toDataURL("image/png"); }
        catch(e){ try{ url = drawDynFace(face, null).toDataURL("image/png"); }catch(e2){ url = ""; } }
        if(url) pngCache[face.id] = { sig: sig, url: url };
        return url;
      });
    }
    function startOfDay(ts){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    function addDays(ts, n){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); } // календарные дни (переход на летнее время не сдвигает полночь)
    function hhmm(ts){ var d = new Date(ts), h = d.getHours(), m = d.getMinutes(); return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
    function usesDyn(){ for(var i = 0; i < data.list.length; i++) if(data.list[i].tasks || data.list[i].events) return true; return false; }
    // что нужно карточкам: {tasks:[{at,title}], events:[{at,title}]}; задачи — открытые на сегодня и просроченные, события — ещё не начавшиеся
    function buildFeed(){
      var now = Date.now(), list = [], feed = { tasks: [], events: [] };
      try{ list = (deps.getCalendarFeed && deps.getCalendarFeed(now, addDays(startOfDay(now), FEED_DAYS))) || []; }catch(e){ list = []; }
      list.forEach(function(it){
        var o = { at: it.at, title: it.title };
        if(it.k === "task"){ o.tid = it.tid || ""; if(feed.tasks.length < MAX_TASKS) feed.tasks.push(o); }
        else if(it.at >= now && feed.events.length < MAX_EVENTS) feed.events.push(o);
      });
      return feed;
    }
    function feedSig(feed){
      function f(a){ return a.map(function(x){ return [x.at, x.title, x.tid || ""]; }); }
      return JSON.stringify([f(feed.tasks), f(feed.events)]);
    }
    // Карточки виджетов и картинки к ним. Ключи — `dt_<id виджета>_<n>` (задача) и `de_<id виджета>_<n>` (событие). Надпись зависит от того, сколько дней
    // осталось до даты карточки, и меняется в полночь без приложения, поэтому шлются все картинки, которые понадобятся: `<ключ>` — «Сегодня», `<ключ>_t` — «Завтра»,
    // `<ключ>_w` — день недели («Суббота»; только если до даты два дня и больше); у задачи ещё `<ключ>_s` — «Просрочено, сегодня» (время прошло, день тот же), `<ключ>_y` — «Просрочено, вчера», `<ключ>_o` — «Просрочено, 1 января» (дата задачи; раньше вчера). Какую показать, выбирает оболочка.
    function dynItems(feed){
      var today = startOfDay(Date.now()), jobs = [], per = {};
      data.list.forEach(function(w){
        var items = [];
        function add(kind, list, prefix){
          var hex = dynHex(w, kind), shade = cardsOf().cardShade(hex);
          list.forEach(function(it, i){
            var key = prefix + w.id + "_" + i, dayAt = startOfDay(it.at), d0 = Math.round((dayAt - today) / DAY_MS);
            function face(id, label){ return { id: "dyn:" + id, color: hex, shade: shade, kind: kind, label: label, title: it.title, time: hhmm(it.at) }; }
            function put(suffix, label){ jobs.push({ key: key + suffix, face: face(key + suffix, label) }); }
            var wd = WEEKDAYS_FULL[new Date(it.at).getDay()];
            if(d0 >= 2) put("_w", wd);
            if(d0 >= 1) put("_t", DYN_LABELS.tom + ", " + wd);
            if(d0 >= 0) put("", DYN_LABELS.today + ", " + wd);
            if(kind === "task"){
              var od = new Date(it.at);
              if(d0 >= 0) put("_s", DYN_LABELS.over + ", сегодня");
              if(d0 >= -1) put("_y", DYN_LABELS.over + ", вчера");
              put("_o", DYN_LABELS.over + ", " + od.getDate() + " " + MONTHS_GEN[od.getMonth()]);
            }
            items.push({ key: key, k: kind, at: it.at, title: it.title, tid: it.tid || "" });
          });
        }
        if(w.tasks) add("task", feed.tasks, "dt_");
        if(w.events) add("event", feed.events, "de_");
        per[w.id] = items;
      });
      return { perWidget: per, jobs: jobs };
    }
    // данные календаря или время изменились: если для карточек «задачи»/«события» это что-то меняет — отправить виджеты заново
    function feedChanged(){
      if(feedTimer || !bridge() || !usesDyn()) return;
      feedTimer = setTimeout(function(){
        feedTimer = null;
        if(!usesDyn()) return;
        var sig = "";
        try{ sig = feedSig(buildFeed()); }catch(e){ return; }
        if(sig !== lastFeedSig) scheduleSync(300);
      }, 4000);
    }

    // ---------- отправка оболочке ----------
    function scheduleSync(ms){
      if(!bridge()) return;
      if(!data.list.length && !data.ever) return;
      if(syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(function(){ syncTimer = null; syncNow(); }, ms == null ? 1500 : ms);
    }
    function syncNow(){
      var b = bridge();
      if(!b) return Promise.resolve(false);
      var ic = cardsOf(), ids = {}, faces = {};
      data.list.forEach(function(w){ w.cards.forEach(function(c){ ids[c.cid] = 1; }); });
      Object.keys(ids).forEach(function(id){ var f = ic.widgetFace(id); if(f) faces[id] = f; });
      var keys = Object.keys(faces);
      var feed = usesDyn() ? buildFeed() : null;
      var dyn = feed ? dynItems(feed) : { perWidget: {}, jobs: [] };
      var all = keys.map(function(k){ return pngFor(faces[k]); }).concat(dyn.jobs.map(function(j){ return dynPng(j.face); }));
      return Promise.all(all).then(function(urls){
        var images = {};
        keys.forEach(function(k, i){ if(urls[i]) images[k] = urls[i]; });
        dyn.jobs.forEach(function(j, i){ if(urls[keys.length + i]) images[j.key] = urls[keys.length + i]; });
        var widgets = data.list.map(function(w){
          return {
            id: w.id, name: wname(w), rotate: w.rotate, rotateMin: w.rotateMin, relevance: w.relevance, battery: !!w.battery, batColor: w.battery ? batHex(w) : "", batteryMulti: !!w.batteryMulti, bat2Color: w.batteryMulti ? bat2Hex(w) : "",
            tasks: !!w.tasks, events: !!w.events, rpeAsk: !!w.rpeAsk, dyn: dyn.perWidget[w.id] || [],
            cards: w.cards.filter(function(c){ return faces[c.cid]; }).map(function(c){
              var f = faces[c.cid];
              return { key: c.cid, code: f.code, title: f.title, live: f.live, times: c.times, days: c.days, after: normAfter(c.after), habit: f.type === "habit" };
            })
          };
        });
        if(data.list.length && !data.ever){ data.ever = true; save(); }
        var ok = false;
        try{ ok = !!b.widgetsSync(JSON.stringify({ v: 1, widgets: widgets, images: images })); }catch(e){ ok = false; }
        if(ok && feed) lastFeedSig = feedSig(feed);
        return ok;
      });
    }

    // ---------- навигация внутри вкладки ----------
    function rootEl(){ return document.getElementById("widgetsTabRoot"); }
    function arm(){
      if(armed || !window.AppNav) return;
      var t = { active: true };
      armed = t;
      window.AppNav.push(function(){
        if(!t.active) return;
        t.active = false; if(armed === t) armed = null;
        if(!rootEl()) return;
        leaveScreen(stack.pop());
        if(stack.length > 1) arm();
        render();
      });
    }
    function disarm(){
      if(!armed) return;
      var t = armed; armed = null; t.active = false;
      try{ history.back(); }catch(e){}
    }
    function go(s, a){ stack.push({ s: s, a: a }); arm(); render(); }
    function backUi(){
      if(stack.length <= 1) return;
      leaveScreen(stack.pop());
      if(stack.length <= 1) disarm();
      render();
    }
    function homeUi(){
      while(stack.length > 1) leaveScreen(stack.pop());
      disarm();
      render();
    }
    function leaveScreen(top){
      if(top && top.s === "form" && top.a && top.a.draft && !hasContent(top.a.w)) top.a.draft = false; // пустой новый виджет не сохраняется
    }
    function cur(){ return stack[stack.length - 1]; }

    // ---------- стили ----------
    function ensureStyles(){
      if(styleDone || document.getElementById("widgetsTabStyle")){ styleDone = true; return; }
      styleDone = true;
      var st = document.createElement("style");
      st.id = "widgetsTabStyle";
      st.textContent =
        ".widgets-tab{padding:10px 12px 96px;}" +
        ".widgets-tab .common-tab-title{margin-bottom:12px;}" +
        ".wg-hint{font-size:13px;line-height:1.35;color:var(--ink-soft);margin:6px 2px 10px;}" +
        ".wg-row{display:flex;align-items:center;padding:10px 12px;margin:0 0 8px;border-radius:14px;background:var(--gold-light);color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-row-ico{flex:0 0 auto;width:42px;height:42px;border-radius:10px;margin-right:12px;}" +
        ".wg-row-txt{flex:1 1 auto;min-width:0;}" +
        ".wg-row-name{font-weight:700;font-size:16px;}" +
        ".wg-row-sub{font-size:13px;color:var(--ink-soft);}" +
        ".wg-empty{text-align:center;color:var(--ink-soft);padding:40px 16px;font-size:15px;}" +
        ".wg-slots{display:flex;flex-wrap:wrap;justify-content:center;margin:0 -6px 8px;}" +
        ".wg-slot{position:relative;margin:6px 6px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-slot-empty{width:96px;height:98px;box-sizing:border-box;border:2px dashed var(--groove-shadow);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--ink-soft);}" +
        ".wg-slot-empty svg{width:34px;height:34px;}" +
        ".wg-card{position:relative;width:96px;height:98px;border-radius:12px;color:#fff;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:5px;}" +
        ".wg-card > *{flex:0 0 auto;max-width:100%;box-sizing:border-box;}" +
        ".wg-card.used{opacity:.35;}" +
        ".wg-card-ico{width:26px;height:26px;margin-bottom:3px;}" +
        ".wg-card-ico svg{display:block;width:26px;height:26px;}" +
        ".wg-card-title{font-family:\"Palatino Linotype\",Georgia,serif;font-size:11.5px;line-height:1.25;font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:normal;}" +
        ".wg-card-title.t-s{font-size:10px;}" +
        ".wg-card-title.t-xs{font-size:8.5px;}" +
        ".wg-card-big{font-size:18px;line-height:1.1;font-weight:700;white-space:nowrap;margin-top:3px;}" +
        ".wg-card-sub{font-size:8.6px;line-height:1.2;margin-top:3px;}" +
        ".wg-bat-card{padding:0;}" +
        ".wg-bat-card svg{display:block;width:100%;height:100%;}" +
        ".wg-bat-status{font-size:13px;line-height:1.35;color:var(--ink);margin:6px 2px 10px;}" +
        ".wg-badge{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--wood);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;}" +
        ".wg-check{display:flex;align-items:center;margin:10px 2px;font-size:15px;color:var(--ink);}" +
        ".wg-check input[type=checkbox]{width:22px;height:22px;margin:0 10px 0 0;flex:0 0 auto;}" +
        ".wg-min{margin:0 2px 8px 32px;font-size:14px;color:var(--ink);}" +
        ".wg-min input{width:64px;font-size:16px;padding:4px 6px;margin:0 6px;text-align:center;}" +
        ".wg-chips{display:flex;flex-wrap:wrap;margin:6px 0 4px;}" +
        ".wg-chip{margin:0 8px 8px 0;padding:8px 14px;border-radius:18px;background:var(--gold-light);color:var(--ink);font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-chip.on{background:var(--wood);color:#fff;}" +
        ".wg-chip small{opacity:.7;margin-left:4px;font-size:11px;}" +
        ".wg-sec{font-weight:700;margin:14px 2px 2px;color:var(--ink);}" +
        ".wg-btns{display:flex;flex-direction:column;margin-top:14px;}" +
        ".wg-btns .workbooks-run-btn{margin:0 0 10px;}" +
        ".wg-preview{display:flex;justify-content:center;margin:4px 0 10px;}" +
        ".wg-menu{position:fixed;right:12px;bottom:84px;z-index:30;background:var(--parchment);border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.3);padding:6px;max-height:60vh;overflow:auto;}" +
        ".wg-menu button{display:block;width:100%;text-align:left;margin:2px 0;}" +
        ".wg-menu button.selected{background:var(--wood);color:#fff;}";
      document.head.appendChild(st);
    }

    // ---------- разметка ----------
    function titleSize(t){
      var m = 0; String(t).split(/\s+/).forEach(function(w){ if(w.length > m) m = w.length; });
      var base = (arguments[1] === "timer" || arguments[1] === "alarm") ? 1 : 0;
      return (m >= 11) ? " t-xs" : (m >= 8 + base ? " t-s" : "");
    }
    function faceHtml(f, cls, extra){
      return '<div class="wg-card' + (cls ? " " + cls : "") + '" style="background:' + f.color + ';box-shadow:0 4px 0 ' + f.shade + ';">' +
        (f.svg ? '<div class="wg-card-ico">' + String(f.svg).replace(/currentColor/g, "#ffffff") + '</div>' : '') +
        (f.title ? '<div class="wg-card-title' + titleSize(f.title, f.type) + '">' + esc(f.title) + '</div>' : '') +
        (f.big ? '<div class="wg-card-big">' + esc(f.big) + '</div>' : '') +
        (f.sub ? '<div class="wg-card-sub">' + esc(f.sub) + '</div>' : '') +
        (extra || '') + '</div>';
    }
    // Карточка «Заряд» в форме: уменьшенная копия лица, которое рисует оболочка (QrBattery.kt; числа — доли ширины карточки ×100, образец 78 % / 64 %)
    var WH = ' fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"';
    var ICON_SCALE = 1.5; // как ICON_SCALE в QrBattery.kt: значок и кольцо крупнее исходных, толщина линий прежняя
    // Значок устройства с центром (cx, cy): phone / headphones / watch / speaker / generic (знак Bluetooth)
    function iconSvg(kind, cx, cy){
      var sw = ' stroke-width="' + (1.26 / ICON_SCALE).toFixed(3) + '"', t = '';
      if(kind === "headphones"){
        var ac = cy + 0.63, ct = cy + 1.31, cb = cy + 5.48, L = cx - 4.87, R = cx + 4.87;
        t += '<path d="M' + L + ' ' + ac + ' A4.87 4.87 0 0 1 ' + R + ' ' + ac + '"' + WH + sw + '/>';
        t += '<path d="M' + L + ' ' + ac + ' V' + (ct + 1.49) + ' M' + R + ' ' + ac + ' V' + (ct + 1.49) + '"' + WH + sw + '/>';
        t += '<rect x="' + L + '" y="' + ct + '" width="2.98" height="' + (cb - ct) + '" rx="1.49"' + WH + sw + '/>';
        t += '<rect x="' + (R - 2.98) + '" y="' + ct + '" width="2.98" height="' + (cb - ct) + '" rx="1.49"' + WH + sw + '/>';
      } else if(kind === "watch"){
        t += '<rect x="' + (cx - 3.2) + '" y="' + (cy - 3.4) + '" width="6.4" height="6.8" rx="1.4"' + WH + sw + '/>';
        t += '<rect x="' + (cx - 1.7) + '" y="' + (cy - 5.8) + '" width="3.4" height="2.4" rx="0.8"' + WH + sw + '/>';
        t += '<rect x="' + (cx - 1.7) + '" y="' + (cy + 3.4) + '" width="3.4" height="2.4" rx="0.8"' + WH + sw + '/>';
      } else if(kind === "speaker"){
        t += '<rect x="' + (cx - 3.5) + '" y="' + (cy - 5.5) + '" width="7" height="11" rx="1.6"' + WH + sw + '/>';
        t += '<circle cx="' + cx + '" cy="' + (cy - 3) + '" r="0.9" fill="#fff"/>';
        t += '<circle cx="' + cx + '" cy="' + (cy + 1.8) + '" r="2.2"' + WH + sw + '/>';
      } else if(kind === "earbuds"){
        [-1, 1].forEach(function(sg){
          t += '<circle cx="' + (cx + sg * 2.8) + '" cy="' + (cy - 1.4) + '" r="1.8"' + WH + sw + '/>';
          t += '<path d="M' + (cx + sg * 4.4) + ' ' + (cy - 1.4) + ' V' + (cy + 4) + '"' + WH + sw + '/>';
        });
      } else if(kind === "keyboard"){
        t += '<rect x="' + (cx - 5.2) + '" y="' + (cy - 3) + '" width="10.4" height="6" rx="0.8"' + WH + sw + '/>';
        for(var k = -2; k <= 2; k++){
          t += '<circle cx="' + (cx + k * 1.6) + '" cy="' + (cy - 1.5) + '" r="0.45" fill="#fff"/>';
          t += '<circle cx="' + (cx + k * 1.6) + '" cy="' + (cy - 0.3) + '" r="0.45" fill="#fff"/>';
        }
        t += '<path d="M' + (cx - 2.6) + ' ' + (cy + 1.5) + ' H' + (cx + 2.6) + '"' + WH + sw + '/>';
      } else if(kind === "laptop"){
        t += '<rect x="' + (cx - 3.6) + '" y="' + (cy - 4) + '" width="7.2" height="5.6" rx="0.6"' + WH + sw + '/>';
        t += '<path d="M' + (cx - 5) + ' ' + (cy + 3.4) + ' H' + (cx + 5) + '"' + WH + sw + '/>';
      } else if(kind === "tablet"){
        t += '<rect x="' + (cx - 5.8) + '" y="' + (cy - 4.2) + '" width="11.6" height="8.4" rx="1"' + WH + sw + '/>';
        t += '<circle cx="' + (cx + 4.6) + '" cy="' + cy + '" r="0.5" fill="#fff"/>';
      } else if(kind === "shutter"){
        t += '<circle cx="' + cx + '" cy="' + cy + '" r="4"' + WH + sw + '/>';
        t += '<circle cx="' + cx + '" cy="' + cy + '" r="2.2" fill="#fff"/>';
      } else if(kind === "generic"){
        t += '<path d="M' + (cx - 2.8) + ' ' + (cy - 2.6) + ' L' + (cx + 2.8) + ' ' + (cy + 2.6) + ' L' + cx + ' ' + (cy + 5.4) + ' L' + cx + ' ' + (cy - 5.4) + ' L' + (cx + 2.8) + ' ' + (cy - 2.6) + ' L' + (cx - 2.8) + ' ' + (cy + 2.6) + '"' + WH + sw + '/>';
      } else {
        var mid = cy + 0.57;
        t += '<rect x="' + (cx - 3.67) + '" y="' + (mid - 5.47) + '" width="7.34" height="10.94" rx="1.27"' + WH + sw + '/>';
        t += '<rect x="' + (cx - 1.2) + '" y="' + (mid - 5.87) + '" width="2.4" height="1.63" rx="0.63" fill="#fff"/>';
        t += '<circle cx="' + cx + '" cy="' + (mid + 3.16) + '" r="0.64" fill="#fff"/>';
      }
      return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + ICON_SCALE + ') translate(' + (-cx) + ' ' + (-cy) + ')">' + t + '</g>';
    }
    // Кольцо заряда (доля pct, 0..100) со значком внутри
    function ringSvg(cx, cy, pct, kind){
      var r = 12.63 * ICON_SCALE, c = 2 * Math.PI * r, t = "";
      t += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.12"/>';
      t += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) + '"' + WH + ' stroke-width="2.12" stroke-dasharray="' + (c * pct / 100).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      return t + iconSvg(kind, cx, cy);
    }
    function batFaceHtml(w){
      var hex = batHex(w), shade = cardsOf().cardShade(hex);
      function col(cx, pct, hp){
        var cy = 31, t = ringSvg(cx, cy, pct, hp ? "headphones" : "phone");
        t += '<text x="' + cx + '" y="58.2" font-size="5.11" text-anchor="middle" fill="#fff" font-family="sans-serif">Заряд</text>';
        t += '<text x="' + cx + '" y="66.7" font-size="6.5" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">' + (hp ? "Наушники" : "Телефон") + '</text>';
        t += '<text x="' + cx + '" y="85.7" font-size="16" text-anchor="middle" fill="#fff" font-weight="900" font-family="sans-serif">' + pct + '%</text>';
        return t;
      }
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + col(26.8, 78, false) + col(73.2, 64, true) + '</svg></div>';
    }
    // Карточка «несколько устройств» в форме: четыре кольца без надписей (образец; в виджете — телефон и до трёх подключённых Bluetooth-устройств)
    function bat2FaceHtml(w){
      var hex = bat2Hex(w), shade = cardsOf().cardShade(hex);
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' +
        ringSvg(26.8, 31, 78, "phone") + ringSvg(73.2, 31, 64, "headphones") + ringSvg(26.8, 74, 52, "watch") + ringSvg(73.2, 74, 90, "speaker") + '</svg></div>';
    }
    // Карточка задачи / события в форме: образец лица (в виджете — настоящие задачи и событие; числа — доли ширины карточки ×100, см. DYN)
    function dynFaceHtml(kind, hex){
      var shade = cardsOf().cardShade(hex), smp = DYN_SAMPLE[kind], u = DYN.unit * 100;
      var t = '<g transform="translate(' + (50 - 12 * u).toFixed(2) + ' ' + (DYN.iconTop * 100 - 2 * u).toFixed(2) + ') scale(' + u.toFixed(4) + ')" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + DYN_ICONS[kind] + '</g>';
      t += '<text x="50" y="' + (DYN.labelBase * 100).toFixed(1) + '" font-size="' + (DYN.labelFsMax * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-family="sans-serif">' + DYN_LABELS.today + ', ' + WEEKDAYS_FULL[4] + '</text>';
      t += '<text x="50" y="' + (DYN.titleBase * 100).toFixed(1) + '" font-size="' + (DYN.titleFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" font-family="\'Palatino Linotype\',Georgia,serif">' + esc(smp.title) + '</text>';
      t += '<text x="50" y="' + (DYN.timeBase * 100).toFixed(1) + '" font-size="' + (DYN.timeFs * 100).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="700" font-family="sans-serif">' + smp.time + '</text>';
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    // Карточка «Как тренировка?» в форме: образец лица (в виджете её рисует оболочка, QrRpe.kt; числа — доли ширины карточки ×100: значок «календарь с галочкой» (клетка 0,96), две строки заголовка, сетка кнопок 2×5)
    function rpeFaceHtml(){
      var hex = RPE_COLOR, shade = cardsOf().cardShade(hex), serif = "font-family=\"'Palatino Linotype',Georgia,serif\"";
      var t = '<g transform="translate(38.48 3.5) scale(0.96)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M11.5 21h-5.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/><path d="M15 19l2 2l4 -4"/></g>';
      t += '<text x="50" y="41.3" font-size="13" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>Как</text>';
      t += '<text x="50" y="54.2" font-size="13" text-anchor="middle" fill="#fff" font-weight="700" textLength="82" lengthAdjust="spacingAndGlyphs" ' + serif + '>тренировка?</text>';
      for(var i = 0; i < 10; i++){
        var x = 4.7 + (i % 5) * 18.73, y = i < 5 ? 62.06 : 80.88;
        t += '<rect x="' + (x + 0.48).toFixed(2) + '" y="' + (y + 0.48).toFixed(2) + '" width="14.74" height="14.54" rx="2.9" fill="none" stroke="#fff" stroke-width="0.95"/>';
        t += '<text x="' + (x + 7.85).toFixed(2) + '" y="' + (y + 9.7).toFixed(2) + '" font-size="5.5" text-anchor="middle" fill="#fff" font-weight="700" ' + serif + '>' + (i + 1) + '</text>';
      }
      return '<div class="wg-card wg-bat-card" style="background:' + hex + ';box-shadow:0 4px 0 ' + shade + ';"><svg viewBox="0 0 100 102" aria-hidden="true">' + t + '</svg></div>';
    }
    function tasksFaceHtml(w){ return dynFaceHtml("task", dynHex(w, "task")); }
    function eventsFaceHtml(w){ return dynFaceHtml("event", dynHex(w, "event")); }
    // Строка списка виджетов: что в стопке, кроме карточек QR-кодов
    function contentText(w){
      var extra = [];
      if(w.battery) extra.push("заряд");
      if(w.batteryMulti) extra.push("заряд устройств");
      if(w.tasks) extra.push("задачи");
      if(w.events) extra.push("события");
      if(w.rpeAsk) extra.push("вопрос о тренировке");
      if(w.cards.length) return cardWord(w.cards.length) + (extra.length ? " + " + extra.join(" + ") : "");
      if(!extra.length) return cardWord(0);
      return (w.battery && extra.length === 1) ? "заряд аккумулятора" : extra.join(" + ");
    }
    var ICON_NAMES = { phone: "телефон", headphones: "наушники", earbuds: "наушники-вкладыши", watch: "часы", speaker: "колонка", keyboard: "клавиатура", laptop: "ноутбук", tablet: "планшет", shutter: "кнопка съёмки", generic: "значок Bluetooth" };
    // Парные Bluetooth-устройства телефона (из оболочки, поле bt.devices): имена и значок, который им достанется
    function batDevicesText(){
      var st = nativeState(), bt = st && st.bt, ds = bt && bt.devices;
      if(!ds || !ds.length) return "";
      return "Парные Bluetooth-устройства (значок): " + ds.map(function(d){ return (d.name || "без имени") + " (" + (ICON_NAMES[d.icon] || ICON_NAMES.generic) + (d.on ? ", подключено" : "") + ")"; }).join("; ") + ".";
    }
    // Что с наушниками сейчас (из оболочки, поле bt в widgetsState): причина, по которой в карточке «Заряд» нет их заряда
    function batStatusText(){
      var st = nativeState(), bt = st && st.bt;
      if(!bt) return "";
      var n = bt.name ? " «" + bt.name + "»" : "";
      if(bt.reason === "ok") return "Наушники" + n + ": заряд " + bt.level + " %.";
      if(bt.reason === "nolevel") return "Наушники" + n + " подключены, но телефон пока не передал их заряд — в карточке «--%». Заряд появится, когда наушники сообщат его (обычно при подключении или смене заряда).";
      if(bt.reason === "perm") return "Нет доступа к Bluetooth: разрешите приложению «Устройства поблизости» (настройки телефона → Приложения → Разрешения). Пока в карточке только телефон.";
      if(bt.reason === "off") return "Bluetooth выключен — в карточке только телефон.";
      if(bt.reason === "nobt") return "На этом телефоне нет Bluetooth — в карточке только телефон.";
      return "Подключённых Bluetooth-наушников не найдено — в карточке только телефон.";
    }
    function fabRow(inner){ return '<div class="mdeditor-fab-row">' + inner + '</div>'; }
    function homeBtn(title, disabled){
      return '<button type="button" class="mdeditor-fab-btn" id="wgHomeBtn" title="' + esc(title) + '"' + (disabled ? ' tabindex="-1" aria-disabled="true"' : '') + '>' + HOME_SVG + '</button>';
    }
    function modeText(w){
      if(w.rotate) return "по кругу, раз в " + w.rotateMin + " мин";
      if(w.relevance) return "по релевантности";
      return "листаете сами";
    }
    function cardWord(n){
      var m = n % 10, h = n % 100;
      return n + " " + (m === 1 && h !== 11 ? "карточка" : ((m >= 2 && m <= 4 && (h < 12 || h > 14)) ? "карточки" : "карточек"));
    }

    function listHtml(){
      var st = nativeState(), placed = (st && st.placed) || {};
      var html = '<h3 class="common-tab-title">Конструктор виджетов</h3>';
      if(!data.list.length){
        html += '<div class="wg-empty">Виджетов пока нет.<br>Нажмите «+», чтобы собрать стопку из карточек QR-кодов.</div>';
      }
      data.list.forEach(function(w){
        var f = w.cards.length ? cardsOf().widgetFace(w.cards[0].cid) : null;
        html += '<div class="wg-row" data-id="' + esc(w.id) + '">' +
          '<div class="wg-row-ico" style="background:' + (f ? f.color : (w.battery ? batHex(w) : (w.batteryMulti ? bat2Hex(w) : (w.tasks ? dynHex(w, "task") : (w.events ? dynHex(w, "event") : "var(--gold)"))))) + ';"></div>' +
          '<div class="wg-row-txt"><div class="wg-row-name">' + esc(wname(w)) + '</div>' +
          '<div class="wg-row-sub">' + contentText(w) + ' · ' + modeText(w) + (placed[w.id] ? ' · на рабочем столе' : '') + '</div></div></div>';
      });
      if(!bridge()) html += '<div class="wg-hint">Виджеты работают только в приложении на телефоне (Android).</div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn" id="wgAddBtn" title="Новый виджет">' + PLUS_SVG + '</button>' + homeBtn("", true));
      return html;
    }

    function formHtml(a){
      var w = a.w, html = '<h3 class="common-tab-title">' + esc(wname(w)) + '</h3><div class="wg-slots">';
      for(var i = 0; i < w.cards.length; i++){
        var c = w.cards[i], f = cardsOf().widgetFace(c.cid);
        if(f){
          var sched = (c.times.length || c.days.length) ? '<div class="wg-badge">⏰</div>' : '';
          html += '<div class="wg-slot" data-i="' + i + '">' + faceHtml(f, "", sched) + '</div>';
        } else {
          html += '<div class="wg-slot" data-i="' + i + '"><div class="wg-slot-empty">?</div></div>'; // карточку удалили
        }
      }
      if(w.cards.length < MAX_CARDS) html += '<div class="wg-slot" data-add="1"><div class="wg-slot-empty">' + PLUS_SVG + '</div></div>'; // всегда одна «+», пока не достигнут предел
      if(w.battery) html += '<div class="wg-slot" data-bat="1" id="wgBatSlot">' + batFaceHtml(w) + '</div>'; // карточка заряда — последняя в стопке, после слотов и «+»
      if(w.batteryMulti) html += '<div class="wg-slot" data-bat="1" id="wgBat2Slot">' + bat2FaceHtml(w) + '</div>'; // карточка заряда нескольких устройств — после карточки заряда
      if(w.tasks) html += '<div class="wg-slot" data-bat="1" id="wgTasksSlot">' + tasksFaceHtml(w) + '</div>'; // образец карточки задачи (в виджете их столько, сколько задач)
      if(w.events) html += '<div class="wg-slot" data-bat="1" id="wgEventsSlot">' + eventsFaceHtml(w) + '</div>'; // образец карточки события
      if(w.rpeAsk) html += '<div class="wg-slot" data-bat="1" id="wgRpeSlot">' + rpeFaceHtml() + '</div>'; // образец «Как тренировка?» (в виджете она стоит над всеми карточками, пока есть запись без оценки)
      html += '</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgRotate"' + (w.rotate ? ' checked' : '') + '>Переключать виджеты по кругу</label>';
      if(w.rotate) html += '<div class="wg-min">каждые<input type="number" id="wgRotMin" min="1" max="720" value="' + w.rotateMin + '">мин</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgRel"' + (w.relevance ? ' checked' : '') + '>Переключение по релевантности</label>';
      html += '<div class="wg-hint">По кругу — карточки сменяют друг друга сами. По релевантности — наверху то, что запущено сейчас (тренировка, затем помодоро, затем таймеры и секундомер), следом карточки, у которых сейчас их время суток и день. Включить можно что-то одно.</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgBat"' + (w.battery ? ' checked' : '') + '>Отображать заряд аккумулятора (наушники и телефон)</label>';
      html += '<div class="wg-hint">В стопке появится карточка с зарядом телефона и, если подключены Bluetooth-наушники, их заряда. Нет галочки — карточки в стопке нет.</div>';
      if(w.battery){
        html += cardsOf().colorPalette("battery");
        var bst = batStatusText();
        if(bst) html += '<div class="wg-bat-status" id="wgBatStatus">' + esc(bst) + '</div>';
      }
      html += '<label class="wg-check"><input type="checkbox" id="wgBat2"' + (w.batteryMulti ? ' checked' : '') + '>Отображать заряд аккумулятора (несколько устройств)</label>';
      html += '<div class="wg-hint">Ещё одна карточка в стопке — без надписей, только значки и кольца заряда: телефон и до трёх подключённых Bluetooth-устройств (наушники, часы, колонка и т. п.).</div>';
      if(w.batteryMulti){
        html += cardsOf().colorPalette("battery2", "icfColors2");
        var dst = batDevicesText();
        if(dst) html += '<div class="wg-bat-status" id="wgBat2Status">' + esc(dst) + '</div>';
      }
      html += '<label class="wg-check"><input type="checkbox" id="wgTasks"' + (w.tasks ? ' checked' : '') + '>Показывать задачи</label>';
      html += '<div class="wg-hint">Каждая невыполненная задача из календаря на сегодня — отдельная карточка. Если задачу не отметить, на карточке вместо «Сегодня» будет «Просрочено», и она остаётся в стопке, пока вы её не отметите. Нет галочки — карточек задач в стопке нет.</div>';
      if(w.tasks) html += cardsOf().colorPalette("wgtasks", "icfColors3");
      html += '<label class="wg-check"><input type="checkbox" id="wgEvents"' + (w.events ? ' checked' : '') + '>Показывать события календаря</label>';
      html += '<div class="wg-hint">Одна карточка — следующее запланированное событие, с надписью «Сегодня, Четверг» или «Завтра, Суббота» (день недели — когда состоится событие). Если ни сегодня, ни завтра событий нет, карточки в стопке нет. Нет галочки — карточки события в стопке нет.</div>';
      if(w.events) html += cardsOf().colorPalette("wgevents", "icfColors4");
      html += '<label class="wg-check"><input type="checkbox" id="wgRpe"' + (w.rpeAsk ? ' checked' : '') + '>Спрашивать о тренировке</label>';
      html += '<div class="wg-hint">После тренировки, пока вы не оценили нагрузку, наверху стопки появляется карточка «Как тренировка?» с кнопками от 1 до 10. Нажатие на число сразу сохраняет оценку, и карточка исчезает. Если пролистнуть на другую карточку, через минуту она вернётся наверх; порядок остальных карточек не меняется. Нет галочки — карточки нет.</div>';
      var st = nativeState(), placed = st && st.placed && st.placed[w.id];
      html += '<div class="wg-btns">';
      if(bridge()) html += '<button type="button" class="workbooks-run-btn" id="wgPinBtn">' + (placed ? 'Добавить ещё один на рабочий стол' : 'Добавить на рабочий стол') + '</button><div class="wg-hint" id="wgPinHint"></div>';
      html += '<button type="button" class="workbooks-run-btn" id="wgDelBtn">Удалить виджет</button></div>';
      html += fabRow(homeBtn("К списку виджетов"));
      return html;
    }

    function cardHtml(a){
      var w = a.w, c = w.cards[a.i], f = c ? cardsOf().widgetFace(c.cid) : null;
      if(!c) return '';
      var html = '<h3 class="common-tab-title">Карточка ' + (a.i + 1) + ' из ' + w.cards.length + '</h3>';
      if(f) html += '<div class="wg-preview">' + faceHtml(f, "") + '</div>';
      html += '<div class="wg-sec">Время суток</div><div class="wg-chips" id="wgTimes">';
      WINDOWS.forEach(function(t){ html += '<div class="wg-chip' + (c.times.indexOf(t.k) >= 0 ? ' on' : '') + '" data-k="' + t.k + '">' + t.label + '<small>' + t.hint + ' ч</small></div>'; });
      html += '</div><div class="wg-sec">Дни недели</div><div class="wg-chips" id="wgDays">';
      DAYS.forEach(function(d, i){ html += '<div class="wg-chip' + (c.days.indexOf(i + 1) >= 0 ? ' on' : '') + '" data-d="' + (i + 1) + '">' + d + '</div>'; });
      html += '</div><div class="wg-hint">Необязательно. Если выбрать, карточка поднимается наверх в эти часы и дни — при включённом «Переключении по релевантности». Если не выбрано ничего, она ничем не выделяется.</div>';
      html += '<div class="wg-sec">После срабатывания</div><select class="mdeditor-cleanup-input" id="wgAfter" aria-label="После срабатывания карточки">' +
        AFTERS.map(function(o){ return '<option value="' + o.k + '"' + (normAfter(c.after) === o.k ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') + '</select>' +
        '<div class="wg-hint">Что делать с карточкой в стопке, когда её действие сработало — по нажатию в виджете, в приложении или по скану кода. Скрытая карточка возвращается на следующий день; если скрыты все, виджет пишет «На сегодня больше ничего».</div>';
      html += '<div class="wg-btns"><button type="button" class="workbooks-run-btn" id="wgReplaceBtn">Заменить карточку</button>' +
        '<button type="button" class="workbooks-run-btn" id="wgRemoveBtn">Убрать из виджета</button></div>';
      html += fabRow(homeBtn("К виджету"));
      return html;
    }

    function pickFilter(){ var v = "all"; try{ v = localStorage.getItem(PICK_FILTER_KEY) || "all"; }catch(e){} return v; }
    function pickHtml(a){
      var filters = cardsOf().widgetFilters(), fk = pickFilter();
      if(!filters.some(function(f){ return f.key === fk; })) fk = "all";
      var used = {}; a.w.cards.forEach(function(c, i){ if(i !== a.replace) used[c.cid] = 1; });
      var list = cardsOf().widgetCards(fk);
      var html = '<h3 class="common-tab-title">Выберите карточку</h3><div class="wg-slots">';
      if(!list.length) html += '<div class="wg-empty">Нет подходящих карточек.</div>';
      list.forEach(function(f){
        html += '<div class="wg-slot" data-cid="' + esc(f.id) + '"' + (used[f.id] ? ' data-used="1"' : '') + '>' + faceHtml(f, used[f.id] ? "used" : "") + '</div>';
      });
      html += '</div>';
      html += '<div class="wg-menu" id="wgFilterMenu" style="display:none;">' + filters.map(function(f){
        return '<button type="button" class="workbooks-run-btn' + (f.key === fk ? ' selected' : '') + '" data-filter="' + f.key + '">' + esc(f.label) + '</button>';
      }).join('') + '</div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn' + (fk !== "all" ? ' pressed' : '') + '" id="wgFilterBtn" title="Показать карточки">' + FILTER_SVG + '</button>' + homeBtn("К виджету"));
      return html;
    }

    // ---------- отрисовка и события ----------
    function render(){
      var el = document.getElementById("settingsTabContent");
      if(!el) return;
      ensureStyles();
      var top = cur(), body = "";
      if(top.s === "list") body = listHtml();
      else if(top.s === "form") body = formHtml(top.a);
      else if(top.s === "card") body = cardHtml(top.a);
      else if(top.s === "pick") body = pickHtml(top.a);
      el.innerHTML = '<div class="mdeditor-tab widgets-tab" id="widgetsTabRoot">' + body + '</div>';
      bind(top);
    }
    function $(id){ return document.getElementById(id); }
    function bind(top){
      var root = rootEl(); if(!root) return;
      var home = $("wgHomeBtn");
      if(home && !home.getAttribute("aria-disabled")) home.addEventListener("click", function(){ if(top.s === "form") homeUi(); else backUi(); });
      if(top.s === "list"){
        $("wgAddBtn").addEventListener("click", function(){
          var w = { id: "w" + Date.now().toString(36), n: data.n + 1, cards: [], rotate: false, rotateMin: 5, relevance: true }; // у нового виджета «Переключение по релевантности» включено по умолчанию
          go("form", { w: w, draft: true });
        });
        Array.prototype.forEach.call(root.querySelectorAll(".wg-row"), function(r){
          r.addEventListener("click", function(){ var w = widgetById(r.getAttribute("data-id")); if(w) go("form", { w: w }); });
        });
      } else if(top.s === "form"){
        bindForm(top.a);
      } else if(top.s === "card"){
        bindCard(top.a);
      } else if(top.s === "pick"){
        bindPick(top.a);
      }
    }
    function commitDraft(a){
      if(a.draft && hasContent(a.w)){ a.draft = false; data.n = Math.max(data.n, a.w.n); data.list.push(a.w); }
    }
    function bindForm(a){
      var w = a.w;
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-slot"), function(s){
        s.addEventListener("click", function(){
          if(s.getAttribute("data-bat")) return; // карточку заряда не выбирают и не настраивают по времени — только цвет под галочкой
          if(s.getAttribute("data-add")) go("pick", { w: w, draft: a.draft, replace: -1, form: a });
          else go("card", { w: w, i: parseInt(s.getAttribute("data-i"), 10), form: a });
        });
      });
      var rot = $("wgRotate"), rel = $("wgRel");
      rot.addEventListener("change", function(){ w.rotate = rot.checked; if(w.rotate) w.relevance = false; commitDraft(a); changed(); render(); });
      rel.addEventListener("change", function(){ w.relevance = rel.checked; if(w.relevance) w.rotate = false; commitDraft(a); changed(); render(); });
      var bat = $("wgBat");
      bat.addEventListener("change", function(){
        w.battery = bat.checked;
        if(w.battery) w.batColor = cardsOf().defaultColor("battery"); // запомненный цвет (как у новых карточек QR-кодов), иначе сиреневый
        commitDraft(a); changed(); render();
      });
      var bat2 = $("wgBat2");
      bat2.addEventListener("change", function(){
        w.batteryMulti = bat2.checked;
        if(w.batteryMulti) w.bat2Color = cardsOf().defaultColor("battery2");
        commitDraft(a); changed(); render();
      });
      var tk = $("wgTasks");
      tk.addEventListener("change", function(){
        w.tasks = tk.checked;
        if(w.tasks) w.tasksColor = dynColorFor("task");
        commitDraft(a); changed(); render();
      });
      var ev = $("wgEvents");
      ev.addEventListener("change", function(){
        w.events = ev.checked;
        if(w.events) w.eventsColor = dynColorFor("event");
        commitDraft(a); changed(); render();
      });
      var rpe = $("wgRpe");
      rpe.addEventListener("change", function(){
        w.rpeAsk = rpe.checked;
        commitDraft(a); changed(); render();
      });
      // палитры цвета карточек: [id палитры, поле цвета, ключ запомненного цвета, id места карточки, лицо карточки, вид динамической карточки]
      [["icfColors", "batColor", "battery", "wgBatSlot", batFaceHtml], ["icfColors2", "bat2Color", "battery2", "wgBat2Slot", bat2FaceHtml],
       ["icfColors3", "tasksColor", "", "wgTasksSlot", tasksFaceHtml, "task"], ["icfColors4", "eventsColor", "", "wgEventsSlot", eventsFaceHtml, "event"]].forEach(function(p){
        var colorsEl = $(p[0]);
        if(!colorsEl) return;
        var markColors = function(){
          var bs = colorsEl.querySelectorAll(".habit-color");
          for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].getAttribute("data-color") === (w[p[1]] || ""));
        };
        markColors();
        colorsEl.addEventListener("click", function(e){
          var b = e.target.closest(".habit-color");
          if(!b) return;
          w[p[1]] = b.getAttribute("data-color") || ""; // "" — по умолчанию (сиреневый)
          if(p[5]) rememberDynColor(p[5], w[p[1]]); else cardsOf().rememberColor(p[2], w[p[1]]);
          markColors();
          var slot = $(p[3]); if(slot) slot.innerHTML = p[4](w);
          commitDraft(a); changed();
        });
      });
      var mn = $("wgRotMin");
      if(mn) mn.addEventListener("change", function(){ w.rotateMin = Math.max(1, Math.min(720, parseInt(mn.value, 10) || 5)); mn.value = w.rotateMin; commitDraft(a); changed(); });
      var pin = $("wgPinBtn");
      if(pin) pin.addEventListener("click", function(){
        var hint = $("wgPinHint");
        if(!hasContent(w)){ hint.textContent = "Сначала добавьте в виджет карточку или включите одну из галочек (заряд, задачи, события)."; return; }
        commitDraft(a); save();
        hint.textContent = "Готовлю…";
        syncNow().then(function(ok){
          if(!ok){ hint.textContent = "Не удалось передать виджет оболочке."; return; }
          var res = "failed";
          try{ res = String(bridge().widgetPin(w.id)); }catch(e){}
          hint.textContent = res === "requested" ? "Подтвердите добавление на рабочем столе."
            : "Рабочий стол не принял запрос. Добавьте виджет «Стопка QR-карточек» через меню виджетов (долгое нажатие на пустом месте рабочего стола) и выберите «" + wname(w) + "».";
        });
      });
      var del = $("wgDelBtn"), armedDel = false;
      del.addEventListener("click", function(){
        if(!armedDel){ armedDel = true; del.textContent = "Нажмите ещё раз — удалить"; setTimeout(function(){ armedDel = false; if(del.parentNode) del.textContent = "Удалить виджет"; }, 3500); return; }
        data.list = data.list.filter(function(x){ return x.id !== w.id; });
        a.draft = false; changed(); homeUi();
      });
    }
    function bindCard(a){
      var c = a.w.cards[a.i]; if(!c) return;
      function toggle(arr, v){ var i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); arr.sort(); }
      Array.prototype.forEach.call($("wgTimes").children, function(ch){
        ch.addEventListener("click", function(){ toggle(c.times, ch.getAttribute("data-k")); ch.classList.toggle("on"); changed(); });
      });
      Array.prototype.forEach.call($("wgDays").children, function(ch){
        ch.addEventListener("click", function(){ toggle(c.days, parseInt(ch.getAttribute("data-d"), 10)); ch.classList.toggle("on"); changed(); });
      });
      var aft = $("wgAfter");
      if(aft) aft.addEventListener("change", function(){ c.after = normAfter(aft.value); changed(); });
      $("wgReplaceBtn").addEventListener("click", function(){ go("pick", { w: a.w, draft: false, replace: a.i, form: a }); });
      $("wgRemoveBtn").addEventListener("click", function(){ a.w.cards.splice(a.i, 1); changed(); backUi(); });
    }
    function bindPick(a){
      var menu = $("wgFilterMenu");
      $("wgFilterBtn").addEventListener("click", function(e){ e.stopPropagation(); menu.style.display = menu.style.display === "none" ? "block" : "none"; });
      Array.prototype.forEach.call(menu.querySelectorAll("button"), function(b){
        b.addEventListener("click", function(){
          try{ var k = b.getAttribute("data-filter"); if(k === "all") localStorage.removeItem(PICK_FILTER_KEY); else localStorage.setItem(PICK_FILTER_KEY, k); }catch(e){}
          render();
        });
      });
      rootEl().addEventListener("click", function(e){ if(menu.style.display !== "none" && !menu.contains(e.target)) menu.style.display = "none"; }, true);
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-slot[data-cid]"), function(s){
        s.addEventListener("click", function(){
          if(s.getAttribute("data-used")) return;
          var cid = s.getAttribute("data-cid"), w = a.w;
          if(a.replace >= 0 && w.cards[a.replace]) w.cards[a.replace].cid = cid;
          else if(w.cards.length < MAX_CARDS) w.cards.push({ cid: cid, times: [], days: [], after: "none" });
          var form = a.form && a.form.draft !== undefined ? a.form : null;
          if(a.draft && form) commitDraft(form);
          changed();
          backUi();
        });
      });
    }

    function renderTab(){
      if(armed){ armed.active = false; armed = null; }
      stack = [{ s: "list" }];
      data = load();
      render();
    }

    return { render: renderTab, scheduleSync: scheduleSync, syncNow: syncNow, feedChanged: feedChanged, hasWidgets: function(){ return data.list.length > 0 || !!data.ever; } };
  };
})();
