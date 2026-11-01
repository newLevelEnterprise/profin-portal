const OF_CASHFLOW_TYPES = {
  FCO: {
    label: "Operacional (FCO)",
    shortLabel: "FCO",
    color: "#2dd4a0",
  },
  FCI: {
    label: "Investimento (FCI)",
    shortLabel: "FCI",
    color: "#f0a93c",
  },
  FCF: {
    label: "Financiamento (FCF)",
    shortLabel: "FCF",
    color: "#9b86fb",
  },
  IGNORAR: {
    label: "Ignorada",
    shortLabel: "Ignorar",
    color: "#828798",
  },
};

function ofFormatCurrency(value, currencyCode = "BRL", compact = false) {
  const number = Number(value || 0);
  const abs = Math.abs(number);

  if (compact) {
    const sign = number < 0 ? "−" : "";
    return `${sign}R$ ${Math.round(abs).toLocaleString("pt-BR")}`;
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode || "BRL",
  }).format(number);
}

function ofFormatSignedCurrency(value, currencyCode = "BRL", compact = false) {
  const number = Number(value || 0);
  const sign = number >= 0 ? "+" : "−";

  return `${sign}${ofFormatCurrency(Math.abs(number), currencyCode, compact)}`;
}

function ofFormatDate(value) {
  if (!value) return "—";

  const [year, month, day] = String(value).split("-");

  if (!year || !month || !day) {
    return String(value);
  }

  return `${day}/${month}/${year}`;
}

function ofFormatMonthLabel(yearMonth) {
  const [year, month] = String(yearMonth).split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);

  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "2-digit",
  }).format(date);

  return label.replace(".", "");
}

function ofEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ofClassValue(value) {
  const number = Number(value || 0);

  if (number > 0) return "kv-pos";
  if (number < 0) return "kv-neg";

  return "kv-neu";
}

// The selected period used to live in two <input type="date"> fields, which
// made the DOM its source of truth. The free-date pickers are gone — the
// filter is preset ranges only now — so the range lives here instead.
// Seeded with the current month so any paint that runs before
// ofSetupDateFilters still has a valid window rather than an unfiltered one.
const _ofDefaultRange = (() => {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: ofToDateInputValue(first), to: ofToDateInputValue(last) };
})();
let _ofDateRange = { ..._ofDefaultRange };

function ofGetDateRange() {
  return { from: _ofDateRange.from, to: _ofDateRange.to };
}

function ofSetDateRange(from, to) {
  _ofDateRange = { from: from || null, to: to || null };

  ofUpdatePeriodSub();
}

function ofToDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function ofStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function ofEndOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function ofStartOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);

  return copy;
}

function ofEndOfWeek(date) {
  const start = ofStartOfWeek(date);
  const end = new Date(start);

  end.setDate(start.getDate() + 6);
  return end;
}

function ofAddDays(date, days) {
  const copy = new Date(date);

  copy.setDate(copy.getDate() + days);
  return copy;
}

