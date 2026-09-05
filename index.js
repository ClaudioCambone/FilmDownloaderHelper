import { URLSearchParams } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "./src/config.js";
import {
  createLogger,
  headersToLogObject,
  redactQueryParamsForLog,
  serializeError,
} from "./src/logger.js";
import { createQbitClient } from "./src/qbit-client.js";

const {
  botToken: BOT_TOKEN,
  allowedChatIds: TELEGRAM_ALLOWED_CHAT_IDS,
  allowedUsernames: TELEGRAM_ALLOWED_USERNAMES,
  moviesPath: MOVIES_PATH,
  tvPath: TV_PATH,
  pollIntervalMs: POLL_INTERVAL_MS,
  sourceSearchUrl: SOURCE_SEARCH_URL,
  sourceApiKey: SOURCE_API_KEY,
  sourceAuthHeader: SOURCE_AUTH_HEADER,
  sourceAuthPrefix: SOURCE_AUTH_PREFIX,
  sourceTimeoutMs: SOURCE_TIMEOUT_MS,
  sourceResultLimit: SOURCE_RESULT_LIMIT,
  sourceForceAuth: SOURCE_FORCE_AUTH,
  sourceInclude: SOURCE_INCLUDE,
  sourceAvailability: SOURCE_AVAILABILITY,
  sourceSort: SOURCE_SORT,
  sourceVerified: SOURCE_VERIFIED,
  sourceApiKeyParam: SOURCE_API_KEY_PARAM,
  sourceSendApiKeyInQuery: SOURCE_SEND_API_KEY_IN_QUERY,
  sourceApiKeyHeader: SOURCE_API_KEY_HEADER,
  sourceSendXApiKeyHeader: SOURCE_SEND_X_API_KEY_HEADER,
  geminiApiKey: GEMINI_API_KEY,
  geminiModel: GEMINI_MODEL,
  geminiTimeoutMs: GEMINI_TIMEOUT_MS,
  actionTtlMs: ACTION_TTL_MS,
  actionMaxItems: ACTION_MAX_ITEMS,
  logLevel: LOG_LEVEL,
} = config;

const log = createLogger(LOG_LEVEL);
const qbitClient = createQbitClient({ config, log });

function summarizePayload(payload) {
  if (Array.isArray(payload)) {
    return {
      rootType: "array",
      length: payload.length,
      firstItemKeys: payload[0] && typeof payload[0] === "object" ? Object.keys(payload[0]).slice(0, 12) : [],
    };
  }

  if (payload && typeof payload === "object") {
    return {
      rootType: "object",
      topLevelKeys: Object.keys(payload).slice(0, 20),
      resultsLength: Array.isArray(payload.results) ? payload.results.length : null,
      dataLength: Array.isArray(payload.data) ? payload.data.length : null,
    };
  }

  return {
    rootType: typeof payload,
    valuePreview: String(payload).slice(0, 120),
  };
}

function buildAuthHeaders({ apiKey = "", authHeader = "Authorization", authPrefix = "Bearer " } = {}) {
  const headers = new Headers({
    accept: "application/json",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/Invoke-WebRequest",
  });
  if (apiKey) {
    headers.set(authHeader, `${authPrefix}${apiKey}`.trim());
    if (SOURCE_SEND_X_API_KEY_HEADER) {
      headers.set(SOURCE_API_KEY_HEADER, apiKey);
    }
  }
  return headers;
}

