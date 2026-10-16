/* ===========================================================================
   itemcards.js
   Версия: 1.0 (16.10)
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

   Чего здесь ещё нет (следующие шаги ТЗ): сканер, показ по скану, таймер по скану,
   PDF, напоминания, облачная синхронизация записей карточек (тело карточки-заметки
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
  var getMdEditor = deps.getMdEditor;

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
  function saveCards(){
    try{ localStorage.setItem(CARDS_KEY, JSON.stringify(cardsCache || [])); }catch(e){}
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
        '<div class="item-card-timer">' + escapeHtml(formatTimer(c.seconds)) + '</div>';
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
    html += '<div class="mdeditor-fab-row">' +
      '<button type="button" class="mdeditor-fab-btn" id="itemCardsAddBtn" title="Новая карточка">' + PLUS_ICON_SVG + '</button>' +
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
  function closeTypeMenu(){
    typeMenuOpen = false;
    var m = document.getElementById("itemTypeMenu");
    if(m) m.style.display = "none";
  }
  function bindFab(tab){
    var addBtn = document.getElementById("itemCardsAddBtn");
    var menu = document.getElementById("itemTypeMenu");
    addBtn.addEventListener("click", function(){
      var bar = document.getElementById("itemCardsSizeBar");
      if(bar) bar.classList.remove("open");
      typeMenuOpen = !typeMenuOpen;
      menu.style.display = typeMenuOpen ? "flex" : "none";
    });
    menu.addEventListener("click", function(e){
      var b = e.target.closest("button[data-type]");
      if(!b) return;
      closeTypeMenu();
      openForm(b.dataset.type, null);
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
    saveCards();
    renderGrid();
  }

  // ---------- форма создания / правки ----------
  var TYPE_LABEL = { timer: "Таймер", item: "Предмет", note: "Заметка" };
  function openForm(type, card){
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
        data.id = newId();
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

  // ---------- вход вкладки ----------
  function renderSettingsTabItemCards(){
    var md = getMdEditor();
    // если из этой вкладки была открыта заметка-карточка и пользователь ушёл — закрываем её редактор
    if(screenMode === "note" && md && md.closeCardNote) md.closeCardNote();
    flippedId = null;
    typeMenuOpen = false;
    renderGrid();
  }

  return {
    renderSettingsTabItemCards: renderSettingsTabItemCards,
    getCards: function(){ return loadCards().slice(); },
    qrTextForId: function(id){ return QR_PREFIX + id; }
  };
};
