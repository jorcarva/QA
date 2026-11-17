"use strict";
const { initBlobs, currentUser, buildState, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Método não permitido." });
  initBlobs(event);
  const user = currentUser(event);
  const state = await buildState(user ? user.id : null);
  return json(200, state);
};
