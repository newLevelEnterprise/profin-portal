// logs.js — Nexus · execution logs (profix admins only)

const ACTION_LABEL = {
  "analyze-document":       "Análise de doc.",
  "cfo-chat":               "Chat CFO",
  "project-financial":      "Projeção IA",
  "classify_document":      "Classificação de doc.",
  "classify_transactions":  "Classificação de transações",
};

const ACTION_COLOR = {
  "analyze-document":       "#5b9dff",
  "cfo-chat":               "#9b86fb",
  "project-financial":      "#2dd4a0",
  "classify_document":      "#f0a93c",
  "classify_transactions":  "#ff8fd6",
};

function _esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function relTime(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return "Agora";
  if (diff < 3600)  return `Há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `Há ${Math.floor(diff / 3600)}h`;
  if (diff < 172800) return "Ontem";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtTokens(n) {
  if (!n) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function fmtMs(ms) {
  if (!ms) return "—";
  return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
}

function kpiCard(label, value, sub) {
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
  </div>`;
}

function actionBadge(action) {
  const label = ACTION_LABEL[action] || action;
  const color = ACTION_COLOR[action] || "#9aa0b4";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;
    background:${color}22;color:${color}">${_esc(label)}</span>`;
}

function statusBadge(status) {
  const ok = status === "success" || status === "sucesso";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;
    background:${ok ? "rgba(45,212,160,.15)" : "rgba(255,107,107,.15)"};
    color:${ok ? "#2dd4a0" : "#ff6b6b"}">${ok ? "sucesso" : "erro"}</span>`;
}

async function loadLogs() {
  const container = document.getElementById("logsContainer");
  container.innerHTML = `<div style="text-align:center;padding:60px 24px;color:var(--muted)">Carregando…</div>`;

  const { data: logs, error } = await supabaseClient
    .from("logs")
    .select("*, organizations(name)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    container.innerHTML = `<div style="color:var(--danger);padding:24px">Erro ao carregar logs: ${_esc(error.message)}</div>`;
    return;
  }

  if (!logs || logs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:80px 0">
        <div style="font-size:36px;margin-bottom:12px">📋</div>
        <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px">Nenhum log ainda</div>
        <div style="font-size:13px;color:var(--muted)">Os logs aparecem aqui assim que as edge functions forem chamadas.</div>
      </div>`;
    return;
  }

  // ── KPIs (today) ─────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs    = logs.filter((l) => l.created_at?.startsWith(today));
  const todaySuccess = todayLogs.filter((l) => l.status === "success" || l.status === "sucesso");
  const todayTokens  = todayLogs.reduce((s, l) => s + (l.tokens_used || 0), 0);
  const avgMs        = todayLogs.length
    ? Math.round(todayLogs.reduce((s, l) => s + (l.duration_ms || 0), 0) / todayLogs.length)
    : 0;
  const successRate  = todayLogs.length
    ? Math.round((todaySuccess.length / todayLogs.length) * 100)
    : 100;

  const totalTokens  = logs.reduce((s, l) => s + (l.tokens_used || 0), 0);

  const kpiHtml = `<div class="kpi-row" style="margin-bottom:20px">
    ${kpiCard("Chamadas hoje",       todayLogs.length,              `${logs.length} no total`)}
    ${kpiCard("Taxa de sucesso",     successRate + "%",             "hoje")}
    ${kpiCard("Tokens hoje",         fmtTokens(todayTokens),       `${fmtTokens(totalTokens)} no total`)}
    ${kpiCard("Tempo médio",         fmtMs(avgMs),                  "hoje")}
  </div>`;

  // ── Table ──────────────────────────────────────────────────────────────────
  const rows = logs.map((l, i) => {
    const samples = l.metadata?.samples;
    const hasSamples = !!(samples && ((samples.nature && samples.nature.length) || (samples.cluster && samples.cluster.length)));

    const sampleList = (label, list) => !list || !list.length ? "" : `
      <div style="margin-bottom:10px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${_esc(label)}</div>
        <div style="display:flex;flex-direction:column;gap:2px">
          ${list.map((s) => `
            <div style="font-size:12px;display:flex;justify-content:space-between;gap:16px">
              <span style="color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(s.description)}</span>
              <span style="font-weight:600;white-space:nowrap">${_esc(s.category || "—")}</span>
            </div>
          `).join("")}
        </div>
      </div>`;

    const row = `
    <tr class="log-row" ${hasSamples ? `data-log-idx="${i}" style="cursor:pointer" title="Clique para ver a amostra de entrada/saída da IA"` : ""}>
      <td style="color:var(--muted);font-size:12px;white-space:nowrap">${_esc(relTime(l.created_at))}${hasSamples ? ` <span style="color:var(--muted)">▸</span>` : ""}</td>
      <td style="font-size:13px">${_esc(l.organizations?.name || "—")}</td>
      <td>${actionBadge(l.action)}</td>
      <td>${statusBadge(l.status)}</td>
      <td class="num" style="font-size:13px">${fmtTokens(l.tokens_used)}</td>
      <td class="num" style="font-size:13px">${fmtMs(l.duration_ms)}</td>
      <td style="font-size:11.5px;color:var(--danger);max-width:220px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(l.error_text || "")}">
        ${_esc(l.error_text || "")}
      </td>
    </tr>`;

    const detailRow = hasSamples ? `
    <tr id="logDetail${i}" style="display:none">
      <td colspan="7" style="background:rgba(255,255,255,.02);padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--ink2);margin-bottom:10px">
          Entrada (descrição da transação) → saída (categoria decidida pela IA) — amostra de até 20 por eixo
        </div>
        ${sampleList("Natureza (FCO/FCI/FCF)", samples.nature)}
        ${sampleList("Cluster (fornecedor)", samples.cluster)}
      </td>
    </tr>` : "";

    return row + detailRow;
  }).join("");

  container.innerHTML = `
    ${kpiHtml}
    <div class="card">
      <div class="ch">
        <div>
          <div class="ct">Execuções recentes</div>
          <div class="cs">Últimas 500 chamadas — análises, chat CFO, projeções</div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="saldo-table">
          <thead><tr>
            <th style="text-align:left">Quando</th>
            <th style="text-align:left">Organização</th>
            <th style="text-align:left">Ação</th>
            <th>Status</th>
            <th>Tokens</th>
            <th>Duração</th>
            <th style="text-align:left">Erro</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  container.querySelectorAll(".log-row[data-log-idx]").forEach((row) => {
    row.addEventListener("click", () => {
      const detail = document.getElementById(`logDetail${row.dataset.logIdx}`);
      if (detail) detail.style.display = detail.style.display === "none" ? "table-row" : "none";
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async function () {
  const session = await requireOrgSession();
  if (!session) return;

  if (!session.isProFixAdmin) {
    document.getElementById("logsContainer").innerHTML =
      `<div style="text-align:center;padding:80px;color:var(--muted)">Acesso restrito a administradores Nexus.</div>`;
    renderAppShell("logs.html", session);
    return;
  }

  renderAppShell("logs.html", session);
  await loadLogs();

  document.getElementById("btnRefresh")?.addEventListener("click", loadLogs);
})();
