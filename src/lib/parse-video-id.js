const VIDEO_ID_RE = /^[a-z0-9]+$/i;

export function parseVideoId(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a video ID');
  }
  if (!VIDEO_ID_RE.test(trimmed)) {
    throw new Error('Enter a valid video ID');
  }
  return trimmed;
}
