/* ===========================================================================
   docxparse.js
   Разбор XML-содержимого word/document.xml (см. minizip.js) на таблицы
   строк/ячеек - аналог того, что даёт python-docx (doc.tables, row.cells,
   cell.paragraphs), но реализовано через регулярные выражения по тексту
   XML, а не через DOMParser. Так весь код можно полностью протестировать
   в Node (где DOMParser недоступен и его неоткуда взять - сеть отключена)
   и быть уверенным, что в браузере он поведёт себя так же (это просто
   работа со строкой, никаких браузерных API).

   Экспортирует DocxParse.parseTables(xml) -> Table[]
   Table  = Row[]
   Row    = Cell[]           (уже "развёрнутый" по gridSpan - см. ниже)
   Cell   = { text: string, paragraphs: string[] }
     text       - весь текст ячейки, абзацы соединены пробелом, схлопнутые
                  пробелы (аналог python-docx cell.text, но "очищенный")
     paragraphs - текст по абзацам как есть (для случаев вроде
                  "Учащийся Л." / "Помощник Й." на разных строках ячейки)

   Важно про gridSpan: если ячейка в Word объединена по горизонтали
   (несколько столбцов), в XML это ОДИН <w:tc> с <w:gridSpan w:val="N"/>,
   а не N повторов. python-docx в row.cells эту ячейку "разворачивает" -
   отдаёт её текст N раз подряд (чтобы row.cells[i] соответствовал
   логическому столбцу таблицы). Мы здесь делаем то же самое - это
   критично для остальной логики (расчёт на cells[-1]/cells[-2] и т.п.).
   =========================================================================== */

(function (global) {
  "use strict";

  // Декодирует стандартные XML-сущности (&amp; &lt; &gt; &quot; &apos;
  // и числовые &#NNN; / &#xHH;).
  function decodeXmlEntities(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
        return String.fromCodePoint(parseInt(hex, 16));
      })
      .replace(/&#(\d+);/g, function (_, dec) {
        return String.fromCodePoint(parseInt(dec, 10));
      })
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // Текст одного абзаца (<w:p ...>...</w:p>): конкатенация текста всех
  // <w:t>, плюс \t за <w:tab/> и \n за <w:br/>/<w:cr/> (как в python-docx).
  function paragraphText(pXml) {
    let out = "";
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\/>|<w:br\/?>|<w:cr\/?>/g;
    let m;
    while ((m = re.exec(pXml))) {
      if (m[0].indexOf("<w:tab") === 0) {
        out += "\t";
      } else if (m[0].indexOf("<w:br") === 0 || m[0].indexOf("<w:cr") === 0) {
        out += "\n";
      } else if (m[1] !== undefined) {
        out += decodeXmlEntities(m[1]);
      }
    }
    return out;
  }

  // Более надёжное извлечение <w:p ...>...</w:p> с учётом атрибутов и
  // вложенности (см. комментарий выше) - основная функция парсинга абзацев.
  function extractParagraphBlocks(xml) {
    const blocks = [];
    const re = /<w:p(?:\s[^>]*)?>|<\/w:p>/g;
    let depth = 0;
    let start = -1;
    let m;
    while ((m = re.exec(xml))) {
      if (m[0] === "</w:p>") {
        depth--;
        if (depth === 0 && start >= 0) {
          blocks.push(xml.slice(start, re.lastIndex));
          start = -1;
        }
      } else {
        if (depth === 0) start = m.index;
        depth++;
      }
    }
    return blocks;
  }

  // Блоки с произвольными атрибутами у открывающего тега, с учётом
  // вложенности - используется для w:tbl, w:tr, w:tc.
  function extractBlocksWithAttrs(xml, tagName) {
    const blocks = [];
    const re = new RegExp("<w:" + tagName + "(?:\\s[^>]*)?>|</w:" + tagName + ">", "g");
    let depth = 0;
    let start = -1;
    let m;
    while ((m = re.exec(xml))) {
      if (m[0] === "</w:" + tagName + ">") {
        depth--;
        if (depth === 0 && start >= 0) {
          blocks.push(xml.slice(start, re.lastIndex));
          start = -1;
        }
      } else {
        if (depth === 0) start = m.index;
        depth++;
      }
    }
    return blocks;
  }

  // Текст ячейки <w:tc ...>...</w:tc>: абзацы (каждый - результат
  // paragraphText), плюс gridSpan (число объединённых столбцов, 1 если
  // не объединена).
  function parseCell(tcXml) {
    const paragraphBlocks = extractParagraphBlocks(tcXml);
    const paragraphs = paragraphBlocks.map(paragraphText);

    let gridSpan = 1;
    const gridSpanMatch = tcXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
    if (gridSpanMatch) {
      gridSpan = parseInt(gridSpanMatch[1], 10) || 1;
    }

    const text = paragraphs.join(" ").replace(/\s+/g, " ").trim();

    return { text: text, paragraphs: paragraphs, gridSpan: gridSpan };
  }

  // Строка таблицы <w:tr ...>...</w:tr> -> массив ячеек, "развёрнутый"
  // по gridSpan (см. шапку файла).
  function parseRow(trXml) {
    const tcBlocks = extractBlocksWithAttrs(trXml, "tc");
    const cells = [];
    for (const tcXml of tcBlocks) {
      const cell = parseCell(tcXml);
      for (let i = 0; i < cell.gridSpan; i++) {
        cells.push({ text: cell.text, paragraphs: cell.paragraphs });
      }
    }
    return cells;
  }

  // Таблица <w:tbl ...>...</w:tbl> -> массив строк.
  function parseTable(tblXml) {
    const trBlocks = extractBlocksWithAttrs(tblXml, "tr");
    return trBlocks.map(parseRow);
  }

  // Основная функция: весь XML документа -> массив таблиц верхнего уровня.
  function parseTables(xml) {
    const tblBlocks = extractBlocksWithAttrs(xml, "tbl");
    return tblBlocks.map(parseTable);
  }

  global.DocxParse = {
    parseTables: parseTables,
  };
})(typeof window !== "undefined" ? window : globalThis);
