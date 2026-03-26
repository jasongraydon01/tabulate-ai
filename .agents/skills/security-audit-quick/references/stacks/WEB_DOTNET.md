# .NET Web Security

Security patterns for ASP.NET Core and .NET applications.

---

## ASP.NET Core

### Common Vulnerabilities

**1. SQL Injection**
```csharp
// VULNERABLE: String concatenation
string query = "SELECT * FROM Users WHERE Id = " + userId;
var users = context.Users.FromSqlRaw(query);

string query = $"SELECT * FROM Users WHERE Name = '{name}'";

// SECURE: Parameterized queries
var users = context.Users
    .FromSqlInterpolated($"SELECT * FROM Users WHERE Id = {userId}");

// Or with parameters
var users = context.Users
    .FromSqlRaw("SELECT * FROM Users WHERE Id = {0}", userId);

// BEST: Use LINQ (safe by default)
var user = context.Users.Where(u => u.Id == userId).FirstOrDefault();
```

**2. Cross-Site Scripting (XSS)**
```csharp
// VULNERABLE: Raw HTML output
@Html.Raw(Model.UserContent)
<div>@Html.Raw(userInput)</div>

// SECURE: Razor auto-escapes by default
<div>@Model.UserContent</div>

// If HTML needed, sanitize first
@Html.Raw(HtmlSanitizer.Sanitize(Model.UserContent))
```

**3. Mass Assignment (Over-posting)**
```csharp
// VULNERABLE: Binding all properties
public class User {
    public int Id { get; set; }
    public string Name { get; set; }
    public bool IsAdmin { get; set; }  // Can be set via POST!
}

[HttpPost]
public IActionResult Create(User user) {
    _context.Users.Add(user);  // Attacker can set IsAdmin=true
    _context.SaveChanges();
}

// SECURE: Use ViewModel/DTO
public class CreateUserDto {
    public string Name { get; set; }
    public string Email { get; set; }
    // No IsAdmin property
}

[HttpPost]
public IActionResult Create(CreateUserDto dto) {
    var user = new User { Name = dto.Name, Email = dto.Email };
    _context.Users.Add(user);
    _context.SaveChanges();
}

// Or use [Bind] attribute
[HttpPost]
public IActionResult Create([Bind("Name,Email")] User user) {
    // ...
}
```

**4. Path Traversal**
```csharp
// VULNERABLE
[HttpGet]
public IActionResult Download(string filename) {
    var path = Path.Combine(_uploadsFolder, filename);
    return PhysicalFile(path, "application/octet-stream");  // ../../../etc/passwd
}

// SECURE
[HttpGet]
public IActionResult Download(string filename) {
    var safeName = Path.GetFileName(filename);  // Strip path
    var path = Path.GetFullPath(Path.Combine(_uploadsFolder, safeName));

    if (!path.StartsWith(_uploadsFolder)) {
        return Forbid();
    }

    return PhysicalFile(path, "application/octet-stream");
}
```

**5. Insecure Deserialization**
```csharp
// VULNERABLE: BinaryFormatter
BinaryFormatter formatter = new BinaryFormatter();
object obj = formatter.Deserialize(stream);  // RCE possible!

// VULNERABLE: TypeNameHandling in JSON.NET
var settings = new JsonSerializerSettings {
    TypeNameHandling = TypeNameHandling.All  // Dangerous!
};
var obj = JsonConvert.DeserializeObject(json, settings);

// SECURE: Use System.Text.Json (safe by default)
var obj = JsonSerializer.Deserialize<MyClass>(json);

// Or JSON.NET without TypeNameHandling
var settings = new JsonSerializerSettings {
    TypeNameHandling = TypeNameHandling.None
};
```

