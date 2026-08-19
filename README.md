# ProofSnap SaaS

Monorepo cho LensProof SaaS.

## Cấu trúc

- `BE/`: Backend Node.js/Express, PostgreSQL, Google OAuth và Google Drive API.
- `FE/`: Frontend sẽ được phát triển tiếp theo.

## Chạy backend

```powershell
Set-Location BE
npm install
docker compose up -d
npm run dev
```

Swagger: `http://localhost:3000/api-docs/`
Health check: `http://localhost:3000/api/health`
