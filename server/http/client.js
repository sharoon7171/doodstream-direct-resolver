import http2 from 'node:http2';
import https from 'node:https';
import tls from 'node:tls';
import {
  brotliDecompress as brotliStream,
  brotliDecompressSync,
  createGunzip,
  createUnzip,
  gunzipSync,
} from 'node:zlib';
import { documentHeaders, fetchHeaders } from './browser-headers.js';

const SSL_OP_TLSEXT_PADDING = 1 << 4;
const SSL_OP_NO_ENCRYPT_THEN_MAC = 1 << 19;

const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const CHROME_H2_SETTINGS = {
  headerTableSize: 65536,
  enablePush: false,
  initialWindowSize: 6291456,
  maxFrameSize: 16384,
  maxConcurrentStreams: 1000,
  maxHeaderListSize: 262144,
};

const sessions = new Map();

function chromeTlsOptions(hostname) {
  return {
    host: hostname,
    port: 443,
    servername: hostname,
    ALPNProtocols: ['h2', 'http/1.1'],
    ciphers: CHROME_CIPHERS,
    sigalgs:
      'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512',
    ecdhCurve: 'X25519:prime256v1:secp384r1',
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    secureOptions: SSL_OP_TLSEXT_PADDING | SSL_OP_NO_ENCRYPT_THEN_MAC,
  };
}

function getSession(origin) {
  if (sessions.has(origin)) {
    const session = sessions.get(origin);
    if (!session.closed && !session.destroyed) {
      return session;
    }
    sessions.delete(origin);
  }
  const url = new URL(origin);
  const session = http2.connect(origin, {
    settings: CHROME_H2_SETTINGS,
    createConnection: () => tls.connect(chromeTlsOptions(url.hostname)),
  });
  session.on('error', () => sessions.delete(origin));
  session.on('close', () => sessions.delete(origin));
  sessions.set(origin, session);
  return session;
}

function decodeBody(buffer, encoding) {
  if (encoding === 'br') {
    return brotliDecompressSync(buffer);
  }
  if (encoding === 'gzip') {
    return gunzipSync(buffer);
  }
  return buffer;
}

function bodyDecompressStream(encoding) {
  if (encoding === 'br') {
    return brotliStream();
  }
  if (encoding === 'gzip') {
    return createGunzip();
  }
  if (encoding === 'deflate') {
    return createUnzip();
  }
  return null;
}

function h2Request(urlStr, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const session = getSession(url.origin);
    const req = session.request({
      ':method': 'GET',
      ':path': `${url.pathname}${url.search}`,
      ':authority': url.host,
      ':scheme': 'https',
      ...headers,
    });
    const chunks = [];
    req.on('response', (responseHeaders) => {
      const status = Number(responseHeaders[':status']);
      if ([301, 302, 307, 308].includes(status) && responseHeaders.location && redirects < 10) {
        req.close();
        h2Request(new URL(responseHeaders.location, url).href, headers, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status,
          url: urlStr,
          headers: responseHeaders,
          body: decodeBody(raw, responseHeaders['content-encoding']).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function h1Request(urlStr, headers, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        servername: url.hostname,
        ...chromeTlsOptions(url.hostname),
        ALPNProtocols: ['http/1.1'],
      },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 10) {
          res.resume();
          h1Request(new URL(res.headers.location, url).href, headers, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            url: urlStr,
            headers: res.headers,
            body: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function fetchText(urlStr, extraHeaders = {}, mode = 'document') {
  const headers =
    mode === 'fetch'
      ? { ...fetchHeaders(), ...extraHeaders }
      : { ...documentHeaders(), ...extraHeaders };
  try {
    return await h2Request(urlStr, headers);
  } catch {
    return h1Request(urlStr, headers);
  }
}

export function fetchStream(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const tryH1 = () => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { ...fetchHeaders(), ...extraHeaders },
          servername: url.hostname,
          ...chromeTlsOptions(url.hostname),
          ALPNProtocols: ['http/1.1'],
        },
        (res) => {
          const decompressor = bodyDecompressStream(res.headers['content-encoding']);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            stream: decompressor ? (res.pipe(decompressor), decompressor) : res,
          });
        },
      );
      req.on('error', reject);
      req.end();
    };
    const tryH2 = () => {
      const session = getSession(url.origin);
      const req = session.request({
        ':method': 'GET',
        ':path': `${url.pathname}${url.search}`,
        ':authority': url.host,
        ':scheme': 'https',
        ...fetchHeaders(),
        ...extraHeaders,
      });
      req.on('response', (responseHeaders) => {
        const decompressor = bodyDecompressStream(responseHeaders['content-encoding']);
        resolve({
          statusCode: Number(responseHeaders[':status']),
          headers: {
            'content-type': responseHeaders['content-type'],
            'content-range': responseHeaders['content-range'],
            'content-length': responseHeaders['content-length'],
            'accept-ranges': responseHeaders['accept-ranges'],
          },
          stream: decompressor ? (req.pipe(decompressor), decompressor) : req,
        });
      });
      req.on('error', tryH1);
      req.end();
    };
    tryH2();
  });
}
