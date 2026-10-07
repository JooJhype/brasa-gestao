import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { localDate, report } from '../src/domain.mjs';
import { seedDemonstration } from '../src/demo.mjs';

const DATE = '2026-10-06';

function clock(t, initial = '2026-10-06T12:00:00-03:00') {
  const RealDate = globalThis.Date;
  let current = initial;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(current);
    }
    static now() {
      return RealDate.parse(current);
    }
  };
  t.after(() => {
    globalThis.Date = RealDate;
  });
  return (value) => {
    current = value;
  };
}

function setup(t, { stock = 2, totalCost = 80, extraCost = 1 } = {}) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const ingredient = store.createIngredient({
    name: 'Carne teste',
    unit: 'kg',
    quantity: stock,
    totalCost,
    date: DATE,
  });
  const product = store.saveProduct({
    name: 'Hambúrguer teste',
    price: 25,
    extraCost,
    recipe: [{ ingredientId: ingredient.id, quantity: 100, unit: 'g' }],
  });
  const platformId = store.state().platforms[0].id;
  const incoming = (overrides) => ({
    platformId,
    fulfillment: 'delivery',
    customer: { name: 'Cliente fictício', phone: '' },
    delivery: { address: 'Endereço fictício para testes' },
    payment: { method: 'pix', prepaid: true },
    lines: [{ productId: product.id, quantity: 2, unitPrice: 25, note: 'Sem cebola' }],
    ...overrides,
  });
  const add = (overrides) => store.addOrder(incoming(overrides));
  return { store, ingredient, product, platformId, incoming, add };
}

function finish(store, orderId, fulfillment = 'delivery') {
  store.transitionOrder(orderId, { status: 'preparing' });
  store.transitionOrder(orderId, { status: 'ready' });
  if (fulfillment === 'delivery') store.transitionOrder(orderId, { status: 'out_for_delivery' });
  return store.transitionOrder(orderId, { status: 'completed' });
}

function validBackup(store) {
  const backup = store.exportData();
  store.restoreData(backup);
  assert.deepEqual(store.state(), backup.state);
}

test('pedidos: defaults e backup legado migram sem escrever no banco durante leitura', (t) => {
  const { store } = setup(t);
  assert.deepEqual(store.state().orders, []);
  const legacy = store.exportData();
  delete legacy.state.orders;
  store.writeStatement.run(JSON.stringify(legacy.state));
  assert.deepEqual(store.state().orders, []);
  assert.equal(Object.hasOwn(JSON.parse(store.readStatement.get().data), 'orders'), false);
  store.restoreData(legacy);
  const expected = { ...legacy.state, orders: [] };
  assert.deepEqual(store.state(), expected);
  const invalid = structuredClone(legacy);
  invalid.state.orders = null;
  assert.throws(() => store.restoreData(invalid), { code: 'INVALID_BACKUP' });
  assert.deepEqual(store.state(), expected);
});

test('pedidos: cadastro normaliza campos e sempre começa novo sem baixar estoque ou criar venda', (t) => {
  clock(t);
  const { store, add } = setup(t);
  const before = store.state();
  const order = add({
    status: 'completed',
    number: ' A-12 ',
    note: ' Pouco sal ',
    scheduledAt: '2026-10-07T18:00:00-03:00',
    deliveryProvider: 'platform',
    discount: 5,
    extraFee: 2,
  });
  assert.equal(order.status, 'new');
  assert.equal(order.number, 'A-12');
  assert.equal(order.note, 'Pouco sal');
  assert.equal(order.scheduledAt, '2026-10-07T21:00:00.000Z');
  assert.equal(order.deliveryProvider, 'platform');
  assert.equal(order.remoteStatus, '');
  assert.equal(order.source, 'manual');
  assert.equal(order.externalId, null);
  assert.equal(order.saleId, null);
  assert.deepEqual(order.preparation, []);
  assert.deepEqual(order.history, [
    { status: 'new', at: order.createdAt, note: 'Pedido recebido' },
  ]);
  assert.equal(order.lines[0].note, 'Sem cebola');
  assert.deepEqual(store.state().ingredients, before.ingredients);
  assert.deepEqual(store.state().movements, before.movements);
  assert.deepEqual(store.state().sales, []);
  validBackup(store);
});

