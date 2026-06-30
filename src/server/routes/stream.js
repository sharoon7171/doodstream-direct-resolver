import { fetchStream } from '../http/client.js';
import { sendJson } from '../lib/http-response.js';

function upstreamHeaders(headers) {
  const next = {
    'Content-Type': headers['content-type'] ?? 'video/mp4',
    'Accept-Ranges': headers['accept-ranges'] ?? 'bytes',
    'Cache-Control': 'no-store',
  };
  if (headers['content-range']) {
    next['Content-Range'] = headers['content-range'];
  }
  if (headers['content-length']) {
    next['Content-Length'] = headers['content-length'];
  }
  return next;
}

export async function handleStream(request, response, url) {
  const directLink = url.searchParams.get('url');
  const referer = url.searchParams.get('referer');
  if (!directLink || !referer) {
    sendJson(response, 400, { error: 'Direct link URL and referer are required' });
    return;
  }
  try {
    const headers = { referer };
    if (request.headers.range) {
      headers.range = request.headers.range;
    } else if (request.method === 'HEAD') {
      headers.range = 'bytes=0-0';
    }
    const upstream = await fetchStream(directLink, headers);
    response.writeHead(upstream.statusCode, upstreamHeaders(upstream.headers));
    if (request.method === 'HEAD') {
      upstream.stream.resume();
      response.end();
      return;
    }
    upstream.stream.pipe(response);
  } catch (error) {
    sendJson(response, 502, { error: error.message || 'Proxy playback failed' });
  }
}
