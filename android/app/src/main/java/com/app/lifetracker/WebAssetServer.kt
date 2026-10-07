package com.app.lifetracker

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Раздаёт веб-часть приложения под адресом https://localhost без сети.
 * Порядок: активный скачанный бандл (files/web/<версия>; папку выбирает WebUpdater.startLaunch() один раз при
 * создании Activity и передаёт сюда), затем встроенный из assets/www/. Бандл фиксируется на всё время работы
 * экрана: новая версия, скачанная в фоне, подхватывается только при следующем запуске (Q9).
 */
class WebAssetServer(private val context: Context, private val bundleDir: File?) {

    companion object {
        // ⚠️ НЕ МЕНЯТЬ ПОСЛЕ ПЕРВОГО РЕЛИЗА. От схемы и хоста зависит origin, а значит весь
        // localStorage / IndexedDB / OPFS приложения. Смена = пустое хранилище на устройстве (решение Q13).
        const val HOST = "localhost"
        const val ORIGIN = "https://$HOST"
        const val START_URL = "$ORIGIN/index.html"

        // Служебная страница диагностики (из assets/diag/), не часть веб-бандла.
        const val DIAG_URL = "$ORIGIN/__diag.html"
    }

    private val bundleCanon: String? = try {
        bundleDir?.canonicalPath
    } catch (e: IOException) {
        null
    }

    private val loader: WebViewAssetLoader = WebViewAssetLoader.Builder()
        .setDomain(HOST)
        .setHttpAllowed(false)
        .addPathHandler("/", AppPathHandler())
        .build()

    /** true, если адрес принадлежит самому приложению (https://localhost). */
    fun isAppUrl(uri: Uri?): Boolean {
        if (uri == null) return false
        return uri.scheme == "https" && uri.host == HOST && (uri.port == -1 || uri.port == 443)
    }

    /** Ответ для адресов приложения; для остальных (внешние сервисы) null: запрос уходит в сеть как обычно. */
    fun intercept(uri: Uri): WebResourceResponse? = loader.shouldInterceptRequest(uri)

    private inner class AppPathHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            var rel = path.trimStart('/')
            if (rel.isEmpty()) rel = "index.html"
            if (rel.split('/').any { it == ".." || it == "." }) return notFound()

            if (rel == "__diag.html") return openAsset("diag/diag.html", rel)

            // Файл, принятый из системного «Поделиться» (SharedInbox): ./__shared/<id>.
            if (rel.startsWith("__shared/")) return sharedFile(rel.removePrefix("__shared/"))

            if (bundleDir != null && bundleCanon != null) {
                val file = File(bundleDir, rel)
                val inside = try {
                    file.canonicalPath.startsWith(bundleCanon + File.separator)
                } catch (e: IOException) {
                    false
                }
                if (inside && file.isFile) {
                    return try {
                        response(FileInputStream(file), rel)
                    } catch (e: IOException) {
                        notFound()
                    }
                }
            }
            return openAsset("www/$rel", rel)
        }
    }

    /** Отдаёт временную копию принятого файла страницы приложения (тот же origin). Чужие id и пути дают 404. */
    private fun sharedFile(id: String): WebResourceResponse {
        val item = SharedInbox.find(id) ?: return notFound()
        return try {
            val headers = mapOf(
                "Content-Length" to item.file.length().toString(),
                "Cache-Control" to "no-store"
            )
            WebResourceResponse(item.type, null, 200, "OK", headers, FileInputStream(item.file))
        } catch (e: IOException) {
            notFound()
        }
    }

    private fun openAsset(assetPath: String, name: String): WebResourceResponse {
        return try {
            response(context.assets.open(assetPath), name)
        } catch (e: IOException) {
            notFound()
        }
    }

    private fun response(stream: InputStream, name: String): WebResourceResponse {
        val mime = mimeFor(name)
        val encoding = if (mime.startsWith("text/") || mime == "application/json" || mime == "text/javascript") "utf-8" else null
        return WebResourceResponse(mime, encoding, stream)
    }

    private fun notFound(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun mimeFor(name: String): String =
        when (name.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "wasm" -> "application/wasm"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "svg" -> "image/svg+xml"
            "ttf" -> "font/ttf"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "md", "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
}
