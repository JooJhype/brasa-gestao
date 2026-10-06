import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError, finiteNumber, unitInfo, quantityToBase, validateRecipe, localDate, validateDate } from './domain.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLLECTIONS = ['ingredients', 'products', 'platforms', 'purchases', 'movements', 'sales', 'expenses'];
const copy = value => structuredClone(value);
const timestamp = () => new Date().toISOString();
const id = () => randomUUID();
const has = (object, key) => Object.hasOwn(object, key);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError(`${label} inválido.`);
  return value;
}

function text(value, label, max = 200, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new DomainError(`${label}: informe um texto ${required ? 'não vazio, ' : ''}com até ${max} caracteres.`);
  return value.trim();
}

function amount(value, label, fallback = 0) {
  return finiteNumber(value ?? fallback, label);
}

function isHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return /^https:\/\//i.test(value) && parsed.protocol === 'https:' && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}

function image(value) {
  if (value === undefined || value === null || value === '') return null;
  object(value, 'Imagem');
  const url = text(value.url, 'Endereço da imagem', 5_600_000, true);
  const localUpload = /^\/uploads\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(url);
  const dataImage = /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(url);
  if (!isHttpsUrl(url) && !localUpload && !dataImage) {
    throw new DomainError('A imagem deve usar um endereço HTTPS, um upload local ou uma imagem PNG, JPEG, WebP ou GIF em base64.');
  }
  if (dataImage && Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').length > 4 * 1024 * 1024) throw new DomainError('A imagem deve ter no máximo 4 MB.');
  const result = { url };
  for (const field of ['sourceUrl', 'author', 'license', 'licenseUrl']) {
    if (value[field] !== undefined && value[field] !== null && value[field] !== '') {
      const content = text(value[field], `Imagem: ${field}`, 2000);
      if (['sourceUrl', 'licenseUrl'].includes(field) && !isHttpsUrl(content)) throw new DomainError('Os links de fonte e licença da imagem devem ser endereços HTTPS válidos.');
      result[field] = content;
    }
  }
  return result;
}

function find(items, key, label) {
  const item = items.find(item => item.id === key);
  if (!item) throw new DomainError(`${label} não encontrado.`, 'NOT_FOUND', 404);
  return item;
}

function uniqueName(items, name, exceptId) {
  if (items.some(item => item.id !== exceptId && item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
    throw new DomainError(`Já existe um cadastro com o nome “${name}”.`, 'DUPLICATE_NAME', 409);
  }
}

function defaults() {
  return {
    ingredients: [], products: [], purchases: [], movements: [], sales: [], expenses: [],
    platforms: [
      { id: id(), name: 'Venda direta', commission: 0, paymentFee: 0, fixedFee: 0, monthlyFee: 0, confirmed: true, notes: 'Sem comissão. Se houver taxa de cartão, configure aqui.', createdAt: timestamp() },
      { id: id(), name: 'iFood Entrega', commission: 23, paymentFee: 3.2, fixedFee: 0, monthlyFee: 150, confirmed: false, notes: 'Referência pública: comissão 23%, pagamento online 3,2% e mensalidade R$ 150 em meses com faturamento superior a R$ 1.800. Confirme disponibilidade, contrato, taxas adicionais e promoções antes de precificar.', createdAt: timestamp() },
      { id: id(), name: '99Food', commission: 0, paymentFee: 0, fixedFee: 0, monthlyFee: 0, confirmed: false, notes: 'Valores pendentes de confirmação. Promoções e condições comerciais podem variar. Preencha as taxas efetivas do seu contrato; zero não significa isenção confirmada.', createdAt: timestamp() },
    ],
    settings: { businessName: 'Minha hamburgueria', city: '', taxRate: 0, targetMargin: 20, monthlyFixedCosts: 0, expectedMonthlyOrders: 100 },
    meta: { demoLoaded: false },
  };
}

function recordMovement(state, ingredient, { date, kind, quantity, cost, referenceId = null, reason = '', stockBefore, affectsStock = true }) {
  const movement = {
    id: id(), ingredientId: ingredient.id, ingredientName: ingredient.name,
    date, kind, quantity, unit: ingredient.unit, cost, referenceId, reason,
    stockBefore, stockAfter: ingredient.stock, affectsStock, createdAt: timestamp(),
  };
  state.movements.push(movement);
  return movement;
}

function recordPurchase(state, ingredient, body, initial = false) {
  const info = unitInfo(body.unit);
  if (info.dimension !== ingredient.dimension) throw new DomainError(`A unidade da compra deve ser compatível com ${ingredient.unit}.`, 'UNIT_MISMATCH');
  const inputQuantity = finiteNumber(body.quantity, 'Quantidade comprada', { positive: true });
  const quantity = quantityToBase(inputQuantity, body.unit);
  const totalCost = finiteNumber(body.totalCost, 'Custo total da compra');
  const date = validateDate(body.date || localDate());
  const expiry = body.expiry ? validateDate(body.expiry, 'Validade') : null;
  const purchase = {
    id: id(), ingredientId: ingredient.id, ingredientName: ingredient.name,
    date, quantity, unit: ingredient.unit, inputQuantity, inputUnit: body.unit,
    totalCost, supplier: text(body.supplier, 'Fornecedor', 200), expiry,
    note: text(body.note ?? (initial ? 'Estoque inicial' : ''), 'Observação', 2000),
    initial, createdAt: timestamp(),
  };
  const stockBefore = ingredient.stock;
  const totalQuantity = finiteNumber(stockBefore + quantity, 'Saldo após a compra');
  ingredient.avgCost = finiteNumber((stockBefore * ingredient.avgCost + totalCost) / totalQuantity, 'Custo médio');
  ingredient.stock = totalQuantity;
  ingredient.updatedAt = timestamp();
  state.purchases.push(purchase);
  recordMovement(state, ingredient, { date, kind: 'purchase', quantity, cost: totalCost, referenceId: purchase.id, reason: purchase.note, stockBefore });
  return purchase;
}

function recordIngredient(state, body) {
  object(body, 'Ingrediente');
  const info = unitInfo(body.unit);
  const name = text(body.name, 'Nome do ingrediente', 120, true);
  uniqueName(state.ingredients, name);
  const quantity = finiteNumber(body.quantity ?? 0, 'Quantidade inicial');
  const totalCost = amount(body.totalCost, 'Custo total inicial');
  if (quantity === 0 && totalCost !== 0) throw new DomainError('O custo do estoque inicial deve ser zero quando a quantidade é zero.');
  const minimumUnit = body.minStockUnit ?? body.unit;
  if (unitInfo(minimumUnit).dimension !== info.dimension) throw new DomainError('A unidade do estoque mínimo é incompatível.', 'UNIT_MISMATCH');
  const ingredient = {
    id: id(), name, dimension: info.dimension, unit: info.base, stock: 0, avgCost: 0,
    minStock: quantityToBase(body.minStock ?? 0, minimumUnit), image: image(body.image),
    createdAt: timestamp(), updatedAt: timestamp(),
  };
  state.ingredients.push(ingredient);
  if (quantity > 0) recordPurchase(state, ingredient, { ...body, quantity, totalCost }, true);
  return ingredient;
}

function normalizeProduct(state, body, old) {
  object(body, 'Produto');
  const name = text(body.name ?? old?.name, 'Nome do produto', 120, true);
  uniqueName(state.products, name, old?.id);
  const product = {
    id: old?.id ?? id(), name,
    price: finiteNumber(body.price ?? old?.price ?? 0, 'Preço de venda'),
    extraCost: finiteNumber(body.extraCost ?? old?.extraCost ?? 0, 'Custos adicionais por produto'),
    recipe: body.recipe ?? old?.recipe,
    createdAt: old?.createdAt ?? timestamp(), updatedAt: timestamp(),
  };
  validateRecipe(product, state.ingredients);
  product.recipe = product.recipe.map(row => ({ ingredientId: row.ingredientId, quantity: finiteNumber(row.quantity, 'Quantidade na ficha técnica', { positive: true }), unit: row.unit }));
  return product;
}

function normalizePlatform(state, body, old) {
  object(body, 'Plataforma');
  const name = text(body.name ?? old?.name, 'Nome da plataforma', 100, true);
  uniqueName(state.platforms, name, old?.id);
  const commission = finiteNumber(body.commission ?? old?.commission ?? 0, 'Comissão', { max: 100 });
  const paymentFee = finiteNumber(body.paymentFee ?? old?.paymentFee ?? 0, 'Taxa de pagamento', { max: 100 });
  if (commission + paymentFee >= 100) throw new DomainError('Comissão e taxa de pagamento somadas devem ser menores que 100%.');
  const confirmed = body.confirmed ?? old?.confirmed ?? false;
  if (typeof confirmed !== 'boolean') throw new DomainError('Confirmação das taxas deve ser verdadeira ou falsa.');
  return {
    id: old?.id ?? id(), name, commission, paymentFee,
    fixedFee: amount(body.fixedFee ?? old?.fixedFee, 'Taxa fixa por pedido'),
    monthlyFee: amount(body.monthlyFee ?? old?.monthlyFee, 'Mensalidade'), confirmed,
    notes: text(body.notes ?? old?.notes, 'Observações da plataforma', 2000),
    createdAt: old?.createdAt ?? timestamp(), updatedAt: timestamp(),
  };
}

function normalizeSettings(body, previous) {
  object(body, 'Configurações');
  return {
    businessName: text(body.businessName ?? previous.businessName, 'Nome do negócio', 120, true),
    city: text(body.city ?? previous.city, 'Cidade', 120),
    taxRate: finiteNumber(body.taxRate ?? previous.taxRate, 'Imposto estimado', { max: 100 }),
    targetMargin: finiteNumber(body.targetMargin ?? previous.targetMargin, 'Margem desejada', { max: 100 }),
    monthlyFixedCosts: amount(body.monthlyFixedCosts ?? previous.monthlyFixedCosts, 'Custos fixos mensais previstos'),
    expectedMonthlyOrders: finiteNumber(body.expectedMonthlyOrders ?? previous.expectedMonthlyOrders, 'Pedidos mensais previstos', { positive: true, integer: true }),
  };
}

function closeEnough(a, b) { return Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)); }
function exceedsStock(quantity, stock) {
  return quantity > stock && (stock === 0 || quantity - stock > Number.EPSILON * Math.max(quantity, stock) * 8);
}

