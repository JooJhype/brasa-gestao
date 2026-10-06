import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageQuery, resolveImageQuery } from '../src/image-search.mjs';

const noNetwork = async () => { throw new Error('Common ingredients must not require a network request'); };
const wikidataResult = (label, description, text, language = 'en') => ({
  display: { label: { value: label, language }, description: { value: description, language: 'en' } },
  match: { text, language: 'pt', type: 'label' },
});

test('ingredientes comuns são pesquisados em inglês e mantêm o nome original', async () => {
  const cases = [
    ['Queijo muçarela 1 kg', 'mozzarella cheese'],
    ['Mussarela fatiada 500g', 'mozzarella cheese'],
    ['mozarela', 'mozzarella cheese'],
    ['Queijo muçarela de búfala', 'buffalo mozzarella cheese'],
    ['Queijo prato', 'Prato cheese'],
    ['Queijo cheddar', 'cheddar cheese'],
    ['Pão de hambúrguer brioche', 'brioche hamburger buns'],
    ['Pão de hambúrguer 12 unidades', 'hamburger buns'],
    ['Carne bovina moída', 'ground beef'],
    ['Alface americana', 'iceberg lettuce'],
    ['Cebola roxa 1kg', 'red onion'],
    ['Óleo de soja 900ml', 'soybean oil'],
    ['Sal refinado', 'salt'],
    ['Batata palha', 'straw potatoes'],
    ['Batata frita congelada', 'French fries'],
    ['Maionese caseira', 'mayonnaise'],
    ['Embalagem para hambúrguer', 'hamburger takeaway box'],
  ];
  for (const [name, query] of cases) {
    const result = await resolveImageQuery(name, { fetchImpl: noNetwork });
    assert.equal(result.query, query, name);
    assert.equal(result.originalQuery, name, 'Ingredient name must remain intact');
    assert.equal(result.source, 'dictionary');
    assert.equal(result.translated, true);
  }
});

test('inglês conhecido é preservado e palavras parciais não acionam tradução incorreta', async () => {
  const result = await resolveImageQuery('mozzarella cheese', { fetchImpl: noNetwork });
  assert.equal(result.query, 'mozzarella cheese');
  assert.equal(result.translated, false);
  const noPartial = await resolveImageQuery('salmão', { fetchImpl: async () => ({ ok: true, json: async () => ({ search: [] }) }) });
  assert.equal(noPartial.query, 'salmão'); // must not match "sal"
});

test('preparações compostas preservam o tipo de alimento e a proteína na tradução', async () => {
  const cases = [
    ['Carne moída de frango', 'ground chicken'],
    ['Carne moída suína', 'ground pork'],
    ['Carne de porco moída', 'ground pork'],
    ['Carne moída resfriada de frango', 'ground chicken'],
    ['Carne moída de soja', 'plant-based ground meat'],
    ['Carne vegetal', 'plant-based meat'],
    ['Pão de queijo', 'Brazilian cheese bread'],
    ['Molho de alho', 'garlic sauce'],
    ['Molho de pimenta', 'hot sauce'],
    ['Molho de pimenta chipotle', 'chipotle sauce'],
    ['Molho chipotle', 'chipotle sauce'],
    ['Pimenta chipotle', 'chipotle pepper'],
    ['Molho de queijo cheddar', 'cheese sauce'],
    ['Carne suína / pernil', 'pork leg'],
    ['Pernil suíno', 'pork leg'],
    ['Hambúrguer de frango', 'chicken burger patties'],
    ['Hambúrguer de frango resfriado', 'chicken burger patties'],
    ['Hambúrguer de carne suína', 'pork burger patties'],
    ['Hambúrguer vegetal', 'vegetarian burger patties'],
    ['Hambúrguer de grão-de-bico', 'vegetarian burger patties'],
  ];
  for (const [name, query] of cases) {
    const result = await resolveImageQuery(name, { fetchImpl: noNetwork });
    assert.equal(result.query, query, name);
    assert.equal(result.originalQuery, name);
    assert.equal(result.source, 'dictionary');
  }
});

