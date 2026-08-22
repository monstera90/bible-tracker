/* ===========================================================================
   mood.js
   Функционал отслеживания настроения: счётчик, чек-ин, диаграмма настроения.
   Выделено из my.js. Модуль создаётся вызовом window.initMoodModule(deps)
   из my.js и получает через deps доступ к общему состоянию приложения
   (state), сохранению/синхронизации и модальным окнам.
   =========================================================================== */

(function(global){
  "use strict";

  function initMoodModule(deps){
    var getState = deps.getState;
    var setHourState = deps.setHourState;
    var saveLocalState = deps.saveLocalState;
    var scheduleCloudPush = deps.scheduleCloudPush;
    var escapeHtml = deps.escapeHtml;
    var startOfDay = deps.startOfDay;
    var DAY_MS = deps.DAY_MS;
    var pluralRu = deps.pluralRu;
    var DAY_FORMS = deps.DAY_FORMS;
    var MONTH_FORMS = deps.MONTH_FORMS;
    var closeModal = deps.closeModal;
    var modalBox = deps.modalBox;
    var modalOverlay = deps.modalOverlay;
    var bindClose = deps.bindClose;
    var modalHeader = deps.modalHeader;
    var switchSettingsTab = deps.switchSettingsTab;
    var refreshYearGridIfOpen = deps.refreshYearGridIfOpen;

    // всегда читаем актуальный объект state (он может быть переприсвоен
    // в my.js при слиянии с облаком, поэтому берём его через геттер, а не
    // захватываем ссылку один раз)
    function state(){ return getState(); }

  // ===================== СЧЁТЧИК НАСТРОЕНИЯ =====================
  // Записи настроения синхронизируются так же, как записи часов — каждая
  // отметка это отдельный уникальный ключ ("moodlog:...", "moodsession:..."),
  // поэтому объединение между устройствами работает "само собой".
  // Сброс данных не удаляет записи физически (это небезопасно для
  // синхронизации — см. комментарий у MOOD_DATA_RESET_AT_KEY), а просто
  // отодвигает "нижнюю границу" видимых записей вперёд по времени.
  var MOOD_EMOJI_KEY = "__moodEmoji";
  var MOOD_ENABLED_KEY = "__moodEnabled";
  var MOOD_FIRST_LOG_KEY = "__moodFirstLog";
  var MOOD_DATA_RESET_AT_KEY = "__moodDataResetAt";

  var MOOD_COLORS = {joy:"#F7C948", sad:"#6FA8DC", calm:"#8FD9B8", anger:"#E06666", down:"#8E7CC3", sleepy:"#B4A7D6"};

  function moodCategoriesResolved(){
    var joyEmoji = getMoodEmoji() || "😀";
    return [
      {key:"joy", emoji:joyEmoji, label:"Радость"},
      {key:"sad", emoji:"😕", label:"Грусть"},
      {key:"calm", emoji:"🙄", label:"Спокойствие"},
      {key:"anger", emoji:"😡", label:"Раздражительность"},
      {key:"down", emoji:"😌", label:"Внутренний мир"},
      {key:"sleepy", emoji:"🥱", label:"Сонливость"}
    ];
  }

  function getMoodEmoji(){ var r = state()[MOOD_EMOJI_KEY]; return (r && r.c) ? r.c : null; }
  function isMoodEnabled(){ var r = state()[MOOD_ENABLED_KEY]; return !!(r && r.c); }
  function getMoodDataResetAt(){ var r = state()[MOOD_DATA_RESET_AT_KEY]; return (r && r.c) ? r.c : 0; }

  function getTodaySessionsCount(){
    var floor = Math.max(startOfDay(Date.now()), getMoodDataResetAt());
    var count = 0;
    Object.keys(state()).forEach(function(k){
      if(k.indexOf("moodsession:") === 0 && state()[k] && state()[k].t >= floor) count++;
    });
    return count;
  }
  function hasLoggedToday(){ return getTodaySessionsCount() > 0; }

  function getMoodCounts(){
    var floor = getMoodDataResetAt();
    var counts = {};
    moodCategoriesResolved().forEach(function(c){ counts[c.key] = 0; });
    Object.keys(state()).forEach(function(k){
      if(k.indexOf("moodlog:") === 0 && state()[k] && typeof state()[k].c === "string" && state()[k].t >= floor){
        if(counts[state()[k].c] !== undefined) counts[state()[k].c]++;
      }
    });
    return counts;
  }

  function activateMoodCounter(emoji){
    setHourState(MOOD_EMOJI_KEY, emoji);
    setHourState(MOOD_ENABLED_KEY, true);
    saveLocalState();
    scheduleCloudPush();
    renderMoodPill();
    renderMoodMenu();
  }
  function deactivateMoodCounter(){
    setHourState(MOOD_ENABLED_KEY, null);
    saveLocalState();
    scheduleCloudPush();
    renderMoodPill();
    renderMoodMenu();
  }
  function resetMoodData(){
    setHourState(MOOD_DATA_RESET_AT_KEY, Date.now());
    setHourState(MOOD_FIRST_LOG_KEY, null);
    saveLocalState();
    scheduleCloudPush();
  }

  function renderMoodPill(){
    var pill = document.getElementById("moodStatusPill");
    if(!pill) return;
    if(!isMoodEnabled()){ pill.style.display = "none"; return; }
    pill.style.display = "flex";
    pill.textContent = getMoodEmoji() || "😀";
    pill.classList.toggle("unlogged", !hasLoggedToday());
  }

  function renderMoodMenu(){
    var row = document.getElementById("moodCounterMenuRow");
    if(!row) return;
    if(isMoodEnabled()){
      row.innerHTML =
        '<button class="version-history-item" id="moodRemoveBtn" style="color:#8a2f1c;">Убрать счётчик настроения</button>' +
        '<button class="version-history-item" id="moodDiagramBtn">Диаграмма настроения</button>';
      document.getElementById("moodRemoveBtn").addEventListener("click", deactivateMoodCounter);
      document.getElementById("moodDiagramBtn").addEventListener("click", openMoodDiagram);
    } else {
      row.innerHTML = '<button class="version-history-item" id="moodAddBtn">Добавить счётчик настроения</button>';
      document.getElementById("moodAddBtn").addEventListener("click", function(){ openMoodEmojiPicker(false); });
    }
  }

  // --- выбор смайлика (при первой настройке и, с возможностью отказа, после сброса) ---
  function openMoodEmojiPicker(allowDecline){
    var emojis = ["😀","😅","🙂","😉","😋","😜"];
    var buttons = emojis.map(function(e){ return '<button data-emoji="'+e+'">'+e+'</button>'; }).join("");
    modalBox.innerHTML =
      modalHeader("Выберите внешний вид кнопки") +
      '<div class="mood-picker-grid">' + buttons + '</div>' +
      (allowDecline ? '<button class="modal-btn" id="mMoodDecline">Не нужно</button>' : '');
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-emoji]"), function(btn){
      btn.addEventListener("click", function(){
        activateMoodCounter(btn.getAttribute("data-emoji"));
        closeModal();
      });
    });
    if(allowDecline){
      var declineBtn = document.getElementById("mMoodDecline");
      if(declineBtn) declineBtn.addEventListener("click", function(){ deactivateMoodCounter(); closeModal(); });
    }
  }

  // --- отметка настроения (до 2 вариантов за раз) ---
  var moodCheckinSelected = [];
  function openMoodCheckin(){
    moodCheckinSelected = [];
    renderMoodCheckinModal();
  }
  function renderMoodCheckinModal(){
    var cats = moodCategoriesResolved();
    var items = cats.map(function(c){
      var sel = moodCheckinSelected.indexOf(c.key) !== -1;
      return '<div class="mood-checkin-item' + (sel ? ' selected' : '') + '" data-mood="' + c.key + '">' +
        '<span class="emoji">' + c.emoji + '</span><span class="label">' + c.label + '</span></div>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Что ты сейчас чувствуешь?") +
      '<div class="mood-checkin-hint" id="moodCheckinHint"></div>' +
      '<div class="mood-checkin-grid">' + items + '</div>' +
      '<button class="modal-btn primary" id="mMoodConfirm">Готово</button>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-mood]"), function(el){
      el.addEventListener("click", function(){
        var key = el.getAttribute("data-mood");
        var idx = moodCheckinSelected.indexOf(key);
        if(idx !== -1){
          moodCheckinSelected.splice(idx, 1);
        } else {
          if(moodCheckinSelected.length >= 2){
            var hint = document.getElementById("moodCheckinHint");
            if(hint) hint.textContent = "Выбирать можно только два варианта";
            return;
          }
          moodCheckinSelected.push(key);
        }
        renderMoodCheckinModal();
      });
    });
    document.getElementById("mMoodConfirm").addEventListener("click", function(){
      if(moodCheckinSelected.length === 0){ closeModal(); return; }
      var sessionTs = Date.now();
      state()["moodsession:" + sessionTs + "-" + Math.random().toString(36).slice(2,7)] = {c: 1, t: sessionTs};
      moodCheckinSelected.forEach(function(key){
        state()["moodlog:" + sessionTs + "-" + key + "-" + Math.random().toString(36).slice(2,7)] = {c: key, t: sessionTs};
      });
      if(!state()[MOOD_FIRST_LOG_KEY] || state()[MOOD_FIRST_LOG_KEY].c == null || state()[MOOD_FIRST_LOG_KEY].c < getMoodDataResetAt()){
        setHourState(MOOD_FIRST_LOG_KEY, sessionTs);
      }
      saveLocalState();
      scheduleCloudPush();
      renderMoodPill();
      refreshYearGridIfOpen();
      closeModal();
    });
  }

  // --- диаграмма настроения ---
  var moodDiagramExpanded = false;

  function polarPoint(cx, cy, r, angleDeg){
    var rad = (angleDeg - 90) * Math.PI / 180;
    return {x: cx + r*Math.cos(rad), y: cy + r*Math.sin(rad)};
  }
  function describeArcPath(cx, cy, r, startAngle, endAngle){
    var start = polarPoint(cx, cy, r, startAngle);
    var end = polarPoint(cx, cy, r, endAngle);
    var largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
    return ["M", cx, cy, "L", start.x.toFixed(2), start.y.toFixed(2),
      "A", r, r, 0, largeArc, 1, end.x.toFixed(2), end.y.toFixed(2), "Z"].join(" ");
  }

  var MARK_FORMS = ["отметка","отметки","отметок"];
  function getTotalSessionsCount(){
    var floor = getMoodDataResetAt();
    var count = 0;
    Object.keys(state()).forEach(function(k){
      if(k.indexOf("moodsession:") === 0 && state()[k] && state()[k].t >= floor) count++;
    });
    return count;
  }

  function formatMoodPeriodLabel(totalDays){
    totalDays = Math.max(1, totalDays);
    if(totalDays < 60) return "за " + totalDays + " " + pluralRu(totalDays, DAY_FORMS);
    var months = Math.max(1, Math.round(totalDays/30));
    return "за " + months + " " + pluralRu(months, MONTH_FORMS);
  }

  function openMoodDiagram(){
    moodDiagramExpanded = false;
    renderMoodDiagramModal();
  }

  function renderMoodDiagramModal(){
    var counts = getMoodCounts();
    var total = 0;
    Object.keys(counts).forEach(function(k){ total += counts[k]; });

    if(total === 0){
      modalBox.innerHTML =
        modalHeader("Диаграмма настроения") +
        '<div class="mood-diagram-empty">Данных о настроении нет. Добавьте настроение — тогда здесь появится диаграмма.</div>';
      bindClose();
      modalOverlay.classList.add("open");
      return;
    }

    var firstLogRec = state()[MOOD_FIRST_LOG_KEY];
    var totalDays = 1;
    if(firstLogRec && firstLogRec.c){
      totalDays = Math.round((startOfDay(Date.now()) - startOfDay(firstLogRec.c)) / DAY_MS) + 1;
    }
    var sessionsCount = getTotalSessionsCount();
    var title = "Диаграмма настроения " + formatMoodPeriodLabel(totalDays) +
      " - всего " + sessionsCount + " " + pluralRu(sessionsCount, MARK_FORMS) + " настроения";

    modalBox.innerHTML =
      modalHeader(title) +
      '<div class="mood-diagram-wrap" id="moodDiagramWrap"></div>' +
      '<div class="mood-diagram-reset-row"><button class="mood-diagram-reset-btn" id="mMoodResetBtn">Сбросить данные настроения</button></div>';
    bindClose();
    modalOverlay.classList.add("open");
    buildMoodDiagramSVG(counts, total);
    document.getElementById("mMoodResetBtn").addEventListener("click", openMoodResetConfirm);
  }

  function polarPointEllipse(cx, cy, rx, ry, angleDeg){
    var rad = (angleDeg - 90) * Math.PI / 180;
    return {x: cx + rx*Math.cos(rad), y: cy + ry*Math.sin(rad)};
  }
  function describeArcPathEllipse(cx, cy, rx, ry, startAngle, endAngle){
    var start = polarPointEllipse(cx, cy, rx, ry, endAngle);
    var end = polarPointEllipse(cx, cy, rx, ry, startAngle);
    var largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
    return ["M", cx, cy, "L", start.x.toFixed(2), start.y.toFixed(2),
      "A", rx, ry, 0, largeArc, 0, end.x.toFixed(2), end.y.toFixed(2), "Z"].join(" ");
  }
  function darkenColor(hex, amount){
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, (n >> 16) - amount);
    var g = Math.max(0, ((n >> 8) & 0xff) - amount);
    var b = Math.max(0, (n & 0xff) - amount);
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  // Толщина стенки в данном угле обода. Раньше стенка не пропадала
  // никогда (даже у самого заднего края держался минимум 40% глубины) —
  // из-за этого тёмная стенка тянулась по всему периметру эллипса на
  // фиксированном расстоянии и читалась как отдельный "второй круг", а
  // на боках (angle≈90°/270°, где верхний и нижний контуры визуально
  // сходятся) толщина обрывалась не до нуля, а сразу до заметных 70% —
  // отсюда ощущение, что нижний контур там резко "подворачивается".
  // Первая попытка исправить это — обнулить стенку целиком за пределами
  // ближней половины (90°..270°) — убрала слипание, но заодно убрала и
  // объём у всех долек, которые просто оказались в дальней половине:
  // они стали выглядеть совсем плоскими.
  //
  // Теперь — два плавных "лепестка" на разных половинах вместо одного:
  // на ближней половине (90°..270°) толщина растёт по синусоиде от 0 на
  // обоих боках до полной depth по центру (180°, прямо на зрителя); на
  // дальней половине (270°..360°..90°) — тоже от 0 на тех же боках, но
  // до более скромного BACK_FRAC от depth по центру дальней стороны (0°/
  // 360°, "затылок" диска). Оба лепестка стыкуются строго в нуле у 90° и
  // 270° — там, где контуры сходятся, никакой лишней толщины уже нет,
  // но при этом ни одна долька не остаётся полностью плоской.
  var MOOD_WALL_BACK_FRAC = 0.4;
  function moodWallThickness(depth, angleDeg){
    if(angleDeg > 90 && angleDeg < 270){
      return depth * Math.sin((angleDeg - 90) * Math.PI / 180);
    }
    var back = angleDeg <= 90 ? (90 - angleDeg) : (angleDeg - 270);
    return depth * MOOD_WALL_BACK_FRAC * Math.sin(back * Math.PI / 180);
  }
  // Лента-стенка вдоль обода: полигон из точек верхнего края (толщина 0)
  // и точек нижнего края (толщина moodWallThickness на каждый угол), а не
  // фиксированный сдвиг всего среза вниз — так толщина стенки плавно
  // меняется по углу и никогда не пропадает совсем.
  function buildMoodWallRibbonPath(rx, ry, depth, startAngle, endAngle){
    var steps = Math.max(2, Math.ceil((endAngle - startAngle) / 6));
    var tops = [], bottoms = [];
    for(var i=0; i<=steps; i++){
      var a = startAngle + (endAngle - startAngle) * i / steps;
      var top = polarPointEllipse(0, 0, rx, ry, a);
      var th = moodWallThickness(depth, a);
      tops.push(top.x.toFixed(2) + "," + top.y.toFixed(2));
      bottoms.push(top.x.toFixed(2) + "," + (top.y + th).toFixed(2));
    }
    bottoms.reverse();
    return "M " + tops.join(" L ") + " L " + bottoms.join(" L ") + " Z";
  }

  function buildMoodDiagramSVG(counts, total){
    var wrap = document.getElementById("moodDiagramWrap");
    if(!wrap) return;

    var cats = moodCategoriesResolved().filter(function(c){ return counts[c.key] > 0; });
    // сплюснутый эллипс вместо круга + "стенка" толщины диска снизу —
    // вместе это даёт вид как бы под углом ~45° сбоку, а не сверху
    var rx = 95, ry = 52, depth = 20;
    var size = 260, cx = size/2, cy = size/2 - depth/2;
    var gapDeg = 3;
    var collapsedOffset = 3, expandedOffset = 22;
    var ryRatio = ry/rx;

    var cum = 0;
    var defsParts = [], emojiParts = [];
    var records = [];

    cats.forEach(function(cat, idx){
      var p = counts[cat.key] / total;
      var spanFull = p * 360;
      var startFull = cum, endFull = cum + spanFull;
      cum = endFull;

      var start = startFull + gapDeg/2, end = endFull - gapDeg/2;
      if(end < start) end = start;
      var mid = (start + end) / 2;
      var path = describeArcPathEllipse(0, 0, rx, ry, start, end);
      var color = MOOD_COLORS[cat.key] || "#ccc";
      var wallColor = darkenColor(color, 55);

      var dirRad = (mid - 90) * Math.PI/180;
      var dx = Math.cos(dirRad), dy = Math.sin(dirRad) * ryRatio;

      var gradId = "moodGrad" + idx;
      defsParts.push(
        '<radialGradient id="' + gradId + '" cx="35%" cy="30%" r="75%">' +
        '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>' +
        '<stop offset="45%" stop-color="#ffffff" stop-opacity="0.08"/>' +
        '<stop offset="100%" stop-color="#000000" stop-opacity="0.1"/>' +
        '</radialGradient>'
      );

      // "стенка" куска: боковая (радиальная) грань у начала среза, боковая
      // грань у конца среза, и дуговая (внешняя, ободная) грань — все три
      // залиты тёмным вариантом цвета и лежат в одной группе с верхним
      // срезом по data-dx/data-dy, чтобы при разъезжании кусок уезжал
      // целиком, вместе со всеми своими гранями, а не только "крышкой".
      // Толщина у краёв (start/end) берётся той же функцией moodWallThickness,
      // что и у ободной ленты — грани стыкуются без ступеньки.
      var pStartTop = polarPointEllipse(0, 0, rx, ry, start);
      var pEndTop = polarPointEllipse(0, 0, rx, ry, end);
      var thStart = moodWallThickness(depth, start);
      var thEnd = moodWallThickness(depth, end);
      var pStartBottom = {x: pStartTop.x, y: pStartTop.y + thStart};
      var pEndBottom = {x: pEndTop.x, y: pEndTop.y + thEnd};
      var sideStartPath = ["M", "0,0", "L", pStartTop.x.toFixed(2)+","+pStartTop.y.toFixed(2),
        "L", pStartBottom.x.toFixed(2)+","+pStartBottom.y.toFixed(2), "L", "0,"+thStart.toFixed(2), "Z"].join(" ");
      var sideEndPath = ["M", "0,0", "L", pEndTop.x.toFixed(2)+","+pEndTop.y.toFixed(2),
        "L", pEndBottom.x.toFixed(2)+","+pEndBottom.y.toFixed(2), "L", "0,"+thEnd.toFixed(2), "Z"].join(" ");
      var wallStr =
        '<g class="mood-diagram-wall" data-dx="' + dx.toFixed(3) + '" data-dy="' + dy.toFixed(3) + '" ' +
        'transform="translate(' + (dx*collapsedOffset).toFixed(2) + ',' + (dy*collapsedOffset).toFixed(2) + ')">' +
        '<path d="' + sideStartPath + '" fill="' + wallColor + '"></path>' +
        '<path d="' + sideEndPath + '" fill="' + wallColor + '"></path>' +
        '<path d="' + buildMoodWallRibbonPath(rx, ry, depth, start, end) + '" fill="' + wallColor + '"></path>' +
        '</g>';


      var sliceStr =
        '<g class="mood-diagram-slice" data-dx="' + dx.toFixed(3) + '" data-dy="' + dy.toFixed(3) + '" ' +
        'transform="translate(' + (dx*collapsedOffset).toFixed(2) + ',' + (dy*collapsedOffset).toFixed(2) + ')">' +
        '<path d="' + path + '" fill="' + color + '" stroke="rgba(255,255,255,.6)" stroke-width="1.5"></path>' +
        '<path d="' + path + '" fill="url(#' + gradId + ')" stroke="none"></path>' +
        '</g>';

      // frontness: насколько кусок обращён "к зрителю" (к нижнему краю
      // эллипса, mid=180°) — от -1 (совсем сзади, у mid=0°) до +1 (совсем
      // спереди). Кладём в records вместе с фигурами, чтобы отрисовать их
      // по правилу "дальние сначала, ближние поверх" (как в живописи) —
      // иначе соседний кусок, который просто оказался позже в массиве
      // категорий, мог перекрывать стенку своего соседа, который на самом
      // деле должен быть виден спереди.
      var frontness = -Math.cos(mid * Math.PI/180);
      records.push({frontness: frontness, wallStr: wallStr, sliceStr: sliceStr});

      // Отступ смайлика теперь считается от РЕАЛЬНОЙ дальней границы куска —
      // точки на ободе плюс толщина стенки в этом угле (moodWallThickness),
      // а не от фиксированных цифр. Раньше отступ по Y не учитывал, что
      // стенка сама выступает вниз ещё почти на всю глубину — из-за этого
      // у широких кусков (например у "спокойствия") смайлик почти касался
      // стенки. Теперь margin откладывается от фактического края куска.
      var rimAtMid = polarPointEllipse(0, 0, rx, ry, mid);
      var wallThAtMid = moodWallThickness(depth, mid);
      var farX = rimAtMid.x, farY = rimAtMid.y + wallThAtMid;
      var labelMargin = 24;
      var lx = cx + farX + Math.cos(dirRad)*labelMargin;
      var ly = cy + farY + Math.sin(dirRad)*labelMargin;
      emojiParts.push(
        '<div class="mood-diagram-emoji" data-dx="' + dx.toFixed(3) + '" data-dy="' + dy.toFixed(3) + '" style="' +
        'position:absolute;left:' + lx.toFixed(1) + 'px;top:' + ly.toFixed(1) + 'px;' +
        'transform:translate(-50%,-50%) translate(' + (dx*collapsedOffset).toFixed(2) + 'px,' + (dy*collapsedOffset).toFixed(2) + 'px);">' +
        cat.emoji + '</div>'
      );
    });

    // рисуем от дальних кусков к ближним: сначала те, что мысленно "сзади"
    // диаграммы (у верхнего края эллипса), последними — те, что "спереди"
    // (у нижнего края). Тогда сосед, который ближе к зрителю, всегда
    // корректно перекрывает грань того, что дальше, а не наоборот.
    records.sort(function(a, b){ return a.frontness - b.frontness; });
    var wallParts = records.map(function(r){ return r.wallStr; });
    var sliceParts = records.map(function(r){ return r.sliceStr; });

    wrap.innerHTML =
      '<div style="position:relative;width:' + size + 'px;height:' + (size) + 'px;">' +
        '<svg class="mood-diagram-svg" id="moodDiagramSvg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="filter:drop-shadow(0 5px 8px rgba(0,0,0,.35));overflow:visible;">' +
          '<defs>' + defsParts.join("") + '</defs>' +
          '<g transform="translate(' + cx + ',' + cy + ')">' +
            wallParts.join("") +
            sliceParts.join("") +
          '</g>' +
        '</svg>' +
        emojiParts.join("") +
      '</div>';

    var svgEl = document.getElementById("moodDiagramSvg");
    svgEl.addEventListener("click", function(){
      moodDiagramExpanded = !moodDiagramExpanded;
      var offset = moodDiagramExpanded ? expandedOffset : collapsedOffset;
      var groups = svgEl.querySelectorAll(".mood-diagram-slice, .mood-diagram-wall");
      groups.forEach(function(g){
        var dx = parseFloat(g.getAttribute("data-dx"));
        var dy = parseFloat(g.getAttribute("data-dy"));
        g.setAttribute("transform", "translate(" + (dx*offset).toFixed(2) + "," + (dy*offset).toFixed(2) + ")");
      });
      // смайлики едут тем же смещением, что и их куски (та же пара
      // data-dx/data-dy и то же collapsedOffset/expandedOffset) — тогда
      // расстояние между смайликом и его куском не меняется и остаётся
      // таким же безопасным, как в закрытом виде, так что пересечься они
      // не могут ни в одном из двух состояний.
      var emojis = wrap.querySelectorAll(".mood-diagram-emoji");
      emojis.forEach(function(el){
        var dx = parseFloat(el.getAttribute("data-dx"));
        var dy = parseFloat(el.getAttribute("data-dy"));
        el.style.transform = "translate(-50%,-50%) translate(" + (dx*offset).toFixed(2) + "px," + (dy*offset).toFixed(2) + "px)";
      });
    });
  }

  function openMoodResetConfirm(){
    modalBox.innerHTML =
      modalHeader("Вы точно хотите сбросить данные настроения?",
        "Вы можете выбрать «Нет» и сделать скриншот, чтобы сохранить прогресс.") +
      '<button class="modal-btn primary" id="mMoodResetYes">Да</button>' +
      '<button class="modal-btn" id="mMoodResetNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mMoodResetYes").addEventListener("click", function(){
      resetMoodData();
      openMoodEmojiPicker(true);
    });
    document.getElementById("mMoodResetNo").addEventListener("click", closeModal);
  }

  var moodStatusPill = document.getElementById("moodStatusPill");
  if(moodStatusPill) moodStatusPill.addEventListener("click", openMoodCheckin);

  function renderSettingsTabMood(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var counts = getMoodCounts();
    var total = 0;
    Object.keys(counts).forEach(function(k){ total += counts[k]; });

    if(total === 0){
      container.innerHTML = '<div class="mood-diagram-empty">Данных о настроении нет. Добавьте настроение — тогда здесь появится диаграмма.</div>';
      return;
    }

    var firstLogRec = state()[MOOD_FIRST_LOG_KEY];
    var totalDays = 1;
    if(firstLogRec && firstLogRec.c){
      totalDays = Math.round((startOfDay(Date.now()) - startOfDay(firstLogRec.c)) / DAY_MS) + 1;
    }
    var sessionsCount = getTotalSessionsCount();
    var title = "Диаграмма настроения " + formatMoodPeriodLabel(totalDays) +
      " - всего " + sessionsCount + " " + pluralRu(sessionsCount, MARK_FORMS) + " настроения";

    container.innerHTML =
      '<div class="mood-diagram-title">' + escapeHtml(title) + '</div>' +
      '<div class="mood-diagram-wrap" id="moodDiagramWrap"></div>' +
      '<div class="mood-diagram-reset-row"><button class="mood-diagram-reset-btn" id="mMoodResetBtn2">Сбросить данные настроения</button></div>';
    buildMoodDiagramSVG(counts, total);
    document.getElementById("mMoodResetBtn2").addEventListener("click", function(){
      switchSettingsTab("moodResetConfirm");
    });
  }

  // ===== Подтверждение сброса данных настроения (внутри настроек) =====
  function renderSettingsTabMoodResetConfirm(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML =
      '<div class="settings-content-bottom">' +
      '<p>Вы точно хотите сбросить данные настроения?</p>' +
      '<p style="opacity:.7;font-size:.9em;margin-top:-8px;">Вы можете выбрать «Нет» и сделать скриншот, чтобы сохранить прогресс.</p>' +
      '<button class="modal-btn danger" id="mMoodResetConfirmYesBtn" style="margin-top:14px;">Да</button>' +
      '<button class="modal-btn" id="mMoodResetConfirmNoBtn" style="margin-top:10px;">Нет</button>' +
      '</div>';
    document.getElementById("mMoodResetConfirmYesBtn").addEventListener("click", function(){
      resetMoodData();
      openMoodEmojiPicker(true);
    });
    document.getElementById("mMoodResetConfirmNoBtn").addEventListener("click", function(){
      switchSettingsTab("mood");
    });
  }



  // список отметок настроения в каждый день (ключи "moodlog:", не удаляются)
  function getMoodsByDay(){
    var byDay = {};
    var floor = getMoodDataResetAt();
    var cats = moodCategoriesResolved();
    var catByKey = {};
    cats.forEach(function(c){ catByKey[c.key] = c; });
    Object.keys(state()).forEach(function(k){
      if(k.indexOf("moodlog:") !== 0) return;
      var rec = state()[k];
      if(!rec || typeof rec.c !== "string" || rec.t < floor) return;
      var cat = catByKey[rec.c];
      if(!cat) return;
      var day = startOfDay(rec.t);
      (byDay[day] = byDay[day] || []).push(cat);
    });
    return byDay;
  }

    return {
      isMoodEnabled: isMoodEnabled,
      getMoodEmoji: getMoodEmoji,
      getMoodDataResetAt: getMoodDataResetAt,
      getMoodCounts: getMoodCounts,
      moodCategoriesResolved: moodCategoriesResolved,
      activateMoodCounter: activateMoodCounter,
      deactivateMoodCounter: deactivateMoodCounter,
      resetMoodData: resetMoodData,
      renderMoodPill: renderMoodPill,
      renderMoodMenu: renderMoodMenu,
      openMoodEmojiPicker: openMoodEmojiPicker,
      openMoodCheckin: openMoodCheckin,
      openMoodDiagram: openMoodDiagram,
      openMoodResetConfirm: openMoodResetConfirm,
      renderSettingsTabMood: renderSettingsTabMood,
      renderSettingsTabMoodResetConfirm: renderSettingsTabMoodResetConfirm,
      getMoodsByDay: getMoodsByDay
    };
  }

  global.initMoodModule = initMoodModule;
})(typeof window !== "undefined" ? window : this);
