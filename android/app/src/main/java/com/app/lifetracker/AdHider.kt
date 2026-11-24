package com.app.lifetracker
// Версия: 1.0 (24.11) — скрытие пустых рекламных блоков на страницах вкладок-сайтов (UserTabs). Сеть не трогает: сами запросы рекламы режет ваш блокировщик,
// а здесь убираются «пустышки», которые от неё остаются (рамка, подпись «Реклама», пустой <ins>, обёртка с отступами). Откат: удалить файл и вызовы AdHider из UserTabs.kt.

/**
 * Скрипт для страницы. Ставится на начало документа (WebViewCompat.addDocumentStartJavaScript) и работает только в главном кадре.
 *
 * Два правила:
 *  1. Известные рекламные места (Google AdSense / Ad Manager, Яндекс РСЯ, AdFox, data-ad-slot) скрываются сразу стилем.
 *  2. Узел, у которого в id или классе есть слово «ad / ads / advert / реклама…», скрывается, только если в нём пусто:
 *     нет текста (кроме подписи «Реклама», «Advertisement», «Закрыть»), заметных картинок, видео и чужих кадров.
 *     Если после этого пустым остался родитель без своего id (подпись и отступы вокруг слота), скрывается и он — не выше трёх уровней.
 * Узел с настоящим содержимым не трогается. Слово «banner» само по себе рекламой не считается (под ним бывают плашки cookies и заставки).
 * `window.__ltAdHideOff()` — выключить: всё скрытое возвращается, наблюдатель останавливается.
 * В тексте скрипта нет знака доллара: это сырая строка Kotlin.
 */
