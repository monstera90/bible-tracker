package com.app.lifetracker
// Версия: 1.1 (14.10) — размеры кнопок как в строке задачи приложения (кнопка 22, пиктограмма 15, кружки 19, промежуток 6 dp) × множитель `sc` из QuickTaskStore.iconScale.

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.text.format.DateFormat
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.Calendar

/**
 * Ярлык «Создать новую задачу» (долгое нажатие на иконку приложения): маленькое окно над клавиатурой в стиле строки
 * задачи, БЕЗ запуска основного приложения (свой task, прозрачная тема, см. AndroidManifest). Кнопки те же, что у
 * задачи: ✕ — отмена, копировать, кружок приоритета (тап: красный → жёлтый → красный, долгое нажатие — снять),
 * чемоданчик «в работе» (тап: в работе → нужно проверить → в работе, долгое нажатие — снять), часы-напоминание
 * (первый тап: «сегодня + 30 минут», следующий — выбор даты и времени, долгое нажатие — снять); ✓ (или «Готово» на
 * клавиатуре) — сохранить. Задача уходит в очередь QuickTaskStore; страница кладёт её в Inbox при следующем открытии
 * приложения. Напоминание срабатывает и без открытия приложения (ReminderScheduler).
 */
class QuickTaskActivity : ComponentActivity() {

    private lateinit var pal: QuickTaskStore.Palette
    private lateinit var root: FrameLayout
    private lateinit var card: LinearLayout
    private lateinit var edit: EditText
    private lateinit var flagDot: View
    private lateinit var workCircle: View
    private lateinit var workIcon: ImageView
    private lateinit var clockHolder: LinearLayout

    /** Множитель размера значков (QuickTaskStore.iconScale): ползунок в нижнем ряду задач веб-части. */
    private var sc = 1f

    private var flag: String? = null
    private var work: String? = null
    private var remindAt: Long = 0L

    /** true — задача сохранена или отменена: черновик не нужен. */
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pal = QuickTaskStore.palette(applicationContext)
        sc = QuickTaskStore.iconScale(applicationContext)

        // Android 11+: окно рисуется под системными панелями, высоту клавиатуры учитываем сами (см. listener ниже).
        // До Android 11 клавиатуру обрабатывает системный adjustResize.
        val handleInsets = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        if (handleInsets) WindowCompat.setDecorFitsSystemWindows(window, false)

