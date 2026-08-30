const $ = (sel, root = document) => root.querySelector(sel);
const conteudo = $("#conteudo");
const titulo = $("#titulo");
const btnVoltar = $("#btn-voltar");

const estado = { vista: "ordens", ordemId: null, veiculoId: null };

const eur = (v) => `${(v ?? 0).toFixed(2)} €`;
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const dataHora = (iso) => (iso ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString("pt-PT") : "—");

async function api(caminho, opcoes = {}) {
  const resp = await fetch(`/api${caminho}`, {
    headers: { "Content-Type": "application/json" },
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.detail || `Erro ${resp.status}`);
  }
  return resp.status === 204 ? null : resp.json();
}

function modal(titulo, campos, aoGuardar) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `
    <h2 style="margin-top:0;font-size:18px">${esc(titulo)}</h2>
    <form method="dialog" id="form-modal">
      ${campos
        .map((c) => {
          if (c.tipo === "select") {
            return `<label>${esc(c.rotulo)}</label><select name="${c.nome}">${c.opcoes
              .map((o) => `<option value="${esc(o.valor)}" ${o.valor == c.valor ? "selected" : ""}>${esc(o.texto)}</option>`)
              .join("")}</select>`;
          }
          if (c.tipo === "textarea") {
            return `<label>${esc(c.rotulo)}</label><textarea name="${c.nome}" rows="3">${esc(c.valor ?? "")}</textarea>`;
          }
          return `<label>${esc(c.rotulo)}</label><input name="${c.nome}" type="${c.tipo || "text"}" ${
            c.passo ? `step="${c.passo}"` : ""
          } value="${esc(c.valor ?? "")}" placeholder="${esc(c.placeholder ?? "")}" />`;
        })
        .join("")}
      <div class="acoes">
        <button type="button" class="sec" value="cancelar">Cancelar</button>
        <button type="submit">Guardar</button>
      </div>
    </form>`;
  document.body.append(dlg);
  dlg.querySelector("button.sec").onclick = () => dlg.close();
  $("#form-modal", dlg).onsubmit = async (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await aoGuardar(dados);
      dlg.close();
      dlg.remove();
      render();
    } catch (e) {
      alert(e.message);
    }
  };
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
}

const num = (v, def = null) => (v === "" || v === undefined || v === null ? def : Number(v));
const txt = (v) => (v === "" ? null : v);

