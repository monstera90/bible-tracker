// syncengine_groupcrypto.js
// Версия: 1.1 (18.09)
//
// TASK_UNIFIED_SYNC.md, Шаг 2, часть 3 из 3: схема шифрования групповым
// ключом (SHA-256(groupId), как сейчас у общих задач) для sync-engine.
//
// Как и весь шаг 2, файл НЕ подключён ни к одному реальному экрану/данным
// (my.js/mdeditor.js не тронуты) — подключение будет сделано вместе с первым
// реальным store, как и сам syncengine.js.
//
// Контракт: движок (syncengine.js) хранит в config store encryptHook/
// decryptHook и отдаёт их транспорту (syncengine_transport.js) через
// engine.getStoreConfig. Этот файл — готовая реализация ГРУППОВОЙ схемы:
// makeGroupHooks(groupId) -> { encryptHook, decryptHook }.
//
// Алгоритм: ключ = SHA-256(groupId) как сырые 256 бит AES-GCM — один и тот
// же groupId у всех участников детерминированно даёт один и тот же ключ, без
// обмена ключами. На каждое шифрование — новый случайный IV (12 байт).
//
// ФОРМАТ значения (v1.1, 18.09) — СВЕРЕН с реальным кодом my.js
// (encryptGroupContent/decryptGroupContent): ОДНА base64-строка, первые
// 12 байт — IV, остальное — шифротекст AES-GCM вместе с 16-байтовым тегом.
// В v1.0 здесь был формат "<iv>.<ct>" — он НЕ был совместим со старым
// клиентом (найдено при сверке в части 2), исправлено. Тест
// syncengine_groupcrypto_test.js содержит дословную копию алгоритма из
// my.js и проверяет совместимость в обе стороны.
//
// По устройству это тот же алгоритм, что в syncengine_personalcrypto.js
// (там ключ от syncId, здесь от groupId) — файлы намеренно независимы
// (каждый подключается отдельным <script>), поэтому небольшое дублирование.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncEngineGroupCrypto = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IV_BYTES = 12;   // рекомендованный размер IV для AES-GCM
  var TAG_BYTES = 16;  // длина тега аутентификации AES-GCM

  function getCrypto() {
    var c = (typeof crypto !== 'undefined' && crypto) ||
      (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (!c || !c.subtle) {
      throw new Error('[SyncEngineGroupCrypto] Web Crypto API недоступен в этом окружении');
    }
    return c;
  }

  // Строка <-> base64 без сторонних библиотек, работает и в браузере, и в Node.
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

  function validateGroupId(groupId) {
    if (typeof groupId !== 'string' || !groupId) {
      throw new Error('[SyncEngineGroupCrypto] groupId должен быть непустой строкой');
    }
  }

  /**
   * deriveGroupKey(groupId) -> Promise<CryptoKey>
   * Ключ = SHA-256(groupId), импортирован как сырой AES-256-GCM ключ.
   */
  async function deriveGroupKey(groupId) {
    validateGroupId(groupId);
    var subtle = getCrypto().subtle;
    var hash = await subtle.digest('SHA-256', new TextEncoder().encode(groupId));
    return subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /**
   * encryptForGroup(key, data) -> Promise<string>
   * data — любое JSON-сериализуемое значение. Результат — одна base64-строка
   * IV(12) ‖ ciphertext, готовая для записи значением в Realtime Database
   * (поле `c` записи {c, t}).
   */
  async function encryptForGroup(key, data) {
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
   * decryptForGroup(key, payload) -> Promise<data>
   * Бросает исключение на повреждённый/подделанный payload, некорректный
   * формат или неподходящий ключ (чужой groupId) — штатное поведение
   * AES-GCM. Что делать с ошибкой (пропустить запись + сообщить), решает
   * транспорт (syncengine_transport.js): одна плохая запись не должна
   * ронять всю загрузку.
   */
  async function decryptForGroup(key, payload) {
    if (typeof payload !== 'string' || !payload) {
      throw new Error('[SyncEngineGroupCrypto] некорректный формат payload');
    }
    // Строгая проверка алфавита: Buffer.from(...,'base64') в Node молча
    // пропускает посторонние символы, а atob в браузере бросает исключение —
    // без проверки поведение на «мусорных» данных расходилось бы.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
      throw new Error('[SyncEngineGroupCrypto] некорректный формат payload (не base64)');
    }
    var arr = base64ToBytes(payload);
    if (arr.length < IV_BYTES + TAG_BYTES) {
      throw new Error('[SyncEngineGroupCrypto] payload слишком короткий');
    }
    var iv = arr.slice(0, IV_BYTES);
    var cipher = arr.slice(IV_BYTES);
    var plain = await getCrypto().subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /**
   * makeGroupHooks(groupId) -> { encryptHook, decryptHook }
   * Готовый объект под config.encryptHook/decryptHook в registerStore.
   * Некорректный groupId бросает исключение сразу (синхронно). Ключ
   * выводится лениво при первом вызове и кешируется.
   */
  function makeGroupHooks(groupId) {
    validateGroupId(groupId);
    var keyPromise = null;
    function getKey() {
      if (!keyPromise) keyPromise = deriveGroupKey(groupId);
      return keyPromise;
    }
    return {
      encryptHook: async function (data) {
        return encryptForGroup(await getKey(), data);
      },
      decryptHook: async function (payload) {
        return decryptForGroup(await getKey(), payload);
      },
    };
  }

  return {
    deriveGroupKey: deriveGroupKey,
    encryptForGroup: encryptForGroup,
    decryptForGroup: decryptForGroup,
    makeGroupHooks: makeGroupHooks,
  };
});
