const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const conteudo = $("#conteudo");
const elTitulo = $("#titulo");
const elSubtitulo = $("#subtitulo");
const btnVoltar = $("#btn-voltar");

const estado = { vista: "inicio", ordemId: null, veiculoId: null };
let cronometros = null;

const TITULOS = {
  inicio: ["Início", "Resumo da oficina"],
  ordens: ["Obras", "Serviços em curso e concluídos"],
  veiculos: ["Viaturas", "Ficha e histórico de cada carro"],
  pecas: ["Peças", "Catálogo e stock"],
  clientes: ["Clientes", "Donos das viaturas"],
  entrada: ["Entrada de viatura", "Receção em poucos segundos"],
};

const nf = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v) => `${nf.format(v ?? 0)} €`;
const km = (v) => `${new Intl.NumberFormat("pt-PT").format(v ?? 0)} km`;
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const asData = (iso) => (iso ? new Date(iso.endsWith("Z") ? iso : iso + "Z") : null);
const dataHora = (iso) =>
  asData(iso)?.toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) ?? "—";
const dataCurta = (iso) => asData(iso)?.toLocaleDateString("pt-PT") ?? "—";
const horas = (h) => `${nf.format(h ?? 0)} h`;
const duracao = (minutos) => {
  const m = Math.max(0, Math.round(minutos));
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
};

