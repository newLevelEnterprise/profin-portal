// ── Shared platform layer: org/admin sessions backed by Supabase ──

// Real auth session backed by Supabase: confirms there is a logged-in user,
// then loads their profile (org, role, permissions) via Row Level Security.
async function requireOrgSession() {
  const { data } = await supabaseClient.auth.getSession();
  const authUser = data.session && data.session.user;
  if (!authUser) {
    window.top.location.href = "index.html";
    return null;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("org_id, name, email, role, permissions, is_profix_admin, organizations ( name, plan, status, dashboard_layout )")
    .eq("id", authUser.id)
    .single();

  if (error || !profile) {
    window.top.location.href = "index.html";
    return null;
  }

  return {
    id: authUser.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    permissions: profile.permissions || [],
    orgId: profile.org_id,
    orgName: profile.organizations ? profile.organizations.name : null,
    // Ordem dos cards do topo do dashboard. Nulo aqui não é erro: a tela trata
    // ausência como layout atual (src/domain/dashboard-layout.js).
    dashboardLayout: profile.organizations ? profile.organizations.dashboard_layout : null,
    isProFixAdmin: !!profile.is_profix_admin,
  };
}

// Profix-internal admin session: same Supabase login, but only users with
// profiles.is_profix_admin = true are let into the backoffice.
async function requireAdminSession() {
  const { data } = await supabaseClient.auth.getSession();
  const authUser = data.session && data.session.user;
  if (!authUser) {
    window.location.href = "admin-login.html";
    return null;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("email, name, is_profix_admin")
    .eq("id", authUser.id)
    .single();

  if (error || !profile || !profile.is_profix_admin) {
    window.location.href = "admin-login.html";
    return null;
  }

  return { id: authUser.id, email: profile.email, name: profile.name };
}

// ── App shell: sidebar nav + "powered by" footer, shared across all org-scoped pages ──
// `hint` is a one-sentence description shown as a hover tooltip next to each link.
const NAV_ITEMS = [
  { href: "dashboard.html",   label: "Visão Financeira Gerencial", match: "dashboard.html",   permission: "dashboard",
    hint: "Saldo, entradas e saídas consolidadas das suas contas conectadas." },
  { href: "resultados.html",  label: "Resultados Financeiros",     match: "resultados.html",  permission: "resultados",
    hint: "DRE, Balanço e Fluxo de Caixa apurados e projetados pela IA." },
  { href: "documents.html",   label: "Documentos",                 match: "documents.html",   permission: "documentos",
    hint: "Envie balancetes para a IA extrair e classificar automaticamente." },
  { href: "knowledge.html",   label: "Tutorial",    match: "knowledge.html",   permission: "conhecimento",
    hint: "Conteúdos rápidos para entender melhor seus indicadores financeiros." },
  { href: "logs.html",        label: "Logs",                       match: "logs.html",        adminOnly: true,
    hint: "Histórico de execuções de IA e consumo de tokens da organização." },
];

function renderAppShell(activePage, session) {
  const envEl = document.getElementById("appTopbarEnv");
  if (envEl && session && session.orgName) {
    envEl.textContent = `Ambiente ${session.orgName}`;
  }

  const settingsBtn = document.getElementById("topbarSettingsBtn");
  if (settingsBtn) {
    const canSeeSettings = session && (session.isProFixAdmin || session.permissions.includes("configuracoes"));
    settingsBtn.style.display = canSeeSettings ? "" : "none";
  }

  const navRoot = document.getElementById("sidebarNav");
  if (navRoot) {
    const visibleItems = session
      ? NAV_ITEMS.filter((item) =>
          item.adminOnly ? session.isProFixAdmin : session.permissions.includes(item.permission)
        )
      : NAV_ITEMS;
    navRoot.innerHTML = `
      <nav class="sidebar-links">
        ${visibleItems
          .map(
            (item) => `
          <a class="sidebar-link${item.match === activePage ? " active" : ""}" href="${item.href}" target="contentFrame" data-tip="${escapeHtmlAttr(item.hint || "")}">${item.label}</a>`
          )
          .join("")}
      </nav>
      <div id="viewSwitcherSlot"></div>
      <div id="accountHealthSlot"></div>
      <div class="sidebar-footer">
        <div class="powered-by">
          <img src="nexus-logo.png" alt="Nexus" class="profix-logo-img" />
          <span class="powered-by-text">powered by</span>
        </div>
      </div>
    `;
  }

}

// ── Faturamento: aviso de atraso e bloqueio ────────────────────────────────
//
// Mora aqui, e não em cada página, porque o aviso precisa seguir o usuário por
// todas as telas: quem está em atraso não abre Faturamento por conta própria.
// O shell chama uma vez, e o aviso fica acima do iframe.

/** Espelha ACCESS_* de src/domain/billing.js, que é onde há teste. */
const BILLING_ACCESS_OK = "ok";
const BILLING_ACCESS_WARNING = "warning";
const BILLING_ACCESS_BLOCKED = "blocked";

/**
 * Espelha billingAccess de src/domain/billing.js, que é onde há teste.
 *
 * O viés é deliberado: na dúvida, libera. Bloquear indevidamente tira o
 * cliente de dentro dos próprios dados financeiros e custa muito mais caro
 * que um dia a mais de acesso para quem está atrasado.
 */
function billingAccessState(subscription, todayIso, graceDays) {
  const free = { state: BILLING_ACCESS_OK, blockOn: null, daysUntilBlock: null };
  if (!subscription) return free;

  // Cobrança fora do portal: o cliente paga boleto enviado pela ProFin e o
  // portal não recebe confirmação nenhuma. Avisar de atraso aqui seria
  // afirmar um fato não apurado para quem está em dia. O modo tem precedência
  // sobre o status — quem manda é quem cobra.
  if (subscription.billing_mode === "external") return free;

  // Pedido de saída: o Asaas já parou de cobrar, mas o mês foi pago e é do
  // cliente. Vale até current_period_end, sem somar a carência de
  // inadimplência — que é régua de quem atrasou, não de quem pediu para sair.
  // Sem data, libera: cortar por falta de informação é o erro caro aqui.
  //
  // Espelha src/domain/billing.js, que é onde esta regra tem teste. Mudou lá,
  // muda aqui.
  if (subscription.cancel_at_period_end === true) {
    const endMillis = Date.parse(`${String(subscription.current_period_end || "")}T00:00:00Z`);
    const nowMillis = Date.parse(`${todayIso}T00:00:00Z`);
    if (!Number.isFinite(endMillis) || !Number.isFinite(nowMillis)) return free;

    const daysLeft = Math.max(0, Math.round((endMillis - nowMillis) / (24 * 60 * 60 * 1000)));
    return {
      state: nowMillis >= endMillis ? BILLING_ACCESS_BLOCKED : BILLING_ACCESS_OK,
      blockOn: subscription.current_period_end || null,
      daysUntilBlock: daysLeft,
    };
  }

  const status = subscription.status;
  if (status === "active" || status === "trialing") return free;
  if (status === "suspended" || status === "canceled") {
    return { state: BILLING_ACCESS_BLOCKED, blockOn: subscription.past_due_since || null, daysUntilBlock: 0 };
  }
  if (status !== "past_due") return free;

  const dueMillis = Date.parse(`${String(subscription.past_due_since || "")}T00:00:00Z`);
  if (!Number.isFinite(dueMillis)) {
    return { state: BILLING_ACCESS_WARNING, blockOn: null, daysUntilBlock: null };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const blockMillis = dueMillis + Math.max(0, Number(graceDays) || 0) * dayMs;
  const todayMillis = Date.parse(`${todayIso}T00:00:00Z`);
  const blockOn = new Date(blockMillis).toISOString().slice(0, 10);

  if (!Number.isFinite(todayMillis)) {
    return { state: BILLING_ACCESS_WARNING, blockOn, daysUntilBlock: null };
  }

  return {
    state: todayMillis >= blockMillis ? BILLING_ACCESS_BLOCKED : BILLING_ACCESS_WARNING,
    blockOn,
    daysUntilBlock: Math.max(0, Math.round((blockMillis - todayMillis) / dayMs)),
  };
}

/** @param {string|null} iso yyyy-mm-dd */
function billingBannerDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return match ? `${match[3]}/${match[2]}` : "em breve";
}

/**
 * Lê a assinatura da organização e pinta o aviso, ou o bloqueio, no shell.
 *
 * Não escreve nada: o estado da cobrança tem um autor só, o webhook do Asaas.
 *
 * @returns {Promise<string>} o estado de acesso resultante
 */
async function renderBillingBanner(session) {
  const slot = document.getElementById("billingBannerSlot");
  if (!slot || !session || !session.orgId) return BILLING_ACCESS_OK;

  const [{ data: subscription }, { data: settings }] = await Promise.all([
    supabaseClient
      .from("org_subscriptions")
      .select("status, billing_mode, cancel_at_period_end, past_due_since, current_period_end")
      .eq("org_id", session.orgId)
      .maybeSingle(),
    supabaseClient.from("billing_settings").select("grace_days, support_email").eq("id", true).maybeSingle(),
  ]);

  const graceDays = Number(settings && settings.grace_days) || 7;
  const today = new Date().toISOString().slice(0, 10);
  const access = billingAccessState(subscription, today, graceDays);

  if (access.state === BILLING_ACCESS_OK) {
    slot.innerHTML = "";
    return access.state;
  }

  const isBlocked = access.state === BILLING_ACCESS_BLOCKED;

  // Quem cancelou não está devendo nada, e dizer "falta de pagamento" para
  // quem pagou tudo e pediu para sair é acusação errada — além de mandar a
  // pessoa procurar uma cobrança em aberto que não existe.
  const canceled = subscription && subscription.cancel_at_period_end === true;

  const headline = canceled
    ? isBlocked
      ? "Assinatura encerrada"
      : "Assinatura cancelada"
    : isBlocked
      ? "Acesso suspenso por falta de pagamento"
      : "Há uma cobrança em aberto";

  const detail = canceled
    ? isBlocked
      ? "O período contratado terminou. Seus dados continuam guardados; reative o plano para voltar a acessar."
      : `Seu acesso continua até ${billingBannerDate(access.blockOn)}, o fim do período já pago.`
    : isBlocked
      ? "Seus dados continuam guardados. Regularize a cobrança para reativar o acesso."
      : `Atualize a forma de pagamento até ${billingBannerDate(access.blockOn)} para não perder o acesso.`;

  // Só Admin resolve pagamento; para o resto o aviso é informativo, e mandar
  // um Visualizador para uma tela que ele não pode abrir só gera confusão.
  const canFix = session.role === "Admin" || session.isProFixAdmin;

  slot.innerHTML = `
    <div class="bl-gbanner${isBlocked ? " crit" : ""}" role="status">
      <span class="bl-gb-ico" aria-hidden="true">!</span>
      <span class="bl-gb-txt">
        <b>${escapeHtmlAttr(headline)}</b>
        <p>${escapeHtmlAttr(detail)}</p>
      </span>
      ${canFix
        ? '<button type="button" class="bl-gb-cta" id="billingBannerCta">Atualizar pagamento</button>'
        : `<a class="bl-gb-cta" href="mailto:${escapeHtmlAttr((settings && settings.support_email) || "contato@profinlab.com.br")}">Falar com o suporte</a>`}
    </div>`;

  const cta = document.getElementById("billingBannerCta");
  if (cta) {
    cta.addEventListener("click", async () => {
      cta.disabled = true;
      try {
        const { data, error } = await supabaseClient.functions.invoke("billing", {
          body: { action: "payment-link" },
        });
        if (!error && data && data.url) {
          // O cartão é digitado na página do Asaas; o portal só abre o endereço.
          window.open(data.url, "_blank", "noopener");
          return;
        }
        // Sem cobrança em aberto no Asaas (ou organização sem assinatura lá),
        // o caminho útil é a própria tela de faturamento.
        window.location.href = "app-shell.html?page=settings.html";
      } finally {
        cta.disabled = false;
      }
    });
  }

  return access.state;
}

// ── Visões: qual recorte de empresas a tela está mostrando ──────────────────
//
// Uma organização pode ter contas de mais de um CNPJ. A visão diz quais
// empresas entram no cálculo. A visão padrão de toda organização cobre todas
// elas, que é exatamente o recorte de hoje — por isso ligar esta feature não
// muda nenhum número.
//
// O id da visão viaja na query string, para o shell e o iframe concordarem
// sem precisarem conversar. A última escolha fica no localStorage para
// sobreviver a um F5.

const VIEW_STORAGE_PREFIX = "cfo4u-active-view:";

function activeViewStorageKey(orgId) {
  return `${VIEW_STORAGE_PREFIX}${orgId || "sem-org"}`;
}

/**
 * O recorte pedido: a query string manda, e o localStorage é só a memória de
 * quem voltou depois. Vale tanto no shell quanto dentro do iframe, porque
 * ambos recebem o mesmo `?view=`.
 */
function getActiveViewId(orgId) {
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(activeViewStorageKey(orgId)) || null;
  } catch (err) {
    // Navegador com storage bloqueado não pode impedir a tela de abrir.
    console.warn("Não foi possível ler a visão salva:", err);
    return null;
  }
}

function rememberActiveViewId(orgId, viewId) {
  try {
    if (viewId) localStorage.setItem(activeViewStorageKey(orgId), viewId);
    else localStorage.removeItem(activeViewStorageKey(orgId));
  } catch (err) {
    console.warn("Não foi possível guardar a visão escolhida:", err);
  }
}

async function loadOrgViews(session) {
  if (!session?.orgId || typeof supabaseClient === "undefined") return [];

  const { data, error } = await supabaseClient
    .from("views")
    .select("id, name, is_all, is_default, view_companies ( company_id )")
    .eq("org_id", session.orgId)
    .order("is_all", { ascending: false })
    .order("name");

  if (error) {
    // Sem visões o portal continua funcionando exatamente como antes delas
    // existirem, que é o comportamento correto para uma feature de recorte.
    console.warn("Não foi possível carregar as visões:", error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    isAll: row.is_all === true,
    isDefault: row.is_default === true,
    companyIds: (row.view_companies || []).map((vc) => vc.company_id).filter(Boolean),
  }));
}

