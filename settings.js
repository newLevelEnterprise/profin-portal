const SETTINGS_BUILD_VERSION = "20261016-1";
console.log(`settings.js ${SETTINGS_BUILD_VERSION} carregado`);

function goSettingsTab(i, el) {
  document.querySelectorAll(".tabnav .tab").forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".page").forEach((p, idx) => p.classList.toggle("active", idx === i));
}

const ROLE_PERMISSIONS = {
  Admin: ["dashboard", "resultados", "documentos", "configuracoes", "chat", "conhecimento"],
  Financeiro: ["dashboard", "resultados", "documentos", "chat", "conhecimento"],
  Visualizador: ["dashboard", "conhecimento"],
};

const PERMISSION_LABEL = {
  dashboard: "Visão Financeira Gerencial",
  resultados: "Resultados",
  documentos: "Documentos",
  configuracoes: "Configurações",
  chat: "Chat CFO",
  conhecimento: "Tutorial",
};

function isPluggyIntegration(it) {
  return it?.provider === "pluggy" || String(it?.name || "").toLowerCase().includes("pluggy");
}

function isErpIntegration(it) {
  const provider = String(it?.provider || "").toLowerCase();
  const name = String(it?.name || "").toLowerCase();
  const category = String(it?.category || "").toLowerCase();

  return (
    provider === "erp" ||
    provider.includes("erp") ||
    name === "erp" ||
    name.includes("erp") ||
    category.includes("erp")
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function getSupabaseFunctionsBaseUrl() {
  const supabaseUrl =
    supabaseClient?.supabaseUrl ||
    supabaseClient?._supabaseUrl ||
    window.SUPABASE_URL ||
    window.supabaseUrl ||
    null;

  if (!supabaseUrl) {
    throw new Error(
      "Não foi possível identificar a URL do Supabase no front-end. Verifique o supabase-client.js."
    );
  }

  return `${String(supabaseUrl).replace(/\/$/, "")}/functions/v1`;
}

function getSupabaseAnonKey() {
  return (
    supabaseClient?.supabaseKey ||
    supabaseClient?._supabaseKey ||
    window.SUPABASE_ANON_KEY ||
    window.supabaseAnonKey ||
    null
  );
}

async function getCurrentAccessToken() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    throw new Error(`Erro ao obter sessão atual: ${error.message}`);
  }

  const token = data?.session?.access_token;

  if (!token) {
    throw new Error("Sessão expirada ou usuário não autenticado.");
  }

  return token;
}

function parseFunctionResponseText(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractFunctionErrorMessage(data, fallback = "Erro ao chamar Edge Function.") {
  if (!data) return fallback;

  if (typeof data === "string") return data;

  if (data.error && data.details) {
    return `${data.error} Detalhe: ${data.details}`;
  }

  return (
    data.error ||
    data.details ||
    data.message ||
    data.raw ||
    JSON.stringify(data) ||
    fallback
  );
}

async function invokeEdgeFunctionDetailed(functionName, body = {}) {
  const accessToken = await getCurrentAccessToken();
  const anonKey = getSupabaseAnonKey();
  const url = `${getSupabaseFunctionsBaseUrl()}/${functionName}`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (anonKey) {
    headers.apikey = anonKey;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  const text = await response.text();
  const data = parseFunctionResponseText(text);

  if (!response.ok) {
    console.error(`Erro HTTP da Edge Function ${functionName}:`, {
      status: response.status,
      statusText: response.statusText,
      data,
      raw: text,
    });

    throw new Error(
      extractFunctionErrorMessage(
        data,
        `Edge Function ${functionName} retornou HTTP ${response.status}.`
      )
    );
  }

  if (data?.success === false || data?.ok === false || data?.error) {
    console.error(`Edge Function ${functionName} retornou erro lógico:`, data);
    throw new Error(extractFunctionErrorMessage(data));
  }

  return data;
}

async function connectPluggy(session, integration, btn) {
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = "Abrindo Pluggy...";

    const { data, error } = await supabaseClient.functions.invoke("pluggy-connect-token", {
      body: {},
    });

    if (error) {
      console.error("Erro na Edge Function Pluggy:", error);
      alert("Não foi possível iniciar a conexão com a Pluggy.");
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    if (!data?.accessToken) {
      console.error("Resposta sem accessToken:", data);
      alert("A Edge Function não retornou o token da Pluggy.");
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    if (typeof PluggyConnect === "undefined") {
      alert("SDK da Pluggy não foi carregado. Verifique o script no settings.html.");
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    const pluggyConnect = new PluggyConnect({
      connectToken: data.accessToken,
      includeSandbox: false,
      language: "pt",
      countries: ["BR"],
      // `products` define o que a Pluggy coleta na criação do item, não quais
      // conectores aparecem (isso é `connectorTypes`/`connectorIds`/`countries`).
      // Incluir INVESTMENTS portanto não esconde banco nenhum da lista.
      //
      // Faltava até 04/10, e por isso o portal nunca viu uma aplicação: todos os
      // itens conectados registraram exatamente ACCOUNTS, CREDIT_CARDS e
      // TRANSACTIONS, mesmo nos bancos cujo conector oferece INVESTMENTS.
      // Cliente com milhões aplicados via o saldo da conta corrente e mais nada.
      //
      // Vale só para conexão nova: consentimento de Open Finance é escopado no
      // que foi pedido, então quem já está conectado precisa reconectar para o
      // investimento entrar. Não há backfill possível.
      //
      // INVESTMENTS_TRANSACTIONS fica fora de propósito — é a movimentação
      // dentro da aplicação, que ninguém lê ainda e custa tempo de sync.
      products: ["ACCOUNTS", "TRANSACTIONS", "CREDIT_CARDS", "INVESTMENTS"],

      onSuccess: async (itemData) => {
        const item = itemData?.item || itemData;

        if (!item?.id) {
          console.warn("Pluggy onSuccess sem item.id:", itemData);
          alert("Conexão concluída, mas não recebemos o ID da conexão Pluggy.");
          return;
        }

        const { data: savedItem, error: itemError } = await supabaseClient
          .from("pluggy_items")
          .upsert(
            {
              org_id: session.orgId,
              integration_id: integration.id,
              user_id: session.id,
              pluggy_item_id: item.id,
              client_user_id: data.clientUserId || null,
              connector_name: item.connector?.name || null,
              status: item.status || null,
              execution_status: item.executionStatus || null,
              raw: item,
              disconnected_at: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "org_id,pluggy_item_id",
            }
          )
          .select()
          .single();

        if (itemError) {
          console.error("Erro ao salvar pluggy_items:", itemError);
          alert("A conexão foi feita, mas não conseguimos salvar no Supabase.");
          return;
        }

        const { error: integrationError } = await supabaseClient
          .from("integrations")
          .update({
            status: "conectado",
            connected_at: new Date().toISOString(),
          })
          .eq("id", integration.id);

        if (integrationError) {
          console.error("Erro ao atualizar integração:", integrationError);
          alert("Conexão salva, mas não conseguimos atualizar o status do card.");
          return;
        }

        try {
          await invokePluggySync(savedItem, session);
          triggerAutoClassifyAfterSync(session);
        } catch (syncErr) {
          console.warn("Conexão salva, mas a sincronização inicial falhou:", syncErr);
        }

        alert("Pluggy conectado com sucesso!");
        await paintIntegrations(session);
      },

      onError: async (error) => {
        console.error("Erro Pluggy:", error);
        alert(error?.message || "Não foi possível concluir a conexão com a Pluggy.");
      },

      onClose: async () => {
        btn.disabled = false;
        btn.textContent = originalText;
        await paintIntegrations(session);
      },
    });

    pluggyConnect.init();
  } catch (err) {
    console.error("Erro inesperado Pluggy:", err);
    alert("Erro inesperado ao abrir a Pluggy.");
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

const OF_AUTO_CLASSIFY_MAX_BATCHES = 50; // safety cap: 50 * ~100 = ~5000 tx per sync

// Fired (not awaited by callers) right after a Pluggy sync brings in new
// transactions, so Natureza/Cluster get actually classified and saved
// without the user needing to remember to click "Classificar transações"
// on the dashboard afterward. Mirrors classify-transactions' batch/cursor/
// run_id contract (see openfinance-dashboard.js's ofRunClassifyTransactions)
// but runs silently — this page has no progress UI for it, and a sync
// succeeding shouldn't be blocked or visually cluttered by classification
// still working through a big first-time historical pull in the background.
// Set for the duration of one triggerAutoClassifyAfterSync run in this tab.
// syncSinglePluggyConnection fires this call independently per connection —
// with several accounts synced back-to-back (or "Sincronizar" clicked on
// multiple cards in quick succession), each call would otherwise race to
// read classification_jobs before any of them has written a "running" row
// yet, so more than one decides to start a fresh run and all but the first
// collide with the concurrency lock. Since one "pending" run already covers
// the org's entire backlog regardless of which sync triggered it, a
// redundant concurrent call can just skip instead of racing.
let _ofAutoClassifyInFlight = false;

async function triggerAutoClassifyAfterSync(session) {
  if (_ofAutoClassifyInFlight) {
    console.log("Classificação automática já em andamento nesta aba — disparo redundante ignorado.");
    return;
  }
  _ofAutoClassifyInFlight = true;

  let cursor = null;
  let runId = null;
  let mode = "pending";
  let remaining = "more";
  let batches = 0;

  try {
    // Adopt whatever's already running for this org instead of always
    // starting a brand new run with run_id: null — otherwise this collides
    // head-on with classify-transactions' concurrency lock every time a job
    // is still active (e.g. the dashboard's own auto-resume keeps a large
    // backlog "running" for a while), producing a fast, repeating "erro" log
    // entry on every subsequent sync instead of actually classifying anything.
    const { data: existingJob } = await supabaseClient
      .from("classification_jobs")
      .select("run_id, cursor_id, mode, status")
      .eq("org_id", session.orgId)
      .maybeSingle();

    if (existingJob?.status === "running") {
      runId = existingJob.run_id;
      cursor = existingJob.cursor_id;
      mode = existingJob.mode || "pending";
    }

    while (remaining === "more" && batches < OF_AUTO_CLASSIFY_MAX_BATCHES) {
      batches++;
      const { data, error } = await supabaseClient.functions.invoke("classify-transactions", {
        body: { org_id: session.orgId, mode, cursor_id: cursor, run_id: runId },
      });
      if (error) throw error;
      if (data?.cancelled) break;
      if (!runId && data?.run_id) runId = data.run_id;
      remaining = data?.remaining;
      cursor = data?.next_cursor || null;
    }
    console.log(`Classificação automática pós-sincronização concluída em ${batches} lote(s).`);
  } catch (err) {
    // A classification already running for this org under a DIFFERENT
    // run_id (a genuine race with something else starting a run at this
    // exact same instant) is an expected, benign rejection here — not
    // something worth surfacing to the user; the sync itself already
    // succeeded regardless of this.
    console.warn("Classificação automática pós-sincronização não pôde ser concluída:", err?.message || err);
  } finally {
    _ofAutoClassifyInFlight = false;
  }
}

async function invokePluggySync(item, session) {
  if (!item?.pluggy_item_id) {
    throw new Error("Item Pluggy sem pluggy_item_id.");
  }

  return await invokeEdgeFunctionDetailed("pluggy-sync-item", {
    itemId: item.pluggy_item_id,
    pluggyItemId: item.pluggy_item_id,
    pluggy_item_id: item.pluggy_item_id,
    dbItemId: item.id,
    db_item_id: item.id,
    pluggy_items_id: item.id,
    orgId: session.orgId,
    org_id: session.orgId,
  });
}


async function syncSinglePluggyConnection(session, item, btn) {
  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = "Sincronizando...";

    const result = await invokePluggySync(item, session);
    triggerAutoClassifyAfterSync(session);

    console.log("Resultado da sincronização Pluggy:", result);

    const accountsCount =
      result?.accountsSynced ??
      result?.accounts_count ??
      result?.accounts?.length ??
      0;

    const transactionsCount =
      result?.transactionsSynced ??
      result?.transactions_count ??
      result?.transactions?.length ??
      0;

    const status = String(result?.status || "").toLowerCase();

    const transactionErrors = Array.isArray(result?.transactionErrors)
      ? result.transactionErrors
      : [];

    const rawWarnings = Array.isArray(result?.warnings)
      ? result.warnings.filter(Boolean).map((warning) => String(warning))
      : [];

    const itemUpdateError = result?.itemUpdateError
      ? String(result.itemUpdateError)
      : "";

    const isPluggyUpdateFrequencyLimit =
      itemUpdateError.includes("CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY") ||
      itemUpdateError.includes("allowed at most every 1 hours") ||
      rawWarnings.some((warning) =>
        warning.includes("CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY") ||
        warning.includes("allowed at most every 1 hours")
      );

    const warnings = rawWarnings.filter((warning) => {
      if (
        warning.includes("CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY") ||
        warning.includes("allowed at most every 1 hours") ||
        warning.includes("Atualização remota Pluggy:")
      ) {
        return false;
      }

      if (
        isPluggyUpdateFrequencyLimit &&
        warning.includes("A atualização remota do item Pluggy não foi disparada")
      ) {
        return false;
      }

      return true;
    });

    const infoMessages = [];

    if (isPluggyUpdateFrequencyLimit) {
      infoMessages.push(
        "A Pluggy permite atualizar remotamente esta conexão no máximo 1 vez por hora. A sincronização local foi concluída usando os dados disponíveis."
      );
    } else {
      if (result?.itemUpdateStarted === false) {
        warnings.push("A atualização remota do item Pluggy não foi disparada.");
      }

      if (itemUpdateError) {
        warnings.push(`Atualização remota Pluggy: ${itemUpdateError}`);
      }
    }

    if (
      transactionErrors.length > 0 &&
      !warnings.some((warning) => warning.toLowerCase().includes("transa"))
    ) {
      warnings.push("Uma ou mais contas tiveram erro ao sincronizar transações.");
    }

    const isPartial =
      status === "partial_success" ||
      result?.partialSuccess === true ||
      transactionErrors.length > 0;

    const hasRealWarnings = warnings.length > 0;

    const title = isPartial
      ? "Conexão sincronizada parcialmente."
      : hasRealWarnings
        ? "Conexão sincronizada com aviso."
        : "Conexão sincronizada com sucesso.";

    const warningMessage = hasRealWarnings
      ? `\n\nAvisos:\n- ${warnings.join("\n- ")}`
      : "";

    const infoMessage = infoMessages.length > 0
      ? `\n\nObservação:\n- ${infoMessages.join("\n- ")}`
      : "";

    alert(
      `${title}\n\nContas: ${accountsCount}\nTransações: ${transactionsCount}${warningMessage}${infoMessage}`
    );

    await paintIntegrations(session);
  } catch (err) {
    console.error("Erro ao sincronizar conexão Pluggy:", err);

    const message = err?.message || "Não foi possível sincronizar esta conexão Pluggy.";

    alert(`Não foi possível sincronizar esta conexão Pluggy.\n\nDetalhe: ${message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function disconnectPluggyConnection(session, item, btn) {
  const ok = confirm(
    `Deseja desconectar a conta "${item.connector_name || "Instituição financeira"}"? Esta ação remove/revoga o item na Pluggy e marca a conexão como desconectada no sistema.`
  );

  if (!ok) return;

  const originalText = btn.textContent;

  try {
    btn.disabled = true;
    btn.textContent = "Desconectando...";

    const data = await invokeEdgeFunctionDetailed("pluggy-disconnect-item", {
      db_item_id: item.id,
      dbItemId: item.id,
      pluggy_item_id: item.pluggy_item_id,
      pluggyItemId: item.pluggy_item_id,
      org_id: session.orgId,
      orgId: session.orgId,
    });

    console.log("Resultado da desconexão Pluggy:", data);

    alert("Conta Pluggy desconectada com sucesso.");
    await paintIntegrations(session);
  } catch (err) {
    console.error("Erro ao desconectar conexão Pluggy:", err);

    alert(
      `Não foi possível desconectar esta conta Pluggy.\n\nDetalhe: ${err?.message || String(err)}`
    );
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}


async function loadPluggyConnections(session, integrationId) {
  const container = document.getElementById(`pluggyConnections-${integrationId}`);

  if (!container) {
    return;
  }

  container.innerHTML = `<div class="cs" style="margin-top:12px">Carregando conexões Pluggy...</div>`;

  try {
    const { data: items, error } = await supabaseClient
      .from("pluggy_items")
      .select(`
        id,
        pluggy_item_id,
        connector_name,
        status,
        execution_status,
        last_sync_at,
        updated_at,
        created_at,
        raw
      `)
      .eq("org_id", session.orgId)
      .eq("integration_id", integrationId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erro ao carregar conexões Pluggy:", error);

      container.innerHTML = `
        <div class="cs" style="color:#fca5a5;margin-top:12px">
          Não foi possível carregar as conexões Pluggy.
        </div>
      `;
      return;
    }

    const activeItems = (items || []).filter((item) => isActivePluggyItemStatus(item.status));

    if (activeItems.length === 0) {
      container.innerHTML = `
        <div class="cs" style="margin-top:12px">
          Nenhuma conta Pluggy conectada ainda.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px">
        ${activeItems
        .map((item) => {
          const statusLabel = formatPluggyStatus(item.status);
          const executionLabel = item.execution_status
            ? formatPluggyStatus(item.execution_status)
            : null;

          const lastSyncDate = item.last_sync_at || item.updated_at;

          const updatedAt = lastSyncDate
            ? new Date(lastSyncDate).toLocaleString("pt-BR")
            : "Ainda não sincronizado";

          const diagnosis = getPluggyDiagnosis(item);
          const isError = diagnosis?.severity === "error";
          const isWarn = diagnosis?.severity === "warn";

          const accent = isError ? "#f87171" : isWarn ? "#f0a93c" : null;
          const cardBorder = accent ? `1px solid ${accent}55` : "1px solid rgba(148,163,184,.22)";
          const cardBg = isError
            ? "rgba(248,113,113,.07)"
            : isWarn
              ? "rgba(240,169,60,.07)"
              : "rgba(255,255,255,.035)";

          const diagnosisBlock = diagnosis
            ? `
                <div style="
                  display:flex;gap:9px;align-items:flex-start;
                  background:${isError ? "rgba(248,113,113,.12)" : "rgba(240,169,60,.12)"};
                  border:1px solid ${accent}55;border-radius:10px;
                  padding:10px 12px;margin-bottom:10px;
                ">
                  <span style="flex:none;font-size:14px;line-height:1.3">${isError ? "⛔" : "⚠️"}</span>
                  <div>
                    <div style="font-weight:700;font-size:12.5px;color:${accent};margin-bottom:3px">
                      ${escapeHtml(diagnosis.title)}
                    </div>
                    <div style="font-size:12px;line-height:1.5;color:var(--ink2)">
                      ${escapeHtml(diagnosis.detail)}
                    </div>
                  </div>
                </div>
              `
            : "";

          return `
              <div
                style="
                  border:${cardBorder};
                  border-radius:14px;
                  padding:14px;
                  background:${cardBg};
                  color:inherit;
                "
              >
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                  <span style="font-weight:800;color:inherit">
                    ${escapeHtml(item.connector_name || "Instituição financeira")}
                  </span>
                  ${accent
                    ? `<span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:${accent};border:1px solid ${accent}66;border-radius:999px;padding:2px 8px">${isError ? "Sem dados" : "Desatualizado"}</span>`
                    : `<span style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#2dd4a0;border:1px solid #2dd4a066;border-radius:999px;padding:2px 8px">Ativa</span>`}
                </div>

                ${diagnosisBlock}

                <div class="cs" style="margin-bottom:4px">
                  Item Pluggy: ${escapeHtml(item.pluggy_item_id || "—")}
                </div>

                <div class="cs" style="margin-bottom:4px">
                  Status: ${escapeHtml(statusLabel)}
                </div>

                ${executionLabel
              ? `<div class="cs" style="margin-bottom:4px">Execução: ${escapeHtml(executionLabel)}</div>`
              : ""
            }

                <div class="cs">
                  Última atualização: ${escapeHtml(updatedAt)}
                </div>

                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                  <button
                    type="button"
                    class="btn-secondary pluggy-sync-one"
                    data-db-item-id="${escapeHtml(item.id)}"
                  >
                    Sincronizar
                  </button>

                  <button
                    type="button"
                    class="btn-secondary pluggy-disconnect-one"
                    data-db-item-id="${escapeHtml(item.id)}"
                    style="border-color:rgba(248,113,113,.45);color:#fca5a5"
                  >
                    Desconectar
                  </button>
                </div>
              </div>
            `;
        })
        .join("")}
      </div>
    `;

    container.querySelectorAll(".pluggy-sync-one").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const dbItemId = btn.dataset.dbItemId;
        const item = activeItems.find((row) => String(row.id) === String(dbItemId));

        if (!item) {
          alert("Conexão Pluggy não encontrada.");
          return;
        }

        await syncSinglePluggyConnection(session, item, btn);
      });
    });

    container.querySelectorAll(".pluggy-disconnect-one").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const dbItemId = btn.dataset.dbItemId;
        const item = activeItems.find((row) => String(row.id) === String(dbItemId));

        if (!item) {
          alert("Conexão Pluggy não encontrada.");
          return;
        }

        await disconnectPluggyConnection(session, item, btn);
      });
    });
  } catch (err) {
    console.error("Erro inesperado ao carregar conexões Pluggy:", err);

    container.innerHTML = `
      <div class="cs" style="color:#fca5a5;margin-top:12px">
        Erro inesperado ao carregar conexões Pluggy.
      </div>
    `;
  }
}

