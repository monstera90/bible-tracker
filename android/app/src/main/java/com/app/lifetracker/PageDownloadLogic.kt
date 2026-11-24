package com.app.lifetracker
// Версия: 2.0 (24.11)

import java.io.ByteArrayOutputStream

/**
 * Чистая часть этапа 6 (раздел 6.6): без Android, чтобы проверять на JVM ([PageDownloadLogicTest]).
 * Android-часть — [PageDownloads].
 *
 * Протокол одноразового канала со страницей (строки через `WebMessagePort`):
 *  страница → приложение: `H|<размер>|<тип>` (заголовок), `D|<base64>` (кусок), `E` (конец), `X|<причина>` (ошибка: `fetch` — ссылку не открыть, `read` — чтение сорвалось);
 *  приложение → страница: `a` (принято, присылай следующее), `c` (отмена).
 * Каждый кусок страница отправляет только после `a` на предыдущий: файл любого размера не копится в очереди сообщений.
 */
object PageDownloadLogic {

    /** Размер куска (байт) на стороне страницы; кратно 3, чтобы base64 каждого куска был независим. */
    const val CHUNK_BYTES = 1_572_864

    class DataUrl(val mime: String, val bytes: ByteArray)

    sealed class Msg {
        class Header(val size: Long, val mime: String) : Msg()
        class Data(val base64: String) : Msg()
        object End : Msg()
        class Error(val reason: String) : Msg()
        object Unknown : Msg()
    }

    /** `data:[<тип>][;параметры][;base64],<данные>` → тип и байты. null — это не data: или адрес испорчен. */
    fun parseDataUrl(url: String?): DataUrl? {
        val u = url?.trim() ?: return null
        if (!u.startsWith("data:", ignoreCase = true)) return null
        val comma = u.indexOf(',')
        if (comma < 0) return null
        val parts = u.substring(5, comma).split(';').map { it.trim() }
        val isBase64 = parts.drop(1).any { it.equals("base64", ignoreCase = true) }
        val mime = parts[0].lowercase().ifEmpty { "text/plain" }
        val body = u.substring(comma + 1)
        val bytes = if (isBase64) decodeBase64(percentDecodeToBytes(body)) else percentDecodeToBytes(body)
        return if (bytes == null) null else DataUrl(mime, bytes)
    }