test('pedidos: cadastro manual recusa integrações e não agrupa pedidos distintos', (t) => {
  clock(t);
  const { store, add, incoming } = setup(t);
  const first = add({ number: '001' });
  finish(store, first.id);
  const before = store.state();
  for (const source of ['site', 'ifood', '99food'])
    assert.throws(() => store.addOrder(incoming({ source, externalId: 'EXTERNO-1' })));
  assert.throws(() => store.addOrder(incoming({ externalId: 'EXTERNO-1' })));
  assert.deepEqual(store.state(), before);
  const another = add({ number: '001' });
  assert.notEqual(another.id, first.id);
  assert.equal(store.state().orders.length, 2);
  assert.equal(store.state().sales.length, 1);
  validBackup(store);
});

test('pedidos: preparo é transacional, consome uma única vez e guarda snapshot sem custos', (t) => {
  clock(t);
  const { store, add, ingredient } = setup(t);
  const order = add({ discount: 2 });
  const preparing = store.transitionOrder(order.id, { status: 'preparing' });
  const state = store.state();
  assert.equal(state.ingredients[0].stock, 1800);
  assert.equal(state.sales.length, 1);
  assert.equal(state.sales[0].status, 'pending');
  assert.equal(state.sales[0].orderId, order.id);
  assert.equal(state.sales[0].source, 'manual');
  assert.equal(preparing.saleId, state.sales[0].id);
  assert.deepEqual(preparing.preparation, [
    { ingredientId: ingredient.id, name: ingredient.name, quantity: 200, unit: 'g' },
  ]);
  assert.deepEqual(Object.keys(preparing.preparation[0]).sort(), [
    'ingredientId',
    'name',
    'quantity',
    'unit',
  ]);
  assert.equal(report(state, localDate().slice(0, 7)).orders, 0);
  assert.equal(report(state, localDate().slice(0, 7)).net, 0);
  for (let count = 0; count < 3; count++) store.transitionOrder(order.id, { status: 'preparing' });
  assert.deepEqual(store.state(), state);
  validBackup(store);
});

test('pedidos: estoque agregado insuficiente reverte venda, história e consumo por inteiro', (t) => {
  const { store, add, product } = setup(t, { stock: 0.1, totalCost: 4 });
  const order = add({
    lines: [
      { productId: product.id, quantity: 1 },
      { productId: product.id, quantity: 1 },
    ],
  });
  const before = store.state();
  assert.throws(() => store.transitionOrder(order.id, { status: 'preparing' }), {
    code: 'INSUFFICIENT_STOCK',
  });
  assert.deepEqual(store.state(), before);
  validBackup(store);
});

test('pedidos: item sem ficha bloqueia preparo e vínculo preserva nome/observação/preço', (t) => {
  clock(t);
  const { store, add, product } = setup(t);
  const order = add({
    lines: [
      { productId: null, name: 'Nome do cardápio', note: 'Sem molho', quantity: 1, unitPrice: 30 },
    ],
  });
  const before = store.state();
  assert.throws(() => store.transitionOrder(order.id, { status: 'preparing' }), {
    code: 'UNMAPPED_ORDER_LINES',
  });
  assert.deepEqual(store.state(), before);
  const mapped = store.mapOrderLine(order.id, { index: 0, productId: product.id });
  assert.deepEqual(mapped.lines[0], { ...order.lines[0], productId: product.id });
  const preparing = store.transitionOrder(order.id, { status: 'preparing' });
  assert.equal(store.state().sales[0].revenue, 30);
  assert.throws(() => store.mapOrderLine(order.id, { index: 0, productId: product.id }), {
    code: 'ORDER_LOCKED',
  });
  assert.equal(preparing.lines[0].name, 'Nome do cardápio');
  validBackup(store);
});

