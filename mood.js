/* ===========================================================================
   mood.js
   Версия: 1.2 (02.10) — новое чувство «Подавленность» (ключ `dejected`, эмодзи 😔): запись в `moodCategoriesResolved`, цвет в `computeMoodPalette` (средний тон, не тёмный), кнопка в сетке отметок после «Сонливости» (`CHECKIN_ORDER`). Диаграммы и список по дням берут категории из `moodCategoriesResolved`, отдельных правок не потребовали.
   Версия: 1.1 (29.09) — `--mood-joy` на <html> (цвет «Радости» для отметок задач), `window.syncMoodJoyColor`.
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
  var MOOD_FIRST_LOG_KEY = "__moodFirstLog";
  var MOOD_DATA_RESET_AT_KEY = "__moodDataResetAt";

  // Палитра настроений (ТЗ 28.09) — не фиксированные цвета, а оттенки цвета
  // ВЫБРАННОЙ ВКЛАДКИ настроек (var(--wood), см. .settings-tab.active в modals.css;
  // в каждой теме он свой). «Внутренний мир» — сам этот цвет; «Раздражительность»
  // и «Тревожность» — темнее него (тревожность темнее всех); «Радость»,
  // «Спокойствие», «Сонливость», «Грусть» (именно в таком порядке) — каждая
  // следующая пастельнее предыдущей. Оттенок при этом слегка сдвигается, чтобы
  // цвета не были просто «серией серых». Считается при каждой отрисовке вкладки
  // (тема могла смениться), результат лежит в moodPalette и общий для обеих
  // диаграмм (круговой и столбиковой).
  var moodPalette = {};
  function readWoodRgb(){
    var host = document.getElementById("settingsTabContent") || document.body;
    var probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--wood);";
    host.appendChild(probe);
    var col = getComputedStyle(probe).color;
    host.removeChild(probe);
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(col || "");
    return m ? [+m[1], +m[2], +m[3]] : [75, 58, 110];
  }
  function rgbToHsl(r, g, b){
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if(max !== min){
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if(max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if(max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l){
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if(h < 60){ r = c; g = x; } else if(h < 120){ r = x; g = c; }
    else if(h < 180){ g = c; b = x; } else if(h < 240){ g = x; b = c; }
    else if(h < 300){ r = x; b = c; } else { r = c; b = x; }
    function hx(v){ var n = Math.round((v + m) * 255); return (n < 16 ? "0" : "") + n.toString(16); }
    return "#" + hx(r) + hx(g) + hx(b);
  }
  function computeMoodPalette(){
    var rgb = readWoodRgb();
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0], s = hsl[1], l = hsl[2];
    // s у совсем серых цветов (тема с почти нейтральным --wood) не растягиваем
    function pastel(t, dh){ return hslToHex(h + dh, s * (1 - 0.12 * t * 3), l + (0.95 - l) * t); }
    moodPalette = {
      down:    hslToHex(h, s, l),
      anger:   hslToHex(h - 6, s, Math.max(0.12, l * 0.86)), // 28.09: светлее (было l*0.72)
      anxiety: hslToHex(h + 6, s, Math.max(0.10, l * 0.72)), // 28.09: светлее (было l*0.5)
      joy:     pastel(0.30, 4),
      calm:    pastel(0.50, 8),
      sleepy:  pastel(0.68, 12),
      sad:     pastel(0.84, 16),
      dejected: pastel(0.18, -14) // 02.10: «Подавленность» — средний тон, не тёмный: чуть светлее «Внутреннего мира», со сдвигом оттенка
    };
    // ТЗ 29.09: цвет «Радости» отдаётся в CSS (--mood-joy на <html>) — им красится жёлтая отметка задач и
    // жёлтый кружок кнопки сортировки Red (modals.css, --flag-yellow). Обновляется здесь при каждом пересчёте
    // палитры и из my.js при смене темы (window.syncMoodJoyColor).
    try{ document.documentElement.style.setProperty("--mood-joy", moodPalette.joy); }catch(e){}
    return moodPalette;
  }
  function moodColor(key){ return moodPalette[key] || "#cccccc"; }
  // пересчёт палитры без отрисовки вкладки — нужен, чтобы --mood-joy был верным в любой момент (смена темы, старт)
  global.syncMoodJoyColor = function(){ try{ computeMoodPalette(); }catch(e){} };
  global.syncMoodJoyColor();

  function moodCategoriesResolved(){
    return [
      {key:"joy", emoji:"😊", label:"Радость"},
      {key:"sad", emoji:"😕", label:"Грусть"},
      {key:"calm", emoji:"🙄", label:"Спокойствие"},
      {key:"anger", emoji:"😡", label:"Раздражительность"},
      {key:"down", emoji:"😌", label:"Внутренний мир"},
      {key:"sleepy", emoji:"🥱", label:"Сонливость"},
      {key:"anxiety", emoji:"😰", label:"Тревожность"},
      {key:"dejected", emoji:"😔", label:"Подавленность"}
    ];
  }

  // Счётчик настроения включён всегда — отдельного переключателя в
  // настройках больше нет (см. renderSettingsTabGear в my.js).
  function isMoodEnabled(){ return true; }
  function getMoodDataResetAt(){ var r = state()[MOOD_DATA_RESET_AT_KEY]; return (r && r.c) ? r.c : 0; }

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

  function resetMoodData(){
    setHourState(MOOD_DATA_RESET_AT_KEY, Date.now());
    setHourState(MOOD_FIRST_LOG_KEY, null);
    saveLocalState();
    scheduleCloudPush();
  }

  // --- отметка настроения (до 2 вариантов за раз) ---
  // --- диаграмма настроения ---
  var moodDiagramExpanded = false;

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
    // K — общий масштаб диаграммы (ТЗ 28.09: сделать первую диаграмму больше);
    // все размеры умножаются на него, поэтому пропорции остаются прежними
    var K = 1.4; // 1.2 -> 1.32 -> 1.4 (28.09): svg 364px, шире окна (~350px) — см. отрицательные боковые margin у .mood-diagram-wrap в components.css; сами подписи-смайлики остаются в пределах окна
    var rx = 95*K, ry = 52*K, depth = 20*K;
    var size = 260*K, cx = size/2, cy = size/2 - depth/2;
    var gapDeg = 3;
    var collapsedOffset = 3*K, expandedOffset = 22*K;
    var ryRatio = ry/rx;

    var cum = 0;
    // точки нижней границы круговой диаграммы (обод + стенка по 3° и низ
    // смайликов), в координатах бокса svg: x — от центра, y — от верха; dx/dy —
    // направление, в котором долька (и её смайлик) уезжает при раздвижении
    var pieLower = [];
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
      var color = moodColor(cat.key);
      var wallColor = darkenColor(color, 55);

      var dirRad = (mid - 90) * Math.PI/180;
      var dx = Math.cos(dirRad), dy = Math.sin(dirRad) * ryRatio;

      var arcSteps = Math.max(1, Math.ceil((end - start) / 3));
      for(var ai = 0; ai <= arcSteps; ai++){
        var aDeg = start + (end - start) * ai / arcSteps;
        var rimPt = polarPointEllipse(0, 0, rx, ry, aDeg);
        pieLower.push({x: rimPt.x, y: cy + rimPt.y + moodWallThickness(depth, aDeg), dx: dx, dy: dy});
      }

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
      [-12, 0, 12].forEach(function(ex){
        pieLower.push({x: lx - cx + ex, y: ly + 13, dx: dx, dy: dy});
      });
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

    // Столбиковая диаграмма ставится так, чтобы её самый высокий (вместе с
    // подписью-числом) столбец в каждом месте ЛИШЬ на MOOD_CHART_GAP не доходил
    // до круговой диаграммы над ним, — зазор между диаграммами получается
    // минимальным, а если под круговой диаграммой оказываются большие столбцы
    // (или она раздвинута кликом), блок сам опускается ниже.
    var MOOD_CHART_GAP = 5;
    function layoutMoodBars(off, instant){
      var barsWrap = document.getElementById("moodBarsWrap");
      if(!barsWrap || !moodBarsGeom) return;
      var bw = barsWrap.clientWidth;
      if(!bw) return;
      var sc = bw / moodBarsGeom.W;
      // цифры над столбцами берут размер и шрифт от «Аа» (--mdeditor-font-size,
      // ТЗ 28.09): svg масштабируется (sc), поэтому в CSS размер делится на sc
      // (--mood-bar-scale), а верх подписи считаем по реальному размеру в px
      var barsSvg = barsWrap.querySelector("svg");
      if(barsSvg) barsSvg.style.setProperty("--mood-bar-scale", sc.toFixed(4));
      var fontPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mdeditor-font-size"));
      if(!isFinite(fontPx) || fontPx <= 0) fontPx = 15.5;
      var need = -Infinity;
      moodBarsGeom.items.forEach(function(it){
        var bx = (it.cx - moodBarsGeom.W / 2) * sc;
        var hw = (it.half + 6) * sc;
        var maxY = -Infinity;
        pieLower.forEach(function(p){
          var px = p.x + p.dx * off;
          if(px >= bx - hw && px <= bx + hw){
            var py = p.y + p.dy * off;
            if(py > maxY) maxY = py;
          }
        });
        if(maxY === -Infinity) return;
        var labelTopPx = it.labelBase * sc - fontPx * 0.8; // верх цифр ≈ 0.8 размера шрифта над базовой линией
        var m = maxY + MOOD_CHART_GAP - size - labelTopPx;
        if(m > need) need = m;
      });
      if(need === -Infinity) need = -60;
      need = Math.max(need, -size * 0.9);
      // при первой расстановке — без анимации (иначе блок «доезжает» из запасного отступа)
      if(instant) barsWrap.style.transition = "none";
      barsWrap.style.marginTop = Math.round(need) + "px";
      if(instant){ void barsWrap.offsetHeight; barsWrap.style.transition = ""; }
    }
    var layoutOffset = collapsedOffset;
    moodLayoutFn = function(){ layoutMoodBars(layoutOffset); };
    layoutMoodBars(layoutOffset, true);
    if(!moodLayoutBound){
      moodLayoutBound = true;
      window.addEventListener("resize", function(){ if(moodLayoutFn) moodLayoutFn(); });
    }

    var svgEl = document.getElementById("moodDiagramSvg");
    svgEl.addEventListener("click", function(){
      moodDiagramExpanded = !moodDiagramExpanded;
      var offset = moodDiagramExpanded ? expandedOffset : collapsedOffset;
      layoutOffset = offset;
      layoutMoodBars(offset);
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

  // Столбиковая диаграмма (ТЗ 28.09) — под круговой. Показывает ВСЕ настроения
  // (в том числе с нулём, чтобы места столбцов не прыгали), цвета — из той же
  // moodPalette, что и у круговой; над столбцом число отметок, под ним эмодзи.
  // Геометрия столбцов (в единицах viewBox) — нужна buildMoodDiagramSVG, чтобы
  // подвинуть столбиковую диаграмму вплотную к круговой, не заходя на неё
  // (см. layoutMoodBars ниже, ТЗ 28.09).
  var moodBarsGeom = null;
  var moodLayoutFn = null;
  var moodLayoutBound = false;
  function buildMoodBarsHtml(counts){
    // столбцы слева направо от самого большого к самому маленькому (ТЗ 28.09);
    // при равных значениях сохраняется обычный порядок категорий
    var cats = moodCategoriesResolved().map(function(c, i){ return {c: c, i: i}; })
      .sort(function(a, b){
        var d = (counts[b.c.key] || 0) - (counts[a.c.key] || 0);
        return d !== 0 ? d : a.i - b.i;
      }).map(function(x){ return x.c; });
    var W = 300, H = 180, baseY = 150, topPad = 14, maxH = baseY - topPad;
    var slot = W / cats.length, barW = 30;
    var max = 0;
    cats.forEach(function(c){ if(counts[c.key] > max) max = counts[c.key]; });
    moodBarsGeom = {W: W, items: []};
    var parts = ['<line x1="2" y1="' + baseY + '" x2="' + (W - 2) + '" y2="' + baseY + '" stroke="currentColor" stroke-opacity=".25" stroke-width="1"></line>'];
    cats.forEach(function(c, i){
      var n = counts[c.key] || 0;
      var cx = slot * i + slot / 2;
      var h = max > 0 ? Math.round(maxH * n / max) : 0;
      if(n > 0 && h < 3) h = 3;
      // labelBase — базовая линия подписи-числа над столбцом (в единицах viewBox);
      // верх подписи считает layoutMoodBars по реальному размеру шрифта «Аа»;
      // half — половина ширины столбца
      moodBarsGeom.items.push({cx: cx, half: barW / 2, labelBase: baseY - h - 5});
      if(n > 0){
        parts.push('<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + (baseY - h) + '" width="' + barW + '" height="' + h +
          '" rx="4" ry="4" fill="' + moodColor(c.key) + '"></rect>');
      }
      parts.push('<text x="' + cx.toFixed(1) + '" y="' + (baseY - h - 5) + '" text-anchor="middle" class="mood-bar-count" fill="currentColor"' +
        (n > 0 ? '' : ' fill-opacity=".45"') + '>' + n + '</text>');
      parts.push('<text x="' + cx.toFixed(1) + '" y="' + (baseY + 24) + '" text-anchor="middle" font-size="20">' + c.emoji + '</text>');
    });
    return '<div class="mood-bars-wrap" id="moodBarsWrap">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;overflow:visible;" role="img" aria-label="Столбиковая диаграмма настроения">' +
      parts.join("") + '</svg></div>';
  }

  // --- отметка настроения, встроенная во вкладку диаграммы (плавающая
  //     кнопка настроек) — по нажатию на один вариант запись сразу
  //     сохраняется и обновляет диаграмму выше, без отдельной кнопки
  //     подтверждения и без выбора нескольких вариантов сразу ---

  function buildMoodCheckinBlockHtml(){
    var cats = moodCategoriesResolved();
    // Порядок кнопок задан явно (ТЗ 28.09), слева направо по 3 в ряд:
    // 1) Внутренний мир, Радость, Спокойствие; 2) Грусть, Тревожность,
    // Раздражительность; 3) Сонливость, Подавленность. Порядок здесь — только для сетки кнопок,
    // порядок цветов/категорий (moodCategoriesResolved) не затрагивается.
    var CHECKIN_ORDER = ["down", "joy", "calm", "sad", "anxiety", "anger", "sleepy", "dejected"];
    var byKey = {};
    cats.forEach(function(c){ byKey[c.key] = c; });
    var ordered = CHECKIN_ORDER.map(function(k){ return byKey[k]; }).filter(Boolean);
    var items = ordered.map(function(c){
      return '<div class="mood-checkin-item" data-mood="' + c.key + '">' +
        '<span class="emoji">' + c.emoji + '</span><span class="label">' + c.label + '</span></div>';
    }).join("");
    // Вопрос — обычный <p> без своего класса, но стилизуется через селектор
    // .mood-tab-checkin p в components.css (ТЗ пользователя от 08.09: тот
    // же шрифт/размер, что и у заголовка "Диаграмма настроения" выше,
    // центрирование, отступ 8px до кнопок) — родительский класс
    // .mood-tab-checkin делает это точечным, поэтому вопрос "Точно сбросить
    // весь прогресс чтения и начать сначала?" на вкладке resetConfirm (см.
    // renderSettingsTabResetConfirm), у которого нет этого класса на
    // родителе, не затронут и остаётся на унаследованном шрифте body.
    // Расстояние до кнопок под ним стягивается стилями .mood-tab-checkin в
    // components.css (там же и уменьшенная сетка для этого узкого окна).
    return (
      // без .settings-content-bottom (ТЗ 28.09): блок больше не прижимается к низу
      // окна принудительно — на вкладке теперь хватает содержимого, и он и так внизу
      '<div class="mood-tab-checkin">' +
      '<p class="common-tab-title">Что ты сейчас чувствуешь?</p>' + // тот же стиль, что у заголовка вкладки (ТЗ 28.09)
      '<div class="mood-checkin-grid" id="settingsMoodCheckinGrid">' + items + '</div>' +
      '</div>'
    );
  }

  // Сохраняет запись настроения по одному выбранному варианту и
  // обновляет диаграмму — вызывается сразу по нажатию на вариант.
  function commitMoodTabCheckin(key){
    var sessionTs = Date.now();
    state()["moodsession:" + sessionTs + "-" + Math.random().toString(36).slice(2,7)] = {c: 1, t: sessionTs};
    state()["moodlog:" + sessionTs + "-" + key + "-" + Math.random().toString(36).slice(2,7)] = {c: key, t: sessionTs};
    if(!state()[MOOD_FIRST_LOG_KEY] || state()[MOOD_FIRST_LOG_KEY].c == null || state()[MOOD_FIRST_LOG_KEY].c < getMoodDataResetAt()){
      setHourState(MOOD_FIRST_LOG_KEY, sessionTs);
    }
    saveLocalState();
    scheduleCloudPush();
    refreshYearGridIfOpen();
  }

  function bindMoodCheckinBlock(){
    var grid = document.getElementById("settingsMoodCheckinGrid");
    if(!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll("[data-mood]"), function(el){
      el.addEventListener("click", function(){
        commitMoodTabCheckin(el.getAttribute("data-mood"));
        renderSettingsTabMood();
      });
    });
  }

  function renderSettingsTabMood(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var counts = getMoodCounts();
    var total = 0;
    Object.keys(counts).forEach(function(k){ total += counts[k]; });

    computeMoodPalette(); // до сборки html: цвета нужны и круговой, и столбиковой диаграмме
    var diagramHtml;
    if(total === 0){
      diagramHtml = '<div class="mood-diagram-empty">Данных о настроении нет. Добавьте настроение — тогда здесь появится диаграмма.</div>';
    } else {
      var firstLogRec = state()[MOOD_FIRST_LOG_KEY];
      var totalDays = 1;
      if(firstLogRec && firstLogRec.c){
        totalDays = Math.round((startOfDay(Date.now()) - startOfDay(firstLogRec.c)) / DAY_MS) + 1;
      }
      var sessionsCount = getTotalSessionsCount();
      var title = "Диаграмма настроения " + formatMoodPeriodLabel(totalDays) +
        " - всего " + sessionsCount + " " + pluralRu(sessionsCount, MARK_FORMS) + " настроения";
      diagramHtml =
        '<div class="common-tab-title">' + escapeHtml(title) + '</div>' +
        '<div class="mood-diagram-wrap" id="moodDiagramWrap"></div>' +
        buildMoodBarsHtml(counts);
    }

    // кнопка «Сбросить данные настроения» перенесена на вкладку настроек
    // (renderSettingsTabGear в my.js, ТЗ 28.09)
    container.innerHTML = diagramHtml + buildMoodCheckinBlockHtml();

    if(total > 0){
      buildMoodDiagramSVG(counts, total);
    }
    bindMoodCheckinBlock();
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
      switchSettingsTab("gear"); // кнопка сброса теперь на вкладке настроек (ТЗ 28.09)
    });
    document.getElementById("mMoodResetConfirmNoBtn").addEventListener("click", function(){
      switchSettingsTab("gear");
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
      getMoodDataResetAt: getMoodDataResetAt,
      getMoodCounts: getMoodCounts,
      moodCategoriesResolved: moodCategoriesResolved,
      resetMoodData: resetMoodData,
      renderSettingsTabMood: renderSettingsTabMood,
      renderSettingsTabMoodResetConfirm: renderSettingsTabMoodResetConfirm,
      getMoodsByDay: getMoodsByDay
    };
  }

  global.initMoodModule = initMoodModule;
})(typeof window !== "undefined" ? window : this);
