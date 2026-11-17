"use strict";
const { cookieHeader, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  const cookie = cookieHeader(event, "", 0);
  return json(200, { ok: true }, { "Set-Cookie": cookie });
};
