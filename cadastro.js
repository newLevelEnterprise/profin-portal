/**
 * Cadastro por auto-atendimento.
 *
 * O que esta página faz: coleta dados, confirma o e-mail por código e manda o
 * cliente para a página de pagamento do Asaas. O que ela **não** faz, e não
 * pode fazer: criar usuário, criar organização ou dar acesso. O cadastro do
 * portal é invite-only e continua sendo — quem emite o convite é o webhook do
 * Asaas, depois do pagamento confirmado (supabase/functions/asaas-webhook).
 *
 * Nenhum dado de cartão toca este arquivo. O cartão é digitado na página
 * hospedada do Asaas; aqui só existe a URL para onde o navegador vai.
 */

/** Estado do cadastro em andamento. Só identificadores e o que o usuário digitou. */
const sgState = {
  /** @type {string|null} */ requestId: null,
  name: "",
  email: "",
  companyName: "",
  cnpj: "",
  phone: "",
  /** @type {string|null} */ planCode: null,
  /** @type {Array<Record<string, unknown>>} */ plans: [],
  /**
   * URL da cobrança aberta. Guardada para o cliente conseguir reabrir o
   * pagamento se fechar a janela sem concluir — o `checkout` é idempotente e
   * devolveria a mesma cobrança, mas exigir que ele refaça o caminho todo
   * para chegar nela é perder gente à toa.
   * @type {string|null}
   */
  checkoutUrl: null,
};

/** Marca que o Asaas devolve na URL depois do pagamento (signup-return.ts). */
const SG_RETURN_FLAG = "retorno";

/** Aviso que a janela de pagamento manda para quem a abriu, ao voltar. */
const SG_RETURN_MESSAGE = "profinlab:signup:retorno";

/** Onde o cadastro em andamento sobrevive ao pulo para o Asaas e de volta. */
const SG_STORAGE_KEY = "profinlab.signup";

const SG_STEPS = [
  "sgStepAccount",
  "sgStepCode",
  "sgStepCompany",
  "sgStepPlan",
  "sgStepPay",
  "sgStepWaiting",
  "sgStepDone",
];

// ── Utilitários ─────────────────────────────────────────────────────────────

/**
 * Prefixado porque esta função existe com o mesmo nome em settings.js,
 * backoffice.js e script.js. Os arquivos da raiz compartilham um escopo global
 *; duas definições carregadas pela mesma página se
 * sobrescrevem em silêncio.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sgEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function sgEl(id) {
  return document.getElementById(id);
}

/** @param {string} stepId */
function sgShow(stepId) {
  for (const id of SG_STEPS) {
    const node = sgEl(id);
    if (node) node.hidden = id !== stepId;
  }

  // A trilha de progresso conta só os cinco passos que o usuário preenche;
  // espera e conclusão ficam cheias.
  const index = SG_STEPS.indexOf(stepId);
  const rail = sgEl("sgRail");
  if (rail) rail.style.width = `${Math.min(100, Math.round(((index + 1) / 5) * 100))}%`;

  const focusTarget = sgEl(stepId)?.querySelector("input, button");
  if (focusTarget instanceof HTMLElement) focusTarget.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * @param {string} id
 * @param {string} message
 */
function sgError(id, message) {
  const node = sgEl(id);
  if (node) node.textContent = message;
}

/**
 * @param {HTMLButtonElement} button
 * @param {boolean} busy
 * @param {string} label
 */
function sgBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = busy ? "Aguarde…" : label;
}

/**
 * Chamada à Edge Function `signup`.
 *
 * O erro do servidor é devolvido como texto para a tela mostrar: "Código
 * incorreto" e "Limite de envios atingido" pedem reações diferentes do
 * usuário, e um "erro inesperado" genérico esconde as duas.
 *
 * @param {string} action
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown>>}
 */
async function sgCall(action, payload = {}) {
  const { data, error } = await supabaseClient.functions.invoke("signup", {
    body: { action, ...payload },
  });

  if (error) {
    // supabase-js embrulha a resposta de erro; o texto útil está no corpo.
    let detail = "";
    try {
      detail = (await error.context?.json())?.error ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Não foi possível completar a operação.");
  }

  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }

  return /** @type {Record<string, unknown>} */ (data ?? {});
}

// ── CNPJ ────────────────────────────────────────────────────────────────────
//
// Espelha isValidCnpj de src/domain/company.js, que é onde há teste, e o banco
// confere de novo em is_valid_cnpj antes de qualquer cobrança
// (20260827000004). A cópia daqui só decide quando mostrar a mensagem.

