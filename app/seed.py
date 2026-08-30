"""Popula a base de dados com dados de demonstração: python -m app.seed"""

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import Cliente, Mecanico, OrdemServico, Peca, PecaUsada, RegistoTempo, Veiculo


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    if db.scalar(select(Veiculo).limit(1)):
        print("Base de dados já tem dados; nada a fazer.")
        return

    cliente = Cliente(nome="Vasco Reis", telefone="912345678", nif="123456789")
    mecanico = Mecanico(nome="João Silva", custo_hora=35.0)
    veiculo = Veiculo(
        matricula="AA-12-BB",
        marca="Renault",
        modelo="Clio 1.5 dCi",
        ano=2016,
        km_atuais=184320,
        cliente=cliente,
    )
    pecas = [
        Peca(referencia="OF-1024", descricao="Filtro de óleo", preco_unitario=8.5, stock=12),
        Peca(referencia="OL-5W30", descricao="Óleo 5W30 (litro)", preco_unitario=9.9, stock=40),
        Peca(referencia="PT-402", descricao="Pastilhas de travão frente", preco_unitario=42.0, stock=6),
    ]
    ordem = OrdemServico(
        veiculo=veiculo,
        descricao_avaria="Revisão dos 180.000 km e ruído nos travões da frente",
        trabalho_realizado="Mudança de óleo e filtro; substituição das pastilhas da frente.",
        km_entrada=184320,
        estado="em_curso",
        taxa_hora=35.0,
    )
    ordem.tempos = [
        RegistoTempo(descricao="Revisão", minutos=75, mecanico=mecanico),
        RegistoTempo(descricao="Travões", minutos=45, mecanico=mecanico),
    ]
    ordem.pecas = [
        PecaUsada(peca=pecas[0], descricao="Filtro de óleo", quantidade=1, preco_unitario=8.5),
        PecaUsada(peca=pecas[1], descricao="Óleo 5W30 (litro)", quantidade=4, preco_unitario=9.9),
        PecaUsada(peca=pecas[2], descricao="Pastilhas de travão frente", quantidade=1, preco_unitario=42.0),
    ]

    db.add_all([cliente, mecanico, veiculo, ordem, *pecas])
    db.commit()
    print("Dados de demonstração criados.")


if __name__ == "__main__":
    main()
