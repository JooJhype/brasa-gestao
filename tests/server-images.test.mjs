import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.mjs';

const originalFetch = globalThis.fetch;

test('HTTP: busca de imagens traduz só a consulta, aceita inglês manual e rejeita termos ambíguos', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'brasa-image-integration-'));
  const calls = [];
  let server;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    calls.push({ url, signal: options?.signal });
    if (url.hostname === 'commons.wikimedia.org') {
      return new Response(JSON.stringify({ query: { pages: {
        1: {
          title: 'File:Mozzarella food.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/test/Mozzarella.jpg',
            thumburl: 'https://upload.wikimedia.org/test/360px-Mozzarella.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Mozzarella_food.jpg',
            extmetadata: {
              Artist: { value: 'Test author' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
            },
          }],
        },
      } } }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.hostname === 'www.wikidata.org') {
      return new Response(JSON.stringify({ search: [{
        display: {
          label: { value: 'Unrelated municipality', language: 'en' },
          description: { value: 'municipality and city in Brazil', language: 'en' },
        },
        match: { text: url.searchParams.get('search'), language: 'pt', type: 'label' },
      }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected external request: ${url.href}`);
  };
  t.after(async () => {
    try { await server?.close(); }
    finally {
      globalThis.fetch = originalFetch;
      const resolved = path.resolve(dataDir);
      assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
      assert.ok(path.basename(resolved).startsWith('brasa-image-integration-'));
      rmSync(resolved, { recursive: true, force: true });
    }
  });

  server = await startServer({ port: 0, dataDir });
  const request = async route => {
    const response = await originalFetch(`${server.url}/api/${route}`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await request('state');
  const ingredientName = 'Queijo muçarela';
  const createdResponse = await originalFetch(`${server.url}/api/ingredients/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Brasa-Token': initial.csrf },
    body: JSON.stringify({ name: ingredientName, unit: 'kg', quantity: 1, totalCost: 30 }),
  });
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()).result;
  const before = (await request('state')).state;

  await t.test('muçarela é enviada ao Commons em inglês e o cadastro permanece intacto', async () => {
    const result = await request(`images?${new URLSearchParams({ q: ingredientName })}`);
    assert.equal(result.originalQuery, ingredientName);
    assert.equal(result.query, 'mozzarella cheese');
    assert.equal(result.source, 'dictionary');
    assert.equal(result.translated, true);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].license, 'CC BY-SA 4.0');
    assert.equal(result.images[0].author, 'Test author');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.hostname, 'commons.wikimedia.org');
    assert.equal(calls[0].url.searchParams.get('gsrsearch'), 'mozzarella cheese');
    assert.ok(calls[0].signal);
    const after = (await request('state')).state;
    assert.deepEqual(after, before);
    assert.equal(after.ingredients.find(item => item.id === created.id).name, ingredientName);
  });

  await t.test('termo manual é encaminhado literalmente, sem tradução ou consulta Wikidata', async () => {
    const english = 'sliced mozzarella "food"';
    const count = calls.length;
    const result = await request(`images?${new URLSearchParams({ q: ingredientName, english })}`);
    assert.equal(result.originalQuery, ingredientName);
    assert.equal(result.query, english);
    assert.equal(result.source, 'manual');
    assert.equal(result.translated, false);
    assert.equal(result.images.length, 1);
    assert.equal(calls.length, count + 1);
    assert.equal(calls.at(-1).url.hostname, 'commons.wikimedia.org');
    assert.equal(calls.at(-1).url.searchParams.get('gsrsearch'), english);
    assert.deepEqual((await request('state')).state, before);
  });

  await t.test('resultado não alimentar retorna aviso e nenhuma busca no Commons', async () => {
    const q = 'Ingrediente especial desconhecido';
    const count = calls.length;
    const result = await request(`images?${new URLSearchParams({ q })}`);
    assert.equal(result.originalQuery, q);
    assert.equal(result.query, q);
    assert.equal(result.source, 'original');
    assert.equal(result.translated, false);
    assert.match(result.warning, /inglês/);
    assert.deepEqual(result.images, []);
    assert.equal(calls.length, count + 1);
    assert.equal(calls.at(-1).url.hostname, 'www.wikidata.org');
    assert.equal(calls.at(-1).url.searchParams.get('search'), q);
    assert.deepEqual((await request('state')).state, before);
  });
});
