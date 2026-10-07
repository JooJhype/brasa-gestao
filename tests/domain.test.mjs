import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import {
  quantityToBase,
  ingredientCost,
  recipeCost,
  suggestPrice,
  report,
  validateDate,
} from '../src/domain.mjs';

const almost = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
const MONTH = '2026-10';
const DATE = `${MONTH}-06`;

function setup(t, { stock = 1, totalCost = 100 } = {}) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const ingredient = store.createIngredient({
    name: 'Carne',
    unit: 'kg',
    quantity: stock,
    totalCost,
    minStock: 0.1,
    date: DATE,
  });
  const product = store.saveProduct({
    name: 'Hambúrguer',
    price: 25,
    extraCost: 2,
    recipe: [{ ingredientId: ingredient.id, quantity: 100, unit: 'g' }],
  });
  const platform = store.savePlatform({
    name: 'Marketplace',
    commission: 10,
    paymentFee: 2,
    fixedFee: 3,
    monthlyFee: 50,
    confirmed: true,
  });
  store.updateSettings({ taxRate: 5, monthlyFixedCosts: 100, expectedMonthlyOrders: 10 });
  const sell = (body = {}) =>
    store.addSale({
      date: DATE,
      platformId: platform.id,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 25 }],
      ...body,
    });
  return { store, ingredient, product, platform, sell };
}

test('unidades convertem peso/volume e rejeitam unidades inválidas, valores negativos e datas impossíveis', () => {
  assert.equal(quantityToBase(1.25, 'kg'), 1250);
  assert.equal(quantityToBase(0.5, 'l'), 500);
  assert.equal(quantityToBase('2,5', 'g'), 2.5);
  assert.equal(quantityToBase(7, 'un'), 7);
  for (const args of [
    [-1, 'g'],
    [NaN, 'ml'],
    [1, 'constructor'],
    [1, 'litro'],
    [true, 'g'],
  ])
    assert.throws(() => quantityToBase(...args));
  assert.throws(() => validateDate('2026-02-30'));
  assert.equal(validateDate('2024-02-29'), '2024-02-29');
});

test('compra usa saldo remanescente na média ponderada e preserva registros históricos', (t) => {
  const { store, ingredient, sell } = setup(t);
  sell();
  store.addPurchase({
    ingredientId: ingredient.id,
    quantity: 1,
    unit: 'kg',
    totalCost: 50,
    date: '2026-09-01',
    supplier: 'Fornecedor A',
  });
  const state = store.state();
  assert.equal(state.ingredients[0].stock, 1900);
  almost(state.ingredients[0].avgCost, 140 / 1900);
  assert.equal(state.purchases.length, 2);
  assert.equal(state.purchases[1].date, '2026-09-01');
  assert.equal(state.sales[0].cogs, 10);
  almost(ingredientCost(state.ingredients[0]), 140 / 1900);
});

test('ficha técnica exige unidade compatível e preço sugerido usa margem sobre receita e rateio', (t) => {
  const { store, ingredient, product, platform } = setup(t);
  assert.equal(recipeCost(product, store.state().ingredients), 10);
  assert.throws(
    () =>
      store.saveProduct({
        name: 'Inválido',
        price: 10,
        recipe: [{ ingredientId: ingredient.id, quantity: 1, unit: 'ml' }],
      }),
    { code: 'UNIT_MISMATCH' },
  );
  const state = store.state();
  const quote = suggestPrice(product, state.ingredients, platform, state.settings);
  almost(quote.perOrderFixed, 18); // R$ 3 + (R$ 100 + R$ 50) / 10 pedidos
  assert.equal(quote.price, 47.62); // (10 + 2 + 18) / (1 − .12 − .05 − .20)
  assert.ok(quote.margin >= 20);
  assert.equal(quote.confirmed, true);
  assert.throws(
    () =>
      suggestPrice(product, state.ingredients, platform, { ...state.settings, targetMargin: 90 }),
    { code: 'IMPOSSIBLE_MARGIN' },
  );
  assert.throws(() =>
    suggestPrice(product, state.ingredients, platform, {
      ...state.settings,
      expectedMonthlyOrders: 0,
    }),
  );
});

test('pedido com vários itens aplica taxa fixa uma vez, desconto antes da comissão, e soma consumo', (t) => {
  const { store, ingredient, product, sell } = setup(t);
  const sale = sell({
    lines: [
      { productId: product.id, quantity: 2, unitPrice: 25 },
      { productId: product.id, quantity: 1, unitPrice: 25 },
    ],
    discount: 5,
  });
  assert.equal(sale.subtotal, 75);
  assert.equal(sale.revenue, 70);
  almost(sale.fees, 11.4);
  almost(sale.taxes, 3.5);
  assert.equal(sale.cogs, 30);
  assert.equal(sale.extraCosts, 6);
  almost(sale.contribution, 19.1);
  assert.equal(sale.consumed.length, 1);
  assert.equal(sale.consumed[0].quantity, 300);
  assert.equal(store.state().ingredients.find((item) => item.id === ingredient.id).stock, 700);
  assert.equal(store.state().movements.filter((item) => item.kind === 'sale').length, 1);
});

