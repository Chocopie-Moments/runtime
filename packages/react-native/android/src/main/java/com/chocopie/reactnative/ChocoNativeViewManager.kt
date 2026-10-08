package com.chocopie.reactnative

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.ChocoNativeViewManagerDelegate
import com.facebook.react.viewmanagers.ChocoNativeViewManagerInterface
import com.facebook.react.uimanager.annotations.ReactProp

class ChocoNativeViewManager : SimpleViewManager<ChocoHostView>(), ChocoNativeViewManagerInterface<ChocoHostView> {
    private val delegate=ChocoNativeViewManagerDelegate(this)
    override fun getDelegate(): ViewManagerDelegate<ChocoHostView> = delegate
    override fun getName() = "ChocoNativeView"
    override fun createViewInstance(context: ThemedReactContext) = ChocoHostView(context)
    @ReactProp(name="source") override fun setSource(view: ChocoHostView,value: String?) { view.source=value ?: "" }
    @ReactProp(name="state") override fun setState(view: ChocoHostView,value: String?) { view.state=value ?: "" }
    @ReactProp(name="paused",defaultBoolean=false) override fun setPaused(view: ChocoHostView,value: Boolean) { view.paused=value }
    @ReactProp(name="playbackEnabled",defaultBoolean=true) override fun setPlaybackEnabled(view: ChocoHostView,value: Boolean) { view.playbackEnabled=value }
    override fun onAfterUpdateTransaction(view: ChocoHostView) { super.onAfterUpdateTransaction(view); view.configure() }
    override fun trigger(view: ChocoHostView,name: String?) { view.perform { view.moment.trigger(name ?: "") } }
    override fun seek(view: ChocoHostView,seconds: Double) { view.perform { view.moment.seek(seconds) } }
    override fun look(view: ChocoHostView,active: Boolean,x: Double,y: Double) { view.perform { view.moment.look(active,x,y) } }
    override fun palette(view: ChocoHostView,a: Double,s: Double,i: Double,b: Double) { view.perform { view.moment.palette(a,s,i,b) } }
    override fun onDropViewInstance(view: ChocoHostView) { view.dispose(); super.onDropViewInstance(view) }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String,Any> = mutableMapOf("topLoad" to mapOf("registrationName" to "onLoad"), "topError" to mapOf("registrationName" to "onError"))
}
