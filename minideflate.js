/* ===========================================================================
   minideflate.js
   Версия: 1.0 (09.10)
   Самописный (без сторонних библиотек) запасной вариант для сжатия/распаковки
   raw DEFLATE (RFC 1951) — для браузеров, где нет формата "deflate-raw" в
   DecompressionStream/CompressionStream (он появился только в Chrome 103;
   в Android WebView 95 конструктор бросает TypeError).

   API (window.MiniDeflate):
     inflateRaw(bytes, sizeHint?) -> Promise<Uint8Array>
         Сначала пробует нативный DecompressionStream("deflate-raw"), при
         отсутствии формата или ошибке — своя распаковка (inflateRawSync).
     deflateRaw(bytes) -> Promise<{method:8, data:Uint8Array}>
         Сначала нативный CompressionStream("deflate-raw"), иначе свой
         сжиматель (LZ77 + фиксированные коды Хаффмана — валидный DEFLATE,
         блок BTYPE=01; степень сжатия чуть хуже zlib, но формат настоящий).
     inflateRawSync(bytes, sizeHint?) -> Uint8Array
     deflateRawSync(bytes) -> Uint8Array
   Используют: minizip.js, jwlmerge.js, epubsplit.js (должен идти в index.html
   ДО них).
   =========================================================================== */

