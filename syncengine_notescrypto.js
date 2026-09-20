// syncengine_notescrypto.js
// Версия: 1.0 (19.09)
//
// TASK_UNIFIED_SYNC.md, Шаг 5.1: схема шифрования ЗАМЕТОК в том виде, в каком
// её пишет и читает реальный mdeditor.js (getNotesCryptoKey /
// encryptNotePayload / decryptNotePayload). Это ОТДЕЛЬНЫЙ файл, а не
// makePersonalHooks из syncengine_personalcrypto.js, потому что ФОРМАТ
// ЗНАЧЕНИЯ У ЗАМЕТОК ДРУГОЙ (сверено с кодом mdeditor.js 3.1, 19.09):
//
//   личные/групповые задачи (personalcrypto/groupcrypto):
//       ОДНА base64-строка  IV(12) ‖ шифротекст
//   ЗАМЕТКИ (mdeditor.js):
//       ОБЪЕКТ { iv: "<base64 12 байт>", data: "<base64 шифротекст+тег>" }
//
// Ключ один и тот же: SHA-256(syncId) → сырой AES-256-GCM (у заметок
// подтверждено кодом, а не только комментарием). Открытый текст — JSON
// {name, path, text} (имя и путь шифруются вместе с текстом). Случайный IV на
// каждую операцию.
//
// Формат старого клиента НЕ меняется: устройство со старой версией читает
// то, что записал новый код, и наоборот (syncengine_notescrypto_test.js
// гоняет РЕАЛЬНЫЙ текст encryptNotePayload/decryptNotePayload из mdeditor.js).
//
// Нигде не подключено (mdeditor.js/my.js не тронуты) — подключение в шаге 5.2.
//
// ⚠️ syncId может смениться (выход из синка / joinWithCode). Хуки привязаны к
// syncId при создании; после смены создавать заново (это делает
// syncengine_notesbinding.js — кеширует хуки по текущему syncId).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEngineNotesCrypto = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IV_BYTES = 12;
  var TAG_BYTES = 16;

  function getCrypto() {
    var c = (typeof crypto !== 'undefined' && crypto) ||
      (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (!c || !c.subtle) {
      throw new Error('[SyncEngineNotesCrypto] Web Crypto API недоступен в этом окружении');
    }
    return c;
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // Строгая проверка алфавита: Buffer.from(..., 'base64') в Node молча
  // пропускает посторонние символы, а atob в браузере бросает исключение —
  // без проверки поведение на «мусорных» данных расходилось бы.
  function base64ToBytes(b64) {
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
      throw new Error('[SyncEngineNotesCrypto] некорректный base64');
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function validateSyncId(syncId) {
    if (typeof syncId !== 'string' || !syncId) {
      throw new Error('[SyncEngineNotesCrypto] syncId должен быть непустой строкой');
    }
  }

  /** deriveNotesKey(syncId) -> Promise<CryptoKey> — SHA-256(syncId) как сырой AES-GCM-256. */
  async function deriveNotesKey(syncId) {
    validateSyncId(syncId);
    var subtle = getCrypto().subtle;
    var hash = await subtle.digest('SHA-256', new TextEncoder().encode(syncId));
    return subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /** encryptNotePayload(key, payload) -> Promise<{iv, data}> — payload = {name, path, text}. */
  async function encryptNotePayload(key, payload) {
    var c = getCrypto();
    var iv = c.getRandomValues(new Uint8Array(IV_BYTES));
    var plain = new TextEncoder().encode(JSON.stringify(payload));
    var cipher = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain));
    return { iv: bytesToBase64(iv), data: bytesToBase64(cipher) };
  }

  /**
   * decryptNotePayload(key, enc) -> Promise<payload>
   * Бросает исключение на чужой ключ, порчу, неверную форму ({iv,data} —
   * строки base64, iv ровно 12 байт). Что делать с ошибкой (пропустить
   * заметку и поднять hadFetchError) решает syncengine_notesbinding.js.
   */
  async function decryptNotePayload(key, enc) {
    if (!enc || typeof enc !== 'object' || typeof enc.iv !== 'string' || typeof enc.data !== 'string') {
      throw new Error('[SyncEngineNotesCrypto] некорректный формат: ожидался объект {iv, data}');
    }
    var iv = base64ToBytes(enc.iv);
    var cipher = base64ToBytes(enc.data);
    if (iv.length !== IV_BYTES) throw new Error('[SyncEngineNotesCrypto] iv должен быть 12 байт');
    if (cipher.length < TAG_BYTES) throw new Error('[SyncEngineNotesCrypto] data слишком короткий');
    var plain = await getCrypto().subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /**
   * makeNotesHooks(syncId) -> { encryptHook, decryptHook }
   * Под контракт config.encryptHook/decryptHook. Некорректный syncId бросает
   * сразу (синхронно). Ключ выводится лениво при первом вызове и кешируется.
   */
  function makeNotesHooks(syncId) {
    validateSyncId(syncId);
    var keyPromise = null;
    function getKey() {
      if (!keyPromise) keyPromise = deriveNotesKey(syncId);
      return keyPromise;
    }
    return {
      encryptHook: async function (payload) { return encryptNotePayload(await getKey(), payload); },
      decryptHook: async function (enc) { return decryptNotePayload(await getKey(), enc); },
    };
  }

  return {
    deriveNotesKey: deriveNotesKey,
    encryptNotePayload: encryptNotePayload,
    decryptNotePayload: decryptNotePayload,
    makeNotesHooks: makeNotesHooks,
  };
});