/** Espelha resolveActiveView de src/domain/view.js, que é onde há teste. */
function resolveActiveViewFrom(views, requestedId) {
  if (!views.length) return null;
  if (requestedId) {
    const requested = views.find((view) => view.id === requestedId);
    if (requested) return requested;
  }
  return views.find((view) => view.isDefault) || views[0];
}

/**
 * Desenha o seletor na sidebar.
 *
 * Só aparece quando há mais de uma visão: numa organização de CNPJ único o
 * seletor não oferece escolha nenhuma e vira ruído permanente.
 */
/**
 * Linha de apoio do seletor. Só devolve texto fixo e um número — nada daqui
 * vem do banco, então não precisa passar por escape.
 *
 * @param {{ isAll?: boolean, companyIds?: string[] } | null} view
 * @returns {string}
 */
function viewSwitcherSubtitle(view) {
  if (!view || view.isAll) return "Todas as empresas da organização";
  const total = view.companyIds ? view.companyIds.length : 0;
  return total === 1 ? "1 empresa neste recorte" : `${total} empresas neste recorte`;
}

async function renderViewSwitcher(session, onChange) {
  const slot = document.getElementById("viewSwitcherSlot");
  if (!slot || !session?.orgId) return null;

  const views = await loadOrgViews(session);
  const active = resolveActiveViewFrom(views, getActiveViewId(session.orgId));

  if (views.length < 2) {
    slot.innerHTML = "";
    return active;
  }

  const activeId = active ? active.id : "";
  slot.innerHTML = `
    <div class="view-switch">
      <div class="view-switch-label">Visão</div>
      <!-- O nome truncaria numa sidebar de 220px: "Timbre — 04.159.780/0001-78"
           não cabe. O title devolve o nome inteiro no hover. -->
      <select id="viewSwitcherSelect" aria-label="Recorte de empresas" title="${escapeHtmlAttr(active ? active.name : "")}">
        ${views.map((view) => `
          <option value="${escapeHtmlAttr(view.id)}"${view.id === activeId ? " selected" : ""}>${escapeHtmlAttr(view.name)}</option>
        `).join("")}
      </select>
      <div class="view-switch-sub">${viewSwitcherSubtitle(active)}</div>
    </div>
  `;

  const select = document.getElementById("viewSwitcherSelect");
  select.addEventListener("change", () => {
    // Só o iframe renavega ao trocar de visão; a sidebar continua a mesma, então
    // o title precisa acompanhar ou fica mostrando o nome da visão anterior.
    const chosen = views.find((view) => view.id === select.value) || null;
    select.title = chosen ? chosen.name : "";
    const sub = slot.querySelector(".view-switch-sub");
    if (sub) sub.textContent = viewSwitcherSubtitle(chosen);

    rememberActiveViewId(session.orgId, select.value);
    if (typeof onChange === "function") onChange(select.value);
  });

  return active;
}

