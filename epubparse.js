/* ===========================================================================
   epubparse.js
   Разбор .epub (zip-архив с XHTML-главами внутри) в ТОЧНО ТАКУЮ ЖЕ
   структуру глав -> абзацев (с полужирным/курсивом) -> изображений, что и
   fb2parse.js — так весь экран чтения книги в my.js (renderRunsHtml,
   renderBookReaderText, закладки, подчёркивания, иллюстрации) работает
   одинаково для обоих форматов и не завязан на конкретный формат файла
   (см. parseBookBuffer в my.js — единственное место, которое знает про
   разницу между .fb2 и .epub).

   Как и fb2parse.js/docxparse.js, разбор XML/XHTML идёт регулярными
   выражениями, а не через DOMParser — тестируется в Node, ведёт себя в
   браузере так же. Отличие от epubsplit.js (там тоже читается .epub, но
   через DOMParser и ради плоского текста для NotebookLM, не ради
   структуры для ридера) — здесь сознательно нет ни одной зависимости от
   браузерных DOM-парсеров.

   Раз в тексте книги в HTML — своя, более широкая, чем у XML, реальная
   практика именованных сущностей (&nbsp; &mdash; &hellip; и т.п.) —
   decodeEntities ниже, в отличие от decodeXmlEntities из fb2parse.js,
   дополнительно раскрывает небольшую таблицу распространённых именованных
   HTML-сущностей (см. HTML_NAMED_ENTITIES). Сама MiniZip.decodeXmlEntities
   переиспользуется как есть — точка сопровождения одна для всего проекта.

   Zip читается через MiniZip.extractAllFiles (minizip.js) — тот же общий
   читатель, что и для .docx/.jwlibrary/произвольных архивов книг/картинок
   в my.js/mdeditor.js, своей копии ZIP-ридера здесь не заводится.

   Сложные и редкие случаи разметки сознательно не разбираются (тот же
   принцип, что заявлен в шапке fb2parse.js — "достаточно основного текста,
   базового форматирования, разбиения на абзацы и картинок"):
   - текстовым блоком считается <p>/<h1..h6>, а также <li>/<blockquote>
     БЕЗ вложенного <p> внутри (если внутри есть свой <p> — берём именно
     его, чтобы не задвоить текст, см. extractContainerTextBlocks);
   - голый текст внутри <div>/<span> без обёртки в один из этих тегов не
     попадает ни в один блок и теряется — на практике так устроены
     единичные "кривые" epub, подавляющее большинство книг оборачивает
     текст в <p>;
   - инлайн-теги, кроме b/strong (жирный) и i/em (курсив), — текст
     сохраняется, собственное оформление тега теряется (a/span/sup/sub/
     small/font/code/u/abbr/cite), <br> внутри абзаца игнорируется как
     разметка (тот же приём, что <empty-line/> в fb2parse.js);
   - нет разбора оглавления (.ncx/nav.xhtml) как отдельной структуры —
     порядок и состав глав берутся из <spine> в .opf (реальный порядок
     чтения), заголовок главы — первый попавшийся h1..h6 внутри неё
     (изымается из потока абзацев, чтобы не показывался дважды — тем же
     приёмом, что extractSectionTitle в fb2parse.js для <title> секции).

   Экспортирует EpubParse.parseEpub(zipData) -> Promise<{ chapters, images,
   title, author }>

   chapters/images — ТОТ ЖЕ формат, что у Fb2Parse.parseFb2 (см. шапку
   fb2parse.js): chapters: {id:null, index, title, blocks}[], blocks —
   {type:"paragraph", runs:{text,bold,italic}[]} | {type:"image", imageId},
   images: {[id]: {contentType, base64}}. id у epub-глав всегда null (в
   fb2 это id атрибута <section>, аналога у epub-документа нет и текущий
   код ридера в my.js его не использует — только числовой index/{ch,blk}).
   imageId у ImageBlock — путь к файлу картинки ВНУТРИ zip-архива epub,
   уже развёрнутый (без "../", без ведущего "/") — тот же путь, под которым
   картинка лежит ключом в images.

   title/author — доп. поля (из <dc:title>/<dc:creator> в .opf), которых
   нет у parseFb2 — вызывающий код в my.js их не читает, добавлены на
   будущее (например, разумное имя файла при переименовании книги).
   =========================================================================== */