**6. SSRF**
```csharp
// VULNERABLE
[HttpGet]
public async Task<string> Fetch(string url) {
    using var client = new HttpClient();
    return await client.GetStringAsync(url);  // SSRF!
}

// SECURE
[HttpGet]
public async Task<string> Fetch(string url) {
    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) {
        return BadRequest();
    }

    if (uri.Scheme != "https") {
        return BadRequest("HTTPS only");
    }

    // Block internal IPs
    var addresses = await Dns.GetHostAddressesAsync(uri.Host);
    foreach (var addr in addresses) {
        if (IPAddress.IsLoopback(addr) || IsPrivateIP(addr)) {
            return Forbid();
        }
    }

    using var client = new HttpClient();
    return await client.GetStringAsync(uri);
}
```

**7. Open Redirect**
```csharp
// VULNERABLE
[HttpGet]
public IActionResult Login(string returnUrl) {
    // After successful login
    return Redirect(returnUrl);  // Open redirect!
}

// SECURE
[HttpGet]
public IActionResult Login(string returnUrl) {
    if (Url.IsLocalUrl(returnUrl)) {
        return Redirect(returnUrl);
    }
    return RedirectToAction("Index", "Home");
}
```

### Security Configuration

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Add authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options => {
        options.TokenValidationParameters = new TokenValidationParameters {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]))
        };
    });

// Add authorization
builder.Services.AddAuthorization(options => {
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("Admin"));
});

// Configure cookie options
builder.Services.ConfigureApplicationCookie(options => {
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.ExpireTimeSpan = TimeSpan.FromHours(1);
    options.SlidingExpiration = true;
});

var app = builder.Build();

// Security headers
app.Use(async (context, next) => {
    context.Response.Headers.Add("X-Content-Type-Options", "nosniff");
    context.Response.Headers.Add("X-Frame-Options", "DENY");
    context.Response.Headers.Add("X-XSS-Protection", "1; mode=block");
    context.Response.Headers.Add("Referrer-Policy", "strict-origin-when-cross-origin");
    context.Response.Headers.Add("Content-Security-Policy", "default-src 'self'");
    await next();
});

// HTTPS redirection
app.UseHttpsRedirection();
app.UseHsts();

// Anti-forgery for MVC
app.UseAntiforgery();
```

### appsettings.json Security

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Warning"
    }
  },
  "AllowedHosts": "myapp.com;www.myapp.com",
  "Kestrel": {
    "Endpoints": {
      "Https": {
        "Url": "https://*:443",
        "SslProtocols": ["Tls12", "Tls13"]
      }
    }
  }
}
```

---

## Entity Framework Security

### Parameterized Queries

```csharp
// Raw SQL - use parameters
var users = context.Users
    .FromSqlInterpolated($"SELECT * FROM Users WHERE Email = {email}")
    .ToList();

// Stored procedures
var users = context.Users
    .FromSqlRaw("EXEC GetUserByEmail @Email", new SqlParameter("@Email", email))
    .ToList();
```

### Prevent Lazy Loading Data Exposure

```csharp
// Use projection to control data
var userDto = context.Users
    .Where(u => u.Id == userId)
    .Select(u => new UserDto {
        Id = u.Id,
        Name = u.Name
        // Don't include sensitive fields
    })
    .FirstOrDefault();
```

---

## ASP.NET Core Identity

### Password Configuration

```csharp
builder.Services.Configure<IdentityOptions>(options => {
    // Password settings
    options.Password.RequireDigit = true;
    options.Password.RequireLowercase = true;
    options.Password.RequireUppercase = true;
    options.Password.RequireNonAlphanumeric = true;
    options.Password.RequiredLength = 12;
    options.Password.RequiredUniqueChars = 4;

    // Lockout settings
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.AllowedForNewUsers = true;

    // User settings
    options.User.RequireUniqueEmail = true;
});
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| SQL Injection | String concat in FromSqlRaw, ExecuteSqlRaw |
| XSS | Html.Raw with user data |
| Mass Assignment | Entity directly as action parameter |
| Deserialization | BinaryFormatter, TypeNameHandling.All |
| Path Traversal | Path.Combine with user input |
| SSRF | HttpClient.GetAsync with user URLs |
| Open Redirect | Redirect() without Url.IsLocalUrl |
| CSRF | Missing [ValidateAntiForgeryToken] |
| Secrets | Connection strings in appsettings.json |
| Missing Auth | Actions without [Authorize] |
