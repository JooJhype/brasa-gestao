import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { startServer } from '../src/server.mjs';

const DATE = '2026-10-06';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xQAAAAASUVORK5CYII=';

function memoryStore(t) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  return store;
}

function item(store, name = 'Ingrediente errado') {
  return store.createIngredient({
    name,
    unit: 'kg',
    quantity: 2,
    totalCost: 80,
    minStock: 0.2,
    date: DATE,
  });
}

function product(store, ingredient) {
  return store.saveProduct({
    name: 'Produto teste',
    price: 20,
    extraCost: 1,
    recipe: [{ ingredientId: ingredient.id, quantity: 50, unit: 'g' }],
  });
}

async function httpFixture(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'brasa-maintenance-test-'));
  const server = await startServer({ port: 0, dataDir });
  t.after(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const getState = async () => (await fetch(server.url + '/api/state')).json();
  const initial = await getState();
  const post = async (route, data, { token = initial.csrf } = {}) => {
    const response = await fetch(server.url + '/api/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Brasa-Token': token },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };
  const backups = (prefix) =>
    readdirSync(path.join(dataDir, 'backups'))
      .filter((name) => name.startsWith(prefix))
      .map((name) => JSON.parse(readFileSync(path.join(dataDir, 'backups', name), 'utf8')));
  return { dataDir, initial, getState, post, backups };
}

test('exclusão: ingrediente sem uso remove compras e movimentos apenas dele; backup resultante continua válido', (t) => {
  const store = memoryStore(t);
  const wrong = item(store);
  store.addPurchase({
    ingredientId: wrong.id,
    unit: 'g',
    quantity: 200,
    totalCost: 20,
    date: DATE,
  });
  const retained = item(store, 'Carne válida');
  const burger = product(store, retained);
  store.addSale({
    date: DATE,
    platformId: store.state().platforms[0].id,
    lines: [{ productId: burger.id, quantity: 2 }],
  });
  store.addExpense({ date: DATE, description: 'Gás', amount: 30 });
  const before = store.state();
  let backupState;
  const removed = store.deleteIngredient(wrong.id, { confirmation: ' DELETAR ' }, () => {
    backupState = store.state();
  });
  assert.equal(removed.removedPurchases, 2);
  assert.equal(removed.removedMovements, 2);
  assert.deepEqual(backupState, before);
  const expected = structuredClone(before);
  for (const key of ['ingredients', 'purchases', 'movements'])
    expected[key] = expected[key].filter(
      (row) => (key === 'ingredients' ? row.id : row.ingredientId) !== wrong.id,
    );
  assert.deepEqual(store.state(), expected);
  store.restoreData(store.exportData());
  assert.deepEqual(store.state(), expected);
});

test('exclusão: palavra obrigatória e ingrediente desconhecido deixam o estado intacto', (t) => {
  const store = memoryStore(t);
  const wrong = item(store);
  const before = store.state();
  for (const confirmation of [undefined, '', 'sim', true, 'deletarr']) {
    assert.throws(() => store.deleteIngredient(wrong.id, { confirmation }), {
      code: 'CONFIRMATION_REQUIRED',
    });
    assert.deepEqual(store.state(), before);
  }
  assert.throws(() => store.deleteIngredient('ausente', { confirmation: 'deletar' }), {
    code: 'NOT_FOUND',
  });
  assert.deepEqual(store.state(), before);
});

test('exclusão: ficha técnica informa o produto e impede apagar dependências', (t) => {
  const store = memoryStore(t);
  const ingredient = item(store);
  product(store, ingredient);
  const before = store.state();
  assert.throws(
    () => store.deleteIngredient(ingredient.id, { confirmation: 'deletar' }),
    (error) => error.code === 'INGREDIENT_IN_USE' && /Produto teste/.test(error.message),
  );
  assert.deepEqual(store.state(), before);
});

