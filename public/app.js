import { parseMirrorUrl } from '/lib/parse-mirror-url.js';

const form = document.getElementById('resolve-form');
const urlInput = document.getElementById('url-input');
const statusEl = document.getElementById('status');
const resultSection = document.getElementById('result-section');
const video = document.getElementById('video');
const metaEl = document.getElementById('meta');
const submitBtn = document.getElementById('submit-btn');
const resolveTimeEl = document.getElementById('resolve-time');
const playTimeEl = document.getElementById('play-time');
const directLinkEl = document.getElementById('direct-link');
const proxyLinkEl = document.getElementById('proxy-link');

let playTimerStart = 0;
let playTimerPending = false;
let playSession = 0;

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : 'status';
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(value) {
  if (!value) return '';
  const size = Number(value);
  if (Number.isNaN(size)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = size;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function setLink(el, url) {
  el.textContent = url;
  el.dataset.url = url;
}

async function copyLink(button) {
  const targetId = button.dataset.copyTarget;
  const el = document.getElementById(targetId);
  const url = el?.dataset.url || el?.textContent || '';
  if (!url) {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = label;
    }, 1200);
  } catch {
    setStatus('Copy failed', 'error');
  }
}

function resetResult() {
  resultSection.hidden = true;
  video.removeAttribute('src');
  video.load();
  metaEl.textContent = '';
  resolveTimeEl.textContent = '—';
  playTimeEl.textContent = '—';
  directLinkEl.textContent = '';
  directLinkEl.removeAttribute('data-url');
  proxyLinkEl.textContent = '';
  proxyLinkEl.removeAttribute('data-url');
  playTimerPending = false;
  playSession += 1;
}

function finishPlayTimer(session) {
  if (!playTimerPending || session !== playSession) {
    return;
  }
  playTimerPending = false;
  playTimeEl.textContent = formatMs(performance.now() - playTimerStart);
  setStatus('Direct link ready · test playback running', 'ok');
}

function watchFirstFrame(session) {
  const onFrame = () => finishPlayTimer(session);
  video.addEventListener('playing', onFrame, { once: true });
  video.addEventListener('loadeddata', () => {
    if (video.readyState >= 2) {
      onFrame();
    }
  }, { once: true });
}

function buildProxyUrl(directLink, referer) {
  const params = new URLSearchParams({
    url: directLink,
    referer,
  });
  return `/api/stream?${params}`;
}

async function resolveMirrorUrl(rawUrl) {
  setStatus('Resolving direct link…');
  submitBtn.disabled = true;
  resetResult();

  const resolveStart = performance.now();
  const session = playSession;

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    resolveTimeEl.textContent = formatMs(performance.now() - resolveStart);

    const proxyPath = buildProxyUrl(payload.directLink, payload.referer);
    const absoluteProxyUrl = new URL(proxyPath, window.location.origin).href;

    setLink(directLinkEl, payload.directLink);
    setLink(proxyLinkEl, absoluteProxyUrl);

    resultSection.hidden = false;

    const parts = [
      payload.title,
      payload.contentLength ? formatBytes(payload.contentLength) : '',
      payload.videoId ? `ID ${payload.videoId}` : '',
    ].filter(Boolean);
    metaEl.textContent = parts.join(' · ');

    playTimerStart = performance.now();
    playTimerPending = true;
    playTimeEl.textContent = '…';
    setStatus('Direct link ready · starting test playback…');

    watchFirstFrame(session);

    video.src = proxyPath;
    video.load();

    try {
      await video.play();
    } catch {
      setStatus('Direct link ready · tap play to start', 'ok');
    }
  } catch (error) {
    setStatus(error.message || 'Could not resolve direct link', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    parseMirrorUrl(urlInput.value);
  } catch (error) {
    setStatus(error.message, 'error');
    return;
  }
  resolveMirrorUrl(urlInput.value.trim());
});

video.addEventListener('error', () => {
  playTimerPending = false;
  if (video.error) {
    setStatus(`Test playback failed (${video.error.code})`, 'error');
  }
});

document.querySelectorAll('.copy-btn').forEach((button) => {
  button.addEventListener('click', () => copyLink(button));
});
