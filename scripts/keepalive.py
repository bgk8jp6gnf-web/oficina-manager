"""Ping à base de dados para o projeto Supabase não entrar em pausa.

Uso: DATABASE_URL="postgresql://..." python scripts/keepalive.py
"""

import os
import sys

import psycopg

SQL = """
create table if not exists keepalive (
    id int primary key default 1,
    ultima_atividade timestamptz not null default now(),
    constraint keepalive_unica check (id = 1)
);
insert into keepalive (id) values (1) on conflict (id) do nothing;
update keepalive set ultima_atividade = now() where id = 1;
"""


def main() -> int:
    url = os.getenv("DATABASE_URL", "")
    if not url.startswith("postgres"):
        print("Defina DATABASE_URL com a ligação PostgreSQL do Supabase.", file=sys.stderr)
        return 1
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(url, autocommit=True, connect_timeout=20) as conn:
        conn.execute(SQL)
        (marca,) = conn.execute("select ultima_atividade from keepalive").fetchone()
    print(f"Base de dados ativa em {marca:%Y-%m-%d %H:%M:%S %Z}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
