import https from "node:https";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { sb } from "@/lib/deskAuth";

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 3000;
const CACHE_MS = 60 * 60 * 1000;

type OAuthClient = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  registered_via?: string | null;
  last_seen_at?: string | null;
};

export function validateCimdClientId(raw: string): URL | null {
  if (!raw || /%2e/i.test(raw) || /(^|\/)\.{1,2}(\/|$)/.test(raw)) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password || u.hash || u.search) return null;
  if (!u.pathname || u.pathname === "/") return null;
  // Stable identifiers must not change through URL normalisation.
  if (u.toString() !== raw) return null;
  return u;
}

function ipv4Number(ip: string): number | null {
  if (net.isIP(ip) !== 4) return null;
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

function inV4(ip: string, base: string, bits: number) {
  const n = ipv4Number(ip), b = ipv4Number(base);
  if (n == null || b == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

function ipv6BigInt(ip: string): bigint | null {
  if (net.isIP(ip) !== 6) return null;
  let text = ip.toLowerCase();
  const v4 = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4Number(v4[2]);
    if (n == null) return null;
    text = `${v4[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const parts = [...left, ...Array(fill).fill("0"), ...right];
  if (parts.length !== 8) return null;
  try {
    return parts.reduce((n, p) => (n << 16n) + BigInt(`0x${p || "0"}`), 0n);
  } catch { return null; }
}

function inV6(ip: string, base: string, bits: number) {
  const n = ipv6BigInt(ip), b = ipv6BigInt(base);
  if (n == null || b == null) return false;
  const shift = BigInt(128 - bits);
  return (n >> shift) === (b >> shift);
}

export function isPublicIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, bits]) => inV4(ip, base, bits));
  }
  if (net.isIP(ip) === 6) {
    // IPv4-mapped IPv6.
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    const blocked: Array<[string, number]> = [
      ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
      ["ff00::", 8], ["2001:db8::", 32],
    ];
    return !blocked.some(([base, bits]) => inV6(ip, base, bits));
  }
  return false;
}

async function pinnedJson(url: URL): Promise<any> {
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((r) => !isPublicIp(r.address)))
    throw new Error("CIMD host resolves to a non-public address");
  const pinned = records[0];

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      servername: url.hostname,
      headers: {
        Accept: "application/json",
        "User-Agent": "Terraveler-CIMD/1.0",
      },
      lookup: ((_hostname: string, _options: unknown, cb: Function) =>
        cb(null, pinned.address, pinned.family)) as any,
    }, (res) => {
      if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
        res.resume();
        return reject(new Error("CIMD redirects are not followed"));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`CIMD returned HTTP ${res.statusCode}`));
      }
      const length = Number(res.headers["content-length"] ?? 0);
      if (length > MAX_BYTES) {
        res.resume();
        return reject(new Error("CIMD exceeds size limit"));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          req.destroy(new Error("CIMD exceeds size limit"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("CIMD is not valid JSON")); }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("CIMD fetch timed out")));
    req.on("error", reject);
    req.end();
  });
}

function redirectAllowedForCimd(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash) return false;
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  const appScheme = u.protocol !== "http:" && u.protocol !== "https:" && u.protocol.includes(".");
  return u.protocol === "https:" || loopback || appScheme;
}

function validateDocument(clientId: string, doc: any): OAuthClient {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("CIMD must be a JSON object");
  if (doc.client_id !== clientId) throw new Error("CIMD client_id does not exactly match its URL");
  if (typeof doc.client_name !== "string" || !doc.client_name.trim()) throw new Error("CIMD client_name is required");
  if (!Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length || doc.redirect_uris.length > 20)
    throw new Error("CIMD redirect_uris must be a non-empty bounded array");
  if (!doc.redirect_uris.every(redirectAllowedForCimd)) throw new Error("CIMD contains an invalid redirect URI");
  if (doc.token_endpoint_auth_method && doc.token_endpoint_auth_method !== "none")
    throw new Error("Terraveler CIMD currently supports public PKCE clients only");
  if (doc.grant_types && (!Array.isArray(doc.grant_types) || !doc.grant_types.includes("authorization_code")))
    throw new Error("CIMD must allow authorization_code when grant_types is declared");
  return {
    client_id: clientId,
    client_name: doc.client_name.trim().slice(0, 120),
    redirect_uris: [...new Set(doc.redirect_uris.map(String))],
    registered_via: "cimd",
    last_seen_at: new Date().toISOString(),
  };
}

/** Resolve a pre-registered/DCR client or, for URL-form client IDs, a CIMD.
 * CIMD records are cached in oauth_clients so consent and token exchange bind to
 * the exact metadata snapshot the human saw. They are refreshed hourly. */
export async function resolveOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const encoded = encodeURIComponent(clientId);
  const rows = await sb("GET",
    `oauth_clients?client_id=eq.${encoded}&select=client_id,client_name,redirect_uris,registered_via,last_seen_at`);
  const current = rows?.[0] as OAuthClient | undefined;

  if (current && current.registered_via !== "cimd") return current;
  if (current?.last_seen_at && Date.now() - new Date(current.last_seen_at).getTime() < CACHE_MS) return current;

  const url = validateCimdClientId(clientId);
  if (!url) return current ?? null;

  const doc = await pinnedJson(url);
  const resolved = validateDocument(clientId, doc);
  if (current) {
    const patched = await sb("PATCH", `oauth_clients?client_id=eq.${encoded}`, resolved);
    return (patched?.[0] ?? resolved) as OAuthClient;
  }
  const created = await sb("POST", "oauth_clients", resolved);
  return (created?.[0] ?? resolved) as OAuthClient;
}
