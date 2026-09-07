"""Login simples por palavra-passe partilhada, para a app poder ser pública.

Ativa-se definindo `OFICINA_PASSWORD`; sem essa variável a app fica aberta
(útil em desenvolvimento local).
"""

import hashlib
import hmac
import os
import secrets

from fastapi import Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

PASSWORD = os.getenv("OFICINA_PASSWORD", "")
COOKIE = "oficina_sessao"
_CHAVE = os.getenv("OFICINA_SECRET", secrets.token_hex(16))

CAMINHOS_LIVRES = {"/entrar", "/favicon.ico", "/healthz"}


def _token() -> str:
    return hmac.new(_CHAVE.encode(), PASSWORD.encode(), hashlib.sha256).hexdigest()


PAGINA = """<!doctype html>
<html lang="pt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar — Oficina</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6fa;
      font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2434}
 form{background:#fff;padding:32px 28px;border-radius:16px;width:min(360px,90vw);
      box-shadow:0 12px 32px rgba(20,30,60,.12);display:grid;gap:14px}
 h1{font-size:20px;margin:0}
 p{margin:0;color:#5b6577;font-size:14px}
 input{padding:14px;font-size:16px;border:1px solid #d3d9e4;border-radius:10px}
 button{padding:14px;font-size:16px;font-weight:600;border:0;border-radius:10px;
        background:#1f6feb;color:#fff}
 .erro{color:#c0392b;font-size:14px}
</style></head>
<body><form method="post" action="/entrar">
 <h1>Gestão de Oficina</h1>
 <p>Introduza a palavra-passe da oficina.</p>
 <input type="password" name="password" placeholder="Palavra-passe" autofocus required>
 <button type="submit">Entrar</button>
 __ERRO__
</form></body></html>"""


def registar(app) -> None:
    if not PASSWORD:
        return

    @app.middleware("http")
    async def exigir_login(request: Request, call_next):
        if request.url.path in CAMINHOS_LIVRES or request.cookies.get(COOKIE) == _token():
            return await call_next(request)
        if request.url.path.startswith("/api/"):
            return Response(status_code=401, content="Sessão expirada")
        return RedirectResponse("/entrar")

    @app.get("/entrar", include_in_schema=False)
    def form_login() -> HTMLResponse:
        return HTMLResponse(PAGINA.replace("__ERRO__", ""))

    @app.post("/entrar", include_in_schema=False)
    def submeter_login(password: str = Form("")) -> Response:
        if not hmac.compare_digest(password, PASSWORD):
            return HTMLResponse(
                PAGINA.replace("__ERRO__", '<p class="erro">Palavra-passe errada.</p>'),
                status_code=401,
            )
        resposta = RedirectResponse("/", status_code=303)
        resposta.set_cookie(
            COOKIE, _token(), max_age=60 * 60 * 24 * 30, httponly=True, samesite="lax"
        )
        return resposta
