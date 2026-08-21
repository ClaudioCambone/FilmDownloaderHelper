import fs from "node:fs";
import path from "node:path";
import { URLSearchParams } from "node:url";
import { randomUUID } from "node:crypto";

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_ALLOWED_CHAT_IDS = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);
const TELEGRAM_ALLOWED_USERNAMES = new Set(
  (process.env.TELEGRAM_ALLOWED_USERNAMES || "")
    .split(",")
    .map((v) => v.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean),
);
const QBIT_URL = (process.env.QBIT_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const QBIT_USERNAME = process.env.QBIT_USERNAME;
const QBIT_PASSWORD = process.env.QBIT_PASSWORD;
const MOVIES_PATH = process.env.MOVIES_PATH || "D:\\Film e Serie Tv\\Film";
const TV_PATH = process.env.TV_PATH || "D:\\Film e Serie Tv\\Serie Tv";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || "2000");
const SOURCE_SEARCH_URL = process.env.SOURCE_SEARCH_URL || "";
const SOURCE_API_KEY = process.env.SOURCE_API_KEY || "";
const SOURCE_AUTH_HEADER = process.env.SOURCE_AUTH_HEADER || "Authorization";
const SOURCE_AUTH_PREFIX = process.env.SOURCE_AUTH_PREFIX || "Bearer ";
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || "10000");
const SOURCE_RESULT_LIMIT = Number(process.env.SOURCE_RESULT_LIMIT || "8");
const SOURCE_FORCE_AUTH = process.env.SOURCE_FORCE_AUTH
  ? String(process.env.SOURCE_FORCE_AUTH).toLowerCase() === "true"
  : Boolean(SOURCE_API_KEY);
const SOURCE_INCLUDE = process.env.SOURCE_INCLUDE || "";
const SOURCE_AVAILABILITY = process.env.SOURCE_AVAILABILITY || "all";
const SOURCE_SORT = process.env.SOURCE_SORT || "relevance";
const SOURCE_VERIFIED = process.env.SOURCE_VERIFIED || "true";
const SOURCE_API_KEY_PARAM = process.env.SOURCE_API_KEY_PARAM || "api_Key";
const SOURCE_SEND_API_KEY_IN_QUERY = String(process.env.SOURCE_SEND_API_KEY_IN_QUERY || "true").toLowerCase() === "true";
const SOURCE_API_KEY_HEADER = process.env.SOURCE_API_KEY_HEADER || "x-api-key";
const SOURCE_SEND_X_API_KEY_HEADER = String(process.env.SOURCE_SEND_X_API_KEY_HEADER || "true").toLowerCase() === "true";
const ACTION_TTL_MS = Number(process.env.ACTION_TTL_MS || "900000");
const ACTION_MAX_ITEMS = Number(process.env.ACTION_MAX_ITEMS || "500");
const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LOG_LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function shouldLog(level) {
  const configured = LOG_LEVEL_ORDER[LOG_LEVEL] ?? LOG_LEVEL_ORDER.info;
  const current = LOG_LEVEL_ORDER[level] ?? LOG_LEVEL_ORDER.info;
  return current <= configured;
}

