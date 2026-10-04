import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizePatch } from './public/patches.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const userPath = path.join(root, 'data/user-presets.json');
const port = Number(process.env.PORT || 4317);
let writes = Promise.resolve();
async function userPresets() {
  try { return JSON.parse(await readFile(userPath, 'utf8')).map(normalizePatch); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (!['localhost', '127.0.0.1'].includes((req.headers.host || '').split(':')[0])) return reply(res, 403, { error: 'Host no permitido.' });
    if (url.pathname === '/api/presets' && req.method === 'GET') {
      await writes;
      const factory = JSON.parse(await readFile(path.join(root, 'data/presets.json'), 'utf8')).map(normalizePatch);
      const custom = await userPresets();
      return reply(res, 200, [...factory.filter(p => !custom.some(c => c.id === p.id)), ...custom]);
    }
    if (url.pathname === '/api/presets' && req.method === 'POST') {
      // Only JSON requests from this local origin may write the user's sound bank.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(res, 403, { error: 'Origen no permitido.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, { error: 'Se requiere JSON.' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 32768) return reply(res, 413, { error: 'El sonido es demasiado grande.' });
      }
      let patch;
      try { patch = normalizePatch(JSON.parse(body)); }
      catch { return reply(res, 400, { error: 'El sonido no contiene JSON válido.' }); }
      const task = writes.then(async () => {
        const bank = await userPresets();
        const next = [...bank.filter(p => p.id !== patch.id), patch];
        await mkdir(path.dirname(userPath), { recursive: true });
        await writeFile(`${userPath}.tmp`, JSON.stringify(next, null, 2) + '\n');
        await rename(`${userPath}.tmp`, userPath);
      });
      writes = task.catch(() => {});
      await task;
      return reply(res, 200, patch);
    }
    if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, { error: 'Método no permitido.' });
    const filename = path.resolve(publicRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!filename.startsWith(publicRoot + path.sep)) return reply(res, 403, { error: 'Ruta no permitida.' });
    const content = await readFile(filename);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filename)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    reply(res, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'No encontrado.' : 'No se pudo leer el banco de sonidos. Revisa el JSON del proyecto.' });
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado. Si MIDI Key ya está abierto, visita http://localhost:${port}.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`MIDI KEY listo en http://localhost:${server.address().port}`));
