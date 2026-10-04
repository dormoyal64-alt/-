package com.seetuned.companion

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * "SeeTuned lens" in Quick Settings: opens the lens on whatever app is under the shade. When the lens service is
 * off, it opens this app instead (where the person can turn it on).
 */
class LensTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            // Never STATE_UNAVAILABLE: an unavailable tile gets no clicks, and a click with the lens off opens the app.
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    // The Intent overload is the only way to collapse the shade before Android 14; it runs only there.
    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        val lens = LensService.instance
        if (lens != null) {
            lens.showLens(fromShade = true)
            return
        }
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
