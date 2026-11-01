// resultados.js — Demonstrações financeiras consolidadas (multi-período)

// ── Color palette ─────────────────────────────────────────────────────────────
const _RC = {
  mint: "#2dd4a0", amber: "#f0a93c", violet: "#9b86fb",
  blue: "#5b9dff", red: "#ff6b6b", ink: "#f3f4f7", muted: "#9aa0b4",
};
const _RGC = "rgba(255,255,255,.07)";
const _RTT = {
  backgroundColor: "#1b1d27", borderColor: "rgba(255,255,255,.12)", borderWidth: 1,
  titleColor: _RC.ink, bodyColor: "#cfd2dc", padding: 10, boxPadding: 4,
};
const _rCharts = {};
function _dC(id) {
  if (_rCharts[id]) { _rCharts[id].destroy(); delete _rCharts[id]; }
}

// ── Formatting (self-contained — no external helpers required) ────────────────
function _fmtBRL(v) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function _fmt(v)    { return (v == null || isNaN(v)) ? "—" : _fmtBRL(v); }
function _fmtC(v)   { return (v == null || isNaN(v)) ? "—" : _fmtBRL(v); }
function _fmtPct(v) { return (v == null || isNaN(v)) ? "—" : (v * 100).toFixed(1).replace(".", ",") + "%"; }
function _fmtK(v) { return _fmt(v); }
function _esc(s)    {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Period utilities ──────────────────────────────────────────────────────────
function parsePeriod(p) {
  const [mm, yyyy] = (p || "").split("/");
  if (!mm || !yyyy) return new Date(0);
  return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, 1);
}

// `end` is the document's periodo_fim when the upload covers a range. A
// balancete spanning several months used to be labelled with just its first
// month, so a quarter's movement looked like a single month's — showing the
// range makes that visible instead of silently misleading.
function periodLabel(p, end) {
  const MO = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const fmt = (v) => {
    const [mm, yyyy] = (v || "").split("/");
    if (!mm || !yyyy) return null;
    return (MO[parseInt(mm, 10) - 1] || mm) + "/" + String(yyyy).slice(2);
  };
  const start = fmt(p);
  if (!start) return p || "—";
  const finish = end && end !== p ? fmt(end) : null;
  return finish ? `${start}–${finish}` : start;
}

// Absolute month index, so ranges can be compared as simple intervals.
function periodIndex(p) {
  const [mm, yyyy] = (p || "").split("/");
  if (!mm || !yyyy) return null;
  return parseInt(yyyy, 10) * 12 + parseInt(mm, 10);
}

// How many months a row covers — 1 unless the balancete declared a range.
function periodMonths(r) {
  const a = periodIndex(r.period);
  const b = periodIndex(r.periodEnd || r.period);
  if (a == null || b == null) return 1;
  return Math.max(1, b - a + 1);
}

// Now that a balancete can cover a range, two new failure modes matter far
// more than the duplicate check did on its own: overlapping documents would
// double-count the shared months, and a gap means months are silently missing
// from the consolidated view. Both are invisible without an explicit warning.
// Agrupa por empresa antes de comparar: duas empresas entregando balancete do
// mesmo mês é normal, e sem separar isso a checagem acusaria duplicidade e
// bloquearia um envio legítimo.
//
// Espelha checkPeriodIssues de src/domain/period.js, que é onde há teste.
function checkPeriodIssues(rows) {
  const byCompany = new Map();
  for (const row of rows || []) {
    const key = row.companyId || "";
    const group = byCompany.get(key);
    if (group) group.push(row);
    else byCompany.set(key, [row]);
  }

  const nameWarnings = byCompany.size > 1;
  const warnings = [];
  for (const group of byCompany.values()) {
    const named = nameWarnings
      ? (group.find((r) => r.companyName)?.companyName || null)
      : null;
    for (const warning of _checkOnePeriodSet(group)) {
      warnings.push(named ? `${named}: ${warning}` : warning);
    }
  }
  return warnings;
}

function _checkOnePeriodSet(rows) {
  const warnings = [];
  const real = rows
    .filter((r) => !r.isProjection && periodIndex(r.period) != null)
    .map((r) => ({ start: periodIndex(r.period), end: periodIndex(r.periodEnd || r.period), label: periodLabel(r.period, r.periodEnd) }))
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < real.length; i++) {
    const cur = real[i];
    const prev = real[i - 1];
    if (!prev) continue;

    if (cur.start <= prev.end) {
      warnings.push(
        cur.start === prev.start && cur.end === prev.end
          ? `Período duplicado: ${cur.label}`
          : `Períodos sobrepostos: ${prev.label} e ${cur.label} — os meses em comum são contados duas vezes.`
      );
    } else if (cur.start > prev.end + 1) {
      const missing = cur.start - prev.end - 1;
      warnings.push(`Faltam ${missing} mês(es) entre ${prev.label} e ${cur.label}.`);
    }
  }
  return warnings;
}

