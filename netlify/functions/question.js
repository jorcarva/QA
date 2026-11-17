"use strict";
const { initBlobs, currentUser, parseBody, setQuestion, buildState, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "PUT") return json(405, { error: "Método não permitido." });
  initBlobs(event);
  const user = currentUser(event);
  if (!user) return json(401, { error: "Sessão necessária." });
  if (user.role !== "admin") return json(403, { error: "Apenas administradores." });

  const body = parseBody(event);
  const text = (body.text ? String(body.text) : "").trim();
  if (!text) return json(400, { error: "A pergunta não pode estar vazia." });
  if (text.length > 200) return json(400, { error: "Máximo de 200 caracteres." });

  await setQuestion(text);
  const state = await buildState(user.id);
  return json(200, state);
};
