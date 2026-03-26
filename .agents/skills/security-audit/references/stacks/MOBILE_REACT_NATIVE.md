# React Native Security

Security patterns for React Native mobile applications.

---

## Data Storage

### Insecure Storage

```javascript
// VULNERABLE: AsyncStorage for sensitive data
import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage is NOT encrypted!
await AsyncStorage.setItem('authToken', token);
await AsyncStorage.setItem('userPassword', password);

// SECURE: Use encrypted storage
import EncryptedStorage from 'react-native-encrypted-storage';

await EncryptedStorage.setItem('authToken', token);

// Or use Keychain/Keystore
import * as Keychain from 'react-native-keychain';

await Keychain.setGenericPassword('auth', token);
const credentials = await Keychain.getGenericPassword();
```

### Sensitive Data in State

```javascript
// VULNERABLE: Sensitive data persisted in Redux
const initialState = {
  user: null,
  creditCard: null,  // Persisted to storage!
  password: null
};

// With redux-persist, this gets saved to AsyncStorage

// SECURE: Exclude sensitive data from persistence
const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  blacklist: ['creditCard', 'password', 'authToken']
};

// Or use transform to encrypt
import { createTransform } from 'redux-persist';
import CryptoJS from 'crypto-js';

const encryptTransform = createTransform(
  (inboundState) => CryptoJS.AES.encrypt(JSON.stringify(inboundState), key).toString(),
  (outboundState) => JSON.parse(CryptoJS.AES.decrypt(outboundState, key).toString(CryptoJS.enc.Utf8))
);
```

---

## Network Security

### Certificate Pinning

```javascript
// VULNERABLE: No certificate pinning - MITM possible
fetch('https://api.myapp.com/data');

// SECURE: Implement certificate pinning
// Using react-native-ssl-pinning
import { fetch as pinnedFetch } from 'react-native-ssl-pinning';

const response = await pinnedFetch('https://api.myapp.com/data', {
  method: 'GET',
  sslPinning: {
    certs: ['cert1', 'cert2']  // Base64 encoded certificates
  }
});

// Or using TrustKit (iOS) / OkHttp (Android) native modules
```

### API Security

```javascript
// VULNERABLE: Hardcoded API keys
const API_KEY = 'sk-1234567890abcdef';

fetch(`https://api.service.com/data?key=${API_KEY}`);

// SECURE: Use environment variables + backend proxy
// Store in .env (not committed)
import Config from 'react-native-config';

// Better: Don't include secret keys in app at all
// Proxy through your backend
fetch('https://your-backend.com/api/proxy/service');
```

### Insecure HTTP

```javascript
// VULNERABLE: HTTP connections (data in plain text)
fetch('http://api.myapp.com/data');

// SECURE: Always use HTTPS
fetch('https://api.myapp.com/data');

// iOS: Configure App Transport Security
// android/app/src/main/res/xml/network_security_config.xml:
// <domain-config cleartextTrafficPermitted="false">
```

---

## Authentication

### Biometric Authentication

```javascript
// VULNERABLE: Biometric without proper fallback handling
import ReactNativeBiometrics from 'react-native-biometrics';

const { success } = await ReactNativeBiometrics.simplePrompt({
  promptMessage: 'Authenticate'
});

if (success) {
  // Grant access - but what about biometric bypass?
}

// SECURE: Combine with secure storage
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import * as Keychain from 'react-native-keychain';

// Store token with biometric protection
await Keychain.setGenericPassword('auth', token, {
  accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY
});

// Retrieve requires biometric
const credentials = await Keychain.getGenericPassword();
```

### Token Management

```javascript
// VULNERABLE: Token never expires, stored insecurely
const token = await AsyncStorage.getItem('token');
// Use token indefinitely...

// SECURE: Short-lived tokens with refresh
class AuthService {
  async getValidToken() {
    const tokenData = await EncryptedStorage.getItem('tokenData');
    const { accessToken, refreshToken, expiresAt } = JSON.parse(tokenData);

    if (Date.now() >= expiresAt - 60000) {  // Refresh 1 min before expiry
      return await this.refreshAccessToken(refreshToken);
    }
    return accessToken;
  }

