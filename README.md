# ProofSnap SaaS

Monorepo cho LensProof SaaS.

## Cấu trúc

- `BE/`: Backend Node.js/Express, PostgreSQL, Google OAuth và Google Drive API.
- `FE/`: Frontend React (Vite + TypeScript + Tailwind), 2 khu vực: Admin Portal (`/admin`) cho nhiếp ảnh gia và Client Portal (`/a/:albumId`) cho khách xem album.

## Chạy backend

```powershell
Set-Location BE
npm install
docker compose up -d
npm run dev
```

Swagger: `http://localhost:3000/api-docs/`
Health check: `http://localhost:3000/api/health`

## Chạy frontend

```powershell
Set-Location FE
npm install
Copy-Item .env.example .env
npm run dev
```

Mặc định chạy tại `http://localhost:5173`, gọi thẳng API backend qua `VITE_API_BASE_URL`
(xem `FE/.env.example`). BE đã cấu hình CORS cho phép origin này (`CLIENT_URL` trong `BE/.env`),
nên không cần dev proxy.
