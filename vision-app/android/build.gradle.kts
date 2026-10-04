// All plugins live on the root classpath so the Kotlin and Android plugins share one class loader.
// Versions: AGP 8.13.0 (compileSdk 36, JDK 17+), Kotlin 2.2.0.
buildscript {
    val coreOnly = project.hasProperty("coreOnly")
    repositories {
        if (!coreOnly) google()
        mavenCentral()
        gradlePluginPortal()
    }
    dependencies {
        if (!coreOnly) classpath("com.android.tools.build:gradle:8.13.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.0")
    }
}
