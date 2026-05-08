// One-shot export: load a markdown file's sidecar comments and emit md/json/csv.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function exportComments(mdPath, overridePath, format) {
  const cpath = overridePath ? resolve(overridePath) : mdPath + '.comments.json';
  if (!existsSync(cpath)) {
    process.stderr.write(`No comments file at ${cpath}\n`);
    process.exit(1);
  }
  const raw = readFileSync(cpath, 'utf8');
  const data = JSON.parse(raw);
  const comments = Array.isArray(data) ? data : (data.comments || []);

  format = (format || 'md').toLowerCase();
  if (format === 'json') return JSON.stringify({ source: data.source || mdPath, count: comments.length, comments }, null, 2) + '\n';
  if (format === 'csv') return toCsv(comments);
  return toMd(comments, mdPath);
}

function toMd(comments, source) {
  const lines = [
    `# Comments — ${source}`,
    `_Exported ${new Date().toISOString()}_`,
    `**${comments.length} comment${comments.length === 1 ? '' : 's'}**`,
    ''
  ];
  // Group by section
  const by = new Map();
  for (const c of comments) {
    const k = (c.section && c.section.title) || '(unsectioned)';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(c);
  }
  for (const [section, items] of by) {
    lines.push(`## ${section}`, '');
    for (const c of items) {
      lines.push(`### ${new Date(c.createdAt).toLocaleString()}`, '');
      lines.push('**Highlighted text:**', '');
      const quoteLines = (c.quote || '').split('\n').map(l => `> ${l}`);
      lines.push(...quoteLines, '');
      lines.push('**Comment:**', '');
      lines.push(c.body || c.comment || '', '');
      lines.push('---', '');
    }
  }
  return lines.join('\n');
}

function toCsv(comments) {
  const esc = (s) => {
    if (s == null) return '';
    const v = String(s).replace(/\r?\n/g, ' ');
    return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const rows = ['section,quote,comment,created_at'];
  for (const c of comments) {
    rows.push([
      esc((c.section && c.section.title) || ''),
      esc(c.quote || ''),
      esc(c.body || c.comment || ''),
      esc(c.createdAt || ''),
    ].join(','));
  }
  return rows.join('\n') + '\n';
}