test('falha de estoque agregado e falha tardia de campo fiscal revertem toda a transação', (t) => {
  const { store, product, sell } = setup(t);
  const before = store.exportData().state;
  assert.throws(
    () =>
      sell({
        lines: [
          { productId: product.id, quantity: 6 },
          { productId: product.id, quantity: 6 },
        ],
      }),
    { code: 'INSUFFICIENT_STOCK' },
  );
  assert.deepEqual(store.state(), before);
  assert.throws(() => sell({ fiscalStatus: 'incorrect' }));
  assert.deepEqual(store.state(), before);
  assert.throws(() => sell({ lines: [{ productId: product.id, quantity: 0.5 }] }));
  assert.deepEqual(store.state(), before);
});

test('edições de ingredientes, receitas e taxas não alteram lucro ou consumo históricos', (t) => {
  const { store, ingredient, product, platform, sell } = setup(t);
  const sale = sell();
  store.updateIngredient(ingredient.id, { name: 'Carne especial', minStock: 200 });
  store.saveProduct(
    {
      price: 50,
      extraCost: 5,
      recipe: [{ ingredientId: ingredient.id, quantity: 150, unit: 'g' }],
    },
    product.id,
  );
  store.savePlatform({ commission: 30, fixedFee: 7 }, platform.id);
  store.addPurchase({
    ingredientId: ingredient.id,
    quantity: 1,
    unit: 'kg',
    totalCost: 300,
    date: DATE,
  });
  assert.deepEqual(store.state().sales[0], sale);
  almost(report(store.state(), MONTH).contribution, sale.contribution);
  assert.throws(() => store.updateIngredient(ingredient.id, { stock: 0 }), {
    code: 'IMMUTABLE_STOCK',
  });
});

test('cancelar com devolução usa custo histórico na média, e não aceita segundo cancelamento', (t) => {
  const { store, ingredient, sell } = setup(t);
  const sale = sell();
  store.addPurchase({
    ingredientId: ingredient.id,
    quantity: 1,
    unit: 'kg',
    totalCost: 50,
    date: DATE,
  });
  store.cancelSale(sale.id, { restock: true, date: DATE });
  const state = store.state();
  assert.equal(state.ingredients[0].stock, 2000);
  almost(state.ingredients[0].avgCost, 150 / 2000);
  assert.equal(report(state, MONTH).revenue, 0);
  assert.equal(report(state, MONTH).losses, 0);
  assert.throws(() => store.cancelSale(sale.id, { restock: true }), { code: 'ALREADY_CANCELED' });
  assert.deepEqual(store.state(), state);
  store.restoreData(store.exportData());
});

test('cancelar sem devolução preserva estoque baixo e contabiliza material mais preparo na data da perda', (t) => {
  const { store, sell } = setup(t);
  const sale = sell();
  store.cancelSale(sale.id, { restock: false, date: '2026-11-02' });
  const state = store.state();
  assert.equal(state.ingredients[0].stock, 900);
  const october = report(state, MONTH);
  assert.equal(october.revenue, 0);
  assert.equal(october.losses, 0);
  const november = report(state, '2026-11');
  assert.equal(november.inventoryLosses, 10);
  assert.equal(november.preparationLosses, 2);
  assert.equal(november.losses, 12);
  assert.equal(november.net, -12);
  assert.equal(state.movements.filter((item) => item.kind === 'loss').length, 2);
  store.restoreData(store.exportData());
});

test('relatório usa despesas reais e perdas, sem duplicar projeção ou mensalidade, estoque é atual', (t) => {
  const { store, ingredient, sell } = setup(t);
  const sale = sell();
  store.addExpense({ date: DATE, description: 'Gás', amount: 3, category: 'Operação' });
  store.addExpense({ date: '2026-11-01', description: 'Aluguel', amount: 100 });
  store.addAdjustment({
    ingredientId: ingredient.id,
    quantity: 50,
    unit: 'g',
    kind: 'loss',
    date: DATE,
    reason: 'Descarte por validade',
  });
  const result = report(store.state(), MONTH);
  assert.equal(result.expenses, 3);
  assert.equal(result.losses, 5);
  almost(result.net, sale.contribution - 8);
  almost(result.stockValue, 85);
  assert.equal(result.orders, 1);
  assert.equal(result.byPlatform[0].orders, 1);
  assert.throws(() => report(store.state(), '2026-13'));
});

