(function () {
  "use strict";

  /* Metadados das contas de teste — só para apresentação (avatares/atalhos
     de login). A autenticação é feita no servidor. */
  var ACCOUNTS = [
    { id: "admin", name: "Administrador", username: "admin", password: "admin123", role: "admin", color: "#7c3aed" },
    { id: "ana", name: "Ana Costa", username: "ana", password: "ana123", role: "member", color: "#e0557f" },
    { id: "pedro", name: "Pedro Santos", username: "pedro", password: "pedro123", role: "member", color: "#2f9e8f" },
    { id: "maria", name: "Maria Fernandes", username: "maria", password: "maria123", role: "member", color: "#3b74c4" }
  ];
  function accById(id) { for (var i = 0; i < ACCOUNTS.length; i++) if (ACCOUNTS[i].id === id) return ACCOUNTS[i]; return null; }

  var state = {
    me: null,            // { id, name, role } ou null
    question: null,
    questionLoaded: false,
    comments: [],
    commentsLoaded: false
  };
  var openReplyFor = null;

  /* ---------------- API ---------------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || "Erro"); e.status = res.status; throw e; }
        return data;
      });
    });
  }

  function applyState(s) {
    state.question = s.question;
    state.questionLoaded = true;
    state.comments = Array.isArray(s.comments) ? s.comments : [];
    state.commentsLoaded = true;
  }

  function refresh() {
    return api("GET", "/api/state").then(function (s) {
      applyState(s);
      renderQuestion();
      renderThread();
      renderComposer();
    });
  }

  /* ---------------- Helpers ---------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function initials(name) {
    var parts = (name || "").trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function colorFor(id, name) {
    var acc = accById(id);
    if (acc) return acc.color;
    var str = (name || "") + (id || "");
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return "hsl(" + h + ",55%,55%)";
  }
  function timeAgo(ts) {
    if (!ts) return "agora";
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return "agora mesmo";
    if (s < 90) return "há 1 min";
    var m = Math.floor(s / 60);
    if (m < 60) return "há " + m + " min";
    var h = Math.floor(m / 60);
    if (h < 24) return "há " + h + (h === 1 ? " hora" : " horas");
    var d = Math.floor(h / 24);
    if (d < 7) return "há " + d + (d === 1 ? " dia" : " dias");
    var w = Math.floor(d / 7);
    if (w < 5) return "há " + w + (w === 1 ? " semana" : " semanas");
    var mo = Math.floor(d / 30);
    if (mo < 12) return "há " + mo + (mo === 1 ? " mês" : " meses");
    return "há " + Math.floor(d / 365) + " ano(s)";
  }

  /* ---------------- Render ---------------- */
  function renderTopbar() {
    var bar = document.getElementById("topbar");
    bar.innerHTML = "";
    if (state.me) {
      var who = el("div", "who");
      var av = el("div", "avatar");
      av.style.width = "26px"; av.style.height = "26px"; av.style.fontSize = "11px";
      av.style.background = colorFor(state.me.id, state.me.name);
      av.textContent = initials(state.me.name);
      who.appendChild(av);
      who.appendChild(el("span", "uname", state.me.name));
      if (state.me.role === "admin") who.appendChild(el("span", "role-tag", "Admin"));
      bar.appendChild(who);
      var out = el("button", "btn ghost", "Sair");
      out.addEventListener("click", logout);
      bar.appendChild(out);
    } else {
      var login = el("button", "btn primary", "Iniciar sessão");
      login.addEventListener("click", openLogin);
      bar.appendChild(login);
    }
  }

  function renderQuestion() {
    document.getElementById("question").textContent =
      state.questionLoaded ? (state.question || "") : "A carregar…";

    var row = document.getElementById("qEditRow");
    row.innerHTML = "";
    if (state.me && state.me.role === "admin" && state.questionLoaded) {
      var edit = el("button", "btn", "✏️  Editar pergunta");
      edit.addEventListener("click", function () {
        document.getElementById("qInput").value = state.question || "";
        document.getElementById("head").classList.add("editing");
        document.getElementById("qEditor").classList.add("on");
        document.getElementById("qInput").focus();
      });
      row.appendChild(edit);
    }
  }

  function renderComposer() {
    var input = document.getElementById("mainInput");
    var send = document.getElementById("mainSend");
    var note = document.getElementById("lockNote");
    var composer = document.getElementById("composer");
    var loggedIn = !!state.me;

    input.disabled = !loggedIn;
    send.disabled = !loggedIn || !input.value.trim();
    note.style.display = loggedIn ? "none" : "flex";
    composer.classList.toggle("locked", !loggedIn);
    input.placeholder = loggedIn ? ("Comentar como " + state.me.name + "…") : "Partilhe a sua opinião…";
  }

  function makeCommentNode(c, isReply) {
    var card = el("div", isReply ? "reply" : "card");
    var top = isReply ? card : el("div", "c-top");

    var av = el("div", "avatar");
    av.style.background = colorFor(c.authorId, c.authorName);
    av.textContent = initials(c.authorName || "?");
    top.appendChild(av);

    var body = el("div", "c-body");
    var head = el("div", "c-head");
    head.appendChild(el("span", "c-name", c.authorName || "Anónimo"));
    if (state.me && state.me.id === c.authorId) head.appendChild(el("span", "c-you", "Você"));
    head.appendChild(el("span", "c-time", timeAgo(c.createdAt)));
    body.appendChild(head);
    body.appendChild(el("p", "c-text", c.text || ""));

    var actions = el("div", "c-actions");
    var likeBtn = el("button", "act" + (c.likedByMe ? " liked" : ""));
    likeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>'
      + '<span>' + (c.likeCount || 0) + '</span>';
    likeBtn.disabled = !state.me;
    likeBtn.addEventListener("click", function () { toggleLike(c.id); });
    actions.appendChild(likeBtn);

    if (!isReply) {
      var replyBtn = el("button", "act");
      replyBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/></svg>'
        + '<span>Responder</span>';
      replyBtn.disabled = !state.me;
      replyBtn.addEventListener("click", function () {
        openReplyFor = (openReplyFor === c.id) ? null : c.id;
        renderThread();
      });
      actions.appendChild(replyBtn);
    }
    body.appendChild(actions);

    if (!isReply) {
      var replies = state.comments.filter(function (x) { return x.parentId === c.id; })
        .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      if (replies.length) {
        var rwrap = el("div", "replies");
        replies.forEach(function (r) { rwrap.appendChild(makeCommentNode(r, true)); });
        body.appendChild(rwrap);
      }

      var rbox = el("div", "reply-box" + (openReplyFor === c.id ? " on" : ""));
      var rinput = el("input");
      rinput.type = "text";
      rinput.placeholder = "Escreva uma resposta…";
      rinput.maxLength = 500;
      var rsend = el("button", "reply-send", "Responder");
      rsend.disabled = true;
      rinput.addEventListener("input", function () { rsend.disabled = !rinput.value.trim(); });
      function submitReply() {
        var t = rinput.value.trim();
        if (!t) return;
        openReplyFor = null;
        postComment(t, c.id);
      }
      rinput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submitReply(); } });
      rsend.addEventListener("click", submitReply);
      rbox.appendChild(rinput);
      rbox.appendChild(rsend);
      body.appendChild(rbox);
      if (openReplyFor === c.id) setTimeout(function () { rinput.focus(); }, 0);
    }

    if (isReply) { card.appendChild(body); return card; }
    top.appendChild(body);
    card.appendChild(top);
    return card;
  }

  function renderThread() {
    var thread = document.getElementById("thread");
    var count = document.getElementById("cCount");

    if (!state.commentsLoaded) {
      thread.innerHTML = '<div class="loading">A carregar comentários…</div>';
      count.textContent = "";
      return;
    }
    var tops = state.comments.filter(function (c) { return !c.parentId; })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    count.textContent = state.comments.length ? "(" + state.comments.length + ")" : "";
    thread.innerHTML = "";
    if (!tops.length) {
      thread.appendChild(el("div", "empty", "Ainda não há comentários. Seja o primeiro a partilhar a sua opinião."));
      return;
    }
    tops.forEach(function (c) { thread.appendChild(makeCommentNode(c, false)); });
  }

  function renderAll() {
    renderTopbar();
    renderQuestion();
    renderComposer();
    renderThread();
  }

  /* ---------------- Actions ---------------- */
  function postComment(text, parentId) {
    if (!state.me) return;
    api("POST", "/api/comments", { text: text, parentId: parentId || null })
      .then(function (s) { applyState(s); renderThread(); renderComposer(); })
      .catch(function (e) { reauthOr(e); });
  }
  function toggleLike(id) {
    if (!state.me) return;
    api("POST", "/api/comments/" + encodeURIComponent(id) + "/like")
      .then(function (s) { applyState(s); renderThread(); })
      .catch(function (e) { reauthOr(e); });
  }
  function saveQuestion(text) {
    api("PUT", "/api/question", { text: text })
      .then(function (s) {
        applyState(s);
        document.getElementById("head").classList.remove("editing");
        document.getElementById("qEditor").classList.remove("on");
        renderQuestion();
      })
      .catch(function (e) { alert(e.message || "Não foi possível guardar."); reauthOr(e); });
  }
  function reauthOr(e) {
    if (e && e.status === 401) { state.me = null; renderAll(); openLogin(); }
  }

  /* ---------------- Auth ---------------- */
  function openLogin() {
    document.getElementById("loginErr").textContent = "";
    document.getElementById("uname").value = "";
    document.getElementById("pw").value = "";
    document.getElementById("overlay").classList.add("on");
    setTimeout(function () { document.getElementById("uname").focus(); }, 0);
  }
  function closeLogin() { document.getElementById("overlay").classList.remove("on"); }

  function login(username, password) {
    return api("POST", "/api/login", { username: username, password: password })
      .then(function (data) {
        state.me = data.user;
        closeLogin();
        return refresh().then(renderTopbar);
      });
  }
  function logout() {
    api("POST", "/api/logout").catch(function () {}).then(function () {
      state.me = null;
      openReplyFor = null;
      return refresh().then(renderTopbar);
    });
  }

  function buildAccountList() {
    var list = document.getElementById("accountList");
    list.innerHTML = "";
    ACCOUNTS.forEach(function (a) {
      var btn = el("button", "acc");
      btn.type = "button";
      var av = el("div", "avatar");
      av.style.background = a.color;
      av.textContent = initials(a.name);
      btn.appendChild(av);
      var meta = el("div", "meta");
      meta.appendChild(el("b", null, a.name));
      meta.appendChild(el("span", null, "@" + a.username + " · " + a.password));
      btn.appendChild(meta);
      btn.appendChild(el("span", "role-tag", a.role === "admin" ? "Admin" : "Membro"));
      btn.addEventListener("click", function () {
        login(a.username, a.password).catch(function (e) {
          document.getElementById("loginErr").textContent = e.message || "Falha ao entrar.";
        });
      });
      list.appendChild(btn);
    });
  }

  /* ---------------- Wiring ---------------- */
  function wire() {
    buildAccountList();
    document.getElementById("openLogin").addEventListener("click", openLogin);
    document.getElementById("modalClose").addEventListener("click", closeLogin);
    document.getElementById("overlay").addEventListener("click", function (e) {
      if (e.target === this) closeLogin();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLogin(); });

    document.getElementById("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var u = document.getElementById("uname").value;
      var p = document.getElementById("pw").value;
      login(u, p).catch(function (err) {
        document.getElementById("loginErr").textContent = err.message || "Falha ao entrar.";
      });
    });

    var input = document.getElementById("mainInput");
    var send = document.getElementById("mainSend");
    input.addEventListener("input", function () {
      send.disabled = !state.me || !input.value.trim();
    });
    function submitMain() {
      var t = input.value.trim();
      if (!t || !state.me) return;
      input.value = "";
      send.disabled = true;
      postComment(t, null);
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submitMain(); } });
    send.addEventListener("click", submitMain);

    document.getElementById("qSave").addEventListener("click", function () {
      var v = document.getElementById("qInput").value.trim();
      if (!v) return;
      saveQuestion(v);
    });
    document.getElementById("qCancel").addEventListener("click", function () {
      document.getElementById("head").classList.remove("editing");
      document.getElementById("qEditor").classList.remove("on");
    });
  }

  /* ---------------- Boot ---------------- */
  renderAll();
  wire();
  api("GET", "/api/me").then(function (data) { state.me = data.user; }).catch(function () {})
    .then(refresh).then(renderTopbar)
    .catch(function () {
      document.getElementById("thread").innerHTML =
        '<div class="empty">Não foi possível contactar o servidor.</div>';
    });

})();
