# Instagram Comment DM Bot

**English** | [繁體中文](README.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Self-hosted Instagram automation: when someone comments a keyword on your post, the bot replies publicly and sends them a private DM — running entirely on Cloudflare Workers.**

Built for a single admin managing their own Instagram Professional account. No third-party SaaS, no per-message fees: your Meta app, your Cloudflare account, your data.

## One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pjwang2022/instagram-comment-dm-bot)

Clicking the button will:

1. **Copy this repo** into your own GitHub (or GitLab) account.
2. **Provision the resources** in your Cloudflare account — the D1 database and the Queue (Queues requires the **Workers Paid** plan).
3. **Prompt you for the five secrets** listed in [`.dev.vars.example`](.dev.vars.example) (`META_APP_SECRET`, `META_VERIFY_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `ADMIN_SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`).
4. **Build & deploy**, and set up push-to-deploy: every push to your copy redeploys automatically.

After the first deploy, finish up in your own repo copy:

- Edit `wrangler.jsonc` → replace the `<TODO:...>` values (`INSTAGRAM_ACCOUNT_ID`, `APP_BASE_URL`, `ADMIN_EMAIL`) and push — it redeploys automatically.
- Complete the [Meta side setup](#2-meta-side) (webhook subscription + access token).
- Open `/admin` and [create your admin account](#3-create-the-admin-account) on the first-run setup page — do this right after deploying.

Prefer doing everything by hand? Follow the full [Quick Start](#quick-start) below.

## Features

- **Keyword automations per post** — `contains_any` / `exact_any` / `all_comments` matching with text normalization and exclusion rules.
- **One-time public reply + one DM** per commenter, with rotating public reply variants and an optional link button in the DM.
- **Idempotent by design** — webhook events and automation runs are deduplicated, so Meta's webhook retries never cause double replies.
- **Automatic retries with backoff** (30s / 2m / 10m) for transient Meta API failures; permanent errors (invalid token, permission, policy) stop immediately.
- **Circuit breaker & emergency stop** — repeated failures auto-disable an automation; a kill switch in the admin panel stops everything.
- **Admin dashboard** (React SPA at `/admin`) — login, post list & sync, automation editor, run history with per-attempt Meta API error details.
- **Security baked in** — HMAC webhook signature verification (constant-time), PBKDF2 password hashing, HttpOnly session cookies, CSRF protection, rate limiting, structured logs with secret masking.

## Architecture

```text
Instagram comment
      │  webhook (signed)
      ▼
Cloudflare Worker (Hono) ──▶ Cloudflare Queue ──▶ Consumer: match keywords
      │                                             ├─ public reply (Meta API)
      ▼                                             └─ private DM  (Meta API)
Cloudflare D1 (SQLite)  ◀── run history, API attempts, audit logs
      ▲
Cron triggers: daily media sync · token expiry check
```

Stack: Cloudflare Workers · Hono · D1 (Drizzle ORM) · Queues · Cron Triggers · React + Vite admin SPA.

## Prerequisites

- **Cloudflare account on the Workers Paid plan** (Queues requires it), with `wrangler` logged in (`npx wrangler login`).
- **Meta developer app** with the Instagram product, and an **Instagram Professional account** you manage.
- **Node.js 20+**.

## Quick Start

### 1. Cloudflare side

```bash
git clone https://github.com/pjwang2022/instagram-comment-dm-bot.git
cd instagram-comment-dm-bot
npm ci && npm ci --prefix admin

# Create Cloudflare resources
npx wrangler d1 create ig-comment-dm-db      # note the database_id it prints
npx wrangler queues create ig-comment-events

# Configure: edit wrangler.jsonc
#   → fill in database_id, INSTAGRAM_ACCOUNT_ID, APP_BASE_URL, ADMIN_EMAIL
# If you plan to contribute back, keep your personal values out of commits:
git update-index --skip-worktree wrangler.jsonc

# Secrets (production). Each takes ~30s to propagate after `put`.
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN        # any random string; reused in step 2
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN
npx wrangler secret put ADMIN_SESSION_SECRET     # 32+ random bytes
npx wrangler secret put TOKEN_ENCRYPTION_KEY     # 32+ random bytes

# Deploy (builds the admin SPA, applies D1 migrations, deploys the Worker)
npm run deploy
```

### 2. Meta side

1. In [Meta for Developers](https://developers.facebook.com/), create an app and add the **Instagram** product.
2. Obtain an access token for your Professional account with permissions to read comments, reply to comments, and send messages (e.g. `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` — confirm current names in Meta's docs), then store it as the `INSTAGRAM_ACCESS_TOKEN` secret. Use a **long-lived token** and note its expiry — the daily cron warns before it lapses.
3. Configure the webhook subscription:
   - Callback URL: `https://<your-domain>/api/webhooks/meta/instagram`
   - Verify token: the same value you stored as `META_VERIFY_TOKEN`
   - Subscribe to the **`comments`** field.
4. App Review requires a public privacy policy URL — this app serves one at `https://<your-domain>/privacy` (contact email comes from `ADMIN_EMAIL`).

### 3. Create the admin account

Open `https://<your-domain>/admin` **right after the first deploy**. While no admin account exists yet, the login page shows a one-time **first-run setup form**: enter an email and a password (12+ characters) and you are logged in immediately. The form permanently disappears once the account exists — no terminal needed.

> Do this promptly: until the account is created, anyone who discovers your freshly deployed URL could claim it first.

CLI fallback (e.g. if you prefer not to use the web form):

```bash
# Interactive: asks for email + password, writes admin-insert.sql
# (the password hash contains `$`, so always apply it with --file, never --command)
npm run create-admin
npx wrangler d1 execute DB --remote --file=admin-insert.sql && rm admin-insert.sql
```

### 4. Verify

```bash
npm run check-meta    # read-only health check: token validity, account, media
```

Then open `https://<your-domain>/admin`, log in, sync your posts, create an automation, and comment the keyword on the post from another account.

## Local Development

```bash
cp .dev.vars.example .dev.vars    # fill in dev secrets (gitignored)
npx wrangler d1 migrations apply ig-comment-dm-db --local
npm run dev                        # wrangler dev
npm run test                       # vitest (unit + integration)
npm run lint && npm run typecheck
```

Note: `wrangler dev` does not enforce every production Workers limit (e.g. the 100k-per-call PBKDF2 cap). Test auth flows against a deployed Worker before relying on them.

## Documentation

- [`spec.md`](spec.md) — full technical spec: data model, APIs, matching rules, retry/circuit-breaker semantics (Traditional Chinese).
- [`CLAUDE.md`](CLAUDE.md) — setup steps and project rules for AI coding agents (Claude Code reads this automatically).

## Security Notes

All secrets live in Cloudflare Secrets (production) or `.dev.vars` (local, gitignored) — never in tracked files. `wrangler.jsonc` is tracked with placeholder values only (the Deploy button needs it); if you contribute back, use `git update-index --skip-worktree wrangler.jsonc` so your personal deployment values never end up in a commit.

## License

[MIT](LICENSE)
