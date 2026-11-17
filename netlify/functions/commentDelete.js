"use strict";
const { initBlobs, currentUser, getComment, deleteCommentAndReplies, buildState, json, commentIdFromPath } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "DELETE") return json(405, { error: "Método não permitido." });
  initBlobs(event);

  const user = currentUser(event);
  if (!user) return json(401, { error: "Sessão necessária." });
  if (user.role !== "admin") return json(403, { error: "Apenas administradores." });

  const commentId = commentIdFromPath(event, "delete");
  if (!commentId) return json(400, { error: "Comentário em falta." });

  const comment = await getComment(commentId);
  if (!comment) return json(404, { error: "Comentário não encontrado." });

  const removed = await deleteCommentAndReplies(commentId);
  const state = await buildState(user.id, { exclude: removed });
  return json(200, state);
};
