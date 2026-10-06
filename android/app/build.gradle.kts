plugins {
    id("com.android.application")
}

// Версия приходит из workflow: -PversionCode=<номер запуска> -PversionName=<версия из sw.js без "v">.
// Для локальной сборки без параметров используются значения по умолчанию.
val ltVersionCode: Int = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val ltVersionName: String = (project.findProperty("versionName") as String?) ?: "0.0.0"

// Подпись постоянным keystore: пути и пароли берутся из переменных окружения (их задаёт workflow
// из секретов репозитория). Без них release остаётся неподписанным.
val ltKeystoreFile: String? = System.getenv("KEYSTORE_FILE")

android {
    namespace = "com.app.lifetracker"
    compileSdk = 36

    defaultConfig {
        // appId после первой установки не менять.
        applicationId = "com.app.lifetracker"
        // 29 = Android 10: хранилище через MediaStore без устаревших разрешений. Оба телефона на Android 16.
        minSdk = 29
        targetSdk = 36
        versionCode = ltVersionCode
        versionName = ltVersionName
    }

    signingConfigs {
        if (ltKeystoreFile != null) {
            create("release") {
                storeFile = file(ltKeystoreFile)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (ltKeystoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
}
