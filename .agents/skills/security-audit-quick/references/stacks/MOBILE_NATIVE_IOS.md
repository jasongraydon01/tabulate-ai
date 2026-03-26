# iOS Native Security

Security patterns for Swift and Objective-C iOS applications.

---

## Data Storage

### Keychain Storage

```swift
// VULNERABLE: UserDefaults for sensitive data
UserDefaults.standard.set(authToken, forKey: "authToken")
UserDefaults.standard.set(password, forKey: "password")  // Never do this!

// SECURE: Use Keychain
import Security

class KeychainHelper {
    static func save(key: String, data: Data) -> OSStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        SecItemDelete(query as CFDictionary)  // Remove existing
        return SecItemAdd(query as CFDictionary, nil)
    }

    static func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        SecItemCopyMatching(query as CFDictionary, &result)
        return result as? Data
    }
}

// Usage
if let tokenData = "myToken".data(using: .utf8) {
    KeychainHelper.save(key: "authToken", data: tokenData)
}
```

### Data Protection API

```swift
// SECURE: Use Data Protection for files
let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
let filePath = documentsPath.appendingPathComponent("sensitive.dat")

do {
    try data.write(to: filePath, options: .completeFileProtection)
} catch {
    print("Write failed: \(error)")
}

// Check protection level
let attributes = try FileManager.default.attributesOfItem(atPath: filePath.path)
if let protection = attributes[.protectionKey] as? FileProtectionType {
    // Should be .complete or .completeUnlessOpen
}
```

### Core Data Encryption

```swift
// VULNERABLE: Unencrypted Core Data
let container = NSPersistentContainer(name: "Model")

// SECURE: Use encrypted Core Data
let container = NSPersistentContainer(name: "Model")
let storeDescription = NSPersistentStoreDescription()
storeDescription.setOption(
    FileProtectionType.complete as NSObject,
    forKey: NSPersistentStoreFileProtectionKey
)
container.persistentStoreDescriptions = [storeDescription]
```

---

## Network Security

### App Transport Security (ATS)

```xml
<!-- Info.plist - SECURE: ATS enabled (default) -->
<!-- Don't add NSAllowsArbitraryLoads unless absolutely necessary -->

<!-- If exceptions needed, be specific -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>legacy-api.example.com</key>
        <dict>
            <key>NSExceptionMinimumTLSVersion</key>
            <string>TLSv1.2</string>
            <key>NSExceptionRequiresForwardSecrecy</key>
            <true/>
        </dict>
    </dict>
</dict>
```

### Certificate Pinning

```swift
// SECURE: Implement certificate pinning
import Foundation

class PinnedURLSessionDelegate: NSObject, URLSessionDelegate {
    let pinnedCertificates: [SecCertificate]

    init(pinnedCertificates: [SecCertificate]) {
        self.pinnedCertificates = pinnedCertificates
    }

    func urlSession(_ session: URLSession,
                   didReceive challenge: URLAuthenticationChallenge,
                   completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {

        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Get server certificate
        guard let serverCertificate = SecTrustGetCertificateAtIndex(serverTrust, 0) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Compare with pinned certificates
        let serverCertData = SecCertificateCopyData(serverCertificate) as Data
        for pinnedCert in pinnedCertificates {
            let pinnedCertData = SecCertificateCopyData(pinnedCert) as Data
            if serverCertData == pinnedCertData {
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
                return
            }
        }

        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}
```

---

## Authentication

### Biometric Authentication

```swift
import LocalAuthentication

// VULNERABLE: Only checking biometric success
func authenticateUser() {
    let context = LAContext()
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                          localizedReason: "Authenticate") { success, error in
        if success {
            // Granting access without proper credential check
            self.grantAccess()
        }
    }
}

// SECURE: Combine with Keychain
func secureAuthenticate() {
    let context = LAContext()

    // Store credential with biometric protection
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: "authToken",
        kSecUseAuthenticationContext as String: context,
        kSecAttrAccessControl as String: SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            nil
        )!,
        kSecReturnData as String: true
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecSuccess, let data = result as? Data {
        // Credential retrieved after successful biometric
        let token = String(data: data, encoding: .utf8)
        self.useToken(token)
    }
}
```

---

## Code Security

### Jailbreak Detection