function toast(msg, tipo = "") {
  const el = document.createElement("div");
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(caminho, opcoes = {}) {
  const resp = await fetch(`/api${caminho}`, {
    headers: { "Content-Type": "application/json" },
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(typeof erro.detail === "string" ? erro.detail : `Erro ${resp.status}`);
  }
  return resp.status === 204 ? null : resp.json();
}

const num = (v, def = null) => (v === "" || v === undefined || v === null ? def : Number(v));
const txt = (v) => (v && String(v).trim() ? String(v).trim() : null);

// ------------------------------------------------------------------ modal
function modal(titulo, campos, aoGuardar, opcoes = {}) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `
    <h2>${esc(titulo)}</h2>
    ${opcoes.nota ? `<p class="ajuda">${esc(opcoes.nota)}</p>` : ""}
    <form id="form-modal">
      ${campos
        .map((c) => {
          const rot = `<label>${esc(c.rotulo)}${c.obrigatorio ? ' <span class="obrig">*</span>' : ""}</label>`;
          if (c.tipo === "select") {
            return `${rot}<select name="${c.nome}">${c.opcoes
              .map(
                (o) =>
                  `<option value="${esc(o.valor)}" ${o.valor == c.valor ? "selected" : ""}>${esc(o.texto)}</option>`
              )
              .join("")}</select>`;
          }
          if (c.tipo === "textarea") {
            return `${rot}<textarea name="${c.nome}" rows="3" placeholder="${esc(c.placeholder ?? "")}">${esc(c.valor ?? "")}</textarea>`;
          }
          return `${rot}<input name="${c.nome}" type="${c.tipo || "text"}" ${c.passo ? `step="${c.passo}"` : ""} ${
            c.tipo === "number" ? 'inputmode="decimal"' : ""
          } value="${esc(c.valor ?? "")}" placeholder="${esc(c.placeholder ?? "")}" />`;
        })
        .join("")}
      <div class="acoes direita">
        <button type="button" class="sec" data-cancelar>Cancelar</button>
        <button type="submit">${esc(opcoes.confirmar ?? "Guardar")}</button>
      </div>
    </form>`;
  document.body.append(dlg);
  $("[data-cancelar]", dlg).onclick = () => dlg.close();
  $("#form-modal", dlg).onsubmit = async (ev) => {
    ev.preventDefault();
    const submit = $('button[type="submit"]', dlg);
    submit.disabled = true;
    try {
      await aoGuardar(Object.fromEntries(new FormData(ev.target).entries()));
      dlg.close();
      render();
    } catch (e) {
      toast(e.message, "erro");
      submit.disabled = false;
    }
  };
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
}

const vazio = (emoji, texto, acao = "") =>
  `<div class="vazio"><span class="emoji">${emoji}</span>${esc(texto)}${acao}</div>`;

const NOMES_ESTADO = {
  aberta: "aberta",
  em_curso: "em curso",
  concluida: "concluída",
  faturada: "faturada",
};

const etiqueta = (estadoOS) =>
  `<span class="etiqueta ${estadoOS}">${NOMES_ESTADO[estadoOS] || estadoOS}</span>`;

const cartaoObra = (o) => `
  <article class="cartao item" data-obra="${o.id}">
    <h3><span>${esc(o.veiculo?.matricula)} <small style="color:var(--suave);font-weight:600">#${o.id}</small></span>${etiqueta(o.estado)}</h3>
    <p>${esc([o.veiculo?.marca, o.veiculo?.modelo].filter(Boolean).join(" ") || "viatura")} · ${esc(o.veiculo?.cliente?.nome || "sem dono")}</p>
    <p><strong>${esc(o.descricao_avaria || "sem descrição")}</strong></p>
    <p>${horas(o.totais.horas)} de mão de obra · peças ${eur(o.totais.total_pecas)} · <strong>${eur(o.totais.total)}</strong>
      ${o.cronometro_ativo ? '<span class="cron-ativo">● a decorrer</span>' : ""}</p>
  </article>`;

function ligarCartoes(raiz = conteudo) {
  $$("[data-obra]", raiz).forEach((c) => {
    c.onclick = () => irPara({ ordemId: Number(c.dataset.obra) });
  });
  $$("[data-veiculo]", raiz).forEach((c) => {
    c.onclick = (ev) => {
      ev.stopPropagation();
      irPara({ veiculoId: Number(c.dataset.veiculo) });
    };
  });
}

// ------------------------------------------------------------------ início
async function vistaInicio() {
  const [r, ordens] = await Promise.all([api("/resumo"), api("/ordens")]);
  const abertas = ordens.filter((o) => o.estado === "aberta" || o.estado === "em_curso");
  const aDecorrer = ordens.filter((o) => o.cronometro_ativo);
  conteudo.innerHTML = `
    <div class="kpis">
      <div class="kpi"><small>Obras abertas</small><strong>${abertas.length}</strong></div>
      <div class="kpi"><small>Cronómetros a contar</small><strong>${aDecorrer.length}</strong></div>
      <div class="kpi"><small>Viaturas</small><strong>${r.veiculos}</strong></div>
      <div class="kpi destaque"><small>Faturado (obras fechadas)</small><strong>${eur(r.faturacao_fechada)}</strong></div>
    </div>
    <div class="acoes"><button class="primario grande" data-acao="entrada">+ Entrada de viatura</button></div>
    <h2 class="seccao">Em oficina agora</h2>
    <div class="lista">
      ${abertas.length ? abertas.map(cartaoObra).join("") : vazio("🅿️", "Nenhuma viatura em serviço.")}
    </div>`;
  ligarCartoes();
}

// ------------------------------------------------------------------ entrada rápida
async function vistaEntrada() {
  conteudo.innerHTML = `
    <form class="cartao" id="form-entrada" autocomplete="off">
      <label>Matrícula <span class="obrig">*</span></label>
      <input class="matricula" name="matricula" placeholder="AA-00-BB" required />
      <p class="ajuda" id="estado-matricula">Escreva a matrícula — se o carro já cá esteve, os dados aparecem sozinhos.</p>

      <div id="bloco-novo" class="hidden">
        <label>Marca</label><input name="marca" placeholder="Renault" />
        <label>Modelo</label><input name="modelo" placeholder="Clio 1.5 dCi" />
        <label>Nome do dono</label><input name="cliente_nome" placeholder="Nome do cliente" />
        <label>Telefone</label><input name="cliente_telefone" type="tel" inputmode="tel" placeholder="912 345 678" />
      </div>

      <label>Quilómetros atuais</label>
      <input name="km" type="number" inputmode="numeric" placeholder="ex. 184320" />

      <label>O que veio arranjar <span class="obrig">*</span></label>
      <textarea name="descricao_avaria" rows="3" placeholder="Descrição do cliente" required></textarea>
      <div class="chips">
        ${["Revisão", "Mudança de óleo", "Travões", "Distribuição", "Pneus", "Diagnóstico avaria", "Inspeção", "Ar condicionado"]
          .map((s) => `<button type="button" class="chip" data-sugestao="${esc(s)}">${esc(s)}</button>`)
          .join("")}
      </div>

      <label>Preço da mão de obra (€/hora)</label>
      <input name="taxa_hora" type="number" step="0.5" inputmode="decimal" value="35" />

      <div class="acoes"><button class="primario grande" type="submit">Abrir obra</button></div>
    </form>`;

  const form = $("#form-entrada");
  const campoMatricula = form.matricula;
  const info = $("#estado-matricula");
  const blocoNovo = $("#bloco-novo");

  $$(".chip", form).forEach((c) => {
    c.onclick = () => {
      const t = form.descricao_avaria;
      t.value = t.value ? `${t.value}; ${c.dataset.sugestao}` : c.dataset.sugestao;
    };
  });

  let procura;
  campoMatricula.oninput = () => {
    campoMatricula.value = campoMatricula.value.toUpperCase();
    clearTimeout(procura);
    const valor = campoMatricula.value.trim();
    if (valor.length < 4) {
      blocoNovo.classList.add("hidden");
      info.textContent = "Escreva a matrícula — se o carro já cá esteve, os dados aparecem sozinhos.";
      return;
    }
    procura = setTimeout(async () => {
      const r = await api(`/veiculos/por-matricula/${encodeURIComponent(valor)}`);
      if (r.encontrado) {
        blocoNovo.classList.add("hidden");
        const v = r.veiculo;
        info.innerHTML = `✅ <strong>${esc([v.marca, v.modelo].filter(Boolean).join(" ") || "viatura conhecida")}</strong>
          · dono ${esc(v.cliente?.nome || "—")} · ${r.visitas} visita(s), última em ${dataCurta(r.ultima_visita)}
          — <a href="#/veiculo/${v.id}">ver histórico</a>`;
        if (!form.km.value) form.km.placeholder = `último registo: ${v.km_atuais}`;
      } else {
        blocoNovo.classList.remove("hidden");
        info.textContent = "Viatura nova — preencha os dados abaixo (opcional).";
      }
    }, 350);
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    if (!txt(d.matricula) || !txt(d.descricao_avaria)) {
      return toast("Matrícula e descrição são obrigatórias.", "erro");
    }
    $('button[type="submit"]', form).disabled = true;
    try {
      const nova = await api("/entrada", {
        method: "POST",
        body: {
          matricula: d.matricula,
          km: num(d.km),
          descricao_avaria: d.descricao_avaria,
          marca: txt(d.marca),
          modelo: txt(d.modelo),
          cliente_nome: txt(d.cliente_nome),
          cliente_telefone: txt(d.cliente_telefone),
          taxa_hora: num(d.taxa_hora, 35),
        },
      });
      toast(`Obra #${nova.id} aberta para ${nova.veiculo.matricula}`);
      irPara({ ordemId: nova.id });
    } catch (e) {
      toast(e.message, "erro");
      $('button[type="submit"]', form).disabled = false;
    }
  };
  campoMatricula.focus();
}

// ------------------------------------------------------------------ obras
async function vistaOrdens() {
  conteudo.innerHTML = `
    <div class="barra">
      <input id="pesquisa-ordens" type="search" placeholder="Pesquisar matrícula…" />
      <select id="filtro-estado">
        <option value="">Todos os estados</option>
        <option value="aberta">Aberta</option>
        <option value="em_curso">Em curso</option>
        <option value="concluida">Concluída</option>
        <option value="faturada">Faturada</option>
      </select>
    </div>
    <div id="lista-ordens" class="lista"></div>`;
  const lista = $("#lista-ordens");
  const carregar = async () => {
    const params = new URLSearchParams();
    if ($("#pesquisa-ordens").value) params.set("q", $("#pesquisa-ordens").value);
    if ($("#filtro-estado").value) params.set("estado", $("#filtro-estado").value);
    const ordens = await api(`/ordens?${params}`);
    lista.innerHTML = ordens.length
      ? ordens.map(cartaoObra).join("")
      : vazio("🔧", "Sem obras para este filtro.", '<div class="acoes" style="justify-content:center"><button data-acao="entrada">Registar entrada</button></div>');
    ligarCartoes(lista);
    ligarAcoes(lista);
  };
  $("#pesquisa-ordens").oninput = carregar;
  $("#filtro-estado").onchange = carregar;
  await carregar();
}

// ------------------------------------------------------------------ detalhe da obra
async function vistaOrdem(id) {
  const o = await api(`/ordens/${id}`);
  const t = o.totais;
  elTitulo.textContent = `${o.veiculo?.matricula ?? ""} · obra #${o.id}`;
  elSubtitulo.textContent = [o.veiculo?.marca, o.veiculo?.modelo].filter(Boolean).join(" ");

  conteudo.innerHTML = `
    <article class="cartao">
      <h3><span>${esc(o.veiculo?.matricula)}</span>${etiqueta(o.estado)}</h3>
      <p>${esc([o.veiculo?.marca, o.veiculo?.modelo, o.veiculo?.ano].filter(Boolean).join(" "))}</p>
      <p>Dono: <strong>${esc(o.veiculo?.cliente?.nome || "—")}</strong>${
        o.veiculo?.cliente?.telefone
          ? ` · <a href="tel:${esc(o.veiculo.cliente.telefone)}">${esc(o.veiculo.cliente.telefone)}</a>`
          : ""
      }</p>
      <p>${km(o.km_entrada ?? o.veiculo?.km_atuais)} · entrada em ${dataHora(o.aberta_em)}</p>
      <p><strong>Avaria:</strong> ${esc(o.descricao_avaria || "—")}</p>
      <p><strong>Trabalho realizado:</strong> ${esc(o.trabalho_realizado || "—")}</p>
      <div class="acoes">
        <button class="sec" id="editar-ordem">Editar</button>
        <button class="sec" data-veiculo="${o.veiculo_id}">Histórico da viatura</button>
      </div>
    </article>

    <h2 class="seccao">Mão de obra · ${horas(t.horas)}</h2>
    <article class="cartao">
      <div class="linhas">
        ${
          o.tempos.length
            ? o.tempos
                .map(
                  (r) => `<div class="linha">
                    <span>${esc(r.descricao || "trabalho")}${r.mecanico ? ` · ${esc(r.mecanico)}` : ""}<br>
                      <small>${dataHora(r.inicio)}</small></span>
                    <span>${
                      r.a_decorrer
                        ? `<span class="cron-ativo" data-desde="${r.inicio}">…</span>
                           <button class="sec" data-parar="${r.id}">Parar</button>`
                        : duracao(r.minutos)
                    }
                    <button class="perigo" data-apagar-tempo="${r.id}" title="Apagar">✕</button></span>
                  </div>`
                )
                .join("")
            : '<p class="ajuda">Ainda não há tempo registado nesta obra.</p>'
        }
      </div>
      <div class="acoes">
        <button id="iniciar-cron">▶ Iniciar cronómetro</button>
        <button class="sec" id="add-tempo">Registar tempo manual</button>
      </div>
    </article>

    <h2 class="seccao">Peças · ${eur(t.total_pecas)}</h2>
    <article class="cartao">
      <div class="linhas">
        ${
          o.pecas.length
            ? o.pecas
                .map(
                  (p) => `<div class="linha">
                    <span>${esc(p.descricao)}${p.referencia ? ` · <small>${esc(p.referencia)}</small>` : ""}<br>
                      <small>${p.quantidade} × ${eur(p.preco_unitario)}</small></span>
                    <span><strong>${eur(p.total)}</strong>
                      <button class="perigo" data-apagar-peca="${p.id}" title="Remover">✕</button></span>
                  </div>`
                )
                .join("")
            : '<p class="ajuda">Ainda não foram aplicadas peças.</p>'
        }
      </div>
      <div class="acoes"><button id="add-peca">+ Adicionar peça</button></div>
    </article>

    <h2 class="seccao">Conta</h2>
    <article class="cartao totais">
      <div><span>Mão de obra (${horas(t.horas)} × ${eur(o.taxa_hora)})</span><strong>${eur(t.total_mao_obra)}</strong></div>
      <div><span>Peças</span><strong>${eur(t.total_pecas)}</strong></div>
      <div><span>Desconto</span><strong>−${eur(t.desconto)}</strong></div>
      <div><span>Subtotal</span><strong>${eur(t.subtotal)}</strong></div>
      <div><span>IVA ${nf.format(o.iva)} %</span><strong>${eur(t.valor_iva)}</strong></div>
      <div class="total"><span>Total</span><span>${eur(t.total)}</span></div>
      <div class="acoes">
        <button class="sec" id="imprimir">Imprimir / PDF</button>
        <button id="mudar-estado">Mudar estado</button>
      </div>
    </article>`;

  ligarCartoes();
  iniciarRelogios();

  $("#imprimir").onclick = () => window.print();

  $("#editar-ordem").onclick = () =>
    modal(
      "Editar obra",
      [
        { nome: "descricao_avaria", rotulo: "Avaria", tipo: "textarea", valor: o.descricao_avaria },
        { nome: "trabalho_realizado", rotulo: "Trabalho realizado", tipo: "textarea", valor: o.trabalho_realizado },
        { nome: "km_entrada", rotulo: "Quilómetros", tipo: "number", valor: o.km_entrada ?? "" },
        { nome: "taxa_hora", rotulo: "Preço mão de obra (€/hora)", tipo: "number", passo: "0.5", valor: o.taxa_hora },
        { nome: "desconto", rotulo: "Desconto (€)", tipo: "number", passo: "0.01", valor: o.desconto },
        { nome: "iva", rotulo: "IVA (%)", tipo: "number", passo: "0.1", valor: o.iva },
      ],
      async (d) => {
        await api(`/ordens/${o.id}`, {
          method: "PATCH",
          body: {
            descricao_avaria: d.descricao_avaria,
            trabalho_realizado: d.trabalho_realizado,
            km_entrada: num(d.km_entrada),
            taxa_hora: num(d.taxa_hora),
            desconto: num(d.desconto),
            iva: num(d.iva),
          },
        });
        toast("Obra atualizada");
      }
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
      async (d) => {
        await api(`/ordens/${o.id}`, { method: "PATCH", body: { estado: d.estado } });
        toast("Estado atualizado");
      }
    );

  const mecanicos = await api("/mecanicos");
  const opcoesMec = [{ valor: "", texto: "— sem mecânico —" }].concat(
    mecanicos.map((m) => ({ valor: m.id, texto: m.nome }))
  );

  $("#iniciar-cron").onclick = () =>
    modal(
      "Iniciar cronómetro",
      [
        { nome: "descricao", rotulo: "Tarefa", placeholder: "ex. substituir pastilhas" },
        { nome: "mecanico_id", rotulo: "Mecânico", tipo: "select", opcoes: opcoesMec },
      ],
      async (d) => {
        await api(`/ordens/${o.id}/tempos`, {
          method: "POST",
          body: { descricao: d.descricao, mecanico_id: num(d.mecanico_id) },
        });
        toast("Cronómetro a contar");
      },
      { confirmar: "Iniciar" }
    );

  $("#add-tempo").onclick = () =>
    modal(
      "Registar tempo",
      [
        { nome: "descricao", rotulo: "Tarefa" },
        { nome: "minutos", rotulo: "Minutos", tipo: "number", passo: "5", valor: 60, obrigatorio: true },
        { nome: "mecanico_id", rotulo: "Mecânico", tipo: "select", opcoes: opcoesMec },
      ],
      async (d) => {
        await api(`/ordens/${o.id}/tempos`, {
          method: "POST",
          body: { descricao: d.descricao, minutos: num(d.minutos, 0), mecanico_id: num(d.mecanico_id) },
        });
        toast("Tempo registado");
      }
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
            pecas.map((p) => ({
              valor: p.id,
              texto: `${p.referencia} · ${p.descricao} (${nf.format(p.preco_unitario)} €, stock ${p.stock})`,
            }))
          ),
        },
        { nome: "descricao", rotulo: "Descrição (se avulsa)" },
        { nome: "quantidade", rotulo: "Quantidade", tipo: "number", passo: "0.01", valor: 1 },
        { nome: "preco_unitario", rotulo: "Preço unitário (€)", tipo: "number", passo: "0.01", placeholder: "vazio = preço do catálogo" },
      ],
      async (d) => {
        await api(`/ordens/${o.id}/pecas`, {
          method: "POST",
          body: {
            peca_id: num(d.peca_id),
            descricao: d.descricao,
            quantidade: num(d.quantidade, 1),
            preco_unitario: num(d.preco_unitario),
          },
        });
        toast("Peça adicionada");
      },
      { nota: "As peças do catálogo abatem automaticamente ao stock." }
    );
  };

  $$("[data-parar]").forEach((b) => {
    b.onclick = async () => {
      await api(`/ordens/${o.id}/tempos/${b.dataset.parar}/parar`, { method: "POST" });
      toast("Cronómetro parado");
      render();
    };
  });
  $$("[data-apagar-tempo]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Apagar este registo de tempo?")) return;
      await api(`/ordens/${o.id}/tempos/${b.dataset.apagarTempo}`, { method: "DELETE" });
      render();
    };
  });
  $$("[data-apagar-peca]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Remover esta peça da obra?")) return;
      await api(`/ordens/${o.id}/pecas/${b.dataset.apagarPeca}`, { method: "DELETE" });
      render();
    };
  });
}