function formatPluggyStatus(status) {
  const normalized = String(status || "").toLowerCase();

  const statusMap = {
    connected: "Conectado",
    conectado: "Conectado",
    disconnected: "Desconectado",
    desconectado: "Desconectado",
    error: "Erro",
    erro: "Erro",
    updated: "Atualizado",
    updating: "Atualizando",
    login_error: "Erro de login",
    waiting_user_input: "Aguardando ação do usuário",
    waiting_mfa: "Aguardando MFA",
    syncing: "Sincronizando",
    success: "Sucesso",
    failed: "Falhou",
    partial_success: "Sucesso parcial",
  };

  return statusMap[normalized] || status || "Status desconhecido";
}

// Pluggy reports failures as codes like USER_AUTHORIZATION_NOT_GRANTED and
// USER_INPUT_TIMEOUT. Printed as-is they tell the person looking at this screen
// nothing about whether the connection is fine, nor what to do about it — and a
// bank that quietly stopped returning data looks identical to one that is
// working. Each known failure is mapped to what actually happened and the one
// action that fixes it.
//
// severity drives the visual treatment: "error" means no data is coming in at
// all, "warn" means the connection still holds data but has stopped refreshing.
const PLUGGY_DIAGNOSIS = {
  USER_AUTHORIZATION_NOT_GRANTED: {
    severity: "error",
    title: "Autorização não concedida no banco",
    detail:
      "O consentimento não foi concluído no ambiente do banco, então nenhuma conta foi liberada. Refaça a conexão e finalize a autorização até a tela de confirmação.",
  },
  INVALID_CREDENTIALS: {
    severity: "error",
    title: "Credenciais inválidas",
    detail:
      "Usuário ou senha não foram aceitos pelo banco — normalmente porque a senha mudou. Desconecte e conecte novamente com os dados atuais.",
  },
  USER_INPUT_TIMEOUT: {
    severity: "warn",
    title: "Token não confirmado a tempo",
    detail:
      "O banco pediu confirmação (token ou app) e o prazo expirou. Os dados param de atualizar até uma nova sincronização ser concluída. Clique em Sincronizar e confirme no app do banco assim que a notificação chegar.",
  },
  WAITING_USER_INPUT: {
    severity: "warn",
    title: "Aguardando confirmação no app do banco",
    detail: "A sincronização está parada esperando você aprovar o acesso no aplicativo do banco.",
  },
  ACCOUNT_LOCKED: {
    severity: "error",
    title: "Conta bloqueada pelo banco",
    detail: "O banco bloqueou o acesso. É preciso resolver diretamente com a instituição antes de reconectar.",
  },
  CONNECTION_ERROR: {
    severity: "warn",
    title: "Falha de comunicação com o banco",
    detail: "O banco não respondeu nesta tentativa. Costuma ser temporário — tente sincronizar novamente.",
  },
  SITE_NOT_AVAILABLE: {
    severity: "warn",
    title: "Banco indisponível no momento",
    detail: "O sistema do banco está fora do ar. Tente sincronizar mais tarde.",
  },
};

function getPluggyDiagnosis(item) {
  const execution = String(item?.execution_status || "").toUpperCase();
  const status = String(item?.status || "").toUpperCase();

  if (PLUGGY_DIAGNOSIS[execution]) return PLUGGY_DIAGNOSIS[execution];
  if (PLUGGY_DIAGNOSIS[status]) return PLUGGY_DIAGNOSIS[status];

  // An unmapped LOGIN_ERROR/OUTDATED still has to be visible as a problem
  // rather than blending into the normal rows just because the exact code
  // isn't one we've seen before.
  if (status === "LOGIN_ERROR" || execution === "LOGIN_ERROR") {
    return {
      severity: "error",
      title: "Erro de login",
      detail: "O banco recusou o acesso. Desconecte e refaça a conexão.",
    };
  }
  if (status === "OUTDATED" || execution === "OUTDATED") {
    return {
      severity: "warn",
      title: "Dados desatualizados",
      detail: "A última sincronização não foi concluída, então os saldos e transações podem estar defasados.",
    };
  }

  return null;
}

async function syncIntegrations(session, resources, btn) {
  const originalText = btn?.textContent || "";

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Sincronizando...";
    }

    const data = await invokeEdgeFunctionDetailed("sync-integrations", {
      orgId: session.orgId,
      org_id: session.orgId,
      source: "manual",
      resources,
    });

    const status = data?.status === "partial_success"
      ? "Sincronização concluída parcialmente. Verifique os logs."
      : "Sincronização concluída com sucesso.";

    alert(status);

    if (typeof paintIntegrations === "function") {
      await paintIntegrations(session);
    }
  } catch (err) {
    console.error("Erro na sincronização:", err);

    alert(
      `Não foi possível sincronizar.\n\nDetalhe: ${err?.message || String(err)}`
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function paintIntegrations(session) {
  const { data: integrations, error } = await supabaseClient
    .from("integrations")
    .select("*")
    .eq("org_id", session.orgId)
    .order("name");

  if (error) {
    console.error("Erro ao carregar integrações:", error);
    document.getElementById("integrationsGrid").innerHTML = "";
    return;
  }

  // Pluggy always first, everything else alphabetical after it.
  integrations.sort((a, b) => {
    const pa = isPluggyIntegration(a), pb = isPluggyIntegration(b);
    if (pa !== pb) return pa ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  document.getElementById("integrationsGrid").innerHTML = integrations
    .map((it) => {
      const connected = it.status === "conectado";
      const pluggy = isPluggyIntegration(it);
      const erp = isErpIntegration(it);
      const enabled = it.enabled !== false;

      return `
      <div class="card">
        <div class="ch">
          <div>
            <div class="ct">${escapeHtml(it.name)}</div>
            <div class="cs">${escapeHtml(it.category || "Integração")}</div>
          </div>
          <span class="kpi-delta ${!enabled ? "kd-flat" : connected ? "kd-up" : "kd-flat"}">
            ${!enabled ? "Desativado" : connected ? "Conectado" : "Desconectado"}
          </span>
        </div>

        <div class="cs" style="margin-bottom:14px">
          ${escapeHtml(it.description || "")}
        </div>

        ${!enabled
          ? `<div class="cs" style="color:var(--muted)">Integração não habilitada para sua organização. Fale com o time Profix para ativar.</div>`
          : pluggy
          ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                <button
                  type="button"
                  class="btn-secondary integration-toggle"
                  data-id="${escapeHtml(it.id)}"
                  data-connected="${connected}"
                >
                  Conectar nova conta
                </button>

                <button
                  type="button"
                  class="btn-secondary pluggy-sync-all"
                  data-id="${escapeHtml(it.id)}"
                >
                  Sincronizar todas
                </button>
              </div>
            `
          : erp
            ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                  <button
                    type="button"
                    class="btn-secondary integration-toggle"
                    data-id="${escapeHtml(it.id)}"
                    data-connected="${connected}"
                  >
                    ${connected ? "Desconectar" : "Conectar"}
                  </button>

                  <button
                    type="button"
                    class="btn-secondary erp-sync"
                    data-id="${escapeHtml(it.id)}"
                  >
                    Sincronizar ERP
                  </button>
                </div>

                <div id="erpSyncStatus-${escapeHtml(it.id)}" class="cs" style="margin-top:8px">
                  Sincroniza Fornecedor e TipoDespesa do ERP.
                </div>
              `
            : `
                <button
                  type="button"
                  class="btn-secondary integration-toggle"
                  data-id="${escapeHtml(it.id)}"
                  data-connected="${connected}"
                >
                  ${connected ? "Desconectar" : "Conectar"}
                </button>
              `
        }

        ${pluggy && enabled
          ? `<div id="pluggyConnections-${escapeHtml(it.id)}" class="pluggy-connections-container"></div>`
          : ""
        }
      </div>`;
    })
    .join("");

  document.querySelectorAll(".integration-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const integrationId = btn.dataset.id;
      const integration = integrations.find((it) => String(it.id) === String(integrationId));

      if (!integration) {
        alert("Integração não encontrada.");
        return;
      }

      if (isPluggyIntegration(integration)) {
        await connectPluggy(session, integration, btn);
        return;
      }

      const nowConnected = btn.dataset.connected !== "true";

      const { error: toggleError } = await supabaseClient
        .from("integrations")
        .update({
          status: nowConnected ? "conectado" : "desconectado",
          connected_at: nowConnected ? new Date().toISOString() : null,
        })
        .eq("id", integration.id);

      if (toggleError) {
        console.error("Erro ao atualizar integração:", toggleError);
        alert("Não foi possível atualizar a integração.");
        return;
      }

      await paintIntegrations(session);
    });
  });

  document.querySelectorAll(".pluggy-sync-all").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await syncIntegrations(session, ["open_finance"], btn);
    });
  });

  document.querySelectorAll(".erp-sync").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await syncIntegrations(session, ["erp"], btn);
    });
  });

  for (const integration of integrations) {
    if (isPluggyIntegration(integration) && integration.enabled !== false) {
      await loadPluggyConnections(session, integration.id);
    }
  }
}
// Real users now live in Supabase (table `profiles`, scoped to the org via
// Row Level Security) — no more JSON seed/localStorage overlay for this list.
let _userAccessLinksUsers = [];

