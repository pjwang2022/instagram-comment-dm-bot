# Instagram Comment DM Bot

[繁體中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Self-hosted Instagram automation: when someone comments a keyword on your post, the bot replies publicly and sends them a private DM — running entirely on Cloudflare Workers.**

Built for a single admin managing their own Instagram Professional account. No third-party SaaS, no per-message fees: your Meta app, your Cloudflare account, your data.

## One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pjwang2022/instagram-comment-dm-bot)

Clicking the button will:

1. **Copy this repo** into your own GitHub (or GitLab) account.
2. **Provision the resources** in your Cloudflare account — the D1 database and the Queue (the free plan is enough; Queues has been available on the Workers Free plan since Feb 2026).
3. **Prompt you for the four secrets** listed in [`.dev.vars.example`](.dev.vars.example) (`INSTAGRAM_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_ACCOUNT_ACCESS_TOKEN`, `ADMIN_SESSION_SECRET`).
4. **Build & deploy**, and set up push-to-deploy: every push to your copy redeploys automatically.

After the first deploy, finish up in your own repo copy:

- Complete the [Meta side setup](#2-meta-side) (webhook subscription + access token). No config file editing needed — the app discovers your Instagram account automatically from the access token.
- Open `/admin` and [create your admin account](#3-create-the-admin-account) on the first-run setup page — do this right after deploying.

Prefer doing everything by hand? Follow the full [Quick Start](#quick-start) below.

## Features

- **Keyword automations per post** — `contains_any` / `exact_any` / `all_comments` matching with text normalization and exclusion rules.
- **Works with scheduled posts** — the Instagram API can't see unpublished posts, so you can pre-arm a "next post" automation (auto-binds the moment the post goes live, catching even the first comment) or set an account-wide default for all new posts.
- **One-time public reply + one DM** per commenter, with rotating public reply variants and an optional link button in the DM.
- **Story-reply automations** — reply to a story with a keyword and get an automatic DM (configured per story; automations auto-pause when the story expires after 24h).
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

- **Cloudflare account** (the free plan works — free-tier Queues allows 10,000 operations/day with 24h message retention, plenty for a personal account; upgrade to Workers Paid for heavy volume), with `wrangler` logged in (`npx wrangler login`).
- **Meta developer app** with the Instagram product, and an **Instagram Professional account** you manage.
- **Node.js 20+**.

## Quick Start

### 1. Cloudflare side

```bash
git clone https://github.com/pjwang2022/instagram-comment-dm-bot.git
cd instagram-comment-dm-bot
npm ci && npm ci --prefix admin

# Secrets (production). Each takes ~30s to propagate after `put`.
npx wrangler secret put INSTAGRAM_APP_SECRET
npx wrangler secret put WEBHOOK_VERIFY_TOKEN        # any random string; reused in step 2
npx wrangler secret put INSTAGRAM_ACCOUNT_ACCESS_TOKEN
npx wrangler secret put ADMIN_SESSION_SECRET     # 32+ random bytes

# Deploy — the first run auto-creates the D1 database and the Queue,
# builds the admin SPA, deploys the Worker, and applies migrations.
# No resource naming, no config editing.
npm run deploy
```

### 2. Meta side

1. In [Meta for Developers](https://developers.facebook.com/), create an app and add the **Instagram** product.
2. Obtain an access token for your Professional account with permissions to read comments, reply to comments, and send messages (e.g. `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` — confirm current names in Meta's docs), then store it as the `INSTAGRAM_ACCOUNT_ACCESS_TOKEN` secret. Use a **long-lived token** and note its expiry — the daily cron warns before it lapses.
3. Configure the webhook subscription:
   - Callback URL: `https://<your-domain>/api/webhooks/meta/instagram`
   - Verify token: the same value you stored as `WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **`comments`** field, and the **`messages`** field if you want story-reply automations (限時動態自動化).
4. **Switch the app to Live (published) mode** — in Development mode, webhooks only fire for users with a role on the app, so comments from strangers won't trigger anything. Publishing requires a public privacy policy URL — this app serves one at `https://<your-domain>/privacy` (the contact email shown is your admin account's email).
5. Full App Review / advanced access is NOT needed — that's only for serving other people's accounts; a self-hosted tool acting on your own authorized account works with standard access.

#### Extra setup for story-reply automations（限時動態自動化）

- The webhook subscription must include the **`messages`** field (only `reply_to.story` messages are processed; plain DMs are ignored).
- The access token needs the `instagram_business_manage_messages` permission.
- After configuring, verify end-to-end in production: reply to one of your stories with a keyword and confirm the automated DM arrives (Workers runtime restrictions do not reproduce under `wrangler dev` — see CLAUDE.md).

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

**Change password**: click your email in the dashboard header → Account settings. There is no forgot-password recovery — keep your password safe (if it is lost, you will need to redeploy and set everything up from scratch).

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

- [`docs/faq.md`](docs/faq.md) — FAQ: costs, compliance, feature boundaries, troubleshooting (Traditional Chinese).
- [`spec.md`](spec.md) — full technical spec: data model, APIs, matching rules, retry/circuit-breaker semantics (Traditional Chinese).
- [`CLAUDE.md`](CLAUDE.md) — setup steps and project rules for AI coding agents (Claude Code reads this automatically).

## Security Notes

All secrets live in Cloudflare Secrets (production) or `.dev.vars` (local, gitignored) — never in tracked files. `wrangler.jsonc` is tracked with defaults only; on your first deploy, wrangler writes your provisioned `database_id` back into it. If you contribute back, run `git update-index --skip-worktree wrangler.jsonc` first so that written-back ID never ends up in a commit.

## License

[MIT](LICENSE)
