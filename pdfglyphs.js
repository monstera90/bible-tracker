/* ===========================================================================
   pdfglyphs.js
   Версия: 1.0 (13.11)
   Восстановление текста из PDF, у которого буквы «зашифрованы» в самом шрифте
   (кракозябры при копировании). Так устроены, например, журналы jw.org: шрифт
   встроен как CFF (Type1C), но кириллические глифы названы латинскими именами
   («т» называется /b, «о» — /backslash…), а таблица ToUnicode повторяет эти
   выдуманные имена. Любой разбор по ToUnicode/именам даёт «b\ b*V\1 \/SZ\h1ab,\».
   Здесь буква определяется по ФОРМЕ глифа: контур из CFF переводится в
   сглаженный «скелет» и сравнивается с эталонами (pdfglyphs_data.js).

   Экспорт window.PdfGlyphs (и module.exports в Node):
     decodeFont(cffBytes, opts) -> {glyphs:{имяГлифа:{c, d}}, byCode:{код:имяГлифа}|null, ok}
         cffBytes: Uint8Array/Array — тело FontFile3 (Type1C), уже распакованное
         opts.slant: tan угла наклона (для курсива; по умолчанию 0)
         c/d — лучшая НЕ латинская буква (кириллица, цифра, знак) и расстояние (меньше = увереннее),
         lc/ld — лучшая латинская буква и расстояние; c = "" если подходящего эталона нет
     parseCFF(bytes), glyphContours(font, gid), describe(contours, slant) — для tools/build_glyph_refs.js
     setRefs(list) — подключить эталоны (pdfglyphs_data.js вызывает сам)
   =========================================================================== */