async function callJsonApi({
  baseUrl,
  method = "GET",
  query = {},
  headers = buildAuthHeaders({
    apiKey: process.env.SOURCE_API_KEY,
    authHeader: process.env.SOURCE_AUTH_HEADER || "Authorization",
    authPrefix: process.env.SOURCE_AUTH_PREFIX || "Bearer ",
  }),   
  timeoutMs = 10000,
  body,
  logLabel = "generic_api",
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const requestHeaders = new Headers(headers);
  const fetchOptions = {
    method,
    headers: requestHeaders,
    signal: controller.signal,
  };

  if (body !== undefined) {
    fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }
  }

  log("debug", `${logLabel}.request`, {
    method,
    finalUrl: url.toString(),
    timeoutMs,
  });

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    log("error", `${logLabel}.fetch_error`, {
      finalUrl: url.toString(),
      ...serializeError(err),
    });
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  log("debug", `${logLabel}.response`, {
    status: response.status,
    contentType: response.headers.get("content-type") || null,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  try {
    return await response.json();
  } catch (err) {
    log("error", `${logLabel}.invalid_json`, {
      finalUrl: url.toString(),
      ...serializeError(err),
    });
    throw new Error("The API did not return valid JSON.");
  }
}

async function callAuthorizedSearchApi({ baseUrl, apiKey, query, timeoutMs = 10000, logLabel = "authorized_search" }) {
  return callJsonApi({
    baseUrl,
    method: "GET",
    query,
    headers: buildAuthHeaders({ apiKey }),
    timeoutMs,
    logLabel,
  });
}

let pollingRunning = false;
const ACTION_STORE = new Map();
const PENDING_INPUTS = new Map();
const AI_CONVERSATIONS = new Map();

function gcActionStore() {
  const now = Date.now();
  for (const [token, action] of ACTION_STORE.entries()) {
    if (action.expiresAt <= now) {
      ACTION_STORE.delete(token);
    }
  }

  if (ACTION_STORE.size <= ACTION_MAX_ITEMS) {
    return;
  }

  const oldest = Array.from(ACTION_STORE.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
    .slice(0, ACTION_STORE.size - ACTION_MAX_ITEMS);

  for (const [token] of oldest) {
    ACTION_STORE.delete(token);
  }
}

function saveAddAction({ category, savePath, source, title }) {
  gcActionStore();
  const token = randomUUID().slice(0, 12);
  ACTION_STORE.set(token, {
    category,
    savePath,
    source,
    title,
    createdAt: Date.now(),
    expiresAt: Date.now() + ACTION_TTL_MS,
  });
  return token;
}

function consumeAddAction(token) {
  const action = ACTION_STORE.get(token);
  if (!action) {
    return null;
  }

  ACTION_STORE.delete(token);
  if (action.expiresAt <= Date.now()) {
    return null;
  }
  return action;
}

function saveTorrentAction({ action, hash, name }) {
  gcActionStore();
  const token = randomUUID().slice(0, 12);
  ACTION_STORE.set(token, {
    action,
    hash,
    name,
    createdAt: Date.now(),
    expiresAt: Date.now() + ACTION_TTL_MS,
  });
  return token;
}

function saveSearchAction({ queryText, kind, results, nextIndex }) {
  gcActionStore();
  const token = randomUUID().slice(0, 12);
  ACTION_STORE.set(token, {
    action: "more",
    queryText,
    kind,
    results,
    nextIndex,
    createdAt: Date.now(),
    expiresAt: Date.now() + ACTION_TTL_MS,
  });
  return token;
}

function saveSearchWizard({ queryText, kind }) {
  gcActionStore();
  const token = randomUUID().slice(0, 12);
  ACTION_STORE.set(token, {
    action: "search_wizard",
    queryText,
    kind,
    createdAt: Date.now(),
    expiresAt: Date.now() + ACTION_TTL_MS,
  });
  return token;
}

function getSearchWizard(token) {
  const action = ACTION_STORE.get(token);
  if (!action || action.action !== "search_wizard" || action.expiresAt <= Date.now()) {
    ACTION_STORE.delete(token);
    return null;
  }
  return action;
}

function takeSearchPage(token, pageSize = 3) {
  const action = ACTION_STORE.get(token);
  if (!action || action.action !== "more" || action.expiresAt <= Date.now()) {
    ACTION_STORE.delete(token);
    return null;
  }

  const results = action.results.slice(action.nextIndex, action.nextIndex + pageSize);
  action.nextIndex += results.length;
  const remainingResults = action.results.slice(action.nextIndex);
  const hasMore = remainingResults.length > 0;
  if (!hasMore) {
    ACTION_STORE.delete(token);
  }
  return { ...action, results, remainingResults, hasMore };
}

const qbitLogin = () => qbitClient.login();
const ensureCategory = (name, savePath) => qbitClient.ensureCategory(name, savePath);
const addTorrent = (options) => qbitClient.addTorrent(options);
const getTorrentsOverview = () => qbitClient.listTorrents();
const setTorrentPaused = (hash, paused) => qbitClient.setPaused(hash, paused);
const deleteTorrent = (hash, deleteFiles) => qbitClient.deleteTorrent(hash, deleteFiles);

function formatEta(seconds) {
  const eta = Number(seconds);
  if (!Number.isFinite(eta) || eta < 0 || eta >= 8640000) {
    return "n/d";
  }
  const days = Math.floor(eta / 86400);
  const hours = Math.floor((eta % 86400) / 3600);
  const minutes = Math.floor((eta % 3600) / 60);
  if (days) return `${days}g ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "n/d";
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value <= 0) return "0 MB/s";
  return `${(value / 1024 ** 2).toFixed(2)} MB/s`;
}

function formatTorrentStatus(torrent, index) {
  const progress = Number(torrent.progress || 0) * 100;
  const state = String(torrent.state || "unknown");
  const paused = state.includes("paused") || state === "stoppedDL" || state === "stoppedUP";
  const complete = progress >= 100;
  return [
    `${index + 1}. ${torrent.name || "Senza titolo"}`,
    `Stato: ${complete ? "Completato" : paused ? "In pausa" : state}`,
    `Avanzamento: ${progress.toFixed(1)}%`,
    `Spazio: ${formatBytes(torrent.downloaded)} / ${formatBytes(torrent.size)}`,
    `Velocita: ${formatSpeed(torrent.dlspeed)}`,
    `Tempo residuo: ${complete ? "Completato" : formatEta(torrent.eta)}`,
  ].join("\n");
}

async function sendStatus(chatId, torrents, replyToMessageId) {
  if (!torrents.length) {
    await sendMessage(chatId, "Nessun download presente.", replyToMessageId);
    return;
  }

  await sendMessage(chatId, `Download presenti: ${torrents.length}`, replyToMessageId);
  for (let index = 0; index < torrents.length; index += 1) {
    const torrent = torrents[index];
    const paused = String(torrent.state || "").includes("paused") || torrent.state === "stoppedDL" || torrent.state === "stoppedUP";
    const pauseResumeAction = paused ? "resume" : "pause";
    const pauseResumeLabel = paused ? "Resume" : "Pausa";
    const prToken = saveTorrentAction({ action: pauseResumeAction, hash: torrent.hash, name: torrent.name });
    const delToken = saveTorrentAction({ action: "delete", hash: torrent.hash, name: torrent.name });
    await sendMessage(
      chatId,
      formatTorrentStatus(torrent, index),
      replyToMessageId,
      {
        inline_keyboard: [[
          { text: pauseResumeLabel, callback_data: `torrent:${prToken}` },
          { text: "🗑️ Elimina", callback_data: `torrent:${delToken}` },
        ]],
      },
    );
  }
}

function isAllowedChat(chatId, username) {
  if (!TELEGRAM_ALLOWED_CHAT_IDS.size && !TELEGRAM_ALLOWED_USERNAMES.size) {
    return true;
  }

  if (TELEGRAM_ALLOWED_CHAT_IDS.has(String(chatId))) {
    return true;
  }

  const normalizedUsername = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (normalizedUsername && TELEGRAM_ALLOWED_USERNAMES.has(normalizedUsername)) {
    return true;
  }

  return false;
}

async function telegramApi(method, payload) {
  log("debug", "telegram.api.call", { method });
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    log("warn", "telegram.api.http_error", { method, status: res.status });
    throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`);
  }

  return res.json();
}

const BOT_COMMANDS = [
  { command: "start", description: "Avvia il bot" },
  { command: "help", description: "Mostra tutti i comandi" },
  { command: "ask", description: "Fai una domanda all'AI" },
  { command: "stopask", description: "Chiudi la conversazione AI" },
  { command: "status", description: "Mostra lo stato dei download" },
  { command: "addfilm", description: "Aggiunge un film da magnet o URL" },
  { command: "addserie", description: "Aggiunge una serie da magnet o URL" },
  { command: "findfilm", description: "Cerca un film" },
  { command: "findserie", description: "Cerca una serie TV" },
  { command: "stoppolling", description: "Arresta il polling locale" },
];

async function registerBotCommands() {
  await telegramApi("setMyCommands", { commands: BOT_COMMANDS });
  log("info", "telegram.commands.registered", { count: BOT_COMMANDS.length });
}

async function sendMessage(chatId, text, replyToMessageId, replyMarkup, parseMode) {
  log("debug", "telegram.message.send", { chatId, replyToMessageId: Boolean(replyToMessageId) });
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 3900),
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  if (replyToMessageId) {
    payload.reply_parameters = { message_id: replyToMessageId };
  }

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await telegramApi("sendMessage", payload);
}

async function requestManualInput(chatId, text, messageId, command, placeholder) {
  PENDING_INPUTS.set(String(chatId), { command });
  await sendMessage(chatId, text, messageId, {
    force_reply: true,
    input_field_placeholder: placeholder,
  });
}

async function sendMessageWithInlineButton(chatId, text, buttonText, callbackData, replyToMessageId) {
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 3900),
    reply_markup: {
      inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
    },
  };

  if (replyToMessageId) {
    payload.reply_parameters = { message_id: replyToMessageId };
  }

  await telegramApi("sendMessage", payload);
}

async function sendSearchWizardQuality(chatId, queryText, kind, replyToMessageId) {
  const token = saveSearchWizard({ queryText, kind });
  await sendMessage(chatId, "Scegli la qualità:", replyToMessageId, {
    inline_keyboard: [
      [
        { text: "480p", callback_data: `searchq:${token}:480p` },
        { text: "720p", callback_data: `searchq:${token}:720p` },
      ],
      [
        { text: "1080p", callback_data: `searchq:${token}:1080p` },
        { text: "2160p", callback_data: `searchq:${token}:2160p` },
      ],
      [{ text: "Qualsiasi qualità", callback_data: `searchq:${token}:any` }],
    ],
  });
}

async function sendSearchWizardLanguage(chatId, token, replyToMessageId) {
  await sendMessage(chatId, "Scegli la lingua:", replyToMessageId, {
    inline_keyboard: [[
      { text: "Italiano", callback_data: `searchl:${token}:ita` },
      { text: "Inglese", callback_data: `searchl:${token}:eng` },
      { text: "Originale", callback_data: `searchl:${token}:original` },
      { text: "Qualsiasi lingua", callback_data: `searchl:${token}:any` },
    ]],
  });
}

async function sendSeriesSeasonChoice(chatId, token, replyToMessageId) {
  await sendMessage(chatId, "Scegli una stagione oppure cerca in tutta la serie:", replyToMessageId, {
    inline_keyboard: [[
      { text: "Inserisci stagione", callback_data: `series:${token}:season` },
      { text: "Tutta la serie", callback_data: `series:${token}:all` },
    ]],
  });
}