test('exclusão: venda histórica, mesmo cancelada e com receita alterada, permanece protegida', (t) => {
  const store = memoryStore(t);
  const original = item(store);
  const replacement = item(store, 'Substituto');
  const burger = product(store, original);
  const sale = store.addSale({
    date: DATE,
    platformId: store.state().platforms[0].id,
    lines: [{ productId: burger.id, quantity: 1 }],
  });
  store.cancelSale(sale.id, { restock: true, date: DATE });
  store.saveProduct(
    { recipe: [{ ingredientId: replacement.id, quantity: 50, unit: 'g' }] },
    burger.id,
  );
  const before = store.state();
  assert.throws(() => store.deleteIngredient(original.id, { confirmation: 'deletar' }), {
    code: 'INGREDIENT_HAS_HISTORY',
  });
  assert.deepEqual(store.state(), before);
});

test('exclusão: perdas e ajustes bloqueiam remoção do histórico financeiro', (t) => {
  const store = memoryStore(t);
  for (const kind of ['loss', 'gain', 'set']) {
    const ingredient = item(store, 'Item ' + kind);
    store.addAdjustment({
      ingredientId: ingredient.id,
      kind,
      quantity: 100,
      unit: 'g',
      date: DATE,
      reason: 'Ajuste real',
      unitCost: 0.1,
    });
    const before = store.state();
    assert.throws(() => store.deleteIngredient(ingredient.id, { confirmation: 'deletar' }), {
      code: 'INGREDIENT_HAS_HISTORY',
    });
    assert.deepEqual(store.state(), before);
  }
});

test('exclusão: falha do backup impede a transação de apagar o ingrediente', (t) => {
  const store = memoryStore(t);
  const ingredient = item(store);
  const before = store.state();
  assert.throws(
    () =>
      store.deleteIngredient(ingredient.id, { confirmation: 'deletar' }, () => {
        throw new Error('Sem espaço');
      }),
    /Sem espaço/,
  );
  assert.deepEqual(store.state(), before);
});

test('HTTP: exclusão exige confirmação e backup com imagem permite restaurar o ingrediente', async (t) => {
  const { dataDir, getState, post, backups } = await httpFixture(t);
  const image = (await post('upload', { dataUrl: PNG })).body;
  const ingredient = (
    await post('ingredients/create', {
      name: 'Errado',
      unit: 'kg',
      quantity: 2,
      totalCost: 80,
      date: DATE,
      image,
    })
  ).body.result;
  const before = (await getState()).state;
  assert.equal(
    (await post('ingredients/delete', { id: ingredient.id, confirmation: 'sim' })).status,
    400,
  );
  assert.equal(
    (
      await post(
        'ingredients/delete',
        { id: ingredient.id, confirmation: 'deletar' },
        { token: '' },
      )
    ).status,
    403,
  );
  assert.equal(backups('antes-exclusao-').length, 0);
  assert.deepEqual((await getState()).state, before);
  assert.equal(
    (await post('ingredients/delete', { id: ingredient.id, confirmation: 'deletar' })).status,
    200,
  );
  assert.equal((await getState()).state.ingredients.length, 0);
  const deletionBackup = backups('antes-exclusao-')[0];
  assert.equal(deletionBackup.state.ingredients[0].id, ingredient.id);
  assert.equal(deletionBackup.state.ingredients[0].image.url, PNG);
  assert.deepEqual(deletionBackup.state.purchases, before.purchases);
  assert.equal((await post('restore', deletionBackup)).status, 200);
  assert.deepEqual((await getState()).state, deletionBackup.state);
  assert.ok(readdirSync(path.join(dataDir, 'uploads')).length > 0);
});

test('HTTP: rota de reset inexistente preserva os registros e não cria backup', async (t) => {
  const { getState, post, backups } = await httpFixture(t);
  assert.deepEqual((await getState()).features, { demonstration: false });
  const ingredient = (
    await post('ingredients/create', { name: 'Mantido', unit: 'un', quantity: 2, totalCost: 10 })
  ).body.result;
  const before = (await getState()).state;
  assert.equal((await post('dev/reset', { confirmation: 'resetar' })).status, 404);
  assert.equal((await post('dev/reset', { confirmation: 'resetar' }, { token: '' })).status, 403);
  assert.deepEqual((await getState()).state, before);
  assert.equal(backups('antes-reset-').length, 0);
  assert.equal(before.ingredients[0].id, ingredient.id);
});