    /** Процентное кодирование → байты: «%XX» — байт, остальное — UTF-8 символа. Неполное «%» оставляем как есть. */
    fun percentDecodeToBytes(s: String): ByteArray {
        val out = ByteArrayOutputStream(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%' && i + 2 < s.length && hex(s[i + 1]) >= 0 && hex(s[i + 2]) >= 0) {
                out.write(hex(s[i + 1]) * 16 + hex(s[i + 2]))
                i += 3
            } else {
                val cp = s.codePointAt(i)
                val n = Character.charCount(cp)
                out.write(s.substring(i, i + n).toByteArray(Charsets.UTF_8))
                i += n
            }
        }
        return out.toByteArray()
    }

    private fun hex(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        in 'A'..'F' -> c - 'A' + 10
        else -> -1
    }

    /** base64 (обычный и URL-безопасный алфавит, пробелы и переводы строк игнорируются, без «=» допустимо). null — недопустимый символ. */
    fun decodeBase64(src: ByteArray): ByteArray? {
        val out = ByteArrayOutputStream(src.size * 3 / 4 + 3)
        var acc = 0
        var bits = 0
        for (b in src) {
            val c = b.toInt() and 0xFF
            val v = when (c) {
                in 'A'.code..'Z'.code -> c - 'A'.code
                in 'a'.code..'z'.code -> c - 'a'.code + 26
                in '0'.code..'9'.code -> c - '0'.code + 52
                '+'.code, '-'.code -> 62
                '/'.code, '_'.code -> 63
                '='.code -> break
                ' '.code, '\n'.code, '\r'.code, '\t'.code -> continue
                else -> return null
            }
            acc = (acc shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((acc shr bits) and 0xFF)
                acc = acc and ((1 shl bits) - 1)
            }
        }
        return out.toByteArray()
    }

    /** Имя файла для `data:`/`blob:`: из Content-Disposition, иначе «download»; без расширения — достраивается по типу. */
    fun pageFileName(contentDisposition: String?, mime: String?): String {
        var name = DownloadLogic.safeName(DownloadLogic.parseContentDisposition(contentDisposition) ?: "download")
        if (!name.contains('.')) {
            val ext = DownloadLogic.extForMime(mime)
            if (ext.isNotEmpty()) name = "$name.$ext"
        }
        return name
    }

    /** Источник `blob:https://host/uuid` → «https://host»; для «blob:null/…» (непрозрачный источник) и не-http — null. */
    fun blobOrigin(blobUrl: String?): String? {
        val u = blobUrl?.trim() ?: return null
        if (!u.startsWith("blob:", ignoreCase = true)) return null
        val rest = u.substring(5)
        if (!rest.startsWith("http://", ignoreCase = true) && !rest.startsWith("https://", ignoreCase = true)) return null
        val schemeEnd = rest.indexOf("://") + 3
        val slash = rest.indexOf('/', schemeEnd)
        val origin = if (slash < 0) rest else rest.substring(0, slash)
        return if (origin.length > schemeEnd) origin else null
    }

    /**
     * Скрипт для страницы вкладки: запоминает имя из атрибута `download` у ссылок (`<a download="имя.ext" href="…">`), потому что
     * WebView в слушатель скачивания это имя не передаёт. Ловит и настоящий клик по ссылке, и программный `a.click()` / `dispatchEvent`
     * (так сайты обычно и скачивают). Записи — адрес ссылки → имя, хранятся последние 50. Ставится один раз на страницу.
     */
    fun nameHookScript(): String =
        "(function(){if(window.__ltDlHook)return;window.__ltDlHook=1;var M=window.__ltDlNames={},K=[];" +
            "function rec(a){try{if(!a||a.tagName!==\"A\")return;var n=a.getAttribute(\"download\");" +
            "if(!n||!a.href)return;if(!(a.href in M))K.push(a.href);M[a.href]=n;" +
            "while(K.length>50){delete M[K.shift()];}}catch(x){}}" +
            "document.addEventListener(\"click\",function(e){var t=e.target;while(t&&t.tagName!==\"A\")t=t.parentNode;rec(t);},true);" +
            "var c=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){rec(this);return c.apply(this,arguments);};" +
            "var d=EventTarget.prototype.dispatchEvent;EventTarget.prototype.dispatchEvent=function(e){" +
            "try{if(e&&e.type===\"click\")rec(this);}catch(x){}return d.apply(this,arguments);};})();"

    /** Скрипт-запрос: имя, которое страница запомнила для этого адреса (пустая строка — не запомнила). Результат — JSON-строка. */
    fun nameLookupScript(url: String): String =
        "(function(){try{var m=window.__ltDlNames;return (m&&m[" + jsString(url) + "])||\"\";}catch(x){return \"\";}})()"

    /** Ответ `evaluateJavascript` (JSON-строка в кавычках, `null` или пусто) → имя; пусто — имени нет. Без org.json: логика проверяется на JVM. */
    fun nameFromJsResult(raw: String?): String {
        val r = raw?.trim() ?: return ""
        if (r.length < 2 || r[0] != '"' || r[r.length - 1] != '"') return ""
        val sb = StringBuilder()
        var i = 1
        val end = r.length - 1
        while (i < end) {
            val c = r[i]
            if (c != '\\') { sb.append(c); i++; continue }
            if (i + 1 >= end) break
            when (val e = r[i + 1]) {
                'n' -> sb.append('\n')
                'r' -> sb.append('\r')
                't' -> sb.append('\t')
                'b' -> sb.append('\b')
                'f' -> sb.append('\u000C')
                'u' -> {
                    val code = if (i + 6 <= end) r.substring(i + 2, i + 6).toIntOrNull(16) else null
                    if (code == null) return ""
                    sb.append(code.toChar())
                    i += 4
                }
                else -> sb.append(e)
            }
            i += 2
        }
        return sb.toString().trim()
    }

    /** Имя файла → заголовок Content-Disposition, который понимает остальной код (`filename*` в UTF-8). Пустое имя → null. */
    fun dispositionFor(name: String?): String? {
        val n = name?.trim().orEmpty()
        if (n.isEmpty()) return null
        val sb = StringBuilder("attachment; filename*=UTF-8''")
        for (b in n.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            val plain = (c in 'A'.code..'Z'.code) || (c in 'a'.code..'z'.code) || (c in '0'.code..'9'.code) || c == '.'.code || c == '-'.code || c == '_'.code
            if (plain) sb.append(c.toChar()) else sb.append('%').append("%02X".format(c))
        }
        return sb.toString()
    }

    /** Разбор сообщения страницы по протоколу (см. шапку). */
    fun parseMessage(raw: String?): Msg {
        val m = raw ?: return Msg.Unknown
        if (m == "E") return Msg.End
        if (m.startsWith("D|")) return Msg.Data(m.substring(2))
        if (m.startsWith("X|")) return Msg.Error(m.substring(2))
        if (m.startsWith("H|")) {
            val p = m.split('|', limit = 3)
            val size = p.getOrNull(1)?.toLongOrNull() ?: return Msg.Unknown
            return Msg.Header(size, p.getOrNull(2)?.trim() ?: "")
        }
        return Msg.Unknown
    }

    /** Понятная причина по коду ошибки страницы. */
    fun errorText(reason: String): String = when (reason.trim()) {
        "fetch" -> "страница уже убрала этот файл (ссылка blob: закрыта) или не разрешила его прочитать"
        "read" -> "не удалось прочитать файл на странице"
        else -> reason.trim().ifEmpty { "ошибка страницы" }
    }

    /** Строка для вставки в JavaScript в двойных кавычках. */
    fun jsString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '<' -> sb.append("\\u003c")
                '\u2028' -> sb.append("\\u2028")
                '\u2029' -> sb.append("\\u2029")
                else -> sb.append(c)
            }
        }
        return sb.append('"').toString()
    }

    /**
     * Скрипт, который выполняется в странице вкладки: ждёт одно сообщение с токеном и портом, читает `blob:`-ссылку и отдаёт файл
     * по порту кусками с подтверждением (протокол — в шапке). Постоянных объектов в странице не оставляет; слушатель снимается сам через 30 с.
     */
    fun blobScript(token: String, blobUrl: String): String =
        "(function(){var T=" + jsString(token) + ",U=" + jsString(blobUrl) + ",CH=" + CHUNK_BYTES + ";" +
            "function run(p){var done=false,wait=null;" +
            "p.onmessage=function(e){if(e.data===\"c\")done=true;if(wait){var w=wait;wait=null;w();}};" +
            "function ack(){return new Promise(function(r){wait=r;});}" +
            "function fail(w){try{p.postMessage(\"X|\"+w);}catch(x){}}" +
            "fetch(U).then(function(r){return r.blob();}).then(function(b){" +
            "var size=b.size,off=0;p.postMessage(\"H|\"+size+\"|\"+(b.type||\"\"));" +
            "function next(){if(done)return;if(off>=size){p.postMessage(\"E\");return;}" +
            "var fr=new FileReader();" +
            "fr.onload=function(){var s=String(fr.result),i=s.indexOf(\",\");p.postMessage(\"D|\"+(i>=0?s.slice(i+1):\"\"));ack().then(next);};" +
            "fr.onerror=function(){fail(\"read\");};" +
            "var part=b.slice(off,Math.min(off+CH,size));off+=CH;fr.readAsDataURL(part);}" +
            "ack().then(next);" +
            "}).catch(function(){fail(\"fetch\");});}" +
            "function h(e){if(e.data!==T||!e.ports||!e.ports.length)return;window.removeEventListener(\"message\",h);run(e.ports[0]);}" +
            "window.addEventListener(\"message\",h);" +
            "setTimeout(function(){window.removeEventListener(\"message\",h);},30000);})();"
}
