// ── Aba "Fluxo de caixa" ────────────────────────────────────────────────────
//
// Pedido do Fábio (Timbre, 17/10/2026): uma tela que conta o caixa de cima
// para baixo — saldo inicial, entradas, saídas e saldo final; o gráfico do
// saldo com entradas e saídas por dia, semana, mês ou ano; a posição por
// banco e conta; a natureza; e quem pagou e quem recebeu, do maior para o
// menor. Clicar numa barra do gráfico detalha só aquele intervalo.
//
// A aba só aparece onde organizations.cash_view_enabled estiver ligado
// (20261019120000). As outras abas não sabem que esta existe.
//
// O cálculo puro está em src/domain/cashflow-view.js, com teste; as funções
// `cv*` abaixo que levam o mesmo nome o espelham. Os helpers
// `of*` vêm de openfinance-dashboard.js, que carrega antes deste arquivo.
//
// Saldo e entradas/saídas são grandezas diferentes, e a tela mostra a ponte
// entre elas em vez de escondê-la — ver o comentário no topo do módulo de
// domínio.

const CV_MAX_BUCKETS = 400;
const CV_PAYROLL_GROUP = "Folha de pagamento";
const CV_UNKNOWN_GROUP = "Sem identificação";
const CV_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const CV_GROUPS_SHOWN = 30;
const CV_ITEMS_SHOWN = 100;

let _cvGranularity = null; // escolhida pelo usuário; null = a padrão do período
let _cvFocus = null; // intervalo clicado no gráfico
let _cvPeriodKey = null;
let _cvState = null;
let _cvTitlesCache = null;
const _cvShowAllGroups = new Set();
const _cvOpen = new Set();
// Seções que nascem abertas (Entradas e Saídas na natureza) guardam o fechamento.
const _cvClosed = new Set();
const _cvLazy = new Map();
const _cvMovementsByData = new WeakMap();

// ── Espelho de src/domain/cashflow-view.js ─────────────────────────────────

