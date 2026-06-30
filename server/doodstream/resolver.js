import { fetchText } from '../http/client.js';

const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASS_MD5_INLINE_RE = /\$\.get\(['"](\/pass_md5\/[^'"]+)['"]/;
const PASS_MD5_QUOTED_RE = /'(\/pass_md5\/[^']+)'/;
const PASS_MD5_PATH_RE = /\/pass_md5\/([a-z0-9-]+)\/([a-z0-9]+)/i;
const TOKEN_MAKEPLAY_RE = /\?token=([a-z0-9]+)&expiry=/;

function buildDirectLink(cdnPrefix, token, now = Date.now()) {
  let suffix = '';
  for (let i = 0; i < 10; i += 1) {
    suffix += RANDOM_ALPHABET.charAt(Math.floor(Math.random() * RANDOM_ALPHABET.length));
  }
  return `${cdnPrefix}${suffix}?token=${token}&expiry=${now}`;
}

function extractPassMd5Path(html) {
  const inline = html.match(PASS_MD5_INLINE_RE);
  if (inline) {
    return inline[1];
  }
  const quoted = html.match(PASS_MD5_QUOTED_RE);
  if (quoted) {
    return quoted[1];
  }
  const bare = html.match(/\/pass_md5\/[a-z0-9-]+\/[a-z0-9]+/i);
  return bare?.[0] ?? null;
}

function extractPlaybackToken(html, passMd5Path) {
  const fromMakePlay = html.match(TOKEN_MAKEPLAY_RE);
  if (fromMakePlay) {
    return fromMakePlay[1];
  }
  const fromPath = passMd5Path?.match(PASS_MD5_PATH_RE);
  return fromPath?.[2] ?? null;
}

function decodePassMd5Response(body) {
  const trimmed = body.trim();
  if (trimmed === 'RELOAD') {
    return { reload: true, cdnPrefix: null };
  }
  if (!trimmed.startsWith('http')) {
    return { reload: false, cdnPrefix: null };
  }
  return { reload: false, cdnPrefix: trimmed };
}

function decodeEmbedPage(html) {
  const passMd5Path = extractPassMd5Path(html);
  if (!passMd5Path) {
    throw new Error('Could not read embed player data');
  }
  const playbackToken = extractPlaybackToken(html, passMd5Path);
  if (!playbackToken) {
    throw new Error('Could not read playback token');
  }
  return { passMd5Path, playbackToken };
}

function readMeta(html, key) {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["']`,
    'i',
  );
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

export async function resolveDirectLink(mirrorUrl, videoId) {
  const origin = new URL(mirrorUrl).origin;
  const embedPage = await fetchText(`${origin}/e/${videoId}`, {}, 'document');
  if (embedPage.status >= 400) {
    throw new Error(`Could not load embed page (HTTP ${embedPage.status})`);
  }
  if (/video not found/i.test(readMeta(embedPage.body, 'og:title') ?? embedPage.body.slice(0, 500))) {
    throw new Error('Video not found or removed');
  }
  const canonicalOrigin = new URL(embedPage.url).origin;
  const embed = decodeEmbedPage(embedPage.body);
  const passMd5Response = await fetchText(
    `${canonicalOrigin}${embed.passMd5Path}`,
    { referer: `${canonicalOrigin}/e/${videoId}` },
    'fetch',
  );
  const passMd5 = decodePassMd5Response(passMd5Response.body);
  if (passMd5.reload) {
    throw new Error('Session expired, try again');
  }
  if (!passMd5.cdnPrefix) {
    throw new Error('Rate limited or token already used, try again');
  }
  return {
    videoId,
    title: readMeta(embedPage.body, 'og:title') ?? readMeta(embedPage.body, 'twitter:title'),
    directLink: buildDirectLink(passMd5.cdnPrefix, embed.playbackToken),
    referer: `${canonicalOrigin}/`,
  };
}

export async function verifyDirectLink(directLink, referer) {
  const response = await fetchText(
    directLink,
    { referer, range: 'bytes=0-15' },
    'fetch',
  );
  return {
    ok: response.status === 206 || response.status === 200,
    status: response.status,
    contentLength: response.headers['content-range']?.split('/').pop() ?? null,
  };
}
