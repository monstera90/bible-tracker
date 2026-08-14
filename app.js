(function () {
  "use strict";

  // Данные книг Библии (1189 глав)
  const BIBLE_BOOKS = [
    { name: "Бытие", chapters: 50 }, { name: "Исход", chapters: 40 }, { name: "Левит", chapters: 27 },
    { name: "Числа", chapters: 36 }, { name: "Второзаконие", chapters: 34 }, { name: "Иисус Навин", chapters: 24 },
    { name: "Судьи", chapters: 21 }, { name: "Руфь", chapters: 4 }, { name: "1 Царств", chapters: 31 },
    { name: "2 Царств", chapters: 24 }, { name: "3 Царств", chapters: 22 }, { name: "4 Царств", chapters: 25 },
    { name: "1 Паралипоменон", chapters: 29 }, { name: "2 Паралипоменон", chapters: 36 }, { name: "Ездра", chapters: 10 },
    { name: "Неемия", chapters: 13 }, { name: "Есфирь", chapters: 10 }, { name: "Иов", chapters: 42 },
    { name: "Псалтирь", chapters: 150 }, { name: "Притчи", chapters: 31 }, { name: "Екклесиаст", chapters: 12 },
    { name: "Песнь Песней", chapters: 8 }, { name: "Исаия", chapters: 66 }, { name: "Иеремия", chapters: 52 },
    { name: "Плач Иеремии", chapters: 5 }, { name: "Иезекииль", chapters: 48 }, { name: "Даниил", chapters: 12 },
    { name: "Осия", chapters: 14 }, { name: "Иоиль", chapters: 3 }, { name: "Амос", chapters: 9 },
    { name: "Авдий", chapters: 1 }, { name: "Иона", chapters: 4 }, { name: "Михей", chapters: 7 },
    { name: "Наум", chapters: 3 }, { name: "Аввакум", chapters: 3 }, { name: "Софония", chapters: 3 },
    { name: "Аггей", chapters: 2 }, { name: "Захария", chapters: 14 }, { name: "Малахия", chapters: 4 },
    { name: "От Матфея", chapters: 28 }, { name: "От Марка", chapters: 16 }, { name: "От Луки", chapters: 24 },
    { name: "От Иоанна", chapters: 21 }, { name: "Деяния", chapters: 28 }, { name: "Иакова", chapters: 5 },
    { name: "1 Петра", chapters: 5 }, { name: "2 Петра", chapters: 3 }, { name: "1 Иоанна", chapters: 5 },
    { name: "2 Иоанна", chapters: 1 }, { name: "3 Иоанна", chapters: 1 }, { name: "Иуды", chapters: 1 },
    { name: "Римлянам", chapters: 16 }, { name: "1 Коринфянам", chapters: 16 }, { name: "2 Коринфянам", chapters: 13 },
    { name: "Галатам", chapters: 6 }, { name: "Ефесянам", chapters: 6 }, { name: "Филиппийцам", chapters: 4 },
    { name: "Колоссянам", chapters: 4 }, { name: "1 Фессалоникийцам", chapters: 5 }, { name: "2 Фессалоникийцам", chapters: 3 },
    { name: "1 Тимофею", chapters: 6 }, { name: "2 Тимофею", chapters: 4 }, { name: "Титу", chapters: 3 },
    { name: "Филимону", chapters: 1 }, { name: "Евреям", chapters: 13 }, { name: "Откровение", chapters: 22 }
  ];

  const MOOD_OPTIONS = [
    { emoji: "😊", label: "Радостное" }, { emoji: "😐", label: "Обычное" }, { emoji: "😔", label: "Грустное" },
    { emoji: "🙏", label: "Благодарное" }, { emoji: "🔥", label: "Вдохновленное" }, { emoji: "😴", label: "Уставшее" }
  ];

  const QUOTES = [
    "«Слово Твое — светильник ноге моей и свет стезе моей.» (Пс. 118:105)",
    "«В начале было Слово, и Слово было у Бога, и Слово было Бог.» (Иоан. 1:1)",
    "«Всё Писание богодухновенно и полезно для научения...» (2 Тим. 3:16)"
  ];

  // Состояние приложения
  let appState = {
    chapters: {}, // "BookName_ChIndex": state (1, 2, 3) или true/false
    settings: {
      hideCompleted: false,
      collapseCompleted: false,
      multiColorChapters: false,
      hourTracker: false,
      reducedBars: false,
      theme: "theme-1"
    },
    goals: [], // До 20 личных задач
    hours: {
      currentMonth: "",
      minutesLogged: 0,
      monthlyTargetMinutes: 600,
      history: [] // [{ date: "10.08 12:30", totalMinutes: 120 }]
    },
    moods: {}, // "YYYY-MM-DD": emojiIndex
    collapsedBooks: {}
  };

  // Элементы DOM
  const booksContainer = document.getElementById("booksContainer");
  const xpFill = document.getElementById("xpFill");
  const xpText = document.getElementById("xpText");
  const missedWrap = document.getElementById("missedWrap");
  const missedText = document.getElementById("missedText");
  
  const settingsModalOverlay = document.getElementById("settingsModalOverlay");
  const settingsGearBtn = document.getElementById("settingsGearBtn");
  const resetBtn = document.getElementById("resetBtn");
  
  const settingHideCompleted = document.getElementById("settingHideCompleted");
  const settingCollapseCompleted = document.getElementById("settingCollapseCompleted");
  const settingMultiColorChapters = document.getElementById("settingMultiColorChapters");
  const settingHourTracker = document.getElementById("settingHourTracker");
  const settingReducedBars = document.getElementById("settingReducedBars");

  const tabSettings = document.getElementById("tabSettings");
  const tabMood = document.getElementById("tabMood");
  const tabContentSettings = document.getElementById("tabContentSettings");
  const tabContentMood = document.getElementById("tabContentMood");

  const hourBarWrap = document.getElementById("hourBarWrap");
  const hourBar = document.getElementById("hourBar");
  const hourBarLightFill = document.getElementById("hourBarLightFill");
  const hourBarDarkFill = document.getElementById("hourBarDarkFill");
  const hourBarZoneText = document.getElementById("hourBarZoneText");
  const hourInputOverlay = document.getElementById("hourInputOverlay");
  const hourInputMask = document.getElementById("hourInputMask");
  const hourInputConfirm = document.getElementById("hourInputConfirm");
  const hourInputCancel = document.getElementById("hourInputCancel");
  const hourInputInfo = document.getElementById("hourInputInfo");

  const historyModalOverlay = document.getElementById("historyModalOverlay");
  const historyList = document.getElementById("historyList");
  const historyCloseBtn = document.getElementById("historyCloseBtn");

  const goalsBand = document.getElementById("goalsBand");
  const goalsList = document.getElementById("goalsList");
  const goalsListInline = document.getElementById("goalsListInline");
  const goalsToggleWrap = document.getElementById("goalsToggleWrap");
  const goalsToggleBtn = document.getElementById("goalsToggleBtn");

  const moodStatusBtn = document.getElementById("moodStatusBtn");
  const moodModalOverlay = document.getElementById("moodModalOverlay");
  const moodCheckinGrid = document.getElementById("moodCheckinGrid");
  const moodSaveBtn = document.getElementById("moodSaveBtn");
  const moodCancelBtn = document.getElementById("moodCancelBtn");
  const moodDiagramContainer = document.getElementById("moodDiagramContainer");

  let selectedMoodIndex = null;

  // Инициализация
  function init() {
    loadState();
    applyTheme(appState.settings.theme);
    renderQuote();
    renderBooks();
    renderGoals();
    updateProgress();
    bindEvents();
    setupSyncStatus();
  }

  // Загрузка состояния из localStorage
  function loadState() {
    const saved = localStorage.getItem("bible_tracker_state");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        appState = Object.assign(appState, parsed);
        if (!appState.settings) appState.settings = {};
        if (!appState.goals) appState.goals = [];
        if (!appState.hours) appState.hours = { currentMonth: "", minutesLogged: 0, monthlyTargetMinutes: 600, history: [] };
        if (!appState.hours.history) appState.hours.history = [];
      } catch (e) {
        console.error("Ошибка чтения данных", e);
      }
    }

    // Инициализация чекбоксов настроек
    settingHideCompleted.checked = !!appState.settings.hideCompleted;
    settingCollapseCompleted.checked = !!appState.settings.collapseCompleted;
    settingMultiColorChapters.checked = !!appState.settings.multiColorChapters;
    settingHourTracker.checked = !!appState.settings.hourTracker;
    settingReducedBars.checked = !!appState.settings.reducedBars;
  }

  function saveState() {
    localStorage.setItem("bible_tracker_state", JSON.stringify(appState));
  }

  function applyTheme(themeId) {
    appState.settings.theme = themeId;
    document.documentElement.setAttribute("data-theme", themeId);
    document.querySelectorAll(".theme-dot").forEach(dot => {
      dot.classList.toggle("selected", dot.getAttribute("data-theme-id") === themeId);
    });
    saveState();
  }

  function renderQuote() {
    const qEl = document.getElementById("quote");
    if (qEl) {
      qEl.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      qEl.classList.add("visible");
    }
  }

  // Отрисовка книг
  function renderBooks() {
    booksContainer.innerHTML = "";

    BIBLE_BOOKS.forEach((book, bIdx) => {
      let readCount = 0;
      for (let i = 1; i <= book.chapters; i++) {
        const key = `${book.name}_${i}`;
        if (appState.chapters[key]) readCount++;
      }

      const isFullyRead = readCount === book.chapters;
      if (appState.settings.hideCompleted && isFullyRead) return;

      const isCollapsed = appState.settings.collapseCompleted && isFullyRead 
        ? true 
        : !!appState.collapsedBooks[book.name];

      const card = document.createElement("div");
      card.className = "book-card";

      const pct = Math.round((readCount / book.chapters) * 100);

      card.innerHTML = `
        <div class="book-header ${isCollapsed ? '' : 'expanded'}">
          <div class="book-fill" style="width: ${pct}%"></div>
          <div class="book-header-content">
            <span class="book-name">${book.name}</span>
            <span class="book-count">${readCount}/${book.chapters}</span>
            <div class="toggle-check"><span>›</span></div>
          </div>
        </div>
        <div class="chapters-container ${isCollapsed ? '' : 'open'}">
          <div class="chapters-grid"></div>
        </div>
      `;

      // Вешаем клик на ВЕСЬ заголовок (Пункт 1)
      const headerEl = card.querySelector(".book-header");
      headerEl.addEventListener("click", () => {
        appState.collapsedBooks[book.name] = !appState.collapsedBooks[book.name];
        saveState();
        renderBooks();
      });

      // Генерируем сетку глав
      const gridEl = card.querySelector(".chapters-grid");
      for (let ch = 1; ch <= book.chapters; ch++) {
        const key = `${book.name}_${ch}`;
        const rawVal = appState.chapters[key];

        const item = document.createElement("div");
        item.className = "chapter-item";

        let stateClass = "";
        if (typeof rawVal === "number") {
          stateClass = `state-${rawVal}`;
        } else if (rawVal) {
          stateClass = "state-1";
        }

        if (stateClass) item.classList.add(stateClass);

        item.innerHTML = `
          <input type="checkbox" id="ch_${bIdx}_${ch}" ${rawVal ? 'checked' : ''}>
          <label for="ch_${bIdx}_${ch}">${ch}</label>
        `;

        // Клик по главе (Пункт 2 - Циклическое переключение цвета)
        const inputEl = item.querySelector("input");
        inputEl.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (appState.settings.multiColorChapters) {
            let currentState = typeof appState.chapters[key] === "number" ? appState.chapters[key] : (appState.chapters[key] ? 1 : 0);
            let nextState = (currentState + 1) % 4; // 0 -> 1 (Зеленый) -> 2 (Голубой) -> 3 (Красный) -> 0

            if (nextState === 0) {
              delete appState.chapters[key];
            } else {
              appState.chapters[key] = nextState;
            }
          } else {
            if (appState.chapters[key]) {
              delete appState.chapters[key];
            } else {
              appState.chapters[key] = 1;
            }
          }

          saveState();
          renderBooks();
          updateProgress();
        });

        gridEl.appendChild(item);
      }

      booksContainer.appendChild(card);
    });
  }

  // Обновление общего прогресса
  function updateProgress() {
    let totalRead = 0;
    Object.keys(appState.chapters).forEach(k => {
      if (appState.chapters[k]) totalRead++;
    });

    const totalChapters = 1189;
    const pct = ((totalRead / totalChapters) * 100).toFixed(1);

    xpFill.style.width = `${pct}%`;
    xpText.textContent = `${totalRead} / ${totalChapters} глав (${pct}%)`;

    // Отображение пропусков
    missedWrap.classList.remove("visible");

    // Режим меньшего количества прогресс-баров (Пункт 8)
    if (appState.settings.reducedBars) {
      goalsBand.classList.add("reduced-mode");
      goalsToggleWrap.classList.add("visible");
      goalsListInline.style.display = "none";
    } else {
      goalsBand.classList.remove("reduced-mode");
      goalsToggleWrap.classList.remove("visible");
      goalsListInline.style.display = "flex";
    }

    // Счётчик часов
    if (appState.settings.hourTracker) {
      hourBarWrap.classList.add("visible");
      const mins = appState.hours.minutesLogged || 0;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      hourBarZoneText.textContent = `${h} ч ${m < 10 ? '0' + m : m} мин`;
      hourBarLightFill.style.width = `${Math.min(100, (mins / 600) * 100)}%`;
    } else {
      hourBarWrap.classList.remove("visible");
    }
  }

  // Отрисовка личных целей (До 20 шт. - Пункт 10)
  function renderGoals() {
    const targetContainer = appState.settings.reducedBars ? goalsList : goalsListInline;
    targetContainer.innerHTML = "";

    // Ограничиваем пул до 20 элементов
    if (appState.goals.length < 20) {
      while (appState.goals.length < 20) {
        appState.goals.push({ id: Date.now() + Math.random(), text: "", checked: false, color: "#29B6F6" });
      }
      saveState();
    }

    appState.goals.forEach((goal, idx) => {
      const row = document.createElement("div");
      row.className = "goal-task-row";
      row.innerHTML = `
        <input type="checkbox" ${goal.checked ? 'checked' : ''}>
        <input type="text" value="${goal.text || ''}" placeholder="Задача ${idx + 1}">
      `;

      const checkEl = row.querySelector("input[type=checkbox]");
      const textEl = row.querySelector("input[type=text]");

      checkEl.addEventListener("change", () => {
        appState.goals[idx].checked = checkEl.checked;
        saveState();
      });

      textEl.addEventListener("input", () => {
        appState.goals[idx].text = textEl.value;
        saveState();
      });

      targetContainer.appendChild(row);
    });
  }

  // Обработчики событий
  function bindEvents() {
    // Выбор темы
    document.querySelectorAll(".theme-dot").forEach(dot => {
      dot.addEventListener("click", () => applyTheme(dot.getAttribute("data-theme-id")));
    });

    // Открытие настроек
    settingsGearBtn.addEventListener("click", () => {
      settingsModalOverlay.classList.add("open");
    });

    // Закрытие настроек по клику вне окна
    settingsModalOverlay.addEventListener("click", (e) => {
      if (e.target === settingsModalOverlay) {
        settingsModalOverlay.classList.remove("open");
      }
    });

    // Переключение вкладок в настройках (Пункт 7 - всегда видны)
    tabSettings.addEventListener("click", () => {
      tabSettings.classList.add("active");
      tabSettings.classList.remove("muted");
      tabMood.classList.remove("active");
      tabMood.classList.add("muted");

      tabContentSettings.style.display = "block";
      tabContentMood.style.display = "none";
    });

    tabMood.addEventListener("click", () => {
      tabMood.classList.add("active");
      tabMood.classList.remove("muted");
      tabSettings.classList.remove("active");
      tabSettings.classList.add("muted");

      tabContentSettings.style.display = "none";
      tabContentMood.style.display = "block";
      renderMoodDiagram();
    });

    // Изменение опций
    settingHideCompleted.addEventListener("change", (e) => {
      appState.settings.hideCompleted = e.target.checked;
      saveState();
      renderBooks();
    });

    settingCollapseCompleted.addEventListener("change", (e) => {
      appState.settings.collapseCompleted = e.target.checked;
      saveState();
      renderBooks();
    });

    settingMultiColorChapters.addEventListener("change", (e) => {
      appState.settings.multiColorChapters = e.target.checked;
      saveState();
      renderBooks();
    });

    settingHourTracker.addEventListener("change", (e) => {
      appState.settings.hourTracker = e.target.checked;
      saveState();
      updateProgress();
    });

    settingReducedBars.addEventListener("change", (e) => {
      appState.settings.reducedBars = e.target.checked;
      saveState();
      renderGoals();
      updateProgress();
    });

    // Переключатель сворачивания личных целей (Пункт 8)
    goalsToggleBtn.addEventListener("click", () => {
      goalsBand.classList.toggle("open");
      goalsToggleBtn.classList.toggle("open");
    });

    // Сброс прогресса (Пункт 6)
    resetBtn.addEventListener("click", () => {
      if (confirm("Вы уверены, что хотите сбросить весь прогресс чтения?")) {
        appState.chapters = {};
        saveState();
        renderBooks();
        updateProgress();
        settingsModalOverlay.classList.remove("open");
      }
    });

    // Ввод часов
    hourBar.addEventListener("click", () => {
      hourInputOverlay.classList.add("open");
    });

    hourInputCancel.addEventListener("click", () => {
      hourInputOverlay.classList.remove("open");
    });

    hourInputConfirm.addEventListener("click", () => {
      const val = hourInputMask.value.trim();
      if (val) {
        let addedMins = 0;
        if (val.includes(":")) {
          const parts = val.split(":");
          addedMins = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
        } else {
          addedMins = (parseInt(val) || 0) * 60;
        }

        appState.hours.minutesLogged = (appState.hours.minutesLogged || 0) + addedMins;

        // Фиксация в истории (Пункт 4)
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        appState.hours.history.unshift({
          date: dateStr,
          totalMinutes: appState.hours.minutesLogged
        });

        saveState();
        updateProgress();
        hourInputMask.value = "";
        hourInputOverlay.classList.remove("open");
      }
    });

    // Кнопка i - История часов (Пункт 4)
    hourInputInfo.addEventListener("click", () => {
      renderHoursHistory();
      historyModalOverlay.classList.add("open");
    });

    historyCloseBtn.addEventListener("click", () => {
      historyModalOverlay.classList.remove("open");
    });

    // Трекер настроения
    moodStatusBtn.addEventListener("click", () => {
      renderMoodCheckin();
      moodModalOverlay.classList.add("open");
    });

    moodCancelBtn.addEventListener("click", () => {
      moodModalOverlay.classList.remove("open");
    });

    moodSaveBtn.addEventListener("click", () => {
      if (selectedMoodIndex !== null) {
        const todayKey = new Date().toISOString().split("T")[0];
        appState.moods[todayKey] = selectedMoodIndex;
        moodStatusBtn.textContent = MOOD_OPTIONS[selectedMoodIndex].emoji;
        moodStatusBtn.classList.remove("unlogged");
        saveState();
        moodModalOverlay.classList.remove("open");
      }
    });
  }

  // История времени (Пункт 4)
  function renderHoursHistory() {
    historyList.innerHTML = "";
    if (!appState.hours.history || appState.hours.history.length === 0) {
      historyList.innerHTML = `<div class="version-history-empty">Записей времени пока нет</div>`;
      return;
    }

    appState.hours.history.forEach(item => {
      const h = Math.floor(item.totalMinutes / 60);
      const m = item.totalMinutes % 60;
      const row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML = `
        <span class="history-date">${item.date}</span>
        <span class="history-value">${h} ч ${m < 10 ? '0' + m : m} мин</span>
      `;
      historyList.appendChild(row);
    });
  }

  // Отрисовка выбора настроения
  function renderMoodCheckin() {
    moodCheckinGrid.innerHTML = "";
    selectedMoodIndex = null;

    MOOD_OPTIONS.forEach((opt, idx) => {
      const item = document.createElement("div");
      item.className = "mood-checkin-item";
      item.innerHTML = `
        <span class="emoji">${opt.emoji}</span>
        <span class="label">${opt.label}</span>
      `;
      item.addEventListener("click", () => {
        document.querySelectorAll(".mood-checkin-item").forEach(el => el.classList.remove("selected"));
        item.classList.add("selected");
        selectedMoodIndex = idx;
      });
      moodCheckinGrid.appendChild(item);
    });
  }

  // Диаграмма настроения
  function renderMoodDiagram() {
    moodDiagramContainer.innerHTML = "";
    const keys = Object.keys(appState.moods);

    if (keys.length === 0) {
      moodDiagramContainer.innerHTML = `<div class="mood-diagram-empty">Нет данных о настроении</div>`;
      return;
    }

    const counts = {};
    keys.forEach(k => {
      const val = appState.moods[k];
      counts[val] = (counts[val] || 0) + 1;
    });

    let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;
    Object.keys(counts).forEach(mIdx => {
      const opt = MOOD_OPTIONS[mIdx];
      const pct = Math.round((counts[mIdx] / keys.length) * 100);
      html += `
        <div style="display:flex; align-items:center; gap:10px; font-family:'Segoe UI', sans-serif; font-size:13px;">
          <span>${opt.emoji} ${opt.label}</span>
          <div style="flex:1; height:12px; background:#e9e4d4; border-radius:6px; overflow:hidden;">
            <div style="width:${pct}%; height:100%; background:var(--xp-green);"></div>
          </div>
          <span style="font-weight:bold;">${pct}%</span>
        </div>
      `;
    });
    html += `</div>`;
    moodDiagramContainer.innerHTML = html;
  }

  // Оформление статуса синхронизации
  function setupSyncStatus() {
    const syncBtn = document.getElementById("syncStatusBtn");
    if (syncBtn) {
      syncBtn.addEventListener("click", () => {
        alert("Информация по настройке синхронизации доступна в консоли / инструкции.");
      });
    }
  }

  // Запуск при загрузке страницы
  document.addEventListener("DOMContentLoaded", init);
})();