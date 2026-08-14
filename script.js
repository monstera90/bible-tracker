document.addEventListener('DOMContentLoaded', () => {
  // Данные канонических книг Библии
  const BIBLE_DATA = [
    { section: "Ветхий Завет", books: [
      { name: "Бытие", chapters: 50 },
      { name: "Исход", chapters: 40 },
      { name: "Левит", chapters: 27 },
      { name: "Числа", chapters: 36 },
      { name: "Второзаконие", chapters: 34 },
      { name: "Иисус Навин", chapters: 24 },
      { name: "Судьи", chapters: 21 },
      { name: "Руфь", chapters: 4 },
      { name: "1-я Царств", chapters: 31 },
      { name: "2-я Царств", chapters: 24 },
      { name: "3-я Царств", chapters: 22 },
      { name: "4-я Царств", chapters: 25 },
      { name: "1-я Паралипоменон", chapters: 29 },
      { name: "2-я Паралипоменон", chapters: 36 },
      { name: "Ездра", chapters: 10 },
      { name: "Неемия", chapters: 13 },
      { name: "Есфирь", chapters: 10 },
      { name: "Иов", chapters: 42 },
      { name: "Псалтирь", chapters: 150 },
      { name: "Притчи", chapters: 31 },
      { name: "Екклесиаст", chapters: 12 },
      { name: "Песнь Песней", chapters: 8 },
      { name: "Исаия", chapters: 66 },
      { name: "Иеремия", chapters: 52 },
      { name: "Плач Иеремии", chapters: 5 },
      { name: "Иезекииль", chapters: 48 },
      { name: "Даниил", chapters: 12 },
      { name: "Осия", chapters: 14 },
      { name: "Иоиль", chapters: 3 },
      { name: "Амос", chapters: 9 },
      { name: "Авдий", chapters: 1 },
      { name: "Иона", chapters: 4 },
      { name: "Михей", chapters: 7 },
      { name: "Наум", chapters: 3 },
      { name: "Аввакум", chapters: 3 },
      { name: "Софония", chapters: 3 },
      { name: "Аггей", chapters: 2 },
      { name: "Захария", chapters: 14 },
      { name: "Малахия", chapters: 4 }
    ]},
    { section: "Новый Завет", books: [
      { name: "От Матфея", chapters: 28 },
      { name: "От Марка", chapters: 16 },
      { name: "От Луки", chapters: 24 },
      { name: "От Иоанна", chapters: 21 },
      { name: "Деяния", chapters: 28 },
      { name: "Иакова", chapters: 5 },
      { name: "1-е Петра", chapters: 5 },
      { name: "2-е Петра", chapters: 3 },
      { name: "1-е Иоанна", chapters: 5 },
      { name: "2-е Иоанна", chapters: 1 },
      { name: "3-е Иоанна", chapters: 1 },
      { name: "Иуды", chapters: 1 },
      { name: "Римлянам", chapters: 16 },
      { name: "1-е Коринфянам", chapters: 16 },
      { name: "2-е Коринфянам", chapters: 13 },
      { name: "Галатам", chapters: 6 },
      { name: "Ефесянам", chapters: 6 },
      { name: "Филиппийцам", chapters: 4 },
      { name: "Колоссянам", chapters: 4 },
      { name: "1-е Фессалоникийцам", chapters: 5 },
      { name: "2-е Фессалоникийцам", chapters: 3 },
      { name: "1-е Тимофею", chapters: 6 },
      { name: "2-е Тимофею", chapters: 4 },
      { name: "Титу", chapters: 3 },
      { name: "Филимону", chapters: 1 },
      { name: "Евреям", chapters: 13 },
      { name: "Откровение", chapters: 22 }
    ]}
  ];

  const QUOTES = [
    "«Слово Твое — светильник ноге моей и свет стезе моей.» (Псалом 118:105)",
    "«Всякое Слово Бога чисто; Он — щит уповающим на Него.» (Притчи 30:5)",
    "«Навек, Господи, слово Твое утверждено на небесах.» (Псалом 118:89)",
    "«Трава засыхает, цвет увядает, а слово Бога нашего пребудет вечно.» (Исаия 40:8)"
  ];

  const THEMES = [
    { id: "1", color: "#efe2c2", title: "Пергамент" },
    { id: "2", color: "#eef3ea", title: "Олива" },
    { id: "3", color: "#fdf1f2", title: "Роза" },
    { id: "4", color: "#f6f2fa", title: "Лаванда" },
    { id: "5", color: "#fdf8e4", title: "Золото" },
    { id: "6", color: "#f7eeee", title: "Серебро" },
    { id: "7", color: "#f6f1e4", title: "Бирюза" }
  ];

  const TOTAL_CHAPTERS = 1189;
  let state = JSON.parse(localStorage.getItem('bible_reading_state')) || {};

  const container = document.getElementById('bibleContainer');
  const overallFill = document.getElementById('overallFill');
  const overallText = document.getElementById('overallText');
  const resetBtn = document.getElementById('resetBtn');
  const themeDots = document.getElementById('themeDots');
  const quoteElem = document.getElementById('headerQuote');

  // Отрисовка случайной цитаты
  if (quoteElem) {
    quoteElem.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    setTimeout(() => quoteElem.classList.add('visible'), 100);
  }

  // Генерация книг и глав
  function renderBible() {
    container.innerHTML = '';
    
    BIBLE_DATA.forEach(group => {
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = group.section;
      container.appendChild(label);

      group.books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';

        const header = document.createElement('div');
        header.className = 'book-header';

        const fill = document.createElement('div');
        fill.className = 'book-fill';
        fill.id = `fill-${book.name}`;

        const content = document.createElement('div');
        content.className = 'book-header-content';

        const name = document.createElement('div');
        name.className = 'book-name';
        name.textContent = book.name;

        const count = document.createElement('div');
        count.className = 'book-count';
        count.id = `count-${book.name}`;

        const toggle = document.createElement('div');
        toggle.className = 'toggle-check';
        toggle.innerHTML = '<span>›</span>';

        content.appendChild(name);
        content.appendChild(count);
        content.appendChild(toggle);

        header.appendChild(fill);
        header.appendChild(content);

        const chaptersContainer = document.createElement('div');
        chaptersContainer.className = 'chapters-container';

        const grid = document.createElement('div');
        grid.className = 'chapters-grid';

        for (let i = 1; i <= book.chapters; i++) {
          const key = `${book.name}_${i}`;
          const item = document.createElement('div');
          item.className = 'chapter-item';

          const input = document.createElement('input');
          input.type = 'checkbox';
          input.id = key;
          input.checked = !!state[key];

          const inputLabel = document.createElement('label');
          inputLabel.htmlFor = key;
          inputLabel.textContent = i;

          input.addEventListener('change', () => {
            state[key] = input.checked;
            saveState();
            updateProgress();
          });

          item.appendChild(input);
          item.appendChild(inputLabel);
          grid.appendChild(item);
        }

        chaptersContainer.appendChild(grid);

        header.addEventListener('click', () => {
          const isOpen = chaptersContainer.classList.contains('open');
          header.classList.toggle('expanded', !isOpen);
          chaptersContainer.classList.toggle('open', !isOpen);
        });

        card.appendChild(header);
        card.appendChild(chaptersContainer);
        container.appendChild(card);
      });
    });
  }

  function saveState() {
    localStorage.setItem('bible_reading_state', JSON.stringify(state));
  }

  function updateProgress() {
    let checkedTotal = 0;

    BIBLE_DATA.forEach(group => {
      group.books.forEach(book => {
        let checkedBook = 0;
        for (let i = 1; i <= book.chapters; i++) {
          if (state[`${book.name}_${i}`]) {
            checkedBook++;
          }
        }
        checkedTotal += checkedBook;

        const percentBook = (checkedBook / book.chapters) * 100;
        const fillElem = document.getElementById(`fill-${book.name}`);
        const countElem = document.getElementById(`count-${book.name}`);

        if (fillElem) fillElem.style.width = `${percentBook}%`;
        if (countElem) countElem.textContent = `${checkedBook} / ${book.chapters}`;
      });
    });

    const overallPercent = ((checkedTotal / TOTAL_CHAPTERS) * 100).toFixed(1);
    if (overallFill) overallFill.style.width = `${overallPercent}%`;
    if (overallText) overallText.textContent = `${checkedTotal} из ${TOTAL_CHAPTERS} глав (${overallPercent}%)`;
  }

  // Сброс прогресса
  resetBtn.addEventListener('click', () => {
    if (confirm("Вы уверены, что хотите сбросить весь отмеченный прогресс чтения?")) {
      state = {};
      saveState();
      renderBible();
      updateProgress();
    }
  });

  // Палитра тем
  function renderThemes() {
    themeDots.innerHTML = '';
    const currentTheme = localStorage.getItem('bible_theme') || '1';
    document.documentElement.setAttribute('data-theme', currentTheme);

    THEMES.forEach(t => {
      const dot = document.createElement('button');
      dot.className = `theme-dot ${t.id === currentTheme ? 'selected' : ''}`;
      dot.style.backgroundColor = t.color;
      dot.title = t.title;

      dot.addEventListener('click', () => {
        document.documentElement.setAttribute('data-theme', t.id);
        localStorage.setItem('bible_theme', t.id);
        renderThemes();
      });

      themeDots.appendChild(dot);
    });
  }

  // Модальные окна (шестеренка и синхронизация)
  const settingsBtn = document.getElementById('settingsGearBtn');
  const settingsModal = document.getElementById('settingsModal');
  const syncBtn = document.getElementById('syncBtn');
  const syncModal = document.getElementById('syncModal');
  const syncCloseBtn = document.getElementById('syncCloseBtn');

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => settingsModal.classList.add('open'));
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('open');
    });
  }

  if (syncBtn && syncModal) {
    syncBtn.addEventListener('click', () => syncModal.classList.add('open'));
    syncCloseBtn.addEventListener('click', () => syncModal.classList.remove('open'));
  }

  // Переключение вкладок в настройках
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      document.getElementById('tabGeneral').style.display = target === 'general' ? 'block' : 'none';
      document.getElementById('tabGoals').style.display = target === 'goals' ? 'block' : 'none';
    });
  });

  // Инициализация
  renderBible();
  updateProgress();
  renderThemes();
});
