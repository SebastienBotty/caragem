# CaRM — MVP Next.js

The conversation is the approved functional specification. The user requested implementation without an additional synthesis or approval gate.

Architecture: Next.js App Router + TypeScript, Three.js/React Three Fiber, Socket.IO on the same Node HTTP server, SQLite persistence. Server-authoritative actions scoped to an authenticated garage; no browser snapshot overwrites. Standalone Node hosting is required.

Design: light mineral background #f5f6f8, ink #202b3d, workshop blue #4263eb, mint #36aa89, amber #e7a642. System sans body, compact technical numeric labels. Signature: a miniature isometric workshop, generous circulation lanes, blue lift posts, actual selectable 3D cars. Sidebar / toolbar / workshop / vehicle drawer. Responsive task view on phones, garage always available.

Scope: garage/module configuration; vehicle records and visit history; tasks with multiple mechanics; customers; estimates and draft invoices with printable documents, payments; inventory, reservations and partial purchase receipts; appointments; team invitations; manually approved email drafts with optional SMTP. Financial documents are MVP drafts, not a certified FR/BE invoicing product. No subscription billing, catalog connections, customer portal, uploaded photos or production compliance promise.

Implementation and verification:

- [x] Domain schemas, seed and reducer; node:test checks for concurrent claim, stock reservation/consumption, partial receipts, invoice totals and role permissions.
- [x] SQLite/auth/server/socket transport; tests for tenant isolation and unauthorized sockets.
- [x] Dashboard and workshop scene, vehicle drawer and mutations. Reference image `exempleGarage.png` supplied during implementation: industrial cutaway walls, windows, lift posts, cabinets, tires and colored signs added.
- [x] Management screens and mobile CSS treatment.
- [x] Typecheck, production build, backend integration checks. Browser visual checks unavailable: Chrome window-state capture repeatedly timed out, including after reset. Do not claim visual browser verification.

Independent review identified and fixed UI login validation, mail snapshot concurrency, socket revocation on password change, stale task transitions and stranded reservations. Regression coverage is in the Node tests. No real emails sent.

Review focus: stale or simultaneous actions must not overwrite another user; sockets must only join the authenticated garage; stock cannot become negative; returned vehicles and payments are independent; email failure must never be recorded as successful delivery.
