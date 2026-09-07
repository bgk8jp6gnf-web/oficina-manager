# Gestão de Oficina Automóvel

Aplicação web (mobile-first) para gerir os recursos de uma oficina: clientes, veículos,
peças, mecânicos e obras (ordens de serviço) com registo de tempo e cálculo automático
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

### Supabase

O Supabase é PostgreSQL, por isso funciona sem alterações ao código. No painel:
Connect → Connection string → URI (usar **Session pooler**, porque a ligação
direta `db.<projeto>.supabase.co` só tem IPv6).

```bash
export DATABASE_URL="postgresql://postgres.<projeto>:<password>@aws-1-<regiao>.pooler.supabase.com:5432/postgres"
python -m app.seed        # opcional: dados de demonstração
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Guardar a string num ficheiro `.env` local (já ignorado pelo git) e nunca em
código ou commits. Nota: as fotos/vídeos continuam a ser guardados na pasta
`media/` do servidor — só os dados SQL vão para o Supabase.

### Evitar a pausa do Supabase (plano gratuito)

Projetos gratuitos são pausados ao fim de 7 dias sem atividade. Há duas camadas:

1. **Dentro da base de dados** — `pg_cron` corre todos os dias às 06:17 UTC:

   ```sql
   create extension if not exists pg_cron;
   select cron.schedule('oficina-keepalive', '17 6 * * *',
     $$update keepalive set ultima_atividade = now() where id = 1$$);
   -- ver histórico: select * from cron.job_run_details order by start_time desc;
   ```

2. **Fora da base de dados** — obrigatório, porque o `pg_cron` também para quando a
   base de dados é desligada. Duas alternativas:

   - Serviço de cron HTTP (ex. cron-job.org), a chamar diariamente o endpoint REST
     do Supabase, que faz uma consulta real à base de dados:

     ```text
     https://<projeto>.supabase.co/rest/v1/keepalive?select=ultima_atividade&apikey=<anon key>
     ```

     A tabela `keepalive` tem RLS com uma policy de leitura para o papel `anon`.

   - Ou `scripts/keepalive.py`, agendado em `.github/workflows/keepalive.yml` com o
     segredo `DATABASE_URL` no repositório.

## Alojamento (Render)

O repositório traz `Dockerfile` e `render.yaml`. No Render: New → Web Service →
ligar ao repositório → runtime Docker → plano Free, e definir as variáveis:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | ligação PostgreSQL do Supabase (Session pooler) |
| `OFICINA_PASSWORD` | palavra-passe de acesso à app |
| `MEDIA_DIR` | `/var/media` |

Com `OFICINA_PASSWORD` definida, a app pede login numa página própria e guarda a
sessão num cookie durante 30 dias. Sem essa variável (desenvolvimento local) fica
aberta. No plano Free do Render não há disco persistente e o serviço adormece
quando não é usado, por isso as fotos/vídeos devem passar mais tarde para o
Supabase Storage.

### Modelo de dados

| Tabela | Descrição |
| --- | --- |
| `clientes` | donos dos veículos (nome, telefone, email, NIF) |
| `veiculos` | matrícula, marca, modelo, ano, VIN, km atuais, dono |
| `mecanicos` | nome, telefone, especialidade, preço/hora e estado |
| `ordens_servico` | obra: avaria, trabalho realizado, km, estado, taxa/hora, desconto, IVA |
| `registos_tempo` | tempo por tarefa, em minutos, com data e mecânico |
| `pecas_usadas` | peças compradas para a obra (descrição, fornecedor, quantidade, preço) |
| `ficheiros` | fotos e vídeos da viatura (guardados em `media/`) |

## Cálculo do preço

```
mão de obra = Σ (minutos do registo / 60) × preço/hora guardado no registo
              (o preço/hora do mecânico no momento do registo, ou a taxa_hora da
               obra quando não há mecânico; alterar a tabela depois não mexe em
               obras já feitas)
peças       = Σ quantidade × preço unitário
subtotal    = mão de obra + peças − desconto
total       = subtotal + IVA
```

## Funcionalidades

- Entrada de viatura num só ecrã: basta a matrícula — se o carro já cá esteve, marca/modelo, dono e
  histórico aparecem automaticamente; caso contrário pede-se marca, modelo e dono
- Registar veículo e dono a partir do telemóvel, com atualização de km
- Ficha do veículo com histórico contínuo: todas as visitas (data, km, avaria, trabalho, peças,
  custo), nº de visitas, horas acumuladas e total já faturado; abrir nova obra a partir da ficha
- Ligações diretas por URL: `#/veiculo/{id}` e `#/obra/{id}`
- Abrir obra com descrição do que veio arranjar
- Tempo da reparação inserido à mão (horas + minutos, data e mecânico), a partir da obra ou
  diretamente de cada visita na ficha do veículo
- Perfil do mecânico (`#/mecanico/{id}`): definições com o preço/hora que cobra, resumo mensal
  (horas, obras e mão de obra gerada) e trabalhos recentes
- Fotos e vídeos na ficha do veículo: tirar com a câmara do telemóvel ou anexar ficheiros
- Peças compradas por obra (descrição, fornecedor, quantidade e preço) — sem catálogo nem stock
- Totais atualizados ao momento e impressão/PDF da folha de obra
- Estados: aberta → em curso → concluída → faturada, com resumo de faturação

## API (principais endpoints)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET/POST | `/api/clientes` | listar/criar clientes |
| GET/POST | `/api/veiculos` | listar/criar veículos (`?q=` pesquisa) |
| GET/PATCH | `/api/veiculos/{id}` | ficha com histórico e resumo / atualizar km e dados |
| GET | `/api/veiculos/por-matricula/{matricula}` | reconhecer viatura (ignora espaços e traços) |
| POST | `/api/entrada` | receção rápida: cria/atualiza viatura e dono e abre a obra |
| GET/POST | `/api/ordens` | listar (`?estado=`, `?q=`) / criar obras |
| GET/PATCH | `/api/ordens/{id}` | detalhe com totais / atualizar |
| GET/POST | `/api/mecanicos` | listar/criar mecânicos |
| GET | `/api/mecanicos/{id}` | perfil: definições, resumo mensal e trabalhos recentes |
| PATCH | `/api/mecanicos/{id}` | definições (nome, contacto, preço/hora, estado) |
| POST/DELETE | `/api/ordens/{id}/tempos` | registar/apagar tempo (minutos, data, mecânico) |
| GET/POST | `/api/veiculos/{id}/ficheiros` | listar/carregar fotos e vídeos |
| DELETE | `/api/ficheiros/{id}` | apagar foto ou vídeo |
| POST/DELETE | `/api/ordens/{id}/pecas` | adicionar/remover peças da obra |
| GET | `/api/resumo` | indicadores gerais |
