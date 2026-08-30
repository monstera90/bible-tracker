/* ===========================================================================
   my.js
   Основная логика приложения «График чтения Библии»
   =========================================================================== */

(function(){
  "use strict";

  // ===================== ДАННЫЕ БИБЛИИ =====================
  var sections = [
    {
      title:"Еврейско-арамейские Писания",
      books:[
        ["Бытие",50],["Исход",40],["Левит",27],["Числа",36],["Второзаконие",34],
        ["Иисус Навин",24],["Судей",21],["Руфь",4],["1 Самуила",31],["2 Самуила",24],
        ["1 Царей",22],["2 Царей",25],["1 Летопись",29],["2 Летопись",36],["Ездра",10],
        ["Неемия",13],["Эсфирь",10],["Иов",42],["Псалмы",150],["Притчи",31],
        ["Экклезиаст",12],["Песня Соломона",8],["Исаия",66],["Иеремия",52],["Плач Иеремии",5],
        ["Иезекииль",48],["Даниил",12],["Осия",14],["Иоиль",3],["Амос",9],
        ["Авдий",1],["Иона",4],["Михей",7],["Наум",3],["Аввакум",3],
        ["Софония",3],["Аггей",2],["Захария",14],["Малахия",4]
      ]
    },
    {
      title:"Христианские Греческие Писания",
      books:[
        ["Матфея",28],["Марка",16],["Луки",24],["Иоанна",21],["Деяния",28],
        ["Римлянам",16],["1 Коринфянам",16],["2 Коринфянам",13],["Галатам",6],["Эфесянам",6],
        ["Филиппийцам",4],["Колоссянам",4],["1 Фессалоникийцам",5],["2 Фессалоникийцам",3],["1 Тимофею",6],
        ["2 Тимофею",4],["Титу",3],["Филимону",1],["Евреям",13],["Иакова",5],
        ["1 Петра",5],["2 Петра",3],["1 Иоанна",5],["2 Иоанна",1],["3 Иоанна",1],
        ["Иуды",1],["Откровение",22]
      ]
    }
  ];

  var TOTAL_CHAPTERS = 0;
  sections.forEach(function(s){ s.books.forEach(function(b){ TOTAL_CHAPTERS += b[1]; }); });

  // ===================== ССЫЛКА НА ГЛАВУ (JW Finder) =====================
  // Порядок книг в sections совпадает с канонической нумерацией 1-66
  // (Бытие=1 ... Откровение=66), поэтому номер книги — это просто её
  // порядковый номер в общем списке. Диапазон стихов 000-999 означает
  // "вся глава целиком" независимо от реального числа стихов в ней.
  function chapterLink(bookNumber, chapterNum){
    var bb = String(bookNumber).padStart(2, "0");
    var ccc = String(chapterNum).padStart(3, "0");
    return "https://www.jw.org/finder?srcid=jwlshare&wtlocale=U&prefer=lang" +
           "&bible=" + bb + ccc + "000-" + bb + ccc + "999&pub=nwtsty";
  }

  // Карта "название книги -> номер 1..66", по тому же принципу — строится
  // один раз из sections и используется везде, где нужна ссылка на стих.
  var BOOK_NUMBERS = {};
  (function(){
    var n = 0;
    sections.forEach(function(s){ s.books.forEach(function(b){ n++; BOOK_NUMBERS[b[0]] = n; }); });
  })();

  // Ссылка на конкретный стих (или диапазон стихов) внутри главы.
  function verseLink(bookName, chapterNum, v1, v2){
    var bookNumber = BOOK_NUMBERS[bookName];
    if(!bookNumber) return null;
    var bb = String(bookNumber).padStart(2, "0");
    var ccc = String(chapterNum).padStart(3, "0");
    var vv1 = String(v1).padStart(3, "0");
    var vv2 = String(v2 || v1).padStart(3, "0");
    return "https://www.jw.org/finder?srcid=jwlshare&wtlocale=U&prefer=lang" +
           "&bible=" + bb + ccc + vv1 + "-" + bb + ccc + vv2 + "&pub=nwtsty";
  }

  // Единая точка выбора ссылки для найденной библейской ссылки — если
  // указан стих (v1 задан), ведёт на конкретный стих/диапазон стихов
  // (verseLink); если стиха нет (просто "Книга 6" — целая глава, или
  // "Книга 6-7"/"Книга 6 - 7" — диапазон ГЛАВ без стихов), ведёт на ВСЮ
  // первую главу (chapterLink) — JW Library физически не может открыть
  // сразу две главы на одном экране, поэтому диапазон глав трактуется как
  // ссылка на первую из них (см. ТЗ пользователя от 30.08).
  function scriptureRefLink(bookName, chapterNum, v1, v2){
    if(v1) return verseLink(bookName, chapterNum, v1, v2);
    var bookNumber = BOOK_NUMBERS[bookName];
    if(!bookNumber) return null;
    return chapterLink(bookNumber, chapterNum);
  }

  // Распознавание библейских ссылок в свободном тексте (заметки, задачи).
  // Ключ — то, как ссылка написана в тексте; значение — каноническое
  // название книги из sections. Для каждого "стема" ниже автоматически
  // генерируются варианты с точкой и без неё (важно для распознавания
  // сокращений в любом написании).
  var BOOK_ALIASES = {};
  function addAlias(alias, canonical){ if(!BOOK_ALIASES[alias]) BOOK_ALIASES[alias] = canonical; }
  function addStemVariants(stem, canonical){
    addAlias(stem, canonical);
    addAlias(stem + ".", canonical);
  }
  Object.keys(BOOK_NUMBERS).forEach(function(name){ BOOK_ALIASES[name] = name; });

  // Сокращения для книг без номера (Быт., Исх., Пс. и т.п.)
  var SIMPLE_STEMS = {
    "Бытие":["Быт"], "Исход":["Исх"], "Левит":["Лев","Лв"], "Числа":["Чис","Чс"],
    "Второзаконие":["Втор","Вт"], "Судей":["Суд","Сд"], "Руфь":["Рф"],
    "Ездра":["Езд"], "Неемия":["Неем","Не"], "Эсфирь":["Эсф"],
    "Псалмы":["Пс","Псалом"], "Притчи":["Пр"], "Экклезиаст":["Эк"], "Песня Соломона":["Псн"],
    "Исаия":["Ис"], "Иеремия":["Иер"], "Плач Иеремии":["Пл"], "Иезекииль":["Иез"],
    "Даниил":["Дан"], "Осия":["Ос"], "Иоиль":["Ил"], "Амос":["Ам"], "Авдий":["Авд"],
    "Иона":["Ион"], "Михей":["Мх","Мих"], "Наум":["На"], "Аввакум":["Авв"],
    "Софония":["Соф","Сф"], "Аггей":["Аг"], "Захария":["Зах"], "Малахия":["Мал","Мл"],
    "Матфея":["Мф","Матф"], "Марка":["Мк"], "Луки":["Лук","Лк"], "Иоанна":["Иоан","Ин"],
    "Деяния":["Дн","Деян"], "Римлянам":["Рм","Рим"], "Галатам":["Гал","Гл"], "Эфесянам":["Эф"],
    "Филиппийцам":["Филип","Фп"], "Колоссянам":["Кол","Кл"], "Титу":["Тит"],
    "Филимону":["Фм","Филим"], "Евреям":["Евр"], "Иакова":["Иак"], "Откровение":["Отк"]
  };
  Object.keys(SIMPLE_STEMS).forEach(function(canonical){
    SIMPLE_STEMS[canonical].forEach(function(stem){ addStemVariants(stem, canonical); });
  });

  // Сокращения для книг с номером (1/2 Самуила, 1/2/3 Иоанна и т.п.) —
  // стем общий для обеих (или всех трёх) частей, номер подставляется
  // автоматически, слитно и раздельно.
  var NUMBERED_STEMS = {
    "Самуила":["Сам","См"], "Царей":["Цр","Цар"], "Летопись":["Лет","Лт"],
    "Коринфянам":["Кор","Кр"], "Фессалоникийцам":["Фес"], "Тимофею":["Тим","Тм"],
    "Петра":["Пет","Пт"], "Иоанна":["Ин","Иоан"]
  };
  Object.keys(BOOK_NUMBERS).forEach(function(canonical){
    var m = canonical.match(/^([123]) (.+)$/);
    if(!m) return;
    var digit = m[1], base = m[2];
    var stems = NUMBERED_STEMS[base];
    if(!stems) return;
    stems.forEach(function(stem){
      addStemVariants(digit + " " + stem, canonical);
      addStemVariants(digit + stem, canonical);
    });
  });

  // Двусловные сокращения (Иис. Нав., Пл. Иер.) — вариант с точками и
  // "слитный" вариант без них.
  var MULTI_WORD_ALIASES = {
    "Иисус Навин":["Иис. Нав."],
    "Плач Иеремии":["Пл. Иер."]
  };
  Object.keys(MULTI_WORD_ALIASES).forEach(function(canonical){
    MULTI_WORD_ALIASES[canonical].forEach(function(alias){
      addAlias(alias, canonical);
      addAlias(alias.replace(/\./g, ""), canonical);
    });
  });

  var SCRIPTURE_RE = (function(){
    var aliases = Object.keys(BOOK_ALIASES).sort(function(a,b){ return b.length - a.length; });
    var escaped = aliases.map(function(a){ return a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    return new RegExp(
      // разделитель диапазона стихов — учитывает не только обычный дефис
      // "-" и запятую ",", но и длинное/среднее тире "—"/"–": в реальных
      // текстах ("Прит. 3:5—7") часто используется именно тире, и раньше
      // такие ссылки оставались нераспознанными (см. правку от 30.08).
      //
      // После главы — ТРИ варианта (см. ТЗ пользователя от 30.08):
      //   1) "6:22"/"6.22[-24]" — глава:стих[-стих] (группы 3, 4);
      //   2) "6-7"/"6 - 7"      — диапазон ГЛАВ без стихов (группы 3,4 не
      //      заполняются, т.к. у этой ветки нет своих захватывающих
      //      скобок — она различается только тем, что не совпадает с
      //      первой веткой; сам номер второй главы не нужен для ссылки,
      //      см. scriptureRefLink выше — диапазон глав всегда ведёт на
      //      первую главу целиком, т.к. JW Library не может открыть две
      //      главы на одном экране);
      //   3) ничего после номера главы — сама глава целиком ("Книга 6").
      "(?<![а-яА-ЯёЁ])(" + escaped.join("|") + ")(?![а-яА-ЯёЁ])" +
      "\\s+(\\d{1,3})" +
      "(?:[:.](\\d{1,3})(?:\\s*[-–—,]\\s*(\\d{1,3}))?|\\s*[-–—]\\s*\\d{1,3})?",
      "g"
    );
  })();

  // ===================== ФОРМАТИРОВАНИЕ В СТИЛЕ OBSIDIAN =====================
  // ссылки http(s)://, www. — конечная пунктуация сразу после ссылки
  // (точка, запятая, скобка и т.п.) в саму ссылку не включается, остаётся
  // снаружи тега обычным текстом. Объявлены ЗДЕСЬ, а не рядом с linkifyHtml
  // ниже по файлу — formatInline пользуется ими уже в САМОМ ПЕРВОМ, ещё
  // синхронном проходе initAutoFormatting() при загрузке скрипта (см.
  // ниже), до которого объявление ниже по файлу ещё не успело бы
  // выполниться.
  var LINKIFY_URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
  var LINKIFY_TRAIL_RE = /[.,;:!?)\]}'"]+$/;
  // Единая функция ИНЛАЙН-форматирования одной строки (без переносов) —
  // ссылки на Библию, [[ссылки на заметки]], обычные URL, **жирный**,
  // *курсив*/_курсив_, ==выделение==. Работает на СЫРОМ (неэкранированном)
  // тексте методом "заявок" — тем же приёмом, что и decorateLine в
  // mdeditor.js: каждый найденный кусок "застолбляет" свой диапазон
  // символов, при пересечении диапазонов побеждает тот, кто заявил его
  // раньше. Порядок сканирования ниже намеренно совпадает с decorateLine
  // (ссылки → **жирный** → ==выделение== → *курсив*) — поэтому, например,
  // [[ссылка]] ВНУТРИ **жирного** не получает своего отдельного
  // оформления, ровно как и в живом просмотре "Моего блокнота" (решётки/
  // скобки внутри выделения остаются как есть, без вложенной разметки).
  //
  // Используется и явно (см. formatObsidianHtml/linkifyHtml ниже — для
  // уже известных вкладок: "Карта дней года", задачи/GTD, комментарии), и
  // из общего автонаблюдателя initAutoFormatting (см. ниже) — для ЛЮБОЙ
  // будущей вкладки, которая ничего специально для этого не делает и
  // просто выводит обычный текст.
  function formatInline(text){
    if(!text) return "";
    var claims = [];
    function tryClaim(start, end, render){
      for(var i = 0; i < claims.length; i++){
        if(start < claims[i].end && end > claims[i].start) return;
      }
      claims.push({ start: start, end: end, render: render });
    }

    if(SCRIPTURE_RE){
      SCRIPTURE_RE.lastIndex = 0;
      var mScr;
      while((mScr = SCRIPTURE_RE.exec(text))){
        (function(a, b, m){
          tryClaim(a, b, function(){
            var canonical = BOOK_ALIASES[m[1]];
            var link = canonical ? scriptureRefLink(canonical, Number(m[2]), m[3] ? Number(m[3]) : undefined, m[4] ? Number(m[4]) : undefined) : null;
            var raw = text.slice(a, b);
            if(!link) return escapeHtml(raw);
            return '<a href="' + link + '" target="_blank" rel="noopener noreferrer" class="auto-link scripture-link">' + escapeHtml(raw) + '</a>';
          });
        })(mScr.index, mScr.index + mScr[0].length, mScr);
        if(mScr[0].length === 0) SCRIPTURE_RE.lastIndex++;
      }
    }

    // [[ссылки на заметки "Моего блокнота"]] — клик обрабатывается ОДНИМ
    // общим делегированным обработчиком на #settingsTabContent (см.
    // initAutoFormatting ниже): переключает вкладку настроек на "Мой
    // блокнот" и сразу открывает эту заметку (создаёт её, если такой ещё
    // нет — как и при клике на такую же ссылку ВНУТРИ самого блокнота, см.
    // handleLinkClick/openNoteExternally в mdeditor.js).
    var noteRe = /\[\[([^\[\]\n]+)\]\]/g, mNote;
    noteRe.lastIndex = 0;
    while((mNote = noteRe.exec(text))){
      (function(a, b, name){
        tryClaim(a, b, function(){
          return '<span class="auto-link note-link" data-note-link="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>';
        });
      })(mNote.index, mNote.index + mNote[0].length, mNote[1].trim());
      if(mNote[0].length === 0) noteRe.lastIndex++;
    }

    // обычные ссылки http(s)://, www. — конечная пунктуация сразу после
    // ссылки (точка, запятая, скобка и т.п.) в саму ссылку не включается,
    // остаётся снаружи тега обычным текстом (см. LINKIFY_TRAIL_RE ниже)
    LINKIFY_URL_RE.lastIndex = 0;
    var mUrl;
    while((mUrl = LINKIFY_URL_RE.exec(text))){
      (function(raw0, a){
        var trailM = raw0.match(LINKIFY_TRAIL_RE);
        var trail = trailM ? trailM[0] : "";
        var core = trail ? raw0.slice(0, raw0.length - trail.length) : raw0;
        if(!core) return;
        tryClaim(a, a + core.length, function(){
          var href = /^https?:\/\//i.test(core) ? core : "https://" + core;
          return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="auto-link">' + escapeHtml(core) + '</a>';
        });
      })(mUrl[0], mUrl.index);
      if(mUrl[0].length === 0) LINKIFY_URL_RE.lastIndex++;
    }

    function scanPair(regex, cls){
      regex.lastIndex = 0;
      var m;
      while((m = regex.exec(text))){
        (function(a, b, inner){
          tryClaim(a, b, function(){ return '<span class="' + cls + '">' + escapeHtml(inner) + '</span>'; });
        })(m.index, m.index + m[0].length, m[1]);
        if(m[0].length === 0) regex.lastIndex++;
      }
    }
    scanPair(/\*\*([^*\n]+?)\*\*/g, "fmt-bold");
    scanPair(/==([^=\n]+?)==/g, "fmt-mark");
    scanPair(/\*([^*\n]+?)\*/g, "fmt-italic");
    scanPair(/_([^_\n]+?)_/g, "fmt-italic");

    claims.sort(function(a, b){ return a.start - b.start; });
    var html = "", pos = 0;
    claims.forEach(function(c){
      if(c.start > pos) html += escapeHtml(text.slice(pos, c.start));
      html += c.render();
      pos = c.end;
    });
    if(pos < text.length) html += escapeHtml(text.slice(pos));
    return html;
  }

  // Полный рендер многострочного текста в стиле Obsidian: разбивает на
  // строки и для каждой распознаёт заголовок "# "/"## "/"### ", цитату
  // "> ", маркированный ("-"/"*") и нумерованный ("1. ") список — плюс
  // formatInline внутри каждой строки. Блочные признаки, их приоритет и
  // "красная строка" у первой строки абзаца (после пустой строки или
  // заголовка) — то же самое, что и в decorateLine в mdeditor.js: один и
  // тот же язык разметки должен выглядеть одинаково и в "Моём блокноте", и
  // здесь. Единственное, что тут НЕ поддерживается — встроенные картинки
  // "![[имя]]" (они завязаны на файловую систему, открытую только внутри
  // "Моего блокнота"; здесь просто останутся видимым текстом).
  function formatObsidianHtml(rawText){
    if(rawText == null || rawText === "") return "";
    var lines = String(rawText).split("\n");
    var html = "";
    for(var i = 0; i < lines.length; i++){
      var line = lines[i];
      if(line.trim() === ""){
        html += '<span class="fmt-line fmt-blank"></span>';
        continue;
      }
      var mHead = /^(#{1,3})(\s+)/.exec(line);
      if(mHead){
        html += '<span class="fmt-line fmt-h' + mHead[1].length + '">' + formatInline(line.slice(mHead[0].length)) + '</span>';
        continue;
      }
      var mQuote = /^(\s*>+ ?)/.exec(line);
      if(mQuote){
        html += '<span class="fmt-line fmt-quote">' + formatInline(line.slice(mQuote[0].length)) + '</span>';
        continue;
      }
      var mList = /^(\s*)([-*])(\s+)/.exec(line);
      if(mList){
        html += '<span class="fmt-line fmt-list"><span class="fmt-bullet">•</span> ' + formatInline(line.slice(mList[0].length)) + '</span>';
        continue;
      }
      var mNum = /^(\s*)(\d{1,4}[.)])(\s+)/.exec(line);
      if(mNum){
        html += '<span class="fmt-line fmt-list"><span class="fmt-bullet">' + escapeHtml(mNum[2]) + '</span> ' + formatInline(line.slice(mNum[0].length)) + '</span>';
        continue;
      }
      var prevLine = i > 0 ? lines[i - 1] : null;
      var isParaStart = prevLine == null || prevLine.trim() === "" || /^(#{1,3})(\s+)/.test(prevLine);
      html += '<span class="fmt-line' + (isParaStart ? ' fmt-para' : '') + '">' + formatInline(line) + '</span>';
    }
    return html;
  }

  // ===================== АВТОМАТИЧЕСКОЕ ФОРМАТИРОВАНИЕ И ССЫЛКИ НА ЛЮБОЙ
  //                        ВКЛАДКЕ (в т.ч. будущих) =====================
  // formatObsidianHtml/linkifyHtml выше нужно вызвать САМОЙ вкладке при
  // отрисовке — так уже сделано в "Карте дней года", задачах и
  // комментариях: там получаются ПОЛНЫЕ заголовки/списки/цитаты (см.
  // formatObsidianHtml). Но это значит, что КАЖДАЯ новая вкладка в будущем
  // должна сама не забыть это сделать. Вместо этого здесь заводится один
  // MutationObserver на #settingsTabContent целиком (родитель ЛЮБОЙ
  // вкладки настроек, включая ещё не написанные) — после каждого
  // изменения его содержимого сам обходит все текстовые узлы и применяет
  // ИНЛАЙН-форматирование (см. formatInline выше: ссылки на Библию,
  // [[ссылки на заметки]], обычные URL, **жирный**, ==выделение==,
  // *курсив*), даже если конкретная вкладка ничего специально для этого
  // не делала и просто вывела обычный текст. Заголовки/цитаты/списки
  // (блочная разметка, привязанная к границам строк) сюда не входят — их
  // безопасно строить только из СЫРОЙ строки текста (см.
  // formatObsidianHtml), а не реконструировать заново из уже готового,
  // произвольно сверстанного DOM; для этого вкладке всё же нужно вызвать
  // formatObsidianHtml/linkifyHtml явно при отрисовке.
  //
  // Что НЕ трогаем:
  //  - уже обёрнутые ссылки/форматирование (текстовый узел внутри <a> —
  //    тег A входит в shouldSkip) — иначе получили бы вложенные <a> там,
  //    где вкладка уже сама вызвала linkifyHtml/formatObsidianHtml;
  //  - script/style/textarea/input — там либо нет осмысленного текста в
  //    виде узлов, либо это чисто служебное содержимое;
  //  - любой contenteditable-элемент (в т.ч. вложенный) — сюда попадают и
  //    поле CodeMirror в "Моём блокноте" (там уже СВОЙ отдельный механизм
  //    форматирования и ссылок, см. mdeditor.js — трогать DOM снаружи во
  //    время редактирования CodeMirror нельзя, поломает его модель), и
  //    поля редактирования комментария/задачи/дня года (contenteditable
  //    div, см. renderYearDayNoteEdit и т.п.) — там во время правки лежит
  //    ЧИСТЫЙ текст, который потом считывается обратно; вставленный <a>/
  //    <span> испортил бы его при сохранении;
  //  - "функция часов" (индикатор "4:05 / 10:55" вверху "Моего блокнота",
  //    см. renderHourBars) — это числа графика чтения, а не текст заметок,
  //    формировать из них ссылки/форматирование не нужно; она и так вне
  //    подозрений: там нет текстовых узлов с "**"/"[["/ссылками на Библию.
  (function initAutoFormatting(){
    var root = document.getElementById("settingsTabContent");
    if(!root) return;
    var applying = false; // защита от зацикливания: сама вставка тегов тоже меняет DOM и породит новую mutation-запись

    function shouldSkip(el){
      if(!el || el.nodeType !== 1) return false;
      var tag = el.tagName;
      if(tag === "A" || tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT") return true;
      if(el.isContentEditable) return true;
      return false;
    }

    // быстрая отсечка без реального совпадения — если в тексте нет ни
    // одного из символов/подстрок, с которых может начинаться хоть один
    // из распознаваемых видов разметки, не тратим время на разбор
    var QUICK_REJECT_RE = /[:.]|\[\[|\*|_|==|https?:\/\/|www\./;

    function wrapTextNode(node){
      var text = node.nodeValue;
      if(!QUICK_REJECT_RE.test(text)) return;
      var html = formatInline(text);
      if(html === escapeHtml(text)) return; // ничего не нашли — текстовый узел не трогаем
      var tpl = document.createElement("template");
      tpl.innerHTML = html;
      node.parentNode.replaceChild(tpl.content, node);
    }

    function walk(node){
      if(node.nodeType === 3){ wrapTextNode(node); return; }
      if(node.nodeType !== 1 || shouldSkip(node)) return;
      // копия childNodes — wrapTextNode заменяет обработанный текстовый
      // узел на фрагмент, из-за чего "живой" childNodes во время обхода
      // сместился бы и часть узлов пропустилась/задвоилась
      Array.prototype.slice.call(node.childNodes).forEach(walk);
    }

    function runPass(){
      if(applying) return;
      applying = true;
      try{ walk(root); } finally { applying = false; }
    }

    // если ВСЕ мутации этой пачки пришли изнутри игнорируемых поддеревьев
    // (типичный случай — пользователь просто печатает в contenteditable-поле
    // редактирования комментария/задачи/дня года, это тоже мутации DOM) —
    // полный обход #settingsTabContent не запускаем: там заведомо нечего
    // находить, а вкладки с длинными списками (задачи, заметки) не должны
    // пересчитываться на каждое нажатие клавиши в соседнем поле.
    function isInsideSkippedSubtree(node){
      var el = node.nodeType === 1 ? node : node.parentElement;
      while(el && el !== root){
        if(shouldSkip(el)) return true;
        el = el.parentElement;
      }
      return false;
    }

    new MutationObserver(function(mutations){
      for(var i = 0; i < mutations.length; i++){
        if(!isInsideSkippedSubtree(mutations[i].target)){ runPass(); return; }
      }
    }).observe(root, { childList: true, subtree: true, characterData: true });
    runPass();

    // клик по [[ссылке на заметку]] (см. formatInline выше — span.note-link
    // с data-note-link) в ЛЮБОМ месте #settingsTabContent, не только внутри
    // "Моего блокнота": переключает вкладку настроек на "Мой блокнот" и
    // сразу открывает эту заметку (создаёт, если такой ещё нет — как и при
    // клике на такую же ссылку ВНУТРИ самого блокнота, см.
    // openNoteExternally в mdeditor.js). Один делегированный обработчик на
    // родителе — работает для ссылок в любой, в т.ч. ещё не написанной,
    // вкладке, без отдельной подписки на каждую из них.
    root.addEventListener("click", function(ev){
      var el = ev.target && ev.target.closest ? ev.target.closest(".note-link") : null;
      if(!el) return;
      var name = el.getAttribute("data-note-link");
      if(!name) return;
      ev.preventDefault();
      switchSettingsTab("set2s_1");
      if(MdEditor && MdEditor.openNoteExternally) MdEditor.openNoteExternally(name);
    });
  })();

  // ===================== ХРАНЕНИЕ (с дебаунсом) =====================
  var STORAGE_KEY = "bibleReadingProgress_v2";
  var OLD_STORAGE_KEY = "bibleReadingProgress_v1";
  var SYNC_ID_KEY = "bibleReadingSyncId_v1";
  var MIGRATED_KEY = "__migrated_v2";
  var CELEBRATION_SHOWN_KEY = "bibleCelebrationShown_v1";
  var UPDATE_DISMISSED_KEY = "bibleUpdateDismissedVersion_v1";
  var UPDATE_SNOOZE_KEY = "bibleUpdateSnoozeUntil_v1";
  var UPDATES_DISABLED_KEY = "bibleUpdatesDisabled_v1";
  var GOALS_EXPANDED_KEY = "bibleGoalsBandExpanded_v1";
  var FAB_VISIBLE_KEY = "bibleSettingsFabVisible_v1";
  // Локальный (не синхронизируемый и не попадающий в экспорт) флаг доступа
  // ко второму набору вкладок — только на этом устройстве/в этом браузере.
  // Это не защита данных, а просто способ спрятать не нужные большинству
  // пользователей функции: сам код лежит в этом файле открытым текстом,
  // как и любой JS-код, исполняющийся в браузере, поэтому его несложно
  // найти в исходниках — но для этой задачи это и не требуется.
  var SET2_UNLOCK_KEY = "bibleSet2Unlocked_v1";
  var SET2_SECRET_CODE = "orion-glass-47";
  function isSet2Unlocked(){
    try{ return localStorage.getItem(SET2_UNLOCK_KEY) === "1"; }catch(e){ return false; }
  }
  function trySet2UnlockCode(input){
    var normalized = (input || "").trim().toLowerCase();
    if(normalized && normalized === SET2_SECRET_CODE.toLowerCase()){
      try{ localStorage.setItem(SET2_UNLOCK_KEY, "1"); }catch(e){}
      return true;
    }
    return false;
  }
  var SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;


  // ===================== ЦИТАТЫ ДНЯ =====================
  // Шапка может показывать 2 вида записей, каждый включается отдельной
  // галочкой в настройках (обе выключены по умолчанию — раньше стихи
  // показывались всегда, теперь это опция):
  //  1) BIBLE_QUOTES_ENABLED_KEY — библейские стихи: системный список
  //     QUOTES ниже + опционально один свой стих (CUSTOM_VERSE_KEY),
  //     добавленный пользователем через настройки.
  //  2) CUSTOM_COMMENTS_ENABLED_KEY — личные комментарии пользователя,
  //     созданные во вкладке "Добавить кастомный комментарий" (см.
  //     COMMENT_KEY_PREFIX ниже).
  // Если включены обе — оба вида перемешиваются в один общий список и
  // чередуются по тем же правилам, что и раньше (смена по временным
  // слотам, см. getDaySlot/initQuote). Если включена только одна — работает
  // только она. Если не включена ни одна — шапка скрыта.
  var BIBLE_QUOTES_ENABLED_KEY = "__bibleQuotesEnabled";
  var CUSTOM_COMMENTS_ENABLED_KEY = "__customCommentsEnabled";
  var CUSTOM_VERSE_KEY = "__customKeyVerse";

  function getBibleQuotesEnabled(){ var r = state[BIBLE_QUOTES_ENABLED_KEY]; return !!(r && r.c); }
  function setBibleQuotesEnabled(value){
    state[BIBLE_QUOTES_ENABLED_KEY] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshHeaderQuote();
  }
  function getCustomCommentsEnabled(){ var r = state[CUSTOM_COMMENTS_ENABLED_KEY]; return !!(r && r.c); }
  function setCustomCommentsEnabled(value){
    state[CUSTOM_COMMENTS_ENABLED_KEY] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshHeaderQuote();
  }
  function getCustomVerse(){
    var r = state[CUSTOM_VERSE_KEY];
    return (r && r.c) ? r.c : {text:"", ref:""};
  }
  function setCustomVerse(text, ref){
    text = (text || "").trim();
    ref = (ref || "").trim();
    state[CUSTOM_VERSE_KEY] = {c: (text ? {text:text, ref:ref} : null), t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshHeaderQuote();
  }

  var QUOTE_KEY = "__quote";
  var QUOTES = [
    { text:"Счастлив тот, кто… находит радость в законе Иеговы и читает его вполголоса день и ночь", ref:"Псалом 1:1, 2", book:"Псалмы", ch:1, v1:1, v2:2 },
    { text:"Закон Иеговы совершенен, восстанавливает силы", ref:"Псалом 19:7", book:"Псалмы", ch:19, v1:7 },
    { text:"Счастливы те, кто стремится утолить свой духовный голод", ref:"Матфея 5:3", book:"Матфея", ch:5, v1:3 },
    { text:"Я по-настоящему люблю закон Бога", ref:"Римлянам 7:22", book:"Римлянам", ch:7, v1:22 },
    { text:"Как я люблю твой закон! Весь день размышляю о нём", ref:"Псалом 119:97", book:"Псалмы", ch:119, v1:97 },
    { text:"Размышляй об этом, будь этим поглощён, чтобы твои духовные успехи были видны всем", ref:"1 Тим. 4:15", book:"1 Тимофею", ch:4, v1:15 },
    { text:"Кто всматривается в совершенный закон, ведущий к свободе, и соблюдает его, тот не забывает услышанное", ref:"Иакова 1:25", book:"Иакова", ch:1, v1:25 },
    { text:"Наставления Иеговы достойны доверия, делают неопытных мудрыми", ref:"Псалом 19:7", book:"Псалмы", ch:19, v1:7 },
    { text:"Повеления Иеговы справедливы, радуют сердце", ref:"Псалом 19:8", book:"Псалмы", ch:19, v1:8 },
    { text:"Всё написанное прежде было написано для нашего наставления", ref:"Рим. 15:4", book:"Римлянам", ch:15, v1:4 },
    { text:"Заповедь Иеговы чиста, наделяет проницательностью", ref:"Псалом 19:8", book:"Псалмы", ch:19, v1:8 },
    { text:"Закон, который ты дал, для меня лучше… золота и серебра", ref:"Псалом 119:72", book:"Псалмы", ch:119, v1:72 },
    { text:"[Иегова] оживляет мою душу, ведёт путями праведности", ref:"Псалом 23:3", book:"Псалмы", ch:23, v1:3 },
    { text:"Твои наставления прекрасны, поэтому я следую им", ref:"Псалом 119:129", book:"Псалмы", ch:119, v1:129 },
    { text:"Всё Писание вдохновлено Богом и полезно", ref:"2 Тим. 3:16", book:"2 Тимофею", ch:3, v1:16 },
    { text:"Твоё слово — это истина", ref:"Иоанна 17:17", book:"Иоанна", ch:17, v1:17 },
    { text:"Людей направлял святой дух, и они передавали весть Бога", ref:"2 Пет. 1:21", book:"2 Петра", ch:1, v1:21 },
    { text:"Вы хорошо делаете, что относитесь к [пророческому слову] со всем вниманием", ref:"2 Пет. 1:19", book:"2 Петра", ch:1, v1:19 },
    { text:"[Писание] помогает обучать, обличать, исправлять, наставлять на правильный путь", ref:"2 Тим. 3:16", book:"2 Тимофею", ch:3, v1:16 },
    { text:"Твоё слово — светильник для моих ног и свет на моём пути", ref:"Пс. 119:105", book:"Псалмы", ch:119, v1:105 }
  ];

  // Слоты дня: 0=ночь(0-8), 1=утро(8-12), 2=день(12-18), 3=вечер(18-24)
  function getDaySlot(){
    var h = new Date().getHours();
    if(h < 8) return 0;
    if(h < 12) return 1;
    if(h < 18) return 2;
    return 3;
  }

  function getQuoteRec(){
    var rec = state[QUOTE_KEY];
    if(!rec || typeof rec.c !== "number") return {c:0, t:0, slot:-1};
    // миграция со старого формата (без slot)
    if(typeof rec.slot !== "number"){
      rec = {c: rec.c, t: rec.t, slot: -1};
    }
    return rec;
  }

  // Собирает общий список записей для ротации в шапке — из библейских
  // стихов (системных + своего) и/или личных комментариев пользователя,
  // в зависимости от того, какие галочки сейчас включены в настройках
  // (см. getBibleQuotesEnabled/getCustomCommentsEnabled выше). Порядок:
  // сначала все библейские, затем все комментарии — стабильный порядок
  // важен, чтобы индекс idx осмысленно "листал" один и тот же список,
  // пока он не меняется.
  function buildQuotePool(){
    var pool = [];
    if(getBibleQuotesEnabled()){
      QUOTES.forEach(function(q){
        pool.push({type:"bible", text:q.text, ref:q.ref, book:q.book, ch:q.ch, v1:q.v1, v2:q.v2});
      });
      var custom = getCustomVerse();
      if(custom && custom.text){
        pool.push({type:"bible", text:custom.text, ref:custom.ref, custom:true});
      }
    }
    if(getCustomCommentsEnabled()){
      getAllComments().forEach(function(c){
        if(c.c && c.c.text) pool.push({type:"comment", text:c.c.text});
      });
    }
    return pool;
  }

  function showQuote(pool, idx){
    var el = document.getElementById("dailyQuote");
    if(!el) return;
    if(!pool.length){
      el.classList.remove("visible");
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    var q = pool[idx % pool.length];
    var html;
    if(q.type === "bible"){
      var link = q.custom ? null : verseLink(q.book, q.ch, q.v1, q.v2);
      var refHtml = q.ref ? (link
        ? ' <a href="' + link + '" target="_blank" rel="noopener">(' + escapeHtml(q.ref) + ')</a>'
        : ' (' + escapeHtml(q.ref) + ')') : "";
      html = "«" + escapeHtml(q.text) + "»" + refHtml + ".";
    } else {
      html = linkifyHtml(q.text);
    }
    el.innerHTML = html;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ el.classList.add("visible"); });
    });
  }

  // Цитата меняется только тогда, когда пользователь ДЕЙСТВИТЕЛЬНО открыл
  // страницу в новом временном слоте относительно своего прошлого визита —
  // а не по факту того, что время просто прошло. Если человек не заходил
  // весь слот целиком, для него ничего не "сгорает" и не накапливается:
  // при следующем визите цитата сдвигается ровно на один шаг вперёд, а не
  // "досчитывает" пропущенные слоты.
  function initQuote(){
    var pool = buildQuotePool();
    var rec = getQuoteRec();
    var currentSlot = getDaySlot();
    var idx = rec.c;

    if(rec.slot < 0){
      // самый первый визит вообще — фиксируем слот, цитату не сдвигаем
      state[QUOTE_KEY] = {c: idx, t: Date.now(), slot: currentSlot};
      saveLocalState();
    } else if(currentSlot !== rec.slot){
      idx = pool.length ? (idx + 1) % pool.length : 0;
      state[QUOTE_KEY] = {c: idx, t: Date.now(), slot: currentSlot};
      saveLocalState();
    }
    showQuote(pool, idx);
  }

  // Пересчитывает и перерисовывает шапку немедленно (без сдвига индекса
  // по слотам) — вызывается сразу после того, как пользователь поменял
  // галочки, свой стих или список личных комментариев, чтобы шапка не
  // ждала следующего временного слота. Индекс лишь ограничивается новым
  // размером списка (список мог измениться).
  function refreshHeaderQuote(){
    var pool = buildQuotePool();
    var rec = getQuoteRec();
    var idx = pool.length ? (rec.c % pool.length) : 0;
    showQuote(pool, idx);
  }



  var state = loadState();
  var syncId = localStorage.getItem(SYNC_ID_KEY) || null;

  // Инкрементальные счётчики
  var totalChecked = 0;
  var checkedPerBook = {};

  var saveTimer = null;
  function saveLocalState(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
    }, 300);
  }

  function chapterKey(bookName, chapterNum){
    return bookName + "|" + chapterNum;
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(raw){ return JSON.parse(raw); }
    }catch(e){}

    // миграция со старой версии — единожды
    try{
      if(!localStorage.getItem(MIGRATED_KEY)){
        var oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
        if(oldRaw){
          var oldState = JSON.parse(oldRaw);
          var migrated = {};
          var now = Date.now();
          Object.keys(oldState).forEach(function(k){
            if(oldState[k]) migrated[k] = {c:true, t:now};
          });
          localStorage.setItem(MIGRATED_KEY, "1");
          return migrated;
        }
        localStorage.setItem(MIGRATED_KEY, "1");
      }
    }catch(e){}
    return {};
  }

  function isChecked(key){
    return !!(state[key] && state[key].c);
  }

  // ===================== ЦВЕТНАЯ ОТМЕТКА ГЛАВ =====================
  var CHAPTER_COLOR_BLUE = "#29B6F6";
  var CHAPTER_COLOR_RED = "#ED2939";

  function getColorMarkEnabled(){
    var r = state["__colorMarkChapters"];
    return !!(r && r.c);
  }
  function setColorMarkEnabled(value){
    state["__colorMarkChapters"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  // ===================== ДОПОЛНИТЕЛЬНЫЕ АНИМАЦИИ =====================
  // Настройка "Включить дополнительные анимации" (вкладка настроек,
  // шестерёнка). Пока управляет только диагональной "волной" открытия/
  // закрытия окна настроек от плавающей кнопки (см. animateSettingsWave
  // ниже) — в будущем сюда же можно добавить и другие необязательные
  // анимации за тем же флагом.
  function getExtraAnimationsEnabled(){
    var r = state["__extraAnimations"];
    return !!(r && r.c);
  }
  function setExtraAnimationsEnabled(value){
    state["__extraAnimations"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  // ===================== ВКЛАДКИ ЗАДАЧ (red/inbox/next/…) =====================
  // Список ключей вкладок задач в том же порядке, в каком они идут в DOM
  // (см. index.html, .settings-tabs) — используется и для показа/скрытия
  // ярлычков по галочке "Показать все мои задачи", и для переключения
  // между ними в switchSettingsTab. "council" — новая вкладка-список
  // задач между waiting и read, оформлена и работает так же, как next
  // (см. TASK_MOVABLE_TABS/TASK_MOVE_TARGET_TABS ниже); название нигде
  // текстом не выводится (см. TASK_TAB_TITLES.council).
  var TASK_TAB_IDS = {
    red: "settingsTabRedBtn",
    inbox: "settingsTabInboxBtn",
    next: "settingsTabNextBtn",
    projects: "settingsTabProjectsBtn",
    waiting: "settingsTabWaitingBtn",
    council: "settingsTabCouncilBtn",
    read: "settingsTabReadBtn",
    someday: "settingsTabSomedayBtn",
    archive: "settingsTabArchiveBtn"
  };
  var TASK_TAB_TITLES = {
    red: "Red", inbox: "Inbox", next: "Next", projects: "Projects",
    waiting: "Waiting", council: "", read: "Read", someday: "Someday", archive: "Archive"
  };
  // вкладки-списки задач, между которыми можно переносить задачу стрелочкой
  // (без архива — туда задача попадает только через отметку чекбокса).
  // "red" сюда тоже входит — используется, чтобы кнопка "+" показывалась
  // и на вкладке Red (там тоже можно создать задачу напрямую), но САМОЙ
  // "red" в качестве места хранения (реального taskа.c.tab) больше нет:
  // Red — это витрина по цветной отметке (см. TASK_MOVE_TARGET_TABS ниже,
  // getTasksForTab и cycleTaskFlag).
  var TASK_MOVABLE_TABS = ["red","inbox","next","projects","waiting","council","read","someday"];
  // 2 вкладки-заглушки в горизонтальном ряду рядом со вкладкой настроек
  // (было 3 — одну отдали под вкладку диаграммы настроения, см.
  // settingsTabMoodBtn/switchSettingsTab ниже, см. также
  // .settings-tabs-gear в index.html/modals.css) — контент под них ещё
  // не определён, показывают только "Контент появится позже" (см.
  // renderSettingsTabExtra ниже). В отличие от TASK_TAB_IDS видимость не
  // переключается — эти вкладки показаны всегда.
  var EXTRA_TAB_IDS = {
    extra2: "settingsTabExtra2Btn",
    extra3: "settingsTabExtra3Btn"
  };
  // ===== ВТОРОЙ НАБОР ВКЛАДОК (заглушки) =====
  // Полный дубль первого набора: 9 боковых + 5 нижних язычков (см. разметку
  // в index.html, .settingsTabsSet2 / .settingsTabsGearSet2). 10 из 14 —
  // всё ещё просто заглушки без функций (см. renderSettingsTabSet2Stub
  // ниже); ключи специально с префиксом "set2" — тем же, что и остальные
  // (TASK_TAB_IDS/EXTRA_TAB_IDS), участвуют в общем переключателе
  // switchSettingsTab. set2b_1 — "домашняя" вкладка второго набора
  // (открывается по умолчанию при переключении на набор, см.
  // cycleSettingsTabSet) — уже не заглушка: это вкладка "Извлечение
  // информации из графиков", см. renderSettingsTabWorkbooks в
  // workbooks.js и её отдельную ветку в switchSettingsTab ниже (стоит
  // ДО общей проверки на renderSettingsTabSet2Stub, иначе заглушка
  // перехватила бы её тоже). set2b_4 тоже уже не заглушка — это вкладка
  // "Извлечение субтитров": пользователь даёт видео (.mp4) со встроенной
  // текстовой дорожкой субтитров (tx3g), текст читается прямо в браузере
  // обычным разбором контейнера mp4 (без сети, без ffmpeg/WebAssembly —
  // см. extractSubtitleCuesFromMp4), остаётся только текст — см.
  // renderSettingsTabSubtitleExtract ниже, по тому же принципу вынесена
  // ДО общей проверки на renderSettingsTabSet2Stub. set2s_5 (пятая боковая)
  // тоже уже не заглушка — это вкладка "Разделение epub-файлов": книга
  // .epub конвертируется в текст (в правильном порядке чтения, по spine
  // из content.opf) и делится на несколько .txt для источников NotebookLM,
  // см. renderSettingsTabEpubSplit в epubsplit.js и её отдельную ветку в
  // switchSettingsTab ниже, по тому же принципу вынесена ДО общей проверки
  // на renderSettingsTabSet2Stub. set2s_6 (шестая боковая) — ЭТО БОЛЬШЕ НЕ
  // ЗАГЛУШКА: это вкладка "Изменение размера изображения": пользователь
  // прикрепляет .jpg/.png и задаёт нужные ширину и высоту в пикселях —
  // картинка масштабируется на Canvas (без искажений — пиксели никогда не
  // растягиваются, см. imgresize.js) и скачивается уже нужного размера,
  // см. renderSettingsTabImgResize в imgresize.js и её отдельную ветку в
  // switchSettingsTab ниже, по тому же принципу вынесена ДО общей проверки
  // на renderSettingsTabSet2Stub. set2s_1 (первая боковая) — ЭТО БОЛЬШЕ НЕ
  // ЗАГЛУШКА: это вкладка "Мой блокнот" — работа с .md заметками
  // в стиле Obsidian (папка через File System Access API, редактор на
  // CodeMirror 6 с decorations, ссылки [[Название]] между заметками), см.
  // renderSettingsTabMdEditor в mdeditor.js и её отдельную ветку в
  // switchSettingsTab ниже, по тому же принципу вынесена ДО общей проверки
  // на renderSettingsTabSet2Stub.
  var SET2_TAB_IDS = {
    set2s_1: "settingsTabSet2Btn1", set2s_2: "settingsTabSet2Btn2", set2s_3: "settingsTabSet2Btn3",
    set2s_4: "settingsTabSet2Btn4", set2s_5: "settingsTabSet2Btn5", set2s_6: "settingsTabSet2Btn6",
    set2s_7: "settingsTabSet2Btn7", set2s_8: "settingsTabSet2Btn8", set2s_9: "settingsTabSet2Btn9"
  };
  var SET2_EXTRA_TAB_IDS = {
    set2b_1: "settingsTabSet2GearBtn1", set2b_2: "settingsTabSet2GearBtn2", set2b_3: "settingsTabSet2GearBtn3",
    set2b_4: "settingsTabSet2GearBtn4", set2b_5: "settingsTabSet2GearBtn5"
  };
  // а вот КУДА реально можно перенести задачу стрелочкой (пикер
  // "Перенести задачу") — без red, т.к. принадлежность к Red определяется
  // не вкладкой-домом, а цветной отметкой слева от чекбокса
  var TASK_MOVE_TARGET_TABS = ["inbox","next","projects","waiting","council","read","someday"];
  var TASK_MOVE_ICONS = {
    red: '<path d="M5 3v18"></path><path d="M5 4h11l-2.5 4L16 12H5"></path>',
    inbox: '<path d="M4 12h4l2 3h4l2-3h4"></path><path d="M4 12l1.5-7h13L20 12"></path><path d="M4 12v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"></path>',
    next: '<path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path>',
    projects: '<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z"></path>',
    waiting: '<path d="M6 3h12"></path><path d="M6 21h12"></path><path d="M7 3c0 4 3 5 5 6-2 1-5 2-5 6"></path><path d="M17 3c0 4-3 5-5 6 2 1 5 2 5 6"></path>',
    council: '<circle cx="12" cy="7.5" r="3"></circle><path d="M5 21c0-4 3-7 7-7s7 3 7 7"></path>',
    // раскрытая книга — та же геометрия, что и у вкладки Read в
    // index.html (перебалансированные пропорции разворота, см. пояснение
    // там же)
    read: '<path d="M12 7c-1.8-1-4.5-1.3-7-1.3v10c2.5 0 4.7.3 7 1.3"></path><path d="M12 7c1.8-1 4.5-1.3 7-1.3v10c-2.5 0-4.7.3-7 1.3"></path><path d="M12 7v10"></path>',
    // та же стрелочка, что у next, повёрнута на 90° против часовой стрелки,
    // чтобы указывать вверх (см. #settingsTabSomedayBtn в index.html)
    someday: '<g transform="rotate(-90 12 12)"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></g>'
  };
  var TASK_MOVE_ICON_SVG = function(key){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (TASK_MOVE_ICONS[key] || "") + '</svg>';
  };
  var ARROW_MOVE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></svg>';
  // галочка "перенести в архив" — заменяет собой прежний чекбокс задачи,
  // делает ровно то же самое (см. .task-done-btn в renderTaskRowView)
  var CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"></path></svg>';
  var LINK_NEXT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>';
  var RESTORE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg>';
  var DELETE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>';
  var PAPERCLIP_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
  // общепринятая пиктограмма "копировать" (два листа внахлёст) — кнопка
  // "Скопировать субтитры" вкладки "Извлечение субтитров" (см.
  // renderSettingsTabSubtitleExtract ниже)
  var COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="13" rx="1.5"></rect><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3"></path></svg>';
  var TASK_ARCHIVE_MAX_SHOWN = 50;

  function getShowAllTasksEnabled(){
    var r = state["__showAllTasks"];
    return !!(r && r.c);
  }
  function setShowAllTasksEnabled(value){
    state["__showAllTasks"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function applyChapterColorClass(item, clr){
    if(!item) return;
    item.classList.remove("clr-green","clr-blue","clr-red");
    if(clr === "green") item.classList.add("clr-green");
    else if(clr === "blue") item.classList.add("clr-blue");
    else if(clr === "red") item.classList.add("clr-red");
  }
  function refreshAllChapterColorVisuals(){
    var enabled = getColorMarkEnabled();
    Object.keys(chapterInputs).forEach(function(key){
      var input = chapterInputs[key];
      if(!input || !input.parentElement) return;
      var item = input.parentElement;
      var stored = state[key];
      var clr = (stored && stored.clr) || (input.checked ? "green" : null);
      applyChapterColorClass(item, (enabled && input.checked && clr) ? clr : null);
    });
  }
  function cycleChapterState(bookName, key, input, item){
    var prevRec = state[key];
    var wasChecked = !!(prevRec && prevRec.c);
    var prevColor = (prevRec && prevRec.clr) || null;
    var newChecked, newColor;

    // цикл: не выделено -> зелёный -> синий -> красный -> не выделено
    if(!wasChecked){
      newChecked = true; newColor = "green";
    } else if(prevColor === "blue"){
      newChecked = true; newColor = "red";
    } else if(prevColor === "red"){
      newChecked = false; newColor = null;
    } else {
      // отмечена зелёным (или без цвета — устаревшие записи) — дальше синяя
      newChecked = true; newColor = "blue";
    }

    if(newChecked && !wasChecked){
      if(!state["__firstRead"] || state["__firstRead"].c == null){
        state["__firstRead"] = {c: Date.now(), t: Date.now()};
      }
      checkedPerBook[bookName]++;
      totalChecked++;
    } else if(!newChecked && wasChecked){
      if(prevRec && prevRec.c === true && startOfDay(prevRec.t) === startOfDay(Date.now())){
        addTodayExcludedKey(key);
      }
      checkedPerBook[bookName]--;
      totalChecked--;
    }

    state[key] = {c: newChecked, t: Date.now(), clr: newColor || undefined};
    input.checked = newChecked;
    applyChapterColorClass(item, newChecked ? newColor : null);

    saveLocalState();
    updateBookProgress(bookName);
    updateHideProgressBadge();
    updateOverallProgress();
    updateMissedBanner();
    scheduleCloudPush();
    refreshYearGridIfOpen();
  }

  // ===================== ТЕМЫ =====================
  var THEME_KEY = "__theme";
  var DEFAULT_THEME_ID = 4;
  var THEMES = [
    {id:1, name:"Пергамент"},{id:2, name:"Шалфей и небо"},{id:3, name:"Розовый и мята"},
    {id:4, name:"Лаванда и слоновая кость"},{id:5, name:"Аметист и слоновая кость"},
    {id:6, name:"Пыльная роза и графит"},{id:7, name:"Морская пена и песок"}
  ];

  function getCurrentThemeId(){
    var rec = state[THEME_KEY];
    return (rec && rec.c) ? rec.c : DEFAULT_THEME_ID;
  }

  function applyThemeToPage(themeId){
    document.documentElement.setAttribute("data-theme", String(themeId));
    var dots = document.querySelectorAll(".theme-dot");
    dots.forEach(function(dot){
      dot.classList.toggle("selected", Number(dot.getAttribute("data-theme-id")) === themeId);
    });
    syncThemeColorMeta();
  }

  // синхронизирует <meta name="theme-color"> (цвет строки состояния в
  // Chrome и заголовка окна у установленного PWA) с реальным цветом
  // "шапки" темы — берёт готовое значение переменной --wood прямо из
  // применённой темы (html[data-theme=...]), а не хранит отдельный
  // список цветов, который иначе легко рассинхронизировать с theme.css.
  // Раньше здесь было захардкожено значение из темы №1 (коричневое),
  // а по умолчанию включена тема №4 — из-за этого при каждой загрузке
  // страницы/установленного приложения строка сверху была коричневой
  // независимо от того, какая тема реально выбрана.
  function syncThemeColorMeta(){
    // getComputedStyle() форсирует немедленный синхронный пересчёт стилей
    // ("forced reflow") — если вызвать его сразу же после смены атрибута
    // data-theme, браузер не может отложить пересчёт до следующего кадра,
    // как он обычно делает, и это добавляет небольшую синхронную паузу
    // прямо в момент переключения темы. Откладываем чтение на следующий
    // кадр через requestAnimationFrame — визуально разницы нет (следующий
    // кадр всё равно ещё не отрисован), а поток не блокируется прямо сейчас.
    requestAnimationFrame(function(){
      var wood = getComputedStyle(document.documentElement).getPropertyValue("--wood").trim();
      if(!wood) return;
      var meta = document.querySelector('meta[name="theme-color"]');
      if(meta) meta.setAttribute("content", wood);
    });
  }

  function selectTheme(themeId){
    state[THEME_KEY] = {c: themeId, t: Date.now()};
    saveLocalState();
    applyThemeToPage(themeId);
    scheduleCloudPush();
  }

  function renderThemeDots(){
    var holder = document.getElementById("themeDots");
    if(!holder) return;
    holder.innerHTML = "";
    var current = getCurrentThemeId();
    THEMES.forEach(function(theme){
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "theme-dot" + (theme.id === current ? " selected" : "");
      dot.setAttribute("data-theme-id", theme.id);
      dot.title = theme.name;
      dot.setAttribute("aria-label", "Тема: " + theme.name);
      dot.style.background = themeSwatchGradient(theme.id);
      dot.addEventListener("click", function(){ selectTheme(theme.id); });
      holder.appendChild(dot);
    });
  }

  function themeSwatchGradient(themeId){
    var swatches = {
      1:["#5c3d24","#48F78E"],2:["#5b7c99","#5AD1A0"],3:["#c98a97","#7FE8C0"],
      4:["#8f7fb8","#8FE3C7"],5:["#7a3fc0","#8FE3C7"],6:["#7d8a99","#8FD9B8"],7:["#6fada0","#6FE0C0"]
    };
    var pair = swatches[themeId] || swatches[1];
    return "linear-gradient(135deg, " + pair[0] + " 50%, " + pair[1] + " 50%)";
  }

  // ---------- переключатель видимости плавающей кнопки настроек ----------
  // Управляет только показом/скрытием самого язычка (.settings-fab,
  // id=settingsGearBtn) через display — состояние того, что выбрано
  // ВНУТРИ окна настроек (активная вкладка, задачи и т.п.), хранится
  // отдельно в своих собственных ключах localStorage и этим переключателем
  // никак не затрагивается. По умолчанию (ключ ещё не сохранён) кнопка
  // скрыта.
  function isSettingsFabVisible(){
    try{ return localStorage.getItem(FAB_VISIBLE_KEY) === "1"; }catch(e){ return false; }
  }

  function applySettingsFabVisibility(){
    var visible = isSettingsFabVisible();
    var fab = document.getElementById("settingsGearBtn");
    if(fab) fab.style.display = visible ? "" : "none";
    var toggleBtn = document.getElementById("fabToggleBtn");
    if(toggleBtn) toggleBtn.textContent = visible ? "Убрать плавающую кнопку" : "Включить плавающую кнопку";
  }

  function initSettingsFabToggle(){
    var toggleBtn = document.getElementById("fabToggleBtn");
    if(!toggleBtn) return;
    toggleBtn.addEventListener("click", function(){
      var visible = isSettingsFabVisible();
      try{ localStorage.setItem(FAB_VISIBLE_KEY, visible ? "0" : "1"); }catch(e){}
      applySettingsFabVisibility();
    });
    applySettingsFabVisibility();
  }

  // ===================== ПРОПУЩЕННЫЕ ДНИ =====================
  var DAY_MS = 24 * 60 * 60 * 1000;
  function pluralRu(n, forms){
    var abs = Math.abs(n) % 100, n1 = abs % 10;
    if(abs > 10 && abs < 20) return forms[2];
    if(n1 > 1 && n1 < 5) return forms[1];
    if(n1 === 1) return forms[0];
    return forms[2];
  }
  var DAY_FORMS = ["день","дня","дней"], WEEK_FORMS = ["неделя","недели","недель"], MONTH_FORMS = ["месяц","месяца","месяцев"], YEAR_FORMS = ["год","года","лет"];

  function buildMissedMessage(totalDays){
    if(totalDays === 1) return "Пропущен 1 день.";
    if(totalDays < 7) return "Пропущено " + totalDays + " " + pluralRu(totalDays, DAY_FORMS) + ".";
    if(totalDays < 60){
      var weeks = Math.floor(totalDays / 7), days = totalDays - weeks * 7;
      var msg = "Пропущено " + weeks + " " + pluralRu(weeks, WEEK_FORMS);
      if(days > 0) msg += " и " + days + " " + pluralRu(days, DAY_FORMS);
      return msg + ".";
    }
    if(totalDays < 90){
      var months = Math.floor(totalDays / 30), remDays = totalDays - months * 30, remWeeks = Math.floor(remDays / 7);
      var msg2 = "Пропущено " + months + " " + pluralRu(months, MONTH_FORMS);
      if(remWeeks > 0) msg2 += " и " + remWeeks + " " + pluralRu(remWeeks, WEEK_FORMS);
      return msg2 + ".";
    }
    if(totalDays < 182) return "Пропущено более трех месяцев.";
    if(totalDays < 365) return "Пропущено более полугода.";
    if(totalDays < 730) return "Пропущено более 1 года.";
    return "Пропущено более двух лет.";
  }

  function startOfDay(ts){
    var d = new Date(ts);
    d.setHours(0,0,0,0);
    return d.getTime();
  }

  function todayDateStr(){
    var d = new Date();
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }

  // Ключи глав, которые сегодня уже были "сожжены": пользователь снял ранее
  // стоявшую галочку и снова её поставил в тот же день. Такая перепроверка
  // не должна засчитываться как повод убрать уведомление "Пропущено" —
  // иначе можно было бы обманывать счётчик, щёлкая одной и той же главой.
  // Реальный новый прогресс (другая глава) при этом продолжает работать
  // как обычно. Список сам "устаревает" на следующий день (сравнение дат).
  function getTodayExcludedKeys(){
    var rec = state["__lastReadExcludedToday"];
    if(!rec || !rec.c || rec.c.date !== todayDateStr()) return [];
    return rec.c.keys || [];
  }
  function addTodayExcludedKey(key){
    var today = todayDateStr();
    var rec = state["__lastReadExcludedToday"];
    var keys = (rec && rec.c && rec.c.date === today) ? rec.c.keys.slice() : [];
    if(keys.indexOf(key) === -1) keys.push(key);
    state["__lastReadExcludedToday"] = {c: {date: today, keys: keys}, t: Date.now()};
  }

  // "Последнее чтение" больше не хранится отдельным полем, которое можно
  // случайно рассинхронизировать с реальным состоянием глав — оно всегда
  // вычисляется напрямую: самая свежая отметка среди ГЛАВ, которые сейчас
  // действительно отмечены как прочитанные (и не "сожжены" сегодня).
  function computeEffectiveLastRead(){
    var excluded = getTodayExcludedKeys();
    var maxT = null;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(!rec || rec.c !== true) return;
      if(excluded.indexOf(k) !== -1) return;
      if(maxT === null || rec.t > maxT) maxT = rec.t;
    });
    return maxT;
  }

  function updateMissedBanner(){
    var wrap = document.getElementById("missedWrap"), textEl = document.getElementById("missedText");
    if(!wrap || !textEl) return;
    var lastReadTs = computeEffectiveLastRead();
    if(!lastReadTs){ wrap.classList.remove("visible"); return; }
    // считаем ПОЛНОСТЬЮ прошедшие календарные дни без единой отметки.
    // Разница дат сама по себе включает "сегодня" как ещё не законченный
    // день (в нём ещё можно успеть отметиться) — поэтому вычитаем 1: если
    // вчера была отметка, "вчера" не в счёт, а "сегодня" ещё идёт, значит
    // пропущенных дней пока 0, а не 1.
    var totalDays = Math.round((startOfDay(Date.now()) - startOfDay(lastReadTs)) / DAY_MS) - 1;
    if(totalDays < 1){ wrap.classList.remove("visible"); return; }
    textEl.textContent = buildMissedMessage(totalDays);
    wrap.classList.add("visible");
  }

  function joinRu(parts){
    if(parts.length === 1) return parts[0];
    if(parts.length === 2) return parts[0] + " и " + parts[1];
    return parts.slice(0, -1).join(", ") + " и " + parts[parts.length - 1];
  }
  function buildDurationText(totalDays){
    var years = Math.floor(totalDays / 365), rem = totalDays - years * 365, months = Math.floor(rem / 30), days = rem - months * 30;
    var parts = [];
    if(years > 0) parts.push(years + " " + pluralRu(years, YEAR_FORMS));
    if(months > 0) parts.push(months + " " + pluralRu(months, MONTH_FORMS));
    if(days > 0) parts.push(days + " " + pluralRu(days, DAY_FORMS));
    return parts.length === 0 ? "меньше дня" : joinRu(parts);
  }
  function getDurationSuffix(){
    var rec = state["__firstRead"];
    if(!rec || rec.c == null) return "";
    return " — " + buildDurationText(Math.floor((Date.now() - rec.c) / DAY_MS));
  }
  function ensureFirstReadInitialized(){
    if(state["__firstRead"]) return;
    var minT = null;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") !== -1 && state[k] && state[k].c){
        if(minT === null || state[k].t < minT) minT = state[k].t;
      }
    });
    if(minT !== null){ state["__firstRead"] = {c: minT, t: minT}; saveLocalState(); }
  }

  // ===================== ПОЗДРАВЛЕНИЕ =====================
  function showCelebrationModal(){
    var overlay = document.getElementById("modalOverlay"), box = document.getElementById("modalBox");
    if(!overlay || !box) return;
    function closeThis(){ overlay.classList.remove("open"); box.innerHTML = ""; }
    box.innerHTML = modalHeader("Ты молодец!", "Прочитал Библию полностью. Не останавливайся на достигнутом!") +
      '<button class="modal-btn primary" id="mCelebrateReset">Начать читать заново (сбросить прогресс)</button>' +
      '<button class="modal-btn" id="mCelebrateKeep">Не сбрасывать</button>';
    var closeBtn0 = document.getElementById("mClose");
    if(closeBtn0) closeBtn0.addEventListener("click", closeThis);
    overlay.classList.add("open");
    document.getElementById("mCelebrateReset").addEventListener("click", function(){
      performFullReset();
      box.innerHTML = modalHeader("Прогресс был обновлён", "Приятного чтения!") + '<button class="modal-btn primary" id="mDone">Продолжить</button>';
      var closeBtn1 = document.getElementById("mClose");
      if(closeBtn1) closeBtn1.addEventListener("click", closeThis);
      document.getElementById("mDone").addEventListener("click", closeThis);
    });
    document.getElementById("mCelebrateKeep").addEventListener("click", function(){
      box.innerHTML = modalHeader("Хорошо", "Помните, вы всегда можете начать читать Библию заново. Для этого просто нужно открыть настройки (значок шестерёнки внизу страницы) и нажать на кнопку «Начать чтение сначала и сбросить прогресс».") + '<button class="modal-btn primary" id="mOk">ОК</button>';
      var closeBtn2 = document.getElementById("mClose");
      if(closeBtn2) closeBtn2.addEventListener("click", closeThis);
      document.getElementById("mOk").addEventListener("click", closeThis);
    });
  }
  function checkCelebration(){
    if(totalChecked === TOTAL_CHAPTERS){
      if(localStorage.getItem(CELEBRATION_SHOWN_KEY) !== "1"){
        try{ localStorage.setItem(CELEBRATION_SHOWN_KEY, "1"); }catch(e){}
        showCelebrationModal();
      }
    } else {
      try{ localStorage.removeItem(CELEBRATION_SHOWN_KEY); }catch(e){}
    }
  }

  // ===================== ПОСТРОЕНИЕ СТРАНИЦЫ (DocumentFragment) =====================
  var booksContainer = document.getElementById("booksContainer");
  var overallFill = document.getElementById("overallFill");
  var overallText = document.getElementById("overallText");
  var bookMeta = {};
  var chapterInputs = {};

  function initPage(){
    var frag = document.createDocumentFragment();
    var bookNumber = 0; // сквозная нумерация книг 1..66 для ссылок JW Finder
    sections.forEach(function(section){
      var label = document.createElement("div");
      label.className = "section-label";
      label.textContent = section.title;
      frag.appendChild(label);

      section.books.forEach(function(book){
        var bookName = book[0], chapterCount = book[1];
        bookNumber++;
        var thisBookNumber = bookNumber; // фиксируем для замыканий ниже
        checkedPerBook[bookName] = 0;

        var card = document.createElement("div");
        card.className = "book-card";

        var headerEl = document.createElement("div");
        headerEl.className = "book-header";

        var fillEl = document.createElement("div");
        fillEl.className = "book-fill";

        var headerContent = document.createElement("div");
        headerContent.className = "book-header-content";

        var nameEl = document.createElement("div");
        nameEl.className = "book-name";
        nameEl.textContent = bookName;

        var countEl = document.createElement("div");
        countEl.className = "book-count";

        var toggleEl = document.createElement("div");
        toggleEl.className = "toggle-check";
        toggleEl.innerHTML = "<span>&gt;</span>";

        headerContent.appendChild(nameEl);
        headerContent.appendChild(countEl);
        headerContent.appendChild(toggleEl);
        headerEl.appendChild(fillEl);
        headerEl.appendChild(headerContent);

        var chaptersContainer = document.createElement("div");
        chaptersContainer.className = "chapters-container";

        var grid = document.createElement("div");
        grid.className = "chapters-grid";

        for(var c=1;c<=chapterCount;c++){
          (function(chapterNum){
            var key = chapterKey(bookName, chapterNum);
            var checked = isChecked(key);
            if(checked){ checkedPerBook[bookName]++; totalChecked++; }

            var item = document.createElement("div");
            item.className = "chapter-item";

            var input = document.createElement("input");
            input.type = "checkbox";
            input.id = "ch_" + bookName.replace(/\s+/g,"_") + "_" + chapterNum;
            input.checked = checked;

            var lbl = document.createElement("label");
            lbl.setAttribute("for", input.id);
            lbl.textContent = chapterNum;

            // ---- долгое нажатие: открыть главу в JW Library / jw.org ----
            var LONG_PRESS_MS = 300;
            var pressTimer = null;
            var longPressFired = false;
            var pressStartXY = null;
            var MOVE_CANCEL_PX = 10;

            function clearPressTimer(){
              clearTimeout(pressTimer);
              pressTimer = null;
            }
            function startPress(x, y){
              longPressFired = false;
              pressStartXY = {x:x, y:y};
              clearPressTimer();
              pressTimer = setTimeout(function(){
                longPressFired = true;
                window.open(chapterLink(thisBookNumber, chapterNum), "_blank");
              }, LONG_PRESS_MS);
            }
            function movePress(x, y){
              if(!pressStartXY) return;
              var dx = x - pressStartXY.x, dy = y - pressStartXY.y;
              if(Math.sqrt(dx*dx + dy*dy) > MOVE_CANCEL_PX) clearPressTimer();
            }

            item.addEventListener("touchstart", function(e){
              var t = e.touches[0];
              startPress(t.clientX, t.clientY);
            }, {passive:true});
            item.addEventListener("touchmove", function(e){
              var t = e.touches[0];
              movePress(t.clientX, t.clientY);
            }, {passive:true});
            item.addEventListener("touchend", clearPressTimer);
            item.addEventListener("touchcancel", clearPressTimer);

            // Поддержка мыши — удобно для отладки на десктопе.
            item.addEventListener("mousedown", function(e){ startPress(e.clientX, e.clientY); });
            item.addEventListener("mousemove", function(e){ movePress(e.clientX, e.clientY); });
            item.addEventListener("mouseup", clearPressTimer);
            item.addEventListener("mouseleave", clearPressTimer);

            input.addEventListener("click", function(e){
              if(longPressFired){
                // Долгое нажатие уже открыло ссылку — гасим обычный цикл
                // отметки, чтобы одно и то же нажатие не делало два дела.
                e.preventDefault();
                longPressFired = false;
                return;
              }
              if(!getColorMarkEnabled()) return; // обычный режим — обрабатывается в "change"
              e.preventDefault();
              // Браузер откатывает checked к значению "до клика" сразу после
              // отмены дефолтного действия чекбокса — это происходит уже
              // ПОСЛЕ выполнения этого обработчика и стирает любое присвоение
              // input.checked, сделанное синхронно здесь. Откладываем на
              // следующий тик, чтобы наше значение применилось уже после
              // отката браузера.
              setTimeout(function(){
                cycleChapterState(bookName, key, input, item);
              }, 0);
            });

            input.addEventListener("change", function(){
              if(longPressFired){ longPressFired = false; return; }
              if(getColorMarkEnabled()) return; // цветовой режим — уже обработано в "click"
              var prevRec = state[key];
              state[key] = {c: input.checked, t: Date.now()};
              if(input.checked){
                if(!state["__firstRead"] || state["__firstRead"].c == null){
                  state["__firstRead"] = {c: Date.now(), t: Date.now()};
                }
                checkedPerBook[bookName]++;
                totalChecked++;
              } else {
                // снимаем галочку, стоявшую с СЕГОДНЯ — значит, это была
                // сегодняшняя перепроверка, а не подтверждённое со вчера
                // чтение; помечаем её "сожжённой" на сегодня, чтобы
                // повторная установка в тот же день не засчиталась заново
                if(prevRec && prevRec.c === true && startOfDay(prevRec.t) === startOfDay(Date.now())){
                  addTodayExcludedKey(key);
                }
                checkedPerBook[bookName]--;
                totalChecked--;
              }
              saveLocalState();
              updateBookProgress(bookName);
              updateHideProgressBadge();
              updateOverallProgress();
              updateMissedBanner();
              scheduleCloudPush();
            });

            chapterInputs[key] = input;
            item.appendChild(input);
            item.appendChild(lbl);
            grid.appendChild(item);
            if(checked && getColorMarkEnabled()){
              var storedClr = (state[key] && state[key].clr) || null;
              if(storedClr) applyChapterColorClass(item, storedClr);
            }
          })(c);
        }

        chaptersContainer.appendChild(grid);

        headerEl.addEventListener("click", function(){
          var isOpen = chaptersContainer.classList.toggle("open");
          headerEl.classList.toggle("expanded", isOpen);
          if(isOpen){
            // Высота берётся из заранее посчитанного кэша (см. кэширование
            // после монтирования всех карточек ниже), а не измеряется через
            // grid.scrollHeight прямо здесь — чтение scrollHeight форсирует
            // синхронный layout всего документа ("forced reflow") в момент
            // клика, что ощущается как микро-задержка перед началом анимации
            // раскрытия, особенно на слабых устройствах.
            var meta = bookMeta[bookName];
            var h = (meta && meta.gridHeight != null) ? meta.gridHeight : grid.scrollHeight;
            chaptersContainer.style.setProperty("--ch-h", h + 28 + "px");
          }
        });

        card.appendChild(headerEl);
        card.appendChild(chaptersContainer);
        frag.appendChild(card);

        bookMeta[bookName] = {fillEl:fillEl, countEl:countEl, chapterCount:chapterCount, card:card, grid:grid, gridHeight:null};
        updateBookProgress(bookName);
      });
    });
    booksContainer.appendChild(frag);

    // Кэшируем реальную высоту сетки глав для каждой книги ОДИН РАЗ, сразу
    // после того как все карточки уже вставлены в DOM (до этого момента
    // scrollHeight всё равно вернул бы 0, т.к. фрагмент ещё не был
    // подключен к документу). Дальше эта высота переиспользуется при каждом
    // клике на книгу вместо повторного дорогого измерения.
    cacheAllChapterGridHeights();

    addHideProgressButton();
  }

  function cacheAllChapterGridHeights(){
    Object.keys(bookMeta).forEach(function(bookName){
      var meta = bookMeta[bookName];
      if(meta && meta.grid) meta.gridHeight = meta.grid.scrollHeight;
    });
  }

  // Число колонок в сетке глав зависит от ширины контейнера
  // (grid-template-columns: repeat(auto-fill, minmax(46px,1fr))), поэтому
  // при повороте экрана или изменении размеров окна число строк — а значит
  // и реальная высота — может измениться. Пересчитываем кэш и, если какая-то
  // книга сейчас раскрыта, сразу обновляем её видимую высоту, чтобы контент
  // не обрезался.
  var chapterGridResizeTimer = null;
  window.addEventListener("resize", function(){
    clearTimeout(chapterGridResizeTimer);
    chapterGridResizeTimer = setTimeout(function(){
      cacheAllChapterGridHeights();
      Object.keys(bookMeta).forEach(function(bookName){
        var meta = bookMeta[bookName];
        if(!meta || !meta.card) return;
        var container = meta.card.querySelector(".chapters-container.open");
        if(container) container.style.setProperty("--ch-h", meta.gridHeight + 28 + "px");
      });
    }, 150);
  });

  // --- "Скрыть прогресс": прячет из списка книги, прочитанные на 100% ---
  function getHideCompletedActive(){
    var r = state["__hideCompletedBooks"];
    return !!(r && r.c);
  }
  function countCompletedBooks(){
    var n = 0;
    Object.keys(bookMeta).forEach(function(bookName){
      var meta = bookMeta[bookName];
      var checked = checkedPerBook[bookName] || 0;
      if(meta.chapterCount > 0 && checked === meta.chapterCount) n++;
    });
    return n;
  }
  var hideCompletedActive = false;
  function addHideProgressButton(){
    hideCompletedActive = getHideCompletedActive();
    var card = document.createElement("div");
    card.className = "book-card";
    var headerEl = document.createElement("div");
    headerEl.className = "book-header";
    var headerContent = document.createElement("div");
    headerContent.className = "book-header-content";
    var nameEl = document.createElement("div");
    nameEl.className = "book-name";
    nameEl.id = "hideProgressToggleText";
    nameEl.textContent = hideCompletedActive ? "Показать прочитанное" : "Скрыть прочитанное";
    var countEl = document.createElement("div");
    countEl.className = "book-count";
    countEl.id = "hideProgressCountBadge";
    var toggleEl = document.createElement("div");
    toggleEl.className = "toggle-check";
    headerContent.style.cursor = "pointer";
    headerContent.appendChild(nameEl);
    headerContent.appendChild(countEl);
    headerContent.appendChild(toggleEl);
    headerEl.appendChild(headerContent);
    headerContent.addEventListener("click", toggleHideCompletedBooks);
    card.appendChild(headerEl);
    booksContainer.appendChild(card);
    updateHideProgressBadge();
    // на момент отрисовки карточек книг (в цикле выше, см. renderBooks)
    // hideCompletedActive ещё не был загружен из сохранённого состояния
    // (оставался в дефолтном false), поэтому все карточки, включая уже
    // прочитанные на 100%, всегда отрисовывались видимыми — сохранённое
    // "скрыть прочитанное" применялось только к своей текстовой подписи и
    // счётчику, но не к самим карточкам. Досчитываем видимость карточек
    // здесь же, сразу после того, как значение подгружено из state.
    applyHideCompletedBooks();
  }
  function updateHideProgressBadge(){
    var badge = document.getElementById("hideProgressCountBadge");
    if(badge) badge.textContent = String(countCompletedBooks());
  }
  function applyHideCompletedBooks(){
    Object.keys(bookMeta).forEach(function(bookName){
      var meta = bookMeta[bookName];
      if(!meta || !meta.card) return;
      var checked = checkedPerBook[bookName] || 0;
      var isComplete = meta.chapterCount > 0 && checked === meta.chapterCount;
      meta.card.style.display = (hideCompletedActive && isComplete) ? "none" : "";
    });
    updateHideProgressBadge();
  }
  function toggleHideCompletedBooks(){
    hideCompletedActive = !hideCompletedActive;
    state["__hideCompletedBooks"] = {c: hideCompletedActive, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    var textEl = document.getElementById("hideProgressToggleText");
    if(textEl) textEl.textContent = hideCompletedActive ? "Показать прочитанное" : "Скрыть прочитанное";
    applyHideCompletedBooks();
  }

  function updateBookProgress(bookName){
    var meta = bookMeta[bookName];
    var checked = checkedPerBook[bookName] || 0;
    var pct = meta.chapterCount ? Math.round((checked/meta.chapterCount)*100) : 0;
    meta.fillEl.style.width = pct + "%";
    meta.countEl.textContent = checked + " / " + meta.chapterCount;
    if(hideCompletedActive && meta.card){
      meta.card.style.display = (meta.chapterCount > 0 && checked === meta.chapterCount) ? "none" : "";
    }
    // Раньше updateHideProgressBadge() вызывался прямо здесь, внутри
    // updateBookProgress. Он сам внутри пересчитывает countCompletedBooks(),
    // которая проходит по ВСЕМ книгам — то есть каждый вызов
    // updateBookProgress стоил не O(1), а O(число книг). Когда
    // updateBookProgress вызывается по очереди для всех 66 книг подряд
    // (при первой отрисовке, синхронизации или сбросе прогресса), это
    // превращалось в O(n²) лишней работы и десятки лишних перезаписей
    // одного и того же текстового узла, хотя реальное значение бейджа
    // нужно пересчитать только один раз — после того как весь цикл
    // закончится. Теперь вызовы updateHideProgressBadge() расставлены
    // явно у каждого места, которое зовёт updateBookProgress (см. ниже) —
    // один раз для одиночных вызовов и один раз ПОСЛЕ цикла для массовых.
  }

  function updateOverallProgress(){
    var pct = TOTAL_CHAPTERS ? Math.round((totalChecked/TOTAL_CHAPTERS)*100) : 0;
    overallFill.style.width = pct + "%";
    overallText.textContent = totalChecked + " из " + TOTAL_CHAPTERS + " глав (" + pct + "%)" + getDurationSuffix();
    checkCelebration();
  }

  function rerenderAllFromState(){
    var prevTotal = totalChecked;
    totalChecked = 0;
    Object.keys(checkedPerBook).forEach(function(bn){ checkedPerBook[bn] = 0; });

    Object.keys(chapterInputs).forEach(function(key){
      var input = chapterInputs[key];
      var newChecked = isChecked(key);
      if(input.checked !== newChecked) input.checked = newChecked;
      if(newChecked){
        var parts = key.split("|");
        checkedPerBook[parts[0]] = (checkedPerBook[parts[0]] || 0) + 1;
        totalChecked++;
      }
    });
    refreshAllChapterColorVisuals();

    Object.keys(bookMeta).forEach(function(bookName){
      updateBookProgress(bookName);
    });
    updateHideProgressBadge();
    updateOverallProgress();
    applyThemeToPage(getCurrentThemeId());
    if(!document.getElementById("themeDots").children.length) renderThemeDots();
    updateMissedBanner();
    renderHourBars();
    renderHourCounterMenu();
    renderGoalsSection();
    renderAddGoalMenu();
    refreshYearGridIfOpen();
  }

  // ===================== СБРОС ПРОГРЕССА =====================
  function setNoTransitions(enable){
    document.body.classList.toggle("no-transitions", enable);
  }

  function performFullReset(){
    setNoTransitions(true);
    var now = Date.now();
    sections.forEach(function(section){
      section.books.forEach(function(book){
        var bookName = book[0], chapterCount = book[1];
        checkedPerBook[bookName] = 0;
        for(var c=1;c<=chapterCount;c++){
          state[chapterKey(bookName,c)] = {c:false, t:now};
        }
      });
    });
    totalChecked = 0;
    state["__lastReadExcludedToday"] = {c:null, t:now};
    state["__firstRead"] = {c:null, t:now};
    saveLocalState();
    rerenderAllFromState();
    try{ localStorage.removeItem(CELEBRATION_SHOWN_KEY); }catch(e){}
    setTimeout(function(){ setNoTransitions(false); }, 50);

    if(syncId && navigator.onLine){
      setSyncState("syncing");
      putCloudBlob(syncId, state).then(function(){ setSyncState("synced"); }).catch(function(){ setSyncState("error"); });
    }
  }

  // Кнопка сброса прогресса перенесена в настройки (settingsResetBtn, см. renderSettingsTabGear)

  // ===================== ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ (Firebase Realtime Database) =====================
  // ВАЖНО: этот URL нужно проверить/поправить на точный "Database URL" из
  // консоли Firebase (Realtime Database → вкладка Data, отображается прямо
  // над данными). Обычно это или https://<имя>.firebaseio.com, или адрес
  // с регионом вида https://<имя>.<регион>.firebasedatabase.app — они
  // отличаются в зависимости от того, в каком регионе была создана база.
  // Правила сейчас открытые (read/write: true), поэтому токен/ключ не
  // нужен — простые GET/PUT запросы работают напрямую.
  var FIREBASE_DB_URL = "https://my-nekogram-default-rtdb.europe-west1.firebasedatabase.app";
  var FIREBASE_SYNCS_PATH = "/syncs";
  // Ключ технической записи в облачных данных с меткой времени последнего
  // обращения к этому коду синхронизации (создание, подключение, обычная
  // фоновая синхронизация — что угодно, что реально пишет в облако).
  // Не имеет отношения к пользовательским данным.
  var LAST_ACTIVE_STATE_KEY = "__syncLastActive";
  var SYNC_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 365 дней

  function fetchWithTimeout(url, options, timeoutMs){
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs || 8000);
    options = options || {};
    options.signal = ctrl.signal;
    return fetch(url, options).finally(function(){ clearTimeout(timer); });
  }

  function generateSyncId(){
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
  }

  function fetchCloudBlob(id){
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", {
      method:"GET"
    }, 8000).then(function(res){
      if(!res.ok) throw new Error("fetch_failed_" + res.status);
      return res.json();
    }).then(function(data){
      // Firebase отдаёт null (не 404), если по пути ничего нет
      if(data === null || data === undefined) throw new Error("not_found");
      // Данные, которыми не пользовались (ни разу не подключались/не
      // синхронизировались) больше года — считаем истёкшими: удаляем с
      // сервера и сообщаем вызывающему коду, что кода больше не существует.
      // У записей, созданных до появления этой метки, __syncLastActive
      // отсутствует — такие записи не удаляем (нет данных, чтобы посчитать
      // срок), они получат метку при первой же следующей записи в облако.
      var lastActiveRec = data[LAST_ACTIVE_STATE_KEY];
      var lastActiveTs = lastActiveRec && typeof lastActiveRec.t === "number" ? lastActiveRec.t : null;
      if(lastActiveTs !== null && (Date.now() - lastActiveTs) > SYNC_EXPIRY_MS){
        return deleteCloudBlob(id).catch(function(){}).then(function(){
          throw new Error("expired");
        });
      }
      return data;
    });
  }

  function deleteCloudBlob(id){
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", {
      method:"DELETE"
    }, 8000).then(function(res){
      if(!res.ok) throw new Error("delete_failed_" + res.status);
      return true;
    });
  }

  function putCloudBlob(id, data){
    // Каждая запись в облако обновляет метку "последней активности" этого
    // кода синхронизации — от неё считается годовой срок хранения (см.
    // fetchCloudBlob). Метка добавляется только в отправляемую копию,
    // локальный объект state этим не засоряется.
    var payload = {};
    var src = data || {};
    Object.keys(src).forEach(function(k){ payload[k] = src[k]; });
    payload[LAST_ACTIVE_STATE_KEY] = {c:true, t:Date.now()};
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    }, 15000).then(function(res){
      if(!res.ok) throw new Error("put_failed_" + res.status);
      return true;
    });
  }

  // отдельного "создания" Firebase не требует — запись по случайному ID
  // сама создаёт узел при первом PUT
  function createCloudBlob(initialData){
    var id = generateSyncId();
    return putCloudBlob(id, initialData).then(function(){ return id; });
  }

  function mergeStates(local, cloud){
    var merged = {}, keys = {};
    Object.keys(local||{}).forEach(function(k){ keys[k]=true; });
    Object.keys(cloud||{}).forEach(function(k){ keys[k]=true; });
    Object.keys(keys).forEach(function(k){
      var l = local ? local[k] : null, c = cloud ? cloud[k] : null;
      merged[k] = (l && c) ? ((l.t >= c.t) ? l : c) : (l || c);
    });
    return merged;
  }

  function statesEqual(a, b){
    var ak = Object.keys(a||{}).sort(), bk = Object.keys(b||{}).sort();
    if(ak.length !== bk.length) return false;
    for(var i=0;i<ak.length;i++){
      var k = ak[i];
      if(!b[k]) return false;
      if(a[k].c !== b[k].c || a[k].t !== b[k].t) return false;
    }
    return true;
  }

  var syncStatusPill = document.getElementById("syncStatusPill");
  var syncStatusText = document.getElementById("syncStatusText");

  function setSyncState(st, extraText){
    syncStatusPill.setAttribute("data-state", st);
    if(st !== "off") syncStatusPill.classList.remove("sync-collapsed");
    var labels = {off:"Настроить<br>синхронизацию",offline:"",syncing:"",synced:"",error:""};
    syncStatusText.innerHTML = (extraText != null ? extraText : labels[st]) || "";
  }

  function refreshStatusBase(){
    if(!syncId){ setSyncState("off"); return; }
    if(!navigator.onLine){ setSyncState("offline"); return; }
    setSyncState("synced");
  }
  refreshStatusBase();

  var pushTimer = null;
  function scheduleCloudPush(){
    if(!syncId) return;
    clearTimeout(pushTimer);
    clearTimeout(syncRetryTimer);
    syncRetryCount = 0;
    pushTimer = setTimeout(doCloudSync, 1500);
  }

  var syncInProgress = false;
  var syncRetryCount = 0;
  var syncRetryTimer = null;
  var SYNC_RETRY_DELAYS = [5000, 15000, 40000, 90000];

  function doCloudSync(){
    if(!syncId) { setSyncState("off"); return; }
    if(!navigator.onLine){ setSyncState("offline"); return; }
    if(syncInProgress) return;
    syncInProgress = true;
    setSyncState("syncing");
    fetchCloudBlob(syncId).then(function(cloudData){
      var merged = mergeStates(state, cloudData);
      var localChanged = !statesEqual(merged, state);
      var cloudChanged = !statesEqual(merged, cloudData);
      state = merged;
      if(localChanged){
        saveLocalState();
        setNoTransitions(true);
        rerenderAllFromState();
        setTimeout(function(){ setNoTransitions(false); }, 50);
      }
      if(cloudChanged){
        return putCloudBlob(syncId, merged);
      }
    }).then(function(){
      syncRetryCount = 0;
      clearTimeout(syncRetryTimer);
      setSyncState("synced");
    }).catch(function(err){
      console.error("Ошибка синхронизации:", err);
      // Код истёк (данные на сервере удалены за неактивностью дольше года,
      // см. fetchCloudBlob) — повторять попытки бессмысленно, кода больше
      // не существует. Отключаем синхронизацию на этом устройстве, локальный
      // прогресс при этом не трогаем, и сообщаем пользователю один раз.
      if(String(err.message||"").indexOf("expired") !== -1){
        syncId = null;
        localStorage.removeItem(SYNC_ID_KEY);
        setSyncState("off");
        refreshStatusBase();
        alert("Синхронизация на этом устройстве отключена: данные на сервере были удалены, так как этим кодом не пользовались больше года. Локальный прогресс сохранён — при необходимости создайте новый код синхронизации.");
        return;
      }
      setSyncState("error");
      // не заставляем пользователя перепривязывать устройство вручную —
      // сами повторяем попытку с нарастающей паузой (сбой чаще всего
      // временный: сеть моргнула или разросшийся объём данных долго грузится)
      if(syncRetryCount < SYNC_RETRY_DELAYS.length){
        var delay = SYNC_RETRY_DELAYS[syncRetryCount];
        syncRetryCount++;
        clearTimeout(syncRetryTimer);
        syncRetryTimer = setTimeout(doCloudSync, delay);
      }
    }).finally(function(){
      syncInProgress = false;
    });
  }

  window.addEventListener("online", function(){
    refreshStatusBase();
    syncRetryCount = 0;
    clearTimeout(syncRetryTimer);
    doCloudSync();
  });
  window.addEventListener("offline", function(){ refreshStatusBase(); });
  if(syncId) doCloudSync();

  // ===================== МОДАЛЬНОЕ ОКНО СИНХРОНИЗАЦИИ =====================
  var modalOverlay = document.getElementById("modalOverlay");
  var modalBox = document.getElementById("modalBox");
  var activeStream = null, scanRAF = null;

  function stopCamera(){
    if(scanRAF){ cancelAnimationFrame(scanRAF); scanRAF = null; }
    if(activeStream){ activeStream.getTracks().forEach(function(t){ t.stop(); }); activeStream = null; }
  }
  function closeModal(){ stopCamera(); flushPendingTaskEdits(); modalOverlay.classList.remove("open"); modalBox.classList.remove("year-day-modal"); modalBox.innerHTML = ""; }
  function openModal(){ modalOverlay.classList.add("open"); renderModalHome(); }
  modalOverlay.addEventListener("click", function(e){ if(e.target === modalOverlay) closeModal(); });
  syncStatusPill.addEventListener("click", openModal);

  // надпись "Настроить синхронизацию" видна только до первого
  // взаимодействия пользователя со страницей — дальше плашка сворачивается
  // в обычную серую точку, чтобы не отвлекать от контента
  (function(){
    var collapseEvents = ["scroll","touchstart","pointerdown","mousedown","keydown","wheel"];
    function collapseSyncPill(){
      syncStatusPill.classList.add("sync-collapsed");
      collapseEvents.forEach(function(ev){
        window.removeEventListener(ev, collapseSyncPill, {capture:true});
      });
    }
    collapseEvents.forEach(function(ev){
      window.addEventListener(ev, collapseSyncPill, {capture:true, passive:true});
    });
  })();

  function modalHeader(title, subtitle){
    var h = '<button class="modal-close" id="mClose">&times;</button><h2>' + title + '</h2>';
    if(subtitle) h += '<p>' + subtitle + '</p>';
    return h;
  }
  function bindClose(){ var btn = document.getElementById("mClose"); if(btn) btn.addEventListener("click", closeModal); }

  // ===================== СЧЁТЧИК НАСТРОЕНИЯ =====================
  // Логика счётчика настроения и построения диаграммы вынесена в отдельный
  // файл mood.js (см. index.html и sw.js). Модуль создаётся здесь же —
  // как можно раньше, — потому что renderSettingsTabGear (вызывается уже
  // при первой раскладке окна настроек, см. layoutSettingsModal) обращается
  // к isMoodEnabled() ещё до того, как пользователь открыл вкладку
  // настроения. Публичные функции модуля привязываются к тем же именам,
  // что использовались раньше, чтобы остальной код my.js не менялся.
  var Mood = window.initMoodModule({
    getState: function(){ return state; },
    setHourState: setHourState,
    saveLocalState: saveLocalState,
    scheduleCloudPush: scheduleCloudPush,
    escapeHtml: escapeHtml,
    startOfDay: startOfDay,
    DAY_MS: DAY_MS,
    pluralRu: pluralRu,
    DAY_FORMS: DAY_FORMS,
    MONTH_FORMS: MONTH_FORMS,
    closeModal: closeModal,
    modalBox: modalBox,
    modalOverlay: modalOverlay,
    bindClose: bindClose,
    modalHeader: modalHeader,
    switchSettingsTab: switchSettingsTab,
    refreshYearGridIfOpen: refreshYearGridIfOpen
  });
  var isMoodEnabled = Mood.isMoodEnabled;
  var getMoodDataResetAt = Mood.getMoodDataResetAt;
  var renderSettingsTabMood = Mood.renderSettingsTabMood;
  var renderSettingsTabMoodResetConfirm = Mood.renderSettingsTabMoodResetConfirm;
  var getMoodsByDay = Mood.getMoodsByDay;
  var moodCategoriesResolved = Mood.moodCategoriesResolved;

  // ===================== ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ИЗ ГРАФИКОВ =====================
  // Логика вкладки "Извлечение информации из графиков" (первая нижняя
  // вкладка второго набора, settingsTabSet2GearBtn1 / "set2b_1") вынесена
  // в отдельный файл workbooks.js (см. index.html и sw.js) — по тому же
  // образцу, что и Mood выше.
  var Workbooks = window.initWorkbooksModule({
    escapeHtml: escapeHtml,
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG
  });
  var renderSettingsTabWorkbooks = Workbooks.renderSettingsTabWorkbooks;

  // ===================== ОБЪЕДИНЕНИЕ ЗАМЕТОК JW LIBRARY =====================
  // Логика вкладки "Объединение заметок" (третья нижняя вкладка второго
  // набора, settingsTabSet2GearBtn3 / "set2b_3") вынесена в отдельный файл
  // jwlmerge.js (см. index.html и sw.js) — по тому же образцу, что и
  // Workbooks выше.
  var JwlMerge = window.initJwlMergeModule({
    escapeHtml: escapeHtml,
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG,
    switchSettingsTab: switchSettingsTab
  });
  var renderSettingsTabNotesMerge = JwlMerge.renderSettingsTabNotesMerge;

  // ===================== РАЗДЕЛЕНИЕ EPUB-ФАЙЛОВ =====================
  // Логика вкладки "Разделение epub-файлов" (пятая боковая вкладка второго
  // набора, settingsTabSet2Btn5 / "set2s_5") вынесена в отдельный файл
  // epubsplit.js (см. index.html и sw.js) — по тому же образцу, что и
  // JwlMerge выше.
  var EpubSplit = window.initEpubSplitModule({
    escapeHtml: escapeHtml,
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG
  });
  var renderSettingsTabEpubSplit = EpubSplit.renderSettingsTabEpubSplit;

  // ===================== ЗАПОЛНЕНИЕ БЛАНКОВ S-89 =====================
  // Логика вкладки "Заполнение бланков S-89" (вторая нижняя вкладка
  // второго набора, settingsTabSet2GearBtn2 / "set2b_2") вынесена в
  // отдельный файл s89fill.js (плюс s89tasks.js — разбор документа,
  // s89draw.js — отрисовка через Canvas) — по тому же образцу, что и
  // Workbooks/JwlMerge выше.
  var S89Fill = window.initS89FillModule({
    escapeHtml: escapeHtml,
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG
  });
  var renderSettingsTabS89Fill = S89Fill.renderSettingsTabS89Fill;

  // ===================== ИЗМЕНЕНИЕ РАЗМЕРА ИЗОБРАЖЕНИЯ =====================
  // Логика вкладки "Изменение размера изображения" (шестая боковая вкладка
  // второго набора, settingsTabSet2Btn6 / "set2s_6") вынесена в отдельный
  // файл imgresize.js (см. index.html и sw.js) — по тому же образцу, что и
  // EpubSplit/JwlMerge выше.
  var ImgResize = window.initImgResizeModule({
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG
  });
  var renderSettingsTabImgResize = ImgResize.renderSettingsTabImgResize;

  // ===================== МОЙ ПОЧТОВЫЙ БЛОКНОТ (md-редактор) =====================
  // Логика вкладки "Мой блокнот" (первая боковая вкладка второго
  // набора, settingsTabSet2Btn1 / "set2s_1") вынесена в отдельный файл
  // mdeditor.js (см. index.html и sw.js) — по тому же образцу, что и
  // ImgResize/EpubSplit выше. flushPendingMdEditorEdit сохраняет несохранённые
  // правки в открытой заметке при уходе со вкладки — вызывается в общем блоке
  // flush* в начале switchSettingsTab, тем же приёмом, что и
  // flushPendingCommentEdits и т.п.
  var MdEditor = window.initMdEditorModule({
    escapeHtml: escapeHtml,
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG,
    // то же распознавание ссылок на Библию, что и в "Карте дней года" (см.
    // SCRIPTURE_RE/BOOK_ALIASES/scriptureRefLink выше) — regexSource
    // передаётся строкой (а не самим RegExp), чтобы mdeditor.js собрал
    // СВОЙ экземпляр с флагом "g" и своим lastIndex, не деля состояние с
    // этим же регэкспом в других местах кода.
    scriptureRegexSource: SCRIPTURE_RE.source,
    bookAliases: BOOK_ALIASES,
    scriptureRefLink: scriptureRefLink,
    // для задач формата "- [ ] текст" / "- [x] текст" в режиме "без кода"
    // (см. TaskActionsWidget в mdeditor.js) — те же иконки/действия, что и
    // у обычных задач на вкладках задач (см. ТЗ пользователя от 30.08).
    CHECK_ICON_SVG: CHECK_ICON_SVG,
    ARROW_MOVE_ICON_SVG: ARROW_MOVE_ICON_SVG,
    createArchivedTaskWithText: createArchivedTaskWithText,
    openTaskMoveTargetPicker: openTaskMoveTargetPicker
  });
  var renderSettingsTabMdEditor = MdEditor.renderSettingsTabMdEditor;
  var flushPendingMdEditorEdit = MdEditor.flushPendingMdEditorEdit;

  // --- ленивая загрузка QRCode и jsQR ---
  var qrLibLoaded = false, jsqrLibLoaded = false;
  function loadQrLib(){
    if(qrLibLoaded) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/davidshimjs-qrcodejs@0.0.2/qrcode.min.js";
      s.onload = function(){ qrLibLoaded = true; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadJsqrLib(){
    if(jsqrLibLoaded) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
      s.onload = function(){ jsqrLibLoaded = true; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ===================== ЭКСПОРТ ЛИЧНЫХ ДАННЫХ =====================
  // Собирает всё в структуру, понятную и человеку, и нейросети (плоские
  // списки "дата -> что было в этот день"), и упаковывает в настоящий
  // ZIP-архив без сторонних библиотек (формат STORED — без сжатия, это
  // самый простой валидный вариант ZIP, полностью совместимый с любым
  // распаковщиком).
  function isoDate(ts){ return new Date(ts).toISOString().slice(0,10); }
  var EXPORT_FORMAT_VERSION = 2;

  function buildExportData(){
    var data = {
      exportedAt: new Date().toISOString(),
      exportFormatVersion: EXPORT_FORMAT_VERSION,
      app: "Bible Reading Tracker — экспорт личных данных",
      readingProgress: {
        totalChapters: TOTAL_CHAPTERS,
        checkedChapters: totalChecked,
        percentComplete: TOTAL_CHAPTERS ? Math.round((totalChecked/TOTAL_CHAPTERS)*100) : 0
      },
      dailyReadingLog: [],
      hourCounter: {
        enabled: !!getHourGoal(),
        goalHoursPerMonth: getHourGoal(),
        monthsToSeptember: getMonthsToSeptember(),
        note: "dailyHoursLog содержит только текущий незакрытый период — итоги закрытых месяцев доступны только суммарно, в closedMonthSegments",
        dailyHoursLog: [],
        closedMonthSegments: [],
        notesEnabled: isHourNotesEnabled(),
        dailyNotesLog: []
      },
      moodCounter: {
        enabled: isMoodEnabled(),
        dailyMoodLog: []
      },
      headerQuotes: {
        bibleQuotesEnabled: getBibleQuotesEnabled(),
        customCommentsEnabled: getCustomCommentsEnabled(),
        customVerse: getCustomVerse()
      },
      customComments: {
        note: "list — записи из вкладки \"Добавить кастомный комментарий\" (могут быть отредактированы/удалены независимо от их копий в Карте дней года). dailyLog — копии, привязанные к дню создания и показанные в Карте дней года; удаление записи из list их не затрагивает.",
        list: [],
        dailyLog: []
      }
    };

    var byDate = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(!rec || rec.c !== true) return;
      var d = isoDate(rec.t);
      (byDate[d] = byDate[d] || []).push(k.replace("|", " "));
    });
    Object.keys(byDate).sort().forEach(function(d){
      data.dailyReadingLog.push({date: d, chaptersRead: byDate[d], count: byDate[d].length});
    });

    var hourByDate = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0){
        var rec = state[k];
        if(!rec || typeof rec.c !== "number") return;
        var d = isoDate(rec.t);
        hourByDate[d] = (hourByDate[d]||0) + rec.c;
      } else if(k.indexOf("hourday:") === 0){
        var rec3 = state[k];
        if(!rec3 || typeof rec3.c !== "number") return;
        var dayTs = Number(k.slice("hourday:".length));
        if(isNaN(dayTs)) return;
        var d2 = isoDate(dayTs);
        hourByDate[d2] = (hourByDate[d2]||0) + rec3.c;
      }
    });
    Object.keys(hourByDate).sort().forEach(function(d){
      data.hourCounter.dailyHoursLog.push({date:d, hoursMinutesText: formatHHMM(hourByDate[d]), minutes: hourByDate[d]});
    });
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hoursegment:") !== 0) return;
      var rec = state[k];
      if(!rec) return;
      data.hourCounter.closedMonthSegments.push({
        periodStartDate: isoDate(Number(k.slice("hoursegment:".length))),
        totalHours: Math.round(rec.c/60)
      });
    });

    var notesByDay = getHourNotesByDay();
    Object.keys(notesByDay).sort(function(a,b){ return Number(a)-Number(b); }).forEach(function(dayTs){
      data.hourCounter.dailyNotesLog.push({date: isoDate(Number(dayTs)), comment: notesByDay[dayTs]});
    });

    var moodByDate = {};
    var floor = getMoodDataResetAt();
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodlog:") !== 0) return;
      var rec = state[k];
      if(!rec || rec.t < floor) return;
      var d = isoDate(rec.t);
      (moodByDate[d] = moodByDate[d] || []).push(rec.c);
    });
    Object.keys(moodByDate).sort().forEach(function(d){
      data.moodCounter.dailyMoodLog.push({date:d, moods: moodByDate[d]});
    });

    // журнал выполненных задач по целям — хранится отдельно от самих целей,
    // поэтому остаётся в архиве, даже если цель потом удалили или сняли
    // с неё галочку
    data.goalCompletions = {
      note: "Список отмеченных задач по личным целям, по датам. Запись сохраняется здесь независимо от того, существует ли ещё сама цель — значит, здесь виден полный журнал выполненного, даже для уже удалённых или переиспользованных целей.",
      dailyLog: []
    };
    var goalByDate = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goalcompletion:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c) return;
      var d = isoDate(rec.t);
      (goalByDate[d] = goalByDate[d] || []).push({goal: rec.c.goalTitle, task: rec.c.taskText});
    });
    Object.keys(goalByDate).sort().forEach(function(d){
      data.goalCompletions.dailyLog.push({date:d, completed: goalByDate[d]});
    });

    getAllComments().forEach(function(c){
      if(!c.c.text) return;
      data.customComments.list.push({date: isoDate(c.t), text: c.c.text});
    });
    var yearCommentsByDay = getYearCommentsByDayAll();
    Object.keys(yearCommentsByDay).sort(function(a,b){ return Number(a)-Number(b); }).forEach(function(dayTs){
      data.customComments.dailyLog.push({date: isoDate(Number(dayTs)), comments: yearCommentsByDay[dayTs]});
    });

    // rawState — точный технический снимок всех данных приложения (то же,
    // что хранится в localStorage и синхронизируется в облаке). Разделы
    // выше уже собраны в удобном для чтения (в т.ч. нейросетью) виде — этот
    // раздел дублирует ту же информацию без потерь и нужен только для
    // восстановления через кнопку "Импортировать личные данные": именно
    // из rawState.data при импорте полностью восстанавливаются прогресс-бары,
    // ячейки по датам и всё остальное. Менять его вручную не нужно.
    data.rawState = {
      note: "Технический снимок для восстановления (кнопка «Импортировать личные данные»). Формат каждой записи: {c: значение, t: время изменения в мс}. Ключи см. в keyFormats.",
      keyFormats: {
        "Книга|Глава (напр. \"John|3\")": "отметка о прочтении главы: c — прочитано (true/false)",
        "hourlog:*": "запись счётчика часов текущего периода: c — минуты",
        "hourday:*": "запись счётчика часов, привязанная к конкретному дню: c — минуты",
        "hoursegment:*": "итог уже закрытого месяца: c — минуты за весь месяц",
        "hournote:*": "комментарий к записи счётчика часов",
        "moodlog:*": "отметка настроения: c — значение настроения",
        "goal:*": "личная цель и список её задач",
        "goalcompletion:*": "отметка о выполнении задачи внутри цели",
        "task:*": "задача (вне целей)",
        "taskcompletion:*": "отметка о выполнении задачи",
        "comment:*": "запись из списка кастомных комментариев",
        "yearcomment:*": "комментарий, привязанный к дню в «Карте дней года»",
        "__* (напр. __theme, __firstRead, __syncLastActive)": "настройки приложения (тема, видимость элементов интерфейса и т.п.) и служебные технические записи синхронизации"
      },
      data: state
    };

    return data;
  }

  function crc32Bytes(bytes){
    if(!crc32Bytes.table){
      var table = [];
      for(var n=0;n<256;n++){
        var c = n;
        for(var k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); }
        table[n] = c >>> 0;
      }
      crc32Bytes.table = table;
    }
    var crc = 0xFFFFFFFF;
    for(var i=0;i<bytes.length;i++){
      crc = crc32Bytes.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Собирает валидный ZIP (метод STORED, без сжатия) из списка файлов
  // {name, content: Uint8Array} — минимальная, но полностью рабочая
  // реализация формата, без сторонних библиотек.
  function buildZipBlob(files){
    var encoder = new TextEncoder();
    var localParts = [], centralParts = [];
    var offset = 0;

    files.forEach(function(f){
      var nameBytes = encoder.encode(f.name);
      var data = f.content;
      var crc = crc32Bytes(data);
      var size = data.length;
      var dosDate = 0x21, dosTime = 0;

      var lh = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0, true);
      ldv.setUint16(8, 0, true);
      ldv.setUint16(10, dosTime, true);
      ldv.setUint16(12, dosDate, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      localParts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, dosTime, true);
      cdv.setUint16(14, dosDate, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralParts.push(ch);

      offset += lh.length + data.length;
    });

    var centralSize = centralParts.reduce(function(a,p){ return a+p.length; }, 0);
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);
    edv.setUint16(20, 0, true);

    return new Blob(localParts.concat(centralParts, [eocd]), {type:"application/zip"});
  }

  function exportSectionHtml(){
    return '<div class="modal-section">' +
      '<button class="modal-btn" id="mExportData">Экспортировать личные данные</button>' +
      '<p class="modal-note">Скачает ZIP-архив со всеми вашими данными (прогресс чтения, настроение, достижение целей).</p>' +
      '</div>';
  }
  function bindExportButton(){
    var btn = document.getElementById("mExportData");
    if(!btn) return;
    btn.addEventListener("click", function(){
      try{
        var data = buildExportData();
        var encoder = new TextEncoder();
        var jsonBytes = encoder.encode(JSON.stringify(data, null, 2));
        var readmeBytes = encoder.encode(
          "Экспорт личных данных из «Графика чтения Библии»\n" +
          "Файл data.json содержит все данные в структурированном виде:\n" +
          "- dailyReadingLog: по дням, какие главы Библии были прочитаны\n" +
          "- hourCounter.dailyHoursLog: по дням, сколько времени внесено (текущий период)\n" +
          "- hourCounter.closedMonthSegments: итоги уже закрытых месяцев (суммарно)\n" +
          "- hourCounter.dailyNotesLog: по дням, комментарии к дополнительному счётчику\n" +
          "- moodCounter.dailyMoodLog: по дням, какое настроение отмечалось\n" +
          "- goalCompletions.dailyLog: по дням, какие задачи личных целей были отмечены выполненными (название цели и текст задачи) — эти записи сохраняются, даже если сама цель потом была удалена или галочка снята\n" +
          "- rawState: технический снимок для восстановления через кнопку «Импортировать личные данные» в самом приложении (прогресс-бары, ячейки по датам и всё остальное восстанавливаются именно из него)\n" +
          "Этот файл можно отдать нейросети для анализа корреляций между чтением, отмеченным временем и настроением.\n"
        );
        var blob = buildZipBlob([
          {name:"data.json", content:jsonBytes},
          {name:"README.txt", content:readmeBytes}
        ]);
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "bible-tracker-export-" + isoDate(Date.now()) + ".zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      }catch(e){
        console.error("Ошибка экспорта:", e);
        alert("Не удалось собрать архив с данными. Попробуйте ещё раз.");
      }
    });
  }

  // ===================== ИМПОРТ ЛИЧНЫХ ДАННЫХ =====================
  // Читает файл, экспортированный кнопкой "Экспортировать личные данные"
  // (сам ZIP-архив или извлечённый из него data.json), и полностью
  // заменяет данные на этом устройстве содержимым rawState.data.
  // Импорт всегда заменяет, а не объединяет локальные данные — по тем же
  // причинам, по которым подключение по коду синхронизации тоже больше не
  // выполняет объединение (см. joinWithCode): слепое объединение по
  // временным меткам может оставить "победителем" случайные/тестовые
  // отметки вместо настоящих данных.

  // Достаёт текстовое содержимое файла data.json из ZIP-архива.
  // Поддерживает и несжатые записи (STORED, метод 0 — как создаёт наш
  // buildZipBlob), и сжатые (DEFLATE, метод 8 — как у обычных ZIP-архиваторов),
  // читая центральный каталог архива, чтобы не зависеть от того, чем именно
  // архив был создан.
  function extractDataJsonFromZip(arrayBuffer){
    return new Promise(function(resolve, reject){
      try{
        var bytes = new Uint8Array(arrayBuffer);
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var eocdOffset = -1;
        var scanFrom = Math.max(0, bytes.length - 65557);
        for(var i = bytes.length - 22; i >= scanFrom; i--){
          if(view.getUint32(i, true) === 0x06054b50){ eocdOffset = i; break; }
        }
        if(eocdOffset === -1){ reject(new Error("not_zip")); return; }
        var entryCount = view.getUint16(eocdOffset + 10, true);
        var centralOffset = view.getUint32(eocdOffset + 16, true);
        var decoder = new TextDecoder();
        var pos = centralOffset, target = null;
        for(var e = 0; e < entryCount; e++){
          if(view.getUint32(pos, true) !== 0x02014b50) break;
          var method = view.getUint16(pos + 10, true);
          var compSize = view.getUint32(pos + 20, true);
          var nameLen = view.getUint16(pos + 28, true);
          var extraLen = view.getUint16(pos + 30, true);
          var commentLen = view.getUint16(pos + 32, true);
          var localOffset = view.getUint32(pos + 42, true);
          var name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
          if(/data\.json$/i.test(name)){ target = {method:method, compSize:compSize, localOffset:localOffset}; }
          pos += 46 + nameLen + extraLen + commentLen;
        }
        if(!target){ reject(new Error("no_data_json")); return; }
        var lNameLen = view.getUint16(target.localOffset + 26, true);
        var lExtraLen = view.getUint16(target.localOffset + 28, true);
        var dataStart = target.localOffset + 30 + lNameLen + lExtraLen;
        var compBytes = bytes.subarray(dataStart, dataStart + target.compSize);
        if(target.method === 0){
          resolve(decoder.decode(compBytes));
        } else if(target.method === 8 && typeof DecompressionStream !== "undefined"){
          var stream = new Response(compBytes).body.pipeThrough(new DecompressionStream("deflate-raw"));
          new Response(stream).text().then(resolve).catch(reject);
        } else {
          reject(new Error("unsupported_method"));
        }
      }catch(err){ reject(err); }
    });
  }

  function readImportFile(file){
    return file.arrayBuffer().then(function(buf){
      var isJson = /\.json$/i.test(file.name) || file.type === "application/json";
      if(isJson){
        return new TextDecoder().decode(buf);
      }
      return extractDataJsonFromZip(buf);
    });
  }

  function importSectionHtml(){
    return '<div class="modal-section">' +
      '<button class="modal-btn" id="mImportData">Импортировать личные данные</button>' +
      '<input type="file" id="mImportFileInput" accept=".zip,.json,application/json,application/zip" style="display:none">' +
      '<p class="modal-note">Восстановит прогресс чтения, настроение и остальные данные из файла, полученного кнопкой «Экспортировать личные данные» (можно выбрать сам ZIP-архив или файл data.json из него). Данные, которые уже есть на этом устройстве, будут заменены.</p>' +
      '</div>';
  }

  function bindImportButton(){
    var btn = document.getElementById("mImportData");
    var input = document.getElementById("mImportFileInput");
    if(!btn || !input) return;
    btn.addEventListener("click", function(){ input.click(); });
    input.addEventListener("change", function(){
      var file = input.files && input.files[0];
      input.value = "";
      if(!file) return;
      readImportFile(file).then(function(text){
        var parsed;
        try{ parsed = JSON.parse(text); }catch(e){ throw new Error("bad_json"); }
        if(!parsed || !parsed.rawState || typeof parsed.rawState.data !== "object"){
          throw new Error("no_raw_state");
        }
        renderImportConfirmScreen(parsed.rawState.data);
      }).catch(function(err){
        console.error("Ошибка импорта:", err);
        var msg = "Не удалось прочитать файл. Убедитесь, что выбран ZIP-архив или data.json, полученные экспортом из этого приложения.";
        if(err && err.message === "no_raw_state") msg = "В этом файле нет данных для восстановления (возможно, он экспортирован старой версией приложения). Экспортируйте данные заново с другого устройства.";
        modalBox.innerHTML = modalHeader("Не получилось импортировать", msg) + '<button class="modal-btn primary" id="mBack">Назад</button>';
        bindClose();
        document.getElementById("mBack").addEventListener("click", renderModalHome);
      });
    });
  }

  function renderImportConfirmScreen(importedState){
    modalBox.innerHTML = modalHeader("Внимание",
        "Все данные, которые сейчас есть на этом устройстве, будут удалены и заменены данными из этого файла. Объединение с текущими данными не выполняется — отменить действие после импорта будет нельзя.") +
      '<button class="modal-btn danger" id="mImportConfirm">Да, удалить текущие данные и импортировать</button>' +
      '<button class="modal-btn" id="mBack">Отмена</button>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", renderModalHome);
    document.getElementById("mImportConfirm").addEventListener("click", function(){
      applyImportedState(importedState);
    });
  }

  function applyImportedState(importedState){
    state = importedState;
    saveLocalState();
    setNoTransitions(true);
    rerenderAllFromState();
    setTimeout(function(){ setNoTransitions(false); }, 50);
    if(syncId){
      // Устройство отвязывается от прежнего кода синхронизации: старый код
      // остаётся привязан к прежним (потенциально некорректным/тестовым)
      // облачным данным, и его нельзя молча переиспользовать для только
      // что импортированных данных — ни отправка без объединения, ни тем
      // более обычная автосинхронизация с объединением по временным меткам
      // (см. doCloudSync) для этого не подходят. Поэтому синхронизация
      // просто отключается, а дальше пользователю сразу предлагается
      // создать новый код — уже для восстановленных данных.
      syncId = null;
      localStorage.removeItem(SYNC_ID_KEY);
    }
    refreshStatusBase();
    renderImportDoneScreen();
  }

  function renderImportDoneScreen(){
    modalBox.innerHTML = modalHeader("Данные восстановлены",
        "Прогресс на этом устройстве обновлён. Синхронизация с прежним кодом отключена — при желании создайте новый код для этих данных.") +
      '<button class="modal-btn primary" id="mImportCreateCode">Создать новый код синхронизации</button>' +
      '<button class="modal-btn" id="mDone">Закрыть без синхронизации</button>';
    bindClose();
    document.getElementById("mImportCreateCode").addEventListener("click", handleCreateCode);
    document.getElementById("mDone").addEventListener("click", closeModal);
  }

  function renderModalHome(){
    stopCamera();
    if(!syncId){
      modalBox.innerHTML = modalHeader("Синхронизация между устройствами",
        "Читаете с нескольких устройств? Подключите их между собой, и прогресс будет совпадать на всех.") +
        '<button class="modal-btn primary" id="mCreate">Это первое устройство — создать код</button>' +
        '<button class="modal-btn" id="mJoin">У меня уже есть код с другого устройства</button>' +
        exportSectionHtml() +
        importSectionHtml();
      bindClose();
      document.getElementById("mCreate").addEventListener("click", handleCreateCode);
      document.getElementById("mJoin").addEventListener("click", renderJoinScreen);
      bindExportButton();
      bindImportButton();
    } else {
      modalBox.innerHTML = modalHeader("Устройство подключено",
        "Прогресс синхронизируется с другими вашими устройствами.") +
        '<div id="mOwnQrHolder"></div>' +
        '<div class="modal-note" id="mSyncNote" style="margin-bottom:12px;"></div>' +
        '<button class="modal-btn" id="mSyncNow">Синхронизировать сейчас</button>' +
        '<div class="modal-section">' +
          '<button class="modal-btn danger" id="mDisconnect">Отключить синхронизацию на этом устройстве</button>' +
          '<p class="modal-note">Это не удалит облачную копию — просто это устройство перестанет с ней сверяться.</p>' +
        '</div>' +
        exportSectionHtml() +
        importSectionHtml();
      bindClose();
      loadQrLib().then(function(){
        showCodeAndQR("mOwnQrHolder", syncId, "Код для подключения ещё одного устройства:");
      }).catch(function(){
        document.getElementById("mOwnQrHolder").innerHTML = '<p class="modal-note error">Не удалось загрузить QR-код (нет интернета?).</p>';
      });
      document.getElementById("mSyncNow").addEventListener("click", function(){
        syncRetryCount = 0;
        clearTimeout(syncRetryTimer);
        doCloudSync();
        var note = document.getElementById("mSyncNote");
        if(note) note.textContent = "Синхронизация запущена…";
      });
      document.getElementById("mDisconnect").addEventListener("click", function(){
        if(!confirm("Отключить это устройство от синхронизации? Локальный прогресс сохранится.")) return;
        syncId = null;
        localStorage.removeItem(SYNC_ID_KEY);
        refreshStatusBase();
        renderModalHome();
      });
      bindExportButton();
      bindImportButton();
    }
  }

  function showCodeAndQR(holderId, code, label){
    var holder = document.getElementById(holderId);
    if(!holder) return;
    holder.innerHTML = '<p class="modal-note">' + label + '</p><div id="qrHolder"></div>' +
      '<div class="code-row"><input type="text" id="codeText" readonly value="' + code + '"><button id="codeCopy">Копировать</button></div>';
    try{
      new QRCode(document.getElementById("qrHolder"), {text: code, width: 200, height: 200, colorDark: "#2e2418", colorLight: "#fbf4e2"});
    }catch(e){
      document.getElementById("qrHolder").textContent = "Не удалось построить QR-код.";
    }
    document.getElementById("codeCopy").addEventListener("click", function(){
      var input = document.getElementById("codeText");
      input.select(); input.setSelectionRange(0, 99999);
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(code).catch(function(){});
      }
      try{ document.execCommand("copy"); }catch(e){}
      var btn = document.getElementById("codeCopy");
      btn.textContent = "Скопировано";
      setTimeout(function(){ btn.textContent = "Копировать"; }, 1500);
    });
  }

  function handleCreateCode(){
    modalBox.innerHTML = modalHeader("Создаём код…", "Секунду, подключаемся к облачному хранилищу.");
    bindClose();
    if(!navigator.onLine){
      modalBox.innerHTML = modalHeader("Нет подключения к интернету", "Для создания кода синхронизации нужен интернет. Подключитесь и попробуйте снова.") + '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderModalHome);
      return;
    }
    createCloudBlob(state).then(function(id){
      syncId = id;
      localStorage.setItem(SYNC_ID_KEY, id);
      refreshStatusBase();
      modalBox.innerHTML = modalHeader("Код создан", "Отсканируйте этот QR-код на другом устройстве (в этой же панели, кнопка «У меня уже есть код») — или введите код текстом.") +
        '<div id="mNewQrHolder"></div><button class="modal-btn primary" id="mDone">Готово</button>';
      bindClose();
      loadQrLib().then(function(){
        showCodeAndQR("mNewQrHolder", id, "Код синхронизации:");
      }).catch(function(){
        document.getElementById("mNewQrHolder").innerHTML = '<p class="modal-note error">Не удалось загрузить QR-код.</p>';
      });
      document.getElementById("mDone").addEventListener("click", closeModal);
    }).catch(function(err){
      console.error(err);
      modalBox.innerHTML = modalHeader("Не удалось создать код",
        "Возможно, временно недоступен облачный сервис синхронизации. Попробуйте ещё раз чуть позже — локальный прогресс при этом никуда не делся.") +
        '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderModalHome);
    });
  }

  function renderJoinScreen(){
    modalBox.innerHTML = modalHeader("Подключение по коду", "Отсканируйте QR-код с первого устройства камерой или введите код вручную.") +
      '<button class="modal-btn primary" id="mScan">Сканировать QR-код</button>' +
      '<button class="modal-btn" id="mManual">Ввести код вручную</button>' +
      '<button class="modal-btn" id="mBack">Назад</button>';
    bindClose();
    document.getElementById("mScan").addEventListener("click", renderScanScreen);
    document.getElementById("mManual").addEventListener("click", renderManualScreen);
    document.getElementById("mBack").addEventListener("click", renderModalHome);
  }

  function renderManualScreen(){
    modalBox.innerHTML = modalHeader("Ввод кода вручную", "Введите код синхронизации с первого устройства.") +
      '<div class="code-row"><input type="text" id="manualCodeInput" placeholder="код синхронизации"></div>' +
      '<button class="modal-btn primary" id="mSubmit">Подключить</button>' +
      '<button class="modal-btn" id="mBack">Назад</button>' +
      '<div class="modal-note" id="mJoinNote"></div>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", renderJoinScreen);
    document.getElementById("mSubmit").addEventListener("click", function(){
      var val = document.getElementById("manualCodeInput").value.trim();
      if(val) confirmJoinWithCode(val);
    });
  }

  function renderScanScreen(){
    modalBox.innerHTML = modalHeader("Сканирование QR-кода", "Наведите камеру на QR-код с первого устройства.") +
      '<div class="scan-video-wrap"><video id="scanVideo" playsinline autoplay muted></video><div class="scan-frame"></div></div>' +
      '<canvas id="scanCanvas" style="display:none;"></canvas>' +
      '<button class="modal-btn" id="mManualFallback">Ввести код вручную вместо этого</button>' +
      '<button class="modal-btn" id="mBack">Назад</button>' +
      '<div class="modal-note" id="mScanNote"></div>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", function(){ stopCamera(); renderJoinScreen(); });
    document.getElementById("mManualFallback").addEventListener("click", function(){ stopCamera(); renderManualScreen(); });

    var video = document.getElementById("scanVideo");
    var canvas = document.getElementById("scanCanvas");
    var note = document.getElementById("mScanNote");

    loadJsqrLib().then(function(){
      if(typeof jsQR !== "function"){
        note.className = "modal-note error";
        note.textContent = "Не удалось загрузить модуль сканирования. Введите код вручную.";
        return;
      }
      navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
        .then(function(stream){
          activeStream = stream;
          video.srcObject = stream;
          video.play();
          scanRAF = requestAnimationFrame(tick);
        }).catch(function(err){
          console.error(err);
          note.className = "modal-note error";
          note.textContent = "Не удалось получить доступ к камере. Введите код вручную.";
        });

      function tick(){
        if(video.readyState === video.HAVE_ENOUGH_DATA){
          // уменьшаем разрешение для скорости
          var w = 320, h = 240;
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, w, h);
          var imageData = ctx.getImageData(0, 0, w, h);
          var result = jsQR(imageData.data, imageData.width, imageData.height, {inversionAttempts:"dontInvert"});
          if(result && result.data){
            stopCamera();
            note.className = "modal-note success";
            note.textContent = "Код распознан!";
            confirmJoinWithCode(result.data);
            return;
          }
        }
        scanRAF = requestAnimationFrame(tick);
      }
    }).catch(function(){
      note.className = "modal-note error";
      note.textContent = "Не удалось загрузить сканер (нет интернета?). Введите код вручную.";
    });
  }

  function confirmJoinWithCode(id){
    id = (id||"").trim();
    if(!id) return;
    modalBox.innerHTML = modalHeader("Внимание",
        "Все данные, которые сейчас есть на этом устройстве, будут удалены и заменены данными из облака по этому коду. Совмещение (объединение) данных больше не выполняется — отменить это действие после подключения будет нельзя.") +
      '<button class="modal-btn danger" id="mJoinConfirm">Да, удалить данные на этом устройстве и подключиться</button>' +
      '<button class="modal-btn" id="mBack">Отмена</button>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", renderJoinScreen);
    document.getElementById("mJoinConfirm").addEventListener("click", function(){ joinWithCode(id); });
  }

  function joinWithCode(id){
    id = (id||"").trim();
    if(!id) return;
    modalBox.innerHTML = modalHeader("Подключаемся…", "Загружаем данные из облака.");
    bindClose();
    if(!navigator.onLine){
      modalBox.innerHTML = modalHeader("Нет подключения к интернету", "Для подключения нужен интернет. Подключитесь и попробуйте снова.") + '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderJoinScreen);
      return;
    }
    fetchCloudBlob(id).then(function(cloudData){
      // Полная замена локальных данных облачными — без объединения (merge).
      // Раньше здесь вызывался mergeStates(state, cloudData), который сравнивал
      // временные метки по каждому ключу и мог оставить "победителем" случайные
      // тестовые отметки с этого устройства, если их время оказывалось свежее
      // настоящих данных в облаке. После этого испорченное объединение сразу
      // же уходило обратно в облако и ломало прогресс на других устройствах.
      // Теперь подключение по коду просто берёт состояние из облака как есть,
      // а пользователь заранее предупреждён (см. confirmJoinWithCode), что
      // локальные данные будут стёрты.
      var incoming = cloudData || {};
      state = incoming;
      syncId = id;
      localStorage.setItem(SYNC_ID_KEY, id);
      saveLocalState();
      setNoTransitions(true);
      rerenderAllFromState();
      setTimeout(function(){ setNoTransitions(false); }, 50);
      return putCloudBlob(id, incoming);
    }).then(function(){
      refreshStatusBase();
      setSyncState("synced");
      renderSyncRetentionNotice();
    }).catch(function(err){
      console.error(err);
      var msg = "Не удалось подключиться. Проверьте код и подключение к интернету.";
      if(String(err.message||"").indexOf("not_found") !== -1) msg = "Код не найден. Проверьте, что он введён без ошибок.";
      if(String(err.message||"").indexOf("expired") !== -1) msg = "Этот код больше не действует: данные на сервере были удалены, так как ими не пользовались больше года. Если актуальный прогресс есть на другом устройстве, создайте на нём новый код.";
      modalBox.innerHTML = modalHeader("Не получилось подключиться", msg) + '<button class="modal-btn primary" id="mBack">Назад</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", renderJoinScreen);
    });
  }

  // Показывается сразу после успешного подключения по коду — предупреждает,
  // что облачная копия не хранится вечно: если этим кодом никто не будет
  // пользоваться (ни разу не синхронизироваться) больше года, данные с
  // сервера удаляются.
  function renderSyncRetentionNotice(){
    modalBox.innerHTML = modalHeader("Устройство подключено", "Данные загружены из облака.") +
      '<p class="modal-note">Синхронизируемые данные будут удалены с сервера, если ими никто не пользуется более 365 дней.</p>' +
      '<button class="modal-btn primary" id="mDone">Ок</button>';
    bindClose();
    document.getElementById("mDone").addEventListener("click", closeModal);
  }

  // ===================== SERVICE WORKER И УВЕДОМЛЕНИЕ ОБ ОБНОВЛЕНИИ =====================
  var pendingUpdateVersion = null, pendingRegistration = null;

  function showUpdateBanner(version){
    try{ if(localStorage.getItem(UPDATES_DISABLED_KEY) === "1") return; }catch(e){}
    if(version && localStorage.getItem(UPDATE_DISMISSED_KEY) === version) return;
    pendingUpdateVersion = version || null;
    var wrap = document.getElementById("updateWrap");
    if(wrap) wrap.classList.add("visible");
  }
  function hideUpdateBanner(){
    var wrap = document.getElementById("updateWrap");
    if(wrap) wrap.classList.remove("visible");
  }
  // если после нажатия "Не сейчас" прошли сутки — прячем баннер и больше
  // не напоминаем про эту конкретную версию (до выхода следующей)
  function checkUpdateSnoozeExpiry(){
    var raw;
    try{ raw = localStorage.getItem(UPDATE_SNOOZE_KEY); }catch(e){ return; }
    if(!raw) return;
    var rec;
    try{ rec = JSON.parse(raw); }catch(e){ return; }
    if(rec && rec.version && Date.now() >= rec.until){
      try{ localStorage.setItem(UPDATE_DISMISSED_KEY, rec.version); }catch(e){}
      try{ localStorage.removeItem(UPDATE_SNOOZE_KEY); }catch(e){}
      hideUpdateBanner();
    }
  }
  function openUpdateModal(){
    var overlay = document.getElementById("modalOverlay"), box = document.getElementById("modalBox");
    if(!overlay || !box) return;
    function closeThis(){ overlay.classList.remove("open"); box.innerHTML = ""; }
    box.innerHTML = modalHeader("Доступна новая версия", "Скачать новую версию этой страницы? Ваш прогресс чтения сохранится.") +
      '<button class="modal-btn primary" id="mUpdYes">Да, обновить</button>' +
      '<button class="modal-btn" id="mUpdNo">Не сейчас</button>' +
      '<button class="modal-btn" id="mUpdNever">Больше не показывать это уведомление</button>';
    var closeBtn = document.getElementById("mClose");
    if(closeBtn) closeBtn.addEventListener("click", closeThis);
    overlay.classList.add("open");
    document.getElementById("mUpdYes").addEventListener("click", function(){
      if(pendingRegistration && pendingRegistration.waiting){
        pendingRegistration.waiting.postMessage("SKIP_WAITING");
      } else { window.location.reload(); }
      closeThis();
    });
    document.getElementById("mUpdNo").addEventListener("click", function(){
      if(pendingUpdateVersion){
        try{
          localStorage.setItem(UPDATE_SNOOZE_KEY, JSON.stringify({
            version: pendingUpdateVersion,
            until: Date.now() + SNOOZE_DURATION_MS
          }));
        }catch(e){}
      }
      // баннер намеренно НЕ скрываем — по договорённости он остаётся
      // виден ещё сутки, а затем прячется сам (см. checkUpdateSnoozeExpiry)
      closeThis();
    });
    document.getElementById("mUpdNever").addEventListener("click", function(){
      try{ localStorage.setItem(UPDATES_DISABLED_KEY, "1"); }catch(e){}
      hideUpdateBanner(); closeThis();
    });
  }

  var updateBar = document.getElementById("updateBar");
  if(updateBar) updateBar.addEventListener("click", openUpdateModal);

  // строка "обновить сейчас" в подвале — работает независимо от того,
  // отключены ли всплывающие уведомления (см. UPDATES_DISABLED_KEY):
  // человек всегда может проверить и обновиться вручную здесь
  function renderManualUpdateOption(){
    var row = document.getElementById("versionUpdateRow");
    if(!row) return;
    if(pendingRegistration && pendingRegistration.waiting){
      var label = pendingUpdateVersion ? ("Обновить до v" + pendingUpdateVersion) : "Доступно обновление — обновить";
      row.innerHTML = '<button class="version-history-update-item" id="versionUpdateBtn">' + label + '</button>';
      var btn = document.getElementById("versionUpdateBtn");
      if(btn){
        btn.addEventListener("click", function(){
          if(pendingRegistration && pendingRegistration.waiting){
            pendingRegistration.waiting.postMessage("SKIP_WAITING");
          } else {
            window.location.reload();
          }
        });
      }
    } else {
      row.innerHTML = "";
    }
  }

  // версия в подвале подтягивается напрямую из sw.js через служебный
  // запрос по MessageChannel — значит, менять её нужно только в одном
  // месте (APP_VERSION в sw.js), а не отдельно ещё и в разметке
  function applyVersionToFooter(version){
    if(!version) return;
    var el = document.getElementById("appVersionText");
    if(el) el.textContent = "v" + String(version).replace(/^v/i, "");
  }

  function requestVersionFromSW(){
    if(!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    try{
      var channel = new MessageChannel();
      channel.port1.onmessage = function(event){
        if(event.data && event.data.type === "VERSION"){
          applyVersionToFooter(event.data.version);
        }
      };
      navigator.serviceWorker.controller.postMessage({type:"GET_VERSION"}, [channel.port2]);
    }catch(e){}
  }

  if("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")){
    navigator.serviceWorker.addEventListener("message", function(event){
      if(event.data && event.data.type === "SW_VERSION") pendingUpdateVersion = event.data.version;
    });
    var reloadedAfterUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", function(){
      requestVersionFromSW();
      if(reloadedAfterUpdate) return;
      reloadedAfterUpdate = true;
      window.location.reload();
    });
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("./sw.js").then(function(reg){
        pendingRegistration = reg;
        requestVersionFromSW();
        if(reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(pendingUpdateVersion);
        renderManualUpdateOption();
        reg.addEventListener("updatefound", function(){
          var newWorker = reg.installing;
          if(!newWorker) return;
          newWorker.addEventListener("statechange", function(){
            if(newWorker.state === "installed" && navigator.serviceWorker.controller){
              showUpdateBanner(pendingUpdateVersion);
              renderManualUpdateOption();
            }
          });
        });
      }).catch(function(err){ console.error("Не удалось зарегистрировать service worker:", err); });
    });
  }

  // ===================== АРХИВ ПРЕДЫДУЩИХ ВЕРСИЙ =====================
  // Список берётся автоматически из ./versions/versions.json — этот файл
  // ведёт GitHub Action при публикации релиза (тега) в репозитории, вручную
  // ничего копировать и редактировать в коде больше не нужно.
  function renderVersionHistory(){
    var itemsHolder = document.getElementById("versionHistoryItems");
    if(!itemsHolder) return;
    fetch("./versions/versions.json")
      .then(function(res){
        if(!res.ok) throw new Error("no versions.json");
        return res.json();
      })
      .then(function(data){
        var items = (data && data.versions) ? data.versions.slice(0, 5) : [];
        renderVersionItems(items);
      })
      .catch(function(){
        renderVersionItems([]);
      });
  }

  function renderVersionItems(items){
    var itemsHolder = document.getElementById("versionHistoryItems");
    if(!itemsHolder) return;
    itemsHolder.innerHTML = "";
    if(!items.length){
      var empty = document.createElement("div");
      empty.className = "version-history-empty";
      empty.textContent = "Архив версий пока пуст";
      itemsHolder.appendChild(empty);
      return;
    }
    items.forEach(function(item){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "version-history-item";
      btn.textContent = "v" + item.version + (item.date ? " — " + item.date : "");
      var url = "./versions/v" + item.version + "/index.html";
      btn.addEventListener("click", function(){
        selectedVersionUrl = url;
        Array.prototype.forEach.call(itemsHolder.querySelectorAll(".version-history-item"), function(b){
          b.classList.remove("selected");
        });
        btn.classList.add("selected");
        var returnBtn = document.getElementById("mVersionReturnBtn");
        if(returnBtn) returnBtn.style.display = "block";
      });
      itemsHolder.appendChild(btn);
    });
  }

  var selectedVersionUrl = null;

  // содержимое "Версий" открывается кнопкой из вкладки настроек (шестерёнка,
  // см. renderSettingsTabGear), а не отдельным язычком — рисуется прямо в
  // #settingsTabContent, как и у остальных вкладок
  function renderSettingsTabVersions(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    selectedVersionUrl = null;
    container.innerHTML =
      '<div class="settings-content-bottom">' +
      '<div class="year-grid-tab-title" style="margin-bottom:12px;">Версии</div>' +
      '<div id="versionUpdateRow"></div>' +
      '<div id="versionHistoryItems"></div>' +
      '<button class="modal-btn primary" id="mVersionReturnBtn" style="display:none;margin-top:12px;">Вернуться на выбранную версию</button>' +
      '</div>';
    renderManualUpdateOption();
    renderVersionHistory();
    var returnBtn = document.getElementById("mVersionReturnBtn");
    if(returnBtn){
      returnBtn.addEventListener("click", function(){
        if(selectedVersionUrl) window.location.href = selectedVersionUrl;
      });
    }
  }

  // общий обработчик для всех 9 вкладок задач (red/inbox/next/projects/
  // waiting/council/read/someday/archive)
  function renderSettingsTabTask(taskKey){
    if(taskKey === "archive") renderTaskArchiveTab();
    else renderTaskTabList(taskKey);
  }

  // ---------- модалка настроек (шестерёнка) с вкладками ----------
  var settingsModalOverlay = document.getElementById("settingsModalOverlay");
  var settingsModalBox = document.getElementById("settingsModalBox");
  var settingsModalFrame = settingsModalBox ? settingsModalBox.parentElement : null; // .settings-modal-frame

  // ===== Волна открытия/закрытия окна настроек (доп. анимации) =====
  // Разворачивается ТОЛЬКО рамка окна (.settings-modal-frame — она же
  // содержит и сам блок настроек, и вертикальный стек вкладок, и
  // горизонтальный ряд, см. index.html), а не весь экран. Тёмная
  // подложка (.settings-modal-overlay) в волне не участвует —
  // она просто плавно проявляется через opacity за то же время
  // (см. animateSettingsWave), отдельно от геометрии волны.
  //
  // Клип применяется к рамке, но у самой рамки координатная система
  // 0%..100% — это её СОБСТВЕННЫЙ бокс, а оба ряда вкладок торчат за его
  // пределы (#settingsTabs — правее, через right:-54px; .settings-tabs-gear
  // — ниже, через bottom:-54px, см. modals.css). Проценты 0..100 этот
  // "хвост" не покрывают в принципе, поэтому раньше вкладки не участвовали
  // в волне и появлялись рывком лишь в момент, когда клип снимался
  // целиком (t=1, clip-path:none). Чтобы вкладки тоже разворачивались
  // вместе с окном — считаем клип не в процентах, а в пикселях (px —
  // валидная единица для clip-path: polygon(), отсчитывается от левого
  // верхнего угла рамки и не ограничена её собственными width/height), и
  // границы прямоугольника, который нужно раскрыть, берём не от самой
  // рамки, а от РЕАЛЬНО измеренных прямоугольников #settingsTabs и
  // .settings-tabs-gear (см. updateSettingsWaveGeometry).
  //
  // Форма волны — та же, что и была изначально: растущий из угла
  // диагональный треугольник (t<=0.5), который затем дотягивается до
  // противоположного угла пятиугольником (t>0.5), пока не закроет всю
  // область целиком (см. settingsWavePolygonAt). Опорный угол — не сам
  // getBoundingClientRect() кнопки (её высота считается по другой
  // переменной, чем высота нижнего ряда вкладок, — из-за этого несовпадения
  // при попытке стартовать ровно от угла кнопки прямоугольник расползался
  // неравномерно по осям и "выпрыгивал"), а именно правый нижний угол
  // ОБЩЕЙ области (окно + оба ряда вкладок) — кнопка и так стоит вплотную
  // к этому углу, визуально неотличимо.
  var settingsWaveRAF = null;
  var SETTINGS_WAVE_DURATION = 400; // мс, см. обсуждение с пользователем
  // Геометрия волны в px, в координатах рамки (0,0 — её левый верхний
  // угол); пересчитывается в updateSettingsWaveGeometry перед каждым
  // запуском волны. minX/minY/maxX/maxY — прямоугольник, который нужно
  // открыть целиком: объединение рамки окна и обоих рядов вкладок; волна
  // стартует из его правого нижнего угла (maxX,maxY).
  var settingsWaveGeom = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // Пересчитывает settingsWaveGeom от текущего размера рамки окна
  // настроек и обоих рядов вкладок (#settingsTabs, #settingsTabsGear).
  // Вызывается заново перед каждым запуском волны (а не один раз при
  // layoutSettingsModal), т.к. размеры могут поменяться между открытиями
  // (ресайз, поворот экрана, включена/выключена галочка "Показать все
  // мои задачи"). Ряд, у которого сейчас нет ни одной видимой вкладки
  // (нулевой width/height), не расширяет границы — это ожидаемо,
  // разворачивать нечего.
  function updateSettingsWaveGeometry(){
    var empty = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    if(!settingsModalFrame){ settingsWaveGeom = empty; return; }
    var frameRect = settingsModalFrame.getBoundingClientRect();
    if(!frameRect.width || !frameRect.height){ settingsWaveGeom = empty; return; }

    var minX = 0, minY = 0, maxX = frameRect.width, maxY = frameRect.height;
    [document.getElementById("settingsTabs"), document.getElementById("settingsTabsGear")].forEach(function(el){
      if(!el) return;
      var r = el.getBoundingClientRect();
      if(r.width <= 0 || r.height <= 0) return;
      minX = Math.min(minX, r.left - frameRect.left);
      minY = Math.min(minY, r.top - frameRect.top);
      maxX = Math.max(maxX, r.right - frameRect.left);
      maxY = Math.max(maxY, r.bottom - frameRect.top);
    });

    settingsWaveGeom = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // t: 0 (совсем свёрнуто, в точку у угла (maxX,maxY) — там же стоит
  // кнопка) .. 1 (открыто полностью — окно и оба ряда вкладок). Первая
  // половина (t<=0.5) — растущий треугольник от угла (maxX,maxY) до
  // половины области (по главной диагонали). Вторая половина (t>0.5) —
  // тот же треугольник дотягивается до противоположного угла
  // (minX,minY), пятиугольником, пока не закроет всю область целиком.
  // Число вершин специально разное в двух половинах — поэтому считается
  // через JS/rAF, а не через CSS-transition (тот не умеет плавно менять
  // число точек полигона).
  function settingsWavePolygonAt(t){
    var g = settingsWaveGeom;
    if(t <= 0) return "polygon(" + g.maxX + "px " + g.maxY + "px, " + g.maxX + "px " + g.maxY + "px, " + g.maxX + "px " + g.maxY + "px)";
    if(t >= 1) return "none";
    if(t <= 0.5){
      var s = t * 2; // 0..1
      var by = g.maxY - (g.maxY - g.minY) * s;
      var cx = g.maxX - (g.maxX - g.minX) * s;
      return "polygon(" + g.maxX + "px " + g.maxY + "px, " + g.maxX + "px " + by + "px, " + cx + "px " + g.maxY + "px)";
    }
    var q = (t - 0.5) * 2; // 0..1
    var topX = g.maxX - (g.maxX - g.minX) * q;
    var leftY = g.maxY - (g.maxY - g.minY) * q;
    return "polygon(" + g.maxX + "px " + g.maxY + "px, " + g.maxX + "px " + g.minY + "px, " + topX + "px " + g.minY + "px, " + g.minX + "px " + leftY + "px, " + g.minX + "px " + g.maxY + "px)";
  }

  function setSettingsWaveClip(t){
    if(!settingsModalFrame) return;
    var poly = settingsWavePolygonAt(t);
    settingsModalFrame.style.clipPath = poly;
    settingsModalFrame.style.webkitClipPath = poly;
  }

  // opening=true — волна открытия: рамка разворачивается t=0->1, а
  // тёмная подложка одновременно проявляется opacity 0->1. opening=
  // false — обратная волна: рамка схлопывается t=1->0 (честно до
  // полного нуля, чтобы гарантированно стянуться в точку у кнопки и
  // исчезнуть), подложка одновременно гаснет opacity 1->0.
  function animateSettingsWave(opening, onDone){
    if(settingsWaveRAF){ cancelAnimationFrame(settingsWaveRAF); settingsWaveRAF = null; }
    updateSettingsWaveGeometry();
    var start = null;
    function frame(now){
      if(start === null) start = now;
      var p = Math.min(1, (now - start) / SETTINGS_WAVE_DURATION);
      var t = opening ? p : (1 - p);
      setSettingsWaveClip(t);
      settingsModalOverlay.style.opacity = String(t);
      if(p < 1){
        settingsWaveRAF = requestAnimationFrame(frame);
      } else {
        settingsWaveRAF = null;
        if(onDone) onDone();
      }
    }
    settingsWaveRAF = requestAnimationFrame(frame);
  }

  function openSettingsModal(){
    refreshSettingsTabsVisibility();
    settingsModalBox.style.height = "";
    settingsModalBox.style.marginTop = "";
    var gearBtn = document.getElementById("settingsGearBtn");
    if(gearBtn) gearBtn.classList.add("is-open");
    switchSettingsTab(getShowAllTasksEnabled() ? "red" : "gear");
    var extraAnim = getExtraAnimationsEnabled();
    if(extraAnim){
      // Геометрию волны (updateSettingsWaveGeometry) нельзя мерить прямо
      // сейчас: высоту/отступ окна (settingsModalBox.style.height/
      // marginTop) мы только что сбросили в "", а актуальные значения
      // выставляет layoutSettingsModal — и она запускается позже, тем же
      // requestAnimationFrame ниже. Раньше геометрия волны считалась в
      // процентах ("%"), а проценты в clip-path браузер пересчитывает
      // сам при каждой перерисовке — поэтому можно было не думать о
      // порядке. Теперь координаты в px (см. комментарий у
      // settingsWavePolygonAt) — они статичны, снятый слишком рано (по
      // ещё не актуальной рамке) размер так и останется неверным до
      // конца анимации. Поэтому старт волны (updateSettingsWaveGeometry
      // + setSettingsWaveClip(0) + сам rAF-цикл) переносим ВНУТРЬ того
      // же requestAnimationFrame, СРАЗУ ПОСЛЕ layoutSettingsModal — оверлей
      // при этом уже открыт, но невидим (opacity:0), так что один лишний
      // кадр со старой геометрией зрителю не виден.
      settingsModalOverlay.style.opacity = "0";
      settingsModalOverlay.classList.add("open");
      requestAnimationFrame(function(){
        layoutSettingsModal();
        updateSettingsWaveGeometry();
        setSettingsWaveClip(0);
        animateSettingsWave(true);
      });
    } else {
      requestAnimationFrame(layoutSettingsModal);
      if(settingsModalFrame){
        settingsModalFrame.style.clipPath = "";
        settingsModalFrame.style.webkitClipPath = "";
      }
      settingsModalOverlay.style.opacity = "";
      settingsModalOverlay.classList.add("open");
    }
  }
  // Плавающая кнопка-язычок (.settings-fab, id=settingsGearBtn) стоит на
  // ФИКСИРОВАННОЙ высоте — 25% экрана от его нижнего края (fabTop = 75%
  // высоты окна браузера). Окно настроек привязано к НЕЙ, а не к верху
  // экрана: нижний край окна всегда на fabTop, а высота отсчитывается от
  // кнопки вверх фиксированным числом пикселей (см. WINDOW_H ниже) — то
  // есть меняется положение верхнего края окна (через margin-top), а не
  // сама точка, где сидит кнопка. Кнопка при этом по-прежнему "приклеена"
  // к правому нижнему углу рамки (.settings-modal-frame) по горизонтали —
  // это не менялось. Работает и когда модалка закрыта: оверлей больше не
  // display:none (см. .settings-modal-overlay в modals.css), а скрыт
  // через opacity/visibility — рамка при этом всё равно реально
  // отрисована и её координаты можно измерить через getBoundingClientRect.
  // Вызывается при открытии окна, при загрузке страницы и при ресайзе
  // (см. вызовы ниже), чтобы кнопка всегда стояла в нужном месте, даже
  // если окно ни разу не открывали.
  function layoutSettingsModal(){
    if(!settingsModalBox) return;
    var frame = settingsModalBox.parentElement;
    if(!frame) return;

    // Вкладка "настройки" должна быть хоть раз отрисована — на случай,
    // если окно ещё ни разу не открывали (иначе #settingsTabContent
    // пустой, но на итоговую высоту это больше не влияет).
    var content = document.getElementById("settingsTabContent");
    if(content && !content.innerHTML.trim()) renderSettingsTabGear();

    // Окно "пришито" снизу к кнопке-язычку (.settings-fab), а не сверху к
    // экрану: нижний край окна всегда стоит на фиксированной точке —
    // 25% экрана от его нижнего края (fabTop = 75% высоты окна браузера),
    // а высота отсчитывается от НЕЁ вверх — фиксированные 658px (WINDOW_H
    // ниже), а не вниз от верхнего края экрана. Поэтому у окна больше нет
    // "родного" верха: он вычисляется как fabTop − высота и выставляется
    // через margin-top (естественное положение по CSS — 16px от верха
    // оверлея, см. padding-top). Если 658px не помещается (см. minTop —
    // не даём окну вылезти выше 16px от верха экрана), высота ужимается,
    // но низ окна (а с ним и кнопка) всё равно остаётся ровно на fabTop —
    // окно никогда не отрывается от кнопки, просто может быть короче
    // 658px на маленьких экранах.
    settingsModalBox.style.height = "";
    settingsModalBox.style.marginTop = "";
    var naturalTop = settingsModalBox.getBoundingClientRect().top; // 16px по CSS
    var fabTop = window.innerHeight * 0.75;
    var WINDOW_H = 658; // высота окна настроек, отсчитанная от кнопки вверх
    var minTop = naturalTop; // не даём окну вылезти выше верхнего края оверлея
    var desiredTop = fabTop - WINDOW_H;
    if(desiredTop < minTop) desiredTop = minTop;
    var desired = fabTop - desiredTop;

    settingsModalBox.style.marginTop = (desiredTop - naturalTop) + "px";
    settingsModalBox.style.height = desired + "px";
    // Размер (толщина) каждого язычка вертикального стека — единая
    // переменная --settings-tab-size на .settings-modal-frame (её читают
    // #settingsTabs .settings-tab). Считаем её здесь: высота окна настроек
    // (desired, только что зафиксирована выше), минус промежутки между 9
    // язычками стопки (9 вкладок задач: red/inbox/next/projects/waiting/
    // council/read/someday/archive — считаем все 9, а не только сейчас
    // видимые), по 1px gap между соседними — это 8 промежутков, — и делим
    // остаток на 9. Так каждый язычок получает фиксированный размер,
    // который не меняется от того, сколько из 9 сейчас реально показано.
    var totalTabs = 9;
    var gapsPx = (totalTabs - 1) * 1;
    var tabUnit = (desired - gapsPx) / totalTabs;
    if(tabUnit > 0) frame.style.setProperty("--settings-tab-size", tabUnit + "px");

    // Ширина вкладок горизонтального ряда под окном (шестерёнка + карта
    // дней года + 3 заглушки, см. .settings-tabs-gear в modals.css) —
    // отдельная переменная --settings-tab-size-h, т.к. этот ряд зависит от
    // ШИРИНЫ окна настроек, а не от высоты. Сейчас в ряд помещается ровно
    // 5 вкладок, поэтому делим ширину окна на 5 (и 4 промежутка по 1px
    // между ними, как и в вертикальном стеке).
    var totalHTabs = 5;
    var gapsHPx = (totalHTabs - 1) * 1;
    var boxWidth = settingsModalBox.getBoundingClientRect().width;
    // Резервируем ещё 1px в конце ряда — там, где ряд стыкуется с
    // кнопкой-язычком, чтобы получившийся зазор оказался ровно под
    // вертикальным лавандовым швом (правым краем окна), а не правее него.
    var tabHUnit = (boxWidth - gapsHPx - 1) / totalHTabs;
    if(tabHUnit > 0) frame.style.setProperty("--settings-tab-size-h", tabHUnit + "px");

    // Кнопка-язычок теперь полноразмерная: её толщина (width) — те же
    // 54px, что и у обычных вертикальных язычков, а длина (height) — те
    // же 54px, что и толщина (height) язычков нижнего ряда (см.
    // .settings-tab-gear в modals.css) — так кнопка визуально продолжает
    // именно нижний ряд, а не торчит выше его. Раньше здесь бралось
    // значение --settings-tab-size-h (длина/ширина язычков нижнего ряда,
    // а не их толщина) — из-за этого кнопка получалась заметно выше
    // самого ряда. Стоит вплотную к углу рамки (без зазора) — сам зазор
    // уже учтён в ширине ряда выше.
    var settingsGearBtn = document.getElementById("settingsGearBtn");
    if(settingsGearBtn){
      var frameRect = frame.getBoundingClientRect();
      settingsGearBtn.style.left = Math.round(frameRect.right) + "px";
      settingsGearBtn.style.top = Math.round(frameRect.bottom) + "px";
    }
  }
  function closeSettingsModal(){
    flushPendingYearDayNoteEdit();
    flushPendingYearCommentEdits();
    flushPendingTaskEdits();
    flushPendingCommentEdits();
    var gearBtn = document.getElementById("settingsGearBtn");
    if(gearBtn) gearBtn.classList.remove("is-open");
    if(getExtraAnimationsEnabled()){
      animateSettingsWave(false, function(){
        settingsModalOverlay.classList.remove("open");
        settingsModalOverlay.style.opacity = "";
        if(settingsModalFrame){
          settingsModalFrame.style.clipPath = "";
          settingsModalFrame.style.webkitClipPath = "";
        }
      });
    } else {
      settingsModalOverlay.classList.remove("open");
      settingsModalOverlay.style.opacity = "";
      if(settingsModalFrame){
        settingsModalFrame.style.clipPath = "";
        settingsModalFrame.style.webkitClipPath = "";
      }
    }
  }
  function refreshSettingsTabsVisibility(){
    var showTasks = getShowAllTasksEnabled();
    Object.keys(TASK_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(TASK_TAB_IDS[key]);
      if(btn) btn.style.display = showTasks ? "flex" : "none";
    });
  }
  // Окно настроек всегда одного размера (см. .settings-modal-box в
  // modals.css) — высота фиксирована и не зависит от вкладки, поэтому
  // верхний край окна не "прыгает" при переключении вкладок. Если
  // содержимое вкладки не помещается, прокручивается #settingsTabContent
  // (без видимого индикатора прокрутки, см. CSS).
  function switchSettingsTab(tab){
    // Реальное переключение вкладки внутри УЖЕ открытого окна настроек —
    // отдельный "экран" с точки зрения "назад" (см. window.AppNav выше),
    // причём независимо от того, чем вызван переход: кликом по язычку
    // вкладки, программным переключением (как при переходе по
    // [[ссылке]] из другой вкладки, см. initAutoFormatting выше) или
    // любым будущим способом — switchSettingsTab единая точка входа для
    // всех них. Самое ПЕРВОЕ переключение при открытии окна настроек
    // (settingsModalOverlay ещё без класса "open", см. openSettingsModal)
    // в стек не попадает — иначе закрытие окна требовало бы лишнего
    // "назад".
    var settingsWasOpen = typeof settingsModalOverlay !== "undefined" && settingsModalOverlay &&
      settingsModalOverlay.classList.contains("open");
    var prevTab = currentSettingsTab;
    var isRealSwitch = settingsWasOpen && prevTab !== tab && !suppressNavPush;

    currentSettingsTab = tab;
    flushPendingYearDayNoteEdit();
    flushPendingYearCommentEdits();
    flushPendingTaskEdits();
    flushPendingCommentEdits();
    flushPendingMdEditorEdit();
    // запоминаем позицию только если это реальная вкладка одного из двух
    // стеков (бокового или нижнего, набор 1 или 2) — служебные экраны вроде
    // "versions"/"import"/"resetConfirm" (открываются кнопками ВНУТРИ
    // вкладки настроек) не считаются отдельной позицией и не сбивают
    // запомненное место — см. cycleSettingsTabSet ниже.
    if(SETTINGS_SIDE_ORDER_1.indexOf(tab) !== -1 || SETTINGS_BOTTOM_ORDER_1.indexOf(tab) !== -1 ||
       SETTINGS_SIDE_ORDER_2.indexOf(tab) !== -1 || SETTINGS_BOTTOM_ORDER_2.indexOf(tab) !== -1){
      settingsLastStackTab = tab;
    }
    var gearBtn = document.getElementById("settingsTabGearBtn");
    var yearBtn = document.getElementById("settingsTabYearBtn");
    var moodTabBtn = document.getElementById("settingsTabMoodBtn");
    if(gearBtn) gearBtn.classList.toggle("active", tab === "gear");
    if(yearBtn) yearBtn.classList.toggle("active", tab === "year");
    if(moodTabBtn) moodTabBtn.classList.toggle("active", tab === "mood");
    Object.keys(TASK_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(TASK_TAB_IDS[key]);
      if(btn) btn.classList.toggle("active", tab === key);
    });
    Object.keys(EXTRA_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(EXTRA_TAB_IDS[key]);
      if(btn) btn.classList.toggle("active", tab === key);
    });
    Object.keys(SET2_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(SET2_TAB_IDS[key]);
      if(btn) btn.classList.toggle("active", tab === key);
    });
    Object.keys(SET2_EXTRA_TAB_IDS).forEach(function(key){
      var btn = document.getElementById(SET2_EXTRA_TAB_IDS[key]);
      if(btn) btn.classList.toggle("active", tab === key);
    });
    var container = document.getElementById("settingsTabContent");
    if(container) container.scrollTop = 0;
    var addFab = document.getElementById("taskAddFab");
    var isCommentsTab = (tab === "extra2" && getCustomCommentsEnabled());
    if(addFab) addFab.classList.toggle("visible", TASK_MOVABLE_TABS.indexOf(tab) !== -1 || isCommentsTab);
    if(tab === "mood"){ renderSettingsTabMood(); }
    else if(tab === "year") renderSettingsTabYear();
    else if(tab === "versions") renderSettingsTabVersions();
    else if(tab === "import") renderSettingsTabImportPicker();
    else if(tab === "resetConfirm") renderSettingsTabResetConfirm();
    else if(tab === "moodResetConfirm") renderSettingsTabMoodResetConfirm();
    else if(TASK_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabTask(tab);
    else if(EXTRA_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabExtra(tab);
    else if(tab === "set2b_1") renderSettingsTabWorkbooks();
    else if(tab === "set2b_2") renderSettingsTabS89Fill();
    else if(tab === "set2b_3") renderSettingsTabNotesMerge();
    else if(tab === "set2b_4") renderSettingsTabSubtitleExtract();
    else if(tab === "set2s_1") renderSettingsTabMdEditor();
    else if(tab === "set2s_5") renderSettingsTabEpubSplit();
    else if(tab === "set2s_6") renderSettingsTabImgResize();
    else if(SET2_TAB_IDS.hasOwnProperty(tab) || SET2_EXTRA_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabSet2Stub();
    else renderSettingsTabGear();

    if(isRealSwitch && window.AppNav){
      window.AppNav.push(function(){
        suppressNavPush = true;
        switchSettingsTab(prevTab);
        suppressNavPush = false;
      });
    }
  }

  // extra2 — вкладка "Добавить кастомный комментарий", когда включена
  // соответствующая галочка в настройках (см. renderSettingsTabGear и
  // refreshExtra2TabAppearance); иначе, как и extra3, — пока просто
  // заглушка без содержимого.
  function renderSettingsTabExtra(tabKey){
    if(tabKey === "extra2" && getCustomCommentsEnabled()){
      renderCommentsTab();
      return;
    }
    if(tabKey === "extra3"){
      renderReviewTab();
      return;
    }
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML = '<div class="mood-diagram-empty">Контент появится позже</div>';
  }

  // ===== ВТОРОЙ НАБОР ВКЛАДОК (заглушки) =====
  // Все 14 вкладок второго набора (9 боковых + 5 нижних, см. SET2_TAB_IDS/
  // SET2_EXTRA_TAB_IDS выше) пока показывают один и тот же текст — функции
  // под них появятся позже.
  function renderSettingsTabSet2Stub(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML = '<div class="mood-diagram-empty">Вкладка пока не запрограммирована.<br>Контент появится позже.</div>';
  }

  // ===== ИЗВЛЕЧЕНИЕ СУБТИТРОВ (четвёртая нижняя вкладка второго набора,
  // settingsTabSet2GearBtn4 / "set2b_4") =====
  // Первая версия гоняла файл через ffmpeg.wasm (WebAssembly-сборка
  // ffmpeg, ~30 МБ, грузится с CDN) — на практике это оказалось
  // ненадёжно: у ffmpeg.wasm есть давние открытые баги именно на
  // зависание ffmpeg.load()/ffmpeg.exec() без ошибки (см., например,
  // issues #557, #772, #815, #830 в репозитории ffmpegwasm/ffmpeg.wasm) —
  // воспроизводится независимо от корректности настройки blob-URL/
  // classWorkerURL. Поэтому подход полностью другой: дорожка субтитров
  // вынимается напрямую из контейнера mp4 (ISO BMFF) обычным JS —
  // разбором дерева "боксов" (см. parseMp4Boxes/readTx3gSubtitleTrack
  // ниже). Никакой сети, WebAssembly или воркеров — всё мгновенно и
  // работает даже при открытии файла напрямую (file://), потому что
  // содержимое видео читается локально через File.arrayBuffer(), а не
  // качается откуда-то.
  //
  // Что именно ищем: большинство mp4 со "встроенными" (soft) субтитрами
  // хранят их как отдельную текстовую дорожку с кодеком tx3g (3GPP Timed
  // Text, он же mov_text у ffmpeg) — ровно то, что получается из .srt
  // командой "ffmpeg -i in.mp4 -i in.srt -c:s mov_text out.mp4". У такой
  // дорожки mdia/hdlr.handler_type равен "text" (изредка старые
  // QuickTime-файлы используют "sbtl"/"subt") — по нему дорожка и
  // ищется. Каждый сэмпл такой дорожки — это 2-байтовая длина текста
  // (big-endian) и следом сам текст (обычно UTF-8, иногда UTF-16 с BOM);
  // именно поэтому в результате никогда и не было бы таймкодов — они не
  // хранятся внутри самих сэмплов текста, а задаются отдельно таблицей
  // тайминга (stts), которая для этой задачи нам не нужна вообще.
  //
  // Если под "субтитрами" в файле имелась в виду не текстовая дорожка, а
  // "жёстко вшитые" в картинку субтитры (просто часть видеоряда) —
  // достать их отсюда нельзя в принципе, никаким разбором контейнера: их
  // там как отдельных данных просто не существует, это происходит только
  // распознаванием текста на кадрах (OCR), что не имеет отношения к
  // разбору mp4 и требует отдельного, гораздо более тяжёлого решения.

  // ---- минимальный разбор дерева боксов ISO BMFF (mp4/mov) ----
  function parseMp4Boxes(view, start, end){
    var boxes = [];
    var offset = start;
    while(offset + 8 <= end){
      var size = view.getUint32(offset);
      var type = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7)
      );
      var headerSize = 8;
      var boxSize = size;
      if(size === 1){
        if(offset + 16 > end) break;
        var hi = view.getUint32(offset + 8);
        var lo = view.getUint32(offset + 12);
        boxSize = hi * 4294967296 + lo;
        headerSize = 16;
      } else if(size === 0){
        boxSize = end - offset;
      }
      if(boxSize < headerSize || offset + boxSize > end) break;
      boxes.push({ type: type, bodyStart: offset + headerSize, end: offset + boxSize });
      offset += boxSize;
    }
    return boxes;
  }
  function findMp4Box(boxes, type){
    for(var i = 0; i < boxes.length; i++) if(boxes[i].type === type) return boxes[i];
    return null;
  }
  function findAllMp4Boxes(boxes, type){
    return boxes.filter(function(b){ return b.type === type; });
  }
  function readMp4Stsz(view, box){
    var p = box.bodyStart;
    var sampleSize = view.getUint32(p + 4);
    var count = view.getUint32(p + 8);
    var sizes = [];
    if(sampleSize !== 0){
      for(var i = 0; i < count; i++) sizes.push(sampleSize);
    } else {
      var q = p + 12;
      for(var i = 0; i < count; i++){ sizes.push(view.getUint32(q)); q += 4; }
    }
    return sizes;
  }
  function readMp4Stsc(view, box){
    var p = box.bodyStart;
    var count = view.getUint32(p + 4);
    var entries = [];
    var q = p + 8;
    for(var i = 0; i < count; i++){
      entries.push({
        firstChunk: view.getUint32(q),
        samplesPerChunk: view.getUint32(q + 4)
      });
      q += 12;
    }
    return entries;
  }
  function readMp4Stco(view, box, is64){
    var p = box.bodyStart;
    var count = view.getUint32(p + 4);
    var offsets = [];
    var q = p + 8;
    for(var i = 0; i < count; i++){
      if(is64){
        var hi = view.getUint32(q);
        var lo = view.getUint32(q + 4);
        offsets.push(hi * 4294967296 + lo);
        q += 8;
      } else {
        offsets.push(view.getUint32(q));
        q += 4;
      }
    }
    return offsets;
  }
  // stco (позиции чанков) + stsc (сколько сэмплов в каждом чанке) + stsz
  // (размер каждого сэмпла) вместе дают позицию в файле для каждого
  // сэмпла по отдельности — стандартная схема ISO BMFF.
  function computeMp4SampleOffsets(chunkOffsets, stscEntries, sampleSizes){
    var offsets = [];
    var sampleIndex = 0;
    for(var chunkIdx = 1; chunkIdx <= chunkOffsets.length; chunkIdx++){
      var samplesPerChunk = 1;
      for(var i = 0; i < stscEntries.length; i++){
        if(stscEntries[i].firstChunk <= chunkIdx) samplesPerChunk = stscEntries[i].samplesPerChunk;
        else break;
      }
      var pos = chunkOffsets[chunkIdx - 1];
      for(var s = 0; s < samplesPerChunk && sampleIndex < sampleSizes.length; s++){
        offsets.push(pos);
        pos += sampleSizes[sampleIndex];
        sampleIndex++;
      }
    }
    return offsets;
  }
  // UTF-16BE не входит в стандартный список кодировок TextDecoder — при
  // BOM 0xFE 0xFF собираем строку вручную (посимвольно; суррогатные пары
  // при этом складываются корректно, т.к. строки JS сами по себе UTF-16).
  function decodeMp4Utf16Be(bytes){
    var chars = [];
    for(var i = 0; i + 1 < bytes.length; i += 2){
      chars.push(String.fromCharCode((bytes[i] << 8) | bytes[i + 1]));
    }
    return chars.join("");
  }
  function decodeTx3gSampleText(bytes){
    if(bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF){
      return decodeMp4Utf16Be(bytes.subarray(2));
    }
    if(bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE){
      return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  // Главная функция: находит текстовую дорожку субтитров в mp4 и
  // возвращает массив реплик (уже без каких-либо таймкодов — см.
  // комментарий в начале раздела про то, откуда в принципе не может
  // взяться таймкод внутри текста сэмпла).
  function readMp4Stts(view, box){
    var p = box.bodyStart;
    var count = view.getUint32(p + 4);
    var entries = [];
    var q = p + 8;
    for(var i = 0; i < count; i++){
      entries.push({ sampleCount: view.getUint32(q), sampleDelta: view.getUint32(q + 4) });
      q += 8;
    }
    return entries;
  }
  // stts хранит длительности не по одной на сэмпл, а группами
  // (sampleCount повторений одного и того же sampleDelta) — разворачиваем
  // в плоский массив длиной ровно totalSamples, по одному значению на
  // сэмпл (в единицах таймшкалы трека, см. readMp4MdhdTimescale).
  function expandMp4Stts(sttsEntries, totalSamples){
    var durations = [];
    for(var i = 0; i < sttsEntries.length && durations.length < totalSamples; i++){
      for(var j = 0; j < sttsEntries[i].sampleCount && durations.length < totalSamples; j++){
        durations.push(sttsEntries[i].sampleDelta);
      }
    }
    while(durations.length < totalSamples){
      durations.push(durations.length ? durations[durations.length - 1] : 0);
    }
    return durations;
  }
  // timescale (сколько единиц таймшкалы трека умещается в одну секунду)
  // лежит в mdhd на разном смещении в зависимости от версии бокса.
  function readMp4MdhdTimescale(view, box){
    var version = view.getUint8(box.bodyStart);
    if(version === 1) return view.getUint32(box.bodyStart + 20);
    return view.getUint32(box.bodyStart + 12);
  }
  function extractSubtitleCuesFromMp4(arrayBuffer){
    var view = new DataView(arrayBuffer);
    var fileLen = arrayBuffer.byteLength;
    var topBoxes = parseMp4Boxes(view, 0, fileLen);
    var moov = findMp4Box(topBoxes, "moov");
    if(!moov) throw new Error("в файле не найден блок moov — это не похоже на корректный mp4");
    var moovChildren = parseMp4Boxes(view, moov.bodyStart, moov.end);
    var traks = findAllMp4Boxes(moovChildren, "trak");
    if(!traks.length) throw new Error("в файле не найдено ни одной дорожки (trak)");

    var subtitleMdiaChildren = null;
    var seenHandlers = [];
    for(var t = 0; t < traks.length; t++){
      var trakChildren = parseMp4Boxes(view, traks[t].bodyStart, traks[t].end);
      var mdia = findMp4Box(trakChildren, "mdia");
      if(!mdia) continue;
      var mdiaChildren = parseMp4Boxes(view, mdia.bodyStart, mdia.end);
      var hdlr = findMp4Box(mdiaChildren, "hdlr");
      if(!hdlr) continue;
      var handlerType = String.fromCharCode(
        view.getUint8(hdlr.bodyStart + 8), view.getUint8(hdlr.bodyStart + 9),
        view.getUint8(hdlr.bodyStart + 10), view.getUint8(hdlr.bodyStart + 11)
      );
      seenHandlers.push(handlerType);
      if(handlerType === "text" || handlerType === "sbtl" || handlerType === "subt"){
        subtitleMdiaChildren = mdiaChildren;
        break;
      }
    }
    if(!subtitleMdiaChildren){
      throw new Error("в этом видео не найдено дорожки субтитров (найдены дорожки: " + (seenHandlers.join(", ") || "нет ни одной") + ") — либо субтитры вшиты прямо в картинку, а не хранятся отдельной текстовой дорожкой");
    }

    var minf = findMp4Box(subtitleMdiaChildren, "minf");
    if(!minf) throw new Error("повреждена структура дорожки субтитров (нет minf)");
    var stbl = findMp4Box(parseMp4Boxes(view, minf.bodyStart, minf.end), "stbl");
    if(!stbl) throw new Error("повреждена структура дорожки субтитров (нет stbl)");
    var stblChildren = parseMp4Boxes(view, stbl.bodyStart, stbl.end);

    var stszBox = findMp4Box(stblChildren, "stsz");
    var stscBox = findMp4Box(stblChildren, "stsc");
    var stcoBox = findMp4Box(stblChildren, "stco");
    var co64Box = findMp4Box(stblChildren, "co64");
    if(!stszBox || !stscBox || !(stcoBox || co64Box)){
      throw new Error("повреждена структура дорожки субтитров (нет stsz/stsc/stco)");
    }
    var sampleSizes = readMp4Stsz(view, stszBox);
    var stscEntries = readMp4Stsc(view, stscBox);
    var chunkOffsets = stcoBox ? readMp4Stco(view, stcoBox, false) : readMp4Stco(view, co64Box, true);
    var sampleOffsets = computeMp4SampleOffsets(chunkOffsets, stscEntries, sampleSizes);

    // stts даёт длительность каждого сэмпла — а у tx3g-дорожки "пустой"
    // сэмпл между двумя репликами (0 байт текста) на самом деле и есть
    // пауза: его длительность буквально равна времени тишины на экране
    // между репликами. Это единственный сигнал о паузах в речи, который
    // вообще есть в самом mp4 (никаких таймкодов в привычном виде тут
    // никогда не было — они не нужны и не читаются, см. общий комментарий
    // выше). Если этой информации почему-то нет (нет stts или mdhd, или
    // timescale==0) — просто не считаем паузы, и весь текст в итоге уйдёт
    // одним абзацем (см. reflowSubtitleCues ниже) — это и есть
    // договорённый запасной вариант.
    var sttsBox = findMp4Box(stblChildren, "stts");
    var mdhdBox = findMp4Box(subtitleMdiaChildren, "mdhd");
    var sampleDurationsSec = null;
    if(sttsBox && mdhdBox){
      try{
        var timescale = readMp4MdhdTimescale(view, mdhdBox);
        if(timescale > 0){
          var rawDurations = expandMp4Stts(readMp4Stts(view, sttsBox), sampleSizes.length);
          sampleDurationsSec = rawDurations.map(function(d){ return d / timescale; });
        }
      }catch(e){ sampleDurationsSec = null; }
    }

    var cues = [];
    var pendingGap = 0;
    for(var i = 0; i < sampleOffsets.length; i++){
      var off = sampleOffsets[i];
      var size = sampleSizes[i];
      var durSec = sampleDurationsSec ? sampleDurationsSec[i] : 0;
      if(size < 2 || off + 2 > fileLen){ pendingGap += durSec; continue; }
      var textLen = view.getUint16(off);
      if(textLen <= 0){ pendingGap += durSec; continue; }
      var usableLen = Math.min(textLen, size - 2, fileLen - off - 2);
      if(usableLen <= 0){ pendingGap += durSec; continue; }
      var bytes = new Uint8Array(arrayBuffer, off + 2, usableLen);
      var text = decodeTx3gSampleText(bytes).replace(/\r\n/g, "\n").trim();
      if(text){
        cues.push({ text: text, gapBefore: pendingGap });
        pendingGap = 0;
      } else {
        pendingGap += durSec;
      }
    }
    return cues;
  }

  // Реплики (сэмплы), как они лежат в mp4, — это ещё не готовый текст:
  // одна реплика может быть куском предложения (перенесённым на новую
  // "экранную" строку просто по ширине экрана — внутри уже заменено на
  // пробел выше), а следующая реплика может продолжать ту же мысль или
  // начинать новую. Склеиваем реплики в предложения по финальной
  // пунктуации (. ! ? … — в т.ч. перед закрывающей кавычкой/скобкой);
  // реплика без такой пунктуации в конце ещё не закончена, следующая
  // приклеивается к ней через пробел.
  //
  // Абзацы — это уже не грамматика, а эвристика: если перед началом
  // предложения была пауза в речи заметно длиннее типичной для этого
  // ролика (порог считается от медианной паузы САМОГО этого ролика, не
  // fixed-число — у разных роликов разный темп речи), считаем это
  // вероятной сменой мысли/темы и начинаем новый абзац. Если пауз с
  // таймингом нет вовсе или все они примерно одинаковые — порог просто
  // никогда не сработает, и весь текст останется одним абзацем — это и
  // есть согласованный запасной вариант, а не отдельная ветка кода.
  var SUBTITLE_SENTENCE_END_RE = /[.!?…]["»)\]]*$/;
  function reflowSubtitleCues(cues){
    if(!cues.length) return "";
    var sentences = [];
    var buffer = "";
    var bufferGap = 0;
    cues.forEach(function(cue){
      var piece = cue.text.replace(/\s*\n\s*/g, " ").trim();
      if(!piece) return;
      if(!buffer){
        bufferGap = cue.gapBefore || 0;
        buffer = piece;
      } else {
        buffer += " " + piece;
      }
      if(SUBTITLE_SENTENCE_END_RE.test(buffer)){
        sentences.push({ text: buffer, gapBefore: bufferGap });
        buffer = "";
      }
    });
    if(buffer) sentences.push({ text: buffer, gapBefore: bufferGap });

    var gaps = [];
    for(var i = 1; i < sentences.length; i++){
      if(sentences[i].gapBefore > 0) gaps.push(sentences[i].gapBefore);
    }
    var paragraphThreshold = null;
    if(gaps.length){
      var sorted = gaps.slice().sort(function(a, b){ return a - b; });
      var median = sorted[Math.floor(sorted.length / 2)];
      paragraphThreshold = Math.max(0.55, median * 2.4);
    }

    var out = "";
    sentences.forEach(function(s, i){
      if(i === 0){ out = s.text; return; }
      var newParagraph = paragraphThreshold !== null && s.gapBefore >= paragraphThreshold;
      out += (newParagraph ? "\n\n" : " ") + s.text;
    });
    return out;
  }

  // Кнопка-скрепка и подпись файла — тот же стиль, что и во вкладке
  // "Объединение заметок" (.task-import-attach-btn из modals.css, см.
  // jwlmerge.js), но раскладка своя: скрепка прижата к правому краю (за
  // неё удобнее тянуться большим пальцем), а слева от неё — одна и та же
  // строка, которая по очереди показывает то имя файла, то статус
  // операции (см. setFileStatus) — так короче и не дублирует одно и то
  // же в двух местах. "Начать"/"Скопировать субтитры" — по образцу пары
  // "Начать"/"Скачать" из вкладки "Извлечение информации из графиков"
  // (.workbooks-run-btn/.workbooks-download-btn.ready, см. workbooks.js)
  // — только вместо скачивания файла тут копирование в буфер обмена,
  // поэтому кнопка квадратная, с общепринятой пиктограммой копирования
  // (см. COPY_ICON_SVG выше), и активируется точно так же — после того
  // как субтитры успешно извлечены. Обработка мгновенная (без сети),
  // поэтому прогресс-бар не нужен — статус меняется сразу.
  //
  // Раскладка (см. также .settings-content-bottom в modals.css): текст
  // результата идёт сразу под короткой инструкцией и растягивается на
  // всё оставшееся место (flex:1 у .subtitle-extract-output — это
  // обычный дочерний элемент #settingsTabContent, а он flex-column, см.
  // modals.css), а строка выбора файла и ряд кнопок обёрнуты в
  // .settings-content-bottom и всегда прижаты к низу окна — не нужно
  // тянуться за ними пальцем, даже когда результат уже показан.
  function renderSettingsTabSubtitleExtract(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var selectedFile = null;
    var extractedText = "";
    container.innerHTML =
      '<div class="workbooks-title">Извлечение субтитров</div>' +
      '<p class="subtitle-extract-hint">Выберите видео (.mp4) со встроенной текстовой дорожкой субтитров — текст будет извлечён сразу на месте, без выхода в интернет.</p>' +
      '<textarea class="subtitle-extract-output" id="srtOutput" readonly placeholder="Извлечённый текст появится здесь…"></textarea>' +
      '<div class="settings-content-bottom">' +
        '<div class="subtitle-file-row">' +
          '<span id="srtFileStatus" class="subtitle-file-status">Файл не выбран</span>' +
          '<button type="button" class="task-import-attach-btn" id="srtAttachBtn" title="Выбрать файл">' + PAPERCLIP_ICON_SVG + '</button>' +
        '</div>' +
        '<input type="file" accept=".mp4,video/mp4" id="srtFileInput" style="display:none;">' +
        '<div class="subtitle-actions-row">' +
          '<button type="button" class="workbooks-run-btn" id="srtStartBtn" disabled>Начать</button>' +
          '<button type="button" class="subtitle-copy-btn" id="srtCopyBtn" title="Скопировать субтитры" disabled>' + COPY_ICON_SVG + '</button>' +
        '</div>' +
      '</div>';

    var fileInput = document.getElementById("srtFileInput");
    var fileStatusEl = document.getElementById("srtFileStatus");
    var startBtn = document.getElementById("srtStartBtn");
    var copyBtn = document.getElementById("srtCopyBtn");
    var outputEl = document.getElementById("srtOutput");

    // Одна и та же строка слева от скрепки играет две роли — имя файла
    // (нейтральный цвет) и статус операции (успех/ошибка подсвечиваются),
    // поэтому вместо просто textContent используется общий сеттер с
    // необязательным модификатором.
    function setFileStatus(text, kind){
      fileStatusEl.textContent = text || "";
      fileStatusEl.classList.remove("success", "error");
      if(kind) fileStatusEl.classList.add(kind);
    }
    function setCopyReady(ready){
      copyBtn.disabled = !ready;
      copyBtn.classList.toggle("ready", !!ready);
    }

    document.getElementById("srtAttachBtn").addEventListener("click", function(){
      fileInput.click();
    });
    fileInput.addEventListener("change", function(){
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      setFileStatus(selectedFile ? selectedFile.name : "Файл не выбран");
      startBtn.disabled = !selectedFile;
      extractedText = "";
      outputEl.value = "";
      setCopyReady(false);
    });

    startBtn.addEventListener("click", function(){
      if(!selectedFile) return;
      startBtn.disabled = true;
      setCopyReady(false);
      outputEl.value = "";
      extractedText = "";
      setFileStatus("Читаем файл…");
      var readPromise = (typeof selectedFile.arrayBuffer === "function")
        ? selectedFile.arrayBuffer()
        : new Promise(function(resolve, reject){
            var reader = new FileReader();
            reader.onload = function(){ resolve(reader.result); };
            reader.onerror = function(){ reject(reader.error || new Error("не удалось прочитать файл")); };
            reader.readAsArrayBuffer(selectedFile);
          });
      readPromise.then(function(buf){
        setFileStatus("Ищем дорожку субтитров…");
        var cues = extractSubtitleCuesFromMp4(buf);
        extractedText = reflowSubtitleCues(cues);
        outputEl.value = extractedText;
        startBtn.disabled = false;
        if(extractedText){
          setCopyReady(true);
          setFileStatus("Готово — извлечено реплик: " + cues.length + ".", "success");
        } else {
          setCopyReady(false);
          setFileStatus("Дорожка субтитров в этом видео пуста.", "error");
        }
      }).catch(function(err){
        startBtn.disabled = false;
        setCopyReady(false);
        console.error("Извлечение субтитров: ошибка", err);
        var detail = err && err.message ? err.message : String(err);
        setFileStatus("Не удалось извлечь субтитры: " + detail + ".", "error");
      });
    });

    copyBtn.addEventListener("click", function(){
      if(!extractedText) return;
      outputEl.focus();
      outputEl.select();
      outputEl.setSelectionRange(0, 99999);
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(extractedText).catch(function(){});
      }
      try{ document.execCommand("copy"); }catch(e){}
      setFileStatus("Скопировано в буфер обмена.", "success");
    });
  }

  // Какой набор вкладок сейчас показан — 1 (боковые/нижние из #settingsTabs
  // и #settingsTabsGear) или 2 (заглушки из #settingsTabsSet2/
  // #settingsTabsGearSet2). Плавающая кнопка-язычок (#settingsGearBtn)
  // переключает их по кругу: закрыто -> набор 1 -> набор 2 -> набор 1 ->
  // ... (см. cycleSettingsTabSet и обработчик клика по settingsGearBtn
  // ниже). При каждом закрытии блокнота (клик мимо него) выбор набора не
  // хранится — следующее открытие всегда начинается с набора 1 (см. ветку
  // "иначе" в обработчике клика).
  var settingsActiveTabSet = 1;
  // Полный порядок позиций в каждом из 4 стеков (боковой/нижний × набор
  // 1/2), от первого места до последнего — используется и для запоминания
  // позиции (см. settingsLastStackTab), и для поиска "того же места" в
  // другом наборе (см. getCorrespondingTabInOtherSet). Порядок должен
  // совпадать с физическим (визуальным) порядком язычков в стопке:
  // - боковые стеки идут снизу вверх (первый элемент — самый нижний
  //   язычок, см. flex-direction:column-reverse в CSS и порядок кнопок в
  //   index.html — #settingsTabs и #settingsTabsSet2 построены одинаково,
  //   первым в DOM у обоих идёт "нижний" язычок).
  // - нижний ряд (EXTRA_TAB_IDS в TASK_TAB_IDS не входит: вкладки
  //   "настройки"/"год"/"настроение" переключаются отдельными
  //   переменными gearBtn/yearBtn/moodTabBtn, а не через EXTRA_TAB_IDS —
  //   поэтому единственный полный список из всех 5 нижних вкладок первого
  //   набора собран здесь вручную, а не через Object.keys(EXTRA_TAB_IDS),
  //   в котором только 2 из 5) идёт слева направо.
  var SETTINGS_SIDE_ORDER_1 = Object.keys(TASK_TAB_IDS);              // red..archive
  var SETTINGS_BOTTOM_ORDER_1 = ["gear","year","mood"].concat(Object.keys(EXTRA_TAB_IDS)); // gear,year,mood,extra2,extra3
  var SETTINGS_SIDE_ORDER_2 = Object.keys(SET2_TAB_IDS);              // set2s_1..set2s_9
  var SETTINGS_BOTTOM_ORDER_2 = Object.keys(SET2_EXTRA_TAB_IDS);      // set2b_1..set2b_5
  // последняя реально выбранная вкладка одного из двух стеков (см.
  // switchSettingsTab выше) — используется, чтобы при переключении набора
  // (cycleSettingsTabSet) открывалась не первая попавшаяся вкладка нового
  // набора, а та, что стоит на ТОЙ ЖЕ позиции (тот же порядковый номер в
  // своём стеке — боковом или нижнем), что и вкладка, на которой
  // произошло переключение.
  var settingsLastStackTab = "gear";
  // текущая открытая вкладка окна настроек (обновляется на КАЖДОЕ
  // переключение, в отличие от settingsLastStackTab, которая помнит
  // только вкладки боковых/нижних стеков) — нужна initBackButtonTrap ниже,
  // чтобы понять, что сейчас открыт md-редактор (set2s_1) и стоит сначала
  // спросить у него, не обработает ли он жест "назад" сам, внутри вкладки.
  var currentSettingsTab = "gear";
  // взводится ТОЛЬКО на время восстановления предыдущей вкладки функцией
  // из стека навигации (см. window.AppNav.push в switchSettingsTab ниже),
  // чтобы сам этот восстанавливающий вызов switchSettingsTab не породил
  // новую запись поверх себя же.
  var suppressNavPush = false;
  // ищет вкладку с той же позицией (индексом), что и tab, но в ДРУГОМ
  // наборе и в том же стеке (боковой -> боковой, нижний -> нижний).
  // Возвращает null, если позиция не распознана (такого пока не бывает,
  // т.к. функция вызывается только с ключом из одного из 4 списков выше).
  function getCorrespondingTabInOtherSet(tab){
    var idx;
    if((idx = SETTINGS_SIDE_ORDER_1.indexOf(tab)) !== -1) return SETTINGS_SIDE_ORDER_2[idx];
    if((idx = SETTINGS_BOTTOM_ORDER_1.indexOf(tab)) !== -1) return SETTINGS_BOTTOM_ORDER_2[idx];
    if((idx = SETTINGS_SIDE_ORDER_2.indexOf(tab)) !== -1) return SETTINGS_SIDE_ORDER_1[idx];
    if((idx = SETTINGS_BOTTOM_ORDER_2.indexOf(tab)) !== -1) return SETTINGS_BOTTOM_ORDER_1[idx];
    return null;
  }
  function applySettingsTabSetVisibility(){
    var set1Side = document.getElementById("settingsTabs");
    var set1Bottom = document.getElementById("settingsTabsGear");
    var set2Side = document.getElementById("settingsTabsSet2");
    var set2Bottom = document.getElementById("settingsTabsGearSet2");
    var showSet1 = settingsActiveTabSet === 1;
    if(set1Side) set1Side.style.display = showSet1 ? "" : "none";
    if(set1Bottom) set1Bottom.style.display = showSet1 ? "" : "none";
    if(set2Side) set2Side.style.display = showSet1 ? "none" : "";
    if(set2Bottom) set2Bottom.style.display = showSet1 ? "none" : "";
  }
  // вызывается кликом по язычку-кнопке, когда блокнот уже открыт —
  // переключает набор и открывает вкладку нового набора на той же позиции,
  // где стояло переключение (settingsLastStackTab), а не первую попавшуюся.
  function cycleSettingsTabSet(){
    settingsActiveTabSet = (settingsActiveTabSet === 1) ? 2 : 1;
    applySettingsTabSetVisibility();
    var target = getCorrespondingTabInOtherSet(settingsLastStackTab);
    if(!target){
      target = (settingsActiveTabSet === 1) ? (getShowAllTasksEnabled() ? "red" : "gear") : "set2b_1";
    }
    // боковые вкладки набора 1 (red..archive) скрыты, пока не включена
    // галочка "Показать все мои задачи" — переходить на скрытую вкладку
    // не нужно, вместо неё открываем вкладку настроек (тот же принцип,
    // что и при обычном открытии блокнота, см. openSettingsModal).
    if(settingsActiveTabSet === 1 && TASK_TAB_IDS.hasOwnProperty(target) && !getShowAllTasksEnabled()){
      target = "gear";
    }
    switchSettingsTab(target);
  }

  function renderSettingsTabGear(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var hourOn = !!getHourGoal();
    var hourNotesOn = isHourNotesEnabled();
    var reducedOn = getGoalsReducedView();
    var colorMarkOn = getColorMarkEnabled();
    var showAllTasksOn = getShowAllTasksEnabled();
    var extraAnimOn = getExtraAnimationsEnabled();
    var bibleQuotesOn = getBibleQuotesEnabled();
    var customCommentsOn = getCustomCommentsEnabled();
    var customVerse = getCustomVerse();
    container.innerHTML =
      '<div class="settings-row"><span>Добавить дополнительный счётчик</span><input type="checkbox" id="settingsHourCb"' + (hourOn ? " checked" : "") + '></div>' +
      '<div class="settings-row" id="settingsHourNotesRow" style="' + (hourOn ? "" : "display:none;") + '"><span>Добавить комментарий в дополнительный счётчик</span><input type="checkbox" id="settingsHourNotesCb"' + (hourNotesOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Видеть меньше прогресс-баров</span><input type="checkbox" id="settingsReducedCb"' + (reducedOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Отмечать прочитанные главы другим цветом</span><input type="checkbox" id="settingsColorMarkCb"' + (colorMarkOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Включить библейские стихи в шапке приложения</span><input type="checkbox" id="settingsBibleQuotesCb"' + (bibleQuotesOn ? " checked" : "") + '></div>' +
      '<div class="settings-verse-block" id="settingsCustomVerseRow" style="' + (bibleQuotesOn ? "" : "display:none;") + '">' +
        '<span class="settings-verse-label">Свой ключевой стих для шапки (по желанию)</span>' +
        '<textarea class="settings-verse-input" id="settingsCustomVerseText" placeholder="Текст стиха…" rows="2"></textarea>' +
        '<input type="text" class="settings-verse-input" id="settingsCustomVerseRef" placeholder="Ссылка, например: Иоанна 3:16">' +
      '</div>' +
      '<div class="settings-row"><span>Включить личные комментарии в шапке сайта</span><input type="checkbox" id="settingsCustomCommentsCb"' + (customCommentsOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Показать все мои задачи</span><input type="checkbox" id="settingsShowAllTasksCb"' + (showAllTasksOn ? " checked" : "") + '></div>' +
      '<div class="settings-row" style="border-bottom:none;"><span>Включить дополнительные анимации</span><input type="checkbox" id="settingsExtraAnimCb"' + (extraAnimOn ? " checked" : "") + '></div>' +
      (showAllTasksOn ? '<button class="modal-btn" id="settingsImportTasksBtn" style="margin-top:16px;">Восстановить задачи из .txt</button>' : '') +
      '<button class="modal-btn" id="settingsAddGoalBtn" style="margin-top:' + (showAllTasksOn ? "10px" : "16px") + ';">Добавить для себя цель</button>' +
      '<button class="modal-btn" id="settingsVersionsBtn" style="margin-top:10px;">Версии</button>' +
      '<button class="modal-btn danger" id="settingsResetBtn" style="margin-top:10px;">Начать чтение сначала и сбросить прогресс</button>' +
      (isSet2Unlocked() ? '' :
        '<div class="settings-row" style="border-bottom:none; flex-direction:column; align-items:stretch; gap:8px; margin-top:16px;">' +
          '<span>Введите секретный код</span>' +
          '<input type="text" class="settings-verse-input" id="settingsSecretCodeInput" placeholder="Код" autocomplete="off" autocapitalize="off" spellcheck="false">' +
          '<div class="modal-note" id="settingsSecretCodeNote" style="display:none;"></div>' +
        '</div>'
      );

    var customVerseTextEl = document.getElementById("settingsCustomVerseText");
    var customVerseRefEl = document.getElementById("settingsCustomVerseRef");
    if(customVerseTextEl) customVerseTextEl.value = customVerse.text || "";
    if(customVerseRefEl) customVerseRefEl.value = customVerse.ref || "";
    function saveCustomVerseFromInputs(){
      setCustomVerse(customVerseTextEl.value, customVerseRefEl.value);
    }
    if(customVerseTextEl) customVerseTextEl.addEventListener("blur", saveCustomVerseFromInputs);
    if(customVerseRefEl) customVerseRefEl.addEventListener("blur", saveCustomVerseFromInputs);

    document.getElementById("settingsBibleQuotesCb").addEventListener("change", function(){
      setBibleQuotesEnabled(this.checked);
      var row = document.getElementById("settingsCustomVerseRow");
      if(row) row.style.display = this.checked ? "" : "none";
    });

    document.getElementById("settingsCustomCommentsCb").addEventListener("change", function(){
      setCustomCommentsEnabled(this.checked);
      refreshExtra2TabAppearance();
    });

    document.getElementById("settingsHourCb").addEventListener("change", function(){
      var cb = this;
      if(cb.checked){
        closeSettingsModal();
        openHourGoalModal();
      } else {
        cb.checked = true; // визуально отменяем, пока не подтвердят
        closeSettingsModal();
        modalBox.innerHTML =
          modalHeader("Весь прогресс будет потерян. Уверены?") +
          '<button class="modal-btn primary" id="mSHourYes">Да</button>' +
          '<button class="modal-btn" id="mSHourNo">Нет</button>';
        bindClose();
        modalOverlay.classList.add("open");
        document.getElementById("mSHourYes").addEventListener("click", function(){
          deactivateHourCounter();
          closeModal();
          openSettingsModal();
        });
        document.getElementById("mSHourNo").addEventListener("click", function(){
          closeModal();
          openSettingsModal();
        });
      }
    });

    var settingsHourNotesCb = document.getElementById("settingsHourNotesCb");
    if(settingsHourNotesCb){
      settingsHourNotesCb.addEventListener("change", function(){
        setHourNotesEnabled(this.checked);
      });
    }

    document.getElementById("settingsReducedCb").addEventListener("change", function(){
      setGoalsReducedView(this.checked);
      goalsExpanded = true;
      try{ localStorage.setItem(GOALS_EXPANDED_KEY, "1"); }catch(e){}
      renderGoalsSection();
    });

    document.getElementById("settingsColorMarkCb").addEventListener("change", function(){
      setColorMarkEnabled(this.checked);
      refreshAllChapterColorVisuals();
    });

    document.getElementById("settingsShowAllTasksCb").addEventListener("change", function(){
      setShowAllTasksEnabled(this.checked);
      refreshSettingsTabsVisibility();
    });

    document.getElementById("settingsExtraAnimCb").addEventListener("change", function(){
      setExtraAnimationsEnabled(this.checked);
    });

    document.getElementById("settingsAddGoalBtn").addEventListener("click", function(){
      var id = createNewGoal();
      renderGoalsSection();
      closeSettingsModal();
      openGoalSettingsModal(id);
    });

    var importTasksBtn = document.getElementById("settingsImportTasksBtn");
    if(importTasksBtn){
      importTasksBtn.addEventListener("click", function(){
        switchSettingsTab("import");
      });
    }

    document.getElementById("settingsVersionsBtn").addEventListener("click", function(){
      switchSettingsTab("versions");
    });

    document.getElementById("settingsResetBtn").addEventListener("click", function(){
      switchSettingsTab("resetConfirm");
    });

    var secretCodeInput = document.getElementById("settingsSecretCodeInput");
    if(secretCodeInput){
      var secretCodeNote = document.getElementById("settingsSecretCodeNote");
      var submitSecretCode = function(){
        var val = secretCodeInput.value;
        if(!val) return;
        if(trySet2UnlockCode(val)){
          renderSettingsTabGear();
        } else {
          secretCodeInput.value = "";
          if(secretCodeNote){
            secretCodeNote.className = "modal-note error";
            secretCodeNote.textContent = "Неверный код.";
            secretCodeNote.style.display = "";
          }
        }
      };
      secretCodeInput.addEventListener("keydown", function(e){
        if(e.key === "Enter"){ e.preventDefault(); submitSecretCode(); }
      });
      secretCodeInput.addEventListener("blur", submitSecretCode);
    }
  }

  // ===== Восстановление задач из .txt (внутри настроек, вкладка "import") =====
  // Шаг 1: та же сетка вкладок, что и у "Перенести задачу" — здесь
  // пользователь выбирает, в какую вкладку будут добавлены задачи из файла.
  function renderSettingsTabImportPicker(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
      return '<button type="button" data-tab="' + key + '">' +
        TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
    }).join("");
    container.innerHTML =
      '<div class="settings-content-bottom">' +
      '<p>Выбери на какую вкладку будут импортированы задачи</p>' +
      '<div class="task-picker-grid">' + buttons + '</div>' +
      '</div>';
    Array.prototype.forEach.call(container.querySelectorAll("[data-tab]"), function(btn){
      btn.addEventListener("click", function(){
        var tabKey = btn.getAttribute("data-tab");
        renderSettingsTabImportFile(tabKey);
      });
    });
  }
  // Шаг 2: выбор .txt-файла (через системный файловый менеджер) и импорт —
  // отдельные задачи в файле разделены пустой строкой
  function renderSettingsTabImportFile(tabKey){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var selectedFile = null;
    container.innerHTML =
      '<div class="settings-content-bottom">' +
      '<p>Выберите файл в формате .txt</p>' +
      '<p style="opacity:.7;font-size:.9em;margin-top:-8px;">Обратите внимание: задачи должны быть разделены пустой строкой.</p>' +
      '<div class="task-import-file-row">' +
        '<button type="button" class="task-import-attach-btn" id="taskImportAttachBtn" title="Прикрепить файл">' + PAPERCLIP_ICON_SVG + '</button>' +
        '<span id="taskImportFileName" class="task-import-file-name">Файл не выбран</span>' +
      '</div>' +
      '<input type="file" accept=".txt,text/plain" id="taskImportFileInput" style="display:none;">' +
      '<button class="modal-btn primary" id="taskImportSubmitBtn" style="margin-top:14px;" disabled>Импортировать</button>' +
      '</div>';

    var fileInput = document.getElementById("taskImportFileInput");
    var fileNameEl = document.getElementById("taskImportFileName");
    var submitBtn = document.getElementById("taskImportSubmitBtn");

    document.getElementById("taskImportAttachBtn").addEventListener("click", function(){
      fileInput.click();
    });
    fileInput.addEventListener("change", function(){
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      fileNameEl.textContent = selectedFile ? selectedFile.name : "Файл не выбран";
      submitBtn.disabled = !selectedFile;
    });
    submitBtn.addEventListener("click", function(){
      if(!selectedFile) return;
      submitBtn.disabled = true;
      var reader = new FileReader();
      reader.onload = function(){
        var raw = typeof reader.result === "string" ? reader.result : "";
        // задачи разделены пустой строкой (одной или несколькими) —
        // поддерживаем и \n, и \r\n
        var chunks = raw.split(/\r?\n\s*\r?\n/);
        var count = 0;
        chunks.forEach(function(chunk){
          var text = chunk.trim();
          if(!text) return;
          createTaskWithText(tabKey, text);
          count++;
        });
        switchSettingsTab(count > 0 ? tabKey : "gear");
      };
      reader.onerror = function(){
        submitBtn.disabled = false;
      };
      reader.readAsText(selectedFile, "UTF-8");
    });
  }

  // ===== Подтверждение сброса прогресса (внутри настроек, вкладка "resetConfirm") =====
  function renderSettingsTabResetConfirm(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML =
      '<div class="settings-content-bottom">' +
      '<p>Точно сбросить весь прогресс чтения и начать сначала?</p>' +
      '<button class="modal-btn danger" id="mResetConfirmYesBtn" style="margin-top:14px;">Да, сбросить прогресс</button>' +
      '<button class="modal-btn" id="mResetConfirmNoBtn" style="margin-top:10px;">Отмена</button>' +
      '</div>';
    document.getElementById("mResetConfirmYesBtn").addEventListener("click", function(){
      performFullReset();
      closeSettingsModal();
    });
    document.getElementById("mResetConfirmNoBtn").addEventListener("click", function(){
      switchSettingsTab("gear");
    });
  }

  var settingsTabGearBtn = document.getElementById("settingsTabGearBtn");
  var settingsTabYearBtn = document.getElementById("settingsTabYearBtn");
  var settingsTabMoodBtn = document.getElementById("settingsTabMoodBtn");
  if(settingsTabGearBtn) settingsTabGearBtn.addEventListener("click", function(){ switchSettingsTab("gear"); });
  if(settingsTabYearBtn) settingsTabYearBtn.addEventListener("click", function(){ switchSettingsTab("year"); });
  if(settingsTabMoodBtn) settingsTabMoodBtn.addEventListener("click", function(){ switchSettingsTab("mood"); });
  Object.keys(TASK_TAB_IDS).forEach(function(key){
    var btn = document.getElementById(TASK_TAB_IDS[key]);
    if(btn) btn.addEventListener("click", function(){ switchSettingsTab(key); });
  });
  Object.keys(EXTRA_TAB_IDS).forEach(function(key){
    var btn = document.getElementById(EXTRA_TAB_IDS[key]);
    if(btn) btn.addEventListener("click", function(){ switchSettingsTab(key); });
  });
  Object.keys(SET2_TAB_IDS).forEach(function(key){
    var btn = document.getElementById(SET2_TAB_IDS[key]);
    if(btn) btn.addEventListener("click", function(){ switchSettingsTab(key); });
  });
  Object.keys(SET2_EXTRA_TAB_IDS).forEach(function(key){
    var btn = document.getElementById(SET2_EXTRA_TAB_IDS[key]);
    if(btn) btn.addEventListener("click", function(){ switchSettingsTab(key); });
  });

  if(settingsModalOverlay){
    settingsModalOverlay.addEventListener("click", function(e){
      if(e.target === settingsModalOverlay) closeSettingsModal();
    });
  }

  var settingsGearBtn = document.getElementById("settingsGearBtn");
  if(settingsGearBtn) settingsGearBtn.addEventListener("click", function(){
    if(settingsModalOverlay && settingsModalOverlay.classList.contains("open")){
      // блокнот уже открыт: если второй набор вкладок разблокирован кодом —
      // переключаем набор по кругу (1 -> 2 -> 1 -> ...), блокнот не
      // закрывается. Если не разблокирован — второго набора для этого
      // пользователя как будто не существует, поэтому повторный клик по
      // язычку просто сворачивает блокнот (как обычное закрытие).
      if(isSet2Unlocked()){
        cycleSettingsTabSet();
      } else {
        closeSettingsModal();
      }
    } else {
      // новое открытие всегда начинается с первого набора вкладок
      settingsActiveTabSet = 1;
      applySettingsTabSetVisibility();
      openSettingsModal();
    }
  });

  // Ставим язычок-кнопку в угол окна настроек сразу при загрузке страницы
  // (а не только при первом открытии окна) и держим его там при ресайзе/
  // повороте экрана — см. layoutSettingsModal выше.
  layoutSettingsModal();
  var settingsLayoutResizeTimer = null;
  window.addEventListener("resize", function(){
    clearTimeout(settingsLayoutResizeTimer);
    settingsLayoutResizeTimer = setTimeout(layoutSettingsModal, 120);
  });

  // ===================== ДОПОЛНИТЕЛЬНЫЙ СЧЁТЧИК ЧАСОВ =====================
  // Данные хранятся в том же общем state (синхронизируются по той же схеме
  // {c,t} "побеждает более позднее время"). Каждая внесённая запись времени
  // и каждый закрытый период (для режима "50") — это отдельный уникальный
  // ключ вида "hourlog:..." / "hoursegment:...", поэтому при слиянии между
  // устройствами записи просто объединяются — новой логики слияния не нужно.
  var HOUR_GOAL_KEY = "__hourGoal";
  var HOUR_MONTHS_KEY = "__hourMonthsToSeptember";
  var HOUR_REAL_MONTHS_KEY = "__hourRealMonthsAtActivation";
  var HOUR_MONTH_PERIOD_KEY = "__hourMonthPeriodStart";
  var HOUR_YEAR_PERIOD_KEY = "__hourYearPeriodStart";
  var HOUR_MONTH_DEFERRED_KEY = "__hourMonthDeferred";
  var HOUR_YEAR_DEFERRED_KEY = "__hourYearDeferred";
  var HOUR_NOTES_ENABLED_KEY = "__hourNotesEnabled";
  var HOUR_SEGMENT_LABEL_MIN = 10; // сегмент/остаток меньше 10 часов — число не показываем

  function getHourGoal(){ var r = state[HOUR_GOAL_KEY]; return (r && r.c) ? r.c : null; }
  function isHourNotesEnabled(){ var r = state[HOUR_NOTES_ENABLED_KEY]; return !!(r && r.c); }
  function setHourNotesEnabled(value){
    state[HOUR_NOTES_ENABLED_KEY] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  // ---- заметки дополнительного счётчика ("hournote:<началоДня>") ----
  // Один ключ на день — значение полностью перезаписывается при
  // редактировании (в т.ч. между устройствами: слияние — по последнему t,
  // как и везде). Не пропалываются функцией pruneOldHourLogsForStats:
  // в отличие от "сырых" hourlog:, заметки должны храниться и
  // редактироваться сколь угодно давние ("Карта дней года").
  function hourNoteKeyForDay(dayTs){ return "hournote:" + dayTs; }
  function getHourNoteForDay(dayTs){
    var rec = state[hourNoteKeyForDay(dayTs)];
    return (rec && typeof rec.c === "string" && rec.c) ? rec.c : "";
  }
  function setHourNoteForDay(dayTs, text, skipGridRefresh){
    var trimmed = (text || "").trim();
    state[hourNoteKeyForDay(dayTs)] = {c: trimmed ? trimmed : null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    // при сохранении прямо из карточки дня (см. renderYearDayNoteEdit) сброс
    // к общей сетке не нужен — пользователь должен оставаться на этом же
    // экране дня; поэтому вызывающий код передаёт skipGridRefresh=true
    if(!skipGridRefresh) refreshYearGridIfOpen();
  }
  function getHourNotesByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hournote:") !== 0) return;
      var rec = state[k];
      if(!rec || typeof rec.c !== "string" || !rec.c) return;
      var day = Number(k.slice("hournote:".length));
      byDay[day] = rec.c;
    });
    return byDay;
  }
  function getMonthsToSeptember(){ var r = state[HOUR_MONTHS_KEY]; return (r && r.c) ? r.c : null; }
  function getRealMonthsAtActivation(){ var r = state[HOUR_REAL_MONTHS_KEY]; return (r && r.c) ? r.c : null; }
  function getMonthPeriodStart(){ var r = state[HOUR_MONTH_PERIOD_KEY]; return (r && r.c) ? r.c : null; }
  function getYearPeriodStart(){ var r = state[HOUR_YEAR_PERIOD_KEY]; return (r && r.c) ? r.c : null; }

  function formatHHMM(totalMinutes){
    totalMinutes = Math.max(0, Math.round(totalMinutes));
    var h = Math.floor(totalMinutes/60), m = totalMinutes % 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }
  // принимает "1.40", "01.40", "01,40", "1:50" и т.п. — разделитель не важен
  function parseHourInput(raw){
    raw = (raw || "").trim();
    var m = raw.match(/^(\d{1,3})[.,:](\d{1,2})$/);
    if(!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if(isNaN(h) || isNaN(mi) || mi > 59) return null;
    return h * 60 + mi;
  }

  function sumHourLogsSince(sinceTs){
    if(!sinceTs) return 0;
    var total = 0;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && typeof state[k].c === "number" && state[k].t >= sinceTs){
        total += state[k].c;
      }
    });
    return total;
  }
  // "стартовый" день для целей "Обзора" (см. sumHourLogMinutesDayFiltered
  // ниже) — если за один календарный день суммарно внесено больше этого
  // порога, весь день считается разовым вводом задним числом, а не
  // реальным использованием в этот день
  var HOUR_BASELINE_DAY_THRESHOLD_MINUTES = 16 * 60;
  // группирует "сырые" hourlog: за [fromTs, toTs) по календарным дням и
  // делит итог на обычные минуты и "стартовые" (день целиком превысил
  // порог) — использовать ТОЛЬКО для статистики ("Обзор"); на сам счётчик
  // и его прогресс (sumHourLogsSince выше) это не влияет
  function sumHourLogMinutesDayFiltered(fromTs, toTs){
    var perDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") !== 0) return;
      var rec = state[k];
      if(!rec || typeof rec.c !== "number") return;
      if(rec.t < fromTs || rec.t >= toTs) return;
      var day = startOfDay(rec.t);
      perDay[day] = (perDay[day] || 0) + rec.c;
    });
    var total = 0, baseline = 0;
    Object.keys(perDay).forEach(function(dayKey){
      if(perDay[dayKey] > HOUR_BASELINE_DAY_THRESHOLD_MINUTES) baseline += perDay[dayKey];
      else total += perDay[dayKey];
    });
    return {total: total, baseline: baseline};
  }
  function addHourLogEntry(minutes){
    var id = "hourlog:" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
    state[id] = {c: minutes, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshYearGridIfOpen();
  }
  // baselineMinutes — сколько из totalMinutes относится к "стартовым" дням
  // этого периода (см. sumHourLogMinutesDayFiltered) — сохраняется вместе с
  // сегментом, чтобы "Обзор" мог вычесть эту часть даже после того, как
  // период закрылся и подневная разбивка исходных записей стала недоступна
  function recordMonthSegment(periodStart, totalMinutes, baselineMinutes){
    state["hoursegment:" + periodStart] = {c: totalMinutes, t: Date.now(), baseline: baselineMinutes || 0};
    saveLocalState();
    scheduleCloudPush();
  }
  function getClosedMonthSegments(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hoursegment:") === 0 && state[k] && typeof state[k].c === "number"){
        list.push({periodStart: Number(k.slice("hoursegment:".length)), minutes: state[k].c});
      }
    });
    list.sort(function(a,b){ return a.periodStart - b.periodStart; });
    return list;
  }
  function sumYearMinutes(){
    var yearStart = getYearPeriodStart();
    if(!yearStart) return 0;
    var total = getClosedMonthSegments()
      .filter(function(s){ return s.periodStart >= yearStart; })
      .reduce(function(a,s){ return a + s.minutes; }, 0);
    total += sumHourLogsSince(getMonthPeriodStart());
    return total;
  }

  function isNewCalendarMonth(sinceTs){
    var since = new Date(sinceTs), now = new Date();
    return (now.getFullYear() > since.getFullYear()) ||
      (now.getFullYear() === since.getFullYear() && now.getMonth() > since.getMonth());
  }
  function computeNextSeptemberFirst(fromTs){
    var d = new Date(fromTs);
    var septThisYear = new Date(d.getFullYear(), 8, 1).getTime();
    return (d.getTime() < septThisYear) ? septThisYear : new Date(d.getFullYear()+1, 8, 1).getTime();
  }
  // сколько реальных календарных месяцев осталось до ближайшего 1 сентября
  // (текущий месяц считается за 1 целиком, независимо от числа)
  function computeRealMonthsRemaining(fromTs){
    var target = computeNextSeptemberFirst(fromTs);
    var d = new Date(fromTs), t = new Date(target);
    var months = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
    return Math.max(1, months);
  }

  // --- "наверстывание": сколько периодов выбрано сверх реально оставшихся ---
  function getClosedSegmentsCountThisYear(){
    var yearStart = getYearPeriodStart();
    if(!yearStart) return 0;
    return getClosedMonthSegments().filter(function(s){ return s.periodStart >= yearStart; }).length;
  }
  function getOverdueCatchUpCount(){
    var chosen = getMonthsToSeptember(), real = getRealMonthsAtActivation();
    if(!chosen || !real) return 0;
    return Math.max(0, chosen - real);
  }
  function isInCatchUpMode(){
    return getHourGoal() === 50 && getClosedSegmentsCountThisYear() < getOverdueCatchUpCount();
  }

  function setHourState(key, value){ state[key] = {c: value, t: Date.now()}; }

  function activateHourCounter(goal, monthsToSeptember){
    var now = Date.now();
    setHourState(HOUR_GOAL_KEY, goal);
    setHourState(HOUR_MONTHS_KEY, goal === 50 ? monthsToSeptember : null);
    setHourState(HOUR_YEAR_PERIOD_KEY, goal === 50 ? now : null);
    setHourState(HOUR_REAL_MONTHS_KEY, goal === 50 ? computeRealMonthsRemaining(now) : null);
    setHourState(HOUR_MONTH_PERIOD_KEY, now);
    setHourState(HOUR_MONTH_DEFERRED_KEY, null);
    setHourState(HOUR_YEAR_DEFERRED_KEY, null);
    saveLocalState();
    scheduleCloudPush();
    renderHourBars();
    renderHourCounterMenu();
  }
  function deactivateHourCounter(){
    setHourState(HOUR_GOAL_KEY, null);
    setHourState(HOUR_MONTHS_KEY, null);
    setHourState(HOUR_REAL_MONTHS_KEY, null);
    setHourState(HOUR_MONTH_PERIOD_KEY, null);
    setHourState(HOUR_YEAR_PERIOD_KEY, null);
    setHourState(HOUR_MONTH_DEFERRED_KEY, null);
    setHourState(HOUR_YEAR_DEFERRED_KEY, null);
    pruneStaleHourLogs(Date.now() + 1);
    saveLocalState();
    scheduleCloudPush();
    renderHourBars();
    renderHourCounterMenu();
  }

  // закрывает текущий период (режим "50"): в сегмент попадают только целые
  // часы, а остаток минут переносится в начало следующего периода
  // записи, старше нового periodStart, уже никогда не читаются никаким
  // кодом (все подсчёты фильтруют по текущему periodStart) — их значения
  // уже "законсервированы" в закрытом сегменте, поэтому их можно смело
  // удалить локально: даже если ещё не до конца синхронизированное
  // устройство "воскресит" такую запись при слиянии, она всё равно ни на
  // что не повлияет, так как окажется раньше актуального periodStart
  function pruneStaleHourLogs(beforeTs){
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && state[k].t < beforeTs){
        delete state[k];
      }
    });
  }

  function closeCurrentMonthPeriodWithCarry(){
    var periodStart = getMonthPeriodStart();
    var totalMinutes = sumHourLogsSince(periodStart);
    var wholeMinutes = Math.floor(totalMinutes/60) * 60;
    var carryMinutes = totalMinutes - wholeMinutes;
    // доля этого периода, приходящаяся на "стартовые" дни (см.
    // sumHourLogMinutesDayFiltered) — считаем её ДО того, как сырые записи
    // станут недоступны для подневного разбора, и сохраняем при сегменте
    var baselineMinutes = Math.min(sumHourLogMinutesDayFiltered(periodStart, Date.now() + 1).baseline, wholeMinutes);
    recordMonthSegment(periodStart, wholeMinutes, baselineMinutes);
    var newStart = Date.now();
    setHourState(HOUR_MONTH_PERIOD_KEY, newStart);
    setHourState(HOUR_MONTH_DEFERRED_KEY, null);
    if(carryMinutes > 0){
      state["hourlog:" + newStart + "-carry"] = {c: carryMinutes, t: newStart};
    }
    // старые записи периода больше не удаляем сразу: они нужны для
    // статистики за скользящий месяц (см. pruneOldHourLogsForStats) и
    // больше не участвуют в подсчёте текущего периода — все суммы
    // фильтруются по актуальному periodStart
    saveLocalState();
    scheduleCloudPush();
    renderHourBars();
  }

  function updateHourBarVisual(prefix, totalMinutes, goalMinutes){
    var light = document.getElementById(prefix + "LightFill");
    var dark = document.getElementById(prefix + "DarkFill");
    if(!light || !dark || goalMinutes <= 0) return {lightPct:0, darkPct:0};
    var lightPct = Math.min(100, (totalMinutes/goalMinutes)*100);
    light.style.width = lightPct + "%";
    var darkPct = 0;
    if(totalMinutes > goalMinutes){
      var over = totalMinutes - goalMinutes;
      var rem = over % goalMinutes;
      darkPct = (rem === 0) ? 100 : (rem/goalMinutes)*100;
    }
    dark.style.width = darkPct + "%";
    return {lightPct: lightPct, darkPct: darkPct};
  }

  // размещает подписи "заполнено" / "не хватает" внутри их собственных зон бара
  function positionZoneTexts(achievedElId, remainingElId, totalMinutes, goalMinutes, achievedLabel, remainingLabel){
    var achievedEl = document.getElementById(achievedElId);
    var remainingEl = document.getElementById(remainingElId);
    if(!achievedEl || !remainingEl || goalMinutes <= 0) return;

    if(totalMinutes <= goalMinutes){
      var achievedPct = (totalMinutes/goalMinutes)*100;
      achievedEl.style.left = "0%";
      achievedEl.style.width = achievedPct + "%";
      achievedEl.textContent = achievedLabel;

      remainingEl.style.left = achievedPct + "%";
      remainingEl.style.width = (100 - achievedPct) + "%";
      remainingEl.textContent = (100 - achievedPct) > 0.5 ? remainingLabel : "";
    } else {
      // цель уже превышена — идёт "тёмный круг", подпись про остаток тут не нужна
      var over = totalMinutes - goalMinutes;
      var rem = over % goalMinutes;
      var darkPct = (rem === 0) ? 100 : (rem/goalMinutes)*100;
      achievedEl.style.left = "0%";
      achievedEl.style.width = darkPct + "%";
      achievedEl.textContent = achievedLabel;
      remainingEl.style.width = "0%";
      remainingEl.textContent = "";
    }
  }

  function updateHourResetButtonVisibility(){
    var btn = document.getElementById("hourMonthResetBtn");
    if(!btn) return;
    var goal = getHourGoal();
    if(!goal){ btn.style.display = "none"; return; }
    var yearDeferred = goal === 50 && state[HOUR_YEAR_DEFERRED_KEY] &&
      state[HOUR_YEAR_DEFERRED_KEY].c === getYearPeriodStart();
    var monthDeferred = goal !== 50 && state[HOUR_MONTH_DEFERRED_KEY] &&
      state[HOUR_MONTH_DEFERRED_KEY].c === getMonthPeriodStart();
    btn.textContent = "Сбросить счётчик";
    btn.style.display = (yearDeferred || monthDeferred) ? "block" : "none";
  }

  function renderHourYearBar(){
    var months = getMonthsToSeptember();
    var yearStart = getYearPeriodStart();
    var segHolder = document.getElementById("hourYearSegments");
    if(!segHolder) return;
    segHolder.innerHTML = "";
    if(!months || !yearStart) return;

    var targetMinutes = months * 50 * 60;
    var closed = getClosedMonthSegments().filter(function(s){ return s.periodStart >= yearStart; });
    var currentMinutes = sumHourLogsSince(getMonthPeriodStart());
    var achievedMinutes = closed.reduce(function(a,s){ return a+s.minutes; }, 0) + currentMinutes;

    // свёрнутый вид: заливка + 2 подписи (как у месячного бара), в целых часах
    updateHourBarVisual("hourYear", achievedMinutes, targetMinutes);
    positionZoneTexts(
      "hourYearAchievedText", "hourYearRemainingText",
      achievedMinutes, targetMinutes,
      String(Math.round(achievedMinutes/60)),
      String(Math.round(Math.max(0, targetMinutes-achievedMinutes)/60))
    );

    // развёрнутый вид: сегменты по месяцам + остаток
    var segMinutesList = closed.map(function(s){ return s.minutes; });
    segMinutesList.push(currentMinutes);
    segMinutesList.forEach(function(minutes){
      if(minutes <= 0) return;
      var seg = document.createElement("div");
      seg.className = "hour-year-segment";
      seg.style.width = (targetMinutes > 0 ? (minutes/targetMinutes)*100 : 0) + "%";
      var hoursVal = minutes/60;
      seg.textContent = (hoursVal >= HOUR_SEGMENT_LABEL_MIN) ? Math.round(hoursVal) : "";
      segHolder.appendChild(seg);
    });
    var remainingMinutes = Math.max(0, targetMinutes - achievedMinutes);
    if(remainingMinutes > 0){
      var rem = document.createElement("div");
      rem.className = "hour-year-remaining";
      rem.style.width = (targetMinutes > 0 ? (remainingMinutes/targetMinutes)*100 : 0) + "%";
      var remHours = remainingMinutes/60;
      rem.textContent = (remHours >= HOUR_SEGMENT_LABEL_MIN) ? Math.round(remHours) : "";
      segHolder.appendChild(rem);
    }
  }

  function renderHourBars(){
    var goal = getHourGoal();
    var monthWrap = document.getElementById("hourMonthWrap");
    var yearWrap = document.getElementById("hourYearWrap");
    if(!goal){
      if(monthWrap) monthWrap.classList.remove("visible");
      if(yearWrap) yearWrap.classList.remove("visible");
      return;
    }
    if(monthWrap) monthWrap.classList.add("visible");
    var periodStart = getMonthPeriodStart() || Date.now();
    var monthMinutes = sumHourLogsSince(periodStart);
    var goalMinutes = goal*60;
    updateHourBarVisual("hourMonth", monthMinutes, goalMinutes);
    positionZoneTexts(
      "hourMonthAchievedText", "hourMonthRemainingText",
      monthMinutes, goalMinutes,
      formatHHMM(monthMinutes),
      formatHHMM(Math.max(0, goalMinutes-monthMinutes))
    );
    updateHourResetButtonVisibility();

    if(goal === 50){
      if(yearWrap) yearWrap.classList.add("visible");
      renderHourYearBar();
    } else if(yearWrap){
      yearWrap.classList.remove("visible");
    }
  }

  function closeHourInputOverlay(prefix){
    var overlay = document.getElementById(prefix + "Overlay");
    if(overlay) overlay.classList.remove("open");
  }
  function toggleHourInputOverlay(prefix){
    var overlay = document.getElementById(prefix + "Overlay");
    if(!overlay) return;
    overlay.classList.toggle("open");
    if(overlay.classList.contains("open")){
      var input = document.getElementById(prefix + "Input");
      if(input){ input.value = ""; input.style.borderColor = ""; }
      // поле комментария за сегодня: показываем только если функция включена
      // в настройках, и сразу подставляем уже существующий текст — чтобы
      // повторное открытие бара за тот же день позволяло его редактировать,
      // а не затирать новым
      if(prefix === "hourMonth"){
        var noteInput = document.getElementById("hourMonthNoteInput");
        if(noteInput){
          var notesOn = isHourNotesEnabled();
          noteInput.style.display = notesOn ? "block" : "none";
          noteInput.style.borderColor = "";
          noteInput.value = notesOn ? getHourNoteForDay(startOfDay(Date.now())) : "";
        }
      }
      if(input) input.focus();
    }
  }
  function confirmHourInput(prefix){
    var input = document.getElementById(prefix + "Input");
    if(!input) return;
    var rawValue = input.value;
    var hasRawValue = rawValue.trim().length > 0;
    var minutes = parseHourInput(rawValue);

    var notesOn = (prefix === "hourMonth") && isHourNotesEnabled();
    var noteInput = notesOn ? document.getElementById("hourMonthNoteInput") : null;
    var noteText = noteInput ? noteInput.value : "";
    var hasNoteText = notesOn && noteText.trim().length > 0;

    // часы введены, но не разобрались — явная ошибка формата
    if(hasRawValue && (minutes === null || minutes <= 0)){
      input.style.borderColor = "#b0432e";
      return;
    }
    // ничего не введено вовсе — ни часов, ни (при включённой функции) заметки
    if(!hasRawValue && !hasNoteText){
      input.style.borderColor = "#b0432e";
      if(noteInput) noteInput.style.borderColor = "#b0432e";
      return;
    }

    if(hasRawValue) addHourLogEntry(minutes);
    if(notesOn) setHourNoteForDay(startOfDay(Date.now()), noteText);

    closeHourInputOverlay(prefix);
    renderHourBars();
    // режим "50" с выбранным числом месяцев больше реального — при каждом
    // внесении времени, пока не наверстали "просроченные" периоды, снова
    // спрашиваем про переход к следующему месяцу
    if(isInCatchUpMode() && !modalOverlay.classList.contains("open")){
      showHourMonthEndDialog(getMonthPeriodStart());
    }
  }

  // --- диалоги окончания месяца / года (тот же стиль, что у окна синхронизации) ---
  function showHourMonthEndDialog(periodStart){
    if(modalOverlay.classList.contains("open")) return;
    var totalMinutes = sumHourLogsSince(periodStart);
    var isYearMode = getHourGoal() === 50;
    modalBox.innerHTML =
      modalHeader("Месяц закончился - " + formatHHMM(totalMinutes),
        isYearMode ? "Перейти к следующему месяцу?" : "Обнулить счётчик?") +
      '<button class="modal-btn primary" id="mHourMonthYes">Да</button>' +
      '<button class="modal-btn" id="mHourMonthNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHourMonthYes").addEventListener("click", function(){
      if(isYearMode){
        closeCurrentMonthPeriodWithCarry();
      } else {
        deactivateHourCounter();
      }
      closeModal();
    });
    document.getElementById("mHourMonthNo").addEventListener("click", function(){
      setHourState(HOUR_MONTH_DEFERRED_KEY, periodStart);
      saveLocalState(); scheduleCloudPush();
      updateHourResetButtonVisibility();
      closeModal();
    });
  }

  function showHourYearEndDialog(yearStart){
    if(modalOverlay.classList.contains("open")) return;
    var totalMinutes = sumYearMinutes();
    modalBox.innerHTML =
      modalHeader("Год окончен - " + Math.round(totalMinutes/60) + " часов", "Сбросить счётчик?") +
      '<button class="modal-btn primary" id="mHourYearYes">Да</button>' +
      '<button class="modal-btn" id="mHourYearNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHourYearYes").addEventListener("click", function(){
      deactivateHourCounter();
      closeModal();
    });
    document.getElementById("mHourYearNo").addEventListener("click", function(){
      setHourState(HOUR_YEAR_DEFERRED_KEY, yearStart);
      saveLocalState(); scheduleCloudPush();
      updateHourResetButtonVisibility();
      closeModal();
    });
  }

  function resolveDeferredHourReset(){
    var goal = getHourGoal();
    if(!goal) return;
    var yearDeferred = goal === 50 && state[HOUR_YEAR_DEFERRED_KEY] &&
      state[HOUR_YEAR_DEFERRED_KEY].c === getYearPeriodStart();
    if(yearDeferred){ deactivateHourCounter(); return; }
    var monthDeferred = state[HOUR_MONTH_DEFERRED_KEY] &&
      state[HOUR_MONTH_DEFERRED_KEY].c === getMonthPeriodStart();
    if(monthDeferred){
      if(goal === 50){
        closeCurrentMonthPeriodWithCarry();
      } else {
        deactivateHourCounter();
      }
    }
  }

  // календарные границы (реальное 1 число месяца / 1 сентября) — отдельно
  // от "наверстывания", которое привязано не к календарю, а к вводу часов
  function checkHourBoundaries(){
    pruneOldHourLogsForStats();
    var goal = getHourGoal();
    if(!goal || modalOverlay.classList.contains("open")) return;
    var periodStart = getMonthPeriodStart();
    if(periodStart && isNewCalendarMonth(periodStart)){
      var monthDeferredRec = state[HOUR_MONTH_DEFERRED_KEY];
      if(!(monthDeferredRec && monthDeferredRec.c === periodStart)){
        showHourMonthEndDialog(periodStart);
        return;
      }
    }
    if(goal === 50){
      var yearStart = getYearPeriodStart();
      if(yearStart && Date.now() >= computeNextSeptemberFirst(yearStart)){
        var yearDeferredRec = state[HOUR_YEAR_DEFERRED_KEY];
        if(!(yearDeferredRec && yearDeferredRec.c === yearStart)){
          showHourYearEndDialog(yearStart);
        }
      }
    }
  }

  // --- меню в подвале ("Дополнительный счётчик" / "Убрать дополнительный счётчик") ---
  function renderHourCounterMenu(){
    var row = document.getElementById("hourCounterMenuRow");
    if(!row) return;
    if(getHourGoal()){
      row.innerHTML = '<button class="version-history-item" id="hourCounterRemoveBtn" style="color:#8a2f1c;">Убрать дополнительный счётчик</button>';
      document.getElementById("hourCounterRemoveBtn").addEventListener("click", openRemoveHourCounterConfirm);
    } else {
      row.innerHTML = '<button class="version-history-item" id="hourCounterAddBtn">Дополнительный счётчик</button>';
      document.getElementById("hourCounterAddBtn").addEventListener("click", openHourGoalModal);
    }
  }

  function openHourGoalModal(){
    modalBox.innerHTML =
      modalHeader("Дополнительный счётчик") +
      '<div class="modal-btn-grid">' +
        '<button id="mHour15">15</button>' +
        '<button id="mHour30">30</button>' +
        '<button id="mHour50">50</button>' +
      '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHour15").addEventListener("click", function(){ activateHourCounter(15, null); closeModal(); });
    document.getElementById("mHour30").addEventListener("click", function(){ activateHourCounter(30, null); closeModal(); });
    document.getElementById("mHour50").addEventListener("click", openMonthsToSeptemberModal);
  }

  function openMonthsToSeptemberModal(){
    var buttons = "";
    for(var i = 1; i <= 12; i++){ buttons += '<button data-months="' + i + '">' + i + '</button>'; }
    modalBox.innerHTML =
      modalHeader("Выберите количество месяцев до сентября") +
      '<div class="modal-btn-grid">' + buttons + '</div>';
    bindClose();
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-months]"), function(btn){
      btn.addEventListener("click", function(){
        activateHourCounter(50, Number(btn.getAttribute("data-months")));
        closeModal();
      });
    });
  }

  // ---- статистика за скользящий календарный месяц (независимо от того,
  // когда закрывался текущий период счётчика) ----

  // начало окна хранения: сегодняшняя дата минус 1 календарный месяц, 00:00
  function getStatsCutoffTs(){
    var d = new Date();
    d.setHours(0,0,0,0);
    d.setMonth(d.getMonth() - 1);
    return d.getTime();
  }

  // записи старше скользящего месяца нигде не нужны (ни локально, ни в
  // облаке) — удаляем их и, если что-то удалили, отправляем изменение дальше
  // очистка касается ТОЛЬКО "сырых" записей hourlog: (детальная история для
  // дневной статистики месячного счётчика). Годовой счётчик хранит данные
  // отдельно, по одному числу на закрытый месяц, в ключах "hoursegment:" —
  // они этой функцией не затрагиваются и не удаляются никогда.
  // Прежде чем удалить "сырую" запись, её минуты суммируются в постоянный
  // (никогда не удаляемый) итог за день — "hourday:<началоДня>" — по одному
  // числу на день, без деталей по отдельным записям. Это даёт компактную
  // историю на много лет вперёд (нужную для карты дней года — см. ниже),
  // не раздувая state детальными логами старше скользящего месяца.
  function pruneOldHourLogsForStats(){
    var cutoff = getStatsCutoffTs();
    var removed = false;
    var dayTotals = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && typeof state[k].t === "number" && state[k].t < cutoff){
        var rec = state[k];
        if(typeof rec.c === "number"){
          var day = startOfDay(rec.t);
          dayTotals[day] = (dayTotals[day] || 0) + rec.c;
        }
        delete state[k];
        removed = true;
      }
    });
    Object.keys(dayTotals).forEach(function(day){
      var key = "hourday:" + day;
      var existing = state[key];
      var prevMinutes = (existing && typeof existing.c === "number") ? existing.c : 0;
      state[key] = {c: prevMinutes + dayTotals[day], t: Date.now()};
    });
    if(removed){
      saveLocalState();
      scheduleCloudPush();
    }
  }

  // накопленное с начала месяца время, сгруппированное по датам, где были
  // записи, за последний календарный месяц (не привязано к текущему
  // периоду счётчика — переход на новый период данные не стирает).
  // для каждой даты хранится массив накопленных значений на момент каждой
  // отдельной записи этого дня, от новых к старым.
  function getMonthCumulativeStats(){
    var cutoff = getStatsCutoffTs();
    var entries = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0 && state[k] && typeof state[k].c === "number" && state[k].t >= cutoff){
        entries.push({minutes: state[k].c, t: state[k].t});
      }
    });
    entries.sort(function(a,b){ return a.t - b.t; });
    function pad2(n){ return (n < 10 ? "0" : "") + n; }
    var days = [];
    var running = 0;
    var lastKey = null;
    entries.forEach(function(e){
      running += e.minutes;
      var d = new Date(e.t);
      var key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      if(key !== lastKey){
        days.push({label: pad2(d.getDate()) + "." + pad2(d.getMonth() + 1), values: []});
        lastKey = key;
      }
      days[days.length - 1].values.push(running);
    });
    days.forEach(function(day){ day.values.reverse(); }); // внутри дня — новые записи сверху
    days.reverse(); // дни — от новых к старым
    return days;
  }

  function hourStatsRowHtml(label, minutes, mark, extraClass){
    return '<div class="settings-row hour-stats-row' + (extraClass ? " " + extraClass : "") + '">' +
      '<span class="hour-stats-left"><span class="hour-stats-mark">' + (mark ? "*" : "") + '</span><span>' + label + '</span></span>' +
      '<span>' + formatHHMM(minutes) + '</span>' +
    '</div>';
  }

  function openHourMonthStatsModal(){
    if(modalOverlay.classList.contains("open")) return;
    pruneOldHourLogsForStats();
    var days = getMonthCumulativeStats();
    var body = days.length ? days.map(function(day, idx){
      var hasMultiple = day.values.length > 1;
      if(!hasMultiple){
        return hourStatsRowHtml(day.label, day.values[0], false);
      }
      var collapsed = hourStatsRowHtml(day.label, day.values[0], true, "hour-stats-toggle");
      var expandedRows = day.values.map(function(v){
        return hourStatsRowHtml(day.label, v, false, "hour-stats-toggle");
      }).join("");
      return '<div class="hour-stats-day" data-day="' + idx + '">' +
        '<div class="hour-stats-collapsed">' + collapsed + '</div>' +
        '<div class="hour-stats-expanded" style="display:none;">' + expandedRows + '</div>' +
      '</div>';
    }).join("") : '<div class="version-history-empty">За последний месяц пока нет записей.</div>';
    modalBox.innerHTML = modalHeader("Статистика за месяц") + body;
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll(".hour-stats-day"), function(dayEl){
      var collapsed = dayEl.querySelector(".hour-stats-collapsed");
      var expanded = dayEl.querySelector(".hour-stats-expanded");
      collapsed.addEventListener("click", function(){
        collapsed.style.display = "none";
        expanded.style.display = "block";
      });
      Array.prototype.forEach.call(expanded.querySelectorAll(".hour-stats-row"), function(row){
        row.addEventListener("click", function(){
          expanded.style.display = "none";
          collapsed.style.display = "block";
        });
      });
    });
  }

  function openRemoveHourCounterConfirm(){
    modalBox.innerHTML =
      modalHeader("Весь прогресс будет потерян. Уверены?") +
      '<button class="modal-btn primary" id="mHourRemoveYes">Да</button>' +
      '<button class="modal-btn" id="mHourRemoveNo">Нет</button>';
    bindClose();
    modalOverlay.classList.add("open");
    document.getElementById("mHourRemoveYes").addEventListener("click", function(){ deactivateHourCounter(); closeModal(); });
    document.getElementById("mHourRemoveNo").addEventListener("click", closeModal);
  }

  // --- обработчики баров ---
  var hourMonthBar = document.getElementById("hourMonthBar");
  if(hourMonthBar) hourMonthBar.addEventListener("click", function(){ toggleHourInputOverlay("hourMonth"); });
  var hourMonthInput = document.getElementById("hourMonthInput");
  if(hourMonthInput){
    hourMonthInput.addEventListener("click", function(e){ e.stopPropagation(); });
    hourMonthInput.addEventListener("keydown", function(e){ if(e.key === "Enter") confirmHourInput("hourMonth"); });
  }
  var hourMonthNoteInput = document.getElementById("hourMonthNoteInput");
  if(hourMonthNoteInput) hourMonthNoteInput.addEventListener("click", function(e){ e.stopPropagation(); });
  var hourMonthConfirm = document.getElementById("hourMonthConfirm");
  if(hourMonthConfirm) hourMonthConfirm.addEventListener("click", function(e){ e.stopPropagation(); confirmHourInput("hourMonth"); });
  var hourMonthCancel = document.getElementById("hourMonthCancel");
  if(hourMonthCancel) hourMonthCancel.addEventListener("click", function(e){ e.stopPropagation(); closeHourInputOverlay("hourMonth"); });
  var hourMonthInfo = document.getElementById("hourMonthInfo");
  if(hourMonthInfo) hourMonthInfo.addEventListener("click", function(e){ e.stopPropagation(); openHourMonthStatsModal(); });
  var hourMonthResetBtn = document.getElementById("hourMonthResetBtn");
  if(hourMonthResetBtn) hourMonthResetBtn.addEventListener("click", function(e){ e.stopPropagation(); resolveDeferredHourReset(); });
  var hourYearBar = document.getElementById("hourYearBar");
  if(hourYearBar) hourYearBar.addEventListener("click", function(){ hourYearBar.classList.toggle("expanded"); });

  // ===================== КАРТА ДНЕЙ ГОДА =====================
  // Компактная сетка "один квадратик = один день", как в GitHub-графике
  // коммитов, но не привязана к календарному году — это скользящее окно
  // за последние 365 дней, заканчивающееся сегодняшним днём. Живёт внутри
  // модалки настроек, на третьей вкладке (всегда видна, отдельного
  // включения/выключения не требует). Своего лога не ведёт — цвет каждого
  // дня считается на лету по видам активности за этот день:
  //  - чтение хотя бы одной главы (ключи вида "БукваКниги|Номер", т.е.
  //    содержащие "|" — см. buildExportData);
  //  - дополнительный счётчик: подробные записи "hourlog:" хранятся только
  //    примерно за последний скользящий месяц, но при их устаревании минуты
  //    сохраняются в постоянный итог за день "hourday:" (см.
  //    pruneOldHourLogsForStats) — поэтому для любых дней, включая старые,
  //    наличие служения всё равно учитывается;
  //  - выполненная задача в прогресс-баре личной цели (записи
  //    "goalcompletion:" — не удаляются никогда, переживают удаление
  //    самой цели);
  //  - отмеченная задача во вкладках задач (записи "taskcompletion:" —
  //    тоже не удаляются никогда, переживают извлечение задачи из архива
  //    только если сама отметка ещё не была отменена — см. restoreTaskFromArchive).
  // Один вид активности за день — клетка "light", два — "dark", три и
  // более — "darkest". Настроение (moodlog:) в закраску клетки не входит
  // вовсе — оно только показывается в детализации по тапу на день.
  // Сетка строится заново при каждом открытии/перерисовке вкладки — она
  // всегда читает актуальный state, поэтому только что отмеченная
  // активность сразу видна, без отдельного кеша.

  var MONTH_NAMES_SHORT = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  var MONTH_NAMES_FULL = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  var WEEKDAY_NAMES_FULL = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
  var WEEKDAY_NAMES_SHORT = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

  function formatDayFull(ts){
    var d = new Date(ts);
    return d.getDate() + " " + MONTH_NAMES_FULL[d.getMonth()] + " " + d.getFullYear();
  }

  // сколько глав было отмечено в каждый день (по ключам вида "Книга|Глава")
  function getReadingCountsByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(!rec || rec.c !== true) return;
      var day = startOfDay(rec.t);
      byDay[day] = (byDay[day] || 0) + 1;
    });
    return byDay;
  }

  // сколько минут дополнительного счётчика записано в каждый день:
  // "сырые" hourlog: (последний скользящий месяц, см. pruneOldHourLogsForStats)
  // + постоянные "hourday:" итоги за более старые дни (создаются той же
  // функцией при удалении устаревших "сырых" записей) — вместе они дают
  // полную историю без ограничения в месяц.
  function getServiceMinutesByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hourlog:") === 0){
        var rec = state[k];
        if(!rec || typeof rec.c !== "number") return;
        var day = startOfDay(rec.t);
        byDay[day] = (byDay[day] || 0) + rec.c;
      } else if(k.indexOf("hourday:") === 0){
        var rec2 = state[k];
        if(!rec2 || typeof rec2.c !== "number") return;
        var day2 = Number(k.slice("hourday:".length));
        if(isNaN(day2)) return;
        byDay[day2] = (byDay[day2] || 0) + rec2.c;
      }
    });
    return byDay;
  }

  // список выполненных задач по личным целям в каждый день (ключи
  // "goalcompletion:", независимая запись — не пропадает из истории, даже
  // если саму цель потом удалили или переиспользовали)
  function getGoalCompletionsByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goalcompletion:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c) return;
      var day = startOfDay(rec.t);
      (byDay[day] = byDay[day] || []).push(rec.c);
    });
    return byDay;
  }

  // --- построение вертикальной сетки (недели сверху вниз, дни слева направо) ---
  // Скользящее окно: последние 365 дней, включая сегодня, дополненное до
  // целых недель (понедельник — воскресенье) с обеих сторон.
  function buildYearGridMarkup(){
    var readingByDay = getReadingCountsByDay();
    var serviceByDay = getServiceMinutesByDay();
    var goalsByDay = getGoalCompletionsByDay();
    var tasksByDay = getTaskCompletionsByDay();

    var now = new Date();
    var todayStart = startOfDay(now.getTime());
    var windowStart = todayStart - 364 * DAY_MS; // 365 дней включительно
    // понедельник = 0 ... воскресенье = 6
    var windowStartWeekday = (new Date(windowStart).getDay() + 6) % 7;
    var gridStart = windowStart - windowStartWeekday * DAY_MS;
    var todayWeekday = (new Date(todayStart).getDay() + 6) % 7;
    var gridEnd = todayStart + (6 - todayWeekday) * DAY_MS;
    var totalDays = Math.round((gridEnd - gridStart) / DAY_MS) + 1;
    var totalRows = Math.ceil(totalDays / 7);

    var headerHtml = '<div class="year-grid-v-row year-grid-v-header">' +
      '<span class="year-grid-v-month-label"></span>';
    for(var wd = 0; wd < 7; wd++){
      headerHtml += '<span class="year-grid-v-weekday">' + WEEKDAY_NAMES_SHORT[wd] + '</span>';
    }
    headerHtml += '</div>';

    var rowsHtml = "";
    var lastMonthShown = -1;
    var activeDays = 0;
    for(var row = 0; row < totalRows; row++){
      var rowFirstDay = gridStart + row * 7 * DAY_MS;
      var rowFirstMonth = new Date(rowFirstDay).getMonth();
      var monthLabel = "";
      if(rowFirstDay >= windowStart && rowFirstMonth !== lastMonthShown){
        lastMonthShown = rowFirstMonth;
        monthLabel = MONTH_NAMES_SHORT[rowFirstMonth];
      }
      rowsHtml += '<div class="year-grid-v-row"><span class="year-grid-v-month-label">' + monthLabel + '</span>';
      for(var col = 0; col < 7; col++){
        var dayTs = rowFirstDay + col * DAY_MS;
        var cls = "year-grid-v-cell";
        var attr = "";
        if(dayTs < windowStart){
          cls += " empty";
        } else if(dayTs > todayStart){
          cls += " future";
        } else {
          var chapters = readingByDay[dayTs] || 0;
          var minutes = serviceByDay[dayTs] || 0;
          var goalsDone = goalsByDay[dayTs] || [];
          var tasksDone = tasksByDay[dayTs] || [];
          var kinds = (chapters > 0 ? 1 : 0) + (minutes > 0 ? 1 : 0) + (goalsDone.length > 0 ? 1 : 0) + (tasksDone.length > 0 ? 1 : 0);
          if(kinds >= 3) cls += " darkest";
          else if(kinds === 2) cls += " dark";
          else if(kinds === 1) cls += " light";
          if(kinds > 0) activeDays++;
          if(dayTs === todayStart) cls += " today";
          attr = ' data-day-ts="' + dayTs + '"';
        }
        rowsHtml += '<span class="' + cls + '"' + attr + '></span>';
      }
      rowsHtml += '</div>';
    }

    // невидимая строка-распорка внизу ленты (те же классы строки/клеток —
    // поэтому её высота автоматически совпадает с обычной строкой при любой
    // ширине экрана). Она не участвует в подсчёте и не кликабельна (нет
    // data-day-ts), а нужна только для того, чтобы при прокрутке до упора
    // вниз (см. requestAnimationFrame ниже и ручную прокрутку пользователем)
    // самая свежая настоящая строка поднималась выше нижнего края примерно
    // на один квадрат и полностью выходила из-под затемняющей маски-тумана
    // (.year-grid-v-scroll, см. mask-image в components.css).
    rowsHtml += '<div class="year-grid-v-row year-grid-v-spacer-row"><span class="year-grid-v-month-label"></span>';
    for(var sp = 0; sp < 7; sp++){
      rowsHtml += '<span class="year-grid-v-cell empty"></span>';
    }
    rowsHtml += '</div>';

    return {html: headerHtml + rowsHtml, activeDays: activeDays};
  }

  // --- детализация по тапу на день ---
  // Раньше открывалась отдельным всплывающим окном (modalOverlay/modalBox).
  // Теперь показывается прямо внутри вкладки настроек "Карта дней года" —
  // подменяет собой сетку в том же #settingsTabContent, как будто на
  // странице сменилось изображение. Отдельной кнопки закрытия ("крестик")
  // здесь нет: чтобы вернуться к сетке, достаточно ещё раз нажать на
  // язычок настроек "Карта дней года" — он всегда заново отрисовывает
  // сетку (см. switchSettingsTab → renderSettingsTabYear).
  function renderYearDayDetail(dayTs){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var readingByDay = getReadingCountsByDay();
    var serviceByDay = getServiceMinutesByDay();
    var moodsByDay = getMoodsByDay();
    var goalsByDay = getGoalCompletionsByDay();
    var tasksByDay = getTaskCompletionsByDay();

    var chapters = readingByDay[dayTs] || 0;
    var minutes = serviceByDay[dayTs] || 0;
    var moods = moodsByDay[dayTs] || [];
    var goalsDone = goalsByDay[dayTs] || [];
    var tasksDone = tasksByDay[dayTs] || [];

    var d = new Date(dayTs);
    var weekdayLabel = WEEKDAY_NAMES_FULL[d.getDay()];
    var rows = "";

    if(chapters > 0){
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">📖</span><span>' +
        chapters + " " + pluralRu(chapters, ["глава","главы","глав"]) + " прочитано</span></div>";
    }
    if(minutes > 0){
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">🕓</span><span>Дополнительный счётчик: ' +
        formatHHMM(minutes) + '</span></div>';
    }
    if(goalsDone.length){
      var goalsHtml = goalsDone.map(function(g){
        return '<div class="year-day-goal-item">' + escapeHtml(g.taskText || "Без названия") +
          ' <span class="year-day-goal-source">— ' + escapeHtml(g.goalTitle || "Без названия") + '</span></div>';
      }).join("");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">🎯</span><span>Выполненные задачи целей:' + goalsHtml + '</span></div>';
    }
    if(tasksDone.length){
      var tasksHtml = tasksDone.map(function(t){
        return '<div class="year-day-goal-item">' + escapeHtml(t.text || "Без названия") +
          ' <span class="year-day-goal-source">— ' + escapeHtml(TASK_TAB_TITLES[t.tab] || t.tab || "") + '</span></div>';
      }).join("");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">✅</span><span>Выполненные задачи:' + tasksHtml + '</span></div>';
    }
    if(moods.length){
      var moodHtml = moods.map(function(m){ return m.emoji + " " + escapeHtml(m.label); }).join(", ");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">🙂</span><span>Настроение: ' + moodHtml + '</span></div>';
    }
    if(!rows){
      rows = '<div class="year-day-empty">В этот день активность не отмечена.</div>';
    }

    // блок с комментарием этого дня: показываем, если функция сейчас
    // включена в настройках, либо если за этот день уже существует ранее
    // сохранённая заметка (чтобы старые записи оставались доступны для
    // просмотра/правки, даже если функцию потом выключили). Комментарий
    // отображается как обычный статичный текст (как и всё остальное в
    // окне), с карандашиком сразу после текста — по нажатию на него текст
    // превращается в редактируемое поле; там же появляется дискета для
    // сохранения (после сохранения снова становится карандашиком).
    var existingNote = getHourNoteForDay(dayTs);
    var showNotes = isHourNotesEnabled() || existingNote;

    // личные комментарии из шапки, скопированные на этот день (см.
    // createYearCommentCopy) — независимый от вкладки "комментарии"
    // список, показывается всегда, если для этого дня есть хоть одна
    // такая запись (даже если галочка "Включить личные комментарии…"
    // сейчас выключена — старые записи остаются доступны).
    var yearComments = getYearCommentsForDay(dayTs);

    container.innerHTML =
      '<div class="year-grid-tab-title">' + escapeHtml(weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1)) + '</div>' +
      '<div class="year-day-modal-title">' + escapeHtml(formatDayFull(dayTs)) + '</div>' +
      rows +
      (showNotes ? '<div class="year-day-note-section" id="yearDayNoteSection"></div>' : '') +
      (yearComments.length ? '<div class="year-day-note-section" id="yearCustomCommentsSection"></div>' : '');
    container.scrollTop = 0;

    if(showNotes) renderYearDayNoteView(dayTs, existingNote);
    if(yearComments.length) renderYearCustomCommentsSection(dayTs);
  }

  var PENCIL_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
  var SAVE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>';

  // статичный вид комментария: текст (или блёклая заглушка "Комментарий",
  // если ещё ничего не введено) и карандашик сразу после него. Ссылки в
  // тексте (см. linkifyHtml выше) становятся кликабельными.
  function renderYearDayNoteView(dayTs, noteText){
    var wrap = document.getElementById("yearDayNoteSection");
    if(!wrap) return;
    var textHtml = noteText ? linkifyHtml(noteText) : '<span class="year-day-note-placeholder">Комментарий</span>';
    wrap.innerHTML =
      '<div class="year-day-note-view">' + textHtml +
        '<button type="button" class="year-day-note-icon-btn" id="yearDayNoteEditBtn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
      '</div>';
    var editBtn = document.getElementById("yearDayNoteEditBtn");
    if(editBtn){
      editBtn.addEventListener("click", function(){
        renderYearDayNoteEdit(dayTs, noteText);
      });
    }
  }

  // режим редактирования: тот же блок текста, что и в статичном виде
  // (contenteditable вместо textarea), а дискета — реальный элемент СРАЗУ
  // ПОСЛЕ текста в потоке (как и карандашик), поэтому она естественным
  // образом сдвигается по мере набора текста и переносится на новую строку
  // вместе с ним, а не висит в фиксированном месте экрана
  //
  // изначально пустой текстовый узел (createTextNode("")) — не даёт
  // браузеру стабильной точки для курсора: Selection API подтверждает
  // установку каретки, но реально набираемый текст в такой узел не
  // попадает (символы теряются). Поэтому для пустого случая текстовый
  // узел начинается с невидимого символа нулевой ширины (ZERO WIDTH
  // SPACE, U+200B) — он делает узел непустым (ввод начинает приниматься
  // браузером нормально), но ничего не отображает и не занимает места,
  // так что дискета остаётся ровно на своей строке рядом с текстом (в
  // отличие от служебного <br>, который переносил бы её на строку ниже).
  // При вычислении/сохранении текста этот символ вырезается.
  var EMPTY_ANCHOR_CHAR = "\u200B";
  function getEditableNoteText(root, skipEl){
    var text = "";
    function walk(node){
      if(node === skipEl) return;
      if(node.nodeType === 3){ text += node.nodeValue; return; }
      if(node.nodeType === 1 && node.tagName === "BR"){ text += "\n"; return; }
      var kids = node.childNodes;
      for(var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    var top = root.childNodes;
    for(var i = 0; i < top.length; i++) walk(top[i]);
    // служебный символ-якорь мог оказаться где угодно в тексте (браузер
    // иногда сохраняет его перед впечатанным текстом, а не только в
    // начале) — вырезаем все вхождения, это не пользовательский ввод
    return text.split(EMPTY_ANCHOR_CHAR).join("");
  }
  function renderYearDayNoteEdit(dayTs, noteText){
    var wrap = document.getElementById("yearDayNoteSection");
    if(!wrap) return;
    wrap.innerHTML =
      '<div class="year-day-note-view year-day-note-editable" id="yearDayNoteInput" contenteditable="true"></div>';
    var editable = document.getElementById("yearDayNoteInput");
    if(!editable) return;

    var textNode = document.createTextNode(noteText ? noteText : EMPTY_ANCHOR_CHAR);
    editable.appendChild(textNode);
    editable.setAttribute("data-day-ts", String(dayTs)); // нужно для автосохранения при закрытии окна/смене вкладки
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "year-day-note-icon-btn";
    saveBtn.id = "yearDayNoteSaveBtn";
    saveBtn.title = "Сохранить";
    saveBtn.innerHTML = SAVE_ICON_SVG;
    editable.appendChild(saveBtn);

    function updatePlaceholder(){
      var empty = getEditableNoteText(editable, saveBtn).length === 0;
      editable.classList.toggle("is-empty", empty);
    }
    updatePlaceholder();

    // курсор сразу ставим в конец введённого текста (перед дискетой) —
    // так же, как карандашик стоит сразу после текста в статичном виде
    // (если текста ещё нет — сразу после невидимого символа-якоря, см.
    // EMPTY_ANCHOR_CHAR выше)
    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", updatePlaceholder);
    // Enter вставляет обычный перевод строки внутри того же текстового узла
    // (white-space:pre-wrap в CSS), вместо того чтобы браузер плодил <div>
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    saveBtn.addEventListener("click", function(e){
      e.stopPropagation();
      var newText = getEditableNoteText(editable, saveBtn);
      setHourNoteForDay(dayTs, newText, true); // остаёмся на этой же карточке дня, сетку не перерисовываем
      renderYearDayNoteView(dayTs, newText.trim());
    });
  }

  // если в этот момент открыта карточка дня с активным редактированием
  // комментария (contenteditable, см. renderYearDayNoteEdit), сохраняем
  // введённый текст без явного нажатия на дискету — вызывается перед
  // закрытием окна настроек и перед переключением на другую вкладку
  // настроек, чтобы недописанный текст не терялся
  function flushPendingYearDayNoteEdit(){
    var editable = document.getElementById("yearDayNoteInput");
    if(!editable || !editable.isContentEditable) return;
    var dayTsAttr = editable.getAttribute("data-day-ts");
    if(dayTsAttr === null) return;
    var saveBtn = document.getElementById("yearDayNoteSaveBtn");
    var newText = getEditableNoteText(editable, saveBtn);
    setHourNoteForDay(Number(dayTsAttr), newText, true);
  }

  // ---- личные комментарии из шапки, скопированные на конкретный день
  // "Карты дней года" (см. createYearCommentCopy) ----
  // Список из 0+ независимых записей: каждая — как обычный комментарий
  // дня (та же разметка .year-day-note-view), но с добавленным крестиком
  // для удаления (per-запись, не общий на весь день).
  function renderYearCustomCommentsSection(dayTs){
    var wrap = document.getElementById("yearCustomCommentsSection");
    if(!wrap) return;
    var items = getYearCommentsForDay(dayTs);
    wrap.innerHTML = items.map(function(item){
      return '<div class="year-custom-comment-item" id="' + yearCommentDomId(item.key) + '"></div>';
    }).join("");
    items.forEach(function(item){ renderYearCommentItemView(item.key, item.text); });
  }
  function yearCommentDomId(key){ return "yearComment_" + key.replace(/[^a-zA-Z0-9]/g,"_"); }
  function renderYearCommentItemView(key, text){
    var holder = document.getElementById(yearCommentDomId(key));
    if(!holder) return;
    holder.innerHTML =
      '<div class="year-day-note-view">' + linkifyHtml(text) +
        '<button type="button" class="year-day-note-icon-btn year-comment-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
        '<button type="button" class="year-day-note-icon-btn year-comment-delete-btn" title="Удалить">' + CROSS_SMALL_ICON_SVG + '</button>' +
      '</div>';
    holder.querySelector(".year-comment-edit-btn").addEventListener("click", function(){
      renderYearCommentItemEdit(key, text);
    });
    holder.querySelector(".year-comment-delete-btn").addEventListener("click", function(){
      deleteYearCommentPermanently(key);
      holder.remove();
    });
  }
  function renderYearCommentItemEdit(key, text){
    var holder = document.getElementById(yearCommentDomId(key));
    if(!holder) return;
    flushPendingYearCommentEdits();
    holder.innerHTML =
      '<div class="year-day-note-view year-day-note-editable" id="yearCommentInput_' + yearCommentDomId(key) + '" contenteditable="true" data-year-comment-key="' + escapeHtml(key) + '"></div>';
    var editable = document.getElementById("yearCommentInput_" + yearCommentDomId(key));
    if(!editable) return;
    var textNode = document.createTextNode(text ? text : EMPTY_ANCHOR_CHAR);
    editable.appendChild(textNode);
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "year-day-note-icon-btn";
    saveBtn.title = "Сохранить";
    saveBtn.innerHTML = SAVE_ICON_SVG;
    editable.appendChild(saveBtn);
    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "year-day-note-icon-btn";
    deleteBtn.title = "Удалить";
    deleteBtn.innerHTML = CROSS_SMALL_ICON_SVG;
    editable.appendChild(deleteBtn);

    function updatePlaceholder(){
      var empty = getEditableNoteText(editable, saveBtn).length === 0;
      editable.classList.toggle("is-empty", empty);
    }
    updatePlaceholder();

    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", updatePlaceholder);
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    saveBtn.addEventListener("click", function(e){
      e.stopPropagation();
      var newText = getEditableNoteText(editable, saveBtn);
      setYearCommentText(key, newText);
      renderYearCommentItemView(key, newText.trim());
    });
    deleteBtn.addEventListener("click", function(e){
      e.stopPropagation();
      deleteYearCommentPermanently(key);
      holder.remove();
    });
  }
  // недописанное редактирование записи "Карты дней года" сохраняем перед
  // закрытием окна настроек/переключением вкладки — та же идея, что и у
  // flushPendingYearDayNoteEdit
  function flushPendingYearCommentEdits(){
    var editables = document.querySelectorAll("[data-year-comment-key]");
    Array.prototype.forEach.call(editables, function(editable){
      if(!editable.isContentEditable) return;
      var key = editable.getAttribute("data-year-comment-key");
      if(!key) return;
      var saveBtn = editable.querySelector(".year-day-note-icon-btn");
      var newText = getEditableNoteText(editable, saveBtn);
      setYearCommentText(key, newText);
    });
  }

  // то же самое для текста задачи (вкладки red/inbox/next/…): если в
  // момент ухода со вкладки/закрытия окна настроек какая-то строка была
  // в режиме редактирования (contenteditable, см. renderTaskRowEdit),
  // сохраняем введённый текст без явного нажатия на дискету — иначе он
  // терялся при простом переключении вкладки. Строк в редактировании
  // одновременно может быть несколько (клик по карандашику на разных
  // строках), поэтому проходим по всем.
  function flushPendingTaskEdits(){
    var editables = document.querySelectorAll(".task-editable[data-task-id]");
    Array.prototype.forEach.call(editables, function(editable){
      if(!editable.isContentEditable) return;
      var taskId = editable.getAttribute("data-task-id");
      if(!taskId) return;
      var saveBtn = editable.querySelector(".task-icon-btn");
      var newText = getEditableNoteText(editable, saveBtn);
      setTaskText(taskId, newText.trim());
    });
  }

  // --- третья вкладка настроек: сама карта на весь экран, со своей
  // внутренней прокруткой. Пояснение ("летопись") — не отдельный блок под
  // сеткой, а первый элемент внутри той же прокрутки, над самой старой
  // неделей: по умолчанию окно открыто прокрученным вниз (к сегодня), так
  // что пояснение видно, только если докрутить ленту до самого верха. ---
  function renderSettingsTabYear(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var built = buildYearGridMarkup();

    var legendHtml =
      '<div class="year-grid-legend-top">' +
        '<div class="year-grid-legend-top-title">Как читать карту</div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell"></span><span>— в этот день отметок нет</span></div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell light"></span><span>— один вид активности: чтение, доп. счётчик, задача цели или выполненная задача</span></div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell dark"></span><span>— два вида активности в один день</span></div>' +
        '<div class="year-grid-legend-row"><span class="year-grid-v-cell darkest"></span><span>— три и более видов активности в один день</span></div>' +
      '</div>';

    container.innerHTML =
      '<div class="year-grid-tab-header">' +
        '<div class="year-grid-tab-title">Карта дней года</div>' +
        '<button class="year-grid-active-days-btn" id="yearGridActiveDaysBtn" title="Дней с отметками за последние 365 дней">' + built.activeDays + '</button>' +
      '</div>' +
      '<div class="year-grid-v-scroll" id="yearGridVScroll">' + legendHtml + built.html + '</div>';

    var activeDaysBtn = document.getElementById("yearGridActiveDaysBtn");
    if(activeDaysBtn){
      activeDaysBtn.addEventListener("click", function(e){
        e.stopPropagation();
        if(modalOverlay.classList.contains("open")) return;
        modalBox.innerHTML = modalHeader("Дней с отметками за последние 365 дней: " + built.activeDays);
        bindClose();
        modalOverlay.classList.add("open");
      });
    }

    var scrollHolder = document.getElementById("yearGridVScroll");
    if(scrollHolder){
      scrollHolder.addEventListener("click", function(e){
        var cell = e.target.closest ? e.target.closest("[data-day-ts]") : null;
        if(!cell) return;
        var ts = Number(cell.getAttribute("data-day-ts"));
        if(!isNaN(ts)) renderYearDayDetail(ts);
      });
      // сразу прокручиваем к текущей неделе (в самый низ сетки) — пояснение
      // наверху ленты остаётся скрыто, пока не прокрутить наверх вручную
      requestAnimationFrame(function(){
        scrollHolder.scrollTop = scrollHolder.scrollHeight;
      });
    }
  }

  // если вкладка карты сейчас открыта — перерисовать её немедленно, чтобы
  // только что отмеченное чтение/доп. счётчик/настроение было видно сразу
  function refreshYearGridIfOpen(){
    var yearBtn = document.getElementById("settingsTabYearBtn");
    if(yearBtn && yearBtn.classList.contains("active")) renderSettingsTabYear();
  }

  // ===================== ЛИЧНЫЕ ЦЕЛИ =====================
  // Каждая цель — отдельный уникальный ключ state["goal:<id>"], поэтому
  // объединение между устройствами работает автоматически (та же схема,
  // что у остальных функций). Удаление — c:null с новым временем (как и
  // везде), а не физическое удаление ключа — чтобы не "воскрешать" её при
  // слиянии с ещё не обновившимся устройством.
  var GOAL_DEFAULT_COLOR = "#9370DB";
  var GOAL_COLORS = [
    "#48F78E","#29B6F6","#9370DB","#E06666","#F7C948","#FF9F43",
    "#4ECDC4","#6FA8DC","#FF6FB5","#A0785A","#8E7CC3","#8FD9B8",
    "#D9534F","#B4A7D6","#5DADE2","#F1948A"
  ];
  var GOAL_MAX_TASKS = 20;
  var goalsExpanded = (localStorage.getItem(GOALS_EXPANDED_KEY) !== "0"); // раскрыта ли полоса в режиме "видеть меньше" (сохраняется между перезагрузками)

  function getGoalsReducedView(){
    var r = state["__goalsReducedView"];
    return !!(r && r.c);
  }
  function setGoalsReducedView(value){
    state["__goalsReducedView"] = {c: value, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }

  function escapeHtml(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // экранирует текст и оборачивает всё распознаваемое форматирование —
  // ссылки (Библия, [[заметки]], http/www), **жирный**, ==выделение==,
  // *курсив*, заголовки/цитаты/списки (Obsidian-стиль). Имя функции
  // сохранено прежним (linkifyHtml), чтобы не менять вызывающий код во
  // всех местах, где статично показывается сохранённый текст (комментарий
  // к дню, личные комментарии, текст/комментарии задач) — см.
  // formatObsidianHtml/formatInline выше, где и находится вся реальная
  // логика.
  function linkifyHtml(s){
    return formatObsidianHtml(s);
  }

  function getAllGoals(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goal:") === 0 && state[k] && state[k].c){
        list.push({id: k.slice(5), data: state[k].c, t: state[k].t});
      }
    });
    list.sort(function(a,b){ return a.t - b.t; });
    return list;
  }
  function getGoalData(goalId){
    var rec = state["goal:" + goalId];
    return (rec && rec.c) ? rec.c : null;
  }
  function saveGoal(goalId, data){
    state["goal:" + goalId] = {c: data, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function deleteGoal(goalId){
    state["goal:" + goalId] = {c: null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function createNewGoal(){
    var id = "g" + Date.now() + Math.random().toString(36).slice(2,7);
    saveGoal(id, {title:"", color: GOAL_DEFAULT_COLOR, tasks: []});
    return id;
  }

  function buildGoalBarEl(goal){
    var bar = document.createElement("div");
    bar.className = "goal-bar";
    var tasks = goal.data.tasks || [];
    var n = tasks.length;
    var checkedCount = tasks.filter(function(t){ return t.checked; }).length;
    var pct = n > 0 ? (checkedCount / n) * 100 : 0;

    var fill = document.createElement("div");
    fill.className = "goal-fill";
    fill.style.width = pct + "%";
    fill.style.backgroundColor = goal.data.color || GOAL_DEFAULT_COLOR;
    bar.appendChild(fill);

    var textEl = document.createElement("div");
    textEl.className = "goal-bar-text";
    textEl.textContent = goal.data.title || "Без названия";
    bar.appendChild(textEl);
    bar.addEventListener("click", function(){ openGoalSettingsModal(goal.id); });
    return bar;
  }

  // По умолчанию бары целей просто стоят в общем потоке рядом с другими
  // барами (тот же стиль, без рамки). Только если явно включён режим
  // "Видеть меньше прогресс-баров" — они переезжают в отдельную
  // полноширинную полосу со сворачивающим треугольником.
  function renderGoalsSection(){
    var inlineList = document.getElementById("goalsListInline");
    var toggleWrap = document.getElementById("goalsToggleWrap");
    var band = document.getElementById("goalsBand");
    var list = document.getElementById("goalsList");
    if(!inlineList || !toggleWrap || !band || !list) return;

    var goals = getAllGoals();
    var reduced = getGoalsReducedView();

    inlineList.innerHTML = "";
    list.innerHTML = "";

    if(goals.length === 0){
      toggleWrap.classList.remove("visible");
      band.classList.remove("reduced-mode");
      return;
    }

    if(reduced){
      toggleWrap.classList.add("visible");
      band.classList.add("reduced-mode");
      goals.forEach(function(g){ list.appendChild(buildGoalBarEl(g)); });
      band.classList.toggle("open", goalsExpanded);
      // Реальная высота списка целей (а не произвольное большое число)
      // подставляется уже после того, как бары целей добавлены в DOM —
      // список короткий (обычно несколько целей), поэтому измерение здесь
      // ничтожно дёшево, в отличие от больших сеток глав книг.
      // +10 — это padding-top самой .goals-band (см. components.css):
      // max-height считается по border-box вместе с этим паддингом, а
      // scrollHeight списка внутри его не учитывает — без добавки нижняя
      // цель в списке обрезалась ровно на эту высоту.
      if(goalsExpanded) band.style.setProperty("--gb-h", (list.scrollHeight + 10) + "px");
      var btn = document.getElementById("goalsToggleBtn");
      if(btn) btn.innerHTML = goalsExpanded ? "&#9650;" : "&#9660;";
    } else {
      toggleWrap.classList.remove("visible");
      band.classList.remove("reduced-mode");
      goals.forEach(function(g){ inlineList.appendChild(buildGoalBarEl(g)); });
    }
  }

  function renderAddGoalMenu(){
    var row = document.getElementById("addGoalMenuRow");
    if(!row) return;
    row.innerHTML = '<button class="version-history-item" id="addGoalBtn">Добавить для себя цель</button>';
    document.getElementById("addGoalBtn").addEventListener("click", function(){
      var id = createNewGoal();
      renderGoalsSection();
      openGoalSettingsModal(id);
    });
  }

  // --- окно настройки цели: заголовок, цвет, список задач ---
  function openGoalSettingsModal(goalId){
    var goal = getGoalData(goalId);
    if(!goal) return;
    modalBox.innerHTML =
      modalHeader("Настройка цели") +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">' +
        '<input type="text" id="goalTitleInput" placeholder="Заголовок" value="' + escapeHtml(goal.title) + '" ' +
          'style="flex:1;padding:10px;border:1px solid var(--groove-shadow);border-radius:6px;background:#fffef8;color:var(--ink);font-family:inherit;font-size:14px;">' +
        '<div class="goal-color-square" id="goalColorSquare" style="background:' + (goal.color || GOAL_DEFAULT_COLOR) + ';"></div>' +
      '</div>' +
      '<div id="goalTasksList"></div>' +
      '<button class="modal-btn" id="goalAddTaskBtn">Добавить задачу</button>' +
      '<div class="modal-note" id="goalTaskLimitNote" style="text-align:center;"></div>' +
      '<div class="modal-section">' +
        '<button class="modal-btn danger" id="goalDeleteBtn">Удалить эту цель</button>' +
      '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    renderGoalTasksList(goalId);

    document.getElementById("goalTitleInput").addEventListener("input", function(){
      var g = getGoalData(goalId); if(!g) return;
      g.title = this.value;
      saveGoal(goalId, g);
      renderGoalsSection();
    });
    document.getElementById("goalColorSquare").addEventListener("click", function(){ openGoalColorPicker(goalId); });
    document.getElementById("goalAddTaskBtn").addEventListener("click", function(){
      var g = getGoalData(goalId); if(!g) return;
      g.tasks = g.tasks || [];
      if(g.tasks.length >= GOAL_MAX_TASKS) return;
      g.tasks.push({text:"", checked:false});
      saveGoal(goalId, g);
      renderGoalTasksList(goalId);
      renderGoalsSection();
    });
    document.getElementById("goalDeleteBtn").addEventListener("click", function(){
      if(!confirm("Удалить эту цель вместе со всеми задачами?")) return;
      deleteGoal(goalId);
      closeModal();
      renderGoalsSection();
    });
  }

  function renderGoalTasksList(goalId){
    var holder = document.getElementById("goalTasksList");
    if(!holder) return;
    var goal = getGoalData(goalId);
    if(!goal) return;
    var tasks = goal.tasks || [];
    holder.innerHTML = "";
    tasks.forEach(function(task, idx){
      var row = document.createElement("div");
      row.className = "goal-task-row";
      row.innerHTML =
        '<input type="checkbox" data-idx="' + idx + '" class="goalTaskCheckbox"' + (task.checked ? " checked" : "") + '>' +
        '<input type="text" data-idx="' + idx + '" class="goalTaskText" value="' + escapeHtml(task.text) + '" placeholder="Текст задачи">' +
        '<button data-idx="' + idx + '" class="goal-task-remove" title="Убрать задачу">&times;</button>';
      holder.appendChild(row);
    });
    Array.prototype.forEach.call(holder.querySelectorAll(".goalTaskCheckbox"), function(cb){
      cb.addEventListener("change", function(){
        var g = getGoalData(goalId); if(!g) return;
        var idx = Number(cb.getAttribute("data-idx"));
        if(g.tasks[idx]) g.tasks[idx].checked = cb.checked;
        saveGoal(goalId, g);
        renderGoalsSection();
        // отдельная, независимая от самой цели запись — не пропадает из
        // экспорта, даже если цель потом удалят или снимут галочку
        if(cb.checked && g.tasks[idx]){
          var ts = Date.now();
          state["goalcompletion:" + ts + "-" + Math.random().toString(36).slice(2,7)] =
            {c: {goalTitle: g.title || "Без названия", taskText: g.tasks[idx].text || ""}, t: ts};
          saveLocalState();
          scheduleCloudPush();
        }
      });
    });
    Array.prototype.forEach.call(holder.querySelectorAll(".goalTaskText"), function(inp){
      inp.addEventListener("input", function(){
        var g = getGoalData(goalId); if(!g) return;
        var idx = Number(inp.getAttribute("data-idx"));
        if(g.tasks[idx]) g.tasks[idx].text = inp.value;
        saveGoal(goalId, g);
        renderGoalsSection();
      });
    });
    Array.prototype.forEach.call(holder.querySelectorAll(".goal-task-remove"), function(btn){
      btn.addEventListener("click", function(){
        var g = getGoalData(goalId); if(!g) return;
        var idx = Number(btn.getAttribute("data-idx"));
        g.tasks.splice(idx, 1);
        saveGoal(goalId, g);
        renderGoalTasksList(goalId);
        renderGoalsSection();
      });
    });
    updateGoalTaskLimitNote(goalId);
  }

  function updateGoalTaskLimitNote(goalId){
    var goal = getGoalData(goalId);
    var note = document.getElementById("goalTaskLimitNote");
    var addBtn = document.getElementById("goalAddTaskBtn");
    var atMax = goal && (goal.tasks || []).length >= GOAL_MAX_TASKS;
    if(note) note.textContent = atMax ? "Достигнуто максимальное количество задач (" + GOAL_MAX_TASKS + ")." : "";
    if(addBtn) addBtn.style.display = atMax ? "none" : "block";
  }

  function openGoalColorPicker(goalId){
    var buttons = GOAL_COLORS.map(function(c){
      return '<button data-color="' + c + '" style="background:' + c + ';"></button>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Выберите цвет прогресс-бара") +
      '<div class="goal-color-grid">' + buttons + '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-color]"), function(btn){
      btn.addEventListener("click", function(){
        var g = getGoalData(goalId); if(!g) return;
        g.color = btn.getAttribute("data-color");
        saveGoal(goalId, g);
        renderGoalsSection();
        openGoalSettingsModal(goalId);
      });
    });
  }

  var goalsToggleBtn = document.getElementById("goalsToggleBtn");
  if(goalsToggleBtn){
    goalsToggleBtn.addEventListener("click", function(){
      goalsExpanded = !goalsExpanded;
      try{ localStorage.setItem(GOALS_EXPANDED_KEY, goalsExpanded ? "1" : "0"); }catch(e){}
      var band = document.getElementById("goalsBand");
      if(band){
        if(goalsExpanded){
          var list = document.getElementById("goalsList");
          if(list) band.style.setProperty("--gb-h", (list.scrollHeight + 10) + "px");
        }
        band.classList.toggle("open", goalsExpanded);
      }
      goalsToggleBtn.innerHTML = goalsExpanded ? "&#9650;" : "&#9660;";
    });
  }

  // ===================== ВКЛАДКИ ЗАДАЧ: ХРАНЕНИЕ =====================
  // Каждая задача — отдельный ключ "task:<id>" в общем state (та же схема
  // {c:..., t:...}, что и у всего остального — поэтому синхронизация между
  // устройствами и экспорт работают автоматически, без доп. кода).
  // c = {text, tab, checked, checkedAt, completionKey, nextForProjectId, flag}
  //   text            — текст задачи
  //   tab             — вкладка, где реально "живёт" задача (её единственный
  //                     дом: inbox/next/projects/waiting/read/someday — без
  //                     red, см. flag ниже), пока не отмечена (не меняется,
  //                     когда задача уходит в архив — так после извлечения
  //                     она возвращается туда же, откуда была)
  //   checked         — отмечена ли (значит, сейчас показывается в архиве)
  //   checkedAt       — когда отмечена (для сортировки в архиве и как день
  //                     для "Карты дней года")
  //   completionKey   — ключ отдельной вечной записи "taskcompletion:…"
  //                     (см. ниже), которая держит эту отметку в истории/
  //                     экспорте, даже если сама задача потом изменится —
  //                     удаляется (c:null) при извлечении из архива, т.к.
  //                     это отменяет сам факт "выполнения"
  //   nextForProjectId — только у задач во вкладке "next": id задачи-проекта
  //                     (из вкладки "projects"), для которой это next-действие
  //   flag            — цветная отметка слева от чекбокса: null (нет
  //                     отметки, бледно-сиреневый кружок) | "red" | "yellow".
  //                     Вкладка Red — не отдельное хранилище, а витрина:
  //                     показывает ЛЮБУЮ незакрытую задачу с flag "red" или
  //                     "yellow", независимо от того, в какой реальной
  //                     вкладке она живёт (см. getTasksForTab). Поэтому
  //                     отметка задачи выполненной прямо на вкладке Red
  //                     закрывает тот же самый task:<id> — и он пропадает
  //                     отовсюду разом, это одна и та же запись, не копия.
  function genTaskId(){
    return "tk" + Date.now() + Math.random().toString(36).slice(2,7);
  }
  function getAllTasks(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("task:") === 0 && state[k] && state[k].c){
        list.push({id: k.slice(5), c: state[k].c, t: state[k].t});
      }
    });
    list.sort(function(a,b){ return a.t - b.t; });
    return list;
  }
  function getTaskById(id){
    var rec = state["task:" + id];
    if(!rec || !rec.c) return null;
    return {id: id, c: rec.c, t: rec.t};
  }
  function saveTaskData(id, data){
    var rec = state["task:" + id];
    var t = (rec && typeof rec.t === "number") ? rec.t : Date.now();
    state["task:" + id] = {c: data, t: t};
    saveLocalState();
    scheduleCloudPush();
  }
  function createTask(tab){
    var id = genTaskId();
    // на вкладке Red своего хранилища нет (см. пояснение выше) — такая
    // задача реально уходит в inbox, но сразу получает красную отметку,
    // поэтому продолжает быть видна на Red
    var homeTab = (tab === "red") ? "inbox" : tab;
    var flag = (tab === "red") ? "red" : null;
    saveTaskData(id, {text: "", tab: homeTab, checked: false, checkedAt: null, completionKey: null, nextForProjectId: null, flag: flag});
    return id;
  }
  // как createTask, но сразу с готовым текстом — для массового
  // восстановления задач из .txt (см. renderSettingsTabImportFile)
  function createTaskWithText(tab, text){
    var id = genTaskId();
    var homeTab = (tab === "red") ? "inbox" : tab;
    var flag = (tab === "red") ? "red" : null;
    saveTaskData(id, {text: text, tab: homeTab, checked: false, checkedAt: null, completionKey: null, nextForProjectId: null, flag: flag});
    return id;
  }
  // Задача, отмеченная "[x]" прямо в "Моём блокноте" (см. TaskActionsWidget
  // в mdeditor.js) — создаётся СРАЗУ уже закрытой, той же записью в архиве,
  // что получилась бы, отметь пользователь галочку у обычной задачи (см.
  // checkTaskDone ниже): текст + отметка времени сохраняются ещё и в
  // отдельную запись "taskcompletion:...", как и у неё. "Домашняя" вкладка
  // значения не имеет (архив общий для всех вкладок), поэтому всегда inbox.
  function createArchivedTaskWithText(text){
    var id = genTaskId();
    var ts = Date.now();
    var completionKey = "taskcompletion:" + ts + "-" + Math.random().toString(36).slice(2,7);
    state[completionKey] = {c: {text: text || "Без названия", tab: "inbox"}, t: ts};
    saveTaskData(id, {text: text, tab: "inbox", checked: true, checkedAt: ts, completionKey: completionKey, nextForProjectId: null, flag: null});
    return id;
  }
  function getTasksForTab(tab){
    if(tab === "red"){
      // витрина: любая незакрытая задача с красной/жёлтой отметкой, из
      // какой бы вкладки она ни была — плюс на всякий случай задачи с
      // «настоящим» tab==="red" (могли остаться из более старой версии
      // данных, когда red ещё была обычным местом хранения)
      return getAllTasks().filter(function(t){
        if(t.c.checked === true) return false;
        return t.c.tab === "red" || t.c.flag === "red" || t.c.flag === "yellow";
      }).sort(function(a,b){
        var pa = a.c.flag === "red" ? 0 : 1;
        var pb = b.c.flag === "red" ? 0 : 1;
        if(pa !== pb) return pa - pb;
        return b.t - a.t;
      });
    }
    return getAllTasks().filter(function(t){ return t.c.tab === tab && t.c.checked !== true; })
      .sort(function(a,b){ return b.t - a.t; });
  }
  function getArchivedTasksAll(){
    return getAllTasks().filter(function(t){ return t.c.checked === true; })
      .sort(function(a,b){ return (b.c.checkedAt||0) - (a.c.checkedAt||0); });
  }
  // задача во вкладке "projects" считается "без next", если для неё нет ни
  // одной незакрытой (не отмеченной) задачи во вкладке "next", ссылающейся
  // на неё через nextForProjectId — как только такая next-задача отмечена
  // и уходит в архив, проект автоматически снова подсвечивается красным
  function projectHasActiveNext(projectId){
    return getAllTasks().some(function(t){
      return t.c.tab === "next" && t.c.checked !== true && t.c.nextForProjectId === projectId;
    });
  }
  function setTaskText(id, text){
    var task = getTaskById(id);
    if(!task) return;
    task.c.text = text;
    saveTaskData(id, task.c);
  }
  function moveTaskToTab(id, newTab){
    var task = getTaskById(id);
    if(!task || task.c.tab === newTab) return;
    task.c.tab = newTab;
    if(newTab !== "next") task.c.nextForProjectId = null;
    saveTaskData(id, task.c);
  }
  // цветная отметка слева от чекбокса: нет отметки → red → yellow → нет
  // отметки. Возвращает новое значение (null/"red"/"yellow").
  function cycleTaskFlag(id){
    var task = getTaskById(id);
    if(!task) return null;
    var order = [null, "red", "yellow"];
    var idx = order.indexOf(task.c.flag || null);
    var next = order[(idx + 1) % order.length];
    task.c.flag = next;
    saveTaskData(id, task.c);
    return next;
  }
  function checkTaskDone(id){
    var task = getTaskById(id);
    if(!task || task.c.checked) return;
    var ts = Date.now();
    var completionKey = "taskcompletion:" + ts + "-" + Math.random().toString(36).slice(2,7);
    state[completionKey] = {c: {text: task.c.text || "Без названия", tab: task.c.tab}, t: ts};
    task.c.checked = true;
    task.c.checkedAt = ts;
    task.c.completionKey = completionKey;
    saveTaskData(id, task.c);
  }
  function restoreTaskFromArchive(id){
    var task = getTaskById(id);
    if(!task || !task.c.checked) return;
    if(task.c.completionKey){
      state[task.c.completionKey] = {c: null, t: Date.now()};
    }
    task.c.checked = false;
    task.c.checkedAt = null;
    task.c.completionKey = null;
    saveTaskData(id, task.c);
  }
  // полное удаление задачи из архива — без диалога подтверждения (как и
  // просили). Тушим саму запись задачи (c:null, как и везде в этом файле
  // для "мягкого" удаления — ключ остаётся, но getAllTasks/getTaskById
  // её больше не видят), а заодно и её запись в "taskcompletion:…", если
  // она есть — иначе отметка о выполнении осталась бы навсегда висеть в
  // "Карте дней года", хотя самой задачи уже нет.
  function deleteTaskPermanently(id){
    var task = getTaskById(id);
    if(!task) return;
    if(task.c.completionKey){
      state[task.c.completionKey] = {c: null, t: Date.now()};
    }
    state["task:" + id] = {c: null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  // выполненные задачи по дням (ключи "taskcompletion:", не удаляются —
  // используются и в детализации дня "Карты дней года", и в экспорте)
  function getTaskCompletionsByDay(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("taskcompletion:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c) return;
      var day = startOfDay(rec.t);
      (byDay[day] = byDay[day] || []).push(rec.c);
    });
    return byDay;
  }

  // ===================== ЛИЧНЫЕ КОММЕНТАРИИ (шапка / вкладка "комментарии") =====================
  // Список во вкладке "Добавить кастомный комментарий" устроен как список
  // задач ("comment:<id>", мягкое удаление через c:null — та же схема,
  // что и у task:, см. getAllTasks/deleteTaskPermanently выше), но без
  // переноса и отметки "выполнено": только карандаш (редактирование с
  // автосохранением по потере фокуса) и крестик (безвозвратное удаление,
  // как в архиве задач).
  //
  // При первом сохранении непустого текста комментарий один раз копируется
  // в "Карту дней года" на день своего создания (yearcomment:<деньСоздания>-
  // <rand>, см. ниже) — это НЕЗАВИСИМАЯ копия: дальнейшее редактирование
  // или удаление записи здесь, во вкладке комментариев, эту копию больше
  // не трогает. Чтобы убрать запись из "Карты дней года", нужно открыть
  // именно этот день и удалить её там (см. renderYearCustomCommentsSection).
  function genCommentId(){
    return "cm" + Date.now() + Math.random().toString(36).slice(2,7);
  }
  function getAllComments(){
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("comment:") === 0 && state[k] && state[k].c){
        list.push({id: k.slice(8), c: state[k].c, t: state[k].t});
      }
    });
    list.sort(function(a,b){ return b.t - a.t; });
    return list;
  }
  function getCommentById(id){
    var rec = state["comment:" + id];
    if(!rec || !rec.c) return null;
    return {id: id, c: rec.c, t: rec.t};
  }
  function saveCommentData(id, data, createdAt){
    var rec = state["comment:" + id];
    var t = (rec && typeof rec.t === "number") ? rec.t : (createdAt || Date.now());
    state["comment:" + id] = {c: data, t: t};
    saveLocalState();
    scheduleCloudPush();
  }
  function createComment(){
    var id = genCommentId();
    saveCommentData(id, {text: "", createdDayTs: startOfDay(Date.now()), yearCopied: false});
    return id;
  }
  function setCommentText(id, text){
    var comment = getCommentById(id);
    if(!comment) return;
    comment.c.text = text;
    var trimmed = (text || "").trim();
    if(trimmed && !comment.c.yearCopied){
      createYearCommentCopy(comment.c.createdDayTs, trimmed);
      comment.c.yearCopied = true;
    }
    saveCommentData(id, comment.c);
    refreshHeaderQuote();
  }
  // безвозвратное удаление — не трогает уже сделанную копию в "Карте дней
  // года" (см. пояснение выше)
  function deleteCommentPermanently(id){
    state["comment:" + id] = {c: null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshHeaderQuote();
  }

  // ---- независимые копии в "Карте дней года" ("yearcomment:<деньСоздания>-<rand>") ----
  function genYearCommentId(dayTs){
    return "yearcomment:" + dayTs + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  }
  function createYearCommentCopy(dayTs, text){
    var key = genYearCommentId(dayTs);
    state[key] = {c: {text: text}, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshYearGridIfOpen();
    return key;
  }
  function getYearCommentsForDay(dayTs){
    var prefix = "yearcomment:" + dayTs + "-";
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf(prefix) !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c || !rec.c.text) return;
      list.push({key: k, text: rec.c.text, t: rec.t});
    });
    list.sort(function(a,b){ return a.t - b.t; });
    return list;
  }
  function setYearCommentText(key, text){
    var trimmed = (text || "").trim();
    var rec = state[key];
    var t = (rec && typeof rec.t === "number") ? rec.t : Date.now();
    state[key] = {c: (trimmed ? {text: trimmed} : null), t: t};
    saveLocalState();
    scheduleCloudPush();
  }
  function deleteYearCommentPermanently(key){
    state[key] = {c: null, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  // все копии-комментарии по дням — для экспорта (см. buildExportData)
  function getYearCommentsByDayAll(){
    var byDay = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("yearcomment:") !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c || !rec.c.text) return;
      var rest = k.slice("yearcomment:".length);
      var day = Number(rest.split("-")[0]);
      (byDay[day] = byDay[day] || []).push(rec.c.text);
    });
    return byDay;
  }

  // ===================== ВКЛАДКА "КОММЕНТАРИИ" (extra2): ОТРИСОВКА =====================
  // Значок-иконка (речевое облако) для язычка вкладки, когда функция
  // включена — тот же визуальный язык (контур, currentColor), что и у
  // остальных пиктограмм вкладок.
  var COMMENT_TAB_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5z"></path><path d="M8 10h8"></path><path d="M8 13h5"></path></svg>';
  var REVIEW_TAB_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19V10"></path><path d="M12 19V5"></path><path d="M19 19v-7"></path></svg>';
  var CROSS_SMALL_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>';

  // extra3 — вкладка "Обзор" (см. renderReviewTab) — постоянная, галочки в
  // настройках не требует, поэтому иконка/подпись задаются один раз при
  // загрузке (см. вызов в самом низу файла)
  function refreshExtra3TabAppearance(){
    var btn = document.getElementById("settingsTabExtra3Btn");
    if(!btn) return;
    btn.title = "Обзор";
    btn.innerHTML = REVIEW_TAB_ICON_SVG;
  }

  // Меняет вид язычка extra2 в зависимости от галочки "Включить личные
  // комментарии…" — вызывается при загрузке страницы и сразу после
  // переключения галочки (см. renderSettingsTabGear).
  function refreshExtra2TabAppearance(){
    var btn = document.getElementById("settingsTabExtra2Btn");
    if(!btn) return;
    if(getCustomCommentsEnabled()){
      btn.title = "Добавить кастомный комментарий";
      btn.innerHTML = COMMENT_TAB_ICON_SVG;
    } else {
      btn.title = "";
      btn.innerHTML = "";
    }
  }

  function renderCommentsTab(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var comments = getAllComments();
    var rowsHtml = comments.map(function(c){ return buildCommentRowHtml(c); }).join("");
    container.innerHTML =
      '<div class="task-list" id="commentListWrap">' + rowsHtml + '</div>' +
      (comments.length === 0 ? '<div class="task-empty">Здесь пока нет комментариев.</div>' : '');
    comments.forEach(function(c){ renderCommentRowView(c.id); });

    var fab = document.getElementById("taskAddFab");
    if(fab){
      fab.onclick = function(){
        flushPendingCommentEdits();
        var id = createComment();
        var wrap = document.getElementById("commentListWrap");
        if(wrap){
          var emptyMsg = document.querySelector(".task-empty");
          if(emptyMsg) emptyMsg.remove();
          var holder = document.createElement("div");
          holder.innerHTML = buildCommentRowHtml(getCommentById(id));
          wrap.insertBefore(holder.firstChild, wrap.firstChild);
          renderCommentRowEdit(id);
        } else {
          renderCommentsTab();
          requestAnimationFrame(function(){ renderCommentRowEdit(id); });
        }
      };
    }
  }

  function buildCommentRowHtml(comment){
    return '<div class="task-row" data-id="' + comment.id + '">' +
      '<div class="task-body" data-id="' + comment.id + '"></div>' +
      '</div>';
  }

  function renderCommentRowView(id){
    var body = document.querySelector('#commentListWrap .task-body[data-id="' + id + '"]');
    var comment = getCommentById(id);
    if(!body || !comment) return;
    var textHtml = comment.c.text ? linkifyHtml(comment.c.text) : '<span class="task-text-placeholder">Новый комментарий</span>';
    body.innerHTML =
      '<span class="task-text-view">' + textHtml + '</span>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn comment-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn comment-delete-btn" title="Удалить">' + CROSS_SMALL_ICON_SVG + '</button>' +
      '</span>';
    body.querySelector(".comment-edit-btn").addEventListener("click", function(){ renderCommentRowEdit(id); });
    body.querySelector(".comment-delete-btn").addEventListener("click", function(){
      deleteCommentPermanently(id);
      renderCommentsTab();
    });
  }

  function renderCommentRowEdit(id){
    var body = document.querySelector('#commentListWrap .task-body[data-id="' + id + '"]');
    var comment = getCommentById(id);
    if(!body || !comment) return;
    flushPendingCommentEdits();
    body.innerHTML =
      '<div class="task-editable" id="commentEditable_' + id + '" contenteditable="true" data-comment-id="' + id + '"></div>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn comment-delete-btn" title="Удалить">' + CROSS_SMALL_ICON_SVG + '</button>' +
      '</span>';
    var editable = document.getElementById("commentEditable_" + id);
    if(!editable) return;
    var textNode = document.createTextNode(comment.c.text ? comment.c.text : EMPTY_ANCHOR_CHAR);
    editable.appendChild(textNode);

    function updatePlaceholder(){
      var empty = getEditableNoteText(editable).length === 0;
      editable.classList.toggle("is-empty", empty);
    }
    updatePlaceholder();

    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", updatePlaceholder);
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    editable.addEventListener("blur", function(){
      setTimeout(function(){
        if(!editable.isContentEditable || !document.body.contains(editable)) return;
        var newText = getEditableNoteText(editable);
        setCommentText(id, newText.trim());
        renderCommentRowView(id);
      }, 0);
    });

    body.querySelector(".comment-delete-btn").addEventListener("click", function(){
      deleteCommentPermanently(id);
      renderCommentsTab();
    });
  }

  // если в момент ухода со вкладки комментариев/закрытия окна настроек
  // какая-то строка была в режиме редактирования — сохраняем введённый
  // текст без явного действия пользователя (та же идея, что и у
  // flushPendingTaskEdits/flushPendingYearDayNoteEdit)
  function flushPendingCommentEdits(){
    var editables = document.querySelectorAll(".task-editable[data-comment-id]");
    Array.prototype.forEach.call(editables, function(editable){
      if(!editable.isContentEditable) return;
      var id = editable.getAttribute("data-comment-id");
      if(!id) return;
      var newText = getEditableNoteText(editable);
      setCommentText(id, newText.trim());
    });
  }

  // ===================== ВКЛАДКА "ОБЗОР" (extra3) =====================
  // Всегда доступна (без отдельной галочки в настройках) — три периода
  // (неделя/месяц/3 месяца), переключаемые пилюлями внизу вкладки. При
  // каждом открытии вкладки выбор сбрасывается на "1 нед." (см.
  // renderReviewTab). Показываются только цифры — если по какому-то
  // показателю за период нет данных, строка просто не выводится.
  var REVIEW_PERIODS = [
    {key:"week", label:"1 нед."},
    {key:"month", label:"1 мес."},
    {key:"quarter", label:"3 мес."}
  ];
  var reviewSelectedPeriod = "week";

  function getReviewPeriodStart(period){
    var d = new Date();
    d.setHours(0,0,0,0);
    if(period === "week") d.setDate(d.getDate() - 7);
    else if(period === "month") d.setMonth(d.getMonth() - 1);
    else d.setMonth(d.getMonth() - 3);
    return d.getTime();
  }

  // ключи прочитанных глав имеют вид "Книга|Глава" (см. chapterKey выше) —
  // это единственный тип ключей в state с символом "|", поэтому его
  // достаточно для отличия от task:/comment:/hourlog: и т.п.
  function getChaptersReadCountSince(startTs){
    var count = 0;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(rec && rec.c === true && typeof rec.t === "number" && rec.t >= startTs) count++;
    });
    return count;
  }
  function getGoalCompletionsCountSince(startTs){
    var count = 0;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("goalcompletion:") === 0 && state[k] && typeof state[k].t === "number" && state[k].t >= startTs) count++;
    });
    return count;
  }
  // сырые "hourlog:" хранятся ~месяц (см. pruneOldHourLogsForStats), но НЕ
  // удаляются сразу при закрытии месячного периода (годовой режим "50
  // часов к сентябрю") — поэтому одни и те же минуты могут быть видны и
  // как "сырые" записи, и как уже закрытый сегмент "hoursegment:" за тот
  // же период. Чтобы не посчитать их дважды, "сырые" записи учитываются
  // только начиная с даты открытия ТЕКУЩЕГО периода (getMonthPeriodStart) —
  // всё, что раньше, уже представлено соответствующим сегментом.
  //
  // "стартовый" день исключения (см. sumHourLogMinutesDayFiltered выше) —
  // применяется и к текущему (ещё не закрытому) периоду "на лету", и к уже
  // закрытым сегментам — для них исключаемая доля посчитана заранее и
  // сохранена в сегменте (см. closeCurrentMonthPeriodWithCarry). Если
  // сегмент был закрыт ДО появления этого правила и .baseline у него нет —
  // пробуем пересчитать по ещё не удалённым сырым записям того периода;
  // если их уже нет, вычесть нечего (ограничение архитектуры — как и с
  // самим pruneOldHourLogsForStats).
  function getHourSegmentBoundaries(){
    var starts = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hoursegment:") === 0){
        var s = Number(k.slice("hoursegment:".length));
        if(!isNaN(s)) starts.push(s);
      }
    });
    var current = getMonthPeriodStart();
    if(current) starts.push(current);
    starts.sort(function(a,b){ return a - b; });
    return starts;
  }
  function getSegmentBaselineMinutes(segStart, segTotal){
    var rec = state["hoursegment:" + segStart];
    if(rec && typeof rec.baseline === "number") return Math.min(rec.baseline, segTotal);
    var boundaries = getHourSegmentBoundaries();
    var idx = boundaries.indexOf(segStart);
    var upper = (idx !== -1 && idx + 1 < boundaries.length) ? boundaries[idx+1] : (getMonthPeriodStart() || (Date.now() + 1));
    return Math.min(sumHourLogMinutesDayFiltered(segStart, upper).baseline, segTotal);
  }
  function getHourMinutesSince(startTs){
    var periodStart = getMonthPeriodStart();
    var rawFrom = periodStart ? Math.max(startTs, periodStart) : startTs;
    var total = sumHourLogMinutesDayFiltered(rawFrom, Date.now() + 1).total;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("hoursegment:") === 0 && state[k] && typeof state[k].c === "number"){
        var segStart = Number(k.slice("hoursegment:".length));
        if(isNaN(segStart) || segStart < startTs) return;
        var seg = state[k].c - getSegmentBaselineMinutes(segStart, state[k].c);
        if(seg > 0) total += seg;
      }
    });
    return total;
  }
  function getArchivedTasksSince(startTs){
    return getArchivedTasksAll().filter(function(t){ return (t.c.checkedAt || 0) >= startTs; });
  }
  // самая частая отметка настроения за период (одно эмодзи, без подписи)
  function getMoodTopEmojiSince(startTs){
    var floor = Math.max(startTs, getMoodDataResetAt());
    var counts = {};
    Object.keys(state).forEach(function(k){
      if(k.indexOf("moodlog:") === 0 && state[k] && typeof state[k].c === "string" && state[k].t >= floor){
        counts[state[k].c] = (counts[state[k].c] || 0) + 1;
      }
    });
    var best = null, bestCount = 0;
    moodCategoriesResolved().forEach(function(cat){
      var c = counts[cat.key] || 0;
      if(c > bestCount){ bestCount = c; best = cat; }
    });
    return best ? best.emoji : null;
  }

  // самая ранняя дата прочтения главы среди всех сохранённых записей —
  // используется, чтобы понять, покрывают ли реальные данные весь
  // выбранный период (неделя/месяц/3 месяца) целиком, а не только его часть
  function getEarliestChapterReadTs(){
    var earliest = null;
    Object.keys(state).forEach(function(k){
      if(k.indexOf("|") === -1) return;
      var rec = state[k];
      if(rec && rec.c === true && typeof rec.t === "number"){
        if(earliest === null || rec.t < earliest) earliest = rec.t;
      }
    });
    return earliest;
  }

  // прогноз: сколько дней предположительно потребуется, чтобы дочитать
  // оставшиеся главы, если сохранять темп чтения за выбранный период
  // (неделя/месяц/3 месяца). Темп = глав прочитано за период / число
  // прошедших дней в периоде; далее — оставшиеся главы делим на темп.
  // Если за период не прочитано ни одной главы, Библия уже дочитана
  // целиком, или реальные данные не покрывают выбранный период целиком
  // (т.е. самая ранняя запись о прочтении новее начала периода — темп
  // считался бы по неполным данным и был бы неточным), прогноз не
  // показывается (как и остальные строки обзора).
  function getBibleForecastDays(period){
    var remaining = TOTAL_CHAPTERS - totalChecked;
    if(remaining <= 0) return null;
    var startTs = getReviewPeriodStart(period);
    var earliest = getEarliestChapterReadTs();
    if(earliest === null || earliest > startTs) return null;
    var elapsedDays = (Date.now() - startTs) / DAY_MS;
    if(elapsedDays <= 0) return null;
    var chaptersRead = getChaptersReadCountSince(startTs);
    if(chaptersRead <= 0) return null;
    var ratePerDay = chaptersRead / elapsedDays;
    if(ratePerDay <= 0) return null;
    return Math.ceil(remaining / ratePerDay);
  }

  function renderReviewTab(){
    reviewSelectedPeriod = "week";
    renderReviewTabContent();
  }
  function renderReviewTabContent(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var startTs = getReviewPeriodStart(reviewSelectedPeriod);

    var rows = [];
    var chaptersCount = getChaptersReadCountSince(startTs);
    if(chaptersCount > 0) rows.push(["Прочитанные главы", chaptersCount]);

    var forecastDays = getBibleForecastDays(reviewSelectedPeriod);
    if(forecastDays !== null) rows.push(["До завершения чтения Библии предположительно", forecastDays + " " + pluralRu(forecastDays, DAY_FORMS)]);

    var goalsCount = getGoalCompletionsCountSince(startTs);
    if(goalsCount > 0) rows.push(["Количество личных целей, которые были достигнуты", goalsCount]);

    var hourMinutes = getHourMinutesSince(startTs);
    if(hourMinutes > 0) rows.push(["Количество часов", formatHHMM(hourMinutes)]);

    var archived = getArchivedTasksSince(startTs);
    if(archived.length > 0) rows.push(["Количество закрытых задач", archived.length]);

    var moodEmoji = getMoodTopEmojiSince(startTs);
    if(moodEmoji) rows.push(["Преобладающее настроение", moodEmoji]);

    var importantClosed = archived.filter(function(t){ return t.c.flag === "red"; }).length;
    if(importantClosed > 0) rows.push(["Количество закрытых важных задач", importantClosed]);

    var projectsDone = archived.filter(function(t){ return t.c.tab === "projects"; }).length;
    if(projectsDone > 0) rows.push(["Количество выполненных проектов", projectsDone]);

    var rowsHtml = rows.length
      ? rows.map(function(r){
          return '<div class="review-stat-row"><span>' + escapeHtml(r[0]) + ':</span><span class="review-stat-value">' + escapeHtml(String(r[1])) + '</span></div>';
        }).join("")
      : '<div class="task-empty">За этот период данных пока нет.</div>';

    var pillsHtml = '<div class="review-pills">' + REVIEW_PERIODS.map(function(p){
      return '<button type="button" class="review-pill' + (p.key === reviewSelectedPeriod ? " active" : "") + '" data-period="' + p.key + '">' + escapeHtml(p.label) + '</button>';
    }).join("") + '</div>';

    container.innerHTML = '<div class="review-stats-list">' + rowsHtml + '</div>' + pillsHtml;

    Array.prototype.forEach.call(container.querySelectorAll(".review-pill"), function(btn){
      btn.addEventListener("click", function(){
        reviewSelectedPeriod = btn.getAttribute("data-period");
        renderReviewTabContent();
      });
    });
  }

  // ===================== ВКЛАДКИ ЗАДАЧ: ОТРИСОВКА =====================
  function renderTaskTabList(tabKey){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var tasks = getTasksForTab(tabKey);
    var rowsHtml = tasks.map(function(t){ return buildTaskRowHtml(t); }).join("");
    container.innerHTML =
      '<div class="task-list" id="taskListWrap">' + rowsHtml + '</div>' +
      (tasks.length === 0 ? '<div class="task-empty">Здесь пока нет задач.</div>' : '');
    tasks.forEach(function(t){ bindTaskRow(t.id, tabKey); });

    var fab = document.getElementById("taskAddFab");
    if(fab){
      // при создании новой задачи НЕ перерисовываем список целиком (это
      // на некоторых мобильных браузерах сбивает фокус: клавиатура
      // открывается, но ввод не попадает в поле) — вместо этого просто
      // добавляем одну новую строку в уже существующий список и сразу
      // переключаем именно её в режим редактирования
      fab.onclick = function(){
        flushPendingTaskEdits(); // не потерять то, что уже набрано в другой строке
        var id = createTask(tabKey);
        var wrap = document.getElementById("taskListWrap");
        if(wrap){
          var emptyMsg = document.querySelector(".task-empty");
          if(emptyMsg) emptyMsg.remove();
          var holder = document.createElement("div");
          holder.innerHTML = buildTaskRowHtml(getTaskById(id));
          wrap.insertBefore(holder.firstChild, wrap.firstChild);
          bindTaskRow(id, tabKey);
          renderTaskRowEdit(id, tabKey);
        } else {
          renderTaskTabList(tabKey);
          requestAnimationFrame(function(){ renderTaskRowEdit(id, tabKey); });
        }
      };
    }
  }

  function buildTaskRowHtml(task){
    return '<div class="task-row" data-id="' + task.id + '">' +
      '<div class="task-body" data-id="' + task.id + '"></div>' +
      '</div>';
  }

  function bindTaskRow(id, tabKey){
    renderTaskRowView(id, tabKey);
  }

  function renderTaskRowView(id, tabKey){
    var body = document.querySelector('.task-body[data-id="' + id + '"]');
    var task = getTaskById(id);
    if(!body || !task) return;
    var isProjectsTab = task.c.tab === "projects";
    var showRed = isProjectsTab && !projectHasActiveNext(id);
    var placeholder = isProjectsTab ? "Новый проект" : "Новая задача";
    var textHtml = task.c.text ? linkifyHtml(task.c.text) : '<span class="task-text-placeholder">' + placeholder + '</span>';
    var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
    body.innerHTML =
      '<span class="task-text-view' + (showRed ? ' task-text-red' : '') + '">' + textHtml + '</span>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + LINK_NEXT_ICON_SVG + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + task.id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
      '</span>';
    body.querySelector(".task-edit-btn").addEventListener("click", function(){ renderTaskRowEdit(id, tabKey); });
    bindTaskRowActions(body, id, tabKey);
  }

  // кнопки переноса/архивации/next-привязки/приоритета — общие для
  // обычного вида строки (renderTaskRowView) и режима редактирования
  // (renderTaskRowEdit): без явной дискеты сохранения текст сохраняется
  // сам (через flushPendingTaskEdits внутри каждого обработчика), поэтому
  // эти кнопки должны работать одинаково в обоих режимах и не пропадать,
  // пока идёт редактирование
  function bindTaskRowActions(body, id, tabKey){
    var task = getTaskById(id);
    if(!task) return;
    // галочка "в архив" — делает ровно то же, что раньше делала отметка
    // чекбокса (снять её обратно можно только извлечением из архива)
    var doneBtn = body.querySelector(".task-done-btn");
    if(doneBtn){
      doneBtn.addEventListener("click", function(){
        flushPendingTaskEdits();
        checkTaskDone(id); // одна и та же задача — закрывается везде разом
        renderTaskTabList(tabKey || task.c.tab);
      });
    }
    var moveBtn = body.querySelector(".task-move-btn");
    if(moveBtn) moveBtn.addEventListener("click", function(){ openTaskMovePicker(id, tabKey); });
    var nextBtn = body.querySelector(".task-next-btn");
    if(nextBtn) nextBtn.addEventListener("click", function(){ openTaskNextPicker(id, tabKey); });
    var dot = body.querySelector(".task-flag-dot");
    if(dot){
      dot.addEventListener("click", function(e){
        e.stopPropagation();
        flushPendingTaskEdits();
        cycleTaskFlag(id);
        // на самой Red набор и порядок строк зависят от отметки, а на
        // остальных вкладках принадлежность к списку от неё не зависит —
        // но проще и надёжнее везде просто перерисовать вкладку целиком
        renderTaskTabList(tabKey || task.c.tab);
      });
    }
  }

  // редактирование текста задачи — без отдельной дискеты сохранения:
  // задача сохраняется сама, как только поле теряет фокус (клик по любой
  // из соседних кнопок — они по-прежнему на месте, см. bindTaskRowActions
  // — или переход в другое место приложения). Кнопки действия
  // (архивировать/перенести/приоритет и т.д.), в отличие от прежнего
  // варианта, во время редактирования не пропадают — только карандашик,
  // ему тут не место, пока и так идёт редактирование.
  function renderTaskRowEdit(id, tabKey){
    var body = document.querySelector('.task-body[data-id="' + id + '"]');
    var task = getTaskById(id);
    if(!body || !task) return;
    flushPendingTaskEdits(); // если в этот момент редактировалась другая строка — сохранить её
    var isProjectsTab = task.c.tab === "projects";
    var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
    body.innerHTML =
      '<div class="task-editable' + (isProjectsTab ? ' task-editable-project' : '') + '" id="taskEditable_' + id + '" contenteditable="true" data-task-id="' + id + '"></div>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + LINK_NEXT_ICON_SVG + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
      '</span>';
    var editable = document.getElementById("taskEditable_" + id);
    if(!editable) return;
    var textNode = document.createTextNode(task.c.text ? task.c.text : EMPTY_ANCHOR_CHAR);
    editable.appendChild(textNode);

    function updatePlaceholder(){
      var empty = getEditableNoteText(editable).length === 0;
      editable.classList.toggle("is-empty", empty);
    }
    updatePlaceholder();

    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", updatePlaceholder);
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    // setTimeout нужен, чтобы клик по соседней кнопке (архив/перенос/
    // приоритет и т.д.) успел сработать раньше, чем мы перерисуем строку
    // обратно в обычный вид — иначе клик попал бы по уже отсоединённому
    // от DOM элементу. Сами эти кнопки уже сохраняют текст самостоятельно
    // (flushPendingTaskEdits в начале своих обработчиков, см.
    // bindTaskRowActions), так что до срабатывания этого таймера строка
    // обычно уже перерисована ими, и здесь просто нечего делать.
    editable.addEventListener("blur", function(){
      setTimeout(function(){
        if(!editable.isContentEditable || !document.body.contains(editable)) return;
        var newText = getEditableNoteText(editable);
        setTaskText(id, newText.trim());
        renderTaskRowView(id, tabKey);
      }, 0);
    });

    bindTaskRowActions(body, id, tabKey);
  }

  // сетка выбора вкладки-назначения — как у выбора цвета цели
  // (openGoalColorPicker), только квадратики с иконками вкладок
  function openTaskMovePicker(id, tabKey){
    var task = getTaskById(id);
    if(!task) return;
    var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
      var isCurrent = key === task.c.tab;
      return '<button type="button" data-tab="' + key + '"' + (isCurrent ? ' class="current"' : '') + '>' +
        TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Перенести задачу") +
      '<div class="task-picker-grid">' + buttons + '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-tab]"), function(btn){
      btn.addEventListener("click", function(){
        var newTab = btn.getAttribute("data-tab");
        moveTaskToTab(id, newTab);
        closeModal();
        // возвращаемся туда, где реально была открыта карточка (может
        // быть вкладка-витрина Red, а не настоящая домашняя вкладка
        // задачи — см. пояснение у getTasksForTab)
        renderTaskTabList(tabKey || task.c.tab);
      });
    });
  }

  // Тот же пикер выбора вкладки-назначения, что и openTaskMovePicker выше,
  // но БЕЗ привязки к уже существующей задаче — используется переносом
  // задачи "- [ ] текст" из "Моего блокнота" (см. TaskActionsWidget в
  // mdeditor.js): задачи с таким id ещё нет, она создаётся заново, с нуля,
  // в момент выбора вкладки. Перенос ОДНОСТОРОННИЙ: сама заметка не
  // меняется, и обратно с получившейся задачей никак не связана — после
  // переноса это уже независимые друг от друга записи (см. ТЗ).
  function openTaskMoveTargetPicker(text){
    var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
      return '<button type="button" data-tab="' + key + '">' +
        TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
    }).join("");
    modalBox.innerHTML =
      modalHeader("Перенести задачу") +
      '<div class="task-picker-grid">' + buttons + '</div>';
    bindClose();
    modalOverlay.classList.add("open");
    Array.prototype.forEach.call(modalBox.querySelectorAll("[data-tab]"), function(btn){
      btn.addEventListener("click", function(){
        var newTab = btn.getAttribute("data-tab");
        createTaskWithText(newTab, text);
        closeModal();
      });
    });
  }

  // выбор next-действия для задачи-проекта: список текущих незакрытых
  // задач вкладки "next", ещё не привязанных к другому проекту, плюс
  // возможность сразу создать новую next-задачу, привязанную к этому проекту
  // "Все задачи проекта" (кнопка-цепочка на строке проекта) — не
  // отдельное всплывающее окно, а замена содержимого прямо в
  // #settingsTabContent (тот же приём, что и у "Версий", см.
  // renderSettingsTabVersions выше). Отдельной кнопки "назад" нет —
  // возврат к списку проектов происходит так же, как и вход сюда: через
  // повторный клик по язычку "Projects" (switchSettingsTab("projects")
  // безусловно перерисовывает список проектов поверх этого экрана).
  function openTaskNextPicker(projectId, tabKey){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;

    var mode = "linked"; // "linked" — обычный вид (проект + next-задачи),
                          // "attach" — выбор существующей задачи для привязки

    function getLinkedTasks(){
      return getTasksForTab("next").filter(function(t){ return t.c.nextForProjectId === projectId; });
    }
    // "доступные" — любая незакрытая задача, ещё не привязанная ни к
    // одному проекту, из ЛЮБОЙ вкладки-хранилища, кроме "projects" (сам
    // проект не может быть next-действием для другого проекта)
    function getAvailableTasks(){
      return getAllTasks().filter(function(t){
        return t.c.checked !== true && t.c.tab !== "projects" && !t.c.nextForProjectId;
      });
    }

    // ---------- сверху всегда сам проект, ниже — либо привязанные к нему
    // next-задачи (обычный режим), либо список для привязки существующей
    // задачи (режим "attach", включается кнопкой-звеном). Задачи из
    // других списков в обычном режиме не показываются вовсе — только по
    // явному запросу через кнопку-звено. ---------- */
    function render(){
      flushPendingTaskEdits();
      var projectHtml = '<div class="task-row" data-id="' + projectId + '"><div class="task-body" data-id="' + projectId + '"></div></div>';
      var areaHtml;
      if(mode === "attach"){
        var available = getAvailableTasks();
        var availableHtml = available.map(function(t){
          var label = t.c.text ? escapeHtml(t.c.text) : "Без названия";
          return '<button type="button" class="version-history-item" data-avail-id="' + t.id + '">' + label + '</button>';
        }).join("");
        areaHtml = '<div class="task-list">' + availableHtml + '</div>' +
          (available.length === 0 ? '<div class="task-empty">Нет доступных задач.</div>' : '');
      } else {
        var linked = getLinkedTasks();
        var linkedHtml = linked.map(function(t){
          return '<div class="task-row" data-id="' + t.id + '"><div class="task-body" data-id="' + t.id + '"></div></div>';
        }).join("");
        areaHtml = '<div class="task-list">' + linkedHtml + '</div>' +
          (linked.length === 0 ? '<div class="task-empty">Пока нет задач, привязанных к проекту.</div>' : '');
      }
      container.innerHTML =
        '<div class="year-grid-tab-title" style="margin-bottom:12px;">Все задачи проекта</div>' +
        '<div class="task-project-modal-body">' +
          '<div class="task-list task-project-project-row">' + projectHtml + '</div>' +
          '<div class="task-project-area" id="taskProjectArea">' + areaHtml + '</div>' +
        '</div>' +
        '<button type="button" class="task-project-fab task-project-fab-link' + (mode === "attach" ? " active" : "") + '" id="taskProjectLinkFab" title="Прикрепить существующую задачу">' + LINK_NEXT_ICON_SVG + '</button>' +
        '<button type="button" class="task-project-fab task-project-fab-create" id="taskProjectCreateFab" title="Новая задача">+</button>';

      // глобальная "+" (task-add-fab) относится к обычным вкладкам —
      // здесь вместо неё две свои кнопки, поэтому её прячем; она сама
      // вернётся при выходе (switchSettingsTab выставляет видимость
      // заново для каждой вкладки)
      var globalFab = document.getElementById("taskAddFab");
      if(globalFab) globalFab.classList.remove("visible");

      renderRowView(projectId);
      if(mode !== "attach"){
        getLinkedTasks().forEach(function(t){ renderRowView(t.id); });
      }

      if(mode === "attach"){
        Array.prototype.forEach.call(container.querySelectorAll("[data-avail-id]"), function(btn){
          btn.addEventListener("click", function(){
            flushPendingTaskEdits();
            var aid = btn.getAttribute("data-avail-id");
            var t = getTaskById(aid);
            if(!t) return;
            // задача из любой другой вкладки становится next-действием —
            // физически переезжает во "next" (единственная вкладка, где
            // вообще работает nextForProjectId) и сразу привязывается
            if(t.c.tab !== "next") moveTaskToTab(aid, "next");
            var updated = getTaskById(aid);
            updated.c.nextForProjectId = projectId;
            saveTaskData(aid, updated.c);
            mode = "linked";
            render();
          });
        });
      }

      document.getElementById("taskProjectLinkFab").addEventListener("click", function(){
        flushPendingTaskEdits();
        mode = (mode === "attach") ? "linked" : "attach";
        render();
      });

      document.getElementById("taskProjectCreateFab").addEventListener("click", function(){
        flushPendingTaskEdits();
        var nid = createTask("next");
        var t = getTaskById(nid);
        t.c.nextForProjectId = projectId;
        saveTaskData(nid, t.c);
        mode = "linked";
        render();
        renderRowEdit(nid);
      });
    }

    // строка привязанной задачи (и сама строка проекта наверху) — те же
    // пиктограммы и та же логика, что и у обычной строки задачи
    // (renderTaskRowView/bindTaskRowActions), только каждое действие
    // вместо перерисовки вкладки настроек перерисовывает этот же экран
    // (render)
    function renderRowView(id){
      var body = document.querySelector('.task-body[data-id="' + id + '"]');
      var task = getTaskById(id);
      if(!body || !task) return;
      var textHtml = task.c.text ? linkifyHtml(task.c.text) : '<span class="task-text-placeholder">Новая задача</span>';
      var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
      body.innerHTML =
        '<span class="task-text-view">' + textHtml + '</span>' +
        '<span class="task-actions">' +
          '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
          '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
        '</span>';
      body.querySelector(".task-edit-btn").addEventListener("click", function(){ renderRowEdit(id); });
      bindRowActions(body, id);
    }

    // кнопки архива/переноса/приоритета — общие для обычного вида и
    // режима редактирования, чтобы они не пропадали, пока идёт ввод
    // текста (см. renderRowEdit)
    function bindRowActions(body, id){
      var doneBtn = body.querySelector(".task-done-btn");
      if(doneBtn){
        doneBtn.addEventListener("click", function(){
          flushPendingTaskEdits();
          checkTaskDone(id);
          render();
        });
      }
      var moveBtn = body.querySelector(".task-move-btn");
      if(moveBtn) moveBtn.addEventListener("click", function(){ openRowMovePicker(id); });
      var dot = body.querySelector(".task-flag-dot");
      if(dot){
        dot.addEventListener("click", function(e){
          e.stopPropagation();
          flushPendingTaskEdits();
          cycleTaskFlag(id);
          renderRowView(id);
        });
      }
    }

    // редактирование текста — без отдельной дискеты: текст сохраняется
    // сам, как только поле теряет фокус (клик по соседней кнопке — они
    // никуда не пропадают, см. bindRowActions — или уход с экрана).
    function renderRowEdit(id){
      var body = document.querySelector('.task-body[data-id="' + id + '"]');
      var task = getTaskById(id);
      if(!body || !task) return;
      flushPendingTaskEdits();
      var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
      body.innerHTML =
        '<div class="task-editable" id="taskEditable_' + id + '" contenteditable="true" data-task-id="' + id + '"></div>' +
        '<span class="task-actions">' +
          '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
          '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
        '</span>';
      var editable = document.getElementById("taskEditable_" + id);
      if(!editable) return;
      var textNode = document.createTextNode(task.c.text ? task.c.text : EMPTY_ANCHOR_CHAR);
      editable.appendChild(textNode);

      function updatePlaceholder(){
        var empty = getEditableNoteText(editable).length === 0;
        editable.classList.toggle("is-empty", empty);
      }
      updatePlaceholder();

      editable.focus();
      var range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      editable.addEventListener("input", updatePlaceholder);
      editable.addEventListener("keydown", function(e){
        if(e.key === "Enter"){
          e.preventDefault();
          document.execCommand("insertText", false, "\n");
        }
      });

      editable.addEventListener("blur", function(){
        setTimeout(function(){
          if(!editable.isContentEditable || !document.body.contains(editable)) return;
          var newText = getEditableNoteText(editable);
          setTaskText(id, newText.trim());
          renderRowView(id);
        }, 0);
      });

      bindRowActions(body, id);
    }

    // "Перенести" для привязанной задачи — та же сетка вкладок, что и
    // openTaskMovePicker (маленькая всплывающая модалка, как и везде в
    // приложении), но после выбора возвращает не к вкладке настроек, а
    // обратно к этому же экрану "Все задачи проекта"
    function openRowMovePicker(id){
      var task = getTaskById(id);
      if(!task) return;
      var buttons = TASK_MOVE_TARGET_TABS.map(function(key){
        var isCurrent = key === task.c.tab;
        return '<button type="button" data-tab="' + key + '"' + (isCurrent ? ' class="current"' : '') + '>' +
          TASK_MOVE_ICON_SVG(key) + '<span>' + escapeHtml(TASK_TAB_TITLES[key]) + '</span></button>';
      }).join("");
      modalBox.innerHTML =
        modalHeader("Перенести задачу") +
        '<div class="task-picker-grid">' + buttons + '</div>';
      bindClose();
      modalOverlay.classList.add("open");
      Array.prototype.forEach.call(modalBox.querySelectorAll("[data-tab]"), function(btn){
        btn.addEventListener("click", function(){
          moveTaskToTab(id, btn.getAttribute("data-tab"));
          closeModal();
          render();
        });
      });
    }

    render();
  }

  // ---------- вкладка "архив": последние TASK_ARCHIVE_MAX_SHOWN отмеченных
  // задач, каждая — с чекбоксом (отмечен), стрелочкой извлечения (возвращает
  // задачу туда, где она была до отметки) и крестиком полного удаления
  // (без диалога подтверждения — тушит саму задачу и её запись в "Карте
  // дней года", см. deleteTaskPermanently). Кнопки "+" здесь нет. ----------
  function renderTaskArchiveTab(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var all = getArchivedTasksAll();
    var shown = all.slice(0, TASK_ARCHIVE_MAX_SHOWN);
    var rowsHtml = shown.map(function(t){
      var label = t.c.text ? escapeHtml(t.c.text) : "Без названия";
      return '<div class="task-archive-row" data-id="' + t.id + '">' +
        '<input type="checkbox" class="task-archive-check" checked disabled>' +
        '<span class="task-archive-text">' + label + '</span>' +
        '<button type="button" class="task-restore-btn" data-id="' + t.id + '" title="Извлечь из архива">' + RESTORE_ICON_SVG + '</button>' +
        '<button type="button" class="task-delete-btn" data-id="' + t.id + '" title="Удалить навсегда">' + DELETE_ICON_SVG + '</button>' +
      '</div>';
    }).join("");
    container.innerHTML =
      '<div class="task-list">' + rowsHtml + '</div>' +
      (shown.length === 0 ? '<div class="task-empty">Архив пуст.</div>' : '');
    Array.prototype.forEach.call(container.querySelectorAll(".task-restore-btn"), function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-id");
        restoreTaskFromArchive(id);
        renderTaskArchiveTab();
      });
    });
    Array.prototype.forEach.call(container.querySelectorAll(".task-delete-btn"), function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-id");
        deleteTaskPermanently(id);
        renderTaskArchiveTab();
      });
    });
  }

  // ===================== НАЗАД (единый стек навигации) =====================
  // Раньше у страницы вообще не было записей в истории браузера, поэтому
  // системная кнопка/жест "назад" на Android сразу закрывали окно
  // приложения (WebView/вкладку). Первая версия этой правки решала это
  // ОДНОЙ ловушкой в истории на два оверлея (#modalOverlay и
  // #settingsModalOverlay) — этого хватало, пока "экраном" было ровно
  // одно из двух: открыта модалка или открыто окно настроек целиком.
  //
  // Как только внутри уже открытого окна настроек появился СВОЙ переход,
  // который тоже должен отменяться "назад" — переключение вкладки (в т.ч.
  // ПРОГРАММНОЕ, как при клике по [[ссылке]] в комментарии/задаче/"Карте
  // дней года", см. initAutoFormatting выше), или шаг навигации внутри
  // самой вкладки (папка -> заметка в "Моём блокноте", см. mdeditor.js) —
  // одной ловушки стало не хватать: "назад" либо перехватывался не тем
  // экраном, либо закрывал всё окно настроек целиком, пропуская вкладку,
  // с которой реально был совершён переход. Именно так выглядел баг:
  // переход по ссылке на заметку из другой вкладки, и "назад" вместо
  // возврата на эту вкладку открывал список всех заметок в блокноте.
  //
  // Вместо одной ловушки — общий СТЕК: КАЖДЫЙ переход, который стоит
  // показывать отдельным "экраном" (открытие модалки/настроек,
  // переключение вкладки настроек — см. switchSettingsTab ниже, шаг
  // навигации внутри вкладки — см. mdeditor.js), кладёт в этот стек
  // функцию, восстанавливающую состояние ДО перехода, и одновременно
  // добавляет ОДНУ запись в историю браузера. Системная кнопка/жест
  // "назад" всегда просто снимает верхнюю запись стека и вызывает её —
  // независимо от того, из какой вкладки или какого (в т.ч. ещё не
  // написанного) экрана был совершён переход. Если стек пуст — истории
  // внутри приложения больше нет, и следующее "назад" сработает как
  // обычно (свернёт/закроет приложение) — это ожидаемо и правильно на
  // главном экране чтения, возвращаться больше некуда.
  //
  // ВАЖНО (сохраняется из первой версии этой правки): для приложения,
  // установленного на домашний экран как PWA (standalone), одного
  // pushState() с тем же самым URL оказывается недостаточно — Android
  // иногда всё равно закрывает всё приложение вместо перехода на
  // предыдущую запись, если URL записи совпадает с исходным URL, с
  // которым PWA было запущено. Поэтому каждая запись получает СВОЙ
  // уникальный #hash (реального значения не несёт, нигде в коде
  // location.hash не читается).
  //
  // window.AppNav.push(restoreFn) — публичный вход для ЛЮБОГО места в
  // коде (в т.ч. mdeditor.js и любых будущих вкладок/модулей), которое
  // хочет зарегистрировать свой шаг навигации как отменяемый "назад".
  var navStack = [];
  var navSeq = 0;
  var navBaseUrl = location.pathname + location.search;

  function pushNavState(restoreFn){
    navStack.push(restoreFn);
    navSeq++;
    try{ history.pushState({__navSeq:navSeq}, "", navBaseUrl + "#nav" + navSeq); }catch(e){}
  }
  window.AppNav = { push: pushNavState };

  window.addEventListener("popstate", function(){
    var restoreFn = navStack.pop();
    if(restoreFn){
      try{ restoreFn(); }catch(e){}
    }
    // если стек пуст — ничего не делаем, следующее "назад" сработает как
    // обычно (свернёт/закроет приложение)
  });

  // Открытие #modalOverlay / #settingsModalOverlay по-прежнему ловим через
  // MutationObserver, а не правкой каждого места, которое их открывает —
  // так в общий стек навигации попадает ЛЮБОЕ их открытие, где бы в коде
  // оно ни происходило.
  (function armOverlayNavTraps(){
    function arm(el, restoreFn){
      if(!el) return;
      var wasOpen = el.classList.contains("open");
      new MutationObserver(function(){
        var isOpen = el.classList.contains("open");
        if(isOpen && !wasOpen) pushNavState(restoreFn);
        wasOpen = isOpen;
      }).observe(el, {attributes:true, attributeFilter:["class"]});
    }
    arm(document.getElementById("modalOverlay"), function(){ closeModal(); });
    arm(document.getElementById("settingsModalOverlay"), function(){ closeSettingsModal(); });
  })();

  // ===================== ЗАПУСК =====================
  initQuote();
  initPage();
  ensureFirstReadInitialized();
  updateOverallProgress();
  applyThemeToPage(getCurrentThemeId());
  renderThemeDots();
  initSettingsFabToggle();
  refreshExtra2TabAppearance();
  refreshExtra3TabAppearance();
  updateMissedBanner();
  renderVersionHistory();
  renderHourBars();
  renderHourCounterMenu();
  checkHourBoundaries();
  renderGoalsSection();
  renderAddGoalMenu();
  refreshSettingsTabsVisibility();
  setInterval(function(){ updateOverallProgress(); updateMissedBanner(); checkUpdateSnoozeExpiry(); checkHourBoundaries(); refreshYearGridIfOpen(); }, 30 * 60 * 1000);
  checkUpdateSnoozeExpiry();

})();
