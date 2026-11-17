"use strict";

const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

// Funções clássicas (exports.handler) têm de ligar o contexto do Blobs ao
// evento Lambda antes de aceder ao armazenamento. Chamar no início de cada
// handler que usa o store.
function initBlobs(event) {
  try { connectLambda(event); } catch (e) { /* já ligado / ambiente local */ }
}

const DEFAULT_QUESTION = "Qual é o maior desafio de Angola hoje?";

// Contas de teste (as palavras-passe são mostradas na própria UI de demonstração).
const USERS = [
  { id: "admin", username: "admin", password: "admin123", name: "Administrador", role: "admin" },
  { id: "ana", username: "ana", password: "ana123", name: "Ana Costa", role: "member" },
  { id: "pedro", username: "pedro", password: "pedro123", name: "Pedro Santos", role: "member" },
  { id: "maria", username: "maria", password: "maria123", name: "Maria Fernandes", role: "member" },
];
function userById(id) { return USERS.find((u) => u.id === id) || null; }
function userByUsername(u) {
  u = String(u || "").trim().toLowerCase();
  return USERS.find((x) => x.username === u) || null;
}
function publicUser(u) { return u ? { id: u.id, username: u.username, name: u.name, role: u.role } : null; }

const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

/* ----------------------------- Blobs ----------------------------- */
function store() {
  // Consistência padrão (eventual): a opção "strong" não está disponível
  // neste ambiente. As alterações do próprio utilizador são refletidas na
  // resposta via overrides em buildState.
  return getStore("qa");
}

async function ensureSeed() {
  const s = store();
  if (await s.get("meta/seeded")) return null;

  const question = { text: DEFAULT_QUESTION, updatedAt: Date.now() };
  const likedBy = [];
  for (let i = 1; i <= 23; i++) likedBy.push("guest-" + i);
  const joao = {
    id: "seed-joao",
    authorId: "joao",
    authorName: "João Silva",
    text: "Na minha opinião, é a falta de oportunidades para os jovens.",
    createdAt: Date.now() - 2 * 60 * 60 * 1000,
    parentId: null,
    likedBy: likedBy,
  };

  // Sets guardados: não sobrescrevem dados já existentes (evita apagar
  // comentários durante a janela de propagação da consistência eventual).
  if (!(await s.get("question"))) await s.setJSON("question", question);
  if (!(await s.get("index"))) await s.setJSON("index", { commentIds: ["seed-joao"] });
  if (!(await s.get("comments/seed-joao"))) await s.setJSON("comments/seed-joao", joao);
  await s.set("meta/seeded", "1");

  return { question: question, comments: { "seed-joao": joao } };
}

async function getQuestion() {
  const q = await store().get("question", { type: "json" });
  return q && q.text ? q : { text: DEFAULT_QUESTION, updatedAt: null };
}

async function setQuestion(text) {
  const doc = { text: text, updatedAt: Date.now() };
  await store().setJSON("question", doc);
  return doc;
}

async function getComment(id) {
  return store().get("comments/" + id, { type: "json" });
}

async function putComment(c) {
  await store().setJSON("comments/" + c.id, c);
}

// Ids dos comentários: cruza o índice (consistência forte, inclui o que o
// autor acabou de criar) com a listagem (apanha tudo o resto).
async function listCommentIds() {
  const s = store();
  const ids = new Set();
  const idx = await s.get("index", { type: "json" });
  if (idx && Array.isArray(idx.commentIds)) idx.commentIds.forEach((id) => ids.add(id));
  try {
    const listed = await s.list({ prefix: "comments/" });
    (listed.blobs || []).forEach((b) => ids.add(b.key.replace(/^comments\//, "")));
  } catch (e) { /* ignora falhas de listagem */ }
  return Array.from(ids);
}

async function addToIndex(id) {
  const s = store();
  const idx = (await s.get("index", { type: "json" })) || { commentIds: [] };
  if (!Array.isArray(idx.commentIds)) idx.commentIds = [];
  if (idx.commentIds.indexOf(id) === -1) idx.commentIds.push(id);
  await s.setJSON("index", idx);
}

async function buildState(viewerId, opts) {
  opts = opts || {};
  const seedInfo = await ensureSeed();

  let q = await getQuestion();
  if (seedInfo) q = seedInfo.question;
  if (opts.question) q = opts.question;

  // Overrides: documentos acabados de escrever nesta função (consistência
  // eventual pode ainda devolver a versão antiga numa leitura imediata).
  const overrides = Object.assign({}, seedInfo ? seedInfo.comments : {}, opts.comments || {});

  const idSet = new Set(await listCommentIds());
  Object.keys(overrides).forEach((id) => idSet.add(id));
  const ids = Array.from(idSet);
  const docs = await Promise.all(ids.map((id) => (overrides[id] ? overrides[id] : getComment(id))));

  const comments = [];
  for (const c of docs) {
    if (!c) continue;
    const likedBy = Array.isArray(c.likedBy) ? c.likedBy : [];
    comments.push({
      id: c.id,
      authorId: c.authorId,
      authorName: c.authorName,
      text: c.text,
      createdAt: c.createdAt,
      parentId: c.parentId || null,
      likeCount: likedBy.length,
      likedByMe: !!viewerId && likedBy.indexOf(viewerId) !== -1,
    });
  }

  return { question: q.text, questionUpdatedAt: q.updatedAt, comments: comments };
}

/* ----------------------------- Auth ------------------------------ */
function sign(userId) {
  const mac = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  return userId + "." + mac;
}
function verifyToken(token) {
  if (!token || token.indexOf(".") === -1) return null;
  const i = token.lastIndexOf(".");
  const userId = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return userById(userId);
}
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
function currentUser(event) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  return verifyToken(cookies["qa_session"]);
}
function cookieHeader(event, value, maxAgeSeconds) {
  const host = (event.headers && (event.headers.host || event.headers.Host)) || "";
  const isLocal = /^(localhost|127\.0\.0\.1)/.test(host);
  const parts = [
    "qa_session=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + maxAgeSeconds,
  ];
  if (!isLocal) parts.push("Secure");
  return parts.join("; ");
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ---------------------------- HTTP ------------------------------- */
function json(statusCode, obj, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {}),
    body: JSON.stringify(obj),
  };
}
function parseBody(event) {
  if (!event.body) return {};
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

module.exports = {
  DEFAULT_QUESTION,
  USERS, userById, userByUsername, publicUser,
  initBlobs,
  store, ensureSeed, getQuestion, setQuestion,
  getComment, putComment, listCommentIds, addToIndex, buildState,
  sign, verifyToken, currentUser, cookieHeader, safeEqual,
  json, parseBody,
};
