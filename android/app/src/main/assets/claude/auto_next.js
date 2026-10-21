/* auto_next.js
   Версия: 1.0 (21.10)
   Скрипт вкладки Claude (ClaudeTab.kt вставляет его в страницу claude.ai после загрузки; перед ним
   подставляется строка `window.__ltAutoCfg = {...};`). Когда у чата кончился лимит, ждёт его снятия и
   отправляет в чат короткое сообщение («Дальше»). Состояние ожидания хранится в localStorage claude.ai,
   поэтому переживает перезагрузку страницы. Наружу даёт window.__ltAuto.{status, sendNow, arm, disarm}. */
(function(){
  "use strict";
  if(window.__ltAuto) return; // уже запущен: настройки подхватываются из window.__ltAutoCfg на каждом тике
  var LS = "__ltAutoState_v1";
  var POLL_MS = 15000;
  var HOUR = 3600000;

  var LIMIT_RE = new RegExp(
    "(reached|hit|exceeded).{0,40}limit|limit.{0,80}reset|(message|usage) limit|" +
    "(достигли|исчерпали|превысили|достигнут).{0,40}лимит|лимит.{0,80}(сброс|обнов|восстан)|лимит сообщений", "i");

  var S = load();
  var info = "";
  var sendingSince = 0;
  var fails = 0;

  function load(){
    try{
      var o = JSON.parse(localStorage.getItem(LS) || "{}");
      return { hit: !!o.hit, resetAt: +o.resetAt || 0, src: o.src || "auto", lastReload: +o.lastReload || 0, lastSent: +o.lastSent || 0 };
    }catch(e){ return { hit:false, resetAt:0, src:"auto", lastReload:0, lastSent:0 }; }
  }
  function save(){ try{ localStorage.setItem(LS, JSON.stringify(S)); }catch(e){} }
  function cfg(){
    var c = window.__ltAutoCfg || {};
    return { enabled: !!c.enabled, text: String(c.text || "Дальше") };
  }

  function composer(){
    return document.querySelector('div[contenteditable="true"].ProseMirror') ||
           document.querySelector('[contenteditable="true"][role="textbox"]') ||
           document.querySelector('fieldset [contenteditable="true"]');
  }
  function canType(){
    var c = composer();
    return !!c && c.getAttribute("contenteditable") !== "false";
  }
  function composerText(){
    var c = composer();
    return c ? String(c.innerText || c.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function tail(){
    var t = "";
    try{ t = String(document.body.innerText || ""); }catch(e){}
    return t.slice(-1500);
  }
  function limitLine(){
    var lines = tail().split(/\n+/);
    for(var i = lines.length - 1; i >= 0; i--){ if(LIMIT_RE.test(lines[i])) return lines[i]; }
    return "";
  }

  // время снятия лимита из текста плашки: «в 17:00», «5:00 PM», «через 3 часа»; нет разбора — 5 часов
  function parseReset(line){
    var now = Date.now(), t = 0, m;
    if((m = /(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?/.exec(line))){
      var h = +m[1], mi = +m[2];
      if(m[3]){ var pm = /p/i.test(m[3]); if(pm && h < 12) h += 12; if(!pm && h === 12) h = 0; }
      if(h < 24 && mi < 60){
        var d = new Date(); d.setHours(h, mi, 0, 0);
        t = d.getTime(); if(t <= now) t += 24 * HOUR;
      }
    } else if((m = /(\d+)\s*(hours?|hrs?|час)/i.exec(line))){
      t = now + (+m[1]) * HOUR;
      var mm = /(\d+)\s*(minutes?|mins?|мин)/i.exec(line);
      if(mm) t += (+mm[1]) * 60000;
    }
    if(!t || t < now + 60000 || t > now + 6 * HOUR) t = now + 5 * HOUR;
    return t + 60000; // запас в минуту
  }

  function sendButton(){
    var c = composer(); if(!c) return null;
    var root = c.closest("fieldset") || c.closest("form") || c.parentElement;
    for(var up = 0; up < 5 && root && root.parentElement; up++){
      var b = root.querySelector('button[aria-label*="Send" i], button[aria-label*="Отправ" i], button[type="submit"]');
      if(b) return b;
      root = root.parentElement;
    }
    return null;
  }
  function clickSend(){
    var b = sendButton();
    if(b && !b.disabled && b.getAttribute("aria-disabled") !== "true"){ b.click(); return; }
    var c = composer(); if(!c) return;
    ["keydown", "keypress", "keyup"].forEach(function(type){
      c.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });
  }
  function typeAndSend(text){
    var c = composer(); if(!c) return false;
    c.focus();
    try{ document.execCommand("selectAll", false, null); document.execCommand("insertText", false, text); }catch(e){}
    if(!composerText()){
      c.textContent = text;
      c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    setTimeout(clickSend, 500);
    return true;
  }
  function clearComposer(){
    var c = composer(); if(!c) return;
    c.focus();
    try{ document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }catch(e){}
  }

  function trySend(){
    var text = cfg().text;
    if(composerText()){ info = "В поле ввода есть текст — не трогаю"; return; }
    if(!typeAndSend(text)){ info = "Не нашёл поле ввода"; return; }
    sendingSince = Date.now();
    info = "Отправляю…";
    setTimeout(function(){
      if(composerText()){
        fails++;
        clearComposer();
        if(fails >= 3){ S.hit = false; save(); fails = 0; info = "Не удалось отправить (3 попытки)"; }
        else info = "Не получилось, попробую ещё раз";
      } else {
        fails = 0; S.hit = false; S.lastSent = Date.now(); save();
        info = "Отправлено в " + new Date().toTimeString().slice(0, 5);
      }
      sendingSince = 0;
    }, 6000);
  }

  function tick(){
    try{
      var c = cfg();
      if(!c.enabled){ info = ""; return; }
      if(sendingSince && Date.now() - sendingSince < 10000) return;
      var now = Date.now();
      var line = limitLine();
      var typable = canType();
      var limited = !!line && !typable;
      if(!S.hit){
        if(limited){ S.hit = true; S.src = "auto"; S.resetAt = parseReset(line); save(); }
        else return;
      }
      var waiting = now < S.resetAt && (S.src === "manual" || limited);
      if(waiting){ info = "Жду до " + new Date(S.resetAt).toTimeString().slice(0, 5); return; }
      if(typable && !line){ trySend(); return; }
      info = "Лимит ещё не снят";
      if(now >= S.resetAt && now - S.lastReload > 5 * 60000){ S.lastReload = now; save(); location.reload(); }
    }catch(e){ info = "Ошибка: " + e.message; }
  }

  window.__ltAuto = {
    status: function(){
      var c = cfg();
      return { enabled: c.enabled, hit: S.hit, resetAt: S.hit ? S.resetAt : 0, src: S.src, info: info,
               lastSent: S.lastSent, composer: canType(), url: location.href };
    },
    sendNow: function(){ var c = cfg(); if(composerText()){ info = "В поле ввода есть текст"; return false; } return typeAndSend(c.text); },
    arm: function(minutes){ S.hit = true; S.src = "manual"; S.resetAt = Date.now() + (minutes || 300) * 60000; save(); info = "Таймер запущен"; },
    disarm: function(){ S.hit = false; save(); info = ""; }
  };
  setInterval(tick, POLL_MS);
  setTimeout(tick, 4000);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) tick(); });
})();