async function sendSeriesEpisodeChoice(chatId, token, replyToMessageId) {
  await sendMessage(chatId, "Cerca tutta la stagione oppure un episodio:", replyToMessageId, {
    inline_keyboard: [[
      { text: "Tutta la stagione", callback_data: `series:${token}:seasonall` },
      { text: "Inserisci episodio", callback_data: `series:${token}:episode` },
    ]],
  });
}

async function runSeriesWizardSearch(chatId, token, replyToMessageId) {
  const wizard = getSearchWizard(token);
  if (!wizard) {
    await sendMessage(chatId, "Ricerca scaduta. Rifai /findserie.", replyToMessageId);
    return;
  }

  ACTION_STORE.delete(token);
  const matches = await searchSource({
    kind: "tv",
    title: wizard.queryText,
    lang: wizard.lang || "",
    season: wizard.season,
    episode: wizard.episode,
  });
  if (!matches.length) {
    await sendMessage(chatId, "Nessun risultato trovato per i criteri richiesti.", replyToMessageId);
    return;
  }
  await sendSearchPage(chatId, wizard.queryText, "serie", matches, replyToMessageId);
}

async function sendPhoto(chatId, photoUrl, caption, replyToMessageId, parseMode) {
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption.slice(0, 1000),
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  if (replyToMessageId) {
    payload.reply_parameters = { message_id: replyToMessageId };
  }

  await telegramApi("sendPhoto", payload);
}

async function sendPhotoWithInlineButton(chatId, photoUrl, caption, buttonText, callbackData, replyToMessageId, parseMode) {
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption.slice(0, 1000),
    reply_markup: {
      inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
    },
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  if (replyToMessageId) {
    payload.reply_parameters = { message_id: replyToMessageId };
  }

  await telegramApi("sendPhoto", payload);
}