function ofAddMonths(date, months) {
  const copy = new Date(date.getFullYear(), date.getMonth(), 1);

  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function ofParseDateInput(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function ofGetMonthKey(dateString) {
  if (!dateString) return null;

  return String(dateString).slice(0, 7);
}

function ofMonthKeysBetween(from, to) {
  const start = from ? new Date(`${from}T00:00:00`) : ofAddMonths(new Date(), -11);
  const end = to ? new Date(`${to}T00:00:00`) : new Date();

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const limit = new Date(end.getFullYear(), end.getMonth(), 1);
  const months = [];

  while (cursor <= limit) {
    months.push(ofToDateInputValue(cursor).slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

// A week key is the Monday that starts its week, as a "YYYY-MM-DD" string —
// unlike a month key ("YYYY-MM"), week keys are full dates, so callers that
// branch on granularity can't assume a fixed key length/shape.
function ofGetWeekKey(dateString) {
  if (!dateString) return null;

  const date = ofParseDateInput(String(dateString).slice(0, 10));
  if (!date || Number.isNaN(date.getTime())) return null;

  return ofToDateInputValue(ofStartOfWeek(date));
}

function ofWeekKeysBetween(from, to) {
  const start = from ? ofStartOfWeek(new Date(`${from}T00:00:00`)) : ofStartOfWeek(ofAddDays(new Date(), -27));
  const end = to ? ofStartOfWeek(new Date(`${to}T00:00:00`)) : ofStartOfWeek(new Date());

  const cursor = new Date(start);
  const weeks = [];

  while (cursor <= end) {
    weeks.push(ofToDateInputValue(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}

// Chart granularity adapts to how wide the selected period is: a month or
// less (e.g. "Hoje", "Esta semana", "Este mês", or an early "Trimestre" that
// hasn't run past 31 days yet) reads better as weekly points — a single
// monthly bar for the whole selection looks broken/flat. Wider periods (YTD,
// 12 meses, a quarter once it's a few months in) keep monthly buckets.
function ofGetChartGranularity(from, to) {
  if (!from || !to) return "month";

  const days = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
  return days <= 31 ? "week" : "month";
}

function ofGetChartBuckets(from, to) {
  const granularity = ofGetChartGranularity(from, to);
  const keys = granularity === "week" ? ofWeekKeysBetween(from, to) : ofMonthKeysBetween(from, to);
  return { granularity, keys };
}

function ofGetBucketKeyForDate(dateString, granularity) {
  return granularity === "week" ? ofGetWeekKey(dateString) : ofGetMonthKey(dateString);
}

function ofFormatWeekLabel(weekKey) {
  const start = ofParseDateInput(weekKey);
  if (!start) return weekKey;

  const end = ofAddDays(start, 6);
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

  return `${fmt(start)}–${fmt(end)}`;
}

function ofFormatBucketLabel(key, granularity) {
  return granularity === "week" ? ofFormatWeekLabel(key) : ofFormatMonthLabel(key);
}

function ofApplyQuickRange(range) {
  const today = new Date();

  let from;
  let to;

  if (range === "hoje") {
    from = today;
    to = today;
  } else if (range === "semana") {
    from = ofStartOfWeek(today);
    to = ofEndOfWeek(today);
  } else if (range === "mes") {
    from = ofStartOfMonth(today);
    to = ofEndOfMonth(today);
  } else if (range === "mes-passado") {
    const lastMonth = ofAddMonths(today, -1);
    from = ofStartOfMonth(lastMonth);
    to = ofEndOfMonth(lastMonth);
  } else if (range === "trimestre") {
    // Rolling three months, matching how "12 meses" works rather than the
    // calendar quarter it used to mean. In the first month of a quarter the
    // calendar reading collapses to the current month — on 27 July it returned
    // 1–27 July, indistinguishable from "Este mês" — which makes the button
    // look broken exactly when someone reaches for a wider view.
    from = ofStartOfMonth(ofAddMonths(today, -2));
    to = today;
  } else if (range === "ytd") {
    from = new Date(today.getFullYear(), 0, 1);
    to = today;
  } else if (range === "12m") {
    from = ofStartOfMonth(ofAddMonths(today, -11));
    to = today;
  } else {
    return;
  }

  ofSetDateRange(ofToDateInputValue(from), ofToDateInputValue(to));
}

// `new Date("2026-07-01")` parses as UTC midnight, which in UTC-3 lands on
// the previous day — enough to silently shift a period by one day. Building
// the date from its parts keeps it local, matching how every other date in
// this file is constructed.
function ofParseDateInputValue(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

// Keeps the two inputs showing whatever range is actually in effect, so
// clicking a preset fills in its dates and the two controls never disagree
// about what is on screen.
//
// _ofDateRange holds "YYYY-MM-DD" strings — the same format <input type=date>
// uses, and the same format transaction rows carry — so the values go straight
// across with no conversion. Everything in this file compares dates as those
// strings; introducing Date objects into that range breaks the transaction
// filter silently, because comparing a string date against a Date coerces to
// NaN and quietly matches nothing.
function ofSyncDateInputsToRange() {
  const { from, to } = ofGetDateRange();
  const fromInput = document.getElementById("ofDateFrom");
  const toInput = document.getElementById("ofDateTo");

  if (fromInput) fromInput.value = from || "";
  if (toInput) toInput.value = to || "";
}

function ofUpdatePeriodSub() {
  const periodSub = document.getElementById("periodSub");
  const { from, to } = ofGetDateRange();

  if (!periodSub || !from || !to) return;

  periodSub.textContent = `Visão executiva · Período: ${ofFormatDate(from)} a ${ofFormatDate(to)}`;
}


function ofFormatRelativeSyncTime(value) {
  if (!value) return "Ainda não sincronizado";

  const date = new Date(value);
  const now = new Date();

  if (Number.isNaN(date.getTime())) {
    return "Sincronização sem data válida";
  }

  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 30) return "Sincronizado agora";
  if (diffSeconds < 60) return `Sincronizado há ${diffSeconds} segundos`;
  if (diffMinutes === 1) return "Sincronizado há 1 min";
  if (diffMinutes < 60) return `Sincronizado há ${diffMinutes} min`;
  if (diffHours === 1) return "Sincronizado há 1 hora";
  if (diffHours < 24) return `Sincronizado há ${diffHours} horas`;
  if (diffDays === 1) return "Sincronizado há 1 dia";

  return `Sincronizado há ${diffDays} dias`;
}

function ofGetNewestDate(...values) {
  const validDates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!validDates.length) return null;

  return new Date(Math.max(...validDates.map((date) => date.getTime()))).toISOString();
}

async function ofFetchLatestOpenFinanceSyncAt(session) {
  let latestSyncAt = null;

  try {
    const { data: pluggyItems, error: pluggyItemsError } = await supabaseClient
      .from("pluggy_items")
      .select("last_sync_at, updated_at, created_at")
      .eq("org_id", session.orgId)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (!pluggyItemsError && pluggyItems?.length) {
      for (const item of pluggyItems) {
        latestSyncAt = ofGetNewestDate(
          latestSyncAt,
          item.last_sync_at,
          item.updated_at,
          item.created_at
        );
      }
    }
  } catch (err) {
    console.warn("Não foi possível buscar última sincronização em pluggy_items:", err);
  }

  try {
    const { data: transactions, error: transactionsError } = await supabaseClient
      .from("pluggy_transactions")
      .select("updated_at")
      .eq("org_id", session.orgId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!transactionsError && transactions?.length) {
      latestSyncAt = ofGetNewestDate(latestSyncAt, transactions[0].updated_at);
    }
  } catch (err) {
    console.warn("Não foi possível buscar última sincronização em pluggy_transactions:", err);
  }

  try {
    const { data: accounts, error: accountsError } = await supabaseClient
      .from("pluggy_accounts")
      .select("updated_at")
      .eq("org_id", session.orgId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!accountsError && accounts?.length) {
      latestSyncAt = ofGetNewestDate(latestSyncAt, accounts[0].updated_at);
    }
  } catch (err) {
    console.warn("Não foi possível buscar última sincronização em pluggy_accounts:", err);
  }

  return latestSyncAt;
}

async function ofFetchLatestIntegrationSyncAt(session) {
  let latestSyncAt = null;

  try {
    const { data: runs, error } = await supabaseClient
      .from("integration_sync_runs")
      .select("finished_at, started_at, status")
      .eq("org_id", session.orgId)
      .in("status", ["success", "partial_success"])
      .order("finished_at", { ascending: false })
      .limit(1);

    if (!error && runs?.length) {
      latestSyncAt = ofGetNewestDate(runs[0].finished_at, runs[0].started_at);
    }
  } catch (err) {
    console.warn("Tabela integration_sync_runs indisponível ou sem permissão:", err);
  }

  return latestSyncAt;
}

async function ofUpdateDashboardSyncStatus(session) {
  const statusText = document.getElementById("dashboardSyncStatusText");
  const statusWrap = document.getElementById("dashboardSyncStatus");

  if (!statusText || !session?.orgId) return;

  try {
    statusText.textContent = "Verificando sincronização...";

    const [openFinanceSyncAt, integrationSyncAt] = await Promise.all([
      ofFetchLatestOpenFinanceSyncAt(session),
      ofFetchLatestIntegrationSyncAt(session),
    ]);

    const latestSyncAt = ofGetNewestDate(openFinanceSyncAt, integrationSyncAt);

    statusText.textContent = ofFormatRelativeSyncTime(latestSyncAt);
    statusText.title = latestSyncAt
      ? `Última sincronização: ${new Date(latestSyncAt).toLocaleString("pt-BR")}`
      : "Nenhuma sincronização encontrada";

    if (statusWrap) {
      statusWrap.title = statusText.title;
    }
  } catch (err) {
    console.warn("Erro ao atualizar status de sincronização:", err);
    statusText.textContent = "Status de sincronização indisponível";

    if (statusWrap) {
      statusWrap.title = "Não foi possível consultar a última sincronização";
    }
  }
}

function ofGetAccountId(account) {
  return account?.pluggy_account_id || account?.account_id || account?.id || null;
}

function ofGetTransactionAccountId(transaction) {
  return (
    transaction?.pluggy_account_id ||
    transaction?.account_id ||
    transaction?.accountId ||
    transaction?.raw?.accountId ||
    transaction?.raw_json?.accountId ||
    null
  );
}

function ofGetTransactionItemId(transaction) {
  return (
    transaction?.pluggy_item_id ||
    transaction?.item_id ||
    transaction?.itemId ||
    transaction?.raw?.itemId ||
    transaction?.raw_json?.itemId ||
    null
  );
}

function ofGetAccountLabel(account) {
  return (
    account?.marketing_name ||
    account?.name ||
    account?.subtype ||
    account?.type ||
    "Conta"
  );
}

// ── Que tipo de conta é, e o que entra no caixa ────────────────────────────
//
// Espelha src/domain/account-kinds.js, que é onde estas regras têm teste —
// inclusive o teste que garante que `ofIsCreditCardAccount` continua decidindo
// igual à regra do servidor. Os arquivos da raiz não fazem `import`.
//
// Até 04/10 toda soma de saldo aqui ignorava `type`/`subtype` e somava tudo,
// então a fatura em aberto do cartão entrava como caixa — e com o sinal
// trocado, porque a Pluggy devolve dívida de cartão como saldo positivo.

function ofNormalizeAccountText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function ofIsCreditCardAccount(account) {
  if (!account) return false;

  const type = ofNormalizeAccountText(account.type);
  const subtype = ofNormalizeAccountText(account.subtype);
  const name = ofNormalizeAccountText(
    `${account.name || ""} ${account.marketing_name || ""} ${account.number || ""}`
  );

  return (
    type.includes("credit") ||
    subtype.includes("credit") ||
    type.includes("cartao") ||
    subtype.includes("cartao") ||
    name.includes("cartao") ||
    name.includes("credito") ||
    name.includes("credit card")
  );
}

function ofFiniteBalance(value) {
  const parsed = Number(value);

  // Saldo ilegível vale zero: `NaN` contamina a soma e apaga o número inteiro
  // da tela, quando o estrago real é de uma linha.
  return Number.isFinite(parsed) ? parsed : 0;
}

// O caixa: corrente, poupança e o que não soubermos classificar. Cartão, não.
function ofCashBalance(accounts) {
  return (accounts || []).reduce(
    (sum, account) => (ofIsCreditCardAccount(account) ? sum : sum + ofFiniteBalance(account?.balance)),
    0
  );
}

function ofOpenInvoiceBalance(accounts) {
  return (accounts || []).reduce(
    (sum, account) => (ofIsCreditCardAccount(account) ? sum + ofFiniteBalance(account?.balance) : sum),
    0
  );
}

const OF_ACCOUNT_KIND_LABELS = [
  ["checking_account", "conta corrente", "contas correntes"],
  ["savings_account", "poupança", "poupanças"],
];

// "1 conta corrente, 2 poupanças" — o que separa poupança de corrente na tela,
// que antes aparecia só como "3 conta(s)".
function ofDescribeCashAccounts(accounts) {
  const counts = new Map();

  for (const account of accounts || []) {
    if (ofIsCreditCardAccount(account)) continue;
    const subtype = ofNormalizeAccountText(account?.subtype);
    const known = OF_ACCOUNT_KIND_LABELS.find(([value]) => value === subtype);
    const key = known ? known[0] : "other";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const order = [...OF_ACCOUNT_KIND_LABELS, ["other", "conta", "contas"]];
  const parts = order
    .filter(([key]) => counts.get(key))
    .map(([key, singular, plural]) => {
      const count = counts.get(key);
      return `${count} ${count === 1 ? singular : plural}`;
    });

  if (parts.length) return parts.join(", ");

  // Banco onde só o cartão foi importado continua na tabela — as compras dele
  // estão em Saídas —, mas não tem saldo. "0 contas" pareceria defeito.
  return (accounts || []).length ? "só cartão" : "";
}

function ofGetTransactionTypeLabel(transaction) {
  const amount = ofEffectiveAmount(transaction);

  if (transaction?.cashflow_ignore) return "Ignorada";
  if (amount > 0) return "Entrada";
  if (amount < 0) return "Saída";

  return transaction?.type || "Movimentação";
}

// ── Cash-flow classification: read-only on the client ───────────────────────
// The rules that decide whether a transaction counts as real movement —
// same-holder transfers, internal transfers between two imported accounts,
// and credit-card bill payments when the card is also imported — used to run
// here, in the browser, on every page load. They now run server-side on a
// schedule and are stored on the row.
//
// The single implementation lives in
// supabase/functions/_shared/cashflow-classification.ts. It is not duplicated
// here on purpose: two implementations of a rule that decides whether money
// counts would eventually disagree, and the same account would show different
// totals depending on which one produced them.
//
// Moving it also let this fetch drop the `raw` payload, which was roughly 90%
// of every row's bytes and was downloaded solely to evaluate these rules and
// derive the counterparty for display.

function ofNormalizeDocument(value) {
  return String(value || "").replace(/\D/g, "");
}

function ofGetTransactionOrigin(transaction) {
  return {
    name: transaction?.counterparty_name || null,
    document: transaction?.counterparty_document || null,
    documentType: transaction?.counterparty_document_type || null,
    method: transaction?.payment_method_label || null,
  };
}

// Payroll-batch transactions (the bank's own automated salary disbursement
// system) carry an individual employee's CPF in the counterparty fields —
// counterparty_name itself is typically empty for these, so the description
// is the only field that identifies the batch. Showing that CPF anywhere in
// the dashboard would expose a specific person's salary amount tied to their
// document, which nothing here has a legitimate reason to display. There's
// no separate flag on the row for this, so it's matched by the bank's own
// consistent description text rather than added at the data layer.
function ofIsSensitivePayrollTransaction(transaction) {
  return String(transaction?.description || "").toUpperCase().includes("SISPAG SALARIOS");
}

// Origem/Destino as HTML — shared by the main transactions table and the
// cluster drill-down's leaf-level table, so the masking above only has to be
// applied in one place instead of drifting between callers.
// Empresas da organização e a empresa de cada conexão, preenchidas quando os
// dados carregam. Ficam em estado de módulo porque ofRenderOriginCell é
// chamada por três tabelas diferentes e receber esse contexto por parâmetro
// significaria mudar três assinaturas para uma informação que não varia.
let _ofCompanyContext = { byCnpj: new Map(), companyByItem: new Map() };

/**
 * Onde está a contraparte em relação à organização.
 *
 * Espelha counterpartyScope de src/domain/intragroup.js, que é onde há teste.
 * É derivação em tempo de renderização: nenhum valor muda, nenhuma linha é
 * reclassificada — só o texto que o usuário lê.
 */
function ofCounterpartyScope(transaction) {
  const raw = transaction?.counterparty_document;
  if (raw === null || raw === undefined || String(raw).trim() === "") return "unknown";

  const document = ofNormalizeDocument(raw);
  // Documento que não é CNPJ — um CPF, por exemplo — é certeza de que não é
  // empresa da organização, não indefinição.
  if (document.length !== 14) return "external";

  const counterparty = _ofCompanyContext.byCnpj.get(document);
  if (!counterparty) return "external";

  const ownCompanyId = _ofCompanyContext.companyByItem.get(transaction?.pluggy_item_id);
  if (!ownCompanyId) return "group";

  return counterparty.id === ownCompanyId ? "same_company" : "intragroup";
}

function ofRenderIntragroupTag(transaction) {
  const scope = ofCounterpartyScope(transaction);
  if (scope === "intragroup") {
    return `<div class="intragroup-tag is-group" title="Transferência entre empresas do grupo — o dinheiro não saiu da organização">Entre empresas do grupo</div>`;
  }
  if (scope === "group") {
    return `<div class="intragroup-tag is-group" title="A contraparte é uma empresa da organização. Vincule a conexão a uma empresa para saber de que lado.">Dentro do grupo</div>`;
  }
  if (scope === "same_company") {
    return `<div class="intragroup-tag is-same" title="Transferência entre contas da mesma empresa">Mesma empresa</div>`;
  }
  return "";
}

function ofRenderOriginCell(transaction) {
  // A máscara de folha vem primeiro e continua vindo: a contraparte dessas
  // linhas é o CPF de um funcionário, e nada — nem o selo de grupo — pode
  // aparecer no lugar dela.
  if (ofIsSensitivePayrollTransaction(transaction)) {
    return `<span style="color:var(--muted)">Dado oculto</span>`;
  }
  const origin = ofGetTransactionOrigin(transaction);
  const tag = ofRenderIntragroupTag(transaction);

  if (!origin.name && !origin.document && !origin.method) {
    return tag || `<span style="color:var(--muted)">—</span>`;
  }
  return `
    ${origin.name ? `<div style="font-weight:600">${ofEscapeHtml(origin.name)}</div>` : ""}
    ${origin.document ? `<div style="color:var(--muted)">${ofEscapeHtml(origin.documentType || "Doc")}: ${ofEscapeHtml(origin.document)}</div>` : ""}
    ${origin.method ? `<div style="color:var(--muted)">${ofEscapeHtml(origin.method)}</div>` : ""}
    ${tag}
  `;
}

// Surfaces what the server computed, in the shape the rest of this file
// already expects, so every existing caller of ofEffectiveAmount /
// ofIsEffectiveTransaction keeps working unchanged.
//
// A row the server has not reached yet (cashflow_computed_at null) is treated
// as normal movement and flagged via cashflow_pending. That is the same answer
// the dashboard gave before any of this existed, and the banner driven by
// ofCountPendingCashflow makes the state visible rather than presenting
// possibly double-counted totals as final.
function ofClassifyTransactions(transactions, _accountsById) {
  return (transactions || []).map((transaction) => {
    const amount = Number(transaction.amount || 0);
    const ignored = transaction.cashflow_ignore === true;
    const type = transaction.cashflow_type || "FCO";

    return {
      ...transaction,
      cashflow_type: type,
      cashflow_label: (OF_CASHFLOW_TYPES[type] || OF_CASHFLOW_TYPES.FCO).label,
      cashflow_ignore: ignored,
      cashflow_ignore_reason: transaction.cashflow_ignore_reason ?? null,
      cashflow_effective_amount: ignored ? 0 : Number(transaction.cashflow_effective_amount ?? amount),
      cashflow_original_amount: amount,
      cashflow_classification_source: transaction.cashflow_source ?? null,
      cashflow_pending: transaction.cashflow_computed_at == null,
    };
  });
}

function ofCountPendingCashflow(transactions) {
  return (transactions || []).reduce((n, t) => n + (t.cashflow_pending ? 1 : 0), 0);
}

// Transactions the scheduled pass hasn't classified yet are counted as normal
// movement, which means an internal transfer between two of the org's own
// accounts is currently being counted on both sides. That inflates entradas
// and saídas, so it has to be stated rather than left for someone to discover
// by reconciling against the bank.
function ofRenderCashflowPendingBanner(transactions) {
  const slot = document.getElementById("ofCashflowPendingSlot");
  if (!slot) return;

  const existing = document.getElementById("ofCashflowPendingBanner");
  const pending = ofCountPendingCashflow(transactions);

  if (!pending) {
    existing?.remove();
    return;
  }

  const message =
    `${pending} transação(ões) deste período ainda não passaram pela classificação de fluxo de caixa. ` +
    `Até lá, transferências entre suas próprias contas podem estar sendo contadas duas vezes em Entradas e Saídas. ` +
    `A classificação roda automaticamente às 8h e 16h — clique em "Atualizar" para rodar agora.`;

  if (existing) {
    existing.querySelector("[data-msg]").textContent = message;
    return;
  }

  const banner = document.createElement("div");
  banner.id = "ofCashflowPendingBanner";
  banner.style.cssText =
    "display:flex;gap:10px;align-items:flex-start;background:rgba(240,169,60,.10);" +
    "border:1px solid rgba(240,169,60,.35);border-radius:12px;padding:12px 14px;margin-bottom:14px;" +
    "font-size:12.5px;line-height:1.55;color:var(--ink2)";
  banner.innerHTML =
    `<span style="flex:none;font-size:14px;line-height:1.2">⚠️</span><span data-msg>${ofEscapeHtml(message)}</span>`;
  slot.appendChild(banner);
}

function ofEffectiveAmount(transaction) {
  if (transaction?.cashflow_ignore) return 0;

  if (transaction?.cashflow_effective_amount !== undefined) {
    return Number(transaction.cashflow_effective_amount || 0);
  }

  return Number(transaction?.amount || 0);
}

function ofIsEffectiveTransaction(transaction) {
  return !transaction?.cashflow_ignore && Number(ofEffectiveAmount(transaction)) !== 0;
}

function ofCashflowBadge(transaction) {
  const type = transaction?.cashflow_type || "FCO";
  const config = OF_CASHFLOW_TYPES[type] || OF_CASHFLOW_TYPES.FCO;

  return `
    <span style="
      display:inline-flex;
      align-items:center;
      gap:6px;
      font-size:11px;
      font-weight:800;
      color:${config.color};
      text-transform:uppercase;
      letter-spacing:.02em;
    ">
      <span style="width:8px;height:8px;border-radius:50%;background:${config.color};display:inline-block"></span>
      ${ofEscapeHtml(config.shortLabel)}
    </span>
  `;
}

function ofGroupAccountsByBank(accounts, pluggyItemsById) {
  const grouped = new Map();

  for (const account of accounts || []) {
    const pluggyItem = pluggyItemsById.get(account.pluggy_item_id);
    const bankName = pluggyItem?.connector_name || "Instituição financeira";

    if (!grouped.has(bankName)) {
      grouped.set(bankName, {
        bankName,
        balance: 0,
        openInvoice: 0,
        accounts: [],
        currency_code: account.currency_code || "BRL",
      });
    }

    const group = grouped.get(bankName);

    // `balance` é caixa; a fatura do cartão vai para `openInvoice` e aparece na
    // tela como dívida. Somada aqui, ela virava saldo com o sinal invertido.
    if (ofIsCreditCardAccount(account)) {
      group.openInvoice += ofFiniteBalance(account.balance);
    } else {
      group.balance += ofFiniteBalance(account.balance);
    }

    group.accounts.push(account);
  }

  // Espelha sortBanksByBalance de src/domain/bank-position.js, que é onde esta
  // regra tem teste. Os arquivos da raiz não fazem `import`.
  //
  // Ordenava por valor absoluto até 30/09, e com isso uma conta negativa grande
  // encabeçava a lista que existe para mostrar onde há caixa.
  return [...grouped.values()].sort((a, b) => {
    const left = Number(a.balance);
    const right = Number(b.balance);
    const leftOk = Number.isFinite(left);
    const rightOk = Number.isFinite(right);
    if (!leftOk && !rightOk) return 0;
    if (!leftOk) return 1;
    if (!rightOk) return -1;
    if (right !== left) return right - left;
    return String(a.bankName || "").localeCompare(String(b.bankName || ""), "pt-BR");
  });
}

// Pages used to be fetched strictly one after another, each waiting on the
// previous — for an org with tens of thousands of transactions that's dozens
// of sequential round trips stacked end to end, and it's the single biggest
// contributor to the cold-cache wait on the dashboard. Asking for the row
// count up front means every page range is known immediately, so they can be
// requested concurrently instead.
// Explicit column list instead of "*", so the bulk fetch stops carrying
// fields nothing on this page reads.
//
// `raw` is deliberately absent, and that is the point of moving classification
// server-side: it was roughly 90% of each row's bytes and was downloaded
// solely to evaluate the cash-flow rules and derive the counterparty for
// display. Both now arrive precomputed in the cashflow_* and counterparty_*
// columns, so the client never needs the payload it was derived from.
//
// Excluded after checking every read site: org_id (only ever a filter),
// pluggy_transaction_id, status (POSTED/PENDING is never branched on),
// created_at/updated_at (the sync fingerprint uses its own tiny query, not
// this fetch), nature_category_name, nature_classified_at,
// cluster_classified_at.
const OF_TX_COLUMNS = [
  "id",
  "pluggy_item_id",
  "pluggy_account_id",
  "date",
  "description",
  "amount",
  "currency_code",
  "type",
  "category",
  "category_id",
  "nature_category_id",
  "nature_source",
  "cluster_label",
  "cluster_category_id",
  "cluster_source",
  "ai_cashflow_type",
  "group_id",
  "group_label",
  // Computed by the scheduled pass; see _shared/cashflow-classification.ts.
  "cashflow_ignore",
  "cashflow_ignore_reason",
  "cashflow_type",
  "cashflow_effective_amount",
  "cashflow_source",
  "cashflow_computed_at",
  "counterparty_name",
  "counterparty_document",
  "counterparty_document_type",
  "payment_method_label",
].join(",");

async function ofFetchAllTransactions(orgId, from, to) {
  const pageSize = 1000;
  const maxPages = 100;
  const maxConcurrent = 6;

  // Transactions Pluggy retracted (transactions/deleted webhook) are tombstoned
  // in place rather than removed — see the deleted_at column. They are not real
  // movement, and the institution often re-sends the same operation under a new
  // id afterwards, so leaving them in counts the amount twice or three times.
  const applyFilters = (query) => {
    let q = query.eq("org_id", orgId).is("deleted_at", null);
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);
    return q;
  };

  // `date` alone is not a total order — thousands of rows share a single date,
  // and Postgres is free to break those ties differently between queries.
  // Under the old sequential loop that could already silently drop or
  // duplicate a row straddling a page boundary; with pages fetched
  // concurrently it would be near-certain. Adding `id` makes the ordering
  // total, so every range request sees the same sequence.
  const orderPage = (q) => q.order("date", { ascending: false }).order("id", { ascending: true });

  const { count, error: countError } = await applyFilters(
    supabaseClient.from("pluggy_transactions").select("id", { count: "exact", head: true })
  );
  if (countError) throw countError;

  const total = count || 0;
  if (total === 0) return [];

  const pageCount = Math.min(Math.ceil(total / pageSize), maxPages);
  const pages = new Array(pageCount);

  const fetchPage = async (page) => {
    const fromIndex = page * pageSize;
    const { data, error } = await orderPage(
      applyFilters(supabaseClient.from("pluggy_transactions").select(OF_TX_COLUMNS))
    ).range(fromIndex, fromIndex + pageSize - 1);
    if (error) throw error;
    pages[page] = data || [];
  };

  // Bounded rather than a flat Promise.all over every page: a large org would
  // otherwise open 30+ simultaneous connections in one burst, which the
  // browser queues anyway and PostgREST may rate-limit.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrent, pageCount) }, async () => {
      while (next < pageCount) {
        await fetchPage(next++);
      }
    })
  );

  return pages.flat();
}

// The same bank account can arrive as more than one row: a single Pluggy item
// sometimes reports an account twice, under two ids but with the same
// institution and number. Left alone those rows are counted as separate
// accounts ("12 contas" for 10 real ones) and, worse, their balances are
// summed independently — today the extra copies happen to carry 0,00, so the
// consolidated balance is right by luck rather than by construction.
//
// Two rows are the same account when the institution and the account number
// match. Among the copies, keep the one carrying an actual balance: an
// account genuinely at zero loses nothing, and a duplicate whose copy is
// stale no longer erases the real figure.
function ofDedupeAccounts(accounts) {
  const byIdentity = new Map();

  for (const account of accounts || []) {
    const number = String(account?.number ?? "").trim();
    // Without a number there is nothing to match on — keep the row as-is
    // rather than collapsing unrelated accounts onto an empty key.
    if (!number) {
      byIdentity.set(`__sem-numero__${account?.pluggy_account_id ?? Math.random()}`, account);
      continue;
    }

    const identity = `${String(account?.name ?? "").trim().toLowerCase()}|${number}`;
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, account);
      continue;
    }

    if (Math.abs(Number(account?.balance || 0)) > Math.abs(Number(existing?.balance || 0))) {
      byIdentity.set(identity, account);
    }
  }

  return [...byIdentity.values()];
}

async function ofFetchAccounts(orgId) {
  const { data, error } = await supabaseClient
    .from("pluggy_accounts")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ofDedupeAccounts(data || []);
}

// pluggy_accounts.balance is always the live, current-as-of-last-sync
// balance — it has no time dimension. To show a balance as of a given date
// (period end for "saldo consolidado", the day before period start for
// "saldo inicial"), walk it backward: take every already-fetched
// transaction dated *after* asOfDate and subtract its net effect from the
// live balance — the same backward-walk approach ofBuildEstimatedBalanceSeries
// already uses for the trend chart. Pass a wide-enough `transactions` array
// (see paintOpenFinanceDashboard) so "after asOfDate" is actually complete.
// With no asOfDate, the live balance is returned as-is.
function ofComputeAccountsAsOf(accounts, transactions, asOfDate) {
  if (!asOfDate) return accounts;

  const futureNetByAccount = new Map();
  for (const transaction of transactions) {
    if (!transaction.date || transaction.date <= asOfDate) continue;
    if (!ofIsEffectiveTransaction(transaction)) continue;
    const acctId = ofGetTransactionAccountId(transaction);
    futureNetByAccount.set(acctId, (futureNetByAccount.get(acctId) || 0) + ofEffectiveAmount(transaction));
  }

  // Atenção: para conta de cartão o resultado não significa nada — a Pluggy
  // devolve dívida positiva, então o saldo anda ao contrário da transação e o
  // walk-back erra o sinal. Ninguém lê fatura daqui hoje (ofCashBalance e
  // initialByBank descartam cartão); se alguém for ler, conserte antes.
  return accounts.map((account) => {
    const futureNet = futureNetByAccount.get(ofGetAccountId(account)) || 0;
    return { ...account, balance: Number(account.balance || 0) - futureNet };
  });
}

// The day right before `dateStr` (date-only "YYYY-MM-DD" strings) — used to
// turn "saldo inicial as of period start" into an ofComputeAccountsAsOf
// cutoff (which is itself exclusive: transactions dated exactly on the
// cutoff are excluded, i.e. treated as part of the following day's balance).
function ofDayBefore(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return ofToDateInputValue(d);
}

async function ofFetchPluggyItems(orgId, pluggyItemIds) {
  if (!pluggyItemIds || !pluggyItemIds.length) return [];

  const fetchWith = (columns) =>
    supabaseClient
      .from("pluggy_items")
      .select(columns)
      .eq("org_id", orgId)
      .in("pluggy_item_id", pluggyItemIds);

  let { data, error } = await fetchWith("pluggy_item_id, connector_name, status, company_id");

  if (error) {
    // `deploy-pages` e `deploy-supabase` disparam no mesmo push e correm em
    // paralelo, então há uma janela em que este arquivo já está no ar e a
    // coluna company_id ainda não existe. Sem esta segunda tentativa, o
    // dashboard perderia o nome de todos os conectores nessa janela.
    ({ data, error } = await fetchWith("pluggy_item_id, connector_name, status"));
  }

  if (error) {
    console.warn("Não foi possível buscar nomes dos conectores Pluggy:", error);
    return [];
  }

  return data || [];
}

// ── Persisted snapshot (IndexedDB) ──────────────────────────────────────────
// Survives full page reloads/navigations (unlike the in-memory cache below),
// so reopening the dashboard after closing it doesn't redo the full fetch +
// classification pass either — it's what lets "abrir o painel" show the
// same static view instantly instead of always reloading. IndexedDB (not
// localStorage) because a large org's classified transaction set can run
// several MB, past what localStorage's ~5-10MB per-origin quota can hold.
const OF_SNAPSHOT_DB_NAME = "profin_of_snapshot";
const OF_SNAPSHOT_STORE = "snapshots";

// Bumped whenever the shape of a cached transaction row changes. A snapshot
// written before cash-flow classification moved server-side holds rows with a
// `raw` payload and none of the cashflow_* columns; reusing it would make
// every transaction look unclassified. The fingerprint check can't catch that
// on its own — nothing synced, so lastSyncAt still matches — so the shape is
// versioned separately from the data's freshness.
// Versão 3: as conexões passaram a carregar company_id, que é o que decide se
// a linha entra no recorte ativo. Um snapshot da versão 2 não tem esse campo,
// e reaproveitá-lo faria qualquer recorte específico devolver tela vazia — sem
// erro nenhum, parecendo "não houve movimento no período". Subir a versão
// descarta o snapshot antigo e força uma busca.
const OF_SNAPSHOT_SHAPE = 3;

function ofOpenSnapshotDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OF_SNAPSHOT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OF_SNAPSHOT_STORE)) {
        req.result.createObjectStore(OF_SNAPSHOT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ofLoadPersistedSnapshot(orgId) {
  try {
    const db = await ofOpenSnapshotDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OF_SNAPSHOT_STORE, "readonly");
      const req = tx.objectStore(OF_SNAPSHOT_STORE).get(orgId);
      req.onsuccess = () => {
        const snapshot = req.result || null;
        resolve(snapshot && snapshot.shape === OF_SNAPSHOT_SHAPE ? snapshot : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Não foi possível ler snapshot local:", err);
    return null;
  }
}

async function ofSavePersistedSnapshot(orgId, snapshot) {
  try {
    const db = await ofOpenSnapshotDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OF_SNAPSHOT_STORE, "readwrite");
      tx.objectStore(OF_SNAPSHOT_STORE).put(snapshot, orgId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // A quota error or disabled storage just means the next load re-fetches
    // like before — the snapshot is a pure optimization, not load-bearing.
    console.warn("Não foi possível salvar snapshot local:", err);
  }
}

async function ofClearPersistedSnapshot(orgId) {
  try {
    const db = await ofOpenSnapshotDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OF_SNAPSHOT_STORE, "readwrite");
      tx.objectStore(OF_SNAPSHOT_STORE).delete(orgId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Não foi possível limpar snapshot local:", err);
  }
}

// Fetches + classifies EVERY transaction for the org exactly once per page
// load and caches the in-flight/result promise in memory. Every Visão
// Geral / Open Finance / Projeção / Orçado paint function reads from this
// instead of independently re-fetching and re-classifying the same rows.
// Every consumer filters this cached, unbounded array down to whatever date
// range is currently selected client-side, so switching tabs or changing
// the date filter never re-hits the network.
//
// On a cold in-memory cache (fresh page load), it first checks the
// persisted IndexedDB snapshot from a previous visit: if that snapshot's
// `lastSyncAt` fingerprint still matches the real "most recent sync/edit"
// timestamp read from the DB (a handful of cheap indexed row lookups, not
// the full paginated transaction fetch), nothing actually changed since
// the snapshot was taken, so it's used as-is with zero fetch/reclassify
// cost. Only ofInvalidateAllTxCache() (after a classification run, a
// manual edit, a group/ungroup) or the "Atualizar" button forces a real
// refetch within the same tab; a genuinely new sync bumps `updated_at` on
// the affected rows regardless of which tab/page triggered it, so the
// fingerprint check catches that on the next load even from a fresh tab.
let _ofAllTxCache = null;   // { orgId, promise } — dados da organização inteira
let _ofScopedCache = null;  // { orgId, viewId, data } — os mesmos dados já recortados

// Guards against two render passes racing on the same DOM: a slow first
// load (cold cache) can still be awaiting ofGetAllClassifiedTransactions
// when a completely independent event — most notably a silent background
// classification resume (see ofCheckClassificationJob) finishing and
// calling ofRefreshOpenFinanceActiveTab() — kicks off a second pass for the
// same tab. Without this, both passes end up writing to the same loading
// overlays/tables/charts out of order, which is what produced the stuck
// spinner and the visually "cut" bank table on first load. Each paint
// function claims a generation number as its first line and re-checks it
// right after its async data fetch resolves; if a newer pass has since
// claimed a later number, this one is stale and bails without touching the
// DOM — the newer pass is the one that's actually current.
// One counter per painter, not one shared across all of them.
//
// Each painter stamps itself on entry and, after awaiting its data, checks
// whether it is still the newest run before touching the DOM — so a stale pass
// (an old period still in flight when the user picks a new one) doesn't
// overwrite fresher output. That guard only makes sense against *the same*
// painter: with a single shared counter, starting any painter cancelled every
// other one already in flight, even though they draw different charts and
// never conflict.
//
// The visible symptom was the cluster chart — last in the Visão Geral
// sequence, so most likely to still be awaiting when something else bumped
// the counter — coming up blank on first load and then appearing as soon as a
// tab switch or filter change gave it a pass nothing superseded.
const _ofRenderGenerations = new Map();

function ofNextRenderGeneration(painter) {
  const next = (_ofRenderGenerations.get(painter) || 0) + 1;
  _ofRenderGenerations.set(painter, next);
  return next;
}

function ofIsStaleRender(painter, generation) {
  return _ofRenderGenerations.get(painter) !== generation;
}

function ofInvalidateAllTxCache(orgId) {
  _ofAllTxCache = null;
  // O recorte é derivado do cache principal; deixá-lo para trás serviria dado
  // velho depois de uma sincronização ou de uma reclassificação.
  _ofScopedCache = null;
  if (orgId) ofClearPersistedSnapshot(orgId);
}

async function ofGetLatestSyncFingerprint(session) {
  const [openFinanceSyncAt, integrationSyncAt] = await Promise.all([
    ofFetchLatestOpenFinanceSyncAt(session),
    ofFetchLatestIntegrationSyncAt(session),
  ]);
  return ofGetNewestDate(openFinanceSyncAt, integrationSyncAt);
}

// A busca continua sendo da organização inteira e cacheada por organização.
// O recorte é aplicado DEPOIS, sobre o resultado: assim uma busca serve todas
// as visões, trocar de recorte não refaz round-trip, e o snapshot no IndexedDB
// continua válido seja qual for a visão escolhida.
async function ofLoadOrgWideData(session) {
  if (_ofAllTxCache && _ofAllTxCache.orgId === session.orgId) {
    return _ofAllTxCache.promise;
  }

  const promise = (async () => {
    const latestSyncAt = await ofGetLatestSyncFingerprint(session);

    const snapshot = await ofLoadPersistedSnapshot(session.orgId);
    if (snapshot && snapshot.lastSyncAt === latestSyncAt) {
      return {
        accounts: snapshot.accounts,
        accountsById: new Map(snapshot.accounts.map((a) => [ofGetAccountId(a), a])),
        pluggyItems: snapshot.pluggyItems,
        pluggyItemsById: new Map(snapshot.pluggyItems.map((item) => [item.pluggy_item_id, item])),
        transactions: snapshot.transactions,
      };
    }

    const accounts = await ofFetchAccounts(session.orgId);
    const pluggyItemIds = [
      ...new Set(accounts.map((account) => account.pluggy_item_id).filter(Boolean)),
    ];
    const pluggyItems = await ofFetchPluggyItems(session.orgId, pluggyItemIds);
    const pluggyItemsById = new Map(pluggyItems.map((item) => [item.pluggy_item_id, item]));
    const accountsById = new Map(accounts.map((account) => [ofGetAccountId(account), account]));
    const rawTransactions = await ofFetchAllTransactions(session.orgId, null, null);
    const transactions = ofClassifyTransactions(rawTransactions, accountsById);

    ofSavePersistedSnapshot(session.orgId, { shape: OF_SNAPSHOT_SHAPE, lastSyncAt: latestSyncAt, accounts, pluggyItems, transactions });

    return { accounts, accountsById, pluggyItems, pluggyItemsById, transactions };
  })();

  _ofAllTxCache = { orgId: session.orgId, promise };
  // A failed fetch shouldn't poison the cache forever — let the next caller retry.
  promise.catch(() => {
    if (_ofAllTxCache?.promise === promise) _ofAllTxCache = null;
  });

  return promise;
}

// Recorte já aplicado, memoizado pela visão: filtrar 20 mil transações a cada
// chamada seria desperdício, e são cinco chamadores.
function ofApplyViewScope(data, allowedItemIds) {
  // null é "não filtra": devolve o MESMO objeto, para que a visão padrão seja
  // literalmente o comportamento anterior, não uma reconstrução equivalente.
  if (allowedItemIds === null) return data;

  const accounts = data.accounts.filter((account) => allowedItemIds.has(account.pluggy_item_id));
  const pluggyItems = data.pluggyItems.filter((item) => allowedItemIds.has(item.pluggy_item_id));
  const transactions = data.transactions.filter((tx) => allowedItemIds.has(tx.pluggy_item_id));

  return {
    accounts,
    accountsById: new Map(accounts.map((account) => [ofGetAccountId(account), account])),
    pluggyItems,
    pluggyItemsById: new Map(pluggyItems.map((item) => [item.pluggy_item_id, item])),
    transactions,
  };
}

async function ofGetAllClassifiedTransactions(session) {
  const data = await ofLoadOrgWideData(session);
  const scope = await resolveActiveViewScope(session);
  const viewId = scope?.view?.id || null;

  // O contexto usa os dados da organização INTEIRA, e não o recorte: numa
  // visão de uma empresa só, é justamente a contraparte que está fora do
  // recorte que precisa ser reconhecida como do grupo.
  _ofCompanyContext = {
    byCnpj: new Map(
      (scope?.companies || [])
        .map((company) => [ofNormalizeDocument(company.cnpj), company])
        .filter(([cnpj]) => cnpj.length === 14)
    ),
    companyByItem: new Map(
      data.pluggyItems.map((item) => [item.pluggy_item_id, item.company_id || null])
    ),
  };

  if (_ofScopedCache && _ofScopedCache.orgId === session.orgId && _ofScopedCache.viewId === viewId) {
    return _ofScopedCache.data;
  }

  const scoped = ofApplyViewScope(data, allowedItemIdsForScope(scope, data.pluggyItems));
  _ofScopedCache = { orgId: session.orgId, viewId, data: scoped };
  return scoped;
}

// Adds/removes a small spinner overlay over a chart's canvas so a stale
// chart from the previous period/org never lingers on screen while the
// shared transaction fetch (see ofGetAllClassifiedTransactions) is in
// flight — each chart's own render function clears its overlay the moment
// it actually draws, right after the shared data becomes available.
// Chart.js is loaded from a third-party CDN. When that request fails — a
// blocked domain, an offline moment, an extension — every chart render used to
// hit `typeof Chart === "undefined"` and return without a word, leaving a large
// empty panel that looks like "there is no data here" rather than "the chart
// library never arrived". Those two states mean opposite things to someone
// reading a financial dashboard, so the difference has to be on screen.
function ofShowChartUnavailable(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  const wrapper = canvas?.parentElement;
  if (!wrapper) return;

  ofSetChartLoading(canvasId, false);

  const noticeId = `${canvasId}-unavailable`;
  if (document.getElementById(noticeId)) return;

  if (!wrapper.style.position) wrapper.style.position = "relative";

  const notice = document.createElement("div");
  notice.id = noticeId;
  notice.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;" +
    "align-items:center;justify-content:center;text-align:center;padding:20px;" +
    "font-size:12.5px;line-height:1.5;color:var(--muted)";
  notice.innerHTML =
    `<span style="font-size:18px">📊</span><span>${ofEscapeHtml(message)}</span>`;
  wrapper.appendChild(notice);
}

function ofClearChartUnavailable(canvasId) {
  document.getElementById(`${canvasId}-unavailable`)?.remove();
}

function ofSetChartLoading(canvasId, isLoading) {
  const canvas = document.getElementById(canvasId);
  const wrapper = canvas?.parentElement;
  if (!wrapper) return;

  const overlayId = `${canvasId}-loading`;
  const existing = document.getElementById(overlayId);

  if (!isLoading) {
    existing?.remove();
    return;
  }
  if (existing) return;

  // Not every canvas has a dedicated position:relative wrapper (some sit
  // directly in .card, which is position:static) — force it here so the
  // overlay is always contained instead of escaping to the page.
  if (!wrapper.style.position) wrapper.style.position = "relative";

  const overlay = document.createElement("div");
  overlay.id = overlayId;
  overlay.className = "of-chart-loading";
  overlay.innerHTML = `<div class="of-spinner"></div><span>Carregando…</span>`;
  wrapper.appendChild(overlay);

  // Safety net: whatever chart-render call was supposed to clear this
  // (an error path that misses a cleanup call, a render pass that gets
  // abandoned some other way) shouldn't leave it spinning forever — auto-
  // clear after a generous timeout. Checked by reference so a stale timer
  // never removes a newer overlay that replaced this one in the meantime.
  setTimeout(() => {
    if (document.getElementById(overlayId) === overlay) overlay.remove();
  }, 20000);
}

// Single source of truth for the Visão Geral KPI row, so the loading
// skeleton and the real render can never drift out of order or count.
const OF_KPI_LABELS = ["Saldo Inicial", "Saldo Consolidado", "Entradas", "Saídas", "Mov. Líquida"];

// Shown the moment a date-filter change or tab switch kicks off a real
// fetch (i.e. the shared transaction cache is cold) — every card here gets
// overwritten by its own render function once data is ready, so the same
// stale numbers from the previous period/org can never be mistaken for the
// new selection while the fetch is in flight.
function ofRenderLoading() {
  const p0Kpis = document.getElementById("p0-kpis");
  if (p0Kpis) {
    // Render the full row of cards in a loading state rather than a single
    // "Carregando…" card: collapsing five cards into one made the row change
    // shape mid-load, so the page visibly reflowed when the numbers arrived
    // and there was no hint of what was still coming. Labels must stay in
    // sync with ofRenderP0Kpis below.
    p0Kpis.innerHTML = OF_KPI_LABELS.map((label, i) => `
      <div class="kpi" aria-busy="true">
        <div class="kpi-label">${ofEscapeHtml(label)}</div>
        <div class="kpi-value" style="display:flex;align-items:center;gap:8px;min-height:25px">
          ${i === 0 ? `<span class="of-spinner"></span>` : ""}
          <span class="of-skel of-skel-value"></span>
        </div>
        <div class="kpi-sub"><span class="of-skel of-skel-sub"></span></div>
      </div>
    `).join("");
  }

  const natTable = document.getElementById("p0-nat-table");
  if (natTable) {
    natTable.innerHTML = `<tbody><tr><td style="text-align:center;padding:18px"><span class="of-spinner" style="vertical-align:middle;margin-right:8px"></span>Carregando…</td></tr></tbody>`;
  }

  const bankList = document.getElementById("bankList");
  if (bankList) {
    bankList.innerHTML = `<div class="cs" style="padding:18px 0;display:flex;align-items:center;gap:8px"><span class="of-spinner"></span> Carregando…</div>`;
  }

  ofSetChartLoading("c-p0-saldo", true);
  ofSetChartLoading("c-p0-cluster", true);
  ofSetChartLoading("c-p1-combo", true);
  ofSetChartLoading("c-p1-dfc", true);
}

function ofDestroyChartById(id) {
  if (typeof Chart === "undefined") return;

  const canvas = document.getElementById(id);
  if (!canvas) return;

  const existingChart = Chart.getChart(canvas);
  if (existingChart) existingChart.destroy();
}

function ofRenderEmptyState() {
  const p0Kpis = document.getElementById("p0-kpis");
  const bankList = document.getElementById("bankList");
  const summary = document.getElementById("openFinanceSummary");
  const transactionsTable = document.getElementById("openFinanceTransactionsTable");
  const transactionsSub = document.getElementById("openFinanceTransactionsSub");
  const natureTable = document.getElementById("p0-nat-table");

  ofSetChartLoading("c-p0-saldo", false);
  ofSetChartLoading("c-p0-cluster", false);
  ofSetChartLoading("c-p1-combo", false);
  ofSetChartLoading("c-p1-dfc", false);

  if (p0Kpis) {
    // Same five cards as the loaded and loading states — an empty org used to
    // drop "Saldo Inicial" and render only four, so the row changed shape
    // again on the transition.
    p0Kpis.innerHTML = OF_KPI_LABELS.map((label) => `
      <div class="kpi">
        <div class="kpi-label">${ofEscapeHtml(label)}</div>
        <div class="kpi-value">R$ 0</div>
        <div class="kpi-sub" style="font-size:11px;color:var(--muted);margin-top:6px">${
          label === "Saldo Consolidado" ? "Nenhuma conta conectada" : "Sem transações"
        }</div>
      </div>
    `).join("");
  }

  if (bankList) {
    bankList.innerHTML = `
      <div class="cs" style="padding:8px 0">
        Conecte uma conta em Configurações &gt; Integrações para visualizar saldos e transações.
      </div>
    `;
  }

  if (summary) {
    summary.innerHTML = `<div class="cs">Ainda não há dados Open Finance para resumir.</div>`;
  }

  if (transactionsSub) {
    transactionsSub.textContent = "Nenhuma transação importada ainda";
  }

  if (transactionsTable) {
    transactionsTable.innerHTML = `
      <thead>
        <tr>
          <th>Data</th>
          <th style="text-align:left">Descrição</th>
          <th>Conta</th>
          <th>Tipo</th>
          <th>Natureza</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="6" style="text-align:center;color:var(--muted);padding:18px">
            Nenhuma transação encontrada.
          </td>
        </tr>
      </tbody>
    `;
  }

  if (natureTable) {
    natureTable.innerHTML = `
      <thead>
        <tr>
          <th>Natureza</th>
          <th>Período selecionado</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>A classificar</td>
          <td>R$ 0</td>
        </tr>
      </tbody>
    `;
  }

  ofDestroyChartById("c-p0-saldo");
}

function ofRenderP0Kpis(accounts, transactions, accountsAtPeriodStart) {
  const p0Kpis = document.getElementById("p0-kpis");
  if (!p0Kpis) return;

  const totalBalance = ofCashBalance(accounts);
  const initialBalance = accountsAtPeriodStart ? ofCashBalance(accountsAtPeriodStart) : null;

  // A contagem acompanha o valor: com o cartão fora do saldo, dizer "4 contas"
  // embaixo de um total que soma 3 é o tipo de divergência que vira dúvida.
  const cardCount = accounts.filter(ofIsCreditCardAccount).length;
  const cashCount = accounts.length - cardCount;

  const effectiveTransactions = transactions.filter(ofIsEffectiveTransaction);
  const entries = effectiveTransactions.filter((transaction) => ofEffectiveAmount(transaction) > 0);
  const exits = effectiveTransactions.filter((transaction) => ofEffectiveAmount(transaction) < 0);
  const ignored = transactions.filter((transaction) => transaction.cashflow_ignore);

  const inflow = entries.reduce((sum, transaction) => sum + ofEffectiveAmount(transaction), 0);
  const outflow = exits.reduce((sum, transaction) => sum + ofEffectiveAmount(transaction), 0);
  const net = inflow + outflow;

  const currency = accounts[0]?.currency_code || transactions[0]?.currency_code || "BRL";
  const { from, to } = ofGetDateRange();
  const periodLabel = from && to ? `${ofFormatDate(from)} a ${ofFormatDate(to)}` : "Período selecionado";

  function mkKpi(label, value, sub) {
    return `
      <div class="kpi">
        <div class="kpi-label">${ofEscapeHtml(label)}</div>
        <div class="kpi-value ${ofClassValue(value)}">${ofFormatCurrency(value, currency, true)}</div>
        <div class="kpi-sub" style="font-size:11px;color:var(--muted);margin-top:6px">${ofEscapeHtml(sub)}</div>
      </div>
    `;
  }

  p0Kpis.innerHTML =
    mkKpi(
      OF_KPI_LABELS[0],
      initialBalance ?? totalBalance,
      initialBalance == null ? "Selecione um período para ver o saldo inicial" : `Posição em ${ofFormatDate(ofDayBefore(from))}`
    ) +
    mkKpi(
      OF_KPI_LABELS[1],
      totalBalance,
      `${cashCount} conta(s) Open Finance${cardCount ? ` · ${cardCount} cartão(ões) fora do saldo` : ""}`
    ) +
    mkKpi(OF_KPI_LABELS[2], inflow, `${entries.length} transação(ões) efetiva(s) · ${periodLabel}`) +
    mkKpi(OF_KPI_LABELS[3], -Math.abs(outflow), `${exits.length} transação(ões) efetiva(s) · ${periodLabel}`) +
    mkKpi(
      OF_KPI_LABELS[4],
      net,
      ignored.length
        ? `${ignored.length} transação(ões) ignorada(s) por regra`
        : net >= 0
          ? "Caixa gerou recursos"
          : "Caixa consumiu recursos"
    );
}

function ofBuildBankNameByAccountId(accounts, pluggyItemsById) {
  const map = new Map();
  for (const account of accounts || []) {
    const pluggyItem = pluggyItemsById.get(account.pluggy_item_id);
    map.set(ofGetAccountId(account), pluggyItem?.connector_name || "Instituição financeira");
  }
  return map;
}

function ofRenderBankPosition(accounts, pluggyItemsById, transactions, accountsAtPeriodStart) {
  const bankList = document.getElementById("bankList");
  const bankListTag = document.getElementById("bankListTag");

  if (!bankList) return;

  if (bankListTag) {
    bankListTag.textContent = "Open Finance";
  }

  const groups = ofGroupAccountsByBank(accounts, pluggyItemsById);
  const total = groups.reduce((sum, group) => sum + Number(group.balance || 0), 0);
  const totalOpenInvoice = groups.reduce((sum, group) => sum + Number(group.openInvoice || 0), 0);
  const currency = accounts[0]?.currency_code || "BRL";
  const colors = ["#9b86fb", "#2dd4a0", "#5b9dff", "#f0a93c", "#828798"];

  if (!groups.length) {
    bankList.innerHTML = `<div class="cs" style="padding:8px 0">Nenhuma conta encontrada.</div>`;
    return;
  }

  const bankNameByAccountId = ofBuildBankNameByAccountId(accounts, pluggyItemsById);

  const initialByBank = new Map();
  if (accountsAtPeriodStart) {
    for (const account of accountsAtPeriodStart) {
      const bankName = bankNameByAccountId.get(ofGetAccountId(account)) || "Instituição financeira";
      if (ofIsCreditCardAccount(account)) continue;
      initialByBank.set(bankName, (initialByBank.get(bankName) || 0) + ofFiniteBalance(account.balance));
    }
  }

  const entradasByBank = new Map();
  const saidasByBank = new Map();
  for (const transaction of transactions || []) {
    if (!ofIsEffectiveTransaction(transaction)) continue;
    const bankName = bankNameByAccountId.get(ofGetTransactionAccountId(transaction)) || "Instituição financeira";
    const amount = ofEffectiveAmount(transaction);
    if (amount > 0) entradasByBank.set(bankName, (entradasByBank.get(bankName) || 0) + amount);
    if (amount < 0) saidasByBank.set(bankName, (saidasByBank.get(bankName) || 0) + amount);
  }

  let totalInitial = 0;
  let totalEntradas = 0;
  let totalSaidas = 0;

  const rows = groups.map((group, index) => {
    const color = colors[index % colors.length];
    const accountMix = ofDescribeCashAccounts(group.accounts);
    const initial = accountsAtPeriodStart ? (initialByBank.get(group.bankName) || 0) : null;
    const entradas = entradasByBank.get(group.bankName) || 0;
    const saidas = saidasByBank.get(group.bankName) || 0;

    if (initial != null) totalInitial += initial;
    totalEntradas += entradas;
    totalSaidas += saidas;

    return `
      <tr>
        <td>
          <span class="dot" style="background:${color}"></span>
          ${ofEscapeHtml(group.bankName)}
          <span class="cs" style="font-weight:400">(${ofEscapeHtml(accountMix)})</span>
          ${group.openInvoice
            ? `<div class="cs" style="font-weight:400;margin-left:18px">
                 Cartão: fatura aberta de ${ofFormatCurrency(group.openInvoice, currency)}
               </div>`
            : ""}
        </td>
        <td>${initial == null ? "—" : ofFormatCurrency(initial, currency)}</td>
        <td>${ofFormatCurrency(entradas, currency)}</td>
        <td>${ofFormatCurrency(-Math.abs(saidas), currency)}</td>
        <td style="font-weight:700">${ofFormatCurrency(group.balance, currency)}</td>
      </tr>
    `;
  }).join("");

  bankList.innerHTML = `
    <table class="saldo-table">
      <thead>
        <tr>
          <th style="text-align:left">Banco</th>
          <th>Saldo Inicial</th>
          <th>Entradas</th>
          <th>Saídas</th>
          <th>Saldo Consolidado</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td>Total</td>
          <td>${accountsAtPeriodStart ? ofFormatCurrency(totalInitial, currency) : "—"}</td>
          <td>${ofFormatCurrency(totalEntradas, currency)}</td>
          <td>${ofFormatCurrency(-Math.abs(totalSaidas), currency)}</td>
          <td>${ofFormatCurrency(total, currency)}</td>
        </tr>
      </tbody>
    </table>
    ${totalOpenInvoice
      ? `<div class="cs" style="margin-top:8px">
           Fatura de cartão em aberto: ${ofFormatCurrency(totalOpenInvoice, currency)} — é dívida,
           então fica fora do saldo consolidado. As compras no cartão continuam em Saídas.
         </div>`
      : ""}
  `;
}

function ofRenderSummary(transactions) {
  const summary = document.getElementById("openFinanceSummary");
  const summarySub = document.getElementById("openFinanceSummarySub");

  if (!summary) return;

  const effectiveTransactions = transactions.filter(ofIsEffectiveTransaction);
  const ignored = transactions.filter((transaction) => transaction.cashflow_ignore);
  const entries = effectiveTransactions.filter((transaction) => ofEffectiveAmount(transaction) > 0);
  const exits = effectiveTransactions.filter((transaction) => ofEffectiveAmount(transaction) < 0);

  const inflow = entries.reduce((sum, transaction) => sum + ofEffectiveAmount(transaction), 0);
  const outflow = exits.reduce((sum, transaction) => sum + ofEffectiveAmount(transaction), 0);
  const net = inflow + outflow;
  const absTotal = effectiveTransactions.reduce((sum, transaction) => {
    return sum + Math.abs(ofEffectiveAmount(transaction));
  }, 0);
  const ticket = effectiveTransactions.length ? absTotal / effectiveTransactions.length : 0;

  const currency = transactions[0]?.currency_code || "BRL";
  const { from, to } = ofGetDateRange();

  if (summarySub) {
    summarySub.textContent =
      from && to
        ? `Período: ${ofFormatDate(from)} a ${ofFormatDate(to)}`
        : "Entradas e saídas no período selecionado";
  }

  summary.innerHTML = `
    <div class="card-row" style="grid-template-columns:repeat(4,1fr);gap:12px">
      <div>
        <div class="bank-name">Movimentação líquida</div>
        <div class="bank-sub">${effectiveTransactions.length} transação(ões) efetiva(s)</div>
        <div style="font-weight:800;margin-top:6px" class="${ofClassValue(net)}">
          ${ofFormatCurrency(net, currency)}
        </div>
      </div>

      <div>
        <div class="bank-name">Entradas</div>
        <div class="bank-sub">${entries.length} transação(ões)</div>
        <div style="font-weight:800;margin-top:6px" class="kv-pos">
          ${ofFormatCurrency(inflow, currency)}
        </div>
      </div>

      <div>
        <div class="bank-name">Saídas</div>
        <div class="bank-sub">${exits.length} transação(ões)</div>
        <div style="font-weight:800;margin-top:6px" class="kv-neg">
          ${ofFormatCurrency(-Math.abs(outflow), currency)}
        </div>
      </div>

      <div>
        <div class="bank-name">Ticket médio</div>
        <div class="bank-sub">${ignored.length} ignorada(s) por regra</div>
        <div style="font-weight:800;margin-top:6px;color:var(--muted)">
          ${ofFormatCurrency(ticket, currency)}
        </div>
      </div>
    </div>
  `;
}

// Cluster is an independent axis from Natureza (FCO/FCI/FCF) — it's the
// client's own granular chart-of-accounts bucket. A known supplier/CNPJ rule
// (Settings → Clusterização de Fornecedores) is tried first; when a
// transaction's counterparty isn't yet in that table, the AI picks from the
// same cluster list and the supplier gets "learned" as a new rule for next
// time — so this badge can show either source.
function ofClusterBadge(transaction) {
  const label = transaction.cluster_label;
  if (!label) {
    // cluster_source === "ai" with no label means the AI already looked at
    // this one and genuinely found no confident match (vs. simply never
    // having been attempted yet) — worth a manual look, so flag it distinctly.
    if (transaction.cluster_source === "ai") {
      return `<span title="A IA não encontrou um cluster confiável — atribua manualmente em Clusterização de Fornecedores" style="font-size:11px;color:#f0a93c;font-weight:600">Sem correspondência</span>`;
    }
    return `<span style="font-size:11px;color:var(--muted)">—</span>`;
  }
  const isRule = transaction.cluster_source === "rule";
  const bg = isRule ? "rgba(91,157,255,.15)" : "rgba(45,212,160,.15)";
  const fg = isRule ? "#5b9dff" : "#2dd4a0";
  const title = isRule ? "Definido por regra de fornecedor" : "Classificado por IA (novo fornecedor)";
  return `<span title="${title}" style="font-size:11px;padding:2px 7px;border-radius:4px;background:${bg};color:${fg};font-weight:600">${ofEscapeHtml(label)}</span>`;
}

// Populated on every ofRenderTransactions call so the row click handler
// (delegated, wired once) can look up the full transaction object — including
// the raw Pluggy payload needed to resolve its counterparty — by id.
const _ofTransactionsById = new Map();

// Collapses transactions sharing a non-null group_id (set by "Agrupar
// selecionadas") into one summed display row per group. Purely a display
// transformation — KPIs/charts/DFC keep reading the original `transactions`
// array untouched, so grouping never affects any total. A group with only
// one surviving member (e.g. after its sibling got re-grouped elsewhere)
// renders as a normal single row instead of a meaningless 1-item group.
function ofRoundCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function ofDiffDays(dateA, dateB) {
  if (!dateA || !dateB) return 999;
  const a = new Date(`${dateA}T00:00:00`);
  const b = new Date(`${dateB}T00:00:00`);
  return Math.abs((a.getTime() - b.getTime()) / 86400000);
}

// Pairs up the two legs of an already-zeroed internal bank transfer (both
// rows carry cashflow_source "internal_transfer_pair_rule", set server-side
// by the matching rule in _shared/cashflow-classification.ts) so they can
// render as a single line instead of two separate "ignored" rows. Only the
// pairing itself is redone here — display-only, nothing persisted — because
// the server discards which specific rows matched once both are zeroed.
function ofPairInternalTransfers(candidates) {
  const byAmount = new Map();
  for (const t of candidates) {
    const cents = Math.abs(ofRoundCents(t.amount));
    if (!byAmount.has(cents)) byAmount.set(cents, []);
    byAmount.get(cents).push(t);
  }

  const paired = new Set();
  const pairs = [];

  for (const bucket of byAmount.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const a = bucket[i];
      if (paired.has(a.id)) continue;

      for (let j = i + 1; j < bucket.length; j += 1) {
        const b = bucket[j];
        if (paired.has(b.id)) continue;

        const oppositeSigns = Math.sign(Number(a.amount || 0)) !== Math.sign(Number(b.amount || 0));
        const differentAccounts = ofGetTransactionAccountId(a) !== ofGetTransactionAccountId(b);
        const closeDates = ofDiffDays(a.date, b.date) <= 3;

        if (oppositeSigns && differentAccounts && closeDates) {
          paired.add(a.id);
          paired.add(b.id);
          pairs.push(Number(a.amount) < 0 ? [a, b] : [b, a]);
          break;
        }
      }
    }
  }

  const unpaired = candidates.filter((t) => !paired.has(t.id));
  return { pairs, unpaired };
}

function ofBuildTransactionDisplayRows(transactions) {
  const byGroup = new Map();
  const rows = [];
  const transferCandidates = [];

  for (const t of transactions) {
    if (t.group_id) {
      const list = byGroup.get(t.group_id) || [];
      list.push(t);
      byGroup.set(t.group_id, list);
    } else if (t.cashflow_source === "internal_transfer_pair_rule") {
      transferCandidates.push(t);
    } else {
      rows.push({ kind: "single", date: t.date, transaction: t });
    }
  }

  const { pairs, unpaired } = ofPairInternalTransfers(transferCandidates);

  for (const [fromTx, toTx] of pairs) {
    rows.push({
      kind: "transfer",
      date: fromTx.date > toTx.date ? fromTx.date : toTx.date,
      amount: Math.abs(Number(fromTx.amount || 0)),
      currency: fromTx.currency_code || toTx.currency_code || "BRL",
      fromTx,
      toTx,
    });
  }

  // A transfer-candidate whose matching leg isn't in this same filtered set
  // (e.g. it falls outside the selected period) still renders as its own
  // row — it's still correctly zeroed, just not visually merged.
  for (const t of unpaired) {
    rows.push({ kind: "single", date: t.date, transaction: t });
  }

  for (const [groupId, members] of byGroup) {
    if (members.length < 2) {
      members.forEach((t) => rows.push({ kind: "single", date: t.date, transaction: t }));
      continue;
    }

    const uniqueCashflowTypes = new Set(members.map((t) => t.cashflow_type || "FCO"));
    const uniqueClusterLabels = new Set(members.map((t) => t.cluster_label || null));
    const uniqueClusterSources = new Set(members.map((t) => t.cluster_source || null));
    const uniqueAccountIds = new Set(members.map((t) => ofGetTransactionAccountId(t)));

    rows.push({
      kind: "group",
      date: members[0].date,
      groupId,
      label: members[0].group_label || members[0].description || "Transações agrupadas",
      currency: members[0].currency_code || "BRL",
      amount: members.reduce((sum, t) => sum + Number(t.amount || 0), 0),
      effectiveAmount: members.reduce((sum, t) => sum + ofEffectiveAmount(t), 0),
      cashflowIgnore: members.every((t) => t.cashflow_ignore),
      memberCount: members.length,
      accountId: uniqueAccountIds.size === 1 ? [...uniqueAccountIds][0] : null,
      itemId: uniqueAccountIds.size === 1 ? ofGetTransactionItemId(members[0]) : null,
      cashflowType: uniqueCashflowTypes.size === 1 ? [...uniqueCashflowTypes][0] : null,
      clusterLabel: uniqueClusterLabels.size === 1 ? [...uniqueClusterLabels][0] : null,
      clusterSource: uniqueClusterSources.size === 1 ? [...uniqueClusterSources][0] : null,
    });
  }

  // transactions arrives sorted by date desc; re-sort after collapsing
  // groups back in to preserve that order (Array#sort is stable, so ties
  // keep their relative position).
  rows.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
  return rows;
}

const _ofSelectedTxIds = new Set();
// Whether row checkboxes are currently shown — starts off so the table stays
// clean by default; "Agrupar" turns this on, grouping (or a no-op click)
// turns it back off.
let _ofGroupSelectionModeActive = false;

function ofUpdateGroupButtonState() {
  const btn = document.getElementById("btnGroupTransactions");
  const table = document.getElementById("openFinanceTransactionsTable");
  if (table) table.dataset.selecting = _ofGroupSelectionModeActive ? "true" : "false";
  if (!btn) return;
  btn.textContent = _ofGroupSelectionModeActive
    ? `Agrupar selecionadas (${_ofSelectedTxIds.size})`
    : "Agrupar";
}

// Click behavior toggles between two states: idle (show checkboxes) and
// selecting (group what's checked, or cancel back to idle if nothing/only
// one row is checked).
async function ofOnGroupButtonClick() {
  if (!_ofGroupSelectionModeActive) {
    _ofGroupSelectionModeActive = true;
    ofUpdateGroupButtonState();
    return;
  }
  if (_ofSelectedTxIds.size < 2) {
    _ofGroupSelectionModeActive = false;
    _ofSelectedTxIds.clear();
    ofUpdateGroupButtonState();
    return;
  }
  await ofGroupSelectedTransactions();
}

// Same "still needs work" definition classify-transactions uses server-side
// (see needsClusterClassification in supabase/functions/classify-transactions)
// — either axis never attempted, or the AI tried the cluster and found
// nothing confident. Used by the "Mostrar apenas não classificadas" filter
// so what's shown here matches exactly what a classify-transactions run
// would still pick up.
function ofTransactionNeedsClassification(t) {
  return t.nature_source == null || t.cluster_source == null ||
    (t.cluster_source === "ai" && t.cluster_category_id == null);
}

let _ofVisibleTransactions = [];
let _ofVisibleAccountsById = new Map();
let _ofVisiblePluggyItemsById = new Map();

// ── Export ──────────────────────────────────────────────────────────────────
// Real .xlsx, built by xlsx-writer.js — no SheetJS, which would have added
// ~900KB from a CDN. Amounts go out as numbers rather than formatted text, so
// the file can be summed and pivoted on arrival instead of needing a
// find-and-replace on the decimal separator first.
//
// The export carries three columns the table cannot show: the effective amount,
// whether the row was excluded from the cash view, and the rule that excluded
// it. Without those, a total in the spreadsheet would not reconcile against the
// dashboard and there would be no way to see why.
function ofBuildTransactionsRows() {
  const accountsById = _ofVisibleAccountsById;
  const itemsById = _ofVisiblePluggyItemsById;

  const header = [
    "Data", "Descrição", "Categoria", "Contraparte", "Documento", "Forma",
    "Banco", "Conta", "Tipo", "Natureza", "Cluster",
    "Valor", "Valor efetivo", "Ignorada", "Motivo da exclusão",
  ];

  const rows = _ofVisibleTransactions.map((t) => {
    const sensitive = ofIsSensitivePayrollTransaction(t);
    const origin = ofGetTransactionOrigin(t);
    const account = accountsById.get(ofGetTransactionAccountId(t));
    const bankName = itemsById.get(t.pluggy_item_id)?.connector_name || "";

    return [
      ofFormatDate(t.date),
      t.description || "",
      t.category || "",
      sensitive ? "Dado oculto" : (origin.name || ""),
      sensitive ? "" : (origin.document || ""),
      sensitive ? "" : (origin.method || ""),
      bankName,
      account ? ofGetAccountLabel(account) : "",
      ofGetTransactionTypeLabel(t),
      t.cashflow_type || "",
      t.cluster_label || "",
      Number(t.amount || 0),
      Number(ofEffectiveAmount(t) || 0),
      t.cashflow_ignore ? "Sim" : "Não",
      t.cashflow_ignore_reason || "",
    ];
  });

  return [header, ...rows];
}

function ofDownloadTransactionsXlsx() {
  if (!_ofVisibleTransactions.length) return;
  if (typeof buildXlsx !== "function") {
    console.error("xlsx-writer.js não carregou — download indisponível.");
    return;
  }

  const { from, to } = ofGetDateRange();
  const suffix = from && to ? `_${from}_a_${to}` : "";

  const blob = new Blob([buildXlsx(ofBuildTransactionsRows(), "Transações")], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `transacoes_open_finance${suffix}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The list used to draw every row at once — thousands a month for Timbre —
// which made the table slow to open. It shows 50 display rows per page;
// grouped batches and transfer pairs are one display row each, so a group is
// never split across pages. Export, totals and counts still use the whole
// filtered list.
const OF_TX_PAGE_SIZE = 50;
let _ofTxPage = 1;
let _ofTxLastRenderArgs = null;

// Espelha paginate de src/domain/pagination.js, que é onde há teste.
function ofPaginate(items, page, pageSize) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const from = (current - 1) * size;
  const pageItems = items.slice(from, from + size);
  return { pageItems, page: current, totalPages, total, start: total ? from + 1 : 0, end: from + pageItems.length };
}

function ofRenderTransactionsPager(info) {
  const el = document.getElementById("openFinanceTransactionsPagination");
  if (!el) return;
  if (!info || info.totalPages <= 1) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="settings-pagination">
      <span>${info.start.toLocaleString("pt-BR")}–${info.end.toLocaleString("pt-BR")} de ${info.total.toLocaleString("pt-BR")} linhas</span>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="btn-secondary" style="font-size:12px;padding:5px 12px" data-of-tx-page="prev" ${info.page <= 1 ? "disabled" : ""}>Anterior</button>
        <span>Página ${info.page} de ${info.totalPages}</span>
        <button type="button" class="btn-secondary" style="font-size:12px;padding:5px 12px" data-of-tx-page="next" ${info.page >= info.totalPages ? "disabled" : ""}>Próxima</button>
      </div>
    </div>
  `;
}

function ofRenderTransactions(transactions, accountsById, pluggyItemsById, options = {}) {
  const table = document.getElementById("openFinanceTransactionsTable");
  // A new period or filter starts at page 1; only the pager keeps the page.
  if (!options.keepPage) _ofTxPage = 1;
  _ofTxLastRenderArgs = [transactions, accountsById, pluggyItemsById];
  const transactionsSub = document.getElementById("openFinanceTransactionsSub");
  const onlyUnclassified = document.getElementById("ofShowOnlyUnclassified")?.checked;

  if (!table) return;

  const visibleTransactions = onlyUnclassified
    ? transactions.filter(ofTransactionNeedsClassification)
    : transactions;

  _ofTransactionsById.clear();
  visibleTransactions.forEach((t) => _ofTransactionsById.set(String(t.id), t));
  // Held for the export, so the downloaded file is exactly the rows on screen —
  // same period, same "apenas não classificadas" state, same order.
  _ofVisibleTransactions = visibleTransactions;
  _ofVisibleAccountsById = accountsById;
  _ofVisiblePluggyItemsById = pluggyItemsById;
  // Selections for transactions no longer on screen (period changed, or they
  // just got grouped) don't make sense to keep around.
  for (const id of [..._ofSelectedTxIds]) {
    if (!_ofTransactionsById.has(id)) _ofSelectedTxIds.delete(id);
  }
  ofUpdateGroupButtonState();

  if (transactionsSub) {
    if (onlyUnclassified) {
      transactionsSub.textContent = `${visibleTransactions.length} não classificada(s) de ${transactions.length} no período`;
    } else {
      const effectiveCount = visibleTransactions.filter(ofIsEffectiveTransaction).length;
      const ignoredCount = visibleTransactions.filter((transaction) => transaction.cashflow_ignore).length;
      transactionsSub.textContent = `${effectiveCount} efetiva(s) · ${ignoredCount} ignorada(s) no período`;
    }
  }

  const theadHtml = `
    <tr>
      <th class="of-select-col" style="width:28px"></th>
      <th>Data</th>
      <th style="text-align:left">Descrição</th>
      <th style="text-align:left">Origem/Destino</th>
      <th>Conta</th>
      <th>Tipo</th>
      <th>Natureza</th>
      <th>Cluster</th>
      <th>Valor</th>
    </tr>
  `;

  if (!visibleTransactions.length) {
    table.innerHTML = `
      <thead>${theadHtml}</thead>
      <tbody>
        <tr>
          <td colspan="9" style="text-align:center;color:var(--muted);padding:18px">
            ${onlyUnclassified ? "Nenhuma transação não classificada no período." : "Nenhuma transação encontrada para o período."}
          </td>
        </tr>
      </tbody>
    `;
    ofRenderTransactionsPager(null);
    return;
  }

  const pageInfo = ofPaginate(ofBuildTransactionDisplayRows(visibleTransactions), _ofTxPage, OF_TX_PAGE_SIZE);
  _ofTxPage = pageInfo.page;
  const displayRows = pageInfo.pageItems;
  ofRenderTransactionsPager(pageInfo);

  table.innerHTML = `
    <thead style="position:sticky;top:0;z-index:3;background:var(--card)">${theadHtml}</thead>
    <tbody>
      ${displayRows
      .map((row) => {
        if (row.kind === "transfer") {
          const fromAccount = accountsById.get(ofGetTransactionAccountId(row.fromTx));
          const toAccount = accountsById.get(ofGetTransactionAccountId(row.toTx));
          const fromName = fromAccount
            ? ofGetAccountLabel(fromAccount)
            : pluggyItemsById.get(ofGetTransactionItemId(row.fromTx))?.connector_name || "Conta";
          const toName = toAccount
            ? ofGetAccountLabel(toAccount)
            : pluggyItemsById.get(ofGetTransactionItemId(row.toTx))?.connector_name || "Conta";

          return `
            <tr style="opacity:.68">
              <td class="of-select-col"></td>
              <td>${ofEscapeHtml(ofFormatDate(row.date))}</td>
              <td style="text-align:left;font-weight:600">
                Transferência entre contas
                <div style="font-size:11px;color:var(--muted);font-weight:400">Crédito e débito zerados · não entra no fluxo</div>
              </td>
              <td style="text-align:left;font-size:12px">${ofEscapeHtml(fromName)} → ${ofEscapeHtml(toName)}</td>
              <td>${ofEscapeHtml(fromName)} → ${ofEscapeHtml(toName)}</td>
              <td>Transferência</td>
              <td>${ofCashflowBadge({ cashflow_type: "IGNORAR" })}</td>
              <td><span style="color:var(--muted)">—</span></td>
              <td style="font-weight:700">
                ${ofFormatCurrency(row.amount, row.currency)}
                <div style="font-size:11px;color:var(--muted);font-weight:400">líquido R$ 0,00</div>
              </td>
            </tr>
          `;
        }

        if (row.kind === "group") {
          const accountName = row.accountId
            ? (accountsById.get(row.accountId) ? ofGetAccountLabel(accountsById.get(row.accountId)) : pluggyItemsById.get(row.itemId)?.connector_name || "Conta")
            : "Múltiplas contas";
          const typeLabel = ofGetTransactionTypeLabel({ cashflow_ignore: row.cashflowIgnore, amount: row.effectiveAmount });

          return `
            <tr style="${row.cashflowIgnore ? "opacity:.68" : ""}">
              <td class="of-select-col"></td>
              <td>${ofEscapeHtml(ofFormatDate(row.date))}</td>
              <td style="text-align:left;font-weight:600">
                ${ofEscapeHtml(row.label)}
                <div style="font-size:11px;color:var(--muted);font-weight:400">
                  ${row.memberCount} transações agrupadas ·
                  <a href="#" class="of-ungroup-link" data-group-id="${ofEscapeHtml(row.groupId)}" style="color:var(--accent)">Desagrupar</a>
                </div>
              </td>
              <td style="text-align:left;font-size:12px"><span style="color:var(--muted)">—</span></td>
              <td>${ofEscapeHtml(accountName)}</td>
              <td>${ofEscapeHtml(typeLabel)}</td>
              <td>${ofCashflowBadge({ cashflow_type: row.cashflowType })}</td>
              <td>${ofClusterBadge({ cluster_label: row.clusterLabel, cluster_source: row.clusterSource })}</td>
              <td class="${ofClassValue(row.cashflowIgnore ? row.amount : row.effectiveAmount)}" style="font-weight:700">
                ${ofFormatCurrency(row.amount, row.currency)}
                ${row.cashflowIgnore ? `<div style="font-size:11px;color:var(--muted);font-weight:400">não entra no fluxo</div>` : ""}
              </td>
            </tr>
          `;
        }

        const transaction = row.transaction;
        const accountId = ofGetTransactionAccountId(transaction);
        const itemId = ofGetTransactionItemId(transaction);
        const account = accountsById.get(accountId);
        const pluggyItem = pluggyItemsById.get(itemId || account?.pluggy_item_id);

        const accountName = account
          ? ofGetAccountLabel(account)
          : pluggyItem?.connector_name || "Conta";

        const amount = Number(transaction.amount || 0);
        const effectiveAmount = ofEffectiveAmount(transaction);
        const currency = transaction.currency_code || account?.currency_code || "BRL";
        const typeLabel = ofGetTransactionTypeLabel(transaction);
        const txId = String(transaction.id);

        return `
            <tr data-tx-id="${ofEscapeHtml(txId)}" style="cursor:pointer;${transaction.cashflow_ignore ? "opacity:.68" : ""}" title="Clique para editar a natureza/cluster desta transação">
              <td class="of-select-col"><input type="checkbox" class="of-tx-select" data-tx-id="${ofEscapeHtml(txId)}" ${_ofSelectedTxIds.has(txId) ? "checked" : ""}></td>
              <td>${ofEscapeHtml(ofFormatDate(transaction.date))}</td>
              <td style="text-align:left;font-weight:600">
                ${ofEscapeHtml(transaction.description || "Sem descrição")}
                ${transaction.category
            ? `<div style="font-size:11px;color:var(--muted);font-weight:400">${ofEscapeHtml(transaction.category)}</div>`
            : ""
          }
                ${transaction.cashflow_ignore
            ? `<div style="font-size:11px;color:#f0a93c;font-weight:600;margin-top:4px">${ofEscapeHtml(transaction.cashflow_ignore_reason)}</div>`
            : ""
          }
              </td>
              <td style="text-align:left;font-size:12px">
                ${ofRenderOriginCell(transaction)}
              </td>
              <td>${ofEscapeHtml(accountName)}</td>
              <td>${ofEscapeHtml(typeLabel)}</td>
              <td>${ofCashflowBadge(transaction)}</td>
              <td>${ofClusterBadge(transaction)}</td>
              <td class="${ofClassValue(transaction.cashflow_ignore ? amount : effectiveAmount)}" style="font-weight:700">
                ${ofFormatCurrency(amount, currency)}
                ${transaction.cashflow_ignore
            ? `<div style="font-size:11px;color:var(--muted);font-weight:400">não entra no fluxo</div>`
            : ""
          }
              </td>
            </tr>
          `;
      })
      .join("")}
    </tbody>
  `;
}

function ofRenderNatureTable(transactions) {
  const table = document.getElementById("p0-nat-table");
  if (!table) return;

  const totals = {
    FCO: 0,
    FCI: 0,
    FCF: 0,
  };

  let ignoredCount = 0;
  const ignoredTransactions = [];

  for (const transaction of transactions) {
    if (transaction.cashflow_ignore) {
      ignoredCount += 1;
      ignoredTransactions.push(transaction);
      continue;
    }

    const type = transaction.cashflow_type || "FCO";

    if (totals[type] === undefined) {
      totals.FCO += ofEffectiveAmount(transaction);
    } else {
      totals[type] += ofEffectiveAmount(transaction);
    }
  }

  const totalNet = totals.FCO + totals.FCI + totals.FCF;
  const currency = transactions[0]?.currency_code || "BRL";

  const rows = ["FCO", "FCI", "FCF"]
    .map((type) => {
      const config = OF_CASHFLOW_TYPES[type];

      return `
        <tr>
          <td>
            <span class="dot" style="background:${config.color}"></span>
            ${ofEscapeHtml(config.label)}
          </td>
          <td class="${ofClassValue(totals[type])}">
            ${ofFormatSignedCurrency(totals[type], currency, true)}
          </td>
        </tr>
      `;
    })
    .join("");

  table.innerHTML = `
    <thead>
      <tr>
        <th>Natureza</th>
        <th>Período selecionado</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td>Líquido Total</td>
        <td class="${ofClassValue(totalNet)}">${ofFormatSignedCurrency(totalNet, currency, true)}</td>
      </tr>
      ${ignoredCount
      ? `
            <tr id="natIgnoredRow" style="cursor:pointer" title="Clique para ver e classificar as transações ignoradas">
              <td>
                <span class="dot" style="background:${OF_CASHFLOW_TYPES.IGNORAR.color}"></span>
                Ignoradas por regra
              </td>
              <td style="color:var(--muted)">${ignoredCount} transação(ões) ›</td>
            </tr>
          `
      : ""
    }
    </tbody>
  `;

  if (ignoredCount) {
    document.getElementById("natIgnoredRow")?.addEventListener("click", () => {
      ofOpenIgnoredTxListModal(ignoredTransactions);
    });
  }
}

function ofBuildEstimatedBalanceSeries(accounts, transactions, buckets, granularity = "month") {
  const currentBalance = ofCashBalance(accounts);

  const movementByBucket = new Map();

  for (const transaction of transactions) {
    const bucketKey = ofGetBucketKeyForDate(transaction.date, granularity);
    if (!bucketKey) continue;

    movementByBucket.set(
      bucketKey,
      (movementByBucket.get(bucketKey) || 0) + ofEffectiveAmount(transaction)
    );
  }

  const balances = [];
  let runningBalance = currentBalance;

  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    const bucketKey = buckets[i];

    balances[i] = runningBalance;
    runningBalance -= movementByBucket.get(bucketKey) || 0;
  }

  return {
    balances,
    movements: buckets.map((bucketKey) => movementByBucket.get(bucketKey) || 0),
  };
}

function ofRenderBalanceChart(accounts, chartTransactions) {
  const canvas = document.getElementById("c-p0-saldo");
  // Clear the overlay BEFORE the Chart-availability check — bailing while it
  // was still up (e.g. the Chart.js CDN failed to load) left a permanent
  // blank panel with no way to recover short of switching tabs.
  ofSetChartLoading("c-p0-saldo", false);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    ofShowChartUnavailable("c-p0-saldo", "Não foi possível carregar a biblioteca de gráficos. Os valores acima continuam corretos — recarregue a página para tentar de novo.");
    return;
  }
  ofClearChartUnavailable("c-p0-saldo");

  ofDestroyChartById("c-p0-saldo");

  const { from, to } = ofGetDateRange();
  const { granularity, keys: buckets } = ofGetChartBuckets(from, to);
  const labels = buckets.map((key) => ofFormatBucketLabel(key, granularity));
  const currency = accounts[0]?.currency_code || chartTransactions[0]?.currency_code || "BRL";
  const series = ofBuildEstimatedBalanceSeries(accounts, chartTransactions, buckets, granularity);

  new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Saldo consolidado",
          data: series.balances,
          borderColor: "#9b86fb",
          backgroundColor: "rgba(155,134,251,.22)",
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: series.balances.map((value) => (value >= 0 ? "#2dd4a0" : "#ff6b6b")),
          fill: true,
          tension: 0.35,
        },
        {
          label: "Movimentação mensal",
          data: series.movements,
          borderColor: "#2dd4a0",
          backgroundColor: "rgba(45,212,160,.14)",
          borderWidth: 1.5,
          pointRadius: 2,
          fill: false,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            boxWidth: 10,
            color: "#9aa0b4",
          },
        },
        tooltip: {
          backgroundColor: "#1b1d27",
          borderColor: "rgba(255,255,255,.12)",
          borderWidth: 1,
          titleColor: "#f3f4f7",
          bodyColor: "#cfd2dc",
          padding: 10,
          callbacks: {
            label: (context) => `${context.dataset.label}: ${ofFormatCurrency(context.raw, currency)}`,
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: "rgba(255,255,255,.07)",
          },
          ticks: {
            maxRotation: 45,
            color: "#9aa0b4",
          },
        },
        y: {
          grid: {
            color: "rgba(255,255,255,.07)",
          },
          ticks: {
            color: "#9aa0b4",
            callback: (value) => ofFormatCurrency(value, currency, true),
          },
        },
      },
    },
  });
}

