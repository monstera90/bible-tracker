/* agent_state.js
   Версия: 1.1 (28.11) — плашка «Бесплатные сообщения недоступны до 22:00» (поле ввода при этом остаётся доступным) теперь определяется как «токены кончились» раньше проверки «инструменты кончились»; из строки плашки берётся время снятия лимита: status() отдаёт resetAt (мс, 0 — не распознано). Раньше такой чат считался «ждёт Далее», и приложение отправляло «Дальше» зря. Откат: agent_state.js 1.0.
   Версия: 1.0 (28.11)
   Скрипт вкладки Claude (ClaudeTab.kt вставляет его в страницу claude.ai после загрузки). Читает состояние чата для плашки агента в острове:
   kind "tokens" — токены кончились (лимит использования или предел длины диалога), ввод закрыт;
   kind "tools"  — у Claude кончились инструменты (или длина ответа), ответ остановлен и чат ждёт «Далее»;
   kind ""       — ничего из этого. gen — Claude сейчас пишет ответ.
   Наружу: window.__ltAgent.status() → {seq, kind, gen, chat, resetAt}; window.__ltAgent.next() → true, если «Далее» отправлено
   (нажимает кнопку «Продолжить» в чате, а если её нет — отправляет текст автоотправки через window.__ltAuto.sendNow). Сам ничего не нажимает. */
(function(){
  "use strict";
  if(window.__ltAgent) return;
  var POLL_MS = 2000;
  var STABLE_TICKS = 3;     // состояние должно продержаться ~6 с, прежде чем о нём сообщается (между вызовами инструментов кнопка «Стоп» пропадает на миг)
  var QUIET_MS = 15000;     // после «Далее» страница ещё показывает прежнее — это время молчим
  var MAX_LINE = 220;       // сообщения claude.ai об лимитах — короткие строки; длинные абзацы ответа не разбираем

  var TOKENS_RE = new RegExp(
    "(reached|hit|exceeded).{0,40}limit|limit.{0,80}reset|(message|usage) limit|" +
    "(достигли|исчерпали|превысили|достигнут).{0,40}лимит|лимит.{0,80}(сброс|обнов|восстан)|лимит сообщений|" +
    "(conversation|chat).{0,60}(maximum length|too long|length limit)|(максимальн|предельн).{0,30}длин", "i");
  var TOOLS_RE = new RegExp(
    "tool[- ]use (limit|maximum)|(limit|maximum|max)[^.\\n]{0,30}tool[- ]use|reached[^.\\n]{0,40}(tool|length)|" +
    "max(imum)? length for a message|paused (its|the) response|" +
    "(лимит|предел)[^.\\n]{0,40}инструмент|инструмент[^.\\n]{0,40}(лимит|исчерп|законч)|приостанов[^.\\n]{0,30}ответ", "i");
  var CONT_RE = /^(continue|продолжить|далее|дальше)$/i;
  // плашка бесплатного тарифа: поле ввода остаётся доступным, но сообщения не уходят до указанного времени
  var FREE_RE = new RegExp(
    "(бесплатн\\S*\\s+сообщени\\S*|free\\s+messages?)[^.\\n]{0,40}(недоступн|unavailable|not available)", "i");

  var kind = "", cand = "", candN = 0, seq = 0, quietUntil = 0, gen = false, lastLine = "", resetAt = 0;

  function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length))); }
  function txt(el){ return String(el.textContent || "").replace(/\s+/g, " ").trim(); }
  function inChat(){ return location.pathname.indexOf("/chat/") === 0; }
  function generating(){ return !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="Останов" i]'); }

  function composer(){
    return document.querySelector('div[contenteditable="true"].ProseMirror') ||
           document.querySelector('[contenteditable="true"][role="textbox"]') ||
           document.querySelector('fieldset [contenteditable="true"]');
  }
  function canType(){
    var c = composer();
    return !!c && c.getAttribute("contenteditable") !== "false";
  }
  // последние короткие строки страницы: плашки claude.ai («лимит достигнут», «ответ приостановлен») — отдельные короткие строки внизу чата
  function noticeLine(re){
    var t = "";
    try{ t = String(document.body.innerText || ""); }catch(e){}
    var lines = t.slice(-2500).split(/\n+/);
    for(var i = lines.length - 1, n = 0; i >= 0 && n < 14; i--, n++){
      var l = lines[i];
      if(l.length <= MAX_LINE && re.test(l)) return l;
    }
    return "";
  }
  function continueBtn(){
    var list = document.querySelectorAll('button,[role="button"]');
    for(var i = list.length - 1; i >= 0; i--){
      var b = list[i];
      if(!visible(b) || (b.closest && b.closest("code,pre"))) continue;
      var t = txt(b);
      if(t.length <= 20 && CONT_RE.test(t)) return b;
    }
    return null;
  }
  function fire(el){
    try{
      ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(function(type){
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    }catch(e){}
    try{ el.click(); }catch(e2){}
  }

  // время снятия лимита из строки плашки: «до 22:00», «until 5:00 PM», «через 3 часа»; не распознано — 0 (приложение возьмёт запасной срок)
  function parseResetAt(line){
    var now = Date.now(), t = 0, m, HOUR = 3600000;
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
    return (t > now && t < now + 48 * HOUR) ? t : 0;
  }

  function readKind(){
    lastLine = "";
    if(!inChat() || generating()) return "";
    var fl = noticeLine(FREE_RE); // раньше всего: поле ввода при этом доступно, и без этой проверки чат сошёл бы за «ждёт Далее»
    if(fl){ lastLine = fl; return "tokens"; }
    if(!canType()){
      var tl = noticeLine(TOKENS_RE);
      if(tl){ lastLine = tl; return "tokens"; }
      return "";
    }
    return (continueBtn() || noticeLine(TOOLS_RE)) ? "tools" : "";
  }

  function tick(){
    try{
      gen = inChat() && generating();
      var k = Date.now() < quietUntil ? "" : readKind();
      if(k === cand) candN++; else { cand = k; candN = 1; }
      if(candN >= (k ? STABLE_TICKS : 1) && k !== kind){ kind = k; seq++; resetAt = k === "tokens" ? parseResetAt(lastLine) : 0; }
    }catch(e){}
  }

  function silence(){ quietUntil = Date.now() + QUIET_MS; kind = ""; cand = ""; candN = 0; resetAt = 0; seq++; }

  window.__ltAgent = {
    status: function(){ return { seq: seq, kind: kind, gen: gen, chat: inChat(), resetAt: resetAt }; },
    next: function(){
      var ok = false;
      try{
        var b = continueBtn();
        if(b){ fire(b); ok = true; }
        else if(window.__ltAuto && typeof window.__ltAuto.sendNow === "function"){ ok = !!window.__ltAuto.sendNow(); }
      }catch(e){ ok = false; }
      if(ok) silence();
      return ok;
    }
  };
  setInterval(tick, POLL_MS);
  setTimeout(tick, 3000);
})();
