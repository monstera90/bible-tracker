package com.app.lifetracker
// Версия: 2.1 (28.11) — обычная задача тоже получает плашку агента в острове (один шаг «Claude думает», затем галочка). Откат: ClaudeTabs.kt 2.0.
// Версия: 2.0 (28.11)
// Версия: 1.5 (28.11) — [sendTask] с plain = true («Обычная задача»): архив репозитория не скачивается, плашка агента не заводится, в чат уходят только текст и картинки. Откат: ClaudeTabs.kt 1.4.
// Версия: 1.4 (27.11) — [sendTask]: задача, которая уже отправляется (тот же id), второй раз не принимается (ClaudeTaskResults.begin). Откат: ClaudeTabs.kt 1.3.
// Версия: 1.3 (25.11) — [sendTask] принимает картинки задачи ([imagesJson]): они сохраняются в кэш ([ClaudeTaskImages]) и уходят в чат вместе с архивом. Откат: ClaudeTabs.kt 1.2.
// Версия: 1.2 (25.11) — `numberOf` (номер вкладки = номер агента) и запуск плашки агента в острове при отправке задачи (AgentRuns.start). Откат: ClaudeTabs.kt 1.1.
// Версия: 1.1 (24.11) — [sendTask]: задача из сундучка уходит в НОВЫЙ диалог указанной вкладки, не меняя текущую вкладку (скачивание архива в фоне — ClaudeTask.kt, отправка — ClaudeTab.enqueueTask). Откат: ClaudeTabs.kt 1.0.
// Версия: 1.0 (24.11) — несколько вкладок Claude: диспетчер экземпляров [ClaudeTab]. Вкладка «main» — прежняя (общий вход приложения), остальные создаются кнопкой «+» ряда внутри вкладки Claude (claudetab.js), каждая со своим входом (профиль WebView). Методы повторяют [ClaudeTab]: вызовы моста claude* и MainActivity идут к ТЕКУЩЕЙ вкладке ([select]).

import android.content.Context
import android.widget.FrameLayout
import java.io.File

class ClaudeTabs(private val activity: MainActivity, private val host: FrameLayout) {

