function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Password show/hide toggle ─────────────────────────────────────────────
const _EYE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _EYE_OFF_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a21.6 21.6 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 7 11 7a21.6 21.6 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function wirePasswordToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  btn.innerHTML = _EYE_ICON;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = show ? _EYE_OFF_ICON : _EYE_ICON;
    btn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
  });
}

// ── Links de acesso (convite e redefinição de senha) ─────────────────────────
//
// Espelha src/domain/access-link.js, que é onde estas regras têm teste —
// inclusive o teste que impede as duas cópias de divergirem. Os arquivos da
// raiz não fazem `import`.
//
// O link que o Supabase gera é gasto no primeiro GET, e quem faz esse GET nem
// sempre é a pessoa: a pré-visualização do WhatsApp, o antivírus de e-mail
// corporativo e o admin que "só testa" também abrem. O link seguro traz o
// token no fragmento sem gastá-lo; esta página só o valida no clique.

/**
 * @param {string | null | undefined} hash
 * @returns {{ kind: "token", tokenHash: string, type: "recovery" | "invite" }
 *   | { kind: "legacy", type: string } | { kind: "error", code: string } | { kind: "none" }}
 */
function parseAccessFragment(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));

  const error = params.get("error_code") || params.get("error");
  if (error) return { kind: "error", code: error };

  if (params.get("access_token")) return { kind: "legacy", type: params.get("type") || "" };

  const tokenHash = params.get("token_hash") || "";
  const type = params.get("type");
  if (/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash) && (type === "recovery" || type === "invite")) {
    return { kind: "token", tokenHash, type };
  }

  return { kind: "none" };
}

/**
 * @param {string | null | undefined} code
 * @returns {string}
 */
function accessErrorMessage(code) {
  if (code === "otp_expired") {
    return "Este link já foi usado ou expirou. Peça um novo ao administrador da sua organização, ou use “Primeiro acesso ou esqueceu a senha?” abaixo.";
  }
  return "Não foi possível validar este link. Peça um novo ao administrador da sua organização.";
}

// Lido uma vez, na carga: o cliente do Supabase processa o fragmento de forma
// assíncrona e pode limpá-lo antes de alguém consultar de novo.
const _accessLink = parseAccessFragment(window.location.hash);

// Link antigo de redefinição: o Supabase já gastou o token e entrega a sessão
// com o evento PASSWORD_RECOVERY. Link seguro: nada foi gasto, a página espera
// o clique. Nos dois casos quem chega precisa escolher a senha antes de ir
// para o app — o redirecionamento automático tem que esperar.
const _isRecovery = _accessLink.kind === "legacy" && _accessLink.type === "recovery";
const _holdRedirect = _isRecovery || _accessLink.kind === "token";

// Auto-redirect if already signed in or arriving via invite/magic link
// but NOT if this is a password recovery redirect
supabaseClient.auth.getSession().then(({ data: { session } }) => {
  if (session && !_holdRedirect) window.location.href = "app-shell.html";
});

supabaseClient.auth.onAuthStateChange((event, session) => {
  // No link seguro quem conduz a tela é o clique em showAccessGate. O evento
  // que verifyOtp dispara — SIGNED_IN no convite — mandaria a pessoa para o
  // app sem nunca ter escolhido senha.
  if (_accessLink.kind === "token") return;

  if (event === "PASSWORD_RECOVERY") {
    showSetPasswordForm(session);
    return;
  }
  if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && !_isRecovery) {
    window.location.href = "app-shell.html";
  }
});

wirePasswordToggle("password", "passwordToggleBtn");

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const errorEl = document.getElementById("loginError");
    errorEl.textContent = "";

    if (!email || !password) {
      errorEl.textContent = "Informe e-mail e senha.";
      return;
    }

    const submitBtn = document.getElementById("loginSubmit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Entrando...";

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";

    if (error) {
      errorEl.textContent = "E-mail ou senha inválidos.";
      return;
    }

    window.location.href = "app-shell.html";
  });
}

// ── Forgot password / first access ───────────────────────────────────────────

const forgotLink = document.getElementById("forgotPasswordLink");
if (forgotLink) {
  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const errorEl = document.getElementById("loginError");
    const successEl = document.getElementById("loginSuccess");
    errorEl.textContent = "";
    successEl.style.display = "none";

    if (!email) {
      errorEl.textContent = "Digite seu e-mail acima antes de continuar.";
      return;
    }

    // Derivado da página atual, nunca fixo: o domínio já mudou uma vez e o
    // link de redefinição continuou apontando para o endereço antigo, que hoje
    // devolve 404. Esta é a tela de login, que é quem trata o #type=recovery,
    // então o próprio diretório dela é o destino certo.
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: new URL(".", window.location.href).href,
    });

    if (error) {
      errorEl.textContent = "Erro ao enviar e-mail: " + error.message;
      return;
    }

    successEl.textContent = `E-mail de redefinição enviado para ${email}. Verifique sua caixa de entrada.`;
    successEl.style.display = "";
  });
}

// ── Set new password form (shown after clicking reset link) ──────────────────

