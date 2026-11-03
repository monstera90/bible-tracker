/* ===========================================================================
   usertabs.js
   Версия: 1.5 (03.11)
   Вкладки-сайты бокового ряда «Клод» (кнопка «+» над вкладкой «Claude», set2s_10). Каждая вкладка — свой адрес, который открывается
   по умолчанию; дальше вкладка помнит, где человек остановился на сайте (в том числе после закрытия приложения).
   Сам сайт показывает ОБОЛОЧКА: отдельный WebView на вкладку поверх области #userTabView (мост LifeTrackerNative ≥ 22, utab*;
   UserTabs.kt). Здесь — кнопки вкладок, форма адреса и пустая область, чей прямоугольник отправляется оболочке. В браузере
   (без моста) «+» и вкладок нет.
   Список вкладок — localStorage `userTabs_v1` ({tabs:[{id,home}]}, порядок = порядок создания), только на этом устройстве; ключ вкладки
   `utab_<id>`, кнопка `settingsTabUser_<id>` стоит в #settingsTabs между «Claude» и «+» (в DOM — до «+», на экране — под ней).
   Кнопка «+» (settingsTabUserAddBtn) — разметка index.html; никогда не бывает выбранной.
   Точка входа — window.UserTabsMod.{init, isKey, keys, buttonId, render, onSwitch, hide, applyVisibility, applyActive}; my.js
   создаёт модуль через init(deps) (deps: switchTab, getCurrentTab, refresh, confirm), зовёт render из switchSettingsTab,
   onSwitch при смене вкладки, hide при закрытии окна настроек, applyVisibility/applyActive из refreshSettingsTabsVisibility/applySideActive.
   =========================================================================== */
