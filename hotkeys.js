/* hotkeys.js
   Версия: 1.0 (15.11) — горячие клавиши физической (bluetooth) клавиатуры. Первые четыре: Ctrl+←/→ — по язычкам нижнего ряда, Ctrl+↑/↓ — по язычкам бокового ряда.

   Как это устроено
   - Модуль ничего не знает о внутренностях my.js: он работает с тем, что видно на экране, и «нажимает» на язычки так же, как палец (element.click()). Поэтому все
     побочные эффекты обычного нажатия (включение бокового ряда, запоминание вкладки, подсветка, сохранение позиции) срабатывают сами.
   - Текущий язычок определяется по классу .active — его уже ведёт my.js (updateBottomGearButtons / applySideActive).
   - Порядок язычков берётся с экрана (по координатам), а не из списков в коде: переставили язычки (tabreorder.js), скрыли вкладку, добавили сайт в ряд «Интернет» —
     клавиши подхватывают это без правок.
   - Горячие клавиши работают только при открытом окне настроек (в нём живут все вкладки) и не срабатывают, пока курсор в поле ввода или редакторе
     (там Ctrl+стрелки — переход по словам, их отбирать нельзя).

   Как добавить новую горячую клавишу
     HotkeysMod.register("ctrl+shift+k", function(ev){ ...; return true; });   // true — «обработано» (браузерное действие отменяется)
     HotkeysMod.register("ctrl+s", fn, { inEditable: true });                  // inEditable: true — работать и в полях ввода
     HotkeysMod.register("ctrl+arrowup", fn, { always: true });                // always: true — не требовать открытого окна настроек
   Комбинация — модификаторы в любом порядке (ctrl, alt, shift, meta) и клавиша по значению KeyboardEvent.key в нижнем регистре (arrowup, k, f5, ...).
*/
(function(){
  "use strict";

  var ADD_BTN_ID = "settingsTabUserAddBtn"; // «+» ряда «Интернет»: создаёт вкладку-сайт, обходить её клавишами нельзя
  var SIDE_ROWS = ["settingsTabs", "settingsTabsSet2"];      // боковые ряды наборов 1 и 2 (виден один)
  var BOTTOM_ROWS = ["settingsTabsGear", "settingsTabsGearSet2"]; // нижние ряды наборов 1 и 2 (виден один)

  // ---------- реестр ----------
  var registry = Object.create(null);

  function normalize(combo){
    var parts = String(combo || "").toLowerCase().split("+").map(function(s){ return s.trim(); }).filter(Boolean);
    if(!parts.length) return "";
    var key = parts.pop();
    var mods = [];
    ["ctrl", "alt", "shift", "meta"].forEach(function(m){ if(parts.indexOf(m) !== -1) mods.push(m); });
    return mods.concat([key]).join("+");
  }
  function comboOfEvent(ev){
    var mods = [];
    if(ev.ctrlKey) mods.push("ctrl");
    if(ev.altKey) mods.push("alt");
    if(ev.shiftKey) mods.push("shift");
    if(ev.metaKey) mods.push("meta");
    return mods.concat([String(ev.key || "").toLowerCase()]).join("+");
  }
  function register(combo, handler, opts){
    var id = normalize(combo);
    if(!id || typeof handler !== "function") return false;
    registry[id] = { handler: handler, inEditable: !!(opts && opts.inEditable), always: !!(opts && opts.always) };
    return true;
  }
  function unregister(combo){ delete registry[normalize(combo)]; }

  // ---------- состояние экрана ----------
  function settingsOpen(){
    var ov = document.getElementById("settingsModalOverlay");
    return !!ov && ov.classList.contains("open");
  }
  function isEditable(el){
    if(!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if(el.isContentEditable) return true;
    return !!(el.closest && el.closest("[contenteditable=''],[contenteditable='true'],.cm-editor"));
  }
  function shown(el){ return !!el && el.getClientRects().length > 0; }

  // ---------- обход язычков ----------
  // видимый ряд из пары (набор 1 / набор 2)
  function visibleRow(ids){
    for(var i = 0; i < ids.length; i++){
      var el = document.getElementById(ids[i]);
      if(el && shown(el)) return el;
    }
    return null;
  }
  // язычки, на которые можно перейти: видимые, не декоративные, не промежуток, не скрытые пользователем, не «+»
  function usableTabs(row, axis){
    if(!row) return [];
    var list = Array.prototype.filter.call(row.querySelectorAll(".settings-tab"), function(b){
      if(b.id === ADD_BTN_ID) return false;
      if(b.disabled) return false;
      if(b.getAttribute("aria-hidden") === "true") return false;
      var c = b.classList;
      if(c.contains("settings-tab-decor") || c.contains("settings-tab-gap") || c.contains("settings-tab-user-hidden")) return false;
      return shown(b);
    });
    list.sort(function(a, b){
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return axis === "x" ? (ra.left - rb.left) : (ra.top - rb.top);
    });
    return list;
  }
  // шаг по кругу: dir = +1 (дальше по экрану: вправо / вниз) или -1 (назад: влево / вверх)
  function stepRow(ids, axis, dir){
    var list = usableTabs(visibleRow(ids), axis);
    if(!list.length) return false;
    var cur = -1;
    for(var i = 0; i < list.length; i++){ if(list[i].classList.contains("active")){ cur = i; break; } }
    var next;
    if(cur === -1) next = dir > 0 ? 0 : list.length - 1;
    else next = (cur + dir + list.length) % list.length;
    if(list.length === 1 && cur === 0) return true; // единственный язычок — переходить некуда, но клавишу не отдаём странице
    var btn = list[next];
    try{ btn.click(); }catch(e){}
    return true;
  }

  // ---------- первые горячие клавиши ----------
  register("ctrl+arrowright", function(){ return stepRow(BOTTOM_ROWS, "x", +1); });
  register("ctrl+arrowleft",  function(){ return stepRow(BOTTOM_ROWS, "x", -1); });
  register("ctrl+arrowdown",  function(){ return stepRow(SIDE_ROWS, "y", +1); });
  register("ctrl+arrowup",    function(){ return stepRow(SIDE_ROWS, "y", -1); });

  // ---------- диспетчер ----------
  document.addEventListener("keydown", function(ev){
    if(ev.defaultPrevented || ev.isComposing || ev.repeat) return;
    if(!ev.key) return;
    var entry = registry[comboOfEvent(ev)];
    if(!entry) return;
    if(!entry.always && !settingsOpen()) return;
    if(!entry.inEditable && isEditable(ev.target)) return;
    var handled = false;
    try{ handled = entry.handler(ev) === true; }catch(e){ try{ console.error("[hotkeys]", e); }catch(_){} }
    if(handled){ ev.preventDefault(); ev.stopPropagation(); }
  }, true);

  window.HotkeysMod = { register: register, unregister: unregister };
})();
