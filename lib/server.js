// Tiny HTTP server with no deps. Serves the viewer HTML, the markdown content,
// and reads/writes a sidecar comments JSON file alongside the markdown source.

import { createServer } from 'node:http';
import { readFile, readdir, stat as fsstat, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, basename, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL as NodeURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_PATH = join(__dirname, 'template.html');
const VALID_MD_EXT = new Set(['.md', '.markdown']);

function commentsPathFor(mdPath, override) {
  if (override) return resolve(override);
  return mdPath + '.comments.json';
}

async function loadComments(commentsPath) {
  if (!existsSync(commentsPath)) return { source: null, comments: [] };
  try {
    const raw = await readFile(commentsPath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return { source: null, comments: data };
    return data;
  } catch (e) {
    console.error(`Could not parse comments file ${commentsPath}: ${e.message}`);
    return { source: null, comments: [] };
  }
}

async function saveComments(commentsPath, payload) {
  const tmp = commentsPath + '.tmp';
  await mkdir(dirname(commentsPath), { recursive: true });
  await writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await rename(tmp, commentsPath);
}

function safeJoin(root, rel) {
  // Prevent ../ escape attacks.
  const target = resolve(root, rel);
  const rRoot = resolve(root) + (resolve(root).endsWith('/') ? '' : '/');
  if (!(target + '/').startsWith(rRoot) && target !== resolve(root)) {
    return null;
  }
  return target;
}

async function listMdFiles(dir) {
  const out = [];
  async function walk(d, depth) {
    if (depth > 4) return; // hard limit
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile() && VALID_MD_EXT.has(extname(e.name).toLowerCase())) {
        try {
          const st = await fsstat(full);
          out.push({
            path: full,
            relPath: relative(dir, full),
            name: e.name,
            size: st.size,
            mtime: st.mtimeMs,
          });
        } catch {}
      }
    }
  }
  await walk(dir, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function startServer({ mode, target, commentsPathOverride, port, host }) {
  const template = await readFile(TEMPLATE_PATH, 'utf8');
  // In dir mode, root is the dir; current file is selected via ?path=
  // In file mode, root is the dir containing the file; current file is locked unless overridden.
  const root = mode === 'dir' ? target : dirname(target);
  const lockedFile = mode === 'file' ? target : null;

  const server = createServer(async (req, res) => {
    try {
      const u = new NodeURL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = u.pathname;

      // ---------------- HTML viewer ----------------
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(template);
        return;
      }

      // ---------------- API ----------------
      if (pathname === '/api/meta' && req.method === 'GET') {
        const file = resolveFile(u);
        const payload = {
          mode,
          rootDir: root,
          file: file ? {
            path: file,
            name: basename(file),
            relPath: relative(root, file),
            commentsPath: commentsPathFor(file, mode === 'file' ? commentsPathOverride : undefined),
          } : null,
          locked: !!lockedFile,
        };
        return sendJson(res, 200, payload);
      }

      if (pathname === '/api/files' && req.method === 'GET') {
        const files = await listMdFiles(root);
        return sendJson(res, 200, { rootDir: root, files: files.map(f => ({
          path: f.path,
          name: f.name,
          relPath: f.relPath,
          size: f.size,
          mtime: f.mtime,
        })) });
      }

      if (pathname === '/api/content' && req.method === 'GET') {
        const file = resolveFile(u);
        if (!file) return sendJson(res, 400, { error: 'no file selected' });
        if (!existsSync(file)) return sendJson(res, 404, { error: 'file not found' });
        const text = await readFile(file, 'utf8');
        return sendJson(res, 200, { path: file, content: text });
      }

      if (pathname === '/api/comments' && req.method === 'GET') {
        const file = resolveFile(u);
        if (!file) return sendJson(res, 400, { error: 'no file selected' });
        const cpath = commentsPathFor(file, mode === 'file' ? commentsPathOverride : undefined);
        const data = await loadComments(cpath);
        return sendJson(res, 200, { ...data, commentsPath: cpath });
      }

      if (pathname === '/api/comments' && req.method === 'PUT') {
        const file = resolveFile(u);
        if (!file) return sendJson(res, 400, { error: 'no file selected' });
        const body = await readBody(req);
        let payload;
        try { payload = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
        if (!Array.isArray(payload.comments)) {
          return sendJson(res, 400, { error: 'expected { comments: [...] }' });
        }
        const cpath = commentsPathFor(file, mode === 'file' ? commentsPathOverride : undefined);
        const out = {
          source: relative(root, file),
          updatedAt: new Date().toISOString(),
          comments: payload.comments,
        };
        await saveComments(cpath, out);
        return sendJson(res, 200, { ok: true, commentsPath: cpath, count: payload.comments.length });
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (e) {
      console.error('Server error:', e);
      try { sendJson(res, 500, { error: String(e.message || e) }); } catch {}
    }
  });

  function resolveFile(u) {
    if (lockedFile) return lockedFile;
    const rel = u.searchParams.get('path');
    if (!rel) {
      // Default: pick the most recently modified .md in root
      return null;
    }
    const abs = safeJoin(root, rel);
    if (!abs) return null;
    if (!VALID_MD_EXT.has(extname(abs).toLowerCase())) return null;
    return abs;
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  return {
    url: `http://${host}:${port}/`,
    close: () => new Promise((res) => server.close(() => res())),
  };
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
