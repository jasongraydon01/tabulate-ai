# Ruby Web Security

Security patterns for Ruby on Rails and Sinatra applications.

---

## Ruby on Rails

### Common Vulnerabilities

**1. SQL Injection**
```ruby
# VULNERABLE: String interpolation in queries
User.where("name = '#{params[:name]}'")
User.where("name = '" + params[:name] + "'")
User.find_by_sql("SELECT * FROM users WHERE name = '#{name}'")

# SECURE: Use parameterized queries
User.where(name: params[:name])
User.where("name = ?", params[:name])
User.where("name = :name", name: params[:name])
```

**2. Mass Assignment**
```ruby
# VULNERABLE: Accepting all params (Rails < 4 without strong params)
@user = User.new(params[:user])  # Can set is_admin=true!

# SECURE: Strong parameters
def user_params
  params.require(:user).permit(:name, :email, :password)  # Whitelist
end
@user = User.new(user_params)
```

**3. Cross-Site Scripting (XSS)**
```erb
<!-- VULNERABLE: raw or html_safe with user input -->
<%= raw @user.bio %>
<%= @user.bio.html_safe %>
<%== @user.bio %>

<!-- SECURE: Let Rails auto-escape (default) -->
<%= @user.bio %>

<!-- If HTML needed, sanitize first -->
<%= sanitize @user.bio, tags: %w(p br strong em), attributes: %w(href) %>
```

**4. CSRF Bypass**
```ruby
# VULNERABLE: Skipping CSRF protection
class ApiController < ApplicationController
  skip_before_action :verify_authenticity_token  # Dangerous!
end

# SECURE: Use proper API authentication instead
class ApiController < ApplicationController
  skip_before_action :verify_authenticity_token
  before_action :authenticate_api_token  # Replace with API auth
end
```

**5. Insecure Direct Object Reference**
```ruby
# VULNERABLE: No authorization check
def show
  @document = Document.find(params[:id])  # Any user can view any doc
end

# SECURE: Scope to current user
def show
  @document = current_user.documents.find(params[:id])
end

# Or use authorization library
def show
  @document = Document.find(params[:id])
  authorize @document  # Pundit
end
```

**6. Open Redirect**
```ruby
# VULNERABLE
def callback
  redirect_to params[:return_url]  # Open redirect!
end

# SECURE: Validate redirect URL
def callback
  url = params[:return_url]
  if url.start_with?('/') && !url.start_with?('//')
    redirect_to url
  else
    redirect_to root_path
  end
end
```

**7. Command Injection**
```ruby
# VULNERABLE
system("convert #{params[:filename]} output.pdf")
`ls #{params[:dir]}`
exec("grep #{params[:pattern]} file.txt")

# SECURE: Use array form
system("convert", params[:filename], "output.pdf")

# Or use shellwords
require 'shellwords'
system("convert #{Shellwords.escape(params[:filename])} output.pdf")
```

### Rails Security Configuration

```ruby
# config/environments/production.rb
Rails.application.configure do
  # Force HTTPS
  config.force_ssl = true

  # Secure cookies
  config.session_store :cookie_store,
    key: '_myapp_session',
    secure: true,
    httponly: true,
    same_site: :lax

  # Content Security Policy
  config.content_security_policy do |policy|
    policy.default_src :self
    policy.font_src    :self, :data
    policy.img_src     :self, :data, :https
    policy.object_src  :none
    policy.script_src  :self
    policy.style_src   :self, :unsafe_inline
  end
  config.content_security_policy_nonce_generator = ->(request) { SecureRandom.base64(16) }
end

# config/initializers/filter_parameter_logging.rb
Rails.application.config.filter_parameters += [
  :password, :password_confirmation, :token, :secret, :api_key,
  :credit_card, :ssn, :social_security
]
```

### Rails Security Headers

```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  before_action :set_security_headers

  private

  def set_security_headers
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), camera=(), microphone=()'
  end