// Draws each bar's total just past its end. A local (per-chart) Chart.js
// plugin — scoped to this chart instance via options.plugins, not
// Chart.register — so it never leaks into other charts on the page.
function ofBarEndLabelPlugin(currency) {
  return {
    id: "ofBarEndLabel",
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillStyle = "#cfd2dc";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      meta.data.forEach((bar, i) => {
        const value = chart.data.datasets[0].data[i];
        // Spacer rows carry no value and exist only to open a gap — writing
        // "R$ 0,00" next to an invisible bar would read as real data.
        if (!value) return;
        ctx.fillText(ofFormatCurrency(value, currency), bar.x + 8, bar.y);
      });
      ctx.restore();
    },
  };
}

// The open cluster and the path taken into it. Each entry narrows the span:
// [{granularity:'month', from, to}, {granularity:'week', from, to}, ...]
let _ofClusterDrill = null;

function ofShowClusterDetail(label) {
  const wrap = document.getElementById("p0ClusterDetail");
  if (!wrap) return;

  // A parent cluster's bar opens its children first — a click on one of
  // those re-enters this same function with the child's label, which has no
  // entry in _ofClusterChildrenByLabel, so it falls through to the normal
  // time-based drill below.
  const children = _ofClusterChildrenByLabel.get(label);
  if (children && children.length) {
    _ofClusterDrill = { label, isChildrenView: true, children };
    wrap.style.display = "";
    ofRenderClusterDrill();
    return;
  }

  const { from, to } = ofGetDateRange();
  const transactions = _ofClusterTxByLabel.get(label) || [];
  const parentLabel = _ofClusterParentByLabel.get(label) || null;

  _ofClusterDrill = {
    label,
    parentLabel,
    transactions,
    path: [{ granularity: ofDrillGranularityForSpan(from, to), from, to }],
  };

  wrap.style.display = "";
  ofRenderClusterDrill();
}

