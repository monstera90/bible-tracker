/* ===========================================================================
   notifications.js
   Версия: 2.1 (19.09) — плашка: высота пузырей = высота кнопок крестик/галочка
   (замер в момент показа, CSS-переменная --rb); затемнения нет (клик мимо — по
   документу, гасится и означает отмену); плашка стоит НАД кнопкой-часами задачи
   (opts.anchorEl из my.js), серединой ровно над ней, смещается только если у
   края экрана не помещается; следует за прокруткой; нет якоря — как раньше у
   нижнего края/над клавиатурой.
   Версия: 2.0 (19.09) — структурная правка: диалог напоминания переделан из
   модального окна в компактную плашку (как единая плашка-подтверждение
   openAppConfirmBar в my.js): прижата к правому краю, стоит над клавиатурой
   (если она открыта) либо у нижнего края, затемнение позади. Ряд слева
   направо: круглый пузырь даты (иконка календаря, после выбора — число), овальный
   пузырь времени (иконка часов, после выбора — 8:00/23:00), крестик-отмена,
   галочка-сохранить. Клик мимо (по затемнению) = крестик. Кнопки «Удалить
   напоминание» в плашке нет — напоминание снимается долгим нажатием на часы в строке
   задачи. Новые внутренние функции: closeBar, placeBar.
   Версия: 1.0 (19.09) — новый файл. ТЗ пользователя от 19.09: напоминание для
   задачи на конкретные дату и время. ВСЕ уведомления приложения (в том числе
   будущие) живут в этом файле — my.js лишь хранит поле задачи и рисует
   пиктограмму-часы.

   Что здесь есть сейчас:
   1) Плашка выбора даты и времени (openReminderDialog). Два пузыря
      «Дата»/«Время»; по нажатию открывается НАТИВНОЕ окно Android (календарь /
      часы — как в приложениях Google), поэтому свой календарь не пишем.
      Скрытые <input type="date">/<input type="time"> лежат в самой плашке,
      showPicker() зовётся прямо из клика по кнопке (нужен жест пользователя).
   2) Планировщик (start/schedule/tick): раз в ≤30 сек и точно к ближайшему
      сроку проверяет задачи с полем c.remindAt (мс, локальное время) и
      показывает уведомление. Проверка также срабатывает при возврате в
      приложение (visibilitychange/focus/pageshow) и при запуске — так
      просроченные, пока приложение было закрыто, напоминания показываются
      при первом же открытии.
   3) Показ: системное уведомление через ServiceWorkerRegistration.
      showNotification (единственный способ на Android), если разрешение
      выдано; иначе — плашка внутри приложения (showBanner).
   4) Клик по уведомлению: sw.js (notificationclick) кладёт id задачи во
      временный кэш "reminder-click-temp" и будит страницу сообщением
      REMINDER_CLICK; страница забирает запись (consumePendingClick) и
      открывает вкладку с задачей через деп openTaskFromReminder — тот же
      приём, что у share-target (кэш вместо адресной строки, чтобы холодный
      запуск работал офлайн).

   ⚠️ Ограничение платформы: без своего сервера PWA не может гарантированно
   показать уведомление в точное время, когда приложение ПОЛНОСТЬЮ закрыто
   (запланированные уведомления Chrome не поддерживает, push требует
   серверной части). Пока приложение открыто/в фоне — срабатывает вовремя; при
   закрытом — при следующем открытии. Доставка при закрытом приложении —
   отдельная задача (нужен серверный компонент).

   Данные: c.remindAt у задачи (число, мс; null/нет — напоминания нет).
   Какие уведомления УЖЕ показаны — localStorage "taskRemindersFired_v1"
   ({id: remindAt}, только на этом устройстве): если срок поменяли — значение
   отличается и уведомление сработает заново.

   Контракт deps: modalBox, modalOverlay, modalHeader, bindClose, closeModal
   (после v2.0 плашкой не используются, оставлены для совместимости),
   getRemindableTasks() -> [{id, c}], openTaskFromReminder(id).
   Экспорт: start, schedule, openReminderDialog, formatReminder, isSupported,
   showBanner.
   =========================================================================== */

