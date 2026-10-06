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
 * Порядок: активный скачанный бандл (files/web/<версия>, указатель files/web/active.txt; пишется на шаге 3),
 * затем встроенный из assets/www/.
 */
class WebAssetServer(private val context: Context) {

    companion object {
        // ⚠️ НЕ МЕНЯТЬ ПОСЛЕ ПЕРВОГО РЕЛИЗА. От схемы и хоста зависит origin, а значит весь
        // localStorage / IndexedDB / OPFS приложения. Смена = пустое хранилище на устройстве (решение Q13).
        const val HOST = "localhost"
        const val ORIGIN = "https://$HOST"
        const val START_URL = "$ORIGIN/index.html"

        // Служебная страница диагностики (из assets/diag/), не часть веб-бандла.
        const val DIAG_URL = "$ORIGIN/__diag.html"
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

            val bundle = activeBundleDir()
            if (bundle != null) {
                val file = File(bundle, rel)
                val inside = try {
                    file.canonicalPath.startsWith(bundle.canonicalPath + File.separator)
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

    private fun activeBundleDir(): File? {
        try {
            val pointer = File(context.filesDir, "web/active.txt")
            if (!pointer.isFile) return null
            val name = pointer.readText().trim()
            if (name.isEmpty() || name.contains('/') || name.contains("..")) return null
            val dir = File(context.filesDir, "web/$name")
            return if (File(dir, "index.html").isFile) dir else null
        } catch (e: Exception) {
            return null
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
