// Service Worker для "Графика чтения Библии".
// Отвечает за офлайн-доступ и бесшовное обновление страницы.
//
// ВАЖНО ПРИ ВЫПУСКЕ НОВОЙ ВЕРСИИ: поменяйте APP_VERSION ниже (например,
// "v0.6.0" -> "v0.7.0"). Именно эта строка заставляет браузер заметить,
// что sw.js изменился, скачать новую версию в фоне и подготовить её к
// установке — без этого шага обновление не будет обнаружено автоматически.

const APP_VERSION = "v0.36.26";
const CACHE_NAME = "bible-tracker-" + APP_VERSION;

// Временное хранилище для файла, присланного через системное "Поделиться"
// (Web Share Target, manifest.json -> share_target). НЕ версионируется
// вместе с CACHE_NAME/APP_VERSION выше (обновление приложения не должно
// стирать ещё не забранный файл) и живёт очень недолго: страница сама
// удаляет запись сразу после того, как заберёт файл (см. checkForSharedFile
// в my.js) — здесь остаётся максимум один файл одновременно, под одним и
// тем же ключом SHARE_TARGET_KEY.
const SHARE_TARGET_CACHE = "share-target-temp";
const SHARE_TARGET_KEY = "shared-file";

// Режим «оффлайн» — галочка «Использовать приложение в оффлайн режиме» в
// настройках (my.js: setOfflineMode / syncOfflineModeToServiceWorker).
// Service worker не видит localStorage страницы, поэтому страница кладёт флаг
// в отдельный кэш OFFLINE_MODE_CACHE (запись есть — режим включён, нет — выключен).
// Имя кэша и ключ записи ДОЛЖНЫ совпадать с OFFLINE_MODE_SW_CACHE/
// OFFLINE_MODE_SW_KEY в my.js. Пока режим включён, service worker:
//  - отвечает на GET только из кэша, ничего не перекачивая из сети (ни файлы
//    приложения при каждом запуске, ни чужие адреса — esm.sh, cdn.jsdelivr.net);
//  - не устанавливает новую версию (install падает, браузер оставляет прежний
//    service worker и его кэш) — ни 30+ файлов из ASSETS, ни фоновых загрузок.
// Этот кэш не удаляется в activate (см. ниже) — иначе флаг терялся бы при
// каждом обновлении; страница при запуске в любом случае восстанавливает его.
const OFFLINE_MODE_CACHE = "offline-mode-flag";
const OFFLINE_MODE_KEY = self.location.origin + "/__offline_mode_flag__";

function isOfflineModeOn() {
  // caches.match с cacheName НЕ создаёт кэш, если его нет
  return caches.match(OFFLINE_MODE_KEY, { cacheName: OFFLINE_MODE_CACHE })
    .then((hit) => !!hit, () => false);
}

// Ответ на запрос в режиме оффлайн, когда точного совпадения в кэше нет.
// Свой адрес: то же без строки запроса (например ./index.html?shared=1 из
// Web Share Target), для перехода по ссылке — сама страница. Чужой адрес и
// всё остальное — 503 (ошибка загрузки, как при обрыве сети).
function offlineModeFallback(request) {
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  const lookup = sameOrigin
    ? caches.match(request, { ignoreSearch: true })
    : Promise.resolve(undefined);
  return lookup.then((hit) => {
    if (hit) return hit;
    if (sameOrigin && request.mode === "navigate") {
      return caches.match("./index.html").then((page) => page || offlineModeResponse());
    }
    return offlineModeResponse();
  });
}
function offlineModeResponse() {
  return new Response("", { status: 503, statusText: "Offline mode" });
}

// install в режиме оффлайн: если у приложения уже есть свой кэш — отказываемся
// (иначе на самой первой установке, когда кэша ещё нет, приложение осталось бы
// вообще без файлов).
function refuseInstallInOfflineMode() {
  return isOfflineModeOn().then((on) => {
    if (!on) return;
    return caches.keys().then((keys) => {
      if (keys.some((k) => k.indexOf("bible-tracker-") === 0)) {
        throw new Error("offline_mode: установка новой версии отложена");
      }
    });
  });
}