// ── DRE extraction — monthly movement = saldo_final − saldo_anterior ─────────
function findDRE(contas) {
  function findMonthly(...keys) {
    for (const k of keys) {
      const c = contas.find((c) =>
        c.tipo === "S" && c.nivel <= 3 &&
        c.descricao?.toUpperCase().includes(k.toUpperCase())
      );
      if (c != null) return (c.saldo_final ?? 0) - (c.saldo_anterior ?? 0);
    }
    return null;
  }

  const recBruta  = findMonthly("RECEITA BRUTA", "RECEITA DE SERVI", "RECEITA BRUTA DE");
  const impostos  = findMonthly("IMPOSTOS S/FAT", "SIMPLES NACIONAL", "IMPOSTOS SOBRE FAT", "DEDUÇÕES");
  const recLiq    = recBruta != null && impostos != null
    ? recBruta - Math.abs(impostos)
    : findMonthly("RECEITA LÍQUIDA");
  const custo     = findMonthly("CUSTO DOS SERVI", "CUSTO DO PRODUTO", "CMV", "CPV", "CUSTO DE MERCADOR");
  const despOp    = findMonthly("DESPESAS OPERAC", "DESPESA OPERAC", "DESPESAS ADMINIST", "DESPESAS GERAIS", "DESPESAS/CUSTO");
  const resFin    = findMonthly("RESULTADO FINANC", "RECEITAS FINANC");
  let resultado   = findMonthly("RESULTADO DO EXERC", "LUCRO LÍQUIDO", "RESULTADO LÍQUIDO", "LUCRO DO EXERC");
  // Derive net income when there's no synthetic "Lucro Líquido" account (common in Brazilian balancetes)
  if (resultado == null && recBruta != null && (despOp != null || custo != null)) {
    const recLiqCalc = recBruta - Math.abs(impostos ?? 0);
    resultado = recLiqCalc - Math.abs(custo ?? 0) - Math.abs(despOp ?? 0) + (resFin ?? 0);
  }
  const margem    = recBruta && resultado ? resultado / recBruta : null;

  return { recBruta, impostos, recLiq, custo, despOp, resFin, resultado, margem };
}

// ── Balanço extraction — saldo_final = period-end snapshot ───────────────────
function findBalanco(contas) {
  function findPos(...keys) {
    for (const k of keys) {
      const c = contas.find((c) =>
        c.tipo === "S" && c.nivel <= 3 &&
        c.descricao?.toUpperCase().includes(k.toUpperCase())
      );
      if (c != null) return c.saldo_final ?? 0;
    }
    return null;
  }

  return {
    ativo:     findPos("ATIVO TOTAL", "TOTAL DO ATIVO", "ATIVO"),
    ativoCirc: findPos("ATIVO CIRCULANTE"),
    caixa:     findPos("DISPONÍV", "CAIXA E EQUIVALEN", "CAIXA E BANCO", "CAIXA"),
    cr:        findPos("CONTAS A RECEBER", "CLIENTES", "DUPLICATAS A RECE"),
    passivo:   findPos("PASSIVO TOTAL", "TOTAL DO PASSIVO", "PASSIVO"),
    passCirc:  findPos("PASSIVO CIRCULANTE"),
    fornec:    findPos("FORNECEDOR", "OBRIGAÇÕES A PAGAR", "CONTAS A PAGAR"),
    pl:        findPos("PATRIMÔNIO LÍQUIDO", "PATRIMÔNIO L", "PL"),
  };
}

// ── DFC indirect method ───────────────────────────────────────────────────────
function calcDFC(dre, bal, prevBal) {
  const ll = dre.resultado;
  if (ll == null || !prevBal) return null;

  const deltaCR      = prevBal.cr != null && bal.cr != null ? prevBal.cr - bal.cr : 0;
  const deltaFornec  = bal.fornec != null && prevBal.fornec != null ? bal.fornec - prevBal.fornec : 0;
  const deltaCapGiro = deltaCR + deltaFornec;
  const caixaInicial = prevBal.caixa ?? 0;
  const caixaFinal   = bal.caixa ?? 0;
  const geracaoReal  = caixaFinal - caixaInicial;
  const outros       = geracaoReal - ll - deltaCapGiro;

  return { ll, deltaCapGiro, outros, geracao: geracaoReal, caixaInicial, caixaFinal };
}

// ── Table row helper ──────────────────────────────────────────────────────────
// vals = array of values, one per period column.
// sectionHeader = true → colspan row; pass nCols as vals in that case.
function row(label, vals, { bold, indent, fmt, sectionHeader } = {}) {
  if (sectionHeader) {
    const n = typeof vals === "number" ? vals : (Array.isArray(vals) ? vals.length : 0);
    return `<tr class="tbl-section"><td colspan="${n + 1}" style="padding-left:12px"><strong>${_esc(label)}</strong></td></tr>`;
  }
  const f   = fmt || _fmt;
  const pad = 12 + (indent || 0) * 14;
  const lStyle = bold ? `;font-weight:700` : "";
  const tdLabel = `<td style="padding-left:${pad}px${lStyle}">${_esc(label)}</td>`;
  const tdVals  = (Array.isArray(vals) ? vals : []).map((v) =>
    v == null
      ? `<td class="num" style="color:var(--muted)">—</td>`
      : `<td class="num"${bold ? ' style="font-weight:700"' : ""}>${f(v)}</td>`
  ).join("");
  return `<tr${bold ? ' class="tbl-bold"' : ""}>${tdLabel}${tdVals}</tr>`;
}

