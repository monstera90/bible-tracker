package com.app.lifetracker
// Версия: 16.1 (17.11) — таймер в виджете больше не отстаёт после блокировки телефона: пока экран погашен, обработчик минутной перерисовки ([armCycle]) стоит на часах uptime, которые во сне не идут, и ничего не рисует; после разблокировки кольцо показывало старое число до ближайшего срока. Теперь включение экрана и разблокировка ([onScreenOn], [onUserPresent]) сразу перерисовывают виджеты с таймерами ([refreshTimerFaces]) и заново взводят точный срок по настенным часам. Откат: QrWidgets.kt 16.0.
// Версия: 16.0 (17.11) — единый диспетчер движения стопки (ТЗ TZ_motion_dispatcher.md, [QrPriority.Motion]): слайд-шоу, круг равных/смена верха и возврат наверх больше не двигают стопку сами, а проходят через одно решение ([motionDecide]) — пока пользователь работает с карточками (нажатие: 60 с, смахивание: 120 с после последнего касания, каждое новое касание обнуляет срок), стопка стоит на месте, а порядок карточек замораживается ([order] + [freeze]), так что под рукой ничего не меняется; отложенное движение исполняется по сроку или при включении экрана. Действия самого пользователя (двойное нажатие, край группы, настройка виджета) и постановка виджета паузу обходят. Откат: QrWidgets.kt 15.3.
// Версия: 15.3 (17.11) — нажатие у края карточки-группы («Привычки», «Будильники», «Таймеры»; [groupNav]) пересоздаёт адаптер стопки и закрепляет её на этой же карточке ([pinSlot]), а не только перезагружает данные: после листания привычек (2-я, 3-я) обратное смахивание к календарю оставляло StackView сдвинутым (карточка «Будильник» съезжала). Откат: QrWidgets.kt 15.2.
// Версия: 15.2 (16.11) — скрытые таймеры в карточке «Таймеры» виджета: `Card.hid` (поле `hidden` в `tmr`), нажатие на не запущенный скрытый таймер запускает его скрытым (`CardTimers.start(..., hidden)`). Откат: QrWidgets.kt 15.1.
// Версия: 15.1 (16.11) — число минут в кольце таймера («Таймеры») меняется ровно в момент, когда остаток доходит до круглой минуты (23 → 22 в 22:00), а не по границе календарной минуты: `nextTimerFlip` в `armCycle`. Откат: QrWidgets.kt 15.0.
// Версия: 15.0 (16.11) — принцип «после действия на карточке не бросать стопку в начало»: двойное нажатие на привычку, отметка задачи и заведение/выключение будильника оставляют виджет на той же карточке (привычки, задачи, будильники), если она в стопке осталась — на ней ещё есть что делать ([pinSlot], [slotOf], [slotPosition]; [update] при пересоздании стопки ставит её на закреплённую карточку, а не на первую); карточка пропала совсем (отмечена последняя привычка) — как раньше, первая. Сброс наверх после такого действия ([refreshAll] с `rebuildCfgs`) касается только затронутого виджета: стопки остальных не двигаются. Галочка «Показывать мероприятия на N дней вперёд» (`eventsSoon` + число `eventsDays`, 1…15; раньше — «только на сегодня и на завтра»): окно карточки события — N суток от начала сегодняшнего дня; картинка карточки на дату через семь суток и дальше — `<ключ>_d.png` («25 ноября, Среда»), [dynBitmap]. Откат: QrWidgets.kt 14.14.
// Версия: 14.16 (16.11) — `startTimer`: нажатие на не запущенный таймер в карточке «Таймеры» виджета запускает его сразу в оболочке, без окна с карточкой на весь экран; запуск ставится в очередь `timerEv` для журнала событий (`takeTimerEvents` / `ackTimerEvents`, мост ≥ 39). Откат: QrWidgets.kt 14.15.
// Версия: 14.15 (16.11) — `stopTimer`: повторное нажатие на идущий (или приостановленный) таймер в карточке «Таймеры» виджета останавливает его (раньше ничего не делало). Откат: QrWidgets.kt 14.14.
// Версия: 14.14 (15.11) — галочка «Отображать таймеры» (`timers`, список `tmr`): карточка-группа «Таймеры» ([QrPriority.TIMER_SLOT_KEY]) со всеми таймерами карточек QR-кодов, лицо рисует [QrTimerFace] (зелёная карточка, кольцо и минуты), кольцо перерисовывается раз в минуту, пока идёт таймер ([QrPriority.Result.minuteAt], [armCycle]). Идущий таймер — выше всего, в том числе выше «Как тренировка?» и календаря, при любом режиме ([QrPriority.SCORE_TIMER_ACTIVE]); у таймера может быть своё время суток (`times` в `tmr`) — тогда в это время он поднимается выше календаря и привычек ([QrPriority.SCORE_TIMER_DUE]). Края листают таймеры, нажатие в центре запускает показанный (идущий — не трогает). Откат: QrWidgets.kt 14.13.
// Версия: 14.13 (15.11) — слайд-шоу не листает стопку, пока пользователь её трогал меньше [TOUCH_PAUSE_MS] (30 с) назад: смахивание ([onPossibleSwipe]) и любое нажатие на карточку виджета (ScanActivity → [noteTouch]) запоминаются; пришёл срок [rotate] — переносится на 30 с после последнего касания. Откат: QrWidgets.kt 14.12.
// Версия: 14.12 (15.11) — единая модель круга равных и карточек-групп (QrPriority 4.9): «Привычки» и «Будильники» — одна карточка-группа каждая (ключи «hab_0» / «alm_0»), элемент на ней выбирает круг равных ([QrPriority.Result.faces]) или нажатие у края (на [EVENT_RESET_MS], одинаково для всех групп — [GroupView], [groupViews], [groupNav]; хранится в [K_HABIDX]). Минутная смена элемента меняет только лицо карточки, адаптер стопки не пересоздаётся. Объяснение «Сейчас сверху» называет показанный элемент группы ([whyOf]).
// Версия: 14.11 (15.11) — карточка «Привычки» в стопке одна (QrPriority 4.8): привычки «в своё время» сменяют друг друга на ней по кругу, а не лежат отдельными карточками; свайп листает группы, привычки листаются нажатием у края ([habitNav]). Выбор нажатием держится [EVENT_RESET_MS] (60 с) после последнего нажатия.
// Версия: 14.10 (15.11) — круг равных ([QrPriority.cycleOrder]): привычки «в своё время» и календарь встают наверх по очереди, каждая на минуту; минутный обработчик [armCycle] перерисовывает виджет, пока экран включён. Страховка возврата стала точной: [GUARD_MS] = 60 с (было 75), проверка каждые [GUARD_TICK_MS] (15 с), а не раз в 75 с; при погашенном экране настройки виджетов не читаются.
// Версия: 14.9 (15.11) — галочка «Показывать только мероприятия на сегодня и на завтра» (`eventsSoon`, под «Показывать события календаря», по умолчанию выключена): окно карточки события — сегодня и завтра вместо [QrPriority.DYN_DAYS] суток; нет событий в окне — карточки календаря в стопке нет ([QrPriority.eventCards]).
// Версия: 14.8 (15.11) — убран вертикальный столбец белых кружков слева/справа от виджета (индикатор положения в стопке `qr_dots`): больше не рисуется и не показывается при смахивании и слайд-шоу.
// Версия: 14.7 (15.11) — галочка «Отображать карточки привычек» (`habits`, список `hab`): привычки «в своё время» встают в круг наравне с календарём, остальные листаются у краёв ([habitNav]), двойное нажатие отмечает привычку и убирает только её.
// Версия: 14.6 (15.11)
// Версия: 14.5 (14.11) — заряд наушников в карточке «Заряд» появляется сразу после подключения: первая проверка без паузы и частые проверки первых секунд ([BT_FAST_AT]), а не через 6 с по неточному будильнику.
// Версия: 14.4 (14.11) — цвет карточек «Как тренировка?» и «Как настроение?» задаёт палитра формы виджета (`rpeColor`, `moodColor` → [Cfg]).
// Версия: 14.3 (14.11) — галочка «Спрашивать о настроении» (`moodAsk`): служебная карточка «Как настроение?» ([QrMood]) — по правилам «Как тренировка?»: над всеми обычными карточками, под «Как тренировка?»; появляется в 20:30, если настроение сегодня не отмечено ([nextDynChange], [onMoodChanged]).
// Версия: 14.2 (14.11) — слайд-шоу листает стопку через showPrevious: позиции стопки теперь идут в обратном порядке ([QrWidgetService]), иначе оно шло бы по карточкам назад.
// Версия: 14.1 (14.11) — галочка «Показывать будильники» (`alarms`, список `alm`): одна карточка со всеми будильниками, листается у краёв ([alarmNav]).
// Версия: 14.0 (14.11)

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Collections
import java.util.UUID

/**
 * Виджеты рабочего стола «Стопка QR-карточек» 2×2 (вкладка «Конструктор виджетов»).
 *
 * Страница (widgets.js, мост ≥31 `widgetsSync`) присылает JSON: виджеты, их карточки (код QR, название, признаки «идёт ли сейчас»,
 * время суток и дни недели) и готовые картинки лиц карточек (PNG, один на карточку, `images`). Картинки лежат в `files/qrwidgets/<id>.png`,
 * настройки — SharedPreferences `qr_widgets`. Привязка «виджет на рабочем столе → виджет конструктора» — там же (`bind`).
 *
 * Сам виджет — StackView (смахивание вверх/вниз по кругу), см. [QrWidgetService]. Обновления идут вручную: при изменении данных
 * (`sync`), при старте/остановке таймера, помодоро, секундомера и тренировки (`onActivityChanged`), по будильнику смены интервала
 * времени суток (`ACTION_TICK`) и по будильнику «слайд-шоу» (`ACTION_ROTATE`).
 *
 * Нажатие на карточку открывает ScanActivity с кодом настоящей карточки (`lt://v1/card/<id>`) — ровно то, что произошло бы при её сканировании.
 * «После срабатывания» (`after` у карточки): "hide" — карточка скрыта в стопке до конца дня, "end" — уходит в конец стопки; если скрыты все карточки,
 * виджет показывает «На сегодня больше ничего». Срабатывание — нажатие в виджете ([onCardFired] из ScanActivity) или нажатие/скан карточки
 * в приложении (мост ≥32 `widgetCardFired`).
 * Карточка-привычка (`habit` у карточки): одно нажатие открывает в приложении карту дней, двойное — отмечает сегодня и убирает карточку из стопки до
 * конца дня при любом «после срабатывания» ([hideHabitToday]); различает их окно [ScanActivity] (ждёт второго нажатия, [ScanActivity.HABIT_DOUBLE_MS]).
 *
 * Галочка «Отображать заряд аккумулятора» (`battery` у виджета): в конец стопки добавляется служебная карточка [QrBattery.KEY] — её лицо рисует
 * [QrBattery.render] (заряд телефона и Bluetooth-наушников), нажатие на неё ничего не делает. Галочка «…(несколько устройств)» (`batteryMulti`) добавляет
 * после неё ещё одну служебную карточку [QrBattery.KEY2] ([QrBattery.renderMulti]): только кольца и значки телефона и до трёх подключённых Bluetooth-устройств. Картинка перерисовывается по будильнику
 * `ACTION_BATTERY` (раз в 5 минут, если заряд изменился), при подключении Bluetooth-устройства (серия проверок через 6, 15, 30, 60 и 120 с, пока заряд не станет известен), при отключении и при вещании о заряде устройств.
 *
 * Галочки «Показывать задачи» (`tasks`) и «Показывать события календаря» (`events`): страница присылает в `dyn` кандидатов — задачи (`k`="task", `at` — время
 * задачи, мс) и ближайшие события (`k`="event") — и до четырёх картинок на каждого: `<ключ>.png` («Сегодня»), `<ключ>_t.png` («Завтра»), `<ключ>_w.png` (день недели — до даты два дня
 * и больше, но не дальше шести суток) и `<ключ>_d.png` (дата с днём недели, у события на семь суток вперёд и дальше) и у задачи `<ключ>_s.png` («Просрочено, сегодня»), `<ключ>_y.png` («Просрочено, вчера»), `<ключ>_o.png` («Просрочено, 1 января»). Что показать, решает оболочка по часам ([QrPriority.build], [dynBitmap]), поэтому надпись и состав меняются без приложения:
 * задачи — одна карточка на все: показана одна невыполненная задача из ближайших (время в пределах [QrPriority.DYN_DAYS] суток, просроченные первыми; время прошло — «Просрочено, сегодня» / «вчера» / дата); событие — одно, ближайшее из ещё не начавшихся в этих пределах ([QrPriority.nextEventKey]; галочка «Показывать мероприятия на N дней вперёд» — `eventsSoon` и число `eventsDays` — сужает или расширяет окно события до N суток, 1…15, считая сегодняшние); нет такого —
 * карточки нет. Будильник `ACTION_TICK` ставится на полночь и на начало ближайшего события ([nextDynChange]). Карточки стоят после QR-карточек и перед карточками заряда;
 * Карточка события: нажатие у левого края — предыдущее событие, у правого — следующее (до [QrPriority.EVENT_NAV_MAX] ближайших, ряд не зациклен; номер хранит [eventNav], через [EVENT_RESET_MS]
 * без нажатий ряд сам возвращается к первому событию — [eventIndexOf], [nextDynChange]); внизу карточки точки показывают место в ряду ([withEventDots]); нажатие в центре открывает в приложении форму
 * именно этого события (extra `evopen` → [ScanActivity] → MainActivity.ACTION_OPEN_EVENT → страница `__ltOpenCalendarEvent`).
 * Карточка задач листается так же, как карточка события: нажатие у левого края — предыдущая задача, у правого — следующая (до [QrPriority.TASK_NAV_MAX], без зацикливания; номер хранит [taskNav] в [K_TKIDX], через [EVENT_RESET_MS] без нажатий ряд возвращается к первой задаче; точки внизу — [withEventDots]).
 * Двойное нажатие в центре карточки задач отмечает показанную задачу выполненной ([completeTask], ждёт [ScanActivity.HABIT_DOUBLE_MS]); следующая задача занимает её место.
 * Среди этих карточек события всегда стоят перед задачами (событие важнее).
 *
 * Карточки-группы (привычки, будильники; в будущем другие — [QrPriority.groups]): каждая ВСЕГДА одна карточка в стопке, сколько бы у неё ни было элементов; свайп листает карточки, а элементы листаются нажатием
 * у левого и правого края ([groupNav]: ВСЕ элементы группы, без зацикливания; точки внизу — [withEventDots]). У каждого элемента свой балл, балл карточки — балл лучшего; очередей в круге равных у неё столько,
 * сколько элементов с верхним баллом. Что показать на карточке: (а) выбранный нажатием у края элемент, пока с последнего нажатия не прошло [EVENT_RESET_MS] (хранит [K_HABIDX]); (б) элемент по очереди круга
 * ([QrPriority.Result.faces]), если карточка в верхнем ярусе; (в) элемент по умолчанию. Смена элемента — только перерисовка лица ([groupViews]), стопка не сбрасывается.
 *
 * Принцип «остаться на карточке»: действие на карточке (двойное нажатие на привычку, отметка задачи, заведение/выключение будильника) не бросает стопку к первой карточке — пока на этой карточке остаётся что делать
 * (ещё не отмеченная привычка, ещё одна задача, будильник), стопка пересоздаётся и встаёт на неё же ([pinSlot] запоминает «слот» карточки на [PIN_MS], [slotOf], [slotPosition], [update]). Исчезла карточка совсем — стопка возвращается к первой, как раньше.
 *
 * Галочка «Показывать будильники» (`alarms` у виджета, `alm` — все будильники пользователя: ключ карточки, id и настройки будильника): группа «Будильники» ([QrPriority.ALARM_SLOT_KEY]), элемент — один будильник
 * (серия: первый звонок и до четырёх повторов). Балл элемента: звонит сейчас — выше всего, ближайший звонок серии в ближайшие [QrPriority.ALARM_SOON_MS] — «скоро», иначе 0. Звонящие (а если таких нет — «скоро»)
 * сменяют друг друга на карточке раз в минуту; по умолчанию показан звонящий, иначе заведённый с ближайшим звонком ([QrPriority.defaultAlarmIndex]). Нажатие в центре заводит показанный будильник или выключает его
 * ([toggleAlarm], показанный будильник при этом не меняется — [holdAlarmRow]). Лицо — `<ключ>.png` / `<ключ>_on.png` («Заведён»). Карточка стоит на месте первого из своих будильников в порядке пользователя.
 *
 * Галочка «Отображать карточки привычек» (`habits` у виджета, `hab` — все привычки пользователя: ключ карточки, код, название, время суток и дни недели привычки в этом виджете,
 * `last` — последний отмеченный день): группа «Привычки» ([QrPriority.HABIT_SLOT_KEY]), элемент — одна не отмеченная сегодня привычка. Привычка, у которой сейчас «её» время ([QrPriority.habitDue]), имеет балл
 * [QrPriority.SCORE_CYCLE], остальные 0 (в круг не входят, доступны краем; в ряду «в своё время» стоят впереди). Одно нажатие в центре открывает карту дней показанной привычки, двойное — отмечает сегодня
 * и убирает из стопки до полуночи только эту привычку ([hideHabitToday]). Привычка, отмеченная в приложении, пропадает по `last`. Все привычки отмечены — карточки привычек в стопке нет совсем.
 *
 * Порядок карточек (фильтр, «Как тренировка?», «в конец», баллы релевантности, «к чему возвращаться») считает [QrPriority] — чистая функция от
 * [QrPriority.Snapshot]; здесь [snapshot] собирает его из источников ([WorkoutTracker], [PomodoroTimer], [StopwatchTimer], [CardTimers], [firedOf], [doneTaskIds], [QrRpe]),
 * а [order] / [plan] / [visibleCount] / [isAllDone] — тонкие обёртки. В отладочной сборке [plan] проверяет результат ([QrPriority.check]) и пишет нарушения в лог.
 * Для баллов «по релевантности» в [snapshot] читаются ещё будильники карточек ([CardAlarms.nextTimes], [CardAlarms.ringingIds]), заряд телефона ([QrBattery.phoneLevel])
 * и верхняя карточка прошлого расчёта (`lasttop` по id виджета, пишет [plan]): новая верхняя карточка не вытесняет прежнюю без отрыва в [QrPriority.HYSTERESIS] баллов.
 * Ручной приоритет карточки ([Card.prio], поле `prio` у карточки в настройках: «top» / «normal» / «low») учитывает [QrPriority]; почему сверху именно эта карточка, [plan] запоминает
 * (`why` по id виджета) и отдаёт странице [whyJson] (мост `widgetWhy`, версия 36).
 * Перерисовку без внешнего события ставит [nextDynChange] (минимум из своего значения и [QrPriority.Result.nextChangeAt]); смена заряда через порог 15 %
 * ([onBatteryChanged]) и будильники ([onAlarmsChanged], в том числе повторный звонок и смахивание) пересчитывают порядок.
 *
 * Галочка «Спрашивать о тренировке» (`rpeAsk` у виджета): пока есть тренировка без оценки нагрузки ([QrRpe.pendingId]), над ВСЕМИ карточками стоит служебная
 * карточка [QrRpe.KEY] «Как тренировка?» с кнопками 1…10 ([QrPriority.build], [order]); ответ ложится в очередь [QrRpe.answer], карточка исчезает. Наверх она возвращается
 * по тому же правилу, что и рекомендованная ([QrPriority.Result.anchorKey]), даже без «релевантности»; порядок остальных карточек от неё не зависит; слайд-шоу на это время стоит ([rotate]).
 *
 * Галочка «Спрашивать о настроении» (`moodAsk` у виджета): вечером с 20:30, если за сегодня не было ни одной отметки настроения ([QrMood.pending]), над всеми обычными карточками стоит служебная
 * карточка [QrMood.KEY] «Как настроение?» с восемью эмодзи-кнопками; приоритет тот же, что у «Как тренировка?» (выше календаря), а если ждут обе — «Как тренировка?» выше. Ответ ложится в очередь
 * [QrMood.answer], карточка сразу исчезает; в полночь уходит, не дожидаясь ответа. Верх, возврат наверх и остановка слайд-шоу — как у «Как тренировка?».
 *
 * Возврат наверх («по релевантности», [armReturn]/[fireReturn]): если пользователь смахнул стопку, а наверху лежит рекомендованная
 * карточка (идёт занятие или сейчас «её» время суток — [Ordered.topKey]) либо карточка события/задачи календаря ([QrPriority.Result.anchorKey]), то через минуту
 * после последнего смахивания стопка снова показывает верхнюю карточку порядка [order]. Данные от страницы (`sync`), не менявшие настройки
 * виджета (только состав задач и событий), положение стопки не трогают ([structSig]). Смахивание система оболочке не сообщает, его видно только по запросу фабрики
 * ([QrWidgetService]: счётчик в `VIRT` раз больше числа карточек), см. [onPossibleSwipe].
 */
