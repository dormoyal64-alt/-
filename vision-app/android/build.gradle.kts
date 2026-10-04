// All plugins live on the root classpath so the Kotlin and Android plugins share one class loader.
// Versions: AGP 8.7.3 (compileSdk 35, JDK 17+), Kotlin 2.1.0.
buildscript {
    val coreOnly = project.hasProperty("coreOnly")
    repositories {
        if (!coreOnly) google()
        mavenCentral()
        gradlePluginPortal()
    }
    dependencies {
        if (!coreOnly) classpath("com.android.tools.build:gradle:8.7.3")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0")
    }
}
