from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import models, schemas
from .db import Base, engine, get_db

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Gestão de Oficina Automóvel", version="1.0.0")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(engine)


def _cliente_out(c: models.Cliente) -> dict:
    return {
        "id": c.id,
        "nome": c.nome,
        "telefone": c.telefone,
        "email": c.email,
        "nif": c.nif,
    }


def _veiculo_out(v: models.Veiculo) -> dict:
    return {
        "id": v.id,
        "matricula": v.matricula,
        "marca": v.marca,
        "modelo": v.modelo,
        "ano": v.ano,
        "vin": v.vin,
        "km_atuais": v.km_atuais,
        "cliente_id": v.cliente_id,
        "cliente": _cliente_out(v.cliente) if v.cliente else None,
    }


def calcular_totais(ordem: models.OrdemServico) -> dict:
    minutos = sum(t.minutos_efetivos for t in ordem.tempos)
    horas = minutos / 60.0
    total_mao_obra = round(horas * ordem.taxa_hora, 2)
    total_pecas = round(sum(p.quantidade * p.preco_unitario for p in ordem.pecas), 2)
    subtotal = round(total_mao_obra + total_pecas - ordem.desconto, 2)
    valor_iva = round(subtotal * ordem.iva / 100.0, 2)
    return {
        "minutos": round(minutos, 1),
        "horas": round(horas, 2),
        "total_mao_obra": total_mao_obra,
        "total_pecas": total_pecas,
        "desconto": round(ordem.desconto, 2),
        "subtotal": subtotal,
        "valor_iva": valor_iva,
        "total": round(subtotal + valor_iva, 2),
    }


def _ordem_out(o: models.OrdemServico, detalhe: bool = False) -> dict:
    data = {
        "id": o.id,
        "veiculo_id": o.veiculo_id,
        "veiculo": _veiculo_out(o.veiculo) if o.veiculo else None,
        "descricao_avaria": o.descricao_avaria,
        "trabalho_realizado": o.trabalho_realizado,
        "km_entrada": o.km_entrada,
        "estado": o.estado,
        "taxa_hora": o.taxa_hora,
        "desconto": o.desconto,
        "iva": o.iva,
        "aberta_em": o.aberta_em,
        "fechada_em": o.fechada_em,
        "totais": calcular_totais(o),
        "cronometro_ativo": any(t.fim is None and t.minutos is None for t in o.tempos),
    }
    if detalhe:
        data["tempos"] = [
            {
                "id": t.id,
                "descricao": t.descricao,
                "mecanico_id": t.mecanico_id,
                "mecanico": t.mecanico.nome if t.mecanico else None,
                "inicio": t.inicio,
                "fim": t.fim,
                "minutos": round(t.minutos_efetivos, 1),
                "a_decorrer": t.fim is None and t.minutos is None,
            }
            for t in o.tempos
        ]
        data["pecas"] = [
            {
                "id": p.id,
                "peca_id": p.peca_id,
                "referencia": p.peca.referencia if p.peca else None,
                "descricao": p.descricao,
                "quantidade": p.quantidade,
                "preco_unitario": p.preco_unitario,
                "total": round(p.quantidade * p.preco_unitario, 2),
            }
            for p in o.pecas
        ]
    return data


def _get_ordem(db: Session, ordem_id: int) -> models.OrdemServico:
    ordem = db.get(models.OrdemServico, ordem_id)
    if ordem is None:
        raise HTTPException(404, "Ordem de serviço não encontrada")
    return ordem


# ---------------------------------------------------------------- clientes
@app.get("/api/clientes")
def listar_clientes(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(models.Cliente).order_by(models.Cliente.nome)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(models.Cliente.nome.ilike(like), models.Cliente.telefone.ilike(like)))
    return [_cliente_out(c) for c in db.scalars(stmt)]


@app.post("/api/clientes", status_code=201)
def criar_cliente(dados: schemas.ClienteIn, db: Session = Depends(get_db)):
    cliente = models.Cliente(**dados.model_dump())
    db.add(cliente)
    db.commit()
    db.refresh(cliente)
    return _cliente_out(cliente)


# ---------------------------------------------------------------- veículos
@app.get("/api/veiculos")
def listar_veiculos(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(models.Veiculo).order_by(models.Veiculo.matricula)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                models.Veiculo.matricula.ilike(like),
                models.Veiculo.marca.ilike(like),
                models.Veiculo.modelo.ilike(like),
            )
        )
    return [_veiculo_out(v) for v in db.scalars(stmt)]