window.initNotificationsModule = function(deps){
  "use strict";
  var modalBox = deps.modalBox;
  var modalOverlay = deps.modalOverlay;
  var modalHeader = deps.modalHeader;
  var bindClose = deps.bindClose;
  var closeModal = deps.closeModal;
  var getRemindableTasks = deps.getRemindableTasks;
  var openTaskFromReminder = deps.openTaskFromReminder || function(){};

  var FIRED_KEY = "taskRemindersFired_v1";
  var FIRED_KEEP_MS = 60 * 24 * 60 * 60 * 1000; // забываем записи старше ~двух месяцев
  var CLICK_CACHE = "reminder-click-temp";      // то же имя в sw.js
  var CLICK_KEY = "click";
  var TICK_MAX_MS = 30000;
  var MAX_SINGLE_NOTIFICATIONS = 8;
  var LATE_MS = 2 * 60 * 1000;                  // «просрочено» — дописываем исходное время

  function log(msg){
    if(window.Debug && window.Debug.log) window.Debug.log("notifications: " + msg);
  }

  // ---------------------------------------------------------------- время

  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function toDateValue(ts){
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function toTimeValue(ts){
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  // "YYYY-MM-DD" + "HH:MM" -> мс (локальное время устройства); NaN при мусоре
  function parseLocal(dateStr, timeStr){
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    var tm = /^(\d{2}):(\d{2})/.exec(timeStr || "");
    if(!dm || !tm) return NaN;
    return new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0).getTime();
  }
  function formatDateLong(ts){
    try{
      return new Date(ts).toLocaleDateString("ru-RU", {weekday: "short", day: "numeric", month: "long", year: "numeric"});
    }catch(e){ return toDateValue(ts); }
  }
  // короткая подпись для подсказки кнопки и текста уведомления: «19 сентября, 15:30»
  // (год добавляется, только если он не текущий)
  function formatReminder(ts){
    var d = new Date(ts);
    var opts = {day: "numeric", month: "long"};
    if(d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    var datePart;
    try{ datePart = d.toLocaleDateString("ru-RU", opts); }catch(e){ datePart = toDateValue(ts); }
    return datePart + ", " + toTimeValue(ts);
  }
  // ближайший «круглый» час — стартовое значение для нового напоминания
  function defaultTimestamp(){
    var d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
  }

  // ------------------------------------------------------- разрешение/показ

  function isSupported(){ return typeof Notification !== "undefined"; }

  function requestPermissionIfNeeded(){
    if(!isSupported()) return;
    if(Notification.permission === "default"){
      // вызывается из клика «Сохранить» — это жест пользователя
      try{
        var p = Notification.requestPermission();
        if(p && p.then){
          p.then(function(result){
            if(result !== "granted") showBanner("Уведомления не разрешены — напоминание покажется только внутри приложения.");
          });
        }
      }catch(e){ log("requestPermission: " + (e && e.message ? e.message : e)); }
    }else if(Notification.permission === "denied"){
      showBanner("Уведомления запрещены в настройках браузера — напоминание покажется только внутри приложения.");
    }
  }

  var bannerEl = null, bannerTimer = null;
  function hideBanner(){
    if(bannerTimer){ clearTimeout(bannerTimer); bannerTimer = null; }
    if(bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }
  // плашка внутри приложения: запасной путь, когда системное уведомление
  // недоступно; onTap (необязательный) — например, открыть задачу
  function showBanner(text, onTap, sticky){
    hideBanner();
    bannerEl = document.createElement("div");
    bannerEl.className = "app-reminder-banner";
    bannerEl.textContent = text;
    bannerEl.addEventListener("click", function(){
      hideBanner();
      if(onTap) onTap();
    });
    document.body.appendChild(bannerEl);
    if(!sticky) bannerTimer = setTimeout(hideBanner, 8000);
  }

  function cleanText(text){
    var t = String(text || "").replace(/!\[\[[^\]]*\]\]/g, "[изображение]").replace(/\s+/g, " ").trim();
    if(!t) return "Задача без названия";
    return t.length > 140 ? t.slice(0, 137) + "…" : t;
  }

  function showSystemNotification(title, options){
    var canUseSw = "serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:");
    if(canUseSw){
      // ready может не разрешиться, если воркер не зарегистрирован — не ждём дольше 3 сек
      var timeout = new Promise(function(_, reject){ setTimeout(function(){ reject(new Error("sw not ready")); }, 3000); });
      return Promise.race([navigator.serviceWorker.ready, timeout]).then(function(reg){
        return reg.showNotification(title, options);
      });
    }
    return new Promise(function(resolve){
      var n = new Notification(title, options);
      n.onclick = function(){
        try{ window.focus(); }catch(e){}
        if(options.data && options.data.taskId) openTaskFromReminder(options.data.taskId);
        n.close();
      };
      resolve();
    });
  }

  function notifyTask(task, at){
    var id = task.id;
    var body = cleanText(task.c && task.c.text);
    if(Date.now() - at > LATE_MS) body += "\n(" + formatReminder(at) + ")";
    var canSystem = isSupported() && Notification.permission === "granted";
    var fallback = function(){
      showBanner("Напоминание: " + body, function(){ openTaskFromReminder(id); }, true);
    };
    if(!canSystem){ fallback(); return; }
    showSystemNotification("Напоминание", {
      body: body,
      tag: "task-reminder-" + id,
      icon: "./icon-192x192.png",
      badge: "./icon-192x192.png",
      data: {taskId: id},
      requireInteraction: true
    }).catch(function(e){
      log("showNotification: " + (e && e.message ? e.message : e));
      fallback();
    });
  }

  // ------------------------------------------------------------ планировщик

  function loadFired(){
    try{
      var raw = localStorage.getItem(FIRED_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === "object") ? obj : {};
    }catch(e){ return {}; }
  }
  function saveFired(obj){
    try{ localStorage.setItem(FIRED_KEY, JSON.stringify(obj)); }catch(e){}
  }
  function getRemindAt(task){
    var v = task && task.c ? task.c.remindAt : null;
    return (typeof v === "number" && isFinite(v) && v > 0) ? v : null;
  }

  var timer = null;

  function schedule(){
    if(timer){ clearTimeout(timer); timer = null; }
    var now = Date.now();
    var fired = loadFired();
    var nextDue = null;
    var tasks = [];
    try{ tasks = getRemindableTasks() || []; }catch(e){}
    tasks.forEach(function(t){
      var at = getRemindAt(t);
      if(at == null || (t.c && t.c.checked === true) || fired[t.id] === at) return;
      if(nextDue == null || at < nextDue) nextDue = at;
    });
    var delay = TICK_MAX_MS;
    if(nextDue != null) delay = Math.min(Math.max(nextDue - now, 500), TICK_MAX_MS);
    timer = setTimeout(tick, delay);
  }

  function tick(){
    var now = Date.now();
    var fired = loadFired();
    var changed = false;
    var due = [];
    var tasks = [];
    try{ tasks = getRemindableTasks() || []; }catch(e){}
    tasks.forEach(function(t){
      var at = getRemindAt(t);
      if(at == null || (t.c && t.c.checked === true)) return;
      if(at <= now && fired[t.id] !== at) due.push({task: t, at: at});
    });
    Object.keys(fired).forEach(function(k){
      if(typeof fired[k] !== "number" || fired[k] < now - FIRED_KEEP_MS){ delete fired[k]; changed = true; }
    });
    due.sort(function(a, b){ return a.at - b.at; });
    // помечаем «показано» ДО показа — повторный tick не продублирует
    due.forEach(function(d){ fired[d.task.id] = d.at; changed = true; });
    if(changed) saveFired(fired);
    due.slice(0, MAX_SINGLE_NOTIFICATIONS).forEach(function(d){ notifyTask(d.task, d.at); });
    if(due.length > MAX_SINGLE_NOTIFICATIONS){
      showBanner("Ещё напоминаний: " + (due.length - MAX_SINGLE_NOTIFICATIONS), null, true);
    }
    schedule();
  }

  // ----------------------------------------------------- клик по уведомлению

  function consumePendingClick(){
    if(!("caches" in window) || !window.caches) return;
    caches.open(CLICK_CACHE).then(function(cache){
      return cache.match(CLICK_KEY).then(function(resp){
        if(!resp) return;
        return resp.json().then(function(data){
          cache.delete(CLICK_KEY);
          if(data && data.taskId) openTaskFromReminder(data.taskId);
        });
      });
    }).catch(function(e){ log("consumePendingClick: " + (e && e.message ? e.message : e)); });
  }

  var started = false;
  function start(){
    if(started) return;
    started = true;
    document.addEventListener("visibilitychange", function(){ if(!document.hidden) tick(); });
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);
    if("serviceWorker" in navigator){
      navigator.serviceWorker.addEventListener("message", function(event){
        if(event.data && event.data.type === "REMINDER_CLICK") consumePendingClick();
      });
    }
    consumePendingClick();
    tick();
  }

  // ------------------------------------------------------------------ плашка

  var ICON_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"></path></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>';
  var ICON_CALENDAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2"></rect><path d="M4 10h16"></path><path d="M8 3.5V7"></path><path d="M16 3.5V7"></path></svg>';

  // те же отступы, что у единой плашки-подтверждения в my.js (openAppConfirmBar)
  var BAR_BOTTOM_NO_KB_PX = 59; // 47px системная плашка + 12px зазор
  var BAR_GAP_PX = 10;          // зазор над клавиатурой
  var barEl = null, barCleanup = null;

  function closeBar(){
    if(barCleanup){ barCleanup(); barCleanup = null; }
    if(barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl);
    barEl = null;
  }

  // Положение плашки. Есть якорь (кнопка-часы): середина плашки ровно над
  // серединой кнопки, смещаем по горизонтали только если у края экрана не
  // помещается; по вертикали — прямо над кнопкой, а если сверху нет места —
  // под ней. Якоря нет (или он пропал из DOM) — у нижнего края / над клавиатурой.
  var EDGE_PX = 8;      // минимальный зазор до края экрана
  var ANCHOR_GAP_PX = 6;
  function placeBar(el, anchor){
    var kbTop = (window.AppKeyboard && window.AppKeyboard.getTop) ? window.AppKeyboard.getTop() : null;
    var vw = window.innerWidth, vh = window.innerHeight;
    var limitBottom = (kbTop != null) ? kbTop : vh;
    var r = (anchor && anchor.isConnected) ? anchor.getBoundingClientRect() : null;
    if(!r || (r.width === 0 && r.height === 0)){
      var bottom = (kbTop != null)
        ? Math.max(0, vh - kbTop) + BAR_GAP_PX
        : BAR_BOTTOM_NO_KB_PX;
      el.style.left = "auto";
      el.style.right = "8px";
      el.style.top = "auto";
      el.style.bottom = Math.round(bottom) + "px";
      return;
    }
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = r.left + r.width / 2 - w / 2;
    left = Math.max(EDGE_PX, Math.min(left, vw - w - EDGE_PX));
    var top = r.top - ANCHOR_GAP_PX - h;
    if(top < EDGE_PX) top = r.bottom + ANCHOR_GAP_PX;               // сверху не влезает — под кнопкой
    if(top + h > limitBottom - EDGE_PX) top = Math.max(EDGE_PX, limitBottom - EDGE_PX - h);
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
  }

  function openNativePicker(input){
    try{
      if(typeof input.showPicker === "function"){ input.showPicker(); return; }
    }catch(e){}
    try{ input.focus(); input.click(); }catch(e){}
  }

  // opts: {anchorEl (кнопка-часы|null), currentTs (число|null), onSave(ts), onClear()} — onClear сейчас не
  // вызывается (кнопки «Удалить» в плашке нет), оставлен в контракте
  function openReminderDialog(opts){
    closeBar();
    var hasCurrent = typeof opts.currentTs === "number" && opts.currentTs > 0;
    // пока ничего не выбрано — в пузырях иконки; у стоящего напоминания — его значения
    var selDate = hasCurrent ? toDateValue(opts.currentTs) : "";
    var selTime = hasCurrent ? toTimeValue(opts.currentTs) : "";

    var bar = document.createElement("div");
    bar.className = "app-confirm-bar app-reminder-bar";
    var anchor = opts.anchorEl || null;
    bar.setAttribute("role", "dialog");
    bar.innerHTML =
      '<button type="button" class="reminder-bubble reminder-bubble-date" id="mRemDateBtn" title="Дата"></button>' +
      '<button type="button" class="reminder-bubble reminder-bubble-time" id="mRemTimeBtn" title="Время"></button>' +
      '<button type="button" class="mdeditor-fab-btn" id="mRemCancel" title="Отмена">' + ICON_CROSS + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="mRemSave" title="Сохранить">' + ICON_CHECK + '</button>' +
      '<input type="date" class="reminder-hidden-input" id="mRemDateInput" tabindex="-1" aria-hidden="true">' +
      '<input type="time" class="reminder-hidden-input" id="mRemTimeInput" tabindex="-1" aria-hidden="true">';
    document.body.appendChild(bar);
    barEl = bar;
    // высота пузырей = высота кнопок крестик/галочка (их размер задаёт
    // .mdeditor-fab-btn в components.css) — замеряем и отдаём в CSS
    var fabH = bar.querySelector("#mRemCancel").getBoundingClientRect().height;
    if(fabH > 0) bar.style.setProperty("--rb", Math.round(fabH * 10) / 10 + "px");

    var dateBtn = bar.querySelector("#mRemDateBtn");
    var timeBtn = bar.querySelector("#mRemTimeBtn");
    var dateInput = bar.querySelector("#mRemDateInput");
    var timeInput = bar.querySelector("#mRemTimeInput");
    dateInput.min = toDateValue(Date.now());

    function refresh(){
      // значение в input — только если оно выбрано: пустой input открывает
      // нативное окно на «сегодня/сейчас», а change сработает при любом выборе
      dateInput.value = selDate;
      timeInput.value = selTime;
      if(selDate){
        dateBtn.textContent = String(parseInt(selDate.slice(8, 10), 10));
        dateBtn.title = formatDateLong(parseLocal(selDate, "00:00"));
        dateBtn.classList.add("is-set");
      }else{
        dateBtn.innerHTML = ICON_CALENDAR;
        dateBtn.title = "Дата";
        dateBtn.classList.remove("is-set");
      }
      if(selTime){
        timeBtn.textContent = parseInt(selTime.slice(0, 2), 10) + ":" + selTime.slice(3, 5);
        timeBtn.title = "Время " + selTime;
        timeBtn.classList.add("is-set");
      }else{
        timeBtn.innerHTML = ICON_CLOCK;
        timeBtn.title = "Время";
        timeBtn.classList.remove("is-set");
      }
      dateBtn.classList.remove("is-invalid");
      timeBtn.classList.remove("is-invalid");
      if(barEl === bar) placeBar(bar, anchor); // ширина плашки могла измениться
    }
    refresh();

    placeBar(bar, anchor);
    var vk = navigator.virtualKeyboard;
    var onPlace = function(){ placeBar(bar, anchor); };
    if(vk) vk.addEventListener("geometrychange", onPlace);
    window.addEventListener("resize", onPlace);
    window.addEventListener("scroll", onPlace, true); // список задач прокручивается — плашка следует за часами
    window.addEventListener("popstate", closeBar);
    // клик мимо плашки = отмена (как крестик); сам клик гасим, чтобы он не
    // сработал на том, что под пальцем. Подключаем на следующем такте: клик,
    // открывший плашку, ещё не закончил распространяться
    var onOutside = function(e){
      if(bar.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      closeBar();
    };
    var outsideTimer = setTimeout(function(){ document.addEventListener("click", onOutside, true); }, 0);
    barCleanup = function(){
      clearTimeout(outsideTimer);
      document.removeEventListener("click", onOutside, true);
      if(vk) vk.removeEventListener("geometrychange", onPlace);
      window.removeEventListener("resize", onPlace);
      window.removeEventListener("scroll", onPlace, true);
      window.removeEventListener("popstate", closeBar);
    };

    // нажатие на плашку не отнимает фокус у поля задачи (иначе клавиатура
    // закроется и всё «поедет»)
    bar.addEventListener("mousedown", function(e){ e.preventDefault(); });
    bar.querySelector("#mRemCancel").addEventListener("click", closeBar);

    dateBtn.addEventListener("click", function(){ openNativePicker(dateInput); });
    timeBtn.addEventListener("click", function(){ openNativePicker(timeInput); });
    function onDate(){ if(dateInput.value){ selDate = dateInput.value; refresh(); } }
    function onTime(){ if(timeInput.value){ selTime = timeInput.value; refresh(); } }
    dateInput.addEventListener("change", onDate);
    dateInput.addEventListener("input", onDate);
    timeInput.addEventListener("change", onTime);
    timeInput.addEventListener("input", onTime);

    function markInvalid(dateBad, timeBad){
      dateBtn.classList.toggle("is-invalid", !!dateBad);
      timeBtn.classList.toggle("is-invalid", !!timeBad);
    }
    bar.querySelector("#mRemSave").addEventListener("click", function(){
      if(!selDate || !selTime){ markInvalid(!selDate, !selTime); return; }
      var ts = parseLocal(selDate, selTime);
      if(isNaN(ts) || ts <= Date.now()){
        // время уже прошло: если дата — сегодня, виновато время, иначе подсвечиваем оба
        markInvalid(selDate !== toDateValue(Date.now()), true);
        return;
      }
      requestPermissionIfNeeded(); // здесь ещё жест пользователя
      closeBar();
      if(opts.onSave) opts.onSave(ts);
      schedule();
    });
  }

  return {
    start: start,
    schedule: schedule,
    openReminderDialog: openReminderDialog,
    formatReminder: formatReminder,
    isSupported: isSupported,
    showBanner: showBanner
  };
};
