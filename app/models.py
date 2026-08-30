from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    """UTC sem timezone, para ser comparável com o que a BD devolve."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EstadoOS(str, Enum):
    aberta = "aberta"
    em_curso = "em_curso"
    concluida = "concluida"
    faturada = "faturada"


class Cliente(Base):
    __tablename__ = "clientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    telefone: Mapped[str | None] = mapped_column(String(40), default=None)
    email: Mapped[str | None] = mapped_column(String(120), default=None)
    nif: Mapped[str | None] = mapped_column(String(20), default=None)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    veiculos: Mapped[list["Veiculo"]] = relationship(back_populates="cliente")


class Veiculo(Base):
    __tablename__ = "veiculos"

    id: Mapped[int] = mapped_column(primary_key=True)
    matricula: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    marca: Mapped[str | None] = mapped_column(String(60), default=None)
    modelo: Mapped[str | None] = mapped_column(String(60), default=None)
    ano: Mapped[int | None] = mapped_column(Integer, default=None)
    vin: Mapped[str | None] = mapped_column(String(40), default=None)
    km_atuais: Mapped[int] = mapped_column(Integer, default=0)
    cliente_id: Mapped[int | None] = mapped_column(ForeignKey("clientes.id"), default=None)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    cliente: Mapped["Cliente | None"] = relationship(back_populates="veiculos")
    ordens: Mapped[list["OrdemServico"]] = relationship(back_populates="veiculo")


class Mecanico(Base):
    __tablename__ = "mecanicos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    custo_hora: Mapped[float] = mapped_column(Float, default=35.0)
    ativo: Mapped[int] = mapped_column(Integer, default=1)


class Peca(Base):
    __tablename__ = "pecas"

    id: Mapped[int] = mapped_column(primary_key=True)
    referencia: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    descricao: Mapped[str] = mapped_column(String(200))
    preco_unitario: Mapped[float] = mapped_column(Float, default=0.0)
    stock: Mapped[float] = mapped_column(Float, default=0.0)


class OrdemServico(Base):
    __tablename__ = "ordens_servico"

    id: Mapped[int] = mapped_column(primary_key=True)
    veiculo_id: Mapped[int] = mapped_column(ForeignKey("veiculos.id"))
    descricao_avaria: Mapped[str] = mapped_column(Text, default="")
    trabalho_realizado: Mapped[str] = mapped_column(Text, default="")
    km_entrada: Mapped[int | None] = mapped_column(Integer, default=None)
    estado: Mapped[str] = mapped_column(String(20), default=EstadoOS.aberta.value)
    taxa_hora: Mapped[float] = mapped_column(Float, default=35.0)
    desconto: Mapped[float] = mapped_column(Float, default=0.0)
    iva: Mapped[float] = mapped_column(Float, default=23.0)
    aberta_em: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    fechada_em: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    veiculo: Mapped["Veiculo"] = relationship(back_populates="ordens")
    tempos: Mapped[list["RegistoTempo"]] = relationship(
        back_populates="ordem", cascade="all, delete-orphan"
    )
    pecas: Mapped[list["PecaUsada"]] = relationship(
        back_populates="ordem", cascade="all, delete-orphan"
    )


class RegistoTempo(Base):
    __tablename__ = "registos_tempo"

    id: Mapped[int] = mapped_column(primary_key=True)
    ordem_id: Mapped[int] = mapped_column(ForeignKey("ordens_servico.id"))
    mecanico_id: Mapped[int | None] = mapped_column(ForeignKey("mecanicos.id"), default=None)
    descricao: Mapped[str] = mapped_column(String(200), default="")
    inicio: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    fim: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    minutos: Mapped[float | None] = mapped_column(Float, default=None)

    ordem: Mapped["OrdemServico"] = relationship(back_populates="tempos")
    mecanico: Mapped["Mecanico | None"] = relationship()

    @property
    def minutos_efetivos(self) -> float:
        if self.minutos is not None:
            return self.minutos
        if self.fim is None:
            return 0.0
        return (self.fim - self.inicio).total_seconds() / 60.0


class PecaUsada(Base):
    __tablename__ = "pecas_usadas"

    id: Mapped[int] = mapped_column(primary_key=True)
    ordem_id: Mapped[int] = mapped_column(ForeignKey("ordens_servico.id"))
    peca_id: Mapped[int | None] = mapped_column(ForeignKey("pecas.id"), default=None)
    descricao: Mapped[str] = mapped_column(String(200), default="")
    quantidade: Mapped[float] = mapped_column(Float, default=1.0)
    preco_unitario: Mapped[float] = mapped_column(Float, default=0.0)

    ordem: Mapped["OrdemServico"] = relationship(back_populates="pecas")
    peca: Mapped["Peca | None"] = relationship()
