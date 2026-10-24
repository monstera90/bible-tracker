package com.app.lifetracker
// Версия: 3.0 (24.10) — мост версии 10: restartForWebUpdate (перезапуск Activity, чтобы применилась скачанная веб-часть).
// Версия: 2.0 (21.10) — мост версии 9: вкладка Claude (claudeShow/claudeHide/claudeReload/claudeSetAuto/claudeGetState/claudeArm/claudeDisarm/claudeSendNow).
// Версия: 1.1 (18.10) — мост версии 8: createScanShortcut / openShortcutPermissionSettings.
// Версия: 1.0 (17.10) — мост версии 7: методы таймеров карточек (startCardTimer и др.).

import android.graphics.Color
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject

/**
 * Мост «веб → нативная оболочка»: в странице доступен как window.LifeTrackerNative.
 * Каждый метод помечен @JavascriptInterface и работает только пока загружена страница https://localhost.
 * Новые методы добавляются на своих шагах (скачивание, уведомления, share, полноэкранный режим и т.д.).
 */
class NativeBridge(private val activity: MainActivity) {

    companion object {
        /**
         * 1: шаги 2-3 (статус-бар, live-update); 2: шаг 4 (сохранение, «Поделиться», полный экран, приём файлов);
         * 3: шаг 5 (нативные уведомления: напоминания, общие задачи, будильник, опрос при закрытом приложении);
         * 4: клавиатура поверх страницы (setKeyboardOverlay + window.__ltOnKeyboard): текст задачи поднимается над клавиатурой.
         * 5: copyText — копирование выделенного текста в буфер обмена (своя кнопка «Копировать» вместо системного меню).
         * 6: быстрая задача из ярлыка (takeQuickTasks / ackQuickTasks / setQuickTaskTheme): окно «Создать новую задачу»
         *    складывает задачи в очередь, страница забирает их в Inbox.
         * 7: таймеры карточек вкладки 9 (startCardTimer / pauseCardTimer / resumeCardTimer / cancelCardTimer / getCardTimers).
         * 8: ярлык сканера QR на рабочий стол (createScanShortcut / openShortcutPermissionSettings).
         * 9: вкладка Claude (claudeShow / claudeHide / claudeReload / claudeSetAuto / claudeGetState / claudeArm / claudeDisarm / claudeSendNow).
         * 10: вкладка «Проверка обновлений» (restartForWebUpdate; getWebUpdateState теперь отдаёт ещё и checkSeq).
         */
        const val BRIDGE_VERSION = 10
    }

    /** JSON: {"shell":"kotlin","versionName":"...","versionCode":N,"sdk":N}. Пустой объект, если страница не доверенная. */
    @JavascriptInterface
    fun getAppInfo(): String {
        if (!activity.pageTrusted) return "{}"
        return try {
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            JSONObject()
                .put("shell", "kotlin")
                .put("versionName", info.versionName ?: "")
                .put("versionCode", PackageInfoCompat.getLongVersionCode(info))
                .put("sdk", Build.VERSION.SDK_INT)
                .put("bridgeVersion", BRIDGE_VERSION)
                .toString()
        } catch (e: Exception) {
            "{}"
        }
    }

    /**
     * Страница сообщает, что успешно запустилась (my.js, после загрузки страницы и чтения version.json бандла).
     * Подтверждает пробный запуск скачанной версии веб-части (live-update, WebUpdater); иначе при следующем
     * запуске версия откатится на предыдущую рабочую.
     */
    @JavascriptInterface
    fun appReady(version: String?) {
        if (!activity.pageTrusted) return
        try {
            activity.webUpdater.confirm(version)
        } catch (e: Exception) {
            // Подтверждение не записалось: версия откатится при следующем запуске, приложение продолжает работать.
        }
    }