function iniciarRelogios() {
  clearInterval(cronometros);
  const marcas = $$("[data-desde]");
  if (!marcas.length) return;
  const tick = () => {
    marcas.forEach((el) => {
      const inicio = asData(el.dataset.desde);
      const seg = Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 1000));
      const h = String(Math.floor(seg / 3600)).padStart(2, "0");
      const m = String(Math.floor((seg % 3600) / 60)).padStart(2, "0");
      const s = String(seg % 60).padStart(2, "0");
      el.textContent = `● ${h}:${m}:${s}`;
    });
  };
  tick();
  cronometros = setInterval(tick, 1000);
}

// ------------------------------------------------------------------ ficha da viatura
async function vistaVeiculo(id) {
  const v = await api(`/veiculos/${id}`);
  const r = v.resumo;
  elTitulo.textContent = v.matricula;
  elSubtitulo.textContent = [v.marca, v.modelo].filter(Boolean).join(" ") || "Ficha da viatura";

  conteudo.innerHTML = `
    <article class="cartao">
      <h3><span>${esc(v.matricula)}</span><span class="ajuda">${km(v.km_atuais)}</span></h3>
      <p>${esc([v.marca, v.modelo, v.ano].filter(Boolean).join(" ") || "—")}${v.vin ? ` · VIN ${esc(v.vin)}` : ""}</p>
      <p>Dono: <strong>${esc(v.cliente?.nome || "—")}</strong>${
        v.cliente?.telefone ? ` · <a href="tel:${esc(v.cliente.telefone)}">${esc(v.cliente.telefone)}</a>` : ""
      }</p>
      <div class="acoes">
        <button class="primario" id="ficha-obra">+ Nova obra</button>
        <button class="sec" id="ficha-km">Atualizar km</button>
      </div>
    </article>

    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><small>Visitas</small><strong>${r.visitas}</strong></div>
      <div class="kpi"><small>Horas de trabalho</small><strong>${horas(r.total_horas)}</strong></div>
      <div class="kpi"><small>Última visita</small><strong style="font-size:17px">${dataCurta(r.ultima_visita)}</strong></div>
      <div class="kpi destaque"><small>Já faturado</small><strong>${eur(r.total_gasto)}</strong></div>
    </div>

    <h2 class="seccao">Histórico na oficina</h2>
    <div class="lista">
      ${
        r.visitas
          ? v.historico
              .map(
                (o) => `<article class="cartao item" data-obra="${o.id}">
                  <h3><span>${dataCurta(o.aberta_em)} · <small style="color:var(--suave)">#${o.id}</small></span>${etiqueta(o.estado)}</h3>
                  <p>${o.km_entrada ? km(o.km_entrada) : "km não registados"} · ${horas(o.totais.horas)} · <strong>${eur(o.totais.total)}</strong></p>
                  <p><strong>Avaria:</strong> ${esc(o.descricao_avaria || "—")}</p>
                  <p><strong>Trabalho:</strong> ${esc(o.trabalho_realizado || "—")}</p>
                  ${
                    o.pecas.length
                      ? `<p><strong>Peças:</strong> ${o.pecas.map((p) => `${p.quantidade}× ${esc(p.descricao)}`).join(", ")}</p>`
                      : ""
                  }
                </article>`
              )
              .join("")
          : vazio("🕐", "Primeira vez na oficina — ainda sem histórico.")
      }
    </div>`;

  ligarCartoes();
  $("#ficha-km").onclick = () =>
    modal(
      "Atualizar quilómetros",
      [{ nome: "km_atuais", rotulo: "Km atuais", tipo: "number", valor: v.km_atuais }],
      async (d) => {
        await api(`/veiculos/${v.id}`, { method: "PATCH", body: { km_atuais: num(d.km_atuais) } });
        toast("Quilómetros atualizados");
      }
    );
  $("#ficha-obra").onclick = () =>
    modal(
      "Nova obra",
      [
        { nome: "km_entrada", rotulo: "Km atuais", tipo: "number", valor: v.km_atuais },
        { nome: "descricao_avaria", rotulo: "O que veio arranjar", tipo: "textarea", obrigatorio: true },
        { nome: "taxa_hora", rotulo: "Preço mão de obra (€/hora)", tipo: "number", passo: "0.5", valor: 35 },
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
        toast(`Obra #${nova.id} aberta`);
        estado.veiculoId = null;
        estado.ordemId = nova.id;
      }
    );
}

