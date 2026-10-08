package com.chocopie.verification

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.LinearLayout
import com.chocopie.ChocoView
import com.chocopie.ChocoVerification
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** Standalone native checks within the same packed Release RN consumer APK. */
class ChocoVerificationActivity : Activity() {
    private val handler=Handler(Looper.getMainLooper())
    private val views=mutableListOf<ChocoView>()
    private var failed=false
    private var checks=0
    private val output get() = getExternalFilesDir(null) ?: filesDir
    private fun checkStep(action: () -> Unit) { if(failed) return; try { action(); checks++ } catch(e: Throwable) { failed=true; result("failed",e.message ?: e.javaClass.name) } }
    private fun result(status: String,error: String?=null) {
        val value=JSONObject().put("status",status).put("checks",checks).put("api",android.os.Build.VERSION.SDK_INT).put("abis",android.os.Build.SUPPORTED_ABIS.joinToString()).put("device",android.os.Build.MODEL).put("error",error)
        File(output,"choco-verification.json").writeText(value.toString(2)); Log.i("ChocoVerification",value.toString())
    }
    override fun onCreate(state: Bundle?) { super.onCreate(state)
        val container=LinearLayout(this); setContentView(container)
        if(intent.getBooleanExtra("reducedReattach",false)) { verifyReducedReattach(container); return }
        checkStep {
            val bytes=assets.open("verification.choco").use { it.readBytes() }
            ChocoVerification.verify(this,bytes,byteArrayOf(1,2,3))
            repeat(2) { val view=ChocoView(this); views.add(view); view.onError={ message->failed=true; result("failed",message) }; container.addView(view,LinearLayout.LayoutParams(256,256)); view.load(bytes) }
            views[1].setPaused(true)
        }
        handler.postDelayed({ checkStep {
            check(views[0].isSchedulingFrames && views[0].currentTime>0)
            check(!views[1].isSchedulingFrames && views[1].currentTime==0.0)
            views[0].playbackEnabled=false; check(!views[0].isSchedulingFrames)
            val time=views[0].currentTime
            handler.postDelayed({ checkStep {
                check(views[0].currentTime==time)
                views[0].playbackEnabled=true; check(views[0].isSchedulingFrames)
                views[0].applicationActive=false; check(!views[0].isSchedulingFrames)
                views[0].applicationActive=true; views[0].setPaused(true); views[0].seek(0.0)
                val bitmap=Bitmap.createBitmap(256,256,Bitmap.Config.ARGB_8888); views[0].draw(Canvas(bitmap))
                // JNI writes AndroidBitmap RGBA_8888 bytes directly. Capture native storage,
                // without getPixels/PNG unpremultiplication or a lossy reverse conversion.
                check(ByteOrder.nativeOrder()==ByteOrder.LITTLE_ENDIAN)
                check(bitmap.config==Bitmap.Config.ARGB_8888 && bitmap.isPremultiplied)
                val raw=ByteBuffer.allocate(bitmap.byteCount).order(ByteOrder.nativeOrder())
                bitmap.copyPixelsToBuffer(raw)
                check(raw.array().size==bitmap.rowBytes*bitmap.height)
                File(output,"choco-android-frame.premultiplied.rgba").writeBytes(raw.array())
                File(output,"choco-android-frame.json").writeText(JSONObject()
                    .put("width",bitmap.width).put("height",bitmap.height).put("rowBytes",bitmap.rowBytes)
                    .put("byteCount",bitmap.byteCount).put("channelLayout","RGBA")
                    .put("alphaMode","premultiplied").put("byteOrder","little")
                    .put("seconds",views[0].currentTime).put("capture","Bitmap.copyPixelsToBuffer after ChocoView.draw")
                    .toString(2))
                File(output,"choco-android-frame.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
                val rgba=ByteArray(256*256*4); val colors=IntArray(256*256); bitmap.getPixels(colors,0,256,0,0,256,256)
                colors.forEachIndexed { index,c->val n=index*4; rgba[n]=((c shr 16) and 255).toByte(); rgba[n+1]=((c shr 8) and 255).toByte(); rgba[n+2]=(c and 255).toByte(); rgba[n+3]=(c ushr 24).toByte() }
                File(output,"choco-android-frame.rgba").writeBytes(rgba)
                File(output,"choco-fixture.sha256").writeText(MessageDigest.getInstance("SHA-256").digest(assets.open("verification.choco").use{it.readBytes()}).joinToString(""){ "%02x".format(it) })
                views.forEach { it.unload() }; check(views.all { !it.isLoaded && !it.isSchedulingFrames })
                result("passed")
            } },150)
        } },300)
    }
    private fun verifyReducedReattach(container: LinearLayout) {
        val phase=File(output,"choco-reattach-phase.txt")
        val resume=File(output,"choco-reattach-resume.txt")
        checkStep {
            check(android.provider.Settings.Global.getFloat(contentResolver,android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0f) { "Initial animator scale must enable animation" }
            val view=ChocoView(this); views.add(view)
            view.onError={ message->failed=true; result("failed",message) }
            container.addView(view,LinearLayout.LayoutParams(256,256))
            view.load(assets.open("verification.choco").use { it.readBytes() })
        }
        val readyDeadline=android.os.SystemClock.uptimeMillis()+10000
        val ready=object : Runnable {
            override fun run() {
                if(failed) return
                val view=views.single()
                if(!view.isAttachedToWindow || !view.isSchedulingFrames || view.currentTime<=0) {
                    checkStep { check(android.os.SystemClock.uptimeMillis()<readyDeadline) {
                        "Animated view did not become ready: attached=${view.isAttachedToWindow}, shown=${view.isShown}, scheduling=${view.isSchedulingFrames}, time=${view.currentTime}, error=${view.lastFrameError}"
                    } }
                    if(!failed) handler.postDelayed(this,100)
                    return
                }
                checkStep {
                    container.removeView(view)
                    check(!view.isAttachedToWindow && !view.isSchedulingFrames) { "Removed retained view remained attached or scheduled" }
                    phase.writeText("detached")
                    val deadline=android.os.SystemClock.uptimeMillis()+30000
                    val poll=object : Runnable {
                        override fun run() { checkStep {
                            if(!resume.exists()) {
                                check(android.os.SystemClock.uptimeMillis()<deadline) { "Timed out waiting for external animator scale change" }
                                handler.postDelayed(this,100); return@checkStep
                            }
                            check(android.provider.Settings.Global.getFloat(contentResolver,android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f) { "External animator scale must be zero before reattach" }
                            container.addView(view,LinearLayout.LayoutParams(256,256))
                            handler.postDelayed({ checkStep {
                                check(view.isAttachedToWindow && !view.isSchedulingFrames) { "Retained view scheduled animation after reduced-motion reattach" }
                                val time=view.currentTime
                                handler.postDelayed({ checkStep {
                                    check(!view.isSchedulingFrames && view.currentTime==time) { "Reduced-motion retained view advanced after reattach" }
                                    view.unload(); phase.writeText("passed"); result("passed")
                                } },150)
                            } },100)
                        } }
                    }
                    handler.post(poll)
                }
            }
        }
        handler.post(ready)
    }
    override fun onPause() { views.forEach { it.applicationActive=false }; super.onPause() }
    override fun onResume() { super.onResume(); views.forEach { it.applicationActive=true } }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); views.forEach { it.unload() }; super.onDestroy() }
}
