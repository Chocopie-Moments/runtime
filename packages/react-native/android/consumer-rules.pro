# JNI uses exported Java_com_chocopie_ChocoNative_* symbols; names must survive R8.
-keep class com.chocopie.ChocoNative { *; }
