/* hotkeys.js
   Версия: 1.3 (16.11) — `HotkeysMod.press(combo)`: вход для оболочки (APK) — Ctrl+стрелки, Ctrl+1…9 и Ctrl+F работают и на вкладках-сайтах, где клавиши ловит их собственный WebView. Откат: hotkeys.js 1.2.
   Версия: 1.2 (16.11) — Ctrl+1…Ctrl+9: прямой переход на N-й язычок нижнего ряда (по порядку на экране; нет такого номера — ничего не делает). Стрелки Ctrl+←/→/↑/↓ остались как были. Откат: hotkeys.js 1.1.
   Версия: 1.1 (16.11) — Ctrl+←/→/↑/↓ работают и в полноэкранном режиме / режиме чтения (язычки там спрятаны: измерение идёт с временно снятым `.reading-mode-active`, `measureWithTabsRevealed`); новая клавиша Ctrl+F — включить/выключить полноэкранный режим (`window.DisplayMode.toggleFullscreen` из my.js; работает и если режим включён кнопкой на экране). Откат: hotkeys.js 1.0.
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
  // В полноэкранном режиме и режиме чтения ряды язычков спрятаны (display:none, класс .reading-mode-active на окне настроек) — у них нет размеров, и ни «видимость», ни
  // порядок по координатам не определить. Поэтому измерение идёт с временно снятым классом: всё в одном синхронном проходе, кадр между снятием и возвратом не рисуется,
  // человек ничего не видит. Само нажатие на язычок делается уже после возврата класса — как будто ряды и не показывались.
  function measureWithTabsRevealed(fn){
    var ov = document.getElementById("settingsModalOverlay");
    var hidden = !!ov && ov.classList.contains("reading-mode-active");
    if(hidden) ov.classList.remove("reading-mode-active");
    try{ return fn(); }
    finally{ if(hidden) ov.classList.add("reading-mode-active"); }
  }
  // шаг по кругу: dir = +1 (дальше по экрану: вправо / вниз) или -1 (назад: влево / вверх)
  function stepRow(ids, axis, dir){
    var btn = measureWithTabsRevealed(function(){
      var list = usableTabs(visibleRow(ids), axis);
      if(!list.length) return false;
      var cur = -1;
      for(var i = 0; i < list.length; i++){ if(list[i].classList.contains("active")){ cur = i; break; } }
      var next;
      if(cur === -1) next = dir > 0 ? 0 : list.length - 1;
      else next = (cur + dir + list.length) % list.length;
      if(list.length === 1 && cur === 0) return null; // единственный язычок — переходить некуда, но клавишу не отдаём странице
      return list[next];
    });
    if(btn === false) return false;
    if(btn) { try{ btn.click(); }catch(e){} }
    return true;
  }

  // ---------- первые горячие клавиши ----------
  register("ctrl+arrowright", function(){ return stepRow(BOTTOM_ROWS, "x", +1); });
  register("ctrl+arrowleft",  function(){ return stepRow(BOTTOM_ROWS, "x", -1); });
  register("ctrl+arrowdown",  function(){ return stepRow(SIDE_ROWS, "y", +1); });
  register("ctrl+arrowup",    function(){ return stepRow(SIDE_ROWS, "y", -1); });

  // Ctrl+1…Ctrl+9 — перейти сразу на N-й язычок нижнего ряда (порядок — как на экране слева направо). Если язычков меньше N, клавиша ничего не делает, но и странице не уходит.
  function jumpRow(ids, axis, n){
    var btn = measureWithTabsRevealed(function(){
      var list = usableTabs(visibleRow(ids), axis);
      return list[n - 1] || null;
    });
    if(btn && !btn.classList.contains("active")){ try{ btn.click(); }catch(e){} }
    return true;
  }
  [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function(n){
    register("ctrl+" + n, function(){ return jumpRow(BOTTOM_ROWS, "x", n); });
  });

  // Ctrl+F — полноэкранный режим: первое нажатие включает, повторное выключает. Работает и тогда, когда режим включён кнопкой на экране (общий флаг, одна и та же
  // функция, что у кнопки в нижней панели: my.js → window.DisplayMode). Не требует открытого окна настроек и работает в полях ввода (браузерный поиск по Ctrl+F здесь отдан приложению).
  register("ctrl+f", function(){
    var dm = window.DisplayMode;
    if(!dm || typeof dm.toggleFullscreen !== "function") return false;
    dm.toggleFullscreen();
    return true;
  }, { always: true, inEditable: true });

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

  // Нажатие из оболочки: на вкладках-сайтах и «Claude» клавиши ловит их собственный WebView, страница приложения события не получает — оболочка присылает комбинацию сама
  // (`ctrl+arrowright`, `ctrl+3`, …). Поле ввода уже проверено на стороне сайта, поэтому здесь его нет; остальные условия те же, что у обычного нажатия.
  function press(combo){
    var entry = registry[normalize(combo)];
    if(!entry) return false;
    if(!entry.always && !settingsOpen()) return false;
    var handled = false;
    try{ handled = entry.handler({ key: String(combo).split("+").pop(), fromNative: true, preventDefault: function(){}, stopPropagation: function(){} }) === true; }catch(e){ try{ console.error("[hotkeys]", e); }catch(_){} }
    return handled;
  }

  window.HotkeysMod = { register: register, unregister: unregister, press: press };
})();
