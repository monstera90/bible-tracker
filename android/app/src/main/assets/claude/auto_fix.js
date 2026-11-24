/* auto_fix.js
   Версия: 1.1 (24.11)
   1.1 (24.11): карточка в claude.ai подписана «Fix / ZIP» (без «.zip»), значок скачивания без текста — поиск по подписи «ZIP» и имени «Fix», нажатие на значок справа.
   Скрипт вкладки Claude (ClaudeTab.kt вставляет его в страницу claude.ai после загрузки; перед ним подставляется `window.__ltFixCfg = {enabled: true|false};`).
   Автоскачивание fix.zip для автокоммита (AutoCommit.kt): когда агент закончил ответ и в диалоге ПОЯВИЛАСЬ новая карточка файла fix.zip,
   скрипт сам нажимает на неё (и на кнопку «Скачать», если она нужна). Дальше скачивание перехватывает приложение и коммитит файл.
   Старые карточки (история диалога, прокрутка, смена чата) не трогаются: нажатие бывает только после ответа, который скрипт видел «в процессе»,
   и только если число карточек выросло. Вёрстка claude.ai может меняться — разметка подбирается по тексту и aria-label (ES5).
   Наружу: window.__ltFix.status() → {seq, error, on}; приложение читает его и пишет ошибку в «Последний результат». */
