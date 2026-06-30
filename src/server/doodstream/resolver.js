import { fetchText } from '../http/client.js';

const BOOTSTRAP_ORIGIN = 'https://doodstream.com';
const RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASS_MD5_INLINE_RE = /\$\.get\(['"](\/pass_md5\/[^'"]+)['"]/;
const PASS_MD5_QUOTED_RE = /'(\/pass_md5\/[^']+)'/;
const PASS_MD5_BARE_RE = /\/pass_md5\/[a-z0-9-]+\/[a-z0-9]+/i;
const PASS_MD5_PATH_RE = /\/pass_md5\/([a-z0-9-]+)\/([a-z0-9]+)/i;
const TOKEN_MAKEPLAY_RE = /\?token=([a-z0-9]+)&expiry=/;
const META_RE = (key) => new RegExp(
  `<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["']`,
  'i',
);

function buildDirectLink(cdnPrefix, token, now = Date.now()) {
  let suffix = '';
  for (let i = 0; i < 10; i += 1) {
    suffix += RANDOM_ALPHABET.charAt(Math.floor(Math.random() * RANDOM_ALPHABET.length));
  }
  return `${cdnPrefix}${suffix}?token=${token}&expiry=${now}`;
}

function readMeta(html, key) {
  const match = html.match(META_RE(key));
  return match?.[1] ?? match?.[2] ?? null;
}

function extractPassMd5Path(html) {
  return html.match(PASS_MD5_INLINE_RE)?.[1]
    ?? html.match(PASS_MD5_QUOTED_RE)?.[1]
    ?? html.match(PASS_MD5_BARE_RE)?.[0]
    ?? null;
}

function extractPlaybackToken(html, passMd5Path) {
  return html.match(TOKEN_MAKEPLAY_RE)?.[1]
    ?? passMd5Path?.match(PASS_MD5_PATH_RE)?.[2]
    ?? null;
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

function decodePassMd5Response(body) {
  const trimmed = body.trim();
  if (trimmed === 'RELOAD') {
    throw new Error('Session expired, try again');
  }
  if (!trimmed.startsWith('http')) {
    throw new Error('Rate limited or token already used, try again');
  }
  return trimmed;
}

export async function resolveDirectLink(videoId) {
  const embedPage = await fetchText(`${BOOTSTRAP_ORIGIN}/e/${videoId}`, {}, 'document');
  if (embedPage.status >= 400) {
    throw new Error(`Could not load embed page (HTTP ${embedPage.status})`);
  }
  if (/video not found/i.test(readMeta(embedPage.body, 'og:title') ?? embedPage.body.slice(0, 500))) {
    throw new Error('Video not found or removed');
  }
  const origin = new URL(embedPage.url).origin;
  const embed = decodeEmbedPage(embedPage.body);
  const passMd5Response = await fetchText(
    `${origin}${embed.passMd5Path}`,
    { referer: `${origin}/e/${videoId}` },
    'fetch',
  );
  return {
    videoId,
    title: readMeta(embedPage.body, 'og:title') ?? readMeta(embedPage.body, 'twitter:title'),
    directLink: buildDirectLink(decodePassMd5Response(passMd5Response.body), embed.playbackToken),
    referer: `${origin}/`,
  };
}

export async function verifyDirectLink(directLink, referer) {
  const response = await fetchText(directLink, { referer, range: 'bytes=0-15' }, 'fetch');
  return {
    ok: response.status === 206 || response.status === 200,
    status: response.status,
    contentLength: response.headers['content-range']?.split('/').pop() ?? null,
  };
}
