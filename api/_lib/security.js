'use strict';

// ---------------------------------------------------------------------------
// Rate limiting best-effort (em memória, por instância).
// Em serverless a memória não é compartilhada entre instâncias/cold starts,
// então isto reduz abuso mas não é uma garantia dura. Para um limite robusto
// em produção use um store externo (ex.: Vercel KV / Upstash Redis com
// @upstash/ratelimit) — deixamos isso pronto para trocar em _lib/upstream.js
// sem mexer nas rotas.
// ---------------------------------------------------------------------------
const buckets = new Map();

function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now - b.start > windowMs) buckets.delete(k);
    }
  }
  return bucket.count <= limit;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ---------------------------------------------------------------------------
// CORS restrito: por padrão só permite o próprio domínio (same-origin) e
// qualquer origem listada em ALLOWED_ORIGINS (separadas por vírgula). Nada
// de refletir qualquer Origin como o server.js original fazia.
// ---------------------------------------------------------------------------
function applyCors(req, res) {
  const allowList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  const selfOrigin = req.headers.host ? `https://${req.headers.host}` : null;

  let allowOrigin = null;
  if (origin && (allowList.includes(origin) || origin === selfOrigin)) {
    allowOrigin = origin;
  } else if (origin && allowList.length === 0 && process.env.NODE_ENV !== 'production') {
    allowOrigin = origin; // conveniência apenas fora de produção
  }

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Upstream-Token, X-Upstream-Cookies');
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const DOMAIN_RE = /^[a-zA-Z0-9.-]{3,255}$/;
const EMAIL_RE = /^[^\s@]{1,80}@[a-zA-Z0-9.-]{3,255}$/;

const isValidUsername = (v) => typeof v === 'string' && USERNAME_RE.test(v);
const isValidDomain = (v) => typeof v === 'string' && DOMAIN_RE.test(v);
const isValidEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v);

function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
}

module.exports = {
  rateLimit,
  clientIp,
  applyCors,
  isValidUsername,
  isValidDomain,
  isValidEmail,
  sendJson,
};
