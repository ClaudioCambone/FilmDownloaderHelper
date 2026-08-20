# Telegram Download Assistant (Local Polling)

A local Telegram bot that runs in polling mode (`getUpdates`) to search content from a configured source and add selected results to qBittorrent.

## Project Status

- Active runtime: local polling (`telegram-download-assistant`)
- Not using webhook mode
- Previous Cloudflare Worker/webhook setup is legacy (see `telegram-ai-bot`)

## What This Project Does

- Handles Telegram commands for movies and TV series search
- Shows inline buttons to add results directly to qBittorrent
- Supports search filters: `quality`, `language`, `season`, `episode`
- Restricts access with Telegram allowlists (`chat_id` and/or `username`)

## Requirements

1. Node.js 20+
2. qBittorrent installed with WebUI enabled
3. A Telegram bot token from BotFather

## Installation

1. Install dependencies

```powershell
npm install
```

2. Create your local environment file

```powershell
copy .env.example .env
```

3. Configure `.env` (see details below)

## Environment Variables

Required:

- `BOT_TOKEN`
- `QBIT_USERNAME`
- `QBIT_PASSWORD`

Common:

- `QBIT_URL` (default: `http://127.0.0.1:8080`)
- `MOVIES_PATH`
- `TV_PATH`
- `POLL_INTERVAL_MS`

Source API:

- `SOURCE_SEARCH_URL`
- `SOURCE_API_KEY` (optional if your endpoint is public)
- `SOURCE_AUTH_HEADER` (default: `Authorization`)
- `SOURCE_AUTH_PREFIX` (default: `Bearer`)
- `SOURCE_RESULT_LIMIT`
- `SOURCE_TIMEOUT_MS`
- `SOURCE_VERIFIED` (recommended: `true`)

Allowlist (optional but recommended):

- `TELEGRAM_ALLOWED_CHAT_IDS=154770509,123456789`
- `TELEGRAM_ALLOWED_USERNAMES=yourname,@friendname`

## TorrentClaw Token Example

If you use TorrentClaw as your source API:

```env
SOURCE_SEARCH_URL=https://torrentclaw.com/api/v1/search
SOURCE_API_KEY=your_torrentclaw_token_here
SOURCE_AUTH_HEADER=Authorization
SOURCE_AUTH_PREFIX=Bearer
SOURCE_VERIFIED=true
```

With this setup, requests are sent as:

- `Authorization: Bearer <token>`

If your source does not require authentication, leave `SOURCE_API_KEY` empty.

## Important: Disable Webhook

This project uses polling, so webhook must be disabled for the same bot token:

```powershell
$BOT_TOKEN="YOUR_BOT_TOKEN"
Invoke-RestMethod "https://api.telegram.org/bot$BOT_TOKEN/deleteWebhook"
```

## Run the Bot

Direct run:

```powershell
node index.js
```

Using helper scripts in this repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-manual.ps1
powershell -ExecutionPolicy Bypass -File .\stop-manual.ps1
```

## Telegram Commands

- `/start`
- `/help`
- `/status`
- `/addfilm <magnet/url>`
- `/addserie <magnet/url>`
- `/findfilm [quality] | [language] | <title>`
- `/findserie [quality] | [language] | <title> | [season] | [episode]`

TV series examples:

- `/findserie the office | 2`
- `/findserie the office | 2 | 5`
- `/findserie the office | season=2`
- `/findserie the office | stagione=2 | episode=5`

Rule:

- `episode` can only be used when `season` is provided.

## Security Notes (For Public Repositories)

1. Never commit `.env`
2. Keep secrets only in your local `.env`
3. Rotate any token that has ever been exposed in logs, chat, or commits
4. Do not publish runtime logs (`bot.log`)

This repo already includes:

- `.gitignore` entries for `.env`, `bot.log`, `bot.pid`, `node_modules`
- Sanitized `.env.example`
- Sensitive query parameter redaction in debug logs

## Troubleshooting

- Bot does not respond:
	- Check webhook is deleted
	- Ensure only one polling process is running
- `401` or `403` from source API:
	- Verify `SOURCE_API_KEY`, `SOURCE_AUTH_HEADER`, `SOURCE_AUTH_PREFIX`
- qBittorrent errors:
	- Verify WebUI is enabled and credentials match `.env`

## Legal

Use this project only for content you are legally allowed to manage/download.
