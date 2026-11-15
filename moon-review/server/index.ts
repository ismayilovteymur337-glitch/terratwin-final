import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { moonAPI } from './api.ts';
import { loadServerEnv } from './env.ts';

loadServerEnv();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 5173);
const DIST_DIR = path.join(process.cwd(), 'dist');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.img': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.lbl': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const urlStr = req.url || '/';
  if (urlStr.startsWith('/api/moon')) {
    await moonAPI(req, res);
    return;
  }

  const parsed = new URL(urlStr, `http://${HOST}:${PORT}`);
  let relPath = decodeURIComponent(parsed.pathname);
  if (relPath === '/') relPath = '/index.html';

  const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidateDist = path.join(DIST_DIR, safeRel);
  const candidatePublic = path.join(PUBLIC_DIR, safeRel);

  const filePath =
    fs.existsSync(candidateDist) && fs.statSync(candidateDist).isFile()
      ? candidateDist
      : fs.existsSync(candidatePublic) && fs.statSync(candidatePublic).isFile()
        ? candidatePublic
        : path.join(DIST_DIR, 'index.html');

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`TERRATWIN Moon Intelligence Server running at http://${HOST}:${PORT}`);
});
