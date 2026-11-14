import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml' };
export function serve(port = Number(process.env.PORT || 5173)) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      const relative = path.slice(root.length);
      if (!path.startsWith(root + sep) || relative.startsWith('.git/') ||
        !(pathname === '/' || /^(?:\/dist\/|\/node_modules\/iapws-if97\/dist\/|\/styles.css$|\/index.html$)/.test(pathname))) {
        res.writeHead(404).end('Not found'); return;
      }
      if (!(await stat(path)).isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`pS choo choo → http://127.0.0.1:${server.address().port}`));
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) serve();
