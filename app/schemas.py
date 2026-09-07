from datetime import datetime

from pydantic import BaseModel, Field


class ClienteIn(BaseModel):
    nome: str
    telefone: str | None = None
    email: str | None = None
    nif: str | None = None


class VeiculoIn(BaseModel):
    matricula: str
    marca: str | None = None
    modelo: str | None = None
    ano: int | None = None
    vin: str | None = None
    km_atuais: int = 0
    cliente_id: int | None = None


class VeiculoUpdate(BaseModel):
    marca: str | None = None
    modelo: str | None = None
    ano: int | None = None
    vin: str | None = None
    km_atuais: int | None = None
    cliente_id: int | None = None


class MecanicoIn(BaseModel):
    nome: str
    telefone: str | None = None
    especialidade: str | None = None
    taxa_hora: float = 35.0


class MecanicoUpdate(BaseModel):
    nome: str | None = None
    telefone: str | None = None
    especialidade: str | None = None
    taxa_hora: float | None = Field(default=None, ge=0)
    ativo: int | None = None


class OrdemIn(BaseModel):
    veiculo_id: int
    descricao_avaria: str = ""
    km_entrada: int | None = None
    taxa_hora: float = 35.0
    iva: float = 23.0


class EntradaRapida(BaseModel):
    matricula: str
    km: int | None = None
    descricao_avaria: str = ""
    marca: str | None = None
    modelo: str | None = None
    cliente_id: int | None = None
    cliente_nome: str | None = None
    cliente_telefone: str | None = None
    taxa_hora: float = 35.0
    iva: float = 23.0


class OrdemUpdate(BaseModel):
    descricao_avaria: str | None = None
    trabalho_realizado: str | None = None
    km_entrada: int | None = None
    estado: str | None = None
    taxa_hora: float | None = None
    desconto: float | None = None
    iva: float | None = None


class TempoIn(BaseModel):
    mecanico_id: int | None = None
    descricao: str = ""
    minutos: float = Field(ge=0)
    data: datetime | None = None


class PecaUsadaIn(BaseModel):
    descricao: str
    fornecedor: str = ""
    quantidade: float = Field(default=1.0, gt=0)
    preco_unitario: float = Field(default=0.0, ge=0)
