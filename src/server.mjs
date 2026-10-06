import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store } from './store.mjs';
import { recipeCost, suggestPrice, report } from './domain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.BRASA_DATA_DIR || path.join(root, 'data');
const port = Number(process.env.BRASA_PORT || 4310);
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
const store = new Store(path.join(dataDir, 'brasa.sqlite'));
const csrf = randomBytes(32).toString('hex');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const imageCache = new Map();
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'Cache-Control': 'no-store'
};
function json(res, data, status = 200, extra = {}) { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(data)); }
function error(message, status = 400) { return Object.assign(new Error(message), { status }); }
function exportWithImages() {
  const data = store.exportData();
  for (const ingredient of data.state.ingredients) {
    const image = ingredient.image;
    if (!image?.url || !/^\/uploads\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(image.url)) continue;
    const file = path.join(dataDir, 'uploads', path.basename(image.url));
    if (!existsSync(file)) continue;
    const mime = path.extname(file) === '.jpg' ? 'jpeg' : path.extname(file).slice(1);
    image.url = `data:image/${mime};base64,${readFileSync(file).toString('base64')}`;
  }
  return data;
}
function backup(always = false) {
  const name = always ? `antes-restauracao-${Date.now()}.json` : `automatico-${today()}.json`;
  const dest = path.join(dataDir, 'backups', name);
  if (!existsSync(dest)) writeFileSync(dest, JSON.stringify(exportWithImages(), null, 2), { flag: 'wx' });
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024 * 1024) throw error('Arquivo muito grande. O limite é 64 MB.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('Os dados enviados não são um JSON válido.'); }
}
function enriched(month) {
  const state = store.state();
  const costs = Object.fromEntries(state.products.map(p => [p.id, recipeCost(p, state.ingredients)]));
  const prices = Object.fromEntries(state.products.map(p => [p.id, Object.fromEntries(state.platforms.map(f => {
    try { return [f.id, suggestPrice(p, state.ingredients, f, state.settings)]; } catch (e) { return [f.id, { error: e.message }]; }
  }))]));
  return { state, costs, prices, report: report(state, month || today().slice(0, 7)), csrf };
}
function strip(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').slice(0, 500); }
async function images(q) {
  q = String(q || '').trim().slice(0, 90); if (q.length < 3) return [];
  if (imageCache.has(q)) return imageCache.get(q);
  const params = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '6', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '360', origin: '*' });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': 'BrasaGestao/1.0 (local inventory app; image attribution retained)' }, signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw error('A biblioteca de imagens está indisponível. Você pode enviar uma imagem.', 502);
  const data = await response.json();
  const result = Object.values(data.query?.pages || {}).map(p => {
    const info = p.imageinfo?.[0]; if (!info || !/\.(jpe?g|png|webp)$/i.test(new URL(info.url).pathname)) return null;
    const meta = info.extmetadata || {};
    return { url: info.thumburl || info.url, sourceUrl: info.descriptionurl, author: strip(meta.Artist?.value), license: strip(meta.LicenseShortName?.value), licenseUrl: meta.LicenseUrl?.value || '', title: strip(p.title.replace(/^File:/, '')) };
  }).filter(i => i?.license);
  if (imageCache.size > 150) imageCache.clear(); imageCache.set(q, result); return result;
}
function saveImage(data) {
  const match = String(data.dataUrl || '').match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw error('Envie uma imagem PNG, JPG, WebP ou GIF.');
  const buffer = Buffer.from(match[2], 'base64'); if (buffer.length > 4 * 1024 * 1024 || buffer.length < 12) throw error('A imagem deve ter até 4 MB.');
  const signatures = { png: buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpeg: buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255, webp: buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP', gif: /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)) };
  if (!signatures[match[1]]) throw error('O conteúdo do arquivo não corresponde ao formato da imagem.');
  const name = `${randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
  writeFileSync(path.join(dataDir, 'uploads', name), buffer, { flag: 'wx' });
  return { url: `/uploads/${name}`, sourceUrl: '', author: '', license: 'Imagem enviada por você', licenseUrl: '' };
}
function csv(state, month) {
  const lines = [['tipo','data','descrição','receita após desconto','taxas plataforma','impostos','CMV','custo extra','valor despesa ou perda','status']];
  for (const s of state.sales.filter(s => s.date.startsWith(month))) lines.push(['venda',s.date,s.note || s.id,s.revenue,s.fees,s.taxes,s.cogs,s.extraCosts,'',s.status]);
  for (const e of state.expenses.filter(e => e.date.startsWith(month))) lines.push(['despesa',e.date,e.description,'','','','', '',e.amount,'']);
  for (const m of state.movements.filter(m => m.kind === 'loss' && m.date.startsWith(month))) lines.push(['perda',m.date,m.note || m.reason || '', '', '', '', '', '',m.cost ?? m.totalCost ?? 0,'']);
  return '\ufeff' + lines.map(row => row.map(v => { let val = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? ''); if (/^[=+@-]/.test(val) && typeof v !== 'number') val = "'" + val; return '"' + val.replaceAll('"','""') + '"'; }).join(';')).join('\r\n');
}
const server = http.createServer(async (req, res) => {
  try {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) throw error('Acesso permitido somente neste computador.', 403);
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const month = url.searchParams.get('month') || today().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw error('Mês inválido.');
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, { app: 'brasa-gestao', version: '1.0.0' });
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, enriched(month));
    if (req.method === 'GET' && url.pathname === '/api/images') return json(res, { images: await images(url.searchParams.get('q')) });
    if (req.method === 'GET' && url.pathname === '/api/export') return json(res, exportWithImages(), 200, { 'Content-Disposition': `attachment; filename="brasa-backup-${today()}.json"` });
    if (req.method === 'GET' && url.pathname === '/api/csv') { res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="brasa-financeiro-${month}.csv"` }); return res.end(csv(store.state(), month)); }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (req.headers['x-brasa-token'] !== csrf) throw error('Atualize a página para continuar.', 403);
      if (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) throw error('Origem não autorizada.', 403);
      const payload = await body(req);
      if (url.pathname === '/api/upload') return json(res, saveImage(payload));
      const routes = {
        '/api/ingredients/create': () => store.createIngredient(payload), '/api/ingredients/update': () => store.updateIngredient(payload.id, payload),
        '/api/purchases': () => store.addPurchase(payload), '/api/products': () => store.saveProduct(payload, payload.id || undefined),
        '/api/platforms': () => store.savePlatform(payload, payload.id || undefined), '/api/settings': () => store.updateSettings(payload),
        '/api/sales': () => store.addSale(payload), '/api/sales/cancel': () => store.cancelSale(payload.id, payload),
        '/api/sales/fiscal': () => store.updateSaleFiscal(payload.id, payload),
        '/api/adjustments': () => store.addAdjustment(payload), '/api/expenses': () => store.addExpense(payload),
        '/api/expenses/delete': () => store.deleteExpense(payload.id), '/api/demo': () => store.demo(),
        '/api/restore': () => store.restoreData(payload)
      };
      if (!routes[url.pathname]) throw error('Ação não encontrada.', 404);
      backup(url.pathname === '/api/restore'); const result = routes[url.pathname](); return json(res, { result });
    }
    if (req.method !== 'GET') throw error('Ação não permitida.', 405);
    const staticFiles = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/guide.json': 'guide.json', '/favicon.svg': 'favicon.svg' };
    let dest;
    if (staticFiles[url.pathname]) dest = path.join(root, 'public', staticFiles[url.pathname]);
    else if (/^\/assets\/(fonts|brand)\/[A-Za-z0-9_-]+\.(ttf|woff2|png|webp|jpg)$/.test(url.pathname)) dest = path.join(root, 'public', url.pathname.slice(1));
    else if (/^\/uploads\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(url.pathname)) dest = path.join(dataDir, 'uploads', path.basename(url.pathname));
    else throw error('Página não encontrada.', 404);
    if (!existsSync(dest)) throw error('Arquivo não encontrado.', 404);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ttf':'font/ttf', '.woff2':'font/woff2' };
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mime[path.extname(dest)] || 'application/octet-stream' }); res.end(readFileSync(dest));
  } catch (e) { if (!res.headersSent) json(res, { error: e.status ? e.message : 'Não foi possível concluir. Confira os dados e tente novamente.' }, e.status || 500); if (!e.status) console.error(e); }
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `A porta ${port} está ocupada. Feche a outra instância ou defina BRASA_PORT.` : e); store.close(); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`Brasa Gestão pronto: http://127.0.0.1:${port}\nDados: ${dataDir}\nUse Ctrl+C para encerrar.`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.close(() => { store.close(); process.exit(0); }); });
