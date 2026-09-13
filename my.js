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
        ["Бытие","Бт",50],["Исход","Исх",40],["Левит","Лв",27],["Числа","Чс",36],["Второзаконие","Вт",34],
        ["Иисус Навин","ИсН",24],["Судей","Сд",21],["Руфь","Рф",4],["1 Самуила","1См",31],["2 Самуила","2См",24],
        ["1 Царей","1Цр",22],["2 Царей","2Цр",25],["1 Летопись","1Лт",29],["2 Летопись","2Лт",36],["Ездра","Езд",10],
        ["Неемия","Не",13],["Эсфирь","Эсф",10],["Иов","Иов",42],["Псалмы","Пс",150],["Притчи","Пр",31],
        ["Экклезиаст","Эк",12],["Песня Соломона","Псн",8],["Исаия","Иса",66],["Иеремия","Иер",52],["Плач Иеремии","Пл",5],
        ["Иезекииль","Иез",48],["Даниил","Дан",12],["Осия","Ос",14],["Иоиль","Ил",3],["Амос","Ам",9],
        ["Авдий","Авд",1],["Иона","Ион",4],["Михей","Мх",7],["Наум","На",3],["Аввакум","Авв",3],
        ["Софония","Сф",3],["Аггей","Аг",2],["Захария","Зх",14],["Малахия","Мл",4]
      ]
    },
    {
      title:"Христианские Греческие Писания",
      books:[
        ["Матфея","Мф",28],["Марка","Мк",16],["Луки","Лк",24],["Иоанна","Ин",21],["Деяния","Де",28],
        ["Римлянам","Рм",16],["1 Коринфянам","1Кр",16],["2 Коринфянам","2Кр",13],["Галатам","Гл",6],["Эфесянам","Эф",6],
        ["Филиппийцам","Фп",4],["Колоссянам","Кл",4],["1 Фессалоникийцам","1Фс",5],["2 Фессалоникийцам","2Фс",3],["1 Тимофею","1Тм",6],
        ["2 Тимофею","2Тм",4],["Титу","Тит",3],["Филимону","Фм",1],["Евреям","Евр",13],["Иакова","Иак",5],
        ["1 Петра","1Пт",5],["2 Петра","2Пт",3],["1 Иоанна","1Ин",5],["2 Иоанна","2Ин",1],["3 Иоанна","3Ин",1],
        ["Иуды","Иуды",1],["Откровение","Отк",22]
      ]
    }
  ];

  var TOTAL_CHAPTERS = 0;
  sections.forEach(function(s){ s.books.forEach(function(b){ TOTAL_CHAPTERS += b[2]; }); });

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
    "Псалмы":["Пс","Псалом"], "Притчи":["Пр","Прит"], "Экклезиаст":["Эк"], "Песня Соломона":["Псн"],
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

  // Полные альтернативные написания названий книг, которые реально
  // встречаются в текстах, но отличаются от канонического имени в
  // sections/BOOK_NUMBERS выше (поэтому не покрываются циклом по
  // Object.keys(BOOK_NUMBERS) чуть выше SIMPLE_STEMS) — например, "Исайя"
  // (с "й") наравне с "Исаия": раньше такое написание вообще не
  // распознавалось как ссылка на Библию (см. ТЗ пользователя от 31.08).
  var ALT_FULL_NAMES = {
    "Исаия":["Исайя"]
  };
  Object.keys(ALT_FULL_NAMES).forEach(function(canonical){
    ALT_FULL_NAMES[canonical].forEach(function(alt){ addAlias(alt, canonical); });
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

  // ===================== ЗАГОЛОВКИ ВСТАВЛЕННЫХ ССЫЛОК =====================
  // Голая ссылка (см. LINKIFY_URL_RE выше) показывается не самим адресом, а
  // человекочитаемым заголовком: для YouTube — настоящее название видео
  // (сеть, официальный oEmbed, без ключей), для jw.org — эвристика по slug
  // в самом URL (без сети), для остального — просто домен (сознательно без
  // сети: проект не использует сторонние CORS-прокси, а свой сервер не
  // держит). autoLinkTitle вызывается синхронно из formatInline/decorateLine
  // (mdeditor.js) на каждую перестройку — поэтому кеш обязателен, а сетевой
  // запрос YouTube асинхронный: до его завершения возвращается временная
  // заглушка (домен), точечное обновление уже отрисованных ссылок — через
  // onLinkTitleResolved (см. initAutoFormatting ниже и registerLinkNode в
  // mdeditor.js).
  //
  // linkTitleCache: href -> {title} (готово) | "pending" (запрос идёт) |
  // "error" (упал, ждёт повтора при следующей успешной синхронизации).
  var linkTitleCache = new Map();
  var linkTitleListeners = [];
  function onLinkTitleResolved(cb){ linkTitleListeners.push(cb); }
  function notifyLinkTitleResolved(href){
    linkTitleListeners.forEach(function(cb){ try{ cb(href); }catch(e){} });
  }

  // ссылки YouTube, у которых oEmbed-запрос упал (сеть недоступна и т.п.) —
  // не голое число, а именно Set самих адресов: чтобы при восстановлении
  // сети знать, ЧТО именно перезапросить (см. retryUnresolvedYoutubeLinks).
  var unresolvedYoutubeLinks = new Set();

  function extractYoutubeId(href){
    var m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i.exec(href);
    return m ? m[1] : null;
  }

  function hostLabel(href){
    try{
      return new URL(href).hostname.replace(/^www\./i, "");
    }catch(e){
      return href;
    }
  }

  // адреса, откуда приходят публикации/статьи — заголовок вытаскивается из
  // самого URL, без сети: обычно это человекочитаемый slug в пути
  // публикации/статьи ("/ru/библиотека/.../название-статьи/") либо параметр
  // "q=" у поисковых ссылок. Хвостовые чисто цифровые сегменты (id
  // публикаций/изданий) отбрасываются — в них нет ничего читаемого.
  //
  // Отдельный случай — ссылки вида "/finder?...&docid=NNNNNNN" (см.
  // scriptureRefLink выше — тем же способом собираются ссылки на главу
  // Библии для открытия в приложении JW Library): единственный
  // идентифицирующий параметр там — чисто цифровой docid, из него без
  // обращения к серверу никакого человекочитаемого заголовка не достать
  // (в отличие от "q=" у поисковых ссылок или slug в пути обычной статьи).
  // Раньше такие ссылки проваливались в общий разбор пути и подписывались
  // как "Finder" (последний сегмент пути) — путает с настоящим заголовком
  // публикации. Подписываем их просто "JW Library" — по названию
  // приложения, в которое они и ведут.
  function publicationTitleFromUrl(href){
    try{
      var u = new URL(href);
      var q = u.searchParams.get("q");
      if(!q && /\/finder$/i.test(u.pathname)) return "JW Library";
      var raw = q || "";
      if(!raw){
        var segs = u.pathname.split("/").filter(Boolean);
        while(segs.length && /^\d+$/.test(segs[segs.length - 1])) segs.pop();
        raw = segs.length ? segs[segs.length - 1] : "";
      }
      if(!raw) return null;
      try{ raw = decodeURIComponent(raw); }catch(e2){}
      raw = raw.replace(/[-_]+/g, " ").trim();
      if(!raw) return null;
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }catch(e){
      return null;
    }
  }

  function autoLinkTitle(href){
    var yid = extractYoutubeId(href);
    if(yid){
      var cached = linkTitleCache.get(href);
      if(cached && cached !== "pending" && cached !== "error") return { text: cached.title };
      ensureYoutubeTitle(href);
      return { text: hostLabel(href) }; // временная заглушка на время загрузки
    }
    if(/(^|\.)jw\.org$/i.test(hostLabel(href))){
      return { text: publicationTitleFromUrl(href) || hostLabel(href) };
    }
    return { text: hostLabel(href) };
  }

  // ВАЖНО: используется fetchWithTimeout, объявленная гораздо ниже по файлу
  // (раздел "ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ") — это безопасно: она объявлена как
  // function-декларация (`function fetchWithTimeout(...)`), а не через var,
  // поэтому поднимается (hoisting) в начало этой же IIFE и доступна здесь
  // независимо от текстового порядка объявлений в файле.
  function ensureYoutubeTitle(href){
    var st = linkTitleCache.get(href);
    if(st && st !== "error") return; // уже получено или запрос уже идёт
    linkTitleCache.set(href, "pending");
    unresolvedYoutubeLinks.delete(href);
    fetchWithTimeout("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(href), {}, 8000)
      .then(function(r){ if(!r.ok) throw new Error("bad_status"); return r.json(); })
      .then(function(data){
        linkTitleCache.set(href, { title: data.title || hostLabel(href) });
        unresolvedYoutubeLinks.delete(href);
        notifyLinkTitleResolved(href);
      })
      .catch(function(){
        linkTitleCache.set(href, "error");
        unresolvedYoutubeLinks.add(href);
        // сама толкает синхронизацию, не дожидаясь, пока её вызовет что-то
        // другое — если оффлайн, scheduleCloudPush сама уйдёт в "offline"
        // внутри doCloudSync без последствий; когда сеть вернётся,
        // существующий слушатель "online" и так вызовет doCloudSync(), а
        // её успех подхватит повтор (см. retryUnresolvedYoutubeLinks и её
        // единственный вызов в doCloudSync).
        scheduleCloudPush();
      });
  }

  // Повторная попытка получить заголовки YouTube-ссылок, упавшие ранее —
  // вызывается ИЗ ОДНОГО МЕСТА: сразу после успешного завершения
  // doCloudSync (см. ниже, ветка "synced").
  function retryUnresolvedYoutubeLinks(){
    if(!unresolvedYoutubeLinks.size) return;
    var hrefs = Array.from(unresolvedYoutubeLinks);
    unresolvedYoutubeLinks.clear();
    hrefs.forEach(function(href){
      linkTitleCache.delete(href); // сброс "error"
      ensureYoutubeTitle(href);
    });
  }

  // Единая функция ИНЛАЙН-форматирования одной строки (без переносов) —
  // ссылки на Библию, [[ссылки на заметки]], обычные URL, **жирный**,
  // *курсив*/_курсив_, ==выделение==. Работает на СЫРОМ (неэкранированном)
  // тексте методом "заявок" — тем же приёмом, что и decorateLine в
  // mdeditor.js: каждый найденный кусок "застолбляет" свой диапазон
  // символов, при пересечении диапазонов побеждает тот, кто заявил его
  // раньше. Порядок сканирования ниже намеренно совпадает с decorateLine
  // (ссылки → **жирный** → ==выделение== → *курсив*) — поэтому, например,
  // [[ссылка]] ВНУТРИ **жирного** не получает своего отдельного
  // оформления, ровно как и в живом просмотре "Моих заметок" (решётки/
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

    // "![[имя]]" — вставленная картинка (задачи/комментарии, кнопка-
    // скрепка, см. initTaskGlobalToolbar ниже) — тот же синтаксис, что и в
    // "Моих заметках". Сканируется ДО [[ссылок на заметки]] ниже — иначе
    // "!" остался бы снаружи как текст, а "[[имя]]" по ошибке стал бы
    // ссылкой на заметку (tryClaim — "кто заявил раньше", см. комментарий
    // к formatInline выше). Рендерит только временный плейсхолдер
    // (.task-img-wrap) — сама картинка (blob-URL из images/ OPFS)
    // подставляется асинхронно отдельной функцией hydrateTaskImages ниже:
    // formatInline синхронная, а чтение файла из OPFS — Promise.
    var imgRe = /!\[\[([^\[\]\n]+)\]\]/g, mImg;
    imgRe.lastIndex = 0;
    while((mImg = imgRe.exec(text))){
      (function(a, b, name){
        tryClaim(a, b, function(){
          return '<span class="task-img-wrap" data-img-name="' + escapeHtml(name) + '">' + PAPERCLIP_ICON_SVG + '</span>';
        });
      })(mImg.index, mImg.index + mImg[0].length, mImg[1].trim());
      if(mImg[0].length === 0) imgRe.lastIndex++;
    }

    // [[ссылки на заметки "Моих заметок"]] — клик обрабатывается ОДНИМ
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
          var info = autoLinkTitle(href);
          return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="auto-link resource-link" data-auto-href="' + escapeHtml(href) + '">' + escapeHtml(info.text) + '</a>';
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
    // зачёркнутый ("~~текст~~") / подчёркнутый ("++текст++" — своё
    // обозначение, в обычном markdown подчёркивания нет) — та же кнопка
    // форматирования, что и в "Моих заметках" (см. wrapEditableSelection
    // ниже и ТЗ пользователя от 31.08).
    scanPair(/~~([^~\n]+?)~~/g, "fmt-strike");
    scanPair(/\+\+([^+\n]+?)\+\+/g, "fmt-underline");
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
  // тот же язык разметки должен выглядеть одинаково и в "Моих заметках", и
  // здесь — включая встроенные картинки "![[имя]]" (см. formatInline выше
  // и кнопка-скрепка в initTaskGlobalToolbar ниже): в отличие от "Моих
  // заметок" (CodeMirror, картинка — во всю ширину отдельным абзацем),
  // здесь она компактная миниатюра ПОСРЕДИ строки обычного текста (см.
  // .task-img-wrap в components.css).
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
  //    поле CodeMirror в "Моих заметках" (там уже СВОЙ отдельный механизм
  //    форматирования и ссылок, см. mdeditor.js — трогать DOM снаружи во
  //    время редактирования CodeMirror нельзя, поломает его модель), и
  //    поля редактирования комментария/задачи/дня года (contenteditable
  //    div, см. renderYearDayNoteEdit и т.п.) — там во время правки лежит
  //    ЧИСТЫЙ текст, который потом считывается обратно; вставленный <a>/
  //    <span> испортил бы его при сохранении;
  //  - "функция часов" (индикатор "4:05 / 10:55" вверху "Моих заметок",
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
      // Кнопки строки задачи/комментария (.task-actions) позиционируются
      // вручную по фактической ширине текста (см. fitTaskActions ниже) —
      // если этот проход что-то поменял в тексте (обернул ссылку короче,
      // чем был сырой URL, скрыл "**"/"[[" markdown и т.п.), уже
      // расставленные кнопки могли остаться под СТАРУЮ, более длинную
      // раскладку строк. Пересчитываем их заново каждый раз — дёшево
      // (пустой .querySelectorAll(".task-body"), если открыта не вкладка
      // задач/архива/комментариев) и не порождает новых mutation-записей
      // для ЭТОГО наблюдателя (тот следит только за childList/
      // characterData, а не за style/attributes).
      refitAllVisibleTaskBodies();
      hydrateTaskImages(root);
    }

    // Асинхронная подстановка картинок, вставленных в задачи/комментарии
    // кнопкой-скрепкой (см. "![[имя]]" в formatInline выше) — тот же
    // принцип, что у "Моих заметок" (loadImageInto в mdeditor.js): сама
    // картинка читается из images/ (OPFS) асинхронно, поэтому formatInline
    // (синхронная функция) рисует только временный плейсхолдер
    // (.task-img-wrap с иконкой скрепки внутри) — эта функция донаходит
    // такие плейсхолдеры и заменяет их на <img>. Вызывается после каждого
    // прохода runPass выше — срабатывает на ЛЮБОЙ вкладке автоматически,
    // тем же MutationObserver, что и остальное инлайн-форматирование.
    // data-img-loaded ставится СРАЗУ, ещё до разрешения промиса — иначе
    // повторный проход (например, от соседней мутации DOM), пока картинка
    // ещё читается, запустил бы для неё второе параллельное чтение того же
    // файла.
    function hydrateTaskImages(scopeRoot){
      if(typeof MdEditor === "undefined" || !MdEditor.getImageBlobUrl) return;
      var wraps = scopeRoot.querySelectorAll('.task-img-wrap[data-img-name]:not([data-img-loaded])');
      for(var i = 0; i < wraps.length; i++){
        (function(wrap){
          var name = wrap.getAttribute("data-img-name");
          wrap.setAttribute("data-img-loaded", "1");
          MdEditor.getImageBlobUrl(name).then(function(url){
            if(!document.body.contains(wrap)) return;
            if(!url){ wrap.classList.add("task-img-missing"); return; }
            wrap.innerHTML = '<img src="' + url + '" alt="' + escapeHtml(name) + '">';
            wrap.classList.add("task-img-loaded");
            wrap.addEventListener("click", function(){ MdEditor.openImageViewer(url, name); });
          });
        })(wraps[i]);
      }
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
    // "Моих заметок": переключает вкладку настроек на "Мои заметки" и
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

    // точечное обновление уже отрисованных ссылок (span/a.resource-link,
    // см. formatInline выше) при получении реального заголовка (сейчас
    // единственный источник — YouTube oEmbed, см. ensureYoutubeTitle) —
    // без этого ссылка так и осталась бы показывать временную заглушку
    // (домен) до следующей полной перерисовки вкладки. Сравнение через
    // getAttribute, а не через CSS-селектор с подставленным URL — избегаем
    // экранирования спецсимволов в селекторе.
    onLinkTitleResolved(function(href){
      var info = linkTitleCache.get(href);
      if(!info || info === "pending" || info === "error") return;
      var els = root.querySelectorAll(".resource-link");
      var changed = false;
      els.forEach(function(el){
        if(el.getAttribute("data-auto-href") === href){ el.textContent = info.title; changed = true; }
      });
      // та же причина, что у refitAllVisibleTaskBodies() в runPass() выше:
      // текст заголовка сменился (заглушка-домен -> настоящее название
      // видео), значит могла смениться и разбивка строк — если это
      // произошло внутри текста задачи/комментария, кнопки нужно
      // переставить заново.
      if(changed) refitAllVisibleTaskBodies();
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
  // Настройка "Скрывать статус бар PWA-приложения" (вкладка настроек,
  // шестерёнка) — как и FAB_VISIBLE_KEY, это локальный флаг конкретного
  // устройства/браузера, не синхронизируется в облако и не попадает в
  // экспорт (статус-бар — свойство экрана этого устройства, а не данных
  // пользователя). Технически включает/выключает Fullscreen API
  // (см. applyStatusBarFullscreen ниже): на Android это реально прячет
  // системный статус-бар; на iOS Fullscreen API для PWA с домашнего экрана
  // почти не работает — там ограничение платформы, обойти нечем.
  var HIDE_STATUS_BAR_KEY = "bibleHideStatusBar_v1";
  function getHideStatusBarEnabled(){
    try{ return localStorage.getItem(HIDE_STATUS_BAR_KEY) === "1"; }catch(e){ return false; }
  }
  function setHideStatusBarEnabled(value){
    try{ localStorage.setItem(HIDE_STATUS_BAR_KEY, value ? "1" : "0"); }catch(e){}
    applyStatusBarFullscreen(value);
  }
  // Сам вызов Fullscreen API. При enable=true пытается войти в полноэкранный
  // режим — вызов должен идти либо из обработчика пользовательского жеста
  // (клик по галочке), либо из armHideStatusBarAutoRetry ниже (первый тап
  // после запуска, если автозапуск при старте страницы браузер заблокировал
  // как жест-независимый вызов). При enable=false выходит из полноэкранного
  // режима, если он был включён.
  function applyStatusBarFullscreen(enable){
    var el = document.documentElement;
    if(enable){
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if(req && !document.fullscreenElement && !document.webkitFullscreenElement){
        try{
          var p = req.call(el);
          if(p && p.catch) p.catch(function(){});
        }catch(e){}
      }
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if(exit && (document.fullscreenElement || document.webkitFullscreenElement)){
        try{ exit.call(document); }catch(e){}
      }
    }
  }
  // Автозапуск при старте приложения (см. "ЗАПУСК" внизу файла) часто
  // не считается "жестом пользователя", и браузер тихо отклоняет
  // requestFullscreen. На этот случай — одноразовый слушатель первого тапа/
  // клика по странице, который довключит полноэкранный режим, если он ещё
  // не сработал. Снимает сам себя после первого срабатывания.
  function armHideStatusBarAutoRetry(){
    if(!getHideStatusBarEnabled()) return;
    function tryOnce(){
      document.removeEventListener("click", tryOnce, true);
      document.removeEventListener("touchend", tryOnce, true);
      if(getHideStatusBarEnabled()) applyStatusBarFullscreen(true);
    }
    document.addEventListener("click", tryOnce, true);
    document.addEventListener("touchend", tryOnce, true);
  }
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

  // ===================== ЗАКЛАДКИ "МОЕГО БЛОКНОТА" (md-заметки) =====================
  // Раньше жили только в IndexedDB (см. mdeditor.js), локально для этого
  // устройства/браузера — теперь синхронизируются в облаке вместе со
  // всеми остальными данными приложения (см. ТЗ пользователя от 01.09),
  // тем же путём и тем же способом, что и переключатели настроек выше:
  // каждое имя заметки — отдельный ключ этого же state с префиксом
  // MD_BOOKMARK_PREFIX (по тому же принципу, что и отдельная глава —
  // отдельный ключ chapterKey выше), поэтому слияние с облаком идёт
  // ПОИМЕННО: закладка, добавленная на одном устройстве между двумя
  // синхронизациями, не теряется из-за закладки, добавленной тем временем
  // на другом. Само наличие заметки ЛОКАЛЬНО на конкретном устройстве
  // (файл может быть ещё не синхронизирован туда через Syncthing) эти
  // функции не проверяют — этим занимается mdeditor.js при отображении
  // списка (см. renderBookmarksScreen там же): закладка на несуществующий
  // локально файл просто не показывается, а не удаляется отсюда.
  var MD_BOOKMARK_PREFIX = "__mdBookmark:";
  function getSyncedBookmarkNames(){
    var names = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf(MD_BOOKMARK_PREFIX) === 0 && state[k] && state[k].c) names.push(k.slice(MD_BOOKMARK_PREFIX.length));
    });
    return names;
  }
  function setSyncedBookmark(name, bookmarked){
    // как и у остальных булевых значений в state (см.
    // setColorMarkEnabled выше) — снятие закладки пишется как {c:false,...},
    // а не удалением ключа: если ключ просто удалить, при следующем
    // слиянии со старой облачной копией (ещё с {c:true,...} и более
    // ранней меткой времени) закладка неожиданно вернулась бы обратно.
    state[MD_BOOKMARK_PREFIX + name] = {c: !!bookmarked, t: Date.now()};
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
  // между ними в switchSettingsTab. "council" — вкладка-список задач,
  // оформлена и работает так же, как next (см. TASK_MOVABLE_TABS/
  // TASK_MOVE_TARGET_TABS ниже); название показывается только в сетке
  // переноса (TASK_TAB_TITLES.council), ТЗ пользователя от 13.09.
  //
  // 13.09 — добавлены две вкладки-заглушки "worktasks"/"jointtasks"
  // (ТЗ пользователя): устроены и работают ТОЧНО так же, как council/next
  // (обычный список задач через общий renderTaskTabList) — "заглушка"
  // здесь означает только то, что у них нет своего особого экрана, как,
  // например, у "Моих книг". Порядок вкладок (см. TASK_MOVABLE_TABS/
  // TASK_MOVE_TARGET_TABS ниже) — по ТЗ пользователя: worktasks — первая,
  // jointtasks — последняя, council переставлена ПОСЛЕ read (была между
  // waiting и read).
  var TASK_TAB_IDS = {
    worktasks: "settingsTabWorkTasksBtn",
    red: "settingsTabRedBtn",
    inbox: "settingsTabInboxBtn",
    next: "settingsTabNextBtn",
    projects: "settingsTabProjectsBtn",
    waiting: "settingsTabWaitingBtn",
    read: "settingsTabReadBtn",
    council: "settingsTabCouncilBtn",
    someday: "settingsTabSomedayBtn",
    jointtasks: "settingsTabJointTasksBtn",
    archive: "settingsTabArchiveBtn"
  };
  var TASK_TAB_TITLES = {
    worktasks: "Work tasks", red: "Red", inbox: "Inbox", next: "Next", projects: "Projects",
    waiting: "Waiting", read: "Read", council: "Council", someday: "Someday",
    jointtasks: "Joint tasks", archive: "Archive"
  };
  // вкладки-списки задач, между которыми можно переносить задачу стрелочкой
  // (без архива — туда задача попадает только через отметку чекбокса).
  // "red" сюда тоже входит — используется, чтобы кнопка "+" показывалась
  // и на вкладке Red (там тоже можно создать задачу напрямую), но САМОЙ
  // "red" в качестве места хранения (реального taskа.c.tab) больше нет:
  // Red — это витрина по цветной отметке (см. TASK_MOVE_TARGET_TABS ниже,
  // getTasksForTab и cycleTaskFlag).
  var TASK_MOVABLE_TABS = ["worktasks","red","inbox","next","projects","waiting","read","council","someday","jointtasks"];

  // Невидимая распорка в конце списка — тем же приёмом, что и на "Карте
  // дней года" (см. year-grid-v-spacer-row выше, ТЗ пользователя от
  // 13.09): приподнимает последнюю карточку списка над плавающими
  // кнопками (+/домик и т.п.), когда список прокручен до самого низа.
  // Используется вкладками задач (renderTaskTabList, включая "Мои
  // проекты"), вкладкой "Комментарии" (renderCommentsTab) и экраном "Все
  // задачи проекта" (openTaskNextPicker, добавлено позже) — везде, где
  // над списком висит .task-add-fab/.task-project-fab-home. Архивная
  // вкладка (renderTaskArchiveTab) не получает её — там этих кнопок нет
  // (archive не входит в TASK_MOVABLE_TABS, см. syncTaskFabRowForTab).
  var TASK_LIST_BOTTOM_SPACER_HTML = '<div class="task-list-bottom-spacer"></div>';

  // Синк ряда кнопок "домик/+/скрепка/Аа/текстовыделитель/Ж" под текущую
  // вкладку задач (ТЗ пользователя от 13.09, расширено 13.09: раньше
  // неактивный домик-заглушка показывался только на списке "Мои проекты",
  // теперь — на любой вкладке задач с этим рядом, чтобы порядок кнопок
  // везде совпадал с "Моим блокнотом", см. mdeditor.js). Показ заглушки —
  // тот же вид, что у активного домика на экране "Все задачи проекта"
  // (READER_HOME_ICON_SVG/.task-project-fab-home), просто не реагирует на
  // клик. Вынесено в отдельную функцию, а не оставлено инлайном в
  // switchSettingsTab, т.к. вызывается ещё и из обработчика "Домика" в
  // openTaskNextPicker (см. там) — та кнопка возвращает к списку проектов
  // через renderTaskTabList("projects") напрямую, минуя switchSettingsTab
  // (сознательно, чтобы не плодить лишний шаг истории), и раньше это
  // оставляло "+" спрятанной (её прячет globalFab в openTaskNextPicker).
  function syncTaskFabRowForTab(tab){
    var addFab = document.getElementById("taskAddFab");
    var isCommentsTab = (tab === "extra2" && getCustomCommentsEnabled());
    var showTaskFab = TASK_MOVABLE_TABS.indexOf(tab) !== -1 || isCommentsTab;
    if(addFab) addFab.classList.toggle("visible", showTaskFab);
    // скрепка/Аа/текстовыделитель/Ж видны в тех же случаях, что и "+" (см.
    // ТЗ пользователя от 31.08 — все стоят в одном ряду с ней).
    var formatWrap = document.getElementById("taskFormatWrap");
    var fontSizeWrap = document.getElementById("taskFontSizeWrap");
    var highlightWrap = document.getElementById("taskHighlightWrap");
    var attachWrap = document.getElementById("taskAttachWrap");
    if(formatWrap) formatWrap.classList.toggle("visible", showTaskFab);
    if(fontSizeWrap) fontSizeWrap.classList.toggle("visible", showTaskFab);
    if(highlightWrap) highlightWrap.classList.toggle("visible", showTaskFab);
    if(attachWrap) attachWrap.classList.toggle("visible", showTaskFab);

    // Заглушка-домик — на любой вкладке задач с рядом кнопок (не на
    // карточке проекта: там openTaskNextPicker рисует свою, кликабельную
    // копию и сам прячет и её, и globalFab). Создаётся один раз лениво и
    // кладётся соседом #taskAddFab (вне #settingsTabContent — переживает
    // innerHTML= списка задач).
    var homeStub = document.getElementById("taskFabHomeStub");
    if(showTaskFab){
      if(!homeStub && addFab && addFab.parentNode){
        homeStub = document.createElement("button");
        homeStub.type = "button";
        homeStub.id = "taskFabHomeStub";
        homeStub.className = "mdeditor-fab-btn task-project-fab-home";
        homeStub.tabIndex = -1;
        homeStub.setAttribute("aria-disabled", "true");
        homeStub.innerHTML = READER_HOME_ICON_SVG;
        addFab.parentNode.insertBefore(homeStub, addFab);
      }
      if(homeStub) homeStub.classList.add("visible");
    } else if(homeStub){
      homeStub.classList.remove("visible");
    }
    // "+" всегда стоит рядом с местом "домика" (right:48, тот же угол,
    // что и на "Все задачи проекта") — сам угол (right:8) везде теперь
    // занят заглушкой-домиком выше.
    if(addFab) addFab.classList.toggle("task-add-fab-shifted", showTaskFab);
  }
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
  // в index.html, .settingsTabsSet2 / .settingsTabsGearSet2). 7 из 14 —
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
  // ЗАГЛУШКА: это вкладка "Мои заметки" — работа с .md заметками
  // в стиле Obsidian (папка через File System Access API, редактор на
  // CodeMirror 6 с decorations, ссылки [[Название]] между заметками), см.
  // renderSettingsTabMdEditor в mdeditor.js и её отдельную ветку в
  // switchSettingsTab ниже, по тому же принципу вынесена ДО общей проверки
  // на renderSettingsTabSet2Stub. set2s_2 (вторая боковая) — ТОЖЕ УЖЕ НЕ
  // ЗАГЛУШКА: это вкладка "Закладки" — список заметок из "Моих заметок"
  // (set2s_1), отмеченных закладкой (долгим нажатием в общем списке или
  // кнопкой в шапке открытой заметки), см. renderSettingsTabMdBookmarks в
  // mdeditor.js и её отдельную ветку в switchSettingsTab ниже, по тому же
  // принципу вынесена ДО общей проверки на renderSettingsTabSet2Stub.
  // set2s_3 (третья боковая) — ЭТО БОЛЬШЕ НЕ ЗАГЛУШКА: это вкладка
  // "Поиск" — два независимых режима, "Поиск по задачам" и "Поиск по
  // заметкам" (переключаются кнопками внизу вкладки), см. search.js
  // (renderSettingsTabSearch) и её отдельную ветку в switchSettingsTab
  // ниже, по тому же принципу вынесена ДО общей проверки на
  // renderSettingsTabSet2Stub (ТЗ пользователя от 08.09).
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
  var TASK_MOVE_TARGET_TABS = ["worktasks","inbox","next","projects","waiting","read","council","someday","jointtasks"];
  var TASK_MOVE_ICONS = {
    red: '<path d="M5 3v18"></path><path d="M5 4h11l-2.5 4L16 12H5"></path>',
    // портфель — вкладка-заглушка "Задачи в работе" / "worktasks" (ТЗ
    // пользователя от 13.09), та же svg, что и в #settingsTabWorkTasksBtn
    // в index.html
    worktasks: '<path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path><rect x="3" y="7" width="18" height="12" rx="2"></rect><path d="M3 12h18"></path>',
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
    someday: '<g transform="rotate(-90 12 12)"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></g>',
    // два человечка — вкладка-заглушка "Совместные задачи" / "jointtasks"
    // (ТЗ пользователя от 13.09), та же svg, что и в
    // #settingsTabJointTasksBtn в index.html; геометрия одного человечка
    // взята из "council" выше, просто уменьшена и сдвоена
    jointtasks: '<circle cx="8" cy="8" r="2.3"></circle><path d="M3.5 19c0-3 2-5.3 4.5-5.3s4.5 2.3 4.5 5.3"></path><circle cx="16" cy="8" r="2.3"></circle><path d="M11.5 19c0-3 2-5.3 4.5-5.3s4.5 2.3 4.5 5.3"></path>',
    // речевой пузырь с тремя точками — используется НЕ как обычная
    // вкладка-список (extra2/"Комментарии" не входит в TASK_MOVE_TARGET_TABS
    // выше, у неё своё, отдельное хранилище, см. openTaskMovePicker/
    // openRowMovePicker ниже, ТЗ пользователя от 13.09), а как
    // дополнительный пункт именно в сетке "Перенести задачу" — там задача
    // не перекладывается, а конвертируется в комментарий
    // (convertTaskToComment ниже). Три точки — тем же приёмом заливки, что
    // и точка над "i" в INFO_ICON_SVG (fill=currentColor, а не линия).
    extra2: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2V6z"></path><circle cx="8.5" cy="10" r="0.9" fill="currentColor" stroke="none"></circle><circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none"></circle><circle cx="15.5" cy="10" r="0.9" fill="currentColor" stroke="none"></circle>'
  };
  // подпись для "Комментарии" в сетке "Перенести задачу" — только там;
  // сама вкладка extra2 (личные комментарии) свою заголовочную надпись
  // берёт из своей разметки (renderCommentsTab), сюда не относится
  TASK_TAB_TITLES.extra2 = "Comments";
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
  // шеврон "вниз" — кнопка "показать полностью"/"свернуть" у длинных
  // задач (.task-expand-btn, см. renderTaskRowView), при развороте
  // переворачивается на 180° через CSS-класс .is-expanded (.task-expand-btn
  // в modals.css), отдельной иконки для свёрнутого состояния не нужно
  var CHEVRON_DOWN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>';
  // пиктограмма "i" в кружке — общая для всего проекта (кнопка
  // "Информация" вкладки "Извлечение субтитров", см. renderSettingsTab-
  // SubtitleExtract ниже; задумана как переиспользуемая и в других
  // вкладках/местах — новые места просто ссылаются на эту же константу).
  var INFO_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M12 11v6"></path><circle cx="12" cy="7.7" r="1" fill="currentColor" stroke="none"></circle></svg>';
  // стрелка вниз в лоток — "скачать" (та же пиктограмма, что и DOWNLOAD_-
  // ICON_SVG в mdeditor.js/«Мои заметки», скопирована сюда, т.к. my.js не
  // имеет доступа к внутренним константам модуля). Пока без функции — кнопка
  // "Скачать" вкладки "Извлечение субтитров" сейчас заглушка (см. ниже).
  var DOWNLOAD_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"></path><path d="M7.5 10.5L12 15l4.5-4.5"></path><path d="M4.5 18.5h15"></path></svg>';
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
  var mainEl = document.querySelector("main");
  var overallFill = document.getElementById("overallFill");
  var overallText = document.getElementById("overallText");
  var bookMeta = {};
  var chapterInputs = {};

  // ===================== КОЛИЧЕСТВО КОЛОНОК ДЛЯ КНИГ =====================
  // Настройка "Количество колонок для книг" (вкладка настроек, шестерёнка,
  // три чекбокса 1/2/3, всегда ровно один активен) — как и
  // HIDE_STATUS_BAR_KEY, это локальный флаг конкретного устройства/браузера
  // (не синхронизируется в облако и не попадает в экспорт): число колонок
  // зависит от физической ширины экрана этого устройства, а не от данных
  // пользователя. Значение применяется как есть, независимо от текущей
  // ширины экрана — а уже CSS (components.css, точка перелома
  // BOOK_COLUMNS_WIDE_MQ) решает, как именно его показать: на широких
  // экранах 2-3 колонки — это обычные полноразмерные карточки книг через
  // CSS multi-column (раскрытие одной книги не тянет соседей по высоте,
  // как было бы в CSS Grid, — следующие книги просто перетекают в соседний
  // столбец, см. .book-card{break-inside:avoid}); минимальная ширина
  // колонки (--book-col-min, computeBookCardMinWidths ниже) подобрана так,
  // что полное название всегда помещается — сокращение здесь не нужно
  // вовсе, а если колонок выбрано больше, чем помещается при этой
  // ширине, CSS сам уменьшит их число. На узких экранах (смартфон) те же
  // 2-3 колонки переключают список в компактную сетку маленьких плиток —
  // полноразмерная карточка туда физически не влезает, поэтому текст
  // .book-name подгоняется по месту (см. АВТОСОКРАЩЕНИЕ НАЗВАНИЙ КНИГ
  // ниже), а минимальная ширина плитки (--book-compact-min) гарантирует,
  // что даже готовое короткое сокращение книги не обрежется дальше самого
  // себя; разворачивание плитки (класс .book-open на .book-card, см.
  // обработчик клика по .book-header ниже) показывает книгу как обычно,
  // во всю ширину.
  var BOOK_COLUMNS_KEY = "bibleBookColumns_v1";
  var BOOK_COLUMNS_WIDE_MQ = "(min-width:860px)";
  function getBookColumnsDefault(){
    var mq = window.matchMedia ? window.matchMedia(BOOK_COLUMNS_WIDE_MQ) : null;
    return (mq && mq.matches) ? 2 : 1;
  }
  function getBookColumns(){
    var v = null;
    try{ v = localStorage.getItem(BOOK_COLUMNS_KEY); }catch(e){}
    if(v === "1" || v === "2" || v === "3") return parseInt(v, 10);
    return getBookColumnsDefault();
  }
  function setBookColumns(n){
    try{ localStorage.setItem(BOOK_COLUMNS_KEY, String(n)); }catch(e){}
    applyBookColumns();
  }
  function applyBookColumns(){
    var n = String(getBookColumns());
    if(mainEl) mainEl.setAttribute("data-book-columns", n);
    requestAnimationFrame(refreshAllBookNameFits);
  }

  // Узкий экран (тот же порог, что и components.css, @media(max-width:859px))
  // + выбрано 2 или 3 колонки — именно тогда включается компактная сетка
  // маленьких плиток (см. комментарий выше про BOOK_COLUMNS_WIDE_MQ).
  // Уровень (full/medium/short) решается ДЛЯ КАЖДОЙ карточки ОТДЕЛЬНО
  // (renderBookNamePerItem) — с 11.09 так делает и широкая сетка тоже, см.
  // "АВТОСОКРАЩЕНИЕ НАЗВАНИЙ КНИГ" ниже; здесь, в компактной сетке, отличие
  // только в allowMedium (см. compactBookGridAllowsMedium ниже — при 3
  // колонках на узком экране medium полностью отключён, а не просто
  // "решается отдельно").
  function isCompactBookGrid(){
    var cols = getBookColumns();
    if(cols !== 2 && cols !== 3) return false;
    var mq = window.matchMedia ? window.matchMedia(BOOK_COLUMNS_WIDE_MQ) : null;
    return !(mq && mq.matches);
  }

  // ===================== АВТОСОКРАЩЕНИЕ НАЗВАНИЙ КНИГ =====================
  // Переписано 11.09, версия 3 (правит версию 2 от 10.09 — см. её мотивацию
  // ниже). Уровень решается для КАЖДОЙ карточки ОТДЕЛЬНО, по её собственной
  // ширине (renderBookNamePerItem) — как в широкой сетке, так и в
  // компактной. Версия 2 (10.09) решала ОДИН уровень на весь грид сразу,
  // по самому длинному названию во всей сетке — сделано было затем, чтобы
  // избежать разнобоя (одновременно полные названия, "слово."-сокращения и
  // голые короткие коды в одной сетке). Но при 3 узких колонках это
  // означало, что единственное длинное название ("1 Фессалоникийцам" и
  // т.п.) утягивало вниз ВСЕ карточки, включая короткие, которым места
  // хватает с запасом ("Быт."/"Исх." вместо "Бытие"/"Исход") — ТЗ от
  // 11.09: "для такой ширины контейнеров должны быть полные названия".
  // Разнобой (часть карточек полные, часть сокращены из-за одного-двух
  // по-настоящему длинных названий) принят как меньшее зло по сравнению со
  // сплошной обрезкой коротких названий там, где им хватает места.
  // Число колонок (кнопки 1/2/3 в настройках) на выбор уровня НЕ влияет
  // напрямую — только косвенно, через то, какой шириной оборачивается
  // бокс книги при разном числе колонок и разном экране.
  //
  //   1) Полное название — показывается, если при ширине СВОЕЙ карточки
  //      её полное название помещается целиком. Кнопка "Показать/Скрыть
  //      прочитанное" рендерится тем же .book-name в том же гриде (см.
  //      addHideProgressButton), но имеет свою отдельную лесенку ступеней
  //      (см. п.4 ниже и renderSkipMediumEntry), а не общее правило
  //      "полное → среднее → короткое" — у неё изначально нет среднего
  //      сокращения в привычном смысле (data-skip-medium).
  //   2) "Среднее" сокращение — только для названий из НЕСКОЛЬКИХ слов:
  //      ужимается РОВНО ОДНО слово (самое длинное), второе слово не
  //      трогается. Обрезка всегда заканчивается на согласной (гласные
  //      "откусываются" с конца) и ставится РОВНО ОДНА точка — например
  //      «1 Фессалоникийцам» → «1 Фессалоникийц.». Двух точек в названии
  //      быть не должно: если сокращения одного слова до минимума всё
  //      равно не хватает, карточка уходит на уровень 3, а не на точку у
  //      второго слова. Для отдельных книг можно задать вручную
  //      "правильный" вид среднего сокращения — см. BOOK_MEDIUM_OVERRIDE.
  //      ТЗ от 10.09 (medium, п.3): однословные названия («Бытие» →
  //      «Быт.», «Филимону» → «Филим.») ТОЖЕ проходят это правило, а не
  //      показывают сразу короткий код — правило "одно слово, одна точка"
  //      тривиально для них, обрезаемое слово всегда единственное.
  //      Элементы без среднего представления (data-skip-medium) —
  //      исключение из общего правила: у кнопки "Показать/Скрыть
  //      прочитанное" своя лесенка готовых ступеней, см.
  //      HIDE_PROGRESS_STEPS_BY_FULL ниже, а не автоматическая обрезка.
  //   3) Готовое короткое сокращение книги (data-abbr, "Бт"/"Исх"/"1См" —
  //      второй элемент в sections[].books[], без точек).
  //
  // Ширина мерится через скрытый DOM-элемент с теми же CSS-свойствами, что
  // и у настоящего .book-name (не canvas.measureText — тот только
  // приближённо имитирует реальный шрифт браузера и иногда занижал
  // ширину на несколько пикселей). Полное название и короткое сокращение
  // хранятся в data-full/data-abbr и не перезаписываются — меняется
  // только видимый textContent.
  var VOWELS_RU = "аеёиоуыэюяАЕЁИОУЫЭЮЯ";
  function isVowelChar(ch){ return VOWELS_RU.indexOf(ch) !== -1; }
  // Обрезает слово до length символов, затем откусывает гласные с конца —
  // обрезка всегда заканчивается на согласной, никогда на гласной.
  function truncateWordToConsonant(word, length){
    var t = word.slice(0, Math.max(length, 1));
    while(t.length > 1 && isVowelChar(t.charAt(t.length - 1))) t = t.slice(0, -1);
    return t;
  }
  // Ручные "правильные" варианты среднего сокращения для отдельных
  // двусловных книг — заполняется точечно, по сообщениям пользователя.
  // Единственное готовое значение (не лесенка, а один фиксированный
  // текст) — на случай, когда нужна ровно одна замена без вариантов по
  // ширине; для лесенки нескольких вариантов см. BOOK_MEDIUM_STEPS сразу
  // под ней. Значение по-прежнему проверяется на fits (см.
  // fitBookNameMedium) — если не влезает, падает в короткий код (abbr),
  // а не показывается насильно.
  //   - "2 Самуила" (ТЗ от 11.09, компактная 2-колоночная сетка,
  //     скриншот пользователя): общая обрезка самого длинного слова
  //     ужимала до "2 Сам." в той же колонке, где "1 Самуила" (слово той
  //     же длины) корректно получало "1 Самуил." — точечно фиксируем тот
  //     же вид.
  var BOOK_MEDIUM_OVERRIDE = {
    "2 Самуила": "2 Самуил."
  };

  // Лесенка ручных вариантов среднего сокращения для двусловных книг, где
  // общее правило ("обрезать только одно, самое длинное слово", см.
  // fitBookNameMedium) не годится:
  //   - "Иисус Навин" — оба слова одной длины (5 букв), общее правило
  //     трогает только первое ("Иисус" → "Иис."), второе слово ("Навин")
  //     никогда не сокращается;
  //   - "Песня Соломона" — общее правило трогает только более длинное
  //     слово ("Соломона" → "Сол."), а "Песня" остаётся нетронутым;
  // в обоих случаях, если минимальный вариант с ОДНИМ обрезанным словом
  // всё равно не помещается, ужать дальше по общему правилу нечем — падает
  // сразу в готовый короткий код. ТЗ пользователя (10.09): для узких плиток
  // нужна собственная лесенка, где укорачивается и второе слово тоже — от
  // самого длинного варианта к самому короткому, перебирается сверху вниз
  // до первого влезающего (та же механика, что у HIDE_PROGRESS_TEXTS.steps
  // выше).
  // "Песня Соломона": первая ступень правилась 11.09 (ТЗ пользователя,
  // скриншот компактной 2-колоночной сетки) — было "Песня Сол." (слово
  // "Соломона" ужато сразу до 3 букв), хотя при этой ширине влезает
  // менее агрессивный вариант "Песня Солом." (5 букв) — заменено.
  var BOOK_MEDIUM_STEPS = {
    "Иисус Навин": ["Иис. Нав.", "Иис. Н."],
    "Песня Соломона": ["Песня Солом.", "Песн. Сол.", "Пес. Сол."]
  };

  // Элементы .book-name в сетке книг, которые НЕ являются книгами из
  // sections[], но рендерятся в том же гриде той же вёрсткой и должны
  // получать тот же общий уровень сокращения — сейчас это ровно один
  // элемент, кнопка "Показать/Скрыть прочитанное" (см.
  // addHideProgressButton). Единый источник её full/abbr-текстов — чтобы
  // не разъезжались значения в разных местах кода и в расчёте порогов
  // (computeBookCardMinWidths) ниже.
  // steps — лесенка ступеней среднего уровня для этой кнопки (ТЗ, раздел
  // "Показать прочитанное"/"Скрыть прочитанное"): в отличие от общего
  // правила книг (обрезается только одно, самое длинное слово), тут могут
  // обрезаться ОБА слова поочерёдно. По убыванию ширины, от самой длинной
  // ступени к самой короткой; первые три варианта — присланные автором,
  // новые ступени заменять/добавлять только по его точечным сообщениям,
  // не придумывать самостоятельно.
  var HIDE_PROGRESS_TEXTS = {
    show: {full:"Показать прочитанное", abbr:"ПП", steps:["Показ. проч.", "Пок. проч.", "Пок. пр."]},
    hide: {full:"Скрыть прочитанное",   abbr:"СП", steps:["Скрыт. проч.", "Скр. проч.", "Скр. пр."]}
  };
  // Лукап ступеней по текущему full-тексту (он переключается между show/
  // hide в textEl.dataset.full, см. toggleHideCompletedBooks) — используется
  // в renderSkipMediumEntry вместо BOOK_MEDIUM_OVERRIDE для этого
  // конкретного элемента (data-skip-medium).
  var HIDE_PROGRESS_STEPS_BY_FULL = {};
  [HIDE_PROGRESS_TEXTS.show, HIDE_PROGRESS_TEXTS.hide].forEach(function(t){
    HIDE_PROGRESS_STEPS_BY_FULL[t.full] = t.steps;
  });

  // Раньше здесь был canvas.measureText — он лишь ПРИБЛИЖЁННО имитирует
  // реальный шрифт браузера, и на практике иногда занижал ширину текста
  // на несколько пикселей (даже с учётом letter-spacing), из-за чего
  // JS считал текст влезающим, а реальный DOM-рендер обрезал последнюю
  // букву прямо по границе бокса. Настоящий скрытый DOM-элемент с теми
  // же CSS-свойствами рендерится ТОЧНО так же, как настоящий .book-name,
  // так что расхождений между "посчитали" и "показали" больше нет.
  var bookNameMeasureProbe = null;
  function measureTextWidth(text, font, letterSpacing){
    if(!bookNameMeasureProbe){
      bookNameMeasureProbe = document.createElement("span");
      var s = bookNameMeasureProbe.style;
      s.position = "absolute";
      s.visibility = "hidden";
      s.pointerEvents = "none";
      s.whiteSpace = "nowrap";
      s.left = "-9999px";
      s.top = "-9999px";
      document.body.appendChild(bookNameMeasureProbe);
    }
    bookNameMeasureProbe.style.font = font;
    bookNameMeasureProbe.style.letterSpacing = letterSpacing || "0px";
    bookNameMeasureProbe.textContent = text;
    return bookNameMeasureProbe.getBoundingClientRect().width;
  }
  // небольшой запас на погрешности субпиксельного округления — уменьшен до
  // 0 (ТЗ от 11.09, седьмой заход: "дать тексту больше свободы подходить
  // к пилюле вплотную"). ВАЖНО: этот margin — реальный корень ВСЕХ жалоб
  // на "лишний зазор"/"слишком тесные отступы" в компактном режиме за
  // 11.09 (заходы 2-6 выше и в components.css) — казавшийся зазор между
  // названием и пилюлей на самом деле создавали не padding/gap, а именно
  // эти отнятые 2px перед подгонкой текста. Пользователь подтвердил
  // результат при 0 — держать на 0, НЕ восстанавливать по своей
  // инициативе. Возвращать (до 1-2px) только если пользователь САМ
  // явно попросит после того, как реально увидит обрезанную пополам
  // букву на устройстве (баг, ради которого margin изначально появился).
  var BOOK_NAME_SAFETY_MARGIN = 0;

  // ТЗ от 11.09 (широкая 3-колоночная раскладка ≥860px, скриншот
  // пользователя): полные "1 Коринфянам"/"2 Коринфянам" реально влезают
  // в эту раскладку (рядом влезают полностью названия той же и большей
  // длины — "Второзаконие", "Филиппийцам"), но не проходили общую
  // проверку full-варианта именно из-за стандартного запаса
  // BOOK_NAME_SAFETY_MARGIN — не трогаем сам общий запас (он защищает от
  // обрезки буквы пополам у ВСЕХ книг), точечно обнуляем его только для
  // проверки full-варианта этих двух названий. На medium/abbr fallback
  // (см. boxWidth в renderBookNamePerItem) это не влияет.
  var BOOK_FULL_SAFETY_OVERRIDE = {
    "1 Коринфянам": 0,
    "2 Коринфянам": 0
  };

  // ТЗ от 10.09 (full-контейнер, п.2): жёсткий потолок ширины одной
  // колонки/карточки книги — НЕ пересчитывается динамически, в отличие от
  // --book-col-min ниже. 358 = 394 (CSS-ширина экрана Poco X6 Pro,
  // эталон) − 36 (main{padding:0 18px} слева+справа), взято по самому
  // длинному тексту сетки — кнопке "Показать прочитанное" (см.
  // HIDE_PROGRESS_TEXTS). При избытке места экран должен получать больше
  // колонок, а не колонки шире этого предела.
  var BOOK_FULL_MAX_WIDTH = 358;

  // Минимальная длина, до которой ужимается ЕДИНСТВЕННОЕ обрезаемое слово
  // уровня 2 (см. комментарий выше) — короче не режем, чтобы не получить
  // мусор вроде "Ч." с точкой на одной букве.
  var BOOK_NAME_MIN_WORD_LEN = 3;
  // Сокращает РОВНО ОДНО слово (самое длинное) из full, пока текст не
  // поместится в avail, либо пока это слово не дойдёт до минимума длины.
  // Остальные слова названия не трогаются — см. правило "одна точка" выше.
  function fitBookNameMedium(full, avail, font, letterSpacing){
    var override = BOOK_MEDIUM_OVERRIDE[full];
    if(override){
      return {text: override, fits: measureTextWidth(override, font, letterSpacing) <= avail};
    }
    var steps = BOOK_MEDIUM_STEPS[full];
    if(steps && steps.length){
      for(var si = 0; si < steps.length; si++){
        if(measureTextWidth(steps[si], font, letterSpacing) <= avail){ return {text: steps[si], fits: true}; }
      }
      return {text: steps[steps.length - 1], fits: false};
    }
    // ТЗ от 10.09 (medium, п.3): однословные названия ("Филимону" →
    // "Филим.") тоже проходят это правило, не только многословные — раньше
    // здесь был ранний выход при words.length<2, убран.
    var words = full.split(" ");
    var idx = 0, longest = words[0].length;
    for(var i = 1; i < words.length; i++){
      if(words[i].length > longest){ longest = words[i].length; idx = i; }
    }
    var minLen = Math.min(BOOK_NAME_MIN_WORD_LEN, words[idx].length);
    function render(len){
      return words.map(function(w, i){
        return (i === idx && len < w.length) ? (truncateWordToConsonant(w, len) + ".") : w;
      }).join(" ");
    }
    var bestText = full, fits = false;
    for(var len = words[idx].length - 1; len >= minLen; len--){
      bestText = render(len);
      if(measureTextWidth(bestText, font, letterSpacing) <= avail){ fits = true; break; }
    }
    return {text: bestText, fits: fits};
  }

  // Динамические минимальные ширины боксов книги — считаются один раз по
  // РЕАЛЬНОМУ шрифту (после того как хотя бы одна карточка уже в DOM) и
  // применяются в components.css через CSS-переменные --book-col-min/
  // --book-compact-min (ТЗ от 10.09, п.1 и п.2; --book-col-min переосмыслен
  // правкой ТЗ от 11.09 — см. components.css, комментарий у @media(min-width:860px)):
  //   --book-col-min — широкий экран (≥860px), полноразмерная карточка:
  //     раньше определял и минимальную ширину, гарантирующую невозможность
  //     обрезки, И число колонок, которое CSS вообще пытался уместить.
  //     Теперь (ТЗ от 11.09) число колонок гарантируется отдельным
  //     фиксированным хинтом (BOOK_COLUMN_FIT_HINT=220px в components.css,
  //     НЕ зависит от этой переменной) — --book-col-min остался только
  //     потолком max-width контейнера (чтобы карточки не растягивались
  //     бесконечно на сверхширoких экранах), обрезка текста при нехватке
  //     места решается отдельно по факту, поэлементно (renderBookNamePerItem,
  //     по реальной итоговой ширине конкретной карточки — см.
  //     "АВТОСОКРАЩЕНИЕ НАЗВАНИЙ КНИГ" ниже).
  //   --book-compact-min — узкий экран, компактная плитка (свёрнутая
  //     книга, 2-3 колонки): минимальная ширина, при которой ГОТОВОЕ
  //     короткое сокращение книги (data-abbr) гарантированно помещается —
  //     "нижняя граница" размера бокса, чтобы сокращение не пришлось
  //     обрезать ещё сильнее самого сокращения.
  function computeBookCardMinWidths(){
    if(!booksContainer || !mainEl) return;
    var sampleNameEl = booksContainer.querySelector(".book-name");
    var sampleCountEl = booksContainer.querySelector(".book-count");
    if(!sampleNameEl || !sampleCountEl) return;
    var nameCs = getComputedStyle(sampleNameEl);
    var nameFont = nameCs.fontStyle + " " + nameCs.fontWeight + " " + nameCs.fontSize + "/" + nameCs.lineHeight + " " + nameCs.fontFamily;
    var nameLetterSpacing = nameCs.letterSpacing;
    var countCs = getComputedStyle(sampleCountEl);
    var countFont = countCs.fontStyle + " " + countCs.fontWeight + " " + countCs.fontSize + "/" + countCs.lineHeight + " " + countCs.fontFamily;

    var maxFullWidth = 0, maxAbbrWidth = 0;
    sections.forEach(function(s){
      s.books.forEach(function(b){
        var wFull = measureTextWidth(b[0], nameFont, nameLetterSpacing);
        if(wFull > maxFullWidth) maxFullWidth = wFull;
        var wAbbr = measureTextWidth(b[1], nameFont, nameLetterSpacing);
        if(wAbbr > maxAbbrWidth) maxAbbrWidth = wAbbr;
      });
    });
    // Кнопка "Показать/Скрыть прочитанное" рендерится в том же гриде той
    // же вёрсткой (см. HIDE_PROGRESS_TEXTS), но НЕ учитывается здесь: её
    // полная фраза заметно длиннее любого названия книги и раздувала бы
    // ширину колонки (--book-col-min/--book-compact-min) для ВСЕЙ сетки
    // ради одного элемента, из-за чего на широком экране могло не влезать
    // заявленное число колонок с реальными названиями книг (ТЗ от 10.09,
    // "3 колонки на планшете" — раньше не влезали). Это безопасно убрать:
    // сама кнопка уже независимо решает, что показать при нехватке места
    // (renderSkipMediumEntry — full → своя лесенка HIDE_PROGRESS_STEPS_BY_FULL
    // → abbr с посимвольной подгонкой) — не завязана на этот расчёт.

    // Самый широкий возможный счётчик во всём проекте — "150 / 150"
    // (Псалмы, 150 глав, все прочитаны) шире любого другого "X / Y".
    //
    // ИСПРАВЛЕНО 11.09 (ТЗ пользователя — "1См"/"2См"/"1Цр"/"2Цр"/"Иов"/
    // "Иса"/"Иер"/"Иез"/"ИсН" показывались обрезанными до 2 букв на узком
    // 3-колоночном экране, хотя data-abbr для них — готовые 3-буквенные
    // коды). Истинная причина НЕ в кэше и не в опечатке в данных — коды
    // в sections[] были верны с самого начала. Причина в геометрии:
    // --book-compact-min (гарантия "готовое сокращение всегда влезает")
    // считался по СТАРЫМ, слишком щедрым отступам компактного режима, а
    // сама плитка колонки на узком экране (394px, 3 колонки) физически
    // может быть ýже этой гарантии — components.css намеренно клэмпит
    // ширину колонки через min() до реально доступной доли экрана (см.
    // комментарий в components.css у @media(max-width:859px), правка от
    // 10.09 про переполнение), а не наоборот. Как только реальная колонка
    // становится ýже гарантии, my.js (ensureWholeCharsFit) добросовестно
    // подрезает текст по одному символу, что и давало на вид "случайные"
    // 2-буквенные обрубки — не у всех книг сразу, а только у тех, где
    // конкретная ширина конкретного счётчика ("11 / 52" и т.п.) и форма
    // букв кода (широкие "Ц"/"Н"/"М") в сумме чуть-чуть не влезали в
    // оставшееся место. Настоящее исправление — не в данных книг, а в
    // высвобождении места вокруг названия в компактном режиме: пилюля
    // счётчика в компактном режиме получила свой собственный, более узкий
    // паддинг (components.css, @media(max-width:859px) — padding:2px 6px
    // вместо общих 2px 8px), а padding/gap самого .book-header-content там
    // же уменьшены с 0 10px/6px до 0 6px/4px. Освобождённые ~14px уходят
    // напрямую в бюджет .book-name и снимают дефицит ширины для всех
    // кодов книг, включая самый широкий во всём проекте — "Иуды" (4 буквы,
    // 11.09 шестой заход — при padding 0 8px запаса хватает и без
    // сокращения "Иуды"→"Иуд", пятый заход отменён).
    var countTextWidth = measureTextWidth("150 / 150", countFont, "0px");
    var wideCountPillPadding = 16;    // .book-count{padding:2px 8px} — обычный (широкий) режим, не менялся
    var compactCountPillPadding = 12; // .book-count.compact-count{padding:2px 6px} — components.css, @media(max-width:859px)
    var wideCountWidth = countTextWidth + wideCountPillPadding;
    var compactCountWidth = countTextWidth + compactCountPillPadding;
    var toggleWidth = 26; // .toggle-check
    var wideGap = 10;          // .book-header-content{gap:10px} — полноразмерная карточка
    var wideHeaderPadding = 28; // .book-header-content{padding:0 14px}, с двух сторон — полноразмерная карточка
    // Компактный режим (2/3 колонки на узком экране, components.css,
    // блок @media(max-width:859px)) — там же .book-header-content получает
    // padding:0 10px / gap:2px безусловно (ТЗ от 11.09, седьмой заход —
    // было 0 8px (пятый заход), пробуем 0 10px вместе с обнулённым
    // BOOK_NAME_SAFETY_MARGIN выше; до этого шестой заход подтвердил, что
    // 0 8px хватает без сокращения "Иуды"→"Иуд").
    // Эти цифры здесь и в CSS должны совпадать один в один — иначе получится
    // рассинхрон (JS резервирует место под одни отступы, а рендерится с
    // другими).
    var compactGap = 2;
    var compactHeaderPadding = 20; // components.css: .book-header-content{padding:0 10px} в компактном режиме — правка от 11.09, седьмой заход

    // Широкая карточка: видны имя + счётчик + стрелка-переключатель — два
    // зазора между тремя детьми.
    // Потолок 358px (BOOK_FULL_MAX_WIDTH выше) — иначе main{max-width} и
    // column-width в components.css унаследуют неограниченную величину и
    // колонка сможет стать шире 358px на широких экранах (ТЗ, full, п.2).
    var wideMin = Math.min(
      Math.ceil(maxFullWidth + wideCountWidth + toggleWidth + wideGap*2 + wideHeaderPadding + BOOK_NAME_SAFETY_MARGIN),
      BOOK_FULL_MAX_WIDTH
    );
    // Компактная плитка: стрелка скрыта (components.css,
    // .book-header:not(.expanded) .toggle-check), один зазор имя-счётчик.
    var compactMin = Math.ceil(maxAbbrWidth + compactCountWidth + compactGap + compactHeaderPadding + BOOK_NAME_SAFETY_MARGIN);

    mainEl.style.setProperty("--book-col-min", wideMin + "px");
    mainEl.style.setProperty("--book-compact-min", compactMin + "px");
  }

  // Финальная подстраховка: что бы ни выбрала логика выше (полное имя,
  // пословное сокращение или готовый абрив), последний символ иногда мог
  // обрезаться визуально ПОПОЛАМ (clip ровно по границе бокса). Эта
  // функция ничего не решает сама — просто гарантирует, что на экран
  // попадают только целые буквы: если строка чуть-чуть не влезает,
  // отрезает по одному символу с конца, а не полбуквы.
  function ensureWholeCharsFit(text, avail, font, letterSpacing){
    while(text.length > 0 && measureTextWidth(text, font, letterSpacing) > avail){
      text = text.slice(0, -1);
    }
    return text;
  }

  // Ширина шрифта берётся с ЛЮБОГО .book-name — все они используют одни и
  // те же CSS-свойства (font, letter-spacing), поэтому неважно, с какого
  // конкретно элемента её снять.
  function measureBookNameFont(el){
    var cs = getComputedStyle(el);
    return {
      font: cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + "/" + cs.lineHeight + " " + cs.fontFamily,
      letterSpacing: cs.letterSpacing
    };
  }


  // Отрисовка элемента с data-skip-medium (сейчас — кнопка "Показать/
  // Скрыть прочитанное") — у неё нет обычного "среднего" сокращения,
  // вместо него собственная лесенка готовых ступеней. Показывает full
  // целиком, если влезает; иначе идёт по лесенке ступеней
  // (HIDE_PROGRESS_STEPS_BY_FULL) сверху вниз и берёт первую влезающую;
  // если ступеней нет вообще — готовый короткий код.
  function renderSkipMediumEntry(el, boxWidth, font, letterSpacing){
    var full = el.dataset.full;
    var abbr = el.dataset.abbr;
    if(measureTextWidth(full, font, letterSpacing) <= boxWidth){
      el.textContent = full;
      return;
    }
    var steps = HIDE_PROGRESS_STEPS_BY_FULL[full];
    if(steps && steps.length){
      var chosen = steps[steps.length - 1];
      for(var si = 0; si < steps.length; si++){
        if(measureTextWidth(steps[si], font, letterSpacing) <= boxWidth){ chosen = steps[si]; break; }
      }
      el.textContent = ensureWholeCharsFit(chosen, boxWidth, font, letterSpacing);
      return;
    }
    el.textContent = ensureWholeCharsFit(abbr || full, boxWidth, font, letterSpacing);
  }

  // Рендерит ОДИН элемент компактной сетки по СВОЕЙ СОБСТВЕННОЙ ширине —
  // уровень (full/medium/short) решается для каждой карточки отдельно, а
  // не одним общим на весь грид (см. комментарий у isCompactBookGrid
  // выше, ТЗ от 10.09, пятый заход): full, если влезает целиком; иначе
  // medium (fitBookNameMedium — обрезка самого длинного слова до
  // согласной, одна точка), если предельно обрезанный вариант помещается;
  // иначе готовый короткий код.
  // allowMedium=false (3 колонки): abbr-only, полностью пропускает и
  // medium, и full — даже если full или medium для конкретной короткой
  // книги технически поместились бы. При 3 колонках плитка настолько
  // узкая, что full/medium помещаются ТОЛЬКО у части книг (у которых
  // само слово короткое: "Руфь", "Осия", "Наум", "Аггей", "Иона",
  // "Амос", "Луки", "Титу" и т.п.), и в сетке получался разнобой — часть
  // карточек с полным словом или "слово."-сокращением, часть с готовым
  // кодом ("Бт", "1Лт"), визуально неряшливо (баг-фикс 11.09 — до этого
  // full-проверка была ВНЕ if(allowMedium) и всё равно проходила).
  // Пользователь сверил и подтвердил список готовых коротких кодов
  // (data-abbr в sections[] — тот же, что уже был) как верный и
  // исчерпывающий именно для этой ширины — используем ТОЛЬКО abbr, без
  // full и без medium.
  function renderBookNamePerItem(el, font, letterSpacing, allowMedium){
    var full = el.dataset.full;
    if(full == null) return;
    var boxWidth = el.clientWidth - BOOK_NAME_SAFETY_MARGIN;
    if(boxWidth <= 0){ el.textContent = full; return; }
    var abbr = el.dataset.abbr;
    if(el.dataset.skipMedium){
      if(allowMedium){
        renderSkipMediumEntry(el, boxWidth, font, letterSpacing);
      } else if(measureTextWidth(full, font, letterSpacing) <= boxWidth){
        el.textContent = full;
      } else {
        el.textContent = ensureWholeCharsFit(abbr || full, boxWidth, font, letterSpacing);
      }
      return;
    }
    if(allowMedium){
      var fullMargin = BOOK_FULL_SAFETY_OVERRIDE.hasOwnProperty(full) ? BOOK_FULL_SAFETY_OVERRIDE[full] : BOOK_NAME_SAFETY_MARGIN;
      var fullBoxWidth = el.clientWidth - fullMargin;
      if(measureTextWidth(full, font, letterSpacing) <= fullBoxWidth){
        el.textContent = full;
        return;
      }
      var medium = fitBookNameMedium(full, boxWidth, font, letterSpacing);
      if(medium.fits){
        el.textContent = ensureWholeCharsFit(medium.text, boxWidth, font, letterSpacing);
        return;
      }
    }
    el.textContent = ensureWholeCharsFit(abbr || full, boxWidth, font, letterSpacing);
  }

  // Компактная сетка 2 колонки — full/medium/short по месту (см.
  // renderBookNamePerItem выше); 3 колонки — самая узкая плитка, medium
  // (с точкой) отключён совсем, см. комментарий у renderBookNamePerItem
  // (ТЗ от 10.09, финальный шаг).
  function compactBookGridAllowsMedium(){
    return getBookColumns() !== 3;
  }

  // Точечный пересчёт ОДНОГО элемента (например, при смене счётчика
  // прочитанных глав — см. updateBookProgress). Уровень (full/medium/short)
  // решается для КАЖДОЙ карточки отдельно по её собственной ширине — как в
  // широкой, так и в компактной сетке (ТЗ от 11.09, правит решение от
  // 10.09 ниже): единый уровень на весь грид по самому длинному названию
  // означал, что одно длинное название ("1 Фессалоникийцам" и т.п.) при 3
  // узких колонках утягивало вниз ВСЕ карточки, включая короткие, которым
  // места хватает с запасом ("Быт."/"Исх." вместо "Бытие"/"Исход" даже при
  // явно достаточной ширине колонки). При 2 широких колонках это было
  // незаметно — места хватало даже самым длинным названиям, поэтому общий
  // уровень почти всегда совпадал с тем, что дал бы поэлементный расчёт.
  function fitBookNameText(el){
    if(!el || el.dataset.full == null) return;
    var m = measureBookNameFont(el);
    var allowMedium = isCompactBookGrid() ? compactBookGridAllowsMedium() : true;
    renderBookNamePerItem(el, m.font, m.letterSpacing, allowMedium);
  }

  function refreshAllBookNameFits(){
    if(!booksContainer) return;
    var nameEls = booksContainer.querySelectorAll(".book-name");
    if(!nameEls.length) return;
    var m = measureBookNameFont(nameEls[0]);
    var allowMedium = isCompactBookGrid() ? compactBookGridAllowsMedium() : true;
    Array.prototype.forEach.call(nameEls, function(el){
      renderBookNamePerItem(el, m.font, m.letterSpacing, allowMedium);
    });
  }
  // если шрифт дозагрузится позже первого замера (веб-шрифт ещё не был
  // готов на момент rAF), пересчитываем ещё раз, когда он точно готов —
  // иначе однажды подобранный текст может стать чуть шире факта.
  if(document.fonts && document.fonts.ready){
    document.fonts.ready.then(function(){
      computeBookCardMinWidths();
      refreshAllBookNameFits();
    });
  }

  // ТЗ от 11.09 (скриншоты пользователя, повторное сообщение после
  // BOOK_MEDIUM_OVERRIDE/BOOK_FULL_SAFETY_OVERRIDE выше не помогли — те
  // варианты тоже не влезали рядом со счётчиком): по прямой инструкции
  // переносим счётчик на отдельную строку ПОД названием для этих трёх
  // карточек (класс .count-below — components.css, main[data-book-
  // columns="2"/"3"] .book-header(-content).count-below), освобождая
  // имени почти всю ширину карточки вместо доли, оставшейся после
  // пилюли счётчика и стрелки. Класс ставится один раз при построении
  // карточки (ниже, initPage) и остаётся в DOM всегда — включается и
  // выключается чисто через CSS по data-book-columns (в обычном
  // однoколоночном режиме этого атрибута со значением 2/3 нет, поэтому
  // там ничего не меняется — имени и так достаточно места).
  var BOOK_COUNT_BELOW_NAME = {
    "2 Самуила": true,
    "1 Коринфянам": true,
    "2 Коринфянам": true
  };

  // ТЗ от 11.09 (скриншоты пользователя): первая версия этой правки
  // переносила счётчик на отдельную строку ПОД названием (класс
  // .count-below) — пользователь забраковал результат как уродливый.
  // Взамен: счётчик остаётся НА МЕСТЕ (верхний правый угол строки, где
  // и был), но выводится из потока flex и накладывается ПОВЕРХ
  // .book-name (класс .overlay-count — components.css, main[data-book-
  // columns="2"/"3"]), а не делит с ним ширину строки. .book-name из-за
  // этого получает почти всю ширину (делит её только со стрелкой
  // .toggle-check, которая остаётся в потоке как обычно) — если имя всё
  // равно длиннее, его конец визуально уходит под полупрозрачную пилюлю
  // счётчика, а не переносится строкой ниже и не обрезается. Класс
  // ставится один раз при построении карточки (ниже, initPage) и
  // остаётся в DOM всегда — включается и выключается чисто через CSS по
  // data-book-columns (в обычном однoколоночном режиме этого атрибута
  // со значением 2/3 нет, поэтому там ничего не меняется — имени и так
  // достаточно места).
  var BOOK_NAME_OVERLAP_COUNT = {
    "2 Самуила": true,
    "1 Коринфянам": true,
    "2 Коринфянам": true
  };

  function initPage(){
    applyBookColumns();
    var frag = document.createDocumentFragment();
    var bookNumber = 0; // сквозная нумерация книг 1..66 для ссылок JW Finder
    sections.forEach(function(section){
      var label = document.createElement("div");
      label.className = "section-label";
      label.textContent = section.title;
      frag.appendChild(label);

      section.books.forEach(function(book){
        var bookName = book[0], bookAbbr = book[1], chapterCount = book[2];
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
        if(BOOK_NAME_OVERLAP_COUNT[bookName]){
          headerContent.classList.add("overlay-count");
        }

        var nameEl = document.createElement("div");
        nameEl.className = "book-name";
        nameEl.textContent = bookName;
        nameEl.dataset.full = bookName;
        nameEl.dataset.abbr = bookAbbr;

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
          card.classList.toggle("book-open", isOpen);
          requestAnimationFrame(function(){ fitBookNameText(nameEl); });
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

        bookMeta[bookName] = {fillEl:fillEl, countEl:countEl, nameEl:nameEl, chapterCount:chapterCount, card:card, grid:grid, gridHeight:null};
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
    computeBookCardMinWidths();
    requestAnimationFrame(refreshAllBookNameFits);

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
      refreshAllBookNameFits();
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
    var hpt0 = hideCompletedActive ? HIDE_PROGRESS_TEXTS.show : HIDE_PROGRESS_TEXTS.hide;
    nameEl.textContent = hpt0.full;
    nameEl.dataset.full = hpt0.full;
    nameEl.dataset.abbr = hpt0.abbr;
    nameEl.dataset.skipMedium = "1";
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
    if(textEl){
      var hpt1 = hideCompletedActive ? HIDE_PROGRESS_TEXTS.show : HIDE_PROGRESS_TEXTS.hide;
      textEl.textContent = hpt1.full;
      textEl.dataset.full = hpt1.full;
      textEl.dataset.abbr = hpt1.abbr;
      refreshAllBookNameFits();
    }
    applyHideCompletedBooks();
  }

  function updateBookProgress(bookName){
    var meta = bookMeta[bookName];
    var checked = checkedPerBook[bookName] || 0;
    var pct = meta.chapterCount ? Math.round((checked/meta.chapterCount)*100) : 0;
    meta.fillEl.style.width = pct + "%";
    meta.countEl.textContent = checked + " / " + meta.chapterCount;
    // БАГ "съедаются буквы" (ТЗ от 10.09): .book-count — сосед .book-name
    // по той же flex-строке (.book-header-content). Раньше при отметке
    // главы менялся только текст счётчика, а .book-name пересчитывался
    // только при первой отрисовке/смене колонок/resize — если число цифр
    // в счётчике менялось ("9 / 24" → "10 / 24"), его пилюля становилась
    // шире и отбирала часть места у названия, но подобранный текст
    // названия оставался прежним: CSS (overflow:hidden;text-overflow:clip)
    // просто обрезал вылезший хвост, иногда ровно посередине буквы. Дёшево
    // пересчитываем подгонку тут же, при каждом изменении счётчика.
    if(meta.nameEl) fitBookNameText(meta.nameEl);
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
    // "Закладки" md-редактора тоже часть этого же state (см.
    // getSyncedBookmarkNames/setSyncedBookmark выше) — после слияния с
    // облаком (единственный случай, когда rerenderAllFromState вообще
    // вызывается) нужно перечитать их и, если открыт список заметок/
    // вкладка "Закладки", перерисовать (см. refreshBookmarksFromState в
    // mdeditor.js).
    if(MdEditor && MdEditor.refreshBookmarksFromState) MdEditor.refreshBookmarksFromState();
    // Если сейчас открыта одна из вкладок задач (red/inbox/next/projects/
    // waiting/read/someday/archive) — её тоже нужно перерисовать из
    // свежего state: rerenderAllFromState вызывается только после
    // слияния с облаком (см. doCloudSync ниже), а раньше эта функция
    // вкладки задач не трогала вовсе. Из-за этого, если на другом
    // устройстве в момент прихода данных как раз была открыта вкладка
    // задач, отметка "выполнено"/перенос между вкладками с первого
    // устройства подтягивались в state, но не показывались на экране,
    // пока вкладку не переключали туда-обратно вручную.
    // Если прямо СЕЙЧАС редактируется текст задачи (открыта клавиатура,
    // фокус в contenteditable-поле, см. renderTaskRowEdit) — не
    // перерисовываем вкладку: renderSettingsTabTask пересобирает список
    // целиком через innerHTML, что уничтожает и заново создаёт то самое
    // редактируемое поле — на мобильных это тут же закрывает клавиатуру
    // и обрывает ввод (задача от 02.09: "создаю задачу, клавиатура
    // появляется и сразу скрывается"). Фоновая синхронизация не настолько
    // срочная, чтобы ради неё прерывать набор текста — сам текст при
    // этом никуда не денется (saveTaskData уже сохранил его в state и
    // localStorage до пуша), а актуальный вид вкладка получит сама, как
    // только редактирование завершится (blur там же в renderTaskRowEdit)
    // или произойдёт следующий настоящий повод перерисовать список.
    var activeTaskEdit = document.activeElement;
    var isEditingTaskNow = !!(activeTaskEdit && activeTaskEdit.classList &&
      activeTaskEdit.classList.contains("task-editable"));
    if(settingsModalOverlay && settingsModalOverlay.classList.contains("open") && !isEditingTaskNow){
      // Экран "Все задачи проекта" (openTaskNextPicker) — не обычная вкладка:
      // currentSettingsTab всё это время остаётся "projects", но содержимое
      // #settingsTabContent подменено на конкретный проект + его next-задачи.
      // Раньше это условие сразу звало renderSettingsTabTask(currentSettingsTab)
      // и, если такой экран был открыт, затирало его обратно на список всех
      // проектов, как только приходила фоновая синхронизация (ТЗ пользователя
      // от 11.09: "добавил задачу в проекте, кликнул мимо — приложение само
      // вышло к списку проектов"; добавление задачи запускает scheduleCloudPush,
      // а blur снимает guard isEditingTaskNow выше — синхронизация, подоспевшая
      // именно в этот момент, и перерисовывала не тот экран). Если сейчас
      // открыт этот экран — перерисовываем ЕГО же (activeProjectPickerRerender),
      // а не список проектов.
      // ВРЕМЕННО (ТЗ пользователя от 12.09, третий заход): именно этот
      // путь уже один раз ловил похожую гонку (см. комментарий выше, ТЗ
      // от 11.09) — isEditingTaskNow снимается синхронно в blur ДО того,
      // как строка успевает перерисоваться обратно (см. setTimeout 500мс
      // в renderRowEdit/blur), и фоновая синхронизация, подоспевшая
      // именно в эту паузу, попадает сюда. Лог — no-op при выключенной
      // галочке отладки. Убрать вместе с остальным диагностическим кодом
      // этой задачи, когда причина найдена.
      if (window.Debug) window.Debug.log("rerenderAllFromState: activeProjectPickerRerender=" + !!activeProjectPickerRerender);
      if(activeProjectPickerRerender) activeProjectPickerRerender();
      else if(TASK_TAB_IDS.hasOwnProperty(currentSettingsTab)) renderSettingsTabTask(currentSettingsTab);
    }
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
        var bookName = book[0], chapterCount = book[2];
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

  // ЗАПОЛНИТЬ: имя бакета Firebase Storage ТОГО ЖЕ проекта, что и
  // FIREBASE_DB_URL выше (Firebase Console → Storage → показывается
  // над списком файлов, вида gs://<бакет> — сюда без "gs://"; обычно
  // <project-id>.appspot.com или <project-id>.firebasestorage.app).
  // Storage нужно включить в консоли (если ещё не включён) и выставить
  // такие же открытые правила, как у Realtime Database (read, write: if
  // true) — иначе запросы ниже (READER_PLAN.md, шаг 3) будут падать с 403.
  var FIREBASE_STORAGE_BUCKET = "ЗАПОЛНИ-МЕНЯ.appspot.com";
  var FIREBASE_STORAGE_URL = "https://firebasestorage.googleapis.com/v0/b/" + FIREBASE_STORAGE_BUCKET + "/o/";

  // Случайный ID этого браузера/устройства, живёт в localStorage
  // (переустановка PWA/очистка данных сайта создаст новый — это ожидаемо,
  // "устройство" здесь означает "эта копия данных приложения", а не
  // физическое железо). Нужен реестру файлов (READER_PLAN.md, шаг 3),
  // чтобы отличать, кто добавил файл и кто уже подтвердил получение.
  var DEVICE_ID_KEY = "bibleDeviceId_v1";
  var deviceId = null;
  function getDeviceId(){
    if(deviceId) return deviceId;
    deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if(!deviceId){
      deviceId = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  }

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

  function fetchCloudBlob(id, opts){
    var fetchOpts = { method:"GET" };
    // keepalive для GET безопасен всегда (тела нет, лимит в 64KB на
    // keepalive-запросы его не касается) — в отличие от putCloudBlob,
    // здесь проверка размера не нужна.
    if(opts && opts.keepalive) fetchOpts.keepalive = true;
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", fetchOpts, 8000).then(function(res){
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

  // keepalive-запросы браузер обязуется довести до конца в фоне даже
  // после выгрузки страницы, но только если тело укладывается в лимит
  // ~64KB (совокупно по всем keepalive-запросам разом, спецификация
  // Fetch). Наше state может вырасти больше (заметки, задачи), поэтому
  // keepalive нельзя ставить безусловно — превышающий лимит запрос
  // браузер не отправит вовсе (упадёт сразу, ещё до сети). Берём запас
  // от 64KB на неточность .size у Blob/другие keepalive-запросы, которые
  // могли не успеть отработать.
  var KEEPALIVE_BODY_LIMIT = 60000;

  function putCloudBlob(id, data, opts){
    // Каждая запись в облако обновляет метку "последней активности" этого
    // кода синхронизации — от неё считается годовой срок хранения (см.
    // fetchCloudBlob). Метка добавляется только в отправляемую копию,
    // локальный объект state этим не засоряется.
    var payload = {};
    var src = data || {};
    Object.keys(src).forEach(function(k){ payload[k] = src[k]; });
    payload[LAST_ACTIVE_STATE_KEY] = {c:true, t:Date.now()};
    var body = JSON.stringify(payload);
    // ВАЖНО: метод именно PATCH, а не PUT. PUT в Firebase Realtime
    // Database замещает узел /syncs/<id> ЦЕЛИКОМ содержимым body — если в
    // payload нет какого-то ключа, который есть на сервере, он пропадает.
    // PATCH обновляет только перечисленные в body дочерние ключи, не
    // трогая остальные (см. doCloudSync ниже — туда теперь и передаётся
    // не весь state, а только реально изменившиеся ключи). Это устраняет
    // классическую гонку двух устройств: раньше, если между нашим чтением
    // облака и нашей записью другое устройство успевало записать своё
    // изменение (например, пометить задачу удалённой), наш PUT всего
    // локального state отменял эту чужую запись — задача "восстанавливалась"
    // из полного снапшота, вычисленного ещё ДО того, как мы про неё
    // узнали. При PATCH с ключами, которых мы не трогали, мы вообще не
    // отправляем — и стереть их не можем, кто бы их туда ни записал.
    var fetchOpts = {
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body: body
    };
    if(opts && opts.keepalive){
      // .length у строки — это UTF-16 code units, не байты; для
      // кириллицы (заметки, задачи) это занизит размер. Считаем реальный
      // байтовый размер через Blob, иначе рискуем поставить keepalive на
      // запрос, который браузер молча не отправит.
      var byteSize = new Blob([body]).size;
      if(byteSize < KEEPALIVE_BODY_LIMIT){
        fetchOpts.keepalive = true;
      }
      // Если не влезло — отправляем как обычный fetch. Хуже, чем ничего
      // не делать, это не сделает: без keepalive шанс не долететь при
      // сворачивании/блокировке остаётся тем же, что и был.
    }
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(id) + ".json", fetchOpts, 15000).then(function(res){
      if(!res.ok) throw new Error("put_failed_" + res.status);
      return true;
    });
  }

  // отдельного "создания" Firebase не требует — запись по случайному ID
  // сама создаёт узел при первом PATCH
  function createCloudBlob(initialData){
    var id = generateSyncId();
    return putCloudBlob(id, initialData).then(function(){ return id; });
  }

  // ---------------------------------------------------------------------
  // Ветка /notes(Meta) для облачных заметок "Моих заметок" (см.
  // TASK_MDNOTES_CLOUD.md, раздел 2) — свой, полностью НЕЗАВИСИМЫЙ от
  // общего state цикл синхронизации (mdeditor.js ведёт собственный
  // debounce/повтор), но переиспользует fetchWithTimeout и PATCH-приём
  // putCloudBlob (она поддерживает ключи со слэшами — Firebase трактует их
  // как relative-путь при multi-location update, значит один и тот же
  // putCloudBlob(id, {"notes/x": ..., "notesMeta/x": ...}) обновляет сразу
  // обе ветки одним запросом).
  // ---------------------------------------------------------------------
  function fetchNotesCloudPath(relPath, opts){
    if(!syncId) return Promise.reject(new Error("no_sync"));
    var fetchOpts = { method: "GET" };
    if(opts && opts.keepalive) fetchOpts.keepalive = true;
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(syncId) + "/" + relPath + ".json", fetchOpts, 8000).then(function(res){
      if(!res.ok) throw new Error("fetch_failed_" + res.status);
      return res.json();
    });
  }
  function deleteNotesCloudPath(relPath, opts){
    if(!syncId) return Promise.reject(new Error("no_sync"));
    var fetchOpts = { method: "DELETE" };
    if(opts && opts.keepalive) fetchOpts.keepalive = true;
    return fetchWithTimeout(FIREBASE_DB_URL + FIREBASE_SYNCS_PATH + "/" + encodeURIComponent(syncId) + "/" + relPath + ".json", fetchOpts, 8000).then(function(res){
      if(!res.ok) throw new Error("delete_failed_" + res.status);
      return true;
    });
  }
  function patchNotesCloud(patchObj, opts){
    if(!syncId) return Promise.reject(new Error("no_sync"));
    return putCloudBlob(syncId, patchObj, opts);
  }
  function generateNoteId(){
    return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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

  // Сравнение ПО ЗНАЧЕНИЮ (не по ссылке, в отличие от statesEqual выше,
  // которая полагается на то, что mergeStates переиспользует исходные
  // объекты) — нужно, чтобы найти именно те ключи, которые реально
  // отличаются от того, что мы только что прочитали из облака, и
  // отправить в putCloudBlob (PATCH) только их. См. подробное пояснение
  // про гонку двух устройств у putCloudBlob.
  function recordsEqual(a, b){
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }
  function buildStateDelta(merged, cloudData){
    var delta = {};
    Object.keys(merged || {}).forEach(function(k){
      if(!recordsEqual(merged[k], cloudData ? cloudData[k] : undefined)) delta[k] = merged[k];
    });
    return delta;
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

  // Раньше пуш в облако откладывался на 1500мс от КАЖДОГО изменения — это
  // было наследие опасения "дёргать сеть на каждое нажатие клавиши", но
  // по факту scheduleCloudPush нигде не вызывается на ввод текста посимвольно
  // (текст задачи/заметки сохраняется по blur/кнопке, а не на каждый input) —
  // везде это одно дискретное действие пользователя (галочка, приоритет,
  // перенос вкладки и т.п.). Поэтому такая долгая задержка была лишней и
  // ощущалась как "не синхронизируется сразу", хотя технически рано или
  // поздно срабатывала. Задержка нужна только чтобы не бомбить сеть, если
  // подряд прилетает НЕСКОЛЬКО вызовов (массовое восстановление задач из
  // .txt, серия быстрых тапов) — для этого достаточно короткой паузы.
  var PUSH_DEBOUNCE_MS = 400;
  var pushTimer = null;
  // Если пуш понадобился, пока предыдущий цикл синхронизации ещё не
  // завершился (doCloudSync ниже в этот момент выходит по syncInProgress
  // и НЕ перепланирует себя сам) — раньше это изменение могло не уйти в
  // облако вовсе, пока не случится следующее (или онлайн-событие, или
  // перезапуск приложения): единственным триггером остаётся сам факт
  // следующего изменения. Этот флаг чинит именно это — по УСПЕШНОМУ
  // завершении текущего цикла (см. then() в doCloudSync, ветка "synced")
  // сразу запускается новый, если за время синхронизации набежало что-то
  // ещё. При ошибке флаг нарочно не трогаем — его подхватит либо
  // следующий успешный цикл (в т.ч. один из авто-повторов), либо
  // очередное изменение.
  var pendingPushAfterSync = false;
  function scheduleCloudPush(){
    if(!syncId) return;
    clearTimeout(syncRetryTimer);
    syncRetryCount = 0;
    if(syncInProgress){
      pendingPushAfterSync = true;
      return;
    }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(doCloudSync, PUSH_DEBOUNCE_MS);
  }

  var syncInProgress = false;
  var syncRetryCount = 0;
  var syncRetryTimer = null;
  var SYNC_RETRY_DELAYS = [5000, 15000, 40000, 90000];

  // urgent=true — вызов из flushPendingSyncNow (страница уже скрывается/
  // выгружается): и GET, и завершающий PUT в этом проходе идут с
  // keepalive, чтобы браузер долетел с ними в фоне, даже если сама
  // страница будет заморожена/закрыта секундой позже (см. putCloudBlob
  // про лимит тела и комментарий у visibilitychange ниже).
  function doCloudSync(urgent){
    if(!syncId) { setSyncState("off"); return; }
    if(!navigator.onLine){ setSyncState("offline"); return; }
    if(syncInProgress) return;
    syncInProgress = true;
    setSyncState("syncing");
    fetchCloudBlob(syncId, {keepalive: urgent}).then(function(cloudData){
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
        // Раньше здесь отправлялся весь merged (полный локальный state) —
        // см. подробное объяснение гонки у putCloudBlob. Теперь отправляем
        // только реально отличающиеся от только что прочитанного cloudData
        // ключи — putCloudBlob шлёт их через PATCH, не трогая остальное.
        return putCloudBlob(syncId, buildStateDelta(merged, cloudData), {keepalive: urgent});
      }
    }).then(function(){
      syncRetryCount = 0;
      clearTimeout(syncRetryTimer);
      setSyncState("synced");
      retryUnresolvedYoutubeLinks(); // повтор упавших ранее запросов заголовков YouTube (см. выше)
      touchDeviceRegistry(); // отмечаемся живым устройством для реестра файлов (READER_PLAN.md, шаг 3)
      syncFilesRegistry(); // фоновая сверка реестра книг с другими устройствами (см. ниже)
      // Успешно синхронизировались — если за время этого цикла набежало
      // ещё одно изменение (см. pendingPushAfterSync у scheduleCloudPush),
      // сразу запускаем новый цикл, а не ждём следующего изменения задачи.
      // Нарочно только на успехе: при ошибке ниже уже запланирован повтор
      // с нарастающей паузой (SYNC_RETRY_DELAYS) — не хотим сбрасывать её
      // на короткую паузу scheduleCloudPush при каждой новой правке во
      // время сбоя сети.
      if(pendingPushAfterSync){
        pendingPushAfterSync = false;
        scheduleCloudPush();
      }
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
    // Раздел 3 ТЗ TASK_MDNOTES_CLOUD.md: у заметок свой независимый
    // облачный цикл (см. deps.notesRetryDelays/initMdEditorModule выше),
    // doCloudSync его не трогает — без этого вызова правки, накопленные
    // офлайн в dirtyNoteIds, не отправились бы сами по себе при
    // восстановлении сети (см. retryNotesPushOnReconnect в mdeditor.js).
    if(MdEditor && MdEditor.retryNotesPushOnReconnect) MdEditor.retryNotesPushOnReconnect();
  });
  window.addEventListener("offline", function(){ refreshStatusBase(); });
  if(syncId) doCloudSync();

  // И saveLocalState (localStorage), И scheduleCloudPush (облако) —
  // отложенные через setTimeout (300мс и PUSH_DEBOUNCE_MS соответственно,
  // см. пояснение у scheduleCloudPush выше), чтобы не долбить сеть при
  // серии вызовов подряд. Проблема: если
  // отметить задачу выполненной/перенести между вкладками и сразу же
  // свернуть приложение или заблокировать телефон (обычная привычка —
  // "отметил и убрал в карман"), мобильный браузер может заморозить
  // вкладку раньше, чем сработают эти таймеры — и изменение не попадёт
  // ни в localStorage, ни тем более в облако, а значит не подтянется ни
  // на одном другом устройстве. visibilitychange с состоянием "hidden"
  // (а не beforeunload — он на мобильных ненадёжен, особенно в PWA)
  // срабатывает как раз в момент сворачивания, пока страница ещё жива,
  // и это единственный надёжный момент, чтобы сбросить оба таймера и
  // сохранить/отправить немедленно. pagehide — подстраховка на случай
  // реального закрытия вкладки/приложения.
  //
  // Самого сброса таймеров недостаточно: обычный fetch не гарантирует
  // завершение запроса, если браузер в этот момент замораживает/выгружает
  // страницу (типичный случай — блокировка экрана сразу после переноса
  // задачи). Поэтому doCloudSync(true) здесь просит keepalive у обоих
  // сетевых запросов этого прохода (см. doCloudSync/putCloudBlob выше) —
  // это явно говорит браузеру довести запрос до конца в фоне, даже если
  // сама страница уже не активна. Если ровно в этот момент уже идёт
  // другой (не keepalive) проход синхронизации — doCloudSync тихо выйдет
  // по syncInProgress, и этот шанс достанется retry по SYNC_RETRY_DELAYS
  // или следующей обычной синхронизации; здесь это осознанно не
  // усложняется.
  function flushPendingSyncNow(){
    if(saveTimer){
      clearTimeout(saveTimer);
      saveTimer = null;
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
    }
    if(pushTimer){
      clearTimeout(pushTimer);
      pushTimer = null;
      doCloudSync(true);
    }
  }
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "hidden") flushPendingSyncNow();
  });
  window.addEventListener("pagehide", flushPendingSyncNow);

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
    PAPERCLIP_ICON_SVG: PAPERCLIP_ICON_SVG,
    // ---------------------------------------------------------------------
    // Подложка (шаблон-картинка) теперь хранится в облаке, тем же кодом
    // синхронизации, что и остальные данные (ТЗ пользователя от 08.09) —
    // по тому же приёму, что и облачные заметки у MdEditor выше: узкие
    // функции, привязанные к текущему syncId, Firebase-специфика (URL,
    // формат хранения) остаётся здесь. Свой путь в дереве — "s89Template"
    // (не "notes"/"notesMeta") через ту же PATCH-запись putCloudBlob,
    // которая умеет relative-пути со слэшами. Realtime Database — просто
    // JSON-дерево без понятия "тип файла": картинка хранится строкой
    // (base64 data:URL), как и текст заметок.
    // ---------------------------------------------------------------------
    getSyncId: function(){ return syncId; },
    fetchCloudPath: fetchNotesCloudPath,
    patchCloud: patchNotesCloud
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
  // Логика вкладки "Мои заметки" (первая боковая вкладка второго
  // набора, settingsTabSet2Btn1 / "set2s_1") вынесена в отдельный файл
  // mdeditor.js (см. index.html и sw.js) — по тому же образцу, что и
  // ImgResize/EpubSplit выше. flushPendingMdEditorEdit сохраняет несохранённые
  // правки в открытой заметке при уходе со вкладки — вызывается в общем блоке
  // flush* в начале switchSettingsTab, тем же приёмом, что и
  // flushPendingCommentEdits и т.п.
  // Тексты задач и комментариев, которые тоже могут содержать вставленную
  // картинку "![[имя]]" (кнопка-скрепка, см. initTaskGlobalToolbar выше) —
  // нужно "корзине сирот" в mdeditor.js (collectReferencedMediaNames), та
  // до сих пор сканировала на предмет "![[имя]]" только тексты заметок
  // "Моего блокнота" (notesMap). Из-за этого картинка, вставленная ТОЛЬКО в
  // задачу/комментарий (а не в заметку), считалась неиспользуемой и
  // молча удалялась из images/ (OPFS) при каждом перезапуске приложения
  // (maybeRunImageCleanup вызывается один раз при старте модуля) — хотя
  // миниатюра картинки в самой задаче была видна и открывалась. Функция
  // объявлена ниже (getAllTasks/getAllComments), но ссылаться на неё здесь
  // безопасно — function-декларация поднимается в начало этой же IIFE, тем
  // же приёмом, что и refitAllVisibleTaskBodies выше.
  function collectTaskAndCommentTextsForMediaScan(){
    var texts = [];
    getAllTasks().forEach(function(t){ if(t.c && t.c.text) texts.push(t.c.text); });
    getAllComments().forEach(function(c){ if(c.c && c.c.text) texts.push(c.c.text); });
    return texts;
  }
  var MdEditor = window.initMdEditorModule({
    escapeHtml: escapeHtml,
    // см. collectTaskAndCommentTextsForMediaScan выше — картинки,
    // вставленные в задачи/комментарии, тоже должны считаться
    // "используемыми" для корзины сирот в mdeditor.js.
    getExternalMediaTexts: collectTaskAndCommentTextsForMediaScan,
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
    // крестик удаления заметки в общем списке (см. renderListScreen в
    // mdeditor.js, ТЗ пользователя от 05.09) — та же пиктограмма, что и у
    // "Удалить навсегда" в архиве задач (.task-delete-btn выше), а не своя.
    DELETE_ICON_SVG: DELETE_ICON_SVG,
    createArchivedTaskWithText: createArchivedTaskWithText,
    openTaskMoveTargetPicker: openTaskMoveTargetPicker,
    // см. applyFontSize в mdeditor.js — пересчитывает подгонку кнопок
    // (.task-actions) у уже отрисованных строк задач при любом изменении
    // размера шрифта, включая асинхронное применение сохранённого размера
    // при старте приложения (см. ТЗ пользователя от 31.08). Функция
    // объявлена ниже (function-декларация, поднимается в начало этой же
    // IIFE), поэтому ссылаться на неё здесь, до её текстового объявления,
    // безопасно.
    refitAllVisibleTaskBodies: refitAllVisibleTaskBodies,
    // закладки "Моих заметок" — теперь синхронизируются в облаке через
    // тот же state/saveLocalState/scheduleCloudPush, что и остальные
    // данные приложения (см. getSyncedBookmarkNames/setSyncedBookmark
    // выше и ТЗ пользователя от 01.09).
    getSyncedBookmarkNames: getSyncedBookmarkNames,
    setSyncedBookmark: setSyncedBookmark,
    // заголовки вставленных ссылок (YouTube/публикации/домен, см. выше) —
    // общий резолвер и подписка на его асинхронное обновление, чтобы live-
    // preview блокнота показывал те же заголовки, что и остальные вкладки.
    autoLinkTitle: autoLinkTitle,
    onLinkTitleResolved: onLinkTitleResolved,
    // регистрация факта создания новой заметки — для поля "новые заметки"
    // в "Карте дней года" (см. recordNoteCreated/getNoteCreationsForDay
    // ниже и ТЗ пользователя от 04.09); функция объявлена ниже, но
    // ссылаться на неё здесь безопасно по той же причине, что и у
    // refitAllVisibleTaskBodies выше (function-декларация, поднимается в
    // начало этой же IIFE)
    recordNoteCreated: recordNoteCreated,
    // единая точка входа переключения вкладок настроек — нужна mdeditor.js,
    // чтобы клик по заметке из "Закладок"/"Забытых" переключал подсветку
    // боковой иконки на "Мой блокнот" (set2s_1) тем же способом, что и клик
    // по [[ссылке]] из другой вкладки (см. switchSettingsTab ниже и ТЗ
    // пользователя от 08.09).
    switchSettingsTab: switchSettingsTab,
    // ---------------------------------------------------------------------
    // Книжные закладки "на полях" (READER_PLAN.md, Этап D, шаг 15, 11.09) —
    // сами данные и OPFS-манифест книг живут здесь, в my.js
    // (getBookMarginBookmarksForList/openBookAtMarginBookmark/
    // removeBookBookmark — все определены в разделе "ЗАКЛАДКИ НА ПОЛЯХ"
    // выше, до этого места видны за счёт подъёма function-деклараций, как и
    // остальные такие ссылки в этом объекте); mdeditor.js получает только
    // три узкие точки входа, чтобы отрисовать книжные закладки вперемешку с
    // закладками-заметками в общей вкладке "Закладки" (см.
    // renderBookmarksScreen в mdeditor.js).
    getBookMarginBookmarks: getBookMarginBookmarksForList,
    openBookMarginBookmark: openBookAtMarginBookmark,
    removeBookMarginBookmark: removeBookBookmark,
    // ---------------------------------------------------------------------
    // Облачное хранение заметок с шифрованием (см. TASK_MDNOTES_CLOUD.md,
    // шаг 1 "Ядро") — только эти узкие функции, привязанные к ветке
    // /notes(Meta) ТЕКУЩЕГО syncId, а не сам syncId и не URL Firebase:
    // Firebase-специфика остаётся здесь, в my.js (см. fetchNotesCloudPath/
    // deleteNotesCloudPath/patchNotesCloud/generateNoteId выше).
    // ---------------------------------------------------------------------
    getSyncId: function(){ return syncId; },
    openSyncModal: openModal,
    fetchCloudPath: fetchNotesCloudPath,
    patchCloud: patchNotesCloud,
    deleteCloudPath: deleteNotesCloudPath,
    generateId: generateNoteId,
    notesPushDebounceMs: PUSH_DEBOUNCE_MS,
    notesRetryDelays: SYNC_RETRY_DELAYS
  });
  var renderSettingsTabMdEditor = MdEditor.renderSettingsTabMdEditor;
  var renderSettingsTabMdBookmarks = MdEditor.renderSettingsTabMdBookmarks;
  // "Забытые заметки" (4-я вкладка вертикального стека второго набора,
  // set2s_4 — ТЗ пользователя от 04.09), см. switchSettingsTab ниже
  var renderSettingsTabForgottenNotes = MdEditor.renderSettingsTabForgottenNotes;
  var flushPendingMdEditorEdit = MdEditor.flushPendingMdEditorEdit;

  // ===================== ПОИСК =====================
  // Логика вкладки "Поиск" (третья боковая вкладка второго набора,
  // settingsTabSet2Btn3 / "set2s_3") вынесена в отдельный файл search.js
  // (см. index.html и sw.js) — по тому же образцу, что и MdEditor выше.
  // ЭТО БОЛЬШЕ НЕ ЗАГЛУШКА (ТЗ пользователя от 08.09) — два независимых
  // режима: "Поиск по задачам" и "Поиск по заметкам" (переключаются
  // кнопками внизу вкладки, см. search.js). Иконки-пиктограммы приходят
  // геттерами, а не готовыми строками — PENCIL_ICON_SVG объявляется в
  // этом файле НИЖЕ по тексту (var, не function — не поднимается), геттер
  // читает её уже готовой на момент реального клика, а не в момент
  // создания модуля здесь.
  var Search = window.initSearchModule({
    escapeHtml: escapeHtml,
    switchSettingsTab: switchSettingsTab,
    openNoteByIdExternally: MdEditor.openNoteByIdExternally,
    getSearchableNotes: MdEditor.getSearchableNotes,
    // архив (выполненные задачи) в поиске не участвует — по ТЗ
    getSearchableTasks: function(){
      return getAllTasks().filter(function(t){ return t.c.checked !== true; });
    },
    renderTaskRowEdit: renderTaskRowEdit,
    bindTaskRowActions: bindTaskRowActions,
    fitTaskActions: fitTaskActions,
    getPencilIcon: function(){ return PENCIL_ICON_SVG; },
    getCheckIcon: function(){ return CHECK_ICON_SVG; },
    getMoveIcon: function(){ return ARROW_MOVE_ICON_SVG; },
    getNextIcon: function(){ return LINK_NEXT_ICON_SVG; }
  });
  var renderSettingsTabSearch = Search.renderSettingsTabSearch;

  initTaskGlobalToolbar();

  // ---------------------------------------------------------------------
  // Глобальные "Ж" (форматирование выделения), "Аа" (размер шрифта),
  // текстовыделитель и скрепка (вставка картинки) на вкладках задач (см.
  // #taskFormatWrap/#taskFontSizeWrap/#taskHighlightWrap/#taskAttachWrap
  // в index.html) — по одной кнопке на всё приложение, а не по одной на
  // строку, поэтому применяются к тому .task-editable, что открыт для
  // редактирования ПРЯМО СЕЙЧАС (в один момент времени редактируется не
  // больше одной строки — остальные при этом уже сохранены, см.
  // flushPendingTaskEdits/flushPendingCommentEdits).
  // "Аа" использует ТОТ ЖЕ fontSizeStep, что и "Мои заметки" (см.
  // MdEditor.changeFontSizeStep в mdeditor.js) — единица размера, стало
  // быть, общая на оба места (см. ТЗ пользователя от 31.08). Текстовыделитель
  // — та же функция wrapEditableSelection("==","=="), что и у "Ж"/"К"/"П"/
  // "Ч", просто без попапа (added 13.09, та же иконка, что и в "Моём
  // блокноте", см. HIGHLIGHT_ICON_SVG в mdeditor.js). Скрепка — тот же
  // принцип "![[имя]]"/images/ (OPFS), что и там же (см.
  // MdEditor.saveImageBytes/getImageBlobUrl), добавлена позже (см. ТЗ
  // пользователя от 11.09).
  // ---------------------------------------------------------------------
  // Пока открыт системный диалог выбора файла для скрепки (см.
  // taskAttachBtn ниже) — поле .task-editable ТЕРЯЕТ фокус (blur), а blur
  // у него — сигнал "пользователь закончил редактировать", запускающий
  // сохранение текста и перерисовку строки ОБРАТНО в обычный вид (см. три
  // обработчика blur — renderTaskRowEdit/renderCommentRowEdit/renderRowEdit
  // в openTaskNextPicker). Раз сама вставка "![[имя]]" происходит уже
  // ПОСЛЕ того, как файл выбран и сохранён (асинхронно) — к этому моменту
  // старый .task-editable, в который метили, был бы уже удалён из DOM,
  // и вставлять было бы уже некуда (найден баг от 12.09 — картинка молча
  // не появлялась). Флаг взводится перед открытием диалога и держит все
  // три blur-обработчика "на паузе" (см. ранний return в каждом из них),
  // пока не разрешится промис вставки — тогда и заново фокусируемый (см.
  // insertTextIntoTaskEditable) editable остаётся в DOM живым.
  var taskAttachDialogOpen = false;

  function initTaskGlobalToolbar(){
    // preventDefault на mousedown — чтобы контент-эдитабл не терял фокус/
    // выделение раньше, чем сработает click (иначе к моменту click строка
    // уже была бы пересохранена и перерисована в обычный вид, см.
    // renderTaskRowEdit/renderRowEdit/renderCommentRowEdit — их blur
    // сохраняет и заменяет DOM строки).
    function stopMousedown(btn){
      if(btn) btn.addEventListener("mousedown", function(e){ e.preventDefault(); });
    }

    // --- "Аа" ---
    var fontSizePanelOpen = false;
    var fontBtn = document.getElementById("taskFontSizeBtn");
    var fontPopup = document.getElementById("taskFontSizePopup");
    var fontPlusBtn = document.getElementById("taskFontPlusBtn");
    var fontMinusBtn = document.getElementById("taskFontMinusBtn");
    stopMousedown(fontBtn); stopMousedown(fontPlusBtn); stopMousedown(fontMinusBtn);
    if(fontBtn){
      fontBtn.addEventListener("click", function(){
        fontSizePanelOpen = !fontSizePanelOpen;
        if(fontPopup) fontPopup.classList.toggle("open", fontSizePanelOpen);
      });
    }
    function changeTaskFontSizeStep(delta){
      // пересчёт подгонки кнопок (см. fitTaskActions выше) теперь встроен
      // прямо в applyFontSize (mdeditor.js) — единая точка на ЛЮБОЕ
      // изменение размера шрифта, а не только на клик "+"/"-" здесь, см.
      // передачу refitAllVisibleTaskBodies в deps при вызове
      // initMdEditorModule выше.
      MdEditor.changeFontSizeStep(delta);
    }
    if(fontPlusBtn) fontPlusBtn.addEventListener("click", function(){ changeTaskFontSizeStep(1); });
    if(fontMinusBtn) fontMinusBtn.addEventListener("click", function(){ changeTaskFontSizeStep(-1); });

    // --- "Ж" (форматирование выделения) ---
    var formatPanelOpen = false;
    var formatBtn = document.getElementById("taskFormatBtn");
    var formatPopup = document.getElementById("taskFormatPopup");
    stopMousedown(formatBtn);
    if(formatBtn){
      formatBtn.addEventListener("click", function(){
        formatPanelOpen = !formatPanelOpen;
        if(formatPopup) formatPopup.classList.toggle("open", formatPanelOpen);
      });
    }
    function bindTaskFmtBtn(id, prefix, suffix){
      var btn = document.getElementById(id);
      if(!btn) return;
      stopMousedown(btn);
      btn.addEventListener("click", function(){
        wrapEditableSelection(prefix, suffix);
        formatPanelOpen = false;
        if(formatPopup) formatPopup.classList.remove("open");
      });
    }
    bindTaskFmtBtn("taskFmtBoldBtn", "**", "**");
    bindTaskFmtBtn("taskFmtItalicBtn", "*", "*");
    bindTaskFmtBtn("taskFmtUnderlineBtn", "++", "++");
    bindTaskFmtBtn("taskFmtStrikeBtn", "~~", "~~");

    // --- текстовыделитель (та же функция, что и "Ж"/"К"/"П"/"Ч" выше, но
    // без попапа — один клик сразу оборачивает выделение, тот же приём,
    // что и у HIGHLIGHT_ICON_SVG-кнопки в "Моём блокноте", см. mdeditor.js) ---
    var highlightBtn = document.getElementById("taskHighlightBtn");
    stopMousedown(highlightBtn);
    if(highlightBtn){
      highlightBtn.addEventListener("click", function(){
        wrapEditableSelection("==", "==");
      });
    }

    // --- скрепка (вставка картинки, тот же принцип "![[имя]]"/OPFS
    // images/, что и "Аа"/"Ж" выше — общий с "Моими заметками", через
    // MdEditor.saveImageBytes/getImageBlobUrl, см. mdeditor.js) ---
    var attachBtn = document.getElementById("taskAttachBtn");
    var attachInput = document.getElementById("taskAttachInput");
    stopMousedown(attachBtn);
    // Куда вставлять "![[имя]]" после выбора файла — захватывается В
    // МОМЕНТ клика по скрепке, ДО открытия системного диалога выбора
    // файла: после его закрытия фокус/выделение внутри contenteditable-
    // поля на практике часто теряются (особенно на мобильных), так что
    // спрашивать про них уже поздно — держим тут.
    var taskImageInsertTarget = null;
    if(attachBtn){
      attachBtn.addEventListener("click", function(){
        var editable = document.querySelector(".task-editable");
        if(!editable) return;
        var range = null;
        var sel = window.getSelection();
        if(sel && sel.rangeCount > 0){
          var r = sel.getRangeAt(0);
          if(editable.contains(r.commonAncestorContainer)) range = r.cloneRange();
        }
        taskImageInsertTarget = { editable: editable, range: range };
        // взводим ДО открытия диалога — сам клик по input уже вызывает
        // blur у editable (см. taskAttachDialogOpen выше)
        taskAttachDialogOpen = true;
        if(attachInput) attachInput.click();
      });
    }
    if(attachInput){
      // пользователь закрыл диалог, ничего не выбрав — снимаем флаг сразу,
      // иначе редактирование осталось бы "на паузе" навсегда
      attachInput.addEventListener("cancel", function(){
        taskAttachDialogOpen = false;
      });
      attachInput.addEventListener("change", function(){
        var file = attachInput.files && attachInput.files[0];
        attachInput.value = ""; // разрешаем выбрать тот же файл ещё раз
        var target = taskImageInsertTarget;
        taskImageInsertTarget = null;
        if(!file || !target){
          taskAttachDialogOpen = false;
          return;
        }
        var reader = new FileReader();
        reader.onload = function(){
          var bytes = new Uint8Array(reader.result);
          MdEditor.saveImageBytes(file.name, bytes, file.type).then(function(finalName){
            insertTextIntoTaskEditable(target.editable, target.range, "![[" + finalName + "]]");
          }).catch(function(){
            // не удалось сохранить картинку — хотя бы возвращаем фокус в
            // editable, чтобы редактирование не осталось "подвешенным"
            if(target.editable && document.body.contains(target.editable)) target.editable.focus();
          }).then(function(){
            taskAttachDialogOpen = false;
          });
        };
        reader.onerror = function(){ taskAttachDialogOpen = false; };
        reader.readAsArrayBuffer(file);
      });
    }
  }

  // Вставка произвольного текста в contenteditable-поле задачи/комментария
  // в заранее захваченную позицию курсора (см. taskImageInsertTarget выше
  // в initTaskGlobalToolbar) — используется кнопкой-скрепкой. Без
  // сохранённого range (или если сохранённый узел уже не в DOM — строка
  // успела перерисоваться, пока шёл выбор файла) вставляет в конец поля,
  // тем же приёмом, что и wrapEditableSelection выше, только не оборачивая
  // выделение, а просто вставляя текст в точку.
  function insertTextIntoTaskEditable(editable, range, text){
    if(!editable || !document.body.contains(editable)) return;
    editable.focus();
    var sel = window.getSelection();
    var useRange = range;
    if(!useRange || !document.body.contains(useRange.startContainer)){
      useRange = document.createRange();
      useRange.selectNodeContents(editable);
      useRange.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(useRange);
    useRange.deleteContents();
    var node = document.createTextNode(text);
    useRange.insertNode(node);
    var newRange = document.createRange();
    newRange.setStartAfter(node);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    editable.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // оборачивает ВЫДЕЛЕННЫЙ прямо сейчас текст (внутри того
  // .task-editable, что сейчас редактируется — см. initTaskGlobalToolbar
  // выше) markdown-маркерами форматирования. Если выделения нет — просто
  // ничего не делает (оборачивать в пустые маркеры нечего). После вставки
  // выделение переносится на обёрнутый текст, чтобы можно было сразу
  // применить ещё один стиль поверх (например Ж, затем К).
  function wrapEditableSelection(prefix, suffix){
    var editable = document.querySelector(".task-editable");
    if(!editable) return;
    var sel = window.getSelection();
    if(!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if(range.collapsed) return;
    if(!editable.contains(range.commonAncestorContainer)) return;
    var selectedText = range.toString();
    if(!selectedText) return;
    range.deleteContents();
    var node = document.createTextNode(prefix + selectedText + suffix);
    range.insertNode(node);
    var newRange = document.createRange();
    newRange.selectNode(node);
    sel.removeAllRanges();
    sel.addRange(newRange);
    // ручная вставка через Range не порождает событие "input" сама по
    // себе — уведомляем редактируемую строку вручную тем же событием,
    // которое она и так слушает (см. renderTaskRowEdit/renderRowEdit/
    // renderCommentRowEdit), чтобы плейсхолдер/подгонка кнопок обновились
    editable.dispatchEvent(new Event("input", { bubbles: true }));
  }

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
      '<p class="modal-note">Скачает ZIP-архив со всеми вашими данными: прогресс чтения, настроение, достижение целей, задачи, заметки (с картинками) и книги.</p>' +
      '</div>';
  }
  // READER_PLAN.md, Этап B, шаг 5 (11.09): раньше архив содержал только
  // data.json (rawState.data и так уже включает записи задач ("task:*"),
  // но только как технический снимок для восстановления — отдельная
  // папка tasks/ ниже нужна как читаемая копия, тем же принципом, что и
  // остальные разделы data.json). Теперь дополнительно кладём в архив:
  // notes/ (заметки "Мой блокнот", через MdEditor.getNotesFilesForExport —
  // те же данные, что и в "Мои заметки.zip", см. downloadAllNotesZip в
  // mdeditor.js), tasks/tasks.json (getAllTasks() как есть), images/
  // (картинки заметок из OPFS, через MdEditor.getImageFilesForExport) и
  // books/ (книги из OPFS, через getBookFilesForExport выше). Без оглядки
  // на обратную совместимость со старыми копиями (раздел ТЗ — пользователей
  // с локальными копиями пока нет). Сбор картинок/книг асинхронный (чтение
  // OPFS), поэтому вся функция теперь ждёт Promise.all и на время сборки
  // блокирует кнопку — на устройстве с большой библиотекой книг/картинок
  // это может занять заметное время, и повторный клик собрал бы архив
  // дважды параллельно.
  function bindExportButton(){
    var btn = document.getElementById("mExportData");
    if(!btn) return;
    btn.addEventListener("click", function(){
      if(btn.disabled) return;
      var originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Собираю архив…";
      Promise.all([
        MdEditor && MdEditor.getImageFilesForExport ? MdEditor.getImageFilesForExport() : Promise.resolve([]),
        getBookFilesForExport()
      ]).then(function(results){
        var imageFiles = results[0] || [];
        var bookFiles = results[1] || [];
        var noteFiles = (MdEditor && MdEditor.getNotesFilesForExport) ? MdEditor.getNotesFilesForExport() : [];
        var taskFiles = [{name: "tasks.json", data: new TextEncoder().encode(JSON.stringify(getAllTasks(), null, 2))}];

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
          "Этот файл можно отдать нейросети для анализа корреляций между чтением, отмеченным временем и настроением.\n" +
          "Папка notes/ — заметки «Моего блокнота» (.md, со структурой папок).\n" +
          "Папка tasks/ — задачи (tasks.json), читаемая копия того же, что уже есть в rawState.data.\n" +
          "Папка images/ — картинки, вставленные в заметки.\n" +
          "Папка books/ — загруженные книги (fb2 и др.).\n"
        );

        var zipFiles = [
          {name:"data.json", content:jsonBytes},
          {name:"README.txt", content:readmeBytes}
        ];
        noteFiles.forEach(function(f){ zipFiles.push({name:"notes/" + f.name, content:f.data}); });
        taskFiles.forEach(function(f){ zipFiles.push({name:"tasks/" + f.name, content:f.data}); });
        imageFiles.forEach(function(f){ zipFiles.push({name:"images/" + f.name, content:f.data}); });
        bookFiles.forEach(function(f){ zipFiles.push({name:"books/" + f.name, content:f.data}); });

        var blob = buildZipBlob(zipFiles);
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "bible-tracker-export-" + isoDate(Date.now()) + ".zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      }).catch(function(e){
        console.error("Ошибка экспорта:", e);
        alert("Не удалось собрать архив с данными. Попробуйте ещё раз.");
      }).finally(function(){
        btn.disabled = false;
        btn.textContent = originalLabel;
      });
    });
  }

  // ===================== ИМПОРТ ЛИЧНЫХ ДАННЫХ =====================
  // Читает файл, экспортированный кнопкой "Экспортировать личные данные"
  // (сам ZIP-архив, собранный bindExportButton, или, для старых копий,
  // извлечённый из него data.json), и даёт пользователю выбрать, ЧТО
  // именно восстановить. READER_PLAN.md, Этап B, шаг 6 (11.09): раньше
  // импорт был "всё или ничего" (полная замена state содержимым
  // rawState.data) — теперь при выборе ZIP-архива показываются галочки
  // только по тем категориям, что реально нашлись внутри: "Заметки"
  // (notes/), "Задачи" (task:*/taskcompletion:* внутри rawState.data),
  // "Картинки заметок" (images/), "Книги" (файлы books/ и/или ключи
  // book:<хэш> внутри rawState.data — Шаг 18 READER_PLAN.md) и "Всё
  // остальное" (сам rawState.data, за вычетом ключей задач и ключей книг —
  // прогресс чтения, счётчик часов, настроение, цели, комментарии,
  // настройки). При выборе
  // одного data.json (без остальных папок — старые копии, либо файл,
  // извлечённый вручную из архива) доступна только категория "Всё
  // остальное" (и "Задачи", если в нём есть ключи задач). Каждая
  // отмеченная категория ПОЛНОСТЬЮ заменяет то, что есть на устройстве —
  // без слияния (по тем же причинам, по которым подключение по коду
  // синхронизации тоже больше не выполняет объединение, см. joinWithCode:
  // слепое объединение по временным меткам может оставить "победителем"
  // случайные/тестовые отметки вместо настоящих данных); неотмеченные
  // категории на устройстве не трогаются, даже если для них в архиве
  // есть более свежие данные.

  function isTaskStateKey(k){
    return k.indexOf("task:") === 0 || k.indexOf("taskcompletion:") === 0;
  }

  // Разбирает выбранный файл целиком: и .json (просто текст), и .zip
  // (через MiniZip.extractAllFiles — тот же универсальный разбор
  // произвольного .zip, что уже используют handleImportImagesZip в
  // mdeditor.js и handleImportBooksFile выше, поэтому отдельный
  // самописный разбор центрального каталога здесь больше не нужен и убран:
  // extractAllFiles уже умеет и STORED, и DEFLATE). Возвращает
  // Promise<{rawStateData, noteEntries, imageEntries, bookEntries}>.
  function readImportArchive(file){
    var lowerName = (file.name || "").toLowerCase();
    var isJson = lowerName.endsWith(".json") || file.type === "application/json";
    if(isJson){
      return file.text().then(function(text){
        var parsed;
        try{ parsed = JSON.parse(text); }catch(e){ throw new Error("bad_json"); }
        if(!parsed || !parsed.rawState || typeof parsed.rawState.data !== "object"){
          throw new Error("no_raw_state");
        }
        return { rawStateData: parsed.rawState.data, noteEntries: [], imageEntries: [], bookEntries: [] };
      });
    }
    if(!window.MiniZip || !window.MiniZip.extractAllFiles){
      return Promise.reject(new Error("no_zip_module"));
    }
    return file.arrayBuffer().then(function(buf){
      return window.MiniZip.extractAllFiles(buf);
    }).then(function(entries){
      var decoder = new TextDecoder();
      var dataEntry = null;
      entries.forEach(function(e){ if(/(^|\/)data\.json$/i.test(e.path)) dataEntry = e; });
      if(!dataEntry) throw new Error("no_data_json");
      var parsed;
      try{ parsed = JSON.parse(decoder.decode(dataEntry.data)); }catch(e){ throw new Error("bad_json"); }
      if(!parsed || !parsed.rawState || typeof parsed.rawState.data !== "object"){
        throw new Error("no_raw_state");
      }

      var noteEntries = [];
      entries.forEach(function(e){
        if(e.path.indexOf("notes/") !== 0 || !/\.md$/i.test(e.path)) return;
        var rel = e.path.slice("notes/".length);
        var slash = rel.lastIndexOf("/");
        var dir = slash >= 0 ? rel.slice(0, slash) : "";
        var base = slash >= 0 ? rel.slice(slash + 1) : rel;
        var noteName = base.replace(/\.md$/i, "").trim() || "Без названия";
        noteEntries.push({ name: noteName, path: dir, text: decoder.decode(e.data) });
      });

      var imageEntries = [];
      entries.forEach(function(e){
        if(e.path.indexOf("images/") !== 0) return;
        var rel = e.path.slice("images/".length);
        if(!rel) return;
        imageEntries.push({ name: rel.slice(rel.lastIndexOf("/") + 1), data: e.data });
      });

      var bookEntries = [];
      entries.forEach(function(e){
        if(e.path.indexOf("books/") !== 0) return;
        var rel = e.path.slice("books/".length);
        if(!rel) return;
        bookEntries.push({ name: rel.slice(rel.lastIndexOf("/") + 1), data: e.data });
      });

      return { rawStateData: parsed.rawState.data, noteEntries: noteEntries, imageEntries: imageEntries, bookEntries: bookEntries };
    });
  }

  function importSectionHtml(){
    return '<div class="modal-section">' +
      '<button class="modal-btn" id="mImportData">Импортировать личные данные</button>' +
      '<input type="file" id="mImportFileInput" accept=".zip,.json,application/json,application/zip" style="display:none">' +
      '<p class="modal-note">Восстановит данные из файла, полученного кнопкой «Экспортировать личные данные» (ZIP-архив или, для старых копий, файл data.json). После выбора файла можно будет отметить, что именно восстановить — каждая отмеченная категория полностью заменит то, что уже есть на этом устройстве.</p>' +
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
      readImportArchive(file).then(function(payload){
        renderImportCategoriesScreen(payload);
      }).catch(function(err){
        console.error("Ошибка импорта:", err);
        var msg = "Не удалось прочитать файл. Убедитесь, что выбран ZIP-архив или data.json, полученные экспортом из этого приложения.";
        if(err && err.message === "no_raw_state") msg = "В этом файле нет данных для восстановления (возможно, он экспортирован старой версией приложения). Экспортируйте данные заново с другого устройства.";
        if(err && err.message === "no_zip_module") msg = "Не удалось прочитать .zip: модуль ZIP не загружен.";
        modalBox.innerHTML = modalHeader("Не получилось импортировать", msg) + '<button class="modal-btn primary" id="mBack">Назад</button>';
        bindClose();
        document.getElementById("mBack").addEventListener("click", renderModalHome);
      });
    });
  }

  // Категории — в порядке показа; countFrom указывает, из какого массива
  // payload считать число найденных элементов для подписи (null — у
  // категории нет отдельного списка файлов, она про ключи rawState.data).
  var IMPORT_CATEGORY_DEFS = [
    { key: "notes", label: "Заметки", countFrom: "noteEntries" },
    { key: "tasks", label: "Задачи", countFrom: null },
    { key: "images", label: "Картинки заметок", countFrom: "imageEntries" },
    { key: "books", label: "Книги", countFrom: "bookEntries" },
    { key: "all", label: "Всё остальное (прогресс чтения, счётчик часов, настроение, цели, комментарии)", countFrom: null }
  ];

  // Какие категории реально нашлись в разобранном архиве (payload — из
  // readImportArchive выше) — по ним и показываются галочки на экране
  // выбора (раздел ТЗ Шага 6: "показывать галочки только по тем папкам,
  // что реально нашлись в архиве").
  function importPayloadCategories(payload){
    var taskKeysFound = Object.keys(payload.rawStateData).some(isTaskStateKey);
    // Шаг 18 READER_PLAN.md (12.09): ключи book:<хэш> (модель состояния
    // книги, см. isBookStateKey) — часть категории "Книги" наравне с
    // файлами books/, поэтому категория показывается и если найдены только
    // ключи состояния, без самих файлов (например, книга ещё не скачана на
    // это устройство, но прогресс/закладки к ней уже пришли из облака).
    var bookKeysFound = Object.keys(payload.rawStateData).some(isBookStateKey);
    return IMPORT_CATEGORY_DEFS.filter(function(def){
      if(def.key === "notes") return payload.noteEntries.length > 0;
      if(def.key === "images") return payload.imageEntries.length > 0;
      if(def.key === "books") return payload.bookEntries.length > 0 || bookKeysFound;
      if(def.key === "tasks") return taskKeysFound;
      return true; // "all" — data.json (и в нём rawState.data) есть у любого валидного файла
    });
  }

  function renderImportCategoriesScreen(payload){
    var categories = importPayloadCategories(payload);
    var rows = categories.map(function(def){
      var count = def.countFrom ? payload[def.countFrom].length : null;
      var label = def.label + (count != null ? " (" + count + ")" : "");
      return '<div class="settings-row"><span>' + escapeHtml(label) + '</span><input type="checkbox" class="mImportCat" data-cat="' + def.key + '" checked></div>';
    }).join("");
    modalBox.innerHTML = modalHeader("Что восстановить",
        "Отметьте, что восстановить из файла. Каждая отмеченная категория полностью заменит то, что есть на этом устройстве — объединения с текущими данными нет, отменить действие после импорта будет нельзя.") +
      '<div class="modal-section">' + rows + '</div>' +
      '<button class="modal-btn danger" id="mImportConfirm">Импортировать отмеченное</button>' +
      '<button class="modal-btn" id="mBack">Отмена</button>';
    bindClose();
    document.getElementById("mBack").addEventListener("click", renderModalHome);
    document.getElementById("mImportConfirm").addEventListener("click", function(){
      var checked = Array.prototype.slice.call(modalBox.querySelectorAll(".mImportCat:checked"))
        .map(function(cb){ return cb.dataset.cat; });
      if(!checked.length){
        alert("Отметьте хотя бы одну категорию для восстановления.");
        return;
      }
      var selection = {};
      checked.forEach(function(k){ selection[k] = true; });
      applyImportSelection(payload, selection);
    });
  }

  // Применяет отмеченные пользователем категории (selection — объект вида
  // {all,tasks,notes,images,books}, см. renderImportCategoriesScreen).
  // "Задачи", "Книги" (ключи book:<хэш>, Шаг 18 READER_PLAN.md, 12.09) и
  // "Всё остальное" — все три технически часть одного rawState.data,
  // поэтому здесь их явно разносят по ключам на три непересекающиеся
  // группы: "Всё остальное" применяет все ключи rawState.data, КРОМЕ
  // task:*/taskcompletion:* и book:*; "Задачи" — только task:*/
  // taskcompletion:*; "Книги" — только book:*. Так снятая галочка у любой
  // из трёх категорий не трогает соответствующие данные на устройстве,
  // даже если остальные две отмечены. Заметки/картинки/файлы книг — через
  // отдельные функции replaceAll*FromEntries (mdeditor.js/выше), каждая
  // полностью заменяет соответствующее хранилище.
  function applyImportSelection(payload, selection){
    if(selection.all || selection.tasks || selection.books){
      var newState = {};
      Object.keys(state).forEach(function(k){
        var isTask = isTaskStateKey(k);
        var isBook = isBookStateKey(k);
        if(isTask && !selection.tasks) newState[k] = state[k];
        else if(isBook && !selection.books) newState[k] = state[k];
        else if(!isTask && !isBook && !selection.all) newState[k] = state[k];
      });
      Object.keys(payload.rawStateData).forEach(function(k){
        var isTask = isTaskStateKey(k);
        var isBook = isBookStateKey(k);
        if(isTask && selection.tasks) newState[k] = payload.rawStateData[k];
        else if(isBook && selection.books) newState[k] = payload.rawStateData[k];
        else if(!isTask && !isBook && selection.all) newState[k] = payload.rawStateData[k];
      });
      state = newState;
      saveLocalState();
    }

    if(selection.notes && MdEditor && MdEditor.replaceAllNotesFromEntries){
      MdEditor.replaceAllNotesFromEntries(payload.noteEntries);
    }

    var jobs = [];
    if(selection.images && MdEditor && MdEditor.replaceAllImagesFromEntries){
      jobs.push(MdEditor.replaceAllImagesFromEntries(payload.imageEntries));
    }
    if(selection.books){
      jobs.push(replaceAllBooksFromEntries(payload.bookEntries));
    }

    modalBox.innerHTML = modalHeader("Восстанавливаю…", "Это может занять некоторое время, если в архиве много картинок или книг.");
    Promise.all(jobs).then(function(){
      setNoTransitions(true);
      rerenderAllFromState();
      setTimeout(function(){ setNoTransitions(false); }, 50);
      // Шаг 7 READER_PLAN.md (критичный фикс, 11.09): импорт НЕ должен
      // трогать syncId — ни сбрасывать, ни менять. Ключ шифрования заметок
      // в облаке — SHA-256(syncId), обнуление кода после импорта означало
      // бы потерю доступа к уже зашифрованным в облаке заметкам. Раньше
      // здесь был сброс syncId при selection.all — убран целиком.
      refreshStatusBase();
      renderImportDoneScreen();
    }).catch(function(e){
      console.error("Ошибка импорта:", e);
      modalBox.innerHTML = modalHeader("Не получилось завершить импорт",
          "Часть отмеченных данных могла не восстановиться: " + (e && e.message ? e.message : e)) +
        '<button class="modal-btn primary" id="mBack">Закрыть</button>';
      bindClose();
      document.getElementById("mBack").addEventListener("click", closeModal);
    });
  }

  function renderImportDoneScreen(){
    // Шаг 7 READER_PLAN.md (11.09): раньше здесь была отдельная ветка для
    // fullState (импорт категории "Всего остального") с предложением
    // создать новый код синхронизации, т.к. импорт сбрасывал syncId. Импорт
    // больше не трогает syncId ни при каких условиях — ветка убрана,
    // экран теперь один и тот же для любого набора восстановленных категорий.
    modalBox.innerHTML = modalHeader("Данные восстановлены", "Отмеченные данные восстановлены на этом устройстве.") +
      '<button class="modal-btn primary" id="mDone">Готово</button>';
    bindClose();
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
      '<div class="code-row"><input type="text" id="codeText" readonly value="' + code + '"><button id="codeCopy">Копировать</button></div>' +
      // Шаг 7 READER_PLAN.md (11.09): код синхронизации — это ещё и ключ
      // шифрования заметок в облаке (SHA-256(syncId)), поэтому предупреждение
      // о секретности стоит именно там, где код показывается пользователю.
      '<p class="modal-note">Никому не сообщайте этот код: через него происходит шифрование всех ваших данных в облаке, включая заметки.</p>';
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
  // пределы (#settingsTabs — правее, через right:-45px; .settings-tabs-gear
  // — ниже, через bottom:-45px, см. modals.css). Проценты 0..100 этот
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
    // "продолжить с того же места" (см. getResumeSettingsState выше) —
    // вместо того, чтобы всегда открывать окно на вкладке "настройки"/
    // "красные" задачи, показываем набор и вкладку, на которых человек
    // остановился в прошлый раз, даже если приложение успели закрыть
    // полностью.
    var resume = getResumeSettingsState();
    // "Продолжить с того же места" распространяется и на экран "Все задачи
    // проекта" (openTaskNextPicker) — читаем сохранённую позицию ДО
    // switchSettingsTab ниже: он сам вызовет обычный рендер списка
    // проектов, который штатно стирает эту запись (см.
    // clearProjectPickerResumeState в renderTaskTabList), так что после
    // switchSettingsTab читать уже нечего.
    var pickerStateToResume = (resume.tab === "projects") ? loadProjectPickerResumeState() : null;
    settingsActiveTabSet = resume.set;
    applySettingsTabSetVisibility();
    switchSettingsTab(resume.tab);
    if(pickerStateToResume){
      var proj = getTaskById(pickerStateToResume.projectId);
      if(proj && proj.c && proj.c.tab === "projects" && proj.c.checked !== true){
        // если экран был открыт — тут же поверх подменяем список проектов
        // этим экраном, так же, как это делает клик по кнопке-цепочке на
        // строке проекта
        openTaskNextPicker(pickerStateToResume.projectId, "projects", pickerStateToResume.scrollTop);
      } else {
        clearProjectPickerResumeState();
      }
    }
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
  // ФИКСИРОВАННОЙ высоте — у самого нижнего края экрана (fabTop = 100%
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
    // Экран "Все задачи проекта" (openTaskNextPicker) — свой вложенный
    // скролл-контейнер: #settingsTabContent там overflow:hidden через
    // .task-project-modal-body и сам никогда не скроллится (см. modals.css),
    // реальный скролл — у #taskProjectArea. Схлопывание/восстановление
    // высоты окна ниже (style.height = "") просаживается по flex-цепочке и
    // до него тоже, так что его scrollTop нужно спасать той же техникой,
    // что и у content.
    var projectArea = document.getElementById("taskProjectArea");
    if(content && !content.innerHTML.trim()) renderSettingsTabGear();
    // Пока ниже временно снимается высота окна (style.height = ""), контент
    // на миг перестаёт скроллиться (весь помещается) — браузер сам обнуляет
    // scrollTop, и после возврата высоты назад он остаётся нулевым (баг со
    // скроллом списка задач при закрытии клавиатуры, ТЗ от 02.09: реальная
    // причина была здесь, а не в самом contenteditable — guardTaskListScroll
    // в debug.js эту потерю ловил и откатывал реактивно, отсюда был виден
    // рывок). Запоминаем и восстанавливаем явно, чтобы скролл не терялся
    // вовсе, а не чинился постфактум.
    var savedContentScroll = content ? content.scrollTop : 0;
    var savedProjectAreaScroll = projectArea ? projectArea.scrollTop : null;
    if (window.Debug) window.Debug.log("layoutSettingsModal: старт, scrollTop до схлопывания=" + savedContentScroll + " scrollHeight/clientHeight=" + (content ? content.scrollHeight + "/" + content.clientHeight : "(нет content)"));

    // Окно "пришито" снизу к кнопке-язычку (.settings-fab), а не сверху к
    // экрану: нижний край окна всегда стоит на фиксированной точке —
    // у самого нижнего края экрана (fabTop = 100% высоты окна браузера),
    // а верхний край растянут до самого верха оверлея (minTop, естественное
    // положение по CSS — 16px от верха оверлея, см. padding-top). Ширина и
    // высота окна больше не ограничены никаким фиксированным числом (ни
    // WINDOW_H, ни CSS max-width/max-height) — окно всегда занимает всё
    // доступное место между minTop и fabTop, то есть ограничено только
    // реальным размером экрана пользователя, а не искусственным пределом.
    settingsModalBox.style.height = "";
    settingsModalBox.style.marginTop = "";
    var naturalTop = settingsModalBox.getBoundingClientRect().top; // 16px по CSS
    // Кнопка-язычок (и вместе с ней всё окно, см. комментарий выше) была
    // приклеена ровно к window.innerHeight — т.е. к самому нижнему краю
    // вьюпорта. На андроиде с жестовой навигацией там же поверх стоит
    // системная плашка управления (тот самый серый "пилюлеобразный"
    // индикатор снизу экрана) — кнопка пряталась под ней. Высота этой
    // плашки замерена по присланному скриншоту (в оригинальном размере,
    // 1220×718): область под системную навигацию — сплошная светлая
    // полоса от y=670 до нижнего края кадра (y=718) — ровно 48px. На
    // это же число теперь и поднимаем fabTop, чтобы кнопка (и низ окна)
    // всегда стояли выше этой плашки, а не под ней.
    var ANDROID_NAV_BAR_H = 47; // px, замерено по скриншоту пользователя + 20px, чтобы поднять кнопку-язычок (.settings-fab) выше; уменьшено на 15px, затем поднято на 2px, затем опущено ещё на 8px (вместе с рядами вкладок и кнопкой — см. .settings-tabs/.settings-tabs-gear в modals.css), чтобы у окна не было "дыры" между его нижним краем и рядами
    var fabTop = window.innerHeight - ANDROID_NAV_BAR_H;
    var minTop = naturalTop; // не даём окну вылезти выше верхнего края оверлея
    // Высота окна больше не фиксируется числом (раньше — 658px, WINDOW_H):
    // окно всегда растягивается на всё доступное место между верхом
    // оверлея (minTop) и кнопкой-язычком (fabTop) — ограничена только
    // реальной высотой экрана пользователя.
    var desiredTop = minTop;
    var desired = fabTop - desiredTop;

    settingsModalBox.style.marginTop = (desiredTop - naturalTop) + "px";
    settingsModalBox.style.height = desired + "px";
    if(content){
      // ИСПРАВЛЕНИЕ (ТЗ пользователя от 12.09, четвёртый заход): именно
      // здесь была настоящая причина "мгновенного прыжка" списка задач
      // проекта — не в rerenderAllFromState/фоновой синхронизации (см.
      // правку в openTaskNextPicker выше, она чинит другой, более редкий
      // случай), а в этой самой функции. Она вызывается из window
      // resize-слушателя ниже с задержкой 120мс ПОСЛЕ blur — а blur
      // редактируемого поля закрывает мобильную клавиатуру, что само по
      // себе всегда бросает resize. То есть эта функция срабатывает
      // практически сразу после того, как пользователь заканчивает
      // редактирование и тапает мимо — что и ощущается как "мгновенно".
      //
      // Сам механизм: выше временно снимается фиксированная высота окна
      // (style.height = ""), из-за чего #settingsTabContent на миг
      // перестаёт быть скроллящимся (весь список умещается) — код уже
      // ПЫТАЛСЯ решить это раньше (см. savedContentScroll выше), но
      // восстанавливал scrollTop СРАЗУ после возврата style.height,
      // БЕЗ принудительного пересчёта layout между ними. Браузер применяет
      // новую высоту (reflow) лениво — если между "вернули высоту" и
      // "выставили scrollTop" не заставить его пересчитать размеры прямо
      // сейчас, scrollTop выставляется ещё по СТАРЫМ (схлопнутым) размерам
      // контейнера и обрезается обратно до 0, даже несмотря на то что мы
      // явно пытаемся вернуть прежнее значение. Чтение любого
      // layout-свойства (offsetHeight) между этими двумя строками
      // заставляет браузер пересчитать размеры НЕМЕДЛЕННО, до того как
      // мы запишем scrollTop — тогда восстановление срабатывает по-настоящему.
      void content.offsetHeight; // форсируем reflow с уже восстановленной высотой окна
      content.scrollTop = savedContentScroll;
      if(projectArea && savedProjectAreaScroll != null) projectArea.scrollTop = savedProjectAreaScroll;
      if (window.Debug) window.Debug.log("layoutSettingsModal: конец, scrollTop сейчас=" + content.scrollTop + " (хотели=" + savedContentScroll + ") scrollHeight/clientHeight=" + content.scrollHeight + "/" + content.clientHeight);
    }
    // Высота язычков вертикального стека (#settingsTabs .settings-tab)
    // больше не считается здесь — она зафиксирована в CSS (68px, не
    // зависит от высоты окна настроек, см. .settings-tab в modals.css).

    // Ширина вкладок горизонтального ряда под окном (шестерёнка + карта
    // дней года + 3 заглушки, см. .settings-tab-gear в modals.css) больше
    // не считается здесь — она зафиксирована в CSS (68px на вкладку, не
    // зависит от ширины окна настроек, раньше делилась поровну между
    // 5 вкладками через переменную --settings-tab-size-h).

    // Кнопка-язычок теперь полноразмерная: её толщина (width) — те же
    // 45px, что и у обычных вертикальных язычков, а длина (height) — те
    // же 45px, что и толщина (height) язычков нижнего ряда (см.
    // .settings-tab-gear в modals.css) — так кнопка визуально продолжает
    // именно нижний ряд, а не торчит выше его.
    // По вертикали кнопка по-прежнему стоит вплотную к нижнему краю рамки
    // (без зазора) — это совпадает с верхним краем нижнего ряда вкладок,
    // т.к. оба стоят на одной высоте под рамкой.
    // По горизонтали же кнопка раньше стояла у правого края РАМКИ
    // (frameRect.right) — а рамка растянута на всю доступную ширину
    // экрана (см. .settings-modal-frame{width:100%} в modals.css), тогда
    // как сам нижний ряд вкладок (.settings-tabs-gear) занимает лишь
    // часть этой ширины слева (левый край рамки, left:0) и заметно короче
    // — между последней вкладкой ряда и кнопкой получался большой
    // произвольный зазор. Теперь кнопка ставится не от края рамки, а
    // вплотную к правому краю ИМЕННО видимого нижнего ряда — с тем же
    // зазором в 1px, что и между соседними вкладками внутри ряда
    // (gap:1px в .settings-tabs-gear), — так кнопка визуально продолжает
    // ряд, а не торчит поодаль от него. Наборов вкладок два
    // (#settingsTabsGear / #settingsTabsGearSet2, см.
    // applySettingsTabSetVisibility) — виден всегда только один, второй
    // скрыт через display:none и не имеет размеров, поэтому просто берём
    // тот, чья ширина больше нуля.
    var settingsGearBtn = document.getElementById("settingsGearBtn");
    if(settingsGearBtn){
      var frameRect = frame.getBoundingClientRect();
      var gearRow = document.getElementById("settingsTabsGear");
      var gearRow2 = document.getElementById("settingsTabsGearSet2");
      var gearRowRect = gearRow ? gearRow.getBoundingClientRect() : null;
      if(!gearRowRect || gearRowRect.width === 0){
        gearRowRect = gearRow2 ? gearRow2.getBoundingClientRect() : null;
      }
      var gearRowRight = (gearRowRect && gearRowRect.width > 0) ? gearRowRect.right : frameRect.left;
      settingsGearBtn.style.left = Math.round(gearRowRight + 1) + "px";
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

  // ===================== ЗАПОМИНАНИЕ СКРОЛЛА ВКЛАДОК (ТЗ 12.09) =====================
  // Общая функция для ЛЮБОЙ вкладки #settingsTabContent — тем же приёмом,
  // что currentScrollPercent/persistDocStateNow/scheduleDocStateSave в
  // mdeditor.js (там для одной открытой заметки, здесь — для вкладки
  // целиком): ПРОЦЕНТ скролла (0..1), а не абсолютные пиксели, потому что
  // высота содержимого между рендерами вкладки может отличаться (задача
  // добавилась/удалилась и т.п.). В отличие от mdeditor.js, где сам
  // скролл-контейнер (.cm-scroller) пересоздаётся при каждом открытии
  // заметки и слушатель приходится вешать/снимать заново — здесь
  // #settingsTabContent один и тот же DOM-узел на всё время жизни
  // страницы (просто меняется innerHTML), поэтому слушатель достаточно
  // повесить ОДИН раз при старте (initTabScrollTracking, вызывается в
  // самом низу файла, см. "ЗАПУСК").
  //
  // Хранится в localStorage одним общим объектом {tab: percent} — тем же
  // способом, что и остальные точечные scroll-позиции в этом файле
  // (SUBTITLE_EXTRACT_SCROLL_KEY, PROJECT_PICKER_SCROLL_MAP_KEY), поэтому
  // переживает полное закрытие приложения, а не только переключение
  // вкладок внутри одной сессии.
  //
  // Подключена пока к двум местам, как просил пользователь: все вкладки
  // задач (TASK_TAB_IDS, ниже) и список книг (set2s_7, только в режиме
  // списка — см. renderSettingsTabBooks; сам экран чтения книги живёт по
  // своей, более сложной схеме восстановления места, см. bookReaderState
  // выше, её трогать не нужно). Остальные вкладки (mdeditor, поиск,
  // забытые заметки и т.п.) уже либо имеют свою систему восстановления
  // позиции, либо не нуждаются в ней — чтобы подключить сюда ещё
  // какую-то вкладку, достаточно вызвать restoreTabScroll(tab) в нужном
  // месте её рендера (см. пример ниже, в renderSettingsTabBooks) и
  // добавить её ключ в TAB_SCROLL_AUTO_TABS.
  var TAB_SCROLL_STATE_KEY = "tabScrollPercents_v1";
  var tabScrollPercents = {}; // {tabKey: 0..1}, читается один раз при старте
  (function loadTabScrollPercents(){
    try{
      var raw = localStorage.getItem(TAB_SCROLL_STATE_KEY);
      if(raw) tabScrollPercents = JSON.parse(raw) || {};
    }catch(e){}
  })();
  var tabScrollSaveTimer = null;
  function scheduleTabScrollSave(){
    if(tabScrollSaveTimer) clearTimeout(tabScrollSaveTimer);
    tabScrollSaveTimer = setTimeout(function(){
      tabScrollSaveTimer = null;
      try{ localStorage.setItem(TAB_SCROLL_STATE_KEY, JSON.stringify(tabScrollPercents)); }catch(e){}
    }, 500);
  }
  // Вкладки, для которых scrollTop не сбрасывается в 0 при переключении, а
  // восстанавливается из tabScrollPercents (см. switchSettingsTab ниже).
  var TAB_SCROLL_AUTO_TABS = Object.keys(TASK_TAB_IDS).concat(["set2s_7"]);
  function initTabScrollTracking(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.addEventListener("scroll", function(){
      var max = container.scrollHeight - container.clientHeight;
      var pct = max > 0 ? Math.max(0, Math.min(1, container.scrollTop / max)) : 0;
      tabScrollPercents[currentSettingsTab] = pct;
      scheduleTabScrollSave();
    }, { passive: true });
  }
  // Восстанавливает сохранённую позицию скролла вкладки. Для синхронно
  // рендерящихся вкладок (все вкладки задач) достаточно вызвать сразу
  // после рендера — читаем scrollHeight внутри requestAnimationFrame,
  // чтобы браузер успел применить свежую разметку. Для АСИНХРОННО
  // дорисовывающихся вкладок (например, список книг, читается из OPFS)
  // этого недостаточно — там нужен отдельный вызов из места, где
  // содержимое реально появилось в DOM (см. renderSettingsTabBooks).
  function restoreTabScroll(tab){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var pct = tabScrollPercents[tab];
    requestAnimationFrame(function(){
      var max = container.scrollHeight - container.clientHeight;
      container.scrollTop = (pct && max > 0) ? pct * max : 0;
    });
  }

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
    // "Отвязываем" ссылку на предыдущий рендер экрана "Все задачи проекта"
    // от rerenderAllFromState (activeProjectPickerRerender выше) — она
    // валидна только пока этот экран РЕАЛЬНО показан в #settingsTabContent.
    // Если переключаемся именно на "projects" и есть запомненный проект
    // (activeProjectPickerId, см. openTaskNextPicker/"Домик" ниже — ТЗ
    // пользователя от 12.09, седьмой заход: "неудобно перезаходить"),
    // openTaskNextPicker ниже сам перезапишет её актуальным render(); во
    // всех остальных случаях (другая вкладка, список проектов через
    // "Домик") экран действительно покидается — обнуляем.
    activeProjectPickerRerender = null;
    flushPendingYearDayNoteEdit();
    flushPendingYearCommentEdits();
    flushPendingTaskEdits();
    flushPendingCommentEdits();
    flushPendingMdEditorEdit();
    destroySubtitleScrollListener();
    // Уход из экрана чтения книги (set2s_7, bookReaderState) на ЛЮБУЮ
    // другую вкладку — фикс от 12.09 (ТЗ пользователя, девятый заход:
    // "переносит в какую-то другую часть книги... но не то место, где я
    // оставлял скрол"). Раньше текущая позиция читалась заново только при
    // ВОЗВРАТЕ на "Книги" (см. renderBookReader ниже) — но к этому моменту
    // #settingsTabContent уже показывает чужую вкладку, а не текст книги,
    // поэтому currentBookReaderPosition там всегда возвращал null, и
    // renderBookReaderText откатывался на bookReaderState.textScrollTop
    // (не обновлявшийся с момента открытия книги, то есть 0/устаревшее
    // значение) вместо места, где пользователь реально остановился —
    // именно поэтому книга каждый раз открывалась в одном и том же месте,
    // а не там, где был оставлен скролл. Читаем позицию ЗДЕСЬ, пока
    // контейнер ещё показывает текст/главы книги (до того, как ниже по
    // функции его перезапишет рендер целевой вкладки), и кладём её и в
    // restorePosition (применится один раз при следующем renderBookReaderText/
    // renderBookReaderChapters), и в textScrollTop/chaptersScrollTop (запасной
    // путь), и сразу в постоянное хранилище (setBookPosition) — на случай
    // перезапуска приложения раньше следующего дебаунса.
    if(prevTab === "set2s_7" && tab !== "set2s_7" && bookReaderState){
      var leavingReaderContainer = document.getElementById("settingsTabContent");
      if(leavingReaderContainer){
        if(bookReaderState.mode === "chapters"){
          bookReaderState.chaptersScrollTop = leavingReaderContainer.scrollTop;
        } else {
          var leavingBookPos = currentBookReaderPosition(leavingReaderContainer);
          if(leavingBookPos){
            bookReaderState.restorePosition = leavingBookPos;
            bookReaderState.textScrollTop = leavingReaderContainer.scrollTop;
            setBookPosition(bookReaderState.hash, leavingBookPos);
          }
        }
      }
      destroyBookReaderScrollListener();
    }
    // запоминаем позицию только если это реальная вкладка одного из двух
    // стеков (бокового или нижнего, набор 1 или 2) — служебные экраны вроде
    // "versions"/"import"/"resetConfirm" (открываются кнопками ВНУТРИ
    // вкладки настроек) не считаются отдельной позицией и не сбивают
    // запомненное место — см. cycleSettingsTabSet ниже.
    if(SETTINGS_SIDE_ORDER_1.indexOf(tab) !== -1 || SETTINGS_BOTTOM_ORDER_1.indexOf(tab) !== -1 ||
       SETTINGS_SIDE_ORDER_2.indexOf(tab) !== -1 || SETTINGS_BOTTOM_ORDER_2.indexOf(tab) !== -1){
      settingsLastStackTab = tab;
      // тоже в localStorage — settingsLastStackTab сам живёт только в
      // памяти вкладки и не переживает перезапуск приложения (см.
      // getResumeSettingsState/SETTINGS_LAST_TAB_KEY выше).
      try{ localStorage.setItem(SETTINGS_LAST_TAB_KEY, tab); }catch(e){}
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
    // Вкладки из TAB_SCROLL_AUTO_TABS (задачи + список книг) сами
    // восстанавливают свою позицию скролла ниже, после рендера (см.
    // restoreTabScroll) — им сбрасывать scrollTop сейчас не нужно, а для
    // set2s_7 в режиме чтения книги (bookReaderState) это вообще сделал
    // бы renderBookReader() по-своему чуть ниже. Для всех остальных
    // вкладок поведение прежнее — сброс к началу перед их собственным
    // рендером.
    var isAutoScrollTab = TAB_SCROLL_AUTO_TABS.indexOf(tab) !== -1;
    if(container && !isAutoScrollTab) container.scrollTop = 0;
    // Вынесено в отдельную функцию syncTaskFabRowForTab (13.09, см. её
    // определение выше) — тот же синк нужен ещё и кнопке "Домик" на экране
    // "Все задачи проекта": она возвращается к списку проектов НЕ через
    // switchSettingsTab (см. openTaskNextPicker — сознательно, чтобы не
    // плодить лишний шаг истории), поэтому раньше "+" (спрятанная там же,
    // см. globalFab в openTaskNextPicker) при возврате не восстанавливалась.
    syncTaskFabRowForTab(tab);
    if(tab === "mood"){ renderSettingsTabMood(); }
    else if(tab === "year") renderSettingsTabYear();
    else if(tab === "versions") renderSettingsTabVersions();
    else if(tab === "import") renderSettingsTabImportPicker();
    else if(tab === "resetConfirm") renderSettingsTabResetConfirm();
    else if(tab === "moodResetConfirm") renderSettingsTabMoodResetConfirm();
    // "Projects" — если внутри неё уже была открыта карточка конкретного
    // проекта ("Все задачи проекта", см. openTaskNextPicker и
    // activeProjectPickerId ниже) и её не закрывали явно кнопкой-домиком —
    // повторный заход на вкладку возвращает именно её, а не список всех
    // проектов заново (ТЗ пользователя от 12.09, седьмой заход, тот же
    // принцип, что и у "Книг" ниже, set2s_7). activeProjectPickerId, в
    // отличие от activeProjectPickerRerender выше, НЕ обнуляется при уходе
    // с вкладки — переживает переключение на любые другие вкладки, как
    // bookReaderState у книг.
    else if(tab === "projects" && activeProjectPickerId) openTaskNextPicker(activeProjectPickerId, "projects");
    else if(TASK_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabTask(tab);
    else if(EXTRA_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabExtra(tab);
    else if(tab === "set2b_1") renderSettingsTabWorkbooks();
    else if(tab === "set2b_2") renderSettingsTabS89Fill();
    else if(tab === "set2b_3") renderSettingsTabNotesMerge();
    else if(tab === "set2b_4") renderSettingsTabSubtitleExtract();
    else if(tab === "set2s_1") renderSettingsTabMdEditor();
    // вторая боковая вкладка второго набора (set2s_2) — ЭТО БОЛЬШЕ НЕ
    // ЗАГЛУШКА: вкладка "Закладки" — плоский список заметок из "Моего
    // блокнота" (set2s_1), отмеченных закладкой, см.
    // renderSettingsTabMdBookmarks/renderBookmarksScreen в mdeditor.js;
    // вынесена ДО общей проверки на renderSettingsTabSet2Stub по тому же
    // принципу, что и остальные уже не-заглушки этого набора выше.
    else if(tab === "set2s_2") renderSettingsTabMdBookmarks();
    // третья боковая вкладка второго набора (set2s_3) — ЭТО БОЛЬШЕ НЕ
    // ЗАГЛУШКА: вкладка "Поиск" (поиск по задачам/поиск по заметкам, см.
    // search.js, ТЗ пользователя от 08.09) — тем же способом вынесена ДО
    // общей проверки на renderSettingsTabSet2Stub, что и остальные уже
    // не-заглушки этого набора выше.
    else if(tab === "set2s_3") renderSettingsTabSearch();
    // 4-я вкладка вертикального стека второго набора (set2s_4) — ЭТО
    // БОЛЬШЕ НЕ ЗАГЛУШКА: "Забытые заметки" — список заметок, давно не
    // редактировавшихся (см. renderSettingsTabForgottenNotes в
    // mdeditor.js), тем же способом вынесена ДО общей проверки на
    // renderSettingsTabSet2Stub, что и остальные уже не-заглушки этого
    // набора (ТЗ пользователя от 04.09).
    else if(tab === "set2s_4") renderSettingsTabForgottenNotes();
    else if(tab === "set2s_5") renderSettingsTabEpubSplit();
    else if(tab === "set2s_6") renderSettingsTabImgResize();
    // седьмая боковая вкладка второго набора (set2s_7) — ЭТО БОЛЬШЕ НЕ
    // ЗАГЛУШКА (READER_PLAN.md, Этап D, шаг 9, 11.09): список fb2-книг из
    // books/ (OPFS), тем же способом вынесена ДО общей проверки на
    // renderSettingsTabSet2Stub, что и остальные уже не-заглушки этого
    // набора выше — см. renderSettingsTabBooks ниже.
    // Возврат на вкладку "Книги" после ухода на другую вкладку настроек
    // (ТЗ пользователя от 12.09) — если книга уже была открыта (bookReaderState
    // не сброшен, память ридера жива), показываем именно её и тот же режим
    // (текст/главы), а не список книг заново; bookReaderState сбрасывается в
    // null только при реальном выходе из книги (см. "Домик"/AppNav-колбэк в
    // openBookReader выше), переключение вкладок его не трогает.
    else if(tab === "set2s_7"){
      var isFirstBooksVisitThisSession = !booksTabVisitedThisSession;
      booksTabVisitedThisSession = true;
      if(bookReaderState) renderBookReader();
      else if(isFirstBooksVisitThisSession && getLastOpenedBookName()){
        // Фикс от 13.09 — см. комментарий у LAST_OPENED_BOOK_KEY выше.
        // Показываем список сразу (не оставлять пустой экран, пока книга
        // грузится из OPFS и парсится), openBookReader сам подменит его на
        // текст книги, когда будет готово; если книги вдруг больше нет
        // (переустановка/очистка OPFS) — openBookReader сам покажет ошибку
        // поверх уже отрисованного списка (см. её catch внутри).
        renderSettingsTabBooks();
        openBookReader(getLastOpenedBookName());
      }
      else renderSettingsTabBooks();
    }
    else if(SET2_TAB_IDS.hasOwnProperty(tab) || SET2_EXTRA_TAB_IDS.hasOwnProperty(tab)) renderSettingsTabSet2Stub();
    else renderSettingsTabGear();

    // Вкладки задач рендерятся синхронно (innerHTML уже собран строкой
    // выше, к этому моменту готов) — восстанавливаем скролл сразу. Для
    // set2s_7 (список книг) восстановление вызывается отдельно, из самого
    // renderSettingsTabBooks, потому что список дорисовывается позже,
    // асинхронно (см. там). "Projects" пропускается, если вместо списка
    // сейчас открыта карточка проекта (activeProjectPickerId, см. выше) —
    // там свой, отдельный скролл-контейнер #taskProjectArea (не
    // #settingsTabContent), с собственной памятью позиции (см.
    // openTaskNextPicker/getSavedProjectScrollTop).
    if(TASK_TAB_IDS.hasOwnProperty(tab) && !(tab === "projects" && activeProjectPickerId)) restoreTabScroll(tab);

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
  // Оставшиеся вкладки второго набора пока показывают один и тот же текст —
  // функции под них появятся позже. set2s_7 («Книги») выведена из их числа
  // и вынесена ДО этой проверки (см. switchSettingsTab выше) — READER_PLAN.md,
  // Этап D, шаг 9 (11.09): это уже полноценный список книг, а не заглушка,
  // см. renderSettingsTabBooks ниже.
  function renderSettingsTabSet2Stub(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    container.innerHTML = '<div class="mood-diagram-empty">Вкладка пока не запрограммирована.<br>Контент появится позже.</div>';
  }

  // ===========================================================================
  // Хранилище книг books/ (OPFS) — READER_PLAN.md, Этап A, шаг 2 (09.09).
  // Сам список fb2-книг (вкладка set2s_7) появится только в Этапе D, шаге 7 —
  // но модель хранения и кнопка загрузки готовятся уже здесь, тем же приёмом
  // без диалога/прав, что и images/ в mdeditor.js (см. getImagesDirHandle
  // там, тот же комментарий про отсутствие queryPermission/requestPermission
  // у OPFS применим и тут). Из mdeditor.js это НЕ переиспользуется напрямую —
  // модуль mdeditor.js целиком про заметки/картинки и не знает про книги;
  // когда появится полноценный books.js (шаг 7), эти функции стоит перенести
  // туда без изменения сигнатур.
  // ===========================================================================
  var booksDirHandle = null;      // FileSystemDirectoryHandle | null (подпапка books/ в OPFS)
  var booksDirReadyPromise = null; // промис текущего/последнего getBooksDirHandle()
  function getBooksDirHandle(){
    if(booksDirHandle) return Promise.resolve(booksDirHandle);
    if(!booksDirReadyPromise){
      if(!navigator.storage || !navigator.storage.getDirectory){
        booksDirReadyPromise = Promise.reject(new Error("Браузер не поддерживает OPFS."));
      } else {
        booksDirReadyPromise = navigator.storage.getDirectory().then(function(root){
          return root.getDirectoryHandle("books", { create: true });
        }).then(function(handle){
          booksDirHandle = handle;
          return handle;
        }).catch(function(e){
          booksDirReadyPromise = null; // разрешаем попробовать ещё раз позже
          throw e;
        });
      }
    }
    return booksDirReadyPromise;
  }

  // Хэш содержимого файла (SHA-256, hex) — основа дедупликации книг
  // (раздел "Шаг 2" READER_PLAN.md: "по хэшу содержимого файла, не по
  // имени"). buffer — ArrayBuffer.
  function sha256Hex(buffer){
    return crypto.subtle.digest("SHA-256", buffer).then(function(digest){
      var bytes = new Uint8Array(digest), hex = "";
      for(var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
      return hex;
    });
  }

  // Простой JSON-манифест хэш -> имя файла внутри books/ — минимальная
  // локальная дедупликация ДО того, как появится общий реестр файлов с
  // синхронизацией между устройствами (Этап A, шаг 3, Firebase). Имя
  // файла манифеста начинается с точки — будущий список книг (шаг 7)
  // отфильтрует его тем же приёмом, каким сейчас список папок в "Моих
  // заметках" прячет скрытые записи (см. renderListScreen в mdeditor.js:
  // fo.name.charAt(0) !== ".").
  var BOOKS_MANIFEST_NAME = ".manifest.json";
  function loadBooksManifest(dir){
    return dir.getFileHandle(BOOKS_MANIFEST_NAME, { create: false }).then(function(fh){
      return fh.getFile().then(function(f){ return f.text(); });
    }).then(function(text){
      try{
        var m = JSON.parse(text);
        return (m && typeof m === "object") ? m : {};
      }catch(e){ return {}; }
    }).catch(function(){ return {}; }); // манифеста ещё нет (первая книга) — пустой
  }
  function saveBooksManifest(dir, manifest){
    return dir.getFileHandle(BOOKS_MANIFEST_NAME, { create: true }).then(function(fh){
      return fh.createWritable();
    }).then(function(w){
      return w.write(JSON.stringify(manifest)).then(function(){ return w.close(); });
    });
  }

  // Подбирает свободное ИМЯ файла (не хэш) — на случай, если разные по
  // содержимому книги (например, другое издание той же книги) называются
  // одинаково: раздел "Шаг 2" ТЗ прямо просит сохранить оба под разными
  // внутренними именами, а не считать их дублем. Тот же приём "(2)",
  // "(3)", что и у картинок в mdeditor.js (suggestFreeImageName).
  function suggestFreeBookName(name, takenNamesLower){
    var extM = /^(.*)(\.[^.]+)$/.exec(name);
    var base = extM ? extM[1] : name, ext = extM ? extM[2] : "";
    var m = /^(.*) \((\d+)\)$/.exec(base);
    var stem = m ? m[1] : base;
    var n = m ? Number(m[2]) + 1 : 2;
    var candidate;
    do{
      candidate = stem + " (" + n + ")" + ext;
      n++;
    } while(takenNamesLower.has(candidate.toLowerCase()));
    return candidate;
  }

  // Сохраняет один файл книги в books/ (OPFS) с дедупликацией по хэшу
  // содержимого. bytes — Uint8Array. Возвращает Promise<{added, name, hash,
  // size}> — added=false, если файл с таким же СОДЕРЖИМЫМ уже был сохранён
  // раньше (name — имя, под которым он реально лежит на диске). hash/size
  // добавлены (READER_PLAN.md, шаг 3) — вызывающему коду они нужны, чтобы
  // зарегистрировать файл в облачном реестре (см. registerBookInRegistry
  // ниже), не пересчитывая хэш повторно.
  function saveBookFile(name, bytes){
    var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return getBooksDirHandle().then(function(dir){
      return sha256Hex(buf).then(function(hash){
        return loadBooksManifest(dir).then(function(manifest){
          if(manifest[hash]){
            return { added: false, name: manifest[hash], hash: hash, size: bytes.byteLength };
          }
          var takenNamesLower = new Set(Object.keys(manifest).map(function(h){
            return manifest[h].toLowerCase();
          }));
          var finalName = takenNamesLower.has(name.toLowerCase()) ? suggestFreeBookName(name, takenNamesLower) : name;
          return dir.getFileHandle(finalName, { create: true }).then(function(fh){
            return fh.createWritable();
          }).then(function(w){
            return w.write(bytes).then(function(){ return w.close(); });
          }).then(function(){
            manifest[hash] = finalName;
            return saveBooksManifest(dir, manifest).then(function(){
              return { added: true, name: finalName, hash: hash, size: bytes.byteLength };
            });
          });
        });
      });
    });
  }

  // READER_PLAN.md, Этап B, шаг 5 (11.09) — плоский список байтов всех
  // книг для общего ZIP-бэкапа (см. bindExportButton ниже). Файл манифеста
  // дедупликации (BOOKS_MANIFEST_NAME, служебный, не книга) исключается.
  // books/ — плоская папка без вложенных подпапок (в отличие от images/ в
  // mdeditor.js), поэтому обход без рекурсии; тот же стиль for-await по
  // dirHandle.entries(), что и buildImageIndex в mdeditor.js. Возвращает
  // Promise<Array<{name, data:Uint8Array}>>, при ошибке — пустой массив
  // (не должна ронять остальной экспорт).
  function getBookFilesForExport(){
    return getBooksDirHandle().then(function(dir){
      var handles = [];
      async function collect(){
        for await (var entry of dir.entries()){
          var name = entry[0], handle = entry[1];
          if(handle.kind === "file" && name !== BOOKS_MANIFEST_NAME) handles.push({name: name, handle: handle});
        }
      }
      return collect().then(function(){
        return Promise.all(handles.map(function(item){
          return item.handle.getFile().then(function(f){ return f.arrayBuffer(); }).then(function(buf){
            return { name: item.name, data: new Uint8Array(buf) };
          });
        }));
      });
    }).catch(function(e){
      if(window.Debug) window.Debug.log("getBookFilesForExport: " + (e && e.message ? e.message : e));
      return [];
    });
  }

  // READER_PLAN.md, Этап B, шаг 6 (11.09) — стирает ВСЕ файлы в books/
  // (OPFS), включая файл-манифест дедупликации (он пересобирается заново
  // при следующем saveBookFile) — подготовка к категории "Книги"
  // выборочного импорта общего ZIP-бэкапа (см. replaceAllBooksFromEntries
  // ниже). books/ — плоская папка (см. getBookFilesForExport выше), но
  // removeEntry всё равно вызывается с recursive:true на случай, если
  // там когда-нибудь окажется подпапка.
  function clearBooksDir(){
    return getBooksDirHandle().then(function(dir){
      var names = [];
      async function collect(){
        for await (var entry of dir.entries()){ names.push(entry[0]); }
      }
      return collect().then(function(){
        return names.reduce(function(p, name){
          return p.then(function(){
            return dir.removeEntry(name, { recursive: true }).catch(function(){});
          });
        }, Promise.resolve());
      });
    });
  }

  // READER_PLAN.md, Этап B, шаг 6 (11.09) — категория "Книги" выборочного
  // импорта общего ZIP-бэкапа (см. applyImportSelection ниже): полностью
  // заменяет содержимое books/ файлами из архива. Сначала стирает всё
  // текущее (clearBooksDir выше), затем сохраняет файлы из архива
  // ПОСЛЕДОВАТЕЛЬНО — та же причина, что и у handleImportBooksFile ниже
  // (saveBookFile читает/переписывает общий файл-манифест, параллельные
  // вызовы устроили бы гонку) — и регистрирует их в облачном реестре
  // (registerBookInRegistry), как при обычной загрузке книги. entries —
  // [{name, data:Uint8Array}].
  function replaceAllBooksFromEntries(entries){
    return clearBooksDir().then(function(){
      function next(i){
        if(i >= entries.length) return Promise.resolve();
        var entry = entries[i];
        return saveBookFile(entry.name, entry.data).then(function(result){
          if(result.added) registerBookInRegistry(result.hash, result.name, result.size);
          return next(i + 1);
        });
      }
      return next(0);
    });
  }

  // =====================================================================
  // Реестр файлов + временное реле через Firebase Storage
  // (READER_PLAN.md, Этап A, шаг 3, 09.09).
  //
  // Ветка /syncs/<syncId>/files/<хэш> — по одной записи на файл книги:
  // {hash, size, name, addedBy, addedAt, uploadedAt, confirmedBy}, где
  // confirmedBy — словарь {deviceId: true}. Синхронизируется ТЕМ ЖЕ
  // PATCH-механизмом дельт, что и заметки — переиспользуются уже
  // существующие fetchNotesCloudPath/patchNotesCloud/deleteNotesCloudPath
  // (они универсальны: работают с любым relPath под текущим syncId,
  // несмотря на название "Notes" — см. комментарий у них выше), без
  // единой правки самого PATCH-приёма putCloudBlob.
  //
  // Сами байты файла временно живут в Firebase Storage — Realtime
  // Database знает только реестр (хэш/размер/имя/кто подтвердил), не
  // содержимое. Устройство, у которого файл есть локально, заливает его
  // в Storage сразу, как только видит в реестре, что кто-то из ИЗВЕСТНЫХ
  // устройств ещё не подтвердил получение (см. syncFilesRegistry). Файл
  // удаляется из Storage, как только подтвердили ВСЕ известные
  // устройства, либо через FILE_RELAY_TTL_MS после заливки — что раньше;
  // сама запись реестра (хэш/имя/размер) при этом не удаляется, теряется
  // только временная копия байтов в Storage.
  //
  // "Известные устройства" — записи в /syncs/<syncId>/devices/<id> с
  // недавней активностью (см. touchDeviceRegistry/DEVICE_KNOWN_WINDOW_MS
  // ниже): устройство считается известным, пока с него была хоть одна
  // успешная синхронизация в пределах этого окна — так надолго выключенное
  // или удалённое устройство рано или поздно перестаёт блокировать
  // удаление байтов из Storage.
  // =====================================================================
  var FILE_RELAY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
  var DEVICE_KNOWN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

  function touchDeviceRegistry(){
    if(!syncId) return Promise.resolve();
    var patch = {};
    patch["devices/" + getDeviceId()] = { t: Date.now() };
    return patchNotesCloud(patch).catch(function(){});
  }

  function storageObjectPath(hash){ return "syncFiles/" + hash; }

  function uploadFileToStorage(hash, bytes){
    var path = encodeURIComponent(storageObjectPath(hash));
    return fetchWithTimeout(FIREBASE_STORAGE_URL + path + "?uploadType=media", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes
    }, 30000).then(function(res){
      if(!res.ok) throw new Error("storage_upload_failed_" + res.status);
      return true;
    });
  }
  function downloadFileFromStorage(hash){
    var path = encodeURIComponent(storageObjectPath(hash));
    return fetchWithTimeout(FIREBASE_STORAGE_URL + path + "?alt=media", { method: "GET" }, 30000).then(function(res){
      if(!res.ok) throw new Error("storage_download_failed_" + res.status);
      return res.arrayBuffer();
    });
  }
  function deleteFileFromStorage(hash){
    var path = encodeURIComponent(storageObjectPath(hash));
    return fetchWithTimeout(FIREBASE_STORAGE_URL + path, { method: "DELETE" }, 15000).then(function(res){
      // 404 здесь не ошибка — байты уже удалены (другим устройством,
      // например) или так и не заливались; удаление идемпотентно.
      if(!res.ok && res.status !== 404) throw new Error("storage_delete_failed_" + res.status);
      return true;
    });
  }

  // Регистрирует только что добавленный локально файл книги в облачном
  // реестре — вызывается из handleImportBooksFile ниже сразу после
  // saveBookFile с added:true. Если запись с этим хэшем уже есть (кто-то
  // другой уже добавил тот же файл раньше нас) — не перезаписываем её.
  function registerBookInRegistry(hash, name, size){
    if(!syncId) return Promise.resolve();
    return fetchNotesCloudPath("files/" + hash).catch(function(){ return null; }).then(function(existing){
      if(existing) return;
      var entry = {
        hash: hash, size: size, name: name,
        addedBy: getDeviceId(), addedAt: Date.now(),
        uploadedAt: null, confirmedBy: {}
      };
      entry.confirmedBy[getDeviceId()] = true; // у добавившего устройства файл уже есть
      var patch = {};
      patch["files/" + hash] = entry;
      return patchNotesCloud(patch);
    }).then(function(){
      return syncFilesRegistry(); // сразу попробовать залить байты, если кто-то уже ждёт (см. ниже)
    }).catch(function(){});
  }

  // Главная точка сверки — вызывается фоном после каждой успешной
  // синхронизации (doCloudSync) и при каждом открытии вкладки книг (см.
  // renderSettingsTabBooks). Не блокирует UI, все ошибки по
  // отдельным файлам гасятся точечно (одна неудача не должна прерывать
  // обработку остальных записей реестра).
  var filesRegistrySyncInProgress = false;
  function syncFilesRegistry(){
    if(!syncId || !navigator.onLine) return Promise.resolve();
    if(filesRegistrySyncInProgress) return Promise.resolve();
    filesRegistrySyncInProgress = true;
    var myId = getDeviceId();
    return Promise.all([
      fetchNotesCloudPath("files").catch(function(){ return null; }),
      fetchNotesCloudPath("devices").catch(function(){ return null; }),
      getBooksDirHandle().then(loadBooksManifest).catch(function(){ return {}; })
    ]).then(function(results){
      var registry = results[0] || {}, devices = results[1] || {}, manifest = results[2] || {};
      var localHashes = {}; // hash -> true, что реально есть в books/ на этом устройстве
      Object.keys(manifest).forEach(function(h){ localHashes[h] = true; });
      var now = Date.now();
      var knownDeviceIds = Object.keys(devices).filter(function(id){
        var t = devices[id] && typeof devices[id].t === "number" ? devices[id].t : 0;
        return (now - t) <= DEVICE_KNOWN_WINDOW_MS;
      });

      var chores = Object.keys(registry).map(function(hash){
        var entry = registry[hash] || {};
        var confirmedBy = entry.confirmedBy || {};
        var haveLocally = !!localHashes[hash];

        // 1) У нас файла нет — скачиваем из Storage и подтверждаем получение.
        if(!haveLocally){
          return downloadFileFromStorage(hash).then(function(buf){
            return saveBookFile(entry.name || hash, new Uint8Array(buf));
          }).then(function(){
            var patch = {};
            patch["files/" + hash + "/confirmedBy/" + myId] = true;
            return patchNotesCloud(patch);
          }).catch(function(){
            // байтов ещё нет в Storage (никто пока не залил) или сеть
            // подвела — не страшно, попробуем на следующей сверке
          });
        }

        // 2) Файл у нас есть. Если не все известные устройства подтвердили
        // получение и байты сейчас не лежат в Storage (или уже больше не
        // нужны, но мы почему-то ещё не заливали) — заливаем.
        var missingConfirmations = knownDeviceIds.some(function(id){ return !confirmedBy[id]; });
        if(missingConfirmations && !entry.uploadedAt){
          return getBooksDirHandle().then(function(dir){
            return dir.getFileHandle(manifest[hash], { create: false });
          }).then(function(fh){
            return fh.getFile();
          }).then(function(file){
            return file.arrayBuffer();
          }).then(function(buf){
            return uploadFileToStorage(hash, buf);
          }).then(function(){
            var patch = {};
            patch["files/" + hash + "/uploadedAt"] = now;
            return patchNotesCloud(patch);
          }).catch(function(){});
        }

        // 3) Байты залиты и либо подтвердили все известные устройства,
        // либо истёк 7-дневный срок — удаляем временную копию из Storage.
        if(entry.uploadedAt && (!missingConfirmations || (now - entry.uploadedAt) > FILE_RELAY_TTL_MS)){
          return deleteFileFromStorage(hash).then(function(){
            var patch = {};
            patch["files/" + hash + "/uploadedAt"] = null;
            return patchNotesCloud(patch);
          }).catch(function(){});
        }

        return null;
      });

      return Promise.all(chores);
    }).catch(function(){}).finally(function(){
      filesRegistrySyncInProgress = false;
    });
  }

  // Обрабатывает выбранный файл — точка входа для кнопки "Загрузить fb2
  // или zip книг" (см. renderSettingsTabBooks ниже). Одиночный .fb2
  // сохраняется как есть; .zip разбирается через MiniZip.extractAllFiles
  // (произвольные бинарные записи, см. minizip.js) — из него берутся
  // только записи с расширением .fb2, остальное молча пропускается (сам
  // архив может быть просто "пачкой" из нескольких книг). Файлы
  // сохраняются ПОСЛЕДОВАТЕЛЬНО, не параллельно: saveBookFile читает и
  // переписывает один и тот же файл-манифест — при параллельных вызовах
  // это гонка (последняя запись манифеста молча стёрла бы предыдущую).
  function handleImportBooksFile(file, setStatusFn){
    var lowerName = (file.name || "").toLowerCase();
    if(lowerName.endsWith(".fb2")){
      file.arrayBuffer().then(function(buf){
        return saveBookFile(file.name, new Uint8Array(buf));
      }).then(function(result){
        setStatusFn(result.added ? "Книга сохранена." :
          "Такая книга уже была загружена раньше (файл \u00AB" + result.name + "\u00BB).", false);
        // Регистрация в облачном реестре (READER_PLAN.md, шаг 3) — только
        // для реально новых файлов; не блокирует статус-сообщение выше.
        if(result.added) registerBookInRegistry(result.hash, result.name, result.size);
      }).catch(function(e){
        setStatusFn("Не удалось сохранить книгу: " + (e && e.message ? e.message : e), true);
      });
      return;
    }
    if(lowerName.endsWith(".zip")){
      if(!window.MiniZip || !window.MiniZip.extractAllFiles){
        setStatusFn("Не удалось прочитать .zip: модуль ZIP не загружен.", true);
        return;
      }
      file.arrayBuffer().then(function(buf){
        return window.MiniZip.extractAllFiles(buf);
      }).then(function(files){
        var fb2Files = files.filter(function(f){ return /\.fb2$/i.test(f.path); });
        if(!fb2Files.length){
          setStatusFn("В архиве не найдено файлов .fb2.", true);
          return;
        }
        var added = 0, skipped = 0;
        function next(i){
          if(i >= fb2Files.length){
            setStatusFn("Загружено книг: " + added + (skipped ? ", уже было: " + skipped : "") + ".", false);
            return;
          }
          var entry = fb2Files[i];
          var baseName = entry.path.slice(entry.path.lastIndexOf("/") + 1);
          saveBookFile(baseName, entry.data).then(function(result){
            if(result.added){ added++; registerBookInRegistry(result.hash, result.name, result.size); }
            else skipped++;
            next(i + 1);
          }).catch(function(e){
            setStatusFn("Не удалось сохранить \u00AB" + baseName + "\u00BB: " + (e && e.message ? e.message : e), true);
          });
        }
        next(0);
      }).catch(function(e){
        setStatusFn("Не удалось прочитать .zip: " + (e && e.message ? e.message : e), true);
      });
      return;
    }
    setStatusFn("Выберите файл .fb2 или .zip.", true);
  }

  // ===================== МОДЕЛЬ СОСТОЯНИЯ КНИГИ (READER_PLAN.md, Этап C, шаг 8) =====================
  // Одна запись на книгу, привязанная к ХЭШУ файла (не к имени —
  // переименование файла не должно обнулять прогресс; хэш — тот же
  // sha256Hex, что уже считается в saveBookFile/handleImportBooksFile
  // выше и используется реестром файлов, см. 5183/5257). Хранится в общем
  // state под ключом "book:<hash>" — тем же приёмом {c, t}, что и задачи
  // (см. saveTaskData выше): попадает под уже существующий общий цикл
  // синхронизации (mergeStates/buildStateDelta/doCloudSync) без единой
  // новой строчки кода PATCH — просто новый префикс ключей в том же state.
  //
  // c = {position, bookmarks, underlines, noteId}
  //   position   — место, на котором пользователь остановился при чтении;
  //                точная форма (глава+абзац/смещение) зависит от того, что
  //                вернёт парсер fb2 (Этап D, шаг 10, ещё не реализован) —
  //                пока хранится как есть, opaque-значение; null, пока
  //                книга ни разу не открывалась в ридере.
  //   bookmarks  — [{id, position, addedAt}] — закладки на полях (шаг 15).
  //   underlines — [{id, position, addedAt, movedToNote}] — подчёркивания
  //                (шаг 13, реализовано 11.09; доработка 11.09 — снятие через
  //                плавающую кнопку-урну, см. removeBookUnderline/
  //                deleteBookUnderline ниже: теперь удаляются явным
  //                действием пользователя, просто не пропадают сами по
  //                себе); movedToNote — true, если уже дописано в конец
  //                заметки книги (чтобы не задваивать при повторном
  //                проходе, а при снятии — понять, есть ли вообще смысл
  //                пытаться убрать текст из заметки). position здесь —
  //                {ch, blk, s, e}: индекс главы,
  //                индекс блока внутри ch.blocks (см. Fb2Parse) и начало/
  //                конец диапазона в координатах ПЛОСКОГО текста абзаца
  //                (конкатенация block.runs[].text) — см.
  //                resolveSelectionToBlockPosition/renderRunsHtml ниже.
  //   noteId     — id заметки книги в "Моём блокноте" (mdeditor.js),
  //                создаётся один раз при первом подчёркивании (шаг 13) и
  //                дальше переиспользуется; null, пока заметки ещё нет.
  //
  // READER_PLAN.md, Шаг 18 (12.09, выполнено): категория импорта/экспорта
  // "Книги" включает и файлы books/, и эти ключи book:<hash> — см.
  // isBookStateKey ниже, importPayloadCategories/applyImportSelection в
  // разделе "ИМПОРТ ЛИЧНЫХ ДАННЫХ" выше.
  //
  // Имя ПОСЛЕДНЕЙ открытой книги — в localStorage, а не только в памяти
  // (bookReaderState ниже), тем же приёмом, что и SETTINGS_LAST_TAB_KEY
  // (см. выше). Фикс от 13.09 (ТЗ пользователя: "периодически при нажатии
  // на вкладку 'Мои книги' всё равно возвращает в список, а должно
  // показывать последнюю книгу — чаще всего так и есть, но в редких
  // случаях..."). Причина редких случаев: bookReaderState — обычная
  // переменная модуля, она переживает переключение вкладок настроек, но
  // НЕ переживает перезапуск скрипта — а мобильные браузеры периодически
  // перезагружают фоновую/свёрнутую вкладку PWA сами, без явного действия
  // пользователя. До этой правки при такой "невидимой" перезагрузке
  // вкладка "Мои книги" (set2s_7) восстанавливалась (SETTINGS_LAST_TAB_KEY
  // это уже умеет), а вот САМА книга — нет: bookReaderState после
  // перезапуска пуст, и ветка set2s_7 в switchSettingsTab (ниже) молча
  // откатывалась на список. Теперь при первом за это открытие приложения
  // заходе на set2s_7 (см. booksTabVisitedThisSession ниже), если книга
  // ещё не открыта в памяти, но есть запомненное имя — книга подхватывается
  // автоматически через openBookReader. Внутри уже идущей сессии, если
  // пользователь сам вышел в список (кнопка "Домик"/системное "назад"),
  // это НЕ переоткрывает книгу заново — только самый первый заход.
  var LAST_OPENED_BOOK_KEY = "bibleLastOpenedBook_v1";
  function saveLastOpenedBookName(name){
    try{ localStorage.setItem(LAST_OPENED_BOOK_KEY, name); }catch(e){}
  }
  function getLastOpenedBookName(){
    try{ return localStorage.getItem(LAST_OPENED_BOOK_KEY); }catch(e){ return null; }
  }
  function bookStateKey(hash){
    return "book:" + hash;
  }
  function isBookStateKey(k){
    return k.indexOf("book:") === 0;
  }
  function genBookRecordId(){
    return "bk" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }
  function getBookState(hash){
    var rec = state[bookStateKey(hash)];
    if(!rec || !rec.c) return null;
    return rec.c;
  }
  // Всегда возвращает объект (с дефолтами) — коду ридера (Этап D) не нужно
  // самому подставлять пустые значения при первом открытии книги.
  function getOrCreateBookState(hash){
    return getBookState(hash) || {position: null, bookmarks: [], underlines: [], noteId: null, images: [], bookName: null};
  }
  // Название книги в состоянии (ТЗ пользователя от 12.09: закладки/
  // подчёркивания должны быть видны в списке независимо от того, скачан ли
  // физический файл книги на ЭТО устройство) — записывается устройством, у
  // которого файл есть (см. вызов в openBookReader ниже), и дальше
  // синхронизируется в облако вместе с остальным book:<hash> тем же общим
  // механизмом state, что и у задач — без всякой зависимости от Firebase
  // Storage/реестра файлов. Устройство, где файла ещё нет, читает это поле
  // из уже пришедшего state и может показать закладку в общем списке
  // "Закладки", даже если открыть саму книгу пока нечем (см.
  // getBookMarginBookmarksForList/openBookAtMarginBookmark ниже).
  function ensureBookNameSynced(hash, name){
    var data = getOrCreateBookState(hash);
    if(data.bookName === name) return;
    data.bookName = name;
    saveBookState(hash, data);
  }
  function saveBookState(hash, data){
    // t — всегда время именно этого сохранения, та же причина, что и у
    // saveTaskData выше (last-write-wins при слиянии между устройствами).
    state[bookStateKey(hash)] = {c: data, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
  }
  function setBookPosition(hash, position){
    var data = getOrCreateBookState(hash);
    data.position = position;
    saveBookState(hash, data);
  }
  function addBookBookmark(hash, position, name, isMain){
    var data = getOrCreateBookState(hash);
    var rec = {id: genBookRecordId(), position: position, addedAt: Date.now(), name: name || "", isMain: !!isMain};
    data.bookmarks.push(rec);
    saveBookState(hash, data);
    return rec.id;
  }
  // Основная закладка книги (пиктограмма-корона в общем списке "Закладки",
  // см. saveBookReaderBookmark ниже) — максимум одна на книгу; при выборе
  // "обновить основную" старая удаляется, прежде чем добавить новую.
  function getMainBookBookmark(hash){
    var data = getBookState(hash);
    if(!data || !data.bookmarks) return null;
    return data.bookmarks.filter(function(b){ return b.isMain; })[0] || null;
  }
  // Снятие закладки (READER_PLAN.md, Этап D, шаг 15; переработано 12.09) —
  // в отличие от подчёркиваний (никогда не удаляются, см. комментарий у c
  // выше) закладки можно свободно убирать: клик по активной пиктограмме
  // закладки в общей вкладке "Закладки" (см. deps.removeBookMarginBookmark,
  // передаётся в mdeditor.js).
  function removeBookBookmark(hash, bookmarkId){
    var data = getOrCreateBookState(hash);
    data.bookmarks = data.bookmarks.filter(function(b){ return b.id !== bookmarkId; });
    saveBookState(hash, data);
  }
  // Закладка на полях конкретного абзаца текущей книги, если она есть —
  // position закладок здесь всегда {ch, blk} (весь абзац целиком, в
  // отличие от подчёркиваний, у которых ещё есть s/e — диапазон внутри
  // абзаца). Используется и при отрисовке (класс .book-reader-p-bookmarked,
  // см. renderBookReaderText), и при долгом нажатии (toggle, см. ниже).
  function getBookBookmarkForBlock(hash, ch, blk){
    var data = getBookState(hash);
    if(!data || !data.bookmarks) return null;
    return data.bookmarks.filter(function(b){
      return b.position && b.position.ch === ch && b.position.blk === blk;
    })[0] || null;
  }
  // Подчёркивания добавляются и помечаются перенесёнными в заметку; снятие —
  // отдельной функцией removeBookUnderline чуть ниже (доработка 11.09).
  function addBookUnderline(hash, position){
    var data = getOrCreateBookState(hash);
    var rec = {id: genBookRecordId(), position: position, addedAt: Date.now(), movedToNote: false};
    data.underlines.push(rec);
    saveBookState(hash, data);
    return rec.id;
  }
  function markBookUnderlineMovedToNote(hash, underlineId){
    var data = getOrCreateBookState(hash);
    var u = data.underlines.filter(function(item){ return item.id === underlineId; })[0];
    if(!u) return;
    u.movedToNote = true;
    saveBookState(hash, data);
  }
  // Снятие подчёркивания (READER_PLAN.md, шаг 13, доработка 11.09: плавающая
  // кнопка-урна при тапе на уже подчёркнутый текст) — единственное место,
  // физически удаляющее запись из data.underlines. Возвращает удалённую
  // запись (нужна вызывающему для movedToNote/position, см.
  // deleteBookUnderline ниже) или null, если id не найден.
  function removeBookUnderline(hash, underlineId){
    var data = getOrCreateBookState(hash);
    var idx = -1;
    for(var i = 0; i < data.underlines.length; i++){
      if(data.underlines[i].id === underlineId){ idx = i; break; }
    }
    if(idx === -1) return null;
    var removed = data.underlines.splice(idx, 1)[0];
    saveBookState(hash, data);
    return removed;
  }
  function setBookNoteId(hash, noteId){
    var data = getOrCreateBookState(hash);
    data.noteId = noteId;
    saveBookState(hash, data);
  }

  // Иллюстрации, отправленные в заметку книги (READER_PLAN.md, Этап D,
  // шаг 14, 11.09) — кнопка-кнопка по центру верхнего края картинки (см.
  // renderBookReaderText/toggleBookReaderImagePin ниже). Каждая запись —
  // {id, ch, blk, imageId, savedName, addedAt}: ch/blk — та же адресация,
  // что и у position подчёркиваний (глава + индекс блока в ch.blocks);
  // savedName — реальное имя файла в images/ (OPFS), может отличаться от
  // сгенерированного при коллизии имён (suggestFreeImageName в
  // mdeditor.js). В отличие от подчёркиваний, записи здесь УДАЛЯЮТСЯ при
  // повторном нажатии на кнопку — открепление реально стирает и файл, и
  // ссылку в заметке, а не просто "гасит" отметку.
  function getBookImageEntry(hash, ch, blk){
    var data = getBookState(hash);
    if(!data || !data.images) return null;
    return data.images.filter(function(it){ return it.ch === ch && it.blk === blk; })[0] || null;
  }
  function addBookImageEntry(hash, ch, blk, imageId, savedName){
    var data = getOrCreateBookState(hash);
    if(!data.images) data.images = [];
    var rec = {id: genBookRecordId(), ch: ch, blk: blk, imageId: imageId, savedName: savedName, addedAt: Date.now()};
    data.images.push(rec);
    saveBookState(hash, data);
  }
  function removeBookImageEntry(hash, ch, blk){
    var data = getOrCreateBookState(hash);
    if(!data.images) data.images = [];
    data.images = data.images.filter(function(it){ return !(it.ch === ch && it.blk === blk); });
    saveBookState(hash, data);
  }
  function isBookImagePinned(hash, ch, blk){
    return !!getBookImageEntry(hash, ch, blk);
  }
  // Расширение файла по MIME-типу картинки из fb2 (<binary content-type=…>)
  // — jpeg/png самые частые, остальное на всякий случай.
  function extFromImageContentType(ct){
    if(/png/i.test(ct)) return ".png";
    if(/gif/i.test(ct)) return ".gif";
    if(/webp/i.test(ct)) return ".webp";
    if(/svg/i.test(ct)) return ".svg";
    if(/bmp/i.test(ct)) return ".bmp";
    return ".jpg";
  }

  // Плоский список файлов books/ (OPFS) — READER_PLAN.md, Этап D, шаг 9
  // (11.09). Исключает служебный файл-манифест дедупликации
  // (BOOKS_MANIFEST_NAME) и любые другие файлы, начинающиеся с точки, тем
  // же приёмом, что и renderListScreen в mdeditor.js прячет скрытые записи
  // в "Моих заметках" (см. комментарий у BOOKS_MANIFEST_NAME выше). Тот же
  // порядок сортировки, что и у заметок там же: имена, начинающиеся с
  // цифры, — в конец списка, остальное — по алфавиту (localeCompare, ru,
  // sensitivity "base"). books/ — плоская папка без вложенных подпапок
  // (см. getBookFilesForExport выше), поэтому обход без рекурсии.
  // Возвращает Promise<Array<{name}>>.
  function listBooksEntries(){
    return getBooksDirHandle().then(function(dir){
      var out = [];
      async function collect(){
        for await (var entry of dir.entries()){
          var name = entry[0], handle = entry[1];
          if(handle.kind !== "file") continue;
          if(name.charAt(0) === ".") continue; // манифест и любые др. служебные файлы
          out.push({name: name});
        }
      }
      return collect().then(function(){
        out.sort(function(a, b){
          var da = /^\d/.test(a.name) ? 1 : 0;
          var db = /^\d/.test(b.name) ? 1 : 0;
          if(da !== db) return da - db;
          return a.name.localeCompare(b.name, "ru", { sensitivity: "base" });
        });
        return out;
      });
    });
  }

  // Седьмая боковая вкладка второго набора (set2s_7) — READER_PLAN.md,
  // Этап D, шаг 9 (11.09). ЭТО БОЛЬШЕ НЕ ЗАГЛУШКА: список fb2-книг из
  // books/ (OPFS), тем же образцом разметки, что и списки заметок/задач
  // (mdeditor-tab/-empty/-status/-list/-list-grid/-row/-row-name/
  // -list-actions/-list-action-btn, components.css) — свой стиль не
  // изобретаем, см. renderListScreen в mdeditor.js. Пиктограмма строки —
  // тот же контур раскрытой книги, что и у вкладки Read/пикера "Перенести
  // задачу" (TASK_MOVE_ICONS.read выше), вместо новой пиктограммы.
  //
  // Открытие книги (сам ридер, Этап D, шаг 10 и далее READER_PLAN.md) пока
  // не реализовано — эта вкладка сознательно ограничена только списком и
  // загрузкой, по прямой границе шага 9. Так же сознательно здесь пока нет
  // удаления книги (в отличие от заметок, где строку можно раскрыть долгим
  // нажатием) — удаление файла книги затронуло бы облачный реестр файлов
  // (см. registerBookInRegistry/syncFilesRegistry выше), для которого пока
  // не существует парной функции "разрегистрировать"; оставлено на
  // отдельный шаг, чтобы не проектировать это решение по ходу дела.
  function renderSettingsTabBooks(){
    // Лёгкая фоновая сверка реестра файлов при каждом заходе на вкладку
    // (READER_PLAN.md, шаг 3) — тем же приёмом, что и syncNotesOnTabEnter
    // у "Моих заметок"; не блокирует немедленный рендер ниже.
    syncFilesRegistry();
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var html = '<div class="mdeditor-tab">';
    html += '<h3 class="common-tab-title">Книги</h3>';
    html += '<div class="mdeditor-list mdeditor-list-grid" id="booksList"></div>';
    html += '<div class="mdeditor-status" id="booksStatus"></div>';
    html += '<div class="mdeditor-list-actions">';
    html += '<button type="button" class="workbooks-run-btn mdeditor-list-action-btn" id="booksImportBtn">Загрузить fb2 или zip книг</button>';
    html += '</div>';
    html += '<input type="file" accept=".fb2,.zip,application/zip" id="booksImportInput" style="display:none;">';
    html += '</div>';
    container.innerHTML = html;

    var statusEl = document.getElementById("booksStatus");
    function setBooksStatus(msg, isError){
      if(!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.classList.toggle("error", !!isError);
    }

    // Список — асинхронный (чтение OPFS), поэтому заполняется отдельно от
    // немедленного рендера разметки выше; тот же контейнер #booksList и
    // как пустой экран (mdeditor-empty), и как список (mdeditor-list),
    // просто с разными классами — без пересоздания узла.
    var listEl = document.getElementById("booksList");
    // Список — асинхронный (OPFS), поэтому высота #settingsTabContent
    // известна только ПОСЛЕ того, как строки реально попали в DOM —
    // восстанавливаем скролл списка (ТЗ 12.09, см. TAB_SCROLL_AUTO_TABS/
    // restoreTabScroll выше) именно здесь, а не в switchSettingsTab, и во
    // всех трёх исходах (список/пусто/ошибка), чтобы вкладка не оставалась
    // в положении от прошлой вкладки, если что-то пошло не так.
    listBooksEntries().then(function(items){
      if(!document.getElementById("booksList")) return; // вкладку успели покинуть
      if(!items.length){
        listEl.className = "mdeditor-empty";
        listEl.textContent = "Книг пока нет.";
        restoreTabScroll("set2s_7");
        return;
      }
      items.forEach(function(it){
        var row = document.createElement("div");
        row.className = "mdeditor-row";
        row.innerHTML = TASK_MOVE_ICON_SVG("read") + '<span class="mdeditor-row-name"></span>';
        row.querySelector(".mdeditor-row-name").textContent = it.name;
        row.addEventListener("click", function(){ openBookReader(it.name); });
        listEl.appendChild(row);
      });
      restoreTabScroll("set2s_7");
    }).catch(function(e){
      setBooksStatus("Не удалось прочитать список книг: " + (e && e.message ? e.message : e), true);
      restoreTabScroll("set2s_7");
    });

    var input = document.getElementById("booksImportInput");
    var btn = document.getElementById("booksImportBtn");
    if(btn && input){
      btn.addEventListener("click", function(){ input.click(); });
      input.addEventListener("change", function(){
        var file = input.files && input.files[0];
        input.value = ""; // разрешаем выбрать тот же файл ещё раз
        if(!file) return;
        handleImportBooksFile(file, function(msg, isError){
          // Новая книга могла добавиться — перерисовываем вкладку целиком
          // (список читается заново из OPFS), затем на свежей разметке
          // показываем статус этого импорта.
          renderSettingsTabBooks();
          var freshStatus = document.getElementById("booksStatus");
          if(freshStatus){
            freshStatus.textContent = msg || "";
            freshStatus.classList.toggle("error", !!isError);
          }
        });
      });
    }
  }

  // ===================== ЭКРАН ЧТЕНИЯ (READER_PLAN.md, Этап D, шаг 11, 11.09) =====================
  // Сплошной скролл ВСЕЙ книги (все главы подряд в одном потоке, каждая со
  // своим заголовком) + отдельный режим "список глав" внутри ТОГО ЖЕ экрана
  // (переключение — switchBookReaderMode ниже), без отдельной вкладки/модалки
  // (см. ТЗ). Шрифт — тот же CSS-механизм, что у "Моего блокнота"
  // (--mdeditor-font-size, applyFontSize в mdeditor.js) — здесь ничего своего
  // не заводим, просто используем переменную (components.css, .book-reader).
  // Картинки — тот же класс .cm-md-image, что у вставленных картинок заметок,
  // просто с src на blob-URL из images-карты fb2parse.js.
  //
  // Нижние кнопки Аа/Главы/Домик/Flibusta — READER_PLAN.md, Этап D, шаг 12
  // (11.09), тот же стиль/размер/расположение, что у нижних кнопок "Моих
  // заметок" (.mdeditor-fab-row/-fab-btn, position:absolute от
  // .settings-modal-box — см. bindBookReaderFabRow ниже). "Аа" использует
  // ТОТ ЖЕ fontSizeStep, что и заметки/задачи (MdEditor.changeFontSizeStep,
  // тем же приёмом, что initTaskGlobalToolbar выше).
  //
  // Шаг 13 (выделение -> заметка книги, реализовано 11.09; доработка 13.09
  // — порядок действий "выделил, затем нажал кнопку") — см.
  // handleBookReaderSelectionSettled/resolveSelectionToBlockPosition/
  // addUnderlineFromSelection дальше в этом разделе, после
  // jumpToChapterFromChaptersList.
  //
  // Восстановление прокрутки при "назад" — тем же приёмом, что prevScrollTop в
  // openNoteById (mdeditor.js): сырой scrollTop контейнера #settingsTabContent
  // (а не процент, как в mdeditor.js — там понадобился процент из-за
  // растущего .cm-scroller; здесь высота книги стабильна между рендерами
  // одного режима, поэтому пиксельного значения достаточно).
  var bookReaderState = null; // {hash, name, chapters, imageUrls, mode, textScrollTop, chaptersScrollTop, restorePosition}
  // true после первого захода на вкладку "Мои книги" (set2s_7) в рамках
  // ТЕКУЩЕГО запуска скрипта — см. switchSettingsTab, ветка set2s_7 и
  // LAST_OPENED_BOOK_KEY выше. Пока false, отсутствие bookReaderState
  // трактуется как "скрипт только что перезапустился, книгу из памяти
  // потеряли" и книга подхватывается автоматически по запомненному имени;
  // после первого захода (успешного или нет) — как обычный сознательный
  // выход пользователя в список (кнопка "Домик"/"назад"), список и
  // остаётся.
  var booksTabVisitedThisSession = false;
  // Шаг 16 (READER_PLAN.md, Этап D): запоминание места чтения — тем же
  // приёмом, что docState/persistDocStateNow/scheduleDocStateSave в
  // mdeditor.js, только якорь не курсор+процент, а конкретный абзац/
  // картинка {ch, blk} (та же адресация data-ch/data-blk, что уже
  // используется у подчёркиваний/картинок выше) — устойчивее к смене
  // размера шрифта между сессиями, чем процент прокрутки. Хранится не в
  // отдельном ключе, а прямо в модели книги (position, см.
  // setBookPosition выше) — попадает в общую облачную синхронизацию
  // бесплатно, тем же путём, что и bookmarks/underlines там же.
  // restorePosition (поле bookReaderState выше) — сохранённая позиция,
  // которую нужно применить РОВНО ОДИН РАЗ, при первом рендере текста
  // сразу после открытия книги (см. openBookReader/renderBookReaderText
  // ниже); дальше при переключениях режима работает обычный textScrollTop
  // (в памяти, как и раньше).
  var bookReaderScrollContainer = null;
  var bookReaderScrollHandler = null;
  var bookReaderPositionSaveTimer = null;
  // Абзац/картинка {ch, blk}, чьё начало (offsetTop) последним не
  // превышает текущий scrollTop контейнера — тот же приём, что
  // jumpToChapterFromChaptersList ниже использует для перехода к главе,
  // только гранулярность — абзац, а не глава. По умолчанию (пока
  // scrollTop не дошёл ни до одного блока) — самый первый блок книги.
  function currentBookReaderPosition(container){
    var blocks = container.querySelectorAll(".book-reader-p, .book-reader-image-wrap");
    if(!blocks.length) return null;
    var best = blocks[0];
    for(var i = 0; i < blocks.length; i++){
      if(blocks[i].offsetTop <= container.scrollTop) best = blocks[i];
      else break;
    }
    var ch = parseInt(best.getAttribute("data-ch"), 10);
    var blk = parseInt(best.getAttribute("data-blk"), 10);
    if(isNaN(ch) || isNaN(blk)) return null;
    return {ch: ch, blk: blk};
  }
  // Обратная операция — прокручивает контейнер так, чтобы блок {ch, blk}
  // оказался наверху. Возвращает false, если блок не найден (например,
  // сохранённая позиция битая или файл книги успел измениться между
  // открытиями) — тогда вызывающий код молча откатывается на позицию по
  // умолчанию (см. renderBookReaderText ниже), книга просто открывается с
  // начала вместо падения с ошибкой.
  function scrollBookReaderToPosition(container, position){
    if(!position) return false;
    var el = container.querySelector('[data-ch="' + position.ch + '"][data-blk="' + position.blk + '"]');
    if(!el) return false;
    container.scrollTop = el.offsetTop;
    return true;
  }
  function flushBookReaderPositionNow(){
    if(bookReaderPositionSaveTimer){ clearTimeout(bookReaderPositionSaveTimer); bookReaderPositionSaveTimer = null; }
    if(!bookReaderState) return;
    var container = document.getElementById("settingsTabContent");
    var pos = container ? currentBookReaderPosition(container) : null;
    if(pos) setBookPosition(bookReaderState.hash, pos);
  }
  function scheduleBookReaderPositionSave(){
    if(bookReaderPositionSaveTimer) clearTimeout(bookReaderPositionSaveTimer);
    bookReaderPositionSaveTimer = setTimeout(flushBookReaderPositionNow, 500);
  }
  // Снимает слушатель прокрутки (с немедленным сбросом несохранённого
  // debounce, без потери позиции) — тем же приёмом и по тем же причинам,
  // что destroySubtitleScrollListener выше: вызывается перед ЛЮБЫМ
  // рендером ридера (см. renderBookReader ниже) и при полном выходе из
  // ридера (homeBtn/AppNav-колбэк в openBookReader), иначе слушатель
  // остался бы висеть на #settingsTabContent и после ухода с книги —
  // контейнер общий на всё приложение и не пересоздаётся между экранами.
  function destroyBookReaderScrollListener(){
    if(bookReaderPositionSaveTimer) flushBookReaderPositionNow();
    if(bookReaderScrollContainer && bookReaderScrollHandler){
      bookReaderScrollContainer.removeEventListener("scroll", bookReaderScrollHandler);
    }
    bookReaderScrollContainer = null;
    bookReaderScrollHandler = null;
  }
  var bookReaderFontSizePanelOpen = false;

  // Пиктограммы кнопок ридера — тот же стиль viewBox 24x24/stroke=currentColor,
  // что и везде в проекте. HOME_ICON_SVG физически дублирует контур домика из
  // mdeditor.js (тот не передаётся через deps наружу, а заводить деп ради
  // одной иконки не стоит) — визуально это ОДНА и та же пиктограмма.
  var READER_HOME_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 11.5L12 4l8 7.5"></path>' +
      '<path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"></path>' +
      '<path d="M10 20v-5h4v5"></path>' +
    '</svg>';
  // "Главы" — список (три строки), в режиме списка глав кнопка переключается
  // на READER_TEXT_ICON_SVG (раскрытая книга) — тот же приём переключения
  // иконки на кнопке, что у mdEditorModeBtn (EYE/CODE) в mdeditor.js.
  var READER_CHAPTERS_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="4" y1="6" x2="20" y2="6"></line>' +
      '<line x1="4" y1="12" x2="20" y2="12"></line>' +
      '<line x1="4" y1="18" x2="20" y2="18"></line>' +
    '</svg>';
  var READER_TEXT_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 5c3-1.5 6-1.5 8 0v14c-2-1.5-5-1.5-8 0V5z"></path>' +
      '<path d="M20 5c-3-1.5-6-1.5-8 0v14c2-1.5 5-1.5 8 0V5z"></path>' +
    '</svg>';
  // Flibusta (Этап E, ещё не подключён) — глобус/меридианы, обозначает
  // внешний каталог; кнопка пока только показывает статус-сообщение.
  var READER_FLIBUSTA_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="9"></circle>' +
      '<line x1="3" y1="12" x2="21" y2="12"></line>' +
      '<path d="M12 3c2.5 2.5 2.5 15.5 0 18"></path>' +
      '<path d="M12 3c-2.5 2.5-2.5 15.5 0 18"></path>' +
    '</svg>';
  // Закладка (ТЗ от 12.09) — кнопка в нижнем ряду, см.
  // saveBookReaderBookmark/bookReaderFabRowHtml.
  var READER_BOOKMARK_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 3h12v18l-6-4-6 4V3z"></path>' +
    '</svg>';
  // Кнопка-кнопка "прикрепить иллюстрацию к заметке книги" (READER_PLAN.md,
  // Этап D, шаг 14, 11.09) — канцелярская кнопка, которой прикалывают лист:
  // головка (кружок) + игла вниз. Бесцветная в обычном состоянии; класс
  // .pinned (components.css) красит в var(--danger) и заливает головку
  // сплошным цветом — "воткнутая" кнопка (см. renderBookReaderText/
  // toggleBookReaderImagePin ниже).
  var READER_PIN_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="7.2" r="4.2"></circle>' +
      '<line x1="12" y1="11.4" x2="12" y2="20.5"></line>' +
    '</svg>';
  // Кнопка "Выделение" (READER_PLAN.md, Этап D, шаг 13; доработка 13.09 —
  // тот же порядок действий, что и у кнопки "Маркер" в "Моём блокноте",
  // mdeditor.js: сначала пользователь выделяет текст пальцем/мышью как
  // обычно, ЗАТЕМ жмёт эту кнопку — она читает текущее выделение и сразу
  // подчёркивает его (см. handleBookReaderSelectionSettled ниже). Раньше
  // кнопка сама "взводилась" перед выделением — от этого отказались:
  // одинаковый порядок действий с "Моим блокнотом" проще запомнить.
  // mousedown с preventDefault (см. bindBookReaderFabRow ниже) — чтобы
  // клик по кнопке не сбрасывал уже сделанное выделение текста до того,
  // как сработает click.
  var READER_SELECT_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 20h6"></path>' +
      '<path d="M6.5 17.5L16 8l3 3-9.5 9.5H6.5v-3z"></path>' +
      '<path d="M14 6l4 4"></path>' +
    '</svg>';
  // Плавающая кнопка-урна над подчёркиванием (READER_PLAN.md, шаг 13,
  // доработка 11.09) — тап по уже подчёркнутому фрагменту показывает эту
  // кнопку рядом с ним (см. showBookReaderUnderlineTrashBtn ниже), тап по
  // ней снимает подчёркивание. Тот же язык иконок, что и остальные кнопки
  // ридера.
  var READER_TRASH_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 7h14"></path>' +
      '<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>' +
      '<path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"></path>' +
      '<line x1="10" y1="11" x2="10" y2="17"></line>' +
      '<line x1="14" y1="11" x2="14" y2="17"></line>' +
    '</svg>';

  // XML-декларация в начале fb2 (<?xml ... encoding="windows-1251"?>) всегда
  // ASCII-совместима, поэтому кодировку можно прочитать декодированием первых
  // байт как iso-8859-1 (1 байт = 1 символ, латиница/цифры не искажаются) ДО
  // того, как решать, чем декодировать весь файл. Большинство fb2 в рунете —
  // windows-1251, TextDecoder поддерживает это имя напрямую.
  function decodeFb2Buffer(buffer){
    var head = new TextDecoder("iso-8859-1").decode(new Uint8Array(buffer, 0, Math.min(200, buffer.byteLength)));
    var m = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
    var enc = m ? m[1].toLowerCase() : "utf-8";
    try{ return new TextDecoder(enc).decode(buffer); }
    catch(e){ return new TextDecoder("utf-8").decode(buffer); } // неизвестная браузеру кодировка — пробуем utf-8, лучше кривой текст, чем ничего
  }

  function revokeBookReaderImages(){
    if(!bookReaderState || !bookReaderState.imageUrls) return;
    Object.keys(bookReaderState.imageUrls).forEach(function(id){
      try{ URL.revokeObjectURL(bookReaderState.imageUrls[id]); }catch(e){}
    });
  }

  function openBookReader(name){
    // Подчищаем картинки предыдущей открытой книги, если она осталась
    // "подвешенной" в памяти (например, после клика "Домик" — см.
    // bindBookReaderFabRow ниже — без возврата "назад" в ту книгу).
    if(bookReaderState){ destroyBookReaderScrollListener(); revokeBookReaderImages(); }
    var container = document.getElementById("settingsTabContent");
    var prevScrollTop = container ? container.scrollTop : 0;
    // return — READER_PLAN.md, шаг 15 (11.09): openBookAtMarginBookmark
    // (см. ниже) должен дождаться, пока книга реально откроется и
    // распарсится, прежде чем прокручивать к нужному абзацу; остальные
    // вызовы (клик по строке в списке книг) этот промис просто игнорируют,
    // как и раньше.
    return getBooksDirHandle().then(function(dir){
      return dir.getFileHandle(name);
    }).then(function(fh){
      return fh.getFile();
    }).then(function(file){
      return file.arrayBuffer();
    }).then(function(buf){
      return sha256Hex(buf).then(function(hash){
        var parsed = Fb2Parse.parseFb2(decodeFb2Buffer(buf));
        return {hash: hash, parsed: parsed};
      });
    }).then(function(res){
      var imageUrls = {}, imageBytes = {};
      Object.keys(res.parsed.images).forEach(function(id){
        var img = res.parsed.images[id];
        try{
          var bin = atob(img.base64);
          var bytes = new Uint8Array(bin.length);
          for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var contentType = img.contentType || "image/jpeg";
          imageUrls[id] = URL.createObjectURL(new Blob([bytes], {type: contentType}));
          // Сырые байты — нужны только для "прикрепить к заметке" (шаг 14,
          // см. toggleBookReaderImagePin ниже); blob-URL для этого не годится,
          // т.к. запись в OPFS требует самих байт, а не ссылки на них.
          imageBytes[id] = {bytes: bytes, contentType: contentType};
        }catch(e){ /* битая картинка в binary — просто не покажем */ }
      });
      // Шаг 16 — сохранённая позиция чтения (см. setBookPosition/
      // getBookState выше) читается один раз здесь, при открытии книги
      // "с нуля" (не из снимка "Домика" — тот восстанавливает готовый
      // bookReaderState целиком, минуя openBookReader). Применяется
      // РОВНО ОДИН РАЗ в renderBookReaderText (см. ниже) и сразу
      // обнуляется там же.
      ensureBookNameSynced(res.hash, name);
      // Запоминаем, что именно эта книга открыта последней (см.
      // LAST_OPENED_BOOK_KEY/saveLastOpenedBookName выше) — нужно для
      // автоматического восстановления книги при заходе на вкладку "Мои
      // книги" после "невидимой" перезагрузки фоновой вкладки браузером
      // (см. switchSettingsTab, ветка set2s_7).
      saveLastOpenedBookName(name);
      var savedBookState = getBookState(res.hash);
      bookReaderState = {
        hash: res.hash, name: name,
        chapters: res.parsed.chapters, imageUrls: imageUrls, imageBytes: imageBytes,
        mode: "text", textScrollTop: 0, chaptersScrollTop: 0,
        restorePosition: (savedBookState && savedBookState.position) || null
      };
      window.AppNav.push(function(){
        destroyBookReaderScrollListener();
        revokeBookReaderImages();
        bookReaderState = null;
        renderSettingsTabBooks();
        var c = document.getElementById("settingsTabContent");
        if(c) c.scrollTop = prevScrollTop;
      });
      renderBookReader();
    }).catch(function(e){
      var statusEl = document.getElementById("booksStatus");
      if(statusEl){
        statusEl.textContent = "Не удалось открыть книгу: " + (e && e.message ? e.message : e);
        statusEl.classList.add("error");
      }
    });
  }

  // ranges (необязательный 2-й параметр, READER_PLAN.md, шаг 13, 11.09;
  // формат {s,e,id} — доработка 11.09, id понадобился кнопке-урне) —
  // отсортированный список объектов {s,e,id} в координатах ПЛОСКОГО текста
  // абзаца (конкатенация runs[].text, теми же координатами, что использует
  // resolveSelectionToBlockPosition/getBookUnderlineRangesForBlock ниже) —
  // те куски текста, что нужно обернуть в <mark class="book-reader-
  // underline" data-underline-id="..."> (подчёркивания книги), поверх уже
  // имеющегося жирного/курсива. id на <mark> — по нему показывается
  // плавающая кнопка-урна при тапе (см. bindBookReaderUnderlineClicks ниже).
  // Без ranges — прежнее поведение без изменений (единственный вызов раньше,
  // до шага 13, ranges не передавал).
  function renderRunsHtml(runs, ranges){
    if(!ranges || !ranges.length){
      return runs.map(function(r){
        var t = escapeHtml(r.text);
        if(r.bold) t = "<b>" + t + "</b>";
        if(r.italic) t = "<i>" + t + "</i>";
        return t;
      }).join("");
    }
    var html = "", offset = 0;
    runs.forEach(function(r){
      var text = r.text, len = text.length, runStart = offset, pos = 0;
      while(pos < len){
        var globalPos = runStart + pos;
        var active = null;
        for(var i = 0; i < ranges.length; i++){
          if(globalPos >= ranges[i].s && globalPos < ranges[i].e){ active = ranges[i]; break; }
        }
        var segEnd;
        if(active){
          segEnd = Math.min(len, active.e - runStart);
        } else {
          segEnd = len;
          for(var j = 0; j < ranges.length; j++){
            var relStart = ranges[j].s - runStart;
            if(relStart > pos && relStart < segEnd) segEnd = relStart;
          }
        }
        var t = escapeHtml(text.slice(pos, segEnd));
        if(r.bold) t = "<b>" + t + "</b>";
        if(r.italic) t = "<i>" + t + "</i>";
        if(active) t = '<mark class="book-reader-underline" data-underline-id="' + escapeHtml(active.id) + '">' + t + '</mark>';
        html += t;
        pos = segEnd;
      }
      offset += len;
    });
    return html;
  }

  function renderBookReader(){
    var container = document.getElementById("settingsTabContent");
    if(!container || !bookReaderState) return;
    // Запоминаем позицию ТОГО, что сейчас реально показано в контейнере,
    // ПЕРЕД любой перерисовкой — не только при смене режима текст<->главы
    // (см. switchBookReaderMode ниже, она это уже делала для своего
    // случая), но и при обычном возврате на вкладку «Книги» после ухода
    // на другую вкладку настроек (ТЗ пользователя от 12.09, восьмой
    // заход: "всегда оказываюсь в самом начале книги, если возвращаюсь на
    // вкладку"). Раньше bookReaderState.restorePosition срабатывал РОВНО
    // ОДИН РАЗ — сразу после openBookReader — а откат при его отсутствии
    // (container.scrollTop = bookReaderState.textScrollTop || 0, см.
    // renderBookReaderText) видел textScrollTop, обновляемый только
    // switchBookReaderMode, то есть 0 при любом ДРУГОМ поводе для
    // рендера. Определяем режим ПО СОДЕРЖИМОМУ контейнера (а не по
    // bookReaderState.mode — он к этому моменту уже мог смениться на
    // целевой, см. switchBookReaderMode), поэтому здесь не путаемся с её
    // собственным сохранением prevMode.
    if(container.querySelector(".book-reader-p, .book-reader-image-wrap")){
      var prevPos = currentBookReaderPosition(container);
      if(prevPos) bookReaderState.restorePosition = prevPos;
    } else if(container.querySelector("#bookChaptersList")){
      bookReaderState.chaptersScrollTop = container.scrollTop;
    }
    // Флашим/снимаем слушатель ДО перерисовки — на момент вызова
    // innerHTML контейнера ещё старый (см. currentBookReaderPosition
    // выше), поэтому debounce-сохранение здесь ловит последнюю позицию
    // именно того режима, который сейчас покидаем (та же логика, что
    // textScrollTop/chaptersScrollTop в switchBookReaderMode ниже).
    destroyBookReaderScrollListener();
    if(bookReaderState.mode === "chapters") renderBookReaderChapters(container);
    else renderBookReaderText(container);
  }

  // Общий нижний ряд кнопок (шаг 12) — одна и та же разметка в обоих режимах
  // (текст/главы), просто с разной иконкой/подсказкой у кнопки "Главы" (см.
  // READER_CHAPTERS_ICON_SVG/READER_TEXT_ICON_SVG выше). position:absolute
  // у .mdeditor-fab-row — от .settings-modal-box (components.css), поэтому
  // ряд остаётся приклеенным к низу окна настроек независимо от прокрутки
  // #settingsTabContent — тем же приёмом, что .mdeditor-fab-row в
  // renderEditorScreen (mdeditor.js).
  function bookReaderFabRowHtml(){
    var chaptersMode = bookReaderState.mode === "chapters";
    return (
      '<div class="mdeditor-status" id="bookReaderStatus"></div>' +
      '<div class="mdeditor-fab-row">' +
        '<button type="button" class="mdeditor-fab-btn" id="bookReaderFlibustaBtn" title="Flibusta">' + READER_FLIBUSTA_ICON_SVG + '</button>' +
        '<span class="mdeditor-fontsize-wrap" id="bookReaderFontSizeWrap">' +
          '<div class="mdeditor-fontsize-popup" id="bookReaderFontSizePopup">' +
            '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="bookReaderFontPlusBtn" title="Крупнее">+</button>' +
            '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="bookReaderFontMinusBtn" title="Мельче">&minus;</button>' +
          '</div>' +
          '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="bookReaderFontSizeBtn" title="Размер шрифта">Аа</button>' +
        '</span>' +
        '<button type="button" class="mdeditor-fab-btn" id="bookReaderSelectBtn" title="Выделить текст">' + READER_SELECT_ICON_SVG + '</button>' +
        '<button type="button" class="mdeditor-fab-btn" id="bookReaderBookmarkBtn" title="Сохранить закладку">' + READER_BOOKMARK_ICON_SVG + '</button>' +
        '<button type="button" class="mdeditor-fab-btn" id="bookReaderChaptersBtn" title="' + (chaptersMode ? "К тексту" : "Главы") + '">' +
          (chaptersMode ? READER_TEXT_ICON_SVG : READER_CHAPTERS_ICON_SVG) +
        '</button>' +
        '<button type="button" class="mdeditor-fab-btn" id="bookReaderHomeBtn" title="К списку книг">' + READER_HOME_ICON_SVG + '</button>' +
      '</div>'
    );
  }

  // Обработчики нижнего ряда — навешиваются заново после каждого рендера
  // (innerHTML пересоздаёт узлы), тем же приёмом, что renderEditorScreen в
  // mdeditor.js навешивает их на mdEditorFontSizeBtn/mdEditorHomeBtn2 и т.п.
  function bindBookReaderFabRow(){
    bookReaderFontSizePanelOpen = false; // попап "+"/"-" каждый раз стартует закрытым (та же причина, что у fontSizePanelOpen в renderEditorScreen)
    removeBookReaderUnderlineTrashBtn(); // кнопка-урна (доработка 11.09) тоже не переживает полный рендер — та же причина
    var fontBtn = document.getElementById("bookReaderFontSizeBtn");
    var fontPopup = document.getElementById("bookReaderFontSizePopup");
    var fontPlusBtn = document.getElementById("bookReaderFontPlusBtn");
    var fontMinusBtn = document.getElementById("bookReaderFontMinusBtn");
    if(fontBtn){
      fontBtn.addEventListener("click", function(){
        bookReaderFontSizePanelOpen = !bookReaderFontSizePanelOpen;
        if(fontPopup) fontPopup.classList.toggle("open", bookReaderFontSizePanelOpen);
      });
    }
    // Тот же fontSizeStep, что у "Моего блокнота"/задач (см.
    // initTaskGlobalToolbar выше) — единица размера общая на всё приложение.
    if(fontPlusBtn) fontPlusBtn.addEventListener("click", function(){ MdEditor.changeFontSizeStep(1); });
    if(fontMinusBtn) fontMinusBtn.addEventListener("click", function(){ MdEditor.changeFontSizeStep(-1); });

    // Кнопка "Выделение" (шаг 13; доработка 13.09 — тот же порядок
    // действий, что у кнопки "Маркер" в "Моём блокноте", mdeditor.js):
    // пользователь сначала выделяет текст обычным браузерным выделением,
    // затем жмёт кнопку — handleBookReaderSelectionSettled читает текущее
    // выделение и сразу подчёркивает его. mousedown с preventDefault — то
    // же самое, зачем это нужно кнопкам форматирования в mdeditor.js:
    // клик по кнопке иначе сбросил бы выделение текста до срабатывания
    // click.
    var selectBtn = document.getElementById("bookReaderSelectBtn");
    if(selectBtn){
      selectBtn.addEventListener("mousedown", function(ev){ ev.preventDefault(); });
      selectBtn.addEventListener("click", handleBookReaderSelectionSettled);
    }

    var bookmarkBtn = document.getElementById("bookReaderBookmarkBtn");
    if(bookmarkBtn) bookmarkBtn.addEventListener("click", saveBookReaderBookmark);

    var chaptersBtn = document.getElementById("bookReaderChaptersBtn");
    if(chaptersBtn){
      chaptersBtn.addEventListener("click", function(){
        switchBookReaderMode(bookReaderState.mode === "chapters" ? "text" : "chapters");
      });
    }

    // "Домик" — к списку книг. Действие ВПЕРЁД (как goHome в mdeditor.js):
    // само не откатывает историю, а добавляет свой шаг "назад" (снимок
    // текущего состояния ридера), чтобы системное "назад" после клика по
    // "Домику" вернуло именно в эту книгу на этом же месте. Картинки НЕ
    // освобождаются здесь — снимок может понадобиться при возврате; они
    // освобождаются либо при реальном выходе из ридера (см. openBookReader),
    // либо подчищаются как подвисшие при следующем openBookReader.
    var homeBtn = document.getElementById("bookReaderHomeBtn");
    if(homeBtn){
      homeBtn.addEventListener("click", function(){
        // renderSettingsTabBooks() ниже, в отличие от renderBookReader(),
        // не снимает слушатель прокрутки сам — контейнер общий, поэтому
        // без этого он остался бы висеть и на экране списка книг (см.
        // destroyBookReaderScrollListener выше).
        destroyBookReaderScrollListener();
        var snapshot = bookReaderState;
        window.AppNav.push(function(){
          bookReaderState = snapshot;
          renderBookReader();
        });
        bookReaderState = null;
        renderSettingsTabBooks();
      });
    }

    // Flibusta (Этап E) — заглушка с понятным сообщением, не блокирует
    // остальной ридер (см. ТЗ, READER_PLAN.md шаг 12).
    var flibustaBtn = document.getElementById("bookReaderFlibustaBtn");
    if(flibustaBtn){
      flibustaBtn.addEventListener("click", function(){
        var status = document.getElementById("bookReaderStatus");
        if(status) status.textContent = "Подключение к каталогу Flibusta появится позже (Этап E).";
      });
    }
  }

  function renderBookReaderText(container){
    var html = '<div class="book-reader-tab">' + bookReaderFabRowHtml() + '<div class="book-reader">';
    bookReaderState.chapters.forEach(function(ch, idx){
      html += '<div class="book-reader-chapter" id="bookChapter_' + idx + '">';
      if(ch.title) html += '<h4 class="book-reader-chapter-title">' + escapeHtml(ch.title) + '</h4>';
      ch.blocks.forEach(function(block, bi){
        if(block.type === "image"){
          var url = block.imageId ? bookReaderState.imageUrls[block.imageId] : null;
          if(url){
            // Шаг 14 (READER_PLAN.md, Этап D, 11.09): .book-reader-image-wrap
            // даёт position:relative для кнопки-кнопки, центрированной по
            // верхнему краю картинки (components.css). data-ch/data-blk/
            // data-img — та же адресация, что у подчёркиваний (см.
            // bindBookReaderImages/toggleBookReaderImagePin ниже).
            var pinned = isBookImagePinned(bookReaderState.hash, idx, bi);
            html += '<div class="book-reader-image-wrap" data-ch="' + idx + '" data-blk="' + bi + '" data-img="' + escapeHtml(block.imageId) + '">' +
              '<img class="cm-md-image book-reader-image" src="' + url + '">' +
              '<button type="button" class="book-reader-pin-btn' + (pinned ? ' pinned' : '') +
                '" title="' + (pinned ? "Убрать из заметки" : "Отправить в заметку") + '">' + READER_PIN_ICON_SVG + '</button>' +
            '</div>';
          }
        } else {
          // id/data-ch/data-blk (шаг 13) — по ним resolveSelectionToBlockPosition
          // ниже находит абзац выделения и его координаты (idx = глава, bi =
          // индекс блока внутри ch.blocks — стабилен независимо от типа
          // соседних блоков, т.к. это просто позиция в исходном массиве).
          var ranges = getBookUnderlineRangesForBlock(bookReaderState.hash, idx, bi);
          // Закладка (шаг 15; переработано 12.09) — класс
          // .book-reader-p-bookmarked (components.css) даёт левую
          // полоску-акцент на абзац, на котором стоит закладка; закладки
          // теперь добавляются только кнопкой в нижнем ряду (см.
          // saveBookReaderBookmark выше), сюда просто читаются заново при
          // каждом рендере текста.
          var isBookmarked = !!getBookBookmarkForBlock(bookReaderState.hash, idx, bi);
          html += '<p class="book-reader-p' + (isBookmarked ? ' book-reader-p-bookmarked' : '') +
            '" id="bookP_' + idx + '_' + bi + '" data-ch="' + idx + '" data-blk="' + bi + '">' +
            renderRunsHtml(block.runs, ranges) + '</p>';
        }
      });
      html += '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
    requestAnimationFrame(function(){
      // Шаг 16: сохранённая позиция чтения применяется РОВНО ОДИН РАЗ,
      // сразу после открытия книги (restorePosition обнуляется тут же,
      // независимо от успеха — повторные рендеры текстового режима в
      // этой сессии дальше идут через обычный textScrollTop, как и
      // раньше). scrollBookReaderToPosition возвращает false на битой/
      // устаревшей позиции — тогда используется обычный откат к
      // textScrollTop (0 при первом открытии, то есть начало книги).
      var restored = false;
      if(bookReaderState.restorePosition){
        restored = scrollBookReaderToPosition(container, bookReaderState.restorePosition);
        bookReaderState.restorePosition = null;
      }
      if(!restored) container.scrollTop = bookReaderState.textScrollTop || 0;
      // Слежение за прокруткой — только в текстовом режиме (в "главах"
      // читательская позиция не копится, см. currentBookReaderPosition
      // выше, ей нужны .book-reader-p/.book-reader-image-wrap, которых
      // там нет). Снимается перед ЛЮБЫМ следующим рендером ридера, см.
      // destroyBookReaderScrollListener/renderBookReader выше.
      bookReaderScrollHandler = function(){ scheduleBookReaderPositionSave(); };
      bookReaderScrollContainer = container;
      container.addEventListener("scroll", bookReaderScrollHandler, { passive: true });
    });
    bindBookReaderFabRow();
    bindBookReaderImages();
    bindBookReaderUnderlineClicks();
  }

  // Шаг 14 (READER_PLAN.md, Этап D, 11.09): тап по самой картинке открывает
  // тот же полноэкранный просмотрщик с зумом, что и у картинок в "Моём
  // блокноте" (MdEditor.openImageViewer, экспортирована специально для
  // этого) — своего просмотрщика в ридере не заводим. Кнопка-кнопка —
  // отдельный обработчик со stopPropagation, чтобы клик по ней не долетал
  // до <img> и не открывал просмотрщик заодно.
  function bindBookReaderImages(){
    var container = document.getElementById("settingsTabContent");
    if(!container || !bookReaderState) return;
    var wraps = container.querySelectorAll(".book-reader-image-wrap");
    for(var i = 0; i < wraps.length; i++){
      (function(wrap){
        var ch = parseInt(wrap.getAttribute("data-ch"), 10);
        var blk = parseInt(wrap.getAttribute("data-blk"), 10);
        var imageId = wrap.getAttribute("data-img");
        var img = wrap.querySelector(".book-reader-image");
        var pinBtn = wrap.querySelector(".book-reader-pin-btn");
        if(img){
          img.addEventListener("click", function(){
            var url = bookReaderState.imageUrls[imageId];
            if(url && MdEditor && MdEditor.openImageViewer){
              MdEditor.openImageViewer(url, (bookReaderState.name || "").replace(/\.fb2$/i, ""));
            }
          });
        }
        if(pinBtn){
          pinBtn.addEventListener("click", function(ev){
            ev.stopPropagation();
            toggleBookReaderImagePin(ch, blk, imageId, pinBtn);
          });
        }
      })(wraps[i]);
    }
  }

  function renderBookReaderChapters(container){
    var html = '<div class="mdeditor-tab book-reader-tab"><h3 class="common-tab-title">' + escapeHtml(bookReaderState.name) + ' — главы</h3>';
    html += '<div class="mdeditor-list" id="bookChaptersList">';
    bookReaderState.chapters.forEach(function(ch, idx){
      html += '<div class="mdeditor-row" data-idx="' + idx + '"><span class="mdeditor-row-name">' +
        escapeHtml(ch.title || ("Глава " + (idx + 1))) + '</span></div>';
    });
    html += '</div>' + bookReaderFabRowHtml() + '</div>';
    container.innerHTML = html;
    requestAnimationFrame(function(){ container.scrollTop = bookReaderState.chaptersScrollTop || 0; });
    var listEl = document.getElementById("bookChaptersList");
    if(listEl){
      listEl.querySelectorAll(".mdeditor-row").forEach(function(row){
        row.addEventListener("click", function(){
          jumpToChapterFromChaptersList(parseInt(row.getAttribute("data-idx"), 10));
        });
      });
    }
    bindBookReaderFabRow();
  }

  // Переключение текст <-> список глав — кнопка "Главы" (см.
  // bindBookReaderFabRow выше, шаг 12). Каждый переход — свой шаг "назад" со
  // своим восстановлением сохранённой прокрутки режима, тем же приёмом, что
  // prevScrollTop в openNoteById (mdeditor.js).
  function switchBookReaderMode(mode){
    if(!bookReaderState || bookReaderState.mode === mode) return;
    var container = document.getElementById("settingsTabContent");
    var prevMode = bookReaderState.mode;
    if(container){
      if(prevMode === "text") bookReaderState.textScrollTop = container.scrollTop;
      else bookReaderState.chaptersScrollTop = container.scrollTop;
    }
    window.AppNav.push(function(){ bookReaderState.mode = prevMode; renderBookReader(); });
    bookReaderState.mode = mode;
    renderBookReader();
  }

  function jumpToChapterFromChaptersList(idx){
    switchBookReaderMode("text");
    requestAnimationFrame(function(){
      var el = document.getElementById("bookChapter_" + idx);
      var container = document.getElementById("settingsTabContent");
      if(el && container) container.scrollTop = el.offsetTop;
    });
  }

  // ===================== ВЫДЕЛЕНИЕ -> ЗАМЕТКА КНИГИ (READER_PLAN.md, Этап D,
  // шаг 13, 11.09; доработка 13.09 — порядок действий изменён на "выделил,
  // затем нажал кнопку", тот же, что у кнопки "Маркер" в "Моём блокноте")
  // =====================
  // При первом выделении в открытой книге — диалог с именем заметки;
  // заметка создаётся один раз (MdEditor.createNoteSilently, БЕЗ перехода на
  // экран редактора — пользователь остаётся в ридере) и id запоминается в
  // модели книги (setBookNoteId, см. выше). Каждое новое подчёркивание —
  // включая самое первое — дописывается в конец этой заметки через
  // MdEditor.appendTextToNoteId, без анализа существующего содержимого.
  // Подчёркивание сохраняется в модели книги (addBookUnderline) и остаётся
  // визуально подсвеченным при повторном чтении (см. ranges в
  // renderBookReaderText выше). Если то же самое место (точное совпадение
  // {ch,blk,s,e}) уже подчёркивалось раньше — повторно в заметку не
  // добавляется (см. already ниже).
  //
  // Точка входа — клик по кнопке "Выделение" (см. bindBookReaderFabRow
  // выше), а не автоматический слушатель "selectionchange" (так было до
  // 13.09) — пользователь сам решает момент, когда уже готовое выделение
  // текста нужно превратить в подчёркивание, тем же приёмом, что и кнопки
  // форматирования "Моего блокнота" (mdeditor.js).

  // Подчёркивания текущей книги для одного абзаца (блока) — отсортированный
  // список {s,e,id} в координатах плоского текста этого абзаца, для
  // renderRunsHtml выше. id каждой записи (доработка 11.09) нужен, чтобы
  // <mark> в разметке нёс data-underline-id — по нему плавающая кнопка-урна
  // (bindBookReaderUnderlineClicks ниже) узнаёт, какую именно запись снимать.
  // Возвращает null, если подсвечивать нечего (renderRunsHtml без ranges
  // работает по старому быстрому пути).
  //
  // Диапазоны НЕ схлопываются: точные повторы позиции дедуплицируются на
  // входе (addUnderlineFromSelection), а частичное пересечение двух РАЗНЫХ
  // выделений — тот же теоретический край-кейс, что был и раньше (см.
  // старый комментарий про merge); раз тут нужен id на каждый сегмент для
  // кнопки-урны, схлопывать больше нельзя — в этом редком случае просто
  // активным считается первый диапазон по возрастанию s (см. цикл в
  // renderRunsHtml).
  function getBookUnderlineRangesForBlock(hash, ch, blk){
    var data = getBookState(hash);
    if(!data || !data.underlines || !data.underlines.length) return null;
    var ranges = data.underlines.filter(function(u){
      return u.position && u.position.ch === ch && u.position.blk === blk;
    }).map(function(u){ return {s: u.position.s, e: u.position.e, id: u.id}; });
    if(!ranges.length) return null;
    ranges.sort(function(a, b){ return a.s - b.s; });
    return ranges;
  }

  // Ближайший предок-абзац книжного ридера у текстового узла/элемента.
  function closestBookP(node){
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return el ? el.closest(".book-reader-p") : null;
  }

  // Range.startContainer/startOffset (и аналогично end*) могут указывать
  // либо на текстовый узел (offset = индекс символа), либо на элемент
  // (offset = индекс дочернего узла, например когда выделение начинается
  // ровно на границе <b>/<i>) — приводим оба случая к реальному текстовому
  // узлу + смещению в нём.
  function resolveTextPosition(container, offset){
    if(container.nodeType === Node.TEXT_NODE) return {node: container, offset: offset};
    var child = container.childNodes[offset];
    if(child){
      var walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
      var first = walker.nextNode();
      if(first) return {node: first, offset: 0};
    }
    // child без текстовых узлов (граница в самом конце абзаца и т.п.) —
    // берём последний текстовый узел контейнера, в его конце.
    var walkerAll = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var last = null, n;
    while((n = walkerAll.nextNode())) last = n;
    if(last) return {node: last, offset: last.textContent.length};
    return null;
  }

  // Смещение (node,offset) в координатах ПЛОСКОГО текста элемента root
  // (сумма длин всех текстовых узлов ДО node, плюс offset внутри него) —
  // те же координаты, что использует renderRunsHtml/
  // getBookUnderlineRangesForBlock выше, независимо от вложенности <b>/<i>.
  function textOffsetWithin(root, node, offset){
    var sum = 0;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var cur;
    while((cur = walker.nextNode())){
      if(cur === node) return sum + offset;
      sum += cur.textContent.length;
    }
    return sum;
  }

  // Выделение -> {ch, blk, s, e}, либо null, если оба конца выделения не
  // попадают в ОДИН и тот же абзац книжного ридера (выделение через
  // несколько абзацев пока не поддерживается — position привязана к одному
  // блоку, см. комментарий у модели состояния книги выше).
  function resolveSelectionToBlockPosition(range){
    var startPos = resolveTextPosition(range.startContainer, range.startOffset);
    var endPos = resolveTextPosition(range.endContainer, range.endOffset);
    if(!startPos || !endPos) return null;
    var pStart = closestBookP(startPos.node);
    var pEnd = closestBookP(endPos.node);
    if(!pStart || !pEnd || pStart !== pEnd) return null;
    var ch = parseInt(pStart.getAttribute("data-ch"), 10);
    var blk = parseInt(pStart.getAttribute("data-blk"), 10);
    var s = textOffsetWithin(pStart, startPos.node, startPos.offset);
    var e = textOffsetWithin(pStart, endPos.node, endPos.offset);
    if(e <= s) return null;
    return {ch: ch, blk: blk, s: s, e: e};
  }

  // Перерисовывает innerHTML ОДНОГО абзаца (без перерисовки всего ридера,
  // чтобы не сбрасывать scrollTop, к которому пользователь сейчас читает) —
  // вызывается сразу после того, как подчёркивание сохранено в модели книги.
  // pEl.innerHTML= ниже пересоздаёт <mark class="book-reader-underline">
  // этого абзаца заново — старые обработчики клика (см.
  // bindBookReaderUnderlineClicks) вместе со старыми узлами уничтожаются, а
  // новые узлы клика не получают вовсе. Раньше это чинилось только полным
  // рендером ридера (переключение вкладки и обратно) — теперь сразу же
  // перепривязываем клики ЛОКАЛЬНО, только внутри этого абзаца (scope=pEl),
  // чтобы кнопка-урна появлялась по тапу сразу после создания подчёркивания,
  // а не только после ухода со вкладки и возврата (ТЗ пользователя от 13.09).
  function refreshBookReaderParagraphHighlight(ch, blk){
    if(!bookReaderState || bookReaderState.mode !== "text") return;
    var pEl = document.getElementById("bookP_" + ch + "_" + blk);
    var chapter = bookReaderState.chapters[ch];
    var block = chapter && chapter.blocks[blk];
    if(!pEl || !block) return;
    var ranges = getBookUnderlineRangesForBlock(bookReaderState.hash, ch, blk);
    pEl.innerHTML = renderRunsHtml(block.runs, ranges);
    bindBookReaderUnderlineClicks(pEl);
  }

  // Диалог ввода имени заметки книги — тот же общий вид карточки, что у
  // openSubtitleSaveNoteDialog выше (.mdeditor-cleanup-overlay/-card/
  // -input/-actions), но БЕЗ переключения вкладки/экрана: заметка создаётся
  // тихо, пользователь остаётся в ридере (см. MdEditor.createNoteSilently).
  // onSubmit(name) должен вернуть false, если имя занято (тогда поле
  // подсвечивается и диалог не закрывается, как и в openSubtitleSaveNoteDialog),
  // и true/undefined при успехе.
  function openBookUnderlineNameDialog(onSubmit){
    if(!settingsModalBox) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title">Имя заметки для подчёркиваний и иллюстраций из этой книги</div>' +
      '<input type="text" class="mdeditor-cleanup-input" id="bookNoteNameInput">' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="bookNoteNameCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="bookNoteNameCreate">Создать</button>' +
      '</div>';
    overlay.appendChild(card);
    settingsModalBox.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });

    var input = document.getElementById("bookNoteNameInput");
    // Имя книги (без расширения) как разумное имя заметки по умолчанию —
    // пользователь может стереть и вписать своё, поле сразу выделено.
    if(bookReaderState && bookReaderState.name) input.value = bookReaderState.name.replace(/\.fb2$/i, "");
    input.focus();
    input.select();

    function submit(){
      var name = (input.value || "").trim();
      if(!name) return;
      var ok = onSubmit(name);
      if(ok === false){
        input.style.borderColor = "var(--danger, #c0392b)";
        return;
      }
      close();
    }
    document.getElementById("bookNoteNameCancel").addEventListener("click", close);
    document.getElementById("bookNoteNameCreate").addEventListener("click", submit);
    document.getElementById("bookNoteNameCreate").addEventListener("mousedown", function(ev){ ev.preventDefault(); });
    input.addEventListener("keydown", function(ev){
      if(ev.key === "Enter"){ ev.preventDefault(); submit(); }
      else if(ev.key === "Escape"){ ev.preventDefault(); close(); }
    });
  }

  // ===================== ЗАКЛАДКА ЧЕРЕЗ КНОПКУ В НИЖНЕМ РЯДУ (ТЗ
  // пользователя от 12.09, заменяет прежние закладки на полях по долгому
  // нажатию) =====================
  // Тот же приём разметки, что и у openBookUnderlineNameDialog выше
  // (mdeditor-cleanup-overlay/-card/-title/-input/-actions).
  function openBookBookmarkNameDialog(onSubmit){
    if(!settingsModalBox) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title">Название закладки</div>' +
      '<input type="text" class="mdeditor-cleanup-input" id="bookBookmarkNameInput">' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="bookBookmarkNameCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="bookBookmarkNameSave">Сохранить</button>' +
      '</div>';
    overlay.appendChild(card);
    settingsModalBox.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });

    var input = document.getElementById("bookBookmarkNameInput");
    input.focus();

    function submit(){
      var name = (input.value || "").trim();
      if(!name) return;
      onSubmit(name);
      close();
    }
    document.getElementById("bookBookmarkNameCancel").addEventListener("click", close);
    document.getElementById("bookBookmarkNameSave").addEventListener("click", submit);
    document.getElementById("bookBookmarkNameSave").addEventListener("mousedown", function(ev){ ev.preventDefault(); });
    input.addEventListener("keydown", function(ev){
      if(ev.key === "Enter"){ ev.preventDefault(); submit(); }
      else if(ev.key === "Escape"){ ev.preventDefault(); close(); }
    });
  }

  // Спрашивается только если у книги уже есть основная закладка (см.
  // getMainBookBookmark выше) — "Да" удаляет старую основную и новая
  // закладка займёт её место (пиктограмма-корона), "Нет" добавляет новую
  // как обычную (без короны), рядом со старой основной.
  function openBookBookmarkUpdateMainConfirm(onYes, onNo){
    if(!settingsModalBox) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title">Обновить основную закладку? Старая основная закладка будет удалена, а эта станет основной.</div>' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="bookBookmarkMainNo">Нет, добавить обычной</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="bookBookmarkMainYes">Да, обновить</button>' +
      '</div>';
    overlay.appendChild(card);
    settingsModalBox.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });
    document.getElementById("bookBookmarkMainNo").addEventListener("click", function(){ close(); onNo(); });
    document.getElementById("bookBookmarkMainYes").addEventListener("click", function(){ close(); onYes(); });
  }

  // Точка входа — кнопка "закладка" в нижнем ряду ридера (см.
  // bookReaderFabRowHtml/bindBookReaderFabRow ниже). Позиция — ТЕКУЩЕЕ
  // место чтения (currentBookReaderPosition, тот же приём, что и
  // запоминание позиции при прокрутке, см. выше), а не абзац под пальцем —
  // в отличие от прежних закладок на полях, это не привязано к тому, где
  // именно на экране находится курсор/палец.
  function saveBookReaderBookmark(){
    if(!bookReaderState) return;
    var container = document.getElementById("settingsTabContent");
    var pos = container ? currentBookReaderPosition(container) : null;
    if(!pos){
      var status0 = document.getElementById("bookReaderStatus");
      if(status0) status0.textContent = "Закладку можно сохранить только в режиме чтения текста.";
      return;
    }
    var hash = bookReaderState.hash;
    function finish(name, isMain){
      if(isMain){
        var oldMain = getMainBookBookmark(hash);
        if(oldMain) removeBookBookmark(hash, oldMain.id);
      }
      addBookBookmark(hash, pos, name, isMain);
      var status = document.getElementById("bookReaderStatus");
      if(status) status.textContent = "Закладка «" + name + "» сохранена — см. вкладку «Закладки».";
      if(navigator.vibrate){ try{ navigator.vibrate(15); }catch(e){} }
    }
    var existingMain = getMainBookBookmark(hash);
    if(!existingMain){
      // Первая закладка книги — становится основной автоматически, без
      // лишнего вопроса пользователю.
      openBookBookmarkNameDialog(function(name){ finish(name, true); });
    } else {
      openBookBookmarkUpdateMainConfirm(
        // "Да, обновить" — это ОБНОВЛЕНИЕ той же основной закладки на новую
        // позицию, а не создание новой сущности с новым именем (ТЗ
        // пользователя от 12.09) — имя переносится со старой закладки как
        // есть, диалог имени здесь не нужен.
        function(){ finish(existingMain.name, true); },
        function(){ openBookBookmarkNameDialog(function(name){ finish(name, false); }); }
      );
    }
  }

  // Главная точка входа: новое подчёркивание с уже известной позицией/
  // текстом — заводит заметку книги при необходимости (диалог имени), иначе
  // сразу дописывает в существующую; дедуплицирует точные повторы позиции.
  function addUnderlineFromSelection(ch, blk, s, e, text){
    var hash = bookReaderState.hash;
    var data = getOrCreateBookState(hash);
    var already = data.underlines.filter(function(u){
      return u.position && u.position.ch === ch && u.position.blk === blk && u.position.s === s && u.position.e === e;
    })[0];
    if(already){
      // То же самое место уже подчёркивалось раньше (повторное чтение) —
      // текст и так уже подсвечен, в заметку повторно не добавляем.
      if(window.getSelection) window.getSelection().removeAllRanges();
      return;
    }
    function finishWithNoteId(noteId){
      var underlineId = addBookUnderline(hash, {ch: ch, blk: blk, s: s, e: e});
      MdEditor.appendTextToNoteId(noteId, text.trim());
      markBookUnderlineMovedToNote(hash, underlineId);
      refreshBookReaderParagraphHighlight(ch, blk);
      if(window.getSelection) window.getSelection().removeAllRanges();
    }
    if(data.noteId){
      finishWithNoteId(data.noteId);
    } else {
      openBookUnderlineNameDialog(function(name){
        if(!MdEditor || !MdEditor.createNoteSilently) return false;
        var noteId = MdEditor.createNoteSilently(name);
        if(!noteId) return false; // имя занято
        setBookNoteId(hash, noteId);
        finishWithNoteId(noteId);
        return true;
      });
    }
  }

  // ===================== СНЯТИЕ ПОДЧЁРКИВАНИЯ — КНОПКА-УРНА (READER_PLAN.md,
  // Этап D, шаг 13, доработка 11.09) =====================
  // Тап по уже подчёркнутому фрагменту (<mark class="book-reader-underline">,
  // data-underline-id на нём — см. renderRunsHtml/getBookUnderlineRangesForBlock
  // выше) показывает рядом круглую плавающую кнопку с иконкой урны
  // (READER_TRASH_ICON_SVG). Тап по кнопке:
  //   1) снимает подчёркивание из модели книги (removeBookUnderline) —
  //      навсегда, в отличие от прежнего поведения "никогда не удаляются";
  //   2) если текст этого подчёркивания успел попасть в заметку книги
  //      (movedToNote) — пытается убрать его оттуда ТЕМ ЖЕ приёмом, что и
  //      открепление иллюстрации (шаг 14): MdEditor.removeTextFromNoteId
  //      ищет ТОЧНОЕ совпадение текста. Если пользователь уже отредактировал
  //      этот кусок в заметке вручную — точного совпадения не будет,
  //      removeTextFromNoteId вернёт false и заметку не тронет (это
  //      ожидаемое поведение по ТЗ, не ошибка) — подчёркивание в самом
  //      тексте книги при этом всё равно снимается;
  //   3) перерисовывает абзац (refreshBookReaderParagraphHighlight) — без
  //      полного рендера ридера, чтобы не сбрасывать scrollTop.
  //
  // Кнопка позиционируется абсолютно от .settings-modal-box (тот же приём,
  // что диалоги имени заметки/очистки — settingsModalBox.appendChild), а не
  // добавляется внутрь #settingsTabContent, — иначе её съело бы обнуление
  // innerHTML при следующем рендере абзаца. Из-за этого при скролле текста
  // или клике вне кнопки/урны она просто скрывается (см.
  // bindBookReaderUnderlineDismissOnce ниже), а не остаётся "прилипшей" не
  // на своём месте.

  // Плоский текст блока (конкатенация runs[].text) — те же координаты, что
  // s/e у подчёркивания; нужен, чтобы восстановить исходный текст выделения
  // по position и проверить/убрать его в заметке.
  function flatBlockText(block){
    return block.runs.map(function(r){ return r.text; }).join("");
  }

  var bookReaderUnderlineTrashBtn = null;
  function removeBookReaderUnderlineTrashBtn(){
    if(bookReaderUnderlineTrashBtn && bookReaderUnderlineTrashBtn.parentNode){
      bookReaderUnderlineTrashBtn.parentNode.removeChild(bookReaderUnderlineTrashBtn);
    }
    bookReaderUnderlineTrashBtn = null;
  }

  function showBookReaderUnderlineTrashBtn(markEl, hash, underlineId, ch, blk){
    removeBookReaderUnderlineTrashBtn();
    if(!settingsModalBox) return;
    var rect = markEl.getBoundingClientRect();
    var boxRect = settingsModalBox.getBoundingClientRect();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "book-reader-underline-trash-btn";
    btn.title = "Убрать подчёркивание";
    btn.innerHTML = READER_TRASH_ICON_SVG;
    btn.style.left = (rect.left - boxRect.left + rect.width / 2) + "px";
    btn.style.top = (rect.top - boxRect.top) + "px";
    settingsModalBox.appendChild(btn);
    bookReaderUnderlineTrashBtn = btn;
    btn.addEventListener("click", function(ev){
      ev.stopPropagation();
      deleteBookUnderline(hash, underlineId, ch, blk);
      removeBookReaderUnderlineTrashBtn();
    });
  }

  // Собственно снятие: см. пункты 1-3 в комментарии к разделу выше.
  function deleteBookUnderline(hash, underlineId, ch, blk){
    var removed = removeBookUnderline(hash, underlineId);
    if(!removed) return;
    var data = getBookState(hash);
    if(removed.movedToNote && data && data.noteId && MdEditor && MdEditor.removeTextFromNoteId){
      var chapter = bookReaderState && bookReaderState.chapters[ch];
      var block = chapter && chapter.blocks[blk];
      if(block){
        var text = flatBlockText(block).slice(removed.position.s, removed.position.e).trim();
        // Результат намеренно игнорируется: false означает "в заметке уже
        // не точно такой текст" (правка пользователем) — заметку в этом
        // случае трогать не нужно, это не ошибка.
        MdEditor.removeTextFromNoteId(data.noteId, text);
      }
    }
    refreshBookReaderParagraphHighlight(ch, blk);
  }

  // Клик по <mark> — открывает кнопку-урну; игнорируем, если это конец
  // протяжённого выделения (drag) — иначе обычное выделение текста внутри
  // уже подчёркнутого фрагмента (например, для копирования) конфликтовало
  // бы с открытием кнопки при каждом отпускании пальца/мыши.
  // scope — необязательный элемент, внутри которого искать <mark> (по
  // умолчанию — весь #settingsTabContent, как раньше); передаётся отдельным
  // абзацем из refreshBookReaderParagraphHighlight (см. ниже, правка от
  // 13.09): pEl.innerHTML= там пересоздаёт <mark>-элементы абзаца заново,
  // и без повторного вызова этой функции именно для НИХ у новых меток не
  // было обработчика клика вовсе (кнопка-урна не появлялась сразу после
  // создания подчёркивания — только после ухода со вкладки и возврата,
  // когда срабатывал полный рендер ридера и bindBookReaderUnderlineClicks()
  // без scope заново обходил ВСЕ метки). Вызов со scope=pEl трогает только
  // метки этого абзаца — на остальные, уже привязанные раньше полным
  // рендером, обработчик по второму разу не вешается.
  function bindBookReaderUnderlineClicks(scope){
    var container = scope || document.getElementById("settingsTabContent");
    if(!container || !bookReaderState) return;
    container.querySelectorAll(".book-reader-underline").forEach(function(mark){
      mark.addEventListener("click", function(ev){
        var sel = window.getSelection();
        if(sel && !sel.isCollapsed && sel.toString()) return;
        ev.stopPropagation();
        var pEl = mark.closest(".book-reader-p");
        if(!pEl) return;
        var ch = parseInt(pEl.getAttribute("data-ch"), 10);
        var blk = parseInt(pEl.getAttribute("data-blk"), 10);
        var underlineId = mark.getAttribute("data-underline-id");
        showBookReaderUnderlineTrashBtn(mark, bookReaderState.hash, underlineId, ch, blk);
      });
    });
    bindBookReaderUnderlineDismissOnce();
  }

  // Скрытие кнопки-урны вне тапа по ней самой/по подчёркиванию — один
  // document-level слушатель, включается лениво, один раз. "scroll" не
  // всплывает — слушаем в фазе перехвата (capture=true), чтобы поймать
  // скролл #settingsTabContent.
  var bookReaderUnderlineDismissBound = false;
  function bindBookReaderUnderlineDismissOnce(){
    if(bookReaderUnderlineDismissBound) return;
    bookReaderUnderlineDismissBound = true;
    document.addEventListener("click", function(ev){
      if(!bookReaderUnderlineTrashBtn) return;
      if(ev.target === bookReaderUnderlineTrashBtn) return;
      if(ev.target.closest && ev.target.closest(".book-reader-underline")) return;
      removeBookReaderUnderlineTrashBtn();
    });
    document.addEventListener("scroll", function(){
      if(bookReaderUnderlineTrashBtn) removeBookReaderUnderlineTrashBtn();
    }, true);
  }

  // ===================== ИЛЛЮСТРАЦИИ -> ЗАМЕТКА КНИГИ (READER_PLAN.md,
  // Этап D, шаг 14, 11.09) =====================
  // Та же заметка книги, что и у подчёркиваний (data.noteId, см. выше) —
  // диалог имени всплывает только при самом первом обращении к заметке
  // (что раньше случится — подчёркивание или картинка, неважно), дальше
  // переиспользуется. Добавление — копия картинки в images/ (OPFS) через
  // MdEditor.saveImageBytes и "![[имя]]" в САМЫЙ КОНЕЦ заметки через уже
  // существующую MdEditor.appendTextToNoteId (она сама даёт одну пустую
  // строку перед новым содержимым, если тело не пустое, — то же поведение,
  // что нужно и здесь). Повторное нажатие на ту же картинку — открепление:
  // MdEditor.removeTextFromNoteId убирает ссылку из заметки,
  // MdEditor.deleteImageFile стирает сам файл из images/, запись убирается
  // из модели книги (removeBookImageEntry) — картинка не остаётся мусором,
  // корзина сирот здесь не нужна.
  function toggleBookReaderImagePin(ch, blk, imageId, btnEl){
    if(!bookReaderState) return;
    var hash = bookReaderState.hash;
    var existing = getBookImageEntry(hash, ch, blk);
    if(existing){
      var data = getOrCreateBookState(hash);
      if(data.noteId && MdEditor && MdEditor.removeTextFromNoteId){
        MdEditor.removeTextFromNoteId(data.noteId, "![[" + existing.savedName + "]]");
      }
      if(MdEditor && MdEditor.deleteImageFile) MdEditor.deleteImageFile(existing.savedName);
      removeBookImageEntry(hash, ch, blk);
      if(btnEl){
        btnEl.classList.remove("pinned");
        btnEl.title = "Отправить в заметку";
      }
      return;
    }
    var imgData = bookReaderState.imageBytes ? bookReaderState.imageBytes[imageId] : null;
    if(!imgData || !MdEditor || !MdEditor.saveImageBytes) return;
    function finishWithNoteId(noteId){
      var baseName = (bookReaderState.name || "book").replace(/\.fb2$/i, "") +
        " " + (ch + 1) + "-" + (blk + 1) + extFromImageContentType(imgData.contentType);
      MdEditor.saveImageBytes(baseName, imgData.bytes, imgData.contentType).then(function(finalName){
        MdEditor.appendTextToNoteId(noteId, "![[" + finalName + "]]");
        addBookImageEntry(hash, ch, blk, imageId, finalName);
        if(btnEl){
          btnEl.classList.add("pinned");
          btnEl.title = "Убрать из заметки";
        }
      }).catch(function(e){
        var status = document.getElementById("bookReaderStatus");
        if(status) status.textContent = "Не удалось сохранить иллюстрацию: " + (e && e.message ? e.message : e);
      });
    }
    var data2 = getOrCreateBookState(hash);
    if(data2.noteId){
      finishWithNoteId(data2.noteId);
    } else {
      openBookUnderlineNameDialog(function(name){
        if(!MdEditor.createNoteSilently) return false;
        var noteId = MdEditor.createNoteSilently(name);
        if(!noteId) return false; // имя занято
        setBookNoteId(hash, noteId);
        finishWithNoteId(noteId);
        return true;
      });
    }
  }

  // Обработчик клика по кнопке "Выделение" (доработка 13.09, см.
  // bindBookReaderFabRow выше) — реагирует только пока открыт ридер в
  // текстовом режиме и текущее браузерное выделение реально лежит внутри
  // .book-reader.
  function handleBookReaderSelectionSettled(){
    if(!bookReaderState || bookReaderState.mode !== "text") return;
    var sel = window.getSelection();
    if(!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var text = range.toString();
    if(!text || !text.trim()) return;
    var readerEl = document.querySelector(".book-reader");
    if(!readerEl || !readerEl.contains(range.commonAncestorContainer)) return;
    var pos = resolveSelectionToBlockPosition(range);
    if(!pos){
      var statusEl = document.getElementById("bookReaderStatus");
      if(statusEl) statusEl.textContent = "Пока можно подчёркивать текст только в пределах одного абзаца.";
      return;
    }
    addUnderlineFromSelection(pos.ch, pos.blk, pos.s, pos.e, text);
  }

  // ===================== ЗАКЛАДКИ КНИГИ (READER_PLAN.md, Этап D, шаг 15,
  // 11.09; переработано — кнопка вместо долгого нажатия) =====================
  // Закладка сохраняет ТЕКУЩЕЕ место чтения (тот же {ch, blk}, что и
  // запоминание позиции — см. currentBookReaderPosition выше) по нажатию на
  // кнопку в нижнем ряду (см. saveBookReaderBookmark ниже), а не долгим
  // нажатием на конкретный абзац — прежний вариант с долгим нажатием
  // признан неинтуитивным и убран целиком (11.09). У каждой книги может
  // быть одна ОСНОВНАЯ закладка (isMain, пиктограмма-корона в общем списке
  // "Закладки") и любое число обычных — пользователь сам решает, обновлять
  // ли основную при сохранении новой (см. openBookBookmarkUpdateMainConfirm
  // ниже) или добавить рядом. Диалог имени — openBookBookmarkNameDialog.

  // Плоский список ВСЕХ книжных закладок по всем книгам сразу —
  // для объединённого экрана "Закладки" в mdeditor.js (см.
  // deps.getBookMarginBookmarks/renderBookmarksScreen там же). Имя книги
  // разрешается через манифест дедупликации (loadBooksManifest) по хэшу —
  // единственное надёжное сопоставление хэш->текущее имя файла, устойчивое
  // к переименованию (ТЗ, шаг 8: модель книги привязана к хэшу, не к
  // имени). Книга, файла которой сейчас нет локально (например, ещё не
  // подтянулась через реестр — см. syncFilesRegistry выше), тихо
  // пропускается — та же логика, что и у закладок-заметок на
  // несуществующий локально файл (см. MD_BOOKMARK_PREFIX выше).
  // callback(items), items: [{hash, bookmarkId, position, addedAt, bookName, name, isMain}]
  function getBookMarginBookmarksForList(callback){
    var hashes = [];
    Object.keys(state).forEach(function(k){
      if(!isBookStateKey(k)) return;
      var rec = state[k];
      if(!rec || !rec.c || !rec.c.bookmarks || !rec.c.bookmarks.length) return;
      hashes.push(k.slice("book:".length));
    });
    if(!hashes.length){ callback([]); return; }
    // Локальный манифест OPFS читаем best-effort: он нужен только как
    // запасной источник имени для закладок, сделанных ДО поля bookName
    // (см. ensureBookNameSynced выше) — его отсутствие/ошибка чтения
    // (например, браузер без OPFS) не должна прятать закладки, у которых
    // имя уже есть в самом state.
    getBooksDirHandle().then(function(dir){
      return loadBooksManifest(dir);
    }).catch(function(){ return {}; }).then(function(manifest){
      var items = [];
      hashes.forEach(function(hash){
        var data = getBookState(hash);
        var name = (data && data.bookName) || manifest[hash];
        if(!name) return; // имя книги неизвестно ни из state, ни из локального манифеста
        data.bookmarks.forEach(function(b){
          items.push({type: "book", hash: hash, bookmarkId: b.id, position: b.position, addedAt: b.addedAt, bookName: name, name: b.name, isMain: !!b.isMain, availableLocally: !!manifest[hash]});
        });
      });
      callback(items);
    }).catch(function(){ callback([]); });
  }

  // Открывает книгу по хэшу (актуальное имя файла — через манифест, см.
  // выше) и прокручивает к абзацу закладки — точка входа из общей вкладки
  // "Закладки" (клик по книжной закладке, см. mdeditor.js). Переключает
  // вкладку настроек на "Книги" (set2s_7) тем же способом, что и клик по
  // [[ссылке]]/заметке-закладке переключает на "Мой блокнот" (set2s_1).
  function openBookAtMarginBookmark(hash, position){
    getBooksDirHandle().then(function(dir){
      return loadBooksManifest(dir);
    }).catch(function(){ return {}; }).then(function(manifest){
      var name = manifest[hash];
      switchSettingsTab("set2s_7"); // рендерит renderSettingsTabBooks — #booksStatus уже в DOM
      if(!name){
        // Закладка синхронизирована и видна в общем списке (см.
        // getBookMarginBookmarksForList выше — она не зависит от наличия
        // файла), но сам файл книги на ЭТОМ устройстве ещё не появился:
        // передача байтов идёт отдельным, более медленным путём через
        // реестр Firebase Storage (см. syncFilesRegistry). Открыть книгу
        // здесь пока нечем — сообщаем об этом явно, а не бездействуем молча.
        var statusEl = document.getElementById("booksStatus");
        if(statusEl){
          statusEl.textContent = "Эта книга ещё не скачана на это устройство — закладка сохранена, но открыть книгу пока нечем. Она появится здесь автоматически, как только синхронизируется, либо загрузите файл книги вручную.";
          statusEl.classList.add("error");
        }
        return;
      }
      return openBookReader(name).then(function(){
        requestAnimationFrame(function(){
          var el = document.getElementById("bookP_" + position.ch + "_" + position.blk);
          var container = document.getElementById("settingsTabContent");
          if(el && container) container.scrollTop = el.offsetTop;
        });
      });
    });
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
  // Ключ для сохранения последних извлечённых субтитров в localStorage
  // (ТЗ пользователя от 07.09, п.6): текст в области чтения переживает не
  // только переключение вкладок, но и закрытие всего приложения — при
  // следующем открытии вкладки subtitle-extract-output снова показывает
  // тот же текст, пока не будет успешно извлечён новый (см.
  // renderSettingsTabSubtitleExtract ниже).
  var SUBTITLE_EXTRACT_TEXT_KEY = "bibleSubtitleExtractedText_v1";
  // Позиция прокрутки вкладки (ТЗ пользователя от 07.09, п.7: "Мой
  // блокнот" переживает закрытие приложения и открывается с того же
  // места, а "Извлечение субтитров" — каждый раз с начала, это неудобно).
  // Тот же приём, что и currentScrollPercent/restorePercent в mdeditor.js
  // (см. flushDocStateNow там же), но проще: здесь нет ни курсора, ни
  // конкретного документа — только процент прокрутки общего контейнера
  // #settingsTabContent, сохранённый в localStorage (без IndexedDB — та
  // в этом файле не используется, а связываться с ней ради одного числа
  // незачем).
  var SUBTITLE_EXTRACT_SCROLL_KEY = "bibleSubtitleExtractScroll_v1";
  var subtitleScrollContainer = null;
  var subtitleScrollHandler = null;
  var subtitleScrollSaveTimer = null;
  function saveSubtitleScrollNow(){
    if(subtitleScrollSaveTimer){ clearTimeout(subtitleScrollSaveTimer); subtitleScrollSaveTimer = null; }
    var sc = document.getElementById("settingsTabContent");
    if(!sc) return;
    var max = sc.scrollHeight - sc.clientHeight;
    var pct = max > 0 ? Math.max(0, Math.min(1, sc.scrollTop / max)) : 0;
    try{ localStorage.setItem(SUBTITLE_EXTRACT_SCROLL_KEY, String(pct)); }catch(e){}
  }
  function scheduleSubtitleScrollSave(){
    if(subtitleScrollSaveTimer) clearTimeout(subtitleScrollSaveTimer);
    subtitleScrollSaveTimer = setTimeout(saveSubtitleScrollNow, 500);
  }
  // Снимает слушатель скролла (и сбрасывает несохранённый debounce-таймер
  // без потери данных — сохраняет немедленно) при уходе с вкладки, чтобы
  // прокрутка ДРУГИХ вкладок не перезаписывала сохранённую позицию
  // субтитров и чтобы не копились дубликаты слушателей на
  // #settingsTabContent при повторных заходах на вкладку. Вызывается из
  // switchSettingsTab безусловно, тем же приёмом, что и
  // flushPendingMdEditorEdit там же.
  function destroySubtitleScrollListener(){
    if(subtitleScrollSaveTimer){ saveSubtitleScrollNow(); }
    if(subtitleScrollContainer && subtitleScrollHandler){
      subtitleScrollContainer.removeEventListener("scroll", subtitleScrollHandler);
    }
    subtitleScrollContainer = null;
    subtitleScrollHandler = null;
  }
  // Текст, который раньше жил в шапке вкладки (.subtitle-extract-hint) —
  // теперь по кнопке "i" (см. ниже) показывается прямо в области чтения,
  // из шапки убран (ТЗ пользователя от 07.09).
  var SUBTITLE_INFO_TEXT = "Выберите видео (.mp4) со встроенной текстовой дорожкой субтитров — текст будет извлечён сразу на месте, без выхода в интернет.";
  function renderSettingsTabSubtitleExtract(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    var selectedFile = null;
    var extractedText = "";
    try{ extractedText = localStorage.getItem(SUBTITLE_EXTRACT_TEXT_KEY) || ""; }catch(e){}
    // Заголовок на общем классе .common-tab-title (переименован из
    // .subtitle-extract-title, ТЗ пользователя от 08.09 — назывался по
    // имени этой вкладки-образца, хотя класс общий для шести заголовков,
    // см. components.css), а не общем .workbooks-title — единый Palatino
    // Linotype/Georgia по всей вкладке (ТЗ пользователя от 07.09), без
    // декоративного Trajan Pro и без влияния на другие вкладки,
    // использующие .workbooks-title.
    //
    // Правка от 07.09 (третий заход): статус файла и ряд кнопок больше не
    // занимают свою часть высоты окна — .subtitle-controls-fab плавает над
    // текстом результата тем же приёмом, что и .mdeditor-fab-row у "Моего
    // блокнота" (position:absolute от .settings-modal-box, см.
    // components.css), а сама область результата — обычный блок в общем
    // потоке #settingsTabContent, растёт вместе с текстом (см.
    // autoResizeOutput ниже) — прокручивается вся вкладка целиком, без
    // собственной прокрутки у textarea и без "тумана"-маски. "Аа" с этой
    // вкладки убрана вовсе — размер по-прежнему берётся из общей
    // переменной --mdeditor-font-size, просто без своего органа
    // управления здесь (регулируется из "Моих заметок").
    container.innerHTML =
      '<div class="common-tab-title">Извлечение субтитров</div>' +
      '<div class="subtitle-extract-output is-empty" id="srtOutput"></div>' +
      '<div class="subtitle-controls-fab" id="srtControlsFab">' +
        // Статус-пилюля начинается пустой (ТЗ пользователя от 07.09,
        // четвёртый заход: убрать "Файл не выбран" — пока нечего сказать,
        // пилюля не нужна вовсе). Пустой <span> схлопывается через
        // .subtitle-file-status:empty в components.css, появляется, как
        // только setFileStatus вставит текст (имя файла, "Готово —
        // извлечено реплик: N." и т.п.).
        '<span id="srtFileStatus" class="subtitle-file-status"></span>' +
        '<div class="subtitle-action-row">' +
          '<button type="button" class="mdeditor-fab-btn" id="srtInfoBtn" title="Информация">' + INFO_ICON_SVG + '</button>' +
          '<button type="button" class="workbooks-run-btn subtitle-start-btn" id="srtStartBtn" disabled>Начать</button>' +
          '<button type="button" class="mdeditor-fab-btn" id="srtAttachBtn" title="Выбрать файл">' + PAPERCLIP_ICON_SVG + '</button>' +
          // "Скачать" разворачивается в "md"/"txt" тем же приёмом, что и
          // "Аа" в .mdeditor-fontsize-wrap/-popup у "Моих заметок" (см.
          // components.css): клик по самой кнопке открывает попап из двух
          // кнопок СТОЛБИКОМ над ней, клик по формату скачивает и сам
          // закрывает попап (как "Ж"/"К"/"П"/"Ч" там же), повторный клик
          // по самой кнопке — тоже закрывает (ТЗ пользователя от 07.09).
          '<span class="mdeditor-fontsize-wrap" id="srtDownloadWrap">' +
            '<div class="mdeditor-fontsize-popup" id="srtDownloadPopup">' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="srtDownloadMdBtn" title="Скачать .md" disabled>md</button>' +
              '<button type="button" class="mdeditor-fab-btn mdeditor-fab-btn-text" id="srtDownloadTxtBtn" title="Скачать .txt" disabled>txt</button>' +
            '</div>' +
            '<button type="button" class="mdeditor-fab-btn subtitle-download-btn" id="srtDownloadBtn" title="Скачать" disabled>' + DOWNLOAD_ICON_SVG + '</button>' +
          '</span>' +
          '<button type="button" class="mdeditor-fab-btn subtitle-copy-btn" id="srtCopyBtn" title="Скопировать субтитры" disabled>' + COPY_ICON_SVG + '</button>' +
          '<button type="button" class="mdeditor-fab-btn subtitle-save-note-btn" id="srtSaveNoteBtn" title="Сохранить в Мои заметки" disabled>' + DOWNLOAD_ICON_SVG + '</button>' +
        '</div>' +
      '</div>' +
      '<input type="file" accept=".mp4,video/mp4" id="srtFileInput" style="display:none;">';

    var fileInput = document.getElementById("srtFileInput");
    var fileStatusEl = document.getElementById("srtFileStatus");
    var startBtn = document.getElementById("srtStartBtn");
    var copyBtn = document.getElementById("srtCopyBtn");
    var saveNoteBtn = document.getElementById("srtSaveNoteBtn");
    var infoBtn = document.getElementById("srtInfoBtn");
    var outputEl = document.getElementById("srtOutput");
    var downloadBtn = document.getElementById("srtDownloadBtn");
    var downloadPopup = document.getElementById("srtDownloadPopup");
    var downloadMdBtn = document.getElementById("srtDownloadMdBtn");
    var downloadTxtBtn = document.getElementById("srtDownloadTxtBtn");
    var downloadPanelOpen = false;
    // Область результата больше не имеет фиксированной высоты/своей
    // прокрутки (см. .subtitle-extract-output в components.css) — высоту
    // выставляем вручную по содержимому при каждой смене текста, чтобы
    // элемент рос вместе с текстом, а прокручивалась вся вкладка целиком
    // (тот же эффект, что и у CodeMirror в "Моих заметках", где скролл
    // тоже отдан внешнему контейнеру).
    function autoResizeOutput(){
      outputEl.style.height = "auto";
      outputEl.style.height = outputEl.scrollHeight + "px";
    }
    // Кнопка "i": по нажатию область чтения показывает статичный текст
    // подсказки вместо извлечённых субтитров/заглушки, повторное нажатие
    // возвращает как было. Если за это время успешно извлеклись новые
    // субтитры (см. startBtn click ниже) — кнопка сама "отжимается" и
    // область переключается на результат, показывать подсказку дальше
    // незачем (ТЗ пользователя от 07.09).
    var infoVisible = false;
    // Раньше просто outputEl.value = text (textarea). Теперь outputEl —
    // <div>: каждый абзац (разделены "\n\n" при извлечении, см.
    // buildSubtitleText выше) оборачивается в свой <p>, чтобы CSS мог
    // дать каждому красную строку и отступ от соседнего абзаца (те же
    // text-indent/margin, что и у абзацев заметки в "Моих заметках", см.
    // .subtitle-extract-output в components.css). Перенос строки внутри
    // одного абзаца (одиночный "\n", если такой встретится) — через
    // <br>, а не отдельный <p>. Пустой текст — просто пустой div, плейсхолдер
    // рисует CSS через класс is-empty (.subtitle-extract-output.is-empty::before).
    function showOutputText(){
      var text = infoVisible ? SUBTITLE_INFO_TEXT : extractedText;
      outputEl.classList.toggle("is-empty", !text);
      if(!text){
        outputEl.innerHTML = "";
      } else {
        outputEl.innerHTML = text.split(/\n\s*\n/).map(function(para){
          return "<p>" + escapeHtml(para).replace(/\n/g, "<br>") + "</p>";
        }).join("");
      }
      autoResizeOutput();
    }
    infoBtn.addEventListener("click", function(){
      infoVisible = !infoVisible;
      infoBtn.classList.toggle("pressed", infoVisible);
      showOutputText();
    });

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
    function setSaveNoteReady(ready){
      saveNoteBtn.disabled = !ready;
      saveNoteBtn.classList.toggle("ready", !!ready);
    }
    // Та же готовность, что и у копирования (есть извлечённый текст) —
    // включает саму кнопку "Скачать" и оба формата в попапе разом.
    function setDownloadReady(ready){
      downloadBtn.disabled = !ready;
      downloadMdBtn.disabled = !ready;
      downloadTxtBtn.disabled = !ready;
      downloadBtn.classList.toggle("ready", !!ready);
    }
    // Скачивание текста результата как файла — имя берём от исходного
    // видео (без расширения), чтобы .md/.txt легко было соотнести с
    // видео, из которого извлекли; если файл ещё не выбирали (открыли
    // вкладку сразу с сохранённым текстом от прошлого раза) — нейтральное
    // имя по умолчанию.
    function downloadSubtitleAs(ext, mime){
      if(!extractedText) return;
      var base = selectedFile ? selectedFile.name.replace(/\.[^./]+$/, "") : "субтитры";
      var blob = new Blob([extractedText], { type: mime + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = base + "." + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    }
    // "Скачать" — та же механика попапа, что у "Аа"/"Ж" в "Моих заметках"
    // (см. .mdeditor-fontsize-wrap/-popup в components.css): клик по самой
    // кнопке открывает/закрывает попап, клик по формату скачивает и сам
    // закрывает попап следом (как "Ж"/"К"/"П"/"Ч" там же).
    downloadBtn.addEventListener("mousedown", function(e){ e.preventDefault(); });
    downloadBtn.addEventListener("click", function(){
      downloadPanelOpen = !downloadPanelOpen;
      downloadPopup.classList.toggle("open", downloadPanelOpen);
    });
    function bindDownloadFormatBtn(btn, ext, mime){
      btn.addEventListener("mousedown", function(e){ e.preventDefault(); });
      btn.addEventListener("click", function(){
        downloadSubtitleAs(ext, mime);
        downloadPanelOpen = false;
        downloadPopup.classList.remove("open");
      });
    }
    bindDownloadFormatBtn(downloadMdBtn, "md", "text/markdown");
    bindDownloadFormatBtn(downloadTxtBtn, "txt", "text/plain");
    // Восстанавливаем последний сохранённый текст сразу при открытии
    // вкладки — до выбора нового файла область чтения показывает именно
    // его (localStorage, см. SUBTITLE_EXTRACT_TEXT_KEY выше). Кнопка "i"
    // при открытии вкладки всегда отжата (infoVisible=false по умолчанию).
    showOutputText();
    setCopyReady(!!extractedText);
    setDownloadReady(!!extractedText);
    setSaveNoteReady(!!extractedText);

    document.getElementById("srtAttachBtn").addEventListener("click", function(){
      fileInput.click();
    });
    fileInput.addEventListener("change", function(){
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      setFileStatus(selectedFile ? selectedFile.name : "");
      startBtn.disabled = !selectedFile;
      // Текст в области чтения НЕ сбрасывается здесь (ТЗ пользователя от
      // 07.09, п.6) — старые субтитры остаются видны, пока извлечение из
      // нового файла не завершится успешно (см. startBtn click ниже).
    });

    startBtn.addEventListener("click", function(){
      if(!selectedFile) return;
      startBtn.disabled = true;
      // Старый текст (свой или сохранённый ранее) НЕ стирается здесь —
      // остаётся в области чтения на время обработки и заменяется только
      // при успешном извлечении из нового файла (ТЗ пользователя от
      // 07.09, п.6).
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
        var newText = reflowSubtitleCues(cues);
        startBtn.disabled = false;
        if(newText){
          extractedText = newText;
          // Успешное извлечение "отжимает" кнопку "i", если она была
          // нажата, и показывает результат вместо подсказки (ТЗ
          // пользователя от 07.09, второй заход).
          infoVisible = false;
          infoBtn.classList.remove("pressed");
          showOutputText();
          setCopyReady(true);
          setDownloadReady(true);
          setSaveNoteReady(true);
          try{ localStorage.setItem(SUBTITLE_EXTRACT_TEXT_KEY, extractedText); }catch(e){}
          setFileStatus("Готово — извлечено реплик: " + cues.length + ".", "success");
        } else {
          setFileStatus("Дорожка субтитров в этом видео пуста.", "error");
        }
      }).catch(function(err){
        startBtn.disabled = false;
        console.error("Извлечение субтитров: ошибка", err);
        var detail = err && err.message ? err.message : String(err);
        setFileStatus("Не удалось извлечь субтитры: " + detail + ".", "error");
      });
    });

    copyBtn.addEventListener("click", function(){
      if(!extractedText) return;
      // Основной путь — clipboard.writeText прямо из строки extractedText,
      // ему не важно, что теперь outputEl — <div>, а не <textarea>
      // (раньше выделение через .select()/.setSelectionRange нужно было
      // только для execCommand-фолбэка ниже — у div таких методов нет,
      // поэтому для фолбэка выделяем содержимое вручную через
      // Selection/Range API).
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(extractedText).catch(function(){});
      } else {
        try{
          var range = document.createRange();
          range.selectNodeContents(outputEl);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("copy");
          sel.removeAllRanges();
        }catch(e){}
      }
      setFileStatus("Скопировано в буфер обмена.", "success");
    });

    saveNoteBtn.addEventListener("click", function(){
      if(!extractedText) return;
      openSubtitleSaveNoteDialog(extractedText);
    });

    // Восстановление позиции прокрутки и слежение за ней — в самом конце,
    // после того как весь контент вкладки (включая уже показанный
    // extractedText) отрисован и autoResizeOutput() выставил итоговую
    // высоту textarea, иначе scrollHeight ещё не отражает реальный размер
    // (см. showOutputText/autoResizeOutput выше). switchSettingsTab
    // обнуляет scrollTop ДО вызова этого рендера (см. switchSettingsTab
    // в этом файле) — requestAnimationFrame здесь всегда выполняется уже
    // ПОСЛЕ этого обнуления, тем же приёмом, что и восстановление позиции
    // заметки в mountEditor (mdeditor.js).
    var restoreScrollPercent = null;
    try{
      var storedScrollPct = localStorage.getItem(SUBTITLE_EXTRACT_SCROLL_KEY);
      if(storedScrollPct !== null) restoreScrollPercent = parseFloat(storedScrollPct);
    }catch(e){}
    var scrollContainer = document.getElementById("settingsTabContent");
    if(scrollContainer){
      subtitleScrollHandler = function(){ scheduleSubtitleScrollSave(); };
      subtitleScrollContainer = scrollContainer;
      scrollContainer.addEventListener("scroll", subtitleScrollHandler, { passive: true });
    }
    requestAnimationFrame(function(){
      var sc = document.getElementById("settingsTabContent");
      if(!sc) return;
      var max = sc.scrollHeight - sc.clientHeight;
      if(typeof restoreScrollPercent === "number" && !isNaN(restoreScrollPercent) && max > 0){
        sc.scrollTop = restoreScrollPercent * max;
      }
    });
  }

  // Модалка ввода имени заметки для кнопки "Сохранить в Мои заметки" —
  // тот же общий вид карточки поверх .settings-modal-box (.mdeditor-
  // cleanup-overlay/-card/-input/-actions), что и у "Новой заметки" в
  // самом "Моих заметках" (openNewNoteDialog в mdeditor.js), объявлена
  // здесь отдельно, потому что готовый текст субтитров должен попасть
  // ГОТОВЫМ телом новой заметки, а не в пустую (см.
  // MdEditor.createAndOpenNoteWithText в mdeditor.js). После
  // подтверждения имени переключает вкладку настроек на "Мои заметки" —
  // тем же вызовом switchSettingsTab("set2s_1"), каким это делает клик по
  // [[ссылке]] из другой вкладки (см. root.addEventListener("click", ...)
  // выше в initAutoFormatting) — и сразу открывает созданную заметку на
  // редактирование.
  function openSubtitleSaveNoteDialog(text){
    if(!settingsModalBox) return;
    var overlay = document.createElement("div");
    overlay.className = "mdeditor-cleanup-overlay";
    var card = document.createElement("div");
    card.className = "mdeditor-cleanup-card";
    card.innerHTML =
      '<div class="mdeditor-cleanup-title">Имя новой заметки</div>' +
      '<input type="text" class="mdeditor-cleanup-input" id="srtSaveNoteInput">' +
      '<div class="mdeditor-cleanup-actions">' +
        '<button type="button" class="mdeditor-cleanup-cancel" id="srtSaveNoteCancel">Отмена</button>' +
        '<button type="button" class="mdeditor-cleanup-cancel mdeditor-cleanup-primary" id="srtSaveNoteCreate">Создать</button>' +
      '</div>';
    overlay.appendChild(card);
    settingsModalBox.appendChild(overlay);

    function close(){ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function(ev){ if(ev.target === overlay) close(); });

    var input = document.getElementById("srtSaveNoteInput");
    input.focus();

    function submit(){
      var name = (input.value || "").trim();
      if(!name) return;
      // Проверка занятого имени ДО закрытия модалки/переключения вкладки —
      // как и в openNewNoteDialog (mdeditor.js), просто подсвечиваем поле
      // и не закрываем, вместо того чтобы уже переключиться на "Мой
      // блокнот" и там показать ошибку.
      if(MdEditor && MdEditor.isNoteNameTaken && MdEditor.isNoteNameTaken(name)){
        input.style.borderColor = "var(--danger, #c0392b)";
        return;
      }
      close();
      switchSettingsTab("set2s_1");
      if(MdEditor && MdEditor.createAndOpenNoteWithText) MdEditor.createAndOpenNoteWithText(name, text);
    }
    document.getElementById("srtSaveNoteCancel").addEventListener("click", close);
    document.getElementById("srtSaveNoteCreate").addEventListener("click", submit);
    document.getElementById("srtSaveNoteCreate").addEventListener("mousedown", function(ev){ ev.preventDefault(); });
    input.addEventListener("keydown", function(ev){
      if(ev.key === "Enter"){ ev.preventDefault(); submit(); }
      else if(ev.key === "Escape"){ ev.preventDefault(); close(); }
    });
  }

  // Какой набор вкладок сейчас показан — 1 (боковые/нижние из #settingsTabs
  // и #settingsTabsGear) или 2 (заглушки из #settingsTabsSet2/
  // #settingsTabsGearSet2). Плавающая кнопка-язычок (#settingsGearBtn) —
  // короткий клик: закрыто -> открыто (набор, на котором остановились в
  // прошлый раз) -> клик снова -> другой набор -> клик снова -> опять
  // первый -> ... и так по кругу БЕЗ ограничения числа переключений, пока
  // блокнот не закрыт (см. cycleSettingsTabSet и обработчик клика по
  // settingsGearBtn ниже; ТЗ пользователя от 12.09). Закрыть блокнот
  // короткий клик по язычку больше не может, пока разблокирован второй
  // набор — для этого клик МИМО окна (см. settingsModalOverlay ниже) или
  // долгое удержание самого язычка (100 мс, см. FAB_LONGPRESS_MS ниже).
  var settingsActiveTabSet = 1;
  // Запоминает набор вкладок (1 или 2) и саму последнюю реальную вкладку
  // (см. settingsLastStackTab ниже) в localStorage, а не только в памяти —
  // переживает закрытие всего приложения (см. ТЗ пользователя от 01.09,
  // пункт 2: "при открытии приложения пусть всегда запускается та же
  // вкладка, на которой человек был в последний раз", независимо от того,
  // включены ли дополнительные вкладки/инструменты). Читается в
  // getResumeSettingsState ниже.
  var SETTINGS_LAST_SET_KEY = "bibleSettingsLastTabSet_v1";
  var SETTINGS_LAST_TAB_KEY = "bibleSettingsLastTab_v1";
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
  // ссылка на функцию перерисовки экрана "Все задачи проекта"
  // (openTaskNextPicker), если он сейчас открыт поверх вкладки "projects" —
  // иначе null. currentSettingsTab при этом остаётся "projects" (см.
  // openTaskNextPicker ниже), поэтому обычных признаков вкладки недостаточно,
  // чтобы отличить этот экран от простого списка проектов (см. использование
  // в rerenderAllFromState и обнуление в switchSettingsTab).
  var activeProjectPickerRerender = null;
  // id проекта, чья карточка "Все задачи проекта" открыта последней —
  // тем же приёмом, что bookReaderState у книг (ТЗ пользователя от 12.09,
  // седьмой заход): в отличие от activeProjectPickerRerender выше, ЭТА
  // память переживает уход на любые другие вкладки (обнуляется только
  // явным выходом через кнопку-домик на самом экране, см. openTaskNextPicker
  // ниже) — именно она позволяет switchSettingsTab открыть по клику на
  // "Projects" ту же карточку проекта, а не список всех проектов заново.
  var activeProjectPickerId = null;
  // взводится ТОЛЬКО на время восстановления предыдущей вкладки функцией
  // из стека навигации (см. window.AppNav.push в switchSettingsTab ниже),
  // чтобы сам этот восстанавливающий вызов switchSettingsTab не породил
  // новую запись поверх себя же.
  var suppressNavPush = false;
  // Сохранение положения экрана "Все задачи проекта" в localStorage —
  // переживает полное закрытие/сворачивание приложения (а не только
  // внутрисессионные действия). Хранится id проекта + позиция скролла;
  // читается при каждом открытии окна настроек (см. openSettingsModal),
  // если "продолжить с того же места" (getResumeSettingsState) указывает
  // на вкладку "projects". Очищается как "нормальный выход" с экрана в
  // самом начале обычного рендера списка проектов (см. renderTaskTabList) —
  // то есть при любом настоящем переходе на другую вкладку/повторном
  // клике по "Projects".
  var PROJECT_PICKER_RESUME_KEY = "bibleProjectPickerResume_v1";
  function saveProjectPickerResumeState(projectId, scrollTop){
    try{ localStorage.setItem(PROJECT_PICKER_RESUME_KEY, JSON.stringify({ projectId: projectId, scrollTop: scrollTop })); }catch(e){}
  }
  function loadProjectPickerResumeState(){
    try{
      var raw = localStorage.getItem(PROJECT_PICKER_RESUME_KEY);
      if(!raw) return null;
      var data = JSON.parse(raw);
      if(!data || !data.projectId) return null;
      return data;
    }catch(e){ return null; }
  }
  function clearProjectPickerResumeState(){
    try{ localStorage.removeItem(PROJECT_PICKER_RESUME_KEY); }catch(e){}
  }
  // Отдельная память позиции скролла — на каждый ПРОЕКТ, а не на "последнее
  // открытие экрана" (см. PROJECT_PICKER_RESUME_KEY выше, у него другое
  // назначение и он специально стирается при обычном выходе с экрана). Эта
  // карта ничем не стирается вовсе (в т.ч. при удалении проекта — лишняя
  // запись на давно удалённый id ничего не стоит, десяток байт) — переживает
  // и переключение вкладок, и закрытие приложения: при ЛЮБОМ повторном
  // открытии "Все задачи проекта" для того же проекта (клик по кнопке-звену,
  // переход [[по ссылке]], возврат после другой вкладки) список сам
  // восстанавливает то место, где его последний раз оставили — не только
  // когда это "продолжить с того же места" после полного перезапуска
  // приложения (ТЗ пользователя от 12.09, шестой заход).
  var PROJECT_PICKER_SCROLL_MAP_KEY = "bibleProjectPickerScrollMap_v1";
  function getSavedProjectScrollTop(projectId){
    try{
      var raw = localStorage.getItem(PROJECT_PICKER_SCROLL_MAP_KEY);
      var map = raw ? JSON.parse(raw) : null;
      if(!map || typeof map[projectId] !== "number") return null;
      return map[projectId];
    }catch(e){ return null; }
  }
  function setSavedProjectScrollTop(projectId, scrollTop){
    try{
      var raw = localStorage.getItem(PROJECT_PICKER_SCROLL_MAP_KEY);
      var map = raw ? JSON.parse(raw) : {};
      map[projectId] = scrollTop;
      localStorage.setItem(PROJECT_PICKER_SCROLL_MAP_KEY, JSON.stringify(map));
    }catch(e){}
  }
  // debounce для сохранения позиции скролла (см. openTaskNextPicker) —
  // не пишем в localStorage на каждый пиксель прокрутки
  var projectPickerScrollSaveTimer = null;
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
    try{ localStorage.setItem(SETTINGS_LAST_SET_KEY, String(settingsActiveTabSet)); }catch(e){}
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

  // "Продолжить с того же места" (см. ТЗ пользователя от 01.09, пункт 2) —
  // вычисляет, какой набор и какую именно вкладку нужно показать при
  // ОТКРЫТИИ окна настроек (вызывается из openSettingsModal ниже, поэтому
  // действует одинаково независимо от того, чем именно вызвано открытие:
  // язычком-кнопкой или программно после промежуточной модалки), опираясь
  // на то, что сохранено в localStorage (см. SETTINGS_LAST_SET_KEY/
  // SETTINGS_LAST_TAB_KEY выше) — в отличие от settingsActiveTabSet/
  // settingsLastStackTab, эти сохранённые значения переживают полное
  // закрытие приложения. С проверкой, что сохранённая вкладка сейчас
  // вообще доступна (набор 2 разблокирован кодом, вкладки задач набора 1
  // не спрятаны галочкой "Показать все мои задачи") — если недоступна,
  // используется вкладка по умолчанию того же набора, как и раньше.
  function getResumeSettingsState(){
    var savedTab = null, savedSet = 1;
    try{ savedTab = localStorage.getItem(SETTINGS_LAST_TAB_KEY); }catch(e){}
    try{ savedSet = (localStorage.getItem(SETTINGS_LAST_SET_KEY) === "2") ? 2 : 1; }catch(e){}
    if(savedSet === 2 && !isSet2Unlocked()){ savedSet = 1; savedTab = null; }
    if(savedTab && TASK_TAB_IDS.hasOwnProperty(savedTab) && !getShowAllTasksEnabled()){
      savedTab = null;
    }
    if(savedTab){
      var belongsToSet1 = SETTINGS_SIDE_ORDER_1.indexOf(savedTab) !== -1 || SETTINGS_BOTTOM_ORDER_1.indexOf(savedTab) !== -1;
      var belongsToSet2 = SETTINGS_SIDE_ORDER_2.indexOf(savedTab) !== -1 || SETTINGS_BOTTOM_ORDER_2.indexOf(savedTab) !== -1;
      if((savedSet === 1 && !belongsToSet1) || (savedSet === 2 && !belongsToSet2)) savedTab = null;
    }
    if(!savedTab){
      savedTab = (savedSet === 1) ? (getShowAllTasksEnabled() ? "red" : "gear") : "set2b_1";
    }
    return { set: savedSet, tab: savedTab };
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
    var hideStatusBarOn = getHideStatusBarEnabled();
    var bibleQuotesOn = getBibleQuotesEnabled();
    var customCommentsOn = getCustomCommentsEnabled();
    var customVerse = getCustomVerse();
    var debugModeOn = window.Debug ? window.Debug.isEnabled() : false;
    var bookCols = getBookColumns();
    container.innerHTML =
      '<div class="settings-row"><span>Добавить дополнительный счётчик</span><input type="checkbox" id="settingsHourCb"' + (hourOn ? " checked" : "") + '></div>' +
      '<div class="settings-row" id="settingsHourNotesRow" style="' + (hourOn ? "" : "display:none;") + '"><span>Добавить комментарий в дополнительный счётчик</span><input type="checkbox" id="settingsHourNotesCb"' + (hourNotesOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Видеть меньше прогресс-баров</span><input type="checkbox" id="settingsReducedCb"' + (reducedOn ? " checked" : "") + '></div>' +
      '<div class="settings-row settings-row-book-cols">' +
        '<span>Количество колонок для книг</span>' +
        '<div class="settings-book-cols-options">' +
          '<label class="settings-book-cols-opt"><input type="checkbox" id="settingsBookCols1" data-cols="1"' + (bookCols === 1 ? " checked" : "") + '><span>1</span></label>' +
          '<label class="settings-book-cols-opt"><input type="checkbox" id="settingsBookCols2" data-cols="2"' + (bookCols === 2 ? " checked" : "") + '><span>2</span></label>' +
          '<label class="settings-book-cols-opt"><input type="checkbox" id="settingsBookCols3" data-cols="3"' + (bookCols === 3 ? " checked" : "") + '><span>3</span></label>' +
        '</div>' +
      '</div>' +
      '<div class="settings-row"><span>Отмечать прочитанные главы другим цветом</span><input type="checkbox" id="settingsColorMarkCb"' + (colorMarkOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Включить библейские стихи в шапке приложения</span><input type="checkbox" id="settingsBibleQuotesCb"' + (bibleQuotesOn ? " checked" : "") + '></div>' +
      '<div class="settings-verse-block" id="settingsCustomVerseRow" style="' + (bibleQuotesOn ? "" : "display:none;") + '">' +
        '<span class="settings-verse-label">Свой ключевой стих для шапки (по желанию)</span>' +
        '<textarea class="settings-verse-input" id="settingsCustomVerseText" placeholder="Текст стиха…" rows="2"></textarea>' +
        '<input type="text" class="settings-verse-input" id="settingsCustomVerseRef" placeholder="Ссылка, например: Иоанна 3:16">' +
      '</div>' +
      '<div class="settings-row"><span>Включить личные комментарии в шапке сайта</span><input type="checkbox" id="settingsCustomCommentsCb"' + (customCommentsOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Показать все мои задачи</span><input type="checkbox" id="settingsShowAllTasksCb"' + (showAllTasksOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Включить дополнительные анимации</span><input type="checkbox" id="settingsExtraAnimCb"' + (extraAnimOn ? " checked" : "") + '></div>' +
      '<div class="settings-row"><span>Включить полноэкранный режим</span><input type="checkbox" id="settingsHideStatusBarCb"' + (hideStatusBarOn ? " checked" : "") + '></div>' +
      '<div class="settings-row" style="border-bottom:none;"><span>Включить режим отладки</span><input type="checkbox" id="settingsDebugModeCb"' + (debugModeOn ? " checked" : "") + '></div>' +
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

    var bookColsInputs = [
      document.getElementById("settingsBookCols1"),
      document.getElementById("settingsBookCols2"),
      document.getElementById("settingsBookCols3")
    ];
    bookColsInputs.forEach(function(inp){
      inp.addEventListener("change", function(){
        if(!this.checked){
          // Ровно один вариант должен быть активен всегда — повторный клик
          // по уже выбранному варианту его не снимает.
          this.checked = true;
          return;
        }
        var chosen = this;
        bookColsInputs.forEach(function(other){
          if(other !== chosen) other.checked = false;
        });
        setBookColumns(parseInt(chosen.getAttribute("data-cols"), 10));
      });
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

    document.getElementById("settingsHideStatusBarCb").addEventListener("change", function(){
      // Сам клик по галочке — жест пользователя, поэтому вход в fullscreen
      // сработает сразу же, без необходимости в armHideStatusBarAutoRetry.
      setHideStatusBarEnabled(this.checked);
    });

    document.getElementById("settingsDebugModeCb").addEventListener("change", function(){
      // Логика режима отладки (localStorage-флаг + панель логов) живёт в
      // debug.js, здесь только передаём галочку туда.
      if(window.Debug) window.Debug.setEnabled(this.checked);
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
  if(settingsGearBtn){
    // Долгое удержание язычка сворачивает уже открытый блокнот (ТЗ
    // пользователя от 12.09) — второй способ закрыть его, помимо клика
    // мимо окна, раз короткий клик по язычку теперь только крутит набор
    // вкладок по кругу и сам никогда не закрывает (см. обработчик клика
    // ниже).
    var FAB_LONGPRESS_MS = 100;
    var fabLongPressTimer = null;
    var fabLongPressFired = false;

    function clearFabLongPressTimer(){
      if(fabLongPressTimer){ clearTimeout(fabLongPressTimer); fabLongPressTimer = null; }
    }

    settingsGearBtn.addEventListener("pointerdown", function(){
      fabLongPressFired = false;
      clearFabLongPressTimer();
      // Удержание значимо, только пока блокнот уже открыт — если он
      // закрыт, обычный короткий клик и так его откроет, таймер заводить
      // незачем (и не нужно мешать обычному открытию).
      if(!(settingsModalOverlay && settingsModalOverlay.classList.contains("open"))) return;
      fabLongPressTimer = setTimeout(function(){
        fabLongPressTimer = null;
        fabLongPressFired = true;
        closeSettingsModal();
      }, FAB_LONGPRESS_MS);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function(evt){
      settingsGearBtn.addEventListener(evt, clearFabLongPressTimer);
    });

    settingsGearBtn.addEventListener("click", function(){
      // Долгое удержание уже само закрыло блокнот в pointerdown-таймере
      // выше — браузер всё равно посылает следом обычный click при
      // отпускании, его нужно проглотить, а не открывать блокнот заново.
      if(fabLongPressFired){ fabLongPressFired = false; return; }
      if(settingsModalOverlay && settingsModalOverlay.classList.contains("open")){
        // блокнот уже открыт: короткий клик всегда переключает набор
        // вкладок по кругу (набор 1 <-> набор 2 <-> ...), пока второй
        // набор разблокирован кодом — без ограничения числа переключений
        // (см. cycleSettingsTabSet выше). Закрытие теперь только через
        // клик мимо окна или долгое удержание язычка (см. выше).
        if(isSet2Unlocked()){
          cycleSettingsTabSet();
        } else {
          // второго набора для этого пользователя как будто не
          // существует — крутить нечего, поэтому короткий клик по
          // язычку по-прежнему сворачивает блокнот (как и раньше).
          closeSettingsModal();
        }
      } else {
        // открытие показывает набор и вкладку, на которых человек
        // остановился в прошлый раз (см. openSettingsModal/
        // getResumeSettingsState выше) — переживает и закрытие приложения.
        openSettingsModal();
      }
    });
  }

  // Ставим язычок-кнопку в угол окна настроек сразу при загрузке страницы
  // (а не только при первом открытии окна) и держим его там при ресайзе/
  // повороте экрана — см. layoutSettingsModal выше.
  layoutSettingsModal();
  var settingsLayoutResizeTimer = null;
  window.addEventListener("resize", function(){
    clearTimeout(settingsLayoutResizeTimer);
    settingsLayoutResizeTimer = setTimeout(function(){
      // Пока в фокусе редактируемое поле (задача, заметка, комментарий и
      // т.п.) — геометрию окна настроек не трогаем. На мобильных открытие
      // экранной клавиатуры само по себе бросает событие resize (на части
      // WebView-браузеров даже уменьшает window.innerHeight, как обычный
      // ресайз окна), а пересчёт высоты/отступа окна настроек прямо в этот
      // момент сталкивается с тем, что браузер САМ уже скроллит фокусное
      // поле в видимую область над клавиатурой — из-за этой гонки поле
      // визуально "прыгает" или клавиатура закрывается, не дав дописать
      // (см. ТЗ пользователя от 02.09 — создание/редактирование задачи).
      // Как только фокус уйдёт (blur), при следующем реальном ресайзе
      // геометрия досчитается как обычно.
      if(document.activeElement && document.activeElement.isContentEditable) return;
      layoutSettingsModal();
    }, 120);
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
    // новые заметки "Моих заметок", созданные в этот день (см.
    // getNoteCreationsForDay/recordNoteCreated выше и ТЗ пользователя от
    // 04.09) — независимая запись под днём СОЗДАНИЯ, не редактирования
    var notesCreated = getNoteCreationsForDay(dayTs);

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
      // ТЗ пользователя от 13.09: в этом списке показываем только первые
      // три строки текста задачи (сама задача при этом никак не
      // укорачивается — здесь просто визуальная обрезка через
      // .year-day-task-item, см. components.css, тем же приёмом line-clamp,
      // что нигде в проекте раньше не применялся, поэтому свой отдельный
      // класс, а не общий .year-day-goal-item — тот делят с "целями" и
      // "заметками" выше/ниже, которые обрезать не просили).
      var tasksHtml = tasksDone.map(function(t){
        return '<div class="year-day-goal-item year-day-task-item">' + escapeHtml(t.text || "Без названия") +
          ' <span class="year-day-goal-source">— ' + escapeHtml(TASK_TAB_TITLES[t.tab] || t.tab || "") + '</span></div>';
      }).join("");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">✅</span><span>Выполненные задачи:' + tasksHtml + '</span></div>';
    }
    if(notesCreated.length){
      // formatInline — тот же формат "[[ссылка]]", что и везде в
      // приложении (см. formatInline выше): клик по ней уже подхватывается
      // общим делегированным обработчиком на #settingsTabContent
      // (переключает на "Мои заметки" и открывает нужную заметку, создавая
      // её заново, если она была с тех пор удалена/переименована — как и
      // у любой другой [[ссылки]] в приложении).
      var notesHtml = notesCreated.map(function(n){
        return '<div class="year-day-goal-item">' + formatInline("[[" + n.name + "]]") + '</div>';
      }).join("");
      rows += '<div class="year-day-stat-row"><span class="year-day-stat-icon">📝</span><span>Новые заметки:' + notesHtml + '</span></div>';
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
    text = text.split(EMPTY_ANCHOR_CHAR).join("");
    // браузер сам подменяет обычный пробел на NBSP в contenteditable, когда
    // в момент набора этот пробел оказывается последним символом строки —
    // невидимо на экране, но ломает измерение последней строки текста в
    // fitTaskActions (см. normalizeNbsp/linkifyHtml выше, там же — почему).
    // Приводим к обычному пробелу уже при сохранении правок, чтобы он не
    // попадал в сохранённый текст заново.
    return normalizeNbsp(text);
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
        '<div class="common-tab-title">Карта дней года</div>' +
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
  // NBSP (U+00A0) и родственные ей "неразрывные" пробельные символы
  // (узкий неразрывный U+202F, "figure space" U+2007) визуально неотличимы
  // от обычного пробела, но, в отличие от него, НЕ схлопываются в конце
  // визуальной строки — из-за этого Range.getClientRects() в fitTaskActions
  // (см. ниже) засчитывает такой пробел в ширину последней строки текста,
  // хотя на экране после него ничего не видно, и кнопки задачи ошибочно
  // уходят на отдельную строку, даже когда места на вид достаточно (см. ТЗ
  // пользователя от 31.08 — "не планировать повторение вначале месяца",
  // подтверждено измерением скриншота и прямым тестом в браузере: реальный
  // зазор после последней строки и ширина, нужная кнопкам, отличались там
  // буквально на ширину одного пробельного символа). Такой символ обычно
  // попадает в текст не по воле пользователя: браузер сам подставляет NBSP
  // вместо обычного пробела в contenteditable, если в момент набора этот
  // пробел оказывается последним символом (см. getEditableNoteText ниже —
  // там же вырезаем его при СОХРАНЕНИИ новых правок), а также он нередко
  // приходит при вставке текста, скопированного из других приложений.
  // Приводим к обычному пробелу и здесь, при ПОКАЗЕ текста — чтобы уже
  // сохранённые ранее задачи с таким "невидимым" лишним пробелом починились
  // сразу, без необходимости открывать и заново сохранять их вручную.
  var NBSP_LIKE_RE = /[\u00A0\u202F\u2007]/g;
  function normalizeNbsp(s){
    return s ? s.replace(NBSP_LIKE_RE, " ") : s;
  }
  function linkifyHtml(s){
    return formatObsidianHtml(normalizeNbsp(s));
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
    // ВАЖНО: t всегда должен быть временем ИМЕННО этой записи, а не
    // "унаследованным" от старой версии — mergeStates сравнивает записи
    // по t (last-write-wins), и если t не обновлять при каждом изменении
    // (перенос вкладки, флажок, отметка выполнено), то на другом
    // устройстве при слиянии t совпадёт со старой облачной копией и
    // локальная (устаревшая) версия победит вместо свежей из облака —
    // изменения не подтянутся.
    //
    // Порядок задач в списках (см. getTasksForTab) больше НЕ завязан на
    // t: раньше как раз t и определял порядок, и любое изменение задачи
    // (текст, приоритет, перенос) поднимало её в самый верх списка — ТЗ
    // пользователя от 02.09: при редактировании/отметке красного статуса
    // задача не должна прыгать, должна оставаться на месте. Поэтому
    // заводим отдельное поле createdAt — проставляется один раз и больше
    // никогда не трогается, именно оно теперь и определяет позицию в
    // списке. У задач, заведённых до появления этого поля, откатываемся
    // на ближайшее известное время — t той версии записи, что лежала в
    // state ДО этого сохранения (если её ещё не было — значит задача
    // только что создаётся, и это просто Date.now()) — так все старые
    // задачи получают стабильную точку отсчёта уже при первом же после
    // этой правки изменении и дальше больше не двигаются.
    if(data.createdAt == null){
      var existing = state["task:" + id];
      data.createdAt = existing ? existing.t : Date.now();
    }
    state["task:" + id] = {c: data, t: Date.now()};
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
  // Задача, отмеченная "[x]" прямо в "Моих заметках" (см. TaskActionsWidget
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
        return (b.c.createdAt != null ? b.c.createdAt : b.t) - (a.c.createdAt != null ? a.c.createdAt : a.t);
      });
    }
    return getAllTasks().filter(function(t){ return t.c.tab === tab && t.c.checked !== true; })
      .sort(function(a,b){ return (b.c.createdAt != null ? b.c.createdAt : b.t) - (a.c.createdAt != null ? a.c.createdAt : a.t); });
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
    // Та же причина, что и в saveTaskData выше: t должен отражать время
    // ПОСЛЕДНЕГО изменения этой записи, иначе редактирование комментария
    // не подтянется на другом устройстве при слиянии (см. mergeStates).
    var rec = state["comment:" + id];
    var t = rec ? Date.now() : (createdAt || Date.now());
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

  // Перенос задачи в "Комментарии" через сетку "Перенести задачу"
  // (openTaskMovePicker/openRowMovePicker, ТЗ пользователя от 13.09):
  // задачи и комментарии — два разных хранилища ("task:"/"comment:"), моve-
  // TaskToTab сюда не годится — вместо перекладки задачи создаётся НОВАЯ
  // запись комментария с тем же текстом, а сама задача удаляется
  // безвозвратно (deleteTaskPermanently, как крестик в архиве) — обратной
  // связи с исходной задачей нет. Картинки, вставленные в задачу
  // ("![[имя]]", кнопка-скрепка) — по ТЗ НЕ переносятся: соответствующие
  // плейсхолдеры вырезаются из текста тем же регулярным выражением, что и
  // в formatInline (imgRe, см. выше); сами файлы в OPFS images/ не трогаем
  // — если больше нигде не упомянуты, их уберёт обычная корзина сирот.
  var TASK_TO_COMMENT_IMG_RE = /!\[\[([^\[\]\n]+)\]\]/g;
  function convertTaskToComment(taskId){
    var task = getTaskById(taskId);
    if(!task) return;
    var text = (task.c.text || "").replace(TASK_TO_COMMENT_IMG_RE, "").trim();
    var id = createComment();
    setCommentText(id, text);
    deleteTaskPermanently(taskId);
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

  // ---- новые заметки "Моих заметок" в "Карте дней года"
  // ("notecreated:<деньСоздания>-<rand>") — тот же принцип, что и у
  // yearcomment: выше: независимая запись под днём СОЗДАНИЯ заметки (ТЗ
  // пользователя от 04.09), дальнейшее переименование/редактирование/
  // удаление самой заметки эту запись не трогает. Вызывается из
  // deps.recordNoteCreated (см. initMdEditorModule выше) внутри
  // createAndOpenNote в mdeditor.js — то есть именно в момент создания,
  // не редактирования.
  function genNoteCreatedId(dayTs){
    return "notecreated:" + dayTs + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  }
  function recordNoteCreated(name){
    var dayTs = startOfDay(Date.now());
    var key = genNoteCreatedId(dayTs);
    state[key] = {c: {name: name}, t: Date.now()};
    saveLocalState();
    scheduleCloudPush();
    refreshYearGridIfOpen();
  }
  // заметки, созданные в конкретный день — для детализации дня в "Карте
  // дней года" (см. renderYearDayDetail)
  function getNoteCreationsForDay(dayTs){
    var prefix = "notecreated:" + dayTs + "-";
    var list = [];
    Object.keys(state).forEach(function(k){
      if(k.indexOf(prefix) !== 0) return;
      var rec = state[k];
      if(!rec || !rec.c || !rec.c.name) return;
      list.push({key: k, name: rec.c.name, t: rec.t});
    });
    list.sort(function(a,b){ return a.t - b.t; });
    return list;
  }

  // ===================== ВКЛАДКА "КОММЕНТАРИИ" (extra2): ОТРИСОВКА =====================
  // Значок-иконка (речевое облако) для язычка вкладки, когда функция
  // включена — тот же визуальный язык (контур, currentColor), что и у
  // остальных пиктограмм вкладок.
  var COMMENT_TAB_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5z"></path><path d="M8 10h8"></path><path d="M8 13h5"></path></svg>';
  // Обрезка по строкам + шеврон "показать полностью" — тот же приём, что
  // у обычных задач (см. TASK_CLAMP_LINES/expandedTaskIds ниже в разделе
  // "ВКЛАДКИ ЗАДАЧ: ОТРИСОВКА"), но у комментариев своя карта развёрнутых
  // id — id-пространство комментариев отдельное от задач, использовать
  // ту же карту было бы неверно.
  var expandedCommentIds = {};
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
      '<div class="task-list" id="commentListWrap">' + rowsHtml + TASK_LIST_BOTTOM_SPACER_HTML + '</div>' +
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
    // Развёрнутые комментарии (expandedCommentIds) рисуются без обрезки —
    // та же логика, что у renderTaskRowView (см. isExpanded там).
    var isExpanded = !!expandedCommentIds[id];
    body.innerHTML =
      '<span class="task-text-view' + (isExpanded ? '' : ' task-text-clamped') + '">' + textHtml + '</span>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-expand-btn" title="Показать полностью" style="display:none">' + CHEVRON_DOWN_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn comment-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn comment-delete-btn" title="Удалить">' + CROSS_SMALL_ICON_SVG + '</button>' +
      '</span>';
    body.querySelector(".task-expand-btn").addEventListener("click", function(e){
      e.stopPropagation();
      if(expandedCommentIds[id]) delete expandedCommentIds[id];
      else expandedCommentIds[id] = true;
      renderCommentRowView(id);
    });
    body.querySelector(".comment-edit-btn").addEventListener("click", function(){ renderCommentRowEdit(id); });
    body.querySelector(".comment-delete-btn").addEventListener("click", function(){
      deleteCommentPermanently(id);
      renderCommentsTab();
    });
    updateTaskExpandBtn(body, id, expandedCommentIds);
    fitTaskActions(body);
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
    fitTaskActions(body);

    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    editable.addEventListener("input", function(){
      updatePlaceholder();
      fitTaskActions(body);
    });
    editable.addEventListener("keydown", function(e){
      if(e.key === "Enter"){
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    });

    editable.addEventListener("blur", function(){
      // открыт диалог выбора файла для скрепки — не выходим из
      // редактирования, иначе вставлять картинку станет некуда (см.
      // taskAttachDialogOpen выше)
      if(taskAttachDialogOpen) return;
      var restoreScroll = window.Debug.guardTaskListScroll();
      var newText = getEditableNoteText(editable);
      setCommentText(id, newText.trim());
      editable.contentEditable = "false";
      setTimeout(function(){
        if(document.body.contains(body)) renderCommentRowView(id);
        restoreScroll();
      }, 500);
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
  // Защита от прыжка/подёргивания списка задач при потере фокуса в никуда
  // (см. ТЗ пользователя от 02.09) — сама защита и её диагностический лог
  // (видимая панель, включается галочкой "Включить режим отладки") живут в
  // debug.js, см. Debug.guardTaskListScroll().
  // anchorTaskId (необязательный) — id задачи, ради которой вызвана
  // пересборка (например, клик по кружку приоритета на Red, где от
  // отметки зависит и состав, и порядок строк, см. getTasksForTab). Без
  // него — при обычных вызовах (переключение вкладки, фоновая
  // синхронизация) — сохраняется прежнее поведение: сырой container.scrollTop.
  // ЭТОГО ДОСТАТОЧНО, только пока порядок/состав строк ВЫШЕ сохранённой
  // позиции не меняется. На Red клик по кружку меняет группу задачи (red
  // сверху, yellow ниже, см. сортировку в getTasksForTab) — строка может
  // уйти далеко от места клика, а старый scrollTop продолжает указывать на
  // тот же пиксель, но там теперь ДРУГАЯ задача — отсюда и был "прыжок"
  // (ТЗ пользователя от 02.09, второй случай на Red). Настоящий корень
  // всех виденных до этого прыжков со скроллом один и тот же: где-то
  // сохраняли сырой scrollTop, предполагая, что содержимое НАД видимой
  // областью не меняется, а оно менялось — здесь вместо этого держим
  // строку-якорь на том же визуальном месте на экране, чем бы ни было
  // вызвано изменение списка.
  // Задачи длиннее TASK_CLAMP_LINES строк обрезаются по высоте
  // (.task-text-clamped, line-clamp в modals.css) — значок-шеврон в группе
  // .task-actions (см. renderTaskRowView/updateTaskExpandBtn) разворачивает
  // текст полностью. Какие задачи сейчас развёрнуты — держим только в
  // памяти на время открытой вкладки, не сохраняем (как и режим
  // редактирования строки): при переключении вкладки/перезапуске список
  // просто снова начинает свёрнутым.
  var expandedTaskIds = {};
  var TASK_CLAMP_LINES = 7;

  function renderTaskTabList(tabKey, anchorTaskId){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    if(tabKey === "projects") clearProjectPickerResumeState();
    // Полная пересборка списка ниже (innerHTML) сама по себе всегда
    // приводит скролл контейнера к верху — нормально при настоящем
    // переключении вкладки (см. switchSettingsTab, там scrollTop и так
    // уже обнулён ДО этого вызова), но эта же функция вызывается и в
    // ФОНЕ — например, после каждой облачной синхронизации (см.
    // rerenderAllFromState), в том числе от собственной правки
    // пользователя. Без сохранения позиции список каждый раз "прыгал" бы
    // в начало прямо во время просмотра/пролистывания. Запоминаем и
    // возвращаем — при настоящем переключении вкладки это просто вернёт
    // те же 0 обратно, поведение не меняется.
    var preservedScrollTop = container.scrollTop;
    var anchorRowOld = anchorTaskId ? container.querySelector('.task-row[data-id="' + anchorTaskId + '"]') : null;
    var anchorVisualOffset = null;
    if(anchorRowOld) anchorVisualOffset = anchorRowOld.getBoundingClientRect().top - container.getBoundingClientRect().top;
    var tasks = getTasksForTab(tabKey);
    var rowsHtml = tasks.map(function(t){ return buildTaskRowHtml(t); }).join("");
    container.innerHTML =
      '<div class="task-list task-grid-list" id="taskListWrap">' + rowsHtml + TASK_LIST_BOTTOM_SPACER_HTML + '</div>' +
      (tasks.length === 0 ? '<div class="task-empty">Здесь пока нет задач.</div>' : '');
    tasks.forEach(function(t){ bindTaskRow(t.id, tabKey); });
    if(anchorVisualOffset != null){
      container.scrollTop = 0; // база для измерения абсолютного положения строки в списке
      var anchorRowNew = container.querySelector('.task-row[data-id="' + anchorTaskId + '"]');
      if(anchorRowNew){
        var anchorAbsTop = anchorRowNew.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTop = anchorAbsTop - anchorVisualOffset;
      } else {
        container.scrollTop = preservedScrollTop;
      }
    } else {
      container.scrollTop = preservedScrollTop;
    }

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

  // ---------------------------------------------------------------------
  // Подгонка кнопок задачи (.task-actions) под ПОСЛЕДНЮЮ строку текста
  // (.task-text-view/.task-editable) — см. подробное объяснение "почему
  // не float" в комментарии к .task-body в modals.css и ТЗ пользователя
  // от 31.08 (кнопки уходили на отдельную строку, даже когда после
  // короткой последней строки было полно места). Кнопки позиционируются
  // вручную (position:absolute, top/right через inline-style): если после
  // последней визуальной строки текста есть место — кнопки встают туда;
  // если нет — уходят под текст отдельной строкой, а .task-body получает
  // ровно нужный padding-bottom, чтобы под ними не оставалось пустоты.
  // ---------------------------------------------------------------------
  function getLastLineRect(el){
    if(!el) return null;
    var range;
    try{
      range = document.createRange();
      range.selectNodeContents(el);
    }catch(e){ return null; }
    var rects = range.getClientRects();
    if(!rects || !rects.length) return null;
    return rects[rects.length - 1];
  }
  function fitTaskActions(body){
    if(!body) return;
    var actions = body.querySelector(".task-actions");
    var textEl = body.querySelector(".task-text-view") || body.querySelector(".task-editable");
    if(!actions || !textEl) return;
    // Текст, обрезанный по TASK_CLAMP_LINES строкам (.task-text-clamped) и
    // реально не помещающийся (scrollHeight > clientHeight) — line-clamp
    // только визуально прячет лишние строки, сама раскладка текста внутри
    // происходит как обычно, так что Range.getClientRects() у textEl ниже
    // всё равно вернул бы координаты СКРЫТЫХ строк далеко за пределами
    // видимой (обрезанной) области. Поэтому здесь, как и в ветке "не
    // влезло" ниже, кнопки безусловно уводим под текст, но опираемся на
    // clientHeight текста (видимую, обрезанную высоту), а не на измерение
    // последней строки.
    if(textEl.classList.contains("task-text-clamped") && textEl.scrollHeight > textEl.clientHeight + 1){
      var actionsHeightClamped = actions.offsetHeight;
      actions.style.top = (textEl.clientHeight + 4) + "px";
      body.style.paddingBottom = (actionsHeightClamped + 4) + "px";
      return;
    }
    var lastRect = getLastLineRect(textEl);
    var bodyRect = body.getBoundingClientRect();
    if(!lastRect || !bodyRect.width){
      body.style.paddingBottom = "";
      actions.style.top = "0px";
      return;
    }
    var gap = 8;
    var actionsWidth = actions.offsetWidth;
    var actionsHeight = actions.offsetHeight;
    var availableAfter = bodyRect.right - lastRect.right - gap;
    // Запас на случаи "почти впритык" (см. ТЗ пользователя от 31.08 — "не
    // планировать повторение вначале месяца"): getBoundingClientRect/
    // getClientRects дают дробные (субпиксельные) значения, а offsetWidth
    // у actions — всегда округлённое целое, так что сравнение их напрямую
    // само по себе даёт погрешность около 1px то в одну, то в другую
    // сторону в зависимости от реального хинтинга шрифта на конкретном
    // устройстве. Кроме того, у каждой иконки есть прозрачный отступ между
    // краем кликабельной кнопки (22px) и самим видимым символом (15px) —
    // то есть первые ~3.5px слева от группы кнопок и так пустые. Поэтому
    // сравниваем не впритык, а с небольшим запасом (VISUAL_SLACK_PX) — так,
    // если реально не хватает буквально пары пикселей, кнопки останутся на
    // строке текста (лёгкое визуальное "впритык" в прозрачной кайме иконки
    // незаметно), а не уйдут вниз отдельной строкой при том, что на глаз
    // место есть. Настоящую нехватку места (не на пару пикселей, а по
    // существу) запас, конечно, не замаскирует — перенос вниз по-прежнему
    // происходит.
    var VISUAL_SLACK_PX = 4;
    if(actionsWidth - VISUAL_SLACK_PX <= availableAfter){
      var top = lastRect.top - bodyRect.top + (lastRect.height - actionsHeight) / 2;
      actions.style.top = Math.max(0, top) + "px";
      body.style.paddingBottom = "";
    } else {
      actions.style.top = (lastRect.bottom - bodyRect.top + 4) + "px";
      body.style.paddingBottom = (actionsHeight + 4) + "px";
    }
  }
  // пересчитывает подгонку кнопок у ВСЕХ строк задач, видимых прямо
  // сейчас, — нужно при изменении размера окна и при смене общего размера
  // шрифта (см. "Аа" в initTaskGlobalToolbar ниже: у текста меняется
  // ширина, значит и разбивка на строки, значит подгонку надо пересчитать
  // заново). Если открыта не вкладка задач — querySelectorAll просто
  // ничего не найдёт, безвредно.
  function refitAllVisibleTaskBodies(){
    var bodies = document.querySelectorAll(".task-body");
    for(var i = 0; i < bodies.length; i++){
      var body = bodies[i];
      // ширина строки могла измениться (ресайз/смена размера шрифта) — а
      // значит и то, сколько строк текста реально влезает в те же
      // TASK_CLAMP_LINES строк, поэтому видимость значка-шеврона нужно
      // пересчитать заново, до подгонки кнопок под (возможно новую)
      // видимую высоту текста. Комментарии (#commentListWrap) держат своё
      // развёрнутое состояние в отдельной карте (expandedCommentIds) —
      // те же id, что у задач, не пересекаются по смыслу.
      var id = body.getAttribute("data-id");
      if(id){
        var expandedMap = body.closest("#commentListWrap") ? expandedCommentIds : expandedTaskIds;
        updateTaskExpandBtn(body, id, expandedMap);
      }
      fitTaskActions(body);
    }
  }
  window.addEventListener("resize", refitAllVisibleTaskBodies);

  // копирование текста задачи (кнопка-пиктограмма .task-copy-btn, см.
  // bindTaskRowActions ниже) — тот же приём, что и у копирования субтитров
  // (см. copyBtn в renderSettingsTabSubtitleExtract): основной путь —
  // navigator.clipboard.writeText, фолбэк — скрытая textarea + execCommand
  // для браузеров/контекстов без Clipboard API.
  function copyTaskTextToClipboard(text){
    if(!text) return;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).catch(function(){});
      return;
    }
    try{
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }catch(e){}
  }

  // onAfterAction (необязательный, 3-й параметр) — используется вкладкой
  // "Поиск" (search.js, ТЗ пользователя от 08.09): вызовы archive/move из
  // результатов поиска не должны перерисовывать реальную вкладку-хранилище
  // задачи (это стёрло бы список результатов) — вместо этого search.js
  // передаёт свой колбэк, который просто убирает строку из выдачи. Везде,
  // где onAfterAction не передан (обычные вкладки задач), поведение не
  // меняется — используется renderTaskTabList, как раньше.
  function renderTaskRowView(id, tabKey, onAfterAction){
    var body = document.querySelector('.task-body[data-id="' + id + '"]');
    var task = getTaskById(id);
    if(!body || !task) return;
    var isProjectsTab = task.c.tab === "projects";
    var showRed = isProjectsTab && !projectHasActiveNext(id);
    var placeholder = isProjectsTab ? "Новый проект" : "Новая задача";
    var textHtml = task.c.text ? linkifyHtml(task.c.text) : '<span class="task-text-placeholder">' + placeholder + '</span>';
    var flagClass = task.c.flag === "red" ? " flag-red" : (task.c.flag === "yellow" ? " flag-yellow" : "");
    // Развёрнутые задачи (expandedTaskIds) рисуются без обрезки — иначе
    // нельзя ни прочитать текст целиком, ни (что важнее) корректно
    // определить через scrollHeight/clientHeight, что обрезка больше не
    // нужна, когда задачу укоротили редактированием (см. updateTaskExpandBtn).
    var isExpanded = !!expandedTaskIds[id];
    body.innerHTML =
      '<span class="task-text-view' + (showRed ? ' task-text-red' : '') + (isExpanded ? '' : ' task-text-clamped') + '">' + textHtml + '</span>' +
      '<span class="task-actions">' +
        '<button type="button" class="task-icon-btn task-expand-btn" title="Показать полностью" style="display:none">' + CHEVRON_DOWN_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
        '<button type="button" class="task-icon-btn task-copy-btn" title="Копировать">' + COPY_ICON_SVG + '</button>' +
        (isProjectsTab ? '<button type="button" class="task-icon-btn task-next-btn" title="Все задачи проекта">' + LINK_NEXT_ICON_SVG + '</button>' : '') +
        '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + task.id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
      '</span>';
    body.querySelector(".task-edit-btn").addEventListener("click", function(){ renderTaskRowEdit(id, tabKey, onAfterAction); });
    bindTaskRowActions(body, id, tabKey, onAfterAction);
    updateTaskExpandBtn(body, id);
    fitTaskActions(body);
  }

  // Значок-шеврон "показать полностью"/"свернуть" — первый в группе
  // .task-actions, виден только когда текст задачи реально не помещается в
  // TASK_CLAMP_LINES строк. Обрезку можно проверить только после того, как
  // браузер уже отрисовал строку (scrollHeight/clientHeight), поэтому в
  // разметке выше кнопка сразу рисуется скрытой (style="display:none"), а
  // видимость и подпись выставляет эта функция — вызывается из
  // renderTaskRowView сразу после отрисовки и из refitAllVisibleTaskBodies
  // при ресайзе/смене размера шрифта (см. TASK_CLAMP_LINES выше), в обоих
  // случаях ДО fitTaskActions, чтобы тот уже мерил строку с учётом
  // добавленной/убранной кнопки.
  function updateTaskExpandBtn(body, id, expandedMap){
    expandedMap = expandedMap || expandedTaskIds;
    var btn = body.querySelector(".task-expand-btn");
    var textEl = body.querySelector(".task-text-view");
    if(!btn || !textEl) return;
    var isExpanded = !!expandedMap[id];
    var overflowing = textEl.classList.contains("task-text-clamped") && textEl.scrollHeight > textEl.clientHeight + 1;
    if(!overflowing && !isExpanded){
      btn.style.display = "none";
      return;
    }
    btn.style.display = "";
    btn.classList.toggle("is-expanded", isExpanded);
    btn.title = isExpanded ? "Свернуть" : "Показать полностью";
  }

  // кнопки переноса/архивации/next-привязки/приоритета — общие для
  // обычного вида строки (renderTaskRowView) и режима редактирования
  // (renderTaskRowEdit): без явной дискеты сохранения текст сохраняется
  // сам (через flushPendingTaskEdits внутри каждого обработчика), поэтому
  // эти кнопки должны работать одинаково в обоих режимах и не пропадать,
  // пока идёт редактирование
  function bindTaskRowActions(body, id, tabKey, onAfterAction){
    var task = getTaskById(id);
    if(!task) return;
    // шеврон "показать полностью"/"свернуть" (см. renderTaskRowView/
    // updateTaskExpandBtn) — просто переключает expandedTaskIds и
    // перерисовывает СВОЮ же строку; никакого влияния на остальной список
    // (в отличие от done/move/flag) — полная пересборка тут не нужна
    var expandBtn = body.querySelector(".task-expand-btn");
    if(expandBtn){
      expandBtn.addEventListener("click", function(e){
        e.stopPropagation();
        if(expandedTaskIds[id]) delete expandedTaskIds[id];
        else expandedTaskIds[id] = true;
        renderTaskRowView(id, tabKey, onAfterAction);
      });
    }
    // галочка "в архив" — делает ровно то же, что раньше делала отметка
    // чекбокса (снять её обратно можно только извлечением из архива)
    var doneBtn = body.querySelector(".task-done-btn");
    if(doneBtn){
      doneBtn.addEventListener("click", function(){
        flushPendingTaskEdits();
        checkTaskDone(id); // одна и та же задача — закрывается везде разом
        if(onAfterAction) onAfterAction();
        else renderTaskTabList(tabKey || task.c.tab);
      });
    }
    var moveBtn = body.querySelector(".task-move-btn");
    if(moveBtn) moveBtn.addEventListener("click", function(){ openTaskMovePicker(id, tabKey, onAfterAction); });
    // копирование текста задачи в буфер обмена (ТЗ пользователя от 11.09) —
    // тот же приём copyToClipboard/фолбэк через execCommand, что и у
    // srtCopyBtn при извлечении субтитров (см. 7278 выше), но без отдельной
    // строки статуса — вместо неё на секунду-другую меняем саму иконку на
    // галочку, прямо как обратная связь у кнопки.
    var copyBtn = body.querySelector(".task-copy-btn");
    if(copyBtn){
      copyBtn.addEventListener("click", function(){
        flushPendingTaskEdits();
        var current = getTaskById(id);
        copyTaskTextToClipboard(current && current.c.text ? current.c.text : "");
        copyBtn.innerHTML = CHECK_ICON_SVG;
        setTimeout(function(){
          if(document.body.contains(copyBtn)) copyBtn.innerHTML = COPY_ICON_SVG;
        }, 1200);
      });
    }
    var nextBtn = body.querySelector(".task-next-btn");
    if(nextBtn) nextBtn.addEventListener("click", function(){ openTaskNextPicker(id, tabKey); });
    var dot = body.querySelector(".task-flag-dot");
    if(dot){
      dot.addEventListener("click", function(e){
        e.stopPropagation();
        flushPendingTaskEdits();
        cycleTaskFlag(id);
        // на Red состав и порядок строк зависят от отметки (getTasksForTab),
        // поэтому там без полной пересборки списка не обойтись. На
        // остальных вкладках отметка не влияет ни на состав, ни на порядок —
        // полная пересборка была лишней и давала видимый рывок/смещение
        // всего списка (пересоздаются все строки и пересчитывается позиция
        // кнопок у каждой, см. fitTaskActions), хотя меняется только цвет
        // кружка одной строки. Обновляем точечно, как и у такого же клика
        // на экране "Все задачи проекта" (см. renderRowView в
        // openTaskNextPicker) — там же полная пересборка не грозит багом
        // именно потому, что обновляет только свою строку.
        var effectiveTab = tabKey || task.c.tab;
        if(effectiveTab === "red") renderTaskTabList(effectiveTab, id);
        else renderTaskRowView(id, tabKey, onAfterAction);
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
  function renderTaskRowEdit(id, tabKey, onAfterAction){
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
        '<button type="button" class="task-icon-btn task-copy-btn" title="Копировать">' + COPY_ICON_SVG + '</button>' +
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
    fitTaskActions(body);

    editable.focus();
    var range = document.createRange();
    range.setStart(textNode, textNode.length);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // при каждом вводе текст может перенестись на другое число строк —
    // подгонку кнопок (fitTaskActions) нужно пересчитывать вживую, а не
    // только один раз при открытии редактирования
    editable.addEventListener("input", function(){
      updatePlaceholder();
      fitTaskActions(body);
    });
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
      // открыт диалог выбора файла для скрепки — не выходим из
      // редактирования, иначе вставлять картинку станет некуда (см.
      // taskAttachDialogOpen выше)
      if(taskAttachDialogOpen) return;
      var restoreScroll = window.Debug.guardTaskListScroll();
      // ГИПОТЕЗА по логу диагностики: браузер откладывает собственный
      // "прокрутить каретку в видимую область" уже ПОСЛЕ blur — и если к
      // моменту его срабатывания сам contenteditable-узел уже удалён (см.
      // renderTaskRowView ниже, который раньше вызывался тут же), браузер
      // откатывает scrollTop контейнера к 0. Проверяем: не удаляем узел
      // сразу — только гасим редактируемость, а полную перерисовку строки
      // откладываем до момента, когда это окно риска (по логу — ~150-200мс
      // после resize) точно пройдёт.
      var newText = getEditableNoteText(editable);
      setTaskText(id, newText.trim());
      editable.contentEditable = "false";
      setTimeout(function(){
        if(document.body.contains(body)) renderTaskRowView(id, tabKey, onAfterAction);
        restoreScroll();
      }, 500);
    });

    bindTaskRowActions(body, id, tabKey, onAfterAction);
  }

  // сетка выбора вкладки-назначения — как у выбора цвета цели
  // (openGoalColorPicker), только квадратики с иконками вкладок
  function openTaskMovePicker(id, tabKey, onAfterAction){
    var task = getTaskById(id);
    if(!task) return;
    // "Комментарии" (extra2) — отдельный пункт ТОЛЬКО в этой сетке (ТЗ
    // пользователя от 13.09): это не обычная вкладка-список задач, поэтому
    // не входит в TASK_MOVE_TARGET_TABS выше (тот массив используется ещё
    // и импортом из .txt, и созданием новой задачи из "Моего блокнота" —
    // там конвертация в комментарий не нужна). Показывается только если
    // сама вкладка "Комментарии" включена в настройках (см.
    // getCustomCommentsEnabled) — иначе задача исчезала бы в скрытую
    // вкладку.
    var targetKeys = TASK_MOVE_TARGET_TABS.slice();
    if(getCustomCommentsEnabled()) targetKeys.push("extra2");
    var buttons = targetKeys.map(function(key){
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
        if(newTab === "extra2") convertTaskToComment(id);
        else moveTaskToTab(id, newTab);
        closeModal();
        if(onAfterAction) onAfterAction();
        else renderTaskTabList(tabKey || task.c.tab);
      });
    });
  }

  // Тот же пикер выбора вкладки-назначения, что и openTaskMovePicker выше,
  // но БЕЗ привязки к уже существующей задаче — используется переносом
  // задачи "- [ ] текст" из "Моих заметок" (см. TaskActionsWidget в
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
  function openTaskNextPicker(projectId, tabKey, resumeScrollTop){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    // Явный resumeScrollTop (см. openSettingsModal — "продолжить с того же
    // места" после полного перезапуска приложения) сильнее, но при обычном
    // входе через кнопку-звено на строке проекта его никто не передаёт —
    // тогда подставляем сюда то, что запомнили для ЭТОГО проекта в прошлый
    // раз (см. getSavedProjectScrollTop выше): переживает переключение
    // вкладок и закрытие приложения, не только "резюме" всего экрана целиком.
    if(resumeScrollTop == null) resumeScrollTop = getSavedProjectScrollTop(projectId);

    var mode = "linked"; // "linked" — обычный вид (проект + next-задачи),
                          // "attach" — выбор существующей задачи для привязки
    // взводится только на самый первый render() этого открытия — см.
    // восстановление resumeScrollTop и сохранение позиции ниже
    var isFirstRender = true;

    function getLinkedTasks(){
      return getTasksForTab("next").filter(function(t){ return t.c.nextForProjectId === projectId; });
    }
    // "доступные" — любая незакрытая задача, ещё не привязанная ни к
    // одному проекту, из ЛЮБОЙ вкладки-хранилища, кроме "projects" (сам
    // проект не может быть next-действием для другого проекта)
    function getAvailableTasks(){
      // новые сверху — тот же порядок (по createdAt, по убыванию), что и
      // во всех остальных списках задач (см. getTasksForTab выше);
      // getAllTasks() сам по себе отсортирован по t (времени последнего
      // изменения, по возрастанию), и без пересортировки только что
      // созданные/ещё не привязанные задачи оказывались бы в самом низу
      // списка для привязки.
      return getAllTasks().filter(function(t){
        return t.c.checked !== true && t.c.tab !== "projects" && !t.c.nextForProjectId;
      }).sort(function(a,b){ return (b.c.createdAt != null ? b.c.createdAt : b.t) - (a.c.createdAt != null ? a.c.createdAt : a.t); });
    }

    // ---------- сверху всегда сам проект, ниже — либо привязанные к нему
    // next-задачи (обычный режим), либо список для привязки существующей
    // задачи (режим "attach", включается кнопкой-звеном). Задачи из
    // других списков в обычном режиме не показываются вовсе — только по
    // явному запросу через кнопку-звено. ---------- */
    function render(){
      flushPendingTaskEdits();
      // НАСТОЯЩАЯ причина прыжка (найдена по modals.css): скроллится не
      // #settingsTabContent (container), а вложенная .task-project-area
      // (#taskProjectArea) — у #settingsTabContent тут overflow:hidden
      // через обёртку .task-project-modal-body, сам он на этом экране
      // никогда не скроллится, scrollTop у него всегда 0. Раньше здесь
      // (и в guardTaskListScroll/layoutSettingsModal) сохранялся именно
      // scrollTop контейнера — то есть всегда 0, поэтому ничего и не
      // помогало. Сохраняем позицию у СТАРОГО #taskProjectArea (пока он ещё
      // не заменён через container.innerHTML ниже), тот же приём, что и в
      // renderTaskTabList/renderTaskArchiveTab (см. preservedScrollTop там).
      var oldArea = document.getElementById("taskProjectArea");
      var preservedScrollTop = isFirstRender ? null : (oldArea ? oldArea.scrollTop : null);
      var projectTask = getTaskById(projectId);
      // Название проекта — часть ПРОКРУЧИВАЕМОЙ области ниже (см.
      // container.innerHTML ниже: вставляется ПЕРВЫМ элементом внутри
      // .task-project-area, а не в отдельной фиксированной строке над ней,
      // ТЗ пользователя от 12.09) — уезжает вместе со списком next-задач
      // при скролле. Неподвижен только сам заголовок экрана ("Все задачи
      // проекта" выше). Без кнопок управления (редактировать/в архив/
      // перенести/копировать/приоритет): всё это уже есть у самой
      // задачи-проекта в списке проектов — управлять проектом отсюда
      // больше нельзя, только читать название и работать со связанными
      // next-задачами. Тот же класс .common-tab-title, что у заголовка
      // экрана над ним и у заголовков "Закладки"/"Мои заметки" — с тем же
      // тонким разделителем снизу.
      var projectNameHtml = '<h3 class="common-tab-title">' +
        (projectTask && projectTask.c.text ? linkifyHtml(projectTask.c.text) : '<span class="task-text-placeholder">Без названия</span>') +
        '</h3>';
      var areaHtml;
      if(mode === "attach"){
        var available = getAvailableTasks();
        var availableHtml = available.map(function(t){
          var label = t.c.text ? escapeHtml(t.c.text) : "Без названия";
          return '<button type="button" class="version-history-item" data-avail-id="' + t.id + '">' + label + '</button>';
        }).join("");
        areaHtml = projectNameHtml + '<div class="task-list">' + availableHtml +
          (available.length === 0 ? '' : TASK_LIST_BOTTOM_SPACER_HTML) + '</div>' +
          (available.length === 0 ? '<div class="task-empty">Нет доступных задач.</div>' : '');
      } else {
        var linked = getLinkedTasks();
        var linkedHtml = linked.map(function(t){
          return '<div class="task-row" data-id="' + t.id + '"><div class="task-body" data-id="' + t.id + '"></div></div>';
        }).join("");
        areaHtml = projectNameHtml + '<div class="task-list">' + linkedHtml +
          (linked.length === 0 ? '' : TASK_LIST_BOTTOM_SPACER_HTML) + '</div>' +
          (linked.length === 0 ? '<div class="task-empty">Пока нет задач, привязанных к проекту.</div>' : '');
      }
      container.innerHTML =
        '<h3 class="common-tab-title">Все задачи проекта</h3>' +
        '<div class="task-project-modal-body">' +
          '<div class="task-project-area" id="taskProjectArea">' + areaHtml + '</div>' +
        '</div>' +
        // "новая задача" (+) — визуально та же самая общая .task-add-fab
        // (тот же класс, тот же квадратный вид, что и на остальных
        // вкладках задач), просто отдельный DOM-узел со своим id и своим
        // обработчиком: у "+" здесь своя логика создания задачи,
        // привязанной к проекту, отличная от обычного добавления в список
        // (см. taskProjectCreateFab ниже). УГОЛ (right:8) у неё теперь не
        // тот же, что у обычной .task-add-fab на других вкладках — здесь
        // угол занят "Домиком" (см. ниже), а "+" сдвинута своим id-
        // селектором (#taskProjectCreateFab в modals.css, доработка
        // 13.09). Настоящая глобальная .task-add-fab (#taskAddFab) на
        // этом экране по-прежнему скрыта (см. globalFab ниже) — иначе они
        // бы наложились друг на друга.
        // "Прикрепить существующую" (звенья) — та же квадратная кнопка
        // (.mdeditor-fab-btn, тот же вид, что у Ж/Аа/скрепки/"+" везде в
        // приложении), поставлена ЛЕВЕЕ ВСЕХ кнопок ряда (ТЗ пользователя
        // от 12.09, сдвинута ещё левее 13.09, когда угол отдали "Домику")
        // — со своим позиционированием (.task-project-fab-link в
        // modals.css). Подсветка активного режима "attach" — общий класс
        // .pressed (см. .mdeditor-fab-btn.pressed в components.css), тот
        // же приём, что и у кнопки "i" во вкладке "Извлечение субтитров".
        // "Домик" — назад к списку всех проектов (ТЗ пользователя от
        // 12.09, седьмой заход): та же READER_HOME_ICON_SVG, что и у
        // книг (см. bookReaderHomeBtn выше — своя копия контура домика,
        // тем же приёмом, что и там, т.к. HOME_ICON_SVG самого
        // mdeditor.js наружу не отдаётся). Правый угол ряда (right:8) —
        // доработка 13.09: порядок кнопок с одинаковой функцией должен
        // совпадать с "Моим блокнотом" (mdeditor.js), где "Домик" всегда
        // самая правая/крайняя кнопка ряда — раньше стояла самой левой
        // (right:208), теперь угол её, а "+"/"звенья" сдвинуты левее (см.
        // .task-project-fab-home в modals.css, там же — почему без
        // position:absolute кнопка ещё и оставляла пустую полосу снизу
        // экрана, "подбородок").
        '<button type="button" class="mdeditor-fab-btn task-project-fab-home" id="taskProjectHomeBtn" title="К списку проектов">' + READER_HOME_ICON_SVG + '</button>' +
        '<button type="button" class="mdeditor-fab-btn task-project-fab-link' + (mode === "attach" ? " pressed" : "") + '" id="taskProjectLinkFab" title="Прикрепить существующую задачу">' + LINK_NEXT_ICON_SVG + '</button>' +
        '<button type="button" class="task-add-fab visible" id="taskProjectCreateFab" title="Новая задача">+</button>';

      // Глобальные "Ж"/"Аа"/скрепка (см. #taskFormatWrap/#taskFontSizeWrap/
      // #taskAttachWrap) здесь НЕ прячем (ТЗ пользователя от 12.09) — они
      // уже видимы, т.к. switchSettingsTab выставляет им visible=true для
      // вкладки "projects" (см. TASK_MOVABLE_TABS) ДО вызова этой функции,
      // и применяются к тому же .task-editable, что и везде (см.
      // renderRowEdit ниже). Прячем только настоящую глобальную "+"
      // (#taskAddFab) — вместо неё здесь своя кнопка с другой логикой
      // создания задачи (taskProjectCreateFab выше, тот же класс
      // .task-add-fab для одинакового вида); она сама вернётся при выходе
      // (switchSettingsTab выставляет видимость заново для каждой вкладки).
      var globalFab = document.getElementById("taskAddFab");
      if(globalFab) globalFab.classList.remove("visible");
      // Заглушка-домик остальных вкладок задач (см. syncTaskFabRowForTab) —
      // здесь свой, кликабельный домик (taskProjectHomeBtn выше), заглушка
      // в том же углу была бы лишней/перекрывала бы его.
      var homeStubHide = document.getElementById("taskFabHomeStub");
      if(homeStubHide) homeStubHide.classList.remove("visible");

      // Название проекта уже вставлено выше (projectNameHtml) — без
      // кнопок управления (см. комментарий у projectNameHtml), поэтому
      // renderRowView (с полным набором кнопок) для него больше не
      // вызывается, только для связанных next-задач ниже.
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

      // "Домик" — реальный, осознанный выход к списку всех проектов (в
      // отличие от простого переключения на другую вкладку и обратно —
      // см. activeProjectPickerId выше, теперь ТОЛЬКО эта кнопка чистит
      // память о том, какой проект был открыт). Действие ВПЕРЁД, тем же
      // приёмом, что у "Домика" книг (bookReaderHomeBtn) и заметок
      // (mdEditorHomeBtn) — само не откатывает историю, а добавляет свой
      // шаг "назад" (снимок projectId), чтобы системное "назад" после
      // клика вернуло именно в эту карточку проекта.
      document.getElementById("taskProjectHomeBtn").addEventListener("click", function(){
        flushPendingTaskEdits();
        var snapshotId = projectId;
        window.AppNav.push(function(){
          activeProjectPickerId = snapshotId;
          openTaskNextPicker(snapshotId, "projects");
        });
        activeProjectPickerId = null;
        activeProjectPickerRerender = null;
        clearProjectPickerResumeState();
        renderTaskTabList("projects");
        // Возврат идёт в обход switchSettingsTab (см. комментарий выше) —
        // поэтому ряд кнопок "+/заглушка-домик" синкаем сюда явно, иначе
        // "+" осталась бы спрятанной (её прятал globalFab чуть выше).
        syncTaskFabRowForTab("projects");
      });

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

      // сохранение позиции скролла (см. PROJECT_PICKER_RESUME_KEY выше) —
      // область, у которой сохраняем/восстанавливаем позицию, — НАСТОЯЩИЙ
      // скролл-контейнер #taskProjectArea (см. комментарий у
      // preservedScrollTop выше), а не #settingsTabContent. На самый первый
      // рендер этого открытия тут же восстанавливаем resumeScrollTop, если
      // экран открыт через "продолжить с того же места" (см.
      // openSettingsModal). Дальнейшие изменения позиции — через слушатель
      // скролла на area, навешенный здесь же: сам узел #taskProjectArea
      // пересоздаётся при каждом render() (container.innerHTML= выше), так
      // что слушатель навешиваем заново на каждый рендер — старый узел
      // уходит из DOM вместе со своим слушателем, копиться им негде.
      var area = document.getElementById("taskProjectArea");
      if(area){
        area.addEventListener("scroll", function(){
          if(projectPickerScrollSaveTimer) clearTimeout(projectPickerScrollSaveTimer);
          projectPickerScrollSaveTimer = setTimeout(function(){
            saveProjectPickerResumeState(projectId, area.scrollTop);
            setSavedProjectScrollTop(projectId, area.scrollTop);
          }, 200);
        });
      }
      if(isFirstRender){
        isFirstRender = false;
        if(area && resumeScrollTop) area.scrollTop = resumeScrollTop;
        saveProjectPickerResumeState(projectId, area ? area.scrollTop : 0);
        setSavedProjectScrollTop(projectId, area ? area.scrollTop : 0);
      } else if(preservedScrollTop != null && area){
        area.scrollTop = preservedScrollTop;
      }
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
      // Обрезка по строкам + шеврон "показать полностью" — та же карта
      // expandedTaskIds, что и в обычных вкладках задач (см.
      // renderTaskRowView): это те же самые задачи, тот же id, так что
      // развёрнутость здесь и там — одно и то же состояние.
      var isExpanded = !!expandedTaskIds[id];
      body.innerHTML =
        '<span class="task-text-view' + (isExpanded ? '' : ' task-text-clamped') + '">' + textHtml + '</span>' +
        '<span class="task-actions">' +
          '<button type="button" class="task-icon-btn task-expand-btn" title="Показать полностью" style="display:none">' + CHEVRON_DOWN_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-edit-btn" title="Редактировать">' + PENCIL_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-done-btn" title="В архив">' + CHECK_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-move-btn" title="Перенести">' + ARROW_MOVE_ICON_SVG + '</button>' +
          '<button type="button" class="task-icon-btn task-copy-btn" title="Копировать">' + COPY_ICON_SVG + '</button>' +
          '<button type="button" class="task-flag-dot' + flagClass + '" data-id="' + id + '" title="Приоритет"><span class="task-flag-dot-inner"></span></button>' +
        '</span>';
      body.querySelector(".task-expand-btn").addEventListener("click", function(e){
        e.stopPropagation();
        if(expandedTaskIds[id]) delete expandedTaskIds[id];
        else expandedTaskIds[id] = true;
        renderRowView(id);
      });
      body.querySelector(".task-edit-btn").addEventListener("click", function(){ renderRowEdit(id); });
      bindRowActions(body, id);
      updateTaskExpandBtn(body, id);
      fitTaskActions(body);
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
      var copyBtn = body.querySelector(".task-copy-btn");
      if(copyBtn){
        copyBtn.addEventListener("click", function(){
          flushPendingTaskEdits();
          var current = getTaskById(id);
          copyTaskTextToClipboard(current && current.c.text ? current.c.text : "");
          copyBtn.innerHTML = CHECK_ICON_SVG;
          setTimeout(function(){
            if(document.body.contains(copyBtn)) copyBtn.innerHTML = COPY_ICON_SVG;
          }, 1200);
        });
      }
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
          '<button type="button" class="task-icon-btn task-copy-btn" title="Копировать">' + COPY_ICON_SVG + '</button>' +
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
      fitTaskActions(body);

      editable.focus();
      var range = document.createRange();
      range.setStart(textNode, textNode.length);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      editable.addEventListener("input", function(){
        updatePlaceholder();
        fitTaskActions(body);
      });
      editable.addEventListener("keydown", function(e){
        if(e.key === "Enter"){
          e.preventDefault();
          document.execCommand("insertText", false, "\n");
        }
      });

      editable.addEventListener("blur", function(){
        // открыт диалог выбора файла для скрепки — не выходим из
        // редактирования, иначе вставлять картинку станет некуда (см.
        // taskAttachDialogOpen выше)
        if(taskAttachDialogOpen) return;
        // На этом экране настоящий скролл-контейнер — #taskProjectArea, а
        // не #settingsTabContent (см. modals.css: .task-project-modal-body
        // сам overflow:hidden, скроллится только вложенная .task-project-
        // area) — без явного параметра guardTaskListScroll сторожил бы не
        // тот элемент (у #settingsTabContent scrollTop тут всегда 0).
        var restoreScroll = window.Debug.guardTaskListScroll(document.getElementById("taskProjectArea"));
        // ГИПОТЕЗА по логу диагностики: браузер откладывает собственный
        // "прокрутить каретку в видимую область" уже ПОСЛЕ blur — и если к
        // моменту его срабатывания сам contenteditable-узел уже удалён, браузер
        // откатывает scrollTop контейнера к 0. Проверяем: не удаляем узел
        // сразу — только гасим редактируемость, а полную перерисовку строки
        // откладываем до момента, когда это окно риска точно пройдёт. Тот же
        // приём, что и в renderTaskRowEdit у обычных задач.
        var newText = getEditableNoteText(editable);
        setTaskText(id, newText.trim());
        editable.contentEditable = "false";
        setTimeout(function(){
          if(document.body.contains(body)) renderRowView(id);
          restoreScroll();
        }, 500);
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
      // "Комментарии" — тот же особый пункт, что и в openTaskMovePicker
      // выше (ТЗ пользователя от 13.09), см. комментарий там же.
      var targetKeys = TASK_MOVE_TARGET_TABS.slice();
      if(getCustomCommentsEnabled()) targetKeys.push("extra2");
      var buttons = targetKeys.map(function(key){
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
          if(newTab === "extra2") convertTaskToComment(id);
          else moveTaskToTab(id, newTab);
          closeModal();
          render();
        });
      });
    }

    // регистрируем render() как обработчик "текущего экрана" для
    // rerenderAllFromState (см. activeProjectPickerRerender выше) — та же
    // полная пересборка + preservedScrollTop, что и у обычных задач
    // (renderTaskTabList/renderTaskArchiveTab): защита от прыжка скролла —
    // guardTaskListScroll() в blur-обработчике (см. renderRowEdit выше), а
    // не то, что именно делает render() при пересборке.
    activeProjectPickerId = projectId;
    activeProjectPickerRerender = render;
    render();
  }

  // ---------- вкладка "архив": последние TASK_ARCHIVE_MAX_SHOWN отмеченных
  // задач, каждая — с зачёркнутым текстом, стрелочкой извлечения (возвращает
  // задачу туда, где она была до отметки) и крестиком полного удаления
  // (без диалога подтверждения — тушит саму задачу и её запись в "Карте
  // дней года", см. deleteTaskPermanently). Кнопки "+" здесь нет.
  // Разметка и подгонка кнопок под последнюю строку текста — та же
  // механика (.task-row/.task-body/.task-actions + fitTaskActions), что и
  // у невыполненных задач (см. renderTaskRowView), просто без карандаша и
  // приоритета: сюда идут только стрелочка и крестик. ----------
  function renderTaskArchiveTab(){
    var container = document.getElementById("settingsTabContent");
    if(!container) return;
    // см. пояснение у preservedScrollTop в renderTaskTabList выше — та же
    // причина (эта функция тоже вызывается в фоне из rerenderAllFromState)
    var preservedScrollTop = container.scrollTop;
    var all = getArchivedTasksAll();
    var shown = all.slice(0, TASK_ARCHIVE_MAX_SHOWN);
    // Обрезка по строкам + шеврон "показать полностью" — тот же приём и та
    // же карта expandedTaskIds, что у невыполненных задач (см. раздел
    // "ВКЛАДКИ ЗАДАЧ: ОТРИСОВКА" выше): архивная запись — та же самая
    // задача, тот же id, так что развёрнутость логично не сбрасывается
    // при архивации/извлечении.
    var rowsHtml = shown.map(function(t){
      var label = t.c.text ? escapeHtml(t.c.text) : "Без названия";
      var isExpanded = !!expandedTaskIds[t.id];
      return '<div class="task-row" data-id="' + t.id + '">' +
        '<div class="task-body task-archive-body" data-id="' + t.id + '">' +
          '<span class="task-text-view task-archive-text' + (isExpanded ? '' : ' task-text-clamped') + '">' + label + '</span>' +
          '<span class="task-actions">' +
            '<button type="button" class="task-icon-btn task-expand-btn" title="Показать полностью" style="display:none">' + CHEVRON_DOWN_ICON_SVG + '</button>' +
            '<button type="button" class="task-icon-btn task-restore-btn" data-id="' + t.id + '" title="Извлечь из архива">' + RESTORE_ICON_SVG + '</button>' +
            '<button type="button" class="task-icon-btn task-delete-btn" data-id="' + t.id + '" title="Удалить навсегда">' + DELETE_ICON_SVG + '</button>' +
          '</span>' +
        '</div>' +
      '</div>';
    }).join("");
    container.innerHTML =
      '<div class="task-list task-grid-list">' + rowsHtml + '</div>' +
      (shown.length === 0 ? '<div class="task-empty">Архив пуст.</div>' : '');
    container.scrollTop = preservedScrollTop;
    Array.prototype.forEach.call(container.querySelectorAll(".task-archive-body"), function(body){
      var id = body.getAttribute("data-id");
      var expandBtn = body.querySelector(".task-expand-btn");
      if(expandBtn){
        expandBtn.addEventListener("click", function(e){
          e.stopPropagation();
          if(expandedTaskIds[id]) delete expandedTaskIds[id];
          else expandedTaskIds[id] = true;
          var textEl = body.querySelector(".task-archive-text");
          if(textEl) textEl.classList.toggle("task-text-clamped", !expandedTaskIds[id]);
          updateTaskExpandBtn(body, id);
          fitTaskActions(body);
        });
      }
      updateTaskExpandBtn(body, id);
      fitTaskActions(body);
    });
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
  // самой вкладки (папка -> заметка в "Моих заметках", см. mdeditor.js) —
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
  if(getHideStatusBarEnabled()){
    applyStatusBarFullscreen(true);
    armHideStatusBarAutoRetry();
  }
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
  initTabScrollTracking();
  setInterval(function(){ updateOverallProgress(); updateMissedBanner(); checkUpdateSnoozeExpiry(); checkHourBoundaries(); refreshYearGridIfOpen(); }, 30 * 60 * 1000);
  checkUpdateSnoozeExpiry();

})();