// Backup imports are validated before any replacement. These checks include
// historical snapshots, not just current recipes, so a bad file cannot erase data.
function validateState(state) {
  object(state, 'Conteúdo do backup');
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key]) || state[key].length > 100_000) throw new DomainError(`Backup inválido: lista ${key}.`, 'INVALID_BACKUP');
    const ids = new Set();
    for (const item of state[key]) {
      object(item, `Registro de ${key}`);
      if (typeof item.id !== 'string' || !UUID.test(item.id) || ids.has(item.id)) throw new DomainError(`Backup inválido: identificador de ${key}.`, 'INVALID_BACKUP');
      ids.add(item.id);
    }
  }
  if (!state.platforms.length) throw new DomainError('Backup inválido: mantenha pelo menos uma plataforma de venda.', 'INVALID_BACKUP');
  const number = (value, label, options = {}) => {
    if (typeof value !== 'number') throw new DomainError(`Backup inválido: ${label} deve ser numérico.`, 'INVALID_BACKUP');
    return finiteNumber(value, label, options);
  };
  const signed = (value, label) => number(value, label, { min: -1e12 });
  const ingredients = new Map(state.ingredients.map(item => [item.id, item]));
  const products = new Map(state.products.map(item => [item.id, item]));
  const platforms = new Map(state.platforms.map(item => [item.id, item]));
  const purchases = new Map(state.purchases.map(item => [item.id, item]));
  const sales = new Map(state.sales.map(item => [item.id, item]));
  for (const ingredient of state.ingredients) {
    text(ingredient.name, 'Nome do ingrediente', 120, true);
    const info = unitInfo(ingredient.unit);
    if (info.base !== ingredient.unit || info.dimension !== ingredient.dimension) throw new DomainError('Backup inválido: dimensão do ingrediente.', 'INVALID_BACKUP');
    for (const field of ['stock', 'avgCost', 'minStock']) number(ingredient[field], `Ingrediente: ${field}`);
    image(ingredient.image);
  }
  for (const product of state.products) {
    text(product.name, 'Nome do produto', 120, true);
    number(product.price, 'Preço do produto'); number(product.extraCost, 'Custo adicional');
    validateRecipe(product, state.ingredients);
    for (const row of product.recipe) number(row.quantity, 'Quantidade da ficha técnica', { positive: true });
  }
  for (const platform of state.platforms) {
    text(platform.name, 'Nome da plataforma', 100, true);
    for (const field of ['commission', 'paymentFee']) number(platform[field], `Plataforma: ${field}`, { max: 100 });
    for (const field of ['fixedFee', 'monthlyFee']) number(platform[field], `Plataforma: ${field}`);
    if (platform.commission + platform.paymentFee >= 100 || typeof platform.confirmed !== 'boolean') throw new DomainError('Backup inválido: taxas da plataforma.', 'INVALID_BACKUP');
    text(platform.notes, 'Observações da plataforma', 2000);
  }
  object(state.settings, 'Configurações do backup');
  for (const field of ['taxRate', 'targetMargin']) number(state.settings[field], `Configuração: ${field}`, { max: 100 });
  number(state.settings.monthlyFixedCosts, 'Custos fixos previstos');
  number(state.settings.expectedMonthlyOrders, 'Pedidos mensais previstos', { positive: true, integer: true });
  normalizeSettings(state.settings, state.settings);
  if (!state.meta || typeof state.meta.demoLoaded !== 'boolean') throw new DomainError('Backup inválido: metadados.', 'INVALID_BACKUP');
  for (const purchase of state.purchases) {
    const ingredient = ingredients.get(purchase.ingredientId);
    if (!ingredient || purchase.unit !== ingredient.unit || unitInfo(purchase.inputUnit).dimension !== ingredient.dimension) throw new DomainError('Backup inválido: ingrediente ou unidade de compra.', 'INVALID_BACKUP');
    number(purchase.quantity, 'Quantidade comprada', { positive: true });
    number(purchase.inputQuantity, 'Quantidade informada na compra', { positive: true });
    if (!closeEnough(quantityToBase(purchase.inputQuantity, purchase.inputUnit), purchase.quantity)) throw new DomainError('Backup inválido: conversão da compra.', 'INVALID_BACKUP');
    number(purchase.totalCost, 'Custo de compra'); validateDate(purchase.date);
    if (purchase.expiry !== null) validateDate(purchase.expiry, 'Validade');
    text(purchase.supplier, 'Fornecedor', 200); text(purchase.note, 'Observação da compra', 2000);
  }
  for (const sale of state.sales) {
    if (!platforms.has(sale.platformId) || !['active', 'canceled'].includes(sale.status) || typeof sale.platformConfirmed !== 'boolean') throw new DomainError('Backup inválido: plataforma ou situação da venda.', 'INVALID_BACKUP');
    validateDate(sale.date);
    text(sale.platformName, 'Plataforma da venda', 100, true); text(sale.note, 'Observação da venda', 2000);
    for (const field of ['subtotal', 'discount', 'revenue', 'fees', 'taxes', 'cogs', 'extraCosts', 'feeRate', 'fixedFee', 'taxRate', 'commissionFee', 'paymentFeeAmount', 'extraFee']) number(sale[field], `Venda: ${field}`);
    if (sale.feesOverride !== null) number(sale.feesOverride, 'Taxa efetiva da venda');
    if (!['pending', 'exempt', 'issued'].includes(sale.fiscalStatus)) throw new DomainError('Backup inválido: situação fiscal.', 'INVALID_BACKUP');
    text(sale.fiscalReference, 'Referência fiscal', 300);
    signed(sale.contribution, 'Contribuição da venda');
    if (!Array.isArray(sale.lines) || !sale.lines.length || sale.lines.length > 200 || !Array.isArray(sale.consumed) || sale.consumed.length > 1000) throw new DomainError('Backup inválido: itens da venda.', 'INVALID_BACKUP');
    for (const line of sale.lines) {
      if (!products.has(line.productId)) throw new DomainError('Backup inválido: produto da venda.', 'INVALID_BACKUP');
      text(line.productName, 'Nome histórico do produto', 120, true);
      number(line.quantity, 'Quantidade vendida', { positive: true, integer: true });
      for (const field of ['unitPrice', 'subtotal', 'cogs', 'extraCosts']) number(line[field], `Item da venda: ${field}`);
      if (!closeEnough(line.subtotal, line.quantity * line.unitPrice)) throw new DomainError('Backup inválido: subtotal do item.', 'INVALID_BACKUP');
      if (!Array.isArray(line.recipe) || !line.recipe.length || line.recipe.length > 200) throw new DomainError('Backup inválido: ficha técnica histórica.', 'INVALID_BACKUP');
      for (const row of line.recipe) {
        object(row, 'Ingrediente histórico');
        const ingredient = ingredients.get(row.ingredientId);
        if (!ingredient || row.unit !== ingredient.unit) throw new DomainError('Backup inválido: ingrediente histórico.', 'INVALID_BACKUP');
        number(row.quantity, 'Quantidade histórica', { positive: true }); number(row.unitCost, 'Custo histórico'); number(row.totalCost, 'Custo histórico total');
        if (!closeEnough(row.totalCost, row.quantity * row.unitCost)) throw new DomainError('Backup inválido: custo na ficha técnica histórica.', 'INVALID_BACKUP');
      }
      if (!closeEnough(line.cogs, line.recipe.reduce((sum, row) => sum + row.totalCost, 0) * line.quantity)) throw new DomainError('Backup inválido: CMV do item.', 'INVALID_BACKUP');
    }
    const consumedIds = new Set();
    for (const consumed of sale.consumed) {
      object(consumed, 'Consumo histórico');
      const ingredient = ingredients.get(consumed.ingredientId);
      if (!ingredient || consumed.unit !== ingredient.unit || consumedIds.has(consumed.ingredientId)) throw new DomainError('Backup inválido: consumo da venda.', 'INVALID_BACKUP');
      consumedIds.add(consumed.ingredientId);
      number(consumed.quantity, 'Consumo histórico', { positive: true }); number(consumed.unitCost, 'Custo do consumo'); number(consumed.totalCost, 'Custo total do consumo');
      if (!closeEnough(consumed.totalCost, consumed.quantity * consumed.unitCost)) throw new DomainError('Backup inválido: custo do consumo.', 'INVALID_BACKUP');
      const expected = sale.lines.reduce((sum, line) => sum + line.recipe.filter(row => row.ingredientId === consumed.ingredientId).reduce((total, row) => total + row.quantity * line.quantity, 0), 0);
      if (!closeEnough(consumed.quantity, expected)) throw new DomainError('Backup inválido: quantidade do consumo.', 'INVALID_BACKUP');
    }
    const recipeIngredientIds = new Set(sale.lines.flatMap(line => line.recipe.map(row => row.ingredientId)));
    if (recipeIngredientIds.size !== consumedIds.size || [...recipeIngredientIds].some(key => !consumedIds.has(key))) throw new DomainError('Backup inválido: consumo incompleto da venda.', 'INVALID_BACKUP');
    const sumLines = field => sale.lines.reduce((sum, line) => sum + line[field], 0);
    if (!closeEnough(sale.subtotal, sumLines('subtotal')) || sale.discount > sale.subtotal || !closeEnough(sale.revenue, sale.subtotal - sale.discount) ||
      !closeEnough(sale.cogs, sumLines('cogs')) || !closeEnough(sale.cogs, sale.consumed.reduce((sum, row) => sum + row.totalCost, 0)) ||
      !closeEnough(sale.extraCosts, sumLines('extraCosts')) ||
      !closeEnough(sale.commissionFee + sale.paymentFeeAmount, sale.revenue * sale.feeRate / 100) ||
      !closeEnough(sale.fees, sale.feesOverride ?? (sale.revenue * sale.feeRate / 100 + sale.fixedFee + sale.extraFee)) || !closeEnough(sale.taxes, sale.revenue * sale.taxRate / 100) ||
      !closeEnough(sale.contribution, sale.revenue - sale.fees - sale.taxes - sale.cogs - sale.extraCosts)) {
      throw new DomainError('Backup inválido: totais da venda.', 'INVALID_BACKUP');
    }
    if (sale.status === 'canceled') {
      if (typeof sale.canceledRestock !== 'boolean' || !sale.canceledAt || !Number.isFinite(Date.parse(sale.canceledAt))) throw new DomainError('Backup inválido: cancelamento.', 'INVALID_BACKUP');
      validateDate(sale.canceledDate, 'Data do cancelamento');
    }
  }
  const linkedMovements = new Set();
  const linkKey = (kind, referenceId, ingredientId) => `${kind}/${referenceId}/${ingredientId}`;
  const rememberLink = movement => {
    const key = linkKey(movement.kind, movement.referenceId, movement.ingredientId);
    if (linkedMovements.has(key)) throw new DomainError('Backup inválido: movimentação histórica duplicada.', 'INVALID_BACKUP');
    linkedMovements.add(key);
  };
  const matchesConsumption = (movement, sale, sign) => {
    const consumed = sale?.consumed.find(row => row.ingredientId === movement.ingredientId);
    return !!consumed && closeEnough(movement.quantity, sign * consumed.quantity) && closeEnough(movement.cost, consumed.totalCost);
  };
  for (const movement of state.movements) {
    const ingredient = ingredients.get(movement.ingredientId);
    const preparationLoss = movement.kind === 'loss' && movement.lossCategory === 'preparation' && movement.ingredientId === null && movement.unit === 'R$' && movement.quantity === 0 && movement.affectsStock === false;
    if ((!preparationLoss && (!ingredient || movement.unit !== ingredient.unit)) || !['purchase', 'sale', 'return', 'loss', 'gain'].includes(movement.kind) || typeof movement.affectsStock !== 'boolean') throw new DomainError('Backup inválido: movimentação.', 'INVALID_BACKUP');
    validateDate(movement.date); signed(movement.quantity, 'Quantidade movimentada');
    for (const field of ['cost', 'stockBefore', 'stockAfter']) number(movement[field], `Movimentação: ${field}`);
    if (movement.affectsStock && !closeEnough(movement.stockAfter - movement.stockBefore, movement.quantity)) throw new DomainError('Backup inválido: saldo da movimentação.', 'INVALID_BACKUP');
    if (!movement.affectsStock && !closeEnough(movement.stockAfter, movement.stockBefore)) throw new DomainError('Backup inválido: movimentação financeira alterou estoque.', 'INVALID_BACKUP');
    if (movement.lossCategory !== undefined && !preparationLoss) throw new DomainError('Backup inválido: categoria da perda.', 'INVALID_BACKUP');
    if (movement.kind === 'purchase') {
      const purchase = purchases.get(movement.referenceId);
      if (!purchase || !movement.affectsStock || movement.quantity <= 0 || purchase.ingredientId !== movement.ingredientId || purchase.date !== movement.date || !closeEnough(purchase.quantity, movement.quantity) || !closeEnough(purchase.totalCost, movement.cost)) throw new DomainError('Backup inválido: movimentação não corresponde à compra.', 'INVALID_BACKUP');
      rememberLink(movement);
    } else if (movement.kind === 'sale') {
      const sale = sales.get(movement.referenceId);
      if (!sale || !movement.affectsStock || movement.quantity >= 0 || movement.date !== sale.date || !matchesConsumption(movement, sale, -1)) throw new DomainError('Backup inválido: movimentação não corresponde ao consumo da venda.', 'INVALID_BACKUP');
      rememberLink(movement);
    } else if (movement.kind === 'return') {
      const sale = sales.get(movement.referenceId);
      if (!sale || sale.status !== 'canceled' || sale.canceledRestock !== true || !movement.affectsStock || movement.quantity <= 0 || movement.date !== sale.canceledDate || !matchesConsumption(movement, sale, 1)) throw new DomainError('Backup inválido: devolução não corresponde ao cancelamento.', 'INVALID_BACKUP');
      rememberLink(movement);
    } else if (movement.kind === 'gain') {
      if (!movement.affectsStock || movement.quantity <= 0 || movement.referenceId !== null) throw new DomainError('Backup inválido: entrada por ajuste.', 'INVALID_BACKUP');
    } else if (movement.affectsStock) {
      if (movement.quantity >= 0 || movement.referenceId !== null) throw new DomainError('Backup inválido: perda por ajuste.', 'INVALID_BACKUP');
    } else {
      const sale = sales.get(movement.referenceId);
      if (!sale || sale.status !== 'canceled' || sale.canceledRestock !== false || movement.date !== sale.canceledDate || (preparationLoss ? sale.extraCosts <= 0 || !closeEnough(movement.cost, sale.extraCosts) : movement.quantity >= 0 || !matchesConsumption(movement, sale, -1))) throw new DomainError('Backup inválido: perda não corresponde ao cancelamento.', 'INVALID_BACKUP');
      rememberLink(movement);
    }
    text(movement.reason, 'Motivo da movimentação', 2000);
  }
  for (const purchase of state.purchases) {
    if (!linkedMovements.has(linkKey('purchase', purchase.id, purchase.ingredientId))) throw new DomainError('Backup inválido: falta a movimentação da compra.', 'INVALID_BACKUP');
  }
  for (const sale of state.sales) {
    for (const consumed of sale.consumed) {
      if (!linkedMovements.has(linkKey('sale', sale.id, consumed.ingredientId))) throw new DomainError('Backup inválido: falta o consumo da venda no estoque.', 'INVALID_BACKUP');
      if (sale.status === 'canceled' && !linkedMovements.has(linkKey(sale.canceledRestock ? 'return' : 'loss', sale.id, consumed.ingredientId))) throw new DomainError('Backup inválido: falta a movimentação do cancelamento.', 'INVALID_BACKUP');
    }
    if (sale.status === 'canceled' && sale.canceledRestock === false && sale.extraCosts > 0 && !linkedMovements.has(linkKey('loss', sale.id, null))) throw new DomainError('Backup inválido: falta a perda do custo de preparo.', 'INVALID_BACKUP');
  }
  const balances = new Map(state.ingredients.map(ingredient => [ingredient.id, { stock: 0, value: 0 }]));
  for (const movement of state.movements) {
    if (!movement.affectsStock) continue;
    const balance = balances.get(movement.ingredientId);
    if (!closeEnough(balance.stock, movement.stockBefore)) throw new DomainError('Backup inválido: sequência do histórico de estoque.', 'INVALID_BACKUP');
    balance.stock += movement.quantity;
    balance.value += movement.quantity >= 0 ? movement.cost : -movement.cost;
  }
  for (const ingredient of state.ingredients) {
    const balance = balances.get(ingredient.id);
    if (!closeEnough(balance.stock, ingredient.stock) || !closeEnough(balance.value, ingredient.stock * ingredient.avgCost)) throw new DomainError('Backup inválido: saldo ou custo não confere com o histórico.', 'INVALID_BACKUP');
  }
  for (const expense of state.expenses) {
    validateDate(expense.date); number(expense.amount, 'Valor da despesa', { positive: true });
    text(expense.description, 'Descrição da despesa', 200, true); text(expense.category, 'Categoria', 100);
  }
  return state;
}

