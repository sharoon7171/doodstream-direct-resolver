# DoodStream Direct Link Resolver

Zero-dependency Node.js service that resolves DoodStream mirror URLs to direct CDN MP4 links. The implementation reverse-engineers the embed player handshake and replays it with a native Chrome-fingerprint HTTP client — no npm dependencies, no headless browser, no captcha automation.

## Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js (ES modules) |
| HTTP server | `node:http` |
| Upstream client | `node:http2`, `node:https`, `node:tls`, `node:zlib` |
| Frontend | Static HTML/CSS/ES module (served by the same process) |

```bash
npm start          # node server/index.js
PORT=8787 npm start
```

Default listen address: `http://localhost:8787`

## Architecture

```mermaid
flowchart TB
  subgraph client [Browser / API consumer]
    UI[public/app.js]
    API[POST /api/resolve]
    Proxy[GET /api/stream]
  end

  subgraph server [server/]
    Index[server/index.js]
    ResolveRoute[routes/resolve.js]
    StreamRoute[routes/stream.js]
    Resolver[doodstream/resolver.js]
    HttpClient[http/client.js]
    Headers[http/browser-headers.js]
    HttpResp[lib/http-response.js]
  end

  subgraph shared [lib/]
    ParseUrl[parse-mirror-url.js]
  end

  subgraph external [External]
    Mirror[DoodStream mirror / Cloudflare]
    CDN[CDN origin]
  end

  UI --> ParseUrl
  UI --> API
  UI --> Proxy
  API --> Index
  Proxy --> Index
  Index --> ResolveRoute
  Index --> StreamRoute
  ResolveRoute --> ParseUrl
  ResolveRoute --> Resolver
  StreamRoute --> HttpClient
  Resolver --> HttpClient
  HttpClient --> Headers
  ResolveRoute --> HttpResp
  StreamRoute --> HttpResp
  HttpClient --> Mirror
  HttpClient --> CDN
  Proxy --> CDN
```

### Module map

```
/
├── lib/
│   └── parse-mirror-url.js       URL validation; extracts videoId + mirrorUrl (/e/ or /d/)
├── server/
│   ├── index.js                  Entry point: API routing + static file server
│   ├── lib/
│   │   └── http-response.js      readJsonBody, sendJson
│   ├── routes/
│   │   ├── resolve.js            POST /api/resolve orchestration
│   │   └── stream.js             GET /api/stream byte proxy
│   ├── doodstream/
│   │   └── resolver.js           Embed decode, pass_md5, direct link build, verification
│   └── http/
│       ├── client.js             Chrome TLS + HTTP/2 client (fetchText, fetchStream)
│       └── browser-headers.js    document vs fetch header profiles
└── public/
    ├── index.html                Dev/test UI shell
    ├── app.js                    Resolve client, copy links, proxy playback
    └── app.css
```

### Responsibilities

| Module | Role |
| --- | --- |
| `parse-mirror-url.js` | Single parser shared by server route and browser client for consistent validation |
| `server/index.js` | Routes `POST /api/resolve`, `GET /api/stream`, serves `/public` and `/lib` |
| `routes/resolve.js` | Parses input, calls resolver, verifies link, returns JSON |
| `routes/stream.js` | Proxies CDN range requests with injected `Referer` |
| `doodstream/resolver.js` | Implements the DoodStream embed → CDN URL protocol |
| `http/client.js` | All upstream HTTPS; session pooling; H2 primary, H1 fallback |
| `http/browser-headers.js` | Chrome 131 UA + `sec-*` headers for document and XHR-like modes |
| `public/app.js` | Integration reference for the two API endpoints |

## Resolve pipeline

DoodStream serves plain `video/mp4` on the CDN. Access control is at **URL discovery** and **CDN Referer checks**, not stream encryption.

```mermaid
sequenceDiagram
  participant R as routes/resolve.js
  participant V as doodstream/resolver.js
  participant H as http/client.js
  participant M as Mirror (Cloudflare)
  participant C as CDN

  R->>V: resolveDirectLink(mirrorUrl, videoId)
  V->>H: fetchText GET /e/{id} (document mode)
  H->>M: Chrome TLS + H2
  M-->>H: embed HTML
  V->>V: decodeEmbedPage(html)
  Note over V: passMd5Path, playbackToken
  V->>H: fetchText GET /pass_md5/... (fetch mode, Referer)
  H->>M: Chrome TLS + H2
  M-->>H: plaintext CDN prefix
  V->>V: buildDirectLink(prefix, token)
  R->>V: verifyDirectLink(directLink, referer)
  V->>H: fetchText Range bytes=0-15 (fetch mode, Referer)
  H->>C: Chrome TLS + H2
  C-->>H: 206 Partial Content
  R-->>R: JSON response
```

### Step-by-step (resolver.js)

