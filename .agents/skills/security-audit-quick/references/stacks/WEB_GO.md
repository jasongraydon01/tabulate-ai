# Go Web Security

Security patterns for Go web applications using net/http, Gin, Echo, and Fiber.

---

## Common Vulnerabilities

### 1. SQL Injection

```go
// VULNERABLE: String concatenation
query := "SELECT * FROM users WHERE id = " + userID
rows, _ := db.Query(query)

query := fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)

// SECURE: Parameterized queries
rows, err := db.Query("SELECT * FROM users WHERE id = $1", userID)

// With sqlx
var user User
err := db.Get(&user, "SELECT * FROM users WHERE id = $1", userID)

// GORM (safe by default)
db.Where("id = ?", userID).First(&user)
db.First(&user, userID)  // Also safe
```

### 2. Command Injection

```go
// VULNERABLE: Shell execution with user input
cmd := exec.Command("sh", "-c", "ls " + userDir)
cmd := exec.Command("sh", "-c", fmt.Sprintf("convert %s output.pdf", filename))

// SECURE: Use exec without shell
cmd := exec.Command("ls", userDir)
cmd := exec.Command("convert", filename, "output.pdf")

// Validate input
if !regexp.MustCompile(`^[a-zA-Z0-9_-]+$`).MatchString(filename) {
    return errors.New("invalid filename")
}
```

### 3. Path Traversal

```go
// VULNERABLE: Direct file access
func serveFile(w http.ResponseWriter, r *http.Request) {
    filename := r.URL.Query().Get("file")
    data, _ := os.ReadFile("/uploads/" + filename)  // ../../../etc/passwd
    w.Write(data)
}

// SECURE: Validate and clean path
func serveFile(w http.ResponseWriter, r *http.Request) {
    filename := filepath.Base(r.URL.Query().Get("file"))  // Strip path
    fullPath := filepath.Join("/uploads", filename)

    // Verify it's still under uploads
    absPath, _ := filepath.Abs(fullPath)
    if !strings.HasPrefix(absPath, "/uploads/") {
        http.Error(w, "Forbidden", http.StatusForbidden)
        return
    }

    http.ServeFile(w, r, absPath)
}
```

### 4. XSS in Templates

```go
// VULNERABLE: Using text/template instead of html/template
import "text/template"
tmpl := template.Must(template.ParseFiles("page.html"))
tmpl.Execute(w, userInput)  // No escaping!

// SECURE: Use html/template (auto-escapes)
import "html/template"
tmpl := template.Must(template.ParseFiles("page.html"))
tmpl.Execute(w, userInput)  // Auto-escaped

// VULNERABLE: Marking as safe incorrectly
template.HTML(userInput)  // Bypass escaping - dangerous!

// SECURE: Only use template.HTML for trusted content
template.HTML(sanitize(userInput))
```

### 5. SSRF (Server-Side Request Forgery)

```go
// VULNERABLE: Fetching user-provided URLs
func fetch(w http.ResponseWriter, r *http.Request) {
    url := r.URL.Query().Get("url")
    resp, _ := http.Get(url)  // Can access internal services!
    io.Copy(w, resp.Body)
}

// SECURE: Validate URL
func fetch(w http.ResponseWriter, r *http.Request) {
    rawURL := r.URL.Query().Get("url")
    parsedURL, err := url.Parse(rawURL)
    if err != nil {
        http.Error(w, "Invalid URL", http.StatusBadRequest)
        return
    }

    // Only allow HTTPS
    if parsedURL.Scheme != "https" {
        http.Error(w, "HTTPS only", http.StatusBadRequest)
        return
    }

    // Block internal IPs
    ips, _ := net.LookupIP(parsedURL.Hostname())
    for _, ip := range ips {
        if ip.IsPrivate() || ip.IsLoopback() {
            http.Error(w, "Forbidden", http.StatusForbidden)
            return
        }
    }

    // Proceed with fetch
}
```

### 6. JWT Vulnerabilities

```go
// VULNERABLE: Not validating algorithm
token, _ := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
    return secretKey, nil
})

// SECURE: Validate algorithm
token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
    if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
        return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
    }
    return secretKey, nil
})
```

### 7. Race Conditions

