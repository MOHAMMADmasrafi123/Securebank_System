# SecureBank — Login & Registration (Mashrafi)

Feature source extracted from the supplied SecureBank project.

## Included
- Customer login UI and registration page
- Authentication frontend service and shared API helper
- Current backend `auth.routes.js` as the source of login/registration handlers
- Backend dependency and shared Prisma/auth references

## IMPORTANT: shared backend file
`backend/routes/auth.routes.js` currently contains customer registration, customer login, 2FA verification, admin login, and admin/device approval/unlock handlers in one router. It is included here as the original source reference, **not as a standalone feature-only router**. Do not independently edit or deploy a divergent copy. Coordinate backend changes with the main integration owner; split handlers into dedicated route modules before merging.

## Shared dependencies
The original app uses the same MySQL database, Prisma schema, JWT middleware, and API base URL. This repository is a feature work package, not a standalone runnable bank application.

## Safety
Never commit `.env`, credentials, tokens, `node_modules`, or generated secrets.
