function escapeHtml(v) {
  return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Mirrors settings.js's ROLE_PERMISSIONS — default permission set applied
// when a role is picked/changed in the invite or edit-user forms.
const ROLE_PERMISSIONS = {
  Admin: ["dashboard", "resultados", "documentos", "configuracoes", "chat", "conhecimento"],
  Financeiro: ["dashboard", "resultados", "documentos", "chat", "conhecimento"],
  Visualizador: ["dashboard", "conhecimento"],
};

function goBackofficeTab(i, el) {
  document.querySelectorAll(".tabnav .tab").forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".page").forEach((p, idx) => p.classList.toggle("active", idx === i));
}

function fmtNum(n) {
  return (n || 0).toLocaleString("pt-BR");
}

const LOG_ACTION_LABEL = {
  "analyze-document":      "Análise de doc.",
  "cfo-chat":              "Chat CFO",
  "project-financial":     "Projeção IA",
  "classify_document":     "Classificação de doc.",
  "classify_transactions": "Classificação de transações",
};

function logActionLabel(action) {
  return LOG_ACTION_LABEL[action] || action;
}

function statusBadge(status) {
  const cls = status === "ativa" ? "kd-up" : status === "trial" ? "kd-down" : "kd-flat";
  return `<span class="kpi-delta ${cls}">${status}</span>`;
}

// CNPJ no navegador serve para dar retorno imediato no formulário. A
// autoridade é o banco: a constraint companies_cnpj_valido chama
// public.is_valid_cnpj() e recusa o que não fecha. Se esta cópia divergir da
// de lá, o pior que acontece é uma mensagem imprecisa — dado inválido não
// entra. A mesma regra, com teste, está em src/domain/company.js.
function cnpjDigits(value) {
  return String(value == null ? "" : value).replace(/\D/g, "");
}

