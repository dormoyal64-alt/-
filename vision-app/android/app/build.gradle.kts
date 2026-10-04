import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.seetuned.companion"
    compileSdk = 36

    defaultConfig {
        // Permanent once on Google Play: confirm before the first upload (docs/android/ANDROID-APP.md).
        applicationId = "com.seetuned.companion"
        minSdk = 26
        // Google Play requires the latest Android (16, API 36) for new apps and updates.
        targetSdk = 36
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
        // Every finding, printed in the CI log by the workflow.
        textReport = true
        textOutput = layout.buildDirectory.file("reports/lint-results.txt").get().asFile
        // targetSdk 36 is what Google Play requires now; move to the next one when Play does (and test it in CI first).
        disable += "OldTargetApi"
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.annotation:annotation:1.11.0")

    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.4.0")
}
