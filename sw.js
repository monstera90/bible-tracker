// Service Worker для "Графика чтения Библии".
// Отвечает за офлайн-доступ и бесшовное обновление страницы.
//
// ВАЖНО ПРИ ВЫПУСКЕ НОВОЙ ВЕРСИИ: поменяйте APP_VERSION ниже (например,
// "v0.6.0" -> "v0.7.0"). Именно эта строка заставляет браузер заметить,
// что sw.js изменился и скачать новую версию в фоне.
//
// Обновление автоматическое: как только файлы из ASSETS скачаны в новый
// кэш, install сам вызывает skipWaiting() — новая версия сразу становится
// активной, без кнопки и без подтверждения пользователя (ручного обновления
// в приложении больше нет). Сбой скачивания необязательного файла установку не
// срывает — см. CRITICAL_ASSETS и INSTALL_REPORT_CACHE ниже.

const APP_VERSION = "v0.38.40";
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

// Отчёт о последней установке: какие файлы из ASSETS не скачались. Кладётся в
// отдельный кэш (service worker не может «написать» странице, если та ещё не
// открыта), страница читает его при запуске и пишет в журнал отладки (my.js,
// logInstallReport). Имя кэша и ключ ДОЛЖНЫ совпадать с my.js. Этот кэш тоже
// не удаляется в activate.
const INSTALL_REPORT_CACHE = "sw-install-report";
const INSTALL_REPORT_KEY = self.location.origin + "/__sw_install_report__";

// Без этих файлов приложение не запустится вообще — если хоть один не скачался,
// установка считается неудавшейся (как раньше). Сбой любого ДРУГОГО файла из
// ASSETS установку больше не срывает: раньше один недоехавший на сервер файл
// (например, забытый при выгрузке новый модуль) навсегда блокировал установку
// ЛЮБОЙ новой версии — без сообщений и без кнопки обновления. Теперь новая
// версия ставится, а список не скачавшихся файлов попадает в отчёт выше.
const CRITICAL_ASSETS = ["./", "./index.html", "./my.js"];

function writeInstallReport(info) {
  // info: { failed: [...], ranNetworkInstall: bool, fetchedCount: number, fetchedBytes: number|null }
  // ⚠️ ДОБАВЛЕНО (расход трафика "на холостом проходе", 27.09): раньше отчёт
  // содержал только список НЕ скачавшихся файлов — если install проходил
  // полностью успешно, отчёт был неотличим от случая "install вообще не
  // запускался" (alreadyComplete), хотя во втором случае сеть не тронута
  // вовсе, а в первом — скачано полностью всё приложение (сотни КБ).
  // ranNetworkInstall/fetchedCount/fetchedBytes закрывают этот пробел —
  // страница (см. logInstallReport в my.js) теперь может прямо написать в
  // журнал отладки "install скачал N файлов, ~X КБ" при следующем заходе,
  // вместо того чтобы гадать по стороннему замеру трафика.
  return caches.open(INSTALL_REPORT_CACHE)
    .then((cache) => cache.put(
      INSTALL_REPORT_KEY,
      new Response(JSON.stringify({
        version: APP_VERSION,
        at: Date.now(),
        failed: info.failed || [],
        ranNetworkInstall: !!info.ranNetworkInstall,
        fetchedCount: info.fetchedCount || 0,
        fetchedBytes: (typeof info.fetchedBytes === "number") ? info.fetchedBytes : null
      }), {
        headers: { "Content-Type": "application/json" }
      })
    ))
    .catch(() => {});
}

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
  "./syncengine_personalcrypto.js",
  "./syncengine_personalbinding.js",
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
  "./codemirror.bundle.js",
  "./search.js",
  "./notifications.js",
  "./flibusta.js",
  "./DejaVuSans.ttf",
  "./icon-192x192.png",
  "./icon-512x512.png",
  "./book-cover-placeholder.jpg",
  "./vendor/qrcode.min.js",
  "./vendor/jsQR.js",
  "./vendor/sql-wasm.js",
  "./vendor/sql-wasm.wasm"
];

