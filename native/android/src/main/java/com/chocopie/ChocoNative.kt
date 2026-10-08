package com.chocopie

import android.graphics.Bitmap

internal object ChocoNative {
    init { System.loadLibrary("choco") }
    external fun create(bytes: ByteArray, width: Int, height: Int, reduced: Boolean): Long
    external fun destroy(player: Long)
    external fun frame(player: Long, delta: Double, bitmap: Bitmap): DoubleArray
    external fun state(player: Long, name: String, restart: Boolean)
    external fun trigger(player: Long, trigger: Int)
    external fun seek(player: Long, seconds: Double)
    external fun pause(player: Long, paused: Boolean)
    external fun reduced(player: Long, reduced: Boolean)
    external fun look(player: Long, active: Boolean, x: Double, y: Double)
    external fun palette(player: Long, accent: Int, secondary: Int, ink: Int, background: Int)
}