function ofClusterDrillDown(bucketKey) {
  if (!_ofClusterDrill) return;

  const level = _ofClusterDrill.path[_ofClusterDrill.path.length - 1];
  const buckets = ofDrillBuckets(
    _ofClusterDrill.transactions,
    level.granularity,
    level.from,
    level.to
  );
  const bucket = buckets.find((b) => b.key === bucketKey);
  if (!bucket) return;

  const next = ofDrillNextGranularity(level.granularity);
  // Already at day level: there is nothing finer to group by, so the click
  // opens the transactions themselves rather than another chart.
  if (!next) {
    _ofClusterDrill.leaf = bucket;
  } else {
    _ofClusterDrill.leaf = null;
    _ofClusterDrill.path.push({ granularity: next, from: bucket.from, to: bucket.to });
  }

  ofRenderClusterDrill();
}

function ofClusterDrillTo(depth) {
  if (!_ofClusterDrill) return;
  _ofClusterDrill.leaf = null;
  _ofClusterDrill.path = _ofClusterDrill.path.slice(0, depth + 1);
  ofRenderClusterDrill();
}

const OF_DRILL_LEVEL_LABEL = { month: "meses", week: "semanas", day: "dias" };

// The first thing a parent cluster's bar opens: one row per child cluster,
// so the user picks which sub-cluster to drill into before the usual
// time-based breakdown takes over.
function ofRenderClusterChildrenView() {
  const title = document.getElementById("p0ClusterDetailTitle");
  const body = document.getElementById("p0ClusterDetailBody");
  const { label, children } = _ofClusterDrill;

  if (title) title.textContent = label;

  const max = children.reduce((m, [, entry]) => Math.max(m, entry.total), 0);
  const currency = _ofClusterCurrentCurrency;

  body.innerHTML = `
    <div style="margin-bottom:12px;font-size:12.5px"><span style="color:var(--ink);font-weight:600">Período</span></div>
    <div class="cs" style="margin-bottom:10px">Clique em um subcluster para ver o detalhe</div>
    <table class="saldo-table">
      <thead>
        <tr>
          <th style="text-align:left">Subcluster</th>
          <th style="text-align:left;width:45%">Participação</th>
          <th>Transações</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${children.map(([childLabel, entry]) => {
          const pct = max > 0 ? (entry.total / max) * 100 : 0;
          return `
            <tr data-drill-child="${ofEscapeHtml(childLabel)}" style="cursor:pointer">
              <td style="text-align:left;font-weight:600">${ofEscapeHtml(childLabel)}</td>
              <td style="text-align:left">
                <div style="background:rgba(91,157,255,.18);border-radius:5px;height:16px;width:100%">
                  <div style="background:#5b9dff;height:100%;border-radius:5px;width:${pct.toFixed(1)}%"></div>
                </div>
              </td>
              <td>${entry.count}</td>
              <td style="font-weight:700">${ofFormatCurrency(entry.total, currency)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  ofBindClusterDrillEvents();
}

function ofRenderClusterDrill() {
  const title = document.getElementById("p0ClusterDetailTitle");
  const body = document.getElementById("p0ClusterDetailBody");
  if (!_ofClusterDrill || !body) return;

  if (_ofClusterDrill.isChildrenView) {
    ofRenderClusterChildrenView();
    return;
  }

  const { label, transactions, path, leaf, parentLabel } = _ofClusterDrill;
  const level = path[path.length - 1];

  if (title) title.textContent = label;

  // Breadcrumb: every level stays clickable so the user can jump back out
  // without collapsing the panel and starting over. A child cluster gets an
  // extra leading crumb back to its parent's children list.
  const parentCrumb = parentLabel
    ? `<a href="#" data-drill-parent="1" style="color:var(--accent);text-decoration:none">${ofEscapeHtml(parentLabel)}</a><span style="color:var(--muted);margin:0 6px">›</span>`
    : "";
  const crumbs = parentCrumb + path
    .map((step, index) => {
      const text =
        index === 0
          ? "Período"
          : `${ofFormatDate(step.from)} – ${ofFormatDate(step.to)}`;
      const isLast = index === path.length - 1 && !leaf;
      return isLast
        ? `<span style="color:var(--ink);font-weight:600">${ofEscapeHtml(text)}</span>`
        : `<a href="#" data-drill-to="${index}" style="color:var(--accent);text-decoration:none">${ofEscapeHtml(text)}</a>`;
    })
    .join(`<span style="color:var(--muted);margin:0 6px">›</span>`);

  const leafCrumb = leaf
    ? `<span style="color:var(--muted);margin:0 6px">›</span><span style="color:var(--ink);font-weight:600">${ofEscapeHtml(leaf.label)}</span>`
    : "";

  if (leaf) {
    body.innerHTML = `
      <div style="margin-bottom:12px;font-size:12.5px">${crumbs}${leafCrumb}</div>
      <div class="cs" style="margin-bottom:8px">${leaf.count} transação(ões) em ${ofEscapeHtml(leaf.label)}</div>
      <div style="max-height:400px;overflow:auto">
        <table class="saldo-table" id="p0ClusterDetailTable"></table>
      </div>
    `;
    ofRenderClusterDetailTable(leaf.transactions);
    ofBindClusterDrillEvents();
    return;
  }

  const buckets = ofDrillBuckets(transactions, level.granularity, level.from, level.to);
  const max = buckets.reduce((m, b) => Math.max(m, b.total), 0);
  const currency = transactions[0]?.currency_code || "BRL";
  const next = ofDrillNextGranularity(level.granularity);
  const hint = next
    ? `Clique em uma linha para abrir em ${OF_DRILL_LEVEL_LABEL[next]}`
    : "Clique em um dia para ver as transações";
  // Match the bar chart's own green-vs-blue color split here too, so
  // drilling in doesn't suddenly switch back to the "supplier" blue.
  const isGreen = label === ENTRADAS_ROW_LABEL || label === TRANSFER_IN_LABEL;
  const barTrackColor = isGreen ? "rgba(45,212,160,.18)" : "rgba(91,157,255,.18)";
  const barFillColor = isGreen ? "#2dd4a0" : "#5b9dff";

  body.innerHTML = `
    <div style="margin-bottom:12px;font-size:12.5px">${crumbs}</div>
    <div class="cs" style="margin-bottom:10px">${ofEscapeHtml(hint)}</div>
    <table class="saldo-table">
      <thead>
        <tr>
          <th style="text-align:left">${ofEscapeHtml(level.granularity === "month" ? "Mês" : level.granularity === "week" ? "Semana" : "Dia")}</th>
          <th style="text-align:left;width:45%">Participação</th>
          <th>Transações</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${buckets.map((bucket) => {
          const pct = max > 0 ? (bucket.total / max) * 100 : 0;
          const dim = bucket.count === 0 ? "opacity:.45;" : "";
          return `
            <tr data-drill-key="${ofEscapeHtml(bucket.key)}" style="cursor:${bucket.count ? "pointer" : "default"};${dim}">
              <td style="text-align:left;font-weight:600">${ofEscapeHtml(bucket.label)}</td>
              <td style="text-align:left">
                <div style="background:${barTrackColor};border-radius:5px;height:16px;width:100%">
                  <div style="background:${barFillColor};height:100%;border-radius:5px;width:${pct.toFixed(1)}%"></div>
                </div>
              </td>
              <td>${bucket.count}</td>
              <td style="font-weight:700">${ofFormatCurrency(bucket.total, currency)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  ofBindClusterDrillEvents();
}

function ofBindClusterDrillEvents() {
  const body = document.getElementById("p0ClusterDetailBody");
  if (!body || body.dataset.drillBound === "true") return;
  body.dataset.drillBound = "true";

  // One delegated listener on the container, so it survives every innerHTML
  // rewrite the drill-down does instead of being rebound per level.
  body.addEventListener("click", (event) => {
    const parentCrumb = event.target.closest("[data-drill-parent]");
    if (parentCrumb) {
      event.preventDefault();
      ofShowClusterDetail(_ofClusterDrill.parentLabel);
      return;
    }

    const crumb = event.target.closest("[data-drill-to]");
    if (crumb) {
      event.preventDefault();
      ofClusterDrillTo(Number(crumb.dataset.drillTo));
      return;
    }

    const childRow = event.target.closest("[data-drill-child]");
    if (childRow) {
      ofShowClusterDetail(childRow.dataset.drillChild);
      return;
    }

    const row = event.target.closest("[data-drill-key]");
    if (row) ofClusterDrillDown(row.dataset.drillKey);
  });
}

function ofRenderClusterDistribution(distRows, currency) {
  const canvas = document.getElementById("c-p0-cluster");
  ofSetChartLoading("c-p0-cluster", false);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    ofShowChartUnavailable("c-p0-cluster", "Não foi possível carregar a biblioteca de gráficos. Os valores acima continuam corretos — recarregue a página para tentar de novo.");
    return;
  }
  ofClearChartUnavailable("c-p0-cluster");

  ofDestroyChartById("c-p0-cluster");
  // Every cluster with movement in the period gets a bar — silently truncating
  // to a top-N here would make "sumiu um cluster" look like a data bug when
  // it was actually just this chart hiding rows. The container grows with the
  // row count instead of cramming everything into a fixed height.
  const top = distRows;
  const container = canvas.parentElement;
  if (container) {
    container.style.height = `${Math.max(340, top.length * 28 + 40)}px`;
  }
  const maxTotal = top.reduce((max, [, entry]) => Math.max(max, entry.total), 0);
  const isGreenRow = (label) => label === ENTRADAS_ROW_LABEL || label === TRANSFER_IN_LABEL;

  new Chart(canvas, {
    type: "bar",
    data: {
      labels: top.map(([label]) => label),
      datasets: [{
        label: "Total por cluster",
        data: top.map(([, entry]) => entry.total),
        backgroundColor: top.map(([label]) => isGreenRow(label) ? "rgba(45,212,160,.55)" : "rgba(91,157,255,.55)"),
        borderColor: top.map(([label]) => isGreenRow(label) ? "#2dd4a0" : "#5b9dff"),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    plugins: [ofBarEndLabelPlugin(currency)],
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const [label] = top[elements[0].index];
        if (label === CLUSTER_SPACER_LABEL) return;
        ofShowClusterDetail(label);
      },
      onHover: (evt, elements) => {
        const label = elements.length ? top[elements[0].index]?.[0] : null;
        evt.native.target.style.cursor = label && label !== CLUSTER_SPACER_LABEL ? "pointer" : "default";
      },
      layout: {
        padding: { right: 90 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1b1d27",
          borderColor: "rgba(255,255,255,.12)",
          borderWidth: 1,
          titleColor: "#f3f4f7",
          bodyColor: "#cfd2dc",
          padding: 10,
          callbacks: {
            label: (context) => ofFormatCurrency(context.raw, currency),
          },
        },
      },
      scales: {
        x: {
          suggestedMax: maxTotal * 1.25,
          grid: { color: "rgba(255,255,255,.07)" },
          ticks: { color: "#9aa0b4", callback: (value) => ofFormatCurrency(value, currency, true) },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#9aa0b4" },
        },
      },
    },
  });
}

// ── Cluster drill-down ──────────────────────────────────────────────────────
// Clicking a cluster bar opens that cluster broken down over time, and each
// level can be opened to reveal the next one down: months → weeks → days →
// the individual transactions.
//
// The starting level is derived from the selected period rather than fixed, so
// the first thing shown is always at a useful resolution: a year opens on
// months, a month opens on weeks, a week opens straight on days.
//
// Everything here works over transactions already in memory. No level, however
// deep, costs a query.

const OF_DRILL_ORDER = ["month", "week", "day"];

// Written out rather than taken from toLocaleDateString: pt-BR renders short
// months as "jan." and month+year as "jan. de 26" depending on the browser, and
// the abbreviations differ between engines. These are the labels the rest of
// the product uses, and they render identically everywhere.
const OF_MONTHS_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const OF_MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const OF_WEEKDAYS_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// "01 jan 26" — compact enough to sit inside a week range without wrapping.
function ofLabelDayShort(date) {
  return `${String(date.getDate()).padStart(2, "0")} ${OF_MONTHS_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

// "01 jan 2026 [segunda]" — the weekday is what makes a daily row readable at a
// glance, since a bare date says nothing about whether a gap is a weekend.
function ofLabelDayFull(date) {
  return `${String(date.getDate()).padStart(2, "0")} ${OF_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()} [${OF_WEEKDAYS_LONG[date.getDay()]}]`;
}

function ofLabelMonth(date) {
  return `${OF_MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

function ofLabelWeek(index, start, end) {
  return `Semana ${index} · [${ofLabelDayShort(start)} – ${ofLabelDayShort(end)}]`;
}

// Which level to open a span at. The thresholds overlap deliberately: a
// 45-day span is still better read as weeks than as two lopsided months.
//
// `from`/`to` arrive as "YYYY-MM-DD" strings, so they are parsed before any
// arithmetic. Subtracting the strings directly yields NaN, which would fail
// every threshold and silently settle on the finest level.
function ofDrillGranularityForSpan(from, to) {
  const start = ofParseDateInputValue(from);
  const end = ofParseDateInputValue(to);
  if (!start || !end) return "month";

  const days = Math.round((end - start) / 86400000) + 1;
  if (days > 62) return "month";
  if (days > 8) return "week";
  return "day";
}

function ofDrillNextGranularity(granularity) {
  const index = OF_DRILL_ORDER.indexOf(granularity);
  return index >= 0 && index < OF_DRILL_ORDER.length - 1 ? OF_DRILL_ORDER[index + 1] : null;
}

// Groups a cluster's transactions into buckets of the given granularity,
// bounded by the level's own span. Buckets with no movement are kept: a month
// where nothing was paid is information, and dropping it would make the chart
// imply continuity that isn't there.
function ofDrillBuckets(transactions, granularity, from, to) {
  const buckets = new Map();
  const rangeStart = ofParseDateInputValue(from);
  const rangeEnd = ofParseDateInputValue(to);
  if (!rangeStart || !rangeEnd) return [];

  // Bucket bounds are stored as "YYYY-MM-DD" strings, matching how the rest of
  // this file carries dates: transaction rows hold that format, so membership
  // is a plain lexicographic comparison, and the bounds can be handed straight
  // back to ofSetDateRange or ofFormatDate without conversion.
  const addBucket = (key, label, start, end) => {
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label,
        from: ofToDateInputValue(start),
        to: ofToDateInputValue(end),
        total: 0,
        count: 0,
        transactions: [],
      });
    }
  };

  const cursor = new Date(rangeStart);
  if (granularity === "month") {
    cursor.setDate(1);
    while (cursor <= rangeEnd) {
      const start = ofStartOfMonth(cursor);
      const end = ofEndOfMonth(cursor);
      addBucket(
        `${cursor.getFullYear()}-${cursor.getMonth()}`,
        ofLabelMonth(cursor),
        start,
        end
      );
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else if (granularity === "week") {
    let weekStart = ofStartOfWeek(cursor);
    let index = 1;
    while (weekStart <= rangeEnd) {
      const weekEnd = ofEndOfWeek(weekStart);
      addBucket(
        ofToDateInputValue(weekStart),
        ofLabelWeek(index, weekStart, weekEnd),
        weekStart,
        weekEnd
      );
      weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
      index += 1;
    }
  } else {
    while (cursor <= rangeEnd) {
      const day = new Date(cursor);
      addBucket(ofToDateInputValue(day), ofLabelDayFull(day), day, day);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // ISO "YYYY-MM-DD" sorts and compares correctly as plain text, which is why
  // the whole file leans on string dates rather than converting back and forth.
  const ordered = [...buckets.values()].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  for (const transaction of transactions) {
    const date = String(transaction.date || "").slice(0, 10);
    if (!date) continue;
    const bucket = ordered.find((b) => date >= b.from && date <= b.to);
    if (!bucket) continue;
    bucket.total += Math.abs(ofEffectiveAmount(transaction));
    bucket.count += 1;
    bucket.transactions.push(transaction);
  }

  return ordered;
}

function ofRenderClusterDetailTable(transactions) {
  const table = document.getElementById("p0ClusterDetailTable");
  if (!table) return;

  if (!transactions.length) {
    table.innerHTML = `<tbody><tr><td style="text-align:center;color:var(--muted);padding:18px">Nenhuma transação encontrada para este cluster.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead style="position:sticky;top:0;z-index:3;background:var(--card)">
      <tr>
        <th style="text-align:left">Banco</th>
        <th>Data</th>
        <th style="text-align:left">Origem/Destino</th>
        <th>Valor</th>
      </tr>
    </thead>
    <tbody>
      ${transactions.map((transaction) => {
        const bankName = _ofClusterBankNameByAccountId.get(ofGetTransactionAccountId(transaction)) || "—";
        const amount = Number(transaction.amount || 0);
        const currency = transaction.currency_code || "BRL";
        return `
          <tr>
            <td style="text-align:left">${ofEscapeHtml(bankName)}</td>
            <td>${ofEscapeHtml(ofFormatDate(transaction.date))}</td>
            <td style="text-align:left;font-size:12px">${ofRenderOriginCell(transaction)}</td>
            <td class="${ofClassValue(amount)}" style="font-weight:700">${ofFormatCurrency(amount, currency)}</td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
}

// Populated on every paintOpenFinanceClusterDistribution call so
// ofShowClusterDetail (triggered by a chart bar click) can look up the
// underlying transactions/bank names without re-fetching.
const _ofClusterTxByLabel = new Map();
let _ofClusterBankNameByAccountId = new Map();

// Cluster hierarchy support: a leaf cluster's parent name (when it has one),
// and — the inverse — each parent's list of [childLabel, {count,total}]
// entries, both rebuilt on every paintOpenFinanceClusterDistribution call so
// the top-level chart can roll leaves up into their parent's bar and the
// drill-down can offer a "children of this parent" step before falling back
// to the existing time-based breakdown.
const _ofClusterParentByLabel = new Map();
const _ofClusterChildrenByLabel = new Map();
let _ofClusterCurrentCurrency = "BRL";

// Pinned pseudo-cluster row for inflows on "Distribuição por cluster" — not a
// real cluster_categories value (the server uses singular "Entrada" as the
// cluster_label for inflow transactions), so it can't collide with one.
const ENTRADAS_ROW_LABEL = "Entradas";

// Espelha groupInflowsByLabel de src/domain/inflow-breakdown.js, que é onde há
// teste. Null while every inflow is still the legacy "Entrada".
const OF_LEGACY_INFLOW_LABEL = "Entrada";
const OF_INFLOW_CHILD_PREFIX = "Entradas › ";
function ofGroupInflowsByLabel(inflows, amountOf) {
  const byCluster = new Map();
  for (const t of inflows) {
    const cluster = String(t.cluster_label ?? "").trim() || OF_LEGACY_INFLOW_LABEL;
    if (!byCluster.has(cluster)) byCluster.set(cluster, []);
    byCluster.get(cluster).push(t);
  }
  if (byCluster.size === 0) return null;
  if (byCluster.size === 1 && byCluster.has(OF_LEGACY_INFLOW_LABEL)) return null;
  return [...byCluster.entries()]
    .map(([cluster, transactions]) => ({
      label: OF_INFLOW_CHILD_PREFIX + cluster,
      cluster,
      transactions,
      count: transactions.length,
      total: transactions.reduce((sum, t) => sum + Math.abs(amountOf(t)), 0),
    }))
    .sort((a, b) => b.total - a.total);
}

// Transfers between the org's own accounts are excluded from cash flow
// entirely (both legs are expected to cancel out to zero) — these two pinned
// rows let the client visually confirm that on this chart: a green bar for
// the credit leg and a blue bar for the debit leg, which should always show
// the same total.
//
// Both detectors feed this same pair of rows on purpose. Which rule caught a
// given leg is an implementation detail, and the two legs of a single
// transfer routinely land in different rules: the same-document/Pluggy
// -category check runs ahead of the amount/date pairing heuristic (see
// ofClassifyTransactions), so it regularly claims one leg while the pairing
// claims the other. Splitting these rows by detector therefore left both
// pairs permanently unbalanced — which defeats the only reason they're on
// this chart.
const TRANSFER_IN_LABEL = "Transferência entre contas próprias (entrada)";
const TRANSFER_OUT_LABEL = "Transferência entre contas próprias (saída)";

// A blank, zero-height row used only to open a gap between the transfer pair
// and everything below it. Transfers are a reconciliation aid, not a spending
// category, and sitting them flush against the supplier clusters invites
// reading them as one more line of the same list.
const CLUSTER_SPACER_LABEL = " ";
const OF_INTERNAL_TRANSFER_SOURCES = new Set([
  "same_person_transfer_rule",
  "internal_transfer_pair_rule",
]);

async function paintOpenFinanceClusterDistribution(session) {
  const myGeneration = ofNextRenderGeneration("paintOpenFinanceClusterDistribution");
  const canvas = document.getElementById("c-p0-cluster");
  if (!canvas) return;

  try {
    const { from, to } = ofGetDateRange();
    const { transactions: allTransactions, accounts, pluggyItemsById } = await ofGetAllClassifiedTransactions(session);
    await ofLoadClassificationCategories(session.orgId);
    if (ofIsStaleRender("paintOpenFinanceClusterDistribution", myGeneration)) {
      // A newer pass has already taken over — don't leave this chart's
      // spinner stuck forever just because this stale pass never reaches
      // its own render call. The newer pass's own ofRenderLoading()/render
      // call will show/clear it correctly on its own.
      ofSetChartLoading("c-p0-cluster", false);
      return;
    }
    const transactions = allTransactions.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
    // This chart is explicitly scoped to supplier clusters ("por cluster de
    // fornecedor" in its own subtitle), so inflows — which the server leaves
    // tagged cluster_label:"Entrada" rather than guessing a supplier for
    // money coming in — aren't grouped in among the real supplier clusters
    // below. They still get their own pinned, distinctly colored row (see
    // ENTRADAS_ROW_LABEL below) so the total is visible and clickable
    // straight from this chart, without being ranked against suppliers by
    // size (an inflow total usually dwarfs any single supplier's spend).
    const effectiveAll = transactions.filter(ofIsEffectiveTransaction);
    // Direction by the cash amount, not Pluggy's raw sign: a card purchase is
    // positive on the card but money out.
    const saidaTxs = effectiveAll.filter((t) => ofEffectiveAmount(t) < 0);
    const entradaTxs = effectiveAll.filter((t) => ofEffectiveAmount(t) >= 0);

    _ofClusterBankNameByAccountId = ofBuildBankNameByAccountId(accounts, pluggyItemsById);
    _ofClusterTxByLabel.clear();
    _ofClusterParentByLabel.clear();
    _ofClusterChildrenByLabel.clear();

    const clusterCategoryById = new Map((_ofClusterCategories || []).map((c) => [c.id, c]));

    // Leaf-level totals first — identical to the flat behaviour this chart
    // always had. Each leaf's parent (if any) is resolved from the
    // transaction's own cluster_category_id, not from cluster_label text
    // matching, since names aren't guaranteed unique/stable the way ids are.
    const leafByLabel = new Map();
    for (const t of saidaTxs) {
      const label = t.cluster_label || "Sem cluster";
      const entry = leafByLabel.get(label) || { count: 0, total: 0 };
      entry.count += 1;
      entry.total += Math.abs(ofEffectiveAmount(t));
      leafByLabel.set(label, entry);

      if (!_ofClusterTxByLabel.has(label)) _ofClusterTxByLabel.set(label, []);
      _ofClusterTxByLabel.get(label).push(t);

      if (!_ofClusterParentByLabel.has(label) && t.cluster_category_id) {
        const cat = clusterCategoryById.get(t.cluster_category_id);
        const parentCat = cat?.parent_cluster_id ? clusterCategoryById.get(cat.parent_cluster_id) : null;
        if (parentCat) _ofClusterParentByLabel.set(label, parentCat.name);
      }
    }

    // Second pass: leaves that belong to a parent are rolled up into the
    // parent's bar for the top-level chart; leaves without one keep their
    // own bar exactly as before. _ofClusterChildrenByLabel records the
    // rolled-up leaves per parent so a click on the parent's bar can offer
    // them as a "children of this cluster" step before the usual time drill.
    const byCluster = new Map();
    for (const [label, entry] of leafByLabel) {
      const parentName = _ofClusterParentByLabel.get(label);
      const topLabel = parentName || label;
      const topEntry = byCluster.get(topLabel) || { count: 0, total: 0 };
      topEntry.count += entry.count;
      topEntry.total += entry.total;
      byCluster.set(topLabel, topEntry);

      if (parentName) {
        if (!_ofClusterChildrenByLabel.has(parentName)) _ofClusterChildrenByLabel.set(parentName, []);
        _ofClusterChildrenByLabel.get(parentName).push([label, entry]);
      }
    }
    for (const children of _ofClusterChildrenByLabel.values()) {
      children.sort((a, b) => b[1].total - a[1].total);
    }

    const distRows = [...byCluster.entries()].sort((a, b) => b[1].total - a[1].total);

    // Entradas usually dwarfs any single supplier cluster, which compresses
    // the x-axis and makes the actual supplier comparison harder to read —
    // the checkbox lets the user drop it back out to see saída proportions
    // at full resolution without losing the option to bring it back.
    const showEntradas = document.getElementById("ofClusterShowEntradas")?.checked ?? true;
    if (entradaTxs.length && showEntradas) {
      const entradaTotal = entradaTxs.reduce((sum, t) => sum + Math.abs(ofEffectiveAmount(t)), 0);
      _ofClusterTxByLabel.set(ENTRADAS_ROW_LABEL, entradaTxs);
      distRows.unshift([ENTRADAS_ROW_LABEL, { count: entradaTxs.length, total: entradaTotal }]);

      // Orgs whose inflows carry real clusters (organizations.inflow_cluster_label)
      // get the "Entradas" row opening into them, like a parent cluster opens
      // its children. Null for everyone else, so their chart is unchanged.
      const inflowGroups = ofGroupInflowsByLabel(entradaTxs, ofEffectiveAmount);
      if (inflowGroups) {
        _ofClusterChildrenByLabel.set(
          ENTRADAS_ROW_LABEL,
          inflowGroups.map((g) => [g.label, { count: g.count, total: g.total }])
        );
        for (const g of inflowGroups) {
          _ofClusterTxByLabel.set(g.label, g.transactions);
          _ofClusterParentByLabel.set(g.label, ENTRADAS_ROW_LABEL);
        }
      }
    }

    // Internal transfers are excluded from saída/entrada above (they never
    // reach effectiveAll — cashflow_ignore is true for both legs), so they're
    // pulled from the full period's transactions here instead, split by sign
    // into a credit and a debit row. Effective amount is always 0 for these,
    // so the raw amount is what shows the gross value of each leg. See
    // OF_INTERNAL_TRANSFER_SOURCES on why both detectors share these rows.
    //
    // These go in last so they land at the very top of the chart, above even
    // Entradas, followed by a blank spacer row. They answer a different
    // question from everything below — "did the two legs cancel out?" rather
    // than "where did the money go?" — so they are set apart instead of
    // competing for rank in the same list.
    const showTransfers = document.getElementById("ofClusterShowTransfers")?.checked ?? true;
    const internalTransferTxs = showTransfers
      ? transactions.filter((t) => OF_INTERNAL_TRANSFER_SOURCES.has(t.cashflow_source))
      : [];
    if (internalTransferTxs.length) {
      const creditTxs = internalTransferTxs.filter((t) => Number(t.amount) >= 0);
      const debitTxs = internalTransferTxs.filter((t) => Number(t.amount) < 0);

      if (creditTxs.length || debitTxs.length) {
        distRows.unshift([CLUSTER_SPACER_LABEL, { count: 0, total: 0 }]);
      }
      if (debitTxs.length) {
        const debitTotal = debitTxs.reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
        _ofClusterTxByLabel.set(TRANSFER_OUT_LABEL, debitTxs);
        distRows.unshift([TRANSFER_OUT_LABEL, { count: debitTxs.length, total: debitTotal }]);
      }
      if (creditTxs.length) {
        const creditTotal = creditTxs.reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
        _ofClusterTxByLabel.set(TRANSFER_IN_LABEL, creditTxs);
        distRows.unshift([TRANSFER_IN_LABEL, { count: creditTxs.length, total: creditTotal }]);
      }
    }

    const currency = effectiveAll[0]?.currency_code || "BRL";
    _ofClusterCurrentCurrency = currency;

    ofRenderClusterDistribution(distRows, currency);

    // The period changed under it — any previously shown cluster detail no
    // longer matches what's on screen, so collapse it rather than show stale rows.
    const detailWrap = document.getElementById("p0ClusterDetail");
    if (detailWrap) detailWrap.style.display = "none";
  } catch (err) {
    console.error("Erro ao carregar distribuição por cluster:", err);
    ofSetChartLoading("c-p0-cluster", false);
  }
}

async function paintOpenFinanceDashboard(session) {
  const myGeneration = ofNextRenderGeneration("paintOpenFinanceDashboard");
  const p0Kpis = document.getElementById("p0-kpis");
  const bankList = document.getElementById("bankList");
  const transactionsTable = document.getElementById("openFinanceTransactionsTable");

  if (!p0Kpis && !bankList && !transactionsTable) {
    return;
  }

  ofUpdatePeriodSub();
  ofRenderLoading();
  await ofUpdateDashboardSyncStatus(session);
  if (transactionsTable) await ofCheckClassificationJob(session);

  try {
    const { from, to } = ofGetDateRange();
    const { accounts, accountsById, pluggyItemsById, transactions: wideTransactions } =
      await ofGetAllClassifiedTransactions(session);

    // A newer render pass (e.g. a background classification resume finishing
    // and refreshing the tab) already took over while the fetch above was in
    // flight — let it own the DOM instead of overwriting it out of order.
    // Clear this function's own chart spinner rather than leaving it stuck;
    // the newer pass's own paintOpenFinanceDashboard call re-shows/clears it.
    if (ofIsStaleRender("paintOpenFinanceDashboard", myGeneration)) {
      ofSetChartLoading("c-p0-saldo", false);
      return;
    }

    if (!accounts.length) {
      ofRenderEmptyState();
      return;
    }

    // The org's whole transaction history is already cached (see
    // ofGetAllClassifiedTransactions) — slice it down to the selected period
    // and to the chart's bucket window (which mirrors the selected period,
    // not a fixed lookback) purely in memory, no network round-trip.
    const { granularity: chartGranularity, keys: chartBuckets } = ofGetChartBuckets(from, to);
    // Week bucket keys are already full "YYYY-MM-DD" dates; month bucket keys
    // are "YYYY-MM" and need "-01" appended to become the bucket's start date.
    const chartFrom = chartGranularity === "week" ? chartBuckets[0] : `${chartBuckets[0]}-01`;

    const transactions = wideTransactions.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
    const chartTransactions = wideTransactions.filter((t) => t.date >= chartFrom && (!to || t.date <= to));

    const accountsAsOf = ofComputeAccountsAsOf(accounts, wideTransactions, to);
    const accountsAsOfPeriodStart = from ? ofComputeAccountsAsOf(accounts, wideTransactions, ofDayBefore(from)) : null;

    ofRenderCashflowPendingBanner(transactions);
    ofRenderP0Kpis(accountsAsOf, transactions, accountsAsOfPeriodStart);
    ofRenderBankPosition(accountsAsOf, pluggyItemsById, transactions, accountsAsOfPeriodStart);
    ofRenderSummary(transactions);
    ofRenderTransactions(transactions, accountsById, pluggyItemsById);
    ofRenderNatureTable(transactions);
    ofRenderBalanceChart(accounts, chartTransactions);
  } catch (err) {
    console.error("Erro inesperado ao carregar Open Finance no dashboard:", err);
    ofRenderEmptyState();
  }
}

function ofGroupTransactionsByMonth(transactions, months, granularity = "month") {
  const grouped = new Map();

  months.forEach((monthKey) => {
    grouped.set(monthKey, {
      entradas: 0,
      saidas: 0,
      liquido: 0,
      count: 0,
    });
  });

  for (const transaction of transactions) {
    if (transaction.cashflow_ignore) continue;

    const monthKey = ofGetBucketKeyForDate(transaction.date, granularity);
    if (!monthKey || !grouped.has(monthKey)) continue;

    const amount = ofEffectiveAmount(transaction);
    const group = grouped.get(monthKey);

    if (amount > 0) group.entradas += amount;
    if (amount < 0) group.saidas += amount;

    group.liquido += amount;
    group.count += 1;
  }

  return months.map((monthKey) => ({
    monthKey,
    ...grouped.get(monthKey),
  }));
}

function ofGroupTransactionsByMonthAndNature(transactions, months, granularity = "month") {
  const grouped = new Map();

  months.forEach((monthKey) => {
    grouped.set(monthKey, {
      monthKey,
      FCO: 0,
      FCI: 0,
      FCF: 0,
      liquido: 0,
    });
  });

  for (const transaction of transactions) {
    if (transaction.cashflow_ignore) continue;

    const monthKey = ofGetBucketKeyForDate(transaction.date, granularity);
    if (!monthKey || !grouped.has(monthKey)) continue;

    const amount = ofEffectiveAmount(transaction);
    const type = ["FCO", "FCI", "FCF"].includes(transaction.cashflow_type)
      ? transaction.cashflow_type
      : "FCO";

    const group = grouped.get(monthKey);

    group[type] += amount;
    group.liquido += amount;
  }

  return months.map((monthKey) => grouped.get(monthKey));
}

function ofRenderEntradasSaidasChart(monthlyRows, currency = "BRL", granularity = "month") {
  const canvas = document.getElementById("c-p1-combo");
  ofSetChartLoading("c-p1-combo", false);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    ofShowChartUnavailable("c-p1-combo", "Não foi possível carregar a biblioteca de gráficos. Os valores acima continuam corretos — recarregue a página para tentar de novo.");
    return;
  }
  ofClearChartUnavailable("c-p1-combo");

  ofDestroyChartById("c-p1-combo");

  const labels = monthlyRows.map((row) => ofFormatBucketLabel(row.monthKey, granularity));

  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Entradas",
          data: monthlyRows.map((row) => row.entradas),
          backgroundColor: "#2dd4a0",
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "Saídas",
          data: monthlyRows.map((row) => Math.abs(row.saidas)),
          backgroundColor: "#ff8a5b",
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "Líquido",
          data: monthlyRows.map((row) => row.liquido),
          type: "line",
          borderColor: "#f3f4f7",
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: "#f3f4f7",
          tension: 0.3,
          yAxisID: "y2",
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "#1b1d27",
          borderColor: "rgba(255,255,255,.12)",
          borderWidth: 1,
          titleColor: "#f3f4f7",
          bodyColor: "#cfd2dc",
          padding: 10,
          callbacks: {
            label: (context) => {
              return `${context.dataset.label}: ${ofFormatCurrency(context.raw, currency)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: "rgba(255,255,255,.07)",
          },
          ticks: {
            maxRotation: 45,
            color: "#9aa0b4",
          },
        },
        y: {
          position: "left",
          grid: {
            color: "rgba(255,255,255,.07)",
          },
          ticks: {
            color: "#9aa0b4",
            callback: (value) => ofFormatCurrency(value, currency, true),
          },
        },
        y2: {
          position: "right",
          grid: {
            display: false,
          },
          ticks: {
            color: "#9aa0b4",
            callback: (value) => ofFormatCurrency(value, currency, true),
          },
        },
      },
    },
  });
}

function ofRenderFluxoNaturezaChart(monthlyRows, currency = "BRL", granularity = "month") {
  const canvas = document.getElementById("c-p1-dfc");
  ofSetChartLoading("c-p1-dfc", false);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    ofShowChartUnavailable("c-p1-dfc", "Não foi possível carregar a biblioteca de gráficos. Os valores acima continuam corretos — recarregue a página para tentar de novo.");
    return;
  }
  ofClearChartUnavailable("c-p1-dfc");

  ofDestroyChartById("c-p1-dfc");

  const labels = monthlyRows.map((row) => ofFormatBucketLabel(row.monthKey, granularity));

  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Operacional (FCO)",
          data: monthlyRows.map((row) => row.FCO),
          backgroundColor: OF_CASHFLOW_TYPES.FCO.color,
          borderRadius: 4,
        },
        {
          label: "Investimento (FCI)",
          data: monthlyRows.map((row) => row.FCI),
          backgroundColor: OF_CASHFLOW_TYPES.FCI.color,
          borderRadius: 4,
        },
        {
          label: "Financiamento (FCF)",
          data: monthlyRows.map((row) => row.FCF),
          backgroundColor: OF_CASHFLOW_TYPES.FCF.color,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            boxWidth: 10,
            color: "#9aa0b4",
          },
        },
        tooltip: {
          backgroundColor: "#1b1d27",
          borderColor: "rgba(255,255,255,.12)",
          borderWidth: 1,
          titleColor: "#f3f4f7",
          bodyColor: "#cfd2dc",
          padding: 10,
          callbacks: {
            label: (context) => {
              return `${context.dataset.label}: ${ofFormatCurrency(context.raw, currency)}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: {
            color: "rgba(255,255,255,.07)",
          },
          ticks: {
            maxRotation: 45,
            color: "#9aa0b4",
          },
        },
        y: {
          stacked: true,
          grid: {
            color: "rgba(255,255,255,.07)",
          },
          ticks: {
            color: "#9aa0b4",
            callback: (value) => ofFormatCurrency(value, currency, true),
          },
        },
      },
    },
  });
}

// Totals for the currently selected period — NOT a hardcoded calendar
// year-to-date. `transactions` arrives here already filtered to the
// dashboard's from/to range (see paintOpenFinanceEntradasSaidas), so this
// just sums what it's given instead of re-filtering to its own date logic.
function ofRenderEntradasSaidasResumo(transactions) {
  const line = document.getElementById("p1-ytd-line");
  if (!line) return;

  const effective = transactions.filter((transaction) => !transaction.cashflow_ignore);

  const totals = {
    FCO: 0,
    FCI: 0,
    FCF: 0,
  };

  effective.forEach((transaction) => {
    const type = ["FCO", "FCI", "FCF"].includes(transaction.cashflow_type)
      ? transaction.cashflow_type
      : "FCO";

    totals[type] += ofEffectiveAmount(transaction);
  });

  const total = totals.FCO + totals.FCI + totals.FCF;
  const ignoredCount = transactions.filter((transaction) => transaction.cashflow_ignore).length;
  const currency = effective[0]?.currency_code || transactions[0]?.currency_code || "BRL";

  line.innerHTML = `
    <em>FCO no período: ${ofFormatSignedCurrency(totals.FCO, currency, true)}</em>
    &nbsp;·&nbsp;
    <em>FCI no período: ${ofFormatSignedCurrency(totals.FCI, currency, true)}</em>
    &nbsp;·&nbsp;
    <em>FCF no período: ${ofFormatSignedCurrency(totals.FCF, currency, true)}</em>
    &nbsp;·&nbsp;
    <em>Líquido: ${ofFormatSignedCurrency(total, currency, true)}</em>
    ${ignoredCount
      ? `&nbsp;·&nbsp;<em>${ignoredCount} ignorada(s)</em>`
      : ""
    }
  `;
}

async function paintOpenFinanceEntradasSaidas(session) {
  const myGeneration = ofNextRenderGeneration("paintOpenFinanceEntradasSaidas");
  const comboCanvas = document.getElementById("c-p1-combo");
  const dfcCanvas = document.getElementById("c-p1-dfc");

  if (!comboCanvas && !dfcCanvas) {
    return;
  }

  try {
    ofUpdatePeriodSub();

    const { from, to } = ofGetDateRange();
    const { granularity, keys: months } = ofGetChartBuckets(from, to);
    const { accounts, accountsById, transactions: allTransactions } =
      await ofGetAllClassifiedTransactions(session);
    if (ofIsStaleRender("paintOpenFinanceEntradasSaidas", myGeneration)) {
      ofSetChartLoading("c-p1-combo", false);
      ofSetChartLoading("c-p1-dfc", false);
      return;
    }
    const transactions = allTransactions.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));

    const monthlyRows = ofGroupTransactionsByMonth(transactions, months, granularity);
    const monthlyNatureRows = ofGroupTransactionsByMonthAndNature(transactions, months, granularity);
    const currency = transactions[0]?.currency_code || accounts[0]?.currency_code || "BRL";

    ofRenderEntradasSaidasChart(monthlyRows, currency, granularity);
    ofRenderFluxoNaturezaChart(monthlyNatureRows, currency, granularity);
    ofRenderEntradasSaidasResumo(transactions);

    return { accounts, accountsById, transactions };
  } catch (err) {
    console.error("Erro ao carregar gráficos de Entradas & Saídas (Visão Geral):", err);
    ofSetChartLoading("c-p1-combo", false);
    ofSetChartLoading("c-p1-dfc", false);
  }
}

