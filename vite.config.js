import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    include: ['monaco-editor']
  },
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        student: './student.html',
        teacher: './teacherMonitor.html'
      }
    }
  }
})