async function paintUsers(session) {
  const { data: users, error } = await supabaseClient
    .from("profiles")
    .select("id, name, email, role, permissions")
    .eq("org_id", session.orgId);

  if (error) {
    document.getElementById("userCountSub").textContent = "Não foi possível carregar os usuários.";
    return;
  }

  // Activation status lives in auth.users, not profiles (RLS-readable only
  // via a service-role edge function) — fetched in one bulk call for the
  // whole org rather than per row. Degrades to "—" rather than blocking the
  // rest of the list if this call fails for any reason.
  let statusById = new Map();
  const { data: statusData, error: statusErr } = await supabaseClient.functions.invoke("user-access-links", {
    body: { action: "status", org_id: session.orgId },
  });
  if (!statusErr && statusData?.statuses) {
    statusById = new Map(statusData.statuses.map((s) => [s.id, s]));
  }

  _userAccessLinksUsers = users.map((u) => ({ ...u, _status: statusById.get(u.id) || null }));

  document.getElementById("userCountSub").textContent = `${users.length} usuário(s)`;
  document.getElementById("userTbody").innerHTML = _userAccessLinksUsers
    .map((u) => {
      const isConfirmed = !!u._status?.email_confirmed_at;
      const statusBadge = !u._status
        ? '<span style="color:var(--muted)">—</span>'
        : isConfirmed
          ? '<span class="kpi-delta kd-up">Ativo</span>'
          : '<span class="kpi-delta kd-down">Pendente</span>';
      const canManage = u.id !== session.id && session.role === "Admin";
      return `
      <tr>
        <td style="text-align:left;font-weight:600">${escapeHtml(u.name || "—")}${u.id === session.id ? ' <span style="color:var(--muted);font-weight:400;font-size:11.5px">(você)</span>' : ""}</td>
        <td style="text-align:left;color:var(--ink2)">${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td style="font-size:11px;color:var(--muted)">
          ${(u.permissions || []).map((p) => escapeHtml(PERMISSION_LABEL[p] || p)).join(", ")}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align:right">
          ${canManage ? `<button type="button" class="row-menu-btn" data-uid="${u.id}" title="Opções">···</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

// ── Row action menu ("···") for the Usuários table — Editar + Links de
// acesso used to be two separate inline buttons, which crowded the row once
// Links de acesso was added; consolidated the same way Documentos already
// does it (see documents.js's "Row action dropdown"). Wired once at init,
// not per paintUsers() call, since it's a single document-level listener.
function initUserRowMenu(session) {
  let _menuUser = null;
  const rowMenu = document.getElementById("userRowMenu");

  document.getElementById("userMenuEdit").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuUser) {
      openEditUserModal(
        { id: _menuUser.id, role: _menuUser.role, permissions: _menuUser.permissions, label: _menuUser.name || _menuUser.email },
        session
      );
    }
  });
  document.getElementById("userMenuLinks").addEventListener("click", () => {
    rowMenu.style.display = "none";
    if (_menuUser) openUserAccessLinksModal(_menuUser);
  });

  document.addEventListener("click", (e) => {
    const menuBtn = e.target.closest(".row-menu-btn");
    const insideMenu = e.target.closest("#userRowMenu");

    if (!insideMenu && !menuBtn) rowMenu.style.display = "none";
    if (!menuBtn) return;

    _menuUser = _userAccessLinksUsers.find((x) => x.id === menuBtn.dataset.uid) || null;
    document.getElementById("userMenuLinks").style.display = _menuUser?._status ? "" : "none";

    const rect = menuBtn.getBoundingClientRect();
    const mw = 176;
    rowMenu.style.left = Math.min(rect.right - mw, window.innerWidth - mw - 8) + "px";
    rowMenu.style.top = (rect.bottom + 4) + "px";
    rowMenu.style.display = rowMenu.style.display === "block" ? "none" : "block";
  });
}

// ── Links de acesso ──────────────────────────────────────────────────────
// Two states per user, two actions each — mirrors what an admin actually
// needs when someone reports "I didn't get the email": resend it for real,
// or grab the link to hand over some other way (WhatsApp, etc.) without
// waiting on email deliverability at all.
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

function initUserAccessLinksModal() {
  document.getElementById("userAccessLinksClose")?.addEventListener("click", () => {
    document.getElementById("userAccessLinksModalRoot").style.display = "none";
  });
}

let _currentEditUserId = null;

function openEditUserModal(u, session) {
  _currentEditUserId = u.id;
  document.getElementById("editUserModalTitle").textContent = `Editar: ${u.label || u.name || "usuário"}`;
  document.getElementById("editUserRole").value = u.role;
  document.getElementById("editUserPermChecks").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = (u.permissions || []).includes(cb.value);
  });
  document.getElementById("editUserError").textContent = "";
  document.getElementById("editUserModalRoot").style.display = "flex";
}

// ── Schema node editor ────────────────────────────────────────────────────────

let _schemaStatement = "dre";
let _schemaNodes     = [];
let _schemaSession   = null;
let _editingNodeId   = null;

const STMT_LABEL = { dre: "DRE", balanco: "Balanço", dfc: "DFC" };

// Known semantic keys per statement — a closed list (not free text) so a typo
// can't silently break the chart/legacy mapping in resultados.js. Keep this
// in sync with get_default_schema_nodes() in the DB.
const SEMANTIC_KEYS = {
  dre: [
    ["revenue", "Receita (bruta)"], ["revenue_deductions", "Deduções da receita"],
    ["net_revenue", "Receita líquida"], ["cogs", "CMV / CPV"], ["gross_profit", "Lucro bruto"],
    ["personnel_expenses", "Despesas com pessoal"], ["admin_expenses", "Despesas administrativas"],
    ["commercial_expenses", "Despesas comerciais"], ["ebitda", "EBITDA"], ["depreciation", "Depreciação"],
    ["ebit", "EBIT"], ["financial_result", "Resultado financeiro"], ["income_tax", "IR/CSLL"],
    ["net_income", "Lucro líquido"],
  ],
  balanco: [
    ["cash", "Caixa"], ["accounts_receivable", "Contas a receber"], ["inventory", "Estoques"],
    ["other_current_assets", "Outros ativo circulante"], ["current_assets", "Ativo circulante"],
    ["non_current_assets", "Ativo não circulante"], ["total_assets", "Ativo total"],
    ["accounts_payable", "Fornecedores"], ["short_term_debt", "Obrigações financeiras CP"],
    ["tax_liabilities", "Obrigações fiscais"], ["other_current_liabilities", "Outros passivo circulante"],
    ["current_liabilities", "Passivo circulante"], ["non_current_liabilities", "Passivo não circulante"],
    ["equity", "Patrimônio líquido"], ["total_liabilities", "Passivo total"],
  ],
  dfc: [
    ["non_cash_adjustments", "Ajustes não-caixa"], ["working_capital_change", "Variação capital de giro"],
    ["operating_cash_flow", "Geração de caixa operacional"], ["investing_cash_flow", "Caixa de investimentos"],
    ["financing_cash_flow", "Caixa de financiamentos"], ["cash_change", "Variação de caixa"],
    ["cash_beginning", "Caixa inicial"], ["cash_ending", "Caixa final"],
  ],
};

function populateSemanticKeyOptions(statement, selected) {
  const sel = document.getElementById("nodeSemanticKey");
  const keys = SEMANTIC_KEYS[statement] || [];
  sel.innerHTML = `<option value="">Nenhuma</option>` +
    keys.map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join("");
  sel.value = selected && keys.some(([k]) => k === selected) ? selected : "";
}

function goSchemaTab(stmt, el) {
  document.querySelectorAll("#agentsSubSchema .tabnav .tab").forEach((t) => t.classList.remove("active"));
  if (el) el.classList.add("active");
  _schemaStatement = stmt;
  renderSchemaNodes();
}

// ── Agentes Classificadores: sub-tab switcher (Estrutura / Natureza / Cluster) ──
const AGENTS_SUBPAGE_ID = { schema: "agentsSubSchema", nature: "agentsSubNature", cluster: "agentsSubCluster" };

function goAgentsSubTab(section, el) {
  document.querySelectorAll(".agents-tabnav .tab").forEach((t) => t.classList.remove("active"));
  if (el) el.classList.add("active");
  Object.values(AGENTS_SUBPAGE_ID).forEach((id) => {
    document.getElementById(id).style.display = "none";
  });
  document.getElementById(AGENTS_SUBPAGE_ID[section]).style.display = "";
}

