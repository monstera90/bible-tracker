/* ===========================================================================
   s89tasks.js
   Перенос логики python-скрипта task-jpg-script.py (скрипт 2) на JS -
   разбор docx в список заданий (для последующей отрисовки на подложке
   S-89, см. s89draw.js). Работает поверх DocxParse.parseTables (см.
   docxparse.js) - тот же формат таблиц, что и у WorkbookParse.

   Задания, которые попадают в список:
     - "3. Чтение Библии"  (без напарника, оба зала)
     - любой пункт раздела "Оттачиваем навыки служения", включая "Речь"
       (с напарником через extractStudentHelper - для "Речь" напарник
       получается пустым сам собой, т.к. в ячейке нет слова "Помощник")

   Дата собирается с годом (свой год отслеживается по хронологии таблиц -
   см. YearTracker, аналог YearTracker в task-jpg-script.py).

   Экспортирует S89Tasks.buildTasks(xmlString, startYear) -> Task[]
   Task = { date, student, partner, hall, itemNumber, itemTitle }
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

  function extractItemNumber(text) {
    const m = /^(\d+)\./.exec(clean(text));
    return m ? m[1] : "";
  }

  // Порт extract_student_helper из Python (тот же алгоритм, что и в
  // workbookparse.js - продублировано здесь, чтобы файл был независимым).
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

  // ---------------------------------------------------------------------
  // Год по хронологии (порт YearTracker)
  // ---------------------------------------------------------------------

  function createYearTracker(startYear) {
    let year = startYear;
    let prev = null;
    return {
      getYear(month, day) {
        const current = month * 100 + day;
        if (prev !== null && current < prev) year++;
        prev = current;
        return year;
      },
    };
  }

  function getTableDate(table) {
    if (!table.length) return null;
    for (const row of table) {
      const headerText = clean(row[0] ? row[0].text : "");
      if (!headerText) continue;
      if (headerText.indexOf("Программа встречи") !== -1) continue;
      if (DATE_HEADER_RE.test(headerText)) {
        return parseDateFromHeader(headerText);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Разбор одной таблицы (одна встреча/неделя) в список заданий
  // ---------------------------------------------------------------------

  function parseMeetingTableBody(table, dateStr, tasks) {
    let section = null;

    for (const row of table) {
      if (row.length < 2) continue;
      const joined = clean(row.map((c) => c.text).join(" "));
      if (!joined) continue;

      const col2 = row.length > 2 ? row[2].text : "";
      const rawLast = row[row.length - 1].paragraphs.join("\n");
      const rawSecondLast = row.length > 1 ? row[row.length - 2].paragraphs.join("\n") : "";
      const cleanLast = row[row.length - 1].text;
      const cleanSecondLast = row.length > 1 ? row[row.length - 2].text : "";

      if (joined.indexOf("СОКРОВИЩА ИЗ СЛОВА БОГА") !== -1) {
        section = "treasures";
        continue;
      }
      if (joined.indexOf("ОТТАЧИВАЕМ НАВЫКИ СЛУЖЕНИЯ") !== -1) {
        section = "ministry";
        continue;
      }
      if (joined.indexOf("ХРИСТИАНСКАЯ ЖИЗНЬ") !== -1) {
        section = null;
        continue;
      }

      // --- "3. Чтение Библии" - без напарника ---
      if (section === "treasures" && (col2.indexOf("3.") === 0 || col2.indexOf("Чтение Библии") !== -1)) {
        const itemNumber = extractItemNumber(col2) || "3";
        const itemTitle = stripTaskLabel(col2);
        if (!isEmptyName(cleanLast)) {
          tasks.push({ date: dateStr, student: cleanLast, partner: "", hall: 1, itemNumber, itemTitle });
        }
        if (!isEmptyName(cleanSecondLast)) {
          tasks.push({ date: dateStr, student: cleanSecondLast, partner: "", hall: 2, itemNumber, itemTitle });
        }
        continue;
      }

      // --- Пункты раздела "Оттачиваем навыки служения" (включая "Речь") ---
      if (section === "ministry" && /^\d+\./.test(col2)) {
        const itemTitle = stripTaskLabel(col2);
        const itemNumber = extractItemNumber(col2);

        const hallCells = [
          [2, rawSecondLast],
          [1, rawLast],
        ];
        for (const [hallNum, cellText] of hallCells) {
          const [student, helper] = extractStudentHelper(cellText);
          if (!isEmptyName(student)) {
            tasks.push({
              date: dateStr,
              student,
              partner: isEmptyName(helper) ? "" : helper,
              hall: hallNum,
              itemNumber,
              itemTitle,
            });
          }
        }
        continue;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Основная функция
  // ---------------------------------------------------------------------

  // xmlStrings - массив строк word/document.xml (обычно один документ,
  // но функция принимает несколько на случай будущего расширения).
  function buildTasks(xmlStrings, startYear) {
    const tasks = [];
    const yearTracker = createYearTracker(startYear || 2026);

    for (const xml of xmlStrings) {
      const tables = global.DocxParse.parseTables(xml);
      for (const table of tables) {
        const dateParts = getTableDate(table);
        if (dateParts === null) continue;
        const [day, month] = dateParts;
        const year = yearTracker.getYear(month, day);
        const dateStr =
          String(day).padStart(2, "0") + "." + String(month).padStart(2, "0") + "." + String(year % 100).padStart(2, "0");
        parseMeetingTableBody(table, dateStr, tasks);
      }
    }

    return tasks;
  }

  global.S89Tasks = {
    buildTasks: buildTasks,
  };
})(typeof window !== "undefined" ? window : globalThis);
