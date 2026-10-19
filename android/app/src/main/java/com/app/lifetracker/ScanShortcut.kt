package com.app.lifetracker
// Версия: 1.0 (18.10)

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Отдельный ярлык «Сканер QR-кодов» на рабочем столе (кнопка в «Дополнительных возможностях» настроек приложения).
 * Это закреплённый ярлык (pinned shortcut): значок на рабочем столе открывает окно сканера ScanActivity, приложение
 * не запускается. Отдельно от пункта в меню долгого нажатия на иконку приложения (res/xml/shortcuts.xml).
 *
 * Разрешение: com.android.launcher.permission.INSTALL_SHORTCUT (манифест; нужно до Android 8, на новых — запрос
 * подтверждает пользователь в окне рабочего стола). Дополнительно у ряда оболочек (Xiaomi MIUI/HyperOS) есть своё
 * разрешение «Ярлыки на рабочем столе» — выдать его можно только в настройках приложения (см. openPermissionSettings).
 */
object ScanShortcut {

    private const val SHORTCUT_ID = "scan_qr_pinned"
    private const val ICON_SIZE_PX = 192

    /** "requested" — запрос отправлен (на Android 8+ рабочий стол спросит пользователя), "unsupported", "failed". */
    fun requestPin(ctx: Context): String {
        return try {
            if (!ShortcutManagerCompat.isRequestPinShortcutSupported(ctx)) return "unsupported"
            val intent = Intent(ctx, ScanActivity::class.java).apply {
                action = "com.app.lifetracker.SCAN_QR"
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val info = ShortcutInfoCompat.Builder(ctx, SHORTCUT_ID)
                .setShortLabel("Сканер QR")
                .setLongLabel("Сканировать QR-код")
                .setIcon(IconCompat.createWithBitmap(iconBitmap(ctx)))
                .setIntent(intent)
                .build()
            if (ShortcutManagerCompat.requestPinShortcut(ctx, info, null)) "requested" else "failed"
        } catch (e: Exception) {
            "failed"
        }
    }

    /** Значок ярлыка — тот же фиолетовый круг с QR (ic_shortcut_scan_qr), нарисованный в картинку: так его читает любой рабочий стол. */
    private fun iconBitmap(ctx: Context): Bitmap {
        val bmp = Bitmap.createBitmap(ICON_SIZE_PX, ICON_SIZE_PX, Bitmap.Config.ARGB_8888)
        val d = ContextCompat.getDrawable(ctx, R.drawable.ic_shortcut_scan_qr)
        if (d != null) {
            d.setBounds(0, 0, ICON_SIZE_PX, ICON_SIZE_PX)
            d.draw(Canvas(bmp))
        }
        return bmp
    }

    /** Открывает разрешения приложения: у Xiaomi — редактор разрешений MIUI/HyperOS, иначе (и если не открылся) — «О приложении». */
    fun openPermissionSettings(ctx: Context): Boolean {
        val miui = Intent("miui.intent.action.APP_PERM_EDITOR").apply {
            setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
            putExtra("extra_pkgname", ctx.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            ctx.startActivity(miui)
            return true
        } catch (e: Exception) {
            // не Xiaomi или другая версия оболочки — обычные настройки приложения
        }
        return try {
            ctx.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            true
        } catch (e: Exception) {
            false
        }
    }
}
