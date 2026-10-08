#include <jni.h>
#include <android/bitmap.h>
#include <cstring>
#include "choco.h"
static ChocoPlayer* ptr(jlong p) { return reinterpret_cast<ChocoPlayer*>(p); }
static void fail(JNIEnv* e, const char* message) { e->ThrowNew(e->FindClass("java/lang/IllegalStateException"), message); }
#define JNI(name) Java_com_chocopie_ChocoNative_##name
#define CHECK(call) uint8_t error[512] = {}; if (!(call)) fail(env, reinterpret_cast<char*>(error));
extern "C" JNIEXPORT jlong JNICALL JNI(create)(JNIEnv* env,jobject,jbyteArray bytes,jint w,jint h,jboolean reduced) {
 uint8_t error[512]={}; auto data=env->GetByteArrayElements(bytes,nullptr); if(!data) return 0;
 auto player=choco_player_create(reinterpret_cast<uint8_t*>(data),env->GetArrayLength(bytes),w,h,reduced,error,sizeof(error));
 env->ReleaseByteArrayElements(bytes,data,JNI_ABORT); if(!player) fail(env,reinterpret_cast<char*>(error)); return reinterpret_cast<jlong>(player);
}
extern "C" JNIEXPORT void JNICALL JNI(destroy)(JNIEnv*,jobject,jlong p) { choco_player_destroy(ptr(p)); }
extern "C" JNIEXPORT jdoubleArray JNICALL JNI(frame)(JNIEnv* env,jobject,jlong p,jdouble delta,jobject bitmap) {
 AndroidBitmapInfo info{}; if(AndroidBitmap_getInfo(env,bitmap,&info)!=0 || info.format!=ANDROID_BITMAP_FORMAT_RGBA_8888) { fail(env,"Invalid frame bitmap"); return nullptr; }
 uint8_t error[512]={}; auto f=choco_player_frame(ptr(p),delta,info.width,info.height,error,sizeof(error));
 if(!f.pixels) { fail(env,reinterpret_cast<char*>(error)); return nullptr; }
 if(f.changed) { void* pixels=nullptr; if(AndroidBitmap_lockPixels(env,bitmap,&pixels)!=0) { fail(env,"Could not lock frame bitmap"); return nullptr; }
 for(uint32_t y=0;y<info.height;y++) std::memcpy(static_cast<uint8_t*>(pixels)+y*info.stride,f.pixels+y*info.width*4,info.width*4);
 AndroidBitmap_unlockPixels(env,bitmap); }
 double values[]={f.changed?1.0:0.0,f.needs_frame?1.0:0.0,f.time}; auto result=env->NewDoubleArray(3); if(result) env->SetDoubleArrayRegion(result,0,3,values); return result;
}
extern "C" JNIEXPORT void JNICALL JNI(state)(JNIEnv* env,jobject,jlong p,jstring name,jboolean restart) {
 // Modified UTF-8 differs for supplementary characters: encode through Java UTF-8.
 auto cls=env->FindClass("java/lang/String"); auto method=env->GetMethodID(cls,"getBytes","(Ljava/lang/String;)[B"); auto encoding=env->NewStringUTF("UTF-8");
 auto bytes=static_cast<jbyteArray>(env->CallObjectMethod(name,method,encoding)); if(env->ExceptionCheck()) return;
 auto data=env->GetByteArrayElements(bytes,nullptr); if(!data) return; uint8_t error[512]={};
 bool ok=choco_player_state(ptr(p),reinterpret_cast<uint8_t*>(data),env->GetArrayLength(bytes),restart,error,sizeof(error));
 env->ReleaseByteArrayElements(bytes,data,JNI_ABORT); if(!ok) fail(env,reinterpret_cast<char*>(error));
}
extern "C" JNIEXPORT void JNICALL JNI(trigger)(JNIEnv* env,jobject,jlong p,jint t) { CHECK(choco_player_trigger(ptr(p),t,error,sizeof(error))) }
extern "C" JNIEXPORT void JNICALL JNI(seek)(JNIEnv* env,jobject,jlong p,jdouble t) { CHECK(choco_player_seek(ptr(p),t,error,sizeof(error))) }
extern "C" JNIEXPORT void JNICALL JNI(pause)(JNIEnv* env,jobject,jlong p,jboolean b) { CHECK(choco_player_pause(ptr(p),b,error,sizeof(error))) }
extern "C" JNIEXPORT void JNICALL JNI(reduced)(JNIEnv* env,jobject,jlong p,jboolean b) { CHECK(choco_player_reduced_motion(ptr(p),b,error,sizeof(error))) }
extern "C" JNIEXPORT void JNICALL JNI(look)(JNIEnv* env,jobject,jlong p,jboolean b,jdouble x,jdouble y) { CHECK(choco_player_look(ptr(p),b,x,y,error,sizeof(error))) }
extern "C" JNIEXPORT void JNICALL JNI(palette)(JNIEnv* env,jobject,jlong p,jint a,jint s,jint i,jint b) { CHECK(choco_player_palette(ptr(p),a,s,i,b,error,sizeof(error))) }
