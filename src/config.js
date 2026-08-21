import fs from "node:fs";
import path from "node:path";

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
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseList(value, normalize = (item) => item.trim()) {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalize)
      .filter(Boolean),
  );
}

function parseBoolean(value, fallback) {
  return value === undefined ? fallback : String(value).toLowerCase() === "true";
}

loadEnvFile();

export const config = {
  botToken: process.env.BOT_TOKEN,
  allowedChatIds: parseList(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
  allowedUsernames: parseList(process.env.TELEGRAM_ALLOWED_USERNAMES, (item) => item.trim().toLowerCase().replace(/^@/, "")),
  qbitUrl: (process.env.QBIT_URL || "http://127.0.0.1:8080").replace(/\/$/, ""),
  qbitUsername: process.env.QBIT_USERNAME,
  qbitPassword: process.env.QBIT_PASSWORD,
  moviesPath: process.env.MOVIES_PATH || "D:\\Film e Serie Tv\\Film",
  tvPath: process.env.TV_PATH || "D:\\Film e Serie Tv\\Serie Tv",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || "2000"),
  sourceSearchUrl: process.env.SOURCE_SEARCH_URL || "",
  sourceApiKey: process.env.SOURCE_API_KEY || "",
  sourceAuthHeader: process.env.SOURCE_AUTH_HEADER || "Authorization",
  sourceAuthPrefix: process.env.SOURCE_AUTH_PREFIX || "Bearer ",
  sourceTimeoutMs: Number(process.env.SOURCE_TIMEOUT_MS || "10000"),
  sourceResultLimit: Number(process.env.SOURCE_RESULT_LIMIT || "8"),
  sourceForceAuth: parseBoolean(process.env.SOURCE_FORCE_AUTH, Boolean(process.env.SOURCE_API_KEY)),
  sourceInclude: process.env.SOURCE_INCLUDE || "",
  sourceAvailability: process.env.SOURCE_AVAILABILITY || "all",
  sourceSort: process.env.SOURCE_SORT || "relevance",
  sourceVerified: process.env.SOURCE_VERIFIED || "true",
  sourceApiKeyParam: process.env.SOURCE_API_KEY_PARAM || "api_Key",
  sourceSendApiKeyInQuery: parseBoolean(process.env.SOURCE_SEND_API_KEY_IN_QUERY, true),
  sourceApiKeyHeader: process.env.SOURCE_API_KEY_HEADER || "x-api-key",
  sourceSendXApiKeyHeader: parseBoolean(process.env.SOURCE_SEND_X_API_KEY_HEADER, true),
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || "30000"),
  actionTtlMs: Number(process.env.ACTION_TTL_MS || "900000"),
  actionMaxItems: Number(process.env.ACTION_MAX_ITEMS || "500"),
  logLevel: (process.env.LOG_LEVEL || "debug").toLowerCase(),
};

if (!config.botToken) {
  console.error("Missing BOT_TOKEN in .env");
  process.exit(1);
}
if (!config.qbitUsername || !config.qbitPassword) {
  console.error("Missing QBIT_USERNAME or QBIT_PASSWORD in .env");
  process.exit(1);
}
