#!/usr/bin/env node
// markmark — Read & comment on Markdown files in your browser.
//
//   markmark <file.md>     open one file (comments → <file>.comments.json)
//   markmark <directory>   browse all .md files in a directory
//   markmark               browse the current working directory
//   markmark --help        print usage
//
// Flags:
//   -p, --port <num>      port (default: first free port from 7331+)
//   -h, --host <host>     bind host (default: 127.0.0.1)
//   --no-open             don't auto-launch a browser
//   --comments <path>     override the sidecar comments file (single-file mode)
//   --export <fmt>        one-shot: print comments as md|json|csv to stdout, then exit
//   -v, --version

import { existsSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { exec } from 'node:child_process';
import { startServer } from '../lib/server.js';
import { exportComments } from '../lib/export.js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h' && args[i + 1] === undefined) { flags.help = true; }
  else if (a === '--help') flags.help = true;
  else if (a === '-v' || a === '--version') flags.version = true;
  else if (a === '--no-open') flags.noOpen = true;
  else if (a === '-p' || a === '--port') flags.port = parseInt(args[++i], 10);
  else if (a === '-h' || a === '--host') flags.host = args[++i];
  else if (a === '--comments') flags.commentsPath = args[++i];
  else if (a === '--export') flags.exportFormat = args[++i];
  else if (a.startsWith('-')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
  else positional.push(a);
}

if (flags.help) {
  printUsage();
  process.exit(0);
}
if (flags.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(`markmark ${pkg.version}`);
  process.exit(0);
}

const target = positional[0] ? resolve(process.cwd(), positional[0]) : process.cwd();

if (!existsSync(target)) {
  console.error(`Not found: ${target}`);
  process.exit(1);
}

const stat = statSync(target);
const mode = stat.isDirectory() ? 'dir' : 'file';

if (mode === 'file' && !target.toLowerCase().endsWith('.md') && !target.toLowerCase().endsWith('.markdown')) {
  console.error(`Refusing to load non-markdown file: ${target}`);
  console.error('markmark only opens .md / .markdown files.');
  process.exit(1);
}

// One-shot export mode — no server, no browser.
if (flags.exportFormat) {
  if (mode !== 'file') {
    console.error('--export requires a single file argument.');
    process.exit(2);
  }
  const out = exportComments(target, flags.commentsPath, flags.exportFormat);
  process.stdout.write(out);
  process.exit(0);
}

const port = flags.port || await findFreePort(7331);
const host = flags.host || '127.0.0.1';

const { url, close } = await startServer({
  mode,
  target,
  commentsPathOverride: flags.commentsPath,
  port,
  host,
});

console.log(`\n  ✦ markmark`);
console.log(`  ${mode === 'file' ? 'Viewing' : 'Browsing'}: ${target}`);
console.log(`  Local:    ${url}`);
console.log(`  Press Ctrl+C to stop.\n`);

if (!flags.noOpen) openBrowser(url);

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------- helpers ----------------

function printUsage() {
  console.log(`markmark — Read & comment on Markdown files in your browser.

Usage:
  markmark <file.md>     Open a single markdown file. Comments save to <file>.comments.json
  markmark <directory>   Browse all .md / .markdown files in a directory
  markmark               Browse the current working directory

Options:
  -p, --port <num>       Port to listen on (default: first free from 7331+)
  -h, --host <host>      Bind host (default: 127.0.0.1)
  --no-open              Don't auto-launch a browser
  --comments <path>      Override the sidecar comments file (single-file mode only)
  --export <fmt>         Print comments as md|json|csv to stdout, then exit
  -v, --version          Print version and exit
  --help                 Show this message

Examples:
  npx markmark audit.md
  npx markmark ./docs --port 8080
  npx markmark notes.md --export md > notes-comments.md
`);
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? `open ${shellQuote(url)}` :
    process.platform === 'win32' ? `start "" ${shellQuote(url)}` :
    `xdg-open ${shellQuote(url)}`;
  exec(cmd, (err) => {
    if (err) {
      console.error(`(could not auto-open browser: ${err.message})`);
      console.error(`Open this URL manually: ${url}`);
    }
  });
}

function shellQuote(s) { return `"${s.replace(/"/g, '\\"')}"`; }

async function findFreePort(start) {
  const { createServer } = await import('node:net');
  for (let p = start; p < start + 100; p++) {
    const ok = await new Promise((res) => {
      const srv = createServer();
      srv.once('error', () => { srv.close(); res(false); });
      srv.listen(p, '127.0.0.1', () => { srv.close(() => res(true)); });
    });
    if (ok) return p;
  }
  throw new Error('Could not find a free port near ' + start);
}
