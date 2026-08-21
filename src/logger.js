const LOG_LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export function createLogger(logLevel = "info") {
  function shouldLog(level) {
    const configured = LOG_LEVEL_ORDER[logLevel] ?? LOG_LEVEL_ORDER.info;
    const current = LOG_LEVEL_ORDER[level] ?? LOG_LEVEL_ORDER.info;
    return current <= configured;
  }

  return function log(level, event, meta = {}) {
    if (!shouldLog(level)) {
      return;
    }
    const timestamp = new Date().toISOString();
    const body = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const line = `${timestamp} [${level.toUpperCase()}] ${event}${body}`;
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };
}

export function serializeError(error) {
  if (!error) {
    return { message: "Unknown error" };
  }
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    cause: error.cause?.message || null,
    stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 4).join(" | ") : null,
  };
}

export function redactValue(key, value) {
  if (value === undefined || value === null) {
    return value;
  }
  const normalizedKey = String(key).toLowerCase();
  if (normalizedKey.includes("authorization") || normalizedKey.includes("api-key") || normalizedKey.includes("api_key")) {
    return "***redacted***";
  }
  return value;
}

export function headersToLogObject(headers) {
  return Object.fromEntries(
    Array.from(headers.entries()).map(([key, value]) => [key, redactValue(key, value)]),
  );
}

export function redactQueryParamsForLog(searchParams) {
  const sensitive = /(api[_-]?key|token|authorization|secret)/i;
  const output = {};
  for (const [key, value] of searchParams.entries()) {
    output[key] = sensitive.test(key) ? "***redacted***" : value;
  }
  return output;
}
