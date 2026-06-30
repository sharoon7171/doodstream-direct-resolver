export function parseMirrorUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Paste a DoodStream mirror URL');
  }
  const mirrorUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(mirrorUrl);
  } catch {
    throw new Error('Enter a valid URL');
  }
  const match = parsed.pathname.match(/\/(?:e|d)\/([a-z0-9]+)/i);
  if (!match) {
    throw new Error('URL must be a DoodStream /e/ or /d/ link');
  }
  return {
    videoId: match[1],
    mirrorUrl: parsed.href,
  };
}