const SG_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SG_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * @param {number[]} pesos
 * @param {string} digits
 * @returns {number}
 */
function sgCheckDigit(pesos, digits) {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) soma += Number(digits[i]) * pesos[i];
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function sgIsValidCnpj(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  if (sgCheckDigit(SG_DV1, digits) !== Number(digits[12])) return false;
  return sgCheckDigit(SG_DV2, digits) === Number(digits[13]);
}

/**
 * @param {string} value
 * @returns {string}
 */
function sgFormatCnpj(value) {
  const d = String(value).replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * @param {number|null|undefined} cents
 * @returns {string}
 */
function sgPriceLabel(cents) {
  // Espelha planPriceLabel de src/domain/billing.js, que é onde há teste.
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return "—";
  const value = Number(cents) / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

// ── Persistência entre o portal e o Asaas ───────────────────────────────────

function sgSave() {
  try {
    sessionStorage.setItem(
      SG_STORAGE_KEY,
      JSON.stringify({
        requestId: sgState.requestId,
        email: sgState.email,
        name: sgState.name,
        companyName: sgState.companyName,
        cnpj: sgState.cnpj,
        phone: sgState.phone,
        planCode: sgState.planCode,
        checkoutUrl: sgState.checkoutUrl,
      }),
    );
  } catch {
    // Navegação privada bloqueia sessionStorage. O cadastro continua
    // funcionando na mesma aba; só não sobrevive ao pulo para o Asaas.
  }
}

function sgRestore() {
  try {
    const raw = sessionStorage.getItem(SG_STORAGE_KEY);
    if (!raw) return;
    Object.assign(sgState, JSON.parse(raw));
  } catch {
    /* idem */
  }
}

// ── Planos ──────────────────────────────────────────────────────────────────

/**
 * @param {Record<string, unknown>} plan
 * @returns {string}
 */
function sgPlanCard(plan) {
  const limits = [
    plan.bank_account_limit ? `Até ${plan.bank_account_limit} contas bancárias` : "Contas bancárias sob medida",
    plan.company_limit ? `Até ${plan.company_limit} CNPJs` : null,
    plan.user_limit ? `Até ${plan.user_limit} usuários` : null,
    "Classificação por IA e DRE, Balanço e DFC",
  ].filter(Boolean);

  const badge = plan.highlight ? `<i class="sg-rec">${sgEscapeHtml(plan.highlight)}</i>` : "";
  const forWho = plan.bank_account_limit
    ? `Para quem opera com até ${plan.bank_account_limit} contas conectadas.`
    : "Desenho sob medida.";

  return `<button type="button" class="sg-plan" data-plan="${sgEscapeHtml(plan.code)}" aria-pressed="false">
    ${badge}
    <span class="sg-p-name">${sgEscapeHtml(plan.name)}</span>
    <span class="sg-p-for">${sgEscapeHtml(forWho)}</span>
    <span class="sg-p-price"><b class="num">${sgEscapeHtml(sgPriceLabel(Number(plan.monthly_cents)))}</b><small>por mês</small></span>
    <span class="sg-p-more">${limits.map((l) => `<span>${sgEscapeHtml(String(l))}</span>`).join("")}</span>
  </button>`;
}

async function sgLoadPlans() {
  const container = sgEl("sgPlans");
  if (!container) return;

  try {
    const result = await sgCall("plans");
    const plans = Array.isArray(result.plans) ? result.plans : [];
    sgState.plans = /** @type {Array<Record<string, unknown>>} */ (plans);
    container.innerHTML = plans.map((plan) => sgPlanCard(plan)).join("");

    for (const button of container.querySelectorAll("[data-plan]")) {
      button.addEventListener("click", () => {
        for (const other of container.querySelectorAll("[data-plan]")) {
          other.setAttribute("aria-pressed", "false");
        }
        button.setAttribute("aria-pressed", "true");
        sgState.planCode = button.getAttribute("data-plan");
        const next = sgEl("sgPlanNext");
        if (next instanceof HTMLButtonElement) next.disabled = false;
        sgSave();
      });
    }
  } catch (err) {
    sgError("sgPlanError", err instanceof Error ? err.message : "Não foi possível carregar os planos.");
  }
}

// ── Resumo ──────────────────────────────────────────────────────────────────

function sgRenderSummary() {
  const plan = sgState.plans.find((p) => p.code === sgState.planCode);
  const node = sgEl("sgSummary");
  if (!node) return;

  node.innerHTML = `
    <div class="sg-kv"><dt>Empresa</dt><dd>${sgEscapeHtml(sgState.companyName)}</dd></div>
    <div class="sg-kv"><dt>CNPJ</dt><dd class="num">${sgEscapeHtml(sgFormatCnpj(sgState.cnpj))}</dd></div>
    <div class="sg-kv"><dt>Responsável</dt><dd>${sgEscapeHtml(sgState.name)}</dd></div>
    <div class="sg-kv"><dt>E-mail</dt><dd>${sgEscapeHtml(sgState.email)}</dd></div>
    <div class="sg-kv"><dt>Plano</dt><dd>${sgEscapeHtml(String(plan?.name ?? "—"))}</dd></div>
    <div class="sg-kv tot"><dt>Total por mês</dt><dd class="num">${sgEscapeHtml(sgPriceLabel(Number(plan?.monthly_cents)))}</dd></div>`;
}

// ── A janela de pagamento ───────────────────────────────────────────────────

/**
 * Abre a janela do pagamento **vazia**, no clique.
 *
 * Tem que ser síncrono: `window.open` chamado depois de um `await` perde o
 * vínculo com o gesto do usuário e o navegador bloqueia. Por isso a janela
 * nasce em branco aqui e só recebe o endereço quando o `checkout` responde.
 *
 * Devolve `null` quando o bloqueador barrou mesmo assim — quem chama navega
 * na própria aba, que é como esta página funcionava antes de existir janela.
 *
 * @returns {Window|null}
 */
function sgOpenPaymentWindow() {
  try {
    return window.open("", "profinlabPagamento", "width=520,height=760,noopener=no");
  } catch {
    return null;
  }
}

/**
 * Esta página é a janela de pagamento voltando do Asaas?
 *
 * O Asaas devolve o navegador para cá depois do pagamento. Se quem voltou foi
 * a janela que abrimos, ela não deve virar um segundo cadastro na tela: avisa
 * quem a abriu e se fecha. A página de trás é que mostra o resultado.
 *
 * @returns {boolean} true se a janela se encarregou de fechar
 */
function sgHandoffToOpener() {
  const params = new URLSearchParams(window.location.search);
  if (params.get(SG_RETURN_FLAG) !== "1") return false;

  const opener = window.opener;
  if (!opener || opener.closed) return false;

  try {
    opener.postMessage(SG_RETURN_MESSAGE, window.location.origin);
    window.close();
    return true;
  } catch {
    // Sem acesso a quem abriu (bloqueio de origem cruzada, janela já fechada):
    // esta página segue sozinha e mostra o andamento aqui mesmo.
    return false;
  }
}

/**
 * Escuta o aviso da janela de pagamento para consultar na hora, em vez de
 * esperar o próximo tique de cinco segundos.
 */
function sgListenForReturn() {
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data !== SG_RETURN_MESSAGE) return;
    sgWatchProvisioning();
  });
}