test('pedidos: concluir muda somente situação/data financeira; consumo mantém integridade na virada do dia', (t) => {
  const setTime = clock(t, '2026-10-06T23:55:00-03:00');
  const { store, add } = setup(t);
  const order = add();
  store.transitionOrder(order.id, { status: 'preparing' });
  store.transitionOrder(order.id, { status: 'ready' });
  store.transitionOrder(order.id, { status: 'out_for_delivery' });
  const prepared = store.state();
  assert.equal(prepared.sales[0].date, '2026-10-06');
  setTime('2026-10-07T00:05:00-03:00');
  const completed = store.transitionOrder(order.id, { status: 'completed' });
  const after = store.state();
  assert.equal(completed.status, 'completed');
  assert.equal(after.sales[0].status, 'active');
  assert.equal(after.sales[0].date, '2026-10-07');
  assert.deepEqual(after.ingredients, prepared.ingredients);
  assert.equal(after.sales[0].cogs, 8);
  assert.equal(report(after, '2026-10').orders, 1);
  assert.equal(report(after, '2026-10').net, 40);
  for (const movement of after.movements.filter((row) => row.kind === 'sale'))
    assert.equal(movement.date, '2026-10-07');
  store.transitionOrder(order.id, { status: 'completed' });
  assert.deepEqual(store.state(), after);
  validBackup(store);
});

test('pedidos: retirada e salão concluem de pronto e não podem sair para entrega', (t) => {
  for (const fulfillment of ['takeout', 'dine_in']) {
    const { store, add } = setup(t);
    const order = add({ fulfillment });
    assert.equal(order.deliveryProvider, 'customer');
    store.transitionOrder(order.id, { status: 'preparing' });
    store.transitionOrder(order.id, { status: 'ready' });
    const before = store.state();
    assert.throws(() => store.transitionOrder(order.id, { status: 'out_for_delivery' }), {
      code: 'INVALID_ORDER_TRANSITION',
    });
    assert.deepEqual(store.state(), before);
    store.transitionOrder(order.id, { status: 'completed' });
    assert.equal(store.state().sales[0].status, 'active');
    validBackup(store);
  }
});

test('pedidos: cancelar antes do preparo não gera venda, consumo ou perda', (t) => {
  const { store, add } = setup(t);
  const order = add();
  const before = store.state();
  const canceled = store.transitionOrder(order.id, {
    status: 'canceled',
    reason: 'Cliente desistiu',
  });
  assert.equal(canceled.saleId, null);
  assert.equal(canceled.history.at(-1).note, 'Cliente desistiu');
  assert.deepEqual(store.state().ingredients, before.ingredients);
  assert.deepEqual(store.state().movements, before.movements);
  assert.deepEqual(store.state().sales, []);
  const after = store.state();
  store.transitionOrder(order.id, { status: 'canceled', restock: true });
  assert.deepEqual(store.state(), after);
  assert.throws(() => store.transitionOrder(order.id, { status: 'preparing' }), {
    code: 'INVALID_ORDER_TRANSITION',
  });
  validBackup(store);
});

test('pedidos: cancelar manual após preparo exige decisão e devolve quantidades/custos históricos', (t) => {
  clock(t);
  const { store, add, ingredient } = setup(t);
  const order = add();
  store.transitionOrder(order.id, { status: 'preparing' });
  store.addPurchase({
    ingredientId: ingredient.id,
    unit: 'kg',
    quantity: 1,
    totalCost: 100,
    date: DATE,
  });
  const before = store.state();
  assert.throws(() => store.transitionOrder(order.id, { status: 'canceled' }), {
    code: 'RESTOCK_REQUIRED',
  });
  assert.deepEqual(store.state(), before);
  store.transitionOrder(order.id, {
    status: 'canceled',
    restock: true,
    reason: 'Ingredientes devolvidos',
  });
  const state = store.state();
  assert.equal(state.sales[0].status, 'canceled');
  assert.equal(state.ingredients[0].stock, 3000);
  assert.ok(Math.abs(state.ingredients[0].avgCost - 180 / 3000) < 1e-10);
  assert.equal(report(state, '2026-10').losses, 0);
  assert.equal(state.movements.filter((row) => row.kind === 'return').length, 1);
  validBackup(store);
});

