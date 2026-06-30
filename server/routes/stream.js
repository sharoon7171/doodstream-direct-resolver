import { fetchStream } from '../http/client.js';
import { sendJson } from '../lib/http-response.js';

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
    }
    const upstream = await fetchStream(directLink, headers);
    const responseHeaders = {
      'Content-Type': upstream.headers['content-type'] ?? 'video/mp4',
      'Accept-Ranges': upstream.headers['accept-ranges'] ?? 'bytes',
      'Cache-Control': 'no-store',
    };
    if (upstream.headers['content-range']) {
      responseHeaders['Content-Range'] = upstream.headers['content-range'];
    }
    if (upstream.headers['content-length']) {
      responseHeaders['Content-Length'] = upstream.headers['content-length'];
    }
    response.writeHead(upstream.statusCode, responseHeaders);
    upstream.stream.pipe(response);
  } catch (error) {
    sendJson(response, 502, { error: error.message || 'Proxy playback failed' });
  }
}