// O escopo é resolvido uma vez por carregamento: trocar de visão renavega o
// iframe com outro ?view=, então a página recarrega inteira de qualquer forma.
let _activeViewScopePromise = null;
let _activeViewScopeOrgId = null;

async function resolveActiveViewScope(session) {
  const orgId = session?.orgId || null;
  if (_activeViewScopePromise && _activeViewScopeOrgId === orgId) return _activeViewScopePromise;

  const promise = (async () => {
    const [views, { data: companies }] = await Promise.all([
      loadOrgViews(session),
      // Os nomes vêm junto porque quem precisa do recorte quase sempre precisa
      // rotular a empresa também — no aviso de período, na coluna de origem.
      orgId
        ? supabaseClient.from("companies").select("id, name, cnpj").eq("org_id", orgId)
        : Promise.resolve({ data: [] }),
    ]);

    const view = resolveActiveViewFrom(views, getActiveViewId(orgId));

    return {
      view,
      // Sem visão cadastrada, ou visão que cobre tudo, ou recorte vazio: não
      // filtra nada. É o que mantém os números de hoje idênticos.
      coversEverything: !view || view.isAll === true || view.companyIds.length === 0,
      companyIds: new Set(view ? view.companyIds : []),
      companies: companies || [],
      companyNames: new Map((companies || []).map((c) => [c.id, c.name])),
    };
  })();

  _activeViewScopePromise = promise;
  _activeViewScopeOrgId = orgId;
  promise.catch(() => {
    if (_activeViewScopePromise === promise) _activeViewScopePromise = null;
  });
  return promise;
}

