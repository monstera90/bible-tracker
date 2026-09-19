/* ===========================================================================
   notifications.js
   Версия: 1.0 (19.09) — новый файл. ТЗ пользователя от 19.09: напоминание для
   задачи на конкретные дату и время. ВСЕ уведомления приложения (в том числе
   будущие) живут в этом файле — my.js лишь хранит поле задачи и рисует
   пиктограмму-часы.

   Что здесь есть сейчас:
   1) Диалог выбора даты и времени (openReminderDialog). Два поля-кнопки
      «Дата»/«Время»; по нажатию открывается НАТИВНОЕ окно Android (календарь /
      часы — как в приложениях Google), поэтому свой календарь не пишем.
      Скрытые <input type="date">/<input type="time"> лежат в самом диалоге,
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

   Контракт deps: modalBox, modalOverlay, modalHeader, bindClose, closeModal,
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

  // ------------------------------------------------------------------ диалог

  function openNativePicker(input){
    try{
      if(typeof input.showPicker === "function"){ input.showPicker(); return; }
    }catch(e){}
    try{ input.focus(); input.click(); }catch(e){}
  }

  // opts: {currentTs (число|null), onSave(ts), onClear()}
  function openReminderDialog(opts){
    var hasCurrent = typeof opts.currentTs === "number" && opts.currentTs > 0;
    var startTs = hasCurrent ? opts.currentTs : defaultTimestamp();
    var selDate = toDateValue(startTs);
    var selTime = toTimeValue(startTs);

    modalBox.innerHTML =
      modalHeader("Напоминание", "Выберите дату и время.") +
      '<div class="reminder-fields">' +
        '<button type="button" class="reminder-field" id="mRemDateBtn"><span class="reminder-field-label">Дата</span><span class="reminder-field-value" id="mRemDateVal"></span></button>' +
        '<button type="button" class="reminder-field" id="mRemTimeBtn"><span class="reminder-field-label">Время</span><span class="reminder-field-value" id="mRemTimeVal"></span></button>' +
        '<input type="date" class="reminder-hidden-input" id="mRemDateInput" tabindex="-1" aria-hidden="true">' +
        '<input type="time" class="reminder-hidden-input" id="mRemTimeInput" tabindex="-1" aria-hidden="true">' +
      '</div>' +
      '<p class="reminder-error" id="mRemError" style="display:none;">Это время уже прошло — выберите будущее.</p>' +
      '<button type="button" class="modal-btn primary" id="mRemSave">Сохранить</button>' +
      (hasCurrent ? '<button type="button" class="modal-btn danger" id="mRemClear">Удалить напоминание</button>' : '') +
      '<button type="button" class="modal-btn" id="mRemCancel">Отмена</button>';
    bindClose();
    modalOverlay.classList.add("open");

    var dateInput = document.getElementById("mRemDateInput");
    var timeInput = document.getElementById("mRemTimeInput");
    var dateVal = document.getElementById("mRemDateVal");
    var timeVal = document.getElementById("mRemTimeVal");
    var errorEl = document.getElementById("mRemError");
    dateInput.min = toDateValue(Date.now());

    function refresh(){
      dateInput.value = selDate;
      timeInput.value = selTime;
      var ts = parseLocal(selDate, selTime);
      dateVal.textContent = isNaN(ts) ? "—" : formatDateLong(ts);
      timeVal.textContent = selTime || "—";
      errorEl.style.display = "none";
    }
    refresh();

    document.getElementById("mRemDateBtn").addEventListener("click", function(){ openNativePicker(dateInput); });
    document.getElementById("mRemTimeBtn").addEventListener("click", function(){ openNativePicker(timeInput); });
    dateInput.addEventListener("change", function(){ if(dateInput.value) selDate = dateInput.value; refresh(); });
    timeInput.addEventListener("change", function(){ if(timeInput.value) selTime = timeInput.value; refresh(); });

    document.getElementById("mRemSave").addEventListener("click", function(){
      var ts = parseLocal(selDate, selTime);
      if(isNaN(ts) || ts <= Date.now()){
        errorEl.style.display = "";
        return;
      }
      requestPermissionIfNeeded(); // здесь ещё жест пользователя
      closeModal();
      if(opts.onSave) opts.onSave(ts);
      schedule();
    });
    var clearBtn = document.getElementById("mRemClear");
    if(clearBtn){
      clearBtn.addEventListener("click", function(){
        closeModal();
        if(opts.onClear) opts.onClear();
        schedule();
      });
    }
    document.getElementById("mRemCancel").addEventListener("click", closeModal);
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
