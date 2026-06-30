import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from './lib/http-response.js';
import { handleResolve } from './routes/resolve.js';
import { handleStream } from './routes/stream.js';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const publicDir = join(rootDir, 'public');
const libDir = join(rootDir, 'src/lib');
const port = Number(process.env.PORT) || 8787;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function serveFile(baseDir, pathname, response) {
  const safePath = join(baseDir, pathname);
  if (!safePath.startsWith(baseDir) || !existsSync(safePath) || statSync(safePath).isDirectory()) {
    return false;
  }
  const type = mimeTypes[extname(safePath)] ?? 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': type });
  createReadStream(safePath).pipe(response);
  return true;
}

function serveStatic(pathname, response) {
  if (pathname === '/') {
    return serveFile(publicDir, 'index.html', response);
  }
  if (pathname.startsWith('/lib/')) {
    return serveFile(libDir, pathname.slice('/lib/'.length), response);
  }
  if (pathname.startsWith('/') && !pathname.startsWith('/api/')) {
    return serveFile(publicDir, pathname.slice(1), response);
  }
  return false;
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'POST' && url.pathname === '/api/resolve') {
    await handleResolve(request, response);
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/stream') {
    await handleStream(request, response, url);
    return;
  }

  if (request.method === 'GET' && serveStatic(url.pathname, response)) {
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}).listen(port, () => {
  process.stdout.write(`http://localhost:${port}\n`);
});
