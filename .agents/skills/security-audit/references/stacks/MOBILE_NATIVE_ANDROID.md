# Android Native Security

Security patterns for Kotlin and Java Android applications.

---

## Data Storage

### SharedPreferences Security

```kotlin
// VULNERABLE: SharedPreferences for sensitive data
val prefs = getSharedPreferences("app_prefs", MODE_PRIVATE)
prefs.edit().putString("auth_token", token).apply()  // Not encrypted!
prefs.edit().putString("password", password).apply()  // Very dangerous!

// SECURE: Use EncryptedSharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val encryptedPrefs = EncryptedSharedPreferences.create(
    context,
    "secure_prefs",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)

encryptedPrefs.edit().putString("auth_token", token).apply()
```

### Keystore Usage

```kotlin
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator

class KeystoreHelper {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val keyAlias = "MySecretKey"

    fun generateKey() {
        if (!keyStore.containsAlias(keyAlias)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
            )
            keyGenerator.init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)  // Require biometric
                .setUserAuthenticationValidityDurationSeconds(30)
                .build()
            )
            keyGenerator.generateKey()
        }
    }

    fun encrypt(data: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, keyStore.getKey(keyAlias, null))
        return Pair(cipher.iv, cipher.doFinal(data))
    }
}
```

### Database Encryption

```kotlin
// VULNERABLE: Unencrypted SQLite
val db = SQLiteDatabase.openOrCreateDatabase(dbPath, null)

// SECURE: Use SQLCipher
import net.sqlcipher.database.SQLiteDatabase

SQLiteDatabase.loadLibs(context)
val db = SQLiteDatabase.openOrCreateDatabase(dbPath, password, null)

// Or use Room with SQLCipher
val passphrase = getSecurePassphrase()  // From Keystore
val factory = SupportFactory(passphrase)
val db = Room.databaseBuilder(context, AppDatabase::class.java, "secure.db")
    .openHelperFactory(factory)
    .build()
```

---

## Network Security

### Network Security Config

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <!-- Block cleartext (HTTP) traffic -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Certificate pinning for your API -->
    <domain-config>
        <domain includeSubdomains="true">api.myapp.com</domain>
        <pin-set expiration="2025-12-31">
            <pin digest="SHA-256">base64encodedpin1==</pin>
            <pin digest="SHA-256">base64encodedpin2==</pin>
        </pin-set>
    </domain-config>
</network-security-config>
```

```xml
<!-- AndroidManifest.xml -->
<application
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="false">
```

### Certificate Pinning with OkHttp

```kotlin
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient

val certificatePinner = CertificatePinner.Builder()
    .add("api.myapp.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    .add("api.myapp.com", "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=")
    .build()

val client = OkHttpClient.Builder()
    .certificatePinner(certificatePinner)
    .build()
```

---

## Authentication

### Biometric Authentication

```kotlin
import androidx.biometric.BiometricPrompt
import androidx.biometric.BiometricManager

// VULNERABLE: Biometric check without cryptographic binding
biometricPrompt.authenticate(promptInfo)
// Then granting access without verifying credentials

// SECURE: Use CryptoObject with biometric
class SecureBiometricAuth(private val activity: FragmentActivity) {
    private val keyAlias = "biometric_key"

    fun authenticate(onSuccess: (Cipher) -> Unit) {
        val cipher = getCipher()
        initCipher(cipher)

        val cryptoObject = BiometricPrompt.CryptoObject(cipher)

        val biometricPrompt = BiometricPrompt(activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    // Cipher is now unlocked by successful biometric
                    result.cryptoObject?.cipher?.let { onSuccess(it) }
                }
            }
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Authenticate")
            .setSubtitle("Use biometric to access secure data")
            .setNegativeButtonText("Cancel")
            .build()

        biometricPrompt.authenticate(promptInfo, cryptoObject)
    }
}
```

---

## Code Security

### Root Detection

```kotlin
object RootDetector {
    fun isDeviceRooted(): Boolean {
        return checkRootBinaries() || checkSuExists() || checkRootApps()
    }

