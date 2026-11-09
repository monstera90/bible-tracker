/* ===========================================================================
   pomodoro.js
   Версия: 2.0 (08.11)
   Вкладка «Помодоро» (set2s_16, кнопка settingsTabSet2Btn16; боковой ряд «Активности» между «Музыкой» и «QR-кодами»).
   Здесь вся полная информация о сессии: кольцо прогресса, остаток времени, название задачи, «цикл N из M», кнопки
   «Пауза», «+5 минут», «Пропустить перерыв» («Начать работу» после перерыва) и «Завершить». Сам таймер, будильник конца
   фазы, вибрация, плашка в приложении и остров Xiaomi — в оболочке Android (PomodoroTimer.kt, PomodoroService.kt,
   мост LifeTrackerNative версии 25: pomodoroStart / pomodoroPause / pomodoroPlus5 / pomodoroSkip / pomodoroStop /
   pomodoroState / pomodoroUi). Страница только показывает состояние и шлёт команды; время считает по часам телефона
   (endAt/waitSince из состояния), состояние перечитывает раз в секунду. В браузере без моста вкладка показывает пояснение.
   Законченные рабочие отрезки (мост ≥26: pomodoroTakeFinished / pomodoroAckFinished): оболочка копит их в очереди (работа кончилась
   сама или нажато «Завершить»; короче минуты не записывается), страница забирает их в `drain`, кладёт в личный state через
   хранилище от my.js (`setStore`, ключ `pomo:<id>` = {task, start, end}; едет в облако) и пишет в «Историю» («Пользователь начал
   работу над «…» и закончил её в 8:00»; запись журнала — только на том устройстве, где отрезок забран). Календарь («Трекеры
   занятий») читает их через `records()`.
   Точка входа — window.PomodoroTab.{render,sync,setStore,drain,records}; my.js зовёт render из switchSettingsTab, sync и drain — из __ltOnAppResume.
   Стили вставляет сам модуль; без flex-gap, grid и inset (старый WebView Android 5.0).
   Раскладка: заголовок вверху, карточка с кольцом/формой и кнопками прижата к низу области (`margin-top:auto`, как
   `.settings-content-bottom` у остальных вкладок) — до кнопок дотягиваться большим пальцем.
   =========================================================================== */
