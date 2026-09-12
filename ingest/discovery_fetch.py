import socket
import ipaddress
import urllib.request
import urllib.error
import http.client
import ssl
from urllib.parse import urlparse

# Strict security boundaries for the Untrusted Discovery Fetch Zone
MAX_REDIRECTS = 3
MAX_RESPONSE_SIZE = 2 * 1024 * 1024  # 2MB
TIMEOUT_SECONDS = 10
ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_CONTENT_TYPES = {"text/html", "text/plain", "application/json", "application/xml", "text/xml"}
USER_AGENT = "TerraVeler-Archivist-Discovery/1.0"

class RedirectException(Exception):
    """Custom exception raised when a redirect is intercepted, carrying the code and target location."""
    def __init__(self, code, location):
        self.code = code
        self.location = location

class BlockRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Custom redirect handler that blocks automatic redirect following, throwing an exception instead."""
    def http_error_301(self, req, fp, code, msg, headers):
        location = headers.get("Location")
        raise RedirectException(code, location)
    http_error_302 = http_error_301
    http_error_303 = http_error_301
    http_error_307 = http_error_301
    http_error_308 = http_error_301

def is_safe_ip(ip_str: str) -> bool:
    """Verifies if an IP address is a public, globally-routable internet IP."""
    try:
        ip = ipaddress.ip_address(ip_str)
        # Block private, loopback, link-local, multicast, or unspecified addresses
        if (ip.is_loopback or 
            ip.is_private or 
            ip.is_link_local or 
            ip.is_multicast or 
            ip.is_reserved or 
            ip.is_unspecified):
            return False
        return True
    except ValueError:
        return False

def resolve_and_verify_ips(host: str) -> list[str]:
    """Resolves host to IPs and verifies them against the SSRF safety boundaries."""
    try:
        # Resolve all IP addresses for the host
        addr_info = socket.getaddrinfo(host, None)
        ips = {info[4][0] for info in addr_info}
        
        if not ips:
            raise ValueError(f"Could not resolve host: {host}")
            
        for ip in ips:
            # If any resolved IP is unsafe, block the entire fetch
            if not is_safe_ip(ip):
                raise PermissionError(f"Unsafe target IP blocked: {ip}")
        
        return list(ips)
    except socket.gaierror:
        raise ValueError(f"DNS lookup failed for host: {host}")

def validate_url(url: str) -> tuple[str, str]:
    """Parses and validates scheme, host, and port against security constraints."""
    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()
    
    if parsed.username or parsed.password:
        raise PermissionError("UserInfo credentials in URL are blocked.")
        
    if scheme not in ALLOWED_SCHEMES:
        raise PermissionError(f"Rejected scheme: {scheme}. Only HTTP/HTTPS is permitted.")
        
    if not host:
        raise ValueError("Invalid URL: missing host.")
        
    # Check custom ports
    if parsed.port and parsed.port not in (80, 443):
        raise PermissionError(f"Non-standard port blocked: {parsed.port}")
        
    return scheme, host

# ----------------------------------------------------------------------------
# Request-Local Pinned-IP Transport and Handlers (No Global Socket Monkeypatch)
# ----------------------------------------------------------------------------

class SecureHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection that binds to verified IP while keeping original host for headers."""
    def connect(self):
        ips = resolve_and_verify_ips(self.host)
        # Always connect to the verified IP directly (preventing DNS-rebinding/TOCTOU)
        self.sock = socket.create_connection((ips[0], self.port), self.timeout, self.source_address)

class SecureHTTPSConnection(http.client.HTTPSConnection):
    """HTTPSConnection that binds to verified IP while keeping original host for SNI and SSL."""
    def connect(self):
        ips = resolve_and_verify_ips(self.host)
        # Always connect to the verified IP directly (preventing DNS-rebinding/TOCTOU)
        self.sock = socket.create_connection((ips[0], self.port), self.timeout, self.source_address)
        
        if self._tunnel_host:
            self._tunnel()
            server_hostname = self._tunnel_host
        else:
            server_hostname = self.host
            
        context = self._context or ssl.create_default_context()
        # Perform TLS handshake using verified socket and original server_hostname for SNI / cert validation
        self.sock = context.wrap_socket(self.sock, server_hostname=server_hostname)

class SecureHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(SecureHTTPConnection, req)

class SecureHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(SecureHTTPSConnection, req)

def untrusted_discovery_fetch(url: str) -> str:
    """
    Highly secure, constrained fetch boundary for untrusted source assessment.
    Guarantees VERIFIED DESTINATION IP == CONNECTED DESTINATION IP, completely
    preventing DNS rebinding and TOCTOU attacks via request-local transport classes.
    """
    current_url = url
    redirect_count = 0
    
    # Configure custom opener with local, secure transport handlers (no global side-effects)
    # Exclude system/ambient proxies to guarantee verified target IP == connected target IP
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        BlockRedirectHandler(),
        SecureHTTPHandler(),
        SecureHTTPSHandler()
    )
    opener.addheaders = [("User-Agent", USER_AGENT)]
    
    while redirect_count <= MAX_REDIRECTS:
        scheme, host = validate_url(current_url)
        
        req = urllib.request.Request(current_url)
        try:
            # Execute fetch with strict timeout
            with opener.open(req, timeout=TIMEOUT_SECONDS) as response:
                # Enforce Content-Type restrictions
                content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if content_type and content_type not in ALLOWED_CONTENT_TYPES:
                    raise PermissionError(f"Blocked content type: {content_type}")
                
                # Read stream with strict size bounds (preventing OOM zip bombs)
                body_bytes = response.read(MAX_RESPONSE_SIZE + 1)
                if len(body_bytes) > MAX_RESPONSE_SIZE:
                    raise PermissionError(f"Response size exceeded the limit of {MAX_RESPONSE_SIZE} bytes.")
                    
                return body_bytes.decode("utf-8", "replace")
                
        except RedirectException as re:
            redirect_count += 1
            if redirect_count > MAX_REDIRECTS:
                raise PermissionError("Max redirect count exceeded.")
                
            if not re.location:
                raise ValueError("Redirect response missing Location header.")
                
            # Resolve relative redirect URLs and re-evaluate on next loop iteration
            current_url = urllib.parse.urljoin(current_url, re.location)
            continue
            
        except urllib.error.URLError as e:
            raise IOError(f"Network error during fetch: {e.reason}")
            
    raise PermissionError("Redirect boundary violated.")