```swift
class JailbreakDetector {
    static func isJailbroken() -> Bool {
        #if targetEnvironment(simulator)
        return false
        #else

        // Check for common jailbreak files
        let jailbreakPaths = [
            "/Applications/Cydia.app",
            "/Library/MobileSubstrate/MobileSubstrate.dylib",
            "/bin/bash",
            "/usr/sbin/sshd",
            "/etc/apt",
            "/private/var/lib/apt/"
        ]

        for path in jailbreakPaths {
            if FileManager.default.fileExists(atPath: path) {
                return true
            }
        }

        // Check if app can write outside sandbox
        let testPath = "/private/jailbreak_test.txt"
        do {
            try "test".write(toFile: testPath, atomically: true, encoding: .utf8)
            try FileManager.default.removeItem(atPath: testPath)
            return true  // Should not be able to write here
        } catch {
            // Expected - cannot write outside sandbox
        }

        // Check for suspicious URL schemes
        if let url = URL(string: "cydia://package/com.example") {
            if UIApplication.shared.canOpenURL(url) {
                return true
            }
        }

        return false
        #endif
    }
}
```

### Anti-Debugging

```swift
import Foundation

func isDebuggerAttached() -> Bool {
    var info = kinfo_proc()
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    var size = MemoryLayout<kinfo_proc>.stride

    let result = sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0)
    guard result == 0 else { return false }

    return (info.kp_proc.p_flag & P_TRACED) != 0
}

// Usage
if isDebuggerAttached() {
    // Handle debugger detection
    fatalError("Debugger detected")
}
```

### Obfuscation

```swift
// String obfuscation
class ObfuscatedStrings {
    // Instead of plain strings
    // static let apiKey = "sk-1234567890"

    // Use computed properties with encoding
    static var apiKey: String {
        let encoded: [UInt8] = [115, 107, 45, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48]
        return String(bytes: encoded, encoding: .utf8) ?? ""
    }
}

// Consider using tools like SwiftShield for class/method obfuscation
```

---

## Secure Communication

### Secure WebView

```swift
import WebKit

// VULNERABLE: WKWebView with JavaScript from untrusted sources
let webView = WKWebView()
webView.load(URLRequest(url: URL(string: userProvidedURL)!))

// SECURE: Restricted WKWebView
let config = WKWebViewConfiguration()
config.preferences.javaScriptEnabled = false  // If JS not needed

let webView = WKWebView(frame: .zero, configuration: config)

// Navigation delegate for URL validation
class SecureNavigationDelegate: NSObject, WKNavigationDelegate {
    let allowedHosts = ["trusted.com", "api.trusted.com"]

    func webView(_ webView: WKWebView,
                decidePolicyFor navigationAction: WKNavigationAction,
                decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {

        guard let url = navigationAction.request.url,
              let host = url.host,
              allowedHosts.contains(host),
              url.scheme == "https" else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
```

---

## Build Configuration

### Info.plist Security Settings

```xml
<!-- Disable ATS exceptions in production -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
</dict>

<!-- Declare URL schemes app can open (prevent URL scheme hijacking) -->
<key>LSApplicationQueriesSchemes</key>
<array>
    <string>https</string>
</array>

<!-- Background modes - only what's needed -->
<key>UIBackgroundModes</key>
<array>
    <!-- Only include necessary modes -->
</array>

<!-- Prevent screenshots of sensitive content -->
<!-- Handle in applicationWillResignActive -->
```

### Build Settings

```
// In Xcode Build Settings:
ENABLE_BITCODE = YES  // For App Store
GCC_PREPROCESSOR_DEFINITIONS = NDEBUG=1  // Release
SWIFT_OPTIMIZATION_LEVEL = -O  // Optimize for release
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| Insecure Storage | UserDefaults for tokens/passwords |
| No Keychain | Credentials not in Keychain |
| ATS Disabled | NSAllowsArbitraryLoads = true |
| No Cert Pinning | URLSession without pinning delegate |
| Weak Biometric | LAContext without Keychain binding |
| No Jailbreak Check | Missing jailbreak detection |
| Debug Enabled | DEBUG flag in release |
| Hardcoded Secrets | Strings with API keys |
| Insecure WebView | WKWebView loading untrusted URLs |
| Missing File Protection | Files without .completeFileProtection |
