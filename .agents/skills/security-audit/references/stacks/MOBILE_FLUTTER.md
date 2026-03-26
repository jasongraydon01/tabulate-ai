# Flutter/Dart Security

Security patterns for Flutter mobile applications.

---

## Data Storage

### Insecure Storage

```dart
// VULNERABLE: SharedPreferences for sensitive data
import 'package:shared_preferences/shared_preferences.dart';

final prefs = await SharedPreferences.getInstance();
await prefs.setString('authToken', token);  // Not encrypted!
await prefs.setString('password', password);  // Very dangerous!

// SECURE: Use flutter_secure_storage
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final storage = FlutterSecureStorage(
  aOptions: AndroidOptions(encryptedSharedPreferences: true),
  iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
);

await storage.write(key: 'authToken', value: token);
final token = await storage.read(key: 'authToken');
```

### Database Security

```dart
// VULNERABLE: Unencrypted SQLite
import 'package:sqflite/sqflite.dart';
final db = await openDatabase('app.db');  // Plain text!

// SECURE: Use encrypted database
import 'package:sqflite_sqlcipher/sqflite.dart';

final db = await openDatabase(
  'app.db',
  password: await getEncryptionKey(),  // Stored in secure storage
);

// Or use Hive with encryption
import 'package:hive_flutter/hive_flutter.dart';

final encryptionKey = await getSecureKey();
final box = await Hive.openBox('secure_data',
  encryptionCipher: HiveAesCipher(encryptionKey),
);
```

---

## Network Security

### Certificate Pinning

```dart
// VULNERABLE: No certificate pinning
final response = await http.get(Uri.parse('https://api.myapp.com/data'));

// SECURE: Implement certificate pinning
import 'package:http_certificate_pinning/http_certificate_pinning.dart';

final response = await HttpCertificatePinning.check(
  serverURL: 'https://api.myapp.com',
  sha: SHA.SHA256,
  allowedSHAFingerprints: ['FINGERPRINT_HERE'],
  timeout: 50,
);

// Or using Dio with certificate pinning
import 'package:dio/dio.dart';
import 'dart:io';

final dio = Dio();
(dio.httpClientAdapter as DefaultHttpClientAdapter).onHttpClientCreate = (client) {
  client.badCertificateCallback = (cert, host, port) {
    final validFingerprint = 'YOUR_CERT_FINGERPRINT';
    return cert.sha256.toString() == validFingerprint;
  };
  return client;
};
```

### Secure HTTP Client

```dart
import 'package:dio/dio.dart';

class SecureHttpClient {
  final Dio _dio;

  SecureHttpClient() : _dio = Dio() {
    _dio.options.baseUrl = 'https://api.myapp.com';
    _dio.options.connectTimeout = Duration(seconds: 30);
    _dio.options.receiveTimeout = Duration(seconds: 30);

    // Add auth interceptor
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _secureStorage.read(key: 'authToken');
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) {
          // Handle token refresh or logout
        }
        return handler.next(error);
      },
    ));
  }
}
```

---

## Authentication

### Biometric Authentication

```dart
// VULNERABLE: Biometric check without secure storage
import 'package:local_auth/local_auth.dart';

final localAuth = LocalAuthentication();
final didAuthenticate = await localAuth.authenticate(
  localizedReason: 'Please authenticate',
);

if (didAuthenticate) {
  // Grant access - but credential not tied to biometric!
}

// SECURE: Combine biometric with secure storage
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final storage = FlutterSecureStorage(
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.when_unlocked_this_device_only,
    // Requires biometric to access
    accountName: 'myapp_auth',
  ),
  aOptions: AndroidOptions(
    encryptedSharedPreferences: true,
  ),
);

// Store credential after biometric succeeds
Future<void> authenticateAndStore() async {
  final didAuthenticate = await localAuth.authenticate(
    localizedReason: 'Please authenticate to login',
    options: AuthenticationOptions(
      biometricOnly: true,
      stickyAuth: true,
    ),
  );

  if (didAuthenticate) {
    // Now access secure storage which is protected
    final token = await storage.read(key: 'authToken');
    // Use token
  }
}
```

### Secure Token Handling

