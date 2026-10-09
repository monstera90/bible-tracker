package com.app.lifetracker

import android.app.PendingIntent
import android.os.Build

/** Мелочи для работы на Android 5.0+ (minSdk 21): флаги, которых нет на старых версиях. */
object Compat {

    /** UPDATE_CURRENT плюс IMMUTABLE там, где флаг существует (Android 6+; на 5.x PendingIntent и так не изменяется системой). */
    fun pendingFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
}
