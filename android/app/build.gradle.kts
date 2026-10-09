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
        // 21 = Android 5.0. На Android 10+ файлы в «Загрузки» пишутся через MediaStore без разрешений, на Android 5-9 —
        // напрямую в папку «Загрузки» (разрешение WRITE_EXTERNAL_STORAGE, см. FileSaver). Версии ниже 26/23/21 учтены в коде.
        minSdk = 21
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
