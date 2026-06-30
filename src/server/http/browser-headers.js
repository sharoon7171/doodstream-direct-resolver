const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CLIENT_HINTS = {
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

function chromeHeaders(accept, dest, mode, site, extra = {}) {
  return {
    'user-agent': USER_AGENT,
    accept,
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    ...CLIENT_HINTS,
    'sec-fetch-dest': dest,
    'sec-fetch-mode': mode,
    'sec-fetch-site': site,
    ...extra,
  };
}

export function documentHeaders() {
  return chromeHeaders(
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'document',
    'navigate',
    'none',
    { 'sec-fetch-user': '?1', 'upgrade-insecure-requests': '1', priority: 'u=0, i' },
  );
}

export function fetchHeaders() {
  return chromeHeaders('*/*', 'empty', 'cors', 'same-origin');
}