function renderSchemaNodes() {
  const container = document.getElementById("schemaNodesList");
  if (!container) return;
  const filtered = _schemaNodes.filter((n) => n.statement === _schemaStatement)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="margin-bottom:12px">Nenhuma conta configurada para ${STMT_LABEL[_schemaStatement]}</div>
        <button class="btn-primary" onclick="openNodeModal(null,'${_schemaStatement}')">Adicionar primeira conta</button>
      </div>`;
    return;
  }

  container.innerHTML = `<table class="saldo-table" style="font-size:13px">
    <thead><tr>
      <th style="width:40px;text-align:center">#</th>
      <th style="text-align:left">Nome</th>
      <th style="text-align:left;width:90px">Tipo</th>
      <th style="text-align:left">Descrição / Fórmula</th>
      <th style="width:80px"></th>
    </tr></thead>
    <tbody>
      ${filtered.map((n) => {
        const badge = n.node_type === "synthetic"
          ? `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(155,134,251,.2);color:#b8a9fb;font-weight:600">SINTÉTICA</span>`
          : `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(45,212,160,.15);color:#2dd4a0;font-weight:600">ANALÍTICA</span>`;
        const detail = n.node_type === "synthetic" && n.formula
          ? `<code style="font-size:11px;color:var(--ink2);background:rgba(255,255,255,.05);padding:2px 6px;border-radius:3px">${escapeHtml(n.formula)}</code>`
          : escapeHtml(n.description || "—");
        const semanticBadge = n.semantic_key
          ? ` <span title="Chave semântica: ${escapeHtml(n.semantic_key)}" style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(91,157,255,.15);color:#5b9dff;font-weight:600">${escapeHtml(n.semantic_key)}</span>`
          : "";
        return `<tr>
          <td style="text-align:center;color:var(--muted);font-size:12px">${n.sort_order}</td>
          <td style="font-weight:600">${escapeHtml(n.name)}${semanticBadge}</td>
          <td>${badge}</td>
          <td style="font-size:12px;color:var(--ink2);max-width:280px">${detail}</td>
          <td>
            <div style="display:flex;gap:6px;justify-content:flex-end">
              <button class="btn-link" style="font-size:12px" onclick="openNodeModal('${n.id}')">Editar</button>
              <button class="btn-link" style="font-size:12px;color:#ff6b6b" onclick="deleteNode('${n.id}','${escapeHtml(n.name)}')">Apagar</button>
            </div>
          </td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}

async function loadSchemaNodes(session) {
  const { data, error } = await supabaseClient
    .from("financial_schema_nodes")
    .select("*")
    .eq("org_id", session.orgId)
    .order("statement")
    .order("sort_order");
  if (!error) {
    _schemaNodes = data || [];
  }
  renderSchemaNodes();
}

function openNodeModal(nodeId, defaultStatement) {
  _editingNodeId = nodeId || null;
  const n = nodeId ? _schemaNodes.find((x) => x.id === nodeId) : null;

  const statement = n?.statement || defaultStatement || _schemaStatement || "dre";

  document.getElementById("nodeId").value            = n?.id || "";
  document.getElementById("nodeName").value          = n?.name || "";
  document.getElementById("nodeStatement").value     = statement;
  document.getElementById("nodeType").value          = n?.node_type || "analytic";
  document.getElementById("nodeDescription").value   = n?.description || "";
  document.getElementById("nodeExamples").value      = n?.examples || "";
  document.getElementById("nodeFormula").value       = n?.formula || "";
  document.getElementById("nodeSortOrder").value     = n?.sort_order ?? 99;
  document.getElementById("nodeError").textContent   = "";
  document.getElementById("nodeModalTitle").textContent = nodeId ? "Editar conta" : "Adicionar conta";

  populateSemanticKeyOptions(statement, n?.semantic_key || "");
  syncNodeTypeFields(n?.node_type || "analytic");
  document.getElementById("nodeModalRoot").style.display = "flex";
}

function syncNodeTypeFields(type) {
  document.getElementById("nodeAnalyticFields").style.display  = type === "analytic"  ? "" : "none";
  document.getElementById("nodeSyntheticFields").style.display = type === "synthetic" ? "" : "none";
}

async function deleteNode(nodeId, nodeName) {
  if (!confirm(`Apagar a conta "${nodeName}"?`)) return;
  const { error } = await supabaseClient
    .from("financial_schema_nodes")
    .delete()
    .eq("id", nodeId);
  if (error) { alert("Erro: " + error.message); return; }
  _schemaNodes = _schemaNodes.filter((n) => n.id !== nodeId);
  renderSchemaNodes();
}

async function resetSchemaToDefault(session) {
  if (!confirm("Isso vai apagar toda a estrutura atual e restaurar o padrão. Confirma?")) return;
  const { error: delErr } = await supabaseClient
    .from("financial_schema_nodes")
    .delete()
    .eq("org_id", session.orgId);
  if (delErr) { alert("Erro ao apagar: " + delErr.message); return; }

  _schemaNodes = [];
  renderSchemaNodes();

  // Defaults live in a single DB function (get_default_schema_nodes) so this
  // button, classify-document and project-financial all seed from the exact
  // same list — no more copy-pasted node arrays to keep in sync by hand.
  const { data: defaults, error: rpcErr } = await supabaseClient.rpc("get_default_schema_nodes");
  if (rpcErr || !defaults) { alert("Erro ao carregar padrão: " + (rpcErr?.message || "sem dados")); return; }

  const toInsert = defaults.map((n) => ({ ...n, org_id: session.orgId }));
  const { data, error } = await supabaseClient
    .from("financial_schema_nodes")
    .insert(toInsert)
    .select("*");
  if (error) { alert("Erro ao restaurar padrão: " + error.message); return; }
  _schemaNodes = data || [];
  renderSchemaNodes();
  alert("Estrutura padrão restaurada com sucesso.");
}

function initSchemaEditor(session) {
  _schemaSession = session;

  document.getElementById("btnAddNode").addEventListener("click", () => {
    openNodeModal(null, _schemaStatement);
  });

  document.getElementById("btnResetSchema").addEventListener("click", () => {
    resetSchemaToDefault(session);
  });

  document.getElementById("nodeModalClose").addEventListener("click", () => {
    document.getElementById("nodeModalRoot").style.display = "none";
  });
  document.getElementById("nodeCancel").addEventListener("click", () => {
    document.getElementById("nodeModalRoot").style.display = "none";
  });

  document.getElementById("nodeType").addEventListener("change", (e) => {
    syncNodeTypeFields(e.target.value);
  });

  document.getElementById("nodeStatement").addEventListener("change", (e) => {
    populateSemanticKeyOptions(e.target.value, "");
  });

  document.getElementById("nodeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id         = document.getElementById("nodeId").value || null;
    const name       = document.getElementById("nodeName").value.trim();
    const statement  = document.getElementById("nodeStatement").value;
    const node_type  = document.getElementById("nodeType").value;
    const description = document.getElementById("nodeDescription").value.trim() || null;
    const examples   = document.getElementById("nodeExamples").value.trim() || null;
    const formula    = node_type === "synthetic" ? (document.getElementById("nodeFormula").value.trim() || null) : null;
    const semantic_key = document.getElementById("nodeSemanticKey").value || null;
    const sort_order = parseInt(document.getElementById("nodeSortOrder").value, 10) || 99;
    const errEl      = document.getElementById("nodeError");
    const btn        = document.getElementById("nodeSubmit");

    if (!name) { errEl.textContent = "Informe o nome da conta."; return; }
    if (node_type === "synthetic" && !formula) { errEl.textContent = "Informe a fórmula para conta sintética."; return; }

    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";

    try {
      const payload = { org_id: session.orgId, name, statement, node_type, description, examples, formula, semantic_key, sort_order };

      let row;
      if (id) {
        const { data, error } = await supabaseClient
          .from("financial_schema_nodes")
          .update(payload)
          .eq("id", id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        row = data;
        _schemaNodes = _schemaNodes.map((n) => n.id === id ? row : n);
      } else {
        const { data, error } = await supabaseClient
          .from("financial_schema_nodes")
          .insert({ ...payload })
          .select()
          .single();
        if (error) throw new Error(error.message);
        row = data;
        _schemaNodes.push(row);
      }

      document.getElementById("nodeModalRoot").style.display = "none";
      renderSchemaNodes();
    } catch (err) {
      errEl.textContent = "Erro: " + (err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Salvar";
    }
  });
}

// ── Posição por Natureza ──────────────────────────────────────────────────
let _natureCategories = [];
let _natureSession = null;

function renderNatureCategories() {
  const container = document.getElementById("natureCategoriesList");
  if (!container) return;
  const sorted = [..._natureCategories].sort((a, b) => a.sort_order - b.sort_order);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="margin-bottom:12px">Nenhuma categoria configurada</div>
        <button class="btn-primary" onclick="openNatureModal(null)">Adicionar primeira categoria</button>
      </div>`;
    return;
  }

  container.innerHTML = `<table class="saldo-table" style="font-size:13px">
    <thead><tr>
      <th style="width:40px;text-align:center">#</th>
      <th style="text-align:left">Nome</th>
      <th style="text-align:left">Descrição</th>
      <th style="width:80px"></th>
    </tr></thead>
    <tbody>
      ${sorted.map((c) => `<tr>
          <td style="text-align:center;color:var(--muted);font-size:12px">${c.sort_order}</td>
          <td style="font-weight:600">${escapeHtml(c.name)}</td>
          <td style="font-size:12px;color:var(--ink2);max-width:360px">${escapeHtml(c.description || "—")}</td>
          <td>
            <div style="display:flex;gap:6px;justify-content:flex-end">
              <button class="btn-link" style="font-size:12px" onclick="openNatureModal('${c.id}')">Editar</button>
              <button class="btn-link" style="font-size:12px;color:#ff6b6b" onclick="deleteNatureCategory('${c.id}','${escapeHtml(c.name)}')">Apagar</button>
            </div>
          </td>
        </tr>`).join("")}
    </tbody>
  </table>`;
}

async function loadNatureCategories(session) {
  const { data, error } = await supabaseClient
    .from("nature_position_categories")
    .select("*")
    .eq("org_id", session.orgId)
    .order("sort_order");
  if (!error) _natureCategories = data || [];
  renderNatureCategories();
  populateClusterCategoryOptions();
}

function openNatureModal(id) {
  const c = id ? _natureCategories.find((x) => x.id === id) : null;
  document.getElementById("natureId").value = c?.id || "";
  document.getElementById("natureName").value = c?.name || "";
  document.getElementById("natureDescription").value = c?.description || "";
  document.getElementById("natureExamples").value = c?.examples || "";
  document.getElementById("natureSortOrder").value = c?.sort_order ?? 99;
  document.getElementById("natureError").textContent = "";
  document.getElementById("natureModalTitle").textContent = id ? "Editar categoria" : "Adicionar categoria";
  document.getElementById("natureModalRoot").style.display = "flex";
}

async function deleteNatureCategory(id, name) {
  if (!confirm(`Apagar a categoria "${name}"?`)) return;
  const { error } = await supabaseClient.from("nature_position_categories").delete().eq("id", id);
  if (error) { alert("Erro: " + error.message); return; }
  _natureCategories = _natureCategories.filter((c) => c.id !== id);
  renderNatureCategories();
  populateClusterCategoryOptions();
}

async function resetNatureToDefault(session) {
  if (!confirm("Isso vai apagar todas as categorias atuais e restaurar o padrão. Confirma?")) return;
  const { error: delErr } = await supabaseClient
    .from("nature_position_categories")
    .delete()
    .eq("org_id", session.orgId);
  if (delErr) { alert("Erro ao apagar: " + delErr.message); return; }

  const { data: defaults, error: rpcErr } = await supabaseClient.rpc("get_default_nature_categories");
  if (rpcErr || !defaults) { alert("Erro ao carregar padrão: " + (rpcErr?.message || "sem dados")); return; }

  const toInsert = defaults.map((c) => ({ ...c, org_id: session.orgId }));
  const { data, error } = await supabaseClient
    .from("nature_position_categories")
    .insert(toInsert)
    .select("*");
  if (error) { alert("Erro ao restaurar padrão: " + error.message); return; }
  _natureCategories = data || [];
  renderNatureCategories();
  populateClusterCategoryOptions();
  alert("Categorias padrão restauradas com sucesso.");
}

function initNatureEditor(session) {
  _natureSession = session;

  document.getElementById("btnAddNature").addEventListener("click", () => openNatureModal(null));
  document.getElementById("btnResetNature").addEventListener("click", () => resetNatureToDefault(session));
  document.getElementById("natureModalClose").addEventListener("click", () => {
    document.getElementById("natureModalRoot").style.display = "none";
  });
  document.getElementById("natureCancel").addEventListener("click", () => {
    document.getElementById("natureModalRoot").style.display = "none";
  });

  document.getElementById("natureForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("natureId").value || null;
    const name = document.getElementById("natureName").value.trim();
    const description = document.getElementById("natureDescription").value.trim() || null;
    const examples = document.getElementById("natureExamples").value.trim() || null;
    const sort_order = parseInt(document.getElementById("natureSortOrder").value, 10) || 99;
    const errEl = document.getElementById("natureError");
    const btn = document.getElementById("natureSubmit");

    if (!name) { errEl.textContent = "Informe o nome da categoria."; return; }

    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";

    try {
      const payload = { org_id: session.orgId, name, description, examples, sort_order };
      let row;
      if (id) {
        const { data, error } = await supabaseClient
          .from("nature_position_categories").update(payload).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        row = data;
        _natureCategories = _natureCategories.map((c) => c.id === id ? row : c);
      } else {
        const { data, error } = await supabaseClient
          .from("nature_position_categories").insert(payload).select().single();
        if (error) throw new Error(error.message);
        row = data;
        _natureCategories.push(row);
      }
      document.getElementById("natureModalRoot").style.display = "none";
      renderNatureCategories();
      populateClusterCategoryOptions();
    } catch (err) {
      errEl.textContent = "Erro: " + (err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Salvar";
    }
  });
}

// ── Clusterização de Fornecedores ─────────────────────────────────────────
// Cluster categories are the client's own granular chart-of-accounts list
// (e.g. "005031-ALUGUEIS") — a separate axis from the 3-bucket FCO/FCI/FCF
// nature categories above. transaction_cluster_rules assigns a supplier to
// one of these, not to a nature category.
let _clusterRules = [];
let _clusterCategories = [];
let _clusterSession = null;

let _clusterRulesSearch = "";
let _clusterRulesPage = 1;
let _clusterCategoriesSearch = "";
let _clusterCategoriesPage = 1;

const SETTINGS_PAGE_SIZE = 25;

const TRASH_ICON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

// Formats a raw digit string as CPF (000.000.000-00) or CNPJ
// (00.000.000/0000-00) by length; anything that isn't exactly 11 or 14
// digits (partial entries, placeholders) is shown as typed instead of
// guessing at a mask that doesn't fit.
// Plain text out (no HTML escaping) — used both for table rendering (wrap the
// result in escapeHtml at the call site) and for the Excel export, which
// needs a plain cell value rather than HTML-escaped text.
function formatCnpjCpf(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return String(raw).trim();
}

function paginateItems(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), page: clampedPage, totalPages, total };
}

