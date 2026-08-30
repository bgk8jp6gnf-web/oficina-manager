# Gestão de Oficina Automóvel

Aplicação web (mobile-first) para gerir os recursos de uma oficina: clientes, veículos,
peças/stock, mecânicos e obras (ordens de serviço) com registo de tempo e cálculo automático
do preço de mão de obra, peças, desconto, IVA e total.

- Backend: FastAPI + SQLAlchemy (SQL real, SQLite por omissão, pronto para PostgreSQL/MySQL)
- Frontend: HTML/CSS/JS sem dependências, pensado para usar no telemóvel
- Tudo em tempo real: o que é escrito no telemóvel fica logo na base de dados

## Executar

```bash
pip install -r requirements.txt
python -m app.seed          # opcional: dados de demonstração
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Abrir `http://localhost:8000` (no telemóvel, usar o IP do PC na mesma rede, ex.
`http://192.168.1.20:8000`). Documentação da API em `/docs`.

## Base de dados

Por omissão usa `sqlite:///./oficina.db`. Para outra base de dados basta definir `DATABASE_URL`:

```bash
export DATABASE_URL="postgresql+psycopg://user:pass@servidor:5432/oficina"
```

As tabelas são criadas automaticamente no arranque.

### Modelo de dados

| Tabela | Descrição |
| --- | --- |
| `clientes` | donos dos veículos (nome, telefone, email, NIF) |
| `veiculos` | matrícula, marca, modelo, ano, VIN, km atuais, dono |
| `mecanicos` | nome e custo/hora |
| `pecas` | catálogo com referência, preço e stock |
| `ordens_servico` | obra: avaria, trabalho realizado, km, estado, taxa/hora, desconto, IVA |
| `registos_tempo` | tempo por tarefa (cronómetro ou minutos manuais) |
| `pecas_usadas` | peças aplicadas na obra (abate stock automaticamente) |

## Cálculo do preço

```
mão de obra = (soma dos minutos / 60) × taxa_hora da obra
peças       = Σ quantidade × preço unitário
subtotal    = mão de obra + peças − desconto
total       = subtotal + IVA
```

## Funcionalidades

- Registar veículo e dono a partir do telemóvel, com atualização de km
- Ficha do veículo com histórico contínuo: todas as visitas (data, km, avaria, trabalho, peças,
  custo), nº de visitas, horas acumuladas e total já faturado; abrir nova obra a partir da ficha
- Ligações diretas por URL: `#/veiculo/{id}` e `#/obra/{id}`
- Abrir obra com descrição do que veio arranjar
- Cronómetro (iniciar/parar) ou introdução manual de minutos, por mecânico
- Adicionar peças do stock (abate quantidade) ou peças avulsas
- Totais atualizados ao momento e impressão/PDF da folha de obra
- Estados: aberta → em curso → concluída → faturada, com resumo de faturação

## API (principais endpoints)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET/POST | `/api/clientes` | listar/criar clientes |
| GET/POST | `/api/veiculos` | listar/criar veículos (`?q=` pesquisa) |
| GET/PATCH | `/api/veiculos/{id}` | ficha com histórico e resumo / atualizar km e dados |
| GET/POST | `/api/pecas` | catálogo de peças |
| GET/POST | `/api/ordens` | listar (`?estado=`, `?q=`) / criar obras |
| GET/PATCH | `/api/ordens/{id}` | detalhe com totais / atualizar |
| POST | `/api/ordens/{id}/tempos` | iniciar cronómetro ou registar minutos |
| POST | `/api/ordens/{id}/tempos/{tid}/parar` | parar cronómetro |
| POST/DELETE | `/api/ordens/{id}/pecas` | adicionar/remover peças |
| GET | `/api/resumo` | indicadores gerais |
