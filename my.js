/* ===========================================================================
   my.js
   Основная логика приложения «График чтения Библии»
   =========================================================================== */

(function(){
  "use strict";

  // ===================== ДАННЫЕ БИБЛИИ =====================
  var sections = [
    {
      title:"Еврейско-арамейские Писания",
      books:[
        ["Бытие",50],["Исход",40],["Левит",27],["Числа",36],["Второзаконие",34],
        ["Иисус Навин",24],["Судей",21],["Руфь",4],["1 Самуила",31],["2 Самуила",24],
        ["1 Царей",22],["2 Царей",25],["1 Летопись",29],["2 Летопись",36],["Ездра",10],
        ["Неемия",13],["Эсфирь",10],["Иов",42],["Псалмы",150],["Притчи",31],
        ["Экклезиаст",12],["Песня Соломона",8],["Исаия",66],["Иеремия",52],["Плач Иеремии",5],
        ["Иезекииль",48],["Даниил",12],["Осия",14],["Иоиль",3],["Амос",9],
        ["Авдий",1],["Иона",4],["Михей",7],["Наум",3],["Аввакум",3],
        ["Софония",3],["Аггей",2],["Захария",14],["Малахия",4]
      ]
    },
    {
      title:"Христианские Греческие Писания",
      books:[
        ["Матфея",28],["Марка",16],["Луки",24],["Иоанна",21],["Деяния",28],
        ["Римлянам",16],["1 Коринфянам",16],["2 Коринфянам",13],["Галатам",6],["Эфесянам",6],
        ["Филиппийцам",4],["Колоссянам",4],["1 Фессалоникийцам",5],["2 Фессалоникийцам",3],["1 Тимофею",6],
        ["2 Тимофею",4],["Титу",3],["Филимону",1],["Евреям",13],["Иакова",5],
        ["1 Петра",5],["2 Петра",3],["1 Иоанна",5],["2 Иоанна",1],["3 Иоанна",1],
        ["Иуды",1],["Откровение",22]
      ]
    }
  ];

  var TOTAL_CHAPTERS = 0;
  sections.forEach(function(s){ s.books.forEach(function(b){ TOTAL_CHAPTERS += b[1]; }); });

  // ===================== ХРАНЕНИЕ (с дебаунсом) =====================
  var STORAGE_KEY = "bibleReadingProgress_v2";
  var OLD_STORAGE_KEY = "bibleReadingProgress_v1";
  var SYNC_ID_KEY = "bibleReadingSyncId_v1";
  var MIGRATED_KEY = "__migrated_v2";
  var CELEBRATION_SHOWN_KEY = "bibleCelebrationShown_v1";
  var UPDATE_DISMISSED_KEY = "bibleUpdateDismissedVersion_v1";
  var UPDATE_SNOOZE_KEY = "bibleUpdateSnoozeUntil_v1";
  var UPDATES_DISABLED_KEY = "bibleUpdatesDisabled_v1";
  var GOALS_EXPANDED_KEY = "bibleGoalsBandExpanded_v1";
  var SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;


  // ===================== ЦИТАТЫ ДНЯ =====================
  var QUOTE_KEY = "__quote";
  var QUOTES = [
    "«Счастлив тот, кто… находит радость в законе Иеговы и читает его вполголоса день и ночь» (Псалом 1:1, 2).",
    "«Закон Иеговы совершенен, восстанавливает силы» (Псалом 19:7).",
    "«Счастливы те, кто стремится утолить свой духовный голод» (Матфея 5:3).",
    "«Я по-настоящему люблю закон Бога» (Римлянам 7:22).",
    "«Как я люблю твой закон! Весь день размышляю о нём» (Псалом 119:97).",
    "«Размышляй об этом, будь этим поглощён, чтобы твои духовные успехи были видны всем» (1 Тим. 4:15).",
    "«Кто всматривается в совершенный закон, ведущий к свободе, и соблюдает его, тот не забывает услышанное» (Иакова 1:25).",
    "«Наставления Иеговы достойны доверия, делают неопытных мудрыми» (Псалом 19:7).",
    "«Повеления Иеговы справедливы, радуют сердце» (Псалом 19:8).",
    "«Всё написанное прежде было написано для нашего наставления» (Рим. 15:4).",
    "«Заповедь Иеговы чиста, наделяет проницательностью» (Псалом 19:8).",
    "«Закон, который ты дал, для меня лучше… золота и серебра» (Псалом 119:72).",
    "«[Иегова] оживляет мою душу, ведёт путями праведности» (Псалом 23:3).",
    "«Твои наставления прекрасны, поэтому я следую им» (Псалом 119:129).",
    "«Всё Писание вдохновлено Богом и полезно» (2 Тим. 3:16).",
    "«Твоё слово — это истина» (Иоанна 17:17).",
    "«Людей направлял святой дух, и они передавали весть Бога» (2 Пет. 1:21).",
    "«Вы хорошо делаете, что относитесь к [пророческому слову] со всем вниманием» (2 Пет. 1:19).",
    "«[Писание] помогает обучать, обличать, исправлять, наставлять на правильный путь» (2 Тим. 3:16).",
    "«Твоё слово — светильник для моих ног и свет на моём пути» (Пс. 119:105)."
  ];

  // Слоты дня: 0=ночь(0-8), 1=утро(8-12), 2=день(12-18), 3=вечер(18-24)
  function getDaySlot(){
    var h = new Date().getHours();
    if(h < 8) return 0;
    if(h < 12) return 1;
    if(h < 18) return 2;
    return 3;
  }

  function getQuoteRec(){
    var rec = state[QUOTE_KEY];
    if(!rec || typeof rec.c !== "number") return {c:0, t:0, slot:-1};
    // миграция со старого формата (без slot)
    if(typeof rec.slot !== "number"){
      rec = {c: rec.c, t: rec.t, slot: -1};
    }
    return rec;
  }

  function showQuote(idx){
    var el = document.getElementById("dailyQuote");
    if(!el) return;
    el.textContent = QUOTES[idx];
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ el.classList.add("visible"); });
    });
  }

  // Цитата меняется только тогда, когда пользователь ДЕЙСТВИТЕЛЬНО открыл
  // страницу в новом временном слоте относительно своего прошлого визита —
  // а не по факту того, что время просто прошло. Если человек не заходил
  // весь слот целиком, для него ничего не "сгорает" и не накапливается:
  // при следующем визите цитата сдвигается ровно на один шаг вперёд, а не
  // "досчитывает" пропущенные слоты.
  function initQuote(){
    var rec = getQuoteRec();
    var currentSlot = getDaySlot();
    var idx = rec.c;

    if(rec.slot < 0){
      // самый первый визит вообще — фиксируем слот, цитату не сдвигаем
      state[QUOTE_KEY] = {c: idx, t: Date.now(), slot: currentSlot};
      saveLocalState();
    } else if(currentSlot !== rec.slot){
      idx = (idx + 1) % QUOTES.length;
      state[QUOTE_KEY] = {c: idx, t: Date.now(), slot: currentSlot};
      saveLocalState();
    }
    showQuote(idx);
  }



  var state = loadState();
  var syncId = localStorage.getItem(SYNC_ID_KEY) || null;

  // Инкрементальные счётчики
  var totalChecked = 0;
  var checkedPerBook = {};

  var saveTimer = null;
  function saveLocalState(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
    }, 300);
  }

  function chapterKey(bookName, chapterNum){
    return bookName + "|" + chapterNum;
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(raw){ return JSON.parse(raw); }
    }catch(e){}

    // миграция со старой версии — единожды
    try{
      if(!localStorage.getItem(MIGRATED_KEY)){
        var oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
        if(oldRaw){
          var oldState = JSON.parse(oldRaw);
          var migrated = {};
          var now = Date.now();
          Object.keys(oldState).forEach(function(k){
            if(oldState[k]) migrated[k] = {c:true, t:now};
          });
          localStorage.setItem(MIGRATED_KEY, "1");
          return migrated;
        }
        localStorage.setItem(MIGRATED_KEY, "1");
      }
    }catch(e){}
    return {};
  }

  function isChecked(key){
    return !!(state[key] && state[key].c);
  }

  // ===================== ЦВЕТНАЯ ОТМЕТКА ГЛАВ =====================
  var CHAPTER_COLOR_BLUE = "#29B6F6";
  var CHAPTER_COLOR_RED = "#ED2939";

  function getColorMarkEnabled(){
    var r = state["__colorMarkChapters"];
    return !!(r && r.c);
  }
  function setColorMarkEnabled(value){
    state["__colorMarkChapters"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  // ===================== ДОПОЛНИТЕЛЬНЫЕ АНИМАЦИИ =====================
  // Настройка "Включить дополнительные анимации" (вкладка настроек,
  // шестерёнка). Пока управляет только диагональной "волной" открытия/
  // закрытия окна настроек от плавающей кнопки (см. animateSettingsWave
  // ниже) — в будущем сюда же можно добавить и другие необязательные
  // анимации за тем же флагом.
  function getExtraAnimationsEnabled(){
    var r = state["__extraAnimations"];
    return !!(r && r.c);
  }
  function setExtraAnimationsEnabled(value){
    state["__extraAnimations"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  // ===================== ВКЛАДКИ ЗАДАЧ (red/inbox/next/…) =====================
  // Список ключей вкладок задач в том же порядке, в каком они идут в DOM
  // (см. index.html, .settings-tabs) — используется и для показа/скрытия
  // ярлычков по галочке "Показать все мои задачи", и для переключения
  // между ними в switchSettingsTab. "council" — новая вкладка-список
  // задач между waiting и read, оформлена и работает так же, как next
  // (см. TASK_MOVABLE_TABS/TASK_MOVE_TARGET_TABS ниже); название нигде
  // текстом не выводится (см. TASK_TAB_TITLES.council).
  var TASK_TAB_IDS = {
    red: "settingsTabRedBtn",
    inbox: "settingsTabInboxBtn",
    next: "settingsTabNextBtn",
    projects: "settingsTabProjectsBtn",
    waiting: "settingsTabWaitingBtn",
    council: "settingsTabCouncilBtn",
    read: "settingsTabReadBtn",
    someday: "settingsTabSomedayBtn",
    archive: "settingsTabArchiveBtn"
  };
  var TASK_TAB_TITLES = {
    red: "Red", inbox: "Inbox", next: "Next", projects: "Projects",
    waiting: "Waiting", council: "", read: "Read", someday: "Someday", archive: "Archive"
  };
  // вкладки-списки задач, между которыми можно переносить задачу стрелочкой
  // (без архива — туда задача попадает только через отметку чекбокса).
  // "red" сюда тоже входит — используется, чтобы кнопка "+" показывалась
  // и на вкладке Red (там тоже можно создать задачу напрямую), но САМОЙ
  // "red" в качестве места хранения (реального taskа.c.tab) больше нет:
  // Red — это витрина по цветной отметке (см. TASK_MOVE_TARGET_TABS ниже,
  // getTasksForTab и cycleTaskFlag).
  var TASK_MOVABLE_TABS = ["red","inbox","next","projects","waiting","council","read","someday"];
  // 2 вкладки-заглушки в горизонтальном ряду рядом со вкладкой настроек
  // (было 3 — одну отдали под вкладку диаграммы настроения, см.
  // settingsTabMoodBtn/switchSettingsTab ниже, см. также
  // .settings-tabs-gear в index.html/modals.css) — контент под них ещё
  // не определён, показывают только "Контент появится позже" (см.
  // renderSettingsTabExtra ниже). В отличие от TASK_TAB_IDS видимость не
  // переключается — эти вкладки показаны всегда.
  var EXTRA_TAB_IDS = {
    extra2: "settingsTabExtra2Btn",
    extra3: "settingsTabExtra3Btn"
  };
  // а вот КУДА реально можно перенести задачу стрелочкой (пикер
  // "Перенести задачу") — без red, т.к. принадлежность к Red определяется
  // не вкладкой-домом, а цветной отметкой слева от чекбокса
  var TASK_MOVE_TARGET_TABS = ["inbox","next","projects","waiting","council","read","someday"];
  var TASK_MOVE_ICONS = {
    red: '<path d="M5 3v18"></path><path d="M5 4h11l-2.5 4L16 12H5"></path>',
    inbox: '<path d="M4 12h4l2 3h4l2-3h4"></path><path d="M4 12l1.5-7h13L20 12"></path><path d="M4 12v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"></path>',
    next: '<path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path>',
    projects: '<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z"></path>',
    waiting: '<path d="M6 3h12"></path><path d="M6 21h12"></path><path d="M7 3c0 4 3 5 5 6-2 1-5 2-5 6"></path><path d="M17 3c0 4-3 5-5 6 2 1 5 2 5 6"></path>',
    council: '<circle cx="12" cy="7.5" r="3"></circle><path d="M5 21c0-4 3-7 7-7s7 3 7 7"></path>',
    // раскрытая книга — та же геометрия, что и у вкладки Read в
    // index.html (перебалансированные пропорции разворота, см. пояснение
    // там же)
    read: '<path d="M12 7c-1.8-1-4.5-1.3-7-1.3v10c2.5 0 4.7.3 7 1.3"></path><path d="M12 7c1.8-1 4.5-1.3 7-1.3v10c-2.5 0-4.7.3-7 1.3"></path><path d="M12 7v10"></path>',
    // та же стрелочка, что у next, повёрнута на 90° против часовой стрелки,
    // чтобы указывать вверх (см. #settingsTabSomedayBtn в index.html)
    someday: '<g transform="rotate(-90 12 12)"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></g>'
  };
  var TASK_MOVE_ICON_SVG = function(key){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (TASK_MOVE_ICONS[key] || "") + '</svg>';
  };
  var ARROW_MOVE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></svg>';
  // галочка "перенести в архив" — заменяет собой прежний чекбокс задачи,
  // делает ровно то же самое (см. .task-done-btn в renderTaskRowView)
  var CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"></path></svg>';
  var LINK_NEXT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>';
  var RESTORE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>';
  var DELETE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>';
  var PAPERCLIP_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
  var TASK_ARCHIVE_MAX_SHOWN = 50;

  function getShowAllTasksEnabled(){
    var r = state["__showAllTasks"];
    return !!(r && r.c);
  }
  function setShowAllTasksEnabled(value){
    state["__showAllTasks"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function applyChapterColorClass(item, clr){
    if(!item) return;
    item.classList.remove("clr-green","clr-blue","clr-red");
    if(clr === "green") item.classList.add("clr-green");
    else if(clr === "blue") item.classList.add("clr-blue");
    else if(clr === "red") item.classList.add("clr-red");
  }
  function refreshAllChapterColorVisuals(){
    var enabled = getColorMarkEnabled();
    Object.keys(chapterInputs).forEach(function(key){
      var input = chapterInputs[key];
      if(!input || !input.parentElement) return;
      var item = input.parentElement;
      var stored = state[key];
      var clr = (stored && stored.clr) || (input.checked ? "green" : null);
      applyChapterColorClass(item, (enabled && input.checked && clr) ? clr : null);
    });
  }
  function cycleChapterState(bookName, key, input, item){
    var prevRec = state[key];
    var wasChecked = !!(prevRec && prevRec.c);
    var prevColor = (prevRec && prevRec.clr) || null;
    var newChecked, newColor;

    // цикл: не выделено -> зелёный -> синий -> красный -> не выделено
    if(!wasChecked){
      newChecked = true; newColor = "green";
    } else if(prevColor === "blue"){
      newChecked = true; newColor = "red";
    } else if(prevColor === "red"){
      newChecked = false; newColor = null;
    } else {
      // отмечена зелёным (или без цвета — устаревшие записи) — дальше синяя
      newChecked = true; newColor = "blue";
    }

    if(newChecked && !wasChecked){
      if(!state["__firstRead"] || state["__firstRead"].c == null){
        state["__firstRead"] = {c: Date.now(), t: Date.now()};
      }
      checkedPerBook[bookName]++;
      totalChecked++;
    } else if(!newChecked && wasChecked){
      if(prevRec && prevRec.c === true && startOfDay(prevRec.t) === startOfDay(Date.now())){
        addTodayExcludedKey(key);
      }
      checkedPerBook[bookName]--;
      totalChecked--;
    }

    state[key] = {c: newChecked, t: Date.now(), clr: newColor || undefined};
    input.checked = newChecked;
    applyChapterColorClass(item, newChecked ? newColor : null);

    saveLocalState();
    updateBookProgress(bookName);
    updateOverallProgress();
    updateMissedBanner();
    scheduleCloudPush();
    refreshYearGridIfOpen();
  }

  // ===================== ТЕМЫ =====================
  var THEME_KEY = "__theme";
  var DEFAULT_THEME_ID = 4;
  var THEMES = [
    {id:1, name:"Пергамент"},{id:2, name:"Шалфей и небо"},{id:3, name:"Розовый и мята"},
    {id:4, name:"Лаванда и слоновая кость"},{id:5, name:"Лимонный шифон и небо"},
    {id:6, name:"Пыльная роза и графит"},{id:7, name:"Морская пена и песок"}
  ];

  function getCurrentThemeId(){
    var rec = state[THEME_KEY];
    return (rec && rec.c) ? rec.c : DEFAULT_THEME_ID;
  }

  function applyThemeToPage(themeId){
    document.documentElement.setAttribute("data-theme", String(themeId));
    var dots = document.querySelectorAll(".theme-dot");
    dots.forEach(function(dot){
      dot.classList.toggle("selected", Number(dot.getAttribute("data-theme-id")) === themeId);
    });
    syncThemeColorMeta();
  }

  // синхронизирует <meta name="theme-color"> (цвет строки состояния в
  // Chrome и заголовка окна у установленного PWA) с реальным цветом
  // "шапки" темы — берёт готовое значение переменной --wood прямо из
  // применённой темы (html[data-theme=...]), а не хранит отдельный
  // список цветов, который иначе легко рассинхронизировать с theme.css.
  // Раньше здесь было захардкожено значение из темы №1 (коричневое),
  // а по умолчанию включена тема №4 — из-за этого при каждой загрузке
  // страницы/установленного приложения строка сверху была коричневой
  // независимо от того, какая тема реально выбрана.
  function syncThemeColorMeta(){
    var wood = getComputedStyle(document.documentElement).getPropertyValue("--wood").trim();
    if(!wood) return;
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content", wood);
  }

  function selectTheme(themeId){
    state[THEME_KEY] = {c: themeId, t: Date.now()};
    saveLocalState();
    applyThemeToPage(themeId);
    scheduleCloudPush();
  }

  function renderThemeDots(){
    var holder = document.getElementById("themeDots");
    if(!holder) return;
    holder.innerHTML = "";
    var current = getCurrentThemeId();
    THEMES.forEach(function(theme){
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "theme-dot" + (theme.id === current ? " selected" : "");
      dot.setAttribute("data-theme-id", theme.id);
      dot.title = theme.name;
      dot.setAttribute("aria-label", "Тема: " + theme.name);
      dot.style.background = themeSwatchGradient(theme.id);
      dot.addEventListener("click", function(){ selectTheme(theme.id); });
      holder.appendChild(dot);
    });
  }

  function themeSwatchGradient(themeId){
    var swatches = {
      1:["#5c3d24","#48F78E"],2:["#5b7c99","#5AD1A0"],3:["#c98a97","#7FE8C0"],
      4:["#8f7fb8","#8FE3C7"],5:["#7fa8c9","#8FE0A8"],6:["#7d8a99","#8FD9B8"],7:["#6fada0","#6FE0C0"]
    };
    var pair = swatches[themeId] || swatches[1];
    return "linear-gradient(135deg, " + pair[0] + " 50%, " + pair[1] + " 50%)";
  }

  // ===================== ПРОПУЩЕННЫЕ ДНИ =====================
  var DAY_MS = 24 * 60 * 60 * 1000;
  function pluralRu(n, forms){
    var abs = Math.abs(n) % 100, n1 = abs % 10;
    if(abs > 10 && abs < 20) return forms[2];
    if(n1 > 1 && n1 < 5) return forms[1];
    if(n1 === 1) return forms[0];
    return forms[2];
  }
  var DAY_FORMS = ["день","дня","дней"], WEEK_FORMS = ["неделя","недели","недель"], MONTH_FORMS = ["месяц","месяца","месяцев"], YEAR_FORMS = ["год","года","лет"];

  function buildMissedMessage(totalDays){
    if(totalDays === 1) return "Пропущен 1 день.";
    if(totalDays < 7) return "Пропущено " + totalDays + " " + pluralRu(totalDays, DAY_FORMS) + ".";
    if(totalDays < 60){
      var weeks = Math.floor(totalDays / 7), days = totalDays - weeks * 7;
      var msg = "Пропущено " + weeks + " " + pluralRu(weeks, WEEK_FORMS);
      if(days > 0) msg += " и " + days + " " + pluralRu(days, DAY_FORMS);
      return msg + ".";
    }
    if(totalDays < 90){
      var months = Math.floor(totalDays / 30), remDays = totalDays - months * 30, remWeeks = Math.floor(remDays / 7);
      var msg2 = "Пропущено " + months + " " + pluralRu(months, MONTH_FORMS);
      if(remWeeks > 0) msg2 += " и " + remWeeks + " " + pluralRu(remWeeks, WEEK_FORMS);
      return msg2 + ".";
    }
    if(totalDays < 182) return "Пропущено более трех месяцев.";
    if(totalDays < 365) return "Пропущено более полугода.";
    if(totalDays < 730) return "Пропущено более 1 года.";
    return "Пропущено более двух лет.";
  }

  function startOfDay(ts){
    var d = new Date(ts);
    d.setHours(0,0,0,0);
    return d.getTime();
  }

  function todayDateStr(){
    var d = new Date();
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }

  // Ключи глав, которые сегодня уже были "сожжены": пользователь снял ранее
  // стоявшую галочку и снова её поставил в тот же день. Такая перепроверка
  // не должна засчитываться как повод убрать уведомление "Пропущено" —
  // иначе можно было бы обманывать счётчик, щёлкая одной и той же главой.
  // Реальный новый прогресс (другая глава) при этом продолжает работать
  // как обычно. Список сам "устаревает" на следующий день (сравнение дат).
  function getTodayExcludedKeys(){
    var rec = state["__lastReadExcludedToday"];
    if(!rec || !rec.c || rec.c.date !== todayDateStr()) return [];
    return rec.c.keys || [];
  }
  function addTodayExcludedKey(key){
    var today = todayDateStr();
    var rec = state["__lastReadExcludedToday"];
    var keys = (rec && rec.c && rec.c.date === today) ? rec.c.keys.slice() : [];
    if(keys.indexOf(key) === -1) keys.push(key);
    state["__lastReadExcludedToday"] = {c: {date: today, keys: keys}, t: Date.now()};
  }

  // "Последнее чтение" больше не хранится отдельным полем, которое можно
  // случайно рассинхронизировать с реальным состоянием глав — оно всегда
  // вычисляется напрямую: самая свежая отметка среди ГЛАВ, которые сейчас
  // действительно отмечены как прочитанные (и не "сожжены" сегодня).
  function computeEffectiveLastRead(){
    var excluded = getTodayExcludedKeys();
    var maxT = null;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(!rec || rec.c !== true) return;
      if(excluded.indexOf(k) !== -1) return;
      if(maxT === null || rec.t > maxT) maxT = rec.t;
    });
    return maxT;
  }

  function updateMissedBanner(){
    var wrap = document.getElementById("missedWrap"), textEl = document.getElementById("missedText");
    if(!wrap || !textEl) return;
    var lastReadTs = computeEffectiveLastRead();
    if(!lastReadTs){ wrap.classList.remove("visible"); return; }
    // считаем ПОЛНОСТЬЮ прошедшие календарные дни без единой отметки.
    // Разница дат сама по себе включает "сегодня" как ещё не законченный
    // день (в нём ещё можно успеть отметиться) — поэтому вычитаем 1: если
    // вчера была отметка, "вчера" не в счёт, а "сегодня" ещё идёт, значит
    // пропущенных дней пока 0, а не 1.
    var totalDays = Math.round((startOfDay(Date.now()) - startOfDay(lastReadTs)) / DAY_MS) - 1;
    if(totalDays < 1){ wrap.classList.remove("visible"); return; }
    textEl.textContent = buildMissedMessage(totalDays);
    wrap.classList.add("visible");
  }

  function joinRu(parts){
    if(parts.length === 1) return parts[0];
    if(parts.length === 2) return parts[0] + " и " + parts[1];
    return parts.slice(0, -1).join(", ") + " и " + parts[parts.length - 1];
  }
  function buildDurationText(totalDays){
    var years = Math.floor(totalDays / 365), rem = totalDays - years * 365, months = Math.floor(rem / 30), days = rem - months * 30;
    var parts = [];
    if(years > 0) parts.push(years + " " + pluralRu(years, YEAR_FORMS));
    if(months > 0) parts.push(months + " " + pluralRu(months, MONTH_FORMS));
    if(days > 0) parts.push(days + " " + pluralRu(days, DAY_FORMS));
    return parts.length === 0 ? "меньше дня" : joinRu(parts);
  }
  function getDurationSuffix(){
    var rec = state["__firstRead"];
    if(!rec || rec.c == null) return "";
    return " — " + buildDurationText(Math.floor((Date.now() - rec.c) / DAY_MS));
  }
  function ensureFirstReadInitialized(){
    if(state["__firstRead"]) return;
    var minT = null;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") !== -1 && state[k] && state[k].c){
        if(minT === null || state[k].t < minT) minT = state[k].t;
      }
    });
    if(minT !== null){ state["__firstRead"] = {c: minT, t: minT}; saveLocalState(); }
  }

  // ===================== ПОЗДРАВЛЕНИЕ =====================
  function showCelebrationModal(){
    var overlay = document.getElementById("modalOverlay"), box = document.getElementById("modalBox");
    if(!overlay || !box) return;
    function closeThis(){ overlay.classList.remove("open"); box.innerHTML = ""; }
    box.innerHTML = modalHeader("Ты молодец!", "Прочитал Библию полностью. Не останавливайся на достигнутом!") +
      '<button class="modal-btn primary" id="mCelebrateReset">Начать читать заново (сбросить прогресс)</button>' +
      '<button class="modal-btn" id="mCelebrateKeep">Не сбрасывать</button>';
    var closeBtn0 = document.getElementById("mClose");
    if(closeBtn0) closeBtn0.addEventListener("click", closeThis);
    overlay.classList.add("open");
    document.getElementById("mCelebrateReset").addEventListener("click", function(){
      performFullReset();
      box.innerHTML = modalHeader("Прогресс был обновлён", "Приятного чтения!") + '<button class="modal-btn primary" id="mDone">Продолжить</button>';
      var closeBtn1 = document.getElementById("mClose");
      if(closeBtn1) closeBtn1.addEventListener("click", closeThis);
      document.getElementById("mDone").addEventListener("click", closeThis);
    });
    document.getElementById("mCelebrateKeep").addEventListener("click", function(){
      box.innerHTML = modalHeader("Хорошо", "Помните, вы всегда можете начать читать Библию заново. Для этого просто нужно открыть настройки (значок шестерёнки внизу страницы) и нажать на кнопку «Начать чтение сначала и сбросить прогресс».") + '<button class="modal-btn primary" id="mOk">ОК</button>';
      var closeBtn2 = document.getElementById("mClose");
      if(closeBtn2) closeBtn2.addEventListener("click", closeThis);
      document.getElementById("mOk").addEventListener("click", closeThis);
    });
  }
  function checkCelebration(){
    if(totalChecked === TOTAL_CHAPTERS){
      if(localStorage.getItem(CELEBRATION_SHOWN_KEY) !== "1"){
        try{ localStorage.setItem(CELEBRATION_SHOWN_KEY, "1"); }catch(e){}
        showCelebrationModal();
      }
    } else {
      try{ localStorage.removeItem(CELEBRATION_SHOWN_KEY); }catch(e){}
    }
  }

  // ===================== ПОСТРОЕНИЕ СТРАНИЦЫ (DocumentFragment) =====================
  var booksContainer = document.getElementById("booksContainer");
  var overallFill = document.getElementById("overallFill");
  var overallText = document.getElementById("overallText");
  var bookMeta = {};
  var chapterInputs = {};

  function initPage(){
    var frag = document.createDocumentFragment();
    sections.forEach(function(section){
      var label = document.createElement("div");
      label.className = "section-label";
      label.textContent = section.title;
      frag.appendChild(label);

      section.books.forEach(function(book){
        var bookName = book[0], chapterCount = book[1];
        checkedPerBook[bookName] = 0;

        var card = document.createElement("div");
        card.className = "book-card";

        var headerEl = document.createElement("div");
        headerEl.className = "book-header";

        var fillEl = document.createElement("div");
        fillEl.className = "book-fill";

        var headerContent = document.createElement("div");
        headerContent.className = "book-header-content";

        var nameEl = document.createElement("div");
        nameEl.className = "book-name";
        nameEl.textContent = bookName;

        var countEl = document.createElement("div");
        countEl.className = "book-count";

        var toggleEl = document.createElement("div");
        toggleEl.className = "toggle-check";
        toggleEl.innerHTML = "<span>&gt;</span>";

        headerContent.appendChild(nameEl);
        headerContent.appendChild(countEl);
        headerContent.appendChild(toggleEl);
        headerEl.appendChild(fillEl);
        headerEl.appendChild(headerContent);

        var chaptersContainer = document.createElement("div");
        chaptersContainer.className = "chapters-container";

        var grid = document.createElement("div");
        grid.className = "chapters-grid";

        for(var c=1;c<=chapterCount;c++){
          (function(chapterNum){
            var key = chapterKey(bookName, chapterNum);
            var checked = isChecked(key);
            if(checked){ checkedPerBook[bookName]++; totalChecked++; }

            var item = document.createElement("div");
            item.className = "chapter-item";

            var input = document.createElement("input");
            input.type = "checkbox";
            input.id = "ch_" + bookName.replace(/\s+/g,"_") + "_" + chapterNum;
            input.checked = checked;

            var lbl = document.createElement("label");
            lbl.setAttribute("for", input.id);
            lbl.textContent = chapterNum;

            input.addEventListener("click", function(e){
              if(!getColorMarkEnabled()) return; // обычный режим — обрабатывается в "change"
              e.preventDefault();
              // Браузер откатывает checked к значению "до клика" сразу после
              // отмены дефолтного действия чекбокса — это происходит уже
              // ПОСЛЕ выполнения этого обработчика и стирает любое присвоение
              // input.checked, сделанное синхронно здесь. Откладываем на
              // следующий тик, чтобы наше значение применилось уже после
              // отката браузера.
              setTimeout(function(){
                cycleChapterState(bookName, key, input, item);
              }, 0);
            });

            input.addEventListener("change", function(){
              if(getColorMarkEnabled()) return; // цветовой режим — уже обработано в "click"
              var prevRec = state[key];
              state[key] = {c: input.checked, t: Date.now()};
              if(input.checked){
                if(!state["__firstRead"] || state["__firstRead"].c == null){
                  state["__firstRead"] = {c: Date.now(), t: Date.now()};
                }
                checkedPerBook[bookName]++;
                totalChecked++;
              } else {
                // снимаем галочку, стоявшую с СЕГОДНЯ — значит, это была
                // сегодняшняя перепроверка, а не подтверждённое со вчера
                // чтение; помечаем её "сожжённой" на сегодня, чтобы
                // повторная установка в тот же день не засчиталась заново
                if(prevRec && prevRec.c === true && startOfDay(prevRec.t) === startOfDay(Date.now())){
                  addTodayExcludedKey(key);
                }
                checkedPerBook[bookName]--;
                totalChecked--;
              }
              saveLocalState();
              updateBookProgress(bookName);
              updateOverallProgress();
              updateMissedBanner();
              scheduleCloudPush();
            });

            chapterInputs[key] = input;
            item.appendChild(input);
            item.appendChild(lbl);
            grid.appendChild(item);
            if(checked && getColorMarkEnabled()){
              var storedClr = (state[key] && state[key].clr) || null;
              if(storedClr) applyChapterColorClass(item, storedClr);
            }
          })(c);
        }

        chaptersContainer.appendChild(grid);

        headerEl.addEventListener("click", function(){
          var isOpen = chaptersContainer.classList.toggle("open");
          headerEl.classList.toggle("expanded", isOpen);
          if(isOpen){
            chaptersContainer.style.setProperty("--ch-h", grid.scrollHeight + 28 + "px");
          }
        });

        card.appendChild(headerEl);
        card.appendChild(chaptersContainer);
        frag.appendChild(card);

        bookMeta[bookName] = {fillEl:fillEl, countEl:countEl, chapterCount:chapterCount, card:card};
        updateBookProgress(bookName);
      });
    });
    booksContainer.appendChild(frag);
    addHideProgressButton();
  }

  // --- "Скрыть прогресс": прячет из списка книги, прочитанные на 100% ---
  function getHideCompletedActive(){
    var r = state["__hideCompletedBooks"];
    return !!(r && r.c);
  }
  function countCompletedBooks(){
    var n = 0;
    Object.keys(bookMeta).forEach(function(bookName){
      var meta = bookMeta[bookName];
      var checked = checkedPerBook[bookName] || 0;
      if(meta.chapterCount > 0 && checked === meta.chapterCount) n++;
    });
    return n;
  }
  var hideCompletedActive = false;
  function addHideProgressButton(){
    hideCompletedActive = getHideCompletedActive();
    var card = document.createElement("div");
    card.className = "book-card";
    var headerEl = document.createElement("div");
    headerEl.className = "book-header";
    var headerContent = document.createElement("div");
    headerContent.className = "book-header-content";
    var nameEl = document.createElement("div");
    nameEl.className = "book-name";
    nameEl.id = "hideProgressToggleText";
    nameEl.textContent = hideCompletedActive ? "Показать прочитанное" : "Скрыть прочитанное";
    var countEl = document.createElement("div");
    countEl.className = "book-count";
    countEl.id = "hideProgressCountBadge";
    var toggleEl = document.createElement("div");
    toggleEl.className = "toggle-check";
    headerContent.style.cursor = "pointer";
    headerContent.appendChild(nameEl);
    headerContent.appendChild(countEl);
    headerContent.appendChild(toggleEl);
    headerEl.appendChild(headerContent);
    headerContent.addEventListener("click", toggleHideCompletedBooks);
    card.appendChild(headerEl);
    booksContainer.appendChild(card);
    updateHideProgressBadge();
    // на момент отрисовки карточек книг (в цикле выше, см. renderBooks)
    // hideCompletedActive ещё не был загружен из сохранённого состояния
    // (оставался в дефолтном false), поэтому все карточки, включая уже
    // прочитанные на 100%, всегда отрисовывались видимыми — сохранённое
    // "скрыть прочитанное" применялось только к своей текстовой подписи и
    // счётчику, но не к самим карточкам. Досчитываем видимость карточек
    // здесь же, сразу после того, как значение подгружено из state.
    applyHideCompletedBooks();
  }
  function updateHideProgressBadge(){
    var badge = document.getElementById("hideProgressCountBadge");
    if(badge) badge.textContent = String(countCompletedBooks());
  }
  function applyHideCompletedBooks(){
    Object.keys(bookMeta).forEach(function(bookName){
      var meta = bookMeta[bookName];
      if(!meta || !meta.card) return;
      var checked = checkedPerBook[bookName] || 0;
      var isComplete = meta.chapterCount > 0 && checked === meta.chapterCount;
      meta.card.style.display = (hideCompletedActive && isComplete) ? "none" : "";
    });
    updateHideProgressBadge();
  }
  function toggleHideCompletedBooks(){
    hideCompletedActive = !hideCompletedActive;
    state["__hideCompletedBooks"] = {c: hideCompletedActive, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    var textEl = document.getElementById("hideProgressToggleText");
    if(textEl) textEl.textContent = hideCompletedActive ? "Показать прочитанное" : "Скрыть прочитанное";
    applyHideCompletedBooks();
  }

  function updateBookProgress(bookName){
    var meta = bookMeta[bookName];
    var checked = checkedPerBook[bookName] || 0;
    var pct = meta.chapterCount ? Math.round((checked/meta.chapterCount)*100) : 0;
    meta.fillEl.style.width = pct + "%";
    meta.countEl.textContent = checked + " / " + meta.chapterCount;
    if(hideCompletedActive && meta.card){
      meta.card.style.display = (meta.chapterCount > 0 && checked === meta.chapterCount) ? "none" : "";
    }
    updateHideProgressBadge();
  }

  function updateOverallProgress(){
    var pct = TOTAL_CHAPTERS ? Math.round((totalChecked/TOTAL_CHAPTERS)*100) : 0;
    overallFill.style.width = pct + "%";
    overallText.textContent = totalChecked + " из " + TOTAL_CHAPTERS + " глав (" + pct + "%)" + getDurationSuffix();
    checkCelebration();
  }

  function rerenderAllFromState(){
    var prevTotal = totalChecked;
    totalChecked = 0;
    Object.keys(checkedPerBook).forEach(function(bn){ checkedPerBook[bn] = 0; });

    Object.keys(chapterInputs).forEach(function(key){
      var input = chapterInputs[key];
      var newChecked = isChecked(key);
      if(input.checked !== newChecked) input.checked = newChecked;
      if(newChecked){
        var parts = key.split("|");
        checkedPerBook[parts[0]] = (checkedPerBook[parts[0]] || 0) + 1;
        totalChecked++;
      }
    });
    refreshAllChapterColorVisuals();

    Object.keys(bookMeta).forEach(function(bookName){
      updateBookProgress(bookName);
    });
    updateOverallProgress();
    applyThemeToPage(getCurrentThemeId());
    if(!document.getElementById("themeDots").children.length) renderThemeDots();
    updateMissedBanner();
    renderHourBars();
    renderHourCounterMenu();
    renderMoodPill();
    renderMoodMenu();
    renderGoalsSection();
    renderAddGoalMenu();
    refreshYearGridIfOpen();
  }

  // ===================== СБРОС ПРОГРЕССА =====================
  function setNoTransitions(enable){
    document.body.classList.toggle("no-transitions", enable);
  }

  function performFullReset(){
    setNoTransitions(true);
    var now = Date.now();
    sections.forEach(function(section){
      section.books.forEach(function(book){
        var bookName = book[0], chapterCount = book[1];
        checkedPerBook[bookName] = 0;
        for(var c=1;c<=chapterCount;c++){
          state[chapterKey(bookName,c)] = {c:false, t:now};
        }
      });
    });
    totalChecked = 0;
    state["__lastReadExcludedToday"] = {c:null, t:now};
    state["__firstRead"] = {c:null, t:now};
    saveLocalState();
    rerenderAllFromState();
    try{ localStorage.removeItem(CELEBRATION_SHOWN_KEY); }catch(e){}
    setTimeout(function(){ setNoTransitions(false); }, 50);

    if(syncId && navigator.onLine){
      setSyncState("syncing");
      putCloudBlob(syncId, state).then(function(){ setSyncState("synced"); }).catch(function(){ setSyncState("error"); });
    }
  }

  // Кнопка сброса прогресса перенесена в настройки (settingsResetBtn, см. renderSettingsTabGear)

  // ===================== ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ (Firebase Realtime Database) =====================
  // ВАЖНО: этот URL нужно проверить/поправить на точный "Database URL" из
  // консоли Firebase (Realtime Database → вкладка Data, отображается прямо
  // над данными). Обычно это или https://<имя>.firebaseio.com, или адрес
  // с регионом вида https://<имя>.<регион>.firebasedatabase.app — они
  // отличаются в зависимости от того, в каком регионе была создана база.
  // Правила сейчас открытые (read/write: true), поэтому токен/ключ не
  // нужен — простые GET/PUT запросы работают напрямую.
  var FIREBASE_DB_URL = "https://my-nekogram-default-rtdb.europe-west1.firebasedatabase.app";
  var FIREBASE_SYNCS_PATH = "/syncs";

  function fetchWithTimeout(url, options, timeoutMs){
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs || 8000);
    options = options || {};
    options.signal = ctrl.signal;
    return fetch(url, options).finally(function(){ clearTimeout(timer); });
  }

  function generateSyncId(){
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
  }

  function fetchCloudBlob(id){
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", {
      method:"GET"
    }, 8000).then(function(res){
      if(!res.ok) throw new Error("fetch_failed_" + res.status);
      return res.json();
    }).then(function(data){
      // Firebase отдаёт null (не 404), если по пути ничего нет
      if(data === null || data === undefined) throw new Error("not_found");
      return data;
    });
  }

  function putCloudBlob(id, data){
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(data)
    }, 15000).then(function(res){
      if(!res.ok) throw new Error("put_failed_" + res.status);
      return true;
    });
  }

  // отдельного "создания" Firebase не требует — запись по случайному ID
  // сама создаёт узел при первом PUT
  function createCloudBlob(initialData){
    var id = generateSyncId();
    return putCloudBlob(id, initialData).then(function(){ return id; });
  }

  function mergeStates(local, cloud){
    var merged = {}, keys = {};
    Object.keys(local||{}).forEach(function(k){ keys[k]=true; });
    Object.keys(cloud||{}).forEach(function(k){ keys[k]=true; });
    Object.keys(keys).forEach(function(k){
      var l = local ? local[k] : null, c = cloud ? cloud[k] : null;
      merged[k] = (l && c) ? ((l.t >= c.t) ? l : c) : (l || c);
    });
    return merged;
  }

  function statesEqual(a, b){
    var ak = Object.keys(a||{}).sort(), bk = Object.keys(b||{}).sort();
    if(ak.length !== bk.length) return false;
    for(var i=0;i<ak.length;i++){
      var k = ak[i];
      if(!b[k]) return false;
      if(a[k].c !== b[k].c || a[k].t !== b[k].t) return false;
    }
    return true;
  }

  var syncStatusPill = document.getElementById("syncStatusPill");
  var syncStatusText = document.getElementById("syncStatusText");

  function setSyncState(st, extraText){
    syncStatusPill.setAttribute("data-state", st);
    var labels = {off:"Синхронизация выкл.",offline:"Офлайн",syncing:"Синхронизация…",synced:"Синхронизировано",error:"Ошибка синхронизации"};
    syncStatusText.textContent = extraText || labels[st] || "";
  }

  function refreshStatusBase(){
    if(!syncId){ setSyncState("off"); return; }
    if(!navigator.onLine){ setSyncState("offline"); return; }
    setSyncState("synced");
  }
  refreshStatusBase();

  var pushTimer = null;
  function scheduleCloudPush(){
    if(!syncId) return;
    clearTimeout(pushTimer);
    clearTimeout(syncRetryTimer);
    syncRetryCount = 0;
    pushTimer = setTimeout(doCloudSync, 1500);
  }

  var syncInProgress = false;
  var syncRetryCount = 0;
  var syncRetryTimer = null;
  var SYNC_RETRY_DELAYS = [5000, 15000, 40000, 90000];

  function doCloudSync(){
    if(!syncId) { setSyncState("off"); return; }
    if(!navigator.onLine){ setSyncState("offline"); return; }
    if(syncInProgress) return;
    syncInProgress = true;
    setSyncState("syncing");
    fetchCloudBlob(syncId).then(function(cloudData){
      var merged = mergeStates(state, cloudData);
      var localChanged = !statesEqual(merged, state);
      var cloudChanged = !statesEqual(merged, cloudData);
      state = merged;
      if(localChanged){
        saveLocalState();
        setNoTransitions(true);
        rerenderAllFromState();
        setTimeout(function(){ setNoTransitions(false); }, 50);
      }
      if(cloudChanged){
        return putCloudBlob(syncId, merged);
      }
    }).then(function(){
      syncRetryCount = 0;
      clearTimeout(syncRetryTimer);
      setSyncState("synced");
    }).catch(function(err){
      console.error("Ошибка синхронизации:", err);
      setSyncState("error");
      // не заставляем пользователя перепривязывать устройство вручную —
      // сами повторяем попытку с нарастающей паузой (сбой чаще всего
      // временный: сеть моргнула или разросшийся объём данных долго грузится)
      if(syncRetryCount < SYNC_RETRY_DELAYS.length){
        var delay = SYNC_RETRY_DELAYS[syncRetryCount];
        syncRetryCount++;
        clearTimeout(syncRetryTimer);
        syncRetryTimer = setTimeout(doCloudSync, delay);
      }
    }).finally(function(){
      syncInProgress = false;
    });
  }

  window.addEventListener("online", function(){
    refreshStatusBase();
    syncRetryCount = 0;
    clearTimeout(syncRetryTimer);
    doCloudSync();
  });
  window.addEventListener("offline", function(){ refreshStatusBase(); });
  if(syncId) doCloudSync();

  // ===================== МОДАЛЬНОЕ ОКНО СИНХРОНИЗАЦИИ =====================
  var modalOverlay = document.getElementById("modalOverlay");
  var modalBox = document.getElementById("modalBox");
  var activeStream = null, scanRAF = null;

  function stopCamera(){
    if(scanRAF){ cancelAnimationFrame(scanRAF); scanRAF = null; }
    if(activeStream){ activeStream.getTracks().forEach(function(t){ t.stop(); }); activeStream = null; }
  }
  function closeModal(){ stopCamera(); flushPendingTaskEdits(); modalOverlay.classList.remove("open"); modalBox.classList.remove("year-day-modal"); modalBox.innerHTML = ""; }
  function openModal(){ modalOverlay.classList.add("open"); renderModalHome(); }
  modalOverlay.addEventListener("click", function(e){ if(e.target === modalOverlay) closeModal(); });
  syncStatusPill.addEventListener("click", openModal);

  function modalHeader(title, subtitle){
    var h = '<button class="modal-close" id="mClose">&times;</button><h2>' + title + '</h2>';
    if(subtitle) h += '<p>' + subtitle + '</p>';
    return h;
  }
  function bindClose(){ var btn = document.getElementById("mClose"); if(btn) btn.addEventListener("click", closeModal); }

  // --- ленивая загрузка QRCode и jsQR ---
  var qrLibLoaded = false, jsqrLibLoaded = false;
  function loadQrLib(){
    if(qrLibLoaded) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/davidshimjs-qrcodejs@0.0.2/qrcode.min.js";
      s.onload = function(){ qrLibLoaded = true; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadJsqrLib(){
    if(jsqrLibLoaded) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
      s.onload = function(){ jsqrLibLoaded = true; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ===================== ЭКСПОРТ ЛИЧНЫХ ДАННЫХ =====================
  // Собирает всё в структуру, понятную и человеку, и нейросети (плоские
  // списки "дата -> что было в этот день"), и упаковывает в настоящий
  // ZIP-архив без сторонних библиотек (формат STORED — без сжатия, это
  // самый простой валидный вариант ZIP, полностью совместимый с любым
  // распаковщиком).
  function isoDate(ts){ return new Date(ts).toISOString().slice(0,10); }

  function buildExportData(){
    var data = {
      exportedAt: new Date().toISOString(),
      app: "Bible Reading Tracker — экспорт личных данных",
      readingProgress: {
        totalChapters: TOTAL_CHAPTERS,
        checkedChapters: totalChecked,
        percentComplete: TOTAL_CHAPTERS ? Math.round((totalChecked/TOTAL_CHAPTERS)*100) : 0
      },
      dailyReadingLog: [],
      hourCounter: {
        enabled: !!getHourGoal(),
        goalHoursPerMonth: getHourGoal(),
        monthsToSeptember: getMonthsToSeptember(),
        note: "dailyHoursLog содержит только текущий незакрытый период — итоги закрытых месяцев доступны только суммарно, в closedMonthSegments",
        dailyHoursLog: [],
        closedMonthSegments: [],
        notesEnabled: isHourNotesEnabled(),
        dailyNotesLog: []
      },
      moodCounter: {
        enabled: isMoodEnabled(),
        dailyMoodLog: []
      }
    };

    var byDate = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(!rec || rec.c !== true) return;
      var d = isoDate(rec.t);
      (byDate[d] = byDate[d] || []).push(k.replace("|", " "));
    });
    Object.keys(byDate).sort().forEach(function(d){
      data.dailyReadingLog.push({date: d, chaptersRead: byDate[d], count: byDate[d].length});
    });

    var hourByDate = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") !== 0) return;
      var rec = state[k];
      if(!rec || typeof rec.c !== "number") return;
      var d = isoDate(rec.t);
      hourByDate[d] = (hourByDate[d]||0) + rec.c;
    });
    Object.keys(hourByDate).sort().forEach(function(d){
      data.hourCounter.dailyHoursLog.push({date:d, hoursMinutesText: formatHHMM(hourByDate[d]), minutes: hourByDate[d]});
    });
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hoursegment:") !== 0) return;
      var rec = state[k];
      if(!rec) return;
      data.hourCounter.closedMonthSegments.push({
        periodStartDate: isoDate(Number(k.slice("hoursegment:".length))),
        totalHours: Math.round(rec.c/60)
      });
    });

    var notesByDay = getHourNotesByDay();
    Object.keys(notesByDay).sort(function(a,b){ return Number(a)-Number(b); }).forEach(function(dayTs){
      data.hourCounter.dailyNotesLog.push({date: isoDate(Number(dayTs)), comment: notesByDay[dayTs]});
    });

    var moodByDate = {};
    var floor = getMoodDataResetAt();
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodlog:") !== 0) return;
      var rec = state[k];
      if(!rec || rec.t < floor) return;
      var d = isoDate(rec.t);
      (moodByDate[d] = moodByDate[d] || []).push(rec.c);
    });
    Object.keys(moodByDate).sort().forEach(function(d){
      data.moodCounter.dailyMoodLog.push({date:d, moods: moodByDate[d]});
    });

    // журнал выполненных задач по целям — хранится отдельно от самих целей,
    // поэтому остаётся в архиве, даже если цель потом удалили или сняли
    // с неё галочку
    data.goalCompletions = {
      note: "Список отмеченных задач по личным целям, по датам. Запись сохраняется здесь независимо от того, существует ли ещё сама цель — значит, здесь виден полный журнал выполненного, даже для уже удалённых или переиспользованных целей.",
      dailyLog: []
    };
    var goalByDate = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goalcompletion:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c) return;
      var d = isoDate(rec.t);
      (goalByDate[d] = goalByDate[d] || []).push({goal: rec.c.goalTitle, task: rec.c.taskText});
    });
    Object.keys(goalByDate).sort().forEach(function(d){
      data.goalCompletions.dailyLog.push({date:d, completed: goalByDate[d]});
    });

    return data;
  }

  function crc32Bytes(bytes){
    if(!crc32Bytes.table){
      var table = [];
      for(var n=0;n<256;n++){
        var c = n;
        for(var k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); }
        table[n] = c >>> 0;
      }
      crc32Bytes.table = table;
    }
    var crc = 0xFFFFFFFF;
    for(var i=0;i<bytes.length;i++){
      crc = crc32Bytes.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Собирает валидный ZIP (метод STORED, без сжатия) из списка файлов
  // {name, content: Uint8Array} — минимальная, но полностью рабочая
  // реализация формата, без сторонних библиотек.
  function buildZipBlob(files){
    var encoder = new TextEncoder();
    var localParts = [], centralParts = [];
    var offset = 0;

    files.forEach(function(f){
      var nameBytes = encoder.encode(f.name);
      var data = f.content;
      var crc = crc32Bytes(data);
      var size = data.length;
      var dosDate = 0x21, dosTime = 0;

      var lh = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0, true);
      ldv.setUint16(8, 0, true);
      ldv.setUint16(10, dosTime, true);
      ldv.setUint16(12, dosDate, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      localParts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, dosTime, true);
      cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralParts.push(ch);

      offset += lh.length + data.length;
    });

    var centralSize = centralParts.reduce(function(a,p){ return a+p.length; }, 0);
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);
    edv.setUint16(20, 0, true);

    return new Blob(localParts.concat(centralParts, [eocd]), {type:"application/zip"});
  }

  function exportSectionHtml(){
    return '<div class="modal-section">' +
      '<button class="modal-btn" id="mExportData">Экспортировать личные данные</button>' +
      '<p class="modal-note">Скачает ZIP-архив со всеми вашими данными (прогресс чтения, часы, настроение, достижение целей).</p>' +
      '</div>';
  }
  function bindExportButton(){
    var btn = document.getElementById("mExportData");
    if(!btn) return;
    btn.addEventListener("click", function(){
      try{
        var data = buildExportData();
        var encoder = new TextEncoder();
        var jsonBytes = encoder.encode(JSON.stringify(data, null, 2));
        var readmeBytes = encoder.encode(
          "Экспорт личных данных из «Графика чтения Библии»\n" +
          "Файл data.json содержит все данные в структурированном виде:\n" +
          "- dailyReadingLog: по дням, какие главы Библии были прочитаны\n" +
          "- hourCounter.dailyHoursLog: по дням, сколько времени внесено (текущий период)\n" +
          "- hourCounter.closedMonthSegments: итоги уже закрытых месяцев (суммарно)\n" +
          "- hourCounter.dailyNotesLog: по дням, комментарии к дополнительному счётчику\n" +
          "- moodCounter.dailyMoodLog: по дням, какое настроение отмечалось\n" +
          "- goalCompletions.dailyLog: по дням, какие задачи личных целей были отмечены выполненными (название цели и текст задачи) — эти записи сохраняются, даже если сама цель потом была удалена или галочка снята\n" +
          "Этот файл можно отдать нейросети для анализа корреляций между чтением, отмеченным временем и настроением.\n"
        );
        var blob = buildZipBlob([
          {name:"data.json", content:jsonBytes},
          {name:"README.txt", content:readmeBytes}
        ]);
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "bible-tracker-export-" + isoDate(Date.now()) + ".zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      }catch(e){
        console.error("Ошибка экспорта:", e);
        alert("Не удалось собрать архив с данными. Попробуйте ещё раз.");
      }
    });
  }

  function renderModalHome(){
    stopCamera();
    if(!syncId){
      modalBox.innerHTML = modalHeader("Синхронизация между устройствами",
        "Читаете с нескольких устройств? Подключите их между собой, и прогресс будет совпадать на всех.") +
        '<button class="modal-btn primary" id="mCreate">Это первое устройство — создать код</button>' +
        '<button class="modal-btn" id="mJoin">У меня уже есть код с другого устройства</button>' +
        exportSectionHtml();
      bindClose();
      document.getElementById("mCreate").addEventListener("click", handleCreateCode);
      document.getElementById("mJoin").addEventListener("click", renderJoinScreen);
      bindExportButton();
    } else {
      modalBox.innerHTML = modalHeader("Устройство подключено",
        "Прогресс синхронизируется с другими вашими устройствами.") +
        '<div id="mOwnQrHolder"></div>' +
        '<div class="modal-note" id="mSyncNote" style="margin-bottom:12px;"></div>' +
        '<button class="modal-btn" id="mSyncNow">Синхронизировать сейчас</button>' +
        '<div class="modal-section">' +
          '<button class="modal-btn danger" id="mDisconnect">Отключить синхронизацию на этом устройстве</button>' +
          '<p class="modal-note">Это не удалит облачную копию — просто это устройство перестанет с ней сверяться.</p>' +
        '</div>' +
        exportSectionHtml();
      bindClose();
      loadQrLib().then(function(){
        showCodeAndQR("mOwnQrHolder", syncId, "Код для подключения ещё одного устройства:");
      }).catch(function(){
        document.getElementById("mOwnQrHolder").innerHTML = '<p class="modal-note error">Не удалось загрузить QR-код (нет интернета?).</p>';
      });
      document.getElementById("mSyncNow").addEventListener("click", function(){
        syncRetryCount = 0;
        clearTimeout(syncRetryTimer);
        doCloudSync();
        var note = document.getElementById("mSyncNote");
        if(note) note.textContent = "Синхронизация запущена…";
      });
      document.getElementById("mDisconnect").addEventListener("click", function(){
        if(!confirm("Отключить это устройство от синхронизации? Локальный прогресс сохранится.")) return;
        syncId = null;
        localStorage.removeItem(SYNC_ID_KEY);
        refreshStatusBase();
        renderModalHome();
      });
      bindExportButton();
    }
  }

  function showCodeAndQR(holderId, code, label){
    var holder = document.getElementById(holderId);
    if(!holder) return;
    holder.innerHTML = '<p class="modal-note">' + label + '</p><div id="qrHolder"></div>' +
      '<div class="code-row"><input type="text" id="codeText" readonly value="' + code + '"><button id="codeCopy">Копировать</button></div>';
    try{
      new QRCode(document.getElementById("qrHolder"), {text: code, width: 200, height: 200, colorDark: "#2e2418", colorLight: "#fbf4e2"});
    }catch(e){
      document.getElementById("qrHolder").textContent = "Не удалось построить QR-код.";
    }
    document.getElementById("codeCopy").addEventListener("click", function(){
      var input = document.getElementById("codeText");
      input.select(); input.setSelectionRange(0, 99999);
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(code).catch(function(){});
      }
      try{ document.execCommand("copy"); }catch(e){}
      var btn = document.getElementById("codeCopy");
      btn.textContent = "Скопировано";
      setTimeout(function(){ btn.textContent = "Копировать"; }, 1500);
    });
  }

  function handleCreateCode(){
    modalBox.innerHTML = modalHeader("Создаём код…", "Секунду, подключаемся к облачному хранилищу.");
    bindClose();
    if(!navigator.onLine){
      modalBox.innerHTML = modalHeader("Нет подключения к интернету", "Для создания кода синхронизации нужен интернет. Подключитесь и попробуйте снова.") + '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderModalHome);
      return;
    }
    createCloudBlob(state).then(function(id){
      syncId = id;
      localStorage.setItem(SYNC_ID_KEY, id);
      refreshStatusBase();
      modalBox.innerHTML = modalHeader("Код создан", "Отсканируйте этот QR-код на другом устройстве (в этой же панели, кнопка «У меня уже есть код») — или введите код текстом.") +
        '<div id="mNewQrHolder"></div><button class="modal-btn primary" id="mDone">Готово</button>';
      bindClose();
      loadQrLib().then(function(){
        showCodeAndQR("mNewQrHolder", id, "Код синхронизации:");
      }).catch(function(){
        document.getElementById("mNewQrHolder").innerHTML = '<p class="modal-note error">Не удалось загрузить QR-код.</p>';
      });
      document.getElementById("mDone").addEventListener("click", closeModal);
    }).catch(function(err){
      console.error(err);
      modalBox.innerHTML = modalHeader("Не удалось создать код",
        "Возможно, временно недоступен облачный сервис синхронизации. Попробуйте ещё раз чуть позже — локальный прогресс при этом никуда не делся.") +
        '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderModalHome);
    });
  }

  function renderJoinScreen(){
    modalBox.innerHTML = modalHeader("Подключение по коду", "Отсканируйте QR-код с первого устройства камерой или введите код вручную.") +
      '<button class="modal-btn primary" id="mScan">Сканировать QR-код</button>' +
      '<button class="modal-btn" id="mManual">Ввести код вручную</button>' +
      '<button class="modal-btn" id="mBack">Назад</button>';
    bindClose();
    document.getElementById("mScan").addEventListener("click", renderScanScreen);
    document.getElementById("mManual").addEventListener("click", renderManualScreen);
    document.getElementById("mBack").addEventListener("click", renderModalHome);
  }

  function renderManualScreen(){
    modalBox.innerHTML = modalHeader("Ввод кода вручную", "Введите код синхронизации с первого устройства.") +
      '<div class="code-row"><input type="text" id="manualCodeInput" placeholder="код синхронизации"></div>' +
      '<button class="modal-btn primary" id="mSubmit">Подключить</button>' +
      '<button class="modal-btn" id="mBack">Назад</button>' +
      '<div class="modal-note" id="mJoinNote"></div>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", renderJoinScreen);
    document.getElementById("mSubmit").addEventListener("click", function(){
      var val = document.getElementById("manualCodeInput").value.trim();
      if(val) joinWithCode(val);
    });
  }

  function renderScanScreen(){
    modalBox.innerHTML = modalHeader("Сканирование QR-кода", "Наведите камеру на QR-код с первого устройства.") +
      '<div class="scan-video-wrap"><video id="scanVideo" playsinline autoplay muted></video><div class="scan-frame"></div></div>' +
      '<canvas id="scanCanvas" style="display:none;"></canvas>' +
      '<button class="modal-btn" id="mManualFallback">Ввести код вручную вместо этого</button>' +
      '<button class="modal-btn" id="mBack">Назад</button>' +
      '<div class="modal-note" id="mScanNote"></div>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", function(){ stopCamera(); renderJoinScreen(); });
    document.getElementById("mManualFallback").addEventListener("click", function(){ stopCamera(); renderManualScreen(); });

    var video = document.getElementById("scanVideo");
    var canvas = document.getElementById("scanCanvas");
    var note = document.getElementById("mScanNote");

    loadJsqrLib().then(function(){
      if(typeof jsQR !== "function"){
        note.className = "modal-note error";
        note.textContent = "Не удалось загрузить модуль сканирования. Введите код вручную.";
        return;
      }
      navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
        .then(function(stream){
          activeStream = stream;
          video.srcObject = stream;
          video.play();
          scanRAF = requestAnimationFrame(tick);
        }).catch(function(err){
          console.error(err);
          note.className = "modal-note error";
          note.textContent = "Не удалось получить доступ к камере. Введите код вручную.";
        });

      function tick(){
        if(video.readyState === video.HAVE_ENOUGH_DATA){
          // уменьшаем разрешение для скорости
          var w = 320, h = 240;
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, w, h);
          var imageData = ctx.getImageData(0, 0, w, h);
          var result = jsQR(imageData.data, imageData.width, imageData.height, {inversionAttempts:"dontInvert"});
          if(result && result.data){
            stopCamera();
            note.className = "modal-note success";
            note.textContent = "Код распознан!";
            joinWithCode(result.data);
            return;
          }
        }
        scanRAF = requestAnimationFrame(tick);
      }
    }).catch(function(){
      note.className = "modal-note error";
      note.textContent = "Не удалось загрузить сканер (нет интернета?). Введите код вручную.";
    });
  }

  function joinWithCode(id){
    id = (id||"").trim();
    if(!id) return;
    modalBox.innerHTML = modalHeader("Подключаемся…", "Загружаем и объединяем прогресс.");
    bindClose();
    if(!navigator.onLine){
      modalBox.innerHTML = modalHeader("Нет подключения к интернету", "Для подключения нужен интернет. Подключитесь и попробуйте снова.") + '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderJoinScreen);
      return;
    }
    fetchCloudBlob(id).then(function(cloudData){
      var merged = mergeStates(state, cloudData || {});
      state = merged;
      syncId = id;
      localStorage.setItem(SYNC_ID_KEY, id);
      saveLocalState();
      setNoTransitions(true);
      rerenderAllFromState();
      setTimeout(function(){ setNoTransitions(false); }, 50);
      return putCloudBlob(id, merged);
    }).then(function(){
      refreshStatusBase();
      setSyncState("synced");
      modalBox.innerHTML = modalHeader("Готово!", "Устройство подключено, прогресс объединён.") + '<button class="modal-btn primary" id="mDone">Закрыть</button>';
      bindClose();
      document.getElementById("mDone").addEventListener("click", closeModal);
    }).catch(function(err){
      console.error(err);
      var msg = "Не удалось подключиться. Проверьте код и подключение к интернету.";
      if(String(err.message||"").indexOf("not_found") !== -1) msg = "Код не найден. Проверьте, что он введён без ошибок.";
      modalBox.innerHTML = modalHeader("Не получилось подключиться", msg) + '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderJoinScreen);
    });
  }

  // ===================== SERVICE WORKER И УВЕДОМЛЕНИЕ ОБ ОБНОВЛЕНИИ =====================
  var pendingUpdateVersion = null, pendingRegistration = null;

  function showUpdateBanner(version){
    try{ if(localStorage.getItem(UPDATES_DISABLED_KEY) === "1") return; }catch(e){}
    if(version && localStorage.getItem(UPDATE_DISMISSED_KEY) === version) return;
    pendingUpdateVersion = version || null;
    var wrap = document.getElementById("updateWrap");
    if(wrap) wrap.classList.add("visible");
  }
  function hideUpdateBanner(){
    var wrap = document.getElementById("updateWrap");
    if(wrap) wrap.classList.remove("visible");
  }
  // если после нажатия "Не сейчас" прошли сутки — прячем баннер и больше
  // не напоминаем про эту конкретную версию (до выхода следующей)
  function checkUpdateSnoozeExpiry(){
    var raw;
    try{ raw = localStorage.getItem(UPDATE_SNOOZE_KEY); }catch(e){ return; }
    if(!raw) return;
    var rec;
    try{ rec = JSON.parse(raw); }catch(e){ return; }
    if(rec && rec.version && Date.now() >= rec.until){
      try{ localStorage.setItem(UPDATE_DISMISSED_KEY, rec.version); }catch(e){}
      try{ localStorage.removeItem(UPDATE_SNOOZE_KEY); }catch(e){}
      hideUpdateBanner();
    }
  }
  function openUpdateModal(){
    var overlay = document.getElementById("modalOverlay"), box = document.getElementById("modalBox");
    if(!overlay || !box) return;
    function closeThis(){ overlay.classList.remove("open"); box.innerHTML = ""; }
    box.innerHTML = modalHeader("Доступна новая версия", "Скачать новую версию этой страницы? Ваш прогресс чтения сохранится.") +
      '<button class="modal-btn primary" id="mUpdYes">Да, обновить</button>' +
      '<button class="modal-btn" id="mUpdNo">Не сейчас</button>' +
      '<button class="modal-btn" id="mUpdNever">Больше не показывать это уведомление</button>';
    var closeBtn = document.getElementById("mClose");
    if(closeBtn) closeBtn.addEventListener("click", closeThis);
    overlay.classList.add("open");
    document.getElementById("mUpdYes").addEventListener("click", function(){
      if(pendingRegistration && pendingRegistration.waiting){
        pendingRegistration.waiting.postMessage("SKIP_WAITING");
      } else { window.location.reload(); }
      closeThis();
    });
    document.getElementById("mUpdNo").addEventListener("click", function(){
      if(pendingUpdateVersion){
        try{
          localStorage.setItem(UPDATE_SNOOZE_KEY, JSON.stringify({
            version: pendingUpdateVersion,
            until: Date.now() + SNOOZE_DURATION_MS
          }));
        }catch(e){}
      }
      // баннер намеренно НЕ скрываем — по договорённости он остаётся
      // виден ещё сутки, а затем прячется сам (см. checkUpdateSnoozeExpiry)
      closeThis();
    });
    document.getElementById("mUpdNever").addEventListener("click", function(){
      try{ localStorage.setItem(UPDATES_DISABLED_KEY, "1"); }catch(e){}
      hideUpdateBanner(); closeThis();
    });
  }

  var updateBar = document.getElementById("updateBar");
  if(updateBar) updateBar.addEventListener("click", openUpdateModal);

  // строка "обновить сейчас" в подвале — работает независимо от того,
  // отключены ли всплывающие уведомления (см. UPDATES_DISABLED_KEY):
  // человек всегда может проверить и обновиться вручную здесь
  function renderManualUpdateOption(){
    var row = document.getElementById("versionUpdateRow");
    if(!row) return;
    if(pendingRegistration && pendingRegistration.waiting){
      var label = pendingUpdateVersion ? ("Обновить до v" + pendingUpdateVersion) : "Доступно обновление — обновить";
      row.innerHTML = '<button class="version-history-update-item" id="versionUpdateBtn">' + label + '</button>';
      var btn = document.getElementById("versionUpdateBtn");
      if(btn){
        btn.addEventListener("click", function(){
          if(pendingRegistration && pendingRegistration.waiting){
            pendingRegistration.waiting.postMessage("SKIP_WAITING");
          } else {
            window.location.reload();
          }
        });
      }
    } else {
      row.innerHTML = "";
    }
  }

  // версия в подвале подтягивается напрямую из sw.js через служебный
  // запрос по MessageChannel — значит, менять её нужно только в одном
  // месте (APP_VERSION в sw.js), а не отдельно ещё и в разметке
  function applyVersionToFooter(version){
    if(!version) return;
    var el = document.getElementById("appVersionText");
    if(el) el.textContent = "v" + String(version).replace(/^v/i, "");
  }

  function requestVersionFromSW(){
    if(!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    try{
      var channel = new MessageChannel();
      channel.port1.onmessage = function(event){
        if(event.data && event.data.type === "VERSION"){
          applyVersionToFooter(event.data.version);
        }
      };
      navigator.serviceWorker.controller.postMessage({type:"GET_VERSION"}, [channel.port2]);
    }catch(e){}
  }

  if("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")){
    navigator.serviceWorker.addEventListener("message", function(event){
      if(event.data && event.data.type === "SW_VERSION") pendingUpdateVersion = event.data.version;
    });
    var reloadedAfterUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", function(){
      requestVersionFromSW();
      if(reloadedAfterUpdate) return;
      reloadedAfterUpdate = true;
      window.location.reload();
    });
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").then(function(reg){
        pendingRegistration = reg;
        requestVersionFromSW();
        if(reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(pendingUpdateVersion);
        renderManualUpdateOption();
        reg.addEventListener("updatefound", function(){
          var newWorker = reg.installing;
          if(!newWorker) return;
          newWorker.addEventListener("statechange", function(){
            if(newWorker.state === "installed" && navigator.serviceWorker.controller){
              showUpdateBanner(pendingUpdateVersion);
              renderManualUpdateOption();
            }
          });
        });
      }).catch(function(err){ console.error("Не удалось зарегистрировать service worker:", err); });
    });
  }

  // ===================== АРХИВ ПРЕДЫДУЩИХ ВЕРСИЙ =====================
  // Список берётся автоматически из ./versions/versions.json — этот файл
  // ведёт GitHub Action при публикации релиза (тега) в репозитории, вручную
  // ничего копировать и редактировать в коде больше не нужно.
  function renderVersionHistory(){
    var itemsHolder = document.getElementById("versionHistoryItems");
    if(!itemsHolder) return;
    fetch("./versions/versions.json")
      .then(function(res){
        if(!res.ok) throw new Error("no versions.json");
        return res.json();
      })
      .then(function(data){
        var items = (data && data.versions) ? data.versions.slice(0, 5) : [];
        renderVersionItems(items);
      })
      .catch(function(){
        renderVersionItems([]);
      });
  }

  function renderVersionItems(items){
    var itemsHolder = document.getElementById("versionHistoryItems");
    if(!itemsHolder) return;
    itemsHolder.innerHTML = "";
    if(!items.length){
      var empty = document.createElement("div");
      empty.className = "version-history-empty";
      empty.textContent = "Архив версий пока пуст";
      itemsHolder.appendChild(empty);
      return;
    }
    items.forEach(function(item){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "version-history-item";
      btn.textContent = "v" + item.version + (item.date ? " — " + item.date : "");
      var url = "./versions/v" + item.version + "/index.html";
      btn.addEventListener("click", function(){
        selectedVersionUrl = url;
        Array.prototype.forEach.call(itemsHolder.querySelectorAll(".version-history-item"), function(b){
          b.classList.remove("selected");
        });
        btn.classList.add("selected");
        var returnBtn = document.getElementById("mVersionReturnBtn");
        if(returnBtn) returnBtn.style.display = "block";
      });
      itemsHolder.appendChild(btn);
    });
  }

  var selectedVersionUrl = null;

  // содержимое "Версий" открывается кнопкой из вкладки настроек (шестерёнка,
  // см. renderSettingsTabGear), а не отдельным язычком — рисуется прямо в
  // #settingsTabContent, как и у остальных вкладок
  function renderSettingsTabVersions(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    selectedVersionUrl = null;
    container.innerHTML =
      '<button class="modal-btn" id="mVersionBackBtn" style="margin-bottom:14px;">&larr; Назад к настройкам</button>' +
      '<div class="year-grid-tab-title" style="margin-bottom:12px;">Версии</div>' +
      '<div id="versionUpdateRow"></div>' +
      '<div id="versionHistoryItems"></div>' +
      '<button class="modal-btn primary" id="mVersionReturnBtn" style="display:none;margin-top:12px;">Вернуться на выбранную версию</button>';
    renderManualUpdateOption();
    renderVersionHistory();
    var backBtn = document.getElementById("mVersionBackBtn");
    if(backBtn) backBtn.addEventListener("click", function(){ switchSettingsTab("gear"); });
    var returnBtn = document.getElementById("mVersionReturnBtn");
    if(returnBtn){
      returnBtn.addEventListener("click", function(){
        if(selectedVersionUrl) window.location.href = selectedVersionUrl;
      });
    }
  }

  // общий обработчик для всех 9 вкладок задач (red/inbox/next/projects/
  // waiting/council/read/someday/archive)
  function renderSettingsTabTask(taskKey){
    if(taskKey === "archive") renderTaskArchiveTab();
    else renderTaskTabList(taskKey);
  }

  // ---------- модалка настроек (шестерёнка) с вкладками ----------
  var settingsModalOverlay = document.getElementById("settingsModalOverlay");
  var settingsModalBox = document.getElementById("settingsModalBox");
  var settingsModalFrame = settingsModalBox ? settingsModalBox.parentElement : null; // .settings-modal-frame

  // ===== Волна открытия/закрытия окна настроек (доп. анимации) =====
  // Разворачивается ТОЛЬКО рамка окна (.settings-modal-frame — она же
  // содержит и сам блок настроек, и вертикальный стек вкладок, и
  // горизонтальный ряд, см. index.html), а не весь экран. Тёмная
  // подложка (.settings-modal-overlay) в волне не участвует —
  // она просто плавно проявляется через opacity за то же время
  // (см. animateSettingsWave), отдельно от геометрии волны.
  //
  // Клип применяется к рамке в её СОБСТВЕННЫХ координатах (0%..100% —
  // это ширина/высота самой рамки, а не экрана), поэтому никакой
  // хитрости с пересчётом точки старта не нужно: кнопка-язычок стоит
  // буквально впритык к правому нижнему углу рамки (см.
  // layoutSettingsModal — settingsGearBtn.style.left/top берутся из
  // frameRect.right/bottom), то есть угол (100%,100%) рамки — это и
  // есть точка кнопки.
  var settingsWaveRAF = null;
  var SETTINGS_WAVE_DURATION = 400; // мс, см. обсуждение с пользователем

  // t: 0 (совсем свёрнуто, в точку у кнопки) .. 1 (рамка развёрнута
  // полностью). Первая половина (t<=0.5) — растущий треугольник от
  // угла (100%,100%) до половины рамки (по главной диагонали). Вторая
  // половина (t>0.5) — тот же треугольник дотягивается до
  // противоположного угла (0,0), пятиугольником, пока не закроет всю
  // рамку целиком. Число вершин специально разное в двух половинах —
  // поэтому считается через JS/rAF, а не через CSS-transition (тот не
  // умеет плавно менять число точек полигона).
  function settingsWavePolygonAt(t){
    if(t <= 0) return "polygon(100% 100%, 100% 100%, 100% 100%)";
    if(t >= 1) return "none";
    if(t <= 0.5){
      var s = t * 2; // 0..1
      var by = 100 - 100 * s;
      var cx = 100 - 100 * s;
      return "polygon(100% 100%, 100% " + by + "%, " + cx + "% 100%)";
    }
    var q = (t - 0.5) * 2; // 0..1
    var topX = 100 - 100 * q;
    var leftY = 100 - 100 * q;
    return "polygon(100% 100%, 100% 0%, " + topX + "% 0%, 0% " + leftY + "%, 0% 100%)";
  }

  function setSettingsWaveClip(t){
    if(!settingsModalFrame) return;
    var poly = settingsWavePolygonAt(t);
    settingsModalFrame.style.clipPath = poly;
    settingsModalFrame.style.webkitClipPath = poly;
  }

  // opening=true — волна открытия: рамка разворачивается t=0->1, а
  // тёмная подложка одновременно проявляется opacity 0->1. opening=
  // false — обратная волна: рамка схлопывается t=1->0 (честно до
  // полного нуля, чтобы гарантированно стянуться в точку у кнопки и
  // исчезнуть), подложка одновременно гаснет opacity 1->0.
  function animateSettingsWave(opening, onDone){
    if(settingsWaveRAF){ cancelAnimationFrame(settingsWaveRAF); settingsWaveRAF = null; }
    var start = null;
    function frame(now){
      if(start === null) start = now;
      var p = Math.min(1, (now - start) / SETTINGS_WAVE_DURATION);
      var t = opening ? p : (1 - p);
      setSettingsWaveClip(t);
      settingsModalOverlay.style.opacity = String(t);
      if(p < 1){
        settingsWaveRAF = requestAnimationFrame(frame);
      } else {
        settingsWaveRAF = null;
        if(onDone) onDone();
      }
    }
    settingsWaveRAF = requestAnimationFrame(frame);
  }

  function openSettingsModal(){
    refreshSettingsTabsVisibility();
    settingsModalBox.style.height = "";
    settingsModalBox.style.marginTop = "";
    var gearBtn = document.getElementById("settingsGearBtn");
    if(gearBtn) gearBtn.classList.add("is-open");
    switchSettingsTab(getShowAllTasksEnabled() ? "red" : "gear");
    requestAnimationFrame(layoutSettingsModal);
    if(getExtraAnimationsEnabled()){
      setSettingsWaveClip(0);
      settingsModalOverlay.style.opacity = "0";
      settingsModalOverlay.classList.add("open");
      animateSettingsWave(true);
    } else {
      if(settingsModalFrame){
        settingsModalFrame.style.clipPath = "";
        settingsModalFrame.style.webkitClipPath = "";
      }
      settingsModalOverlay.style.opacity = "";
      settingsModalOverlay.classList.add("open");
    }
  }
  // Плавающая кнопка-язычок (.settings-fab, id=settingsGearBtn) стоит на
  // ФИКСИРОВАННОЙ высоте — 25% экрана от его нижнего края (fabTop = 75%
  // высоты окна браузера). Окно настроек привязано к НЕЙ, а не к верху
  // экрана: нижний край окна всегда на fabTop, а высота отсчитывается от
  // кнопки вверх фиксированным числом пикселей (см. WINDOW_H ниже) — то
  // есть меняется положение верхнего края окна (через margin-top), а не
  // сама точка, где сидит кнопка. Кнопка при этом по-прежнему "приклеена"
  // к правому нижнему углу рамки (.settings-modal-frame) по горизонтали —
  // это не менялось. Работает и когда модалка закрыта: оверлей больше не
  // display:none (см. .settings-modal-overlay в modals.css), а скрыт
  // через opacity/visibility — рамка при этом всё равно реально
  // отрисована и её координаты можно измерить через getBoundingClientRect.
  // Вызывается при открытии окна, при загрузке страницы и при ресайзе
  // (см. вызовы ниже), чтобы кнопка всегда стояла в нужном месте, даже
  // если окно ни разу не открывали.
  function layoutSettingsModal(){
    if(!settingsModalBox) return;
    var frame = settingsModalBox.parentElement;
    if(!frame) return;

    // Вкладка "настройки" должна быть хоть раз отрисована — на случай,
    // если окно ещё ни разу не открывали (иначе #settingsTabContent
    // пустой, но на итоговую высоту это больше не влияет).
    var content = document.getElementById("settingsTabContent");
    if(content && !content.innerHTML.trim()) renderSettingsTabGear();

    // Окно "пришито" снизу к кнопке-язычку (.settings-fab), а не сверху к
    // экрану: нижний край окна всегда стоит на фиксированной точке —
    // 25% экрана от его нижнего края (fabTop = 75% высоты окна браузера),
    // а высота отсчитывается от НЕЁ вверх — фиксированные 650px (WINDOW_H
    // ниже), а не вниз от верхнего края экрана. Поэтому у окна больше нет
    // "родного" верха: он вычисляется как fabTop − высота и выставляется
    // через margin-top (естественное положение по CSS — 16px от верха
    // оверлея, см. padding-top). Если 650px не помещается (см. minTop —
    // не даём окну вылезти выше 16px от верха экрана), высота ужимается,
    // но низ окна (а с ним и кнопка) всё равно остаётся ровно на fabTop —
    // окно никогда не отрывается от кнопки, просто может быть короче
    // 650px на маленьких экранах.
    settingsModalBox.style.height = "";
    settingsModalBox.style.marginTop = "";
    var naturalTop = settingsModalBox.getBoundingClientRect().top; // 16px по CSS
    var fabTop = window.innerHeight * 0.75;
    var WINDOW_H = 650; // высота окна настроек, отсчитанная от кнопки вверх
    var minTop = naturalTop; // не даём окну вылезти выше верхнего края оверлея
    var desiredTop = fabTop - WINDOW_H;
    if(desiredTop < minTop) desiredTop = minTop;
    var desired = fabTop - desiredTop;

    settingsModalBox.style.marginTop = (desiredTop - naturalTop) + "px";
    settingsModalBox.style.height = desired + "px";
    // Размер (толщина) каждого язычка вертикального стека — единая
    // переменная --settings-tab-size на .settings-modal-frame (её читают
    // #settingsTabs .settings-tab). Считаем её здесь: высота окна настроек
    // (desired, только что зафиксирована выше), минус промежутки между 9
    // язычками стопки (9 вкладок задач: red/inbox/next/projects/waiting/
    // council/read/someday/archive — считаем все 9, а не только сейчас
    // видимые), по 1px gap между соседними — это 8 промежутков, — и делим
    // остаток на 9. Так каждый язычок получает фиксированный размер,
    // который не меняется от того, сколько из 9 сейчас реально показано.
    var totalTabs = 9;
    var gapsPx = (totalTabs - 1) * 1;
    var tabUnit = (desired - gapsPx) / totalTabs;
    if(tabUnit > 0) frame.style.setProperty("--settings-tab-size", tabUnit + "px");

    // Ширина вкладок горизонтального ряда под окном (шестерёнка + карта
    // дней года + 3 заглушки, см. .settings-tabs-gear в modals.css) —
    // отдельная переменная --settings-tab-size-h, т.к. этот ряд зависит от
    // ШИРИНЫ окна настроек, а не от высоты. Сейчас в ряд помещается ровно
    // 5 вкладок, поэтому делим ширину окна на 5 (и 4 промежутка по 1px
    // между ними, как и в вертикальном стеке).
    var totalHTabs = 5;
    var gapsHPx = (totalHTabs - 1) * 1;
    var boxWidth = settingsModalBox.getBoundingClientRect().width;
    // Резервируем ещё 1px в конце ряда — там, где ряд стыкуется с
    // кнопкой-язычком, чтобы получившийся зазор оказался ровно под
    // вертикальным лавандовым швом (правым краем окна), а не правее него.
    var tabHUnit = (boxWidth - gapsHPx - 1) / totalHTabs;
    if(tabHUnit > 0) frame.style.setProperty("--settings-tab-size-h", tabHUnit + "px");

    // Кнопка-язычок теперь полноразмерная: её толщина (width) — те же
    // 62px, что и у обычных вертикальных язычков, а длина (height) — то
    // же значение --settings-tab-size-h, что и у язычков нижнего ряда
    // (tabHUnit, посчитан только что выше). Стоит вплотную к углу рамки
    // (без зазора) — сам зазор уже учтён в ширине ряда выше.
    var settingsGearBtn = document.getElementById("settingsGearBtn");
    if(settingsGearBtn){
      var frameRect = frame.getBoundingClientRect();
      settingsGearBtn.style.left = Math.round(frameRect.right) + "px";
      settingsGearBtn.style.top = Math.round(frameRect.bottom) + "px";
      if(tabHUnit > 0) settingsGearBtn.style.height = Math.round(tabHUnit) + "px";
    }
  }
  function closeSettingsModal(){
    flushPendingYearDayNoteEdit();
    flushPendingTaskEdits();
    var gearBtn = document.getElementById("settingsGearBtn");
    if(gearBtn) gearBtn.classList.remove("is-open");
    if(getExtraAnimationsEnabled()){
      animateSettingsWave(false, function(){
        settingsModalOverlay.classList.remove("open");
        settingsModalOverlay.style.opacity = "";
        if(settingsModalFrame){
          settingsModalFrame.style.clipPath = "";
          settingsModalFrame.style.webkitClipPath = "";
        }
      });
    } else {
      settingsModalOverlay.classList.remove("open");
      settingsModalOverlay.style.opacity = "";
      if(settingsModalFrame){
        settingsModalFrame.style.clipPath = "";
        settingsModalFrame.style.webkitClipPath = "";
      }
    }
  }
  function refreshSettingsTabsVisibility(){
    var showTasks = getShowAllTasksEnabled();
    Object.keys(TASK_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(TASK_TAB_IDS[key]);
      if(btn) btn.style.display = showTasks ? "flex" : "none";
    });
  }
  // Окно настроек всегда одного размера (см. .settings-modal-box в
  // modals.css) — высота фиксирована и не зависит от вкладки, поэтому
  // верхний край окна не "прыгает" при переключении вкладок. Если
  // содержимое вкладки не помещается, прокручивается #settingsTabContent
  // (без видимого индикатора прокрутки, см. CSS).
  function switchSettingsTab(tab){
    flushPendingYearDayNoteEdit();
    flushPendingTaskEdits();
    var gearBtn = document.getElementById("settingsTabGearBtn");
    var yearBtn = document.getElementById("settingsTabYearBtn");
    var moodTabBtn = document.getElementById("settingsTabMoodBtn");
    if(gearBtn) gearBtn.classList.toggle("active", tab === "gear");
    if(yearBtn) yearBtn.classList.toggle("active", tab === "year");
    if(moodTabBtn) moodTabBtn.classList.toggle("active", tab === "mood");
    Object.keys(TASK_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(TASK_TAB_IDS[key]);
      if(btn) btn.classList.toggle("active", tab === key);
    });
    Object.keys(EXTRA_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(EXTRA_TAB_IDS[key]);
      if(btn) btn.classList.toggle("active", tab === key);
    });
    var container = document.getElementById("settingsTabContent");
    if(container) container.scrollTop = 0;
    var addFab = document.getElementById("taskAddFab");
    if(addFab) addFab.classList.toggle("visible", TASK_MOVABLE_TABS.indexOf(tab) !== -1);
    if(tab === "mood") renderSettingsTabMood();
    else if(tab === "year") renderSettingsTabYear();
    else if(tab === "versions") renderSettingsTabVersions();
    else if(TASK_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabTask(tab);
    else if(EXTRA_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabExtra();
    else renderSettingsTabGear();
  }

  // Заглушка для 2 вкладок рядом со вкладкой настроек — содержимое ещё
  // не определено.
  function renderSettingsTabExtra(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML = '<div class="mood-diagram-empty">Контент появится позже</div>';
  }

  function renderSettingsTabGear(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var hourOn = !!getHourGoal();
    var hourNotesOn = isHourNotesEnabled();
    var moodOn = isMoodEnabled();
    var reducedOn = getGoalsReducedView();
    var colorMarkOn = getColorMarkEnabled();
    var showAllTasksOn = getShowAllTasksEnabled();
    var extraAnimOn = getExtraAnimationsEnabled();
    container.innerHTML =
      '<div class="settings-row"><span>Добавить дополнительный счётчик</span><input type="checkbox" id="settingsHourCb"' + (hourOn ? " checked" : "") + '></div>' +
      '<div class="settings-row" id="settingsHourNotesRow" style="' + (hourOn ? "" : "display:none;") + '"><span>Добавить комментарий в дополнительный счётчик</span><input type="checkbox" id="settingsHourNotesCb"' + (hourNotesOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Добавить счётчик настроения</span><input type="checkbox" id="settingsMoodCb"' + (moodOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Видеть меньше прогресс-баров</span><input type="checkbox" id="settingsReducedCb"' + (reducedOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Отмечать прочитанные главы другим цветом</span><input type="checkbox" id="settingsColorMarkCb"' + (colorMarkOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Показать все мои задачи</span><input type="checkbox" id="settingsShowAllTasksCb"' + (showAllTasksOn ? " checked" : "") + '></div>' +
      '<div class="settings-row" style="border-bottom:none;"><span>Включить дополнительные анимации</span><input type="checkbox" id="settingsExtraAnimCb"' + (extraAnimOn ? " checked" : "") + '></div>' +
      (showAllTasksOn ? '<button class="modal-btn" id="settingsImportTasksBtn" style="margin-top:16px;">Восстановить задачи из .txt</button>' : '') +
      '<button class="modal-btn" id="settingsAddGoalBtn" style="margin-top:' + (showAllTasksOn ? "10px" : "16px") + ';">Добавить для себя цель</button>' +
      '<button class="modal-btn" id="settingsVersionsBtn" style="margin-top:10px;">Версии</button>' +
      '<button class="modal-btn danger" id="settingsResetBtn" style="margin-top:10px;">Начать чтение сначала и сбросить прогресс</button>';

    document.getElementById("settingsHourCb").addEventListener("change", function(){
      var cb = this;
      if(cb.checked){
        closeSettingsModal();
        openHourGoalModal();
      } else {
        cb.checked = true; // визуально отменяем, пока не подтвердят
        closeSettingsModal();
        modalBox.innerHTML =
          modalHeader("Весь прогресс будет потерян. Уверены?") +
          '<button class="modal-btn primary" id="mSHourYes">Да</button>' +
          '<button class="modal-btn" id="mSHourNo">Нет</button>';
        bindClose();
        modalOverlay.classList.add("open");
        document.getElementById("mSHourYes").addEventListener("click", function(){
          deactivateHourCounter();
          closeModal();
          openSettingsModal();
        });
        document.getElementById("mSHourNo").addEventListener("click", function(){
          closeModal();
          openSettingsModal();
        });
      }
    });

    var settingsHourNotesCb = document.getElementById("settingsHourNotesCb");
    if(settingsHourNotesCb){
      settingsHourNotesCb.addEventListener("change", function(){
        setHourNotesEnabled(this.checked);
      });
    }

    document.getElementById("settingsMoodCb").addEventListener("change", function(){
      var cb = this;
      if(cb.checked){
        closeSettingsModal();
        openMoodEmojiPicker(false);
      } else {
        deactivateMoodCounter();
        refreshSettingsTabsVisibility();
        renderSettingsTabGear();
      }
    });

    document.getElementById("settingsReducedCb").addEventListener("change", function(){
      setGoalsReducedView(this.checked);
      goalsExpanded = true;
      try{ localStorage.setItem(GOALS_EXPANDED_KEY, "1"); }catch(e){}
      renderGoalsSection();
    });

    document.getElementById("settingsColorMarkCb").addEventListener("change", function(){
      setColorMarkEnabled(this.checked);
      refreshAllChapterColorVisuals();
    });

    document.getElementById("settingsShowAllTasksCb").addEventListener("change", function(){
      setShowAllTasksEnabled(this.checked);
      refreshSettingsTabsVisibility();
    });

    document.getElementById("settingsExtraAnimCb").addEventListener("change", function(){
      setExtraAnimationsEnabled(this.checked);
    });

    document.getElementById("settingsAddGoalBtn").addEventListener("click", function(){
      var id = createNewGoal();
      renderGoalsSection();
      closeSettingsModal();
      openGoalSettingsModal(id);
    });

    var importTasksBtn = document.getElementById("settingsImportTasksBtn");
    if(importTasksBtn){
      importTasksBtn.addEventListener("click", function(){
        closeSettingsModal();
        openTaskImportTabPicker();
      });
    }

    document.getElementById("settingsVersionsBtn").addEventListener("click", function(){
      switchSettingsTab("versions");
    });

    document.getElementById("settingsResetBtn").addEventListener("click", function(){
      if(!confirm("Точно сбросить весь прогресс чтения и начать сначала?")) return;
      performFullReset();
      closeSettingsModal();
    });
  }

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

    var firstLogRec = state[MOOD_FIRST_LOG_KEY];
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
      closeSettingsModal();
      openMoodResetConfirm();
    });
  }

  var settingsTabGearBtn = document.getElementById("settingsTabGearBtn");
  var settingsTabYearBtn = document.getElementById("settingsTabYearBtn");
  var settingsTabMoodBtn = document.getElementById("settingsTabMoodBtn");
  if(settingsTabGearBtn) settingsTabGearBtn.addEventListener("click", function(){ switchSettingsTab("gear"); });
  if(settingsTabYearBtn) settingsTabYearBtn.addEventListener("click", function(){ switchSettingsTab("year"); });
  if(settingsTabMoodBtn) settingsTabMoodBtn.addEventListener("click", function(){ switchSettingsTab("mood"); });
  Object.keys(TASK_TAB_IDS).forEach(function(key){
    var btn = document.getElementById(TASK_TAB_IDS[key]);
    if(btn) btn.addEventListener("click", function(){ switchSettingsTab(key); });
  });
  Object.keys(EXTRA_TAB_IDS).forEach(function(key){
    var btn = document.getElementById(EXTRA_TAB_IDS[key]);
    if(btn) btn.addEventListener("click", function(){ switchSettingsTab(key); });
  });

  if(settingsModalOverlay){
    settingsModalOverlay.addEventListener("click", function(e){
      if(e.target === settingsModalOverlay) closeSettingsModal();
    });
  }

  var settingsGearBtn = document.getElementById("settingsGearBtn");
  if(settingsGearBtn) settingsGearBtn.addEventListener("click", function(){
    if(settingsModalOverlay && settingsModalOverlay.classList.contains("open")){
      closeSettingsModal();
    } else {
      openSettingsModal();
    }
  });

  // Ставим язычок-кнопку в угол окна настроек сразу при загрузке страницы
  // (а не только при первом открытии окна) и держим его там при ресайзе/
  // повороте экрана — см. layoutSettingsModal выше.
  layoutSettingsModal();
  var settingsLayoutResizeTimer = null;
  window.addEventListener("resize", function(){
    clearTimeout(settingsLayoutResizeTimer);
    settingsLayoutResizeTimer = setTimeout(layoutSettingsModal, 120);
  });

  // ===================== ДОПОЛНИТЕЛЬНЫЙ СЧЁТЧИК ЧАСОВ =====================
  // Данные хранятся в том же общем state (синхронизируются по той же схеме
  // {c,t} "побеждает более позднее время"). Каждая внесённая запись времени
  // и каждый закрытый период (для режима "50") — это отдельный уникальный
  // ключ вида "hourlog:..." / "hoursegment:...", поэтому при слиянии между
  // устройствами записи просто объединяются — новой логики слияния не нужно.
  var HOUR_GOAL_KEY = "__hourGoal";
  var HOUR_MONTHS_KEY = "__hourMonthsToSeptember";
  var HOUR_REAL_MONTHS_KEY = "__hourRealMonthsAtActivation";
  var HOUR_MONTH_PERIOD_KEY = "__hourMonthPeriodStart";
  var HOUR_YEAR_PERIOD_KEY = "__hourYearPeriodStart";
  var HOUR_MONTH_DEFERRED_KEY = "__hourMonthDeferred";
  var HOUR_YEAR_DEFERRED_KEY = "__hourYearDeferred";
  var HOUR_NOTES_ENABLED_KEY = "__hourNotesEnabled";
  var HOUR_SEGMENT_LABEL_MIN = 10; // сегмент/остаток меньше 10 часов — число не показываем

  function getHourGoal(){ var r = state[HOUR_GOAL_KEY]; return (r && r.c) ? r.c : null; }
  function isHourNotesEnabled(){ var r = state[HOUR_NOTES_ENABLED_KEY]; return !!(r && r.c); }
  function setHourNotesEnabled(value){
    state[HOUR_NOTES_ENABLED_KEY] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  // ---- заметки дополнительного счётчика ("hournote:<началоДня>") ----
  // Один ключ на день — значение полностью перезаписывается при
  // редактировании (в т.ч. между устройствами: слияние — по последнему t,
  // как и везде). Не пропалываются функцией pruneOldHourLogsForStats:
  // в отличие от "сырых" hourlog:, заметки должны храниться и
  // редактироваться сколь угодно давние ("Карта дней года").
  function hourNoteKeyForDay(dayTs){ return "hournote:" + dayTs; }
  function getHourNoteForDay(dayTs){
    var rec = state[hourNoteKeyForDay(dayTs)];
    return (rec && typeof rec.c === "string" && rec.c) ? rec.c : "";
  }
  function setHourNoteForDay(dayTs, text, skipGridRefresh){
    var trimmed = (text || "").trim();
    state[hourNoteKeyForDay(dayTs)] = {c: trimmed ? trimmed : null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    // при сохранении прямо из карточки дня (см. renderYearDayNoteEdit) сброс
    // к общей сетке не нужен — пользователь должен оставаться на этом же
    // экране дня; поэтому вызывающий код передаёт skipGridRefresh=true
    if(!skipGridRefresh) refreshYearGridIfOpen();
  }
  function getHourNotesByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hournote:") !== 0) return;
      var rec = state[k];
      if(!rec || typeof rec.c !== "string" || !rec.c) return;
      var day = Number(k.slice("hournote:".length));
      byDay[day] = rec.c;
    });
    return byDay;
  }
  function getMonthsToSeptember(){ var r = state[HOUR_MONTHS_KEY]; return (r && r.c) ? r.c : null; }
  function getRealMonthsAtActivation(){ var r = state[HOUR_REAL_MONTHS_KEY]; return (r && r.c) ? r.c : null; }
  function getMonthPeriodStart(){ var r = state[HOUR_MONTH_PERIOD_KEY]; return (r && r.c) ? r.c : null; }
  function getYearPeriodStart(){ var r = state[HOUR_YEAR_PERIOD_KEY]; return (r && r.c) ? r.c : null; }

  function formatHHMM(totalMinutes){
    totalMinutes = Math.max(0, Math.round(totalMinutes));
    var h = Math.floor(totalMinutes/60), m = totalMinutes % 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }
  // принимает "1.40", "01.40", "01,40", "1:50" и т.п. — разделитель не важен
  function parseHourInput(raw){
    raw = (raw || "").trim();
    var m = raw.match(/^(\d{1,3})[.,:](\d{1,2})$/);
    if(!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if(isNaN(h) || isNaN(mi) || mi > 59) return null;
    return h * 60 + mi;
  }

  function sumHourLogsSince(sinceTs){
    if(!sinceTs) return 0;
    var total = 0;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && typeof state[k].c === "number" && state[k].t >= sinceTs){
        total += state[k].c;
      }
    });
    return total;
  }
  function addHourLogEntry(minutes){
    var id = "hourlog:" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
    state[id] = {c: minutes, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshYearGridIfOpen();
  }
  function recordMonthSegment(periodStart, totalMinutes){
    state["hoursegment:" + periodStart] = {c: totalMinutes, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function getClosedMonthSegments(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hoursegment:") === 0 && state[k] && typeof state[k].c === "number"){
        list.push({periodStart: Number(k.slice("hoursegment:".length)), minutes: state[k].c});
      }
    });
    list.sort(function(a,b){ return a.periodStart - b.periodStart; });
    return list;
  }
  function sumYearMinutes(){
    var yearStart = getYearPeriodStart();
    if(!yearStart) return 0;
    var total = getClosedMonthSegments()
      .filter(function(s){ return s.periodStart >= yearStart; })
      .reduce(function(a,s){ return a + s.minutes; }, 0);
    total += sumHourLogsSince(getMonthPeriodStart());
    return total;
  }

  function isNewCalendarMonth(sinceTs){
    var since = new Date(sinceTs), now = new Date();
    return (now.getFullYear() > since.getFullYear()) ||
      (now.getFullYear() === since.getFullYear() && now.getMonth() > since.getMonth());
  }
  function computeNextSeptemberFirst(fromTs){
    var d = new Date(fromTs);
    var septThisYear = new Date(d.getFullYear(), 8, 1).getTime();
    return (d.getTime() < septThisYear) ? septThisYear : new Date(d.getFullYear()+1, 8, 1).getTime();
  }
  // сколько реальных календарных месяцев осталось до ближайшего 1 сентября
  // (текущий месяц считается за 1 целиком, независимо от числа)
  function computeRealMonthsRemaining(fromTs){
    var target = computeNextSeptemberFirst(fromTs);
    var d = new Date(fromTs), t = new Date(target);
    var months = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
    return Math.max(1, months);
  }

  // --- "наверстывание": сколько периодов выбрано сверх реально оставшихся ---
  function getClosedSegmentsCountThisYear(){
    var yearStart = getYearPeriodStart();
    if(!yearStart) return 0;
    return getClosedMonthSegments().filter(function(s){ return s.periodStart >= yearStart; }).length;
  }
  function getOverdueCatchUpCount(){
    var chosen = getMonthsToSeptember(), real = getRealMonthsAtActivation();
    if(!chosen || !real) return 0;
    return Math.max(0, chosen - real);
  }
  function isInCatchUpMode(){
    return getHourGoal() === 50 && getClosedSegmentsCountThisYear() < getOverdueCatchUpCount();
  }

  function setHourState(key, value){ state[key] = {c: value, t: Date.now()}; }

  function activateHourCounter(goal, monthsToSeptember){
    var now = Date.now();
    setHourState(HOUR_GOAL_KEY, goal);
    setHourState(HOUR_MONTHS_KEY, goal === 50 ? monthsToSeptember : null);
    setHourState(HOUR_YEAR_PERIOD_KEY, goal === 50 ? now : null);
    setHourState(HOUR_REAL_MONTHS_KEY, goal === 50 ? computeRealMonthsRemaining(now) : null);
    setHourState(HOUR_MONTH_PERIOD_KEY, now);
    setHourState(HOUR_MONTH_DEFERRED_KEY, null);
    setHourState(HOUR_YEAR_DEFERRED_KEY, null);
    saveLocalState();
    scheduleCloudPush();
    renderHourBars();
    renderHourCounterMenu();
  }
  function deactivateHourCounter(){
    setHourState(HOUR_GOAL_KEY, null);
    setHourState(HOUR_MONTHS_KEY, null);
    setHourState(HOUR_REAL_MONTHS_KEY, null);
    setHourState(HOUR_MONTH_PERIOD_KEY, null);
    setHourState(HOUR_YEAR_PERIOD_KEY, null);
    setHourState(HOUR_MONTH_DEFERRED_KEY, null);
    setHourState(HOUR_YEAR_DEFERRED_KEY, null);
    pruneStaleHourLogs(Date.now() + 1);
    saveLocalState();
    scheduleCloudPush();
    renderHourBars();
    renderHourCounterMenu();
  }

  // закрывает текущий период (режим "50"): в сегмент попадают только целые
  // часы, а остаток минут переносится в начало следующего периода
  // записи, старше нового periodStart, уже никогда не читаются никаким
  // кодом (все подсчёты фильтруют по текущему periodStart) — их значения
  // уже "законсервированы" в закрытом сегменте, поэтому их можно смело
  // удалить локально: даже если ещё не до конца синхронизированное
  // устройство "воскресит" такую запись при слиянии, она всё равно ни на
  // что не повлияет, так как окажется раньше актуального periodStart
  function pruneStaleHourLogs(beforeTs){
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && state[k].t < beforeTs){
        delete state[k];
      }
    });
  }

  function closeCurrentMonthPeriodWithCarry(){
    var periodStart = getMonthPeriodStart();
    var totalMinutes = sumHourLogsSince(periodStart);
    var wholeMinutes = Math.floor(totalMinutes/60) * 60;
    var carryMinutes = totalMinutes - wholeMinutes;
    recordMonthSegment(periodStart, wholeMinutes);
    var newStart = Date.now();
    setHourState(HOUR_MONTH_PERIOD_KEY, newStart);
    setHourState(HOUR_MONTH_DEFERRED_KEY, null);
    if(carryMinutes > 0){
      state["hourlog:" + newStart + "-carry"] = {c: carryMinutes, t: newStart};
    }
    // старые записи периода больше не удаляем сразу: они нужны для
    // статистики за скользящий месяц (см. pruneOldHourLogsForStats) и
    // больше не участвуют в подсчёте текущего периода — все суммы
    // фильтруются по актуальному periodStart
    saveLocalState();
    scheduleCloudPush();
    renderHourBars();
  }

  function updateHourBarVisual(prefix, totalMinutes, goalMinutes){
    var light = document.getElementById(prefix + "LightFill");
    var dark = document.getElementById(prefix + "DarkFill");
    if(!light || !dark || goalMinutes <= 0) return {lightPct:0, darkPct:0};
    var lightPct = Math.min(100, (totalMinutes/goalMinutes)*100);
    light.style.width = lightPct + "%";
    var darkPct = 0;
    if(totalMinutes > goalMinutes){
      var over = totalMinutes - goalMinutes;
      var rem = over % goalMinutes;
      darkPct = (rem === 0) ? 100 : (rem/goalMinutes)*100;
    }
    dark.style.width = darkPct + "%";
    return {lightPct: lightPct, darkPct: darkPct};
  }

  // размещает подписи "заполнено" / "не хватает" внутри их собственных зон бара
  function positionZoneTexts(achievedElId, remainingElId, totalMinutes, goalMinutes, achievedLabel, remainingLabel){
    var achievedEl = document.getElementById(achievedElId);
    var remainingEl = document.getElementById(remainingElId);
    if(!achievedEl || !remainingEl || goalMinutes <= 0) return;

    if(totalMinutes <= goalMinutes){
      var achievedPct = (totalMinutes/goalMinutes)*100;
      achievedEl.style.left = "0%";
      achievedEl.style.width = achievedPct + "%";
      achievedEl.textContent = achievedLabel;

      remainingEl.style.left = achievedPct + "%";
      remainingEl.style.width = (100 - achievedPct) + "%";
      remainingEl.textContent = (100 - achievedPct) > 0.5 ? remainingLabel : "";
    } else {
      // цель уже превышена — идёт "тёмный круг", подпись про остаток тут не нужна
      var over = totalMinutes - goalMinutes;
      var rem = over % goalMinutes;
      var darkPct = (rem === 0) ? 100 : (rem/goalMinutes)*100;
      achievedEl.style.left = "0%";
      achievedEl.style.width = darkPct + "%";
      achievedEl.textContent = achievedLabel;
      remainingEl.style.width = "0%";
      remainingEl.textContent = "";
    }
  }

  function updateHourResetButtonVisibility(){
    var btn = document.getElementById("hourMonthResetBtn");
    if(!btn) return;
    var goal = getHourGoal();
    if(!goal){ btn.style.display = "none"; return; }
    var yearDeferred = goal === 50 && state[HOUR_YEAR_DEFERRED_KEY] &&
      state[HOUR_YEAR_DEFERRED_KEY].c === getYearPeriodStart();
    var monthDeferred = goal !== 50 && state[HOUR_MONTH_DEFERRED_KEY] &&
      state[HOUR_MONTH_DEFERRED_KEY].c === getMonthPeriodStart();
    btn.textContent = "Сбросить счётчик";
    btn.style.display = (yearDeferred || monthDeferred) ? "block" : "none";
  }

  function renderHourYearBar(){
    var months = getMonthsToSeptember();
    var yearStart = getYearPeriodStart();
    var segHolder = document.getElementById("hourYearSegments");
    if(!segHolder) return;
    segHolder.innerHTML = "";
    if(!months || !yearStart) return;

    var targetMinutes = months * 50 * 60;
    var closed = getClosedMonthSegments().filter(function(s){ return s.periodStart >= yearStart; });
    var currentMinutes = sumHourLogsSince(getMonthPeriodStart());
    var achievedMinutes = closed.reduce(function(a,s){ return a+s.minutes; }, 0) + currentMinutes;

    // свёрнутый вид: заливка + 2 подписи (как у месячного бара), в целых часах
    updateHourBarVisual("hourYear", achievedMinutes, targetMinutes);
    positionZoneTexts(
      "hourYearAchievedText", "hourYearRemainingText",
      achievedMinutes, targetMinutes,
      String(Math.round(achievedMinutes/60)),
      String(Math.round(Math.max(0, targetMinutes-achievedMinutes)/60))
    );

    // развёрнутый вид: сегменты по месяцам + остаток
    var segMinutesList = closed.map(function(s){ return s.minutes; });
    segMinutesList.push(currentMinutes);
    segMinutesList.forEach(function(minutes){
      if(minutes <= 0) return;
      var seg = document.createElement("div");
      seg.className = "hour-year-segment";
      seg.style.width = (targetMinutes > 0 ? (minutes/targetMinutes)*100 : 0) + "%";
      var hoursVal = minutes/60;
      seg.textContent = (hoursVal >= HOUR_SEGMENT_LABEL_MIN) ? Math.round(hoursVal) : "";
      segHolder.appendChild(seg);
    });
    var remainingMinutes = Math.max(0, targetMinutes - achievedMinutes);
    if(remainingMinutes > 0){
      var rem = document.createElement("div");
      rem.className = "hour-year-remaining";
      rem.style.width = (targetMinutes > 0 ? (remainingMinutes/targetMinutes)*100 : 0) + "%";
      var remHours = remainingMinutes/60;
      rem.textContent = (remHours >= HOUR_SEGMENT_LABEL_MIN) ? Math.round(remHours) : "";
      segHolder.appendChild(rem);
    }
  }

  function renderHourBars(){
    var goal = getHourGoal();
    var monthWrap = document.getElementById("hourMonthWrap");
    var yearWrap = document.getElementById("hourYearWrap");
    if(!goal){
      if(monthWrap) monthWrap.classList.remove("visible");
      if(yearWrap) yearWrap.classList.remove("visible");
      return;
    }
    if(monthWrap) monthWrap.classList.add("visible");
    var periodStart = getMonthPeriodStart() || Date.now();
    var monthMinutes = sumHourLogsSince(periodStart);
    var goalMinutes = goal*60;
    updateHourBarVisual("hourMonth", monthMinutes, goalMinutes);
    positionZoneTexts(
      "hourMonthAchievedText", "hourMonthRemainingText",
      monthMinutes, goalMinutes,
      formatHHMM(monthMinutes),
      formatHHMM(Math.max(0, goalMinutes-monthMinutes))
    );
    updateHourResetButtonVisibility();

    if(goal === 50){
      if(yearWrap) yearWrap.classList.add("visible");
      renderHourYearBar();
    } else if(yearWrap){
      yearWrap.classList.remove("visible");
    }
  }

  function closeHourInputOverlay(prefix){
    var overlay = document.getElementById(prefix + "Overlay");
    if(overlay) overlay.classList.remove("open");
  }
  function toggleHourInputOverlay(prefix){
    var overlay = document.getElementById(prefix + "Overlay");
    if(!overlay) return;
    overlay.classList.toggle("open");
    if(overlay.classList.contains("open")){
      var input = document.getElementById(prefix + "Input");
      if(input){ input.value = ""; input.style.borderColor = ""; }
      // поле комментария за сегодня: показываем только если функция включена
      // в настройках, и сразу подставляем уже существующий текст — чтобы
      // повторное открытие бара за тот же день позволяло его редактировать,
      // а не затирать новым
      if(prefix === "hourMonth"){
        var noteInput = document.getElementById("hourMonthNoteInput");
        if(noteInput){
          var notesOn = isHourNotesEnabled();
          noteInput.style.display = notesOn ? "block" : "none";
          noteInput.style.borderColor = "";
          noteInput.value = notesOn ? getHourNoteForDay(startOfDay(Date.now())) : "";
        }
      }
      if(input) input.focus();
    }
  }
  function confirmHourInput(prefix){
    var input = document.getElementById(prefix + "Input");
    if(!input) return;
    var rawValue = input.value;
    var hasRawValue = rawValue.trim().length > 0;
    var minutes = parseHourInput(rawValue);

    var notesOn = (prefix === "hourMonth") && isHourNotesEnabled();
    var noteInput = notesOn ? document.getElementById("hourMonthNoteInput") : null;
    var noteText = noteInput ? noteInput.value : "";
    var hasNoteText = notesOn && noteText.trim().length > 0;

    // часы введены, но не разобрались — явная ошибка формата
    if(hasRawValue && (minutes === null || minutes <= 0)){
      input.style.borderColor = "#b0432e";
      return;
    }
    // ничего не введено вовсе — ни часов, ни (при включённой функции) заметки
    if(!hasRawValue && !hasNoteText){
      input.style.borderColor = "#b0432e";
      if(noteInput) noteInput.style.borderColor = "#b0432e";
      return;
    }

    if(hasRawValue) addHourLogEntry(minutes);
    if(notesOn) setHourNoteForDay(startOfDay(Date.now()), noteText);

    closeHourInputOverlay(prefix);
    renderHourBars();
    // режим "50" с выбранным числом месяцев больше реального — при каждом
    // внесении времени, пока не наверстали "просроченные" периоды, снова
    // спрашиваем про переход к следующему месяцу
    if(isInCatchUpMode() && !modalOverlay.classList.contains("open")){
      showHourMonthEndDialog(getMonthPeriodStart());
    }
  }

  // --- диалоги окончания месяца / года (тот же стиль, что у окна синхронизации) ---
  function showHourMonthEndDialog(periodStart){
    if(modalOverlay.classList.contains("open")) return;
    var totalMinutes = sumHourLogsSince(periodStart);
    var isYearMode = getHourGoal() === 50;
    modalBox.innerHTML =
      modalHeader("Месяц закончился - " + formatHHMM(totalMinutes),
        isYearMode ? "Перейти к следующему месяцу?" : "Обнулить счётчик?") +
      '<button class="modal-btn primary" id="mHourMonthYes">Да</button>' +
      '<button class="modal-btn" id="mHourMonthNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHourMonthYes").addEventListener("click", function(){
      if(isYearMode){
        closeCurrentMonthPeriodWithCarry();
      } else {
        deactivateHourCounter();
      }
      closeModal();
    });
    document.getElementById("mHourMonthNo").addEventListener("click", function(){
      setHourState(HOUR_MONTH_DEFERRED_KEY, periodStart);
      saveLocalState(); scheduleCloudPush();
      updateHourResetButtonVisibility();
      closeModal();
    });
  }

  function showHourYearEndDialog(yearStart){
    if(modalOverlay.classList.contains("open")) return;
    var totalMinutes = sumYearMinutes();
    modalBox.innerHTML =
      modalHeader("Год окончен - " + Math.round(totalMinutes/60) + " часов", "Сбросить счётчик?") +
      '<button class="modal-btn primary" id="mHourYearYes">Да</button>' +
      '<button class="modal-btn" id="mHourYearNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHourYearYes").addEventListener("click", function(){
      deactivateHourCounter();
      closeModal();
    });
    document.getElementById("mHourYearNo").addEventListener("click", function(){
      setHourState(HOUR_YEAR_DEFERRED_KEY, yearStart);
      saveLocalState(); scheduleCloudPush();
      updateHourResetButtonVisibility();
      closeModal();
    });
  }

  function resolveDeferredHourReset(){
    var goal = getHourGoal();
    if(!goal) return;
    var yearDeferred = goal === 50 && state[HOUR_YEAR_DEFERRED_KEY] &&
      state[HOUR_YEAR_DEFERRED_KEY].c === getYearPeriodStart();
    if(yearDeferred){ deactivateHourCounter(); return; }
    var monthDeferred = state[HOUR_MONTH_DEFERRED_KEY] &&
      state[HOUR_MONTH_DEFERRED_KEY].c === getMonthPeriodStart();
    if(monthDeferred){
      if(goal === 50){
        closeCurrentMonthPeriodWithCarry();
      } else {
        deactivateHourCounter();
      }
    }
  }

  // календарные границы (реальное 1 число месяца / 1 сентября) — отдельно
  // от "наверстывания", которое привязано не к календарю, а к вводу часов
  function checkHourBoundaries(){
    pruneOldHourLogsForStats();
    var goal = getHourGoal();
    if(!goal || modalOverlay.classList.contains("open")) return;
    var periodStart = getMonthPeriodStart();
    if(periodStart && isNewCalendarMonth(periodStart)){
      var monthDeferredRec = state[HOUR_MONTH_DEFERRED_KEY];
      if(!(monthDeferredRec && monthDeferredRec.c === periodStart)){
        showHourMonthEndDialog(periodStart);
        return;
      }
    }
    if(goal === 50){
      var yearStart = getYearPeriodStart();
      if(yearStart && Date.now() >= computeNextSeptemberFirst(yearStart)){
        var yearDeferredRec = state[HOUR_YEAR_DEFERRED_KEY];
        if(!(yearDeferredRec && yearDeferredRec.c === yearStart)){
          showHourYearEndDialog(yearStart);
        }
      }
    }
  }

  // --- меню в подвале ("Дополнительный счётчик" / "Убрать дополнительный счётчик") ---
  function renderHourCounterMenu(){
    var row = document.getElementById("hourCounterMenuRow");
    if(!row) return;
    if(getHourGoal()){
      row.innerHTML = '<button class="version-history-item" id="hourCounterRemoveBtn" style="color:#8a2f1c;">Убрать дополнительный счётчик</button>';
      document.getElementById("hourCounterRemoveBtn").addEventListener("click", openRemoveHourCounterConfirm);
    } else {
      row.innerHTML = '<button class="version-history-item" id="hourCounterAddBtn">Дополнительный счётчик</button>';
      document.getElementById("hourCounterAddBtn").addEventListener("click", openHourGoalModal);
    }
  }

  function openHourGoalModal(){
    modalBox.innerHTML =
      modalHeader("Дополнительный счётчик") +
      '<div class="modal-btn-grid">' +
        '<button id="mHour15">15</button>' +
        '<button id="mHour30">30</button>' +
        '<button id="mHour50">50</button>' +
      '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHour15").addEventListener("click", function(){ activateHourCounter(15, null); closeModal(); });
    document.getElementById("mHour30").addEventListener("click", function(){ activateHourCounter(30, null); closeModal(); });
    document.getElementById("mHour50").addEventListener("click", openMonthsToSeptemberModal);
  }

  function openMonthsToSeptemberModal(){
    var buttons = "";
    for(var i = 1; i <= 12; i++){ buttons += '<button data-months="' + i + '">' + i + '</button>'; }
    modalBox.innerHTML =
      modalHeader("Выберите количество месяцев до сентября") +
      '<div class="modal-btn-grid">' + buttons + '</div>';
    bindClose();
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-months]"), function(btn){
      btn.addEventListener("click", function(){
        activateHourCounter(50, Number(btn.getAttribute("data-months")));
        closeModal();
      });
    });
  }

  // ---- статистика за скользящий календарный месяц (независимо от того,
  // когда закрывался текущий период счётчика) ----

  // начало окна хранения: сегодняшняя дата минус 1 календарный месяц, 00:00
  function getStatsCutoffTs(){
    var d = new Date();
    d.setHours(0,0,0,0);
    d.setMonth(d.getMonth() - 1);
    return d.getTime();
  }

  // записи старше скользящего месяца нигде не нужны (ни локально, ни в
  // облаке) — удаляем их и, если что-то удалили, отправляем изменение дальше
  // очистка касается ТОЛЬКО "сырых" записей hourlog: (детальная история для
  // дневной статистики месячного счётчика). Годовой счётчик хранит данные
  // отдельно, по одному числу на закрытый месяц, в ключах "hoursegment:" —
  // они этой функцией не затрагиваются и не удаляются никогда.
  function pruneOldHourLogsForStats(){
    var cutoff = getStatsCutoffTs();
    var removed = false;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && typeof state[k].t === "number" && state[k].t < cutoff){
        delete state[k];
        removed = true;
      }
    });
    if(removed){
      saveLocalState();
      scheduleCloudPush();
    }
  }

  // накопленное с начала месяца время, сгруппированное по датам, где были
  // записи, за последний календарный месяц (не привязано к текущему
  // периоду счётчика — переход на новый период данные не стирает).
  // для каждой даты хранится массив накопленных значений на момент каждой
  // отдельной записи этого дня, от новых к старым.
  function getMonthCumulativeStats(){
    var cutoff = getStatsCutoffTs();
    var entries = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && typeof state[k].c === "number" && state[k].t >= cutoff){
        entries.push({minutes: state[k].c, t: state[k].t});
      }
    });
    entries.sort(function(a,b){ return a.t - b.t; });
    function pad2(n){ return (n < 10 ? "0" : "") + n; }
    var days = [];
    var running = 0;
    var lastKey = null;
    entries.forEach(function(e){
      running += e.minutes;
      var d = new Date(e.t);
      var key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      if(key !== lastKey){
        days.push({label: pad2(d.getDate()) + "." + pad2(d.getMonth() + 1), values: []});
        lastKey = key;
      }
      days[days.length - 1].values.push(running);
    });
    days.forEach(function(day){ day.values.reverse(); }); // внутри дня — новые записи сверху
    days.reverse(); // дни — от новых к старым
    return days;
  }

  function hourStatsRowHtml(label, minutes, mark, extraClass){
    return '<div class="settings-row hour-stats-row' + (extraClass ? " " + extraClass : "") + '">' +
      '<span class="hour-stats-left"><span class="hour-stats-mark">' + (mark ? "*" : "") + '</span><span>' + label + '</span></span>' +
      '<span>' + formatHHMM(minutes) + '</span>' +
    '</div>';
  }

  function openHourMonthStatsModal(){
    if(modalOverlay.classList.contains("open")) return;
    pruneOldHourLogsForStats();
    var days = getMonthCumulativeStats();
    var body = days.length ? days.map(function(day, idx){
      var hasMultiple = day.values.length > 1;
      if(!hasMultiple){
        return hourStatsRowHtml(day.label, day.values[0], false);
      }
      var collapsed = hourStatsRowHtml(day.label, day.values[0], true, "hour-stats-toggle");
      var expandedRows = day.values.map(function(v){
        return hourStatsRowHtml(day.label, v, false, "hour-stats-toggle");
      }).join("");
      return '<div class="hour-stats-day" data-day="' + idx + '">' +
        '<div class="hour-stats-collapsed">' + collapsed + '</div>' +
        '<div class="hour-stats-expanded" style="display:none;">' + expandedRows + '</div>' +
      '</div>';
    }).join("") : '<div class="version-history-empty">За последний месяц пока нет записей.</div>';
    modalBox.innerHTML = modalHeader("Статистика за месяц") + body;
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll(".hour-stats-day"), function(dayEl){
      var collapsed = dayEl.querySelector(".hour-stats-collapsed");
      var expanded = dayEl.querySelector(".hour-stats-expanded");
      collapsed.addEventListener("click", function(){
        collapsed.style.display = "none";
        expanded.style.display = "block";
      });
      Array.prototype.forEach.call(expanded.querySelectorAll(".hour-stats-row"), function(row){
        row.addEventListener("click", function(){
          expanded.style.display = "none";
          collapsed.style.display = "block";
        });
      });
    });
  }

  function openRemoveHourCounterConfirm(){
    modalBox.innerHTML =
      modalHeader("Весь прогресс будет потерян. Уверены?") +
      '<button class="modal-btn primary" id="mHourRemoveYes">Да</button>' +
      '<button class="modal-btn" id="mHourRemoveNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHourRemoveYes").addEventListener("click", function(){ deactivateHourCounter(); closeModal(); });
    document.getElementById("mHourRemoveNo").addEventListener("click", closeModal);
  }

  // --- обработчики баров ---
  var hourMonthBar = document.getElementById("hourMonthBar");
  if(hourMonthBar) hourMonthBar.addEventListener("click", function(){ toggleHourInputOverlay("hourMonth"); });
  var hourMonthInput = document.getElementById("hourMonthInput");
  if(hourMonthInput){
    hourMonthInput.addEventListener("click", function(e){ e.stopPropagation(); });
    hourMonthInput.addEventListener("keydown", function(e){ if(e.key === "Enter") confirmHourInput("hourMonth"); });
  }
  var hourMonthNoteInput = document.getElementById("hourMonthNoteInput");
  if(hourMonthNoteInput) hourMonthNoteInput.addEventListener("click", function(e){ e.stopPropagation(); });
  var hourMonthConfirm = document.getElementById("hourMonthConfirm");
  if(hourMonthConfirm) hourMonthConfirm.addEventListener("click", function(e){ e.stopPropagation(); confirmHourInput("hourMonth"); });
  var hourMonthCancel = document.getElementById("hourMonthCancel");
  if(hourMonthCancel) hourMonthCancel.addEventListener("click", function(e){ e.stopPropagation(); closeHourInputOverlay("hourMonth"); });
  var hourMonthInfo = document.getElementById("hourMonthInfo");
  if(hourMonthInfo) hourMonthInfo.addEventListener("click", function(e){ e.stopPropagation(); openHourMonthStatsModal(); });
  var hourMonthResetBtn = document.getElementById("hourMonthResetBtn");
  if(hourMonthResetBtn) hourMonthResetBtn.addEventListener("click", function(e){ e.stopPropagation(); resolveDeferredHourReset(); });
  var hourYearBar = document.getElementById("hourYearBar");
  if(hourYearBar) hourYearBar.addEventListener("click", function(){ hourYearBar.classList.toggle("expanded"); });

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

  function getMoodEmoji(){ var r = state[MOOD_EMOJI_KEY]; return (r && r.c) ? r.c : null; }
  function isMoodEnabled(){ var r = state[MOOD_ENABLED_KEY]; return !!(r && r.c); }
  function getMoodDataResetAt(){ var r = state[MOOD_DATA_RESET_AT_KEY]; return (r && r.c) ? r.c : 0; }

  function getTodaySessionsCount(){
    var floor = Math.max(startOfDay(Date.now()), getMoodDataResetAt());
    var count = 0;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodsession:") === 0 && state[k] && state[k].t >= floor) count++;
    });
    return count;
  }
  function hasLoggedToday(){ return getTodaySessionsCount() > 0; }

  function getMoodCounts(){
    var floor = getMoodDataResetAt();
    var counts = {};
    moodCategoriesResolved().forEach(function(c){ counts[c.key] = 0; });
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodlog:") === 0 && state[k] && typeof state[k].c === "string" && state[k].t >= floor){
        if(counts[state[k].c] !== undefined) counts[state[k].c]++;
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

  // --- отметка настроения (без ограничения по количеству в сутки, до 2 вариантов за раз) ---
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
      state["moodsession:" + sessionTs + "-" + Math.random().toString(36).slice(2,7)] = {c: 1, t: sessionTs};
      moodCheckinSelected.forEach(function(key){
        state["moodlog:" + sessionTs + "-" + key + "-" + Math.random().toString(36).slice(2,7)] = {c: key, t: sessionTs};
      });
      if(!state[MOOD_FIRST_LOG_KEY] || state[MOOD_FIRST_LOG_KEY].c == null || state[MOOD_FIRST_LOG_KEY].c < getMoodDataResetAt()){
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
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodsession:") === 0 && state[k] && state[k].t >= floor) count++;
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

    var firstLogRec = state[MOOD_FIRST_LOG_KEY];
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

  // ===================== КАРТА ДНЕЙ ГОДА =====================
  // Компактная сетка "один квадратик = один день", как в GitHub-графике
  // коммитов, но не привязана к календарному году — это скользящее окно
  // за последние 365 дней, заканчивающееся сегодняшним днём. Живёт внутри
  // модалки настроек, на третьей вкладке (всегда видна, отдельного
  // включения/выключения не требует). Своего лога не ведёт — цвет каждого
  // дня считается на лету по видам активности за этот день:
  //  - чтение хотя бы одной главы (ключи вида "БукваКниги|Номер", т.е.
  //    содержащие "|" — см. buildExportData);
  //  - дополнительный счётчик (записи "hourlog:") — подробные записи
  //    хранятся только примерно за последний скользящий месяц (см.
  //    pruneOldHourLogsForStats), поэтому для более старых дней это не
  //    может быть учтено;
  //  - выполненная задача в прогресс-баре личной цели (записи
  //    "goalcompletion:" — не удаляются никогда, переживают удаление
  //    самой цели);
  //  - отмеченная задача во вкладках задач (записи "taskcompletion:" —
  //    тоже не удаляются никогда, переживают извлечение задачи из архива
  //    только если сама отметка ещё не была отменена — см. restoreTaskFromArchive).
  // Один вид активности за день — клетка "light", два — "dark", три и
  // более — "darkest". Настроение (moodlog:) в закраску клетки не входит
  // вовсе — оно только показывается в детализации по тапу на день.
  // Сетка строится заново при каждом открытии/перерисовке вкладки — она
  // всегда читает актуальный state, поэтому только что отмеченная
  // активность сразу видна, без отдельного кеша.

  var MONTH_NAMES_SHORT = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  var MONTH_NAMES_FULL = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  var WEEKDAY_NAMES_FULL = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
  var WEEKDAY_NAMES_SHORT = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

  function formatDayFull(ts){
    var d = new Date(ts);
    return d.getDate() + " " + MONTH_NAMES_FULL[d.getMonth()] + " " + d.getFullYear();
  }

  // сколько глав было отмечено в каждый день (по ключам вида "Книга|Глава")
  function getReadingCountsByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(!rec || rec.c !== true) return;
      var day = startOfDay(rec.t);
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }

  // сколько минут дополнительного счётчика записано в каждый день (только
  // "сырые" hourlog:, доступные примерно за последний месяц — см. выше)
  function getServiceMinutesByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") !== 0) return;
      var rec = state[k];
      if(!rec || typeof rec.c !== "number") return;
      var day = startOfDay(rec.t);
      byDay[day] = (byDay[day] || 0) + rec.c;
    });
    return byDay;
  }

  // список отметок настроения в каждый день (ключи "moodlog:", не удаляются)
  function getMoodsByDay(){
    var byDay = {};
    var floor = getMoodDataResetAt();
    var cats = moodCategoriesResolved();
    var catByKey = {};
    cats.forEach(function(c){ catByKey[c.key] = c; });
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodlog:") !== 0) return;
      var rec = state[k];
      if(!rec || typeof rec.c !== "string" || rec.t < floor) return;
      var cat = catByKey[rec.c];
      if(!cat) return;
      var day = startOfDay(rec.t);
      (byDay[day] = byDay[day] || []).push(cat);
    });
    return byDay;
  }

  // список выполненных задач по личным целям в каждый день (ключи
  // "goalcompletion:", независимая запись — не пропадает из истории, даже
  // если саму цель потом удалили или переиспользовали)
  function getGoalCompletionsByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goalcompletion:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c) return;
      var day = startOfDay(rec.t);
      (byDay[day] = byDay[day] || []).push(rec.c);
    });
    return byDay;
  }

  // --- построение вертикальной сетки (недели сверху вниз, дни слева направо) ---
  // Скользящее окно: последние 365 дней, включая сегодня, дополненное до
  // целых недель (понедельник — воскресенье) с обеих сторон.
  function buildYearGridMarkup(){
    var readingByDay = getReadingCountsByDay();
    var serviceByDay = getServiceMinutesByDay();
    var goalsByDay = getGoalCompletionsByDay();
    var tasksByDay = getTaskCompletionsByDay();

    var now = new Date();
    var todayStart = startOfDay(now.getTime());
    var windowStart = todayStart - 364 * DAY_MS; // 365 дней включительно
    // понедельник = 0 ... воскресенье = 6
    var windowStartWeekday = (new Date(windowStart).getDay() + 6) % 7;
    var gridStart = windowStart - windowStartWeekday * DAY_MS;
    var todayWeekday = (new Date(todayStart).getDay() + 6) % 7;
    var gridEnd = todayStart + (6 - todayWeekday) * DAY_MS;
    var totalDays = Math.round((gridEnd - gridStart) / DAY_MS) + 1;
    var totalRows = Math.ceil(totalDays / 7);

    var headerHtml = '<div class="year-grid-v-row year-grid-v-header">' +
      '<span class="year-grid-v-month-label"></span>';
    for(var wd = 0; wd < 7; wd++){
      headerHtml += '<span class="year-grid-v-weekday">' + WEEKDAY_NAMES_SHORT[wd] + '</span>';
    }
    headerHtml += '</div>';

    var rowsHtml = "";
    var lastMonthShown = -1;
    var activeDays = 0;
    for(var row = 0; row < totalRows; row++){
      var rowFirstDay = gridStart + row * 7 * DAY_MS;
      var rowFirstMonth = new Date(rowFirstDay).getMonth();
      var monthLabel = "";
      if(rowFirstDay >= windowStart && rowFirstMonth !== lastMonthShown){
        lastMonthShown = rowFirstMonth;
        monthLabel = MONTH_NAMES_SHORT[rowFirstMonth];
      }
      rowsHtml += '<div class="year-grid-v-row"><span class="year-grid-v-month-label">' + monthLabel + '</span>';
      for(var col = 0; col < 7; col++){
        var dayTs = rowFirstDay + col * DAY_MS;
        var cls = "year-grid-v-cell";
        var attr = "";
        if(dayTs < windowStart){
          cls += " empty";
        } else if(dayTs > todayStart){
          cls += " future";
        } else {
          var chapters = readingByDay[dayTs] || 0;
          var minutes = serviceByDay[dayTs] || 0;
          var goalsDone = goalsByDay[dayTs] || [];
          var tasksDone = tasksByDay[dayTs] || [];
          var kinds = (chapters > 0 ? 1 : 0) + (minutes > 0 ? 1 : 0) + (goalsDone.length > 0 ? 1 : 0) + (tasksDone.length > 0 ? 1 : 0);
          if(kinds >= 3) cls += " darkest";
          else if(kinds === 2) cls += " dark";
          else if(kinds === 1) cls += " light";
          if(kinds > 0) activeDays++;
          if(dayTs === todayStart) cls += " today";
          attr = ' data-day-ts="' + dayTs + '"';
        }
        rowsHtml += '<span class="' + cls + '"' + attr + '></span>';
      }
      rowsHtml += '</div>';
    }

    // невидимая строка-распорка внизу ленты (те же классы строки/клеток —
    // поэтому её высота автоматически совпадает с обычной строкой при любой
    // ширине экрана). Она не участвует в подсчёте и не кликабельна (нет
    // data-day-ts), а нужна только для того, чтобы при прокрутке до упора
    // вниз (см. requestAnimationFrame ниже и ручную прокрутку пользователем)
    // самая свежая настоящая строка поднималась выше нижнего края примерно
    // на один квадрат и полностью выходила из-под затемняющей маски-тумана
    // (.year-grid-v-scroll, см. mask-image в components.css).
    rowsHtml += '<div class="year-grid-v-row year-grid-v-spacer-row"><span class="year-grid-v-month-label"></span>';
    for(var sp = 0; sp < 7; sp++){
      rowsHtml += '<span class="year-grid-v-cell empty"></span>';
    }
    rowsHtml += '</div>';

    return {html: headerHtml + rowsHtml, activeDays: activeDays};
  }

  // --- детализация по тапу на день ---
  // Раньше открывалась отдельным всплывающим окном (modalOverlay/modalBox).
  // Теперь показывается прямо внутри вкладки настроек "Карта дней года" —
  // подменяет собой сетку в том же #settingsTabContent, как будто на
  // странице сменилось изображение. Отдельной кнопки закрытия ("крестик")
  // здесь нет: чтобы вернуться к сетке, достаточно ещё раз нажать на
  // язычок настроек "Карта дней года" — он всегда заново отрисовывает
  // сетку (см. switchSettingsTab → renderSettingsTabYear).
  function renderYearDayDetail(dayTs){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var readingByDay = getReadingCountsByDay();
    var serviceByDay = getServiceMinutesByDay();
    var moodsByDay = getMoodsByDay();
    var goalsByDay = getGoalCompletionsByDay();
    var tasksByDay = getTaskCompletionsByDay();

    var chapters = readingByDay[dayTs] || 0;
    var minutes = serviceByDay[dayTs] || 0;
    var moods = moodsByDay[dayTs] || [];
    var goalsDone = goalsByDay[dayTs] || [];
    var tasksDone = tasksByDay[dayTs] || [];

    var d = new Date(dayTs);
    var weekdayLabel = WEEKDAY_NAMES_FULL[d.getDay()];
    var rows = "";

    if(chapters > 0){
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">📖</span><span>' +
        chapters + " " + pluralRu(chapters, ["глава","главы","глав"]) + " прочитано</span></div>";
    }
    if(minutes > 0){
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">🕓</span><span>Дополнительный счётчик: ' +
        formatHHMM(minutes) + '</span></div>';
    }
    if(goalsDone.length){
      var goalsHtml = goalsDone.map(function(g){
        return '<div class="year-day-goal-item">' + escapeHtml(g.taskText || "Без названия") +
          ' <span class="year-day-goal-source">— ' + escapeHtml(g.goalTitle || "Без названия") + '</span></div>';
      }).join("");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">🎯</span><span>Выполненные задачи целей:' + goalsHtml + '</span></div>';
    }
    if(tasksDone.length){
      var tasksHtml = tasksDone.map(function(t){
        return '<div class="year-day-goal-item">' + escapeHtml(t.text || "Без названия") +
          ' <span class="year-day-goal-source">— ' + escapeHtml(TASK_TAB_TITLES[t.tab] || t.tab || "") + '</span></div>';
      }).join("");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">✅</span><span>Выполненные задачи:' + tasksHtml + '</span></div>';
    }
    if(moods.length){
      var moodHtml = moods.map(function(m){ return m.emoji + " " + escapeHtml(m.label); }).join(", ");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">🙂</span><span>Настроение: ' + moodHtml + '</span></div>';
    }
    if(!rows){
      rows = '<div class="year-day-empty">В этот день активность не отмечена.</div>';
    }

    // блок с комментарием этого дня: показываем, если функция сейчас
    // включена в настройках, либо если за этот день уже существует ранее
    // сохранённая заметка (чтобы старые записи оставались доступны для
    // просмотра/правки, даже если функцию потом выключили). Комментарий
    // отображается как обычный статичный текст (как и всё остальное в
    // окне), с карандашиком сразу после текста — по нажатию на него текст
    // превращается в редактируемое поле; там же появляется дискета для
    // сохранения (после сохранения снова становится карандашиком).
    var existingNote = getHourNoteForDay(dayTs);
    var showNotes = isHourNotesEnabled() || existingNote;

    container.innerHTML =
      '<div class="year-grid-tab-title">' + escapeHtml(weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1)) + '</div>' +
      '<div class="year-day-modal-title">' + escapeHtml(formatDayFull(dayTs)) + '</div>' +
      rows +
      (showNotes ? '<div class="year-day-note-section" id="yearDayNoteSection"></div>' : '');
    container.scrollTop = 0;

    if(showNotes) renderYearDayNoteView(dayTs, existingNote);
  }

  var PENCIL_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
  var SAVE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';

  // статичный вид комментария: текст (или блёклая заглушка "Комментарий",
  // если ещё ничего не введено) и карандашик сразу после него. Ссылки в
  // тексте (см. linkifyHtml выше) становятся кликабельными.
  function renderYearDayNoteView(dayTs, noteText){
    var wrap = document.getElementById("yearDayNoteSection");
    if(!wrap) return;
    var textHtml = noteText ? linkifyHtml(noteText) : '<span class="year-day-note-placeholder">Комментарий</span>';
    wrap.innerHTML =
      '<div class="year-day-note-view">' + textHtml +
        '<button type="button" class="year-day-note-icon-btn" id="yearDayNoteEditBtn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
      '</div>';
    var editBtn = document.getElementById("yearDayNoteEditBtn");
    if(editBtn){
      editBtn.addEventListener("click", function(){
        renderYearDayNoteEdit(dayTs, noteText);
      });
    }
  }

  // режим редактирования: тот же блок текста, что и в статичном виде
  // (contenteditable вместо textarea), а дискета — реальный элемент СРАЗУ
  // ПОСЛЕ текста в потоке (как и карандашик), поэтому она естественным
  // образом сдвигается по мере набора текста и переносится на новую строку
  // вместе с ним, а не висит в фиксированном месте экрана
  //
  // изначально пустой текстовый узел (createTextNode("")) — не даёт
  // браузеру стабильной точки для курсора: Selection API подтверждает
  // установку каретки, но реально набираемый текст в такой узел не
  // попадает (символы теряются). Поэтому для пустого случая текстовый
  // узел начинается с невидимого символа нулевой ширины (ZERO WIDTH
  // SPACE, U+200B) — он делает узел непустым (ввод начинает приниматься
  // браузером нормально), но ничего не отображает и не занимает места,
  // так что дискета остаётся ровно на своей строке рядом с текстом (в
  // отличие от служебного <br>, который переносил бы её на строку ниже).
  // При вычислении/сохранении текста этот символ вырезается.
  var EMPTY_ANCHOR_CHAR = "\u200B";
  function getEditableNoteText(root, skipEl){
    var text = "";
    function walk(node){
      if(node === skipEl) return;
      if(node.nodeType === 3){ text += node.nodeValue; return; }
      if(node.nodeType === 1 && node.tagName === "BR"){ text += "\n"; return; }
      var kids = node.childNodes;
      for(var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    var top = root.childNodes;
    for(var i = 0; i < top.length; i++) walk(top[i]);
    // служебный символ-якорь мог оказаться где угодно в тексте (браузер
    // иногда сохраняет его перед впечатанным текстом, а не только в
    // начале) — вырезаем все вхождения, это не пользовательский ввод
    return text.split(EMPTY_ANCHOR_CHAR).join("");
  }
  function renderYearDayNoteEdit(dayTs, noteText){
    var wrap = document.getElementById("yearDayNoteSection");
    if(!wrap) return;
    wrap.innerHTML =
      '<div class="year-day-note-view year-day-note-editable" id="yearDayNoteInput" contenteditable="true"></div>';
    var editable = document.getElementById("yearDayNoteInput");
    if(!editable) return;

    var textNode = document.createTextNode(noteText ? noteText : EMPTY_ANCHOR_CHAR);
    editable.appendChild(textNode);
    editable.setAttribute("data-day-ts", String(dayTs)); // нужно для автосохранения при закрытии окна/смене вкладки
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "year-day-note-icon-btn";
    saveBtn.id = "yearDayNoteSaveBtn";
    saveBtn.title = "Сохранить";
    saveBtn.innerHTML = SAVE_ICON_SVG;
    editable.appendChild(saveBtn);

    function updatePlaceholder(){
      var empty = getEditableNoteText(editable, saveBtn).length === 0;
      editable.classList.toggle("is-empty", empty);
    }
    updatePlaceholder();

    // курсор сразу ставим в конец введённого текста (перед дискетой) —
    // так же, как карандашик стоит сразу после текста в статичном виде
    // (если текста ещё нет — сразу после невидимого символа-якоря, см.
    // EMPTY_ANCHOR_CHAR выше)
    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", updatePlaceholder);
    // Enter вставляет обычный перевод строки внутри того же текстового узла
    // (white-space:pre-wrap в CSS), вместо того чтобы браузер плодил <div>
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    saveBtn.addEventListener("click", function(e){
      e.stopPropagation();
      var newText = getEditableNoteText(editable, saveBtn);
      setHourNoteForDay(dayTs, newText, true); // остаёмся на этой же карточке дня, сетку не перерисовываем
      renderYearDayNoteView(dayTs, newText.trim());
    });
  }

  // если в этот момент открыта карточка дня с активным редактированием
  // комментария (contenteditable, см. renderYearDayNoteEdit), сохраняем
  // введённый текст без явного нажатия на дискету — вызывается перед
  // закрытием окна настроек и перед переключением на другую вкладку
  // настроек, чтобы недописанный текст не терялся
  function flushPendingYearDayNoteEdit(){
    var editable = document.getElementById("yearDayNoteInput");
    if(!editable || !editable.isContentEditable) return;
    var dayTsAttr = editable.getAttribute("data-day-ts");
    if(dayTsAttr === null) return;
    var saveBtn = document.getElementById("yearDayNoteSaveBtn");
    var newText = getEditableNoteText(editable, saveBtn);
    setHourNoteForDay(Number(dayTsAttr), newText, true);
  }

  // то же самое для текста задачи (вкладки red/inbox/next/…): если в
  // момент ухода со вкладки/закрытия окна настроек какая-то строка была
  // в режиме редактирования (contenteditable, см. renderTaskRowEdit),
  // сохраняем введённый текст без явного нажатия на дискету — иначе он
  // терялся при простом переключении вкладки. Строк в редактировании
  // одновременно может быть несколько (клик по карандашику на разных
  // строках), поэтому проходим по всем.
  function flushPendingTaskEdits(){
    var editables = document.querySelectorAll(".task-editable[data-task-id]");
    Array.prototype.forEach.call(editables, function(editable){
      if(!editable.isContentEditable) return;
      var taskId = editable.getAttribute("data-task-id");
      if(!taskId) return;
      var saveBtn = editable.querySelector(".task-icon-btn");
      var newText = getEditableNoteText(editable, saveBtn);
      setTaskText(taskId, newText.trim());
    });
  }

  // --- третья вкладка настроек: сама карта на весь экран, со своей
  // внутренней прокруткой. Пояснение ("летопись") — не отдельный блок под
  // сеткой, а первый элемент внутри той же прокрутки, над самой старой
  // неделей: по умолчанию окно открыто прокрученным вниз (к сегодня), так
  // что пояснение видно, только если докрутить ленту до самого верха. ---
  function renderSettingsTabYear(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var built = buildYearGridMarkup();

    var legendHtml =
      '<div class="year-grid-legend-top">' +
        '<div class="year-grid-legend-top-title">Как читать карту</div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell"></span><span>— в этот день отметок нет</span></div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell light"></span><span>— один вид активности: чтение, доп. счётчик, задача цели или выполненная задача</span></div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell dark"></span><span>— два вида активности в один день</span></div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell darkest"></span><span>— три и более видов активности в один день</span></div>' +
      '</div>';

    container.innerHTML =
      '<div class="year-grid-tab-header">' +
        '<div class="year-grid-tab-title">Карта дней года</div>' +
        '<button class="year-grid-active-days-btn" id="yearGridActiveDaysBtn" title="Дней с отметками за последние 365 дней">' + built.activeDays + '</button>' +
      '</div>' +
      '<div class="year-grid-v-scroll" id="yearGridVScroll">' + legendHtml + built.html + '</div>';

    var activeDaysBtn = document.getElementById("yearGridActiveDaysBtn");
    if(activeDaysBtn){
      activeDaysBtn.addEventListener("click", function(e){
        e.stopPropagation();
        if(modalOverlay.classList.contains("open")) return;
        modalBox.innerHTML = modalHeader("Дней с отметками за последние 365 дней: " + built.activeDays);
        bindClose();
        modalOverlay.classList.add("open");
      });
    }

    var scrollHolder = document.getElementById("yearGridVScroll");
    if(scrollHolder){
      scrollHolder.addEventListener("click", function(e){
        var cell = e.target.closest ? e.target.closest("[data-day-ts]") : null;
        if(!cell) return;
        var ts = Number(cell.getAttribute("data-day-ts"));
        if(!isNaN(ts)) renderYearDayDetail(ts);
      });
      // сразу прокручиваем к текущей неделе (в самый низ сетки) — пояснение
      // наверху ленты остаётся скрыто, пока не прокрутить наверх вручную
      requestAnimationFrame(function(){
        scrollHolder.scrollTop = scrollHolder.scrollHeight;
      });
    }
  }

  // если вкладка карты сейчас открыта — перерисовать её немедленно, чтобы
  // только что отмеченное чтение/доп. счётчик/настроение было видно сразу
  function refreshYearGridIfOpen(){
    var yearBtn = document.getElementById("settingsTabYearBtn");
    if(yearBtn && yearBtn.classList.contains("active")) renderSettingsTabYear();
  }

  // ===================== ЛИЧНЫЕ ЦЕЛИ =====================
  // Каждая цель — отдельный уникальный ключ state["goal:<id>"], поэтому
  // объединение между устройствами работает автоматически (та же схема,
  // что у остальных функций). Удаление — c:null с новым временем (как и
  // везде), а не физическое удаление ключа — чтобы не "воскрешать" её при
  // слиянии с ещё не обновившимся устройством.
  var GOAL_DEFAULT_COLOR = "#9370DB";
  var GOAL_COLORS = [
    "#48F78E","#29B6F6","#9370DB","#E06666","#F7C948","#FF9F43",
    "#4ECDC4","#6FA8DC","#FF6FB5","#A0785A","#8E7CC3","#8FD9B8",
    "#D9534F","#B4A7D6","#5DADE2","#F1948A"
  ];
  var GOAL_MAX_TASKS = 20;
  var goalsExpanded = (localStorage.getItem(GOALS_EXPANDED_KEY) !== "0"); // раскрыта ли полоса в режиме "видеть меньше" (сохраняется между перезагрузками)

  function getGoalsReducedView(){
    var r = state["__goalsReducedView"];
    return !!(r && r.c);
  }
  function setGoalsReducedView(value){
    state["__goalsReducedView"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  function escapeHtml(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // экранирует текст (как escapeHtml) и вдобавок оборачивает ссылки
  // (http://, https://, www.) в кликабельные <a target="_blank"> —
  // используется в статичном виде комментария к дню (см.
  // renderYearDayNoteView), где в тексте иногда встречаются ссылки на
  // сторонние сайты. Финальная пунктуация (точка, запятая, скобка и т.п.)
  // сразу после ссылки в саму ссылку не включается — остаётся снаружи
  // тега, как обычным текстом.
  var LINKIFY_URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
  var LINKIFY_TRAIL_RE = /[.,;:!?)\]}'"]+$/;
  function linkifyHtml(s){
    var escaped = escapeHtml(s);
    return escaped.replace(LINKIFY_URL_RE, function(match){
      var trail = "";
      var m = match.match(LINKIFY_TRAIL_RE);
      if(m){
        trail = m[0];
        match = match.slice(0, match.length - trail.length);
      }
      if(!match) return trail;
      var href = /^https?:\/\//i.test(match) ? match : "https://" + match;
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="auto-link">' + match + '</a>' + trail;
    });
  }

  function getAllGoals(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goal:") === 0 && state[k] && state[k].c){
        list.push({id: k.slice(5), data: state[k].c, t: state[k].t});
      }
    });
    list.sort(function(a,b){ return a.t - b.t; });
    return list;
  }
  function getGoalData(goalId){
    var rec = state["goal:" + goalId];
    return (rec && rec.c) ? rec.c : null;
  }
  function saveGoal(goalId, data){
    state["goal:" + goalId] = {c: data, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function deleteGoal(goalId){
    state["goal:" + goalId] = {c: null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function createNewGoal(){
    var id = "g" + Date.now() + Math.random().toString(36).slice(2,7);
    saveGoal(id, {title:"", color: GOAL_DEFAULT_COLOR, tasks: []});
    return id;
  }

  function buildGoalBarEl(goal){
    var bar = document.createElement("div");
    bar.className = "goal-bar";
    var tasks = goal.data.tasks || [];
    var n = tasks.length;
    var checkedCount = tasks.filter(function(t){ return t.checked; }).length;
    var pct = n > 0 ? (checkedCount / n) * 100 : 0;

    var fill = document.createElement("div");
    fill.className = "goal-fill";
    fill.style.width = pct + "%";
    fill.style.backgroundColor = goal.data.color || GOAL_DEFAULT_COLOR;
    bar.appendChild(fill);

    var textEl = document.createElement("div");
    textEl.className = "goal-bar-text";
    textEl.textContent = goal.data.title || "Без названия";
    bar.appendChild(textEl);
    bar.addEventListener("click", function(){ openGoalSettingsModal(goal.id); });
    return bar;
  }

  // По умолчанию бары целей просто стоят в общем потоке рядом с другими
  // барами (тот же стиль, без рамки). Только если явно включён режим
  // "Видеть меньше прогресс-баров" — они переезжают в отдельную
  // полноширинную полосу со сворачивающим треугольником.
  function renderGoalsSection(){
    var inlineList = document.getElementById("goalsListInline");
    var toggleWrap = document.getElementById("goalsToggleWrap");
    var band = document.getElementById("goalsBand");
    var list = document.getElementById("goalsList");
    if(!inlineList || !toggleWrap || !band || !list) return;

    var goals = getAllGoals();
    var reduced = getGoalsReducedView();

    inlineList.innerHTML = "";
    list.innerHTML = "";

    if(goals.length === 0){
      toggleWrap.classList.remove("visible");
      band.classList.remove("reduced-mode");
      return;
    }

    if(reduced){
      toggleWrap.classList.add("visible");
      band.classList.add("reduced-mode");
      band.classList.toggle("open", goalsExpanded);
      var btn = document.getElementById("goalsToggleBtn");
      if(btn) btn.innerHTML = goalsExpanded ? "&#9650;" : "&#9660;";
      goals.forEach(function(g){ list.appendChild(buildGoalBarEl(g)); });
    } else {
      toggleWrap.classList.remove("visible");
      band.classList.remove("reduced-mode");
      goals.forEach(function(g){ inlineList.appendChild(buildGoalBarEl(g)); });
    }
  }

  function renderAddGoalMenu(){
    var row = document.getElementById("addGoalMenuRow");
    if(!row) return;
    row.innerHTML = '<button class="version-history-item" id="addGoalBtn">Добавить для себя цель</button>';
    document.getElementById("addGoalBtn").addEventListener("click", function(){
      var id = createNewGoal();
      renderGoalsSection();
      openGoalSettingsModal(id);
    });
  }

  // --- окно настройки цели: заголовок, цвет, список задач ---
  function openGoalSettingsModal(goalId){
    var goal = getGoalData(goalId);
    if(!goal) return;
    modalBox.innerHTML =
      modalHeader("Настройка цели") +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">' +
        '<input type="text" id="goalTitleInput" placeholder="Заголовок" value="' + escapeHtml(goal.title) + '" ' +
          'style="flex:1;padding:10px;border:1px solid var(--groove-shadow);border-radius:6px;background:#fffef8;color:var(--ink);font-family:inherit;font-size:14px;">' +
        '<div class="goal-color-square" id="goalColorSquare" style="background:' + (goal.color || GOAL_DEFAULT_COLOR) + ';"></div>' +
      '</div>' +
      '<div id="goalTasksList"></div>' +
      '<button class="modal-btn" id="goalAddTaskBtn">Добавить задачу</button>' +
      '<div class="modal-note" id="goalTaskLimitNote" style="text-align:center;"></div>' +
      '<div class="modal-section">' +
        '<button class="modal-btn danger" id="goalDeleteBtn">Удалить эту цель</button>' +
      '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    renderGoalTasksList(goalId);

    document.getElementById("goalTitleInput").addEventListener("input", function(){
      var g = getGoalData(goalId); if(!g) return;
      g.title = this.value;
      saveGoal(goalId, g);
      renderGoalsSection();
    });
    document.getElementById("goalColorSquare").addEventListener("click", function(){ openGoalColorPicker(goalId); });
    document.getElementById("goalAddTaskBtn").addEventListener("click", function(){
      var g = getGoalData(goalId); if(!g) return;
      g.tasks = g.tasks || [];
      if(g.tasks.length >= GOAL_MAX_TASKS) return;
      g.tasks.push({text:"", checked:false});
      saveGoal(goalId, g);
      renderGoalTasksList(goalId);
      renderGoalsSection();
    });
    document.getElementById("goalDeleteBtn").addEventListener("click", function(){
      if(!confirm("Удалить эту цель вместе со всеми задачами?")) return;
      deleteGoal(goalId);
      closeModal();
      renderGoalsSection();
    });
  }

  function renderGoalTasksList(goalId){
    var holder = document.getElementById("goalTasksList");
    if(!holder) return;
    var goal = getGoalData(goalId);
    if(!goal) return;
    var tasks = goal.tasks || [];
    holder.innerHTML = "";
    tasks.forEach(function(task, idx){
      var row = document.createElement("div");
      row.className = "goal-task-row";
      row.innerHTML =
        '<input type="checkbox" data-idx="' + idx + '" class="goalTaskCheckbox"' + (task.checked ? " checked" : "") + '>' +
        '<input type="text" data-idx="' + idx + '" class="goalTaskText" value="' + escapeHtml(task.text) + '" placeholder="Текст задачи">' +
        '<button data-idx="' + idx + '" class="goal-task-remove" title="Убрать задачу">&times;</button>';
      holder.appendChild(row);
    });
    Array.prototype.forEach.call(holder.querySelectorAll(".goalTaskCheckbox"), function(cb){
      cb.addEventListener("change", function(){
        var g = getGoalData(goalId); if(!g) return;
        var idx = Number(cb.getAttribute("data-idx"));
        if(g.tasks[idx]) g.tasks[idx].checked = cb.checked;
        saveGoal(goalId, g);
        renderGoalsSection();
        // отдельная, независимая от самой цели запись — не пропадает из
        // экспорта, даже если цель потом удалят или снимут галочку
        if(cb.checked && g.tasks[idx]){
          var ts = Date.now();
          state["goalcompletion:" + ts + "-" + Math.random().toString(36).slice(2,7)] =
            {c: {goalTitle: g.title || "Без названия", taskText: g.tasks[idx].text || ""}, t: ts};
          saveLocalState();
          scheduleCloudPush();
        }
      });
    });
    Array.prototype.forEach.call(holder.querySelectorAll(".goalTaskText"), function(inp){
      inp.addEventListener("input", function(){
        var g = getGoalData(goalId); if(!g) return;
        var idx = Number(inp.getAttribute("data-idx"));
        if(g.tasks[idx]) g.tasks[idx].text = inp.value;
        saveGoal(goalId, g);
        renderGoalsSection();
      });
    });
    Array.prototype.forEach.call(holder.querySelectorAll(".goal-task-remove"), function(btn){
      btn.addEventListener("click", function(){
        var g = getGoalData(goalId); if(!g) return;
        var idx = Number(btn.getAttribute("data-idx"));
        g.tasks.splice(idx, 1);
        saveGoal(goalId, g);
        renderGoalTasksList(goalId);
        renderGoalsSection();
      });
    });
    updateGoalTaskLimitNote(goalId);
  }

  function updateGoalTaskLimitNote(goalId){
    var goal = getGoalData(goalId);
    var note = document.getElementById("goalTaskLimitNote");
    var addBtn = document.getElementById("goalAddTaskBtn");
    var atMax = goal && (goal.tasks || []).length >= GOAL_MAX_TASKS;
    if(note) note.textContent = atMax ? "Достигнуто максимальное количество задач (" + GOAL_MAX_TASKS + ")." : "";
    if(addBtn) addBtn.style.display = atMax ? "none" : "block";
  }

  function openGoalColorPicker(goalId){
    var buttons = GOAL_COLORS.map(function(c){
      return '<button data-color="' + c + '" style="background:' + c + ';"></button>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Выберите цвет прогресс-бара") +
      '<div class="goal-color-grid">' + buttons + '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-color]"), function(btn){
      btn.addEventListener("click", function(){
        var g = getGoalData(goalId); if(!g) return;
        g.color = btn.getAttribute("data-color");
        saveGoal(goalId, g);
        renderGoalsSection();
        openGoalSettingsModal(goalId);
      });
    });
  }

  var goalsToggleBtn = document.getElementById("goalsToggleBtn");
  if(goalsToggleBtn){
    goalsToggleBtn.addEventListener("click", function(){
      goalsExpanded = !goalsExpanded;
      try{ localStorage.setItem(GOALS_EXPANDED_KEY, goalsExpanded ? "1" : "0"); }catch(e){}
      var band = document.getElementById("goalsBand");
      if(band) band.classList.toggle("open", goalsExpanded);
      goalsToggleBtn.innerHTML = goalsExpanded ? "&#9650;" : "&#9660;";
    });
  }

  // ===================== ВКЛАДКИ ЗАДАЧ: ХРАНЕНИЕ =====================
  // Каждая задача — отдельный ключ "task:<id>" в общем state (та же схема
  // {c:..., t:...}, что и у всего остального — поэтому синхронизация между
  // устройствами и экспорт работают автоматически, без доп. кода).
  // c = {text, tab, checked, checkedAt, completionKey, nextForProjectId, flag}
  //   text            — текст задачи
  //   tab             — вкладка, где реально "живёт" задача (её единственный
  //                     дом: inbox/next/projects/waiting/read/someday — без
  //                     red, см. flag ниже), пока не отмечена (не меняется,
  //                     когда задача уходит в архив — так после извлечения
  //                     она возвращается туда же, откуда была)
  //   checked         — отмечена ли (значит, сейчас показывается в архиве)
  //   checkedAt       — когда отмечена (для сортировки в архиве и как день
  //                     для "Карты дней года")
  //   completionKey   — ключ отдельной вечной записи "taskcompletion:…"
  //                     (см. ниже), которая держит эту отметку в истории/
  //                     экспорте, даже если сама задача потом изменится —
  //                     удаляется (c:null) при извлечении из архива, т.к.
  //                     это отменяет сам факт "выполнения"
  //   nextForProjectId — только у задач во вкладке "next": id задачи-проекта
  //                     (из вкладки "projects"), для которой это next-действие
  //   flag            — цветная отметка слева от чекбокса: null (нет
  //                     отметки, бледно-сиреневый кружок) | "red" | "yellow".
  //                     Вкладка Red — не отдельное хранилище, а витрина:
  //                     показывает ЛЮБУЮ незакрытую задачу с flag "red" или
  //                     "yellow", независимо от того, в какой реальной
  //                     вкладке она живёт (см. getTasksForTab). Поэтому
  //                     отметка задачи выполненной прямо на вкладке Red
  //                     закрывает тот же самый task:<id> — и он пропадает
  //                     отовсюду разом, это одна и та же запись, не копия.
  function genTaskId(){
    return "tk" + Date.now() + Math.random().toString(36).slice(2,7);
  }
  function getAllTasks(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("task:") === 0 && state[k] && state[k].c){
        list.push({id: k.slice(5), c: state[k].c, t: state[k].t});
      }
    });
    list.sort(function(a,b){ return a.t - b.t; });
    return list;
  }
  function getTaskById(id){
    var rec = state["task:" + id];
    if(!rec || !rec.c) return null;
    return {id: id, c: rec.c, t: rec.t};
  }
  function saveTaskData(id, data){
    var rec = state["task:" + id];
    var t = (rec && typeof rec.t === "number") ? rec.t : Date.now();
    state["task:" + id] = {c: data, t: t};
    saveLocalState();
    scheduleCloudPush();
  }
  function createTask(tab){
    var id = genTaskId();
    // на вкладке Red своего хранилища нет (см. пояснение выше) — такая
    // задача реально уходит в inbox, но сразу получает красную отметку,
    // поэтому продолжает быть видна на Red
    var homeTab = (tab === "red") ? "inbox" : tab;
    var flag = (tab === "red") ? "red" : null;
    saveTaskData(id, {text: "", tab: homeTab, checked: false, checkedAt: null, completionKey: null, nextForProjectId: null, flag: flag});
    return id;
  }
  // как createTask, но сразу с готовым текстом — для массового
  // восстановления задач из .txt (см. openTaskImportFileModal)
  function createTaskWithText(tab, text){
    var id = genTaskId();
    var homeTab = (tab === "red") ? "inbox" : tab;
    var flag = (tab === "red") ? "red" : null;
    saveTaskData(id, {text: text, tab: homeTab, checked: false, checkedAt: null, completionKey: null, nextForProjectId: null, flag: flag});
    return id;
  }
  function getTasksForTab(tab){
    if(tab === "red"){
      // витрина: любая незакрытая задача с красной/жёлтой отметкой, из
      // какой бы вкладки она ни была — плюс на всякий случай задачи с
      // «настоящим» tab==="red" (могли остаться из более старой версии
      // данных, когда red ещё была обычным местом хранения)
      return getAllTasks().filter(function(t){
        if(t.c.checked === true) return false;
        return t.c.tab === "red" || t.c.flag === "red" || t.c.flag === "yellow";
      }).sort(function(a,b){
        var pa = a.c.flag === "red" ? 0 : 1;
        var pb = b.c.flag === "red" ? 0 : 1;
        if(pa !== pb) return pa - pb;
        return a.t - b.t;
      });
    }
    return getAllTasks().filter(function(t){ return t.c.tab === tab && t.c.checked !== true; });
  }
  function getArchivedTasksAll(){
    return getAllTasks().filter(function(t){ return t.c.checked === true; })
      .sort(function(a,b){ return (b.c.checkedAt||0) - (a.c.checkedAt||0); });
  }
  // задача во вкладке "projects" считается "без next", если для неё нет ни
  // одной незакрытой (не отмеченной) задачи во вкладке "next", ссылающейся
  // на неё через nextForProjectId — как только такая next-задача отмечена
  // и уходит в архив, проект автоматически снова подсвечивается красным
  function projectHasActiveNext(projectId){
    return getAllTasks().some(function(t){
      return t.c.tab === "next" && t.c.checked !== true && t.c.nextForProjectId === projectId;
    });
  }
  function setTaskText(id, text){
    var task = getTaskById(id);
    if(!task) return;
    task.c.text = text;
    saveTaskData(id, task.c);
  }
  function moveTaskToTab(id, newTab){
    var task = getTaskById(id);
    if(!task || task.c.tab === newTab) return;
    task.c.tab = newTab;
    if(newTab !== "next") task.c.nextForProjectId = null;
    saveTaskData(id, task.c);
  }
  // цветная отметка слева от чекбокса: нет отметки → red → yellow → нет
  // отметки. Возвращает новое значение (null/"red"/"yellow").
  function cycleTaskFlag(id){
    var task = getTaskById(id);
    if(!task) return null;
    var order = [null, "red", "yellow"];
    var idx = order.indexOf(task.c.flag || null);
    var next = order[(idx + 1) % order.length];
    task.c.flag = next;
    saveTaskData(id, task.c);
    return next;
  }
  function checkTaskDone(id){
    var task = getTaskById(id);
    if(!task || task.c.checked) return;
    var ts = Date.now();
    var completionKey = "taskcompletion:" + ts + "-" + Math.random().toString(36).slice(2,7);
    state[completionKey] = {c: {text: task.c.text || "Без названия", tab: task.c.tab}, t: ts};
    task.c.checked = true;
    task.c.checkedAt = ts;
    task.c.completionKey = completionKey;
    saveTaskData(id, task.c);
  }
  function restoreTaskFromArchive(id){
    var task = getTaskById(id);
    if(!task || !task.c.checked) return;
    if(task.c.completionKey){
      state[task.c.completionKey] = {c: null, t: Date.now()};
    }
    task.c.checked = false;
    task.c.checkedAt = null;
    task.c.completionKey = null;
    saveTaskData(id, task.c);
  }
  // полное удаление задачи из архива — без диалога подтверждения (как и
  // просили). Тушим саму запись задачи (c:null, как и везде в этом файле
  // для "мягкого" удаления — ключ остаётся, но getAllTasks/getTaskById
  // её больше не видят), а заодно и её запись в "taskcompletion:…", если
  // она есть — иначе отметка о выполнении осталась бы навсегда висеть в
  // "Карте дней года", хотя самой задачи уже нет.
  function deleteTaskPermanently(id){
    var task = getTaskById(id);
    if(!task) return;
    if(task.c.completionKey){
      state[task.c.completionKey] = {c: null, t: Date.now()};
    }
    state["task:" + id] = {c: null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  // выполненные задачи по дням (ключи "taskcompletion:", не удаляются —
  // используются и в детализации дня "Карты дней года", и в экспорте)
  function getTaskCompletionsByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("taskcompletion:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c) return;
      var day = startOfDay(rec.t);
      (byDay[day] = byDay[day] || []).push(rec.c);
    });
    return byDay;
  }

  // ===================== ВКЛАДКИ ЗАДАЧ: ОТРИСОВКА =====================
  function renderTaskTabList(tabKey){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var tasks = getTasksForTab(tabKey);
    var rowsHtml = tasks.map(function(t){ return buildTaskRowHtml(t); }).join("");
    container.innerHTML =
      '<div class="task-list" id="taskListWrap">' + rowsHtml + '</div>' +
      (tasks.length === 0 ? '<div class="task-empty">Здесь пока нет задач.</div>' : '');
    tasks.forEach(function(t){ bindTaskRow(t.id, tabKey); });

    var fab = document.getElementById("taskAddFab");
    if(fab){
      // при создании новой задачи НЕ перерисовываем список целиком (это
      // на некоторых мобильных браузерах сбивает фокус: клавиатура
      // открывается, но ввод не попадает в поле) — вместо этого просто
      // добавляем одну новую строку в уже существующий список и сразу
      // переключаем именно её в режим редактирования
      fab.onclick = function(){
        flushPendingTaskEdits(); // не потерять то, что уже набрано в другой строке
        var id = createTask(tabKey);
        var wrap = document.getElementById("taskListWrap");
        if(wrap){
          var emptyMsg = document.querySelector(".task-empty");
          if(emptyMsg) emptyMsg.remove();
          var holder = document.createElement("div");
          holder.innerHTML = buildTaskRowHtml(getTaskById(id));
          wrap.appendChild(holder.firstChild);
          bindTaskRow(id, tabKey);
          renderTaskRowEdit(id, tabKey);
        } else {
          renderTaskTabList(tabKey);
          requestAnimationFrame(function(){ renderTaskRowEdit(id, tabKey); });
        }
      };
    }
  }

  function buildTaskRowHtml(task){
    return '<div class="task-row" data-id="' + task.id + '">' +
      '<div class="task-body" data-id="' + task.id + '"></div>' +
      '</div>';
  }

  function bindTaskRow(id, tabKey){
    renderTaskRowView(id, tabKey);
  }

  function renderTaskRowView(id, tabKey){
    var body = document.querySelector('.task-body[data-id="' + id + '"]');
    var task = getTaskById(id);
    if(!body || !task) return;
    var isProjectsTab = task.c.tab === "projects";
    var showRed = isProjectsTab && !projectHasActiveNext(id);
    var placeholder = isProjectsTab ? "Новый проект" : "Новая задача";
    var textHtml = task.c.text ? linkifyHtml(task.c.text) : '<span class="task-text-placeholder">' + placeholder + '</span>';
    var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
    body.innerHTML =
      '<span class="task-text-view' + (showRed ? ' task-text-red' : '') + '">' + textHtml + '</span>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + LINK_NEXT_ICON_SVG + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + task.id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
      '</span>';
    body.querySelector(".task-edit-btn").addEventListener("click", function(){ renderTaskRowEdit(id, tabKey); });
    bindTaskRowActions(body, id, tabKey);
  }

  // кнопки переноса/архивации/next-привязки/приоритета — общие для
  // обычного вида строки (renderTaskRowView) и режима редактирования
  // (renderTaskRowEdit): без явной дискеты сохранения текст сохраняется
  // сам (через flushPendingTaskEdits внутри каждого обработчика), поэтому
  // эти кнопки должны работать одинаково в обоих режимах и не пропадать,
  // пока идёт редактирование
  function bindTaskRowActions(body, id, tabKey){
    var task = getTaskById(id);
    if(!task) return;
    // галочка "в архив" — делает ровно то же, что раньше делала отметка
    // чекбокса (снять её обратно можно только извлечением из архива)
    var doneBtn = body.querySelector(".task-done-btn");
    if(doneBtn){
      doneBtn.addEventListener("click", function(){
        flushPendingTaskEdits();
        checkTaskDone(id); // одна и та же задача — закрывается везде разом
        renderTaskTabList(tabKey || task.c.tab);
      });
    }
    var moveBtn = body.querySelector(".task-move-btn");
    if(moveBtn) moveBtn.addEventListener("click", function(){ openTaskMovePicker(id, tabKey); });
    var nextBtn = body.querySelector(".task-next-btn");
    if(nextBtn) nextBtn.addEventListener("click", function(){ openTaskNextPicker(id, tabKey); });
    var dot = body.querySelector(".task-flag-dot");
    if(dot){
      dot.addEventListener("click", function(e){
        e.stopPropagation();
        flushPendingTaskEdits();
        cycleTaskFlag(id);
        // на самой Red набор и порядок строк зависят от отметки, а на
        // остальных вкладках принадлежность к списку от неё не зависит —
        // но проще и надёжнее везде просто перерисовать вкладку целиком
        renderTaskTabList(tabKey || task.c.tab);
      });
    }
  }

  // редактирование текста задачи — без отдельной дискеты сохранения:
  // задача сохраняется сама, как только поле теряет фокус (клик по любой
  // из соседних кнопок — они по-прежнему на месте, см. bindTaskRowActions
  // — или переход в другое место приложения). Кнопки действия
  // (архивировать/перенести/приоритет и т.д.), в отличие от прежнего
  // варианта, во время редактирования не пропадают — только карандашик,
  // ему тут не место, пока и так идёт редактирование.
  function renderTaskRowEdit(id, tabKey){
    var body = document.querySelector('.task-body[data-id="' + id + '"]');
    var task = getTaskById(id);
    if(!body || !task) return;
    flushPendingTaskEdits(); // если в этот момент редактировалась другая строка — сохранить её
    var isProjectsTab = task.c.tab === "projects";
    var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
    body.innerHTML =
      '<div class="task-editable' + (isProjectsTab ? ' task-editable-project' : '') + '" id="taskEditable_' + id + '" contenteditable="true" data-task-id="' + id + '"></div>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + LINK_NEXT_ICON_SVG + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
      '</span>';
    var editable = document.getElementById("taskEditable_" + id);
    if(!editable) return;
    var textNode = document.createTextNode(task.c.text ? task.c.text : EMPTY_ANCHOR_CHAR);
    editable.appendChild(textNode);

    function updatePlaceholder(){
      var empty = getEditableNoteText(editable).length === 0;
      editable.classList.toggle("is-empty", empty);
    }
    updatePlaceholder();

    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", updatePlaceholder);
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    // setTimeout нужен, чтобы клик по соседней кнопке (архив/перенос/
    // приоритет и т.д.) успел сработать раньше, чем мы перерисуем строку
    // обратно в обычный вид — иначе клик попал бы по уже отсоединённому
    // от DOM элементу. Сами эти кнопки уже сохраняют текст самостоятельно
    // (flushPendingTaskEdits в начале своих обработчиков, см.
    // bindTaskRowActions), так что до срабатывания этого таймера строка
    // обычно уже перерисована ими, и здесь просто нечего делать.
    editable.addEventListener("blur", function(){
      setTimeout(function(){
        if(!editable.isContentEditable || !document.body.contains(editable)) return;
        var newText = getEditableNoteText(editable);
        setTaskText(id, newText.trim());
        renderTaskRowView(id, tabKey);
      }, 0);
    });

    bindTaskRowActions(body, id, tabKey);
  }

  // сетка выбора вкладки-назначения — как у выбора цвета цели
  // (openGoalColorPicker), только квадратики с иконками вкладок
  function openTaskMovePicker(id, tabKey){
    var task = getTaskById(id);
    if(!task) return;
    var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
      var isCurrent = key === task.c.tab;
      return '<button type="button" data-tab="' + key + '"' + (isCurrent ? ' class="current"' : '') + '>' +
        TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Перенести задачу") +
      '<div class="task-picker-grid">' + buttons + '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-tab]"), function(btn){
      btn.addEventListener("click", function(){
        var newTab = btn.getAttribute("data-tab");
        moveTaskToTab(id, newTab);
        closeModal();
        // возвращаемся туда, где реально была открыта карточка (может
        // быть вкладка-витрина Red, а не настоящая домашняя вкладка
        // задачи — см. пояснение у getTasksForTab)
        renderTaskTabList(tabKey || task.c.tab);
      });
    });
  }

  // ===== Восстановление задач из .txt =====
  // Шаг 1: та же сетка вкладок, что и у "Перенести задачу" — здесь
  // пользователь выбирает, в какую вкладку будут добавлены задачи из файла.
  function openTaskImportTabPicker(){
    var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
      return '<button type="button" data-tab="' + key + '">' +
        TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Восстановить задачи из .txt") +
      '<div class="task-picker-grid">' + buttons + '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-tab]"), function(btn){
      btn.addEventListener("click", function(){
        var tabKey = btn.getAttribute("data-tab");
        openTaskImportFileModal(tabKey);
      });
    });
  }
  // Шаг 2: выбор .txt-файла (через системный файловый менеджер) и импорт —
  // отдельные задачи в файле разделены пустой строкой
  function openTaskImportFileModal(tabKey){
    var selectedFile = null;
    modalBox.innerHTML =
      modalHeader("Восстановить задачи из .txt") +
      '<p>Выберите файл в формате .txt</p>' +
      '<p style="opacity:.7;font-size:.9em;margin-top:-8px;">Обратите внимание: задачи должны быть разделены пустой строкой.</p>' +
      '<div class="task-import-file-row">' +
        '<button type="button" class="task-import-attach-btn" id="taskImportAttachBtn" title="Прикрепить файл">' + PAPERCLIP_ICON_SVG + '</button>' +
        '<span id="taskImportFileName" class="task-import-file-name">Файл не выбран</span>' +
      '</div>' +
      '<input type="file" accept=".txt,text/plain" id="taskImportFileInput" style="display:none;">' +
      '<button class="modal-btn primary" id="taskImportSubmitBtn" style="margin-top:14px;" disabled>Импортировать</button>';
    bindClose();
    modalOverlay.classList.add("open");

    var fileInput = document.getElementById("taskImportFileInput");
    var fileNameEl = document.getElementById("taskImportFileName");
    var submitBtn = document.getElementById("taskImportSubmitBtn");

    document.getElementById("taskImportAttachBtn").addEventListener("click", function(){
      fileInput.click();
    });
    fileInput.addEventListener("change", function(){
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      fileNameEl.textContent = selectedFile ? selectedFile.name : "Файл не выбран";
      submitBtn.disabled = !selectedFile;
    });
    submitBtn.addEventListener("click", function(){
      if(!selectedFile) return;
      submitBtn.disabled = true;
      var reader = new FileReader();
      reader.onload = function(){
        var raw = typeof reader.result === "string" ? reader.result : "";
        // задачи разделены пустой строкой (одной или несколькими) —
        // поддерживаем и \n, и \r\n
        var chunks = raw.split(/\r?\n\s*\r?\n/);
        var count = 0;
        chunks.forEach(function(chunk){
          var text = chunk.trim();
          if(!text) return;
          createTaskWithText(tabKey, text);
          count++;
        });
        closeModal();
        if(count > 0){
          openSettingsModal();
          switchSettingsTab(tabKey);
        }
      };
      reader.onerror = function(){
        submitBtn.disabled = false;
      };
      reader.readAsText(selectedFile, "UTF-8");
    });
  }

  // выбор next-действия для задачи-проекта: список текущих незакрытых
  // задач вкладки "next", ещё не привязанных к другому проекту, плюс
  // возможность сразу создать новую next-задачу, привязанную к этому проекту
  // "Все задачи проекта" (кнопка-цепочка на строке проекта) — не
  // отдельное всплывающее окно, а замена содержимого прямо в
  // #settingsTabContent (тот же приём, что и у "Версий", см.
  // renderSettingsTabVersions выше). Отдельной кнопки "назад" нет —
  // возврат к списку проектов происходит так же, как и вход сюда: через
  // повторный клик по язычку "Projects" (switchSettingsTab("projects")
  // безусловно перерисовывает список проектов поверх этого экрана).
  function openTaskNextPicker(projectId, tabKey){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var mode = "linked"; // "linked" — обычный вид (проект + next-задачи),
                          // "attach" — выбор существующей задачи для привязки

    function getLinkedTasks(){
      return getTasksForTab("next").filter(function(t){ return t.c.nextForProjectId === projectId; });
    }
    // "доступные" — любая незакрытая задача, ещё не привязанная ни к
    // одному проекту, из ЛЮБОЙ вкладки-хранилища, кроме "projects" (сам
    // проект не может быть next-действием для другого проекта)
    function getAvailableTasks(){
      return getAllTasks().filter(function(t){
        return t.c.checked !== true && t.c.tab !== "projects" && !t.c.nextForProjectId;
      });
    }

    // ---------- сверху всегда сам проект, ниже — либо привязанные к нему
    // next-задачи (обычный режим), либо список для привязки существующей
    // задачи (режим "attach", включается кнопкой-звеном). Задачи из
    // других списков в обычном режиме не показываются вовсе — только по
    // явному запросу через кнопку-звено. ---------- */
    function render(){
      flushPendingTaskEdits();
      var projectHtml = '<div class="task-row" data-id="' + projectId + '"><div class="task-body" data-id="' + projectId + '"></div></div>';
      var areaHtml;
      if(mode === "attach"){
        var available = getAvailableTasks();
        var availableHtml = available.map(function(t){
          var label = t.c.text ? escapeHtml(t.c.text) : "Без названия";
          return '<button type="button" class="version-history-item" data-avail-id="' + t.id + '">' + label + '</button>';
        }).join("");
        areaHtml = '<div class="task-list">' + availableHtml + '</div>' +
          (available.length === 0 ? '<div class="task-empty">Нет доступных задач.</div>' : '');
      } else {
        var linked = getLinkedTasks();
        var linkedHtml = linked.map(function(t){
          return '<div class="task-row" data-id="' + t.id + '"><div class="task-body" data-id="' + t.id + '"></div></div>';
        }).join("");
        areaHtml = '<div class="task-list">' + linkedHtml + '</div>' +
          (linked.length === 0 ? '<div class="task-empty">Пока нет задач, привязанных к проекту.</div>' : '');
      }
      container.innerHTML =
        '<div class="year-grid-tab-title" style="margin-bottom:12px;">Все задачи проекта</div>' +
        '<div class="task-project-modal-body">' +
          '<div class="task-list task-project-project-row">' + projectHtml + '</div>' +
          '<div class="task-project-area" id="taskProjectArea">' + areaHtml + '</div>' +
        '</div>' +
        '<button type="button" class="task-project-fab task-project-fab-link' + (mode === "attach" ? " active" : "") + '" id="taskProjectLinkFab" title="Прикрепить существующую задачу">' + LINK_NEXT_ICON_SVG + '</button>' +
        '<button type="button" class="task-project-fab task-project-fab-create" id="taskProjectCreateFab" title="Новая задача">+</button>';

      // глобальная "+" (task-add-fab) относится к обычным вкладкам —
      // здесь вместо неё две свои кнопки, поэтому её прячем; она сама
      // вернётся при выходе (switchSettingsTab выставляет видимость
      // заново для каждой вкладки)
      var globalFab = document.getElementById("taskAddFab");
      if(globalFab) globalFab.classList.remove("visible");

      renderRowView(projectId);
      if(mode !== "attach"){
        getLinkedTasks().forEach(function(t){ renderRowView(t.id); });
      }

      if(mode === "attach"){
        Array.prototype.forEach.call(container.querySelectorAll("[data-avail-id]"), function(btn){
          btn.addEventListener("click", function(){
            flushPendingTaskEdits();
            var aid = btn.getAttribute("data-avail-id");
            var t = getTaskById(aid);
            if(!t) return;
            // задача из любой другой вкладки становится next-действием —
            // физически переезжает во "next" (единственная вкладка, где
            // вообще работает nextForProjectId) и сразу привязывается
            if(t.c.tab !== "next") moveTaskToTab(aid, "next");
            var updated = getTaskById(aid);
            updated.c.nextForProjectId = projectId;
            saveTaskData(aid, updated.c);
            mode = "linked";
            render();
          });
        });
      }

      document.getElementById("taskProjectLinkFab").addEventListener("click", function(){
        flushPendingTaskEdits();
        mode = (mode === "attach") ? "linked" : "attach";
        render();
      });

      document.getElementById("taskProjectCreateFab").addEventListener("click", function(){
        flushPendingTaskEdits();
        var nid = createTask("next");
        var t = getTaskById(nid);
        t.c.nextForProjectId = projectId;
        saveTaskData(nid, t.c);
        mode = "linked";
        render();
        renderRowEdit(nid);
      });
    }

    // строка привязанной задачи (и сама строка проекта наверху) — те же
    // пиктограммы и та же логика, что и у обычной строки задачи
    // (renderTaskRowView/bindTaskRowActions), только каждое действие
    // вместо перерисовки вкладки настроек перерисовывает этот же экран
    // (render)
    function renderRowView(id){
      var body = document.querySelector('.task-body[data-id="' + id + '"]');
      var task = getTaskById(id);
      if(!body || !task) return;
      var textHtml = task.c.text ? linkifyHtml(task.c.text) : '<span class="task-text-placeholder">Новая задача</span>';
      var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
      body.innerHTML =
        '<span class="task-text-view">' + textHtml + '</span>' +
        '<span class="task-actions">' +
          '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
          '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
        '</span>';
      body.querySelector(".task-edit-btn").addEventListener("click", function(){ renderRowEdit(id); });
      bindRowActions(body, id);
    }

    // кнопки архива/переноса/приоритета — общие для обычного вида и
    // режима редактирования, чтобы они не пропадали, пока идёт ввод
    // текста (см. renderRowEdit)
    function bindRowActions(body, id){
      var doneBtn = body.querySelector(".task-done-btn");
      if(doneBtn){
        doneBtn.addEventListener("click", function(){
          flushPendingTaskEdits();
          checkTaskDone(id);
          render();
        });
      }
      var moveBtn = body.querySelector(".task-move-btn");
      if(moveBtn) moveBtn.addEventListener("click", function(){ openRowMovePicker(id); });
      var dot = body.querySelector(".task-flag-dot");
      if(dot){
        dot.addEventListener("click", function(e){
          e.stopPropagation();
          flushPendingTaskEdits();
          cycleTaskFlag(id);
          renderRowView(id);
        });
      }
    }

    // редактирование текста — без отдельной дискеты: текст сохраняется
    // сам, как только поле теряет фокус (клик по соседней кнопке — они
    // никуда не пропадают, см. bindRowActions — или уход с экрана).
    function renderRowEdit(id){
      var body = document.querySelector('.task-body[data-id="' + id + '"]');
      var task = getTaskById(id);
      if(!body || !task) return;
      flushPendingTaskEdits();
      var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
      body.innerHTML =
        '<div class="task-editable" id="taskEditable_' + id + '" contenteditable="true" data-task-id="' + id + '"></div>' +
        '<span class="task-actions">' +
          '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
          '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
        '</span>';
      var editable = document.getElementById("taskEditable_" + id);
      if(!editable) return;
      var textNode = document.createTextNode(task.c.text ? task.c.text : EMPTY_ANCHOR_CHAR);
      editable.appendChild(textNode);

      function updatePlaceholder(){
        var empty = getEditableNoteText(editable).length === 0;
        editable.classList.toggle("is-empty", empty);
      }
      updatePlaceholder();

      editable.focus();
      var range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      editable.addEventListener("input", updatePlaceholder);
      editable.addEventListener("keydown", function(e){
        if(e.key === "Enter"){
          e.preventDefault();
          document.execCommand("insertText", false, "\n");
        }
      });

      editable.addEventListener("blur", function(){
        setTimeout(function(){
          if(!editable.isContentEditable || !document.body.contains(editable)) return;
          var newText = getEditableNoteText(editable);
          setTaskText(id, newText.trim());
          renderRowView(id);
        }, 0);
      });

      bindRowActions(body, id);
    }

    // "Перенести" для привязанной задачи — та же сетка вкладок, что и
    // openTaskMovePicker (маленькая всплывающая модалка, как и везде в
    // приложении), но после выбора возвращает не к вкладке настроек, а
    // обратно к этому же экрану "Все задачи проекта"
    function openRowMovePicker(id){
      var task = getTaskById(id);
      if(!task) return;
      var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
        var isCurrent = key === task.c.tab;
        return '<button type="button" data-tab="' + key + '"' + (isCurrent ? ' class="current"' : '') + '>' +
          TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
      }).join("");
      modalBox.innerHTML =
        modalHeader("Перенести задачу") +
        '<div class="task-picker-grid">' + buttons + '</div>';
      bindClose();
      modalOverlay.classList.add("open");
      Array.prototype.forEach.call(modalBox.querySelectorAll("[data-tab]"), function(btn){
        btn.addEventListener("click", function(){
          moveTaskToTab(id, btn.getAttribute("data-tab"));
          closeModal();
          render();
        });
      });
    }

    render();
  }

  // ---------- вкладка "архив": последние TASK_ARCHIVE_MAX_SHOWN отмеченных
  // задач, каждая — с чекбоксом (отмечен), стрелочкой извлечения (возвращает
  // задачу туда, где она была до отметки) и крестиком полного удаления
  // (без диалога подтверждения — тушит саму задачу и её запись в "Карте
  // дней года", см. deleteTaskPermanently). Кнопки "+" здесь нет. ----------
  function renderTaskArchiveTab(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var all = getArchivedTasksAll();
    var shown = all.slice(0, TASK_ARCHIVE_MAX_SHOWN);
    var rowsHtml = shown.map(function(t){
      var label = t.c.text ? escapeHtml(t.c.text) : "Без названия";
      return '<div class="task-archive-row" data-id="' + t.id + '">' +
        '<input type="checkbox" class="task-archive-check" checked disabled>' +
        '<span class="task-archive-text">' + label + '</span>' +
        '<button type="button" class="task-restore-btn" data-id="' + t.id + '" title="Извлечь из архива">' + RESTORE_ICON_SVG + '</button>' +
        '<button type="button" class="task-delete-btn" data-id="' + t.id + '" title="Удалить навсегда">' + DELETE_ICON_SVG + '</button>' +
      '</div>';
    }).join("");
    container.innerHTML =
      '<div class="task-list">' + rowsHtml + '</div>' +
      (shown.length === 0 ? '<div class="task-empty">Архив пуст.</div>' : '');
    Array.prototype.forEach.call(container.querySelectorAll(".task-restore-btn"), function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-id");
        restoreTaskFromArchive(id);
        renderTaskArchiveTab();
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll(".task-delete-btn"), function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-id");
        deleteTaskPermanently(id);
        renderTaskArchiveTab();
      });
    });
  }

  // ===================== ЗАПУСК =====================
  initQuote();
  initPage();
  ensureFirstReadInitialized();
  updateOverallProgress();
  applyThemeToPage(getCurrentThemeId());
  renderThemeDots();
  updateMissedBanner();
  renderVersionHistory();
  renderHourBars();
  renderHourCounterMenu();
  checkHourBoundaries();
  renderMoodPill();
  renderMoodMenu();
  renderGoalsSection();
  renderAddGoalMenu();
  refreshSettingsTabsVisibility();
  setInterval(function(){ updateOverallProgress(); updateMissedBanner(); checkUpdateSnoozeExpiry(); checkHourBoundaries(); renderMoodPill(); refreshYearGridIfOpen(); }, 30 * 60 * 1000);
  checkUpdateSnoozeExpiry();

})();
