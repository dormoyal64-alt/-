import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.seetuned.companion"
    compileSdk = 35

    defaultConfig {
        // Permanent once on Google Play: confirm before the first upload (docs/android/ANDROID-APP.md).
        applicationId = "com.seetuned.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // A fixed, committed DEBUG key (password "android") so every pilot build installs over the last one.
        // It is not secret and must never sign a store release.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        // Release key from the environment (CI secrets); without it the release build is unsigned.
        val releaseStore = System.getenv("SEETUNED_KEYSTORE")
        if (releaseStore != null) {
            create("release") {
                storeFile = file(releaseStore)
                storePassword = System.getenv("SEETUNED_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SEETUNED_KEY_ALIAS")
                keyPassword = System.getenv("SEETUNED_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = false
    }

    lint {
        abortOnError = true
        checkDependencies = true
        htmlReport = true
        xmlReport = true
        // Every finding in the CI log, not only the first error.
        textReport = true
        textOutput = file("stdout")
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))

    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
