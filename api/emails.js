'use strict';

const { loadState, exportSession, getEmails, UpstreamError } = require('./_lib/upstream');
const { applyCors, rateLimit, clientIp, isValidEmail, sendJson } = require('./_lib/security');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return sendJson(res, 405, { success: false, error: 'Método não permitido.' });

  const ip = clientIp(req);
  if (!rateLimit(`emails:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return sendJson(res, 429, { success: false, error: 'Muitas requisições. Aguarde um instante.' });
  }

  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  if (!email || !isValidEmail(email)) {
    return sendJson(res, 400, { success: false, error: 'E-mail inválido.' });
  }

  try {
    const state = loadState(req);
    const data = await getEmails(state, email);
    return sendJson(res, 200, { ...data, session: exportSession(state) });
  } catch (err) {
    console.error('[emails]', err);
    const status = err instanceof UpstreamError ? err.status : 500;
    return sendJson(res, status, { success: false, error: 'Não foi possível buscar os e-mails.' });
  }
};