// ------------------------------------------------------------------ ordens
async function vistaOrdens() {
  conteudo.innerHTML = $("#tpl-ordens").innerHTML;
  const lista = $("#lista-ordens");
  const carregar = async () => {
    const params = new URLSearchParams();
    if ($("#pesquisa-ordens").value) params.set("q", $("#pesquisa-ordens").value);
    if ($("#filtro-estado").value) params.set("estado", $("#filtro-estado").value);
    const ordens = await api(`/ordens?${params}`);
    lista.innerHTML = ordens.length
      ? ordens
          .map(
            (o) => `
      <div class="card" data-id="${o.id}">
        <h3>#${o.id} · ${esc(o.veiculo?.matricula)} <span class="badge ${o.estado}">${o.estado.replace("_", " ")}</span></h3>
        <p>${esc(o.veiculo?.marca || "")} ${esc(o.veiculo?.modelo || "")} · ${esc(o.veiculo?.cliente?.nome || "sem cliente")}</p>
        <p>${esc(o.descricao_avaria || "sem descrição")}</p>
        <p>${o.totais.horas} h · peças ${eur(o.totais.total_pecas)} · <strong>${eur(o.totais.total)}</strong>
          ${o.cronometro_ativo ? '<span class="cron">● a decorrer</span>' : ""}</p>
        <div class="acoes"><button class="sec" data-ficha="${o.veiculo_id}">Histórico do carro</button></div>
      </div>`
          )
          .join("")
      : '<p class="vazio">Sem obras registadas.</p>';
    lista.querySelectorAll(".card").forEach((c) => {
      c.onclick = () => {
        estado.ordemId = Number(c.dataset.id);
        render();
      };
    });
    lista.querySelectorAll("[data-ficha]").forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        estado.veiculoId = Number(b.dataset.ficha);
        render();
      };
    });
  };
  $("#pesquisa-ordens").oninput = carregar;
  $("#filtro-estado").onchange = carregar;
  $("#nova-ordem").onclick = async () => {
    const veiculos = await api("/veiculos");
    if (!veiculos.length) return alert("Registe primeiro um veículo.");
    modal(
      "Nova obra",
      [
        {
          nome: "veiculo_id",
          rotulo: "Veículo",
          tipo: "select",
          opcoes: veiculos.map((v) => ({
            valor: v.id,
            texto: `${v.matricula} — ${v.marca || ""} ${v.modelo || ""}`.trim(),
          })),
        },
        { nome: "km_entrada", rotulo: "Km atuais", tipo: "number" },
        { nome: "descricao_avaria", rotulo: "O que veio arranjar", tipo: "textarea" },
        { nome: "taxa_hora", rotulo: "Preço mão de obra (€/hora)", tipo: "number", passo: "0.5", valor: 35 },
        { nome: "iva", rotulo: "IVA (%)", tipo: "number", passo: "0.1", valor: 23 },
      ],
      async (d) => {
        const nova = await api("/ordens", {
          method: "POST",
          body: {
            veiculo_id: Number(d.veiculo_id),
            km_entrada: num(d.km_entrada),
            descricao_avaria: d.descricao_avaria,
            taxa_hora: num(d.taxa_hora, 35),
            iva: num(d.iva, 23),
          },
        });
        estado.ordemId = nova.id;
      }
    );
  };
  await carregar();
}