// Список файлов, которые нужны странице для полностью офлайн-работы.
// Если в репозиторий добавляются новые файлы (например, отдельный
// manifest.json) — добавьте их сюда же.
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./theme.css",
  "./base.css",
  "./components.css",
  "./footer.css",
  "./modals.css",
  "./debug.js",
  "./syncengine.js",
  "./syncengine_groupcrypto.js",
  "./syncengine_transport.js",
  "./syncengine_groupbinding.js",
  "./syncengine_notescrypto.js",
  "./syncengine_notesbinding.js",
  "./my.js",
  "./mood.js",
  "./minizip.js",
  "./minixlsx.js",
  "./docxparse.js",
  "./fb2parse.js",
  "./epubparse.js",
  "./workbookparse.js",
  "./workbooks.js",
  "./jwlmerge.js",
  "./epubsplit.js",
  "./s89tasks.js",
  "./s89draw.js",
  "./s89fill.js",
  "./imgresize.js",
  "./mdeditor.js",
  "./search.js",
  "./notifications.js",
  "./flibusta.js",
  "./DejaVuSans.ttf",
  "./icon-192x192.png",
  "./icon-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    refuseInstallInOfflineMode()
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => {
        // ВАЖНО: обычный cache.addAll() делает fetch() с учётом HTTP-кэша
        // браузера — если сервер отдаёт файлы (например my.js) с
        // Cache-Control, разрешающим кэширование, новый service worker
        // может "закэшировать" ту же самую старую версию файла, даже
        // если на сервере уже лежит новая. Поэтому качаем каждый файл
        // явно в обход HTTP-кэша ({cache: "reload"}).
        return Promise.all(
          ASSETS.map((url) =>
            fetch(url, { cache: "reload" }).then((response) => {
              if (!response.ok) throw new Error("Failed to fetch " + url);
              return cache.put(url, response);
            })
          )
        );
      })
      .then(() => {
        // сообщаем всем открытым вкладкам номер новой версии —
        // страница использует это для текста уведомления/для
        // варианта "больше не показывать про именно эту версию"
        return self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: "SW_VERSION", version: APP_VERSION });
          });
        });
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== OFFLINE_MODE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Приём файла через системное "Поделиться" (Web Share Target, см.
// share_target в manifest.json). Android отправляет сюда POST с
// multipart/form-data — у приложения нет бэкенда, поэтому единственное
// место, где можно перехватить этот запрос и достать файл — сам service
// worker. Файл кладётся во временный кэш (SHARE_TARGET_CACHE, см. выше),
// а страница получает редирект на "./index.html?shared=1" и уже сама
// забирает файл оттуда (checkForSharedFile в my.js) — так значительно
// проще передать Blob со страницы в SW и обратно, чем городить IndexedDB
// или postMessage до того, как страница вообще успела загрузиться.
async function handleShareTarget(request){
  try{
    const formData = await request.formData();
    const file = formData.get("sharedFile");
    if(file){
      const headers = new Headers();
      headers.set("Content-Type", file.type || "application/octet-stream");
      // Response не хранит оригинальное имя файла — переносим его отдельным
      // заголовком (см. checkForSharedFile в my.js, декодирует обратно).
      headers.set("X-Shared-File-Name", encodeURIComponent(file.name || ""));
      const cache = await caches.open(SHARE_TARGET_CACHE);
      await cache.put(SHARE_TARGET_KEY, new Response(file, { headers }));
    }
  }catch(e){
    // Молча игнорируем — страница просто не найдёт файл во временном кэше
    // и ничего не откроет, без дальнейшего вреда.
  }
  // 303 (не 302) — прямое указание браузеру заменить исходный POST на
  // обычный GET при переходе по редиректу, ровно то, что нужно здесь.
  return Response.redirect("./index.html?shared=1", 303);
}

// Стратегия "кэш, обновляемый в фоне" (stale-while-revalidate):
// сразу отдаём то, что уже сохранено (быстро и работает офлайн),
// и параллельно тихо обновляем кэш из сети для следующего раза.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  if (event.request.method !== "GET") return;

  event.respondWith(
    isOfflineModeOn().then((offlineMode) =>
      caches.match(event.request).then((cached) => {
        // режим оффлайн (см. OFFLINE_MODE_CACHE выше): только кэш, без сети
        if (offlineMode) return cached || offlineModeFallback(event.request);

        const networkFetch = fetch(event.request, { cache: "no-store" })
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    )
  );
});

// Клик по уведомлению-напоминанию (notifications.js). id задачи кладём во
// временный кэш REMINDER_CLICK_CACHE (тот же приём, что у share-target —
// адресная строка не нужна, поэтому холодный запуск работает офлайн), затем
// фокусируем уже открытое окно и будим страницу сообщением REMINDER_CLICK
// либо открываем приложение заново; страница сама забирает запись из кэша
// (consumePendingClick) и открывает вкладку с задачей.
const REMINDER_CLICK_CACHE = "reminder-click-temp";
const REMINDER_CLICK_KEY = "click";

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const taskId = event.notification.data && event.notification.data.taskId;
  // кнопка уведомления: "done" («✓ Готово») / "snooze" («Отложить»); "" — клик по
  // самому уведомлению. Страница разбирает действие в notifications.js
  // (consumePendingClick → handleNotificationAction). Приложение выводим на
  // экран при любом действии: данные задач лежат на странице, service worker до
  // них не дотягивается, а свёрнутая вкладка может быть заморожена.
  const action = event.action || "";
  event.waitUntil((async () => {
    try {
      if (taskId) {
        const cache = await caches.open(REMINDER_CLICK_CACHE);
        await cache.put(
          REMINDER_CLICK_KEY,
          new Response(JSON.stringify({ taskId: taskId, action: action, at: Date.now() }), {
            headers: { "Content-Type": "application/json" }
          })
        );
      }
    } catch (e) {}
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      if ("focus" in client) {
        try {
          client.postMessage({ type: "REMINDER_CLICK" });
          return await client.focus();
        } catch (e) {}
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  })());
});

// страница просит "активируйся уже" после того, как пользователь
// согласился на обновление в диалоге; либо спрашивает текущую версию,
// чтобы показать её в подвале страницы (единственный источник истины —
// APP_VERSION здесь, наверху этого файла)
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === "GET_VERSION") {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: "VERSION", version: APP_VERSION });
    }
  }
});
