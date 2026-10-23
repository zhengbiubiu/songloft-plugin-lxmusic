// === lx-music-plugin — Single-file IIFE build ===
// All code inlined; SDK utilities hand-rolled below (no @songloft/plugin-sdk import needed).
// Hash algorithm verified against plugin-builder source: path\n + sha256hex(content) + \n per file, sorted, final sha256.

(function () {
  'use strict'

  // ==============================================
  // Hand-rolled SDK utilities (replaces @songloft/plugin-sdk import)
  // ==============================================
  function jsonResponse(data, status) {
    return {
      statusCode: status || 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  }

  function parseQuery(queryStr) {
    if (!queryStr) return {}
    const out = {}
    const parts = String(queryStr).split('&')
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (!p) continue
      const eq = p.indexOf('=')
      let k, v
      if (eq === -1) { k = p; v = '' }
      else { k = p.substring(0, eq); v = p.substring(eq + 1) }
      try { k = decodeURIComponent(k) } catch {}
      try { v = decodeURIComponent(v) } catch {}
      out[k] = v
    }
    return out
  }

  function createRouter() {
    const routes = [] // [{ method, pathPattern, handler, paramNames }]

    function compile(pathPattern) {
      // "/stream/:token" → { re: /^\/stream\/([^\/]+)$/, params: ['token'] }
      const paramNames = []
      const escaped = pathPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      const reStr = escaped.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
        paramNames.push(name)
        return '([^/]+)'
      })
      return { re: new RegExp('^' + reStr + '$'), params: paramNames }
    }

    function matchPath(path, entry) {
      const { re, params } = compile(entry.pattern)
      const m = path.match(re)
      if (!m) return null
      const routeParams = {}
      for (let i = 0; i < params.length; i++) routeParams[params[i]] = decodeURIComponent(m[i + 1] || '')
      return routeParams
    }

    function register(method, path, handler) {
      routes.push({ method: method.toUpperCase(), pattern: path, handler })
    }

    return {
      get: function (path, handler) { register('GET', path, handler); return this },
      post: function (path, handler) { register('POST', path, handler); return this },
      handle: async function (req) {
        const reqMethod = (req.method || 'GET').toUpperCase()
        // Normalize req.path — host may provide path relative to entryPath, or raw URL
        let reqPath = req.path || '/'
        const qIdx = reqPath.indexOf('?')
        if (qIdx !== -1) reqPath = reqPath.substring(0, qIdx)
        // Strip entryPath prefix if present (host may give full path)
        try {
          const hostUrl = globalThis.songloft && globalThis.songloft.plugin && await globalThis.songloft.plugin.getHostUrl()
          if (hostUrl && typeof hostUrl === 'string') {
            const prefix = '/api/v1/jsplugin/lx-music-plugin'
            if (reqPath.startsWith(prefix)) reqPath = reqPath.substring(prefix.length)
          }
        } catch {}
        if (!reqPath) reqPath = '/'

        for (let i = 0; i < routes.length; i++) {
          const entry = routes[i]
          if (entry.method !== reqMethod && entry.method !== 'ALL') continue
          const params = matchPath(reqPath, entry)
          if (params !== null) {
            // Parse query if host passes raw query string in req.query
            const parsedQuery = typeof req.query === 'string' ? parseQuery(req.query) : (req.query || {})
            const augmented = Object.assign({}, req, { query: parsedQuery })
            try {
              return await entry.handler(augmented, params)
            } catch (e) {
              console.error('[LxMusic] route handler error:', e.message || e)
              return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e.message || e) }) }
            }
          }
        }
        return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not Found', path: reqPath }) }
      },
    }
  }

  function createSearchHandler(opts) {
    return async function (req) {
      const body = parseBody(req)
      const keyword = String(body.keyword || '').trim() || String(body.name || '').trim()
      const page = parseInt(String(body.page || '1'), 10) || 1
      const pageSize = parseInt(String(body.pageSize || body.limit || '20'), 10) || 20
      if (!keyword) return jsonResponse({ results: [] })
      try {
        const items = await opts.search(keyword, page, pageSize)
        return jsonResponse({ results: items })
      } catch (e) {
        return jsonResponse({ results: [], error: String(e.message || e) }, 500)
      }
    }
  }

  // ==============================================
  // config.js — Configuration storage
  // ==============================================
  const _ALL_SOURCES = ['kw', 'tx', 'wy', 'mg', 'kg', 'bd', 'joox', 'migu']
  const DEFAULT_SOURCES = ['kw', 'tx', 'wy', 'mg', 'kg', 'bd']
  const CONFIG_KEY = 'lxmusic_plugin_config'
  const DEFAULT_CONFIG = { baseUrl: '', serverHost: '', username: '', password: '', defaultSources: DEFAULT_SOURCES.slice(), quality: '128k' }
  let _cachedConfig = null

  function normalizeConfig(raw) {
    const parsed = Object.assign({}, DEFAULT_CONFIG, raw || {})
    if (typeof parsed.baseUrl === 'string') parsed.baseUrl = parsed.baseUrl.trim().replace(/\/+$/, '')
    else parsed.baseUrl = ''
    if (typeof parsed.serverHost === 'string' && parsed.serverHost.trim()) parsed.serverHost = parsed.serverHost.trim().replace(/\/+$/, '')
    else parsed.serverHost = ''
    if (typeof parsed.username !== 'string') parsed.username = ''
    if (typeof parsed.password !== 'string') parsed.password = ''
    if (Array.isArray(parsed.defaultSources)) {
      const set = new Set(_ALL_SOURCES)
      const filtered = parsed.defaultSources.filter((s) => set.has(String(s)))
      parsed.defaultSources = filtered.length ? filtered : DEFAULT_SOURCES.slice()
    } else {
      parsed.defaultSources = DEFAULT_SOURCES.slice()
    }
    const QUALITY_SET = new Set(['128k', '320k', 'flac', 'hires'])
    parsed.quality = QUALITY_SET.has(String(parsed.quality || '')) ? String(parsed.quality) : '128k'
    return parsed
  }

  async function getConfig() {
    if (_cachedConfig) return _cachedConfig
    try {
      const s = globalThis.songloft && globalThis.songloft.storage
      const val = s && await s.get(CONFIG_KEY)
      if (val) { _cachedConfig = normalizeConfig(JSON.parse(val)); return _cachedConfig }
    } catch (err) { console.error('[LxMusic] Failed to get config', String(err)) }
    _cachedConfig = normalizeConfig({})
    return _cachedConfig
  }
  async function saveConfig(config) {
    const normalized = normalizeConfig(config)
    const s = globalThis.songloft && globalThis.songloft.storage
    if (s) await s.set(CONFIG_KEY, JSON.stringify(normalized))
    _cachedConfig = normalized
  }
  function clearConfigCache() { _cachedConfig = null }

  // ==============================================
  // token.js — base64url encode/decode
  // ==============================================
  function bytesFromUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
    const out = []
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i)
      if (c < 0x80) out.push(c)
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
    }
    return new Uint8Array(out)
  }
  function utf8FromBytes(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes)
    let out = '', i = 0
    while (i < bytes.length) {
      const b = bytes[i]
      if (b < 0x80) { out += String.fromCharCode(b); i++ }
      else if ((b & 0xe0) === 0xc0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2 }
      else { out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3 }
    }
    return out
  }
  function toBase64url(bytes) {
    let bin = '', CHUNK = 8192
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
    let b64 = btoa(bin)
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  function fromBase64url(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  function encodeToken(payload) { return toBase64url(bytesFromUtf8(JSON.stringify(payload))) }
  function decodeToken(token) { return JSON.parse(utf8FromBytes(fromBase64url(token))) }

  // ==============================================
  // lxclient.js — lxserver HTTP client
  // ==============================================
  async function httpFetch(url, opts) {
    opts = opts || {}
    const method = opts.method || 'GET'
    const headers = Object.assign({}, opts.headers || {})
    const body = opts.body
    const timeout = opts.timeout || 8000
    const sf = (globalThis.songloft && globalThis.songloft.net && globalThis.songloft.net.fetch) || fetch
    let timer = null, abortSignal
    if (typeof AbortController !== 'undefined') {
      const ac = new AbortController(); abortSignal = ac.signal
      timer = setTimeout(() => ac.abort(), timeout)
    }
    try {
      const resp = await sf(url, { method, headers, body, signal: abortSignal, timeout })
      const bodyText = await resp.text()
      let bodyJson
      try { bodyJson = JSON.parse(bodyText) } catch { bodyJson = undefined }
      return { ok: (resp.ok || (resp.status >= 200 && resp.status < 300)), status: resp.status || 0, bodyText, bodyJson }
    } finally { if (timer) clearTimeout(timer) }
  }
  function buildAuthHeaders(config) {
    const h = {}
    if (config.username) h['x-user-name'] = config.username
    if (config.password) h['x-password'] = config.password
    return h
  }
  function buildUrl(base, path, query) {
    let qs = ''
    if (query) qs = '?' + Object.keys(query).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k]))).join('&')
    return base + path + qs
  }
  function normalizeDuration(raw) { if (typeof raw === 'number') return raw; if (typeof raw === 'string') { const n = parseInt(raw, 10); return isNaN(n) ? 0 : n } return 0 }
  function pickId(s) { return String(s.id ?? s.songmid ?? s.mid ?? s.hash ?? s.mediaMid ?? s.strMediaMid ?? s.copyrightId ?? s.encMediaId ?? ((s.name || '') + '-' + (s.singer || s.artist || ''))) }
  function normalizeSong(s) {
    return { source: String(s.source || ''), id: pickId(s), name: String(s.name || ''),
      artist: String(s.singer ?? s.singerName ?? s.artist ?? s.artistName ?? ''),
      album: String(s.album ?? s.albumName ?? ''), duration: normalizeDuration(s.duration ?? s.songTimeMinutes),
      cover: String(s.cover ?? s.pic ?? s.picId ?? s.albumPic ?? ''), raw: s }
  }

  async function searchSongsSingleSource(keyword, source, config, page, limit, timeoutMs) {
    page = page || 1; limit = limit || 20; timeoutMs = timeoutMs || 4000
    if (!config.baseUrl) throw new Error('lxserver baseUrl 未配置')
    const url = buildUrl(config.baseUrl, '/api/music/search', { name: keyword, source, type: 'song', page, limit })
    const r = await httpFetch(url, { method: 'GET', headers: buildAuthHeaders(config), timeout: timeoutMs })
    if (!r.ok || !r.bodyJson) throw new Error('lxserver 搜索失败 [source=' + source + ', status=' + r.status + ']')
    const list = Array.isArray(r.bodyJson.list) ? r.bodyJson.list : []
    return list.map((s) => Object.assign({}, s, { source })).map(normalizeSong)
  }
  async function searchFirstResult(keyword, sources, config, totalTimeoutMs, perSourceTimeoutMs) {
    totalTimeoutMs = totalTimeoutMs || 4500; perSourceTimeoutMs = perSourceTimeoutMs || 1500
    const startedAt = Date.now()
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const elapsed = Date.now() - startedAt
      const remaining = totalTimeoutMs - elapsed
      if (remaining <= 0) break
      const effective = Math.min(perSourceTimeoutMs, remaining)
      try {
        const results = await searchSongsSingleSource(keyword, source, config, 1, 5, effective)
        if (results.length > 0) return { song: results[0], source }
      } catch (e) { console.warn('[LxMusic] search source ' + source + ' failed: ' + String(e.message || e)) }
    }
    return null
  }
  async function searchSongsAggregated(keyword, sources, config, perSourceTimeoutMs, perSourceLimit, maxSources) {
    perSourceTimeoutMs = perSourceTimeoutMs || 2500; perSourceLimit = perSourceLimit || 10; maxSources = maxSources || 4
    const slice = sources.slice(0, maxSources)
    const tasks = slice.map((source) => searchSongsSingleSource(keyword, source, config, 1, perSourceLimit, perSourceTimeoutMs).catch(() => []))
    const results = await Promise.all(tasks)
    const out = []; const seen = new Set()
    for (let i = 0; i < perSourceLimit; i++) {
      for (let j = 0; j < results.length; j++) {
        const s = results[j][i]; if (!s) continue
        const key = s.source + '_' + s.id
        if (seen.has(key)) continue; seen.add(key); out.push(s)
      }
    }
    return out
  }
  async function getMusicUrl(songOrRaw, config, timeoutMs) {
    timeoutMs = timeoutMs || 15000
    if (!config.baseUrl) throw new Error('lxserver baseUrl 未配置')
    const songInfo = songOrRaw && songOrRaw.raw ? songOrRaw.raw : songOrRaw
    if (!songInfo || !songInfo.source) throw new Error('songInfo.source 缺失')
    const url = buildUrl(config.baseUrl, '/api/music/url')
    const body = JSON.stringify({ songInfo, quality: config.quality || '128k' })
    const r = await httpFetch(url, { method: 'POST', headers: buildAuthHeaders(config), body, timeout: timeoutMs })
    if (!r.ok || !r.bodyJson || !r.bodyJson.url) { console.warn('[LxMusic] getMusicUrl failed'); return null }
    return String(r.bodyJson.url)
  }
  async function getLyric(songOrRaw, config, timeoutMs) {
    timeoutMs = timeoutMs || 8000
    if (!config.baseUrl) return ''
    const songInfo = songOrRaw && songOrRaw.raw ? songOrRaw.raw : songOrRaw
    if (!songInfo || !songInfo.source) return ''
    const url = buildUrl(config.baseUrl, '/api/music/lyric')
    const body = JSON.stringify({ songInfo })
    const r = await httpFetch(url, { method: 'POST', headers: buildAuthHeaders(config), body, timeout: timeoutMs })
    if (!r.ok || !r.bodyJson) return ''
    return String(r.bodyJson.lyric || r.bodyJson.tlyric || '')
  }
  async function healthCheck(config) {
    if (!config.baseUrl) return { ok: false, msg: '未配置 lxserver 地址' }
    try {
      // 优先用 /api/status（lxserver 真实存在的端点），fallback 用 /api/music/search 探测
      let r = await httpFetch(buildUrl(config.baseUrl, '/api/status'), { method: 'GET', headers: buildAuthHeaders(config), timeout: 3000 })
      if (r.ok) return { ok: true, msg: 'lxserver 可达 (/api/status HTTP ' + r.status + ')' }
      // /api/status 失败（可能 401），用 /api/music/tipSearch 探测（公开端点，无需鉴权）
      r = await httpFetch(buildUrl(config.baseUrl, '/api/music/tipSearch?name=test&source=kw'), { method: 'GET', headers: buildAuthHeaders(config), timeout: 3000 })
      if (r.ok) return { ok: true, msg: 'lxserver 可达 (/api/music/tipSearch HTTP ' + r.status + ')' }
      return { ok: false, msg: 'lxserver 不可达 (HTTP ' + r.status + ')' }
    } catch (e) { return { ok: false, msg: String(e.message || e) } }
  }

  // ==============================================
  // router.js — All routes
  // ==============================================
  function bytesToString(bytes) { let out = '', CHUNK = 8192; for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))); return out }
  function parseBody(req) { if (!req.body) return {}; try { const str = typeof req.body === 'string' ? req.body : bytesToString(req.body); return JSON.parse(str) } catch { return {} } }
  function isLoopbackHost(h) { return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(h) }
  function isLoopbackUrl(u) { return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(u) }

  class SimpleCache {
    constructor(ttlMs, maxSize) { this.ttlMs = ttlMs; this.maxSize = maxSize; this.store = new Map() }
    get(k) { const e = this.store.get(k); if (!e) return; if (Date.now() - e.ts > this.ttlMs) { this.store.delete(k); return } return e.value }
    set(k, v) { if (this.store.size >= this.maxSize) { const fk = this.store.keys().next().value; this.store.delete(fk) } this.store.set(k, { ts: Date.now(), value: v }) }
    clear() { this.store.clear() }
  }
  const searchCache = new SimpleCache(60000, 100), toponeCache = new SimpleCache(60000, 100)
  const hitCache = new SimpleCache(600000, 100), lyricCache = new SimpleCache(86400000, 200)
  function clearAllCaches() { searchCache.clear(); toponeCache.clear(); hitCache.clear(); lyricCache.clear() }

  async function resolvePublicHost(config) {
    if (config.serverHost) return config.serverHost
    let baseHost = ''
    try { baseHost = new URL(config.baseUrl).hostname } catch {}
    let port = ''
    try { const hu = globalThis.songloft && globalThis.songloft.plugin && await globalThis.songloft.plugin.getHostUrl(); if (hu) port = new URL(hu).port } catch {}
    if (!port) port = '58091'
    if (baseHost && !isLoopbackHost(baseHost)) return 'http://' + baseHost + ':' + port
    let hostUrl = ''
    try { hostUrl = globalThis.songloft && globalThis.songloft.plugin && await globalThis.songloft.plugin.getHostUrl() || '' } catch {}
    if (hostUrl && !isLoopbackUrl(hostUrl)) { try { const u = new URL(hostUrl); return u.protocol + '//' + u.host } catch {} }
    if (isLoopbackUrl(hostUrl)) {
      try {
        const addrs = globalThis.songloft && globalThis.songloft.plugin && await globalThis.songloft.plugin.getNetworkAddresses()
        const lan = addrs && addrs[0]
        if (lan) { const u = new URL(hostUrl); return u.protocol + '//' + lan + (u.port ? ':' + u.port : '') }
      } catch {}
    }
    return null
  }
  function buildStreamUrl(base, token) { return base.replace(/\/+$/, '') + '/api/v1/jsplugin/lx-music-plugin/stream/' + encodeURIComponent(token) }
  async function makeDirectStreamUrl(song) {
    try { const config = await getConfig(); const publicHost = await resolvePublicHost(config)
      if (!publicHost) { console.log('[LxMusic] no reachable host'); return null }
      return buildStreamUrl(publicHost, encodeToken({ rawSong: song.raw }))
    } catch (e) { console.warn('[LxMusic] makeDirectStreamUrl:', String(e.message || e)); return null }
  }
  async function findHitByTitleArtist(title, artist, config) {
    const key = 'hit|' + title + '|' + artist
    const cached = hitCache.get(key)
    if (cached) return cached
    try {
      const sources = config.defaultSources || DEFAULT_SOURCES
      const hit = await searchFirstResult((title + ' ' + artist).trim(), sources, config, 4000, 1200)
      if (hit) { hitCache.set(key, hit.song); return hit.song }
    } catch (e) { console.warn('[LxMusic] findHit:', String(e.message || e)) }
    return null
  }

  function createRoutes() {
    const router = createRouter()

    // Config
    router.get('/config', async () => { const c = await getConfig(); const o = Object.assign({}, c); o.password = undefined; return jsonResponse(o) })
    router.post('/config', async (req) => { const data = parseBody(req); const c = await getConfig(); const nc = Object.assign({}, c, data); await saveConfig(nc); clearAllCaches(); const o = Object.assign({}, nc); o.password = undefined; return jsonResponse({ success: true, config: o }) })
    router.get('/health', async () => { const c = await getConfig(); const r = await healthCheck(c); return jsonResponse(r, r.ok ? 200 : 503) })

    // Host search (L2 fallback)
    router.post('/api/search', createSearchHandler({
      search: async (keyword, page, pageSize) => {
        page = page || 1; pageSize = pageSize || 20
        const c = await getConfig(); const ck = keyword + '|' + page + '|' + pageSize
        const cached = searchCache.get(ck); if (cached) return cached
        if (!c.baseUrl) return []
        const sources = c.defaultSources || DEFAULT_SOURCES
        const songs = await searchSongsAggregated(keyword, sources, c, 2000, 10, 3)
        const items = songs.map((s) => ({ title: s.name, artist: s.artist || 'Unknown', album: s.album || '', duration: s.duration, cover_url: s.cover || undefined, source_data: Object.assign({}, s.raw, { source: s.source }) }))
        searchCache.set(ck, items); return items
      },
    }))

    // Music URL resolver (host uses this for source_data playback)
    router.post('/api/music/url', async (req) => {
      const body = parseBody(req); let sourceData = body.source_data || body
      if (typeof sourceData === 'string') { try { sourceData = JSON.parse(sourceData) } catch { sourceData = undefined } }
      if (!sourceData || typeof sourceData !== 'object') return jsonResponse({ error: 'source_data is required' }, 400)
      const c = await getConfig(); if (!c.baseUrl) return jsonResponse({ error: 'lxserver 地址未配置' }, 400)
      try {
        const rawSong = sourceData.raw && typeof sourceData.raw === 'object' ? sourceData.raw : sourceData
        if (!rawSong.source) return jsonResponse({ error: 'source_data.source 缺失' }, 400)
        const url = await getMusicUrl(rawSong, c, 15000); if (!url) return jsonResponse({ error: 'source_not_available' }, 404)
        return jsonResponse({ url })
      } catch (e) { return jsonResponse({ error: String(e.message || e) }, 500) }
    })

    // Stream URL generation (frontend / topone call)
    router.post('/stream-url', async (req) => {
      const body = parseBody(req); const song = body.song || body.source_data
      if (!song || !song.source) return jsonResponse({ error: 'song.source is required' }, 400)
      try { const n = normalizeSong(song); const url = await makeDirectStreamUrl(n); return jsonResponse({ url: url || null }) }
      catch (e) { return jsonResponse({ error: String(e.message || e) }, 500) }
    })

    // /stream/:token — speaker direct play (publicPaths exempts auth)
    router.get('/stream/:token', async (req, params) => {
      const tok = String(params && params.token || '')
      if (!tok) return jsonResponse({ error: 'missing token' }, 400)
      let payload
      try { payload = decodeToken(tok) } catch { return jsonResponse({ error: 'invalid token' }, 400) }
      if (!payload || !payload.rawSong || !payload.rawSong.source) return jsonResponse({ error: 'invalid stream token' }, 400)
      try {
        const config = await getConfig()
        const upstream = await getMusicUrl(payload.rawSong, config, 15000)
        if (!upstream) return jsonResponse({ error: 'source_not_available' }, 404)
        return { statusCode: 302, headers: { Location: upstream, 'Cache-Control': 'no-store' }, body: '' }
      } catch (e) { return jsonResponse({ error: String(e.message || e) }, 500) }
    })

    // ======= miot external search core =======
    router.post('/api/search/topone', async (req) => {
      const body = parseBody(req); const keyword = String(body.keyword || '').trim()
      if (!keyword) return jsonResponse({ code: 1, msg: 'empty keyword', data: null })
      const ck = 'topone|' + keyword; const cached = toponeCache.get(ck); if (cached) return jsonResponse(cached)
      try {
        const config = await getConfig()
        if (!config.baseUrl) return jsonResponse({ code: 1, msg: 'lxserver 未配置', data: null })
        const sources = config.defaultSources || DEFAULT_SOURCES
        // Step 1: search across platforms (3s total)
        const found = await searchFirstResult(keyword, sources, config, 3000, 1000)
        if (!found) return jsonResponse({ code: 1, msg: 'no result', data: null })
        const song = found.song
        // Step 2: speaker direct stream URL (2s)
        const directUrl = await makeDirectStreamUrl(song)
        const payload = {
          code: 0, msg: 'ok',
          data: {
            title: song.name, artist: song.artist || '', album: song.album || '',
            duration: song.duration || 0, cover_url: song.cover || '',
            url: directUrl || '', plugin_entry_path: 'lx-music-plugin',
            source_data: Object.assign({}, song.raw, { source: song.source }),
            dedup_key: 'lx-music-' + song.source + '-' + song.id,
          },
        }
        toponeCache.set(ck, payload)
        return jsonResponse(payload)
      } catch (e) { return jsonResponse({ code: 1, msg: String(e.message || e), data: null }) }
    })

    // Lyric provider: GET /lyric-search?title=&artist=&album=&duration=
    router.get('/lyric-search', async (req) => {
      const config = await getConfig(); if (!config.baseUrl) return jsonResponse({ lyric: '' })
      const q = parseQuery(req.query); const title = q.title || '', artist = q.artist || ''
      const ck = 'lyric|' + title + '|' + artist; const cached = lyricCache.get(ck)
      if (cached !== undefined) return jsonResponse({ lyric: cached })
      const empty = { lyric: '' }
      try {
        const hit = await findHitByTitleArtist(title, artist, config)
        if (!hit) { lyricCache.set(ck, ''); return jsonResponse(empty) }
        const raw = await getLyric(hit, config, 5000); lyricCache.set(ck, raw || '')
        return jsonResponse({ lyric: raw || '' })
      } catch { lyricCache.set(ck, ''); return jsonResponse(empty) }
    })

    // Cover provider
    router.get('/cover-search', async (req) => {
      const config = await getConfig(); if (!config.baseUrl) return jsonResponse({ cover_url: '' })
      const q = parseQuery(req.query)
      try {
        const hit = await findHitByTitleArtist(q.title || '', q.artist || '', config)
        return jsonResponse({ cover_url: hit && hit.cover || '' })
      } catch { return jsonResponse({ cover_url: '' }) }
    })

    // Plugin self search page
    router.get('/search', async (req) => {
      const config = await getConfig(); const q = parseQuery(req.query)
      const keyword = q.q || ''; const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1)
      const pageSize = Math.max(1, parseInt(String(q.pageSize || '20'), 10) || 20)
      if (!keyword) return jsonResponse({ items: [], pagination: { page: 1, total: 0, totalPages: 1 } })
      if (!config.baseUrl) return jsonResponse({ items: [], pagination: { page: 1, total: 0, totalPages: 1 }, error: 'lxserver 未配置' })
      try {
        const sources = config.defaultSources || DEFAULT_SOURCES
        const all = await searchSongsAggregated(keyword, sources, config, 2000, 30, 4)
        const total = all.length, totalPages = Math.max(1, Math.ceil(total / pageSize))
        const start = (page - 1) * pageSize
        const items = all.slice(start, start + pageSize).map((s) => ({ id: s.id, name: s.name, artist: s.artist, album: s.album, cover: s.cover, source: s.source, duration: s.duration }))
        return jsonResponse({ items, pagination: { page, total, totalPages } })
      } catch (e) { return jsonResponse({ items: [], pagination: { page: 1, total: 0, totalPages: 1 }, error: String(e.message || e) }) }
    })

    return router
  }

  // ==============================================
  // main.js — Lifecycle & HTTP entry
  // ==============================================
  function registerSearchProviderToMiot() {
    let attempts = 0
    const tryRegister = async () => {
      attempts++
      try {
        const comm = globalThis.songloft && globalThis.songloft.comm
        if (!comm || typeof comm.call !== 'function') {
          console.log('[LxMusic] comm 不可用，跳过 miot 注册（尝试 ' + attempts + '/5）')
          if (attempts < 5) setTimeout(tryRegister, 3000); return
        }
        await comm.call('miot', 'register-search-provider', { name: 'LxMusic', searchPath: '/api/search/topone' })
        console.log('[LxMusic] 已向 miot 注册搜索源候选')
      } catch (e) {
        if (attempts < 5) setTimeout(tryRegister, 3000)
        else console.warn('[LxMusic] miot 未安装/未就绪，放弃注册: ' + String(e))
      }
    }
    setTimeout(tryRegister, 2000)
  }

  const _router = createRoutes()

  async function onInit() {
    console.log('[LxMusic] Plugin Mounted')
    try {
      const s = globalThis.songloft
      if (s && s.lyrics && typeof s.lyrics.registerProvider === 'function') {
        s.lyrics.registerProvider(); console.log('[LxMusic] registered as lyric provider')
      }
    } catch (e) { console.warn('[LxMusic] lyric register:', String(e)) }
    try {
      const c = globalThis.songloft && globalThis.songloft.covers
      if (c && typeof c.registerProvider === 'function') {
        c.registerProvider(); console.log('[LxMusic] registered as cover provider')
      }
    } catch (e) { console.warn('[LxMusic] cover register:', String(e)) }
    registerSearchProviderToMiot()
  }

  async function onDeinit() {
    try {
      const s = globalThis.songloft
      if (s && s.lyrics && typeof s.lyrics.unregisterProvider === 'function') s.lyrics.unregisterProvider()
      if (s && s.covers && typeof s.covers.unregisterProvider === 'function') s.covers.unregisterProvider()
    } catch {}
    console.log('[LxMusic] Plugin Unmounted')
  }

  async function onHTTPRequest(req) {
    return _router.handle(req)
  }

  globalThis.onInit = onInit
  globalThis.onDeinit = onDeinit
  globalThis.onHTTPRequest = onHTTPRequest
})();