function cvToUtc(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function cvToIso(date) {
  return date.toISOString().slice(0, 10);
}

function cvAddDays(iso, days) {
  const date = cvToUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return cvToIso(date);
}

function cvDefaultGranularity(from, to) {
  const days = Math.round((cvToUtc(to).getTime() - cvToUtc(from).getTime()) / 86400000) + 1;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  if (days <= 731) return "month";
  return "year";
}

function cvBucketKeyFor(iso, granularity) {
  const day = iso.slice(0, 10);
  if (granularity === "day") return day;
  if (granularity === "month") return day.slice(0, 7);
  if (granularity === "year") return day.slice(0, 4);
  const weekday = cvToUtc(day).getUTCDay();
  return cvAddDays(day, weekday === 0 ? -6 : 1 - weekday);
}

function cvBucketBounds(key, granularity) {
  if (granularity === "day") return { from: key, to: key };
  if (granularity === "week") return { from: key, to: cvAddDays(key, 6) };
  if (granularity === "year") return { from: `${key}-01-01`, to: `${key}-12-31` };
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

function cvBucketsBetween(from, to, granularity) {
  const buckets = [];
  if (!from || !to || from > to) return buckets;
  let key = cvBucketKeyFor(from, granularity);
  while (buckets.length < CV_MAX_BUCKETS) {
    const bounds = cvBucketBounds(key, granularity);
    if (bounds.from > to) break;
    buckets.push({
      key,
      from: bounds.from < from ? from : bounds.from,
      to: bounds.to > to ? to : bounds.to,
    });
    key = cvBucketKeyFor(cvAddDays(bounds.to, 1), granularity);
  }
  return buckets;
}

function cvBucketLabel(bucket, granularity) {
  const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (granularity === "day") return dm(bucket.from);
  if (granularity === "week") return `${dm(bucket.from)}–${dm(bucket.to)}`;
  if (granularity === "year") return bucket.key;
  return `${CV_MONTHS[Number(bucket.key.slice(5, 7)) - 1]}/${bucket.key.slice(2, 4)}`;
}

function cvBalancesAt(accounts, movements, asOf) {
  const balances = new Map();
  for (const account of accounts) {
    if (!account.isCash) continue;
    const value = Number(account.balance);
    balances.set(account.id, Number.isFinite(value) ? value : 0);
  }
  for (const movement of movements) {
    if (!movement.accountId || movement.date <= asOf) continue;
    const current = balances.get(movement.accountId);
    if (current === undefined) continue;
    balances.set(movement.accountId, current - (Number(movement.amount) || 0));
  }
  return balances;
}

function cvSumBalances(balances) {
  let total = 0;
  for (const value of balances.values()) total += value;
  return total;
}

function cvSummarize(transactions, amountOf) {
  let entradas = 0;
  let saidas = 0;
  let recebimentos = 0;
  let pagamentos = 0;
  for (const t of transactions) {
    const amount = amountOf(t);
    if (amount > 0) {
      entradas += amount;
      recebimentos += 1;
    } else if (amount < 0) {
      saidas += -amount;
      pagamentos += 1;
    }
  }
  return { entradas, saidas, recebimentos, pagamentos };
}

function cvBuildSeries({ transactions, accounts, movements, from, to, granularity, amountOf }) {
  const buckets = cvBucketsBetween(from, to, granularity);
  const balances = cvBalancesAt(accounts, movements, to);
  const cashIds = new Set(balances.keys());
  const byKey = new Map(buckets.map((b) => [b.key, { entradas: 0, saidas: 0, bankNet: 0 }]));

  for (const t of transactions) {
    if (t.date < from || t.date > to) continue;
    const row = byKey.get(cvBucketKeyFor(t.date, granularity));
    if (!row) continue;
    const amount = amountOf(t);
    if (amount > 0) row.entradas += amount;
    else if (amount < 0) row.saidas += -amount;
  }
  for (const m of movements) {
    if (!m.accountId || !cashIds.has(m.accountId) || m.date < from || m.date > to) continue;
    const row = byKey.get(cvBucketKeyFor(m.date, granularity));
    if (row) row.bankNet += Number(m.amount) || 0;
  }

  let running = cvSumBalances(balances);
  const rows = new Array(buckets.length);
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    const bucket = buckets[i];
    const totals = byKey.get(bucket.key);
    rows[i] = {
      ...bucket,
      label: cvBucketLabel(bucket, granularity),
      entradas: totals.entradas,
      saidas: totals.saidas,
      saldo: running,
    };
    running -= totals.bankNet;
  }
  return rows;
}

function cvNatureBreakdown(transactions, amountOf) {
  const sides = [
    { side: "entrada", label: "Entradas", total: 0, count: 0, clusters: new Map() },
    { side: "saida", label: "Saídas", total: 0, count: 0, clusters: new Map() },
  ];
  for (const t of transactions) {
    const amount = amountOf(t);
    if (!amount) continue;
    const side = amount > 0 ? sides[0] : sides[1];
    const label = (t.cluster_label ?? "").trim() || "Sem classificação";
    const key = label.toLocaleLowerCase("pt-BR");
    const cluster = side.clusters.get(key) ?? { label, total: 0, count: 0, transactions: [] };
    cluster.total += Math.abs(amount);
    cluster.count += 1;
    cluster.transactions.push(t);
    side.clusters.set(key, cluster);
    side.total += Math.abs(amount);
    side.count += 1;
  }
  return sides.map((s) => ({
    side: s.side,
    label: s.label,
    total: s.total,
    count: s.count,
    clusters: [...s.clusters.values()].sort((a, b) => b.total - a.total),
  }));
}

function cvCleanErpName(name) {
  return String(name ?? "").replace(/\s+\d{3,}-[A-Z]\s*$/, "").replace(/\s+/g, " ").trim();
}

function cvMaskCpf(text) {
  return String(text ?? "").replace(/(^|\D)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d|\.\d|\/)/g, "$1***");
}

const CV_PAYROLL_DESCRIPTION = /SISPAG SALARIOS|PAGAMENTO DE SALARIO|\bPAGSAL\b|\bFOLHA DE PAGAMENTO\b/i;