// ── One-time style injection ──────────────────────────────────────────────────
function _ensureResStyles() {
  if (document.getElementById("_res-styles")) return;
  const s = document.createElement("style");
  s.id = "_res-styles";
  s.textContent = `
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    .col-proj { opacity:.75; font-style:italic; }
    .ia-badge { display:inline-flex;align-items:center;font-size:9px;font-weight:700;
      letter-spacing:.4px;padding:1px 5px;border-radius:4px;
      background:rgba(155,134,251,.2);color:#b8a9fb;
      text-transform:uppercase;margin-left:4px;vertical-align:middle; }
    .doc-badge { display:inline-flex;align-items:center;font-size:9px;font-weight:700;
      letter-spacing:.4px;padding:1px 5px;border-radius:4px;
      background:rgba(45,212,160,.18);color:#2dd4a0;
      text-transform:uppercase;margin-left:4px;vertical-align:middle; }
    #res-container .saldo-table tr:last-child td
      { background:transparent;font-weight:inherit;border-bottom:1px solid var(--border); }
    #res-container .saldo-table tr:last-child td:first-child { font-weight:600; }
    #res-container .tbl-bold td { font-weight:700; }
    #res-container .tbl-section td {
      background:rgba(255,255,255,.03);color:var(--muted);font-size:11px;
      font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:10px 10px 6px; }
  `;
  document.head.appendChild(s);
}

// ── Classified row helpers ─────────────────────────────────────────────────────
// Maps semantic_key -> node name for one statement, so a renamed node still
// resolves correctly (falls back to the historical literal name for schema
// rows saved before semantic_key existed).
function _buildSemanticMap(schema, statement) {
  const map = {};
  for (const n of schema || []) {
    if (n.statement === statement && n.semantic_key) map[n.semantic_key] = n.name;
  }
  return map;
}

function _buildLegacyFromCV(cv, schema) {
  const dre = cv?.dre || {};
  const bal = cv?.balanco || {};
  const dfc = cv?.dfc || {};
  const dreMap = _buildSemanticMap(schema, "dre");
  const balMap = _buildSemanticMap(schema, "balanco");
  const dfcMap = _buildSemanticMap(schema, "dfc");

  const g = (obj, map, key, literalFallback) => {
    const name = map[key];
    if (name && obj[name] != null) return obj[name];
    return obj[literalFallback] ?? null;
  };

  const recBruta  = g(dre, dreMap, "revenue", "Receita Bruta");
  const resultado = g(dre, dreMap, "net_income", "Lucro Líquido");
  const pessoal   = g(dre, dreMap, "personnel_expenses", "Despesas com Pessoal") ?? 0;
  const admin     = g(dre, dreMap, "admin_expenses", "Despesas Administrativas") ?? 0;
  const comercial = g(dre, dreMap, "commercial_expenses", "Despesas Comerciais") ?? 0;
  const geracao   = g(dfc, dfcMap, "operating_cash_flow", "Geração de Caixa Operacional");

  return {
    dre: {
      recBruta,
      impostos:  g(dre, dreMap, "revenue_deductions", "Deduções da Receita"),
      recLiq:    g(dre, dreMap, "net_revenue", "Receita Líquida"),
      custo:     g(dre, dreMap, "cogs", "CMV / CPV"),
      despOp:    (pessoal + admin + comercial) || null,
      resFin:    g(dre, dreMap, "financial_result", "Resultado Financeiro"),
      resultado,
      margem:    recBruta && resultado ? resultado / recBruta : null,
    },
    bal: {
      ativo:     g(bal, balMap, "total_assets", "Ativo Total"),
      ativoCirc: g(bal, balMap, "current_assets", "Ativo Circulante"),
      caixa:     g(bal, balMap, "cash", "Caixa e Equivalentes"),
      cr:        g(bal, balMap, "accounts_receivable", "Contas a Receber"),
      passivo:   g(bal, balMap, "total_liabilities", "Passivo Total"),
      passCirc:  g(bal, balMap, "current_liabilities", "Passivo Circulante"),
      fornec:    g(bal, balMap, "accounts_payable", "Fornecedores"),
      pl:        g(bal, balMap, "equity", "Patrimônio Líquido"),
    },
    dfc: Object.keys(dfc).length > 0 ? {
      ll:           geracao != null ? resultado : null,
      deltaCapGiro: g(dfc, dfcMap, "working_capital_change", "Variação Capital de Giro"),
      outros:       g(dfc, dfcMap, "non_cash_adjustments", "Ajustes Não-Caixa"),
      geracao,
      caixaInicial: g(dfc, dfcMap, "cash_beginning", "Caixa Inicial"),
      caixaFinal:   g(dfc, dfcMap, "cash_ending", "Caixa Final"),
    } : null,
  };
}

function _projToLegacy(p) {
  const d = p.dre || {}, b = p.balanco || {}, f = p.dfc || {};
  const recBruta = d.receita_bruta ?? null;
  const resultado = d.lucro_liquido ?? null;
  return {
    dre: { recBruta, impostos: d.impostos ?? null, recLiq: d.receita_liquida ?? null, custo: d.custos_servicos ?? null, despOp: d.despesas_operacionais ?? null, resFin: d.resultado_financeiro ?? null, resultado, margem: recBruta && resultado ? resultado / recBruta : (d.margem_liquida ?? null) },
    bal: { ativo: b.ativo_total ?? null, ativoCirc: null, caixa: b.caixa ?? null, cr: b.contas_receber ?? null, passivo: b.passivo_total ?? null, passCirc: null, fornec: b.fornecedores ?? null, pl: b.patrimonio_liquido ?? null },
    dfc: f.geracao_caixa != null ? { ll: f.lucro_liquido ?? null, deltaCapGiro: f.delta_capital_giro ?? null, outros: f.outros_ajustes ?? null, geracao: f.geracao_caixa ?? null, caixaInicial: f.caixa_inicial ?? null, caixaFinal: f.caixa_final ?? null } : null,
  };
}