(function (global) {
  "use strict";

  var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  // ---------------------------------------------------------------------
  // РАСПАКОВКА
  // ---------------------------------------------------------------------

  // Каноническая таблица Хаффмана (как в puff.c): count[len] — сколько кодов
  // длины len, symbol[] — символы в порядке кодов.
  function buildHuff(lengths, n) {
    var count = new Uint16Array(16);
    var symbol = new Uint16Array(n);
    var offs = new Uint16Array(16);
    var i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
    for (i = 0; i < n; i++) {
      if (lengths[i] !== 0) symbol[offs[lengths[i]]++] = i;
    }
    return { count: count, symbol: symbol };
  }

  var fixedLit = null, fixedDist = null;
  function getFixedTables() {
    if (!fixedLit) {
      var l = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      fixedLit = buildHuff(l, 288);
      var d = new Uint8Array(30);
      for (i = 0; i < 30; i++) d[i] = 5;
      fixedDist = buildHuff(d, 30);
    }
  }

  function inflateRawSync(src, sizeHint) {
    var pos = 0, bitbuf = 0, bitcnt = 0, slen = src.length;
    var out = new Uint8Array(sizeHint > 0 ? sizeHint : Math.max(1024, slen * 4));
    var op = 0;

    function ensure(n) {
      if (op + n > out.length) {
        var t = new Uint8Array(Math.max(out.length * 2, op + n));
        t.set(out.subarray(0, op));
        out = t;
      }
    }

    function bits(n) {
      var v = bitbuf;
      while (bitcnt < n) {
        if (pos >= slen) throw new Error("inflate: неожиданный конец данных");
        v |= src[pos++] << bitcnt;
        bitcnt += 8;
      }
      bitbuf = v >>> n;
      bitcnt -= n;
      return v & ((1 << n) - 1);
    }

    function decode(h) {
      var code = 0, first = 0, index = 0, cnt, len;
      var count = h.count, symbol = h.symbol;
      for (len = 1; len <= 15; len++) {
        if (bitcnt === 0) {
          if (pos >= slen) throw new Error("inflate: неожиданный конец данных");
          bitbuf = src[pos++];
          bitcnt = 8;
        }
        code |= bitbuf & 1;
        bitbuf >>>= 1;
        bitcnt--;
        cnt = count[len];
        if (code - cnt < first) return symbol[index + (code - first)];
        index += cnt;
        first += cnt;
        first <<= 1;
        code <<= 1;
      }
      throw new Error("inflate: неверный код Хаффмана");
    }

    function codes(lh, dh) {
      for (;;) {
        var sym = decode(lh);
        if (sym < 256) {
          if (op >= out.length) ensure(1);
          out[op++] = sym;
        } else if (sym === 256) {
          return;
        } else {
          sym -= 257;
          if (sym >= 29) throw new Error("inflate: неверный код длины");
          var len = LBASE[sym] + bits(LEXT[sym]);
          var ds = decode(dh);
          if (ds >= 30) throw new Error("inflate: неверный код расстояния");
          var dist = DBASE[ds] + bits(DEXT[ds]);
          if (dist > op) throw new Error("inflate: расстояние за пределами данных");
          ensure(len);
          var from = op - dist;
          while (len--) out[op++] = out[from++];
        }
      }
    }

    var last, type, i;
    do {
      last = bits(1);
      type = bits(2);
      if (type === 0) {
        // Несжатый блок: после заголовка в буфере меньше байта — отбрасываем.
        bitbuf = 0;
        bitcnt = 0;
        if (pos + 4 > slen) throw new Error("inflate: неожиданный конец данных");
        var len = src[pos] | (src[pos + 1] << 8);
        var nlen = src[pos + 2] | (src[pos + 3] << 8);
        if ((len ^ 0xffff) !== nlen) throw new Error("inflate: повреждён несжатый блок");
        pos += 4;
        if (pos + len > slen) throw new Error("inflate: неожиданный конец данных");
        ensure(len);
        out.set(src.subarray(pos, pos + len), op);
        op += len;
        pos += len;
      } else if (type === 1) {
        getFixedTables();
        codes(fixedLit, fixedDist);
      } else if (type === 2) {
        var nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4;
        if (nl > 286 || nd > 30) throw new Error("inflate: неверное число кодов");
        var cl = new Uint8Array(19);
        for (i = 0; i < nc; i++) cl[CL_ORDER[i]] = bits(3);
        var clh = buildHuff(cl, 19);
        var total = nl + nd;
        var ls = new Uint8Array(total);
        i = 0;
        while (i < total) {
          var s = decode(clh);
          if (s < 16) {
            ls[i++] = s;
          } else {
            var prev = 0, rep;
            if (s === 16) {
              if (i === 0) throw new Error("inflate: повтор без предыдущей длины");
              prev = ls[i - 1];
              rep = 3 + bits(2);
            } else if (s === 17) {
              rep = 3 + bits(3);
            } else {
              rep = 11 + bits(7);
            }
            if (i + rep > total) throw new Error("inflate: слишком много длин");
            while (rep--) ls[i++] = prev;
          }
        }
        codes(buildHuff(ls.subarray(0, nl), nl), buildHuff(ls.subarray(nl), nd));
      } else {
        throw new Error("inflate: неверный тип блока");
      }
    } while (!last);

    return op === out.length ? out : out.slice(0, op);
  }

  // ---------------------------------------------------------------------
  // СЖАТИЕ (LZ77 + фиксированные коды Хаффмана, один блок)
  // ---------------------------------------------------------------------

  function reverseBits(code, n) {
    var r = 0;
    for (var i = 0; i < n; i++) { r = (r << 1) | (code & 1); code >>= 1; }
    return r;
  }

  var enc = null;
  function getEncTables() {
    if (enc) return enc;
    var litCode = new Uint16Array(288), litLen = new Uint8Array(288), i;
    for (i = 0; i < 288; i++) {
      var c, n;
      if (i < 144)      { c = 0x30 + i;         n = 8; }
      else if (i < 256) { c = 0x190 + (i - 144); n = 9; }
      else if (i < 280) { c = i - 256;          n = 7; }
      else              { c = 0xc0 + (i - 280); n = 8; }
      litCode[i] = reverseBits(c, n);
      litLen[i] = n;
    }
    var distCode = new Uint8Array(30);
    for (i = 0; i < 30; i++) distCode[i] = reverseBits(i, 5);
    // длина (3..258) -> номер символа длины
    var lenSym = new Uint8Array(259);
    for (i = 0; i < 29; i++) {
      var top = i === 28 ? 258 : LBASE[i + 1] - 1;
      for (var l = LBASE[i]; l <= top; l++) lenSym[l] = i;
    }
    lenSym[258] = 28;
    enc = { litCode: litCode, litLen: litLen, distCode: distCode, lenSym: lenSym };
    return enc;
  }

  function deflateRawSync(src) {
    var t = getEncTables();
    var n = src.length;
    var out = new Uint8Array(Math.max(64, (n >> 1) + 64));
    var op = 0, bitbuf = 0, bitcnt = 0;

    function put(value, nbits) {
      bitbuf |= value << bitcnt;
      bitcnt += nbits;
      while (bitcnt >= 8) {
        if (op >= out.length) {
          var nb = new Uint8Array(out.length * 2);
          nb.set(out);
          out = nb;
        }
        out[op++] = bitbuf & 0xff;
        bitbuf >>>= 8;
        bitcnt -= 8;
      }
    }

    put(1, 1); // BFINAL=1
    put(1, 2); // BTYPE=01 (фиксированные коды)

    var HSIZE = 1 << 15, WMASK = 32767, MAX_CHAIN = 24;
    var head = new Int32Array(HSIZE).fill(-1);
    var prev = new Int32Array(WMASK + 1);
    var i = 0;

    function insert(p) {
      if (p + 2 >= n) return;
      var h = ((src[p] << 10) ^ (src[p + 1] << 5) ^ src[p + 2]) & (HSIZE - 1);
      prev[p & WMASK] = head[h];
      head[h] = p;
    }

    while (i < n) {
      var bestLen = 0, bestDist = 0;
      if (i + 2 < n) {
        var h = ((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & (HSIZE - 1);
        var cand = head[h], chain = MAX_CHAIN;
        var maxLen = n - i < 258 ? n - i : 258;
        while (cand >= 0 && i - cand <= 32768 && chain-- > 0) {
          if (src[cand + bestLen] === src[i + bestLen] && src[cand] === src[i]) {
            var l = 0;
            while (l < maxLen && src[cand + l] === src[i + l]) l++;
            if (l > bestLen) {
              bestLen = l;
              bestDist = i - cand;
              if (l === maxLen) break;
            }
          }
          var nx = prev[cand & WMASK];
          if (nx >= cand) break;
          cand = nx;
        }
      }
      if (bestLen >= 3) {
        var ls = t.lenSym[bestLen];
        var sym = 257 + ls;
        put(t.litCode[sym], t.litLen[sym]);
        if (LEXT[ls]) put(bestLen - LBASE[ls], LEXT[ls]);
        var ds = 29;
        while (DBASE[ds] > bestDist) ds--;
        put(t.distCode[ds], 5);
        if (DEXT[ds]) put(bestDist - DBASE[ds], DEXT[ds]);
        for (var k = 0; k < bestLen; k++) insert(i + k);
        i += bestLen;
      } else {
        put(t.litCode[src[i]], t.litLen[src[i]]);
        insert(i);
        i++;
      }
    }
    put(t.litCode[256], t.litLen[256]); // конец блока
    if (bitcnt > 0) put(0, 8 - bitcnt);
    return out.slice(0, op);
  }

  // ---------------------------------------------------------------------
  // Асинхронные обёртки: нативный поток, при невозможности — свой код
  // ---------------------------------------------------------------------

  var nativeInflateOk = typeof DecompressionStream !== "undefined";
  var nativeDeflateOk = typeof CompressionStream !== "undefined";

  function inflateRaw(bytes, sizeHint) {
    return new Promise(function (resolve, reject) {
      function fallback() {
        try { resolve(inflateRawSync(bytes, sizeHint)); } catch (e) { reject(e); }
      }
      if (!nativeInflateOk) { fallback(); return; }
      var p;
      try {
        var ds = new DecompressionStream("deflate-raw");
        p = new Response(new Response(bytes).body.pipeThrough(ds)).arrayBuffer();
      } catch (e) {
        nativeInflateOk = false; // формата нет в этом браузере — больше не пробуем
        fallback();
        return;
      }
      p.then(function (buf) { resolve(new Uint8Array(buf)); }, fallback);
    });
  }

  function deflateRaw(bytes) {
    return new Promise(function (resolve, reject) {
      function fallback() {
        try {
          var d = deflateRawSync(bytes);
          // сжатие не дало выигрыша (уже сжатые данные) — храним как есть
          resolve(d.length >= bytes.length ? { method: 0, data: bytes } : { method: 8, data: d });
        } catch (e) { reject(e); }
      }
      if (!nativeDeflateOk) { fallback(); return; }
      var p;
      try {
        var cs = new CompressionStream("deflate-raw");
        p = new Response(new Response(bytes).body.pipeThrough(cs)).arrayBuffer();
      } catch (e) {
        nativeDeflateOk = false;
        fallback();
        return;
      }
      p.then(function (buf) { resolve({ method: 8, data: new Uint8Array(buf) }); }, fallback);
    });
  }

  global.MiniDeflate = {
    inflateRaw: inflateRaw,
    deflateRaw: deflateRaw,
    inflateRawSync: inflateRawSync,
    deflateRawSync: deflateRawSync
  };
})(typeof window !== "undefined" ? window : globalThis);
