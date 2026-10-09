/* ===========================================================================
   native-shell.js
   Версия: 1.2 (09.10) — добавлена эмуляция navigator.virtualKeyboard (раздел 4): в WebView этого API нет, поэтому подъём
   текста задачи/заметки над клавиатурой (initTaskKeyboardLift в my.js) в APK не включался. Нужен APK с мостом версии 4
   (setKeyboardOverlay); на старом APK ничего не меняется.
   Версия: 1.1 (07.10) — шаг 5 переезда в APK: добавлен window.LTNotify — обёртка над нативными уведомлениями
   (напоминания о задачах и уведомление о новой общей задаче работают и при закрытом приложении, их показывает
   оболочка: будильник + фоновая проверка группы). Пользуются notifications.js и my.js; на старом APK (без мостовых
   методов) LTNotify.available = false, и всё работает по-прежнему.
   Версия: 1.0 (07.10) — новый файл (ПЕРЕЕЗД_В_APK.md, шаг 4): веб-слой нативной оболочки Android.
   Работает ТОЛЬКО в APK (есть window.LifeTrackerNative); в браузере файл ничего не делает, прежнее поведение
   сохраняется. Подключается в index.html ПЕРЕД остальными скриптами: должен успеть заменить navigator.share до
   того, как mdeditor.js решит, рисовать ли кнопку «Поделиться».

   Что делает (каждое — только если нативный мост эту функцию умеет, так что на старом APK ничего не ломается):
   1. Скачивание файлов. Весь код приложения скачивает так: URL.createObjectURL(blob) -> <a download> -> a.click().
      В голом WebView такое скачивание не работает. Здесь a.click() для ссылок с download и blob:/data: подменяется:
      файл уходит в оболочку кусками по ~3 МБ (LifeTrackerNative.beginSave/appendSave/finishSave) и сохраняется в
      папку «Загрузки». Остальной код (экспорт архива, заметки, xlsx, png, jwlibrary...) менять не нужно.
   2. «Поделиться». В WebView нет Web Share API, поэтому navigator.share/canShare определяются здесь поверх
      нативного меню «Поделиться» (файлы и текст). Существующий код (книги, картинки) работает без изменений.
   Вне этого файла остаются: полноэкранный режим и цвет статус-бара (my.js), приём файлов из «Поделиться»
   (checkForSharedFile в my.js).
   =========================================================================== */
