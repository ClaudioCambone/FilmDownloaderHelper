import { URLSearchParams } from "node:url";

export function createQbitClient({ config, log }) {
  let cookie = "";

  async function login() {
    log("debug", "qbit.login.start", { url: config.qbitUrl, username: config.qbitUsername });
    const body = new URLSearchParams({
      username: config.qbitUsername,
      password: config.qbitPassword,
    });

    let response;
    try {
      response = await fetch(`${config.qbitUrl}/api/v2/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      throw new Error(
        `Cannot reach qBittorrent WebUI at ${config.qbitUrl}. ` +
        "Verify qBittorrent is running, WebUI is enabled, and the port matches QBIT_URL.",
        { cause: error },
      );
    }

    if (!response.ok) {
      log("warn", "qbit.login.http_error", { status: response.status });
      throw new Error(`qBittorrent login failed (${response.status})`);
    }

    const setCookie = response.headers.get("set-cookie") || "";
    const sessionCookie = setCookie.split(";")[0];
    if (!/^(SID|QBT_SID(_\d+)?)=/.test(sessionCookie)) {
      throw new Error("qBittorrent did not return SID cookie");
    }
    cookie = sessionCookie;
    log("info", "qbit.login.success");
  }

  async function request(endpoint, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    if (cookie) {
      headers.set("cookie", cookie);
    }

    const response = await fetch(`${config.qbitUrl}${endpoint}`, {
      ...options,
      headers,
    });

    log("debug", "qbit.fetch.response", {
      endpoint,
      status: response.status,
      retried: !retry,
    });

    if ((response.status === 403 || response.status === 401) && retry) {
      log("warn", "qbit.fetch.auth_retry", { endpoint, status: response.status });
      await login();
      return request(endpoint, options, false);
    }
    return response;
  }

  async function ensureCategory(name, savePath) {
    const response = await request("/api/v2/torrents/createCategory", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ category: name, savePath }),
    });

    if (!response.ok && response.status !== 409) {
      const text = await response.text();
      throw new Error(`Cannot create category ${name}: ${response.status} ${text}`);
    }
    log("info", "qbit.category.ready", { name, status: response.status });
  }

  async function addTorrent({ source, category, savePath }) {
    log("info", "torrent.add.start", {
      category,
      savePath,
      sourceType: source.startsWith("magnet:?") ? "magnet" : "url",
    });
    const response = await request("/api/v2/torrents/add", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ urls: source, category, savepath: savePath, autoTMM: "false" }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Add torrent failed: ${response.status} ${text}`);
    }
    log("info", "torrent.add.success", { category, savePath });
  }

  async function listTorrents() {
    const response = await request("/api/v2/torrents/info", { method: "GET" });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cannot read torrents: ${response.status} ${text}`);
    }
    const torrents = await response.json();
    log("debug", "torrent.overview.loaded", { count: Array.isArray(torrents) ? torrents.length : 0 });
    return Array.isArray(torrents) ? torrents : [];
  }

  async function setPaused(hash, paused) {
    const endpoints = paused
      ? ["/api/v2/torrents/pause", "/api/v2/torrents/stop"]
      : ["/api/v2/torrents/resume", "/api/v2/torrents/start"];

    for (const endpoint of endpoints) {
      const response = await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ hashes: hash }),
      });

      if (response.ok) {
        log("info", "torrent.control.success", { action: paused ? "pause" : "resume", endpoint });
        return;
      }
      if (response.status !== 404 || endpoint === endpoints.at(-1)) {
        const text = await response.text();
        throw new Error(`qBittorrent ${paused ? "pause" : "resume"} failed: ${response.status} ${text}`);
      }
    }
  }

  return {
    login,
    ensureCategory,
    addTorrent,
    listTorrents,
    setPaused,
  };
}