function cnpjMask(value) {
  const d = cnpjDigits(value);
  if (d.length !== 14) return String(value == null ? "" : value);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function cnpjHasValidCheckDigits(value) {
  const d = cnpjDigits(value);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const dv = (weights) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(d[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  if (dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) !== Number(d[12])) return false;
  return dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
}

function docStatusLabel(status) {
  return { pronto: "Pronto", processando: "Processando", erro: "Erro" }[status] || status;
}

// Pulls every organization plus per-org counts/usage in parallel. There's no
// real token/execution metering yet, so those numbers come straight from the
// logs table (sum of tokens, count of rows) as a stand-in.
async function loadOrgsWithStats() {
  const [{ data: orgs }, { data: users }, { data: docs }, { data: analyses }] = await Promise.all([
    supabaseClient.from("organizations").select("*").order("created_at"),
    supabaseClient.from("profiles").select("id, org_id"),
    supabaseClient.from("documents").select("id, org_id"),
    supabaseClient.from("document_analyses").select("id, org_id, status"),
  ]);

  return (orgs || []).map((o) => ({
    ...o,
    usersCount: (users || []).filter((u) => u.org_id === o.id).length,
    documentsCount: (docs || []).filter((d) => d.org_id === o.id).length,
    analysesCount: (analyses || []).filter((a) => a.org_id === o.id).length,
    analysesDone: (analyses || []).filter((a) => a.org_id === o.id && a.status === "concluido").length,
  }));
}

async function paintAdminKpis(orgs) {
  const totalUsers    = orgs.reduce((s, o) => s + o.usersCount, 0);
  const totalDocs     = orgs.reduce((s, o) => s + o.documentsCount, 0);
  const totalAnalyses = orgs.reduce((s, o) => s + o.analysesCount, 0);
  const kpis = [
    { label: "Organizações",       value: orgs.length },
    { label: "Usuários (total)",   value: totalUsers },
    { label: "Documentos (total)", value: fmtNum(totalDocs) },
    { label: "Análises (total)",   value: fmtNum(totalAnalyses) },
  ];
  document.getElementById("adminKpis").innerHTML = kpis
    .map(
      (k) => `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`
    )
    .join("");
}

async function paintOrgs(orgs) {
  document.getElementById("orgTbody").innerHTML = orgs
    .map(
      (o) => `
      <tr class="org-row" data-id="${o.id}" style="cursor:pointer">
        <td style="text-align:left;font-weight:600">${o.name}</td>
        <td>${o.plan}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${o.usersCount}</td>
        <td>${o.documentsCount}</td>
        <td>${o.analysesCount}</td>
        <td>${o.analysesDone}</td>
      </tr>`
    )
    .join("");

  document.querySelectorAll(".org-row").forEach((row) => {
    row.addEventListener("click", () => openOrgDetail(row.dataset.id));
  });
}

async function paintAgents() {
  const { data: agents, error } = await supabaseClient
    .from("document_type_agents")
    .select("doc_type, agent_label, model, max_tokens, response_format, updated_at, updated_by")
    .order("doc_type");

  if (error) {
    document.getElementById("agentTbody").innerHTML =
      `<tr><td colspan="5" style="color:var(--ink2);text-align:center;padding:14px">Não foi possível carregar os agentes.</td></tr>`;
    return;
  }

  document.getElementById("agentTbody").innerHTML = (agents || []).map((a) => `
    <tr>
      <td style="text-align:left;font-weight:600">${escapeHtml(a.doc_type)}</td>
      <td style="text-align:left;color:var(--ink2)">${escapeHtml(a.agent_label)}</td>
      <td style="text-align:left;font-size:12px;color:var(--ink2)">${escapeHtml(a.model)}</td>
      <td><span class="kpi-delta kd-flat" style="font-size:10px">${escapeHtml(a.response_format)}</span></td>
      <td><button class="btn-link btn-edit-agent" data-type="${escapeHtml(a.doc_type)}" style="font-size:12px">Editar</button></td>
    </tr>`).join("");

  document.querySelectorAll(".btn-edit-agent").forEach((btn) => {
    btn.addEventListener("click", () => openAgentModal(btn.dataset.type, agents));
  });
}

function openAgentModal(docType, agents) {
  const a = agents.find((x) => x.doc_type === docType);
  if (!a) return;
  document.getElementById("agentDocType").value = a.doc_type;
  document.getElementById("agentLabel").value = a.agent_label;
  document.getElementById("agentModel").value = a.model;
  document.getElementById("agentMaxTokens").value = a.max_tokens;
  document.getElementById("agentResponseFormat").value = a.response_format;
  document.getElementById("agentError").textContent = "";
  document.getElementById("agentSuccess").style.display = "none";

  // Fetch full prompt (not returned by list query to keep it light)
  supabaseClient
    .from("document_type_agents")
    .select("prompt_system")
    .eq("doc_type", docType)
    .single()
    .then(({ data }) => {
      document.getElementById("agentPrompt").value = data?.prompt_system || "";
    });

  document.getElementById("agentModalRoot").style.display = "flex";
}

// Users of the currently open org-detail modal, kept for the "Links de
// acesso" button handlers (re-set each time openOrgDetail runs).
let _orgDetailUsers = [];
let _orgDetailOrgId = null;

// Filter state for the logs table (Consumo de Tokens & Logs tab)
let _selectedOrgId  = null;
let _logsDateFrom   = null;
let _logsDateTo     = null;

async function paintLogs(orgs, filters = {}) {
  const { orgId = null, dateFrom = null, dateTo = null } = filters;
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  let query = supabaseClient.from("logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (orgId)    query = query.eq("org_id", orgId);
  if (dateFrom) query = query.gte("created_at", new Date(dateFrom + "T00:00:00").toISOString());
  if (dateTo)   query = query.lte("created_at", new Date(dateTo + "T23:59:59").toISOString());

  const [{ data: logs }, { data: profiles }] = await Promise.all([
    query,
    supabaseClient.from("profiles").select("id, name, email"),
  ]);

  const userName = new Map((profiles || []).map((p) => [p.id, p.name || p.email]));
  const isOk = (status) => status === "success" || status === "sucesso";

  document.getElementById("logTbody").innerHTML = (logs || [])
    .map(
      (l) => `
      <tr>
        <td style="text-align:left">${new Date(l.created_at).toLocaleString("pt-BR")}</td>
        <td style="text-align:left">${escapeHtml(orgName.get(l.org_id) || l.org_id || "—")}</td>
        <td style="text-align:left">${escapeHtml(logActionLabel(l.action))}</td>
        <td style="text-align:left">${escapeHtml(l.user_id ? (userName.get(l.user_id) || l.user_id) : "—")}</td>
        <td><span class="kpi-delta ${isOk(l.status) ? "kd-up" : "kd-down"}">${escapeHtml(l.status)}</span></td>
        <td>${l.tokens_used ? fmtNum(l.tokens_used) : "—"}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">Nenhum log encontrado</td></tr>`;

  const labelEl = document.getElementById("logsFilterLabel");
  if (labelEl) {
    const parts = [orgId ? `Organização: ${orgName.get(orgId) || orgId}` : "Todas as organizações"];
    if (dateFrom || dateTo) parts.push(`Período: ${dateFrom || "início"} até ${dateTo || "hoje"}`);
    labelEl.textContent = parts.join(" · ");
  }
}

function refreshLogsWithFilters(orgs) {
  paintLogs(orgs, { orgId: _selectedOrgId, dateFrom: _logsDateFrom, dateTo: _logsDateTo });
}

// ── Token consumption per org for a given "YYYY-MM" month ────────────────────
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

let _lastTokenMonthStr = null;

async function paintTokenConsumption(orgs, monthStr) {
  _lastTokenMonthStr = monthStr;
  const tbody = document.getElementById("tokenTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">Carregando…</td></tr>`;

  const [y, m] = monthStr.split("-").map((n) => parseInt(n, 10));
  const rangeStart = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const rangeEnd   = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString();

  const { data: logs, error } = await supabaseClient
    .from("logs")
    .select("org_id, tokens_used, created_at")
    .gte("created_at", rangeStart)
    .lt("created_at", rangeEnd);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">Erro ao carregar consumo.</td></tr>`;
    return;
  }

  const totals = new Map();
  for (const l of logs || []) {
    totals.set(l.org_id, (totals.get(l.org_id) || 0) + (l.tokens_used || 0));
  }

  const rows = orgs.map((o) => {
    const used  = totals.get(o.id) || 0;
    const limit = o.token_limit_monthly;
    const pct   = limit ? Math.round((used / limit) * 100) : null;
    const statusHtml = !limit
      ? `<span class="kpi-delta kd-flat">sem limite</span>`
      : pct >= 100
        ? `<span class="kpi-delta kd-down">Limite excedido</span>`
        : pct >= 80
          ? `<span class="kpi-delta kd-down">Próximo do limite</span>`
          : `<span class="kpi-delta kd-up">OK</span>`;
    return { id: o.id, name: o.name, used, limit, pct, statusHtml };
  }).sort((a, b) => b.used - a.used);

  tbody.innerHTML = rows.map((r) => `
    <tr class="token-org-row${r.id === _selectedOrgId ? " token-org-row-selected" : ""}" data-org-id="${escapeHtml(r.id)}">
      <td style="text-align:left;font-weight:600">${escapeHtml(r.name)}</td>
      <td>${fmtNum(r.used)}</td>
      <td>
        <span class="token-limit-display">${r.limit ? fmtNum(r.limit) : "—"}</span>
        <button type="button" class="btn-link token-edit-limit-btn" data-org-id="${escapeHtml(r.id)}" data-current-limit="${r.limit ?? ""}" style="font-size:11px;margin-left:6px">editar</button>
      </td>
      <td>${r.pct != null ? r.pct + "%" : "—"}</td>
      <td style="text-align:left">${r.statusHtml}</td>
    </tr>`).join("") ||
    `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">Nenhum consumo neste período</td></tr>`;

  // Click a row → filter the logs table below to this org (click again to clear)
  tbody.querySelectorAll(".token-org-row").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".token-edit-limit-btn, .token-limit-edit-cell")) return;
      const orgId = tr.dataset.orgId;
      _selectedOrgId = _selectedOrgId === orgId ? null : orgId;
      paintTokenConsumption(orgs, monthStr);
      refreshLogsWithFilters(orgs);
    });
  });

  // Inline "editar" → number input + salvar/cancelar, updates token_limit_monthly directly
  tbody.querySelectorAll(".token-edit-limit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const orgId   = btn.dataset.orgId;
      const current = btn.dataset.currentLimit;
      const td = btn.closest("td");
      td.classList.add("token-limit-edit-cell");
      td.innerHTML = `
        <input type="number" min="0" step="1000" class="form-input token-limit-edit-input"
          value="${escapeHtml(current)}" placeholder="sem limite"
          style="width:110px;display:inline-block;padding:4px 8px;font-size:12px" />
        <button type="button" class="btn-link token-limit-save-btn" style="font-size:11px;margin-left:4px">salvar</button>
        <button type="button" class="btn-link token-limit-cancel-btn" style="font-size:11px;margin-left:2px;color:var(--muted)">cancelar</button>
      `;
      td.querySelector(".token-limit-save-btn").addEventListener("click", async (e2) => {
        e2.stopPropagation();
        const input = td.querySelector(".token-limit-edit-input");
        const raw = input.value.trim();
        const newLimit = raw === "" ? null : parseInt(raw, 10);
        const { error: saveErr } = await supabaseClient
          .from("organizations")
          .update({ token_limit_monthly: newLimit })
          .eq("id", orgId);
        if (saveErr) { alert("Erro ao salvar limite: " + saveErr.message); return; }
        const org = orgs.find((o) => o.id === orgId);
        if (org) org.token_limit_monthly = newLimit;
        await paintTokenConsumption(orgs, monthStr);
      });
      td.querySelector(".token-limit-cancel-btn").addEventListener("click", (e2) => {
        e2.stopPropagation();
        paintTokenConsumption(orgs, monthStr);
      });
    });
  });
}

