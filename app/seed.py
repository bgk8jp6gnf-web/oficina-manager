"""Popula a base de dados com dados de demonstração: python -m app.seed"""

from datetime import timedelta

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import (
    Cliente,
    Mecanico,
    OrdemServico,
    PecaUsada,
    RegistoTempo,
    Veiculo,
    utcnow,
)


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    if db.scalar(select(Veiculo).limit(1)):
        print("Base de dados já tem dados; nada a fazer.")
        return

    hoje = utcnow()
    mes_passado = hoje - timedelta(days=35)

    cliente = Cliente(nome="Vasco Reis", telefone="912345678", nif="123456789")
    manuel = Mecanico(
        nome="Manuel Luís", telefone="913333444", especialidade="Mecânica geral", taxa_hora=35.0
    )
    joao = Mecanico(
        nome="João Silva", telefone="917777888", especialidade="Eletricidade auto", taxa_hora=42.0
    )
    veiculo = Veiculo(
        matricula="AA-12-BB",
        marca="Renault",
        modelo="Clio 1.5 dCi",
        ano=2016,
        km_atuais=184320,
        cliente=cliente,
    )
    ordem = OrdemServico(
        veiculo=veiculo,
        descricao_avaria="Revisão dos 180.000 km e ruído nos travões da frente",
        trabalho_realizado="Mudança de óleo e filtro; substituição das pastilhas da frente.",
        km_entrada=184320,
        estado="em_curso",
        taxa_hora=35.0,
    )
    ordem.tempos = [
        RegistoTempo(descricao="Revisão", minutos=75, mecanico=manuel, taxa_hora=35.0, data=hoje),
        RegistoTempo(descricao="Travões", minutos=45, mecanico=manuel, taxa_hora=35.0, data=hoje),
    ]
    ordem.pecas = [
        PecaUsada(descricao="Filtro de óleo", fornecedor="AutoZitro", quantidade=1, preco_unitario=8.5),
        PecaUsada(descricao="Óleo 5W30 (litro)", fornecedor="AutoZitro", quantidade=4, preco_unitario=9.9),
        PecaUsada(
            descricao="Pastilhas de travão frente",
            fornecedor="Norauto",
            quantidade=1,
            preco_unitario=42.0,
        ),
    ]

    anterior = OrdemServico(
        veiculo=veiculo,
        descricao_avaria="Bateria descarregada e luz de avaria acesa",
        trabalho_realizado="Diagnóstico elétrico e substituição da bateria.",
        km_entrada=178900,
        estado="faturada",
        taxa_hora=35.0,
        aberta_em=mes_passado,
        fechada_em=mes_passado,
    )
    anterior.tempos = [
        RegistoTempo(
            descricao="Diagnóstico elétrico",
            minutos=60,
            mecanico=joao,
            taxa_hora=42.0,
            data=mes_passado,
        ),
        RegistoTempo(
            descricao="Substituir bateria",
            minutos=30,
            mecanico=manuel,
            taxa_hora=35.0,
            data=mes_passado,
        ),
    ]
    anterior.pecas = [
        PecaUsada(descricao="Bateria 60Ah", fornecedor="Bosch Car Service", quantidade=1, preco_unitario=89.0),
    ]

    db.add_all([cliente, manuel, joao, veiculo, anterior, ordem])
    db.commit()
    print("Dados de demonstração criados.")


if __name__ == "__main__":
    main()
