/* send_task.js
   Версия: 1.3 (27.11) — защита от дублей сообщения: (а) одна отправка на попытку (`cfg.attempt`): повторные `__ltTaskStart`/`__ltTaskInit`/`__ltTaskPut`, пока отправка идёт, игнорируются; (б) метка «отправлено» в localStorage claude.ai: если страницу перезагрузили после нажатия «Отправить», та же попытка заново не уходит; (в) архив прикрепляется ОДНИМ способом — запасные (drop, paste) только если за 20 с вложения нет совсем; перед отправкой лишние копии вложения (по кнопке «Убрать» у каждой карточки) убираются; (г) текст: после вставки ждём, пока поле его примет, не печатаем второй раз, если длинный текст ушёл в карточку «вставленное», и проверяем, что текст не задвоен. Откат: send_task.js 1.2.
   Версия: 1.2 (25.11) — вместе с архивом в сообщение прикрепляются картинки задачи (cfg.images: [{name, type}], их байты приходят как файлы №1, №2 … — __ltTaskInit(size, idx) / __ltTaskPut(b64, idx); архив — файл №0). Все файлы кладутся в поле выбора файла одной пачкой; если картинку на странице не нашли, отправка идёт дальше, а в итоге (state "sent", msg) стоит предупреждение. Откат: send_task.js 1.1.
   Версия: 1.1 (24.11) — при сбое в сообщении добавляется «снимок» страницы (адрес, видимость, поле ввода, поля выбора файла, размер окна), чтобы было видно, на чём встало; имя файла ищется без учёта регистра; перед началом ждём, пока страница дозагрузится (readyState). Откат: send_task.js 1.0.
   Версия: 1.0 (24.11)
   Скрипт вкладки Claude (ClaudeTab.kt вставляет его в страницу claude.ai/new, когда сундучок у задачи отправляет её в Claude).
   Оболочка кладёт архив в страницу кусками base64 (window.__ltTaskInit / __ltTaskPut), затем зовёт window.__ltTaskStart(cfg):
   страница ждёт поле ввода нового чата, прикрепляет архив (поле <input type=file>; запасные пути — drop и paste), ждёт конца загрузки,
   вставляет текст задачи и нажимает «Отправить». Итог — window.__ltTask.status(): {reqId, state: "working" | "sent" | "error", msg}.
   Оболочка опрашивает статус сама. Поля claude.ai ищутся по нескольким признакам: вёрстка сайта меняется, поэтому каждый шаг проверяется. */