(function (global) {
  "use strict";

  var MiniZip = global.MiniZip;
  function decodeXmlEntities(s) {
    if (MiniZip && MiniZip.decodeXmlEntities) return MiniZip.decodeXmlEntities(s);
    // Не должно происходить при обычной загрузке (minizip.js идёт раньше
    // epubparse.js в index.html/sw.js ASSETS) - но не роняем модуль совсем
    // без объяснения причины.
    throw new Error("EpubParse: MiniZip.decodeXmlEntities недоступен - minizip.js должен быть загружен раньше epubparse.js");
  }

  // Небольшая таблица именованных HTML-сущностей, которых нет среди пяти
  // базовых XML-сущностей (amp/lt/gt/quot/apos, их и числовые &#NN;/&#xHH;
  // уже разворачивает decodeXmlEntities выше) - но которые реально
  // встречаются в тексте книг без собственного DOCTYPE-объявления.
  // Список сознательно ограничен типографикой/пунктуацией, а не полной
  // таблицей HTML5 (~2000 сущностей) - её незачем тащить ради книжного
  // текста. Незнакомая сущность просто остаётся как есть (с "&...;"),
  // не бросает ошибку.
  var HTML_NAMED_ENTITIES = {
    nbsp: "\u00A0", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
    laquo: "\u00AB", raquo: "\u00BB", ldquo: "\u201C", rdquo: "\u201D",
    lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201A", bdquo: "\u201E",
    copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
    deg: "\u00B0", plusmn: "\u00B1", times: "\u00D7", divide: "\u00F7",
    sect: "\u00A7", para: "\u00B6", middot: "\u00B7", bull: "\u2022",
    dagger: "\u2020", Dagger: "\u2021", permil: "\u2030",
    euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2",
    frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
    shy: "", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009"
  };
  function decodeEntities(s) {
    var base = decodeXmlEntities(s);
    return base.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, function (full, name) {
      return HTML_NAMED_ENTITIES.hasOwnProperty(name) ? HTML_NAMED_ENTITIES[name] : full;
    });
  }

  // ===================== ПУТИ ВНУТРИ АРХИВА =====================

  function dirname(path) {
    var i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  // Склеивает путь-базу (папку файла, из которого пришла ссылка) со
  // значением href/src и разворачивает "../" - тот же приём, что и в
  // epubsplit.js (там - для другой цели, разбора epub в плоский текст;
  // здесь - своя независимая копия, epubsplit.js ничего из этого не
  // экспортирует наружу).
  function resolveHref(baseDir, href) {
    href = href.split("#")[0];
    try { href = decodeURIComponent(href); } catch (e) {}
    var parts = (baseDir ? baseDir.split("/") : []).concat(href.split("/"));
    var out = [];
    parts.forEach(function (p) {
      if (p === "" || p === ".") return;
      if (p === "..") { out.pop(); return; }
      out.push(p);
    });
    return out.join("/");
  }

  // Карта путь->байты из результата MiniZip.extractAllFiles, плюс поиск с
  // подстраховкой на ведущий "/" и регистр имени (некоторые epub-паковщики
  // расходятся с manifest по регистру расширения и т.п.).
  function buildFileMap(files) {
    var map = {};
    files.forEach(function (f) { map[f.path.replace(/^\/+/, "")] = f.data; });
    return map;
  }
  function findFile(fileMap, path) {
    var clean = path.replace(/^\/+/, "");
    if (fileMap.hasOwnProperty(clean)) return fileMap[clean];
    var lower = clean.toLowerCase();
    var foundKey = Object.keys(fileMap).filter(function (k) { return k.toLowerCase() === lower; })[0];
    return foundKey ? fileMap[foundKey] : null;
  }

  // ===================== РАЗБОР XML РЕГЭКСПАМИ =====================
  // Тот же приём, что extractTagBlocks в fb2parse.js/extractBlocksWithAttrs
  // в docxparse.js (счётчик глубины по открывающим/закрывающим тегам
  // одного имени) - расширен поддержкой самозакрывающегося варианта
  // <tag ... /> на верхнем уровне (в fb2/docx это не нужно было - там
  // пустой абзац всегда пишется как <p></p>, а в HTML тот же пустой
  // абзац нередко встречается как <p/>).
  function extractTagBlocks(xml, tagName) {
    var blocks = [];
    var re = new RegExp(
      "<" + tagName + "(?:\\s[^>]*)?/>|<" + tagName + "(?:\\s[^>]*)?>|</" + tagName + ">",
      "g"
    );
    var depth = 0, start = -1, m;
    while ((m = re.exec(xml))) {
      if (m[0].slice(-2) === "/>") {
        if (depth === 0) blocks.push({ start: m.index, end: re.lastIndex, xml: m[0] });
        continue;
      }
      if (m[0] === "</" + tagName + ">") {
        depth--;
        if (depth === 0 && start >= 0) {
          blocks.push({ start: start, end: re.lastIndex, xml: xml.slice(start, re.lastIndex) });
          start = -1;
        }
      } else {
        if (depth === 0) start = m.index;
        depth++;
      }
    }
    return blocks;
  }

  function stripOuterTag(blockXml) {
    if (blockXml.slice(-2) === "/>") return ""; // самозакрывающийся тег - пустое содержимое по определению
    var start = blockXml.indexOf(">") + 1;
    var end = blockXml.lastIndexOf("<");
    return end > start ? blockXml.slice(start, end) : "";
  }

  function parseAttrs(attrStr) {
    var attrs = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(attrStr))) attrs[m[1]] = decodeEntities(m[2]);
    return attrs;
  }

  // <item .../> / <itemref .../> в .opf - всегда пустые элементы (без
  // собственного текстового содержимого), обычно пишутся самозакрывающимися,
  // изредка - парой <tag ...></tag>; в обоих случаях нужны только атрибуты
  // открывающего тега.
  function extractEmptyElements(xml, tagName) {
    var out = [], re = new RegExp("<" + tagName + "\\b([^>]*?)/?>", "g"), m;
    while ((m = re.exec(xml))) out.push(parseAttrs(m[1]));
    return out;
  }

  function firstElementText(xml, tagName) {
    var re = new RegExp("<" + tagName + "\\b[^>]*>([\\s\\S]*?)</" + tagName + ">", "i");
    var m = re.exec(xml);
    if (!m) return "";
    return decodeEntities(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  }

  // ===================== СТРУКТУРА КНИГИ (container.xml / .opf) =====================

  function findOpfPath(containerXmlText) {
    var m = /<rootfile\b[^>]*\bfull-path\s*=\s*"([^"]+)"/i.exec(containerXmlText);
    if (!m) throw new Error("В .epub не найден путь к content.opf (META-INF/container.xml)");
    return m[1];
  }

  // Возвращает {opfDir, chapterPaths, imageEntries, title, author}.
  function parseOpfStructure(opfXml, opfPath) {
    var opfDir = dirname(opfPath);

    var manifestById = {};
    extractEmptyElements(opfXml, "item").forEach(function (it) {
      if (it.id && it.href) manifestById[it.id] = { href: it.href, mediaType: it["media-type"] || "" };
    });

    var chapterIds = [];
    extractEmptyElements(opfXml, "itemref").forEach(function (sp) {
      if (sp.linear === "no") return; // не часть основного текста (см. epubsplit.js - тот же принцип)
      if (sp.idref) chapterIds.push(sp.idref);
    });
    if (!chapterIds.length) {
      // подстраховка на случай нестандартного epub без spine - берём все
      // xhtml/html файлы манифеста в порядке перечисления (тот же приём,
      // что и в epubsplit.js)
      Object.keys(manifestById).forEach(function (id) {
        if (/\.(xhtml|html|htm)$/i.test(manifestById[id].href)) chapterIds.push(id);
      });
    }
    var chapterPaths = chapterIds.map(function (id) {
      var it = manifestById[id];
      return it ? resolveHref(opfDir, it.href) : null;
    }).filter(Boolean);
    if (!chapterPaths.length) throw new Error("В .epub не найдено ни одной главы (пуст spine и manifest)");

    var imageEntries = [];
    Object.keys(manifestById).forEach(function (id) {
      var it = manifestById[id];
      if (it.mediaType && it.mediaType.indexOf("image/") === 0) {
        imageEntries.push({ path: resolveHref(opfDir, it.href), contentType: it.mediaType });
      }
    });

    var title = firstElementText(opfXml, "dc:title") || firstElementText(opfXml, "title");
    var author = firstElementText(opfXml, "dc:creator") || firstElementText(opfXml, "creator");

    return { opfDir: opfDir, chapterPaths: chapterPaths, imageEntries: imageEntries, title: title, author: author };
  }

  // ===================== КАРТИНКИ =====================

  // Uint8Array -> base64, кусками (иначе String.fromCharCode.apply на
  // большом изображении может упереться в лимит аргументов движка).
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000, binary = "";
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function buildImagesMap(fileMap, imageEntries) {
    var images = {};
    imageEntries.forEach(function (entry) {
      var data = findFile(fileMap, entry.path);
      if (!data) return; // файл из manifest не нашёлся в архиве - пропускаем молча, как и отсутствующую главу ниже
      images[entry.path] = { contentType: entry.contentType || "image/jpeg", base64: bytesToBase64(data) };
    });
    return images;
  }

  // ===================== ТЕКСТ ГЛАВЫ (XHTML -> runs/blocks) =====================

  var INLINE_TAGS_RE = "(b|strong|i|em|a|span|sup|sub|small|font|code|u|abbr|cite)";

  function paragraphRuns(innerXml) {
    var runs = [];
    var boldDepth = 0, italicDepth = 0;
    var buf = "";
    function flush() {
      if (buf) {
        runs.push({ text: decodeEntities(buf), bold: boldDepth > 0, italic: italicDepth > 0 });
        buf = "";
      }
    }
    var tokenRe = new RegExp("<(\\/)?" + INLINE_TAGS_RE + "(?:\\s[^>]*)?>|<br\\s*\\/?>|([^<]+)", "gi");
    var m;
    while ((m = tokenRe.exec(innerXml))) {
      if (m[3] !== undefined) { buf += m[3]; continue; }
      if (m[0].charAt(1) === "b" && m[0].charAt(2) === "r") continue; // <br> / <br/> - перенос строки внутри абзаца, игнорируем как разметку
      var closing = !!m[1], tag = (m[2] || "").toLowerCase();
      if (tag === "b" || tag === "strong" || tag === "i" || tag === "em") {
        flush();
        if (tag === "b" || tag === "strong") boldDepth += closing ? -1 : 1;
        else italicDepth += closing ? -1 : 1;
        if (boldDepth < 0) boldDepth = 0;
        if (italicDepth < 0) italicDepth = 0;
      }
      // остальные инлайн-теги (a/span/sup/sub/small/font/code/u/abbr/cite) -
      // текст сохраняется, своё оформление тегов теряется (см. шапку файла)
    }
    flush();
    return runs;
  }

  // <img src="..."> (обычно самозакрывающийся, но встречается и без "/") и
  // <image xlink:href="..."/> (SVG-обёртка, epub3 fixed-layout) - в одном
  // проходе, тем же приёмом, что extractImageBlocks в fb2parse.js.
  function extractImageRefBlocks(xml) {
    var blocks = [];
    var re = /<img\b[^>]*?\/?>|<image\b[^>]*?(?:\/>|>[\s\S]*?<\/image>)/gi;
    var m;
    while ((m = re.exec(xml))) {
      var hrefMatch = /\b(?:src|xlink:href|href)\s*=\s*"([^"]+)"/i.exec(m[0]);
      blocks.push({ start: m.index, end: re.lastIndex, href: hrefMatch ? hrefMatch[1] : null });
    }
    return blocks;
  }

  // <li>/<blockquote> - текстовый блок, ТОЛЬКО если внутри него нет своего
  // <p> (иначе текст задвоился бы: и как содержимое li/blockquote, и как
  // отдельный вложенный p, см. шапку файла).
  function extractContainerTextBlocks(xml, tagName) {
    var out = [];
    extractTagBlocks(xml, tagName).forEach(function (b) {
      var inner = stripOuterTag(b.xml);
      if (extractTagBlocks(inner, "p").length) return;
      out.push(b);
    });
    return out;
  }

  var TEXT_BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6"];
  var CONTAINER_TEXT_TAGS = ["li", "blockquote"];

  // Содержимое <body> (без заголовка главы - см. extractChapterTitle ниже,
  // вызывается уже на "остатке") -> Block[], в порядке следования по
  // документу - тот же приём слияния+сортировки по позиции, что
  // parseBlocksFromXml в fb2parse.js.
  function extractBodyBlocks(xml) {
    var combined = [];
    TEXT_BLOCK_TAGS.forEach(function (tag) {
      extractTagBlocks(xml, tag).forEach(function (b) { combined.push({ start: b.start, kind: "text", xml: b.xml }); });
    });
    CONTAINER_TEXT_TAGS.forEach(function (tag) {
      extractContainerTextBlocks(xml, tag).forEach(function (b) { combined.push({ start: b.start, kind: "text", xml: b.xml }); });
    });
    extractImageRefBlocks(xml).forEach(function (b) { combined.push({ start: b.start, kind: "image", href: b.href }); });
    combined.sort(function (a, b) { return a.start - b.start; });

    // Абзацы-«навигация» (class содержит "navigation", например хлебные крошки «Бытие 3 : 1 - 24» со ссылками в
    // epub «Перевод Нового мира») - это не текст книги, а ссылки на соседние страницы; в ридере они только мешают.
    combined = combined.filter(function (item) {
      if (item.kind !== "text") return true;
      var open = /^<[a-z0-9]+\b[^>]*>/i.exec(item.xml);
      return !(open && /\bclass\s*=\s*"[^"]*navigation[^"]*"/i.test(open[0]));
    });

    var blocks = combined.map(function (item) {
      if (item.kind === "image") return { type: "image", imageId: item.href || null };
      return { type: "paragraph", runs: paragraphRuns(stripOuterTag(item.xml)) };
    });

    // Пустые абзацы (без единого непробельного символа) не несут читаемого
    // содержимого - выбрасываем, тем же приёмом, что и fb2parse.js.
    return blocks.filter(function (block) {
      if (block.type !== "paragraph") return true;
      return block.runs.some(function (r) { return r.text.trim().length > 0; });
    });
  }

  function findBodyXml(xml) {
    var blocks = extractTagBlocks(xml, "body");
    return blocks.length ? stripOuterTag(blocks[0].xml) : xml; // без <body> - редкость, разбираем как есть
  }

  // Первый h1..h6 внутри тела главы -> {title, rest} (rest - тело БЕЗ этого
  // заголовка, чтобы он не попал в blocks как обычный абзац) - тот же
  // приём, что extractSectionTitle в fb2parse.js для <title> секции.
  function extractChapterTitle(bodyXml) {
    var m = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(bodyXml);
    if (!m) return { title: "", rest: bodyXml };
    var text = decodeEntities(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    var rest = bodyXml.slice(0, m.index) + bodyXml.slice(m.index + m[0].length);
    return { title: (text && text.length <= 200) ? text : "", rest: rest };
  }

  // <title> документа (в <head>): запасное имя главы, когда в теле нет заголовка h1..h6 (в epub «Перевод Нового мира»
  // каждая глава Библии - отдельный файл без заголовка, но с <title>Бытие 3</title>).
  function extractDocTitle(rawXhtml) {
    var m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(rawXhtml);
    if (!m) return "";
    var t = decodeEntities(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    return t.length <= 200 ? t : "";
  }

  // Библейская глава в epub «Перевод Нового мира»: абзац class="w_navigation w_biblebookname" со ссылками «книга», «глава»,
  // «стихи» (<a>Бытие</a> <a>3</a> : <a>1 - 24</a>; у книг из одной главы второй ссылки-номера нет). -> {b: "Бытие", n: 3} | null.
  // Нужен ридеру, чтобы показать главы этой книги квадратиками с номерами (my.js, renderBookReaderChapters).
  function extractBibleRef(bodyXml) {
    var m = /<p\b[^>]*class\s*=\s*"[^"]*\bw_biblebookname\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(bodyXml);
    if (!m) return null;
    var links = [], re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi, a;
    while ((a = re.exec(m[1]))) links.push(decodeEntities(a[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim());
    if (!links.length || !links[0]) return null;
    var n = links.length > 1 && /^\d+$/.test(links[1]) ? parseInt(links[1], 10) : 1;
    return { b: links[0], n: n };
  }

  function parseChapterXhtml(rawXhtml) {
    var bodyXml = findBodyXml(rawXhtml);
    var titleResult = extractChapterTitle(bodyXml);
    var blocks = extractBodyBlocks(titleResult.rest);
    // Страница навигации: нет ни текста, ни картинок, зато есть ссылки (оглавление, таблицы «книга/глава/стих»). Их сотни
    // в таких книгах (у Библии - 1252), и в «Главах» и в тексте они выглядели как пустые «главы». Здесь только помечаем.
    var navLike = !blocks.length && (bodyXml.match(/<a\b/gi) || []).length >= 2;
    return { title: titleResult.title, docTitle: extractDocTitle(rawXhtml), blocks: blocks, navLike: navLike, bk: extractBibleRef(bodyXml) };
  }

  // epub, в отличие от fb2 (произвольная кодировка, см. decodeFb2Buffer в
  // my.js), по стандарту OCF/OPF всегда utf-8 - собственного разбора
  // кодировки не требуется.
  function decodeXhtmlBytes(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  // Имя главы без заголовка в теле - <title> документа, если он не общий для книги: совпадающий у нескольких глав (или с
  // названием всей книги) <title> ничего не говорит. Заголовок, повторяющийся у многих глав («КРАТКОЕ СОДЕРЖАНИЕ» у каждой
  // книги Библии), заменяется на уникальный <title> («Исход. Краткое содержание»). Уникальный заголовок остаётся как есть.
  function applyDocTitles(chapters, bookTitle) {
    var docCount = {}, headCount = {};
    chapters.forEach(function (c) {
      if (c._docTitle) docCount[c._docTitle] = (docCount[c._docTitle] || 0) + 1;
      if (c.title) headCount[c.title] = (headCount[c.title] || 0) + 1;
    });
    chapters.forEach(function (c) {
      var d = c._docTitle;
      delete c._docTitle;
      if (c.nav || !d || docCount[d] !== 1 || d === bookTitle) return;
      if (!c.title || headCount[c.title] > 1) c.title = d;
    });
  }

  // ===================== КАРТИНКИ ПО ТРЕБОВАНИЮ =====================
  // Раньше картинки ВСЕХ глав распаковывались и кодировались в base64 при открытии книги (у иллюстрированной книги — сотни
  // мегабайт работы ради картинок, до которых читатель, возможно, так и не долистает). Теперь images[путь] — объект с тем же
  // контрактом {contentType, base64}, но base64 это ленивое свойство: байты картинки достаются из архива и кодируются только
  // при первом обращении (результат запоминается). Читающий код (my.js) этого не замечает.
  function makeLazyImages(archive, imageEntries) {
    var images = {};
    imageEntries.forEach(function (entry) {
      if (!archive.has(entry.path)) return; // файл из manifest не нашёлся в архиве - пропускаем молча, как и раньше
      var cached = null;
      var img = { contentType: entry.contentType || "image/jpeg" };
      Object.defineProperty(img, "base64", {
        enumerable: true, configurable: true,
        get: function () {
          if (cached === null) {
            var data = archive.readBytesSync(entry.path);
            cached = data ? bytesToBase64(data) : "";
          }
          return cached;
        }
      });
      images[entry.path] = img;
    });
    return images;
  }

  // ===================== ОСНОВНАЯ ФУНКЦИЯ =====================

  // Версия формата результата для кэша разобранных книг (my.js): при любом изменении разбора глав — увеличить, и старые
  // записи кэша перестанут подходить.
  var PARSER_VERSION = 4;

  function nextTick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // Разбор глав порциями: после каждых ~12 мс работы отдаём поток браузеру, чтобы разбор большой книги не «замораживал»
  // интерфейс (раньше все главы разбирались одним синхронным циклом).
  async function parseEpub(zipData) {
    var bytes = zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData);
    if (!MiniZip || !MiniZip.openArchive) {
      throw new Error("EpubParse: MiniZip.openArchive недоступен - minizip.js должен быть загружен раньше epubparse.js");
    }
    var archive = MiniZip.openArchive(bytes);

    var containerBytes = await archive.readBytes("META-INF/container.xml");
    if (!containerBytes) throw new Error("В .epub не найден META-INF/container.xml - файл повреждён или это не epub.");
    var opfPath = findOpfPath(new TextDecoder("utf-8").decode(containerBytes));

    var opfBytes = await archive.readBytes(opfPath);
    if (!opfBytes) throw new Error("В .epub не найден файл " + opfPath);
    var structure = parseOpfStructure(new TextDecoder("utf-8").decode(opfBytes), opfPath);

    var imageEntries = structure.imageEntries.filter(function (e) { return archive.has(e.path); });
    var images = makeLazyImages(archive, imageEntries);

    var chapters = [];
    var paths = structure.chapterPaths;
    var BATCH = 24, sliceStart = performance.now();
    for (var i = 0; i < paths.length; i += BATCH) {
      var batch = paths.slice(i, i + BATCH);
      var datas = await Promise.all(batch.map(function (p) { return archive.readBytes(p); }));
      for (var j = 0; j < batch.length; j++) {
        var entry = datas[j];
        if (!entry) continue; // глава из spine не нашлась в архиве - пропускаем, не роняя всю книгу
        var path = batch[j];
        var chDir = dirname(path);
        var parsedChapter = parseChapterXhtml(decodeXhtmlBytes(entry));
        parsedChapter.blocks.forEach(function (block) {
          // href из <img>/<image> - относительно САМОЙ главы; приводим к тому же виду абсолютного пути внутри архива,
          // каким ключуются записи images выше (resolveHref(opfDir, ...) в manifest) - оба способа дают один путь.
          if (block.type === "image" && block.imageId) block.imageId = resolveHref(chDir, block.imageId);
        });
        var chap = { id: null, index: chapters.length, title: parsedChapter.title, blocks: parsedChapter.blocks };
        if (parsedChapter.navLike) { chap.nav = true; chap.title = ""; } // индексы глав не меняются - позиции чтения/закладки остаются верными
        if (parsedChapter.bk) chap.bk = parsedChapter.bk;
        chap._docTitle = parsedChapter.docTitle;
        chapters.push(chap);
        if (performance.now() - sliceStart > 12) { await nextTick(); sliceStart = performance.now(); }
      }
    }
    if (!chapters.length) throw new Error("Не удалось извлечь ни одной главы из .epub");
    applyDocTitles(chapters, structure.title);

    return {
      chapters: chapters, images: images, title: structure.title, author: structure.author,
      // imageEntries — для кэша разобранной книги (см. attachImages): по ним картинки находятся в архиве без повторного разбора
      imageEntries: imageEntries
    };
  }

  // Книга из кэша разобранных книг (my.js): главы уже готовы, нужно только заново привязать ленивые картинки к архиву.
  // record — {chapters, imageEntries, title, author}.
  function attachImages(zipData, record) {
    var bytes = zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData);
    var archive = MiniZip.openArchive(bytes);
    return {
      chapters: record.chapters, images: makeLazyImages(archive, record.imageEntries || []),
      title: record.title || "", author: record.author || "", imageEntries: record.imageEntries || []
    };
  }

  global.EpubParse = {
    parseEpub: parseEpub,
    attachImages: attachImages,
    PARSER_VERSION: PARSER_VERSION
  };
})(typeof window !== "undefined" ? window : globalThis);
