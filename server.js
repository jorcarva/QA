"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");

/* ---------------------------------------------------------------- *
 *  Config
 * ---------------------------------------------------------------- */
const PORT = process.env.PORT || 3000;
const DEFAULT_QUESTION = "Qual é o maior desafio de Angola hoje?";
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "qa.db");

// Test accounts seeded on first run. Passwords are hashed in the DB.
const SEED_USERS = [
  { id: "admin", username: "admin", password: "admin123", name: "Administrador", role: "admin" },
  { id: "ana", username: "ana", password: "ana123", name: "Ana Costa", role: "member" },
  { id: "pedro", username: "pedro", password: "pedro123", name: "Pedro Santos", role: "member" },
  { id: "maria", username: "maria", password: "maria123", name: "Maria Fernandes", role: "member" },
];

/* ---------------------------------------------------------------- *
 *  Password hashing (Node built-in scrypt, no native deps)
 * ---------------------------------------------------------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(":") === -1) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------- *
 *  Database setup + seed
 * ---------------------------------------------------------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member'
  );
  CREATE TABLE IF NOT EXISTS question (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    text       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    parent_id   TEXT
  );
  CREATE TABLE IF NOT EXISTS likes (
    comment_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    PRIMARY KEY (comment_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
  CREATE INDEX IF NOT EXISTS idx_likes_comment ON likes(comment_id);
`);

function seed() {
  const insertUser = db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)"
  );
  for (const u of SEED_USERS) {
    insertUser.run(u.id, u.username, hashPassword(u.password), u.name, u.role);
  }

  const hasQuestion = db.prepare("SELECT 1 FROM question WHERE id = 1").get();
  if (!hasQuestion) {
    db.prepare("INSERT INTO question (id, text, updated_at) VALUES (1, ?, ?)").run(
      DEFAULT_QUESTION,
      Date.now()
    );
  }

  // Seed the example comment from the original design (João Silva, 23 likes).
  const hasSeedComment = db.prepare("SELECT 1 FROM comments WHERE id = 'seed-joao'").get();
  if (!hasSeedComment) {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO comments (id, author_id, author_name, text, created_at, parent_id) VALUES (?, ?, ?, ?, ?, NULL)"
    ).run(
      "seed-joao",
      "joao",
      "João Silva",
      "Na minha opinião, é a falta de oportunidades para os jovens.",
      twoHoursAgo
    );
    const insertLike = db.prepare("INSERT OR IGNORE INTO likes (comment_id, user_id) VALUES (?, ?)");
    for (let i = 1; i <= 23; i++) insertLike.run("seed-joao", "guest-" + i);
  }
}
seed();

/* ---------------------------------------------------------------- *
 *  Prepared statements
 * ---------------------------------------------------------------- */
const q = {
  userByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
  userById: db.prepare("SELECT id, username, name, role FROM users WHERE id = ?"),
  getQuestion: db.prepare("SELECT text, updated_at FROM question WHERE id = 1"),
  setQuestion: db.prepare("UPDATE question SET text = ?, updated_at = ? WHERE id = 1"),
  allComments: db.prepare("SELECT * FROM comments"),
  commentById: db.prepare("SELECT * FROM comments WHERE id = ?"),
  insertComment: db.prepare(
    "INSERT INTO comments (id, author_id, author_name, text, created_at, parent_id) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  likeCounts: db.prepare("SELECT comment_id, COUNT(*) AS n FROM likes GROUP BY comment_id"),
  myLikes: db.prepare("SELECT comment_id FROM likes WHERE user_id = ?"),
  hasLike: db.prepare("SELECT 1 FROM likes WHERE comment_id = ? AND user_id = ?"),
  addLike: db.prepare("INSERT OR IGNORE INTO likes (comment_id, user_id) VALUES (?, ?)"),
  removeLike: db.prepare("DELETE FROM likes WHERE comment_id = ? AND user_id = ?"),
  replyIds: db.prepare("SELECT id FROM comments WHERE parent_id = ?"),
  deleteComment: db.prepare("DELETE FROM comments WHERE id = ?"),
  deleteReplies: db.prepare("DELETE FROM comments WHERE parent_id = ?"),
  deleteLikes: db.prepare("DELETE FROM likes WHERE comment_id = ?"),
};

const deleteCommentTx = db.transaction((commentId) => {
  for (const r of q.replyIds.all(commentId)) q.deleteLikes.run(r.id);
  q.deleteReplies.run(commentId);
  q.deleteLikes.run(commentId);
  q.deleteComment.run(commentId);
});

/* ---------------------------------------------------------------- *
 *  App
 * ---------------------------------------------------------------- */
const app = express();
app.set("trust proxy", 1); // honour X-Forwarded-Proto behind a host's proxy
app.use(express.json({ limit: "32kb" }));

app.use(
  session({
    name: "qa.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Sessão necessária." });
  const user = q.userById.get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Sessão inválida." });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Apenas administradores." });
    next();
  });
}

