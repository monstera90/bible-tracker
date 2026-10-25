/* ===========================================================================
   calendar.js
   Версия: 2.0 (25.10)
   Вкладка «Календарь» (ключ `calendar`, кнопка `settingsTabCalendarBtn` — самый нижний язычок бокового стека набора 1,
   под «В работе»). Точка входа — window.CalendarTab.render(); my.js зовёт её из switchSettingsTab (renderSettingsTabCalendar).
   Сейчас есть только режим «Список» (в стиле центра событий — вкладки-колокольчика, eventlog.js: `.event-center`,
   `.event-day`, `.event-row`, `.event-time`); режим «Неделя» будет добавлен отдельно.
   Экран: список мероприятий (дни без мероприятий не показываются) и нижний ряд кнопок `.mdeditor-fab-row`: «+» (новое
   мероприятие) слева от «домика»; «домик» здесь — пустышка в углу, как на списках «Мои книги» и «Карточки предметов».
   Тап по мероприятию открывает ту же форму для правки (с кнопкой «Удалить»).
   Мероприятие: {id, title, start, end, repeat, updatedAt[, until, skip]}; start/end — мс (локальное время), repeat — "" | day |
   week | month | year. Хранится в localStorage `calendarEvents_v1` (только на этом устройстве, в облако пока не уходит).
   Серия (repeat != ""): `until` — мс, повторения с началом >= until не существуют (серию «разрезали»: дальше идёт другая
   серия); `skip` — массив дат "ГГГГ-ММ-ДД" повторений, которых в серии нет (их отвязали или удалили). Как в Google Календаре:
   правка/удаление повторения спрашивает «Только это» / «Это и все последующие» (`askScope`). «Только это» — повторение
   отвязывается: в серии на этот день пропуск (`skip`), а правка сохраняется отдельным обычным мероприятием. «Это и последующие»
   (`applyFollowing`) — старой серии ставится `until = начало этого повторения`, с него стартует новая серия с правками; правка
   самого первого повторения меняет серию на месте. Прошедшие повторения не трогаются. Если в форме изменено только поле
   «Повторения», вопрос не задаётся — это всегда «последующие». Пропуски переносятся в новую серию, только если дата начала и
   вид повтора не менялись.
   Список: каждая серия — ОДНА строка, ближайшее ещё не закончившееся повторение (`upcoming`, смотрит до 400 дней вперёд); у
   неё значок «↻ ещё N». Двойной тап по строке серии (тайминг как у переворота карточки в itemcards.js, DOUBLE_MS = 300) или тап
   по значку раскрывает до EXPAND_COUNT ближайших повторений (`expanded`); повторный двойной тап / значок / тап мимо строк
   сворачивает; выход из формы и повторный вход на вкладку тоже сворачивают. Одиночный тап по строке серии ждёт DOUBLE_MS, у
   обычных мероприятий форма открывается сразу. Тап открывает форму ИМЕННО того повторения (`data-at`), а не первого.
   Повторы считаются от первого начала: k-е повторение = start + k периодов; для месяца/года день прижимается к концу
   месяца (31-е → 30-е/28-е), как у напоминаний карточек. Длительность повторения = end − start.
   Список показывает окно: LIST_BACK_DAYS дней назад … LIST_AHEAD_DAYS вперёд от сегодня; при открытии прокручен к
   сегодняшнему дню (или к ближайшему следующему).
   =========================================================================== */