  async logout() {
    await EncryptedStorage.removeItem('tokenData');
    // Also invalidate on server
    await fetch('/api/logout', { method: 'POST' });
  }
}
```

---

## Code Security

### JavaScript Injection

```javascript
// VULNERABLE: eval with user input
eval(userInput);

// VULNERABLE: WebView with JavaScript enabled + user URLs
<WebView
  source={{ uri: userProvidedUrl }}
  javaScriptEnabled={true}
/>

// SECURE: Never use eval
// Use JSON.parse for JSON data
const data = JSON.parse(userInput);

// SECURE: Restrict WebView
<WebView
  source={{ uri: trustedUrl }}
  javaScriptEnabled={false}  // If JS not needed
  allowsInlineMediaPlayback={false}
  originWhitelist={['https://trusted.com']}
  onShouldStartLoadWithRequest={(request) => {
    return request.url.startsWith('https://trusted.com');
  }}
/>
```

### Deep Link Hijacking

```javascript
// VULNERABLE: No validation of deep link params
// In app.json: "scheme": "myapp"
// myapp://reset-password?token=abc123

Linking.addEventListener('url', ({ url }) => {
  const { token } = parseUrl(url);
  // Directly use token without validation
});

// SECURE: Validate deep link data
Linking.addEventListener('url', ({ url }) => {
  const parsedUrl = new URL(url);

  // Verify scheme
  if (parsedUrl.protocol !== 'myapp:') return;

  // Validate and sanitize parameters
  const token = parsedUrl.searchParams.get('token');
  if (!token || !/^[a-zA-Z0-9]{32}$/.test(token)) {
    return;  // Invalid token format
  }

  // Verify token with server before acting
  verifyTokenWithServer(token).then(valid => {
    if (valid) handlePasswordReset(token);
  });
});
```

---

## Build Security

### Debug Mode in Production

```javascript
// Check for debug mode
if (__DEV__) {
  console.log('Debug info:', sensitiveData);  // Dangerous in prod!
}

// Ensure __DEV__ is false in production builds
// In babel.config.js, transform removes __DEV__ blocks
```

### Obfuscation

```javascript
// metro.config.js - Enable minification
module.exports = {
  transformer: {
    minifierConfig: {
      keep_classnames: false,
      keep_fnames: false,
      mangle: true,
      toplevel: true
    }
  }
};

// Consider react-native-obfuscating-transformer for additional protection
```

### Preventing Reverse Engineering

```javascript
// Detect rooted/jailbroken devices
import JailMonkey from 'jail-monkey';

if (JailMonkey.isJailBroken()) {
  // Warn user or restrict functionality
  Alert.alert('Security Warning', 'This device appears to be compromised');
}

// Detect debugging
if (JailMonkey.isDebuggedMode()) {
  // Handle debugger detection
}
```

---

## Platform-Specific Security

### iOS (Info.plist)

```xml
<!-- Disable insecure connections -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>your-api.com</key>
        <dict>
            <key>NSExceptionMinimumTLSVersion</key>
            <string>TLSv1.2</string>
        </dict>
    </dict>
</dict>

<!-- Protect background snapshots -->
<key>UIApplicationExitsOnSuspend</key>
<false/>
```

### Android (AndroidManifest.xml)

```xml
<application
    android:allowBackup="false"
    android:usesCleartextTraffic="false"
    android:debuggable="false">

    <!-- Network security config -->
    <meta-data
        android:name="android.security.net.config"
        android:resource="@xml/network_security_config" />
</application>
```

```xml
<!-- res/xml/network_security_config.xml -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config>
        <domain includeSubdomains="true">your-api.com</domain>
        <pin-set>
            <pin digest="SHA-256">base64encodedpin==</pin>
        </pin-set>
    </domain-config>
</network-security-config>
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| Insecure Storage | AsyncStorage for tokens/passwords |
| No Cert Pinning | fetch() without SSL pinning |
| Hardcoded Secrets | API keys in source code |
| HTTP Traffic | Non-HTTPS URLs |
| eval() Usage | eval, new Function with user input |
| Unsafe WebView | javaScriptEnabled without URL restriction |
| Debug in Prod | __DEV__ checks missing, console.log |
| Deep Link Issues | No validation of deep link params |
| No Root Detection | Missing jailbreak/root checks |
| Backup Enabled | android:allowBackup="true" |
