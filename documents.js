// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtBRL(n) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return (n * 100).toFixed(1).replace(".", ",") + "%";
}

function fmtX(n) {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(2).replace(".", ",") + "x";
}

function fmtDias(n) {
  if (n == null || isNaN(n)) return "—";
  return Math.round(n) + " dias";
}

function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtPeriodo(doc) {
  if (!doc.periodo_inicio) return "—";
  return doc.periodo_fim ? `${doc.periodo_inicio} – ${doc.periodo_fim}` : doc.periodo_inicio;
}

// Read MM/YYYY from the two period selects
function getPeriodoSelects(mesId, anoId) {
  const mes = document.getElementById(mesId).value;
  const ano = document.getElementById(anoId).value;
  return mes && ano ? `${mes}/${ano}` : null;
}

// Pre-fill the two period selects from a "MM/YYYY" string
function setPeriodoSelects(mesId, anoId, value) {
  if (!value) return;
  const [mes, ano] = value.split("/");
  if (mes) document.getElementById(mesId).value = mes;
  if (ano) document.getElementById(anoId).value = ano;
}

// ── Status rendering ──────────────────────────────────────────────────────────

function docStatusBadge(status) {
  if (status === "processando") {
    return `<span class="kpi-delta kd-flat doc-processing"><span class="pulse-dot"></span>Analisando…</span>`;
  }
  if (status === "concluido" || status === "pronto") {
    return `<span class="kpi-delta kd-up">✓ Concluído</span>`;
  }
  if (status === "erro") {
    return `<span class="kpi-delta kd-down">✕ Erro</span>`;
  }
  return `<span class="kpi-delta kd-flat">${status}</span>`;
}

// ── Document list ─────────────────────────────────────────────────────────────

let _allDocs = [];

function paintDocRow(d, showType) {
  const periodo  = fmtPeriodo(d);
  const canView  = d.status === "concluido" || d.status === "pronto";
  const safeName = escHtml(d.name);
  return `<tr data-doc-id="${d.id}" data-doc-name="${safeName}" data-can-view="${canView}"${canView ? ' class="doc-row-clickable"' : ''}>
    <td style="text-align:left;font-weight:600;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${safeName}">${safeName}</td>
    ${showType ? `<td style="text-align:left"><span class="doc-type-chip">${escHtml(d.type)}</span></td>` : ""}
    <td style="text-align:left;font-size:12px">${periodo}</td>
    <td style="text-align:left;color:var(--ink2);max-width:220px;font-size:12.5px">${escHtml(d.description || "—")}</td>
    <td style="font-size:12px">${escHtml(d.uploaded_by_name || "—")}</td>
    <td style="font-size:12px">${new Date(d.created_at).toLocaleDateString("pt-BR")}</td>
    <td>${docStatusBadge(d.status)}</td>
    <td style="width:36px;text-align:center">
      <button class="btn-open-doc" data-id="${d.id}" title="${d.file_path ? "Abrir documento original" : "Nenhum arquivo anexado"}" ${d.file_path ? "" : "disabled"}>↗</button>
    </td>
    <td style="width:36px;text-align:center">
      <button class="btn-row-menu" data-id="${d.id}" data-name="${safeName}" data-can-view="${canView}" title="Opções">···</button>
    </td>
  </tr>`;
}

function paintGroup(tbodyId, subId, docs, label, showType) {
  const subEl   = document.getElementById(subId);
  const tbodyEl = document.getElementById(tbodyId);
  if (!subEl || !tbodyEl) return;
  subEl.textContent = `${docs.length} ${label}`;
  tbodyEl.innerHTML = docs.map((d) => paintDocRow(d, showType)).join("") ||
    `<tr><td colspan="${showType ? 8 : 7}" style="text-align:center;color:var(--muted);padding:20px 0;font-size:13px">Nenhum documento</td></tr>`;
}

function paintDocuments(docs) {
  _allDocs = docs;
  const balancetes = docs.filter((d) => d.type === "Balancete");
  const extratos   = docs.filter((d) => d.type === "Extrato bancário");
  const outros     = docs.filter((d) => d.type !== "Balancete" && d.type !== "Extrato bancário");

  paintGroup("balanceteTbodyRows", "balanceteCountSub", balancetes, "balancete(s)", false);
  paintGroup("extratoTbodyRows",   "extratoCountSub",   extratos,   "extrato(s)",   false);
  paintGroup("outrosTbodyRows",    "outrosCountSub",    outros,     "documento(s)", true);
}

async function loadDocuments(session) {
  const { data: docs, error } = await supabaseClient
    .from("documents")
    .select("*")
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    ["balanceteCountSub", "extratoCountSub", "outrosCountSub"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "Erro ao carregar";
    });
    return [];
  }
  paintDocuments(docs);
  return docs;
}

