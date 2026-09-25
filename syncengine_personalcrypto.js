// syncengine_personalcrypto.js
// Версия: 1.1 (18.09)
//
// TASK_UNIFIED_SYNC.md, Шаг 2, часть 2 из 3: схема шифрования ЛИЧНЫМ ключом
// пользователя для sync-engine (личные задачи, настройки, заметки — всё, что
// принадлежит одному аккаунту и не делится с группой).
//
// Три части шага 2 (все готовы, 18.09):
//   1. реальный транспорт (Realtime Database) — syncengine_transport.js;
//   2. личный ключ пользователя — ЭТОТ ФАЙЛ;
//   3. групповой ключ — syncengine_groupcrypto.js (тот же алгоритм и формат).
// Как и весь шаг 2, файл НЕ подключён ни к одному реальному экрану/данным
// (my.js/mdeditor.js не тронуты, в index.html не подключён).
//
// Ключ: SHA-256(syncId) -> сырой AES-256-GCM. Это тот же приём, что уже
// работает в проекте: getFileCryptoKey в my.js (файлы реле) и, по комментарию
// там же, getNotesCryptoKey в mdeditor.js (заметки). syncId у всех устройств
// одного аккаунта одинаковый (подключение по коду), поэтому и ключ одинаковый —
// без обмена ключами. Замечание про модель угроз (не новое, унаследовано из
// текущего проекта): syncId одновременно является путём в БД
// (/syncs/<syncId>/), т.е. знающий путь может вывести и ключ.
//
// ФОРМАТ значения — СВЕРЕН с реальным кодом my.js (encryptGroupContent /
// decryptGroupContent, ~стр. 4835-4856): ОДНА base64-строка, в которой первые
// 12 байт — IV, остальное — шифротекст AES-GCM (вместе с 16-байтовым тегом).
// Тот же формат используют файлы реле (IV первыми 12 байтами тела). Тест
// syncengine_personalcrypto_test.js содержит дословную копию алгоритма
// encryptGroupContent/decryptGroupContent и проверяет совместимость в обе
// стороны — расшифровку «старого» вывода новым кодом и наоборот.
//
// ⚠️ Не сверено: точный формат текста ЗАМЕТОК в mdeditor.js (файл в этой
// сессии не загружался, PROJECT_MAP_MDEDITOR.md — тоже). Перед шагом 5
// (перенос заметок) сверить формат с этим модулем так же, как здесь сверен
// формат my.js.
//
// ⚠️ syncId может смениться (выход из синка / joinWithCode — my.js меняет
// переменную syncId). Хуки привязаны к конкретному syncId при создании:
// после смены syncId нужно вызвать makePersonalHooks заново, старые хуки
// продолжат работать со старым ключом.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEnginePersonalCrypto = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IV_BYTES = 12;   // рекомендованный размер IV для AES-GCM
  var TAG_BYTES = 16;  // длина тега аутентификации AES-GCM

  function getCrypto() {
    var c = (typeof crypto !== 'undefined' && crypto) ||
      (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (!c || !c.subtle) {
      throw new Error('[SyncEnginePersonalCrypto] Web Crypto API недоступен в этом окружении');
    }
    return c;
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function validateSyncId(syncId) {
    if (typeof syncId !== 'string' || !syncId) {
      throw new Error('[SyncEnginePersonalCrypto] syncId должен быть непустой строкой');
    }
  }

  /**
   * derivePersonalKey(syncId) -> Promise<CryptoKey>
   * Ключ = SHA-256(syncId) как сырые 256 бит AES-GCM. Детерминирован:
   * все устройства одного аккаунта получают один и тот же ключ.
   */
  async function derivePersonalKey(syncId) {
    validateSyncId(syncId);
    var subtle = getCrypto().subtle;
    var hash = await subtle.digest('SHA-256', new TextEncoder().encode(syncId));
    return subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /**
   * encryptForUser(key, data) -> Promise<string>
   * data — любое JSON-сериализуемое значение. Результат — одна base64-строка
   * IV(12) ‖ ciphertext, готовая для записи значением в Realtime Database.
   */
  async function encryptForUser(key, data) {
    var c = getCrypto();
    var iv = c.getRandomValues(new Uint8Array(IV_BYTES));
    var plaintext = new TextEncoder().encode(JSON.stringify(data));
    var cipher = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext));
    var out = new Uint8Array(iv.length + cipher.length);
    out.set(iv, 0);
    out.set(cipher, iv.length);
    return bytesToBase64(out);
  }

  /**
   * decryptForUser(key, payload) -> Promise<data>
   * Бросает исключение на повреждённый/подделанный payload, некорректный
   * формат или неподходящий ключ (чужой syncId) — штатное поведение
   * AES-GCM. Что делать с ошибкой (пропустить запись + залогировать),
   * решает транспорт (syncengine_transport.js): плохая запись пропускается.
   */
  async function decryptForUser(key, payload) {
    if (typeof payload !== 'string' || !payload) {
      throw new Error('[SyncEnginePersonalCrypto] некорректный формат payload');
    }
    // Строгая проверка алфавита: Buffer.from(...,'base64') в Node молча
    // пропускает посторонние символы, а atob в браузере бросает исключение —
    // без этой проверки поведение на «мусорных» данных расходилось бы.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
      throw new Error('[SyncEnginePersonalCrypto] некорректный формат payload (не base64)');
    }
    var arr = base64ToBytes(payload);
    if (arr.length < IV_BYTES + TAG_BYTES) {
      throw new Error('[SyncEnginePersonalCrypto] payload слишком короткий');
    }
    var iv = arr.slice(0, IV_BYTES);
    var cipher = arr.slice(IV_BYTES);
    var plain = await getCrypto().subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /**
   * makePersonalHooks(syncId) -> { encryptHook, decryptHook }
   * Готовый объект под config.encryptHook/decryptHook в registerStore.
   * Некорректный syncId бросает исключение сразу (синхронно), а не
   * «необработанным реджектом» позже. Ключ выводится лениво при первом
   * вызове и кешируется.
   */
  function makePersonalHooks(syncId) {
    validateSyncId(syncId);
    var keyPromise = null;
    function getKey() {
      if (!keyPromise) keyPromise = derivePersonalKey(syncId);
      return keyPromise;
    }
    return {
      encryptHook: async function (data) {
        return encryptForUser(await getKey(), data);
      },
      decryptHook: async function (payload) {
        return decryptForUser(await getKey(), payload);
      },
    };
  }

  return {
    derivePersonalKey: derivePersonalKey,
    encryptForUser: encryptForUser,
    decryptForUser: decryptForUser,
    makePersonalHooks: makePersonalHooks,
  };
});
