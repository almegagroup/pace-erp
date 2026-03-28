### Environment Usage
This frontend must not hardcode any backend URLs.
All network targets must be read from `VITE_API_BASE`.
### Deploy Neutrality
This frontend is deploy-neutral and must not assume browser-only behavior.
### Domain Boundary
This frontend does not control or inspect auth cookies or domains.
All auth/session/domain decisions are handled by the backend.
Production pipeline test

Almega-pace