// ── Status polling for in-progress documents ──────────────────────────────────

let _pollInterval = null;
let _prevDocStatuses = {};

function startPolling(session) {
  if (_pollInterval) return;
  _pollInterval = setInterval(async () => {
    const docs = await loadDocuments(session);
    const anyPending = docs.some((d) => d.status === "processando");
    // Auto-classify docs that just finished extraction
    for (const d of docs) {
      if (d.status === "concluido" && _prevDocStatuses[d.id] === "processando" && d.type === "Balancete") {
        triggerClassification(d.id);
      }
    }
    _prevDocStatuses = Object.fromEntries(docs.map((d) => [d.id, d.status]));
    if (!anyPending) stopPolling();
  }, 5000);
}

function stopPolling() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

// ── File upload to Supabase Storage ──────────────────────────────────────────

async function uploadFile(session, docId, file, onProgress) {
  const ext = file.name.split(".").pop();
  const filePath = `${session.orgId}/${docId}/${Date.now()}.${ext}`;

  onProgress(30, "Enviando arquivo…");
  const { error } = await supabaseClient.storage
    .from("documents")
    .upload(filePath, file, { contentType: file.type, upsert: false });

  if (error) throw new Error("Falha no upload: " + error.message);
  onProgress(70, "Arquivo enviado");
  return filePath;
}

// ── Trigger edge-function analysis ────────────────────────────────────────────

function triggerAnalysis(docId) {
  supabaseClient.functions
    .invoke("analyze-document", { body: { document_id: docId } })
    .catch((err) => console.warn("analyze-document error:", err));
}

async function reanalyzeDoc(docId, session) {
  await supabaseClient.from("documents").update({ status: "processando" }).eq("id", docId);
  await supabaseClient.from("document_analyses").delete().eq("document_id", docId);
  await supabaseClient.from("document_classifications").delete().eq("document_id", docId);
  await loadDocuments(session);
  triggerAnalysis(docId);
  startPolling(session);
}

function triggerClassification(docId) {
  supabaseClient.functions
    .invoke("classify-document", { body: { document_id: docId } })
    .catch((err) => console.warn("classify-document error:", err));
}

async function reclassifyDoc(docId, session) {
  await supabaseClient.from("document_classifications").upsert({
    document_id: docId,
    status: "processando",
  }, { onConflict: "document_id" }).then(undefined, () => {});
  triggerClassification(docId);
  alert("Classificação IA iniciada. Isso pode levar alguns segundos.");
}

// ── Analysis modal rendering ──────────────────────────────────────────────────

const IND_META = [
  { key: "liquidez_corrente",    label: "Liquidez Corrente",    fmt: fmtX,    good: (v) => v >= 1.2 },
  { key: "liquidez_seca",        label: "Liquidez Seca",        fmt: fmtX,    good: (v) => v >= 0.8 },
  { key: "liquidez_imediata",    label: "Liquidez Imediata",    fmt: fmtX,    good: (v) => v >= 0.2 },
  { key: "capital_giro_liquido", label: "Capital de Giro Líq.", fmt: fmtBRL,  good: (v) => v > 0 },
  { key: "margem_bruta",         label: "Margem Bruta",         fmt: fmtPct,  good: (v) => v >= 0.2 },
  { key: "margem_ebitda",        label: "Margem EBITDA",        fmt: fmtPct,  good: (v) => v >= 0.1 },
  { key: "margem_liquida",       label: "Margem Líquida",       fmt: fmtPct,  good: (v) => v > 0 },
  { key: "roe",                  label: "ROE",                  fmt: fmtPct,  good: (v) => v > 0.05 },
  { key: "roa",                  label: "ROA",                  fmt: fmtPct,  good: (v) => v > 0 },
  { key: "endividamento_geral",  label: "Endividamento Geral",  fmt: fmtPct,  good: (v) => v < 0.6 },
  { key: "divida_liquida_ebitda",label: "Dívida Líq./EBITDA",  fmt: fmtX,    good: (v) => v < 3 },
  { key: "cobertura_juros",      label: "Cobertura de Juros",   fmt: fmtX,    good: (v) => v >= 2 },
  { key: "pmr",                  label: "PMR",                  fmt: fmtDias, good: (v) => v < 45 },
  { key: "pmp",                  label: "PMP",                  fmt: fmtDias, good: (v) => v > 20 },
  { key: "ciclo_caixa",          label: "Ciclo de Caixa",       fmt: fmtDias, good: (v) => v < 60 },
];

