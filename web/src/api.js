export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.field = body?.field ?? null;
    this.premiumRequired = Boolean(body?.premiumRequired);
    this.body = body;
  }
}

const REQUEST_TIMEOUT_MS = 15000;

async function request(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else {
    // Give up on a server that doesn't answer instead of waiting for the
    // browser's own timeout. Uploads are left alone: GPX files can be slow.
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch (err) {
    const timedOut = err.name === 'TimeoutError';
    throw new ApiError(0, { error: timedOut ? 'The server took too long to answer' : 'Could not reach the server' });
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An HTML page here means /api isn't reaching the ROAMR server.
    data = { error: res.ok ? 'The server sent an unexpected response' : text };
    if (res.ok) throw new ApiError(502, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
