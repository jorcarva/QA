"use strict";
const crypto = require("crypto");
const { initBlobs, currentUser, parseBody, getComment, putComment, addToIndex, buildState, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  initBlobs(event);
  const user = currentUser(event);
  if (!user) return json(401, { error: "Sessão necessária." });

  const body = parseBody(event);
  const text = (body.text ? String(body.text) : "").trim();
  const parentIdRaw = body.parentId ? String(body.parentId) : null;
  if (!text) return json(400, { error: "O comentário não pode estar vazio." });
  if (text.length > 500) return json(400, { error: "Máximo de 500 caracteres." });

  let parentId = null;
  if (parentIdRaw) {
    const parent = await getComment(parentIdRaw);
    if (!parent) return json(400, { error: "Comentário a responder não existe." });
    // Mantém os fios a um nível: a resposta liga-se ao comentário raiz.
    parentId = parent.parentId || parent.id;
  }

  const id = crypto.randomUUID();
  const doc = {
    id,
    authorId: user.id,
    authorName: user.name,
    text,
    createdAt: Date.now(),
    parentId,
    likedBy: [],
  };
  await putComment(doc);
  await addToIndex(id);

  const state = await buildState(user.id, { comments: { [id]: doc } });
  return json(201, state);
};
