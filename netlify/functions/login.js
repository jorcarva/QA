"use strict";
const { parseBody, userByUsername, safeEqual, sign, cookieHeader, publicUser, json } = require("./lib/common");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método não permitido." });
  const body = parseBody(event);
  const username = body.username;
  const password = body.password;
  if (!username || !password) return json(400, { error: "Indique utilizador e palavra-passe." });

  const user = userByUsername(username);
  if (!user || !safeEqual(password, user.password)) {
    return json(401, { error: "Utilizador ou palavra-passe inválidos." });
  }

  const cookie = cookieHeader(event, sign(user.id), 60 * 60 * 24 * 7);
  return json(200, { user: publicUser(user) }, { "Set-Cookie": cookie });
};
