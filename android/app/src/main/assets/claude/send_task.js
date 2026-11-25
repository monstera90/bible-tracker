/* send_task.js
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

  // файл №idx: 0 — архив репозитория, 1… — картинки задачи
  window.__ltTaskInit = function(size, idx){ idx = idx | 0; bufs[idx] = new Uint8Array(size); offs[idx] = 0; };
  window.__ltTaskPut = function(b64, idx){
    idx = idx | 0;
    var buf = bufs[idx], off = offs[idx], bin = atob(b64);
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
  async function attach(files, base){
    var dt = new DataTransfer();
    files.forEach(function(f){ dt.items.add(f); });
    // 1) скрытое поле выбора файла
    var inp = fileInput();
    if(inp){
      try{
        inp.files = dt.files;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }catch(e){}
      if(await waitFor(function(){ return hasAttachment(base); }, 8000, 400)) return true;
    }
    // 2) перетаскивание на поле ввода
    var target = composerRoot();
    try{
      ["dragenter", "dragover", "drop"].forEach(function(t){
        target.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    }catch(e){}
    if(await waitFor(function(){ return hasAttachment(base); }, 8000, 400)) return true;
    // 3) вставка файла как из буфера обмена
    var c = composer();
    if(c){
      try{
        c.focus();
        c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }catch(e){}
      if(await waitFor(function(){ return hasAttachment(base); }, 8000, 400)) return true;
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

  // ---------- текст ----------
  function putText(text){
    var c = composer(); if(!c) return false;
    c.focus();
    try{
      var dt = new DataTransfer();
      dt.setData("text/plain", text);
      c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }catch(e){}
    if(composerText()) return true;
    try{ document.execCommand("selectAll", false, null); document.execCommand("insertText", false, text); }catch(e){}
    if(composerText()) return true;
    c.textContent = text;
    c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return !!composerText();
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
      st.msg = "Вставляю текст задачи";
      if(!putText(String(cfg.text || ""))) throw new Error("не удалось вставить текст");
      st.msg = "Отправляю";
      var btn = await waitFor(sendReady, 40000, 400);
      if(btn){
        btn.click();
      }else{
        var cc = composer();
        if(!cc) throw new Error("кнопка «Отправить» не стала активной");
        ["keydown", "keypress", "keyup"].forEach(function(type){
          cc.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        });
      }
      var sent = await waitFor(function(){
        return (location.pathname || "").indexOf("/chat/") === 0 || (!composerText() && !hasAttachment(base));
      }, 30000, 500);
      if(!sent) throw new Error("сообщение не отправилось");
      st.state = "sent"; st.msg = warn;
    }catch(e){
      st.state = "error"; st.msg = String(e && e.message || e) + " [" + diag() + "]";
    }
  }
  window.__ltTaskStart = function(cfg){ run(cfg); };
})();
