import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';

test('HTTP: proteção local, operação completa, fiscal e backup portátil com imagem', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = mkdtempSync(path.join(tmpdir(), 'brasa-http-test-'));
  let port;
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: root,
    env: { ...process.env, BRASA_PORT: '0', BRASA_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let baseUrl;
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Servidor não iniciou: ' + output)), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const address = output.match(/Brasa Gestão pronto: (http:\/\/127\.0\.0\.1:(\d+))/);
        if (address) {
          baseUrl = address[1];
          port = Number(address[2]);
          clearTimeout(timeout);
          resolve();
        }
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error('Servidor terminou: ' + code + ' ' + output));
      });
    });
    let response = await fetch(baseUrl + '/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    let payload = await (await fetch(baseUrl + '/api/state')).json();
    const token = payload.csrf;
    const post = async (route, data, headers = {}) => {
      const r = await fetch(baseUrl + '/api/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Brasa-Token': token, ...headers },
        body: JSON.stringify(data),
      });
      return { status: r.status, body: await r.json() };
    };
    response = await fetch(baseUrl + '/api/ingredients/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.equal((await post('settings', {}, { Origin: 'https://evil.example' })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/state',
          headers: { Host: `evil.example:${port}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(badHost, 403);
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xQAAAAASUVORK5CYII=';
    const img = (await post('upload', { dataUrl: png })).body;
    const item = (
      await post('ingredients/create', {
        name: 'Muçarela teste',
        unit: 'kg',
        quantity: 2,
        totalCost: 80,
        minStock: 0.2,
        image: img,
      })
    ).body.result;
    const burger = (
      await post('products', {
        name: 'Produto teste',
        price: 20,
        extraCost: 1,
        recipe: [{ ingredientId: item.id, quantity: 50, unit: 'g' }],
      })
    ).body.result;
    const sale = (
      await post('sales', {
        date: '2026-10-06',
        platformId: payload.state.platforms[0].id,
        lines: [{ productId: burger.id, quantity: 2, unitPrice: 20 }],
        discount: 2,
        feesOverride: 3,
      })
    ).body.result;
    assert.equal(sale.revenue, 38);
    assert.equal(sale.cogs, 4);
    assert.equal(sale.contribution, 29);
    assert.equal(
      (
        await post('expenses', {
          date: '2026-10-06',
          description: 'Despesa teste',
          category: 'Outros',
          amount: 10,
        })
      ).status,
      200,
    );
    payload = await (await fetch(baseUrl + '/api/state?month=2026-10')).json();
    assert.equal(payload.state.ingredients[0].stock, 1900);
    assert.equal(payload.report.net, 19);
    const beforeSale = structuredClone(payload.state.sales[0]);
    assert.equal(
      (
        await post('sales/fiscal', {
          id: sale.id,
          fiscalStatus: 'issued',
          fiscalReference: 'NFC-e teste',
        })
      ).status,
      200,
    );
    payload = await (await fetch(baseUrl + '/api/state?month=2026-10')).json();
    assert.equal(payload.state.sales[0].fiscalStatus, 'issued');
    assert.equal(payload.state.sales[0].cogs, beforeSale.cogs);
    assert.equal(
      (
        await post('sales', {
          date: '2026-10-06',
          platformId: payload.state.platforms[0].id,
          lines: [{ productId: burger.id, quantity: 100, unitPrice: 20 }],
        })
      ).status,
      409,
    );
    assert.equal(
      (await (await fetch(baseUrl + '/api/state')).json()).state.ingredients[0].stock,
      1900,
    );
    const backup = await (await fetch(baseUrl + '/api/export')).json();
    assert.match(backup.state.ingredients[0].image.url, /^data:image\/png;base64,/);
    assert.equal((await post('restore', backup)).status, 200);
    payload = await (await fetch(baseUrl + '/api/state')).json();
    assert.equal(payload.state.ingredients[0].image.url, png);
    const invalid = structuredClone(backup);
    invalid.state.platforms = [];
    assert.equal((await post('restore', invalid)).status, 400);
    response = await fetch(baseUrl + '/api/csv?month=2026-10');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Despesa teste/);
    assert.ok(existsSync(path.join(dataDir, 'backups')));
    assert.ok(
      readdirSync(path.join(dataDir, 'backups')).some((f) => f.startsWith('antes-restauracao-')),
    );
    assert.equal((await post('sales/cancel', { id: sale.id, restock: false })).status, 200);
    payload = await (await fetch(baseUrl + '/api/state?month=2026-10')).json();
    assert.equal(payload.report.net, -16);
    assert.equal(payload.report.losses, 6);
    assert.equal(payload.state.ingredients[0].stock, 1900);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
