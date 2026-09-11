/* ===========================================================================
   fb2parse.js
   READER_PLAN.md, Этап D, шаг 10 (11.09) — разбор fb2 (FictionBook 2.0,
   это XML) в структуру глав -> абзацев (с полужирным/курсивом) ->
   изображений, для будущего экрана чтения (шаг 11, ещё не реализован —
   этот файл сам по себе UI не рисует, только парсит).

   Как и docxparse.js, разбор идёт регулярными выражениями по тексту XML,
   а не через DOMParser - весь код полностью тестируется в Node и ведёт
   себя в браузере так же (никаких браузерных API, только строки).
   decodeXmlEntities НЕ дублируется здесь (в отличие от docxparse.js,
   у которого своя копия) - берётся из MiniZip (minizip.js), который в
   index.html всегда загружается раньше остальных парсеров; так у сущностей
   XML остаётся одна точка сопровождения на весь проект, а не две.

   Сложные и редкие обёртки fb2 сознательно не разбираются (ТЗ прямо это
   разрешает - "достаточно основного текста, базового форматирования,
   разбиения на абзацы и картинок"): нет секций-сносок/примечаний (см.
   выбор "основного" body ниже), нет разбора epigraph/annotation как
   отдельных типов блоков (их <p>/<v> просто попадают в общий поток абзацев
   как обычный текст), нет вложенных inline-тегов кроме strong/emphasis
   (sub/sup/strikethrough/code/a - текст сохраняется, своё оформление
   тегов теряется).

   Экспортирует Fb2Parse.parseFb2(xmlText) -> { chapters, images }

   chapters: Chapter[]
     Chapter = { id: string|null, index: number, title: string, blocks: Block[] }
       id     - атрибут id секции fb2 (section id="..."), null если его нет
       index  - порядковый номер главы в ПЛОСКОМ (развёрнутом) списке,
                0-based; вложенные <section> внутри секции становятся
                отдельными главами СРАЗУ ПОСЛЕ неё (см. пояснение у
                parseSectionBlock ниже) - собственный текст секции ДО её
                вложенных подсекций не теряется и не смешивается с ними
       title  - текст <title> секции (все её <p>, через пробел), "" если
                заголовка нет
       blocks - Block[], см. ниже

   Block = ParagraphBlock | ImageBlock
     ParagraphBlock = { type: "paragraph", runs: Run[] }
       Абзацем считается и <p>, и <subtitle>, и строка стиха <v> - для
       разбиения текста на читаемые куски разница между ними здесь не
       нужна (в отличие от, например, будущего решения о стилях в CSS).
       Пустые абзацы (без единого непробельного символа) в список не
       попадают.
     ImageBlock = { type: "image", imageId: string|null }
       imageId - значение l:href/xlink:href без ведущей "#", ключ в images
       (см. ниже); null, если у <image> почему-то не нашлось атрибута
       ссылки (битый файл) - вызывающему коду решать, что с этим делать.

   Run = { text: string, bold: boolean, italic: boolean }
     Один прогон текста абзаца с одинаковым сочетанием жирный/курсив
     (учитывает и вложенность strong внутри emphasis и наоборот).

   images: { [id: string]: { contentType: string, base64: string } }
     Плоская карта всех <binary> верхнего уровня документа (сжатые пробелы/
     переносы строк внутри base64 убраны) - вне зависимости от того, из
     какой(-их) глав на них реально есть ссылки; какие именно binary
     использованы - решает уже вызывающий код по imageId из ImageBlock.
   =========================================================================== */

