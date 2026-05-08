# markmark

Read, highlight, and comment on Markdown files in your browser. Comments save to a sidecar JSON file you can commit, diff, share, or export. Zero npm dependencies.

```
✦ markmark
Browsing: /Users/you/notes
Local:    http://127.0.0.1:7331/
```

## Why

You opened a long markdown file. You want to mark it up like a PDF — highlight passages, attach comments, hand it off — but keep the whole thing in plain text and version control. `markmark` does that. Pop open any `.md` file or directory of `.md` files, drag-select text, type a comment, done. Comments live in `<file>.comments.json` next to the source.

## Install

```bash
npx markmark-cli path/to/file.md         # one-shot, no install
pnpm dlx markmark-cli path/to/file.md    # same, via pnpm
```

Or install globally:

```bash
npm i -g markmark-cli
markmark path/to/file.md
```

Note: the npm package is `markmark-cli` (the unqualified name was taken), but the executable it installs is just `markmark`.

## Usage

```bash
markmark <file.md>     # open one file; comments → <file>.md.comments.json
markmark <directory>   # browse all .md files in a directory
markmark               # browse the current working directory
```

### Flags

| Flag | What it does |
|---|---|
| `-p, --port <num>` | Port (default: first free from 7331+) |
| `-h, --host <host>` | Bind host (default: `127.0.0.1`) |
| `--no-open` | Don't auto-launch a browser |
| `--comments <path>` | Override the sidecar comments file (single-file mode) |
| `--export <fmt>` | One-shot: print comments as `md` / `json` / `csv` to stdout, then exit |
| `-v, --version` | Print version |
| `--help` | Show usage |

### Examples

```bash
# Open a single file and comment on it
markmark audit.md

# Browse a docs folder, switch files via the in-app picker (⌘P)
markmark ./docs

# Generate a markdown report of comments for review
markmark audit.md --export md > review.md

# Use a custom port if 7331 is taken
markmark audit.md --port 8080
```

## In the browser

- **Highlight** — select any text, click the floating "＋ Add comment" pill, type your note. The selection turns yellow; the comment appears in the right panel.
- **Click a highlight** — flashes the matching comment card in the right panel.
- **Click a comment's quoted text** — scrolls to the highlight in the document.
- **Edit** any comment in place via the Edit button on the card.
- **Search** (top bar or ⌘K) — debounced highlight-as-you-type.
- **Switch files** (top bar file name or ⌘P) — fuzzy-find any `.md` in the root directory.
- **Tables** — first column is sticky during horizontal scroll. Drag the right edge of any column header to resize. Double-click that edge to auto-fit. Toggle to **Cards** view per table for narrow widths.
- **Export** — `Export .md` writes a section-grouped report; `Export .json` writes structured data.
- **Theme** — ◐ button toggles dark mode.

## Where comments are saved

Comments save to a sidecar JSON file next to your markdown:

```
notes.md
notes.md.comments.json   ← created/updated automatically
```

Saves are atomic (`tmp` + `rename`) and happen ~250 ms after each change.

The file format:

```json
{
  "source": "notes.md",
  "updatedAt": "2026-05-08T22:00:00.000Z",
  "comments": [
    {
      "id": "c8j3kl9m",
      "section": { "id": "part-2-server-side-guards", "title": "Part 2 — Server-side guards" },
      "quote": "exact text that was highlighted",
      "body": "your comment",
      "createdAt": "2026-05-08T22:00:00.000Z"
    }
  ]
}
```

You can:

- **Commit it** — `git add notes.md.comments.json` keeps annotations in version control alongside the document.
- **Diff it** — see what comments changed in a PR.
- **Hand-edit it** — it's plain JSON.
- **Ignore it** — add `*.comments.json` to `.gitignore` if comments are personal.

Use `--comments path/to/file.json` to point markmark at a different sidecar (handy if you want one comments file per reviewer):

```bash
markmark audit.md --comments audit.ryan.json
markmark audit.md --comments audit.ada.json
```

## How highlights survive across sessions

Highlights are anchored to the exact text you selected. On reload, markmark walks the document looking for that text and re-wraps it. If the underlying markdown changes (someone edits the source), highlights for unchanged text still re-attach. Highlights whose anchor text disappeared show a small `⚠ unanchored` badge — the comment + quoted text are kept either way, so nothing is lost.

## Architecture

A handful of files, no runtime dependencies:

```
markmark/
  bin/markmark.js     — CLI: arg parsing, port selection, browser open
  lib/server.js       — Node http server, file IO, atomic saves
  lib/export.js       — One-shot CLI export (md / json / csv)
  lib/template.html   — Single-page viewer (vanilla JS, marked from CDN)
```

Markdown is rendered client-side via [marked](https://marked.js.org/) loaded from jsDelivr. If you need fully offline rendering, swap that script tag for a local copy of `marked.min.js` and you're done.

## Limits

- One markdown file open at a time per browser tab. Use multiple tabs / multiple ports for side-by-side review.
- Highlights inside live-edited markdown re-anchor on first match. If the same passage appears multiple times verbatim and order changes, the wrong one might be selected. Anchor text is generally unique enough that this hasn't been an issue in practice.
- The CDN dependency on `marked` means the first render needs internet access. After load, all interaction is local.

## License

MIT.