// ------------------------------------------------------------------ detalhe
async function vistaOrdem(id) {
  const o = await api(`/ordens/${id}`);
  const t = o.totais;
  titulo.textContent = `Obra #${o.id} · ${o.veiculo?.matricula ?? ""}`;
  conteudo.innerHTML = `
    <div class="card">
      <h3>${esc(o.veiculo?.matricula)} <span class="badge ${o.estado}">${o.estado.replace("_", " ")}</span></h3>
      <p>${esc(o.veiculo?.marca || "")} ${esc(o.veiculo?.modelo || "")} ${o.veiculo?.ano || ""}</p>
      <p>Cliente: ${esc(o.veiculo?.cliente?.nome || "—")} ${o.veiculo?.cliente?.telefone ? "· " + esc(o.veiculo.cliente.telefone) : ""}</p>
      <p><a href="#" id="ver-historico" style="color:var(--accent)">Ver histórico deste carro ›</a></p>
      <p>Km: ${o.km_entrada ?? o.veiculo?.km_atuais ?? "—"} · Aberta em ${dataHora(o.aberta_em)}</p>
      <p><strong>Avaria:</strong> ${esc(o.descricao_avaria || "—")}</p>
      <p><strong>Trabalho:</strong> ${esc(o.trabalho_realizado || "—")}</p>
      <div class="acoes"><button class="sec" id="editar-ordem">Editar</button></div>
    </div>

    <div class="card">
      <h3>Mão de obra <span>${t.horas} h</span></h3>
      <div class="linhas">
        ${
          o.tempos.length
            ? o.tempos
                .map(
                  (r) => `<div class="linha">
                    <span>${esc(r.descricao || "trabalho")}${r.mecanico ? " · " + esc(r.mecanico) : ""}<br>
                      <small style="color:var(--muted)">${dataHora(r.inicio)}</small></span>
                    <span>${r.a_decorrer ? '<span class="cron">a decorrer</span>' : r.minutos + " min"}
                      ${r.a_decorrer ? `<button class="sec" data-parar="${r.id}">Parar</button>` : ""}
                      <button class="danger" data-apagar-tempo="${r.id}">✕</button></span>
                  </div>`
                )
                .join("")
            : '<p class="vazio">Sem tempos registados.</p>'
        }
      </div>
      <div class="acoes">
        <button class="sec" id="iniciar-cron">▶ Iniciar cronómetro</button>
        <button id="add-tempo">+ Tempo manual</button>
      </div>
    </div>

    <div class="card">
      <h3>Peças <span>${eur(t.total_pecas)}</span></h3>
      <div class="linhas">
        ${
          o.pecas.length
            ? o.pecas
                .map(
                  (p) => `<div class="linha">
                    <span>${esc(p.descricao)}${p.referencia ? " · " + esc(p.referencia) : ""}<br>
                      <small style="color:var(--muted)">${p.quantidade} × ${eur(p.preco_unitario)}</small></span>
                    <span>${eur(p.total)} <button class="danger" data-apagar-peca="${p.id}">✕</button></span>
                  </div>`
                )
                .join("")
            : '<p class="vazio">Sem peças aplicadas.</p>'
        }
      </div>
      <div class="acoes"><button id="add-peca">+ Peça</button></div>
    </div>

    <div class="card totais">
      <div><span>Mão de obra (${t.horas} h × ${eur(o.taxa_hora)})</span><span>${eur(t.total_mao_obra)}</span></div>
      <div><span>Peças</span><span>${eur(t.total_pecas)}</span></div>
      <div><span>Desconto</span><span>-${eur(t.desconto)}</span></div>
      <div><span>Subtotal</span><span>${eur(t.subtotal)}</span></div>
      <div><span>IVA ${o.iva}%</span><span>${eur(t.valor_iva)}</span></div>
      <div class="grande"><span>Total</span><span>${eur(t.total)}</span></div>
      <div class="acoes">
        <button class="sec" id="imprimir">Imprimir / PDF</button>
        <button id="mudar-estado">Estado</button>
      </div>
    </div>`;

  $("#imprimir").onclick = () => window.print();

  $("#ver-historico").onclick = (ev) => {
    ev.preventDefault();
    estado.ordemId = null;
    estado.veiculoId = o.veiculo_id;
    render();
  };

  $("#editar-ordem").onclick = () =>
    modal(
      "Editar obra",
      [
        { nome: "descricao_avaria", rotulo: "Avaria", tipo: "textarea", valor: o.descricao_avaria },
        { nome: "trabalho_realizado", rotulo: "Trabalho realizado", tipo: "textarea", valor: o.trabalho_realizado },
        { nome: "km_entrada", rotulo: "Km", tipo: "number", valor: o.km_entrada ?? "" },
        { nome: "taxa_hora", rotulo: "€/hora", tipo: "number", passo: "0.5", valor: o.taxa_hora },
        { nome: "desconto", rotulo: "Desconto (€)", tipo: "number", passo: "0.01", valor: o.desconto },
        { nome: "iva", rotulo: "IVA (%)", tipo: "number", passo: "0.1", valor: o.iva },
      ],
      (d) =>
        api(`/ordens/${o.id}`, {
          method: "PATCH",
          body: {
            descricao_avaria: d.descricao_avaria,
            trabalho_realizado: d.trabalho_realizado,
            km_entrada: num(d.km_entrada),
            taxa_hora: num(d.taxa_hora),
            desconto: num(d.desconto),
            iva: num(d.iva),
          },
        })
    );

  $("#mudar-estado").onclick = () =>
    modal(
      "Estado da obra",
      [
        {
          nome: "estado",
          rotulo: "Estado",
          tipo: "select",
          valor: o.estado,
          opcoes: [
            { valor: "aberta", texto: "Aberta" },
            { valor: "em_curso", texto: "Em curso" },
            { valor: "concluida", texto: "Concluída" },
            { valor: "faturada", texto: "Faturada" },
          ],
        },
      ],
      (d) => api(`/ordens/${o.id}`, { method: "PATCH", body: { estado: d.estado } })
    );

  const mecanicos = await api("/mecanicos");
  const opcoesMec = [{ valor: "", texto: "— sem mecânico —" }].concat(
    mecanicos.map((m) => ({ valor: m.id, texto: m.nome }))
  );

  $("#iniciar-cron").onclick = () =>
    modal(
      "Iniciar cronómetro",
      [
        { nome: "descricao", rotulo: "Tarefa", placeholder: "ex. substituição de travões" },
        { nome: "mecanico_id", rotulo: "Mecânico", tipo: "select", opcoes: opcoesMec },
      ],
      (d) =>
        api(`/ordens/${o.id}/tempos`, {
          method: "POST",
          body: { descricao: d.descricao, mecanico_id: num(d.mecanico_id) },
        })
    );

  $("#add-tempo").onclick = () =>
    modal(
      "Tempo manual",
      [
        { nome: "descricao", rotulo: "Tarefa" },
        { nome: "minutos", rotulo: "Minutos", tipo: "number", passo: "1", valor: 60 },
        { nome: "mecanico_id", rotulo: "Mecânico", tipo: "select", opcoes: opcoesMec },
      ],
      (d) =>
        api(`/ordens/${o.id}/tempos`, {
          method: "POST",
          body: { descricao: d.descricao, minutos: num(d.minutos, 0), mecanico_id: num(d.mecanico_id) },
        })
    );

  $("#add-peca").onclick = async () => {
    const pecas = await api("/pecas");
    modal(
      "Adicionar peça",
      [
        {
          nome: "peca_id",
          rotulo: "Do stock",
          tipo: "select",
          opcoes: [{ valor: "", texto: "— peça avulsa —" }].concat(
            pecas.map((p) => ({ valor: p.id, texto: `${p.referencia} · ${p.descricao} (${p.preco_unitario} €)` }))
          ),
        },
        { nome: "descricao", rotulo: "Descrição (se avulsa)" },
        { nome: "quantidade", rotulo: "Quantidade", tipo: "number", passo: "0.01", valor: 1 },
        { nome: "preco_unitario", rotulo: "Preço unitário (€, vazio = preço do stock)", tipo: "number", passo: "0.01" },
      ],
      (d) =>
        api(`/ordens/${o.id}/pecas`, {
          method: "POST",
          body: {
            peca_id: num(d.peca_id),
            descricao: d.descricao,
            quantidade: num(d.quantidade, 1),
            preco_unitario: num(d.preco_unitario),
          },
        })
    );
  };

  conteudo.querySelectorAll("[data-parar]").forEach((b) => {
    b.onclick = async () => {
      await api(`/ordens/${o.id}/tempos/${b.dataset.parar}/parar`, { method: "POST" });
      render();
    };
  });
  conteudo.querySelectorAll("[data-apagar-tempo]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Apagar este registo de tempo?")) return;
      await api(`/ordens/${o.id}/tempos/${b.dataset.apagarTempo}`, { method: "DELETE" });
      render();
    };
  });
  conteudo.querySelectorAll("[data-apagar-peca]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Remover esta peça?")) return;
      await api(`/ordens/${o.id}/pecas/${b.dataset.apagarPeca}`, { method: "DELETE" });
      render();
    };
  });
}

