package com.app.lifetracker
// Версия: 1.2 (22.11) — этап 5: `title` (имя занятия в острове), `maxBytes` (предел размера), `dest` (итоговый файл обновления). Откат: DownloadTask.kt 1.1.
// Версия: 1.1 (22.11) — этап 4: `targetNote` (пометка «Папка недоступна…» для карточки «Готово»). Откат: DownloadTask.kt 1.0.
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1.

import java.io.File
import java.util.concurrent.atomic.AtomicLong

enum class DlState { QUEUED, RUNNING, PAUSED, WAITING_NET, DONE, FAILED, CANCELED }

enum class DlMode { SINGLE, MULTI }

/** Откуда задача: пользователь, обновление APK, веб-часть приложения (обновления — этап 5, silent и без папок пользователя, ТЗ 6.5). */
enum class DlSource { USER, APP_UPDATE, WEB_BUNDLE }

/**
 * Задача скачивания (ТЗ 5.1). Без Android, чтобы движок [DownloadEngine] проверялся JVM-тестами. Поля пишут служба и движок
 * (разные потоки), читает остров раз в 0,5 с, поэтому изменяемые поля `@Volatile`.
 */
class DownloadTask(val id: Long, val url: String, val headers: Map<String, String>) {
    companion object {
        const val CTL_RUN = 0
        const val CTL_PAUSE = 1
        const val CTL_CANCEL = 2
    }

    @Volatile var fileName = "file"
    @Volatile var mode = DlMode.SINGLE
    @Volatile var threads = DownloadLogic.DEFAULT_THREADS
    @Volatile var totalBytes = -1L // -1 — размер неизвестен
    val done = AtomicLong(0L)
    @Volatile var speed = 0L
    @Volatile var state = DlState.QUEUED
    @Volatile var error = ""
    @Volatile var originTab = "" // ключ вкладки, откуда запущено: `utab_<id>` / ключ вкладки Claude / пусто
    @Volatile var supportsRange = false
    @Volatile var probed = false // разведка (probe) уже выполнена и успешна
    @Volatile var etag = "" // ETag или Last-Modified: по ним проверяем, что файл на сервере не поменялся при докачке
    @Volatile var source = DlSource.USER
    @Volatile var category = "other" // ключ раздела 13 ТЗ (этап 4)
    @Volatile var targetLabel = "" // «Загрузки» или название папки — для подписи «Готово»
    @Volatile var targetNote = "" // пометка вместо «→ папка», если пришлось взять запасное место («Папка недоступна — сохранено в «Загрузки»»)
    @Volatile var verify: ((File) -> String?)? = null // проверка готового файла: null — всё хорошо, иначе текст ошибки (этап 5)
    @Volatile var silent = false // без диалога «Обычное / В N потоков»
    @Volatile var title = "" // имя занятия в острове вместо имени файла («Обновление приложения»)
    @Volatile var maxBytes = 0L // предел размера (0 — без предела): больше — ошибка «Файл слишком большой» (обновления)
    @Volatile var dest: File? = null // обновления: итоговый файл в каталоге приложения (рабочая копия), а не «Загрузки»/папка пользователя
    @Volatile var showInIsland = true
    @Volatile var note = "" // пояснение для второй строки карточки («Сервер не поддерживает потоки»)
    @Volatile var activeThreads = 1 // сколько потоков качает прямо сейчас
    @Volatile var control = CTL_RUN // команда движку: продолжать / пауза / отмена
    @Volatile var startedAt = 0L
    @Volatile var finishedAt = 0L
    @Volatile var work: File? = null // файл, куда пишет движок (`.part`)
    @Volatile var copying = false // готовый файл копируется в итоговое место

    val doneBytes: Long get() = done.get()

    /** Паузу можно ставить, только если сервер отдаёт диапазоны (ТЗ 5.3). */
    val canPause: Boolean get() = supportsRange && (state == DlState.RUNNING || state == DlState.QUEUED || state == DlState.WAITING_NET)
}

/**
 * Порядок занятий плавающего острова (ТЗ 4.2): сработавший таймер → помодоро → музыка → видео → загрузки → идущие таймеры → секундомер → тренировка.
 * Чистая функция, проверяется тестом без Android.
 */
object IslandOrder {
    const val KIND_POMO = 0
    const val KIND_TIMER = 1
    const val KIND_SW = 2
    const val KIND_MUSIC = 3
    const val KIND_VIDEO = 4
    const val KIND_WORKOUT = 5
    const val KIND_DOWNLOAD = 6

    /** Меньше — выше. [timerDone] — сработавший таймер (звонит): это сигнал, он всегда первый. */
    fun rank(kind: Int, timerDone: Boolean = false): Int = when (kind) {
        KIND_TIMER -> if (timerDone) 0 else 5
        KIND_POMO -> 1
        KIND_MUSIC -> 2
        KIND_VIDEO -> 3
        KIND_DOWNLOAD -> 4
        KIND_SW -> 6
        KIND_WORKOUT -> 7
        else -> 8
    }

    /** Устойчивая сортировка: занятия одного вида остаются в том порядке, в каком пришли (таймеры — по близости конца, загрузки — по времени старта). */
    fun <T> sort(items: List<T>, rankOf: (T) -> Int): List<T> = items.sortedBy(rankOf)
}
