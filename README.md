# Telegram Download Assistant (Local Polling)

A local Telegram bot that runs in polling mode (`getUpdates`) to search content from a configured source and add selected results to qBittorrent.

## Project Status

- Active runtime: local polling (`telegram-download-assistant`)
- Not using webhook mode
- Previous Cloudflare Worker/webhook setup is legacy (see `telegram-ai-bot`)

## What This Project Does

- Handles Telegram commands for movies and TV series search
- Shows inline buttons to add results directly to qBittorrent
- Shows search results in pages of three with a repeatable `Mostra altri` button
- Supports search filters: `quality`, `language`, `season`, `episode`
- Restricts access with Telegram allowlists (`chat_id` and/or `username`)

## Project Structure

```text
index.js              Application entry point and polling orchestration
src/config.js         Environment loading and typed runtime configuration
src/logger.js         Structured logging and secret redaction helpers
src/qbit-client.js    qBittorrent WebUI client and torrent controls
start-manual.ps1      Manual background start
stop-manual.ps1       Manual stop
start-local-bot.ps1   Windows startup runner
```

## Requirements

1. Node.js 20+
2. qBittorrent installed with WebUI enabled
3. A Telegram bot token from BotFather

Docker is optional for local Node.js usage. Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin (Linux) is required for the containerized setup.

## Run With Docker Compose

Docker Compose runs the bot and qBittorrent together on any supported host operating system. Download and configuration data are stored in named Docker volumes, so host-specific Windows paths are not required.

1. Create and edit `.env` as described below.
2. Start the stack:

```bash
docker compose up -d --build
```

3. Open qBittorrent WebUI at `http://localhost:8080` and complete its first-run setup. Set the WebUI username and password to the values used in `.env` (`QBIT_USERNAME` and `QBIT_PASSWORD`).
4. Restart the bot after qBittorrent credentials are configured:

```bash
docker compose restart bot
```

Useful commands:

```bash
docker compose logs -f bot
docker compose logs -f qbittorrent
docker compose ps
docker compose down
```

The Docker setup stores downloads in the qBittorrent volume under `/downloads/movies` and `/downloads/tv`. The Compose file overrides `QBIT_URL`, `MOVIES_PATH`, and `TV_PATH` for the container network; do not use `127.0.0.1` for `QBIT_URL` inside the bot container.

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


Common:


Source API:


Gemini (optional):

- `GEMINI_API_KEY` (required for `/ask`)
- `GEMINI_MODEL` (default: `gemini-2.0-flash`)
- `GEMINI_TIMEOUT_MS` (default: `30000`)

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
npm run start:local
npm run stop:local
```

For a foreground process, use `npm start`.

Before opening a pull request, run:

```powershell
npm run check
```

## Telegram Commands

- `/start`
- `/help`
- `/ask <domanda>`
- `/stopask` (chiude la conversazione AI)
- `/status`
- `/stoppolling`
- `/addfilm <magnet/url>`
- `/addserie <magnet/url>`
- `/findfilm [quality] | [language] | <title>`
- `/findserie [quality] | [language] | <title> | [season] | [episode]`

After `/ask`, you can send follow-up messages without a command. Use `/stopask` to end the Gemini conversation.

TV series examples:

- `/findserie the office | 2`
- `/findserie the office | 2 | 5`
- `/findserie the office | season=2`
- `/findserie the office | stagione=2 | episode=5`

Movie search accepts titles with spaces directly:

- `/findfilm The Dark Knight`
- `/findfilm "Once Upon a Time in Hollywood"`
- `/findfilm quality=1080p | lang=ita | The Dark Knight`

Quotes are optional and are only useful for making a title visually clear. The bot sends the complete title text to the configured source API, so spaces are preserved.

Rule:

- `episode` can only be used when `season` is provided.
- Searches show three results at a time; press `Mostra altri` to load the next three when available.
- `/status` shows progress, downloaded/total size, speed and remaining time for each torrent.
- Each status entry has a `Pausa` or `Resume` button.
- `/stoppolling` stops the bot process; qBittorrent downloads already running are not stopped.

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