// ------------------------------------------------------------------ ficha do veículo
async function vistaVeiculo(id) {
  const v = await api(`/veiculos/${id}`);
  const r = v.resumo;
  titulo.textContent = `Ficha ${v.matricula}`;
  conteudo.innerHTML = `
    <div class="card">
      <h3>${esc(v.matricula)}</h3>
      <p>${esc(v.marca || "")} ${esc(v.modelo || "")} ${v.ano || ""} ${v.vin ? "· VIN " + esc(v.vin) : ""}</p>
      <p>Dono: ${esc(v.cliente?.nome || "—")} ${v.cliente?.telefone ? "· " + esc(v.cliente.telefone) : ""}</p>
      <p>${v.km_atuais} km atuais</p>
      <div class="acoes">
        <button class="sec" id="ficha-km">Atualizar km</button>
        <button id="ficha-obra">Nova obra</button>
      </div>
    </div>

    <div class="card totais">
      <div><span>Visitas à oficina</span><span>${r.visitas}</span></div>
      <div><span>Última visita</span><span>${dataHora(r.ultima_visita)}</span></div>
      <div><span>Horas de mão de obra</span><span>${r.total_horas} h</span></div>
      <div class="grande"><span>Já faturado</span><span>${eur(r.total_gasto)}</span></div>
    </div>

    <h3 style="margin:18px 4px 8px">Histórico</h3>
    <div class="lista">
      ${
        v.historico.length
          ? v.historico
              .map(
                (o) => `<div class="card" data-obra-id="${o.id}">
                  <h3>#${o.id} · ${dataHora(o.aberta_em).split(",")[0]}
                    <span class="badge ${o.estado}">${o.estado.replace("_", " ")}</span></h3>
                  <p>${o.km_entrada ? o.km_entrada + " km" : "km não registados"} · ${o.totais.horas} h · <strong>${eur(o.totais.total)}</strong></p>
                  <p><strong>Avaria:</strong> ${esc(o.descricao_avaria || "—")}</p>
                  <p><strong>Trabalho:</strong> ${esc(o.trabalho_realizado || "—")}</p>
                  ${
                    o.pecas.length
                      ? `<p><strong>Peças:</strong> ${o.pecas
                          .map((p) => `${p.quantidade}× ${esc(p.descricao)}`)
                          .join(", ")}</p>`
                      : ""
                  }
                </div>`
              )
              .join("")
          : '<p class="vazio">Primeira vez na oficina — sem histórico.</p>'
      }
    </div>`;

  conteudo.querySelectorAll("[data-obra-id]").forEach((c) => {
    c.onclick = () => {
      estado.veiculoId = null;
      estado.ordemId = Number(c.dataset.obraId);
      render();
    };
  });
  $("#ficha-km").onclick = () =>
    modal("Atualizar km", [{ nome: "km_atuais", rotulo: "Km atuais", tipo: "number", valor: v.km_atuais }], (d) =>
      api(`/veiculos/${v.id}`, { method: "PATCH", body: { km_atuais: num(d.km_atuais) } })
    );
  $("#ficha-obra").onclick = () =>
    modal(
      "Nova obra",
      [
        { nome: "km_entrada", rotulo: "Km atuais", tipo: "number", valor: v.km_atuais },
        { nome: "descricao_avaria", rotulo: "O que veio arranjar", tipo: "textarea" },
        { nome: "taxa_hora", rotulo: "€/hora", tipo: "number", passo: "0.5", valor: 35 },
      ],
      async (d) => {
        const nova = await api("/ordens", {
          method: "POST",
          body: {
            veiculo_id: v.id,
            km_entrada: num(d.km_entrada),
            descricao_avaria: d.descricao_avaria,
            taxa_hora: num(d.taxa_hora, 35),
          },
        });
        estado.veiculoId = null;
        estado.ordemId = nova.id;
      }
    );
}

