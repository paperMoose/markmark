# CLAUDE.md

Notes for any agent (Claude Code or otherwise) working in this repo, or working WITH this tool's output.

## Why this exists

markmark is a feedback-collection tool built for one specific job: **letting a human leave precise, anchored comments on a markdown prompt so an agent can read those comments back and revise the prompt.**

The pattern:

```
human review              markmark              agent revise
──────────────  →  ──────────────────  →  ────────────────────
opens prompt.md     comments save to        reads prompt.md
in markmark         prompt.md.comments.json + prompt.md.comments.json
highlights, types                            applies each comment
notes                                        commits the revised prompt
```

Other markdown comment tools (PDF review, GitHub PR threads, inline HTML comments) either don't preserve the source as plain markdown, or they lose the comments after merge. markmark keeps both — the prompt stays clean, and feedback lives in a sidecar JSON the agent can iterate over deterministically.

This is also useful for general markdown review (audit docs, RFCs, meeting notes), but the prompt-review loop is the primary workflow it was designed for.

## Repo layout

```
markmark/
  bin/markmark.js     CLI entry — arg parsing, port selection, browser open
  lib/server.js       Node http server — file IO, atomic comment saves
  lib/export.js       One-shot CLI export (md / json / csv)
  lib/template.html   Single-page viewer (vanilla JS + marked from CDN)
  package.json        npm metadata; published as `markmark-cli`
  README.md           User-facing docs
  CLAUDE.md           This file
  LICENSE             MIT
```

Zero runtime npm dependencies. Node ≥ 18. Markdown is rendered client-side via `marked` from jsDelivr (the only network call).

## If you're working ON this repo

- **No build step**, no bundler, no tests yet. Edit a file, run `node bin/markmark.js README.md`, reload the browser.
- The published name is `markmark-cli` (the unscoped name was taken on npm by an unrelated LSP). The installed binary is still `markmark`.
- Bump version in `package.json` for releases. Tag matches version.
- Publish flow:
  1. Edit, commit, push to `main`.
  2. Bump version in `package.json`.
  3. `git tag -a vX.Y.Z -m "..."` and push the tag.
  4. Publish: `secret-agent exec --env NPM_TOKEN -- bash -c 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc.publish && npm publish --userconfig .npmrc.publish --access public; rm -f .npmrc.publish'` (or your equivalent token-injection mechanism).
- The repo is public on GitHub: `paperMoose/markmark`.
- Don't introduce npm dependencies casually — the "zero deps" property is a load-bearing feature for `npx` startup speed and audit surface.

## If you're an agent CONSUMING markmark comments

You've been handed a markdown file and the path to its sidecar `.comments.json`. The schema:

```json
{
  "source": "prompt.md",
  "updatedAt": "2026-05-08T22:00:00.000Z",
  "comments": [
    {
      "id": "c8j3kl9m",
      "section": { "id": "rules", "title": "Rules" },
      "quote": "exact substring of the source markdown that was highlighted",
      "body": "the human's note about that quote",
      "createdAt": "2026-05-08T22:00:00.000Z"
    }
  ]
}
```

### Recommended workflow

1. **Read both files**: the markdown source and the comments JSON.
2. **For each comment**, locate `quote` verbatim in the source. The match should be unique — markmark anchors highlights to literal text. If a quote can't be found, the human edited the source after commenting; flag it (`anchored: false` in the export) and surface to the user rather than guessing.
3. **Apply `body` as a directive** scoped to the highlighted passage. Read it as feedback the human would give in a code review: "drop this", "tighten this", "this conflicts with X".
4. **Group by `section.title`** when summarizing or batching changes — it lets you keep edits cohesive.
5. **Sort by document order** before applying multi-edit operations, so earlier changes don't invalidate later quote matches. Walk top-down.
6. **Don't re-anchor by similarity.** If `quote` doesn't appear verbatim, ask the user — silent fuzzy-matching causes worse bugs than a clear "I couldn't find this".

### Reading comments programmatically

```js
import { readFile } from 'node:fs/promises';

const md = await readFile('prompt.md', 'utf8');
const data = JSON.parse(await readFile('prompt.md.comments.json', 'utf8'));

for (const c of data.comments) {
  const idx = md.indexOf(c.quote);
  if (idx === -1) {
    console.warn(`Quote not found, skipping: ${c.id}`);
    continue;
  }
  // Apply c.body to the passage at md[idx..idx+c.quote.length]
}
```

Or via the CLI's one-shot export:

```bash
markmark prompt.md --export json   # structured
markmark prompt.md --export md     # human-readable, grouped by section
```

### Anti-patterns

- **Don't edit the source file silently.** Show diffs or PR-style proposals. The human asked for feedback to be applied; they still want to see what changed.
- **Don't delete the `.comments.json` after applying.** It's the audit trail. Either leave it (so the next reviewer sees what was already addressed), or clear individual comments by writing back the file with those entries removed and an `appliedAt` timestamp added — your call, but be explicit.
- **Don't invent comments.** Only act on entries actually present in the JSON. If you think the prompt has problems beyond what's flagged, raise them separately, don't fold them into a "comment application" pass.

## Operating constraints

- **Network**: the viewer fetches `marked` from jsDelivr on first load. Everything else (saves, file listing) is local. If you're adding offline support, swap the script tag for a local copy of `marked.min.js` shipped in `lib/`.
- **Privacy**: the server binds to `127.0.0.1` by default. Don't change the default to `0.0.0.0` without an opt-in flag — the API has no auth.
- **Atomicity**: comment saves write to `<path>.tmp` then `rename()`. Preserve this; concurrent saves on a flaky filesystem will otherwise corrupt the JSON.
- **Highlight anchoring**: highlights re-attach across reloads by literal text search. If you change how marks are stored, keep the "anchor by exact quoted text" property — it's what makes the JSON portable to agents.
