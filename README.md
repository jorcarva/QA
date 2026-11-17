# Pergunta do Dia

Plataforma de perguntas e respostas: uma pergunta em destaque e comentários em baixo.
Só quem tem sessão iniciada pode comentar, dar _like_ e responder. O **administrador**
pode alterar a pergunta.

Stack: **Node.js + Express + SQLite** (back-end), HTML/CSS/JS sem frameworks (front-end).

## Contas de teste

| Conta          | Utilizador | Palavra-passe | Permissões                                  |
| -------------- | ---------- | ------------- | ------------------------------------------- |
| Administrador  | `admin`    | `admin123`    | Editar a pergunta + comentar / like / responder |
| Ana Costa      | `ana`      | `ana123`      | Comentar, dar like, responder               |
| Pedro Santos   | `pedro`    | `pedro123`    | Comentar, dar like, responder               |
| Maria Fernandes| `maria`    | `maria123`    | Comentar, dar like, responder               |

As contas são criadas automaticamente na primeira execução (palavras-passe guardadas
com hash `scrypt`).

## Correr localmente

```bash
npm install
npm start
```

Abra http://localhost:3000 (ou a porta em `PORT`).

Para desenvolvimento com recarga automática: `npm run dev`.

## Variáveis de ambiente

| Variável         | Omissão            | Descrição                                            |
| ---------------- | ------------------ | ---------------------------------------------------- |
| `PORT`           | `3000`             | Porta do servidor.                                   |
| `SESSION_SECRET` | `dev-secret-...`   | **Defina um valor próprio em produção.**             |
| `DB_PATH`        | `./data/qa.db`     | Caminho do ficheiro SQLite.                          |
| `NODE_ENV`       | —                  | Em `production` o cookie de sessão fica `secure` (HTTPS). |

## API

| Método | Rota                      | Acesso        |
| ------ | ------------------------- | ------------- |
| GET    | `/api/me`                 | público       |
| GET    | `/api/state`              | público       |
| POST   | `/api/login`              | público       |
| POST   | `/api/logout`             | sessão        |
| POST   | `/api/comments`           | sessão        |
| POST   | `/api/comments/:id/like`  | sessão        |
| PUT    | `/api/question`           | só admin      |

## Deploy

Este projeto precisa de um host que corra **Node.js** (não serve como site estático,
porque os comentários são partilhados via servidor).

### Render (recomendado)

1. Faça _push_ do repositório para o GitHub.
2. No [Render](https://render.com): **New → Blueprint** e aponte para este repositório
   (usa o `render.yaml` incluído), ou **New → Web Service** com:
   - Build command: `npm install`
   - Start command: `npm start`
3. Em **Environment**, defina `SESSION_SECRET` (um valor aleatório) e `NODE_ENV=production`.

> **Persistência:** o SQLite guarda dados num ficheiro. Em sistemas de ficheiros
> efémeros (plano _free_ do Render/Railway) os dados são recriados a cada deploy.
> Para manter os dados, use um **disco persistente** (bloco `disk` no `render.yaml`,
> requer plano pago) e aponte `DB_PATH` para esse disco (ex.: `/var/data/qa.db`).

### Railway

- **New Project → Deploy from GitHub repo**. Railway deteta Node automaticamente.
- Defina as variáveis `SESSION_SECRET` e `NODE_ENV=production`.
- Para dados persistentes, adicione um _Volume_ e defina `DB_PATH` para dentro dele.

### Outro host / VPS

```bash
npm install
NODE_ENV=production SESSION_SECRET="algo-aleatorio" PORT=8080 npm start
```

Coloque atrás de um proxy HTTPS (Nginx/Caddy). O servidor já usa `trust proxy`.
