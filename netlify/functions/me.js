"use strict";
const { currentUser, publicUser, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Método não permitido." });
  const user = currentUser(event);
  return json(200, { user: publicUser(user) });
};