/**
 * Quais conexões entram no recorte. `null` significa NÃO filtrar — não é o
 * mesmo que conjunto vazio, e confundir os dois esvaziaria a tela.
 *
 * Espelha allowedPluggyItemIds de src/domain/view.js, que é onde há teste.
 */
function allowedItemIdsForScope(scope, pluggyItems) {
  if (!scope || scope.coversEverything) return null;

  const allowed = new Set();
  for (const item of pluggyItems || []) {
    const itemId = item?.pluggy_item_id;
    if (!itemId) continue;
    if (item.company_id && scope.companyIds.has(item.company_id)) allowed.add(itemId);
  }
  return allowed;
}

// ── Sidebar: connection health ───────────────────────────────────────────────
//
// A bank connection that quietly stops syncing is the most expensive failure
// this platform has. Nothing breaks visibly: every chart still renders, every
// total still adds up — just from data that stopped arriving days ago. The
// error is only discovered when someone reconciles against a bank statement,
// which is exactly how a Santander connection sat broken for two weeks while
// R$143 mil of transfers appeared to have vanished.
//
// So the state of every connection goes in the sidebar, on every page, whether
// or not the user went looking for it.

// The scheduled sync runs twice on weekdays, so a connection can legitimately
// go quiet over a long weekend. Three days is late enough to mean something.
const CONNECTION_STALE_AFTER_HOURS = 72;