function renderPaginationControls(containerId, pageInfo, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (pageInfo.total === 0) { container.innerHTML = ""; return; }
  const { page, totalPages, total } = pageInfo;
  const start = total === 0 ? 0 : (page - 1) * SETTINGS_PAGE_SIZE + 1;
  const end = Math.min(page * SETTINGS_PAGE_SIZE, total);
  container.innerHTML = `
    <div class="settings-pagination">
      <span>${start}–${end} de ${total}</span>
      <div style="display:flex;gap:6px">
        <button type="button" class="btn-secondary" style="font-size:12px;padding:4px 10px" data-page-action="prev" ${page <= 1 ? "disabled" : ""}>‹ Anterior</button>
        <span style="padding:4px 4px">Página ${page} de ${totalPages}</span>
        <button type="button" class="btn-secondary" style="font-size:12px;padding:4px 10px" data-page-action="next" ${page >= totalPages ? "disabled" : ""}>Próxima ›</button>
      </div>
    </div>`;
  const prevBtn = container.querySelector('[data-page-action="prev"]');
  const nextBtn = container.querySelector('[data-page-action="next"]');
  if (prevBtn) prevBtn.addEventListener("click", () => onPageChange(page - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => onPageChange(page + 1));
}

async function loadOrSeedClusterCategories(session) {
  const { data, error } = await supabaseClient
    .from("cluster_categories")
    .select("*")
    .eq("org_id", session.orgId)
    .order("sort_order");
  if (error) { _clusterCategories = []; renderClusterCategories(); return; }

  if (data && data.length > 0) {
    _clusterCategories = data;
    renderClusterCategories();
    return;
  }

  // First time this org opens the tab: seed from the DB-side default list so
  // the "categoria" dropdown isn't empty before any import happens.
  const { data: defaults, error: rpcErr } = await supabaseClient.rpc("get_default_cluster_categories");
  if (rpcErr || !defaults) { _clusterCategories = []; renderClusterCategories(); return; }
  const toInsert = defaults.map((c) => ({ ...c, org_id: session.orgId }));
  const { data: inserted, error: insertErr } = await supabaseClient
    .from("cluster_categories").insert(toInsert).select("*");
  _clusterCategories = insertErr ? [] : (inserted || []);
  renderClusterCategories();
}

function populateClusterCategoryOptions() {
  const select = document.getElementById("clusterCategoryId");
  if (!select) return;
  const current = select.value;
  select.innerHTML = [...(_clusterCategories || [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => `<option value="${c.id}">${c.code ? escapeHtml(c.code) + " - " : ""}${escapeHtml(c.name)}</option>`)
    .join("");
  if (current) select.value = current;
}

// ── Clusters disponíveis (cluster_categories) — the AI-classification target
// list for new suppliers, and the manual dropdown source above ──────────────
function renderClusterCategories() {
  const container = document.getElementById("clusterCategoriesList");
  if (!container) return;
  const sorted = [..._clusterCategories].sort((a, b) => a.sort_order - b.sort_order);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="margin-bottom:12px">Nenhum cluster configurado</div>
        <button class="btn-primary" onclick="openClusterCategoryModal(null)">Adicionar primeiro cluster</button>
      </div>`;
    document.getElementById("clusterCategoriesPagination").innerHTML = "";
    return;
  }

  const term = _clusterCategoriesSearch.trim().toLowerCase();
  const filtered = term
    ? sorted.filter((c) => (c.name || "").toLowerCase().includes(term) || (c.code || "").toLowerCase().includes(term))
    : sorted;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted)">Nenhum cluster encontrado para "${escapeHtml(_clusterCategoriesSearch)}"</div>`;
    document.getElementById("clusterCategoriesPagination").innerHTML = "";
    return;
  }

  const pageInfo = paginateItems(filtered, _clusterCategoriesPage, SETTINGS_PAGE_SIZE);
  _clusterCategoriesPage = pageInfo.page;

  const parentNameById = new Map(_clusterCategories.map((c) => [c.id, c.name]));

  container.innerHTML = `<table class="saldo-table list-table" style="font-size:13px">
    <thead><tr>
      <th style="width:40px;text-align:center">#</th>
      <th style="text-align:left;width:100px">Código</th>
      <th style="text-align:left">Nome do cluster</th>
      <th style="text-align:left">Cluster pai</th>
      <th style="width:60px"></th>
    </tr></thead>
    <tbody>
      ${pageInfo.pageItems.map((c) => `<tr>
          <td style="text-align:center;color:var(--muted);font-size:12px">${c.sort_order}</td>
          <td style="font-size:12px;color:var(--ink2)">${escapeHtml(c.code || "—")}</td>
          <td style="font-weight:600">${escapeHtml(c.name)}</td>
          <td style="font-size:12px;color:var(--muted)">${c.parent_cluster_id ? escapeHtml(parentNameById.get(c.parent_cluster_id) || "—") : "—"}</td>
          <td>
            <div style="display:flex;gap:2px;justify-content:flex-end">
              <button class="btn-link" style="font-size:12px" onclick="openClusterCategoryModal('${c.id}')">Editar</button>
              <button class="btn-icon-danger" title="Apagar" onclick="deleteClusterCategory('${c.id}','${escapeHtml(c.name)}')">${TRASH_ICON_SVG}</button>
            </div>
          </td>
        </tr>`).join("")}
    </tbody>
  </table>`;

  renderPaginationControls("clusterCategoriesPagination", pageInfo, (page) => {
    _clusterCategoriesPage = page;
    renderClusterCategories();
  });
}

// Only clusters with no parent of their own, and no children of their own,
// are valid parent choices — the DB trigger caps the hierarchy at two levels,
// so offering an invalid option here would just bounce off a save error.
function populateClusterParentOptions(excludeId) {
  const select = document.getElementById("ccatParentId");
  if (!select) return;
  const childIds = new Set(_clusterCategories.filter((c) => c.parent_cluster_id).map((c) => c.parent_cluster_id));
  const candidates = _clusterCategories.filter((c) =>
    c.id !== excludeId && !c.parent_cluster_id && !childIds.has(c.id)
  );
  select.innerHTML = `<option value="">— Nenhum (cluster de nível superior) —</option>` + candidates
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
}

function openClusterCategoryModal(id) {
  const c = id ? _clusterCategories.find((x) => x.id === id) : null;
  document.getElementById("ccatId").value = c?.id || "";
  document.getElementById("ccatName").value = c?.name || "";
  document.getElementById("ccatCode").value = c?.code || "";
  document.getElementById("ccatSortOrder").value = c?.sort_order ?? 99;
  populateClusterParentOptions(c?.id || null);
  document.getElementById("ccatParentId").value = c?.parent_cluster_id || "";
  document.getElementById("ccatError").textContent = "";
  document.getElementById("ccatModalTitle").textContent = id ? "Editar cluster" : "Adicionar cluster";
  document.getElementById("ccatModalRoot").style.display = "flex";
}

async function deleteClusterCategory(id, name) {
  if (!confirm(`Apagar o cluster "${name}"? Regras de fornecedor que apontam para ele mantêm o nome, mas perdem o vínculo.`)) return;
  const { error } = await supabaseClient.from("cluster_categories").delete().eq("id", id);
  if (error) { alert("Erro: " + error.message); return; }
  _clusterCategories = _clusterCategories.filter((c) => c.id !== id);
  renderClusterCategories();
  populateClusterCategoryOptions();
}

async function resetClusterCategoriesToDefault(session) {
  if (!confirm("Isso vai apagar todos os clusters atuais e restaurar o padrão. Confirma?")) return;
  const { error: delErr } = await supabaseClient
    .from("cluster_categories")
    .delete()
    .eq("org_id", session.orgId);
  if (delErr) { alert("Erro ao apagar: " + delErr.message); return; }

  const { data: defaults, error: rpcErr } = await supabaseClient.rpc("get_default_cluster_categories");
  if (rpcErr || !defaults) { alert("Erro ao carregar padrão: " + (rpcErr?.message || "sem dados")); return; }

  const toInsert = defaults.map((c) => ({ ...c, org_id: session.orgId }));
  const { data, error } = await supabaseClient
    .from("cluster_categories")
    .insert(toInsert)
    .select("*");
  if (error) { alert("Erro ao restaurar padrão: " + error.message); return; }
  _clusterCategories = data || [];
  renderClusterCategories();
  populateClusterCategoryOptions();
  alert("Clusters padrão restaurados com sucesso.");
}

function exportClusterCategoriesToExcel() {
  const sorted = [..._clusterCategories].sort((a, b) => a.sort_order - b.sort_order);
  const rows = sorted.map((c) => ({
    "Cluster": c.name,
    "Código": c.code || "",
    "Ordem": c.sort_order,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clusters");
  XLSX.writeFile(wb, "clusters-disponiveis.xlsx");
}

// Same best-effort header detection style as detectClusterColumns above —
// tolerant of the export's own column names plus common variants.
function detectClusterCategoryColumns(headerRow) {
  const norm = (v) => String(v ?? "").toLowerCase();
  const cols = { name: -1, code: -1, sortOrder: -1 };
  headerRow.forEach((cell, idx) => {
    const h = norm(cell);
    if (cols.name === -1 && (h.includes("cluster") || h.includes("nome") || h.includes("categoria"))) cols.name = idx;
    else if (cols.code === -1 && (h.includes("código") || h.includes("codigo") || h.includes("code"))) cols.code = idx;
    else if (cols.sortOrder === -1 && (h.includes("ordem") || h.includes("order"))) cols.sortOrder = idx;
  });
  return cols;
}

async function importClusterCategoryFile(session, file) {
  const statusEl = document.getElementById("clusterCategoryImportStatus");
  statusEl.style.display = "block";
  statusEl.textContent = "Lendo planilha…";

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    let headerIdx = -1;
    let cols = null;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const detected = detectClusterCategoryColumns(rows[i] || []);
      if (detected.name !== -1) { headerIdx = i; cols = detected; break; }
    }
    if (!cols) throw new Error("Não foi possível identificar a coluna de cluster na planilha.");

    const existingNames = new Set(_clusterCategories.map((c) => c.name.toLowerCase()));
    const parsed = [];
    const seenInFile = new Set();
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const name = row[cols.name] != null ? String(row[cols.name]).trim() : "";
      if (!name || existingNames.has(name.toLowerCase()) || seenInFile.has(name.toLowerCase())) continue;
      seenInFile.add(name.toLowerCase());
      parsed.push({
        name,
        code: cols.code !== -1 && row[cols.code] != null ? String(row[cols.code]).trim() : null,
        sort_order: cols.sortOrder !== -1 && row[cols.sortOrder] != null ? parseInt(row[cols.sortOrder], 10) || null : null,
      });
    }
    if (!parsed.length) throw new Error("Nenhum cluster novo encontrado na planilha (talvez já estejam todos cadastrados).");

    let maxOrder = _clusterCategories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
    const toInsert = parsed.map((p) => ({
      org_id: session.orgId,
      name: p.name,
      code: p.code,
      sort_order: p.sort_order || ++maxOrder,
    }));

    const { data: inserted, error: insErr } = await supabaseClient
      .from("cluster_categories").insert(toInsert).select("*");
    if (insErr) throw new Error("Erro ao importar clusters: " + insErr.message);

    _clusterCategories.push(...(inserted || []));
    renderClusterCategories();
    populateClusterCategoryOptions();
    statusEl.textContent = `Importação concluída: ${(inserted || []).length} cluster(s) adicionado(s).`;
  } catch (err) {
    statusEl.textContent = "Erro na importação: " + (err.message || String(err));
  }
}

function initClusterCategoryEditor(session) {
  document.getElementById("btnAddClusterCategory").addEventListener("click", () => openClusterCategoryModal(null));
  document.getElementById("btnResetClusterCategories").addEventListener("click", () => resetClusterCategoriesToDefault(session));
  document.getElementById("btnExportClusterCategories").addEventListener("click", () => exportClusterCategoriesToExcel());
  document.getElementById("btnImportClusterCategories").addEventListener("click", () => {
    document.getElementById("clusterCategoryImportFile").click();
  });
  document.getElementById("clusterCategoryImportFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await importClusterCategoryFile(session, file);
  });
  document.getElementById("clusterCategoriesSearch").addEventListener("input", (e) => {
    _clusterCategoriesSearch = e.target.value;
    _clusterCategoriesPage = 1;
    renderClusterCategories();
  });
  document.getElementById("ccatModalClose").addEventListener("click", () => {
    document.getElementById("ccatModalRoot").style.display = "none";
  });
  document.getElementById("ccatCancel").addEventListener("click", () => {
    document.getElementById("ccatModalRoot").style.display = "none";
  });

  document.getElementById("ccatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("ccatId").value || null;
    const name = document.getElementById("ccatName").value.trim();
    const code = document.getElementById("ccatCode").value.trim() || null;
    const sort_order = parseInt(document.getElementById("ccatSortOrder").value, 10) || 99;
    const parent_cluster_id = document.getElementById("ccatParentId").value || null;
    const errEl = document.getElementById("ccatError");
    const btn = document.getElementById("ccatSubmit");

    if (!name) { errEl.textContent = "Informe o nome do cluster."; return; }

    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";

    try {
      const payload = { org_id: session.orgId, name, code, sort_order, parent_cluster_id };
      let row;
      if (id) {
        const { data, error } = await supabaseClient
          .from("cluster_categories").update(payload).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        row = data;
        _clusterCategories = _clusterCategories.map((c) => c.id === id ? row : c);
      } else {
        const { data, error } = await supabaseClient
          .from("cluster_categories").insert(payload).select().single();
        if (error) throw new Error(error.message);
        row = data;
        _clusterCategories.push(row);
      }
      document.getElementById("ccatModalRoot").style.display = "none";
      renderClusterCategories();
      populateClusterCategoryOptions();
    } catch (err) {
      errEl.textContent = "Erro: " + (err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Salvar";
    }
  });
}

function renderClusterRules() {
  const container = document.getElementById("clusterRulesList");
  if (!container) return;

  if (_clusterRules.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="margin-bottom:12px">Nenhuma regra de clusterização configurada</div>
        <button class="btn-primary" onclick="openClusterModal(null)">Adicionar primeira regra</button>
      </div>`;
    document.getElementById("clusterRulesPagination").innerHTML = "";
    return;
  }

  const term = _clusterRulesSearch.trim().toLowerCase();
  const filtered = term
    ? _clusterRules.filter((r) =>
        (r.supplier_name || "").toLowerCase().includes(term) ||
        (r.cnpj || "").toLowerCase().includes(term) ||
        formatCnpjCpf(r.cnpj).toLowerCase().includes(term) ||
        (r.cluster_label || "").toLowerCase().includes(term))
    : _clusterRules;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted)">Nenhuma regra encontrada para "${escapeHtml(_clusterRulesSearch)}"</div>`;
    document.getElementById("clusterRulesPagination").innerHTML = "";
    return;
  }

  const pageInfo = paginateItems(filtered, _clusterRulesPage, SETTINGS_PAGE_SIZE);
  _clusterRulesPage = pageInfo.page;

  container.innerHTML = `<table class="saldo-table list-table" style="font-size:13px">
    <thead><tr>
      <th style="text-align:left">Fornecedor/Cliente</th>
      <th style="text-align:left">CNPJ/CPF</th>
      <th style="text-align:left">Cluster</th>
      <th style="width:60px"></th>
    </tr></thead>
    <tbody>
      ${pageInfo.pageItems.map((r) => `<tr>
          <td style="font-weight:600">${escapeHtml(r.supplier_name)}${r.historico_hint ? `<div style="font-size:11px;color:var(--muted);font-weight:400">${escapeHtml(r.historico_hint)}</div>` : ""}</td>
          <td style="font-size:12px;color:var(--ink2);white-space:nowrap">${r.cnpj ? escapeHtml(formatCnpjCpf(r.cnpj)) : "—"}</td>
          <td><span style="font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(91,157,255,.15);color:#5b9dff;font-weight:600">${escapeHtml(r.cluster_label)}</span></td>
          <td>
            <div style="display:flex;gap:2px;justify-content:flex-end">
              <button class="btn-link" style="font-size:12px" onclick="openClusterModal('${r.id}')">Editar</button>
              <button class="btn-icon-danger" title="Apagar" onclick="deleteClusterRule('${r.id}','${escapeHtml(r.supplier_name)}')">${TRASH_ICON_SVG}</button>
            </div>
          </td>
        </tr>`).join("")}
    </tbody>
  </table>`;

  renderPaginationControls("clusterRulesPagination", pageInfo, (page) => {
    _clusterRulesPage = page;
    renderClusterRules();
  });
}

async function loadClusterRules(session) {
  const { data, error } = await supabaseClient
    .from("transaction_cluster_rules")
    .select("*")
    .eq("org_id", session.orgId)
    .order("supplier_name");
  if (!error) _clusterRules = data || [];
  renderClusterRules();
}

function openClusterModal(id) {
  const r = id ? _clusterRules.find((x) => x.id === id) : null;
  document.getElementById("clusterId").value = r?.id || "";
  document.getElementById("clusterSupplierName").value = r?.supplier_name || "";
  document.getElementById("clusterCnpj").value = r?.cnpj || "";
  document.getElementById("clusterHistorico").value = r?.historico_hint || "";
  populateClusterCategoryOptions();
  if (r?.cluster_category_id) document.getElementById("clusterCategoryId").value = r.cluster_category_id;
  document.getElementById("clusterError").textContent = "";
  document.getElementById("clusterModalTitle").textContent = id ? "Editar regra" : "Adicionar regra";
  document.getElementById("clusterModalRoot").style.display = "flex";
}

async function deleteClusterRule(id, name) {
  if (!confirm(`Apagar a regra de "${name}"?`)) return;
  const { error } = await supabaseClient.from("transaction_cluster_rules").delete().eq("id", id);
  if (error) { alert("Erro: " + error.message); return; }
  _clusterRules = _clusterRules.filter((r) => r.id !== id);
  renderClusterRules();
}

// Best-effort header detection so an import works even if the spreadsheet's
// exact column order/labels differ slightly from the reference file. The
// cluster driver is the client's own account code column ("Histórico", e.g.
// "005031-ALUGUEIS") — that's the granular list clusterization assigns to,
// not the broader "Conta" rollup, which we don't use here.
function detectClusterColumns(headerRow) {
  const norm = (v) => String(v ?? "").toLowerCase();
  const cols = { supplier: -1, cnpj: -1, cluster: -1 };
  headerRow.forEach((cell, idx) => {
    const h = norm(cell);
    if (cols.supplier === -1 && (h.includes("fornecedor") || h.includes("cliente"))) cols.supplier = idx;
    else if (cols.cnpj === -1 && h.includes("cnpj")) cols.cnpj = idx;
    else if (cols.cluster === -1 && h.includes("hist")) cols.cluster = idx;
  });
  if (cols.cluster === -1) {
    // Fall back to a "conta"/"cluster"/"categoria" header if the sheet has
    // no Histórico column at all.
    headerRow.forEach((cell, idx) => {
      const h = norm(cell);
      if (cols.cluster === -1 && (h.includes("conta") || h.includes("cluster") || h.includes("categoria"))) cols.cluster = idx;
    });
  }
  return cols;
}

async function importClusterFile(session, file) {
  const statusEl = document.getElementById("clusterImportStatus");
  statusEl.style.display = "block";
  statusEl.textContent = "Lendo planilha…";

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    let headerIdx = -1;
    let cols = null;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const detected = detectClusterColumns(rows[i] || []);
      if (detected.supplier !== -1 && detected.cluster !== -1) {
        headerIdx = i;
        cols = detected;
        break;
      }
    }
    if (!cols) throw new Error("Não foi possível identificar as colunas de fornecedor/cluster na planilha.");

    const parsed = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const supplier_name = row[cols.supplier] != null ? String(row[cols.supplier]).trim() : "";
      const cluster_label = cols.cluster !== -1 && row[cols.cluster] != null ? String(row[cols.cluster]).trim() : "";
      if (!supplier_name || !cluster_label) continue;
      parsed.push({
        supplier_name,
        cnpj: cols.cnpj !== -1 && row[cols.cnpj] != null ? String(row[cols.cnpj]).trim() : null,
        cluster_label,
      });
    }
    if (!parsed.length) throw new Error("Nenhuma linha válida encontrada na planilha.");

    statusEl.textContent = `${parsed.length} linha(s) encontrada(s). Criando categorias e importando regras…`;

    if (!_clusterCategories.length) await loadOrSeedClusterCategories(session);

    // Auto-create any cluster label not yet a configured cluster category.
    const existingNames = new Set(_clusterCategories.map((c) => c.name));
    const newCategoryNames = [...new Set(parsed.map((p) => p.cluster_label))].filter((n) => !existingNames.has(n));
    if (newCategoryNames.length) {
      const maxOrder = _clusterCategories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
      const toInsert = newCategoryNames.map((name, idx) => ({
        org_id: session.orgId, name, sort_order: maxOrder + idx + 1,
      }));
      const { data: inserted, error: catErr } = await supabaseClient
        .from("cluster_categories").insert(toInsert).select("*");
      if (catErr) throw new Error("Erro ao criar categorias: " + catErr.message);
      _clusterCategories.push(...(inserted || []));
    }
    const categoryIdByName = new Map(_clusterCategories.map((c) => [c.name, c.id]));

    const toInsertRules = parsed.map((p) => ({
      org_id: session.orgId,
      supplier_name: p.supplier_name,
      cnpj: p.cnpj,
      cluster_label: p.cluster_label,
      cluster_category_id: categoryIdByName.get(p.cluster_label) || null,
    }));

    // Insert in chunks to stay well under request size limits.
    const CHUNK = 500;
    for (let i = 0; i < toInsertRules.length; i += CHUNK) {
      const { error: insErr } = await supabaseClient
        .from("transaction_cluster_rules")
        .insert(toInsertRules.slice(i, i + CHUNK));
      if (insErr) throw new Error("Erro ao importar regras: " + insErr.message);
    }

    populateClusterCategoryOptions();
    await loadClusterRules(session);
    statusEl.textContent = `Importação concluída: ${parsed.length} regra(s) adicionada(s)${newCategoryNames.length ? `, ${newCategoryNames.length} categoria(s) nova(s) criada(s)` : ""}.`;
  } catch (err) {
    statusEl.textContent = "Erro na importação: " + (err.message || String(err));
  }
}

