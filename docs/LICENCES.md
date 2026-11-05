# Dependency and licence inventory

Generated from `node_modules` on 2026-11-05 for the **direct** dependencies pinned in `package.json`. Transitive dependencies are recorded in `package-lock.json`; run `npx license-checker --summary` (not installed) for a full transitive report before launch.

| Package | Version | Type | Licence |
|---|---|---|---|
| @zxing/browser | 0.2.1 | runtime | MIT |
| @zxing/library | 0.23.0 | runtime | Apache-2.0 |
| better-auth | 1.7.17 | runtime | MIT |
| class-variance-authority | 0.7.1 | runtime | Apache-2.0 |
| cn | 0.5.2 | runtime | MIT |
| drizzle-orm | 0.45.4 | runtime | Apache-2.0 |
| konva | 10.9.1 | runtime | MIT |
| lucide-react | 1.69.0 | runtime | ISC |
| next | 16.4.5 | runtime | MIT |
| nodemailer | 10.3.1 | runtime | MIT-0 |
| pg | 8.23.1 | runtime | MIT |
| qrcode | 1.5.4 | runtime | MIT |
| radix-ui | 1.8.1 | runtime | MIT |
| react | 19.3.1 | runtime | MIT |
| react-dom | 19.3.1 | runtime | MIT |
| react-konva | 19.3.2 | runtime | MIT |
| zod | 4.6.7 | runtime | MIT |
| @playwright/test | 1.64.1 | dev | Apache-2.0 |
| @tailwindcss/turbopack | 4.3.4 | dev | MIT |
| @types/node | 22.20.5 | dev | MIT |
| @types/nodemailer | 8.0.2 | dev | MIT |
| @types/pg | 8.23.1 | dev | MIT |
| @types/qrcode | 1.5.6 | dev | MIT |
| @types/react | 19.3.0 | dev | MIT |
| @types/react-dom | 19.3.0 | dev | MIT |
| drizzle-kit | 0.31.11 | dev | MIT |
| eslint | 9.39.5 | dev | MIT |
| eslint-config-next | 16.4.5 | dev | MIT |
| shadcn | 4.23.0 | dev | MIT |
| tailwindcss | 4.3.4 | dev | MIT |
| tsx | 4.23.15 | dev | MIT |
| tw-animate-css | 1.4.0 | dev | MIT |
| typescript | 5.9.3 | dev | Apache-2.0 |
| vitest | 5.1.0 | dev | MIT |

Summary: MIT ×27, Apache-2.0 ×5, ISC ×1, MIT-0 ×1.

## Notices to keep

- MIT / ISC / BSD / Apache-2.0 packages require keeping their copyright and licence text when redistributed. They ship inside `node_modules`; if we ever bundle a vendored copy (for example shadcn/ui components copied into `src/components/ui`), keep the upstream notice. shadcn/ui is MIT.
- Apache-2.0 packages (e.g. `@zxing/*`, `typescript`, `@playwright/test`) may include NOTICE files; keep them in any redistribution.
- Container images used locally only (not redistributed): `postgres` (PostgreSQL Licence), `axllent/mailpit` (MIT).

## Policy

Prefer MIT/ISC/BSD/Apache-2.0. Ask before adding GPL/AGPL/SSPL or unknown licences.