    private fun checkRootBinaries(): Boolean {
        val paths = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su"
        )
        return paths.any { File(it).exists() }
    }

    private fun checkSuExists(): Boolean {
        return try {
            Runtime.getRuntime().exec(arrayOf("which", "su"))
                .inputStream.bufferedReader().readLine() != null
        } catch (e: Exception) {
            false
        }
    }

    private fun checkRootApps(): Boolean {
        val packages = arrayOf(
            "com.noshufou.android.su",
            "com.thirdparty.superuser",
            "eu.chainfire.supersu",
            "com.koushikdutta.superuser",
            "com.topjohnwu.magisk"
        )
        val pm = context.packageManager
        return packages.any {
            try {
                pm.getPackageInfo(it, PackageManager.GET_ACTIVITIES)
                true
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
        }
    }
}
```

### Anti-Tampering

```kotlin
// Verify app signature
fun verifyAppSignature(context: Context): Boolean {
    val expectedSignature = "YOUR_EXPECTED_SIGNATURE_HASH"

    val packageInfo = context.packageManager.getPackageInfo(
        context.packageName,
        PackageManager.GET_SIGNING_CERTIFICATES
    )

    val signatures = packageInfo.signingInfo.apkContentsSigners
    for (signature in signatures) {
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(signature.toByteArray())
        val currentSignature = digest.joinToString("") { "%02x".format(it) }

        if (currentSignature == expectedSignature) {
            return true
        }
    }
    return false
}
```

### ProGuard/R8 Configuration

```proguard
# proguard-rules.pro

# Keep security-critical classes readable for debugging
-keepattributes SourceFile,LineNumberTable

# Obfuscate everything else
-repackageclasses ''
-allowaccessmodification
-optimizations !code/simplification/arithmetic

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

# Remove debug statements
-assumenosideeffects class kotlin.jvm.internal.Intrinsics {
    static void checkParameterIsNotNull(java.lang.Object, java.lang.String);
}
```

---

## Secure Communication

### WebView Security

```kotlin
// VULNERABLE: WebView with JavaScript enabled, loading untrusted URLs
webView.settings.javaScriptEnabled = true
webView.loadUrl(userProvidedUrl)

// SECURE: Restricted WebView
webView.apply {
    settings.javaScriptEnabled = false  // Unless required
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.allowFileAccessFromFileURLs = false
    settings.allowUniversalAccessFromFileURLs = false
    settings.domStorageEnabled = false

    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url ?: return true
            val allowedHosts = listOf("trusted.com", "api.trusted.com")

            return if (url.host in allowedHosts && url.scheme == "https") {
                false  // Allow loading
            } else {
                true  // Block
            }
        }
    }
}
```

### Intent Security

```kotlin
// VULNERABLE: Implicit intents with sensitive data
val intent = Intent("com.example.PROCESS_DATA")
intent.putExtra("secret", secretData)
startActivity(intent)  // Any app can intercept!

// SECURE: Explicit intents for sensitive operations
val intent = Intent(this, ProcessDataActivity::class.java)
intent.putExtra("secret", secretData)
startActivity(intent)

// For inter-app communication, use signatures
<activity android:name=".ProcessDataActivity"
    android:exported="true"
    android:permission="com.myapp.PROCESS_PERMISSION">
    <intent-filter>
        <action android:name="com.myapp.PROCESS_DATA" />
    </intent-filter>
</activity>

// Define signature-level permission
<permission
    android:name="com.myapp.PROCESS_PERMISSION"
    android:protectionLevel="signature" />
```

---

## AndroidManifest.xml Security

```xml
<manifest>
    <!-- Request only needed permissions -->
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="false"
        android:debuggable="false"
        android:usesCleartextTraffic="false"
        android:networkSecurityConfig="@xml/network_security_config">

        <!-- Exported components need protection -->
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <!-- Internal components should not be exported -->
        <activity
            android:name=".SettingsActivity"
            android:exported="false" />

        <provider
            android:name=".DataProvider"
            android:exported="false"
            android:grantUriPermissions="false" />

    </application>
</manifest>
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| Insecure Storage | SharedPreferences without encryption |
| No Keystore | Keys stored outside Android Keystore |
| Cleartext Traffic | usesCleartextTraffic="true" |
| No Cert Pinning | Missing network_security_config pins |
| Weak Biometric | BiometricPrompt without CryptoObject |
| No Root Detection | Missing root/tamper checks |
| Backup Enabled | allowBackup="true" |
| Debug Enabled | debuggable="true" in release |
| Exported Components | Unnecessary android:exported="true" |
| Insecure WebView | javaScriptEnabled without URL validation |
| Log Statements | Log.d/v not stripped in release |