test('pedidos: cancelamento sem devolução registra perdas uma única vez', (t) => {
  clock(t);
  const { store, add } = setup(t);
  const order = add();
  store.transitionOrder(order.id, { status: 'preparing' });
  store.transitionOrder(order.id, {
    status: 'canceled',
    restock: false,
    reason: 'Cliente cancelou',
  });
  const state = store.state();
  assert.equal(state.ingredients[0].stock, 1800);
  assert.equal(state.sales[0].canceledRestock, false);
  assert.equal(report(state, '2026-10').inventoryLosses, 8);
  assert.equal(report(state, '2026-10').preparationLosses, 2);
  assert.equal(report(state, '2026-10').net, -10);
  store.transitionOrder(order.id, { status: 'canceled', restock: true });
  assert.deepEqual(store.state(), state);
  validBackup(store);
});

test('pedidos: cancelar pela venda sincroniza pedido pendente/concluído e impede continuar o preparo', (t) => {
  clock(t);
  for (const completed of [false, true]) {
    const { store, add } = setup(t);
    const order = add();
    const prepared = completed
      ? finish(store, order.id)
      : store.transitionOrder(order.id, { status: 'preparing' });
    const sale = store.cancelSale(prepared.saleId, {
      restock: false,
      date: DATE,
      reason: 'Cancelado no financeiro',
    });
    const updated = store.state().orders[0];
    assert.equal(updated.status, 'canceled');
    assert.equal(updated.history.at(-1).at, sale.canceledAt);
    assert.equal(updated.history.at(-1).note, 'Cancelado no financeiro');
    assert.throws(() => store.transitionOrder(order.id, { status: 'ready' }), {
      code: 'INVALID_ORDER_TRANSITION',
    });
    assert.throws(() => store.cancelSale(sale.id, { restock: false }), {
      code: 'ALREADY_CANCELED',
    });
    validBackup(store);
  }
});

test('pedidos: mudanças futuras de nomes, preços e receitas preservam preparação e custo fotografados', (t) => {
  clock(t);
  const { store, add, product, ingredient } = setup(t);
  const order = add();
  const prepared = store.transitionOrder(order.id, { status: 'preparing' });
  const historicalSale = store.state().sales[0];
  store.updateIngredient(ingredient.id, { name: 'Carne especial' });
  store.addPurchase({
    ingredientId: ingredient.id,
    quantity: 1,
    unit: 'kg',
    totalCost: 100,
    date: DATE,
  });
  store.saveProduct(
    {
      name: 'Hambúrguer novo',
      price: 50,
      recipe: [{ ingredientId: ingredient.id, quantity: 300, unit: 'g' }],
    },
    product.id,
  );
  assert.deepEqual(store.state().orders[0].preparation, prepared.preparation);
  assert.deepEqual(store.state().sales[0], historicalSale);
  store.transitionOrder(order.id, { status: 'ready' });
  store.transitionOrder(order.id, { status: 'completed' });
  assert.equal(store.state().sales[0].revenue, 50);
  assert.equal(store.state().sales[0].cogs, 8);
  validBackup(store);
});

test('pedidos: ficha vinculada permanece protegida mesmo em pedido cancelado antes do preparo', (t) => {
  const { store, add, product } = setup(t);
  const order = add();
  for (const status of ['new', 'canceled']) {
    if (status === 'canceled') store.transitionOrder(order.id, { status });
    const before = store.state();
    assert.throws(() => store.deleteProduct(product.id, { confirmation: 'deletar' }), {
      code: 'PRODUCT_IN_ORDER',
    });
    assert.deepEqual(store.state(), before);
  }
  validBackup(store);
});

