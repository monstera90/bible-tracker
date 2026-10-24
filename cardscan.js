/* ===========================================================================
   cardscan.js
   Версия: 2.5 (24.10) — `parseCode` узнаёт QR будильника `lt://v1/alarm/<ЧЧММ>[,<5|15|30>,<1..4>][/<название>]` → `{kind:"alarm", hour, minute, every, times, title}` (`every`/`times` — 0, если повтора нет); для будильника, как для таймера, нужно удержание от 0,5 с. Откат: cardscan.js 2.4.
   Версия: 2.4 (24.10) — `parseCode` узнаёт QR скрытого таймера `lt://v1/htimer/<секунды>[/<название>]` → `{kind:"timer", seconds, title, hidden:true}` (остальное — как у обычного таймера, в том числе удержание 0,5 с). Откат: cardscan.js 2.3.
   Версия: 2.3 (24.10) — `parseCode` узнаёт QR привычки `lt://v1/habit/<id>/<название>` → `{kind:"habit", id, title}` (код сам несёт название: на устройстве без такой карточки приложение создаёт её по коду); такой код, как и таймер/задача, принимается после удержания ≥ HOLD_SIDE_EFFECT_MS. Откат: cardscan.js 2.2.
   Версия: 2.2 (23.10) — `open({longHold})`: приложение может пометить код как «с побочным эффектом» (скан карточки-привычки отмечает день без отмены) — для него удержание не меньше 0,5 с, как у таймера и задачи. Откат: cardscan.js 2.1.
   Версия: 2.1 (22.10) — удержание стало терпимым к дрожи руки: допуск ухода кода от якоря 20% зоны (было 6%), якорь плавно следует за кодом, уход кода от якоря не обнуляет счёт, а даёт штраф 150 мс (дрожь в допуске штрафа не даёт, а код, который проносят через зону, штрафуется чаще, чем копит); пропадание кода до 0,4 с (смаз) счёт не трогает, дольше — откат с обычной скоростью; другой текст кода переключает счёт, только если держится 3 кадра подряд. Откат: cardscan.js 2.0.
   Версия: 2.0 (22.10) — структурная правка: код принимается не мгновенно, а после удержания. Нужен один и тот же код, почти неподвижный в зоне прицела (в окне ярлыка — всё окно, на весь экран — центральные 70%); код вне зоны и совсем мелкий игнорируются. Время удержания 0,25 с в центре зоны, до 0,6 с у края, для таймера и «Создавать задачу» не меньше 0,5 с; сдвиг кода или другой код — отсчёт не идёт, а откатывается. Вокруг кода рисуется фиолетовый (#7F00FF) скруглённый контур (SVG `.scan-lock`): бледный — «вижу, жду», яркий бежит по часовой стрелке с левого верхнего угла и замыкается; внутри заливка 15%. Приём — лёгкая вибрация, без вспышки. Откат: cardscan.js 1.8.
   Версия: 1.8 (22.10) — QR «Создавать задачу» может нести тег-категорию: `lt://v1/task/<ключ вкладки>#<тег>/<текст>` → `{kind:"task", tab, tag, text}` (без `#<тег>` — как раньше, `tag:""`). Откат: cardscan.js 1.7.
   Версия: 1.7 (22.10) — `parseCode` узнаёт QR «Создавать задачу» `lt://v1/task/<ключ вкладки>/<текст задачи>` → `{kind:"task", tab, text}` (код сам несёт задачу, карточка на устройстве не нужна). Откат: cardscan.js 1.6.
   Версия: 1.6 (22.10) — `parseCode` узнаёт одинаковые у всех коды «Сегодня» `lt://v1/today` → `{kind:"today"}` и «Напоминалки» `lt://v1/reminder` → `{kind:"reminder"}` (карточка на устройстве не нужна: открывается то, что есть у того, кто сканирует). Откат: cardscan.js 1.5.
   Версия: 1.5 (21.10) — `parseCode` явно срезает BOM (\uFEFF), который библиотека QR ставит перед текстом с кириллицей (название таймера). Откат: cardscan.js 1.4.
   Версия: 1.4 (21.10) — `parseCode` узнаёт QR таймера `lt://v1/timer/<секунды>[/<название>]` → `{kind:"timer", seconds, title}` (код сам несёт таймер, карточка на устройстве не нужна). Откат: cardscan.js 1.3.
   Версия: 1.3 (21.10) — `parseCode` узнаёт QR заметки `lt://v1/note/<id>` → `{kind:"note", id}` (QR строит кнопка в редакторе заметок, mdeditor.js).
   Версия: 1.2 (20.10) — в окне ярлыка (`windowed`) кнопки «Назад» нет: выход — нажатие мимо окна камеры (`onBack`).
   Версия: 1.1 (20.10) — `open({windowed:true})` (окно ярлыка): видоискатель только в центральном окне с зелёной рамкой, вокруг прозрачно (виден рабочий стол); до первого кадра вместо растянутой заглушки WebView — серая заглушка внутри окна.
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
  var NOTE_PREFIX = "lt://v1/note/";
  var TIMER_PREFIX = "lt://v1/timer/";
  var HTIMER_PREFIX = "lt://v1/htimer/"; // скрытый таймер: тот же код, но без острова
  var ALARM_PREFIX = "lt://v1/alarm/";   // будильник: время, повтор и название в коде
  var HABIT_PREFIX = "lt://v1/habit/";
  var TASK_PREFIX = "lt://v1/task/";
  var TODAY_CODE = "lt://v1/today";       // «Сегодня»: один и тот же код у всех, заметку создаёт тот, кто сканирует
  var REMINDER_CODE = "lt://v1/reminder"; // «Напоминалка»: один и тот же код у всех, напоминание берётся у того, кто сканирует

  // Разбор текста из QR:
  //   {kind:"card", id}   — код карточки приложения (lt://v1/card/<id>)
  //   {kind:"timer", seconds, title[, hidden:true]} — таймер, зашитый в код (lt://v1/timer/<секунды>[/<название>]; скрытый — lt://v1/htimer/…)
  //   {kind:"alarm", hour, minute, every, times, title} — будильник, зашитый в код (lt://v1/alarm/<ЧЧММ>[,<5|15|30>,<1..4>][/<название>])
  //   {kind:"habit", id, title} — привычка с названием в коде (lt://v1/habit/<id>/<название>)
  //   {kind:"task", tab, tag, text} — задача, зашитая в код (lt://v1/task/<ключ вкладки>[#<тег>]/<текст>)
  //   {kind:"today"} / {kind:"reminder"} — общие коды «Сегодня» и «Напоминалки» (lt://v1/today, lt://v1/reminder)
  //   {kind:"note", id}   — код заметки «Моего блокнота» (lt://v1/note/<id>)
  //   {kind:"unknown", text} — наша схема lt://, но другая версия/вид (не выполняется)
  //   {kind:"url", url}   — обычная ссылка http(s)
  //   {kind:"text", text} — всё остальное
  function parseCode(text){
    var t = String(text == null ? "" : text).replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, ""); // \uFEFF: библиотека QR ставит BOM перед текстом с кириллицей
    if(t === TODAY_CODE) return { kind: "today" };
    if(t === REMINDER_CODE) return { kind: "reminder" };
    if(t.indexOf(QR_PREFIX) === 0){
      var id = t.slice(QR_PREFIX.length);
      if(/^[A-Za-z0-9]{4,32}$/.test(id)) return { kind: "card", id: id };
      return { kind: "unknown", text: t };
    }
    if(t.indexOf(TIMER_PREFIX) === 0 || t.indexOf(HTIMER_PREFIX) === 0){
      // таймер, зашитый в сам код: lt://v1/timer/<секунды>[/<название>] (скрытый — lt://v1/htimer/…) — карточка на устройстве не нужна
      var thid = t.indexOf(HTIMER_PREFIX) === 0;
      var tm = /^(\d{1,6})(?:\/([\s\S]*))?$/.exec(t.slice((thid ? HTIMER_PREFIX : TIMER_PREFIX).length));
      var tsec = tm ? parseInt(tm[1], 10) : 0;
      if(tm && tsec >= 1 && tsec <= 359999){
        var tres = { kind: "timer", seconds: tsec, title: (tm[2] || "").replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, 80) };
        if(thid) tres.hidden = true;
        return tres;
      }
      return { kind: "unknown", text: t };
    }
    if(t.indexOf(ALARM_PREFIX) === 0){
      // будильник, зашитый в сам код: время ЧЧММ, необязательный повтор «,<минут>,<раз>» и название — карточка на устройстве не нужна
      var am = /^(\d{2})(\d{2})(?:,(5|15|30),([1-4]))?(?:\/([\s\S]*))?$/.exec(t.slice(ALARM_PREFIX.length));
      var ah = am ? parseInt(am[1], 10) : -1, amin = am ? parseInt(am[2], 10) : -1;
      if(am && ah >= 0 && ah < 24 && amin >= 0 && amin < 60){
        return { kind: "alarm", hour: ah, minute: amin, every: am[3] ? parseInt(am[3], 10) : 0, times: am[4] ? parseInt(am[4], 10) : 0,
          title: (am[5] || "").replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, 80) };
      }
      return { kind: "unknown", text: t };
    }
    if(t.indexOf(HABIT_PREFIX) === 0){
      // привычка: id и название в самом коде — на устройстве без такой карточки приложение создаёт её по коду (цвета в коде нет)
      var hb = /^([A-Za-z0-9]{4,32})\/([\s\S]+)$/.exec(t.slice(HABIT_PREFIX.length));
      var htitle = hb ? hb[2].replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, 80) : "";
      if(htitle) return { kind: "habit", id: hb[1], title: htitle };
      return { kind: "unknown", text: t };
    }
    if(t.indexOf(TASK_PREFIX) === 0){
      // задача, зашитая в сам код: lt://v1/task/<ключ вкладки>/<текст> — какая вкладка существует, решает приложение
      var tk = /^([a-z0-9]{2,20})(?:#([^\/]{1,40}))?\/([\s\S]+)$/.exec(t.slice(TASK_PREFIX.length));
      var ttext = tk ? tk[3].replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, 200) : "";
      var ttag = tk && tk[2] ? tk[2].replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, 16) : "";
      if(/[\uD800-\uDBFF]$/.test(ttag)) ttag = ttag.slice(0, -1);
      if(/[\uD800-\uDBFF]$/.test(ttext)) ttext = ttext.slice(0, -1);
      if(tk && ttext) return { kind: "task", tab: tk[1], tag: ttag, text: ttext };
      return { kind: "unknown", text: t };
    }
    if(t.indexOf(NOTE_PREFIX) === 0){
      var nid = t.slice(NOTE_PREFIX.length);
      if(/^[A-Za-z0-9]{4,32}$/.test(nid)) return { kind: "note", id: nid };
      return { kind: "unknown", text: t };
    }
    if(/^lt:\/\//i.test(t)) return { kind: "unknown", text: t };
    if(/^https?:\/\/\S+$/i.test(t)) return { kind: "url", url: t };
    return { kind: "text", text: t };
  }

  // open({ loadJsqr: () => Promise, onCode(text), onBack(), windowed?: bool }) → { close() }
  // windowed — окно ярлыка (scan.html): камера только в центральной рамке, остальное прозрачно.
  // onCode вызывается один раз, камера к этому моменту уже остановлена и слой убран.
  function open(opts){
    var stream = null, raf = null, closed = false;

    var layer = document.createElement("div");
    layer.className = "card-scan-screen" + (opts.windowed ? " scan-windowed" : "");
    layer.innerHTML =
      '<div class="scan-video-wrap"><div class="scan-wait"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34" fill="none" stroke="#000" stroke-width="10"/><polygon points="43,33 43,67 69,50" fill="#000"/></svg></div>' +
      '<video id="cardScanVideo" playsinline autoplay muted></video><div class="scan-frame"></div></div>' +
      '<canvas id="cardScanCanvas" style="display:none;"></canvas>' +
      '<div class="modal-note card-scan-note" id="cardScanNote"></div>' +
      (opts.windowed ? '' : '<button type="button" class="modal-btn card-scan-back" id="cardScanBack">Назад</button>');
    document.body.appendChild(layer);

    var video = layer.querySelector("#cardScanVideo");
    var canvas = layer.querySelector("#cardScanCanvas");
    var note = layer.querySelector("#cardScanNote");

    // ---------- удержание и индикатор ----------
    // Цвет — как у значка ярлыка сканера (ScanShortcut.kt, 0xFF7F00FF). Стили заданы атрибутами, а не классами: индикатор не зависит от CSS.
    var PURPLE = "#7F00FF";
    var HOLD_MIN_MS = 250;      // код в центре зоны
    var HOLD_EDGE_MS = 600;     // код у края зоны
    var HOLD_SIDE_EFFECT_MS = 500; // таймер и «Создавать задачу»: запуск/создание не откатить сканом по ошибке, поэтому не быстрее
    var MOVE_TOL = 0.2;         // уход центра кода от якоря, после которого удержание на время не копится (доля стороны зоны); дрожь руки укладывается в допуск
    var EXCEED_PENALTY_MS = 150; // штраф счёту за каждый уход кода от якоря
    var GRACE_MS = 400;         // кадры без кода (смаз при дрожании руки) короче этого срока удержание не трогают
    var SWITCH_FRAMES = 3;      // другой текст кода должен продержаться столько кадров подряд, чтобы счёт пошёл заново (разовый сбой чтения не в счёт)
    var MIN_CODE_SIDE = 0.15;   // совсем мелкие коды (далеко/на фоне) не считаются; доля стороны зоны
    var wrap = layer.querySelector(".scan-video-wrap");
    var SVGNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "scan-lock");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:3;";
    function mkPath(attrs){
      var el = document.createElementNS(SVGNS, "path");
      for(var k in attrs){ if(attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]); }
      el.style.display = "none";
      svg.appendChild(el);
      return el;
    }
    var fillEl = mkPath({ fill: PURPLE, "fill-opacity": "0", stroke: "none" });
    var faintEl = mkPath({ fill: "none", stroke: PURPLE, "stroke-opacity": "0.4", "stroke-width": "2", "stroke-linejoin": "round" });
    var progEl = mkPath({ fill: "none", stroke: PURPLE, "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" });
    if(wrap) wrap.appendChild(svg);

    var hold = { text: null, ax: 0, ay: 0 }; // что сейчас держим и «якорь» — где центр кода был, когда он последний раз стоял
    var held = 0, disp = 0, lastT = 0, lastSeen = 0, sp = null, lastViewBox = "", pendText = null, pendCount = 0;

    function towardPt(p, q, r){
      var dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = Math.min(r, len / 2) / len;
      return { x: p.x + dx * k, y: p.y + dy * k };
    }
    // скруглённый четырёхугольник по часовой стрелке; начало — угол, ближайший к левому верхнему углу экрана
    function roundedPath(pts, r){
      var best = 0, i;
      for(i = 1; i < 4; i++){ if(pts[i].x + pts[i].y < pts[best].x + pts[best].y) best = i; }
      var d = "";
      for(var n = 0; n < 4; n++){
        var i1 = (best + n) % 4, p0 = pts[(i1 + 3) % 4], p1 = pts[i1], p2 = pts[(i1 + 1) % 4];
        var a = towardPt(p1, p0, r), b = towardPt(p1, p2, r);
        d += (n === 0 ? "M" : "L") + a.x.toFixed(1) + "," + a.y.toFixed(1) + " Q" + p1.x.toFixed(1) + "," + p1.y.toFixed(1) + " " + b.x.toFixed(1) + "," + b.y.toFixed(1) + " ";
      }
      return d + "Z";
    }
    // контур кода из jsQR (координаты уменьшенного кадра) → координаты слоя видео (object-fit: cover), с отступом
    function describeCode(loc, cw, ch, Wd, Hd){
      var vw = video.videoWidth, vh = video.videoHeight;
      var sc = Math.max(Wd / vw, Hd / vh), ox = (Wd - vw * sc) / 2, oy = (Hd - vh * sc) / 2;
      var raw = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
      var pts = [], cx = 0, cy = 0, i;
      for(i = 0; i < 4; i++){
        var q = { x: raw[i].x * (vw / cw) * sc + ox, y: raw[i].y * (vh / ch) * sc + oy };
        pts.push(q); cx += q.x / 4; cy += q.y / 4;
      }
      var side = 0;
      for(i = 0; i < 4; i++){
        var nx = pts[(i + 1) % 4];
        side += Math.sqrt((nx.x - pts[i].x) * (nx.x - pts[i].x) + (nx.y - pts[i].y) * (nx.y - pts[i].y)) / 4;
      }
      for(i = 0; i < 4; i++){ pts[i] = { x: cx + (pts[i].x - cx) * 1.12, y: cy + (pts[i].y - cy) * 1.12 }; } // небольшой отступ от кода
      return { pts: pts, cx: cx, cy: cy, side: side };
    }
    function hideLock(){
      fillEl.style.display = "none"; faintEl.style.display = "none"; progEl.style.display = "none";
    }
    function drawLock(){
      if(!sp){ hideLock(); return; }
      var side = Math.sqrt((sp[1].x - sp[0].x) * (sp[1].x - sp[0].x) + (sp[1].y - sp[0].y) * (sp[1].y - sp[0].y));
      var d = roundedPath(sp, Math.max(6, side * 0.12));
      faintEl.setAttribute("d", d); faintEl.style.display = "";
      if(disp > 0.005){
        var len = 0;
        progEl.setAttribute("d", d);
        progEl.style.display = ""; // длину считаем у показанного элемента: у скрытого старые WebView могут отдать 0
        try{ len = progEl.getTotalLength(); }catch(e){ len = 0; }
        if(!(len > 0)) len = side * 4.5;
        progEl.setAttribute("stroke-dasharray", len + " " + len);
        progEl.setAttribute("stroke-dashoffset", String(len * (1 - Math.min(1, disp))));
        progEl.style.display = "";
        fillEl.setAttribute("d", d);
        fillEl.setAttribute("fill-opacity", String(0.15 * Math.min(1, disp * 5)));
        fillEl.style.display = "";
      }else{
        progEl.style.display = "none"; fillEl.style.display = "none";
      }
    }
    function holdNeeded(info, zone, text){
      var dn = Math.max(Math.abs(info.cx - zone.cx), Math.abs(info.cy - zone.cy)) / (zone.side / 2);
      dn = Math.max(0, Math.min(1, dn));
      var need = HOLD_MIN_MS + (HOLD_EDGE_MS - HOLD_MIN_MS) * dn;
      var parsed = parseCode(text), kind = parsed.kind;
      var sideEffect = kind === "task" || kind === "timer" || kind === "habit" || kind === "alarm";
      // opts.longHold(разобранный код): приложение знает карточки — скан «Привычки» тоже отмечает день без отмены, как и таймер/задача
      if(!sideEffect && typeof opts.longHold === "function"){ try{ sideEffect = !!opts.longHold(parsed); }catch(e){} }
      if(sideEffect) need = Math.max(need, HOLD_SIDE_EFFECT_MS);
      return need;
    }
    function buzz(){ try{ if(navigator.vibrate) navigator.vibrate(30); }catch(e){} }

    // до первого кадра видео скрыто (иначе WebView рисует растянутую заглушку), после — показываем камеру
    function setLive(){ if(!closed) layer.className += (layer.className.indexOf(" scan-live") < 0 ? " scan-live" : ""); }
    video.addEventListener("playing", setLive);

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

    function goBack(){
      close();
      if(opts.onBack) opts.onBack();
    }
    var backBtn = layer.querySelector("#cardScanBack");
    if(backBtn) backBtn.addEventListener("click", goBack);
    if(opts.windowed){
      // окно ярлыка: нажатие мимо окна камеры (и мимо строки ошибки) закрывает сканер
      layer.addEventListener("click", function(e){
        var t = e.target;
        if(t && t.closest && (t.closest(".scan-video-wrap") || t.closest(".card-scan-note"))) return;
        goBack();
      });
    }

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
      var now = Date.now();
      var dt = lastT ? Math.min(100, now - lastT) : 16;
      lastT = now;
      var found = null, zone = null;
      if(video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth){
        setLive();
        // уменьшаем кадр для скорости, пропорции сохраняем
        var w = Math.min(480, video.videoWidth);
        var h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth));
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        var data = ctx.getImageData(0, 0, w, h);
        var result = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" });
        var Wd = wrap ? wrap.clientWidth : 0, Hd = wrap ? wrap.clientHeight : 0;
        if(Wd > 0 && Hd > 0){
          var vb = "0 0 " + Wd + " " + Hd;
          if(vb !== lastViewBox){ svg.setAttribute("viewBox", vb); lastViewBox = vb; }
          // зона прицела: в окне ярлыка — всё окно камеры, на весь экран — центральный квадрат (рамка .scan-frame, 70%)
          zone = { cx: Wd / 2, cy: Hd / 2, side: opts.windowed ? Math.min(Wd, Hd) : 0.7 * Math.min(Wd, Hd) };
          if(result && result.data && result.location){
            var info = describeCode(result.location, w, h, Wd, Hd);
            var inside = Math.abs(info.cx - zone.cx) <= zone.side / 2 && Math.abs(info.cy - zone.cy) <= zone.side / 2;
            if(inside && info.side >= MIN_CODE_SIDE * zone.side) found = { text: result.data, info: info };
          }
        }else if(result && result.data){
          // слой без размеров (нетипично): без индикатора, как раньше — первый удачный кадр
          close();
          if(opts.onCode) opts.onCode(result.data);
          return;
        }
      }
      if(found){
        lastSeen = now;
        var c = found.info;
        var accum = true;
        if(hold.text === null){ hold.text = found.text; hold.ax = c.cx; hold.ay = c.cy; held = 0; pendText = null; pendCount = 0; }
        else if(hold.text !== found.text){
          // другой код: счёт заново только если он держится несколько кадров подряд; пока — прежний счёт стоит
          accum = false;
          if(pendText === found.text) pendCount++; else { pendText = found.text; pendCount = 1; }
          if(pendCount >= SWITCH_FRAMES){ hold.text = found.text; hold.ax = c.cx; hold.ay = c.cy; held = 0; pendText = null; pendCount = 0; }
        }else{
          pendText = null; pendCount = 0;
          var ddx = c.cx - hold.ax, ddy = c.cy - hold.ay;
          if(Math.sqrt(ddx * ddx + ddy * ddy) > MOVE_TOL * zone.side){
            // код ушёл далеко от якоря (резкий рывок или проводят мимо): штраф EXCEED_PENALTY_MS, якорь переезжает за кодом.
            // Дрожь руки в допуск укладывается и штрафа не даёт; код, который проносят через зону, штрафуется чаще, чем копит счёт
            accum = false;
            hold.ax = c.cx; hold.ay = c.cy;
            held = Math.max(0, held - EXCEED_PENALTY_MS);
          }else{
            // якорь медленно следует за кодом: плавный дрейф руки не считается уходом
            hold.ax += ddx * 0.05; hold.ay += ddy * 0.05;
          }
        }
        if(hold.text === found.text){ // счёт идёт только у держимого кода: чужой код, мелькнувший рядом, принят быть не может
          if(accum) held += dt;
          var need = holdNeeded(c, zone, found.text);
          if(held >= need){
            disp = 1;
            buzz();
            var text = found.text;
            close();
            if(opts.onCode) opts.onCode(text);
            return;
          }
          // сглаживание контура: он плавно догоняет код, а не дёргается вместе с рукой
          if(!sp){ sp = c.pts; }
          else{ for(var k = 0; k < 4; k++){ sp[k] = { x: sp[k].x + (c.pts[k].x - sp[k].x) * 0.5, y: sp[k].y + (c.pts[k].y - sp[k].y) * 0.5 }; } }
          var target = held / need;
          if(target >= disp) disp = target; else disp = Math.max(target, disp - dt / 400);
        }else{
          disp = Math.max(0, disp - dt / 400); // в кадре другой код: индикатор держимого сворачивается
        }
      }else if(now - lastSeen > GRACE_MS){
        // кода нет дольше допуска: отсчёт откатывается, индикатор плавно сворачивается
        held = Math.max(0, held - dt);
        disp = Math.max(0, disp - dt / 400);
        if(held === 0 && disp <= 0.005){ hold.text = null; sp = null; pendText = null; pendCount = 0; }
      }
      drawLock();
      raf = requestAnimationFrame(tick);
    }

    return { close: close };
  }

  return { parseCode: parseCode, open: open, QR_PREFIX: QR_PREFIX, NOTE_PREFIX: NOTE_PREFIX };
})();
