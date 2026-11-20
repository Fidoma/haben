<div align="center">
  <h1>Rotomail</h1>
  <p><em>A fast, self-hosted webmail UI for your own mail server — Bun + Hono + React, talking straight to IMAP/SMTP.</em></p>
</div>

Rotomail is a self-hosted web email client. It serves a modern React interface and a small
[Bun](https://bun.sh) + [Hono](https://hono.dev) API server that talks directly to your mail
server over **IMAP** (read) and **SMTP submission** (send). It is designed to run against
[mailcow](https://mailcow.email/) (Dovecot + Postfix), but works with any standard
IMAP/SMTP server.

There is no database and no separate user store: **your mail server is the source of truth
and the authentication backend.** You log in with your normal mail credentials, Rotomail
verifies them with an IMAP bind, and keeps them in an encrypted, http-only session cookie.

## Purpose & objective

- Give a mailcow instance a **faster, nicer webmail UI** than the bundled clients, while
  keeping the mail server itself authoritative.
- Stay **stateless and simple**: no Cloudflare runtime, no database, no message store — just
  IMAP/SMTP. Sessions are encrypted cookies; one warm IMAP connection is pooled per account.
- Be **easy to self-host**: a single container behind your own reverse proxy.

## Background

Rotomail began as a fork of Cloudflare's [`agentic-inbox`](https://github.com/cloudflare/agentic-inbox).
The React frontend is kept; the AI agent and MCP server were removed, and the Cloudflare
backend (Workers + Durable Object SQLite + R2 + Email Routing) was replaced with the Bun +
Hono IMAP/SMTP server. The frontend's `/api/v1` contract is preserved.

## Features

- **Folders** mapped from IMAP SPECIAL-USE (Inbox/Sent/Drafts/Archive/Trash/Junk) with unread counts
- **Read** — message list (threaded, newest-first), full message view, attachments
- **Flags** — read/unread (`\Seen`) and star (`\Flagged`)
- **Compose** — send, reply, reply-all, forward; a copy is filed in Sent
- **Drafts** — saved to the Drafts folder
- **Search** — IMAP SEARCH with Gmail-style operators (`from:`, `to:`, `subject:`, `is:unread`, `has:attachment`, `before:`/`after:`)
- **Conversation threading** — replies grouped in the reading panel and the folder list
- **Multi-account** — sign into several mail accounts and switch between them
- **Auth = your mail server** — login is an IMAP bind; credentials live only in a sealed cookie
- **Live-ish updates** via polling (no extra infrastructure)

## Architecture

```
Browser (React SPA, served by the server)
        │  /api/v1/...
        ▼
Bun + Hono server ──IMAP (993)──▶ Dovecot   (read, flags, folders, search, drafts)
                  └─SMTP (587)──▶ Postfix    (send; copy APPENDed to Sent)
```

- Sessions: credentials sealed in an http-only cookie (`iron-webcrypto`).
- One warm `ImapFlow` connection pooled per active account; opened lazily, reaped on idle.
- Message identity is `folder:uidvalidity:uid` (decoded on every request).

## Requirements

- A mail server with IMAP + SMTP submission (e.g. mailcow). 
- [Bun](https://bun.sh) (for local dev) or Docker (to run the container).

## Configuration

Copy `.env.example` to `.env` and fill it in. Key variables:

| Variable | Description | Default |
| --- | --- | --- |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` | IMAP server | — / `993` / `true` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | SMTP submission | `IMAP_HOST` / `587` / `false` |
| `MAIL_TLS_REJECT_UNAUTHORIZED` | Strict TLS (set `false` for self-signed) | `true` |
| `DOMAINS` | Domain(s) advertised to the UI | — |
| `SESSION_SECRET` | Cookie encryption key, ≥ 32 chars (`openssl rand -base64 32`) | — |
| `PORT` / `HOST` | Listen port / interface | `3000` / `0.0.0.0` |
| `COOKIE_SECURE` | `Secure` cookies (must be `false` over plain HTTP) | prod: `true` |

## Running

**Development** (frontend HMR + API server, with Vite proxying the API):

```bash
bun install
bun run dev          # then open http://localhost:5173/login
```

**Production (Docker):**

```bash
cp .env.example .env   # edit it
docker compose up -d --build
```

The container serves plain HTTP on `PORT`. **Terminate TLS at your own reverse proxy**
(Caddy/Traefik/nginx/mailcow's nginx) and keep `COOKIE_SECURE=true` in real deployments.

A prebuilt image is published to GitHub Container Registry on each release:

```bash
docker run -p 3000:3000 --env-file .env ghcr.io/<owner>/rotomail:latest
```

## Roadmap

- **Groupware (optional, behind a per-account toggle):** Contacts (CardDAV) then Calendar
  (CalDAV) against mailcow's SOGo, to make Rotomail a faster front-end for the same data.
  Mail-only stays the default.
- **Live updates** via IMAP IDLE → server-sent events (today the UI polls).

## License & attribution

Licensed under the **Apache License 2.0** — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

Rotomail is a derivative work of [`cloudflare/agentic-inbox`](https://github.com/cloudflare/agentic-inbox)
(Copyright © Cloudflare, Inc., Apache 2.0). Original Cloudflare copyright headers are retained;
modified and new files carry a Rotomic modification/copyright notice as required by the license.