const BALANCO_GROUPS = [
  { header: "ATIVO",               indent: 0, bold: true, keys: ["Ativo Total"] },
  { header: null,                   indent: 1, keys: ["Ativo Circulante"] },
  { header: null,                   indent: 2, keys: ["Caixa e Equivalentes","Contas a Receber","Estoques"] },
  { header: null,                   indent: 1, keys: ["Ativo Não Circulante"] },
  { header: "PASSIVO & PL",         indent: 0, bold: true, keys: ["Passivo Total"] },
  { header: null,                   indent: 1, keys: ["Passivo Circulante"] },
  { header: null,                   indent: 2, keys: ["Fornecedores","Empréstimos CP"] },
  { header: null,                   indent: 1, keys: ["Passivo Não Circulante"] },
  { header: null,                   indent: 2, keys: ["Empréstimos LP"] },
  { header: null,                   indent: 1, keys: ["Patrimônio Líquido"], bold: true },
];

const DRE_GROUPS = [
  { keys: ["Receita Bruta"], indent: 0 },
  { keys: ["Deduções"], indent: 1 },
  { keys: ["Receita Líquida"], indent: 0, bold: true },
  { keys: ["CMV/CPV"], indent: 1 },
  { keys: ["Lucro Bruto"], indent: 0, bold: true },
  { keys: ["Despesas Operacionais"], indent: 1 },
  { keys: ["EBITDA"], indent: 0, bold: true, highlight: true },
  { keys: ["Depreciação"], indent: 1 },
  { keys: ["EBIT"], indent: 0, bold: true },
  { keys: ["Resultado Financeiro","Despesas Financeiras"], indent: 1 },
  { keys: ["EBT"], indent: 0 },
  { keys: ["IR/CSLL"], indent: 1 },
  { keys: ["Lucro Líquido"], indent: 0, bold: true, highlight: true },
];

function buildKvRows(groups, data, moeda) {
  let html = "";
  for (const g of groups) {
    if (g.header) {
      html += `<tr class="tbl-section"><td colspan="3">${g.header}</td></tr>`;
    }
    for (const key of g.keys) {
      const row = data[key];
      if (!row) continue;
      const indent = g.indent || 0;
      const cls = [g.bold ? "tbl-bold" : "", g.highlight ? "tbl-highlight" : ""].filter(Boolean).join(" ");
      const pad = indent * 14;
      const vAtual = fmtBRL(row.atual);
      const vAnt   = fmtBRL(row.anterior);
      const diff   = row.atual - row.anterior;
      const pct    = row.anterior ? (diff / Math.abs(row.anterior)) * 100 : null;
      const pctStr = pct !== null ? `<span class="tbl-delta ${pct >= 0 ? "pos" : "neg"}">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>` : "";
      html += `<tr class="${cls}">
        <td style="padding-left:${12 + pad}px">${key}</td>
        <td class="num">${vAtual}${pctStr}</td>
        <td class="num muted">${vAnt}</td>
      </tr>`;
    }
  }
  return html;
}

