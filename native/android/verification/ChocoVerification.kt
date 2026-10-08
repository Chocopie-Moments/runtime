package com.chocopie

import android.content.Context
import android.os.Looper

/** Run on the application main thread, with a packed synthetic fixture (never customer art). */
object ChocoVerification {
    fun verify(context: Context, bytes: ByteArray, invalid: ByteArray) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val first=ChocoView(context); val second=ChocoView(context)
        try {
            first.layout(0,0,128,128); second.layout(0,0,128,128)
            first.load(bytes); second.load(bytes)
            check(first.isLoaded && second.isLoaded)
            check(first.presentedFrames>0 && second.presentedFrames>0)
            first.setPaused(true); first.seek(0.125)
            check(first.currentTime==0.125 && second.currentTime==0.0)
            first.trigger("enter"); first.look(true,32.0,32.0); first.look(false,0.0,0.0)
            first.palette(0x123456.toDouble(),0x234567.toDouble(),0x345678.toDouble(),0xffffff.toDouble())
            first.layout(0,0,256,128)
            check(first.paused)
            val before=first.currentTime
            check(runCatching { first.load(invalid) }.isFailure)
            check(first.isLoaded && first.currentTime==before)
            check(runCatching { first.seek(Double.NaN) }.isFailure)
            check(runCatching { first.palette(-1.0,0.0,0.0,0.0) }.isFailure)
            first.unload(); check(!first.isLoaded && !first.isSchedulingFrames)
            check(runCatching { first.trigger("enter") }.isFailure)
            check(second.isLoaded)
        } finally { first.unload(); second.unload() }
    }
}
