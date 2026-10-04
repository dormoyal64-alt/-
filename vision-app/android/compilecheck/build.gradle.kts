import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Only with -PcoreOnly (no Android SDK): compiles app/src/main/kotlin against Robolectric's android-all jar
// (the Android 15 framework, from Maven Central) to catch API and type errors. The real build is :app.
plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
    sourceSets["main"].kotlin.srcDir("../app/src/main/kotlin")
}

dependencies {
    implementation(project(":core"))
    compileOnly("org.robolectric:android-all:15-robolectric-12650502")
}
