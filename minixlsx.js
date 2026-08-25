/* ===========================================================================
   minixlsx.js
   Минимальный, полностью самописный сборщик .xlsx (без сторонних
   библиотек, без SheetJS) - строит рабочую книгу с несколькими листами
   из простых текстовых/числовых данных.

   .xlsx - это zip-архив (см. minizip.js) с набором XML-файлов внутри
   (формат OOXML). Здесь строится ровно тот минимальный набор файлов,
   который нужен, чтобы Excel и Google Таблицы корректно открыли книгу:
   [Content_Types].xml, _rels/.rels, xl/workbook.xml,
   xl/_rels/workbook.xml.rels, xl/worksheets/sheetN.xml.

   Строки хранятся как inline strings (type="str"/"inlineStr" прямо в
   ячейке) - это осознанно проще, чем таблица shared strings, и полностью
   валидно для чтения.
   =========================================================================== */

(function (global) {
  "use strict";

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // Номер столбца (0-based) -> буквенное обозначение Excel (0->A, 25->Z, 26->AA...)
  function columnLetter(index) {
    let n = index + 1;
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // Безопасное имя листа: Excel запрещает \ / ? * [ ] : и ограничивает
  // длину 31 символом.
  function sanitizeSheetName(name) {
    let s = String(name).replace(/[\\/?*\[\]:]/g, "");
    if (s.length > 31) s = s.slice(0, 31);
    return s || "Sheet";
  }

  // rows: массив строк, каждая строка - массив значений (string | number).
  // Первая строка считается заголовком (жирный шрифт).
  function buildSheetXml(rows) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml +=
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    xml += "<sheetData>";

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      xml += '<row r="' + (r + 1) + '">';
      for (let c = 0; c < row.length; c++) {
        const cellRef = columnLetter(c) + (r + 1);
        const value = row[c];
        const isNumber = typeof value === "number" && isFinite(value);
        const styleAttr = r === 0 ? ' s="1"' : "";
        if (value === null || value === undefined || value === "") {
          xml += '<c r="' + cellRef + '"' + styleAttr + "/>";
        } else if (isNumber) {
          xml += '<c r="' + cellRef + '"' + styleAttr + "><v>" + value + "</v></c>";
        } else {
          xml +=
            '<c r="' +
            cellRef +
            '" t="inlineStr"' +
            styleAttr +
            "><is><t xml:space=\"preserve\">" +
            escapeXml(value) +
            "</t></is></c>";
        }
      }
      xml += "</row>";
    }

    xml += "</sheetData></worksheet>";
    return xml;
  }

  function buildContentTypesXml(sheetCount) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml +=
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
    xml += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
    xml += '<Default Extension="xml" ContentType="application/xml"/>';
    xml +=
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    xml +=
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (let i = 1; i <= sheetCount; i++) {
      xml +=
        '<Override PartName="/xl/worksheets/sheet' +
        i +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    xml += "</Types>";
    return xml;
  }

  function buildRootRelsXml() {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    xml +=
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>';
    xml += "</Relationships>";
    return xml;
  }

  function buildWorkbookXml(sheetNames) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml +=
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    xml += "<sheets>";
    sheetNames.forEach(function (name, i) {
      xml +=
        '<sheet name="' +
        escapeXml(name) +
        '" sheetId="' +
        (i + 1) +
        '" r:id="rId' +
        (i + 1) +
        '"/>';
    });
    xml += "</sheets></workbook>";
    return xml;
  }

  function buildWorkbookRelsXml(sheetCount) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (let i = 1; i <= sheetCount; i++) {
      xml +=
        '<Relationship Id="rId' +
        i +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        i +
        '.xml"/>';
    }
    xml +=
      '<Relationship Id="rId' +
      (sheetCount + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    xml += "</Relationships>";
    return xml;
  }

  // Простейшие стили: индекс 0 - обычный текст, индекс 1 - жирный
  // (используется для заголовков листов, см. styleAttr в buildSheetXml).
  function buildStylesXml() {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    xml += '<fonts count="2">';
    xml += "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>";
    xml += "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>";
    xml += "</fonts>";
    xml += '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>';
    xml += '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>';
    xml += '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>';
    xml += '<cellXfs count="2">';
    xml += '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
    xml += '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>';
    xml += "</cellXfs>";
    xml += '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>';
    xml += "</styleSheet>";
    return xml;
  }

  // sheets: массив { name: string, rows: [[...], [...], ...] }
  // Возвращает Uint8Array готового .xlsx файла.
  function buildXlsx(sheets) {
    const encoder = new TextEncoder();
    const sheetNames = sheets.map(function (s) {
      return sanitizeSheetName(s.name);
    });

    const files = [
      { name: "[Content_Types].xml", data: encoder.encode(buildContentTypesXml(sheets.length)) },
      { name: "_rels/.rels", data: encoder.encode(buildRootRelsXml()) },
      { name: "xl/workbook.xml", data: encoder.encode(buildWorkbookXml(sheetNames)) },
      { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(buildWorkbookRelsXml(sheets.length)) },
      { name: "xl/styles.xml", data: encoder.encode(buildStylesXml()) },
    ];

    sheets.forEach(function (sheet, i) {
      files.push({
        name: "xl/worksheets/sheet" + (i + 1) + ".xml",
        data: encoder.encode(buildSheetXml(sheet.rows)),
      });
    });

    return global.MiniZip.createZip(files);
  }

  global.MiniXlsx = {
    buildXlsx: buildXlsx,
  };
})(typeof window !== "undefined" ? window : globalThis);
