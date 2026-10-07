import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { seedDemonstration } from '../src/demo.mjs';
import { report, recipeCost } from '../src/domain.mjs';

const DATE = '2026-10-07';
const almost = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

function setup(t) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  return store;
}

test('demonstração completa tem todos os estágios, custos e histórico validado sem dados de clientes reais', (t) => {
  const store = setup(t);
  const originalPlatforms = store.state().platforms.map((item) => item.id);
  const state = seedDemonstration(store, DATE);
  assert.equal(state.meta.demoLoaded, true);
  assert.equal(state.ingredients.length, 8);
  assert.equal(state.products.length, 4);
  assert.equal(state.purchases.length, 9);
  assert.equal(state.orders.length, 10);
  assert.deepEqual([...new Set(state.orders.map((order) => order.status))].sort(), [
    'canceled',
    'completed',
    'new',
    'out_for_delivery',
    'preparing',
    'ready',
  ]);
  assert.deepEqual(
    state.platforms.map((item) => item.id),
    originalPlatforms,
  );
  for (const order of state.orders) {
    assert.equal(order.source, 'manual');
    assert.equal(order.externalId, null);
    assert.equal(order.customer.name, 'Cliente de demonstração');
    assert.equal(order.customer.phone, '');
    assert.equal(order.delivery.postalCode, '');
    assert.equal(order.delivery.city, '');
    assert.ok(originalPlatforms.includes(order.platformId));
  }
  assert.ok(state.products.every((product) => recipeCost(product, state.ingredients) > 0));
  const restored = setup(t);
  restored.restoreData(store.exportData());
  assert.deepEqual(restored.state(), state);
});

test('resultado da demonstração considera apenas concluídos, despesas e perdas, com compras e estoque reconciliados', (t) => {
  const store = setup(t);
  const state = seedDemonstration(store, DATE);
  const summary = report(state, '2026-10');
  assert.equal(summary.orders, 3);
  assert.equal(summary.unitsSold, 10);
  assert.equal(summary.canceledOrders, 3);
  assert.equal(summary.revenue, 280);
  assert.equal(summary.expenses, 35);
  assert.equal(state.sales.filter((sale) => sale.status === 'pending').length, 3);
  almost(summary.taxes, 11.2);
  almost(summary.preparationLosses, 0.75);
  assert.ok(summary.inventoryLosses > 0);
  assert.ok(summary.net > 0 && summary.net < summary.revenue);
  almost(summary.net, summary.contribution - summary.expenses - summary.losses);
  const meat = state.ingredients.find((item) => item.name === 'Carne bovina');
  almost(meat.avgCost, 214 / 7000);
  almost(meat.stock, 4280);
  const lettuce = state.ingredients.find((item) => item.name === 'Alface');
  assert.equal(lettuce.stock, 360);
  assert.ok(summary.lowStock.includes(lettuce.id));
  for (const ingredient of state.ingredients) {
    const movements = state.movements.filter(
      (movement) => movement.ingredientId === ingredient.id && movement.affectsStock,
    );
    almost(
      movements.reduce((balance, movement) => balance + movement.quantity, 0),
      ingredient.stock,
    );
  }
});

test('pedido de demonstração pode avançar, debita receita uma vez e gera venda somente ao concluir', (t) => {
  const store = setup(t);
  const state = seedDemonstration(store);
  const order = state.orders.find((item) => item.status === 'new');
  const meat = state.ingredients.find((item) => item.name === 'Carne bovina');
  const before = report(state);
  store.transitionOrder(order.id, { status: 'preparing' });
  almost(store.state().ingredients.find((item) => item.id === meat.id).stock, meat.stock - 320);
  assert.equal(report(store.state()).orders, before.orders);
  store.transitionOrder(order.id, { status: 'preparing' });
  almost(store.state().ingredients.find((item) => item.id === meat.id).stock, meat.stock - 320);
  store.transitionOrder(order.id, { status: 'ready' });
  store.transitionOrder(order.id, { status: 'out_for_delivery' });
  store.transitionOrder(order.id, { status: 'completed' });
  assert.equal(report(store.state()).orders, before.orders + 1);
  almost(report(store.state()).revenue, before.revenue + 50);
  store.restoreData(store.exportData());
});

test('demonstração recusa bases preenchidas e datas inválidas sem alterar nenhum cadastro', (t) => {
  const store = setup(t);
  const empty = store.state();
  assert.throws(() => seedDemonstration(store, '2026-02-30'));
  assert.deepEqual(store.state(), empty);
  store.createIngredient({ name: 'Cadastro existente', unit: 'un', quantity: 2, totalCost: 8 });
  const existing = store.state();
  assert.throws(() => seedDemonstration(store, DATE), { code: 'DEMO_REQUIRES_EMPTY' });
  assert.deepEqual(store.state(), existing);
  const demoStore = setup(t);
  seedDemonstration(demoStore, DATE);
  const demo = demoStore.state();
  assert.throws(() => seedDemonstration(demoStore, DATE), { code: 'DEMO_REQUIRES_EMPTY' });
  assert.deepEqual(demoStore.state(), demo);
});
