/* 
   Bible Tracker PWA - Full Production app.js
   Содержит структуру всех 66 книг Библии, управление прогрессом, 
   локальное хранилище и корректный рендеринг карточек.
*/

// База данных всех 66 книг и количества глав
const BIBLE_BOOKS = [
    { name: 'Бытие', chapters: 50 }, { name: 'Исход', chapters: 40 }, { name: 'Левит', chapters: 27 },
    { name: 'Числа', chapters: 36 }, { name: 'Второзаконие', chapters: 34 }, { name: 'Иисус Навин', chapters: 24 },
    { name: 'Судьи', chapters: 21 }, { name: 'Руфь', chapters: 4 }, { name: '1 Царств', chapters: 31 },
    { name: '2 Царств', chapters: 24 }, { name: '3 Царств', chapters: 22 }, { name: '4 Царств', chapters: 25 },
    { name: '1 Паралипоменон', chapters: 29 }, { name: '2 Паралипоменон', chapters: 36 }, { name: 'Ездра', chapters: 10 },
    { name: 'Неемия', chapters: 13 }, { name: 'Есфирь', chapters: 10 }, { name: 'Иов', chapters: 42 },
    { name: 'Псалтирь', chapters: 150 }, { name: 'Притчи', chapters: 31 }, { name: 'Екклесиаст', chapters: 12 },
    { name: 'Песня Песней', chapters: 8 }, { name: 'Исаия', chapters: 66 }, { name: 'Иеремия', chapters: 52 },
    { name: 'Плач Иеремии', chapters: 5 }, { name: 'Иезекииль', chapters: 48 }, { name: 'Даниил', chapters: 12 },
    { name: 'Осия', chapters: 14 }, { name: 'Иоиль', chapters: 3 }, { name: 'Амос', chapters: 9 },
    { name: 'Авдий', chapters: 1 }, { name: 'Иона', chapters: 4 }, { name: 'Михей', chapters: 7 },
    { name: 'Наум', chapters: 3 }, { name: 'Аввакум', chapters: 3 }, { name: 'Софония', chapters: 3 },
    { name: 'Аггей', chapters: 2 }, { name: 'Захария', chapters: 14 }, { name: 'Малахия', chapters: 4 },
    { name: 'От Матфея', chapters: 28 }, { name: 'От Марка', chapters: 16 }, { name: 'От Луки', chapters: 24 },
    { name: 'От Иоанна', chapters: 21 }, { name: 'Деяния', chapters: 28 }, { name: 'Иакова', chapters: 5 },
    { name: '1 Петра', chapters: 5 }, { name: '2 Петра', chapters: 3 }, { name: '1 Иоанна', chapters: 5 },
    { name: '2 Иоанна', chapters: 1 }, { name: '3 Иоанна', chapters: 1 }, { name: 'Иуды', chapters: 1 },
    { name: 'К Римлянам', chapters: 16 }, { name: '1 Коринфянам', chapters: 16 }, { name: '2 Коринфянам', chapters: 13 },
    { name: 'К Галатам', chapters: 6 }, { name: 'К Ефесянам', chapters: 6 }, { name: 'К Филиппийцам', chapters: 4 },
    { name: 'К Колоссянам', chapters: 4 }, { name: '1 Фессалоникийцам', chapters: 5 }, { name: '2 Фессалоникийцам', chapters: 3 },
    { name: '1 Тимофею', chapters: 6 }, { name: '2 Тимофею', chapters: 4 }, { name: 'К Титу', chapters: 3 },
    { name: 'К Филимону', chapters: 1 }, { name: 'К Евреям', chapters: 13 }, { name: 'Откровение', chapters: 22 }
];

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

const state = {
    currentTab: 'schedule',
    customTasks: [],
    logs: []
};

function initApp() {
    loadData();
    setupEventListeners();
    renderAll();
}

function loadData() {
    const savedTasks = localStorage.getItem('bible_tracker_tasks');
    if (savedTasks) {
        try {
            state.customTasks = JSON.parse(savedTasks);
        } catch (e) {
            console.error('Ошибка чтения данных:', e);
            state.customTasks = [];
        }
    }
    
    // Если хранилище пустое — генерируем реальный план чтения из книг Библии
    if (!state.customTasks || state.customTasks.length === 0) {
        state.customTasks = BIBLE_BOOKS.map((book) => ({
            id: book.name,
            title: `${book.name} (глав: ${book.chapters})`,
            completed: false
        }));
        saveData();
    }
}

function saveData() {
    localStorage.setItem('bible_tracker_tasks', JSON.stringify(state.customTasks));
}

function setupEventListeners() {
    const tabButtons = document.querySelectorAll('.nav-tab, [data-tab]');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            if (targetTab) switchTab(targetTab);
        });
    });

    const addTaskBtn = document.getElementById('add-task-btn');
    if (addTaskBtn) {
        addTaskBtn.addEventListener('click', addNewTask);
    }
}

function switchTab(tabName) {
    state.currentTab = tabName;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

    const activeContent = document.getElementById(`tab-${tabName}`);
    if (activeContent) activeContent.classList.add('active');

    const activeTabBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTabBtn) activeTabBtn.classList.add('active');
}

function renderAll() {
    renderTaskList();
    updateProgress();
}

// Гарантирует правильное размещение чекбокса и названия книги внутри карточки
function renderTaskList() {
    const container = document.getElementById('tasks-container') || document.querySelector('.tasks-list');
    if (!container) return;

    container.innerHTML = '';

    if (!state.customTasks || state.customTasks.length === 0) {
        container.innerHTML = '<div class="empty-state">Список пуст</div>';
        return;
    }

    state.customTasks.forEach((item, index) => {
        // Главная обертка плашки
        const row = document.createElement('div');
        row.className = 'task-row' + (item.completed ? ' completed' : '');

        // Чекбокс
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `task-check-${index}`;
        checkbox.checked = !!item.completed;
        checkbox.addEventListener('change', () => toggleTask(index));

        // Название книги/главы
        const label = document.createElement('label');
        label.htmlFor = `task-check-${index}`;
        label.textContent = item.title || item.name || `Книга ${index + 1}`;

        // Кнопка удаления
        const actions = document.createElement('div');
        actions.className = 'task-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon delete';
        deleteBtn.innerHTML = '&#128465;';
        deleteBtn.title = 'Удалить';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTask(index);
        });

        actions.appendChild(deleteBtn);

        // Вкладываем ВСЕ элементы СТРОГО внутрь одного блока row
        row.appendChild(checkbox);
        row.appendChild(label);
        row.appendChild(actions);

        container.appendChild(row);
    });
}

function toggleTask(index) {
    if (state.customTasks[index]) {
        state.customTasks[index].completed = !state.customTasks[index].completed;
        saveData();
        renderTaskList();
        updateProgress();
    }
}

function deleteTask(index) {
    state.customTasks.splice(index, 1);
    saveData();
    renderTaskList();
    updateProgress();
}

function addNewTask() {
    const input = document.getElementById('new-task-input');
    if (!input || !input.value.trim()) return;

    state.customTasks.push({
        id: Date.now(),
        title: input.value.trim(),
        completed: false
    });

    input.value = '';
    saveData();
    renderTaskList();
    updateProgress();
}

function updateProgress() {
    const total = state.customTasks.length;
    const completed = state.customTasks.filter(t => t.completed).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    const progressBar = document.getElementById('overall-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }

    const progressText = document.getElementById('progress-text');
    if (progressText) {
        progressText.textContent = `${percentage}% (${completed} из ${total})`;
    }
}