object QrWidgets {

    private const val PREFS = "qr_widgets"
    private const val K_CFG = "cfg"
    private const val K_BIND = "bind"
    private const val K_TOP = "top"
    /** cfg.id → верхняя карточка по релевантности при прошлом расчёте ([QrPriority.Snapshot.lastTopKey], устойчивость порядка). */
    private const val K_LASTTOP = "lasttop"
    /** cfg.id → {key, title, reason} верхней карточки, как её показал последний расчёт ([QrPriority.Result.topReason]); читает мост `widgetWhy`. */
    private const val K_WHY = "why"
    private const val K_PEND = "pend"
    private const val K_TOKEN = "token"
    private const val K_FIRED = "fired"
    private const val K_TDONE = "taskDone" // очередь: id задач, отмеченных двойным нажатием в виджете, ещё не применённых страницей
    private const val K_THIDE = "taskHide"  // id уже забранных страницей задач: карточка скрыта, пока `sync` не пришлёт состав без неё
    private const val K_BTWANT = "btwant"
    private const val K_BTASK = "btask"
    private const val K_BTASKAT = "btaskat"
    private const val K_RETURN = "ret"
    private const val K_TOUCH = "touch"       // время последнего касания карточек виджета пользователем, мс (стопка стоит на месте после него: QrPriority.Motion)
    private const val K_TOUCH_SWIPE = "touchSwipe" // последнее касание было смахиванием (после него покой длиннее: смахивание видно не всегда)
    private const val K_RETFIRST = "retfirst" // id виджета → время первого смахивания в текущей серии (потолок откладывания возврата)
    private const val K_AEV = "alarmEv"       // очередь: заведённые/выключенные нажатием в виджете будильники — страница запишет их в журнал событий
    private const val K_AEVSEQ = "alarmEvSeq"
    private const val K_TKIDX = "tkidx"         // id виджета конструктора → {i: номер задачи в ряду карточки задач, t: время последнего нажатия, мс}
    private const val K_EVIDX = "evidx"         // id виджета конструктора → {i: номер события в ряду карточки события, t: время последнего нажатия, мс}
    private const val K_HABIDX = "habidx"       // id виджета конструктора → {ключ карточки-группы («hab_0», «alm_0»): {h: ключ выбранного элемента, t: время последнего нажатия, мс}}
    private const val AEV_MAX = 50
    private const val K_TEV = "timerEv"       // очередь: таймеры, запущенные нажатием в виджете без окна — страница запишет их в журнал событий
    private const val K_TEVSEQ = "timerEvSeq"

    const val ACTION_ROTATE = "com.app.lifetracker.QRW_ROTATE"
    const val ACTION_TICK = "com.app.lifetracker.QRW_TICK"
    const val ACTION_BATTERY = "com.app.lifetracker.QRW_BATTERY"
    const val ACTION_RETURN = "com.app.lifetracker.QRW_RETURN"
    const val ACTION_BT_BURST = "com.app.lifetracker.QRW_BT_BURST"
    const val EXTRA_STEP = "step"
    const val EXTRA_SINCE = "since"
    const val EXTRA_CONNECTED = "connected"

    private const val PEND_TTL_MS = 3 * 60_000L
    private const val RETURN_AFTER_MS = 60_000L
    /** Столько мс после последнего нажатия у края ряд событий остаётся пролистанным, затем снова показывает первое (ближайшее) событие. */
    const val EVENT_RESET_MS = 60_000L
    /** Возврат наверх не откладывается дольше этого от первого смахивания серии, сколько бы раз фабрику ни дёргали. */
    private const val RETURN_MAX_DEFER_MS = 3 * 60_000L
    /** Страховка возврата: шаг проверки и минимальное время от последней постановки стопки наверх (пока смахивание хоть раз не было замечено). */
    private const val GUARD_MS = 60_000L
    /** Шаг проверки страховки: стопка, не поставленная нами наверх дольше [GUARD_MS], возвращается не позже чем через этот шаг после срока. */
    private const val GUARD_TICK_MS = 15_000L
    private const val FLIP_MARGIN_MS = 60L // запас, чтобы будильник, сработавший чуть раньше, не нарисовал прежнее число
    private const val SWIPE_QUIET_MS = 4_000L
    // Пауза после касания теперь общая для всех механизмов и живёт в QrPriority.Motion (INTERACTION_PAUSE_MS / DEEP_QUIET_MS).

    /** Сколько ждать после последнего запроса фабрики, прежде чем считать смахивание законченным (анимация StackView ≈ 0,4 с). */
    private const val SWIPE_SETTLE_MS = 700L
    private const val BATTERY_EVERY_MS = 5 * 60_000L

    /** Серия проверок заряда после подключения Bluetooth-устройства по будильнику (страховка, если процесс уснул): через столько мс от подключения (3, 8, 15, 30, 60, 120 с). */
    private val BT_BURST_AT = longArrayOf(3_000L, 8_000L, 15_000L, 30_000L, 60_000L, 120_000L)

    /** Быстрые проверки первых секунд после подключения (Handler, пока процесс жив): сразу, затем часто — заряд приходит через 1–5 с. */
    private val BT_FAST_AT = longArrayOf(0L, 600L, 1_200L, 2_000L, 3_000L, 4_500L, 6_500L, 9_000L)

    /** После отключения: система снимает звуковой выход не мгновенно, проверяем сразу и ещё дважды. */
    private val BT_FAST_OFF_AT = longArrayOf(0L, 1_000L, 2_500L)

    /** Запас назад от момента подключения: заряд, пришедший чуть раньше, чем мы обработали подключение, считается свежим. */
    private const val BT_SINCE_SLACK_MS = 5_000L
    private const val BT_ASK_EVERY_MS = 24 * 3_600_000L
    private const val MAX_CARDS = 50
    private const val MAX_DYN = 24
    private val KEY_RE = Regex("^[A-Za-z0-9_-]{1,40}$")

    private val LOCK = Any()
    private val main = Handler(Looper.getMainLooper())
    private val refreshToken = Any()
    private val alarmToken = Any()
    private val hideTokens = HashMap<Int, Any>()
    private val returnTokens = HashMap<Int, Any>()
    private val swipeTokens = HashMap<Int, Any>()

    /** Виджеты, у которых сейчас показаны точки справа (чтобы при серии смахиваний не слать лишних обновлений). */
    private val dotsOn: MutableSet<Int> = Collections.synchronizedSet(HashSet<Int>())

    /** До какого момента (uptime) запросы фабрики не считаются смахиванием: стопку только что переставили мы сами. */
    private val swipeQuiet = HashMap<Int, Long>()

    /** id виджета → когда мы в последний раз сами поставили стопку на верхнюю карточку (uptime). */
    private val placedAt = HashMap<Int, Long>()

    /** Виджеты, у которых точный возврат ([armReturn] → [fireReturn]) хоть раз сработал до конца: страховка им не нужна. */
    private val returnWorked: MutableSet<Int> = Collections.synchronizedSet(HashSet<Int>())

    @Volatile private var guardOn = false
    @Volatile private var lastTouchAt = 0L
    @Volatile private var lastTouchSwipe = false

    // ---------- состояние диспетчера движения ----------
    private val motionLock = Any()
    /** id виджета → слоты ([slotOf]) в порядке, который сейчас отдан стопке (его запоминает фабрика, [noteShown]). */
    private val shownSlots = HashMap<Int, List<String>>()
    /** id виджета → порядок слотов, замороженный на время отложенного движения: фабрика отдаёт карточки в нём, а не в новом порядке плана. */
    private val frozenSlots = HashMap<Int, List<String>>()
    /** Виджеты с отложенной сменой верха до включения экрана. */
    private val deferredIds: MutableSet<Int> = Collections.synchronizedSet(HashSet<Int>())
    /** Виджеты с отложенным возвратом наверх до включения экрана. */
    private val pendingReturn: MutableSet<Int> = Collections.synchronizedSet(HashSet<Int>())
    private val wakeTokens = HashMap<Int, Any>()
    @Volatile private var screenRecv = false
    private val guardToken = Any()
    private val cycleToken = Any()

    /** Версия адаптера стопки у виджета (extra `rev` в intent службы): смена версии заставляет систему создать адаптер заново, с пустым кэшем карточек. */
    private val adapterRev = HashMap<Int, Int>()

    class Live(val k: String, val id: String)
    /** Настройки будильника карточки (от страницы): нажатие в виджете заводит/выключает его без окна и страницы. */
    class AlarmSpec(val hour: Int, val minute: Int, val every: Int, val times: Int, val title: String)
    /** [dyn] — "task" / "event" у карточек задач и событий календаря ([at] — их время, мс), иначе пусто. */
    class Card(val key: String, val code: String, val title: String, val live: List<Live>, val times: Set<String>, val days: Set<Int>, val after: String = "none", val color: Int = QrBattery.DEFAULT_FACE, val dyn: String = "", val at: Long = 0L, val habit: Boolean = false, val tid: String = "", val eid: String = "", val alarmId: String = "", val alarmSpec: AlarmSpec? = null, val prio: String = "normal", val doneDay: Int = 0, val cycleN: Int = 1, val gscore: Int = 0, val greason: String = "", val sec: Int = 0, val hid: Boolean = false)
    class Cfg(val id: String, val name: String, val rotate: Boolean, val rotateMin: Int, val relevance: Boolean, val cards: List<Card>, val battery: Boolean = false, val batteryMulti: Boolean = false, val tasks: Boolean = false, val events: Boolean = false, val rpeAsk: Boolean = false, val alarms: Boolean = false, val moodAsk: Boolean = false, val rpeColor: Int = QrRpe.DEFAULT_COLOR, val moodColor: Int = QrMood.DEFAULT_COLOR, val habits: Boolean = false, val habitCards: List<Card> = emptyList(), val eventsSoon: Boolean = false, val timers: Boolean = false, val timerCards: List<Card> = emptyList(), val eventsDays: Int = 2) {
        /** Включена ли хоть одна карточка заряда (обычная или «несколько устройств»). */
        val anyBattery: Boolean get() = battery || batteryMulti
    }
    class Ordered(val cards: List<Card>, val topKey: String)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun imgDir(ctx: Context) = File(ctx.applicationContext.filesDir, "qrwidgets")

    /** Случайный ключ установки: окно ScanActivity принимает код из виджета только вместе с ним (код из чужого приложения не выполняется). */
    fun token(ctx: Context): String = synchronized(LOCK) {
        val p = prefs(ctx)
        var t = p.getString(K_TOKEN, null)
        if (t.isNullOrEmpty()) {
            t = UUID.randomUUID().toString()
            p.edit().putString(K_TOKEN, t).apply()
        }
        t
    }

    fun tokenOk(ctx: Context, given: String?): Boolean = !given.isNullOrEmpty() && given == token(ctx)

    // ---------- настройки ----------

    /** "#rrggbb" от страницы (цвет карточки заряда, выбранный в форме виджета) → цвет; нет или неверно — сиреневый по умолчанию. */
    private fun parseColor(v: String, def: Int = QrBattery.DEFAULT_FACE): Int {
        if (!Regex("^#[0-9a-fA-F]{6}$").matches(v)) return def
        return (0xFF shl 24) or v.substring(1).toInt(16)
    }

    private fun parseAlarmSpec(o: JSONObject?): AlarmSpec? {
        if (o == null) return null
        val h = o.optInt("h", -1)
        val m = o.optInt("m", -1)
        if (h !in 0..23 || m !in 0..59) return null
        return AlarmSpec(h, m, o.optInt("every", 0), o.optInt("times", 0), o.optString("title", "").take(200))
    }

    /** "ГГГГ-ММ-ДД" от страницы → ГГГГММДД (как [dayKey]); пусто или неверно — 0. */
    private fun parseDayKey(v: String): Int {
        val m = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$").matchEntire(v) ?: return 0
        return m.groupValues[1].toInt() * 10000 + m.groupValues[2].toInt() * 100 + m.groupValues[3].toInt()
    }