function cvCleanBankDescription(text) {
  let cnpj = "";
  const withoutCnpj = cvMaskCpf(text).replace(/(^|\D)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/, (_m, lead, doc) => {
    const d = doc.replace(/\D/g, "");
    cnpj = `CNPJ ${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    return lead;
  });
  const name = withoutCnpj
    .split(/\s+/)
    .filter((token) => token && !/\d/.test(token) && !/^DOCTO:?$/i.test(token))
    .join(" ")
    .replace(/[\s:\-–·/]+$/, "")
    .trim();
  return [name, cnpj].filter(Boolean).join(" · ");
}

function cvCounterpartyGroups(transactions, { side, amountOf, nameOf, isPayroll, titlesOf }) {
  const groups = new Map();
  let grandTotal = 0;

  const add = (name, source, t, amount, partial) => {
    const key = `${source === "erp" ? "bank" : source}|${name.toLocaleLowerCase("pt-BR")}`;
    const group = groups.get(key) ?? { name, source, total: 0, count: 0, items: [] };
    if (source === "erp") group.source = "erp";
    group.total += amount;
    group.count += 1;
    group.items.push({ transaction: t, amount, partial });
    groups.set(key, group);
  };

  for (const t of transactions) {
    const signed = amountOf(t);
    if (side === "entrada" ? signed <= 0 : signed >= 0) continue;
    const amount = Math.abs(signed);
    grandTotal += amount;

    if (isPayroll(t)) {
      add(CV_PAYROLL_GROUP, "payroll", t, amount, false);
      continue;
    }

    const titles = titlesOf?.(t) ?? [];
    if (titles.length) {
      const bySupplier = new Map();
      let titlesTotal = 0;
      for (const title of titles) {
        const name = cvCleanErpName(title.supplier) || CV_UNKNOWN_GROUP;
        const value = Math.abs(Number(title.amount) || 0);
        const entry = bySupplier.get(name.toLocaleLowerCase("pt-BR")) ?? { name, value: 0 };
        entry.value += value;
        bySupplier.set(name.toLocaleLowerCase("pt-BR"), entry);
        titlesTotal += value;
      }
      if (titlesTotal > 0) {
        const parts = [...bySupplier.values()];
        const partial = parts.length > 1;
        let assigned = 0;
        parts.forEach((part, index) => {
          const share = index === parts.length - 1
            ? Math.round((amount - assigned) * 100) / 100
            : Math.round((amount * part.value / titlesTotal) * 100) / 100;
          assigned += share;
          add(part.name, "erp", t, share, partial);
        });
        continue;
      }
    }

    add(cvMaskCpf(nameOf(t)).trim() || CV_UNKNOWN_GROUP, "bank", t, amount, false);
  }

  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  for (const group of list) group.items.sort((a, b) => b.amount - a.amount);
  const top3 = list.slice(0, 3).reduce((sum, g) => sum + g.total, 0);
  return {
    groups: list,
    total: grandTotal,
    top3Share: grandTotal > 0 ? top3 / grandTotal : 0,
  };
}

// ── Dados ──────────────────────────────────────────────────────────────────

// Valor bruto, com o sinal do banco, de cada transação: é ele que move o
// saldo da conta, inclusive na transferência entre contas próprias.
function cvMovements(data) {
  let movements = _cvMovementsByData.get(data.transactions);
  if (!movements) {
    movements = data.transactions.map((t) => ({
      accountId: ofGetTransactionAccountId(t),
      date: String(t.date || "").slice(0, 10),
      amount: Number(t.amount || 0),
    }));
    _cvMovementsByData.set(data.transactions, movements);
  }
  return movements;
}

function cvCashAccounts(accounts) {
  return accounts.map((account) => ({
    id: ofGetAccountId(account),
    balance: account.balance,
    isCash: !ofIsCreditCardAccount(account),
  }));
}

// Títulos do ERP casados com as saídas (exato ou lote), por transação. A
// janela sobra uns dias de cada lado porque o título pode ter sido pago um ou
// dois dias antes de cair no banco. Organização sem base de ERP recebe um
// mapa vazio, e a contraparte fica sendo o nome que o banco informa.
async function cvLoadErpTitles(orgId, from, to) {
  const key = `${orgId}|${from}|${to}`;
  if (_cvTitlesCache?.key === key) return _cvTitlesCache.promise;

  const promise = (async () => {
    const byTx = new Map();
    const filters = (q) => q
      .eq("org_id", orgId)
      .not("matched_transaction_id", "is", null)
      .gte("paid_on", cvAddDays(from, -10))
      .lte("paid_on", cvAddDays(to, 10));

    const { count, error } = await filters(
      supabaseClient.from("erp_payment_titles").select("id", { count: "exact", head: true })
    );
    if (error || !count) return byTx;

    const pageSize = 1000;
    const pageCount = Math.min(Math.ceil(count / pageSize), 200);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, pageCount) }, async () => {
      while (next < pageCount) {
        const page = next++;
        const { data, error: pageError } = await filters(
          supabaseClient.from("erp_payment_titles").select("id, matched_transaction_id, supplier, amount")
        ).order("id", { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1);
        if (pageError) throw pageError;
        for (const row of data || []) {
          const list = byTx.get(row.matched_transaction_id) || [];
          list.push(row);
          byTx.set(row.matched_transaction_id, list);
        }
      }
    }));
    return byTx;
  })();

  _cvTitlesCache = { key, promise };
  promise.catch(() => {
    if (_cvTitlesCache?.promise === promise) _cvTitlesCache = null;
  });
  return promise;
}

// ── Liga a aba ─────────────────────────────────────────────────────────────

async function cvSetupTab(session) {
  const tab = document.getElementById("cvTab");
  if (!tab || !session?.orgId) return;

  try {
    const { data, error } = await supabaseClient
      .from("organizations")
      .select("cash_view_enabled")
      .eq("id", session.orgId)
      .maybeSingle();
    // Erro aqui (coluna ainda não criada, rede) só deixa a aba escondida.
    if (error || !data?.cash_view_enabled) return;
  } catch (err) {
    console.warn("Fluxo de caixa: não foi possível ler a configuração da organização", err);
    return;
  }

  tab.hidden = false;

  document.getElementById("cvGranularity")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-g]");
    if (!button) return;
    _cvGranularity = button.dataset.g;
    _cvFocus = null;
    window.paintCashflowView(session);
  });

  document.getElementById("cvFocusClear")?.addEventListener("click", () => cvSetFocus(null));

  document.getElementById("cvAllAccounts")?.addEventListener("change", () => cvRenderBanks());

  document.getElementById("p4")?.addEventListener("click", (event) => {
    const more = event.target.closest("[data-cv-more]");
    if (more) {
      _cvShowAllGroups.add(more.dataset.cvMore);
      cvRenderCounterparties();
      return;
    }
    const toggle = event.target.closest("[data-cv-toggle]");
    if (toggle) cvToggle(toggle.dataset.cvToggle, toggle);
  });

  document.getElementById("p4")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const toggle = event.target.closest("[data-cv-toggle]");
    if (!toggle) return;
    event.preventDefault();
    cvToggle(toggle.dataset.cvToggle, toggle);
  });
}

function cvToggle(key, toggle) {
  const body = document.querySelector(`[data-cv-body="${CSS.escape(key)}"]`);
  if (!body) return;
  const opening = body.hidden;
  if (opening && !body.dataset.filled && _cvLazy.has(key)) {
    body.innerHTML = _cvLazy.get(key)();
    body.dataset.filled = "1";
  }
  const remembered = body.dataset.defaultOpen ? _cvClosed : _cvOpen;
  if (opening === Boolean(body.dataset.defaultOpen)) remembered.delete(key);
  else remembered.add(key);
  body.hidden = !opening;
  toggle.setAttribute("aria-expanded", String(opening));
}

// ── Pintura ────────────────────────────────────────────────────────────────

window.paintCashflowView = async function paintCashflowView(session) {
  const generation = ofNextRenderGeneration("cashflowView");
  const { from, to } = ofGetDateRange();

  if (!from || !to) {
    document.getElementById("cvCards").innerHTML =
      `<div class="cs">Selecione um período no topo da página.</div>`;
    return;
  }

  const periodKey = `${from}|${to}`;
  if (periodKey !== _cvPeriodKey) {
    _cvPeriodKey = periodKey;
    _cvFocus = null;
  }

  const granularity = _cvGranularity || cvDefaultGranularity(from, to);
  document.querySelectorAll("#cvGranularity [data-g]").forEach((button) => {
    button.classList.toggle("on", button.dataset.g === granularity);
  });
  document.getElementById("cvPeriodLabel").textContent =
    `Período: ${ofFormatDate(from)} a ${ofFormatDate(to)}`;

  ofSetChartLoading("c-cv-fluxo", true);

  let data;
  let titlesByTx;
  try {
    [data, titlesByTx] = await Promise.all([
      ofGetAllClassifiedTransactions(session),
      cvLoadErpTitles(session.orgId, from, to).catch((err) => {
        console.warn("Fluxo de caixa: títulos do ERP indisponíveis", err);
        return new Map();
      }),
    ]);
  } catch (err) {
    if (ofIsStaleRender("cashflowView", generation)) return;
    ofSetChartLoading("c-cv-fluxo", false);
    document.getElementById("cvCards").innerHTML =
      `<div class="cs">Não foi possível carregar as transações. Tente "Atualizar".</div>`;
    console.error("Fluxo de caixa:", err);
    return;
  }
  if (ofIsStaleRender("cashflowView", generation)) return;

  const accounts = cvCashAccounts(data.accounts);
  const movements = cvMovements(data);
  const periodTx = data.transactions.filter((t) => t.date >= from && t.date <= to);
  const series = cvBuildSeries({
    transactions: periodTx,
    accounts,
    movements,
    from,
    to,
    granularity,
    amountOf: ofEffectiveAmount,
  });

  _cvState = {
    from,
    to,
    granularity,
    data,
    accounts,
    movements,
    periodTx,
    series,
    titlesByTx,
    bankByAccount: ofBuildBankNameByAccountId(data.accounts, data.pluggyItemsById),
  };

  cvRenderChart();
  cvRenderDetail();
};

function cvRange() {
  return _cvFocus || { from: _cvState.from, to: _cvState.to };
}

function cvTransactionsInRange() {
  const { from, to } = cvRange();
  return _cvState.periodTx.filter((t) => t.date >= from && t.date <= to);
}

function cvSetFocus(bucket) {
  const same = bucket && _cvFocus && _cvFocus.key === bucket.key;
  _cvFocus = bucket && !same ? bucket : null;
  cvPaintChartSelection();
  cvRenderDetail();
}

function cvRenderDetail() {
  if (!_cvState) return;
  _cvLazy.clear();

  const focus = document.getElementById("cvFocus");
  if (focus) {
    focus.hidden = !_cvFocus;
    if (_cvFocus) {
      document.getElementById("cvFocusText").textContent =
        `Detalhando ${_cvFocus.from === _cvFocus.to
          ? ofFormatDate(_cvFocus.from)
          : `${ofFormatDate(_cvFocus.from)} a ${ofFormatDate(_cvFocus.to)}`}`;
    }
  }

  const transactions = cvTransactionsInRange();
  cvRenderCards(transactions);
  cvRenderBanks(transactions);
  cvRenderNature(transactions);
  cvRenderCounterparties(transactions);
}

function cvMoney(value) {
  return ofFormatCurrency(value, "BRL");
}

function cvRenderCards(transactions) {
  const el = document.getElementById("cvCards");
  if (!el) return;

  const { from, to } = cvRange();
  const totals = cvSummarize(transactions, ofEffectiveAmount);
  const inicial = cvSumBalances(cvBalancesAt(_cvState.accounts, _cvState.movements, cvAddDays(from, -1)));
  const final = cvSumBalances(cvBalancesAt(_cvState.accounts, _cvState.movements, to));
  const outros = final - inicial - (totals.entradas - totals.saidas);

  const card = (label, value, sub, cls = "") => `
    <div class="kpi cv-card ${cls}">
      <div class="kpi-label">${ofEscapeHtml(label)}</div>
      <div class="kpi-value">${cvMoney(value)}</div>
      <div class="kpi-sub cs">${ofEscapeHtml(sub)}</div>
    </div>`;

  el.innerHTML = `
    <div class="cv-cards-row">
      ${card("Saldo inicial", inicial, `Posição em ${ofFormatDate(cvAddDays(from, -1))}`)}
      <span class="cv-op" aria-hidden="true">+</span>
      ${card("Entradas", totals.entradas, `${totals.recebimentos} recebimento(s)`, "is-in")}
      <span class="cv-op" aria-hidden="true">−</span>
      ${card("Saídas", totals.saidas, `${totals.pagamentos} pagamento(s)`, "is-out")}
      <span class="cv-op" aria-hidden="true">=</span>
      ${card("Saldo final", final, `Posição em ${ofFormatDate(to)}`, "is-total")}
    </div>
    ${Math.abs(outros) >= 0.01
      ? `<div class="cs cv-bridge">
           Inclui ${cvMoney(outros)} de movimentos que mudam o saldo dos bancos mas não são entrada nem saída:
           transferências entre contas próprias, pagamento de fatura de cartão e compras no cartão
           (que contam como saída, mas não saem da conta corrente no dia).
         </div>`
      : ""}
  `;
}

function cvRenderChart() {
  const canvas = document.getElementById("c-cv-fluxo");
  ofSetChartLoading("c-cv-fluxo", false);
  if (!canvas) return;
  if (typeof Chart === "undefined") {
    ofShowChartUnavailable("c-cv-fluxo", "Não foi possível carregar a biblioteca de gráficos. Os valores abaixo continuam corretos — recarregue a página para tentar de novo.");
    return;
  }
  ofClearChartUnavailable("c-cv-fluxo");
  ofDestroyChartById("c-cv-fluxo");

  const rows = _cvState.series;
  const tick = { color: "#9aa0b4", callback: (value) => ofFormatCurrency(value, "BRL", true) };

  new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map((row) => row.label),
      datasets: [
        { label: "Entradas", data: rows.map((row) => row.entradas), backgroundColor: "#2dd4a0", borderRadius: 3, yAxisID: "y", stack: "fluxo", order: 2 },
        { label: "Saídas", data: rows.map((row) => -row.saidas), backgroundColor: "#ff8a5b", borderRadius: 3, yAxisID: "y", stack: "fluxo", order: 2 },
        {
          label: "Saldo",
          type: "line",
          data: rows.map((row) => row.saldo),
          borderColor: "#9b86fb",
          backgroundColor: "#9b86fb",
          borderWidth: 2.5,
          pointRadius: rows.length > 60 ? 0 : 3,
          tension: 0.25,
          yAxisID: "y2",
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length ? "pointer" : "default";
      },
      onClick: (_event, elements) => {
        if (!elements.length) return;
        const row = _cvState.series[elements[0].index];
        if (row) cvSetFocus({ key: row.key, from: row.from, to: row.to });
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
            title: (items) => {
              const row = _cvState.series[items[0]?.dataIndex];
              if (!row) return "";
              return row.from === row.to ? ofFormatDate(row.from) : `${ofFormatDate(row.from)} a ${ofFormatDate(row.to)}`;
            },
            label: (context) => `${context.dataset.label}: ${cvMoney(Math.abs(context.raw))}`,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { color: "rgba(255,255,255,.07)" }, ticks: { color: "#9aa0b4", maxRotation: 45, autoSkip: true } },
        y: { stacked: true, position: "left", grid: { color: "rgba(255,255,255,.07)" }, ticks: tick },
        y2: { position: "right", grid: { display: false }, ticks: tick },
      },
    },
  });

  cvPaintChartSelection();
}

// A barra escolhida fica com a cor cheia e as outras esmaecem.
function cvPaintChartSelection() {
  const canvas = document.getElementById("c-cv-fluxo");
  const chart = typeof Chart !== "undefined" && canvas ? Chart.getChart(canvas) : null;
  if (!chart || !_cvState) return;
  const selected = _cvFocus ? _cvState.series.findIndex((row) => row.key === _cvFocus.key) : -1;
  const paint = (color, faded) => _cvState.series.map((_, i) => (selected === -1 || i === selected ? color : faded));
  chart.data.datasets[0].backgroundColor = paint("#2dd4a0", "rgba(45,212,160,.28)");
  chart.data.datasets[1].backgroundColor = paint("#ff8a5b", "rgba(255,138,91,.28)");
  chart.update("none");
}

function cvAccountLabel(account) {
  const label = ofGetAccountLabel(account);
  return account.number && !String(label).includes(account.number) ? `${label} · ${account.number}` : label;
}

function cvRenderBanks(transactionsArg) {
  const el = document.getElementById("cvBanks");
  if (!el || !_cvState) return;
  const transactions = transactionsArg || cvTransactionsInRange();
  const showAll = document.getElementById("cvAllAccounts")?.checked === true;
  const { from, to } = cvRange();

  const inicial = cvBalancesAt(_cvState.accounts, _cvState.movements, cvAddDays(from, -1));
  const final = cvBalancesAt(_cvState.accounts, _cvState.movements, to);

  const flowByAccount = new Map();
  for (const t of transactions) {
    const id = ofGetTransactionAccountId(t);
    const flow = flowByAccount.get(id) || { entradas: 0, saidas: 0, n: 0 };
    const amount = ofEffectiveAmount(t);
    if (amount > 0) flow.entradas += amount;
    if (amount < 0) flow.saidas += -amount;
    flow.n += 1;
    flowByAccount.set(id, flow);
  }

  const banks = new Map();
  for (const account of _cvState.data.accounts) {
    const id = ofGetAccountId(account);
    const isCash = !ofIsCreditCardAccount(account);
    const flow = flowByAccount.get(id) || { entradas: 0, saidas: 0, n: 0 };
    const ini = isCash ? (inicial.get(id) ?? 0) : null;
    const fim = isCash ? (final.get(id) ?? 0) : null;
    const quiet = !flow.n && Math.abs(ini || 0) < 0.005 && Math.abs(fim || 0) < 0.005;
    if (quiet && !showAll) continue;

    const bankName = _cvState.bankByAccount.get(id) || "Instituição financeira";
    const bank = banks.get(bankName) || { name: bankName, ini: 0, fim: 0, entradas: 0, saidas: 0, rows: [] };
    const outros = isCash ? fim - ini - (flow.entradas - flow.saidas) : null;
    bank.ini += ini || 0;
    bank.fim += fim || 0;
    bank.entradas += flow.entradas;
    bank.saidas += flow.saidas;
    bank.rows.push({ label: cvAccountLabel(account), isCash, ini, fim, outros, ...flow });
    banks.set(bankName, bank);
  }

  const list = [...banks.values()].sort((a, b) => b.fim - a.fim);
  if (!list.length) {
    el.innerHTML = `<div class="cs" style="padding:8px 0">Nenhuma conta com saldo ou movimento no período.</div>`;
    return;
  }

  const cells = (r) => `
    <span class="cv-num">${r.ini == null ? "—" : cvMoney(r.ini)}</span>
    <span class="cv-num kv-pos">${cvMoney(r.entradas)}</span>
    <span class="cv-num kv-neg">${cvMoney(-r.saidas)}</span>
    <span class="cv-num cv-dim">${r.outros == null ? "—" : cvMoney(r.outros)}</span>
    <span class="cv-num cv-strong">${r.fim == null ? "—" : cvMoney(r.fim)}</span>`;

  const total = list.reduce((acc, b) => ({
    ini: acc.ini + b.ini,
    fim: acc.fim + b.fim,
    entradas: acc.entradas + b.entradas,
    saidas: acc.saidas + b.saidas,
  }), { ini: 0, fim: 0, entradas: 0, saidas: 0 });
  total.outros = total.fim - total.ini - (total.entradas - total.saidas);

  el.innerHTML = `
    <div class="cv-grid cv-banks">
      <div class="cv-row cv-head">
        <span>Banco / conta</span><span class="cv-num">Saldo inicial</span><span class="cv-num">Entradas</span>
        <span class="cv-num">Saídas</span><span class="cv-num" title="Transferências entre contas próprias e outros movimentos que não são entrada nem saída">Transf. e outros</span>
        <span class="cv-num">Saldo final</span>
      </div>
      ${list.map((bank) => {
        const key = `bank|${bank.name}`;
        const open = _cvOpen.has(key);
        const outros = bank.fim - bank.ini - (bank.entradas - bank.saidas);
        return `
          <div class="cv-row cv-l1 cv-click" role="button" tabindex="0" aria-expanded="${open}" data-cv-toggle="${ofEscapeHtml(key)}">
            <span><span class="cv-caret"></span>${ofEscapeHtml(bank.name)} <span class="cs">(${bank.rows.length} conta${bank.rows.length === 1 ? "" : "s"})</span></span>
            ${cells({ ...bank, outros })}
          </div>
          <div data-cv-body="${ofEscapeHtml(key)}" data-filled="1" ${open ? "" : "hidden"}>
            ${bank.rows.map((row) => `
              <div class="cv-row cv-l2">
                <span>${ofEscapeHtml(row.label)}${row.isCash ? "" : ` <span class="cs">(cartão — fora do saldo)</span>`}</span>
                ${cells(row)}
              </div>`).join("")}
          </div>`;
      }).join("")}
      <div class="cv-row cv-total">
        <span>Total</span>
        ${cells(total)}
      </div>
    </div>`;
}

function cvTxListHtml(entries, { showPartial = false, sign = 1 } = {}) {
  const shown = entries.slice(0, CV_ITEMS_SHOWN);
  return `
    <div class="cv-tx">
      ${shown.map(({ transaction: t, amount, partial }) => {
        const bank = _cvState.bankByAccount.get(ofGetTransactionAccountId(t)) || "";
        // Na contraparte o valor vem sem sinal (pode ser a parte de um lote).
        const value = amount == null ? ofEffectiveAmount(t) : sign * amount;
        return `
          <div class="cv-tx-row">
            <span class="cv-dim">${ofFormatDate(t.date)}</span>
            <span class="cv-desc">${ofEscapeHtml(cvMaskCpf(t.description))}${showPartial && partial
              ? ` <span class="cs">(parte do lote de ${cvMoney(Math.abs(ofEffectiveAmount(t)))})</span>`
              : ""}</span>
            <span class="cv-dim">${ofEscapeHtml(bank)}</span>
            <span class="cv-num ${value < 0 ? "kv-neg" : "kv-pos"}">${cvMoney(value)}</span>
          </div>`;
      }).join("")}
      ${entries.length > shown.length
        ? `<div class="cs cv-more-note">Mostrando os ${shown.length} maiores de ${entries.length} lançamentos. A lista completa está na aba Open Finance.</div>`
        : ""}
    </div>`;
}

function cvRenderNature(transactions) {
  const el = document.getElementById("cvNature");
  if (!el) return;
  const sides = cvNatureBreakdown(transactions, ofEffectiveAmount);
  if (!sides[0].count && !sides[1].count) {
    el.innerHTML = `<div class="cs" style="padding:8px 0">Sem entradas nem saídas no período.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="cv-grid cv-nature">
      ${sides.map((side) => {
        const sideKey = `nat|${side.side}`;
        const sideOpen = !_cvClosed.has(sideKey);
        const sign = side.side === "saida" ? -1 : 1;
        return `
          <div class="cv-row cv-l1 cv-click" role="button" tabindex="0" aria-expanded="${sideOpen}" data-cv-toggle="${sideKey}">
            <span><span class="cv-caret"></span>${side.label} <span class="cs">(${side.count})</span></span>
            <span></span>
            <span class="cv-num cv-strong ${sign < 0 ? "kv-neg" : "kv-pos"}">${cvMoney(sign * side.total)}</span>
          </div>
          <div data-cv-body="${sideKey}" data-filled="1" data-default-open="1" ${sideOpen ? "" : "hidden"}>
            ${side.clusters.map((cluster) => {
              const key = `${sideKey}|${cluster.label}`;
              const share = side.total ? cluster.total / side.total : 0;
              const open = _cvOpen.has(key);
              _cvLazy.set(key, () => cvTxListHtml(
                [...cluster.transactions]
                  .sort((a, b) => Math.abs(ofEffectiveAmount(b)) - Math.abs(ofEffectiveAmount(a)))
                  .map((t) => ({ transaction: t }))
              ));
              return `
                <div class="cv-row cv-l2 cv-click" role="button" tabindex="0" aria-expanded="${open}" data-cv-toggle="${ofEscapeHtml(key)}">
                  <span><span class="cv-caret"></span>${ofEscapeHtml(cluster.label)} <span class="cs">(${cluster.count})</span></span>
                  <span class="cv-share"><i style="width:${(share * 100).toFixed(1)}%"></i><b>${(share * 100).toFixed(1).replace(".", ",")}%</b></span>
                  <span class="cv-num">${cvMoney(sign * cluster.total)}</span>
                </div>
                <div data-cv-body="${ofEscapeHtml(key)}" ${open ? `data-filled="1"` : "hidden"}>${open ? _cvLazy.get(key)() : ""}</div>`;
            }).join("")}
          </div>`;
      }).join("")}
    </div>`;
}

function cvRenderCounterparties(transactionsArg) {
  if (!_cvState) return;
  const transactions = transactionsArg || cvTransactionsInRange();
  const options = {
    amountOf: ofEffectiveAmount,
    nameOf: (t) => t.counterparty_name || cvCleanBankDescription(t.description),
    isPayroll: (t) => ofIsSensitivePayrollTransaction(t) || CV_PAYROLL_DESCRIPTION.test(t.description || ""),
    titlesOf: (t) => _cvState.titlesByTx.get(t.id),
  };

  for (const side of ["entrada", "saida"]) {
    const el = document.getElementById(side === "entrada" ? "cvRecebimentos" : "cvPagamentos");
    const sub = document.getElementById(side === "entrada" ? "cvRecebimentosSub" : "cvPagamentosSub");
    if (!el) continue;

    const result = cvCounterpartyGroups(transactions, { side, ...options });
    if (sub) {
      sub.textContent = result.groups.length
        ? `${result.groups.length} contraparte(s) · ${cvMoney(result.total)} · as 3 maiores somam ${(result.top3Share * 100).toFixed(0)}%`
        : side === "entrada" ? "Por quem pagou, do maior para o menor" : "Por fornecedor, do maior para o menor";
    }
    if (!result.groups.length) {
      el.innerHTML = `<div class="cs" style="padding:8px 0">Nenhum ${side === "entrada" ? "recebimento" : "pagamento"} no período.</div>`;
      continue;
    }

    const showAll = _cvShowAllGroups.has(side);
    const groups = showAll ? result.groups : result.groups.slice(0, CV_GROUPS_SHOWN);
    const sign = side === "saida" ? -1 : 1;

    el.innerHTML = `
      <div class="cv-grid cv-parties">
        ${groups.map((group, index) => {
          const key = `cp|${side}|${group.source}|${group.name}`;
          const open = _cvOpen.has(key);
          const share = result.total ? group.total / result.total : 0;
          _cvLazy.set(key, () => cvTxListHtml(group.items, { showPartial: true, sign }));
          const badge = group.source === "erp" ? `<span class="cv-badge" title="Fornecedor ou cliente do título do ERP casado com o pagamento">ERP</span>` : "";
          return `
            <div class="cv-row cv-l2 cv-click" role="button" tabindex="0" aria-expanded="${open}" data-cv-toggle="${ofEscapeHtml(key)}">
              <span><span class="cv-caret"></span><span class="cv-rank">${index + 1}</span>${ofEscapeHtml(group.name)} ${badge}<span class="cs"> (${group.count})</span></span>
              <span class="cv-share"><i style="width:${(share * 100).toFixed(1)}%"></i><b>${(share * 100).toFixed(1).replace(".", ",")}%</b></span>
              <span class="cv-num">${cvMoney(sign * group.total)}</span>
            </div>
            <div data-cv-body="${ofEscapeHtml(key)}" ${open ? `data-filled="1"` : "hidden"}>${open ? _cvLazy.get(key)() : ""}</div>`;
        }).join("")}
      </div>
      ${!showAll && result.groups.length > groups.length
        ? `<button class="btn-secondary cv-more" type="button" data-cv-more="${side}">Mostrar todas (${result.groups.length})</button>`
        : ""}`;
  }
}
