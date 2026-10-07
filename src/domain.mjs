export class DomainError extends Error {
  constructor(message, code = 'INVALID_INPUT', status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

const UNITS = Object.freeze({
  g: { dimension: 'mass', base: 'g', multiplier: 1 },
  kg: { dimension: 'mass', base: 'g', multiplier: 1000 },
  ml: { dimension: 'volume', base: 'ml', multiplier: 1 },
  l: { dimension: 'volume', base: 'ml', multiplier: 1000 },
  un: { dimension: 'count', base: 'un', multiplier: 1 },
});

export function finiteNumber(
  value,
  label,
  { min = 0, max = 1e12, positive = false, integer = false } = {},
) {
  if (typeof value === 'string' && value.trim()) value = Number(value.trim().replace(',', '.'));
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (positive && value <= 0) ||
    (integer && !Number.isInteger(value))
  ) {
    throw new DomainError(
      `${label}: informe um número ${integer ? 'inteiro ' : ''}${positive ? 'maior que zero' : 'válido, maior ou igual a ' + min}.`,
    );
  }
  return value;
}

export function unitInfo(unit) {
  const result = typeof unit === 'string' && Object.hasOwn(UNITS, unit) ? UNITS[unit] : null;
  if (!result) throw new DomainError('Unidade inválida. Use g, kg, ml, l ou un.', 'INVALID_UNIT');
  return result;
}

export function quantityToBase(quantity, unit) {
  const result = finiteNumber(quantity, 'Quantidade') * unitInfo(unit).multiplier;
  return finiteNumber(result, 'Quantidade convertida');
}

export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function validateDate(value, label = 'Data') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new DomainError(`${label}: use o formato AAAA-MM-DD.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new DomainError(`${label} inválida.`);
  return value;
}

export function ingredientCost(ingredient) {
  return finiteNumber(ingredient?.avgCost, 'Custo médio do ingrediente');
}

export function validateRecipe(product, ingredients) {
  if (
    !Array.isArray(product?.recipe) ||
    product.recipe.length === 0 ||
    product.recipe.length > 200
  ) {
    throw new DomainError(
      'A ficha técnica deve conter entre 1 e 200 ingredientes.',
      'INVALID_RECIPE',
    );
  }
  const byId = new Map(ingredients.map((item) => [item.id, item]));
  return product.recipe.map((row) => {
    const ingredient = byId.get(row?.ingredientId);
    if (!ingredient)
      throw new DomainError(
        'A ficha técnica contém um ingrediente inexistente.',
        'INGREDIENT_NOT_FOUND',
      );
    if (unitInfo(row.unit).dimension !== ingredient.dimension) {
      throw new DomainError(
        `A unidade de ${ingredient.name} deve ser compatível com ${ingredient.unit}.`,
        'UNIT_MISMATCH',
      );
    }
    const quantity = finiteNumber(row.quantity, 'Quantidade na ficha técnica', { positive: true });
    return { ingredient, quantity: quantityToBase(quantity, row.unit), row };
  });
}

export function recipeCost(product, ingredients) {
  return validateRecipe(product, ingredients).reduce(
    (total, row) => total + row.quantity * ingredientCost(row.ingredient),
    0,
  );
}

export function suggestPrice(product, ingredients, platform, settings) {
  if (!platform) throw new DomainError('Selecione uma plataforma de venda.', 'PLATFORM_NOT_FOUND');
  const cogs = recipeCost(product, ingredients);
  const extraCost = finiteNumber(product.extraCost ?? 0, 'Custos adicionais');
  const commission = finiteNumber(platform.commission, 'Comissão', { max: 100 });
  const paymentFee = finiteNumber(platform.paymentFee, 'Taxa de pagamento', { max: 100 });
  const taxRate = finiteNumber(settings.taxRate, 'Imposto estimado', { max: 100 });
  const targetMargin = finiteNumber(settings.targetMargin, 'Margem desejada', { max: 100 });
  const expectedOrders = finiteNumber(settings.expectedMonthlyOrders, 'Pedidos mensais previstos', {
    positive: true,
  });
  const perOrderFixed =
    finiteNumber(platform.fixedFee, 'Taxa fixa por pedido') +
    (finiteNumber(settings.monthlyFixedCosts, 'Custos fixos mensais previstos') +
      finiteNumber(platform.monthlyFee, 'Mensalidade da plataforma')) /
      expectedOrders;
  const feeRate = commission + paymentFee;
  const denominator = 1 - (feeRate + taxRate + targetMargin) / 100;
  if (denominator <= 0)
    throw new DomainError(
      'A soma de taxas, imposto e margem deve ser menor que 100%.',
      'IMPOSSIBLE_MARGIN',
    );
  const rawPrice = (cogs + extraCost + perOrderFixed) / denominator;
  const price = Math.ceil((rawPrice - 1e-10) * 100) / 100;
  const netProfit = price * (1 - (feeRate + taxRate) / 100) - cogs - extraCost - perOrderFixed;
  return {
    price,
    rawPrice,
    cogs,
    extraCost,
    perOrderFixed,
    allocatedFixedCosts: perOrderFixed - platform.fixedFee,
    feeRate,
    taxRate,
    targetMargin,
    denominator,
    netProfit,
    margin: price > 0 ? (netProfit / price) * 100 : 0,
    confirmed: platform.confirmed === true,
    warning:
      platform.confirmed === true
        ? null
        : 'Taxas provisórias: confirme seu contrato antes de usar este preço.',
    assumption:
      'Rateio considerando um produto por pedido. Custos fixos previstos são usados apenas nesta simulação.',
  };
}

export function report(state, month = localDate().slice(0, 7)) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new DomainError('Mês inválido. Use AAAA-MM.');
  const active = state.sales.filter(
    (sale) => sale.status === 'active' && sale.date.startsWith(month),
  );
  const canceled = state.sales.filter(
    (sale) => sale.status === 'canceled' && sale.date.startsWith(month),
  );
  const expenses = state.expenses.filter((expense) => expense.date.startsWith(month));
  const losses = state.movements.filter(
    (movement) => movement.kind === 'loss' && movement.date.startsWith(month),
  );
  const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
  const contribution = sum(active, 'contribution');
  const expensesTotal = sum(expenses, 'amount');
  const inventoryLosses = sum(
    losses.filter((loss) => loss.lossCategory !== 'preparation'),
    'cost',
  );
  const preparationLosses = sum(
    losses.filter((loss) => loss.lossCategory === 'preparation'),
    'cost',
  );
  const totalLosses = inventoryLosses + preparationLosses;
  const revenue = sum(active, 'revenue');
  const net = contribution - expensesTotal - totalLosses;
  const canceledBeforePreparation = (state.orders || []).filter(
    (order) =>
      order.status === 'canceled' &&
      !order.saleId &&
      localDate(new Date(order.updatedAt)).startsWith(month),
  );
  const byPlatform = [];
  for (const sale of active) {
    let entry = byPlatform.find((item) => item.platformId === sale.platformId);
    if (!entry) {
      entry = {
        platformId: sale.platformId,
        name: sale.platformName,
        orders: 0,
        revenue: 0,
        fees: 0,
        cogs: 0,
        contribution: 0,
      };
      byPlatform.push(entry);
    }
    entry.orders += 1;
    for (const field of ['revenue', 'fees', 'cogs', 'contribution']) entry[field] += sale[field];
  }
  const lowStock = state.ingredients.filter(
    (ingredient) => ingredient.stock <= ingredient.minStock,
  );
  return {
    month,
    gross: sum(active, 'subtotal'),
    discount: sum(active, 'discount'),
    revenue,
    fees: sum(active, 'fees'),
    taxes: sum(active, 'taxes'),
    cogs: sum(active, 'cogs'),
    extraCosts: sum(active, 'extraCosts'),
    contribution,
    expenses: expensesTotal,
    losses: totalLosses,
    inventoryLosses,
    preparationLosses,
    net,
    orders: active.length,
    salesCount: active.length,
    canceledOrders: canceled.length + canceledBeforePreparation.length,
    unitsSold: active.reduce(
      (total, sale) => total + sale.lines.reduce((count, line) => count + line.quantity, 0),
      0,
    ),
    averageTicket: active.length ? revenue / active.length : 0,
    netMargin: revenue ? (net / revenue) * 100 : 0,
    stockValue: state.ingredients.reduce(
      (total, ingredient) => total + ingredient.stock * ingredient.avgCost,
      0,
    ),
    lowStockCount: lowStock.length,
    lowStock: lowStock.map((ingredient) => ingredient.id),
    byPlatform,
    note: 'Resultado gerencial estimado. Usa despesas lançadas e custos históricos das vendas; previsões de custos fixos e mensalidades não são descontadas automaticamente. O valor do estoque é o saldo atual.',
  };
}
