# JR Emails — pronto para a Vercel

Cliente de e-mail temporário (frontend estático + funções serverless) que
fala com a API do TempMailBee. Reestruturado a partir do projeto original
(`server.js` + `public/index.html`) para rodar na Vercel.

## O que mudou em relação ao projeto original

O `server.js` original guardava a sessão de cada visitante (token +
cookies) **em memória**, num `Map`. Isso funciona num servidor único e
sempre ligado, mas **não funciona de forma confiável em serverless**: a
Vercel pode rodar cada requisição numa instância diferente, sem memória
compartilhada, então metade das chamadas "esqueceria" a sessão.

Por isso o backend virou **stateless**:

- `server.js` → três funções em `api/`: `domains.js`, `mailbox.js`, `emails.js`.
- O token de acesso e os cookies do upstream não ficam mais no servidor —
  voltam para o navegador a cada resposta (campo `session` no JSON) e o
  frontend os guarda no `localStorage`, reenviando nos headers
  `X-Upstream-Token` / `X-Upstream-Cookies` na chamada seguinte.
- O endereço de e-mail ativo e a expiração também passaram a ser
  controlados só pelo navegador (não existe mais `GET /api/mailbox` para
  "recuperar sessão" — o próprio localStorage já sabe).

Funcionalmente o site se comporta igual para quem usa.

## Proteções adicionadas

- **CORS restrito**: por padrão só aceita o próprio domínio; o original
  refletia qualquer `Origin` recebida. Domínios extras (ex. um preview
  deploy) podem ser liberados via variável de ambiente `ALLOWED_ORIGINS`
  (separados por vírgula).
- **Validação de entrada**: `username`, `domain` e `email` passam por
  regex antes de tocar a API upstream (evita injeção de parâmetros/URLs
  malformadas).
- **Rate limiting best-effort por IP**: limita criação de caixas (8/min),
  consultas de e-mail e domínios (30/min) e exclusões (20/min). É em
  memória por instância — reduz abuso casual, mas não é garantia dura (ver
  observação abaixo).
- **Timeout de 10s** em toda chamada ao upstream (evita função serverless
  travada esperando resposta).
- **Erros genéricos para o cliente**: detalhes de erro só vão pro
  `console.error` do servidor, nunca vazam stack trace/URL interna.
- **Headers de segurança** via `vercel.json`: CSP, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, HSTS, `Referrer-Policy`,
  `Permissions-Policy`.
- **Sem dependências externas** (usa `fetch` nativo do Node 18+), o que
  reduz superfície de ataque via supply chain.

### Limite do rate limiting em serverless

O contador fica em memória de cada instância da função. Isso significa que
sob tráfego alto (várias instâncias frias) o limite real pode ser mais
generoso que o configurado. Para um limite robusto e compartilhado entre
instâncias, troque `api/_lib/security.js` por um rate limiter com store
externo — por exemplo `@upstash/ratelimit` + Vercel KV (gratuito para
volumes baixos). O restante do código não precisa mudar.

## Deploy na Vercel

```bash
npm i -g vercel   # se ainda não tiver a CLI
vercel             # dentro desta pasta, segue o assistente
vercel --prod      # quando estiver satisfeito com o preview
```

Ou pelo painel da Vercel: "Add New Project" → importar esta pasta/repositório
→ Deploy (não precisa configurar build command nem output directory).

### Variáveis de ambiente (opcional)

| Nome              | Para quê                                                    |
|-------------------|---------------------------------------------------------------|
| `ALLOWED_ORIGINS` | Lista de origens extras liberadas no CORS, separadas por vírgula (ex. `https://meu-preview.vercel.app`). Em produção, sem essa variável só o próprio domínio funciona. |

## Rodando localmente

```bash
npm i -g vercel
vercel dev
```

Isso sobe o frontend e as funções `api/*` juntos, do jeito que rodam em
produção (diferente do antigo `node server.js` + Live Server em portas
separadas).

## Observação importante

Este projeto depende da API do TempMailBee (`tempmailbee.com`), que não é
uma API pública documentada — foi identificada por engenharia reversa do
próprio site original. Antes de colocar isso no ar publicamente, vale a
pena confirmar que você tem autorização para usar essa API dessa forma
(termos de uso do provedor, limites de requisição, etc.) — o rate limiting
aqui protege a *sua* função serverless de abuso, mas não substitui
combinar isso com o provedor. Se em algum momento o comportamento da API
mudar (rotas, formato de resposta), o ponto de ajuste é só
`api/_lib/upstream.js`.
