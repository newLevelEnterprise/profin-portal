// ── CFO Copiloto — persistent sidebar widget + real Claude AI chat panel ──────

// v2 key so old canned-response history doesn't carry over
const CHAT_HISTORY_KEY = "cfo4u_chat_v1";

function getChatHistory() {
  return (
    JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "null") || [
      {
        role: "bot",
        text: "Olá! Sou o CFO Copiloto, conectado ao Claude com acesso aos dados financeiros da sua organização.\n\nEnvie documentos na aba **Documentos** e depois me pergunte sobre balanço, indicadores, margens, endividamento ou qualquer dúvida financeira.",
      },
    ]
  );
}

function saveChatHistory(history) {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

// ── Simple markdown → safe HTML (for chat bubbles) ───────────────────────────

function md(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^#{1,3}\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

// ── CFO avatar SVG ────────────────────────────────────────────────────────────

const CFO_ILLUSTRATION_SVG = `
  <svg class="cfo-illus" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="cfoBg" x1="0" y1="0" x2="64" y2="64">
        <stop stop-color="#7c5cfc"/>
        <stop offset="1" stop-color="#2dd4a0"/>
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#cfoBg)" opacity=".9"/>
    <path d="M14 57c0-10 8-17 18-17s18 7 18 17v3H14v-3z" fill="#1c1c28"/>
    <path d="M24 42l8 6 8-6-3 18h-10l-3-18z" fill="#fff"/>
    <path d="M30 49l2 2 2-2-1 11h-2l-1-11z" fill="#2dd4a0"/>
    <circle cx="32" cy="25" r="10" fill="#f3c9a8"/>
    <path d="M32 14c-6 0-9.5 3.6-9.5 8.3 0 1.6.4 2.8.9 3.8 1.6-1.1 2.9-2.9 2.9-2.9s1.4 2.1 5.7 2.1 5.7-2.1 5.7-2.1 1.3 1.8 2.9 2.9c.5-1 .9-2.2.9-3.8 0-4.7-3.5-8.3-9.5-8.3z" fill="#2b2440"/>
  </svg>
`;

// ── Call the cfo-chat edge function ──────────────────────────────────────────

async function callCfoChat(history) {
  const { data, error } = await supabaseClient.functions.invoke("cfo-chat", {
    body: { messages: history },
  });
  if (error) {
    // Try to extract the real error message from the function response body
    if (error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (body?.error) throw new Error(body.error);
      } catch (inner) {
        if (!(inner instanceof SyntaxError)) throw inner;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data.reply;
}

// ── Widget rendering ──────────────────────────────────────────────────────────

function renderChatWidget(session) {
  if (window.top !== window) return; // sidebar only lives in the persistent shell

  if (!document.getElementById("chatPanel")) {
    const overlay = document.createElement("div");
    overlay.innerHTML = `
      <div id="chatBackdrop" class="chat-backdrop"></div>
      <div id="chatPanel" class="chat-panel">
        <div class="chat-panel-head">
          <div style="display:flex;align-items:center;gap:10px">
            <svg viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
              <defs><linearGradient id="hBg" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#7c5cfc"/><stop offset="1" stop-color="#2dd4a0"/></linearGradient></defs>
              <circle cx="16" cy="16" r="15" fill="url(#hBg)" opacity=".9"/>
              <circle cx="16" cy="12" r="5" fill="#f3c9a8"/>
              <path d="M7 28c0-5 4-8.5 9-8.5s9 3.5 9 8.5" fill="#1c1c28"/>
            </svg>
            <div>
              <div class="chat-panel-title">CFO Copiloto</div>
              <div class="chat-panel-sub">Análise financeira com Claude AI</div>
            </div>
          </div>
          <button id="chatClose" class="chat-close" aria-label="Fechar chat">✕</button>
        </div>
        <div id="chatMessages" class="chat-messages"></div>
        <form id="chatForm" class="chat-input-row">
          <input id="chatInput" type="text" placeholder="Pergunte sobre os dados financeiros…" autocomplete="off" />
          <button type="submit" id="chatSendBtn">Enviar</button>
        </form>
      </div>
    `;
    while (overlay.firstElementChild) {
      document.body.appendChild(overlay.firstElementChild);
    }

    const panel      = document.getElementById("chatPanel");
    const backdrop   = document.getElementById("chatBackdrop");
    const closeBtn   = document.getElementById("chatClose");
    const messagesEl = document.getElementById("chatMessages");
    const form       = document.getElementById("chatForm");
    const input      = document.getElementById("chatInput");
    const sendBtn    = document.getElementById("chatSendBtn");

    function paint(history) {
      messagesEl.innerHTML = history
        .map(
          (m) =>
            `<div class="chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-bot"}">${md(m.text)}</div>`
        )
        .join("");
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      const el = document.createElement("div");
      el.id = "chatTyping";
      el.className = "chat-msg chat-msg-bot chat-typing";
      el.innerHTML = `<span></span><span></span><span></span>`;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      document.getElementById("chatTyping")?.remove();
    }

    window.openCfoChat = function () {
      panel.classList.add("open");
      backdrop.classList.add("open");
      paint(getChatHistory());
      input.focus();
    };

    window.closeCfoChat = function () {
      panel.classList.remove("open");
      backdrop.classList.remove("open");
    };

    closeBtn.addEventListener("click", window.closeCfoChat);
    backdrop.addEventListener("click", window.closeCfoChat);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      const history = getChatHistory();
      history.push({ role: "user", text });
      saveChatHistory(history);
      input.value = "";
      paint(history);

      // Disable input while waiting
      input.disabled = true;
      sendBtn.disabled = true;
      showTyping();

      try {
        const reply = await callCfoChat(history);
        removeTyping();
        history.push({ role: "bot", text: reply });
        saveChatHistory(history);
        paint(history);
      } catch (err) {
        removeTyping();
        const msg = err?.message || "";
        const errMsg =
          msg.includes("Failed to fetch") ||
          msg.includes("FunctionsFetchError") ||
          msg.includes("Failed to send") ||
          msg.includes("NetworkError") ||
          msg.includes("fetch")
            ? "Serviço de IA temporariamente indisponível. Verifique se a função cfo-chat está implantada no Supabase e tente novamente."
            : "Erro ao consultar o CFO Copiloto: " + (msg || "erro desconhecido");
        history.push({ role: "bot", text: errMsg });
        saveChatHistory(history);
        paint(history);
      } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  // ── Sidebar mini widget ───────────────────────────────────────────────────

  const slot = document.getElementById("chatMiniSlot");
  if (slot && !document.getElementById("cfoMiniWidget")) {
    slot.innerHTML = `
      <div id="cfoMiniWidget" class="cfo-mini" role="button" tabindex="0" aria-label="Abrir chat com o CFO Copiloto">
        ${CFO_ILLUSTRATION_SVG}
        <div class="cfo-mini-title">💬 CFO Copiloto</div>
        ${session && session.name ? `<div class="cfo-mini-greeting">Bem-vindo(a), ${session.name}</div>` : ""}
        <div class="cfo-mini-bubble">Pergunte sobre seus documentos e indicadores</div>
      </div>
    `;
    const mini = document.getElementById("cfoMiniWidget");
    mini.addEventListener("click", () => window.openCfoChat());
    mini.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.openCfoChat();
      }
    });
  }
}
