# Contributing to Easy Payments

Thanks for helping improve Easy Payments.

## Prerequisites

- Node.js (LTS recommended)
- npm
- Angular CLI knowledge helpful

## Supported Angular versions

Consumers: **`>=20.3.0 <23.0.0`** (validated on 20, 21, 22).  
This workspace builds with **Angular 22.1.5**.

License: **MIT**.

## Setup

```bash
npm install
npm run build:lib
```

### Local credentials (do not commit)

**NestJS**

```bash
cd server
cp .env.example .env
# edit server/.env with YOUR test secrets (gitignored)
```

**Angular demo**

```bash
cp projects/demo/src/environments/environment.local.example.ts ^
   projects/demo/src/environments/environment.local.ts
# edit environment.local.ts with pk_test_... / PayPal Client ID only
```

Tracked `environment.ts` stays placeholders-only. Development serve uses `fileReplacements` → `environment.local.ts`.

### Demo

```bash
npm start
```

http://localhost:4200

### Reference backend

```bash
cd server
npm install
npm run start:dev
```

http://localhost:3000

## Tests & builds

```bash
npm test
npm run test:demo
npm run server:test
npm run build:lib
npm run build:demo
npm run server:build
```

## Pull requests

- Keep changes focused; do not redesign working payment adapters unless fixing a confirmed bug
- Match existing TypeScript / Angular style
- Add or update tests when behavior changes
- Update docs under `docs/` when public API or contracts change
- Never commit secrets (`.env`, `environment.local.ts`, live keys, private keys)

## Issues

- Bugs / features: [GitHub Issues](https://github.com/easy-payments-dev/easy-payments-angular/issues)
- Use the bug / feature templates when available
- General contact: jantvb@gmail.com