function renderBalanceteAnalysis(analysis) {
  const json = analysis.raw_json;
  if (!json) {
    return `<div style="color:var(--muted);padding:24px 0">Dados do balancete não disponíveis.</div>${renderAnalysisFooter(analysis.id)}`;
  }

  const contas = json.contas || [];
  const totais = json.totais || {};
  const obs    = json.observacoes || [];

  // Find a sintético account by keyword match (nivel 1-2)
  function findSint(...keys) {
    for (const k of keys) {
      const c = contas.find((c) =>
        c.tipo === "S" && c.nivel <= 2 &&
        c.descricao?.toUpperCase().includes(k.toUpperCase())
      );
      if (c != null) return c.saldo_final ?? 0;
    }
    return null;
  }

  // KPI summary cards
  const kpis = [
    { label: "Ativo Total",       v: findSint("ATIVO TOTAL", "ATIVO") },
    { label: "Passivo Total",      v: findSint("PASSIVO TOTAL", "PASSIVO") },
    { label: "Patrimônio Líquido", v: findSint("PATRIMÔNIO LÍQUIDO", "PATRIMÔNIO L", "PATRIMÔNIO") },
    { label: "Receita",            v: findSint("RECEITA BRUTA", "RECEITA") },
    { label: "Resultado / Lucro",  v: findSint("RESULTADO DO EXERCÍCIO", "LUCRO LÍQUIDO", "RESULTADO") },
    { label: "Caixa / Disponível", v: findSint("DISPONÍV", "CAIXA", "BANCO") },
  ].filter((k) => k.v != null);

  const kpiHtml = kpis.map((k) => `
    <div class="ind-card" style="background:rgba(255,255,255,.04)">
      <div class="ind-val" style="font-size:15px">${fmtBRL(k.v)}</div>
      <div class="ind-label">${escHtml(k.label)}</div>
    </div>`).join("");

  // Summary table: nivel 1 (header rows) + nivel 2 (detail rows), sintético only
  const summaryContas = contas.filter((c) => c.nivel <= 2 && c.tipo === "S");
  const summaryRows = summaryContas.map((c) => {
    if (c.nivel === 1) {
      return `<tr class="tbl-section tbl-bold">
        <td style="padding-left:12px;font-size:11px;color:var(--muted)">${escHtml(c.codigo || "")}</td>
        <td>${escHtml(c.descricao)}</td>
        <td class="num">${fmtBRL(c.saldo_final)}</td>
      </tr>`;
    }
    return `<tr>
      <td style="padding-left:26px;font-size:11px;color:var(--muted)">${escHtml(c.codigo || "")}</td>
      <td style="padding-left:14px">${escHtml(c.descricao)}</td>
      <td class="num">${fmtBRL(c.saldo_final)}</td>
    </tr>`;
  }).join("");

  // Full detail: all contas with all columns
  const detailRows = contas.map((c) => {
    const indent = ((c.nivel || 1) - 1) * 12;
    const bStyle = c.tipo === "S" ? "font-weight:600;" : "";
    return `<tr>
      <td style="font-size:10.5px;color:var(--muted);padding-left:${12 + indent}px">${escHtml(c.codigo || "")}</td>
      <td style="padding-left:${indent}px;${bStyle}">${escHtml(c.descricao)}</td>
      <td class="num">${fmtBRL(c.saldo_anterior)}</td>
      <td class="num">${fmtBRL(c.debitos)}</td>
      <td class="num">${fmtBRL(c.creditos)}</td>
      <td class="num" style="${bStyle}">${fmtBRL(c.saldo_final)}</td>
      <td style="text-align:center;font-size:10px;color:var(--muted)">${escHtml(c.natureza || "")}</td>
    </tr>`;
  }).join("");

  const totalSaldoFin = (totais.saldo_final_ativo || 0) + (totais.saldo_final_passivo || 0);
  const totalSaldoAnt = (totais.saldo_anterior_ativo || 0) + (totais.saldo_anterior_passivo || 0);

  const obsHtml = obs.length
    ? `<div class="analysis-section"><div class="analysis-section-title">Observações</div><ul class="obs-list">${obs.map((o) => `<li>${escHtml(String(o))}</li>`).join("")}</ul></div>`
    : "";

  const rawTextHtml = analysis.raw_text
    ? `<details class="raw-toggle"><summary>Ver leitura bruta da IA</summary><pre class="raw-text">${analysis.raw_text.replace(/</g, "&lt;")}</pre></details>`
    : "";

  return `
    ${kpis.length ? `<div class="analysis-section">
      <div class="analysis-section-title">Resumo</div>
      <div class="ind-grid">${kpiHtml}</div>
    </div>` : ""}

    <div class="analysis-section">
      <div class="analysis-section-title">Grupos Contábeis (Saldo Final)</div>
      <table class="saldo-table analysis-table">
        <thead><tr>
          <th style="text-align:left;width:70px">Código</th>
          <th style="text-align:left">Descrição</th>
          <th class="num">Saldo Final</th>
        </tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>

    <details class="raw-toggle">
      <summary>Ver detalhamento completo das contas</summary>
      <div style="overflow-x:auto;margin-top:12px">
        <table class="saldo-table analysis-table" style="font-size:11.5px;min-width:700px">
          <thead><tr>
            <th style="text-align:left">Código</th>
            <th style="text-align:left">Descrição</th>
            <th class="num">Saldo Ant.</th>
            <th class="num">Débitos</th>
            <th class="num">Créditos</th>
            <th class="num">Saldo Final</th>
            <th style="text-align:center">Nat.</th>
          </tr></thead>
          <tbody>
            ${detailRows}
            <tr class="tbl-bold tbl-section">
              <td></td>
              <td style="padding-left:12px">TOTAIS</td>
              <td class="num">${fmtBRL(totalSaldoAnt)}</td>
              <td class="num">${fmtBRL(totais.debitos || 0)}</td>
              <td class="num">${fmtBRL(totais.creditos || 0)}</td>
              <td class="num">${fmtBRL(totalSaldoFin)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    ${obsHtml}
    ${rawTextHtml}
    ${renderAnalysisFooter(analysis.id)}
  `;
}