function ofProjStartOfWeek(date) {
  return ofStartOfWeek(date);
}

function ofProjStartOfNextWeek(date) {
  const start = ofProjStartOfWeek(date);
  return ofAddDays(start, 7);
}

function ofProjWeekKey(date) {
  const weekStart = ofProjStartOfWeek(date);
  return ofToDateInputValue(weekStart);
}

function ofProjWeekLabel(date) {
  const start = ofProjStartOfWeek(date);
  const end = ofAddDays(start, 6);

  return `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")} a ${String(end.getDate()).padStart(2, "0")}/${String(end.getMonth() + 1).padStart(2, "0")}`;
}

function ofProjBuildWeeks(firstWeekStart, totalWeeks = 13) {
  const weeks = [];

  for (let i = 0; i < totalWeeks; i += 1) {
    const start = ofAddDays(firstWeekStart, i * 7);
    const end = ofAddDays(start, 6);

    weeks.push({
      index: i + 1,
      start,
      end,
      start_date: ofToDateInputValue(start),
      end_date: ofToDateInputValue(end),
      label: `S+${i + 1}`,
      period: ofProjWeekLabel(start),
    });
  }

  return weeks;
}

function ofProjGroupHistoricalWeeks(transactions) {
  const grouped = new Map();

  for (const transaction of transactions) {
    if (!transaction.date || transaction.cashflow_ignore) continue;

    const date = new Date(`${transaction.date}T00:00:00`);
    const weekKey = ofProjWeekKey(date);
    const amount = ofEffectiveAmount(transaction);

    if (!grouped.has(weekKey)) {
      grouped.set(weekKey, {
        weekKey,
        entradas: 0,
        saidas: 0,
        liquido: 0,
        count: 0,
      });
    }

    const week = grouped.get(weekKey);

    if (amount > 0) week.entradas += amount;
    if (amount < 0) week.saidas += amount;

    week.liquido += amount;
    week.count += 1;
  }

  return [...grouped.values()];
}