test('taxa real sobrescreve estimativa e subsídio extra, situação fiscal é preservada', (t) => {
  const { store, sell } = setup(t);
  const extra = sell({
    extraFee: 2,
    fiscalStatus: 'exempt',
    fiscalReference: 'Dispensa verificada',
  });
  almost(extra.fees, 8);
  const actual = sell({
    feesOverride: 1.25,
    extraFee: 10,
    fiscalStatus: 'issued',
    fiscalReference: 'NFC-e 123',
  });
  assert.equal(actual.fees, 1.25);
  assert.equal(actual.fiscalReference, 'NFC-e 123');
  assert.equal(actual.fiscalStatus, 'issued');
  store.restoreData(store.exportData());
});

test('registro fiscal pode ser atualizado sem modificar saldos nem snapshots financeiros', (t) => {
  const { store, sell } = setup(t);
  const sale = sell();
  const before = store.state();
  const changed = store.updateSaleFiscal(sale.id, {
    fiscalStatus: 'issued',
    fiscalReference: 'NFC-e 42',
  });
  assert.equal(changed.fiscalStatus, 'issued');
  assert.equal(changed.fiscalReference, 'NFC-e 42');
  for (const key of [
    'subtotal',
    'discount',
    'revenue',
    'fees',
    'taxes',
    'cogs',
    'extraCosts',
    'contribution',
    'lines',
    'consumed',
  ])
    assert.deepEqual(changed[key], sale[key]);
  assert.deepEqual(store.state().ingredients, before.ingredients);
  assert.deepEqual(store.state().movements, before.movements);
  assert.throws(() => store.updateSaleFiscal(sale.id, { fiscalStatus: 'unknown' }));
  assert.equal(store.state().sales[0].fiscalStatus, 'issued');
  store.restoreData(store.exportData());
});

test('plataformas não confirmadas retornam advertência sem fingir taxa oficial', (t) => {
  const { store, product } = setup(t);
  const state = store.state();
  const food99 = state.platforms.find((item) => item.name === '99Food');
  const quote = suggestPrice(product, state.ingredients, food99, state.settings);
  assert.equal(quote.confirmed, false);
  assert.match(quote.warning, /confirme/);
  assert.match(food99.notes, /zero não significa/);
  const sale = store.addSale({
    date: DATE,
    platformId: food99.id,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  assert.equal(sale.platformConfirmed, false);
});

test('ajuste para saldo alvo registra perda real, entrada ponderada e impede baixa sem estoque', (t) => {
  const { store, ingredient } = setup(t);
  store.addAdjustment({
    ingredientId: ingredient.id,
    quantity: 0.8,
    unit: 'kg',
    kind: 'set',
    date: DATE,
    reason: 'Contagem física',
  });
  assert.equal(store.state().ingredients[0].stock, 800);
  assert.equal(report(store.state(), MONTH).losses, 20);
  store.addAdjustment({
    ingredientId: ingredient.id,
    quantity: 200,
    unit: 'g',
    kind: 'gain',
    unitCost: 0.2,
    date: DATE,
    reason: 'Entrada identificada',
  });
  almost(store.state().ingredients[0].avgCost, 0.12);
  assert.throws(
    () =>
      store.addAdjustment({
        ingredientId: ingredient.id,
        quantity: 2,
        unit: 'kg',
        kind: 'loss',
        reason: 'Descarte',
      }),
    { code: 'INSUFFICIENT_STOCK' },
  );
  store.restoreData(store.exportData());
});

test('backup válido restaura saldos/histórico; referências, valores e saldo incoerentes são rejeitados sem alteração', (t) => {
  const { store, sell } = setup(t);
  sell();
  const backup = store.exportData();
  store.addExpense({ date: DATE, description: 'Conta', amount: 50 });
  store.restoreData(backup);
  assert.deepEqual(store.state(), backup.state);
  const invalidCases = [
    (value) => {
      value.state.products[0].recipe[0].ingredientId = '00000000-0000-4000-8000-000000000001';
    },
    (value) => {
      value.state.ingredients[0].stock = -1;
    },
    (value) => {
      value.state.ingredients[0].stock = '900';
    },
    (value) => {
      value.state.ingredients[0].stock += 1;
    },
    (value) => {
      value.state.sales[0].contribution += 1;
    },
    (value) => {
      value.state.sales[0].consumed = [];
    },
    (value) => {
      value.state.platforms[0].confirmed = 'true';
    },
    (value) => {
      value.state.movements[0].referenceId = 'invalid';
    },
  ];
  for (const breakBackup of invalidCases) {
    const invalid = structuredClone(backup);
    breakBackup(invalid);
    assert.throws(() => store.restoreData(invalid));
    assert.deepEqual(store.state(), backup.state);
  }
});

test('banco persiste após reiniciar e dois leitores recebem alterações recentes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hamburgueria-test-'));
  const dbPath = join(directory, 'app.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = new Store(dbPath);
  const second = new Store(dbPath);
  try {
    const ingredient = first.createIngredient({
      name: 'Pão',
      unit: 'un',
      quantity: 10,
      totalCost: 20,
      date: DATE,
    });
    assert.equal(second.state().ingredients[0].id, ingredient.id);
    second.addPurchase({
      ingredientId: ingredient.id,
      quantity: 5,
      unit: 'un',
      totalCost: 15,
      date: DATE,
    });
    assert.equal(first.state().ingredients[0].stock, 15);
  } finally {
    first.close();
    second.close();
  }
  const reopened = new Store(dbPath);
  try {
    assert.equal(reopened.state().ingredients[0].stock, 15);
    almost(reopened.state().ingredients[0].avgCost, 35 / 15);
  } finally {
    reopened.close();
  }
});

