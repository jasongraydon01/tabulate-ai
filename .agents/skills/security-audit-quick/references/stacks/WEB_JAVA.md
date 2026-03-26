# Java Web Security

Security patterns for Spring Boot, Spring Security, and Jakarta EE applications.

---

## Spring Boot / Spring Security

### Common Vulnerabilities

**1. SQL Injection**
```java
// VULNERABLE: String concatenation
String query = "SELECT * FROM users WHERE id = " + userId;
Statement stmt = connection.createStatement();
ResultSet rs = stmt.executeQuery(query);

// VULNERABLE: String formatting
String query = String.format("SELECT * FROM users WHERE name = '%s'", name);

// SECURE: PreparedStatement
PreparedStatement pstmt = connection.prepareStatement(
    "SELECT * FROM users WHERE id = ?"
);
pstmt.setInt(1, userId);
ResultSet rs = pstmt.executeQuery();

// SECURE: JPA/Hibernate
@Query("SELECT u FROM User u WHERE u.email = :email")
User findByEmail(@Param("email") String email);

// SECURE: Spring Data JPA
userRepository.findByEmail(email);
```

**2. Mass Assignment (Parameter Binding)**
```java
// VULNERABLE: Binding all request params to entity
@PostMapping("/user")
public User createUser(@RequestBody User user) {
    // User can set isAdmin=true in request!
    return userRepository.save(user);
}

// SECURE: Use DTO with allowed fields only
public class CreateUserDTO {
    private String name;
    private String email;
    // No isAdmin field
}

@PostMapping("/user")
public User createUser(@RequestBody CreateUserDTO dto) {
    User user = new User();
    user.setName(dto.getName());
    user.setEmail(dto.getEmail());
    return userRepository.save(user);
}
```

**3. XXE (XML External Entity)**
```java
// VULNERABLE: Default XML parser
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
DocumentBuilder db = dbf.newDocumentBuilder();
Document doc = db.parse(xmlInput);  // XXE possible!

// SECURE: Disable external entities
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
```

**4. Insecure Deserialization**
```java
// VULNERABLE: Deserializing untrusted data
ObjectInputStream ois = new ObjectInputStream(userInput);
Object obj = ois.readObject();  // RCE possible!

// SECURE: Use JSON instead
ObjectMapper mapper = new ObjectMapper();
UserDTO dto = mapper.readValue(userInput, UserDTO.class);

// If Java serialization needed, use allowlist
ObjectInputStream ois = new ObjectInputStream(userInput) {
    @Override
    protected Class<?> resolveClass(ObjectStreamClass desc) throws IOException, ClassNotFoundException {
        if (!ALLOWED_CLASSES.contains(desc.getName())) {
            throw new InvalidClassException("Unauthorized class", desc.getName());
        }
        return super.resolveClass(desc);
    }
};
```

**5. Path Traversal**
```java
// VULNERABLE
@GetMapping("/files/{filename}")
public Resource getFile(@PathVariable String filename) {
    Path path = Paths.get("/uploads/" + filename);  // ../../../etc/passwd
    return new FileSystemResource(path);
}

// SECURE
@GetMapping("/files/{filename}")
public Resource getFile(@PathVariable String filename) {
    Path basePath = Paths.get("/uploads").toAbsolutePath().normalize();
    Path filePath = basePath.resolve(filename).normalize();

    if (!filePath.startsWith(basePath)) {
        throw new AccessDeniedException("Invalid path");
    }
    return new FileSystemResource(filePath);
}
```

**6. SSRF**
```java
// VULNERABLE
@GetMapping("/fetch")
public String fetch(@RequestParam String url) throws Exception {
    return new RestTemplate().getForObject(url, String.class);  // SSRF!
}

// SECURE: Validate URL
@GetMapping("/fetch")
public String fetch(@RequestParam String url) throws Exception {
    URL parsedUrl = new URL(url);

    // Only HTTPS
    if (!"https".equals(parsedUrl.getProtocol())) {
        throw new IllegalArgumentException("HTTPS only");
    }

    // Block internal IPs
    InetAddress address = InetAddress.getByName(parsedUrl.getHost());
    if (address.isLoopbackAddress() || address.isSiteLocalAddress()) {
        throw new IllegalArgumentException("Internal URLs blocked");
    }

    // Allowlist domains
    if (!ALLOWED_DOMAINS.contains(parsedUrl.getHost())) {
        throw new IllegalArgumentException("Domain not allowed");
    }

    return new RestTemplate().getForObject(url, String.class);
}
```

### Spring Security Configuration

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // CSRF protection (enabled by default)
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            )

            // Security headers
            .headers(headers -> headers
                .frameOptions(frame -> frame.deny())
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'; script-src 'self'")
                )
                .httpStrictTransportSecurity(hsts -> hsts
                    .includeSubDomains(true)
                    .maxAgeInSeconds(31536000)
                )
            )

            // Session management
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                .maximumSessions(1)
                .sessionFixation().migrateSession()
            )

            // Authorization
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            );

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);  // Cost factor 12
    }
}
```

### Application Properties Security

```properties
# application.properties

# Server security
server.servlet.session.cookie.secure=true
server.servlet.session.cookie.http-only=true
server.servlet.session.cookie.same-site=lax

# Hide server info
server.error.include-stacktrace=never
server.error.include-message=never

# Actuator security (if using)
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=never

# HTTPS only
server.ssl.enabled=true
server.ssl.protocol=TLS
server.ssl.enabled-protocols=TLSv1.2,TLSv1.3
```

---

## Jakarta EE (Java EE)

### Common Vulnerabilities

**1. EL Injection**
```java
// VULNERABLE: User input in Expression Language
String template = "Hello ${" + userInput + "}";
// Attack: userInput = "Runtime.getRuntime().exec('cmd')"

// SECURE: Use safe templating
String template = "Hello ${name}";
context.setVariable("name", userInput);
```

**2. JNDI Injection**
```java
// VULNERABLE: User input in JNDI lookup
InitialContext ctx = new InitialContext();
ctx.lookup(userInput);  // Can load remote classes!

// SECURE: Validate/whitelist lookup names
private static final Set<String> ALLOWED_JNDI = Set.of("java:comp/env/jdbc/mydb");

if (!ALLOWED_JNDI.contains(jndiName)) {
    throw new SecurityException("Invalid JNDI name");
}
ctx.lookup(jndiName);
```

---

## Dependency Security

### Maven

```xml
<!-- pom.xml -->
<plugin>
    <groupId>org.owasp</groupId>
    <artifactId>dependency-check-maven</artifactId>
    <version>9.0.0</version>
    <executions>
        <execution>
            <goals>
                <goal>check</goal>
            </goals>
        </execution>
    </executions>
    <configuration>
        <failBuildOnCVSS>7</failBuildOnCVSS>
    </configuration>
</plugin>
```

### Gradle

```groovy
// build.gradle
plugins {
    id 'org.owasp.dependencycheck' version '9.0.0'
}

dependencyCheck {
    failBuildOnCVSS = 7
}
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| SQL Injection | String concat in queries, Statement vs PreparedStatement |
| XXE | DocumentBuilderFactory without secure config |
| Deserialization | ObjectInputStream with untrusted data |
| Mass Assignment | @RequestBody binding to entity directly |
| Path Traversal | Paths.get with user input |
| SSRF | RestTemplate/WebClient with user URLs |
| EL Injection | User input in JSP/EL expressions |
| JNDI Injection | Context.lookup with user input |
| Weak Crypto | MD5, SHA-1 for passwords; hardcoded keys |
| Missing Auth | Endpoints without @PreAuthorize or antMatchers |