@app.post("/api/veiculos", status_code=201)
def criar_veiculo(dados: schemas.VeiculoIn, db: Session = Depends(get_db)):
    matricula = dados.matricula.strip().upper()
    if db.scalar(select(models.Veiculo).where(models.Veiculo.matricula == matricula)):
        raise HTTPException(409, "Já existe um veículo com essa matrícula")
    veiculo = models.Veiculo(**{**dados.model_dump(), "matricula": matricula})
    db.add(veiculo)
    db.commit()
    db.refresh(veiculo)
    return _veiculo_out(veiculo)


@app.get("/api/veiculos/{veiculo_id}")
def obter_veiculo(veiculo_id: int, db: Session = Depends(get_db)):
    veiculo = db.get(models.Veiculo, veiculo_id)
    if veiculo is None:
        raise HTTPException(404, "Veículo não encontrado")
    historico = [_ordem_out(o, detalhe=True) for o in reversed(veiculo.ordens)]
    fechadas = [
        h
        for h in historico
        if h["estado"] in {models.EstadoOS.concluida.value, models.EstadoOS.faturada.value}
    ]
    return {
        **_veiculo_out(veiculo),
        "historico": historico,
        "resumo": {
            "visitas": len(historico),
            "ultima_visita": historico[0]["aberta_em"] if historico else None,
            "total_gasto": round(sum(h["totais"]["total"] for h in fechadas), 2),
            "total_horas": round(sum(h["totais"]["horas"] for h in historico), 2),
        },
    }


@app.patch("/api/veiculos/{veiculo_id}")
def atualizar_veiculo(
    veiculo_id: int, dados: schemas.VeiculoUpdate, db: Session = Depends(get_db)
):
    veiculo = db.get(models.Veiculo, veiculo_id)
    if veiculo is None:
        raise HTTPException(404, "Veículo não encontrado")
    for campo, valor in dados.model_dump(exclude_none=True).items():
        setattr(veiculo, campo, valor)
    db.commit()
    db.refresh(veiculo)
    return _veiculo_out(veiculo)


# ---------------------------------------------------------------- mecânicos
@app.get("/api/mecanicos")
def listar_mecanicos(db: Session = Depends(get_db)):
    mecanicos = db.scalars(select(models.Mecanico).order_by(models.Mecanico.nome))
    return [{"id": m.id, "nome": m.nome, "custo_hora": m.custo_hora} for m in mecanicos]


@app.post("/api/mecanicos", status_code=201)
def criar_mecanico(dados: schemas.MecanicoIn, db: Session = Depends(get_db)):
    mecanico = models.Mecanico(**dados.model_dump())
    db.add(mecanico)
    db.commit()
    db.refresh(mecanico)
    return {"id": mecanico.id, "nome": mecanico.nome, "custo_hora": mecanico.custo_hora}


# ---------------------------------------------------------------- peças
@app.get("/api/pecas")
def listar_pecas(q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(models.Peca).order_by(models.Peca.descricao)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(models.Peca.referencia.ilike(like), models.Peca.descricao.ilike(like))
        )
    return [
        {
            "id": p.id,
            "referencia": p.referencia,
            "descricao": p.descricao,
            "preco_unitario": p.preco_unitario,
            "stock": p.stock,
        }
        for p in db.scalars(stmt)
    ]


@app.post("/api/pecas", status_code=201)
def criar_peca(dados: schemas.PecaIn, db: Session = Depends(get_db)):
    if db.scalar(select(models.Peca).where(models.Peca.referencia == dados.referencia)):
        raise HTTPException(409, "Já existe uma peça com essa referência")
    peca = models.Peca(**dados.model_dump())
    db.add(peca)
    db.commit()
    db.refresh(peca)
    return {
        "id": peca.id,
        "referencia": peca.referencia,
        "descricao": peca.descricao,
        "preco_unitario": peca.preco_unitario,
        "stock": peca.stock,
    }


# ---------------------------------------------------------------- ordens
@app.get("/api/ordens")
def listar_ordens(
    estado: str | None = None,
    q: str | None = Query(default=None, description="Pesquisa por matrícula"),
    db: Session = Depends(get_db),
):
    stmt = select(models.OrdemServico).order_by(models.OrdemServico.id.desc())
    if estado:
        stmt = stmt.where(models.OrdemServico.estado == estado)
    if q:
        stmt = stmt.join(models.Veiculo).where(models.Veiculo.matricula.ilike(f"%{q}%"))
    return [_ordem_out(o) for o in db.scalars(stmt)]


@app.post("/api/ordens", status_code=201)
def criar_ordem(dados: schemas.OrdemIn, db: Session = Depends(get_db)):
    veiculo = db.get(models.Veiculo, dados.veiculo_id)
    if veiculo is None:
        raise HTTPException(404, "Veículo não encontrado")
    ordem = models.OrdemServico(**dados.model_dump())
    if dados.km_entrada:
        veiculo.km_atuais = max(veiculo.km_atuais, dados.km_entrada)
    db.add(ordem)
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


