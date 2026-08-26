/* ===========================================================================
   epubsplit.js
   Вкладка "Разделение epub-файлов" (пятая боковая вкладка второго набора,
   settingsTabSet2Btn5 / "set2s_5"). Полностью в браузере (без сервера)
   конвертирует .epub в текст и делит его на несколько .txt-частей для
   использования как источников в NotebookLM — переносит и улучшает логику
   отдельного Python-скрипта (split_epub.py).

   Отличия от Python-версии (см. пояснения в коде ниже):
   - Порядок глав берём из spine в content.opf (реальный порядок чтения),
     а не из сортировки имён файлов — так текст идёт в правильной
     последовательности даже когда имена файлов не совпадают с порядком.
   - HTML разбираем через DOMParser (как и ZIP-читатель ниже — по тому же
     принципу, что и в jwlmerge.js), а не через regex — это заодно
     автоматически декодирует HTML-сущности (&nbsp;, &mdash; и т.п.) и
     чище убирает <script>/<style>.
   - Знаки препинания и кавычки не вырезаем — только схлопываем пробелы;
     текст остаётся пригодным для чтения и сохраняет структуру абзацев.
   - Делим не на равные КУСКИ ПРЕДЛОЖЕНИЙ, а балансируем по РАЗМЕРУ
     (символам): сначала пробуем не резать абзацы, и только очень большие
     абзацы (где нет внутренней разметки на <p>) режем по предложениям —
     так части получаются примерно одинакового размера, а не только с
     одинаковым числом предложений.
   - Число частей выбирает пользователь (2-8) в интерфейсе, а не жёстко
     зашитая шестёрка.
   =========================================================================== */

