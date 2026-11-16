/* press.js — единая обработка «долгого нажатия» для всего приложения.
 *
 * Правило одно на все места: действие долгого нажатия запускается
 *   • касанием, удержанным ms миллисекунд (палец не сдвинулся дальше tol px);
 *   • левой кнопкой мыши, удержанной столько же (как раньше — удобно на компьютере);
 *   • событием contextmenu от мыши/клавиатуры (правая кнопка, клавиша «Меню», Shift+F10) — СРАЗУ, без ожидания.
 * Контекстное меню браузера на таких элементах гасится. contextmenu от самого касания (Chromium присылает его
 * на долгом нажатии пальцем) игнорируется: касание обрабатывает свой таймер.
 *
 * LTPress.bind(host, {sel, ms, tol, accept, blockAll, onLong}) → {consume(), reset(), cancel()}
 *   sel      — селектор элемента-цели внутри host (closest); без него целью считается сам host;
 *   accept   — необязательный фильтр accept(el, target) → bool;
 *   blockAll — гасить системное меню на всём host, а не только на подходящих элементах;
 *   onLong   — onLong({el, target, x, y, via}), via: "touch" | "mouse" | "context";
 *   consume()— true, если долгое нажатие (касанием/мышью) уже сработало: гасит следующий click (флаг сбрасывается).
 *              Для via:"context" флаг не ставится — click после правой кнопки не приходит.
 */
(function(){
  "use strict";
  var touchActive = false, lastTouchAt = 0;
  document.addEventListener("touchstart", function(){ touchActive = true; lastTouchAt = Date.now(); }, true);
  function touchDone(){ touchActive = false; lastTouchAt = Date.now(); }
  document.addEventListener("touchend", touchDone, true);
  document.addEventListener("touchcancel", touchDone, true);

  // эмулированные браузером события мыши после касания
  function emulated(){ return Date.now() - lastTouchAt < 800; }
  // contextmenu пришёл от касания (долгое нажатие пальцем), а не от мыши/клавиатуры
  function fromTouch(e){
    if(e && typeof e.pointerType === "string" && e.pointerType !== "") return e.pointerType === "touch";
    return touchActive && Date.now() - lastTouchAt < 10000;
  }

  function bind(host, o){
    if(!host || !o || !o.onLong) return { consume: function(){ return false; }, reset: function(){}, cancel: function(){} };
    var ms = o.ms || 350, tol = o.tol || 10;
    var timer = null, fired = false, sx = 0, sy = 0;

    function pick(target){
      var el = host;
      if(o.sel){
        el = (target && target.closest) ? target.closest(o.sel) : null;
        if(!el || !host.contains(el)) return null;
      }
      if(o.accept && !o.accept(el, target)) return null;
      return el;
    }
    function cancel(){ if(timer){ clearTimeout(timer); timer = null; } }
    function begin(e, x, y, via){
      fired = false;
      cancel();
      var el = pick(e.target);
      if(!el) return;
      sx = x; sy = y;
      var info = { el: el, target: e.target, x: x, y: y, via: via };
      timer = setTimeout(function(){ timer = null; fired = true; o.onLong(info); }, ms);
    }
    function move(x, y){
      if(!timer) return;
      var dx = x - sx, dy = y - sy;
      if(Math.sqrt(dx * dx + dy * dy) > tol) cancel();
    }

    host.addEventListener("touchstart", function(e){
      if(e.touches.length !== 1){ cancel(); return; }
      var t = e.touches[0];
      begin(e, t.clientX, t.clientY, "touch");
    }, { passive: true });
    host.addEventListener("touchmove", function(e){ var t = e.touches[0]; if(t) move(t.clientX, t.clientY); }, { passive: true });
    host.addEventListener("touchend", cancel);
    host.addEventListener("touchcancel", cancel);

    host.addEventListener("mousedown", function(e){
      if(e.button !== 0 || emulated()) return; // правая кнопка — через contextmenu, не через таймер
      begin(e, e.clientX, e.clientY, "mouse");
    });
    host.addEventListener("mousemove", function(e){ move(e.clientX, e.clientY); });
    host.addEventListener("mouseup", cancel);
    host.addEventListener("mouseleave", cancel);

    host.addEventListener("contextmenu", function(e){
      var el = pick(e.target);
      if(el || o.blockAll) e.preventDefault();
      if(!el || fromTouch(e)) return;
      cancel();
      o.onLong({ el: el, target: e.target, x: e.clientX, y: e.clientY, via: "context" });
    });

    return {
      consume: function(){ var f = fired; fired = false; return f; },
      reset: function(){ fired = false; },
      cancel: cancel
    };
  }

  window.LTPress = {
    bind: bind,
    fromMouse: function(e){ return !fromTouch(e); }, // contextmenu от мыши/клавиатуры (для жестов с протяжкой)
    emulated: emulated
  };
})();