// Проверяет ЛОКАЛЬНО (без единого обращения к сети — только cache.match),
// есть ли в кэше уже все файлы из ASSETS. Нужна install-обработчику ниже,
// чтобы отличить настоящую новую версию (APP_VERSION поднят -> CACHE_NAME
// новый -> кэш пустой -> нужна полная закачка) от "ложной" повторной
// установки: браузер перепроверяет байты sw.js при каждой навигации и, если
// они отличаются от прошлого раза ХОТЯ БЫ на один символ (например, правка
// комментария в sw.js или даже перенос строки — БЕЗ изменения самого
// APP_VERSION), запускает install заново. Раньше это означало полную
// перекачку всех ~35 файлов приложения по сети — тот самый расход трафика
// "на пустом месте", который заметил пользователь 26.09, хотя версия
// приложения не менялась и все файлы уже лежали в этом же кэше (CACHE_NAME
// ведь зависит только от APP_VERSION, а не от точного содержимого sw.js).
function cacheHasAllAssets(cache) {
  return Promise.all(ASSETS.map((url) => cache.match(url).then((r) => !!r)))
    .then((flags) => flags.every(Boolean));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    refuseInstallInOfflineMode()
      .then(() => caches.open(CACHE_NAME))
      .then((cache) =>
        cacheHasAllAssets(cache).then((alreadyComplete) => {
          // Кэш этой же версии уже полон — см. cacheHasAllAssets выше:
          // сеть не трогаем вовсе, сразу отдаём null дальше по цепочке
          // (следующий .then() ниже читает null как "скачивать было
          // нечего, отчёт и проверку критичных файлов пропускаем").
          // "SKIPPED" (а не null) — чтобы следующий .then() мог отличить
          // "качать было нечего" от "качали, но список пуст" и в обоих
          // случаях написать честный отчёт (27.09, см. writeInstallReport
          // выше — раньше при alreadyComplete отчёт не писался вовсе, и
          // страница не могла отличить "install не запускался" от "install
          // прошёл успешно" — с точки зрения трафика это две разные вещи).
          if (alreadyComplete) return "SKIPPED";

          // ВАЖНО: обычный cache.addAll() делает fetch() с учётом HTTP-кэша
          // браузера — если сервер отдаёт файлы (например my.js) с
          // Cache-Control, разрешающим кэширование, новый service worker
          // может "закэшировать" ту же самую старую версию файла, даже
          // если на сервере уже лежит новая. Поэтому качаем каждый файл
          // явно в обход HTTP-кэша ({cache: "reload"}).
          // Каждый файл качается независимо: сбой одного не отменяет остальные.
          // Успех несёт вес файла (Content-Length из заголовков, читаем ДО
          // того как cache.put заберёт тело), сбой — причину. Оба идут в
          // отчёт (27.09, см. writeInstallReport выше).
          return Promise.all(
            ASSETS.map((url) =>
              fetch(url, { cache: "reload" })
                .then((response) => {
                  if (!response.ok) throw new Error("HTTP " + response.status);
                  var cl = response.headers && response.headers.get ? response.headers.get("content-length") : null;
                  var bytes = (cl !== null && cl !== undefined && cl !== "") ? (parseInt(cl, 10) || null) : null;
                  return cache.put(url, response).then(function(){ return { url: url, ok: true, bytes: bytes }; });
                })
                .catch(function(err){ return { url: url, ok: false, reason: String((err && err.message) || err) }; })
            )
          );
        })
      )
      .then((results) => {
        // "SKIPPED" — из ветки alreadyComplete выше: сеть не трогали вовсе.
        if (results === "SKIPPED") {
          return writeInstallReport({ failed: [], ranNetworkInstall: false, fetchedCount: 0, fetchedBytes: 0 });
        }
        var ok = results.filter(function(r){ return r.ok; });
        var failed = results.filter(function(r){ return !r.ok; });
        const criticalFailed = failed.filter((f) => CRITICAL_ASSETS.indexOf(f.url) !== -1);
        var knownBytes = ok.filter(function(r){ return typeof r.bytes === "number"; });
        // Если хоть у одного скачанного файла нет Content-Length — сумма
        // недостоверна (часть веса не посчитана), честно передаём null,
        // а не заниженное число.
        var fetchedBytes = (knownBytes.length === ok.length) ? knownBytes.reduce(function(s, r){ return s + r.bytes; }, 0) : null;
        return writeInstallReport({
          failed: failed.map((f) => f.url + " (" + f.reason + ")"),
          ranNetworkInstall: true,
          fetchedCount: ok.length,
          fetchedBytes: fetchedBytes
        }).then(() => {
          if (criticalFailed.length) {
            throw new Error("Failed to fetch " + criticalFailed.map((f) => f.url).join(", "));
          }
        });
      })
      // автоматическая установка: не ждём, пока пользователь закроет
      // старые вкладки или нажмёт кнопку — сразу активируемся (в activate
      // ниже — clients.claim(), так что новая версия берёт под контроль и
      // уже открытые страницы). До этой строки дойдём только если скачались
      // все обязательные файлы (или скачивать было нечего — см. выше) —
      // иначе install падает и прежняя версия продолжает работать.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== OFFLINE_MODE_CACHE && key !== INSTALL_REPORT_CACHE)
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
  // status — краткий итог для журнала отладки страницы (my.js, checkForSharedFile читает запись
  // "shared-status" из того же временного кэша); на приём файла не влияет
  let status = "";
  // Заголовки самого запроса — чтобы отличить «Chrome прислал пустое тело» от «тело есть, но не разобралось»
  const meta = " [запрос: тип=\"" + (request.headers.get("content-type") || "") + "\", длина=" + (request.headers.get("content-length") || "не указана") + "]";
  try{
    const formData = await request.formData();
    // Файл берём по имени поля sharedFile, а если поле названо иначе — первый попавшийся файл формы
    // (у File есть name/size/type; у обычных текстовых полей значение — строка).
    let file = formData.get("sharedFile");
    const parts = [];
    for(const [key, val] of formData.entries()){
      if(typeof val === "string"){
        parts.push(key + "=строка(" + val.length + ")" + (val ? ":\"" + val.slice(0, 80) + "\"" : ""));
      }else{
        parts.push(key + "=файл(имя=\"" + (val.name || "") + "\", размер=" + val.size + ", тип=\"" + (val.type || "") + "\")");
        if(!(file && typeof file !== "string")) file = val;
      }
    }
    if(file && typeof file !== "string"){
      const headers = new Headers();
      headers.set("Content-Type", file.type || "application/octet-stream");
      // Response не хранит оригинальное имя файла — переносим его отдельным
      // заголовком (см. checkForSharedFile в my.js, декодирует обратно).
      headers.set("X-Shared-File-Name", encodeURIComponent(file.name || ""));
      const cache = await caches.open(SHARE_TARGET_CACHE);
      await cache.put(SHARE_TARGET_KEY, new Response(file, { headers }));
      status = "файл сохранён: имя=\"" + (file.name || "") + "\", размер=" + file.size + ", тип=\"" + (file.type || "") + "\"; поля формы: " + parts.join("; ") + meta;
    } else {
      status = "в форме нет файла (Chrome не передал его — обычно тип файла не подошёл под accept в manifest.json); поля формы: " + (parts.join("; ") || "пусто") + meta;
    }
  }catch(e){
    // Страница просто не найдёт файл во временном кэше и ничего не откроет — причина уйдёт в статус.
    status = "ошибка приёма: " + String((e && e.message) || e) + meta;
  }
  try{
    const cache2 = await caches.open(SHARE_TARGET_CACHE);
    await cache2.put("shared-status", new Response(status));
  }catch(e2){}
  // 303 (не 302) — прямое указание браузеру заменить исходный POST на
  // обычный GET при переходе по редиректу, ровно то, что нужно здесь.
  return Response.redirect("./index.html?shared=1", 303);
}