// Try to map a projection to a schema cv (best-effort by node name → snake_case)
// Only used as a fallback for projections generated before project-financial
// switched to writing schema-node-keyed dre/balanco/dfc directly.
function _projToCV(p, schema) {
  function toKey(name) {
    return name.toLowerCase()
      .replace(/[áàãâä]/g,"a").replace(/[éèêë]/g,"e").replace(/[íìîï]/g,"i")
      .replace(/[óòõôö]/g,"o").replace(/[úùûü]/g,"u").replace(/[ç]/g,"c")
      .replace(/ã/g,"a").replace(/õ/g,"o").replace(/â/g,"a").replace(/ê/g,"e").replace(/î/g,"i").replace(/ô/g,"o").replace(/û/g,"u")
      .replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  }
  const d = p.dre || {}, b = p.balanco || {}, f = p.dfc || {};
  const sources = { dre: d, balanco: b, dfc: f };
  const cv = { dre: {}, balanco: {}, dfc: {} };
  for (const stmt of ["dre","balanco","dfc"]) {
    for (const n of schema.filter((x) => x.statement === stmt)) {
      const key = toKey(n.name);
      cv[stmt][n.name] = sources[stmt][key] ?? null;
    }
  }
  return cv;
}

// project-financial now writes dre/balanco/dfc keyed directly by schema node
// name (same shape as document_classifications.classified_values). Detect
// that shape vs. the legacy fixed snake_case keys from older projections.
function _projectionIsSchemaShaped(p, schema) {
  const dreNames = schema.filter((n) => n.statement === "dre").map((n) => n.name);
  return dreNames.some((name) => p.dre && Object.prototype.hasOwnProperty.call(p.dre, name));
}

