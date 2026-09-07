---
name: testing-oficina-manager
description: How to run and test the Oficina Manager app (FastAPI + SQLite + vanilla JS frontend) end-to-end in the browser, including routes, demo data and gotchas.
---

# Testar o Oficina Manager

## Arrancar a app
```bash
cd /home/ubuntu/repos/oficina-manager && /usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
- UI em http://localhost:8000 — sem autenticação, não são precisos segredos.
- Repor dados demo: `python3 -m app.seed` (confirmar o alvo no ficheiro antes; a BD é `oficina.db`).

## Devin Secrets Needed
Nenhum.

## Navegação (hash routing)
`#/inicio`, `#/obras`, `#/obra/{id}`, `#/veiculos`, `#/veiculo/{id}`, `#/mecanicos`, `#/mecanico/{id}`, `#/pecas`, `#/clientes`, `#/entrada`.
Navegar escrevendo o URL é fiável; os cartões de lista também são clicáveis.

## Pontos de entrada úteis na UI
- Registo manual de tempo: botão "+ Registar tempo" no cartão "Mão de obra" da obra, e também em cada visita do histórico na ficha do veículo (`static/app.js`, funções `vistaOrdem` e `vistaVeiculo`).
- Perfil do mecânico: separador "Mecânicos" → cartão do mecânico, ou clicar no nome do mecânico numa linha de tempo (link para `#/mecanico/{id}`). Dentro há "Editar definições" (nome/telefone/especialidade/preço-hora/ativo).
- Fotos/vídeos: ficha do veículo, botões "📷 Tirar foto" (input `capture=environment`, não acionável em desktop) e "Anexar foto/vídeo".

## Dicas de execução
- Upload de ficheiros: clicar no botão e, no diálogo GTK, `ctrl+l` e escrever o caminho absoluto + Enter.
- Gerar media de teste: `convert -size 500x350 gradient:red-yellow /tmp/teste_foto.png` e
  `ffmpeg -f lavfi -i testsrc=size=320x240:rate=15 -t 3 -pix_fmt yuv420p /tmp/teste_video.mp4`.
  (`convert ... -draw "text ..."` falha por falta de fontes; usar gradientes.)
- Viewport de telemóvel sem devtools: `wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz && wmctrl -r :ACTIVE: -e 0,0,0,420,760`. O layout troca a sidebar por uma tabbar inferior.
- Ao escrever em campos de modais, clicar primeiro no campo e só depois escrever — o primeiro caractere pode perder-se se o foco ainda estiver a assentar.

## Comportamentos a verificar com atenção
- A taxa aplicada é congelada na linha de tempo (`RegistoTempo.taxa_hora`, preenchida em `app/main.py` ao criar o registo; `taxa_aplicada()` só cai para a taxa do mecânico/obra se a coluna for nula). Teste de regressão obrigatório: anotar o total de uma obra `faturada` (na demo, obra #2 = 182,66 €), mudar o preço/hora do mecânico no perfil e reabrir a obra — tem de ficar igual, e só um registo novo usa a taxa nova. Se alguma migração deixar `taxa_hora` nulo em registos antigos, o recálculo retroativo volta a aparecer.
- Sem mecânico associado, o valor usa a `taxa_hora` da obra — criar a obra com uma taxa diferente das taxas dos mecânicos para distinguir os dois caminhos.
- Não existe stock/catálogo de peças: as peças são lançadas por obra (`POST /api/ordens/{id}/pecas`, campos descrição/fornecedor/quantidade/preço unitário). `GET /api/pecas` responde 404 e `#/pecas` cai no Início.
- Após alterações no frontend, fazer sempre `ctrl+shift+r` no browser: `static/app.js` fica em cache e vê-se a UI antiga.
