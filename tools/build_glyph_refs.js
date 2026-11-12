/* tools/build_glyph_refs.js
   Версия: 1.0 (13.11)
   Пересборка pdfglyphs_data.js (эталоны форм глифов для pdfglyphs.js).
   Запуск из корня проекта: node tools/build_glyph_refs.js
   Нужны исходные шрифты (в репозиторий НЕ входят): fonts/*.cff — встроенные CFF-шрифты, вынутые из PDF журнала
   (FontFile3), inter/Inter-{Regular,Medium,Bold}.cff + inter/map.json (запасная гарнитура: буква -> имя глифа),
   tools/glyph_labels.json — «имя глифа -> буква» для каждого файла fonts/*.cff (разметка выполнена по контактным листам). */
const G=require('../pdfglyphs.js');const fs=require('fs');
const L=JSON.parse(fs.readFileSync('tools/glyph_labels.json'));
const IM=JSON.parse(fs.readFileSync('inter/map.json'));
let refs=[];
function add(file,labels,tag){
  const font=G.parseCFF(new Uint8Array(fs.readFileSync(file)));
  for(const [n,c] of Object.entries(labels)){
    const gid=font.names.indexOf(n);if(gid<1||!c)continue;
    const d=G.describe(G.glyphContours(font,gid));if(!d)continue;
    refs.push({c,f:d.f.map(Math.round),v:d.v,tag});
  }
}
for(const [f,m] of Object.entries(L)) add('fonts/'+f,m,f);
const LATNAME={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',period:'.',comma:',',hyphen:'-',slash:'/',colon:':',question:'?',exclam:'!',parenleft:'(',parenright:')'};
for(const f of fs.readdirSync('fonts').filter(f=>/^WtKnoll|^WtUt/.test(f))){
  const font=G.parseCFF(new Uint8Array(fs.readFileSync('fonts/'+f)));const lab={};
  for(const n of font.names){ if(/^[A-Za-z]$/.test(n)) lab[n]=n; else if(LATNAME[n]) lab[n]=LATNAME[n]; }
  add('fonts/'+f,lab,f);
}
for(const f of ['Regular','Bold']){ // запасная латиница
  const font=G.parseCFF(new Uint8Array(fs.readFileSync('inter/Inter-'+f+'.cff')));const lab={};
  for(const n of font.names) if(/^[A-Za-z]$/.test(n)) lab[n]=n;
  add('inter/Inter-'+f+'.cff',lab,'lat-'+f);
}
for(const [f,m] of Object.entries(IM)){const lab={};for(const [c,n] of Object.entries(m))lab[n]=c;add('inter/'+f,lab,f);}
// дедупликация: одинаковый символ и почти одинаковая форма
const kept=[];
for(const r of refs){
  if(kept.some(k=>k.c===r.c&&G.dist(k,r)<0.025))continue;kept.push(r);
}
console.log('refs',refs.length,'kept',kept.length);
const rows=kept.map(r=>{const u=Buffer.from(Array.from(r.v,x=>Math.min(255,Math.round(x*400)))).toString('base64');return JSON.stringify([r.c,r.f[0],r.f[1],r.f[2],r.f[3],u]);});
const js=`/* pdfglyphs_data.js
   Версия: 1.0 (13.11)
   Эталоны форм глифов для pdfglyphs.js (генерируется tools/build_glyph_refs.js).
   [буква, ширина, высота, низ, верх (в тысячных em), скелет 12x12 в base64 (байт = значение*400)].
   Эталоны сняты с гарнитуры Knoll Text (Regular/Book/Medium/DemiBold/Bold, Condensed, курсивы) и, для букв,
   которых в ней не оказалось (Ё Й Ф Ш Щ Ъ Ю ё и часть знаков), — с запасной гарнитуры. */
(function (global) {
  "use strict";
  var ROWS = [
${rows.join(',\n')}
  ];
  function b64(s) {
    if (typeof atob === "function") { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  var refs = ROWS.map(function (r) {
    var u = b64(r[5]), v = new Float32Array(u.length);
    for (var i = 0; i < u.length; i++) v[i] = u[i] / 400;
    return { c: r[0], f: [r[1], r[2], r[3], r[4]], v: v };
  });
  var G = global.PdfGlyphs || (typeof require === "function" ? require("./pdfglyphs.js") : null);
  if (G) G.setRefs(refs);
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis));
`;
fs.writeFileSync('pdfglyphs_data.js',js);console.log(js.length);