    private fun parse(text: String?): List<Cfg> {
        if (text.isNullOrEmpty()) return emptyList()
        return try {
            val arr = JSONObject(text).optJSONArray("widgets") ?: return emptyList()
            val out = ArrayList<Cfg>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val id = o.optString("id", "")
                if (id.isEmpty()) continue
                val cards = ArrayList<Card>()
                val cs = o.optJSONArray("cards")
                if (cs != null) {
                    for (j in 0 until cs.length()) {
                        val c = cs.optJSONObject(j) ?: continue
                        val key = c.optString("key", "")
                        if (!KEY_RE.matches(key)) continue
                        val live = ArrayList<Live>()
                        val la = c.optJSONArray("live")
                        if (la != null) for (x in 0 until la.length()) {
                            val lo = la.optJSONObject(x) ?: continue
                            live.add(Live(lo.optString("k", ""), lo.optString("id", "")))
                        }
                        val times = HashSet<String>()
                        val ta = c.optJSONArray("times")
                        if (ta != null) for (x in 0 until ta.length()) ta.optString(x)?.let { if (QrPriority.WINDOWS.containsKey(it)) times.add(it) }
                        val days = HashSet<Int>()
                        val da = c.optJSONArray("days")
                        if (da != null) for (x in 0 until da.length()) da.optInt(x).let { if (it in 1..7) days.add(it) }
                        val after = c.optString("after", "none").let { if (it == "hide" || it == "end") it else "none" }
                        cards.add(Card(key, c.optString("code", ""), c.optString("title", ""), live, times, days, after, habit = c.optBoolean("habit", false), alarmId = c.optString("alarm", "").take(40), alarmSpec = parseAlarmSpec(c.optJSONObject("alarmSpec")), prio = QrPriority.normPrio(c.optString("prio", "normal"))))
                        if (cards.size >= MAX_CARDS) break
                    }
                }
                val tasksOn = o.optBoolean("tasks", false)
                val eventsOn = o.optBoolean("events", false)
                val rpeAskOn = o.optBoolean("rpeAsk", false)
                val moodAskOn = o.optBoolean("moodAsk", false)
                val rpeColor = parseColor(o.optString("rpeColor", ""), QrRpe.DEFAULT_COLOR) // цвет служебных карточек из палитры формы; нет — фиолетовый макета
                val moodColor = parseColor(o.optString("moodColor", ""), QrMood.DEFAULT_COLOR)
                val ds = o.optJSONArray("dyn")
                if (ds != null && (tasksOn || eventsOn)) {
                    val evs = ArrayList<Card>()
                    val tks = ArrayList<Card>()
                    var n = 0
                    for (j in 0 until ds.length()) {
                        val d = ds.optJSONObject(j) ?: continue
                        val key = d.optString("key", "")
                        val kind = d.optString("k", "")
                        val at = d.optLong("at", 0L)
                        if (!KEY_RE.matches(key) || at <= 0L) continue
                        if (!((kind == "task" && tasksOn) || (kind == "event" && eventsOn))) continue
                        val dc = Card(key, "", d.optString("title", ""), emptyList(), emptySet(), emptySet(), "none", QrBattery.DEFAULT_FACE, kind, at, tid = d.optString("tid", "").take(80), eid = d.optString("eid", "").take(64))
                        if (kind == "event") evs.add(dc) else tks.add(dc)
                        if (++n >= MAX_DYN) break
                    }
                    cards.addAll(evs) // после QR-карточек, перед карточками заряда; событие важнее задачи — стоит раньше
                    cards.addAll(tks)
                }
                val alarmsOn = o.optBoolean("alarms", false)
                val alm = o.optJSONArray("alm")
                if (alm != null && alarmsOn) {
                    val als = ArrayList<Card>()
                    for (j in 0 until alm.length()) {
                        val d = alm.optJSONObject(j) ?: continue
                        val key = d.optString("key", "")
                        val spec = parseAlarmSpec(d.optJSONObject("alarmSpec"))
                        val aid = d.optString("alarm", "").take(40)
                        if (!KEY_RE.matches(key) || aid.isEmpty() || spec == null || cards.any { it.key == key } || als.any { it.key == key }) continue
                        als.add(Card(key, "", d.optString("title", ""), emptyList(), emptySet(), emptySet(), "none", QrBattery.DEFAULT_FACE, "alarm", 0L, alarmId = aid, alarmSpec = spec))
                        if (als.size >= QrPriority.ALARM_NAV_MAX) break
                    }
                    cards.addAll(als) // после задач, перед карточками заряда
                }
                val habitsOn = o.optBoolean("habits", false)
                val hab = o.optJSONArray("hab")
                val habitList = ArrayList<Card>()
                if (hab != null && habitsOn) {
                    for (j in 0 until hab.length()) {
                        val d = hab.optJSONObject(j) ?: continue
                        val key = d.optString("key", "")
                        if (!KEY_RE.matches(key) || cards.any { it.key == key } || habitList.any { it.key == key }) continue
                        val times = HashSet<String>()
                        val ta = d.optJSONArray("times")
                        if (ta != null) for (x in 0 until ta.length()) ta.optString(x)?.let { if (QrPriority.WINDOWS.containsKey(it)) times.add(it) }
                        val days = HashSet<Int>()
                        val da = d.optJSONArray("days")
                        if (da != null) for (x in 0 until da.length()) da.optInt(x).let { if (it in 1..7) days.add(it) }
                        habitList.add(Card(key, d.optString("code", ""), d.optString("title", ""), emptyList(), times, days, "none", QrBattery.DEFAULT_FACE, "habit", 0L, habit = true, doneDay = parseDayKey(d.optString("last", ""))))
                        if (habitList.size >= QrPriority.HABIT_NAV_MAX) break
                    }
                }
                val timersOn = o.optBoolean("timers", false)
                val tmr = o.optJSONArray("tmr")
                val timerList = ArrayList<Card>()
                if (tmr != null && timersOn) {
                    for (j in 0 until tmr.length()) {
                        val d = tmr.optJSONObject(j) ?: continue
                        val key = d.optString("key", "")
                        val sec = d.optInt("sec", 0)
                        if (!KEY_RE.matches(key) || sec <= 0 || timerList.any { it.key == key }) continue
                        val live = ArrayList<Live>()
                        val la = d.optJSONArray("live")
                        if (la != null) for (x in 0 until la.length()) {
                            val lo = la.optJSONObject(x) ?: continue
                            if (lo.optString("k", "") == "timer") live.add(Live("timer", lo.optString("id", "")))
                        }
                        val times = HashSet<String>()
                        val ta = d.optJSONArray("times")
                        if (ta != null) for (x in 0 until ta.length()) ta.optString(x)?.let { if (QrPriority.WINDOWS.containsKey(it)) times.add(it) }
                        timerList.add(Card(key, d.optString("code", ""), d.optString("title", ""), live, times, emptySet(), "none", parseColor(d.optString("color", ""), QrTimerFace.COLOR), "timer", 0L, sec = sec, hid = d.optBoolean("hidden", false))) // цвет лица — цвет таймера на вкладке QR-кодов
                        if (timerList.size >= QrPriority.TIMER_NAV_MAX) break
                    }
                }
                val battery = o.optBoolean("battery", false)
                val batColor = parseColor(o.optString("batColor", ""))
                if (battery) cards.add(Card(QrBattery.KEY, "", "Заряд", emptyList(), emptySet(), emptySet(), "none", batColor)) // карточка заряда — последняя в стопке
                val batteryMulti = o.optBoolean("batteryMulti", false)
                val bat2Color = parseColor(o.optString("bat2Color", ""))
                if (batteryMulti) cards.add(Card(QrBattery.KEY2, "", "Заряд устройств", emptyList(), emptySet(), emptySet(), "none", bat2Color)) // после карточки заряда
                out.add(
                    Cfg(
                        id, o.optString("name", "Виджет"), o.optBoolean("rotate", false),
                        o.optInt("rotateMin", 5).coerceIn(1, 720), o.optBoolean("relevance", false), cards, battery, batteryMulti, tasksOn, eventsOn, rpeAskOn, alarmsOn, moodAskOn, rpeColor, moodColor, habits = habitsOn, habitCards = habitList, eventsSoon = o.optBoolean("eventsSoon", false) && eventsOn, timers = timersOn, timerCards = timerList,
                        eventsDays = o.optInt("eventsDays", 2).coerceIn(1, QrPriority.EVENTS_DAYS_MAX) // нет числа (страница старой версии) — как было: сегодня и завтра
                    )
                )
            }
            out
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun configs(ctx: Context): List<Cfg> = parse(prefs(ctx).getString(K_CFG, null))

    private fun jmap(ctx: Context, key: String): JSONObject = try {
        JSONObject(prefs(ctx).getString(key, "{}") ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    fun cfgFor(ctx: Context, appWidgetId: Int): Cfg? {
        val cfgId = jmap(ctx, K_BIND).optString(appWidgetId.toString(), "")
        if (cfgId.isEmpty()) return null
        return configs(ctx).firstOrNull { it.id == cfgId }
    }

    fun isBound(ctx: Context, appWidgetId: Int): Boolean = jmap(ctx, K_BIND).has(appWidgetId.toString())

    fun bind(ctx: Context, appWidgetId: Int, cfgId: String) {
        synchronized(LOCK) {
            val m = jmap(ctx, K_BIND)
            m.put(appWidgetId.toString(), cfgId)
            prefs(ctx).edit().putString(K_BIND, m.toString()).apply()
        }
    }

    fun forget(ctx: Context, ids: IntArray) {
        for (wid in ids) { // состояние диспетчера движения удалённых виджетов
            thaw(wid)
            synchronized(motionLock) { shownSlots.remove(wid) }
        }
        synchronized(LOCK) {
            val b = jmap(ctx, K_BIND)
            val t = jmap(ctx, K_TOP)
            for (id in ids) {
                b.remove(id.toString())
                t.remove(id.toString())
                cancelRotate(ctx, id)
                clearReturn(ctx, id)
            }
            prefs(ctx).edit().putString(K_BIND, b.toString()).putString(K_TOP, t.toString()).apply()
        }
    }

    // ---------- закрепление ----------

    private fun setPending(ctx: Context, cfgId: String) {
        prefs(ctx).edit().putString(K_PEND, JSONObject().put("id", cfgId).put("at", System.currentTimeMillis()).toString()).apply()
    }

    /** Виджет, который только что поставили по кнопке «Добавить на рабочий стол», сам привязывается к выбранному виджету конструктора. */
    fun claimPending(ctx: Context, appWidgetId: Int): Boolean = synchronized(LOCK) {
        val raw = prefs(ctx).getString(K_PEND, null) ?: return false
        try {
            val o = JSONObject(raw)
            prefs(ctx).edit().remove(K_PEND).apply()
            if (System.currentTimeMillis() - o.optLong("at") > PEND_TTL_MS) return false
            val id = o.optString("id", "")
            if (configs(ctx).none { it.id == id }) return false
            bind(ctx, appWidgetId, id)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** "requested" | "unsupported" | "missing" | "failed". */
    fun requestPin(ctx: Context, cfgId: String): String {
        if (Build.VERSION.SDK_INT < 26) return "unsupported"
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        if (!mgr.isRequestPinAppWidgetSupported) return "unsupported"
        if (configs(app).none { it.id == cfgId }) return "missing"
        setPending(app, cfgId)
        return try {
            if (mgr.requestPinAppWidget(ComponentName(app, QrWidgetProvider::class.java), null, null)) "requested" else "failed"
        } catch (e: Exception) {
            "failed"
        }
    }

    /** {"sdk":N,"canPin":bool,"placed":{"<id виджета конструктора>":сколько их на рабочем столе}[,"bt":{"reason","name","level"}]} — `bt` только если у какого-то виджета включён заряд. */
    fun stateJson(ctx: Context): String {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        val placed = JSONObject()
        for (id in ids) cfgFor(app, id)?.let { placed.put(it.id, placed.optInt(it.id, 0) + 1) }
        val canPin = Build.VERSION.SDK_INT >= 26 && try { mgr.isRequestPinAppWidgetSupported } catch (e: Exception) { false }
        val st = JSONObject().put("sdk", Build.VERSION.SDK_INT).put("canPin", canPin).put("placed", placed)
        if (configs(app).any { it.anyBattery }) st.put("bt", QrBattery.status(app)) // что с наушниками: причина, по которой их заряда нет в карточке «Заряд»
        return st.toString()
    }

    // ---------- данные от страницы ----------

    fun sync(ctx: Context, json: String?): Boolean {
        if (json.isNullOrEmpty()) return false
        val app = ctx.applicationContext
        return try {
            val root = JSONObject(json)
            val dir = imgDir(app)
            dir.mkdirs()
            val keep = HashSet<String>()
            val images = root.optJSONObject("images")
            if (images != null) {
                val it = images.keys()
                while (it.hasNext()) {
                    val key = it.next()
                    if (!KEY_RE.matches(key)) continue
                    val raw = images.optString(key, "")
                    val comma = raw.indexOf(',')
                    val bytes = Base64.decode(if (comma >= 0) raw.substring(comma + 1) else raw, Base64.DEFAULT)
                    if (bytes.isEmpty()) continue
                    val tmp = File(dir, "$key.tmp")
                    tmp.writeBytes(bytes)
                    val dst = File(dir, "$key.png")
                    if (!tmp.renameTo(dst)) { dst.delete(); tmp.renameTo(dst) }
                    keep.add("$key.png")
                }
            }
            dir.listFiles()?.forEach { f -> if (f.name !in keep) f.delete() }
            root.remove("images")
            var wantBattery = false
            root.optJSONArray("widgets")?.let { ws -> for (i in 0 until ws.length()) if (ws.optJSONObject(i)?.let { it.optBoolean("battery", false) || it.optBoolean("batteryMulti", false) } == true) wantBattery = true }
            var structChanged = true
            synchronized(LOCK) {
                structChanged = structSig(prefs(app).getString(K_CFG, null)) != structSig(root.toString())
                val e = prefs(app).edit().putString(K_CFG, root.toString())
                // галочку только что включили — страница попросит у пользователя доступ к Bluetooth (для заряда наушников);
                // не дали (или не успели) — просим снова не чаще раза в сутки, пока галочка включена
                val now = System.currentTimeMillis()
                val first = wantBattery && !prefs(app).getBoolean(K_BTWANT, false)
                val again = wantBattery && QrBattery.permissionMissing(app) && now - prefs(app).getLong(K_BTASKAT, 0L) > BT_ASK_EVERY_MS
                if (first || again) e.putBoolean(K_BTASK, true).putLong(K_BTASKAT, now)
                e.putBoolean(K_BTWANT, wantBattery).apply()
            }
            // положение стопки сбрасываем, только если поменялись настройки виджета; новые задачи/события и перерисовка лиц стопку не двигают
            pruneHiddenTasks(app)
            refreshAll(app, structChanged, true)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Подпись настроек виджетов без списков `dyn`, `alm`, `hab` и `tmr` (состав задач, событий, будильников, привычек и таймеров, в том числе отметки дней, меняется сам и положения стопки не касается). */
    private fun structSig(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        return try {
            val root = JSONObject(text)
            root.optJSONArray("widgets")?.let { ws -> for (i in 0 until ws.length()) ws.optJSONObject(i)?.let { it.remove("dyn"); it.remove("alm"); it.remove("hab"); it.remove("tmr") } }
            root.toString()
        } catch (e: Exception) {
            text
        }
    }

    /** true один раз после того, как галочку «Отображать заряд аккумулятора» включили: пора запросить доступ к Bluetooth. */
    fun consumeBatteryAsk(ctx: Context): Boolean = synchronized(LOCK) {
        val p = prefs(ctx)
        val ask = p.getBoolean(K_BTASK, false)
        if (ask) p.edit().putBoolean(K_BTASK, false).apply()
        ask
    }

    fun bitmapFor(ctx: Context, c: Card): Bitmap {
        if (c.key == QrRpe.KEY) return QrRpe.render(ctx, c.color)
        if (c.key == QrMood.KEY) return QrMood.render(ctx, c.color)
        if (c.key == QrBattery.KEY) return QrBattery.render(ctx, c.color)
        if (c.key == QrBattery.KEY2) return QrBattery.renderMulti(ctx, c.color)
        if (c.dyn == "timer") return QrTimerFace.render(c.title, timerStateOf(ctx, c), c.sec, c.color) // таймер рисует оболочка: кольцо и минуты меняются сами
        if (c.dyn == "event" || c.dyn == "task") dynBitmap(ctx, c)?.let { return it }
        if (c.alarmId.isNotEmpty() && CardAlarms.isArmed(ctx, c.alarmId)) { // будильник заведён — лицо с надписью «Заведён» (`<ключ>_on.png`)
            val on = File(imgDir(ctx), c.key + "_on.png")
            if (on.exists()) {
                try {
                    BitmapFactory.decodeFile(on.path)?.let { return it }
                } catch (e: Throwable) {
                    // не хватило памяти или файл повреждён — обычное лицо ниже
                }
            }
        }
        val f = File(imgDir(ctx), c.key + ".png")
        if (f.exists()) {
            try {
                BitmapFactory.decodeFile(f.path)?.let { return it }
            } catch (e: Throwable) {
                // не хватило памяти или файл повреждён — запасная картинка ниже
            }
        }
        return fallbackBitmap(c.title)
    }

    /**
     * Состояние таймера карточки-таймера [c]: идущий важнее приостановленного, из двух идущих — тот, что кончится раньше. У таймера может быть два id в оболочке
     * (запущенный кнопкой карточки и запущенный по коду, [Card.live]). null — таймер не запущен.
     */
    fun timerStateOf(ctx: Context, c: Card): CardTimers.Face? {
        var best: CardTimers.Face? = null
        for (l in c.live) {
            if (l.k != "timer" || l.id.isEmpty()) continue
            val f = CardTimers.faceOf(ctx, l.id) ?: continue
            val b = best
            if (b == null || (f.running && !b.running) || (f.running == b.running && f.leftMs < b.leftMs)) best = f
        }
        return best
    }

    /** Картинка карточки задачи/события для нынешнего момента: «Просрочено» — `<ключ>_s.png` (сегодня) / `<ключ>_y.png` (вчера) / `<ключ>_o.png` (раньше), «Сегодня» — `<ключ>.png`, «Завтра» — `<ключ>_t.png`, день недели (до шести суток вперёд) — `<ключ>_w.png`, дата («25 ноября, Среда», от семи суток) — `<ключ>_d.png`; нет нужной — берутся соседние. */
    private fun dynBitmap(ctx: Context, c: Card): Bitmap? {
        val now = System.currentTimeMillis()
        val names = when {
            c.dyn == "task" && c.at <= now -> when {
                c.at >= dayStart(now, 0) -> listOf(c.key + "_s", c.key + "_y", c.key + "_o")
                c.at >= dayStart(now, -1) -> listOf(c.key + "_y", c.key + "_o", c.key + "_s")
                else -> listOf(c.key + "_o", c.key + "_y", c.key + "_s")
            }
            c.at < dayStart(now, 0) -> listOf(c.key + "_o", c.key)
            c.at < dayStart(now, 1) -> listOf(c.key, c.key + "_o")
            c.at < dayStart(now, 2) -> listOf(c.key + "_t", c.key + "_w", c.key)
            c.at < dayStart(now, 7) -> listOf(c.key + "_w", c.key + "_t", c.key)
            else -> listOf(c.key + "_d", c.key + "_w", c.key + "_t", c.key) // семь суток и дальше: день недели уже не однозначен — «25 ноября, Среда»
        }
        for (name in names) {
            val f = File(imgDir(ctx), "$name.png")
            if (!f.exists()) continue
            try {
                BitmapFactory.decodeFile(f.path)?.let { return it }
            } catch (e: Throwable) {
                // не хватило памяти или файл повреждён — пробуем вторую картинку
            }
        }
        return null
    }

    private fun fallbackBitmap(title: String): Bitmap {
        val s = 360
        val body = Math.round(s * FACE_BODY).toFloat()
        val shift = Math.round(s * FACE_SHADE).toFloat()
        val bmp = Bitmap.createBitmap(s, (body + shift).toInt(), Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = s * FACE_RADIUS
        p.color = 0xFF8D78DF.toInt()
        g.drawRoundRect(RectF(0f, shift, s.toFloat(), shift + body), r, r, p)
        p.color = 0xFFB9A1FF.toInt()
        g.drawRoundRect(RectF(0f, 0f, s.toFloat(), body), r, r, p)
        p.color = Color.WHITE
        p.textSize = s * 0.12f
        p.textAlign = Paint.Align.CENTER
        p.isFakeBoldText = true
        g.drawText(title.take(14), s / 2f, body / 2f, p)
        return bmp
    }

    // ---------- порядок карточек ----------

    // ---------- «остаться на карточке» после действия ----------

    /** Сколько после действия на карточке пересоздание стопки (перерисовка, смена порядка) ставит её на эту карточку, а не на первую. */
    private const val PIN_MS = 10_000L
    private val pins = HashMap<String, Pair<String, Long>>() // id виджета конструктора → (слот карточки, до какого SystemClock.uptimeMillis())

    /**
     * Слот карточки: то, что остаётся «той же карточкой», когда меняется её содержимое. Карточка-группа (привычки, будильники, таймеры) — её ключ; карточка задач и карточка
     * события — `dyn:task` / `dyn:event` (их ключ меняется вместе с показанной задачей или событием); остальные — собственный ключ.
     */
    internal fun slotOf(c: Card): String = when {
        QrPriority.isGroupKey(c.key) -> c.key
        c.dyn == "task" || c.dyn == "event" -> "dyn:" + c.dyn
        else -> c.key
    }

    /** Действие только что было на карточке слота [slot] виджета [cfgId]: ближайшие [PIN_MS] пересоздание стопки ставит её на эту карточку, если она осталась. */
    private fun pinSlot(cfgId: String, slot: String) {
        synchronized(pins) { pins[cfgId] = Pair(slot, SystemClock.uptimeMillis() + PIN_MS) }
    }

    /** Слот, на котором недавно было действие, или пусто — закрепления нет (или оно истекло). */
    private fun pinnedSlot(cfgId: String): String {
        val p = synchronized(pins) { pins[cfgId] } ?: return ""
        if (SystemClock.uptimeMillis() > p.second) {
            synchronized(pins) { pins.remove(cfgId) }
            return ""
        }
        return p.first
    }

    /**
     * Позиция стопки (для setDisplayedChild), на которой в нынешнем порядке показана карточка слота [slot]. Позиция p показывает карточку (−p) по модулю числа карточек
     * ([QrWidgetService.getViewAt]), поэтому карточке с номером k соответствует позиция n − k. Карточки в стопке нет (или она первая) — 0.
     */
    private fun slotPosition(ctx: Context, cfg: Cfg, slot: String): Int {
        val cards = plan(ctx, cfg).cards
        val n = cards.size
        if (n < 2) return 0
        val k = cards.indexOfFirst { slotOf(it.card) == slot }
        return if (k <= 0) 0 else n - k
    }

    // ---------- «после срабатывания»: скрытые и перенесённые в конец ----------

    private fun dayKey(): Int {
        val c = Calendar.getInstance()
        return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
    }

    /** Начало суток через [days] календарных дней от момента [now] (0 — сегодняшняя полночь; переход на летнее время не сдвигает). */
    private fun dayStart(now: Long, days: Int): Long {
        val c = Calendar.getInstance()
        c.timeInMillis = now
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        if (days != 0) c.add(Calendar.DAY_OF_YEAR, days)
        return c.timeInMillis
    }

    /**
     * Когда пора перерисовать виджет: у карточек задач и событий — полночь (день недели → «Завтра» → «Сегодня», задача → «Просрочено») или начало ближайшего
     * события/задачи; при «релевантности» ещё и момент, когда сам собой изменится порядок ([QrPriority.Result.nextChangeAt]). Берётся ближайшее из них.
     */
    private fun nextDynChange(ctx: Context, cfg: Cfg): Long {
        val now = System.currentTimeMillis()
        var at = Long.MAX_VALUE
        if (cfg.tasks || cfg.events) {
            at = dayStart(now, 1) + 5_000L
            for (c in cfg.cards) if ((c.dyn == "event" || c.dyn == "task") && c.at > now && c.at + 1_000L < at) at = c.at + 1_000L
        }
        if (cfg.relevance) at = Math.min(at, plan(ctx, cfg).nextChangeAt)
        if (cfg.moodAsk) at = Math.min(at, QrMood.nextChangeAt(now)) // 20:30 — «Как настроение?» появится, полночь — уйдёт
        if (cfg.events) eventResetAt(ctx, cfg.id, now)?.let { at = Math.min(at, it) } // пролистанный ряд событий вернётся к первому
        if (cfg.tasks) rowResetAt(ctx, K_TKIDX, cfg.id, now)?.let { at = Math.min(at, it) } // то же для ряда задач
        if (cfg.habits || cfg.alarms || cfg.timers) groupResetAt(ctx, cfg.id, now)?.let { at = Math.min(at, it) } // и для выбранных нажатием элементов карточек-групп (привычки, будильники, таймеры)
        return at
    }

    // ---------- ряд событий на карточке события ----------

    private fun rowEntry(ctx: Context, key: String, cfgId: String): JSONObject? = synchronized(LOCK) { jmap(ctx, key).optJSONObject(cfgId) }

    /** Номер карточки в ряду (события или задач, [key] — K_EVIDX / K_TKIDX) виджета [cfgId]: 0 — первая; не нажимали [EVENT_RESET_MS] — снова 0. */
    private fun rowIndexOf(ctx: Context, key: String, cfgId: String, now: Long): Int {
        val e = rowEntry(ctx, key, cfgId) ?: return 0
        val i = e.optInt("i", 0)
        if (i <= 0 || now - e.optLong("t", 0L) >= EVENT_RESET_MS || now < e.optLong("t", 0L)) return 0
        return i
    }

    /** Когда пролистанный ряд вернётся к первой карточке (с запасом на неточность будильника); null — ряд и так на первой. */
    private fun rowResetAt(ctx: Context, key: String, cfgId: String, now: Long): Long? {
        if (rowIndexOf(ctx, key, cfgId, now) <= 0) return null
        return (rowEntry(ctx, key, cfgId)?.optLong("t", 0L) ?: return null) + EVENT_RESET_MS + 500L
    }

    /** Номер события в ряду карточки события виджета [cfgId]: 0 — первое; не нажимали [EVENT_RESET_MS] — снова 0. */
    private fun eventIndexOf(ctx: Context, cfgId: String, now: Long): Int = rowIndexOf(ctx, K_EVIDX, cfgId, now)

    /** Когда пролистанный ряд событий вернётся к первому; null — ряд и так на первом. */
    private fun eventResetAt(ctx: Context, cfgId: String, now: Long): Long? = rowResetAt(ctx, K_EVIDX, cfgId, now)

    /** (номер показанного события, сколько событий в ряду) для виджета [cfg]; в ряду меньше двух событий листать нечего. */
    fun eventPos(ctx: Context, cfg: Cfg): Pair<Int, Int> {
        val s = snapshot(ctx, cfg)
        val n = QrPriority.eventCards(cfg, s).size
        return Pair(if (n == 0) 0 else s.eventIndex.coerceIn(0, n - 1), n)
    }

    /**
     * Нажатие у края карточки события в виджете [widgetId] ([dir] = -1 — предыдущее событие, 1 — следующее). Ряд не зациклен: у первого и последнего события нажатие ничего не меняет.
     * Стопка не сбрасывается — перерисовывается только карточка события ([refreshAll] без возврата наверх).
     */
    fun eventNav(ctx: Context, widgetId: Int, dir: Int) {
        if (dir != -1 && dir != 1) return
        val app = ctx.applicationContext
        val cfg = cfgFor(app, widgetId) ?: return
        if (!cfg.events) return
        val pos = eventPos(app, cfg)
        val to = (pos.first + dir).coerceIn(0, Math.max(0, pos.second - 1))
        if (pos.second == 0 || to == pos.first) return
        saveRowIndex(app, K_EVIDX, cfg.id, to)
        refreshAll(app)
    }

    private fun saveRowIndex(app: Context, key: String, cfgId: String, to: Int) {
        synchronized(LOCK) {
            val all = jmap(app, key)
            all.put(cfgId, JSONObject().put("i", to).put("t", System.currentTimeMillis()))
            prefs(app).edit().putString(key, all.toString()).apply()
        }
    }

    /** (номер показанной задачи, сколько задач в ряду) для виджета [cfg]; в ряду меньше двух задач листать нечего. */
    fun taskPos(ctx: Context, cfg: Cfg): Pair<Int, Int> {
        val s = snapshot(ctx, cfg)
        val n = QrPriority.taskCards(cfg, s).size
        return Pair(if (n == 0) 0 else s.taskIndex.coerceIn(0, n - 1), n)
    }

    /**
     * Нажатие у края карточки задач в виджете [widgetId] ([dir] = -1 — предыдущая задача, 1 — следующая). Ряд не зациклен: у первой и последней задачи нажатие ничего не меняет.
     * Стопка не сбрасывается — перерисовывается только карточка задач ([refreshAll] без возврата наверх).
     */
    fun taskNav(ctx: Context, widgetId: Int, dir: Int) {
        if (dir != -1 && dir != 1) return
        val app = ctx.applicationContext
        val cfg = cfgFor(app, widgetId) ?: return
        if (!cfg.tasks) return
        val pos = taskPos(app, cfg)
        val to = (pos.first + dir).coerceIn(0, Math.max(0, pos.second - 1))
        if (pos.second == 0 || to == pos.first) return
        saveRowIndex(app, K_TKIDX, cfg.id, to)
        refreshAll(app)
    }

    /**
     * Нажатие у края карточки «Будильники» в виджете [widgetId]: листает будильники так же, как привычки ([groupNav]; ScanActivity по-прежнему шлёт `alnav`).
     */
    fun alarmNav(ctx: Context, widgetId: Int, dir: Int) = groupNav(ctx, widgetId, QrPriority.ALARM_SLOT_KEY, dir)

    // ---------- карточки-группы («Привычки», «Будильники») ----------

    /** Что показывает карточка-группа: сам элемент [card] и его номер [index] в ряду из [total] элементов (по ним рисуются точки внизу). */
    class GroupView(val card: Card, val index: Int, val total: Int)

    /**
     * Ключ карточки-группы → элемент, который она показывает. Приоритет: (а) элемент, выбранный нажатием у края, пока с последнего нажатия не прошло [EVENT_RESET_MS]
     * (и пока он есть в ряду: отмеченная привычка из ряда пропадает); (б) элемент по очереди круга равных, если карточка в верхнем ярусе ([QrPriority.Result.faces]);
     * (в) элемент по умолчанию ([QrPriority.Group.defaultIdx]). Без «релевантности» круга нет: выбор краем или элемент по умолчанию.
     */
    private fun groupViewsOf(ctx: Context, cfg: Cfg, s: QrPriority.Snapshot, res: QrPriority.Result = QrPriority.build(cfg, s)): Map<String, GroupView> {
        val out = HashMap<String, GroupView>()
        val gs = QrPriority.groups(cfg, s)
        if (gs.isEmpty()) return out
        val over = synchronized(LOCK) { jmap(ctx, K_HABIDX).optJSONObject(cfg.id) }
        for (g in gs) {
            var idx = res.faces[g.key] ?: g.defaultIdx
            val e = over?.optJSONObject(g.key)
            if (e != null) {
                val t = e.optLong("t", 0L)
                if (s.now >= t && s.now - t < EVENT_RESET_MS) {
                    val i = g.items.indexOfFirst { it.key == e.optString("h", "") }
                    if (i >= 0) idx = i
                }
            }
            idx = idx.coerceIn(0, g.items.size - 1)
            out[g.key] = GroupView(g.items[idx], idx, g.items.size)
        }
        return out
    }

    /** Ключ карточки-группы → элемент, который она показывает (пусто, если групп нет: нет галочек или нет элементов). */
    fun groupViews(ctx: Context, cfg: Cfg): Map<String, GroupView> {
        if (!cfg.habits && !cfg.alarms && !cfg.timers) return emptyMap()
        val app = ctx.applicationContext
        return groupViewsOf(app, cfg, snapshot(app, cfg))
    }

    /** Когда выбранные нажатием элементы групп вернутся к тем, что решает круг равных; null — ничего не выбрано. */
    private fun groupResetAt(ctx: Context, cfgId: String, now: Long): Long? {
        val per = synchronized(LOCK) { jmap(ctx, K_HABIDX).optJSONObject(cfgId) } ?: return null
        var at = Long.MAX_VALUE
        val ks = per.keys()
        while (ks.hasNext()) {
            val t = per.optJSONObject(ks.next())?.optLong("t", 0L) ?: continue
            if (t > 0L && now >= t && now - t < EVENT_RESET_MS) at = Math.min(at, t + EVENT_RESET_MS + 500L)
        }
        return if (at == Long.MAX_VALUE) null else at
    }

    /** Запоминает выбранный элемент [itemKey] карточки-группы [slotKey] виджета [cfgId] на [EVENT_RESET_MS]. */
    private fun saveGroupPick(app: Context, cfgId: String, slotKey: String, itemKey: String) {
        synchronized(LOCK) {
            val all = jmap(app, K_HABIDX)
            val per = all.optJSONObject(cfgId) ?: JSONObject()
            per.put(slotKey, JSONObject().put("h", itemKey).put("t", System.currentTimeMillis()))
            all.put(cfgId, per)
            prefs(app).edit().putString(K_HABIDX, all.toString()).apply()
        }
    }

    /**
     * Нажатие у края карточки-группы [slotKey] в виджете [widgetId] ([dir] = -1 — предыдущий элемент, 1 — следующий). Листаются ВСЕ элементы группы, а не только верхнего яруса.
     * Ряд не зациклен: у первого и последнего элемента нажатие ничего не меняет. Выбор держится [EVENT_RESET_MS] после последнего нажатия, затем снова решает круг равных;
     * стопка не сбрасывается — перерисовывается только лицо карточки.
     */
    fun groupNav(ctx: Context, widgetId: Int, slotKey: String, dir: Int) {
        if (dir != -1 && dir != 1) return
        if (!QrPriority.isGroupKey(slotKey) || !KEY_RE.matches(slotKey)) return
        val app = ctx.applicationContext
        val cfg = cfgFor(app, widgetId) ?: return
        val s = snapshot(app, cfg)
        val g = QrPriority.groups(cfg, s).firstOrNull { it.key == slotKey } ?: return
        val view = groupViewsOf(app, cfg, s)[slotKey] ?: return
        val to = (view.index + dir).coerceIn(0, Math.max(0, g.items.size - 1))
        if (to == view.index) return
        saveGroupPick(app, cfg.id, slotKey, g.items[to].key)
        // Нажатие у края — это перерисовка карточки, но НЕ «тихая»: обычный refreshAll только перезагружает данные у уже смахнутого StackView, и после этого
        // обратное смахивание к первой карточке оставляло стопку в сдвинутом положении (карточка «Будильник» съезжала). Поэтому — то же, что после двойного нажатия
        // на привычку: адаптер пересоздаётся одним полным обновлением и стопка встаёт на ту же карточку-группу (pinSlot → slotPosition в update), наверх не прыгает.
        pinSlot(cfg.id, slotKey)
        refreshAll(app, false, false, setOf(cfg.id))
    }

    /** Нажатие у края карточки «Привычки» (ScanActivity шлёт `habnav` с ключом карточки; так же приходит и нажатие у края «Будильников»): см. [groupNav]. */
    fun habitNav(ctx: Context, widgetId: Int, slotKey: String, dir: Int) = groupNav(ctx, widgetId, slotKey, dir)

    /** Копия лица карточки события с рядом точек внизу: сколько событий в ряду и какое показано (светлее). Событие одно — картинка без изменений. */
    fun withEventDots(src: Bitmap, index: Int, total: Int): Bitmap {
        if (total < 2) return src
        return try {
            val out = src.copy(Bitmap.Config.ARGB_8888, true) ?: return src
            val g = Canvas(out)
            val w = out.width.toFloat()
            val p = Paint(Paint.ANTI_ALIAS_FLAG)
            val r = w * 0.0125f
            val step = w * 0.048f
            val x0 = w / 2f - step * (total - 1) / 2f
            val y = w * 0.972f
            for (k in 0 until total) {
                p.color = Color.WHITE
                p.alpha = if (k == index) 255 else 110
                g.drawCircle(x0 + step * k, y, if (k == index) r * 1.25f else r, p)
            }
            out
        } catch (e: Throwable) {
            src // не хватило памяти — карточка без точек
        }
    }

    private fun idSet(ctx: Context, key: String): MutableSet<String> {
        val out = LinkedHashSet<String>()
        try {
            val a = JSONArray(prefs(ctx).getString(key, "[]"))
            for (i in 0 until a.length()) a.optString(i).let { if (it.isNotEmpty()) out.add(it) }
        } catch (e: Exception) {
            // повреждённая запись — считаем пустой
        }
        return out
    }

    private fun putIdSet(ctx: Context, key: String, ids: Set<String>) {
        prefs(ctx).edit().putString(key, JSONArray(ids.toList()).toString()).apply()
    }

    /** Задачи, которые считаются выполненными в виджете: ждут страницу или уже забраны ею, но состав карточек ещё старый. */
    private fun doneTaskIds(ctx: Context): Set<String> = synchronized(LOCK) { idSet(ctx, K_TDONE) + idSet(ctx, K_THIDE) }

    /**
     * Двойное нажатие на карточку задачи в виджете: id задачи встаёт в очередь (страница отметит её выполненной — `widgetTaskTake`/`widgetTaskAck`, мост ≥34),
     * показанная задача сразу уходит, на её место встаёт следующая; стопка остаётся на карточке задач (если задач больше нет — возвращается к первой карточке).
     */
    fun completeTask(ctx: Context, taskId: String) {
        if (taskId.isEmpty() || taskId.length > 80) return
        val app = ctx.applicationContext
        val cfgIds = HashSet<String>()
        synchronized(LOCK) {
            val q = idSet(app, K_TDONE)
            q.add(taskId)
            putIdSet(app, K_TDONE, q)
            for (cfg in configs(app)) if (cfg.cards.any { it.dyn == "task" && it.tid == taskId }) cfgIds.add(cfg.id)
        }
        for (id in cfgIds) pinSlot(id, "dyn:task") // остались ещё задачи — стопка остаётся на карточке задач, а не уходит к первой
        if (cfgIds.isNotEmpty()) refreshAll(app, true, false, cfgIds)
    }

    /** JSON-массив id задач, отмеченных в виджете и ещё не применённых страницей. */
    fun takeTaskDone(ctx: Context): String = synchronized(LOCK) { JSONArray(idSet(ctx, K_TDONE).toList()).toString() }

    /** Страница отметила эти задачи: из очереди они уходят в «скрытые» (до новой отправки состава карточек). */
    fun ackTaskDone(ctx: Context, idsJson: String?) {
        val app = ctx.applicationContext
        val ids = HashSet<String>()
        try {
            val a = JSONArray(idsJson ?: "[]")
            for (i in 0 until a.length()) a.optString(i).let { if (it.isNotEmpty()) ids.add(it) }
        } catch (e: Exception) {
            return
        }
        if (ids.isEmpty()) return
        synchronized(LOCK) {
            val q = idSet(app, K_TDONE)
            val h = idSet(app, K_THIDE)
            for (id in ids) if (q.remove(id)) h.add(id)
            putIdSet(app, K_TDONE, q)
            putIdSet(app, K_THIDE, h)
        }
    }

    /** После отправки состава карточек: в «скрытых» остаются только задачи, которые в нём всё ещё есть. */
    private fun pruneHiddenTasks(app: Context) {
        synchronized(LOCK) {
            val h = idSet(app, K_THIDE)
            if (h.isEmpty()) return
            val present = HashSet<String>()
            for (cfg in configs(app)) for (c in cfg.cards) if (c.dyn == "task" && c.tid.isNotEmpty()) present.add(c.tid)
            if (h.retainAll(present)) putIdSet(app, K_THIDE, h)
        }
    }

    /**
     * Нажатие на карточку-будильник в виджете (ScanActivity, extra `alarm`): без окна и страницы заводит будильник CardAlarms или, если он заведён, выключает.
     * Лицо с надписью «Заведён» меняется само (`CardAlarms` → [onAlarmsChanged]). Запись для журнала событий встаёт в очередь (`widgetAlarmTake`/`widgetAlarmAck`, мост ≥35).
     * false — карточки нет или настроек будильника у неё нет (старая отправка от страницы): окно откроет прежний путь через страницу.
     */
    fun toggleAlarm(ctx: Context, cardKey: String): Boolean {
        if (!KEY_RE.matches(cardKey)) return false
        val app = ctx.applicationContext
        val card = configs(app).asSequence().flatMap { it.cards.asSequence() }
            .firstOrNull { it.key == cardKey && it.alarmId.isNotEmpty() && it.alarmSpec != null } ?: return false
        val spec = card.alarmSpec ?: return false
        holdAlarmRow(app, cardKey)
        val now = System.currentTimeMillis()
        if (CardAlarms.isArmed(app, card.alarmId)) {
            CardAlarms.cancel(app, card.alarmId)
            queueAlarmEvent(app, JSONObject().put("id", card.alarmId).put("on", false).put("title", spec.title).put("ts", now))
        } else {
            val at = CardAlarms.set(app, card.alarmId, spec.title, spec.hour, spec.minute, spec.every, spec.times)
            if (at > 0L) {
                queueAlarmEvent(
                    app,
                    JSONObject().put("id", card.alarmId).put("on", true).put("title", spec.title).put("ts", now).put("at", at)
                        .put("h", spec.hour).put("m", spec.minute).put("every", spec.every).put("times", spec.times)
                )
            }
        }
        return true
    }

    /**
     * Повторное нажатие на карточку-таймер в виджете (ScanActivity, extra `timerstop` = ключ карточки): таймер идёт или стоит на паузе — отменяется целиком
     * (как «Стоп» в острове); лицо возвращается к заданному времени само (`CardTimers` → [onActivityChanged]). Показанный таймер при этом не меняется — [holdTimerRow].
     * false — карточки нет или у неё нет запущенного таймера.
     */
    fun stopTimer(ctx: Context, cardKey: String): Boolean {
        if (!KEY_RE.matches(cardKey)) return false
        val app = ctx.applicationContext
        val card = configs(app).asSequence().flatMap { (it.cards.asSequence() + it.timerCards.asSequence()) }
            .firstOrNull { it.key == cardKey } ?: return false
        holdTimerRow(app, cardKey)
        var stopped = false
        for (l in card.live) {
            if (l.k != "timer" || l.id.isEmpty()) continue
            if (CardTimers.faceOf(app, l.id) == null) continue
            CardTimers.cancel(app, l.id)
            stopped = true
        }
        return stopped
    }

    /**
     * Нажатие на не запущенный таймер в карточке «Таймеры» виджета (ScanActivity, extra `timerstart` = ключ карточки): таймер запускается сразу в оболочке (тот же id, что у скана кода его карточки),
     * окно с карточкой на весь экран не открывается (оно — только у скана QR-кода). Запуск встаёт в очередь для журнала событий. false — карточки или id таймера нет: окно откроет прежний путь по коду.
     */
    fun startTimer(ctx: Context, cardKey: String): Boolean {
        if (!KEY_RE.matches(cardKey)) return false
        val app = ctx.applicationContext
        val card = configs(app).asSequence().flatMap { (it.cards.asSequence() + it.timerCards.asSequence()) }
            .firstOrNull { it.key == cardKey && it.dyn == "timer" && it.sec > 0 } ?: return false
        val id = card.live.firstOrNull { it.k == "timer" && it.id.isNotEmpty() }?.id ?: return false
        holdTimerRow(app, cardKey)
        if (!CardTimers.start(app, id, card.title, card.sec.toLong(), card.hid)) return false // скрытый таймер идёт без острова и уведомления, как скрытый таймер вкладки QR-кодов
        queueTimerEvent(app, JSONObject().put("id", id).put("title", card.title).put("sec", card.sec).put("ts", System.currentTimeMillis()))
        return true
    }

    private fun queueTimerEvent(app: Context, ev: JSONObject) {
        synchronized(LOCK) {
            val p = prefs(app)
            val seq = p.getLong(K_TEVSEQ, 0L) + 1L
            val arr = try { JSONArray(p.getString(K_TEV, "[]")) } catch (e: Exception) { JSONArray() }
            arr.put(ev.put("n", seq))
            val out = JSONArray()
            for (i in maxOf(0, arr.length() - AEV_MAX) until arr.length()) out.put(arr.get(i))
            p.edit().putString(K_TEV, out.toString()).putLong(K_TEVSEQ, seq).apply()
        }
    }

    /** JSON-массив запусков таймеров в виджете {n,id,title,sec,ts}, ещё не записанных страницей в журнал событий. */
    fun takeTimerEvents(ctx: Context): String = synchronized(LOCK) { prefs(ctx).getString(K_TEV, "[]") ?: "[]" }

    /** Страница записала запуски с номерами `n` (JSON-массив) — убираем их из очереди. */
    fun ackTimerEvents(ctx: Context, nsJson: String?) {
        val ns = HashSet<Long>()
        try {
            val a = JSONArray(nsJson ?: "[]")
            for (i in 0 until a.length()) ns.add(a.optLong(i))
        } catch (e: Exception) {
            return
        }
        if (ns.isEmpty()) return
        synchronized(LOCK) {
            val p = prefs(ctx)
            val arr = try { JSONArray(p.getString(K_TEV, "[]")) } catch (e: Exception) { JSONArray() }
            val out = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optLong("n") !in ns) out.put(o)
            }
            p.edit().putString(K_TEV, out.toString()).apply()
        }
    }

    /** Как [holdAlarmRow], для карточки «Таймеры»: остановленный таймер остаётся на лице, а не уступает место соседу. */
    private fun holdTimerRow(app: Context, cardKey: String) {
        for (cfg in configs(app)) {
            if (!cfg.timers) continue
            val list = QrPriority.timerList(cfg)
            if (list.any { it.key == cardKey }) {
                saveGroupPick(app, cfg.id, QrPriority.TIMER_SLOT_KEY, cardKey)
                pinSlot(cfg.id, QrPriority.TIMER_SLOT_KEY)
            }
        }
    }

    /**
     * Нажатие в центре карточки будильников: будильник заведён/выключен, а то, какой элемент группы «главный» ([QrPriority.defaultAlarmIndex]) и чья очередь в круге, от этого меняется —
     * чтобы карточка не перескочила на другой будильник, нажатый запоминается как выбранный (на [EVENT_RESET_MS], как после нажатия у края).
     */
    private fun holdAlarmRow(app: Context, cardKey: String) {
        for (cfg in configs(app)) {
            if (!cfg.alarms) continue
            val list = QrPriority.alarmCards(cfg, snapshot(app, cfg))
            if (list.any { it.key == cardKey }) {
                saveGroupPick(app, cfg.id, QrPriority.ALARM_SLOT_KEY, cardKey)
                pinSlot(cfg.id, QrPriority.ALARM_SLOT_KEY) // и сама карточка «Будильники» остаётся на месте, что бы ни пересчитал порядок
            }
        }
    }

    private fun queueAlarmEvent(app: Context, ev: JSONObject) {
        synchronized(LOCK) {
            val p = prefs(app)
            val seq = p.getLong(K_AEVSEQ, 0L) + 1L
            val arr = try { JSONArray(p.getString(K_AEV, "[]")) } catch (e: Exception) { JSONArray() }
            arr.put(ev.put("n", seq))
            val out = JSONArray()
            for (i in maxOf(0, arr.length() - AEV_MAX) until arr.length()) out.put(arr.get(i))
            p.edit().putString(K_AEV, out.toString()).putLong(K_AEVSEQ, seq).apply()
        }
    }

    /** JSON-массив записей о будильниках, заведённых/выключенных в виджете и ещё не внесённых страницей в журнал. */
    fun takeAlarmEvents(ctx: Context): String = synchronized(LOCK) { prefs(ctx).getString(K_AEV, "[]") ?: "[]" }

    /** Страница внесла записи с этими номерами `n` (JSON-массив) — убрать их из очереди. */
    fun ackAlarmEvents(ctx: Context, nsJson: String?) {
        val ns = HashSet<Long>()
        try {
            val a = JSONArray(nsJson ?: "[]")
            for (i in 0 until a.length()) ns.add(a.optLong(i))
        } catch (e: Exception) {
            return
        }
        if (ns.isEmpty()) return
        synchronized(LOCK) {
            val p = prefs(ctx)
            val arr = try { JSONArray(p.getString(K_AEV, "[]")) } catch (e: Exception) { JSONArray() }
            val out = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optLong("n") !in ns) out.put(o)
            }
            p.edit().putString(K_AEV, out.toString()).apply()
        }
    }

    /** Двойное нажатие на карточку-привычку в виджете: карточка убирается из стопки до полуночи, что бы ни стояло в «после срабатывания». */
    fun hideHabitToday(ctx: Context, cardKey: String) = onCardFired(ctx, cardKey, true)

    /** Состояние виджета конструктора: {"day":ГГГГММДД,"hidden":[ключи],"moved":{ключ:мс}}; скрытое действует только в день записи. */
    private fun firedOf(ctx: Context, cfgId: String): JSONObject {
        val st = jmap(ctx, K_FIRED).optJSONObject(cfgId) ?: return JSONObject()
        if (st.optInt("day", 0) != dayKey()) st.put("hidden", JSONArray())
        return st
    }

    private fun hiddenKeys(ctx: Context, cfg: Cfg): Set<String> {
        val arr = firedOf(ctx, cfg.id).optJSONArray("hidden") ?: return emptySet()
        val out = HashSet<String>()
        for (i in 0 until arr.length()) out.add(arr.optString(i))
        return out
    }

    /** «Как тренировка?» ждёт оценки: у виджета включено «Спрашивать о тренировке» и есть запись без оценки. */
    private fun rpePending(ctx: Context, cfg: Cfg): Boolean = cfg.rpeAsk && QrRpe.pendingId(ctx).isNotEmpty()

    /** «Как настроение?» ждёт отметки: у виджета включено «Спрашивать о настроении», время 20:30 наступило и сегодня настроение не отмечали. */
    private fun moodPending(ctx: Context, cfg: Cfg): Boolean = cfg.moodAsk && QrMood.pending(ctx)

    /** Какая-нибудь из служебных карточек («Как тренировка?», «Как настроение?») сейчас стоит наверху стопки этого виджета. */
    private fun servicePending(ctx: Context, cfg: Cfg): Boolean = rpePending(ctx, cfg) || moodPending(ctx, cfg)

    /** Собирает из источников оболочки всё, что нужно [QrPriority] для расчёта порядка виджета [cfg]. Живые занятия читаются только при «релевантности». */
    private fun snapshot(ctx: Context, cfg: Cfg): QrPriority.Snapshot {
        val now = System.currentTimeMillis()
        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        val rel = cfg.relevance
        val timers = HashSet<String>()
        if (rel) for (c in cfg.cards) for (l in c.live) if (l.k == "timer" && l.id.isNotEmpty() && CardTimers.hasId(ctx, l.id)) timers.add(l.id)
        if (cfg.timers) for (c in QrPriority.timerList(cfg)) for (l in c.live) if (l.k == "timer" && l.id.isNotEmpty() && CardTimers.faceOf(ctx, l.id) != null) timers.add(l.id) // карточке «Таймеры» идущие таймеры нужны и без «релевантности»
        val moved = HashMap<String, Long>()
        val mv = firedOf(ctx, cfg.id).optJSONObject("moved")
        if (mv != null) {
            val ks = mv.keys()
            while (ks.hasNext()) {
                val k = ks.next()
                moved[k] = mv.optLong(k, 0L)
            }
        }
        val st = WorkoutTracker.status
        val hasAlarms = cfg.cards.any { it.alarmId.isNotEmpty() && (rel || it.dyn == "alarm") } // карточке «Будильники» заведённые и звонящие нужны и без «релевантности» (какой будильник показать)
        val ringing: Set<String> = if (hasAlarms) CardAlarms.ringingIds(ctx) else emptySet()
        return QrPriority.Snapshot(
            now = now, cal = cal,
            workoutActive = rel && (st == WorkoutTracker.ST_SEARCH || st == WorkoutTracker.ST_RUN || st == WorkoutTracker.ST_PAUSE),
            pomodoroActive = rel && PomodoroTimer.isActive(ctx),
            stopwatchActive = rel && StopwatchTimer.isActive(ctx),
            activeTimerIds = timers,
            alarms = if (hasAlarms) CardAlarms.nextTimes(ctx) else emptyMap(),
            ringingAlarmIds = ringing,
            batteryPercent = if (rel && cfg.anyBattery) QrBattery.phoneLevel(ctx) else -1,
            lastTopKey = if (rel) jmap(ctx, K_LASTTOP).optString(cfg.id, "") else "",
            hiddenKeys = hiddenKeys(ctx, cfg),
            movedAt = moved,
            doneTaskIds = doneTaskIds(ctx),
            rpePending = rpePending(ctx, cfg),
            moodPending = moodPending(ctx, cfg),
            eventIndex = if (cfg.events) eventIndexOf(ctx, cfg.id, now) else 0,
            taskIndex = if (cfg.tasks) rowIndexOf(ctx, K_TKIDX, cfg.id, now) else 0,
            alarmRowRinging = cfg.cards.any { it.dyn == "alarm" && it.alarmId in ringing }
        )
    }

    /** Порядок стопки по [QrPriority]; в отладочной сборке результат ещё проверяется ([QrPriority.check]), нарушение пишется в лог и показ не ломает. */
    private fun plan(ctx: Context, cfg: Cfg): QrPriority.Result {
        val s = snapshot(ctx, cfg)
        val res = QrPriority.build(cfg, s)
        if (cfg.relevance && res.mainTopKey != s.lastTopKey) rememberTop(ctx, cfg.id, res.mainTopKey)
        rememberWhy(ctx, cfg.id, whyOf(res, if (QrPriority.isGroupKey(res.topKey)) groupViewsOf(ctx, cfg, s, res) else emptyMap()))
        if ((ctx.applicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            try {
                for (v in QrPriority.check(res, cfg, s)) Log.e("QrPriority", cfg.id + ": " + v)
            } catch (e: Exception) {
                Log.e("QrPriority", "check: " + e)
            }
        }
        return res
    }

    /** Запоминает верхнюю карточку по релевантности: следующий расчёт не отдаст верх новой карточке без заметного отрыва. */
    private fun rememberTop(ctx: Context, cfgId: String, key: String) {
        synchronized(LOCK) {
            val t = jmap(ctx, K_LASTTOP)
            if (t.optString(cfgId, "") == key) return
            t.put(cfgId, key)
            prefs(ctx).edit().putString(K_LASTTOP, t.toString()).apply()
        }
    }

    /** `{key, title, reason}` верхней карточки. У карточки-группы — заголовок элемента, который она реально показывает: по очереди круга ([QrPriority.Result.topTitle]) или выбранного нажатием у края ([views]). */
    private fun whyOf(res: QrPriority.Result, views: Map<String, GroupView> = emptyMap()): JSONObject {
        var title = res.topTitle
        var reason = res.topReason
        val v = views[res.topKey]
        if (v != null && v.card.title != title) { title = v.card.title; reason = "Выбрано нажатием у края карточки" }
        return JSONObject().put("key", res.topKey).put("title", title).put("reason", reason)
    }

    /** Запоминает, какая карточка сейчас наверху виджета и почему (пишет только при изменении: расчёт идёт при каждой перерисовке). */
    private fun rememberWhy(ctx: Context, cfgId: String, why: JSONObject) {
        synchronized(LOCK) {
            val t = jmap(ctx, K_WHY)
            if (t.optJSONObject(cfgId)?.toString() == why.toString()) return
            t.put(cfgId, why)
            prefs(ctx).edit().putString(K_WHY, t.toString()).apply()
        }
    }

    /**
     * `{"key","title","reason"}` — какая карточка сейчас наверху виджета конструктора [cfgId] и почему (мост `widgetWhy`, страница пишет это в форме виджета);
     * `key` пуст — ничего не выделено. Берётся то, что показал последний расчёт; если виджет ещё не считался — считается сейчас, без запоминания верхней карточки.
     * Пустая строка — такого виджета нет.
     */
    fun whyJson(ctx: Context, cfgId: String): String {
        val app = ctx.applicationContext
        val cfg = configs(app).firstOrNull { it.id == cfgId } ?: return ""
        val mgr = AppWidgetManager.getInstance(app)
        val placed = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java)).any { cfgFor(app, it)?.id == cfgId }
        val saved = if (placed) jmap(app, K_WHY).optJSONObject(cfgId) else null // не стоящий на рабочем столе виджет мог остаться в памяти от прежнего расчёта
        if (saved != null) return saved.toString()
        return whyOf(QrPriority.build(cfg, snapshot(app, cfg))).toString()
    }

    fun visibleCount(ctx: Context, cfg: Cfg): Int = QrPriority.visibleCount(cfg, snapshot(ctx, cfg))

    /** Все карточки виджета скрыты («На сегодня больше ничего»). */
    fun isAllDone(ctx: Context, cfg: Cfg): Boolean = (cfg.cards.isNotEmpty() || cfg.tasks || cfg.events || cfg.alarms || cfg.habits || cfg.timers || cfg.rpeAsk || cfg.moodAsk) && visibleCount(ctx, cfg) == 0

    /**
     * Действие карточки [cardKey] сработало (нажатие в виджете, в приложении или скан): у карточек с «после срабатывания» = «скрывать» она
     * убирается из стопки до конца дня, с «в конец» — уходит в конец стопки. Виджеты, где карточки нет или выбрано «ничего», не трогаются.
     */
    fun onCardFired(ctx: Context, cardKey: String, forceHide: Boolean = false) {
        if (!KEY_RE.matches(cardKey)) return
        val app = ctx.applicationContext
        val touchedCfgs = HashSet<String>()
        synchronized(LOCK) {
            val all = jmap(app, K_FIRED)
            for (cfg in configs(app)) {
                val card = cfg.cards.firstOrNull { it.key == cardKey } ?: cfg.habitCards.firstOrNull { it.key == cardKey } ?: continue // привычка карточки «Привычки» — не среди cfg.cards
                if (forceHide && !card.habit) continue
                if (card.after == "none" && !forceHide) continue
                val st = firedOf(app, cfg.id)
                st.put("day", dayKey())
                if (card.after == "hide" || forceHide) {
                    val arr = st.optJSONArray("hidden") ?: JSONArray()
                    var has = false
                    for (i in 0 until arr.length()) if (arr.optString(i) == cardKey) has = true
                    if (!has) arr.put(cardKey)
                    st.put("hidden", arr)
                } else {
                    val mv = st.optJSONObject("moved") ?: JSONObject()
                    mv.put(cardKey, System.currentTimeMillis())
                    st.put("moved", mv)
                }
                all.put(cfg.id, st)
                touchedCfgs.add(cfg.id)
                // привычка группы «Привычки» или будильник группы «Будильники»: остаться на этой карточке, пока в группе есть что делать (в update — на неё же, а не на первую)
                if (cfg.habitCards.any { it.key == cardKey }) pinSlot(cfg.id, QrPriority.HABIT_SLOT_KEY)
                else if (card.dyn == "alarm" && card.alarmId.isNotEmpty()) pinSlot(cfg.id, QrPriority.ALARM_SLOT_KEY)
            }
            if (touchedCfgs.isNotEmpty()) prefs(app).edit().putString(K_FIRED, all.toString()).apply()
        }
        if (touchedCfgs.isEmpty()) return
        // Стопка пересоздаётся ОДНИМ полным обновлением: встаёт на ту же карточку-группу, если в ней остались элементы, иначе на первую из оставшихся (положение — в том же RemoteViews, до перезагрузки данных,
        // адаптер создаётся заново): отдельное partiallyUpdateAppWidget(setDisplayedChild) после notifyAppWidgetViewDataChanged гонялось с
        // перезагрузкой карточек (после двойного нажатия по привычке стопка переставала листаться).
        refreshAll(app, true, false, touchedCfgs)
    }

    /**
     * Порядок стопки (считает [QrPriority.build]). Без «релевантности» — как собрал пользователь (скрытые убраны, перенесённые в конец — в конце). С ней сверху то,
     * что идёт сейчас (важнее — выше: тренировка, помодоро, таймер, секундомер), затем карточки, у которых сейчас «их» время суток и день, затем остальные в
     * исходном порядке. Карточки, перенесённые «в конец» сегодня, всегда в самом конце (по времени переноса) — даже если они идут сейчас или у них «их» время;
     * со следующего дня они снова участвуют в подборе. Над всеми — «Как тренировка?», пока она ждёт оценки.
     * [Ordered.topKey] — ключ карточки наверху, если она поднята по релевантности (иначе пусто).
     */
    fun order(ctx: Context, cfg: Cfg, widgetId: Int = -1): Ordered {
        val res = plan(ctx, cfg)
        val cards = res.cards.map { it.card }
        // движение отложено (пользователь работает с карточками): порядок, в котором стопка показана, не меняется — меняются только лица карточек
        val fz = if (widgetId >= 0) synchronized(motionLock) { frozenSlots[widgetId] } else null
        return Ordered(if (fz != null) QrPriority.Motion.reorderBySlots(fz, cards) { slotOf(it) } else cards, res.topKey)
    }

    /** Фабрика загрузила карточки виджета [widgetId]: запоминаем порядок слотов, который сейчас показан (его замораживает [freeze]). */
    fun noteShown(widgetId: Int, cards: List<Card>) {
        if (widgetId < 0) return
        synchronized(motionLock) { shownSlots[widgetId] = cards.map { slotOf(it) } }
    }

    // ---------- обновление ----------

    /** У виджета есть «верхняя карточка», к которой стопка возвращается: «по релевантности», служебные «Как тренировка?» / «Как настроение?» или идущий таймер карточки «Таймеры». */
    private fun tracksTop(cfg: Cfg): Boolean = cfg.relevance || cfg.rpeAsk || cfg.moodAsk || cfg.timers

    fun update(ctx: Context, mgr: AppWidgetManager, id: Int, resetTop: Boolean = false, rebuild: Boolean = false, intent: QrPriority.Motion.Kind? = null) {
        val app = ctx.applicationContext
        ensureScreenReceiver(app)
        val wasBound = isBound(app, id)
        if (!wasBound) claimPending(app, id)
        val fresh = !wasBound && isBound(app, id) // виджет только что положили на экран: стопка обязана стоять на первой карточке порядка
        val cfg = cfgFor(app, id)
        if (cfg != null && cfg.anyBattery) QrBattery.register(app)
        val rv = RemoteViews(app.packageName, R.layout.qr_widget)
        applyHostLayout(app, rv, hostSizeDp(app, mgr, id))
        // Нужно ли поставить стопку на верхнюю карточку. Одиночный setDisplayedChild(0) у уже смахнутой стопки позицию не менял (так «возврат» молча не срабатывал),
        // поэтому любой сброс наверх — всегда полное пересоздание адаптера (то же, что в onCardFired, там это работает).
        val topNew = if (cfg != null && tracksTop(cfg)) plan(app, cfg).anchorKey else ""
        val topOld = jmap(app, K_TOP).optString(id.toString(), "")
        val trackTop = cfg != null && tracksTop(cfg)
        var moveTop = fresh || (trackTop && (resetTop || topNew != topOld))
        var doRebuild = rebuild || moveTop
        // Единое решение о движении (QrPriority.Motion): виджет только что положили / пользователь сам сделал действие — двигаем сразу; смена верхней карточки без
        // участия пользователя ждёт, пока он работает с карточками (или пока экран выключен); тогда стопка не пересоздаётся, а её порядок замораживается.
        if (doRebuild) {
            val kind = when {
                fresh -> QrPriority.Motion.Kind.PLACED
                resetTop || rebuild -> intent ?: QrPriority.Motion.Kind.STAY_ON_SLOT
                else -> QrPriority.Motion.Kind.NEW_TOP
            }
            val dec = motionDecide(app, kind)
            if (dec.action == QrPriority.Motion.Action.MOVE_NOW) {
                thaw(id)
            } else {
                doRebuild = false
                moveTop = false
                if (dec.action == QrPriority.Motion.Action.DEFER) onDeferred(app, id, kind, dec)
                else Log.d("QrMotion", "id=" + id + " " + kind + " → " + dec.action + ": " + dec.reason)
            }
        }
        // Принцип «остаться на карточке»: недавнее действие на карточке-группе / карточке задач ([pinSlot]) — стопка пересоздаётся, но встаёт на неё же, а не на первую
        val pinned = if (doRebuild && !fresh && cfg != null) pinnedSlot(cfg.id) else ""
        val showAt = if (pinned.isNotEmpty() && cfg != null) slotPosition(app, cfg, pinned) else 0
        val svc = Intent(app, QrWidgetService::class.java)
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        // rebuild: новая версия адаптера (другой intent — система создаёт RemoteViewsAdapter и фабрику заново); иначе версия прежняя и адаптер живёт
        val rev = synchronized(adapterRev) {
            if (doRebuild) adapterRev[id] = (adapterRev[id] ?: 0) + 1
            adapterRev[id] ?: 0
        }
        svc.putExtra("rev", rev)
        svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
        rv.setRemoteAdapter(R.id.qr_stack, svc)
        rv.setEmptyView(R.id.qr_stack, R.id.qr_empty)
        val allDone = cfg != null && isAllDone(app, cfg)
        rv.setTextViewText(
            R.id.qr_empty,
            if (cfg == null) "Виджет не выбран.\nОткройте приложение → «Конструктор виджетов»"
            else if (allDone) "На сегодня больше ничего"
            else "В виджете нет карточек.\nДобавьте их в конструкторе"
        )
        // все карточки скрыты — полупрозрачная плашка, как папка на телефонах Xiaomi; иначе обычная сиреневая
        rv.setInt(R.id.qr_empty, "setBackgroundResource", if (allDone) R.drawable.qr_widget_done_bg else R.drawable.qr_widget_empty_bg)
        rv.setTextViewTextSize(R.id.qr_empty, android.util.TypedValue.COMPLEX_UNIT_SP, if (allDone) 14f else 12f)
        // Вертикальный столбец белых кружков (точки положения в стопке) убран совсем: вид всегда GONE
        rv.setViewVisibility(R.id.qr_dots, android.view.View.GONE)
        val tpl = Intent(app, ScanActivity::class.java)
        tpl.action = ScanActivity.ACTION_SCAN_CODE
        tpl.putExtra("tok", token(app))
        tpl.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        rv.setPendingIntentTemplate(R.id.qr_stack, PendingIntent.getActivity(app, id, tpl, flags))

        if (doRebuild) {
            rv.setDisplayedChild(R.id.qr_stack, showAt) // тем же обновлением, что и данные: стопка показывает первую карточку (или ту, на которой только что было действие)
            clearReturn(app, id)
        }
        if (trackTop && moveTop) { // верх записывается, только когда стопка действительно переставлена (отложенное движение оставляет прежний)
            synchronized(LOCK) {
                val t = jmap(app, K_TOP)
                t.put(id.toString(), topNew)
                prefs(app).edit().putString(K_TOP, t.toString()).apply()
            }
        }
        if (doRebuild) synchronized(placedAt) { placedAt[id] = SystemClock.uptimeMillis() }
        suppressSwipe(id) // перерисовка и перезагрузка карточек — не смахивание
        dotsOn.remove(id)
        mgr.updateAppWidget(id, rv)
        mgr.notifyAppWidgetViewDataChanged(id, R.id.qr_stack)
    }

    // ---------- размер области виджета ----------

    /** Сторона карточки (dp), если лаунчер не сообщил размер области. */
    private const val DEFAULT_SIDE_DP = 175f

    /** Радиус скругления лица карточки — 12 % ширины (как в widgets.js `drawFace`). */
    internal const val FACE_RADIUS = 0.12f

    /** Тело карточки и цветной выступ снизу, доли ширины — те же `FACE_BODY`/`FACE_SHADE` в widgets.js. */
    internal const val FACE_BODY = 1.02f
    internal const val FACE_SHADE = 0.04f

    /** Высота картинки карточки / её ширина (≈1,06): к этой пропорции приводится область виджета. */
    private const val FACE_ASPECT = FACE_BODY + FACE_SHADE

    /** Размер области, отданной виджету лаунчером: [ширина, высота] в dp; null — лаунчер не сообщил (тогда карточка занимает всю область). */
    private fun hostSizeDp(ctx: Context, mgr: AppWidgetManager, id: Int): FloatArray? {
        val o = try { mgr.getAppWidgetOptions(id) } catch (e: Exception) { null } ?: return null
        val land = ctx.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val w = o.getInt(if (land) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val h = o.getInt(if (land) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
        return if (w > 0 && h > 0) floatArrayOf(w.toFloat(), h.toFloat()) else null
    }

    /**
     * Картинка карточки имеет пропорцию [FACE_ASPECT] (высота/ширина) и занимает ВСЮ область виджета (см. layout/qr_widget.xml). Область
     * у лаунчера почти такая же; если она заметно (больше 8 %) выше или шире — у `qr_root` выставляются отступы, чтобы картинка не
     * растягивалась. Радиус контура обрезки (`qr_clip`) подбирается под радиус лица карточки (12 % ширины), шаг 2 dp.
     */
    private fun applyHostLayout(ctx: Context, rv: RemoteViews, size: FloatArray?) {
        val d = ctx.resources.displayMetrics.density
        var padX = 0
        var padY = 0
        var sideDp = DEFAULT_SIDE_DP
        if (size != null) {
            val w = size[0]
            val h = size[1]
            sideDp = Math.min(w, h / FACE_ASPECT)
            val idealH = w * FACE_ASPECT
            if (h > idealH * 1.08f) {
                padY = Math.round((h - idealH) / 2f * d)
            } else if (h < idealH / 1.08f) {
                padX = Math.round((w - h / FACE_ASPECT) / 2f * d)
            }
        }
        rv.setViewPadding(R.id.qr_root, padX, padY, padX, padY)
        val r = (Math.round(sideDp * FACE_RADIUS / 2f) * 2).coerceIn(16, 26)
        val res = when (r) {
            16 -> R.drawable.qr_widget_clip_16
            18 -> R.drawable.qr_widget_clip_18
            20 -> R.drawable.qr_widget_clip_20
            22 -> R.drawable.qr_widget_clip_22
            24 -> R.drawable.qr_widget_clip_24
            else -> R.drawable.qr_widget_clip_26
        }
        rv.setInt(R.id.qr_clip, "setBackgroundResource", res)
    }

    /** Лаунчер изменил размер виджета: пересчитать отступы и контур, не трогая карточки (стопка остаётся на месте). */
    fun updateHostLayout(ctx: Context, mgr: AppWidgetManager, id: Int) {
        val app = ctx.applicationContext
        val rv = RemoteViews(app.packageName, R.layout.qr_widget)
        applyHostLayout(app, rv, hostSizeDp(app, mgr, id))
        mgr.partiallyUpdateAppWidget(id, rv)
    }

    fun refreshAll(ctx: Context, resetTop: Boolean = false, forceAlarms: Boolean = false, rebuildCfgs: Set<String> = emptySet()) {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        for (id in ids) {
            try {
                val rebuild = rebuildCfgs.isNotEmpty() && cfgFor(app, id)?.id in rebuildCfgs
                // сброс наверх после действия касается только затронутого виджета (`rebuildCfgs`): стопки остальных не двигаются
                update(app, mgr, id, resetTop && (rebuildCfgs.isEmpty() || rebuild), rebuild)
            } catch (e: Exception) {
                // один сбойный виджет не мешает остальным
            }
        }
        scheduleAll(app, ids, forceAlarms)
    }

    /** Будильник карточки заведён, выключен или отзвонил: если в виджетах есть карточка-будильник, перерисовываем их (лицо «Заведён» меняется). */
    fun onAlarmsChanged(ctx: Context) {
        val app = ctx.applicationContext
        main.removeCallbacksAndMessages(alarmToken)
        main.postAtTime({
            try {
                if (configs(app).any { cfg -> cfg.cards.any { it.alarmId.isNotEmpty() } }) refreshAll(app)
            } catch (e: Exception) {
                // обновление виджета не должно ронять приложение
            }
        }, alarmToken, SystemClock.uptimeMillis() + 300L)
    }

    /** Вызывается при старте/остановке таймера, помодоро, секундомера и тренировки: обновляем виджеты «по релевантности» (не чаще раза в 0,4 с). */
    fun onActivityChanged(ctx: Context) {
        val app = ctx.applicationContext
        main.removeCallbacksAndMessages(refreshToken)
        main.postAtTime({
            try {
                if (configs(app).any { it.relevance || it.timers }) refreshAll(app)
            } catch (e: Exception) {
                // обновление виджета не должно ронять приложение
            }
        }, refreshToken, SystemClock.uptimeMillis() + 400L)
    }

    /**
     * Появилась или пропала запись без оценки нагрузки (тренировка закончилась, оценка поставлена в виджете или в приложении): виджеты с галочкой
     * «Спрашивать о тренировке» перерисовываются — карточка «Как тренировка?» встаёт наверх или уходит; стопка при этом показывает верхнюю карточку.
     */
    fun onRpeChanged(ctx: Context) {
        val app = ctx.applicationContext
        try {
            if (configs(app).any { it.rpeAsk }) refreshAll(app)
        } catch (e: Exception) {
            // обновление виджета не должно ронять приложение
        }
    }

    /**
     * Настроение отмечено (кнопкой карточки в виджете или в приложении — страница сообщила время последней отметки): виджеты с галочкой «Спрашивать о настроении»
     * перерисовываются — карточка «Как настроение?» уходит (или встаёт наверх, если отметку удалили до 20:30 следующего дня и т. п.); стопка показывает верхнюю карточку.
     */
    fun onMoodChanged(ctx: Context) {
        val app = ctx.applicationContext
        try {
            if (configs(app).any { it.moodAsk }) refreshAll(app)
        } catch (e: Exception) {
            // обновление виджета не должно ронять приложение
        }
    }

    // ---------- слайд-шоу и границы времени суток ----------

    private fun am(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun setAlarm(ctx: Context, at: Long, pi: PendingIntent) {
        if (Build.VERSION.SDK_INT >= 23) am(ctx).setAndAllowWhileIdle(AlarmManager.RTC, at, pi) else am(ctx).set(AlarmManager.RTC, at, pi)
    }

    private fun immutable(): Int = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0

    private fun rotatePi(ctx: Context, id: Int, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_ROTATE
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 5000 + id, i, f)
    }

    private fun tickPi(ctx: Context, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_TICK
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 4999, i, f)
    }

    private fun batteryPi(ctx: Context, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_BATTERY
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 4998, i, f)
    }

    /** Будильник серии проверок заряда: один на все устройства, новое подключение заменяет прежнюю серию. */
    private fun btBurstPi(ctx: Context, step: Int, since: Long, connected: Boolean): PendingIntent {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_BT_BURST
        i.putExtra(EXTRA_STEP, step)
        i.putExtra(EXTRA_SINCE, since)
        i.putExtra(EXTRA_CONNECTED, connected)
        return PendingIntent.getBroadcast(ctx, 4997, i, PendingIntent.FLAG_UPDATE_CURRENT or immutable())
    }

    private fun returnPi(ctx: Context, id: Int, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_RETURN
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 100_000 + id, i, f)
    }

    private fun cancelRotate(ctx: Context, id: Int) {
        rotatePi(ctx, id, false)?.let { am(ctx).cancel(it); it.cancel() }
    }

    private fun nextBoundary(): Long = QrPriority.nextBoundary(System.currentTimeMillis(), Calendar.getInstance())

    private fun scheduleAll(app: Context, ids: IntArray, force: Boolean) {
        var anyRel = false
        var anyHide = false
        var anyBattery = false
        var dynAt = Long.MAX_VALUE
        for (id in ids) {
            val cfg = cfgFor(app, id)
            if (cfg != null && cfg.anyBattery) anyBattery = true
            if (cfg != null && (cfg.tasks || cfg.events || cfg.relevance || cfg.moodAsk || cfg.habits || cfg.alarms || cfg.timers)) dynAt = Math.min(dynAt, nextDynChange(app, cfg))
            if (cfg != null && cfg.rotate && visibleCount(app, cfg) > 1) {
                if (force || rotatePi(app, id, false) == null) {
                    cancelRotate(app, id)
                    setAlarm(app, System.currentTimeMillis() + cfg.rotateMin * 60_000L, rotatePi(app, id, true)!!)
                }
            } else cancelRotate(app, id)
            if (cfg != null && cfg.relevance) anyRel = true
            if (cfg != null && (cfg.habits || cfg.timers || cfg.cards.any { it.after == "hide" || it.habit })) anyHide = true // скрытое возвращается в полночь; привычки и таймеры «в своё время» меняют состав в границы времени суток
        }
        var tickAt = if (anyRel || anyHide) nextBoundary() else Long.MAX_VALUE
        tickAt = Math.min(tickAt, dynAt)
        if (tickAt != Long.MAX_VALUE) setAlarm(app, tickAt, tickPi(app, true)!!)
        else tickPi(app, false)?.let { am(app).cancel(it); it.cancel() }
        armCycle(app, ids)
        if (anyBattery) {
            QrBattery.register(app)
            if (force || batteryPi(app, false) == null) setAlarm(app, System.currentTimeMillis() + BATTERY_EVERY_MS, batteryPi(app, true)!!)
        } else batteryPi(app, false)?.let { am(app).cancel(it); it.cancel() }
    }

    /**
     * Когда у идущего таймера карточки «Таймеры» в кольце меняется число ([QrTimerFace.numberText]): число — остаток в минутах, округлённый вверх, поэтому оно становится
     * `m - 1` в момент, когда остаток доходит до `(m - 1)` минут (таймер на 23 минуты: «22» ровно в 22:00, а не в ближайшую календарную минуту). Последняя минута («1») больше
     * не меняется. [Long.MAX_VALUE] — идущих таймеров нет.
     */
    private fun nextTimerFlip(app: Context, cfg: Cfg): Long {
        var at = Long.MAX_VALUE
        for (c in QrPriority.timerList(cfg)) for (l in c.live) {
            if (l.k != "timer" || l.id.isEmpty()) continue
            val f = CardTimers.faceOf(app, l.id) ?: continue
            if (!f.running || f.leftMs <= 0L) continue
            val now = System.currentTimeMillis()
            val m = Math.max(1L, ((f.leftMs + 999L) / 1000L + 59L) / 60L)
            if (m < 2L) continue
            at = Math.min(at, now + f.leftMs - (m - 1L) * 60_000L + FLIP_MARGIN_MS)
        }
        return at
    }

    /**
     * Круг равных ([QrPriority.build]): раз в минуту наверху другая карточка (или другой элемент карточки-группы), поэтому, пока у какого-нибудь виджета «по релевантности» в верхнем ярусе две очереди
     * и больше ([QrPriority.Result.cycleAt]), ставим обработчик на начало следующей минуты: экран включён — перерисовка ([refreshAll] перестроит стопку и снова
     * взведёт обработчик), выключен — ничего не рисуем и ждём следующей минуты (будильник ради круга не нужен: см. [QrPriority.Result.cycleAt]).
     */
    private fun armCycle(app: Context, ids: IntArray) {
        var at = Long.MAX_VALUE
        for (id in ids) {
            val cfg = cfgFor(app, id) ?: continue
            if (!cfg.relevance && !cfg.timers) continue
            val res = plan(app, cfg)
            if (cfg.relevance) at = Math.min(at, res.cycleAt)
            at = Math.min(at, res.minuteAt) // пока идёт таймер, раз в минуту перерисовываем кольцо (при любом режиме)
            if (cfg.timers) at = Math.min(at, nextTimerFlip(app, cfg)) // и точно в момент, когда у идущего таймера меняется число минут
        }
        main.removeCallbacksAndMessages(cycleToken)
        if (at == Long.MAX_VALUE) return
        val delay = Math.max(250L, at - System.currentTimeMillis())
        main.postAtTime({
            try {
                val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
                if (screenOn(pm)) refreshAll(app)
                else armCycle(app, AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java)))
            } catch (e: Exception) {
                Log.e("QrCycle", "cycle: " + e)
            }
        }, cycleToken, SystemClock.uptimeMillis() + delay)
    }