// ------------------------------------------------------------------ veículos
async function vistaVeiculos() {
  conteudo.innerHTML = $("#tpl-veiculos").innerHTML;
  const lista = $("#lista-veiculos");
  const carregar = async () => {
    const q = $("#pesquisa-veiculos").value;
    const veiculos = await api(`/veiculos?${new URLSearchParams(q ? { q } : {})}`);
    lista.innerHTML = veiculos.length
      ? veiculos
          .map(
            (v) => `<div class="card" data-id="${v.id}">
              <h3>${esc(v.matricula)}</h3>
              <p>${esc(v.marca || "")} ${esc(v.modelo || "")} ${v.ano || ""}</p>
              <p>${v.km_atuais} km · ${esc(v.cliente?.nome || "sem dono associado")}</p>
              <div class="acoes"><button class="sec" data-km="${v.id}">Atualizar km</button>
                <button class="sec" data-ficha="${v.id}">Histórico</button>
                <button data-obra="${v.id}">Nova obra</button></div>
            </div>`
          )
          .join("")
      : '<p class="vazio">Sem veículos.</p>';

    lista.querySelectorAll("[data-ficha]").forEach((b) => {
      b.onclick = () => {
        estado.veiculoId = Number(b.dataset.ficha);
        render();
      };
    });
    lista.querySelectorAll("[data-km]").forEach((b) => {
      b.onclick = () =>
        modal("Atualizar km", [{ nome: "km_atuais", rotulo: "Km atuais", tipo: "number" }], (d) =>
          api(`/veiculos/${b.dataset.km}`, { method: "PATCH", body: { km_atuais: num(d.km_atuais) } })
        );
    });
    lista.querySelectorAll("[data-obra]").forEach((b) => {
      b.onclick = () =>
        modal(
          "Nova obra",
          [
            { nome: "km_entrada", rotulo: "Km atuais", tipo: "number" },
            { nome: "descricao_avaria", rotulo: "O que veio arranjar", tipo: "textarea" },
            { nome: "taxa_hora", rotulo: "€/hora", tipo: "number", passo: "0.5", valor: 35 },
          ],
          async (d) => {
            const nova = await api("/ordens", {
              method: "POST",
              body: {
                veiculo_id: Number(b.dataset.obra),
                km_entrada: num(d.km_entrada),
                descricao_avaria: d.descricao_avaria,
                taxa_hora: num(d.taxa_hora, 35),
              },
            });
            estado.vista = "ordens";
            estado.ordemId = nova.id;
          }
        );
    });
  };
  $("#pesquisa-veiculos").oninput = carregar;
  $("#novo-veiculo").onclick = async () => {
    const clientes = await api("/clientes");
    modal(
      "Novo veículo",
      [
        { nome: "matricula", rotulo: "Matrícula", placeholder: "AA-00-BB" },
        { nome: "marca", rotulo: "Marca" },
        { nome: "modelo", rotulo: "Modelo" },
        { nome: "ano", rotulo: "Ano", tipo: "number" },
        { nome: "km_atuais", rotulo: "Km atuais", tipo: "number", valor: 0 },
        {
          nome: "cliente_id",
          rotulo: "Dono",
          tipo: "select",
          opcoes: [{ valor: "", texto: "— sem dono —" }].concat(
            clientes.map((c) => ({ valor: c.id, texto: c.nome }))
          ),
        },
        { nome: "novo_cliente", rotulo: "Ou criar novo dono (nome)" },
        { nome: "novo_cliente_tel", rotulo: "Telefone do novo dono" },
      ],
      async (d) => {
        let clienteId = num(d.cliente_id);
        if (d.novo_cliente) {
          const c = await api("/clientes", {
            method: "POST",
            body: { nome: d.novo_cliente, telefone: txt(d.novo_cliente_tel) },
          });
          clienteId = c.id;
        }
        await api("/veiculos", {
          method: "POST",
          body: {
            matricula: d.matricula,
            marca: txt(d.marca),
            modelo: txt(d.modelo),
            ano: num(d.ano),
            km_atuais: num(d.km_atuais, 0),
            cliente_id: clienteId,
          },
        });
      }
    );
  };
  await carregar();
}

