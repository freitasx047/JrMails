'use strict';

const { loadState, exportSession, createMailbox, deleteMailbox, UpstreamError } = require('./_lib/upstream');
const {
  applyCors,
  rateLimit,
  clientIp,
  isValidUsername,
  isValidDomain,
  isValidEmail,
  sendJson,
} = require('./_lib/security');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = clientIp(req);

  if (req.method === 'POST') {
    if (!rateLimit(`create:${ip}`, { limit: 8, windowMs: 60_000 })) {
      return sendJson(res, 429, {
        success: false,
        error: 'Muitas caixas criadas. Aguarde um pouco antes de tentar de novo.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';

    if (username && !isValidUsername(username)) {
      return sendJson(res, 400, {
        success: false,
        error: 'Nome de usuário inválido (use apenas letras, números, ponto, hífen ou underscore, até 64 caracteres).',
      });
    }
    if (domain && !isValidDomain(domain)) {
      return sendJson(res, 400, { success: false, error: 'Domínio inválido.' });
    }

    try {
      const state = loadState(req);
      const mailbox = await createMailbox(state, {
        username: username || undefined,
        domain: domain || undefined,
      });
      return sendJson(res, 200, { success: true, mailbox, session: exportSession(state) });
    } catch (err) {
      console.error('[mailbox:create]', err);
      const status = err instanceof UpstreamError ? err.status : 500;
      const error = err instanceof UpstreamError ? err.message : 'Erro ao criar o e-mail.';
      return sendJson(res, status, { success: false, error });
    }
  }

  if (req.method === 'DELETE') {
    if (!rateLimit(`delete:${ip}`, { limit: 20, windowMs: 60_000 })) {
      return sendJson(res, 429, { success: false, error: 'Muitas requisições. Tente novamente em instantes.' });
    }

    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    if (!email || !isValidEmail(email)) {
      return sendJson(res, 400, { success: false, error: 'E-mail inválido.' });
    }

    try {
      const state = loadState(req);
      const ok = await deleteMailbox(state, email);
      return sendJson(res, 200, { success: ok, session: exportSession(state) });
    } catch (err) {
      console.error('[mailbox:delete]', err);
      return sendJson(res, 502, { success: false, error: 'Erro ao apagar a caixa.' });
    }
  }

  return sendJson(res, 405, { success: false, error: 'Método não permitido.' });
};