function ofProjAverageWeeklyBase(historicalWeeks) {
  if (!historicalWeeks.length) {
    return {
      avgEntradas: 0,
      avgSaidas: 0,
      avgLiquido: 0,
      weeksCount: 0,
      transactionsCount: 0,
    };
  }

  const totals = historicalWeeks.reduce(
    (acc, week) => {
      acc.entradas += Number(week.entradas || 0);
      acc.saidas += Number(week.saidas || 0);
      acc.liquido += Number(week.liquido || 0);
      acc.count += Number(week.count || 0);
      return acc;
    },
    { entradas: 0, saidas: 0, liquido: 0, count: 0 }
  );

  const weeksCount = historicalWeeks.length;

  return {
    avgEntradas: totals.entradas / weeksCount,
    avgSaidas: totals.saidas / weeksCount,
    avgLiquido: totals.liquido / weeksCount,
    weeksCount,
    transactionsCount: totals.count,
  };
}

function ofProjBuildProjectionRows(accounts, weeks, base) {
  const startingBalance = ofCashBalance(accounts);

  let runningBalance = startingBalance;

  return weeks.map((week) => {
    const entradas = base.avgEntradas;
    const saidas = base.avgSaidas;
    const liquido = entradas + saidas;

    runningBalance += liquido;

    return {
      ...week,
      entradas,
      saidas,
      liquido,
      saldo_final: runningBalance,
    };
  });
}

