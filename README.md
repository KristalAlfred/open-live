[![Try on OSC](https://img.shields.io/badge/Try%20on-Open%20Source%20Cloud-blue)](https://openlive.apps.osaas.io)

# open-live

Open Live is a cloud-native live broadcast production suite that replaces traditional hardware — vision mixers, audio consoles, and multiviewers — with a fully browser-based solution. This repository is the central API server. The browser-based production controller lives in [open-live-studio](https://github.com/Eyevinn/open-live-studio).

## Try it on OSC

The fastest way to try Open Live — no Kubernetes required.

Visit **[openlive.apps.osaas.io](https://openlive.apps.osaas.io)** to spin up a managed Open Live instance on Open Source Cloud. Start for an event, tear down after. No infrastructure to manage and no monthly minimum.

- 14-day free trial, free plan available
- 15 EUR/month (self-hosted Strom) or 69 EUR/month (shared GPU in Frankfurt)

## Features

- **Vision mixing** — cuts, auto transitions, DSK layers, picture-in-picture, graphics overlays, and fade-to-black
- **Audio mixer** — per-channel faders with EBU R128 loudness metering
- **Multiviewer** — sub-500ms WebRTC glass-to-glass latency
- **Stream Deck control** — hardware button panel integration
- **Up to 16 sources** per production
- **REMI / remote production** — crews work from anywhere via browser; eliminates travel and equipment shipping
- **Self-hostable** on any Kubernetes cluster, zero vendor lock-in

## Requirements

- Node.js 23+
- pnpm 10.33+
- CouchDB instance (local or remote)

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env with your credentials and config
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port the server listens on | `3000` |
| `COUCHDB_URL` | Full CouchDB connection URL including credentials | required |
| `COUCHDB_NAME` | CouchDB database name | `open-live` |
| `CORS_ORIGIN` | Allowed CORS origin (URL of the studio frontend) | `http://localhost:5173` |
| `STROM_URL` | Base URL of the Strom pipeline engine | `http://localhost:7000` |
| `STROM_TOKEN` | OSC Personal Access Token for authenticating against an OSC-hosted Strom instance | _(empty — not needed for local Strom)_ |
| `LOG_LEVEL` | Fastify log level (`trace`, `debug`, `info`, `warn`, `error`) | `info` |
| `SOURCE_PROVIDERS` | Comma-separated ids of [source providers](#source-providers) to poll. Unknown ids fail startup. | _(empty — disabled)_ |
| `SOURCE_PROVIDER_POLL_MS` | Interval between source provider polls, in milliseconds | `5000` |
| `WEAVE_NORTHBOUND_URL` | Base URL of the open-weave northbound API (e.g. `http://localhost:29080`). Required when `weave` is in `SOURCE_PROVIDERS`. | _(unset)_ |
| `WEAVE_NORTHBOUND_TOKEN` | Bearer token for the open-weave northbound API. Required when `weave` is in `SOURCE_PROVIDERS`. | _(unset)_ |

> **Never commit `.env`** — it is gitignored. Use `.env.example` as the reference.

### Strom authentication

When `STROM_URL` points to an OSC-hosted Strom instance, set `STROM_TOKEN` to your OSC Personal Access Token. The server automatically exchanges it for a short-lived Service Access Token (SAT) and refreshes it before expiry. No extra steps needed.

Leave `STROM_TOKEN` unset when running Strom locally without authentication.

## Commands

```bash
# Start development server with hot reload
pnpm dev

# Type-check without emitting
pnpm typecheck

# Compile TypeScript to dist/
pnpm build

# Start compiled server (production / OSC deployment)
pnpm start
```

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/healthz` | Liveness check (OSC health probe alias) |
| `GET` | `/ready` | Readiness check (requires CouchDB) |
| `GET/POST` | `/api/v1/productions` | List / create productions |
| `GET/PATCH/DELETE` | `/api/v1/productions/:id` | Get / update / delete a production |
| `POST` | `/api/v1/productions/:id/activate` | Activate production — creates + starts Strom flow |
| `POST` | `/api/v1/productions/:id/deactivate` | Deactivate production — stops + deletes Strom flow |
| `POST` | `/api/v1/productions/:id/sources` | Assign a source to a mixer input |
| `DELETE` | `/api/v1/productions/:id/sources/:mixerInput` | Remove a source assignment |
| `GET/POST` | `/api/v1/sources` | List / create sources |
| `GET/PATCH/DELETE` | `/api/v1/sources/:id` | Get / update / delete a source |
| `GET/POST` | `/api/v1/templates` | List / create Strom flow templates |
| `GET/PATCH/DELETE` | `/api/v1/templates/:id` | Get / update / delete a template |
| `WS` | `/ws/productions/:id/controller` | WebSocket controller channel |

### Source model

Sources represent individual video/audio feeds. Each source has a `streamType` (`srt` or `whip`) and an `address` (SRT URI or WHIP endpoint URL).

### Source providers

A source provider is a small module under `src/providers/` that lists source candidates produced by another system. The server polls every provider named in `SOURCE_PROVIDERS` and materialises the candidates as ordinary sources, so assignment, activation and the studio UI need no knowledge of where a source came from.

Provider-owned sources carry a `provider` object (`{ id, externalId, syncedAt }`) and `readOnly: true` in API responses. `PATCH` and `DELETE` on them return `409`. A source that the provider stops listing is marked `inactive` rather than deleted, so a production that still references it keeps its assignment.

Available providers:

| Id | System | Configuration |
|---|---|---|
| `weave` | [open-weave](https://github.com/Eyevinn/open-weave) | `WEAVE_NORTHBOUND_URL`, `WEAVE_NORTHBOUND_TOKEN` |

The `weave` provider lists every enabled stream on the northbound API and offers each placed, node-hosted output as an SRT source with `?mode=caller` appended, which is the address open-live's `builtin.mpegtssrt_input` block dials. Outputs that weave dials out to (remote destinations) and streams that are not yet placed are skipped. The matching destination's declared SRT latency is carried onto the source, so the input block and the vision mixer's `min_upstream_latency` agree with what weave configured; a value outside the 20–8000 ms the REST schema allows is ignored in favour of the default.

```bash
SOURCE_PROVIDERS=weave \
WEAVE_NORTHBOUND_URL=http://localhost:29080 \
WEAVE_NORTHBOUND_TOKEN=<token> \
pnpm dev
```

### Template model

A template is a reusable Strom flow blueprint. It contains:
- `flow` — the full Strom flow JSON (`elements[]`, `blocks[]`, `links[]`)
- `inputs[]` — parametric input slots: `{ id, blockId, addressProperty }` — maps a logical input name to a block in the flow and the property that receives the source address

### Activation flow

1. A production is given a `templateId` and source assignments (`POST /api/v1/productions/:id/sources`)
2. `POST /api/v1/productions/:id/activate` clones the template flow, patches each assigned source's address into the matching block, creates the flow in Strom, and starts it. The `stromFlowId` is stored on the production.
3. `POST /api/v1/productions/:id/deactivate` stops and deletes the Strom flow and clears `stromFlowId`.

## OSC deployment

The app is deployed on [Open Source Cloud](https://www.osaas.io). Environment variables are injected at runtime via an OSC parameter store — no `.env` file is needed on the server.

Required services: CouchDB (`apache-couchdb`), Strom (`eyevinn-strom`), parameter store (`eyevinn-app-config-svc` + `valkey`).