// ------------------------------------------------------------------ viaturas
async function vistaVeiculos() {
  conteudo.innerHTML = `
    <div class="barra"><input id="pesquisa-veiculos" type="search" placeholder="Matrícula, marca ou modelo…" /></div>
    <div id="lista-veiculos" class="lista"></div>`;
  const lista = $("#lista-veiculos");
  const carregar = async () => {
    const q = $("#pesquisa-veiculos").value;
    const veiculos = await api(`/veiculos?${new URLSearchParams(q ? { q } : {})}`);
    lista.innerHTML = veiculos.length
      ? veiculos
          .map(
            (v) => `<article class="cartao item" data-veiculo="${v.id}">
              <h3><span>${esc(v.matricula)}</span><span class="ajuda">${km(v.km_atuais)}</span></h3>
              <p>${esc([v.marca, v.modelo, v.ano].filter(Boolean).join(" ") || "—")}</p>
              <p>${esc(v.cliente?.nome || "sem dono associado")}</p>
            </article>`
          )
          .join("")
      : vazio("🚗", "Ainda não há viaturas.", '<div class="acoes" style="justify-content:center"><button data-acao="entrada">Registar entrada</button></div>');
    ligarCartoes(lista);
    ligarAcoes(lista);
  };
  $("#pesquisa-veiculos").oninput = carregar;
  await carregar();
}

