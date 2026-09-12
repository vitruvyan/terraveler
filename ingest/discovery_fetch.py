import socket
import ipaddress
import urllib.request
import urllib.error
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

def untrusted_discovery_fetch(url: str) -> str:
    """
    Highly secure, constrained fetch boundary for untrusted source assessment.
    Guarantees VERIFIED DESTINATION IP == CONNECTED DESTINATION IP, completely
    preventing DNS rebinding and TOCTOU attacks while preserving Host and SNI cert validation.
    """
    current_url = url
    redirect_count = 0
    
    # Configure custom opener with redirect-following disabled
    opener = urllib.request.build_opener(BlockRedirectHandler())
    opener.addheaders = [("User-Agent", USER_AGENT)]
    
    # Keep reference to original socket creation method
    original_create_connection = socket.create_connection

    def secure_create_connection(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
        host, port = address
        # Perform DNS pre-flight and SSRF validation right at socket-creation time.
        # This binds the connection directly to a verified public IP address!
        ips = resolve_and_verify_ips(host)
        target_ip = ips[0]
        return original_create_connection((target_ip, port), timeout, source_address)

    # Monkeypatch socket.create_connection during discovery fetch
    socket.create_connection = secure_create_connection
    try:
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
    finally:
        # Always restore original socket connection method
        socket.create_connection = original_create_connection
