package androidx.annotation

/** Compile-check stand-in for androidx.annotation.RequiresApi (Google's Maven repository is not reachable there). */
@Retention(AnnotationRetention.BINARY)
annotation class RequiresApi(val value: Int = 1, val api: Int = 1)