(function(){
  "use strict";

  var ROOT_ID = "pomodoroTabRoot";
  var CFG_KEY = "pomodoroCfg_v1";
  var CIRC = 553; // длина окружности кольца: 2π · 88
  var POLL_MS = 1000;
  var TICK_MS = 250;
  var PULSE_MS = 60000;

  // [мин, макс, шаг]
  var LIMITS = { work: [5, 90, 5], short: [1, 30, 1], long: [5, 60, 5], cycles: [2, 8, 1] };

  var st = null;        // последнее состояние от оболочки (null — сессии нет)
  var shape = "";       // что сейчас нарисовано (перерисовываем целиком только при смене)
  var pollTimer = null;
  var tickTimer = null;
  var lastForcePoll = 0;
  var stopArmedAt = 0;

  function bridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.pomodoroStart === "function" && typeof b.pomodoroState === "function") ? b : null;
  }
  // очередь законченных рабочих отрезков есть у оболочки с мостом ≥26
  function nativeDone(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.pomodoroTakeFinished === "function" && typeof b.pomodoroAckFinished === "function") ? b : null;
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function pad2(n){ return n < 10 ? "0" + n : String(n); }
  // как XiaomiIsland.clockText: М:СС или Ч:ММ:СС, округление вверх
  function clock(ms){
    var s = Math.ceil(ms / 1000);
    if(s < 0) s = 0;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? h + ":" + pad2(m) + ":" + pad2(sec) : m + ":" + pad2(sec);
  }
  function elapsed(ms){ return clock(Math.floor(ms / 1000) * 1000); }

  // ---------- настройки (только на устройстве) ----------
  function loadCfg(){
    var c = { task: "", work: 25, short: 5, long: 15, cycles: 4 };
    try{
      var o = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
      if(typeof o.task === "string") c.task = o.task.slice(0, 60);
      ["work", "short", "long", "cycles"].forEach(function(k){
        var v = Number(o[k]);
        if(isFinite(v) && v >= LIMITS[k][0] && v <= LIMITS[k][1]) c[k] = Math.round(v);
      });
    }catch(e){}
    return c;
  }
  function saveCfg(c){
    try{ localStorage.setItem(CFG_KEY, JSON.stringify(c)); }catch(e){}
  }

  // ---------- состояние ----------
  function parse(json){
    try{
      var o = JSON.parse(json || "{}");
      return (o && o.active) ? o : null;
    }catch(e){ return null; }
  }
  function derive(s, now){
    var wait = s.phase === "wait";
    var paused = !s.running && !wait;
    var left = wait ? 0 : (s.running ? Math.max(s.endAt - now, 0) : (s.leftMs || 0));
    var over = wait ? Math.max(now - s.waitSince, 0) : 0;
    var flash = !!s.flashUntil && now < s.flashUntil && s.phase !== "work";
    var undo = s.phase !== "work" && !wait && s.running && (now - s.phaseStart) < 60000;
    return { wait: wait, paused: paused, left: left, over: over, flash: flash, undo: undo };
  }

  // ---------- стили ----------
  function ensureStyle(){
    if(document.getElementById("pomodoroTabStyle")) return;
    var st0 = document.createElement("style");
    st0.id = "pomodoroTabStyle";
    st0.textContent =
      ".pomo-root{--pomo:#e24a33;--pomo-soft:rgba(226,74,51,.10);display:flex;flex-direction:column;flex:1 0 auto;}" +
      ".pomo-phase-short{--pomo:#5fbf98;--pomo-soft:rgba(95,191,152,.14);}" +
      ".pomo-phase-long{--pomo:#7c9fd8;--pomo-soft:rgba(124,159,216,.16);}" +
      ".pomo-phase-wait{--pomo:#d6a24a;--pomo-soft:rgba(214,162,74,.14);}" +
      ".pomo-paused{--pomo:#8f8f8f;--pomo-soft:rgba(143,143,143,.10);}" +
      ".pomo-card{margin-top:auto;padding:14px 12px 16px;border-radius:18px;background:var(--pomo-soft);text-align:center;transition:background .6s;}" +
      ".pomo-label{font-size:15px;font-weight:700;color:var(--pomo);margin:0 0 8px;letter-spacing:.02em;transition:color .6s;}" +
      ".pomo-ringwrap{position:relative;width:72%;max-width:250px;margin:0 auto;}" +
      ".pomo-ring{display:block;width:100%;height:auto;}" +
      ".pomo-track{fill:none;stroke:rgba(128,128,128,.22);stroke-width:12;}" +
      ".pomo-prog{fill:none;stroke:var(--pomo);stroke-width:12;stroke-linecap:round;transition:stroke .6s;}" +
      ".pomo-center{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}" +
      ".pomo-time{font-size:44px;font-weight:700;line-height:1.1;color:var(--ink,#3b3350);font-variant-numeric:tabular-nums;}" +
      ".pomo-cap{font-size:12px;color:var(--ink-soft,#6a6080);margin-top:4px;padding:0 14px;line-height:1.25;}" +
      ".pomo-task{font-size:16px;font-weight:600;color:var(--ink,#3b3350);margin:12px 0 2px;word-wrap:break-word;}" +
      ".pomo-cycle{font-size:13px;color:var(--ink-soft,#6a6080);margin:2px 0 0;}" +
      ".pomo-dots{margin:8px 0 0;line-height:1;}" +
      ".pomo-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px;background:rgba(128,128,128,.28);}" +
      ".pomo-dot.done{background:var(--pomo);}" +
      ".pomo-dot.cur{background:transparent;border:2px solid var(--pomo);box-sizing:border-box;}" +
      ".pomo-hint{font-size:14px;color:var(--ink,#3b3350);margin:12px 8px 0;line-height:1.35;}" +
      ".pomo-btns{margin:14px 0 0;}" +
      ".pomo-btn{font:inherit;font-size:14px;font-weight:600;padding:10px 14px;margin:4px;border-radius:12px;cursor:pointer;" +
        "border:1px solid var(--pomo);background:transparent;color:var(--pomo);transition:color .6s,border-color .6s;}" +
      ".pomo-btn.main{background:var(--pomo);color:#fff;}" +
      ".pomo-stop{font:inherit;font-size:13px;background:none;border:none;color:var(--ink-soft,#6a6080);margin:10px 0 0;padding:6px 10px;cursor:pointer;text-decoration:underline;}" +
      ".pomo-stop.armed{color:#b0432e;font-weight:600;}" +
      ".pomo-idle-row{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;text-align:left;}" +
      ".pomo-idle-name{font-size:14px;color:var(--ink,#3b3350);}" +
      ".pomo-step{white-space:nowrap;}" +
      ".pomo-step button{font:inherit;font-size:18px;font-weight:700;width:34px;height:34px;border-radius:50%;cursor:pointer;" +
        "border:1px solid var(--wood,#8f7fb8);background:var(--parchment,#f4f0f8);color:var(--wood-dark,#6a5a91);padding:0;}" +
      ".pomo-step span{display:inline-block;min-width:64px;text-align:center;font-size:15px;font-weight:600;color:var(--ink,#3b3350);}" +
      ".pomo-input{box-sizing:border-box;width:100%;font:inherit;font-size:15px;padding:10px 12px;margin:0 0 14px;border-radius:12px;" +
        "border:1px solid var(--wood,#8f7fb8);background:var(--parchment,#f4f0f8);color:var(--ink,#3b3350);}" +
      ".pomo-note{font-size:12px;color:var(--ink-soft,#6a6080);margin:12px 4px 0;line-height:1.35;}" +
      "@keyframes pomoPulse{0%,100%{opacity:1}50%{opacity:.5}}" +
      "@keyframes pomoGlow{0%,100%{opacity:1;stroke-width:12}50%{opacity:.55;stroke-width:15}}" +
      ".pomo-pulse .pomo-prog{animation:pomoPulse 2s ease-in-out infinite;}" +
      ".pomo-flash .pomo-prog{animation:pomoGlow .9s ease-in-out infinite;}" +
      ".pomo-flash .pomo-time{color:var(--pomo);}";
    document.head.appendChild(st0);
  }

  // ---------- рисование ----------
  function phaseLabel(s, d){
    if(d.flash) return "Готово";
    if(d.paused) return "Пауза · " + (s.phase === "work" ? "работа" : "перерыв");
    if(s.phase === "work") return "Работа";
    if(s.phase === "short") return "Короткий перерыв";
    if(s.phase === "long") return "Длинный перерыв";
    return "Перерыв закончился";
  }
  function caption(s, d){
    if(d.flash) return "хорошая работа — пора отдохнуть";
    if(d.paused) return "время стоит";
    if(s.phase === "work") return "до конца работы";
    if(s.phase === "short") return "до конца перерыва";
    if(s.phase === "long") return "до следующего цикла";
    return "прошло после перерыва";
  }
  function hint(s, d){
    if(d.flash || s.phase === "short") return "Встань, выпей воды, посмотри вдаль.";
    if(s.phase === "long") return "Длинный перерыв: пройдись, потянись, отдохни как следует. Скоро новый цикл.";
    if(d.wait) return "Перерыв закончился. Когда будешь готов — начинай работу.";
    return "";
  }
  function dotsHtml(s){
    var done = (s.phase === "short" || s.phase === "long") ? s.cycle : s.cycle - 1;
    var out = "";
    for(var i = 1; i <= s.cycles; i++){
      var cls = i <= done ? "done" : (i === s.cycle && s.phase === "work" ? "cur" : "");
      out += '<span class="pomo-dot ' + cls + '"></span>';
    }
    return out;
  }
  function activeShape(s, d){
    return ["a", s.phase, s.running ? 1 : 0, d.flash ? 1 : 0, d.undo ? 1 : 0, s.cycle, s.cycles, s.task, stopArmedAt ? 1 : 0].join("|");
  }
  function activeHtml(s, d){
    var main, sub;
    if(d.wait){
      main = '<button type="button" class="pomo-btn main" data-act="skip">Начать работу</button>';
      sub = "";
    }else{
      main = '<button type="button" class="pomo-btn main" data-act="pause">' + (d.paused ? "Продолжить" : "Пауза") + '</button>' +
        '<button type="button" class="pomo-btn" data-act="plus">' + (d.undo ? "Ещё 5 минут работы" : "+5 минут") + '</button>';
      sub = s.phase === "work" ? "" : '<button type="button" class="pomo-btn" data-act="skip">Пропустить перерыв</button>';
    }
    var h = hint(s, d);
    return '<h3 class="common-tab-title">Помодоро</h3>' +
      '<div class="pomo-card">' +
        '<div class="pomo-label" id="pomoLabel">' + esc(phaseLabel(s, d)) + '</div>' +
        '<div class="pomo-ringwrap">' +
          '<svg class="pomo-ring" viewBox="0 0 200 200" aria-hidden="true">' +
            '<circle class="pomo-track" cx="100" cy="100" r="88"></circle>' +
            '<circle class="pomo-prog" id="pomoProg" cx="100" cy="100" r="88" transform="rotate(-90 100 100)" stroke-dasharray="' + CIRC + '" stroke-dashoffset="0"></circle>' +
          '</svg>' +
          '<div class="pomo-center"><div class="pomo-time" id="pomoTime"></div><div class="pomo-cap" id="pomoCap">' + esc(caption(s, d)) + '</div></div>' +
        '</div>' +
        (s.task ? '<div class="pomo-task">' + esc(s.task) + '</div>' : '') +
        '<div class="pomo-cycle">Цикл ' + s.cycle + ' из ' + s.cycles + '</div>' +
        '<div class="pomo-dots">' + dotsHtml(s) + '</div>' +
        (h ? '<div class="pomo-hint">' + esc(h) + '</div>' : '') +
        '<div class="pomo-btns">' + main + sub + '</div>' +
        '<button type="button" class="pomo-stop' + (stopArmedAt ? " armed" : "") + '" data-act="stop">' + (stopArmedAt ? "Нажми ещё раз, чтобы завершить" : "Завершить сессию") + '</button>' +
      '</div>';
  }
  function stepRow(k, title, unit){
    var c = loadCfg();
    return '<div class="pomo-idle-row"><div class="pomo-idle-name">' + title + '</div>' +
      '<div class="pomo-step"><button type="button" data-step="' + k + '" data-d="-1">−</button>' +
      '<span id="pomoV_' + k + '">' + c[k] + unit + '</span>' +
      '<button type="button" data-step="' + k + '" data-d="1">+</button></div></div>';
  }
  function idleHtml(){
    var c = loadCfg();
    return '<h3 class="common-tab-title">Помодоро</h3>' +
      '<div class="pomo-card">' +
        '<input type="text" class="pomo-input" id="pomoTask" maxlength="60" placeholder="Над чем работаешь?" value="' + esc(c.task) + '">' +
        stepRow("work", "Работа", " мин") +
        stepRow("short", "Короткий перерыв", " мин") +
        stepRow("long", "Длинный перерыв", " мин") +
        stepRow("cycles", "Циклов до длинного", "") +
        '<div class="pomo-btns"><button type="button" class="pomo-btn main" data-act="start">Начать</button></div>' +
        '<div class="pomo-note">Работа → короткий перерыв, после каждого цикла N — длинный. Остров и плашка вверху показывают ход сессии, пока вы на других вкладках.</div>' +
      '</div>';
  }

  // перерисовка целиком — только когда изменилась «форма» экрана; секундные изменения идут через updateDynamic
  function paint(){
    var root = document.getElementById(ROOT_ID);
    if(!root) return;
    var now = Date.now();
    var key, d = null;
    if(st){ d = derive(st, now); key = activeShape(st, d); } else { key = "idle"; }
    if(key !== shape){
      shape = key;
      root.innerHTML = st ? activeHtml(st, d) : idleHtml();
    }
    updateDynamic(root, now, d);
  }

  function updateDynamic(root, now, d){
    if(!st){ root.className = "pomo-root pomo-idle"; return; }
    if(!d) d = derive(st, now);
    var cls = "pomo-root pomo-phase-" + st.phase;
    if(d.paused) cls += " pomo-paused";
    if(d.flash) cls += " pomo-flash";
    else if(!d.paused && !d.wait && d.left > 0 && d.left <= PULSE_MS) cls += " pomo-pulse";
    if(root.className !== cls) root.className = cls;
    var t = document.getElementById("pomoTime");
    if(t){
      var txt = d.flash ? "Готово" : (d.wait ? "+" + elapsed(d.over) : clock(d.left));
      if(t.textContent !== txt) t.textContent = txt;
    }
    var p = document.getElementById("pomoProg");
    if(p){
      var frac = d.wait ? 1 : (st.totalMs > 0 ? Math.max(0, Math.min(1, d.left / st.totalMs)) : 0);
      p.setAttribute("stroke-dashoffset", String(CIRC * (1 - frac)));
    }
    // срок вышел, а оболочка ещё не переключила фазу — спрашиваем сразу, а не через секунду
    if(!d.wait && st.running && d.left <= 0 && now - lastForcePoll > 700){ lastForcePoll = now; poll(); }
  }

  // ---------- опрос оболочки ----------
  function isVisible(root){
    if(!root || document.hidden) return false;
    try{ return root.offsetParent !== null && root.getBoundingClientRect().width > 0; }catch(e){ return true; }
  }
  function stopTimers(){
    if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
    if(tickTimer){ clearInterval(tickTimer); tickTimer = null; }
  }
  function startTimers(){
    stopTimers();
    pollTimer = setInterval(poll, POLL_MS);
    tickTimer = setInterval(function(){
      var root = document.getElementById(ROOT_ID);
      if(!root){ return; }
      if(stopArmedAt && Date.now() - stopArmedAt > 3000){ stopArmedAt = 0; paint(); return; }
      updateDynamic(root, Date.now(), null);
    }, TICK_MS);
  }
  function poll(){
    var b = bridge();
    if(!b) return;
    var root = document.getElementById(ROOT_ID);
    // плашка в приложении скрыта, пока вкладка на экране (оболочка сбрасывает флаг при сворачивании — шлём каждую секунду)
    try{ b.pomodoroUi(isVisible(root)); }catch(e){}
    if(!root){ stopTimers(); return; }
    setState(parse(b.pomodoroState()));
    if(Date.now() - lastDrainAt > DRAIN_EVERY_MS) drain(); // рабочая фаза кончилась при открытой вкладке — отрезок сразу в календарь и «Историю»
  }
  function setState(s){
    st = s;
    if(!s) stopArmedAt = 0;
    paint();
  }

  // ---------- законченные рабочие отрезки: календарь и «История» ----------
  var STORE = null;        // хранилище от my.js: list() → [{id, task, start, end}], put(id, data)
  var lastDrainAt = 0;
  var DRAIN_EVERY_MS = 5000;

  function clockLabel(ts){ var d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }

  // строка «Истории»; ключ записи — id отрезка, поэтому повторный забор того же отрезка второй раз не пишется
  function logWork(id, c){
    var EL = window.EventLog;
    if(!EL || typeof EL.add !== "function") return;
    var what = c.task ? "над «" + c.task + "»" : "по таймеру помодоро";
    try{ EL.add("Пользователь начал работу " + what + " и закончил её в \u27E6" + clockLabel(c.end) + "\u27E7", { at: c.end, key: "pomodoro:" + id, bold: true }); }catch(e){}
  }

  function drain(){
    var n = nativeDone();
    if(!n || !STORE) return;
    lastDrainAt = Date.now();
    var arr;
    try{ arr = JSON.parse(String(n.pomodoroTakeFinished())); }catch(e){ return; }
    if(!Array.isArray(arr) || !arr.length) return;
    var have = {};
    STORE.list().forEach(function(r){ have[r.id] = true; });
    var ids = [];
    arr.forEach(function(r){
      if(!r || typeof r.id !== "string" || typeof r.start !== "number" || typeof r.end !== "number") return;
      if(!have[r.id]){
        var c = { task: String(r.task || "").slice(0, 60), start: r.start, end: r.end };
        try{ STORE.put(r.id, c); }catch(e){ return; }
        have[r.id] = true;
        logWork(r.id, c);
      }
      ids.push(r.id);
    });
    if(ids.length){ try{ n.pomodoroAckFinished(JSON.stringify(ids)); }catch(e){} }
  }

  // для календаря («трекеры занятий»): [{id, task, start, end}], новые сверху
  function records(){
    if(!STORE) return [];
    return STORE.list().filter(function(r){
      return r && typeof r.start === "number" && typeof r.end === "number" && r.end > r.start;
    }).map(function(r){
      return { id: r.id, task: String(r.task || ""), start: r.start, end: r.end };
    }).sort(function(a, b){ return b.start - a.start; });
  }

  // ---------- команды ----------
  function command(name){
    var b = bridge();
    if(!b || typeof b[name] !== "function") return;
    var ret = "";
    try{ ret = b[name](); }catch(e){}
    setState(parse(ret));
  }
  function onClick(ev){
    var t = ev.target;
    while(t && t.id !== ROOT_ID && !(t.getAttribute && (t.getAttribute("data-act") || t.getAttribute("data-step")))) t = t.parentNode;
    if(!t || t.id === ROOT_ID) return;
    var b = bridge();
    if(!b) return;
    var step = t.getAttribute("data-step");
    if(step){
      var c = loadCfg();
      var lim = LIMITS[step];
      var v = c[step] + Number(t.getAttribute("data-d")) * lim[2];
      c[step] = Math.max(lim[0], Math.min(lim[1], v));
      saveCfg(c);
      var el = document.getElementById("pomoV_" + step);
      if(el) el.textContent = c[step] + (step === "cycles" ? "" : " мин");
      return;
    }
    var act = t.getAttribute("data-act");
    if(act === "start"){
      var cfg = loadCfg();
      var inp = document.getElementById("pomoTask");
      if(inp){ cfg.task = String(inp.value || "").slice(0, 60); saveCfg(cfg); }
      var ret = "";
      try{ ret = b.pomodoroStart(cfg.task, cfg.work, cfg.short, cfg.long, cfg.cycles); }catch(e){}
      shape = "";
      setState(parse(ret));
    }else if(act === "pause"){
      command("pomodoroPause");
    }else if(act === "plus"){
      command("pomodoroPlus5");
    }else if(act === "skip"){
      command("pomodoroSkip");
    }else if(act === "stop"){
      if(stopArmedAt && Date.now() - stopArmedAt < 3000){
        stopArmedAt = 0;
        shape = "";
        command("pomodoroStop");
      }else{
        stopArmedAt = Date.now();
        paint();
      }
    }
  }
  function onInput(ev){
    var t = ev.target;
    if(!t || t.id !== "pomoTask") return;
    var c = loadCfg();
    c.task = String(t.value || "").slice(0, 60);
    saveCfg(c);
  }

  // ---------- вход ----------
  function render(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    ensureStyle();
    stopTimers();
    var b = bridge();
    if(!b){
      c.innerHTML =
        '<h3 class="common-tab-title">Помодоро</h3>' +
        '<div class="mood-diagram-empty">Вкладка «Помодоро» работает только в приложении (APK) с обновлённой оболочкой.</div>';
      return;
    }
    shape = "";
    stopArmedAt = 0;
    c.innerHTML = '<div id="' + ROOT_ID + '" class="pomo-root"></div>';
    var root = document.getElementById(ROOT_ID);
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    st = parse(b.pomodoroState());
    paint();
    try{ b.pomodoroUi(true); }catch(e){}
    startTimers();
    drain();
  }

  // вернулись в приложение: сразу перечитать состояние (оболочка при сворачивании сбросила «вкладка на экране»)
  function sync(){
    drain();
    if(document.getElementById(ROOT_ID)) poll();
  }

  window.PomodoroTab = {
    render: render,
    sync: sync,
    setStore: function(s){ STORE = s; },
    drain: drain,
    records: records
  };
})();
