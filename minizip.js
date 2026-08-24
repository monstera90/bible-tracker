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

  global.MiniZip = {
    extractDocxDocumentXml: extractDocxDocumentXml,
  };
})(typeof window !== "undefined" ? window : globalThis);