test('pedidos: backup recusa adulteração de vínculos, história, preparação e totais sem alterar a base', (t) => {
  clock(t);
  const { store, add } = setup(t);
  const order = add();
  store.transitionOrder(order.id, { status: 'preparing' });
  const backup = store.exportData();
  const mutations = [
    (data) => {
      delete data.state.orders;
    },
    (data) => {
      data.state.orders[0].saleId = null;
    },
    (data) => {
      data.state.sales[0].orderId = randomUUID();
    },
    (data) => {
      delete data.state.sales[0].orderId;
    },
    (data) => {
      data.state.sales[0].source = 'ifood';
    },
    (data) => {
      data.state.orders[0].platformId = data.state.platforms[1].id;
    },
    (data) => {
      data.state.orders[0].status = 'completed';
    },
    (data) => {
      data.state.sales[0].status = 'active';
    },
    (data) => {
      data.state.orders[0].lines[0].unitPrice += 1;
    },
    (data) => {
      data.state.orders[0].lines[0].quantity += 1;
    },
    (data) => {
      data.state.orders[0].preparation[0].quantity += 1;
    },
    (data) => {
      data.state.orders[0].preparation[0].unitCost = 99;
    },
    (data) => {
      data.state.orders[0].preparation = [];
    },
    (data) => {
      data.state.orders[0].history.pop();
    },
    (data) => {
      data.state.orders[0].history[1].at = 'inválido';
    },
    (data) => {
      data.state.orders[0].history[1].status = 'completed';
    },
    (data) => {
      data.state.orders[0].source = 'site';
    },
    (data) => {
      const duplicated = structuredClone(data.state.orders[0]);
      duplicated.id = randomUUID();
      data.state.orders.push(duplicated);
    },
    (data) => {
      data.state.sales[0].date = '2026-10-07';
      data.state.movements
        .filter((row) => row.kind === 'sale')
        .forEach((row) => {
          row.date = '2026-10-07';
        });
    },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(backup);
    mutate(invalid);
    assert.throws(() => store.restoreData(invalid));
    assert.deepEqual(store.state(), backup.state);
  }
  validBackup(store);
});

test('pedidos: erros de campos, mapeamento e transições inválidas preservam os dados', (t) => {
  const { store, add, incoming, product } = setup(t);
  const before = store.state();
  for (const overrides of [
    { source: 'desconhecido' },
    { fulfillment: 'inválido' },
    { deliveryProvider: 'inválido' },
    { payment: { prepaid: 'sim' } },
    { payment: { changeFor: 1 } },
    { scheduledAt: '2026-02-30T12:00:00Z' },
    { lines: [] },
    { lines: [{ productId: product.id, quantity: 0 }] },
    { lines: [{ productId: product.id, quantity: 1.5 }] },
    { discount: 1000 },
  ]) {
    assert.throws(() => store.addOrder(incoming(overrides)));
    assert.deepEqual(store.state(), before);
  }
  const order = add();
  const withOrder = store.state();
  for (const status of ['ready', 'completed', 'out_for_delivery', 'inválido']) {
    assert.throws(() => store.transitionOrder(order.id, { status }));
    assert.deepEqual(store.state(), withOrder);
  }
  for (const body of [
    { index: -1, productId: product.id },
    { index: 999, productId: product.id },
    { index: 0, productId: randomUUID() },
  ]) {
    assert.throws(() => store.mapOrderLine(order.id, body));
    assert.deepEqual(store.state(), withOrder);
  }
});

test('pedidos: demonstração exige uma base vazia e não altera pedidos existentes', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.addOrder({
    platformId: store.state().platforms[0].id,
    lines: [{ name: 'Item ainda sem vínculo', quantity: 1, unitPrice: 10 }],
  });
  const before = store.state();
  assert.throws(() => seedDemonstration(store), { code: 'DEMO_REQUIRES_EMPTY' });
  assert.deepEqual(store.state(), before);
});

test('pedidos: persistência entre reinícios mantém o pedido e não consome estoque novamente', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'brasa-order-persistence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'orders.sqlite');
  let store = new Store(filename);
  let order;
  try {
    const ingredient = store.createIngredient({
      name: 'Carne',
      unit: 'kg',
      quantity: 1,
      totalCost: 40,
    });
    const product = store.saveProduct({
      name: 'Hambúrguer',
      price: 20,
      recipe: [{ ingredientId: ingredient.id, quantity: 100, unit: 'g' }],
    });
    order = store.addOrder({
      number: 'PERSISTENTE-1',
      platformId: store.state().platforms[0].id,
      lines: [{ productId: product.id, quantity: 1 }],
    });
    store.transitionOrder(order.id, { status: 'preparing' });
  } finally {
    store.close();
  }
  store = new Store(filename);
  try {
    const before = store.state();
    assert.equal(before.orders[0].id, order.id);
    assert.equal(before.orders[0].number, 'PERSISTENTE-1');
    store.transitionOrder(order.id, { status: 'preparing' });
    assert.deepEqual(store.state(), before);
    assert.equal(before.ingredients[0].stock, 900);
    assert.equal(before.sales.length, 1);
    validBackup(store);
  } finally {
    store.close();
  }
});
