/* ===========================================================================
   tabreorder.js
   Версия: 1.1 (07.11)
   Перестановка язычков окна настроек: долгое нажатие (≈0,45 с) поднимает язычок, дальше его можно тащить пальцем (мышью) и бросить на
   нужное место. Менять местами можно только язычки ОДНОЙ группы; группы не смешиваются, а язычок не выходит за границы своей группы.
   Состав групп отдаёт my.js (`TabReorder.init({getGroups})`, функция `tabReorderGroups`): { имя: {host: id контейнера, ids: [id кнопок]} }.
   Кнопки вне групп («+» ряда «Интернет», невидимые промежутки) не двигаются и не двигают.
   Порядок = порядок кнопок в DOM внутри их контейнера: переставляются только кнопки одной группы, каждая встаёт на место (слот)
   другой, поэтому остальные кнопки контейнера остаются там, где были. Остальной код (самая нижняя вкладка ряда, список «Скрытие вкладок»)
   читает DOM и порядок подхватывает сам.
   Хранение отдаёт my.js: `deps.loadOrder()` → {имя группы: [id кнопок в порядке DOM]}, `deps.saveOrder(имя, [id])` (порядок лежит в state и
   едет в облако). Без этих deps — запасной localStorage `bibleTabOrder_v1`. Кнопки, которых в списке нет (вкладка-сайт другого
   устройства, новая вкладка), остаются там, куда их вставили. Новые кнопки подхватывает MutationObserver.
   Жесты — touch + мышь, без pointer events и без options-объекта в addEventListener (старый WebView, Android 5.0).
   Публично: window.TabReorder.{init, busy, apply}; `busy()` — идёт перетаскивание (usertabs.js не ставит крестик удаления).
   =========================================================================== */
