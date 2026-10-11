export const MAX_HTML_BYTES = 1_500_000;
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 8_000;

export class RecipeUrlError extends Error {
  readonly code: 'invalid-url' | 'blocked-host' | 'fetch-failed' | 'too-large' | 'not-html' | 'no-recipe';
  constructor(code: 'invalid-url' | 'blocked-host' | 'fetch-failed' | 'too-large' | 'not-html' | 'no-recipe') {
    super(code);
    this.code = code;
  }
}

export interface PinnedResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

export interface RecipeUrlTransport {
  resolve(hostname: string, signal: AbortSignal): Promise<string[]>;
  request(url: URL, address: string, signal: AbortSignal): Promise<PinnedResponse>;
}

export function extractJsonLdRecipe(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    // Attribute names must begin at a whitespace boundary; `data-type` is not `type`.
    const type = match[1].match(/\s+type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if ((type?.[1] ?? type?.[2] ?? type?.[3] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/ld+json') continue;
    try {
      const found = findRecipe(JSON.parse(match[2].replace(/<!--|-->/g, '').trim()));
      if (found) return found;
    } catch { /* Ignore malformed JSON-LD and inspect other blocks. */ }
  }
  return null;
}

/** Resolve, validate and connect to the exact validated address, rechecking each redirect. */
export async function fetchRecipeHtml(input: string, transport: RecipeUrlTransport, timeoutMs = FETCH_TIMEOUT_MS): Promise<{ html: string; finalUrl: string }> {
  let url = parseRecipeUrl(input);
  const deadline = Date.now() + timeoutMs;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RecipeUrlError('fetch-failed');
    const addresses = isIpLiteral(url.hostname)
      ? [stripIpv6Brackets(url.hostname)]
      : await resolveWithTimeout(url.hostname, transport, remaining);
    if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new RecipeUrlError('blocked-host');

    const response = await withTimeout(signal => transport.request(url, addresses[0], signal), Math.max(1, deadline - Date.now()));
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_REDIRECTS) throw new RecipeUrlError('fetch-failed');
      const location = response.headers.get('location');
      if (!location) throw new RecipeUrlError('fetch-failed');
      url = parseRecipeUrl(new URL(location, url).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new RecipeUrlError('fetch-failed');
    if (response.body.byteLength > MAX_HTML_BYTES) throw new RecipeUrlError('too-large');
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'text/html') throw new RecipeUrlError('not-html');
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new RecipeUrlError('fetch-failed');
    return { html: new TextDecoder('utf-8', { fatal: false }).decode(response.body), finalUrl: url.toString() };
  }
  throw new RecipeUrlError('fetch-failed');
}

export function parseRecipeUrl(input: string): URL {
  if (input.length > 2_048) throw new RecipeUrlError('invalid-url');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new RecipeUrlError('invalid-url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new RecipeUrlError('invalid-url');
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) throw new RecipeUrlError('invalid-url');
  url.hash = '';
  const host = stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || !host.includes('.') && !isIpLiteral(url.hostname)
    || /\.(?:localhost|local|internal|lan|home|arpa|onion|test|invalid|example)$/i.test(host)) throw new RecipeUrlError('blocked-host');
  if (isIpLiteral(url.hostname) && !isPublicAddress(host)) throw new RecipeUrlError('blocked-host');
  return url;
}

async function resolveWithTimeout(host: string, transport: RecipeUrlTransport, timeoutMs: number): Promise<string[]> {
  const values = await withTimeout(signal => transport.resolve(stripIpv6Brackets(host), signal), timeoutMs);
  return [...new Set(values)];
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await run(controller.signal); }
  catch (error) {
    if (controller.signal.aborted) throw new RecipeUrlError('fetch-failed');
    throw error;
  } finally { clearTimeout(timer); }
}

export function isPublicAddress(address: string): boolean {
  const ipv4 = parseIPv4(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99)))
      || (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  const ipv6 = parseIPv6(address);
  if (!ipv6) return false;
  // Only global unicast (2000::/3); exclude documentation, transition and special-purpose blocks.
  if ((ipv6[0] & 0xe000) !== 0x2000) return false;
  // 3fff::/20 is documentation space (RFC 9637), despite falling inside 2000::/3.
  if (ipv6[0] === 0x3fff && (ipv6[1] & 0xf000) === 0) return false;
  if ((ipv6[0] === 0x2001 && (ipv6[1] === 0x0db8 || ipv6[1] <= 0x01ff)) || ipv6[0] === 0x2002) return false;
  return true;
}

function isIpLiteral(host: string): boolean { return !!parseIPv4(host) || !!parseIPv6(stripIpv6Brackets(host)); }
function stripIpv6Brackets(host: string): string { return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host; }

function parseIPv4(input: string): number[] | null {
  // URL's hostname canonicalization collapses legacy octal/decimal/short IPv4 forms before this check.
  const match = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(part => part >= 0 && part <= 255) ? parts : null;
}

function parseIPv6(input: string): number[] | null {
  if (!input.includes(':') || input.includes('%')) return null;
  const halves = input.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const parts = half.split(':');
    if (parts.some(part => !/^[\da-f]{1,4}$/.test(part))) return null;
    return parts.map(part => Number.parseInt(part, 16));
  };
  const left = parseHalf(halves[0]); const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array(missing).fill(0), ...right] : null;
}

function findRecipe(value: unknown): Record<string, unknown> | null {
  const pending: unknown[] = [value];
  const maxNodes = 20_000;
  let visited = 0;
  while (pending.length && visited++ < maxNodes) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) pending.push(current[index]);
      continue;
    }
    if (typeof current !== 'object' || current === null) continue;
    const record = current as Record<string, unknown>;
    const rawType = record['@type'];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    if (types.some(type => typeof type === 'string' && /(?:^|\/|:)Recipe$/i.test(type)) && typeof record['name'] === 'string') return record;
    // Reverse-push to preserve the document's original depth-first order.
    const children = Object.values(record);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
  return null;
}
