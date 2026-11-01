function escapeHtmlText(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Turns bare URLs in already-escaped text into clickable links — some
// knowledge pills (e.g. Open Finance) link out to official sources and a
// plain-text URL isn't clickable/trustworthy-looking on its own.
function linkifyEscaped(escapedHtml) {
  return escapedHtml.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trailing = url.match(/[.,;:!?)]+$/)?.[0] || "";
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trailing}`;
  });
}

async function paintKnowledge(session) {
  const { data: items, error } = await supabaseClient
    .from("knowledge_items")
    .select("*")
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("knowledgeCountSub").textContent = "Não foi possível carregar os itens.";
    return;
  }

  document.getElementById("knowledgeCountSub").textContent = `${items.length} item(ns)`;
  document.getElementById("knowledgeGrid").innerHTML = items
    .map(
      (k) => `
      <div class="card">
        <div class="ch">
          <div><div class="ct">${escapeHtmlText(k.title)}</div><div class="cs">${k.category} · ${k.created_by_name || "—"} · ${new Date(k.created_at).toLocaleDateString("pt-BR")}</div></div>
        </div>
        <div class="cs" style="white-space:pre-wrap">${linkifyEscaped(escapeHtmlText(k.body))}</div>
      </div>`
    )
    .join("");
}

(async function init() {
  const session = await requireOrgSession();
  if (!session) return;
  renderAppShell("knowledge.html", session);
  renderChatWidget();
  await paintKnowledge(session);
})();