test('imagens inseguras são rejeitadas sem alterar cadastros ou backups', (t) => {
  const { store, ingredient } = setup(t);
  const before = store.state();
  for (const url of [
    'http://example.com/a.png',
    'javascript:alert(1)',
    '/uploads/../secret.png',
    'data:image/svg+xml;base64,AAAA',
    'https://',
  ]) {
    assert.throws(() => store.updateIngredient(ingredient.id, { image: { url } }));
  }
  for (const field of ['sourceUrl', 'licenseUrl'])
    assert.throws(() =>
      store.updateIngredient(ingredient.id, {
        image: { url: 'https://example.com/a.png', [field]: 'javascript:alert(1)' },
      }),
    );
  assert.deepEqual(store.state(), before);
  store.restoreData(store.exportData());
});

test('custos gratuitos continuam consumindo estoque e backup exige consumo completo', (t) => {
  const { store, sell } = setup(t, { totalCost: 0 });
  sell();
  assert.equal(store.state().ingredients[0].stock, 900);
  const backup = store.exportData();
  backup.state.sales[0].consumed = [];
  assert.throws(() => store.restoreData(backup), { code: 'INVALID_BACKUP' });
  store.restoreData(store.exportData());
});

test('backup não pode reinterpretar entrada de compra como perda nem remover todas as plataformas', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.createIngredient({ name: 'Item', unit: 'un', quantity: 1, totalCost: 10, date: DATE });
  const backup = store.exportData();
  const changedKind = structuredClone(backup);
  changedKind.state.movements[0].kind = 'loss';
  assert.throws(() => store.restoreData(changedKind), { code: 'INVALID_BACKUP' });
  assert.deepEqual(store.state(), backup.state);
  assert.equal(report(store.state(), MONTH).losses, 0);
  const noPlatforms = structuredClone(backup);
  noPlatforms.state.platforms = [];
  assert.throws(() => store.restoreData(noPlatforms), { code: 'INVALID_BACKUP' });
  assert.deepEqual(store.state(), backup.state);
});

test('backup exige sinal, efeito e referência/custo coerentes para cada movimentação histórica', (t) => {
  const { store, ingredient, sell } = setup(t);
  const sale = sell();
  store.cancelSale(sale.id, { restock: false, date: DATE });
  store.addAdjustment({
    ingredientId: ingredient.id,
    quantity: 10,
    unit: 'g',
    kind: 'loss',
    date: DATE,
    reason: 'Descarte',
  });
  store.addAdjustment({
    ingredientId: ingredient.id,
    quantity: 20,
    unit: 'g',
    kind: 'gain',
    date: DATE,
    reason: 'Contagem física',
  });
  const backup = store.exportData();
  const invalidCases = [
    (value) => {
      value.state.movements[0].affectsStock = false;
    },
    (value) => {
      value.state.movements[0].cost += 1;
    },
    (value) => {
      value.state.purchases[0].totalCost += 1;
    },
    (value) => {
      value.state.movements.find((item) => item.kind === 'sale').kind = 'loss';
    },
    (value) => {
      value.state.movements.find(
        (item) => item.kind === 'loss' && item.affectsStock === false && item.ingredientId,
      ).quantity = 0;
    },
    (value) => {
      value.state.movements.find((item) => item.lossCategory === 'preparation').cost += 1;
    },
    (value) => {
      value.state.movements.find((item) => item.kind === 'gain').quantity *= -1;
    },
    (value) => {
      value.state.movements.find((item) => item.kind === 'loss' && item.affectsStock).referenceId =
        sale.id;
    },
    (value) => {
      value.state.movements = value.state.movements.filter(
        (item) => item.kind !== 'loss' || item.affectsStock,
      );
    },
  ];
  for (const breakBackup of invalidCases) {
    const invalid = structuredClone(backup);
    breakBackup(invalid);
    assert.throws(() => store.restoreData(invalid), { code: 'INVALID_BACKUP' });
    assert.deepEqual(store.state(), backup.state);
  }
  store.restoreData(backup);
});
