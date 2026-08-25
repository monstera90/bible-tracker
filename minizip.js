/* ===========================================================================
   minizip.js
   Минимальный, полностью самописный (без сторонних библиотек) читатель
   ZIP-архивов - ровно настолько, насколько нужно, чтобы достать
   word/document.xml из .docx файла (.docx - это zip-архив с XML внутри).

   Почему свой, а не готовая библиотека (JSZip и т.п.): такие библиотеки
   обычно поставляются одним большим минифицированным файлом с "сырыми"
   байтами сигнатур внутри строк - при передаче через некоторые текстовые
   каналы эти байты могут теряться/искажаться. Простой ридер (нам нужно
   только ЧИТАТЬ один конкретный файл из архива, не писать zip) значительно
   надёжнее сделать самим.

   Используется нативный браузерный DecompressionStream('deflate-raw') -
   поддерживается в Chrome/Android из коробки, распаковка без сторонних
   библиотек.
   =========================================================================== */

(function (global) {
  "use strict";

  function readUint16LE(view, offset) {
    return view.getUint16(offset, true);
  }
  function readUint32LE(view, offset) {
    return view.getUint32(offset, true);
  }

  // Находит запись End Of Central Directory (EOCD), сканируя с конца файла.
  // Комментарий архива (если есть) может быть переменной длины, поэтому
  // ищем сигнатуру 0x06054b50 с конца, а не по фиксированному смещению.
  function findEndOfCentralDirectory(bytes) {
    const EOCD_SIG = 0x06054b50;
    const minPos = Math.max(0, bytes.length - 65557); // макс. длина комментария 65535 + запас
    for (let i = bytes.length - 22; i >= minPos; i--) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + i, 4);
      if (view.getUint32(0, true) === EOCD_SIG) {
        return i;
      }
    }
    throw new Error("Не найден конец центрального каталога ZIP - файл повреждён или это не ZIP/.docx");
  }

  // Читает центральный каталог и возвращает Map<имя файла, запись>
  function readCentralDirectory(bytes) {
    const eocdOffset = findEndOfCentralDirectory(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const entryCount = readUint16LE(view, eocdOffset + 10);
    const centralDirOffset = readUint32LE(view, eocdOffset + 16);

    const entries = new Map();
    let offset = centralDirOffset;
    const CENTRAL_FILE_HEADER_SIG = 0x02014b50;

    for (let i = 0; i < entryCount; i++) {
      const sig = readUint32LE(view, offset);
      if (sig !== CENTRAL_FILE_HEADER_SIG) {
        throw new Error("Повреждён центральный каталог ZIP (запись " + i + ")");
      }
      const compressionMethod = readUint16LE(view, offset + 10);
      const compressedSize = readUint32LE(view, offset + 20);
      const uncompressedSize = readUint32LE(view, offset + 24);
      const fileNameLength = readUint16LE(view, offset + 28);
      const extraFieldLength = readUint16LE(view, offset + 30);
      const fileCommentLength = readUint16LE(view, offset + 32);
      const localHeaderOffset = readUint32LE(view, offset + 42);

      const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
      const fileName = new TextDecoder("utf-8").decode(nameBytes);

      entries.set(fileName, {
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }

    return entries;
  }

  // Извлекает содержимое одного файла из архива по его центральной записи.
  async function extractEntry(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const LOCAL_FILE_HEADER_SIG = 0x04034b50;

    const sig = readUint32LE(view, entry.localHeaderOffset);
    if (sig !== LOCAL_FILE_HEADER_SIG) {
      throw new Error("Повреждён локальный заголовок файла в ZIP");
    }
    const fileNameLength = readUint16LE(view, entry.localHeaderOffset + 26);
    const extraFieldLength = readUint16LE(view, entry.localHeaderOffset + 28);

    const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength;
    const compressedData = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) {
      // STORE - без сжатия
      return compressedData;
    }
    if (entry.compressionMethod === 8) {
      // DEFLATE - распаковываем через нативный DecompressionStream
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      writer.write(compressedData);
      writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(decompressed);
    }
    throw new Error("Неподдерживаемый метод сжатия в ZIP: " + entry.compressionMethod);
  }

  // Основная функция: принимает ArrayBuffer/Uint8Array .docx-файла,
  // возвращает текст word/document.xml.
  async function extractDocxDocumentXml(docxData) {
    const bytes = docxData instanceof Uint8Array ? docxData : new Uint8Array(docxData);
    const entries = readCentralDirectory(bytes);

    const entry = entries.get("word/document.xml");
    if (!entry) {
      throw new Error("В файле нет word/document.xml - это не похоже на .docx");
    }

    const xmlBytes = await extractEntry(bytes, entry);
    return new TextDecoder("utf-8").decode(xmlBytes);
  }

  // ---------------------------------------------------------------------
  // Запись ZIP (метод STORE - без сжатия). Нужна для сборки .xlsx на
  // выходе: .xlsx - тоже просто zip-архив с XML внутри, а хранение файлов
  // без сжатия внутри zip полностью валидно (Excel/Google Таблицы читают
  // такие файлы без проблем) и не требует CompressionStream.
  // ---------------------------------------------------------------------

  // Таблица CRC32 (стандартный алгоритм, полином 0xEDB88320)
  const CRC32_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // DOS date/time (упрощённо - текущая дата/время, точность не важна для
  // читателей xlsx, они ей не пользуются для отображения данных).
  function dosDateTime() {
    const d = new Date();
    const dosTime =
      ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
    const dosDate =
      (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
    return { dosTime, dosDate };
  }

  function writeUint16LE(arr, offset, value) {
    arr[offset] = value & 0xff;
    arr[offset + 1] = (value >>> 8) & 0xff;
  }
  function writeUint32LE(arr, offset, value) {
    arr[offset] = value & 0xff;
    arr[offset + 1] = (value >>> 8) & 0xff;
    arr[offset + 2] = (value >>> 16) & 0xff;
    arr[offset + 3] = (value >>> 24) & 0xff;
  }

  // files: массив { name: string, data: Uint8Array }
  // Возвращает Uint8Array готового zip-архива.
  function createZip(files) {
    const encoder = new TextEncoder();
    const { dosTime, dosDate } = dosDateTime();

    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      writeUint32LE(localHeader, 0, 0x04034b50);
      writeUint16LE(localHeader, 4, 20); // version needed
      writeUint16LE(localHeader, 6, 0); // flags
      writeUint16LE(localHeader, 8, 0); // method = STORE
      writeUint16LE(localHeader, 10, dosTime);
      writeUint16LE(localHeader, 12, dosDate);
      writeUint32LE(localHeader, 14, crc);
      writeUint32LE(localHeader, 18, data.length); // compressed size
      writeUint32LE(localHeader, 22, data.length); // uncompressed size
      writeUint16LE(localHeader, 26, nameBytes.length);
      writeUint16LE(localHeader, 28, 0); // extra field length
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      writeUint32LE(centralHeader, 0, 0x02014b50);
      writeUint16LE(centralHeader, 4, 20); // version made by
      writeUint16LE(centralHeader, 6, 20); // version needed
      writeUint16LE(centralHeader, 8, 0); // flags
      writeUint16LE(centralHeader, 10, 0); // method = STORE
      writeUint16LE(centralHeader, 12, dosTime);
      writeUint16LE(centralHeader, 14, dosDate);
      writeUint32LE(centralHeader, 16, crc);
      writeUint32LE(centralHeader, 20, data.length);
      writeUint32LE(centralHeader, 24, data.length);
      writeUint16LE(centralHeader, 28, nameBytes.length);
      // extra field length(30), comment length(32), disk number(34),
      // internal attrs(36) - все 0, оставляем нулями
      writeUint32LE(centralHeader, 38, 0); // external attrs
      writeUint32LE(centralHeader, 42, offset); // local header offset
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    }

    const centralDirOffset = offset;
    let centralSize = 0;
    for (const p of centralParts) centralSize += p.length;

    const eocd = new Uint8Array(22);
    writeUint32LE(eocd, 0, 0x06054b50);
    writeUint16LE(eocd, 4, 0); // disk number
    writeUint16LE(eocd, 6, 0); // disk with central dir
    writeUint16LE(eocd, 8, files.length); // entries on this disk
    writeUint16LE(eocd, 10, files.length); // total entries
    writeUint32LE(eocd, 12, centralSize);
    writeUint32LE(eocd, 16, centralDirOffset);
    writeUint16LE(eocd, 20, 0); // comment length

    const allParts = localParts.concat(centralParts, [eocd]);
    let totalLength = 0;
    for (const p of allParts) totalLength += p.length;

    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const p of allParts) {
      result.set(p, pos);
      pos += p.length;
    }
    return result;
  }

  global.MiniZip = {
    extractDocxDocumentXml: extractDocxDocumentXml,
    createZip: createZip,
  };
})(typeof window !== "undefined" ? window : globalThis);