test('HTTP: falha real de escrita do backup recusa exclusões sem alterar dados', async (t) => {
  const { dataDir, getState, post } = await httpFixture(t);
  const ingredient = (
    await post('ingredients/create', { name: 'Mantido', unit: 'un', quantity: 2, totalCost: 10 })
  ).body.result;
  const burger = (
    await post('products', {
      name: 'Ficha mantida',
      price: 20,
      recipe: [{ ingredientId: ingredient.id, quantity: 1, unit: 'un' }],
    })
  ).body.result;
  const unusedIngredient = (
    await post('ingredients/create', {
      name: 'Mantido sem ficha',
      unit: 'un',
      quantity: 2,
      totalCost: 10,
    })
  ).body.result;
  const before = (await getState()).state;
  renameSync(path.join(dataDir, 'backups'), path.join(dataDir, 'backups-preservados'));
  writeFileSync(path.join(dataDir, 'backups'), 'Simula pasta de backups indisponível');
  for (const [route, payload] of [
    ['ingredients/delete', { id: unusedIngredient.id, confirmation: 'deletar' }],
    ['products/delete', { id: burger.id, confirmation: 'deletar' }],
  ]) {
    const response = await post(route, payload);
    assert.equal(response.status, 500);
    assert.match(response.body.error, /backup de segurança.*Nenhum dado foi alterado/);
    assert.deepEqual((await getState()).state, before);
  }
});

test('ficha técnica: exclusão sem uso altera somente produtos e libera ingrediente para exclusão', (t) => {
  const store = memoryStore(t);
  const ingredient = item(store);
  const unused = product(store, ingredient);
  const retainedIngredient = item(store, 'Ingrediente válido');
  const retained = store.saveProduct({
    name: 'Produto válido',
    price: 30,
    extraCost: 2,
    recipe: [{ ingredientId: retainedIngredient.id, quantity: 100, unit: 'g' }],
  });
  store.addSale({
    date: DATE,
    platformId: store.state().platforms[0].id,
    lines: [{ productId: retained.id, quantity: 1 }],
  });
  store.addExpense({ date: DATE, description: 'Gás', amount: 20 });
  const before = store.state();
  let savedBefore;
  const removed = store.deleteProduct(unused.id, { confirmation: ' DELETAR ' }, () => {
    savedBefore = store.state();
  });
  assert.deepEqual(removed, unused);
  assert.deepEqual(savedBefore, before);
  const expected = structuredClone(before);
  expected.products = expected.products.filter((row) => row.id !== unused.id);
  assert.deepEqual(store.state(), expected);
  store.restoreData(store.exportData());
  assert.deepEqual(store.state(), expected);
  assert.equal(
    store.deleteIngredient(ingredient.id, { confirmation: 'deletar' }).id,
    ingredient.id,
  );
  assert.deepEqual(store.state().sales, before.sales);
});

test('ficha técnica: confirmação ausente/incorreta e identificador desconhecido preservam estado', (t) => {
  const store = memoryStore(t);
  const burger = product(store, item(store));
  const before = store.state();
  for (const confirmation of [undefined, '', 'sim', 'deletarr', true]) {
    assert.throws(() => store.deleteProduct(burger.id, { confirmation }), {
      code: 'CONFIRMATION_REQUIRED',
    });
    assert.deepEqual(store.state(), before);
  }
  assert.throws(() => store.deleteProduct('ausente', { confirmation: 'deletar' }), {
    code: 'NOT_FOUND',
  });
  assert.deepEqual(store.state(), before);
});