(function (global) {
  "use strict";
  var STD = [".notdef","space","exclam","quotedbl","numbersign","dollar","percent","ampersand","quoteright","parenleft","parenright","asterisk","plus","comma","hyphen","period","slash","zero","one","two","three","four","five","six","seven","eight","nine","colon","semicolon","less","equal","greater","question","at","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","bracketleft","backslash","bracketright","asciicircum","underscore","quoteleft","a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z","braceleft","bar","braceright","asciitilde","exclamdown","cent","sterling","fraction","yen","florin","section","currency","quotesingle","quotedblleft","guillemotleft","guilsinglleft","guilsinglright","fi","fl","endash","dagger","daggerdbl","periodcentered","paragraph","bullet","quotesinglbase","quotedblbase","quotedblright","guillemotright","ellipsis","perthousand","questiondown","grave","acute","circumflex","tilde","macron","breve","dotaccent","dieresis","ring","cedilla","hungarumlaut","ogonek","caron","emdash","AE","ordfeminine","Lslash","Oslash","OE","ordmasculine","ae","dotlessi","lslash","oslash","oe","germandbls","onesuperior","logicalnot","mu","trademark","Eth","onehalf","plusminus","Thorn","onequarter","divide","brokenbar","degree","thorn","threequarters","twosuperior","registered","minus","eth","multiply","threesuperior","copyright","Aacute","Acircumflex","Adieresis","Agrave","Aring","Atilde","Ccedilla","Eacute","Ecircumflex","Edieresis","Egrave","Iacute","Icircumflex","Idieresis","Igrave","Ntilde","Oacute","Ocircumflex","Odieresis","Ograve","Otilde","Scaron","Uacute","Ucircumflex","Udieresis","Ugrave","Yacute","Ydieresis","Zcaron","aacute","acircumflex","adieresis","agrave","aring","atilde","ccedilla","eacute","ecircumflex","edieresis","egrave","iacute","icircumflex","idieresis","igrave","ntilde","oacute","ocircumflex","odieresis","ograve","otilde","scaron","uacute","ucircumflex","udieresis","ugrave","yacute","ydieresis","zcaron","exclamsmall","Hungarumlautsmall","dollaroldstyle","dollarsuperior","ampersandsmall","Acutesmall","parenleftsuperior","parenrightsuperior","twodotenleader","onedotenleader","zerooldstyle","oneoldstyle","twooldstyle","threeoldstyle","fouroldstyle","fiveoldstyle","sixoldstyle","sevenoldstyle","eightoldstyle","nineoldstyle","commasuperior","threequartersemdash","periodsuperior","questionsmall","asuperior","bsuperior","centsuperior","dsuperior","esuperior","isuperior","lsuperior","msuperior","nsuperior","osuperior","rsuperior","ssuperior","tsuperior","ff","ffi","ffl","parenleftinferior","parenrightinferior","Circumflexsmall","hyphensuperior","Gravesmall","Asmall","Bsmall","Csmall","Dsmall","Esmall","Fsmall","Gsmall","Hsmall","Ismall","Jsmall","Ksmall","Lsmall","Msmall","Nsmall","Osmall","Psmall","Qsmall","Rsmall","Ssmall","Tsmall","Usmall","Vsmall","Wsmall","Xsmall","Ysmall","Zsmall","colonmonetary","onefitted","rupiah","Tildesmall","exclamdownsmall","centoldstyle","Lslashsmall","Scaronsmall","Zcaronsmall","Dieresissmall","Brevesmall","Caronsmall","Dotaccentsmall","Macronsmall","figuredash","hypheninferior","Ogoneksmall","Ringsmall","Cedillasmall","questiondownsmall","oneeighth","threeeighths","fiveeighths","seveneighths","onethird","twothirds","zerosuperior","foursuperior","fivesuperior","sixsuperior","sevensuperior","eightsuperior","ninesuperior","zeroinferior","oneinferior","twoinferior","threeinferior","fourinferior","fiveinferior","sixinferior","seveninferior","eightinferior","nineinferior","centinferior","dollarinferior","periodinferior","commainferior","Agravesmall","Aacutesmall","Acircumflexsmall","Atildesmall","Adieresissmall","Aringsmall","AEsmall","Ccedillasmall","Egravesmall","Eacutesmall","Ecircumflexsmall","Edieresissmall","Igravesmall","Iacutesmall","Icircumflexsmall","Idieresissmall","Ethsmall","Ntildesmall","Ogravesmall","Oacutesmall","Ocircumflexsmall","Otildesmall","Odieresissmall","OEsmall","Oslashsmall","Ugravesmall","Uacutesmall","Ucircumflexsmall","Udieresissmall","Yacutesmall","Thornsmall","Ydieresissmall","001.000","001.001","001.002","001.003","Black","Bold","Book","Light","Medium","Regular","Roman","Semibold"];

  function latin1(b, s, e) { var o = ""; for (var i = s; i < e; i++) o += String.fromCharCode(b[i]); return o; }
  function readIndex(b, p) {
    var count = (b[p] << 8) | b[p + 1];
    if (!count) return { items: [], end: p + 2 };
    var offSize = b[p + 2], offs = [], q = p + 3, i, k;
    for (i = 0; i <= count; i++) { var v = 0; for (k = 0; k < offSize; k++) v = v * 256 + b[q++]; offs.push(v); }
    var base = q - 1, items = [];
    for (i = 0; i < count; i++) items.push([base + offs[i], base + offs[i + 1]]);
    return { items: items, end: base + offs[count] };
  }
  function parseDict(b, s, e) {
    var d = {}, st = [], p = s;
    while (p < e) {
      var v = b[p];
      if (v <= 21) { var op = v; p++; if (v === 12) { op = 1200 + b[p]; p++; } d[op] = st; st = []; }
      else if (v === 28) { st.push((((b[p + 1] << 8) | b[p + 2]) << 16) >> 16); p += 3; }
      else if (v === 29) { st.push((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]); p += 5; }
      else if (v === 30) {
        var s2 = "", done = false; p++;
        while (!done && p < e) {
          var by = b[p++];
          for (var h = 0; h < 2; h++) {
            var nb = h ? (by & 15) : (by >> 4);
            if (nb < 10) s2 += nb; else if (nb === 10) s2 += "."; else if (nb === 11) s2 += "E";
            else if (nb === 12) s2 += "E-"; else if (nb === 14) s2 += "-"; else if (nb === 15) { done = true; break; }
          }
        }
        st.push(parseFloat(s2) || 0);
      }
      else if (v >= 32 && v <= 246) { st.push(v - 139); p++; }
      else if (v >= 247 && v <= 250) { st.push((v - 247) * 256 + b[p + 1] + 108); p += 2; }
      else if (v >= 251 && v <= 254) { st.push(-(v - 251) * 256 - b[p + 1] - 108); p += 2; }
      else p++;
    }
    return d;
  }

  // ---------------------------------------------------------------- CFF
  function parseCFF(b) {
    try {
      var hdr = b[2], nameIdx = readIndex(b, hdr), topIdx = readIndex(b, nameIdx.end);
      var strIdx = readIndex(b, topIdx.end), gsub = readIndex(b, strIdx.end);
      if (!topIdx.items.length) return null;
      var top = parseDict(b, topIdx.items[0][0], topIdx.items[0][1]);
      if (top[1230] || !top[17]) return null; // CID-шрифты не поддерживаем
      var cs = readIndex(b, top[17][0]), nG = cs.items.length, i, k;
      var sidName = function (sid) { if (sid < 391) return STD[sid]; var it = strIdx.items[sid - 391]; return it ? latin1(b, it[0], it[1]) : ""; };
      var names = [".notdef"], cp = top[15] ? top[15][0] : 0;
      if (cp > 2) {
        var fmt = b[cp++];
        if (fmt === 0) { for (i = 1; i < nG; i++) { names.push(sidName((b[cp] << 8) | b[cp + 1])); cp += 2; } }
        else {
          while (names.length < nG) {
            var first = (b[cp] << 8) | b[cp + 1]; cp += 2;
            var nl = fmt === 1 ? b[cp++] : ((b[cp] << 8) | b[cp + 1]); if (fmt === 2) cp += 2;
            for (k = 0; k <= nl && names.length < nG; k++) names.push(sidName(first + k));
          }
        }
      } else { for (i = 1; i < nG; i++) names.push(sidName(i)); }
      var lsubrs = [], priv = top[18];
      if (priv) { var pd = parseDict(b, priv[1], priv[1] + priv[0]); if (pd[19]) lsubrs = readIndex(b, priv[1] + pd[19][0]).items; }
      var code2gid = {}, ep = top[16] ? top[16][0] : 0;
      if (ep > 1) {
        var ef = b[ep++], sup = ef & 128; ef &= 127;
        if (ef === 0) { var n0 = b[ep++]; for (i = 1; i <= n0; i++) code2gid[b[ep++]] = i; }
        else if (ef === 1) { var nr = b[ep++], gid = 1; for (i = 0; i < nr; i++) { var f1 = b[ep++], n1 = b[ep++]; for (k = 0; k <= n1; k++) code2gid[f1 + k] = gid++; } }
        if (sup) { var ns = b[ep++]; for (i = 0; i < ns; i++) { var cd = b[ep++], sid = (b[ep] << 8) | b[ep + 1]; ep += 2; var g = names.indexOf(sidName(sid)); if (g > 0) code2gid[cd] = g; } }
      }
      var fm = top[1207], scale = fm && fm[0] ? fm[0] * 1000 : 1;
      return { b: b, names: names, cs: cs.items, gsubrs: gsub.items, lsubrs: lsubrs, code2gid: code2gid, scale: scale };
    } catch (e) { return null; }
  }
  function bias(n) { return n < 1240 ? 107 : (n < 33900 ? 1131 : 32768); }

  // Контуры глифа (ломаные, координаты в тысячных долях em)
  function glyphContours(font, gid) {
    var b = font.b, st = [], contours = [], cur = null, x = 0, y = 0, nStems = 0, haveW = false, done = false, steps = 0;
    var gs = font.gsubrs, ls = font.lsubrs, gb = bias(gs.length), lb = bias(ls.length), sc = font.scale;
    function closeP() { if (cur && cur.length > 2) contours.push(cur); cur = null; }
    function mv(dx, dy) { closeP(); x += dx; y += dy; cur = [[x * sc, y * sc]]; }
    function ln(dx, dy) { if (!cur) cur = [[x * sc, y * sc]]; x += dx; y += dy; cur.push([x * sc, y * sc]); }
    function cv(a, b1, c, d, e, f) {
      if (!cur) cur = [[x * sc, y * sc]];
      var x1 = x + a, y1 = y + b1, x2 = x1 + c, y2 = y1 + d, x3 = x2 + e, y3 = y2 + f;
      for (var t = 1; t <= 6; t++) {
        var u = t / 6, v = 1 - u;
        cur.push([(v * v * v * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3) * sc,
                  (v * v * v * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3) * sc]);
      }
      x = x3; y = y3;
    }
    function w1(minArgs) { if (!haveW) { if (st.length > minArgs) st.shift(); haveW = true; } }
    function run(s, e, depth) {
      var p = s, i, v, a;
      while (p < e && !done) {
        if (++steps > 200000) { done = true; return; }
        v = b[p++];
        if (v >= 32 || v === 28) {
          if (v === 28) { st.push((((b[p] << 8) | b[p + 1]) << 16) >> 16); p += 2; }
          else if (v <= 246) st.push(v - 139);
          else if (v <= 250) { st.push((v - 247) * 256 + b[p] + 108); p++; }
          else if (v <= 254) { st.push(-(v - 251) * 256 - b[p] - 108); p++; }
          else { st.push(((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) / 65536); p += 4; }
          continue;
        }
        switch (v) {
          case 1: case 3: case 18: case 23:
            if (!haveW) { if (st.length & 1) st.shift(); haveW = true; }
            nStems += st.length >> 1; st = []; break;
          case 19: case 20:
            if (!haveW) { if (st.length & 1) st.shift(); haveW = true; }
            nStems += st.length >> 1; st = []; p += (nStems + 7) >> 3; break;
          case 21: w1(2); mv(st[0] || 0, st[1] || 0); st = []; break;
          case 22: w1(1); mv(st[0] || 0, 0); st = []; break;
          case 4: w1(1); mv(0, st[0] || 0); st = []; break;
          case 5: for (i = 0; i + 1 < st.length; i += 2) ln(st[i], st[i + 1]); st = []; break;
          case 6: case 7: { var hz = v === 6; for (i = 0; i < st.length; i++) { if (hz) ln(st[i], 0); else ln(0, st[i]); hz = !hz; } st = []; break; }
          case 8: for (i = 0; i + 5 < st.length; i += 6) cv(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]); st = []; break;
          case 24: for (i = 0; i + 7 < st.length; i += 6) cv(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]); ln(st[i], st[i + 1]); st = []; break;
          case 25: for (i = 0; i + 7 < st.length; i += 2) ln(st[i], st[i + 1]); cv(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]); st = []; break;
          case 26: { i = 0; var dx1 = 0; if (st.length & 1) { dx1 = st[0]; i = 1; } for (; i + 3 < st.length; i += 4) { cv(dx1, st[i], st[i + 1], st[i + 2], 0, st[i + 3]); dx1 = 0; } st = []; break; }
          case 27: { i = 0; var dy1 = 0; if (st.length & 1) { dy1 = st[0]; i = 1; } for (; i + 3 < st.length; i += 4) { cv(st[i], dy1, st[i + 1], st[i + 2], st[i + 3], 0); dy1 = 0; } st = []; break; }
          case 30: case 31: {
            var hz2 = v === 31;
            for (i = 0; i + 3 < st.length; i += 4) {
              var last = (st.length - i === 5) ? st[i + 4] : 0;
              if (hz2) cv(st[i], 0, st[i + 1], st[i + 2], last, st[i + 3]);
              else cv(0, st[i], st[i + 1], st[i + 2], st[i + 3], last);
              hz2 = !hz2;
            }
            st = []; break;
          }
          case 10: a = st.pop() + lb; if (ls[a] && depth < 12) run(ls[a][0], ls[a][1], depth + 1); break;
          case 29: a = st.pop() + gb; if (gs[a] && depth < 12) run(gs[a][0], gs[a][1], depth + 1); break;
          case 11: return;
          case 14: closeP(); done = true; return;
          case 12: {
            var v2 = b[p++];
            if (v2 === 34) { cv(st[0], 0, st[1], st[2], st[3], 0); cv(st[4], 0, st[5], -st[2], st[6], 0); }
            else if (v2 === 35) { cv(st[0], st[1], st[2], st[3], st[4], st[5]); cv(st[6], st[7], st[8], st[9], st[10], st[11]); }
            else if (v2 === 36) { cv(st[0], st[1], st[2], st[3], st[4], 0); cv(st[5], 0, st[6], st[7], st[8], -(st[1] + st[3] + st[7])); }
            else if (v2 === 37) {
              var sx = st[0] + st[2] + st[4] + st[6] + st[8], sy = st[1] + st[3] + st[5] + st[7] + st[9];
              cv(st[0], st[1], st[2], st[3], st[4], st[5]);
              if (Math.abs(sx) > Math.abs(sy)) cv(st[6], st[7], st[8], st[9], st[10], -sy); else cv(st[6], st[7], st[8], st[9], -sx, st[10]);
            }
            st = []; break;
          }
          default: st = []; break;
        }
      }
    }
    var it = font.cs[gid];
    if (!it) return [];
    run(it[0], it[1], 0);
    closeP();
    return contours;
  }

  // ---------------------------------------------------------------- дескриптор формы
  var RN = 56, PG = 12;
  function rasterize(contours, x0, y0, x1, y1) {
    var w = (x1 - x0) || 1, h = (y1 - y0) || 1, img = new Uint8Array(RN * RN), r, c, ci, j;
    for (r = 0; r < RN; r++) {
      var yc = y1 - (r + 0.5) * h / RN, xs = [];
      for (ci = 0; ci < contours.length; ci++) {
        var pts = contours[ci], n = pts.length;
        for (j = 0; j < n; j++) {
          var p0 = pts[j], p1 = pts[(j + 1) % n];
          if ((p0[1] <= yc && p1[1] > yc) || (p1[1] <= yc && p0[1] > yc)) {
            var t = (yc - p0[1]) / (p1[1] - p0[1]);
            xs.push([p0[0] + t * (p1[0] - p0[0]), p1[1] > p0[1] ? 1 : -1]);
          }
        }
      }
      xs.sort(function (a, b) { return a[0] - b[0]; });
      var wind = 0;
      for (j = 0; j + 1 < xs.length; j++) {
        wind += xs[j][1];
        if (wind !== 0) {
          var ca = Math.ceil((xs[j][0] - x0) / w * RN - 0.5), cb = Math.floor((xs[j + 1][0] - x0) / w * RN - 0.5);
          for (c = Math.max(0, ca); c <= Math.min(RN - 1, cb); c++) img[r * RN + c] = 1;
        }
      }
    }
    return img;
  }
  function thin(img) { // Zhang–Suen
    var N = RN, ch = true, r, c, pass, i;
    var nb = function (r, c) { return [img[(r - 1) * N + c], img[(r - 1) * N + c + 1], img[r * N + c + 1], img[(r + 1) * N + c + 1], img[(r + 1) * N + c], img[(r + 1) * N + c - 1], img[r * N + c - 1], img[(r - 1) * N + c - 1]]; };
    var guard = 0;
    while (ch && guard++ < 40) {
      ch = false;
      for (pass = 0; pass < 2; pass++) {
        var del = [];
        for (r = 1; r < N - 1; r++) for (c = 1; c < N - 1; c++) {
          if (!img[r * N + c]) continue;
          var p = nb(r, c), B = 0, A = 0;
          for (i = 0; i < 8; i++) { B += p[i]; if (!p[i] && p[(i + 1) % 8]) A++; }
          if (B < 2 || B > 6 || A !== 1) continue;
          if (pass === 0) { if (p[0] * p[2] * p[4] !== 0 || p[2] * p[4] * p[6] !== 0) continue; }
          else { if (p[0] * p[2] * p[6] !== 0 || p[0] * p[4] * p[6] !== 0) continue; }
          del.push(r * N + c);
        }
        if (del.length) { ch = true; for (i = 0; i < del.length; i++) img[del[i]] = 0; }
      }
    }
    return img;
  }
  // -> {f:[w,h,ymin,ymax], v:Float32Array(PG*PG)} или null (пустой глиф)
  function describe(contours, slant) {
    if (!contours || !contours.length) return null;
    var cs = contours;
    if (slant) cs = contours.map(function (ct) { return ct.map(function (p) { return [p[0] - slant * p[1], p[1]]; }); });
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, i, j;
    for (i = 0; i < cs.length; i++) for (j = 0; j < cs[i].length; j++) {
      var p = cs[i][j]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (!(x1 > x0 || y1 > y0)) return null;
    var img = thin(rasterize(cs, x0, y0, x1, y1)), G = new Float32Array(PG * PG), blk = RN / PG, r, c;
    for (r = 0; r < RN; r++) for (c = 0; c < RN; c++) if (img[r * RN + c]) G[((r / blk) | 0) * PG + ((c / blk) | 0)] += 1;
    for (var rep = 0; rep < 2; rep++) {
      var T = new Float32Array(PG * PG);
      for (r = 0; r < PG; r++) for (c = 0; c < PG; c++) {
        var s = 0, wsum = 0;
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          var rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= PG || cc >= PG) continue;
          var wgt = (dr ? 1 : 2) * (dc ? 1 : 2); s += G[rr * PG + cc] * wgt; wsum += wgt;
        }
        T[r * PG + c] = s / wsum;
      }
      G = T;
    }
    var nrm = 0; for (i = 0; i < G.length; i++) nrm += G[i] * G[i];
    nrm = Math.sqrt(nrm) || 1; for (i = 0; i < G.length; i++) G[i] /= nrm;
    return { f: [x1 - x0, y1 - y0, y0, y1], v: G };
  }
  function dist(a, b) {
    var s = 0, i, n = a.v.length;
    for (i = 0; i < n; i++) { var d = a.v[i] - b.v[i]; s += d * d; }
    var fa = a.f, fb = b.f;
    var pw = Math.abs(fa[0] - fb[0]) / Math.max(fa[0], fb[0], 120);
    var ph = Math.abs(fa[1] - fb[1]) / Math.max(fa[1], fb[1], 120);
    var py = (Math.abs(fa[2] - fb[2]) + Math.abs(fa[3] - fb[3])) / 1000;
    return Math.sqrt(s) + 0.9 * (pw + ph) + 1.6 * py;
  }

  // ---------------------------------------------------------------- эталоны
  var REFS = [];
  function setRefs(list) { REFS = list; }
  var LAT = /^[A-Za-z]$/;
  // Лучшее совпадение отдельно среди «кириллицы/цифр/знаков» (c, d) и среди латинских букв (lc, ld):
  // одинаковые по форме о/o, с/c и т.п. иначе путались бы, а в «зашифрованных» шрифтах латиницы не бывает.
  function match(desc) {
    var r = { c: "", d: 9, lc: "", ld: 9 };
    for (var i = 0; i < REFS.length; i++) {
      var d = dist(desc, REFS[i]);
      if (LAT.test(REFS[i].c)) { if (d < r.ld) { r.ld = d; r.lc = REFS[i].c; } }
      else if (d < r.d) { r.d = d; r.c = REFS[i].c; }
    }
    return r;
  }

  function decodeFont(bytes, opts) {
    opts = opts || {};
    var font = parseCFF(bytes);
    if (!font || !REFS.length) return { glyphs: {}, ok: false, font: font };
    var out = {}, i;
    for (i = 1; i < font.names.length; i++) {
      var d = null;
      try { d = describe(glyphContours(font, i), opts.slant || 0); } catch (e) { d = null; }
      if (!d) { // пустой контур — это пробел (в «зашифрованных» шрифтах он тоже отдельный глиф)
        try { if (!glyphContours(font, i).length) out[font.names[i]] = { c: " ", d: 0, lc: "", ld: 9, sp: 1 }; } catch (e2) { /* пропускаем */ }
        continue;
      }
      var m = match(d);
      out[font.names[i]] = { c: m.d < 0.75 ? m.c : "", d: m.d, lc: m.lc, ld: m.ld };
    }
    return { glyphs: out, ok: true, font: font };
  }

  var api = { parseCFF: parseCFF, glyphContours: glyphContours, describe: describe, dist: dist, match: match, setRefs: setRefs, decodeFont: decodeFont, PG: PG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PdfGlyphs = api;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis));
