package com.app.lifetracker
// Версия: 1.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 3: что показывает системный остров Xiaomi для загрузок.

/**
 * Чистая логика системного острова загрузок (ТЗ 8), без Android — проверяется JVM-тестом.
 *
 * Системный остров показывает одно занятие за раз, поэтому из всех задач выбирается одна «старшая» ([pick]); остальные идут
 * в тексте как «+N». Старшая — та, что качается (идёт, в очереди, на паузе, ждёт сеть), раньше начатая выше. Показанное «Готово»
 * и ошибка не заслоняют идущие закачки (иначе ошибка с вечной подписью спрятала бы все следующие загрузки). Это отличается от
 * внутреннего острова, где порядок только по времени старта и можно листать карточки: в системном острове листать нечем.
 */
object SystemIslandLogic {
    /** Вид занятия: определяет кнопки и значок. */
    const val KIND_ACTIVE = 0 // идёт
    const val KIND_PAUSED = 1 // на паузе
    const val KIND_WAIT = 2 // в очереди / нет сети
    const val KIND_FAILED = 3 // ошибка
    const val KIND_DONE = 4 // «Готово»

    /** Что делает левая кнопка острова. */
    const val TOGGLE_NONE = 0
    const val TOGGLE_PAUSE = 1
    const val TOGGLE_RESUME = 2
    const val TOGGLE_RETRY = 3

    class Info(
        val taskId: Long,
        val kind: Int,
        val name: String, // имя файла (обновления — «Обновление приложения»)
        val time: String, // справа в свёрнутом острове: «45 %», «12 МБ», «Готово», «Ошибка»
        val sub: String, // вторая строка раскрытого острова: «12,4 из 80 МБ · 3,2 МБ/с · 4 потока · +2»
        val fraction: Float, // доля для кольца; размер неизвестен — 0
        val toggle: Int // [TOGGLE_NONE]…[TOGGLE_RETRY]
    ) {
        /** Подпись для сравнения: пока не изменилась, уведомление не пересобирается. */
        fun signature(): String = "$taskId|$kind|$name|$time|$sub|${(fraction * 100f).toInt()}|$toggle"
    }

    private fun rank(t: DownloadTask): Int = when (t.state) {
        DlState.DONE -> 1
        DlState.FAILED -> 2
        else -> 0
    }

    /** Старшая задача: идущие раньше «Готово», «Готово» раньше ошибки; внутри группы — раньше начатая выше. Нечего показывать — null. */
    fun pick(tasks: List<DownloadTask>): DownloadTask? =
        tasks.filter { it.state != DlState.CANCELED }.sortedWith(compareBy<DownloadTask>({ rank(it) }, { it.id })).firstOrNull()

    /** Вторая строка (те же слова, что в карточке внутреннего острова), без «+N». */
    fun subText(t: DownloadTask): String {
        val total = t.totalBytes
        val done = t.doneBytes
        if (t.state == DlState.DONE) {
            return if (t.targetNote.isNotEmpty()) t.targetNote else if (t.targetLabel.isNotEmpty()) "→ " + t.targetLabel else t.title.ifEmpty { t.fileName }
        }
        val parts = ArrayList<String>()
        when (t.state) {
            DlState.QUEUED -> parts.add("в очереди")
            DlState.WAITING_NET -> parts.add("Нет сети · ждём")
            DlState.FAILED -> parts.add(t.error.ifEmpty { "Ошибка скачивания" })
            else -> {
                if (t.copying) parts.add("копирование…") else parts.add(DownloadLogic.formatProgress(done, total))
                if (t.state == DlState.PAUSED) {
                    parts.add("пауза")
                } else if (!t.copying) {
                    if (t.speed > 0) parts.add(DownloadLogic.formatSpeed(t.speed))
                    if (t.mode == DlMode.MULTI && t.note.isEmpty()) parts.add(DownloadLogic.threadsText(t.activeThreads))
                }
                if (t.note.isNotEmpty()) parts.add(t.note)
            }
        }
        return parts.joinToString(" · ")
    }

    /** Данные острова по списку задач (обычно `FileDownloads.islandTasks()`); нет задач — null (остров не нужен). */
    fun info(tasks: List<DownloadTask>): Info? {
        val live = tasks.filter { it.state != DlState.CANCELED }
        val t = pick(live) ?: return null
        val more = live.size - 1
        val total = t.totalBytes
        val done = t.doneBytes
        val pct = DownloadLogic.percent(done, total)
        val kind = when (t.state) {
            DlState.DONE -> KIND_DONE
            DlState.FAILED -> KIND_FAILED
            DlState.PAUSED -> KIND_PAUSED
            DlState.QUEUED, DlState.WAITING_NET -> KIND_WAIT
            else -> KIND_ACTIVE
        }
        val time = when (kind) {
            KIND_DONE -> "Готово"
            KIND_FAILED -> "Ошибка"
            else -> if (pct >= 0) "$pct %" else DownloadLogic.formatSize(done)
        }
        var sub = subText(t)
        if (more > 0) sub += " · +$more"
        val toggle = when {
            kind == KIND_FAILED -> TOGGLE_RETRY
            kind == KIND_PAUSED -> TOGGLE_RESUME
            kind == KIND_DONE -> TOGGLE_NONE
            t.canPause -> TOGGLE_PAUSE
            else -> TOGGLE_NONE // сервер без Range: паузы нет, остаётся «Стоп»
        }
        val fraction = if (kind == KIND_DONE) 1f else if (pct >= 0) pct / 100f else 0f
        return Info(t.id, kind, t.title.ifEmpty { t.fileName }, time, sub, fraction, toggle)
    }
}
