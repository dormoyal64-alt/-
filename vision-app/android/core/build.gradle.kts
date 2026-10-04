import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Pure Kotlin (no android.* imports): recipe parsing, the settings plan, the restore journal, the lens pixel
// pipeline and the strings. Everything here runs in plain JVM unit tests.
plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.1.0")
    testImplementation("org.json:json:20240303")
}

tasks.test {
    testLogging { events("failed"); showStandardStreams = false; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
