'use strict';

const { loadState, exportSession, listDomains, UpstreamError } = require('./_lib/upstream');
const { applyCors, rateLimit, clientIp, sendJson } = require('./_lib/security');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Método não permitido.' });

  const ip = clientIp(req);
  if (!rateLimit(`domains:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return sendJson(res, 429, { success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
  }

  try {
    const state = loadState(req);
    const domains = await listDomains(state);
    return sendJson(res, 200, { success: true, domains, session: exportSession(state) });
  } catch (err) {
    console.error('[domains]', err);
    const status = err instanceof UpstreamError ? err.status : 500;
    return sendJson(res, status, { success: false, error: 'Não foi possível carregar os domínios.' });
  }
};
