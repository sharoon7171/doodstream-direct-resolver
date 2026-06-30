import { parseVideoId } from '../../lib/parse-video-id.js';
import { resolveDirectLink, verifyDirectLink } from '../doodstream/resolver.js';
import { readJsonBody, sendJson } from '../lib/http-response.js';

export async function handleResolve(request, response) {
  try {
    const body = await readJsonBody(request);
    const videoId = parseVideoId(body.videoId ?? '');
    const result = await resolveDirectLink(videoId);
    const verification = await verifyDirectLink(result.directLink, result.referer);
    if (!verification.ok) {
      sendJson(response, 502, { error: `Direct link check failed (HTTP ${verification.status})` });
      return;
    }
    sendJson(response, 200, {
      videoId: result.videoId,
      title: result.title,
      directLink: result.directLink,
      referer: result.referer,
      contentLength: verification.contentLength,
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message || 'Could not resolve direct link' });
  }
}
