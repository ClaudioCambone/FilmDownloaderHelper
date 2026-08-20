# Telegram Download Assistant (Polling, Local)

Bot Telegram locale in polling (`getUpdates`) per cercare contenuti da una sorgente configurata e inviare aggiunte a qBittorrent.

## Project Status

- Runtime attivo: locale (questo progetto)
- Modalita': polling, non webhook
- Configurazione Cloudflare Worker/Webhook: legacy (vedi progetto `telegram-ai-bot`)

## Features

- Comandi Telegram per ricerca film/serie
- Pulsanti inline per aggiunta rapida in qBittorrent
- Filtri ricerca per quality, lingua, season, episode
- Whitelist per `chat_id` e/o `username`

## Requirements

1. Node.js 20+
2. qBittorrent con WebUI abilitata
3. Token bot Telegram (BotFather)

## Quick Start

1. Crea il file di configurazione

```powershell
copy .env.example .env
```

2. Configura `.env`

- `BOT_TOKEN`
- `QBIT_USERNAME`
- `QBIT_PASSWORD`
- Opzionali whitelist:
	- `TELEGRAM_ALLOWED_CHAT_IDS=154770509,123456789`
	- `TELEGRAM_ALLOWED_USERNAMES=claudiocamb,@amico1`

3. Disabilita webhook (obbligatorio per polling)

```powershell
$BOT_TOKEN="IL_TUO_TOKEN"
Invoke-RestMethod "https://api.telegram.org/bot$BOT_TOKEN/deleteWebhook"
```

4. Avvia

```powershell
node index.js
```

## Telegram Commands

- `/start`
- `/help`
- `/status`
- `/addfilm <magnet/url>`
- `/addserie <magnet/url>`
- `/findfilm [quality] | [lingua] | <titolo>`
- `/findserie [quality] | [lingua] | <titolo> | [season] | [episode]`

Esempi serie:

- `/findserie the office | 2`
- `/findserie the office | 2 | 5`
- `/findserie the office | season=2`
- `/findserie the office | stagione=2 | episode=5`

Regola: `episode` richiede sempre `season`.

## Security Checklist (Before Publishing)

1. Non committare mai `.env`
2. Usa solo `.env.example` con placeholder
3. Ruota token/API key se sono stati esposti in chat, log o commit precedenti
4. Verifica che `bot.log` non venga pubblicato

Questo repository include gia:

- `.gitignore` con esclusione `.env`, `bot.log`, `bot.pid`, `node_modules`
- `.env.example` sanitizzato
- redazione dei query param sensibili nei log debug

## Legal Note

Usa il bot solo per contenuti che hai diritto di gestire/scaricare.