    // ---------- карточка заряда ----------

    @Volatile private var lastBatterySig = ""
    @Volatile private var lastBatteryLow = false

    /** Перерисовать карточку заряда в виджетах, где она включена, но только если заряд телефона или наушников изменился (или [force]). */
    fun onBatteryChanged(ctx: Context, force: Boolean = false) {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java)).filter { cfgFor(app, it)?.anyBattery == true }
        if (ids.isEmpty()) return
        val multi = ids.any { cfgFor(app, it)?.batteryMulti == true }
        val sig = QrBattery.signature(app) + if (multi) "|" + QrBattery.signatureMulti(app) else ""
        if (!force && sig == lastBatterySig) return
        lastBatterySig = sig
        // порог «низкий заряд» пересечён: при «релевантности» карточка заряда поднимается (или опускается) — пересчёт порядка и, если сменился верх, возврат стопки
        val low = QrBattery.phoneLevel(app).let { it in 0..QrPriority.BATTERY_LOW_PERCENT }
        val lowChanged = low != lastBatteryLow
        lastBatteryLow = low
        for (id in ids) {
            try {
                if (lowChanged && cfgFor(app, id)?.relevance == true) {
                    update(app, mgr, id)
                    continue
                }
                mgr.notifyAppWidgetViewDataChanged(id, R.id.qr_stack)
            } catch (e: Exception) {
                // виджет удалили
            }
        }
    }

    /** Будильник `ACTION_BATTERY`: обновляет карточку заряда (экран погашен — не будим) и ставит следующий через 5 минут. */
    fun onBatteryTick(ctx: Context) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) {
            batteryPi(app, false)?.let { am(app).cancel(it); it.cancel() }
            return
        }
        QrBattery.register(app)
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (screenOn(pm)) onBatteryChanged(app)
        setAlarm(app, System.currentTimeMillis() + BATTERY_EVERY_MS, batteryPi(app, true)!!)
    }

    /**
     * Bluetooth-устройство (любое: наушники, часы, колонка…) подключилось или отключилось. Подключение: заряд устройство сообщает не сразу
     * (от нескольких секунд до полминуты), поэтому проверяем серией — через 6, 15, 30, 60 и 120 с, пока у всех подключённых устройств
     * свежий заряд не станет известен ([onBtBurst]). Отключение: одна перерисовка через 6 с, чтобы карточка убрала устройство.
     */
    fun onBluetoothChanged(ctx: Context, connected: Boolean = true) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) return
        // наушники сообщают заряд сразу после подключения (за секунды): приёмник нужно поднять сейчас, а не по будильнику, иначе значение пропустим
        QrBattery.register(app)
        val now = System.currentTimeMillis()
        setAlarm(app, now + BT_BURST_AT[0], btBurstPi(app, 0, now - BT_SINCE_SLACK_MS, connected))
        // быстрые проверки: первая — без паузы (устройство уже отмечено подключённым), дальше каждые доли секунды; новое событие заменяет прежнюю серию
        val gen = ++btFastGen
        val since = now - BT_SINCE_SLACK_MS
        for (at in if (connected) BT_FAST_AT else BT_FAST_OFF_AT) {
            val run = Runnable {
                if (gen != btFastGen) return@Runnable
                try {
                    onBatteryChanged(app)
                } catch (e: Throwable) {
                    // виджет не должен ронять приложение
                }
                if (connected && QrBattery.settled(app, since)) btFastGen++ // заряд всех подключённых уже известен — остальные проверки не нужны
            }
            if (at == 0L) run.run() else main.postDelayed(run, at)
        }
    }

    @Volatile private var btFastGen = 0

    /**
     * Шаг серии проверок [step] после подключения: перерисовывает карточки заряда (если что-то изменилось — на погашенном экране тоже,
     * это дёшево) и, если заряд подключённых устройств ещё не весь известен, ставит следующий шаг. После последнего шага серия кончается;
     * дальше работают обычный будильник раз в 5 минут и вещание о смене заряда.
     */
    fun onBtBurst(ctx: Context, step: Int, since: Long, connected: Boolean) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) return
        QrBattery.register(app)
        onBatteryChanged(app)
        if (!connected) return
        if (QrBattery.settled(app, since)) return
        val next = step + 1
        if (next >= BT_BURST_AT.size) return
        setAlarm(app, System.currentTimeMillis() + (BT_BURST_AT[next] - BT_BURST_AT[step]), btBurstPi(app, next, since, true))
    }

    @Suppress("DEPRECATION")
    private fun screenOn(pm: PowerManager): Boolean = if (Build.VERSION.SDK_INT >= 20) pm.isInteractive else pm.isScreenOn

    /** Будильник слайд-шоу: листает стопку на одну карточку и ставит следующий (телефон с погашенным экраном не будим). */
    fun rotate(ctx: Context, id: Int) {
        val app = ctx.applicationContext
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.rotate || visibleCount(app, cfg) < 2) return
        // единое решение о движении: пользователь только что трогал карточки (нажатие или смахивание) — не листаем, срок переносится на конец паузы
        val dec = motionDecide(app, QrPriority.Motion.Kind.ROTATE)
        if (dec.action == QrPriority.Motion.Action.DEFER && dec.at != QrPriority.Motion.AT_SCREEN_ON) {
            Log.d("QrMotion", "rotate id=" + id + " отложено: " + dec.reason)
            setAlarm(app, dec.at, rotatePi(app, id, true)!!)
            return
        }
        if (dec.action == QrPriority.Motion.Action.MOVE_NOW && !servicePending(app, cfg)) { // пока висит «Как тренировка?» или «Как настроение?», слайд-шоу стопку не листает
            val rv = RemoteViews(app.packageName, R.layout.qr_widget)
            rv.showPrevious(R.id.qr_stack) // позиции стопки идут в обратную сторону (QrWidgetService.getViewAt): «позиция − 1» — это следующая карточка
            suppressSwipe(id)
            AppWidgetManager.getInstance(app).partiallyUpdateAppWidget(id, rv)
        }
        setAlarm(app, System.currentTimeMillis() + cfg.rotateMin * 60_000L, rotatePi(app, id, true)!!)
    }

    /** Пользователь тронул карточки виджета (нажатие — из ScanActivity, смахивание — [onPossibleSwipe]): стопка стоит на месте [QrPriority.Motion.INTERACTION_PAUSE_MS] (после смахивания [QrPriority.Motion.DEEP_QUIET_MS]); [swipe] — это смахивание. */
    fun noteTouch(ctx: Context, swipe: Boolean = false) {
        val now = System.currentTimeMillis()
        lastTouchAt = now
        lastTouchSwipe = swipe
        try { prefs(ctx).edit().putLong(K_TOUCH, now).putBoolean(K_TOUCH_SWIPE, swipe).apply() } catch (e: Exception) { }
    }

    private fun touchedAt(app: Context): Long = Math.max(lastTouchAt, prefs(app).getLong(K_TOUCH, 0L))

    /** Последнее касание было смахиванием (память процесса новее сохранённого — берём её, иначе сохранённое). */
    private fun touchWasSwipe(app: Context): Boolean =
        if (lastTouchAt > 0L && lastTouchAt >= prefs(app).getLong(K_TOUCH, 0L)) lastTouchSwipe else prefs(app).getBoolean(K_TOUCH_SWIPE, false)

    // ---------- диспетчер движения: исполнитель ----------

    /** Решение [QrPriority.Motion.decide] по нынешним часам, последнему касанию и состоянию экрана. Все механизмы, двигающие стопку, спрашивают здесь. */
    private fun motionDecide(app: Context, kind: QrPriority.Motion.Kind, onTarget: Boolean = false, targetExists: Boolean = true): QrPriority.Motion.Decision {
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        return QrPriority.Motion.decide(
            QrPriority.Motion.Input(kind, System.currentTimeMillis(), touchedAt(app), touchWasSwipe(app), screenOn(pm), onTarget, targetExists)
        )
    }

    /** Заморозить порядок: стопка продолжает показывать карточки в том порядке, в котором они сейчас лежат, пока движение отложено. */
    private fun freeze(id: Int) {
        synchronized(motionLock) { if (frozenSlots[id] == null) shownSlots[id]?.let { frozenSlots[id] = it } }
    }

    /** Движение исполняется: порядок размораживается, отложенное снято. */
    private fun thaw(id: Int) {
        synchronized(motionLock) { frozenSlots.remove(id) }
        deferredIds.remove(id)
        pendingReturn.remove(id)
        val token = synchronized(wakeTokens) { wakeTokens[id] }
        if (token != null) main.removeCallbacksAndMessages(token)
    }

    /** Движение отложено: порядок замораживается, ставится одно ожидание (по сроку — обработчик, до включения экрана — приёмник [ensureScreenReceiver]). */
    private fun onDeferred(app: Context, id: Int, kind: QrPriority.Motion.Kind, dec: QrPriority.Motion.Decision) {
        freeze(id)
        val untilScreen = dec.at == QrPriority.Motion.AT_SCREEN_ON
        Log.d("QrMotion", "id=" + id + " " + kind + " отложено" + (if (untilScreen) " до включения экрана" else " на " + (dec.at - System.currentTimeMillis()) + " мс") + ": " + dec.reason)
        when (kind) {
            QrPriority.Motion.Kind.RETURN_TOP -> {
                if (untilScreen) {
                    pendingReturn.add(id)
                    scheduleReturn(app, id, System.currentTimeMillis() + RETURN_AFTER_MS) // запасной срок: приёмник экрана мог не дожить
                } else scheduleReturn(app, id, dec.at)
            }
            QrPriority.Motion.Kind.NEW_TOP -> if (untilScreen) deferredIds.add(id) else scheduleWake(app, id, dec.at)
            else -> {}
        }
    }

    /** Одно ожидание на виджет: в [at] перерисовка заново решает, можно ли уже двигать (прежняя смена верха остаётся в K_TOP «не записана»). */
    private fun scheduleWake(app: Context, id: Int, at: Long) {
        val token = synchronized(wakeTokens) { wakeTokens.getOrPut(id) { Any() } }
        main.removeCallbacksAndMessages(token)
        main.postAtTime({
            try {
                val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
                if (screenOn(pm)) update(app, AppWidgetManager.getInstance(app), id) else deferredIds.add(id)
            } catch (e: Exception) {
                Log.e("QrMotion", "wake: " + e)
            }
        }, token, SystemClock.uptimeMillis() + Math.max(250L, at - System.currentTimeMillis()))
    }

    /** Приёмник включения экрана (динамический, живёт, пока жив процесс): отложенное «до включения экрана» решается заново — пауза, если она ещё идёт, перенесёт срок. */
    private fun ensureScreenReceiver(app: Context) {
        if (screenRecv) return
        screenRecv = true
        try {
            val r = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    try {
                        if (i.action == Intent.ACTION_USER_PRESENT) refreshTimerFaces(c.applicationContext) else onScreenOn(c.applicationContext)
                    } catch (e: Exception) {
                        Log.e("QrMotion", "screenOn: " + e)
                    }
                }
            }
            val f = IntentFilter(Intent.ACTION_SCREEN_ON)
            f.addAction(Intent.ACTION_USER_PRESENT) // разблокировка: лицо таймера должно быть свежим к тому моменту, когда человек увидит виджет
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED) else app.registerReceiver(r, f)
        } catch (e: Exception) {
            screenRecv = false
            Log.e("QrMotion", "receiver: " + e)
        }
    }

    private fun onScreenOn(app: Context) {
        val mgr = AppWidgetManager.getInstance(app)
        val rets = synchronized(pendingReturn) { ArrayList(pendingReturn) }
        val tops = synchronized(deferredIds) { ArrayList(deferredIds) }
        pendingReturn.clear()
        deferredIds.clear()
        for (id in rets) returnToTop(app, id)
        for (id in tops) if (id !in rets) update(app, mgr, id)
        refreshTimerFaces(app, rets + tops)
    }

    /**
     * Лицо таймера ([QrTimerFace]) рисуется по часам телефона в момент перерисовки, а минутный обработчик ([armCycle]) стоит на uptime — во сне (экран погашен) эти часы не идут, и
     * обработчик срабатывает с опозданием, а при погашенном экране ещё и ничего не рисует. Поэтому при включении экрана и разблокировке виджеты с карточкой «Таймеры» перерисовываются сразу
     * (только лицо: порядок стопки не трогается, положение решает диспетчер движения), а сроки ближайших перерисовок взводятся заново от настенных часов. [skip] — виджеты, только что обновлённые целиком.
     */
    private fun refreshTimerFaces(app: Context, skip: Collection<Int> = emptyList()) {
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        for (id in ids) {
            if (id in skip) continue
            try {
                if (cfgFor(app, id)?.timers == true) update(app, mgr, id)
            } catch (e: Exception) {
                Log.e("QrMotion", "refreshTimerFaces: " + e)
            }
        }
        armCycle(app, ids)
    }

    /** Стопку только что переставили мы (обновление, возврат наверх, «после срабатывания»): запросы фабрики в ближайшие секунды — не смахивание. */
    private fun suppressSwipe(id: Int) {
        synchronized(swipeQuiet) { swipeQuiet[id] = SystemClock.uptimeMillis() + SWIPE_QUIET_MS }
    }

    private fun swipeSuppressed(id: Int): Boolean = synchronized(swipeQuiet) { SystemClock.uptimeMillis() < (swipeQuiet[id] ?: 0L) }

    /**
     * Фабрика карточек просит очередную карточку уже после первой загрузки — значит, пользователь смахнул стопку: на мгновение
     * у виджета «по релевантности» взводится возврат наверх через минуту ([armReturn]). Вертикальных точек больше нет (убраны 15.11).
     */
    fun onPossibleSwipe(ctx: Context, id: Int, n: Int) {
        if (n < 2 || swipeSuppressed(id)) return
        val app = ctx.applicationContext
        noteTouch(app, true) // смахнули стопку сами — стопка стоит на месте ближайшие 120 с (QrPriority.Motion.DEEP_QUIET_MS)
        main.post {
            // Возврат наверх взводим ПЕРВЫМ и отдельно: сбой при рисовании точек (виджет удалили, лаунчер не принял обновление) раньше глотался общим catch
            // и до armReturn дело не доходило — стопка не возвращалась никогда.
            try {
                armReturn(app, id)
            } catch (e: Exception) {
                Log.e("QrReturn", "armReturn: " + e)
            }
        }
    }


    // ---------- страховка возврата ----------

    /**
     * Смахивание стопки система нам напрямую не сообщает; если фабрику на смахивании не позвали (карточки уже в кэше системы), точный возврат
     * ([armReturn]) не взведётся и стопка останется где её оставили. Пока точный возврат у виджета ни разу не сработал, раз в [GUARD_MS] при включённом
     * экране стопка, которую мы не ставили наверх дольше [GUARD_MS], возвращается наверх без всякого признака смахивания. Сработал точный возврат — страховка
     * у этого виджета выключается, дальше работает точный возврат через минуту.
     */
    fun ensureGuard(ctx: Context) {
        if (guardOn) return
        val app = ctx.applicationContext
        guardOn = true
        main.removeCallbacksAndMessages(guardToken)
        main.postAtTime({ guardTick(app) }, guardToken, SystemClock.uptimeMillis() + GUARD_TICK_MS)
    }

    private fun guardTick(app: Context) {
        var again = false
        try {
            val mgr = AppWidgetManager.getInstance(app)
            val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
            val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
            val on = screenOn(pm)
            if (!on) again = ids.isNotEmpty() // экран погашен: настройки не разбираем, просто ждём следующего шага
            else for (id in ids) {
                val cfg = cfgFor(app, id) ?: continue
                if (!tracksTop(cfg)) continue
                again = true
                if (!on || id in returnWorked) continue
                val pending = synchronized(LOCK) { jmap(app, K_RETURN).optLong(id.toString(), 0L) > 0L }
                if (pending) continue
                val placed = synchronized(placedAt) { placedAt[id] ?: 0L }
                if (SystemClock.uptimeMillis() - placed < GUARD_MS) continue
                val pl = plan(app, cfg)
                val cyc = Math.min(pl.cycleAt, pl.minuteAt) // круг равных (или минутная перерисовка таймера) сам вот-вот перерисует виджет: второго возврата не нужно
                if (cyc != Long.MAX_VALUE && cyc - System.currentTimeMillis() < 2 * GUARD_TICK_MS) continue
                try {
                    Log.d("QrReturn", "guard id=" + id)
                    returnToTop(app, id)
                } catch (e: Exception) {
                    Log.e("QrReturn", "guard: " + e)
                }
            }
        } catch (e: Exception) {
            Log.e("QrReturn", "guardTick: " + e)
        }
        guardOn = false
        if (again) ensureGuard(app)
    }

    // ---------- возврат наверх ----------

    /** Взводит возврат стопки наверх через [RETURN_AFTER_MS] (каждое новое смахивание отодвигает его). Только «по релевантности» и только если есть рекомендованная карточка. */
    private fun armReturn(app: Context, id: Int) {
        val cfg = cfgFor(app, id) ?: return
        if (!tracksTop(cfg)) return
        val res = plan(app, cfg)
        if (res.anchorKey.isEmpty() || res.cards.size < 2) return
        val now = System.currentTimeMillis()
        // Каждое смахивание отодвигает возврат на минуту, но не дальше RETURN_MAX_DEFER_MS от первого: если система сама дёргает фабрику
        // (перерисовка, перезагрузка карточек), «смахивания» шли бы без конца и возврат откладывался бы вечно.
        val due = synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val f = jmap(app, K_RETFIRST)
            val first = if (m.optLong(id.toString(), 0L) > 0L && f.optLong(id.toString(), 0L) > 0L) f.optLong(id.toString(), 0L) else now
            val d = Math.max(now + 1_000L, Math.min(now + RETURN_AFTER_MS, first + RETURN_MAX_DEFER_MS))
            m.put(id.toString(), d)
            f.put(id.toString(), first)
            prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
            d
        }
        Log.d("QrReturn", "armed id=" + id + " in " + (due - now) + " ms, anchor=" + res.anchorKey)
        postReturn(app, id, due)
    }

    /** Ставит возврат на [due]: точно по времени — пока жив процесс; будильник — запасной (процесс могли выгрузить). */
    private fun postReturn(app: Context, id: Int, due: Long) {
        val delay = Math.max(1_000L, due - System.currentTimeMillis())
        val token = synchronized(returnTokens) { returnTokens.getOrPut(id) { Any() } }
        main.removeCallbacksAndMessages(token)
        main.postAtTime({
            try {
                fireReturn(app, id)
            } catch (e: Exception) {
                Log.e("QrReturn", "fireReturn: " + e)
            }
        }, token, SystemClock.uptimeMillis() + delay)
        returnPi(app, id, true)?.let { setAlarm(app, due + 3_000L, it) }
    }

    /** Диспетчер отложил возврат: новый срок [due] (конец паузы после касания) пишется как у обычного возврата и ставится заново. */
    private fun scheduleReturn(app: Context, id: Int, due: Long) {
        synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val f = jmap(app, K_RETFIRST)
            m.put(id.toString(), due)
            if (f.optLong(id.toString(), 0L) <= 0L) f.put(id.toString(), System.currentTimeMillis())
            prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
        }
        postReturn(app, id, due)
    }

    /** Снимает ожидающий возврат (стопка и так переставлена наверх, или виджет удалён). */
    private fun clearReturn(app: Context, id: Int) {
        synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val f = jmap(app, K_RETFIRST)
            if (m.has(id.toString()) || f.has(id.toString())) {
                m.remove(id.toString())
                f.remove(id.toString())
                prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
            }
        }
        val token = synchronized(returnTokens) { returnTokens[id] }
        if (token != null) main.removeCallbacksAndMessages(token)
        returnPi(app, id, false)?.let { am(app).cancel(it); it.cancel() }
    }

    /** Время возврата пришло (из обработчика или будильника `ACTION_RETURN`): если его не отодвинули новым смахиванием — стопка наверх. */
    fun fireReturn(ctx: Context, id: Int) {
        val app = ctx.applicationContext
        val now = System.currentTimeMillis()
        val due = synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val f = jmap(app, K_RETFIRST)
            val d = m.optLong(id.toString(), 0L)
            if (d > 0L && now >= d - 500L) {
                m.remove(id.toString())
                f.remove(id.toString())
                prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
                d
            } else 0L
        }
        if (due == 0L) return
        Log.d("QrReturn", "fire id=" + id)
        returnToTop(app, id)
        returnWorked.add(id) // точный возврат дошёл до конца — страховка этому виджету больше не нужна
    }

    /** Показывает в стопке верхнюю карточку порядка [order] — рекомендованную или более важную, чем та, на которой остановился пользователь. */
    private fun returnToTop(app: Context, id: Int) {
        val cfg = cfgFor(app, id) ?: return
        if (!tracksTop(cfg)) return
        val res = plan(app, cfg)
        val anchor = res.anchorKey
        if (anchor.isEmpty() || res.cards.size < 2) return
        suppressSwipe(id)
        dotsOn.remove(id)
        // ОДНО полное обновление с пересозданием адаптера (как в onCardFired): сброс положения идёт в том же RemoteViews, что и данные.
        // Прежний возврат одним partiallyUpdateAppWidget(setDisplayedChild(0)) у смахнутой стопки не срабатывал — позицию StackView он не менял.
        // Верхняя карточка (K_TOP) записывается в update, только когда стопка действительно переставлена: пока пользователь работает с карточками,
        // update отложит возврат (QrPriority.Motion) и сам поставит новый срок.
        update(app, AppWidgetManager.getInstance(app), id, true, true, QrPriority.Motion.Kind.RETURN_TOP)
    }

    /** Полупрозрачный «скелет» карточки — показывается вместо пустого места, пока система подгружает карточку. */
    private val skeleton: Bitmap by lazy {
        val s = 160
        val body = Math.round(s * FACE_BODY).toFloat()
        val shift = Math.round(s * FACE_SHADE).toFloat()
        val bmp = Bitmap.createBitmap(s, (body + shift).toInt(), Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = s * FACE_RADIUS
        p.color = 0x4D000000
        g.drawRoundRect(RectF(0f, shift, s.toFloat(), shift + body), r, r, p)
        p.color = 0x73FFFFFF
        g.drawRoundRect(RectF(0f, 0f, s.toFloat(), body), r, r, p)
        bmp
    }

    /** Картинка-заглушка для карточки, которую система ещё не загрузила (и на случай пустой стопки). */
    fun skeletonBitmap(): Bitmap = skeleton
}