async function openOrgDetail(orgId) {
  const [{ data: org }, { data: orgUsersRaw }, { data: orgDocs }, { data: orgLogs }, { data: orgKnowledge }, { data: orgIntegrations }, statusResult] = await Promise.all([
    supabaseClient.from("organizations").select("*").eq("id", orgId).single(),
    supabaseClient.from("profiles").select("id, name, email, role, permissions").eq("org_id", orgId),
    supabaseClient.from("documents").select("name, type, status").eq("org_id", orgId),
    supabaseClient.from("logs").select("created_at, action, status").eq("org_id", orgId).order("created_at", { ascending: false }),
    supabaseClient.from("knowledge_items").select("id, title, category, created_by_name, created_at").eq("org_id", orgId).order("created_at"),
    supabaseClient.from("integrations").select("id, name, enabled").eq("org_id", orgId)
      .in("name", ["Contabilidade Domínio", "ERP TOTVS Protheus", "Google Sheets"]).order("name"),
    // Activation status lives in auth.users, not readable from the client —
    // same bulk lookup Settings > Usuários uses. Degrades to no badge/link
    // rather than blocking the rest of the org detail if it fails.
    supabaseClient.functions.invoke("user-access-links", { body: { action: "status", org_id: orgId } }),
  ]);

  // Empresas e conexões vêm depois porque a lista de empresas é o que dá
  // sentido à coluna de vínculo das conexões.
  const [{ data: orgCompanies }, { data: orgItems }, { data: orgAccounts }] = await Promise.all([
    supabaseClient.from("companies").select("id, name, cnpj, is_active").eq("org_id", orgId).order("name"),
    supabaseClient.from("pluggy_items").select("id, pluggy_item_id, connector_name, status, company_id").eq("org_id", orgId),
    supabaseClient.from("pluggy_accounts").select("pluggy_item_id, raw").eq("org_id", orgId),
  ]);

  const companies = orgCompanies || [];
  // O titular real de cada conexão, para sugerir a empresa das que ainda não
  // têm vínculo — é o mesmo campo que o backfill usou.
  //
  // Espelha src/domain/company-assignment.js (holderCnpjByItem), que é onde a
  // regra tem teste. Conexão cujas contas apontam titulares diferentes fica de
  // fora: escolher uma seria chute, e chute aqui manda dinheiro para o recorte
  // errado sem dar erro.
  const holdersSeen = new Map();
  for (const account of orgAccounts || []) {
    const holder = cnpjDigits(account?.raw?.taxNumber);
    if (holder.length !== 14 || !account.pluggy_item_id) continue;
    const set = holdersSeen.get(account.pluggy_item_id) || new Set();
    set.add(holder);
    holdersSeen.set(account.pluggy_item_id, set);
  }
  const holderByItem = new Map();
  for (const [itemId, cnpjs] of holdersSeen) {
    if (cnpjs.size === 1) holderByItem.set(itemId, [...cnpjs][0]);
  }
  const activeItems = (orgItems || []).filter((item) => isActivePluggyItemStatus(item.status));
  const itemsByCompany = new Map();
  for (const item of orgItems || []) {
    if (!item.company_id) continue;
    itemsByCompany.set(item.company_id, (itemsByCompany.get(item.company_id) || 0) + 1);
  }

  const statusById = new Map((statusResult?.data?.statuses || []).map((s) => [s.id, s]));
  const orgUsers = (orgUsersRaw || []).map((u) => ({ ...u, _status: statusById.get(u.id) || null }));
  _orgDetailUsers = orgUsers;
  _orgDetailOrgId = orgId;

  document.getElementById("orgModalTitle").textContent = org.name;
  document.getElementById("orgModalBody").innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px">
      <div class="cs">Plano ${org.plan} · ${statusBadge(org.status)} · criada em ${new Date(org.created_at).toLocaleDateString("pt-BR")}</div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button class="btn-secondary" id="toggleOrgStatusBtn" style="padding:4px 12px;font-size:12px">${org.status === "inativa" ? "Ativar" : "Inativar"}</button>
        <button class="btn-secondary" id="editOrgBtn" style="padding:4px 12px;font-size:12px">Editar org</button>
        <button class="btn-secondary" id="deleteOrgBtn" style="padding:4px 12px;font-size:12px;color:#ff6b6b;border-color:rgba(255,107,107,.4)">Apagar</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="ct" style="font-size:13px">Usuários (${(orgUsers || []).length})</div>
      <button class="btn-primary" id="inviteUserBtn" style="padding:6px 14px;font-size:12px">+ Convidar usuário</button>
    </div>
    <table class="saldo-table" style="margin-bottom:18px">
      <thead><tr><th style="text-align:left">Nome</th><th style="text-align:left">E-mail</th><th>Perfil</th><th style="text-align:left">Permissões</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${(orgUsers || []).length === 0
          ? `<tr><td colspan="6" style="text-align:center;color:var(--ink2);padding:14px">Nenhum usuário ainda</td></tr>`
          : (orgUsers || []).map((u) => `
          <tr>
            <td style="text-align:left">${escapeHtml(u.name || "—")}</td>
            <td style="text-align:left;color:var(--ink2)">${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.role)}</td>
            <td style="text-align:left;font-size:11px;color:var(--ink2)">${(u.permissions || []).join(", ")}</td>
            <td>${!u._status
              ? '<span style="color:var(--muted)">—</span>'
              : u._status.email_confirmed_at
                ? '<span class="kpi-delta kd-up">Ativo</span>'
                : '<span class="kpi-delta kd-down">Pendente</span>'}</td>
            <td style="text-align:right">
              <button type="button" class="row-menu-btn" data-uid="${u.id}" title="Opções">···</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="ct" style="font-size:13px">Empresas · CNPJ (${companies.length})</div>
      <button class="btn-primary" id="addCompanyBtn" style="padding:6px 14px;font-size:12px">+ Cadastrar empresa</button>
    </div>
    <table class="saldo-table" style="margin-bottom:18px">
      <thead><tr><th style="text-align:left">Razão social</th><th style="text-align:left">CNPJ</th><th>Conexões</th><th>Situação</th><th></th></tr></thead>
      <tbody>
        ${companies.length === 0
          ? `<tr><td colspan="5" style="text-align:center;color:var(--ink2);padding:14px">Nenhuma empresa cadastrada. Sem empresa, a organização continua funcionando como hoje, numa visão só.</td></tr>`
          : companies.map((c) => `
          <tr>
            <td style="text-align:left">${escapeHtml(c.name)}</td>
            <td style="text-align:left;font-family:monospace;color:var(--ink2)">${escapeHtml(cnpjMask(c.cnpj))}</td>
            <td>${itemsByCompany.get(c.id) || 0}</td>
            <td>${c.is_active ? '<span class="kpi-delta kd-up">Ativa</span>' : '<span class="kpi-delta kd-down">Inativa</span>'}</td>
            <td style="text-align:right;white-space:nowrap">
              <button type="button" class="btn-secondary btn-edit-company" data-cid="${escapeHtml(c.id)}" style="padding:3px 10px;font-size:11px">Editar</button>
              <button type="button" class="btn-secondary btn-toggle-company" data-cid="${escapeHtml(c.id)}" data-active="${c.is_active}" style="padding:3px 10px;font-size:11px">${c.is_active ? "Inativar" : "Ativar"}</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>

    <div class="ct" style="font-size:13px;margin-bottom:8px">Conexões bancárias ativas (${activeItems.length})</div>
    <table class="saldo-table" style="margin-bottom:18px">
      <thead><tr><th style="text-align:left">Banco</th><th style="text-align:left">Titular detectado</th><th style="text-align:left">Empresa</th></tr></thead>
      <tbody>
        ${activeItems.length === 0
          ? `<tr><td colspan="3" style="text-align:center;color:var(--ink2);padding:14px">Nenhuma conexão ativa</td></tr>`
          : activeItems.map((item) => {
              const holder = holderByItem.get(item.pluggy_item_id);
              const holderCompany = holder ? companies.find((c) => cnpjDigits(c.cnpj) === holder) : null;
              // Vínculo que discorda do titular real da conta é quase sempre
              // engano de cadastro, e passaria despercebido sem um aviso.
              const divergente = holderCompany && item.company_id && item.company_id !== holderCompany.id;
              return `
          <tr>
            <td style="text-align:left">${escapeHtml(item.connector_name || "—")}</td>
            <td style="text-align:left;font-family:monospace;font-size:11px;color:var(--ink2)">${holder ? escapeHtml(cnpjMask(holder)) : "—"}</td>
            <td style="text-align:left">
              <select class="form-input company-assign" data-iid="${escapeHtml(item.id)}" style="padding:4px 8px;font-size:12px;min-width:190px">
                <option value="">— sem empresa —</option>
                ${companies.map((c) => `<option value="${escapeHtml(c.id)}" ${item.company_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
              </select>
              ${divergente ? `<div class="cs" style="color:#f0a93c;margin-top:4px">Não bate com o titular da conta</div>` : ""}
            </td>
          </tr>`;
            }).join("")}
      </tbody>
    </table>

    <div class="ct" style="font-size:13px;margin-bottom:8px">Integrações habilitadas</div>
    <table class="saldo-table" style="margin-bottom:18px">
      <tbody>
        ${(orgIntegrations || []).length === 0
          ? `<tr><td style="text-align:center;color:var(--ink2);padding:14px">Nenhuma integração toggleável para esta org</td></tr>`
          : (orgIntegrations || []).map((it) => `
          <tr>
            <td style="text-align:left">${escapeHtml(it.name)}</td>
            <td style="text-align:right">
              <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--ink2)">
                <input type="checkbox" class="integration-enabled-toggle" data-iid="${it.id}" ${it.enabled ? "checked" : ""} />
                Habilitada para esta organização
              </label>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div class="ct" style="font-size:13px">Conhecimento (${(orgKnowledge || []).length})</div>
      <button class="btn-primary" id="addKnowledgeBtn" style="padding:6px 14px;font-size:12px">+ Adicionar item</button>
    </div>
    <table class="saldo-table" style="margin-bottom:18px">
      <thead><tr><th style="text-align:left">Título</th><th style="text-align:left">Categoria</th><th style="text-align:left">Autor</th><th></th></tr></thead>
      <tbody>
        ${(orgKnowledge || []).length === 0
          ? `<tr><td colspan="4" style="text-align:center;color:var(--ink2);padding:14px">Nenhum item de conhecimento</td></tr>`
          : (orgKnowledge || []).map((k) => `
          <tr>
            <td style="text-align:left">${escapeHtml(k.title)}</td>
            <td style="text-align:left;color:var(--ink2)">${escapeHtml(k.category)}</td>
            <td style="text-align:left;color:var(--ink2);font-size:11px">${escapeHtml(k.created_by_name || "—")}</td>
            <td><button class="btn-delete-knowledge" data-kid="${k.id}" data-label="${escapeHtml(k.title)}" style="background:none;border:none;color:#e05252;cursor:pointer;font-size:12px;padding:2px 6px">Remover</button></td>
          </tr>`).join("")}
      </tbody>
    </table>

    <div class="ct" style="font-size:13px;margin-bottom:8px">Documentos (${(orgDocs || []).length})</div>
    <table class="saldo-table" style="margin-bottom:18px">
      <tbody>
        ${(orgDocs || []).length === 0
          ? `<tr><td colspan="3" style="text-align:center;color:var(--ink2);padding:14px">Nenhum documento</td></tr>`
          : (orgDocs || []).map((d) => `<tr><td style="text-align:left">${escapeHtml(d.name)}</td><td style="text-align:left;color:var(--ink2)">${escapeHtml(d.type)}</td><td>${docStatusLabel(d.status)}</td></tr>`).join("")}
      </tbody>
    </table>

    <div class="ct" style="font-size:13px;margin-bottom:8px">Execuções recentes (${(orgLogs || []).length})</div>
    <table class="saldo-table">
      <tbody>
        ${(orgLogs || []).length === 0
          ? `<tr><td colspan="3" style="text-align:center;color:var(--ink2);padding:14px">Nenhuma execução</td></tr>`
          : (orgLogs || []).map((l) => `<tr><td style="text-align:left">${new Date(l.created_at).toLocaleString("pt-BR")}</td><td style="text-align:left">${escapeHtml(l.action)}</td><td>${escapeHtml(l.status)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;

  document.getElementById("orgModalRoot").style.display = "flex";

  document.querySelectorAll(".integration-enabled-toggle").forEach((cb) => {
    cb.addEventListener("change", async () => {
      cb.disabled = true;
      const { error } = await supabaseClient
        .from("integrations")
        .update({ enabled: cb.checked })
        .eq("id", cb.dataset.iid);
      cb.disabled = false;
      if (error) {
        alert("Erro ao atualizar integração: " + error.message);
        cb.checked = !cb.checked;
      }
    });
  });

  document.getElementById("editOrgBtn").addEventListener("click", () => {
    openEditOrgModal(org);
  });

  document.getElementById("toggleOrgStatusBtn").addEventListener("click", async (e) => {
    const nextStatus = org.status === "inativa" ? "ativa" : "inativa";
    if (!confirm(`${nextStatus === "inativa" ? "Inativar" : "Ativar"} a organização "${org.name}"?`)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error } = await supabaseClient.from("organizations").update({ status: nextStatus }).eq("id", orgId);
    btn.disabled = false;
    if (error) { alert("Erro ao atualizar status: " + error.message); return; }
    const orgs = await loadOrgsWithStats();
    await paintAdminKpis(orgs);
    await paintOrgs(orgs);
    await openOrgDetail(orgId);
  });

  document.getElementById("deleteOrgBtn").addEventListener("click", () => {
    openDeleteOrgModal(org, orgId);
  });

  document.getElementById("inviteUserBtn").addEventListener("click", () => {
    openInviteModal(orgId, org.name);
  });

  document.getElementById("addKnowledgeBtn").addEventListener("click", () => {
    openAddKnowledgeModal(orgId);
  });

  document.getElementById("addCompanyBtn").addEventListener("click", () => {
    openCompanyModal(orgId, null);
  });

  document.querySelectorAll(".btn-edit-company").forEach((btn) => {
    btn.addEventListener("click", () => {
      const company = companies.find((c) => c.id === btn.dataset.cid);
      if (company) openCompanyModal(orgId, company);
    });
  });

  document.querySelectorAll(".btn-toggle-company").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextActive = btn.dataset.active !== "true";
      btn.disabled = true;
      const { error } = await supabaseClient
        .from("companies")
        .update({ is_active: nextActive })
        .eq("id", btn.dataset.cid);
      if (error) {
        alert("Erro ao atualizar empresa: " + error.message);
        btn.disabled = false;
        return;
      }
      await openOrgDetail(orgId);
    });
  });

  document.querySelectorAll(".company-assign").forEach((select) => {
    // O valor anterior fica guardado para poder ser restaurado: um select que
    // some com a escolha do usuário depois de um erro é pior do que o erro.
    const previous = select.value;
    select.addEventListener("change", async () => {
      select.disabled = true;
      const { error } = await supabaseClient
        .from("pluggy_items")
        .update({ company_id: select.value || null })
        .eq("id", select.dataset.iid);
      select.disabled = false;
      if (error) {
        alert("Erro ao vincular a conexão: " + error.message);
        select.value = previous;
        return;
      }
      await openOrgDetail(orgId);
    });
  });

  document.querySelectorAll(".btn-delete-knowledge").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kid = btn.dataset.kid;
      const label = btn.dataset.label;
      if (!confirm(`Remover o item "${label}"?`)) return;
      btn.disabled = true;
      btn.textContent = "Removendo...";
      const { error } = await supabaseClient.from("knowledge_items").delete().eq("id", kid);
      if (error) {
        alert("Erro ao remover item: " + error.message);
        btn.disabled = false;
        btn.textContent = "Remover";
        return;
      }
      await openOrgDetail(orgId);
    });
  });
}

let _currentEditOrgId = null;

async function openEditOrgModal(org) {
  _currentEditOrgId = org.id;
  document.getElementById("editOrgName").value = org.name;
  document.getElementById("editOrgPlan").value = org.plan;
  document.getElementById("editOrgStatus").value = org.status;
  document.getElementById("editOrgTokenLimit").value = org.token_limit_monthly ?? "";
  document.getElementById("editOrgError").textContent = "";
  document.getElementById("editOrgModalRoot").style.display = "flex";

  // O modo de cobrança mora em org_subscriptions, não em organizations: é
  // decisão de faturamento, não cadastro da organização. A modal abre antes
  // desta consulta de propósito — segurar a abertura por causa de um seletor
  // faria a tela parecer travada numa rede ruim.
  const { data: subscription } = await supabaseClient
    .from("org_subscriptions")
    .select("billing_mode")
    .eq("org_id", org.id)
    .maybeSingle();

  // Só preenche se a modal ainda for a mesma: entre a abertura e a resposta o
  // admin pode ter fechado e aberto outra organização.
  if (_currentEditOrgId === org.id) {
    document.getElementById("editOrgBillingMode").value = subscription?.billing_mode || "portal";
  }
}

let _deleteOrgTarget = null;

// Typed-name confirmation rather than a plain confirm() dialog — this
// deletes every row the org owns across every table (all cascade from
// organizations, see delete-organization's own comment), so a single
// accidental click on the wrong row is not an acceptable failure mode.
function openDeleteOrgModal(org, orgId) {
  _deleteOrgTarget = { id: orgId, name: org.name };
  document.getElementById("deleteOrgWarning").textContent =
    `Isso apaga "${org.name}" e todos os dados vinculados a ela — usuários, transações, documentos, regras de clusterização, tudo. Não pode ser desfeito.`;
  document.getElementById("deleteOrgNameTarget").textContent = org.name;
  document.getElementById("deleteOrgConfirmInput").value = "";
  document.getElementById("deleteOrgSubmit").disabled = true;
  document.getElementById("deleteOrgError").textContent = "";
  document.getElementById("deleteOrgModalRoot").style.display = "flex";
}

let _currentEditUserId = null;
let _currentEditUserOrgId = null;

// ── Links de acesso (same two-state panel as Settings > Usuários) ──────────
// Backed by the same user-access-links edge function — it already accepts
// is_profix_admin as an alternative to org-Admin, so no backend change was
// needed to reuse it here.
function openUserAccessLinksModal(u) {
  const isConfirmed = !!u._status?.email_confirmed_at;
  document.getElementById("userAccessLinksTitle").textContent = `Links de acesso — ${u.name || u.email}`;
  document.getElementById("userAccessLinksError").textContent = "";

  const body = document.getElementById("userAccessLinksBody");
  body.innerHTML = isConfirmed
    ? `
      <p class="cs" style="margin-bottom:14px">Este usuário já confirmou o e-mail. Escolha como reenviar o acesso via redefinição de senha.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button id="ualSendReset" class="btn-secondary" style="text-align:left;padding:10px 14px">Enviar e-mail de redefinição de senha</button>
        <button id="ualCopyReset" class="btn-secondary" style="text-align:left;padding:10px 14px">Copiar link de redefinição de senha</button>
      </div>
    `
    : `
      <p class="cs" style="margin-bottom:14px">Este usuário ainda não confirmou o e-mail de acesso.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button id="ualSendConfirm" class="btn-secondary" style="text-align:left;padding:10px 14px">Enviar link de confirmação</button>
        <button id="ualCopyConfirm" class="btn-secondary" style="text-align:left;padding:10px 14px">Copiar link de confirmação</button>
      </div>
    `;

  const wire = (id, action, { copy } = {}) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const originalLabel = btn.textContent;
    btn.addEventListener("click", async () => {
      const errEl = document.getElementById("userAccessLinksError");
      errEl.textContent = "";
      btn.disabled = true;
      btn.textContent = copy ? "Gerando link…" : "Enviando…";
      try {
        const { data, error } = await supabaseClient.functions.invoke("user-access-links", {
          body: { action, user_id: u.id },
        });
        if (error || data?.error) {
          let errMsg = data?.error || "Erro ao processar a solicitação.";
          if (error?.context && typeof error.context.json === "function") {
            try { const b = await error.context.json(); if (b?.error) errMsg = b.error; } catch (_) { }
          } else if (error) {
            errMsg = error.message || errMsg;
          }
          errEl.textContent = errMsg;
          return;
        }
        if (copy) {
          // safe_link só gasta o token no clique da pessoa; o link antigo é
          // gasto pela pré-visualização do WhatsApp. O fallback cobre a janela
          // em que este arquivo já está no ar e a Edge Function ainda não.
          await navigator.clipboard.writeText(data.safe_link || data.link);
          btn.textContent = "Link copiado!";
        } else {
          btn.textContent = "E-mail enviado!";
        }
        setTimeout(() => { btn.textContent = originalLabel; btn.disabled = false; }, 2500);
        return;
      } catch (err) {
        errEl.textContent = "Erro: " + (err.message || String(err));
      }
      btn.disabled = false;
      btn.textContent = originalLabel;
    });
  };

  wire("ualSendReset", "send_password_reset");
  wire("ualCopyReset", "copy_password_reset_link", { copy: true });
  wire("ualSendConfirm", "resend_confirmation");
  wire("ualCopyConfirm", "copy_confirmation_link", { copy: true });

  document.getElementById("userAccessLinksModalRoot").style.display = "flex";
}

// ── Row action menu ("···") for the org-detail Usuários table — Login como /
// Editar / Links de acesso / Excluir used to be four separate inline
// buttons per row. Wired once here (not inside openOrgDetail, which reruns
// on every org click and would stack a fresh document-level listener each
// time) — reads _orgDetailUsers/_orgDetailOrgId, both refreshed on every
// openOrgDetail call, same pattern as Settings > Usuários' row menu.
function initUserRowMenu() {
  let _menuUser = null;
  const rowMenu = document.getElementById("userRowMenu");

  document.getElementById("userMenuLogin").addEventListener("click", async () => {
    rowMenu.style.display = "none";
    if (!_menuUser) return;
    const uid = _menuUser.id;
    const label = _menuUser.name || _menuUser.email;
    // Supabase persists the session to localStorage, which is shared by
    // every tab of the same browser/origin — opening the link in a normal
    // new tab of THIS browser would overwrite the admin's own backoffice
    // session. Using a private/incognito window keeps its localStorage
    // isolated, so the two sessions don't collide.
    if (!confirm(`Entrar na plataforma como "${label}"?\n\nO link será copiado para a área de transferência — cole-o em uma janela anônima/privada do navegador para não substituir sua sessão de admin atual.`)) return;
    const { data, error } = await supabaseClient.functions.invoke("impersonate-user", {
      body: { user_id: uid },
    });
    if (error || data?.error || !data?.action_link) {
      alert(data?.error || error?.message || "Erro ao gerar acesso como esse usuário.");
      return;
    }
    try {
      await navigator.clipboard.writeText(data.action_link);
      alert("Link copiado! Abra uma janela anônima/privada e cole o link para entrar como " + label + ".");
    } catch {
      window.open(data.action_link, "_blank");
    }
  });

  document.getElementById("userMenuEdit").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuUser) {
      openEditUserModal(
        { id: _menuUser.id, role: _menuUser.role, permissions: _menuUser.permissions, name: _menuUser.name || _menuUser.email },
        _orgDetailOrgId
      );
    }
  });

  document.getElementById("userMenuLinks").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuUser) openUserAccessLinksModal(_menuUser);
  });

  document.getElementById("userMenuDelete").addEventListener("click", async () => {
    rowMenu.style.display = "none";
    if (!_menuUser) return;
    const uid = _menuUser.id;
    const label = _menuUser.name || _menuUser.email;
    if (!confirm(`Excluir o usuário "${label}"? Esta ação não pode ser desfeita.`)) return;
    const { data, error } = await supabaseClient.functions.invoke("delete-user", {
      body: { user_id: uid },
    });
    if (error || data?.error) {
      alert(data?.error || error?.message || "Erro ao excluir usuário.");
      return;
    }
    await openOrgDetail(_orgDetailOrgId);
  });

  document.addEventListener("click", (e) => {
    const menuBtn = e.target.closest(".row-menu-btn");
    const insideMenu = e.target.closest("#userRowMenu");

    if (!insideMenu && !menuBtn) rowMenu.style.display = "none";
    if (!menuBtn) return;

    _menuUser = _orgDetailUsers.find((x) => x.id === menuBtn.dataset.uid) || null;
    document.getElementById("userMenuLinks").style.display = _menuUser?._status ? "" : "none";

    const rect = menuBtn.getBoundingClientRect();
    const mw = 176;
    rowMenu.style.left = Math.min(rect.right - mw, window.innerWidth - mw - 8) + "px";
    rowMenu.style.top = (rect.bottom + 4) + "px";
    rowMenu.style.display = rowMenu.style.display === "block" ? "none" : "block";
  });
}

function openEditUserModal(u, orgId) {
  _currentEditUserId = u.id;
  _currentEditUserOrgId = orgId;
  document.getElementById("editUserModalTitle").textContent = `Editar: ${u.name || "usuário"}`;
  document.getElementById("editUserRole").value = u.role;
  document.getElementById("editUserPermsGrid").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = (u.permissions || []).includes(cb.value);
  });
  document.getElementById("editUserError").textContent = "";
  document.getElementById("editUserModalRoot").style.display = "flex";
}

let _currentKnowledgeOrgId = null;

function openAddKnowledgeModal(orgId) {
  _currentKnowledgeOrgId = orgId;
  document.getElementById("addKnowledgeTitle").value = "";
  document.getElementById("addKnowledgeCategory").value = "Treinamento";
  document.getElementById("addKnowledgeBody").value = "";
  document.getElementById("addKnowledgeError").textContent = "";
  document.getElementById("addKnowledgeModalRoot").style.display = "flex";
}

let _companyModalOrgId = null;
let _companyModalCompanyId = null;

function openCompanyModal(orgId, company) {
  _companyModalOrgId = orgId;
  _companyModalCompanyId = company ? company.id : null;

  document.getElementById("companyModalTitle").textContent =
    company ? "Editar empresa" : "Cadastrar empresa";
  document.getElementById("companyName").value = company ? company.name : "";
  document.getElementById("companyCnpj").value = company ? cnpjMask(company.cnpj) : "";
  document.getElementById("companyError").textContent = "";

  // O CNPJ identifica a empresa e é o que liga conexão e balancete a ela.
  // Trocá-lo depois do vínculo feito reaponta dados silenciosamente, então
  // numa edição ele fica travado — para trocar, cadastre outra empresa.
  const cnpjInput = document.getElementById("companyCnpj");
  cnpjInput.readOnly = !!company;
  document.getElementById("companyCnpjHint").textContent = company
    ? "O CNPJ não muda depois do cadastro. Para outro CNPJ, cadastre outra empresa."
    : "Só a ProFix cadastra CNPJ. O cliente escolhe entre os já cadastrados.";

  document.getElementById("companyModalRoot").style.display = "flex";
}

let _currentInviteOrgId = null;

function openInviteModal(orgId, orgName) {
  _currentInviteOrgId = orgId;
  document.getElementById("inviteModalTitle").textContent = `Convidar para ${orgName}`;
  document.getElementById("inviteEmail").value = "";
  document.getElementById("inviteName").value = "";
  document.getElementById("inviteRole").value = "Visualizador";
  document.getElementById("inviteError").textContent = "";
  document.getElementById("inviteSuccess").style.display = "none";
  const invitePerms = ROLE_PERMISSIONS["Visualizador"] || [];
  document.getElementById("inviteForm").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = invitePerms.includes(cb.value);
  });
  document.getElementById("inviteModalRoot").style.display = "flex";
}

(async function init() {
  const session = await requireAdminSession();
  if (!session) return;
  document.getElementById("adminEmailDisplay").textContent = `Bem-vindo(a), ${session.name || session.email}`;
  document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "admin-login.html";
  });
  document.getElementById("orgModalClose").addEventListener("click", () => {
    document.getElementById("orgModalRoot").style.display = "none";
  });
  document.getElementById("inviteModalClose").addEventListener("click", () => {
    document.getElementById("inviteModalRoot").style.display = "none";
  });

  document.getElementById("companyModalClose").addEventListener("click", () => {
    document.getElementById("companyModalRoot").style.display = "none";
  });

  document.getElementById("companyCnpj").addEventListener("blur", (e) => {
    const masked = cnpjMask(e.target.value);
    if (masked !== e.target.value) e.target.value = masked;
  });

  document.getElementById("companyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("companyError");
    const submitBtn = document.getElementById("companySubmit");
    errorEl.textContent = "";

    const name = document.getElementById("companyName").value.trim();
    if (!name) {
      errorEl.textContent = "Informe a razão social.";
      return;
    }

    const cnpj = cnpjDigits(document.getElementById("companyCnpj").value);
    if (!_companyModalCompanyId) {
      if (cnpj.length !== 14) {
        errorEl.textContent = "O CNPJ precisa ter 14 dígitos.";
        return;
      }
      if (!cnpjHasValidCheckDigits(cnpj)) {
        errorEl.textContent = "CNPJ inválido: o dígito verificador não confere.";
        return;
      }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";

    const { error } = _companyModalCompanyId
      ? await supabaseClient.from("companies").update({ name }).eq("id", _companyModalCompanyId)
      : await supabaseClient.from("companies").insert({ org_id: _companyModalOrgId, name, cnpj });

    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar empresa";

    if (error) {
      // A mensagem do Postgres não serve para o usuário; traduzir as duas que
      // realmente acontecem e deixar o resto passar como está.
      errorEl.textContent = /companies_cnpj_unico/.test(error.message)
        ? "Já existe uma empresa com esse CNPJ nesta organização."
        : /companies_cnpj_valido|companies_cnpj_digitos/.test(error.message)
          ? "CNPJ inválido."
          : "Erro ao salvar empresa: " + error.message;
      return;
    }

    document.getElementById("companyModalRoot").style.display = "none";
    await openOrgDetail(_companyModalOrgId);
  });
  document.getElementById("inviteRole").addEventListener("change", (e) => {
    const perms = ROLE_PERMISSIONS[e.target.value] || [];
    document.getElementById("invitePermsGrid").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = perms.includes(cb.value);
    });
  });

  // ── Apagar organização ────────────────────────────────────────────────────
  document.getElementById("deleteOrgModalClose").addEventListener("click", () => {
    document.getElementById("deleteOrgModalRoot").style.display = "none";
  });
  document.getElementById("deleteOrgConfirmInput").addEventListener("input", (e) => {
    document.getElementById("deleteOrgSubmit").disabled = e.target.value !== (_deleteOrgTarget?.name || "");
  });
  document.getElementById("deleteOrgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!_deleteOrgTarget) return;
    const errorEl = document.getElementById("deleteOrgError");
    const submitBtn = document.getElementById("deleteOrgSubmit");
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Apagando...";
    const { data, error } = await supabaseClient.functions.invoke("delete-organization", {
      body: { org_id: _deleteOrgTarget.id, org_name: _deleteOrgTarget.name },
    });
    if (error || data?.error) {
      errorEl.textContent = data?.error || error?.message || "Erro ao apagar organização.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Apagar definitivamente";
      return;
    }
    document.getElementById("deleteOrgModalRoot").style.display = "none";
    document.getElementById("orgModalRoot").style.display = "none";
    _deleteOrgTarget = null;
    const orgs = await loadOrgsWithStats();
    await paintAdminKpis(orgs);
    await paintOrgs(orgs);
  });

  // ── Editar organização ────────────────────────────────────────────────────
  document.getElementById("editOrgModalClose").addEventListener("click", () => {
    document.getElementById("editOrgModalRoot").style.display = "none";
  });
  document.getElementById("editOrgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("editOrgName").value.trim();
    const plan = document.getElementById("editOrgPlan").value;
    const status = document.getElementById("editOrgStatus").value;
    const tokenLimitRaw = document.getElementById("editOrgTokenLimit").value.trim();
    const token_limit_monthly = tokenLimitRaw === "" ? null : parseInt(tokenLimitRaw, 10);
    const errorEl = document.getElementById("editOrgError");
    const submitBtn = document.getElementById("editOrgSubmit");
    errorEl.textContent = "";
    if (!name) { errorEl.textContent = "Informe o nome da organização."; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";
    const { error } = await supabaseClient.from("organizations").update({ name, plan, status, token_limit_monthly }).eq("id", _currentEditOrgId);

    // Duas tabelas, dois updates: o modo de cobrança é a única coluna de
    // org_subscriptions que um admin pode escrever (20260925090000). O status
    // continua sendo do webhook do Asaas, e nada aqui o toca.
    const billingMode = document.getElementById("editOrgBillingMode").value;
    const { error: billingError } = error
      ? { error: null }
      : await supabaseClient
          .from("org_subscriptions")
          .update({ billing_mode: billingMode })
          .eq("org_id", _currentEditOrgId);

    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar";
    if (error) { errorEl.textContent = "Erro: " + error.message; return; }
    if (billingError) { errorEl.textContent = "Organização salva, mas a cobrança não: " + billingError.message; return; }
    document.getElementById("editOrgModalRoot").style.display = "none";
    const orgs = await loadOrgsWithStats();
    await paintAdminKpis(orgs);
    await paintOrgs(orgs);
    await paintTokenConsumption(orgs, document.getElementById("tokenMonthPicker").value || currentMonthStr());
    await openOrgDetail(_currentEditOrgId);
  });

  document.getElementById("userAccessLinksClose")?.addEventListener("click", () => {
    document.getElementById("userAccessLinksModalRoot").style.display = "none";
  });
  initUserRowMenu();

  // ── Editar usuário (backoffice) ───────────────────────────────────────────
  document.getElementById("editUserModalClose").addEventListener("click", () => {
    document.getElementById("editUserModalRoot").style.display = "none";
  });
  document.getElementById("editUserRole").addEventListener("change", (e) => {
    const perms = ROLE_PERMISSIONS[e.target.value] || [];
    document.getElementById("editUserPermsGrid").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = perms.includes(cb.value);
    });
  });
  document.getElementById("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = document.getElementById("editUserRole").value;
    const permissions = Array.from(
      document.getElementById("editUserPermsGrid").querySelectorAll('input[type="checkbox"]:checked')
    ).map((cb) => cb.value);
    const errorEl = document.getElementById("editUserError");
    const submitBtn = document.getElementById("editUserSubmit");
    errorEl.textContent = "";
    if (permissions.length === 0) { errorEl.textContent = "Selecione ao menos uma permissão."; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";
    const { error } = await supabaseClient
      .from("profiles")
      .update({ role, permissions })
      .eq("id", _currentEditUserId);
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar alterações";
    if (error) { errorEl.textContent = "Erro: " + error.message; return; }
    document.getElementById("editUserModalRoot").style.display = "none";
    await openOrgDetail(_currentEditUserOrgId);
  });

  // ── Agentes por tipo de documento ────────────────────────────────────────
  document.getElementById("agentModalClose").addEventListener("click", () => {
    document.getElementById("agentModalRoot").style.display = "none";
  });
  document.getElementById("agentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const docType   = document.getElementById("agentDocType").value;
    const label     = document.getElementById("agentLabel").value.trim();
    const model     = document.getElementById("agentModel").value;
    const maxTokens = parseInt(document.getElementById("agentMaxTokens").value, 10);
    const format    = document.getElementById("agentResponseFormat").value;
    const prompt    = document.getElementById("agentPrompt").value.trim();
    const errorEl   = document.getElementById("agentError");
    const successEl = document.getElementById("agentSuccess");
    const submitBtn = document.getElementById("agentSubmit");
    errorEl.textContent = "";
    successEl.style.display = "none";
    if (!label || !prompt) { errorEl.textContent = "Preencha nome e prompt."; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";
    const { error } = await supabaseClient
      .from("document_type_agents")
      .update({
        agent_label: label,
        model,
        max_tokens: maxTokens,
        response_format: format,
        prompt_system: prompt,
        updated_at: new Date().toISOString(),
        updated_by: session.email,
      })
      .eq("doc_type", docType);
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar configuração";
    if (error) { errorEl.textContent = "Erro: " + error.message; return; }
    successEl.textContent = "Configuração salva!";
    successEl.style.display = "";
    await paintAgents();
  });

  // ── Nova Organização ──────────────────────────────────────────────────────
  document.getElementById("newOrgBtn").addEventListener("click", () => {
    document.getElementById("newOrgName").value = "";
    document.getElementById("newOrgPlan").value = "essencial";
    document.getElementById("newOrgStatus").value = "trial";
    document.getElementById("newOrgTokenLimit").value = "";
    document.getElementById("newOrgError").textContent = "";
    document.getElementById("newOrgModalRoot").style.display = "flex";
  });
  document.getElementById("newOrgModalClose").addEventListener("click", () => {
    document.getElementById("newOrgModalRoot").style.display = "none";
  });
  document.getElementById("newOrgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newOrgName").value.trim();
    const plan = document.getElementById("newOrgPlan").value;
    const status = document.getElementById("newOrgStatus").value;
    const tokenLimitRaw = document.getElementById("newOrgTokenLimit").value.trim();
    const token_limit_monthly = tokenLimitRaw === "" ? null : parseInt(tokenLimitRaw, 10);
    const errorEl = document.getElementById("newOrgError");
    const submitBtn = document.getElementById("newOrgSubmit");
    errorEl.textContent = "";
    if (!name) { errorEl.textContent = "Informe o nome da organização."; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Criando...";
    const { error } = await supabaseClient.from("organizations").insert({ name, plan, status, token_limit_monthly });
    submitBtn.disabled = false;
    submitBtn.textContent = "Criar organização";
    if (error) {
      errorEl.textContent = "Erro ao criar: " + error.message;
      return;
    }
    document.getElementById("newOrgModalRoot").style.display = "none";
    const orgs = await loadOrgsWithStats();
    await paintAdminKpis(orgs);
    await paintOrgs(orgs);
    await paintTokenConsumption(orgs, document.getElementById("tokenMonthPicker").value || currentMonthStr());
  });

  // ── Adicionar conhecimento (opened from org detail) ───────────────────────
  document.getElementById("addKnowledgeModalClose").addEventListener("click", () => {
    document.getElementById("addKnowledgeModalRoot").style.display = "none";
  });
  document.getElementById("addKnowledgeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("addKnowledgeTitle").value.trim();
    const category = document.getElementById("addKnowledgeCategory").value;
    const body = document.getElementById("addKnowledgeBody").value.trim();
    const errorEl = document.getElementById("addKnowledgeError");
    const submitBtn = document.getElementById("addKnowledgeSubmit");
    errorEl.textContent = "";
    if (!title || !body) { errorEl.textContent = "Preencha título e conteúdo."; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Salvando...";
    const { error } = await supabaseClient.from("knowledge_items").insert({
      org_id: _currentKnowledgeOrgId,
      title,
      category,
      body,
      created_by_name: session.name || session.email,
    });
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar item";
    if (error) {
      errorEl.textContent = "Erro ao salvar: " + error.message;
      return;
    }
    document.getElementById("addKnowledgeModalRoot").style.display = "none";
    await openOrgDetail(_currentKnowledgeOrgId);
  });

  document.getElementById("inviteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("inviteEmail").value.trim();
    const name  = document.getElementById("inviteName").value.trim();
    const role  = document.getElementById("inviteRole").value;
    const permissions = Array.from(
      document.getElementById("inviteForm").querySelectorAll('input[type="checkbox"]:checked')
    ).map((cb) => cb.value);
    const errorEl   = document.getElementById("inviteError");
    const successEl = document.getElementById("inviteSuccess");
    const submitBtn = document.getElementById("inviteSubmit");
    errorEl.textContent = "";
    successEl.style.display = "none";

    if (!email) { errorEl.textContent = "Informe o e-mail."; return; }
    if (permissions.length === 0) { errorEl.textContent = "Selecione ao menos uma permissão."; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    const { data, error } = await supabaseClient.functions.invoke("invite-user", {
      body: { email, name, role, permissions, org_id: _currentInviteOrgId },
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Enviar convite";

    if (error || data?.error) {
      let errMsg = data?.error || "Erro ao enviar convite.";
      if (error) {
        if (error.context && typeof error.context.json === "function") {
          try { const b = await error.context.json(); if (b?.error) errMsg = b.error; } catch (_) {}
        } else {
          errMsg = error.message || errMsg;
        }
      }
      errorEl.textContent = errMsg;
      return;
    }

    successEl.textContent = `Convite enviado para ${email}!`;
    successEl.style.display = "";
    document.getElementById("inviteEmail").value = "";
    document.getElementById("inviteName").value = "";
  });

  const orgs = await loadOrgsWithStats();
  await paintAdminKpis(orgs);
  await paintOrgs(orgs);
  await paintAgents();
  await paintLogs(orgs);

  const monthPicker = document.getElementById("tokenMonthPicker");
  monthPicker.value = currentMonthStr();
  await paintTokenConsumption(orgs, monthPicker.value);
  monthPicker.addEventListener("change", () => {
    paintTokenConsumption(orgs, monthPicker.value || currentMonthStr());
  });

  // ── Logs filters (org selection from the token table + date range) ────────
  const dateFromInput = document.getElementById("logsDateFrom");
  const dateToInput   = document.getElementById("logsDateTo");
  const clearFilterBtn = document.getElementById("logsClearFilter");

  dateFromInput.addEventListener("change", () => {
    _logsDateFrom = dateFromInput.value || null;
    refreshLogsWithFilters(orgs);
  });
  dateToInput.addEventListener("change", () => {
    _logsDateTo = dateToInput.value || null;
    refreshLogsWithFilters(orgs);
  });
  clearFilterBtn.addEventListener("click", () => {
    _selectedOrgId = null;
    _logsDateFrom = null;
    _logsDateTo = null;
    dateFromInput.value = "";
    dateToInput.value = "";
    paintTokenConsumption(orgs, monthPicker.value || currentMonthStr());
    refreshLogsWithFilters(orgs);
  });
})();