// ── Espera pelo webhook ─────────────────────────────────────────────────────

let sgPollTimer = 0;

/**
 * O pagamento é confirmado pelo Asaas contra o nosso webhook, não contra esta
 * página: o cliente pode fechar a aba que o convite chega igual. O polling
 * existe só para quem ficou olhando.
 */
async function sgPollStatus() {
  if (!sgState.requestId) return;

  try {
    const result = await sgCall("status", { requestId: sgState.requestId });
    if (result.status === "provisioned") {
      window.clearInterval(sgPollTimer);
      const email = sgEl("sgDoneEmail");
      if (email) email.textContent = String(result.email ?? sgState.email);
      try {
        sessionStorage.removeItem(SG_STORAGE_KEY);
      } catch {
        /* idem */
      }
      sgShow("sgStepDone");
    }
  } catch {
    // Falha de rede numa consulta de andamento não merece mensagem de erro:
    // a próxima tentativa acontece em cinco segundos.
  }
}

function sgWatchProvisioning() {
  sgShow("sgStepWaiting");

  // O link de reabrir só aparece quando há cobrança aberta para voltar. Quem
  // chegou aqui já tendo pago não precisa ver um convite para pagar de novo.
  const retry = sgEl("sgWaitRetry");
  const link = sgEl("sgWaitRetryLink");
  if (retry && link && sgState.checkoutUrl) {
    if (link instanceof HTMLAnchorElement) link.href = sgState.checkoutUrl;
    retry.hidden = false;
  }

  window.clearInterval(sgPollTimer);
  sgPollStatus();
  sgPollTimer = window.setInterval(sgPollStatus, 5000);
}