function renderAnalysisFooter(analysisId) {
  return `<div style="margin-top:28px;padding-top:14px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px">
    <span style="font-size:11px;color:var(--muted)">ID da leitura:</span>
    <code style="font-size:11px;color:var(--ink2);background:rgba(255,255,255,.06);padding:2px 8px;border-radius:4px;user-select:all">${analysisId}</code>
  </div>`;
}

function renderBalanceteParseFailure(analysis) {
  const rawTextHtml = analysis.raw_text
    ? `<details class="raw-toggle"><summary>Ver leitura bruta da IA</summary><pre class="raw-text">${escHtml(analysis.raw_text)}</pre></details>`
    : "";
  return `
    <div style="background:var(--amber-bg);border:1px solid rgba(240,169,60,.35);border-radius:10px;padding:14px 18px;margin-bottom:18px;font-size:13px;color:var(--amber-text)">
      ⚠ Não foi possível estruturar automaticamente os dados deste balancete — a resposta da IA não pôde ser interpretada como tabela (documento muito extenso ou resposta incompleta). Tente novamente em <strong>Refazer extração IA</strong>, ou consulte a leitura bruta abaixo.
    </div>
    ${rawTextHtml}
    ${renderAnalysisFooter(analysis.id)}
  `;
}

function renderAnalysisContent(analysis, docName) {
  // Balancete: JSON extraction (structured contas list)
  if (analysis.raw_json) {
    return renderBalanceteAnalysis(analysis);
  }

  // Balancete always goes through the JSON path above — if raw_json is null
  // here, the AI's response failed to parse (truncated output, stray prose
  // around the JSON, etc.), not "this document type has no table view".
  // Say so plainly instead of silently falling through to the generic
  // raw-text dump below, which reads as if a table was never built at all.
  if (analysis.tipo === "Balancete") {
    return renderBalanceteParseFailure(analysis);
  }

  const isFinancial = analysis.balanco && Object.keys(analysis.balanco).length > 0;

  if (!isFinancial) {
    const text = (analysis.raw_text || "Sem conteúdo disponível.")
      .split("\n\n")
      .map((p) => `<p>${p.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`)
      .join("");
    return `<div class="analysis-generic">${text}</div>${renderAnalysisFooter(analysis.id)}`;
  }

  const ind = analysis.indicadores || {};
  const balanco = analysis.balanco || {};
  const dre = analysis.dre || {};
  const obs = analysis.observacoes || [];
  const lim = analysis.limitacoes || [];

  const kpiCards = IND_META
    .filter((m) => ind[m.key] != null)
    .map((m) => {
      const val = ind[m.key];
      const isGood = m.good(val);
      return `<div class="ind-card ${isGood ? "ind-good" : "ind-bad"}">
        <div class="ind-val">${m.fmt(val)}</div>
        <div class="ind-label">${m.label}</div>
      </div>`;
    })
    .join("");

  const balancoRows = buildKvRows(BALANCO_GROUPS, balanco, analysis.moeda);
  const dreRows = buildKvRows(DRE_GROUPS, dre, analysis.moeda);

  const bulletsHtml = (items, title) =>
    items.length
      ? `<div class="analysis-section"><div class="analysis-section-title">${title}</div><ul class="obs-list">${items.map((o) => `<li>${o}</li>`).join("")}</ul></div>`
      : "";

  const rawToggleHtml = analysis.raw_text
    ? `<details class="raw-toggle"><summary>Ver texto bruto da IA</summary><pre class="raw-text">${analysis.raw_text.replace(/</g,"&lt;")}</pre></details>`
    : "";

  return `
    <div class="analysis-section">
      <div class="analysis-section-title">Indicadores Calculados</div>
      <div class="ind-grid">${kpiCards}</div>
    </div>

    <div class="analysis-section">
      <div class="analysis-section-title">Balanço Patrimonial
        <span class="period-chips">
          <span class="period-chip period-chip-main">${analysis.periodo || "Período atual"}</span>
          <span class="period-chip period-chip-prev">${analysis.periodo_anterior || "Período anterior"}</span>
        </span>
      </div>
      <table class="saldo-table analysis-table">
        <thead><tr><th style="text-align:left">Conta</th><th class="num">Atual</th><th class="num muted">Anterior</th></tr></thead>
        <tbody>${balancoRows}</tbody>
      </table>
    </div>

    <div class="analysis-section">
      <div class="analysis-section-title">DRE
        <span class="period-chips">
          <span class="period-chip period-chip-main">${analysis.periodo || "Período atual"}</span>
          <span class="period-chip period-chip-prev">${analysis.periodo_anterior || "Período anterior"}</span>
        </span>
      </div>
      <table class="saldo-table analysis-table">
        <thead><tr><th style="text-align:left">Conta</th><th class="num">Atual</th><th class="num muted">Anterior</th></tr></thead>
        <tbody>${dreRows}</tbody>
      </table>
    </div>

    ${bulletsHtml(obs, "Observações")}
    ${bulletsHtml(lim, "Limitações")}
    ${rawToggleHtml}
    ${renderAnalysisFooter(analysis.id)}
  `;
}

