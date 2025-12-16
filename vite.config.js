import { defineConfig } from 'vite'
import { copyFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  optimizeDeps: {
    include: ['monaco-editor']
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        student: resolve(__dirname, 'student.html'),
        teacher: resolve(__dirname, 'teacherMonitor.html')
      }
    }
  },
  plugins: [
    {
      name: 'copy-html-files',
      closeBundle() {
        try {
          copyFileSync(resolve(__dirname, 'student.html'), resolve(__dirname, 'dist/student.html'))
          copyFileSync(resolve(__dirname, 'teacherMonitor.html'), resolve(__dirname, 'dist/teacherMonitor.html'))
        } catch (err) {
          console.warn('HTML 파일 복사 실패:', err)
        }
      }
    }
  ]
})
