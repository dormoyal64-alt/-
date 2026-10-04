// SeeTuned Android app. Two ways to build:
//   ./gradlew assembleDebug            the full app (needs the Android SDK and Google's Maven repository)
//   ./gradlew -PcoreOnly check         only the pure-Kotlin core, plus a compile check of the app sources against
//                                      Robolectric's android-all jar (Maven Central only; used where Google's hosts are blocked)
val coreOnly = providers.gradleProperty("coreOnly").isPresent

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (!coreOnly) google()
        mavenCentral()
    }
}

rootProject.name = "seetuned-android"
include(":core")
if (coreOnly) include(":compilecheck") else include(":app")