async function openOriginalDocument(docId) {
  const doc = _allDocs.find((d) => d.id === docId);
  if (!doc?.file_path) {
    alert("Nenhum arquivo original disponível para este documento.");
    return;
  }
  const { data: signed, error } = await supabaseClient.storage
    .from("documents")
    .createSignedUrl(doc.file_path, 3600);
  if (error || !signed?.signedUrl) {
    alert("Não foi possível abrir o documento original.");
    return;
  }
  window.open(signed.signedUrl, "_blank", "noopener");
}

async function openAnalysisModal(docId, docName) {
  const root = document.getElementById("analysisModalRoot");
  const content = document.getElementById("analysisContent");
  const title = document.getElementById("analysisMTitle");
  const period = document.getElementById("analysisMPeriod");
  const docLink = document.getElementById("analysisMDocLink");

  content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ink2)">Carregando análise…</div>`;
  title.textContent = docName;
  period.textContent = "";
  docLink.innerHTML = "";
  root.style.display = "flex";

  const [{ data: doc }, { data, error }] = await Promise.all([
    supabaseClient.from("documents").select("file_path").eq("id", docId).single(),
    supabaseClient
      .from("document_analyses")
      .select("*")
      .eq("document_id", docId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (error || !data) {
    content.innerHTML = `<div style="color:var(--muted);padding:24px 0">Nenhuma análise encontrada para este documento.</div>`;
    return;
  }

  if (doc?.file_path) {
    const { data: signed } = await supabaseClient.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 3600);
    if (signed?.signedUrl) {
      docLink.innerHTML = `<a href="${signed.signedUrl}" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent);text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-top:2px">↗ Abrir documento original</a>`;
    }
  }

  if (data.periodo) period.textContent = `${data.periodo}${data.periodo_anterior ? " · Anterior: " + data.periodo_anterior : ""}`;
  content.innerHTML = renderAnalysisContent(data, docName);
}

// ── Delete handler ────────────────────────────────────────────────────────────

let _deleteTarget = null;

function openDeleteModal(docId, docName) {
  _deleteTarget = docId;
  document.getElementById("deleteDocName").textContent = docName;
  document.getElementById("deleteModalRoot").style.display = "flex";
}

async function confirmDelete(session) {
  if (!_deleteTarget) return;
  const docId = _deleteTarget;
  _deleteTarget = null;
  document.getElementById("deleteModalRoot").style.display = "none";

  const { data: doc } = await supabaseClient.from("documents").select("file_path").eq("id", docId).single();
  if (doc?.file_path) {
    await supabaseClient.storage.from("documents").remove([doc.file_path]);
  }

  const { error } = await supabaseClient.from("documents").delete().eq("id", docId);
  if (error) {
    alert("Não foi possível apagar: " + error.message);
    return;
  }
  await loadDocuments(session);
}

// ── Upload modal ──────────────────────────────────────────────────────────────

let _docTypeFixed = null; // "Balancete" | "Extrato bancário" | null (outros)
let _editMode  = false;
let _editDocId = null;


function openAddModal(typeArg) {
  _docTypeFixed = typeArg === "_outros" ? null : typeArg;

  const fixedRow  = document.getElementById("docTypeFixedRow");
  const selectRow = document.getElementById("docTypeSelectRow");
  const titleEl   = document.getElementById("docModalTitle");

  if (_docTypeFixed) {
    fixedRow.style.display  = "";
    selectRow.style.display = "none";
    document.getElementById("docTypeFixedLabel").textContent = _docTypeFixed;
    titleEl.textContent = `Adicionar ${_docTypeFixed.toLowerCase()}`;
  } else {
    fixedRow.style.display  = "none";
    selectRow.style.display = "";
    titleEl.textContent = "Adicionar documento";
  }

  document.getElementById("docModalRoot").style.display = "flex";
}

function openEditModal(docId) {
  const doc = _allDocs.find((d) => d.id === docId);
  if (!doc) return;

  _editMode  = true;
  _editDocId = docId;

  // Determine fixed type (same logic as add)
  const isFixed = doc.type === "Balancete" || doc.type === "Extrato bancário";
  _docTypeFixed = isFixed ? doc.type : null;

  const fixedRow  = document.getElementById("docTypeFixedRow");
  const selectRow = document.getElementById("docTypeSelectRow");

  if (isFixed) {
    fixedRow.style.display  = "";
    selectRow.style.display = "none";
    document.getElementById("docTypeFixedLabel").textContent = doc.type;
  } else {
    fixedRow.style.display  = "none";
    selectRow.style.display = "";
    document.getElementById("docType").value = doc.type;
  }

  // Pre-fill metadata
  document.getElementById("docName").value        = doc.name || "";
  document.getElementById("docDescription").value = doc.description || "";
  setPeriodoSelects("docPeriodoInicioMes", "docPeriodoInicioAno", doc.periodo_inicio);
  setPeriodoSelects("docPeriodoFimMes",   "docPeriodoFimAno",   doc.periodo_fim);

  // Hide file input in edit mode
  document.getElementById("docFileRow").style.display = "none";

  document.getElementById("docModalTitle").textContent  = "Editar documento";
  document.getElementById("docSubmit").textContent       = "Salvar alterações";
  document.getElementById("docModalRoot").style.display  = "flex";
}

function closeAddModal() {
  document.getElementById("docModalRoot").style.display = "none";
  document.getElementById("docForm").reset();
  document.getElementById("docFileRow").style.display = "";
  document.getElementById("docModalTitle").textContent = "Adicionar documento";
  document.getElementById("docSubmit").textContent     = "Salvar e analisar";
  _docTypeFixed = null;
  _editMode     = false;
  _editDocId    = null;
}

// ── Form submit ────────────────────────────────────────────────────────────────

async function handleDocEdit(session) {
  const name        = document.getElementById("docName").value.trim();
  const type        = _docTypeFixed || document.getElementById("docType").value;
  const description = document.getElementById("docDescription").value.trim();
  const periodoIni  = getPeriodoSelects("docPeriodoInicioMes", "docPeriodoInicioAno");
  const periodoFim  = getPeriodoSelects("docPeriodoFimMes",   "docPeriodoFimAno");

  if (!name) return;

  const submitBtn = document.getElementById("docSubmit");
  submitBtn.disabled = true;

  try {
    const { error } = await supabaseClient
      .from("documents")
      .update({ name, type, description, periodo_inicio: periodoIni, periodo_fim: periodoFim })
      .eq("id", _editDocId);

    if (error) throw new Error(error.message);

    closeAddModal();
    await loadDocuments(session);
  } catch (err) {
    alert("Erro ao salvar: " + err.message);
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleDocSubmit(e, session) {
  e.preventDefault();

  if (_editMode) {
    await handleDocEdit(session);
    return;
  }
  const file        = document.getElementById("docFile").files[0];
  const name        = document.getElementById("docName").value.trim();
  const type        = _docTypeFixed || document.getElementById("docType").value;
  const description = document.getElementById("docDescription").value.trim();
  const periodoIni  = getPeriodoSelects("docPeriodoInicioMes", "docPeriodoInicioAno");
  const periodoFim  = getPeriodoSelects("docPeriodoFimMes",   "docPeriodoFimAno");

  if (!name || !description) return;

  // A multi-month balancete is now supported end-to-end (the period is sent to
  // the extraction AI and carried through DRE/DFC/projection as an accumulated
  // block), so this is no longer a "you'll break the math" warning — just a
  // confirmation that the values will be read as a period total, not a month.
  if (type === "Balancete" && periodoFim && periodoFim !== periodoIni) {
    const ok = confirm(
      `O período informado abrange mais de um mês (${periodoIni} → ${periodoFim}).\n\n` +
      "Os valores de resultado (DRE) serão lidos como o ACUMULADO de todo esse intervalo — " +
      "aparecerão como uma única coluna marcada com o total de meses, não divididos mês a mês.\n\n" +
      "Confirma que o balancete cobre esse período inteiro?"
    );
    if (!ok) return;
  }

  const submitBtn = document.getElementById("docSubmit");
  const progress  = document.getElementById("docUploadProgress");
  const fill      = document.getElementById("docUploadFill");
  const label     = document.getElementById("docUploadLabel");

  submitBtn.disabled = true;
  progress.style.display = "";

  const setProgress = (pct, msg) => {
    fill.style.width = pct + "%";
    label.textContent = msg;
  };

  try {
    setProgress(10, "Salvando documento…");

    const { data: inserted, error: insertErr } = await supabaseClient
      .from("documents")
      .insert({
        org_id: session.orgId,
        name,
        type,
        description,
        uploaded_by: session.id,
        uploaded_by_name: session.name || session.email,
        status: "processando",
        periodo_inicio: periodoIni,
        periodo_fim: periodoFim,
      })
      .select()
      .single();

    if (insertErr || !inserted) throw new Error(insertErr?.message || "Erro ao salvar");

    const docId = inserted.id;

    if (file) {
      try {
        const filePath = await uploadFile(session, docId, file, setProgress);
        await supabaseClient.from("documents").update({
          file_path: filePath,
          file_type: file.type,
          file_size: file.size,
        }).eq("id", docId);
      } catch (uploadErr) {
        console.warn("Upload failed, continuing without file:", uploadErr.message);
      }
    }

    setProgress(90, "Iniciando análise…");

    closeAddModal();
    const initialDocs = await loadDocuments(session);
    _prevDocStatuses = Object.fromEntries((initialDocs || []).map((d) => [d.id, d.status]));
    startPolling(session);

    triggerAnalysis(docId);

  } catch (err) {
    alert("Erro: " + err.message);
  } finally {
    submitBtn.disabled = false;
    progress.style.display = "none";
    fill.style.width = "0%";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  const session = await requireOrgSession();
  if (!session) return;
  renderAppShell("documents.html", session);
  renderChatWidget();

  const docs = await loadDocuments(session);
  if (docs.some((d) => d.status === "processando")) startPolling(session);

  // Add buttons (one per group)
  document.querySelectorAll(".add-doc-group-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAddModal(btn.dataset.type));
  });

  // Upload modal close
  document.getElementById("docCancel").addEventListener("click",     closeAddModal);
  document.getElementById("docModalClose").addEventListener("click", closeAddModal);
  document.getElementById("docForm").addEventListener("submit", (e) => handleDocSubmit(e, session));

  // Analysis modal
  const analysisModal = document.getElementById("analysisModalRoot");
  document.getElementById("analysisModalClose").addEventListener("click", () => (analysisModal.style.display = "none"));
  analysisModal.addEventListener("click", (e) => { if (e.target === analysisModal) analysisModal.style.display = "none"; });

  // Delete modal
  const deleteModal = document.getElementById("deleteModalRoot");
  document.getElementById("deleteModalClose").addEventListener("click", () => (deleteModal.style.display = "none"));
  document.getElementById("deleteCancelBtn").addEventListener("click",  () => (deleteModal.style.display = "none"));
  document.getElementById("deleteConfirmBtn").addEventListener("click", () => confirmDelete(session));

  // ── Row action dropdown ────────────────────────────────────────────────────
  let _menuDocId = null, _menuDocName = null, _menuCanView = false;
  const rowMenu = document.getElementById("docRowMenu");

  document.getElementById("menuViewAnalysis").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuDocId) openAnalysisModal(_menuDocId, _menuDocName);
  });
  document.getElementById("menuReextract").addEventListener("click", async () => {
    rowMenu.style.display = "none";
    if (_menuDocId) await reanalyzeDoc(_menuDocId, session);
  });
  document.getElementById("menuReclassify").addEventListener("click", async () => {
    rowMenu.style.display = "none";
    if (_menuDocId) await reclassifyDoc(_menuDocId, session);
  });
  document.getElementById("menuEdit").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuDocId) openEditModal(_menuDocId);
  });
  document.getElementById("menuDelete").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuDocId) openDeleteModal(_menuDocId, _menuDocName);
  });

  document.addEventListener("click", (e) => {
    const menuBtn    = e.target.closest(".btn-row-menu");
    const openBtn    = e.target.closest(".btn-open-doc");
    const insideMenu = e.target.closest("#docRowMenu");

    if (!insideMenu && !menuBtn) rowMenu.style.display = "none";

    if (openBtn) {
      if (!openBtn.disabled) openOriginalDocument(openBtn.dataset.id);
      return;
    }

    if (menuBtn) {
      _menuDocId   = menuBtn.dataset.id;
      _menuDocName = menuBtn.dataset.name;
      _menuCanView = menuBtn.dataset.canView === "true";
      document.getElementById("menuViewAnalysis").style.display = _menuCanView ? "" : "none";
      const rect = menuBtn.getBoundingClientRect();
      const mw   = 176;
      rowMenu.style.left  = Math.min(rect.right - mw, window.innerWidth - mw - 8) + "px";
      rowMenu.style.top   = (rect.bottom + 4) + "px";
      rowMenu.style.right = "auto";
      rowMenu.style.display = rowMenu.style.display === "block" ? "none" : "block";
      return;
    }

    if (insideMenu) return;

    // Row click → open analysis
    const tr = e.target.closest("tr[data-doc-id]");
    if (tr && tr.dataset.canView === "true") {
      openAnalysisModal(tr.dataset.docId, tr.dataset.docName);
    }
  });
})();
