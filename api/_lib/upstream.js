'use strict';

/**
 * Cliente para a API do provedor de e-mail temporário.
 *
 * Importante: funções serverless da Vercel não garantem memória
 * compartilhada entre instâncias/execuções, então (diferente do server.js
 * original) NÃO guardamos sessão em memória no servidor. O token de acesso
 * e os cookies de upstream viajam de/para o navegador a cada chamada
 * (headers X-Upstream-Token / X-Upstream-Cookies) e o cliente os persiste
 * em localStorage. Isso mantém o backend sem estado (stateless), o que é o
 * modelo correto para serverless.
 */

const BASE_URL = 'https://tempmailbee.com';
const UPSTREAM_TIMEOUT_MS = 10_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) jr-emails-proxy/1.0';

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function parseCookieHeaderString(str) {
  const jar = new Map();
  if (!str) return jar;
  for (const pair of String(str).split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) jar.set(k, v);
  }
  return jar;
}

function jarToHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeSetCookies(jar, res) {
  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')]
        : [];
  for (const cookieStr of setCookies) {
    const pair = cookieStr.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > -1) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function upstreamFetch(url, options, jar) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (jar) mergeSetCookies(jar, res);
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new UpstreamError('O provedor demorou demais para responder.', 504);
    }
    throw new UpstreamError('Falha de comunicação com o provedor.', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(token, jar) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const cookieHeader = jarToHeader(jar);
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

/** Lê o estado (token + cookies) enviado pelo cliente nesta requisição. */
function loadState(req) {
  const token = safeHeader(req.headers['x-upstream-token']);
  const cookies = safeHeader(req.headers['x-upstream-cookies']);
  return { token: token || null, jar: parseCookieHeaderString(cookies) };
}

function safeHeader(v) {
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string') return '';
  return v.slice(0, 4096); // evita headers absurdamente grandes
}

/** Estado a devolver ao cliente para ele persistir e reenviar depois. */
function exportSession(state) {
  return { token: state.token || null, cookies: jarToHeader(state.jar) || null };
}

async function ensureToken(state) {
  if (state.token) return state.token;
  const res = await upstreamFetch(
    `${BASE_URL}/api/auth/anonymous/`,
    { method: 'POST', headers: authHeaders(null, state.jar) },
    state.jar
  );
  if (!res.ok) throw new UpstreamError('Falha ao autenticar com o provedor.', 502);
  const data = await res.json().catch(() => ({}));
  if (!data.success || !data.access_token) {
    throw new UpstreamError('Falha ao autenticar com o provedor.', 502);
  }
  state.token = data.access_token;
  return state.token;
}

async function listDomains(state) {
  await ensureToken(state);
  const res = await upstreamFetch(
    `${BASE_URL}/api/domains/`,
    { headers: authHeaders(state.token, state.jar) },
    state.jar
  );
  if (!res.ok) throw new UpstreamError('Falha ao listar domínios.', 502);
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.available_domains) ? data.available_domains : [];
}

async function createMailbox(state, { username, domain } = {}) {
  await ensureToken(state);
  const params = new URLSearchParams();

  if (username) {
    let finalDomain = domain;
    if (!finalDomain) {
      const domains = await listDomains(state);
      if (!domains.length) throw new UpstreamError('Nenhum domínio disponível no momento.', 502);
      finalDomain = domains[0];
    }
    params.set('email_address', `${username}@${finalDomain}`);
    params.set('free_domain', 'false');
  } else {
    params.set('free_domain', 'true');
  }

  const res = await upstreamFetch(
    `${BASE_URL}/api/mailbox/create/?${params.toString()}`,
    { method: 'POST', headers: authHeaders(state.token, state.jar) },
    state.jar
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new UpstreamError(err.error || 'Erro ao criar o e-mail.', res.status >= 500 ? 502 : 400);
  }
  return res.json();
}

async function getEmails(state, email) {
  const url = `${BASE_URL}/api/mailbox/emails/?email_address=${encodeURIComponent(email)}`;
  const res = await upstreamFetch(url, { headers: authHeaders(state.token, state.jar) }, state.jar);
  if (!res.ok) throw new UpstreamError('Falha ao buscar e-mails.', 502);
  return res.json();
}

async function deleteMailbox(state, email) {
  const url = `${BASE_URL}/api/mailbox/delete/?email_address=${encodeURIComponent(email)}`;
  const res = await upstreamFetch(
    url,
    { method: 'DELETE', headers: authHeaders(state.token, state.jar) },
    state.jar
  );
  return res.ok;
}

module.exports = {
  UpstreamError,
  loadState,
  exportSession,
  listDomains,
  createMailbox,
  getEmails,
  deleteMailbox,
};