// ------------------------------------------------------------------ peças
async function vistaPecas() {
  conteudo.innerHTML = $("#tpl-pecas").innerHTML;
  const lista = $("#lista-pecas");
  const carregar = async () => {
    const q = $("#pesquisa-pecas").value;
    const pecas = await api(`/pecas?${new URLSearchParams(q ? { q } : {})}`);
    lista.innerHTML = pecas.length
      ? pecas
          .map(
            (p) => `<div class="card">
              <h3>${esc(p.descricao)} <span>${eur(p.preco_unitario)}</span></h3>
              <p>Ref. ${esc(p.referencia)} · stock ${p.stock}</p>
            </div>`
          )
          .join("")
      : '<p class="vazio">Sem peças em catálogo.</p>';
  };
  $("#pesquisa-pecas").oninput = carregar;
  $("#nova-peca").onclick = () =>
    modal(
      "Nova peça",
      [
        { nome: "referencia", rotulo: "Referência" },
        { nome: "descricao", rotulo: "Descrição" },
        { nome: "preco_unitario", rotulo: "Preço unitário (€)", tipo: "number", passo: "0.01" },
        { nome: "stock", rotulo: "Stock", tipo: "number", passo: "0.01", valor: 0 },
      ],
      (d) =>
        api("/pecas", {
          method: "POST",
          body: {
            referencia: d.referencia,
            descricao: d.descricao,
            preco_unitario: num(d.preco_unitario, 0),
            stock: num(d.stock, 0),
          },
        })
    );
  await carregar();
}