// ── Ligações da tela ────────────────────────────────────────────────────────

function sgWireOtp() {
  const inputs = [...document.querySelectorAll("#sgOtp input")];

  inputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value && index < inputs.length - 1) inputs[index + 1]?.focus();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) inputs[index - 1]?.focus();
    });

    // Colar o código inteiro é o caminho natural de quem copiou do e-mail.
    input.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text") ?? "";
      const digits = text.replace(/\D/g, "").slice(0, inputs.length);
      if (!digits) return;
      event.preventDefault();
      digits.split("").forEach((digit, offset) => {
        const target = inputs[offset];
        if (target instanceof HTMLInputElement) target.value = digit;
      });
      inputs[Math.min(digits.length, inputs.length - 1)]?.focus();
    });
  });
}

function sgOtpValue() {
  return [...document.querySelectorAll("#sgOtp input")]
    .map((input) => (input instanceof HTMLInputElement ? input.value : ""))
    .join("");
}

function sgWire() {
  // Voltar
  for (const button of document.querySelectorAll("[data-sg-back]")) {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-sg-back");
      if (target) sgShow(target);
    });
  }

  // 1 · conta
  sgEl("sgAccountForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    sgError("sgAccountError", "");

    const submit = sgEl("sgAccountSubmit");
    if (!(submit instanceof HTMLButtonElement)) return;

    const name = /** @type {HTMLInputElement} */ (sgEl("sgName")).value.trim();
    const email = /** @type {HTMLInputElement} */ (sgEl("sgEmail")).value.trim().toLowerCase();
    const terms = /** @type {HTMLInputElement} */ (sgEl("sgTerms")).checked;

    if (!name) return sgError("sgAccountError", "Informe seu nome.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sgError("sgAccountError", "Informe um e-mail válido.");
    if (!terms) return sgError("sgAccountError", "É preciso aceitar os termos para continuar.");

    sgBusy(submit, true, "Enviar código");
    try {
      const result = await sgCall("start", { name, email });

      if (result.alreadyRegistered) {
        sgError(
          "sgAccountError",
          "Este e-mail já tem acesso ao portal. Entre pela tela de login ou use a recuperação de senha.",
        );
        return;
      }

      sgState.name = name;
      sgState.email = email;
      sgState.requestId = String(result.requestId ?? "");
      sgSave();

      const label = sgEl("sgCodeEmail");
      if (label) label.textContent = email;
      sgShow("sgStepCode");
    } catch (err) {
      sgError("sgAccountError", err instanceof Error ? err.message : "Não foi possível enviar o código.");
    } finally {
      sgBusy(submit, false, "Enviar código");
    }
  });

  // 2 · código
  sgEl("sgCodeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    sgError("sgCodeError", "");

    const submit = sgEl("sgCodeSubmit");
    if (!(submit instanceof HTMLButtonElement)) return;

    const code = sgOtpValue();
    if (code.length !== 6) return sgError("sgCodeError", "Digite os seis dígitos.");

    sgBusy(submit, true, "Confirmar");
    try {
      await sgCall("verify", { requestId: sgState.requestId, code });
      sgShow("sgStepCompany");
    } catch (err) {
      sgError("sgCodeError", err instanceof Error ? err.message : "Código inválido.");
    } finally {
      sgBusy(submit, false, "Confirmar");
    }
  });

  sgEl("sgResend")?.addEventListener("click", async () => {
    const button = sgEl("sgResend");
    if (!(button instanceof HTMLButtonElement)) return;

    sgError("sgCodeError", "");
    button.disabled = true;
    try {
      await sgCall("start", { name: sgState.name, email: sgState.email });
      sgError("sgCodeError", "");
      button.textContent = "Código reenviado";
    } catch (err) {
      sgError("sgCodeError", err instanceof Error ? err.message : "Não foi possível reenviar.");
      button.disabled = false;
      return;
    }
    // Espelha o intervalo mínimo que a Edge Function exige entre dois envios.
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = "Reenviar código";
    }, 60000);
  });

  // 3 · empresa
  const cnpjInput = sgEl("sgCnpj");
  cnpjInput?.addEventListener("input", () => {
    if (!(cnpjInput instanceof HTMLInputElement)) return;
    cnpjInput.value = sgFormatCnpj(cnpjInput.value);

    const digits = cnpjInput.value.replace(/\D/g, "");
    cnpjInput.classList.toggle("ok", digits.length === 14 && sgIsValidCnpj(digits));
    cnpjInput.classList.toggle("bad", digits.length === 14 && !sgIsValidCnpj(digits));
  });

  sgEl("sgCompanyForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sgError("sgCompanyError", "");

    const companyName = /** @type {HTMLInputElement} */ (sgEl("sgCompanyName")).value.trim();
    const cnpj = /** @type {HTMLInputElement} */ (sgEl("sgCnpj")).value.replace(/\D/g, "");
    const phone = /** @type {HTMLInputElement} */ (sgEl("sgPhone")).value.replace(/\D/g, "");

    if (!companyName) return sgError("sgCompanyError", "Informe o nome da empresa.");
    if (!sgIsValidCnpj(cnpj)) return sgError("sgCompanyError", "CNPJ inválido — confira os dígitos.");

    sgState.companyName = companyName;
    sgState.cnpj = cnpj;
    sgState.phone = phone;
    sgSave();
    sgShow("sgStepPlan");
  });

  // 4 · plano
  sgEl("sgSalesToggle")?.addEventListener("click", () => {
    sgEl("sgSales")?.classList.toggle("on");
  });

  sgEl("sgPlanNext")?.addEventListener("click", () => {
    if (!sgState.planCode) return;
    sgRenderSummary();
    sgShow("sgStepPay");
  });

  // 5 · pagamento
  sgEl("sgPayGo")?.addEventListener("click", async () => {
    const button = sgEl("sgPayGo");
    if (!(button instanceof HTMLButtonElement)) return;

    sgError("sgPayError", "");
    sgBusy(button, true, "Ir para o pagamento");
    try {
      // Antes do await, enquanto o clique ainda vale como gesto do usuário.
      const paymentWindow = sgOpenPaymentWindow();

      let result;
      try {
        result = await sgCall("checkout", {
          requestId: sgState.requestId,
          planCode: sgState.planCode,
          companyName: sgState.companyName,
          cnpj: sgState.cnpj,
          name: sgState.name,
          phone: sgState.phone,
        });
      } catch (err) {
        // Sem endereço para onde mandar, a janela em branco só confunde.
        paymentWindow?.close();
        throw err;
      }

      const url = String(result.checkoutUrl ?? "");
      if (!url.startsWith("https://")) {
        paymentWindow?.close();
        throw new Error("O processador não devolveu um endereço de pagamento válido.");
      }

      sgState.checkoutUrl = url;
      sgSave();

      if (paymentWindow) {
        // O Asaas devolve o cliente para cá quando o pagamento termina, e a
        // janela se fecha sozinha avisando esta página (sgHandoffToOpener).
        paymentWindow.location.href = url;
        sgWatchProvisioning();
      } else {
        // Bloqueador de pop-up: navega na própria aba. A volta cai no passo de
        // espera, porque o identificador do cadastro ficou no sessionStorage.
        window.location.href = url;
      }
    } catch (err) {
      sgError("sgPayError", err instanceof Error ? err.message : "Não foi possível abrir o pagamento.");
      sgBusy(button, false, "Ir para o pagamento");
    }
  });
}

// ── Início ──────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Antes de qualquer coisa: se esta página é a janela de pagamento voltando
  // do Asaas, ela avisa quem a abriu e se fecha. Carregar planos e montar a
  // tela numa janela que vai sumir é trabalho jogado fora — e pior, o cliente
  // veria um cadastro piscando antes de fechar.
  sgRestore();
  if (sgHandoffToOpener()) return;

  sgWire();
  sgWireOtp();
  sgListenForReturn();
  await sgLoadPlans();

  // Quem volta do Asaas cai direto na espera; quem chega pela primeira vez
  // começa do zero.
  if (sgState.requestId) {
    try {
      const result = await sgCall("status", { requestId: sgState.requestId });
      if (result.status === "provisioned") {
        const email = sgEl("sgDoneEmail");
        if (email) email.textContent = String(result.email ?? sgState.email);
        sgShow("sgStepDone");
        return;
      }
      if (result.status === "awaiting_payment") {
        sgWatchProvisioning();
        return;
      }
    } catch {
      // Cadastro que não existe mais (expirou, foi limpo): recomeça.
    }
  }

  sgShow("sgStepAccount");
});
