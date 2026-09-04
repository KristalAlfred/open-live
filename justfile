default:
    @just --list

# Compose stack on its own: CouchDB, Strom, coturn, open-live.
up:
    docker compose up -d --build

# Same stack plus the open-weave provider (bring the open-weave bench up first).
up-weave:
    docker compose -f docker-compose.yml -f docker-compose.weave.yml up -d --build

down:
    docker compose -f docker-compose.yml -f docker-compose.weave.yml down

logs *ARGS:
    docker compose logs -f {{ARGS}}

dev:
    pnpm dev

test:
    pnpm test

typecheck:
    pnpm typecheck

build:
    pnpm build