// Column names match what importClusterFile's detectClusterColumns already
// recognizes ("fornecedor/cliente", "cnpj", "cluster"), so a file exported
// here re-imports cleanly without needing the Histórico-specific headers.
function exportClusterRulesToExcel() {
  const rows = _clusterRules.map((r) => ({
    "Fornecedor/Cliente": r.supplier_name,
    "CNPJ/CPF": r.cnpj ? formatCnpjCpf(r.cnpj) : "",
    "Cluster": r.cluster_label,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clusterização");
  XLSX.writeFile(wb, "clusterizacao-fornecedores.xlsx");
}

// ── Base de pagamentos do ERP ───────────────────────────────────────────────
// Espelha src/domain/erp-payment-import.js, que é onde a leitura tem teste.
// O casamento com o banco roda no servidor (match-erp-payments), janela a
// janela, porque um ano de folha não cabe numa chamada.

const ERP_EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const ERP_EXPENSE_CODE_RE = /^\d{6}-/;
const ERP_MATCH_WINDOW_DAYS = 10;
const ERP_UPLOAD_CHUNK = 1000;

function erpText(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function erpNormalizeHeader(value) {
  return erpText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function erpDateToIso(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    return new Date(ERP_EXCEL_EPOCH_MS + Math.floor(value + 0.001) * 86400000).toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const match = erpText(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function erpAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = erpText(value).replace(/[R$\s]/g, "");
  if (!raw) return null;
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function erpDetectColumns(headerRow) {
  const cols = { paidOn: -1, bank: -1, amount: -1, expense: -1, title: -1, supplier: -1, document: -1, history: -1, category: -1 };
  headerRow.forEach((cell, idx) => {
    const h = erpNormalizeHeader(cell);
    if (!h) return;
    if (cols.paidOn === -1 && h.includes("baixa")) cols.paidOn = idx;
    else if (cols.bank === -1 && h === "banco") cols.bank = idx;
    else if (cols.amount === -1 && (h === "valor" || h === "valor pago")) cols.amount = idx;
    else if (cols.expense === -1 && h.startsWith("despesa")) cols.expense = idx;
    else if (cols.title === -1 && h.startsWith("titulo")) cols.title = idx;
    else if (cols.supplier === -1 && (h.includes("fornecedor") || h.includes("cliente"))) cols.supplier = idx;
    else if (cols.document === -1 && (h.includes("cnpj") || h.includes("cpf"))) cols.document = idx;
    else if (cols.history === -1 && h.startsWith("historico")) cols.history = idx;
    else if (cols.category === -1 && (h === "natureza" || h === "categoria" || h === "cluster")) cols.category = idx;
  });
  const found = cols.paidOn !== -1 && cols.bank !== -1 && cols.amount !== -1 && (cols.expense !== -1 || cols.category !== -1);
  return found ? cols : null;
}

function erpReadExpenseCategoryMap(rows, firstColumn) {
  const map = new Map();
  for (const row of rows) {
    if (!row) continue;
    for (let c = firstColumn; c < row.length - 1; c++) {
      const key = erpText(row[c]);
      const label = erpText(row[c + 1]);
      if (!ERP_EXPENSE_CODE_RE.test(key) || !label || ERP_EXPENSE_CODE_RE.test(label) || /^-?\d/.test(label)) continue;
      map.set(key, label);
      map.set(key.slice(0, 6), label);
    }
  }
  return map;
}

function erpParsePaymentRows(rows) {
  let headerIdx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const detected = erpDetectColumns(rows[i] || []);
    if (detected) { headerIdx = i; cols = detected; break; }
  }
  if (!cols) return null;

  const categoryByExpense = erpReadExpenseCategoryMap(rows, Math.max(...Object.values(cols)) + 1);
  const titles = [];
  const seen = new Map();
  let skipped = 0;
  let withoutCategory = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const paidOn = erpDateToIso(row[cols.paidOn]);
    const amount = erpAmount(row[cols.amount]);
    if (!paidOn || amount == null || amount === 0) {
      if (erpText(row[cols.amount]) || erpText(row[cols.paidOn])) skipped++;
      continue;
    }
    const bankValue = erpAmount(row[cols.bank]);
    const expense = cols.expense !== -1 ? erpText(row[cols.expense]) || null : null;
    const explicit = cols.category !== -1 ? erpText(row[cols.category]) : "";
    const category = explicit || (expense ? categoryByExpense.get(expense) ?? categoryByExpense.get(expense.slice(0, 6)) ?? null : null);
    if (!category) withoutCategory++;

    const titleRef = cols.title !== -1 ? erpText(row[cols.title]) || null : null;
    const supplier = cols.supplier !== -1 ? erpText(row[cols.supplier]) || null : null;
    const absAmount = Math.round(Math.abs(amount) * 100) / 100;
    const bank = bankValue != null && Number.isInteger(bankValue) ? bankValue : null;
    const base = [titleRef, supplier, expense, paidOn, bank, absAmount.toFixed(2)].join("|");
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);

    titles.push({
      bank_code: bank,
      paid_on: paidOn,
      amount: absAmount,
      supplier,
      supplier_document: cols.document !== -1 ? erpText(row[cols.document]) || null : null,
      expense,
      category,
      history: cols.history !== -1 ? erpText(row[cols.history]) || null : null,
      title_ref: titleRef,
      row_key: `${base}#${occurrence}`,
    });
  }
  return { titles, stats: { rows: titles.length, skipped, withoutCategory } };
}

function erpShiftDay(day, offset) {
  return new Date(Date.parse(day + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}

// Reads only the sheet that holds the report: the client's workbook carries a
// dozen other tabs (one with a million rows of daily balances), and parsing
// them all would freeze the page for minutes.
async function erpReadWorkbookTitles(file, onStatus) {
  const buf = await file.arrayBuffer();
  const names = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames || [];
  const preferred = names.filter((n) => /pgto|pagamento|titulo|título/i.test(n));
  const candidates = [...preferred, ...names.filter((n) => !preferred.includes(n))];
  for (const name of candidates) {
    onStatus(`Lendo a aba "${name}"…`);
    const wb = XLSX.read(buf, { type: "array", sheets: [name] });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
    const parsed = erpParsePaymentRows(rows);
    if (parsed && parsed.titles.length) return { sheet: name, ...parsed };
  }
  return null;
}

async function importErpPaymentBase(session, file) {
  const statusEl = document.getElementById("erpImportStatus");
  const button = document.getElementById("btnImportErpBase");
  const setStatus = (msg) => { statusEl.textContent = msg; };
  button.disabled = true;

  try {
    const parsed = await erpReadWorkbookTitles(file, setStatus);
    if (!parsed) throw new Error("Nenhuma aba com as colunas Dt. Baixa, Banco, Valor e Despesa foi encontrada.");

    // Titles from before the first bank transaction can never match; skipping
    // them keeps the upload to what is useful.
    const { data: firstTx } = await supabaseClient
      .from("pluggy_transactions").select("date").eq("org_id", session.orgId).is("deleted_at", null)
      .order("date", { ascending: true }).limit(1);
    const since = firstTx && firstTx[0] ? erpShiftDay(firstTx[0].date, -5) : null;
    const titles = parsed.titles.filter((t) => !since || t.paid_on >= since);
    if (!titles.length) throw new Error("A base não tem títulos no período em que há extrato bancário.");

    const { data: importRow, error: importErr } = await supabaseClient
      .from("erp_payment_imports")
      .insert({ org_id: session.orgId, file_name: file.name, titles_count: titles.length, created_by: session.id })
      .select("id").single();
    if (importErr) throw new Error("Erro ao registrar a importação: " + importErr.message);

    for (let i = 0; i < titles.length; i += ERP_UPLOAD_CHUNK) {
      setStatus(`Enviando títulos ${Math.min(i + ERP_UPLOAD_CHUNK, titles.length).toLocaleString("pt-BR")} de ${titles.length.toLocaleString("pt-BR")}…`);
      const chunk = titles.slice(i, i + ERP_UPLOAD_CHUNK).map((t) => ({ ...t, org_id: session.orgId, import_id: importRow.id }));
      const { error } = await supabaseClient
        .from("erp_payment_titles").upsert(chunk, { onConflict: "org_id,row_key", ignoreDuplicates: true });
      if (error) throw new Error("Erro ao enviar títulos: " + error.message);
    }

    const firstDay = titles.reduce((m, t) => (t.paid_on < m ? t.paid_on : m), titles[0].paid_on);
    const today = new Date().toISOString().slice(0, 10);
    const lastTitle = titles.reduce((m, t) => (t.paid_on > m ? t.paid_on : m), firstDay);
    const lastDay = erpShiftDay(lastTitle, 5) < today ? erpShiftDay(lastTitle, 5) : today;

    const totals = { exact: 0, batch: 0, same_day: 0, written: 0, outflows: 0 };
    for (let from = firstDay; from <= lastDay; from = erpShiftDay(from, ERP_MATCH_WINDOW_DAYS)) {
      const windowEnd = erpShiftDay(from, ERP_MATCH_WINDOW_DAYS - 1);
      const to = windowEnd < lastDay ? windowEnd : lastDay;
      setStatus(`Casando com o extrato: ${from.split("-").reverse().join("/")} a ${to.split("-").reverse().join("/")}…`);
      const { data, error } = await supabaseClient.functions.invoke("match-erp-payments", { body: { from, to } });
      if (error || !data || data.error) throw new Error("Erro no casamento: " + ((data && data.error) || (error && error.message) || "sem resposta"));
      totals.exact += data.matched.exact;
      totals.batch += data.matched.batch;
      totals.same_day += data.matched.same_day;
      totals.written += data.written;
      totals.outflows += data.outflows;
    }

    const fmt = (n) => n.toLocaleString("pt-BR");
    setStatus(
      `Concluído. Aba "${parsed.sheet}": ${fmt(titles.length)} títulos no período do extrato` +
      (parsed.stats.withoutCategory ? ` (${fmt(parsed.stats.withoutCategory)} sem natureza na tabela de despesas)` : "") +
      `. ${fmt(totals.written)} de ${fmt(totals.outflows)} saídas em aberto classificadas: ` +
      `${fmt(totals.exact)} por título exato, ${fmt(totals.batch)} por lote e ${fmt(totals.same_day)} pelos títulos do mesmo banco e dia.`
    );
  } catch (err) {
    setStatus("Erro na importação: " + (err.message || String(err)));
  } finally {
    button.disabled = false;
  }
}

// Espelha erpTemplateRows de src/domain/erp-payment-import.js, onde o teste
// garante que o modelo é aceito pela própria importação.
function erpTemplateRows(categoryNames) {
  const pick = (wanted, fallback) => categoryNames.find((n) => n === wanted) ?? categoryNames[fallback] ?? wanted;
  const assessorias = pick("Assessorias", 0);
  const temporario = pick("Pessoal temporário", 1);
  const financeiras = pick("Despesas financeiras", 2);
  const day = (d) => new Date(2026, 9, d);

  const header = ["Título", "Cliente/Fornecedor", "Despesa", "Dt.Baixa", "Banco", "Valor", "CNPJ", "Histórico Título", "Natureza", "", "Despesa (de-para)", "Natureza (de-para)"];
  const pagamentos = [
    header,
    ["000123 - 001", "ESCRITORIO CONTABIL EXEMPLO LTDA", "005035-HONORARIOS CONTABEIS", day(5), 341, 1500, "00.000.000/0001-00", "Honorários 09/2026", "", "", "005035-HONORARIOS CONTABEIS", assessorias],
    ["000124 - 001", "CLIENTE TOMADOR EXEMPLO S.A.", "001002-LIQUIDO DE PAGAMENTO - TEMPORARIOS", day(6), 33, 2350.75, "11.111.111/0001-11", "Salário temporário", "", "", "001002-LIQUIDO DE PAGAMENTO - TEMPORARIOS", temporario],
    ["000125 - 001", "BANCO EXEMPLO S.A.", "", day(7), 237, 980.4, "", "Juros de conta garantida", financeiras, "", "", ""],
  ];

  const instrucoes = [
    ["Coluna", "Obrigatória", "O que colocar"],
    ["Dt.Baixa", "Sim", "Data em que o título foi pago (baixado), em formato de data. É ela que casa com a data do extrato."],
    ["Banco", "Sim", "Código do banco de onde saiu o pagamento: 341 Itaú, 237 Bradesco, 104 Caixa, 33 Santander, 422 Safra, 218 BS2, 1 Banco do Brasil."],
    ["Valor", "Sim", "Valor pago, positivo, com centavos (ex.: 1500,00)."],
    ["Despesa", "Sim, se não houver Natureza", "Código e nome da despesa no ERP (ex.: 005035-HONORARIOS CONTABEIS). A natureza vem da tabela de-para."],
    ["Natureza", "Sim, se não houver Despesa", "Natureza do pagamento, igual a uma da aba Naturezas. Quando preenchida, vale mais que a tabela de-para."],
    ["Título", "Não", "Número do título no ERP. Ajuda a reconhecer o mesmo título quando a base é enviada de novo."],
    ["Cliente/Fornecedor", "Não", "Quem recebeu o pagamento."],
    ["CNPJ", "Não", "CNPJ ou CPF de quem recebeu."],
    ["Histórico Título", "Não", "Descrição livre do título."],
    ["Despesa (de-para) / Natureza (de-para)", "Não", "Tabela ao lado dos títulos que traduz cada despesa em natureza. Uma linha por despesa; pode ficar em qualquer coluna à direita dos títulos."],
    ["", "", ""],
    ["Dicas", "", "O cabeçalho pode estar em qualquer linha entre as 30 primeiras, e as colunas podem estar em qualquer ordem: a importação acha cada uma pelo nome."],
    ["", "", "Pode enviar a base completa todo mês: títulos já enviados são reconhecidos e não duplicam."],
    ["", "", "Apague as linhas de exemplo antes de enviar."],
  ];

  const naturezas = [["Natureza"], ...categoryNames.map((n) => [n])];
  return { pagamentos, instrucoes, naturezas };
}

function downloadErpTemplate() {
  const names = (_clusterCategories || []).map((c) => c.name).filter(Boolean);
  const { pagamentos, instrucoes, naturezas } = erpTemplateRows(names);
  const wb = XLSX.utils.book_new();

  const wsPag = XLSX.utils.aoa_to_sheet(pagamentos, { cellDates: true, dateNF: "dd/mm/yyyy" });
  wsPag["!cols"] = [14, 34, 42, 12, 8, 12, 20, 28, 24, 3, 42, 24].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, wsPag, "Pagamentos");

  const wsIns = XLSX.utils.aoa_to_sheet(instrucoes);
  wsIns["!cols"] = [{ wch: 36 }, { wch: 26 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsIns, "Instruções");

  const wsNat = XLSX.utils.aoa_to_sheet(naturezas);
  wsNat["!cols"] = [{ wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsNat, "Naturezas");

  XLSX.writeFile(wb, "modelo-base-pagamentos-erp.xlsx");
}

async function initErpImport(session) {
  const card = document.getElementById("erpImportCard");
  if (!card) return;
  const canImport = session.isProFixAdmin || session.role === "Admin" || session.role === "Financeiro";
  if (!canImport) return;

  const { data: org } = await supabaseClient
    .from("organizations").select("erp_payment_import_enabled").eq("id", session.orgId).maybeSingle();
  if (!org || !org.erp_payment_import_enabled) return;

  card.style.display = "";
  const { data: last } = await supabaseClient
    .from("erp_payment_imports").select("file_name, titles_count, created_at")
    .eq("org_id", session.orgId).order("created_at", { ascending: false }).limit(1);
  if (last && last[0]) {
    const when = new Date(last[0].created_at).toLocaleString("pt-BR");
    document.getElementById("erpImportStatus").textContent =
      `Última importação: ${last[0].file_name || "arquivo"} — ${Number(last[0].titles_count).toLocaleString("pt-BR")} títulos, em ${when}.`;
  }

  document.getElementById("btnErpTemplate").addEventListener("click", downloadErpTemplate);
  document.getElementById("btnImportErpBase").addEventListener("click", () => {
    document.getElementById("erpImportFile").click();
  });
  document.getElementById("erpImportFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await importErpPaymentBase(session, file);
  });
}

function initClusterEditor(session) {
  _clusterSession = session;

  document.getElementById("btnAddCluster").addEventListener("click", () => openClusterModal(null));
  document.getElementById("clusterModalClose").addEventListener("click", () => {
    document.getElementById("clusterModalRoot").style.display = "none";
  });
  document.getElementById("clusterCancel").addEventListener("click", () => {
    document.getElementById("clusterModalRoot").style.display = "none";
  });

  document.getElementById("btnImportClusters").addEventListener("click", () => {
    document.getElementById("clusterImportFile").click();
  });
  document.getElementById("clusterImportFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) await importClusterFile(session, file);
  });
  document.getElementById("btnExportClusters").addEventListener("click", () => exportClusterRulesToExcel());
  document.getElementById("clusterRulesSearch").addEventListener("input", (e) => {
    _clusterRulesSearch = e.target.value;
    _clusterRulesPage = 1;
    renderClusterRules();
  });

  document.getElementById("clusterForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("clusterId").value || null;
    const supplier_name = document.getElementById("clusterSupplierName").value.trim();
    const cnpj = document.getElementById("clusterCnpj").value.trim() || null;
    const historico_hint = document.getElementById("clusterHistorico").value.trim() || null;
    const cluster_category_id = document.getElementById("clusterCategoryId").value;
    const errEl = document.getElementById("clusterError");
    const btn = document.getElementById("clusterSubmit");

    if (!supplier_name) { errEl.textContent = "Informe o nome do fornecedor/cliente."; return; }
    if (!cluster_category_id) { errEl.textContent = "Selecione uma categoria."; return; }
    const category = _clusterCategories.find((c) => c.id === cluster_category_id);

    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";

    try {
      const payload = {
        org_id: session.orgId, supplier_name, cnpj, historico_hint,
        cluster_category_id, cluster_label: category?.name || supplier_name,
        updated_at: new Date().toISOString(),
      };
      let row;
      if (id) {
        const { data, error } = await supabaseClient
          .from("transaction_cluster_rules").update(payload).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        row = data;
        _clusterRules = _clusterRules.map((r) => r.id === id ? row : r);
      } else {
        const { data, error } = await supabaseClient
          .from("transaction_cluster_rules").insert(payload).select().single();
        if (error) throw new Error(error.message);
        row = data;
        _clusterRules.push(row);
      }
      document.getElementById("clusterModalRoot").style.display = "none";
      renderClusterRules();
    } catch (err) {
      errEl.textContent = "Erro: " + (err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Salvar";
    }
  });
}

// ── Visões ──────────────────────────────────────────────────────────────────
//
// A visão é um recorte das empresas da organização. Quem cria é o Admin da
// organização; o cadastro do CNPJ em si é exclusivo do backoffice.
//
// A visão padrão (is_all) não é editável nem removível: ela é a garantia de
// que sempre existe um recorte que reproduz os números de hoje.

let _viewEditorCompanies = [];
let _viewEditorSession = null;
let _viewEditorViewId = null;

async function paintViewsSection(session) {
  const list = document.getElementById("viewsList");
  const tab = document.getElementById("viewsTab");
  if (!list || !session?.orgId) return;

  const [{ data: companies }, views] = await Promise.all([
    supabaseClient.from("companies").select("id, name, cnpj, is_active").eq("org_id", session.orgId).order("name"),
    loadOrgViews(session),
  ]);

  _viewEditorCompanies = companies || [];
  _viewEditorSession = session;

  // Sem empresa cadastrada não há o que recortar, e a aba só confundiria.
  if (_viewEditorCompanies.length === 0) {
    if (tab) tab.style.display = "none";
    return;
  }
  if (tab) tab.style.display = "";

  const companyName = new Map(_viewEditorCompanies.map((c) => [c.id, c.name]));

  list.innerHTML = `
    <table class="saldo-table">
      <thead><tr><th style="text-align:left">Visão</th><th style="text-align:left">Empresas</th><th></th></tr></thead>
      <tbody>
        ${views.map((view) => `
          <tr>
            <td style="text-align:left">
              ${escapeHtml(view.name)}
              ${view.isDefault ? '<span class="kpi-delta kd-up" style="margin-left:8px">padrão</span>' : ""}
            </td>
            <td style="text-align:left;color:var(--muted);font-size:12px">
              ${view.isAll
                ? "Todas as empresas da organização"
                : escapeHtml(view.companyIds.map((id) => companyName.get(id) || "—").join(", ")) || "Nenhuma empresa"}
            </td>
            <td style="text-align:right;white-space:nowrap">
              ${view.isAll
                ? '<span class="cs">não editável</span>'
                : `<button type="button" class="btn-secondary btn-edit-view" data-vid="${escapeHtmlAttr(view.id)}" style="padding:3px 10px;font-size:11px">Editar</button>
                   <button type="button" class="btn-secondary btn-delete-view" data-vid="${escapeHtmlAttr(view.id)}" data-name="${escapeHtmlAttr(view.name)}" style="padding:3px 10px;font-size:11px;color:#ff6b6b;border-color:rgba(255,107,107,.4)">Remover</button>`}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;

  document.querySelectorAll(".btn-edit-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      openViewEditor(views.find((v) => v.id === btn.dataset.vid) || null);
    });
  });

  document.querySelectorAll(".btn-delete-view").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Remover a visão "${btn.dataset.name}"?`)) return;
      btn.disabled = true;
      const { error } = await supabaseClient.from("views").delete().eq("id", btn.dataset.vid);
      if (error) {
        alert("Não foi possível remover a visão: " + error.message);
        btn.disabled = false;
        return;
      }
      await paintViewsSection(session);
    });
  });
}

function openViewEditor(view) {
  _viewEditorViewId = view ? view.id : null;
  const selected = new Set(view ? view.companyIds : []);

  document.getElementById("viewModalTitle").textContent = view ? "Editar visão" : "Nova visão";
  document.getElementById("viewName").value = view ? view.name : "";
  document.getElementById("viewError").textContent = "";
  document.getElementById("viewCompaniesGrid").innerHTML = _viewEditorCompanies
    .map((company) => `
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" class="view-company-check" value="${escapeHtmlAttr(company.id)}"${selected.has(company.id) ? " checked" : ""} />
        <span>${escapeHtml(company.name)}${company.is_active === false ? " (inativa)" : ""}</span>
      </label>`)
    .join("");

  document.getElementById("viewModalRoot").style.display = "flex";
}

async function saveViewFromEditor() {
  const errorEl = document.getElementById("viewError");
  const submitBtn = document.getElementById("viewSubmit");
  errorEl.textContent = "";

  const name = document.getElementById("viewName").value.trim();
  if (!name) {
    errorEl.textContent = "Dê um nome à visão.";
    return;
  }

  // Os ids são interpolados num filtro `in (...)` do PostgREST mais abaixo.
  // Eles vêm do HTML que este arquivo mesmo gerou, mas um valor fora do
  // formato de UUID quebraria a consulta de um jeito difícil de diagnosticar —
  // e a consulta em questão é a que APAGA vínculos.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const companyIds = [...document.querySelectorAll(".view-company-check")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value)
    .filter((id) => UUID.test(id));

  // Um recorte vazio é tratado como "tudo" na hora de somar, o que faria a
  // visão mostrar a organização inteira com um nome que promete outra coisa.
  if (companyIds.length === 0) {
    errorEl.textContent = "Escolha ao menos uma empresa.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";

  try {
    let viewId = _viewEditorViewId;

    if (viewId) {
      const { error } = await supabaseClient.from("views").update({ name }).eq("id", viewId);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient
        .from("views")
        .insert({ org_id: _viewEditorSession.orgId, name, is_all: false, is_default: false })
        .select("id")
        .single();
      if (error) throw error;
      viewId = data.id;
    }

    // Inserir antes de apagar, de propósito. Se a gravação falhar no meio, o
    // recorte fica maior do que o pedido — visivelmente errado. Apagando
    // primeiro, uma falha deixaria o recorte VAZIO, e recorte vazio é tratado
    // como "todas as empresas": a tela mostraria a organização inteira sob o
    // nome de um recorte, que é errar em silêncio.
    const { error: insertError } = await supabaseClient
      .from("view_companies")
      .upsert(companyIds.map((id) => ({ view_id: viewId, company_id: id })), {
        onConflict: "view_id,company_id",
      });
    if (insertError) throw insertError;

    const { error: deleteError } = await supabaseClient
      .from("view_companies")
      .delete()
      .eq("view_id", viewId)
      .not("company_id", "in", `(${companyIds.join(",")})`);
    if (deleteError) throw deleteError;

    document.getElementById("viewModalRoot").style.display = "none";
    await paintViewsSection(_viewEditorSession);
  } catch (err) {
    errorEl.textContent = /views_nome_unico/.test(err?.message || "")
      ? "Já existe uma visão com esse nome nesta organização."
      : "Erro ao salvar a visão: " + (err?.message || "desconhecido");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar visão";
  }
}

function initViewEditor(session) {
  const closeBtn = document.getElementById("viewModalClose");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("viewModalRoot").style.display = "none";
    });
  }
  const addBtn = document.getElementById("addViewBtn");
  if (addBtn) addBtn.addEventListener("click", () => openViewEditor(null));

  const form = document.getElementById("viewForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveViewFromEditor();
    });
  }
  _viewEditorSession = session;
}


// ── Faturamento ─────────────────────────────────────────────────────────────
//
// A tela lê o resumo da Edge Function `billing`, que já confere se quem chama
// é Admin. Esconder a aba é conforto de interface; o controle de acesso está
// na policy de `org_invoices` e na checagem da função — a tela não é a porta.
//
// Nada aqui escreve o estado da assinatura. Quem escreve é o webhook do Asaas
// (supabase/functions/asaas-webhook): um estado de cobrança com dois autores
// acabaria liberando acesso sem pagamento.

const BILLING_STATUS_LABEL = {
  trialing: { text: "Sem cobrança", chip: "ok" },
  active: { text: "Em dia", chip: "ok" },
  past_due: { text: "Em atraso", chip: "warn" },
  suspended: { text: "Suspensa", chip: "bad" },
  canceled: { text: "Cancelada", chip: "bad" },
};

/**
 * O selo que a organização vê. Quem é cobrado por fora não tem situação de
 * cobrança no portal — mostrar "Em dia" ou "Em atraso" para ele seria afirmar
 * algo que o portal não apurou, já que não recebe confirmação de pagamento
 * nenhuma. O selo diz o que é verdade: a cobrança acontece em outro lugar.
 */
function billingStateLabel(subscription) {
  if (subscription?.billing_mode === "external") {
    return { text: "Cobrança externa", chip: "ok" };
  }
  return BILLING_STATUS_LABEL[subscription?.status] || { text: "Sem assinatura", chip: "warn" };
}

/**
 * Espelha planPriceLabel de src/domain/billing.js, que é onde há teste.
 * Centavos inteiros entram, string formatada sai.
 */
function billingPrice(cents) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return "—";
  const value = Number(cents) / 100;
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

/** @param {string|null|undefined} iso yyyy-mm-dd */
function billingDate(iso) {
  if (typeof iso !== "string") return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function billingInvoiceRow(invoice) {
  const paid = invoice.status === "RECEIVED" || invoice.status === "CONFIRMED";
  const chip = paid ? "ok" : invoice.status === "OVERDUE" ? "bad" : "warn";
  const label = paid ? "Paga" : invoice.status === "OVERDUE" ? "Vencida" : "Agendada";

  // Só link http(s) vira âncora: o campo vem do Asaas e desce direto para um
  // href. Mesma regra de asHttpUrl em src/contracts/billing.js.
  const href = typeof invoice.receipt_url === "string" && /^https?:\/\//.test(invoice.receipt_url)
    ? invoice.receipt_url
    : typeof invoice.invoice_url === "string" && /^https?:\/\//.test(invoice.invoice_url)
      ? invoice.invoice_url
      : null;

  // O link vira coluna própria em vez de ficar escondido no valor: quem
  // procura o recibo procura uma ação, não um número sublinhado.
  const action = href
    ? `<a class="lnk" href="${escapeHtml(href)}" target="_blank" rel="noopener">Ver</a>`
    : '<span class="bl-muted">—</span>';

  return `<tr>
    <td style="text-align:left">${escapeHtml(billingDate(invoice.due_date))}</td>
    <td style="text-align:left"><span class="bl-chip ${chip}">${escapeHtml(label)}</span></td>
    <td class="num">${escapeHtml(billingPrice(invoice.value_cents))}</td>
    <td>${action}</td>
  </tr>`;
}

function billingPlanCard(plan, currentCode) {
  const isCurrent = plan.code === currentCode;
  const limits = [
    plan.bank_account_limit ? `Até ${plan.bank_account_limit} contas bancárias` : null,
    plan.company_limit ? `Até ${plan.company_limit} CNPJs` : null,
    plan.user_limit ? `Até ${plan.user_limit} usuários` : null,
  ].filter(Boolean);

  return `<button type="button" class="sg-plan" data-billing-plan="${escapeHtml(plan.code)}"
      aria-pressed="${isCurrent ? "true" : "false"}"${isCurrent ? " disabled" : ""}>
    ${plan.highlight ? `<i class="sg-rec">${escapeHtml(plan.highlight)}</i>` : ""}
    <span class="sg-p-name">${escapeHtml(plan.name)}${isCurrent ? " · atual" : ""}</span>
    <span class="sg-p-price"><b class="num">${escapeHtml(billingPrice(plan.monthly_cents))}</b><small>por mês</small></span>
    <span class="sg-p-more">${limits.map((l) => `<span>${escapeHtml(l)}</span>`).join("")}</span>
  </button>`;
}

async function callBilling(action, payload) {
  const { data, error } = await supabaseClient.functions.invoke("billing", {
    body: { action, ...(payload || {}) },
  });

  if (error) {
    let detail = "";
    if (error.context && typeof error.context.json === "function") {
      try { const body = await error.context.json(); detail = body?.error || ""; } catch (_) { /* corpo vazio */ }
    }
    throw new Error(detail || error.message || "Não foi possível falar com o faturamento.");
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function paintBillingSection(session) {
  const tab = document.getElementById("billingTab");
  const body = document.getElementById("billingBody");
  if (!body) return;

  if (session.role !== "Admin" && !session.isProFixAdmin) {
    if (tab) tab.style.display = "none";
    body.innerHTML = "";
    return;
  }
  if (tab) tab.style.display = "";

  let summary;
  try {
    summary = await callBilling("summary");
  } catch (err) {
    body.innerHTML = `<p class="bl-empty">Não foi possível carregar o faturamento: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const subscription = summary.subscription;
  const plans = Array.isArray(summary.plans) ? summary.plans : [];
  const invoices = Array.isArray(summary.invoices) ? summary.invoices : [];
  const plan = plans.find((p) => p.code === subscription?.plan_code);
  const state = billingStateLabel(subscription);

  // Uma organização criada pelo backoffice não tem assinatura no Asaas; dizer
  // isso é mais útil que mostrar uma tela de cobrança vazia.
  const hasAsaas = Boolean(subscription?.asaas_subscription_id);
  const isExternal = subscription?.billing_mode === "external";

  const canceling = subscription?.cancel_at_period_end === true;

  // O cartão exige CNPJ: é obrigatório para criar o cliente no Asaas e é o
  // documento que sai na nota. Cadastrá-lo é exclusivo do backoffice, então
  // quando ele falta o caminho não é pedir ao cliente — é dizer que a ProFin
  // precisa cadastrar. Oferecer um botão que só pode falhar é pior que não
  // oferecer.
  const canStartCard = summary.hasCnpj === true;

  // Referência do cartão: bandeira e quatro últimos, e só. Vem do webhook,
  // que recorta na entrada. Sem isso, o rótulo genérico — dizer
  // "cartão de crédito" é honesto; inventar bandeira não seria.
  const cardLabel = subscription?.card_last4
    ? `${subscription.card_brand || "Cartão"} •••• ${subscription.card_last4}`
    : "Cartão de crédito";

  body.innerHTML = `
    <div class="bl-sheet">
      <section class="bl-sec">
        <h3 class="bl-sec-h">Seu plano</h3>
        <div class="bl-facts">
          <div class="bl-fact">
            <dt>Plano atual</dt>
            <dd><button type="button" class="bl-link" id="billingPlanLink"
                  aria-expanded="false" aria-controls="billingPlansSec">${escapeHtml(
                    plan?.name || subscription?.plan_code || "—",
                  )}<span aria-hidden="true">&#8599;</span></button></dd>
          </div>
          <div class="bl-fact">
            <dt>Valor mensal</dt>
            <dd class="num">${escapeHtml(billingPrice(plan?.monthly_cents))}</dd>
          </div>
          <div class="bl-fact">
            <dt>${canceling ? "Acesso até" : "Próxima cobrança"}</dt>
            <dd class="${isExternal ? "" : "num"}">${isExternal
              ? "Combinada com a ProFin Lab"
              : escapeHtml(billingDate(subscription?.current_period_end))}</dd>
          </div>
          <div class="bl-fact">
            <dt>Situação</dt>
            <dd><span class="bl-chip ${canceling ? "warn" : state.chip}">${escapeHtml(
              canceling ? "Cancelado" : state.text,
            )}</span></dd>
          </div>
        </div>
        ${subscription?.past_due_since && !isExternal && !canceling
          ? `<p class="bl-note bad">Em aberto desde ${escapeHtml(billingDate(subscription.past_due_since))}.</p>`
          : ""}
      </section>

      <section class="bl-sec">
        <h3 class="bl-sec-h">Pagamento</h3>
        <div class="bl-row">
          <div class="bl-row-main">
            ${isExternal
              ? canStartCard
                ? `<b>Cobrança por fora do portal</b>
                   <p>Hoje a ProFin Lab envia o boleto por fora e nada vence aqui. Você pode passar a pagar
                      no cartão, com renovação automática — a mudança só vale depois do primeiro pagamento.</p>`
                : `<b>Cobrança por fora do portal</b>
                   <p>Hoje a ProFin Lab envia o boleto por fora e nada vence aqui. Para pagar no cartão é
                      preciso ter o CNPJ da empresa cadastrado — ele identifica o pagador e sai na nota
                      fiscal. Esse cadastro é feito pela nossa equipe: fale com o suporte e o pagamento no
                      cartão fica disponível aqui em seguida.</p>`
              : hasAsaas
                ? `<b>${escapeHtml(cardLabel)}</b>
                   <p>Renovação automática todo mês. O cartão é digitado numa página do Asaas; o portal
                      guarda apenas a bandeira e os quatro últimos dígitos, para você reconhecê-lo.</p>`
                : `<b>Sem forma de pagamento</b>
                   <p>Esta organização não tem assinatura no Asaas. Fale com o suporte.</p>`}
          </div>
          ${isExternal
            ? canStartCard
              ? '<button type="button" class="bl-action primary" id="billingStartCard">Pagar com cartão</button>'
              : `<a class="bl-action" href="mailto:${escapeHtml(summary.settings?.support_email || "contato@profinlab.com.br")}">Falar com o suporte</a>`
            : hasAsaas
              ? '<button type="button" class="bl-action" id="billingPayLink">Atualizar</button>'
              : ""}
        </div>
        <p class="sg-err" id="billingError" role="alert" style="margin-top:12px"></p>
      </section>

      <section class="bl-sec">
        <h3 class="bl-sec-h">Faturas</h3>
        ${invoices.length === 0
          ? '<p class="bl-empty">Nenhuma cobrança registrada ainda. Cobranças feitas por fora do portal não aparecem aqui.</p>'
          : `<div class="bl-scroll"><table class="bl-tbl">
              <thead><tr><th>Vencimento</th><th>Situação</th><th>Valor</th><th>Recibo</th></tr></thead>
              <tbody>${invoices.map(billingInvoiceRow).join("")}</tbody>
            </table></div>`}
      </section>

      <section class="bl-sec" id="billingPlansSec" hidden>
        <h3 class="bl-sec-h">Mudar de plano</h3>
        <p class="bl-sec-s">Passa a valer na próxima cobrança. A redução é recusada se a organização já
          passar dos limites do plano escolhido.</p>
        <div class="sg-plans" style="grid-template-columns:1fr" id="billingPlans">
          ${plans.map((p) => billingPlanCard(p, subscription?.plan_code)).join("")}
        </div>
      </section>

      ${hasAsaas && !isExternal
        ? `<section class="bl-sec">
            <h3 class="bl-sec-h">Cancelamento</h3>
            <div class="bl-row">
              <div class="bl-row-main">
                ${canceling
                  ? `<b>Assinatura cancelada</b>
                     <p>Não haverá nova cobrança. Seu acesso continua até
                        ${escapeHtml(billingDate(subscription?.current_period_end))}, que é o período já pago.</p>`
                  : `<b>Cancelar plano</b>
                     <p>A cobrança para agora e o acesso continua até o fim do período já pago. Nada é
                        estornado, e nada é apagado.</p>`}
              </div>
              ${canceling ? "" : '<button type="button" class="bl-action danger" id="billingCancel">Cancelar</button>'}
            </div>
          </section>`
        : ""}
    </div>`;

  const errorEl = document.getElementById("billingError");

  // A troca de plano deixa de ocupar a tela e passa a ser um destino: quem
  // abre Cobrança quer saber o que paga e em que cartão, não escolher plano
  // de novo. A lista continua a um clique, pendurada no próprio plano atual.
  document.getElementById("billingPlanLink")?.addEventListener("click", (event) => {
    const secao = document.getElementById("billingPlansSec");
    if (!secao) return;
    const abrindo = secao.hidden;
    secao.hidden = !abrindo;
    event.currentTarget.setAttribute("aria-expanded", abrindo ? "true" : "false");
    if (abrindo) secao.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Passar a pagar pelo portal: mesma janela do cadastro, para o cliente não
  // perder o portal de vista no meio do pagamento.
  document.getElementById("billingStartCard")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    // Aberta no clique, antes do await: depois dele o navegador bloqueia.
    const win = window.open("", "profinlabPagamento", "width=520,height=760");
    button.disabled = true;
    if (errorEl) errorEl.textContent = "";
    try {
      const result = await callBilling("start-card");
      if (win) win.location.href = result.url;
      else window.open(result.url, "_blank");
    } catch (err) {
      win?.close();
      if (errorEl) errorEl.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("billingCancel")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const until = billingDate(subscription?.current_period_end);
    if (!window.confirm(`Cancelar a assinatura? A cobrança para agora e o acesso continua até ${until}.`)) return;

    button.disabled = true;
    if (errorEl) errorEl.textContent = "";
    try {
      await callBilling("cancel");
      await paintBillingSection(session);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
      button.disabled = false;
    }
  });

  document.getElementById("billingPayLink")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    if (errorEl) errorEl.textContent = "";
    try {
      const result = await callBilling("payment-link");
      // O cartão é digitado na página do Asaas; o portal só abre o endereço.
      window.open(result.url, "_blank", "noopener");
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("billingPlans")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-billing-plan]");
    if (!button || button.disabled) return;

    const planCode = button.getAttribute("data-billing-plan");
    const chosen = plans.find((p) => p.code === planCode);
    if (!chosen) return;
    if (!window.confirm(`Mudar para o plano ${chosen.name} por ${billingPrice(chosen.monthly_cents)} por mês?`)) return;

    if (errorEl) errorEl.textContent = "";
    button.disabled = true;
    try {
      await callBilling("change-plan", { planCode });
      await paintBillingSection(session);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
      button.disabled = false;
    }
  });
}

(async function init() {
  const session = await requireOrgSession();

  if (!session) return;

  renderAppShell("settings.html", session);
  renderChatWidget();

  await paintIntegrations(session);
  initViewEditor(session);
  await paintViewsSection(session);
  await paintBillingSection(session);
  initUserAccessLinksModal();
  initUserRowMenu(session);
  await paintUsers(session);
  initSchemaEditor(session);
  await loadSchemaNodes(session);
  initNatureEditor(session);
  await loadNatureCategories(session);
  await loadOrSeedClusterCategories(session);
  initClusterEditor(session);
  await initErpImport(session);
  initClusterCategoryEditor(session);
  await loadClusterRules(session);
  populateClusterCategoryOptions();

  const userModal = document.getElementById("userModalRoot");

  document.getElementById("addUserBtn").addEventListener("click", () => {
    userModal.style.display = "flex";
  });

  // ── Editar usuário (settings) ─────────────────────────────────────────────
  document.getElementById("editUserModalClose").addEventListener("click", () => {
    document.getElementById("editUserModalRoot").style.display = "none";
  });
  document.getElementById("editUserCancel").addEventListener("click", () => {
    document.getElementById("editUserModalRoot").style.display = "none";
  });
  document.getElementById("editUserRole").addEventListener("change", (e) => {
    const perms = ROLE_PERMISSIONS[e.target.value] || [];
    document.getElementById("editUserPermChecks").querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = perms.includes(cb.value);
    });
  });
  document.getElementById("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = document.getElementById("editUserRole").value;
    const permissions = Array.from(
      document.getElementById("editUserPermChecks").querySelectorAll('input[type="checkbox"]:checked')
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
    await paintUsers(session);
  });

  document.getElementById("userCancel").addEventListener("click", () => {
    userModal.style.display = "none";
  });

  document.getElementById("userModalClose").addEventListener("click", () => {
    userModal.style.display = "none";
  });

  document.getElementById("userRole").addEventListener("change", (e) => {
    const perms = ROLE_PERMISSIONS[e.target.value] || [];

    document.querySelectorAll(".perm-checks input[type=checkbox]").forEach((cb) => {
      cb.checked = perms.includes(cb.value);
    });
  });

  document.getElementById("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("userName").value.trim();
    const email = document.getElementById("userEmail").value.trim();
    const role = document.getElementById("userRole").value;
    const permissions = Array.from(
      document.querySelectorAll(".perm-checks input[type=checkbox]:checked")
    ).map((cb) => cb.value);
    const errorEl = document.getElementById("userError");
    const successEl = document.getElementById("userSuccess");
    const submitBtn = document.getElementById("userSubmit");
    errorEl.textContent = "";
    successEl.style.display = "none";

    if (!email) { errorEl.textContent = "Informe o e-mail."; return; }
    if (permissions.length === 0) { errorEl.textContent = "Selecione ao menos uma permissão."; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    const { data, error } = await supabaseClient.functions.invoke("invite-user", {
      body: { email, name, role, permissions, org_id: session.orgId },
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Enviar convite";

    if (error || data?.error) {
      let errMsg = data?.error || "Erro ao enviar convite.";
      if (error) {
        if (error.context && typeof error.context.json === "function") {
          try { const b = await error.context.json(); if (b?.error) errMsg = b.error; } catch (_) { }
        } else {
          errMsg = error.message || errMsg;
        }
      }
      errorEl.textContent = errMsg;
      return;
    }

    successEl.textContent = `Convite enviado para ${email}!`;
    successEl.style.display = "";
    document.getElementById("userName").value = "";
    document.getElementById("userEmail").value = "";
  });

})();
