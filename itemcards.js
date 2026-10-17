/* ===========================================================================
   itemcards.js
   Версия: 5.0 (17.10) — структурная правка: кнопка «PDF» в нижнем ряду (после сканера; на Android 5 её нет) и меню «4 / 12 / 24 на лист» — `openPdfMenu`/`exportPdf`, сборка листов в cardpdf.js, сохранение в «Загрузки» через <a download>. Откат: itemcards.js 4.0.
   Версия: 4.0 (17.10) — структурная правка: таймеры карточек (шаг 5а ТЗ): кнопка «Пуск» (внизу по центру) на карточке-таймере, оставшееся время в сетке и на показе по скану, запуск таймера по скану (`startTimerForCard`, `getTimerApi`: оболочка — CardTimers через мост, scan.html — `deps.timers`, браузер — запасной таймер в localStorage `itemCardTimers_v1`). Откат: itemcards.js 3.0.
   Версия: 3.0 (17.10) — структурная правка: синхронизация записей карточек (вариант А ТЗ, 12.4): зеркало каждой карточки в скрытой записи заметок через mdeditor.js (`cardMetaSave/Remove/All/Pull/Status`), сверка `reconcileCloud` (last-write-wins по updatedAt; «уже синхронизирована» и «удалить в облаке» хранятся в `itemCardsSync_v1`), запуск при входе во вкладку, после каждого сохранения (debounce) и по приходу правок с другого устройства. Откат: itemcards.js 2.0.
   Версия: 2.0 (16.10) — структурная правка: сканирование (шаги 3 и 5 ТЗ): кнопка сканера, слой «карточка при сканировании», кнопка «сегодняшняя дата», «карточка не найдена» → создание с тем же id, чужие коды; режим standalone для scan.html (ScanActivity); `openCardFromNative`.
   Вкладка «Карточки предметов» (девятая боковая вкладка второго набора,
   settingsTabSet2Btn9 / "set2s_9"), ТЗ TASK_ITEM_CARDS_QR.md.

   Что здесь сделано (шаги 1, 2, 4, 5б, 7 плана ТЗ):
   - сетка карточек 2:3, число колонок считается от ширины карточки;
   - три типа: «таймер», «предмет», «заметка»; формы создания/правки;
   - у каждой карточки личный id (8 знаков) и QR `lt://v1/card/<id>` на обороте
     (двойной тап; QR строится лениво, библиотека vendor/qrcode.min.js);
   - долгий тап раскрывает кнопки «правка»/«удаление» (те же классы, что у обложек книг);
   - ползунок размера (0,7–2), нижний ряд кнопок;
   - карточка-заметка: тело хранится в скрытой заметке «Моего блокнота» (путь
     CARD_NOTES_PATH, см. mdeditor.js: createCardNote/openCardNote) и открывается
     тем же редактором.

   Сканирование: камера и разбор кода — cardscan.js (CardScan); показ результата — здесь
   (openScan → handleScanned → showCardOverlay / showNoticeOverlay). Тот же код работает на
   странице scan.html (deps.standalone + deps.native, мост ScanBridge из ScanActivity.kt).

   Чего здесь ещё нет (следующие шаги ТЗ): таймер по скану (Пуск), PDF, напоминания, облачная синхронизация записей карточек (тело карточки-заметки
   синхронизируется вместе с заметками, сами записи карточек пока только на устройстве).

   Хранилище записей — только функции loadCards/saveCards (localStorage), чтобы потом
   подменить их на sync-engine, не трогая остальной код.
   =========================================================================== */

