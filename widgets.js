/* ===========================================================================
   widgets.js
   Версия: 1.1 (11.11)
   Вкладка «Конструктор виджетов» (ключ "widgets", кнопка settingsTabWidgetsBtn): виджеты рабочего стола «Стопка QR-карточек» 2×2 (Android, QrWidgets.kt).
   В виджет входит до 10 карточек вкладки «QR-коды» (itemcards.js); виден один, смахивание вверх/вниз листает по кругу; нажатие — как скан кода карточки.
   Настройки виджета: слайд-шоу «Переключать виджеты по кругу» (раз в N минут) ИЛИ «Переключение по релевантности»; у каждой карточки —
   необязательные время суток (утро/обед/вечер) и дни недели, когда она поднимается наверх.
   Данные: localStorage `qrWidgets_v1` ({n, ever, list:[{id,n,cards:[{cid,times,days}],rotate,rotateMin,relevance}]}), только на устройстве.
   Страница рисует лица карточек в PNG (canvas, `pngFor`) и шлёт их оболочке вместе с настройками (мост ≥31 `widgetsSync`).
   Точка входа: window.initWidgetsModule(deps) → window.WidgetsTab.{render, scheduleSync}.
   =========================================================================== */
(function(){
  "use strict";
  var KEY = "qrWidgets_v1";
  var PICK_FILTER_KEY = "widgetsPickFilter_v1";
  var MAX_CARDS = 10;
  var FACE_PX = 480; // сторона картинки лица для оболочки
  // интервалы времени суток — те же значения в QrWidgets.kt (WINDOWS)
  var WINDOWS = [
    { k: "m", label: "Утро", hint: "5–11" },
    { k: "d", label: "Обед", hint: "11–15" },
    { k: "e", label: "Вечер", hint: "17–23" }
  ];
  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]; // 1..7
  var PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
  var FILTER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5z"></path></svg>';

  window.initWidgetsModule = function(deps){
    var esc = deps.escapeHtml;
    var HOME_SVG = deps.READER_HOME_ICON_SVG;
    var data = load();
    var stack = [{ s: "list" }];
    var armed = null;
    var syncTimer = null;
    var pngCache = {};
    var styleDone = false;

    // ---------- хранилище ----------
    function load(){
      var o = null;
      try{ o = JSON.parse(localStorage.getItem(KEY) || "null"); }catch(e){}
      if(!o || typeof o !== "object" || !Array.isArray(o.list)) o = { n: 0, ever: false, list: [] };
      o.list = o.list.filter(function(w){ return w && w.id && Array.isArray(w.cards); });
      o.list.forEach(function(w){
        w.cards = w.cards.filter(function(c){ return c && c.cid; }).slice(0, MAX_CARDS);
        w.cards.forEach(function(c){ c.times = Array.isArray(c.times) ? c.times : []; c.days = Array.isArray(c.days) ? c.days : []; });
        w.rotateMin = Math.max(1, Math.min(720, w.rotateMin | 0 || 5));
        w.rotate = !!w.rotate; w.relevance = !!w.relevance && !w.rotate;
      });
      return o;
    }
    function save(){ try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){} }
    function changed(){ save(); scheduleSync(600); }
    function widgetById(id){ for(var i = 0; i < data.list.length; i++) if(data.list[i].id === id) return data.list[i]; return null; }
    function wname(w){ return "Виджет " + w.n; }
    function bridge(){ var b = window.LifeTrackerNative; return (b && typeof b.widgetsSync === "function") ? b : null; }
    function nativeState(){
      var b = bridge(); if(!b) return null;
      try{ return JSON.parse(b.widgetsState() || "{}"); }catch(e){ return null; }
    }
    function cardsOf(){ return deps.getItemCards(); }

    // ---------- лицо карточки → PNG для оболочки ----------
    function rrect(g, x, y, w, h, r){
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
      g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
      g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
      g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
    }
    function wrapLines(g, text, maxW){
      var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = "";
      words.forEach(function(w){
        var t = cur ? cur + " " + w : w;
        if(cur && g.measureText(t).width > maxW){ lines.push(cur); cur = w; } else cur = t;
      });
      if(cur) lines.push(cur);
      return lines;
    }
    function svgImage(svg){
      return new Promise(function(resolve){
        if(!svg) return resolve(null);
        var s = String(svg).replace(/currentColor/g, "#ffffff");
        if(s.indexOf("xmlns") < 0) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"');
        var img = new Image();
        img.onload = function(){ resolve(img); };
        img.onerror = function(){ resolve(null); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      });
    }
    function drawFace(face, icon){
      var S = FACE_PX, cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var g = cv.getContext("2d");
      var bodyH = Math.round(S * 0.96), r = S * 0.12, shift = S * 0.04;
      rrect(g, 0, shift, S, bodyH, r); g.fillStyle = face.shade; g.fill();   // цветной выступ снизу
      rrect(g, 0, 0, S, bodyH, r); g.fillStyle = face.color; g.fill();
      var maxW = S * 0.86, serif = '"Palatino Linotype",Georgia,serif', sans = "sans-serif";
      var items = [];
      if(icon) items.push({ h: S * 0.27, gap: S * 0.03, icon: true });
      var tfs = S * ((face.type === "timer" || face.type === "alarm") ? 0.11 : 0.12), lines = [];
      if(face.title){
        for(;;){
          g.font = "700 " + tfs + "px " + serif;
          var widest = 0;
          String(face.title).split(/\s+/).forEach(function(w){ var m = g.measureText(w).width; if(m > widest) widest = m; });
          if(widest <= maxW || tfs <= S * 0.07) break;
          tfs *= 0.92;
        }
        lines = wrapLines(g, face.title, maxW);
        if(lines.length > 2){ lines = lines.slice(0, 2); lines[1] = lines[1].replace(/.?$/, "…"); }
        items.push({ h: lines.length * tfs * 1.25, gap: S * 0.03, title: true });
      }
      var bfs = S * 0.19;
      if(face.big) items.push({ h: bfs * 1.1, gap: S * 0.03, big: true });
      var sfs = S * 0.09;
      if(face.sub) items.push({ h: sfs * 1.2, gap: 0, sub: true });
      var total = 0; items.forEach(function(it){ total += it.h + it.gap; });
      if(items.length) total -= items[items.length - 1].gap;
      var y = (bodyH - total) / 2;
      g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = "#ffffff";
      items.forEach(function(it){
        if(it.icon){ if(icon) g.drawImage(icon, (S - it.h) / 2, y, it.h, it.h); }
        else if(it.title){
          g.font = "700 " + tfs + "px " + serif;
          lines.forEach(function(ln, i){ g.fillText(ln, S / 2, y + i * tfs * 1.25 + tfs * 0.12); });
        } else if(it.big){
          g.font = "700 " + bfs + "px " + sans;
          g.fillText(face.big, S / 2, y + bfs * 0.04, maxW);
        } else if(it.sub){
          g.font = "400 " + sfs + "px " + sans;
          g.fillText(face.sub, S / 2, y + sfs * 0.06, maxW);
        }
        y += it.h + it.gap;
      });
      return cv;
    }
    function pngFor(face){
      var sig = JSON.stringify([face.color, face.title, face.big, face.sub, face.svg, face.type]);
      var hit = pngCache[face.id];
      if(hit && hit.sig === sig) return Promise.resolve(hit.url);
      return svgImage(face.svg).then(function(icon){
        var url = "";
        try{ url = drawFace(face, icon).toDataURL("image/png"); }
        catch(e){ try{ url = drawFace(face, null).toDataURL("image/png"); }catch(e2){ url = ""; } } // холст «испачкан» значком — рисуем без него
        if(url) pngCache[face.id] = { sig: sig, url: url };
        return url;
      });
    }

    // ---------- отправка оболочке ----------
    function scheduleSync(ms){
      if(!bridge()) return;
      if(!data.list.length && !data.ever) return;
      if(syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(function(){ syncTimer = null; syncNow(); }, ms == null ? 1500 : ms);
    }
    function syncNow(){
      var b = bridge();
      if(!b) return Promise.resolve(false);
      var ic = cardsOf(), ids = {}, faces = {};
      data.list.forEach(function(w){ w.cards.forEach(function(c){ ids[c.cid] = 1; }); });
      Object.keys(ids).forEach(function(id){ var f = ic.widgetFace(id); if(f) faces[id] = f; });
      var keys = Object.keys(faces);
      return Promise.all(keys.map(function(k){ return pngFor(faces[k]); })).then(function(urls){
        var images = {};
        keys.forEach(function(k, i){ if(urls[i]) images[k] = urls[i]; });
        var widgets = data.list.map(function(w){
          return {
            id: w.id, name: wname(w), rotate: w.rotate, rotateMin: w.rotateMin, relevance: w.relevance,
            cards: w.cards.filter(function(c){ return faces[c.cid]; }).map(function(c){
              var f = faces[c.cid];
              return { key: c.cid, code: f.code, title: f.title, live: f.live, times: c.times, days: c.days };
            })
          };
        });
        if(data.list.length && !data.ever){ data.ever = true; save(); }
        try{ return !!b.widgetsSync(JSON.stringify({ v: 1, widgets: widgets, images: images })); }catch(e){ return false; }
      });
    }

    // ---------- навигация внутри вкладки ----------
    function rootEl(){ return document.getElementById("widgetsTabRoot"); }
    function arm(){
      if(armed || !window.AppNav) return;
      var t = { active: true };
      armed = t;
      window.AppNav.push(function(){
        if(!t.active) return;
        t.active = false; if(armed === t) armed = null;
        if(!rootEl()) return;
        leaveScreen(stack.pop());
        if(stack.length > 1) arm();
        render();
      });
    }
    function disarm(){
      if(!armed) return;
      var t = armed; armed = null; t.active = false;
      try{ history.back(); }catch(e){}
    }
    function go(s, a){ stack.push({ s: s, a: a }); arm(); render(); }
    function backUi(){
      if(stack.length <= 1) return;
      leaveScreen(stack.pop());
      if(stack.length <= 1) disarm();
      render();
    }
    function homeUi(){
      while(stack.length > 1) leaveScreen(stack.pop());
      disarm();
      render();
    }
    function leaveScreen(top){
      if(top && top.s === "form" && top.a && top.a.draft && !top.a.w.cards.length) top.a.draft = false; // пустой новый виджет не сохраняется
    }
    function cur(){ return stack[stack.length - 1]; }

    // ---------- стили ----------
    function ensureStyles(){
      if(styleDone || document.getElementById("widgetsTabStyle")){ styleDone = true; return; }
      styleDone = true;
      var st = document.createElement("style");
      st.id = "widgetsTabStyle";
      st.textContent =
        ".widgets-tab{padding:10px 12px 96px;}" +
        ".wg-title{font-size:20px;font-weight:700;text-align:center;margin:6px 0 14px;color:var(--ink);}" +
        ".wg-hint{font-size:13px;line-height:1.35;color:var(--ink-soft);margin:6px 2px 10px;}" +
        ".wg-row{display:flex;align-items:center;padding:10px 12px;margin:0 0 8px;border-radius:14px;background:var(--gold-light);color:var(--ink);cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-row-ico{flex:0 0 auto;width:42px;height:42px;border-radius:10px;margin-right:12px;}" +
        ".wg-row-txt{flex:1 1 auto;min-width:0;}" +
        ".wg-row-name{font-weight:700;font-size:16px;}" +
        ".wg-row-sub{font-size:13px;color:var(--ink-soft);}" +
        ".wg-empty{text-align:center;color:var(--ink-soft);padding:40px 16px;font-size:15px;}" +
        ".wg-slots{display:flex;flex-wrap:wrap;justify-content:center;margin:0 -6px 8px;}" +
        ".wg-slot{position:relative;margin:6px 6px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-slot-empty{width:96px;height:96px;box-sizing:border-box;border:2px dashed var(--groove-shadow);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--ink-soft);}" +
        ".wg-slot-empty svg{width:34px;height:34px;}" +
        ".wg-card{position:relative;width:96px;height:96px;border-radius:12px;color:#fff;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:5px;}" +
        ".wg-card > *{flex:0 0 auto;max-width:100%;box-sizing:border-box;}" +
        ".wg-card.used{opacity:.35;}" +
        ".wg-card-ico{width:26px;height:26px;margin-bottom:3px;}" +
        ".wg-card-ico svg{display:block;width:26px;height:26px;}" +
        ".wg-card-title{font-family:\"Palatino Linotype\",Georgia,serif;font-size:11.5px;line-height:1.25;font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:normal;}" +
        ".wg-card-title.t-s{font-size:10px;}" +
        ".wg-card-title.t-xs{font-size:8.5px;}" +
        ".wg-card-big{font-size:18px;line-height:1.1;font-weight:700;white-space:nowrap;margin-top:3px;}" +
        ".wg-card-sub{font-size:8.6px;line-height:1.2;margin-top:3px;}" +
        ".wg-badge{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--wood);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;}" +
        ".wg-check{display:flex;align-items:center;margin:10px 2px;font-size:15px;color:var(--ink);}" +
        ".wg-check input[type=checkbox]{width:22px;height:22px;margin:0 10px 0 0;flex:0 0 auto;}" +
        ".wg-min{margin:0 2px 8px 32px;font-size:14px;color:var(--ink);}" +
        ".wg-min input{width:64px;font-size:16px;padding:4px 6px;margin:0 6px;text-align:center;}" +
        ".wg-chips{display:flex;flex-wrap:wrap;margin:6px 0 4px;}" +
        ".wg-chip{margin:0 8px 8px 0;padding:8px 14px;border-radius:18px;background:var(--gold-light);color:var(--ink);font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
        ".wg-chip.on{background:var(--wood);color:#fff;}" +
        ".wg-chip small{opacity:.7;margin-left:4px;font-size:11px;}" +
        ".wg-sec{font-weight:700;margin:14px 2px 2px;color:var(--ink);}" +
        ".wg-btns{display:flex;flex-direction:column;margin-top:14px;}" +
        ".wg-btns .workbooks-run-btn{margin:0 0 10px;}" +
        ".wg-preview{display:flex;justify-content:center;margin:4px 0 10px;}" +
        ".wg-menu{position:fixed;right:12px;bottom:84px;z-index:30;background:var(--parchment);border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.3);padding:6px;max-height:60vh;overflow:auto;}" +
        ".wg-menu button{display:block;width:100%;text-align:left;margin:2px 0;}" +
        ".wg-menu button.selected{background:var(--wood);color:#fff;}";
      document.head.appendChild(st);
    }

    // ---------- разметка ----------
    function titleSize(t){
      var m = 0; String(t).split(/\s+/).forEach(function(w){ if(w.length > m) m = w.length; });
      var base = (arguments[1] === "timer" || arguments[1] === "alarm") ? 1 : 0;
      return (m >= 11) ? " t-xs" : (m >= 8 + base ? " t-s" : "");
    }
    function faceHtml(f, cls, extra){
      return '<div class="wg-card' + (cls ? " " + cls : "") + '" style="background:' + f.color + ';box-shadow:0 4px 0 ' + f.shade + ';">' +
        (f.svg ? '<div class="wg-card-ico">' + String(f.svg).replace(/currentColor/g, "#ffffff") + '</div>' : '') +
        (f.title ? '<div class="wg-card-title' + titleSize(f.title, f.type) + '">' + esc(f.title) + '</div>' : '') +
        (f.big ? '<div class="wg-card-big">' + esc(f.big) + '</div>' : '') +
        (f.sub ? '<div class="wg-card-sub">' + esc(f.sub) + '</div>' : '') +
        (extra || '') + '</div>';
    }
    function fabRow(inner){ return '<div class="mdeditor-fab-row">' + inner + '</div>'; }
    function homeBtn(title, disabled){
      return '<button type="button" class="mdeditor-fab-btn" id="wgHomeBtn" title="' + esc(title) + '"' + (disabled ? ' tabindex="-1" aria-disabled="true"' : '') + '>' + HOME_SVG + '</button>';
    }
    function modeText(w){
      if(w.rotate) return "по кругу, раз в " + w.rotateMin + " мин";
      if(w.relevance) return "по релевантности";
      return "листаете сами";
    }
    function cardWord(n){
      var m = n % 10, h = n % 100;
      return n + " " + (m === 1 && h !== 11 ? "карточка" : ((m >= 2 && m <= 4 && (h < 12 || h > 14)) ? "карточки" : "карточек"));
    }

    function listHtml(){
      var st = nativeState(), placed = (st && st.placed) || {};
      var html = '<div class="wg-title">Конструктор виджетов</div>';
      if(!data.list.length){
        html += '<div class="wg-empty">Виджетов пока нет.<br>Нажмите «+», чтобы собрать стопку из карточек QR-кодов.</div>';
      }
      data.list.forEach(function(w){
        var f = w.cards.length ? cardsOf().widgetFace(w.cards[0].cid) : null;
        html += '<div class="wg-row" data-id="' + esc(w.id) + '">' +
          '<div class="wg-row-ico" style="background:' + (f ? f.color : "var(--gold)") + ';"></div>' +
          '<div class="wg-row-txt"><div class="wg-row-name">' + esc(wname(w)) + '</div>' +
          '<div class="wg-row-sub">' + cardWord(w.cards.length) + ' · ' + modeText(w) + (placed[w.id] ? ' · на рабочем столе' : '') + '</div></div></div>';
      });
      if(!bridge()) html += '<div class="wg-hint">Виджеты работают только в приложении на телефоне (Android).</div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn" id="wgAddBtn" title="Новый виджет">' + PLUS_SVG + '</button>' + homeBtn("", true));
      return html;
    }

    function formHtml(a){
      var w = a.w, html = '<div class="wg-title">' + esc(wname(w)) + '</div><div class="wg-slots">';
      for(var i = 0; i < MAX_CARDS; i++){
        var c = w.cards[i], f = c ? cardsOf().widgetFace(c.cid) : null;
        if(c && f){
          var sched = (c.times.length || c.days.length) ? '<div class="wg-badge">⏰</div>' : '';
          html += '<div class="wg-slot" data-i="' + i + '">' + faceHtml(f, "", sched) + '</div>';
        } else if(c){
          html += '<div class="wg-slot" data-i="' + i + '"><div class="wg-slot-empty">?</div></div>'; // карточку удалили
        } else {
          html += '<div class="wg-slot" data-add="1"><div class="wg-slot-empty">' + PLUS_SVG + '</div></div>';
        }
      }
      html += '</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgRotate"' + (w.rotate ? ' checked' : '') + '>Переключать виджеты по кругу</label>';
      if(w.rotate) html += '<div class="wg-min">каждые<input type="number" id="wgRotMin" min="1" max="720" value="' + w.rotateMin + '">мин</div>';
      html += '<label class="wg-check"><input type="checkbox" id="wgRel"' + (w.relevance ? ' checked' : '') + '>Переключение по релевантности</label>';
      html += '<div class="wg-hint">По кругу — карточки сменяют друг друга сами. По релевантности — наверху то, что запущено сейчас (тренировка, затем помодоро, затем таймеры и секундомер), следом карточки, у которых сейчас их время суток и день. Включить можно что-то одно.</div>';
      var st = nativeState(), placed = st && st.placed && st.placed[w.id];
      html += '<div class="wg-btns">';
      if(bridge()) html += '<button type="button" class="workbooks-run-btn" id="wgPinBtn">' + (placed ? 'Добавить ещё один на рабочий стол' : 'Добавить на рабочий стол') + '</button><div class="wg-hint" id="wgPinHint"></div>';
      html += '<button type="button" class="workbooks-run-btn" id="wgDelBtn">Удалить виджет</button></div>';
      html += fabRow(homeBtn("К списку виджетов"));
      return html;
    }

    function cardHtml(a){
      var w = a.w, c = w.cards[a.i], f = c ? cardsOf().widgetFace(c.cid) : null;
      if(!c) return '';
      var html = '<div class="wg-title">Карточка ' + (a.i + 1) + ' из ' + w.cards.length + '</div>';
      if(f) html += '<div class="wg-preview">' + faceHtml(f, "") + '</div>';
      html += '<div class="wg-sec">Время суток</div><div class="wg-chips" id="wgTimes">';
      WINDOWS.forEach(function(t){ html += '<div class="wg-chip' + (c.times.indexOf(t.k) >= 0 ? ' on' : '') + '" data-k="' + t.k + '">' + t.label + '<small>' + t.hint + ' ч</small></div>'; });
      html += '</div><div class="wg-sec">Дни недели</div><div class="wg-chips" id="wgDays">';
      DAYS.forEach(function(d, i){ html += '<div class="wg-chip' + (c.days.indexOf(i + 1) >= 0 ? ' on' : '') + '" data-d="' + (i + 1) + '">' + d + '</div>'; });
      html += '</div><div class="wg-hint">Необязательно. Если выбрать, карточка поднимается наверх в эти часы и дни — при включённом «Переключении по релевантности». Если не выбрано ничего, она ничем не выделяется.</div>';
      html += '<div class="wg-btns"><button type="button" class="workbooks-run-btn" id="wgReplaceBtn">Заменить карточку</button>' +
        '<button type="button" class="workbooks-run-btn" id="wgRemoveBtn">Убрать из виджета</button></div>';
      html += fabRow(homeBtn("К виджету"));
      return html;
    }

    function pickFilter(){ var v = "all"; try{ v = localStorage.getItem(PICK_FILTER_KEY) || "all"; }catch(e){} return v; }
    function pickHtml(a){
      var filters = cardsOf().widgetFilters(), fk = pickFilter();
      if(!filters.some(function(f){ return f.key === fk; })) fk = "all";
      var used = {}; a.w.cards.forEach(function(c, i){ if(i !== a.replace) used[c.cid] = 1; });
      var list = cardsOf().widgetCards(fk);
      var html = '<div class="wg-title">Выберите карточку</div><div class="wg-slots">';
      if(!list.length) html += '<div class="wg-empty">Нет подходящих карточек.</div>';
      list.forEach(function(f){
        html += '<div class="wg-slot" data-cid="' + esc(f.id) + '"' + (used[f.id] ? ' data-used="1"' : '') + '>' + faceHtml(f, used[f.id] ? "used" : "") + '</div>';
      });
      html += '</div>';
      html += '<div class="wg-menu" id="wgFilterMenu" style="display:none;">' + filters.map(function(f){
        return '<button type="button" class="workbooks-run-btn' + (f.key === fk ? ' selected' : '') + '" data-filter="' + f.key + '">' + esc(f.label) + '</button>';
      }).join('') + '</div>';
      html += fabRow('<button type="button" class="mdeditor-fab-btn' + (fk !== "all" ? ' pressed' : '') + '" id="wgFilterBtn" title="Показать карточки">' + FILTER_SVG + '</button>' + homeBtn("К виджету"));
      return html;
    }

    // ---------- отрисовка и события ----------
    function render(){
      var el = document.getElementById("settingsTabContent");
      if(!el) return;
      ensureStyles();
      var top = cur(), body = "";
      if(top.s === "list") body = listHtml();
      else if(top.s === "form") body = formHtml(top.a);
      else if(top.s === "card") body = cardHtml(top.a);
      else if(top.s === "pick") body = pickHtml(top.a);
      el.innerHTML = '<div class="mdeditor-tab widgets-tab" id="widgetsTabRoot">' + body + '</div>';
      bind(top);
    }
    function $(id){ return document.getElementById(id); }
    function bind(top){
      var root = rootEl(); if(!root) return;
      var home = $("wgHomeBtn");
      if(home && !home.getAttribute("aria-disabled")) home.addEventListener("click", function(){ if(top.s === "form") homeUi(); else backUi(); });
      if(top.s === "list"){
        $("wgAddBtn").addEventListener("click", function(){
          var w = { id: "w" + Date.now().toString(36), n: data.n + 1, cards: [], rotate: false, rotateMin: 5, relevance: false };
          go("form", { w: w, draft: true });
        });
        Array.prototype.forEach.call(root.querySelectorAll(".wg-row"), function(r){
          r.addEventListener("click", function(){ var w = widgetById(r.getAttribute("data-id")); if(w) go("form", { w: w }); });
        });
      } else if(top.s === "form"){
        bindForm(top.a);
      } else if(top.s === "card"){
        bindCard(top.a);
      } else if(top.s === "pick"){
        bindPick(top.a);
      }
    }
    function commitDraft(a){
      if(a.draft && a.w.cards.length){ a.draft = false; data.n = Math.max(data.n, a.w.n); data.list.push(a.w); }
    }
    function bindForm(a){
      var w = a.w;
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-slot"), function(s){
        s.addEventListener("click", function(){
          if(s.getAttribute("data-add")) go("pick", { w: w, draft: a.draft, replace: -1, form: a });
          else go("card", { w: w, i: parseInt(s.getAttribute("data-i"), 10), form: a });
        });
      });
      var rot = $("wgRotate"), rel = $("wgRel");
      rot.addEventListener("change", function(){ w.rotate = rot.checked; if(w.rotate) w.relevance = false; commitDraft(a); changed(); render(); });
      rel.addEventListener("change", function(){ w.relevance = rel.checked; if(w.relevance) w.rotate = false; commitDraft(a); changed(); render(); });
      var mn = $("wgRotMin");
      if(mn) mn.addEventListener("change", function(){ w.rotateMin = Math.max(1, Math.min(720, parseInt(mn.value, 10) || 5)); mn.value = w.rotateMin; commitDraft(a); changed(); });
      var pin = $("wgPinBtn");
      if(pin) pin.addEventListener("click", function(){
        var hint = $("wgPinHint");
        if(!w.cards.length){ hint.textContent = "Сначала добавьте в виджет хотя бы одну карточку."; return; }
        commitDraft(a); save();
        hint.textContent = "Готовлю…";
        syncNow().then(function(ok){
          if(!ok){ hint.textContent = "Не удалось передать виджет оболочке."; return; }
          var res = "failed";
          try{ res = String(bridge().widgetPin(w.id)); }catch(e){}
          hint.textContent = res === "requested" ? "Подтвердите добавление на рабочем столе."
            : "Рабочий стол не принял запрос. Добавьте виджет «Стопка QR-карточек» через меню виджетов (долгое нажатие на пустом месте рабочего стола) и выберите «" + wname(w) + "».";
        });
      });
      var del = $("wgDelBtn"), armedDel = false;
      del.addEventListener("click", function(){
        if(!armedDel){ armedDel = true; del.textContent = "Нажмите ещё раз — удалить"; setTimeout(function(){ armedDel = false; if(del.parentNode) del.textContent = "Удалить виджет"; }, 3500); return; }
        data.list = data.list.filter(function(x){ return x.id !== w.id; });
        a.draft = false; changed(); homeUi();
      });
    }
    function bindCard(a){
      var c = a.w.cards[a.i]; if(!c) return;
      function toggle(arr, v){ var i = arr.indexOf(v); if(i >= 0) arr.splice(i, 1); else arr.push(v); arr.sort(); }
      Array.prototype.forEach.call($("wgTimes").children, function(ch){
        ch.addEventListener("click", function(){ toggle(c.times, ch.getAttribute("data-k")); ch.classList.toggle("on"); changed(); });
      });
      Array.prototype.forEach.call($("wgDays").children, function(ch){
        ch.addEventListener("click", function(){ toggle(c.days, parseInt(ch.getAttribute("data-d"), 10)); ch.classList.toggle("on"); changed(); });
      });
      $("wgReplaceBtn").addEventListener("click", function(){ go("pick", { w: a.w, draft: false, replace: a.i, form: a }); });
      $("wgRemoveBtn").addEventListener("click", function(){ a.w.cards.splice(a.i, 1); changed(); backUi(); });
    }
    function bindPick(a){
      var menu = $("wgFilterMenu");
      $("wgFilterBtn").addEventListener("click", function(e){ e.stopPropagation(); menu.style.display = menu.style.display === "none" ? "block" : "none"; });
      Array.prototype.forEach.call(menu.querySelectorAll("button"), function(b){
        b.addEventListener("click", function(){
          try{ var k = b.getAttribute("data-filter"); if(k === "all") localStorage.removeItem(PICK_FILTER_KEY); else localStorage.setItem(PICK_FILTER_KEY, k); }catch(e){}
          render();
        });
      });
      rootEl().addEventListener("click", function(e){ if(menu.style.display !== "none" && !menu.contains(e.target)) menu.style.display = "none"; }, true);
      Array.prototype.forEach.call(rootEl().querySelectorAll(".wg-slot[data-cid]"), function(s){
        s.addEventListener("click", function(){
          if(s.getAttribute("data-used")) return;
          var cid = s.getAttribute("data-cid"), w = a.w;
          if(a.replace >= 0 && w.cards[a.replace]) w.cards[a.replace].cid = cid;
          else if(w.cards.length < MAX_CARDS) w.cards.push({ cid: cid, times: [], days: [] });
          var form = a.form && a.form.draft !== undefined ? a.form : null;
          if(a.draft && form) commitDraft(form);
          changed();
          backUi();
        });
      });
    }

    function renderTab(){
      if(armed){ armed.active = false; armed = null; }
      stack = [{ s: "list" }];
      data = load();
      render();
    }

    return { render: renderTab, scheduleSync: scheduleSync, syncNow: syncNow, hasWidgets: function(){ return data.list.length > 0 || !!data.ever; } };
  };
})();