(function (global) {
  "use strict";

  var MiniZip = global.MiniZip;
  function decodeXmlEntities(s) {
    if (MiniZip && MiniZip.decodeXmlEntities) return MiniZip.decodeXmlEntities(s);
    // Не должно происходить при обычной загрузке (minizip.js идёт раньше
    // fb2parse.js в index.html/sw.js ASSETS) - но не роняем модуль совсем
    // без объяснения причины.
    throw new Error("Fb2Parse: MiniZip.decodeXmlEntities недоступен - minizip.js должен быть загружен раньше fb2parse.js");
  }

  // Убирает внешний открывающий и закрывающий тег у блока вида
  // "<tag ...>...</tag>", возвращает то, что между ними. Годится для
  // любого блока, полученного extractTagBlocks ниже (там ровно один
  // внешний тег на весь блок).
  function stripOuterTag(blockXml) {
    var start = blockXml.indexOf(">") + 1;
    var end = blockXml.lastIndexOf("<");
    return end > start ? blockXml.slice(start, end) : "";
  }

  // Тот же приём, что extractBlocksWithAttrs в docxparse.js (счётчик
  // глубины по открывающим/закрывающим тегам одного имени, с учётом
  // произвольных атрибутов у открывающего тега) - только без префикса
  // пространства имён "w:", в fb2 его нет. Возвращает
  // [{start, end, xml}], start/end - индексы в исходной строке (нужны
  // ниже, чтобы восстановить порядок p/subtitle/v/image при слиянии).
  function extractTagBlocks(xml, tagName) {
    var blocks = [];
    var re = new RegExp("<" + tagName + "(?:\\s[^>]*)?>|</" + tagName + ">", "g");
    var depth = 0, start = -1, m;
    while ((m = re.exec(xml))) {
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

  // <image .../> в fb2 почти всегда самозакрывающийся - но на случай
  // редкого варианта с закрывающим тегом (пустое содержимое между ними)
  // подходят оба варианта одним регэкспом.
  function extractImageBlocks(xml) {
    var blocks = [];
    var re = /<image\b[^>]*?(?:\/>|>[\s\S]*?<\/image>)/g;
    var m;
    while ((m = re.exec(xml))) {
      blocks.push({ start: m.index, end: re.lastIndex, xml: m[0] });
    }
    return blocks;
  }

  // Текст абзаца -> Run[] с учётом strong (жирный) и emphasis (курсив),
  // включая их взаимную вложенность (strong внутри emphasis и наоборот -
  // оба флага у прогона текста внутри). Прочие инлайн-теги (a/sub/sup/
  // strikethrough/code) - текст сохраняется, сам тег просто убирается, без
  // своего форматирования (см. шапку файла).
  function paragraphRuns(pInnerXml) {
    var runs = [];
    var boldDepth = 0, italicDepth = 0;
    var buf = "";
    function flush() {
      if (buf) {
        runs.push({ text: decodeXmlEntities(buf), bold: boldDepth > 0, italic: italicDepth > 0 });
        buf = "";
      }
    }
    var tokenRe = /<(\/)?(strong|emphasis|a|sub|sup|strikethrough|code)(?:\s[^>]*)?>|<empty-line\s*\/>|([^<]+)/g;
    var m;
    while ((m = tokenRe.exec(pInnerXml))) {
      if (m[3] !== undefined) {
        buf += m[3];
        continue;
      }
      if (m[0].indexOf("<empty-line") === 0) continue; // изредка встречается и внутри абзаца - игнорируем как разметку
      var closing = !!m[1], tag = m[2];
      if (tag === "strong" || tag === "emphasis") {
        flush();
        if (tag === "strong") boldDepth += closing ? -1 : 1;
        else italicDepth += closing ? -1 : 1;
        if (boldDepth < 0) boldDepth = 0;
        if (italicDepth < 0) italicDepth = 0;
      }
      // остальные инлайн-теги - ни на буфер, ни на флаги не влияют
    }
    flush();
    return runs;
  }

  function runsToPlainText(runs) {
    return runs.map(function (r) { return r.text; }).join("");
  }

  // <title> секции -> { title, rest }: title - текст всех <p> внутри
  // <title>, через пробел, схлопнутые пробелы; rest - содержимое секции
  // БЕЗ этого <title> (чтобы он не попал в blocks как обычный абзац).
  // Секция без <title> - редкость, но допустима (title будет "").
  function extractSectionTitle(ownContent) {
    var m = /<title(?:\s[^>]*)?>[\s\S]*?<\/title>/.exec(ownContent);
    if (!m) return { title: "", rest: ownContent };
    var titleXml = m[0];
    var pBlocks = extractTagBlocks(titleXml, "p");
    var titleText = pBlocks
      .map(function (b) { return runsToPlainText(paragraphRuns(stripOuterTag(b.xml))); })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    var rest = ownContent.slice(0, m.index) + ownContent.slice(m.index + titleXml.length);
    return { title: titleText, rest: rest };
  }

  // Содержимое секции (без вложенных <section>, без <title> - см. вызов
  // ниже) -> Block[], в порядке следования по документу. <p>/<subtitle>/
  // <v> считаются абзацами независимо от того, во что они обёрнуты
  // (cite/poem/stanza/epigraph и т.п. игнорируются как обёртки, см. шапку
  // файла) - поэтому ищутся плоско по всему тексту, а не рекурсивным
  // спуском по дереву обёрток.
  function parseBlocksFromXml(xml) {
    var combined = [];
    extractTagBlocks(xml, "p").forEach(function (b) { combined.push({ start: b.start, kind: "p", xml: b.xml }); });
    extractTagBlocks(xml, "subtitle").forEach(function (b) { combined.push({ start: b.start, kind: "p", xml: b.xml }); });
    extractTagBlocks(xml, "v").forEach(function (b) { combined.push({ start: b.start, kind: "p", xml: b.xml }); });
    extractImageBlocks(xml).forEach(function (b) { combined.push({ start: b.start, kind: "image", xml: b.xml }); });
    combined.sort(function (a, b) { return a.start - b.start; });

    var blocks = combined.map(function (item) {
      if (item.kind === "image") {
        var hrefMatch = /(?:l:href|xlink:href|href)\s*=\s*"#?([^"]+)"/.exec(item.xml);
        return { type: "image", imageId: hrefMatch ? hrefMatch[1] : null };
      }
      return { type: "paragraph", runs: paragraphRuns(stripOuterTag(item.xml)) };
    });

    // Пустые абзацы (например, <p></p> или <v></v> без текста, часто
    // встречаются как визуальные разделители наравне с <empty-line/>) не
    // несут читаемого содержимого - выбрасываем, а не превращаем в пустые
    // строки списка.
    return blocks.filter(function (block) {
      if (block.type !== "paragraph") return true;
      return block.runs.some(function (r) { return r.text.trim().length > 0; });
    });
  }

  // Один <section ...>...</section> (включая внешние теги) -> добавляет в
  // chaptersOut одну главу для СВОЕГО СОБСТВЕННОГО содержимого секции
  // (текст до/после вложенных подсекций, но не сами подсекции), затем
  // рекурсивно добавляет по одной главе на каждую вложенную <section> -
  // тем самым дерево секций разворачивается в плоский список глав в
  // порядке чтения (документ-порядок), без отдельного понятия
  // "подглава" - экрану списка глав (шаг 11) не нужно ничего, кроме
  // плоского списка.
  function parseSectionBlock(sectionXml, chaptersOut) {
    var openTagMatch = /^<section([^>]*)>/.exec(sectionXml);
    var attrs = openTagMatch ? openTagMatch[1] : "";
    var idMatch = /\bid="([^"]*)"/.exec(attrs);
    var id = idMatch ? idMatch[1] : null;

    var inner = stripOuterTag(sectionXml);
    var childSectionBlocks = extractTagBlocks(inner, "section");
    var ownContent = inner;
    childSectionBlocks.forEach(function (child) {
      ownContent = ownContent.replace(child.xml, "");
    });

    var titleResult = extractSectionTitle(ownContent);
    var blocks = parseBlocksFromXml(titleResult.rest);

    chaptersOut.push({ id: id, title: titleResult.title, blocks: blocks });

    childSectionBlocks.forEach(function (child) {
      parseSectionBlock(child.xml, chaptersOut);
    });
  }

  // Все <binary id="..." content-type="...">BASE64</binary> верхнего
  // уровня документа (иллюстрации книги) -> { id: {contentType, base64} }.
  // Пробелы/переносы строк внутри base64 (fb2 обычно форматирует его
  // блоками фиксированной ширины) убираются - иначе base64 не decode-ится.
  function parseBinaries(xml) {
    var images = {};
    var re = /<binary\s+([^>]*?)\/?>([\s\S]*?)<\/binary>/g;
    var m;
    while ((m = re.exec(xml))) {
      var attrs = m[1];
      var idMatch = /\bid="([^"]*)"/.exec(attrs);
      if (!idMatch) continue;
      var ctMatch = /\bcontent-type="([^"]*)"/.exec(attrs);
      images[idMatch[1]] = {
        contentType: ctMatch ? ctMatch[1] : "image/jpeg",
        base64: m[2].replace(/\s+/g, "")
      };
    }
    return images;
  }

  // Основная функция: текст fb2-файла (строка) -> { chapters, images }.
  function parseFb2(xmlText) {
    var xml = String(xmlText);

    var bodyBlocks = extractTagBlocks(xml, "body");
    if (!bodyBlocks.length) {
      throw new Error("В файле не найден элемент <body> - это не похоже на fb2.");
    }
    // "Основное" тело книги - без атрибута name (вспомогательные тела вроде
    // <body name="notes"> - сноски/примечания - в главы не попадают, см.
    // шапку файла). Если по какой-то причине атрибута name нет ни у
    // одного body (не должно случаться), берём первый как есть.
    var mainBody = bodyBlocks[0];
    for (var i = 0; i < bodyBlocks.length; i++) {
      var openTagMatch = /^<body([^>]*)>/.exec(bodyBlocks[i].xml);
      var attrs = openTagMatch ? openTagMatch[1] : "";
      if (!/\bname\s*=/.test(attrs)) { mainBody = bodyBlocks[i]; break; }
    }

    var chapters = [];
    var topSections = extractTagBlocks(stripOuterTag(mainBody.xml), "section");
    topSections.forEach(function (sec) { parseSectionBlock(sec.xml, chapters); });
    chapters.forEach(function (ch, idx) { ch.index = idx; });

    return { chapters: chapters, images: parseBinaries(xml) };
  }

  global.Fb2Parse = {
    parseFb2: parseFb2
  };
})(typeof window !== "undefined" ? window : globalThis);
