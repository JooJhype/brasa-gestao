import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startServer } from '../src/server.mjs';

const temporaryData = () => mkdtempSync(path.join(tmpdir(), 'brasa-lifecycle-'));
const getState = async instance => {
  const response = await fetch(`${instance.url}/api/state`);
  assert.equal(response.status, 200);
  return response.json();
};

test('importar o servidor não cria dados, listener HTTP ou handlers de sinais', () => {
  const directory = temporaryData();
  const dataDir = path.join(directory, 'not-created');
  try {
    const script = `
      const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
      await import(${JSON.stringify(new URL('../src/server.mjs', import.meta.url).href)});
      const after = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
      console.log(JSON.stringify({ before, after }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, BRASA_DATA_DIR: dataDir, BRASA_PORT: '0' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const { before, after } = JSON.parse(result.stdout.trim());
    assert.deepEqual(after, before);
    assert.equal(existsSync(dataDir), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('porta automática: operação completa persiste ao fechar e reabrir, com isolamento', async () => {
  const dataDir = temporaryData();
  const otherDataDir = temporaryData();
  let instance;
  let other;
  try {
    instance = await startServer({ port: 0, dataDir });
    other = await startServer({ port: 0, dataDir: otherDataDir });
    assert.ok(instance.port > 0);
    assert.notEqual(instance.port, other.port);
    assert.equal(instance.url, `http://127.0.0.1:${instance.port}`);
    const initial = await getState(instance);
    assert.equal(initial.state.ingredients.length, 0);
    assert.notEqual(initial.csrf, (await getState(other)).csrf);
    const post = async (route, body, origin = instance.url) => {
      const response = await fetch(`${instance.url}/api/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brasa-Token': initial.csrf, Origin: origin },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await post('settings', {}, 'https://invalid.example')).status, 403);
    const ingredient = await post('ingredients/create', { name: 'Queijo', unit: 'kg', quantity: 2, totalCost: 80 });
    assert.equal(ingredient.status, 200);
    const product = await post('products', {
      name: 'Hambúrguer', price: 20, extraCost: 1,
      recipe: [{ ingredientId: ingredient.body.result.id, quantity: 50, unit: 'g' }],
    });
    assert.equal(product.status, 200);
    const sale = await post('sales', {
      date: '2026-10-06', platformId: initial.state.platforms[0].id,
      lines: [{ productId: product.body.result.id, quantity: 2, unitPrice: 20 }],
    });
    assert.equal(sale.status, 200);
    assert.equal(sale.body.result.cogs, 4);
    assert.equal((await post('expenses', { date: '2026-10-06', description: 'Gás', category: 'Outros', amount: 10 })).status, 200);
    const response = await fetch(`${instance.url}/api/state?month=2026-10`);
    const before = await response.json();
    assert.equal(before.state.ingredients[0].stock, 1900);
    assert.equal(before.report.net, 24);
    assert.equal((await getState(other)).state.ingredients.length, 0);
    const oldUrl = instance.url;
    const close = instance.close();
    assert.strictEqual(instance.close(), close);
    await close;
    await instance.close();
    await assert.rejects(fetch(`${oldUrl}/api/health`, { signal: AbortSignal.timeout(1000) }));
    assert.equal(existsSync(path.join(dataDir, 'brasa.sqlite-wal')), false);
    instance = await startServer({ port: 0, dataDir });
    const after = await getState(instance);
    assert.deepEqual(after.state, before.state);
    assert.notEqual(after.csrf, initial.csrf);
  } finally {
    await instance?.close();
    await other?.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(otherDataDir, { recursive: true, force: true });
  }
});

test('porta ocupada rejeita a inicialização sem encerrar a outra instância nem deixar banco aberto', async () => {
  const ownerDataDir = temporaryData();
  const failedDataDir = temporaryData();
  let owner;
  let recovered;
  try {
    owner = await startServer({ port: 0, dataDir: ownerDataDir });
    await assert.rejects(startServer({ port: owner.port, dataDir: failedDataDir }), { code: 'EADDRINUSE' });
    assert.equal((await fetch(`${owner.url}/api/health`)).status, 200);
    assert.equal(existsSync(path.join(failedDataDir, 'brasa.sqlite-wal')), false);
    recovered = await startServer({ port: 0, dataDir: failedDataDir });
    assert.equal((await getState(recovered)).state.sales.length, 0);
  } finally {
    await owner?.close();
    await recovered?.close();
    rmSync(ownerDataDir, { recursive: true, force: true });
    rmSync(failedDataDir, { recursive: true, force: true });
  }
});

test('fechar encerra uma requisição incompleta sem manter processo ou SQLite pendentes', async () => {
  const dataDir = temporaryData();
  let instance;
  let socket;
  try {
    instance = await startServer({ port: 0, dataDir });
    const state = await getState(instance);
    socket = net.createConnection({ host: '127.0.0.1', port: instance.port });
    socket.on('error', () => {});
    socket.resume();
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write(`POST /api/settings HTTP/1.1\r\nHost: 127.0.0.1:${instance.port}\r\nContent-Type: application/json\r\nX-Brasa-Token: ${state.csrf}\r\nContent-Length: 1000\r\n\r\n{`);
    const closed = new Promise(resolve => socket.once('close', resolve));
    const timeout = setTimeout(() => assert.fail('A conexão incompleta não foi encerrada.'), 4000);
    try {
      await instance.close();
      await closed;
      assert.equal(existsSync(path.join(dataDir, 'brasa.sqlite-wal')), false);
    } finally { clearTimeout(timeout); }
  } finally {
    socket?.destroy();
    await instance?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
