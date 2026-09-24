# OmniChat

A self-hosted, multi-provider LLM chat interface. OmniChat stores users and conversations in Neon Postgres, discovers models from an OpenAI-compatible gateway, and streams responses into the chat UI.

## Features

- Email/password authentication with Auth.js
- Password hashing via `scrypt`
- Per-user conversation history in Postgres
- AES-256-GCM encryption for provider API keys at rest
- OmniRoute, OpenAI, OpenRouter, and custom OpenAI-compatible gateways
- Live model discovery through the gateway's `/models` endpoint
- Streaming chat completions through Server-Sent Events
- Cross-chat memory — facts you explicitly save, injected into later
  conversations and switchable per chat
- Responsive shadcn/Tailwind interface with light and dark themes

## Stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS v4
- shadcn (`base-nova`, backed by Base UI)
- Auth.js v5
- Drizzle ORM and Neon Postgres
- Bun

## Setup

Requirements:

- Bun
- A Neon Postgres database
- An OmniRoute or other OpenAI-compatible gateway

Install dependencies:

```bash
bun install
```

Copy the environment template:

```bash
cp .env.example .env.local
```

Configure these values in `.env.local`:

```dotenv
OMNICHAT_DATABASE_URL='postgresql://user:password@host.neon.tech/dbname?sslmode=require'
AUTH_SECRET='generate-with-openssl-rand-base64-32'
OMNICHAT_ENCRYPTION_KEY='at-least-32-random-characters'
```

Generate a signing secret with:

```bash
openssl rand -base64 32
```

Apply the database migration:

```bash
bun run db:migrate
```

Start development:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and connect your model gateway when prompted.

## Provider configuration

OmniRoute's default local URL is:

```text
http://localhost:20128/v1
```

The app tests the gateway through `/models` and sends streaming requests to `/chat/completions`. Provider keys are encrypted on the server and never returned to the browser.

## Memory

OmniChat can carry facts between conversations. It is deliberately **not**
automatic: nothing becomes a memory without a click.

- Click the bookmark beside the thumbs buttons on any reply to save a fact.
  The text is visible and editable before anything is stored.
- After a turn, OmniChat may **suggest** one — it never saves on its own. This
  costs one extra gateway call per turn and can be switched off in
  *Settings → Memory*.
- Use the brain icon in the chat header to turn memory **off for one
  conversation** — a clean room for questions you do not want biased.
- *Settings → Memory* lists everything remembered, with edit, deactivate,
  delete, and a "use everywhere / this chat only" scope switch.

Memories are stored per account and are never visible to other users, never
included in share links, and injected as background context rather than
instructions.

No extra environment variables are required.

## Scripts

```text
bun run dev           Start development with Webpack
bun run dev:turbo     Start development with Turbopack
bun run build         Create a production build
bun run start         Start the production server
bun run lint          Run ESLint
bun run db:generate   Generate a Drizzle migration
bun run db:migrate    Apply pending migrations
bun run db:studio     Open Drizzle Studio
```

Webpack is the default development bundler because this repository disables Console Ninja's Next.js instrumentation, which can corrupt Turbopack development chunks. Turbopack remains available through `bun run dev:turbo`.

## Security notes

- Never commit `.env.local`.
- Keep `OMNICHAT_ENCRYPTION_KEY` stable. Changing it makes previously stored provider keys undecryptable.
- Rotate any database or provider credential that has been disclosed.
- Use HTTPS when exposing OmniChat beyond localhost.