// A empresa de cada documento, tolerante à coluna ainda não existir.
// Ver o comentário sobre janela de deploy em loadResultados.
async function _loadDocumentCompanies(session) {
  try {
    const { data, error } = await supabaseClient
      .from("documents")
      .select("id, company_id")
      .eq("org_id", session.orgId);
    if (error) throw error;
    return new Map((data || []).filter((d) => d.company_id).map((d) => [d.id, d.company_id]));
  } catch (err) {
    console.warn("Empresas dos documentos indisponíveis; seguindo sem recorte por empresa:", err);
    return new Map();
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
async function loadResultados(session) {
  _ensureResStyles();
  const container = document.getElementById("resContainer");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center;padding:60px 0;color:var(--muted)">Carregando demonstrações…</div>`;

  const [
    { data: analyses, error: aErr },
    { data: projections },
    { data: schemaNodes },
    { data: classifications },
  ] = await Promise.all([
    supabaseClient
      .from("document_analyses")
      .select("id, document_id, org_id, status, raw_json, created_at, documents(name, periodo_inicio, periodo_fim)")
      .eq("org_id", session.orgId)
      .eq("status", "concluido")
      .not("raw_json", "is", null),
    supabaseClient
      .from("financial_projections")
      .select("*")
      .eq("org_id", session.orgId)
      .order("periodo", { ascending: true }),
    supabaseClient
      .from("financial_schema_nodes")
      .select("*")
      .eq("org_id", session.orgId)
      .order("statement")
      .order("sort_order"),
    supabaseClient
      .from("document_classifications")
      .select("document_id, classified_values, status")
      .eq("org_id", session.orgId)
      .eq("status", "concluido"),
  ]);

  if (aErr) {
    container.innerHTML = `<div style="color:var(--danger);padding:24px">Erro ao carregar: ${_esc(aErr.message)}</div>`;
    return;
  }

  // Recorte por empresa.
  //
  // A empresa de cada documento vem numa consulta SEPARADA, e não no join
  // acima, de propósito: `deploy-pages` e `deploy-supabase` disparam no mesmo
  // push e correm em paralelo, então existe uma janela em que este arquivo já
  // está no ar e a coluna company_id ainda não existe. Pedi-la no join
  // derrubaria a tela inteira nessa janela; pedindo à parte, a falha só
  // significa "nenhum documento tem empresa", que é exatamente o
  // comportamento anterior à feature.
  const viewScope = await resolveActiveViewScope(session);
  const companyByDocument = await _loadDocumentCompanies(session);

  const scopedAnalyses = viewScope.coversEverything
    ? (analyses || [])
    : (analyses || []).filter((a) => {
        const companyId = companyByDocument.get(a.document_id);
        // Balancete ainda sem empresa vinculada não entra num recorte
        // específico: atribuí-lo a uma empresa por omissão somaria número de
        // origem desconhecida numa demonstração que promete ser de uma só.
        return companyId && viewScope.companyIds.has(companyId);
      });
  const companyNameById = viewScope.companyNames || new Map();

  const schema    = schemaNodes || [];
  const classMap  = Object.fromEntries(
    (classifications || []).map((c) => [c.document_id, c.classified_values])
  );
  const schemaMode = schema.length > 0 && Object.keys(classMap).length > 0;

  // Build real rows
  const realRows = scopedAnalyses.map((a) => ({
    period:       a.documents?.periodo_inicio || a.raw_json?.periodo || "01/2025",
    periodEnd:    a.documents?.periodo_fim || null,
    isProjection: false,
    empresa:      a.raw_json?.empresa || null,
    cnpj:         a.raw_json?.cnpj || null,
    companyId:    companyByDocument.get(a.document_id) || null,
    companyName:  companyNameById.get(companyByDocument.get(a.document_id)) || a.raw_json?.empresa || null,
    _docId:       a.document_id,
    _contas:      a.raw_json?.contas || [],
    cv:           classMap[a.document_id] || null,
  }));

  // Build projection rows
  const projRows = (projections || []).map((p) => ({
    period: p.periodo, isProjection: true, _proj: p,
  }));

  const allRaw = [...realRows, ...projRows].sort(
    (a, b) => parsePeriod(a.period) - parsePeriod(b.period)
  );

  if (!allRaw.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:80px 0">
        <div style="font-size:38px;margin-bottom:14px">📊</div>
        <div style="font-size:16px;font-weight:700;color:var(--ink);margin-bottom:8px">Nenhum balancete analisado</div>
        <div style="font-size:13px;color:var(--muted);max-width:380px;margin:0 auto;line-height:1.6">
          Faça upload de balancetes em <strong style="color:var(--ink2)">Documentos</strong> para ver as demonstrações consolidadas aqui.
        </div>
      </div>`;
    _wireModal(session);
    return;
  }

  // Build rows with legacy fields (for charts) + cv (for schema tables)
  const rows = allRaw.map((r) => {
    if (r.isProjection) {
      const isSchemaShaped = schemaMode && _projectionIsSchemaShaped(r._proj, schema);
      const cv     = isSchemaShaped
        ? { dre: r._proj.dre || {}, balanco: r._proj.balanco || {}, dfc: r._proj.dfc || {} }
        : (schemaMode ? _projToCV(r._proj, schema) : null);
      const legacy = isSchemaShaped ? _buildLegacyFromCV(cv, schema) : _projToLegacy(r._proj);
      return { period: r.period, periodEnd: null, isProjection: true, empresa: null, cnpj: null, cv, ...legacy };
    }
    if (schemaMode && r.cv) {
      const legacy = _buildLegacyFromCV(r.cv, schema);
      return { period: r.period, periodEnd: r.periodEnd, isProjection: false, empresa: r.empresa, cnpj: r.cnpj, companyId: r.companyId, companyName: r.companyName, cv: r.cv, ...legacy };
    }
    // Fallback: keyword extraction from raw contas
    const dre = findDRE(r._contas);
    const bal = findBalanco(r._contas);
    return { period: r.period, periodEnd: r.periodEnd, isProjection: false, empresa: r.empresa, cnpj: r.cnpj, companyId: r.companyId, companyName: r.companyName, cv: null, dre, bal, dfc: null };
  });

  // DFC for legacy rows (needs previous period balance sheet)
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].isProjection && !rows[i].dfc) {
      rows[i].dfc = calcDFC(rows[i].dre, rows[i].bal, rows[i - 1]?.bal);
    }
  }

  renderConsolidated(container, rows, session, schema, schemaMode);
}

// ── Schema-based table rendering ──────────────────────────────────────────────
function renderSchemaTable(stmtNodes, rows, fmtN, tHead, minW, tblFont) {
  if (!stmtNodes.length) return `<div style="color:var(--muted);font-size:12px;padding:12px">Nenhuma subconta configurada. Configure em Configurações → Estrutura de Resultados.</div>`;
  const bodyRows = stmtNodes.map((n) => {
    const vals = rows.map((r) => r.cv?.[n.statement]?.[n.name] ?? null);
    const isSynth = n.node_type === "synthetic";
    const opts = isSynth ? { bold: true, fmt: fmtN } : { indent: 1, fmt: fmtN };
    return row(n.name, vals, opts);
  }).join("");
  return `<table class="saldo-table" style="${minW};${tblFont}">${tHead}<tbody>${bodyRows}</tbody></table>`;
}

// ── Render consolidated page ──────────────────────────────────────────────────
function renderConsolidated(container, rows, session, schema, schemaMode) {
  const warnings  = checkPeriodIssues(rows);
  const firstReal = rows.find((r) => !r.isProjection);
  const empresa   = firstReal?.empresa || "Empresa";
  const cnpj      = firstReal?.cnpj || "";
  const hasProj   = rows.some((r) => r.isProjection);
  const nCols     = rows.length;

  _lastEmpresa = empresa;
  _lastCnpj    = cnpj;

  const compact = nCols > 8;
  const labelW  = compact ? 150 : 210;
  const colW    = compact ? 85  : 130;
  const fmtN    = compact ? _fmtK : _fmt;
  const tblFont = compact ? "font-size:11.5px;" : "";

  const thCells = rows.map((r) => {
    const isP   = r.isProjection;
    const months = periodMonths(r);
    // Without this, a column holding a quarter's accumulated movement is
    // visually indistinguishable from a single month's — the exact confusion
    // that makes a multi-month upload dangerous.
    const spanBadge = !isP && months > 1
      ? ` <span class="doc-badge" style="background:rgba(240,169,60,.18);color:#f0a93c" title="Este balancete cobre ${months} meses — os valores de DRE são o acumulado do período, não de um mês">${months}M</span>`
      : "";
    const badge = (isP ? ` <span class="ia-badge">IA</span>` : ` <span class="doc-badge">DOC</span>`) + spanBadge;
    const cls   = isP ? ` class="num col-proj"` : ` class="num"`;
    const styParts = [
      isP ? "opacity:.75;font-style:italic" : "",
      compact ? `width:${colW}px;max-width:${colW}px` : "",
    ].filter(Boolean).join(";");
    const sty = styParts ? ` style="${styParts}"` : "";
    return `<th${cls}${sty}>${_esc(periodLabel(r.period, r.periodEnd))}${badge}</th>`;
  }).join("");

  const tHead = `<thead><tr><th style="text-align:left;min-width:${labelW}px">Conta</th>${thCells}</tr></thead>`;
  const minW  = `min-width:${labelW + nCols * colW}px`;

  // Scoped helpers — pull values from each row
  function dr(label, g, opts) { return row(label, rows.map((r) => g(r.dre)), { fmt: fmtN, ...opts }); }
  function br(label, g, opts) { return row(label, rows.map((r) => g(r.bal)), { fmt: fmtN, ...opts }); }
  function fc(label, g, opts) { return row(label, rows.map((r) => r.dfc ? g(r.dfc) : null), { fmt: fmtN, ...opts }); }
  function sec(label)         { return row(label, nCols, { sectionHeader: true }); }

  // ── DRE ──────────────────────────────────────────────────────────────────
  const dreNodes = (schema || []).filter((n) => n.statement === "dre");
  const dreHtml = schemaMode
    ? renderSchemaTable(dreNodes, rows, fmtN, tHead, minW, tblFont)
    : `<table class="saldo-table" style="${minW};${tblFont}">${tHead}<tbody>
    ${dr("Receita Bruta",              (d) => d.recBruta, { bold: true })}
    ${dr("(−) Impostos / Deduções",   (d) => d.impostos != null ? -Math.abs(d.impostos) : null, { indent: 1 })}
    ${dr("Receita Líquida",            (d) => d.recLiq, { bold: true })}
    ${dr("(−) Custo dos Serviços/Produtos", (d) => d.custo != null ? -Math.abs(d.custo) : null, { indent: 1 })}
    ${dr("(±) Resultado Financeiro",  (d) => d.resFin, { indent: 1 })}
    ${dr("(−) Despesas Operacionais", (d) => d.despOp != null ? -Math.abs(d.despOp) : null, { indent: 1 })}
    ${dr("Resultado / Lucro Líquido", (d) => d.resultado, { bold: true })}
    ${row("Margem LL", rows.map((r) => r.dre?.margem ?? null), { fmt: _fmtPct })}
  </tbody></table>`;

  // ── Balanço ───────────────────────────────────────────────────────────────
  const balNodes = (schema || []).filter((n) => n.statement === "balanco");
  const balHtml = schemaMode
    ? renderSchemaTable(balNodes, rows, fmtN, tHead, minW, tblFont)
    : `<table class="saldo-table" style="${minW};${tblFont}">${tHead}<tbody>
    ${sec("ATIVO")}
    ${br("Ativo Total",               (b) => b.ativo, { bold: true })}
    ${br("Ativo Circulante",          (b) => b.ativoCirc, { indent: 1 })}
    ${br("Caixa e Equivalentes",      (b) => b.caixa, { indent: 2 })}
    ${br("Contas a Receber",          (b) => b.cr, { indent: 2 })}
    ${sec("PASSIVO & PL")}
    ${br("Passivo Total",             (b) => b.passivo, { bold: true })}
    ${br("Passivo Circulante",        (b) => b.passCirc, { indent: 1 })}
    ${br("Fornecedores / Contas a Pagar", (b) => b.fornec, { indent: 2 })}
    ${br("Patrimônio Líquido",        (b) => b.pl, { bold: true, indent: 1 })}
  </tbody></table>`;

  // ── DFC ───────────────────────────────────────────────────────────────────
  const dfcNodes = (schema || []).filter((n) => n.statement === "dfc");
  const dfcHtml = schemaMode
    ? renderSchemaTable(dfcNodes, rows, fmtN, tHead, minW, tblFont)
    : `<table class="saldo-table" style="${minW};${tblFont}">${tHead}<tbody>
    ${fc("Lucro Líquido",                       (d) => d.ll, { bold: true })}
    ${fc("Variação no Capital de Giro",          (d) => d.deltaCapGiro, { indent: 1 })}
    ${fc("Outros (depreciação, distribuições…)", (d) => d.outros, { indent: 1 })}
    ${fc("Geração de Caixa (variação)",          (d) => d.geracao, { bold: true })}
    ${fc("Caixa Inicial",                        (d) => d.caixaInicial, { indent: 1 })}
    ${fc("Caixa Final",                          (d) => d.caixaFinal, { indent: 1 })}
  </tbody></table>`;

  const warnHtml = warnings.length
    ? `<div style="background:rgba(240,169,60,.12);border:1px solid rgba(240,169,60,.35);border-radius:10px;padding:10px 16px;margin-bottom:16px;font-size:13px;color:var(--amber-text)">
        ⚠ ${warnings.map(_esc).join(" · ")}
       </div>`
    : "";

  container.innerHTML = `
    <div style="margin-bottom:20px">
      <h1 style="font-size:22px;font-weight:800;letter-spacing:-.3px;margin:0">${_esc(empresa)}</h1>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">
        ${cnpj ? `CNPJ: ${_esc(cnpj)} · ` : ""}Demonstrações financeiras consolidadas${hasProj ? " · inclui projeções IA" : ""}
      </div>
    </div>

    ${warnHtml}
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px;font-size:11.5px;color:var(--muted);margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:6px"><span class="doc-badge" style="margin:0">DOC</span> Coluna vem de um balancete enviado</div>
      ${hasProj ? `<div style="display:flex;align-items:center;gap:6px"><span class="ia-badge" style="margin:0">IA</span> Coluna em itálico é projeção gerada por IA</div>` : ""}
    </div>

    <div class="card-row cols-2" style="margin-bottom:16px">
      <div class="card">
        <div class="ch">
          <div><div class="ct">DRE · Receita vs Lucro</div><div class="cs">Movimento mensal por balancete</div></div>
        </div>
        <canvas id="res-chart-dre" height="220"></canvas>
        <div class="legend" style="margin-top:8px">
          <div class="li"><div class="ld" style="background:${_RC.blue}"></div>Receita Bruta</div>
          <div class="li"><div class="ld" style="background:${_RC.mint}"></div>Lucro Líquido</div>
          ${hasProj ? `<div class="li" style="font-size:11px;color:var(--muted)">Barras mais claras = projeção IA</div>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="ch">
          <div><div class="ct">Balanço · Ativo vs Passivo</div><div class="cs">Posição ao final de cada período</div></div>
        </div>
        <canvas id="res-chart-bal" height="220"></canvas>
        <div class="legend" style="margin-top:8px">
          <div class="li"><div class="ll" style="background:${_RC.blue}"></div>Ativo Total</div>
          <div class="li"><div class="ll" style="background:${_RC.amber}"></div>Passivo Total</div>
          <div class="li"><div class="ll" style="background:${_RC.mint}"></div>PL</div>
          ${hasProj ? `<div class="li"><div class="ll" style="border-top:2px dashed ${_RC.blue};width:20px;height:0"></div>Projeção</div>` : ""}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="ch"><div>
        <div class="ct">DRE · Demonstração do Resultado</div>
        <div class="cs">${schemaMode ? "Subcontas classificadas por IA · " + dreNodes.length + " conta(s)" : "Movimento do período — saldo_final − saldo_anterior de cada balancete"}</div>
      </div></div>
      <div style="overflow-x:auto">${dreHtml}</div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="ch"><div>
        <div class="ct">Balanço Patrimonial</div>
        <div class="cs">${schemaMode ? "Subcontas classificadas por IA · " + balNodes.length + " conta(s)" : "Posição ao encerramento de cada período"}</div>
      </div></div>
      <div style="overflow-x:auto">${balHtml}</div>
    </div>

    <div class="card" style="margin-bottom:32px">
      <div class="ch"><div>
        <div class="ct">DFC · Fluxo de Caixa Indireto</div>
        <div class="cs">${schemaMode ? "Calculado a partir da classificação do balancete por IA" : "Calculado a partir da variação do balanço entre períodos consecutivos"}</div>
      </div></div>
      <div style="overflow-x:auto">${dfcHtml}</div>
    </div>

  `;

  _buildCharts(rows, hasProj);
  _wireModal(session);
}

// ── Charts ────────────────────────────────────────────────────────────────────
function _buildCharts(rows, hasProj) {
  const labels = rows.map((r) => periodLabel(r.period, r.periodEnd));

  _dC("res-chart-dre");
  const dreCanvas = document.getElementById("res-chart-dre");
  if (dreCanvas && typeof Chart !== "undefined") {
    const dreDS = [
      {
        label: "Receita Bruta",
        data: rows.map((r) => !r.isProjection ? (r.dre?.recBruta ?? null) : null),
        backgroundColor: _RC.blue, borderRadius: 4,
      },
      {
        label: "Lucro Líquido",
        data: rows.map((r) => !r.isProjection ? (r.dre?.resultado ?? null) : null),
        backgroundColor: _RC.mint, borderRadius: 4,
      },
    ];
    if (hasProj) {
      dreDS.push({
        label: "Receita (proj.)",
        data: rows.map((r) => r.isProjection ? (r.dre?.recBruta ?? null) : null),
        backgroundColor: _RC.blue + "44", borderColor: _RC.blue, borderWidth: 1, borderRadius: 4,
      });
      dreDS.push({
        label: "LL (proj.)",
        data: rows.map((r) => r.isProjection ? (r.dre?.resultado ?? null) : null),
        backgroundColor: _RC.mint + "44", borderColor: _RC.mint, borderWidth: 1, borderRadius: 4,
      });
    }
    _rCharts["res-chart-dre"] = new Chart(dreCanvas, {
      type: "bar",
      data: { labels, datasets: dreDS },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, _RTT, { mode: "index",
            callbacks: { label: (c) => c.dataset.label + ": " + _fmtC(c.raw) } }),
        },
        scales: {
          x: { grid: { color: _RGC }, ticks: { maxRotation: 45 } },
          y: { grid: { color: _RGC }, ticks: { callback: (v) => _fmtC(v) } },
        },
      },
    });
  }

  _dC("res-chart-bal");
  const balCanvas = document.getElementById("res-chart-bal");
  if (balCanvas && typeof Chart !== "undefined") {
    const mkLine = (label, getter, color, dashed, fill = false) => ({
      label,
      fill: fill ? { target: "origin", above: color + "14" } : false,
      data: rows.map((r) => dashed === r.isProjection ? (getter(r.bal) ?? null) : null),
      borderColor: color,
      backgroundColor: "transparent",
      borderDash: dashed ? [5, 4] : [],
      borderWidth: dashed ? 1.5 : 2,
      pointRadius: 3, pointBackgroundColor: color, tension: 0.35,
    });

    const balDS = [
      mkLine("Ativo Total",    (b) => b.ativo,   _RC.blue,  false, true),
      mkLine("Passivo Total",  (b) => b.passivo, _RC.amber, false),
      mkLine("PL",             (b) => b.pl,      _RC.mint,  false),
    ];
    if (hasProj) {
      balDS.push(mkLine("Ativo (proj.)",   (b) => b.ativo,   _RC.blue,  true));
      balDS.push(mkLine("Passivo (proj.)", (b) => b.passivo, _RC.amber, true));
    }
    _rCharts["res-chart-bal"] = new Chart(balCanvas, {
      type: "line",
      data: { labels, datasets: balDS },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, _RTT, { mode: "index",
            callbacks: { label: (c) => c.dataset.label + ": " + _fmtC(c.raw) } }),
        },
        scales: {
          x: { grid: { color: _RGC }, ticks: { maxRotation: 45 } },
          y: { grid: { color: _RGC }, ticks: { callback: (v) => _fmtC(v) } },
        },
      },
    });
  }
}

