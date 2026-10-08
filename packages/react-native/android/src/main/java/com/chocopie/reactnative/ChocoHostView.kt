package com.chocopie.reactnative

import android.net.Uri
import android.widget.FrameLayout
import com.chocopie.ChocoView
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.Future

internal class ChocoEvent(surface: Int, tag: Int, private val name: String, private val message: String? = null) : Event<ChocoEvent>(surface,tag) {
    override fun getEventName() = name
    override fun getEventData() = Arguments.createMap().apply { if(message==null) putBoolean("loaded",true) else putString("message",message) }
}
class ChocoHostView(private val react: ReactContext) : FrameLayout(react), LifecycleEventListener {
    val moment = ChocoView(react)
    var source = ""
    var state = ""
    var paused = false
    var playbackEnabled = true
    private var loadedSource = ""
    private var generation = 0
    private var loading: Future<*>? = null
    init { addView(moment,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT)); moment.onError={ emit("topError",it) }; react.addLifecycleEventListener(this) }
    fun emit(name: String, message: String? = null) { UIManagerHelper.getEventDispatcherForReactTag(react,id)?.dispatchEvent(ChocoEvent(UIManagerHelper.getSurfaceId(this),id,name,message)) }
    fun perform(operation: () -> Unit) { try { operation() } catch(e: Exception) { emit("topError",e.message ?: "The .choco control could not be applied") } }
    fun configure() {
        moment.playbackEnabled=playbackEnabled
        if(source==loadedSource) { if(moment.isLoaded) perform { moment.setPaused(paused); moment.setState(state.takeUnless { it.isEmpty() || it=="idle" }) }; return }
        loading?.cancel(true); generation++; moment.unload(); loadedSource=source
        if(source.isEmpty()) return
        val own=generation; val uri=source
        loading=executor.submit {
            try { val bytes=read(uri); post { if(generation==own) { perform { moment.setPaused(paused); moment.load(bytes); if(state.isNotEmpty()) moment.setState(state.takeUnless { it=="idle" }); if(moment.lastFrameError==null) emit("topLoad") }; loading=null } } }
            catch(e: Exception) { post { if(generation==own && !Thread.currentThread().isInterrupted) { loading=null; emit("topError","The .choco asset could not be loaded") } } }
        }
    }
    fun dispose() { generation++; loading?.cancel(true); loading=null; moment.unload(); react.removeLifecycleEventListener(this) }
    override fun onHostResume() { moment.applicationActive=true }
    override fun onHostPause() { moment.applicationActive=false }
    override fun onHostDestroy() { dispose() }
    private fun bounded(input: InputStream): ByteArray = input.use {
        val output=java.io.ByteArrayOutputStream(); val buffer=ByteArray(8192)
        while(true) { if(Thread.currentThread().isInterrupted) throw InterruptedException(); val count=it.read(buffer); if(count<0) break; check(output.size()+count<=2097152) { "The .choco asset exceeds 2 MiB" }; output.write(buffer,0,count) }; output.toByteArray()
    }
    private fun read(source: String): ByteArray {
        if(source.startsWith("bundle://")) { val name=source.removePrefix("bundle://"); check(!name.contains('/') && name.endsWith(".choco")); return bounded(react.assets.open(name)) }
        val uri=Uri.parse(source)
        if(uri.scheme=="file") { val file=java.io.File(uri.path ?: error("Invalid file")); check(file.isFile); return bounded(file.inputStream()) }
        // Metro release assets are resource names or asset:/ URIs.
        if(uri.scheme=="asset") return bounded(react.assets.open(source.removePrefix("asset:/").trimStart('/')))
        if(uri.scheme==null) { val resource=react.resources.getIdentifier(source,"raw",react.packageName); check(resource!=0); return bounded(react.resources.openRawResource(resource)) }
        check(uri.scheme=="https" || ((react.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) && uri.scheme=="http" && uri.host in listOf("localhost","127.0.0.1","10.0.2.2","::1")))
        val connection=URL(source).openConnection() as HttpURLConnection
        try { connection.instanceFollowRedirects=false; connection.connectTimeout=15000; connection.readTimeout=15000; check(connection.responseCode in 200..299); check(connection.contentLengthLong<=2097152); return bounded(connection.inputStream) } finally { connection.disconnect() }
    }
    companion object { private val executor=Executors.newFixedThreadPool(2) }
}
