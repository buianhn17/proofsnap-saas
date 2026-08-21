import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Bước 1.4/1.5/1.6 — bật cross-origin isolation (COOP/COEP) CHỈ cho các trang dùng
// culling worker (/dev/culling-test và /admin/albums/:id/cull), vì WASM đa luồng
// (SharedArrayBuffer) của MediaPipe cần self.crossOriginIsolated === true. Không bật
// toàn site để không ảnh hưởng các trang admin/client khác gọi API backend qua axios.
//
// Lưu ý: khi tài liệu có COEP, chính script của Worker (Bước 1.5, culling.worker.ts) CŨNG
// phải được trả về kèm header Cross-Origin-Embedder-Policy khớp, nếu không trình duyệt chặn
// luôn việc tạo worker (net::ERR_BLOCKED_BY_RESPONSE) — kể cả khi worker cùng origin. Vì vậy
// phải khớp thêm đường dẫn file worker (dev: /src/lib/culling/..., build: culling.worker-*.js).
function crossOriginIsolationForCullingTest(): Plugin {
  const cullPageRegex = /^\/admin\/albums\/[^/]+\/cull(\/|$|\?)/

  const shouldIsolate = (url: string) =>
    url.startsWith('/dev/culling-test') ||
    cullPageRegex.test(url) ||
    url.includes('/lib/culling/') ||
    url.includes('culling.worker')

  const setHeaders = (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    if (req.url && shouldIsolate(req.url)) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    }
    next()
  }
  return {
    name: 'culling-test-cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use(setHeaders)
    },
    configurePreviewServer(server) {
      server.middlewares.use(setHeaders)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), crossOriginIsolationForCullingTest()],
})
