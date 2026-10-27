/* =========================================================
   serve.mjs —— 零依赖静态服务器（H5 调试 + PWA/Service Worker 自检用）
   CLI：  node tools/serve.mjs [port]        默认 8123
   模块： import { startServer } from './serve.mjs'
         const s = await startServer(); ... await s.close();
   说明：Service Worker 只在 http(s) 下可用（localhost 算安全上下文），
        所以 file:// 打开时离线缓存会自动跳过 —— 要测 PWA 就用这个服务器。
   ========================================================= */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(here, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer({ port = 8123, host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || host}`);
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404');
        return;
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',           // 让浏览器每次回来问，方便看到更新
        'service-worker-allowed': '/',
        'content-length': body.length,
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('500 ' + e.message);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        origin: `http://${host}:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
        server,
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8123);
  const s = await startServer({ port });
  console.log(`\n24Game 已启动： ${s.origin}/index.html`);
  console.log('（Service Worker / 安装到桌面 需要 http(s)，这个地址正好满足）');
  console.log('按 Ctrl+C 结束\n');
}
