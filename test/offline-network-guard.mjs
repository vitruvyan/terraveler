/** Preloaded before test/application imports. Source and provider tests must mock
 * fetch explicitly. No external fetch may leave an offline regression process.
 * Keep native loopback fetch for the local TLS certificate integration fixture.
 */
const nativeFetch = globalThis.fetch;
globalThis.fetch = function offlineFetch(input, init) {
  const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
  let url;
  try { url = new URL(raw); } catch { return Promise.reject(new Error('offline-test-invalid-url')); }
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return nativeFetch(input, { ...init, redirect: 'error' });
  return Promise.reject(new Error('offline-test-unmocked-fetch: install a fixture transport'));
};