function log(level, event, meta = {}) {
  if (!shouldLog(level)) {
    return;
  }
  const ts = new Date().toISOString();
  const body = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const line = `${ts} [${level.toUpperCase()}] ${event}${body}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function serializeError(err) {
  if (!err) {
    return { message: "Unknown error" };
  }
  return {
    name: err.name || "Error",
    message: err.message || String(err),
    cause: err.cause?.message || null,
    stack: typeof err.stack === "string" ? err.stack.split("\n").slice(0, 4).join(" | ") : null,
  };
}

function redactValue(key, value) {
  if (value === undefined || value === null) {
    return value;
  }

  const normalizedKey = String(key).toLowerCase();
  if (normalizedKey.includes("authorization") || normalizedKey.includes("api-key") || normalizedKey.includes("api_key")) {
    return "***redacted***";
  }

  return value;
}

function headersToLogObject(headers) {
  return Object.fromEntries(
    Array.from(headers.entries()).map(([key, value]) => [key, redactValue(key, value)]),
  );
}

function redactQueryParamsForLog(searchParams) {
  const sensitive = /(api[_-]?key|token|authorization|secret)/i;
  const out = {};
  for (const [key, value] of searchParams.entries()) {
    out[key] = sensitive.test(key) ? "***redacted***" : value;
  }
  return out;
}

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

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN in .env");
  process.exit(1);
}
if (!QBIT_USERNAME || !QBIT_PASSWORD) {
  console.error("Missing QBIT_USERNAME or QBIT_PASSWORD in .env");
  process.exit(1);
}

let qbitCookie = "";
const ACTION_STORE = new Map();

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

async function qbitLogin() {
  log("debug", "qbit.login.start", { url: QBIT_URL, username: QBIT_USERNAME });
  const body = new URLSearchParams({
    username: QBIT_USERNAME,
    password: QBIT_PASSWORD,
  });

  let res;
  try {
    res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    throw new Error(
      `Cannot reach qBittorrent WebUI at ${QBIT_URL}. ` +
      "Verify qBittorrent is running, WebUI is enabled, and the port matches QBIT_URL.",
    );
  }

  if (!res.ok) {
    log("warn", "qbit.login.http_error", { status: res.status });
    throw new Error(`qBittorrent login failed (${res.status})`);
  }

  const setCookie = res.headers.get("set-cookie") || "";
  const sid = setCookie.split(";")[0];
  if (!sid.startsWith("SID=")) {
    throw new Error("qBittorrent did not return SID cookie");
  }
  qbitCookie = sid;
  log("info", "qbit.login.success");
}

async function qbitFetch(endpoint, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (qbitCookie) {
    headers.set("cookie", qbitCookie);
  }

  const res = await fetch(`${QBIT_URL}${endpoint}`, {
    ...options,
    headers,
  });

  log("debug", "qbit.fetch.response", {
    endpoint,
    status: res.status,
    retried: !retry,
  });

  if ((res.status === 403 || res.status === 401) && retry) {
    log("warn", "qbit.fetch.auth_retry", { endpoint, status: res.status });
    await qbitLogin();
    return qbitFetch(endpoint, options, false);
  }

  return res;
}

async function ensureCategory(name, savePath) {
  log("debug", "qbit.category.ensure", { name, savePath });
  const body = new URLSearchParams({
    category: name,
    savePath,
  });

  const res = await qbitFetch("/api/v2/torrents/createCategory", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    throw new Error(`Cannot create category ${name}: ${res.status} ${text}`);
  }

  log("info", "qbit.category.ready", { name, status: res.status });
}

async function addTorrent({ source, category, savePath }) {
  log("info", "torrent.add.start", {
    category,
    savePath,
    sourceType: source.startsWith("magnet:?") ? "magnet" : "url",
  });
  const body = new URLSearchParams({
    urls: source,
    category,
    savepath: savePath,
    autoTMM: "false",
  });

  const res = await qbitFetch("/api/v2/torrents/add", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Add torrent failed: ${res.status} ${text}`);
  }

  log("info", "torrent.add.success", { category, savePath });
}

