import { createClient } from 'npm:@supabase/supabase-js@2.86.0';
import { extractJsonLdRecipe, fetchRecipeHtml, MAX_HTML_BYTES, RecipeUrlError, type PinnedResponse, type RecipeUrlTransport } from '../_shared/recipe-url.ts';

const allowedOrigins = new Set([
  'https://hjelmdev.github.io',
  'http://127.0.0.1:4200',
  'http://localhost:4200',
]);
const corsHeaders = (origin: string | null): HeadersInit => ({
  'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://hjelmdev.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Ogiltig förfrågan.' }, 405, headers);
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Förfrågan kommer från en okänd appadress.' }, 403, headers);

  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: 'Logga in för att importera ett recept.' }, 401, headers);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !publicKey) return json({ error: 'Receptimporten är inte konfigurerad ännu.' }, 503, headers);
  try {
    const client = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    if (error || !data.user) return json({ error: 'Din inloggning behöver förnyas. Logga in igen.' }, 401, headers);
  } catch {
    return json({ error: 'Inloggningen kunde inte verifieras just nu.' }, 503, headers);
  }

  let input: unknown;
  try {
    input = await readSmallJson(request, 4_096);
  } catch { return json({ error: 'Skriv in en giltig webbadress.' }, 400, headers); }
  const url = typeof input === 'object' && input !== null && 'url' in input ? (input as { url?: unknown }).url : null;
  if (typeof url !== 'string' || url.length > 2_048) return json({ error: 'Skriv in en giltig webbadress.' }, 400, headers);

  try {
    const transport: RecipeUrlTransport = {
      resolve: resolvePublicAddresses,
      request: requestPinned,
    };
    const fetched = await fetchRecipeHtml(url, transport);
    if (new TextEncoder().encode(fetched.html).byteLength > MAX_HTML_BYTES) throw new RecipeUrlError('too-large');
    const recipe = extractJsonLdRecipe(fetched.html);
    if (!recipe) return json({ code: 'NO_RECIPE', error: 'Hittade inget strukturerat recept på sidan. Klistra in recepttexten här i stället.' }, 422, headers);
    return json({ recipe, sourceUrl: url.trim(), finalUrl: fetched.finalUrl }, 200, headers);
  } catch (error) {
    const message = error instanceof RecipeUrlError ? error.code : 'fetch-failed';
    const response: Record<string, string> = {
      'invalid-url': 'Ange en giltig länk som börjar med http:// eller https://.',
      'blocked-host': 'Den här adressen kan inte hämtas av säkerhetsskäl.',
      'too-large': 'Receptsidan är för stor för att importera säkert.',
      'not-html': 'Länken pekar inte på en vanlig webbsida.',
      'no-recipe': 'Hittade inget strukturerat recept. Klistra in recepttexten som reserv.',
      'fetch-failed': 'Receptsidan kunde inte hämtas. Kontrollera länken och försök igen.',
    };
    const status = message === 'invalid-url' || message === 'blocked-host' ? 400 : message === 'too-large' ? 413 : message === 'not-html' ? 415 : message === 'no-recipe' ? 422 : 502;
    return json({ code: message === 'fetch-failed' ? 'FETCH_FAILED' : message === 'no-recipe' ? 'NO_RECIPE' : message.toUpperCase().replaceAll('-', '_'), error: response[message] }, status, headers);
  }
});

function json(value: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...Object.fromEntries(new Headers(headers)), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function resolvePublicAddresses(host: string, signal: AbortSignal): Promise<string[]> {
  if (signal.aborted) throw new Error('aborted');
  const results = await Promise.allSettled([
    Deno.resolveDns(host, 'A', { signal }),
    Deno.resolveDns(host, 'AAAA', { signal }),
  ]);
  const values = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!values.length) throw new RecipeUrlError('fetch-failed');
  return values;
}