        buildLayout()
        setContentView(root)
        if (handleInsets) {
            ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
                WindowInsetsCompat.CONSUMED
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                cancel()
            }
        })

        restoreDraft()
        updateFlag()
        updateWork()
        updateClock()
        edit.requestFocus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Ярлык нажат повторно, пока окно открыто: просто возвращаем фокус полю.
        edit.requestFocus()
        showKeyboardSoon()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) showKeyboardSoon()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        card.layoutParams = cardParams()
    }

    override fun onStop() {
        super.onStop()
        // Окно ушло с экрана (кнопка «Домой», входящий звонок): текст не теряем — сохраняем черновик и закрываемся,
        // чтобы в системе не оставалось невидимого окна. Следующее открытие ярлыка вернёт черновик (30 минут).
        if (!finished && !isFinishing && !isChangingConfigurations) {
            QuickTaskStore.saveDraft(applicationContext, edit.text.toString(), flag, work, remindAt)
            finished = true
            finishAndRemoveTask()
        }
    }

    // ------------------------------------------------------------------ разметка

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

    /** dp с учётом множителя значков: при 1.0 — те же размеры, что у кнопок строки задачи в приложении (CSS px = dp). */
    private fun sdp(v: Float): Int = maxOf(1, (v * sc * resources.displayMetrics.density + 0.5f).toInt())

    /** Промежуток между кнопками строки задачи (margin-left 6px в modals.css) — от множителя не зависит. */
    private fun gapParams(w: Int, h: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h).apply { leftMargin = dp(6) }

    private fun cardParams(): FrameLayout.LayoutParams {
        val width = minOf(resources.displayMetrics.widthPixels, dp(560))
        return FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
    }

    private fun buildLayout() {
        root = FrameLayout(this)
        root.setBackgroundColor(0x66000000)
        root.isClickable = true
        // Тап по затемнению закрывает окно, только если ничего не введено (чтобы случайно не потерять текст).
        root.setOnClickListener {
            if (edit.text.isBlank()) cancel()
        }

        card = LinearLayout(this)
        card.orientation = LinearLayout.VERTICAL
        val r = dp(18).toFloat()
        card.background = GradientDrawable().apply {
            setColor(pal.card)
            cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            setStroke(dp(1), pal.groove)
        }
        card.setPadding(dp(14), dp(12), dp(8), dp(6))
        card.isClickable = true // тап по самому окну не должен доходить до затемнения
        root.addView(card, cardParams())

        edit = EditText(this).apply {
            hint = "Новая задача"
            setHintTextColor(Color.argb(150, Color.red(pal.inkSoft), Color.green(pal.inkSoft), Color.blue(pal.inkSoft)))
            setTextColor(pal.ink)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            background = null
            setPadding(dp(2), dp(4), dp(6), dp(8))
            gravity = Gravity.TOP or Gravity.START
            minLines = 2
            maxLines = 6
            setHorizontallyScrolling(false)
            // «Готово» на клавиатуре сохраняет задачу; длинный текст переносится по строкам.
            setRawInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
            imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    save()
                    true
                } else {
                    false
                }
            }
        }
        card.addView(edit, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        card.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        // ✕ — отмена (слева), дальше — кнопки задачи в том же порядке, что в строке: копировать, приоритет, чемоданчик, часы.
        row.addView(iconButton(R.drawable.ic_qt_close, "Отмена", false) { cancel() })
        row.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        row.addView(iconButton(R.drawable.ic_qt_copy, "Копировать", true) { copyText() })
        row.addView(buildFlagButton())
        row.addView(buildWorkButton())
        clockHolder = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            minimumWidth = sdp(22f)
            background = selectable()
            contentDescription = "Напоминание"
            setOnClickListener { onClockTap() }
            setOnLongClickListener {
                remindAt = 0L
                updateClock()
                true
            }
        }
        row.addView(clockHolder, gapParams(ViewGroup.LayoutParams.WRAP_CONTENT, sdp(22f)))
        row.addView(iconButton(R.drawable.ic_qt_check, "Сохранить", true) { save() })
    }

    private fun selectable(): android.graphics.drawable.Drawable? {
        val tv = TypedValue()
        return if (theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true) && tv.resourceId != 0) {
            ContextCompat.getDrawable(this, tv.resourceId)
        } else {
            null
        }
    }

    /** Кнопка 22 (область нажатия) с пиктограммой 15 внутри — как `.task-icon-btn` в приложении; gap — отступ слева 6. */
    private fun iconButton(res: Int, desc: String, gap: Boolean, onClick: () -> Unit): ImageView {
        val box = sdp(22f)
        val pad = maxOf(0, (box - sdp(15f)) / 2)
        return ImageView(this).apply {
            setImageResource(res)
            setColorFilter(pal.accent)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(pad, pad, pad, pad)
            contentDescription = desc
            background = selectable()
            layoutParams = if (gap) gapParams(box, box) else LinearLayout.LayoutParams(box, box)
            setOnClickListener { onClick() }
        }
    }

    private fun buildFlagButton(): View {
        val holder = FrameLayout(this)
        holder.background = selectable()
        holder.contentDescription = "Приоритет"
        flagDot = View(this)
        holder.addView(flagDot, FrameLayout.LayoutParams(sdp(12f), sdp(12f), Gravity.CENTER))
        holder.layoutParams = gapParams(sdp(22f), sdp(22f))
        holder.setOnClickListener {
            flag = if (flag == "red") "yellow" else "red"
            updateFlag()
        }
        holder.setOnLongClickListener {
            flag = null
            updateFlag()
            true
        }
        return holder
    }

    private fun buildWorkButton(): View {
        val holder = FrameLayout(this)
        holder.background = selectable()
        holder.contentDescription = "В работе"
        workCircle = View(this)
        holder.addView(workCircle, FrameLayout.LayoutParams(sdp(19f), sdp(19f), Gravity.CENTER))
        workIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_qt_work)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        holder.addView(workIcon, FrameLayout.LayoutParams(sdp(15f), sdp(15f), Gravity.CENTER))
        holder.layoutParams = gapParams(sdp(22f), sdp(22f))
        holder.setOnClickListener {
            work = if (work == null) "work" else if (work == "work") "check" else "work"
            updateWork()
        }
        holder.setOnLongClickListener {
            work = null
            updateWork()
            true
        }
        return holder
    }

    // ------------------------------------------------------------------ состояния кнопок

    private fun updateFlag() {
        val d = GradientDrawable()
        d.shape = GradientDrawable.OVAL
        val size: Int
        if (flag == null) {
            d.setColor(Color.TRANSPARENT)
            d.setStroke(dp(1), pal.groove)
            size = sdp(12f)
        } else {
            d.setColor(if (flag == "red") pal.accent else pal.yellow)
            size = sdp(19f)
        }
        flagDot.background = d
        flagDot.layoutParams = FrameLayout.LayoutParams(size, size, Gravity.CENTER)
    }

    private fun updateWork() {
        val d = GradientDrawable()
        d.shape = GradientDrawable.OVAL
        when (work) {
            "work" -> {
                d.setColor(pal.accent)
                workIcon.setColorFilter(pal.card)
            }
            "check" -> {
                d.setColor(Color.TRANSPARENT)
                d.setStroke(dp(1) + 1, pal.accent)
                workIcon.setColorFilter(pal.accent)
            }
            else -> {
                d.setColor(Color.TRANSPARENT)
                workIcon.setColorFilter(pal.accent)
            }
        }
        workCircle.background = d
    }

    /** Шрифт и размер надписи на кружке с числом/овале со временем: 10 px жирным, как `.rb-date`/`.rb-time` в приложении. */
    private val pillTypeface: Typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
    private fun pillTextPx(): Float = 10f * sc * resources.displayMetrics.density

    /** Ширина пилюли: круг с числом — 19, овал со временем — «5ch + 8px» (пять нулей этого шрифта плюс 8), как в приложении. */
    private fun pillWidth(round: Boolean): Int {
        if (round) return sdp(19f)
        val paint = android.graphics.Paint().apply {
            typeface = pillTypeface
            textSize = pillTextPx()
        }
        return (5f * paint.measureText("0")).toInt() + dp(8)
    }

    private fun pill(text: String, round: Boolean): TextView {
        val h = sdp(19f)
        return TextView(this).apply {
            this.text = text
            setTextColor(pal.card)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, pillTextPx())
            typeface = pillTypeface
            gravity = Gravity.CENTER
            includeFontPadding = false
            maxLines = 1
            background = GradientDrawable().apply {
                setColor(pal.accent)
                cornerRadius = h / 2f
            }
        }
    }

    private fun updateClock() {
        clockHolder.removeAllViews()
        if (remindAt <= 0L) {
            val icon = ImageView(this).apply {
                setImageResource(R.drawable.ic_qt_clock)
                setColorFilter(pal.accent)
                scaleType = ImageView.ScaleType.FIT_CENTER
            }
            clockHolder.addView(icon, LinearLayout.LayoutParams(sdp(15f), sdp(15f)))
            return
        }
        val at = Calendar.getInstance().apply { timeInMillis = remindAt }
        val now = Calendar.getInstance()
        val sameDay = at.get(Calendar.YEAR) == now.get(Calendar.YEAR) && at.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR)
        if (!sameDay) {
            // Другой день: кружок с числом слева от времени (как в строке задачи).
            val date = pill(at.get(Calendar.DAY_OF_MONTH).toString(), true)
            clockHolder.addView(date, LinearLayout.LayoutParams(pillWidth(true), sdp(19f)).apply { rightMargin = dp(4) })
        }
        val time = pill(String.format("%d:%02d", at.get(Calendar.HOUR_OF_DAY), at.get(Calendar.MINUTE)), false)
        clockHolder.addView(time, LinearLayout.LayoutParams(pillWidth(false), sdp(19f)))
    }

    // ------------------------------------------------------------------ действия

    private fun onClockTap() {
        if (remindAt <= 0L) {
            // Первый тап — «сегодня + 30 минут», как в приложении.
            remindAt = ((System.currentTimeMillis() + 30L * 60 * 1000) / 60000L) * 60000L
            updateClock()
            return
        }
        val cal = Calendar.getInstance().apply { timeInMillis = remindAt }
        val dateDialog = DatePickerDialog(
            this,
            { _, y, m, d ->
                val picked = Calendar.getInstance().apply { timeInMillis = remindAt }
                picked.set(y, m, d)
                TimePickerDialog(
                    this,
                    { _, h, min ->
                        picked.set(Calendar.HOUR_OF_DAY, h)
                        picked.set(Calendar.MINUTE, min)
                        picked.set(Calendar.SECOND, 0)
                        picked.set(Calendar.MILLISECOND, 0)
                        if (picked.timeInMillis <= System.currentTimeMillis()) {
                            toast("Это время уже прошло")
                        } else {
                            remindAt = picked.timeInMillis
                            updateClock()
                        }
                    },
                    cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), DateFormat.is24HourFormat(this)
                ).show()
            },
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)
        )
        dateDialog.datePicker.minDate = System.currentTimeMillis() - 1000
        dateDialog.show()
    }

    private fun copyText() {
        val text = edit.text.toString().trim()
        if (text.isEmpty()) {
            toast("Нечего копировать")
            return
        }
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("task", text))
            toast("Скопировано")
        } catch (e: Exception) {
            toast("Не удалось скопировать")
        }
    }

    private fun save() {
        if (finished) return
        val text = edit.text.toString().trim()
        if (text.isEmpty()) {
            toast("Введите текст задачи")
            return
        }
        val ctx = applicationContext
        val id = QuickTaskStore.newTaskId()
        QuickTaskStore.add(ctx, id, text, flag, work, remindAt)
        if (remindAt > System.currentTimeMillis()) {
            // Напоминание должно сработать и пока приложение закрыто: ставим его в нативный список сразу.
            // Страница позже пришлёт полный снимок (уже с этой задачей), id совпадает.
            try {
                NotifyStore.addReminder(ctx, NotifyStore.Reminder(id, remindAt, text.replace(Regex("\\s+"), " ")))
                ReminderScheduler.scheduleNext(ctx)
            } catch (e: Exception) {
                // задача всё равно сохранена; напоминание поставит страница при открытии
            }
        }
        finished = true
        QuickTaskStore.clearDraft(ctx)
        Toast.makeText(ctx, "Задача добавлена в Inbox", Toast.LENGTH_SHORT).show()
        finishAndRemoveTask()
    }

    private fun cancel() {
        if (finished) return
        finished = true
        QuickTaskStore.clearDraft(applicationContext)
        finishAndRemoveTask()
    }

    private fun restoreDraft() {
        val d = QuickTaskStore.takeDraft(applicationContext) ?: return
        edit.setText(d.text)
        edit.setSelection(edit.text.length)
        flag = d.flag
        work = d.work
        remindAt = if (d.remindAt > System.currentTimeMillis()) d.remindAt else 0L
    }

    private fun toast(text: String) {
        Toast.makeText(applicationContext, text, Toast.LENGTH_SHORT).show()
    }

    /** Клавиатура открывается сама: через контроллер окна (Android 11+) и через InputMethodManager (старые версии). */
    private fun showKeyboardSoon() {
        edit.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            edit.requestFocus()
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsControllerCompat(window, edit).show(WindowInsetsCompat.Type.ime())
                } else {
                    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                    imm.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
                }
            } catch (e: Exception) {
                // клавиатуру можно открыть тапом по полю
            }
        }, 150)
    }
}
