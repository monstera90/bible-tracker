// flibusta.js — подключение к OPDS-каталогу (READER_PLAN.md, Этап E, шаг 17,
// 13.09.2026). Подход как в существующих читалках на Android (Moon+ Reader,
// FBReader): пользователь один раз вводит адрес OPDS-каталога (по умолчанию
// http://flibusta.net/opds), сам каталог уже отдаёт готовые списки книг
// (по алфавиту авторов, другие сортировки, поиск) — этот файл только
// разбирает OPDS-фид (Atom-подобный XML через DOMParser — здесь это ровно
// браузерный код, в отличие от fb2parse.js/docxparse.js тестировать в Node
// не нужно) и показывает как список для навигации.
//
// ВАЖНО (зафиксировано по ТЗ пользователя): то, что загрузка работает в
// нативных читалках (FBReader/Moon+ Reader), НИЧЕГО не говорит о том,
// заработает ли она в браузере — у нативных приложений нет понятия CORS,
// это чисто браузерное ограничение. Поэтому здесь нет предварительной
// проверки CORS "на бумаге": код просто пробует fetch() и по факту решает,
// какой из трёх исходов ТЗ сработал —
//   1) CORS есть и на фид, и на файл — качаем через fetch, пишем прямо в
//      OPFS books/ (см. saveBookFile в my.js), минуя системные "Загрузки";
//   2) CORS есть на фид, но нет на файл (или наоборот) — соответствующая
//      операция просто падает, ловится в try/catch и заменяется понятным
//      сообщением; это известное ограничение PWA без сервера-посредника —
//      резервный путь: открыть ссылку на файл напрямую (window.open) и
//      после ручного скачивания добавить книгу кнопкой "Загрузить fb2,
//      epub или zip книг" (вкладка "Книги");
//   3) CORS нет вовсе (даже фид не грузится) — тот же понятный статус,
//      каталог остаётся недоступен, но это НЕ блокирует остальной ридер —
//      других вкладок/функций этот модуль не касается.
// Отдельно стоит держать в уме: http://flibusta.net (без TLS) при показе
// со страницы, открытой по https, может дополнительно упираться в блокировку
// смешанного контента (mixed content) браузером — внешне это выглядит той
// же ошибкой fetch, отдельно не различается и не должно вводить в
// заблуждение при диагностике ("CORS" в статусе ниже — обобщённое имя для
// любого сетевого отказа браузера на этом запросе).
//
// UI-примитивы (mdeditor-cleanup-overlay/-card/-title/-input/-actions/
// -cancel/-primary, mdeditor-status, mdeditor-empty, workbooks-run-btn) —
// переиспользуются из уже существующих components.css/modals.css (см.
// openBookBookmarkNameDialog в my.js для образца того же приёма). Разметка
// ниже, которой в текущих таблицах стилей ещё нет (шапка экрана каталога,
// строка книги с несколькими кнопками формата), сделана временно через
// inline style — css-файлы в этой сессии не присылались; при следующей
// правке стоит перенести это в components.css/modals.css как отдельные
// классы (flibusta-*), не трогая существующие.
//
// Как и другие "заглушки" второго набора (search.js, epubsplit.js и т.п.),
// не переиспользует внутреннее устройство my.js напрямую — доступ только
// через deps.
(function(){
  "use strict";

  var DEFAULT_OPDS_URL = "http://flibusta.net/opds";
  var OPDS_URL_KEY = "flibustaOpdsUrl_v1";

  function initFlibustaModule(deps){
    deps = deps || {};
    var escapeHtml = deps.escapeHtml || function(s){ return String(s == null ? "" : s); };
    var getModalBox = deps.getModalBox || function(){ return null; };
    var saveBookFile = deps.saveBookFile;
    var registerBookInRegistry = deps.registerBookInRegistry || function(){};

    function getSavedOpdsUrl(){
      try{ return localStorage.getItem(OPDS_URL_KEY) || DEFAULT_OPDS_URL; }
      catch(e){ return DEFAULT_OPDS_URL; }
    }
    function saveOpdsUrl(url){
      try{ localStorage.setItem(OPDS_URL_KEY, url); }catch(e){}
    }

    function resolveUrl(href, baseUrl){
      try{ return new URL(href, baseUrl).href; }catch(e){ return href; }
    }

    // В браузере отказ CORS, блокировка смешанного контента и обычный
    // сетевой сбой неразличимы иначе как по тексту ошибки (например,
    // "Failed to fetch" в Chrome) — сообщение намеренно общее, чтобы не
    // выдавать неверный диагноз пользователю.
    function describeFetchError(e){
      return e && e.message ? e.message : String(e);
    }

    // ---- Разбор OPDS/Atom-фида ----
    function parseOpdsFeed(xmlText, feedUrl){
      var doc = new DOMParser().parseFromString(xmlText, "application/xml");
      if(doc.getElementsByTagName("parsererror").length){
        throw new Error("Не удалось разобрать OPDS-фид (сервер ответил не тем, что ожидалось).");
      }
      var feedTitleEl = doc.getElementsByTagName("title")[0];
      var feedTitle = feedTitleEl ? feedTitleEl.textContent.trim() : "";
      var entryEls = doc.getElementsByTagName("entry");
      var entries = [];
      for(var i = 0; i < entryEls.length; i++){
        entries.push(parseOpdsEntry(entryEls[i]));
      }
      // Пагинация: <link rel="next" .../> на уровне feed (не entry).
      var nextHref = null;
      var feedEl = doc.getElementsByTagName("feed")[0];
      if(feedEl){
        var topLinks = feedEl.childNodes;
        for(var j = 0; j < topLinks.length; j++){
          var node = topLinks[j];
          if(node.nodeType === 1 && node.tagName === "link" && (node.getAttribute("rel") || "") === "next"){
            nextHref = node.getAttribute("href");
          }
        }
      }
      return {
        title: feedTitle,
        entries: entries,
        nextHref: nextHref ? resolveUrl(nextHref, feedUrl) : null
      };
    }

    function parseOpdsEntry(entryEl){
      function textOf(tag){
        var els = entryEl.getElementsByTagName(tag);
        return els.length ? els[0].textContent.trim() : "";
      }
      var title = textOf("title") || "Без названия";
      var authorName = "";
      var authorEls = entryEl.getElementsByTagName("author");
      if(authorEls.length){
        var nameEls = authorEls[0].getElementsByTagName("name");
        authorName = nameEls.length ? nameEls[0].textContent.trim() : "";
      }
      var linkEls = entryEl.getElementsByTagName("link");
      var acquisitionLinks = [];
      var navHref = null;
      for(var i = 0; i < linkEls.length; i++){
        var l = linkEls[i];
        var rel = l.getAttribute("rel") || "";
        var type = l.getAttribute("type") || "";
        var href = l.getAttribute("href") || "";
        if(!href) continue;
        if(rel.indexOf("http://opds-spec.org/acquisition") === 0){
          acquisitionLinks.push({ href: href, type: type, rel: rel });
        } else if(!navHref && rel.indexOf("http://opds-spec.org/image") !== 0 && rel !== "alternate"){
          // Первая ссылка, которая не картинка и не "acquisition" —
          // считаем ссылкой навигации/подраздела (папка каталога).
          navHref = href;
        }
      }
      return {
        title: title,
        author: authorName,
        acquisitionLinks: acquisitionLinks,
        navHref: acquisitionLinks.length ? null : navHref,
        isBook: acquisitionLinks.length > 0
      };
    }

    function extFromLink(link){
      var t = (link.type || "").toLowerCase();
      if(t.indexOf("fb2") !== -1) return t.indexOf("zip") !== -1 ? "fb2.zip" : "fb2";
      if(t.indexOf("epub") !== -1) return "epub";
      var m = /\.(fb2|epub|zip)(?:$|\?)/i.exec(link.href);
      return m ? m[1].toLowerCase() : "fb2";
    }
    function labelForLink(link){
      var ext = extFromLink(link);
      if(ext === "fb2.zip") return "FB2 (zip)";
      if(ext === "fb2") return "FB2";
      if(ext === "epub") return "EPUB";
      return "Скачать";
    }
    // Имя файла из заголовка книги — та же идея, что и в остальном проекте
    // (например suggestFreeBookName в my.js), просто без диалога: чистим
    // символы, недопустимые в именах файлов на большинстве ФС.
    function sanitizeBookFileName(name){
      var cleaned = (name || "book").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
      return cleaned || "book";
    }

    // ---- Экран каталога ----
    var overlayEl = null;
    var navStack = []; // [{url, title}] — стек уровней каталога для кнопки "Назад"

    function close(){
      if(overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null;
      navStack = [];
    }

    function openFlibustaCatalog(){
      var modalBox = getModalBox();
      if(!modalBox) return;
      close(); // на всякий случай не открывать два экрана каталога одновременно
      overlayEl = document.createElement("div");
      overlayEl.className = "mdeditor-cleanup-overlay";
      var card = document.createElement("div");
      card.className = "mdeditor-cleanup-card";
      card.style.maxHeight = "82vh";
      card.style.overflowY = "auto";
      card.style.width = "min(92vw, 480px)";
      overlayEl.appendChild(card);
      modalBox.appendChild(overlayEl);
      overlayEl.addEventListener("click", function(ev){ if(ev.target === overlayEl) close(); });

      renderSetupScreen(card, getSavedOpdsUrl());
    }

    function renderSetupScreen(card, urlValue){
      navStack = [];
      card.innerHTML =
        '<div class="mdeditor-cleanup-title">Каталог Flibusta</div>' +
        '<div style="opacity:.75;font-size:.92em;margin-bottom:8px;">' +
          'Адрес OPDS-каталога (как в других читалках — например Moon+ Reader). ' +
          'Официальный адрес не всегда доступен из браузера — можно указать рабочее зеркало.' +
        '</div>' +
        '<input type="text" class="mdeditor-cleanup-input" id="flibustaUrlInput" value="' + escapeHtml(urlValue) + '">' +
        '<div class="mdeditor-status" id="flibustaSetupStatus"></div>' +
        '<div class="mdeditor-cleanup-actions">' +
          '<button type="button" class="mdeditor-cleanup-cancel" id="flibustaSetupCancel">Закрыть</button>' +
          '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="flibustaSetupGo">Подключиться</button>' +
        '</div>';
      var input = document.getElementById("flibustaUrlInput");
      document.getElementById("flibustaSetupCancel").addEventListener("click", close);
      document.getElementById("flibustaSetupGo").addEventListener("click", submit);
      input.addEventListener("keydown", function(ev){
        if(ev.key === "Enter"){ ev.preventDefault(); submit(); }
      });
      function submit(){
        var url = (input.value || "").trim();
        if(!url) return;
        saveOpdsUrl(url);
        loadLevel(card, url, "Flibusta");
      }
    }

    function renderLoadingScreen(card, title){
      card.innerHTML =
        '<div class="mdeditor-cleanup-title">' + escapeHtml(title || "Flibusta") + '</div>' +
        '<div class="mdeditor-empty">Загрузка…</div>';
    }

    function renderErrorScreen(card, url, title, e){
      var msg = describeFetchError(e);
      card.innerHTML =
        '<div class="mdeditor-cleanup-title">Не удалось загрузить каталог</div>' +
        '<div style="opacity:.75;font-size:.9em;word-break:break-all;">Адрес: ' + escapeHtml(url) + '</div>' +
        '<div class="mdeditor-status error">' + escapeHtml(msg) + ' — вероятно, каталог недоступен из ' +
          'этого браузера (ограничение CORS или смешанного http/https-контента). Это известное ' +
          'ограничение PWA без собственного сервера-посредника — можно попробовать другой адрес ' +
          'или рабочее зеркало.</div>' +
        '<div class="mdeditor-cleanup-actions">' +
          '<button type="button" class="mdeditor-cleanup-cancel" id="flibustaErrChangeUrl">Изменить адрес</button>' +
          '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="flibustaErrRetry">Повторить</button>' +
        '</div>' +
        '<div class="mdeditor-cleanup-actions">' +
          '<button type="button" class="mdeditor-cleanup-cancel" id="flibustaErrClose">Закрыть</button>' +
        '</div>';
      document.getElementById("flibustaErrClose").addEventListener("click", close);
      document.getElementById("flibustaErrRetry").addEventListener("click", function(){ loadLevel(card, url, title); });
      document.getElementById("flibustaErrChangeUrl").addEventListener("click", function(){
        renderSetupScreen(card, url);
      });
      if(window.Debug) window.Debug.log("flibusta: не удалось загрузить фид " + url + " — " + msg);
    }

    function loadLevel(card, url, title){
      renderLoadingScreen(card, title);
      fetch(url).then(function(res){
        if(!res.ok) throw new Error("Сервер ответил HTTP " + res.status);
        return res.text();
      }).then(function(text){
        var feed = parseOpdsFeed(text, url);
        navStack.push({ url: url, title: title });
        renderFeedScreen(card, feed, title, url);
      }).catch(function(e){
        renderErrorScreen(card, url, title, e);
      });
    }

    function goBack(card){
      if(navStack.length <= 1){ close(); return; }
      navStack.pop(); // текущий уровень
      var prev = navStack.pop(); // предыдущий — loadLevel добавит его заново
      loadLevel(card, prev.url, prev.title);
    }

    function renderFeedScreen(card, feed, title, feedUrl){
      var entries = feed.entries.slice();
      var nextHref = feed.nextHref;

      function redraw(){
        var backBtnHtml = navStack.length > 1 ?
          '<button type="button" class="mdeditor-cleanup-cancel" id="flibustaBackBtn" style="margin-right:6px;">&larr; Назад</button>' : '';
        var html = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
          backBtnHtml +
          '<div class="mdeditor-cleanup-title" style="flex:1;margin:0;word-break:break-word;">' + escapeHtml(feed.title || title) + '</div>' +
          '<button type="button" class="mdeditor-cleanup-cancel" id="flibustaCloseBtn">&times;</button>' +
        '</div>';
        html += '<div class="mdeditor-status" id="flibustaListStatus"></div>';
        if(!entries.length){
          html += '<div class="mdeditor-empty">Здесь пусто.</div>';
        } else {
          html += '<div class="mdeditor-list">';
          entries.forEach(function(entry, idx){
            if(entry.isBook){
              html += '<div class="mdeditor-row" style="flex-direction:column;align-items:flex-start;gap:4px;" data-book-idx="' + idx + '">' +
                '<div>' + escapeHtml(entry.title) + '</div>' +
                (entry.author ? '<div style="opacity:.7;font-size:.88em;">' + escapeHtml(entry.author) + '</div>' : '') +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  entry.acquisitionLinks.map(function(l, li){
                    return '<button type="button" class="workbooks-run-btn" data-dl-idx="' + idx + '" data-dl-li="' + li + '">' +
                      escapeHtml(labelForLink(l)) + '</button>';
                  }).join("") +
                '</div>' +
              '</div>';
            } else {
              html += '<div class="mdeditor-row" data-nav-idx="' + idx + '">' +
                '<span class="mdeditor-row-name">' + escapeHtml(entry.title) + '</span></div>';
            }
          });
          html += '</div>';
        }
        if(nextHref){
          html += '<div class="mdeditor-cleanup-actions"><button type="button" class="mdeditor-cleanup-cancel" id="flibustaMoreBtn">Показать ещё</button></div>';
        }
        card.innerHTML = html;
        bind();
      }

      function setListStatus(msg, isError, extraHtml){
        var el = document.getElementById("flibustaListStatus");
        if(!el) return;
        el.innerHTML = escapeHtml(msg || "") + (extraHtml || "");
        el.classList.toggle("error", !!isError);
      }

      function bind(){
        var backBtn = document.getElementById("flibustaBackBtn");
        if(backBtn) backBtn.addEventListener("click", function(){ goBack(card); });
        var closeBtn = document.getElementById("flibustaCloseBtn");
        if(closeBtn) closeBtn.addEventListener("click", close);

        var navRows = card.querySelectorAll("[data-nav-idx]");
        for(var i = 0; i < navRows.length; i++){
          navRows[i].addEventListener("click", function(){
            var entry = entries[Number(this.getAttribute("data-nav-idx"))];
            if(!entry.navHref) return;
            loadLevel(card, resolveUrl(entry.navHref, feedUrl), entry.title);
          });
        }
        var dlBtns = card.querySelectorAll("[data-dl-idx]");
        for(var j = 0; j < dlBtns.length; j++){
          dlBtns[j].addEventListener("click", function(){
            var entry = entries[Number(this.getAttribute("data-dl-idx"))];
            var link = entry.acquisitionLinks[Number(this.getAttribute("data-dl-li"))];
            downloadBook(entry, link);
          });
        }
        var moreBtn = document.getElementById("flibustaMoreBtn");
        if(moreBtn){
          moreBtn.addEventListener("click", function(){
            moreBtn.disabled = true;
            moreBtn.textContent = "Загрузка…";
            fetch(nextHref).then(function(res){
              if(!res.ok) throw new Error("Сервер ответил HTTP " + res.status);
              return res.text();
            }).then(function(text){
              var more = parseOpdsFeed(text, nextHref);
              entries = entries.concat(more.entries);
              nextHref = more.nextHref;
              redraw();
            }).catch(function(e){
              setListStatus("Не удалось загрузить продолжение списка: " + describeFetchError(e), true);
              moreBtn.disabled = false;
              moreBtn.textContent = "Показать ещё";
            });
          });
        }
      }

      function downloadBook(entry, link){
        var href = resolveUrl(link.href, feedUrl);
        setListStatus("Скачивание «" + entry.title + "»…", false);
        fetch(href).then(function(res){
          if(!res.ok) throw new Error("Сервер ответил HTTP " + res.status);
          return res.arrayBuffer();
        }).then(function(buf){
          var ext = extFromLink(link);
          // fb2 внутри zip (частый формат отдачи у OPDS-каталогов) —
          // распаковываем один .fb2 из архива тем же MiniZip.extractAllFiles,
          // что и при ручной загрузке .zip книг (см. handleImportBooksFile
          // в my.js) — сам .zip как книгу не сохраняем.
          if(ext === "fb2.zip"){
            if(!window.MiniZip || !window.MiniZip.extractAllFiles){
              throw new Error("Модуль ZIP (minizip.js) не загружен.");
            }
            return window.MiniZip.extractAllFiles(buf).then(function(files){
              var fb2 = files.filter(function(f){ return /\.fb2$/i.test(f.path); })[0];
              if(!fb2) throw new Error("В .zip не найден файл .fb2.");
              return saveBookFile(sanitizeBookFileName(entry.title) + ".fb2", fb2.data);
            });
          }
          var fname = sanitizeBookFileName(entry.title) + "." + ext;
          return saveBookFile(fname, new Uint8Array(buf));
        }).then(function(result){
          if(result.added) registerBookInRegistry(result.hash, result.name, result.size);
          setListStatus(result.added ?
            ("Книга сохранена: «" + result.name + "».") :
            ("Такая книга уже была загружена раньше (файл «" + result.name + "»)."), false);
        }).catch(function(e){
          if(window.Debug) window.Debug.log("flibusta: не удалось скачать " + href + " — " + describeFetchError(e));
          setListStatus(
            "Не удалось скачать файл через приложение — вероятно, браузер блокирует этот запрос " +
            "(CORS или смешанный контент); это известное ограничение PWA без сервера-посредника. " +
            "Можно открыть ссылку напрямую, скачать файл в системные «Загрузки», а затем добавить " +
            "его кнопкой «Загрузить fb2, epub или zip книг» на вкладке «Книги».",
            true,
            '<br><button type="button" class="mdeditor-cleanup-cancel" id="flibustaOpenLinkBtn" style="margin-top:6px;">Открыть ссылку в браузере</button>'
          );
          var openBtn = document.getElementById("flibustaOpenLinkBtn");
          if(openBtn) openBtn.addEventListener("click", function(){ window.open(href, "_blank"); });
        });
      }

      redraw();
    }

    return { openFlibustaCatalog: openFlibustaCatalog };
  }

  window.initFlibustaModule = initFlibustaModule;
})();
