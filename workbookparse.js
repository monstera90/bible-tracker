/* ===========================================================================
   workbookparse.js
   Перенос логики python-скрипта workbook-script.py (скрипт 1) на JS -
   один в один, включая все 14 вкладок, разделы, историю дат с метками
   У/Н. Работает поверх DocxParse.parseTables (см. docxparse.js).

   Экспортирует WorkbookParse.buildWorkbook(xmlStrings) -> { name: rows[] }
   xmlStrings - массив строк word/document.xml (по одной на каждый
   загруженный документ), rows включают заголовок первой строкой.
   =========================================================================== */

(function (global) {
  "use strict";

  const MONTHS_RU = {
    "ЯНВАРЯ": 1, "ФЕВРАЛЯ": 2, "МАРТА": 3, "АПРЕЛЯ": 4,
    "МАЯ": 5, "ИЮНЯ": 6, "ИЮЛЯ": 7, "АВГУСТА": 8,
    "СЕНТЯБРЯ": 9, "ОКТЯБРЯ": 10, "НОЯБРЯ": 11, "ДЕКАБРЯ": 12,
  };
  const DATE_HEADER_RE = /^\s*(\d{1,2})\s+([А-ЯЁ]+)/;

  function clean(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/\u2002/g, " ").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseDateFromHeader(headerText) {
    const m = DATE_HEADER_RE.exec(headerText);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const monthWord = m[2];
    if (day === 0) return null;
    const month = MONTHS_RU[monthWord];
    if (!month) return null;
    return [day, month];
  }

  function formatDate(day, month) {
    return String(day).padStart(2, "0") + "." + String(month).padStart(2, "0");
  }

  function stripTaskLabel(text) {
    let t = clean(text);
    t = t.replace(/^\d+\.\s*/, "");
    t = t.replace(/\(\s*\d+\s*мин\.?\s*\)\s*$/, "");
    return clean(t);
  }

  function isEmptyName(name) {
    const n = clean(name);
    return n === "" || n === ".";
  }

  // Порт extract_student_helper из Python. cellRawText - "сырой" текст
  // ячейки (абзацы соединены через \n, БЕЗ схлопывания пробелов) - т.е.
  // paragraphs.join("\n") из DocxParse.
  function extractStudentHelper(cellRawText) {
    const flat = clean(cellRawText.replace(/\n/g, "  "));
    if (!flat) return ["", ""];

    const hasLabel = /учащ|помощ/i.test(flat);

    if (hasLabel) {
      const parts = flat.split(/помощ\S*:?\s*/i);
      const studentPart = parts[0];
      const helperPart = parts.length > 1 ? parts.slice(1).join("") : "";
      const student = clean(studentPart.replace(/учащ\S*:?\s*/i, ""));
      const helper = clean(helperPart);
      return [student, helper];
    }

    const rawLines = cellRawText.split("\n").filter((l) => clean(l));
    const lines = rawLines.map(clean);
    if (lines.length >= 2) {
      return [lines[0], lines[1]];
    }
    if (lines.length === 1) {
      const parts = rawLines[0].split(/\s{2,}/).map(clean).filter((p) => p);
      if (parts.length >= 2) return [parts[0], parts[1]];
      return [lines[0], ""];
    }
    return ["", ""];
  }

  // Порт split_two_names (для ИБ: Ведущий/Чтец).
  function splitTwoNames(cellRawText) {
    const text = clean(cellRawText.replace(/\n/g, "    "));
    if (!text) return ["", ""];
    const parts = cellRawText
      .replace(/\n/g, "  ")
      .split(/\s{2,}/)
      .map(clean)
      .filter((p) => p);
    if (parts.length >= 2) return [parts[0], parts[1]];
    if (parts.length === 1) return [parts[0], ""];
    return ["", ""];
  }

  function extractItemNumber(text) {
    const m = /^(\d+)\./.exec(clean(text));
    return m ? m[1] : "";
  }

  // ---------------------------------------------------------------------
  // Разбор одной таблицы (одна встреча/неделя)
  // ---------------------------------------------------------------------

  function parseMeetingTable(table, results) {
    if (!table.length) return;

    let dateParts = null;
    for (const row of table) {
      const headerText = clean(row[0] ? row[0].text : "");
      if (!headerText) continue;
      if (headerText.indexOf("Программа встречи") !== -1) continue;
      if (DATE_HEADER_RE.test(headerText)) {
        dateParts = parseDateFromHeader(headerText);
        break;
      }
    }
    if (dateParts === null) return;

    const [day, month] = dateParts;
    const dateStr = formatDate(day, month);
    const sortKey = month * 100 + day; // (month, day) как одно сравнимое число

    let section = null;
    let seenPrayerRows = 0;

    for (const row of table) {
      if (row.length < 2) continue;
      const joined = clean(row.map((c) => c.text).join(" "));
      if (!joined) continue;

      const col2 = row.length > 2 ? row[2].text : ""; // уже clean() из DocxParse
      const last = row[row.length - 1].text;
      const secondLast = row.length > 1 ? row[row.length - 2].text : "";
      const rawLast = row[row.length - 1].paragraphs.join("\n");
      const rawSecondLast = row.length > 1 ? row[row.length - 2].paragraphs.join("\n") : "";

      if (joined.indexOf("СОКРОВИЩА ИЗ СЛОВА БОГА") !== -1) {
        section = "treasures";
        continue;
      }
      if (joined.indexOf("ОТТАЧИВАЕМ НАВЫКИ СЛУЖЕНИЯ") !== -1) {
        section = "ministry";
        continue;
      }
      if (joined.indexOf("ХРИСТИАНСКАЯ ЖИЗНЬ") !== -1) {
        section = "christian_life";
        continue;
      }

      if (joined.indexOf("Председатель:") !== -1) {
        if (!isEmptyName(last)) results["Председатель"].push([sortKey, dateStr, last]);
        continue;
      }
      if (joined.indexOf("Дающий совет в дополнительном классе:") !== -1) {
        if (!isEmptyName(last)) results["Дополнительный класс"].push([sortKey, dateStr, last]);
        continue;
      }
      if (joined.indexOf("Молитва:") !== -1) {
        if (!isEmptyName(last)) {
          seenPrayerRows++;
          if (!results._prayersTmp[dateStr]) {
            results._prayersTmp[dateStr] = { open: "", close: "", key: sortKey };
          }
          if (seenPrayerRows === 1) results._prayersTmp[dateStr].open = last;
          else results._prayersTmp[dateStr].close = last;
        }
        continue;
      }

      if (section === "treasures") {
        if (col2.indexOf("1.") === 0) {
          if (!isEmptyName(last)) results["1. Сокровища"].push([sortKey, dateStr, last]);
          continue;
        }
        if (col2.indexOf("2.") === 0) {
          if (!isEmptyName(last)) results["2. Жемчужины"].push([sortKey, dateStr, last]);
          continue;
        }
        if (col2.indexOf("3.") === 0 || col2.indexOf("Чтение Библии") !== -1) {
          if (!isEmptyName(last)) results["ЧБ"].push([sortKey, dateStr, last, 1]);
          if (!isEmptyName(secondLast)) results["ЧБ"].push([sortKey, dateStr, secondLast, 2]);
          continue;
        }
      }

      if (section === "ministry") {
        if (!/^\d+\./.test(col2)) continue;
        const taskType = stripTaskLabel(col2);
        const isTalk = /реч/i.test(taskType);
        const isPrepare = /подготавл/i.test(taskType);

        const hallCells = [
          [2, rawSecondLast],
          [1, rawLast],
        ];
        for (const [hallNum, cellText] of hallCells) {
          const [student, helper] = extractStudentHelper(cellText);
          if (!isEmptyName(student)) {
            if (isTalk) {
              results["Речи"].push([sortKey, dateStr, student, hallNum]);
            } else if (isPrepare) {
              results["Подг. учен."].push([sortKey, dateStr, student, hallNum, taskType]);
            } else {
              results["Задания"].push([sortKey, dateStr, student, hallNum, taskType]);
            }
          }
          if (!isTalk && !isEmptyName(helper)) {
            results["Помощники"].push([sortKey, dateStr, helper]);
          }
        }
        continue;
      }

      if (section === "christian_life") {
        if (joined.indexOf("Изучение Библии") !== -1) {
          const [leader, reader] = splitTwoNames(rawLast);
          if (!isEmptyName(leader) || !isEmptyName(reader)) {
            results["ИБ"].push([
              sortKey,
              dateStr,
              isEmptyName(leader) ? "" : leader,
              isEmptyName(reader) ? "" : reader,
            ]);
          }
          section = null;
          continue;
        }
        if (joined.indexOf("Заключительные слова") !== -1 || joined.indexOf("Песня") !== -1) {
          continue;
        }
        if (!isEmptyName(last)) results["Пункты"].push([sortKey, dateStr, last]);
        continue;
      }
    }
  }

  // ---------------------------------------------------------------------
  // История дат (У/Н, максимум 8, свежие сверху внутри ячейки)
  // ---------------------------------------------------------------------

  function buildDateHistory(rows, nameIndex, mark) {
    const entries = {};
    for (const row of rows) {
      const name = row[nameIndex];
      const dateStr = row[1];
      if (!entries[name]) entries[name] = [];
      entries[name].push([row[0], dateStr + mark]);
    }
    return entries;
  }

  function mergeHistories(historyDicts, maxLen) {
    const combined = {}; // name -> Map<"sortKey|метка", entry>
    for (const hd of historyDicts) {
      for (const name in hd) {
        if (!combined[name]) combined[name] = new Map();
        for (const entry of hd[name]) {
          const key = entry[0] + "|" + entry[1];
          if (!combined[name].has(key)) combined[name].set(key, entry);
        }
      }
    }
    const result = {};
    for (const name in combined) {
      const ordered = Array.from(combined[name].values()).sort((a, b) => b[0] - a[0]); // убыв.
      let tags = ordered.map((e) => e[1]);
      if (tags.length > maxLen) tags = tags.slice(0, maxLen);
      result[name] = tags.join("|");
    }
    return result;
  }

  function latestPerName(rows, nameIndex) {
    const latest = {};
    for (const row of rows) {
      const name = row[nameIndex];
      if (!latest[name] || row[0] > latest[name][0]) {
        latest[name] = row;
      }
    }
    return Object.values(latest);
  }

  // ---------------------------------------------------------------------
  // Сборка результатов по всем документам
  // ---------------------------------------------------------------------

  const SHEET_ORDER = [
    "Председатель",
    "Дополнительный класс",
    "1. Сокровища",
    "2. Жемчужины",
    "ЧБ",
    "Молитвы",
    "ИБ",
    "Задания",
    "Зад. посл.",
    "Подг. учен.",
    "Речи",
    "Помощники",
    "Нап. посл.",
    "Пункты",
  ];

  const ASCENDING_SHEETS = new Set(["Зад. посл.", "Нап. посл."]);

  const SHEET_HEADERS = {
    "Председатель": ["Дата", "Председатель"],
    "Дополнительный класс": ["Дата", "Дающий совет"],
    "1. Сокровища": ["Дата", "Выступающий"],
    "2. Жемчужины": ["Дата", "Выступающий"],
    "ЧБ": ["Дата", "Выступающий", "Зал"],
    "Молитвы": ["Дата", "Вступительная молитва", "Заключительная молитва"],
    "ИБ": ["Дата", "Ведущий", "Чтец"],
    "Задания": ["Дата", "Учащийся", "Зал", "Тип задания"],
    "Зад. посл.": ["Дата", "Учащийся", "Все даты", "Зал", "Тип задания"],
    "Подг. учен.": ["Дата", "Учащийся", "Все даты", "Зал", "Тип задания"],
    "Речи": ["Дата", "Учащийся", "Зал"],
    "Помощники": ["Дата", "Помощник", "Все даты"],
    "Нап. посл.": ["Дата", "Помощник", "Все даты"],
    "Пункты": ["Дата", "Выступающий"],
  };

  function collectResults(xmlStrings) {
    const results = {
      "Председатель": [],
      "Дополнительный класс": [],
      "1. Сокровища": [],
      "2. Жемчужины": [],
      "ЧБ": [],
      "ИБ": [],
      "Задания": [],
      "Подг. учен.": [],
      "Речи": [],
      "Помощники": [],
      "Пункты": [],
      _prayersTmp: {},
    };

    for (const xml of xmlStrings) {
      const tables = global.DocxParse.parseTables(xml);
      for (const table of tables) {
        parseMeetingTable(table, results);
      }
    }

    const prayers = results._prayersTmp;
    delete results._prayersTmp;
    results["Молитвы"] = Object.keys(prayers).map((dateStr) => [
      prayers[dateStr].key,
      dateStr,
      prayers[dateStr].open,
      prayers[dateStr].close,
    ]);

    const histStudent = buildDateHistory(results["Задания"].concat(results["Подг. учен."]), 2, "У");
    const histHelper = buildDateHistory(results["Помощники"], 2, "Н");
    const history = mergeHistories([histStudent, histHelper], 8);

    const latestTasks = latestPerName(results["Задания"], 2);
    results["Зад. посл."] = latestTasks.map(([sortKey, dateStr, name, hall, taskType]) => [
      sortKey,
      dateStr,
      name,
      history[name] || "",
      hall,
      taskType,
    ]);

    results["Подг. учен."] = results["Подг. учен."].map(([sortKey, dateStr, name, hall, taskType]) => [
      sortKey,
      dateStr,
      name,
      history[name] || "",
      hall,
      taskType,
    ]);

    results["Помощники"] = results["Помощники"].map(([sortKey, dateStr, name]) => [
      sortKey,
      dateStr,
      name,
      history[name] || "",
    ]);

    const latestHelpers = latestPerName(results["Помощники"], 2);
    results["Нап. посл."] = latestHelpers.map((r) => [r[0], r[1], r[2], r[3]]);

    return results;
  }

  // Возвращает { sheetName: rows[][] } готовое для сборки .xlsx
  // (каждый rows включает строку заголовка первой).
  function buildWorkbook(xmlStrings) {
    const results = collectResults(xmlStrings);
    const sheets = {};

    for (const sheetName of SHEET_ORDER) {
      const headers = SHEET_HEADERS[sheetName];
      const rows = results[sheetName] || [];
      const newestFirst = !ASCENDING_SHEETS.has(sheetName);
      const rowsSorted = rows.slice().sort((a, b) => (newestFirst ? b[0] - a[0] : a[0] - b[0]));

      const outRows = [headers];
      for (const row of rowsSorted) {
        outRows.push(row.slice(1)); // без sortKey
      }
      sheets[sheetName] = outRows;
    }

    return { sheets: sheets, order: SHEET_ORDER };
  }

  global.WorkbookParse = {
    buildWorkbook: buildWorkbook,
  };
})(typeof window !== "undefined" ? window : globalThis);