async function showSetPasswordForm(session) {
  const card = document.querySelector(".login-card");
  if (!card) return;

  // The recovery link's own token is what proves this is the right account —
  // this is just making that visible, so someone who followed a stale or
  // forwarded link (a shared inbox, a link sent to the wrong person) sees
  // whose access they're about to set a password for before doing it.
  const authUser = session?.user;
  let name = authUser?.user_metadata?.name || null;
  if (authUser?.id) {
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("name")
      .eq("id", authUser.id)
      .single();
    if (profile?.name) name = profile.name;
  }
  const email = authUser?.email || "";

  card.innerHTML = `
    <h2>Definir senha</h2>
    <p class="login-sub">Escolha uma senha para acessar a plataforma.</p>
    ${email ? `
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:10px 14px;margin-bottom:16px">
        <div style="font-size:11px;color:var(--ink2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Definindo senha para</div>
        <div style="font-weight:700">${escapeHtml(name || email)}</div>
        ${name ? `<div style="font-size:12.5px;color:var(--ink2)">${escapeHtml(email)}</div>` : ""}
      </div>
    ` : ""}
    <form id="setPasswordForm" novalidate>
      <label for="newPassword">Nova senha</label>
      <div class="password-field">
        <input type="password" id="newPassword" placeholder="mínimo 6 caracteres" required />
        <button type="button" class="password-toggle-btn" id="newPasswordToggleBtn" aria-label="Mostrar senha"></button>
      </div>
      <label for="confirmPassword">Confirmar senha</label>
      <div class="password-field">
        <input type="password" id="confirmPassword" placeholder="repita a senha" required />
        <button type="button" class="password-toggle-btn" id="confirmPasswordToggleBtn" aria-label="Mostrar senha"></button>
      </div>
      <button type="submit" id="setPasswordSubmit">Salvar senha e entrar</button>
      <p class="error" id="setPasswordError"></p>
    </form>
  `;
  wirePasswordToggle("newPassword", "newPasswordToggleBtn");
  wirePasswordToggle("confirmPassword", "confirmPasswordToggleBtn");
  document.getElementById("setPasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pwd = document.getElementById("newPassword").value;
    const confirm = document.getElementById("confirmPassword").value;
    const errorEl = document.getElementById("setPasswordError");
    const btn = document.getElementById("setPasswordSubmit");
    errorEl.textContent = "";

    if (pwd.length < 6) { errorEl.textContent = "A senha deve ter ao menos 6 caracteres."; return; }
    if (pwd !== confirm) { errorEl.textContent = "As senhas não coincidem."; return; }

    btn.disabled = true;
    btn.textContent = "Salvando...";

    const { error } = await supabaseClient.auth.updateUser({ password: pwd });

    if (error) {
      errorEl.textContent = "Erro: " + error.message;
      btn.disabled = false;
      btn.textContent = "Salvar senha e entrar";
      return;
    }

    window.location.href = "app-shell.html";
  });
}

// ── Porta de entrada do link seguro ──────────────────────────────────────────

/** Tira o token da barra de endereço: gasto ou recusado, ele não serve mais, e
 *  recarregar a página não pode tentar de novo. */
function clearAccessFragment() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/**
 * @param {{ tokenHash: string, type: "recovery" | "invite" }} link
 */
function showAccessGate(link) {
  const card = document.querySelector(".login-card");
  if (!card) return;

  card.innerHTML = `
    <h2>${link.type === "invite" ? "Criar seu acesso" : "Redefinir sua senha"}</h2>
    <p class="login-sub">Por segurança, o link só é validado quando você clica no botão abaixo.</p>
    <form id="accessGateForm" novalidate>
      <button type="submit" id="accessGateSubmit">Continuar</button>
      <p class="error" id="accessGateError"></p>
    </form>
    <p style="text-align:center;margin-top:14px">
      <a href="index.html" style="font-size:12px;color:var(--ink2);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.15)">Voltar ao login</a>
    </p>
  `;

  const form = /** @type {HTMLFormElement} */ (document.getElementById("accessGateForm"));
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById("accessGateSubmit"));
  const errorEl = /** @type {HTMLElement} */ (document.getElementById("accessGateError"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = "Validando...";
    errorEl.textContent = "";

    const { data, error } = await supabaseClient.auth.verifyOtp({
      token_hash: link.tokenHash,
      type: link.type,
    });
    clearAccessFragment();

    if (error || !data?.session) {
      // Token recusado não volta a valer: o botão some em vez de convidar a
      // tentar de novo, e a mensagem diz o caminho que funciona.
      btn.style.display = "none";
      errorEl.textContent = accessErrorMessage(error?.code);
      return;
    }

    showSetPasswordForm(data.session);
  });
}

if (_accessLink.kind === "token") {
  showAccessGate(_accessLink);
} else if (_accessLink.kind === "error") {
  // Antes este fragmento era ignorado e a pessoa via o login mudo.
  const loginErrorEl = document.getElementById("loginError");
  if (loginErrorEl) loginErrorEl.textContent = accessErrorMessage(_accessLink.code);
  clearAccessFragment();
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });
}

const todayDate = document.getElementById("todayDate");
if (todayDate) {
  todayDate.textContent = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