    /** JSON с состоянием live-update (для страницы диагностики). */
    @JavascriptInterface
    fun getWebUpdateState(): String {
        if (!activity.pageTrusted) return "{}"
        return try {
            activity.webUpdater.describe()
        } catch (e: Exception) {
            "{}"
        }
    }

    /** Запускает проверку обновления веб-части прямо сейчас (в фоне); результат виден в getWebUpdateState(). */
    @JavascriptInterface
    fun checkWebUpdateNow() {
        if (!activity.pageTrusted) return
        activity.webUpdater.checkInBackground(true)
    }

    /**
     * Перезапускает Activity: onCreate снова зовёт WebUpdater.startLaunch(), и скачанная (ожидающая) версия веб-части
     * становится активной без ожидания следующего холодного запуска. Процесс и данные приложения не затрагиваются.
     */
    @JavascriptInterface
    fun restartForWebUpdate() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.recreate() }
    }

    /** Самотест live-update на устройстве (без сети, в отдельной папке): текст с ✅/❌. */
    @JavascriptInterface
    fun runWebUpdateSelfTest(): String {
        if (!activity.pageTrusted) return "страница не доверенная"
        return try {
            activity.webUpdater.selfTest()
        } catch (e: Exception) {
            "самотест не запустился: $e"
        }
    }

    // ===== Шаг 4: сохранение файлов в «Загрузки» (куски base64 от native-shell.js) =====

    /** Начало сохранения файла в «Загрузки». Идентификатор сессии или "" при ошибке (страница тогда откатывается на старый путь). */
    @JavascriptInterface
    fun beginSave(name: String?): String {
        if (!activity.pageTrusted) return ""
        return activity.fileSaver.beginSave(name)
    }

    /** Очередной кусок файла (base64 без префикса). false: запись не удалась, сессия отменена. */
    @JavascriptInterface
    fun appendSave(id: String?, base64: String?): Boolean {
        if (!activity.pageTrusted) return false
        return activity.fileSaver.append(id, base64)
    }

    /** Завершает сохранение. JSON {"ok":true,"name":"...","bytes":N} или {"ok":false,"error":"..."}; показывает уведомление «Сохранено». */
    @JavascriptInterface
    fun finishSave(id: String?): String {
        if (!activity.pageTrusted) return "{\"ok\":false,\"error\":\"страница не доверенная\"}"
        val result = activity.fileSaver.finish(id)
        try {
            val json = JSONObject(result)
            if (json.optBoolean("ok")) activity.toast("Сохранено в «Загрузки»: " + json.optString("name"))
        } catch (e: Exception) {
            // результат всё равно возвращается странице
        }
        return result
    }

    /** Отмена сохранения или подготовки файла: недописанное удаляется. */
    @JavascriptInterface
    fun cancelSave(id: String?) {
        if (!activity.pageTrusted) return
        activity.fileSaver.cancel(id)
    }

    /** Короткое сообщение внизу экрана (ошибки сохранения и т.п.). */
    @JavascriptInterface
    fun showToast(text: String?) {
        if (!activity.pageTrusted || text.isNullOrEmpty()) return
        activity.toast(text.take(300))
    }

    // ===== Шаг 4: системное меню «Поделиться» (замена navigator.share, которого в WebView нет) =====

    /** Начало подготовки файла для «Поделиться». Дальше appendSave, затем finishStage (или cancelSave). */
    @JavascriptInterface
    fun beginStage(name: String?): String {
        if (!activity.pageTrusted) return ""
        return activity.fileSaver.beginStage(name)
    }

    /** Завершает подготовку файла для «Поделиться» (без уведомления «Сохранено»). Формат ответа как у finishSave. */
    @JavascriptInterface
    fun finishStage(id: String?): String {
        if (!activity.pageTrusted) return "{\"ok\":false,\"error\":\"страница не доверенная\"}"
        return activity.fileSaver.finish(id)
    }

    /** Открывает меню «Поделиться» для файлов, подготовленных через beginStage (title и text необязательны). */
    @JavascriptInterface
    fun shareStaged(title: String?, text: String?): Boolean {
        if (!activity.pageTrusted) return false
        val intent = activity.fileSaver.buildShareIntent(title, text) ?: return false
        return activity.startChooser(intent)
    }

    /** Меню «Поделиться» для текста или ссылки без файлов. */
    @JavascriptInterface
    fun shareText(title: String?, text: String?): Boolean {
        if (!activity.pageTrusted) return false
        if (text.isNullOrEmpty()) return false
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(android.content.Intent.EXTRA_TEXT, text)
            if (!title.isNullOrEmpty()) putExtra(android.content.Intent.EXTRA_SUBJECT, title)
        }
        return activity.startChooser(android.content.Intent.createChooser(send, title ?: ""))
    }

    /** Сбрасывает подготовленные, но не отправленные файлы (например, при ошибке посреди подготовки). */
    @JavascriptInterface
    fun clearStaged() {
        if (!activity.pageTrusted) return
        activity.fileSaver.clearStaged()
    }

    // ===== Шаг 4: полноэкранный режим (замена requestFullscreen) =====

    /** Включает/выключает полноэкранный режим: скрыты строка состояния и системная навигация, показываются свайпом с края. */
    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.applyFullscreen(enabled) }
    }

    /**
     * Режим «клавиатура поверх страницы» (аналог navigator.virtualKeyboard.overlaysContent): true — WebView не сжимается
     * клавиатурой, высота клавиатуры приходит странице через window.__ltOnKeyboard(cssPx); false — WebView сжимается, как раньше.
     */
    @JavascriptInterface
    fun setKeyboardOverlay(enabled: Boolean) {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.applyKeyboardOverlay(enabled) }
    }

    // ===== Шаг 4: приём файлов из «Поделиться» (замена Web Share Target) =====

    /** JSON-массив принятых файлов [{id, name, type, size}]. Повторный вызов тех же файлов не вернёт. */
    @JavascriptInterface
    fun takeSharedFiles(): String {
        if (!activity.pageTrusted) return "[]"
        return SharedInbox.takeJson()
    }

    /** Страница забрала файл (fetch ./__shared/<id>): временная копия удаляется. */
    @JavascriptInterface
    fun releaseSharedFile(id: String?) {
        if (!activity.pageTrusted || id == null) return
        SharedInbox.release(id)
    }

    // ===== Шаг 5: нативные уведомления (работают при закрытом приложении) =====

    /**
     * Состояние уведомлений, JSON: permission (уведомления разрешены), canRequest (можно показать системный запрос,
     * Android 13+), exactAlarm (точные будильники разрешены), batteryIgnored (приложение вне оптимизации батареи),
     * reminders (сколько напоминаний в оболочке), nextAt (ближайшее несработавшее, мс или 0), watching (следим за
     * общими задачами), pollLog (последние проходы опроса), manufacturer, sdk.
     */
    @JavascriptInterface
    fun getNotifyState(): String {
        if (!activity.pageTrusted) return "{}"
        return try {
            val ctx = activity.applicationContext
            val granted = NotifyHelper.enabled(ctx)
            val runtimeGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                androidx.core.content.ContextCompat.checkSelfPermission(
                    ctx, android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            val power = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            var next = 0L
            val reminders = NotifyStore.getReminders(ctx)
            for (r in reminders) {
                if (NotifyStore.firedAt(ctx, r.id) == r.at) continue
                if (next == 0L || r.at < next) next = r.at
            }
            JSONObject()
                .put("permission", granted)
                .put("canRequest", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !runtimeGranted)
                .put("exactAlarm", ReminderScheduler.canScheduleExact(ctx))
                .put("batteryIgnored", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || power.isIgnoringBatteryOptimizations(ctx.packageName))
                .put("reminders", reminders.size)
                .put("nextAt", next)
                .put("watching", NotifyStore.getWatch(ctx) != null)
                .put("pollLog", NotifyStore.pollLog(ctx))
                .put("manufacturer", Build.MANUFACTURER ?: "")
                .put("sdk", Build.VERSION.SDK_INT)
                .toString()
        } catch (e: Exception) {
            "{}"
        }
    }

    /** Системный запрос разрешения на уведомления (Android 13+). Ответ придёт в window.__ltOnNotifyPermission(granted). */
    @JavascriptInterface
    fun requestNotifyPermission() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.requestNotifyPermission() }
    }

    /** Открывает системные настройки уведомлений приложения (если разрешение выключено насовсем). */
    @JavascriptInterface
    fun openNotifySettings() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.openNotifySettings() }
    }

    /** Открывает настройки, где снимается ограничение работы в фоне (оптимизация батареи / автозапуск). */
    @JavascriptInterface
    fun openBackgroundSettings() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.openBackgroundSettings() }
    }

    /**
     * Страница присылает актуальный снимок напоминаний: JSON-массив [{id, at (мс), text}] — только невыполненные
     * задачи, по которым ещё не показывали напоминание. Заменяет прежний список целиком и пересчитывает будильник.
     */
    @JavascriptInterface
    fun setReminders(json: String?): Boolean {
        if (!activity.pageTrusted) return false
        val ctx = activity.applicationContext
        if (!NotifyStore.setReminders(ctx, json)) return false
        ReminderScheduler.scheduleNext(ctx)
        return true
    }

    /** Забирает {id: at} напоминаний, которые оболочка уже показала уведомлением (страница не покажет их повторно). */
    @JavascriptInterface
    fun takeFiredReminders(): String {
        if (!activity.pageTrusted) return "{}"
        return NotifyStore.takeFiredJson(activity.applicationContext)
    }

    /** Забирает очередь действий из уведомлений: [{taskId, action ("done"|"tomorrow"|""), kind, at}]. */
    @JavascriptInterface
    fun takeNotifyActions(): String {
        if (!activity.pageTrusted) return "[]"
        return NotifyStore.takeActionsJson(activity.applicationContext)
    }

    /** Убирает уведомление-напоминание задачи (задача выполнена или срок изменён в приложении). */
    @JavascriptInterface
    fun cancelReminderNotification(taskId: String?) {
        if (!activity.pageTrusted || taskId.isNullOrEmpty()) return
        NotifyHelper.cancelReminder(activity.applicationContext, taskId)
    }

    /** Показывает уведомление о новой общей задаче сейчас (страница получила её при обычной синхронизации). */
    @JavascriptInterface
    fun postGroupTaskNotification(title: String?, body: String?, taskId: String?, many: Boolean): Boolean {
        if (!activity.pageTrusted || taskId.isNullOrEmpty()) return false
        val ctx = activity.applicationContext
        if (!NotifyHelper.enabled(ctx)) return false
        return NotifyHelper.postGroupTask(ctx, title ?: "", body ?: "", taskId, many)
    }

    /**
     * Настройки слежения за общими задачами при закрытом приложении: JSON {groupId, db, deviceId, seenIds:[...],
     * names:{deviceId: имя}} или пустая строка / null (группы нет — слежение выключается).
     */
    @JavascriptInterface
    fun setGroupWatch(json: String?): Boolean {
        if (!activity.pageTrusted) return false
        val ctx = activity.applicationContext
        if (!NotifyStore.setWatch(ctx, json)) return false
        GroupWatcher.scheduleNextPoll(ctx)
        return true
    }

    /** Забирает id общих задач, о которых оболочка уже уведомила (страница добавит их в свой список увиденных). */
    @JavascriptInterface
    fun takeGroupSeen(): String {
        if (!activity.pageTrusted) return "[]"
        return NotifyStore.takeSeenExportJson(activity.applicationContext)
    }

    /** Диагностика: поставить пробное напоминание через N секунд (id diag-test, при следующей синхронизации страницы пропадёт). */
    @JavascriptInterface
    fun scheduleTestReminder(seconds: Int): Boolean {
        if (!activity.pageTrusted) return false
        val ctx = activity.applicationContext
        val at = System.currentTimeMillis() + seconds.coerceIn(5, 3600) * 1000L
        NotifyStore.addReminder(ctx, NotifyStore.Reminder("diag-test", at, "Пробное напоминание"))
        ReminderScheduler.scheduleNext(ctx)
        return true
    }

    /** Диагностика: проверить общие задачи группы прямо сейчас (в фоне); результат виден в pollLog из getNotifyState. */
    @JavascriptInterface
    fun runGroupPollNow(): Boolean {
        if (!activity.pageTrusted) return false
        val ctx = activity.applicationContext
        Thread {
            try {
                GroupWatcher.poll(ctx, true)
            } catch (e: Exception) {
                NotifyStore.logPoll(ctx, "сбой опроса: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
        return true
    }

    /** Кладёт текст в буфер обмена (кнопка «Копировать» в ридере, задачах и заметках). */
    @JavascriptInterface
    fun copyText(text: String?): Boolean {
        if (!activity.pageTrusted || text.isNullOrEmpty()) return false
        var ok = false
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            try {
                val cm = activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("text", text))
                ok = true
            } catch (e: Exception) {
                ok = false
            }
            latch.countDown()
        }
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return ok
    }

    // ===== Ярлык «Создать новую задачу» (QuickTaskActivity) =====

    /**
     * Очередь задач, созданных окном быстрой задачи, JSON-массив [{id, text, createdAt, flag?, work?, remindAt?}].
     * Очередь НЕ очищается: страница создаёт задачи и затем зовёт ackQuickTasks с id сохранённых.
     */
    @JavascriptInterface
    fun takeQuickTasks(): String {
        if (!activity.pageTrusted) return "[]"
        return QuickTaskStore.peekJson(activity.applicationContext)
    }

    /** Страница сохранила задачи из очереди: JSON-массив их id, они удаляются из очереди. */
    @JavascriptInterface
    fun ackQuickTasks(idsJson: String?) {
        if (!activity.pageTrusted) return
        QuickTaskStore.ack(activity.applicationContext, idsJson)
    }

    /** Цвета темы оформления для окна быстрой задачи: JSON {parchment, ink, inkSoft, wood, groove, joy} (CSS-цвета). */
    @JavascriptInterface
    fun setQuickTaskTheme(json: String?) {
        if (!activity.pageTrusted) return
        QuickTaskStore.setThemeJson(activity.applicationContext, json)
    }

    // ---------- таймеры карточек вкладки 9 (CardTimers; ТЗ карточек, шаг 5а) ----------

    /** Запускает (или перезапускает) таймер карточки на seconds секунд: отсчёт в шторке/острове, будильник, вибрация в конце. */
    @JavascriptInterface
    fun startCardTimer(id: String?, title: String?, seconds: Int): Boolean {
        if (!activity.pageTrusted || id == null) return false
        return CardTimers.start(activity.applicationContext, id, title ?: "", seconds.toLong())
    }

    @JavascriptInterface
    fun pauseCardTimer(id: String?) {
        if (!activity.pageTrusted || id == null) return
        CardTimers.pause(activity.applicationContext, id)
    }

    @JavascriptInterface
    fun resumeCardTimer(id: String?) {
        if (!activity.pageTrusted || id == null) return
        CardTimers.resume(activity.applicationContext, id)
    }

    @JavascriptInterface
    fun cancelCardTimer(id: String?) {
        if (!activity.pageTrusted || id == null) return
        CardTimers.cancel(activity.applicationContext, id)
    }

    /** Идущие и приостановленные таймеры: [{id, title, durationMs, running, endAt, remainingMs, now}] (now — часы устройства). */
    @JavascriptInterface
    fun getCardTimers(): String {
        if (!activity.pageTrusted) return "[]"
        return CardTimers.listJson(activity.applicationContext)
    }

    // ---------- ярлык сканера QR-кодов на рабочий стол (ScanShortcut; кнопка в «Дополнительных возможностях») ----------

    /** Просит рабочий стол закрепить ярлык «Сканер QR»: "requested" | "unsupported" | "failed" | "denied". */
    @JavascriptInterface
    fun createScanShortcut(): String {
        if (!activity.pageTrusted) return "denied"
        return ScanShortcut.requestPin(activity)
    }

    /** Открывает разрешения приложения (у Xiaomi — «Ярлыки на рабочем столе» в редакторе разрешений MIUI/HyperOS). */
    @JavascriptInterface
    fun openShortcutPermissionSettings(): Boolean {
        if (!activity.pageTrusted) return false
        return ScanShortcut.openPermissionSettings(activity)
    }

    // ---------- вкладка Claude (ClaudeTab; set2s_10) ----------

    /** Показывает WebView claude.ai в прямоугольнике (CSS-пиксели страницы приложения). */
    @JavascriptInterface
    fun claudeShow(x: Double, y: Double, w: Double, h: Double): Boolean {
        if (!activity.pageTrusted) return false
        activity.runOnUiThread { activity.claudeTab.show(x, y, w, h) }
        return true
    }

    /** Прячет WebView claude.ai (страница в нём продолжает жить — автоотправка работает). */
    @JavascriptInterface
    fun claudeHide() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.claudeTab.hide() }
    }

    @JavascriptInterface
    fun claudeReload() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.claudeTab.reload() }
    }

    /** Автоотправка: включена ли и какой текст слать после снятия лимита. */
    @JavascriptInterface
    fun claudeSetAuto(enabled: Boolean, text: String?) {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.claudeTab.setAuto(enabled, text) }
    }

    /** JSON: {"created":bool,"auto":bool,"text":"...","status":{...}} — статус читается из страницы раз в несколько секунд. */
    @JavascriptInterface
    fun claudeGetState(): String {
        if (!activity.pageTrusted) return "{}"
        return try { activity.claudeTab.stateJson() } catch (e: Exception) { "{}" }
    }

    /** Ручной таймер: отправить через N минут (запасной путь, если плашку лимита не удалось распознать). */
    @JavascriptInterface
    fun claudeArm(minutes: Int) {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.claudeTab.armTimer(minutes) }
    }

    @JavascriptInterface
    fun claudeDisarm() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.claudeTab.disarm() }
    }

    /** Проверка: отправить текст в чат прямо сейчас. */
    @JavascriptInterface
    fun claudeSendNow() {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.claudeTab.sendNow() }
    }

    /** Цвет статус-бара: "#rrggbb", "#rgb" или "rgb(r, g, b)". Значок светлый/тёмный выбирается по яркости цвета. */
    @JavascriptInterface
    fun setStatusBarColor(color: String?) {
        if (!activity.pageTrusted) return
        val parsed = parseCssColor(color) ?: return
        activity.runOnUiThread { activity.applyStatusBarColor(parsed) }
    }

    private fun parseCssColor(source: String?): Int? {
        val value = source?.trim() ?: return null
        if (value.isEmpty()) return null

        val rgb = Regex("""rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})""").find(value)
        if (rgb != null) {
            val (r, g, b) = rgb.destructured
            return Color.rgb(r.toInt().coerceIn(0, 255), g.toInt().coerceIn(0, 255), b.toInt().coerceIn(0, 255))
        }

        var hex = value
        if (Regex("^#[0-9a-fA-F]{3}$").matches(hex)) {
            hex = "#" + hex.substring(1).map { "$it$it" }.joinToString("")
        }
        return try {
            Color.parseColor(hex) or 0xFF000000.toInt()
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