test('ficha técnica: vendas ativas ou canceladas bloqueiam exclusão mesmo depois de editar a receita', (t) => {
  for (const canceled of [false, true]) {
    const store = memoryStore(t);
    const burger = product(store, item(store));
    const sale = store.addSale({
      date: DATE,
      platformId: store.state().platforms[0].id,
      lines: [{ productId: burger.id, quantity: 1 }],
    });
    if (canceled) store.cancelSale(sale.id, { restock: false, date: DATE });
    const replacement = item(store, 'Ingrediente novo');
    store.saveProduct(
      {
        name: 'Ficha corrigida',
        recipe: [{ ingredientId: replacement.id, quantity: 60, unit: 'g' }],
      },
      burger.id,
    );
    const before = store.state();
    assert.throws(
      () => store.deleteProduct(burger.id, { confirmation: 'deletar' }),
      (error) => error.code === 'PRODUCT_HAS_HISTORY' && /inclusive canceladas/.test(error.message),
    );
    assert.deepEqual(store.state(), before);
  }
});

test('ficha técnica: falha no backup impede a exclusão por transação', (t) => {
  const store = memoryStore(t);
  const burger = product(store, item(store));
  const before = store.state();
  assert.throws(
    () =>
      store.deleteProduct(burger.id, { confirmation: 'deletar' }, () => {
        throw new Error('Backup falhou');
      }),
    /Backup falhou/,
  );
  assert.deepEqual(store.state(), before);
});

test('HTTP: excluir ficha exige palavra e CSRF; backup completo permite restaurar sem mudar estoque', async (t) => {
  const { getState, post, backups } = await httpFixture(t);
  const image = (await post('upload', { dataUrl: PNG })).body;
  const ingredient = (
    await post('ingredients/create', {
      name: 'Carne',
      unit: 'kg',
      quantity: 2,
      totalCost: 80,
      date: DATE,
      image,
    })
  ).body.result;
  const burger = (
    await post('products', {
      name: 'Ficha sem uso',
      price: 25,
      extraCost: 1,
      recipe: [{ ingredientId: ingredient.id, quantity: 50, unit: 'g' }],
    })
  ).body.result;
  const before = (await getState()).state;
  assert.equal((await post('products/delete', { id: burger.id, confirmation: 'sim' })).status, 400);
  assert.equal(
    (await post('products/delete', { id: 'ausente', confirmation: 'deletar' })).status,
    404,
  );
  assert.equal(
    (await post('products/delete', { id: burger.id, confirmation: 'deletar' }, { token: '' }))
      .status,
    403,
  );
  assert.equal(backups('antes-exclusao-').length, 0);
  assert.deepEqual((await getState()).state, before);
  assert.equal(
    (await post('products/delete', { id: burger.id, confirmation: ' DELETAR ' })).status,
    200,
  );
  const expected = structuredClone(before);
  expected.products = [];
  assert.deepEqual((await getState()).state, expected);
  const deletionBackup = backups('antes-exclusao-')[0];
  const expectedBackup = structuredClone(before);
  expectedBackup.ingredients[0].image.url = PNG;
  assert.deepEqual(deletionBackup.state, expectedBackup);
  assert.equal((await post('restore', deletionBackup)).status, 200);
  assert.deepEqual((await getState()).state, deletionBackup.state);
  const sale = (
    await post('sales', {
      date: DATE,
      platformId: before.platforms[0].id,
      lines: [{ productId: burger.id, quantity: 1 }],
    })
  ).body.result;
  const activeState = (await getState()).state;
  assert.equal(
    (await post('products/delete', { id: burger.id, confirmation: 'deletar' })).status,
    409,
  );
  assert.deepEqual((await getState()).state, activeState);
  assert.equal(
    (await post('sales/cancel', { id: sale.id, restock: true, date: DATE })).status,
    200,
  );
  const canceledState = (await getState()).state;
  assert.equal(
    (await post('products/delete', { id: burger.id, confirmation: 'deletar' })).status,
    409,
  );
  assert.deepEqual((await getState()).state, canceledState);
  assert.equal(backups('antes-exclusao-').length, 1);
});
