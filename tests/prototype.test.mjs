import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.mjs';

async function withPrototype(run) {
  const tempRoot = path.resolve(tmpdir());
  const dataDir = mkdtempSync(path.join(tempRoot, 'brasa-prototype-test-'));
  let instance = await startServer({ port: 0, dataDir });
  const fixture = {
    dataDir,
    async get(route = 'state') {
      const response = await fetch(
        instance.url + (route.startsWith('/') ? route : '/api/' + route),
      );
      return { status: response.status, body: await response.json() };
    },
    async post(route, data = {}, token) {
      // Starting/stopping a demonstration rotates CSRF. Read the current mode
      // before each mutation unless the test deliberately sends an old token.
      const currentToken = token ?? (await fixture.get()).body.csrf;
      const response = await fetch(instance.url + '/api/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Brasa-Token': currentToken },
        body: JSON.stringify(data),
      });
      return { status: response.status, body: await response.json() };
    },
    async reopen() {
      await instance.close();
      instance = await startServer({ port: 0, dataDir });
    },
  };
  try {
    await run(fixture);
  } finally {
    await instance.close();
    const relative = path.relative(tempRoot, path.resolve(dataDir));
    assert.ok(
      relative.startsWith('brasa-prototype-test-') && !relative.includes(path.sep),
      'A limpeza deve se limitar à pasta temporária criada por este teste.',
    );
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function seedNormalBase(fixture) {
  const ingredientResponse = await fixture.post('ingredients/create', {
    name: 'Ingrediente fictício da base normal',
    unit: 'un',
    quantity: 10,
    totalCost: 20,
    minStock: 0,
  });
  assert.equal(ingredientResponse.status, 200);
  const ingredient = ingredientResponse.body.result;
  const productResponse = await fixture.post('products', {
    name: 'Produto fictício da base normal',
    price: 12,
    extraCost: 0,
    recipe: [{ ingredientId: ingredient.id, quantity: 1, unit: 'un' }],
  });
  assert.equal(productResponse.status, 200);
  const product = productResponse.body.result;
  const state = (await fixture.get()).body.state;
  const orderResponse = await fixture.post('orders', {
    source: 'manual',
    platformId: state.platforms[0].id,
    fulfillment: 'takeout',
    customer: { name: 'Cliente fictício' },
    lines: [{ productId: product.id, quantity: 1, unitPrice: 12 }],
  });
  assert.equal(orderResponse.status, 200);
  return { ingredient, product, order: orderResponse.body.result };
}

test('Versão final: não oferece conexões, flags de desenvolvimento, reset ou guia de abertura', async () => {
  await withPrototype(async (fixture) => {
    const initial = await fixture.get();
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.features, { demonstration: false });
    assert.equal(initial.body.connections, undefined);

    for (const route of [
      'connections',
      'connections/save',
      'connections/sync',
      'connections/ifood/authorize',
    ]) {
      assert.equal((await fixture.get(route)).status, 404, route);
      assert.equal((await fixture.post(route, {})).status, 404, route);
    }
    assert.equal((await fixture.post('dev/reset', { confirmation: 'resetar' })).status, 404);
    assert.equal((await fixture.post('dev/reset', { confirmation: 'resetar' }, '')).status, 403);
    assert.equal((await fixture.post('demo')).status, 404);
    assert.equal((await fixture.get('/guide.json')).status, 404);
    assert.deepEqual((await fixture.get()).body.state, initial.body.state);
    assert.equal(existsSync(path.join(fixture.dataDir, 'connections.json')), false);
  });
});

test('Protótipo: canais de taxa são manuais e pedidos externos são recusados sem modificar a base', async () => {
  await withPrototype(async (fixture) => {
    const { product } = await seedNormalBase(fixture);
    const before = (await fixture.get()).body.state;
    const baseOrder = {
      platformId: before.platforms[0].id,
      fulfillment: 'takeout',
      customer: { name: 'Cliente fictício' },
      lines: [{ productId: product.id, quantity: 1, unitPrice: 12 }],
    };
    for (const source of ['site', 'ifood', '99food']) {
      const rejected = await fixture.post('orders', {
        ...baseOrder,
        source,
        externalId: 'pedido-ficticio-' + source,
      });
      assert.equal(rejected.status, 400, source);
      assert.match(rejected.body.error, /manual|protótipo/i);
      assert.deepEqual((await fixture.get()).body.state, before);
    }
    const manual = await fixture.post('orders', {
      ...baseOrder,
      source: 'manual',
      platformId: before.platforms.at(-1).id,
    });
    assert.equal(manual.status, 200);
    assert.equal(manual.body.result.source, 'manual');
    assert.equal(manual.body.result.platformId, before.platforms.at(-1).id);
  });
});

