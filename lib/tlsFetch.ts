import https from "node:https";
import tls from "node:tls";
import TLS_INTERMEDIATES from "@/vocab/tls_intermediates.json";

/**
 * HTTPS for the few hosts whose servers send an incomplete certificate chain —
 * the TypeScript twin of ingest/tls.py, reading the same
 * vocab/tls_intermediates.json.
 *
 * The Ministerio de Cultura's PARES portal serves only its leaf certificate and
 * omits the FNMT intermediate that issued it, so Node's `fetch` refuses it
 * (UNABLE_TO_VERIFY_LEAF_SIGNATURE). The remedy is not to switch verification
 * off: the listed intermediate is trusted IN ADDITION to Node's bundled roots,
 * for that host only. A certificate listed there can complete a chain that ends
 * at a root already trusted; it cannot make an unknown root trusted. Any other
 * host is not served by this module at all.
 */
const HOSTS = (TLS_INTERMEDIATES as { hosts: Record<string, { pem: string }> }).hosts;

export function extraCaFor(hostname: string): string | null {
  return HOSTS[hostname.toLowerCase().replace(/\.$/, "")]?.pem ?? null;
}

export interface TlsResponse {
  status: number;
  body: string;
  location: string | null;
}

/**
 * One GET, no redirects followed (the caller decides what a redirect means),
 * body capped. Refuses a host with no listed intermediate: this is not a
 * general-purpose fetch and must not become a way around normal verification.
 */
export function getWithExtraCa(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number; userAgent?: string; ca?: string[] } = {},
): Promise<TlsResponse> {
  const url = new URL(rawUrl);
  // `opts.ca` is a test seam (a local server with a throwaway chain); production
  // callers never pass it, so they are held to the listed hosts.
  const extra = opts.ca ? "" : extraCaFor(url.hostname);
  if (extra === null) return Promise.reject(new Error(`getWithExtraCa: no listed intermediate for ${url.hostname}`));
  if (url.protocol !== "https:") return Promise.reject(new Error("getWithExtraCa: https only"));

  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  return new Promise<TlsResponse>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: { "User-Agent": opts.userAgent ?? "terraveler/1.0", Accept: "text/html" },
        // Node's bundled roots + the one listed intermediate. `opts.ca` is a
        // seam for tests; production never passes it.
        ca: opts.ca ?? [...tls.rootCertificates, extra],
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error(`response larger than ${maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            location: (res.headers.location as string | undefined) ?? null,
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`request to ${url.host} timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}