async function answerCallbackQuery(callbackQueryId, text = "OK") {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

async function sendLongMessage(chatId, text, replyToMessageId) {
  const maxLen = 3900;
  if (text.length <= maxLen) {
    await sendMessage(chatId, text, replyToMessageId);
    return;
  }

  let chunk = "";
  const blocks = text.split("\n\n");
  for (const block of blocks) {
    const next = chunk ? `${chunk}\n\n${block}` : block;
    if (next.length <= maxLen) {
      chunk = next;
      continue;
    }

    if (chunk) {
      await sendMessage(chatId, chunk, replyToMessageId);
      chunk = "";
    }

    if (block.length <= maxLen) {
      chunk = block;
      continue;
    }

    for (let start = 0; start < block.length;) {
      let end = Math.min(start + maxLen, block.length);
      if (end < block.length) {
        const lastSpace = block.lastIndexOf(" ", end);
        if (lastSpace > start) {
          end = lastSpace;
        }
      }
      await sendMessage(chatId, block.slice(start, end), replyToMessageId);
      start = end;
      while (block[start] === " ") {
        start += 1;
      }
    }
  }

  if (chunk) {
    await sendMessage(chatId, chunk, replyToMessageId);
  }
}

function parseAddCommand(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  return parts.slice(1).join(" ").trim();
}

function isValidTorrentSource(value) {
  return value.startsWith("magnet:?") || value.startsWith("http://") || value.startsWith("https://");
}

function parseFindCommand(text) {
  const match = text.match(/^\/\S+\s+([\s\S]+)$/);
  if (!match) {
    return null;
  }

  let payload = match[1].trim();
  if (!payload) {
    return null;
  }

  const allowedQualities = new Set(["480p", "720p", "1080p", "2160p"]);
  let quality = "";
  let lang = "";
  const explicitFilters = [];
  payload = payload.replace(/(?:quality|qualita|q)\s*[:=]\s*(480p|720p|1080p|2160p)\b/gi, (_, value) => {
    quality = value.toLowerCase();
    explicitFilters.push("quality");
    return "";
  });
  payload = payload.replace(/(?:lang|language|lingua)\s*[:=]\s*([^|\s]+)\b/gi, (_, value) => {
    lang = value.trim();
    explicitFilters.push("lang");
    return "";
  });

  const parts = payload
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  if (!explicitFilters.length && parts.length === 1) {
    const words = parts[0].split(/\s+/);
    const languageCodes = new Set(["it", "ita", "italian", "en", "eng", "english", "fr", "fra", "de", "ger", "es", "spa"]);
    if (allowedQualities.has(words[0].toLowerCase())) {
      quality = words.shift().toLowerCase();
    }
    if (words.length && languageCodes.has(words[0].toLowerCase())) {
      lang = words.shift();
    }
    if (quality || lang) {
      const title = words.join(" ").replace(/^(["'])(.*)\1$/, "$2").trim();
      return title ? { quality, lang, title } : null;
    }
  }

  if (!quality && !lang && parts.length === 1) {
    return { quality: "", lang: "", title: parts[0].replace(/^(["'])(.*)\1$/, "$2").trim() };
  }

  if (!explicitFilters.length && parts.length === 2) {
    const first = parts[0].toLowerCase();
    const second = parts[1];
    if (!second) {
      return null;
    }

    if (allowedQualities.has(first)) {
      return { quality: first, lang: "", title: second };
    }

    return { quality: "", lang: parts[0], title: second };
  }

  if (!explicitFilters.length) {
    quality = parts[0].toLowerCase();
    lang = parts[1];
  }

  let titleParts = explicitFilters.length ? parts : parts.slice(2);
  if (explicitFilters.length && quality && !lang && parts.length >= 2) {
    lang = parts[0];
    titleParts = parts.slice(1);
  }
  const title = titleParts.join(" | ").replace(/^(["'])(.*)\1$/, "$2").trim();
  if ((quality && !allowedQualities.has(quality)) || !title) {
    return null;
  }

  return { quality, lang, title };
}

function parseSeriesFindCommand(text) {
  const firstSpace = text.indexOf(" ");
  if (firstSpace === -1) {
    return null;
  }

  const payload = text.slice(firstSpace + 1).trim();
  if (!payload) {
    return null;
  }

  const rawParts = payload
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!rawParts.length) {
    return null;
  }

  let season = null;
  let episode = null;
  const parts = [...rawParts];
  const isIntToken = (value) => /^\d+$/.test(value);

  const extracted = [];
  for (const token of parts) {
    const seasonMatch = token.match(/^(season|stagione|s)\s*[:=]\s*(\d+)$/i);
    if (seasonMatch) {
      season = Number(seasonMatch[2]);
      extracted.push(token);
      continue;
    }

    const episodeMatch = token.match(/^(episode|episodio|ep|e)\s*[:=]\s*(\d+)$/i);
    if (episodeMatch) {
      episode = Number(episodeMatch[2]);
      extracted.push(token);
    }
  }

  if (extracted.length) {
    for (const token of extracted) {
      const idx = parts.indexOf(token);
      if (idx !== -1) {
        parts.splice(idx, 1);
      }
    }
  }

  if (season === null && episode === null && parts.length >= 2 && isIntToken(parts[parts.length - 1]) && isIntToken(parts[parts.length - 2])) {
    season = Number(parts[parts.length - 2]);
    episode = Number(parts[parts.length - 1]);
    parts.splice(parts.length - 2, 2);
  } else if (season === null && episode === null && parts.length >= 2 && isIntToken(parts[parts.length - 1])) {
    season = Number(parts[parts.length - 1]);
    parts.splice(parts.length - 1, 1);
  }

  if ((season !== null && season < 1) || (episode !== null && episode < 1)) {
    return { error: "Season/episode devono essere interi >= 1." };
  }

  if (episode !== null && season === null) {
    return { error: "Episode richiede sempre season." };
  }

  if (!parts.length || parts.length > 3) {
    return null;
  }

  const reconstructed = `/findserie ${parts.join(" | ")}`;
  const base = parseFindCommand(reconstructed);
  if (!base) {
    return null;
  }

  return {
    ...base,
    season,
    episode,
  };
}

function normalizeSourceItems(raw) {
  const list = Array.isArray(raw?.results)
    ? raw.results
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw)
        ? raw
        : [];

  return list
    .map((item) => ({
      title: item?.title || item?.name || item?.filename || "Senza titolo",
      lang: String(item?.lang || item?.language || item?.audio || "").toLowerCase(),
      source: item?.magnet || item?.url || item?.download || item?.torrent,
      seeds: Number(item?.seeds || 0),
    }))
    .filter((item) => typeof item.source === "string" && isValidTorrentSource(item.source));
}

function pickBestMatch(items, requestedLang) {
  const langNeedle = requestedLang.trim().toLowerCase();
  const langMatches = items.filter((item) => item.lang.includes(langNeedle));
  const pool = langMatches.length ? langMatches : items;
  return pool.sort((a, b) => b.seeds - a.seeds)[0] || null;
}

function toGb(sizeBytes) {
  const n = Number(sizeBytes || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return "n/d";
  }
  return `${(n / (1024 ** 3)).toFixed(2)} GB`;
}

function getAudioLangs(torrent) {
  const langs = new Set();

  const audioTracks = Array.isArray(torrent?.audioTracks) ? torrent.audioTracks : [];
  for (const track of audioTracks) {
    const v = String(track?.lang || "").trim().toLowerCase();
    if (v) {
      langs.add(v);
    }
  }

  const fallbackLangs = Array.isArray(torrent?.languages) ? torrent.languages : [];
  for (const value of fallbackLangs) {
    const v = String(value || "").trim().toLowerCase();
    if (v) {
      langs.add(v);
    }
  }

  return Array.from(langs);
}

function buildMagnet({ infoHash, title }) {
  if (!infoHash) {
    return "";
  }
  const safeTitle = encodeURIComponent(title || "download");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${safeTitle}`;
}

function parseSeasonEpisode(torrent, record) {
  let season = torrent?.season ?? record?.season ?? null;
  let episode = torrent?.episode ?? record?.episode ?? null;

  const raw = String(torrent?.rawTitle || torrent?.title || record?.rawTitle || "");
  if (season === null || season === undefined) {
    const sEpMatch = raw.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
    if (sEpMatch) {
      season = parseInt(sEpMatch[1], 10);
      episode = parseInt(sEpMatch[2], 10);
    } else {
      const sMatch = raw.match(/\bS(\d{1,2})\b/i) || raw.match(/\bSeason\s*(\d{1,2})\b/i) || raw.match(/\bStagione\s*(\d{1,2})\b/i);
      if (sMatch) {
        season = parseInt(sMatch[1], 10);
      }
    }
  } else if (episode === null || episode === undefined) {
    const epMatch = raw.match(/\bE(\d{1,3})\b/i) || raw.match(/\bEp(?:isode)?\s*(\d{1,3})\b/i) || raw.match(/\bEpisodio\s*(\d{1,3})\b/i);
    if (epMatch) {
      episode = parseInt(epMatch[1], 10);
    }
  }

  return {
    season: typeof season === "number" && !Number.isNaN(season) ? season : null,
    episode: typeof episode === "number" && !Number.isNaN(episode) ? episode : null,
  };
}

function extractTopResultsFromPayload(payload, requestedLang, maxResults = 10) {
  const records = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const rows = [];
  for (const record of records) {
    const title = record?.title || record?.name || "Senza titolo";
    const overview = String(record?.overview || "").trim();
    const seasons = Array.isArray(record?.seasons) ? record.seasons : [];

    // Collect torrent items: from root record.torrents, or nested in seasons/episodes
    const torrentItems = [];
    if (Array.isArray(record?.torrents)) {
      for (const t of record.torrents) {
        torrentItems.push({ torrent: t, defaultSeason: null, defaultEpisode: null });
      }
    }
    for (const s of seasons) {
      if (Array.isArray(s?.torrents)) {
        for (const t of s.torrents) {
          torrentItems.push({ torrent: t, defaultSeason: s.season, defaultEpisode: null });
        }
      }
      if (Array.isArray(s?.episodes)) {
        for (const ep of s.episodes) {
          if (Array.isArray(ep?.torrents)) {
            for (const t of ep.torrents) {
              torrentItems.push({ torrent: t, defaultSeason: s.season, defaultEpisode: ep.episode });
            }
          }
        }
      }
    }

    for (const item of torrentItems) {
      const torrent = item.torrent;
      const parsedSE = parseSeasonEpisode(torrent, record);
      const season = parsedSE.season ?? item.defaultSeason ?? null;
      const episode = parsedSE.episode ?? item.defaultEpisode ?? null;

      let seasonObj = null;
      let episodeObj = null;
      if (season !== null) {
        seasonObj = seasons.find((s) => Number(s?.season) === season) || null;
        if (seasonObj && episode !== null && Array.isArray(seasonObj.episodes)) {
          episodeObj = seasonObj.episodes.find((e) => Number(e?.episode) === episode) || null;
        }
      }

      const episodeName = episodeObj?.name ? String(episodeObj.name).trim() : "";
      const episodeOverview = episodeObj?.overview ? String(episodeObj.overview).trim() : "";
      const posterUrl = episodeObj?.stillUrl || seasonObj?.posterUrl || record?.posterUrl || record?.backdropUrl || "";
      const finalOverview = episodeOverview || overview;

      let displayTitle = title;
      if (season !== null) {
        const sStr = `S${String(season).padStart(2, "0")}`;
        if (episode !== null) {
          const eStr = `E${String(episode).padStart(2, "0")}`;
          displayTitle = `${title} - ${sStr}${eStr}${episodeName ? ` (${episodeName})` : ""}`;
        } else {
          displayTitle = `${title} - ${sStr} (Stagione Completa)`;
        }
      }

      const audioLangs = getAudioLangs(torrent);
      const magnet = torrent?.magnet || torrent?.magnetUrl || torrent?.download || torrent?.url
        || buildMagnet({ infoHash: torrent?.infoHash, title: displayTitle });

      rows.push({
        title,
        displayTitle,
        season,
        episode,
        episodeName,
        overview: finalOverview,
        posterUrl,
        quality: torrent?.quality || "n/d",
        lang: audioLangs.length ? audioLangs.join(", ") : "n/d",
        magnet: magnet || "n/d",
        sizeGb: toGb(torrent?.sizeBytes),
        seeders: Number(torrent?.seeders || 0),
        leechers: Number(torrent?.leechers || 0),
        _langTokens: audioLangs,
      });
    }
  }

  const needle = String(requestedLang || "").trim().toLowerCase();
  rows.sort((a, b) => {
    const aMatch = needle && a._langTokens.some((lang) => lang.includes(needle)) ? 1 : 0;
    const bMatch = needle && b._langTokens.some((lang) => lang.includes(needle)) ? 1 : 0;
    if (aMatch !== bMatch) {
      return bMatch - aMatch;
    }
    return b.seeders - a.seeders;
  });

  return rows.slice(0, maxResults).map(({ _langTokens, ...rest }) => rest);
}

function truncateText(value, max = 260) {
  if (!value) {
    return "";
  }
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatResultForTelegram(result, index) {
  const title = result.displayTitle || result.title;
  const lines = [
    `🎬 *${index + 1}. ${title}*`,
  ];

  if (result.season !== null && result.season !== undefined) {
    const sStr = `S${String(result.season).padStart(2, "0")}`;
    if (result.episode !== null && result.episode !== undefined) {
      const eStr = `E${String(result.episode).padStart(2, "0")}`;
      const epExtra = result.episodeName ? ` — _${result.episodeName}_` : "";
      lines.push(`📺 ${sStr}${eStr}${epExtra}`);
    } else {
      lines.push(`📺 ${sStr} (Stagione Completa)`);
    }
  }

  if (result.overview) {
    lines.push(`📝 _${truncateText(result.overview, 180)}_`);
  }

  lines.push(
    `🎞 Qualità: ${result.quality}`,
    `🗣 Lingua: ${result.lang}`,
    `💾 Dimensione: ${result.sizeGb}`,
    `⬆️ Seeders: ${result.seeders}`,
  );

  return lines.join("\n");
}

async function sendFormattedResults(chatId, queryText, kind, results, replyToMessageId) {
  await sendMessage(
    chatId,
    `🔍 *Trovati ${results.length} risultati per "${queryText}" (${kind}):*`,
    replyToMessageId,
    null,
    "Markdown",
  );

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const cardText = formatResultForTelegram(result, i);
    const posterUrl = (typeof result.posterUrl === "string" && /^https?:\/\//i.test(result.posterUrl))
      ? result.posterUrl
      : "";
    const isFilm = kind === "film";
    const category = isFilm ? "Film" : "SerieTv";
    const savePath = isFilm ? MOVIES_PATH : TV_PATH;
    const canQuickAdd = typeof result.magnet === "string" && isValidTorrentSource(result.magnet);
    const addToken = canQuickAdd
      ? saveAddAction({
        category,
        savePath,
        source: result.magnet,
        title: result.displayTitle || result.title,
      })
      : "";
    const buttonText = isFilm ? "📥 Scarica Film" : "📥 Scarica Serie";
    const callbackData = addToken ? `add:${addToken}` : "";

    if (posterUrl) {
      try {
        if (callbackData) {
          await sendPhotoWithInlineButton(chatId, posterUrl, cardText, buttonText, callbackData, replyToMessageId, "Markdown");
        } else {
          await sendPhoto(chatId, posterUrl, cardText, replyToMessageId, "Markdown");
        }
        continue;
      } catch (err) {
        log("warn", "telegram.photo.send_failed", {
          index: i,
          title: result.title,
          ...serializeError(err),
        });
      }
    }

    const replyMarkup = callbackData
      ? { inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]] }
      : undefined;

    await sendMessage(chatId, cardText, replyToMessageId, replyMarkup, "Markdown");
  }
}

async function sendMoreResultsButton(chatId, token, replyToMessageId) {
  await sendMessageWithInlineButton(
    chatId,
    "Ci sono altri risultati disponibili.",
    "Mostra altri",
    `more:${token}`,
    replyToMessageId,
  );
}

async function sendSearchPage(chatId, queryText, kind, results, replyToMessageId) {
  const page = results.slice(0, 3);
  await sendFormattedResults(chatId, queryText, kind, page, replyToMessageId);

  if (results.length > page.length) {
    const token = saveSearchAction({
      queryText,
      kind,
      results,
      nextIndex: page.length,
    });
    await sendMoreResultsButton(chatId, token, replyToMessageId);
  }
}

async function handleCallbackQuery(callbackQuery) {
  const callbackQueryId = callbackQuery?.id;
  const data = String(callbackQuery?.data || "").trim();
  const msg = callbackQuery?.message;
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;
  const username = callbackQuery?.from?.username || "";

  if (!callbackQueryId || !chatId || !data) {
    return;
  }

  if (!isAllowedChat(chatId, username)) {
    await answerCallbackQuery(callbackQueryId, "Chat non autorizzata.");
    return;
  }

  if (data.startsWith("searchq:")) {
    const [, token, quality] = data.split(":");
    const wizard = getSearchWizard(token);
    if (!wizard || !["any", "480p", "720p", "1080p", "2160p"].includes(quality)) {
      await answerCallbackQuery(callbackQueryId, "Ricerca scaduta. Rifai la ricerca.");
      return;
    }
    wizard.quality = quality === "any" ? "" : quality;
    await sendSearchWizardLanguage(chatId, token, messageId);
    await answerCallbackQuery(callbackQueryId, `Qualità: ${quality}`);
    return;
  }

  if (data.startsWith("searchl:")) {
    const [, token, lang] = data.split(":");
    const wizard = getSearchWizard(token);
    if (!wizard || !["any", "ita", "eng", "original"].includes(lang)) {
      await answerCallbackQuery(callbackQueryId, "Ricerca scaduta. Rifai la ricerca.");
      return;
    }

    if (wizard.kind === "serie") {
      wizard.lang = lang === "any" ? "" : lang;
      await sendSeriesSeasonChoice(chatId, token, messageId);
      await answerCallbackQuery(callbackQueryId, `Lingua: ${lang}`);
      return;
    }

    if (wizard.quality === undefined) {
      await answerCallbackQuery(callbackQueryId, "Ricerca scaduta. Rifai la ricerca.");
      return;
    }
    ACTION_STORE.delete(token);
    await answerCallbackQuery(callbackQueryId, `Lingua: ${lang}`);
    const matches = await searchSource({
      kind: wizard.kind,
      title: wizard.queryText,
      lang: lang === "any" ? "" : lang,
      quality: wizard.quality,
    });
    if (!matches.length) {
      await sendMessage(chatId, "Nessun risultato trovato per i criteri richiesti.", messageId);
      return;
    }
    await sendSearchPage(chatId, wizard.queryText, wizard.kind, matches, messageId);
    return;
  }

  if (data.startsWith("series:")) {
    const [, token, choice] = data.split(":");
    const wizard = getSearchWizard(token);
    if (!wizard || wizard.kind !== "serie") {
      await answerCallbackQuery(callbackQueryId, "Ricerca scaduta. Rifai /findserie.");
      return;
    }

    if (choice === "all") {
      await answerCallbackQuery(callbackQueryId, "Ricerca in tutta la serie.");
      await runSeriesWizardSearch(chatId, token, messageId);
      return;
    }
    if (choice === "season") {
      PENDING_INPUTS.set(String(chatId), { type: "serie_season", token });
      await sendMessage(chatId, "Scrivi il numero della stagione.", messageId, {
        force_reply: true,
        input_field_placeholder: "Numero stagione, ad esempio 2",
      });
      await answerCallbackQuery(callbackQueryId, "Inserisci il numero della stagione.");
      return;
    }
    if (choice === "seasonall") {
      await answerCallbackQuery(callbackQueryId, `Stagione ${wizard.season}: tutti gli episodi.`);
      await runSeriesWizardSearch(chatId, token, messageId);
      return;
    }
    if (choice === "episode") {
      PENDING_INPUTS.set(String(chatId), { type: "serie_episode", token });
      await sendMessage(chatId, `Scrivi il numero dell'episodio della stagione ${wizard.season}.`, messageId, {
        force_reply: true,
        input_field_placeholder: "Numero episodio, ad esempio 5",
      });
      await answerCallbackQuery(callbackQueryId, "Inserisci il numero dell'episodio.");
      return;
    }
  }

  if (!data.startsWith("add:")) {
    if (data.startsWith("more:")) {
      const page = takeSearchPage(data.slice(5));
      if (!page) {
        await answerCallbackQuery(callbackQueryId, "Risultati scaduti. Rifai la ricerca.");
        return;
      }

      await sendFormattedResults(chatId, page.queryText, page.kind, page.results, messageId);
      if (page.hasMore) {
        const nextToken = saveSearchAction({
          queryText: page.queryText,
          kind: page.kind,
          results: page.remainingResults,
          nextIndex: 0,
        });
        await sendMoreResultsButton(chatId, nextToken, messageId);
      }
      await answerCallbackQuery(callbackQueryId, "Altri risultati caricati.");
      return;
    }

    if (!data.startsWith("torrent:")) {
      await answerCallbackQuery(callbackQueryId, "Azione non valida.");
      return;
    }

    const torrentAction = consumeAddAction(data.slice(8));
    if (!torrentAction) {
      await answerCallbackQuery(callbackQueryId, "Azione scaduta. Rifai /status.");
      return;
    }

    if (torrentAction.action === "delete") {
      try {
        await deleteTorrent(torrentAction.hash, false);
        await answerCallbackQuery(callbackQueryId, "Torrent eliminato.");
        await sendMessage(chatId, `🗑️ Eliminato da qBittorrent: ${torrentAction.name}`, messageId);
      } catch (err) {
        log("error", "callback.torrent.error", { ...serializeError(err) });
        await answerCallbackQuery(callbackQueryId, "Errore eliminazione qBittorrent.");
        await sendMessage(chatId, `Errore: ${err.message || "operazione fallita"}`, messageId);
      }
      return;
    }

    try {
      await setTorrentPaused(torrentAction.hash, torrentAction.action === "pause");
      await answerCallbackQuery(callbackQueryId, torrentAction.action === "pause" ? "Download in pausa." : "Download ripreso.");
      await sendMessage(chatId, `${torrentAction.action === "pause" ? "In pausa" : "Ripreso"}: ${torrentAction.name}`, messageId);
    } catch (err) {
      log("error", "callback.torrent.error", { ...serializeError(err) });
      await answerCallbackQuery(callbackQueryId, "Errore qBittorrent.");
      await sendMessage(chatId, `Errore: ${err.message || "operazione fallita"}`, messageId);
    }
    return;
  }

  const token = data.slice(4);
  const action = consumeAddAction(token);
  if (!action) {
    await answerCallbackQuery(callbackQueryId, "Azione scaduta. Rifai la ricerca.");
    return;
  }

  try {
    const result = await addTorrent({
      source: action.source,
      category: action.category,
      savePath: action.savePath,
    });
    await answerCallbackQuery(callbackQueryId, result.alreadyPresent ? "Torrent già presente." : "Aggiunto a qBittorrent.");
    await sendMessage(
      chatId,
      `${result.alreadyPresent ? "Già presente" : "Aggiunto"}: ${action.title}\nCategoria: ${action.category}\nPercorso: ${action.savePath}`,
      messageId,
    );
  } catch (err) {
    log("error", "callback.add.error", {
      chatId,
      messageId,
      token,
      ...serializeError(err),
    });
    await answerCallbackQuery(callbackQueryId, "Errore durante l'aggiunta.");
    await sendMessage(chatId, `Errore: ${err.message || "operazione fallita"}`, messageId);
  }
}

async function searchSource({ kind, title, lang, quality, season, episode }) {
  log("info", "search.start", {
    kind,
    title,
    lang: lang || null,
    quality: quality || null,
    hasCustomSource: Boolean(SOURCE_SEARCH_URL),
  });
  if (!SOURCE_SEARCH_URL) {
    log("warn", "search.missing_config", { requiredEnv: "SOURCE_SEARCH_URL" });
    throw new Error("SOURCE_SEARCH_URL non configurato. Inserisci un endpoint autorizzato nel file .env");
  }

  log("info", "search.mode", { provider: "custom_source", baseUrl: SOURCE_SEARCH_URL });

  const baseQuery = {
    q: title,
    type: kind,
    lang: lang || "",
    quality: quality || "",
    season: season ?? "",
    episode: episode ?? "",
    limit: String(SOURCE_RESULT_LIMIT || 8),
    include: SOURCE_INCLUDE,
    availability: SOURCE_AVAILABILITY,
    sort: SOURCE_SORT,
    verified: SOURCE_VERIFIED,
  };

  if (SOURCE_SEND_API_KEY_IN_QUERY && SOURCE_API_KEY) {
    baseQuery[SOURCE_API_KEY_PARAM] = SOURCE_API_KEY;
  }

  const requestPlans = [
    {
      name: "full_query_no_auth",
      query: baseQuery,
      headers: new Headers({
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/Invoke-WebRequest",
      }),
    },
    {
      name: "q_only_no_auth",
      query: { q: title },
      headers: new Headers({
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/Invoke-WebRequest",
      }),
    },
  ];

  if (SOURCE_API_KEY) {
    requestPlans.push({
      name: "full_query_with_auth",
      query: baseQuery,
      headers: buildAuthHeaders({
        apiKey: SOURCE_API_KEY,
        authHeader: SOURCE_AUTH_HEADER,
        authPrefix: SOURCE_AUTH_PREFIX,
      }),
    });

    requestPlans.push({
      name: "q_only_with_auth",
      query: { q: title },
      headers: buildAuthHeaders({
        apiKey: SOURCE_API_KEY,
        authHeader: SOURCE_AUTH_HEADER,
        authPrefix: SOURCE_AUTH_PREFIX,
      }),
    });
  }

  if (SOURCE_FORCE_AUTH) {
    requestPlans.sort((a, b) => Number(b.name.includes("with_auth")) - Number(a.name.includes("with_auth")));
  }

  let payload;
  let lastError = null;

  for (const [index, plan] of requestPlans.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
    const searchUrl = new URL(SOURCE_SEARCH_URL);
    for (const [key, value] of Object.entries(plan.query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      searchUrl.searchParams.set(key, String(value));
    }

    const headers = new Headers(plan.headers);
    if (!headers.has("accept")) {
      headers.set("accept", "application/json");
    }

    log("debug", "search.custom.request", {
      attempt: index + 1,
      plan: plan.name,
      finalUrl: searchUrl.toString(),
      baseUrl: SOURCE_SEARCH_URL,
      queryParams: redactQueryParamsForLog(searchUrl.searchParams),
      headers: headersToLogObject(headers),
      timeoutMs: SOURCE_TIMEOUT_MS,
      hasApiKey: Boolean(SOURCE_API_KEY),
    });

    let res;
    try {
      res = await fetch(searchUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      log("error", "search.custom.fetch_error", {
        attempt: index + 1,
        plan: plan.name,
        finalUrl: searchUrl.toString(),
        ...serializeError(err),
      });
      continue;
    } finally {
      clearTimeout(timeout);
    }

    log("debug", "search.custom.response", {
      attempt: index + 1,
      plan: plan.name,
      status: res.status,
      contentType: res.headers.get("content-type") || null,
      responseHeaders: headersToLogObject(res.headers),
    });

    const responsePreview = await res.clone().text().catch(() => "");
    log("debug", "search.custom.response_body", {
      attempt: index + 1,
      plan: plan.name,
      body: responsePreview,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      lastError = new Error(`Ricerca sorgente fallita (${res.status}): ${text.slice(0, 300)}`);
      continue;
    }

    try {
      payload = await res.json();
      log("debug", "search.custom.payload_summary", {
        ...summarizePayload(payload),
        attempt: index + 1,
        plan: plan.name,
      });
      break;
    } catch (err) {
      lastError = err;
      log("error", "search.custom.invalid_json", {
        attempt: index + 1,
        plan: plan.name,
        finalUrl: searchUrl.toString(),
        contentType: res.headers.get("content-type") || null,
        bodySample: responsePreview.slice(0, 200),
        ...serializeError(err),
      });
    }
  }

  if (!payload) {
    throw new Error(lastError?.message || "Ricerca sorgente fallita: nessuna risposta valida ricevuta.");
  }

  const topResults = extractTopResultsFromPayload(payload, lang, 100);
  log("debug", "search.custom.results", { count: topResults.length });
  return topResults;
}

async function askGemini(question, history = []) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini non configurato: aggiungi GEMINI_API_KEY nel file .env.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "Rispondi esclusivamente in italiano. Non mostrare il ragionamento interno. Mantieni una conversazione naturale ma concisa: rispondi in 3-4 frasi. Per identificare un film o una serie, indica il titolo più probabile, l'anno, una breve motivazione e al massimo un'alternativa. Se gli indizi non bastano, fai una sola domanda di chiarimento e usa il contesto della conversazione." }],
          },
          contents: [...history.map((message) => ({
            role: message.role === "assistant" ? "model" : message.role,
            parts: [{ text: message.content }],
          })), { role: "user", parts: [{ text: question }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Gemini ha restituito HTTP ${response.status}: ${details.slice(0, 200)}`);
    }

    const payload = await response.json();
    const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!answer) {
      throw new Error("Gemini non ha restituito una risposta.");
    }
    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

function formatHelp() {
  return [
    "Download Assistant (uso legale)",
    "",
    "1) Comandi base",
    "/start - avvio bot",
    "/help - mostra questo riepilogo",
    "/ask <domanda> - chiedi aiuto all'AI",
    "/stopask - chiude la conversazione AI",
    "/status - stato download",
    "/stoppolling - arresta il bot locale",
    "",
    "2) Aggiunta diretta",
    "/addfilm <magnet/url>",
    "/addserie <magnet/url>",
    "",
    "3) Ricerca film",
    "Scrivi semplicemente il titolo, anche con gli spazi:",
    "Esempi:",
    "/findfilm The Dark Knight",
    "/findfilm " + '"' + "Once Upon a Time in Hollywood" + '"',
    "Con filtri opzionali:",
    "/findfilm ita | The Dark Knight",
    "/findfilm quality=1080p | lang=ita | The Dark Knight",
    "",
    "4) Ricerca serie",
    "Formato: /findserie [quality] | [lingua] | <titolo> | [season] | [episode]",
    "Season/episode sono interi. Episode richiede season.",
    "Esempi:",
    "/findserie the office",
    "/findserie ita | the office",
    "/findserie the office | 2",
    "/findserie the office | 2 | 5",
    "/findserie the office | season=2",
    "/findserie the office | stagione=2 | episode=5",
    "/findserie 1080p | ita | the office | 2 | 5",
    "",
    "Valori quality: 480p, 720p, 1080p, 2160p",
    "",
    "Nota: usa solo contenuti che hai diritto di scaricare.",
  ].join("\n");
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const messageId = msg.message_id;
  const text = (msg.text || "").trim();
  const username = msg.from?.username || "";
  const command = text.split(/\s+/, 1)[0].toLowerCase();
  const repliedCommand = String(msg.reply_to_message?.text || "")
    .trim()
    .toLowerCase()
    .match(/^\/(ask|findfilm|findserie|addfilm|addserie)(?:@\S+)?$/)?.[1];

  if (!chatId || !text) {
    return;
  }

  log("info", "telegram.message.received", { chatId, messageId, text: text.slice(0, 120) });

  if (!isAllowedChat(chatId, username)) {
    log("warn", "telegram.message.blocked_chat", { chatId, username: username || null });
    await sendMessage(chatId, "Chat non autorizzata.", messageId);
    return;
  }

  const pendingInput = PENDING_INPUTS.get(String(chatId));
  if (pendingInput?.type === "serie_season" && !text.startsWith("/")) {
    const wizard = getSearchWizard(pendingInput.token);
    PENDING_INPUTS.delete(String(chatId));
    if (!wizard || !/^\d+$/.test(text) || Number(text) < 1) {
      await sendMessage(chatId, "Inserisci un numero di stagione valido, poi rifai /findserie.", messageId);
      return;
    }
    wizard.season = Number(text);
    await sendSeriesEpisodeChoice(chatId, pendingInput.token, messageId);
    return;
  }

  if (pendingInput?.type === "serie_episode" && !text.startsWith("/")) {
    const wizard = getSearchWizard(pendingInput.token);
    PENDING_INPUTS.delete(String(chatId));
    if (!wizard || !/^\d+$/.test(text) || Number(text) < 1) {
      await sendMessage(chatId, "Inserisci un numero di episodio valido, poi rifai /findserie.", messageId);
      return;
    }
    wizard.episode = Number(text);
    await runSeriesWizardSearch(chatId, pendingInput.token, messageId);
    return;
  }

  const pendingCommand = pendingInput?.command || (repliedCommand ? `/${repliedCommand}` : null);
  if (pendingCommand && !text.startsWith("/")) {
    PENDING_INPUTS.delete(String(chatId));
    if (pendingCommand === "/findfilm") {
      await sendSearchWizardQuality(chatId, text, "film", messageId);
      return;
    }
    if (pendingCommand === "/findserie") {
      const token = saveSearchWizard({ queryText: text, kind: "serie" });
      await sendSearchWizardLanguage(chatId, token, messageId);
      return;
    }
    await handleMessage({ ...msg, text: `${pendingCommand} ${text}` });
    return;
  }

  if (command === "/stopask" && text === command) {
    AI_CONVERSATIONS.delete(String(chatId));
    PENDING_INPUTS.delete(String(chatId));
    await sendMessage(chatId, "Conversazione AI chiusa.", messageId);
    return;
  }

  if (!text.startsWith("/") && AI_CONVERSATIONS.has(String(chatId))) {
    const conversation = AI_CONVERSATIONS.get(String(chatId));
    try {
      const answer = await askGemini(text, conversation.history);
      conversation.history.push(
        { role: "user", content: text },
        { role: "assistant", content: answer },
      );
      conversation.history = conversation.history.slice(-12);
      await sendLongMessage(chatId, answer, messageId);
    } catch (err) {
      log("error", "gemini.ask.error", { ...serializeError(err) });
      await sendMessage(chatId, `Errore AI: ${err.message || "risposta non disponibile"}`, messageId);
    }
    return;
  }

  if (command === "/start" && text === command) {
    await sendMessage(chatId, "Bot attivo. Usa /help per i comandi.", messageId);
    return;
  }

  if (command === "/help" && text === command) {
    await sendMessage(chatId, formatHelp(), messageId);
    return;
  }

  if (command === "/ask") {
    if (text === command) {
      await requestManualInput(chatId, "Scrivi la domanda da fare all'AI.", messageId, "/ask", "La tua domanda");
      return;
    }

    try {
      const question = text.slice(command.length).trim();
      const conversation = AI_CONVERSATIONS.get(String(chatId)) || { history: [] };
      const answer = await askGemini(question, conversation.history);
      conversation.history.push(
        { role: "user", content: question },
        { role: "assistant", content: answer },
      );
      conversation.history = conversation.history.slice(-12);
      AI_CONVERSATIONS.set(String(chatId), conversation);
      await sendLongMessage(chatId, answer, messageId);
    } catch (err) {
      log("error", "gemini.ask.error", { ...serializeError(err) });
      await sendMessage(chatId, `Errore AI: ${err.message || "risposta non disponibile"}`, messageId);
    }
    return;
  }

  if (command === "/addfilm") {
    if (text === command) {
      await requestManualInput(chatId, "Invia il magnet o l'URL del film.", messageId, "/addfilm", "Magnet o URL del film");
      return;
    }

    const source = parseAddCommand(text);
    if (!source || !isValidTorrentSource(source)) {
      await sendMessage(chatId, "Uso: /addfilm <magnet o URL torrent valido>", messageId);
      return;
    }

    await addTorrent({ source, category: "Film", savePath: MOVIES_PATH });
    await sendMessage(chatId, `Aggiunto in Film. Percorso: ${MOVIES_PATH}`, messageId);
    return;
  }

  if (command === "/findfilm") {
    if (text === command) {
      await requestManualInput(chatId, "Scrivi il titolo del film. Puoi aggiungere anche i filtri opzionali.", messageId, "/findfilm", "Titolo del film");
      return;
    }

    const parsed = parseFindCommand(text);
    if (!parsed) {
      await sendMessage(
        chatId,
        "Scrivi: /findfilm Titolo del film. Filtri opzionali: quality=1080p e lang=ita.",
        messageId,
      );
      return;
    }

    const queryText = parsed.title;
    log("debug", "search.query_text", { kind: "movie", queryText, lang: parsed.lang || null, quality: parsed.quality || null });
    const matches = await searchSource({
      kind: "movie",
      title: queryText,
      lang: parsed.lang,
      quality: parsed.quality,
    });
    if (!matches.length) {
      await sendMessage(chatId, "Nessun risultato trovato per i criteri richiesti.", messageId);
      return;
    }

    await sendSearchPage(chatId, queryText, "film", matches, messageId);
    return;
  }

  if (command === "/addserie") {
    if (text === command) {
      await requestManualInput(chatId, "Invia il magnet o l'URL della serie.", messageId, "/addserie", "Magnet o URL della serie");
      return;
    }

    const source = parseAddCommand(text);
    if (!source || !isValidTorrentSource(source)) {
      await sendMessage(chatId, "Uso: /addserie <magnet o URL torrent valido>", messageId);
      return;
    }

    await addTorrent({ source, category: "SerieTv", savePath: TV_PATH });
    await sendMessage(chatId, `Aggiunto in SerieTv. Percorso: ${TV_PATH}`, messageId);
    return;
  }

  if (command === "/findserie") {
    if (text === command) {
      await requestManualInput(chatId, "Scrivi il titolo della serie.", messageId, "/findserie", "Titolo della serie");
      return;
    }

    const parsed = parseSeriesFindCommand(text);
    if (!parsed) {
      await sendMessage(
        chatId,
        "Uso: /findserie <titolo> oppure /findserie <lingua> | <titolo> oppure /findserie <quality> | <lingua> | <titolo> oppure /findserie <titolo> | <season> | <episode> oppure /findserie <titolo> | season=2 | episode=5",
        messageId,
      );
      return;
    }

    if (parsed.error) {
      await sendMessage(chatId, `Errore: ${parsed.error}`, messageId);
      return;
    }

    const queryText = parsed.title;
    log("debug", "search.query_text", {
      kind: "tv",
      queryText,
      lang: parsed.lang || null,
      quality: parsed.quality || null,
      season: parsed.season ?? null,
      episode: parsed.episode ?? null,
    });
    const matches = await searchSource({
      kind: "tv",
      title: queryText,
      lang: parsed.lang,
      quality: parsed.quality,
      season: parsed.season,
      episode: parsed.episode,
    });
    if (!matches.length) {
      await sendMessage(chatId, "Nessun risultato trovato per i criteri richiesti.", messageId);
      return;
    }

    await sendSearchPage(chatId, queryText, "serie", matches, messageId);
    return;
  }

  if (command === "/status" && text === command) {
    const torrents = await getTorrentsOverview();
    await sendStatus(chatId, torrents, messageId);
    return;
  }

  if (command === "/stoppolling" && text === command) {
    await sendMessage(chatId, "Polling arrestato. Per riavviare usa start-manual.ps1.", messageId);
    pollingRunning = false;
    return;
  }

  await sendMessage(chatId, "Comando non riconosciuto. Usa /help.", messageId);
}

async function ensureSetup() {
  log("info", "startup.setup.begin");
  await qbitLogin();
  await ensureCategory("Film", MOVIES_PATH);
  await ensureCategory("SerieTv", TV_PATH);
  log("info", "startup.setup.complete");
}

async function runPolling() {
  let offset = 0;
  pollingRunning = true;
  log("info", "polling.start", { pollIntervalMs: POLL_INTERVAL_MS });

  try {
    const pendingUpdates = await telegramApi("getUpdates", {
      timeout: 0,
      offset: -1,
      allowed_updates: ["message", "callback_query"],
    });
    const latestUpdate = pendingUpdates?.result?.[0];
    if (latestUpdate?.update_id !== undefined) {
      offset = latestUpdate.update_id + 1;
      log("info", "polling.pending_updates.skipped", { offset });
    }
  } catch (err) {
    log("warn", "polling.pending_updates.skip_failed", { error: err?.message || String(err) });
  }

  while (pollingRunning) {
    try {
      const updates = await telegramApi("getUpdates", {
        timeout: 25,
        offset,
        allowed_updates: ["message", "callback_query"],
      });

      const result = Array.isArray(updates?.result) ? updates.result : [];
      log("debug", "polling.batch", { count: result.length, offset });
      for (const update of result) {
        offset = update.update_id + 1;
        const msg = update?.message;
        const callbackQuery = update?.callback_query;

        if (callbackQuery) {
          try {
            await handleCallbackQuery(callbackQuery);
          } catch (err) {
            log("error", "callback.handle.error", {
              callbackQueryId: callbackQuery?.id || null,
              ...serializeError(err),
            });
          }
          continue;
        }

        if (!msg) {
          continue;
        }

        try {
          await handleMessage(msg);
        } catch (err) {
          log("error", "message.handle.error", {
            chatId: msg.chat?.id || null,
            messageId: msg.message_id || null,
            ...serializeError(err),
          });
          const chatId = msg.chat?.id;
          if (chatId) {
            await sendMessage(chatId, `Errore: ${err.message || "operazione fallita"}`, msg.message_id);
          }
        }
      }
    } catch (err) {
      log("error", "polling.error", { error: err?.message || String(err) });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  log("info", "polling.stop");
}

async function bootstrap() {
  try {
    await registerBotCommands();
  } catch (err) {
    log("warn", "telegram.commands.registration_failed", { error: err?.message || String(err) });
  }

  try {
    await ensureSetup();
  } catch (err) {
    log("warn", "startup.setup.degraded", { error: err?.message || String(err) });
  }

  await runPolling();
}

bootstrap().catch((err) => {
  log("error", "startup.error", { error: err?.message || String(err) });
  process.exit(1);
});
