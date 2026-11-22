/* ===========================================================================
   downloadfolders.js
   Версия: 1.0 (22.11)
   1.0 (22.11): вкладка «Сохранение загрузок» (set2s_17, кнопка settingsTabSet2Btn17; рядом с «Системой» в ряду «Настройки и статистика»).
   ТЗ TZ_downloads.md, этап 4 (раздел 13): куда приложение кладёт скачанные файлы. По умолчанию всё идёт в «Загрузки»; пользователь сам
   включает нужные типы файлов (картинки, видео, PDF, книги, музыка, документы, архивы, APK, обновление приложения, «всё остальное») и
   выбирает для них папку, а также добавляет «свои форматы» (формат → папка; главнее категорий).
   Всё решает оболочка Android (мост LifeTrackerNative версии 43: downloadFoldersGet / downloadFolderPick / downloadFolderSetEnabled /
   downloadFolderReset / downloadFolderUseLibrary / downloadRuleAdd / downloadRuleRemove; DownloadFolders.kt, DownloadRules.kt) — страница
   только показывает настройки и передаёт нажатия. Настройки хранятся на устройстве, в облако и экспорт не входят.
   Это настройки, а не история: списка скачанных файлов здесь нет и не будет.
   Точка входа — window.DownloadFoldersTabMod.render(); my.js зовёт её из switchSettingsTab.
   =========================================================================== */