(function(){
  "use strict";

  var STORE_KEY = "bibleTabOrder_v1";
  var HOLD_MS = 450;        // сколько держать, чтобы язычок «поднялся»
  var HOLD_SLOP = 10;       // сдвиг до подъёма, после которого жест считается прокруткой/обычным нажатием
  var DRAG_SLOP = 6;        // сдвиг после подъёма, с которого начинается перетаскивание
  var CLICK_GUARD_MS = 250; // сколько после перетаскивания гасим click

  var deps = null;
  var st = null;            // состояние жеста: {el, group, host, axis, ...}
  var dragging = false;
  var lastTouchAt = 0;
  var clickGuardUntil = 0;
  var applying = false;
  var observer = null;
  var obsTimer = null;

  // ---- поддержка passive-опции (в старых WebView третий аргумент-объект читается как capture=true) ----
  var passiveOk = false;
  try{
    var o = Object.defineProperty({}, "passive", { get: function(){ passiveOk = true; return false; } });
    window.addEventListener("tr-test", null, o);
    window.removeEventListener("tr-test", null, o);
  }catch(e){}
  function noPassive(){ return passiveOk ? { passive: false } : false; }

  function byId(id){ return document.getElementById(id); }
  function groups(){
    try{ return (deps && deps.getGroups && deps.getGroups()) || {}; }catch(e){ return {}; }
  }
  function visible(el){ return !!el && el.offsetWidth > 0 && el.offsetHeight > 0; }
  function isTab(el){ return !!el && el.nodeType === 1 && el.classList && el.classList.contains("settings-tab"); }
  function tabOf(node){
    while(node && node.nodeType === 1){ if(isTab(node)) return node; node = node.parentNode; }
    return null;
  }
  function groupNameOf(el, gs){
    for(var name in gs){
      if(!Object.prototype.hasOwnProperty.call(gs, name)) continue;
      if(gs[name].ids.indexOf(el.id) !== -1) return name;
    }
    return null;
  }
  // кнопки группы в порядке DOM (только те, что есть и лежат прямо в контейнере группы)
  function membersOf(g){
    var host = byId(g.host);
    if(!host) return [];
    var res = [];
    for(var i = 0; i < host.children.length; i++){
      var ch = host.children[i];
      if(ch.id && g.ids.indexOf(ch.id) !== -1) res.push(ch);
    }
    return res;
  }

  // ---- хранение ----
  function readStore(){
    if(deps && deps.loadOrder){
      try{ var d = deps.loadOrder(); return (d && typeof d === "object") ? d : {}; }catch(e){ return {}; }
    }
    try{ var o = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }catch(e){ return {}; }
  }
  function writeStore(o){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(o)); }catch(e){}
  }
  function saveGroup(name, g){
    var ids = membersOf(g).map(function(el){ return el.id; });
    if(deps && deps.saveOrder){
      try{ deps.saveOrder(name, ids); }catch(e){}
      return;
    }
    var o = readStore();
    o[name] = ids;
    writeStore(o);
  }

  // ---- перестановка: каждая кнопка встаёт на место (слот) другой, остальной DOM контейнера не трогаем ----
  function permute(current, desired){
    var parent = current[0] && current[0].parentNode;
    if(!parent || current.length !== desired.length) return false;
    var changed = [];
    for(var i = 0; i < current.length; i++) if(current[i] !== desired[i]) changed.push(i);
    if(!changed.length) return false;
    var slots = {};
    changed.forEach(function(i){
      var mark = document.createComment("tab-slot");
      parent.insertBefore(mark, current[i]);
      slots[i] = mark;
    });
    changed.forEach(function(i){ parent.removeChild(current[i]); });
    changed.forEach(function(i){
      parent.insertBefore(desired[i], slots[i]);
      parent.removeChild(slots[i]);
    });
    return true;
  }

  // сохранённый порядок -> DOM (кнопки не из списка остаются на своих местах)
  function applyGroup(name, g, saved){
    var cur = membersOf(g);
    if(cur.length < 2 || !saved || !saved.length) return false;
    var known = cur.filter(function(el){ return saved.indexOf(el.id) !== -1; });
    if(known.length < 2) return false;
    var byIdMap = {};
    known.forEach(function(el){ byIdMap[el.id] = el; });
    var wanted = [];
    saved.forEach(function(id){ if(byIdMap[id] && wanted.indexOf(byIdMap[id]) === -1) wanted.push(byIdMap[id]); });
    if(wanted.length !== known.length) return false;
    // позиции known в cur -> те же слоты, но в желаемом порядке
    var desired = cur.slice();
    var k = 0;
    for(var i = 0; i < cur.length; i++){
      if(saved.indexOf(cur[i].id) !== -1) desired[i] = wanted[k++];
    }
    return permute(cur, desired);
  }
  function applyAll(){
    if(applying || dragging) return;
    applying = true;
    var changed = false;
    try{
      var gs = groups(), store = readStore();
      for(var name in gs){
        if(!Object.prototype.hasOwnProperty.call(gs, name)) continue;
        if(applyGroup(name, gs[name], store[name])) changed = true;
      }
    }catch(e){}
    applying = false;
    if(changed && deps && deps.onChange){ try{ deps.onChange(); }catch(e){} }
  }

  // ---- стили ----
  function ensureStyle(){
    if(byId("tabReorderStyle")) return;
    var s = document.createElement("style");
    s.id = "tabReorderStyle";
    s.textContent =
      ".settings-tab.lt-tab-ready{box-shadow:0 0 0 2px var(--wood, #5b4a8a), 0 4px 10px rgba(0,0,0,.35) !important;}" +
      ".settings-tab.lt-tab-dragging{z-index:30;box-shadow:0 0 0 2px var(--wood, #5b4a8a), 0 8px 18px rgba(0,0,0,.45) !important;transition:none !important;}" +
      ".lt-tab-reordering .settings-tab{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}";
    document.head.appendChild(s);
  }

  // ---- геометрия (offset* не зависит от transform; координаты — физические, поэтому раскладка левши не мешает) ----
  function startOf(el, axis){ return axis === "y" ? el.offsetTop : el.offsetLeft; }
  function sizeOf(el, axis){ return axis === "y" ? el.offsetHeight : el.offsetWidth; }
  function centerOf(el, axis){ return startOf(el, axis) + sizeOf(el, axis) / 2; }
  function pointerLocal(p, axis){
    var r = st.host.getBoundingClientRect();
    return axis === "y" ? (p.clientY - r.top - (st.host.clientTop || 0)) : (p.clientX - r.left - (st.host.clientLeft || 0));
  }
  function setTranslate(el, axis, d){
    el.style.transform = (axis === "y" ? "translateY(" : "translateX(") + d + "px) scale(1.08)";
  }

  function clearSiblingMotion(){
    if(!st) return;
    membersOf(st.g).forEach(function(el){
      if(el === st.el) return;
      if(el.__trFlipT){ clearTimeout(el.__trFlipT); el.__trFlipT = null; }
      el.style.transition = "";
      el.style.transform = "";
    });
  }
  // мягкий переезд остальных кнопок на новые места
  function flip(members, oldPos){
    var axis = st.axis;
    var moved = [];
    members.forEach(function(el){
      if(el === st.el || !visible(el)) return;
      var d = oldPos[el.id] - startOf(el, axis);
      if(!d) return;
      el.style.transition = "none";
      el.style.transform = (axis === "y" ? "translateY(" : "translateX(") + d + "px)";
      moved.push(el);
    });
    if(!moved.length) return;
    void st.host.offsetWidth; // принудительная раскладка: начальное смещение зафиксировано
    moved.forEach(function(el){
      if(el.__trFlipT) clearTimeout(el.__trFlipT);
      el.style.transition = "transform 140ms ease";
      el.style.transform = "";
      el.__trFlipT = setTimeout(function(){ el.style.transition = ""; el.__trFlipT = null; }, 200);
    });
  }

  // ---- жест ----
  function pointOf(e){
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    return t || e;
  }
  function cleanupReady(){
    if(!st) return;
    if(st.timer){ clearTimeout(st.timer); st.timer = null; }
    st.el.classList.remove("lt-tab-ready");
  }
  function begin(e, isTouch){
    if(st || !deps) return;
    if(isTouch && e.touches && e.touches.length !== 1) return;
    var el = tabOf(e.target);
    if(!el || el.classList.contains("settings-tab-decor") || el.classList.contains("settings-tab-gap")) return;
    var gs = groups();
    var name = groupNameOf(el, gs);
    if(!name) return;
    var host = el.parentNode;
    if(!host || host.id !== gs[name].host) return;
    var vis = membersOf(gs[name]).filter(visible);
    if(vis.length < 2 || vis.indexOf(el) === -1) return;
    var p = pointOf(e);
    st = {
      el: el, name: name, g: gs[name], host: host,
      axis: (host.id === "settingsTabsGear" || host.id === "settingsTabsGearSet2") ? "x" : "y",
      sx: p.clientX, sy: p.clientY, ready: false, grab: 0, isTouch: isTouch, moved: false
    };
    st.timer = setTimeout(function(){
      if(!st || dragging) return;
      st.ready = true;
      st.grab = pointerLocal({ clientX: st.sx, clientY: st.sy }, st.axis) - centerOf(st.el, st.axis);
      st.el.classList.add("lt-tab-ready");
      document.documentElement.classList.add("lt-tab-reordering");
      try{ if(navigator.vibrate) navigator.vibrate(12); }catch(err){}
    }, HOLD_MS);
    if(isTouch){
      el.addEventListener("touchmove", onTouchMove, noPassive());
      el.addEventListener("touchend", onTouchEnd, noPassive());
      el.addEventListener("touchcancel", onTouchEnd, noPassive());
    } else {
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mouseup", onMouseUp, true);
    }
  }

  function startDrag(){
    dragging = true;
    st.moved = true;
    st.el.classList.remove("lt-tab-ready");
    st.el.classList.add("lt-tab-dragging");
  }

  function move(p, e){
    if(!st) return;
    var dx = Math.abs(p.clientX - st.sx), dy = Math.abs(p.clientY - st.sy);
    if(!st.ready){
      // палец уехал до подъёма — обычное нажатие/прокрутка, жест отменяется
      if(dx > HOLD_SLOP || dy > HOLD_SLOP) finish(false);
      return;
    }
    if(!dragging){
      if(dx < DRAG_SLOP && dy < DRAG_SLOP) return;
      startDrag();
    }
    if(e && e.cancelable) e.preventDefault();
    update(p);
  }

  // положение поднятого язычка за пальцем + обмен местами с соседями
  function update(p){
    var axis = st.axis, el = st.el;
    var members = membersOf(st.g);
    var vis = members.filter(visible);
    if(vis.length < 2) return;
    // границы группы (видимые члены): язычок за них не выходит
    var lo = Infinity, hi = -Infinity;
    vis.forEach(function(m){ lo = Math.min(lo, startOf(m, axis)); hi = Math.max(hi, startOf(m, axis) + sizeOf(m, axis)); });
    var half = sizeOf(el, axis) / 2;
    var v = pointerLocal(p, axis) - st.grab;                // где должен быть центр язычка
    v = Math.max(lo + half, Math.min(hi - half, v));
    var cd = centerOf(el, axis);                            // центр его слота в раскладке
    // кого мы «перешагнули» (центр соседа пройден) — берём самого дальнего
    var target = null;
    vis.forEach(function(o){
      if(o === el) return;
      var co = centerOf(o, axis);
      var passed = (co > cd && v >= co) || (co < cd && v <= co);
      if(!passed) return;
      if(!target || Math.abs(co - cd) > Math.abs(centerOf(target, axis) - cd)) target = o;
    });
    if(target){
      var oldPos = {};
      vis.forEach(function(m){ oldPos[m.id] = startOf(m, axis); });
      var order = members.slice();
      var di = order.indexOf(el), after = di < members.indexOf(target);
      order.splice(di, 1);
      var ti = order.indexOf(target);
      order.splice(after ? ti + 1 : ti, 0, el);
      if(permute(members, order)){
        el.style.transform = "";
        flip(order, oldPos);
        cd = centerOf(el, axis);
      }
    }
    setTranslate(el, axis, v - cd);
  }

  function finish(drop){
    if(!st) return;
    var s = st;
    var wasDragging = dragging;
    cleanupReady();
    s.el.removeEventListener("touchmove", onTouchMove, noPassive());
    s.el.removeEventListener("touchend", onTouchEnd, noPassive());
    s.el.removeEventListener("touchcancel", onTouchEnd, noPassive());
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    clearSiblingMotion();
    s.el.classList.remove("lt-tab-dragging");
    s.el.style.transform = "";
    s.el.style.transition = "";
    document.documentElement.classList.remove("lt-tab-reordering");
    dragging = false;
    st = null;
    if(wasDragging){
      clickGuardUntil = Date.now() + CLICK_GUARD_MS;
      if(drop !== false) saveGroup(s.name, s.g);
      if(deps && deps.onChange){ try{ deps.onChange(); }catch(err){} } // заплатки углов и т.п. пересчитываются по новым местам
    }
  }

  // ---- обработчики ----
  function onTouchMove(e){ if(!st) return; move(pointOf(e), e); }
  function onTouchEnd(e){
    var wasDragging = dragging;
    if(wasDragging && e && e.cancelable) e.preventDefault(); // без click и эмуляции мыши
    finish(true);
  }
  function onMouseMove(e){ if(!st) return; move(e, e); }
  function onMouseUp(){ finish(true); }

  function onTouchStart(e){ lastTouchAt = Date.now(); begin(e, true); }
  function onMouseDown(e){
    if(e.button !== 0) return;
    if(Date.now() - lastTouchAt < 800) return; // эмуляция мыши после касания
    begin(e, false);
  }
  function onContextMenu(e){
    if(!(st && (st.ready || dragging))) return;
    if(tabOf(e.target)) e.preventDefault();
  }
  function onClickCapture(e){
    if(Date.now() < clickGuardUntil && tabOf(e.target)){
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }

  function scheduleApply(){
    if(obsTimer) clearTimeout(obsTimer);
    obsTimer = setTimeout(function(){ obsTimer = null; applyAll(); }, 60);
  }

  function init(d){
    if(deps) return;
    deps = d || {};
    ensureStyle();
    ["settingsTabs", "settingsTabsGear"].forEach(function(id){
      var host = byId(id);
      if(!host) return;
      host.addEventListener("touchstart", onTouchStart, true);
      host.addEventListener("mousedown", onMouseDown, true);
      host.addEventListener("contextmenu", onContextMenu, true);
    });
    document.addEventListener("click", onClickCapture, true);
    applyAll();
    // новые кнопки (вкладки-сайты) встают на сохранённое место, когда появляются
    if(window.MutationObserver){
      observer = new MutationObserver(function(){ if(!applying && !dragging) scheduleApply(); });
      ["settingsTabs", "settingsTabsGear"].forEach(function(id){
        var host = byId(id);
        if(host) observer.observe(host, { childList: true });
      });
    }
  }

  window.TabReorder = {
    init: init,
    busy: function(){ return dragging; }, // идёт перетаскивание (поднятый, но не сдвинутый язычок не считается)
    apply: applyAll
  };
})();