test('preparação desconhecida não é substituída por ingrediente parcial conhecido', async () => {
  for (const name of ['Molho especial com alho', 'Molho caseiro de queijo muçarela', 'Hambúrguer de cogumelo com cebola', 'Carne moída bovina e suína', 'Carne de pato']) {
    const result = await resolveImageQuery(name, { fetchImpl: async () => ({ ok: true, json: async () => ({ search: [] }) }) });
    assert.equal(result.source, 'original', name);
    assert.equal(result.query, name);
  }
});

test('Wikidata traduz apenas correspondência alimentar com rótulo explicitamente em inglês', async () => {
  let request;
  const result = await resolveImageQuery('Jiló', { fetchImpl: async (url, options) => {
    request = { url: new URL(url), options };
    return { ok: true, json: async () => ({ search: [
      wikidataResult('Jilo', 'musical band', 'Jiló'),
      wikidataResult('Scarlet eggplant', 'edible vegetable used in Brazilian cuisine', 'Jiló'),
    ] }) };
  } });
  assert.equal(request.url.searchParams.get('language'), 'pt');
  assert.equal(request.url.searchParams.get('uselang'), 'en');
  assert.equal(request.url.searchParams.get('search'), 'Jiló');
  assert.ok(request.options.signal);
  assert.equal(result.query, 'Scarlet eggplant');
  assert.equal(result.originalQuery, 'Jiló');
  assert.equal(result.source, 'wikidata');
});

test('Wikidata rejeita fallback português, resultados parecidos e entidades sem contexto alimentar', async () => {
  for (const candidate of [
    wikidataResult('Jiló', 'edible vegetable', 'Jiló', 'pt'),
    wikidataResult('Scarlet eggplant', 'edible vegetable', 'Jiló roxo'),
    wikidataResult('Jilo', 'village in Brazil', 'Jiló'),
    wikidataResult('Solanum aethiopicum', 'species of plant', 'Jiló'),
    wikidataResult('Jilo', 'food brand company', 'Jiló'),
  ]) {
    const result = await resolveImageQuery('Jiló', { fetchImpl: async () => ({ ok: true, json: async () => ({ search: [candidate] }) }) });
    assert.equal(result.source, 'original');
    assert.equal(result.query, 'Jiló');
    assert.match(result.warning, /inglês/);
  }
});

test('falhas externas, respostas inválidas e interrupção mantêm o registro local disponível', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ search: { bad: true } }) }),
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
  ]) {
    const result = await resolveImageQuery('Ingrediente especial', { fetchImpl });
    assert.equal(result.query, 'Ingrediente especial');
    assert.equal(result.translated, false);
  }
  const result = await resolveImageQuery('Ingrediente especial', { fetchImpl: noNetwork, signal: AbortSignal.abort() });
  assert.equal(result.source, 'original');
});

test('timeout de tradução é limitado e volta à busca original', async () => {
  const result = await resolveImageQuery('Ingrediente especial', { timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
    // Keep a referenced timer only in this fake request so Node's test runner
    // can observe AbortSignal.timeout (whose internal timer is unreferenced).
    const pending = setTimeout(() => resolve({ ok: false }), 200);
    signal.addEventListener('abort', () => { clearTimeout(pending); reject(signal.reason); }, { once: true });
  }) });
  assert.equal(result.source, 'original');
  assert.match(result.warning, /traduzir/);
});

test('normalização elimina quantidades, limita consultas e trata entrada vazia', async () => {
  assert.equal(normalizeImageQuery('  Óleo de soja - 0,9 L  '), 'oleo de soja');
  assert.equal(normalizeImageQuery('Muçarela 500g'), 'mucarela');
  assert.deepEqual(await resolveImageQuery('', { fetchImpl: noNetwork }), { originalQuery: '', query: '', translated: false, source: 'original' });
  const long = await resolveImageQuery('x'.repeat(200), { fetchImpl: async () => ({ ok: false }) });
  assert.equal(long.query.length, 90);
  assert.equal(long.originalQuery.length, 90);
});