// ── Wire modal events (runs once; re-renders don't re-wire) ──────────────────
let _lastEmpresa = "";
let _lastCnpj    = "";

// ── XLSX export — one sheet, the 3 rendered tables stacked with a blank
// row between each. Scrapes the already-rendered <table class="saldo-table">
// DOM (there is no separate plain-value data model to hook into — see
// renderConsolidated) rather than recomputing the tables from scratch.
function _tableToAoa(table) {
  return Array.from(table.rows).map((tr) =>
    Array.from(tr.cells).map((td) => {
      const text = td.textContent.replace(/\s+/g, " ").trim();
      if (td.cellIndex === 0 || !td.classList.contains("num")) return text;
      // Numeric columns render as formatted BRL strings ("R$ 1.234") —
      // keep the raw text; forcing real numbers would require re-parsing
      // locale-formatted currency and isn't worth it for an export whose
      // purpose is to mirror what's on screen.
      return text;
    })
  );
}

function _exportResultadosXlsx() {
  if (typeof XLSX === "undefined") {
    alert("Não foi possível carregar a biblioteca de exportação. Tente recarregar a página.");
    return;
  }
  const container = document.getElementById("resContainer");
  const tables = container?.querySelectorAll("table.saldo-table") || [];
  if (!tables.length) {
    alert("Nenhuma tabela para exportar ainda.");
    return;
  }

  const aoa = [
    [_lastEmpresa || "Empresa", _lastCnpj ? `CNPJ: ${_lastCnpj}` : ""],
    [],
  ];
  const titles = ["DRE · Demonstração do Resultado", "Balanço Patrimonial", "DFC · Fluxo de Caixa Indireto"];
  tables.forEach((table, i) => {
    aoa.push([titles[i] || `Tabela ${i + 1}`]);
    aoa.push(..._tableToAoa(table));
    aoa.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 34 }, ...Array.from({ length: 20 }, () => ({ wch: 14 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados Financeiros");
  const fname = `Resultados Financeiros${_lastEmpresa ? " - " + _lastEmpresa : ""}.xlsx`;
  XLSX.writeFile(wb, fname.replace(/[\\/:*?"<>|]/g, ""));
}

let _modalWired = false;

function _wireModal(session) {
  if (_modalWired) return;
  _modalWired = true;

  const projModal = document.getElementById("projModalRoot");
  const projClose = document.getElementById("projModalClose");
  const projCancel = document.getElementById("projCancel");
  const projForm  = document.getElementById("projForm");
  const btnGerar  = document.getElementById("btnGerarProjecao");
  const btnExport = document.getElementById("btnExportXlsx");
  btnExport?.addEventListener("click", _exportResultadosXlsx);

  function openProjModal() { if (projModal) projModal.style.display = "flex"; }
  function closeProjModal() {
    if (projModal) projModal.style.display = "none";
    if (projForm) projForm.reset();
    const prog = document.getElementById("projProgress");
    if (prog) prog.style.display = "none";
    const sub = document.getElementById("projSubmit");
    if (sub) { sub.disabled = false; sub.textContent = "Gerar projeção"; }
  }

  btnGerar?.addEventListener("click",  openProjModal);
  projClose?.addEventListener("click", closeProjModal);
  projCancel?.addEventListener("click", closeProjModal);
  projModal?.addEventListener("click", (e) => { if (e.target === projModal) closeProjModal(); });

  projForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const growthRate = parseFloat(document.getElementById("projGrowth")?.value) || 5;
    await handleProjection(session, growthRate, closeProjModal);
  });
}

// ── Projection handler ────────────────────────────────────────────────────────
async function handleProjection(session, growthRate, onClose) {
  const submitBtn = document.getElementById("projSubmit");
  const progWrap  = document.getElementById("projProgress");
  const progLabel = document.getElementById("projProgressLabel");

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Gerando…"; }
  if (progWrap)  { progWrap.style.display = ""; }
  if (progLabel) { progLabel.textContent = "Chamando IA para gerar projeção…"; }

  try {
    const { data, error } = await supabaseClient.functions.invoke("project-financial", {
      body: { orgId: session.orgId, growthRate },
    });
    if (error) {
      let msg = error.message || "Erro na edge function";
      try {
        if (error.context && typeof error.context.json === "function") {
          const body = await error.context.json();
          if (body?.error) msg = body.error;
        }
      } catch (_) {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    if (progLabel) progLabel.textContent = "Projeção salva! Recarregando…";
    if (progWrap) {
      const spinner = progWrap.querySelector(".proj-spinner");
      if (spinner) spinner.style.borderTopColor = "#2dd4a0";
    }
    setTimeout(async () => {
      if (onClose) onClose();
      await loadResultados(window.__lastOrgSession || session);
    }, 600);
  } catch (err) {
    if (progWrap) {
      const spinner = progWrap.querySelector(".proj-spinner");
      if (spinner) { spinner.style.animation = "none"; spinner.style.borderTopColor = "#ff6b6b"; }
    }
    if (progLabel) progLabel.textContent = "Erro: " + err.message;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Tentar novamente"; }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async function () {
  const session = await requireOrgSession();
  if (!session) return;
  window.__lastOrgSession = session;
  renderAppShell("resultados.html", session);
  renderChatWidget();
  await loadResultados(session);
})();