window.initItemCardsModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml;
  var READER_HOME_ICON_SVG = deps.READER_HOME_ICON_SVG;
  var PENCIL_ICON_SVG = deps.PENCIL_ICON_SVG;
  var DELETE_ICON_SVG = deps.DELETE_ICON_SVG;
  var openAppConfirmBar = deps.openAppConfirmBar;
  var getMdEditor = deps.getMdEditor || function(){ return null; };
  var standalone = !!deps.standalone;   // true на странице scan.html (окно ScanActivity, без приложения)
  var nativeScan = deps.native || null; // мост оболочки: openInApp(id, mode), openUrl(url), close()

  var CARDS_KEY = "itemCards_v1";
  var SIZE_KEY = "itemCardsSize_v1";
  var QR_PREFIX = "lt://v1/card/";
  var SIZE_MIN = 0.7, SIZE_MAX = 2;
  var ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // без похожих знаков (i, l, o, 0, 1)

  // ---------- пиктограммы: имя -> содержимое <svg> (стиль закладок: 24x24, линия 1,7) ----------
  var ICONS = {
    bottle: '<path d="M10 2.5h4v3l1.5 2.5v12.2a1.3 1.3 0 0 1-1.3 1.3H9.8a1.3 1.3 0 0 1-1.3-1.3V8L10 5.5z"></path><path d="M8.5 12h7"></path><path d="M8.5 16h7"></path>',
    container: '<rect x="3" y="8" width="18" height="11" rx="2"></rect><path d="M5 8V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V8"></path><path d="M8 13.5h8"></path>',
    jar: '<path d="M8 3h8v2.5H8z"></path><path d="M7 5.5h10v2c1.2.8 2 2 2 3.5v7a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-7c0-1.5.8-2.7 2-3.5z"></path><path d="M9 13h6"></path>',
    bicycle: '<circle cx="6" cy="16" r="3.5"></circle><circle cx="18" cy="16" r="3.5"></circle><path d="M6 16l4-7h5l3 7"></path><path d="M10 9l2.5 7"></path><path d="M9 6.5h2.5"></path><path d="M15 9l-1-2.5h2"></path>',
    car: '<path d="M4 12l2-4.5a2 2 0 0 1 1.8-1.2h8.4a2 2 0 0 1 1.8 1.2L20 12"></path><path d="M3.5 12h17v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"></path><path d="M6.5 15h.01M17.5 15h.01"></path><path d="M6 18v2M18 18v2"></path>',
    vegetable: '<path d="M12 7.5c-4.5 0-7.5 2.6-7.5 6.2 0 3.6 3 6.3 7.5 6.3s7.5-2.7 7.5-6.3c0-3.6-3-6.2-7.5-6.2z"></path><path d="M12 7.5V4"></path><path d="M12 7.5c-2-.5-3.5-1.5-4-3 2 0 3.5.5 4 1.5M12 7.5c2-.5 3.5-1.5 4-3-2 0-3.5.5-4 1.5"></path>',
    paper: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4"></path><path d="M9 12h6M9 15.5h6"></path>'
  };
  var ICON_ORDER = ["bottle", "container", "jar", "bicycle", "car", "vegetable", "paper"];
  var DEFAULT_ICON = { note: "paper", item: "", timer: "" };
  function iconSvg(name){
    if(!name || !ICONS[name]) return "";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }
  var PLUS_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  var SIZE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="12" rx="1.5"></rect><rect x="13" y="9" width="8" height="12" rx="1.5"></rect></svg>';
  var SCAN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"></path><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"></path><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"></path><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"></path><rect x="8" y="8" width="3" height="3"></rect><rect x="13" y="8" width="3" height="3"></rect><rect x="8" y="13" width="3" height="3"></rect><path d="M13 13h3v3"></path></svg>';
  // часы со стрелкой вокруг («история»), слегка изменённые: стрелка по часовой, на кнопке «сегодняшняя дата»
  var TODAY_ICON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"></path><path d="M20 4v4.5h-4.5"></path><path d="M12 7.5V12l3 2"></path></svg>';
  var PDF_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z"></path><path d="M14 3v4h4"></path><path d="M9 12.5h6"></path><path d="M9 15.5h6"></path><path d="M9 18h3"></path></svg>';
  var PAGE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v4h4"></path></svg>';

  // ---------- хранилище ----------
  var cardsCache = null;
  function loadCards(){
    if(cardsCache) return cardsCache;
    var arr = [];
    try{ arr = JSON.parse(localStorage.getItem(CARDS_KEY) || "[]"); }catch(e){ arr = []; }
    if(!Array.isArray(arr)) arr = [];
    cardsCache = arr.filter(function(c){ return c && c.id && c.type; });
    return cardsCache;
  }
  function persistCards(){
    try{ localStorage.setItem(CARDS_KEY, JSON.stringify(cardsCache || [])); }catch(e){}
  }
  // сохранить и поставить сверку с облаком в очередь (в scan.html облака нет — сверка при следующем входе во вкладку)
  function saveCards(){
    persistCards();
    scheduleCloudSync();
  }

  // ---------- синхронизация записей карточек (вариант А ТЗ 12.4) ----------
  // Источник для экрана — localStorage (как раньше). Зеркало — скрытая запись заметок на каждую карточку
  // (mdeditor.js: cardMeta*), её шифрует, отправляет и принимает движок заметок. Конфликт — по updatedAt (новее побеждает).
  // «Синхронизирована» (itemCardsSync_v1.synced) — запись уже была в облаке: если потом её там нет, а облако прочитано целиком,
  // значит удалена на другом устройстве. «Удалить в облаке» (pending) — карточки, удалённые здесь.
  var SYNC_KEY = "itemCardsSync_v1";
  function loadSyncInfo(){
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); }catch(e){ o = null; }
    if(!o || typeof o !== "object") o = {};
    if(!o.synced || typeof o.synced !== "object") o.synced = {};
    if(!Array.isArray(o.pending)) o.pending = [];
    return o;
  }
  function saveSyncInfo(o){
    try{ localStorage.setItem(SYNC_KEY, JSON.stringify(o)); }catch(e){}
  }
  // запись карточки в том виде, как она ходит между устройствами (и проверка пришедшей из облака)
  function cloudShape(r){
    if(!r || typeof r.id !== "string" || !/^[A-Za-z0-9]{4,32}$/.test(r.id)) return null;
    if(r.type !== "timer" && r.type !== "item" && r.type !== "note") return null;
    var o = {
      id: r.id,
      type: r.type,
      title: String(r.title == null ? "" : r.title).slice(0, 200),
      icon: String(r.icon == null ? "" : r.icon).slice(0, 40),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) ? r.date : "",
      seconds: Math.max(0, Math.floor(Number(r.seconds) || 0)),
      createdAt: Number(r.createdAt) || 0,
      updatedAt: Number(r.updatedAt) || 0
    };
    if(r.type === "note") o.noteId = String(r.noteId == null ? "" : r.noteId).slice(0, 64);
    return o;
  }
  // true — локальный список изменился (пришло из облака / удалено на другом устройстве)
  function reconcileCloud(){
    var md = getMdEditor();
    if(standalone || !md || !md.cardMetaStatus || !md.cardMetaAll) return false;
    var st = md.cardMetaStatus();
    if(!st || !st.ready) return false; // синхронизация не настроена или заметки не загружены: карточки живут только здесь
    var info = loadSyncInfo();
    var changed = false;
    // 1) удалённые здесь — убрать из облака (если id уже занят новой карточкой, не трогаем)
    info.pending.forEach(function(id){ if(!findCard(id)) md.cardMetaRemove(id); });
    info.pending = [];
    // 2) облако → словарь
    var remote = {};
    md.cardMetaAll().forEach(function(r){
      var n = cloudShape(r);
      if(n) remote[n.id] = n;
    });
    // 3) локальные карточки против облака
    var out = [];
    loadCards().forEach(function(c){
      var r = remote[c.id];
      if(!r){
        if(info.synced[c.id]){
          // была в облаке, теперь нет: удалена на другом устройстве — но только если облако прочитано целиком
          if(st.pulled){ delete info.synced[c.id]; changed = true; return; }
          out.push(c);
          return;
        }
        var mine = cloudShape(c);
        if(mine){ md.cardMetaSave(mine); info.synced[c.id] = 1; }
        out.push(c);
        return;
      }
      delete remote[c.id];
      info.synced[c.id] = 1;
      var ru = r.updatedAt || 0, lu = c.updatedAt || 0;
      if(ru > lu){ out.push(r); changed = true; return; }
      if(lu > ru){ var m2 = cloudShape(c); if(m2) md.cardMetaSave(m2); }
      out.push(c);
    });
    // 4) новые из облака
    Object.keys(remote).forEach(function(id){
      out.push(remote[id]);
      info.synced[id] = 1;
      changed = true;
    });
    saveSyncInfo(info);
    if(changed){ cardsCache = out; persistCards(); }
    return changed;
  }
  function gridVisible(){ return screenMode === "grid" && !!document.getElementById("itemCardsGrid"); }
  var cloudSyncTimer = null;
  function scheduleCloudSync(){
    if(standalone) return;
    if(cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(function(){
      cloudSyncTimer = null;
      if(reconcileCloud() && gridVisible()) renderGrid();
    }, 800);
  }
  var cloudListenerSet = false;
  function cloudSyncOnEnter(){
    var md = getMdEditor();
    if(standalone || !md || !md.cardMetaPull) return;
    if(!cloudListenerSet && md.setCardMetaListener){
      cloudListenerSet = true;
      // приход записей карточек с другого устройства, пока вкладка открыта
      md.setCardMetaListener(function(){ if(reconcileCloud() && gridVisible()) renderGrid(); });
    }
    if(reconcileCloud()) renderGrid();
    md.cardMetaPull().then(function(){
      if(reconcileCloud() && gridVisible()) renderGrid();
    });
  }
  function findCard(id){
    var list = loadCards();
    for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
    return null;
  }
  function newId(){
    var out = "";
    var buf = new Uint8Array(8);
    if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    else for(var i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
    for(var j = 0; j < 8; j++) out += ID_ALPHABET.charAt(buf[j] % ID_ALPHABET.length);
    return findCard(out) ? newId() : out;
  }
  function todayIso(){
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function isoToRu(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? (m[3] + "." + m[2] + "." + m[1]) : "";
  }
  function formatTimer(sec){
    sec = Math.max(0, sec | 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + pad2(m) : m) + ":" + pad2(s);
  }

  // ---------- размер карточки ----------
  function getScale(){
    var v = parseFloat(localStorage.getItem(SIZE_KEY));
    if(!isFinite(v)) v = 1;
    return Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));
  }
  function setScale(v){
    try{ localStorage.setItem(SIZE_KEY, String(v)); }catch(e){}
  }
  // базовая ширина = две нижние вкладки приложения (замер реальной кнопки), запасное значение 112px
  function baseWidthPx(){
    var tab = document.getElementById("settingsTabYearBtn") || document.getElementById("settingsTabMoodBtn");
    var w = tab ? tab.getBoundingClientRect().width : 0;
    return w > 20 ? Math.round(w * 2) : 112;
  }
  function applySize(rootEl){
    if(!rootEl) return;
    rootEl.style.setProperty("--item-card-w", Math.round(baseWidthPx() * getScale()) + "px");
  }

  // ---------- состояние экрана ----------
  var screenMode = "grid"; // grid | form
  var revealedIds = {};
  var flippedId = null;
  var typeMenuOpen = false;

  function container(){ return document.getElementById("settingsTabContent"); }
  // Android 5: PDF не реализуется (решение заказчика, ТЗ 16.10.2026) — кнопки нет
  function isAndroid5(){ return /Android [1-5]\./.test(navigator.userAgent || ""); }
  function isLegacyAnim(){
    try{
      if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    }catch(e){}
    return /Android [1-5]\./.test(navigator.userAgent || "");
  }

  // ---------- сетка ----------
  function cardFrontHtml(c){
    var icon = iconSvg(c.icon);
    if(c.type === "timer"){
      return '<div class="item-card-title"></div>' +
        '<div class="item-card-time" data-id="' + escapeHtml(c.id) + '">' + escapeHtml(timerTextFor(c)) + '</div>' +
        '<button type="button" class="item-card-start-btn" title="Запустить таймер">Пуск</button>';
    }
    return '<div class="item-card-icon">' + icon + '</div>' +
      '<div class="item-card-title"></div>' +
      '<div class="item-card-date">' + escapeHtml(isoToRu(c.date)) + '</div>' +
      (c.type === "note" ? '<button type="button" class="item-card-page-btn" title="Поля карточки">' + PAGE_ICON_SVG + '</button>' : '');
  }
  function renderGrid(){
    screenMode = "grid";
    var el = container();
    if(!el) return;
    var cards = loadCards();
    var html = '<div class="mdeditor-tab item-cards-tab" id="itemCardsTab">';
    html += '<div class="item-cards-grid" id="itemCardsGrid"></div>';
    html += '<div class="item-type-menu" id="itemTypeMenu" style="display:none;">' +
      '<button type="button" class="workbooks-run-btn" data-type="timer">Таймер</button>' +
      '<button type="button" class="workbooks-run-btn" data-type="item">Предмет</button>' +
      '<button type="button" class="workbooks-run-btn" data-type="note">Заметка</button>' +
    '</div>';
    var showPdf = !isAndroid5();
    if(showPdf){
      html += '<div class="item-type-menu" id="itemPdfMenu" style="display:none;">' +
        '<button type="button" class="workbooks-run-btn" data-per="4">Большие (4 на лист)</button>' +
        '<button type="button" class="workbooks-run-btn" data-per="12">Средние (12 на лист)</button>' +
        '<button type="button" class="workbooks-run-btn" data-per="24">Маленькие (24 на лист)</button>' +
        '<div class="item-pdf-status" id="itemPdfStatus" style="display:none;"></div>' +
      '</div>';
    }
    html += '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsAddBtn" title="Новая карточка">' + PLUS_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsScanBtn" title="Сканировать QR-код">' + SCAN_ICON_SVG + '</button>' +
      (showPdf ? '<button type="button" class="mdeditor-fab-btn" id="itemCardsPdfBtn" title="PDF с QR-кодами для печати">' + PDF_ICON_SVG + '</button>' : '') +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsSizeBtn" title="Размер карточек">' + SIZE_ICON_SVG + '</button>' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsHomeStub" tabindex="-1" aria-disabled="true">' + READER_HOME_ICON_SVG + '</button>' +
    '</div>';
    html += '<div class="fontsize-bar" id="itemCardsSizeBar">' +
      '<span class="task-iconsize-dot task-iconsize-dot-s"></span>' +
      '<input type="range" class="fontsize-bar-range" id="itemCardsSizeRange" min="' + SIZE_MIN + '" max="' + SIZE_MAX + '" step="0.05" value="1" aria-label="Размер карточек">' +
      '<span class="task-iconsize-dot task-iconsize-dot-l"></span>' +
      '<span class="fontsize-bar-val" id="itemCardsSizeVal"></span>' +
    '</div>';
    html += '</div>';
    el.innerHTML = html;
    var tab = document.getElementById("itemCardsTab");
    applySize(tab);

    var grid = document.getElementById("itemCardsGrid");
    if(!cards.length){
      grid.className = "item-cards-grid item-cards-empty";
    }
    cards.forEach(function(c){
      var card = document.createElement("div");
      card.className = "item-card item-card-" + c.type;
      card.dataset.id = c.id;
      var revealed = !!revealedIds[c.id];
      card.innerHTML =
        '<div class="item-card-front">' + cardFrontHtml(c) + '</div>' +
        '<div class="item-card-back" style="display:none;"><div class="item-card-qr"></div></div>' +
        '<div class="book-cover-actions">' +
          '<button type="button" class="mdeditor-edit-btn' + (revealed ? " visible" : "") + '" title="Изменить">' + PENCIL_ICON_SVG + '</button>' +
          '<button type="button" class="mdeditor-delete-btn' + (revealed ? " visible" : "") + '" title="Удалить">' + DELETE_ICON_SVG + '</button>' +
        '</div>';
      card.querySelector(".item-card-title").textContent = c.title || "";
      grid.appendChild(card);
    });
    bindGrid(grid);
    syncTimersView();
    bindFab(tab);
    if(flippedId && findCard(flippedId)) flipCard(flippedId, true, true); else flippedId = null;
  }

  function cardEl(id){
    return document.querySelector('#itemCardsGrid .item-card[data-id="' + id + '"]');
  }

  // ---------- оборот карточки: QR ----------
  function buildQr(card, id){
    var host = card.querySelector(".item-card-qr");
    if(!host || host.dataset.built === id) return;
    host.dataset.built = id;
    host.innerHTML = "";
    deps.loadQrLib().then(function(){
      if(host.dataset.built !== id) return;
      var size = Math.max(60, Math.round(card.clientWidth * 0.72));
      try{ new window.QRCode(host, { text: QR_PREFIX + id, width: size, height: size, colorDark: "#000000", colorLight: "#ffffff" }); }catch(e){}
    }).catch(function(){ host.textContent = "QR недоступен"; });
  }
  function setFace(card, back){
    card.querySelector(".item-card-front").style.display = back ? "none" : "";
    card.querySelector(".item-card-back").style.display = back ? "flex" : "none";
    card.classList.toggle("flipped", !!back);
  }
  function flipCard(id, toBack, instant){
    var card = cardEl(id);
    if(!card) return;
    if(toBack) buildQr(card, id);
    if(instant || isLegacyAnim()){ setFace(card, toBack); }
    else {
      // лёгкая анимация: только transform на одной карточке (сжали по X, сменили сторону, вернули)
      card.style.transition = "transform .15s ease-in";
      card.style.transform = "scaleX(0.02)";
      setTimeout(function(){
        setFace(card, toBack);
        card.style.transition = "transform .15s ease-out";
        card.style.transform = "scaleX(1)";
        setTimeout(function(){ card.style.transition = ""; card.style.transform = ""; }, 170);
      }, 150);
    }
    flippedId = toBack ? id : null;
  }
  function unflipAny(){
    if(flippedId) flipCard(flippedId, false);
  }

  function hideRevealed(){
    var any = false;
    for(var k in revealedIds){ if(revealedIds.hasOwnProperty(k)){ any = true; break; } }
    if(!any) return;
    revealedIds = {};
    var btns = document.querySelectorAll("#itemCardsGrid .mdeditor-edit-btn.visible, #itemCardsGrid .mdeditor-delete-btn.visible");
    for(var i = 0; i < btns.length; i++) btns[i].classList.remove("visible");
  }

  function bindGrid(grid){
    var LONG_MS = 350, MOVE_PX = 10, DOUBLE_MS = 300;
    var pressTimer = null, startXY = null, longFired = false;
    var lastTapId = null, lastTapAt = 0, singleTimer = null;
    function clearPress(){ clearTimeout(pressTimer); pressTimer = null; }
    function startPress(cardNode, x, y){
      if(!cardNode) return;
      longFired = false; startXY = { x: x, y: y };
      clearPress();
      pressTimer = setTimeout(function(){
        longFired = true;
        revealedIds[cardNode.dataset.id] = true;
        var btns = cardNode.querySelectorAll(".mdeditor-edit-btn, .mdeditor-delete-btn");
        for(var i = 0; i < btns.length; i++) btns[i].classList.add("visible");
      }, LONG_MS);
    }
    function movePress(x, y){
      if(!startXY) return;
      var dx = x - startXY.x, dy = y - startXY.y;
      if(Math.sqrt(dx * dx + dy * dy) > MOVE_PX) clearPress();
    }
    grid.addEventListener("touchstart", function(e){ var t = e.touches[0]; startPress(e.target.closest(".item-card"), t.clientX, t.clientY); }, { passive: true });
    grid.addEventListener("touchmove", function(e){ var t = e.touches[0]; movePress(t.clientX, t.clientY); }, { passive: true });
    grid.addEventListener("touchend", clearPress);
    grid.addEventListener("touchcancel", clearPress);
    grid.addEventListener("mousedown", function(e){ startPress(e.target.closest(".item-card"), e.clientX, e.clientY); });
    grid.addEventListener("mousemove", function(e){ movePress(e.clientX, e.clientY); });
    grid.addEventListener("mouseup", clearPress);
    grid.addEventListener("mouseleave", clearPress);
    grid.addEventListener("contextmenu", function(e){ e.preventDefault(); });

    grid.addEventListener("click", function(e){
      var cardNode = e.target.closest(".item-card");
      if(!cardNode) return;
      var id = cardNode.dataset.id;
      var c = findCard(id);
      if(!c) return;
      if(longFired){ longFired = false; return; }
      e.stopPropagation();
      if(e.target.closest(".mdeditor-edit-btn")){ hideRevealed(); openForm(c.type, c); return; }
      if(e.target.closest(".mdeditor-delete-btn")){
        openAppConfirmBar("Удалить карточку «" + (c.title || "без названия") + "»? QR-код перестанет работать.", function(){
          deleteCard(c.id);
        }, { anchorEl: e.target.closest(".mdeditor-delete-btn") });
        return;
      }
      if(flippedId === id){ flipCard(id, false); return; } // тап по QR/обороту — назад
      if(flippedId) unflipAny();
      if(e.target.closest(".item-card-start-btn")){ startTimerForCard(c); return; } // «Пуск»: запуск, а если уже идёт — заново
      if(e.target.closest(".item-card-page-btn")){ openForm("note", c); return; }
      if(revealedIds[id]){ hideRevealed(); return; }
      var now = Date.now();
      if(lastTapId === id && now - lastTapAt < DOUBLE_MS){
        clearTimeout(singleTimer); lastTapId = null;
        flipCard(id, true);
        return;
      }
      lastTapId = id; lastTapAt = now;
      clearTimeout(singleTimer);
      singleTimer = setTimeout(function(){
        lastTapId = null;
        onCardTap(c);
      }, DOUBLE_MS);
    });
    // тап мимо карточки: оборот возвращается, раскрытые кнопки прячутся
    grid.parentNode.addEventListener("click", function(e){
      if(e.target.closest(".item-card") || e.target.closest(".mdeditor-fab-row") || e.target.closest(".fontsize-bar") || e.target.closest(".item-type-menu")) return;
      unflipAny(); hideRevealed(); closeTypeMenu();
    });
  }

  function onCardTap(c){
    if(c.type === "note"){ openNoteCard(c); return; }
    openForm(c.type, c); // таймер и предмет: форма с заполненными полями
  }

  // ---------- нижний ряд ----------
  var pdfBusy = false;
  function closeTypeMenu(){
    typeMenuOpen = false;
    var m = document.getElementById("itemTypeMenu");
    if(m) m.style.display = "none";
    var pm = document.getElementById("itemPdfMenu");
    if(pm && !pdfBusy) pm.style.display = "none"; // во время сборки PDF меню остаётся — на нём строка «Готовлю…»
  }

  // ---------- PDF с кодами (шаг 6 ТЗ) ----------
  function exportPdf(perPage){
    if(pdfBusy) return;
    var cards = loadCards();
    if(!cards.length){ alert("Карточек пока нет — PDF собирать не из чего."); return; }
    if(!window.CardPdf){ alert("Модуль PDF не загружен."); return; }
    var menu = document.getElementById("itemPdfMenu");
    var status = document.getElementById("itemPdfStatus");
    function setStatus(t){ if(status){ status.style.display = t ? "block" : "none"; status.textContent = t || ""; } }
    function setButtons(disabled){
      if(!menu) return;
      var bs = menu.querySelectorAll("button");
      for(var i = 0; i < bs.length; i++) bs[i].disabled = disabled;
    }
    pdfBusy = true; setButtons(true); setStatus("Готовлю PDF…");
    var forPdf = cards.map(function(c){ return { id: c.id, title: c.title }; });
    deps.loadQrLib().then(function(){
      return window.CardPdf.build(forPdf, perPage, { onProgress: function(done, total){ setStatus("Готовлю PDF… " + done + " из " + total); } });
    }).then(function(blob){
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "cards-qr-" + todayIso() + ".pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    }).catch(function(err){
      console.error(err);
      alert("Не удалось собрать PDF.");
    }).then(function(){
      pdfBusy = false; setButtons(false); setStatus("");
      var m = document.getElementById("itemPdfMenu");
      if(m) m.style.display = "none";
    });
  }
  function bindFab(tab){
    var addBtn = document.getElementById("itemCardsAddBtn");
    var menu = document.getElementById("itemTypeMenu");
    addBtn.addEventListener("click", function(){
      var bar = document.getElementById("itemCardsSizeBar");
      if(bar) bar.classList.remove("open");
      var pm = document.getElementById("itemPdfMenu");
      if(pm && !pdfBusy) pm.style.display = "none";
      typeMenuOpen = !typeMenuOpen;
      menu.style.display = typeMenuOpen ? "flex" : "none";
    });
    menu.addEventListener("click", function(e){
      var b = e.target.closest("button[data-type]");
      if(!b) return;
      closeTypeMenu();
      openForm(b.dataset.type, null);
    });
    var pdfBtn = document.getElementById("itemCardsPdfBtn");
    var pdfMenu = document.getElementById("itemPdfMenu");
    if(pdfBtn && pdfMenu){
      pdfBtn.addEventListener("click", function(){
        var sb2 = document.getElementById("itemCardsSizeBar");
        if(sb2) sb2.classList.remove("open");
        var open = pdfMenu.style.display !== "flex";
        closeTypeMenu();
        if(open) pdfMenu.style.display = "flex";
      });
      pdfMenu.addEventListener("click", function(e){
        var b = e.target.closest("button[data-per]");
        if(!b) return;
        exportPdf(parseInt(b.dataset.per, 10));
      });
    }
    document.getElementById("itemCardsScanBtn").addEventListener("click", function(){
      closeTypeMenu();
      var sb = document.getElementById("itemCardsSizeBar");
      if(sb) sb.classList.remove("open");
      openScan();
    });
    var bar = document.getElementById("itemCardsSizeBar");
    var range = document.getElementById("itemCardsSizeRange");
    var val = document.getElementById("itemCardsSizeVal");
    function showVal(){ val.textContent = Math.round(getScale() * 100) + "%"; }
    document.getElementById("itemCardsSizeBtn").addEventListener("click", function(){
      closeTypeMenu();
      var open = !bar.classList.contains("open");
      bar.classList.toggle("open", open);
      if(open){ range.value = String(getScale()); showVal(); }
    });
    range.addEventListener("mousedown", function(e){ e.preventDefault(); });
    range.addEventListener("input", function(){
      var v = parseFloat(range.value);
      if(!isFinite(v)) return;
      setScale(v); applySize(tab); showVal();
    });
  }

  // ---------- карточка-заметка ----------
  function backToGrid(){
    var md = getMdEditor();
    if(md && md.closeCardNote) md.closeCardNote();
    renderGrid();
  }
  function openNoteCard(c){
    var md = getMdEditor();
    if(!md || !md.openCardNote || !c.noteId){ return; }
    var ok = md.openCardNote(c.noteId, backToGrid);
    if(ok === false){ alert("Заметка этой карточки не найдена на устройстве."); return; }
    screenMode = "note";
    if(window.AppNav) window.AppNav.push(function(){ backToGrid(); });
  }

  function deleteCard(id){
    var list = loadCards();
    var c = findCard(id);
    if(!c) return;
    if(c.type === "note" && c.noteId){
      var md = getMdEditor();
      if(md && md.deleteCardNote) md.deleteCardNote(c.noteId);
    }
    cardsCache = list.filter(function(x){ return x.id !== id; });
    delete revealedIds[id];
    if(flippedId === id) flippedId = null;
    var syncInfo = loadSyncInfo();
    delete syncInfo.synced[id];
    if(syncInfo.pending.indexOf(id) < 0) syncInfo.pending.push(id);
    if(syncInfo.pending.length > 300) syncInfo.pending = syncInfo.pending.slice(-300);
    saveSyncInfo(syncInfo); // удалить и запись в облаке (reconcileCloud)
    saveCards();
    renderGrid();
  }

  // ---------- форма создания / правки ----------
  var TYPE_LABEL = { timer: "Таймер", item: "Предмет", note: "Заметка" };
  function openForm(type, card, forcedId){
    screenMode = "form";
    var el = container();
    if(!el) return;
    var isNew = !card;
    var data = card ? JSON.parse(JSON.stringify(card)) : {
      type: type, title: "", icon: DEFAULT_ICON[type] || "", date: todayIso(), seconds: 0
    };
    var html = '<div class="mdeditor-tab item-card-form" id="itemCardForm">';
    html += '<h3 class="common-tab-title">' + escapeHtml(TYPE_LABEL[type]) + '</h3>';
    html += '<input type="text" class="mdeditor-cleanup-input item-form-title" id="icfTitle" placeholder="Название" maxlength="80" autocomplete="off">';
    if(type === "timer"){
      html += '<div class="item-form-timer" id="icfTimer">' +
        wheelHtml("h", 24, "ч") + wheelHtml("m", 60, "мин") + wheelHtml("s", 60, "с") +
      '</div>';
    } else {
      html += '<div class="item-form-row">';
      html += '<div class="item-form-icons" id="icfIcons">';
      ICON_ORDER.forEach(function(name){
        html += '<button type="button" class="item-form-icon" data-icon="' + name + '" title="' + name + '">' + iconSvg(name) + '</button>';
      });
      html += '</div>';
      html += '<div class="item-form-date">' +
        '<button type="button" class="reminder-bubble reminder-bubble-date" id="icfDateBtn" title="Дата"></button>' +
        '<input type="date" class="reminder-hidden-input" id="icfDateInput" tabindex="-1" aria-hidden="true">' +
      '</div>';
      html += '</div>';
    }
    html += '<div class="item-form-error" id="icfError"></div>';
    html += '<div class="item-form-buttons">' +
      '<button type="button" class="workbooks-run-btn" id="icfSave">Сохранить</button>' +
      '<button type="button" class="workbooks-run-btn" id="icfCancel">Отмена</button>' +
    '</div>';
    html += '</div>';
    el.innerHTML = html;

    var titleEl = document.getElementById("icfTitle");
    titleEl.value = data.title || "";
    var errEl = document.getElementById("icfError");

    if(type === "timer"){
      var total = data.seconds | 0;
      setWheel("h", Math.floor(total / 3600));
      setWheel("m", Math.floor((total % 3600) / 60));
      setWheel("s", total % 60);
    } else {
      var iconsEl = document.getElementById("icfIcons");
      function markIcons(){
        var bs = iconsEl.querySelectorAll(".item-form-icon");
        for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].dataset.icon === data.icon);
      }
      markIcons();
      iconsEl.addEventListener("click", function(e){
        var b = e.target.closest(".item-form-icon");
        if(!b) return;
        // повторный тап по выбранному снимает выбор (пиктограмма не обязательна)
        data.icon = (data.icon === b.dataset.icon) ? "" : b.dataset.icon;
        markIcons();
      });
      // дата — тот же приём, что у даты напоминания задач: кнопка + скрытый <input type=date>
      var dateBtn = document.getElementById("icfDateBtn");
      var dateInput = document.getElementById("icfDateInput");
      function showDate(){ dateBtn.textContent = isoToRu(data.date) || "дата"; dateInput.value = data.date || ""; }
      showDate();
      dateBtn.addEventListener("click", function(){
        try{
          if(typeof dateInput.showPicker === "function"){ dateInput.showPicker(); return; }
        }catch(e){}
        try{ dateInput.focus(); dateInput.click(); }catch(e){}
      });
      dateInput.addEventListener("change", function(){
        if(dateInput.value) data.date = dateInput.value;
        showDate();
      });
    }

    function leave(){ renderGrid(); }
    document.getElementById("icfCancel").addEventListener("click", leave);
    if(window.AppNav) window.AppNav.push(function(){ renderGrid(); });

    document.getElementById("icfSave").addEventListener("click", function(){
      var title = titleEl.value.replace(/^\s+|\s+$/g, "");
      errEl.textContent = "";
      if(!title){ errEl.textContent = "Введите название."; return; }
      if(type === "timer"){
        var sec = getWheel("h") * 3600 + getWheel("m") * 60 + getWheel("s");
        if(sec <= 0){ errEl.textContent = "Задайте время."; return; }
        data.seconds = sec;
      }
      data.title = title;
      var md = getMdEditor();
      if(type === "note"){
        if(isNew){
          var made = md && md.createCardNote ? md.createCardNote(title) : null;
          if(!made){ errEl.textContent = "Заметки ещё не готовы: нужна настроенная синхронизация."; return; }
          data.noteId = made.id;
        } else if(card.noteId && md && md.renameCardNote){
          md.renameCardNote(card.noteId, title);
        }
      }
      var now = Date.now();
      if(isNew){
        data.id = (forcedId && !findCard(forcedId)) ? forcedId : newId(); // forcedId: карточка создаётся под уже напечатанный код
        data.createdAt = now;
        data.updatedAt = now;
        loadCards().push(data);
      } else {
        var cur = findCard(card.id);
        if(cur){
          cur.title = data.title;
          cur.icon = data.icon;
          cur.date = data.date;
          cur.seconds = data.seconds;
          cur.updatedAt = now;
        }
      }
      saveCards();
      leave();
    });
  }

  // колесо времени «как в часах»: вертикальная прокрутка с прилипанием, значение = позиция
  var WHEEL_ROW = 40;
  function wheelHtml(key, count, label){
    var rows = '<div class="item-wheel-pad"></div>';
    for(var i = 0; i < count; i++) rows += '<div class="item-wheel-row">' + pad2(i) + '</div>';
    rows += '<div class="item-wheel-pad"></div>';
    return '<div class="item-wheel-col"><div class="item-wheel" id="icfWheel_' + key + '">' + rows + '</div><div class="item-wheel-label">' + label + '</div></div>';
  }
  function setWheel(key, v){
    var w = document.getElementById("icfWheel_" + key);
    if(w) w.scrollTop = v * WHEEL_ROW;
  }
  function getWheel(key){
    var w = document.getElementById("icfWheel_" + key);
    return w ? Math.max(0, Math.round(w.scrollTop / WHEEL_ROW)) : 0;
  }



  // ---------- таймеры карточек (шаг 5а ТЗ) ----------
  // Отсчёт ведёт не страница: в оболочке — Kotlin (CardTimers: будильник, уведомление/остров, вибрация в конце), он идёт при
  // закрытом приложении; на странице scan.html — тот же CardTimers через мост окна (deps.timers); в браузере (без оболочки) —
  // запасной вариант: момент окончания в localStorage, вибрацию в конце даёт только открытая страница.
  var TIMERS_KEY = "itemCardTimers_v1";
  var timerApi = null;
  var timerList = [];
  var tickTimer = null;
  function makeWebTimers(){
    function read(){ try{ return JSON.parse(localStorage.getItem(TIMERS_KEY) || "{}") || {}; }catch(e){ return {}; } }
    function write(o){ try{ localStorage.setItem(TIMERS_KEY, JSON.stringify(o)); }catch(e){} }
    function sweep(){
      var o = read(), now = Date.now(), fired = false;
      Object.keys(o).forEach(function(id){ if(o[id].running && o[id].endAt <= now){ delete o[id]; fired = true; } });
      if(fired){
        write(o);
        try{ if(navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]); }catch(e){}
      }
    }
    return {
      start: function(id, title, sec){
        var o = read();
        o[id] = { id: id, title: title, durationMs: sec * 1000, running: true, endAt: Date.now() + sec * 1000, remainingMs: 0 };
        write(o);
        return true;
      },
      list: function(){ sweep(); var o = read(); return Object.keys(o).map(function(k){ return o[k]; }); }
    };
  }
  function getTimerApi(){
    if(timerApi) return timerApi;
    if(deps.timers){ timerApi = deps.timers; return timerApi; }
    var N = window.LifeTrackerNative;
    if(N && typeof N.getCardTimers === "function"){
      timerApi = {
        start: function(id, title, sec){ return N.startCardTimer(id, title, sec | 0); },
        list: function(){ try{ return JSON.parse(N.getCardTimers() || "[]"); }catch(e){ return []; } }
      };
    } else {
      timerApi = makeWebTimers();
    }
    return timerApi;
  }
  function refreshTimers(){
    try{ timerList = getTimerApi().list() || []; }catch(e){ timerList = []; }
  }
  // {running, leftMs} для идущего или приостановленного таймера этой карточки, иначе null
  function timerInfo(id){
    for(var i = 0; i < timerList.length; i++){
      var t = timerList[i];
      if(t.id !== id) continue;
      if(t.running){
        var left = t.endAt - Date.now();
        return left > 0 ? { running: true, leftMs: left } : null;
      }
      return { running: false, leftMs: t.remainingMs || 0 };
    }
    return null;
  }
  function timerTextFor(c){
    var info = timerInfo(c.id);
    return formatTimer(info ? Math.ceil(info.leftMs / 1000) : c.seconds);
  }
  // обновляет цифры на всех видимых карточках-таймерах; true — есть идущий или приостановленный таймер
  function updateTimerTexts(){
    var any = false;
    var nodes = document.querySelectorAll(".item-card-time[data-id]");
    for(var i = 0; i < nodes.length; i++){
      var id = nodes[i].getAttribute("data-id");
      var c = findCard(id);
      if(!c) continue;
      var info = timerInfo(id);
      nodes[i].textContent = formatTimer(info ? Math.ceil(info.leftMs / 1000) : c.seconds);
      nodes[i].classList.toggle("running", !!(info && info.running));
      nodes[i].classList.toggle("paused", !!(info && !info.running));
      if(info) any = true;
    }
    return any;
  }
  function ensureTick(){
    if(tickTimer) return;
    tickTimer = setInterval(function(){
      refreshTimers();
      var active = updateTimerTexts();
      var visible = !!document.querySelector(".item-card-time[data-id]");
      if(!active || !visible){ clearInterval(tickTimer); tickTimer = null; }
    }, 1000);
  }
  // после отрисовки сетки или показа карточки: подтянуть состояние и, если что-то идёт, запустить обновление цифр
  function syncTimersView(){
    refreshTimers();
    if(updateTimerTexts()) ensureTick();
  }
  function startTimerForCard(c){
    if(!c || c.type !== "timer" || !(c.seconds > 0)) return;
    try{ getTimerApi().start(c.id, c.title || "", c.seconds); }catch(e){}
    syncTimersView();
  }

  // ---------- сканирование (шаги 3 и 5 ТЗ) ----------
  var scanHandle = null;   // активный сканер (CardScan.open) или null
  var overlayEl = null;    // слой «карточка при сканировании» или null
  var scanNav = null;      // шаг «назад» на время сканирования: {active}
  var scanDirty = false;   // дата карточки менялась кнопкой в углу — сетке нужна перерисовка

  function reloadCards(){ cardsCache = null; return loadCards(); }
  function scanNavStart(){
    if(!window.AppNav){ scanNav = null; return; } // scan.html: своей истории нет, закрытие — через мост оболочки
    var token = { active: true };
    scanNav = token;
    window.AppNav.push(function(){
      if(!token.active) return;
      token.active = false; scanNav = null;
      closeScanSession();
    });
  }
  // goBack=true — просто закрываем сканирование (убираем свой шаг «назад»); false — дальше сразу идёт
  // другая навигация (заметка, форма): шаг оставляем, как у остальных экранов вкладки.
  function scanNavEnd(goBack){
    var t = scanNav;
    scanNav = null;
    if(!t || !t.active) return;
    t.active = false;
    if(goBack){ try{ history.back(); }catch(e){} }
  }
  function closeOverlayEl(){
    if(overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }
  function closeScanSession(){
    closeOverlayEl();
    if(scanHandle){ scanHandle.close(); scanHandle = null; }
    finishScanSession();
  }
  function finishScanSession(){
    if(standalone){ leaveStandalone(); return; }
    if(scanDirty && screenMode === "grid" && document.getElementById("itemCardsGrid")){ renderGrid(); }
    scanDirty = false;
  }
  function endScanSession(goBack){
    closeOverlayEl();
    if(scanHandle){ scanHandle.close(); scanHandle = null; }
    scanNavEnd(goBack);
    finishScanSession();
  }
  function leaveStandalone(){
    if(nativeScan && nativeScan.close){ try{ nativeScan.close(); return; }catch(e){} }
    try{ history.back(); }catch(e){}
  }

  function openScan(){
    if(!window.CardScan) return;
    closeOverlayEl();
    if(scanHandle){ scanHandle.close(); scanHandle = null; }
    scanNavEnd(false);
    scanNavStart();
    scanHandle = window.CardScan.open({
      loadJsqr: deps.loadJsqrLib,
      onCode: function(text){ scanHandle = null; handleScanned(text); },
      onBack: function(){ scanHandle = null; endScanSession(true); }
    });
  }

  function handleScanned(text){
    var p = window.CardScan.parseCode(text);
    if(p.kind === "card"){
      reloadCards();
      var c = findCard(p.id);
      if(!c && !standalone && reconcileCloud()) c = findCard(p.id);
      if(c){
        if(c.type === "timer") startTimerForCard(c); // скан таймера: отсчёт стартует сразу (если уже шёл — заново)
        showCardOverlay(c);
        return;
      }
      // карточки нет на этом устройстве: если настроена синхронизация — ищем в облаке (не дольше 2,5 с)
      var md = getMdEditor();
      var st = (!standalone && md && md.cardMetaStatus && md.cardMetaPull) ? md.cardMetaStatus() : null;
      if(st && st.ready){
        showNoticeOverlay({ kind: "text", text: "Ищу карточку в облаке…" });
        var waitEl = overlayEl;
        var done = false;
        var finish = function(){
          if(done) return;
          done = true;
          if(overlayEl !== waitEl) return; // пользователь уже закрыл окно
          reconcileCloud();
          var c2 = findCard(p.id);
          if(c2){
            if(c2.type === "timer") startTimerForCard(c2);
            showCardOverlay(c2);
          } else showNoticeOverlay({ kind: "missing", id: p.id });
        };
        setTimeout(finish, 2500);
        md.cardMetaPull().then(finish, finish);
        return;
      }
      showNoticeOverlay({ kind: "missing", id: p.id });
      return;
    }
    showNoticeOverlay({ kind: p.kind, url: p.url, text: p.text });
  }

  function newOverlay(){
    closeOverlayEl();
    var o = document.createElement("div");
    o.className = "scan-card-overlay";
    // тап мимо карточки закрывает показ (из приложения — назад на вкладку 9, из ярлыка — на рабочий стол)
    o.addEventListener("click", function(){ endScanSession(true); });
    document.body.appendChild(o);
    overlayEl = o;
    return o;
  }
  // ширина карточки при сканировании: почти вся ширина экрана с полями, на низком экране ограничена высотой
  function overlayCardWidth(){
    var vw = window.innerWidth || 360, vh = window.innerHeight || 640;
    return Math.max(120, Math.floor(Math.min(vw - 32, (vh - 120) / 1.5, 480)));
  }
  function showCardOverlay(c){
    var o = newOverlay();
    var card = document.createElement("div");
    card.className = "item-card item-card-" + c.type + " scan-card";
    card.style.setProperty("--item-card-w", overlayCardWidth() + "px");
    card.innerHTML = '<div class="item-card-front">' + cardFrontHtml(c) + '</div>';
    card.querySelector(".item-card-title").textContent = c.title || "";
    card.addEventListener("click", function(e){
      e.stopPropagation();
      if(c.type === "note") openNoteFromScan(c);
      else if(c.type === "timer" && e.target.closest(".item-card-start-btn")) startTimerForCard(c); // «Пуск» на показе: заново
    });
    o.appendChild(card);
    if(c.type === "timer") syncTimersView();
    if(isLegacyAnim()){ o.style.animation = "none"; card.style.animation = "none"; } // Android 5: без анимации
    if(c.type === "item"){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "scan-card-today-btn";
      b.title = "Поставить сегодняшнюю дату";
      b.innerHTML = TODAY_ICON_SVG;
      b.addEventListener("click", function(e){
        e.stopPropagation();
        reloadCards();
        var cur = findCard(c.id);
        if(!cur) return;
        cur.date = todayIso();
        cur.updatedAt = Date.now();
        saveCards();
        scanDirty = true;
        var d = card.querySelector(".item-card-date");
        if(d) d.textContent = isoToRu(cur.date);
      });
      o.appendChild(b);
    }
  }
  function openNoteFromScan(c){
    if(standalone){
      if(nativeScan && nativeScan.openInApp){ try{ nativeScan.openInApp(c.id, "note"); }catch(e){} }
      leaveStandalone();
      return;
    }
    endScanSession(false);
    openNoteWhenReady(c, 0);
  }

  function showNoticeOverlay(info){
    var o = newOverlay();
    var box = document.createElement("div");
    box.className = "scan-notice";
    box.addEventListener("click", function(e){ e.stopPropagation(); });
    var msg = document.createElement("div");
    msg.className = "scan-notice-text";
    var btns = document.createElement("div");
    btns.className = "scan-notice-buttons";
    function addBtn(label, fn){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "workbooks-run-btn";
      b.textContent = label;
      b.addEventListener("click", fn);
      btns.appendChild(b);
    }
    if(info.kind === "missing"){
      msg.textContent = "Карточка не найдена. Возможно, ещё не синхронизирована.";
      addBtn("Создать карточку с этим кодом", function(){
        if(standalone){
          if(nativeScan && nativeScan.openInApp){ try{ nativeScan.openInApp(info.id, "create"); }catch(e){} }
          leaveStandalone();
          return;
        }
        endScanSession(false);
        openTypeChooser(info.id);
      });
    } else if(info.kind === "url"){
      msg.textContent = info.url;
      msg.classList.add("scan-notice-url");
      addBtn("Открыть", function(){
        if(standalone && nativeScan && nativeScan.openUrl){ try{ nativeScan.openUrl(info.url); }catch(e){} leaveStandalone(); return; }
        openExternalUrl(info.url);
        endScanSession(true);
      });
    } else {
      msg.textContent = info.kind === "unknown"
        ? "Код не поддерживается этой версией приложения: " + (info.text || "")
        : (info.text || "Код пустой.");
      msg.classList.add("scan-notice-url");
    }
    addBtn("Закрыть", function(){ endScanSession(true); });
    box.appendChild(msg);
    box.appendChild(btns);
    o.appendChild(box);
  }
  function openExternalUrl(url){
    var a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // выбор типа для карточки под уже напечатанный код (id не найден на устройстве)
  function openTypeChooser(forcedId){
    screenMode = "form";
    var el = container();
    if(!el) return;
    el.innerHTML = '<div class="mdeditor-tab item-card-form" id="itemCardForm">' +
      '<h3 class="common-tab-title">Новая карточка</h3>' +
      '<div class="item-form-buttons item-form-types">' +
        '<button type="button" class="workbooks-run-btn" data-type="timer">Таймер</button>' +
        '<button type="button" class="workbooks-run-btn" data-type="item">Предмет</button>' +
        '<button type="button" class="workbooks-run-btn" data-type="note">Заметка</button>' +
      '</div>' +
      '<div class="item-form-buttons"><button type="button" class="workbooks-run-btn" id="icfTypeCancel">Отмена</button></div>' +
    '</div>';
    el.addEventListener("click", function onClick(e){
      var b = e.target.closest("button[data-type]");
      if(!b) return;
      el.removeEventListener("click", onClick);
      openForm(b.dataset.type, null, forcedId);
    });
    document.getElementById("icfTypeCancel").addEventListener("click", function(){ renderGrid(); });
    if(window.AppNav) window.AppNav.push(function(){ renderGrid(); });
  }

  // карточка-заметка из сканирования: заметки на холодном старте приложения могут быть ещё не загружены — ждём
  function openNoteWhenReady(c, n){
    var md = getMdEditor();
    if(md && md.openCardNote && c.noteId){
      var ok = md.openCardNote(c.noteId, backToGrid);
      if(ok !== false){
        screenMode = "note";
        if(window.AppNav) window.AppNav.push(function(){ backToGrid(); });
        return;
      }
    }
    if(n < 25){ setTimeout(function(){ openNoteWhenReady(c, n + 1); }, 300); return; }
    alert("Заметка этой карточки не найдена на устройстве.");
  }

  // вход из оболочки (ScanActivity → MainActivity): mode "note" — открыть заметку карточки,
  // "create" — создать карточку с этим id (код уже напечатан)
  function openCardFromNative(id, mode){
    reloadCards();
    var c = findCard(id);
    if(mode === "create" && !c){ openTypeChooser(id); return; }
    renderGrid();
    if(mode === "note" && c && c.type === "note") openNoteWhenReady(c, 0);
  }

  // страница scan.html: сразу сканер, результат — на прозрачном фоне поверх рабочего стола
  function startStandaloneScan(){
    reloadCards();
    openScan();
  }

  // ---------- вход вкладки ----------
  function renderSettingsTabItemCards(){
    var md = getMdEditor();
    // если из этой вкладки была открыта заметка-карточка и пользователь ушёл — закрываем её редактор
    if(screenMode === "note" && md && md.closeCardNote) md.closeCardNote();
    flippedId = null;
    typeMenuOpen = false;
    cardsCache = null; // записи могла изменить страница scan.html (кнопка «сегодняшняя дата»)
    renderGrid();
    cloudSyncOnEnter();
  }

  return {
    renderSettingsTabItemCards: renderSettingsTabItemCards,
    openScan: openScan,
    openCardFromNative: openCardFromNative,
    startStandaloneScan: startStandaloneScan,
    getCards: function(){ return loadCards().slice(); },
    qrTextForId: function(id){ return QR_PREFIX + id; }
  };
};