```dart
class TokenManager {
  final FlutterSecureStorage _storage = FlutterSecureStorage();

  Future<String?> getValidToken() async {
    final tokenJson = await _storage.read(key: 'tokenData');
    if (tokenJson == null) return null;

    final tokenData = json.decode(tokenJson);
    final expiresAt = DateTime.parse(tokenData['expiresAt']);

    // Refresh if expiring within 5 minutes
    if (DateTime.now().isAfter(expiresAt.subtract(Duration(minutes: 5)))) {
      return await _refreshToken(tokenData['refreshToken']);
    }

    return tokenData['accessToken'];
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: 'tokenData');
    // Also call logout endpoint
  }
}
```

---

## Code Security

### Preventing Reverse Engineering

```dart
// Check for rooted/jailbroken devices
import 'package:flutter_jailbreak_detection/flutter_jailbreak_detection.dart';

Future<void> checkDeviceSecurity() async {
  bool jailbroken = await FlutterJailbreakDetection.jailbroken;
  bool developerMode = await FlutterJailbreakDetection.developerMode;

  if (jailbroken) {
    // Warn user or restrict functionality
    showSecurityWarning();
  }
}

// Detect debugging
import 'package:flutter/foundation.dart';

if (kDebugMode) {
  // Don't include sensitive operations
}

// Release mode check
if (kReleaseMode) {
  // Safe to proceed
}
```

### Obfuscation

```bash
# Build with obfuscation
flutter build apk --obfuscate --split-debug-info=build/debug-info

flutter build ios --obfuscate --split-debug-info=build/debug-info
```

### Debug Mode Protection

```dart
// VULNERABLE: Debug logging in production
print('User token: $token');
debugPrint('API response: $response');

// SECURE: Conditional logging
import 'package:flutter/foundation.dart';

void secureLog(String message) {
  if (kDebugMode) {
    print(message);
  }
}

// Or use a logging package with levels
import 'package:logger/logger.dart';

final logger = Logger(
  filter: ProductionFilter(),  // Disable debug logs in release
);
```

---

## Input Validation

### Form Validation

```dart
// SECURE: Validate all user input
class Validators {
  static String? email(String? value) {
    if (value == null || value.isEmpty) {
      return 'Email is required';
    }
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    if (!emailRegex.hasMatch(value)) {
      return 'Invalid email format';
    }
    return null;
  }

  static String? password(String? value) {
    if (value == null || value.length < 12) {
      return 'Password must be at least 12 characters';
    }
    if (!value.contains(RegExp(r'[A-Z]'))) {
      return 'Password must contain uppercase letter';
    }
    if (!value.contains(RegExp(r'[0-9]'))) {
      return 'Password must contain number';
    }
    return null;
  }
}

// Usage in form
TextFormField(
  validator: Validators.email,
  decoration: InputDecoration(labelText: 'Email'),
)
```

### Deep Link Validation

```dart
// VULNERABLE: No validation
void handleDeepLink(Uri uri) {
  final token = uri.queryParameters['token'];
  resetPassword(token!);  // Directly using unvalidated data
}

// SECURE: Validate deep link data
void handleDeepLink(Uri uri) {
  // Verify scheme and host
  if (uri.scheme != 'myapp' || uri.host != 'action') {
    return;
  }

  // Validate parameters
  final token = uri.queryParameters['token'];
  if (token == null || !RegExp(r'^[a-zA-Z0-9]{32}$').hasMatch(token)) {
    return;  // Invalid token format
  }

  // Verify with server before acting
  verifyTokenWithServer(token).then((valid) {
    if (valid) resetPassword(token);
  });
}
```

---

## Platform Configuration

### Android (android/app/build.gradle)

```groovy
android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

### Android (AndroidManifest.xml)

```xml
<application
    android:allowBackup="false"
    android:usesCleartextTraffic="false">

    <meta-data
        android:name="android.security.net.config"
        android:resource="@xml/network_security_config" />
</application>
```

### iOS (Info.plist)

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
</dict>

<!-- Protect screenshots -->
<key>UIApplicationExitsOnSuspend</key>
<false/>
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| Insecure Storage | SharedPreferences for tokens/secrets |
| No Cert Pinning | http package without pinning |
| Hardcoded Secrets | API keys in Dart files |
| HTTP Traffic | Non-HTTPS URLs |
| Debug in Prod | kDebugMode without conditional |
| No Root Detection | Missing jailbreak detection |
| Backup Enabled | android:allowBackup="true" |
| No Obfuscation | Missing --obfuscate flag |
| Deep Link Issues | No validation of URI params |
| Insecure DB | sqflite without encryption |