test('Protótipo: restauração JSON rejeita pedidos de integração e preserva os registros existentes', async () => {
  await withPrototype(async (fixture) => {
    await seedNormalBase(fixture);
    const before = (await fixture.get()).body.state;
    const exported = (await fixture.get('export')).body;
    for (const source of ['site', 'ifood', '99food']) {
      const invalid = structuredClone(exported);
      invalid.state.orders[0].source = source;
      invalid.state.orders[0].externalId = 'origem-ficticia-' + source;
      const response = await fixture.post('restore', invalid);
      assert.equal(response.status, 400, source);
      assert.match(response.body.error, /manual|protótipo/i);
      assert.deepEqual((await fixture.get()).body.state, before);
    }
  });
});

test('Protótipo: demonstração, pedidos e exportação ficam isolados da base normal', async () => {
  await withPrototype(async (fixture) => {
    await seedNormalBase(fixture);
    const normal = (await fixture.get()).body;
    const normalExport = (await fixture.get('export')).body;

    assert.equal((await fixture.post('demo/start')).status, 200);
    const demo = (await fixture.get()).body;
    assert.equal(demo.features.demonstration, true);
    assert.notEqual(demo.csrf, normal.csrf);
    assert.ok(demo.state.ingredients.length > 0);
    assert.ok(demo.state.products.length > 0);
    assert.ok(!demo.state.ingredients.some((row) => row.id === normal.state.ingredients[0].id));

    // A form opened in the normal mode must not mutate the demonstration.
    const staleNormal = await fixture.post(
      'ingredients/create',
      {
        name: 'Cadastro fictício de formulário antigo',
        unit: 'un',
        quantity: 1,
        totalCost: 1,
      },
      normal.csrf,
    );
    assert.equal(staleNormal.status, 403);

    const demoIngredient = await fixture.post('ingredients/create', {
      name: 'Ingrediente fictício exclusivo da demonstração',
      unit: 'un',
      quantity: 5,
      totalCost: 5,
      minStock: 0,
    });
    assert.equal(demoIngredient.status, 200);
    const demoProduct = demo.state.products[0];
    const orderResponse = await fixture.post('orders', {
      source: 'manual',
      platformId: demo.state.platforms[0].id,
      fulfillment: 'takeout',
      customer: { name: 'Cliente fictício da demonstração' },
      lines: [{ productId: demoProduct.id, quantity: 1, unitPrice: demoProduct.price }],
    });
    assert.equal(orderResponse.status, 200);
    for (const status of ['preparing', 'ready', 'completed']) {
      assert.equal(
        (await fixture.post('orders/transition', { id: orderResponse.body.result.id, status }))
          .status,
        200,
      );
    }

    const demoCurrent = (await fixture.get()).body;
    const demoExport = await fixture.get('export');
    assert.equal(demoExport.status, 200);
    assert.deepEqual(demoExport.body.state, demoCurrent.state);
    assert.ok(
      demoExport.body.state.ingredients.some((row) => row.id === demoIngredient.body.result.id),
    );
    assert.equal(
      demoExport.body.state.orders.find((row) => row.id === orderResponse.body.result.id).status,
      'completed',
    );

    assert.equal((await fixture.post('demo/stop')).status, 200);
    const restoredNormal = (await fixture.get()).body;
    assert.equal(restoredNormal.features.demonstration, false);
    assert.notEqual(restoredNormal.csrf, demoCurrent.csrf);
    assert.deepEqual(restoredNormal.state, normal.state);
    assert.deepEqual((await fixture.get('export')).body.state, normalExport.state);

    // A form from the demonstration must not accidentally save into normal data.
    assert.equal(
      (
        await fixture.post(
          'ingredients/create',
          {
            name: 'Cadastro fictício depois da demonstração',
            unit: 'un',
            quantity: 1,
            totalCost: 1,
          },
          demoCurrent.csrf,
        )
      ).status,
      403,
    );
    assert.deepEqual((await fixture.get()).body.state, normal.state);
  });
});

test('Protótipo: restaurar na demonstração afeta apenas ela e fechar descarta a sessão', async () => {
  await withPrototype(async (fixture) => {
    await seedNormalBase(fixture);
    const normal = (await fixture.get()).body.state;
    assert.equal((await fixture.post('demo/start')).status, 200);
    const demoBackup = (await fixture.get('export')).body;
    const demoIngredientId = demoBackup.state.ingredients[0].id;
    assert.equal(
      (
        await fixture.post('ingredients/create', {
          name: 'Ingrediente fictício descartável',
          unit: 'un',
          quantity: 2,
          totalCost: 2,
        })
      ).status,
      200,
    );
    assert.equal((await fixture.post('restore', demoBackup)).status, 200);
    const afterRestore = (await fixture.get()).body;
    assert.equal(afterRestore.features.demonstration, true);
    assert.ok(afterRestore.state.ingredients.some((row) => row.id === demoIngredientId));
    assert.ok(
      !afterRestore.state.ingredients.some(
        (row) => row.name === 'Ingrediente fictício descartável',
      ),
    );

    await fixture.reopen();
    const reopened = (await fixture.get()).body;
    assert.deepEqual(reopened.features, { demonstration: false });
    assert.deepEqual(reopened.state, normal);
  });
});
