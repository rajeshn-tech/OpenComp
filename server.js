/**
 * OpenComp - Hardened Local HTTP Server (Zero External Dependencies)
 * Binds strictly to 127.0.0.1 (loopback interface only) for 100% offline air-gapped security.
 * Eliminates file:// CORS script loading restrictions for ES modules.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOC_ROOT = path.resolve(__dirname);
const INFO_FILE = path.join(DOC_ROOT, '.server_info.json');

const HOST = '127.0.0.1';
let DEFAULT_PORT = parseInt(process.env.OPENCOMP_PORT || process.env.PORT || '8080', 10);

// Parse CLI arguments
const args = process.argv.slice(2);
let autoOpenBrowser = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    DEFAULT_PORT = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--open') {
    autoOpenBrowser = true;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.exr': 'image/x-exr',
  '.dpx': 'image/x-dpx',
  '.cube': 'text/plain; charset=utf-8',
  '.nk': 'text/plain; charset=utf-8',
  '.comp': 'application/json; charset=utf-8',
  '.opencomp': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function createOpenCompServer() {
  return http.createServer((req, res) => {
    // Only accept GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed');
      return;
    }

    // Health check endpoint for desktop launchers and test harnesses
    const urlParts = req.url.split('?');
    const pathname = urlParts[0];

    if (pathname === '/health' || pathname === '/api/health') {
      const payload = JSON.stringify({
        status: 'ok',
        app: 'OpenComp',
        version: '1.3.1',
        host: HOST,
        pid: process.pid,
        uptime: process.uptime()
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(payload);
      return;
    }

    let reqPath = pathname === '/' ? '/index.html' : pathname;

    // Decode URI component safely
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(reqPath);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request: Malformed URI');
      return;
    }

    // Reject explicit directory traversal attempts
    if (decodedPath.includes('..') || reqPath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Directory traversal blocked');
      return;
    }

    // Sanitize path to prevent directory traversal
    const safePath = path.normalize(decodedPath);
    const filePath = path.resolve(DOC_ROOT, '.' + safePath);

    // Enforce document root isolation
    if (!filePath.startsWith(DOC_ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Directory traversal blocked');
      return;
    }

    fs.stat(filePath, (statErr, stats) => {
      if (statErr || !stats) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${pathname}`);
        return;
      }

      let targetFile = filePath;
      if (stats.isDirectory()) {
        targetFile = path.join(filePath, 'index.html');
      }

      const ext = path.extname(targetFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const stream = fs.createReadStream(targetFile);
      stream.on('open', () => {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stats.isDirectory() ? fs.statSync(targetFile).size : stats.size,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff'
        });
        stream.pipe(res);
      });

      stream.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`500 Server Error: ${err.message}`);
        }
      });
    });
  });
}

function writeServerInfo(port) {
  try {
    const info = {
      host: HOST,
      port,
      url: `http://${HOST}:${port}/`,
      pid: process.pid,
      startTime: new Date().toISOString()
    };
    fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[WARN] Could not write server info file: ${err.message}`);
  }
}

function cleanupServerInfo() {
  try {
    if (fs.existsSync(INFO_FILE)) {
      fs.unlinkSync(INFO_FILE);
    }
  } catch {}
}

process.on('exit', cleanupServerInfo);
process.on('SIGINT', () => { cleanupServerInfo(); process.exit(0); });
process.on('SIGTERM', () => { cleanupServerInfo(); process.exit(0); });

// Check if an existing OpenComp server is already active on the port
async function checkExistingServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://${HOST}:${port}/health`, { timeout: 800 }, (res) => {
      if (res.statusCode === 200) {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data.app === 'OpenComp');
          } catch {
            resolve(false);
          }
        });
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startServer(startPort = DEFAULT_PORT) {
  // 1. Check if an existing OpenComp server is already listening
  const alreadyRunning = await checkExistingServer(startPort);
  if (alreadyRunning) {
    const url = `http://${HOST}:${startPort}/`;
    console.log('================================================================');
    console.log('   🎬 OpenComp - Professional VFX Compositing Workstation');
    console.log(`   ⚡ Server is ALREADY RUNNING and healthy at: ${url}`);
    console.log('================================================================');
    writeServerInfo(startPort);
    if (autoOpenBrowser) {
      const openCmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
      exec(openCmd, () => {});
    }
    return;
  }

  // 2. Try binding to startPort, fallback up to startPort + 20
  let currentPort = startPort;
  const maxPort = startPort + 20;

  function tryListen(port) {
    const srv = createOpenCompServer();

    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (port < maxPort) {
          console.log(`[INFO] Port ${port} is in use, trying port ${port + 1}...`);
          tryListen(port + 1);
        } else {
          console.error(`❌ [ERROR] All ports from ${startPort} to ${maxPort} are in use.`);
          process.exit(1);
        }
      } else {
        console.error(`❌ [ERROR] Server error: ${err.message}`);
        process.exit(1);
      }
    });

    srv.listen(port, HOST, () => {
      const url = `http://${HOST}:${port}/`;
      console.log('================================================================');
      console.log('   🎬 OpenComp - Professional VFX Compositing Workstation');
      console.log(`   🚀 Local server successfully bound to: ${url}`);
      console.log(`   🔒 Bound strictly to 127.0.0.1 (Loopback only - 100% Offline)`);
      console.log('================================================================');
      writeServerInfo(port);

      if (autoOpenBrowser) {
        const openCmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
        exec(openCmd, () => {});
      }
    });
  }

  tryListen(currentPort);
}

startServer();