(function(){
  "use strict";
  if(window.__ltFix) return;

  var NAME_RE = /^fix(\s*\(\d+\)|-\d+)?\.zip$/i;
  var DL_RE = /(^|\s)(download|скачать|загрузить)(\s|$)|download|скачать/i;
  var POLL_MS = 1000;

  var baseline = -1, sawGen = false, stable = 0, lastPath = location.pathname, busy = false;
  var seq = 0, errText = "";

  function enabled(){ var c = window.__ltFixCfg || {}; return !!c.enabled; }
  function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length))); }
  function txt(el){ return String(el.textContent || "").replace(/\s+/g, " ").trim(); }

  function generating(){
    return !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="Останов" i]');
  }

  var TITLE_RE = /^fix(\s*\(\d+\)|-\d+)?(\.zip)?$/i;

  function inCode(el){ return !!(el.closest && el.closest("code,pre")); }
  function hasTitle(root){
    var list = root.querySelectorAll("div,span,p,a,h1,h2,h3,h4");
    for(var i = 0; i < list.length; i++){
      if(list[i].children.length === 0 && TITLE_RE.test(txt(list[i]))) return true;
    }
    return false;
  }

  // Карточки файла fix.zip. Так их рисует claude.ai сейчас: крупное имя без расширения («Fix»), под ним подпись «ZIP», справа значок скачивания.
  // Запасной вариант: элемент с текстом «fix.zip» целиком. В коде/цитатах ничего не ищется.
  function cards(){
    var out = [], all = document.querySelectorAll("div,span,p");
    for(var i = 0; i < all.length; i++){
      var el = all[i];
      if(el.children.length !== 0 || inCode(el)) continue;
      var t = txt(el);
      if(/^zip$/i.test(t)){
        var e = el.parentElement;
        for(var up = 0; up < 5 && e && e !== document.body; up++){
          if(hasTitle(e)){ if(out.indexOf(e) === -1) out.push(e); break; }
          e = e.parentElement;
        }
      } else if(t.length <= 40 && NAME_RE.test(t)){
        var holder = el.parentElement || el;
        if(out.indexOf(holder) === -1 && !out.some(function(c){ return c.contains(el); })) out.push(holder);
      }
    }
    // вложенные дубли (внешний контейнер и внутренний) — оставляем самый внутренний
    return out.filter(function(c){
      for(var k = 0; k < out.length; k++){ if(out[k] !== c && c.contains(out[k])) return false; }
      return true;
    });
  }

  function clickable(el){
    var e = el;
    for(var up = 0; up < 6 && e && e !== document.body; up++){
      var tag = e.tagName;
      if(tag === "BUTTON" || tag === "A" || (e.getAttribute && e.getAttribute("role") === "button")) return e;
      e = e.parentElement;
    }
    return el;
  }
  function fire(el){
    try{
      ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function(type){
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    }catch(e){}
    try{ el.click(); }catch(e2){}
  }

  function isDownloadControl(el){
    if(!visible(el)) return false;
    var label = (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "");
    var t = txt(el);
    if(t.length > 30) t = "";
    if(el.tagName === "A" && (el.hasAttribute("download") || /^blob:/.test(el.getAttribute("href") || ""))) return true;
    return DL_RE.test(label + " " + t);
  }
  function controlsIn(root){
    var out = [], list = root.querySelectorAll('button,a,[role="menuitem"],[role="button"]');
    for(var i = 0; i < list.length; i++){ if(isDownloadControl(list[i])) out.push(list[i]); }
    return out;
  }
  function allControls(){ return document.querySelectorAll('button,a,[role="menuitem"],[role="button"]'); }

  function done(count){ baseline = count; sawGen = false; stable = 0; busy = false; }
  function fail(msg, count){ errText = "автоскачивание fix.zip: " + msg; seq++; done(count); }

  function waitDownload(t0, count, snapshot){
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      if((window.__ltFixDl || 0) >= t0){ clearInterval(iv); errText = ""; done(count); return; } // приложение уже забрало файл
      var all = allControls(), found = null;
      for(var i = 0; i < all.length; i++){
        if(snapshot.indexOf(all[i]) === -1 && isDownloadControl(all[i])){ found = all[i]; break; }
      }
      if(found){
        clearInterval(iv);
        fire(found);
        setTimeout(function(){
          if((window.__ltFixDl || 0) >= t0){ errText = ""; done(count); }
          else fail("нажал «Скачать», но скачивание не началось", count);
        }, 6000);
        return;
      }
      if(tries >= 12){ clearInterval(iv); fail("после нажатия на карточку не нашёл кнопку «Скачать»", count); }
    }, 700);
  }

  function start(card, count){
    busy = true;
    var t0 = Date.now();
    var snapshot = Array.prototype.slice.call(allControls());
    // 1) значок/кнопка скачивания прямо на карточке: по подписи, иначе последний значок справа
    var ctrl = null, found = controlsIn(card);
    if(found.length) ctrl = found[found.length - 1];
    if(!ctrl){
      var icons = card.querySelectorAll("svg");
      if(icons.length) ctrl = clickable(icons[icons.length - 1]);
    }
    if(ctrl){
      fire(ctrl);
      setTimeout(function(){
        if((window.__ltFixDl || 0) >= t0){ errText = ""; done(count); }
        else waitDownload(t0, count, snapshot);   // нажатие открыло просмотр — ищем кнопку «Скачать» в нём
      }, 3000);
      return;
    }
    // 2) нажать на саму карточку и подождать, что появится
    fire(clickable(card));
    waitDownload(t0, count, snapshot);
  }

  function tick(){
    try{
      if(!enabled()){ baseline = -1; return; }
      if(busy) return;
      if(location.pathname !== lastPath){ lastPath = location.pathname; baseline = -1; sawGen = false; stable = 0; }
      var list = cards(), n = list.length;
      if(baseline < 0){ baseline = n; sawGen = false; return; }
      if(generating()){ sawGen = true; stable = 0; return; }
      if(n < baseline){ baseline = n; return; }
      if(!sawGen){ if(n > baseline) baseline = n; return; } // карточки подгрузились сами (история), а не появились в ответе
      stable++;
      if(n > baseline){
        if(stable >= 2) start(list[n - 1], n);   // новая карточка в законченном ответе
      } else if(stable >= 4){
        sawGen = false; stable = 0;               // ответ закончился без файла
      }
    }catch(e){ errText = "автоскачивание fix.zip: " + (e && e.message ? e.message : "ошибка"); seq++; busy = false; }
  }

  window.__ltFix = { status: function(){ return { seq: seq, error: errText, on: enabled() }; } };
  setInterval(tick, POLL_MS);
})();
