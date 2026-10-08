package com.chocopie

import android.content.Context
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Choreographer
import android.view.View
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** All player operations run on the main thread; each view owns independent playback. */
class ChocoView(context: Context) : View(context), Choreographer.FrameCallback {
    var onError: ((String) -> Unit)? = null
    var playbackEnabled = true
        set(value) { field = value; schedule() }
    var applicationActive = true
        set(value) { field = value; schedule() }
    private var pausedValue = false
    val paused get() = pausedValue
    var currentTime = 0.0
        private set
    var presentedFrames = 0
        private set
    var lastFrameError: String? = null
        private set
    val isLoaded get() = player != 0L
    val isSchedulingFrames get() = scheduled
    private var player = 0L
    private var bitmap: Bitmap? = null
    private var needsFrame = false
    private var scheduled = false
    private var previous: Long? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) { if (isLoaded) safely { ChocoNative.reduced(player, reduced()); present(0.0) } }
    }
    private fun main() { check(Looper.myLooper() == Looper.getMainLooper()) { "Choco players require the main thread" } }
    private fun reduced() = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    fun load(bytes: ByteArray) {
        main(); val (w,h) = dimensions()
        val nextBitmap = Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888)
        val next = ChocoNative.create(bytes,w,h,reduced())
        val frame: DoubleArray
        try {
            ChocoNative.pause(next,paused)
            frame=ChocoNative.frame(next,0.0,nextBitmap)
        } catch(e: Exception) { ChocoNative.destroy(next); throw e }
        if (player != 0L) ChocoNative.destroy(player)
        lastFrameError=null
        player=next; bitmap=nextBitmap; currentTime=frame[2]
        presentedFrames=if(frame[0]!=0.0) 1 else 0; previous=null
        needsFrame=frame[1]!=0.0; invalidate(); schedule()
    }
    fun unload() { main(); stop(); if (player != 0L) ChocoNative.destroy(player); player=0; needsFrame=false; bitmap=null; currentTime=0.0; invalidate() }
    private fun loaded(): Long { main(); check(isLoaded) { "Load a .choco asset first" }; return player }
    fun setState(name: String?, restart: Boolean = false) { ChocoNative.state(loaded(),name ?: "",restart); present(0.0) }
    fun trigger(name: String) { val t=when(name) { "enter"->0; "hover"->1; "click"->2; else->error("Unknown .choco trigger") }; ChocoNative.trigger(loaded(),t); present(0.0) }
    fun seek(seconds: Double) { ChocoNative.seek(loaded(),seconds); previous=null; present(0.0) }
    fun setPaused(value: Boolean) { main(); if(isLoaded) ChocoNative.pause(player,value); pausedValue=value; previous=null; present(0.0) }
    fun look(active: Boolean,x: Double,y: Double) { ChocoNative.look(loaded(),active,x,y); present(0.0) }
    fun palette(a: Double,s: Double,i: Double,b: Double) {
        check(listOf(a,s,i,b).all { it.isFinite() && it>=0 && it<=0xffffff && floor(it)==it }) { "Palette colors must be integers from 0x000000 to 0xFFFFFF" }
        ChocoNative.palette(loaded(),a.toInt(),s.toInt(),i.toInt(),b.toInt()); present(0.0)
    }
    private fun dimensions(): Pair<Int,Int> { val w=max(1,width).toDouble(); val h=max(1,height).toDouble(); val fit=min(1.0,min(4096/max(w,h),sqrt(4194304/(w*h)))); return max(1,floor(w*fit).toInt()) to max(1,floor(h*fit).toInt()) }
    private fun safely(action: () -> Unit) { try { action() } catch(e: Exception) { needsFrame=false; stop(); lastFrameError=e.message ?: "The .choco frame could not be presented"; onError?.invoke(lastFrameError!!) } }
    private fun present(delta: Double) { if(!isLoaded) return; safely {
        val (w,h)=dimensions(); if(bitmap?.width!=w || bitmap?.height!=h) bitmap=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888)
        val frame=ChocoNative.frame(player,delta,bitmap!!); needsFrame=frame[1]!=0.0; currentTime=frame[2]
        if(frame[0]!=0.0) { presentedFrames++; invalidate() }; schedule()
    } }
    override fun onDraw(canvas: Canvas) { super.onDraw(canvas); bitmap?.let { canvas.drawBitmap(it,null,Rect(0,0,width,height),paint) } }
    override fun onSizeChanged(w: Int,h: Int,oldw: Int,oldh: Int) { super.onSizeChanged(w,h,oldw,oldh); present(0.0) }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); context.contentResolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),false,observer); if(isLoaded) safely { ChocoNative.reduced(player,reduced()); present(0.0) }; schedule() }
    override fun onDetachedFromWindow() { stop(); context.contentResolver.unregisterContentObserver(observer); super.onDetachedFromWindow() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); schedule() }
    override fun onVisibilityChanged(changedView: View,visibility: Int) { super.onVisibilityChanged(changedView,visibility); schedule() }
    private fun stop() { if(scheduled) Choreographer.getInstance().removeFrameCallback(this); scheduled=false; previous=null }
    private fun schedule() { if(!isLoaded || !needsFrame || paused || !playbackEnabled || !applicationActive || !isAttachedToWindow || !isShown || windowVisibility!=VISIBLE) { stop(); return }; if(!scheduled) { scheduled=true; Choreographer.getInstance().postFrameCallback(this) } }
    override fun doFrame(time: Long) { scheduled=false; val delta=previous?.let { max(0.0,(time-it)/1e9) } ?: 0.0; previous=time; present(delta) }
}