(function(){
  "use strict";

  var ROOT_ID = "dlFoldersRoot";
  var openFormats = {};     // какие списки форматов раскрыты (переживают перерисовку)
  var pendingNewRule = "";  // формат, который только что добавили и для которого ждём выбор папки
  var statusText = "";
  var statusCls = "";
  var replaceAsk = "";      // формат, для которого ждём подтверждения «Заменить правило?»

  function bridge(){
    var b = window.LifeTrackerNative;
    return (b && typeof b.downloadFoldersGet === "function" && typeof b.downloadFolderPick === "function") ? b : null;
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function readState(){
    var b = bridge(); if(!b) return null;
    try{ return JSON.parse(b.downloadFoldersGet() || "{}"); }catch(e){ return null; }
  }

  function ensureStyle(){
    if(document.getElementById("dlFoldersStyle")) return;
    var st = document.createElement("style");
    st.id = "dlFoldersStyle";
    st.textContent =
      ".dlf-intro{font-size:14px;color:var(--ink,#3b3350);margin:0 0 6px;line-height:1.4;}" +
      ".dlf-hint{font-size:12px;color:var(--ink-soft,#6a6080);margin:0 0 8px;line-height:1.35;}" +
      ".dlf-h{font-size:16px;font-weight:700;color:var(--ink,#3b3350);margin:16px 0 6px;}" +
      ".dlf-row{border:1px solid var(--wood,#8f7fb8);border-radius:12px;padding:10px 12px;margin:0 0 8px;background:var(--parchment,#f4f0f8);}" +
      ".dlf-row.off{opacity:.92;}" +
      ".dlf-top{display:flex;align-items:center;justify-content:space-between;gap:10px;}" +
      ".dlf-name{font-size:15px;font-weight:700;color:var(--ink,#3b3350);word-break:break-word;}" +
      ".dlf-switch{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink,#3b3350);flex-shrink:0;}" +
      ".dlf-switch input{width:22px;height:22px;accent-color:var(--wood,#8f7fb8);}" +
      ".dlf-folder{font-size:13px;color:var(--ink-soft,#6a6080);margin:4px 0 6px;word-break:break-word;}" +
      ".dlf-folder.bad{color:var(--status-err,#b0432e);}" +
      ".dlf-btns{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 0;}" +
      ".dlf-btn{font:inherit;font-size:13px;font-weight:600;padding:8px 10px;border-radius:10px;border:1px solid var(--wood,#8f7fb8);" +
      "background:var(--parchment,#f4f0f8);color:var(--wood-dark,#6a5a91);cursor:pointer;}" +
      ".dlf-btn.main{background:var(--wood,#8f7fb8);color:var(--parchment,#f4f0f8);}" +
      ".dlf-btn.danger{color:var(--status-err,#b0432e);border-color:var(--status-err,#b0432e);}" +
      ".dlf-fmts{font-size:12px;color:var(--ink-soft,#6a6080);margin:2px 0 4px;}" +
      ".dlf-fmts summary{cursor:pointer;}" +
      ".dlf-over{font-size:12px;color:var(--ink-soft,#6a6080);margin:2px 0 0;}" +
      ".dlf-add{display:flex;gap:6px;margin:8px 0 0;}" +
      ".dlf-add input{flex:1 1 auto;min-width:0;font:inherit;font-size:15px;padding:8px 10px;border-radius:10px;border:1px solid var(--wood,#8f7fb8);" +
      "background:#fff;color:var(--ink,#3b3350);}" +
      ".dlf-status{font-size:13px;line-height:1.35;min-height:18px;margin:6px 0 0;color:var(--ink-soft,#6a6080);}" +
      ".dlf-status.ok{color:var(--status-ok,#2fa15f);}" +
      ".dlf-status.err{color:var(--status-err,#b0432e);}";
    document.head.appendChild(st);
  }

  function setStatus(text, cls){
    statusText = text || "";
    statusCls = cls || "";
    var el = document.getElementById("dlFoldersStatus");
    if(el){ el.className = "dlf-status " + statusCls; el.textContent = statusText; }
  }

  function folderLine(it, isCat){
    if(!it.set) return '<div class="dlf-folder">' + (isCat ? "Загрузки (по умолчанию)" : "Папка не выбрана") + '</div>';
    if(it.ok === false) return '<div class="dlf-folder bad">' + esc(it.label) + ' — папка недоступна, файлы пойдут в «Загрузки»</div>';
    return '<div class="dlf-folder">Папка: ' + esc(it.label) + '</div>';
  }

  function catRow(c, st){
    var key = "cat:" + c.key;
    var h = '<div class="dlf-row' + (c.enabled ? "" : " off") + '" data-key="' + esc(key) + '">' +
      '<div class="dlf-top"><div class="dlf-name">' + esc(c.title) + '</div>' +
      '<label class="dlf-switch"><span>Включено</span><input type="checkbox" class="dlf-cb"' + (c.enabled ? " checked" : "") + (c.set ? "" : " disabled") + '></label></div>';
    if(c.key === "update"){
      h += '<div class="dlf-fmts">Копия скачанного обновления самого приложения (APK). Рабочая копия для установки остаётся в папке приложения; если тип не включён, в «Загрузках» ничего не остаётся.</div>';
    } else if(c.key === "other"){
      h += '<div class="dlf-fmts">Любой файл, который не подошёл ни под одно включённое правило выше.</div>';
    } else {
      h += '<details class="dlf-fmts" data-fmt="' + esc(c.key) + '"' + (openFormats[c.key] ? " open" : "") + '><summary>Форматы</summary>' + esc((c.formats || []).join(", ")) + '</details>';
    }
    h += folderLine(c, true);
    h += '<div class="dlf-btns"><button type="button" class="dlf-btn main" data-act="pick">Выбрать папку</button>';
    if(c.set) h += '<button type="button" class="dlf-btn" data-act="reset">Сбросить</button>';
    if(c.key === "music" && st.music && st.music.set) h += '<button type="button" class="dlf-btn" data-act="lib" data-lib="music">Взять папку из вкладки «Музыка»</button>';
    if(c.key === "pdf" && st.pdf && st.pdf.set) h += '<button type="button" class="dlf-btn" data-act="lib" data-lib="pdf">Взять папку из вкладки «PDF»</button>';
    h += '</div></div>';
    return h;
  }

  function ruleRow(r){
    var key = "rule:" + r.ext;
    var h = '<div class="dlf-row' + (r.enabled ? "" : " off") + '" data-key="' + esc(key) + '">' +
      '<div class="dlf-top"><div class="dlf-name">.' + esc(r.ext) + '</div>' +
      '<label class="dlf-switch"><span>Включено</span><input type="checkbox" class="dlf-cb"' + (r.enabled ? " checked" : "") + (r.set ? "" : " disabled") + '></label></div>';
    h += folderLine(r, false);
    if(r.overrides) h += '<div class="dlf-over">Перекрывает категорию «' + esc(r.overrides) + '»</div>';
    h += '<div class="dlf-btns"><button type="button" class="dlf-btn main" data-act="pick">Выбрать папку</button>';
    if(r.set) h += '<button type="button" class="dlf-btn" data-act="reset">Сбросить</button>';
    h += '<button type="button" class="dlf-btn danger" data-act="remove">Удалить</button></div></div>';
    return h;
  }

  function render(){
    var c = document.getElementById("settingsTabContent");
    if(!c) return;
    ensureStyle();
    var b = bridge();
    if(!b){
      c.innerHTML =
        '<h3 class="common-tab-title">Сохранение загрузок</h3>' +
        '<div class="mood-diagram-empty">Требуется обновить приложение. Вкладка «Сохранение загрузок» работает только в приложении (APK) с обновлённой оболочкой.</div>';
      return;
    }
    var st = readState();
    if(!st || !st.categories){
      c.innerHTML = '<h3 class="common-tab-title">Сохранение загрузок</h3><div class="mood-diagram-empty">Не удалось получить настройки.</div>';
      return;
    }
    var keepInput = "";
    var oldInput = document.getElementById("dlFoldersAddInput");
    if(oldInput) keepInput = oldInput.value;
    var rows = "";
    for(var i = 0; i < st.categories.length; i++) rows += catRow(st.categories[i], st);
    var rules = "";
    var rs = st.rules || [];
    for(var j = 0; j < rs.length; j++) rules += ruleRow(rs[j]);
    var replaceHtml = replaceAsk ?
      '<div class="dlf-hint">Формат «' + esc(replaceAsk) + '» уже есть. Заменить правило? Папку придётся выбрать заново.</div>' +
      '<div class="dlf-btns"><button type="button" class="dlf-btn main" data-act="replace-yes">Заменить</button><button type="button" class="dlf-btn" data-act="replace-no">Отмена</button></div>' : "";
    c.innerHTML =
      '<div id="' + ROOT_ID + '">' +
        '<h3 class="common-tab-title">Сохранение загрузок</h3>' +
        '<div class="dlf-intro">По умолчанию все файлы сохраняются в «Загрузки». Включите нужные типы и выберите папку.</div>' +
        '<div class="dlf-hint">Тип с включённой папкой работает так: файлы этого типа идут только в неё, в «Загрузки» не дублируются. ' +
          'Android 11 и новее не даёт выбрать саму папку «Загрузки» и корень памяти, но подпапки (например, «Загрузки/Книги») выбрать можно. ' +
          'Правила действуют на всё, что приложение сохраняет само: скачанные файлы, файлы со вкладок-инструментов (например, zip заметок), обновления.</div>' +
        rows +
        '<div class="dlf-h">Свои форматы</div>' +
        '<div class="dlf-hint">Формат → папка. Свои форматы главнее категорий; если подходит несколько правил, побеждает самое длинное окончание: ' +
          '«fb2.zip» главнее «zip». Значит, «zip» как свой формат заберёт и «книга.fb2.zip», пока нет правила «fb2.zip». ' +
          'Файл без расширения идёт в «Всё остальное» или в «Загрузки». Правил — не больше ' + esc(st.maxRules || 50) + '.</div>' +
        rules +
        '<div class="dlf-add"><input type="text" id="dlFoldersAddInput" maxlength="' + esc(st.maxFormatLen || 16) + '" placeholder="Формат, например zip или fb2.zip" autocomplete="off" autocapitalize="off" spellcheck="false">' +
          '<button type="button" class="dlf-btn main" data-act="add">Добавить формат</button></div>' +
        replaceHtml +
        '<div class="dlf-status ' + statusCls + '" id="dlFoldersStatus">' + esc(statusText) + '</div>' +
      '</div>';
    var inp = document.getElementById("dlFoldersAddInput");
    if(inp && keepInput) inp.value = keepInput;
    bind();
  }

  function keyOf(el){
    var row = el;
    while(row && !(row.getAttribute && row.getAttribute("data-key"))) row = row.parentNode;
    return row ? row.getAttribute("data-key") : "";
  }

  function addRule(replace){
    var b = bridge(); if(!b) return;
    var inp = document.getElementById("dlFoldersAddInput");
    var raw = replace ? replaceAsk : (inp ? inp.value : "");
    var res = null;
    try{ res = JSON.parse(b.downloadRuleAdd(raw, !!replace) || "{}"); }catch(e){ res = null; }
    if(!res){ setStatus("Не удалось добавить формат.", "err"); return; }
    if(!res.ok){
      if(res.exists){ replaceAsk = res.ext || ""; setStatus("", ""); render(); return; }
      setStatus(res.error || "Не удалось добавить формат.", "err");
      return;
    }
    replaceAsk = "";
    pendingNewRule = res.ext;
    if(inp) inp.value = "";
    setStatus("Формат «" + res.ext + "» добавлен. Выберите для него папку." + (res.overrides ? " Перекрывает категорию «" + res.overrides + "»." : ""), "ok");
    render();
    try{ b.downloadFolderPick("rule:" + res.ext); }catch(e){ setStatus("Не удалось открыть выбор папки.", "err"); }
  }

  function onClick(ev){
    var b = bridge(); if(!b) return;
    var t = ev.target;
    while(t && t.nodeType === 1 && !(t.getAttribute && t.getAttribute("data-act"))) t = t.parentNode;
    if(!t || t.nodeType !== 1) return;
    var act = t.getAttribute("data-act");
    var key = keyOf(t);
    if(act === "add"){ addRule(false); return; }
    if(act === "replace-yes"){ addRule(true); return; }
    if(act === "replace-no"){ replaceAsk = ""; setStatus("", ""); render(); return; }
    if(!key) return;
    if(act === "pick"){
      try{ b.downloadFolderPick(key); }catch(e){ setStatus("Не удалось открыть выбор папки.", "err"); }
    } else if(act === "reset"){
      try{ b.downloadFolderReset(key); }catch(e){}
      setStatus("Папка сброшена: файлы этого типа снова идут в «Загрузки».", "");
      render();
    } else if(act === "remove"){
      try{ b.downloadRuleRemove(key.replace(/^rule:/, "")); }catch(e){}
      setStatus("Формат удалён.", "");
      render();
    } else if(act === "lib"){
      var which = t.getAttribute("data-lib");
      var ok = false;
      try{ ok = !!b.downloadFolderUseLibrary(key, which); }catch(e){ ok = false; }
      if(ok) setStatus("Папка взята из вкладки «" + (which === "music" ? "Музыка" : "PDF") + "».", "ok");
      else setStatus("Не получилось: у папки вкладки «" + (which === "music" ? "Музыка" : "PDF") + "» нет права записи. Выберите папку кнопкой «Выбрать папку».", "err");
      render();
    }
  }

  function onChange(ev){
    var b = bridge(); if(!b) return;
    var t = ev.target;
    if(!t || !t.classList || !t.classList.contains("dlf-cb")) return;
    var key = keyOf(t);
    if(!key) return;
    try{ b.downloadFolderSetEnabled(key, !!t.checked); }catch(e){}
    render();
  }

  function onToggle(ev){
    var t = ev.target;
    if(t && t.getAttribute && t.getAttribute("data-fmt")) openFormats[t.getAttribute("data-fmt")] = !!t.open;
  }

  function bind(){
    var root = document.getElementById(ROOT_ID);
    if(!root) return;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("toggle", onToggle, true);
  }

  // Ответ оболочки после системного окна выбора папки: ключ записи и результат.
  window.__ltOnDownloadFolder = function(key, ok){
    var wasNew = pendingNewRule && key === "rule:" + pendingNewRule;
    if(wasNew){
      pendingNewRule = "";
      if(!ok){
        var b = bridge();
        try{ if(b) b.downloadRuleRemove(key.replace(/^rule:/, "")); }catch(e){}
        setStatus("Папка не выбрана — формат не добавлен.", "err");
      } else {
        setStatus("Готово: файлы этого формата пойдут в выбранную папку.", "ok");
      }
    } else if(ok){
      setStatus("Папка выбрана, тип включён: файлы этого типа идут только в неё.", "ok");
    } else {
      setStatus("Папка не выбрана или система не дала право записи в неё.", "err");
    }
    if(document.getElementById(ROOT_ID)) render();
  };

  // Вернулись в приложение (например, из файлового менеджера, где могли удалить папку) — перечитать, какие папки ещё доступны.
  document.addEventListener("visibilitychange", function(){
    if(!document.hidden && document.getElementById(ROOT_ID)) render();
  });

  window.DownloadFoldersTabMod = { render: render };
})();