@app.get("/api/ordens/{ordem_id}")
def obter_ordem(ordem_id: int, db: Session = Depends(get_db)):
    return _ordem_out(_get_ordem(db, ordem_id), detalhe=True)


@app.patch("/api/ordens/{ordem_id}")
def atualizar_ordem(ordem_id: int, dados: schemas.OrdemUpdate, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    valores = dados.model_dump(exclude_none=True)
    estado = valores.get("estado")
    if estado and estado not in {e.value for e in models.EstadoOS}:
        raise HTTPException(400, "Estado inválido")
    for campo, valor in valores.items():
        setattr(ordem, campo, valor)
    if estado in {models.EstadoOS.concluida.value, models.EstadoOS.faturada.value}:
        ordem.fechada_em = ordem.fechada_em or models.utcnow()
    if valores.get("km_entrada") and ordem.veiculo:
        ordem.veiculo.km_atuais = max(ordem.veiculo.km_atuais, valores["km_entrada"])
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


# ---------------------------------------------------------------- tempos
@app.post("/api/ordens/{ordem_id}/tempos", status_code=201)
def registar_tempo(ordem_id: int, dados: schemas.TempoIn, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    registo = models.RegistoTempo(
        ordem_id=ordem.id,
        mecanico_id=dados.mecanico_id,
        descricao=dados.descricao,
        inicio=dados.inicio or models.utcnow(),
        fim=dados.fim,
        minutos=dados.minutos,
    )
    db.add(registo)
    if ordem.estado == models.EstadoOS.aberta.value:
        ordem.estado = models.EstadoOS.em_curso.value
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


@app.post("/api/ordens/{ordem_id}/tempos/{tempo_id}/parar")
def parar_tempo(ordem_id: int, tempo_id: int, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    registo = db.get(models.RegistoTempo, tempo_id)
    if registo is None or registo.ordem_id != ordem.id:
        raise HTTPException(404, "Registo de tempo não encontrado")
    if registo.fim is None and registo.minutos is None:
        registo.fim = models.utcnow()
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


@app.delete("/api/ordens/{ordem_id}/tempos/{tempo_id}")
def apagar_tempo(ordem_id: int, tempo_id: int, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    registo = db.get(models.RegistoTempo, tempo_id)
    if registo is None or registo.ordem_id != ordem.id:
        raise HTTPException(404, "Registo de tempo não encontrado")
    db.delete(registo)
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


# ---------------------------------------------------------------- peças usadas
@app.post("/api/ordens/{ordem_id}/pecas", status_code=201)
def adicionar_peca(ordem_id: int, dados: schemas.PecaUsadaIn, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    peca = db.get(models.Peca, dados.peca_id) if dados.peca_id else None
    if dados.peca_id and peca is None:
        raise HTTPException(404, "Peça não encontrada")
    preco = dados.preco_unitario
    if preco is None:
        preco = peca.preco_unitario if peca else 0.0
    linha = models.PecaUsada(
        ordem_id=ordem.id,
        peca_id=peca.id if peca else None,
        descricao=dados.descricao or (peca.descricao if peca else ""),
        quantidade=dados.quantidade,
        preco_unitario=preco,
    )
    if peca:
        peca.stock -= dados.quantidade
    db.add(linha)
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


@app.delete("/api/ordens/{ordem_id}/pecas/{linha_id}")
def remover_peca(ordem_id: int, linha_id: int, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    linha = db.get(models.PecaUsada, linha_id)
    if linha is None or linha.ordem_id != ordem.id:
        raise HTTPException(404, "Linha de peça não encontrada")
    if linha.peca:
        linha.peca.stock += linha.quantidade
    db.delete(linha)
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


# ---------------------------------------------------------------- dashboard
@app.get("/api/resumo")
def resumo(db: Session = Depends(get_db)):
    ordens = list(db.scalars(select(models.OrdemServico)))
    por_estado: dict[str, int] = {}
    faturacao = 0.0
    for o in ordens:
        por_estado[o.estado] = por_estado.get(o.estado, 0) + 1
        if o.estado in {models.EstadoOS.concluida.value, models.EstadoOS.faturada.value}:
            faturacao += calcular_totais(o)["total"]
    return {
        "ordens": len(ordens),
        "por_estado": por_estado,
        "veiculos": db.scalar(select(func.count()).select_from(models.Veiculo)),
        "clientes": db.scalar(select(func.count()).select_from(models.Cliente)),
        "faturacao_fechada": round(faturacao, 2),
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