async function getTorrentsOverview() {
  const res = await qbitFetch("/api/v2/torrents/info", { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cannot read torrents: ${res.status} ${text}`);
  }
  const torrents = await res.json();
  log("debug", "torrent.overview.loaded", {
    count: Array.isArray(torrents) ? torrents.length : 0,
  });
  return Array.isArray(torrents) ? torrents : [];
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

async function sendMessage(chatId, text, replyToMessageId) {
  log("debug", "telegram.message.send", { chatId, replyToMessageId: Boolean(replyToMessageId) });
  const payload = {
    chat_id: chatId,
    text: text.slice(0, 3900),
  };

  if (replyToMessageId) {
    payload.reply_parameters = { message_id: replyToMessageId };
  }

  await telegramApi("sendMessage", payload);
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

async function sendPhoto(chatId, photoUrl, caption, replyToMessageId) {
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption.slice(0, 1000),
  };

  if (replyToMessageId) {
    payload.reply_parameters = { message_id: replyToMessageId };
  }

  await telegramApi("sendPhoto", payload);
}

async function sendPhotoWithInlineButton(chatId, photoUrl, caption, buttonText, callbackData, replyToMessageId) {
  const payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption.slice(0, 1000),
    reply_markup: {
      inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
    },
  };

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

    for (let i = 0; i < block.length; i += maxLen) {
      await sendMessage(chatId, block.slice(i, i + maxLen), replyToMessageId);
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
  const firstSpace = text.indexOf(" ");
  if (firstSpace === -1) {
    return null;
  }

  const payload = text.slice(firstSpace + 1).trim();
  if (!payload) {
    return null;
  }

  const allowedQualities = new Set(["480p", "720p", "1080p", "2160p"]);
  const parts = payload
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  if (parts.length === 1) {
    return { quality: "", lang: "", title: parts[0] };
  }

  if (parts.length === 2) {
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

  const quality = parts[0].toLowerCase();
  const lang = parts[1];
  const title = parts.slice(2).join(" | ");
  if (!allowedQualities.has(quality) || !lang || !title) {
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
    const torrents = Array.isArray(record?.torrents) ? record.torrents : [];

    for (const torrent of torrents) {
      const audioLangs = getAudioLangs(torrent);
      const magnet = torrent?.magnet || torrent?.magnetUrl || torrent?.download || torrent?.url
        || buildMagnet({ infoHash: torrent?.infoHash, title });

      rows.push({
        title,
        overview,
        posterUrl: record?.posterUrl || "",
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
    return "n/d";
  }
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatResultForTelegram(result, index) {
  return [
    `Risultato ${index + 1}`,
    `Title: ${result.title}`,
    `Overview: ${truncateText(result.overview, 220)}`,
    `Quality: ${result.quality}`,
    `Lang (audio): ${result.lang}`,
    `Size: ${result.sizeGb}`,
    `Seeders: ${result.seeders}`,
    `Leechers: ${result.leechers}`,
  ].join("\n");
}

async function sendFormattedResults(chatId, queryText, kind, results, replyToMessageId) {
  await sendMessage(
    chatId,
    `Trovati ${results.length} risultati per \"${queryText}\" (${kind}).`,
    replyToMessageId,
  );

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const cardText = formatResultForTelegram(result, i);
    const hasPoster = typeof result.posterUrl === "string" && /^https?:\/\//i.test(result.posterUrl);
    const isFilm = kind === "film";
    const category = isFilm ? "Film" : "SerieTv";
    const savePath = isFilm ? MOVIES_PATH : TV_PATH;
    const canQuickAdd = typeof result.magnet === "string" && isValidTorrentSource(result.magnet);
    const addToken = canQuickAdd
      ? saveAddAction({
        category,
        savePath,
        source: result.magnet,
        title: result.title,
      })
      : "";
    const buttonText = isFilm ? "Aggiungi Film" : "Aggiungi Serie";
    const callbackData = addToken ? `add:${addToken}` : "";

    if (hasPoster) {
      try {
        if (callbackData) {
          await sendPhotoWithInlineButton(chatId, result.posterUrl, cardText, buttonText, callbackData, replyToMessageId);
        } else {
          await sendPhoto(chatId, result.posterUrl, cardText, replyToMessageId);
        }
      } catch (err) {
        log("warn", "telegram.photo.send_failed", {
          index: i,
          title: result.title,
          ...serializeError(err),
        });
        if (callbackData) {
          await sendMessageWithInlineButton(chatId, cardText, buttonText, callbackData, replyToMessageId);
        } else {
          await sendMessage(chatId, cardText, replyToMessageId);
        }
      }
    } else {
      if (callbackData) {
        await sendMessageWithInlineButton(chatId, cardText, buttonText, callbackData, replyToMessageId);
      } else {
        await sendMessage(chatId, cardText, replyToMessageId);
      }
    }

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

  if (!data.startsWith("add:")) {
    await answerCallbackQuery(callbackQueryId, "Azione non valida.");
    return;
  }

  const token = data.slice(4);
  const action = consumeAddAction(token);
  if (!action) {
    await answerCallbackQuery(callbackQueryId, "Azione scaduta. Rifai la ricerca.");
    return;
  }

  try {
    await addTorrent({
      source: action.source,
      category: action.category,
      savePath: action.savePath,
    });
    await answerCallbackQuery(callbackQueryId, "Aggiunto a qBittorrent.");
    await sendMessage(
      chatId,
      `Aggiunto: ${action.title}\nCategoria: ${action.category}\nPercorso: ${action.savePath}`,
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

  const topResults = extractTopResultsFromPayload(payload, lang, 3);
  log("debug", "search.custom.results", { count: topResults.length });
  return topResults;
}

function formatHelp() {
  return [
    "Download Assistant (uso legale)",
    "",
    "1) Comandi base",
    "/start - avvio bot",
    "/help - mostra questo riepilogo",
    "/status - stato download",
    "",
    "2) Aggiunta diretta",
    "/addfilm <magnet/url>",
    "/addserie <magnet/url>",
    "",
    "3) Ricerca film",
    "Formato: /findfilm [quality] | [lingua] | <titolo>",
    "Esempi:",
    "/findfilm interstellar",
    "/findfilm ita | interstellar",
    "/findfilm 1080p | ita | interstellar",
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

  if (!chatId || !text) {
    return;
  }

  log("info", "telegram.message.received", { chatId, messageId, text: text.slice(0, 120) });

  if (!isAllowedChat(chatId, username)) {
    log("warn", "telegram.message.blocked_chat", { chatId, username: username || null });
    await sendMessage(chatId, "Chat non autorizzata.", messageId);
    return;
  }

  if (text === "/start") {
    await sendMessage(chatId, "Bot attivo. Usa /help per i comandi.", messageId);
    return;
  }

  if (text === "/help") {
    await sendMessage(chatId, formatHelp(), messageId);
    return;
  }

  if (text.startsWith("/addfilm")) {
    const source = parseAddCommand(text);
    if (!source || !isValidTorrentSource(source)) {
      await sendMessage(chatId, "Uso: /addfilm <magnet o URL torrent valido>", messageId);
      return;
    }

    await addTorrent({ source, category: "Film", savePath: MOVIES_PATH });
    await sendMessage(chatId, `Aggiunto in Film. Percorso: ${MOVIES_PATH}`, messageId);
    return;
  }

  if (text.startsWith("/findfilm")) {
    const parsed = parseFindCommand(text);
    if (!parsed) {
      await sendMessage(
        chatId,
        "Uso: /findfilm <titolo> oppure /findfilm <lingua> | <titolo> oppure /findfilm <quality> | <lingua> | <titolo>",
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

    await sendFormattedResults(chatId, queryText, "film", matches, messageId);
    return;
  }

  if (text.startsWith("/addserie")) {
    const source = parseAddCommand(text);
    if (!source || !isValidTorrentSource(source)) {
      await sendMessage(chatId, "Uso: /addserie <magnet o URL torrent valido>", messageId);
      return;
    }

    await addTorrent({ source, category: "SerieTv", savePath: TV_PATH });
    await sendMessage(chatId, `Aggiunto in SerieTv. Percorso: ${TV_PATH}`, messageId);
    return;
  }

  if (text.startsWith("/findserie")) {
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

    await sendFormattedResults(chatId, queryText, "serie", matches, messageId);
    return;
  }

  if (text === "/status") {
    const torrents = await getTorrentsOverview();
    const active = torrents.filter((t) => t.state && !String(t.state).includes("paused")).length;
    const downloading = torrents.filter((t) => String(t.state).includes("downloading")).length;
    const completed = torrents.filter((t) => t.progress >= 1).length;

    await sendMessage(
      chatId,
      `Totali: ${torrents.length}\nIn download: ${downloading}\nAttivi: ${active}\nCompletati: ${completed}`,
      messageId,
    );
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
  log("info", "polling.start", { pollIntervalMs: POLL_INTERVAL_MS });

  while (true) {
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
}

async function bootstrap() {
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
