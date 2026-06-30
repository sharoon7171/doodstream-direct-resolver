import { parseVideoId } from '/lib/parse-video-id.js';

const form = document.getElementById('resolve-form');
const videoIdInput = document.getElementById('video-id-input');
const statusEl = document.getElementById('status');
const resultSection = document.getElementById('result-section');
const timersEl = document.getElementById('timers');
const video = document.getElementById('video');
const metaEl = document.getElementById('meta');
const submitBtn = document.getElementById('submit-btn');
const resolveTimeEl = document.getElementById('resolve-time');
const playTimeEl = document.getElementById('play-time');
const directLinkEl = document.getElementById('direct-link');
const proxyLinkEl = document.getElementById('proxy-link');

let playSession = 0;
let playTimer = { id: 0, start: 0, active: false };
let resolveTimer = { id: 0, start: 0 };

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

function stopTimer(timer) {
  if (timer.id) {
    cancelAnimationFrame(timer.id);
    timer.id = 0;
  }
}

function startTimer(timer, el, isActive) {
  stopTimer(timer);
  timer.start = performance.now();
  const tick = () => {
    if (!isActive()) {
      stopTimer(timer);
      return;
    }
    el.textContent = formatMs(performance.now() - timer.start);
    timer.id = requestAnimationFrame(tick);
  };
  timer.id = requestAnimationFrame(tick);
}

function freezeTimer(timer, el) {
  stopTimer(timer);
  el.textContent = formatMs(performance.now() - timer.start);
}

function setLink(el, url) {
  el.textContent = url;
  el.dataset.url = url;
}

function buildProxyUrl(directLink, referer) {
  const params = new URLSearchParams({ url: directLink, referer });
  return `/api/stream?${params}`;
}

async function copyLink(button) {
  const el = document.getElementById(button.dataset.copyTarget);
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
  stopTimer(playTimer);
  stopTimer(resolveTimer);
  playTimer.active = false;
  timersEl.hidden = true;
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
  playSession += 1;
}

function watchFirstFrame(session) {
  const finish = () => {
    if (!playTimer.active || session !== playSession) {
      return;
    }
    playTimer.active = false;
    freezeTimer(playTimer, playTimeEl);
    setStatus('Direct link ready · test playback running', 'ok');
  };
  video.addEventListener('playing', finish, { once: true });
  video.addEventListener('loadeddata', () => {
    if (video.readyState >= 2) {
      finish();
    }
  }, { once: true });
}

async function resolveVideoId(videoId) {
  setStatus('Resolving direct link…');
  submitBtn.disabled = true;
  resetResult();

  const session = playSession;
  timersEl.hidden = false;
  startTimer(resolveTimer, resolveTimeEl, () => session === playSession);

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    if (session !== playSession) {
      return;
    }

    freezeTimer(resolveTimer, resolveTimeEl);

    const proxyPath = buildProxyUrl(payload.directLink, payload.referer);
    const absoluteProxyUrl = new URL(proxyPath, window.location.origin).href;

    setLink(directLinkEl, payload.directLink);
    setLink(proxyLinkEl, absoluteProxyUrl);
    metaEl.textContent = [payload.title, payload.videoId].filter(Boolean).join(' · ');
    resultSection.hidden = false;

    playTimer.active = true;
    startTimer(playTimer, playTimeEl, () => playTimer.active && session === playSession);
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
    stopTimer(resolveTimer);
    stopTimer(playTimer);
    playTimer.active = false;
    if (session === playSession) {
      setStatus(error.message || 'Could not resolve direct link', 'error');
    }
  } finally {
    submitBtn.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    resolveVideoId(parseVideoId(videoIdInput.value));
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

video.addEventListener('error', () => {
  playTimer.active = false;
  stopTimer(playTimer);
  if (video.error) {
    setStatus(`Test playback failed (${video.error.code})`, 'error');
  }
});

document.querySelectorAll('.copy-btn').forEach((button) => {
  button.addEventListener('click', () => copyLink(button));
});