// Стратегия "сначала кэш" (cache-first): если ответ уже есть в кэше текущей
// версии — отдаём его и НИЧЕГО не качаем из сети. Раньше здесь было
// "stale-while-revalidate" — при КАЖДОМ запросе (то есть при каждом
// открытии/обновлении страницы, для каждого файла из ASSETS и вообще
// любого GET) параллельно с отдачей из кэша всё равно шёл полный fetch()
// по сети с {cache:"no-store"} (это в обход и кэша самого браузера тоже) —
// то есть 20 обновлений страницы = 20 полных скачиваний ВСЕГО приложения
// (my.js, mdeditor.js, codemirror_bundle.js, все css и т.д. — суммарно
// несколько мегабайт), даже если ни один файл не изменился (расход
// трафика, замечен пользователем 25.09). Свежесть кэша и так гарантирована
// install-обработчиком выше: при каждом релизе меняется APP_VERSION →
// новое имя кэша → все файлы из ASSETS перекачиваются заново одним разом.
// Поэтому в рантайме сеть трогаем только для того, чего в кэше ещё нет
// (новый файл, добавленный в ASSETS но не попавший в установленный кэш,
// сторонний адрес вроде esm.sh/cdn.jsdelivr.net при первом обращении и т.п.).
// ⚠️ Следствие: если правите файлы и тестируете БЕЗ смены APP_VERSION —
// старая версия останется в кэше и по сети НЕ обновится, пока не
// поднимете APP_VERSION (или не снесёте кэш вручную). Это ровно то, для
// чего и задуман APP_VERSION (см. комментарий в начале файла).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  if (event.request.method !== "GET") return;

  // ⚠️ ДОБАВЛЕНО (23.09, расход трафика): запросы к Firebase Realtime Database
  // (синхронизация) service worker НЕ перехватывает — отдаёт браузеру напрямую.
  // Раньше они попадали в стратегию ниже: при наличии копии в кэше страница
  // получала её (устаревшую на один цикл), а свежий ответ всё равно качался
  // целиком в фоне и клался в кэш — тяжёлый узел /syncs/<id> скачивался
  // впритык дважды и оседал в Cache Storage. Остальные чужие адреса
  // (esm.sh, cdn.jsdelivr.net) по-прежнему кэшируются для оффлайна.
  // В режиме оффлайн эти запросы отсекает сама страница (fetchWithTimeout и
  // installOfflineFetchGuard в my.js).
  if (url.hostname.endsWith(".firebasedatabase.app") || url.hostname.endsWith(".firebaseio.com")) return;

  event.respondWith(
    isOfflineModeOn().then((offlineMode) =>
      caches.match(event.request).then((cached) => {
        // режим оффлайн (см. OFFLINE_MODE_CACHE выше): только кэш, без сети
        if (offlineMode) return cached || offlineModeFallback(event.request);

        // Есть в кэше текущей версии — отдаём как есть, в сеть не идём.
        if (cached) return cached;

        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        });
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
  // kind — тип уведомления (28.09: "group-task-new" — новая общая задача от другого
  // участника); для напоминаний не задан. Страница по нему решает, что показать.
  const kind = (event.notification.data && event.notification.data.kind) || "";
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
          new Response(JSON.stringify({ taskId: taskId, action: action, kind: kind, at: Date.now() }), {
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

// SKIP_WAITING больше никто не шлёт (кнопки обновления нет) — обработчик оставлен
// на случай старой закэшированной страницы; страница спрашивает текущую версию,
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