function buildState(viewerId) {
  const question = q.getQuestion.get();
  const rows = q.allComments.all();

  const counts = {};
  for (const r of q.likeCounts.all()) counts[r.comment_id] = r.n;

  const liked = {};
  if (viewerId) for (const r of q.myLikes.all(viewerId)) liked[r.comment_id] = true;

  const comments = rows.map((c) => ({
    id: c.id,
    authorId: c.author_id,
    authorName: c.author_name,
    text: c.text,
    createdAt: c.created_at,
    parentId: c.parent_id,
    likeCount: counts[c.id] || 0,
    likedByMe: !!liked[c.id],
  }));

  return {
    question: question ? question.text : DEFAULT_QUESTION,
    questionUpdatedAt: question ? question.updated_at : null,
    comments,
  };
}

/* ---------------------------- API ------------------------------- */

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = q.userById.get(req.session.userId);
  res.json({ user: user || null });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Indique utilizador e palavra-passe." });

  const row = q.userByUsername.get(String(username).trim().toLowerCase());
  if (!row || !verifyPassword(String(password), row.password_hash)) {
    return res.status(401).json({ error: "Utilizador ou palavra-passe inválidos." });
  }
  req.session.userId = row.id;
  res.json({ user: { id: row.id, username: row.username, name: row.name, role: row.role } });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/state", (req, res) => {
  res.json(buildState(req.session.userId || null));
});

app.put("/api/question", requireAdmin, (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : "").trim();
  if (!text) return res.status(400).json({ error: "A pergunta não pode estar vazia." });
  if (text.length > 200) return res.status(400).json({ error: "Máximo de 200 caracteres." });
  q.setQuestion.run(text, Date.now());
  res.json(buildState(req.session.userId));
});

app.post("/api/comments", requireAuth, (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : "").trim();
  const parentIdRaw = req.body && req.body.parentId ? String(req.body.parentId) : null;
  if (!text) return res.status(400).json({ error: "O comentário não pode estar vazio." });
  if (text.length > 500) return res.status(400).json({ error: "Máximo de 500 caracteres." });

  let parentId = null;
  if (parentIdRaw) {
    const parent = q.commentById.get(parentIdRaw);
    if (!parent) return res.status(400).json({ error: "Comentário a responder não existe." });
    // Keep threads one level deep: reply attaches to the top-level root.
    parentId = parent.parent_id || parent.id;
  }

  const id = crypto.randomUUID();
  q.insertComment.run(id, req.user.id, req.user.name, text, Date.now(), parentId);
  res.status(201).json(buildState(req.user.id));
});

app.post("/api/comments/:id/like", requireAuth, (req, res) => {
  const commentId = req.params.id;
  const exists = q.commentById.get(commentId);
  if (!exists) return res.status(404).json({ error: "Comentário não encontrado." });

  if (q.hasLike.get(commentId, req.user.id)) q.removeLike.run(commentId, req.user.id);
  else q.addLike.run(commentId, req.user.id);

  res.json(buildState(req.user.id));
});

app.delete("/api/comments/:id", requireAdmin, (req, res) => {
  const commentId = req.params.id;
  const exists = q.commentById.get(commentId);
  if (!exists) return res.status(404).json({ error: "Comentário não encontrado." });
  deleteCommentTx(commentId);
  res.json(buildState(req.session.userId));
});

/* ------------------------ Static site --------------------------- */
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Pergunta do Dia a correr em http://localhost:${PORT}`);
});
