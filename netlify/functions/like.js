"use strict";
const { initBlobs, currentUser, getComment, putComment, buildState, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  initBlobs(event);
  const user = currentUser(event);
  if (!user) return json(401, { error: "Sessão necessária." });

  const commentId = event.queryStringParameters && event.queryStringParameters.commentId;
  if (!commentId) return json(400, { error: "Comentário em falta." });

  const comment = await getComment(commentId);
  if (!comment) return json(404, { error: "Comentário não encontrado." });

  const likedBy = Array.isArray(comment.likedBy) ? comment.likedBy.slice() : [];
  const idx = likedBy.indexOf(user.id);
  if (idx === -1) likedBy.push(user.id);
  else likedBy.splice(idx, 1);
  comment.likedBy = likedBy;
  await putComment(comment);

  const state = await buildState(user.id);
  return json(200, state);
};