const INACTIVE_PLUGGY_STATUSES = [
  "disconnected",
  "desconectado",
  "deleted",
  "removido",
  "revoked",
  "revogado",
  "error_disconnected",
];

function isActivePluggyItemStatus(status) {
  return !INACTIVE_PLUGGY_STATUSES.includes(String(status || "").toLowerCase());
}

function formatConnectionAge(isoDate) {
  if (!isoDate) return "nunca sincronizada";

  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) return "data desconhecida";

  const hours = Math.floor((Date.now() - then) / 3600000);
  if (hours < 1) return "agora há pouco";
  if (hours < 24) return `há ${hours}h`;

  const days = Math.floor(hours / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

// Mirrors the diagnosis in settings.js — kept as its own small copy because
// settings.js runs inside the content iframe and is not loaded in the shell.
// The wording here is deliberately shorter: this panel has a sidebar's width,
// and the full explanation already lives on the Configurações screen.
function diagnosePluggyConnection(item) {
  const status = String(item?.status || "").toUpperCase();
  const execution = String(item?.execution_status || "").toUpperCase();

  if (status.includes("LOGIN_ERROR") || execution.includes("LOGIN_ERROR")) {
    return { severity: "error", label: "Erro de login" };
  }
  if (status === "ERROR" || execution === "ERROR") {
    return { severity: "error", label: "Erro na sincronização" };
  }
  if (status === "OUTDATED" || execution === "OUTDATED") {
    return { severity: "warn", label: "Dados desatualizados" };
  }
  if (status.includes("WAITING") || execution.includes("WAITING")) {
    return { severity: "warn", label: "Aguardando ação no banco" };
  }

  const lastSync = item?.last_sync_at || item?.updated_at;
  const ageHours = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 3600000 : Infinity;
  if (!(ageHours <= CONNECTION_STALE_AFTER_HOURS)) {
    return { severity: "warn", label: `Sem sincronizar ${formatConnectionAge(lastSync)}` };
  }

  return null;
}

async function renderAccountHealth(session) {
  const slot = document.getElementById("accountHealthSlot");
  if (!slot || !session?.orgId || typeof supabaseClient === "undefined") return;

  let items = [];
  try {
    const { data, error } = await supabaseClient
      .from("pluggy_items")
      .select("id, connector_name, status, execution_status, last_sync_at, updated_at")
      .eq("org_id", session.orgId);
    if (error) throw error;
    items = (data || []).filter((item) => isActivePluggyItemStatus(item.status));
  } catch (err) {
    // A panel that cannot load its own data must not imply everything is fine.
    console.warn("Não foi possível carregar a saúde das conexões:", err);
    slot.innerHTML = `
      <div class="conn-health">
        <div class="conn-health-title">Conexões bancárias</div>
        <div class="conn-health-sub">Não foi possível verificar agora.</div>
      </div>
    `;
    return;
  }

  if (!items.length) {
    slot.innerHTML = `
      <div class="conn-health" data-conn-health-open="1" role="button" tabindex="0">
        <div class="conn-health-title">Conexões bancárias</div>
        <div class="conn-health-sub">Nenhum banco conectado ainda.</div>
        <div class="conn-health-cta">Conectar banco →</div>
      </div>
    `;
  } else {
    const problems = items
      .map((item) => ({ item, diagnosis: diagnosePluggyConnection(item) }))
      .filter((row) => row.diagnosis);

    const healthy = items.length - problems.length;

    if (!problems.length) {
      const newest = items
        .map((item) => item.last_sync_at || item.updated_at)
        .filter(Boolean)
        .sort()
        .pop();

      slot.innerHTML = `
        <div class="conn-health is-ok" data-conn-health-open="1" role="button" tabindex="0">
          <div class="conn-health-title">Conexões bancárias</div>
          <div class="conn-health-line"><span class="conn-dot is-ok"></span>${items.length} conectada${items.length > 1 ? "s" : ""}, tudo em dia</div>
          <div class="conn-health-sub">Última sincronização ${escapeHtmlAttr(formatConnectionAge(newest))}</div>
        </div>
      `;
    } else {
      const worst = problems.some((row) => row.diagnosis.severity === "error") ? "error" : "warn";

      slot.innerHTML = `
        <div class="conn-health is-${worst}" data-conn-health-open="1" role="button" tabindex="0">
          <div class="conn-health-title">Conexões bancárias</div>
          <div class="conn-health-line">
            <span class="conn-dot is-${worst}"></span>${problems.length} de ${items.length} com problema
          </div>
          <ul class="conn-health-list">
            ${problems
              .slice(0, 3)
              .map(
                (row) => `
              <li class="conn-health-item is-${row.diagnosis.severity}">
                <span class="conn-health-bank">${escapeHtmlAttr(row.item.connector_name || "Instituição financeira")}</span>
                <span class="conn-health-reason">${escapeHtmlAttr(row.diagnosis.label)}</span>
              </li>`
              )
              .join("")}
            ${problems.length > 3 ? `<li class="conn-health-more">+${problems.length - 3} outra(s)</li>` : ""}
          </ul>
          ${healthy > 0 ? `<div class="conn-health-sub">${healthy} outra(s) em dia</div>` : ""}
          <div class="conn-health-cta">Resolver em Configurações →</div>
        </div>
      `;
    }
  }

  const card = slot.querySelector("[data-conn-health-open]");
  if (!card) return;

  const openSettings = () => {
    // navigate() belongs to the shell, which owns the content iframe; on pages
    // that render the sidebar without it, fall back to a normal navigation.
    if (typeof window.navigateShell === "function") window.navigateShell("settings.html");
    else window.top.location.href = "app-shell.html?page=settings.html";
  };

  card.addEventListener("click", openSettings);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSettings();
    }
  });
}

function escapeHtmlAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