// ------------------------------------------------------------------ resumo
async function vistaResumo() {
  const r = await api("/resumo");
  const estados = Object.entries(r.por_estado)
    .map(([e, n]) => `<div class="linha"><span>${e.replace("_", " ")}</span><span>${n}</span></div>`)
    .join("");
  conteudo.innerHTML = `
    <div class="card totais">
      <div><span>Obras</span><span>${r.ordens}</span></div>
      <div><span>Veículos</span><span>${r.veiculos}</span></div>
      <div><span>Clientes</span><span>${r.clientes}</span></div>
      <div class="grande"><span>Faturação fechada</span><span>${eur(r.faturacao_fechada)}</span></div>
    </div>
    <div class="card"><h3>Por estado</h3><div class="linhas">${estados || '<p class="vazio">—</p>'}</div></div>`;
}

// ------------------------------------------------------------------ router
function lerHash() {
  const [, tipo, id] = (location.hash || "").split("/");
  if (tipo === "obra") return { vista: "ordens", ordemId: Number(id), veiculoId: null };
  if (tipo === "veiculo") return { vista: "veiculos", ordemId: null, veiculoId: Number(id) };
  return { vista: tipo || "ordens", ordemId: null, veiculoId: null };
}

function escreverHash() {
  const novo = estado.ordemId
    ? `#/obra/${estado.ordemId}`
    : estado.veiculoId
    ? `#/veiculo/${estado.veiculoId}`
    : `#/${estado.vista}`;
  if (location.hash !== novo) history.replaceState(null, "", novo);
}

async function render() {
  try {
    escreverHash();
    document.querySelectorAll(".tabbar button").forEach((b) =>
      b.classList.toggle("ativo", b.dataset.vista === estado.vista)
    );
    btnVoltar.classList.toggle("hidden", !estado.ordemId && !estado.veiculoId);
    if (estado.ordemId) return await vistaOrdem(estado.ordemId);
    if (estado.veiculoId) return await vistaVeiculo(estado.veiculoId);
    titulo.textContent = { ordens: "Obras", veiculos: "Veículos", pecas: "Peças", resumo: "Resumo" }[estado.vista];
    if (estado.vista === "ordens") return await vistaOrdens();
    if (estado.vista === "veiculos") return await vistaVeiculos();
    if (estado.vista === "pecas") return await vistaPecas();
    return await vistaResumo();
  } catch (e) {
    conteudo.innerHTML = `<p class="vazio">${esc(e.message)}</p>`;
  }
}

document.querySelectorAll(".tabbar button").forEach((b) => {
  b.onclick = () => {
    estado.vista = b.dataset.vista;
    estado.ordemId = null;
    estado.veiculoId = null;
    render();
  };
});
btnVoltar.onclick = () => {
  estado.ordemId = null;
  estado.veiculoId = null;
  render();
};
$("#btn-atualizar").onclick = render;

Object.assign(estado, lerHash());
render();
