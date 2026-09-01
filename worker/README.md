# hpt-worker

Backend for Högpresterande Team: team setup, response storage, result
aggregation, and an Anthropic API proxy for the workshop generator.

> **Status: the source is not yet in this repo.** The deployed Worker at
> `hpt-worker.johan-parmler.workers.dev` is the only copy that exists. Step 1
> below is the whole point of this directory.

---

## 1. Pull the source out of Cloudflare

Two ways. The dashboard is quicker; the API is scriptable.

**Dashboard** — Workers & Pages → `hpt-worker` → Quick Edit → copy the source.

**API** — needs a token with `Workers Scripts: Read`:

```bash
curl -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/hpt-worker"
```

Merge what you get into `src/index.js`, which has the observed API contract
documented at the top and marked spots for each route. Don't deploy before
you've done this — the scaffold returns 501 for everything.

## 2. Back up the KV data

Code in version control with data in one un-backed-up place is only half the
problem solved. Cloudflare KV has no point-in-time restore.

```bash
npx wrangler kv key list --namespace-id=$KV_NAMESPACE_ID > kv-keys.json
```

Then fetch each key's value. Keys follow `hpt:<teamcode>:resp:<uid>`.

## 3. Fill in `wrangler.toml`

`account_id` and the KV namespace `id`. **Check what the deployed Worker calls
its KV binding** (`env.SOMETHING`) and make `binding` match, or the deploy will
lose access to all existing data.

## 4. Set the secret

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Never in `wrangler.toml` — that file is committed.

## 5. Deploy

```bash
npx wrangler deploy --env staging
```

Verify against staging, then `npx wrangler deploy` for production. Pushing to
`main` also deploys production via `.github/workflows/worker-deploy.yml`, which
needs `CLOUDFLARE_API_TOKEN` in repo secrets.

---

## Known issues to fix once the source is in

Found by probing the live Worker on 2026-09-01. `src/guard.js` has the pieces
ready; they're wired into `src/index.js` at the marked TODOs.

**`/ai` is an open proxy to the Anthropic account.** An empty POST from an
arbitrary Origin returns Anthropic's own validation error with a `request_id`,
which means the Worker attached the API key and Anthropic authenticated it.
The Worker URL is in the page source of three public pages, so anyone can spend
the budget. *Immediate mitigation, no deploy needed: set a spend limit on the
key in the Anthropic Console.* The fix is to gate `/ai` on the team PIN the
leader has already entered — a shared secret is useless here, because the
caller is a public page and anything it holds is readable in devtools.

**CORS was `*` on every route**, including `/save`, so any website could write
responses into any team code. `guard.js` replaces this with an origin
allowlist from `ALLOWED_ORIGINS`.

**No rate limiting.** Twelve rapid requests, twelve 200s. `guard.js` adds a
KV-backed fixed window. It's eventually consistent and will leak under a
concurrent burst — adequate against runaway loops and casual abuse, not against
a determined attacker. For a real limit use Cloudflare Rate Limiting rules,
which run at the edge before the Worker.

**Minimum-N is client-side only.** `HPT_enkat.html` and `HPT_resultat.html`
withhold results below 4 responses, but anyone can call `/results` directly and
read a 1-response team. Move the check server-side with `belowMinN()`.

**`/results` still returns `names`.** No client reads it any more, as of
2026-08-31. Stop returning it.

## Clearing old names

Responses saved before 2026-08-31 have a `name` field, and the results endpoint
still returns those names. Removing the field from new writes doesn't touch
what's already stored. Either strip `name` from existing values, or — since
this is pilot data — delete the affected keys and start clean rounds. Decide
before onboarding a real customer, not after.

## Team codes are a single global namespace

`san()` lowercases and slugifies, and there is no per-organisation scoping.
Two organisations that both create `ledningsgruppen` share one dataset. The
admin page now tells whoever creates a team to prefix the organisation name,
which is a convention, not a constraint — nothing enforces it.