function ofProjRenderChart(rows, currency = "BRL") {
  const canvas = document.getElementById("c-p2-rolling");
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    ofShowChartUnavailable("c-p2-rolling", "Não foi possível carregar a biblioteca de gráficos. Os valores acima continuam corretos — recarregue a página para tentar de novo.");
    return;
  }
  ofClearChartUnavailable("c-p2-rolling");

  ofDestroyChartById("c-p2-rolling");
  canvas.style.display = "";

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map((row) => row.label),
      datasets: [
        {
          label: "Entradas projetadas",
          data: rows.map((row) => row.entradas),
          backgroundColor: "#2dd4a0",
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "Saídas projetadas",
          data: rows.map((row) => Math.abs(row.saidas)),
          backgroundColor: "#ff8a5b",
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "Saldo projetado",
          data: rows.map((row) => row.saldo_final),
          type: "line",
          borderColor: "#5b9dff",
          backgroundColor: "rgba(91,157,255,.12)",
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: rows.map((row) =>
            row.saldo_final >= 0 ? "#2dd4a0" : "#ff6b6b"
          ),
          tension: 0.35,
          yAxisID: "y2",
          fill: true,
        },
        {
          label: "Piso temporário",
          data: rows.map(() => 0),
          type: "line",
          borderColor: "rgba(255,107,107,.65)",
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          yAxisID: "y2",
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1b1d27",
          borderColor: "rgba(255,255,255,.12)",
          borderWidth: 1,
          titleColor: "#f3f4f7",
          bodyColor: "#cfd2dc",
          padding: 10,
          callbacks: {
            afterTitle: (items) => {
              const row = rows[items[0].dataIndex];
              return row ? row.period : "";
            },
            label: (context) => {
              return `${context.dataset.label}: ${ofFormatCurrency(context.raw || 0, currency)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,.07)" },
          ticks: { color: "#9aa0b4" },
        },
        y: {
          position: "left",
          grid: { color: "rgba(255,255,255,.07)" },
          ticks: {
            color: "#9aa0b4",
            callback: (value) => ofFormatCurrency(value, currency, true),
          },
        },
        y2: {
          position: "right",
          grid: { display: false },
          ticks: {
            color: "#9aa0b4",
            callback: (value) => ofFormatCurrency(value, currency, true),
          },
        },
      },
    },
  });

  setTimeout(() => {
    chart.resize();
  }, 80);
}

function ofProjRenderTable(rows, currency = "BRL") {
  const container = document.getElementById("openFinanceProjectionTable");
  if (!container) return;

  container.innerHTML = `
    <table class="saldo-table">
      <thead>
        <tr>
          <th>Semana</th>
          <th>Período</th>
          <th>Entradas proj.</th>
          <th>Saídas proj.</th>
          <th>Mov. líquida</th>
          <th>Saldo final proj.</th>
        </tr>
      </thead>
      <tbody>
        ${rows
      .map((row) => {
        return `
              <tr>
                <td>${ofEscapeHtml(row.label)}</td>
                <td>${ofEscapeHtml(row.period)}</td>
                <td class="kv-pos">${ofFormatCurrency(row.entradas, currency, true)}</td>
                <td class="kv-neg">${ofFormatCurrency(-Math.abs(row.saidas), currency, true)}</td>
                <td class="${ofClassValue(row.liquido)}">${ofFormatSignedCurrency(row.liquido, currency, true)}</td>
                <td class="${ofClassValue(row.saldo_final)}">${ofFormatCurrency(row.saldo_final, currency, true)}</td>
              </tr>
            `;
      })
      .join("")}
      </tbody>
    </table>
  `;
}

async function paintOpenFinanceProjection13Weeks(session) {
  const myGeneration = ofNextRenderGeneration("paintOpenFinanceProjection13Weeks");
  const cycleInfo = document.getElementById("p2-cycle");
  const callout = document.getElementById("p2-callout");

  try {
    ofUpdatePeriodSub();

    const { to } = ofGetDateRange();
    const baseDate = to ? new Date(`${to}T00:00:00`) : new Date();
    const historyTo = ofToDateInputValue(baseDate);
    const historyFrom = ofToDateInputValue(ofAddDays(baseDate, -90));
    const firstWeekStart = ofProjStartOfNextWeek(baseDate);
    const projectionWeeks = ofProjBuildWeeks(firstWeekStart, 13);

    const { accounts, transactions: allTransactions } = await ofGetAllClassifiedTransactions(session);
    if (ofIsStaleRender("paintOpenFinanceProjection13Weeks", myGeneration)) return;
    const historicalTransactions = allTransactions.filter(
      (t) => t.date >= historyFrom && t.date <= historyTo
    );
    const historicalWeeks = ofProjGroupHistoricalWeeks(historicalTransactions);
    const projectionBase = ofProjAverageWeeklyBase(historicalWeeks);
    const projectionRows = ofProjBuildProjectionRows(
      accounts,
      projectionWeeks,
      projectionBase
    );
    const currency =
      accounts[0]?.currency_code ||
      historicalTransactions[0]?.currency_code ||
      "BRL";

    const startingBalance = ofCashBalance(accounts);

    const worstRow = projectionRows.reduce((worst, row) => {
      if (!worst) return row;
      return row.saldo_final < worst.saldo_final ? row : worst;
    }, null);

    const finalRow = projectionRows[projectionRows.length - 1];

    if (cycleInfo) {
      cycleInfo.innerHTML = `
        <div>
          <strong>Base histórica:</strong>
          ${ofFormatDate(historyFrom)} a ${ofFormatDate(historyTo)}
          · ${projectionBase.weeksCount} semana(s)
          · ${projectionBase.transactionsCount} transação(ões)
        </div>
        <div>
          <strong>Projeção:</strong>
          ${projectionRows[0]?.period || "—"} até ${projectionRows[projectionRows.length - 1]?.period || "—"}
        </div>
      `;
    }

    if (callout) {
      const avgNet = projectionBase.avgLiquido;

      callout.innerHTML = `
        <div class="callout-label">Pior saldo previsto</div>
        <div class="callout-value ${ofClassValue(worstRow?.saldo_final || 0)}">
          ${ofFormatCurrency(worstRow?.saldo_final || 0, currency, true)}
        </div>
        <div class="callout-sub">
          ${worstRow ? `${worstRow.label} · ${worstRow.period}` : "Sem dados suficientes"}
        </div>

        <hr class="callout-divider">

        <div class="callout-note">
          Saldo inicial: <strong>${ofFormatCurrency(startingBalance, currency, true)}</strong><br>
          Média semanal líquida: <strong>${ofFormatSignedCurrency(avgNet, currency, true)}</strong><br>
          Saldo ao final da S+13: <strong>${ofFormatCurrency(finalRow?.saldo_final || 0, currency, true)}</strong><br><br>
          <span style="color:var(--muted)">
            Projeção baseada em média histórica dos últimos 90 dias e já exclui transferências/faturas ignoradas.
          </span>
        </div>
      `;
    }

    ofProjRenderChart(projectionRows, currency);
    ofProjRenderTable(projectionRows, currency);
  } catch (err) {
    console.error("Erro ao gerar projeção 13 semanas Open Finance:", err);

    if (cycleInfo) {
      cycleInfo.innerHTML = `
        <div><strong>Não foi possível gerar a projeção.</strong></div>
        <div>Verifique se há contas e transações Open Finance sincronizadas.</div>
      `;
    }

    if (callout) {
      callout.innerHTML = `
        <div class="callout-label">Erro</div>
        <div class="callout-value">Projeção indisponível</div>
        <div class="callout-sub">Não foi possível calcular as próximas 13 semanas.</div>
      `;
    }
  }
}

function ofGetPreviousPeriodRange(from, to) {
  const fromDate = ofParseDateInput(from);
  const toDate = ofParseDateInput(to);

  if (!fromDate || !toDate) {
    const today = new Date();
    const currentFrom = ofStartOfMonth(today);
    const currentTo = ofEndOfMonth(today);
    const previousFrom = ofStartOfMonth(ofAddMonths(today, -1));
    const previousTo = ofEndOfMonth(ofAddMonths(today, -1));

    return {
      currentFrom: ofToDateInputValue(currentFrom),
      currentTo: ofToDateInputValue(currentTo),
      previousFrom: ofToDateInputValue(previousFrom),
      previousTo: ofToDateInputValue(previousTo),
    };
  }

  const diffDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
  const previousTo = ofAddDays(fromDate, -1);
  const previousFrom = ofAddDays(previousTo, -(diffDays - 1));

  return {
    currentFrom: from,
    currentTo: to,
    previousFrom: ofToDateInputValue(previousFrom),
    previousTo: ofToDateInputValue(previousTo),
  };
}

function ofSummarizeTransactions(transactions) {
  const totals = {
    entradas: 0,
    saidas: 0,
    liquido: 0,
    FCO: 0,
    FCI: 0,
    FCF: 0,
    count: 0,
    ignored: 0,
  };

  for (const transaction of transactions || []) {
    if (transaction.cashflow_ignore) {
      totals.ignored += 1;
      continue;
    }

    const amount = ofEffectiveAmount(transaction);
    const type = ["FCO", "FCI", "FCF"].includes(transaction.cashflow_type)
      ? transaction.cashflow_type
      : "FCO";

    if (amount > 0) totals.entradas += amount;
    if (amount < 0) totals.saidas += amount;

    totals.liquido += amount;
    totals[type] += amount;
    totals.count += 1;
  }

  return totals;
}

function ofRenderBudgetVsActualKpis(current, previous, currency) {
  const grid = document.getElementById("p3-kpis");
  if (!grid) return;

  const delta = current.liquido - previous.liquido;
  const deltaEntradas = current.entradas - previous.entradas;

  function kpi(label, value, sub, valueClass = ofClassValue(value)) {
    return `
      <div class="kpi">
        <div class="kpi-label">${ofEscapeHtml(label)}</div>
        <div class="kpi-value ${valueClass}">${ofFormatCurrency(value, currency, true)}</div>
        <div class="kpi-sub" style="font-size:11px;color:var(--muted);margin-top:6px">${ofEscapeHtml(sub)}</div>
      </div>
    `;
  }

  grid.innerHTML =
    kpi("Realizado Líquido", current.liquido, `${current.count} transação(ões) efetiva(s)`) +
    kpi("Base Comparativa", previous.liquido, "Período anterior equivalente") +
    kpi("Desvio Líquido", delta, delta >= 0 ? "Melhora vs base" : "Piora vs base") +
    kpi("Variação Entradas", deltaEntradas, "Realizado atual menos base");
}

function ofRenderBudgetVsActualTable(current, previous, currency) {
  const tbody = document.getElementById("p3-tbody");
  const leitura = document.getElementById("p3-leitura");

  if (!tbody) return;

  const rows = ["FCO", "FCI", "FCF"].map((type) => {
    const config = OF_CASHFLOW_TYPES[type];
    const currentValue = current[type];
    const previousValue = previous[type];
    const delta = currentValue - previousValue;

    return `
      <tr>
        <td>${ofEscapeHtml(config.label)}</td>
        <td>${delta >= 0 ? "Realizado acima da base comparativa" : "Realizado abaixo da base comparativa"}</td>
        <td>${ofFormatCurrency(previousValue, currency, true)}</td>
        <td class="${ofClassValue(delta)}">
          ${ofFormatCurrency(currentValue, currency, true)}
          <div style="font-size:11px;color:var(--muted)">Δ ${ofFormatSignedCurrency(delta, currency, true)}</div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join("");

  if (leitura) {
    const delta = current.liquido - previous.liquido;

    leitura.innerHTML = `
      <strong>Orçado vs Realizado:</strong>
      enquanto não houver orçamento cadastrado, esta aba usa o período anterior equivalente como base comparativa.
      O desvio líquido foi de <strong class="${ofClassValue(delta)}">${ofFormatSignedCurrency(delta, currency, true)}</strong>.
      ${current.ignored ? `<br>${current.ignored} transação(ões) foram ignorada(s) por regra para evitar duplicidade.` : ""}
    `;
  }
}

function ofRenderBudgetVsActualCharts(current, previous, currentTransactions, previousTransactions, currency) {
  const barCanvas = document.getElementById("c-p3-bar");
  const saldoCanvas = document.getElementById("c-p3-saldo");

  if (barCanvas && typeof Chart !== "undefined") {
    ofDestroyChartById("c-p3-bar");

    new Chart(barCanvas, {
      type: "bar",
      data: {
        labels: ["Entradas", "Saídas", "Líquido"],
        datasets: [
          {
            label: "Base",
            data: [previous.entradas, Math.abs(previous.saidas), previous.liquido],
            backgroundColor: "#828798",
            borderRadius: 4,
          },
          {
            label: "Realizado",
            data: [current.entradas, Math.abs(current.saidas), current.liquido],
            backgroundColor: "#2dd4a0",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: true, position: "top", labels: { boxWidth: 10, color: "#9aa0b4" } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${ofFormatCurrency(context.raw, currency)}`,
            },
          },
        },
        scales: {
          x: { grid: { color: "rgba(255,255,255,.07)" }, ticks: { color: "#9aa0b4" } },
          y: {
            grid: { color: "rgba(255,255,255,.07)" },
            ticks: { color: "#9aa0b4", callback: (value) => ofFormatCurrency(value, currency, true) },
          },
        },
      },
    });
  }

  if (saldoCanvas && typeof Chart !== "undefined") {
    ofDestroyChartById("c-p3-saldo");

    const months = [
      ...new Set(
        [...previousTransactions, ...currentTransactions]
          .map((transaction) => ofGetMonthKey(transaction.date))
          .filter(Boolean)
          .sort()
      ),
    ];

    const previousRows = ofGroupTransactionsByMonth(previousTransactions, months);
    const currentRows = ofGroupTransactionsByMonth(currentTransactions, months);

    new Chart(saldoCanvas, {
      type: "line",
      data: {
        labels: months.map(ofFormatMonthLabel),
        datasets: [
          {
            label: "Base",
            data: previousRows.map((row) => row.liquido),
            borderColor: "#828798",
            backgroundColor: "rgba(130,135,152,.12)",
            tension: 0.35,
            fill: false,
          },
          {
            label: "Realizado",
            data: currentRows.map((row) => row.liquido),
            borderColor: "#5b9dff",
            backgroundColor: "rgba(91,157,255,.12)",
            tension: 0.35,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${ofFormatCurrency(context.raw, currency)}`,
            },
          },
        },
        scales: {
          x: { grid: { color: "rgba(255,255,255,.07)" }, ticks: { color: "#9aa0b4" } },
          y: {
            grid: { color: "rgba(255,255,255,.07)" },
            ticks: { color: "#9aa0b4", callback: (value) => ofFormatCurrency(value, currency, true) },
          },
        },
      },
    });
  }
}

async function paintOpenFinanceBudgetVsActual(session) {
  const myGeneration = ofNextRenderGeneration("paintOpenFinanceBudgetVsActual");
  try {
    ofUpdatePeriodSub();

    const { from, to } = ofGetDateRange();
    const ranges = ofGetPreviousPeriodRange(from, to);
    const weeks = document.getElementById("p3-weeks");
    const chartSub = document.getElementById("p3-chart-sub");
    const decompSub = document.getElementById("p3-decomp-sub");

    if (weeks) {
      weeks.innerHTML = `
        <button class="chipbtn on">Realizado: ${ofFormatDate(ranges.currentFrom)} a ${ofFormatDate(ranges.currentTo)}</button>
        <button class="chipbtn">Base: ${ofFormatDate(ranges.previousFrom)} a ${ofFormatDate(ranges.previousTo)}</button>
      `;
    }

    if (chartSub) {
      chartSub.textContent = "Período atual vs período anterior equivalente";
    }

    if (decompSub) {
      decompSub.textContent = "FCO · FCI · FCF · regras de ignorar aplicadas";
    }

    const { accounts, transactions: allTransactions } = await ofGetAllClassifiedTransactions(session);
    if (ofIsStaleRender("paintOpenFinanceBudgetVsActual", myGeneration)) return;

    const currentTransactions = allTransactions.filter(
      (t) => t.date >= ranges.currentFrom && t.date <= ranges.currentTo
    );
    const previousTransactions = allTransactions.filter(
      (t) => t.date >= ranges.previousFrom && t.date <= ranges.previousTo
    );

    const current = ofSummarizeTransactions(currentTransactions);
    const previous = ofSummarizeTransactions(previousTransactions);
    const currency =
      currentTransactions[0]?.currency_code ||
      previousTransactions[0]?.currency_code ||
      accounts[0]?.currency_code ||
      "BRL";

    ofRenderBudgetVsActualKpis(current, previous, currency);
    ofRenderBudgetVsActualTable(current, previous, currency);
    ofRenderBudgetVsActualCharts(current, previous, currentTransactions, previousTransactions, currency);
  } catch (err) {
    console.error("Erro ao carregar Orçado vs Realizado Open Finance:", err);
  }
}

async function paintResultadosHistoricos(session) {
  const container = document.getElementById("p4-content");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ink2)">Carregando balancetes…</div>`;

  const { data: analyses, error } = await supabaseClient
    .from("document_analyses")
    .select("id, raw_json, created_at, document:documents(name, periodo_inicio, periodo_fim)")
    .eq("org_id", session.orgId)
    .eq("status", "concluido")
    .not("raw_json", "is", null)
    .order("created_at", { ascending: true });

  if (error || !analyses || analyses.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div style="text-align:center;padding:48px 24px;color:var(--muted)">
          <div style="font-size:15px;margin-bottom:8px">Nenhum balancete processado</div>
          <div style="font-size:12.5px">Envie um balancete na aba Documentos para visualizar os dados aqui.</div>
        </div>
      </div>`;
    return;
  }

  function getPeriod(a) {
    const doc = a.document;
    if (doc?.periodo_inicio) {
      return doc.periodo_fim ? `${doc.periodo_inicio}–${doc.periodo_fim}` : doc.periodo_inicio;
    }

    return a.raw_json?.periodo || new Date(a.created_at).toLocaleDateString("pt-BR");
  }

  function findSint(contas, ...keys) {
    for (const k of keys) {
      const c = contas.find((item) =>
        item.tipo === "S" &&
        Number(item.nivel || 0) <= 2 &&
        item.descricao?.toUpperCase().includes(k.toUpperCase())
      );

      if (c != null) return c.saldo_final ?? 0;
    }

    return null;
  }

  const empresa = analyses[0]?.raw_json?.empresa || "";
  const cnpj = analyses[0]?.raw_json?.cnpj || "";
  const periods = analyses.map(getPeriod);

  const mx = analyses.map((a) => {
    const c = a.raw_json?.contas || [];
    const receita = findSint(c, "RECEITA BRUTA", "RECEITA");
    const recLiq = findSint(c, "RECEITA LÍQUIDA") ?? receita;
    const impostos = findSint(c, "IMPOSTOS S/FAT", "SIMPLES", "IMPOSTOS");
    const custo = findSint(c, "CUSTO DOS SERVIÇOS", "CUSTO DO PRODUTO", "CMV", "CPV");
    const despOp = findSint(c, "DESPESAS OPERACIONAIS", "DESPESA OPERACIONAL", "DESPESA");
    const resFin = findSint(c, "RESULTADO FINANCEIRO");
    const resultado = findSint(c, "RESULTADO DO EXERCÍCIO", "RESULTADO", "LUCRO LÍQUIDO", "LUCRO");
    const ativo = findSint(c, "ATIVO TOTAL", "ATIVO");
    const ativoCirc = findSint(c, "ATIVO CIRCULANTE");
    const caixa = findSint(c, "DISPONÍV", "CAIXA", "BANCO");
    const cr = findSint(c, "CONTAS A RECEBER", "CLIENTES", "RECEBER");
    const passivo = findSint(c, "PASSIVO TOTAL", "PASSIVO");
    const passCirc = findSint(c, "PASSIVO CIRCULANTE");
    const pl = findSint(c, "PATRIMÔNIO LÍQUIDO", "PATRIMÔNIO L", "PATRIMÔNIO");
    const margem = receita && resultado ? resultado / receita : null;

    return {
      receita,
      recLiq,
      impostos,
      custo,
      despOp,
      resFin,
      resultado,
      ativo,
      ativoCirc,
      caixa,
      cr,
      passivo,
      passCirc,
      pl,
      margem,
    };
  });

  const colW = Math.max(600, periods.length * 130 + 220);
  const colHeaders = periods
    .map((p) => `<th class="num" style="min-width:120px">${ofEscapeHtml(p)}</th>`)
    .join("");

  function pct(v) {
    return v != null ? `${(v * 100).toFixed(1).replace(".", ",")}%` : null;
  }

  function row(label, vals, { bold = false, indent = 0, fmt = ofFormatCurrency, sectionHeader = false } = {}) {
    if (sectionHeader) {
      return `<tr class="tbl-section"><td colspan="${periods.length + 1}" style="padding-left:12px">${ofEscapeHtml(label)}</td></tr>`;
    }

    const cells = vals
      .map((v) =>
        v == null
          ? `<td class="num" style="color:var(--muted)">—</td>`
          : `<td class="num">${ofEscapeHtml(fmt(v))}</td>`
      )
      .join("");
    const boldClass = bold ? "tbl-bold" : "";
    const pad = indent ? `style="padding-left:${12 + indent * 14}px"` : "";

    return `<tr class="${boldClass}"><td ${pad}>${ofEscapeHtml(label)}</td>${cells}</tr>`;
  }

  function col(key) {
    return mx.map((m) => m[key]);
  }

  const dreRows = [
    row("Receita Bruta", col("receita"), { bold: false }),
    row("(-) Impostos s/ Faturamento", col("impostos"), { indent: 1 }),
    row("Receita Líquida", col("recLiq"), { bold: true }),
    row("(-) Custo dos Serviços", col("custo"), { indent: 1 }),
    row("(-) Despesas Operacionais", col("despOp"), { indent: 1 }),
    row("Resultado Financeiro", col("resFin"), { indent: 1 }),
    row("Resultado do Período (LL)", col("resultado"), { bold: true }),
    row("Margem LL (%)", col("margem"), { fmt: pct }),
  ].join("");

  const balRows = [
    row("ATIVO", [], { sectionHeader: true }),
    row("Ativo Total", col("ativo"), { bold: true }),
    row("Ativo Circulante", col("ativoCirc"), { indent: 1 }),
    row("Caixa / Disponível", col("caixa"), { indent: 2 }),
    row("Contas a Receber", col("cr"), { indent: 2 }),
    row("PASSIVO & PL", [], { sectionHeader: true }),
    row("Passivo Total", col("passivo"), { bold: true }),
    row("Passivo Circulante", col("passCirc"), { indent: 1 }),
    row("Patrimônio Líquido", col("pl"), { indent: 1 }),
  ].join("");

  ofDestroyChartById("p4-chart-combo");
  ofDestroyChartById("p4-chart-bal");

  container.innerHTML = `
    ${empresa ? `<div style="margin-bottom:16px;font-size:13px;color:var(--ink2)">${ofEscapeHtml(empresa)}${cnpj ? ` · ${ofEscapeHtml(cnpj)}` : ""}</div>` : ""}

    <div class="card-row cols-2" style="margin-bottom:18px">
      <div class="card">
        <div class="ch"><div><div class="ct">Receita vs Resultado</div><div class="cs">Evolução mensal</div></div></div>
        <canvas id="p4-chart-combo" height="200"></canvas>
        <div class="legend">
          <div class="li"><div class="ld" style="background:rgba(56,189,112,.8)"></div>Receita</div>
          <div class="li"><div class="ld" style="background:rgba(99,179,237,.8)"></div>Resultado LL</div>
        </div>
      </div>
      <div class="card">
        <div class="ch"><div><div class="ct">Ativo Total</div><div class="cs">Evolução mensal</div></div></div>
        <canvas id="p4-chart-bal" height="200"></canvas>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="ch"><div>
        <div class="ct">DRE — Demonstração do Resultado Mensal</div>
        <div class="cs">Extraído dos balancetes de verificação</div>
      </div></div>
      <div style="overflow-x:auto">
        <table class="saldo-table analysis-table" style="min-width:${colW}px;font-size:12.5px">
          <thead><tr>
            <th style="text-align:left;min-width:220px">Linha</th>
            ${colHeaders}
          </tr></thead>
          <tbody>${dreRows}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="ch"><div>
        <div class="ct">Balanço Patrimonial — Saldo Final</div>
        <div class="cs">Posição patrimonial por período</div>
      </div></div>
      <div style="overflow-x:auto">
        <table class="saldo-table analysis-table" style="min-width:${colW}px;font-size:12.5px">
          <thead><tr>
            <th style="text-align:left;min-width:220px">Linha</th>
            ${colHeaders}
          </tr></thead>
          <tbody>${balRows}</tbody>
        </table>
      </div>
    </div>
  `;

  if (typeof Chart !== "undefined") {
    const chartOpts = (extraScales = {}) => ({
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => " " + ofFormatCurrency(ctx.parsed.y, "BRL", true) } },
      },
      scales: {
        x: { ticks: { color: "#9aa0ac", font: { size: 10 } }, grid: { color: "rgba(255,255,255,.06)" } },
        y: {
          ticks: {
            color: "#9aa0ac",
            font: { size: 10 },
            callback: (v) => ofFormatCurrency(v, "BRL", true),
          },
          grid: { color: "rgba(255,255,255,.06)" },
          ...extraScales,
        },
      },
    });

    const comboCanvas = document.getElementById("p4-chart-combo");
    const balCanvas = document.getElementById("p4-chart-bal");

    if (comboCanvas) {
      new Chart(comboCanvas, {
        type: "bar",
        data: {
          labels: periods,
          datasets: [
            { label: "Receita", data: col("receita"), backgroundColor: "rgba(56,189,112,.75)", borderRadius: 4, order: 2 },
            { label: "Resultado LL", data: col("resultado"), backgroundColor: "rgba(99,179,237,.75)", borderRadius: 4, order: 2 },
          ],
        },
        options: chartOpts(),
      });
    }

    if (balCanvas) {
      new Chart(balCanvas, {
        type: "line",
        data: {
          labels: periods,
          datasets: [
            {
              label: "Ativo Total",
              data: col("ativo"),
              borderColor: "#a78bfa",
              backgroundColor: "rgba(167,139,250,.12)",
              tension: 0.35,
              fill: true,
              pointRadius: 4,
              pointBackgroundColor: "#a78bfa",
            },
          ],
        },
        options: chartOpts(),
      });
    }
  }
}

// Run once a render chain has fully settled. Two jobs, both of which the
// user previously only got by switching tabs and back (goTab does the same
// resize pass at its end, which is exactly why that "fixed" the display):
//   1. Force-clear every chart loading overlay. Whichever paint function
//      bailed — superseded by a newer render generation, an early return,
//      an error — nothing can leave a panel blanked once the chain is done.
//   2. Re-measure the canvases. Charts created while the layout was still
//      settling (first load, before fonts/scrollbars resolve) can end up
//      sized against a stale container height and draw into the wrong box.
function ofSettleActiveTabCharts() {
  ["c-p0-saldo", "c-p0-cluster", "c-p1-combo", "c-p1-dfc"].forEach((id) => ofSetChartLoading(id, false));

  if (typeof Chart === "undefined") return;
  requestAnimationFrame(() => {
    document.querySelectorAll(".page.active canvas").forEach((canvas) => {
      Chart.getChart(canvas)?.resize();
    });
  });
}

async function ofRenderActiveTab(tabIndex) {
  const session = window.__lastOrgSession;

  if (!session) return;

  // Visão Geral now also hosts the Entradas/Saídas charts (previously their
  // own tab), and the Open Finance tab took over that tab slot to show the
  // Resumo/Transações content that used to live in Visão Geral — so both
  // paint functions still exist per their original data-fetch scope, they
  // just serve DOM elements split across these two tabs now.
  if (tabIndex === 0 && typeof window.paintOpenFinanceDashboard === "function") {
    await window.paintOpenFinanceDashboard(session);
    if (typeof window.paintOpenFinanceEntradasSaidas === "function") {
      await window.paintOpenFinanceEntradasSaidas(session);
    }
    if (typeof window.paintOpenFinanceClusterDistribution === "function") {
      await window.paintOpenFinanceClusterDistribution(session);
    }
    ofSettleActiveTabCharts();
    return;
  }

  if (tabIndex === 1 && typeof window.paintOpenFinanceDashboard === "function") {
    await window.paintOpenFinanceDashboard(session);
    return;
  }

  if (tabIndex === 2 && typeof window.paintOpenFinanceProjection13Weeks === "function") {
    await window.paintOpenFinanceProjection13Weeks(session);
    return;
  }

  if (tabIndex === 3 && typeof window.paintOpenFinanceBudgetVsActual === "function") {
    await window.paintOpenFinanceBudgetVsActual(session);
    return;
  }

  // Fluxo de caixa: aba própria de quem tem organizations.cash_view_enabled
  // (cashflow-view.js). Com a chave desligada, a aba nem aparece.
  if (tabIndex === 4 && typeof window.paintCashflowView === "function") {
    await window.paintCashflowView(session);
    ofSettleActiveTabCharts();
    return;
  }

}

async function ofRefreshOpenFinanceActiveTab() {
  ofUpdatePeriodSub();

  if (!window.__lastOrgSession) return;

  const activePageId = document.querySelector(".page.active")?.id || "p0";
  const tabIndex = Number(activePageId.replace("p", ""));

  await ofRenderActiveTab(Number.isFinite(tabIndex) ? tabIndex : 0);
}

// "Atualizar" next to the sync status — the only other ways data changes
// are a real sync, a classification run, or an edit/group action (all of
// which already invalidate the cache themselves); this exists for the user
// to force a fresh look right now regardless of any of that.
async function ofOnRefreshButtonClick() {
  const session = window.__lastOrgSession;
  if (!session) return;

  const btn = document.getElementById("dashboardRefreshBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Atualizando…"; }

  try {
    // Recompute the cash-flow classification before re-reading, so this button
    // also resolves rows the scheduled pass hasn't reached yet. Without it a
    // user who sees the "pending" banner would have no way to act on it except
    // waiting for the next scheduled run.
    try {
      await supabaseClient.functions.invoke("scheduled-refresh", {
        body: { org_id: session.orgId },
      });
    } catch (err) {
      // A failed recompute still leaves the reload worth doing — the numbers
      // just stay as they were rather than getting fresher.
      console.warn("Recálculo de fluxo de caixa não pôde ser concluído:", err?.message || err);
    }

    _ofAllTxCache = null;
    _ofScopedCache = null;
    await ofClearPersistedSnapshot(session.orgId);
    await ofRefreshOpenFinanceActiveTab();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Atualizar"; }
  }
}

function ofSetupDateFilters() {
  const quickRanges = document.getElementById("quickRanges");

  if (!quickRanges) return;

  if (quickRanges.dataset.openFinanceFiltersReady === "true") {
    return;
  }

  quickRanges.dataset.openFinanceFiltersReady = "true";

  quickRanges.addEventListener(
    "click",
    async (event) => {
      const btn = event.target.closest(".chipbtn");

      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();

      quickRanges.querySelectorAll(".chipbtn").forEach((button) => {
        button.classList.remove("on");
      });

      btn.classList.add("on");

      ofApplyQuickRange(btn.dataset.range);
      ofSyncDateInputsToRange();
      await ofRefreshOpenFinanceActiveTab();
    },
    true
  );

  // Free-date selection, alongside the presets rather than instead of them.
  // Both write to the same _ofDateRange the presets do, so everything
  // downstream — every painter, the period label, the drill-downs — reads one
  // range and neither path is a special case.
  //
  // Nothing here touches the data layer: transactions are fetched once for the
  // whole history and every period filter is applied in memory, so changing
  // dates costs a re-render and no round trip.
  const fromInput = document.getElementById("ofDateFrom");
  const toInput = document.getElementById("ofDateTo");
  const clearBtn = document.getElementById("ofDateClear");

  async function applyCustomRange() {
    const fromValue = fromInput?.value;
    const toValue = toInput?.value;

    // Wait for both ends before re-rendering — reacting to the first one
    // would briefly filter on a half-specified range and flash wrong numbers.
    if (!fromValue || !toValue) return;

    // Tolerate a reversed pair instead of rendering an empty dashboard: the
    // user almost certainly means the span between the two dates.
    const [start, end] = fromValue <= toValue ? [fromValue, toValue] : [toValue, fromValue];

    quickRanges.querySelectorAll(".chipbtn").forEach((button) => button.classList.remove("on"));

    // Passed through as the input's own "YYYY-MM-DD" strings, which is what
    // the presets store and what every date comparison in this file expects.
    ofSetDateRange(start, end);
    await ofRefreshOpenFinanceActiveTab();
  }

  fromInput?.addEventListener("change", applyCustomRange);
  toInput?.addEventListener("change", applyCustomRange);

  clearBtn?.addEventListener("click", async () => {
    const active = quickRanges.querySelector(".chipbtn.on");
    const fallback = active || quickRanges.querySelector('.chipbtn[data-range="mes"]');
    if (!fallback) return;

    quickRanges.querySelectorAll(".chipbtn").forEach((button) => button.classList.remove("on"));
    fallback.classList.add("on");

    ofApplyQuickRange(fallback.dataset.range);
    ofSyncDateInputsToRange();
    await ofRefreshOpenFinanceActiveTab();
  });

  // With the free-date inputs gone there's always exactly one preset active,
  // so fall back to "Este mês" rather than leaving the range unset if the
  // markup ever ships without an `.on` chip.
  const activeQuickRange = quickRanges.querySelector(".chipbtn.on");

  if (activeQuickRange) {
    ofApplyQuickRange(activeQuickRange.dataset.range);
  } else {
    const fallback = quickRanges.querySelector('.chipbtn[data-range="mes"]');
    if (fallback) fallback.classList.add("on");
    ofApplyQuickRange("mes");
  }

  ofSyncDateInputsToRange();
}

window.goTab = async function goTab(tabIndex, el) {
  document.querySelectorAll(".tabnav .tab, .tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  if (el) {
    el.classList.add("active");
  } else {
    const fallbackTab = document.querySelectorAll(".tabnav .tab, .tab")[tabIndex];

    if (fallbackTab) {
      fallbackTab.classList.add("active");
    }
  }

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });

  const targetPage = document.getElementById(`p${tabIndex}`);

  if (targetPage) {
    targetPage.classList.add("active");
  }

  await ofRenderActiveTab(tabIndex);

  if (window.__lastOrgSession) {
    await ofUpdateDashboardSyncStatus(window.__lastOrgSession);
  }

  setTimeout(() => {
    if (typeof Chart === "undefined") return;

    document.querySelectorAll(".page.active canvas").forEach((canvas) => {
      const chart = Chart.getChart(canvas);
      if (chart) chart.resize();
    });
  }, 100);
};

function ofHideClassifyJobBanner() {
  const banner = document.getElementById("classifyJobBanner");
  if (banner) banner.style.display = "none";
}

// The classify-transactions loop runs entirely in the browser tab that
// started it — nothing continues server-side once that tab closes. This is
// the other half of that: classify-transactions persists a
// classification_jobs row after every batch, so a fresh page load (even in
// a different tab, or after the original one was closed mid-run on a large
// org) can notice a run was left "running" and pick it back up from its
// saved cursor automatically, instead of silently losing track of it.
async function ofCheckClassificationJob(session) {
  if (!document.getElementById("btnClassifyTransactions")) return;

  const { data: job } = await supabaseClient
    .from("classification_jobs")
    .select("mode, cursor_id, run_id, status, total_pending, updated_at")
    .eq("org_id", session.orgId)
    .maybeSingle();

  if (!job || job.status !== "running") {
    ofHideClassifyJobBanner();
    return;
  }

  // A classification was left "running" — most often because the tab that
  // triggered it (typically settings.js's auto-classify right after an Open
  // Finance sync) was closed or navigated away before it finished. Resume it
  // automatically here instead of leaving new transactions unclassified
  // until someone happens to notice and click a resume button;
  // ofRunClassifyTransactions renders its own progress text and "Parar"
  // button, so there's nothing left for the old banner UI to do.
  if (!_ofClassifyRunActive) {
    ofRunClassifyTransactions(job.mode, job.cursor_id, job.run_id, true);
  }
}

// Pulls the real error message out of a Supabase Edge Function invocation
// error — the client's generic "non-2xx status code" message hides the
// actual body, which is only reachable via err.context (a raw Response).
async function ofExtractInvokeErrorDetail(err) {
  let detail = err?.message || String(err);
  if (err?.context && typeof err.context.json === "function") {
    try {
      const body = await err.context.clone().json();
      if (body?.error) detail = body.error;
    } catch { /* response body wasn't JSON — keep the generic message */ }
  }
  return detail;
}

// Each invoke() call only processes one ~100-transaction batch (keeps a
// single call well under Supabase Edge Functions' wall-clock limit — see
// classify-transactions' BATCH_SIZE comment) — so for a large org, this
// keeps calling it again with the returned next_cursor until there's
// nothing left, instead of making the user click repeatedly. Total AI/token
// cost is identical either way; this only changes how the work is split
// into requests.
const OF_MAX_CLASSIFY_BATCHES = 50; // safety cap: 50 * ~100 = ~5000 tx per click

// Set while ofRunClassifyTransactions' own loop is active in THIS tab, so
// "Parar classificação" knows there's something local to cancel and the
// button can be shown/hidden accordingly.
let _ofClassifyRunActive = false;

async function ofCancelClassification() {
  const session = window.__lastOrgSession;
  if (!session) return;
  try {
    await supabaseClient.functions.invoke("classify-transactions", {
      body: { org_id: session.orgId, action: "cancel" },
    });
    // The running loop (here or in whatever tab actually owns it) picks this
    // up on its next batch call and stops on its own — nothing more to do
    // here beyond letting the backend flip the job's status.
  } catch (err) {
    console.warn("classify-transactions cancel error:", err);
  }
}

async function ofRunClassifyTransactions(mode, resumeCursor = null, resumeRunId = null, silent = false) {
  const btn = document.getElementById("btnClassifyTransactions");
  const cancelBtn = document.getElementById("btnCancelClassification");
  const statusEl = document.getElementById("classifyProgressStatus");
  const session = window.__lastOrgSession;
  if (!session) return;

  // A fresh manual click (no resumeRunId passed in) could still collide with
  // a job already running from another tab/page (settings.js's auto-classify
  // after sync, or another dashboard tab's own auto-resume) — adopt it
  // instead of starting a new run_id: null request that the backend's
  // concurrency lock would just reject outright.
  if (!resumeRunId) {
    const { data: existingJob } = await supabaseClient
      .from("classification_jobs")
      .select("run_id, cursor_id, mode, status")
      .eq("org_id", session.orgId)
      .maybeSingle();
    if (existingJob?.status === "running") {
      resumeRunId = existingJob.run_id;
      resumeCursor = existingJob.cursor_id;
      mode = existingJob.mode || mode;
    }
  }

  ofHideClassifyJobBanner();

  const originalText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Classificando…"; }
  if (cancelBtn) cancelBtn.style.display = "inline-block";
  if (statusEl) statusEl.textContent = "";
  _ofClassifyRunActive = true;

  const totals = {
    corrections_applied: 0, nature_classified: 0, cluster_matched: 0,
    cluster_ai_classified: 0, new_suppliers_learned: 0,
    cluster_ai_unresolved: 0, failed_ai_chunks: 0,
  };
  let batches = 0;
  let cursor = resumeCursor;
  let runId = resumeRunId;
  let remaining = "more";
  let wasCancelled = false;
  // Estimated from the first batch's total_pending/batch_size (how much was
  // pending at the START of this run) — kept fixed for the rest of the loop
  // rather than recomputed each call, so "lote X de ~Y" doesn't jump around.
  let estimatedTotalBatches = null;

  try {
    while (remaining === "more" && batches < OF_MAX_CLASSIFY_BATCHES) {
      batches++;
      const soFarBeforeThisBatch = totals.nature_classified + totals.cluster_matched +
        totals.cluster_ai_classified + totals.corrections_applied;
      const totalLabel = estimatedTotalBatches ? ` de ~${estimatedTotalBatches}` : "";
      if (btn && batches > 1) btn.textContent = `Classificando… (lote ${batches}${totalLabel})`;
      if (statusEl) statusEl.textContent = `Lote ${batches}${totalLabel} · ${soFarBeforeThisBatch} classificada(s) até agora`;

      const { data, error } = await supabaseClient.functions.invoke("classify-transactions", {
        body: { org_id: session.orgId, mode, cursor_id: cursor, run_id: runId },
      });
      if (error) throw error;

      if (!runId && data?.run_id) runId = data.run_id;

      if (data?.cancelled) {
        wasCancelled = true;
        console.log(`classify-transactions: lote ${batches} — cancelado por "Parar classificação"`);
        break;
      }

      if (estimatedTotalBatches === null && data?.total_pending && data?.batch_size) {
        estimatedTotalBatches = Math.max(1, Math.ceil(data.total_pending / data.batch_size));
      }

      totals.corrections_applied += data?.corrections_applied || 0;
      totals.nature_classified += data?.nature_classified || 0;
      totals.cluster_matched += data?.cluster_matched || 0;
      totals.cluster_ai_classified += data?.cluster_ai_classified || 0;
      totals.new_suppliers_learned += data?.new_suppliers_learned || 0;
      totals.cluster_ai_unresolved += data?.cluster_ai_unresolved || 0;
      totals.failed_ai_chunks += data?.failed_ai_chunks || 0;

      console.log(
        `classify-transactions: lote ${batches}${estimatedTotalBatches ? `/${estimatedTotalBatches}` : ""} concluído`,
        data
      );

      remaining = data?.remaining;
      cursor = data?.next_cursor || null;
    }

    const totalClassified = totals.nature_classified + totals.cluster_matched +
      totals.cluster_ai_classified + totals.corrections_applied;
    const progressSoFar = batches > 1
      ? ` ${totalClassified} classificada(s) em ${batches - (wasCancelled ? 1 : 0)} lote(s) antes de parar.`
      : "";
    const summary = wasCancelled
      ? `Classificação interrompida a pedido.${progressSoFar}`
      : totalClassified || totals.cluster_ai_unresolved || totals.failed_ai_chunks
        ? [
            batches > 1 ? `${batches} lote(s) processado(s)` : null,
            totals.corrections_applied ? `${totals.corrections_applied} aplicada(s) por correção manual salva anteriormente` : null,
            `${totals.nature_classified} classificada(s) por natureza`,
            `${totals.cluster_matched} por regra de fornecedor`,
            `${totals.cluster_ai_classified} por IA (fornecedor novo)`,
            totals.new_suppliers_learned ? `${totals.new_suppliers_learned} novo(s) fornecedor(es) aprendido(s)` : null,
            totals.cluster_ai_unresolved ? `${totals.cluster_ai_unresolved} sem cluster confiável (IA não encontrou correspondência — precisa de ajuste manual)` : null,
            totals.failed_ai_chunks ? `${totals.failed_ai_chunks} lote(s) de IA falharam e ficarão pendentes para o próximo clique` : null,
          ].filter(Boolean).join(" · ") + (remaining === "more" ? " — ainda há mais; clique novamente para continuar." : ".")
        : "Nenhuma transação pendente de classificação.";
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    if (statusEl) statusEl.textContent = "";
    _ofClassifyRunActive = false;
    if (silent) {
      console.log(`Classificação automática concluída: ${summary}`);
    } else {
      alert(summary);
    }
    ofInvalidateAllTxCache(session.orgId);
    // A silent background resume (see ofCheckClassificationJob) finishing
    // mid-visit shouldn't yank a full org-wide refetch+reclassify out from
    // under whatever the user is currently looking at — the invalidated
    // cache already guarantees the NEXT natural trigger (tab switch, filter
    // change, reopening later) shows fresh data. A manual run the user
    // explicitly asked for should still show its results immediately.
    if (!silent) await ofRefreshOpenFinanceActiveTab();
  } catch (err) {
    console.warn("classify-transactions error:", err);
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = "none";
    if (statusEl) statusEl.textContent = "";
    _ofClassifyRunActive = false;
    const progressNote = batches > 1 ? ` (${batches - 1} lote(s) já haviam sido processados com sucesso antes deste erro)` : "";
    if (silent) {
      console.warn("Classificação automática falhou: " + await ofExtractInvokeErrorDetail(err) + progressNote);
    } else {
      alert("Erro ao classificar transações: " + await ofExtractInvokeErrorDetail(err) + progressNote);
    }
    // Batches before the failure may still have written real changes — don't
    // let the cache keep serving pre-classification data for those rows.
    if (batches > 1) ofInvalidateAllTxCache(session.orgId);
    if (!silent) await ofRefreshOpenFinanceActiveTab();
  }
}

function ofOpenClassifyModeModal() {
  const modal = document.getElementById("classifyModeModalRoot");
  const status = document.getElementById("classifyModeStatus");
  if (status) status.textContent = "";
  if (modal) modal.style.display = "flex";
}

function ofCloseClassifyModeModal() {
  const modal = document.getElementById("classifyModeModalRoot");
  if (modal) modal.style.display = "none";
}

document.getElementById("btnClassifyTransactions")?.addEventListener("click", ofOpenClassifyModeModal);
document.getElementById("btnCancelClassification")?.addEventListener("click", ofCancelClassification);
document.getElementById("classifyModeModalClose")?.addEventListener("click", ofCloseClassifyModeModal);
document.getElementById("classifyModeModalRoot")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("classifyModeModalRoot")) ofCloseClassifyModeModal();
});
document.getElementById("classifyModePending")?.addEventListener("click", () => {
  ofCloseClassifyModeModal();
  ofRunClassifyTransactions("pending");
});
document.getElementById("classifyModeAll")?.addEventListener("click", () => {
  ofCloseClassifyModeModal();
  ofRunClassifyTransactions("all");
});

// ── "Ignoradas por regra" list modal ────────────────────────────────────
const _ofIgnoredModalTxs = new Map();

function ofOpenIgnoredTxListModal(transactions) {
  const modal = document.getElementById("ignoredTxListModalRoot");
  const body = document.getElementById("ignoredTxListBody");
  const sub = document.getElementById("ignoredTxListSub");
  if (!modal || !body) return;

  _ofIgnoredModalTxs.clear();
  transactions.forEach((t) => _ofIgnoredModalTxs.set(String(t.id), t));

  const accountsById = _ofVisibleAccountsById || new Map();
  const pluggyItemsById = _ofVisiblePluggyItemsById || new Map();

  if (sub) sub.textContent = `${transactions.length} transação(ões) excluída(s) do fluxo de caixa por regra automática`;

  body.innerHTML = transactions
    .map((t) => {
      const accountId = ofGetTransactionAccountId(t);
      const account = accountsById.get(accountId);
      const pluggyItem = pluggyItemsById.get(ofGetTransactionItemId(t) || account?.pluggy_item_id);
      const accountName = account ? ofGetAccountLabel(account) : pluggyItem?.connector_name || "Conta";
      const currency = t.currency_code || account?.currency_code || "BRL";

      return `
        <tr data-tx-id="${ofEscapeHtml(String(t.id))}">
          <td>${ofEscapeHtml(ofFormatDate(t.date))}</td>
          <td style="text-align:left;font-weight:600">
            ${ofEscapeHtml(t.description || "Sem descrição")}
            <div style="font-size:11px;color:#f0a93c;font-weight:600;margin-top:2px">${ofEscapeHtml(t.cashflow_ignore_reason || "")}</div>
          </td>
          <td style="text-align:left;font-size:12px">${ofRenderOriginCell(t)}</td>
          <td>${ofEscapeHtml(accountName)}</td>
          <td style="font-weight:700">${ofFormatCurrency(Number(t.amount || 0), currency)}</td>
          <td><button class="btn-secondary of-ignored-edit-btn" data-tx-id="${ofEscapeHtml(String(t.id))}" style="padding:4px 10px;font-size:12px">Classificar</button></td>
        </tr>
      `;
    })
    .join("");

  modal.style.display = "flex";
}

function ofCloseIgnoredTxListModal() {
  const modal = document.getElementById("ignoredTxListModalRoot");
  if (modal) modal.style.display = "none";
}

document.getElementById("ignoredTxListModalClose")?.addEventListener("click", ofCloseIgnoredTxListModal);
document.getElementById("ignoredTxListModalRoot")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("ignoredTxListModalRoot")) ofCloseIgnoredTxListModal();
});
document.getElementById("ignoredTxListBody")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".of-ignored-edit-btn");
  if (!btn) return;
  const transaction = _ofIgnoredModalTxs.get(btn.dataset.txId);
  if (!transaction) return;
  ofCloseIgnoredTxListModal();
  ofOpenTxEditModal(transaction);
});

// ── Inline edit of a transaction's AI-assigned natureza/cluster ────────────
let _ofNatureCategories = null;
let _ofClusterCategories = null;
let _ofSupplierRules = null;
let _ofEditingTx = null;

async function ofLoadClassificationCategories(orgId) {
  if (_ofNatureCategories && _ofClusterCategories && _ofSupplierRules) return;
  const [{ data: natureRows }, { data: clusterRows }, { data: ruleRows }] = await Promise.all([
    supabaseClient.from("nature_position_categories").select("id, name, code").eq("org_id", orgId).order("sort_order"),
    supabaseClient.from("cluster_categories").select("id, name, code, parent_cluster_id").eq("org_id", orgId).order("sort_order"),
    supabaseClient.from("transaction_cluster_rules").select("id, supplier_name, cnpj, cluster_category_id, cluster_label").eq("org_id", orgId).order("supplier_name"),
  ]);
  _ofNatureCategories = natureRows || [];
  _ofClusterCategories = clusterRows || [];
  _ofSupplierRules = ruleRows || [];
}

function ofPopulateEditSelect(selectEl, categories, currentId) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">— Sem alteração —</option>` + categories
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(currentId || "") ? "selected" : ""}>${ofEscapeHtml((c.code ? c.code + " - " : "") + c.name)}</option>`)
    .join("");
}

// Pre-selects a supplier only when this transaction's own extracted CNPJ
// matches one already on file — otherwise leaves it unassigned rather than
// guessing, since picking the wrong supplier would misclassify the cluster.
function ofFindSupplierRuleForTransaction(transaction) {
  const origin = ofGetTransactionOrigin(transaction);
  const documentDigits = ofNormalizeDocument(origin.document || "");
  if (!documentDigits) return null;
  return _ofSupplierRules.find((r) => ofNormalizeDocument(r.cnpj || "") === documentDigits) || null;
}

function ofPopulateEditSupplierSelect(transaction) {
  const selectEl = document.getElementById("txEditSupplier");
  if (!selectEl) return;
  const matchedRule = ofFindSupplierRuleForTransaction(transaction);
  selectEl.innerHTML = `<option value="">— Não atribuir —</option>` + _ofSupplierRules
    .map((r) => `<option value="${r.id}" ${matchedRule?.id === r.id ? "selected" : ""}>${ofEscapeHtml(r.supplier_name)}${r.cnpj ? ` (${ofEscapeHtml(r.cnpj)})` : ""}</option>`)
    .join("");
}

// Selecting a supplier auto-fills the Cluster field with that supplier's
// known cluster, per the ask: "ao selecionar o fornecedor já deve carregar
// o cluster desse fornecedor". Doesn't touch Natureza — that axis isn't
// supplier-derived.
function ofApplySupplierClusterToForm(supplierRuleId) {
  const clusterSelect = document.getElementById("txEditCluster");
  if (!clusterSelect) return;
  const rule = _ofSupplierRules.find((r) => String(r.id) === String(supplierRuleId));
  if (rule?.cluster_category_id) {
    clusterSelect.value = rule.cluster_category_id;
  }
}

async function ofOpenTxEditModal(transaction) {
  const session = window.__lastOrgSession;
  if (!session) return;
  await ofLoadClassificationCategories(session.orgId);

  _ofEditingTx = transaction;
  const modal = document.getElementById("txEditModalRoot");
  const desc = document.getElementById("txEditDescription");
  const status = document.getElementById("txEditStatus");
  if (!modal) return;

  if (desc) desc.textContent = `${ofFormatDate(transaction.date)} · ${transaction.description || "Sem descrição"}`;
  ofPopulateEditSupplierSelect(transaction);
  ofPopulateEditSelect(document.getElementById("txEditNature"), _ofNatureCategories, transaction.nature_category_id);
  ofPopulateEditSelect(document.getElementById("txEditCluster"), _ofClusterCategories, transaction.cluster_category_id);
  if (status) status.textContent = "";
  modal.style.display = "flex";
}

function ofCloseTxEditModal() {
  const modal = document.getElementById("txEditModalRoot");
  if (modal) modal.style.display = "none";
  _ofEditingTx = null;
}

async function ofSaveTxEdit() {
  if (!_ofEditingTx) return;
  const status = document.getElementById("txEditStatus");
  const saveBtn = document.getElementById("txEditSaveBtn");
  const supplier_rule_id = document.getElementById("txEditSupplier")?.value || null;
  const nature_category_id = document.getElementById("txEditNature")?.value || null;
  const cluster_category_id = document.getElementById("txEditCluster")?.value || null;

  if (!nature_category_id && !cluster_category_id) {
    if (status) status.textContent = "Selecione ao menos uma das duas categorias.";
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando…"; }
  if (status) status.textContent = "";

  const wasIgnored = !!_ofEditingTx.cashflow_ignore;

  try {
    const { error } = await supabaseClient.functions.invoke("correct-transaction-classification", {
      body: { transaction_id: _ofEditingTx.id, nature_category_id, cluster_category_id, supplier_rule_id },
    });
    if (error) throw error;

    // A manual Natureza on a transaction the auto rules had ignored (e.g. a
    // transfer-pair false positive) needs an immediate recompute — otherwise
    // it would still show "Ignorada" here until the next scheduled run, even
    // though the correction was already saved.
    if (wasIgnored && nature_category_id && window.__lastOrgSession) {
      try {
        await supabaseClient.functions.invoke("scheduled-refresh", {
          body: { org_id: window.__lastOrgSession.orgId },
        });
      } catch (err) {
        console.warn("Recálculo de fluxo de caixa não pôde ser concluído:", err?.message || err);
      }
    }

    ofCloseTxEditModal();
    ofInvalidateAllTxCache(window.__lastOrgSession?.orgId);
    await ofRefreshOpenFinanceActiveTab();
  } catch (err) {
    console.warn("correct-transaction-classification error:", err);
    if (status) status.textContent = "Erro: " + await ofExtractInvokeErrorDetail(err);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Salvar"; }
  }
}

// ── Group/ungroup same-day transactions into one summed display row ────────
async function ofGroupSelectedTransactions() {
  const btn = document.getElementById("btnGroupTransactions");
  const session = window.__lastOrgSession;
  if (!session || _ofSelectedTxIds.size < 2) return;

  const ids = [..._ofSelectedTxIds];
  if (btn) { btn.disabled = true; btn.textContent = "Agrupando…"; }

  try {
    const { data, error } = await supabaseClient.functions.invoke("group-transactions", {
      body: { org_id: session.orgId, action: "group", transaction_ids: ids },
    });
    if (error) throw error;

    const parts = [];
    if (data?.groups_created) parts.push(`${data.groups_created} grupo(s) criado(s) (${data.transactions_grouped} transações)`);
    if (data?.skipped_single) parts.push(`${data.skipped_single} ficaram sozinhas no dia e não foram agrupadas`);
    alert(parts.length ? parts.join(" · ") + "." : "Nenhum grupo criado — selecione ao menos duas transações do mesmo dia.");

    _ofSelectedTxIds.clear();
    _ofGroupSelectionModeActive = false;
    ofInvalidateAllTxCache(session.orgId);
    await ofRefreshOpenFinanceActiveTab();
  } catch (err) {
    console.warn("group-transactions error:", err);
    alert("Erro ao agrupar transações: " + await ofExtractInvokeErrorDetail(err));
  } finally {
    ofUpdateGroupButtonState();
  }
}

async function ofUngroupTransactions(groupId) {
  const session = window.__lastOrgSession;
  if (!session || !groupId) return;
  if (!confirm("Desfazer o agrupamento dessas transações?")) return;

  try {
    const { error } = await supabaseClient.functions.invoke("group-transactions", {
      body: { org_id: session.orgId, action: "ungroup", group_id: groupId },
    });
    if (error) throw error;
    ofInvalidateAllTxCache(session.orgId);
    await ofRefreshOpenFinanceActiveTab();
  } catch (err) {
    console.warn("group-transactions ungroup error:", err);
    alert("Erro ao desagrupar: " + await ofExtractInvokeErrorDetail(err));
  }
}

// The <table> node itself persists across ofRenderTransactions repaints (only
// its innerHTML is replaced), so delegating the click/change listeners to it
// once — rather than re-binding per row — survives every re-render.
document.getElementById("openFinanceTransactionsTable")?.addEventListener("click", async (e) => {
  if (e.target.matches(".of-tx-select")) return; // handled by the "change" listener below

  const ungroupLink = e.target.closest(".of-ungroup-link");
  if (ungroupLink) {
    e.preventDefault();
    await ofUngroupTransactions(ungroupLink.dataset.groupId);
    return;
  }

  const tr = e.target.closest("tr[data-tx-id]");
  if (!tr) return;
  const tx = _ofTransactionsById.get(tr.dataset.txId);
  if (tx) ofOpenTxEditModal(tx);
});
document.getElementById("openFinanceTransactionsTable")?.addEventListener("change", (e) => {
  if (!e.target.matches(".of-tx-select")) return;
  const id = e.target.dataset.txId;
  if (e.target.checked) _ofSelectedTxIds.add(id);
  else _ofSelectedTxIds.delete(id);
  ofUpdateGroupButtonState();
});
document.getElementById("openFinanceTransactionsPagination")?.addEventListener("click", (e) => {
  const button = e.target.closest("[data-of-tx-page]");
  if (!button || button.disabled || !_ofTxLastRenderArgs) return;
  _ofTxPage += button.dataset.ofTxPage === "next" ? 1 : -1;
  ofRenderTransactions(..._ofTxLastRenderArgs, { keepPage: true });
  const scroller = document.getElementById("openFinanceTransactionsTable")?.parentElement;
  if (scroller) scroller.scrollTop = 0;
});
document.getElementById("btnGroupTransactions")?.addEventListener("click", ofOnGroupButtonClick);
document.getElementById("btnExportTransactions")?.addEventListener("click", ofDownloadTransactionsXlsx);
document.getElementById("p0ClusterDetailClose")?.addEventListener("click", () => {
  const wrap = document.getElementById("p0ClusterDetail");
  if (wrap) wrap.style.display = "none";
  // Drop the drill state too, so reopening a cluster starts at the period
  // level rather than wherever the last exploration happened to end.
  _ofClusterDrill = null;
});
document.getElementById("ofShowOnlyUnclassified")?.addEventListener("change", () => ofRefreshOpenFinanceActiveTab());
// Repaints just this chart (transactions are already cached) rather than the
// whole active tab — narrower and snappier for toggles that only affect it.
for (const id of ["ofClusterShowEntradas", "ofClusterShowTransfers"]) {
  document.getElementById(id)?.addEventListener("change", () => {
    if (window.__lastOrgSession) paintOpenFinanceClusterDistribution(window.__lastOrgSession);
  });
}
document.getElementById("dashboardRefreshBtn")?.addEventListener("click", ofOnRefreshButtonClick);
document.getElementById("txEditModalClose")?.addEventListener("click", ofCloseTxEditModal);
document.getElementById("txEditCancelBtn")?.addEventListener("click", ofCloseTxEditModal);
document.getElementById("txEditModalRoot")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("txEditModalRoot")) ofCloseTxEditModal();
});
document.getElementById("txEditSaveBtn")?.addEventListener("click", ofSaveTxEdit);
document.getElementById("txEditSupplier")?.addEventListener("change", (e) => ofApplySupplierClusterToForm(e.target.value));

window.paintOpenFinanceDashboard = paintOpenFinanceDashboard;
window.paintOpenFinanceEntradasSaidas = paintOpenFinanceEntradasSaidas;
window.paintOpenFinanceProjection13Weeks = paintOpenFinanceProjection13Weeks;
window.paintOpenFinanceBudgetVsActual = paintOpenFinanceBudgetVsActual;
window.paintOpenFinanceClusterDistribution = paintOpenFinanceClusterDistribution;
window.paintResultadosHistoricos = paintResultadosHistoricos;
window.ofClassifyTransactions = ofClassifyTransactions;
window.ofRefreshOpenFinanceActiveTab = ofRefreshOpenFinanceActiveTab;

ofSetupDateFilters();

// ── Ordem dos cards do topo ─────────────────────────────────────────────────
//
// Espelha src/domain/dashboard-layout.js, que é onde esta regra tem teste. Os
// arquivos da raiz são carregados como script clássico e não fazem `import`
//; mudou lá, muda aqui.
//
// O HTML já nasce na ordem atual, então o caso comum não toca em nó nenhum —
// só a organização com layout congelado paga o custo de reordenar.

/** @param {unknown} layout valor de organizations.dashboard_layout */
function ofCardOrderFor(layout) {
  if (layout === "v1") return ["p0CardCluster", "p0CardNatureza", "p0CardBanco"];
  return ["p0CardBanco", "p0CardNatureza", "p0CardCluster"];
}

/**
 * Aplica a ordem dos cards do topo para a organização da sessão.
 *
 * A âncora sai da posição ATUAL no DOM, não da ordem de destino. Tirá-la do
 * destino foi um bug: o último card da ordem nova é o primeiro do HTML, e o
 * `nextElementSibling` dele apontava para outro card do próprio conjunto — o
 * bloco saía embaralhado. A âncora certa é o irmão logo depois do último dos
 * três como eles estão agora, que é o gráfico que fecha o bloco.
 */
function ofApplyDashboardLayout(session) {
  if (!session || session.dashboardLayout !== "v1") return;

  const cards = ofCardOrderFor(session.dashboardLayout).map((id) => document.getElementById(id));
  if (cards.some((card) => !card)) return;

  const pai = cards[0].parentNode;
  // Os três precisam ser irmãos, senão mover um para junto dos outros o tiraria
  // de onde ele deveria estar.
  if (!pai || cards.some((card) => card.parentNode !== pai)) return;

  const irmaos = Array.from(pai.children);
  const ultimoNoDom = Math.max(...cards.map((card) => irmaos.indexOf(card)));
  const ancora = irmaos[ultimoNoDom + 1] || null;

  cards.forEach((card) => pai.insertBefore(card, ancora));
}

document.addEventListener("DOMContentLoaded", () => {
  ofSetupDateFilters();
});