window.initEpubSplitModule = function(deps){
  "use strict";
  var escapeHtml = deps.escapeHtml;
  var PAPERCLIP_ICON_SVG = deps.PAPERCLIP_ICON_SVG;

  var PARTS_MIN = 2, PARTS_MAX = 8, PARTS_DEFAULT = 6;

  // ===================== ЧТЕНИЕ ZIP (.epub) =====================
  // Тот же общего вида читатель (STORED + DEFLATE через DecompressionStream),
  // что и в jwlmerge.js для .jwlibrary — своя копия здесь, чтобы модуль был
  // независим (jwlmerge ничего из этого не экспортирует наружу).

  function readZipCentralDirectory(bytes){
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocdOffset = -1;
    var scanFrom = Math.max(0, bytes.length - 65557);
    for(var i = bytes.length - 22; i >= scanFrom; i--){
      if(view.getUint32(i, true) === 0x06054b50){ eocdOffset = i; break; }
    }
    if(eocdOffset === -1) throw new Error("Файл не похож на .epub (не найден ZIP-заголовок)");
    var entryCount = view.getUint16(eocdOffset + 10, true);
    var centralOffset = view.getUint32(eocdOffset + 16, true);
    var decoder = new TextDecoder();
    var entries = [];
    var pos = centralOffset;
    for(var e = 0; e < entryCount; e++){
      if(view.getUint32(pos, true) !== 0x02014b50) break;
      var method = view.getUint16(pos + 10, true);
      var compSize = view.getUint32(pos + 20, true);
      var uncompSize = view.getUint32(pos + 24, true);
      var nameLen = view.getUint16(pos + 28, true);
      var extraLen = view.getUint16(pos + 30, true);
      var commentLen = view.getUint16(pos + 32, true);
      var localOffset = view.getUint32(pos + 42, true);
      var name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.push({name:name, method:method, compSize:compSize, uncompSize:uncompSize, localOffset:localOffset});
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function readZipEntryBytes(bytes, view, entry){
    var lNameLen = view.getUint16(entry.localOffset + 26, true);
    var lExtraLen = view.getUint16(entry.localOffset + 28, true);
    var dataStart = entry.localOffset + 30 + lNameLen + lExtraLen;
    var compBytes = bytes.subarray(dataStart, dataStart + entry.compSize);
    if(entry.method === 0) return Promise.resolve(compBytes);
    if(entry.method === 8 && typeof DecompressionStream !== "undefined"){
      var stream = new Response(compBytes).body.pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).arrayBuffer().then(function(buf){ return new Uint8Array(buf); });
    }
    return Promise.reject(new Error("Неподдерживаемый метод сжатия внутри .epub (" + entry.method + ")"));
  }

  function readAllZipEntries(arrayBuffer){
    var bytes = new Uint8Array(arrayBuffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var entries = readZipCentralDirectory(bytes);
    var result = {};
    return entries.reduce(function(chain, entry){
      return chain.then(function(){
        return readZipEntryBytes(bytes, view, entry).then(function(data){
          result[entry.name] = data;
        });
      });
    }, Promise.resolve()).then(function(){ return result; });
  }

  // ===================== РАЗБОР СТРУКТУРЫ EPUB (container.xml / .opf) =====================

  function findEntry(zipMap, path){
    // имена в epub иногда встречаются то с ведущим "/", то без — ищем без него
    var clean = path.replace(/^\/+/, "");
    if(zipMap[clean]) return zipMap[clean];
    if(zipMap["/" + clean]) return zipMap["/" + clean];
    var lower = clean.toLowerCase();
    var foundKey = Object.keys(zipMap).filter(function(k){ return k.replace(/^\/+/, "").toLowerCase() === lower; })[0];
    return foundKey ? zipMap[foundKey] : null;
  }

  function dirname(path){
    var i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  // склеивает путь opf-файла с относительной ссылкой из manifest/spine и
  // разворачивает "../"
  function resolveHref(baseDir, href){
    href = href.split("#")[0];
    try { href = decodeURIComponent(href); } catch(e){}
    var parts = (baseDir ? baseDir.split("/") : []).concat(href.split("/"));
    var out = [];
    parts.forEach(function(p){
      if(p === "" || p === ".") return;
      if(p === ".."){ out.pop(); return; }
      out.push(p);
    });
    return out.join("/");
  }

  function parseXml(text){
    return new DOMParser().parseFromString(text, "application/xml");
  }

  // Возвращает {opfPath, chapterPaths:[...], title, author}
  function parseEpubStructure(zipMap){
    var containerEntry = findEntry(zipMap, "META-INF/container.xml");
    if(!containerEntry) throw new Error("В .epub не найден META-INF/container.xml");
    var containerXml = parseXml(new TextDecoder().decode(containerEntry));
    var rootfileEl = containerXml.querySelector("rootfile");
    var opfPath = rootfileEl ? rootfileEl.getAttribute("full-path") : null;
    if(!opfPath) throw new Error("Не удалось найти путь к content.opf внутри .epub");

    var opfEntry = findEntry(zipMap, opfPath);
    if(!opfEntry) throw new Error("Не найден файл " + opfPath + " внутри .epub");
    var opfXml = parseXml(new TextDecoder().decode(opfEntry));
    var opfDir = dirname(opfPath);

    var manifestById = {};
    Array.prototype.forEach.call(opfXml.querySelectorAll("manifest > item"), function(item){
      var id = item.getAttribute("id");
      var href = item.getAttribute("href");
      if(id && href) manifestById[id] = href;
    });

    var chapterPaths = [];
    Array.prototype.forEach.call(opfXml.querySelectorAll("spine > itemref"), function(itemref){
      if(itemref.getAttribute("linear") === "no") return; // не часть основного текста (например, реклама/титул)
      var idref = itemref.getAttribute("idref");
      var href = idref ? manifestById[idref] : null;
      if(href) chapterPaths.push(resolveHref(opfDir, href));
    });

    if(!chapterPaths.length){
      // подстраховка на случай нестандартного epub без spine — берём все
      // xhtml/html файлы из манифеста в порядке их перечисления
      Object.keys(manifestById).forEach(function(id){
        var href = manifestById[id];
        if(/\.(xhtml|html|htm)$/i.test(href)) chapterPaths.push(resolveHref(opfDir, href));
      });
    }
    if(!chapterPaths.length) throw new Error("В .epub не найдено ни одной главы для извлечения текста");

    var title = textOf(opfXml, "dc\\:title, title");
    var author = textOf(opfXml, "dc\\:creator, creator");

    return {chapterPaths: chapterPaths, title: title, author: author};
  }

  function textOf(xmlDoc, selector){
    try {
      var el = xmlDoc.querySelector(selector);
      return el ? el.textContent.trim() : "";
    } catch(e){ return ""; }
  }

  // ===================== HTML -> ТЕКСТ С АБЗАЦАМИ =====================
  // Вставляем перенос строки после блочных тегов ДО разбора DOM — тогда
  // после чтения textContent абзацы остаются разделены, даже во
  // вложенной вёрстке. Сущности (&nbsp; и т.п.) декодирует сам DOMParser.

  var BLOCK_TAGS_RE = /<\/(p|div|h1|h2|h3|h4|h5|h6|li|blockquote|tr|section|article)>/gi;

  function findBody(doc){
    // ищем <body> независимо от namespace/префикса элементов
    var byTag = doc.getElementsByTagName("body")[0];
    if(byTag) return byTag;
    var all = doc.getElementsByTagName("*");
    for(var i = 0; i < all.length; i++){
      if(all[i].localName === "body") return all[i];
    }
    return doc.documentElement;
  }

  function htmlToText(rawHtml){
    var prepped = rawHtml
      .replace(/<br\b[^>]*\/?>/gi, "\n")
      .replace(BLOCK_TAGS_RE, function(m){ return m + "\n\n"; });

    // Главы epub — это XHTML, где самозакрывающиеся теги (например,
    // "<title/>") валидны только по правилам XML. Парсер "text/html" этого
    // не знает: <title> у него RCDATA-элемент, "/>" в нём не работает как
    // самозакрытие, и он поглощает весь остаток документа как текст
    // title в поисках "</title>", которого нет — весь текст главы
    // терялся (реальный баг, найденный на живой книге). Поэтому сначала
    // пробуем честный XML-разбор (там "/>" работает правильно), и только
    // если документ не well-formed, откатываемся на разбор как text/html.
    var doc = new DOMParser().parseFromString(prepped, "application/xhtml+xml");
    var isXmlError = doc.getElementsByTagName("parsererror").length > 0;
    if(isXmlError){
      doc = new DOMParser().parseFromString(prepped, "text/html");
    }

    var body = findBody(doc);
    if(body){
      Array.prototype.slice.call(body.querySelectorAll("script, style")).forEach(function(el){ el.parentNode.removeChild(el); });
    }
    var raw = body ? body.textContent : "";
    var lines = raw.split(/\n+/).map(function(l){
      return l.replace(/[ \t\u00A0]+/g, " ").trim();
    }).filter(function(l){ return l.length > 0; });
    return {text: lines.join("\n\n"), heading: firstHeading(doc)};
  }

  function firstHeading(doc){
    var h = doc.querySelector("h1, h2, h3");
    if(!h) return "";
    var t = h.textContent.replace(/\s+/g, " ").trim();
    return (t && t.length <= 120) ? t : "";
  }

  // ===================== EPUB -> ПОЛНЫЙ ТЕКСТ КНИГИ =====================

  function epubToText(arrayBuffer, onProgress){
    return readAllZipEntries(arrayBuffer).then(function(zipMap){
      var structure = parseEpubStructure(zipMap);
      var decoder = new TextDecoder("utf-8");
      var chapters = [];
      return structure.chapterPaths.reduce(function(chain, path, idx){
        return chain.then(function(){
          var entry = findEntry(zipMap, path);
          if(!entry) return; // пропускаем главу, если файл не найден (не должно случаться, но не роняем всё)
          var rawHtml = decoder.decode(entry);
          var parsed = htmlToText(rawHtml);
          if(parsed.text){
            chapters.push(parsed.heading ? ("## " + parsed.heading + "\n\n" + parsed.text) : parsed.text);
          }
          if(onProgress) onProgress(idx + 1, structure.chapterPaths.length);
        });
      }, Promise.resolve()).then(function(){
        var fullText = chapters.join("\n\n");
        if(!fullText.trim()) throw new Error("Не удалось извлечь текст из .epub");
        return {text: fullText, title: structure.title, author: structure.author};
      });
    });
  }

  // ===================== ДЕЛЕНИЕ ТЕКСТА НА N ЧАСТЕЙ =====================
  // Юниты — абзацы; очень большие абзацы (без внутренней разбивки на <p>)
  // дополнительно режем по предложениям, чтобы не тащить один гигантский
  // блок целиком в одну часть. sep — разделитель, который нужно поставить
  // ПЕРЕД юнитом при склейке (пусто для самого первого юнита части).

  var SENTENCE_SPLIT_RE = /(?<=[.!?…»"”])\s+(?=[A-ZА-ЯЁ«"„0-9])/;

  function buildUnits(fullText, targetSize){
    var paragraphs = fullText.split(/\n{2,}/).map(function(p){ return p.trim(); }).filter(Boolean);
    var units = [];
    paragraphs.forEach(function(p){
      if(p.length > targetSize * 1.5){
        var sentences = p.split(SENTENCE_SPLIT_RE).map(function(s){ return s.trim(); }).filter(Boolean);
        if(sentences.length <= 1){ units.push({text: p, sep: "\n\n"}); return; }
        sentences.forEach(function(s, i){ units.push({text: s, sep: i === 0 ? "\n\n" : " "}); });
      } else {
        units.push({text: p, sep: "\n\n"});
      }
    });
    return units;
  }

  function distributeUnits(units, numParts){
    var totalLen = units.reduce(function(s, u){ return s + u.text.length; }, 0);
    var effParts = Math.min(numParts, Math.max(1, units.length));
    var target = totalLen / effParts;
    var parts = [];
    var current = [];
    var currentLen = 0;
    var partsLeft = effParts;
    for(var i = 0; i < units.length; i++){
      var u = units[i];
      current.push(u);
      currentLen += u.text.length;
      var remainingUnits = units.length - i - 1;
      var remainingPartsAfterThis = partsLeft - 1;
      if(currentLen >= target && remainingPartsAfterThis > 0 && remainingUnits >= remainingPartsAfterThis){
        parts.push(current);
        current = [];
        currentLen = 0;
        partsLeft--;
      }
    }
    if(current.length) parts.push(current);
    return parts;
  }

  function unitsToText(unitList){
    return unitList.map(function(u, i){ return (i === 0 ? "" : u.sep) + u.text; }).join("");
  }

  function splitBookText(fullText, numParts){
    var approxTarget = fullText.length / numParts;
    var units = buildUnits(fullText, approxTarget);
    var parts = distributeUnits(units, numParts);
    return parts.map(unitsToText);
  }

  // ===================== ИМЕНА ФАЙЛОВ =====================

  function sanitizeFileName(name){
    return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // ===================== СКАЧИВАНИЕ =====================

  function downloadFile(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }

  function downloadAll(files){
    // несколько скачиваний подряд — с небольшой паузой между кликами,
    // иначе часть браузеров может молча заблокировать "спам" загрузок
    files.forEach(function(f, i){
      setTimeout(function(){ downloadFile(f.blob, f.name); }, i * 300);
    });
  }

  // ===================== ИКОНКА КНОПКИ ВЫБОРА ЧИСЛА ЧАСТЕЙ =====================
  // документ с пунктирной линией разреза посередине — та же идея, что и
  // ножницы на самой вкладке (см. #settingsTabSet2Btn5 в index.html)

  var SPLIT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path>' +
    '<path d="M15 3v4h4"></path>' +
    '<path d="M6.5 12.5h11" stroke-dasharray="2.4 2.4"></path>' +
    '<circle cx="6" cy="12.5" r="1.3" fill="currentColor" stroke="none"></circle>' +
    '<circle cx="18" cy="12.5" r="1.3" fill="currentColor" stroke="none"></circle>' +
    '</svg>';

  // ===================== ИНТЕРФЕЙС ВКЛАДКИ =====================

  function partsPickerHtml(current){
    var buttons = [];
    for(var n = PARTS_MIN; n <= PARTS_MAX; n++){
      buttons.push('<button type="button" data-parts="' + n + '"' + (n === current ? ' class="current"' : '') + '>' +
        '<span style="font-size:22px;font-weight:bold;">' + n + '</span></button>');
    }
    return '<div class="task-picker-grid">' + buttons.join("") + '</div>';
  }

  function renderSettingsTabEpubSplit(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var selectedFile = null;
    var partsCount = PARTS_DEFAULT;
    var resultFiles = null; // [{blob, name, size}]

    // Порядок сверху вниз: выбор файла/числа частей, затем статус и
    // информация об извлечённых файлах, и только в самом низу — обе
    // кнопки рядом ("Начать" + "Скачать"), как в "Объединении заметок"
    // (.workbooks-actions-row/.workbooks-run-btn/.workbooks-download-btn).
    // Кнопки специально идут ПОСЛЕ статуса/списка файлов, а не перед —
    // чтобы после запуска не приходилось тянуться наверх экрана: обе
    // кнопки всегда рядом внизу вкладки.
    container.innerHTML =
      '<div class="settings-content-bottom">' +
        '<div class="workbooks-title">Разделение epub-файлов</div>' +
        '<p style="opacity:.7;font-size:.9em;margin-top:2px;">Извлечёт текст из книги в формате .epub и разделит его на несколько .txt-файлов (по границам абзацев/предложений, без разрыва внутри них) — удобно грузить по частям как источники в NotebookLM.</p>' +
        '<p style="margin-bottom:4px;">Файл и число частей</p>' +
        '<div class="task-import-file-row">' +
          '<button type="button" class="task-import-attach-btn" id="epubSplitAttachBtn" title="Прикрепить файл">' + PAPERCLIP_ICON_SVG + '</button>' +
          '<button type="button" class="task-import-attach-btn" id="epubSplitPartsBtn" title="Число частей">' + SPLIT_ICON_SVG + '</button>' +
          '<span id="epubSplitFileName" class="task-import-file-name">Файл не выбран, частей: ' + PARTS_DEFAULT + '</span>' +
        '</div>' +
        '<input type="file" accept=".epub" id="epubSplitFileInput" style="display:none;">' +
        '<div id="epubSplitPartsPicker" style="display:none;margin-top:10px;">' + partsPickerHtml(partsCount) + '</div>' +
        '<div id="epubSplitStatus" style="margin-top:14px;"></div>' +
        '<div id="epubSplitFilesList" style="margin-top:8px;"></div>' +
        '<div class="workbooks-actions-row">' +
          '<button class="workbooks-run-btn" id="epubSplitStartBtn" disabled>Начать</button>' +
          '<button class="workbooks-result-btn workbooks-download-btn" id="epubSplitSaveBtn" disabled>Скачать</button>' +
        '</div>' +
      '</div>';

    var attachBtn = document.getElementById("epubSplitAttachBtn");
    var partsBtn = document.getElementById("epubSplitPartsBtn");
    var fileInput = document.getElementById("epubSplitFileInput");
    var fileNameEl = document.getElementById("epubSplitFileName");
    var partsPickerEl = document.getElementById("epubSplitPartsPicker");
    var startBtn = document.getElementById("epubSplitStartBtn");
    var saveBtn = document.getElementById("epubSplitSaveBtn");
    var statusEl = document.getElementById("epubSplitStatus");
    var filesListEl = document.getElementById("epubSplitFilesList");

    function refreshLabel(){
      fileNameEl.textContent = (selectedFile ? selectedFile.name : "Файл не выбран") + ", частей: " + partsCount;
    }
    function refreshStartEnabled(){
      startBtn.disabled = !selectedFile;
    }
    // "Скачать" рядом с "Начать" — активна (залита, класс "ready", тот
    // же вид, что и у "Начать") только когда результат уже готов; тот
    // же приём, что и у jwlMergeSaveBtn/workbooksDownloadBtn.
    function refreshSaveEnabled(){
      saveBtn.disabled = !resultFiles;
      saveBtn.classList.toggle("ready", !!resultFiles);
    }

    attachBtn.addEventListener("click", function(){ fileInput.click(); });
    fileInput.addEventListener("change", function(){
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      resultFiles = null;
      filesListEl.innerHTML = "";
      statusEl.innerHTML = "";
      refreshLabel();
      refreshStartEnabled();
      refreshSaveEnabled();
    });

    partsBtn.addEventListener("click", function(){
      partsPickerEl.style.display = (partsPickerEl.style.display === "none") ? "" : "none";
    });
    Array.prototype.forEach.call(partsPickerEl.querySelectorAll("[data-parts]"), function(btn){
      btn.addEventListener("click", function(){
        partsCount = parseInt(btn.getAttribute("data-parts"), 10);
        Array.prototype.forEach.call(partsPickerEl.querySelectorAll("[data-parts]"), function(b){
          b.classList.toggle("current", b === btn);
        });
        refreshLabel();
        partsPickerEl.style.display = "none";
      });
    });

    startBtn.addEventListener("click", function(){
      if(!selectedFile) return;
      startBtn.disabled = true;
      resultFiles = null;
      filesListEl.innerHTML = "";
      refreshSaveEnabled();
      statusEl.innerHTML = '<div class="mood-diagram-empty">Извлекаем текст из книги…</div>';

      selectedFile.arrayBuffer().then(function(buf){
        return epubToText(buf, function(done, total){
          statusEl.innerHTML = '<div class="mood-diagram-empty">Извлекаем текст из книги… (' + done + ' из ' + total + ')</div>';
        });
      }).then(function(book){
        statusEl.innerHTML = '<div class="mood-diagram-empty">Делим на ' + partsCount + ' части…</div>';
        var baseName = sanitizeFileName(book.title || selectedFile.name.replace(/\.epub$/i, ""));
        var parts = splitBookText(book.text, partsCount);
        resultFiles = parts.map(function(partText, i){
          var blob = new Blob([partText], {type: "text/plain;charset=utf-8"});
          return {blob: blob, name: baseName + "_part" + (i + 1) + ".txt", size: blob.size};
        });
        statusEl.innerHTML = '<div class="workbooks-status-ok">Готово: ' + resultFiles.length + ' файл(ов), исходный текст — ' + book.text.length + ' символов</div>';
        filesListEl.innerHTML = resultFiles.map(function(f){
          return '<div style="opacity:.8;font-size:.85em;">' + escapeHtml(f.name) + ' — ' + Math.round(f.size / 1024) + ' КБ</div>';
        }).join("");
        refreshStartEnabled();
        refreshSaveEnabled();
      }).catch(function(err){
        console.error("epubsplit:", err);
        statusEl.innerHTML = '<div class="workbooks-status-err">Не удалось обработать файл: ' +
          escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
        refreshStartEnabled();
        refreshSaveEnabled();
      });
    });

    saveBtn.addEventListener("click", function(){
      if(resultFiles && resultFiles.length) downloadAll(resultFiles);
    });
  }

  return {
    renderSettingsTabEpubSplit: renderSettingsTabEpubSplit
  };
};
