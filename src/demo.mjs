import { Store } from './store.mjs';
import { DomainError, localDate, validateDate } from './domain.mjs';

const BUSINESS_COLLECTIONS = [
  'ingredients',
  'products',
  'purchases',
  'movements',
  'sales',
  'expenses',
  'orders',
];
const DEMO_NOTE = 'Dado fictício para explorar o Brasa. Não representa uma operação real.';

function useDemonstrationDate(state, date) {
  const at = date === localDate() ? new Date().toISOString() : `${date}T15:00:00.000Z`;
  for (const collection of [
    'ingredients',
    'products',
    'platforms',
    'purchases',
    'movements',
    'sales',
    'expenses',
    'orders',
  ]) {
    for (const entry of state[collection]) {
      for (const key of ['createdAt', 'updatedAt', 'canceledAt', 'fiscalUpdatedAt']) {
        if (Object.hasOwn(entry, key)) entry[key] = at;
      }
      if (Object.hasOwn(entry, 'date')) entry.date = date;
      if (Object.hasOwn(entry, 'canceledDate')) entry.canceledDate = date;
      if (entry.history) for (const event of entry.history) event.at = at;
    }
  }
}

/** Populate an empty, isolated demonstration Store without partially writing on failure. */
export function seedDemonstration(store, date = localDate()) {
  validateDate(date, 'Data da demonstração');
  const initial = store.exportData();
  if (
    initial.state.meta.demoLoaded ||
    BUSINESS_COLLECTIONS.some((key) => initial.state[key]?.length)
  ) {
    throw new DomainError(
      'A demonstração só pode ser criada em uma base vazia e separada dos seus dados.',
      'DEMO_REQUIRES_EMPTY',
      409,
    );
  }

  const staging = new Store(':memory:');
  try {
    staging.restoreData(initial);
    staging.updateSettings({
      businessName: 'Brasa · Demonstração',
      city: '',
      taxRate: 4,
      targetMargin: 25,
      monthlyFixedCosts: 900,
      expectedMonthlyOrders: 300,
    });
    const platform =
      staging.state().platforms.find((item) => item.name === 'Venda direta') ??
      staging.state().platforms[0];
    if (!platform)
      throw new DomainError(
        'A demonstração precisa de um canal de venda cadastrado.',
        'PLATFORM_NOT_FOUND',
      );

    const catalog = [
      ['Carne bovina', 'kg', 5, 150, 1],
      ['Pão de hambúrguer', 'un', 50, 100, 10],
      ['Queijo muçarela', 'kg', 1.5, 52.5, 0.3],
      ['Tomate', 'kg', 2, 14, 0.3],
      ['Alface', 'g', 500, 7.5, 450],
      ['Molho da casa', 'l', 2, 32, 0.4],
      ['Embalagem individual', 'un', 50, 50, 10],
      ['Bacon', 'kg', 1, 28, 0.2],
    ];
    const ingredients = catalog.map(([name, unit, quantity, totalCost, minStock]) =>
      staging.createIngredient({
        name,
        unit,
        quantity,
        totalCost,
        minStock,
        date,
        supplier: 'Fornecedor de demonstração',
        note: DEMO_NOTE,
      }),
    );
    staging.addPurchase({
      ingredientId: ingredients[0].id,
      quantity: 2,
      unit: 'kg',
      totalCost: 64,
      date,
      supplier: 'Fornecedor de demonstração',
      note: 'Compra fictícia para demonstrar a média ponderada do custo.',
    });

    const baseRecipe = [
      [0, 160, 'g'],
      [1, 1, 'un'],
      [2, 30, 'g'],
      [3, 30, 'g'],
      [4, 10, 'g'],
      [5, 20, 'ml'],
      [6, 1, 'un'],
    ].map(([index, quantity, unit]) => ({ ingredientId: ingredients[index].id, quantity, unit }));
    const classic = staging.saveProduct({
      name: 'Clássico da casa',
      price: 25,
      extraCost: 0.75,
      recipe: baseRecipe,
    });
    const bacon = staging.saveProduct({
      name: 'Bacon da casa',
      price: 29,
      extraCost: 0.75,
      recipe: [...baseRecipe, { ingredientId: ingredients[7].id, quantity: 25, unit: 'g' }],
    });
    const double = staging.saveProduct({
      name: 'Duplo da casa',
      price: 34,
      extraCost: 0.75,
      recipe: baseRecipe.map((row) => ({
        ...row,
        quantity: [ingredients[0].id, ingredients[2].id].includes(row.ingredientId)
          ? row.quantity * 2
          : row.quantity,
      })),
    });
    const extraBacon = staging.saveProduct({
      name: 'Porção extra de bacon',
      price: 4,
      extraCost: 0,
      recipe: [{ ingredientId: ingredients[7].id, quantity: 25, unit: 'g' }],
    });

    function order(number, lines, { fulfillment = 'delivery', payment = {}, note = '' } = {}) {
      return staging.addOrder({
        number: `DEMO-${String(number).padStart(3, '0')}`,
        source: 'manual',
        platformId: platform.id,
        fulfillment,
        deliveryProvider: fulfillment === 'delivery' ? 'store' : 'customer',
        customer: { name: 'Cliente de demonstração', phone: '' },
        delivery:
          fulfillment === 'delivery'
            ? {
                address: 'Endereço fictício · demonstração',
                complement: 'Sem endereço real',
                courier: 'Entregador de demonstração',
              }
            : {},
        payment: { method: 'Pix', prepaid: true, ...payment },
        note: note || DEMO_NOTE,
        lines: lines.map(([product, quantity, lineNote]) => ({
          productId: product.id,
          quantity,
          note: lineNote ?? '',
        })),
      });
    }
    function advance(created, statuses, cancellation = {}) {
      for (const status of statuses)
        staging.transitionOrder(created.id, {
          status,
          ...(status === 'canceled' ? cancellation : {}),
        });
    }

    order(1, [[classic, 2]], {
      note: 'Pedido recebido: inicie o preparo para experimentar a baixa automática do estoque.',
    });
    advance(
      order(2, [
        [bacon, 1],
        [extraBacon, 1, 'Servir a porção à parte.'],
      ]),
      ['preparing'],
    );
    advance(
      order(3, [[double, 1]], {
        fulfillment: 'takeout',
        note: 'Pedido pronto, aguardando retirada.',
      }),
      ['preparing', 'ready'],
    );
    advance(
      order(4, [[classic, 1]], { payment: { method: 'Dinheiro', prepaid: false, changeFor: 50 } }),
      ['preparing', 'ready', 'out_for_delivery'],
    );
    advance(
      order(
        5,
        [
          [classic, 2],
          [bacon, 1],
        ],
        { fulfillment: 'takeout' },
      ),
      ['preparing', 'ready', 'completed'],
    );
    advance(order(6, [[double, 1]]), ['canceled'], {
      reason: 'Exemplo: cancelado antes do preparo; nenhum ingrediente foi consumido.',
    });
    advance(order(7, [[bacon, 1]]), ['preparing', 'canceled'], {
      restock: false,
      reason: 'Exemplo: cancelado após o preparo, com perda dos ingredientes.',
    });
    advance(order(8, [[classic, 1]]), ['preparing', 'canceled'], {
      restock: true,
      reason: 'Exemplo: ingredientes ainda aproveitáveis devolvidos ao estoque.',
    });
    advance(
      order(
        9,
        [
          [classic, 3],
          [bacon, 2],
        ],
        { fulfillment: 'takeout' },
      ),
      ['preparing', 'ready', 'completed'],
    );
    advance(order(10, [[double, 2]], { fulfillment: 'dine_in' }), [
      'preparing',
      'ready',
      'completed',
    ]);

    staging.addExpense({
      date,
      description: 'Despesa de limpeza · demonstração',
      category: 'Operação',
      amount: 35,
    });
    staging.addAdjustment({
      ingredientId: ingredients[3].id,
      kind: 'loss',
      quantity: 100,
      unit: 'g',
      date,
      reason: 'Perda fictícia: tomate descartado para demonstrar o registro de desperdício.',
    });

    const demo = staging.exportData();
    demo.state.meta.demoLoaded = true;
    useDemonstrationDate(demo.state, date);
    return store.restoreData(demo);
  } finally {
    staging.close();
  }
}