internal object AdHider {
    const val JS = """(function(){try{
var W=window,D=document;
if(W.top!==W||W.__ltAdHide)return;
W.__ltAdHide=1;
var STYLE_ID='__ltadh',ATTR='data-ltadh',done=[],off=false,timer=0,obs=null,pending=[],full=true;
var CSS='ins.adsbygoogle,.adsbygoogle,[id^="google_ads_"],[id^="div-gpt-ad"],[id^="yandex_rtb_"],[id^="adfox_"],[data-ad-slot],[data-ad-client],'
+'iframe[src*="doubleclick.net"],iframe[src*="googlesyndication.com"],iframe[id^="google_ads_iframe"],iframe[src*="/adfox"],'
+'iframe[src*="an.yandex.ru"],iframe[src*="yandexadexchange"],iframe[src*="/ads/"]{display:none!important;}'
+'['+ATTR+']{display:none!important;}';
function addStyle(){
 var p=D.head||D.documentElement;
 if(!p||D.getElementById(STYLE_ID))return !!D.getElementById(STYLE_ID);
 var s=D.createElement('style');s.id=STYLE_ID;s.textContent=CSS;p.appendChild(s);return true;
}
if(!addStyle()){
 var m0=new MutationObserver(function(){if(addStyle())m0.disconnect();});
 m0.observe(D,{childList:true,subtree:true});
}
var WORDS={ad:1,ads:1,adv:1,advert:1,adverts:1,advertisement:1,advertising:1,adsense:1,adslot:1,adunit:1,adbox:1,adwrap:1,adwrapper:1,adcontainer:1,adplace:1,adholder:1,adzone:1,
 sponsored:1,sponsor:1,reklama:1,reklam:1,rekl:1,adfox:1,rtb:1,promoblock:1,rsya:1,
 'реклама':1,'рекламный':1,'рекламы':1,'рекламное':1};
var SKIP={HTML:1,BODY:1,HEAD:1,MAIN:1,ARTICLE:1,HEADER:1,FOOTER:1,NAV:1,FORM:1,SCRIPT:1,STYLE:1,LINK:1,META:1,NOSCRIPT:1,TEMPLATE:1,A:1,P:1,LI:1,TR:1,TD:1,TH:1,TABLE:1,H1:1,H2:1,H3:1,UL:1,OL:1};
var BAD_HOST=/(doubleclick|googlesyndication|googleadservices|adservice\.google|adfox|an\.yandex|yandexadexchange|mc\.yandex|criteo|taboola|outbrain|adriver|begun|bidswitch|adnxs|rubiconproject|pubmatic|smartadserver|amazon-adsystem|mail\.ru\/ads|top-fwz1\.mail|rambler\.ru\/ad)/i;
var LABEL=/(реклама|рекламный блок|рекламное объявление|ads? by [a-z ]+|advertisements?|advertising|sponsored( content)?|спонсорский|закрыть|скрыть|close|пропустить|skip|[×✕✖]+)/gi;
function hasWord(el){
 var s=(el.id||'')+' '+(typeof el.className==='string'?el.className:(el.getAttribute&&el.getAttribute('class'))||'');
 if(!s.trim())return false;
 s=s.replace(/([a-zа-я])([A-ZА-Я])/g,function(m,a,b){return a+' '+b;}).toLowerCase().split(/[^a-z0-9а-я]+/);
 for(var i=0;i<s.length;i++)if(s[i]&&WORDS[s[i]]===1)return true;
 return false;
}
function box(el){var r=el.getBoundingClientRect();return r;}
function realText(el){
 var t='';
 try{t=(el.innerText!=null?el.innerText:el.textContent)||'';}catch(e){}
 return t.replace(LABEL,'').replace(/[\s\u00a0.,:;!?|\-–—·•()\[\]\/\\]+/g,'');
}
function hasContent(el){
 if(realText(el).length>0)return true;
 var q=el.querySelectorAll('img,video,canvas,picture,audio,input,textarea,select,object,embed,svg,iframe'),i,n,r,tag;
 for(i=0;i<q.length;i++){
  n=q[i];tag=n.tagName;
  r=box(n);
  if(tag==='IFRAME'){
   var src=n.getAttribute('src')||'';
   if(BAD_HOST.test(src))continue;
   if(r.width<2||r.height<2)continue;
   return true;
  }
  if(tag==='IMG'){if(r.width>=20&&r.height>=20)return true;continue;}
  if(tag==='SVG'||tag==='svg'){if(r.width>=40&&r.height>=40)return true;continue;}
  if(tag==='INPUT'&&n.type==='hidden')continue;
  if(r.width>=2&&r.height>=2)return true;
 }
 return false;
}
function hide(el){
 el.setAttribute(ATTR,'1');done.push(el);
}
function tryHide(el){
 if(el.nodeType!==1||SKIP[el.tagName]===1||el.hasAttribute(ATTR))return;
 if(!hasWord(el))return;
 var r=box(el),vh=W.innerHeight||800,vw=W.innerWidth||400;
 if(r.height>vh*0.8&&r.width>vw*0.6)return;
 if(hasContent(el))return;
 hide(el);
 var p=el.parentElement,lvl=0;
 while(p&&lvl<3&&SKIP[p.tagName]!==1&&!p.hasAttribute(ATTR)){
  if(p.id&&!hasWord(p))break;
  var pr=box(p);
  if(pr.height>400)break;
  if(p.children.length>4)break;
  if(hasContent(p))break;
  hide(p);
  p=p.parentElement;lvl++;
 }
}
function sweepNodes(list){
 var i,j,n,all;
 for(i=0;i<list.length;i++){
  n=list[i];
  if(!n||n.nodeType!==1)continue;
  tryHide(n);
  if(n.querySelectorAll){all=n.querySelectorAll('[id],[class]');for(j=0;j<all.length;j++)tryHide(all[j]);}
 }
}
function run(){
 timer=0;if(off)return;
 var list=full?[D.body||D.documentElement]:pending;
 pending=[];full=false;
 if(list[0])sweepNodes(list);
}
function later(ms){if(!timer&&!off)timer=setTimeout(run,ms);}
function start(){
 if(off)return;
 try{
  obs=new MutationObserver(function(ms){
   for(var i=0;i<ms.length;i++){
    var a=ms[i].addedNodes;
    for(var j=0;j<a.length;j++)if(a[j].nodeType===1)pending.push(a[j]);
    if(ms[i].type==='attributes'&&ms[i].target.nodeType===1)pending.push(ms[i].target);
   }
   if(pending.length>400)full=true;
   later(600);
  });
  obs.observe(D.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','id']});
 }catch(e){}
 later(300);
 W.addEventListener('load',function(){full=true;later(500);setTimeout(function(){full=true;later(0);},2500);setTimeout(function(){full=true;later(0);},6000);});
}
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',start);else start();
W.__ltAdHideOff=function(){
 off=true;
 try{if(obs)obs.disconnect();}catch(e){}
 if(timer){clearTimeout(timer);timer=0;}
 for(var i=0;i<done.length;i++){try{done[i].removeAttribute(ATTR);}catch(e){}}
 done=[];
 try{var s=D.getElementById(STYLE_ID);if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}
 try{delete W.__ltAdHide;delete W.__ltAdHideOff;}catch(e){W.__ltAdHide=0;}
};
}catch(e){}})();"""
}
