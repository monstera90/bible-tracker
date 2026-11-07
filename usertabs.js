/* ===========================================================================
   usertabs.js
   Версия: 4.1 (07.11)
   Вкладки-сайты бокового ряда «Интернет» (кнопка «+» над вкладкой «Claude», set2s_10). Каждая вкладка — свой адрес, который открывается
   по умолчанию; дальше вкладка помнит, где человек остановился на сайте (в том числе после закрытия приложения).
   Сам сайт показывает ОБОЛОЧКА: отдельный WebView на вкладку поверх области #userTabView (мост LifeTrackerNative ≥ 22, utab*;
   UserTabs.kt). Здесь — кнопки вкладок, форма адреса и пустая область, чей прямоугольник отправляется оболочке. В браузере
   (без моста) «+» и вкладок нет.
   Список вкладок — localStorage `userTabs_v1` ({tabs:[{id,home,createdAt,updatedAt}]}, порядок = createdAt) и синхронизируется между устройствами
   по тому же каналу, что и карточки QR: по скрытой записи заметок на вкладку (`MdEditor.cardMetaSave/Remove/All`, тип записи `utab`;
   сверка `reconcile`: новее по updatedAt побеждает, удаление — `userTabsSync_v1`: synced/pending, как `itemCardsSync_v1`).
   Между устройствами идут только адреса и порядок вкладок; место на сайте, прокрутка, значки и вход в аккаунты — у каждого свои. Ключ вкладки
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
  var SYNC_KEY = "userTabsSync_v1"; // {synced:{id:1}, pending:[id]} — «уже была в облаке» и «удалена здесь, убрать из облака»
  var SYNC_TYPE = "utab";           // тип записи в канале карточек (itemcards.js такие записи игнорирует)
  var PULL_MIN_MS = 60000;          // облако перечитывается не чаще раза в минуту

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
  var holeSupport = null;   // умеет ли оболочка «окна» под кнопки страницы (мост ≥24, Android 10+); null — ещё не спрашивали

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
          .map(function(t){
            return { id: t.id, home: typeof t.home === "string" ? t.home : "", createdAt: Number(t.createdAt) || 0, updatedAt: Number(t.updatedAt) || 0 };
          });
      }
    }catch(e){}
    return [];
  }
  // момент создания из самого id («u» + Date.now() в 36-ричной записи + случайный хвост); не вышло — 0
  function stampOf(id){
    var m = /^u([0-9a-z]{8})/.exec(String(id));
    var n = m ? parseInt(m[1], 36) : 0;
    return (n > 1.5e12 && n < 4e12) ? n : 0;
  }
  // вкладкам, созданным до синхронизации, ставятся createdAt/updatedAt (по id; нет — по порядку в списке)
  function stampTabs(){
    var now = Date.now(), changed = false;
    tabs.forEach(function(t, i){
      if(!t.createdAt){ t.createdAt = stampOf(t.id) || (now - (tabs.length - i) * 1000); changed = true; }
      if(!t.updatedAt){ t.updatedAt = t.createdAt; changed = true; }
    });
    if(changed) save();
  }
  function sortTabs(list){
    return list.slice().sort(function(a, b){
      return (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
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
      tm = setTimeout(function(){ if(window.TabReorder && window.TabReorder.busy()) return; fired = true; cb(); }, LONG_PRESS_MS);
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

  // показ/скрытие кнопок (зовёт refreshSettingsTabsVisibility): вкладки и «+» видны, пока включён ряд «Интернет» и оболочка умеет вкладки-сайты
  function applyVisibility(on){
    var ok = !!on && !!bridge();
    var add = el(ADD_BTN_ID);
    if(add) add.style.display = ok ? "flex" : "none";
    tabs.forEach(function(t){
      var b = el(BTN_PREFIX + t.id);
      if(b) b.style.display = ok ? "flex" : "none";
    });
    if(ok){
      tabs.forEach(function(t){ syncIcon(t.id); });
      if(!syncTimer) syncSoon(true);
    }
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
      var now = Date.now();
      t = { id: newId(), home: "", createdAt: now, updatedAt: now };
      tabs.push(t);
      save();
      buildButton(t);
      if(deps.refresh) deps.refresh();
    }
    openForm(t.id);
  }
  function removeTab(id, fromSync){
    if(armedId === id) disarm();
    var b = bridge();
    if(activeId === id) hide();
    if(b){ try{ b.utabRemove(id); }catch(e){} }
    var wasSynced = !!find(id);
    tabs = tabs.filter(function(t){ return t.id !== id; });
    save();
    if(!fromSync && wasSynced){
      var info = loadSync();
      if(info.pending.indexOf(id) === -1) info.pending.push(id);
      saveSync(info);
      syncSoon(false);
    }
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
  function mountFab(c, t){
    try{ if(window.SiteTabFab) window.SiteTabFab.mount(c, function(){ goHome(t); }); }catch(e){}
  }
  // «домик»: первый экран вкладки — адрес по умолчанию (сохранённое место на сайте сбрасывается, как при смене адреса)
  function goHome(t){
    var b = bridge();
    if(!b || !t || !t.home) return;
    formFor = null;
    delete icons[t.id];
    iconRev[t.id] = 0;
    updateButton(t);
    try{ b.utabGo(t.id, t.home); }catch(e){}
    var c = el("settingsTabContent");
    if(c && c.querySelector(".ut-form")) render(keyOf(t.id));
  }
  function render(key){
    var id = idOf(key), t = find(id), c = el("settingsTabContent");
    if(!c || !t) return;
    var b = bridge();
    if(!b){
      hide();
      c.innerHTML = '<div class="mood-diagram-empty">Вкладки-сайты работают только в приложении (APK) с обновлённой оболочкой.</div>';
      mountFab(c, t);
      return;
    }
    ensureStyle();
    if(!t.home || formFor === id) renderForm(c, t);
    else renderPage(c, t);
    mountFab(c, t);
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
      t.updatedAt = Date.now();
      save();
      syncSoon(false);
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

  // оболочка умеет «окна»: сайт растянут под кнопки нижнего ряда, а в местах кнопок не рисуется (сквозь окна видна страница)
  function holesOk(b){
    if(holeSupport === null){
      holeSupport = false;
      if(typeof b.utabHoles === "function"){ try{ holeSupport = !!b.utabHoles(""); }catch(e){} }
    }
    return holeSupport;
  }
  // прямоугольники кнопок ряда #siteFabRow: «x,y,w,h;x,y,w,h»
  function holesOf(row){
    var out = [], btns = row.querySelectorAll(".mdeditor-fab-btn");
    for(var i = 0; i < btns.length; i++){
      var r = btns[i].getBoundingClientRect();
      if(r.width > 0 && r.height > 0) out.push([r.left, r.top, r.width, r.height].map(function(n){ return Math.round(n * 10) / 10; }).join(","));
    }
    return out.join(";");
  }

  // область под вкладкой растягивается до низа окна (под кнопки, как содержимое других вкладок); прямоугольник отправляется оболочке
  // (повторная отправка того же — не делается). Без «окон» в оболочке сайт заканчивается над рядом кнопок: нативный WebView лежит поверх страницы.
  function sizeAndPush(){
    var c = el("settingsTabContent"), v = el("userTabView"), b = bridge();
    var t = (active && activeId) ? find(activeId) : null;
    if(!active || !c || !v || !b || !t) return;
    var cr = c.getBoundingClientRect();
    var pad = parseFloat(getComputedStyle(c).paddingBottom) || 0;
    var top = v.getBoundingClientRect().top;
    var bottom = cr.bottom - pad;
    var row = el("siteFabRow");
    var holes = "";
    if(row){
      if(holesOk(b)) holes = holesOf(row);
      else{
        var rr = row.getBoundingClientRect();
        if(rr.height > 0) bottom = Math.min(bottom, rr.top - 4);
      }
    }
    var h = Math.max(160, Math.floor(bottom - top));
    v.style.height = h + "px";
    var r = v.getBoundingClientRect();
    var key = [r.left, r.top, r.width, r.height].map(Math.round).join(",") + "|" + holes;
    if(key === lastRect) return;
    lastRect = key;
    try{ b.utabShow(t.id, t.home, r.left, r.top, r.width, r.height); }catch(e){}
    if(holeSupport){ try{ b.utabHoles(holes); }catch(e){} }
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
    var site = false;
    for(var j = 0; j < c.children.length; j++){ if(c.children[j].id === "userTabView"){ site = true; break; } }
    if(box && box.classList){ box.classList.toggle("lt-edge", has); box.classList.toggle("lt-site", site); }
    if(ov) ov.classList.toggle("lt-edge-ov", has);
    if(was !== has){ try{ window.dispatchEvent(new Event("resize")); }catch(e){} }
    if(!edgeObserver && window.MutationObserver){
      edgeObserver = new MutationObserver(syncEdge);
      edgeObserver.observe(c, { childList: true });
    }
  }

  // ---- синхронизация между устройствами (канал карточек QR) ----
  function mdApi(){
    try{ return deps.getMdEditor ? deps.getMdEditor() : null; }catch(e){ return null; }
  }
  function loadSync(){
    var o = null;
    try{ o = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); }catch(e){ o = null; }
    if(!o || typeof o !== "object") o = {};
    if(!o.synced || typeof o.synced !== "object") o.synced = {};
    if(!Array.isArray(o.pending)) o.pending = [];
    return o;
  }
  function saveSync(o){
    try{ localStorage.setItem(SYNC_KEY, JSON.stringify(o)); }catch(e){}
  }
  // запись вкладки в том виде, как она ходит между устройствами
  function cloudOf(t){
    return { id: t.id, type: SYNC_TYPE, home: t.home, createdAt: t.createdAt || 0, updatedAt: t.updatedAt || 0 };
  }
  // пришедшую из облака запись проверяем: своего типа, id как у вкладки, адрес — нормальный https
  function cloudTab(r){
    if(!r || r.type !== SYNC_TYPE || typeof r.id !== "string" || !ID_RE.test(r.id)) return null;
    var home = normalizeUrl(r.home);
    if(!home) return null;
    return { id: r.id, home: home, createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0 };
  }
  // true — локальный список изменился
  function reconcile(){
    var m = mdApi();
    if(!m || !m.cardMetaStatus || !m.cardMetaAll || !m.cardMetaSave || !m.cardMetaRemove) return false;
    var st = m.cardMetaStatus();
    if(!st || !st.ready) return false; // синхронизация не настроена или заметки ещё не загружены: вкладки живут только здесь
    var info = loadSync();
    var changed = false;
    var remote = {};
    m.cardMetaAll().forEach(function(r){ var n = cloudTab(r); if(n) remote[n.id] = n; });

    // 1) удалённые здесь — убрать из облака (пока облако не прочитано целиком, запись может ещё не прийти — ждём)
    var keep = [];
    info.pending.forEach(function(id){
      if(find(id)) return; // id снова занят — не трогаем
      if(remote[id]){ m.cardMetaRemove(id); delete remote[id]; delete info.synced[id]; }
      else if(!st.pulled) keep.push(id);
      else delete info.synced[id];
    });
    info.pending = keep;

    // 2) локальные вкладки против облака
    var out = [], removed = [], homeChanged = [];
    tabs.forEach(function(t){
      var r = remote[t.id];
      if(!r){
        if(info.synced[t.id]){
          // была в облаке, теперь нет: удалена на другом устройстве — но только если облако прочитано целиком
          if(st.pulled){ delete info.synced[t.id]; removed.push(t.id); changed = true; return; }
          out.push(t);
          return;
        }
        if(t.home && m.cardMetaSave(cloudOf(t))) info.synced[t.id] = 1; // пустая вкладка (адрес ещё не введён) наружу не идёт
        out.push(t);
        return;
      }
      delete remote[t.id];
      info.synced[t.id] = 1;
      if(!t.home || r.updatedAt > (t.updatedAt || 0)){
        // пришла более новая версия (или здесь вкладка ещё пустая): берём адрес из облака
        if(r.home !== t.home){ t.home = r.home; homeChanged.push(t); }
        t.updatedAt = r.updatedAt;
        if(r.createdAt) t.createdAt = r.createdAt;
        changed = true;
      }else if(t.home && (r.home !== t.home || (r.updatedAt || 0) < (t.updatedAt || 0))){
        m.cardMetaSave(cloudOf(t)); // здесь новее
      }
      out.push(t);
    });

    // 3) новые из облака
    Object.keys(remote).forEach(function(id){
      var r = remote[id];
      out.push({ id: id, home: r.home, createdAt: r.createdAt || Date.now(), updatedAt: r.updatedAt || 0 });
      info.synced[id] = 1;
      changed = true;
    });

    saveSync(info);
    if(!changed) return false;
    var wasCurrent = deps.getCurrentTab ? deps.getCurrentTab() : null;
    tabs = sortTabs(out);
    save();
    removed.forEach(function(id){
      if(armedId === id) disarm();
      if(activeId === id) hide();
      if(formFor === id) formFor = null;
      var b = bridge();
      if(b){ try{ b.utabRemove(id); }catch(e){} }
      delete icons[id];
      delete iconRev[id];
    });
    homeChanged.forEach(function(t){
      var b = bridge();
      delete icons[t.id];
      iconRev[t.id] = 0;
      if(b && t.home){ try{ b.utabGo(t.id, t.home); }catch(e){} }
    });
    rebuildButtons();
    // открытая вкладка исчезла — уходим на «Claude», как при ручном удалении; у открытой с новым адресом перерисовываем содержимое
    if(wasCurrent && wasCurrent.indexOf(KEY_PREFIX) === 0){
      if(!find(idOf(wasCurrent))){ if(deps.switchTab) deps.switchTab(CLAUDE_KEY); }
      else if(homeChanged.some(function(t){ return keyOf(t.id) === wasCurrent; })) render(wasCurrent);
    }
    return true;
  }
  // кнопки вкладок перестраиваются по порядку списка (в DOM — старые первыми, новая прямо перед «+»)
  function rebuildButtons(){
    if(armedId) disarm();
    var old = document.querySelectorAll('[id^="' + BTN_PREFIX + '"]');
    for(var i = 0; i < old.length; i++) if(old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    tabs.forEach(buildButton);
    tabs.forEach(function(t){ syncIcon(t.id); });
    if(deps.refresh) deps.refresh();
    if(deps.getCurrentTab) applyActive(deps.getCurrentTab());
  }

  var syncTimer = null, lastPull = 0, listenerSet = false, retryLeft = 0;
  function syncListener(){ try{ reconcile(); }catch(e){} }
  // [pull] — заодно перечитать облако (не чаще раза в минуту); без pull — только сверка с тем, что уже пришло
  function syncSoon(pull){
    var m = mdApi();
    if(!m || !m.cardMetaStatus) return;
    if(!listenerSet && m.addCardMetaListener){ listenerSet = true; m.addCardMetaListener(syncListener); } // приход записей с другого устройства
    if(syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function(){
      syncTimer = null;
      var st = m.cardMetaStatus();
      if(!st || !st.ready){
        // заметки ещё грузятся: пробуем снова несколько раз (синхронизация могла быть и не настроена — тогда тихо останавливаемся)
        if(retryLeft > 0){ retryLeft--; syncSoon(pull); }
        return;
      }
      try{ reconcile(); }catch(e){}
      var now = Date.now();
      if(pull && m.cardMetaPull && now - lastPull > PULL_MIN_MS){
        lastPull = now;
        m.cardMetaPull().then(function(){ try{ reconcile(); }catch(e){} }, function(){});
      }
    }, pull ? 1200 : 800);
  }

  function init(d){
    deps = d || {};
    tabs = load();
    stampTabs();
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
    retryLeft = 12;
    syncSoon(true); // при запуске: догнать вкладки с других устройств
  }

  window.UserTabsMod = {
    init: init, isKey: isKey, keys: keys, buttonId: buttonId,
    render: render, onSwitch: onSwitch, hide: hide,
    applyVisibility: applyVisibility, applyActive: applyActive, syncSoon: syncSoon
  };
})();