1. **`GET {origin}/e/{videoId}`** — document headers; follows redirects; canonical origin taken from final URL.
2. **`decodeEmbedPage(html)`** — regex extraction of:
   - `/pass_md5/{hash}/{token}` path (inline `$.get`, quoted string, or bare path)
   - playback token from `makePlay()` query string or pass_md5 path segment
3. **`GET {origin}{passMd5Path}`** — fetch headers; `Referer: {origin}/e/{videoId}`.
4. **`decodePassMd5Response(body)`** — body is either:
   - plaintext `https://...` CDN prefix
   - `RELOAD` (session expired)
   - non-URL text (rate limit / token reuse)
5. **`buildDirectLink(cdnPrefix, token)`** — mirrors site player: 10 random `[A-Za-z0-9]` + `?token={token}&expiry={Date.now()}`.
6. **`verifyDirectLink`** — `Range: bytes=0-15` against CDN with `Referer: {origin}/`; requires HTTP 200 or 206; reads total size from `Content-Range`.

No WASM, no secondary decrypt pass on media bytes.

## HTTP client and Cloudflare

Mirror hosts reject default Node/curl TLS fingerprints with **403**. `http/client.js` impersonates Chrome at the transport layer:

| Mechanism | Implementation |
| --- | --- |
| TLS ciphers | Chrome cipher suite order via `tls.connect` |
| TLS extensions | `SSL_OP_TLSEXT_PADDING`, `SSL_OP_NO_ENCRYPT_THEN_MAC`, X25519/P-256 curves |
| ALPN | `h2`, `http/1.1` |
| HTTP/2 | Chrome SETTINGS (window 6291456, max streams 1000, etc.) |
| Sessions | Per-origin H2 session cache in `sessions` Map |
| Fallback | H2 failure → H1 with same TLS profile |
| Headers | `documentHeaders()` for page loads; `fetchHeaders()` for API/CDN |
| Compression | br/gzip/deflate decode on text (`fetchText`) and streaming (`fetchStream`) |

`fetchText(url, extraHeaders, mode)` — buffered response for HTML and pass_md5.  
`fetchStream(url, extraHeaders)` — streaming response for CDN proxy; forwards `Range`.

## Stream proxy

The CDN enforces **`Referer: {mirror-origin}/`**. Browsers cannot set a cross-origin Referer on `<video src>`, so in-page playback uses a local relay:

```
GET /api/stream?url={encodeURIComponent(directLink)}&referer={encodeURIComponent(referer)}
```

`routes/stream.js` forwards the browser's `Range` header, fetches upstream via `fetchStream`, and pipes bytes back with `Content-Range` / `Content-Length` preserved.

Direct CDN access (outside the browser) only requires attaching the `referer` field from the resolve response.

## API contract

### `POST /api/resolve`

Request:

```http
POST /api/resolve
Content-Type: application/json

{"url": "https://playmogo.com/e/5x50byl1sld3"}
```

Success `200`:

```json
{
  "videoId": "5x50byl1sld3",
  "title": "string | null",
  "directLink": "https://cdn.../....mp4?token=...&expiry=...",
  "referer": "https://playmogo.com/",
  "contentLength": "399715618"
}
```

Errors:

| Status | Cause |
| --- | --- |
| `400` | Invalid URL, missing embed data, pass_md5 failure, verification error |
| `502` | CDN verification returned non-200/206 |

### `GET /api/stream`

Query params: `url` (direct CDN link), `referer` (from resolve response).

Forwards `Range` from client. Returns upstream status and video headers. `502` on upstream failure.

## Frontend integration (public/app.js)

Reference flow for consumers building on the API:

1. Validate with `parseMirrorUrl` from `/lib/parse-mirror-url.js`
2. `POST /api/resolve` → receive `directLink`, `referer`, `contentLength`
3. **Direct use:** pass `directLink` + `Referer: referer` to any HTTP client
4. **Browser playback:** set `<video src>` to `/api/stream?url=...&referer=...` (same-origin proxy)

## Development notes

- **Zero deps:** no `package-lock.json`; nothing to install beyond Node.
- **Token single-use:** pass_md5 tokens and direct links can fail on retry; resolve fresh per attempt.
- **Mirror agnostic:** any DoodStream mirror sharing the `/e/` + `/pass_md5/` embed pattern works; origin is derived from the input URL.
- **Static serving:** `server/index.js` exposes `public/` at root paths and `lib/` at `/lib/*` for shared browser modules.

## Disclaimer

This repository is provided for **educational and research purposes** only, to document embed-player URL resolution, TLS client fingerprinting, and CDN access patterns. You are responsible for compliance with applicable laws, site terms of service, and copyright in your jurisdiction. Do not use this code to access, redistribute, or monetize content without authorization. The authors assume no liability for misuse.