async function readSmallJson(request: Request, limit: number): Promise<unknown> {
  if (!request.body) throw new Error('empty body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('request too large');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(content));
}

/** Connects to the validated numeric address directly; TLS still validates the original hostname. */
async function requestPinned(url: URL, address: string, signal: AbortSignal): Promise<PinnedResponse> {
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  let connection: Deno.Conn | null = null;
  let active: Deno.Conn | null = null;
  try {
    connection = await Deno.connect({ hostname: address, port, transport: 'tcp', signal });
    signal.addEventListener('abort', () => { try { connection?.close(); } catch { /* Already closed. */ } }, { once: true });
    active = url.protocol === 'https:'
      ? await Deno.startTls(connection, { hostname: url.hostname.replace(/^\[|\]$/g, ''), alpnProtocols: ['http/1.1'] })
      : connection;
    signal.addEventListener('abort', () => { try { active?.close(); } catch { /* Already closed. */ } }, { once: true });
    const host = url.host;
    const path = `${url.pathname || '/'}${url.search}`;
    const requestText = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAccept: text/html\r\nAccept-Encoding: identity\r\nUser-Agent: MiddagstipsetRecipeImporter/1.0\r\nConnection: close\r\n\r\n`;
    await writeAll(active, new TextEncoder().encode(requestText));
    const bytes = await readBounded(active, MAX_HTML_BYTES + 32_768);
    return parseHttpResponse(bytes);
  } finally {
    try { active?.close(); } catch { /* Ignore cleanup errors. */ }
    if (connection && connection !== active) { try { connection.close(); } catch { /* Ignore cleanup errors. */ } }
  }
}

async function writeAll(connection: Deno.Conn, bytes: Uint8Array): Promise<void> {
  let written = 0;
  while (written < bytes.length) written += await connection.write(bytes.subarray(written));
}

async function readBounded(connection: Deno.Conn, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const buffer = new Uint8Array(16_384);
  while (true) {
    const count = await connection.read(buffer);
    if (count === null) break;
    total += count;
    if (total > maxBytes) throw new RecipeUrlError('too-large');
    chunks.push(buffer.slice(0, count));
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function parseHttpResponse(bytes: Uint8Array): PinnedResponse {
  const marker = new Uint8Array([13, 10, 13, 10]);
  let split = -1;
  for (let index = 0; index <= bytes.length - marker.length; index++) {
    if (marker.every((value, offset) => bytes[index + offset] === value)) { split = index; break; }
  }
  if (split < 0 || split > 32_768) throw new RecipeUrlError('fetch-failed');
  const headerText = new TextDecoder('latin1').decode(bytes.subarray(0, split));
  const lines = headerText.split('\r\n');
  const statusMatch = lines[0]?.match(/^HTTP\/1\.[01]\s+(\d{3})\b/);
  if (!statusMatch) throw new RecipeUrlError('fetch-failed');
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'content-length' && Number(value) > MAX_HTML_BYTES) throw new RecipeUrlError('too-large');
    if (key === 'content-type' || key === 'content-encoding' || key === 'transfer-encoding' || key === 'location' || key === 'content-length') headers.set(key, value);
  }
  let body = bytes.slice(split + marker.length);
  const transferEncoding = headers.get('transfer-encoding')?.toLowerCase().trim();
  if (transferEncoding && (transferEncoding !== 'chunked' || headers.has('content-length'))) throw new RecipeUrlError('fetch-failed');
  if (transferEncoding === 'chunked') body = decodeChunked(body);
  if (body.byteLength > MAX_HTML_BYTES) throw new RecipeUrlError('too-large');
  const length = headers.get('content-length');
  if (length !== null && body.length !== Number(length)) throw new RecipeUrlError('fetch-failed');
  return { status: Number(statusMatch[1]), headers, body };
}

function decodeChunked(bytes: Uint8Array): Uint8Array {
  const output: number[] = [];
  let offset = 0;
  let complete = false;
  while (offset < bytes.length) {
    const lineEnd = findCrlf(bytes, offset);
    if (lineEnd < 0) throw new RecipeUrlError('fetch-failed');
    const sizeText = new TextDecoder().decode(bytes.subarray(offset, lineEnd)).split(';', 1)[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) throw new RecipeUrlError('fetch-failed');
    offset = lineEnd + 2;
    if (size === 0) { complete = true; break; }
    if (size > MAX_HTML_BYTES || offset + size + 2 > bytes.length || output.length + size > MAX_HTML_BYTES) throw new RecipeUrlError('too-large');
    for (const byte of bytes.subarray(offset, offset + size)) output.push(byte);
    offset += size;
    if (bytes[offset] !== 13 || bytes[offset + 1] !== 10) throw new RecipeUrlError('fetch-failed');
    offset += 2;
  }
  if (!complete) throw new RecipeUrlError('fetch-failed');
  return Uint8Array.from(output);
}

function findCrlf(bytes: Uint8Array, start: number): number {
  for (let index = start; index + 1 < bytes.length; index++) if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  return -1;
}