(function(){
  "use strict";
  if(window.__ltTaskPut) return;
  var bufs = {}, offs = {};
  var st = { reqId: "", state: "idle", msg: "" };
  var running = false, doneKey = "";
  var SENT_PREFIX = "__ltTaskSent_";
  var STAGE_SENT = "Отправлено, жду подтверждения"; // это слово ждёт и ClaudeTab.kt (STAGE_SENT): после него страницу заново не грузим

  // файл №idx: 0 — архив репозитория, 1… — картинки задачи
  window.__ltTaskInit = function(size, idx){
    if(running) return; // отправка в этой странице уже идёт: повторная передача файлов только сбила бы её
    idx = idx | 0; bufs[idx] = new Uint8Array(size); offs[idx] = 0;
  };
  window.__ltTaskPut = function(b64, idx){
    if(running) return;
    idx = idx | 0;
    var buf = bufs[idx]; if(!buf) return;
    var off = offs[idx], bin = atob(b64);
    for(var i = 0; i < bin.length; i++) buf[off++] = bin.charCodeAt(i);
    offs[idx] = off;
  };
  function fileReady(idx){ return !!bufs[idx] && offs[idx] === bufs[idx].length; }
  window.__ltTask = { status: function(){ return { reqId: st.reqId, state: st.state, msg: st.msg }; } };

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  async function waitFor(fn, ms, step){
    var end = Date.now() + ms, v;
    while(Date.now() < end){
      try{ v = fn(); }catch(e){ v = null; }
      if(v) return v;
      await sleep(step || 300);
    }
    return null;
  }
  function norm(s){ return String(s || "").replace(/\s+/g, " ").trim(); }

  // метка «эта попытка уже нажала «Отправить»»: живёт в localStorage claude.ai, переживает перезагрузку страницы
  function sentMark(key){ try{ return localStorage.getItem(SENT_PREFIX + key); }catch(e){ return null; } }
  function setSentMark(key){ try{ localStorage.setItem(SENT_PREFIX + key, String(Date.now())); }catch(e){} }
  function clearSentMark(key){ try{ localStorage.removeItem(SENT_PREFIX + key); }catch(e){} }
  function pruneMarks(){
    try{
      var now = Date.now(), del = [];
      for(var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(k && k.indexOf(SENT_PREFIX) === 0 && now - (+localStorage.getItem(k) || 0) > 86400000) del.push(k);
      }
      del.forEach(function(k){ localStorage.removeItem(k); });
    }catch(e){}
  }

  function composer(){
    return document.querySelector('div[contenteditable="true"].ProseMirror') ||
           document.querySelector('[contenteditable="true"][role="textbox"]') ||
           document.querySelector('fieldset [contenteditable="true"]');
  }
  function composerText(){
    var c = composer();
    return c ? String(c.innerText || c.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function composerRoot(){
    var c = composer(); if(!c) return document.body;
    return c.closest("fieldset") || c.closest("form") || (c.parentElement && c.parentElement.parentElement) || document.body;
  }
  function hasAttachment(base){
    try{ return String(document.body.innerText || "").toLowerCase().indexOf(String(base).toLowerCase()) >= 0; }catch(e){ return false; }
  }
  // картинка видна в поле ввода: имя в тексте страницы или в подписях (alt / aria-label / title) миниатюры
  function hasImageNamed(name){
    var low = String(name).toLowerCase();
    if(hasAttachment(name)) return true;
    try{
      var els = composerRoot().querySelectorAll("[alt],[aria-label],[title]");
      for(var i = 0; i < els.length; i++){
        var t = ((els[i].getAttribute("alt") || "") + " " + (els[i].getAttribute("aria-label") || "") + " " + (els[i].getAttribute("title") || "")).toLowerCase();
        if(t.indexOf(low) >= 0) return true;
      }
    }catch(e){}
    return false;
  }
  // снимок страницы для сообщения об ошибке
  function diag(){
    try{
      return "адрес " + (location.pathname || "/") + ", страница " + document.visibilityState + ", поле ввода " + (composer() ? "есть" : "нет") +
        ", полей файла " + document.querySelectorAll('input[type="file"]').length + ", окно " + window.innerWidth + "x" + window.innerHeight;
    }catch(e){ return "снимок недоступен"; }
  }
  function loginPage(){
    var p = location.pathname || "";
    return p.indexOf("/login") === 0 || p.indexOf("/logout") === 0 || p.indexOf("/signup") === 0;
  }

  // ---------- прикрепление архива ----------
  function fileInput(){
    var list = document.querySelectorAll('input[type="file"]');
    for(var i = 0; i < list.length; i++){
      var acc = (list[i].getAttribute("accept") || "").toLowerCase();
      if(acc && acc.indexOf("image") >= 0 && acc.indexOf("pdf") < 0 && acc.indexOf("*") < 0 && acc.indexOf(".zip") < 0) continue; // только картинки — не годится
      return list[i];
    }
    return list.length ? list[0] : null;
  }
  // Основной способ — поле выбора файла, и ждём его долго: каждый запасной способ прикрепил бы файл ещё раз.
  // Запасные (drop, paste) включаются только если вложения нет совсем.
  async function attach(files, base){
    var dt = new DataTransfer();
    files.forEach(function(f){ dt.items.add(f); });
    var seen = function(){ return hasAttachment(base); };
    // 1) скрытое поле выбора файла
    var inp = fileInput();
    if(inp){
      try{
        inp.files = dt.files;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }catch(e){}
      if(await waitFor(seen, 20000, 400)) return true;
    }
    // 2) перетаскивание на поле ввода
    if(seen()) return true;
    var target = composerRoot();
    try{
      ["dragenter", "dragover", "drop"].forEach(function(t){
        target.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    }catch(e){}
    if(await waitFor(seen, 12000, 400)) return true;
    // 3) вставка файла как из буфера обмена
    if(seen()) return true;
    var c = composer();
    if(c){
      try{
        c.focus();
        c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }catch(e){}
      if(await waitFor(seen, 12000, 400)) return true;
    }
    return false;
  }
  // загрузка закончена: полосы прогресса нет 1,5 с подряд (но не раньше чем через 2,5 с после появления файла)
  async function waitUploaded(ms){
    var start = Date.now(), calm = 0;
    while(Date.now() - start < ms){
      var busy = composerRoot().querySelector('[role="progressbar"], [aria-busy="true"], progress');
      if(busy) calm = 0; else calm += 400;
      if(calm >= 1500 && Date.now() - start >= 2500) return true;
      await sleep(400);
    }
    return false;
  }
  // Лишние копии вложения. У каждой карточки вложения своя кнопка «Убрать»; берём только те кнопки, чья карточка содержит имя файла
  // (если подписи кнопок не распознаются — ничего не трогаем). Первая копия остаётся, остальные убираются.
  var REMOVE_SEL = 'button[aria-label*="emove" i], button[aria-label*="Удал" i]';
  function cardOf(btn, name){
    var low = String(name).toLowerCase(), el = btn;
    for(var up = 0; up < 6 && el.parentElement; up++){
      el = el.parentElement;
      if(el.querySelectorAll(REMOVE_SEL).length > 1) return null; // уже охватили несколько карточек
      if(String(el.innerText || el.textContent || "").toLowerCase().indexOf(low) >= 0) return el;
    }
    return null;
  }
  async function dropExtraCopies(name){
    var removed = 0;
    try{
      var mine = [];
      Array.prototype.slice.call(composerRoot().querySelectorAll(REMOVE_SEL)).forEach(function(b){
        if(cardOf(b, name)) mine.push(b);
      });
      for(var i = 1; i < mine.length; i++){ mine[i].click(); removed++; await sleep(400); }
    }catch(e){}
    return removed;
  }

  // ---------- текст ----------
  function clearComposer(){
    var c = composer(); if(!c) return;
    c.focus();
    try{ document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }catch(e){}
  }
  // длинный текст сайт может убрать в карточку «вставленное»: поле ввода остаётся пустым, а начало текста видно в превью карточки
  function pastedAsCard(want){
    try{
      var probe = want.slice(0, 30).toLowerCase();
      return probe.length >= 8 && norm(document.body.innerText).toLowerCase().indexOf(probe) >= 0;
    }catch(e){ return false; }
  }
  // Текст кладётся ровно один раз. Редактор принимает вставку не мгновенно, поэтому после неё ждём; печатаем запасным способом
  // только если за это время текста нет ни в поле, ни в карточке «вставленное».
  async function putText(text){
    var c = composer(); if(!c) return false;
    var want = norm(text);
    if(composerText()){ clearComposer(); await sleep(200); }
    c.focus();
    try{
      var dt = new DataTransfer();
      dt.setData("text/plain", text);
      c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }catch(e){}
    var ok = await waitFor(function(){ return composerText() || pastedAsCard(want); }, 2500, 250);
    if(!ok){
      c = composer(); if(!c) return false;
      try{ c.focus(); document.execCommand("selectAll", false, null); document.execCommand("insertText", false, text); }catch(e){}
      ok = await waitFor(function(){ return composerText() || pastedAsCard(want); }, 1500, 250);
    }
    if(!ok){
      c = composer(); if(!c) return false;
      c.textContent = text;
      c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      ok = await waitFor(function(){ return composerText(); }, 1000, 250);
    }
    if(!ok) return false;
    await sleep(600);
    // текст задвоился (вставка дошла позже запасного способа): очищаем и кладём один раз
    var got = composerText();
    if(want.length >= 20 && got.length >= want.length * 1.8){
      clearComposer(); await sleep(300);
      c = composer(); if(!c) return false;
      try{ c.focus(); document.execCommand("insertText", false, text); }catch(e){}
      if(!await waitFor(function(){ return composerText(); }, 1500, 250)){
        c = composer(); if(!c) return false;
        c.textContent = text;
        c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
    return true;
  }
  function sendButton(){
    var c = composer(); if(!c) return null;
    var root = c.closest("fieldset") || c.closest("form") || c.parentElement;
    for(var up = 0; up < 6 && root && root.parentElement; up++){
      var b = root.querySelector('button[aria-label*="Send" i], button[aria-label*="Отправ" i], button[type="submit"]');
      if(b) return b;
      root = root.parentElement;
    }
    return null;
  }
  function sendReady(){
    var b = sendButton();
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }

  async function run(cfg){
    var key = String(cfg.attempt || cfg.reqId || "");
    var persist = !!cfg.attempt; // метка между перезагрузками — только у попытки с собственным номером (иначе повторная отправка той же задачи позже была бы заблокирована)
    pruneMarks();
    if(persist && sentMark(key)){
      st = { reqId: cfg.reqId, state: "sent", msg: "повторная отправка пропущена: эта задача уже ушла в чат" };
      return;
    }
    st = { reqId: cfg.reqId, state: "working", msg: "Жду страницу" };
    try{
      if(!fileReady(0)) throw new Error("архив не дошёл до страницы");
      var imgs = Array.isArray(cfg.images) ? cfg.images : [];
      for(var ii = 0; ii < imgs.length; ii++){
        if(!fileReady(ii + 1)) throw new Error("картинка «" + imgs[ii].name + "» не дошла до страницы");
      }
      await waitFor(function(){ return document.readyState === "complete"; }, 20000, 300);
      var c = await waitFor(function(){ return loginPage() ? "login" : composer(); }, 45000);
      if(c === "login" || loginPage()) throw new Error("во вкладке нет входа в Claude — войдите и повторите");
      if(!c) throw new Error("не нашёл поле ввода на странице claude.ai");
      var base = String(cfg.name || "archive.zip").replace(/\.zip$/i, "");
      st.msg = imgs.length ? "Прикрепляю архив и картинки" : "Прикрепляю архив";
      var files = [new File([bufs[0]], cfg.name || "archive.zip", { type: "application/zip", lastModified: Date.now() })];
      imgs.forEach(function(im, k){
        files.push(new File([bufs[k + 1]], im.name, { type: im.type || "image/png", lastModified: Date.now() }));
      });
      if(!await attach(files, base)) throw new Error("не удалось прикрепить архив");
      var warn = "";
      if(imgs.length){
        // картинки пришли той же пачкой, что и архив: ждём их миниатюры; не дождались — шлём дальше, но говорим об этом
        await waitFor(function(){ return imgs.every(function(im){ return hasImageNamed(im.name); }); }, 8000, 400);
        var lost = imgs.filter(function(im){ return !hasImageNamed(im.name); }).map(function(im){ return im.name; });
        if(lost.length) warn = "не удалось подтвердить прикрепление картинок: " + lost.join(", ");
      }
      st.msg = "Жду загрузки архива";
      if(!await waitUploaded(120000)) throw new Error("архив не загрузился за 2 минуты");
      // лишние копии вложений (сайт мог принять один файл дважды) — убираем до отправки
      var extra = await dropExtraCopies(base);
      for(var jj = 0; jj < imgs.length; jj++) extra += await dropExtraCopies(imgs[jj].name);
      if(extra) warn = (warn ? warn + "; " : "") + "убрано лишних копий вложений: " + extra;
      st.msg = "Вставляю текст задачи";
      if(!await putText(String(cfg.text || ""))) throw new Error("не удалось вставить текст");
      st.msg = "Отправляю";
      var btn = await waitFor(sendReady, 40000, 400);
      var cc = btn ? null : composer();
      if(!btn && !cc) throw new Error("кнопка «Отправить» не стала активной");
      // с этого мига сообщение может уйти: метка не даёт отправить то же самое после перезагрузки страницы
      if(persist) setSentMark(key);
      st.msg = STAGE_SENT;
      if(btn){
        btn.click();
      }else{
        ["keydown", "keypress", "keyup"].forEach(function(type){
          cc.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        });
      }
      var sent = await waitFor(function(){
        return (location.pathname || "").indexOf("/chat/") === 0 || (!composerText() && !hasAttachment(base));
      }, 30000, 500);
      if(!sent){
        if(persist) clearSentMark(key);
        throw new Error("сообщение не отправилось");
      }
      st.state = "sent"; st.msg = warn;
    }catch(e){
      st.state = "error"; st.msg = String(e && e.message || e) + " [" + diag() + "]";
    }
  }
  // Одна отправка на попытку: повторный вызов (страница загрузилась дважды, гонка потоков оболочки) ничего не делает.
  window.__ltTaskStart = function(cfg){
    var key = String((cfg && (cfg.attempt || cfg.reqId)) || "");
    if(!key || running || key === doneKey) return;
    running = true; doneKey = key;
    run(cfg).then(function(){ running = false; }, function(){ running = false; });
  };
})();