// ------------------------------------------------------------------ peças
async function vistaPecas() {
  conteudo.innerHTML = `
    <div class="barra">
      <input id="pesquisa-pecas" type="search" placeholder="Referência ou descrição…" />
      <button id="nova-peca">+ Peça</button>
    </div>
    <div id="lista-pecas" class="lista"></div>`;
  const lista = $("#lista-pecas");
  const carregar = async () => {
    const q = $("#pesquisa-pecas").value;
    const pecas = await api(`/pecas?${new URLSearchParams(q ? { q } : {})}`);
    lista.innerHTML = pecas.length
      ? pecas
          .map(
            (p) => `<article class="cartao">
              <h3><span>${esc(p.descricao)}</span><span>${eur(p.preco_unitario)}</span></h3>
              <p>Ref. ${esc(p.referencia)} · stock <strong style="color:${p.stock <= 0 ? "var(--perigo)" : "inherit"}">${p.stock}</strong></p>
            </article>`
          )
          .join("")
      : vazio("📦", "Catálogo vazio.");
  };
  $("#pesquisa-pecas").oninput = carregar;
  $("#nova-peca").onclick = () =>
    modal(
      "Nova peça",
      [
        { nome: "referencia", rotulo: "Referência", obrigatorio: true },
        { nome: "descricao", rotulo: "Descrição", obrigatorio: true },
        { nome: "preco_unitario", rotulo: "Preço unitário (€)", tipo: "number", passo: "0.01" },
        { nome: "stock", rotulo: "Stock", tipo: "number", passo: "0.01", valor: 0 },
      ],
      async (d) => {
        await api("/pecas", {
          method: "POST",
          body: {
            referencia: d.referencia,
            descricao: d.descricao,
            preco_unitario: num(d.preco_unitario, 0),
            stock: num(d.stock, 0),
          },
        });
        toast("Peça criada");
      }
    );
  await carregar();
}

