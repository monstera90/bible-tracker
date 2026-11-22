package com.app.lifetracker
// Версия: 1.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 4: чистая функция выбора папки по имени файла (разделы 13.2–13.4).

/**
 * Какая папка подходит файлу (ТЗ 13.3). Здесь нет Android: функция [choose] и нормализация формата проверяются JVM-тестами
 * (DownloadRulesTest). Хранение настроек, права на папки и запись файла — в [DownloadFolders] и [DownloadTarget].
 *
 * Порядок (берётся первое подходящее):
 *  1. источник — обновление приложения: только категория «Обновление приложения» (правила 2–4 к нему не применяются);
 *     веб-часть приложения ([DlSource.WEB_BUNDLE]) не сортируется никогда;
 *  2. «свои форматы» (включённые и с папкой) — совпадение по окончанию имени, побеждает самое длинное окончание;
 *  3. категория по расширению (включённая и с папкой) — тоже побеждает самое длинное окончание;
 *  4. «Всё остальное», если включено и с папкой;
 *  5. «Загрузки».
 * Недоступность выбранной папки здесь не проверяется: это делает [DownloadTarget.resolve] (запасной вариант — «Загрузки» и пометка).
 */
object DownloadRules {

    const val KEY_UPDATE = "update"
    const val KEY_OTHER = "other"

    const val MAX_RULES = 50
    const val MAX_FORMAT_LEN = 16

    /** Категория (ТЗ 13.2): [formats] — окончания имени без точки, нижний регистр; у «Обновления» и «Всего остального» список пуст. */
    class Category(val key: String, val title: String, val formats: List<String>)