(function(){
  "use strict";

  var KEY = "calendarEvents_v1";
  var LIST_BACK_DAYS = 7;
  var LIST_AHEAD_DAYS = 90;
  var HOUR_MS = 3600000;
  var DAY_MS = 86400000;
  var DOUBLE_MS = 300;      // как в itemcards.js (двойной тап по карточке)
  var EXPAND_COUNT = 12;    // сколько ближайших повторений показывает раскрытая серия
  var REPEATS = [
    { key: "day", label: "Каждый день" },
    { key: "week", label: "Каждую неделю" },
    { key: "month", label: "Каждый месяц" },
    { key: "year", label: "Каждый год" }
  ];
  var HOME_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 11.5L12 4l8 7.5"></path><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"></path><path d="M10 20v-5h4v5"></path>' +
    '</svg>';
  var PLUS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';

  var screen = "list"; // "list" | "form" — что сейчас нарисовано во вкладке
  var expanded = {};   // id серий, раскрытых в списке
  var tapTimer = null; // отложенный одиночный тап по строке серии

  // ---------- вспомогательное ----------
  function container(){ return document.getElementById("settingsTabContent"); }
  function pad2(n){ return (n < 10 ? "0" : "") + n; }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function dateValue(ts){ var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function timeValue(ts){ var d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function dateLabel(ts){ var d = new Date(ts); return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + "." + d.getFullYear(); }
  function parseLocal(dateStr, timeStr){
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || ""), tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr || "");
    if(!dm || !tm) return NaN;
    var d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
    return d.getTime();
  }
  function startOfDay(ts){ var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime(); }
  function newId(){ return "ev" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- хранение ----------
  function validEvent(e){
    return e && typeof e === "object" && typeof e.id === "string" && typeof e.title === "string" &&
      typeof e.start === "number" && isFinite(e.start) && typeof e.end === "number" && isFinite(e.end);
  }
  function load(){
    try{
      var a = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(a) ? a.filter(validEvent) : [];
    }catch(e){ return []; }
  }
  function save(list){
    try{ localStorage.setItem(KEY, JSON.stringify(list)); }catch(e){}
  }
  function findEvent(id){
    var list = load();
    for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
    return null;
  }

  // ---------- повторы ----------
  // k-е повторение: start + k периодов (от первого начала, а не от предыдущего — чтобы 31-е не «уползало» на 28-е навсегда)
  function addPeriod(ts, kind, k){
    var d = new Date(ts), h = d.getHours(), mi = d.getMinutes();
    if(kind === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, h, mi).getTime();
    if(kind === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * k, h, mi).getTime();
    var months = (kind === "year" ? 12 : 1) * k;
    var m = d.getMonth() + months;
    var ny = d.getFullYear() + Math.floor(m / 12), nm = ((m % 12) + 12) % 12;
    var dim = new Date(ny, nm + 1, 0).getDate();
    return new Date(ny, nm, Math.min(d.getDate(), dim), h, mi).getTime();
  }
  // все начала мероприятия в окне [from, to)
  function occurrenceStarts(ev, from, to){
    var out = [];
    if(!ev.repeat){
      if(ev.start >= from && ev.start < to) out.push(ev.start);
      return out;
    }
    var k0 = 0;
    if(from > ev.start){
      var span = from - ev.start;
      // нижняя граница k берётся по САМОМУ ДЛИННОМУ возможному периоду (месяц ≤ 31 дня, год ≤ 366): тогда она не перескочит нужные повторения
      var per = ev.repeat === "day" ? DAY_MS : (ev.repeat === "week" ? 7 * DAY_MS : (ev.repeat === "month" ? 31 * DAY_MS : 366 * DAY_MS));
      k0 = Math.max(0, Math.floor(span / per) - 1);
    }
    var skip = ev.skip && ev.skip.length ? ev.skip : null;
    for(var k = k0, guard = 0; guard < 4000; k++, guard++){
      var at = addPeriod(ev.start, ev.repeat, k);
      if(at >= to) break;
      if(ev.until && at >= ev.until) break;
      if(at >= from){
        if(skip && skip.indexOf(dateValue(at)) >= 0) continue; // повторение отвязано или удалено
        out.push(at);
      }
    }
    return out;
  }
  // ближайшие n повторений серии, которые ещё не закончились (идущее сейчас — тоже)
  function upcoming(ev, now, n){
    var dur = Math.max(0, ev.end - ev.start);
    var from = now - dur;
    return occurrenceStarts(ev, from, from + 400 * DAY_MS).slice(0, n);
  }
  function repeatLabel(key){
    for(var i = 0; i < REPEATS.length; i++) if(REPEATS[i].key === key) return REPEATS[i].label.toLowerCase();
    return "";
  }

  // ---------- экран «Список» ----------
  function timeRange(at, dur){
    var s = timeValue(at), end = at + dur;
    var txt = s + "–" + timeValue(end);
    if(dateValue(end) !== dateValue(at)) txt = s + "–" + dateLabel(end).slice(0, 5) + " " + timeValue(end);
    return txt;
  }
  function listHtml(){
    var now = Date.now();
    var from = startOfDay(now) - LIST_BACK_DAYS * DAY_MS;
    var to = startOfDay(now) + (LIST_AHEAD_DAYS + 1) * DAY_MS;
    var rows = [];
    load().forEach(function(ev){
      var dur = Math.max(0, ev.end - ev.start);
      if(!ev.repeat){
        if(ev.start >= from && ev.start < to) rows.push({ at: ev.start, dur: dur, ev: ev });
        return;
      }
      var list = upcoming(ev, now, EXPAND_COUNT);
      var open = !!expanded[ev.id];
      (open ? list : list.slice(0, 1)).forEach(function(at, i){
        rows.push({ at: at, dur: dur, ev: ev, series: true, first: i === 0, open: open, more: list.length - 1 });
      });
    });
    if(!rows.length) return '<div class="event-empty">Мероприятий пока нет. Нажмите «+», чтобы добавить.</div>';
    rows.sort(function(a, b){ return a.at - b.at; });
    var html = "", lastDay = "";
    rows.forEach(function(r){
      var day = dateValue(r.at);
      if(day !== lastDay){
        html += '<div class="event-day" data-day="' + day + '">' + dateLabel(r.at) + '</div>';
        lastDay = day;
      }
      var badge = "";
      if(r.series && r.more > 0){
        badge = ' <span class="cal-more">' + (r.open ? '↻ свернуть' : '↻ ещё ' + r.more) + '</span>';
      }
      html += '<div class="event-row cal-row' + (r.at + r.dur < now ? ' cal-row-past' : '') + (r.series && !r.first ? ' cal-row-exp' : '') +
        '" data-id="' + esc(r.ev.id) + '" data-at="' + r.at + '">' +
        '<span class="event-time">' + timeRange(r.at, r.dur) + '</span> ' + esc(r.ev.title) +
        (r.ev.repeat ? '<span class="cal-rep"> · ' + repeatLabel(r.ev.repeat) + '</span>' : '') + badge + '</div>';
    });
    return html;
  }
  function scrollToToday(c){
    function go(){
      var today = dateValue(Date.now());
      var days = c.querySelectorAll(".event-day[data-day]");
      var target = null;
      for(var i = 0; i < days.length; i++){
        if(days[i].getAttribute("data-day") >= today){ target = days[i]; break; }
      }
      if(!target){ c.scrollTop = c.scrollHeight; return; }
      c.scrollTop += target.getBoundingClientRect().top - c.getBoundingClientRect().top - 4;
    }
    go();
    if(window.requestAnimationFrame) window.requestAnimationFrame(go);
    setTimeout(go, 60);
    setTimeout(go, 250);
  }
  // перерисовать только список (раскрытие/сворачивание серий), не трогая прокрутку
  function refreshList(){
    var c = container(), list = document.getElementById("calendarList");
    if(!c || !list) return;
    var top = c.scrollTop;
    list.innerHTML = listHtml();
    c.scrollTop = top;
  }
  function toggleExpand(id){
    if(expanded[id]) delete expanded[id]; else expanded[id] = true;
    refreshList();
  }
  function anyExpanded(){
    for(var k in expanded){ if(expanded.hasOwnProperty(k)) return true; }
    return false;
  }
  function renderList(){
    var c = container();
    if(!c) return;
    screen = "list";
    expanded = {};
    clearTimeout(tapTimer); tapTimer = null;
    c.innerHTML =
      '<div class="event-center cal-center" id="calendarList">' + listHtml() + '</div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn" id="calendarAddBtn" title="Новое мероприятие">' + PLUS_ICON_SVG + '</button>' +
        '<button type="button" class="mdeditor-fab-btn" id="calendarHomeStub" tabindex="-1" aria-disabled="true">' + HOME_ICON_SVG + '</button>' +
      '</div>';
    document.getElementById("calendarAddBtn").addEventListener("click", function(){ openForm(null); });
    var lastKey = null, lastAt = 0;
    document.getElementById("calendarList").addEventListener("click", function(e){
      var row = e.target.closest ? e.target.closest(".cal-row") : null;
      if(!row){
        if(anyExpanded()){ expanded = {}; refreshList(); } // тап мимо строк сворачивает раскрытые серии
        return;
      }
      var id = row.getAttribute("data-id"), at = +row.getAttribute("data-at");
      var ev = findEvent(id);
      if(!ev) return;
      if(!ev.repeat){ openForm(ev, at); return; }
      if(e.target.closest(".cal-more")){ lastKey = null; clearTimeout(tapTimer); toggleExpand(id); return; }
      var key = id + ":" + at, now = Date.now();
      if(lastKey === key && now - lastAt < DOUBLE_MS){ // двойной тап: раскрыть/свернуть серию
        clearTimeout(tapTimer); lastKey = null;
        toggleExpand(id);
        return;
      }
      lastKey = key; lastAt = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function(){ lastKey = null; openForm(ev, at); }, DOUBLE_MS);
    });
    scrollToToday(c);
  }

  // ---------- сохранение и удаление повторений ----------
  function replaceInList(list, rec){
    for(var i = 0; i < list.length; i++) if(list[i].id === rec.id){ list[i] = rec; return true; }
    return false;
  }
  // «Только это»: повторение отвязывается — в серии на этот день пропуск, правка живёт отдельным обычным мероприятием
  function skipOccurrence(list, ev, at){
    var key = dateValue(at);
    for(var i = 0; i < list.length; i++){
      if(list[i].id !== ev.id) continue;
      var sk = (list[i].skip || []).slice();
      if(sk.indexOf(key) < 0) sk.push(key);
      list[i].skip = sk;
      list[i].updatedAt = Date.now();
    }
  }
  function applyOnlyThis(ev, at, title, s, e){
    var list = load();
    skipOccurrence(list, ev, at);
    list.push({ id: newId(), title: title, start: s, end: e, repeat: "", updatedAt: Date.now() });
    save(list);
  }
  // «Это и последующие»: первое повторение — серия правится на месте; иначе старая серия обрывается (until), с этого повторения стартует новая
  function applyFollowing(ev, at, title, s, e, r){
    var list = load(), now = Date.now();
    var atKey = dateValue(at);
    var same = dateValue(s) === atKey && r === (ev.repeat || "");
    var skip = same ? (ev.skip || []).filter(function(k){ return k >= atKey; }) : [];
    function make(id){
      var rec = { id: id, title: title, start: s, end: e, repeat: r, updatedAt: now };
      if(r){
        if(ev.until && ev.until > s) rec.until = ev.until;
        if(skip.length) rec.skip = skip;
      }
      return rec;
    }
    if(at === ev.start){
      replaceInList(list, make(ev.id));
    } else {
      for(var i = 0; i < list.length; i++){
        if(list[i].id === ev.id){
          list[i].until = list[i].until ? Math.min(list[i].until, at) : at;
          list[i].updatedAt = now;
        }
      }
      list.push(make(newId()));
    }
    save(list);
  }
  function deleteOccurrence(ev, at, following){
    var list = load();
    if(following && at === ev.start){
      list = list.filter(function(x){ return x.id !== ev.id; });
    } else if(following){
      for(var i = 0; i < list.length; i++){
        if(list[i].id === ev.id){
          list[i].until = list[i].until ? Math.min(list[i].until, at) : at;
          list[i].updatedAt = Date.now();
        }
      }
    } else {
      skipOccurrence(list, ev, at);
    }
    save(list);
  }

  // ---------- форма ----------
  // ev — мероприятие (null — новое); at — начало того повторения, по которому нажали (у серии форма показывает его, а не первое начало)
  function openForm(ev, at){
    var c = container();
    if(!c) return;
    clearTimeout(tapTimer); tapTimer = null;
    screen = "form";
    var isNew = !ev;
    var baseS = ev ? (ev.repeat && isFinite(at) ? at : ev.start) : 0;
    var baseE = ev ? baseS + Math.max(0, ev.end - ev.start) : 0;
    var html = '<div class="mdeditor-tab item-card-form" id="calendarForm">' +
      '<h3 class="common-tab-title">' + (isNew ? "Новое мероприятие" : "Мероприятие") + '</h3>' +
      '<input type="text" class="mdeditor-cleanup-input item-form-title" id="calTitle" placeholder="Название мероприятия" maxlength="120" autocomplete="off">' +
      '<div class="cal-field"><div class="item-form-hint">Начало</div><div class="cal-dt">' +
        '<input type="date" class="mdeditor-cleanup-input" id="calStartDate" aria-label="Дата начала">' +
        '<input type="time" class="mdeditor-cleanup-input" id="calStartTime" aria-label="Время начала">' +
      '</div></div>' +
      '<div class="cal-field"><div class="item-form-hint">Окончание</div><div class="cal-dt">' +
        '<input type="date" class="mdeditor-cleanup-input" id="calEndDate" aria-label="Дата окончания">' +
        '<input type="time" class="mdeditor-cleanup-input" id="calEndTime" aria-label="Время окончания">' +
      '</div></div>' +
      '<div class="cal-field"><div class="item-form-hint">Повторения</div>' +
        '<select class="mdeditor-cleanup-input" id="calRepeat"><option value="">Не повторять</option>' +
        REPEATS.map(function(r){ return '<option value="' + r.key + '">' + r.label + '</option>'; }).join("") +
        '</select></div>' +
      '<div class="item-form-error" id="calError"></div>' +
      '<div class="cal-scope" id="calScope" style="display:none"></div>' +
      '<div class="item-form-buttons" id="calBtns">' +
        '<button type="button" class="workbooks-run-btn" id="calSave">Сохранить</button>' +
        '<button type="button" class="workbooks-run-btn" id="calCancel">Отмена</button>' +
      '</div>' +
      (isNew ? '' : '<div class="item-form-buttons" id="calDelRow"><button type="button" class="workbooks-run-btn" id="calDelete">Удалить</button></div>') +
    '</div>';
    c.innerHTML = html;
    c.scrollTop = 0;

    var titleEl = document.getElementById("calTitle");
    var sd = document.getElementById("calStartDate"), st = document.getElementById("calStartTime");
    var ed = document.getElementById("calEndDate"), et = document.getElementById("calEndTime");
    var repEl = document.getElementById("calRepeat"), errEl = document.getElementById("calError");
    if(ev){
      titleEl.value = ev.title;
      sd.value = dateValue(baseS); st.value = timeValue(baseS);
      ed.value = dateValue(baseE); et.value = timeValue(baseE);
      repEl.value = ev.repeat || "";
    }

    // окончание = начало + 1 час, пока пользователь сам не правил окончание (у существующего мероприятия — не трогаем)
    var endTouched = !isNew;
    function onStart(){
      if(endTouched) return;
      var s = parseLocal(sd.value, st.value);
      if(isNaN(s)) return;
      var e = s + HOUR_MS;
      ed.value = dateValue(e);
      et.value = timeValue(e);
    }
    function onEnd(){ endTouched = true; }
    ["change", "input"].forEach(function(t){
      sd.addEventListener(t, onStart); st.addEventListener(t, onStart);
      ed.addEventListener(t, onEnd); et.addEventListener(t, onEnd);
    });

    function leave(){ renderList(); }
    document.getElementById("calCancel").addEventListener("click", leave);
    if(window.AppNav) window.AppNav.push(function(){ if(screen === "form") renderList(); });

    function fail(msg){ errEl.textContent = msg; }
    var scopeEl = document.getElementById("calScope"), btnsEl = document.getElementById("calBtns"), delRowEl = document.getElementById("calDelRow");
    // вопрос «только это / это и последующие» вместо кнопок формы
    function askScope(text, onOnly, onFollowing){
      errEl.textContent = "";
      scopeEl.innerHTML = '<div class="item-form-hint">' + esc(text) + '</div>' +
        '<button type="button" class="workbooks-run-btn" id="calScopeOnly">Только это</button>' +
        '<button type="button" class="workbooks-run-btn" id="calScopeFollow">Это и все последующие</button>' +
        '<button type="button" class="workbooks-run-btn" id="calScopeBack">Назад</button>';
      scopeEl.style.display = "flex";
      btnsEl.style.display = "none";
      if(delRowEl) delRowEl.style.display = "none";
      document.getElementById("calScopeOnly").addEventListener("click", onOnly);
      document.getElementById("calScopeFollow").addEventListener("click", onFollowing);
      document.getElementById("calScopeBack").addEventListener("click", function(){
        scopeEl.style.display = "none"; scopeEl.innerHTML = "";
        btnsEl.style.display = "";
        if(delRowEl) delRowEl.style.display = "";
      });
    }

    document.getElementById("calSave").addEventListener("click", function(){
      var title = titleEl.value.replace(/^\s+|\s+$/g, "");
      if(!title) return fail("Введите название мероприятия");
      var s = parseLocal(sd.value, st.value);
      if(isNaN(s)) return fail("Укажите дату и время начала");
      var e;
      if(!ed.value && !et.value) e = s + HOUR_MS;
      else {
        e = parseLocal(ed.value, et.value);
        if(isNaN(e)) return fail("Укажите дату и время окончания");
      }
      if(e <= s) return fail("Окончание должно быть позже начала");
      var r = repEl.value || "";

      if(ev && ev.repeat){ // правка повторения серии
        if(title === ev.title && s === baseS && e === baseE && r === ev.repeat) return renderList(); // ничего не менялось
        var following = function(){ applyFollowing(ev, baseS, title, s, e, r); renderList(); }; // не function-объявление в блоке: старый WebView (Android 5)
        if(r !== ev.repeat) return following(); // менялся вид повтора — это всегда «последующие», вопрос не нужен
        return askScope("Это повторяющееся мероприятие. Сохранить изменения:",
          function(){ applyOnlyThis(ev, baseS, title, s, e); renderList(); },
          following);
      }

      var list = load();
      var rec = { id: ev ? ev.id : newId(), title: title, start: s, end: e, repeat: r, updatedAt: Date.now() };
      if(!replaceInList(list, rec)) list.push(rec);
      save(list);
      renderList();
    });

    var delBtn = document.getElementById("calDelete");
    if(delBtn){
      var armed = false, armTimer = null;
      delBtn.addEventListener("click", function(){
        if(ev.repeat){ // серия: вопрос вместо двойного нажатия
          return askScope("Это повторяющееся мероприятие. Удалить:",
            function(){ deleteOccurrence(ev, baseS, false); renderList(); },
            function(){ deleteOccurrence(ev, baseS, true); renderList(); });
        }
        if(!armed){
          armed = true;
          delBtn.textContent = "Точно удалить?";
          armTimer = setTimeout(function(){ armed = false; delBtn.textContent = "Удалить"; }, 3000);
          return;
        }
        clearTimeout(armTimer);
        save(load().filter(function(x){ return x.id !== ev.id; }));
        renderList();
      });
    }
  }

  window.CalendarTab = {
    render: renderList,
    // для проверки/других модулей: мероприятия на отрезке [from, to) — [{id,title,at,dur,repeat}]
    occurrences: function(from, to){
      var out = [];
      load().forEach(function(ev){
        occurrenceStarts(ev, from, to).forEach(function(at){
          out.push({ id: ev.id, title: ev.title, at: at, dur: Math.max(0, ev.end - ev.start), repeat: ev.repeat || "" });
        });
      });
      out.sort(function(a, b){ return a.at - b.at; });
      return out;
    }
  };
})();
