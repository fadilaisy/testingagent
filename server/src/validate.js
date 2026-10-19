import { HttpError } from './auth.js';

// Small input helpers. Each throws a 400 with a field-specific message so the
// web client can show it next to the form.

export function text(value, field, { max = 200, required = false, fallback = '' } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (!s) {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return fallback;
  }
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`, { field });
  return s;
}

export function oneOf(value, field, allowed, { required = false, fallback = null } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return fallback;
  }
  if (!allowed.includes(value)) throw new HttpError(400, `${field} is not a valid option`, { field });
  return value;
}

export function int(value, field, { min = -Infinity, max = Infinity, required = false, fallback = null } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`, { field });
  }
  return n;
}

export function num(value, field, { min = -Infinity, max = Infinity, required = false, fallback = null } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}`, { field });
  }
  return n;
}

export function lat(value, field, opts) {
  return num(value, field, { min: -90, max: 90, ...opts });
}

export function lng(value, field, opts) {
  return num(value, field, { min: -180, max: 180, ...opts });
}

export function isoDate(value, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, { field });
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} is not a valid date`, { field });
  return d.toISOString();
}

export function email(value) {
  const s = text(value, 'Email', { max: 254, required: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'Email is not valid', { field: 'Email' });
  return s;
}

export function password(value) {
  const s = value == null ? '' : String(value);
  if (s.length < 8) throw new HttpError(400, 'Password must be at least 8 characters', { field: 'Password' });
  if (s.length > 200) throw new HttpError(400, 'Password is too long', { field: 'Password' });
  return s;
}

export function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found');
  return n;
}

export function parseJson(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