(function () {
  "use strict";

  var N = window.LifeTrackerNative;
  if (!N) return;

  var CHUNK_BYTES = 3 * 1024 * 1024; // кратно 3: base64 каждого куска независим, но так короче на 1-2 символа
  var BLOB_KEEP_MS = 5000;

  function has(name) {
    try { return typeof N[name] !== "undefined"; } catch (e) { return false; }
  }
  function canSave() { return has("beginSave") && has("appendSave") && has("finishSave") && has("cancelSave"); }
  function canShareNative() { return has("beginStage") && has("finishStage") && has("shareStaged") && canSave(); }

  function toast(text) {
    try {
      if (has("showToast")) { N.showToast(String(text)); return; }
    } catch (e) {}
    try { alert(String(text)); } catch (e2) {}
  }
  function logDebug(msg) {
    try { if (window.Debug && window.Debug.log) window.Debug.log("Оболочка: " + msg); } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Передача Blob в оболочку по частям
  // ---------------------------------------------------------------------------

  function readBase64(part) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : "");
      };
      reader.onerror = function () { reject(reader.error || new Error("не удалось прочитать файл")); };
      reader.readAsDataURL(part);
    });
  }

  // Пишет весь blob в открытую сессию (id) кусками. Отклоняется, если оболочка отказала в записи.
  function writeChunks(id, blob) {
    var size = blob.size;
    var offset = 0;
    function next() {
      if (offset >= size) return Promise.resolve();
      var end = Math.min(offset + CHUNK_BYTES, size);
      var part = blob.slice(offset, end);
      offset = end;
      return readBase64(part).then(function (b64) {
        if (!N.appendSave(id, b64)) throw new Error("запись прервана (нет места или файл недоступен)");
        return next();
      });
    }
    return next();
  }

  function parseResult(text) {
    try { return JSON.parse(text); } catch (e) { return { ok: false, error: "непонятный ответ оболочки" }; }
  }

  // Несколько сохранений подряд (s89: PNG по одному) идут по очереди, чтобы не держать в памяти сразу все куски.
  var saveQueue = Promise.resolve();

  function saveBlob(blob, name) {
    var job = saveQueue.then(function () {
      var id = N.beginSave(name || "file");
      if (!id) throw new Error("не удалось создать файл в «Загрузках»");
      return writeChunks(id, blob).then(function () {
        var result = parseResult(N.finishSave(id));
        if (!result.ok) throw new Error(result.error || "ошибка сохранения");
        return result;
      }, function (e) {
        try { N.cancelSave(id); } catch (e2) {}
        throw e;
      });
    });
    saveQueue = job.then(function () {}, function () {});
    return job;
  }

  // ---------------------------------------------------------------------------
  // 1. Скачивание: подмена a.click() для <a download href="blob:|data:">
  // ---------------------------------------------------------------------------

  // Blob по blob:-адресу запоминаем на момент создания: код приложения отзывает адрес сразу после click(),
  // а чтение по адресу после отзыва уже не пройдёт. В карте адрес живёт несколько секунд.
  var blobByUrl = {};
  if (canSave()) {
    var origCreate = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      var url = origCreate.apply(URL, arguments);
      try {
        if (typeof Blob !== "undefined" && obj instanceof Blob) {
          blobByUrl[url] = obj;
          setTimeout(function () { delete blobByUrl[url]; }, BLOB_KEEP_MS);
        }
      } catch (e) {}
      return url;
    };
  }

  function blobForUrl(href) {
    if (blobByUrl[href]) return Promise.resolve(blobByUrl[href]);
    return fetch(href).then(function (r) { return r.blob(); });
  }

  function downloadTarget(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute("download")) return null;
    var href = a.href || a.getAttribute("href") || "";
    if (href.indexOf("blob:") !== 0 && href.indexOf("data:") !== 0) return null;
    return href;
  }

  function fileNameFor(a) {
    var name = a.getAttribute("download");
    if (name && name.trim()) return name.trim();
    return "file";
  }

  function nativeDownload(href, name) {
    return blobForUrl(href).then(function (blob) {
      return saveBlob(blob, name);
    }).then(function (result) {
      logDebug("сохранён файл «" + (result.name || name) + "», " + (result.bytes || 0) + " байт");
      try {
        document.dispatchEvent(new CustomEvent("lt-native-saved", { detail: result }));
      } catch (e) {}
    }).catch(function (e) {
      var message = e && e.message ? e.message : String(e);
      logDebug("не удалось сохранить «" + name + "»: " + message);
      toast("Не удалось сохранить файл «" + name + "»: " + message);
    });
  }

  if (canSave() && typeof HTMLAnchorElement !== "undefined") {
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      var href = downloadTarget(this);
      if (href) {
        nativeDownload(href, fileNameFor(this));
        return;
      }
      return origClick.apply(this, arguments);
    };

    // Нажатие пальцем по настоящей ссылке с download (если такие появятся в разметке). Программный a.click()
    // выше событие click не порождает, поэтому двойного сохранения нет.
    document.addEventListener("click", function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest("a[download]") : null;
      if (!a) return;
      var href = downloadTarget(a);
      if (!href) return;
      ev.preventDefault();
      ev.stopPropagation();
      nativeDownload(href, fileNameFor(a));
    }, true);
  }

  // ---------------------------------------------------------------------------
  // 2. «Поделиться»: navigator.share / navigator.canShare поверх нативного меню
  // ---------------------------------------------------------------------------

  function stageFiles(files) {
    var index = 0;
    function next() {
      if (index >= files.length) return Promise.resolve();
      var file = files[index++];
      var id = N.beginStage(file.name || "file");
      if (!id) return Promise.reject(new Error("не удалось подготовить файл"));
      return writeChunks(id, file).then(function () {
        var result = parseResult(N.finishStage(id));
        if (!result.ok) throw new Error(result.error || "ошибка подготовки файла");
        return next();
      }, function (e) {
        try { N.cancelSave(id); } catch (e2) {}
        throw e;
      });
    }
    return next().catch(function (e) {
      try { N.clearStaged(); } catch (e2) {}
      throw e;
    });
  }

  if (!navigator.share && canShareNative()) {
    var canShareImpl = function (data) {
      if (!data) return false;
      if (data.files && data.files.length) return true;
      return !!(data.text || data.url || data.title);
    };
    var shareImpl = function (data) {
      data = data || {};
      var files = data.files ? Array.prototype.slice.call(data.files) : [];
      var text = [data.text, data.url].filter(Boolean).join("\n");
      if (!files.length) {
        if (!text && !data.title) return Promise.reject(new TypeError("Нечем поделиться"));
        return N.shareText(data.title || "", text || data.title) ? Promise.resolve() :
          Promise.reject(new Error("не удалось открыть меню «Поделиться»"));
      }
      return stageFiles(files).then(function () {
        if (!N.shareStaged(data.title || "", text)) throw new Error("не удалось открыть меню «Поделиться»");
      });
    };
    try {
      Object.defineProperty(navigator, "share", { value: shareImpl, configurable: true, writable: true });
      Object.defineProperty(navigator, "canShare", { value: canShareImpl, configurable: true, writable: true });
    } catch (e) {
      logDebug("не удалось определить navigator.share: " + (e && e.message ? e.message : e));
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Уведомления (шаг 5): window.LTNotify
  // ---------------------------------------------------------------------------
  // Все методы безопасны: на ошибку мост возвращают «пусто» (null / [] / {} / false), страница тогда работает по-старому.
  // available — оболочка умеет всё, что нужно (мост версии 3).

  function notifyAvailable() {
    return has("setReminders") && has("getNotifyState") && has("takeNotifyActions") && has("takeFiredReminders") &&
      has("setGroupWatch") && has("takeGroupSeen") && has("postGroupTaskNotification") && has("requestNotifyPermission");
  }

  function callJson(name, fallback) {
    try {
      var text = N[name]();
      var value = JSON.parse(text);
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  var permissionListeners = [];
  window.__ltOnNotifyPermission = function (granted) {
    permissionListeners.slice().forEach(function (cb) {
      try { cb(!!granted); } catch (e) {}
    });
  };

  var actionListeners = [];
  window.__ltOnNativeAction = function () {
    actionListeners.slice().forEach(function (cb) {
      try { cb(); } catch (e) {}
    });
  };

  window.LTNotify = {
    available: notifyAvailable(),
    // {permission, canRequest, exactAlarm, batteryIgnored, reminders, nextAt, watching, pollLog, manufacturer, sdk} или null
    state: function () { return callJson("getNotifyState", null); },
    requestPermission: function () { try { N.requestNotifyPermission(); } catch (e) {} },
    openNotifySettings: function () { try { N.openNotifySettings(); } catch (e) {} },
    openBackgroundSettings: function () { try { N.openBackgroundSettings(); } catch (e) {} },
    onPermission: function (cb) { permissionListeners.push(cb); },
    onAction: function (cb) { actionListeners.push(cb); },
    // list: [{id, at, text}] — напоминания, которые оболочка должна показать (заменяет прежний список)
    setReminders: function (list) {
      try { return !!N.setReminders(JSON.stringify(list || [])); } catch (e) { return false; }
    },
    takeFired: function () { return callJson("takeFiredReminders", {}); },
    takeActions: function () { return callJson("takeNotifyActions", []); },
    cancelReminderNotification: function (id) { try { N.cancelReminderNotification(String(id)); } catch (e) {} },
    postGroupTask: function (title, body, taskId, many) {
      try { return !!N.postGroupTaskNotification(String(title), String(body), String(taskId), !!many); } catch (e) { return false; }
    },
    // cfg: {groupId, db, deviceId, seenIds, names} или null (группы нет)
    setGroupWatch: function (cfg) {
      try { return !!N.setGroupWatch(cfg ? JSON.stringify(cfg) : ""); } catch (e) { return false; }
    },
    takeGroupSeen: function () { return callJson("takeGroupSeen", []); },
    // для страницы диагностики
    scheduleTestReminder: function (seconds) { try { return !!N.scheduleTestReminder(seconds | 0); } catch (e) { return false; } },
    runGroupPollNow: function () { try { return !!N.runGroupPollNow(); } catch (e) { return false; } }
  };

  // ---------------------------------------------------------------------------
  // 4. Клавиатура поверх страницы: эмуляция navigator.virtualKeyboard
  // ---------------------------------------------------------------------------
  // В Chrome my.js, notifications.js и плашки подтверждения берут высоту клавиатуры из navigator.virtualKeyboard
  // (boundingRect, событие geometrychange, флаг overlaysContent). В WebView этого API нет (или он не работает), поэтому
  // подставляем свой объект с теми же свойствами: overlaysContent уходит в оболочку (WebView перестаёт сжиматься
  // клавиатурой), а высоту клавиатуры оболочка присылает в window.__ltOnKeyboard(cssPx). Остальной код менять не нужно.
  // Ставим только если мост умеет setKeyboardOverlay (APK с мостом версии 4); иначе всё как было.

  if (has("setKeyboardOverlay")) {
    (function () {
      var kbHeight = 0;
      var overlays = false;
      var listeners = [];

      function rect() {
        var h = Math.max(0, kbHeight);
        var top = window.innerHeight - h;
        var w = window.innerWidth;
        // как у Chrome: пока клавиатуры нет или режим «поверх» выключен, высота 0
        if (!overlays || h <= 0) return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
        return { x: 0, y: top, top: top, left: 0, bottom: top + h, right: w, width: w, height: h };
      }
      function fire() {
        var ev;
        try { ev = new Event("geometrychange"); } catch (e) { ev = null; }
        listeners.slice().forEach(function (cb) {
          try { cb.call(shim, ev); } catch (e2) {}
        });
      }

      var shim = {
        get boundingRect() { return rect(); },
        get overlaysContent() { return overlays; },
        set overlaysContent(v) {
          v = !!v;
          if (v === overlays) return;
          overlays = v;
          try { N.setKeyboardOverlay(v); } catch (e) {}
          if (!v) { kbHeight = 0; fire(); }
        },
        show: function () {},
        hide: function () {},
        addEventListener: function (type, cb) {
          if (type === "geometrychange" && typeof cb === "function" && listeners.indexOf(cb) < 0) listeners.push(cb);
        },
        removeEventListener: function (type, cb) {
          var i = listeners.indexOf(cb);
          if (type === "geometrychange" && i >= 0) listeners.splice(i, 1);
        }
      };

      window.__ltOnKeyboard = function (cssPx) {
        var h = Math.max(0, Number(cssPx) || 0);
        if (h === kbHeight) return;
        kbHeight = h;
        fire();
      };

      try {
        Object.defineProperty(navigator, "virtualKeyboard", { value: shim, configurable: true });
      } catch (e) {
        logDebug("не удалось подставить navigator.virtualKeyboard: " + (e && e.message ? e.message : e));
      }
    })();
  }

  // Для страницы диагностики и будущих шагов.
  window.LifeTrackerShell = {
    saveBlob: function (blob, name) { return saveBlob(blob, name); },
    canSave: canSave,
    canShare: canShareNative
  };
})();
