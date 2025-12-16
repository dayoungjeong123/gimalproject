import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  // Netlify 배포를 위한 기본 설정
  base: '/',
  
  // 빌드 설정
  build: {
    // 빌드 출력 디렉토리
    outDir: 'dist',
    
    // 소스맵 생성 (프로덕션에서는 false로 설정 가능)
    sourcemap: false,
    
    // 청크 크기 경고 제한 (KB)
    chunkSizeWarningLimit: 1000,
    
    // 롤업 옵션
    rollupOptions: {
      // 다중 페이지 앱을 위한 입력 파일 정의
      input: {
        main: resolve(__dirname, 'index.html'),
        student: resolve(__dirname, 'student.html'),
        teacher: resolve(__dirname, 'teacherMonitor.html')
      },
      // 출력 설정
      output: {
        // 청크 파일명 포맷
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.')
          const ext = info[info.length - 1]
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `assets/images/[name]-[hash][extname]`
          }
          if (/css/i.test(ext)) {
            return `assets/css/[name]-[hash][extname]`
          }
          return `assets/[name]-[hash][extname]`
        },
        // 수동 청크 분할 (선택사항)
        manualChunks: {
          // Firebase를 별도 청크로 분리
          'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage']
        }
      }
    },
    
    // 빈 CSS 파일 제거
    cssCodeSplit: true,
    
    // 최소화 설정
    minify: 'esbuild', // 'terser' 또는 'esbuild' (esbuild가 더 빠름)
    
    // 타겟 브라우저
    target: 'es2015'
  },
  
  // 개발 서버 설정
  server: {
    port: 3000,
    open: true
  },
  
  // 미리보기 서버 설정
  preview: {
    port: 4173,
    open: true
  },
  
  // Public 디렉토리 (자동으로 dist에 복사됨)
  publicDir: 'public'
})