end
```

---

## Sinatra

### Common Vulnerabilities

**1. XSS**
```ruby
# VULNERABLE: No escaping
get '/greet' do
  "Hello #{params[:name]}"
end

# SECURE: Use ERB with auto-escaping
get '/greet' do
  erb :greet  # In view: Hello <%= params[:name] %>
end

# Or escape manually
require 'rack/utils'
get '/greet' do
  "Hello #{Rack::Utils.escape_html(params[:name])}"
end
```

**2. Session Security**
```ruby
# VULNERABLE: Weak session secret
enable :sessions

# SECURE: Strong secret, secure settings
set :session_secret, ENV['SESSION_SECRET']  # At least 64 bytes
set :sessions, {
  httponly: true,
  secure: production?,
  same_site: :lax,
  expire_after: 3600
}
```

**3. CSRF Protection**
```ruby
# Add CSRF protection
require 'rack/protection'
use Rack::Protection::AuthenticityToken

# In forms
<input type="hidden" name="authenticity_token" value="<%= session[:csrf] %>">
```

---

## Ruby Gems Security

### Dependency Auditing

```bash
# Install bundler-audit
gem install bundler-audit

# Run audit
bundle audit check --update

# In CI/CD
bundle audit check || exit 1
```

### Gemfile Best Practices

```ruby
# Gemfile
source 'https://rubygems.org'

# Pin versions
gem 'rails', '~> 7.1.0'

# Security-related gems
gem 'bcrypt', '~> 3.1'  # Password hashing
gem 'rack-attack'        # Rate limiting
gem 'secure_headers'     # Security headers
gem 'brakeman', require: false, group: :development  # Static analysis
```

### Brakeman Static Analysis

```bash
# Install
gem install brakeman

# Run scan
brakeman -q -z  # Quiet mode, exit with error on warnings

# Generate report
brakeman -o report.html
```

---

## Common Ruby Vulnerabilities

### Unsafe Deserialization

```ruby
# VULNERABLE: YAML with user input
YAML.load(params[:data])  # RCE possible!

# SECURE: Use safe_load
YAML.safe_load(params[:data], permitted_classes: [Date, Time])

# VULNERABLE: Marshal with user input
Marshal.load(params[:data])  # RCE!

# SECURE: Use JSON
JSON.parse(params[:data])
```

### Regular Expression DoS

```ruby
# VULNERABLE: ReDoS
email_pattern = /^([a-zA-Z0-9]+)*@/

# SECURE: Use simpler patterns or timeout
require 'timeout'
Timeout.timeout(1) do
  input.match?(pattern)
end
```

### File Operations

```ruby
# VULNERABLE: Path traversal
File.read("uploads/#{params[:filename]}")

# SECURE: Validate path
filename = File.basename(params[:filename])  # Strip path
filepath = File.join("uploads", filename)
realpath = File.realpath(filepath)
unless realpath.start_with?(File.realpath("uploads"))
  raise "Invalid path"
end
File.read(realpath)
```

### Timing Attacks

```ruby
# VULNERABLE: Simple comparison
if params[:token] == secret_token
  # ...
end

# SECURE: Constant-time comparison
require 'rack/utils'
if Rack::Utils.secure_compare(params[:token], secret_token)
  # ...
end
```

---

## Detection Checklist

| Issue | What to Look For |
|-------|------------------|
| SQL Injection | String interpolation in where(), find_by_sql() |
| XSS | raw, html_safe, <%== %> with user data |
| Mass Assignment | Missing strong_parameters, permit! |
| CSRF | skip_before_action :verify_authenticity_token |
| IDOR | Model.find(params[:id]) without scope |
| Command Injection | system(), backticks, exec() with user input |
| Deserialization | YAML.load, Marshal.load with user data |
| Open Redirect | redirect_to params[:url] |
| Secrets | Hardcoded secrets, weak session_secret |
| Path Traversal | File operations with user-controlled paths |