// ------------------------------------------------------------------ clientes
async function vistaClientes() {
  conteudo.innerHTML = `
    <div class="barra">
      <input id="pesquisa-clientes" type="search" placeholder="Nome ou telefone…" />
      <button id="novo-cliente">+ Cliente</button>
    </div>
    <div id="lista-clientes" class="lista"></div>`;
  const lista = $("#lista-clientes");
  const carregar = async () => {
    const q = $("#pesquisa-clientes").value;
    const clientes = await api(`/clientes?${new URLSearchParams(q ? { q } : {})}`);
    lista.innerHTML = clientes.length
      ? clientes
          .map(
            (c) => `<article class="cartao">
              <h3><span>${esc(c.nome)}</span></h3>
              <p>${c.telefone ? `<a href="tel:${esc(c.telefone)}">${esc(c.telefone)}</a>` : "sem telefone"}${
                c.email ? ` · ${esc(c.email)}` : ""
              }${c.nif ? ` · NIF ${esc(c.nif)}` : ""}</p>
            </article>`
          )
          .join("")
      : vazio("👤", "Ainda não há clientes.");
  };
  $("#pesquisa-clientes").oninput = carregar;
  $("#novo-cliente").onclick = () =>
    modal(
      "Novo cliente",
      [
        { nome: "nome", rotulo: "Nome", obrigatorio: true },
        { nome: "telefone", rotulo: "Telefone", tipo: "tel" },
        { nome: "email", rotulo: "Email", tipo: "email" },
        { nome: "nif", rotulo: "NIF" },
      ],
      async (d) => {
        await api("/clientes", {
          method: "POST",
          body: { nome: d.nome, telefone: txt(d.telefone), email: txt(d.email), nif: txt(d.nif) },
        });
        toast("Cliente criado");
      }
    );
  await carregar();
}