    companion object {
        private const val PREFS = "claude_tabs"
        private const val KEY_IDS = "ids"
        private val ID_RE = Regex("^[a-z0-9]{1,24}$")
        private val REQ_RE = Regex("^[A-Za-z0-9]{1,64}$")
        private const val MAX_TASK_CHARS = 100_000
        @Volatile private var inst: ClaudeTabs? = null

        /** Круг с треугольником в острове: отправить «Далее» в чат агента (вкладки Claude) [tabId]. Звать из любого потока. */
        fun continueAgent(tabId: String) { inst?.continueTask(tabId) }

        /** Номер вкладки Claude в её ряду (1 — «main», дальше по порядку создания) — это и есть «номер агента» в острове. */
        fun numberOf(ctx: Context, id: String): Int {
            if (id == ClaudeTab.MAIN_ID) return 1
            val ids = (ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_IDS, "") ?: "")
                .split(",").map { it.trim() }.filter { ID_RE.matches(it) }.distinct()
            val i = ids.indexOf(id)
            return if (i < 0) 1 else i + 2
        }
    }

    private val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val tabs = LinkedHashMap<String, ClaudeTab>()
    @Volatile private var curId = ClaudeTab.MAIN_ID
    private var kb = 0
    private var holesSpec: String? = null

    init {
        tabs[ClaudeTab.MAIN_ID] = ClaudeTab(activity, host, ClaudeTab.MAIN_ID)
        inst = this
    }

    /** Отправить «Далее» в текущий чат вкладки [id]; плашка агента снова «идёт», когда отправка удалась. */
    fun continueTask(id: String) {
        val tab = synchronized(this) { tabs[id] } ?: return
        activity.runOnUiThread { tab.continueTask() }
    }

    @Synchronized private fun cur(): ClaudeTab = tabs[curId] ?: tabs.getValue(ClaudeTab.MAIN_ID)

    @Synchronized private fun savedIds(): List<String> =
        (prefs.getString(KEY_IDS, "") ?: "").split(",").map { it.trim() }.filter { ID_RE.matches(it) }.distinct()

    @Synchronized private fun saveIds(ids: List<String>) {
        prefs.edit().putString(KEY_IDS, ids.joinToString(",")).apply()
    }

    @Synchronized private fun obtain(id: String): ClaudeTab? {
        tabs[id]?.let { return it }
        if (id == ClaudeTab.MAIN_ID || !ID_RE.matches(id)) return null
        val t = ClaudeTab(activity, host, id)
        if (kb > 0) t.setKeyboardInset(kb)
        holesSpec?.let { t.setHoles(it) }
        tabs[id] = t
        return t
    }

    /** Отдельный вход на вкладку возможен (WebView с профилями). Иначе «+» новых вкладок не создаёт. */
    fun supported(): Boolean = ClaudeTab.profilesSupported()

    /** Сделать вкладку [id] текущей (создаётся при первом обращении). Прежняя текущая прячется. */
    @Synchronized fun select(id: String?): Boolean {
        val want = (id ?: ClaudeTab.MAIN_ID).ifEmpty { ClaudeTab.MAIN_ID }
        if (want != ClaudeTab.MAIN_ID && !supported()) return false
        val t = obtain(want) ?: return false
        val prev = cur()
        curId = want
        // Выбор вступает в силу сразу (страница тут же читает claudeGetState), прятать прежнюю вкладку — в потоке интерфейса, до следующего claudeShow.
        if (prev !== t) activity.runOnUiThread { prev.hide() }
        if (want != ClaudeTab.MAIN_ID) {
            val ids = savedIds()
            if (want !in ids) saveIds(ids + want)
        }
        return true
    }

    /**
     * Сундучок у задачи: в фоне скачать свежий архив репозитория и отправить его вместе с текстом [text] в новый диалог вкладки [id]
     * (текущая вкладка не меняется). true — задача принята; итог (успех/причина сбоя) страница забирает через [ClaudeTaskResults] по [reqId].
     */
    fun sendTask(id: String?, reqId: String?, text: String?, imagesJson: String? = null, plain: Boolean = false): Boolean {
        val rid = reqId ?: return false
        if (!REQ_RE.matches(rid)) return false
        val body = (text ?: "").trim().take(MAX_TASK_CHARS)
        if (body.isEmpty()) return false
        val want = (id ?: ClaudeTab.MAIN_ID).ifEmpty { ClaudeTab.MAIN_ID }
        val tab: ClaudeTab = synchronized(this) {
            if (want != ClaudeTab.MAIN_ID && (!supported() || want !in savedIds())) return false
            obtain(want) ?: return false
        }
        if (!ClaudeTaskResults.begin(rid)) return true // эта задача уже отправляется: вторую отправку не ставим
        AgentRuns.start(want, rid, plain = plain) // плашка агента в острове: шаг 1; у обычной задачи один шаг — «Claude думает», потом галочка
        InAppIsland.ensureBackground(activity)
        Thread {
            try {
                val images = try {
                    ClaudeTaskImages.save(activity.cacheDir, rid, imagesJson)
                } catch (e: Exception) {
                    ClaudeTaskResults.add(rid, false, "не удалось принять картинки задачи: " + (e.message ?: "ошибка"))
                    return@Thread
                }
                val zip: File? = if (plain) null else try {
                    ClaudeTaskZip.download(activity.cacheDir, rid)
                } catch (e: Exception) {
                    images.forEach { try { it.file.delete() } catch (x: Exception) { } }
                    ClaudeTaskResults.add(rid, false, "не удалось скачать репозиторий: " + (e.message ?: "нет сети"))
                    return@Thread
                }
                activity.runOnUiThread { tab.enqueueTask(rid, body, zip, images, plain) }
            } catch (e: Exception) {
                ClaudeTaskResults.add(rid, false, "не удалось отправить: " + (e.message ?: "ошибка"))
            }
        }.start()
        return true
    }

    /** Закрыть вкладку насовсем вместе с её входом. «main» удалить нельзя. */
    @Synchronized fun remove(id: String?) {
        val rid = id ?: return
        if (rid == ClaudeTab.MAIN_ID || !ID_RE.matches(rid)) return
        val t = tabs.remove(rid) ?: ClaudeTab(activity, host, rid)
        t.hide()
        t.purge()
        saveIds(savedIds().filter { it != rid })
        if (curId == rid) curId = ClaudeTab.MAIN_ID
    }

    val isVisible: Boolean get() = synchronized(this) { tabs.values.any { it.isVisible } }

    @Synchronized fun canGoBack(): Boolean = tabs.values.firstOrNull { it.isVisible }?.canGoBack() == true
    @Synchronized fun goBack() { tabs.values.firstOrNull { it.isVisible }?.goBack() }

    /** При запуске: вкладки с включённым «Авто» поднимаются в фоне и без захода на вкладку. */
    @Synchronized fun startIfEnabled() {
        tabs.getValue(ClaudeTab.MAIN_ID).startIfEnabled()
        if (!supported()) return
        for (id in savedIds()) obtain(id)?.startIfEnabled()
    }

    @Synchronized fun show(x: Double, y: Double, w: Double, h: Double) { cur().show(x, y, w, h) }

    @Synchronized fun setKeyboardInset(px: Int) {
        kb = px
        tabs.values.forEach { it.setKeyboardInset(px) }
    }

    @Synchronized fun setHoles(spec: String?) {
        holesSpec = spec
        tabs.values.forEach { it.setHoles(spec) }
    }

    @Synchronized fun hide() { tabs.values.forEach { it.hide() } }
    @Synchronized fun reload() { cur().reload() }
    @Synchronized fun goHome() { cur().goHome() }
    @Synchronized fun setAuto(enabled: Boolean, text: String?) { cur().setAuto(enabled, text) }
    @Synchronized fun armTimer(minutes: Int) { cur().armTimer(minutes) }
    @Synchronized fun disarm() { cur().disarm() }
    @Synchronized fun sendNow() { cur().sendNow() }
    @Synchronized fun stateJson(): String = cur().stateJson()
    @Synchronized fun pause() { tabs.values.forEach { it.pause() } }
    @Synchronized fun destroy() { tabs.values.forEach { it.destroy() } }
}