export class Store {
  constructor(dbPath) {
    if (typeof dbPath !== 'string' || !dbPath) throw new DomainError('Caminho do banco de dados inválido.');
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL);');
    this.readStatement = this.db.prepare('SELECT data FROM app_state WHERE id=1');
    this.writeStatement = this.db.prepare('UPDATE app_state SET data=? WHERE id=1');
    this.db.prepare('INSERT OR IGNORE INTO app_state (id,data) VALUES (1,?)').run(JSON.stringify(defaults()));
  }

  state() { return JSON.parse(this.readStatement.get().data); }

  _mutate(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.state();
      const result = callback(state);
      this.writeStatement.run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return copy(result);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createIngredient(body) { return this._mutate(state => recordIngredient(state, body)); }

  updateIngredient(ingredientId, body) {
    return this._mutate(state => {
      object(body, 'Ingrediente');
      const ingredient = find(state.ingredients, ingredientId, 'Ingrediente');
      for (const key of ['unit', 'dimension', 'stock', 'avgCost', 'quantity', 'totalCost']) {
        if (has(body, key)) throw new DomainError('Use uma compra ou ajuste para mudar o saldo e o custo; a unidade do ingrediente não pode ser alterada.', 'IMMUTABLE_STOCK');
      }
      if (has(body, 'name')) {
        const name = text(body.name, 'Nome do ingrediente', 120, true);
        uniqueName(state.ingredients, name, ingredient.id); ingredient.name = name;
      }
      if (has(body, 'minStock')) {
        const unit = body.minStockUnit ?? ingredient.unit;
        if (unitInfo(unit).dimension !== ingredient.dimension) throw new DomainError('A unidade do estoque mínimo é incompatível.', 'UNIT_MISMATCH');
        ingredient.minStock = quantityToBase(body.minStock, unit);
      }
      if (has(body, 'image')) ingredient.image = image(body.image);
      ingredient.updatedAt = timestamp();
      return ingredient;
    });
  }

  addPurchase(body) {
    return this._mutate(state => {
      object(body, 'Compra');
      return recordPurchase(state, find(state.ingredients, body.ingredientId, 'Ingrediente'), body);
    });
  }

  saveProduct(body, productId) {
    return this._mutate(state => {
      const old = productId ? find(state.products, productId, 'Produto') : null;
      const product = normalizeProduct(state, body, old);
      if (old) state.products[state.products.indexOf(old)] = product;
      else state.products.push(product);
      return product;
    });
  }

  savePlatform(body, platformId) {
    return this._mutate(state => {
      const old = platformId ? find(state.platforms, platformId, 'Plataforma') : null;
      const platform = normalizePlatform(state, body, old);
      if (old) state.platforms[state.platforms.indexOf(old)] = platform;
      else state.platforms.push(platform);
      return platform;
    });
  }

  updateSettings(body) { return this._mutate(state => state.settings = normalizeSettings(body, state.settings)); }

  addSale(body) {
    return this._mutate(state => {
      object(body, 'Venda');
      const platform = find(state.platforms, body.platformId, 'Plataforma');
      const date = validateDate(body.date || localDate());
      if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 200) throw new DomainError('Inclua entre 1 e 200 itens no pedido.');
      const consumed = new Map();
      const lines = body.lines.map(line => {
        object(line, 'Item da venda');
        const product = find(state.products, line.productId, 'Produto');
        const quantity = finiteNumber(line.quantity, 'Quantidade vendida', { positive: true, integer: true });
        const unitPrice = finiteNumber(line.unitPrice ?? product.price, 'Preço de venda');
        const recipe = validateRecipe(product, state.ingredients).map(({ ingredient, quantity: ingredientQuantity }) => {
          let consumption = consumed.get(ingredient.id);
          if (!consumption) {
            consumption = { ingredientId: ingredient.id, name: ingredient.name, quantity: 0, unit: ingredient.unit, unitCost: ingredient.avgCost, totalCost: 0 };
            consumed.set(ingredient.id, consumption);
          }
          consumption.quantity += ingredientQuantity * quantity;
          consumption.totalCost += ingredientQuantity * quantity * ingredient.avgCost;
          return { ingredientId: ingredient.id, name: ingredient.name, quantity: ingredientQuantity, unit: ingredient.unit, unitCost: ingredient.avgCost, totalCost: ingredientQuantity * ingredient.avgCost };
        });
        return {
          productId: product.id, productName: product.name, quantity, unitPrice,
          subtotal: finiteNumber(quantity * unitPrice, 'Subtotal do item'),
          cogs: finiteNumber(recipe.reduce((total, row) => total + row.totalCost, 0) * quantity, 'CMV do item'),
          extraCosts: finiteNumber(product.extraCost * quantity, 'Custos adicionais do item'), recipe,
        };
      });
      for (const consumption of consumed.values()) {
        const ingredient = find(state.ingredients, consumption.ingredientId, 'Ingrediente');
        finiteNumber(consumption.quantity, 'Consumo total', { positive: true });
        finiteNumber(consumption.totalCost, 'Custo total do consumo');
        if (exceedsStock(consumption.quantity, ingredient.stock)) throw new DomainError(`Estoque insuficiente de ${ingredient.name}: disponível ${ingredient.stock.toLocaleString('pt-BR')} ${ingredient.unit}, necessário ${consumption.quantity.toLocaleString('pt-BR')} ${ingredient.unit}.`, 'INSUFFICIENT_STOCK', 409);
      }
      const subtotal = finiteNumber(lines.reduce((total, line) => total + line.subtotal, 0), 'Subtotal do pedido');
      const discount = finiteNumber(body.discount ?? 0, 'Desconto', { max: subtotal });
      const revenue = subtotal - discount;
      const commissionFee = revenue * platform.commission / 100;
      const paymentFeeAmount = revenue * platform.paymentFee / 100;
      const extraFee = finiteNumber(body.extraFee ?? 0, 'Taxa ou subsídio adicional do pedido');
      const feesOverride = body.feesOverride === undefined || body.feesOverride === null || body.feesOverride === '' ? null : finiteNumber(body.feesOverride, 'Total efetivo de taxas do pedido');
      const fees = finiteNumber(feesOverride ?? (commissionFee + paymentFeeAmount + platform.fixedFee + extraFee), 'Taxas do pedido');
      const taxes = revenue * state.settings.taxRate / 100;
      const cogs = finiteNumber(lines.reduce((total, line) => total + line.cogs, 0), 'CMV do pedido');
      const extraCosts = finiteNumber(lines.reduce((total, line) => total + line.extraCosts, 0), 'Custos adicionais do pedido');
      const sale = {
        id: id(), date, platformId: platform.id, platformName: platform.name,
        platformConfirmed: platform.confirmed, lines, consumed: [...consumed.values()],
        subtotal, discount, revenue, commissionFee, paymentFeeAmount, fees, feesOverride, extraFee, taxes, cogs, extraCosts,
        feeRate: platform.commission + platform.paymentFee, fixedFee: platform.fixedFee, taxRate: state.settings.taxRate,
        contribution: finiteNumber(revenue - fees - taxes - cogs - extraCosts, 'Contribuição do pedido', { min: -1e12 }),
        note: text(body.note, 'Observação do pedido', 2000),
        fiscalStatus: body.fiscalStatus ?? 'pending', fiscalReference: text(body.fiscalReference, 'Referência fiscal', 300),
        status: 'active', createdAt: timestamp(),
      };
      if (!['pending', 'exempt', 'issued'].includes(sale.fiscalStatus)) throw new DomainError('Situação fiscal inválida.');
      for (const consumption of consumed.values()) {
        const ingredient = find(state.ingredients, consumption.ingredientId, 'Ingrediente');
        const stockBefore = ingredient.stock;
        ingredient.stock = Math.max(0, ingredient.stock - consumption.quantity);
        ingredient.updatedAt = timestamp();
        recordMovement(state, ingredient, { date, kind: 'sale', quantity: -consumption.quantity, cost: consumption.totalCost, referenceId: sale.id, reason: 'Consumo da ficha técnica na venda', stockBefore });
      }
      state.sales.push(sale);
      return sale;
    });
  }

  cancelSale(saleId, body) {
    return this._mutate(state => {
      object(body, 'Cancelamento');
      if (typeof body.restock !== 'boolean') throw new DomainError('Informe se os ingredientes devem retornar ao estoque.');
      const sale = find(state.sales, saleId, 'Venda');
      if (sale.status !== 'active') throw new DomainError('Esta venda já foi cancelada.', 'ALREADY_CANCELED', 409);
      const date = validateDate(body.date || localDate());
      for (const consumption of sale.consumed) {
        const ingredient = find(state.ingredients, consumption.ingredientId, 'Ingrediente');
        const stockBefore = ingredient.stock;
        if (body.restock) {
          const totalStock = finiteNumber(stockBefore + consumption.quantity, 'Saldo após devolução');
          ingredient.avgCost = (stockBefore * ingredient.avgCost + consumption.totalCost) / totalStock;
          ingredient.stock = totalStock;
          ingredient.updatedAt = timestamp();
          recordMovement(state, ingredient, { date, kind: 'return', quantity: consumption.quantity, cost: consumption.totalCost, referenceId: sale.id, reason: 'Cancelamento com devolução dos ingredientes', stockBefore });
        } else {
          recordMovement(state, ingredient, { date, kind: 'loss', quantity: -consumption.quantity, cost: consumption.totalCost, referenceId: sale.id, reason: 'Cancelamento sem devolução: baixa financeira, estoque já consumido', stockBefore, affectsStock: false });
        }
      }
      if (!body.restock && sale.extraCosts > 0) {
        state.movements.push({ id: id(), ingredientId: null, ingredientName: 'Custos adicionais de preparo', date, kind: 'loss', lossCategory: 'preparation', quantity: 0, unit: 'R$', cost: sale.extraCosts, referenceId: sale.id, reason: 'Preparo de pedido cancelado sem devolução', stockBefore: 0, stockAfter: 0, affectsStock: false, createdAt: timestamp() });
      }
      sale.status = 'canceled'; sale.canceledAt = timestamp(); sale.canceledDate = date; sale.canceledRestock = body.restock;
      return sale;
    });
  }

  updateSaleFiscal(saleId, body) {
    return this._mutate(state => {
      object(body, 'Registro fiscal');
      const sale = find(state.sales, saleId, 'Venda');
      const fiscalStatus = body.fiscalStatus ?? sale.fiscalStatus;
      if (!['pending', 'exempt', 'issued'].includes(fiscalStatus)) throw new DomainError('Situação fiscal inválida. Use pending, exempt ou issued.');
      const fiscalReference = text(body.fiscalReference ?? sale.fiscalReference, 'Referência fiscal', 300);
      sale.fiscalStatus = fiscalStatus;
      sale.fiscalReference = fiscalReference;
      sale.fiscalUpdatedAt = timestamp();
      return sale;
    });
  }

  addAdjustment(body) {
    return this._mutate(state => {
      object(body, 'Ajuste de estoque');
      const ingredient = find(state.ingredients, body.ingredientId, 'Ingrediente');
      const kind = body.kind;
      if (!['loss', 'gain', 'set'].includes(kind)) throw new DomainError('Tipo de ajuste inválido. Use loss, gain ou set.');
      if (unitInfo(body.unit).dimension !== ingredient.dimension) throw new DomainError('A unidade do ajuste é incompatível.', 'UNIT_MISMATCH');
      const inputQuantity = finiteNumber(body.quantity, 'Quantidade do ajuste', { positive: kind !== 'set' });
      const quantity = quantityToBase(inputQuantity, body.unit);
      const date = validateDate(body.date || localDate());
      const reason = text(body.reason, 'Motivo do ajuste', 2000, true);
      const stockBefore = ingredient.stock;
      const difference = kind === 'set' ? quantity - stockBefore : kind === 'loss' ? -quantity : quantity;
      if (difference === 0) throw new DomainError('O saldo informado já corresponde ao estoque atual.');
      if (difference < 0 && exceedsStock(-difference, stockBefore)) throw new DomainError(`Estoque insuficiente de ${ingredient.name} para registrar a perda.`, 'INSUFFICIENT_STOCK', 409);
      const unitCost = difference > 0 ? finiteNumber(body.unitCost ?? ingredient.avgCost, 'Custo por unidade base da entrada') : ingredient.avgCost;
      if (difference > 0) {
        ingredient.avgCost = finiteNumber((stockBefore * ingredient.avgCost + difference * unitCost) / (stockBefore + difference), 'Custo médio');
      }
      ingredient.stock = finiteNumber(Math.max(0, stockBefore + difference), 'Saldo após ajuste');
      ingredient.updatedAt = timestamp();
      return recordMovement(state, ingredient, { date, kind: difference > 0 ? 'gain' : 'loss', quantity: difference, cost: finiteNumber(Math.abs(difference) * unitCost, 'Custo do ajuste'), reason, stockBefore });
    });
  }

  addExpense(body) {
    return this._mutate(state => {
      object(body, 'Despesa');
      const expense = { id: id(), date: validateDate(body.date || localDate()), description: text(body.description, 'Descrição da despesa', 200, true), category: text(body.category ?? 'Geral', 'Categoria', 100), amount: finiteNumber(body.amount, 'Valor da despesa', { positive: true }), createdAt: timestamp() };
      state.expenses.push(expense);
      return expense;
    });
  }

  deleteExpense(expenseId) {
    return this._mutate(state => {
      const expense = find(state.expenses, expenseId, 'Despesa');
      state.expenses.splice(state.expenses.indexOf(expense), 1);
      return expense;
    });
  }

  exportData() { return { format: 'hamburgueria-gestor', version: 1, exportedAt: timestamp(), state: this.state() }; }

  restoreData(data) {
    object(data, 'Arquivo de backup');
    if (data.version !== 1 || (data.format !== undefined && data.format !== 'hamburgueria-gestor')) throw new DomainError('Formato ou versão do backup incompatível.', 'INVALID_BACKUP');
    const restored = copy(data.state);
    validateState(restored);
    return this._mutate(state => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, restored);
      return state;
    });
  }

  demo() {
    return this._mutate(state => {
      if (['ingredients', 'products', 'purchases', 'movements', 'sales', 'expenses'].some(key => state[key].length)) throw new DomainError('Os exemplos só podem ser carregados em uma base vazia.', 'DEMO_REQUIRES_EMPTY', 409);
      const catalog = [
        ['Carne bovina', 'kg', 5, 150, 1], ['Pão de hambúrguer', 'un', 20, 40, 5],
        ['Queijo muçarela', 'kg', 1, 35, .2], ['Tomate', 'kg', 1, 7, .2],
        ['Alface', 'g', 400, 6, 100], ['Molho da casa', 'l', 1, 16, .2],
        ['Embalagem individual', 'un', 20, 20, 5], ['Bacon', 'kg', 1, 28, .2],
      ];
      const entries = catalog.map(([name, unit, quantity, totalCost, minStock]) => recordIngredient(state, { name, unit, quantity, totalCost, minStock, supplier: 'Exemplo fictício', note: 'DADOS DE EXEMPLO: substitua pelos valores das suas compras reais.' }));
      const baseRecipe = [
        [0, 160, 'g'], [1, 1, 'un'], [2, 30, 'g'], [3, 30, 'g'],
        [4, 10, 'g'], [5, 20, 'ml'], [6, 1, 'un'],
      ].map(([index, quantity, unit]) => ({ ingredientId: entries[index].id, quantity, unit }));
      state.products.push(normalizeProduct(state, { name: 'Clássico da casa', price: 25, extraCost: .75, recipe: baseRecipe }));
      state.products.push(normalizeProduct(state, { name: 'Bacon da casa', price: 29, extraCost: .75, recipe: [...baseRecipe, { ingredientId: entries[7].id, quantity: 25, unit: 'g' }] }));
      state.meta.demoLoaded = true;
      return state;
    });
  }

  close() { this.db.close(); }
}
