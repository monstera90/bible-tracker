// Service Worker для "Графика чтения Библии".
// Отвечает за офлайн-доступ и бесшовное обновление страницы.
//
// ВАЖНО ПРИ ВЫПУСКЕ НОВОЙ ВЕРСИИ: поменяйте APP_VERSION ниже (например,
// "v0.6.0" -> "v0.7.0"). Именно эта строка заставляет браузер заметить,
// что sw.js изменился, скачать новую версию в фоне и подготовить её к
// установке — без этого шага обновление не будет обнаружено автоматически.

const APP_VERSION = "v0.35.10";
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
  "./flibusta.js",
  "./DejaVuSans.ttf",
  "./icon-192x192.png",
  "./icon-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
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
            .filter((key) => key !== CACHE_NAME)
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
    caches.match(event.request).then((cached) => {
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
  );
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
