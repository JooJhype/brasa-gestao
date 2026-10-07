import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.mjs';

test('HTTP pedidos: preparo, histórico, cancelamento, backup, CSRF e arquivos do painel', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'brasa-orders-http-'));
  const app = await startServer({ port: 0, dataDir });
  try {
    const get = async (route) => (await fetch(app.url + '/api/' + route)).json();
    let data = await get('state');
    const csrf = data.csrf;
    const post = async (route, body, token = csrf) => {
      const r = await fetch(app.url + '/api/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Brasa-Token': token },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    assert.equal((await fetch(app.url + '/orders.js')).status, 200);
    assert.equal((await post('orders', {}, 'invalid')).status, 403);
    const ingredient = (
      await post('ingredients/create', {
        name: 'Carne de teste',
        unit: 'kg',
        quantity: 2,
        totalCost: 80,
      })
    ).body.result;
    await post('products', {
      name: 'Hambúrguer de teste',
      price: 35,
      recipe: [{ ingredientId: ingredient.id, quantity: 100, unit: 'g' }],
    });
    data = await get('state');
    const product = data.state.products[0],
      stock = data.state.ingredients.map((i) => i.stock);
    const payload = {
      source: 'manual',
      platformId: data.state.platforms[0].id,
      fulfillment: 'takeout',
      customer: { name: 'Cliente fictício', phone: 'Telefone de teste' },
      payment: { method: 'Pix', prepaid: true },
      note: 'Atenção à observação',
      lines: [{ productId: product.id, quantity: 2, unitPrice: 35, note: 'Sem cebola' }],
    };
    const o = (await post('orders', payload)).body.result;
    assert.equal(o.status, 'new');
    assert.deepEqual(
      (await get('state')).state.ingredients.map((i) => i.stock),
      stock,
    );
    const start = await post('orders/transition', { id: o.id, status: 'preparing' });
    assert.equal(start.status, 200);
    data = await get('state');
    assert.equal(data.report.salesCount, 0);
    assert.equal(data.state.sales[0].status, 'pending');
    const consumed = data.state.ingredients.map((i) => i.stock);
    assert.equal((await post('orders/transition', { id: o.id, status: 'preparing' })).status, 200);
    assert.deepEqual(
      (await get('state')).state.ingredients.map((i) => i.stock),
      consumed,
    );
    const csv = await (await fetch(app.url + '/api/csv')).text();
    assert.doesNotMatch(csv, /"pending"/);
    assert.equal(
      (await post('orders/transition', { id: o.id, status: 'out_for_delivery' })).status,
      409,
    );
    await post('orders/transition', { id: o.id, status: 'ready' });
    await post('orders/transition', { id: o.id, status: 'completed' });
    data = await get('state');
    assert.equal(data.report.salesCount, 1);
    assert.equal(data.state.sales.length, 1);
    assert.equal(data.state.sales[0].revenue, 70);
    assert.deepEqual(
      data.state.ingredients.map((i) => i.stock),
      consumed,
    );
    const canceled = (await post('orders', payload)).body.result;
    await post('orders/transition', {
      id: canceled.id,
      status: 'canceled',
      reason: 'Cliente desistiu',
    });
    data = await get('state');
    assert.equal(data.report.canceledOrders, 1);
    assert.equal(data.state.sales.length, 1);
    assert.deepEqual(
      data.state.ingredients.map((i) => i.stock),
      consumed,
    );
    const exported = await get('export');
    assert.equal(exported.state.orders.length, 2);
    assert.equal((await post('restore', exported)).status, 200);
    assert.equal(
      (await post('products/delete', { id: product.id, confirmation: 'deletar' })).status,
      409,
    );
    const platformId = data.state.platforms[0].id;
    assert.equal(
      (
        await post('connections/save', {
          source: 'site',
          platformId,
          enabled: false,
          baseUrl: 'https://example.com/brasa',
          token: 'credencial-ficticia-http',
        })
      ).status,
      404,
    );
    const projection = await get('state');
    assert.equal(JSON.stringify(projection).includes('credencial-ficticia-http'), false);
    assert.equal(JSON.stringify(await get('export')).includes('credencial-ficticia-http'), false);
    assert.equal(existsSync(path.join(dataDir, 'connections.json')), false);
    const copies = readdirSync(path.join(dataDir, 'backups')).map((name) =>
      readFileSync(path.join(dataDir, 'backups', name), 'utf8'),
    );
    assert.equal(
      copies.some((raw) => raw.includes('credencial-ficticia-http')),
      false,
    );
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
