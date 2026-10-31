/* ===========================================================================
   pdfparse.js
   Версия: 1.0 (31.10)
   Самописный (без сторонних библиотек) разбор текста из .pdf в ТОЧНО ТАКУЮ ЖЕ
   структуру глав -> абзацев, что у fb2parse.js / epubparse.js, — экран чтения
   в my.js (закладки, подчёркивания, позиция чтения) работает с PDF как с
   обычной книгой. Картинок и вёрстки страниц нет: достаётся только текст.

   Экспорт window.PdfParse:
     parsePdf(buffer, opts) -> Promise<{chapters, images, title, author, pageCount}>
         chapters: {id:null, index, title, blocks:[{type:"paragraph", runs:[{text,bold,italic}]}]}[]
         images:   всегда {} (контракт fb2parse.js)
         opts: {onProgress(done,total), pagesPerChapter (по умолчанию 10)}
     extractPages(buffer, opts) -> Promise<{pages:[{lines:[{text,x,endX,y,fs}]}], pageCount, title, author, stats}>
         построчный текст каждой страницы (для поиска по тексту PDF)
     pagesToParagraphs(pages) -> [{page, text}]   — склейка строк в абзацы

   Что умеет: поиск объектов сканированием файла (не зависит от битой
   xref-таблицы), потоки объектов (ObjStm), фильтры Flate/ASCIIHex/ASCII85/
   LZW/RunLength (+PNG-предикторы), дерево страниц, шрифты с ToUnicode,
   простые шрифты с Encoding/Differences, составные шрифты Identity-H,
   формы (XObject Form) с текстом. Текст всех страниц «как есть» из
   видимого и невидимого слоя (OCR-слой сканов тоже читается).
   Чего НЕ умеет: зашифрованные PDF (бросает ошибку), сканы без текстового
   слоя (бросает ошибку), шрифты без ToUnicode с кодами-номерами глифов
   (такие символы пропускаются), повёрнутый текст.
   Зависит от MiniDeflate.inflateRawSync (minideflate.js, идёт раньше).
   =========================================================================== */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------- типы PDF
  function PName(n) { this.n = n; }
  function PStr(s) { this.s = s; }
  function PRef(num) { this.num = num; }
  function PKw(k) { this.k = k; }
  function PStream(dict, start, end) { this.dict = dict; this.start = start; this.end = end; this.cache = undefined; }

  var P = 0;          // позиция после последнего parseValue
  var NOREF = false;  // в потоке содержимого «n g R» ссылкой не считается

  function isWs(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0; }
  function isDelim(c) {
    return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0 ||
      c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  }
  function skipWs(s, p) {
    var n = s.length;
    while (p < n) {
      var c = s.charCodeAt(p);
      if (isWs(c)) p++;
      else if (c === 37) { while (p < n) { c = s.charCodeAt(p); if (c === 10 || c === 13) break; p++; } }
      else break;
    }
    return p;
  }
  function decodeName(raw) {
    if (raw.indexOf("#") < 0) return raw;
    return raw.replace(/#([0-9A-Fa-f]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function readLiteral(s, p) { // s[p] === "("
    var n = s.length, depth = 1, out = [], i = p + 1;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 92) { // backslash
        i++;
        var e = s.charCodeAt(i);
        if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
        else if (e === 98) out.push(8); else if (e === 102) out.push(12);
        else if (e >= 48 && e <= 55) {
          var v = e - 48, k = 1;
          while (k < 3) { var d = s.charCodeAt(i + 1); if (d >= 48 && d <= 55) { v = v * 8 + d - 48; i++; k++; } else break; }
          out.push(v & 255);
        } else if (e === 13) { if (s.charCodeAt(i + 1) === 10) i++; }
        else if (e === 10) { /* продолжение строки */ }
        else if (!isNaN(e)) out.push(e);
        i++;
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) { depth--; if (depth === 0) { i++; break; } }
      out.push(c);
      i++;
    }
    P = i;
    return bytesToStr(out);
  }
  function bytesToStr(arr) {
    var out = "", CH = 8192;
    for (var i = 0; i < arr.length; i += CH) out += String.fromCharCode.apply(null, arr.slice ? arr.slice(i, i + CH) : Array.prototype.slice.call(arr, i, i + CH));
    return out;
  }
  function hexToStr(h) {
    h = h.replace(/[^0-9A-Fa-f]/g, "");
    if (h.length % 2) h += "0";
    var out = [];
    for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return bytesToStr(out);
  }
  function isDigitC(c) { return c >= 48 && c <= 57; }

  function parseValue(s, p) {
    p = skipWs(s, p);
    var n = s.length;
    if (p >= n) { P = p; return null; }
    var c = s.charCodeAt(p);
    if (c === 47) { // /Name
      var j = p + 1;
      while (j < n && !isDelim(s.charCodeAt(j))) j++;
      P = j;
      return new PName(decodeName(s.substring(p + 1, j)));
    }
    if (c === 40) return new PStr(readLiteral(s, p));
    if (c === 60) {
      if (s.charCodeAt(p + 1) === 60) { // << dict >>
        var d = Object.create(null);
        p += 2;
        for (;;) {
          p = skipWs(s, p);
          if (p >= n) break;
          if (s.charCodeAt(p) === 62 && s.charCodeAt(p + 1) === 62) { p += 2; break; }
          var k = parseValue(s, p);
          p = P;
          if (!(k instanceof PName)) { if (p >= n) break; continue; }
          var v = parseValue(s, p);
          p = P;
          d[k.n] = v;
        }
        P = p;
        return d;
      }
      var e = s.indexOf(">", p + 1);
      if (e < 0) e = n;
      P = e + 1;
      return new PStr(hexToStr(s.substring(p + 1, e)));
    }
    if (c === 91) { // [ array ]
      var arr = [];
      p++;
      for (;;) {
        p = skipWs(s, p);
        if (p >= n) break;
        if (s.charCodeAt(p) === 93) { p++; break; }
        var before = p;
        arr.push(parseValue(s, p));
        p = P;
        if (p === before) p++; // защита от зацикливания
      }
      P = p;
      return arr;
    }
    if (isDigitC(c) || c === 43 || c === 45 || c === 46) {
      var q = p + 1;
      while (q < n) { var cc = s.charCodeAt(q); if (isDigitC(cc) || cc === 46) q++; else break; }
      var txt = s.substring(p, q);
      var num = parseFloat(txt);
      if (isNaN(num)) num = 0;
      // «n g R» — ссылка
      if (!NOREF && c !== 43 && c !== 45 && c !== 46 && txt.indexOf(".") < 0) {
        var r = skipWs(s, q);
        if (r > q && isDigitC(s.charCodeAt(r))) {
          var r2 = r;
          while (r2 < n && isDigitC(s.charCodeAt(r2))) r2++;
          var r3 = skipWs(s, r2);
          if (r3 > r2 && s.charCodeAt(r3) === 82 && (r3 + 1 >= n || isDelim(s.charCodeAt(r3 + 1)))) {
            P = r3 + 1;
            return new PRef(num);
          }
        }
      }
      P = q;
      return num;
    }
    // ключевое слово
    var w = p;
    while (w < n && !isDelim(s.charCodeAt(w))) w++;
    if (w === p) { P = p + 1; return null; }
    var kw = s.substring(p, w);
    P = w;
    if (kw === "true") return true;
    if (kw === "false") return false;
    if (kw === "null") return null;
    return new PKw(kw);
  }

  // ------------------------------------------------------------- фильтры
  function strToBytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
    return out;
  }
  function bytesToLatin1(u8, from, to) {
    var out = "", CH = 8192;
    from = from || 0; to = (to === undefined) ? u8.length : to;
    for (var i = from; i < to; i += CH) out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(to, i + CH)));
    return out;
  }
  function flate(data) {
    var md = global.MiniDeflate;
    if (!md || !md.inflateRawSync) throw new Error("Не загружен minideflate.js");
    var off = 0;
    if (data.length > 2 && (data[0] & 15) === 8 && (((data[0] << 8) | data[1]) % 31) === 0) off = 2;
    return md.inflateRawSync(off ? data.subarray(off) : data);
  }
  function applyPredictor(data, parms) {
    if (!parms) return data;
    var pred = +parms.Predictor || 1;
    if (pred < 10) return data; // TIFF-предиктор не поддерживается — на практике не встречается у потоков с текстом
    var colors = +parms.Colors || 1, bpc = +parms.BitsPerComponent || 8, cols = +parms.Columns || 1;
    var bpp = Math.max(1, (colors * bpc) >> 3), rowLen = Math.ceil(colors * bpc * cols / 8);
    var rows = Math.floor(data.length / (rowLen + 1));
    var out = new Uint8Array(rows * rowLen);
    var prev = new Uint8Array(rowLen), cur = new Uint8Array(rowLen);
    for (var r = 0; r < rows; r++) {
      var ft = data[r * (rowLen + 1)], base = r * (rowLen + 1) + 1, i;
      for (i = 0; i < rowLen; i++) {
        var x = data[base + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, v;
        if (ft === 0) v = x;
        else if (ft === 1) v = x + a;
        else if (ft === 2) v = x + b;
        else if (ft === 3) v = x + ((a + b) >> 1);
        else if (ft === 4) {
          var pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
        } else v = x;
        cur[i] = v & 255;
      }
      out.set(cur, r * rowLen);
      var t = prev; prev = cur; cur = t;
    }
    return out;
  }
  function asciiHex(data) {
    var s = bytesToLatin1(data), e = s.indexOf(">");
    return strToBytes(hexToStr(e >= 0 ? s.substring(0, e) : s));
  }
  function ascii85(data) {
    var out = [], grp = [], n = data.length, i = 0;
    if (data[0] === 60 && data[1] === 126) i = 2; // <~
    for (; i < n; i++) {
      var c = data[i];
      if (c === 126) break; // ~>
      if (isWs(c)) continue;
      if (c === 122 && grp.length === 0) { out.push(0, 0, 0, 0); continue; }
      if (c < 33 || c > 117) continue;
      grp.push(c - 33);
      if (grp.length === 5) {
        var v = ((((grp[0] * 85 + grp[1]) * 85 + grp[2]) * 85 + grp[3]) * 85 + grp[4]);
        out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
        grp = [];
      }
    }
    if (grp.length > 1) {
      var m = grp.length;
      while (grp.length < 5) grp.push(84);
      var w = ((((grp[0] * 85 + grp[1]) * 85 + grp[2]) * 85 + grp[3]) * 85 + grp[4]);
      var bs = [(w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];
      for (var k = 0; k < m - 1; k++) out.push(bs[k]);
    }
    return new Uint8Array(out);
  }
  function runLength(data) {
    var out = [], i = 0, n = data.length;
    while (i < n) {
      var l = data[i++];
      if (l === 128) break;
      if (l < 128) { for (var k = 0; k <= l && i < n; k++) out.push(data[i++]); }
      else { var b = data[i++]; for (var k2 = 0; k2 < 257 - l; k2++) out.push(b); }
    }
    return new Uint8Array(out);
  }
  function lzw(data, early) {
    var out = [], dict = [], i, bits = 9, next = 258, prev = null, buf = 0, cnt = 0, pos = 0;
    function reset() { dict = []; for (i = 0; i < 256; i++) dict[i] = [i]; bits = 9; next = 258; prev = null; }
    reset();
    for (;;) {
      while (cnt < bits && pos < data.length) { buf = (buf << 8) | data[pos++]; cnt += 8; }
      if (cnt < bits) break;
      var code = (buf >> (cnt - bits)) & ((1 << bits) - 1);
      cnt -= bits; buf &= (1 << cnt) - 1;
      if (code === 256) { reset(); continue; }
      if (code === 257) break;
      var entry;
      if (code < next && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat(prev[0]);
      else break;
      for (i = 0; i < entry.length; i++) out.push(entry[i]);
      if (prev) { dict[next++] = prev.concat(entry[0]); }
      prev = entry;
      var lim = next + (early ? 1 : 0);
      if (lim >= 4096) bits = 12; else if (lim >= 2048) bits = 12; else if (lim >= 1024) bits = 11; else if (lim >= 512) bits = 10; else bits = 9;
    }
    return new Uint8Array(out);
  }

  // ------------------------------------------------------------- документ
  function Doc(buffer) {
    this.bytes = (buffer instanceof Uint8Array) ? buffer : new Uint8Array(buffer);
    this.s = bytesToLatin1(this.bytes);
    this.offsets = Object.create(null); // номер объекта -> смещение начала значения
    this.cache = Object.create(null);
    this.objstm = null;                 // номер -> {text, off} из потоков объектов
    this.objstmBuilt = false;
    this.fontCache = [];
    this.scan();
  }
  Doc.prototype.scan = function () {
    var re = /(\d+)\s+(\d+)\s+obj\b/g, m, s = this.s;
    this.order = []; // смещения по возрастанию — для запасного поиска страниц
    while ((m = re.exec(s)) !== null) {
      this.offsets[m[1]] = m.index + m[0].length;
      this.order.push({ num: +m[1], off: m.index });
    }
  };
  Doc.prototype.getObj = function (num) {
    var key = String(num);
    if (key in this.cache) return this.cache[key];
    var val = null, savedNoref = NOREF;
    NOREF = false; // ссылки «n g R» внутри объектов нужны всегда (даже если вызвали из потока содержимого)
    try {
      if (key in this.offsets) {
        val = this.readAt(this.offsets[key]);
      } else {
        this.buildObjStm();
        var e = this.objstm[key];
        if (e) { val = parseValue(e.text, e.off); }
      }
    } catch (err) { val = null; }
    NOREF = savedNoref;
    this.cache[key] = val;
    return val;
  };
  Doc.prototype.readAt = function (off) {
    var s = this.s;
    var v = parseValue(s, off);
    var p = skipWs(s, P);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === null && s.substr(p, 6) === "stream") {
      p += 6;
      if (s.charCodeAt(p) === 13) { p++; if (s.charCodeAt(p) === 10) p++; }
      else if (s.charCodeAt(p) === 10) p++;
      var len = this.R(v.Length), end = -1;
      if (typeof len === "number" && len >= 0 && p + len <= s.length) {
        var q = skipWs(s, p + len);
        if (s.substr(q, 9) === "endstream") end = p + len;
      }
      if (end < 0) {
        var e = s.indexOf("endstream", p);
        if (e < 0) e = s.length;
        end = e;
        if (s.charCodeAt(end - 1) === 10) end--;
        if (s.charCodeAt(end - 1) === 13) end--;
      }
      return new PStream(v, p, end);
    }
    return v;
  };
  Doc.prototype.buildObjStm = function () {
    if (this.objstmBuilt) return;
    this.objstmBuilt = true;
    this.objstm = Object.create(null);
    var s = this.s, self = this;
    this.order.forEach(function (o) {
      var head = s.substr(self.offsets[o.num], 700);
      if (!/\/Type\s*\/ObjStm/.test(head)) return;
      try {
        var st = self.getObj(o.num);
        if (!(st instanceof PStream)) return;
        var data = self.decode(st);
        if (!data) return;
        var text = bytesToLatin1(data);
        var n = +self.R(st.dict.N) || 0, first = +self.R(st.dict.First) || 0;
        var p = 0, i, nums = [], offs = [];
        for (i = 0; i < n; i++) {
          var a = parseValue(text, p); p = P;
          var b = parseValue(text, p); p = P;
          nums.push(a); offs.push(b);
        }
        for (i = 0; i < n; i++) {
          var k = String(nums[i]);
          if (!(k in self.offsets) && !(k in self.objstm)) self.objstm[k] = { text: text, off: first + offs[i] };
        }
      } catch (e) { /* битый поток объектов — пропускаем */ }
    });
  };
  Doc.prototype.R = function (v) { // разыменование
    var guard = 0;
    while (v instanceof PRef && guard++ < 20) v = this.getObj(v.num);
    return v;
  };
  Doc.prototype.D = function (v) { // словарь объекта или потока
    v = this.R(v);
    if (v instanceof PStream) return v.dict;
    return (v && typeof v === "object" && !(v instanceof Array) && !(v instanceof PStr) && !(v instanceof PName) && !(v instanceof PKw)) ? v : null;
  };
  Doc.prototype.A = function (v) { v = this.R(v); return (v instanceof Array) ? v : null; };
  Doc.prototype.N = function (v) { v = this.R(v); return (v instanceof PName) ? v.n : null; };
  Doc.prototype.decode = function (st) {
    if (st.cache !== undefined) return st.cache;
    var data = this.bytes.subarray(st.start, st.end), self = this, result = data;
    try {
      var f = this.R(st.dict.Filter), parms = this.R(st.dict.DecodeParms || st.dict.DP);
      var fl = f instanceof Array ? f : (f ? [f] : []);
      var pl = parms instanceof Array ? parms : [parms];
      for (var i = 0; i < fl.length; i++) {
        var fn = this.N(fl[i]), pr = this.D(pl[i]);
        if (fn === "FlateDecode" || fn === "Fl") result = applyPredictor(flate(result), pr);
        else if (fn === "ASCIIHexDecode" || fn === "AHx") result = asciiHex(result);
        else if (fn === "ASCII85Decode" || fn === "A85") result = ascii85(result);
        else if (fn === "LZWDecode" || fn === "LZW") result = applyPredictor(lzw(result, !pr || pr.EarlyChange === undefined || +pr.EarlyChange !== 0), pr);
        else if (fn === "RunLengthDecode" || fn === "RL") result = runLength(result);
        else if (fn === "Crypt") { /* без шифрования */ }
        else { result = null; break; } // DCT/JPX/CCITT — изображения
      }
    } catch (e) { result = null; }
    st.cache = result;
    return result;
  };
  Doc.prototype.streamText = function (v) {
    v = this.R(v);
    if (!(v instanceof PStream)) return null;
    var d = this.decode(v);
    return d ? bytesToLatin1(d) : null;
  };

  Doc.prototype.isEncrypted = function () {
    return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(this.s);
  };
  Doc.prototype.rootRef = function () {
    var re = /\/Root\s+(\d+)\s+\d+\s+R/g, m, last = null, s = this.s;
    while ((m = re.exec(s)) !== null) last = +m[1];
    return last;
  };
  Doc.prototype.info = function () {
    var re = /\/Info\s+(\d+)\s+\d+\s+R/g, m, last = null;
    while ((m = re.exec(this.s)) !== null) last = +m[1];
    var d = last !== null ? this.D(new PRef(last)) : null, self = this;
    function str(v) {
      v = self.R(v);
      if (!(v instanceof PStr)) return "";
      var t = v.s;
      if (t.charCodeAt(0) === 254 && t.charCodeAt(1) === 255) {
        var o = "";
        for (var i = 2; i + 1 < t.length; i += 2) o += String.fromCharCode((t.charCodeAt(i) << 8) | t.charCodeAt(i + 1));
        return o;
      }
      try { return new TextDecoder("windows-1252").decode(strToBytes(t)); } catch (e) { return t; }
    }
    return d ? { title: str(d.Title), author: str(d.Author) } : { title: "", author: "" };
  };

  // Список страниц с унаследованными ресурсами
  Doc.prototype.pages = function () {
    var out = [], self = this, seen = Object.create(null), count = 0;
    var root = this.rootRef();
    var cat = root !== null ? this.D(new PRef(root)) : null;
    function walk(node, inheritedRes, depth) {
      if (depth > 40 || count > 200000) return;
      var d = self.D(node);
      if (!d) return;
      if (node instanceof PRef) { if (seen[node.num]) return; seen[node.num] = true; }
      count++;
      var res = d.Resources !== undefined ? d.Resources : inheritedRes;
      var kids = self.A(d.Kids);
      if (kids && self.N(d.Type) !== "Page") {
        for (var i = 0; i < kids.length; i++) walk(kids[i], res, depth + 1);
      } else {
        out.push({ dict: d, res: res });
      }
    }
    if (cat && cat.Pages) walk(cat.Pages, undefined, 0);
    if (!out.length) { // запасной путь: все объекты /Type /Page
      var re = /\/Type\s*\/Page(?![A-Za-z])/g, m, s = this.s;
      var order = this.order;
      while ((m = re.exec(s)) !== null) {
        var lo = 0, hi = order.length - 1, f = -1;
        while (lo <= hi) { var mid = (lo + hi) >> 1; if (order[mid].off <= m.index) { f = mid; lo = mid + 1; } else hi = mid - 1; }
        if (f >= 0) { var d2 = this.D(new PRef(order[f].num)); if (d2 && !seen["p" + order[f].num]) { seen["p" + order[f].num] = true; out.push({ dict: d2, res: d2.Resources }); } }
      }
    }
    return out;
  };

  // ------------------------------------------------------------- кодировки
  function buildByteTable(label) {
    var t = [], i;
    var dec = null;
    try { dec = new TextDecoder(label); } catch (e) { dec = null; }
    for (i = 0; i < 256; i++) {
      var ch;
      if (dec) { try { ch = dec.decode(new Uint8Array([i])); } catch (e2) { ch = String.fromCharCode(i); } }
      else ch = String.fromCharCode(i);
      var cc = ch.charCodeAt(0);
      if (i < 32 || (cc >= 127 && cc <= 159)) ch = "";
      t.push(ch);
    }
    t[32] = " ";
    return t;
  }
  var ENC_CACHE = {};
  function baseEncoding(name) {
    if (name === "MacRomanEncoding") return ENC_CACHE.mac || (ENC_CACHE.mac = buildByteTable("macintosh"));
    return ENC_CACHE.win || (ENC_CACHE.win = buildByteTable("windows-1252"));
  }
  var GLYPHS = {
    space: " ", exclam: "!", quotedbl: "\"", numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'",
    parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-", period: ".", slash: "/",
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
    colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[",
    backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|",
    braceright: "}", asciitilde: "~", endash: "\u2013", emdash: "\u2014", quoteleft: "\u2018", quoteright: "\u2019",
    quotedblleft: "\u201C", quotedblright: "\u201D", quotesinglbase: "\u201A", quotedblbase: "\u201E", bullet: "\u2022",
    ellipsis: "\u2026", guillemotleft: "\u00AB", guillemotright: "\u00BB", section: "\u00A7", degree: "\u00B0",
    copyright: "\u00A9", registered: "\u00AE", trademark: "\u2122", fi: "fi", fl: "fl", ff: "ff", ffi: "ffi", ffl: "ffl",
    nbspace: " ", nonbreakingspace: " ", minus: "\u2212", multiply: "\u00D7", divide: "\u00F7", plusminus: "\u00B1",
    Euro: "\u20AC", afii61352: "\u2116", numero: "\u2116", periodcentered: "\u00B7", paragraph: "\u00B6",
    dagger: "\u2020", daggerdbl: "\u2021", perthousand: "\u2030", guilsinglleft: "\u2039", guilsinglright: "\u203A"
  };
  var CYR_UP = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ", CYR_LO = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
  function glyphToUnicode(name) {
    if (!name) return "";
    if (GLYPHS.hasOwnProperty(name)) return GLYPHS[name];
    if (name.length === 1) return name;
    var m = /^uni([0-9A-Fa-f]{4})/.exec(name);
    if (m) return String.fromCharCode(parseInt(m[1], 16));
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
    if (m) { var cp = parseInt(m[1], 16); return cp > 0xFFFF ? String.fromCodePoint(cp) : String.fromCharCode(cp); }
    m = /^afii(\d+)$/.exec(name);
    if (m) {
      var a = +m[1];
      if (a >= 10017 && a <= 10049) return CYR_UP.charAt(a - 10017);
      if (a >= 10065 && a <= 10097) return CYR_LO.charAt(a - 10065);
    }
    return "";
  }

  // ------------------------------------------------------------- ToUnicode
  function hexU16(h) { // hex-строка -> строка (UTF-16BE; один байт — код символа)
    h = h.replace(/\s+/g, "");
    if (h.length <= 2) return String.fromCharCode(parseInt(h || "0", 16));
    var out = "";
    for (var i = 0; i + 3 < h.length; i += 4) out += String.fromCharCode(parseInt(h.substr(i, 4), 16));
    return out;
  }
  function parseToUnicode(text, font) {
    var uni = Object.create(null), m, bytes = 0;
    var cs = /begincodespacerange([\s\S]*?)endcodespacerange/g, blk;
    while ((blk = cs.exec(text)) !== null) {
      var hx = /<([0-9A-Fa-f]+)>/.exec(blk[1]);
      if (hx) { bytes = Math.max(bytes, Math.ceil(hx[1].length / 2)); }
    }
    var bc = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((blk = bc.exec(text)) !== null) {
      var re1 = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g;
      while ((m = re1.exec(blk[1])) !== null) uni[parseInt(m[1].replace(/\s+/g, ""), 16)] = hexU16(m[2]);
    }
    var br = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((blk = br.exec(text)) !== null) {
      var re2 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f\s]*>|\[[^\]]*\])/g;
      while ((m = re2.exec(blk[1])) !== null) {
        var lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = m[3], k;
        if (hi - lo > 65535) continue;
        if (dst.charAt(0) === "[") {
          var items = dst.match(/<[0-9A-Fa-f\s]*>/g) || [];
          for (k = 0; k < items.length && lo + k <= hi; k++) uni[lo + k] = hexU16(items[k].slice(1, -1));
        } else {
          var base = hexU16(dst.slice(1, -1));
          if (!base) continue;
          var head = base.slice(0, -1), lastc = base.charCodeAt(base.length - 1);
          for (k = 0; lo + k <= hi; k++) uni[lo + k] = head + String.fromCharCode((lastc + k) & 0xFFFF);
        }
      }
    }
    font.uni = uni;
    if (bytes) font.bytes = bytes;
  }

  // ------------------------------------------------------------- шрифты
  Doc.prototype.getFont = function (fv) {
    var fd = this.D(fv);
    if (!fd) return null;
    if (fd.__pf) return fd.__pf;
    var f;
    try { f = this.buildFont(fd); } catch (e) { f = null; }
    if (!f) f = { cid: false, bytes: 1, uni: null, enc: baseEncoding("WinAnsiEncoding"), widths: null, first: 0, missing: 500, dw: 1000, wmap: null, wscale: 1 };
    fd.__pf = f;
    return f;
  };
  Doc.prototype.buildFont = function (fd) {
    var self = this;
    var f = { cid: false, bytes: 1, uni: null, enc: null, widths: null, first: 0, missing: 0, dw: 1000, wmap: null, wscale: 1 };
    var sub = this.N(fd.Subtype);
    if (sub === "Type0") {
      f.cid = true; f.bytes = 2;
      var dfs = this.A(fd.DescendantFonts), desc = dfs ? this.D(dfs[0]) : null;
      if (desc) {
        f.dw = typeof this.R(desc.DW) === "number" ? this.R(desc.DW) : 1000;
        var w = this.A(desc.W);
        if (w) {
          f.wmap = Object.create(null);
          var i = 0;
          while (i < w.length) {
            var c1 = this.R(w[i]), second = this.R(w[i + 1]);
            if (second instanceof Array) {
              for (var k = 0; k < second.length; k++) f.wmap[c1 + k] = +this.R(second[k]) || 0;
              i += 2;
            } else {
              var c2 = second, wv = +this.R(w[i + 2]) || 0;
              if (typeof c1 === "number" && typeof c2 === "number" && c2 - c1 < 70000) for (var c = c1; c <= c2; c++) f.wmap[c] = wv;
              i += 3;
            }
          }
        }
      }
    } else {
      var first = +this.R(fd.FirstChar) || 0, ws = this.A(fd.Widths);
      var fdesc = this.D(fd.FontDescriptor);
      f.first = first;
      f.missing = fdesc && typeof this.R(fdesc.MissingWidth) === "number" ? this.R(fdesc.MissingWidth) : (ws ? 0 : 500);
      if (ws) { f.widths = ws.map(function (x) { return +self.R(x) || 0; }); }
      if (sub === "Type3") {
        var fm = this.A(fd.FontMatrix);
        f.wscale = fm ? (+this.R(fm[0]) || 0.001) * 1000 : 1;
      }
      var enc = this.R(fd.Encoding), table, baseName = "WinAnsiEncoding";
      if (enc instanceof PName) baseName = enc.n;
      else if (enc && !(enc instanceof PStream) && typeof enc === "object") {
        var bn = this.N(enc.BaseEncoding); if (bn) baseName = bn;
      }
      table = baseEncoding(baseName).slice();
      var encD = this.D(enc);
      var diffs = encD ? this.A(encD.Differences) : null;
      if (diffs) {
        var code = 0;
        for (var j = 0; j < diffs.length; j++) {
          var it = this.R(diffs[j]);
          if (typeof it === "number") code = it;
          else if (it instanceof PName) { var ch = glyphToUnicode(it.n); if (code < 256) table[code] = ch; code++; }
        }
      }
      f.enc = table;
    }
    var tu = this.streamText(fd.ToUnicode);
    if (tu) parseToUnicode(tu, f);
    return f;
  };
  function glyphWidth(f, code) { // в тысячных долях em
    if (f.cid) { var w = f.wmap ? f.wmap[code] : undefined; return w === undefined ? f.dw : w; }
    if (f.widths) {
      var i = code - f.first;
      if (i >= 0 && i < f.widths.length) return f.widths[i] * f.wscale;
      return f.missing * f.wscale;
    }
    return code === 32 ? 278 : 550;
  }
  function glyphText(f, code) {
    if (f.uni) { var u = f.uni[code]; if (u !== undefined) return u; }
    if (f.enc) return f.enc[code] || "";
    return "";
  }

  // ------------------------------------------------------------- матрицы
  function mul(m, n) {
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  }

  // ------------------------------------------------------------- содержимое страницы
  // Сборка строк: куски текста с позициями собираются в «ряды» по базовой линии подряд идущих
  // кусков (некоторые генераторы, например LibreOffice, выводят куски одной строки в порядке
  // шрифтов, а не слева направо), при закрытии ряда куски сортируются по x и склеиваются.
  function LineBuilder() { this.lines = []; this.cur = null; }
  LineBuilder.prototype.add = function (text, x, endX, y, fs) {
    if (!text) return;
    var c = this.cur;
    if (!fs || fs < 1) fs = 10;
    if (c && Math.abs(y - c.y) <= Math.max(c.fs, fs) * 0.45) {
      c.chunks.push({ text: text, x: x, endX: endX, i: c.chunks.length });
      if (fs > c.fs) c.fs = fs;
    } else {
      this.flush();
      this.cur = { y: y, fs: fs, chunks: [{ text: text, x: x, endX: endX, i: 0 }] };
    }
  };
  LineBuilder.prototype.flush = function () {
    var c = this.cur;
    if (!c) return;
    this.cur = null;
    var ch = c.chunks;
    if (ch.length > 1) ch.sort(function (a, b) { return (a.x - b.x) || (a.i - b.i); });
    var text = "", endX = ch[0].endX;
    for (var k = 0; k < ch.length; k++) {
      var it = ch[k];
      if (k > 0) {
        var gap = it.x - endX;
        if (gap > c.fs * 0.16 && text.charAt(text.length - 1) !== " " && it.text.charAt(0) !== " ") text += " ";
      }
      text += it.text;
      if (it.endX > endX) endX = it.endX;
    }
    text = text.replace(/[\u00A0\u2000-\u200B\u202F\u3000]/g, " ").replace(/[ \t]+/g, " ").replace(/^ +| +$/g, "");
    if (text) this.lines.push({ text: text, x: ch[0].x, endX: endX, y: c.y, fs: c.fs });
  };

  var LIGATURES = { "\uFB00": "ff", "\uFB01": "fi", "\uFB02": "fl", "\uFB03": "ffi", "\uFB04": "ffl", "\uFB05": "st", "\uFB06": "st" };
  function fixText(t) {
    return t.replace(/[\uFB00-\uFB06]/g, function (c) { return LIGATURES[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g, "");
  }

  function runContent(doc, src, res, st, depth, lb, stats) {
    var n = src.length, i = 0, ops = [], resD = doc.D(res);
    var fonts = resD ? doc.D(resD.Font) : null;
    var xobjs = resD ? doc.D(resD.XObject) : null;
    NOREF = true;
    try {
      while (i < n) {
        var c = src.charCodeAt(i);
        if (c <= 32) { i++; continue; }
        if (c === 37) { while (i < n && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++; continue; }
        if (c === 47 || c === 40 || c === 60 || c === 91 || c === 43 || c === 45 || c === 46 || (c >= 48 && c <= 57)) {
          var before = i;
          ops.push(parseValue(src, i));
          i = P;
          if (i === before) i++;
          if (ops.length > 600) ops.shift();
          continue;
        }
        if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { i++; continue; }
        // оператор
        var j = i;
        while (j < n && !isDelim(src.charCodeAt(j))) j++;
        var op = src.substring(i, j);
        i = j;
        if (op === "BI") { // встроенная картинка — пропускаем целиком
          var m = /[\s]ID[\s]/g; m.lastIndex = i;
          var idm = m.exec(src);
          if (idm) {
            var em = /[\s]EI(?=[\s]|$)/g; em.lastIndex = idm.index + idm[0].length;
            var eim = em.exec(src);
            i = eim ? eim.index + eim[0].length : n;
          } else i = n;
          ops.length = 0;
          continue;
        }
        stepOp(op);
        ops.length = 0;
      }
    } finally { NOREF = false; }

    function num(k) { var v = ops[k]; return typeof v === "number" ? v : 0; }
    function setText(a, b, c2, d, e, f) { st.tm = [a, b, c2, d, e, f]; st.tlm = st.tm.slice(); }
    function nextLine(tx, ty) {
      st.tlm = mul([1, 0, 0, 1, tx, ty], st.tlm);
      st.tm = st.tlm.slice();
    }
    function showStr(str) {
      var f = st.g.font, fsz = st.g.fs, th = st.g.th;
      var M = mul(st.tm, st.g.ctm);
      var text = "", adv = 0;
      var bytes = f ? f.bytes : 1, k = 0, len = str.length;
      while (k < len) {
        var code;
        if (bytes === 2 && k + 1 < len) { code = (str.charCodeAt(k) << 8) | str.charCodeAt(k + 1); k += 2; }
        else if (bytes === 3 && k + 2 < len) { code = (str.charCodeAt(k) << 16) | (str.charCodeAt(k + 1) << 8) | str.charCodeAt(k + 2); k += 3; }
        else if (bytes === 4 && k + 3 < len) { code = ((str.charCodeAt(k) << 24) >>> 0) + (str.charCodeAt(k + 1) << 16) + (str.charCodeAt(k + 2) << 8) + str.charCodeAt(k + 3); k += 4; }
        else { code = str.charCodeAt(k); k++; }
        var w = f ? glyphWidth(f, code) : (code === 32 ? 278 : 550);
        var t = f ? glyphText(f, code) : String.fromCharCode(code);
        if (t) { text += t; stats.mapped++; } else if (code !== 32) stats.unmapped++;
        adv += (w / 1000 * fsz + st.g.tc + ((bytes === 1 && code === 32) ? st.g.tw : 0)) * th;
      }
      var scaleY = Math.sqrt(M[2] * M[2] + M[3] * M[3]) || 1;
      var endX = M[4] + adv * M[0];
      if (text) { stats.shows++; lb.add(fixText(text), M[4], endX, M[5] + st.g.rise * scaleY, fsz * scaleY); }
      st.tm = mul([1, 0, 0, 1, adv, 0], st.tm);
    }
    function stepOp(op) {
      var g = st.g;
      switch (op) {
        case "q": st.stack.push({ ctm: g.ctm, font: g.font, fs: g.fs, tc: g.tc, tw: g.tw, th: g.th, tl: g.tl, rise: g.rise }); break;
        case "Q": if (st.stack.length) { var o = st.stack.pop(); g.ctm = o.ctm; g.font = o.font; g.fs = o.fs; g.tc = o.tc; g.tw = o.tw; g.th = o.th; g.tl = o.tl; g.rise = o.rise; } break;
        case "cm": g.ctm = mul([num(0), num(1), num(2), num(3), num(4), num(5)], g.ctm); break;
        case "BT": st.tm = [1, 0, 0, 1, 0, 0]; st.tlm = [1, 0, 0, 1, 0, 0]; break;
        case "ET": break;
        case "Tc": g.tc = num(0); break;
        case "Tw": g.tw = num(0); break;
        case "Tz": g.th = (ops.length ? num(0) : 100) / 100; break;
        case "TL": g.tl = num(0); break;
        case "Ts": g.rise = num(0); break;
        case "Tf":
          g.fs = num(1);
          g.font = null;
          if (ops[0] instanceof PName && fonts && fonts[ops[0].n] !== undefined) g.font = doc.getFont(fonts[ops[0].n]);
          break;
        case "Td": nextLine(num(0), num(1)); break;
        case "TD": g.tl = -num(1); nextLine(num(0), num(1)); break;
        case "Tm": setText(num(0), num(1), num(2), num(3), num(4), num(5)); break;
        case "T*": nextLine(0, -g.tl); break;
        case "Tj": if (ops[0] instanceof PStr) showStr(ops[0].s); break;
        case "'": nextLine(0, -g.tl); if (ops[0] instanceof PStr) showStr(ops[0].s); break;
        case "\"": g.tw = num(0); g.tc = num(1); nextLine(0, -g.tl); if (ops[2] instanceof PStr) showStr(ops[2].s); break;
        case "TJ":
          if (ops[0] instanceof Array) {
            var arr = ops[0];
            for (var a = 0; a < arr.length; a++) {
              var it = arr[a];
              if (it instanceof PStr) showStr(it.s);
              else if (typeof it === "number") st.tm = mul([1, 0, 0, 1, -it / 1000 * g.fs * g.th, 0], st.tm);
            }
          }
          break;
        case "Do":
          if (depth < 6 && ops[0] instanceof PName && xobjs && xobjs[ops[0].n] !== undefined) {
            var xo = doc.R(xobjs[ops[0].n]);
            if (xo instanceof PStream && doc.N(xo.dict.Subtype) === "Form" && !xo.__busy) {
              var body = doc.streamText(xo);
              if (body) {
                xo.__busy = true;
                var saveG = { ctm: g.ctm, font: g.font, fs: g.fs, tc: g.tc, tw: g.tw, th: g.th, tl: g.tl, rise: g.rise };
                var saveTm = st.tm, saveTlm = st.tlm, saveStack = st.stack;
                var mat = doc.A(xo.dict.Matrix);
                if (mat && mat.length >= 6) g.ctm = mul([+doc.R(mat[0]) || 0, +doc.R(mat[1]) || 0, +doc.R(mat[2]) || 0, +doc.R(mat[3]) || 0, +doc.R(mat[4]) || 0, +doc.R(mat[5]) || 0], g.ctm);
                st.stack = [];
                var wasNoref = NOREF;
                try { runContent(doc, body, xo.dict.Resources !== undefined ? xo.dict.Resources : res, st, depth + 1, lb, stats); } catch (e) { /* форма битая — пропускаем */ }
                NOREF = wasNoref;
                st.g.ctm = saveG.ctm; st.g.font = saveG.font; st.g.fs = saveG.fs; st.g.tc = saveG.tc; st.g.tw = saveG.tw; st.g.th = saveG.th; st.g.tl = saveG.tl; st.g.rise = saveG.rise;
                st.tm = saveTm; st.tlm = saveTlm; st.stack = saveStack;
                xo.__busy = false;
              }
            }
          }
          break;
        default: break;
      }
    }
  }

  function pageContent(doc, page) {
    var cv = doc.R(page.dict.Contents), parts = [];
    if (cv instanceof Array) {
      for (var i = 0; i < cv.length; i++) { var t = doc.streamText(cv[i]); if (t) parts.push(t); }
    } else if (cv instanceof PStream) {
      var t2 = doc.streamText(cv); if (t2) parts.push(t2);
    }
    return parts.join("\n");
  }

  // ------------------------------------------------------------- извлечение страниц
  function yieldUi() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function extractPages(buffer, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var doc;
      try {
        doc = new Doc(buffer);
        if (doc.s.indexOf("%PDF-") < 0 || doc.s.indexOf("%PDF-") > 2048) throw new Error("Файл не похож на PDF или повреждён.");
        if (doc.isEncrypted()) throw new Error("PDF зашифрован (защищён паролем или ограничениями) — такие файлы пока не читаются.");
      } catch (e) { reject(e); return; }
      var pages;
      try { pages = doc.pages(); } catch (e2) { reject(new Error("Не удалось разобрать структуру PDF: " + (e2 && e2.message ? e2.message : e2))); return; }
      if (!pages.length) { reject(new Error("В PDF не найдено страниц.")); return; }
      var info = doc.info(), out = [], stats = { mapped: 0, unmapped: 0, shows: 0 }, idx = 0, tStart = Date.now();
      function step() {
        var tSlice = Date.now();
        while (idx < pages.length) {
          var pg = pages[idx], lb = new LineBuilder();
          try {
            var src = pageContent(doc, pg);
            var st = { g: { ctm: [1, 0, 0, 1, 0, 0], font: null, fs: 10, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 }, stack: [], tm: [1, 0, 0, 1, 0, 0], tlm: [1, 0, 0, 1, 0, 0] };
            runContent(doc, src, pg.res, st, 0, lb, stats);
          } catch (e3) { /* страница не читается — остаётся пустой */ }
          lb.flush();
          out.push({ lines: lb.lines });
          idx++;
          if (opts.onProgress && (idx % 5 === 0 || idx === pages.length)) { try { opts.onProgress(idx, pages.length); } catch (e4) {} }
          if (Date.now() - tSlice > 40) { yieldUi().then(step); return; }
        }
        doc = null;
        resolve({ pages: out, pageCount: pages.length, title: info.title, author: info.author, stats: stats });
      }
      step();
    });
  }

  // ------------------------------------------------------------- абзацы
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[a.length >> 1];
  }
  function isLowerStart(t) { var c = t.charAt(0); return c !== "" && c === c.toLowerCase() && c !== c.toUpperCase(); }
  var END_PUNCT = /[.!?…:;»”"')\]]$/;

  // Склейка строк страниц в абзацы: [{page, text}] (нумерация страниц с 0)
  function pagesToParagraphs(pages) {
    var paras = [];
    pages.forEach(function (pg, pi) {
      var lines = pg.lines.slice();
      // номера страниц: одиночное число сверху или снизу
      if (lines.length > 1) {
        if (/^\d{1,4}$/.test(lines[lines.length - 1].text)) lines.pop();
        if (lines.length > 1 && /^\d{1,4}$/.test(lines[0].text)) lines.shift();
      }
      if (!lines.length) return;
      var lefts = lines.map(function (l) { return l.x; });
      var bodyLeft = median(lefts);
      var maxRight = 0;
      lines.forEach(function (l) { if (l.endX > maxRight) maxRight = l.endX; });
      var maxW = Math.max(1, maxRight - bodyLeft);
      var pitches = [];
      for (var k = 1; k < lines.length; k++) { var dy = lines[k - 1].y - lines[k].y; if (dy > 0) pitches.push(dy); }
      var pitch = median(pitches) || 12;
      var cur = null, prev = null;
      lines.forEach(function (l) {
        if (!cur) { cur = { page: pi, text: l.text }; prev = l; return; }
        var dy2 = prev.y - l.y;
        var prevW = prev.endX - bodyLeft;
        var brk = false;
        if (dy2 > pitch * 1.45 || dy2 < -pitch * 0.5) brk = true;                          // пустая строка между / скачок вверх
        else if (l.x - bodyLeft > Math.max(l.fs, 8) * 0.8 && prev.x - bodyLeft <= Math.max(l.fs, 8) * 0.8) brk = true; // красная строка
        else if (Math.abs(l.fs - prev.fs) > Math.max(prev.fs, l.fs) * 0.08) brk = true;    // смена кегля (заголовок)
        else if (prevW < maxW * 0.7) brk = true;                                            // короткая строка закрывает абзац
        else if (prevW < maxW * 0.88 && END_PUNCT.test(prev.text)) brk = true;
        if (brk) { paras.push(cur); cur = { page: pi, text: l.text }; }
        else if (/[-\u00AD]$/.test(cur.text) && isLowerStart(l.text) && /[A-Za-zА-Яа-яЁё][-\u00AD]$/.test(cur.text)) cur.text = cur.text.replace(/[-\u00AD]$/, "") + l.text;
        else cur.text += " " + l.text;
        prev = l;
      });
      if (cur) paras.push(cur);
    });
    // абзац, оборванный границей страницы: «…и потом» + «продолжение…»
    var merged = [];
    paras.forEach(function (p) {
      var last = merged[merged.length - 1];
      if (last && p.page === last.page + 1 && !END_PUNCT.test(last.text) && isLowerStart(p.text)) {
        if (/[-\u00AD]$/.test(last.text)) last.text = last.text.replace(/[-\u00AD]$/, "") + p.text;
        else last.text += " " + p.text;
      } else merged.push(p);
    });
    return merged.filter(function (p) { return p.text.replace(/\s+/g, "").length > 0; });
  }

  function parsePdf(buffer, opts) {
    opts = opts || {};
    var per = opts.pagesPerChapter > 0 ? opts.pagesPerChapter : 10;
    return extractPages(buffer, opts).then(function (r) {
      var paras = pagesToParagraphs(r.pages);
      if (!paras.length) {
        if (r.stats.unmapped > 0 && r.stats.mapped === 0) throw new Error("Не удалось извлечь текст из PDF: в нём нестандартные шрифты без таблицы символов.");
        throw new Error("В этом PDF нет текстового слоя (это скан или набор картинок) — читать его как книгу нельзя.");
      }
      var chapters = [], byChapter = {};
      paras.forEach(function (p) {
        var ci = Math.floor(p.page / per);
        var ch = byChapter[ci];
        if (!ch) {
          var from = ci * per + 1, to = Math.min(r.pageCount, (ci + 1) * per);
          ch = byChapter[ci] = { id: null, index: 0, title: from === to ? "Стр. " + from : "Стр. " + from + "–" + to, blocks: [] };
          chapters.push(ch);
        }
        ch.blocks.push({ type: "paragraph", runs: [{ text: p.text, bold: false, italic: false }] });
      });
      chapters.forEach(function (c, i) { c.index = i; });
      return { chapters: chapters, images: {}, title: r.title, author: r.author, pageCount: r.pageCount };
    });
  }

  global.PdfParse = { parsePdf: parsePdf, extractPages: extractPages, pagesToParagraphs: pagesToParagraphs };
})(typeof window !== "undefined" ? window : globalThis);
