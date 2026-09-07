"""Armazenamento das fotos e vídeos no Supabase Storage.

Ativa-se definindo `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`; sem essas variáveis
os ficheiros ficam em disco (`MEDIA_DIR`), como em desenvolvimento local.
"""

import json
import mimetypes
import os
import urllib.error
import urllib.request

URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
CHAVE = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
BUCKET = os.getenv("SUPABASE_BUCKET", "oficina").strip()
PREFIXO = "sb:"


def ativo() -> bool:
    return bool(URL and CHAVE)


def _pedido(metodo: str, caminho: str, dados: bytes | None, content_type: str) -> bytes:
    pedido = urllib.request.Request(f"{URL}{caminho}", data=dados, method=metodo)
    pedido.add_header("apikey", CHAVE)
    pedido.add_header("Authorization", f"Bearer {CHAVE}")
    if dados is not None:
        pedido.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(pedido, timeout=60) as resposta:
            return resposta.read()
    except urllib.error.HTTPError as erro:
        erro.msg = f"{erro.msg} ({metodo} {caminho}: {erro.read()[:300].decode(errors='replace')})"
        raise


def criar_bucket() -> None:
    """Garante que o bucket existe e é de leitura pública."""
    try:
        _pedido("GET", f"/storage/v1/bucket/{BUCKET}", None, "application/json")
        return
    except urllib.error.HTTPError as erro:
        if erro.code != 404 and "NoSuchBucket" not in erro.msg:
            raise
    corpo = json.dumps({"id": BUCKET, "name": BUCKET, "public": True}).encode()
    _pedido("POST", "/storage/v1/bucket", corpo, "application/json")


def guardar(nome: str, dados: bytes) -> str:
    """Envia o ficheiro e devolve o caminho a gravar na base de dados."""
    tipo = mimetypes.guess_type(nome)[0] or "application/octet-stream"
    _pedido("POST", f"/storage/v1/object/{BUCKET}/{nome}", dados, tipo)
    return f"{PREFIXO}{nome}"


def apagar(caminho: str) -> None:
    if not caminho.startswith(PREFIXO):
        return
    nome = caminho[len(PREFIXO) :]
    try:
        _pedido("DELETE", f"/storage/v1/object/{BUCKET}/{nome}", None, "application/json")
    except urllib.error.HTTPError as erro:
        if erro.code != 404:
            raise


def url(caminho: str) -> str:
    if caminho.startswith(PREFIXO):
        return f"{URL}/storage/v1/object/public/{BUCKET}/{caminho[len(PREFIXO):]}"
    return f"/media/{caminho}"
