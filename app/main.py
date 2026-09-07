import logging
import os
import shutil
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import auth, models, schemas, storage
from .db import Base, engine, get_db

RAIZ = Path(__file__).resolve().parent.parent
STATIC_DIR = RAIZ / "static"
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", RAIZ / "media"))
EXTENSOES_FOTO = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}
EXTENSOES_VIDEO = {".mp4", ".mov", ".webm", ".m4v", ".3gp"}

logger = logging.getLogger(__name__)

app = FastAPI(title="Gestão de Oficina Automóvel", version="1.0.0")
auth.registar(app)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    return {"ok": True, "storage": storage.ativo()}


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(engine)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    if storage.ativo():
        try:
            storage.criar_bucket()
        except Exception:
            logger.exception("Não foi possível preparar o bucket do Supabase Storage")


def _cliente_out(c: models.Cliente) -> dict:
    return {
        "id": c.id,
        "nome": c.nome,
        "telefone": c.telefone,
        "email": c.email,
        "nif": c.nif,
    }


def _ficheiro_out(f: models.Ficheiro) -> dict:
    return {
        "id": f.id,
        "veiculo_id": f.veiculo_id,
        "ordem_id": f.ordem_id,
        "nome": f.nome,
        "tipo": f.tipo,
        "url": storage.url(f.caminho),
        "legenda": f.legenda,
        "criado_em": f.criado_em,
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
    minutos = sum(t.minutos for t in ordem.tempos)
    horas = minutos / 60.0
    total_mao_obra = round(sum(t.valor(ordem.taxa_hora) for t in ordem.tempos), 2)
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
    }
    if detalhe:
        data["tempos"] = [
            {
                "id": t.id,
                "descricao": t.descricao,
                "mecanico_id": t.mecanico_id,
                "mecanico": t.mecanico.nome if t.mecanico else None,
                "data": t.data,
                "minutos": round(t.minutos, 1),
                "taxa_hora": t.taxa_aplicada(o.taxa_hora),
                "valor": round(t.valor(o.taxa_hora), 2),
            }
            for t in o.tempos
        ]
        data["pecas"] = [
            {
                "id": p.id,
                "descricao": p.descricao,
                "fornecedor": p.fornecedor,
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
    if _procurar_veiculo(db, matricula):
        raise HTTPException(409, "Já existe um veículo com essa matrícula")
    veiculo = models.Veiculo(**{**dados.model_dump(), "matricula": matricula})
    db.add(veiculo)
    db.commit()
    db.refresh(veiculo)
    return _veiculo_out(veiculo)


def _procurar_veiculo(db: Session, matricula: str) -> models.Veiculo | None:
    """Procura ignorando espaços, traços e maiúsculas (AA-12-BB == aa12bb)."""
    normalizada = "".join(c for c in matricula.upper() if c.isalnum())
    coluna = func.replace(func.replace(func.upper(models.Veiculo.matricula), "-", ""), " ", "")
    return db.scalar(select(models.Veiculo).where(coluna == normalizada))


@app.get("/api/veiculos/por-matricula/{matricula}")
def procurar_por_matricula(matricula: str, db: Session = Depends(get_db)):
    veiculo = _procurar_veiculo(db, matricula)
    if veiculo is None:
        return {"encontrado": False}
    ultima = veiculo.ordens[-1] if veiculo.ordens else None
    return {
        "encontrado": True,
        "veiculo": _veiculo_out(veiculo),
        "visitas": len(veiculo.ordens),
        "ultima_visita": ultima.aberta_em if ultima else None,
        "ultima_avaria": ultima.descricao_avaria if ultima else None,
    }


@app.post("/api/entrada", status_code=201)
def entrada_rapida(dados: schemas.EntradaRapida, db: Session = Depends(get_db)):
    """Receção de um carro num só passo: cria/atualiza veículo e dono e abre a obra."""
    matricula = dados.matricula.strip().upper()
    veiculo = _procurar_veiculo(db, matricula)
    if veiculo is None:
        veiculo = models.Veiculo(matricula=matricula, marca=dados.marca, modelo=dados.modelo)
        db.add(veiculo)
    else:
        veiculo.marca = dados.marca or veiculo.marca
        veiculo.modelo = dados.modelo or veiculo.modelo

    if dados.cliente_id:
        veiculo.cliente_id = dados.cliente_id
    elif dados.cliente_nome and not veiculo.cliente_id:
        cliente = models.Cliente(nome=dados.cliente_nome, telefone=dados.cliente_telefone)
        db.add(cliente)
        veiculo.cliente = cliente

    if dados.km is not None:
        veiculo.km_atuais = dados.km

    ordem = models.OrdemServico(
        veiculo=veiculo,
        descricao_avaria=dados.descricao_avaria,
        km_entrada=dados.km,
        taxa_hora=dados.taxa_hora,
        iva=dados.iva,
    )
    db.add(ordem)
    db.commit()
    db.refresh(ordem)
    return _ordem_out(ordem, detalhe=True)


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
        "ficheiros": [_ficheiro_out(f) for f in veiculo.ficheiros],
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


# ---------------------------------------------------------------- fotos e vídeos
@app.get("/api/veiculos/{veiculo_id}/ficheiros")
def listar_ficheiros(veiculo_id: int, db: Session = Depends(get_db)):
    veiculo = db.get(models.Veiculo, veiculo_id)
    if veiculo is None:
        raise HTTPException(404, "Veículo não encontrado")
    return [_ficheiro_out(f) for f in veiculo.ficheiros]


@app.post("/api/veiculos/{veiculo_id}/ficheiros", status_code=201)
def carregar_ficheiro(
    veiculo_id: int,
    ficheiro: UploadFile = File(...),
    ordem_id: int | None = Form(default=None),
    legenda: str = Form(default=""),
    db: Session = Depends(get_db),
):
    """Guarda uma foto ou vídeo da viatura (câmara do telemóvel ou ficheiro)."""
    veiculo = db.get(models.Veiculo, veiculo_id)
    if veiculo is None:
        raise HTTPException(404, "Veículo não encontrado")

    extensao = Path(ficheiro.filename or "").suffix.lower()
    if extensao in EXTENSOES_FOTO:
        tipo = "foto"
    elif extensao in EXTENSOES_VIDEO:
        tipo = "video"
    else:
        raise HTTPException(400, "Só são aceites fotografias ou vídeos")

    nome_disco = f"{veiculo_id}/{uuid.uuid4().hex}{extensao}"
    if storage.ativo():
        caminho = storage.guardar(nome_disco, ficheiro.file.read())
    else:
        destino = MEDIA_DIR / nome_disco
        destino.parent.mkdir(parents=True, exist_ok=True)
        with destino.open("wb") as saida:
            shutil.copyfileobj(ficheiro.file, saida)
        caminho = nome_disco

    registo = models.Ficheiro(
        veiculo_id=veiculo_id,
        ordem_id=ordem_id,
        nome=ficheiro.filename or nome_disco,
        tipo=tipo,
        caminho=caminho,
        legenda=legenda.strip(),
    )
    db.add(registo)
    db.commit()
    db.refresh(registo)
    return _ficheiro_out(registo)


@app.delete("/api/ficheiros/{ficheiro_id}", status_code=204)
def apagar_ficheiro(ficheiro_id: int, db: Session = Depends(get_db)):
    registo = db.get(models.Ficheiro, ficheiro_id)
    if registo is None:
        raise HTTPException(404, "Ficheiro não encontrado")
    if registo.caminho.startswith(storage.PREFIXO):
        storage.apagar(registo.caminho)
    else:
        (MEDIA_DIR / registo.caminho).unlink(missing_ok=True)
    db.delete(registo)
    db.commit()


# ---------------------------------------------------------------- mecânicos
def _mecanico_out(m: models.Mecanico) -> dict:
    return {
        "id": m.id,
        "nome": m.nome,
        "telefone": m.telefone,
        "especialidade": m.especialidade,
        "taxa_hora": m.taxa_hora,
        "ativo": m.ativo,
    }


@app.get("/api/mecanicos")
def listar_mecanicos(db: Session = Depends(get_db)):
    mecanicos = db.scalars(select(models.Mecanico).order_by(models.Mecanico.nome))
    return [_mecanico_out(m) for m in mecanicos]


@app.post("/api/mecanicos", status_code=201)
def criar_mecanico(dados: schemas.MecanicoIn, db: Session = Depends(get_db)):
    mecanico = models.Mecanico(**dados.model_dump())
    db.add(mecanico)
    db.commit()
    db.refresh(mecanico)
    return _mecanico_out(mecanico)


@app.get("/api/mecanicos/{mecanico_id}")
def perfil_mecanico(mecanico_id: int, meses: int = 6, db: Session = Depends(get_db)):
    """Perfil com resumo mensal de horas e mão de obra faturada pelo mecânico."""
    mecanico = db.get(models.Mecanico, mecanico_id)
    if mecanico is None:
        raise HTTPException(404, "Mecânico não encontrado")

    registos = list(
        db.scalars(
            select(models.RegistoTempo)
            .where(models.RegistoTempo.mecanico_id == mecanico_id)
            .order_by(models.RegistoTempo.data.desc())
        )
    )

    por_mes: dict[str, dict] = {}
    for r in registos:
        chave = r.data.strftime("%Y-%m")
        mes = por_mes.setdefault(chave, {"mes": chave, "minutos": 0.0, "valor": 0.0, "obras": set()})
        mes["minutos"] += r.minutos
        mes["valor"] += r.valor(r.ordem.taxa_hora)
        mes["obras"].add(r.ordem_id)

    resumo_mensal = [
        {
            "mes": m["mes"],
            "horas": round(m["minutos"] / 60.0, 2),
            "valor": round(m["valor"], 2),
            "obras": len(m["obras"]),
        }
        for m in sorted(por_mes.values(), key=lambda m: m["mes"], reverse=True)[:meses]
    ]

    trabalhos = [
        {
            "ordem_id": r.ordem_id,
            "matricula": r.ordem.veiculo.matricula if r.ordem.veiculo else None,
            "veiculo_id": r.ordem.veiculo_id,
            "data": r.data,
            "descricao": r.descricao,
            "minutos": round(r.minutos, 1),
            "valor": round(r.valor(r.ordem.taxa_hora), 2),
        }
        for r in registos[:15]
    ]

    minutos_total = sum(r.minutos for r in registos)
    return {
        **_mecanico_out(mecanico),
        "resumo_mensal": resumo_mensal,
        "trabalhos": trabalhos,
        "totais": {
            "horas": round(minutos_total / 60.0, 2),
            "valor": round(sum(r.valor(r.ordem.taxa_hora) for r in registos), 2),
            "obras": len({r.ordem_id for r in registos}),
        },
    }


@app.patch("/api/mecanicos/{mecanico_id}")
def atualizar_mecanico(
    mecanico_id: int, dados: schemas.MecanicoUpdate, db: Session = Depends(get_db)
):
    mecanico = db.get(models.Mecanico, mecanico_id)
    if mecanico is None:
        raise HTTPException(404, "Mecânico não encontrado")
    for campo, valor in dados.model_dump(exclude_none=True).items():
        setattr(mecanico, campo, valor)
    db.commit()
    db.refresh(mecanico)
    return _mecanico_out(mecanico)


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
    mecanico = db.get(models.Mecanico, dados.mecanico_id) if dados.mecanico_id else None
    if dados.mecanico_id and mecanico is None:
        raise HTTPException(404, "Mecânico não encontrado")
    registo = models.RegistoTempo(
        ordem_id=ordem.id,
        mecanico_id=dados.mecanico_id,
        descricao=dados.descricao,
        data=dados.data or models.utcnow(),
        minutos=dados.minutos,
        taxa_hora=mecanico.taxa_hora if mecanico else ordem.taxa_hora,
    )
    db.add(registo)
    if ordem.estado == models.EstadoOS.aberta.value:
        ordem.estado = models.EstadoOS.em_curso.value
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


# ---------------------------------------------------------------- peças da obra
@app.post("/api/ordens/{ordem_id}/pecas", status_code=201)
def adicionar_peca(ordem_id: int, dados: schemas.PecaUsadaIn, db: Session = Depends(get_db)):
    ordem = _get_ordem(db, ordem_id)
    linha = models.PecaUsada(
        ordem_id=ordem.id,
        descricao=dados.descricao,
        fornecedor=dados.fornecedor,
        quantidade=dados.quantidade,
        preco_unitario=dados.preco_unitario,
    )
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

    mes = models.utcnow().strftime("%Y-%m")
    minutos_mes = sum(
        t.minutos for o in ordens for t in o.tempos if t.data.strftime("%Y-%m") == mes
    )
    return {
        "ordens": len(ordens),
        "por_estado": por_estado,
        "veiculos": db.scalar(select(func.count()).select_from(models.Veiculo)),
        "clientes": db.scalar(select(func.count()).select_from(models.Cliente)),
        "faturacao_fechada": round(faturacao, 2),
        "horas_mes": round(minutos_mes / 60.0, 2),
    }


MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