```go
// VULNERABLE: Race condition in balance check
func transfer(from, to *Account, amount int) {
    if from.Balance >= amount {  // Check
        from.Balance -= amount   // Update - race between check and update!
        to.Balance += amount
    }
}

// SECURE: Use mutex or database transactions
var mu sync.Mutex
func transfer(from, to *Account, amount int) {
    mu.Lock()
    defer mu.Unlock()
    if from.Balance >= amount {
        from.Balance -= amount
        to.Balance += amount
    }
}

// Or with database transaction
tx := db.Begin()
// SELECT ... FOR UPDATE
tx.Commit()
```

---

## Framework-Specific Security

### Gin

```go
import (
    "github.com/gin-gonic/gin"
    "github.com/gin-contrib/cors"
    "github.com/gin-contrib/secure"
)

func main() {
    r := gin.Default()

    // Security middleware
    r.Use(secure.New(secure.Config{
        SSLRedirect:           true,
        STSSeconds:            315360000,
        STSIncludeSubdomains:  true,
        FrameDeny:             true,
        ContentTypeNosniff:    true,
        BrowserXssFilter:      true,
        ContentSecurityPolicy: "default-src 'self'",
    }))

    // CORS
    r.Use(cors.New(cors.Config{
        AllowOrigins:     []string{"https://myapp.com"},
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE"},
        AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
        AllowCredentials: true,
    }))

    // Rate limiting
    r.Use(rateLimitMiddleware())
}
```

### Echo

```go
import (
    "github.com/labstack/echo/v4"
    "github.com/labstack/echo/v4/middleware"
)

func main() {
    e := echo.New()

    // Security headers
    e.Use(middleware.SecureWithConfig(middleware.SecureConfig{
        XSSProtection:         "1; mode=block",
        ContentTypeNosniff:    "nosniff",
        XFrameOptions:         "DENY",
        HSTSMaxAge:            31536000,
        ContentSecurityPolicy: "default-src 'self'",
    }))

    // CORS
    e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
        AllowOrigins: []string{"https://myapp.com"},
        AllowMethods: []string{echo.GET, echo.POST, echo.PUT, echo.DELETE},
    }))

    // CSRF
    e.Use(middleware.CSRF())

    // Rate limiting
    e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStore(20)))
}
```

---

## Secure Coding Patterns

### Input Validation

```go
import "github.com/go-playground/validator/v10"

type UserInput struct {
    Email    string `json:"email" validate:"required,email"`
    Age      int    `json:"age" validate:"gte=0,lte=130"`
    URL      string `json:"url" validate:"url"`
    Username string `json:"username" validate:"alphanum,min=3,max=30"`
}

var validate = validator.New()

func handleUser(w http.ResponseWriter, r *http.Request) {
    var input UserInput
    json.NewDecoder(r.Body).Decode(&input)

    if err := validate.Struct(input); err != nil {
        http.Error(w, "Invalid input", http.StatusBadRequest)
        return
    }
    // Process validated input
}
```

### Password Hashing

```go
import "golang.org/x/crypto/bcrypt"

func hashPassword(password string) (string, error) {
    bytes, err := bcrypt.GenerateFromPassword([]byte(password), 12)  // Cost 12
    return string(bytes), err
}

func checkPassword(password, hash string) bool {
    err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
    return err == nil
}
```

### Secure Random Generation

```go
import "crypto/rand"

func generateToken(length int) (string, error) {
    bytes := make([]byte, length)
    if _, err := rand.Read(bytes); err != nil {
        return "", err
    }
    return base64.URLEncoding.EncodeToString(bytes), nil
}
```

### HTTPS Configuration

```go
import "crypto/tls"

func main() {
    tlsConfig := &tls.Config{
        MinVersion:               tls.VersionTLS12,
        CurvePreferences:         []tls.CurveID{tls.CurveP521, tls.CurveP384, tls.CurveP256},
        PreferServerCipherSuites: true,
        CipherSuites: []uint16{
            tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
            tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
        },
    }

    server := &http.Server{
        Addr:      ":443",
        TLSConfig: tlsConfig,
    }
    server.ListenAndServeTLS("cert.pem", "key.pem")
}
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| SQL Injection | fmt.Sprintf or + in SQL strings |
| Command Injection | exec.Command("sh", "-c", ...) with user input |
| Path Traversal | filepath.Join without validation |
| XSS | text/template instead of html/template |
| SSRF | http.Get/Post with user-provided URLs |
| JWT Issues | Missing algorithm validation |
| Race Conditions | Shared state without mutex |
| Weak Crypto | math/rand instead of crypto/rand |
| Hardcoded Secrets | Strings containing "password", "secret", "key" |
| Missing TLS | http.ListenAndServe without TLS |