(function(){
  "use strict";
  var LIST_KEY = "userTabs_v1";
  var KEY_PREFIX = "utab_";
  var BTN_PREFIX = "settingsTabUser_";
  var ADD_BTN_ID = "settingsTabUserAddBtn";
  var CLAUDE_KEY = "set2s_10";
  var ID_RE = /^[A-Za-z0-9_]{1,40}$/;
  var LONG_PRESS_MS = 1000;
  var ARM_MS = 4000;       // сколько крестик ждёт второго нажатия

  var deps = {};
  var tabs = [];            // [{id, home}] — старые первыми
  var icons = {};           // id -> data:image/png (значок сайта от оболочки)
  var iconRev = {};         // id -> ревизия значка, которую мы уже забрали
  var active = false;       // нативный WebView вкладки activeId должен быть на экране
  var activeId = null;
  var armedId = null;       // вкладка, у которой после долгого нажатия показан крестик (следующее нажатие удаляет)
  var armTimer = null;
  var formFor = null;       // id вкладки, у которой открыта форма адреса
  var timer = null;
  var lastRect = "";
  var lastPoll = 0;

  function el(id){ return document.getElementById(id); }
  function bridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.utabShow === "function") ? b : null;
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function keyOf(id){ return KEY_PREFIX + id; }
  function isKey(key){ return typeof key === "string" && key.indexOf(KEY_PREFIX) === 0 && !!find(key.slice(KEY_PREFIX.length)); }
  function idOf(key){ return String(key).slice(KEY_PREFIX.length); }
  function find(id){
    for(var i = 0; i < tabs.length; i++) if(tabs[i].id === id) return tabs[i];
    return null;
  }
  function keys(){ return tabs.map(function(t){ return keyOf(t.id); }); }
  function buttonId(key){ return BTN_PREFIX + idOf(key); }

  function load(){
    try{
      var o = JSON.parse(localStorage.getItem(LIST_KEY) || "{}");
      if(o && Array.isArray(o.tabs)){
        return o.tabs.filter(function(t){ return t && typeof t.id === "string" && ID_RE.test(t.id); })
          .map(function(t){ return { id: t.id, home: typeof t.home === "string" ? t.home : "" }; });
      }
    }catch(e){}
    return [];
  }
  function save(){
    try{ localStorage.setItem(LIST_KEY, JSON.stringify({ tabs: tabs })); }catch(e){}
  }
  function newId(){
    var id;
    do{ id = "u" + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); }while(find(id));
    return id;
  }

  function hostOf(url){
    var m = /^https?:\/\/([^\/?#:]+)/i.exec(url || "");
    return m ? m[1].toLowerCase() : "";
  }
  // «example.com/page» -> «https://example.com/page»; http поднимается до https (открытый трафик в приложении запрещён); не адрес -> ""
  function normalizeUrl(s){
    s = String(s || "").trim();
    if(!s || /\s/.test(s)) return "";
    if(/^(javascript|vbscript|data|file|content|intent|mailto|tel|blob|about):/i.test(s)) return "";
    if(!/^[a-z][a-z0-9+.\-]*:\/\//i.test(s)) s = "https://" + s;
    if(/^http:\/\//i.test(s)) s = "https://" + s.slice(7);
    if(!/^https:\/\//i.test(s)) return "";
    var h = hostOf(s);
    if(!h || (h.indexOf(".") === -1 && h !== "localhost")) return "";
    return s;
  }

  var GLOBE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
  function letterSvg(ch){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3.5" y="3.5" width="17" height="17" rx="4"></rect>' +
      '<text x="12" y="16.4" text-anchor="middle" font-size="11.5" font-weight="600" font-family="sans-serif" fill="currentColor" stroke="none">' + esc(ch) + '</text></svg>';
  }
  // значок вкладки: миниатюра сайта (значок, который отдала страница), пока её нет — первая буква адреса
  function iconHtml(t){
    if(icons[t.id]) return '<img class="ut-ico" alt="" src="' + icons[t.id] + '">';
    var h = hostOf(t.home).replace(/^www\./, "");
    return h ? letterSvg(h.charAt(0).toUpperCase()) : GLOBE_SVG;
  }

  function ensureStyle(){
    if(el("userTabsStyle")) return;
    var st = document.createElement("style");
    st.id = "userTabsStyle";
    st.textContent =
      ".settings-tab .ut-ico{display:block;width:26px;height:26px;box-sizing:border-box;padding:2px;border-radius:6px;background:#fff;object-fit:contain;}" +
      ".ut-form input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:16px;margin:10px 0 4px;padding:9px 11px;border-radius:8px;" +
      "border:1px solid var(--wood,#5b4a8a);background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);}" +
      ".ut-err{min-height:18px;font-size:13px;color:#b00020;margin:0 0 6px;}" +
      ".ut-btns button{font:inherit;font-size:14px;margin:0 8px 8px 0;padding:7px 12px;border-radius:8px;" +
      "border:1px solid var(--wood,#5b4a8a);background:var(--parchment,#f4f0f8);color:var(--wood,#5b4a8a);}" +
      ".ut-btns button.primary{background:var(--wood,#5b4a8a);color:var(--parchment,#f4f0f8);}" +
      "#userTabView{width:100%;}" +
      ".ut-loading{font-size:13px;opacity:.7;padding:8px 2px;}";
    document.head.appendChild(st);
  }

  // ---- кнопки вкладок ----
  var CROSS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  function disarm(){
    if(armTimer){ clearTimeout(armTimer); armTimer = null; }
    document.removeEventListener("click", onDocClick, true);
    var id = armedId;
    armedId = null;
    var t = id ? find(id) : null;
    if(t) updateButton(t);
  }
  function onDocClick(e){
    var b = armedId ? el(BTN_PREFIX + armedId) : null;
    if(!b || !b.contains(e.target)) disarm();
  }
  // долгое нажатие (1 с): значок вкладки превращается в крестик; нажатие на него удаляет вкладку, любое другое действие или 4 с — отмена
  function arm(id){
    disarm();
    armedId = id;
    var b = el(BTN_PREFIX + id);
    if(b){ b.innerHTML = CROSS_SVG; b.title = "Удалить вкладку"; }
    armTimer = setTimeout(disarm, ARM_MS);
    setTimeout(function(){ if(armedId === id) document.addEventListener("click", onDocClick, true); }, 0);
  }
  function updateButton(t){
    var b = el(BTN_PREFIX + t.id);
    if(!b) return;
    var h = hostOf(t.home);
    b.innerHTML = armedId === t.id ? CROSS_SVG : iconHtml(t);
    b.title = h || "Новая вкладка";
    b.setAttribute("aria-label", h || "Новая вкладка");
  }
  // долгое нажатие на кнопку вкладки — форма адреса (изменить адрес, обновить, удалить); сработавшее нажатие гасит последующий click
  function bindLongPress(btn, cb){
    var tm = null, fired = false, sx = 0, sy = 0;
    function start(e){
      fired = false;
      var p = (e.touches && e.touches[0]) || e;
      sx = p.clientX; sy = p.clientY;
      clearTimeout(tm);
      tm = setTimeout(function(){ fired = true; cb(); }, LONG_PRESS_MS);
    }
    function move(e){
      var p = (e.touches && e.touches[0]) || e;
      if(Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) clearTimeout(tm);
    }
    function end(){ clearTimeout(tm); }
    btn.addEventListener("touchstart", start, { passive: true });
    btn.addEventListener("touchmove", move, { passive: true });
    btn.addEventListener("touchend", end);
    btn.addEventListener("touchcancel", end);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", end);
    btn.addEventListener("mouseleave", end);
    btn.addEventListener("contextmenu", function(e){ e.preventDefault(); });
    btn.addEventListener("click", function(e){
      if(fired){ fired = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }
  function buildButton(t){
    var add = el(ADD_BTN_ID);
    if(!add || !add.parentNode || el(BTN_PREFIX + t.id)) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "settings-tab";
    b.id = BTN_PREFIX + t.id;
    b.setAttribute("data-lt-usertab", "1");
    b.style.display = "none";
    bindLongPress(b, function(){ arm(t.id); });
    b.addEventListener("click", function(){
      if(armedId === t.id){ disarm(); removeTab(t.id); return; } // второе нажатие на крестик
      var key = keyOf(t.id);
      // нажатие на уже открытую вкладку — форма адреса (изменить адрес, обновить, удалить)
      if(deps.getCurrentTab && deps.getCurrentTab() === key) openForm(t.id);
      else if(deps.switchTab) deps.switchTab(key);
    });
    add.parentNode.insertBefore(b, add); // в DOM перед «+»: на экране сразу под ней (стек растёт снизу вверх)
    updateButton(t);
  }

  function syncIcon(id, st){
    var b = bridge();
    if(!b) return;
    st = st || readState(id);
    var rev = st.rev || 0;
    if(rev === (iconRev[id] || 0) && (icons[id] || !rev)) return;
    iconRev[id] = rev;
    if(!rev) delete icons[id];
    else{ try{ var u = b.utabGetIcon(id); if(u) icons[id] = u; }catch(e){} }
    var t = find(id);
    if(t) updateButton(t);
  }
  function readState(id){
    var b = bridge();
    if(!b) return {};
    try{ return JSON.parse(b.utabGetState(id) || "{}"); }catch(e){ return {}; }
  }

  // показ/скрытие кнопок (зовёт refreshSettingsTabsVisibility): вкладки и «+» видны, пока включён ряд «Клод» и оболочка умеет вкладки-сайты
  function applyVisibility(on){
    var ok = !!on && !!bridge();
    var add = el(ADD_BTN_ID);
    if(add) add.style.display = ok ? "flex" : "none";
    tabs.forEach(function(t){
      var b = el(BTN_PREFIX + t.id);
      if(b) b.style.display = ok ? "flex" : "none";
    });
    if(ok) tabs.forEach(function(t){ syncIcon(t.id); });
  }
  // выбрана может быть только вкладка-сайт; «+» не красится никогда
  function applyActive(tab){
    tabs.forEach(function(t){
      var b = el(BTN_PREFIX + t.id);
      if(b) b.classList.toggle("active", tab === keyOf(t.id));
    });
    var add = el(ADD_BTN_ID);
    if(add) add.classList.remove("active");
  }

  // ---- создание / удаление ----
  function openForm(id){
    var key = keyOf(id);
    formFor = id;
    var cur = deps.getCurrentTab ? deps.getCurrentTab() : null;
    if(cur === key) render(key);
    else if(deps.switchTab) deps.switchTab(key);
  }
  function onAddClick(){
    if(!bridge()) return;
    var t = null;
    for(var i = 0; i < tabs.length; i++) if(!tabs[i].home){ t = tabs[i]; break; } // пустая вкладка уже есть — новая не плодится
    if(!t){
      t = { id: newId(), home: "" };
      tabs.push(t);
      save();
      buildButton(t);
      if(deps.refresh) deps.refresh();
    }
    openForm(t.id);
  }
  function removeTab(id){
    if(armedId === id) disarm();
    var b = bridge();
    if(activeId === id) hide();
    if(b){ try{ b.utabRemove(id); }catch(e){} }
    tabs = tabs.filter(function(t){ return t.id !== id; });
    save();
    var btn = el(BTN_PREFIX + id);
    if(btn && btn.parentNode) btn.parentNode.removeChild(btn);
    delete icons[id];
    delete iconRev[id];
    if(formFor === id) formFor = null;
    var wasCurrent = deps.getCurrentTab && deps.getCurrentTab() === keyOf(id);
    if(deps.refresh) deps.refresh();
    if(wasCurrent && deps.switchTab) deps.switchTab(CLAUDE_KEY);
  }

  // ---- содержимое вкладки ----
  // нижний ряд «полный экран + домик» (my.js, mountSiteFabRow) — на каждом экране вкладки
  function mountFab(c){
    try{ if(window.SiteTabFab) window.SiteTabFab.mount(c); }catch(e){}
  }
  function render(key){
    var id = idOf(key), t = find(id), c = el("settingsTabContent");
    if(!c || !t) return;
    var b = bridge();
    if(!b){
      hide();
      c.innerHTML = '<div class="mood-diagram-empty">Вкладки-сайты работают только в приложении (APK) с обновлённой оболочкой.</div>';
      mountFab(c);
      return;
    }
    ensureStyle();
    if(!t.home || formFor === id) renderForm(c, t);
    else renderPage(c, t);
    mountFab(c);
  }

  function renderForm(c, t){
    hide(); // форма лежит в странице приложения: нативный WebView на это время убран
    var hasHome = !!t.home;
    c.innerHTML =
      '<div class="ut-form">' +
        '<h3 class="common-tab-title">Адрес страницы</h3>' +
        '<div class="modal-note">Эта страница открывается по умолчанию. Дальше вкладка запоминает, где вы остановились, и открывает её на том же месте.</div>' +
        '<input id="utUrl" type="text" inputmode="url" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="example.com" value="' + esc(t.home) + '">' +
        '<div class="ut-err" id="utErr"></div>' +
        '<div class="ut-btns">' +
          '<button type="button" class="primary" id="utOpen">Открыть</button>' +
          (hasHome ? '<button type="button" id="utBack">К странице</button><button type="button" id="utReload">Обновить</button><button type="button" id="utDel">Удалить вкладку</button>' : '') +
        '</div>' +
      '</div>';
    var input = el("utUrl"), err = el("utErr");
    function openIt(){
      var u = normalizeUrl(input.value);
      if(!u){ err.textContent = "Введите адрес сайта, например example.com"; return; }
      var b = bridge();
      formFor = null;
      if(u === t.home){ render(keyOf(t.id)); return; } // адрес не менялся — вернуться к странице, место на ней не трогаем
      t.home = u;
      save();
      delete icons[t.id];
      iconRev[t.id] = 0;
      updateButton(t);
      if(b){ try{ b.utabGo(t.id, u); }catch(e){} }
      render(keyOf(t.id));
    }
    // клавиатура не сжимает окно (вкладки остаются на местах): поле адреса вверху, его она не закрывает
    function kbOverlay(on){
      var nb = window.LifeTrackerNative;
      if(nb && typeof nb.setKeyboardOverlay === "function"){ try{ nb.setKeyboardOverlay(!!on); }catch(e){} }
    }
    input.addEventListener("focus", function(){ kbOverlay(true); });
    input.addEventListener("blur", function(){ kbOverlay(false); });
    el("utOpen").addEventListener("click", openIt);
    input.addEventListener("keydown", function(e){ if(e.key === "Enter" || e.keyCode === 13){ e.preventDefault(); openIt(); } });
    if(hasHome){
      el("utBack").addEventListener("click", function(){ formFor = null; render(keyOf(t.id)); });
      el("utReload").addEventListener("click", function(){
        var b = bridge();
        if(b){ try{ b.utabReload(t.id); }catch(e){} }
        formFor = null;
        render(keyOf(t.id));
      });
      var del = el("utDel");
      del.addEventListener("click", function(){
        if(deps.confirm) deps.confirm("Удалить вкладку?", function(){ removeTab(t.id); }, { anchorEl: del, yesTitle: "Удалить" });
        else removeTab(t.id);
      });
    }else{
      setTimeout(function(){ try{ input.focus(); }catch(e){} }, 60);
    }
  }

  function renderPage(c, t){
    c.innerHTML = '<div id="userTabView"><div class="ut-loading">Загрузка…</div></div>';
    active = true;
    activeId = t.id;
    lastRect = "";
    startTimer();
    var go = function(){ sizeAndPush(); };
    if(window.requestAnimationFrame) requestAnimationFrame(function(){ requestAnimationFrame(go); });
    else go();
    setTimeout(go, 120);
  }

  // область под вкладкой растягивается до низа содержимого; прямоугольник отправляется оболочке (повторная отправка того же — не делается)
  function sizeAndPush(){
    var c = el("settingsTabContent"), v = el("userTabView"), b = bridge();
    var t = (active && activeId) ? find(activeId) : null;
    if(!active || !c || !v || !b || !t) return;
    var cr = c.getBoundingClientRect();
    var pad = parseFloat(getComputedStyle(c).paddingBottom) || 0;
    var top = v.getBoundingClientRect().top;
    var bottom = cr.bottom - pad;
    var row = el("siteFabRow"); // нативный WebView лежит поверх страницы — сайт заканчивается над рядом кнопок, иначе они окажутся под ним
    if(row){
      var rr = row.getBoundingClientRect();
      if(rr.height > 0) bottom = Math.min(bottom, rr.top - 4);
    }
    var h = Math.max(160, Math.floor(bottom - top));
    v.style.height = h + "px";
    var r = v.getBoundingClientRect();
    var key = [r.left, r.top, r.width, r.height].map(Math.round).join(",");
    if(key === lastRect) return;
    lastRect = key;
    try{ b.utabShow(t.id, t.home, r.left, r.top, r.width, r.height); }catch(e){}
  }

  function pollState(){
    var b = bridge();
    if(!b || !active || !activeId) return;
    if(!el("userTabView")){ hide(); return; }
    var st = readState(activeId);
    if(!st.shown) lastRect = ""; // оболочка выгрузила WebView (сбой процесса рендера) — показать заново
    syncIcon(activeId, st);
  }

  function startTimer(){
    if(timer) return;
    timer = setInterval(function(){
      sizeAndPush();
      var now = Date.now();
      if(now - lastPoll > 2000){ lastPoll = now; pollState(); }
    }, 400);
    window.addEventListener("resize", sizeAndPush);
  }
  function stopTimer(){
    if(timer){ clearInterval(timer); timer = null; }
    window.removeEventListener("resize", sizeAndPush);
  }

  function hide(){
    var was = active;
    active = false;
    activeId = null;
    lastRect = "";
    stopTimer();
    var b = bridge();
    if(was && b){ try{ b.utabHide(); }catch(e){} }
  }
  // смена вкладки: уходим со вкладки-сайта (или переходим на другую) — WebView убирается; повторный рендер той же вкладки его не трогает
  function onSwitch(tab){
    if(armedId) disarm();
    if(formFor && keyOf(formFor) !== tab) formFor = null;
    if(!(typeof tab === "string" && tab.indexOf(KEY_PREFIX) === 0 && idOf(tab) === activeId)) hide();
  }

  // Страница от края до края: пока в окне вкладка-сайт, «Claude» или просмотр PDF, у окна и оверлея убираются боковые поля и рамка (modals.css .lt-edge)
  var edgeObserver = null;
  function syncEdge(){
    var c = el("settingsTabContent");
    if(!c) return;
    var has = false;
    for(var i = 0; i < c.children.length; i++){
      var ch = c.children[i];
      if(ch.id === "userTabView" || ch.id === "claudeTabView" || ch.classList.contains("pdf-reader-tab")){ has = true; break; }
    }
    var box = c.parentNode, ov = c.closest ? c.closest(".settings-modal-overlay") : null;
    var was = !!(box && box.classList && box.classList.contains("lt-edge"));
    if(box && box.classList) box.classList.toggle("lt-edge", has);
    if(ov) ov.classList.toggle("lt-edge-ov", has);
    if(was !== has){ try{ window.dispatchEvent(new Event("resize")); }catch(e){} }
    if(!edgeObserver && window.MutationObserver){
      edgeObserver = new MutationObserver(syncEdge);
      edgeObserver.observe(c, { childList: true });
    }
  }

  function init(d){
    deps = d || {};
    tabs = load();
    ensureStyle();
    syncEdge();
    var add = el(ADD_BTN_ID);
    if(add && !add.__ltBound){
      add.__ltBound = true;
      add.addEventListener("click", onAddClick);
    }
    tabs.forEach(buildButton);
    tabs.forEach(function(t){ syncIcon(t.id); });
    if(deps.refresh) deps.refresh();
  }

  window.UserTabsMod = {
    init: init, isKey: isKey, keys: keys, buttonId: buttonId,
    render: render, onSwitch: onSwitch, hide: hide,
    applyVisibility: applyVisibility, applyActive: applyActive
  };
})();