// ------------------------------------------------------------------ router
function lerHash() {
  const [, tipo, id] = (location.hash || "").split("/");
  if (tipo === "obra") return { vista: "ordens", ordemId: Number(id), veiculoId: null };
  if (tipo === "veiculo") return { vista: "veiculos", ordemId: null, veiculoId: Number(id) };
  return { vista: TITULOS[tipo] ? tipo : "inicio", ordemId: null, veiculoId: null };
}

function escreverHash() {
  const novo = estado.ordemId
    ? `#/obra/${estado.ordemId}`
    : estado.veiculoId
    ? `#/veiculo/${estado.veiculoId}`
    : `#/${estado.vista}`;
  if (location.hash !== novo) history.replaceState(null, "", novo);
}

function irPara(alteracoes) {
  Object.assign(estado, { ordemId: null, veiculoId: null }, alteracoes);
  render();
}

function ligarAcoes(raiz = document) {
  $$('[data-acao="entrada"]', raiz).forEach((b) => {
    b.onclick = () => irPara({ vista: "entrada" });
  });
}

async function render() {
  clearInterval(cronometros);
  escreverHash();
  const ativa = estado.ordemId ? "ordens" : estado.veiculoId ? "veiculos" : estado.vista;
  $$("[data-vista]").forEach((b) => b.classList.toggle("ativo", b.dataset.vista === ativa));
  btnVoltar.classList.toggle("hidden", !estado.ordemId && !estado.veiculoId);
  const [tit, sub] = TITULOS[estado.vista] ?? TITULOS.inicio;
  elTitulo.textContent = tit;
  elSubtitulo.textContent = sub;
  conteudo.innerHTML = '<p class="ajuda">A carregar…</p>';
  try {
    if (estado.ordemId) return await vistaOrdem(estado.ordemId);
    if (estado.veiculoId) return await vistaVeiculo(estado.veiculoId);
    if (estado.vista === "entrada") return await vistaEntrada();
    if (estado.vista === "ordens") return await vistaOrdens();
    if (estado.vista === "veiculos") return await vistaVeiculos();
    if (estado.vista === "pecas") return await vistaPecas();
    if (estado.vista === "clientes") return await vistaClientes();
    return await vistaInicio();
  } catch (e) {
    conteudo.innerHTML = vazio("⚠️", e.message);
  } finally {
    ligarAcoes(conteudo);
  }
}

$$("[data-vista]").forEach((b) => {
  b.onclick = () => irPara({ vista: b.dataset.vista });
});
ligarAcoes();
btnVoltar.onclick = () => irPara({ vista: estado.ordemId ? "ordens" : "veiculos" });
$("#btn-atualizar").onclick = render;
window.addEventListener("hashchange", () => {
  Object.assign(estado, lerHash());
  render();
});

Object.assign(estado, lerHash());
render();
