import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJsonLdRecipe, fetchRecipeHtml, isPublicAddress, MAX_HTML_BYTES, parseRecipeUrl, RecipeUrlError, type PinnedResponse, type RecipeUrlTransport } from '../supabase/functions/_shared/recipe-url.ts';

const html = (body = '<script type="application/ld+json">{"@type":"Recipe","name":"Soppa"}</script>'): PinnedResponse => ({
  status: 200,
  headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
  body: new TextEncoder().encode(body),
});

function transport(options: Partial<RecipeUrlTransport> = {}): RecipeUrlTransport {
  return {
    resolve: options.resolve ?? (async () => ['93.184.216.34']),
    request: options.request ?? (async () => html()),
  };
}

test('accepts only public HTTP(S) URLs and normalizes legacy numeric IPv4 first', () => {
  assert.equal(parseRecipeUrl('https://example.org/meal#ingredients').hash, '');
  for (const address of [
    'http://2130706433/', 'http://127.1/recipe', 'http://0x7f000001/',
    'http://localhost/recipe', 'http://10.1.2.3/',
    'http://169.254.169.254/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://service.internal/', 'https://example.org:8443/','ftp://example.org/','https://user:pass@example.org/',
  ]) assert.throws(() => parseRecipeUrl(address), RecipeUrlError, address);
});

test('public address checks reject private, reserved, mapped, and documentation addresses', () => {
  for (const address of ['0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.4.1', '172.31.0.1', '192.168.1.1', '198.51.100.3', '203.0.113.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '3fff::1', '3fff:0fff::1', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
});

test('extracts direct JSON-LD Recipe and Recipe nested in arrays, graph and page objects', () => {
  const direct = extractJsonLdRecipe(`<script type="application/ld+json">${JSON.stringify({ '@type': 'https://schema.org/Recipe', name: 'Direkt' })}</script>`);
  assert.equal(direct?.['name'], 'Direkt');
  const nested = extractJsonLdRecipe(`<script type="application/ld+json">${JSON.stringify([
    { '@type': 'WebPage', mainEntity: { '@type': 'Recipe', name: 'Inuti sida' } },
    { '@graph': [{ '@type': 'Recipe', name: 'I graf' }] },
  ])}</script>`);
  assert.equal(nested?.['name'], 'Inuti sida');
  assert.equal(extractJsonLdRecipe('<h1>Recept utan JSON-LD</h1>'), null);
  assert.equal(extractJsonLdRecipe('<script data-type="application/ld+json">{"@type":"Recipe","name":"Ignorera"}</script>'), null);
});

test('iterative JSON-LD traversal safely stops at the node budget', () => {
  // Build raw JSON directly: JSON.stringify itself is recursive for extremely deep objects.
  const serialized = `${'{"child":'.repeat(25_000)}null${'}'.repeat(25_000)}`;
  assert.equal(extractJsonLdRecipe(`<script type="application/ld+json">${serialized}</script>`), null);
});

test('pins outbound request to resolved public IP and returns HTML only', async () => {
  let selectedAddress = '';
  const result = await fetchRecipeHtml('https://example.org/r', transport({
    resolve: async host => { assert.equal(host, 'example.org'); return ['93.184.216.34']; },
    request: async (_url, address) => { selectedAddress = address; return html(); },
  }));
  assert.equal(selectedAddress, '93.184.216.34');
  assert.equal(result.finalUrl, 'https://example.org/r');
  assert.match(result.html, /@type/);
});

test('revalidates each redirect target before making another request', async () => {
  let requests = 0;
  await assert.rejects(fetchRecipeHtml('https://example.org/r', transport({
    request: async () => {
      requests++;
      return { status: 302, headers: new Headers({ location: 'http://127.0.0.1/admin' }), body: new Uint8Array() };
    },
  })), (error: unknown) => error instanceof RecipeUrlError && error.code === 'blocked-host');
  assert.equal(requests, 1);
});

test('rejects mixed public/private DNS, too many redirects, non-HTML and oversized bodies', async () => {
  await assert.rejects(fetchRecipeHtml('https://example.org/r', transport({ resolve: async () => ['93.184.216.34', '10.0.0.4'] })), /blocked-host/);
  let redirectCount = 0;
  await assert.rejects(fetchRecipeHtml('https://example.org/r', transport({ request: async () => {
    redirectCount++;
    return { status: 302, headers: new Headers({ location: '/again' }), body: new Uint8Array() };
  } })), /fetch-failed/);
  assert.equal(redirectCount, 4);
  await assert.rejects(fetchRecipeHtml('https://example.org/r', transport({ request: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/pdf' }), body: new Uint8Array() }) })), /not-html/);
  await assert.rejects(fetchRecipeHtml('https://example.org/r', transport({ request: async () => ({ ...html(), body: new Uint8Array(MAX_HTML_BYTES + 1) }) })), /too-large/);
});

test('enforces short timeout for transport operations', async () => {
  const shortTimeout: RecipeUrlTransport = {
    resolve: async (_host, signal) => await new Promise<string[]>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    request: async () => html(),
  };
  await assert.rejects(fetchRecipeHtml('https://example.org/r', shortTimeout, 10), /fetch-failed/);
}, { timeout: 10_000 });