    /** Категории в порядке показа на вкладке «Сохранение загрузок». Формат — константы в коде (в интерфейсе виден). */
    val CATEGORIES: List<Category> = listOf(
        Category("images", "Картинки", listOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "svg", "tif", "tiff", "ico")),
        Category("apk", "APK", listOf("apk", "xapk", "apks", "apkm")),
        Category(KEY_UPDATE, "Обновление приложения", emptyList()),
        Category("video", "Видео", listOf("mp4", "mkv", "avi", "mov", "webm", "3gp", "m4v", "flv", "wmv", "mpg", "mpeg")),
        Category("pdf", "PDF", listOf("pdf")),
        Category("books", "Электронные книги", listOf("epub", "fb2", "fb2.zip", "mobi", "azw", "azw3", "djvu", "djv", "cbz", "cbr")),
        Category("music", "Музыка", listOf("mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wma", "ape", "alac", "m4b")),
        Category("docs", "Документы", listOf("doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "md", "csv", "rtf")),
        Category("archives", "Архивы", listOf("zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "tar.gz")),
        Category(KEY_OTHER, "Всё остальное", emptyList())
    )

    fun category(key: String): Category? = CATEGORIES.firstOrNull { it.key == key }

    /** Одна настройка: включена ли и выбрана ли папка. Работает, только когда и то и другое. */
    class Slot(val enabled: Boolean, val hasFolder: Boolean) {
        val active: Boolean get() = enabled && hasFolder
    }

    /** Все настройки для выбора: категории по ключу и «свои форматы» по нормализованному формату. */
    class Config(val categories: Map<String, Slot>, val rules: Map<String, Slot>) {
        companion object {
            val EMPTY = Config(emptyMap(), emptyMap())
        }
    }

    /** Результат выбора. */
    sealed class Choice {
        /** Папка не выбрана: «Загрузки». */
        object Downloads : Choice()

        /** Категория [key] (в том числе «update» и «other»). */
        class Cat(val key: String) : Choice()

        /** «Свой формат» [ext] (нормализованный). */
        class Custom(val ext: String) : Choice()
    }

    // ---------- нормализация и проверка ввода (13.4) ----------

    /** «ZIP», « .zip », «*.zip», «*.Fb2.ZIP» → «zip», «zip», «zip», «fb2.zip». Лишние пробелы внутри убираются. */
    fun normalizeFormat(raw: String?): String {
        var s = (raw ?: "").trim().lowercase().replace(Regex("\\s+"), "")
        s = s.trimStart('*').trimStart('.')
        s = s.trimEnd('.')
        return s
    }

    /** Текст ошибки для введённого (уже нормализованного) формата; null — формат подходит. */
    fun formatError(norm: String): String? = when {
        norm.isEmpty() -> "Введите формат, например zip"
        norm.contains('/') || norm.contains('\\') -> "В формате не должно быть «/» и «\\»"
        norm.length > MAX_FORMAT_LEN -> "Формат длиннее $MAX_FORMAT_LEN символов"
        else -> null
    }

    // ---------- сопоставление ----------

    /** Оканчивается ли имя (нижний регистр) на «.<fmt>»; имя вида «.zip» без основы не считается. */
    fun endsWithFormat(nameLower: String, fmt: String): Boolean =
        fmt.isNotEmpty() && nameLower.length > fmt.length + 1 && nameLower.endsWith(".$fmt")

    /**
     * Ключ категории по имени файла — без учёта настроек (какая категория по смыслу): самое длинное совпавшее окончание
     * среди форматов категорий; ничего не подошло или файл без расширения — «other».
     */
    fun categoryOfName(fileName: String): String {
        val n = fileName.lowercase()
        var best: String? = null
        var bestLen = -1
        for (c in CATEGORIES) for (f in c.formats) {
            if (f.length > bestLen && endsWithFormat(n, f)) {
                best = c.key
                bestLen = f.length
            }
        }
        return best ?: KEY_OTHER
    }

    /** Какую из категорий (только включённые и с папкой) выбирает имя файла: самое длинное окончание. null — ни одна. */
    private fun activeCategoryFor(n: String, cfg: Config): String? {
        var best: String? = null
        var bestLen = -1
        for (c in CATEGORIES) {
            if (c.key == KEY_UPDATE || c.key == KEY_OTHER) continue
            if (cfg.categories[c.key]?.active != true) continue
            for (f in c.formats) {
                if (f.length > bestLen && endsWithFormat(n, f)) {
                    best = c.key
                    bestLen = f.length
                }
            }
        }
        return best
    }

    /** «Свой формат» (включённый и с папкой), подходящий имени: самое длинное окончание. null — ни один. */
    private fun activeCustomFor(n: String, cfg: Config): String? {
        var best: String? = null
        var bestLen = -1
        for ((ext, slot) in cfg.rules) {
            if (!slot.active) continue
            if (ext.length > bestLen && endsWithFormat(n, ext)) {
                best = ext
                bestLen = ext.length
            }
        }
        return best
    }

    /** Единственное место выбора по правилам раздела 13.3 (см. шапку файла). */
    fun choose(fileName: String, source: DlSource, cfg: Config): Choice {
        if (source == DlSource.WEB_BUNDLE) return Choice.Downloads
        if (source == DlSource.APP_UPDATE) {
            return if (cfg.categories[KEY_UPDATE]?.active == true) Choice.Cat(KEY_UPDATE) else Choice.Downloads
        }
        val n = fileName.lowercase()
        val custom = activeCustomFor(n, cfg)
        if (custom != null) return Choice.Custom(custom)
        val cat = activeCategoryFor(n, cfg)
        if (cat != null) return Choice.Cat(cat)
        if (cfg.categories[KEY_OTHER]?.active == true) return Choice.Cat(KEY_OTHER)
        return Choice.Downloads
    }

    /** Название категории, которую перекрывает формат [norm] («Перекрывает категорию «…»», 13.4); null — формат не входит ни в одну. */
    fun overriddenCategoryTitle(norm: String): String? {
        for (c in CATEGORIES) if (c.formats.contains(norm)) return c.title
        return null
    }
}
